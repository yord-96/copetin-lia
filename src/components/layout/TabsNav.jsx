import { useState } from 'react';

const operationTabs = [
  { id: 'resumen', label: 'Dashboard', icon: 'home', hint: '' },
  { id: 'caja', label: 'Calendario', icon: 'calendar', hint: '' },
  { id: 'items', label: 'Clientes', icon: 'users', hint: '' },
  { id: 'alquiler', label: 'Ordenes de Servicio', icon: 'clipboard', hint: '' },
  { id: 'proveedores', label: 'Proveedores', icon: 'store', hint: '' },
  { id: 'personal', label: 'Personal', icon: 'user', hint: '' },
  {
    id: 'inventario',
    label: 'Inventario',
    icon: 'box',
    hint: '',
    children: [
      { id: 'inventario_productos', label: 'Productos', targetId: 'inventario_productos' },
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
      { id: 'transporte_entregas', label: 'Entregas', targetId: 'devolucion_entregas' },
      { id: 'transporte_recojos', label: 'Recojos', targetId: 'devolucion_recojos' },
      { id: 'transporte_flota', label: 'Flota y Choferes', targetId: 'devolucion_rutas' },
    ],
  },
  { id: 'recibos', label: 'Reportes', icon: 'chart', hint: '' },
  { id: 'contabilidad', label: 'Contabilidad', icon: 'money', hint: '' },
];

const configTabs = [
  { id: 'usuarios', targetId: 'usuarios', label: 'Usuarios', icon: 'user' },
  { id: 'categorias', targetId: 'categorias', label: 'Ajustes', icon: 'gear' },
];

function renderIcon(icon) {
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
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M3 6h11v9H3zM14 9h3.5L21 12v3h-7z" />
        <circle cx="8" cy="17.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="18" cy="17.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }

  if (icon === 'calendar') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      </svg>
    );
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
  return target;
}

function TabsNav({ activeTab, isCatalogView, onChange, notificationCounts = {}, allowedTabs = [], userPresence = [] }) {
  const [expandedGroups, setExpandedGroups] = useState({ inventario: false, devolucion: false });
  const allowedSet = new Set(allowedTabs);
  const presenceByRoot = userPresence.reduce((map, entry) => {
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
                    <i key={entry.userId} style={{ '--presence-color': entry.color }} title={entry.fullName} />
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
