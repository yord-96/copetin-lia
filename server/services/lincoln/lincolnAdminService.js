import crypto from 'node:crypto';

export const LINCOLN_RESET_CODE = '1703';

export const LINCOLN_RESET_MODULES = [
  {
    id: 'commercial_records',
    level: 'validation',
    risk: 'alto',
    name: 'Reservas y eventos',
    description: 'Elimina interesados, reservas, contratos/eventos y reuniones de Lincoln.',
    warnings: ['También elimina la trazabilidad comercial asociada.'],
    collections: ['reservations', 'leads', 'events', 'meetings'],
  },
  {
    id: 'cash_accounting',
    level: 'critical',
    risk: 'critico',
    name: 'Caja y contabilidad',
    description: 'Elimina pagos, recibos, ingresos, egresos y rendiciones de Lincoln.',
    warnings: ['Descarga la base Lincoln antes de ejecutar esta limpieza.'],
    collections: ['payments', 'receipts', 'incomeEntries', 'expenseEntries', 'eventSettlements'],
  },
  {
    id: 'clients',
    level: 'critical',
    risk: 'alto',
    name: 'Clientes Lincoln',
    description: 'Elimina únicamente el padrón de clientes de Lincoln.',
    warnings: ['No afecta clientes de El Copetín.'],
    collections: ['clients'],
  },
  {
    id: 'catalogs',
    level: 'critical',
    risk: 'critico',
    name: 'Catálogos Lincoln',
    description: 'Elimina salones, paquetes, servicios, extras, proveedores e inventario Lincoln.',
    warnings: ['Los documentos de paquetes podrán volver a sembrarse según las migraciones activas.'],
    collections: ['rooms', 'packages', 'packageServices', 'packageExtras', 'suppliers', 'inventory'],
  },
  {
    id: 'audit_log',
    level: 'critical',
    risk: 'alto',
    name: 'Auditoría Lincoln',
    description: 'Limpia el historial de auditoría de Lincoln y registra esta operación como primer evento.',
    warnings: ['Se perderá el historial previo de cambios.'],
    collections: ['auditLog'],
  },
  {
    id: 'factory_reset',
    level: 'critical',
    risk: 'critico',
    name: 'Reset total Lincoln',
    description: 'Vacía todas las colecciones operativas de la empresa Lincoln.',
    warnings: ['No afecta ningún registro ni archivo de El Copetín.'],
    collections: [
      'reservations', 'leads', 'events', 'rooms', 'packages', 'packageServices', 'packageExtras',
      'clients', 'meetings', 'suppliers', 'inventory', 'payments', 'receipts', 'incomeEntries',
      'expenseEntries', 'eventSettlements', 'auditLog',
    ],
  },
];

const cleanRole = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');

const adminError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

export const assertLincolnAdminAccess = ({ code, actor, expectedCode = LINCOLN_RESET_CODE } = {}) => {
  if (cleanRole(actor?.role) !== 'developer') {
    throw adminError('Solo el rol developer puede administrar la base Lincoln.', 403, 'LINCOLN_ADMIN_FORBIDDEN');
  }
  if (String(code ?? '').trim() !== String(expectedCode ?? LINCOLN_RESET_CODE).trim()) {
    throw adminError('Código de seguridad incorrecto.', 403, 'LINCOLN_RESET_CODE_INVALID');
  }
  return true;
};

const selectedDefinitions = (moduleIds = []) => {
  const requested = new Set((Array.isArray(moduleIds) ? moduleIds : []).map(String));
  if (requested.has('factory_reset')) return LINCOLN_RESET_MODULES.filter((module) => module.id === 'factory_reset');
  return LINCOLN_RESET_MODULES.filter((module) => requested.has(module.id) && module.id !== 'factory_reset');
};

export const analyzeLincolnReset = (state = {}, moduleIds = []) => {
  const modules = selectedDefinitions(moduleIds).map((module) => {
    const total = module.collections.reduce((sum, collection) => sum + (Array.isArray(state?.[collection]) ? state[collection].length : 0), 0);
    return {
      id: module.id,
      name: module.name,
      total,
      deleteCount: total,
      blockedCount: 0,
      dependencies: module.collections.map((collection) => `${collection}: ${Array.isArray(state?.[collection]) ? state[collection].length : 0}`),
      records: { deletable: [], blocked: [] },
    };
  });
  const total = modules.reduce((sum, module) => sum + module.total, 0);
  return {
    modules,
    summary: { total, deletable: total, blocked: 0 },
    canExecute: modules.length > 0,
  };
};

export const applyLincolnReset = ({ state = {}, moduleIds = [], actor = {}, observations = '' } = {}) => {
  const analysis = analyzeLincolnReset(state, moduleIds);
  if (!analysis.canExecute) throw adminError('Selecciona al menos un módulo de Lincoln.', 400, 'LINCOLN_RESET_MODULE_REQUIRED');
  const definitions = selectedDefinitions(moduleIds);
  const nextState = structuredClone(state);
  definitions.flatMap((module) => module.collections).forEach((collection) => {
    nextState[collection] = [];
  });
  const log = {
    id: `LIN-AUD-${crypto.randomUUID()}`,
    action: 'system_reset',
    company: 'lincoln',
    modules: definitions.map((module) => module.id),
    deletedTotal: analysis.summary.deletable,
    observations: String(observations ?? '').trim(),
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? 'Developer',
    createdAt: new Date().toISOString(),
  };
  nextState.auditLog = [...(Array.isArray(nextState.auditLog) ? nextState.auditLog : []), log];
  return { nextState, analysis, deletedTotal: analysis.summary.deletable, log };
};

export const buildLincolnDatabaseBackup = ({ snapshot, actor = {} } = {}) => {
  const state = snapshot?.state ?? {};
  const collectionSummary = Object.fromEntries(
    Object.entries(state).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length]),
  );
  return {
    app: 'centro-eventos-lincoln',
    company: 'lincoln',
    kind: 'database-backup',
    schemaVersion: state.schemaVersion ?? 1,
    exportedAt: new Date().toISOString(),
    exportedBy: { id: actor?.id ?? null, name: actor?.name ?? 'Developer' },
    revision: snapshot?.revision ?? null,
    version: snapshot?.version ?? null,
    summary: {
      collections: collectionSummary,
      total: Object.values(collectionSummary).reduce((sum, count) => sum + count, 0),
    },
    state,
  };
};
