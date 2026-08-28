import { useEffect, useMemo, useState } from 'react';

const PUBLIC_CATALOG_ENDPOINTS = ['/__copetin_db/public/catalog', '/api/public/catalog'];
const STORAGE_KEY = 'copetin-public-montage-v1';

const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const money = (value) => Number(Math.max(0, Number(value ?? 0)).toFixed(2));
const formatBs = (value) => `Bs ${money(value).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SLOT_DEFINITIONS = [
  { id: 'mantel', label: 'Mantel', keywords: ['mantel'], excludes: ['caminito', 'sobre mantel', 'sobremantel', 'muleton'] },
  { id: 'caminito', label: 'Caminito / sobremantel', keywords: ['caminito', 'camino', 'sobre mantel', 'sobremantel'] },
  { id: 'plaquet', label: 'Plaquet', keywords: ['plaquet'] },
  { id: 'servilleta', label: 'Servilleta', keywords: ['servilleta'] },
  { id: 'silla', label: 'Silla', keywords: ['silla'], excludes: ['cojin', 'cojín', 'capuchon', 'capuchón', 'cobertor'] },
  { id: 'cobertor', label: 'Cobertor / capuchón', keywords: ['cobertor', 'capuchon', 'capuchón'] },
  { id: 'cojin', label: 'Cojín', keywords: ['cojin', 'cojín'] },
  { id: 'centro', label: 'Centro de mesa', keywords: ['centro de mesa', 'arreglo', 'florero', 'candelabro', 'vela', 'portavela'] },
];

const tableTypes = [
  { id: 'round', label: 'Redonda', seats: 8 },
  { id: 'rect', label: 'Rectangular', seats: 10 },
  { id: 'square', label: 'Cuadrada', seats: 8 },
];

const productHaystack = (item) => normalizeText([item?.name, item?.category, item?.color, item?.material, item?.areaLabel].join(' '));

const belongsToSlot = (item, slot) => {
  if (!item || item.kind === 'combo') return false;
  const haystack = productHaystack(item);
  if (slot.excludes?.some((word) => haystack.includes(normalizeText(word)))) return false;
  return slot.keywords.some((word) => haystack.includes(normalizeText(word)));
};

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

function SceneAsset({ item, className = '', alt = '' }) {
  if (!item?.imageUrl) return null;
  return <img className={className} src={item.imageUrl} alt={alt || item.name} draggable="false" />;
}

function MontageScene({ selections, tableType, view }) {
  const seats = tableType.seats;
  const chairs = Array.from({ length: Math.min(seats, 8) }, (_, index) => index);
  const places = Array.from({ length: Math.min(seats, 8) }, (_, index) => index);

  if (view === 'place') {
    return (
      <div className="montage-scene montage-scene--place">
        <div className="montage-place-surface">
          <SceneAsset item={selections.mantel} className="montage-texture montage-texture--mantel" />
          <SceneAsset item={selections.caminito} className="montage-texture montage-texture--runner" />
          <div className="montage-place-setting">
            <SceneAsset item={selections.plaquet} className="montage-place-plaquet" />
            {!selections.plaquet?.imageUrl ? <div className="montage-fallback-plate" /> : null}
            <SceneAsset item={selections.servilleta} className="montage-place-servilleta" />
          </div>
        </div>
        <div className="montage-place-chair">
          <SceneAsset item={selections.silla} className="montage-place-chair-base" />
          <SceneAsset item={selections.cobertor} className="montage-place-chair-cover" />
          <SceneAsset item={selections.cojin} className="montage-place-chair-cushion" />
        </div>
      </div>
    );
  }

  if (view === 'top') {
    return (
      <div className="montage-scene montage-scene--top">
        <div className={`montage-table montage-table--top montage-table--${tableType.id}`}>
          <SceneAsset item={selections.mantel} className="montage-texture montage-texture--mantel" />
          <SceneAsset item={selections.caminito} className="montage-texture montage-texture--runner" />
          {places.map((index) => (
            <div key={index} className={`montage-top-place montage-pos-${index + 1}`}>
              <SceneAsset item={selections.plaquet} className="montage-mini-plaquet" />
              {!selections.plaquet?.imageUrl ? <div className="montage-fallback-plate" /> : null}
              <SceneAsset item={selections.servilleta} className="montage-mini-servilleta" />
            </div>
          ))}
          <SceneAsset item={selections.centro} className="montage-centerpiece" />
        </div>
      </div>
    );
  }

  return (
    <div className="montage-scene montage-scene--main">
      <div className="montage-room-backdrop" />
      <div className={`montage-table montage-table--main montage-table--${tableType.id}`}>
        <SceneAsset item={selections.mantel} className="montage-texture montage-texture--mantel" />
        <SceneAsset item={selections.caminito} className="montage-texture montage-texture--runner" />
        {places.slice(0, 6).map((index) => (
          <div key={index} className={`montage-main-place montage-main-place-${index + 1}`}>
            <SceneAsset item={selections.plaquet} className="montage-mini-plaquet" />
            {!selections.plaquet?.imageUrl ? <div className="montage-fallback-plate" /> : null}
            <SceneAsset item={selections.servilleta} className="montage-mini-servilleta" />
          </div>
        ))}
        <SceneAsset item={selections.centro} className="montage-centerpiece" />
      </div>
      <div className="montage-chairs-ring">
        {chairs.slice(0, 6).map((index) => (
          <div key={index} className={`montage-chair montage-chair-${index + 1}`}>
            <SceneAsset item={selections.silla} className="montage-chair-base" />
            <SceneAsset item={selections.cobertor} className="montage-chair-cover" />
            <SceneAsset item={selections.cojin} className="montage-chair-cushion" />
          </div>
        ))}
      </div>
      <span className="montage-scene-note">Vista referencial con tus productos reales</span>
    </div>
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
            const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
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

  const tableType = tableTypes.find((entry) => entry.id === tableTypeId) ?? tableTypes[0];
  const activeDefinition = SLOT_DEFINITIONS.find((slot) => slot.id === activeSlot) ?? SLOT_DEFINITIONS[0];

  const candidatesBySlot = useMemo(() => {
    const result = {};
    SLOT_DEFINITIONS.forEach((slot) => {
      result[slot.id] = catalog.products.filter((item) => belongsToSlot(item, slot));
    });
    return result;
  }, [catalog.products]);

  const activeCandidates = useMemo(() => {
    const normalizedQuery = normalizeText(slotQuery);
    return (candidatesBySlot[activeSlot] ?? []).filter((item) => (
      !normalizedQuery || productHaystack(item).includes(normalizedQuery)
    ));
  }, [activeSlot, candidatesBySlot, slotQuery]);

  const selectedRows = SLOT_DEFINITIONS
    .map((slot) => ({ slot, item: selections[slot.id] }))
    .filter((entry) => entry.item);

  const estimatedTotal = selectedRows.reduce((sum, { slot, item }) => {
    const qty = ['plaquet', 'servilleta', 'silla', 'cobertor', 'cojin'].includes(slot.id) ? tableType.seats : 1;
    return sum + (money(item.rentalPriceBs) * qty);
  }, 0);

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
    const lines = selectedRows.map(({ slot, item }) => {
      const qty = ['plaquet', 'servilleta', 'silla', 'cobertor', 'cojin'].includes(slot.id) ? tableType.seats : 1;
      return `${slot.label}: ${item.name} x${qty} (Cod. ${item.sku})`;
    });
    const text = [
      'EL COPETÍN - SOLICITUD DE MONTADO',
      `Mesa: ${tableType.label} / ${tableType.seats} puestos`,
      ...lines,
      `Estimado referencial: ${formatBs(estimatedTotal)}`,
      'Solicito confirmar disponibilidad y cotización.',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      window.alert('Combinación copiada. Puedes pegarla en WhatsApp o enviarla al equipo de El Copetín.');
    } catch {
      window.prompt('Copia esta combinación para enviarla a El Copetín:', text);
    }
  };

  return (
    <main className="public-catalog-page public-montage-page">
      <section className="public-montage-hero">
        <div>
          <span>El Copetín</span>
          <h1>Crear montado</h1>
          <p>Combina productos reales del catálogo y visualiza tu propuesta antes de solicitar una cotización.</p>
        </div>
        <div className="public-montage-hero-actions">
          <a href="/catalogo">← Volver al catálogo</a>
          <strong>{catalog.products.length.toLocaleString('es-BO')} productos reales cargados</strong>
        </div>
      </section>

      {loading ? <div className="public-catalog-state">Cargando productos para el montado...</div> : null}
      {error ? <div className="public-catalog-state public-catalog-state--error">{error}</div> : null}

      {!loading && !error ? (
        <div className="public-montage-workspace">
          <aside className="public-montage-controls">
            <div className="montage-control-heading">
              <span>1. Base del montaje</span>
              <strong>Tipo de mesa</strong>
            </div>
            <div className="montage-table-types">
              {tableTypes.map((type) => (
                <button key={type.id} type="button" className={tableTypeId === type.id ? 'is-active' : ''} onClick={() => setTableTypeId(type.id)}>
                  <span className={`montage-table-icon montage-table-icon--${type.id}`} />
                  {type.label}
                  <small>{type.seats} puestos</small>
                </button>
              ))}
            </div>

            <div className="montage-control-heading">
              <span>2. Productos</span>
              <strong>Elige tus combinaciones</strong>
            </div>

            <div className="montage-slot-tabs">
              {SLOT_DEFINITIONS.map((slot) => {
                const selected = selections[slot.id];
                return (
                  <button key={slot.id} type="button" className={activeSlot === slot.id ? 'is-active' : ''} onClick={() => { setActiveSlot(slot.id); setSlotQuery(''); }}>
                    <span>{slot.label}</span>
                    <small>{selected ? selected.name : `${(candidatesBySlot[slot.id] ?? []).length} opciones`}</small>
                  </button>
                );
              })}
            </div>

            <div className="montage-product-picker">
              <div className="montage-product-picker-head">
                <div>
                  <strong>{activeDefinition.label}</strong>
                  <span>{activeCandidates.length} productos disponibles en catálogo</span>
                </div>
                {selections[activeSlot] ? <button type="button" onClick={() => setSelections((current) => ({ ...current, [activeSlot]: null }))}>Quitar</button> : null}
              </div>
              <input value={slotQuery} onChange={(event) => setSlotQuery(event.target.value)} placeholder={`Buscar ${activeDefinition.label.toLowerCase()}...`} />
              <div className="montage-product-strip">
                {activeCandidates.slice(0, 80).map((item) => (
                  <ProductThumb
                    key={item.id}
                    item={item}
                    selected={selections[activeSlot]?.id === item.id}
                    onClick={() => setSelections((current) => ({ ...current, [activeSlot]: item }))}
                  />
                ))}
                {!activeCandidates.length ? <p>No encontramos productos para esta familia con el filtro actual.</p> : null}
              </div>
            </div>
          </aside>

          <section className="public-montage-preview">
            <header className="montage-preview-header">
              <div>
                <span>Vista del montado</span>
                <strong>Los cambios se reflejan al instante</strong>
              </div>
              <div className="montage-view-tabs">
                <button type="button" className={view === 'main' ? 'is-active' : ''} onClick={() => setView('main')}>Principal</button>
                <button type="button" className={view === 'top' ? 'is-active' : ''} onClick={() => setView('top')}>Superior</button>
                <button type="button" className={view === 'place' ? 'is-active' : ''} onClick={() => setView('place')}>Puesto individual</button>
              </div>
            </header>

            <MontageScene selections={selections} tableType={tableType} view={view} />

            <div className="montage-preview-foot">
              <span>La composición es referencial: usa las fotos reales de tus productos para comparar color, diseño y estilo.</span>
              <button type="button" onClick={clearMontage}>Limpiar montaje</button>
            </div>
          </section>

          <aside className="public-montage-summary-panel">
            <header>
              <span>Resumen del montado</span>
              <strong>{tableType.label} · {tableType.seats} puestos</strong>
            </header>
            <div className="montage-summary-list">
              {selectedRows.length ? selectedRows.map(({ slot, item }) => {
                const qty = ['plaquet', 'servilleta', 'silla', 'cobertor', 'cojin'].includes(slot.id) ? tableType.seats : 1;
                return (
                  <div key={slot.id}>
                    <span className="montage-summary-image">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : 'EC'}</span>
                    <p><small>{slot.label}</small><strong>{item.name}</strong><em>Cod. {item.sku}</em></p>
                    <b>x{qty}</b>
                  </div>
                );
              }) : <p className="montage-empty-summary">Selecciona productos para armar tu propuesta.</p>}
            </div>
            <div className="montage-estimate">
              <span>Estimado referencial</span>
              <strong>{formatBs(estimatedTotal)}</strong>
              <small>Usa precios actuales del inventario. La disponibilidad final se confirma por fecha.</small>
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
