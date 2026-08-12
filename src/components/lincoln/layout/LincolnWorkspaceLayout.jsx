import { lincolnMobilePrimaryIds, lincolnSidebarItems } from '../config/navigation';
import LinconIcon from '../shared/LinconIcon';

export default function LincolnWorkspaceLayout({
  activeView,
  activeItem,
  title,
  databaseStatus,
  snapshot,
  currentUser,
  userName,
  userInitials,
  availableCompanies,
  isMobileMenuOpen,
  onOpenView,
  onSwitchWorkspace,
  onReload,
  onLogout,
  onOpenMobileMenu,
  onCloseMobileMenu,
  children,
  overlay,
}) {
  return (
    <div className={`lincon-shell ${activeView !== 'panel' ? 'lincon-shell--agenda' : ''}`}>
      <aside className="lincon-sidebar">
        <div className="lincon-logo"><span /><small>Centro de Eventos</small><strong>Lincoln</strong></div>
        <label className="lincon-workspace-select"><span>Workspace activo</span><select defaultValue="lincoln"><option value="lincoln">Centro de Eventos Lincoln</option></select></label>
        <div className="lincon-user-card"><span>{userInitials}</span><div><strong>{userName}</strong><small>{currentUser?.role ?? 'Usuario'}</small></div></div>
        <nav className="lincon-nav" aria-label="Lincoln">
          {lincolnSidebarItems.map((item) => (
            <button key={item.id} type="button" className={activeView === item.id ? 'is-active' : ''} onClick={() => onOpenView(item.id)} disabled={item.disabled}>
              <LinconIcon name={item.icon} />{item.label}
            </button>
          ))}
        </nav>
        {availableCompanies.includes('copetin') ? <div className="lincon-switcher"><span>Espacios habilitados</span><p>Selecciona tu área de trabajo</p><div><button type="button" onClick={() => onSwitchWorkspace('copetin')}>Copetín</button><button type="button" className="is-current">Lincoln</button></div></div> : null}
      </aside>

      <main className="lincon-main">
        <header className="lincon-mobile-header">
          <div className="lincon-mobile-brand"><small>Centro de Eventos</small><strong>Lincoln</strong></div>
          <div className="lincon-mobile-heading"><span>{activeItem.label}</span><small className={databaseStatus.error ? 'has-error' : ''}><i />{databaseStatus.loading ? 'Conectando' : databaseStatus.error ? 'Sin conexión' : 'Base Lincoln'}</small></div>
          <button type="button" className="lincon-mobile-account" onClick={onOpenMobileMenu} aria-label="Abrir menú">{userInitials}</button>
        </header>
        <header className="lincon-topbar">
          <div className="lincon-topbar-brand"><LinconIcon name="home" /><strong>{title}</strong></div>
          <div className={`lincon-topbar-status ${databaseStatus.error ? 'has-error' : ''}`}><span /><div><strong>{databaseStatus.loading ? 'Conectando base Lincoln' : databaseStatus.error ? 'Base Lincoln no disponible' : 'Base Lincoln separada'}</strong><small>{databaseStatus.error || (snapshot ? `Revisión ${snapshot.version}` : 'Sin mezclar datos con El Copetín')}</small></div></div>
          <button type="button" className="lincon-icon-button" aria-label="Recargar Lincoln" onClick={onReload}><LinconIcon name="bell" /></button>
          <div className="lincon-account"><div><strong>{userName}</strong><small>{currentUser?.role ?? 'Usuario'}</small></div><span>{userInitials}</span></div>
          <button type="button" className="lincon-logout" onClick={onLogout}>Salir</button>
        </header>
        {children}
      </main>

      <nav className="lincon-mobile-nav" aria-label="Navegación principal de Lincoln">
        {lincolnSidebarItems.filter((item) => lincolnMobilePrimaryIds.has(item.id)).map((item) => (
          <button key={item.id} type="button" className={activeView === item.id ? 'is-active' : ''} onClick={() => onOpenView(item.id)}><LinconIcon name={item.icon} /><span>{item.id === 'asistencia' ? 'Asistencia' : item.label}</span></button>
        ))}
        <button type="button" className={isMobileMenuOpen ? 'is-active' : ''} onClick={onOpenMobileMenu}><span className="lincon-mobile-more-icon"><i /><i /><i /></span><span>Más</span></button>
      </nav>

      {isMobileMenuOpen ? (
        <div className="lincon-mobile-menu-backdrop" role="presentation" onClick={onCloseMobileMenu}>
          <section className="lincon-mobile-menu" role="dialog" aria-modal="true" aria-label="Más opciones de Lincoln" onClick={(event) => event.stopPropagation()}>
            <header><div><small>Lincoln</small><strong>Más opciones</strong></div><button type="button" onClick={onCloseMobileMenu}>×</button></header>
            <div className="lincon-mobile-user-summary"><span>{userInitials}</span><div><strong>{userName}</strong><small>{currentUser?.role ?? 'Usuario'}</small></div></div>
            <div className="lincon-mobile-more-grid">
              {lincolnSidebarItems.filter((item) => !lincolnMobilePrimaryIds.has(item.id)).map((item) => (
                <button key={item.id} type="button" disabled={item.disabled} onClick={() => onOpenView(item.id)}><LinconIcon name={item.icon} /><span>{item.label}</span><small>{item.disabled ? 'Próxima fase' : 'Abrir'}</small></button>
              ))}
            </div>
            <div className="lincon-mobile-menu-actions">{availableCompanies.includes('copetin') ? <button type="button" onClick={() => onSwitchWorkspace('copetin')}><LinconIcon name="home" /> Ir a El Copetín</button> : null}<button type="button" className="is-logout" onClick={onLogout}>Salir de la sesión</button></div>
          </section>
        </div>
      ) : null}
      {overlay}
    </div>
  );
}
