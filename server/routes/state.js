import { Router } from 'express';
import crypto from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { getStateMeta, getStateSnapshot, replaceStateSnapshot, updateStateSnapshot } from '../storage/fileStateStore.js';
import { heartbeatPresence, leavePresence, listPresence } from '../storage/presenceStore.js';
import { clearUpdateNotice, getUpdateNotice, publishUpdateNotice } from '../storage/updateNoticeStore.js';

const router = Router();
const gzipAsync = promisify(gzip);
const internalKey = String(process.env.APP_INTERNAL_KEY ?? '').trim();
const configuredResetSecurityCode = String(process.env.RESET_SECURITY_CODE ?? '').trim();
const resetSecurityCode = configuredResetSecurityCode && configuredResetSecurityCode !== 'cambia-este-codigo'
  ? configuredResetSecurityCode
  : '1703';
const MAX_CHUNKED_STATE_BYTES = Number(process.env.MAX_CHUNKED_STATE_BYTES ?? 64 * 1024 * 1024);
const CHUNK_UPLOAD_TTL_MS = 10 * 60 * 1000;
const chunkUploads = new Map();
const jsonPayloadCache = {
  key: null,
  body: null,
  gzip: null,
};

const deferredBootstrapCollections = Object.freeze([
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
const summarizedBootstrapCollections = Object.freeze(['contracts', 'rentals']);
const readablePartialCollectionSet = new Set([
  'cashSessions',
  ...deferredBootstrapCollections,
  ...summarizedBootstrapCollections,
]);

const summarizeItemLine = (line = {}) => ({
  itemId: line.itemId ?? '',
  itemName: line.itemName ?? line.name ?? '',
  name: line.name ?? line.itemName ?? '',
  quantity: line.quantity ?? 0,
  unitPriceBs: line.unitPriceBs ?? null,
  rentalPriceBs: line.rentalPriceBs ?? null,
  grossLineTotalBs: line.grossLineTotalBs ?? null,
  discountPercent: line.discountPercent ?? 0,
  discountBs: line.discountBs ?? 0,
  lineTotalBs: line.lineTotalBs ?? null,
  lineType: line.lineType ?? '',
  controlsStock: line.controlsStock,
  verificationStatus: line.verificationStatus,
  supplierBackedQty: line.supplierBackedQty ?? 0,
  internalReservedQty: line.internalReservedQty ?? null,
  serviceDayId: line.serviceDayId ?? null,
  serviceDate: line.serviceDate ?? null,
  serviceDayLabel: line.serviceDayLabel ?? null,
  comboId: line.comboId ?? null,
  comboName: line.comboName ?? '',
  comboLineKey: line.comboLineKey ?? null,
  comboComponentName: line.comboComponentName ?? '',
  comboQuantity: line.comboQuantity ?? 1,
  comboComponentQuantity: line.comboComponentQuantity ?? 1,
  comboPricingRole: line.comboPricingRole ?? '',
  comboPricingCondition: line.comboPricingCondition ?? null,
  comboRuleIndex: line.comboRuleIndex ?? 0,
  comboSlotLabel: line.comboSlotLabel ?? '',
  comboSelectionMode: line.comboSelectionMode ?? 'item',
  comboOptionItemIds: Array.isArray(line.comboOptionItemIds) ? line.comboOptionItemIds : [],
  comboCategory: line.comboCategory ?? '',
});

const summarizeContract = (contract = {}) => ({
  ...contract,
  items: (Array.isArray(contract.items) ? contract.items : []).map(summarizeItemLine),
  revisionHistory: [],
  economicLedger: Array.isArray(contract.economicLedger) ? contract.economicLedger : [],
  deletionSnapshot: null,
  _summaryOnly: true,
});

const summarizeRental = (rental = {}) => ({
  ...rental,
  items: (Array.isArray(rental.items) ? rental.items : []).map(summarizeItemLine),
  inventoryAvailabilityAssumptions: null,
  returnReport: null,
  // La tabla de contratos necesita el saldo económico final sin descargar
  // todo el informe de devolución. Conservamos únicamente el resumen mínimo.
  returnSettlement: rental?.returnSettlement
    ? {
        pendingCollectionBs: rental.returnSettlement.pendingCollectionBs ?? null,
        penaltiesBs: rental.returnSettlement.penaltiesBs ?? 0,
        paidBs: rental.returnSettlement.paidBs ?? null,
        accountingStatus: rental.returnSettlement.accountingStatus ?? '',
        settledAt: rental.returnSettlement.settledAt ?? null,
      }
    : null,
  _summaryOnly: true,
});

const summarizeBootstrapCollection = (name, rows) => {
  if (name === 'contracts') return rows.map(summarizeContract);
  if (name === 'rentals') return rows.map(summarizeRental);
  return rows;
};
const allowedEconomicLedgerTypes = new Set(['deposit', 'guarantee', 'charge', 'refund', 'note']);
const allowedEconomicLedgerPaymentMethods = new Set(['efectivo', 'qr', 'transferencia']);
const patchableCollections = new Set([
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
]);
const databaseBackupCollections = [
  ...patchableCollections,
  'userPresence',
];

const makeEconomicLedgerId = () => `eco-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

const toPositiveRoundedNumber = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100) / 100;
};

const normalizeEconomicLedgerRows = (rows) => {
  if (!Array.isArray(rows)) return [];
  return rows.map((entry) => {
    const type = allowedEconomicLedgerTypes.has(entry?.type) ? entry.type : 'note';
    const paymentMethodCandidate = String(entry?.paymentMethod ?? entry?.method ?? '').trim().toLowerCase();
    const paymentMethod = type === 'note'
      ? ''
      : allowedEconomicLedgerPaymentMethods.has(paymentMethodCandidate)
        ? paymentMethodCandidate
        : 'efectivo';
    return {
      id: String(entry?.id ?? '').trim() || makeEconomicLedgerId(),
      type,
      amountBs: type === 'note'
        ? 0
        : toPositiveRoundedNumber(entry?.amountBs ?? entry?.amount),
      paymentMethod,
      paymentAccount: paymentMethod === 'qr'
        ? String(entry?.paymentAccount ?? entry?.account ?? '').trim().toUpperCase()
        : '',
      note: String(entry?.note ?? '').trim(),
      createdAt: String(entry?.createdAt ?? '').trim() || new Date().toISOString(),
      createdById: entry?.createdById ?? entry?.userId ?? null,
      createdByName: String(entry?.createdByName ?? entry?.userName ?? 'Sistema').trim() || 'Sistema',
      editedAt: String(entry?.editedAt ?? '').trim() || null,
      editedByName: String(entry?.editedByName ?? '').trim(),
      cashMovementId: String(entry?.cashMovementId ?? '').trim() || null,
      cashReceiptCode: String(entry?.cashReceiptCode ?? '').trim(),
      isCashRegistered: Boolean(entry?.isCashRegistered),
      reclassifiedFromPayment: Boolean(entry?.reclassifiedFromPayment),
      deletedAt: String(entry?.deletedAt ?? '').trim() || null,
      deletedById: entry?.deletedById ?? null,
      deletedByName: String(entry?.deletedByName ?? '').trim(),
      deletionReason: String(entry?.deletionReason ?? '').trim(),
    };
  });
};

const cleanupExpiredChunkUploads = () => {
  const cutoff = Date.now() - CHUNK_UPLOAD_TTL_MS;
  chunkUploads.forEach((upload, uploadId) => {
    if (upload.createdAt < cutoff) {
      chunkUploads.delete(uploadId);
    }
  });
};

const sendRevisionConflict = (req, res, error) => {
  console.warn('[state-route] Guardado rechazado por conflicto de revision.', {
    currentRevision: error.currentRevision,
    providedRevision: error.providedRevision,
    version: error.version,
    updatedAt: error.updatedAt,
    ip: req.ip,
  });
  res.status(409).json({
    error: 'Los datos fueron actualizados por otro usuario. Recarga la pagina antes de continuar.',
    currentRevision: error.currentRevision,
    providedRevision: error.providedRevision,
    version: error.version,
    updatedAt: error.updatedAt,
  });
};

const sendStateGuardError = (req, res, error) => {
  console.warn('[state-route] Guardado bloqueado por proteccion de datos.', {
    code: error?.code,
    message: error?.message,
    ip: req.ip,
  });
  res.status(error.statusCode || 409).json({
    error: error.message || 'Guardado bloqueado por proteccion de datos.',
    code: error.code || 'STATE_GUARD_BLOCKED',
  });
};

const requireInternalKey = (req, res, next) => {
  if (!internalKey) {
    next();
    return;
  }

  const providedKey = String(req.get('X-App-Internal-Key') ?? '').trim();
  if (!providedKey) {
    res.status(401).json({ error: 'Clave interna requerida.' });
    return;
  }
  if (providedKey !== internalKey) {
    res.status(403).json({ error: 'Clave interna invalida.' });
    return;
  }
  next();
};

const sendJsonPayload = async (req, res, payload) => {
  const startedAt = Date.now();
  const payloadScope = payload?.collections
    ? `collections:${Object.keys(payload.collections).sort().join(',')}`
    : payload?.partial
      ? `bootstrap:${(payload.excludedCollections ?? []).join(',')}`
      : 'full';
  const cacheKey = `${String(payload?.revision ?? payload?.updatedAt ?? payload?.version ?? 'no-revision')}:${payloadScope}`;
  if (jsonPayloadCache.key !== cacheKey || !jsonPayloadCache.body) {
    jsonPayloadCache.key = cacheKey;
    jsonPayloadCache.body = JSON.stringify(payload);
    jsonPayloadCache.gzip = null;
  }
  const body = jsonPayloadCache.body;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');

  if (/\bgzip\b/i.test(String(req.get('Accept-Encoding') ?? '')) && body.length > 1024) {
    if (!jsonPayloadCache.gzip) {
      jsonPayloadCache.gzip = await gzipAsync(Buffer.from(body), { level: 6 });
    }
    const compressed = jsonPayloadCache.gzip;
    console.info('[state-route] Estado enviado comprimido.', {
      originalBytes: Buffer.byteLength(body),
      gzipBytes: compressed.length,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
    });
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', String(compressed.length));
    res.send(compressed);
    return;
  }

  console.info('[state-route] Estado enviado sin compresion.', {
    bytes: Buffer.byteLength(body),
    durationMs: Date.now() - startedAt,
    ip: req.ip,
  });
  res.setHeader('Content-Length', String(Buffer.byteLength(body)));
  res.send(body);
};

const normalizeRoleId = (role) => {
  const normalized = String(role ?? '').trim().toLowerCase();
  if (normalized === 'developer' || normalized === 'dev' || normalized.includes('desarrollador')) return 'developer';
  if (normalized === 'super_admin' || normalized === 'superadmin' || normalized.includes('super')) return 'super_admin';
  return normalized;
};

const getUserRoleIds = (user) => {
  const roles = Array.isArray(user?.roleIds)
    ? user.roleIds
    : [user?.roleId ?? user?.role];
  return [...new Set(roles.map(normalizeRoleId).filter(Boolean))];
};

const isDeveloperUser = (user) => getUserRoleIds(user).includes('developer');

const getUserDisplayRole = (user) => (
  getUserRoleIds(user).includes('developer') ? 'Developer' : String(user?.role ?? user?.roleId ?? 'Usuario')
);

const assertDeveloperDatabaseAccess = (state, { code, userId } = {}) => {
  const cleanCode = String(code ?? '').trim();
  if (!resetSecurityCode || cleanCode !== resetSecurityCode) {
    const error = new Error('Contrasena de seguridad incorrecta.');
    error.statusCode = 403;
    throw error;
  }

  const requestedUserId = String(userId ?? '').trim();
  const currentUser = (Array.isArray(state?.users) ? state.users : [])
    .find((user) => String(user?.id ?? '').trim() === requestedUserId && !user?.deletedAt);
  if (!currentUser || !isDeveloperUser(currentUser)) {
    const error = new Error('Solo el rol developer puede respaldar o importar la base.');
    error.statusCode = 403;
    throw error;
  }
  if (currentUser.status !== 'active') {
    const error = new Error('El usuario developer no esta activo.');
    error.statusCode = 403;
    throw error;
  }
  return currentUser;
};

const countBackupRows = (state) =>
  databaseBackupCollections.reduce((summary, key) => {
    const count = Array.isArray(state?.[key]) ? state[key].filter((entry) => !entry?.deletedAt).length : 0;
    return {
      ...summary,
      [key]: count,
      total: summary.total + count,
    };
  }, { total: 0 });

const buildDatabaseBackup = ({ state, currentUser, action = 'export' }) => ({
  app: 'el-copetin',
  kind: 'database-backup',
  schemaVersion: state?.schemaVersion ?? 3,
  exportedAt: new Date().toISOString(),
  exportedBy: {
    id: currentUser?.id ?? null,
    name: currentUser?.fullName ?? currentUser?.username ?? 'Developer',
    role: getUserDisplayRole(currentUser),
  },
  action,
  summary: countBackupRows(state),
  state,
});

const extractBackupState = (payload) => {
  const candidate = payload?.state ?? payload?.database ?? payload?.backup ?? payload;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    const error = new Error('El archivo importado no contiene una base de datos valida.');
    error.statusCode = 400;
    throw error;
  }
  return candidate;
};

const readRawRequestBody = async (req, maxBytes = MAX_CHUNKED_STATE_BYTES) => {
  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of req) {
    receivedBytes += chunk.length;
    if (receivedBytes > maxBytes) {
      const error = new Error('La base supera el limite permitido para importacion.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
};

router.use('/__copetin_db', requireInternalKey);

router.post('/__copetin_db/database/export', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    if (!snapshot.initialized || !snapshot.state) {
      res.status(404).json({ error: 'La base de datos aun no esta inicializada.' });
      return;
    }

    const currentUser = assertDeveloperDatabaseAccess(snapshot.state, {
      code: req.body?.code,
      userId: req.body?.userId,
    });
    const backup = buildDatabaseBackup({ state: snapshot.state, currentUser, action: 'export' });
    const exportedAt = backup.exportedAt;
    const filename = `copetin-base-datos-${exportedAt.replace(/[:.]/g, '-')}.json`;
    const body = JSON.stringify(backup, null, 2);
    const auditResult = await updateStateSnapshot((state) => {
      state.resetLogs = Array.isArray(state.resetLogs) ? state.resetLogs : [];
      state.resetLogs.unshift({
        id: `rst-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        userId: currentUser.id,
        userName: currentUser.fullName,
        userRole: getUserDisplayRole(currentUser),
        action: 'database_export',
        modules: ['database_backup'],
        summary: {
          ...countBackupRows(state),
          exportedCollections: databaseBackupCollections.length,
        },
        result: 'success',
        errors: [],
        observations: String(req.body?.observations ?? 'Descarga completa de base de datos.').trim(),
        ip: req.ip,
        createdAt: new Date().toISOString(),
      });
      return state;
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(Buffer.byteLength(body)));
    res.setHeader('X-Copetin-Exported-At', exportedAt);
    res.setHeader('X-Copetin-Summary-Total', String(backup.summary.total ?? 0));
    res.setHeader('X-Copetin-Revision', String(auditResult?.revision ?? snapshot.revision ?? ''));
    res.send(body);
  } catch (error) {
    if (error?.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.post('/__copetin_db/database/import', async (req, res, next) => {
  try {
    const confirmation = String(req.get('X-Copetin-Confirmation') ?? '').trim().toUpperCase();
    if (confirmation !== 'IMPORTAR') {
      res.status(400).json({ error: 'Debes escribir IMPORTAR para reemplazar la base.' });
      return;
    }

    const snapshot = await getStateSnapshot();
    if (!snapshot.initialized || !snapshot.state) {
      res.status(404).json({ error: 'La base de datos aun no esta inicializada.' });
      return;
    }

    const currentUser = assertDeveloperDatabaseAccess(snapshot.state, {
      code: req.get('X-Copetin-Reset-Code'),
      userId: req.get('X-Copetin-User-Id'),
    });
    const rawBody = await readRawRequestBody(req);
    const importedState = extractBackupState(JSON.parse(rawBody));
    const importedDevelopers = (Array.isArray(importedState.users) ? importedState.users : [])
      .filter((user) => !user.deletedAt && user.status === 'active' && isDeveloperUser(user));
    if (importedDevelopers.length === 0) {
      res.status(400).json({ error: 'La base importada no tiene ningun usuario developer activo.' });
      return;
    }

    const nextState = { ...importedState };
    const hasCurrentDeveloper = (Array.isArray(nextState.users) ? nextState.users : [])
      .some((user) => user.id === currentUser.id && isDeveloperUser(user));
    nextState.users = Array.isArray(nextState.users) ? nextState.users : [];
    if (!hasCurrentDeveloper) {
      nextState.users.push({
        ...currentUser,
        status: 'active',
        deletedAt: null,
        isCurrentUser: true,
        updatedAt: new Date().toISOString(),
      });
    }
    nextState.users = nextState.users.map((user) => ({
      ...user,
      isCurrentUser: user.id === currentUser.id,
    }));

    const preservedLogs = [
      ...(Array.isArray(nextState.resetLogs) ? nextState.resetLogs : []),
      ...(Array.isArray(snapshot.state.resetLogs) ? snapshot.state.resetLogs : []),
    ];
    const uniqueLogs = [];
    const seenLogIds = new Set();
    preservedLogs.forEach((log) => {
      const id = String(log?.id ?? '').trim();
      if (id && seenLogIds.has(id)) return;
      if (id) seenLogIds.add(id);
      uniqueLogs.push(log);
    });

    const importLog = {
      id: `rst-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      userId: currentUser.id,
      userName: currentUser.fullName,
      userRole: getUserDisplayRole(currentUser),
      action: 'database_import',
      modules: ['database_backup'],
      summary: {
        ...countBackupRows(nextState),
        importedCollections: databaseBackupCollections.length,
      },
      result: 'success',
      errors: [],
      observations: decodeURIComponent(String(req.get('X-Copetin-Observations') ?? '')).trim() || 'Importacion completa de base de datos.',
      ip: req.ip,
      createdAt: new Date().toISOString(),
    };
    nextState.resetLogs = [importLog, ...uniqueLogs].slice(0, 500);

    const result = await replaceStateSnapshot(nextState, snapshot.revision);
    res.json({
      ok: true,
      log: importLog,
      summary: importLog.summary,
      message: 'Base de datos importada correctamente.',
      revision: result.revision,
      version: result.version,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    if (error?.code === 'STATE_REVISION_CONFLICT') {
      sendRevisionConflict(req, res, error);
      return;
    }
    if (error?.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.get('/__copetin_db/presence', async (req, res, next) => {
  try {
    res.json(await listPresence());
  } catch (error) {
    next(error);
  }
});

router.post('/__copetin_db/presence/heartbeat', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'La presencia debe enviarse como objeto JSON.' });
      return;
    }

    res.json(await heartbeatPresence(req.body));
  } catch (error) {
    next(error);
  }
});

router.post('/__copetin_db/presence/leave', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'La salida de presencia debe enviarse como objeto JSON.' });
      return;
    }

    res.json({ ok: true, active: await leavePresence(req.body) });
  } catch (error) {
    next(error);
  }
});

router.get('/__copetin_db/update-notice', async (req, res, next) => {
  try {
    res.json({ notice: await getUpdateNotice() });
  } catch (error) {
    next(error);
  }
});

router.post('/__copetin_db/update-notice/publish', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'El aviso debe enviarse como objeto JSON.' });
      return;
    }
    res.json({ notice: await publishUpdateNotice(req.body) });
  } catch (error) {
    next(error);
  }
});

router.post('/__copetin_db/update-notice/clear', async (req, res, next) => {
  try {
    res.json({ notice: await clearUpdateNotice() });
  } catch (error) {
    next(error);
  }
});


router.get('/__copetin_db/rentals/:id', async (req, res, next) => {
  try {
    const requestedId = String(req.params.id ?? '').trim();
    if (!requestedId) {
      res.status(400).json({ error: 'Debes indicar la orden.' });
      return;
    }

    const snapshot = await getStateSnapshot();
    const rentals = Array.isArray(snapshot?.state?.rentals) ? snapshot.state.rentals : [];
    const rental = rentals.find((entry) =>
      String(entry?.id ?? '') === requestedId
      || String(entry?.orderCode ?? '') === requestedId
      || String(entry?.contractCode ?? '') === requestedId
      || String(entry?.number ?? '') === requestedId
      || String(entry?.contractId ?? '') === requestedId
    );

    if (!rental) {
      res.status(404).json({ error: 'Orden operativa no encontrada.' });
      return;
    }

    res.json({
      ok: true,
      rental,
      revision: snapshot.revision,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});


router.get('/__copetin_db/contracts/:id', async (req, res, next) => {
  try {
    const requestedId = String(req.params.id ?? '').trim();
    if (!requestedId) {
      res.status(400).json({ error: 'Debes indicar el contrato.' });
      return;
    }

    const snapshot = await getStateSnapshot();
    const contracts = Array.isArray(snapshot?.state?.contracts) ? snapshot.state.contracts : [];
    const contract = contracts.find((entry) =>
      String(entry?.id ?? '') === requestedId
      || String(entry?.contractCode ?? '') === requestedId
      || String(entry?.number ?? '') === requestedId
      || String(entry?.orderCode ?? '') === requestedId
    );

    if (!contract) {
      res.status(404).json({ error: 'Contrato no encontrado.' });
      return;
    }

    res.json({
      ok: true,
      contract,
      revision: snapshot.revision,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});


const normalizeEconomicContextKey = (value) =>
  String(value ?? '').trim().toLocaleLowerCase('es-BO');

const getEconomicContextIdentifiers = (...records) => {
  const keys = new Set();
  records.filter(Boolean).forEach((record) => {
    [
      record?.id,
      record?.contractId,
      record?.rentalId,
      record?.contractCode,
      record?.orderCode,
      record?.number,
      record?.codigo,
    ].forEach((value) => {
      const key = normalizeEconomicContextKey(value);
      if (key) keys.add(key);
    });
  });
  return keys;
};

const entryMatchesAnyEconomicKey = (entry, keys) => {
  if (!entry || !keys?.size) return false;
  const entryKeys = getEconomicContextIdentifiers(entry);
  return [...entryKeys].some((key) => keys.has(key));
};

const resolveActiveRentalForContract = (rentals, contract, serviceOrder = null, payload = null) => {
  const activeRentals = (Array.isArray(rentals) ? rentals : []).filter((entry) => !entry?.deletedAt);
  const exactKeys = getEconomicContextIdentifiers(
    {
      id: contract?.rentalId,
      rentalId: contract?.rentalId,
      contractId: contract?.id,
      contractCode: contract?.contractCode,
      orderCode: contract?.orderCode,
    },
    {
      id: serviceOrder?.rentalId,
      rentalId: serviceOrder?.rentalId,
      orderCode: serviceOrder?.orderCode ?? serviceOrder?.codigo,
      codigo: serviceOrder?.codigo,
    },
    {
      id: payload?.rentalId,
      rentalId: payload?.rentalId,
      contractId: payload?.linkedContractId,
      orderCode: payload?.linkedOrderCode,
    },
  );
  const broadKeys = getEconomicContextIdentifiers(contract, serviceOrder, payload);

  return activeRentals.find((entry) => (
    String(entry?.id ?? '') && String(entry.id) === String(contract?.rentalId ?? '')
  )) ?? activeRentals.find((entry) => (
    String(entry?.id ?? '') && String(entry.id) === String(serviceOrder?.rentalId ?? '')
  )) ?? activeRentals.find((entry) => entryMatchesAnyEconomicKey(entry, exactKeys))
    ?? activeRentals.find((entry) => entryMatchesAnyEconomicKey(entry, broadKeys))
    ?? null;
};

const economicMovementMatches = (movement, identifiers) => {
  const directValues = [
    movement?.linkedContractId,
    movement?.linkedRentalId,
    movement?.linkedOrderCode,
    movement?.contractId,
    movement?.rentalId,
    movement?.orderCode,
    movement?.contractCode,
    movement?.sourceId,
    movement?.reference,
  ];
  if (directValues.some((value) => identifiers.has(normalizeEconomicContextKey(value)))) {
    return true;
  }

  // Compatibilidad con movimientos históricos que guardaron la referencia
  // únicamente dentro de la descripción o las notas.
  const looseText = normalizeEconomicContextKey([
    movement?.description,
    movement?.notes,
    movement?.note,
    movement?.detail,
    movement?.receiptDetail,
  ].filter(Boolean).join(' '));
  if (!looseText) return false;

  return [...identifiers].some((key) => key.length >= 3 && looseText.includes(key));
};

router.get('/__copetin_db/contracts/:id/economic-context', async (req, res, next) => {
  try {
    const requestedId = String(req.params.id ?? '').trim();
    if (!requestedId) {
      res.status(400).json({ error: 'Debes indicar el contrato.' });
      return;
    }

    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    const contracts = Array.isArray(state.contracts) ? state.contracts : [];
    const rentals = Array.isArray(state.rentals) ? state.rentals : [];
    const serviceOrders = Array.isArray(state.serviceOrders) ? state.serviceOrders : [];
    const cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];

    const requestedKey = normalizeEconomicContextKey(requestedId);
    const contract = contracts.find((entry) => [
      entry?.id,
      entry?.contractCode,
      entry?.number,
      entry?.orderCode,
      entry?.rentalId,
    ].some((value) => normalizeEconomicContextKey(value) === requestedKey)) ?? null;

    if (!contract) {
      res.status(404).json({ error: 'Contrato no encontrado.' });
      return;
    }

    const contractIdentifiers = getEconomicContextIdentifiers(contract);
    const preliminaryOrder = serviceOrders.find((entry) => {
      const orderIdentifiers = getEconomicContextIdentifiers(entry);
      return [...orderIdentifiers].some((key) => contractIdentifiers.has(key));
    }) ?? null;
    const rental = resolveActiveRentalForContract(rentals, contract, preliminaryOrder);

    const identifiers = getEconomicContextIdentifiers(contract, rental);
    const serviceOrder = serviceOrders.find((entry) => {
      const orderIdentifiers = getEconomicContextIdentifiers(entry);
      return [...orderIdentifiers].some((key) => identifiers.has(key));
    }) ?? preliminaryOrder;

    getEconomicContextIdentifiers(serviceOrder).forEach((key) => identifiers.add(key));

    const movements = cashMovements
      .filter((movement) => economicMovementMatches(movement, identifiers))
      .sort((left, right) =>
        new Date(right?.createdAt ?? 0).getTime() - new Date(left?.createdAt ?? 0).getTime()
      );

    res.set('Cache-Control', 'private, no-store');
    res.json({
      ok: true,
      contract,
      rental,
      serviceOrder,
      cashMovements: movements,
      revision: snapshot.revision,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});



const normalizeStrictEconomicKey = (value) => String(value ?? '').trim().toLowerCase();

const getStrictEconomicLinkKeys = (contract, rental = null, serviceOrder = null) => ({
  contractId: normalizeStrictEconomicKey(contract?.id),
  rentalIds: new Set([
    rental?.id,
    contract?.rentalId,
    serviceOrder?.rentalId,
  ].map(normalizeStrictEconomicKey).filter(Boolean)),
  orderCodes: new Set([
    rental?.orderCode,
    contract?.orderCode,
    serviceOrder?.orderCode,
  ].map(normalizeStrictEconomicKey).filter(Boolean)),
  contractCodes: new Set([
    contract?.contractCode,
    contract?.number,
  ].map(normalizeStrictEconomicKey).filter(Boolean)),
  createdAtMs: new Date(contract?.createdAt ?? contract?.approvedAt ?? 0).getTime() || 0,
});

const strictEconomicRecordMatches = (record, keys) => {
  if (!record) return false;
  const linkedContractId = normalizeStrictEconomicKey(record?.linkedContractId ?? record?.contractId);
  const linkedRentalId = normalizeStrictEconomicKey(record?.linkedRentalId ?? record?.rentalId);
  const linkedOrderCode = normalizeStrictEconomicKey(record?.linkedOrderCode ?? record?.orderCode);
  const sourceId = normalizeStrictEconomicKey(record?.sourceId);

  if (keys.contractId && linkedContractId === keys.contractId) return true;
  if (linkedRentalId && keys.rentalIds.has(linkedRentalId)) return true;
  if (sourceId && (sourceId === keys.contractId || keys.rentalIds.has(sourceId))) return true;

  // Compatibilidad limitada para registros antiguos sin IDs. Nunca se usa el
  // número visible si el registro ya apunta a otro contrato/alquiler.
  const hasStrongForeignLink = Boolean(linkedContractId || linkedRentalId || sourceId);
  if (hasStrongForeignLink) return false;
  if (!linkedOrderCode || !keys.orderCodes.has(linkedOrderCode)) return false;

  const recordCreatedAtMs = new Date(record?.createdAt ?? record?.generatedAt ?? 0).getTime() || 0;
  return !keys.createdAtMs || !recordCreatedAtMs || recordCreatedAtMs >= keys.createdAtMs;
};

const getContractCurrentEconomicSeed = (contract, rental) => {
  const initialPaymentBs = directMoney(
    contract?.payment?.paidAtApprovalBs
    ?? contract?.paidAtApprovalBs
    ?? rental?.payment?.paidAtRentalBs
    ?? rental?.totals?.paidAtRentalBs
    ?? 0,
  );
  const guaranteeDeclaredBs = directMoney(
    contract?.totals?.guaranteeBs
    ?? contract?.guarantee?.amountBs
    ?? rental?.guaranteeDeclaredBs
    ?? rental?.guarantee?.amountBs
    ?? rental?.depositBs
    ?? 0,
  );
  const guaranteeStatus = String(
    contract?.guarantee?.status
    ?? contract?.payment?.guaranteeStatus
    ?? rental?.guarantee?.status
    ?? rental?.payment?.guaranteeStatus
    ?? '',
  ).trim().toLowerCase();
  const guaranteePaidBs = guaranteeStatus === 'validado'
    ? directMoney(rental?.depositBs ?? contract?.guarantee?.validatedBs ?? guaranteeDeclaredBs)
    : 0;
  const paymentMethod = directPaymentMethod(
    contract?.payment?.method
    ?? contract?.paymentMethod
    ?? rental?.payment?.method
    ?? 'efectivo',
  );
  const paymentAccount = directPaymentAccount(
    paymentMethod,
    contract?.payment?.account
    ?? contract?.paymentAccount
    ?? rental?.payment?.account
    ?? '',
  );
  const guaranteeMethod = directPaymentMethod(
    contract?.guarantee?.method
    ?? contract?.payment?.guaranteeMethod
    ?? rental?.guarantee?.method
    ?? rental?.payment?.guaranteeMethod
    ?? paymentMethod,
  );
  const guaranteeAccount = directPaymentAccount(
    guaranteeMethod,
    contract?.guarantee?.account
    ?? contract?.payment?.guaranteeAccount
    ?? rental?.guarantee?.account
    ?? rental?.payment?.guaranteeAccount
    ?? '',
  );
  return {
    initialPaymentBs,
    guaranteeDeclaredBs,
    guaranteePaidBs,
    guaranteeStatus,
    paymentMethod,
    paymentAccount,
    guaranteeMethod,
    guaranteeAccount,
  };
};

const getRentalChargeTargetBs = (contract, rental) => directMoney(
  rental?.totals?.totalBs
  ?? contract?.totals?.totalBs
  ?? contract?.totalBs
  ?? 0,
);

const buildResetEconomicLedger = ({ seed, now, userId, userName }) => {
  const rows = [];
  if (seed.initialPaymentBs > 0) {
    rows.push({
      id: makeEconomicLedgerId(),
      type: 'deposit',
      amountBs: seed.initialPaymentBs,
      paymentMethod: seed.paymentMethod,
      paymentAccount: seed.paymentAccount,
      note: 'Pago inicial conservado por Reset economico.',
      createdAt: now,
      createdById: userId ?? null,
      createdByName: userName,
      cashMovementId: null,
      cashReceiptCode: '',
      isCashRegistered: true,
      reclassifiedFromPayment: false,
      deletedAt: null,
      deletedById: null,
      deletedByName: '',
      deletionReason: '',
    });
  }
  if (seed.guaranteePaidBs > 0) {
    rows.push({
      id: makeEconomicLedgerId(),
      type: 'guarantee',
      amountBs: seed.guaranteePaidBs,
      paymentMethod: seed.guaranteeMethod,
      paymentAccount: seed.guaranteeAccount,
      note: 'Garantia vigente conservada por Reset economico.',
      createdAt: now,
      createdById: userId ?? null,
      createdByName: userName,
      cashMovementId: null,
      cashReceiptCode: '',
      isCashRegistered: true,
      reclassifiedFromPayment: false,
      deletedAt: null,
      deletedById: null,
      deletedByName: '',
      deletionReason: '',
    });
  }
  return rows;
};


const directMoney = (value) => Number(Math.max(0, Number(value ?? 0)).toFixed(2));
const directId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const directNormalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const directInventoryLineKey = (line, index = 0) => String(
  line?.lineKey
  ?? line?.returnLineKey
  ?? `${line?.comboLineKey || 'item'}-${line?.itemId || 'sin-item'}-${line?.comboRuleIndex ?? index}-${index}`,
).trim();
const directCategoryRequiresCleaning = (category) => {
  const normalized = directNormalizeText(category);
  return normalized.includes('manteleria') || normalized.includes('mantel');
};
const directInteger = (value, fieldName) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    const error = new Error(`El campo "${fieldName}" debe ser numerico.`);
    error.statusCode = 400;
    throw error;
  }
  return Math.trunc(parsed);
};
const directPaymentMethod = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['efectivo', 'qr', 'transferencia'].includes(normalized) ? normalized : 'efectivo';
};
const directPaymentAccount = (method, value) => directPaymentMethod(method) === 'qr'
  ? String(value ?? '').trim().toUpperCase()
  : '';
const nextDirectReceiptCode = (state) => {
  const movements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
  const maxPersisted = movements.reduce((max, movement) => {
    const match = String(movement?.receiptCode ?? '').match(/^RC-(\d+)$/i);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `RC-${String(maxPersisted > 0 ? maxPersisted + 1 : movements.length + 1).padStart(4, '0')}`;
};
const buildDirectMovement = (state, payload = {}) => ({
  id: directId('mov'),
  sessionId: payload.sessionId ?? null,
  type: String(payload.type ?? '').trim(),
  amountBs: Number(Number(payload.amountBs ?? 0).toFixed(2)),
  description: String(payload.description ?? '').trim(),
  sourceType: payload.sourceType ?? null,
  sourceId: payload.sourceId ?? null,
  createdBy: String(payload.createdBy ?? 'Sistema').trim() || 'Sistema',
  createdByName: String(payload.createdBy ?? 'Sistema').trim() || 'Sistema',
  userName: String(payload.createdBy ?? 'Sistema').trim() || 'Sistema',
  cashBoxType: String(payload.cashBoxType ?? 'BIG_CASH').trim() || 'BIG_CASH',
  category: String(payload.category ?? '').trim(),
  paymentMethod: directPaymentMethod(payload.paymentMethod),
  paymentAccount: directPaymentAccount(payload.paymentMethod, payload.paymentAccount),
  responsible: String(payload.responsible ?? payload.createdBy ?? 'Sistema').trim() || 'Sistema',
  receipt: String(payload.receipt ?? '').trim(),
  receiptCode: String(payload.receiptCode ?? nextDirectReceiptCode(state)).trim(),
  notes: String(payload.notes ?? '').trim(),
  isInternalTransfer: false,
  transferGroupId: null,
  receiptStatus: '',
  voidedAt: null,
  voidedBy: '',
  voidReason: '',
  replacedByMovementId: null,
  replacementOfMovementId: null,
  linkedRentalId: String(payload.linkedRentalId ?? '').trim() || null,
  linkedContractId: String(payload.linkedContractId ?? '').trim() || null,
  linkedOrderCode: String(payload.linkedOrderCode ?? '').trim() || null,
  accountingTag: String(payload.accountingTag ?? '').trim(),
  collectionTarget: String(payload.collectionTarget ?? '').trim(),
  collectionTargets: Array.isArray(payload.collectionTargets) ? payload.collectionTargets : [],
  collectionBreakdown: Array.isArray(payload.collectionBreakdown) ? payload.collectionBreakdown : [],
  receiptDetail: String(payload.receiptDetail ?? '').trim(),
  transportRevenueBs: directMoney(payload.transportRevenueBs),
  damageCollectedBs: directMoney(payload.damageCollectedBs),
  transportExpenseBs: directMoney(payload.transportExpenseBs),
  clientOperationId: String(payload.clientOperationId ?? '').trim() || null,
  createdAt: new Date().toISOString(),
});

const addDirectReturnCashMovements = (state, rental) => {
  state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
  const activeSession = (Array.isArray(state.cashSessions) ? state.cashSessions : [])
    .find((session) => session.status === 'open');
  const sessionId = activeSession?.id ?? null;
  const customerName = String(rental.customerName ?? 'Cliente');
  const settlement = rental?.returnSettlement ?? {};
  const penaltiesBs = directMoney(settlement?.penaltiesBs ?? rental?.penaltiesBs);
  const internalPenaltiesBs = directMoney(settlement?.internalPenaltiesBs ?? rental?.internalPenaltiesBs);
  const outstandingRentalBs = directMoney(settlement?.outstandingRentalBs);
  const pendingCollectionBs = directMoney(settlement?.pendingCollectionBs);
  const refundBs = directMoney(settlement?.refundBs ?? rental?.refundBs);

  state.cashMovements.push(buildDirectMovement(state, {
    sessionId,
    type: 'liquidacion_devolucion',
    amountBs: 0,
    description: `Liquidacion devolucion (${customerName}) | Penalidad cliente: Bs ${penaltiesBs.toFixed(2)} | Perdida interna: Bs ${internalPenaltiesBs.toFixed(2)} | Saldo alquiler: Bs ${outstandingRentalBs.toFixed(2)} | Reembolso: Bs ${refundBs.toFixed(2)}`,
    sourceType: 'return',
    sourceId: rental.id,
    cashBoxType: 'BIG_CASH',
  }));

  if (pendingCollectionBs > 0) {
    state.cashMovements.push(buildDirectMovement(state, {
      sessionId,
      type: 'saldo_pendiente_cobro',
      amountBs: 0,
      description: `Saldo pendiente por cobrar (${customerName}): Bs ${pendingCollectionBs.toFixed(2)}`,
      sourceType: 'return',
      sourceId: rental.id,
      cashBoxType: 'BIG_CASH',
    }));
  }

  if (internalPenaltiesBs > 0) {
    state.cashMovements.push(buildDirectMovement(state, {
      sessionId,
      type: 'perdida_interna_devolucion',
      amountBs: 0,
      description: `Perdida interna por devolucion (${customerName}): Bs ${internalPenaltiesBs.toFixed(2)}`,
      sourceType: 'return_internal_loss',
      sourceId: rental.id,
      cashBoxType: 'BIG_CASH',
    }));
  }
};

const revertDirectReturnEffects = (state, rental) => {
  const previousReport = Array.isArray(rental?.returnReport) ? rental.returnReport : [];
  const now = new Date().toISOString();
  previousReport.forEach((line) => {
    const returnedToAvailableQty = Math.max(0, Math.trunc(Number(line?.returnedToAvailableQty ?? 0)));
    if (returnedToAvailableQty <= 0) return;
    const item = (Array.isArray(state.items) ? state.items : [])
      .find((entry) => String(entry?.id ?? '') === String(line?.itemId ?? ''));
    if (!item) return;
    item.availableStock = Math.max(0, Number(item.availableStock ?? 0) - returnedToAvailableQty);
    item.updatedAt = now;
  });
  state.stockRecoveries = (Array.isArray(state.stockRecoveries) ? state.stockRecoveries : [])
    .filter((entry) => String(entry?.sourceRentalId ?? '') !== String(rental.id));
  const automaticTypes = new Set(['liquidacion_devolucion', 'saldo_pendiente_cobro', 'perdida_interna_devolucion']);
  state.cashMovements = (Array.isArray(state.cashMovements) ? state.cashMovements : [])
    .filter((movement) => !(
      String(movement?.sourceId ?? '') === String(rental.id)
      && automaticTypes.has(String(movement?.type ?? ''))
      && Number(movement?.amountBs ?? 0) === 0
    ));
};

const findDirectOperation = (state, clientOperationId) => {
  const operationId = String(clientOperationId ?? '').trim();
  if (!operationId) return null;
  return (Array.isArray(state.cashMovements) ? state.cashMovements : [])
    .find((movement) => String(movement?.clientOperationId ?? '') === operationId) ?? null;
};

router.post('/__copetin_db/rentals/register-return', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const rentalId = String(payload.rentalId ?? '').trim();
    const lines = Array.isArray(payload.returnedItems) ? payload.returnedItems : [];
    const isPartialReturn = Boolean(payload.partialReturn) || String(payload?.returnReview?.status ?? '').trim() === 'left_with_client';

    if (!rentalId) return res.status(400).json({ error: 'Debe seleccionar un alquiler para registrar la devolucion.' });
    if (!lines.length) return res.status(400).json({ error: 'Debe enviar el detalle de devolucion por item.' });

    let responseData = null;
    const result = await updateStateSnapshot((state) => {
      state.items = Array.isArray(state.items) ? state.items : [];
      state.rentals = Array.isArray(state.rentals) ? state.rentals : [];
      state.deliveries = Array.isArray(state.deliveries) ? state.deliveries : [];
      state.stockRecoveries = Array.isArray(state.stockRecoveries) ? state.stockRecoveries : [];
      state.cashSessions = Array.isArray(state.cashSessions) ? state.cashSessions : [];
      state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];

      const rental = state.rentals.find((entry) => String(entry?.id ?? '') === rentalId && !entry?.deletedAt);
      if (!rental) { const error = new Error('No se encontro el alquiler seleccionado.'); error.statusCode = 404; throw error; }
      if (rental.status === 'cancelled') { const error = new Error('La orden esta anulada y no puede registrarse como devolucion.'); error.statusCode = 409; throw error; }
      if (rental.status === 'returned' && !isPartialReturn) revertDirectReturnEffects(state, rental);

      const now = new Date().toISOString();
      const settings = state.settings ?? {};
      const missingMultiplier = Number(settings.missingMultiplier ?? 2);
      const damageMultiplier = Number(settings.damageMultiplier ?? 1.2);
      const previousPartialItems = Array.isArray(rental.partialReturnReport?.items)
        ? rental.partialReturnReport.items
        : [];
      const normalizeReturnChargeOwner = (value) => {
        const normalized = directNormalizeText(value).replace(/\s+/g, '_');
        return ['transporte', 'lavado'].includes(normalized) ? normalized : 'cliente';
      };
      let penaltiesBs = 0;
      let internalPenaltiesBs = 0;
      previousPartialItems.forEach((line) => {
        const chargeOwner = normalizeReturnChargeOwner(line?.chargeOwner);
        const damagedQty = Math.max(0, Math.trunc(Number(line?.damagedQty ?? 0)));
        const damagedUnitChargeBs = Math.max(0, Number(line?.damagedUnitChargeBs ?? 0));
        const damagedFeeBs = directMoney(damagedQty * damagedUnitChargeBs);
        if (chargeOwner === 'cliente') penaltiesBs = directMoney(penaltiesBs + damagedFeeBs);
        else internalPenaltiesBs = directMoney(internalPenaltiesBs + damagedFeeBs);
      });
      const getPreviouslyProcessedQty = (rentalLine, rentalLineKey) => previousPartialItems
        .filter((entry) => (
          String(entry?.lineKey ?? '') === String(rentalLineKey)
          || (!entry?.lineKey && String(entry?.itemId ?? '') === String(rentalLine.itemId ?? ''))
        ))
        .reduce((sum, entry) => sum
          + Math.max(0, Math.trunc(Number(entry?.returnedQty ?? 0)))
          + Math.max(0, Math.trunc(Number(entry?.damagedQty ?? 0))), 0);

      const consumedReturnLineIndexes = new Set();
      const returnReport = (Array.isArray(rental.items) ? rental.items : []).map((rentalLine, index) => {
        const rentalLineKey = directInventoryLineKey(rentalLine, index);
        const normalizedRentalItemId = String(rentalLine?.itemId ?? '').trim();
        const normalizedRentalItemName = directNormalizeText(rentalLine?.itemName ?? rentalLine?.name ?? '');
        const normalizedRentalComboLineKey = String(rentalLine?.comboLineKey ?? '').trim();
        const findAvailableLineIndex = (predicate) => lines.findIndex(
          (entry, entryIndex) => !consumedReturnLineIndexes.has(entryIndex) && predicate(entry),
        );

        let incomingLineIndex = findAvailableLineIndex((entry) => Number(entry?.sourceLineIndex) === index);
        if (incomingLineIndex < 0) incomingLineIndex = findAvailableLineIndex((entry) => String(entry?.lineKey ?? entry?.returnLineKey ?? '') === rentalLineKey);
        if (incomingLineIndex < 0 && normalizedRentalComboLineKey) {
          incomingLineIndex = findAvailableLineIndex((entry) => (
            String(entry?.itemId ?? '').trim() === normalizedRentalItemId
            && String(entry?.comboLineKey ?? '').trim() === normalizedRentalComboLineKey
            && Number(entry?.comboRuleIndex ?? -1) === Number(rentalLine?.comboRuleIndex ?? -1)
          ));
        }
        if (incomingLineIndex < 0) {
          incomingLineIndex = findAvailableLineIndex((entry) => (
            String(entry?.itemId ?? '').trim() === normalizedRentalItemId
            && directNormalizeText(entry?.itemName ?? entry?.name ?? '') === normalizedRentalItemName
          ));
        }
        if (incomingLineIndex < 0) incomingLineIndex = findAvailableLineIndex((entry) => String(entry?.itemId ?? '').trim() === normalizedRentalItemId);

        const incomingLine = incomingLineIndex >= 0 ? lines[incomingLineIndex] : null;
        if (!incomingLine) { const error = new Error(`Falta detalle de devolucion para "${rentalLine.itemName}".`); error.statusCode = 400; throw error; }
        consumedReturnLineIndexes.add(incomingLineIndex);

        const returnedQty = Math.max(0, directInteger(incomingLine.returnedQty, `devuelto (${rentalLine.itemName})`));
        const damagedQty = Math.max(0, directInteger(incomingLine.damagedQty, `daniado (${rentalLine.itemName})`));
        const missingQty = Math.max(0, directInteger(incomingLine.missingQty, `faltante (${rentalLine.itemName})`));
        const chargeOwner = normalizeReturnChargeOwner(incomingLine.chargeOwner);
        const damageNote = String(incomingLine.damageNote ?? '').trim();
        const originalExpectedQty = Math.max(0, Math.trunc(Number(rentalLine.quantity ?? 0)));
        const previousProcessedQty = getPreviouslyProcessedQty(rentalLine, rentalLineKey);
        const expectedQty = Math.max(0, originalExpectedQty - previousProcessedQty);
        if (returnedQty + damagedQty + missingQty !== expectedQty) {
          const error = new Error(`La suma de devuelto + daniado + faltante para "${rentalLine.itemName}" debe ser ${expectedQty}.`);
          error.statusCode = 400;
          throw error;
        }
        if ((damagedQty > 0 || missingQty > 0) && !damageNote) {
          const error = new Error(`Debes registrar la observacion para "${rentalLine.itemName}".`);
          error.statusCode = 400;
          throw error;
        }

        const item = state.items.find((entry) => String(entry.id) === String(rentalLine.itemId));
        const configuredDamagedUnitChargeBs = Number.isFinite(Number(item?.damagedUnitChargeBs))
          ? Math.max(0, Number(item.damagedUnitChargeBs))
          : Number.isFinite(Number(rentalLine.damagedUnitChargeBs))
            ? Math.max(0, Number(rentalLine.damagedUnitChargeBs))
            : directMoney(Number(rentalLine.rentalPriceBs ?? 0) * damageMultiplier);
        const configuredMissingUnitChargeBs = Number.isFinite(Number(item?.missingUnitChargeBs))
          ? Math.max(0, Number(item.missingUnitChargeBs))
          : Number.isFinite(Number(rentalLine.missingUnitChargeBs))
            ? Math.max(0, Number(rentalLine.missingUnitChargeBs))
            : directMoney(Number(rentalLine.rentalPriceBs ?? 0) * missingMultiplier);
        const damagedUnitChargeBs = damagedQty > 0 && Number.isFinite(Number(incomingLine.damagedUnitChargeBs))
          ? Math.max(0, Number(incomingLine.damagedUnitChargeBs))
          : damagedQty > 0 ? configuredDamagedUnitChargeBs : 0;
        const missingUnitChargeBs = missingQty > 0 && Number.isFinite(Number(incomingLine.missingUnitChargeBs))
          ? Math.max(0, Number(incomingLine.missingUnitChargeBs))
          : missingQty > 0 ? configuredMissingUnitChargeBs : 0;
        const damagedFeeBs = directMoney(damagedQty * damagedUnitChargeBs);
        const missingFeeBs = directMoney(missingQty * missingUnitChargeBs);
        const linePenaltyBs = directMoney(damagedFeeBs + missingFeeBs);
        if (chargeOwner === 'cliente') penaltiesBs = directMoney(penaltiesBs + linePenaltyBs);
        else internalPenaltiesBs = directMoney(internalPenaltiesBs + linePenaltyBs);

        let internalExpectedQty = expectedQty;
        let returnedToAvailableQty = returnedQty;
        let movedToCleaningQty = 0;
        if (item) {
          internalExpectedQty = Math.max(0, Math.min(expectedQty, Math.trunc(Number(rentalLine.internalReservedQty ?? expectedQty))));
          const internalDamagedQty = Math.min(damagedQty, internalExpectedQty);
          const internalMissingQty = Math.min(missingQty, Math.max(0, internalExpectedQty - internalDamagedQty));
          const internalGoodQty = Math.min(returnedQty, Math.max(0, internalExpectedQty - internalDamagedQty - internalMissingQty));
          const needsCleaningOnReturn = directCategoryRequiresCleaning(item.category) || Boolean(item.needsCleaningOnReturn);
          movedToCleaningQty = needsCleaningOnReturn ? internalGoodQty : 0;
          returnedToAvailableQty = internalGoodQty - movedToCleaningQty;
          item.availableStock = Number(item.availableStock ?? 0) + returnedToAvailableQty;
          item.updatedAt = now;
          if (movedToCleaningQty > 0) {
            state.stockRecoveries.push({
              id: directId('reco'),
              itemId: item.id,
              itemName: item.name,
              category: item.category,
              imageUrl: item.imageUrl ?? null,
              imageDataUrl: item.imageDataUrl ?? null,
              sourceRentalId: rental.id,
              sourceCustomerName: rental.customerName,
              stage: 'lavado',
              quantity: movedToCleaningQty,
              note: 'Devuelto y enviado a lavado.',
              createdAt: now,
              updatedAt: now,
            });
          }
          if (internalDamagedQty > 0) {
            state.stockRecoveries.push({
              id: directId('reco'),
              itemId: item.id,
              itemName: item.name,
              category: item.category,
              imageUrl: item.imageUrl ?? null,
              imageDataUrl: item.imageDataUrl ?? null,
              sourceRentalId: rental.id,
              sourceCustomerName: rental.customerName,
              stage: 'reparacion',
              quantity: internalDamagedQty,
              note: damageNote || 'Dano reportado en devolucion.',
              createdAt: now,
              updatedAt: now,
            });
          }
        }

        return {
          lineKey: rentalLineKey,
          itemId: rentalLine.itemId,
          itemName: rentalLine.itemName,
          expectedQty,
          originalExpectedQty,
          previousProcessedQty,
          internalExpectedQty,
          supplierBackedQty: Math.max(0, expectedQty - internalExpectedQty),
          returnedQty,
          returnedToAvailableQty,
          movedToCleaningQty,
          damagedQty,
          missingQty,
          damageNote,
          chargeOwner,
          damagedUnitChargeBs,
          missingUnitChargeBs,
          damagedFeeBs,
          missingFeeBs,
          penaltyBs: linePenaltyBs,
        };
      });

      if (isPartialReturn) {
        const pendingItems = returnReport
          .filter((line) => Math.max(0, Math.trunc(Number(line.missingQty ?? 0))) > 0)
          .map((line) => ({
            lineKey: line.lineKey,
            itemId: line.itemId,
            itemName: line.itemName,
            expectedQty: line.expectedQty,
            pendingQty: Math.max(0, Math.trunc(Number(line.missingQty ?? 0))),
            note: String(line.damageNote ?? '').trim(),
          }));
        if (!pendingItems.length) { const error = new Error('Para registrar material con cliente debe existir al menos una cantidad pendiente.'); error.statusCode = 400; throw error; }
        rental.partialReturnReport = {
          updatedAt: now,
          updatedByName: String(payload?.userName ?? payload?.createdByName ?? 'Inventario').trim() || 'Inventario',
          items: [
            ...previousPartialItems,
            ...returnReport.filter((line) => (
              Math.max(0, Math.trunc(Number(line.returnedQty ?? 0))) > 0
              || Math.max(0, Math.trunc(Number(line.damagedQty ?? 0))) > 0
              || Math.max(0, Math.trunc(Number(line.missingQty ?? 0))) > 0
            )).map((line) => ({ ...line, partialRegisteredAt: now })),
          ],
        };
        rental.operational = {
          ...(rental.operational ?? {}),
          inventoryStatus: 'salio',
          returnReview: {
            status: 'left_with_client',
            note: String(payload?.returnReview?.note ?? '').trim(),
            reviewedAt: now,
            reviewedByName: String(payload?.userName ?? payload?.createdByName ?? 'Inventario').trim() || 'Inventario',
            reviewedByRole: String(payload?.userRole ?? payload?.createdByRole ?? 'Inventario').trim() || 'Inventario',
          },
          clientPendingPickup: {
            active: true,
            note: String(payload?.clientPendingPickup?.note ?? payload?.returnReview?.note ?? '').trim(),
            items: pendingItems,
            registeredAt: now,
            registeredByName: String(payload?.userName ?? payload?.createdByName ?? 'Inventario').trim() || 'Inventario',
            registeredByRole: String(payload?.userRole ?? payload?.createdByRole ?? 'Inventario').trim() || 'Inventario',
          },
        };
        rental.updatedAt = now;
        responseData = { rental: structuredClone(rental) };
        return state;
      }

      const totalBs = directMoney(rental?.totals?.totalBs);
      const alreadyPaidBs = directMoney(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs ?? totalBs);
      const outstandingRentalBs = directMoney(Math.max(0, totalBs - alreadyPaidBs));
      const totalDiscountAgainstDepositBs = directMoney(penaltiesBs + outstandingRentalBs);
      const depositBs = directMoney(rental.depositBs);
      const refundBs = directMoney(Math.max(0, depositBs - totalDiscountAgainstDepositBs));
      const pendingCollectionBs = directMoney(Math.max(0, totalDiscountAgainstDepositBs - depositBs));
      const discountCoveredByDepositBs = directMoney(Math.min(depositBs, totalDiscountAgainstDepositBs));

      rental.status = 'returned';
      rental.returnedAt = now;
      rental.returnReport = [
        ...previousPartialItems.filter((line) => (
          Math.max(0, Math.trunc(Number(line?.returnedQty ?? 0))) > 0
          || Math.max(0, Math.trunc(Number(line?.damagedQty ?? 0))) > 0
        )),
        ...returnReport,
      ];
      rental.partialReturnReport = null;
      rental.operational = {
        ...(rental.operational ?? {}),
        inventoryStatus: 'devuelto',
        inventoryReturnedAt: now,
        inventoryReturnedByName: String(payload?.userName ?? payload?.createdByName ?? 'Inventario').trim() || 'Inventario',
        inventoryReturnedByRole: String(payload?.userRole ?? payload?.createdByRole ?? 'Inventario').trim() || 'Inventario',
        returnReview: {
          status: String(payload?.returnReview?.status ?? 'complete').trim() || 'complete',
          note: String(payload?.returnReview?.note ?? '').trim(),
          reviewedAt: now,
          reviewedByName: String(payload?.userName ?? payload?.createdByName ?? 'Inventario').trim() || 'Inventario',
          reviewedByRole: String(payload?.userRole ?? payload?.createdByRole ?? 'Inventario').trim() || 'Inventario',
        },
        clientPendingPickup: null,
      };
      rental.penaltiesBs = penaltiesBs;
      rental.internalPenaltiesBs = internalPenaltiesBs;
      rental.refundBs = refundBs;
      rental.payment = {
        ...(rental.payment ?? {}),
        status: pendingCollectionBs > 0 ? 'saldo_pendiente' : 'liquidado',
        paidAtRentalBs: alreadyPaidBs,
        pendingPaymentBs: pendingCollectionBs,
      };
      rental.returnSettlement = {
        outstandingRentalBs,
        penaltiesBs,
        internalPenaltiesBs,
        totalDiscountAgainstDepositBs,
        discountCoveredByDepositBs,
        pendingCollectionBs,
        refundBs,
      };
      rental.updatedAt = now;

      state.deliveries.forEach((delivery) => {
        if ((delivery.rentalId && delivery.rentalId === rental.id) || (delivery.orderCode && rental.orderCode && delivery.orderCode === rental.orderCode)) {
          delivery.status = 'completada';
          delivery.progress = 100;
          delivery.updatedAt = now;
        }
      });
      addDirectReturnCashMovements(state, rental);
      responseData = { rental: structuredClone(rental) };
      return state;
    });

    res.json({ ok: true, ...responseData, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});

router.post('/__copetin_db/cash/collect-receivable', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const rentalId = String(payload.rentalId ?? '').trim();
    const amountBs = directMoney(payload.amountBs);
    if (!rentalId) return res.status(400).json({ error: 'No se pudo identificar la orden a cobrar.' });
    if (amountBs <= 0) return res.status(400).json({ error: 'El monto cobrado debe ser mayor a 0.' });

    let responseData = null;
    const result = await updateStateSnapshot((state) => {
      state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
      state.cashSessions = Array.isArray(state.cashSessions) ? state.cashSessions : [];
      state.rentals = Array.isArray(state.rentals) ? state.rentals : [];
      state.contracts = Array.isArray(state.contracts) ? state.contracts : [];
      state.serviceOrders = Array.isArray(state.serviceOrders) ? state.serviceOrders : [];

      const duplicate = findDirectOperation(state, payload.clientOperationId);
      if (duplicate) {
        const rental = state.rentals.find((entry) => String(entry?.id) === String(duplicate.linkedRentalId));
        responseData = { rental, movement: duplicate, movements: [duplicate], duplicate: true };
        return state;
      }

      const linkedContract = state.contracts.find((contract) =>
        String(contract?.id ?? '') === String(payload.linkedContractId ?? '')
        || String(contract?.rentalId ?? '') === rentalId
        || String(contract?.orderCode ?? '') === String(payload.linkedOrderCode ?? '')
        || String(contract?.contractCode ?? '') === String(payload.linkedContractCode ?? payload.contractCode ?? ''),
      ) ?? null;
      const linkedOrder = state.serviceOrders.find((order) =>
        String(order?.rentalId ?? '') === rentalId
        || String(order?.id ?? '') === rentalId
        || String(order?.codigo ?? '') === String(payload.linkedOrderCode ?? '')
        || String(order?.orderCode ?? '') === String(payload.linkedOrderCode ?? '')
        || (linkedContract && (
          String(order?.rentalId ?? '') === String(linkedContract.rentalId ?? '')
          || String(order?.codigo ?? '') === String(linkedContract.orderCode ?? '')
          || String(order?.orderCode ?? '') === String(linkedContract.orderCode ?? '')
        )),
      ) ?? null;
      const rental = resolveActiveRentalForContract(state.rentals, linkedContract, linkedOrder, payload);
      if (!rental) { const error = new Error('No se encontro la orden seleccionada.'); error.statusCode = 404; throw error; }
      const isReturned = rental.status === 'returned';
      const settlement = rental.returnSettlement ?? {};
      const currentPending = Number(isReturned
        ? settlement.pendingCollectionBs ?? rental?.payment?.pendingPaymentBs ?? 0
        : rental?.payment?.pendingPaymentBs ?? rental?.totals?.pendingPaymentBs ?? 0);
      if (currentPending <= 0) { const error = new Error('Esta orden no tiene saldo pendiente por cobrar.'); error.statusCode = 409; throw error; }
      if (amountBs - currentPending > 0.01) { const error = new Error(`El saldo pendiente es Bs ${currentPending.toFixed(2)}.`); error.statusCode = 409; throw error; }

      const remainingBs = Number(Math.max(0, currentPending - amountBs).toFixed(2));
      const breakdown = Array.isArray(payload.collectionBreakdown) && payload.collectionBreakdown.length
        ? payload.collectionBreakdown.map((entry) => ({ ...entry, amountBs: directMoney(entry?.amountBs) })).filter((entry) => entry.amountBs > 0)
        : [{ target: String(payload.collectionTarget ?? 'balance'), amountBs }];
      const deliveryFeeBs = !isReturned ? directMoney(rental?.deliveryFeeBs ?? rental?.totals?.deliveryFeeBs) : 0;
      const previousTransport = directMoney(rental?.payment?.deliveryFeeCollectedBs ?? rental?.totals?.deliveryFeeCollectedBs);
      const remainingTransport = directMoney(deliveryFeeBs - previousTransport);
      const explicitTransport = directMoney(breakdown.filter((e) => e.target === 'transport').reduce((s,e)=>s+e.amountBs,0));
      const explicitDamage = directMoney(breakdown.filter((e) => e.target === 'damage').reduce((s,e)=>s+e.amountBs,0));
      const explicitRental = directMoney(breakdown.filter((e) => e.target === 'rental').reduce((s,e)=>s+e.amountBs,0));
      const balance = directMoney(breakdown.filter((e) => e.target === 'balance').reduce((s,e)=>s+e.amountBs,0));
      const balanceTransport = Math.min(balance, remainingTransport);
      const transportNow = directMoney(explicitTransport + balanceTransport);
      const rentalNow = directMoney(explicitRental + Math.max(0, balance - balanceTransport));
      const now = new Date().toISOString();
      const previousPaid = directMoney(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs);

      rental.payment = { ...(rental.payment ?? {}), paidAtRentalBs: directMoney(previousPaid + amountBs), pendingPaymentBs: remainingBs,
        deliveryFeeCollectedBs: directMoney(previousTransport + transportNow),
        rentalCollectedBs: directMoney(Number(rental?.payment?.rentalCollectedBs ?? rental?.totals?.rentalCollectedBs ?? 0) + rentalNow),
        damageCollectedBs: directMoney(Number(rental?.payment?.damageCollectedBs ?? rental?.totals?.damageCollectedBs ?? 0) + explicitDamage),
        status: remainingBs > 0 ? 'saldo_pendiente' : (isReturned ? 'cobrado_finalizado' : 'cancelado'),
        mode: remainingBs > 0 ? 'a_cuenta' : 'cancelado', lastCollectionAt: now, lastCollectionBy: String(payload.createdBy ?? 'Sistema') };
      rental.totals = { ...(rental.totals ?? {}), ...rental.payment };
      if (isReturned) {
        rental.returnSettlement = { ...settlement, pendingCollectionBs: remainingBs,
          collectedAfterReturnBs: directMoney(Number(settlement.collectedAfterReturnBs ?? 0) + amountBs),
          collectedAt: remainingBs === 0 ? now : settlement.collectedAt ?? null,
          collectedBy: remainingBs === 0 ? String(payload.createdBy ?? 'Sistema') : settlement.collectedBy ?? null };
        rental.accountingStatus = remainingBs === 0 ? 'cobrado_finalizado' : 'finalizado_pendiente_cobro';
        rental.finalizedAt = remainingBs === 0 ? now : rental.finalizedAt ?? null;
      } else rental.accountingStatus = remainingBs === 0 ? 'cobrado' : 'saldo_pendiente';
      rental.updatedAt = now;

      state.contracts.forEach((contract) => {
        if (String(contract?.rentalId ?? '') === rental.id || (contract?.orderCode && contract.orderCode === rental.orderCode)) {
          contract.accountingStatus = rental.accountingStatus; contract.paymentStatus = rental.payment.status; contract.updatedAt = now;
        }
      });
      state.serviceOrders.forEach((order) => {
        if (String(order?.rentalId ?? '') === rental.id || String(order?.id ?? '') === rental.id || order?.codigo === rental.orderCode) {
          order.saldo_pendiente = remainingBs; order.estado = isReturned && remainingBs === 0 ? 'cobrado_finalizado' : remainingBs === 0 ? 'cobrada' : 'pendiente_cobro'; order.updated_at = now;
        }
      });

      const matchedContract = linkedContract ?? state.contracts.find((contract) =>
        String(contract?.id ?? '') === String(payload.linkedContractId ?? '')
        || String(contract?.rentalId ?? '') === rental.id
        || (contract?.orderCode && contract.orderCode === rental.orderCode)
        || (contract?.contractCode && contract.contractCode === rental.contractCode),
      ) ?? null;
      const target = String(payload.collectionTarget ?? 'balance');
      const mixed = breakdown.length > 1 || target === 'mixed';
      const type = mixed ? 'ingreso_cobro_mixto_contrato' : target === 'transport' ? 'ingreso_transporte_cliente' : target === 'damage' ? 'ingreso_danos_faltantes' : isReturned ? 'cobro_saldo_devolucion' : 'cobro_saldo_alquiler';
      const movement = buildDirectMovement(state, { ...payload, type, amountBs,
        description: String(payload.receiptDetail ?? '').trim().split('\n').filter(Boolean).slice(0,2).join(' | ') || String(payload.note ?? '').trim() || `Cobro contrato: ${rental.customerName ?? ''}`,
        sourceType: isReturned ? 'return' : 'rental', sourceId: rental.id, cashBoxType: 'BIG_CASH',
        category: String(payload.category ?? '').trim() || (mixed ? 'cobro_mixto_contrato' : target === 'transport' ? 'transporte_cobrado' : target === 'damage' ? 'cobro_danos_faltantes' : isReturned ? 'cobro_liquidacion' : 'cobro_contrato'),
        linkedRentalId: rental.id, linkedContractId: String(payload.linkedContractId ?? matchedContract?.id ?? rental.contractId ?? '').trim(), linkedOrderCode: rental.orderCode,
        transportRevenueBs: transportNow, damageCollectedBs: explicitDamage, notes: payload.note });
      state.cashMovements.push(movement);
      responseData = { rental: structuredClone(rental), movement: structuredClone(movement), movements: [structuredClone(movement)] };
      return state;
    });
    res.json({ ok: true, ...responseData, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
  } catch (error) { if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message }); next(error); }
});

router.post('/__copetin_db/cash/manual-economic-movement', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const amountBs = directMoney(payload.amountBs);
    if (amountBs <= 0) return res.status(400).json({ error: 'El monto del movimiento debe ser mayor a 0.' });
    if (!String(payload.description ?? '').trim()) return res.status(400).json({ error: 'Debes escribir una descripcion para el movimiento.' });
    let movement = null;
    const result = await updateStateSnapshot((state) => {
      state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
      const duplicate = findDirectOperation(state, payload.clientOperationId);
      if (duplicate) { movement = duplicate; return state; }
      movement = buildDirectMovement(state, { ...payload, type: payload.type === 'egreso' ? 'egreso_manual' : 'ingreso_manual', amountBs: payload.type === 'egreso' ? -amountBs : amountBs });
      state.cashMovements.push(movement);
      return state;
    });
    res.json({ ok: true, movement, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
  } catch (error) { next(error); }
});


router.post('/__copetin_db/contracts/:id/economic-reset', async (req, res, next) => {
  try {
    const requestedId = String(req.params.id ?? '').trim();
    const confirmation = String(req.body?.confirmation ?? '').trim().toUpperCase();
    if (!requestedId) {
      res.status(400).json({ error: 'Debes indicar el contrato.' });
      return;
    }
    if (confirmation !== 'RESET') {
      res.status(400).json({ error: 'Debes escribir RESET para confirmar la limpieza economica.' });
      return;
    }

    const now = new Date().toISOString();
    const userId = req.body?.updatedById ?? req.body?.userId ?? null;
    const userName = String(req.body?.updatedByName ?? req.body?.userName ?? 'Sistema').trim() || 'Sistema';
    let responseData = null;

    const result = await updateStateSnapshot((state) => {
      state.contracts = Array.isArray(state.contracts) ? state.contracts : [];
      state.rentals = Array.isArray(state.rentals) ? state.rentals : [];
      state.serviceOrders = Array.isArray(state.serviceOrders) ? state.serviceOrders : [];
      state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
      state.cashDebts = Array.isArray(state.cashDebts) ? state.cashDebts : [];
      state.generatedReports = Array.isArray(state.generatedReports) ? state.generatedReports : [];
      state.systemAuditLog = Array.isArray(state.systemAuditLog) ? state.systemAuditLog : [];

      const requestedKey = normalizeStrictEconomicKey(requestedId);
      const contract = state.contracts.find((entry) => [
        entry?.id,
        entry?.contractCode,
        entry?.number,
        entry?.orderCode,
        entry?.rentalId,
      ].some((value) => normalizeStrictEconomicKey(value) === requestedKey));

      if (!contract) {
        const error = new Error('Contrato no encontrado para ejecutar el Reset economico.');
        error.statusCode = 404;
        throw error;
      }

      const serviceOrder = state.serviceOrders.find((entry) =>
        normalizeStrictEconomicKey(entry?.contractId) === normalizeStrictEconomicKey(contract?.id)
        || normalizeStrictEconomicKey(entry?.rentalId) === normalizeStrictEconomicKey(contract?.rentalId)
        || (
          contract?.orderCode
          && normalizeStrictEconomicKey(entry?.orderCode) === normalizeStrictEconomicKey(contract?.orderCode)
        )
      ) ?? null;
      const rental = resolveActiveRentalForContract(state.rentals, contract, serviceOrder);
      const keys = getStrictEconomicLinkKeys(contract, rental, serviceOrder);
      const seed = getContractCurrentEconomicSeed(contract, rental);

      const removedMovementIds = new Set(
        state.cashMovements
          .filter((movement) => strictEconomicRecordMatches(movement, keys))
          .map((movement) => normalizeStrictEconomicKey(movement?.id))
          .filter(Boolean),
      );

      const beforeCounts = {
        cashMovements: state.cashMovements.length,
        cashDebts: state.cashDebts.length,
        generatedReports: state.generatedReports.length,
        ledgerRows: Array.isArray(contract.economicLedger) ? contract.economicLedger.length : 0,
      };

      state.cashMovements = state.cashMovements.filter((movement) => !strictEconomicRecordMatches(movement, keys));
      state.cashDebts = state.cashDebts.filter((debt) => !strictEconomicRecordMatches(debt, keys));
      state.generatedReports = state.generatedReports.filter((report) => {
        const reportMovementId = normalizeStrictEconomicKey(
          report?.cashMovementId
          ?? report?.movementId
          ?? report?.sourceMovementId,
        );
        if (reportMovementId && removedMovementIds.has(reportMovementId)) return false;
        if (!strictEconomicRecordMatches(report, keys)) return true;
        const typeText = String([
          report?.type,
          report?.documentType,
          report?.category,
          report?.title,
          report?.name,
        ].filter(Boolean).join(' ')).toLowerCase();
        return !/(recibo|caja|econom|cobro|pago|garant|devolucion)/.test(typeText);
      });

      const chargeTargetBs = getRentalChargeTargetBs(contract, rental);
      const penaltiesBs = directMoney(rental?.returnSettlement?.penaltiesBs ?? rental?.penaltiesBs ?? 0);
      const outstandingRentalBs = directMoney(Math.max(0, chargeTargetBs - seed.initialPaymentBs));
      const pendingCollectionBs = directMoney(outstandingRentalBs + penaltiesBs);
      const paymentStatus = pendingCollectionBs <= 0.009
        ? 'liquidado'
        : seed.initialPaymentBs > 0
          ? 'a_cuenta'
          : 'sin_pago';

      const ledger = buildResetEconomicLedger({ seed, now, userId, userName });
      contract.economicLedger = ledger;
      contract.economicLedgerUpdatedAt = now;
      contract.economicLedgerUpdatedById = userId;
      contract.economicLedgerUpdatedByName = userName;
      // Marcador persistente: permite distinguir el ledger reconstruido por el Reset
      // de las lineas automaticas historicas en cliente y normalizadores.
      contract.economicResetAt = now;
      contract.economicResetVersion = 1;
      contract.paidAtApprovalBs = seed.initialPaymentBs;
      contract.pendingPaymentBs = outstandingRentalBs;
      contract.paymentStatus = paymentStatus;
      contract.accountingStatus = pendingCollectionBs <= 0.009 ? 'cobrado_finalizado' : paymentStatus;
      contract.payment = {
        ...(contract.payment ?? {}),
        paidAtApprovalBs: seed.initialPaymentBs,
        pendingBs: outstandingRentalBs,
        pendingPaymentBs: outstandingRentalBs,
        status: paymentStatus,
        mode: paymentStatus,
        guaranteeStatus: seed.guaranteeStatus || contract?.payment?.guaranteeStatus || 'no_validado',
      };
      contract.totals = {
        ...(contract.totals ?? {}),
        paidAtApprovalBs: seed.initialPaymentBs,
        pendingPaymentBs: outstandingRentalBs,
      };
      contract.updatedAt = now;

      if (rental) {
        rental.payment = {
          ...(rental.payment ?? {}),
          paidAtRentalBs: seed.initialPaymentBs,
          paidAtApprovalBs: seed.initialPaymentBs,
          pendingPaymentBs: outstandingRentalBs,
          status: paymentStatus,
          mode: paymentStatus,
          guaranteeStatus: seed.guaranteeStatus || rental?.payment?.guaranteeStatus || 'no_validado',
        };
        rental.totals = {
          ...(rental.totals ?? {}),
          paidAtRentalBs: seed.initialPaymentBs,
          paidAtApprovalBs: seed.initialPaymentBs,
          pendingPaymentBs: outstandingRentalBs,
        };
        rental.depositBs = seed.guaranteePaidBs;
        rental.guaranteeDeclaredBs = seed.guaranteeDeclaredBs;
        rental.guarantee = {
          ...(rental.guarantee ?? {}),
          amountBs: seed.guaranteeDeclaredBs,
          validatedBs: seed.guaranteePaidBs,
          status: seed.guaranteeStatus || 'no_validado',
          method: seed.guaranteeMethod,
          account: seed.guaranteeAccount,
        };
        if (rental.returnSettlement || rental.returnedAt || rental.status === 'returned') {
          rental.returnSettlement = {
            ...(rental.returnSettlement ?? {}),
            outstandingRentalBs,
            penaltiesBs,
            pendingCollectionBs,
            paidBs: seed.initialPaymentBs,
            refundBs: 0,
            accountingStatus: pendingCollectionBs <= 0.009 ? 'liquidado' : 'saldo_pendiente',
            settledAt: null,
          };
        }
        rental.accountingStatus = pendingCollectionBs <= 0.009 ? 'cobrado_finalizado' : paymentStatus;
        rental.updatedAt = now;
      }

      const activeSession = state.cashSessions?.find((session) => session.status === 'open');
      const sessionId = activeSession?.id ?? null;
      const linkedRentalId = rental?.id ?? contract?.rentalId ?? '';
      const linkedOrderCode = rental?.orderCode ?? contract?.orderCode ?? '';
      const customerName = String(contract?.customerName ?? rental?.customerName ?? 'Cliente').trim() || 'Cliente';
      const newMovements = [];

      if (seed.initialPaymentBs > 0) {
        const movement = buildDirectMovement(state, {
          sessionId,
          type: 'ingreso',
          amountBs: seed.initialPaymentBs,
          description: `Pago inicial contrato ${contract.contractCode || contract.id} - ${customerName}`,
          sourceType: 'contract_economic_reset',
          sourceId: contract.id,
          cashBoxType: 'BIG_CASH',
          category: 'adelanto',
          paymentMethod: seed.paymentMethod,
          paymentAccount: seed.paymentAccount,
          responsible: userName,
          notes: 'Registro limpio recreado por Reset economico.',
          linkedRentalId,
          linkedContractId: contract.id,
          linkedOrderCode,
          accountingTag: 'initial_rental_payment',
          collectionTarget: 'rental',
          collectionTargets: ['rental'],
          collectionBreakdown: [{ target: 'rental', amountBs: seed.initialPaymentBs }],
          receiptDetail: `Pago inicial vigente del contrato ${contract.contractCode || contract.id}`,
        });
        state.cashMovements.push(movement);
        newMovements.push(movement);
      }

      if (seed.guaranteePaidBs > 0) {
        const movement = buildDirectMovement(state, {
          sessionId,
          type: 'ingreso',
          amountBs: seed.guaranteePaidBs,
          description: `Garantia contrato ${contract.contractCode || contract.id} - ${customerName}`,
          sourceType: 'contract_economic_reset',
          sourceId: contract.id,
          cashBoxType: 'BIG_CASH',
          category: 'garantia',
          paymentMethod: seed.guaranteeMethod,
          paymentAccount: seed.guaranteeAccount,
          responsible: userName,
          notes: 'Garantia vigente recreada por Reset economico.',
          linkedRentalId,
          linkedContractId: contract.id,
          linkedOrderCode,
          accountingTag: 'contract_guarantee',
          collectionTarget: 'guarantee',
          collectionTargets: ['guarantee'],
          collectionBreakdown: [{ target: 'guarantee', amountBs: seed.guaranteePaidBs }],
          receiptDetail: `Garantia vigente del contrato ${contract.contractCode || contract.id}`,
        });
        state.cashMovements.push(movement);
        newMovements.push(movement);
      }

      ledger.forEach((entry, index) => {
        const movement = newMovements[index];
        if (!movement) return;
        entry.cashMovementId = movement.id;
        entry.cashReceiptCode = movement.receiptCode;
      });

      state.systemAuditLog.unshift({
        id: directId('audit'),
        type: 'contract_economic_reset',
        action: 'reset_economico',
        entityType: 'contract',
        entityId: contract.id,
        entityCode: contract.contractCode ?? '',
        detail: `Reset economico: se eliminaron ${beforeCounts.cashMovements - state.cashMovements.length + newMovements.length} movimiento(s) previos y se recrearon ${newMovements.length}.`,
        userId,
        userName,
        createdAt: now,
      });

      const contextMovements = state.cashMovements
        .filter((movement) => strictEconomicRecordMatches(movement, keys))
        .sort((left, right) => new Date(right?.createdAt ?? 0) - new Date(left?.createdAt ?? 0));

      responseData = {
        contract: structuredClone(contract),
        rental: rental ? structuredClone(rental) : null,
        serviceOrder: serviceOrder ? structuredClone(serviceOrder) : null,
        cashMovements: structuredClone(contextMovements),
        resetSummary: {
          removedCashMovements: beforeCounts.cashMovements - (state.cashMovements.length - newMovements.length),
          removedCashDebts: beforeCounts.cashDebts - state.cashDebts.length,
          removedReports: beforeCounts.generatedReports - state.generatedReports.length,
          removedLedgerRows: beforeCounts.ledgerRows,
          recreatedMovements: newMovements.length,
          initialPaymentBs: seed.initialPaymentBs,
          guaranteePaidBs: seed.guaranteePaidBs,
          pendingCollectionBs,
        },
      };
      return state;
    });

    if (!result.initialized) {
      res.status(404).json({ error: 'La base de datos aun no esta inicializada.' });
      return;
    }

    console.info('[state-route] Reset economico ejecutado.', {
      contractId: responseData?.contract?.id,
      contractCode: responseData?.contract?.contractCode,
      ...responseData?.resetSummary,
      ip: req.ip,
    });

    res.set('Cache-Control', 'private, no-store');
    res.json({
      ok: true,
      ...responseData,
      revision: result.revision,
      version: result.version,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    if (error?.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});


router.put('/__copetin_db/contracts/:id/economic-ledger', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'La solicitud debe enviarse como objeto JSON.' });
      return;
    }

    const requestedId = String(req.params.id ?? '').trim();
    if (!requestedId) {
      res.status(400).json({ error: 'Debes indicar el contrato.' });
      return;
    }

    const now = new Date().toISOString();
    const requestedMutations = Array.isArray(req.body.mutations) ? req.body.mutations : [];
    let savedLedger = [];
    let updatedContract = null;
    const result = await updateStateSnapshot((state) => {
      const contracts = Array.isArray(state.contracts) ? state.contracts : [];
      const contractIndex = contracts.findIndex((contract) =>
        String(contract?.id ?? '') === requestedId
        || String(contract?.contractCode ?? '') === requestedId
        || String(contract?.number ?? '') === requestedId
      );

      if (contractIndex < 0) {
        const error = new Error('Contrato no encontrado para guardar el cuaderno economico.');
        error.statusCode = 404;
        throw error;
      }

      const existingContract = contracts[contractIndex];
      const existingLedger = normalizeEconomicLedgerRows(existingContract?.economicLedger);
      const ledgerById = new Map(existingLedger.map((entry) => [String(entry.id), entry]));

      if (requestedMutations.length > 0) {
        requestedMutations.forEach((mutation) => {
          const mutationType = String(mutation?.type ?? '').trim().toLowerCase();
          if (mutationType === 'upsert') {
            const normalizedEntry = normalizeEconomicLedgerRows([mutation?.entry])[0];
            if (!normalizedEntry?.id) return;
            const previous = ledgerById.get(String(normalizedEntry.id));
            ledgerById.set(String(normalizedEntry.id), {
              ...(previous ?? {}),
              ...normalizedEntry,
              deletedAt: null,
              deletedById: null,
              deletedByName: '',
              deletionReason: '',
              editedAt: previous ? (normalizedEntry.editedAt || now) : normalizedEntry.editedAt,
            });
            return;
          }
          if (mutationType === 'void') {
            const entryId = String(mutation?.entryId ?? '').trim();
            if (!entryId || !ledgerById.has(entryId)) return;
            const previous = ledgerById.get(entryId);
            ledgerById.set(entryId, {
              ...previous,
              deletedAt: now,
              deletedById: req.body.updatedById ?? req.body.userId ?? null,
              deletedByName: String(req.body.updatedByName ?? req.body.userName ?? 'Sistema').trim() || 'Sistema',
              deletionReason: String(mutation?.reason ?? 'Linea anulada.').trim() || 'Linea anulada.',
            });
          }
        });
        savedLedger = [...ledgerById.values()];
      } else if (Object.prototype.hasOwnProperty.call(req.body, 'economicLedger')) {
        // Compatibilidad con clientes anteriores. Nunca se usa para el flujo nuevo.
        savedLedger = normalizeEconomicLedgerRows(req.body.economicLedger);
      } else {
        savedLedger = existingLedger;
      }

      updatedContract = {
        ...existingContract,
        economicLedger: savedLedger,
        economicLedgerUpdatedAt: now,
        economicLedgerUpdatedById: req.body.updatedById ?? req.body.userId ?? null,
        economicLedgerUpdatedByName: String(req.body.updatedByName ?? req.body.userName ?? 'Sistema').trim() || 'Sistema',
        updatedAt: now,
      };

      return {
        ...state,
        contracts: [
          ...contracts.slice(0, contractIndex),
          updatedContract,
          ...contracts.slice(contractIndex + 1),
        ],
      };
    });

    if (!result.initialized) {
      res.status(404).json({ error: 'La base de datos aun no esta inicializada.' });
      return;
    }

    console.info('[state-route] Cuaderno economico de contrato guardado.', {
      contractId: updatedContract?.id,
      contractCode: updatedContract?.contractCode,
      rows: savedLedger.filter((entry) => !entry.deletedAt).length,
      archivedRows: savedLedger.filter((entry) => entry.deletedAt).length,
      firstAmountBs: savedLedger.find((entry) => !entry.deletedAt)?.amountBs ?? null,
      revision: result?.revision,
      ip: req.ip,
    });
    res.json({
      ok: true,
      contract: updatedContract,
      revision: result.revision,
      version: result.version,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    if (error?.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.post('/__copetin_db/chunked/start', (req, res) => {
  cleanupExpiredChunkUploads();
  const totalChunks = Math.trunc(Number(req.body?.totalChunks ?? 0));
  const totalBytes = Math.trunc(Number(req.body?.totalBytes ?? 0));
  if (!Number.isFinite(totalChunks) || totalChunks < 1 || totalChunks > 1000) {
    res.status(400).json({ error: 'La cantidad de fragmentos no es valida.' });
    return;
  }
  if (!Number.isFinite(totalBytes) || totalBytes < 2 || totalBytes > MAX_CHUNKED_STATE_BYTES) {
    res.status(413).json({ error: 'La base supera el limite permitido para guardado fragmentado.' });
    return;
  }

  const uploadId = crypto.randomUUID();
  chunkUploads.set(uploadId, {
    createdAt: Date.now(),
    revision: req.body?.revision === null ? null : String(req.body?.revision ?? '').trim() || null,
    totalChunks,
    totalBytes,
    chunks: new Array(totalChunks),
    receivedBytes: 0,
  });
  res.json({ ok: true, uploadId });
});

router.post('/__copetin_db/chunked/chunk', (req, res) => {
  cleanupExpiredChunkUploads();
  const uploadId = String(req.body?.uploadId ?? '').trim();
  const index = Math.trunc(Number(req.body?.index ?? -1));
  const data = String(req.body?.data ?? '');
  const upload = chunkUploads.get(uploadId);
  if (!upload) {
    res.status(404).json({ error: 'La carga fragmentada expiro o no existe.' });
    return;
  }
  if (!Number.isFinite(index) || index < 0 || index >= upload.totalChunks || !data) {
    res.status(400).json({ error: 'El fragmento enviado no es valido.' });
    return;
  }

  let chunk;
  try {
    chunk = Buffer.from(data, 'base64');
  } catch {
    res.status(400).json({ error: 'No se pudo decodificar el fragmento.' });
    return;
  }
  if (chunk.length > 512 * 1024) {
    res.status(413).json({ error: 'El fragmento supera el limite permitido.' });
    return;
  }

  const previous = upload.chunks[index];
  upload.receivedBytes -= previous?.length ?? 0;
  upload.chunks[index] = chunk;
  upload.receivedBytes += chunk.length;
  res.json({ ok: true, index });
});

router.post('/__copetin_db/chunked/commit', async (req, res, next) => {
  cleanupExpiredChunkUploads();
  const uploadId = String(req.body?.uploadId ?? '').trim();
  const upload = chunkUploads.get(uploadId);
  if (!upload) {
    res.status(404).json({ error: 'La carga fragmentada expiro o no existe.' });
    return;
  }
  if (upload.chunks.some((chunk) => !chunk) || upload.receivedBytes !== upload.totalBytes) {
    res.status(400).json({ error: 'Faltan fragmentos para completar el guardado.' });
    return;
  }

  try {
    const state = JSON.parse(Buffer.concat(upload.chunks).toString('utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      res.status(400).json({ error: 'El estado reconstruido no es valido.' });
      return;
    }
    const result = await replaceStateSnapshot(state, upload.revision);
    chunkUploads.delete(uploadId);
    console.info('[state-route] Estado fragmentado guardado correctamente.', {
      revision: result?.revision,
      version: result?.version,
      totalBytes: upload.totalBytes,
      totalChunks: upload.totalChunks,
      ip: req.ip,
    });
    res.json(result);
  } catch (error) {
    chunkUploads.delete(uploadId);
    if (error?.code === 'STATE_REVISION_CONFLICT') {
      sendRevisionConflict(req, res, error);
      return;
    }
    if (error?.statusCode) {
      sendStateGuardError(req, res, error);
      return;
    }
    next(error);
  }
});

router.post('/__copetin_db/patch', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'La solicitud debe enviarse como objeto JSON.' });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(req.body, 'revision')) {
      res.status(400).json({ error: 'Debes enviar la revision actual para guardar el cambio.' });
      return;
    }

    const upserts = req.body.upserts && typeof req.body.upserts === 'object' && !Array.isArray(req.body.upserts)
      ? req.body.upserts
      : {};
    const deletes = req.body.deletes && typeof req.body.deletes === 'object' && !Array.isArray(req.body.deletes)
      ? req.body.deletes
      : {};
    const settings = req.body.settings && typeof req.body.settings === 'object' && !Array.isArray(req.body.settings)
      ? req.body.settings
      : null;

    const result = await updateStateSnapshot((state) => {
      const nextState = { ...state };

      Object.entries(upserts).forEach(([collection, rows]) => {
        if (!patchableCollections.has(collection) || !Array.isArray(rows) || rows.length === 0) return;
        const currentRows = Array.isArray(nextState[collection]) ? [...nextState[collection]] : [];
        const indexById = new Map(currentRows.map((row, index) => [String(row?.id ?? ''), index]).filter(([id]) => id));
        rows.forEach((row) => {
          if (!row || typeof row !== 'object' || Array.isArray(row)) return;
          const id = String(row.id ?? '').trim();
          if (!id) return;
          const currentIndex = indexById.get(id);
          if (row._summaryOnly) {
            console.warn('[state-route] Upsert resumido ignorado para proteger datos completos.', {
              collection,
              id,
            });
            return;
          }
          if (currentIndex >= 0) {
            currentRows[currentIndex] = row;
          } else {
            indexById.set(id, currentRows.length);
            currentRows.push(row);
          }
        });
        nextState[collection] = currentRows;
      });

      Object.entries(deletes).forEach(([collection, ids]) => {
        if (!patchableCollections.has(collection) || !Array.isArray(ids) || ids.length === 0) return;
        const deleteIds = new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean));
        if (!deleteIds.size) return;
        nextState[collection] = Array.isArray(nextState[collection])
          ? nextState[collection].filter((row) => !deleteIds.has(String(row?.id ?? '')))
          : [];
      });

      if (settings) {
        nextState.settings = settings;
      }

      return nextState;
    }, req.body.revision);

    if (!result.initialized) {
      res.status(404).json({ error: 'La base de datos aun no esta inicializada.' });
      return;
    }

    res.json({
      ok: true,
      revision: result.revision,
      version: result.version,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    if (error?.code === 'STATE_REVISION_CONFLICT') {
      sendRevisionConflict(req, res, error);
      return;
    }
    if (error?.statusCode) {
      sendStateGuardError(req, res, error);
      return;
    }
    next(error);
  }
});

router.get('/__copetin_db/collections', async (req, res, next) => {
  try {
    const requestedNames = String(req.query.names ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const invalidNames = requestedNames.filter((name) => !readablePartialCollectionSet.has(name));
    if (!requestedNames.length || invalidNames.length) {
      res.status(400).json({
        error: 'Debes solicitar colecciones parciales validas.',
        invalidCollections: invalidNames,
      });
      return;
    }

    const snapshot = await getStateSnapshot();
    const collections = Object.fromEntries(
      requestedNames.map((name) => [name, Array.isArray(snapshot?.state?.[name]) ? snapshot.state[name] : []]),
    );
    await sendJsonPayload(req, res, {
      initialized: snapshot.initialized,
      revision: snapshot.revision,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      collections,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/__copetin_db', async (req, res, next) => {
  try {
    if (req.query.meta === '1') {
      res.json(await getStateMeta());
      return;
    }

    const snapshot = await getStateSnapshot();
    if (req.query.bootstrap === '1' && snapshot?.initialized && snapshot?.state) {
      const state = { ...snapshot.state };
      deferredBootstrapCollections.forEach((collection) => {
        delete state[collection];
      });
      summarizedBootstrapCollections.forEach((collection) => {
        const rows = Array.isArray(snapshot.state[collection]) ? snapshot.state[collection] : [];
        state[collection] = summarizeBootstrapCollection(collection, rows);
      });
      await sendJsonPayload(req, res, {
        ...snapshot,
        state,
        partial: true,
        excludedCollections: deferredBootstrapCollections,
        summarizedCollections: summarizedBootstrapCollections,
      });
      return;
    }

    await sendJsonPayload(req, res, snapshot);
  } catch (error) {
    next(error);
  }
});

router.put('/__copetin_db', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'La solicitud debe enviarse como objeto JSON.' });
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(req.body, 'revision')) {
      res.status(400).json({ error: 'Debes enviar la revision actual para guardar el estado.' });
      return;
    }

    if (!req.body.state || typeof req.body.state !== 'object' || Array.isArray(req.body.state)) {
      res.status(400).json({ error: 'El estado debe enviarse como objeto JSON en el campo state.' });
      return;
    }

    const result = await replaceStateSnapshot(req.body.state, req.body.revision);
    console.info('[state-route] Estado guardado correctamente.', {
      revision: result?.revision,
      version: result?.version,
      updatedAt: result?.updatedAt,
      ip: req.ip,
    });
    res.json(result);
  } catch (error) {
    if (error?.code === 'STATE_REVISION_CONFLICT') {
      sendRevisionConflict(req, res, error);
      return;
    }
    if (error?.statusCode) {
      sendStateGuardError(req, res, error);
      return;
    }

    console.error('[state-route] Fallo al guardar el estado del sistema.', {
      code: error?.code,
      message: error?.message,
      ip: req.ip,
    });
    next(error);
  }
});

export default router;
