import { useState } from 'react';

const initialsFromName = (name) =>
  String(name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'US';

const PRESENCE_COLORS = ['#df3f05', '#2563eb', '#16a34a', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#dc2626'];

const colorForPresence = (entry = {}) => {
  const existing = String(entry.color ?? '').trim();
  if (existing) return existing;
  const input = String(entry.userId ?? entry.sessionId ?? entry.fullName ?? 'user');
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
};

const PAGE_LABELS = {
  resumen: 'Dashboard',
  caja: 'Calendario',
  items: 'Clientes',
  alquiler: 'Ordenes',
  disponibilidad: 'Disponibilidad',
  asistencia: 'Asistencia',
  proveedores: 'Proveedores',
  personal: 'Personal',
  inventario: 'Inventario',
  inventario_productos: 'Inventario',
  inventario_combos: 'Combos',
  inventario_categorias: 'Categorias',
  inventario_movimientos: 'Movimientos',
  inventario_mantenimiento: 'Daños y Faltantes',
  inventario_ajustes: 'Ajustes stock',
  devolucion: 'Transporte',
  devolucion_entregas: 'Entregas',
  devolucion_recojos: 'Recojos',
  devolucion_rutas: 'Flota',
  recibos: 'Reportes',
  contabilidad: 'Contabilidad',
  contabilidad_caja_grande: 'Caja Grande',
  contabilidad_caja_chica: 'Caja Chica',
  usuarios: 'Usuarios',
  categorias: 'Ajustes',
};

const shortName = (name) => String(name ?? 'Usuario').split(' ').filter(Boolean).slice(0, 2).join(' ') || 'Usuario';

const deviceLabel = (device) =>
  String(device?.label ?? device?.typeLabel ?? 'Dispositivo')
    .replace(/^Computadora\b/i, 'PC')
    .trim() || 'Dispositivo';

function TopbarActionIcon({ name }) {
  const paths = name === 'company'
    ? ['M4 9h16', 'M7 9V5h10v4', 'M6 9v10', 'M18 9v10', 'M3 19h18', 'M9 13h2', 'M13 13h2']
    : ['M4 13h3l9 4V7l-9 4H4z', 'M7 13v5', 'M19 10c1 1 1 3 0 4'];

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths.map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

function TopBar({
  onOpenResetDialog,
  currentUser = null,
  onLogout,
  canReset = false,
  userPresence = [],
  activeTab = '',
  onPublishUpdateNotice,
  onSwitchCompany,
}) {
  const [isPublishingNotice, setIsPublishingNotice] = useState(false);
  const safeUserPresence = Array.isArray(userPresence) ? userPresence : [];
  const activeUsersHere = safeUserPresence.filter((entry) => entry.activeTab === activeTab);
  const currentDevice = deviceLabel(currentUser?.device);
  const visiblePresence = safeUserPresence;
  const handlePublishNotice = async () => {
    if (!onPublishUpdateNotice || isPublishingNotice) return;
    try {
      setIsPublishingNotice(true);
      await onPublishUpdateNotice();
    } finally {
      setIsPublishingNotice(false);
    }
  };
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="mobile-top-summary">
          <span>{PAGE_LABELS[activeTab] ?? 'Sistema'}</span>
          <strong>{shortName(currentUser?.fullName)}</strong>
        </div>
        <div className="top-actions">
          <span className="mode-pill mode-pill-web">Modo Web</span>
          <div className="presence-strip" aria-label="Sesiones activas ahora">
            <div className="presence-summary">
              <strong>Activos</strong>
              <small>{safeUserPresence.length || 1} sesion{(safeUserPresence.length || 1) === 1 ? '' : 'es'}</small>
            </div>
            <div className="presence-session-list">
              {visiblePresence.length > 0 ? visiblePresence.map((entry) => (
                <span
                  key={entry.sessionId ?? entry.userId}
                  className={entry.activeTab === activeTab ? 'active' : ''}
                  style={{ '--presence-color': colorForPresence(entry) }}
                >
                  <i>{initialsFromName(entry.fullName)}</i>
                  <b>{shortName(entry.fullName)}</b>
                  <em>{entry.role}</em>
                  <small>{deviceLabel(entry.device)}</small>
                  <small>{PAGE_LABELS[entry.activeTab] ?? entry.activeTab ?? 'Sistema'}</small>
                </span>
              )) : (
                <span className="presence-empty">
                  <i>{initialsFromName(currentUser?.fullName)}</i>
                  <b>{shortName(currentUser?.fullName)}</b>
                  <em>{currentUser?.role ?? 'Operador'}</em>
                  <small>{currentDevice}</small>
                  <small>{PAGE_LABELS[activeTab] ?? 'Sistema'}</small>
                </span>
              )}
            </div>
            <div className="presence-meta">
              {safeUserPresence.length > visiblePresence.length ? <small>+{safeUserPresence.length - visiblePresence.length}</small> : null}
              {activeUsersHere.length > 0 ? <small>{activeUsersHere.length} aqui</small> : null}
            </div>
          </div>
          {canReset ? (
            <button
              type="button"
              className="admin-update-button topbar-utility-action topbar-utility-action--notice"
              onClick={handlePublishNotice}
              disabled={isPublishingNotice}
              title="Publicar aviso global de actualizacion"
            >
              <TopbarActionIcon name="notice" />
              <span className="topbar-action-label topbar-action-label--desktop">
                {isPublishingNotice ? 'Avisando...' : 'Avisar mejoras'}
              </span>
              <span className="topbar-action-label topbar-action-label--mobile">
                {isPublishingNotice ? 'Avisando' : 'Mejoras'}
              </span>
            </button>
          ) : null}
          {canReset ? (
            <button
              type="button"
              className="admin-reset-button"
              onClick={onOpenResetDialog}
              title="Panel de Reset del Sistema"
            >
              Panel Reset
            </button>
          ) : null}
          {onSwitchCompany ? (
            <button
              type="button"
              className="admin-update-button topbar-utility-action topbar-utility-action--company"
              onClick={onSwitchCompany}
              title="Cambiar entre El Copetin y Lincoln"
            >
              <TopbarActionIcon name="company" />
              <span className="topbar-action-label topbar-action-label--desktop">Cambiar empresa</span>
              <span className="topbar-action-label topbar-action-label--mobile">Empresa</span>
            </button>
          ) : null}
          <div className="user-pill">
            <span className="user-avatar">{initialsFromName(currentUser?.fullName)}</span>
            <div className="user-meta">
              <strong>{currentUser?.fullName ?? 'Usuario'}</strong>
              <span>{currentUser?.role ?? 'Operador'} - {currentDevice}</span>
            </div>
            <button type="button" className="top-logout-button" onClick={onLogout}>Salir</button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default TopBar;
