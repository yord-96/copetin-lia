import { useMemo, useState } from 'react';

const getInputDate = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const readImageAsDataUrl = (file) => new Promise((resolve, reject) => {
  if (!file) {
    resolve('');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(new Error('No se pudo leer la foto.'));
  reader.readAsDataURL(file);
});

const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

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
  onCreateRecord,
}) {
  const [form, setForm] = useState({
    type: 'entrada',
    location: '',
    reason: '',
    photoDataUrl: '',
    latitude: null,
    longitude: null,
  });
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
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setForm((current) => ({ ...current, photoDataUrl: dataUrl }));
    } catch (photoError) {
      setError(photoError.message || 'No se pudo cargar la foto.');
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
    setIsSubmitting(true);
    try {
      await onCreateRecord?.(form);
      setForm({
        type: 'entrada',
        location: '',
        reason: '',
        photoDataUrl: '',
        latitude: null,
        longitude: null,
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

          <label className="attendance-photo-picker">
            Evidencia fotográfica
            <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} disabled={!canMark} />
            <span>{form.photoDataUrl ? 'Foto cargada correctamente' : 'Tomar foto o seleccionar imagen'}</span>
          </label>

          {form.photoDataUrl ? (
            <img className="attendance-photo-preview" src={form.photoDataUrl} alt="Vista previa de asistencia" />
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
            <strong>{filteredRecords.length}</strong>
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
            {filteredRecords.map((record) => (
              <article key={`mobile-${record.id}`} className="attendance-mobile-record">
                <div>
                  <strong>{record.userName}</strong>
                  <small>{formatDateTime ? formatDateTime(record.capturedAt) : record.capturedAt}</small>
                </div>
                <span className={`attendance-type ${record.type}`}>{record.type === 'entrada' ? 'Entrada' : 'Salida'}</span>
                <p>{record.location}</p>
                <small>{record.reason}</small>
              </article>
            ))}
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
                {filteredRecords.map((record) => (
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
                      {record.photoDataUrl ? <img className="attendance-thumb" src={record.photoDataUrl} alt="Asistencia" /> : '-'}
                    </td>
                  </tr>
                ))}
                {filteredRecords.length === 0 ? (
                  <tr><td colSpan={6}><p className="status">Sin marcas en el rango seleccionado.</p></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </section>
  );
}

export default AttendanceSection;
