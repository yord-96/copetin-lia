import { useEffect, useState } from 'react';
import { api } from '../../../services/api';
import LinconIcon from '../shared/LinconIcon';
import '../styles/lincoln-packages.css';

const CATEGORY_OPTIONS = ['CATERING', 'BEBIDAS', 'MONTAJE', 'SONIDO', 'PERSONAL', 'SALÓN', 'OTROS'];
const SOURCE_OPTIONS = [
  { value: 'internal', label: 'Interno Lincoln' },
  { value: 'external', label: 'Externo / proveedor' },
];
const COST_MODE_OPTIONS = [
  { value: 'per_person', label: 'Por persona' },
  { value: 'fixed_event', label: 'Fijo por evento' },
];
const EVENT_TYPES = ['BODA', '15 AÑOS', 'CUMPLEAÑOS', 'EVENTO CORPORATIVO', 'OTRO'];

const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const money = (value) => new Intl.NumberFormat('es-BO', { style: 'currency', currency: 'BOB', minimumFractionDigits: 2 }).format(Number(value ?? 0));
const normalize = (value) => String(value ?? '').trim().toLowerCase();

const blankLine = () => ({
  id: uid('line'), category: 'CATERING', sourceType: 'internal', description: '', quantity: 1,
  unit: 'SERVICIO', costMode: 'fixed_event', unitCostBs: 0, supplierId: '', supplierName: '',
  included: true, notes: '', variantIds: [], catalogId: '', catalogKind: '',
});
const blankVariant = (name = '') => ({ id: uid('variant'), name, pricePerPersonBs: 0, minimumGuests: 0, status: 'active' });
const normalizePackageForm = (record) => {
  const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const variants = Array.isArray(source.variants) && source.variants.length
    ? source.variants.map((variant) => ({ ...blankVariant(), ...variant, id: variant.id || uid('variant') }))
    : source.id ? [blankVariant(source.name || 'BASE')] : [];
  return {
    id: source.id ?? '', code: source.code ?? '', name: source.name ?? '', familyName: source.familyName ?? source.name ?? '',
    roomId: source.roomId ?? '', roomName: source.roomName ?? '', segment: source.segment ?? '',
    eventTypes: Array.isArray(source.eventTypes) ? source.eventTypes : [], minimumGuests: Number(source.minimumGuests ?? 0),
    pricePerPersonBs: Number(source.pricePerPersonBs ?? 0), status: source.status === 'inactive' ? 'inactive' : 'active',
    description: source.description ?? '', images: Array.isArray(source.images) ? source.images : [], variants,
    serviceLines: Array.isArray(source.serviceLines) ? source.serviceLines.map((line) => ({ ...blankLine(), ...line, id: line?.id || uid('line'), variantIds: Array.isArray(line?.variantIds) ? line.variantIds : [] })) : [],
  };
};

function Metric({ icon, value, label, tone = 'wine' }) {
  return <article className={`lincoln-package-metric is-${tone}`}><span><LinconIcon name={icon} /></span><div><strong>{value}</strong><small>{label}</small></div></article>;
}

function CatalogModal({ kind, record, suppliers, revision, actor, onClose, onSaved }) {
  const isEdit = Boolean(record?.id);
  const [form, setForm] = useState(() => ({
    name: record?.name ?? record?.description ?? '', description: record?.description ?? record?.name ?? '',
    category: record?.category ?? (kind === 'extra' ? 'OTROS' : 'CATERING'), sourceType: record?.sourceType === 'external' ? 'external' : 'internal',
    costMode: record?.costMode === 'per_person' ? 'per_person' : 'fixed_event', unit: record?.unit ?? 'SERVICIO',
    unitCostBs: Number(record?.unitCostBs ?? 0), supplierId: record?.supplierId ?? '', supplierName: record?.supplierName ?? '',
    status: record?.status === 'inactive' ? 'inactive' : 'active', notes: record?.notes ?? '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (!form.description.trim()) return setError('La descripción es obligatoria.');
    setSaving(true); setError('');
    try {
      const supplier = suppliers.find((item) => item.id === form.supplierId);
      const payload = { ...form, name: form.name.trim() || form.description.trim(), description: form.description.trim(), unitCostBs: Math.max(0, Number(form.unitCostBs || 0)), supplierId: form.sourceType === 'external' ? form.supplierId : '', supplierName: form.sourceType === 'external' ? (supplier?.name || form.supplierName || '') : '' };
      const collection = kind === 'extra' ? 'packageExtras' : 'packageServices';
      if (isEdit) await api.lincoln.updateRecord({ collection, id: record.id, record: payload, revision, actor });
      else await api.lincoln.createRecord({ collection, record: payload, revision, actor });
      await onSaved();
    } catch (saveError) { setError(saveError?.message || 'No se pudo guardar.'); }
    finally { setSaving(false); }
  };
  return <div className="lincoln-package-modal-backdrop"><section className="lincoln-package-modal is-compact"><form onSubmit={submit}>
    <header><div><span>{kind === 'extra' ? 'Catálogo de extras' : 'Catálogo de servicios'}</span><h2>{isEdit ? 'Editar' : 'Nuevo'} {kind === 'extra' ? 'extra' : 'servicio'}</h2><p>Elemento reutilizable para las plantillas de Lincoln.</p></div><button type="button" className="is-close" onClick={onClose}>×</button></header>
    {error ? <div className="lincoln-package-error">{error}</div> : null}
    <div className="lincoln-package-form-grid">
      <label className="is-wide"><span>Nombre corto</span><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej. Gaseosas barra libre" /></label>
      <label className="is-wide"><span>Descripción comercial</span><textarea required value={form.description} onChange={(e) => set('description', e.target.value)} /></label>
      <label><span>Categoría</span><select value={form.category} onChange={(e) => set('category', e.target.value)}>{CATEGORY_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label><span>Origen</span><select value={form.sourceType} onChange={(e) => set('sourceType', e.target.value)}>{SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label><span>Costeo</span><select value={form.costMode} onChange={(e) => set('costMode', e.target.value)}>{COST_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label><span>Unidad</span><input value={form.unit} onChange={(e) => set('unit', e.target.value)} /></label>
      <label><span>Costo base Bs</span><input type="number" min="0" step="0.01" value={form.unitCostBs} onChange={(e) => set('unitCostBs', e.target.value)} /></label>
      {form.sourceType === 'external' ? <label><span>Proveedor</span><select value={form.supplierId} onChange={(e) => set('supplierId', e.target.value)}><option value="">Sin proveedor definido</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label> : null}
      <label><span>Estado</span><select value={form.status} onChange={(e) => set('status', e.target.value)}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>
      <label className="is-wide"><span>Notas internas</span><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
    </div>
    <footer><button type="button" className="is-secondary" onClick={onClose}>Cancelar</button><button type="submit" className="is-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button></footer>
  </form></section></div>;
}

function PackageModal({ record, rooms, services, extras, revision, actor, onClose, onSaved }) {
  const [form, setForm] = useState(() => normalizePackageForm(record));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const isEdit = Boolean(record?.id);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const variants = Array.isArray(form.variants) ? form.variants : [];

  const packageCost = (() => {
    const lines = form.serviceLines ?? [];
    const variablePerPerson = lines.reduce((total, line) => line.costMode === 'per_person' ? total + Number(line.quantity || 1) * Number(line.unitCostBs || 0) : total, 0);
    const fixedEvent = lines.reduce((total, line) => line.costMode === 'fixed_event' ? total + Number(line.quantity || 1) * Number(line.unitCostBs || 0) : total, 0);
    const prices = variants.length ? variants.map((v) => Number(v.pricePerPersonBs || 0)) : [Number(form.pricePerPersonBs || 0)];
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const revenueMin = minPrice * Number(form.minimumGuests || 0);
    const costMin = variablePerPerson * Number(form.minimumGuests || 0) + fixedEvent;
    return { variablePerPerson, fixedEvent, revenueMin, costMin, marginMin: revenueMin - costMin };
  })();

  const updateVariant = (id, patch) => setForm((current) => ({ ...current, variants: current.variants.map((v) => v.id === id ? { ...v, ...patch } : v) }));
  const updateLine = (id, patch) => setForm((current) => ({ ...current, serviceLines: current.serviceLines.map((line) => line.id === id ? { ...line, ...patch } : line) }));
  const addCatalogLine = (item) => setForm((current) => ({ ...current, serviceLines: [...current.serviceLines, { ...blankLine(), category: item.category, sourceType: item.sourceType, description: item.description, unit: item.unit, costMode: item.costMode, unitCostBs: item.unitCostBs, supplierId: item.supplierId, supplierName: item.supplierName, catalogId: item.id, catalogKind: item.kind }] }));
  const catalog = [...services, ...extras].filter((item) => item.status !== 'inactive' && (!catalogQuery.trim() || [item.name, item.description, item.category, item.supplierName].some((v) => normalize(v).includes(normalize(catalogQuery))))).slice(0, 20);

  const handleUpload = async (event) => {
    const files = [...(event.target.files ?? [])]; event.target.value = ''; if (!files.length) return;
    if ((form.images?.length ?? 0) + files.length > 6) return setError('Puedes guardar hasta 6 imágenes por paquete.');
    setUploading(true); setError('');
    try {
      const uploaded = [];
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024) throw new Error('Cada imagen debe pesar máximo 8 MB.');
        const result = await api.uploads.packageImage(file, { packageId: form.id || form.code || form.name || 'package' });
        uploaded.push({ imageUrl: result.imageUrl, filename: result.filename, mimeType: result.mimeType, bytes: result.bytes });
      }
      setForm((current) => ({ ...current, images: [...current.images, ...uploaded] }));
    } catch (uploadError) { setError(uploadError?.message || 'No se pudo subir la imagen.'); }
    finally { setUploading(false); }
  };
  const removeImage = async (image) => {
    try { if (image?.filename) await api.uploads.deletePackageImage({ filename: image.filename }); setForm((current) => ({ ...current, images: current.images.filter((item) => item.filename !== image.filename) })); }
    catch (deleteError) { setError(deleteError?.message || 'No se pudo eliminar la imagen.'); }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return setError('El nombre de la plantilla es obligatorio.');
    if (!variants.length) return setError('Agrega al menos una variante o nivel de precio.');
    if (variants.some((variant) => !String(variant.name ?? '').trim())) return setError('Todas las variantes deben tener nombre.');
    if (form.serviceLines.some((line) => !String(line.description ?? '').trim())) return setError('Todo servicio agregado debe tener descripción.');
    setSaving(true); setError('');
    try {
      const room = rooms.find((item) => item.id === form.roomId);
      const normalizedVariants = variants.map((variant) => ({ ...variant, pricePerPersonBs: Math.max(0, Number(variant.pricePerPersonBs || 0)), minimumGuests: Math.max(0, Number(variant.minimumGuests || form.minimumGuests || 0)) }));
      const payload = {
        ...form, roomName: room?.name ?? '', minimumGuests: Math.max(0, Number(form.minimumGuests || 0)),
        pricePerPersonBs: normalizedVariants[0]?.pricePerPersonBs ?? 0, variants: normalizedVariants,
        serviceLines: form.serviceLines.map((line) => ({ ...line, quantity: Math.max(0, Number(line.quantity || 0)), unitCostBs: Math.max(0, Number(line.unitCostBs || 0)), variantIds: Array.isArray(line.variantIds) ? line.variantIds : [] })),
        servicesText: form.serviceLines.map((line) => line.description).filter(Boolean).join('\n'),
      };
      if (isEdit) await api.lincoln.updateRecord({ collection: 'packages', id: record.id, record: payload, revision, actor });
      else await api.lincoln.createRecord({ collection: 'packages', record: payload, revision, actor });
      await onSaved();
    } catch (saveError) { setError(saveError?.message || 'No se pudo guardar el paquete.'); }
    finally { setSaving(false); }
  };

  return <div className="lincoln-package-modal-backdrop"><section className="lincoln-package-modal"><form onSubmit={submit}>
    <header><div><span>Plantilla comercial híbrida</span><h2>{isEdit ? 'Editar plantilla' : 'Nueva plantilla'}</h2><p>Define variantes, matriz de servicios y costos. Los contratos futuros podrán congelar una copia independiente.</p></div><button type="button" className="is-close" onClick={onClose}>×</button></header>
    {error ? <div className="lincoln-package-error">{error}</div> : null}
    <div className="lincoln-package-form-grid">
      <label className="is-wide"><span>Nombre de la familia / plantilla</span><input required value={form.name} onChange={(e) => { set('name', e.target.value); if (!form.familyName) set('familyName', e.target.value); }} placeholder="Ej. SALÓN GRANDE · BODAS" /></label>
      <label><span>Salón</span><select value={form.roomId} onChange={(e) => set('roomId', e.target.value)}><option value="">Todos / no específico</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
      <label><span>Mínimo general</span><input type="number" min="0" value={form.minimumGuests} onChange={(e) => set('minimumGuests', Number(e.target.value))} /></label>
      <label><span>Segmento</span><input value={form.segment} onChange={(e) => set('segment', e.target.value)} placeholder="Ej. Bodas / 15 años" /></label>
      <label><span>Estado</span><select value={form.status} onChange={(e) => set('status', e.target.value)}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>
      <label className="is-wide"><span>Tipos de evento</span><div className="lincoln-package-checks">{EVENT_TYPES.map((type) => <button type="button" key={type} className={form.eventTypes.includes(type) ? 'is-active' : ''} onClick={() => set('eventTypes', form.eventTypes.includes(type) ? form.eventTypes.filter((x) => x !== type) : [...form.eventTypes, type])}>{type}</button>)}</div></label>
      <label className="is-wide"><span>Descripción comercial</span><textarea value={form.description} onChange={(e) => set('description', e.target.value)} /></label>
    </div>

    <section className="lincoln-package-builder-section"><div className="lincoln-package-editor-title"><div><strong>1. Variantes y precios</strong><small>Cobre / Plata / Oro / Platino, o Jóvenes / Adultos dentro de una misma familia.</small></div><button type="button" onClick={() => set('variants', [...variants, blankVariant()])}>+ Variante</button></div>
      <div className="lincoln-package-variants-editor">{variants.map((variant) => <article key={variant.id}><input value={variant.name} onChange={(e) => updateVariant(variant.id, { name: e.target.value })} placeholder="Nombre" /><label><span>Bs/persona</span><input type="number" min="0" step="0.01" value={variant.pricePerPersonBs} onChange={(e) => updateVariant(variant.id, { pricePerPersonBs: e.target.value })} /></label><label><span>Mínimo</span><input type="number" min="0" value={variant.minimumGuests} onChange={(e) => updateVariant(variant.id, { minimumGuests: e.target.value })} /></label><button type="button" onClick={() => set('variants', variants.filter((v) => v.id !== variant.id))}>×</button></article>)}</div>
    </section>

    <section className="lincoln-package-builder-section"><div className="lincoln-package-editor-title"><div><strong>2. Catálogo reutilizable</strong><small>Busca servicios o extras existentes y agrégalos a la matriz.</small></div></div>
      <input className="lincoln-package-catalog-search" value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder="Buscar catering, bebidas, montaje, extra..." />
      <div className="lincoln-package-catalog-picker">{catalog.map((item) => <button type="button" key={`${item.kind}-${item.id}`} onClick={() => addCatalogLine(item)}><span className={`is-${item.kind}`}>{item.kind === 'extra' ? 'EXTRA' : item.category}</span><strong>{item.name || item.description}</strong><small>{money(item.unitCostBs)} · {item.costMode === 'per_person' ? 'por persona' : 'por evento'}</small></button>)}{!catalog.length ? <small>No hay coincidencias. Puedes agregar una línea manual.</small> : null}</div>
    </section>

    <section className="lincoln-package-builder-section"><div className="lincoln-package-editor-title"><div><strong>3. Matriz de servicios</strong><small>Marca en qué variantes está incluido cada servicio. Sin marcas = incluido en todas.</small></div><button type="button" onClick={() => set('serviceLines', [...form.serviceLines, blankLine()])}>+ Línea manual</button></div>
      <div className="lincoln-package-matrix">{form.serviceLines.map((line) => <article key={line.id}>
        <div className="lincoln-package-line-main"><select value={line.category} onChange={(e) => updateLine(line.id, { category: e.target.value })}>{CATEGORY_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select><input value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} placeholder="Servicio / detalle" /></div>
        <div className="lincoln-package-line-cost"><select value={line.costMode} onChange={(e) => updateLine(line.id, { costMode: e.target.value })}>{COST_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><input type="number" min="0" step="0.01" value={line.unitCostBs} onChange={(e) => updateLine(line.id, { unitCostBs: e.target.value })} /></div>
        <div className="lincoln-package-line-variants">{variants.map((variant) => <label key={variant.id}><input type="checkbox" checked={line.variantIds.includes(variant.id)} onChange={() => updateLine(line.id, { variantIds: line.variantIds.includes(variant.id) ? line.variantIds.filter((id) => id !== variant.id) : [...line.variantIds, variant.id] })} /><span>{variant.name || 'Variante'}</span></label>)}</div>
        <button type="button" className="is-remove" onClick={() => set('serviceLines', form.serviceLines.filter((item) => item.id !== line.id))}>×</button>
      </article>)}{!form.serviceLines.length ? <div className="lincoln-package-services-empty">Aún no hay servicios en la matriz.</div> : null}</div>
    </section>

    <section className="lincoln-package-images-editor"><div className="lincoln-package-editor-title"><div><strong>Imagen y presentación</strong><small>Opcional; se guarda en servidor.</small></div><label className="lincoln-package-upload">{uploading ? 'Subiendo...' : '+ Imagen'}<input type="file" accept="image/*" multiple onChange={handleUpload} disabled={uploading} /></label></div><div className="lincoln-package-image-grid">{form.images.map((image) => <figure key={image.filename || image.imageUrl}><img src={image.imageUrl} alt="Paquete" /><button type="button" onClick={() => removeImage(image)}>×</button></figure>)}</div></section>
    <section className="lincoln-package-cost-preview"><article><span>Costo variable / persona</span><strong>{money(packageCost.variablePerPerson)}</strong></article><article><span>Costos fijos / evento</span><strong>{money(packageCost.fixedEvent)}</strong></article><article><span>Ingreso mínimo estimado</span><strong>{money(packageCost.revenueMin)}</strong></article><article className={packageCost.marginMin < 0 ? 'is-negative' : 'is-positive'}><span>Margen estimado</span><strong>{money(packageCost.marginMin)}</strong></article></section>
    <footer><button type="button" className="is-secondary" onClick={onClose}>Cancelar</button><button type="submit" className="is-primary" disabled={saving || uploading}>{saving ? 'Guardando...' : 'Guardar plantilla'}</button></footer>
  </form></section></div>;
}

function CatalogView({ kind, rows, query, setQuery, onNew, onEdit }) {
  const filtered = rows.filter((row) => !query.trim() || [row.name, row.description, row.category, row.supplierName].some((value) => normalize(value).includes(normalize(query))));
  return <section className="lincoln-package-catalog-view"><div className="lincoln-packages-filters"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Buscar ${kind === 'extra' ? 'extra' : 'servicio'}, categoría o proveedor...`} /><button type="button" onClick={onNew}>+ Nuevo {kind === 'extra' ? 'extra' : 'servicio'}</button></div><div className="lincoln-package-catalog-table"><div className="is-head"><span>Categoría</span><span>Descripción</span><span>Origen</span><span>Costeo</span><span>Costo base</span><span>Estado</span><span /></div>{filtered.map((row) => <button type="button" key={row.id} onClick={() => onEdit(row)}><span><b>{row.category}</b></span><span><strong>{row.name || row.description}</strong><small>{row.description !== row.name ? row.description : ''}</small></span><span>{row.sourceType === 'external' ? (row.supplierName || 'Proveedor') : 'Lincoln'}</span><span>{row.costMode === 'per_person' ? 'Por persona' : 'Por evento'}</span><span>{money(row.unitCostBs)}</span><span className={`is-status is-${row.status}`}>{row.status === 'inactive' ? 'Inactivo' : 'Activo'}</span><span>Editar</span></button>)}{!filtered.length ? <div className="lincoln-packages-empty">No hay registros que coincidan.</div> : null}</div></section>;
}

export default function LincolnPackages({ revision, actor, refreshKey, onRefresh }) {
  const [activeTab, setActiveTab] = useState('templates');
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('all'); const [roomId, setRoomId] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [data, setData] = useState({ summary: {}, rows: [], rooms: [], suppliers: [], services: [], extras: [] });
  const [error, setError] = useState(''); const [modal, setModal] = useState(null); const [loading, setLoading] = useState(true); const [localRefresh, setLocalRefresh] = useState(0);
  useEffect(() => { let cancelled = false; api.lincoln.getPackagesOverview({ query: activeTab === 'templates' ? query : '', status, roomId }).then((response) => { if (!cancelled) { setData(response ?? {}); setError(''); } }).catch((requestError) => { if (!cancelled) setError(requestError?.message || 'No se pudo cargar Paquetes Lincoln.'); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [activeTab, localRefresh, query, refreshKey, roomId, status]);
  const refresh = async () => { setModal(null); setLoading(true); setLocalRefresh((value) => value + 1); await onRefresh?.(); };
  const rows = Array.isArray(data.rows) ? data.rows : []; const rooms = Array.isArray(data.rooms) ? data.rooms : []; const suppliers = Array.isArray(data.suppliers) ? data.suppliers : []; const services = Array.isArray(data.services) ? data.services : []; const extras = Array.isArray(data.extras) ? data.extras : []; const summary = data.summary ?? {};
  return <div className="lincoln-packages-view">
    <header className="lincoln-packages-heading"><div><h1>Paquetes</h1><p>Plantillas, matriz de servicios y extras reutilizables para construir propuestas comerciales sin perder el histórico.</p></div>{activeTab === 'templates' ? <button type="button" onClick={() => setModal({ type: 'package', record: null })}>+ Nueva plantilla</button> : null}</header>
    <section className="lincoln-package-metrics"><Metric icon="star" value={summary.totalPackages ?? 0} label="Plantillas" /><Metric icon="calendar" value={summary.activePackages ?? 0} label="Plantillas activas" tone="green" /><Metric icon="files" value={summary.totalServices ?? 0} label="Servicios catálogo" tone="blue" /><Metric icon="users" value={summary.totalExtras ?? 0} label="Extras catálogo" tone="gold" /></section>
    <nav className="lincoln-package-tabs"><button type="button" className={activeTab === 'templates' ? 'is-active' : ''} onClick={() => setActiveTab('templates')}>Plantillas</button><button type="button" className={activeTab === 'services' ? 'is-active' : ''} onClick={() => setActiveTab('services')}>Servicios</button><button type="button" className={activeTab === 'extras' ? 'is-active' : ''} onClick={() => setActiveTab('extras')}>Extras</button></nav>
    {error ? <div className="lincoln-package-error">{error}</div> : null}
    {activeTab === 'templates' ? <><section className="lincoln-packages-filters"><input value={query} onChange={(e) => { setLoading(true); setQuery(e.target.value); }} placeholder="Buscar plantilla, variante, servicio, salón..." /><select value={roomId} onChange={(e) => { setLoading(true); setRoomId(e.target.value); }}><option value="">Todos los salones</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select><select value={status} onChange={(e) => { setLoading(true); setStatus(e.target.value); }}><option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></section><section className="lincoln-package-card-grid">{!loading && !rows.length ? <div className="lincoln-packages-empty">No hay plantillas que coincidan con estos filtros.</div> : null}{rows.map((pkg) => <article key={pkg.id} className="lincoln-package-card"><div className="lincoln-package-cover">{pkg.images?.[0]?.imageUrl ? <img src={pkg.images[0].imageUrl} alt={pkg.name} /> : <div><LinconIcon name="star" /><span>Plantilla Lincoln</span></div>}<span className={`lincoln-package-state is-${pkg.status}`}>{pkg.status === 'inactive' ? 'Inactivo' : 'Activo'}</span></div><div className="lincoln-package-card-body"><div className="lincoln-package-card-title"><div><small>{pkg.code}</small><h3>{pkg.name}</h3><p>{pkg.roomName || 'Todos los salones'}{pkg.eventTypes?.length ? ` · ${pkg.eventTypes.join(', ')}` : ''}</p></div><button type="button" onClick={() => setModal({ type: 'package', record: pkg })}>Editar</button></div><div className="lincoln-package-variant-chips">{pkg.variants?.map((variant) => <span key={variant.id}><b>{variant.name}</b><strong>{money(variant.pricePerPersonBs)}</strong><small>/persona</small></span>)}</div><div className="lincoln-package-service-summary"><span><b>{pkg.serviceCount}</b> servicios</span><span><b>{pkg.internalServices}</b> internos</span><span><b>{pkg.externalServices}</b> externos</span><span><b>{pkg.minimumGuests}</b> mínimo</span></div><div className="lincoln-package-services-preview">{pkg.serviceLines.slice(0, 5).map((line) => <span key={line.id}><i className={`is-${line.catalogKind === 'extra' ? 'extra' : line.sourceType}`} /><b>{line.category}</b>{line.description}</span>)}{pkg.serviceLines.length > 5 ? <small>+ {pkg.serviceLines.length - 5} más</small> : null}</div></div></article>)}</section></> : null}
    {activeTab === 'services' ? <CatalogView kind="service" rows={services} query={catalogQuery} setQuery={setCatalogQuery} onNew={() => setModal({ type: 'service', record: null })} onEdit={(record) => setModal({ type: 'service', record })} /> : null}
    {activeTab === 'extras' ? <CatalogView kind="extra" rows={extras} query={catalogQuery} setQuery={setCatalogQuery} onNew={() => setModal({ type: 'extra', record: null })} onEdit={(record) => setModal({ type: 'extra', record })} /> : null}
    {modal?.type === 'package' ? <PackageModal record={modal.record} rooms={rooms} suppliers={suppliers} services={services} extras={extras} revision={revision} actor={actor} onClose={() => setModal(null)} onSaved={refresh} /> : null}
    {['service', 'extra'].includes(modal?.type) ? <CatalogModal kind={modal.type} record={modal.record} suppliers={suppliers} revision={revision} actor={actor} onClose={() => setModal(null)} onSaved={refresh} /> : null}
  </div>;
}
