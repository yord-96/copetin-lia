"""Extract candidate rows from the fixed form. Every candidate requires review."""
import re
import unicodedata
import cv2
import numpy as np
from contract_form_geometry import prepare_form, remove_grid

LABELS = ['CHAMPAÑERAS', 'C. VINO', 'C. AGUA', 'V. WISKEROS', 'V. LARGOS',
          'V. CERVECEROS', 'HIELERA + PINZA', 'JARRAS', 'JARRAS', 'CHAROLAS',
          'CENICEROS', 'CHIFUNDI', 'CUCHARAS', 'CUCHARILLAS', 'TENEDORES PEQUEÑOS',
          'TENEDORES', 'CUCHILLOS', 'PLAQUETS', 'PLATOS HONDOS', 'PLATOS PLANOS',
          'PLATOS PARA BUFFET', 'PANEROS', 'TAZAS + PLATILLOS', 'PEDESTALES',
          'MULETONES', 'MANTELES', 'MANTELES', 'SOB.', 'SERVILLETAS', 'COBERTORES',
          'CAPUCHÓN / MOÑAS', 'FALDÓN DE BUFFET', 'MESA', 'MESA P/6 PERSONAS',
          'MESA P/10 PERSONAS', 'MESA COCTELERA', 'SILLA COCTELERA', 'SILLAS PLÁSTICAS',
          'SILLAS', 'SILLITAS INFANTIL + MESITAS', 'SOMBRILLAS', 'TARIMA', 'TOLDO',
          'TOLDO', 'LOUNGE P/6 PERSONAS', 'MÓDULOS P. B.', 'SOMBRILLAS', 'OTROS']


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.lower())
                   if unicodedata.category(c) != 'Mn')


def groups(indices, distance=3):
    return [float(np.mean(part)) for part in np.split(indices, np.where(np.diff(indices) > distance)[0]+1) if len(part)]


def table_columns(image):
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 12)
    rules = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                             cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(100, height//8))))
    projection = rules[int(height*.2):int(height*.98)].sum(axis=0)/255
    columns = [x for x in groups(np.where(projection > height*.25)[0]) if width*.32 < x < width*.78]
    if len(columns) < 3:
        raise ValueError('No se distinguen las columnas del formulario. No se generó una lectura.')
    differences = np.diff(columns)
    spacing = float(np.median(differences[differences < width*.13]))
    if not width*.055 < spacing < width*.13:
        raise ValueError('La cuadrícula no coincide con el formulario admitido.')
    expected = [columns[0] + spacing * index for index in range(4)]
    if sum(min(abs(x-c) for c in columns) < spacing*.15 for x in expected) < 3:
        raise ValueError('No se pudieron validar las columnas de cantidades y precios.')
    return expected, spacing


def ocr_rows(result):
    if result.txts is None:
        return []
    return [{'text': str(text).strip(), 'score': float(score), 'box': box.tolist(),
             'x': float(np.mean(box[:, 0])), 'y': float(np.mean(box[:, 1]))}
            for text, score, box in zip(result.txts, result.scores, result.boxes)]


def row_centers(rows, quantity_x, spacing, height):
    labels = [(int(row['text']), row['y']) for row in rows
              if re.fullmatch(r'\d{1,2}', row['text']) and 1 <= int(row['text']) <= 48
              and quantity_x-spacing*3.9 < row['x'] < quantity_x-spacing*3.1
              and row['y'] > height*.15]
    if len(labels) < 20:
        raise ValueError('No se reconocen suficientes números de fila para asociar cantidades sin confundirlas.')
    points = np.array(labels)
    good = np.ones(len(points), dtype=bool)
    for _ in range(4):
        coefficient = np.polyfit(points[good, 0], points[good, 1], 2)
        good = np.abs(points[:, 1]-np.polyval(coefficient, points[:, 0])) < height*.008
        if good.sum() < 20:
            raise ValueError('La numeración de filas no es consistente.')
    centers = np.polyval(coefficient, np.arange(1, 49))
    if min(np.diff(centers)) < height*.008 or max(np.diff(centers)) > height*.035:
        raise ValueError('No se validó la separación de filas.')
    return centers


def has_ink(crop):
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 205, 255, cv2.THRESH_BINARY_INV)
    count, _, stats, _ = cv2.connectedComponentsWithStats(binary)
    return sum(s[cv2.CC_STAT_AREA] for s in stats[1:count]
               if s[cv2.CC_STAT_HEIGHT] >= max(3, crop.shape[0]*.12)
               and s[cv2.CC_STAT_WIDTH] < crop.shape[1]*.9) > 20


def recognize_cell(engine, image, x1, y1, x2, y2):
    height, width = image.shape[:2]
    crop = image[max(0, int(y1)):min(height, int(y2)), max(0, int(x1)):min(width, int(x2))]
    if not crop.size or not has_ink(crop):
        return '', 0.0
    # Padding preserves strokes close to borders; it contains no printed grid.
    crop = cv2.copyMakeBorder(crop, 6, 6, 6, 6, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    result = engine(crop, use_det=False, use_cls=False, use_rec=True)
    if result.txts is None or not result.txts:
        return '', 0.0
    return str(result.txts[0]).strip(), float(result.scores[0])


def number(value, integer=False):
    value = value.strip().rstrip('=;:').strip()
    if not re.fullmatch(r'\d{1,7}(?:[,.]\d{1,2})?', value):
        return None
    result = float(value.replace(',', '.'))
    if result > 10000000 or (integer and (result != int(result) or result < 1 or result > 100000)):
        return None
    return int(result) if integer else result


def numeric_evidence(rows, x1, x2, center, half, raw, score, integer=False):
    options = [(raw, score)]
    # Page detection can retain strokes spilling across a printed cell border.
    options.extend((row['text'], row['score']) for row in rows
                   if x1 < row['x'] < x2 and abs(row['y']-center) < half
                   and row['score'] >= .92 and number(row['text'], integer) is not None)
    return max(options, key=lambda option: option[1])


def extract_form(image, engine):
    warped, geometry = prepare_form(image)
    if not geometry['rectified']:
        raise ValueError('No se pudo enderezar el formulario de forma fiable. Sube la hoja completa y sin pliegues.')
    columns, spacing = table_columns(warped)
    # Retain rules during detection so adjacent numeric cells are not merged.
    rows = ocr_rows(engine(warped, use_det=True, use_cls=True, use_rec=True))
    centers = row_centers(rows, columns[0], spacing, image.shape[0])
    cleaned = remove_grid(warped)
    candidates, warnings, evidence = [], [], []
    for index, center in enumerate(centers):
        gap = centers[min(index+1, 47)]-centers[max(index-1, 0)]
        # Handwriting often crosses the printed rule; narrow crops cut digits.
        half = gap * (.65 if index in (0, 47) else .325)
        raw_quantity, score = recognize_cell(engine, cleaned, columns[0]+3, center-half, columns[1]-3, center+half)
        raw_quantity, score = numeric_evidence(rows, columns[0], columns[1], center, half, raw_quantity, score, True)
        quantity = number(raw_quantity, integer=True)
        if quantity is None:
            if re.search(r'[0-9A-Za-zÁÉÍÓÚáéíóúÑñ]', raw_quantity) and 'unidad' not in normalized(raw_quantity):
                warnings.append(f'Fila {index+1}: texto en cantidad no interpretable: {raw_quantity}. Revisar si contiene un ítem.')
            continue
        raw_price, price_score = recognize_cell(engine, cleaned, columns[1]+3, center-half, columns[2]-3, center+half)
        raw_total, total_score = recognize_cell(engine, cleaned, columns[2]+3, center-half, columns[3]-3, center+half)
        raw_price, price_score = numeric_evidence(rows, columns[1], columns[2], center, half, raw_price, price_score)
        raw_total, total_score = numeric_evidence(rows, columns[2], columns[3], center, half, raw_total, total_score)
        description, description_score = recognize_cell(engine, cleaned, columns[0]-spacing*3.35, center-half,
                                                        columns[0]-3, center+half)
        unit_price, written_total = number(raw_price), number(raw_total)
        mismatch = unit_price is not None and written_total is not None and abs(quantity*unit_price-written_total) > .02
        if mismatch or written_total is None:
            # A handwritten subtotal may spill into the unused box-count column.
            # Accept the wider reading only when it independently agrees with q × p.
            wider_raw, wider_score = recognize_cell(engine, cleaned, columns[2]+3, center-half,
                                                     columns[3]+spacing*.6, center+half)
            wider_total = number(wider_raw)
            if unit_price is not None and wider_total is not None and abs(quantity*unit_price-wider_total) <= .02:
                raw_total, total_score, written_total = wider_raw, wider_score, wider_total
                mismatch = False
        if mismatch:
            warnings.append(f'Fila {index+1}: precio leído «{raw_price}» y subtotal «{raw_total}» no coinciden con la cantidad {quantity}. El precio quedó vacío para revisión.')
            unit_price = None
        candidates.append({'description': description or LABELS[index], 'printedLabel': LABELS[index],
                           'quantity': quantity, 'unitPriceBs': unit_price, 'writtenTotalBs': written_total,
                           'uncertain': True})
        evidence.append({'row': index+1, 'quantity': raw_quantity, 'price': raw_price, 'total': raw_total,
                         'description': description, 'scores': [score, price_score, total_score, description_score],
                         'mismatch': mismatch})
    return {'items': candidates, 'warnings': warnings, 'geometry': geometry,
            'evidence': evidence, 'rawText': rows, 'imageSize': [warped.shape[1], warped.shape[0]]}
