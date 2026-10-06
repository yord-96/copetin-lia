import { useCallback, useEffect, useState } from 'react';
import { forgetPortalSession, portalRequest, portalSession, portalStaffUser } from '../../../services/lincolnPortalApi';
import PortalLogin from './PortalLogin';
import EventPlanEditor from './EventPlanEditor';
import '../styles/lincoln-portal.css';

export default function LincolnEventPortalAdmin({ state, currentUser }) {
  const [authenticated, setAuthenticated] = useState(() => Boolean(portalSession(true)) && portalStaffUser() === String(currentUser?.id));
  const [accounts, setAccounts] = useState([]);
  const [eventId, setEventId] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', name: '' });
  const [resetId, setResetId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const expired = useCallback(() => { setAuthenticated(false); setEditing(false); }, []);
  const load = useCallback(async () => {
    try { setAccounts((await portalRequest('/accounts', { staff: true })).accounts); }
    catch (err) { setError(err.message); if (err.status === 401) expired(); }
  }, [expired]);
  useEffect(() => { if (authenticated) load(); }, [authenticated, load]);
  const events = state.events.filter((row) => row.status !== 'cancelled');
  const mutate = async (path, method, body) => {
    setBusy(true); setError(''); setMessage('');
    try { await portalRequest(path, { staff: true, method, body }); await load(); return true; }
    catch (err) { setError(err.message); if (err.status === 401) expired(); return false; }
    finally { setBusy(false); }
  };
  const portalUrl = `${window.location.origin}/lincoln/mi-evento`;
  if (!authenticated) return <div className="lp-root lp-admin"><PortalLogin staff username={currentUser?.username || ''} onLogin={() => { setAuthenticated(true); setError(''); }} /></div>;
  return <div className="lp-root lp-admin">
    <header className="lp-admin-header"><div><small>Gestión de clientes</small><h1>Portal de eventos</h1><p>Habilita el acceso de cada cliente y coordina su evento desde una ficha compartida.</p></div><button className="lp-secondary" onClick={async () => { if (!window.confirm('¿Cerrar la sesión de administración del portal? Los cambios sin guardar se perderán.')) return; await portalRequest('/logout', { staff: true, method: 'POST' }).catch(() => {}); forgetPortalSession(true); expired(); }}>Cerrar sesión del portal</button></header>
    <div className="lp-link lp-card"><div><strong>Acceso para tus clientes</strong><a href={portalUrl} target="_blank" rel="noreferrer">{portalUrl}</a></div><button className="lp-secondary" onClick={async () => { try { await navigator.clipboard.writeText(portalUrl); setMessage('Enlace copiado.'); } catch { setError('No se pudo copiar. Puedes seleccionar el enlace y copiarlo.'); } }}>Copiar enlace</button></div>
    {error ? <p role="alert" className="lp-error">{error}</p> : null}{message ? <p role="status" className="lp-success">{message}</p> : null}
    <div className="lp-card"><label>Evento<select value={eventId} disabled={editing || busy} onChange={(e) => setEventId(e.target.value)}><option value="">Selecciona un contrato / evento</option>{events.map((row) => <option key={row.id} value={row.id}>{row.contractCode || row.code} · {row.clientName || row.contractor1Name} · {row.eventDate}</option>)}</select></label>{!events.length ? <p>Registra un contrato en Reservas y Contratos para habilitar su portal.</p> : null}
    </div>
    {eventId ? <>
      <div className="lp-card"><div className="lp-table-toolbar"><div><h3>Accesos del evento</h3><p>Varios clientes del mismo evento pueden trabajar sobre la misma ficha.</p></div><button onClick={() => { if (editing && !window.confirm('¿Cerrar la ficha? Los cambios sin guardar se perderán.')) return; setEditing(!editing); }}>{editing ? 'Cerrar ficha' : 'Abrir ficha y croquis'}</button></div>
        <form className="lp-access-form" onSubmit={async (e) => { e.preventDefault(); if (await mutate('/accounts', 'POST', { ...form, eventId })) { setForm({ username: '', password: '', name: '' }); setMessage('Acceso creado. Comparte el enlace, usuario y contraseña con el cliente.'); } }}>
          <label>Nombre del cliente<input required maxLength="100" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Usuario<input required pattern="[a-zA-Z0-9._\-]{3,50}" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
          <label>Contraseña<input required type="password" minLength="10" maxLength="128" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><small>Mínimo 10 caracteres. No se podrá consultar después.</small></label><button disabled={busy}>Crear acceso</button>
        </form>
        <div className="lp-table-wrap"><table><thead><tr><th>Cliente</th><th>Usuario</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{accounts.filter((row) => row.eventId === eventId).map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.username}</td><td><span className={`lp-badge ${row.active ? '' : 'is-inactive'}`}>{row.active ? 'Habilitado' : 'Revocado'}</span></td><td><div className="lp-actions"><button disabled={busy} className="lp-secondary" onClick={async () => { if (window.confirm(`¿${row.active ? 'Revocar' : 'Habilitar'} el acceso de ${row.name}?`)) await mutate(`/accounts/${row.id}`, 'PATCH', { active: !row.active }); }}>{row.active ? 'Revocar acceso' : 'Habilitar'}</button><button className="lp-secondary" disabled={busy} onClick={() => { setResetId(row.id); setResetPassword(''); }}>Cambiar contraseña</button></div></td></tr>)}</tbody></table></div>
        {!accounts.some((row) => row.eventId === eventId) ? <p className="lp-empty">Este evento todavía no tiene accesos de clientes.</p> : null}
        {resetId ? <form className="lp-access-form" onSubmit={async (e) => { e.preventDefault(); if (await mutate(`/accounts/${resetId}`, 'PATCH', { password: resetPassword })) { setResetId(''); setResetPassword(''); setMessage('Contraseña cambiada. Las sesiones anteriores se cerraron.'); } }}><label>Nueva contraseña para {accounts.find((row) => row.id === resetId)?.username}<input required type="password" minLength="10" maxLength="128" autoComplete="new-password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} /></label><button disabled={busy}>Guardar contraseña</button><button type="button" className="lp-secondary" onClick={() => setResetId('')}>Cancelar</button></form> : null}
      </div>
      {editing ? <EventPlanEditor key={eventId} eventId={eventId} staff onExpired={expired} /> : null}
    </> : null}
  </div>;
}
