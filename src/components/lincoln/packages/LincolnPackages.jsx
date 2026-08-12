import { useEffect, useMemo, useState } from 'react';
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

const money = (value) => new Intl.NumberFormat('es-BO', {
  style: 'currency',
  currency: 'BOB',
  minimumFractionDigits: 2,
}).format(Number(value ?? 0));

const blankLine = () => ({
  id: `line-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  category: 'CATERING',
  sourceType: 'internal',
  description: '',
  quantity: 1,
  unit: 'SERVICIO',
  costMode: 'fixed_event',
  unitCostBs: 0,
  supplierId: '',
  supplierName: '',
  included: true,
  notes: '',
});

const normalizePackageForm = (record) => {
  const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  return {
    id: source.id ?? '',
    code: source.code ?? '',
    name: source.name ?? '',
    roomId: source.roomId ?? '',
    roomName: source.roomName ?? '',
    segment: source.segment ?? '',
    minimumGuests: Number(source.minimumGuests ?? 0),
    pricePerPersonBs: Number(source.pricePerPersonBs ?? 0),
    status: source.status === 'inactive' ? 'inactive' : 'active',
    description: source.description ?? '',
    images: Array.isArray(source.images) ? source.images : [],
    serviceLines: Array.isArray(source.serviceLines) && source.serviceLines.length
      ? source.serviceLines.map((line) => {
        const fallback = blankLine();
        return { ...fallback, ...line, id: line?.id || fallback.id };
      })
      : [],
  };
};

function Metric({ icon, value, label, tone = 'wine' }) {
  return (
    <article className={`lincoln-package-metric is-${tone}`}>
      <span><LinconIcon name={icon} /></span>
      <div><strong>{value}</strong><small>{label}</small></div>
    </article>
  );
}

function PackageModal({ record, rooms, suppliers, revision, actor, onClose, onSaved }) {
  const [form, setForm] = useState(() => normalizePackageForm(record));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const isEdit = Boolean(record?.id);

  const packageCost = useMemo(() => {
    const lines = Array.isArray(form.serviceLines) ? form.serviceLines : [];
    const variablePerPerson = lines.reduce((total, line) => (
      line.costMode === 'per_person'
        ? total + Number(line.quantity || 1) * Number(line.unitCostBs || 0)
        : total
    ), 0);
    const fixedEvent = lines.reduce((total, line) => (
      line.costMode === 'fixed_event'
        ? total + Number(line.quantity || 1) * Number(line.unitCostBs || 0)
        : total
    ), 0);
    const revenueMin = Number(form.pricePerPersonBs || 0) * Number(form.minimumGuests || 0);
    const costMin = variablePerPerson * Number(form.minimumGuests || 0) + fixedEvent;
    return {
      variablePerPerson,
      fixedEvent,
      revenueMin,
      costMin,
      marginMin: revenueMin - costMin,
    };
  }, [form.minimumGuests, form.pricePerPersonBs, form.serviceLines]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const updateLine = (lineId, patch) => {
    setForm((current) => ({
      ...current,
      serviceLines: current.serviceLines.map((line) => (
        line.id === lineId ? { ...line, ...patch } : line
      )),
    }));
  };

  const removeLine = (lineId) => {
    setForm((current) => ({
      ...current,
      serviceLines: current.serviceLines.filter((line) => line.id !== lineId),
    }));
  };

  const addLine = () => {
    setForm((current) => ({
      ...current,
      serviceLines: [...current.serviceLines, blankLine()],
    }));
  };

  const handleUpload = async (event) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!files.length) return;
    if ((form.images?.length ?? 0) + files.length > 6) {
      setError('Puedes guardar hasta 6 imágenes por paquete.');
      return;
    }

    setUploading(true);
    setError('');
    try {
      const uploaded = [];
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024) throw new Error('Cada imagen debe pesar máximo 8 MB.');
        const result = await api.uploads.packageImage(file, {
          packageId: form.id || form.code || form.name || 'package',
        });
        uploaded.push({
          imageUrl: result.imageUrl,
          filename: result.filename,
          mimeType: result.mimeType,
          bytes: result.bytes,
        });
      }
      setForm((current) => ({ ...current, images: [...current.images, ...uploaded] }));
    } catch (uploadError) {
      setError(uploadError?.message || 'No se pudo subir la imagen.');
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async (image) => {
    setError('');
    try {
      if (image?.filename) await api.uploads.deletePackageImage({ filename: image.filename });
      setForm((current) => ({
        ...current,
        images: current.images.filter((item) => item.filename !== image.filename),
      }));
    } catch (deleteError) {
      setError(deleteError?.message || 'No se pudo eliminar la imagen.');
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError('El nombre del paquete es obligatorio.');
      return;
    }

    const invalidLine = form.serviceLines.find((line) => !String(line.description ?? '').trim());
    if (invalidLine) {
      setError('Todo servicio agregado debe tener una descripción.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const room = rooms.find((item) => item.id === form.roomId);
      const payload = {
        ...form,
        roomName: room?.name ?? '',
        minimumGuests: Math.max(0, Number(form.minimumGuests ?? 0)),
        pricePerPersonBs: Math.max(0, Number(form.pricePerPersonBs ?? 0)),
        serviceLines: form.serviceLines.map((line) => {
          const supplier = suppliers.find((item) => item.id === line.supplierId);
          return {
            ...line,
            quantity: Math.max(0, Number(line.quantity ?? 0)),
            unitCostBs: Math.max(0, Number(line.unitCostBs ?? 0)),
            supplierId: line.sourceType === 'external' ? (line.supplierId || '') : '',
            supplierName: line.sourceType === 'external'
              ? (supplier?.name || line.supplierName || '')
              : '',
          };
        }),
        servicesText: form.serviceLines.map((line) => line.description).filter(Boolean).join('\n'),
      };

      if (isEdit) {
        await api.lincoln.updateRecord({
          collection: 'packages',
          id: record.id,
          record: payload,
          revision,
          actor,
        });
      } else {
        await api.lincoln.createRecord({
          collection: 'packages',
          record: payload,
          revision,
          actor,
        });
      }

      onSaved();
    } catch (saveError) {
      setError(saveError?.message || 'No se pudo guardar el paquete.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lincoln-package-modal-backdrop" role="presentation">
      <section className="lincoln-package-modal" role="dialog" aria-modal="true" aria-label="Paquete Lincoln">
        <form onSubmit={submit}>
          <header>
            <div>
              <span>Configuración comercial</span>
              <h2>{isEdit ? 'Editar paquete' : 'Nuevo paquete'}</h2>
              <p>Servicios, proveedores, costos y composición del paquete en un solo lugar.</p>
            </div>
            <button type="button" className="is-close" onClick={onClose}>×</button>
          </header>

          {error ? <div className="lincoln-package-error">{error}</div> : null}

          <div className="lincoln-package-form-grid">
            <label className="is-wide"><span>Nombre del paquete</span><input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej. PLATINO" /></label>
            <label><span>Salón</span><select value={form.roomId} onChange={(e) => set('roomId', e.target.value)}><option value="">Todos / no específico</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
            <label><span>Segmento</span><input value={form.segment} onChange={(e) => set('segment', e.target.value)} placeholder="Ej. Jóvenes y adultos" /></label>
            <label><span>Mínimo de personas</span><input type="number" min="0" value={form.minimumGuests} onChange={(e) => set('minimumGuests', Number(e.target.value))} /></label>
            <label><span>Precio Bs/persona</span><input type="number" min="0" step="0.01" value={form.pricePerPersonBs} onChange={(e) => set('pricePerPersonBs', Number(e.target.value))} /></label>
            <label><span>Estado</span><select value={form.status} onChange={(e) => set('status', e.target.value)}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>
            <label className="is-wide"><span>Descripción comercial</span><textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Qué caracteriza a este paquete..." /></label>
          </div>

          <section className="lincoln-package-images-editor">
            <div className="lincoln-package-editor-title">
              <div><strong>Imagen y presentación</strong><small>Se guardan en servidor, no dentro del JSON.</small></div>
              <label className="lincoln-package-upload">
                {uploading ? 'Subiendo...' : '+ Subir imágenes'}
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={handleUpload} />
              </label>
            </div>
            <div className="lincoln-package-image-grid">
              {form.images.map((image, index) => (
                <figure key={image.filename || image.imageUrl}>
                  <img src={image.imageUrl} alt={`${form.name || 'Paquete'} ${index + 1}`} loading="lazy" />
                  {index === 0 ? <span>Principal</span> : null}
                  <button type="button" onClick={() => removeImage(image)}>×</button>
                </figure>
              ))}
              {!form.images.length ? <div className="lincoln-package-no-image">Sin imágenes todavía</div> : null}
            </div>
          </section>

          <section className="lincoln-package-services-editor">
            <div className="lincoln-package-editor-title">
              <div><strong>Servicios incluidos y costos</strong><small>Distingue operación interna, proveedores externos y forma de costeo.</small></div>
              <button type="button" onClick={addLine}>+ Agregar servicio</button>
            </div>

            <div className="lincoln-package-service-list">
              {form.serviceLines.map((line, index) => (
                <article key={line.id} className="lincoln-package-service-line">
                  <div className="lincoln-package-service-number">{index + 1}</div>
                  <label><span>Categoría</span><select value={line.category} onChange={(e) => updateLine(line.id, { category: e.target.value })}>{CATEGORY_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
                  <label className="is-description"><span>Servicio / detalle</span><input value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} placeholder="Ej. Plato servido: 2 carnes, 3 guarniciones" /></label>
                  <label><span>Origen</span><select value={line.sourceType} onChange={(e) => updateLine(line.id, { sourceType: e.target.value, supplierId: e.target.value === 'internal' ? '' : line.supplierId })}>{SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label><span>Cantidad</span><input type="number" min="0" step="0.01" value={line.quantity} onChange={(e) => updateLine(line.id, { quantity: Number(e.target.value) })} /></label>
                  <label><span>Unidad</span><input value={line.unit} onChange={(e) => updateLine(line.id, { unit: e.target.value })} placeholder="UND / PERSONA / CAJA" /></label>
                  <label><span>Costeo</span><select value={line.costMode} onChange={(e) => updateLine(line.id, { costMode: e.target.value })}>{COST_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label><span>Costo unitario</span><input type="number" min="0" step="0.01" value={line.unitCostBs} onChange={(e) => updateLine(line.id, { unitCostBs: Number(e.target.value) })} /></label>
                  {line.sourceType === 'external' ? (
                    <label className="is-provider"><span>Proveedor</span><select value={line.supplierId} onChange={(e) => updateLine(line.id, { supplierId: e.target.value })}><option value="">Sin proveedor definido</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
                  ) : (
                    <div className="lincoln-package-internal"><span>Responsable</span><strong>Lincoln</strong></div>
                  )}
                  <button type="button" className="is-remove" onClick={() => removeLine(line.id)} title="Quitar servicio">×</button>
                </article>
              ))}
              {!form.serviceLines.length ? <div className="lincoln-package-services-empty">Aún no agregaste servicios a este paquete.</div> : null}
            </div>
          </section>

          <section className="lincoln-package-cost-preview">
            <article><span>Costo variable / persona</span><strong>{money(packageCost.variablePerPerson)}</strong></article>
            <article><span>Costos fijos / evento</span><strong>{money(packageCost.fixedEvent)}</strong></article>
            <article><span>Ingreso al mínimo</span><strong>{money(packageCost.revenueMin)}</strong></article>
            <article className={packageCost.marginMin < 0 ? 'is-negative' : 'is-positive'}><span>Margen estimado al mínimo</span><strong>{money(packageCost.marginMin)}</strong></article>
          </section>

          <footer>
            <button type="button" className="is-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="is-primary" disabled={saving || uploading}>{saving ? 'Guardando...' : 'Guardar paquete'}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function LincolnPackages({ revision, actor, refreshKey, onRefresh }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [roomId, setRoomId] = useState('');
  const [data, setData] = useState({ summary: {}, rows: [], rooms: [], suppliers: [] });
  const [error, setError] = useState('');
  const [modalRecord, setModalRecord] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.lincoln.getPackagesOverview({ query, status, roomId })
      .then((response) => {
        if (cancelled) return;
        setData(response ?? { summary: {}, rows: [], rooms: [], suppliers: [] });
        setError('');
      })
      .catch((requestError) => {
        if (cancelled) return;
        setError(requestError?.message || 'No se pudo cargar Paquetes Lincoln.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [localRefresh, query, refreshKey, roomId, status]);

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const summary = data?.summary ?? {};
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  const suppliers = Array.isArray(data?.suppliers) ? data.suppliers : [];

  const refresh = async () => {
    setModalRecord(undefined);
    setLoading(true);
    setLocalRefresh((value) => value + 1);
    await onRefresh?.();
  };

  return (
    <div className="lincoln-packages-view">
      <header className="lincoln-packages-heading">
        <div>
          <h1>Paquetes</h1>
          <p>Configura servicios, proveedores, costos y márgenes de cada propuesta comercial.</p>
        </div>
        <button type="button" onClick={() => setModalRecord(null)}>+ Nuevo paquete</button>
      </header>

      <section className="lincoln-package-metrics">
        <Metric icon="star" value={summary.totalPackages ?? 0} label="Paquetes configurados" />
        <Metric icon="calendar" value={summary.activePackages ?? 0} label="Paquetes activos" tone="green" />
        <Metric icon="files" value={summary.totalServices ?? 0} label="Servicios configurados" tone="blue" />
        <Metric icon="users" value={summary.externalServices ?? 0} label="Servicios externos" tone="gold" />
      </section>

      <section className="lincoln-packages-filters">
        <input
          value={query}
          onChange={(e) => { setLoading(true); setQuery(e.target.value); }}
          placeholder="Buscar paquete, servicio, salón o proveedor..."
        />
        <select value={roomId} onChange={(e) => { setLoading(true); setRoomId(e.target.value); }}>
          <option value="">Todos los salones</option>
          {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select>
        <select value={status} onChange={(e) => { setLoading(true); setStatus(e.target.value); }}>
          <option value="all">Todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
      </section>

      {error ? <div className="lincoln-package-error">{error}</div> : null}

      <section className="lincoln-package-card-grid">
        {!loading && !rows.length ? <div className="lincoln-packages-empty">No hay paquetes que coincidan con estos filtros.</div> : null}
        {rows.map((pkg) => {
          const mainImage = pkg.images?.[0]?.imageUrl;
          const marginNegative = Number(pkg.minEstimatedMarginBs ?? 0) < 0;
          return (
            <article key={pkg.id} className="lincoln-package-card">
              <div className="lincoln-package-cover">
                {mainImage ? <img src={mainImage} alt={pkg.name} loading="lazy" /> : <div><LinconIcon name="star" /><span>Sin imagen</span></div>}
                <span className={`lincoln-package-state is-${pkg.status}`}>{pkg.status === 'inactive' ? 'Inactivo' : 'Activo'}</span>
              </div>

              <div className="lincoln-package-card-body">
                <div className="lincoln-package-card-title">
                  <div><small>{pkg.code}</small><h3>{pkg.name}</h3><p>{pkg.roomName || 'Todos los salones'} · {pkg.segment || 'Sin segmento'}</p></div>
                  <button type="button" onClick={() => setModalRecord(pkg)}>Editar</button>
                </div>

                <div className="lincoln-package-price-row">
                  <div><span>Precio</span><strong>{money(pkg.pricePerPersonBs)} <small>/persona</small></strong></div>
                  <div><span>Mínimo</span><strong>{pkg.minimumGuests || 0} <small>personas</small></strong></div>
                </div>

                <div className="lincoln-package-service-summary">
                  <span><b>{pkg.serviceCount}</b> servicios</span>
                  <span><b>{pkg.internalServices}</b> internos</span>
                  <span><b>{pkg.externalServices}</b> externos</span>
                  <span><b>{pkg.providerCount}</b> proveedores</span>
                </div>

                <div className="lincoln-package-cost-row">
                  <article><span>Costo variable</span><strong>{money(pkg.variableCostPerPersonBs)} /pers.</strong></article>
                  <article><span>Costo fijo</span><strong>{money(pkg.fixedEventCostBs)}</strong></article>
                  <article className={marginNegative ? 'is-negative' : 'is-positive'}><span>Margen al mínimo</span><strong>{money(pkg.minEstimatedMarginBs)}</strong></article>
                </div>

                <div className="lincoln-package-services-preview">
                  {pkg.serviceLines.slice(0, 4).map((line) => (
                    <span key={line.id}>
                      <i className={`is-${line.sourceType}`} />
                      <b>{line.category}</b>
                      {line.description}
                    </span>
                  ))}
                  {pkg.serviceLines.length > 4 ? <small>+ {pkg.serviceLines.length - 4} servicios más</small> : null}
                  {!pkg.serviceLines.length ? <small>Sin servicios configurados.</small> : null}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {modalRecord !== undefined ? (
        <PackageModal
          record={modalRecord}
          rooms={rooms}
          suppliers={suppliers}
          revision={revision}
          actor={actor}
          onClose={() => setModalRecord(undefined)}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}
