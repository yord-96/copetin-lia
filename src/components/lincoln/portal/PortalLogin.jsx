import { useState } from 'react';
import { loginPortal } from '../../../services/lincolnPortalApi';

export default function PortalLogin({ staff = false, username = '', onLogin }) {
  const [form, setForm] = useState({ username, password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <form className="lp-login lp-card" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await loginPortal(form.username, form.password, staff); onLogin(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }}><div className="lp-brand"><small>Centro de Eventos</small><strong>LINCOLN</strong></div><h2>{staff ? 'Acceso del equipo Lincoln' : 'Tu evento, en un solo lugar'}</h2><p>{staff ? 'Usa tu cuenta administrativa de Lincoln para gestionar clientes y eventos. Los usuarios creados para clientes ingresan desde Mi evento.' : 'Organiza tus invitados, proveedores y actividades. Diseña cómo quieres distribuir el salón.'}</p>
    <label>Usuario<input required autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
    <label>Contraseña<input required type="password" maxLength="128" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
    {error ? <p role="alert" className="lp-error">{error}</p> : null}<button disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>{staff ? <a href="/lincoln/mi-evento" target="_blank" rel="noreferrer">Soy cliente · Entrar a Mi evento</a> : null}{!staff ? <small>Si necesitas acceso o recuperar tu contraseña, contacta a Lincoln.</small> : null}
  </form>;
}
