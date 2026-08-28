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
import {
  analyzeProductVisual,
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

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function ProductImage({ item, visual, ...props }) {
  const [image] = useImage(visual?.cutoutUrl || item?.imageUrl || '', 'anonymous');
  if (!image) return null;
  return <KonvaImage image={image} listening={false} {...props} />;
}

function MaterialEllipse({ item, visual, x, y, radiusX, radiusY, opacity = 1, ...props }) {
  const [texture] = useImage(item?.imageUrl || '', 'anonymous');
  const base = visual?.dominantColor || colorFromItem(item, '#e8ddcd');
  const patternOpacity = clamp((visual?.textureStrength ?? 0.1) + (visual?.patternDensity ?? 0.06) * 0.35, 0.08, 0.24);
  return (
    <Group listening={false} opacity={opacity}>
      <Ellipse x={x} y={y} radiusX={radiusX} radiusY={radiusY} fill={base} {...props} />
      {texture ? (
        <Ellipse
          x={x}
          y={y}
          radiusX={radiusX * 0.985}
          radiusY={radiusY * 0.985}
          fillPatternImage={texture}
          fillPatternRepeat="repeat"
          fillPatternScaleX={0.28}
          fillPatternScaleY={0.28}
          opacity={patternOpacity}
          globalCompositeOperation="multiply"
        />
      ) : null}
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
  const [texture] = useImage(item?.imageUrl || '', 'anonymous');
  const base = visual?.dominantColor || colorFromItem(item, '#e8ddcd');
  const patternOpacity = clamp((visual?.textureStrength ?? 0.1) + (visual?.patternDensity ?? 0.06) * 0.35, 0.08, 0.24);
  return (
    <Group listening={false} opacity={opacity}>
      <Rect x={x} y={y} width={width} height={height} cornerRadius={cornerRadius} fill={base} {...props} />
      {texture ? (
        <Rect
          x={x}
          y={y}
          width={width}
          height={height}
          cornerRadius={cornerRadius}
          fillPatternImage={texture}
          fillPatternRepeat="repeat"
          fillPatternScaleX={0.25}
          fillPatternScaleY={0.25}
          opacity={patternOpacity}
          globalCompositeOperation="multiply"
        />
      ) : null}
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

  return (
    <Group x={seat.x} y={seat.y} rotation={seat.rotation} scaleX={s} scaleY={s} listening={false}>
      <Ellipse y={5} radiusX={39} radiusY={13} fill="rgba(65,44,27,.12)" />
      <Circle radius={34} fill={plaquetColor} shadowColor="#342313" shadowBlur={8} shadowOpacity={0.16} />
      <Circle radius={28} fill={plateColor} stroke="rgba(90,70,45,.18)" strokeWidth={1.4} />
      <Circle radius={23} fill="rgba(255,255,255,.28)" stroke="rgba(255,255,255,.35)" strokeWidth={1} />
      {selections.servilleta ? (
        <Group rotation={-9}>
          <Rect x={-12} y={-16} width={24} height={34} cornerRadius={4} fill={napkinColor} shadowColor="#251a13" shadowBlur={4} shadowOpacity={0.14} />
          <Line points={[-8, -10, 8, 8]} stroke="rgba(255,255,255,.25)" strokeWidth={1} />
        </Group>
      ) : null}
      {selections.copa ? (
        <ProductImage item={selections.copa} visual={visuals[selections.copa.id]} x={28} y={-43} width={24} height={42} shadowColor="#000" shadowBlur={4} shadowOpacity={0.16} />
      ) : null}
      {selections.tenedor ? (
        <ProductImage item={selections.tenedor} visual={visuals[selections.tenedor.id]} x={-49} y={-24} width={13} height={44} />
      ) : null}
      {selections.cuchillo ? (
        <ProductImage item={selections.cuchillo} visual={visuals[selections.cuchillo.id]} x={37} y={-24} width={13} height={44} />
      ) : null}
    </Group>
  );
}

function Chair({ chair, selections, visuals }) {
  if (!selections.silla) return null;
  const scale = chair.scale;
  const coverVisual = selections.cobertor ? visuals[selections.cobertor.id] : null;
  const cushionVisual = selections.cojin ? visuals[selections.cojin.id] : null;
  return (
    <Group x={chair.x} y={chair.y} rotation={chair.rotation} scaleX={scale} scaleY={scale} listening={false}>
      <Ellipse x={0} y={39} radiusX={38} radiusY={10} fill="rgba(45,30,18,.16)" />
      <ProductImage item={selections.silla} visual={visuals[selections.silla.id]} x={-50} y={-64} width={100} height={116} />
      {selections.cobertor ? (
        <Rect
          x={-21}
          y={-32}
          width={42}
          height={52}
          cornerRadius={10}
          fill={coverVisual?.dominantColor || colorFromItem(selections.cobertor, '#ede4d7')}
          opacity={0.45}
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

function Table({ model, selections, visuals, view }) {
  const { geometry } = model;
  const mantelVisual = selections.mantel ? visuals[selections.mantel.id] : null;
  const runnerVisual = selections.caminito ? visuals[selections.caminito.id] : null;
  const cloth = mantelVisual?.dominantColor || colorFromItem(selections.mantel, '#e8ddcd');

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
              x={geometry.cx - geometry.topW * 0.055}
              y={topY - geometry.topH * 0.48}
              width={geometry.topW * 0.11}
              height={geometry.topH * 0.96}
              cornerRadius={10}
              opacity={0.92}
            />
          ) : (
            <MaterialRect
              item={selections.caminito}
              visual={runnerVisual}
              x={geometry.cx - geometry.topW * 0.055}
              y={topY - geometry.topH * 0.5}
              width={geometry.topW * 0.11}
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
        <MaterialRect item={selections.caminito} visual={runnerVisual} x={geometry.cx - geometry.topW * 0.055} y={geometry.cy - geometry.topH * 0.46} width={geometry.topW * 0.11} height={geometry.topH * 0.92} cornerRadius={10} opacity={0.92} />
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
        <MaterialRect item={selections.caminito} visual={runnerVisual} x={geometry.cx - geometry.topW * 0.055} y={geometry.cy - geometry.topH * 0.48} width={geometry.topW * 0.11} height={geometry.topH * 0.96} cornerRadius={8} opacity={0.92} />
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
            <PlaceSetting seat={seat} selections={selections} visuals={visuals} scale={2.6} />
            {selections.centro ? <ProductImage item={selections.centro} visual={visuals[selections.centro.id]} x={size.width * 0.35} y={size.height * 0.08} width={130} height={145} /> : null}
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

          {selections.centro ? (
            <ProductImage
              item={selections.centro}
              visual={visuals[selections.centro.id]}
              x={model.geometry.cx - 54}
              y={model.geometry.cy - (view === 'main' ? 96 : 70)}
              width={108}
              height={126}
              shadowColor="#2d1f14"
              shadowBlur={8}
              shadowOpacity={0.2}
            />
          ) : null}

          {frontChairs.map((chair, index) => <Chair key={`front-${index}`} chair={chair} selections={selections} visuals={visuals} />)}

          <Rect x={size.width - 248} y={size.height - 42} width={226} height={28} cornerRadius={14} fill="rgba(16,35,68,.78)" />
          <Text x={size.width - 234} y={size.height - 34} text="Montado referencial con items reales" fill="#fff" fontSize={11} fontStyle="bold" />
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

export default function PublicMontageBuilder() {
  const [catalog, setCatalog] = useState({ products: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tableTypeId, setTableTypeId] = useState('round');
  const [activeSlot, setActiveSlot] = useState('mantel');
  const [slotQuery, setSlotQuery] = useState('');
  const [view, setView] = useState('main');
  const [selections, setSelections] = useState({});
  const [visuals, setVisuals] = useState({});
  const [savedAt, setSavedAt] = useState('');
  const [designing, setDesigning] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    Object.values(selections).filter((item) => item?.id).forEach((item) => {
      if (visuals[item.id]) return;
      analyzeProductVisual(item).then((visual) => {
        if (cancelled) return;
        setVisuals((current) => current[item.id] ? current : { ...current, [item.id]: visual });
      });
    });
    return () => { cancelled = true; };
  }, [selections, visuals]);

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
    setVisuals({});
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
    <main className="public-catalog-page public-montage-page public-montage-page-v6">
      <section className="public-montage-hero">
        <div>
          <span>El Copetín</span>
          <h1>Crear montado</h1>
          <p>Combina productos reales y visualiza una escena calculada por geometría, profundidad, color y material.</p>
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

            <div className="montage-canvas-ai-card montage-v6-engine-card">
              <span>Motor inteligente local</span>
              <strong>Diseñar combinación</strong>
              <p>Analiza color, contraste, material, familia y disponibilidad. Todo corre localmente, sin API externa.</p>
              <button type="button" onClick={autoCompose} disabled={designing}>{designing ? 'Analizando…' : '✨ Diseñar montaje'}</button>
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
              <div><span>Escena inteligente local</span><strong>Geometría + materiales + profundidad</strong></div>
              <div className="montage-view-tabs">
                <button type="button" className={view === 'main' ? 'is-active' : ''} onClick={() => setView('main')}>Principal</button>
                <button type="button" className={view === 'top' ? 'is-active' : ''} onClick={() => setView('top')}>Superior</button>
                <button type="button" className={view === 'place' ? 'is-active' : ''} onClick={() => setView('place')}>Puesto individual</button>
              </div>
            </header>
            <MontageCanvasScene selections={selections} visuals={visuals} tableType={tableType} view={view} />
            <div className="montage-preview-foot">
              <span>Los textiles se aplican como materiales y los objetos se ubican según profundidad y geometría de mesa.</span>
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
              <strong>Montado visual, sin precios</strong>
              <span>La cotización se realiza después de confirmar la combinación y la disponibilidad.</span>
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
