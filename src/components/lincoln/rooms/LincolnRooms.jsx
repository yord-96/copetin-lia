import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../services/api';
import LinconIcon from '../shared/LinconIcon';
import '../styles/lincoln-rooms.css';

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const formatDate = (value) => {
  if (!value) return 'Sin fecha próxima';
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
};

function Metric({ icon, value, label, tone = 'wine' }) {
  return (
    <article className={`lincoln-room-metric is-${tone}`}>
      <span className="lincoln-room-metric-icon"><LinconIcon name={icon} /></span>
      <div><strong>{value}</strong><span>{label}</span></div>
    </article>
  );
}

function RoomModal({ room, revision, actor, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    name: room?.name ?? '',
    capacity: Number(room?.capacity ?? 0),
    status: room?.status ?? 'active',
    description: room?.description ?? '',
  }));
  const [existingImages, setExistingImages] = useState(() => Array.isArray(room?.images) ? room.images : []);
  const [removedImages, setRemovedImages] = useState([]);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  const currentCount = existingImages.length + files.length;

  const chooseFiles = (event) => {
    const picked = Array.from(event.target.files ?? []);
    setError('');
    const valid = [];
    for (const file of picked) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        setError('Solo puedes subir imágenes JPG, PNG o WEBP.');
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError('Cada imagen puede pesar como máximo 8 MB.');
        continue;
      }
      valid.push(file);
    }
    const available = Math.max(0, MAX_IMAGES - currentCount);
    setFiles((current) => [...current, ...valid.slice(0, available)]);
    event.target.value = '';
  };

  const removeExisting = (image) => {
    setExistingImages((current) => current.filter((item) => item.url !== image.url));
    setRemovedImages((current) => [...current, image]);
  };

  const removePending = (file) => setFiles((current) => current.filter((item) => item !== file));

  const submit = async (event) => {
    event.preventDefault();
    if (!revision) return;
    if (!form.name.trim()) {
      setError('El nombre del salón es obligatorio.');
      return;
    }
    setSaving(true);
    setError('');
    const uploaded = [];
    let latestRevision = revision;
    try {
      let roomRecord = room;
      if (!roomRecord?.id) {
        const created = await api.lincoln.createRecord({
          collection: 'rooms',
          record: {
            ...form,
            name: form.name.trim(),
            images: [],
            coverImageUrl: '',
          },
          revision: latestRevision,
          actor,
        });
        roomRecord = created.record;
        latestRevision = created.revision;
      }

      for (const file of files) {
        const result = await api.uploads.roomImage(file, { roomId: roomRecord.id });
        uploaded.push({
          url: result.imageUrl,
          filename: result.filename,
          mimeType: result.mimeType,
          bytes: result.bytes,
          uploadedAt: new Date().toISOString(),
        });
      }

      const nextImages = [...existingImages, ...uploaded].slice(0, MAX_IMAGES);
      const nextRecord = {
        ...roomRecord,
        ...form,
        name: form.name.trim(),
        capacity: Number(form.capacity ?? 0),
        images: nextImages,
        coverImageUrl: nextImages[0]?.url ?? '',
      };
      const updated = await api.lincoln.updateRecord({
        collection: 'rooms',
        id: roomRecord.id,
        record: nextRecord,
        revision: latestRevision,
        actor,
      });

      await Promise.allSettled(
        removedImages
          .map((image) => image.filename)
          .filter(Boolean)
          .map((filename) => api.uploads.deleteRoomImage({ filename })),
      );

      await onSaved(updated);
      onClose();
    } catch (requestError) {
      await Promise.allSettled(uploaded.map((image) => api.uploads.deleteRoomImage({ filename: image.filename })));
      setError(requestError?.message || 'No se pudo guardar el salón.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lincoln-room-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="lincoln-room-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><small>Centro de Eventos Lincoln</small><h2>{room?.id ? 'Editar salón' : 'Nuevo salón'}</h2></div>
          <button type="button" onClick={onClose}>×</button>
        </header>
        <div className="lincoln-room-modal-body">
          <section className="lincoln-room-form-grid">
            <label className="is-wide"><span>Nombre del salón</span><input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. SALÓN GRANDE" /></label>
            <label><span>Capacidad</span><input type="number" min="0" value={form.capacity} onChange={(event) => setForm((current) => ({ ...current, capacity: Number(event.target.value || 0) }))} /></label>
            <label><span>Estado</span><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>
            <label className="is-wide"><span>Descripción</span><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe el ambiente, características o uso principal." /></label>
          </section>

          <section className="lincoln-room-gallery-editor">
            <div className="lincoln-room-gallery-head">
              <div><strong>Galería del salón</strong><span>Las imágenes se guardan en el servidor, fuera de lincoln-state.json.</span></div>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={currentCount >= MAX_IMAGES}>+ Subir imágenes</button>
              <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseFiles} />
            </div>
            <div className="lincoln-room-gallery-grid">
              {existingImages.map((image, index) => (
                <article key={image.url}>
                  <img src={image.url} alt={`${form.name || 'Salón'} ${index + 1}`} loading="lazy" decoding="async" />
                  {index === 0 ? <span className="is-cover">Principal</span> : null}
                  <button type="button" onClick={() => removeExisting(image)}>×</button>
                </article>
              ))}
              {previews.map(({ file, url }) => (
                <article key={`${file.name}-${file.lastModified}`} className="is-pending">
                  <img src={url} alt="Imagen pendiente" />
                  <span className="is-new">Nueva</span>
                  <button type="button" onClick={() => removePending(file)}>×</button>
                </article>
              ))}
              {!currentCount ? <div className="lincoln-room-gallery-empty">Todavía no hay imágenes. Puedes subir hasta {MAX_IMAGES}.</div> : null}
            </div>
          </section>
          {error ? <div className="lincoln-room-modal-error">{error}</div> : null}
        </div>
        <footer><button type="button" className="is-secondary" onClick={onClose}>Cancelar</button><button type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Guardar salón'}</button></footer>
      </form>
    </div>
  );
}

export default function LincolnRooms({ revision, actor, refreshKey, onRefresh }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [data, setData] = useState({ summary: {}, rows: [] });
  const [error, setError] = useState('');
  const [modalRoom, setModalRoom] = useState(undefined);

  const load = async () => {
    try {
      const next = await api.lincoln.getRoomsOverview({ query, status });
      setData(next ?? { summary: {}, rows: [] });
      setError('');
    } catch (requestError) {
      setError(requestError?.message || 'No se pudieron cargar los salones de Lincoln.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    api.lincoln.getRoomsOverview({ query, status })
      .then((next) => { if (!cancelled) { setData(next ?? { summary: {}, rows: [] }); setError(''); } })
      .catch((requestError) => { if (!cancelled) setError(requestError?.message || 'No se pudieron cargar los salones de Lincoln.'); });
    return () => { cancelled = true; };
  }, [query, refreshKey, status]);

  const summary = data?.summary ?? {};
  const rows = Array.isArray(data?.rows) ? data.rows : [];

  return (
    <div className="lincoln-rooms-view">
      <header className="lincoln-rooms-heading">
        <div><h1>Salones</h1><p>Administra los ambientes de Lincoln, su capacidad, agenda e imágenes.</p></div>
        <button type="button" onClick={() => setModalRoom(null)}>+ Nuevo salón</button>
      </header>

      <section className="lincoln-room-metrics">
        <Metric icon="home" value={summary.totalRooms ?? 0} label="Salones registrados" />
        <Metric icon="users" value={summary.totalCapacity ?? 0} label="Capacidad total activa" tone="blue" />
        <Metric icon="calendar" value={summary.upcomingEvents ?? 0} label="Eventos próximos" tone="green" />
        <Metric icon="star" value={summary.eventsNext30Days ?? 0} label="Eventos próximos 30 días" tone="gold" />
      </section>

      <section className="lincoln-rooms-toolbar">
        <label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar salón, código o descripción..." /></label>
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select>
      </section>

      {error ? <div className="lincoln-rooms-error">{error}</div> : null}

      <section className="lincoln-room-cards">
        {rows.map((room) => (
          <article className="lincoln-room-card" key={room.id}>
            <div className="lincoln-room-cover">
              {room.coverImageUrl ? <img src={room.coverImageUrl} alt={room.name} loading="lazy" decoding="async" /> : <div className="lincoln-room-no-image"><LinconIcon name="home" /><span>Sin imágenes</span></div>}
              <span className={`lincoln-room-status is-${room.status}`}>{room.status === 'inactive' ? 'Inactivo' : 'Activo'}</span>
              {room.imageCount ? <span className="lincoln-room-image-count">{room.imageCount} foto{room.imageCount === 1 ? '' : 's'}</span> : null}
            </div>
            <div className="lincoln-room-card-body">
              <div className="lincoln-room-card-title"><div><small>{room.code}</small><h2>{room.name}</h2></div><button type="button" onClick={() => setModalRoom(room)}>Editar</button></div>
              <p>{room.description || 'Sin descripción registrada.'}</p>
              <div className="lincoln-room-card-stats">
                <div><span>Capacidad</span><strong>{room.capacity || 0} personas</strong></div>
                <div><span>Próximos eventos</span><strong>{room.upcomingEvents || 0}</strong></div>
                <div><span>Próximo evento</span><strong>{formatDate(room.nextEventDate)}</strong><small>{room.nextEventType || '—'}</small></div>
              </div>
            </div>
          </article>
        ))}
        {!rows.length ? <div className="lincoln-rooms-empty">No hay salones que coincidan con estos filtros.</div> : null}
      </section>

      {modalRoom !== undefined ? (
        <RoomModal
          room={modalRoom}
          revision={revision}
          actor={actor}
          onClose={() => setModalRoom(undefined)}
          onSaved={async () => { await onRefresh?.(); await load(); }}
        />
      ) : null}
    </div>
  );
}
