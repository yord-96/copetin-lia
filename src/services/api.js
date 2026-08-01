import { getWebBridge, getWebRuntimeInfo, WEB_DB_STORAGE_KEY } from './webBridge';

const SERVER_STATE_ENDPOINT = '/__copetin_db';
const DEFERRED_BOOTSTRAP_COLLECTIONS = Object.freeze([
  'inventoryMovements',
  'stockRecoveries',
  'cashMovements',
  'cashDebts',
  'generatedReports',
  'systemAuditLog',
  'attendanceRecords',
  'personnelAttendance',
  'personnelIncidents',
]);
const SUMMARIZED_BOOTSTRAP_COLLECTIONS = Object.freeze(['contracts', 'rentals']);
const PARTIAL_BOOTSTRAP_COLLECTIONS = Object.freeze([
  ...DEFERRED_BOOTSTRAP_COLLECTIONS,
  ...SUMMARIZED_BOOTSTRAP_COLLECTIONS,
]);
const CONTRACT_CREATE_PATCH_COLLECTIONS = Object.freeze([
  'clients',
  'items',
  'contracts',
  'systemAuditLog',
]);
const CONTRACT_UPDATE_PATCH_COLLECTIONS = Object.freeze([
  'clients',
  'items',
  'contracts',
  'rentals',
  'deliveries',
  'transportRoutes',
  'calendarEvents',
  'generatedReports',
  'inventoryMovements',
  'systemAuditLog',
]);
const CONTRACT_REMOVE_PATCH_COLLECTIONS = Object.freeze([
  'items',
  'quotes',
  'contracts',
  'rentals',
  'deliveries',
  'transportRoutes',
  'inventoryMovements',
  'stockRecoveries',
  'cashMovements',
  'cashDebts',
  'generatedReports',
  'systemAuditLog',
]);
const CASH_MOVEMENT_PATCH_COLLECTIONS = Object.freeze([
  'cashSessions',
  'cashMovements',
  'contracts',
  'rentals',
]);
const CASH_DEBT_PATCH_COLLECTIONS = Object.freeze([
  'cashSessions',
  'cashMovements',
  'cashDebts',
]);
const RENTAL_CANCEL_PATCH_COLLECTIONS = Object.freeze([
  'items',
  'contracts',
  'rentals',
  'deliveries',
]);
const RENTAL_OPERATIONAL_PATCH_COLLECTIONS = Object.freeze([
  'rentals',
]);
const RENTAL_RETURN_PATCH_COLLECTIONS = Object.freeze([
  'items',
  'rentals',
  'deliveries',
  'stockRecoveries',
  'cashMovements',
]);
const INVENTORY_MOVEMENT_PATCH_COLLECTIONS = Object.freeze([
  'items',
  'inventoryMovements',
]);
const INVENTORY_RECOVERY_PATCH_COLLECTIONS = Object.freeze([
  'items',
  'inventoryMovements',
  'stockRecoveries',
]);
const INVENTORY_ITEM_PATCH_COLLECTIONS = Object.freeze([
  'items',
  'systemAuditLog',
]);
const INVENTORY_COMBO_PATCH_COLLECTIONS = Object.freeze([
  'inventoryCombos',
]);
const USER_PATCH_COLLECTIONS = Object.freeze([
  'users',
]);

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
const STATE_CHUNK_BYTES = 480 * 1024;
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
let mutationBatchDepth = 0;
let mutationBatchPreflightPromise = null;
let mutationBatchDirty = false;
let mutationBatchCollections = null;
let mutationBatchBeforeState = null;
const loadedServerCollections = new Set();
let serverStateIsPartial = false;
let localServerCommitSerial = 0;

const FULL_RECORD_CACHE_TTL_MS = 30 * 1000;
const fullContractCache = new Map();
const fullRentalCache = new Map();
const fullContractRequests = new Map();
const fullRentalRequests = new Map();

const readFreshFullRecordCache = (cache, identifier) => {
  const key = String(identifier ?? '').trim();
  if (!key) return null;
  const cached = cache.get(key);
  if (!cached || Date.now() - cached.cachedAt > FULL_RECORD_CACHE_TTL_MS) {
    if (cached) cache.delete(key);
    return null;
  }
  return cached.record;
};

const rememberFullRecordCache = (cache, record, identifiers = []) => {
  if (!record?.id) return;
  const entry = { record, cachedAt: Date.now() };
  [
    record.id,
    record.contractId,
    record.rentalId,
    record.contractCode,
    record.orderCode,
    record.number,
    ...identifiers,
  ].forEach((identifier) => {
    const key = String(identifier ?? '').trim();
    if (key) cache.set(key, entry);
  });
};

const forgetFullRecordCache = (cache, recordOrIdentifiers = []) => {
  const identifiers = Array.isArray(recordOrIdentifiers)
    ? recordOrIdentifiers
    : [
      recordOrIdentifiers?.id,
      recordOrIdentifiers?.contractId,
      recordOrIdentifiers?.rentalId,
      recordOrIdentifiers?.contractCode,
      recordOrIdentifiers?.orderCode,
      recordOrIdentifiers?.number,
    ];
  const keys = new Set(identifiers.map((identifier) => String(identifier ?? '').trim()).filter(Boolean));
  if (!keys.size) {
    cache.clear();
    return;
  }
  cache.forEach((entry, key) => {
    const record = entry?.record ?? {};
    const entryKeys = [
      key,
      record.id,
      record.contractId,
      record.rentalId,
      record.contractCode,
      record.orderCode,
      record.number,
    ].map((identifier) => String(identifier ?? '').trim()).filter(Boolean);
    if (entryKeys.some((entryKey) => keys.has(entryKey))) {
      cache.delete(key);
    }
  });
};

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

const isRevisionConflictError = (error) =>
  error?.status === 409
  && !error?.payload?.code
  && (
    Object.prototype.hasOwnProperty.call(error?.payload ?? {}, 'currentRevision')
    || Object.prototype.hasOwnProperty.call(error?.payload ?? {}, 'providedRevision')
    || /revision|actualiz/i.test(String(error?.message ?? ''))
  );

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
    if (error?.payload?.code) {
      return error.message || fallback;
    }
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
  'calendarBoardNotes',
  'generatedReports',
  'cashSessions',
  'cashMovements',
  'cashDebts',
  'attendanceRecords',
  'resetLogs',
  'inventoryMovements',
  'stockRecoveries',
  'systemAuditLog',
];
const PATCHABLE_COLLECTIONS = businessCollections;
const PATCH_MAX_CHANGED_ROWS = 250;
const PATCH_MAX_BYTES = 650 * 1024;

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

const isSummaryOnlyRow = (row) =>
  Boolean(row && typeof row === 'object' && !Array.isArray(row) && row._summaryOnly);

const mergeSummaryRecordDetails = (incomingRecord, currentRecord, detailKeys = []) => {
  if (!isSummaryOnlyRow(incomingRecord) || !currentRecord || isSummaryOnlyRow(currentRecord)) {
    return incomingRecord;
  }
  const merged = { ...incomingRecord };
  detailKeys.forEach((key) => {
    const incomingValue = incomingRecord[key];
    const currentValue = currentRecord[key];
    const incomingIsEmptyArray = Array.isArray(incomingValue) && incomingValue.length === 0;
    const incomingIsEmptyObject = incomingValue
      && typeof incomingValue === 'object'
      && !Array.isArray(incomingValue)
      && Object.keys(incomingValue).length === 0;
    const incomingIsEmpty = incomingValue == null || incomingIsEmptyArray || incomingIsEmptyObject;
    if (incomingIsEmpty && currentValue != null) {
      merged[key] = currentValue;
    }
  });
  return merged;
};

const preserveLocalDetailsInSummaries = async (state) => {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
  const hasSummarizedContracts = Array.isArray(state.contracts) && state.contracts.some(isSummaryOnlyRow);
  const hasSummarizedRentals = Array.isArray(state.rentals) && state.rentals.some(isSummaryOnlyRow);
  if (!hasSummarizedContracts && !hasSummarizedRentals) return state;

  const current = await exportLocalCollections([
    ...(hasSummarizedContracts ? ['contracts'] : []),
    ...(hasSummarizedRentals ? ['rentals'] : []),
  ]);
  const nextState = { ...state };

  if (hasSummarizedContracts) {
    const currentContractsById = new Map((Array.isArray(current?.contracts) ? current.contracts : [])
      .map((row) => [String(row?.id ?? '').trim(), row])
      .filter(([id]) => id));
    nextState.contracts = state.contracts.map((row) => mergeSummaryRecordDetails(
      row,
      currentContractsById.get(String(row?.id ?? '').trim()),
      [
        'economicLedger',
        'revisionHistory',
        'supplierFulfillmentPlan',
        'pricingPlan',
        'deletionSnapshot',
      ],
    ));
  }

  if (hasSummarizedRentals) {
    const currentRentalsById = new Map((Array.isArray(current?.rentals) ? current.rentals : [])
      .map((row) => [String(row?.id ?? '').trim(), row])
      .filter(([id]) => id));
    nextState.rentals = state.rentals.map((row) => mergeSummaryRecordDetails(
      row,
      currentRentalsById.get(String(row?.id ?? '').trim()),
      [
        'inventoryAvailabilityAssumptions',
        'returnReport',
        'returnSettlement',
        'supplierFulfillmentPlan',
      ],
    ));
  }

  return nextState;
};

const replaceLocalState = async (state) => {
  const storage = getLocalStorageBridge();
  if (storage?.replaceState && state) {
    await storage.replaceState(await preserveLocalDetailsInSummaries(state));
  }
};

const mergeLocalState = async (state) => {
  const storage = getLocalStorageBridge();
  if (storage?.mergeState && state) {
    await storage.mergeState(await preserveLocalDetailsInSummaries(state));
    return;
  }
  const currentState = await exportLocalState();
  await replaceLocalState(await preserveLocalDetailsInSummaries({ ...(currentState ?? {}), ...(state ?? {}) }));
};

const exportLocalState = async () => {
  const storage = getLocalStorageBridge();
  if (!storage?.exportState) {
    return null;
  }
  return storage.exportState();
};

const exportLocalCollections = async (names = []) => {
  const storage = getLocalStorageBridge();
  if (storage?.exportCollections) {
    return storage.exportCollections(names);
  }
  const state = await exportLocalState();
  if (!state) return null;
  const snapshot = { settings: state.settings ?? {} };
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(state, name)) {
      snapshot[name] = state[name];
    }
  }
  return snapshot;
};

const fetchServerState = async (reason = 'sync', { bootstrap = false } = {}) => {
  serverStateFetchCount += 1;
  const requestNumber = serverStateFetchCount;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  console.info(`[copetin-sync] GET ${SERVER_STATE_ENDPOINT} #${requestNumber} iniciado`, { reason });
  const response = await fetch(getServerStateUrl(bootstrap ? '?bootstrap=1' : ''), {
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

const fetchServerCollections = async (names, reason = 'deferred-load') => {
  const requestedNames = [...new Set((Array.isArray(names) ? names : [])
    .map((name) => String(name ?? '').trim())
    .filter(Boolean))];
  if (!requestedNames.length) return {};
  const response = await fetch(getServerStateUrl(`/collections?names=${encodeURIComponent(requestedNames.join(','))}`), {
    cache: 'no-store',
    headers: getInternalHeaders(),
  });
  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudieron cargar los datos adicionales del sistema.');
  }
  const payload = await response.json();
  if (payload?.revision) {
    lastSharedRevision = payload.revision;
    setCachedServerRevision(payload.revision);
  }
  await mergeLocalState(payload?.collections ?? {});
  requestedNames.forEach((name) => loadedServerCollections.add(name));
  serverStateIsPartial = PARTIAL_BOOTSTRAP_COLLECTIONS.some((name) => !loadedServerCollections.has(name));
  console.info('[copetin-sync] Colecciones diferidas cargadas.', { reason, collections: requestedNames });
  return payload?.collections ?? {};
};

const ensureServerCollectionsLoaded = async (names, reason = 'deferred-load') => {
  if (!shouldUseServerState()) return;
  const missingNames = (Array.isArray(names) ? names : [])
    .filter((name) => PARTIAL_BOOTSTRAP_COLLECTIONS.includes(name) || name === 'cashSessions')
    .filter((name) => !loadedServerCollections.has(name));
  if (!missingNames.length) return;
  await fetchServerCollections(missingNames, reason);
};


const fetchFullServerContract = async (identifier, reason = 'contract-full-load') => {
  const requestedId = String(identifier ?? '').trim();
  if (!requestedId) {
    throw new Error('Debes indicar el contrato que deseas cargar.');
  }

  const cachedContract = readFreshFullRecordCache(fullContractCache, requestedId);
  if (cachedContract) return cachedContract;
  if (fullContractRequests.has(requestedId)) return fullContractRequests.get(requestedId);

  const requestPromise = (async () => {
  const response = await fetch(getServerStateUrl(`/contracts/${encodeURIComponent(requestedId)}`), {
    cache: 'no-store',
    headers: getInternalHeaders(),
  });
  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo cargar el contrato completo.');
  }

  const payload = await response.json();
  const contract = payload?.contract ?? null;
  if (!contract?.id) {
    throw new Error('El servidor no devolvio el contrato completo.');
  }

  if (payload?.revision) {
    rememberServerRevision(payload.revision);
  }

  const localSnapshot = await exportLocalCollections(['contracts']);
  const currentContracts = Array.isArray(localSnapshot?.contracts) ? localSnapshot.contracts : [];
  const nextContracts = currentContracts.some((entry) => String(entry?.id ?? '') === String(contract.id))
    ? currentContracts.map((entry) => (
      String(entry?.id ?? '') === String(contract.id) ? contract : entry
    ))
    : [contract, ...currentContracts];

  await mergeLocalState({ contracts: nextContracts });
  rememberFullRecordCache(fullContractCache, contract, [requestedId]);
  console.info('[copetin-sync] Contrato completo cargado.', {
    reason,
    contractId: contract.id,
    contractCode: contract.contractCode ?? null,
  });
  return contract;
  })();

  fullContractRequests.set(requestedId, requestPromise);
  try {
    return await requestPromise;
  } finally {
    fullContractRequests.delete(requestedId);
  }
};

const fetchFullServerRental = async (identifier, reason = 'rental-full-load') => {
  const requestedId = String(identifier ?? '').trim();
  if (!requestedId) {
    throw new Error('Debes indicar la orden que deseas cargar.');
  }

  const cachedRental = readFreshFullRecordCache(fullRentalCache, requestedId);
  if (cachedRental) return cachedRental;
  if (fullRentalRequests.has(requestedId)) return fullRentalRequests.get(requestedId);

  const requestPromise = (async () => {
  const response = await fetch(getServerStateUrl(`/rentals/${encodeURIComponent(requestedId)}`), {
    cache: 'no-store',
    headers: getInternalHeaders(),
  });
  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo cargar la orden completa.');
  }

  const payload = await response.json();
  const rental = payload?.rental ?? null;
  if (!rental?.id) {
    throw new Error('El servidor no devolvio la orden completa.');
  }

  if (payload?.revision) {
    rememberServerRevision(payload.revision);
  }

  const localSnapshot = await exportLocalCollections(['rentals']);
  const currentRentals = Array.isArray(localSnapshot?.rentals) ? localSnapshot.rentals : [];
  const nextRentals = currentRentals.some((entry) => String(entry?.id ?? '') === String(rental.id))
    ? currentRentals.map((entry) => (
      String(entry?.id ?? '') === String(rental.id) ? rental : entry
    ))
    : [rental, ...currentRentals];

  await mergeLocalState({ rentals: nextRentals });
  rememberFullRecordCache(fullRentalCache, rental, [requestedId]);
  console.info('[copetin-sync] Orden completa cargada.', {
    reason,
    rentalId: rental.id,
    orderCode: rental.orderCode ?? null,
    contractCode: rental.contractCode ?? null,
  });
  return rental;
  })();

  fullRentalRequests.set(requestedId, requestPromise);
  try {
    return await requestPromise;
  } finally {
    fullRentalRequests.delete(requestedId);
  }
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

const getKnownLocalRevision = () => lastSharedRevision ?? getCachedServerRevision();

const getRevisionVersion = (revision) => {
  const match = String(revision ?? '').trim().match(/^(\d+)(?::|$)/);
  return match ? Number(match[1]) : null;
};

const isIncomingRevisionNewer = (incomingRevision, currentRevision = getKnownLocalRevision()) => {
  const incomingVersion = getRevisionVersion(incomingRevision);
  const currentVersion = getRevisionVersion(currentRevision);
  if (incomingVersion !== null && currentVersion !== null) {
    return incomingVersion > currentVersion;
  }
  return Boolean(incomingRevision && incomingRevision !== currentRevision);
};

const rememberServerRevision = (revision) => {
  if (!revision) return;
  lastSharedRevision = revision;
  setCachedServerRevision(revision);
  lastSharedSyncAt = Date.now();
  hasLoadedServerState = true;
};

const ensureServerStateReadyForMutation = async ({
  required = true,
  reason = 'mutation-preflight',
  requiredCollections = null,
} = {}) => {
  if (!shouldUseServerState()) {
    return;
  }

  if (!hasCachedLocalState()) {
    await syncServerState({ force: true, required, reason });
  }

  if (serverStateIsPartial) {
    const requestedCollections = Array.isArray(requiredCollections) && requiredCollections.length
      ? requiredCollections.filter((name) => PARTIAL_BOOTSTRAP_COLLECTIONS.includes(name))
      : PARTIAL_BOOTSTRAP_COLLECTIONS;
    const missingCollections = requestedCollections.filter(
      (name) => !loadedServerCollections.has(name),
    );
    if (missingCollections.length) {
      await fetchServerCollections(missingCollections, `${reason}:load-required-collections`);
    }
  }

  const meta = await fetchServerMeta();
  resetRemoteBackoff();
  const remoteRevision = meta?.revision ?? null;
  const localRevision = getKnownLocalRevision();

  if (remoteRevision && localRevision && remoteRevision === localRevision) {
    lastSharedRevision = remoteRevision;
    setCachedServerRevision(remoteRevision);
    lastSharedSyncAt = Date.now();
    hasLoadedServerState = true;
    return;
  }

  await syncServerState({ force: true, required, reason: `${reason}:revision-mismatch` });
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

  if (serverStateIsPartial) {
    await ensureServerCollectionsLoaded(PARTIAL_BOOTSTRAP_COLLECTIONS, 'full-save-preflight');
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
      rememberServerRevision(payload.revision);
      localServerCommitSerial += 1;
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
    rememberServerRevision(payload.revision);
    localServerCommitSerial += 1;
  }
  return payload;
};

const stableJson = (value) => JSON.stringify(value ?? null);

const buildStatePatch = (beforeState, afterState, collections = PATCHABLE_COLLECTIONS) => {
  if (!beforeState || !afterState) return null;
  const upserts = {};
  const deletes = {};
  let changedRows = 0;

  for (const collection of collections) {
    const beforeRows = Array.isArray(beforeState[collection]) ? beforeState[collection] : [];
    const afterRows = Array.isArray(afterState[collection]) ? afterState[collection] : [];
    const beforeById = new Map();
    const afterIds = new Set();

    for (const row of beforeRows) {
      const id = String(row?.id ?? '').trim();
      if (!id) return null;
      beforeById.set(id, stableJson(row));
    }

    for (const row of afterRows) {
      const id = String(row?.id ?? '').trim();
      if (!id) return null;
      afterIds.add(id);
      if (isSummaryOnlyRow(row)) continue;
      if (beforeById.get(id) !== stableJson(row)) {
        if (!upserts[collection]) upserts[collection] = [];
        upserts[collection].push(row);
        changedRows += 1;
      }
    }

    const removedIds = beforeRows
      .map((row) => String(row?.id ?? '').trim())
      .filter((id) => id && !afterIds.has(id));
    if (removedIds.length > 0) {
      deletes[collection] = removedIds;
      changedRows += removedIds.length;
    }
  }

  const settingsChanged = stableJson(beforeState.settings) !== stableJson(afterState.settings);
  const patch = {
    upserts,
    deletes,
    ...(settingsChanged ? { settings: afterState.settings ?? {} } : {}),
  };
  const hasChanges = changedRows > 0 || settingsChanged;
  if (!hasChanges) return { empty: true };
  if (changedRows > PATCH_MAX_CHANGED_ROWS) return null;
  const patchBytes = new TextEncoder().encode(JSON.stringify(patch)).length;
  if (patchBytes > PATCH_MAX_BYTES) return null;
  return patch;
};

const pushServerStatePatch = async ({ beforeState, afterState, collections = PATCHABLE_COLLECTIONS, attempt = 0 } = {}) => {
  if (!shouldUseServerState()) {
    return null;
  }

  const patch = buildStatePatch(beforeState, afterState, collections);
  if (patch?.empty) {
    return null;
  }
  if (!patch) {
    return pushServerState({ attempt });
  }

  const response = await fetch(getServerStateUrl('/patch'), {
    method: 'POST',
    headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      revision: lastSharedRevision ?? null,
      ...patch,
    }),
  });

  if (response.status === 404 || response.status === 405) {
    return pushServerState({ attempt });
  }

  if (response.status === 409) {
    const error = await createServerStateError(
      response,
      'Los datos fueron actualizados por otro usuario. Recarga la pagina antes de continuar.',
    );
    if (isRevisionConflictError(error) && attempt < MUTATION_CONFLICT_RETRIES) {
      const meta = await fetchServerMeta();
      if (meta?.revision) {
        rememberServerRevision(meta.revision);
      }
      await sleep(getRetryDelayMs(error, attempt));
      return pushServerStatePatch({ beforeState, afterState, collections, attempt: attempt + 1 });
    }
    throw error;
  }

  if (!response.ok) {
    const error = await createServerStateError(response, 'No se pudo guardar el cambio en el servidor.');
    if (isTransientServerError(error) && attempt < SAVE_TRANSIENT_RETRIES) {
      applyRemoteBackoff(error);
      await sleep(getRetryDelayMs(error, attempt));
      return pushServerStatePatch({ beforeState, afterState, collections, attempt: attempt + 1 });
    }
    throw error;
  }

  const payload = await response.json().catch(() => null);
  if (payload?.revision) {
    rememberServerRevision(payload.revision);
    localServerCommitSerial += 1;
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

const fetchServerUpdateNotice = async () => {
  const response = await fetch(getServerStateUrl('/update-notice'), {
    cache: 'no-store',
    headers: getInternalHeaders(),
  });

  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo leer el aviso de actualizacion.');
  }

  return response.json();
};

const postServerUpdateNotice = async (action, payload) => {
  const response = await fetch(getServerStateUrl(`/update-notice/${action}`), {
    method: 'POST',
    cache: 'no-store',
    headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload ?? {}),
  });

  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo publicar el aviso de actualizacion.');
  }

  const result = await response.json();
  announceDataChange({ domain: 'presence', method: `updateNotice.${action}` });
  return result;
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

const syncServerState = async ({ force = false, required = false, reason = 'sync', preferCache = false, notifyWhenUpdated = false } = {}) => {
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
  if (!force && preferCache && hasCachedLocalState()) {
    lastSharedRevision = getCachedServerRevision();
    lastSharedSyncAt = now;
    hasLoadedServerState = true;
    window.setTimeout(() => {
      syncServerState({
        force: true,
        required: false,
        reason: `${reason}:background-refresh`,
        notifyWhenUpdated: true,
      }).catch((error) => {
        applyRemoteBackoff(error);
        console.warn('[copetin-sync] No se pudo refrescar la cache en segundo plano.', error);
      });
    }, 0);
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

    const payload = await fetchServerState(reason, { bootstrap: true });
    resetRemoteBackoff();
    if (payload?.initialized && payload.state) {
      const previousRevision = lastSharedRevision ?? getCachedServerRevision();
      await replaceLocalState(payload.state);
      loadedServerCollections.clear();
      const excludedCollections = Array.isArray(payload.excludedCollections) ? payload.excludedCollections : [];
      const summarizedCollections = Array.isArray(payload.summarizedCollections) ? payload.summarizedCollections : [];
      PARTIAL_BOOTSTRAP_COLLECTIONS.forEach((name) => {
        if (!excludedCollections.includes(name) && !summarizedCollections.includes(name)) {
          loadedServerCollections.add(name);
        }
      });
      serverStateIsPartial = Boolean(
        payload.partial && (excludedCollections.length || summarizedCollections.length),
      );
      if (payload.revision) {
        lastSharedRevision = payload.revision;
        setCachedServerRevision(payload.revision);
      }
      lastSharedSyncAt = Date.now();
      hasLoadedServerState = true;
      if (notifyWhenUpdated && payload.revision && payload.revision !== previousRevision) {
        notifySubscribers({ source: 'background-sync', reason, revision: payload.revision });
      }
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

const announceDataChange = ({ domain, method, collections = null }) => {
  const payload = {
    source: browserTabId,
    origin: 'local-mutation',
    domain,
    method,
    revision: domain === 'presence' ? null : lastSharedRevision,
    collections: Array.isArray(collections) ? collections : null,
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

const runBatchedMutations = async (operation, options = {}) => {
  const isOuterBatch = mutationBatchDepth === 0;
  mutationBatchDepth += 1;
  try {
    if (isOuterBatch) {
      mutationBatchCollections = [...new Set(
        (Array.isArray(options?.collections) && options.collections.length
          ? options.collections
          : PATCHABLE_COLLECTIONS)
          .filter((name) => PATCHABLE_COLLECTIONS.includes(name)),
      )];
      mutationBatchPreflightPromise = ensureServerStateReadyForMutation({
        required: true,
        reason: options?.reason || 'batch.mutation-preflight',
        requiredCollections: mutationBatchCollections,
      });
      await mutationBatchPreflightPromise;
      mutationBatchBeforeState = await exportLocalCollections(mutationBatchCollections);
    }

    const result = await operation();
    if (isOuterBatch && mutationBatchDirty) {
      const afterState = await exportLocalCollections(mutationBatchCollections);
      await pushServerStatePatch({
        beforeState: mutationBatchBeforeState,
        afterState,
        collections: mutationBatchCollections,
      });
      announceDataChange({ domain: 'batch', method: 'commit', collections: mutationBatchCollections });
      mutationBatchDirty = false;
    }
    return result;
  } catch (error) {
    if (isOuterBatch) mutationBatchDirty = false;
    throw error;
  } finally {
    mutationBatchDepth = Math.max(0, mutationBatchDepth - 1);
    if (mutationBatchDepth === 0) {
      mutationBatchPreflightPromise = null;
      mutationBatchDirty = false;
      mutationBatchCollections = null;
      mutationBatchBeforeState = null;
    }
  }
};

const mergeTransactionChangesIntoLocalState = async (changes = {}) => {
  const bridge = getBridge();
  const collectionNames = Object.keys(changes).filter((name) => Array.isArray(changes[name]));
  if (!collectionNames.length) return;
  const current = await bridge.__storage.exportCollections(collectionNames);
  const partialState = {};

  collectionNames.forEach((name) => {
    const existingRows = Array.isArray(current?.[name]) ? current[name] : [];
    const nextRows = [...existingRows];
    const indexById = new Map(nextRows.map((row, index) => [String(row?.id ?? ''), index]));
    changes[name].forEach((row) => {
      if (!row || row._summaryOnly) return;
      const id = String(row?.id ?? '').trim();
      if (!id) return;
      const currentIndex = indexById.get(id);
      if (currentIndex === undefined) {
        indexById.set(id, nextRows.length);
        nextRows.unshift(row);
      } else {
        nextRows[currentIndex] = row;
      }
    });
    partialState[name] = nextRows;
  });

  await bridge.__storage.mergeState(partialState);
};

const createAndApproveContractOnServer = async ({ contract, trace } = {}) => {
  if (!shouldUseServerState()) {
    throw new Error('La aprobacion transaccional requiere conexion con el servidor.');
  }
  if (!contract || contract._summaryOnly) {
    throw new Error('No se puede aprobar un contrato incompleto o resumido.');
  }

  const meta = await fetchServerMeta();
  const revision = meta?.revision ?? getKnownLocalRevision();
  const response = await fetch(getServerStateUrl('/contracts/create-and-approve'), {
    method: 'POST',
    cache: 'no-store',
    headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ contract, trace, revision }),
  });
  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo crear y aprobar el contrato.');
  }
  const payload = await response.json();
  await mergeTransactionChangesIntoLocalState(payload?.changes ?? {});
  if (payload?.revision) {
    rememberServerRevision(payload.revision);
    localServerCommitSerial += 1;
  }
  announceDataChange({
    domain: 'contracts',
    method: 'create-and-approve',
    collections: Object.keys(payload?.changes ?? {}),
  });
  return payload;
};

const pollRemoteRevision = async () => {
  if (!shouldUseServerState() || syncSubscribers.size === 0) return;

  const now = Date.now();
  if (remotePollBackoffUntil && now < remotePollBackoffUntil) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const interval = document.visibilityState === 'hidden' ? REMOTE_POLL_HIDDEN_MS : REMOTE_POLL_MS;
  if (now - lastRemotePollAt < interval) return;
  lastRemotePollAt = now;

  const commitSerialAtStart = localServerCommitSerial;
  try {
    const meta = await fetchServerMeta();
    resetRemoteBackoff();

    // Una mutacion local pudo terminar mientras este GET meta estaba en vuelo.
    // En ese caso la respuesta puede representar una revision anterior y no
    // debe provocar un bootstrap completo.
    if (commitSerialAtStart !== localServerCommitSerial) return;

    const remoteRevision = meta?.revision ?? null;
    if (!remoteRevision) return;
    const localRevision = getKnownLocalRevision();
    if (!localRevision) {
      rememberServerRevision(remoteRevision);
      return;
    }
    if (remoteRevision !== localRevision) {
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
      const payload = event.data;
      if (!payload || payload.source === browserTabId) return;

      // La presencia de otra pestana nunca representa un cambio de base.
      // Antes podia devolver lastSharedRevision a una version antigua y hacer
      // que la siguiente aprobacion descargara todo el bootstrap.
      if (payload.domain === 'presence') {
        notifySubscribers({ ...payload, reason: 'broadcast' });
        return;
      }

      // Ignora anuncios atrasados o duplicados. Solo una revision realmente
      // posterior puede marcar el estado comercial como desactualizado.
      if (payload.revision && !isIncomingRevisionNewer(payload.revision)) {
        return;
      }

      markServerStateStale('broadcast');
      notifySubscribers({ ...payload, reason: 'broadcast' });
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

const getTargetedMutationCollections = (domain, method) => {
  if (domain === 'cash') {
    if (['createDebt', 'payDebt', 'deleteDebt'].includes(method)) {
      return CASH_DEBT_PATCH_COLLECTIONS;
    }
    return CASH_MOVEMENT_PATCH_COLLECTIONS;
  }
  if (domain === 'inventory') {
    if (method === 'processRecovery') return INVENTORY_RECOVERY_PATCH_COLLECTIONS;
    if (method === 'createMovement') return INVENTORY_MOVEMENT_PATCH_COLLECTIONS;
    if (['create', 'update', 'remove'].includes(method)) return INVENTORY_ITEM_PATCH_COLLECTIONS;
    if (['createCombo', 'updateCombo', 'removeCombo'].includes(method)) return INVENTORY_COMBO_PATCH_COLLECTIONS;
  }
  if (domain === 'users' && ['create', 'update', 'remove', 'resendInvite'].includes(method)) {
    return USER_PATCH_COLLECTIONS;
  }
  if (domain === 'rentals' && method === 'updateOperational') {
    return RENTAL_OPERATIONAL_PATCH_COLLECTIONS;
  }
  if (domain === 'rentals' && method === 'registerReturn') {
    return RENTAL_RETURN_PATCH_COLLECTIONS;
  }
  if (domain === 'rentals' && method === 'cancel') {
    return RENTAL_CANCEL_PATCH_COLLECTIONS;
  }
  if (domain !== 'contracts') return null;
  if (method === 'create') return CONTRACT_CREATE_PATCH_COLLECTIONS;
  if (method === 'update') return CONTRACT_UPDATE_PATCH_COLLECTIONS;
  if (method === 'remove') return CONTRACT_REMOVE_PATCH_COLLECTIONS;
  return null;
};

// El preflight solo carga las colecciones necesarias para validar la operación.
// Las colecciones del patch pueden ser más amplias, por ejemplo para agregar
// una entrada de auditoría sin descargar previamente todo el historial.
const getMutationPreflightCollections = (domain, method, targetedCollections) => {
  if (domain === 'contracts' && method === 'remove') {
    return [
      'contracts',
      'rentals',
      'inventoryMovements',
    ];
  }
  if (domain === 'inventory' && ['create', 'update', 'remove'].includes(method)) {
    return ['items'];
  }
  if (domain === 'inventory' && ['createCombo', 'updateCombo', 'removeCombo'].includes(method)) {
    return ['inventoryCombos', 'items'];
  }
  return targetedCollections;
};

const callBridge = async (domain, method, mutates, ...args) => {
  const mutationKey = mutates ? getMutationKey(domain, method, args) : '';
  const isPresenceMutation = domain === 'presence';
  const targetedCollections = mutates ? getTargetedMutationCollections(domain, method) : null;
  const preflightCollections = mutates
    ? getMutationPreflightCollections(domain, method, targetedCollections)
    : null;
  if (mutationKey && inFlightMutations.has(mutationKey)) {
    return inFlightMutations.get(mutationKey);
  }

  const request = (async () => {
    const runMutationAttempt = async (attempt = 0) => {
      try {
        if (!isPresenceMutation) {
          if (mutationBatchDepth > 0) {
            if (!mutationBatchPreflightPromise) {
              mutationBatchPreflightPromise = ensureServerStateReadyForMutation({
                required: true,
                reason: `batch.${domain}.${method}:mutation-preflight`,
                requiredCollections: preflightCollections,
              });
            }
            await mutationBatchPreflightPromise;
          } else {
            await ensureServerStateReadyForMutation({
              required: true,
              reason: `${domain}.${method}:mutation-preflight`,
              requiredCollections: preflightCollections,
            });
          }
        }
      } catch (error) {
        if (isTransientServerError(error) && attempt < MUTATION_TRANSIENT_RETRIES) {
          await sleep(getRetryDelayMs(error, attempt));
          return runMutationAttempt(attempt + 1);
        }
        throw new Error(getSaveErrorMessage(error, 'No se pudo sincronizar la informacion antes de guardar.'));
      }

      const beforeMutationState = !isPresenceMutation && mutationBatchDepth === 0
        ? (targetedCollections
          ? await exportLocalCollections(targetedCollections)
          : await exportLocalState())
        : null;
      const result = await getBridge()[domain][method](...args);
      if (isPresenceMutation) {
        announceDataChange({ domain, method, collections: targetedCollections });
        return result;
      }
      if (mutationBatchDepth > 0) {
        mutationBatchDirty = true;
        return result;
      }
      try {
        const afterMutationState = beforeMutationState
          ? (targetedCollections
            ? await exportLocalCollections(targetedCollections)
            : await exportLocalState())
          : null;
        await pushServerStatePatch({
          beforeState: beforeMutationState,
          afterState: afterMutationState,
          collections: targetedCollections ?? PATCHABLE_COLLECTIONS,
        });
        announceDataChange({ domain, method, collections: targetedCollections });
        return result;
      } catch (error) {
        if (isPresenceMutation) {
          applyRemoteBackoff(error);
        if (isRevisionConflictError(error)) {
          await syncServerState({ force: true, reason: `${domain}.${method}:presence-conflict` });
        }
          return result;
        }

        if (isRevisionConflictError(error) && attempt < MUTATION_CONFLICT_RETRIES) {
          await syncServerState({
            force: true,
            required: true,
            reason: `${domain}.${method}:revision-conflict`,
          });
          const collectionsToReload = targetedCollections ?? PARTIAL_BOOTSTRAP_COLLECTIONS;
          await ensureServerCollectionsLoaded(collectionsToReload, `${domain}.${method}:revision-conflict`);
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


const callDirectCashOperation = async (path, payload = {}) => {
  if (!shouldUseServerState()) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);
  try {
    const clientOperationId = String(payload?.clientOperationId ?? '').trim()
      || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `cash-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const response = await fetch(getServerStateUrl(path), {
      method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ...payload, clientOperationId }),
    });
    if (!response.ok) throw await createServerStateError(response, 'No se pudo registrar la operacion de caja.');
    const result = await response.json();
    if (Object.prototype.hasOwnProperty.call(result ?? {}, 'revision')) {
      lastSharedRevision = result.revision; setCachedServerRevision(result.revision);
    }
    announceDataChange({ domain: 'cash', method: path.includes('collect') ? 'collectReceivable' : 'createManualMovement' });
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('El servidor tardo demasiado en confirmar la operacion. No la repitas: vuelve a abrir el contrato para verificar el recibo.');
    throw error;
  } finally { clearTimeout(timeoutId); }
};

const shouldFallbackToBridgeOperation = (error) => error?.status === 404 || error?.status === 405;

const callDirectRentalReturnOperation = async (payload = {}) => {
  if (!shouldUseServerState()) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(getServerStateUrl('/rentals/register-return'), {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw await createServerStateError(response, 'No se pudo registrar la recepcion.');
    const result = await response.json();
    const rental = result?.rental ?? null;
    if (result?.revision) rememberServerRevision(result.revision);
    if (rental?.id) {
      const localSnapshot = await exportLocalCollections(['rentals']);
      const currentRentals = Array.isArray(localSnapshot?.rentals) ? localSnapshot.rentals : [];
      const nextRentals = currentRentals.some((entry) => String(entry?.id ?? '') === String(rental.id))
        ? currentRentals.map((entry) => (String(entry?.id ?? '') === String(rental.id) ? rental : entry))
        : [rental, ...currentRentals];
      await mergeLocalState({ rentals: nextRentals });
      rememberFullRecordCache(fullRentalCache, rental, [rental.id, rental.orderCode, rental.contractCode]);
    }
    announceDataChange({ domain: 'rentals', method: 'registerReturn', collections: RENTAL_RETURN_PATCH_COLLECTIONS });
    return rental ?? result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('El servidor tardo demasiado en cerrar la recepcion. No la repitas: vuelve a abrir movimientos para verificar el estado.');
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};


const fetchContractEconomicContext = async (identifier) => {
  const requestedId = String(identifier ?? '').trim();
  if (!requestedId) {
    throw new Error('Debes indicar el contrato para abrir el seguimiento economico.');
  }

  if (!shouldUseServerState()) {
    const contract = await callBridge('contracts', 'getById', false, requestedId);
    return { contract, rental: null, serviceOrder: null, cashMovements: [] };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      getServerStateUrl(`/contracts/${encodeURIComponent(requestedId)}/economic-context`),
      {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: getInternalHeaders(),
      },
    );

    if (!response.ok) {
      throw await createServerStateError(
        response,
        'No se pudo cargar el seguimiento economico del contrato.',
      );
    }

    const result = await response.json();
    if (Object.prototype.hasOwnProperty.call(result ?? {}, 'revision')) {
      lastSharedRevision = result.revision;
      setCachedServerRevision(result.revision);
    }
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('El servidor tardo demasiado en abrir el seguimiento economico.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};


const resetContractEconomicsOnServer = async (payload = {}) => {
  if (!shouldUseServerState()) {
    throw new Error('El Reset economico requiere abrir la aplicacion desde el servidor.');
  }

  const requestedId = String(payload?.id ?? payload?.contractId ?? payload?.contractCode ?? '').trim();
  if (!requestedId) {
    throw new Error('Debes indicar el contrato para ejecutar el Reset economico.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(
      getServerStateUrl(`/contracts/${encodeURIComponent(requestedId)}/economic-reset`),
      {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      },
    );
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('El servidor tardo demasiado en ejecutar el Reset economico. No lo repitas: vuelve a abrir el contrato para verificar.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo ejecutar el Reset economico del contrato.');
  }

  const result = await response.json();
  if (Object.prototype.hasOwnProperty.call(result ?? {}, 'revision')) {
    lastSharedRevision = result.revision;
    setCachedServerRevision(result.revision);
  }
  // El endpoint devuelve el contrato completo con el economicLedger ya reemplazado.
  // Debemos guardarlo inmediatamente en la base local antes de disparar la
  // sincronizacion resumida. De lo contrario preserveLocalDetailsInSummaries
  // conserva el economicLedger anterior y vuelve a mezclar las lineas eliminadas.
  if (result?.contract?.id) {
    const localSnapshot = await exportLocalCollections(['contracts']);
    const currentContracts = Array.isArray(localSnapshot?.contracts) ? localSnapshot.contracts : [];
    const nextContracts = currentContracts.some((entry) => String(entry?.id ?? '') === String(result.contract.id))
      ? currentContracts.map((entry) => (
        String(entry?.id ?? '') === String(result.contract.id) ? result.contract : entry
      ))
      : [result.contract, ...currentContracts];
    await mergeLocalState({ contracts: nextContracts });
    rememberFullRecordCache(
      fullContractCache,
      result.contract,
      [requestedId, result.contract.id, result.contract.contractCode],
    );
  }

  if (result?.rental?.id) {
    const localSnapshot = await exportLocalCollections(['rentals']);
    const currentRentals = Array.isArray(localSnapshot?.rentals) ? localSnapshot.rentals : [];
    const nextRentals = currentRentals.some((entry) => String(entry?.id ?? '') === String(result.rental.id))
      ? currentRentals.map((entry) => (
        String(entry?.id ?? '') === String(result.rental.id) ? result.rental : entry
      ))
      : [result.rental, ...currentRentals];
    await mergeLocalState({ rentals: nextRentals });
    rememberFullRecordCache(
      fullRentalCache,
      result.rental,
      [result.rental.id, result.rental.orderCode, result.rental.contractCode],
    );
  }

  forgetFullRecordCache(fullContractCache, [requestedId]);
  markServerStateStale('contracts.resetEconomics:direct');
  announceDataChange({
    domain: 'contracts',
    method: 'resetEconomics',
    collections: ['contracts', 'rentals', 'cashMovements', 'cashDebts', 'generatedReports'],
  });
  return result;
};


const updateContractEconomicLedgerOnServer = async (payload = {}) => {
  if (!shouldUseServerState()) {
    return null;
  }

  const requestedId = String(payload?.id ?? payload?.contractId ?? payload?.contractCode ?? '').trim();
  if (!requestedId) {
    throw new Error('Debes indicar el contrato para guardar el cuaderno economico.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(
      getServerStateUrl(`/contracts/${encodeURIComponent(requestedId)}/economic-ledger`),
      {
        method: 'PUT',
        cache: 'no-store',
        signal: controller.signal,
        headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      },
    );
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('El servidor tardo demasiado en guardar el cuaderno economico. Vuelve a abrirlo antes de repetir la operacion.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

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

const getFilenameFromDisposition = (disposition) => {
  const value = String(disposition ?? '');
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const match = value.match(/filename="?([^";]+)"?/i);
  return match?.[1] ? match[1] : '';
};

const exportDatabaseDirect = async (payload = {}) => {
  if (!shouldUseServerState()) {
    throw new Error('La descarga de bases grandes requiere abrir la app desde el servidor, no desde un archivo local.');
  }

  await callBridge('system', 'verifyResetAccess', false, { code: payload?.code });
  const response = await fetch(getServerStateUrl('/database/export'), {
    method: 'POST',
    cache: 'no-store',
    headers: getInternalHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      code: payload?.code,
      userId: payload?.userId,
      observations: payload?.observations,
    }),
  });

  if (response.status === 404 || response.status === 405) {
    throw new Error('El backend aun no tiene activa la descarga directa. Reinicia el servidor local/API y vuelve a intentar.');
  }
  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo descargar la base de datos.');
  }

  const blob = await response.blob();
  const revision = response.headers.get('X-Copetin-Revision');
  if (revision) {
    rememberServerRevision(revision);
    localServerCommitSerial += 1;
  }
  const exportedAt = response.headers.get('X-Copetin-Exported-At') || new Date().toISOString();
  const filename = getFilenameFromDisposition(response.headers.get('Content-Disposition'))
    || `copetin-base-datos-${String(exportedAt).replace(/[:.]/g, '-')}.json`;
  return {
    ok: true,
    blob,
    filename,
    exportedAt,
    summary: {
      total: Number(response.headers.get('X-Copetin-Summary-Total') ?? 0) || 0,
    },
  };
};

const importDatabaseDirect = async (payload = {}) => {
  if (!payload?.file) {
    return callBridge('system', 'importDatabase', true, payload);
  }
  if (!shouldUseServerState()) {
    throw new Error('La importacion de archivos grandes requiere abrir la app desde el servidor, no desde un archivo local.');
  }

  await callBridge('system', 'verifyResetAccess', false, { code: payload?.code });
  const response = await fetch(getServerStateUrl('/database/import'), {
    method: 'POST',
    cache: 'no-store',
    headers: getInternalHeaders({
      'Content-Type': 'application/octet-stream',
      'X-Copetin-Reset-Code': String(payload?.code ?? ''),
      'X-Copetin-User-Id': String(payload?.userId ?? ''),
      'X-Copetin-Confirmation': String(payload?.confirmation ?? ''),
      'X-Copetin-Observations': encodeURIComponent(String(payload?.observations ?? '')),
    }),
    body: payload.file,
  });

  if (response.status === 404 || response.status === 405) {
    throw new Error('El backend aun no tiene activa la importacion directa. Reinicia el servidor local/API y vuelve a intentar.');
  }
  if (!response.ok) {
    throw await createServerStateError(response, 'No se pudo importar la base de datos.');
  }

  const result = await response.json();
  if (result?.revision) {
    rememberServerRevision(result.revision);
    localServerCommitSerial += 1;
  }
  markServerStateStale('database-import');
  await syncServerState({ force: true, required: true, reason: 'database-import' });
  announceDataChange({ domain: 'system', method: 'importDatabase' });
  return result;
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
    ensureLoaded: (options = {}) => syncServerState({
      required: options?.background ? false : true,
      reason: 'initial-bootstrap',
      preferCache: Boolean(options?.background),
    }),
    pullLatest: () => syncServerState({ force: true, reason: 'manual-refresh' }),
    refreshCollections: (names, reason = 'targeted-refresh') => fetchServerCollections(names, reason),
    getRevision: fetchServerMeta,
    batchMutations: runBatchedMutations,
    ensureCollectionsLoaded: (names, reason) => ensureServerCollectionsLoaded(names, reason),
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
    listMovements: async () => { await ensureServerCollectionsLoaded(['inventoryMovements'], 'inventory-movements'); return callBridge('inventory', 'listMovements', false); },
    createMovement: (payload) => callBridge('inventory', 'createMovement', true, payload),
    listRecoveries: async () => { await ensureServerCollectionsLoaded(['stockRecoveries'], 'stock-recoveries'); return callBridge('inventory', 'listRecoveries', false); },
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
    ensureFull: (identifier, reason) => fetchFullServerContract(identifier, reason),
    getEconomicContext: (identifier) => fetchContractEconomicContext(identifier),
    create: async (payload) => {
      const created = await callBridge('contracts', 'create', true, payload);
      forgetFullRecordCache(fullContractCache, created);
      return created;
    },
    createAndApprove: async (payload) => {
      const result = await createAndApproveContractOnServer(payload);
      forgetFullRecordCache(fullContractCache, result?.contract ?? payload);
      if (result?.rental) forgetFullRecordCache(fullRentalCache, result.rental);
      return result;
    },
    update: async (payload) => {
      forgetFullRecordCache(fullContractCache, payload);
      const updated = await callBridge('contracts', 'update', true, payload);
      forgetFullRecordCache(fullContractCache, updated);
      return updated;
    },
    updateEconomicLedger: async (payload) => {
      forgetFullRecordCache(fullContractCache, payload);
      const updated = await updateContractEconomicLedgerOnServer(payload);
      forgetFullRecordCache(fullContractCache, updated);
      return updated;
    },
    resetEconomics: (payload) => resetContractEconomicsOnServer(payload),
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
    listBundle: async () => { await ensureServerCollectionsLoaded(['personnelAttendance', 'personnelIncidents'], 'personnel-bundle'); return callBridge('personnel', 'listBundle', false); },
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

      // La sesion se reconstruye siempre contra el estado ya hidratado/sincronizado.
      // Evita devolver durante el primer render un rol antiguo guardado en memoria
      // mientras la base parcial todavía se está restaurando en segundo plano.
      await syncServerState({
        required: true,
        reason: 'auth-session',
        notifyWhenUpdated: false,
      });
      return bridge.auth.getSession();
    },
    login: async (payload) => {
      // Un cambio de usuario debe validar credenciales y rol contra la version
      // vigente del servidor, aunque ya exista una carga previa en esta pestaña.
      await syncServerState({ force: true, required: true, reason: 'auth-login' });
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
  updateNotice: {
    get: async () => {
      if (!shouldUseServerState() || isLocalHost()) return null;
      const result = await fetchServerUpdateNotice();
      return result?.notice ?? null;
    },
    publish: async (payload) => {
      if (!shouldUseServerState() || isLocalHost()) return null;
      const result = await postServerUpdateNotice('publish', payload);
      return result?.notice ?? null;
    },
    clear: async () => {
      if (!shouldUseServerState() || isLocalHost()) return null;
      const result = await postServerUpdateNotice('clear');
      return result?.notice ?? null;
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
    listGenerated: async () => { await ensureServerCollectionsLoaded(['generatedReports'], 'generated-reports'); return callBridge('reports', 'listGenerated', false); },
    generate: (payload) => callBridge('reports', 'generate', true, payload),
  },
  audit: {
    list: async () => { await ensureServerCollectionsLoaded(['systemAuditLog'], 'audit-log'); return callBridge('audit', 'list', false); },
  },
  rentals: {
    list: () => callBridge('rentals', 'list', false),
    getFull: (identifier) => fetchFullServerRental(identifier, 'rental-report'),
    create: (payload) => callBridge('rentals', 'create', true, payload),
    updateOperational: (payload) => callBridge('rentals', 'updateOperational', true, payload),
    cancel: (payload) => callBridge('rentals', 'cancel', true, payload),
    remove: (payload) => callBridge('rentals', 'remove', true, payload),
    registerReturn: async (payload) => {
      if (shouldUseServerState()) return callDirectRentalReturnOperation(payload);
      return callBridge('rentals', 'registerReturn', true, payload);
    },
  },
  cash: {
    getSummary: () => callBridge('cash', 'getSummary', false),
    listSessions: () => callBridge('cash', 'listSessions', false),
    listMovements: async (payload) => { await ensureServerCollectionsLoaded(['cashMovements'], 'cash-movements'); return callBridge('cash', 'listMovements', false, payload); },
    listDebts: async () => { await ensureServerCollectionsLoaded(['cashDebts'], 'cash-debts'); return callBridge('cash', 'listDebts', false); },
    openSession: (payload) => callBridge('cash', 'openSession', true, payload),
    closeSession: (payload) => callBridge('cash', 'closeSession', true, payload),
    updateTreasuryAccounts: (payload) => callBridge('cash', 'updateTreasuryAccounts', true, payload),
    createManualMovement: async (payload) => {
      if (shouldUseServerState() && (payload?.linkedContractId || String(payload?.accountingTag ?? '').includes('guarantee') || String(payload?.category ?? '').includes('garantia'))) {
        try {
          const result = await callDirectCashOperation('/cash/manual-economic-movement', payload);
          return result?.movement ?? result;
        } catch (error) {
          if (!shouldFallbackToBridgeOperation(error)) throw error;
          console.warn('[copetin-sync] Endpoint directo de movimiento economico no disponible; usando guardado local.', error);
        }
      }
      return callBridge('cash', 'createManualMovement', true, payload);
    },
    voidAndReplaceMovementReceipt: (payload) => callBridge('cash', 'voidAndReplaceMovementReceipt', true, payload),
    collectReceivable: async (payload) => {
      if (shouldUseServerState()) return callDirectCashOperation('/cash/collect-receivable', payload);
      return callBridge('cash', 'collectReceivable', true, payload);
    },
    createDebt: (payload) => callBridge('cash', 'createDebt', true, payload),
    payDebt: (payload) => callBridge('cash', 'payDebt', true, payload),
    deleteDebt: (payload) => callBridge('cash', 'deleteDebt', true, payload),
    printHistoryReport: (payload) => callBridge('cash', 'printHistoryReport', false, payload),
  },
  attendance: {
    listRecords: async () => { await ensureServerCollectionsLoaded(['attendanceRecords'], 'attendance-records'); return callBridge('attendance', 'listRecords', false); },
    createRecord: (payload) => callBridge('attendance', 'createRecord', true, payload),
  },
  system: {
    verifyResetAccess: (payload) => callBridge('system', 'verifyResetAccess', false, payload),
    analyzeReset: (payload) => callBridge('system', 'analyzeReset', false, payload),
    executeReset: (payload) => callBridge('system', 'executeReset', true, payload),
    exportDatabase: (payload) => exportDatabaseDirect(payload),
    importDatabase: (payload) => importDatabaseDirect(payload),
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
