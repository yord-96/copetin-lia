import { useCallback, useState } from 'react';
import { forgetPortalSession, portalRequest, portalSession } from '../../../services/lincolnPortalApi';
import PortalLogin from './PortalLogin';
import EventPlanEditor from './EventPlanEditor';
import '../styles/lincoln-portal.css';

export default function ClientEventPortal() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(portalSession()));
  const expired = useCallback(() => setAuthenticated(false), []);
  return <main className={`lp-root lp-public ${authenticated ? '' : 'lp-welcome'}`}>
    {authenticated ? <><header className="lp-public-bar"><div className="lp-brand"><small>Centro de Eventos</small><strong>LINCOLN</strong></div><span>Portal de mi evento</span><button className="lp-secondary" onClick={async () => { if (!window.confirm('¿Salir del portal? Los cambios sin guardar se perderán.')) return; await portalRequest('/logout', { method: 'POST' }).catch(() => {}); forgetPortalSession(); setAuthenticated(false); }}>Cerrar sesión</button></header><EventPlanEditor onExpired={expired} /></> : <PortalLogin onLogin={() => setAuthenticated(true)} />}
  </main>;
}
