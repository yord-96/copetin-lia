import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { forgetPortalSession, portalRequest, portalSession, portalStaffUser } from '../../../services/lincolnPortalApi';
import PortalLogin from './PortalLogin';
import EventPlanEditor from './EventPlanEditor';
import '../styles/lincoln-portal.css';

export default function LincolnEventPortalAdmin({ state, currentUser }) {
  const [authenticated, setAuthenticated] = useState(() => Boolean(portalSession(true)) && portalStaffUser() === String(currentUser?.id));
  const [accounts, setAccounts] = useState([]);
  const [plannedEventIds, setPlannedEventIds] = useState([]);
  const [eventSearch, setEventSearch] = useState('');
  const [showAccessForm, setShowAccessForm] = useState(false);
  const [eventId, setEventId] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', name: '' });
  const [resetId, setResetId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const expired = useCallback(() => { setAuthenticated(false); setEditing(false); }, []);
  const load = useCallback(async () => {
    try { const result = await portalRequest('/accounts', { staff: true }); setAccounts(result.accounts); setPlannedEventIds(result.plannedEventIds || []); }
    catch (err) { setError(err.message); if (err.status === 401 || err.status === 403) expired(); }
  }, [expired]);
  useEffect(() => { if (authenticated) load(); }, [authenticated, load]);
  useEffect(() => { if (showAccessForm) document.getElementById('lp-create-client-access')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [showAccessForm]);
  useEffect(() => {
    if (!editing) return undefined;
    const previous = document.body.style.overflow;
    const appRoot = document.getElementById('root');
    const previousInert = appRoot?.inert;
    document.body.style.overflow = 'hidden';
    if (appRoot) appRoot.inert = true;
    return () => {
      document.body.style.overflow = previous;
      if (appRoot) appRoot.inert = previousInert;
    };
  }, [editing]);
  const events = (state.events || []).filter((row) => row.status !== 'cancelled').map((row) => ({ ...row, clientName: row.clientName || row.contractor1Name || (state.clients || []).find((client) => client.id === row.clientId)?.fullName || (state.clients || []).find((client) => client.id === row.clientId)?.name || 'Cliente sin nombre' })).sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')));
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const dateLabel = (value) => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0, 10).split('-').reverse().join('/') : 'Fecha por definir';
  const selectedEvent = events.find((row) => row.id === eventId);
  const selectEvent = (row) => { setEventId(row.id); setShowAccessForm(false); setForm({ username: '', password: '', name: row.clientName }); setError(''); setMessage(''); };
  const matchingEvents = events.filter((row) => normalize(`${row.clientName} ${row.contractCode || row.code || ''} ${row.eventName || row.eventType || ''} ${row.eventDate || ''} ${dateLabel(row.eventDate)}`).includes(normalize(eventSearch.trim())));
  const mutate = async (path, method, body) => {
    setBusy(true); setError(''); setMessage('');
    try { await portalRequest(path, { staff: true, method, body }); await load(); return true; }
    catch (err) { setError(err.message); if (err.status === 401 || err.status === 403) expired(); return false; }
    finally { setBusy(false); }
  };
  const eventLabel = (id) => { const event = events.find((row) => row.id === id); return event ? `${event.contractCode || event.code || 'Sin número'} · ${event.clientName} · ${dateLabel(event.eventDate)}` : 'Evento no disponible'; };
  const duplicate = accounts.find((row) => row.username === form.username.trim().toLowerCase());
  const visibleAccounts = accounts.filter((row) => `${row.name} ${row.username} ${eventLabel(row.eventId)}`.toLowerCase().includes(search.trim().toLowerCase()));
  const portalUrl = `${window.location.origin}/lincoln/mi-evento`;
  if (!authenticated) return <div className="lp-root lp-admin"><PortalLogin staff username={currentUser?.username || ''} onLogin={() => { setAuthenticated(true); setError(''); }} /></div>;
  if (editing) return createPortal(
    <main className="lp-root lp-planner-screen" aria-label="Planificación del evento">
      <EventPlanEditor key={eventId} eventId={eventId} staff onExpired={expired} onBack={() => { setEditing(false); load(); }} />
    </main>, document.body,
  );
  return <div className="lp-root lp-admin">
    <header className="lp-admin-header"><div><small>Gestión de clientes</small><h1>Portal de eventos</h1><p>Habilita el acceso de cada cliente y coordina su evento desde una ficha compartida.</p></div><button className="lp-secondary" onClick={async () => { if (!window.confirm('¿Cerrar la sesión de administración del portal? Los cambios sin guardar se perderán.')) return; await portalRequest('/logout', { staff: true, method: 'POST' }).catch(() => {}); forgetPortalSession(true); expired(); }}>Cerrar sesión del portal</button></header>
    <div className="lp-link lp-card"><div><strong>Acceso para tus clientes</strong><a href={portalUrl} target="_blank" rel="noreferrer">{portalUrl}</a></div><button className="lp-secondary" onClick={async () => { try { await navigator.clipboard.writeText(portalUrl); setMessage('Enlace copiado.'); } catch { setError('No se pudo copiar. Puedes seleccionar el enlace y copiarlo.'); } }}>Copiar enlace</button></div>
    {error ? <p role="alert" className="lp-error">{error}</p> : null}{message ? <p role="status" className="lp-success">{message}</p> : null}
    <section className="lp-card lp-event-picker" aria-label="Elegir evento para planificar">
      <div className="lp-table-toolbar"><div><small>PASO 1 · ELIGE EL EVENTO</small><h2>Planificador de eventos</h2><p>Cada evento tiene su propia planificación. Elige otro cliente para comenzar una nueva, o continúa una existente.</p></div><label>Buscar cliente, contrato o fecha<input type="search" value={eventSearch} onChange={(e) => setEventSearch(e.target.value)} placeholder="Ej.: Ana, boda, 21/11/2026" /></label></div>
      <div className="lp-event-options">{matchingEvents.map((row) => <button type="button" className={`lp-secondary lp-event-option ${eventId === row.id ? 'is-selected' : ''}`} key={row.id} aria-pressed={eventId === row.id} disabled={busy} onClick={() => selectEvent(row)}><strong>{row.clientName}</strong><span>{row.eventName || row.eventType || 'Evento'} · {dateLabel(row.eventDate)}</span><small>Contrato {row.contractCode || row.code || 'sin número'} · {plannedEventIds.includes(row.id) ? 'Planificación existente' : 'Nueva planificación'}</small></button>)}</div>
      {!matchingEvents.length ? <p className="lp-empty">{events.length ? 'No hay eventos que coincidan. Prueba con otro nombre o fecha.' : 'Primero registra al cliente y su evento en Reservas y Contratos.'}</p> : null}
    </section>
    {selectedEvent ? <section className="lp-card lp-selected-event" aria-label="Evento seleccionado"><small>PASO 2 · PLANIFICA O COMPARTE</small><h3>{selectedEvent.clientName}</h3><p>{eventLabel(eventId)} · {selectedEvent.eventName || selectedEvent.eventType || 'Evento'}</p><div className="lp-actions"><button onClick={() => setEditing(true)}>{plannedEventIds.includes(eventId) ? 'Continuar planificación' : 'Comenzar nueva planificación'}</button><button className="lp-secondary" onClick={() => setShowAccessForm((value) => !value)}>{showAccessForm ? 'Ocultar formulario de acceso' : 'Dar acceso a este evento'}</button></div><p>{accounts.filter((row) => row.eventId === eventId && row.active).length} acceso(s) habilitado(s). Los accesos de este evento comparten la misma planificación.</p></section> : <p className="lp-empty">Selecciona un evento arriba para planificarlo o dar acceso a su cliente.</p>}
<section className="lp-card" aria-label="Directorio de accesos"><div className="lp-table-toolbar"><div><h3>Clientes con acceso</h3><p>{accounts.length} registrados · {accounts.filter((row) => row.active).length} habilitados. Todos los eventos.</p></div><label>Buscar cliente o evento<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, usuario o contrato" /></label></div>
        <div className="lp-table-wrap"><table><thead><tr><th>Cliente</th><th>Usuario</th><th>Evento asignado</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{visibleAccounts.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.username}</td><td>{eventLabel(row.eventId)}</td><td><span className={`lp-badge ${row.active ? '' : 'is-inactive'}`}>{row.active ? 'Habilitado' : 'Revocado'}</span></td><td><div className="lp-actions"><button className="lp-secondary" disabled={busy || !events.some((event) => event.id === row.eventId)} onClick={() => { selectEvent(events.find((event) => event.id === row.eventId)); document.querySelector('.lp-event-picker')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Ver evento</button><button disabled={busy} className="lp-secondary" onClick={async () => { if (window.confirm(`¿${row.active ? 'Revocar' : 'Habilitar'} el acceso de ${row.name}?`)) await mutate(`/accounts/${row.id}`, 'PATCH', { active: !row.active }); }}>{row.active ? 'Revocar acceso' : 'Habilitar'}</button><button className="lp-secondary" disabled={busy} onClick={() => { setResetId(row.id); setResetPassword(''); }}>Cambiar contraseña</button></div></td></tr>)}</tbody></table></div>
        {!visibleAccounts.length ? <p className="lp-empty">{accounts.length ? 'No hay accesos que coincidan con la búsqueda.' : 'Todavía no se han creado accesos de clientes.'}</p> : null}
        {resetId ? <form className="lp-access-form" onSubmit={async (e) => { e.preventDefault(); if (await mutate(`/accounts/${resetId}`, 'PATCH', { password: resetPassword })) { setResetId(''); setResetPassword(''); setMessage('Contraseña cambiada. Las sesiones anteriores se cerraron.'); } }}><label>Nueva contraseña para {accounts.find((row) => row.id === resetId)?.username}<input required type="password" minLength="10" maxLength="128" autoComplete="new-password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} /></label><button disabled={busy}>Guardar contraseña</button><button type="button" className="lp-secondary" onClick={() => setResetId('')}>Cancelar</button></form> : null}
</section>
    {selectedEvent && showAccessForm ? <>
      <div className="lp-card"><div className="lp-table-toolbar"><div><h3>Dar acceso a {selectedEvent.clientName}</h3><p>{eventLabel(eventId)}. Este usuario solo podrá consultar y editar este evento.</p></div></div>
        <form id="lp-create-client-access" className="lp-access-form" onSubmit={async (e) => { e.preventDefault(); if (duplicate) { setError(`El usuario ${duplicate.username} ya pertenece a ${eventLabel(duplicate.eventId)}. Puedes cambiar su contraseña en Clientes con acceso.`); return; } if (await mutate('/accounts', 'POST', { ...form, eventId })) { setForm({ username: '', password: '', name: '' }); setMessage('Acceso creado. Comparte el enlace, usuario y contraseña con el cliente.'); } }}>
          <label>Nombre del cliente<input required maxLength="100" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Usuario<input required pattern="[a-zA-Z0-9._\-]{3,50}" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
          <label>Contraseña<input required type="password" minLength="10" maxLength="128" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><small>Mínimo 10 caracteres. No se podrá consultar después.</small></label><button disabled={busy}>Crear acceso para este evento</button>
        </form>
        {duplicate ? <p className="lp-error" role="status">El usuario {duplicate.username} ya está registrado en {eventLabel(duplicate.eventId)}. <button type="button" className="lp-secondary" onClick={() => { const event = events.find((row) => row.id === duplicate.eventId); if (event) selectEvent(event); }}>Ver acceso existente</button></p> : null}

      </div>
    </> : null}
  </div>;
}
