export const ROLE_DEFINITIONS = {
  super_admin: {
    label: 'Super admin',
    description: 'Acceso total al sistema, usuarios y ajustes.',
    defaultTab: 'caja',
    allowedTabs: [
      'resumen',
      'items',
      'alquiler',
      'proveedores',
      'personal',
      'contabilidad',
      'inventario',
      'devolucion',
      'caja',
      'recibos',
      'usuarios',
      'categorias',
    ],
  },
  ventas: {
    label: 'Ventas',
    description: 'Clientes, cotizaciones, contratos y agenda comercial.',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'items', 'alquiler', 'proveedores', 'caja'],
  },
  inventario: {
    label: 'Inventario',
    description: 'Productos, stock, movimientos y ajustes.',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'caja', 'inventario'],
  },
  transporte: {
    label: 'Transporte',
    description: 'Entregas, recojos, flota, choferes y calendario.',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'devolucion', 'caja'],
  },
  contabilidad: {
    label: 'Contabilidad',
    description: 'Reportes, caja operativa, personal y transporte.',
    defaultTab: 'contabilidad',
    allowedTabs: ['resumen', 'personal', 'devolucion', 'contabilidad', 'recibos', 'caja'],
  },
};

export const ROLE_OPTIONS = Object.entries(ROLE_DEFINITIONS).map(([id, role]) => ({
  id,
  label: role.label,
  description: role.description,
}));

export const normalizeRoleId = (role) => {
  const normalized = String(role ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (normalized.includes('admin')) return 'super_admin';
  if (normalized.includes('invent')) return 'inventario';
  if (normalized.includes('venta') || normalized.includes('comercial')) return 'ventas';
  if (normalized.includes('trans') || normalized.includes('chofer')) return 'transporte';
  if (normalized.includes('cont') || normalized.includes('caja') || normalized.includes('recibo')) return 'contabilidad';
  return ROLE_DEFINITIONS[normalized] ? normalized : 'ventas';
};

export const getRoleDefinition = (role) => ROLE_DEFINITIONS[normalizeRoleId(role)] ?? ROLE_DEFINITIONS.ventas;

export const getUserDisplayRole = (user) => getRoleDefinition(user?.roleId ?? user?.role).label;

export const isSuperAdmin = (user) => normalizeRoleId(user?.roleId ?? user?.role) === 'super_admin';

export const getDefaultTabForUser = (user) => getRoleDefinition(user?.roleId ?? user?.role).defaultTab;

export const getAllowedTabRoots = (user) => new Set(getRoleDefinition(user?.roleId ?? user?.role).allowedTabs);

export const canAccessTab = (user, tabId) => {
  if (!user) return false;
  const target = String(tabId ?? '');
  const roots = getAllowedTabRoots(user);
  if (roots.has(target)) return true;
  if (target.startsWith('inventario')) return roots.has('inventario');
  if (target.startsWith('devolucion')) return roots.has('devolucion');
  return false;
};
