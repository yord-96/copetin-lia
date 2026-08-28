import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle,
  Ellipse,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from 'react-konva';
import useImage from 'use-image';

const PUBLIC_CATALOG_ENDPOINTS = ['/__copetin_db/public/catalog', '/api/public/catalog'];
const STORAGE_KEY = 'copetin-public-montage-canvas-v1';

const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const SLOT_DEFINITIONS = [
  { id: 'mesa', label: 'Mesa', keywords: ['mesa'], excludes: ['muleton', 'mantel', 'caminito', 'coctelera', 'mesa infantil'] },
  { id: 'mantel', label: 'Mantel', keywords: ['mantel'], excludes: ['caminito', 'sobre mantel', 'sobremantel', 'muleton'] },
  { id: 'caminito', label: 'Caminito / sobremantel', keywords: ['caminito', 'camino', 'sobre mantel', 'sobremantel', 'faldon'] },
  { id: 'plaquet', label: 'Plaquet', keywords: ['plaquet', 'bajoplato', 'bajo plato'] },
  { id: 'plato', label: 'Plato', keywords: ['plato'], excludes: ['plaquet'] },
  { id: 'servilleta', label: 'Servilleta', keywords: ['servilleta'] },
  { id: 'copa', label: 'Copa / vaso', keywords: ['copa', 'vaso', 'cristaleria', 'cristalería', 'champanera'] },
  { id: 'tenedor', label: 'Tenedor', keywords: ['tenedor'] },
  { id: 'cuchillo', label: 'Cuchillo / cuchara', keywords: ['cuchillo', 'cuchara'] },
  { id: 'silla', label: 'Silla', keywords: ['silla'], excludes: ['cojin', 'cojín', 'capuchon', 'capuchón', 'cobertor', 'infantil'] },
  { id: 'cobertor', label: 'Cobertor / capuchón', keywords: ['cobertor', 'capuchon', 'capuchón'] },
  { id: 'cojin', label: 'Cojín', keywords: ['cojin', 'cojín'] },
  { id: 'centro', label: 'Centro de mesa', keywords: ['centro', 'arreglo', 'florero', 'candelabro', 'portavela', 'porta vela', 'vela', 'base decorativa'] },
];

const TABLE_TYPES = [
  { id: 'round', label: 'Redonda', seats: 8 },
  { id: 'rect', label: 'Rectangular', seats: 10 },
  { id: 'square', label: 'Cuadrada', seats: 8 },
];

const COLOR_RULES = [
  ['negro', '#232326'], ['blanco', '#f3efe7'], ['marfil', '#e8ddc6'], ['hueso', '#e2d2b4'],
  ['beige', '#cbb89b'], ['arena', '#c8ac86'], ['cafe', '#7b5336'], ['café', '#7b5336'],
  ['dorado', '#c59a48'], ['oro', '#c59a48'], ['plata', '#b9bdc5'], ['plateado', '#b9bdc5'],
  ['guindo', '#6d1f2c'], ['vino', '#732b39'], ['rojo', '#a72d2d'], ['fucsia', '#d83379'],
  ['rosado', '#d99aa8'], ['rosa', '#d99aa8'], ['lila', '#8d70a9'], ['morado', '#694b8c'],
  ['naranja', '#d97935'], ['amarillo', '#d9b340'], ['mostaza', '#b8932f'], ['turquesa', '#3c9e9f'],
  ['menta', '#95b9a4'], ['verde olivo', '#66734a'], ['verde', '#537a59'], ['azul marino', '#283b58'],
  ['azul', '#52749d'], ['celeste', '#87a9c7'],
];

const productText = (item) => normalizeText([
  item?.name,
  item?.category,
  item?.color,
  item?.material,
  item?.areaLabel,
].join(' '));

const productNameText = (item) => normalizeText(item?.name);

const belongsToSlot = (item, slot) => {
  if (!item || item.kind === 'combo') return false;
  const name = productNameText(item);
  if (slot.excludes?.some((word) => name.includes(normalizeText(word)))) return false;
  if (slot.keywords.some((word) => name.includes(normalizeText(word)))) return true;
  const category = normalizeText(item.category);
  return slot.keywords.some((word) => normalizeText(word).length >= 6 && category === normalizeText(word));
};

const colorFromItem = (item, fallback = '#ddd4c7') => {
  const haystack = productText(item);
  const match = COLOR_RULES.find(([word]) => haystack.includes(normalizeText(word)));
  return match?.[1] ?? fallback;
};

const hexToRgb = (hex) => {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return { r: 210, g: 200, b: 185 };
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
};

const colorDistance = (left, right) => {
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  return Math.sqrt(((a.r - b.r) ** 2) + ((a.g - b.g) ** 2) + ((a.b - b.b) ** 2));
};

const loadImageAnalysis = (item) => new Promise((resolve) => {
  if (!item?.imageUrl) {
    resolve({ dominantColor: colorFromItem(item), textureStrength: 0.2 });
    return;
  }

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  image.onload = () => {
    try {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, size, size);
      const { data } = context.getImageData(0, 0, size, size);
      let r = 0; let g = 0; let b = 0; let count = 0;
      for (let index = 0; index < data.length; index += 16) {
        const alpha = data[index + 3];
        if (alpha < 20) continue;
        const pr = data[index]; const pg = data[index + 1]; const pb = data[index + 2];
        const max = Math.max(pr, pg, pb); const min = Math.min(pr, pg, pb);
        if (max > 245 && min > 235) continue;
        r += pr; g += pg; b += pb; count += 1;
      }
      if (!count) throw new Error('Sin muestra');
      const color = `#${[r / count, g / count, b / count]
        .map((value) => Math.round(value).toString(16).padStart(2, '0'))
        .join('')}`;
      const named = colorFromItem(item, color);
      resolve({
        dominantColor: colorDistance(named, color) > 130 ? named : color,
        textureStrength: 0.28,
      });
    } catch {
      resolve({ dominantColor: colorFromItem(item), textureStrength: 0.2 });
    }
  };
  image.onerror = () => resolve({ dominantColor: colorFromItem(item), textureStrength: 0.2 });
  image.src = item.imageUrl;
});

function ProductImage({ item, ...props }) {
  const [image] = useImage(item?.imageUrl || '', 'anonymous');
  if (!image) return null;
  return <KonvaImage image={image} {...props} />;
}

function TextureEllipse({ item, visual, ...props }) {
  const [image] = useImage(item?.imageUrl || '', 'anonymous');
  return (
    <Ellipse
      {...props}
      fill={visual?.dominantColor || colorFromItem(item)}
      fillPatternImage={image || undefined}
      fillPatternScaleX={image ? 0.22 : 1}
      fillPatternScaleY={image ? 0.22 : 1}
      fillPatternRepeat="repeat"
      fillPatternOffsetX={image ? image.width / 2 : 0}
      fillPatternOffsetY={image ? image.height / 2 : 0}
      opacity={0.98}
    />
  );
}

function TextureRect({ item, visual, ...props }) {
  const [image] = useImage(item?.imageUrl || '', 'anonymous');
  return (
    <Rect
      {...props}
      fill={visual?.dominantColor || colorFromItem(item)}
      fillPatternImage={image || undefined}
      fillPatternScaleX={image ? 0.24 : 1}
      fillPatternScaleY={image ? 0.24 : 1}
      fillPatternRepeat="repeat"
      opacity={0.98}
    />
  );
}

const getTableGeometry = (type, width, height, view) => {
  const topY = view === 'main' ? height * 0.48 : height * 0.5;
  if (type.id === 'rect') {
    return {
      cx: width * 0.5,
      cy: topY,
      rx: width * 0.31,
      ry: view === 'main' ? height * 0.14 : height * 0.22,
      shape: 'rect',
      rectW: width * 0.62,
      rectH: view === 'main' ? height * 0.23 : height * 0.4,
    };
  }
  if (type.id === 'square') {
    return {
      cx: width * 0.5,
      cy: topY,
      rx: width * 0.23,
      ry: view === 'main' ? height * 0.16 : height * 0.26,
      shape: 'square',
      rectW: width * 0.46,
      rectH: view === 'main' ? height * 0.29 : height * 0.46,
    };
  }
  return {
    cx: width * 0.5,
    cy: topY,
    rx: width * 0.25,
    ry: view === 'main' ? height * 0.13 : height * 0.25,
    shape: 'ellipse',
  };
};

const makeSeatLayout = (type, width, height, view) => {
  const geometry = getTableGeometry(type, width, height, view);
  const count = type.seats;
  if (type.id === 'rect') {
    const topCount = Math.ceil(count / 2);
    const bottomCount = count - topCount;
    const rows = [];
    for (let index = 0; index < topCount; index += 1) {
      rows.push({
        x: geometry.cx - geometry.rx + ((geometry.rx * 2) / Math.max(1, topCount - 1)) * index,
        y: geometry.cy - geometry.ry - (view === 'main' ? 30 : 20),
        rotation: 0,
        chairY: geometry.cy - geometry.ry - (view === 'main' ? 100 : 58),
      });
    }
    for (let index = 0; index < bottomCount; index += 1) {
      rows.push({
        x: geometry.cx - geometry.rx + ((geometry.rx * 2) / Math.max(1, bottomCount - 1)) * index,
        y: geometry.cy + geometry.ry + (view === 'main' ? 28 : 18),
        rotation: 180,
        chairY: geometry.cy + geometry.ry + (view === 'main' ? 92 : 54),
      });
    }
    return rows;
  }

  return Array.from({ length: count }, (_, index) => {
    const angle = ((Math.PI * 2) / count) * index - Math.PI / 2;
    const seatRx = geometry.rx * (type.id === 'square' ? 1.45 : 1.45);
    const seatRy = geometry.ry * (view === 'main' ? 1.62 : 1.38);
    const x = geometry.cx + Math.cos(angle) * seatRx;
    const y = geometry.cy + Math.sin(angle) * seatRy;
    return {
      x,
      y,
      rotation: (angle * 180 / Math.PI) + 90,
      chairX: geometry.cx + Math.cos(angle) * (seatRx + (view === 'main' ? 72 : 42)),
      chairY: geometry.cy + Math.sin(angle) * (seatRy + (view === 'main' ? 62 : 40)),
    };
  });
};

function PlaceSettingCanvas({ x, y, rotation, selections, scale = 1 }) {
  const plateColor = colorFromItem(selections.plato, '#f5f2ea');
  const plaquetColor = colorFromItem(selections.plaquet, '#c6a45e');
  const napkinColor = colorFromItem(selections.servilleta, '#665944');
  return (
    <Group x={x} y={y} rotation={rotation} scaleX={scale} scaleY={scale}>
      <Circle radius={34} fill={plaquetColor} shadowColor="#4c321f" shadowBlur={8} shadowOpacity={0.18} />
      <Circle radius={27} fill={plateColor} stroke="#d8d2c8" strokeWidth={1.5} />
      {selections.servilleta ? (
        <Rect x={-11} y={-17} width={22} height={34} cornerRadius={4} fill={napkinColor} rotation={-7} />
      ) : null}
      {selections.copa ? <ProductImage item={selections.copa} x={27} y={-34} width={22} height={34} /> : null}
      {selections.tenedor ? <ProductImage item={selections.tenedor} x={-47} y={-22} width={13} height={42} /> : null}
      {selections.cuchillo ? <ProductImage item={selections.cuchillo} x={35} y={-22} width={13} height={42} /> : null}
    </Group>
  );
}

function ChairCanvas({ x, y, rotation, item, cover, cushion, scale = 1 }) {
  if (!item) return null;
  return (
    <Group x={x} y={y} rotation={rotation} scaleX={scale} scaleY={scale}>
      <ProductImage item={item} x={-42} y={-48} width={84} height={96} />
      {cover ? <Rect x={-20} y={-22} width={40} height={43} cornerRadius={9} fill={colorFromItem(cover, '#ece2d1')} opacity={0.42} /> : null}
      {cushion ? <Ellipse x={0} y={20} radiusX={17} radiusY={6} fill={colorFromItem(cushion, '#d4c3a3')} opacity={0.78} /> : null}
    </Group>
  );
}

function TableCanvas({ type, selections, visuals, width, height, view }) {
  const geometry = getTableGeometry(type, width, height, view);
  const mantelVisual = selections.mantel ? visuals[selections.mantel.id] : null;
  const runnerVisual = selections.caminito ? visuals[selections.caminito.id] : null;

  if (view === 'main') {
    const skirtTop = geometry.cy - geometry.ry * 0.1;
    const skirtBottom = geometry.cy + geometry.ry + height * 0.22;
    const left = geometry.cx - geometry.rx * 0.92;
    const right = geometry.cx + geometry.rx * 0.92;
    return (
      <Group>
        <Line
          points={[left, skirtTop, right, skirtTop, right * 0.98 + geometry.cx * 0.02, skirtBottom, left * 0.98 + geometry.cx * 0.02, skirtBottom]}
          closed
          fill={mantelVisual?.dominantColor || colorFromItem(selections.mantel, '#e8ddcd')}
          shadowColor="#4c321f"
          shadowBlur={16}
          shadowOpacity={0.2}
        />
        {geometry.shape === 'ellipse' ? (
          <TextureEllipse item={selections.mantel} visual={mantelVisual} x={geometry.cx} y={geometry.cy} radiusX={geometry.rx} radiusY={geometry.ry} shadowColor="#52361f" shadowBlur={12} shadowOpacity={0.2} />
        ) : (
          <TextureRect item={selections.mantel} visual={mantelVisual} x={geometry.cx - geometry.rectW / 2} y={geometry.cy - geometry.rectH / 2} width={geometry.rectW} height={geometry.rectH} cornerRadius={geometry.shape === 'square' ? 18 : 42} shadowColor="#52361f" shadowBlur={12} shadowOpacity={0.2} />
        )}
        {selections.caminito ? (
          <TextureRect
            item={selections.caminito}
            visual={runnerVisual}
            x={geometry.cx - (geometry.shape === 'ellipse' ? geometry.rx * 0.14 : geometry.rectW * 0.08)}
            y={geometry.cy - geometry.ry * 0.98}
            width={geometry.shape === 'ellipse' ? geometry.rx * 0.28 : geometry.rectW * 0.16}
            height={geometry.ry * 1.96}
            cornerRadius={12}
            rotation={0}
          />
        ) : null}
      </Group>
    );
  }

  return (
    <Group>
      {geometry.shape === 'ellipse' ? (
        <TextureEllipse item={selections.mantel} visual={mantelVisual} x={geometry.cx} y={geometry.cy} radiusX={geometry.rx} radiusY={geometry.ry} shadowColor="#52361f" shadowBlur={14} shadowOpacity={0.16} />
      ) : (
        <TextureRect item={selections.mantel} visual={mantelVisual} x={geometry.cx - geometry.rectW / 2} y={geometry.cy - geometry.rectH / 2} width={geometry.rectW} height={geometry.rectH} cornerRadius={geometry.shape === 'square' ? 18 : 42} shadowColor="#52361f" shadowBlur={14} shadowOpacity={0.16} />
      )}
      {selections.caminito ? (
        <TextureRect
          item={selections.caminito}
          visual={runnerVisual}
          x={geometry.cx - (geometry.shape === 'ellipse' ? geometry.rx * 0.11 : geometry.rectW * 0.07)}
          y={geometry.cy - geometry.ry}
          width={geometry.shape === 'ellipse' ? geometry.rx * 0.22 : geometry.rectW * 0.14}
          height={geometry.ry * 2}
          cornerRadius={10}
        />
      ) : null}
    </Group>
  );
}

function MontageCanvasScene({ selections, visuals, tableType, view }) {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 920, height: 560 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const update = () => {
      const width = Math.max(620, Math.floor(element.clientWidth || 920));
      setSize({ width, height: Math.round(width * 0.59) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const seats = useMemo(() => makeSeatLayout(tableType, size.width, size.height, view), [tableType, size, view]);
  const geometry = useMemo(() => getTableGeometry(tableType, size.width, size.height, view), [tableType, size, view]);

  if (view === 'place') {
    return (
      <div className="montage-konva-wrap" ref={containerRef}>
        <Stage width={size.width} height={size.height}>
          <Layer>
            <Rect width={size.width} height={size.height} fill="#d7b995" />
            <TextureRect item={selections.mantel} visual={selections.mantel ? visuals[selections.mantel.id] : null} x={size.width * 0.08} y={size.height * 0.08} width={size.width * 0.7} height={size.height * 0.84} cornerRadius={24} />
            <PlaceSettingCanvas x={size.width * 0.43} y={size.height * 0.54} rotation={0} selections={selections} scale={2.5} />
            {selections.centro ? <ProductImage item={selections.centro} x={size.width * 0.4} y={size.height * 0.12} width={100} height={120} /> : null}
            <ChairCanvas x={size.width * 0.88} y={size.height * 0.58} rotation={0} item={selections.silla} cover={selections.cobertor} cushion={selections.cojin} scale={1.65} />
          </Layer>
        </Stage>
      </div>
    );
  }

  return (
    <div className="montage-konva-wrap" ref={containerRef}>
      <Stage width={size.width} height={size.height}>
        <Layer>
          <Rect width={size.width} height={size.height * 0.58} fill={view === 'main' ? '#efe2d2' : '#d8c2a7'} />
          <Rect y={size.height * 0.58} width={size.width} height={size.height * 0.42} fill="#a98460" />
          {view === 'main' ? (
            <Group opacity={0.3}>
              {Array.from({ length: 16 }, (_, index) => (
                <Circle key={index} x={(index * 173) % size.width} y={35 + ((index * 77) % (size.height * 0.42))} radius={2.5} fill="#f6df9d" />
              ))}
            </Group>
          ) : null}

          <TableCanvas type={tableType} selections={selections} visuals={visuals} width={size.width} height={size.height} view={view} />

          {seats.map((seat, index) => (
            <Group key={index}>
              <PlaceSettingCanvas x={seat.x} y={seat.y} rotation={seat.rotation} selections={selections} scale={view === 'main' ? 0.88 : 0.78} />
              <ChairCanvas
                x={seat.chairX ?? seat.x}
                y={seat.chairY ?? seat.y}
                rotation={seat.rotation}
                item={selections.silla}
                cover={selections.cobertor}
                cushion={selections.cojin}
                scale={view === 'main' ? 0.82 : 0.68}
              />
            </Group>
          ))}

          {selections.centro ? (
            <ProductImage item={selections.centro} x={geometry.cx - 55} y={geometry.cy - 88} width={110} height={130} />
          ) : null}

          <Rect x={18} y={size.height - 42} width={350} height={28} cornerRadius={14} fill="rgba(16,35,68,.82)" />
          <Text x={32} y={size.height - 34} text="Escena Canvas: geometría, materiales y puestos calculados" fill="#fff" fontSize={12} fontStyle="bold" />
        </Layer>
      </Stage>
    </div>
  );
}

function ProductThumb({ item, selected, onClick }) {
  return (
    <button type="button" className={`montage-product-thumb${selected ? ' is-selected' : ''}`} onClick={onClick} title={item.name}>
      <span className="montage-product-thumb-image">
        {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span>EC</span>}
      </span>
      <span className="montage-product-thumb-name">{item.name}</span>
    </button>
  );
}

export default function PublicMontageBuilder() {
  const [catalog, setCatalog] = useState({ products: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tableTypeId, setTableTypeId] = useState('round');
  const [view, setView] = useState('main');
  const [activeSlot, setActiveSlot] = useState('mantel');
  const [slotQuery, setSlotQuery] = useState('');
  const [selections, setSelections] = useState({});
  const [visuals, setVisuals] = useState({});
  const [savedAt, setSavedAt] = useState('');

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (stored?.tableTypeId) setTableTypeId(stored.tableTypeId);
      if (stored?.selections && typeof stored.selections === 'object') setSelections(stored.selections);
    } catch {
      // Configuración local opcional.
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let payload = null;
        let lastError = null;
        for (const endpoint of PUBLIC_CATALOG_ENDPOINTS) {
          try {
            const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store' });
            if (!response.ok) throw new Error(`No se pudo cargar ${endpoint}`);
            payload = await response.json();
            break;
          } catch (requestError) {
            lastError = requestError;
          }
        }
        if (!payload) throw lastError || new Error('No se pudo cargar el catálogo.');
        if (!active) return;
        setCatalog({ products: Array.isArray(payload.products) ? payload.products : [] });
      } catch (requestError) {
        if (active) setError(requestError.message || 'No se pudo cargar el catálogo.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Object.values(selections).filter((item) => item?.id).forEach((item) => {
      if (visuals[item.id]) return;
      loadImageAnalysis(item).then((analysis) => {
        if (!cancelled) setVisuals((current) => current[item.id] ? current : { ...current, [item.id]: analysis });
      });
    });
    return () => { cancelled = true; };
  }, [selections, visuals]);

  const tableType = TABLE_TYPES.find((entry) => entry.id === tableTypeId) ?? TABLE_TYPES[0];
  const activeDefinition = SLOT_DEFINITIONS.find((slot) => slot.id === activeSlot) ?? SLOT_DEFINITIONS[0];

  const candidatesBySlot = useMemo(() => {
    const result = {};
    SLOT_DEFINITIONS.forEach((slot) => {
      result[slot.id] = catalog.products.filter((item) => belongsToSlot(item, slot));
    });
    return result;
  }, [catalog.products]);

  const activeCandidates = useMemo(() => {
    const query = normalizeText(slotQuery);
    return (candidatesBySlot[activeSlot] ?? []).filter((item) => !query || productText(item).includes(query));
  }, [activeSlot, candidatesBySlot, slotQuery]);

  const selectedRows = SLOT_DEFINITIONS
    .map((slot) => ({ slot, item: selections[slot.id] }))
    .filter((entry) => entry.item);

  const scoreCandidate = (slotId, item, baseColor) => {
    const candidateColor = colorFromItem(item, '#c6b89e');
    const distance = colorDistance(baseColor, candidateColor);
    const text = productText(item);
    let score = 100 - Math.abs(distance - 115) * 0.42;
    if (slotId === 'plato' && (text.includes('blanco') || text.includes('marfil'))) score += 90;
    if ((slotId === 'tenedor' || slotId === 'cuchillo') && (text.includes('dorado') || text.includes('plata') || text.includes('acero'))) score += 90;
    if (slotId === 'silla' && (text.includes('tiffany') || text.includes('crossback') || text.includes('dorado') || text.includes('madera'))) score += 70;
    if (slotId === 'plaquet' && (text.includes('dorado') || text.includes('plata') || text.includes('vidrio'))) score += 75;
    if (slotId === 'copa' && (text.includes('copa') || text.includes('cristal') || text.includes('transpar'))) score += 70;
    return score + Math.min(20, Number(item.totalStock ?? 0) / 10);
  };

  const autoCompose = () => {
    const mantel = selections.mantel ?? (candidatesBySlot.mantel ?? [])[0] ?? null;
    const baseColor = colorFromItem(mantel, '#e4dac9');
    const next = { ...selections, ...(mantel ? { mantel } : {}) };
    ['caminito', 'plaquet', 'plato', 'servilleta', 'copa', 'tenedor', 'cuchillo', 'silla', 'centro'].forEach((slotId) => {
      if (next[slotId]) return;
      const best = (candidatesBySlot[slotId] ?? [])
        .slice(0, 180)
        .map((item) => ({ item, score: scoreCandidate(slotId, item, baseColor) }))
        .sort((a, b) => b.score - a.score)[0]?.item;
      if (best) next[slotId] = best;
    });
    setSelections(next);
  };

  const saveMontage = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tableTypeId, selections }));
    setSavedAt(new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }));
  };

  const clearMontage = () => {
    setSelections({});
    localStorage.removeItem(STORAGE_KEY);
    setSavedAt('');
  };

  const requestCombination = async () => {
    const lines = selectedRows.map(({ slot, item }) => `${slot.label}: ${item.name} (Cod. ${item.sku})`);
    const text = [
      'EL COPETÍN - SOLICITUD DE MONTADO',
      `Mesa: ${tableType.label} / ${tableType.seats} puestos`,
      ...lines,
      'Solicito confirmar disponibilidad y preparar cotización.',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      window.alert('Combinación copiada. Puedes enviarla al equipo de El Copetín.');
    } catch {
      window.prompt('Copia esta combinación:', text);
    }
  };

  return (
    <main className="public-catalog-page public-montage-page public-montage-page-canvas">
      <section className="public-montage-hero">
        <div>
          <span>El Copetín</span>
          <h1>Crear montado</h1>
          <p>Construye una escena con geometría real, materiales del catálogo y puestos calculados automáticamente.</p>
        </div>
        <div className="public-montage-hero-actions">
          <a href="/catalogo">← Volver al catálogo</a>
          <strong>{catalog.products.length.toLocaleString('es-BO')} productos reales cargados</strong>
        </div>
      </section>

      {loading ? <div className="public-catalog-state">Cargando productos para el montado...</div> : null}
      {error ? <div className="public-catalog-state public-catalog-state--error">{error}</div> : null}

      {!loading && !error ? (
        <div className="public-montage-workspace public-montage-workspace-canvas">
          <aside className="public-montage-controls">
            <div className="montage-control-heading"><span>1. Base del montaje</span><strong>Tipo de mesa</strong></div>
            <div className="montage-table-types">
              {TABLE_TYPES.map((type) => (
                <button key={type.id} type="button" className={tableTypeId === type.id ? 'is-active' : ''} onClick={() => setTableTypeId(type.id)}>
                  <span className={`montage-table-icon montage-table-icon--${type.id}`} />
                  {type.label}<small>{type.seats} puestos</small>
                </button>
              ))}
            </div>

            <div className="montage-control-heading"><span>2. Productos reales</span><strong>Construye la escena</strong></div>
            <div className="montage-slot-tabs montage-slot-tabs-canvas">
              {SLOT_DEFINITIONS.map((slot) => (
                <button key={slot.id} type="button" className={activeSlot === slot.id ? 'is-active' : ''} onClick={() => { setActiveSlot(slot.id); setSlotQuery(''); }}>
                  <span>{slot.label}</span>
                  <small>{selections[slot.id]?.name || `${(candidatesBySlot[slot.id] ?? []).length} opciones`}</small>
                </button>
              ))}
            </div>

            <div className="montage-canvas-ai-card">
              <span>Motor de diseño local</span>
              <strong>Completar combinación</strong>
              <p>Calcula una propuesta con reglas de contraste y familias del catálogo. No usa APIs externas.</p>
              <button type="button" onClick={autoCompose}>✨ Diseñar montaje</button>
            </div>

            <div className="montage-product-picker">
              <div className="montage-product-picker-head">
                <div><strong>{activeDefinition.label}</strong><span>{activeCandidates.length} productos</span></div>
                {selections[activeSlot] ? <button type="button" onClick={() => setSelections((current) => ({ ...current, [activeSlot]: null }))}>Quitar</button> : null}
              </div>
              <input value={slotQuery} onChange={(event) => setSlotQuery(event.target.value)} placeholder={`Buscar ${activeDefinition.label.toLowerCase()}...`} />
              <div className="montage-product-strip">
                {activeCandidates.slice(0, 120).map((item) => (
                  <ProductThumb
                    key={item.id}
                    item={item}
                    selected={selections[activeSlot]?.id === item.id}
                    onClick={() => {
                      setSelections((current) => ({ ...current, [activeSlot]: item }));
                      if (activeSlot === 'mesa') {
                        const name = productNameText(item);
                        if (name.includes('rectangular')) setTableTypeId('rect');
                        else if (name.includes('cuadrad')) setTableTypeId('square');
                        else if (name.includes('redond')) setTableTypeId('round');
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          </aside>

          <section className="public-montage-preview public-montage-preview-canvas">
            <header className="montage-preview-header">
              <div><span>Escena inteligente</span><strong>Canvas 2D con geometría y materiales</strong></div>
              <div className="montage-view-tabs">
                <button type="button" className={view === 'main' ? 'is-active' : ''} onClick={() => setView('main')}>Principal</button>
                <button type="button" className={view === 'top' ? 'is-active' : ''} onClick={() => setView('top')}>Superior</button>
                <button type="button" className={view === 'place' ? 'is-active' : ''} onClick={() => setView('place')}>Puesto individual</button>
              </div>
            </header>
            <MontageCanvasScene selections={selections} visuals={visuals} tableType={tableType} view={view} />
            <div className="montage-preview-foot">
              <span>El mantel y el caminito se renderizan como materiales; los puestos se calculan según la geometría.</span>
              <button type="button" onClick={clearMontage}>Limpiar montaje</button>
            </div>
          </section>

          <aside className="public-montage-summary-panel public-montage-summary-canvas">
            <header><span>Resumen del montado</span><strong>{tableType.label} · {tableType.seats} puestos</strong></header>
            <div className="montage-summary-list">
              {selectedRows.length ? selectedRows.map(({ slot, item }) => (
                <div key={slot.id}>
                  <span className="montage-summary-image">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : 'EC'}</span>
                  <p><small>{slot.label}</small><strong>{item.name}</strong><em>Cod. {item.sku}</em></p>
                </div>
              )) : <p className="montage-empty-summary">Selecciona productos para construir tu propuesta.</p>}
            </div>
            <div className="montage-no-price-note">
              <strong>Sin precios en el montado público</strong>
              <span>La cotización se prepara después de confirmar la combinación y disponibilidad.</span>
            </div>
            <button type="button" className="montage-secondary-action" onClick={saveMontage}>♡ Guardar montaje</button>
            {savedAt ? <small className="montage-saved-note">Guardado en este dispositivo a las {savedAt}.</small> : null}
            <button type="button" className="montage-primary-action" disabled={!selectedRows.length} onClick={requestCombination}>Solicitar esta combinación</button>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
