import { getWebBridge, getWebRuntimeInfo, WEB_DB_STORAGE_KEY } from './webBridge';

const SHARED_DEMO_DB_ENDPOINT = '/__copetin_db';
const SYNC_CHANNEL_NAME = 'copetin-data-sync-v1';
const SYNC_THROTTLE_MS = 900;
const REMOTE_POLL_MS = 3500;
const REMOTE_POLL_HIDDEN_MS = 12000;
const REMOTE_API_BASE_URL = String(import.meta.env?.VITE_API_URL ?? '').replace(/\/+$/, '');
const INTERNAL_KEY = String(
  import.meta.env?.VITE_APP_INTERNAL_KEY
    ?? import.meta.env?.APP_INTERNAL_KEY
    ?? '',
).trim();

const browserTabId =
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;

let sharedSyncPromise = null;
let lastSharedSyncAt = 0;
let lastSharedRevision = null;
let lastRemotePollAt = 0;
let syncChannel = null;
let syncListenersReady = false;
let syncPollTimer = null;
const syncSubscribers = new Set();

const getBridge = () => getWebBridge();

const getSharedDbUrl = (suffix = '') =>
  REMOTE_API_BASE_URL
    ? `${REMOTE_API_BASE_URL}${SHARED_DEMO_DB_ENDPOINT}${suffix}`
    : `${SHARED_DEMO_DB_ENDPOINT}${suffix}`;

const getInternalHeaders = (extraHeaders = {}) => {
  const headers = { ...extraHeaders };
  if (INTERNAL_KEY) {
    headers['X-App-Internal-Key'] = INTERNAL_KEY;
  }
  return headers;
};

const shouldUseSharedDemoDb = () =>
  typeof window !== 'undefined' && window.location.protocol !== 'file:';

const businessCollections = [
  'categories',
  'clients',
  'users',
  'items',
  'quotes',
  'contracts',
  'suppliers',
  'supplierQuotes',
  'supplierLoans',
  'personnelEmployees',
  'personnelAttendance',
  'personnelIncidents',
  'rentals',
  'deliveries',
  'transportRoutes',
  'vehicles',
  'drivers',
  'calendarEvents',
  'reports',
  'cashSessions',
  'cashMovements',
  'resetLogs',
  'inventoryMovements',
  'stockRecoveries',
];

const hasBusinessData = (state) =>
  Boolean(
    state &&
      businessCollections.some((key) => Array.isArray(state[key]) && state[key].length > 0),
  );

const getLocalStorageBridge = () => getWebBridge().__storage;

const replaceLocalState = async (state) => {
  const storage = getLocalStorageBridge();
  if (storage?.replaceState && state) {
    await storage.replaceState(state);
  }
};

const exportLocalState = async () => {
  const storage = getLocalStorageBridge();
  if (!storage?.exportState) {
    return null;
  }
  return storage.exportState();
};

const fetchSharedState = async () => {
  const response = await fetch(getSharedDbUrl(), {
    cache: 'no-store',
    headers: getInternalHeaders(),
  });
  if (!response.ok) {
    throw new Error('No se pudo leer la base demo compartida.');
  }
  const payload = await response.json();
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'revision')) {
    lastSharedRevision = payload.revision;
  }
  return payload;
};

const fetchSharedMeta = async () => {
  const response = await fetch(getSharedDbUrl('?meta=1'), {
    cache: 'no-store',
    headers: getInternalHeaders(),
  });
  if (!response.ok) {
    throw new Error('No se pudo consultar la revision demo.');
  }
  return response.json();
};

const pushSharedState = async () => {
  if (!shouldUseSharedDemoDb()) {
    return;
  }

  const state = await exportLocalState();
  if (!state) {
    return;
  }

  const response = await fetch(getSharedDbUrl(), {
    method: 'PUT',
    headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      state,
      revision: lastSharedRevision ?? null,
    }),
  });
  const payload = await response.json().catch(() => null);

  if (response.status === 409) {
    throw new Error(
      payload?.error
        || 'Los datos fueron actualizados por otro usuario. Recarga la pagina antes de continuar.',
    );
  }

  if (!response.ok) {
    throw new Error(payload?.error || 'No se pudo guardar la base compartida.');
  }

  if (payload?.revision) {
    lastSharedRevision = payload.revision;
  }
  return payload;
};

const syncSharedState = async ({ force = false } = {}) => {
  if (!shouldUseSharedDemoDb()) {
    return;
  }

  const now = Date.now();
  if (sharedSyncPromise) {
    return sharedSyncPromise;
  }
  if (!force && now - lastSharedSyncAt < SYNC_THROTTLE_MS) {
    return;
  }

  sharedSyncPromise = (async () => {
  try {
    const payload = await fetchSharedState();
    if (payload?.initialized && payload.state) {
      await replaceLocalState(payload.state);
      lastSharedSyncAt = Date.now();
      return;
    }

    const localState = await exportLocalState();
    if (hasBusinessData(localState)) {
      await pushSharedState();
    }
    lastSharedSyncAt = Date.now();
  } catch (error) {
    // In production builds or offline demos the endpoint may not exist.
    // The app can keep working with browser storage in that case.
    console.warn(error);
  } finally {
    sharedSyncPromise = null;
  }
  })();

  return sharedSyncPromise;
};

const notifySubscribers = (payload) => {
  syncSubscribers.forEach((callback) => {
    try {
      callback(payload);
    } catch (error) {
      console.warn(error);
    }
  });
};

const announceDataChange = ({ domain, method }) => {
  const payload = {
    source: browserTabId,
    domain,
    method,
    revision: lastSharedRevision,
    at: new Date().toISOString(),
  };

  if (syncChannel) {
    syncChannel.postMessage(payload);
  }
};

const pollRemoteRevision = async () => {
  if (!shouldUseSharedDemoDb() || syncSubscribers.size === 0) return;

  const now = Date.now();
  const interval = document.visibilityState === 'hidden' ? REMOTE_POLL_HIDDEN_MS : REMOTE_POLL_MS;
  if (now - lastRemotePollAt < interval) return;
  lastRemotePollAt = now;

  try {
    const meta = await fetchSharedMeta();
    const remoteRevision = meta?.revision ?? null;
    if (!remoteRevision) return;
    if (!lastSharedRevision) {
      lastSharedRevision = remoteRevision;
      return;
    }
    if (remoteRevision !== lastSharedRevision) {
      await syncSharedState({ force: true });
      notifySubscribers({ source: 'remote', reason: 'remote-revision', revision: remoteRevision });
    }
  } catch {
    // The revision endpoint exists only in the local shared demo server.
  }
};

const startSyncPoll = () => {
  if (typeof window === 'undefined' || syncPollTimer) return;
  syncPollTimer = window.setInterval(pollRemoteRevision, 1000);
};

const ensureSyncListeners = () => {
  if (syncListenersReady || typeof window === 'undefined') return;
  syncListenersReady = true;

  if ('BroadcastChannel' in window) {
    syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    syncChannel.onmessage = (event) => {
      if (!event.data || event.data.source === browserTabId) return;
      if (event.data.revision) {
        lastSharedRevision = event.data.revision;
      }
      notifySubscribers({ ...event.data, reason: 'broadcast' });
    };
  } else {
    window.addEventListener('storage', (event) => {
      if (event.key !== WEB_DB_STORAGE_KEY) return;
      notifySubscribers({ source: 'storage', reason: 'storage' });
    });
  }

  startSyncPoll();
  document.addEventListener('visibilitychange', pollRemoteRevision);
};

const subscribeToDataChanges = (callback) => {
  ensureSyncListeners();
  startSyncPoll();
  syncSubscribers.add(callback);
  return () => {
    syncSubscribers.delete(callback);
    if (syncSubscribers.size === 0 && syncPollTimer) {
      window.clearInterval(syncPollTimer);
      syncPollTimer = null;
    }
  };
};

const callBridge = async (domain, method, mutates, ...args) => {
  await syncSharedState({ force: mutates });
  const result = await getBridge()[domain][method](...args);
  if (mutates) {
    await pushSharedState();
    announceDataChange({ domain, method });
  }
  return result;
};

export const runtimeInfo =
  {
    ...getWebRuntimeInfo(),
    storage: REMOTE_API_BASE_URL
      ? 'remote-api'
      : shouldUseSharedDemoDb()
        ? 'shared-demo-db'
        : getWebRuntimeInfo().storage,
    apiBaseUrl: REMOTE_API_BASE_URL || 'same-origin',
  };

export const api = {
  sync: {
    subscribe: subscribeToDataChanges,
    pullLatest: () => syncSharedState({ force: true }),
    getRevision: fetchSharedMeta,
  },
  inventory: {
    list: () => callBridge('inventory', 'list', false),
    create: (payload) => callBridge('inventory', 'create', true, payload),
    update: (payload) => callBridge('inventory', 'update', true, payload),
    remove: (payload) => callBridge('inventory', 'remove', true, payload),
    listMovements: () => callBridge('inventory', 'listMovements', false),
    createMovement: (payload) => callBridge('inventory', 'createMovement', true, payload),
    listRecoveries: () => callBridge('inventory', 'listRecoveries', false),
    processRecovery: (payload) => callBridge('inventory', 'processRecovery', true, payload),
  },
  categories: {
    list: () => callBridge('categories', 'list', false),
    create: (payload) => callBridge('categories', 'create', true, payload),
    update: (payload) => callBridge('categories', 'update', true, payload),
    remove: (payload) => callBridge('categories', 'remove', true, payload),
  },
  quotes: {
    list: () => callBridge('quotes', 'list', false),
    create: (payload) => callBridge('quotes', 'create', true, payload),
    update: (payload) => callBridge('quotes', 'update', true, payload),
    remove: (payload) => callBridge('quotes', 'remove', true, payload),
  },
  contracts: {
    list: () => callBridge('contracts', 'list', false),
    create: (payload) => callBridge('contracts', 'create', true, payload),
    update: (payload) => callBridge('contracts', 'update', true, payload),
    remove: (payload) => callBridge('contracts', 'remove', true, payload),
  },
  suppliers: {
    listBundle: () => callBridge('suppliers', 'listBundle', false),
    create: (payload) => callBridge('suppliers', 'create', true, payload),
    update: (payload) => callBridge('suppliers', 'update', true, payload),
    createQuote: (payload) => callBridge('suppliers', 'createQuote', true, payload),
    createLoan: (payload) => callBridge('suppliers', 'createLoan', true, payload),
    updateLoanStatus: (payload) => callBridge('suppliers', 'updateLoanStatus', true, payload),
  },
  personnel: {
    listBundle: () => callBridge('personnel', 'listBundle', false),
    createEmployee: (payload) => callBridge('personnel', 'createEmployee', true, payload),
    updateEmployee: (payload) => callBridge('personnel', 'updateEmployee', true, payload),
    removeEmployee: (payload) => callBridge('personnel', 'removeEmployee', true, payload),
    createIncident: (payload) => callBridge('personnel', 'createIncident', true, payload),
    updateIncident: (payload) => callBridge('personnel', 'updateIncident', true, payload),
    importAttendance: (payload) => callBridge('personnel', 'importAttendance', true, payload),
  },
  clients: {
    list: () => callBridge('clients', 'list', false),
    create: (payload) => callBridge('clients', 'create', true, payload),
    update: (payload) => callBridge('clients', 'update', true, payload),
  },
  users: {
    list: () => callBridge('users', 'list', false),
    create: (payload) => callBridge('users', 'create', true, payload),
    update: (payload) => callBridge('users', 'update', true, payload),
    remove: (payload) => callBridge('users', 'remove', true, payload),
    resendInvite: (payload) => callBridge('users', 'resendInvite', true, payload),
  },
  auth: {
    getSession: () => callBridge('auth', 'getSession', false),
    login: (payload) => callBridge('auth', 'login', true, payload),
    logout: () => callBridge('auth', 'logout', true),
  },
  presence: {
    listActive: () => callBridge('presence', 'listActive', false),
    heartbeat: (payload) => callBridge('presence', 'heartbeat', true, payload),
    leave: (payload) => callBridge('presence', 'leave', true, payload),
  },
  transport: {
    listDeliveries: () => callBridge('transport', 'listDeliveries', false),
    listRoutes: () => callBridge('transport', 'listRoutes', false),
    createDelivery: (payload) => callBridge('transport', 'createDelivery', true, payload),
    updateDelivery: (payload) => callBridge('transport', 'updateDelivery', true, payload),
    createRoute: (payload) => callBridge('transport', 'createRoute', true, payload),
    updateRoute: (payload) => callBridge('transport', 'updateRoute', true, payload),
    registerPickupChecklist: (payload) =>
      callBridge('transport', 'registerPickupChecklist', true, payload),
    listVehicles: () => callBridge('transport', 'listVehicles', false),
    createVehicle: (payload) => callBridge('transport', 'createVehicle', true, payload),
    updateVehicle: (payload) => callBridge('transport', 'updateVehicle', true, payload),
    removeVehicle: (payload) => callBridge('transport', 'removeVehicle', true, payload),
    listDrivers: () => callBridge('transport', 'listDrivers', false),
    createDriver: (payload) => callBridge('transport', 'createDriver', true, payload),
    updateDriver: (payload) => callBridge('transport', 'updateDriver', true, payload),
    removeDriver: (payload) => callBridge('transport', 'removeDriver', true, payload),
  },
  calendar: {
    listEvents: () => callBridge('calendar', 'listEvents', false),
    createEvent: (payload) => callBridge('calendar', 'createEvent', true, payload),
  },
  settings: {
    get: () => callBridge('settings', 'get', false),
    update: (payload) => callBridge('settings', 'update', true, payload),
  },
  reports: {
    listGenerated: () => callBridge('reports', 'listGenerated', false),
    generate: (payload) => callBridge('reports', 'generate', true, payload),
  },
  rentals: {
    list: () => callBridge('rentals', 'list', false),
    create: (payload) => callBridge('rentals', 'create', true, payload),
    updateOperational: (payload) => callBridge('rentals', 'updateOperational', true, payload),
    cancel: (payload) => callBridge('rentals', 'cancel', true, payload),
    remove: (payload) => callBridge('rentals', 'remove', true, payload),
    registerReturn: (payload) => callBridge('rentals', 'registerReturn', true, payload),
  },
  cash: {
    getSummary: () => callBridge('cash', 'getSummary', false),
    listSessions: () => callBridge('cash', 'listSessions', false),
    listMovements: (payload) => callBridge('cash', 'listMovements', false, payload),
    openSession: (payload) => callBridge('cash', 'openSession', true, payload),
    closeSession: (payload) => callBridge('cash', 'closeSession', true, payload),
    updateTreasuryAccounts: (payload) => callBridge('cash', 'updateTreasuryAccounts', true, payload),
    createManualMovement: (payload) => callBridge('cash', 'createManualMovement', true, payload),
    voidAndReplaceMovementReceipt: (payload) => callBridge('cash', 'voidAndReplaceMovementReceipt', true, payload),
    collectReceivable: (payload) => callBridge('cash', 'collectReceivable', true, payload),
    printHistoryReport: (payload) => callBridge('cash', 'printHistoryReport', false, payload),
  },
  system: {
    verifyResetAccess: (payload) => callBridge('system', 'verifyResetAccess', false, payload),
    analyzeReset: (payload) => callBridge('system', 'analyzeReset', false, payload),
    executeReset: (payload) => callBridge('system', 'executeReset', true, payload),
    exportDatabase: (payload) => callBridge('system', 'exportDatabase', true, payload),
    importDatabase: (payload) => callBridge('system', 'importDatabase', true, payload),
    listResetLogs: () => callBridge('system', 'listResetLogs', false),
    reset: (payload) => callBridge('system', 'reset', true, payload),
  },
  printer: {
    printRentalReceipt: (payload) => callBridge('printer', 'printRentalReceipt', false, payload),
    printReturnReceipt: (payload) => callBridge('printer', 'printReturnReceipt', false, payload),
    printCashMovementReceipt: (payload) => callBridge('printer', 'printCashMovementReceipt', false, payload),
    printContract: (payload) => callBridge('printer', 'printContract', false, payload),
    printInventoryOrder: (payload) => callBridge('printer', 'printInventoryOrder', false, payload),
    printRouteSheet: (payload) => callBridge('printer', 'printRouteSheet', false, payload),
  },
  dashboard: {
    get: () => callBridge('dashboard', 'get', false),
  },
};
