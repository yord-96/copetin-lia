import { useState } from 'react';

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

const operationTabs = [
  { id: 'resumen', label: 'Dashboard', icon: 'dashboardPanel', hint: '' },
  { id: 'caja', label: 'Calendario', icon: 'calendar', hint: '' },
  { id: 'items', label: 'Clientes', icon: 'customerService', hint: '' },
  { id: 'alquiler', label: 'Ordenes de Servicio', icon: 'serviceChecklist', hint: '' },
  { id: 'asistencia', label: 'Asistencia', icon: 'attendance', hint: '' },
  { id: 'proveedores', label: 'Proveedores', icon: 'provider', hint: '' },
  { id: 'personal', label: 'Personal', icon: 'personnel', hint: '' },
  {
    id: 'inventario',
    label: 'Inventario',
    icon: 'inventoryWorker',
    hint: '',
    children: [
      { id: 'inventario_productos', label: 'Productos', targetId: 'inventario_productos' },
      { id: 'inventario_combos', label: 'Combos', targetId: 'inventario_combos' },
      { id: 'inventario_categorias', label: 'Categorias', targetId: 'inventario_categorias' },
      { id: 'inventario_movimientos', label: 'Movimientos', targetId: 'inventario_movimientos' },
      { id: 'inventario_ajustes', label: 'Ajustes de Stock', targetId: 'inventario_ajustes' },
    ],
  },
  {
    id: 'devolucion',
    label: 'Transporte',
    icon: 'truck',
    hint: '',
    children: [
      { id: 'transporte_planificador', label: 'Planificador', targetId: 'devolucion_planificador' },
      { id: 'transporte_entregas', label: 'Entregas', targetId: 'devolucion_entregas' },
      { id: 'transporte_recojos', label: 'Recojos', targetId: 'devolucion_recojos' },
      { id: 'transporte_flota', label: 'Flota y Choferes', targetId: 'devolucion_rutas' },
    ],
  },
  { id: 'recibos', label: 'Reportes', icon: 'analyticsReport', hint: '' },
  {
    id: 'contabilidad',
    label: 'Contabilidad',
    icon: 'cashRegister',
    hint: '',
    children: [
      { id: 'contabilidad_caja_grande', label: 'Caja Grande', targetId: 'contabilidad_caja_grande' },
      { id: 'contabilidad_caja_chica', label: 'Caja Chica', targetId: 'contabilidad_caja_chica' },
    ],
  },
];

const configTabs = [
  { id: 'usuarios', targetId: 'usuarios', label: 'Usuarios', icon: 'addUser' },
  { id: 'categorias', targetId: 'categorias', label: 'Ajustes', icon: 'settingsPanel' },
];

function renderIcon(icon) {
  if (icon === 'dashboardPanel') {
    return <img className="asset-icon dashboard-panel-asset-icon" src="/imagenes/panel.png" alt="" aria-hidden="true" />;
  }

  if (icon === 'customerService') {
    return (
      <img
        className="asset-icon customer-service-asset-icon"
        src="/imagenes/agente-de-servicio-al-cliente.png"
        alt=""
        aria-hidden="true"
      />
    );
  }

  if (icon === 'serviceChecklist') {
    return <img className="asset-icon service-checklist-asset-icon" src="/imagenes/lista-de-verificacion.png" alt="" aria-hidden="true" />;
  }

  if (icon === 'attendance') {
    return <img className="asset-icon attendance-asset-icon" src="/imagenes/reconocimiento-biometrico.png" alt="" aria-hidden="true" />;
  }

  if (icon === 'provider') {
    return <img className="asset-icon provider-asset-icon" src="/imagenes/proveedor.png" alt="" aria-hidden="true" />;
  }

  if (icon === 'personnel') {
    return <img className="asset-icon personnel-asset-icon" src="/imagenes/humano.png" alt="" aria-hidden="true" />;
  }

  if (icon === 'inventoryWorker') {
    return <img className="asset-icon inventory-worker-asset-icon" src="/imagenes/inventario.png" alt="" aria-hidden="true" />;
  }

  if (icon === 'analyticsReport') {
    return <img className="asset-icon analytics-report-asset-icon" src="/imagenes/analitica.png" alt="" aria-hidden="true" />;
  }

  if (icon === 'cashRegister') {
    return <img className="asset-icon cash-register-asset-icon" src="/imagenes/cajero-automatico.png" alt="" aria-hidden="true" />;
  }

  if (icon === 'addUser') {
    return <img className="asset-icon add-user-asset-icon" src="/imagenes/agregar-usuario.png" alt="" aria-hidden="true" />;
  }

  if (icon === 'settingsPanel') {
    return <img className="asset-icon settings-panel-asset-icon" src="/imagenes/ajuste.png" alt="" aria-hidden="true" />;
  }

  if (icon === 'home') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 11.5 12 5l8 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-7Z"
        />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M9.5 20v-5h5v5" />
      </svg>
    );
  }

  if (icon === 'users') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M16.5 8.5a2.5 2.5 0 1 0 0-.01Z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M7.5 9.5a3 3 0 1 0 0-.01Z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M3.5 19c0-2.5 2.2-4 4.9-4s4.9 1.5 4.9 4" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M13.8 16.5c.7-.4 1.5-.5 2.3-.5 2.2 0 4 1.2 4 3" />
      </svg>
    );
  }

  if (icon === 'clipboard') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M9 4h6l.7 1.5H19a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h3.3L9 4Z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M8.5 10.5h7M8.5 14h7" />
      </svg>
    );
  }

  if (icon === 'box') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 3 20 7.2v9.6L12 21l-8-4.2V7.2L12 3Z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 3v8m0 0 8-3.8M12 11 4 7.2" />
      </svg>
    );
  }

  if (icon === 'store') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M4 9h16l-1.2-4H5.2L4 9Zm1 0v10h14V9M8 19v-6h4v6" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M15 13h2.5" />
      </svg>
    );
  }

  if (icon === 'truck') {
    return <img className="asset-icon truck-asset-icon" src="/imagenes/camion.png" alt="" aria-hidden="true" />;
  }

  if (icon === 'calendar') {
    return <img className="asset-icon calendar-asset-icon" src="/imagenes/calendario.png" alt="" aria-hidden="true" />;
  }

  if (icon === 'chart') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M5 5h14v14H5z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M8 15.5 11 12l2.2 2 3.8-4.5" />
      </svg>
    );
  }

  if (icon === 'money') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M4 7h16v10H4z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M8 12h.01M16 12h.01" />
        <circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }

  if (icon === 'user') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M5 18.5c0-3 2.8-4.8 7-4.8s7 1.8 7 4.8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="m12 3 2 2.2 3-.2.8 2.9 2.7 1.3-1 2.8 1 2.8-2.7 1.3-.8 2.9-3-.2-2 2.2-2-2.2-3 .2-.8-2.9-2.7-1.3 1-2.8-1-2.8L6.2 8l.8-2.9 3 .2L12 3Z" />
      <circle cx="12" cy="12" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function getTabRoot(tabId) {
  const target = String(tabId ?? '');
  if (target.startsWith('devolucion')) return 'devolucion';
  if (target.startsWith('inventario')) return 'inventario';
  if (target.startsWith('contabilidad')) return 'contabilidad';
  return target;
}

const MOBILE_PRIMARY_TABS = ['resumen', 'items', 'alquiler', 'caja'];

export function MobileNavigation({
  activeTab,
  allowedTabs = [],
  notificationCounts = {},
  isOpen = false,
  onToggleMore,
  onCloseMore,
  onChange,
}) {
  const allowedSet = new Set(allowedTabs);
  const [expandedMobileGroup, setExpandedMobileGroup] = useState(null);

  const canShowTab = (tab) => {
    const targetId = tab.targetId ?? tab.id;
    if (allowedSet.size === 0) return true;
    if (allowedSet.has(targetId) || allowedSet.has(tab.id)) return true;
    if (tab.id === 'inventario' && allowedSet.has('inventario')) return true;
    if (tab.id === 'devolucion' && allowedSet.has('devolucion')) return true;
    if (tab.id === 'contabilidad' && allowedSet.has('contabilidad')) return true;
    return false;
  };

  const isActive = (tab) => {
    const targetId = tab.targetId ?? tab.id;
    return (
      activeTab === targetId
      || (tab.id === 'inventario' && String(activeTab).startsWith('inventario'))
      || (tab.id === 'devolucion' && String(activeTab).startsWith('devolucion'))
      || (tab.id === 'contabilidad' && String(activeTab).startsWith('contabilidad'))
    );
  };

  const handleChange = (tabId) => {
    onChange(tabId);
    onCloseMore();
    setExpandedMobileGroup(null);
  };

  const handleMobileGroupClick = (tab) => {
    const hasChildren = Array.isArray(tab.children) && tab.children.length > 0;
    if (!hasChildren) {
      handleChange(tab.targetId ?? tab.id);
      return;
    }
    setExpandedMobileGroup((current) => (current === tab.id ? null : tab.id));
  };

  const allowedOperationTabs = operationTabs.filter(canShowTab);
  const primaryTabs = MOBILE_PRIMARY_TABS
    .map((tabId) => allowedOperationTabs.find((tab) => tab.id === tabId))
    .filter(Boolean);
  const moreOperationTabs = allowedOperationTabs.filter((tab) => !MOBILE_PRIMARY_TABS.includes(tab.id));
  const moreConfigTabs = configTabs.filter(canShowTab);

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Navegacion movil">
        {primaryTabs.map((tab) => {
          const targetId = tab.targetId ?? tab.id;
          const notificationCount = Number(notificationCounts[tab.id]) || 0;
          return (
            <button
              key={tab.id}
              type="button"
              className={isActive(tab) ? 'active' : ''}
              onClick={() => handleChange(targetId)}
            >
              <span className="mobile-nav-icon">{renderIcon(tab.icon)}</span>
              <span>{tab.label === 'Ordenes de Servicio' ? 'Ordenes' : tab.label}</span>
              {notificationCount > 0 ? <i>{notificationCount}</i> : null}
            </button>
          );
        })}
        <button type="button" className={isOpen ? 'active' : ''} onClick={onToggleMore}>
          <span className="mobile-nav-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M5 7h14M5 12h14M5 17h14" />
            </svg>
          </span>
          <span>Mas</span>
        </button>
      </nav>

      {isOpen ? (
        <div className="mobile-more-backdrop" onClick={onCloseMore}>
          <section className="mobile-more-sheet" onClick={(event) => event.stopPropagation()} aria-label="Mas modulos">
            <header>
              <div>
                <span>El Copetin</span>
                <strong>Mas modulos</strong>
              </div>
              <button type="button" onClick={onCloseMore} aria-label="Cerrar menu movil">x</button>
            </header>
            <div className="mobile-more-grid">
              {moreOperationTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`mobile-more-group ${expandedMobileGroup === tab.id ? 'expanded' : ''}`}
                >
                  <button
                    type="button"
                    className={isActive(tab) ? 'active' : ''}
                    onClick={() => handleMobileGroupClick(tab)}
                    aria-expanded={Array.isArray(tab.children) ? expandedMobileGroup === tab.id : undefined}
                  >
                    <span className="mobile-nav-icon">{renderIcon(tab.icon)}</span>
                    <span>{tab.label}</span>
                    {Array.isArray(tab.children) && tab.children.length > 0 ? (
                      <svg className="mobile-more-chevron" viewBox="0 0 20 20" aria-hidden="true">
                        <path d="m6 8 4 4 4-4" />
                      </svg>
                    ) : null}
                  </button>
                  {Array.isArray(tab.children) && tab.children.length > 0 && expandedMobileGroup === tab.id ? (
                    <div className="mobile-more-children">
                      {tab.children.map((child) => {
                        const root = getTabRoot(child.targetId);
                        const canShowChild = allowedSet.size === 0 || allowedSet.has(child.targetId) || allowedSet.has(root) || allowedSet.has(tab.id);
                        if (!canShowChild) return null;
                        return (
                          <button
                            key={child.id}
                            type="button"
                            className={activeTab === child.targetId ? 'active' : ''}
                            onClick={() => handleChange(child.targetId)}
                          >
                            {child.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
              {moreConfigTabs.map((tab) => (
                <div key={tab.id} className="mobile-more-group">
                  <button type="button" className={isActive(tab) ? 'active' : ''} onClick={() => handleChange(tab.targetId ?? tab.id)}>
                    <span className="mobile-nav-icon">{renderIcon(tab.icon)}</span>
                    <span>{tab.label}</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function TabsNav({ activeTab, isCatalogView, onChange, notificationCounts = {}, allowedTabs = [], userPresence = [] }) {
  const [expandedGroups, setExpandedGroups] = useState({ inventario: false, devolucion: false, contabilidad: false });
  const allowedSet = new Set(allowedTabs);
  const safeUserPresence = Array.isArray(userPresence) ? userPresence : [];
  const presenceByRoot = safeUserPresence.reduce((map, entry) => {
    const root = getTabRoot(entry.activeTab);
    if (!map.has(root)) map.set(root, []);
    map.get(root).push(entry);
    return map;
  }, new Map());

  const canShowTab = (tab) => {
    const targetId = tab.targetId ?? tab.id;
    if (allowedSet.size === 0) return true;
    if (allowedSet.has(targetId) || allowedSet.has(tab.id)) return true;
    if (tab.id === 'inventario' && allowedSet.has('inventario')) return true;
    if (tab.id === 'devolucion' && allowedSet.has('devolucion')) return true;
    if (tab.id === 'contabilidad' && allowedSet.has('contabilidad')) return true;
    return false;
  };

  const handleTabClick = (tab) => {
    const targetId = tab.targetId ?? tab.id;
    onChange(targetId);

    if (Array.isArray(tab.children) && tab.children.length > 0) return;
  };

  const toggleGroup = (tabId) => {
    setExpandedGroups((current) => ({ ...current, [tabId]: !current[tabId] }));
  };

  const renderTab = (tab) => {
    const targetId = tab.targetId ?? tab.id;
    const isActive =
      !tab.skipActive &&
      (
        activeTab === targetId
        || (tab.id === 'inventario' && String(activeTab).startsWith('inventario'))
        || (tab.id === 'devolucion' && String(activeTab).startsWith('devolucion'))
        || (tab.id === 'contabilidad' && String(activeTab).startsWith('contabilidad'))
      );
    const hasChildren = Array.isArray(tab.children) && tab.children.length > 0;
    const notificationCount = Number(notificationCounts[tab.id]) || 0;
    const tabPresence = presenceByRoot.get(tab.id) ?? [];
    const isExpanded = hasChildren
      ? Boolean(expandedGroups[tab.id])
      : false;

    return (
      <div key={tab.id} className="tab-with-children">
        <div className="tab-row">
          <button type="button" onClick={() => handleTabClick(tab)} className={isActive ? 'tab active' : 'tab'}>
            <span className="tab-main">
              <span className="tab-icon">{renderIcon(tab.icon)}</span>
              <span className="tab-title">{tab.label}</span>
              {notificationCount > 0 ? <span className="tab-badge">{notificationCount}</span> : null}
              {tabPresence.length > 0 ? (
                <span className="sidebar-presence-dots" aria-label={`${tabPresence.length} usuarios activos`}>
                  {tabPresence.slice(0, 3).map((entry) => (
                    <i key={entry.userId} style={{ '--presence-color': colorForPresence(entry) }} title={entry.fullName} />
                  ))}
                </span>
              ) : null}
            </span>
            {tab.hint ? <span className="tab-hint">{tab.hint}</span> : null}
          </button>

          {hasChildren ? (
            <button
              type="button"
              className={`tab-toggle ${isExpanded ? 'expanded' : ''}`}
              onClick={() => toggleGroup(tab.id)}
              aria-label={`Mostrar submodulos de ${tab.label}`}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m6 8 4 4 4-4" />
              </svg>
            </button>
          ) : null}
        </div>

        {hasChildren && isExpanded ? (
          <ul className="tab-submenu">
            {tab.children.map((child) => (
              <li key={child.id}>
                <button
                  type="button"
                  className={`tab-subitem ${activeTab === child.targetId ? 'active' : ''}`}
                  onClick={() => onChange(child.targetId)}
                >
                  {child.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  };

  return (
    <nav className={isCatalogView ? 'tab-list tab-list-inventory' : 'tab-list'} aria-label="Navegacion principal">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 42 42">
            <path
              d="M9 7h24L22 20v12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M15 35h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            <path
              d="M12 9c2.8 1.4 5.8 2.1 9 2.1S27.2 10.4 30 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <p className="sidebar-brand-title">El Copetín</p>
        <span className="sidebar-brand-subtitle">Administrativo</span>
      </div>

      <p className="sidebar-section-title">Operacion</p>
      {operationTabs.filter(canShowTab).map((tab) => renderTab(tab))}

      {configTabs.some(canShowTab) ? <p className="sidebar-section-title">Configuracion</p> : null}
      {configTabs.filter(canShowTab).map((tab) => renderTab(tab))}

      <div className="sidebar-help-card">
        <p>Necesitas ayuda?</p>
        <span>Soporte Copetin</span>
        <button type="button">Contactar</button>
      </div>
    </nav>
  );
}

export default TabsNav;
