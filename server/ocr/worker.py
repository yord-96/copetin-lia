"""Bounded local Python OCR worker. The image is received through stdin only."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
MODELS = Path(os.environ.get('CONTRACT_PHOTO_PYTHON_MODELS', ROOT/'data/contract-photo-python/models'))
MODEL_FILES = ['ch_PP-OCRv5_det_mobile.onnx', 'ch_ppocr_mobile_v2.0_cls_mobile.onnx', 'PP-OCRv6_rec_small.onnx']


def check():
    return all(importlib.util.find_spec(module) is not None for module in ['rapidocr', 'onnxruntime', 'cv2', 'PIL']) and all((MODELS/name).is_file() for name in MODEL_FILES)


def make_extraction(result):
    from contract_form_extract import normalized, number
    text_fields = ['contractCode', 'customerName', 'customerPhone', 'customerCi', 'responsibleName',
                   'address', 'eventDate', 'contractDate', 'deliveryDate', 'pickupDate', 'eventTime',
                   'deliveryTime', 'pickupTime', 'deliveryWindowStart', 'deliveryWindowEnd',
                   'pickupWindowStart', 'pickupWindowEnd', 'logisticsMode', 'guaranteeBs',
                   'initialPaymentBs', 'writtenTotalBs', 'notes']
    output = dict.fromkeys(text_fields)
    rows, evidence = result['rawText'], result['evidence']
    width, height = result['imageSize']
    item_y = [row['y'] for row in rows if row['text'] == '1']
    header_end = min(item_y) if item_y else height*.2
    header = [row for row in rows if row['y'] < header_end-10]
    warnings = ['Lectura experimental local: compara cada dato con la foto antes de crear el contrato.']
    warnings.extend(result['warnings'])
    customer = next((row for row in header if re.match(r'^s[eoa].{0,5}or', normalized(row['text']))), None)
    if customer:
        parts = [row for row in header if abs(row['y']-customer['y']) < 7
                 and row['x'] < width*.49 and row['x'] >= customer['x']]
        name = ' '.join(row['text'] for row in sorted(parts, key=lambda row: row['x']))
        name = re.sub(r'^[^:;]*[:;]\s*', '', name).strip()
        if name and not re.match(r'^s[eoa].{0,5}or', normalized(name)):
            output['customerName'] = name[:1000]
        responsible = [row for row in header if width*.49 < row['x'] < width*.61
                       and customer['y']-25 < row['y'] < customer['y']-3
                       and re.fullmatch(r'[A-Za-zÁÉÍÓÚáéíóúÑñ ]{3,40}', row['text'])]
        if len(responsible) == 1:
            output['responsibleName'] = responsible[0]['text']
    telephone = next((row for row in header if re.match(r'^tel', normalized(row['text']))), None)
    if telephone:
        phone_parts = [row['text'] for row in header if abs(row['y']-telephone['y']) < 7 and telephone['x']-30 <= row['x'] < width*.54]
        digits = re.findall(r'\d{6,12}', ''.join(phone_parts).replace(' ', ''))
        if len(digits) == 1:
            output['customerPhone'] = digits[0]
    address = next((row for row in header if normalized(row['text']).startswith('direccion')), None)
    if address and ':' in address['text']:
        output['address'] = address['text'].split(':', 1)[1].strip() or None
    codes = {str(int(row['text'])) for row in rows if re.fullmatch(r'\d{4,8}', row['text']) and row['y'] > header_end
             and (row['x'] < width*.25 or row['x'] > width*.82)}
    if len(codes) == 1:
        output['contractCode'] = codes.pop()
    text_lines = []
    for row in sorted(rows, key=lambda row: row['y']):
        if not text_lines or abs(row['y']-text_lines[-1][0]['y']) > height*.008:
            text_lines.append([])
        text_lines[-1].append(row)
    note_rows = rows + [{'text': ' '.join(row['text'] for row in sorted(line, key=lambda row: row['x'])),
                         'y': float(sum(row['y'] for row in line)/len(line))} for line in text_lines]
    for row in note_rows:
        value = normalized(row['text'])
        if 'cliente' in value and 'recog' in value:
            output['logisticsMode'] = 'recojo'
        guarantee = re.search(r'(\d{1,7}(?:[,.]\d{1,2})?)\s*[-=:]?\s*gar', value)
        if guarantee and row['y'] > header_end:
            output['guaranteeBs'] = number(guarantee.group(1))
    # Dates with unclear month/year remain blank: no guessed event date.
    event = next((row for row in header if 'alquilo' in normalized(row['text'])), None)
    if event:
        value = normalized(event['text'])
        match = re.search(r'(\d{1,2})\s*[-/. ]*\s*([a-z]{3,12}|\d{1,2})\s*[-/. ]*\s*(20\d{2})', value)
        months = {'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6,
                  'jul': 7, 'ago': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dic': 12}
        if match:
            from datetime import date
            day, month, year = match.groups()
            month = int(month) if month.isdigit() else months.get(month[:3], 0)
            try:
                output['eventDate'] = date(int(year), month, int(day)).isoformat()
            except ValueError:
                pass
    output['items'] = result['items']
    if not output['items']:
        raise ValueError('No se identificaron ítems con cantidades válidas. No se creó ningún contrato.')
    output['uncertainFields'] = ['customerName', 'customerPhone', 'customerCi', 'responsibleName',
                                 'eventDate', 'address', 'guaranteeBs', 'initialPaymentBs']
    for key in ['customerName', 'eventDate', 'responsibleName']:
        if not output[key]:
            warnings.append(f'No se pudo leer {key} de forma fiable. Complétalo comparando la foto.')
    if output['guaranteeBs'] is None:
        warnings.append('No se pudo confirmar la garantía: comprueba su monto en la foto; el cero propuesto no significa que no exista.')
    warnings.append('El OCR no acredita pagos: revisa cualquier «Dejó a cuenta», método y cuenta antes de crear el contrato.')
    output['warnings'] = warnings[:40]
    output['notes'] = 'Importado con OCR local por celdas; pendiente de revisión. No acredita pagos.\n' + '\n'.join(
        f"Fila {row['row']}: {row['description']} | cantidad {row['quantity']} | precio {row['price']} | subtotal {row['total']}"
        for row in evidence)
    output['notes'] = output['notes'][:1000]
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--install-models', action='store_true')
    args = parser.parse_args()
    if args.check:
        print(json.dumps({'ready': check(), 'model': 'PP-OCRv5-det + PP-OCRv6-small-es',
                          'message': 'OCR local por celdas disponible; requiere revisión.' if check() else 'Falta instalar el entorno Python o los modelos OCR.'}))
        return
    if not args.install_models and not check():
        raise ValueError('Falta instalar el entorno Python y los modelos OCR.')
    os.environ['OMP_NUM_THREADS'] = '1'
    os.environ['OPENBLAS_NUM_THREADS'] = '1'
    if hasattr(os, 'nice'):
        # Leave interactive application requests ahead of this CPU-bound worker.
        try:
            os.nice(10)
        except OSError:
            pass
    with contextlib.redirect_stdout(sys.stderr):
        import cv2
        import numpy as np
        from rapidocr import RapidOCR, OCRVersion, ModelType
        cv2.setNumThreads(1)
        engine = RapidOCR(params={
            'Global.model_root_dir': str(MODELS.resolve()), 'Global.text_score': .25,
            'Det.ocr_version': OCRVersion.PPOCRV5, 'Det.model_type': ModelType.MOBILE,
            'Det.limit_type': 'max', 'Det.limit_side_len': 1280,
            'Rec.ocr_version': OCRVersion.PPOCRV6, 'Rec.model_type': ModelType.SMALL, 'Rec.lang_type': 'es',
            'EngineConfig.onnxruntime.intra_op_num_threads': 1,
            'EngineConfig.onnxruntime.inter_op_num_threads': 1,
        })
        if args.install_models:
            test_image = np.full((160, 600, 3), 255, np.uint8)
            cv2.putText(test_image, 'MODELO 123', (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 0), 3)
            engine(test_image)
            if not check():
                raise ValueError('La descarga de modelos no terminó. Revisa la conexión y repite el instalador.')
            result = {'ready': check()}
        else:
            from PIL import Image, ImageOps
            from contract_form_extract import extract_form
            image_bytes = sys.stdin.buffer.read(8*1024*1024+1)
            if len(image_bytes) > 8*1024*1024:
                raise ValueError('La foto supera los 8 MB.')
            with Image.open(io.BytesIO(image_bytes)) as photo:
                if photo.width*photo.height > 20000000:
                    raise ValueError('La imagen supera los 20 megapíxeles. Reduce su resolución.')
                image = cv2.cvtColor(np.array(ImageOps.exif_transpose(photo).convert('RGB')), cv2.COLOR_RGB2BGR)
            scale = min(1, 1800/max(image.shape[:2]))
            if scale < 1:
                image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            result = make_extraction(extract_form(image, engine))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': str(error)[:1000]}, ensure_ascii=False))
        sys.exit(1)
