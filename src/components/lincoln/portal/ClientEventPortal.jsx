import { useCallback, useState } from 'react';
import { forgetPortalSession, portalRequest, portalSession } from '../../../services/lincolnPortalApi';
import PortalLogin from './PortalLogin';
import EventPlanEditor from './EventPlanEditor';
import '../styles/lincoln-portal.css';

export default function ClientEventPortal() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(portalSession()));
  const expired = useCallback(() => setAuthenticated(false), []);
  return <main className={`lp-root ${authenticated ? 'lp-client-workspace' : 'lp-public lp-welcome'}`}>
    {authenticated ? <EventPlanEditor onExpired={expired} backLabel="Cerrar sesión" onBack={async () => { await portalRequest('/logout', { method: 'POST' }).catch(() => {}); forgetPortalSession(); setAuthenticated(false); }} /> : <PortalLogin onLogin={() => setAuthenticated(true)} />}
  </main>;
}
