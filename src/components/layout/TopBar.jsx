const initialsFromName = (name) =>
  String(name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'US';

const PAGE_LABELS = {
  resumen: 'Dashboard',
  caja: 'Calendario',
  items: 'Clientes',
  alquiler: 'Ordenes',
  proveedores: 'Proveedores',
  personal: 'Personal',
  inventario: 'Inventario',
  inventario_productos: 'Inventario',
  inventario_categorias: 'Categorias',
  inventario_movimientos: 'Movimientos',
  inventario_ajustes: 'Ajustes stock',
  devolucion: 'Transporte',
  devolucion_entregas: 'Entregas',
  devolucion_recojos: 'Recojos',
  devolucion_rutas: 'Flota',
  recibos: 'Reportes',
  contabilidad: 'Contabilidad',
  usuarios: 'Usuarios',
  categorias: 'Ajustes',
};

const shortName = (name) => String(name ?? 'Usuario').split(' ').filter(Boolean).slice(0, 2).join(' ') || 'Usuario';

function TopBar({ onOpenResetDialog, currentUser = null, onLogout, canReset = false, userPresence = [], activeTab = '' }) {
  const activeUsersHere = userPresence.filter((entry) => entry.activeTab === activeTab);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="top-actions">
          <span className="mode-pill mode-pill-web">Modo Web</span>
          <div className="presence-strip" title="Usuarios activos ahora">
            <strong>Activos</strong>
            {userPresence.length > 0 ? userPresence.slice(0, 4).map((entry) => (
              <span
                key={entry.userId}
                className={entry.activeTab === activeTab ? 'active' : ''}
                style={{ '--presence-color': entry.color }}
                title={`${entry.fullName} - ${entry.role} - ${entry.activeTab}`}
              >
                <i>{initialsFromName(entry.fullName)}</i>
                <b>{shortName(entry.fullName)}</b>
                <em>{PAGE_LABELS[entry.activeTab] ?? entry.activeTab ?? 'Sistema'}</em>
              </span>
            )) : <small>Solo tu sesion</small>}
            {userPresence.length > 4 ? <small>+{userPresence.length - 4}</small> : null}
            {activeUsersHere.length > 0 ? <small>{activeUsersHere.length} aqui</small> : null}
          </div>
          {canReset ? (
            <button
              type="button"
              className="admin-reset-button"
              onClick={onOpenResetDialog}
              title="Reset general del sistema"
            >
              Reset general
            </button>
          ) : null}
          <div className="user-pill">
            <span className="user-avatar">{initialsFromName(currentUser?.fullName)}</span>
            <div className="user-meta">
              <strong>{currentUser?.fullName ?? 'Usuario'}</strong>
              <span>{currentUser?.role ?? 'Operador'}</span>
            </div>
            <button type="button" className="top-logout-button" onClick={onLogout}>Salir</button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default TopBar;
