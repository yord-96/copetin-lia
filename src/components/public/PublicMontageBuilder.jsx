import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle,
  Ellipse,
  Group,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from 'react-konva';
import {
  colorFromItem,
  normalizeText,
  productNameText,
  productText,
  scoreVisualHarmony,
} from './montage/montageVisualAnalysis.js';
import { buildSceneModel, TABLE_TYPES } from './montage/montageSceneModel.js';

const PUBLIC_CATALOG_ENDPOINTS = ['/__copetin_db/public/catalog', '/api/public/catalog'];
const STORAGE_KEY = 'copetin-public-montage-v6';

const SLOT_DEFINITIONS = [
  { id: 'mesa', label: 'Mesa', keywords: ['mesa'], excludes: ['muleton', 'mantel', 'caminito', 'coctelera', 'infantil'] },
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

const belongsToSlot = (item, slot) => {
  if (!item || item.kind === 'combo') return false;
  const name = productNameText(item);
  if (slot.excludes?.some((word) => name.includes(normalizeText(word)))) return false;
  if (slot.keywords.some((word) => name.includes(normalizeText(word)))) return true;
  const category = normalizeText(item.category);
  return slot.keywords.some((word) => normalizeText(word).length >= 6 && category === normalizeText(word));
};

function MaterialEllipse({ item, visual, x, y, radiusX, radiusY, opacity = 1, ...props }) {
  const base = visual?.dominantColor || colorFromItem(item, '#e8ddcd');
  return (
    <Group listening={false} opacity={opacity}>
      <Ellipse x={x} y={y} radiusX={radiusX} radiusY={radiusY} fill={base} {...props} />
      <Ellipse
        x={x}
        y={y - radiusY * 0.15}
        radiusX={radiusX * 0.93}
        radiusY={radiusY * 0.62}
        fillLinearGradientStartPoint={{ x: 0, y: -radiusY }}
        fillLinearGradientEndPoint={{ x: 0, y: radiusY }}
        fillLinearGradientColorStops={[0, 'rgba(255,255,255,.22)', 0.72, 'rgba(255,255,255,.03)', 1, 'rgba(0,0,0,.05)']}
      />
    </Group>
  );
}

function MaterialRect({ item, visual, x, y, width, height, cornerRadius = 0, opacity = 1, ...props }) {
  const base = visual?.dominantColor || colorFromItem(item, '#e8ddcd');
  return (
    <Group listening={false} opacity={opacity}>
      <Rect x={x} y={y} width={width} height={height} cornerRadius={cornerRadius} fill={base} {...props} />
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        cornerRadius={cornerRadius}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: width, y: height }}
        fillLinearGradientColorStops={[0, 'rgba(255,255,255,.17)', 0.55, 'rgba(255,255,255,.02)', 1, 'rgba(0,0,0,.05)']}
      />
    </Group>
  );
}

function PlaceSetting({ seat, selections, visuals, scale = 1 }) {
  const plateVisual = selections.plato ? visuals[selections.plato.id] : null;
  const plaquetVisual = selections.plaquet ? visuals[selections.plaquet.id] : null;
  const napkinVisual = selections.servilleta ? visuals[selections.servilleta.id] : null;
  const plaquetColor = plaquetVisual?.dominantColor || colorFromItem(selections.plaquet, '#c6a45e');
  const plateColor = plateVisual?.dominantColor || colorFromItem(selections.plato, '#f5f2ea');
  const napkinColor = napkinVisual?.dominantColor || colorFromItem(selections.servilleta, '#665944');
  const s = scale * (0.82 + seat.depth * 0.18);
  const hasPlateStack = Boolean(selections.plaquet || selections.plato);

  return (
    <Group x={seat.x} y={seat.y} rotation={seat.rotation} scaleX={s} scaleY={s} listening={false}>
      <Ellipse y={5} radiusX={39} radiusY={13} fill="rgba(65,44,27,.12)" />
      {selections.plaquet ? <Circle radius={34} fill={plaquetColor} shadowColor="#342313" shadowBlur={8} shadowOpacity={0.16} /> : null}
      {selections.plato ? (
        <>
          <Circle radius={28} fill={plateColor} stroke="rgba(90,70,45,.18)" strokeWidth={1.4} />
          <Circle radius={23} fill="rgba(255,255,255,.28)" stroke="rgba(255,255,255,.35)" strokeWidth={1} />
        </>
      ) : null}
      {!hasPlateStack ? <Circle radius={29} stroke="rgba(16,35,68,.16)" strokeWidth={1.5} dash={[5, 5]} /> : null}
      {selections.servilleta ? (
        <Group rotation={-9}>
          <Rect x={-12} y={-16} width={24} height={34} cornerRadius={4} fill={napkinColor} shadowColor="#251a13" shadowBlur={4} shadowOpacity={0.14} />
          <Line points={[-8, -10, 8, 8]} stroke="rgba(255,255,255,.25)" strokeWidth={1} />
        </Group>
      ) : null}
      {selections.copa ? (
        <Group x={36} y={-29}>
          <Ellipse radiusX={8} radiusY={10} fill="rgba(255,255,255,.38)" stroke="rgba(64,76,92,.42)" strokeWidth={1.4} />
          <Line points={[0, 10, 0, 28]} stroke="rgba(64,76,92,.48)" strokeWidth={1.4} />
          <Line points={[-6, 29, 6, 29]} stroke="rgba(64,76,92,.48)" strokeWidth={1.4} />
        </Group>
      ) : null}
      {selections.tenedor ? (
        <Group x={-42} y={-22}>
          <Line points={[0, 5, 0, 38]} stroke="#9b8260" strokeWidth={3} lineCap="round" />
          {[-4, 0, 4].map((offset) => <Line key={offset} points={[offset, 0, offset, 10]} stroke="#9b8260" strokeWidth={1.5} lineCap="round" />)}
        </Group>
      ) : null}
      {selections.cuchillo ? (
        <Group x={48} y={-22}>
          <Rect x={-2} width={5} height={39} cornerRadius={3} fill="#a58a66" />
          <Line points={[-2, 0, 5, 7, 3, 22]} closed fill="#c3ad8e" />
        </Group>
      ) : null}
    </Group>
  );
}

function Chair({ chair, selections, visuals }) {
  if (!selections.silla) return null;
  const scale = chair.scale;
  const coverVisual = selections.cobertor ? visuals[selections.cobertor.id] : null;
  const cushionVisual = selections.cojin ? visuals[selections.cojin.id] : null;
  const chairVisual = visuals[selections.silla.id];
  const chairColor = chairVisual?.dominantColor || colorFromItem(selections.silla, '#78533e');
  return (
    <Group x={chair.x} y={chair.y} rotation={chair.rotation ?? 0} scaleX={scale} scaleY={scale} listening={false}>
      <Ellipse x={0} y={43} radiusX={31} radiusY={8} fill="rgba(45,30,18,.14)" />
      <Rect x={-24} y={-42} width={48} height={52} cornerRadius={13} fill="rgba(255,255,255,.10)" stroke={chairColor} strokeWidth={5} />
      <Line points={[-18, -35, 18, 3, -18, 3, 18, -35]} stroke={chairColor} strokeWidth={3.5} lineCap="round" lineJoin="round" />
      <Rect x={-25} y={8} width={50} height={12} cornerRadius={6} fill={chairColor} />
      <Line points={[-19, 18, -24, 48]} stroke={chairColor} strokeWidth={4} lineCap="round" />
      <Line points={[19, 18, 24, 48]} stroke={chairColor} strokeWidth={4} lineCap="round" />
      {selections.cobertor ? (
        <Rect
          x={-21}
          y={-32}
          width={42}
          height={52}
          cornerRadius={10}
          fill={coverVisual?.dominantColor || colorFromItem(selections.cobertor, '#ede4d7')}
          opacity={0.72}
        />
      ) : null}
      {selections.cojin ? (
        <Ellipse
          y={20}
          radiusX={18}
          radiusY={7}
          fill={cushionVisual?.dominantColor || colorFromItem(selections.cojin, '#d8c8aa')}
          opacity={0.78}
        />
      ) : null}
    </Group>
  );
}

function Centerpiece({ x, y, selections, visuals, scale = 1 }) {
  if (!selections.centro) return null;
  const visual = visuals[selections.centro.id];
  const accent = visual?.dominantColor || colorFromItem(selections.centro, '#8e7658');
  return (
    <Group x={x} y={y} scaleX={scale} scaleY={scale} listening={false}>
      <Ellipse y={32} radiusX={31} radiusY={8} fill="rgba(45,30,18,.13)" />
      <Rect x={-16} y={6} width={32} height={28} cornerRadius={[4, 4, 13, 13]} fill={accent} opacity={0.82} />
      {[-23, -12, 0, 12, 23].map((offset, index) => (
        <Group key={offset} rotation={offset * 0.7}>
          <Line points={[0, 10, offset * 0.55, -34 - (index % 2) * 9]} stroke="#667955" strokeWidth={3} lineCap="round" />
          <Circle x={offset * 0.55} y={-35 - (index % 2) * 9} radius={8} fill={index % 2 ? accent : '#efe3d3'} stroke="rgba(45,30,18,.12)" />
        </Group>
      ))}
    </Group>
  );
}

function Table({ model, selections, visuals, view }) {
  const { geometry } = model;
  const mantelVisual = selections.mantel ? visuals[selections.mantel.id] : null;
  const runnerVisual = selections.caminito ? visuals[selections.caminito.id] : null;
  const cloth = mantelVisual?.dominantColor || colorFromItem(selections.mantel, '#e8ddcd');
  const runnerName = productNameText(selections.caminito);
  const isWideOverlay = runnerName.includes('sobremantel')
    || runnerName.includes('sobre mantel')
    || runnerName.includes('faldon');
  const overlayWidth = geometry.topW * (isWideOverlay ? 0.48 : 0.11);

  if (view === 'main') {
    const topY = geometry.cy;
    const halfW = geometry.topW / 2;
    const skirtTop = topY + geometry.topH * 0.16;
    const skirtBottom = skirtTop + geometry.skirtH;
    const inset = geometry.topW * 0.08;
    return (
      <Group listening={false}>
        <Line
          points={[geometry.cx - halfW * 0.94, skirtTop, geometry.cx + halfW * 0.94, skirtTop, geometry.cx + halfW - inset, skirtBottom, geometry.cx - halfW + inset, skirtBottom]}
          closed
          fill={cloth}
          fillLinearGradientStartPoint={{ x: geometry.cx - halfW, y: skirtTop }}
          fillLinearGradientEndPoint={{ x: geometry.cx + halfW, y: skirtBottom }}
          fillLinearGradientColorStops={[0, cloth, 0.45, cloth, 0.72, 'rgba(0,0,0,.12)', 1, cloth]}
          shadowColor="#3a2819"
          shadowBlur={22}
          shadowOpacity={0.2}
        />
        <Line
          points={[geometry.cx - halfW * 0.82, skirtTop + 8, geometry.cx - halfW * 0.68, skirtBottom - 4]}
          stroke="rgba(255,255,255,.13)"
          strokeWidth={2}
        />
        <Line
          points={[geometry.cx + halfW * 0.56, skirtTop + 6, geometry.cx + halfW * 0.45, skirtBottom - 4]}
          stroke="rgba(0,0,0,.09)"
          strokeWidth={3}
        />
        {geometry.shape === 'ellipse' ? (
          <MaterialEllipse
            item={selections.mantel}
            visual={mantelVisual}
            x={geometry.cx}
            y={topY}
            radiusX={halfW}
            radiusY={geometry.topH / 2}
            shadowColor="#342313"
            shadowBlur={16}
            shadowOpacity={0.2}
          />
        ) : (
          <MaterialRect
            item={selections.mantel}
            visual={mantelVisual}
            x={geometry.cx - halfW}
            y={topY - geometry.topH / 2}
            width={geometry.topW}
            height={geometry.topH}
            cornerRadius={geometry.shape === 'square' ? 16 : 36}
            shadowColor="#342313"
            shadowBlur={16}
            shadowOpacity={0.2}
          />
        )}
        {selections.caminito ? (
          geometry.shape === 'ellipse' ? (
            <MaterialRect
              item={selections.caminito}
              visual={runnerVisual}
              x={geometry.cx - overlayWidth / 2}
              y={topY - geometry.topH * 0.48}
              width={overlayWidth}
              height={geometry.topH * 0.96}
              cornerRadius={10}
              opacity={0.92}
            />
          ) : (
            <MaterialRect
              item={selections.caminito}
              visual={runnerVisual}
              x={geometry.cx - overlayWidth / 2}
              y={topY - geometry.topH * 0.5}
              width={overlayWidth}
              height={geometry.topH}
              cornerRadius={8}
              opacity={0.92}
            />
          )
        ) : null}
      </Group>
    );
  }

  return geometry.shape === 'ellipse' ? (
    <Group>
      <MaterialEllipse
        item={selections.mantel}
        visual={mantelVisual}
        x={geometry.cx}
        y={geometry.cy}
        radiusX={geometry.topW / 2}
        radiusY={geometry.topH / 2}
        shadowColor="#342313"
        shadowBlur={14}
        shadowOpacity={0.16}
      />
      {selections.caminito ? (
        <MaterialRect item={selections.caminito} visual={runnerVisual} x={geometry.cx - overlayWidth / 2} y={geometry.cy - geometry.topH * 0.46} width={overlayWidth} height={geometry.topH * 0.92} cornerRadius={10} opacity={0.92} />
      ) : null}
    </Group>
  ) : (
    <Group>
      <MaterialRect
        item={selections.mantel}
        visual={mantelVisual}
        x={geometry.cx - geometry.topW / 2}
        y={geometry.cy - geometry.topH / 2}
        width={geometry.topW}
        height={geometry.topH}
        cornerRadius={geometry.shape === 'square' ? 18 : 42}
        shadowColor="#342313"
        shadowBlur={14}
        shadowOpacity={0.16}
      />
      {selections.caminito ? (
        <MaterialRect item={selections.caminito} visual={runnerVisual} x={geometry.cx - overlayWidth / 2} y={geometry.cy - geometry.topH * 0.48} width={overlayWidth} height={geometry.topH * 0.96} cornerRadius={8} opacity={0.92} />
      ) : null}
    </Group>
  );
}

function MontageCanvasScene({ selections, visuals, tableType, view }) {
  const wrapperRef = useRef(null);
  const [size, setSize] = useState({ width: 900, height: 520 });

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return undefined;
    const sync = () => {
      const width = Math.max(620, Math.floor(element.clientWidth || 900));
      setSize({ width, height: Math.round(width * 0.56) });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => buildSceneModel(tableType, size.width, size.height, view), [size, tableType, view]);
  const backChairs = model.chairs.filter((chair) => chair.side === 'back');
  const frontChairs = model.chairs.filter((chair) => chair.side === 'front');

  if (view === 'place') {
    const seat = { x: size.width * 0.44, y: size.height * 0.55, rotation: 0, depth: 0.8 };
    return (
      <div className="montage-canvas-host" ref={wrapperRef}>
        <Stage width={size.width} height={size.height}>
          <Layer>
            <Rect width={size.width} height={size.height} fill="#f2e7d8" />
            <Rect y={size.height * 0.67} width={size.width} height={size.height * 0.33} fill="#b38a63" />
            <MaterialRect item={selections.mantel} visual={selections.mantel ? visuals[selections.mantel.id] : null} x={size.width * 0.08} y={size.height * 0.10} width={size.width * 0.72} height={size.height * 0.82} cornerRadius={28} />
            {selections.caminito ? (
              <MaterialRect
                item={selections.caminito}
                visual={visuals[selections.caminito.id]}
                x={size.width * 0.34}
                y={size.height * 0.10}
                width={size.width * 0.20}
                height={size.height * 0.82}
                cornerRadius={16}
                opacity={0.94}
              />
            ) : null}
            <PlaceSetting seat={seat} selections={selections} visuals={visuals} scale={2.6} />
            <Centerpiece x={size.width * 0.40} y={size.height * 0.30} selections={selections} visuals={visuals} scale={1.5} />
            {selections.silla ? <Chair chair={{ x: size.width * 0.88, y: size.height * 0.60, rotation: 0, scale: 1.8 }} selections={selections} visuals={visuals} /> : null}
          </Layer>
        </Stage>
      </div>
    );
  }

  return (
    <div className="montage-canvas-host" ref={wrapperRef}>
      <Stage width={size.width} height={size.height}>
        <Layer>
          <Rect width={size.width} height={size.height} fill="#efe3d3" />
          <Rect y={model.backdrop.horizonY} width={size.width} height={size.height - model.backdrop.horizonY} fill="#b48a63" />
          {view === 'main' ? (
            <>
              <Circle x={size.width * 0.12} y={size.height * 0.18} radius={2} fill="rgba(214,173,81,.48)" />
              <Circle x={size.width * 0.78} y={size.height * 0.15} radius={2} fill="rgba(214,173,81,.48)" />
              <Circle x={size.width * 0.56} y={size.height * 0.11} radius={1.7} fill="rgba(214,173,81,.42)" />
            </>
          ) : null}

          {backChairs.map((chair, index) => <Chair key={`back-${index}`} chair={chair} selections={selections} visuals={visuals} />)}

          <Table model={model} selections={selections} visuals={visuals} view={view} />

          {model.seats.map((seat, index) => (
            <PlaceSetting key={`seat-${index}`} seat={seat} selections={selections} visuals={visuals} scale={view === 'main' ? 0.76 : 0.82} />
          ))}

          <Centerpiece
            x={model.geometry.cx}
            y={model.geometry.cy - (view === 'main' ? 48 : 8)}
            selections={selections}
            visuals={visuals}
            scale={view === 'main' ? 0.82 : 1.05}
          />

          {frontChairs.map((chair, index) => <Chair key={`front-${index}`} chair={chair} selections={selections} visuals={visuals} />)}

          <Rect x={size.width - 258} y={size.height - 42} width={236} height={28} cornerRadius={14} fill="rgba(16,35,68,.82)" />
          <Text x={size.width - 244} y={size.height - 34} text="Vista de colores y distribucion" fill="#fff" fontSize={11} fontStyle="bold" />
        </Layer>
      </Stage>
    </div>
  );
}

function ProductThumb({ item, selected, onClick }) {
  return (
    <button type="button" className={selected ? 'is-selected' : ''} onClick={onClick} title={item.name}>
      <span>{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : 'EC'}</span>
      <strong>{item.name}</strong>
    </button>
  );
}

function MontagePalette({ selectedRows, visuals }) {
  const colors = selectedRows
    .filter(({ slot }) => ['mantel', 'caminito', 'servilleta', 'plaquet', 'silla', 'cobertor', 'cojin', 'centro'].includes(slot.id))
    .map(({ slot, item }) => ({
      id: slot.id,
      label: slot.label,
      color: visuals[item.id]?.dominantColor || colorFromItem(item, '#d8cfc2'),
    }));
  if (!colors.length) return null;
  return (
    <div className="montage-palette" aria-label="Paleta de la combinacion">
      <div><span>Paleta elegida</span><strong>{colors.length} colores y materiales</strong></div>
      <div className="montage-palette-swatches">
        {colors.map((entry) => (
          <span key={entry.id} title={entry.label} style={{ backgroundColor: entry.color }} />
        ))}
      </div>
    </div>
  );
}

function ExactProductsGallery({ selectedRows }) {
  if (!selectedRows.length) {
    return <div className="montage-exact-empty">Elige productos para ver aqui sus fotografias originales.</div>;
  }
  return (
    <section className="montage-exact-products">
      <header>
        <div><span>Productos exactos</span><strong>Estas son las fotografias reales de tu seleccion</strong></div>
        <small>Sin recortes ni deformaciones</small>
      </header>
      <div>
        {selectedRows.map(({ slot, item }) => (
          <article key={slot.id}>
            <span>{item.imageUrl ? <img src={item.imageUrl} alt={item.name} loading="lazy" /> : 'EC'}</span>
            <p><small>{slot.label}</small><strong>{item.name}</strong><em>Cod. {item.sku}</em></p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function PublicMontageBuilder() {
  const [catalog, setCatalog] = useState({ products: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tableTypeId, setTableTypeId] = useState('round');
  const [activeSlot, setActiveSlot] = useState('mantel');
  const [slotQuery, setSlotQuery] = useState('');
  const [view, setView] = useState('main');
  const [selections, setSelections] = useState({});
  const [savedAt, setSavedAt] = useState('');
  const [designing, setDesigning] = useState(false);
  const visuals = useMemo(() => Object.fromEntries(
    Object.values(selections)
      .filter((item) => item?.id)
      .map((item) => [item.id, { dominantColor: colorFromItem(item, '#d8cfc2') }]),
  ), [selections]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (stored?.tableTypeId) setTableTypeId(stored.tableTypeId);
      if (stored?.selections && typeof stored.selections === 'object') setSelections(stored.selections);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      let lastError = null;
      for (const endpoint of PUBLIC_CATALOG_ENDPOINTS) {
        try {
          const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
          const contentType = response.headers.get('content-type') || '';
          if (!response.ok || !contentType.includes('application/json')) throw new Error(`Respuesta inválida de ${endpoint}`);
          const payload = await response.json();
          if (!active) return;
          setCatalog({ products: Array.isArray(payload.products) ? payload.products : [] });
          setLoading(false);
          return;
        } catch (loadError) {
          lastError = loadError;
        }
      }
      if (!active) return;
      setError(lastError?.message || 'No se pudo cargar el catálogo.');
      setLoading(false);
    };
    load();
    return () => { active = false; };
  }, []);

  const candidatesBySlot = useMemo(() => Object.fromEntries(
    SLOT_DEFINITIONS.map((slot) => [slot.id, catalog.products.filter((item) => belongsToSlot(item, slot))]),
  ), [catalog.products]);

  const activeDefinition = SLOT_DEFINITIONS.find((slot) => slot.id === activeSlot) ?? SLOT_DEFINITIONS[0];
  const activeCandidates = useMemo(() => {
    const query = normalizeText(slotQuery);
    const base = candidatesBySlot[activeSlot] ?? [];
    if (!query) return base;
    return base.filter((item) => productText(item).includes(query));
  }, [activeSlot, candidatesBySlot, slotQuery]);

  const tableType = TABLE_TYPES.find((type) => type.id === tableTypeId) ?? TABLE_TYPES[0];
  const selectedRows = SLOT_DEFINITIONS.map((slot) => ({ slot, item: selections[slot.id] })).filter((entry) => entry.item);

  const autoCompose = async () => {
    setDesigning(true);
    const mantel = selections.mantel ?? (candidatesBySlot.mantel ?? [])[0] ?? null;
    const next = { ...selections, ...(mantel ? { mantel } : {}) };
    const roles = ['caminito', 'plaquet', 'plato', 'servilleta', 'copa', 'tenedor', 'cuchillo', 'silla', 'centro'];
    roles.forEach((role) => {
      if (next[role]) return;
      const best = (candidatesBySlot[role] ?? [])
        .slice(0, 180)
        .map((item) => ({ item, score: scoreVisualHarmony(mantel, item, role) }))
        .sort((a, b) => b.score - a.score)[0]?.item;
      if (best) next[role] = best;
    });
    setSelections(next);
    setTimeout(() => setDesigning(false), 420);
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
    <main className="public-catalog-page public-montage-page public-montage-page-v6 public-montage-page-v7">
      <section className="public-montage-hero">
        <div>
          <span>El Copetín</span>
          <h1>Diseña tu mesa</h1>
          <p>Prueba colores, textiles, vajilla y mobiliario. La vista representa la armonía y debajo verás cada producto real sin recortes.</p>
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

            <div className="montage-control-heading"><span>2. Productos reales</span><strong>Construye tu combinación</strong></div>
            <div className="montage-slot-tabs montage-slot-tabs-canvas">
              {SLOT_DEFINITIONS.map((slot) => (
                <button key={slot.id} type="button" className={activeSlot === slot.id ? 'is-active' : ''} onClick={() => { setActiveSlot(slot.id); setSlotQuery(''); }}>
                  <span>{slot.label}</span>
                  <small>{selections[slot.id]?.name || `${(candidatesBySlot[slot.id] ?? []).length} opciones`}</small>
                </button>
              ))}
            </div>

            <div className="montage-canvas-ai-card montage-v6-engine-card">
              <span>Sugerencia automática gratuita</span>
              <strong>Completar la combinación</strong>
              <p>Usa reglas locales de color, contraste y disponibilidad. No utiliza IA, API, cuentas ni pagos externos.</p>
              <button type="button" onClick={autoCompose} disabled={designing}>{designing ? 'Combinando…' : 'Completar mi mesa'}</button>
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
              <div><span>Vista de armonía</span><strong>Colores, capas y distribución proporcional</strong></div>
              <div className="montage-view-tabs">
                <button type="button" className={view === 'main' ? 'is-active' : ''} onClick={() => setView('main')}>Principal</button>
                <button type="button" className={view === 'top' ? 'is-active' : ''} onClick={() => setView('top')}>Superior</button>
                <button type="button" className={view === 'place' ? 'is-active' : ''} onClick={() => setView('place')}>Puesto individual</button>
              </div>
            </header>
            <MontagePalette selectedRows={selectedRows} visuals={visuals} />
            <MontageCanvasScene selections={selections} visuals={visuals} tableType={tableType} view={view} />
            <div className="montage-preview-foot">
              <span>Esta vista compara colores y posiciones. Las fotografías originales de los productos se muestran completas debajo.</span>
              <button type="button" onClick={clearMontage}>Limpiar montaje</button>
            </div>
            <ExactProductsGallery selectedRows={selectedRows} />
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
              <strong>Vista referencial gratuita</strong>
              <span>Los colores y la distribución son orientativos; las fotos identifican los productos exactos. La disponibilidad se confirma al cotizar.</span>
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
