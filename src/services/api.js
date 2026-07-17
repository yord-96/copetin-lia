import { getWebBridge, getWebRuntimeInfo, WEB_DB_STORAGE_KEY } from './webBridge';

const SERVER_STATE_ENDPOINT = '/__copetin_db';
const SYNC_CHANNEL_NAME = 'copetin-data-sync-v1';
const SERVER_REVISION_STORAGE_KEY = `${WEB_DB_STORAGE_KEY}:server-revision`;
const SYNC_THROTTLE_MS = 2000;
const REMOTE_POLL_MS = 30000;
const REMOTE_POLL_HIDDEN_MS = 120000;
const REMOTE_POLL_TICK_MS = 5000;
const REMOTE_BACKOFF_BASE_MS = 30000;
const REMOTE_BACKOFF_MAX_MS = 180000;
const MUTATION_CONFLICT_RETRIES = 3;
const MUTATION_TRANSIENT_RETRIES = 4;
const SAVE_TRANSIENT_RETRIES = 4;
const DIRECT_STATE_SAVE_MAX_BYTES = 700 * 1024;
const STATE_CHUNK_BYTES = 320 * 1024;
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
let hasLoadedServerState = false;
let serverStateFetchCount = 0;
let lastRemotePollAt = 0;
let remotePollBackoffUntil = 0;
let remotePollBackoffMs = 0;
let syncChannel = null;
let syncListenersReady = false;
let syncPollTimer = null;
const syncSubscribers = new Set();
const inFlightMutations = new Map();
let mutationQueue = Promise.resolve();
let remotePresenceUnsupported = false;

const getBridge = () => getWebBridge();

const getServerStateUrl = (suffix = '') =>
  REMOTE_API_BASE_URL
    ? `${REMOTE_API_BASE_URL}${SERVER_STATE_ENDPOINT}${suffix}`
    : `${SERVER_STATE_ENDPOINT}${suffix}`;

const getApiUrl = (path) =>
  REMOTE_API_BASE_URL
    ? `${REMOTE_API_BASE_URL}${path}`
    : path;

const getInternalHeaders = (extraHeaders = {}) => {
  const headers = { ...extraHeaders };
  if (INTERNAL_KEY) {
    headers['X-App-Internal-Key'] = INTERNAL_KEY;
  }
  return headers;
};

const isLocalHost = () => {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
};

const shouldUseServerState = () => {
  if (typeof window === 'undefined' || window.location.protocol === 'file:') return false;
  return true;
};

const normalizePresenceList = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.active)) return value.active;
  if (Array.isArray(value?.presence)) return value.presence;
  return [];
};

const createServerStateError = async (response, fallbackMessage) => {
  const payload = await response.json().catch(() => null);
  const error = new Error(payload?.error || fallbackMessage);
  error.status = response.status;
  error.payload = payload;
  const retryAfterSeconds = Number(response.headers.get('Retry-After') ?? 0);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    error.retryAfterMs = retryAfterSeconds * 1000;
  }
  return error;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientServerError = (error) =>
  error?.status === 429 || error?.status === 503 || error?.status === 504;

const getRetryDelayMs = (error, attempt) => {
  if (error?.retryAfterMs) {
    return Math.min(Math.max(error.retryAfterMs, 500), 8000);
  }
  return Math.min(700 * (attempt + 1), 3500);
};

const getSaveErrorMessage = (error, fallback) => {
  if (error instanceof TypeError && /fetch/i.test(error.message ?? '')) {
    return isLocalHost()
      ? 'No se pudo conectar con la base local. Reinicia npm run dev y vuelve a intentar la importacion.'
      : 'No se pudo conectar con el servidor. Verifica la conexion e intenta nuevamente.';
  }
  if (error?.status === 413) {
    return 'La copia de seguridad supera el tamano permitido por el servidor.';
  }
  if (error?.status === 429) {
    return 'El servidor esta recibiendo muchas operaciones al mismo tiempo. Espera unos segundos e intenta guardar otra vez.';
  }
  if (error?.status === 409) {
    return 'Otro usuario actualizo datos al mismo tiempo. Vuelve a intentar para guardar con la informacion mas reciente.';
  }
  return error?.message || fallback;
};

const resetRemoteBackoff = () => {
  remotePollBackoffUntil = 0;
  remotePollBackoffMs = 0;
};

const applyRemoteBackoff = (error) => {
  if (error?.status !== 429) return;
  remotePollBackoffMs = remotePollBackoffMs
    ? Math.min(remotePollBackoffMs * 2, REMOTE_BACKOFF_MAX_MS)
    : REMOTE_BACKOFF_BASE_MS;
  remotePollBackoffUntil = Date.now() + remotePollBackoffMs;
};

const businessCollections = [
  'categories',
  'clients',
  'users',
  'items',
  'inventoryCombos',
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
  'cashDebts',
  'attendanceRecords',
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

const canUseBrowserStorage = () => {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage);
  } catch {
    return false;
  }
};

const getCachedServerRevision = () => {
  if (!canUseBrowserStorage()) return null;
  return window.localStorage.getItem(SERVER_REVISION_STORAGE_KEY);
};

const setCachedServerRevision = (revision) => {
  if (!canUseBrowserStorage() || !revision) return;
  window.localStorage.setItem(SERVER_REVISION_STORAGE_KEY, String(revision));
};

const hasCachedLocalState = () => {
  if (!canUseBrowserStorage()) return false;
  return Boolean(window.localStorage.getItem(WEB_DB_STORAGE_KEY));
};

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

const fetchServerState = async (reason = 'sync') => {
  serverStateFetchCount += 1;
  const requestNumber = serverStateFetchCount;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  console.info(`[copetin-sync] GET ${SERVER_STATE_ENDPOINT} #${requestNumber} iniciado`, { reason });
  const response = await fetch(getServerStateUrl(), {
    cache: 'no-store',
    headers: getInternalHeaders(),
  });
  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo leer la base de datos del sistema.');
  }
  const payload = await response.json();
  const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  console.info(`[copetin-sync] GET ${SERVER_STATE_ENDPOINT} #${requestNumber} completado`, {
    reason,
    durationMs: Math.round(finishedAt - startedAt),
    revision: payload?.revision ?? null,
  });
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'revision')) {
    lastSharedRevision = payload.revision;
    setCachedServerRevision(payload.revision);
  }
  return payload;
};

const fetchServerMeta = async () => {
  const response = await fetch(getServerStateUrl('?meta=1'), {
    cache: 'no-store',
    headers: getInternalHeaders(),
  });
  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo consultar la version del servidor.');
  }
  return response.json();
};

const bytesToBase64 = (bytes) => {
  let binary = '';
  const batchSize = 16 * 1024;
  for (let offset = 0; offset < bytes.length; offset += batchSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + batchSize));
  }
  return btoa(binary);
};

const postChunkedStateRequest = async (suffix, payload) => {
  const response = await fetch(getServerStateUrl(`/chunked/${suffix}`), {
    method: 'POST',
    headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo completar el guardado fragmentado.');
  }
  return response.json().catch(() => null);
};

const pushServerStateInChunks = async (state) => {
  const serializedState = JSON.stringify(state);
  const bytes = new TextEncoder().encode(serializedState);
  const totalChunks = Math.ceil(bytes.length / STATE_CHUNK_BYTES);
  const started = await postChunkedStateRequest('start', {
    revision: lastSharedRevision ?? null,
    totalChunks,
    totalBytes: bytes.length,
  });
  const uploadId = started?.uploadId;
  if (!uploadId) {
    throw new Error('El servidor no inicio correctamente el guardado fragmentado.');
  }

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * STATE_CHUNK_BYTES;
    const chunk = bytes.subarray(start, Math.min(bytes.length, start + STATE_CHUNK_BYTES));
    await postChunkedStateRequest('chunk', {
      uploadId,
      index,
      data: bytesToBase64(chunk),
    });
  }

  return postChunkedStateRequest('commit', { uploadId });
};

const pushServerState = async ({ attempt = 0 } = {}) => {
  if (!shouldUseServerState()) {
    return;
  }

  const state = await exportLocalState();
  if (!state) {
    return;
  }

  const serializedPayload = JSON.stringify({
    state,
    revision: lastSharedRevision ?? null,
  });
  if (!isLocalHost() && new TextEncoder().encode(serializedPayload).length > DIRECT_STATE_SAVE_MAX_BYTES) {
    const payload = await pushServerStateInChunks(state);
    if (payload?.revision) {
      lastSharedRevision = payload.revision;
    }
    return payload;
  }

  const response = await fetch(getServerStateUrl(), {
    method: 'PUT',
    headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
    body: serializedPayload,
  });

  if (response.status === 409) {
    throw await createServerStateError(
      response,
      'Los datos fueron actualizados por otro usuario. Recarga la pagina antes de continuar.',
    );
  }

  if (!response.ok) {
    const error = await createServerStateError(response, 'No se pudo guardar en el servidor.');
    if (isTransientServerError(error) && attempt < SAVE_TRANSIENT_RETRIES) {
      applyRemoteBackoff(error);
      await sleep(getRetryDelayMs(error, attempt));
      return pushServerState({ attempt: attempt + 1 });
    }
    throw error;
  }

  const payload = await response.json().catch(() => null);
  if (payload?.revision) {
    lastSharedRevision = payload.revision;
    setCachedServerRevision(payload.revision);
  }
  return payload;
};

const fetchServerPresence = async () => {
  const response = await fetch(getServerStateUrl('/presence'), {
    cache: 'no-store',
    headers: getInternalHeaders(),
  });

  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo leer las sesiones activas.');
  }

  return response.json();
};

const postServerPresence = async (action, payload) => {
  const response = await fetch(getServerStateUrl(`/presence/${action}`), {
    method: 'POST',
    cache: 'no-store',
    headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload ?? {}),
  });

  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo actualizar las sesiones activas.');
  }

  return response.json();
};

const uploadProductImage = async (file, { itemId } = {}) => {
  if (!(file instanceof File)) {
    throw new Error('Selecciona una imagen valida para subir.');
  }
  const response = await fetch(getApiUrl('/api/uploads/products'), {
    method: 'POST',
    headers: getInternalHeaders({
      'Content-Type': file.type || 'application/octet-stream',
      'X-Product-Id': String(itemId ?? 'product').trim() || 'product',
    }),
    body: file,
  });
  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo subir la imagen del producto.');
  }
  return response.json();
};

const uploadAttendancePhoto = async (file, { recordId } = {}) => {
  if (!(file instanceof Blob)) {
    throw new Error('Selecciona una foto valida para subir.');
  }
  const response = await fetch(getApiUrl('/api/uploads/attendance'), {
    method: 'POST',
    headers: getInternalHeaders({
      'Content-Type': file.type || 'application/octet-stream',
      'X-Attendance-Id': String(recordId ?? 'attendance').trim() || 'attendance',
    }),
    body: file,
  });
  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo subir la foto de asistencia.');
  }
  return response.json();
};

const callServerPresence = async (action, payload) => {
  if (!shouldUseServerState() || isLocalHost() || remotePresenceUnsupported) {
    return null;
  }

  try {
    if (action === 'listActive') {
      return await fetchServerPresence();
    }

    const result = await postServerPresence(action, payload);
    announceDataChange({ domain: 'presence', method: action });
    return action === 'leave' ? result?.active ?? [] : result;
  } catch (error) {
    if (error?.status === 404 || error?.status === 405) {
      remotePresenceUnsupported = true;
      return null;
    }
    applyRemoteBackoff(error);
    if (isLocalHost()) {
      return null;
    }
    throw error;
  }
};

const syncServerState = async ({ force = false, required = false, reason = 'sync' } = {}) => {
  if (!shouldUseServerState()) {
    return;
  }

  const now = Date.now();
  if (required && sharedSyncPromise) {
    await sharedSyncPromise.catch(() => {});
  }
  if (sharedSyncPromise) {
    console.info(`[copetin-sync] Reutilizando carga en curso de ${SERVER_STATE_ENDPOINT}`, { reason });
    return sharedSyncPromise;
  }
  if (!force && hasLoadedServerState) {
    return;
  }
  if (!force && now - lastSharedSyncAt < SYNC_THROTTLE_MS) {
    return;
  }

  sharedSyncPromise = (async () => {
  try {
    if (!force && hasCachedLocalState()) {
      const meta = await fetchServerMeta();
      const remoteRevision = meta?.revision ?? null;
      const cachedRevision = getCachedServerRevision();
      if (remoteRevision && cachedRevision && remoteRevision === cachedRevision) {
        resetRemoteBackoff();
        lastSharedRevision = remoteRevision;
        lastSharedSyncAt = Date.now();
        hasLoadedServerState = true;
        return;
      }
    }

    const payload = await fetchServerState(reason);
    resetRemoteBackoff();
    if (payload?.initialized && payload.state) {
      await replaceLocalState(payload.state);
      if (payload.revision) {
        lastSharedRevision = payload.revision;
        setCachedServerRevision(payload.revision);
      }
      lastSharedSyncAt = Date.now();
      hasLoadedServerState = true;
      return;
    }

    const localState = await exportLocalState();
    if (hasBusinessData(localState)) {
      await pushServerState();
    }
    lastSharedSyncAt = Date.now();
    hasLoadedServerState = true;
  } catch (error) {
    applyRemoteBackoff(error);
    if (required) {
      throw error;
    }
    // In local/offline runs the endpoint may not exist.
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

const markServerStateStale = (reason) => {
  hasLoadedServerState = false;
  lastSharedSyncAt = 0;
  console.info(`[copetin-sync] Estado local marcado como pendiente de sincronizacion`, { reason });
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

const normalizeForMutationKey = (value) => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForMutationKey);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        const normalized = normalizeForMutationKey(value[key]);
        if (typeof normalized !== 'undefined') {
          accumulator[key] = normalized;
        }
        return accumulator;
      }, {});
  }
  return value;
};

const getMutationKey = (domain, method, args) =>
  `${domain}.${method}:${JSON.stringify(normalizeForMutationKey(args))}`;

const enqueueMutation = (operation) => {
  const request = mutationQueue.then(operation, operation);
  mutationQueue = request.catch(() => {});
  return request;
};

const pollRemoteRevision = async () => {
  if (!shouldUseServerState() || syncSubscribers.size === 0) return;

  const now = Date.now();
  if (remotePollBackoffUntil && now < remotePollBackoffUntil) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const interval = document.visibilityState === 'hidden' ? REMOTE_POLL_HIDDEN_MS : REMOTE_POLL_MS;
  if (now - lastRemotePollAt < interval) return;
  lastRemotePollAt = now;

  try {
    const meta = await fetchServerMeta();
    resetRemoteBackoff();
    const remoteRevision = meta?.revision ?? null;
    if (!remoteRevision) return;
    if (!lastSharedRevision) {
      lastSharedRevision = remoteRevision;
      return;
    }
    if (remoteRevision !== lastSharedRevision) {
      await syncServerState({ force: true, reason: 'remote-revision' });
      notifySubscribers({ source: 'remote', reason: 'remote-revision', revision: remoteRevision });
    }
  } catch (error) {
    applyRemoteBackoff(error);
    // Production can temporarily throttle polling when several users share IP.
  }
};

const startSyncPoll = () => {
  if (typeof window === 'undefined' || syncPollTimer) return;
  syncPollTimer = window.setInterval(pollRemoteRevision, REMOTE_POLL_TICK_MS);
};

const ensureSyncListeners = () => {
  if (syncListenersReady || typeof window === 'undefined') return;
  syncListenersReady = true;

  if ('BroadcastChannel' in window) {
    syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    syncChannel.onmessage = (event) => {
      if (!event.data || event.data.source === browserTabId) return;
      if (event.data.domain !== 'presence') {
        markServerStateStale('broadcast');
      }
      if (event.data.revision) {
        lastSharedRevision = event.data.revision;
      }
      notifySubscribers({ ...event.data, reason: 'broadcast' });
    };
  } else {
    window.addEventListener('storage', (event) => {
      if (event.key !== WEB_DB_STORAGE_KEY) return;
      markServerStateStale('storage');
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
  const mutationKey = mutates ? getMutationKey(domain, method, args) : '';
  const isPresenceMutation = domain === 'presence';
  if (mutationKey && inFlightMutations.has(mutationKey)) {
    return inFlightMutations.get(mutationKey);
  }

  const request = (async () => {
    const runMutationAttempt = async (attempt = 0) => {
      try {
        await syncServerState({
          force: !isPresenceMutation,
          required: !isPresenceMutation,
          reason: `${domain}.${method}:mutation-preflight`,
        });
      } catch (error) {
        if (isTransientServerError(error) && attempt < MUTATION_TRANSIENT_RETRIES) {
          await sleep(getRetryDelayMs(error, attempt));
          return runMutationAttempt(attempt + 1);
        }
        throw new Error(getSaveErrorMessage(error, 'No se pudo sincronizar la informacion antes de guardar.'));
      }

      const result = await getBridge()[domain][method](...args);
      if (isPresenceMutation) {
        announceDataChange({ domain, method });
        return result;
      }
      try {
        await pushServerState();
        announceDataChange({ domain, method });
        return result;
      } catch (error) {
        if (isPresenceMutation) {
          applyRemoteBackoff(error);
          if (error?.status === 409) {
            await syncServerState({ force: true, reason: `${domain}.${method}:presence-conflict` });
          }
          return result;
        }

        if (error?.status === 409 && attempt < MUTATION_CONFLICT_RETRIES) {
          await syncServerState({
            force: true,
            required: true,
            reason: `${domain}.${method}:revision-conflict`,
          });
          await sleep(getRetryDelayMs(error, attempt));
          return runMutationAttempt(attempt + 1);
        }

        if (isTransientServerError(error) && attempt < MUTATION_TRANSIENT_RETRIES) {
          await sleep(getRetryDelayMs(error, attempt));
          return runMutationAttempt(attempt + 1);
        }

        throw new Error(getSaveErrorMessage(error, 'No se pudo guardar en el servidor.'));
      }
    };

    if (mutates) {
      return enqueueMutation(() => runMutationAttempt());
    }

    await syncServerState({ force: false, reason: `${domain}.${method}` });
    const result = await getBridge()[domain][method](...args);
    return result;
  })();

  if (mutationKey) {
    inFlightMutations.set(mutationKey, request);
    request.then(
      () => inFlightMutations.delete(mutationKey),
      () => inFlightMutations.delete(mutationKey),
    );
  }

  return request;
};

const updateContractEconomicLedgerOnServer = async (payload = {}) => {
  if (!shouldUseServerState()) {
    return null;
  }

  const requestedId = String(payload?.id ?? payload?.contractId ?? payload?.contractCode ?? '').trim();
  if (!requestedId) {
    throw new Error('Debes indicar el contrato para guardar el cuaderno economico.');
  }

  const response = await fetch(
    getServerStateUrl(`/contracts/${encodeURIComponent(requestedId)}/economic-ledger`),
    {
      method: 'PUT',
      cache: 'no-store',
      headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo guardar el cuaderno economico del contrato.');
  }

  const result = await response.json();
  if (result && Object.prototype.hasOwnProperty.call(result, 'revision')) {
    lastSharedRevision = result.revision;
    setCachedServerRevision(result.revision);
  }
  markServerStateStale('contracts.updateEconomicLedger:direct');
  announceDataChange({ domain: 'contracts', method: 'updateEconomicLedger' });
  return result?.contract ?? null;
};

export const runtimeInfo =
  {
    ...getWebRuntimeInfo(),
    storage: REMOTE_API_BASE_URL
      ? 'remote-api'
      : shouldUseServerState()
        ? 'server-state'
        : getWebRuntimeInfo().storage,
    apiBaseUrl: REMOTE_API_BASE_URL || 'same-origin',
  };

export const api = {
  sync: {
    subscribe: subscribeToDataChanges,
    ensureLoaded: () => syncServerState({ required: true, reason: 'initial-bootstrap' }),
    pullLatest: () => syncServerState({ force: true, reason: 'manual-refresh' }),
    getRevision: fetchServerMeta,
  },
  inventory: {
    list: () => callBridge('inventory', 'list', false),
    listCombos: () => callBridge('inventory', 'listCombos', false),
    create: (payload) => callBridge('inventory', 'create', true, payload),
    update: (payload) => callBridge('inventory', 'update', true, payload),
    remove: (payload) => callBridge('inventory', 'remove', true, payload),
    createCombo: (payload) => callBridge('inventory', 'createCombo', true, payload),
    updateCombo: (payload) => callBridge('inventory', 'updateCombo', true, payload),
    removeCombo: (payload) => callBridge('inventory', 'removeCombo', true, payload),
    listMovements: () => callBridge('inventory', 'listMovements', false),
    createMovement: (payload) => callBridge('inventory', 'createMovement', true, payload),
    listRecoveries: () => callBridge('inventory', 'listRecoveries', false),
    processRecovery: (payload) => callBridge('inventory', 'processRecovery', true, payload),
  },
  uploads: {
    productImage: uploadProductImage,
    attendancePhoto: uploadAttendancePhoto,
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
    listHidden: () => callBridge('contracts', 'listHidden', false),
    create: (payload) => callBridge('contracts', 'create', true, payload),
    update: (payload) => callBridge('contracts', 'update', true, payload),
    updateEconomicLedger: (payload) => updateContractEconomicLedgerOnServer(payload),
    remove: (payload) => callBridge('contracts', 'remove', true, payload),
    restore: (payload) => callBridge('contracts', 'restore', true, payload),
    revertToQuote: (payload) => callBridge('contracts', 'revertToQuote', true, payload),
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
    getSession: async () => {
      const bridge = getBridge();
      const hasStoredSession = await bridge.auth.hasStoredSession();
      if (!hasStoredSession) {
        console.info(`[copetin-sync] Sesion local ausente; se omite GET ${SERVER_STATE_ENDPOINT}`);
        return null;
      }
      await syncServerState({ required: true, reason: 'auth-session' });
      return bridge.auth.getSession();
    },
    login: async (payload) => {
      await syncServerState({ required: true, reason: 'auth-login' });
      const session = await getBridge().auth.login(payload);
      const { __requiresFullStatePush, ...publicSession } = session;
      if (__requiresFullStatePush) {
        pushServerState()
          .then(() => announceDataChange({ domain: 'auth', method: 'login-initial-password' }))
          .catch((error) => {
            applyRemoteBackoff(error);
            console.warn('[copetin-sync] No se pudo guardar cambio inicial de contrasena.', error);
          });
      } else {
        console.info('[copetin-sync] Login sin mutacion persistible; se omite push completo.', {
          downloaded: hasLoadedServerState,
        });
      }
      return publicSession;
    },
    logout: async () => {
      const result = await getBridge().auth.logout();
      announceDataChange({ domain: 'auth', method: 'logout' });
      console.info('[copetin-sync] Logout local sin mutacion persistible; se omite push completo.');
      return result;
    },
  },
  presence: {
    listActive: async () => {
      const active = await callServerPresence('listActive');
      if (active) return normalizePresenceList(active);
      return normalizePresenceList(await callBridge('presence', 'listActive', false));
    },
    heartbeat: async (payload) => {
      const active = await callServerPresence('heartbeat', payload);
      if (active) return normalizePresenceList(active);
      return normalizePresenceList(await callBridge('presence', 'heartbeat', true, payload));
    },
    leave: async (payload) => {
      const active = await callServerPresence('leave', payload);
      if (active) return normalizePresenceList(active);
      return normalizePresenceList(await callBridge('presence', 'leave', true, payload));
    },
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
    listBoardNotes: () => callBridge('calendar', 'listBoardNotes', false),
    upsertBoardNote: (payload) => callBridge('calendar', 'upsertBoardNote', true, payload),
    removeBoardNote: (payload) => callBridge('calendar', 'removeBoardNote', true, payload),
  },
  settings: {
    get: () => callBridge('settings', 'get', false),
    update: (payload) => callBridge('settings', 'update', true, payload),
  },
  reports: {
    listGenerated: () => callBridge('reports', 'listGenerated', false),
    generate: (payload) => callBridge('reports', 'generate', true, payload),
  },
  audit: {
    list: () => callBridge('audit', 'list', false),
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
    listDebts: () => callBridge('cash', 'listDebts', false),
    openSession: (payload) => callBridge('cash', 'openSession', true, payload),
    closeSession: (payload) => callBridge('cash', 'closeSession', true, payload),
    updateTreasuryAccounts: (payload) => callBridge('cash', 'updateTreasuryAccounts', true, payload),
    createManualMovement: (payload) => callBridge('cash', 'createManualMovement', true, payload),
    voidAndReplaceMovementReceipt: (payload) => callBridge('cash', 'voidAndReplaceMovementReceipt', true, payload),
    collectReceivable: (payload) => callBridge('cash', 'collectReceivable', true, payload),
    createDebt: (payload) => callBridge('cash', 'createDebt', true, payload),
    payDebt: (payload) => callBridge('cash', 'payDebt', true, payload),
    deleteDebt: (payload) => callBridge('cash', 'deleteDebt', true, payload),
    printHistoryReport: (payload) => callBridge('cash', 'printHistoryReport', false, payload),
  },
  attendance: {
    listRecords: () => callBridge('attendance', 'listRecords', false),
    createRecord: (payload) => callBridge('attendance', 'createRecord', true, payload),
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
    printInventoryWeek: (payload) => callBridge('printer', 'printInventoryWeek', false, payload),
    printRouteSheet: (payload) => callBridge('printer', 'printRouteSheet', false, payload),
  },
  dashboard: {
    get: () => callBridge('dashboard', 'get', false),
  },
};
