import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { compressAttendanceImage } from '../../utils/attendancePhotos';

const getInputDate = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const getAttendancePhotoSource = (record) =>
  String(record?.photoUrl || record?.photoDataUrl || '').trim();

function AttendancePhoto({ src, alt, className = '' }) {
  const [failedSrc, setFailedSrc] = useState('');
  const failed = failedSrc === src;
  if (!src || failed) {
    return <span className="attendance-photo-placeholder">Foto no disponible</span>;
  }
  return <img className={className} src={src} alt={alt} onError={() => setFailedSrc(src)} />;
}

const buildReadableAddress = (payload, latitude, longitude) => {
  const address = payload?.address ?? {};
  const parts = [
    address.road,
    address.pedestrian,
    address.neighbourhood || address.suburb,
    address.city || address.town || address.village,
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);
  const uniqueParts = [...new Set(parts)];
  if (uniqueParts.length > 0) {
    return uniqueParts.join(', ');
  }
  return String(payload?.display_name ?? '').trim() || `${latitude}, ${longitude}`;
};

const resolveStreetAddress = async (latitude, longitude) => {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'es');

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error('No se pudo convertir la ubicación GPS a calles.');
  }
  return buildReadableAddress(await response.json(), latitude, longitude);
};

function AttendanceSection({
  records = [],
  currentUser = null,
  formatDateTime,
  canMark = true,
  onLoadRecords,
  onCreateRecord,
}) {
  const [form, setForm] = useState({
    type: 'entrada',
    location: '',
    reason: '',
    latitude: null,
    longitude: null,
  });
  const [photoDraft, setPhotoDraft] = useState(null);
  const [filters, setFilters] = useState({
    dateFrom: getInputDate(),
    dateTo: getInputDate(),
    type: 'all',
    query: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [photoPreview, setPhotoPreview] = useState(null);
  const [isReportLoading, setIsReportLoading] = useState(false);

  useEffect(() => () => {
    if (photoDraft?.previewUrl) {
      URL.revokeObjectURL(photoDraft.previewUrl);
    }
  }, [photoDraft?.previewUrl]);

  useEffect(() => {
    if (!onLoadRecords) return undefined;
    let disposed = false;
    const timerId = window.setTimeout(async () => {
      setIsReportLoading(true);
      try {
        await onLoadRecords({
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          type: filters.type,
          query: filters.query,
          limit: 300,
        });
      } catch (loadError) {
        if (!disposed) setError(loadError.message || 'No se pudo cargar el reporte de asistencia.');
      } finally {
        if (!disposed) setIsReportLoading(false);
      }
    }, filters.query ? 250 : 0);
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [filters.dateFrom, filters.dateTo, filters.type, filters.query, onLoadRecords]);

  const currentTimeLabel = new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  const todayLabel = new Date().toLocaleDateString('es-BO', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  const todayRecords = useMemo(
    () => records.filter((record) => getInputDate(new Date(record.capturedAt ?? record.createdAt)) === getInputDate()),
    [records],
  );

  const filteredRecords = useMemo(() => {
    const query = normalizeText(filters.query);
    return records.filter((record) => {
      const dateKey = getInputDate(new Date(record.capturedAt ?? record.createdAt));
      if (filters.dateFrom && dateKey < filters.dateFrom) return false;
      if (filters.dateTo && dateKey > filters.dateTo) return false;
      if (filters.type !== 'all' && record.type !== filters.type) return false;
      if (query) {
        const haystack = normalizeText(`${record.code} ${record.userName} ${record.location} ${record.reason} ${record.type}`);
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [filters, records]);

  const handlePhotoChange = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setError('');
    try {
      const processed = await compressAttendanceImage(file);
      setPhotoDraft((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return processed;
      });
      console.info('[copetin-attendance] Foto comprimida para asistencia.', {
        originalBytes: processed.originalSizeBytes,
        finalBytes: processed.sizeBytes,
        durationMs: processed.durationMs,
      });
    } catch (photoError) {
      setError(photoError.message || 'No se pudo cargar la foto.');
    } finally {
      // Permite volver a seleccionar/tomar la misma foto en Android/iPhone.
      input.value = '';
    }
  };


  const handleUseLocation = () => {
    setError('');
    setStatus('');
    if (!navigator.geolocation) {
      setError('Este dispositivo no permite capturar ubicación automática.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = Number(position.coords.latitude.toFixed(6));
        const longitude = Number(position.coords.longitude.toFixed(6));
        const fallbackLocation = `${latitude}, ${longitude}`;
        let locationText = fallbackLocation;
        try {
          locationText = await resolveStreetAddress(latitude, longitude);
          setStatus('Ubicación capturada con calles. Puedes ajustarla manualmente si hace falta.');
        } catch {
          setStatus('GPS capturado como coordenadas. Si quieres, escribe manualmente la calle o referencia.');
        }
        setForm((current) => ({
          ...current,
          latitude,
          longitude,
          location: current.location || locationText,
        }));
        setIsLocating(false);
      },
      () => {
        setIsLocating(false);
        setError('No se pudo capturar la ubicación. Puedes escribirla manualmente.');
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canMark) {
      setError('Tu usuario no tiene habilitada la marcación de asistencia.');
      return;
    }
    setError('');
    setStatus('');
    if (!photoDraft?.blob) {
      setError('Debes tomar o subir una foto para respaldar la marca.');
      return;
    }
    setIsSubmitting(true);
    try {
      const uploadStartedAt = performance.now();
      const uploadedPhoto = await api.uploads.attendancePhoto(photoDraft.blob, {
        recordId: `${currentUser?.id ?? 'attendance'}-${Date.now()}`,
      });
      console.info('[copetin-attendance] Foto de asistencia subida.', {
        originalBytes: photoDraft.originalSizeBytes,
        finalBytes: uploadedPhoto.bytes ?? photoDraft.sizeBytes,
        durationMs: Math.round(performance.now() - uploadStartedAt),
      });
      await onCreateRecord?.({
        ...form,
        photoUrl: uploadedPhoto.photoUrl,
        photoMimeType: uploadedPhoto.mimeType ?? photoDraft.mimeType,
        photoSizeBytes: uploadedPhoto.bytes ?? photoDraft.sizeBytes,
        photoWidth: photoDraft.width,
        photoHeight: photoDraft.height,
      });
      setForm({
        type: 'entrada',
        location: '',
        reason: '',
        latitude: null,
        longitude: null,
      });
      setPhotoDraft((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return null;
      });
      setStatus('Marca registrada correctamente.');
    } catch (submitError) {
      setError(submitError.message || 'No se pudo registrar la asistencia.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="panel attendance-view">
      <header className="attendance-hero">
        <div>
          <span>Control remoto</span>
          <h2>Asistencia</h2>
          <p>Marca entrada o salida como biométrico móvil, con ubicación, motivo, hora y foto.</p>
        </div>
        <div className="attendance-user-card">
          <span className="attendance-user-avatar">{(currentUser?.fullName || currentUser?.username || 'U').slice(0, 1).toUpperCase()}</span>
          <strong>{currentUser?.fullName || currentUser?.username || 'Usuario'}</strong>
          <small>{currentUser?.role || 'Operador'}</small>
        </div>
      </header>

      <section className="attendance-kpis">
        <article>
          <small>Marcas de hoy</small>
          <strong>{todayRecords.length}</strong>
          <span>{getInputDate()}</span>
        </article>
        <article>
          <small>Entradas</small>
          <strong>{todayRecords.filter((record) => record.type === 'entrada').length}</strong>
          <span>Registradas hoy</span>
        </article>
        <article>
          <small>Salidas</small>
          <strong>{todayRecords.filter((record) => record.type === 'salida').length}</strong>
          <span>Registradas hoy</span>
        </article>
      </section>

      <section className="attendance-layout">
        <form className="attendance-card attendance-form" onSubmit={handleSubmit}>
          <div className="attendance-card-head">
            <div>
              <span>Biométrico móvil</span>
              <h3>{form.type === 'entrada' ? 'Registrar entrada' : 'Registrar salida'}</h3>
            </div>
            <strong>{currentTimeLabel}</strong>
          </div>

          <article className={`attendance-punch-card ${form.type}`}>
            <span className="attendance-punch-ring" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3v9l5 3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
            <div>
              <small>{todayLabel}</small>
              <strong>{form.type === 'entrada' ? 'Entrada del equipo' : 'Salida del equipo'}</strong>
              <p>La marca guardará usuario, fecha, hora, ubicación y evidencia.</p>
            </div>
          </article>

          {!canMark ? (
            <p className="status error">Tu usuario puede ver esta sección, pero no tiene habilitada la marcación.</p>
          ) : null}

          <div className="attendance-type-toggle">
            <button
              type="button"
              className={form.type === 'entrada' ? 'active' : ''}
              onClick={() => setForm((current) => ({ ...current, type: 'entrada' }))}
              disabled={!canMark}
            >
              Entrada
            </button>
            <button
              type="button"
              className={form.type === 'salida' ? 'active' : ''}
              onClick={() => setForm((current) => ({ ...current, type: 'salida' }))}
              disabled={!canMark}
            >
              Salida
            </button>
          </div>

          <label>
            Ubicación
            <div className="attendance-location-row">
              <input
                value={form.location}
                onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                placeholder="Ej: Calle Bolívar y Sucre, salón, domicilio cliente, galpón..."
                required
              />
              <button type="button" onClick={handleUseLocation} disabled={isLocating || !canMark}>
                {isLocating ? 'Buscando...' : 'GPS'}
              </button>
            </div>
            <small className="attendance-field-hint">Puedes usar GPS para sugerir calles o escribir manualmente dónde estás.</small>
          </label>

          <label>
            Motivo
            <textarea
              rows={3}
              value={form.reason}
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Ej: entrega temprana, salida tarde, apoyo en evento, visita a proveedor..."
              required
            />
          </label>

          <div className="attendance-photo-picker">
            <span>Evidencia fotográfica</span>

            <label
              htmlFor="attendance-photo-input"
              style={{
                display: 'flex',
                width: '100%',
                minHeight: 58,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 16,
                border: '1px dashed #f28a55',
                background: '#fff8f3',
                color: '#d9530b',
                fontWeight: 800,
                fontSize: '0.98rem',
                padding: '13px 18px',
                boxSizing: 'border-box',
                marginTop: 8,
                cursor: canMark ? 'pointer' : 'not-allowed',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {photoDraft ? '📷 Cambiar / volver a tomar foto' : '📷 Tomar foto o seleccionar imagen'}
            </label>

            <input
              id="attendance-photo-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoChange}
              disabled={!canMark}
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                opacity: 0,
                overflow: 'hidden',
                clip: 'rect(0 0 0 0)',
                whiteSpace: 'nowrap',
              }}
            />

            {photoDraft ? (
              <small style={{ display: 'block', marginTop: 8, color: '#2f855a', fontWeight: 700 }}>
                Foto preparada correctamente
              </small>
            ) : null}
          </div>

          {photoDraft?.previewUrl ? (
            <AttendancePhoto className="attendance-photo-preview" src={photoDraft.previewUrl} alt="Vista previa de asistencia" />
          ) : null}

          {error ? <p className="status error">{error}</p> : null}
          {status ? <p className="status success">{status}</p> : null}

          <button type="submit" className="attendance-submit" disabled={isSubmitting || !canMark}>
            {isSubmitting ? 'Registrando...' : 'Registrar asistencia'}
          </button>
        </form>

        <article className="attendance-card attendance-report">
          <div className="attendance-card-head">
            <div>
              <span>02 · Reporte</span>
              <h3>Marcas registradas</h3>
            </div>
            <strong>{isReportLoading ? '…' : filteredRecords.length}</strong>
          </div>

          <div className="attendance-filters">
            <input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
            <input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} />
            <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>
              <option value="all">Todas</option>
              <option value="entrada">Entradas</option>
              <option value="salida">Salidas</option>
            </select>
            <input
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Buscar usuario, motivo o ubicación"
            />
          </div>

          <div className="attendance-mobile-records">
            {filteredRecords.map((record) => {
              const photoSource = getAttendancePhotoSource(record);
              return (
              <article key={`mobile-${record.id}`} className="attendance-mobile-record">
                <div>
                  <strong>{record.userName}</strong>
                  <small>{formatDateTime ? formatDateTime(record.capturedAt) : record.capturedAt}</small>
                </div>
                <span className={`attendance-type ${record.type}`}>{record.type === 'entrada' ? 'Entrada' : 'Salida'}</span>
                <p>{record.location}</p>
                <small>{record.reason}</small>
                {photoSource ? (
                  <button
                    type="button"
                    className="attendance-mobile-photo-button"
                    onClick={() => setPhotoPreview({ src: photoSource, title: `${record.userName} · ${record.type === 'entrada' ? 'Entrada' : 'Salida'}` })}
                    aria-label={`Ver foto de asistencia de ${record.userName}`}
                  >
                    <AttendancePhoto src={photoSource} alt={`Foto de asistencia de ${record.userName}`} />
                    <span>Ver foto</span>
                  </button>
                ) : null}
              </article>
              );
            })}
            {filteredRecords.length === 0 ? (
              <p className="attendance-mobile-empty">Sin marcas en el rango seleccionado.</p>
            ) : null}
          </div>

          <div className="attendance-table-wrap">
            <table className="attendance-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Fecha y hora</th>
                  <th>Usuario</th>
                  <th>Tipo</th>
                  <th>Ubicación / motivo</th>
                  <th>Foto</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => {
                  const photoSource = getAttendancePhotoSource(record);
                  return (
                  <tr key={record.id}>
                    <td><strong>{record.code}</strong></td>
                    <td>{formatDateTime ? formatDateTime(record.capturedAt) : record.capturedAt}</td>
                    <td>
                      <strong>{record.userName}</strong>
                      <small>{record.role}</small>
                    </td>
                    <td><span className={`attendance-type ${record.type}`}>{record.type === 'entrada' ? 'Entrada' : 'Salida'}</span></td>
                    <td>
                      <strong>{record.location}</strong>
                      <small>{record.reason}</small>
                    </td>
                    <td>
                      {photoSource ? (
                        <button
                          type="button"
                          className="attendance-thumb-button"
                          onClick={() => setPhotoPreview({ src: photoSource, title: `${record.userName} · ${record.type === 'entrada' ? 'Entrada' : 'Salida'}` })}
                          aria-label={`Ver foto de asistencia de ${record.userName}`}
                        >
                          <AttendancePhoto className="attendance-thumb" src={photoSource} alt={`Foto de asistencia de ${record.userName}`} />
                        </button>
                      ) : '-'}
                    </td>
                  </tr>
                  );
                })}
                {filteredRecords.length === 0 ? (
                  <tr><td colSpan={6}><p className="status">Sin marcas en el rango seleccionado.</p></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      </section>
      {photoPreview ? (
        <div className="attendance-photo-modal-backdrop" onClick={() => setPhotoPreview(null)}>
          <section className="attendance-photo-modal" onClick={(event) => event.stopPropagation()} aria-label="Vista previa de foto de asistencia">
            <header>
              <div>
                <span>Evidencia fotográfica</span>
                <h3>{photoPreview.title}</h3>
              </div>
              <button type="button" onClick={() => setPhotoPreview(null)} aria-label="Cerrar foto">×</button>
            </header>
            <AttendancePhoto src={photoPreview.src} alt={photoPreview.title} />
          </section>
        </div>
      ) : null}
    </section>
  );
}

export default AttendanceSection;
