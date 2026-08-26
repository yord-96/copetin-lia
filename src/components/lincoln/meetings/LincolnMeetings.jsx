import { useMemo, useState } from 'react';
import { api } from '../../../services/api';
import LinconIcon from '../shared/LinconIcon';
import '../styles/lincoln-meetings.css';

const todayKey = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const formatDate = (value) => {
  if (!value) return '—';
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const statusLabel = (status) => ({
  scheduled: 'Programada',
  completed: 'Realizada',
  cancelled: 'Cancelada',
  pending_followup: 'Seguimiento',
}[String(status ?? '').toLowerCase()] ?? 'Programada');

const typeLabel = (type) => ({
  initial: 'Primera reunión',
  planning: 'Planificación',
  tasting: 'Degustación',
  coordination: 'Coordinación',
  final: 'Reunión final',
  followup: 'Seguimiento',
  other: 'Otra',
}[String(type ?? '').toLowerCase()] ?? 'Reunión');

const normalize = (value) => String(value ?? '').trim().toLowerCase();

const formatDateNumeric = (value) => {
  const key = String(value ?? '').slice(0, 10);
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : key;
};

const referenceTypeLabel = (reference) => {
  if (reference.sourceType === 'event') return 'Contrato';
  const status = normalize(reference.status);
  if (status === 'interested' || status === 'interesado') return 'Interesado';
  return 'Reserva';
};

function Metric({ icon, value, label, tone = 'wine' }) {
  return (
    <article className={`lincoln-meeting-metric is-${tone}`}>
      <span><LinconIcon name={icon} /></span>
      <div><strong>{value}</strong><small>{label}</small></div>
    </article>
  );
}

function MeetingModal({ record, state, saving, onClose, onSave }) {
  const today = todayKey();
  const [form, setForm] = useState(() => ({
    status: 'scheduled', type: 'planning', date: today, time: '10:00', durationMinutes: 60,
    location: 'CENTRO DE EVENTOS LINCOLN', ...record,
  }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const [referenceQuery, setReferenceQuery] = useState('');
  const [referenceOpen, setReferenceOpen] = useState(false);

  const references = useMemo(() => {
    const buildReference = (row, sourceType) => {
      const primaryName = row.contractor1Name ?? row.clientName ?? '';
      const secondaryName = row.contractor2Name ?? row.secondClientName ?? '';
      const names = [primaryName, secondaryName].map((value) => String(value ?? '').trim()).filter(Boolean);
      const displayName = names.join(' / ') || 'Sin cliente';
      const eventName = String(row.eventType ?? '').trim();
      const eventDate = row.eventDate ?? '';
      const typeText = sourceType === 'event'
        ? 'Contrato'
        : ['interested', 'interesado'].includes(normalize(row.status)) ? 'Interesado' : 'Reserva';
      const searchValues = [
        row.code, eventName, eventDate, formatDate(eventDate), formatDateNumeric(eventDate),
        primaryName, secondaryName, displayName, row.contractor1Phone, row.contractor2Phone,
        row.clientPhone, row.roomName, typeText,
      ];
      return {
        key: `${sourceType}:${row.id}`,
        sourceType,
        sourceId: row.id,
        sourceCode: row.code,
        status: row.status ?? '',
        clientId: row.clientId ?? null,
        clientName: primaryName,
        clientPhone: row.contractor1Phone ?? row.clientPhone ?? '',
        secondaryClientName: secondaryName,
        eventDate,
        eventType: eventName,
        roomName: row.roomName ?? '',
        displayName,
        typeText,
        searchText: normalize(searchValues.join(' ')),
      };
    };

    const reservations = (state.reservations ?? [])
      .filter((row) => String(row.status ?? '').toLowerCase() !== 'cancelled')
      .map((row) => buildReference(row, 'reservation'));
    const events = (state.events ?? [])
      .filter((row) => String(row.status ?? '').toLowerCase() !== 'cancelled')
      .map((row) => buildReference(row, 'event'));
    return [...reservations, ...events].sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate)));
  }, [state.events, state.reservations]);

  const selectedKey = form.sourceType && form.sourceId ? `${form.sourceType}:${form.sourceId}` : '';
  const selectedReference = references.find((item) => item.key === selectedKey) ?? null;
  const filteredReferences = useMemo(() => {
    const needle = normalize(referenceQuery);
    const matches = needle ? references.filter((item) => item.searchText.includes(needle)) : references;
    return matches.slice(0, 10);
  }, [referenceQuery, references]);

  const selectReference = (reference) => {
    if (!reference) {
      setForm((current) => ({ ...current, sourceType: '', sourceId: '', sourceCode: '', clientId: '', clientName: '', clientPhone: '', eventDate: '', eventType: '', roomName: '' }));
      setReferenceQuery('');
      setReferenceOpen(false);
      return;
    }
    setForm((current) => ({ ...current, ...reference, subject: current.subject || `Reunión de ${reference.eventType || 'evento'}` }));
    setReferenceQuery('');
    setReferenceOpen(false);
  };

  const submit = (event) => {
    event.preventDefault();
    onSave({
      ...form,
      date: String(form.date ?? '').slice(0, 10),
      durationMinutes: Math.max(15, Number(form.durationMinutes ?? 60)),
      subject: String(form.subject ?? '').trim(), objective: String(form.objective ?? '').trim(),
      attendees: String(form.attendees ?? '').trim(), agreements: String(form.agreements ?? '').trim(),
      nextActions: String(form.nextActions ?? '').trim(), notes: String(form.notes ?? '').trim(),
      responsibleName: String(form.responsibleName ?? '').trim(),
    });
  };

  return (
    <div className="lincoln-meeting-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="lincoln-meeting-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>Centro de Eventos Lincoln</small><h2>{record?.id ? 'Editar reunión' : 'Nueva reunión'}</h2></div><button type="button" onClick={onClose}>×</button></header>
        <div className="lincoln-meeting-modal-body">
          <section>
            <div className="lincoln-meeting-section-title"><small>01 · Vinculación</small><h3>Reserva, interesado o contrato relacionado</h3></div>
            <div className="lincoln-meeting-reference is-wide">
              <span className="lincoln-meeting-reference-label">Documento comercial</span>
              <div className={`lincoln-meeting-reference-picker${referenceOpen ? ' is-open' : ''}`}>
                <div className="lincoln-meeting-reference-search">
                  <span className="lincoln-meeting-reference-search-icon">⌕</span>
                  <input
                    type="search"
                    value={referenceQuery}
                    onFocus={() => setReferenceOpen(true)}
                    onChange={(event) => { setReferenceQuery(event.target.value); setReferenceOpen(true); }}
                    placeholder="Buscar por evento, fecha, cliente, código o salón..."
                    aria-label="Buscar reserva, interesado o contrato"
                    autoComplete="off"
                  />
                  {selectedReference ? <button type="button" className="lincoln-meeting-reference-clear" onClick={() => selectReference(null)} title="Quitar vínculo">×</button> : null}
                </div>
                {selectedReference && !referenceQuery ? (
                  <button type="button" className="lincoln-meeting-reference-selected" onClick={() => setReferenceOpen((current) => !current)}>
                    <span className={`lincoln-meeting-reference-badge is-${selectedReference.sourceType === 'event' ? 'contract' : normalize(selectedReference.status) === 'interested' || normalize(selectedReference.status) === 'interesado' ? 'interested' : 'reservation'}`}>{referenceTypeLabel(selectedReference)}</span>
                    <span className="lincoln-meeting-reference-selected-copy">
                      <strong>{selectedReference.eventType || selectedReference.displayName}</strong>
                      <small>{formatDateNumeric(selectedReference.eventDate)} · {selectedReference.displayName}{selectedReference.roomName ? ` · ${selectedReference.roomName}` : ''} · {selectedReference.sourceCode || 'SIN CÓDIGO'}</small>
                    </span>
                  </button>
                ) : null}
                {referenceOpen ? (
                  <div className="lincoln-meeting-reference-menu">
                    <button type="button" className="lincoln-meeting-reference-general" onMouseDown={(event) => event.preventDefault()} onClick={() => selectReference(null)}>
                      <span className="lincoln-meeting-reference-general-icon">＋</span>
                      <span><strong>Reunión general / sin vínculo</strong><small>Crear una reunión que no dependa de una reserva o contrato.</small></span>
                    </button>
                    <div className="lincoln-meeting-reference-menu-head"><span>{referenceQuery ? `Resultados para “${referenceQuery}”` : 'Documentos recientes'}</span><small>{references.length} disponibles</small></div>
                    <div className="lincoln-meeting-reference-results">
                      {filteredReferences.length ? filteredReferences.map((item) => (
                        <button type="button" key={item.key} className={`lincoln-meeting-reference-option${item.key === selectedKey ? ' is-selected' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectReference(item)}>
                          <span className={`lincoln-meeting-reference-badge is-${item.sourceType === 'event' ? 'contract' : normalize(item.status) === 'interested' || normalize(item.status) === 'interesado' ? 'interested' : 'reservation'}`}>{referenceTypeLabel(item)}</span>
                          <span className="lincoln-meeting-reference-option-copy">
                            <strong>{item.eventType || item.displayName}</strong>
                            <small>{formatDateNumeric(item.eventDate)} · {item.displayName}{item.roomName ? ` · ${item.roomName}` : ''}</small>
                          </span>
                          <span className="lincoln-meeting-reference-code">{item.sourceCode || 'SIN CÓDIGO'}</span>
                        </button>
                      )) : <div className="lincoln-meeting-reference-empty">No encontramos coincidencias. Prueba con el nombre del evento, una fecha como 01/09/2026, el cliente o el código.</div>}
                    </div>
                    {references.length > filteredReferences.length ? <div className="lincoln-meeting-reference-more">Mostrando los primeros {filteredReferences.length} resultados. Escribe más datos para afinar la búsqueda.</div> : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="lincoln-meeting-form-grid">
              <label><span>Cliente</span><input value={form.clientName ?? ''} onChange={(e) => set('clientName', e.target.value)} /></label>
              <label><span>Celular</span><input value={form.clientPhone ?? ''} onChange={(e) => set('clientPhone', e.target.value)} /></label>
              <label><span>Evento</span><input value={form.eventType ?? ''} onChange={(e) => set('eventType', e.target.value)} /></label>
              <label><span>Fecha del evento</span><input type="date" value={String(form.eventDate ?? '').slice(0, 10)} onChange={(e) => set('eventDate', e.target.value)} /></label>
            </div>
          </section>

          <section>
            <div className="lincoln-meeting-section-title"><small>02 · Agenda</small><h3>Fecha, propósito y participantes</h3></div>
            <div className="lincoln-meeting-form-grid">
              <label><span>Fecha</span><input required type="date" value={form.date ?? ''} onChange={(e) => set('date', e.target.value)} /></label>
              <label><span>Hora</span><input required type="time" value={form.time ?? ''} onChange={(e) => set('time', e.target.value)} /></label>
              <label><span>Duración (min.)</span><input type="number" min="15" step="15" value={form.durationMinutes ?? 60} onChange={(e) => set('durationMinutes', e.target.value)} /></label>
              <label><span>Tipo</span><select value={form.type ?? 'planning'} onChange={(e) => set('type', e.target.value)}><option value="initial">Primera reunión</option><option value="planning">Planificación</option><option value="tasting">Degustación</option><option value="coordination">Coordinación</option><option value="final">Reunión final</option><option value="followup">Seguimiento</option><option value="other">Otra</option></select></label>
              <label className="is-wide"><span>Asunto</span><input required value={form.subject ?? ''} onChange={(e) => set('subject', e.target.value)} placeholder="Ej. Definición de menú y distribución del salón" /></label>
              <label className="is-wide"><span>Objetivo</span><textarea value={form.objective ?? ''} onChange={(e) => set('objective', e.target.value)} placeholder="Qué se necesita resolver en esta reunión" /></label>
              <label><span>Lugar</span><input value={form.location ?? ''} onChange={(e) => set('location', e.target.value)} /></label>
              <label><span>Responsable</span><input value={form.responsibleName ?? ''} onChange={(e) => set('responsibleName', e.target.value)} placeholder="Quién hará seguimiento" /></label>
              <label className="is-wide"><span>Participantes</span><input value={form.attendees ?? ''} onChange={(e) => set('attendees', e.target.value)} placeholder="Cliente, pareja, planner, chef, administración..." /></label>
            </div>
          </section>

          <section>
            <div className="lincoln-meeting-section-title"><small>03 · Seguimiento</small><h3>Acuerdos y próximos pasos</h3></div>
            <div className="lincoln-meeting-form-grid">
              <label className="is-wide"><span>Acuerdos</span><textarea value={form.agreements ?? ''} onChange={(e) => set('agreements', e.target.value)} placeholder="Decisiones tomadas durante la reunión" /></label>
              <label className="is-wide"><span>Próximas acciones</span><textarea value={form.nextActions ?? ''} onChange={(e) => set('nextActions', e.target.value)} placeholder="Tareas pendientes, responsables y compromisos" /></label>
              <label><span>Estado</span><select value={form.status ?? 'scheduled'} onChange={(e) => set('status', e.target.value)}><option value="scheduled">Programada</option><option value="pending_followup">Seguimiento pendiente</option><option value="completed">Realizada</option><option value="cancelled">Cancelada</option></select></label>
              <label><span>Próximo contacto</span><input type="date" value={String(form.nextFollowUpDate ?? '').slice(0, 10)} onChange={(e) => set('nextFollowUpDate', e.target.value)} /></label>
              <label className="is-wide"><span>Notas internas</span><textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></label>
            </div>
          </section>
        </div>
        <footer><button type="button" className="is-secondary" onClick={onClose}>Cancelar</button><button type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Guardar reunión'}</button></footer>
      </form>
    </div>
  );
}

export default function LincolnMeetings({ state, revision, actor, onRefresh }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [period, setPeriod] = useState('upcoming');
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const today = todayKey();
  const meetings = useMemo(() => (Array.isArray(state.meetings) ? state.meetings : []), [state.meetings]);
  const sorted = useMemo(() => meetings.slice().sort((a, b) => `${a.date ?? ''} ${a.time ?? ''}`.localeCompare(`${b.date ?? ''} ${b.time ?? ''}`)), [meetings]);
  const sevenDate = new Date(`${today}T12:00:00`); sevenDate.setDate(sevenDate.getDate() + 7);
  const sevenKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(sevenDate);
  const monthKey = today.slice(0, 7);
  const summary = {
    today: meetings.filter((row) => row.date === today && row.status !== 'cancelled').length,
    upcoming: meetings.filter((row) => row.date >= today && row.date <= sevenKey && row.status === 'scheduled').length,
    followup: meetings.filter((row) => row.status === 'pending_followup' || (row.nextFollowUpDate && row.nextFollowUpDate <= today && !['completed', 'cancelled'].includes(row.status))).length,
    completed: meetings.filter((row) => String(row.date ?? '').startsWith(monthKey) && row.status === 'completed').length,
  };
  const rows = sorted.filter((row) => {
    if (status !== 'all' && row.status !== status) return false;
    if (period === 'upcoming' && (row.date < today || row.status === 'cancelled')) return false;
    if (period === 'today' && row.date !== today) return false;
    if (period === 'history' && row.date >= today && !['completed', 'cancelled'].includes(row.status)) return false;
    if (!query.trim()) return true;
    const needle = normalize(query);
    return [row.code, row.subject, row.clientName, row.clientPhone, row.sourceCode, row.eventType, row.responsibleName, row.location].some((value) => normalize(value).includes(needle));
  });

  const save = async (form) => {
    if (!revision) return;
    setSaving(true);
    try {
      const payload = { collection: 'meetings', id: form.id ?? '', record: form, revision, actor };
      if (form.id) await api.lincoln.updateRecord(payload); else await api.lincoln.createRecord(payload);
      setModal(null);
      await onRefresh?.();
    } catch (error) {
      if (error?.status === 409 || error?.payload?.code === 'LINCOLN_REVISION_CONFLICT') {
        await onRefresh?.();
        window.alert('Lincoln fue actualizado por otro usuario. La información se recargó; revisa la reunión y vuelve a guardar.');
      } else window.alert(error.message || 'No se pudo guardar la reunión.');
    } finally { setSaving(false); }
  };

  return (
    <div className="lincoln-meetings-view">
      <header className="lincoln-meetings-heading"><div><h1>Reuniones</h1><p>Planifica conversaciones con interesados, reservas y contratos, y conserva acuerdos y seguimiento en un solo lugar.</p></div><button type="button" onClick={() => setModal({})}>+ Nueva reunión</button></header>
      <section className="lincoln-meeting-metrics">
        <Metric icon="calendar" value={summary.today} label="Reuniones hoy" />
        <Metric icon="bookmark" value={summary.upcoming} label="Próximos 7 días" tone="blue" />
        <Metric icon="bell" value={summary.followup} label="Seguimientos pendientes" tone="gold" />
        <Metric icon="chart" value={summary.completed} label="Realizadas este mes" tone="green" />
      </section>
      <section className="lincoln-meetings-card">
        <div className="lincoln-meetings-toolbar">
          <label className="lincoln-meetings-search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cliente, código, asunto, responsable o evento..." /></label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="upcoming">Próximas</option><option value="today">Hoy</option><option value="all">Todas</option><option value="history">Historial</option></select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Todos los estados</option><option value="scheduled">Programadas</option><option value="pending_followup">Seguimiento</option><option value="completed">Realizadas</option><option value="cancelled">Canceladas</option></select>
        </div>
        <div className="lincoln-meetings-table-wrap"><table className="lincoln-meetings-table"><thead><tr><th>Fecha / hora</th><th>Reunión</th><th>Cliente</th><th>Relacionada con</th><th>Responsable</th><th>Seguimiento</th><th>Estado</th><th /></tr></thead><tbody>
          {!rows.length ? <tr><td colSpan="8" className="lincoln-meetings-empty">No hay reuniones que coincidan con estos filtros.</td></tr> : null}
          {rows.map((row) => <tr key={row.id}>
            <td><div className="lincoln-meeting-date"><strong>{formatDate(row.date)}</strong><small>{row.time || 'Hora pendiente'} · {row.durationMinutes || 60} min</small></div></td>
            <td><div className="lincoln-meeting-subject"><strong>{row.subject || 'Reunión sin asunto'}</strong><small>{typeLabel(row.type)}{row.location ? ` · ${row.location}` : ''}</small></div></td>
            <td><div className="lincoln-meeting-client"><strong>{row.clientName || 'Sin cliente'}</strong><small>{row.clientPhone || 'Sin celular'}</small></div></td>
            <td><div className="lincoln-meeting-link"><strong>{row.sourceCode || 'General'}</strong><small>{row.eventType || 'Sin evento vinculado'}</small></div></td>
            <td>{row.responsibleName || '—'}</td>
            <td><div className="lincoln-meeting-follow"><strong>{row.nextFollowUpDate ? formatDate(row.nextFollowUpDate) : '—'}</strong><small>{row.nextActions ? 'Con acciones pendientes' : 'Sin acción registrada'}</small></div></td>
            <td><span className={`lincoln-meeting-status is-${row.status || 'scheduled'}`}>{statusLabel(row.status)}</span></td>
            <td><button type="button" className="lincoln-meeting-more" onClick={() => setModal(row)} title="Editar reunión">⋮</button></td>
          </tr>)}
        </tbody></table></div>
      </section>
      {modal ? <MeetingModal record={modal.id ? modal : null} state={state} saving={saving} onClose={() => setModal(null)} onSave={save} /> : null}
    </div>
  );
}
