export const ROLE_DEFINITIONS = {
  developer: {
    label: 'Developer',
    description: 'Acceso tecnico superior, mantenimiento seguro y herramientas de reset.',
    defaultTab: 'caja',
    allowedTabs: [
      'resumen',
      'items',
      'alquiler',
      'disponibilidad',
      'asistencia',
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
  super_admin: {
    label: 'Super admin',
    description: 'Acceso total operativo del negocio y ajustes, sin gestion tecnica de usuarios.',
    defaultTab: 'caja',
    allowedTabs: [
      'resumen',
      'items',
      'alquiler',
      'disponibilidad',
      'asistencia',
      'proveedores',
      'personal',
      'contabilidad',
      'inventario',
      'devolucion',
      'caja',
      'recibos',
      'categorias',
    ],
  },
  admin: {
    label: 'Admin',
    description: 'Administracion operativa sin herramientas tecnicas de reset.',
    defaultTab: 'caja',
    allowedTabs: [
      'resumen',
      'items',
      'alquiler',
      'disponibilidad',
      'asistencia',
      'proveedores',
      'personal',
      'contabilidad',
      'inventario',
      'devolucion',
      'caja',
      'recibos',
      'categorias',
    ],
  },
  user: {
    label: 'User',
    description: 'Acceso basico de operacion diaria.',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'items', 'alquiler', 'disponibilidad', 'asistencia', 'caja'],
  },
  ventas: {
    label: 'Ventas',
    description: 'Clientes, cotizaciones, contratos y agenda comercial.',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'items', 'alquiler', 'disponibilidad', 'asistencia', 'proveedores', 'caja'],
  },
  inventario: {
    label: 'Inventario',
    description: 'Productos, stock, movimientos y ajustes.',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'disponibilidad', 'asistencia', 'caja', 'inventario'],
  },
  transporte: {
    label: 'Transporte',
    description: 'Entregas, recojos, flota, choferes y calendario.',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'asistencia', 'devolucion', 'caja'],
  },
  contabilidad: {
    label: 'Contabilidad',
    description: 'Reportes, caja operativa, personal y transporte.',
    defaultTab: 'contabilidad',
    allowedTabs: ['resumen', 'asistencia', 'personal', 'devolucion', 'contabilidad', 'recibos', 'caja'],
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

  if (normalized === 'developer' || normalized === 'dev' || normalized.includes('desarrollador')) return 'developer';
  if (normalized === 'super_admin' || normalized === 'superadmin' || normalized.includes('super')) return 'super_admin';
  if (normalized === 'admin' || normalized === 'administrador') return 'admin';
  if (normalized === 'user' || normalized === 'usuario') return 'user';
  if (normalized.includes('invent')) return 'inventario';
  if (normalized.includes('venta') || normalized.includes('comercial')) return 'ventas';
  if (normalized.includes('trans') || normalized.includes('chofer')) return 'transporte';
  if (normalized.includes('cont') || normalized.includes('caja') || normalized.includes('recibo')) return 'contabilidad';
  return ROLE_DEFINITIONS[normalized] ? normalized : 'ventas';
};

export const normalizeRoleIds = (roles) => {
  const source = Array.isArray(roles) ? roles : [roles];
  const normalized = source
    .map((role) => normalizeRoleId(role))
    .filter((roleId) => ROLE_DEFINITIONS[roleId]);
  return [...new Set(normalized)].length > 0 ? [...new Set(normalized)] : ['ventas'];
};

export const getUserRoleIds = (user) => normalizeRoleIds(user?.roleIds ?? user?.roleId ?? user?.role);

export const getPrimaryRoleId = (user) => getUserRoleIds(user)[0] ?? 'ventas';

export const getRoleDefinition = (role) => ROLE_DEFINITIONS[normalizeRoleId(role)] ?? ROLE_DEFINITIONS.ventas;

export const getUserRoleDefinitions = (user) => getUserRoleIds(user).map((roleId) => ROLE_DEFINITIONS[roleId]);

export const getUserDisplayRole = (user) => getUserRoleDefinitions(user).map((role) => role.label).join(', ');

export const DEFAULT_USER_PERMISSIONS = {
  attendanceEnabled: true,
  calendarReadOnly: false,
  ordersReadOnly: false,
};

export const COMPANY_ACCESS_OPTIONS = Object.freeze([
  { id: 'copetin', label: 'El Copetin', description: 'Sistema administrativo, contratos, inventario y caja.' },
  { id: 'lincoln', label: 'Lincoln', description: 'Sistema independiente del Centro de Eventos Lincoln.' },
]);

export const normalizeCompanyAccess = (access, { developer = false } = {}) => {
  if (developer) return ['copetin', 'lincoln'];
  const source = Array.isArray(access) ? access : [access];
  const normalized = source
    .map((entry) => String(entry ?? '').trim().toLowerCase())
    .map((entry) => (entry === 'lincon' ? 'lincoln' : entry))
    .filter((entry) => COMPANY_ACCESS_OPTIONS.some((option) => option.id === entry));
  return [...new Set(normalized)].length > 0 ? [...new Set(normalized)] : ['copetin'];
};

export const getUserCompanyAccess = (user) => normalizeCompanyAccess(user?.companyAccess, {
  developer: isDeveloper(user),
});

export const canAccessCompany = (user, companyId) => getUserCompanyAccess(user)
  .includes(String(companyId ?? '').trim().toLowerCase().replace(/^lincon$/, 'lincoln'));

export const normalizeUserPermissions = (permissions = {}) => ({
  ...DEFAULT_USER_PERMISSIONS,
  attendanceEnabled: permissions?.attendanceEnabled !== false,
  calendarReadOnly: Boolean(permissions?.calendarReadOnly),
  ordersReadOnly: Boolean(permissions?.ordersReadOnly),
});

export const getUserPermissions = (user) => normalizeUserPermissions(user?.permissions);

export const isDeveloper = (user) => getUserRoleIds(user).includes('developer');

export const isSuperAdmin = (user) => getUserRoleIds(user).includes('super_admin');

export const getDefaultTabForUser = (user) => {
  const roleIds = getUserRoleIds(user);
  if (roleIds.includes('developer')) return ROLE_DEFINITIONS.developer.defaultTab;
  if (roleIds.includes('super_admin')) return ROLE_DEFINITIONS.super_admin.defaultTab;
  return ROLE_DEFINITIONS[getPrimaryRoleId(user)]?.defaultTab ?? ROLE_DEFINITIONS.ventas.defaultTab;
};

export const getAllowedTabRoots = (user) => new Set(
  getUserRoleIds(user).flatMap((roleId) => ROLE_DEFINITIONS[roleId]?.allowedTabs ?? []),
);

export const canAccessTab = (user, tabId) => {
  if (!user) return false;
  const target = String(tabId ?? '');
  const permissions = getUserPermissions(user);
  if (target === 'asistencia' && !permissions.attendanceEnabled) return false;
  const roots = getAllowedTabRoots(user);
  if (roots.has(target)) return true;
  if (target.startsWith('inventario')) return roots.has('inventario');
  if (target.startsWith('devolucion')) return roots.has('devolucion');
  if (target.startsWith('contabilidad')) return roots.has('contabilidad');
  return false;
};

export const canWriteTab = (user, tabId) => {
  if (!canAccessTab(user, tabId)) return false;
  const target = String(tabId ?? '');
  const permissions = getUserPermissions(user);
  if (target === 'caja' && permissions.calendarReadOnly) return false;
  if (target === 'alquiler' && permissions.ordersReadOnly) return false;
  return true;
};
