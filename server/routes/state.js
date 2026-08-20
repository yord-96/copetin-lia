import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { getStateMeta, getStateSnapshot, replaceStateSnapshot, updateStateSnapshot } from '../storage/fileStateStore.js';
import { heartbeatPresence, leavePresence, listPresence } from '../storage/presenceStore.js';
import { clearUpdateNotice, getUpdateNotice, publishUpdateNotice } from '../storage/updateNoticeStore.js';

const router = Router();
const gzipAsync = promisify(gzip);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const accountingBackupDirectory = path.join(projectRoot, 'data', 'backups');
const internalKey = String(process.env.APP_INTERNAL_KEY ?? '').trim();
const configuredResetSecurityCode = String(process.env.RESET_SECURITY_CODE ?? '').trim();
const resetSecurityCode = configuredResetSecurityCode && configuredResetSecurityCode !== 'cambia-este-codigo'
  ? configuredResetSecurityCode
  : '1703';
const MAX_CHUNKED_STATE_BYTES = Number(process.env.MAX_CHUNKED_STATE_BYTES ?? 64 * 1024 * 1024);
const CHUNK_UPLOAD_TTL_MS = 10 * 60 * 1000;
const chunkUploads = new Map();
const JSON_PAYLOAD_CACHE_LIMIT = 32;
const jsonPayloadCache = new Map();

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
  'users',
  'items',
  'suppliers',
  'supplierQuotes',
  'supplierLoans',
  'deliveries',
  'calendarEvents',
  'calendarBoardNotes',
  ...deferredBootstrapCollections,
  ...summarizedBootstrapCollections,
]);

// El bootstrap solo necesita datos para dibujar listados. Los documentos,
// revisiones y planes completos se descargan de forma atomica al abrirlos.
// La base de datos permanece intacta.
const summarizeContract = (contract = {}) => summarizeOrdersContract(contract);

const summarizeRental = (rental = {}) => ({
  ...summarizeOrdersRental(rental),
  returnIssueSummary: (Array.isArray(rental.returnReport) ? rental.returnReport : [])
    .filter((line) => (
      Number(line?.damagedQty ?? 0) > 0
      || Number(line?.missingQty ?? 0) > 0
      || Number(line?.penaltyBs ?? 0) > 0
    ))
    .map((line) => ({
      itemId: line?.itemId ?? '',
      itemName: line?.itemName ?? line?.name ?? 'Item',
      damagedQty: Number(line?.damagedQty ?? 0),
      missingQty: Number(line?.missingQty ?? 0),
      damagedUnitChargeBs: Number(line?.damagedUnitChargeBs ?? 0),
      missingUnitChargeBs: Number(line?.missingUnitChargeBs ?? 0),
      penaltyBs: Number(line?.penaltyBs ?? 0),
      chargeOwner: line?.chargeOwner ?? 'cliente',
      damageNote: line?.damageNote ?? '',
    })),
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

const summarizeAccountingMovement = (movement = {}) => {
  const fields = [
    'id', 'sessionId', 'type', 'amountBs', 'description', 'sourceType', 'sourceId',
    'createdBy', 'cashBoxType', 'category', 'paymentMethod', 'paymentAccount',
    'responsible', 'receipt', 'receiptCode', 'notes', 'isInternalTransfer',
    'transferGroupId', 'receiptStatus', 'voidedAt', 'voidedBy', 'voidReason',
    'replacedByMovementId', 'replacementOfMovementId', 'linkedRentalId',
    'linkedContractId', 'linkedOrderCode', 'contractCode', 'orderCode', 'reference',
    'accountingTag', 'transportRevenueBs', 'transportExpenseBs', 'createdAt',
    'createdByName', 'userName', 'collectionTarget', 'damageCollectedBs',
    'collectionTargets', 'collectionBreakdown', 'receiptDetail', 'receivedAmountBs',
    'receiptCustomerName', 'receiptIssuedAt',
    'contractAllocationBs', 'guaranteeAllocationBs', 'surplusAllocationBs',
    'deletedAt', 'deletedBy', 'deletionReason', 'editedAt', 'editedBy', 'editReason',
  ];
  return Object.fromEntries(fields
    .filter((field) => movement?.[field] !== undefined && movement?.[field] !== null && movement?.[field] !== '')
    .map((field) => [field, movement[field]]));
};

const isGuaranteeRefundMovement = (movement = {}) => {
  const values = [movement?.accountingTag, movement?.category, movement?.type]
    .map((value) => String(value ?? '').trim().toLowerCase());
  return values.includes('guarantee_refund')
    || values.includes('garantia_devuelta_manual')
    || values.includes('egreso_devolucion_garantia_manual');
};

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


const normalizeEconomicLedgerAttachment = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const url = String(value?.url ?? '').trim();
  const filename = String(value?.filename ?? '').trim();
  if (!url || !filename) return null;
  return {
    url,
    filename,
    originalName: String(value?.originalName ?? filename).trim() || filename,
    mimeType: String(value?.mimeType ?? '').trim().toLowerCase(),
    bytes: Math.max(0, Math.trunc(Number(value?.bytes ?? 0))),
    uploadedAt: String(value?.uploadedAt ?? '').trim() || null,
    uploadedById: value?.uploadedById ?? null,
    uploadedByName: String(value?.uploadedByName ?? '').trim(),
  };
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
      cashRegisteredAt: String(entry?.cashRegisteredAt ?? '').trim() || null,
      cashCollectionTarget: String(entry?.cashCollectionTarget ?? '').trim().toLowerCase(),
      reclassifiedFromPayment: Boolean(entry?.reclassifiedFromPayment),
      refundSource: entry?.refundSource === 'surplus' ? 'surplus' : 'guarantee',
      sourceDepositId: String(entry?.sourceDepositId ?? '').trim() || null,
      contractAllocationBs: toPositiveRoundedNumber(entry?.contractAllocationBs),
      guaranteeAllocationBs: toPositiveRoundedNumber(entry?.guaranteeAllocationBs),
      surplusAllocationBs: toPositiveRoundedNumber(entry?.surplusAllocationBs),
      attachment: normalizeEconomicLedgerAttachment(entry?.attachment),
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
      : payload?.state
        ? 'full'
        : `route:${req.originalUrl}`;
  const cacheKey = `${String(payload?.revision ?? payload?.updatedAt ?? payload?.version ?? 'no-revision')}:${payloadScope}`;
  let cacheEntry = jsonPayloadCache.get(cacheKey);
  if (!cacheEntry) {
    cacheEntry = { body: JSON.stringify(payload), gzipPromise: null };
    jsonPayloadCache.set(cacheKey, cacheEntry);
    if (jsonPayloadCache.size > JSON_PAYLOAD_CACHE_LIMIT) {
      jsonPayloadCache.delete(jsonPayloadCache.keys().next().value);
    }
  }
  const body = cacheEntry.body;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');

  if (/\bgzip\b/i.test(String(req.get('Accept-Encoding') ?? '')) && body.length > 1024) {
    if (!cacheEntry.gzipPromise) cacheEntry.gzipPromise = gzipAsync(Buffer.from(body), { level: 6 });
    const compressed = await cacheEntry.gzipPromise;
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

const isArchivedAccountingRecord = (record) => Boolean(
  record?.deletedAt
  || record?.accountingArchivedAt
  || record?.accountingPeriodStatus === 'archived'
);

const getCurrentAccountingRows = (state) => ({
  cashMovements: (Array.isArray(state?.cashMovements) ? state.cashMovements : [])
    .filter((row) => !isArchivedAccountingRecord(row)),
  cashSessions: (Array.isArray(state?.cashSessions) ? state.cashSessions : [])
    .filter((row) => !isArchivedAccountingRecord(row)),
  cashDebts: (Array.isArray(state?.cashDebts) ? state.cashDebts : [])
    .filter((row) => !isArchivedAccountingRecord(row)),
});

const buildAccountingResetAnalysis = (state) => {
  const current = getCurrentAccountingRows(state);
  const movementCounts = current.cashMovements.reduce((result, movement) => {
    const cashBoxType = String(movement?.cashBoxType ?? '').toUpperCase();
    if (cashBoxType === 'PETTY_CASH') result.pettyCash += 1;
    else result.bigCash += 1;
    if (movement?.linkedContractId || movement?.linkedRentalId || movement?.linkedOrderCode) {
      result.contractLinked += 1;
    }
    if (movement?.isInternalTransfer) result.internalTransfers += 1;
    return result;
  }, { bigCash: 0, pettyCash: 0, contractLinked: 0, internalTransfers: 0 });
  const total = current.cashMovements.length + current.cashSessions.length + current.cashDebts.length;
  const module = {
    id: 'cash_accounting',
    level: 'safe',
    risk: 'medio',
    name: 'Iniciar nuevo periodo de Caja Grande y Caja Chica',
    description: 'Archiva el periodo contable actual y comienza ambas cajas en Bs 0,00 sin borrar contratos, recibos ni movimientos economicos.',
    total,
    deleteCount: total,
    archiveCount: total,
    blockedCount: 0,
    dependencies: [],
    records: { deletable: [], blocked: [] },
    impact: {
      cashMovements: current.cashMovements.length,
      cashSessions: current.cashSessions.length,
      cashDebts: current.cashDebts.length,
      ...movementCounts,
    },
  };
  return {
    availableModules: [module],
    selectedModules: ['cash_accounting'],
    modules: [module],
    summary: {
      total,
      deletable: total,
      archived: total,
      blocked: 0,
      critical: 0,
    },
    impact: module.impact,
    canExecute: true,
  };
};

const writeAccountingResetBackup = async ({ snapshot, currentUser }) => {
  await fs.mkdir(accountingBackupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `accounting-reset-${timestamp}.json`;
  const filepath = path.join(accountingBackupDirectory, filename);
  const payload = {
    app: 'el-copetin',
    kind: 'accounting-reset-backup',
    exportedAt: new Date().toISOString(),
    exportedBy: {
      id: currentUser?.id ?? null,
      name: currentUser?.fullName ?? currentUser?.name ?? 'Developer',
      role: getUserDisplayRole(currentUser),
    },
    revision: snapshot?.revision ?? null,
    state: snapshot?.state ?? {},
  };
  await fs.writeFile(filepath, JSON.stringify(payload), 'utf8');
  return { filename, filepath };
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

const resolveActiveRentalForContract = (rentals, contract, serviceOrder = null, payload = null) => {
  const activeRentals = (Array.isArray(rentals) ? rentals : []).filter((entry) => !entry?.deletedAt);
  const normalize = normalizeEconomicContextKey;
  const contractId = normalize(contract?.id);
  const contractRentalId = normalize(contract?.rentalId);
  const payloadRentalId = normalize(payload?.rentalId);
  const orderRentalId = normalize(serviceOrder?.rentalId);
  const contractCode = normalize(contract?.contractCode ?? contract?.number);
  const orderCode = normalize(contract?.orderCode ?? serviceOrder?.orderCode ?? serviceOrder?.codigo);

  // Prioridad absoluta a IDs estructurados. Un orderCode puede reutilizarse al
  // eliminar y reconstruir un contrato, por lo que nunca debe ganar sobre IDs.
  if (contractRentalId) {
    const exact = activeRentals.find((entry) => normalize(entry?.id) === contractRentalId);
    if (exact) return exact;
  }
  if (payloadRentalId) {
    const exact = activeRentals.find((entry) => normalize(entry?.id) === payloadRentalId);
    if (exact) return exact;
  }
  if (contractId) {
    const exact = activeRentals.find((entry) => normalize(entry?.contractId) === contractId);
    if (exact) return exact;
  }
  if (orderRentalId) {
    const exact = activeRentals.find((entry) => normalize(entry?.id) === orderRentalId);
    if (exact && (!normalize(exact?.contractId) || normalize(exact?.contractId) === contractId)) return exact;
  }

  // Compatibilidad histórica: solo registros sin vínculo fuerte a otro contrato.
  if (contractCode) {
    const byContractCode = activeRentals.find((entry) => {
      const entryContractId = normalize(entry?.contractId);
      return normalize(entry?.contractCode ?? entry?.number) === contractCode
        && (!entryContractId || entryContractId === contractId);
    });
    if (byContractCode) return byContractCode;
  }
  if (orderCode) {
    return activeRentals.find((entry) => {
      const entryContractId = normalize(entry?.contractId);
      return normalize(entry?.orderCode) === orderCode
        && (!entryContractId || entryContractId === contractId);
    }) ?? null;
  }
  return null;
};

const resolveServiceOrderForContract = (serviceOrders, contract, rental = null) => {
  const orders = Array.isArray(serviceOrders) ? serviceOrders : [];
  const normalize = normalizeEconomicContextKey;
  const contractId = normalize(contract?.id);
  const rentalId = normalize(rental?.id ?? contract?.rentalId);
  const orderCode = normalize(contract?.orderCode ?? rental?.orderCode);

  if (contractId) {
    const exact = orders.find((entry) => normalize(entry?.contractId) === contractId);
    if (exact) return exact;
  }
  if (rentalId) {
    const exact = orders.find((entry) => normalize(entry?.rentalId) === rentalId);
    if (exact) return exact;
  }
  if (!orderCode) return null;

  // El código de orden es únicamente un respaldo para datos antiguos sin IDs.
  return orders.find((entry) => {
    const entryContractId = normalize(entry?.contractId);
    const entryRentalId = normalize(entry?.rentalId);
    const entryOrderCode = normalize(entry?.orderCode ?? entry?.codigo);
    return entryOrderCode === orderCode && !entryContractId && !entryRentalId;
  }) ?? null;
};


const isLegacySyntheticEconomicEntry = (entry, contract = null) => {
  if (!entry || entry?.deletedAt) return false;
  const entryId = String(entry?.id ?? '').trim().toLowerCase();
  const note = String(entry?.note ?? '').trim().toLowerCase();
  const contractId = String(contract?.id ?? '').trim().toLowerCase();
  const exactInitialId = contractId ? `initial-payment-${contractId}` : '';
  const exactGuaranteeId = contractId ? `validated-guarantee-${contractId}` : '';
  return (
    (entry?.type === 'deposit' && (
      (exactInitialId && entryId === exactInitialId)
      || note === 'pago inicial registrado al crear el contrato.'
      || note === 'pago inicial registrado al crear el contrato'
    ))
    || (entry?.type === 'guarantee' && (
      (exactGuaranteeId && entryId === exactGuaranteeId)
      || entryId.includes('garantia-validada')
      || note === 'garantia pagada registrada al crear el contrato.'
      || note === 'garantia pagada registrada al crear el contrato'
    ))
  );
};

const getLegacyResetRevivalRepair = (contract = {}) => {
  const ledger = normalizeEconomicLedgerRows(contract?.economicLedger).filter((entry) => !entry?.deletedAt);
  const legacyEntries = ledger.filter((entry) => isLegacySyntheticEconomicEntry(entry, contract));
  const modernEntries = ledger.filter((entry) => !isLegacySyntheticEconomicEntry(entry, contract));
  const hasLegacyInitial = legacyEntries.some((entry) => entry.type === 'deposit');
  const hasLegacyGuarantee = legacyEntries.some((entry) => entry.type === 'guarantee');
  const linkedModernEntries = modernEntries.filter((entry) =>
    String(entry?.cashMovementId ?? '').trim()
    || String(entry?.cashReceiptCode ?? '').trim()
  );
  const ledgerUpdatedAtMs = new Date(contract?.economicLedgerUpdatedAt ?? 0).getTime() || 0;
  const createdAtMs = new Date(
    contract?.approvedAt
    ?? contract?.createdAt
    ?? contract?.contractDate
    ?? 0,
  ).getTime() || 0;
  const updatedAfterCreation = ledgerUpdatedAtMs > 0
    && (!createdAtMs || ledgerUpdatedAtMs - createdAtMs > 60 * 1000);

  const shouldRepair = !contract?.economicResetAt
    && Number(contract?.economicResetVersion ?? 0) < 1
    && hasLegacyInitial
    && hasLegacyGuarantee
    && modernEntries.length >= 3
    && linkedModernEntries.length >= 2
    && updatedAfterCreation;

  return { shouldRepair, legacyEntries, modernEntries };
};

router.post('/__copetin_db/contracts/:id/economic-ledger/repair-legacy-reset', async (req, res, next) => {
  try {
    const requestedId = String(req.params.id ?? '').trim();
    if (!requestedId) {
      res.status(400).json({ error: 'Debes indicar el contrato.' });
      return;
    }

    let responseData = null;
    const result = await updateStateSnapshot((state) => {
      state.contracts = Array.isArray(state.contracts) ? state.contracts : [];
      const requestedKey = normalizeEconomicContextKey(requestedId);
      const matchingContracts = state.contracts.filter((entry) => [
        entry?.id,
        entry?.contractCode,
        entry?.number,
        entry?.orderCode,
        entry?.rentalId,
      ].some((value) => normalizeEconomicContextKey(value) === requestedKey));
      const contract = matchingContracts.find((entry) => !entry?.deletedAt)
        ?? matchingContracts[0]
        ?? null;

      if (!contract) {
        const error = new Error('Contrato no encontrado para reparar el cuaderno economico.');
        error.statusCode = 404;
        throw error;
      }

      const repair = getLegacyResetRevivalRepair(contract);
      if (!repair.shouldRepair) {
        responseData = {
          repaired: false,
          contract: structuredClone(contract),
          removedLegacyRows: 0,
        };
        return state;
      }

      const now = new Date().toISOString();
      const repairUserId = contract?.economicLedgerUpdatedById ?? null;
      const repairUserName = String(
        contract?.economicLedgerUpdatedByName
        ?? req.body?.updatedByName
        ?? req.body?.userName
        ?? 'Sistema',
      ).trim() || 'Sistema';

      contract.economicLedger = repair.modernEntries;
      contract.economicResetAt = contract?.economicLedgerUpdatedAt ?? now;
      contract.economicResetVersion = 1;
      contract.economicLedgerUpdatedAt = now;
      contract.economicLedgerUpdatedById = repairUserId;
      contract.economicLedgerUpdatedByName = repairUserName;

      state.systemAuditLog = Array.isArray(state.systemAuditLog) ? state.systemAuditLog : [];
      state.systemAuditLog.unshift({
        id: directId('audit'),
        type: 'contract_economic_legacy_repair',
        action: 'reparar_lineas_legacy_post_reset',
        entityType: 'contract',
        entityId: contract.id,
        entityCode: contract.contractCode ?? '',
        detail: `Se retiraron ${repair.legacyEntries.length} linea(s) sintetica(s) legacy revividas despues de actividad economica reconstruida.`,
        userId: repairUserId,
        userName: repairUserName,
        createdAt: now,
      });

      responseData = {
        repaired: true,
        contract: structuredClone(contract),
        removedLegacyRows: repair.legacyEntries.length,
      };
      return state;
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
    const matchingContracts = contracts.filter((entry) => [
      entry?.id,
      entry?.contractCode,
      entry?.number,
      entry?.orderCode,
      entry?.rentalId,
    ].some((value) => normalizeEconomicContextKey(value) === requestedKey));
    const contract = matchingContracts.find((entry) => !entry?.deletedAt)
      ?? matchingContracts[0]
      ?? null;

    if (!contract) {
      res.status(404).json({ error: 'Contrato no encontrado.' });
      return;
    }

    const preliminaryOrder = resolveServiceOrderForContract(serviceOrders, contract);
    const rental = resolveActiveRentalForContract(rentals, contract, preliminaryOrder);
    const serviceOrder = resolveServiceOrderForContract(serviceOrders, contract, rental)
      ?? preliminaryOrder;
    const strictKeys = getStrictEconomicLinkKeys(contract, rental, serviceOrder);

    const movements = cashMovements
      .filter((movement) => strictEconomicRecordMatches(movement, strictKeys))
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

  // Jerarquía excluyente: cuando existe linkedContractId, ese dato manda.
  // No se permite que un orderCode o rentalId compartido rescate un movimiento
  // que ya declara pertenecer a otro contrato.
  if (linkedContractId) return Boolean(keys.contractId && linkedContractId === keys.contractId);
  if (linkedRentalId) return keys.rentalIds.has(linkedRentalId);
  if (sourceId) return sourceId === keys.contractId || keys.rentalIds.has(sourceId);

  // Compatibilidad limitada para registros antiguos realmente sin IDs.
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
  const storedGuaranteePaidBs = directMoney(
    contract?.guarantee?.validatedBs
    ?? rental?.guarantee?.validatedBs
    ?? rental?.depositBs
    ?? 0,
  );
  // Un contrato marcado como garantia pagada debe reconstruir el importe vigente
  // aunque los campos derivados de la orden hayan quedado en cero por un Reset anterior.
  const guaranteePaidBs = guaranteeStatus === 'validado'
    ? directMoney(storedGuaranteePaidBs > 0 ? storedGuaranteePaidBs : guaranteeDeclaredBs)
    : 0;
  const paymentMethod = directPaymentMethod(
    contract?.payment?.initialPaymentMethod
    ?? contract?.payment?.method
    ?? contract?.initialPaymentMethod
    ?? contract?.paymentMethod
    ?? rental?.payment?.initialPaymentMethod
    ?? rental?.payment?.method
    ?? 'efectivo',
  );
  const paymentAccount = directPaymentAccount(
    paymentMethod,
    contract?.payment?.initialPaymentAccount
    ?? contract?.payment?.account
    ?? contract?.initialPaymentAccount
    ?? contract?.paymentAccount
    ?? rental?.payment?.initialPaymentAccount
    ?? rental?.payment?.account
    ?? '',
  );
  const guaranteeMethod = directPaymentMethod(
    contract?.guarantee?.paymentMethod
    ?? contract?.guarantee?.method
    ?? contract?.payment?.guaranteePaymentMethod
    ?? contract?.payment?.guaranteeMethod
    ?? rental?.guarantee?.paymentMethod
    ?? rental?.guarantee?.method
    ?? rental?.payment?.guaranteePaymentMethod
    ?? rental?.payment?.guaranteeMethod
    ?? paymentMethod,
  );
  const guaranteeAccount = directPaymentAccount(
    guaranteeMethod,
    contract?.guarantee?.paymentAccount
    ?? contract?.guarantee?.account
    ?? contract?.payment?.guaranteePaymentAccount
    ?? contract?.payment?.guaranteeAccount
    ?? rental?.guarantee?.paymentAccount
    ?? rental?.guarantee?.account
    ?? rental?.payment?.guaranteePaymentAccount
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

const getRentalChargeTargetBs = (contract, rental) => {
  const storedTotalBs = directMoney(Math.max(
    Number(rental?.totals?.totalBs ?? 0),
    Number(contract?.totals?.totalBs ?? contract?.totalBs ?? 0),
  ));
  const pricingMode = String(
    rental?.pricingPlan?.mode
    ?? contract?.pricingPlan?.mode
    ?? '',
  ).trim().toLowerCase();
  if (pricingMode !== 'daily_schedule') return storedTotalBs;

  const itemsNetSubtotalBs = directMoney(
    rental?.totals?.itemsNetSubtotalBs
    ?? rental?.totals?.itemsSubtotalBs
    ?? contract?.totals?.itemsNetSubtotalBs
    ?? contract?.totals?.itemsSubtotalBs
    ?? 0,
  );
  if (itemsNetSubtotalBs <= 0) return storedTotalBs;

  const servicesSubtotalBs = directMoney(
    rental?.totals?.servicesSubtotalBs
    ?? contract?.totals?.servicesSubtotalBs
    ?? 0,
  );
  const discountBs = directMoney(
    rental?.totals?.discountBs
    ?? contract?.totals?.discountBs
    ?? 0,
  );
  const deliveryFeeBs = directMoney(
    rental?.totals?.deliveryFeeBs
    ?? rental?.deliveryFeeBs
    ?? contract?.totals?.deliveryFeeBs
    ?? contract?.deliveryFeeBs
    ?? 0,
  );
  const reconstructedTotalBs = directMoney(Math.max(
    0,
    itemsNetSubtotalBs + servicesSubtotalBs - discountBs + deliveryFeeBs,
  ));

  // Reparacion conservadora para daily_schedule antiguos: nunca reduce un total
  // ya valido y evita volver a perder ventas manuales de proveedor/subalquiler.
  return Math.max(storedTotalBs, reconstructedTotalBs);
};

// La parte comercial pendiente siempre se obtiene del contrato vigente y de los
// pagos confirmados. Daños, garantías y devoluciones viven fuera de este cálculo,
// por lo que pueden conservarse al reemplazar una liquidación comercial antigua.
const getCurrentCommercialOutstandingBs = (contract, rental) => {
  const chargeTargetBs = getRentalChargeTargetBs(contract, rental);
  const paidBs = directMoney(Math.max(
    Number(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs ?? 0),
    Number(contract?.payment?.paidAtApprovalBs ?? 0),
  ));
  return directMoney(Math.max(0, chargeTargetBs - paidBs));
};

// Las devoluciones antiguas guardaron una fotografia del saldo comercial. Si el
// contrato cambia despues, conservamos la parte no comercial de esa fotografia
// (danos/faltantes menos garantia o cobros) y sustituimos solo el saldo comercial.
const getReconciledReturnedPendingCollectionBs = (contract, rental) => {
  const settlement = rental?.returnSettlement ?? {};
  const storedPendingBs = Number(
    settlement?.pendingCollectionBs
    ?? rental?.payment?.pendingPaymentBs
    ?? rental?.totals?.pendingPaymentBs
    ?? 0,
  );
  const storedCommercialOutstandingBs = Number(
    settlement?.outstandingRentalBs
    ?? storedPendingBs,
  );
  const currentCommercialOutstandingBs = getCurrentCommercialOutstandingBs(contract, rental);
  const reconciledStoredPendingBs = directMoney(Math.max(
    0,
    storedPendingBs + currentCommercialOutstandingBs - storedCommercialOutstandingBs,
  ));
  const hasSettlementBreakdown = [
    settlement?.outstandingRentalBs,
    settlement?.penaltiesBs,
    settlement?.discountCoveredByDepositBs,
  ].some((value) => value !== undefined && value !== null);
  if (!hasSettlementBreakdown) return reconciledStoredPendingBs;

  const penaltiesBs = directMoney(settlement?.penaltiesBs ?? rental?.penaltiesBs);
  const coveredByDepositBs = directMoney(settlement?.discountCoveredByDepositBs);
  const damageCollectedBs = directMoney(Math.max(
    Number(settlement?.damageCollectedBs ?? 0),
    Number(settlement?.penaltiesCollectedBs ?? 0),
    Number(rental?.payment?.damageCollectedBs ?? 0),
    Number(rental?.totals?.damageCollectedBs ?? 0),
  ));
  const derivedPendingBs = directMoney(Math.max(
    0,
    currentCommercialOutstandingBs + penaltiesBs - coveredByDepositBs - damageCollectedBs,
  ));
  return directMoney(Math.min(reconciledStoredPendingBs, derivedPendingBs));
};

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

const directBusinessText = (value) =>
  String(value ?? '').trim().toLocaleUpperCase('es-BO');

const buildDirectSupplier = (payload = {}, now = new Date().toISOString()) => ({
  id: directId('sup'),
  name: directBusinessText(payload.name),
  contactName: directBusinessText(payload.contactName),
  phone: String(payload.phone ?? '').trim(),
  whatsapp: String(payload.whatsapp ?? payload.phone ?? '').trim(),
  email: String(payload.email ?? '').trim().toLowerCase(),
  address: directBusinessText(payload.address),
  city: directBusinessText(payload.city),
  type: 'regular',
  paymentTerms: directBusinessText(payload.paymentTerms),
  notes: directBusinessText(payload.notes),
  status: 'active',
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
});
const directInventoryLineKey = (line, index = 0) => String(
  line?.lineKey
  ?? line?.returnLineKey
  ?? `${line?.comboLineKey || 'item'}-${line?.itemId || 'sin-item'}-${line?.comboRuleIndex ?? index}-${index}`,
).trim();

const directDateKey = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const exact = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (exact) return exact[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const directRentalAffectsCurrentStock = (rental, todayKey = directDateKey(new Date())) => {
  if (!rental || rental.deletedAt || rental.cancelledAt || rental.returnedAt) return false;
  const status = directNormalizeText(rental?.status);
  if (!['active', 'confirmed', 'pending'].includes(status)) return false;
  const inventoryStatus = directNormalizeText(rental?.operational?.inventoryStatus);
  if (inventoryStatus === 'devuelto' || inventoryStatus === 'anulado') return false;
  if (inventoryStatus === 'salio') return true;
  const startKey = directDateKey(rental?.rentalDate ?? rental?.deliveryDate);
  const endKey = directDateKey(rental?.dueDate ?? rental?.pickupDate ?? startKey);
  return Boolean(startKey && todayKey >= startKey && (!endKey || todayKey <= endKey));
};
const directOutstandingReservedQty = (rental, line, index = 0) => {
  if (!line || line?.controlsStock === false) return 0;
  const quantity = Math.max(0, Math.trunc(Number(line?.quantity ?? 0)));
  const supplierBackedQty = Math.max(0, Math.trunc(Number(line?.supplierBackedQty ?? 0)));
  const hasStoredReservedQty = line?.internalReservedQty !== undefined
    && line?.internalReservedQty !== null
    && line?.internalReservedQty !== '';
  const reservedQty = hasStoredReservedQty
    ? Math.max(0, Math.trunc(Number(line?.internalReservedQty ?? 0)))
    : Math.max(0, quantity - supplierBackedQty);
  if (reservedQty <= 0) return 0;

  const lineKey = directInventoryLineKey(line, index);
  const processedQty = (Array.isArray(rental?.partialReturnReport?.items) ? rental.partialReturnReport.items : [])
    .filter((entry) => (
      String(entry?.lineKey ?? '') === String(lineKey)
      || (!entry?.lineKey && String(entry?.itemId ?? '') === String(line?.itemId ?? ''))
    ))
    .reduce((sum, entry) => sum
      + Math.max(0, Math.trunc(Number(entry?.returnedQty ?? 0)))
      + Math.max(0, Math.trunc(Number(entry?.damagedQty ?? 0))), 0);

  return Math.max(0, reservedQty - processedQty);
};
const directActiveReservedStockForItem = (state, itemId) => {
  const requestedItemId = String(itemId ?? '').trim();
  if (!requestedItemId) return 0;
  const todayKey = directDateKey(new Date());
  return (Array.isArray(state?.rentals) ? state.rentals : [])
    .filter((rental) => directRentalAffectsCurrentStock(rental, todayKey))
    .reduce((total, rental) => total + (Array.isArray(rental?.items) ? rental.items : [])
      .reduce((lineTotal, line, index) => (
        String(line?.itemId ?? '').trim() === requestedItemId
          ? lineTotal + directOutstandingReservedQty(rental, line, index)
          : lineTotal
      ), 0), 0);
};
const directRecoveryStockForItem = (state, itemId) => {
  const requestedItemId = String(itemId ?? '').trim();
  if (!requestedItemId) return 0;
  return (Array.isArray(state?.stockRecoveries) ? state.stockRecoveries : [])
    .filter((entry) => String(entry?.itemId ?? '').trim() === requestedItemId)
    .reduce((total, entry) => total + Math.max(0, Math.trunc(Number(entry?.quantity ?? 0))), 0);
};
const directNormalizeAvailableStockForItem = (state, item) => {
  if (!item || item?.controlsStock === false) return Number(item?.availableStock ?? 0);
  const totalStock = Math.max(0, Math.trunc(Number(item?.totalStock ?? 0)));
  const reservedStock = directActiveReservedStockForItem(state, item?.id);
  const recoveryStock = directRecoveryStockForItem(state, item?.id);
  const canonicalAvailableStock = Math.max(0, totalStock - reservedStock - recoveryStock);
  item.availableStock = canonicalAvailableStock;
  return canonicalAvailableStock;
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
  receivedAmountBs: directMoney(payload.receivedAmountBs ?? payload.amountBs),
  contractAllocationBs: directMoney(payload.contractAllocationBs),
  guaranteeAllocationBs: directMoney(payload.guaranteeAllocationBs),
  surplusAllocationBs: directMoney(payload.surplusAllocationBs),
  transportRevenueBs: directMoney(payload.transportRevenueBs),
  damageCollectedBs: directMoney(payload.damageCollectedBs),
  transportExpenseBs: directMoney(payload.transportExpenseBs),
  clientOperationId: String(payload.clientOperationId ?? '').trim() || null,
  createdAt: new Date().toISOString(),
});

const reconcileVipPrepaidRental = (state, rental, contract = null) => {
  if (!rental || rental?.deletedAt || String(rental?.status ?? '').toLowerCase() === 'cancelled') return null;
  // Las liquidaciones de devolución tienen su propio desglose (alquiler + daños).
  // No se reescriben aquí para no mezclar el prepago comercial con penalidades.
  if (String(rental?.status ?? '').toLowerCase() === 'returned' || rental?.returnSettlement) return null;

  const clients = Array.isArray(state?.clients) ? state.clients : [];
  const client = clients.find((entry) => String(entry?.id ?? '') === String(rental?.clientId ?? ''))
    ?? clients.find((entry) => String(entry?.name ?? '').trim().toLowerCase() === String(rental?.customerName ?? '').trim().toLowerCase());
  if (!client?.prepaidEnabled) return null;

  const charges = (Array.isArray(client?.prepaidMovements) ? client.prepaidMovements : [])
    .filter((movement) => movement?.type === 'charge')
    .filter((movement) => (
      String(movement?.sourceId ?? '') === String(rental.id)
      || (movement?.orderCode && String(movement.orderCode) === String(rental?.orderCode ?? ''))
    ));
  const prepaidChargedBs = directMoney(charges.reduce((sum, movement) => sum + Math.abs(Number(movement?.amountBs ?? 0)), 0));
  if (prepaidChargedBs <= 0) return null;

  const storedPrepaidBs = directMoney(Math.max(
    Number(rental?.payment?.prepaidAppliedBs ?? 0),
    Number(rental?.totals?.prepaidAppliedBs ?? 0),
    Number(rental?.prepaidAppliedBs ?? 0),
    Number(contract?.payment?.prepaidAppliedBs ?? 0),
    Number(contract?.prepaidAppliedBs ?? 0),
  ));
  const prepaidAppliedBs = directMoney(Math.max(storedPrepaidBs, prepaidChargedBs));
  const totalBs = directMoney(Math.max(
    Number(rental?.totals?.totalBs ?? 0),
    Number(contract?.totals?.totalBs ?? contract?.totalBs ?? 0),
  ));
  if (totalBs <= 0) return null;

  const storedPaidBs = directMoney(Math.max(
    Number(rental?.payment?.paidAtRentalBs ?? 0),
    Number(rental?.totals?.paidAtRentalBs ?? 0),
  ));
  // En registros correctos paidAtRentalBs ya incluye el prepago; en los defectuosos
  // puede ser 0. Se separa la parte no VIP solo cuando el total pagado ya contiene
  // al menos el prepago realmente consumido, evitando duplicarlo.
  const nonVipPaidBs = storedPaidBs + 0.01 >= prepaidAppliedBs
    ? directMoney(Math.max(0, storedPaidBs - prepaidAppliedBs))
    : storedPaidBs;
  const correctedPaidBs = directMoney(Math.min(totalBs, nonVipPaidBs + prepaidAppliedBs));
  const correctedPendingBs = directMoney(Math.max(0, totalBs - correctedPaidBs));
  const currentPendingBs = directMoney(rental?.payment?.pendingPaymentBs ?? rental?.totals?.pendingPaymentBs ?? 0);
  const contractPendingBs = directMoney(contract?.payment?.pendingPaymentBs ?? contract?.payment?.pendingBs ?? correctedPendingBs);
  const contractPrepaidBs = directMoney(contract?.payment?.prepaidAppliedBs ?? contract?.prepaidAppliedBs ?? prepaidAppliedBs);
  const needsRepair = Math.abs(currentPendingBs - correctedPendingBs) > 0.01
    || Math.abs(storedPaidBs - correctedPaidBs) > 0.01
    || Math.abs(Number(rental?.totals?.totalBs ?? 0) - totalBs) > 0.01
    || (contract && Math.abs(contractPendingBs - correctedPendingBs) > 0.01)
    || (contract && Math.abs(contractPrepaidBs - prepaidAppliedBs) > 0.01);
  if (!needsRepair) return { repaired: false, prepaidAppliedBs, correctedPaidBs, correctedPendingBs };

  const now = new Date().toISOString();
  const paymentStatus = correctedPendingBs <= 0.009 ? 'cancelado' : correctedPaidBs > 0 ? 'saldo_pendiente' : 'sin_pago';
  const paymentMode = correctedPendingBs <= 0.009 ? 'cancelado' : correctedPaidBs > 0 ? 'a_cuenta' : 'sin_pago';
  rental.payment = {
    ...(rental.payment ?? {}),
    prepaidAppliedBs,
    paidAtRentalBs: correctedPaidBs,
    pendingPaymentBs: correctedPendingBs,
    status: paymentStatus,
    mode: paymentMode,
  };
  rental.totals = {
    ...(rental.totals ?? {}),
    totalBs,
    prepaidAppliedBs,
    paidAtRentalBs: correctedPaidBs,
    pendingPaymentBs: correctedPendingBs,
    status: paymentStatus,
    mode: paymentMode,
  };
  rental.prepaidAppliedBs = prepaidAppliedBs;
  rental.updatedAt = now;

  if (contract) {
    contract.payment = {
      ...(contract.payment ?? {}),
      prepaidAppliedBs,
      paidAtApprovalBs: directMoney(Math.max(Number(contract?.payment?.paidAtApprovalBs ?? 0), correctedPaidBs)),
      pendingBs: correctedPendingBs,
      pendingPaymentBs: correctedPendingBs,
      status: paymentStatus,
      mode: paymentMode,
    };
    contract.prepaidAppliedBs = prepaidAppliedBs;
    contract.paymentStatus = paymentStatus;
    contract.updatedAt = now;
  }
  (Array.isArray(state?.serviceOrders) ? state.serviceOrders : []).forEach((order) => {
    if (String(order?.rentalId ?? order?.id ?? '') === String(rental.id)
      || String(order?.codigo ?? order?.orderCode ?? '') === String(rental?.orderCode ?? '')) {
      order.saldo_pendiente = correctedPendingBs;
      order.updated_at = now;
    }
  });
  return { repaired: true, prepaidAppliedBs, correctedPaidBs, correctedPendingBs };
};

const repairVipPrepaidBalances = (state) => {
  const contracts = Array.isArray(state?.contracts) ? state.contracts : [];
  const rentals = Array.isArray(state?.rentals) ? state.rentals : [];
  const contractByRentalId = new Map(contracts.filter((row) => row?.rentalId).map((row) => [String(row.rentalId), row]));
  const repairs = [];
  rentals.forEach((rental) => {
    const contract = contractByRentalId.get(String(rental?.id ?? ''))
      ?? contracts.find((row) => String(row?.id ?? '') === String(rental?.contractId ?? ''))
      ?? null;
    const result = reconcileVipPrepaidRental(state, rental, contract);
    if (result?.repaired) repairs.push({ rentalId: rental.id, orderCode: rental.orderCode, contractCode: rental.contractCode ?? contract?.contractCode ?? '', ...result });
  });
  return repairs;
};

const revertDirectReturnEffects = (state, rental) => {
  const partialReport = Array.isArray(rental?.partialReturnReport?.items)
    ? rental.partialReturnReport.items
    : [];
  const finalReport = Array.isArray(rental?.returnReport) ? rental.returnReport : [];
  const previousReport = partialReport.length > 0 ? partialReport : finalReport;
  const now = new Date().toISOString();

  previousReport.forEach((line) => {
    const returnedToAvailableQty = Math.max(0, Math.trunc(Number(line?.returnedToAvailableQty ?? 0)));
    const stockLossQty = Math.max(0, Math.trunc(Number(
      line?.stockLossQty
      ?? (
        Number(line?.damagedStockLossQty ?? line?.damagedQty ?? 0)
        + Number(line?.missingStockLossQty ?? line?.missingQty ?? 0)
      )
    )));
    if (returnedToAvailableQty <= 0 && stockLossQty <= 0) return;

    const item = (Array.isArray(state.items) ? state.items : [])
      .find((entry) => String(entry?.id ?? '') === String(line?.itemId ?? ''));
    if (!item) return;

    // Revertimos exactamente lo que esta recepción había aplicado:
    // - lo bueno deja nuevamente el disponible;
    // - daños/faltantes recuperan el stock físico que fue dado de baja.
    if (returnedToAvailableQty > 0) {
      item.availableStock = Math.max(0, Number(item.availableStock ?? 0) - returnedToAvailableQty);
    }
    if (stockLossQty > 0) {
      item.totalStock = Math.max(
        Number(item.availableStock ?? 0),
        Number(item.totalStock ?? 0) + stockLossQty,
      );
    }
    item.updatedAt = now;
  });

  state.inventoryMovements = (Array.isArray(state.inventoryMovements) ? state.inventoryMovements : [])
    .filter((movement) => !(
      String(movement?.sourceType ?? '') === 'rental_return_loss'
      && String(movement?.sourceRentalId ?? movement?.sourceId ?? '') === String(rental.id)
    ));

  state.stockRecoveries = (Array.isArray(state.stockRecoveries) ? state.stockRecoveries : [])
    .filter((entry) => String(entry?.sourceRentalId ?? '') !== String(rental.id));

  // Solo se eliminan movimientos automáticos sin dinero real. Cobros efectivos/QR
  // ya realizados se conservan para no borrar caja ni recibos por un retroceso operativo.
  const automaticTypes = new Set(['liquidacion_devolucion', 'saldo_pendiente_cobro', 'perdida_interna_devolucion']);
  state.cashMovements = (Array.isArray(state.cashMovements) ? state.cashMovements : [])
    .filter((movement) => !(
      String(movement?.sourceId ?? '') === String(rental.id)
      && automaticTypes.has(String(movement?.type ?? ''))
      && Number(movement?.amountBs ?? 0) === 0
    ));
};

const clearDirectReturnState = (state, rental) => {
  const hasReturnEffects = Boolean(
    (Array.isArray(rental?.returnReport) && rental.returnReport.length > 0)
    || (Array.isArray(rental?.partialReturnReport?.items) && rental.partialReturnReport.items.length > 0)
    || rental?.returnedAt
    || rental?.returnSettlement
    || rental?.operational?.returnReview
    || rental?.operational?.clientPendingPickup?.active
    || rental?.operational?.inventoryReturnedAt
  );

  if (!hasReturnEffects) return false;

  revertDirectReturnEffects(state, rental);

  rental.returnReport = [];
  rental.partialReturnReport = null;
  rental.returnSettlement = null;
  rental.returnedAt = null;
  rental.penaltiesBs = 0;
  rental.internalPenaltiesBs = 0;
  rental.refundBs = 0;

  if (rental.status === 'returned') {
    rental.status = 'active';
  }

  rental.operational = {
    ...(rental.operational ?? {}),
    inventoryReturnedAt: null,
    inventoryReturnedByName: null,
    inventoryReturnedByRole: null,
    returnReview: null,
    clientPendingPickup: null,
  };

  return true;
};

const findDirectOperation = (state, clientOperationId) => {
  const operationId = String(clientOperationId ?? '').trim();
  if (!operationId) return null;
  return (Array.isArray(state.cashMovements) ? state.cashMovements : [])
    .find((movement) => String(movement?.clientOperationId ?? '') === operationId) ?? null;
};

const getDirectCurrentCashSession = (state) => (
  (Array.isArray(state?.cashSessions) ? state.cashSessions : [])
    .find((session) => (
      !isArchivedAccountingRecord(session)
      && String(session?.status ?? '').toLowerCase() === 'open'
    )) ?? null
);

const getDirectCurrentCashBalance = (state, cashBoxType) => Number(
  (Array.isArray(state?.cashMovements) ? state.cashMovements : [])
    .filter((movement) => !isArchivedAccountingRecord(movement))
    .filter((movement) => !movement?.voidedAt && String(movement?.receiptStatus ?? '').toLowerCase() !== 'anulado')
    .filter((movement) => String(movement?.cashBoxType ?? '').toUpperCase() === cashBoxType)
    .reduce((sum, movement) => sum + Number(movement?.amountBs ?? 0), 0)
    .toFixed(2)
);

const summarizeDirectCashState = (state) => ({
  bigCashBalanceBs: getDirectCurrentCashBalance(state, 'BIG_CASH'),
  pettyCashBalanceBs: getDirectCurrentCashBalance(state, 'PETTY_CASH'),
  activeSessionId: getDirectCurrentCashSession(state)?.id ?? null,
});

const normalizeDirectCashMovementPayload = (payload = {}) => {
  const type = String(payload?.type ?? '').trim().toLowerCase();
  const cashBoxType = String(payload?.cashBoxType ?? (type === 'egreso' ? 'PETTY_CASH' : 'BIG_CASH'))
    .trim()
    .toUpperCase();
  return {
    ...payload,
    type,
    cashBoxType: cashBoxType === 'PETTY_CASH' ? 'PETTY_CASH' : 'BIG_CASH',
    description: String(payload?.description ?? '').trim(),
    category: String(payload?.category ?? '').trim(),
    createdBy: String(payload?.createdBy ?? payload?.createdByName ?? payload?.userName ?? 'Sistema').trim() || 'Sistema',
    responsible: String(payload?.responsible ?? payload?.createdBy ?? 'Sistema').trim() || 'Sistema',
  };
};


router.post('/__copetin_db/contracts/cancel', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'La solicitud debe enviarse como objeto JSON.' });
      return;
    }

    const requestedRentalId = String(req.body?.id ?? req.body?.rentalId ?? '').trim();
    const requestedContractId = String(req.body?.contractId ?? '').trim();
    const reason = String(req.body?.reason ?? '').trim();
    if (!requestedRentalId && !requestedContractId) {
      res.status(400).json({ error: 'No se pudo identificar el contrato u orden de servicio a anular.' });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: 'Debes indicar por que se esta anulando el contrato.' });
      return;
    }

    let responseData = null;
    const result = await updateStateSnapshot((state) => {
      const now = new Date().toISOString();
      const normalize = (value) => String(value ?? '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      const toDayKey = (value) => {
        const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) return match[1];
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
      };
      const todayKey = toDayKey(now);
      const contractFromId = requestedContractId
        ? (state.contracts ?? []).find((entry) => entry.id === requestedContractId && !entry.deletedAt)
        : null;
      const rental = requestedRentalId
        ? (state.rentals ?? []).find((entry) => entry.id === requestedRentalId && !entry.deletedAt)
        : (state.rentals ?? []).find((entry) => (
          !entry.deletedAt && contractFromId && (
            entry.id === contractFromId.rentalId
            || (entry.orderCode && entry.orderCode === contractFromId.orderCode)
          )
        ));
      if (!rental) {
        const error = new Error('Orden de servicio no encontrada.');
        error.statusCode = 404;
        throw error;
      }
      if (rental.status === 'returned') {
        const error = new Error('No se puede anular una orden ya devuelta.');
        error.statusCode = 409;
        throw error;
      }
      if (rental.status === 'cancelled') {
        const error = new Error('Esta orden ya fue anulada.');
        error.statusCode = 409;
        throw error;
      }

      const contract = contractFromId ?? (state.contracts ?? []).find((entry) => (
        !entry.deletedAt && (
          entry.rentalId === rental.id
          || (entry.orderCode && entry.orderCode === rental.orderCode)
        )
      )) ?? null;
      const cutoffDate = contract?.deliveryDate ?? rental.rentalDate ?? contract?.eventDate ?? null;
      if (!cutoffDate) {
        const error = new Error('No se pudo validar la fecha limite de anulacion para este contrato.');
        error.statusCode = 409;
        throw error;
      }

      const linkedDeliveries = (state.deliveries ?? []).filter((delivery) => (
        !delivery?.deletedAt
        && (delivery.rentalId === rental.id || delivery.orderCode === rental.orderCode)
      ));
      const deliveryHasExecutionEvidence = (delivery) => {
        const status = normalize(delivery?.status);
        return Boolean(
          Number(delivery?.progress ?? 0) > 0
          || delivery?.startedAt
          || delivery?.completedAt
          || delivery?.deliveredAt
          || ['en_ruta', 'en camino', 'en_camino', 'entregado', 'completado', 'completed'].includes(status)
        );
      };
      const deliveriesShowExecution = linkedDeliveries.some(deliveryHasExecutionEvidence);
      const deliveriesShowNoExecution = linkedDeliveries.length > 0
        && linkedDeliveries.every((delivery) => !deliveryHasExecutionEvidence(delivery));

      const operational = rental.operational ?? {};
      const inventoryStatus = normalize(operational.inventoryStatus);
      const transportStatus = normalize(operational.transportStatus);
      const dispatchReview = operational.dispatchReview ?? {};
      const returnReview = operational.returnReview ?? {};
      const hasReturnEvidence = Boolean(
        rental.returnedAt
        || operational.inventoryReturnedAt
        || operational.inventoryReturnedByName
        || returnReview.reviewedAt
        || returnReview.reviewedByName
        || (Array.isArray(rental.returnReport) && rental.returnReport.length > 0)
      );
      const hasExplicitInventoryDispatch = Boolean(
        operational.inventoryDispatchedAt
        || operational.inventoryDispatchedByName
        || operational.inventoryDispatchedByRole
        || dispatchReview.reviewedAt
        || dispatchReview.reviewedByName
        || dispatchReview.reviewedByRole
        || ['salio', 'enviado', 'en_ruta', 'entregado', 'devuelto'].includes(inventoryStatus)
      );
      const hasExplicitTransportDispatch = Boolean(
        operational.transportSentAt
        || operational.transportConfirmedAt
        || operational.transportConfirmedByName
        || ['salio', 'enviado', 'en_ruta', 'entregado', 'devuelto'].includes(transportStatus)
      );

      // "confirmado" / inventoryConfirmedAt significa material listo o verificado,
      // no que haya salido físicamente. Algunos contratos históricos también
      // guardaron inventorySentAt al confirmar inventario; ese dato aislado no
      // debe bloquear una anulación administrativa.
      const hasOperationalDispatchEvidence = Boolean(
        deliveriesShowExecution
        || hasExplicitInventoryDispatch
        || hasExplicitTransportDispatch
      );
      const wasOperationallySent = hasReturnEvidence
        || (
          hasOperationalDispatchEvidence
          && !deliveriesShowNoExecution
        );

      const movementMatches = (movement) => {
        const values = [
          movement?.sourceId, movement?.linkedRentalId, movement?.linkedContractId,
          movement?.linkedOrderCode, movement?.contractCode, movement?.orderCode, movement?.reference,
        ].map((value) => String(value ?? '').trim()).filter(Boolean);
        return values.includes(String(rental.id))
          || values.includes(String(rental.orderCode ?? ''))
          || (contract && (values.includes(String(contract.id)) || values.includes(String(contract.contractCode ?? ''))));
      };
      const isVoided = (movement) => Boolean(
        movement?.voidedAt || movement?.voidedBy
        || ['anulado', 'voided'].includes(normalize(movement?.status))
      );
      const positiveCashCollectedBs = (state.cashMovements ?? [])
        .filter((movement) => movementMatches(movement) && !isVoided(movement))
        .reduce((total, movement) => {
          const amount = Number(movement?.amountBs ?? movement?.amount ?? 0);
          const type = normalize(movement?.type);
          const tag = normalize(movement?.accountingTag);
          const category = normalize(movement?.category);
          const isIncome = amount > 0 && (
            type.includes('ingreso') || type.includes('cobro')
            || tag.includes('payment') || tag.includes('collection') || tag.includes('guarantee')
            || category.includes('adelanto') || category.includes('cobro') || category.includes('garantia')
          );
          return total + (isIncome ? amount : 0);
        }, 0);
      const recordedCollectedBs = Math.max(
        Number(rental?.payment?.paidAtRentalBs ?? 0),
        Number(rental?.totals?.paidAtRentalBs ?? 0),
        Number(rental?.payment?.cashCollectedBs ?? 0),
        Number(rental?.payment?.rentalCollectedBs ?? 0),
        Number(rental?.payment?.deliveryFeeCollectedBs ?? 0),
        Number(contract?.payment?.paidAtApprovalBs ?? 0),
        positiveCashCollectedBs,
        0,
      );
      const guaranteeWasCollected = ['pagada', 'pagado', 'validada', 'validado', 'retenida', 'retenido']
        .includes(normalize(rental?.payment?.guaranteeStatus ?? contract?.guarantee?.status));
      const isWithinCancellationWindow = Boolean(todayKey && toDayKey(cutoffDate) && todayKey <= toDayKey(cutoffDate));
      const canCancelUnfulfilledAfterCutoff = !wasOperationallySent
        && recordedCollectedBs <= 0.009
        && !guaranteeWasCollected;
      if (!isWithinCancellationWindow && !canCancelUnfulfilledAfterCutoff) {
        const error = new Error(
          `El plazo de anulacion vencio el ${toDayKey(cutoffDate)}. `
          + 'Solo puede anularse despues de esa fecha cuando la orden nunca salio, no fue entregada y no registra cobros.',
        );
        error.statusCode = 409;
        throw error;
      }

      const totalBs = Number(contract?.totals?.totalBs ?? rental?.totals?.totalBs ?? 0);
      const configuredPenaltyPercent = Math.max(0, Number(state.settings?.contractCancellationPenaltyPercent ?? 20));
      const penaltyPercent = isWithinCancellationWindow ? configuredPenaltyPercent : 0;
      const penaltyBs = Number((totalBs * (penaltyPercent / 100)).toFixed(2));
      const userId = req.body?.userId ?? req.body?.createdById ?? null;
      const userName = String(req.body?.userName ?? req.body?.createdByName ?? req.body?.createdBy ?? 'Sistema').trim() || 'Sistema';
      const userRole = String(req.body?.userRole ?? req.body?.createdByRole ?? 'Operacion').trim() || 'Operacion';

      state.inventoryMovements = Array.isArray(state.inventoryMovements) ? state.inventoryMovements : [];
      (rental.items ?? []).forEach((line) => {
        const item = (state.items ?? []).find((entry) => entry.id === line.itemId);
        if (!item || line?.controlsStock === false) return;
        const reservedQty = Number.isFinite(Number(line?.internalReservedQty))
          ? Math.max(0, Math.trunc(Number(line.internalReservedQty)))
          : Math.max(0, Math.trunc(Number(line?.quantity ?? 0) - Number(line?.supplierBackedQty ?? 0)));
        if (reservedQty <= 0) return;
        const beforeTotalStock = Number(item.totalStock ?? 0);
        const beforeAvailableStock = Number(item.availableStock ?? 0);
        item.availableStock = Math.min(beforeTotalStock, beforeAvailableStock + reservedQty);
        item.updatedAt = now;
        state.inventoryMovements.push({
          id: directId('mov'), itemId: item.id, itemName: item.name, category: item.category,
          type: 'reinsercion', reason: `Anulacion de contrato ${contract?.contractCode ?? rental.orderCode}`,
          detail: `Reintegro de ${reservedQty} unidades por anulacion de ${rental.orderCode}`,
          reference: rental.orderCode, deltaUnits: reservedQty,
          beforeTotalStock, afterTotalStock: beforeTotalStock,
          beforeAvailableStock, afterAvailableStock: item.availableStock,
          reservedStockAfter: beforeTotalStock - item.availableStock,
          userName, userRole, createdAt: now, status: 'cancelado',
        });
      });

      linkedDeliveries.forEach((delivery) => {
        delivery.status = 'cancelada';
        delivery.progress = 0;
        delivery.cancelledAt = now;
        delivery.updatedAt = now;
        if (!String(delivery.notes ?? '').includes('[ANULADO]')) {
          delivery.notes = `${String(delivery.notes ?? '').trim()} [ANULADO]`.trim();
        }
      });

      const changedSupplierLoans = [];
      (state.supplierLoans ?? []).forEach((loan) => {
        if (loan?.deletedAt) return;
        const linked = loan.rentalId === rental.id
          || loan.orderCode === rental.orderCode
          || (contract && (loan.contractId === contract.id || loan.contractCode === contract.contractCode));
        if (!linked) return;
        const status = normalize(loan.status);
        if (['devuelto', 'returned', 'cancelado', 'cancelled', 'anulado'].includes(status)) return;
        loan.status = 'cancelado';
        loan.cancelledAt = now;
        loan.cancellationReason = reason;
        loan.updatedAt = now;
        changedSupplierLoans.push(structuredClone(loan));
      });

      rental.status = 'cancelled';
      rental.cancelledAt = now;
      rental.cancellationPenaltyPercent = penaltyPercent;
      rental.cancellationPenaltyBs = penaltyBs;
      rental.cancellationReason = reason;
      rental.cancellationCutoffDate = toDayKey(cutoffDate);
      rental.penaltiesBs = Number((Number(rental.penaltiesBs ?? 0) + penaltyBs).toFixed(2));
      rental.operational = {
        ...operational,
        inventoryStatus: 'anulado', transportStatus: 'anulado',
        inventoryNote: reason, transportNote: reason,
        administrativeCancellation: true,
        administrativeCancellationReason: deliveriesShowNoExecution && hasOperationalDispatchEvidence
          ? 'Marcas operativas inconsistentes con entregas programadas al 0%.'
          : '',
        cancelledAt: now, cancelledByName: userName, cancelledByRole: userRole,
      };
      rental.updatedAt = now;

      if (contract) {
        contract.status = 'anulado';
        contract.cancelledAt = now;
        contract.cancellationPenaltyPercent = penaltyPercent;
        contract.cancellationPenaltyBs = penaltyBs;
        contract.cancellationReason = reason;
        contract.cancellationCutoffDate = toDayKey(cutoffDate);
        contract.updatedAt = now;
        contract.revisionHistory = Array.isArray(contract.revisionHistory) ? contract.revisionHistory : [];
        contract.revisionHistory.unshift({
          id: directId('rev'), type: 'cancelled', createdAt: now,
          createdById: userId, createdByName: userName, createdByRole: userRole,
          notes: [
            `Contrato anulado por ${userName}`, `Motivo: ${reason}`,
            `Items liberados de inventario para ${rental.orderCode}`,
            'Numero de contrato conservado.',
          ],
        });
      }

      state.systemAuditLog = Array.isArray(state.systemAuditLog) ? state.systemAuditLog : [];
      state.systemAuditLog.unshift({
        id: directId('audit'), type: 'contract_cancelled', action: 'anular_contrato',
        entityType: 'contract', entityId: contract?.id ?? rental.id,
        entityCode: contract?.contractCode ?? rental.orderCode,
        detail: `Anulacion administrativa. Motivo: ${reason}. Entregas anuladas: ${linkedDeliveries.length}. Subalquileres anulados: ${changedSupplierLoans.length}.`,
        userId, userName, userRole, createdAt: now,
      });

      responseData = {
        contract: contract ? structuredClone(contract) : null,
        rental: structuredClone(rental),
        deliveries: structuredClone(linkedDeliveries),
        supplierLoans: changedSupplierLoans,
        cancellation: {
          administrative: !isWithinCancellationWindow,
          reconciledStaleOperationalMarks: deliveriesShowNoExecution && hasOperationalDispatchEvidence,
          penaltyBs,
        },
      };
      return state;
    });

    if (!result.initialized) {
      res.status(404).json({ error: 'La base de datos aun no esta inicializada.' });
      return;
    }
    res.set('Cache-Control', 'private, no-store');
    res.json({ ok: true, ...responseData, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
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

router.post('/__copetin_db/suppliers/create', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {};
    const name = directBusinessText(payload.name);
    if (!name) {
      res.status(400).json({ error: 'El nombre del proveedor es obligatorio.' });
      return;
    }

    let createdSupplier = null;
    const result = await updateStateSnapshot((state) => {
      state.suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];

      const duplicate = state.suppliers.find((supplier) => (
        !supplier?.deletedAt
        && directNormalizeText(supplier?.name).trim() === directNormalizeText(name).trim()
      ));
      if (duplicate) {
        const error = new Error('Ya existe un proveedor con ese nombre.');
        error.statusCode = 409;
        throw error;
      }

      createdSupplier = buildDirectSupplier({ ...payload, name });
      state.suppliers.push(createdSupplier);
      return state;
    });

    res.json({
      ok: true,
      supplier: createdSupplier,
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

router.patch('/__copetin_db/rentals/:id/operational', async (req, res, next) => {
  try {
    const rentalId = String(req.params.id ?? '').trim();
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (!rentalId) return res.status(400).json({ error: 'No se pudo identificar la orden de servicio.' });

    let responseRental = null;
    const result = await updateStateSnapshot((state) => {
      state.rentals = Array.isArray(state.rentals) ? state.rentals : [];
      const rental = state.rentals.find((entry) => String(entry?.id ?? '') === rentalId && !entry?.deletedAt);
      if (!rental) { const error = new Error('Orden de servicio no encontrada.'); error.statusCode = 404; throw error; }
      if (rental.status === 'cancelled') { const error = new Error('La orden esta anulada y ya no admite cambios operativos.'); error.statusCode = 409; throw error; }

      const now = new Date().toISOString();
      const userName = String(payload?.userName ?? payload?.createdByName ?? payload?.createdBy ?? '').trim() || 'Sistema';
      const userRole = String(payload?.userRole ?? payload?.createdByRole ?? '').trim() || 'Operacion';
      rental.operational = {
        inventoryStatus: rental.operational?.inventoryStatus ?? 'pendiente',
        transportStatus: rental.operational?.transportStatus ?? 'pendiente',
        inventoryNote: rental.operational?.inventoryNote ?? '',
        transportNote: rental.operational?.transportNote ?? '',
        inventorySentAt: rental.operational?.inventorySentAt ?? null,
        inventoryDispatchedAt: rental.operational?.inventoryDispatchedAt ?? null,
        inventoryDispatchedByName: rental.operational?.inventoryDispatchedByName ?? null,
        inventoryDispatchedByRole: rental.operational?.inventoryDispatchedByRole ?? null,
        transportSentAt: rental.operational?.transportSentAt ?? null,
        inventoryConfirmedAt: rental.operational?.inventoryConfirmedAt ?? null,
        transportConfirmedAt: rental.operational?.transportConfirmedAt ?? null,
        inventoryConfirmedByName: rental.operational?.inventoryConfirmedByName ?? null,
        inventoryConfirmedByRole: rental.operational?.inventoryConfirmedByRole ?? null,
        inventoryReturnedAt: rental.operational?.inventoryReturnedAt ?? null,
        inventoryReturnedByName: rental.operational?.inventoryReturnedByName ?? null,
        inventoryReturnedByRole: rental.operational?.inventoryReturnedByRole ?? null,
        transportConfirmedByName: rental.operational?.transportConfirmedByName ?? null,
        transportConfirmedByRole: rental.operational?.transportConfirmedByRole ?? null,
        dispatchReview: rental.operational?.dispatchReview ?? null,
        returnReview: rental.operational?.returnReview ?? null,
        revisionAlert: rental.operational?.revisionAlert ?? null,
        clientPendingPickup: rental.operational?.clientPendingPickup ?? null,
      };

      if (payload.inventoryStatus !== undefined) {
        const previousStatus = String(rental.operational.inventoryStatus ?? 'pendiente').trim() || 'pendiente';
        const nextStatus = String(payload.inventoryStatus ?? 'pendiente').trim() || 'pendiente';

        if (nextStatus === 'salio' && previousStatus !== 'confirmado' && !rental.operational.inventoryConfirmedAt) {
          const error = new Error('Primero debes marcar la orden como lista antes de registrar su salida.');
          error.statusCode = 409;
          throw error;
        }

        // Retroceder desde una devolución (total o parcial) debe deshacer TODA la
        // recepción: stock reinsertado, bajas por daño/faltante y marcas de
        // "pendiente con cliente". Así la orden queda realmente en el paso elegido.
        if (nextStatus !== 'devuelto') {
          clearDirectReturnState(state, rental);
        }

        rental.operational.inventoryStatus = nextStatus;

        if (nextStatus === 'pendiente') {
          rental.operational.inventorySentAt = null;
          rental.operational.inventoryConfirmedAt = null;
          rental.operational.inventoryConfirmedByName = null;
          rental.operational.inventoryConfirmedByRole = null;
          rental.operational.inventoryDispatchedAt = null;
          rental.operational.inventoryDispatchedByName = null;
          rental.operational.inventoryDispatchedByRole = null;
          rental.operational.dispatchReview = null;
        }

        if (nextStatus === 'enviado') {
          rental.operational.inventorySentAt = rental.operational.inventorySentAt ?? now;
          rental.operational.inventoryConfirmedAt = null;
          rental.operational.inventoryConfirmedByName = null;
          rental.operational.inventoryConfirmedByRole = null;
          rental.operational.inventoryDispatchedAt = null;
          rental.operational.inventoryDispatchedByName = null;
          rental.operational.inventoryDispatchedByRole = null;
          rental.operational.dispatchReview = null;
        }

        if (nextStatus === 'confirmado') {
          rental.operational.inventoryConfirmedAt = now;
          rental.operational.inventorySentAt = rental.operational.inventorySentAt ?? now;
          rental.operational.inventoryConfirmedByName = userName;
          rental.operational.inventoryConfirmedByRole = userRole;
          rental.operational.inventoryDispatchedAt = null;
          rental.operational.inventoryDispatchedByName = null;
          rental.operational.inventoryDispatchedByRole = null;
        }

        if (nextStatus === 'salio') {
          rental.operational.inventoryDispatchedAt = now;
          rental.operational.inventoryDispatchedByName = userName;
          rental.operational.inventoryDispatchedByRole = userRole;
        }
      }
      if (payload.transportStatus !== undefined) {
        const nextStatus = String(payload.transportStatus ?? 'pendiente').trim() || 'pendiente';
        rental.operational.transportStatus = nextStatus;
        if (nextStatus === 'enviado' && !rental.operational.transportSentAt) rental.operational.transportSentAt = now;
        if (nextStatus === 'confirmado') {
          rental.operational.transportConfirmedAt = now;
          rental.operational.transportSentAt = rental.operational.transportSentAt ?? now;
          rental.operational.transportConfirmedByName = userName;
          rental.operational.transportConfirmedByRole = userRole;
        }
      }
      if (payload.inventoryNote !== undefined) rental.operational.inventoryNote = String(payload.inventoryNote ?? '').trim();
      if (payload.transportNote !== undefined) rental.operational.transportNote = String(payload.transportNote ?? '').trim();
      if (payload.dispatchReview !== undefined) {
        rental.operational.dispatchReview = {
          status: String(payload.dispatchReview?.status ?? 'complete').trim() || 'complete',
          note: String(payload.dispatchReview?.note ?? '').trim(),
          items: (Array.isArray(payload.dispatchReview?.items) ? payload.dispatchReview.items : []).map((line) => ({
            lineKey: String(line?.lineKey ?? '').trim(), itemId: String(line?.itemId ?? '').trim(),
            itemName: String(line?.itemName ?? '').trim(), expectedQty: Math.max(0, Math.trunc(Number(line?.expectedQty ?? 0))),
            dispatchedQty: Math.max(0, Math.trunc(Number(line?.dispatchedQty ?? 0))),
            pendingQty: Math.max(0, Math.trunc(Number(line?.pendingQty ?? 0))), note: String(line?.note ?? '').trim(),
          })),
          reviewedAt: now, reviewedByName: userName, reviewedByRole: userRole,
        };
      }
      if (payload.returnReview !== undefined) {
        rental.operational.returnReview = {
          status: String(payload.returnReview?.status ?? 'complete').trim() || 'complete',
          note: String(payload.returnReview?.note ?? '').trim(), reviewedAt: now,
          reviewedByName: userName, reviewedByRole: userRole,
        };
      }
      if (payload.clientPendingPickup !== undefined) {
        const active = Boolean(payload.clientPendingPickup?.active);
        rental.operational.clientPendingPickup = active ? {
          active: true,
          note: String(payload.clientPendingPickup?.note ?? '').trim(),
          items: (Array.isArray(payload.clientPendingPickup?.items) ? payload.clientPendingPickup.items : []).map((line) => ({
            lineKey: String(line?.lineKey ?? '').trim(), itemId: String(line?.itemId ?? '').trim(),
            itemName: String(line?.itemName ?? '').trim(), expectedQty: Math.max(0, Math.trunc(Number(line?.expectedQty ?? 0))),
            pendingQty: Math.max(0, Math.trunc(Number(line?.pendingQty ?? 0))), note: String(line?.note ?? '').trim(),
          })).filter((line) => line.pendingQty > 0),
          registeredAt: now, registeredByName: userName, registeredByRole: userRole,
        } : null;
      }
      if (payload.revisionAlert !== undefined) rental.operational.revisionAlert = payload.revisionAlert ?? null;
      if (payload.clearOperationalRevisionAlert && rental.operational.revisionAlert) {
        rental.operational.revisionAlert = {
          ...rental.operational.revisionAlert, active: false, resolvedAt: now,
          resolvedByName: userName, resolvedByRole: userRole,
        };
      }
      rental.updatedAt = now;
      responseRental = summarizeInventoryRental(rental);
      return state;
    });

    res.json({ ok: true, rental: responseRental, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});

router.post('/__copetin_db/rentals/register-return', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const rentalId = String(payload.rentalId ?? '').trim();
    const lines = Array.isArray(payload.returnedItems) ? payload.returnedItems : [];
    const isPartialReturn = Boolean(payload.partialReturn)
      || String(payload?.returnReview?.status ?? '').trim() === 'left_with_client'
      || lines.some((line) => Math.max(0, Math.trunc(Number(line?.pendingClientQty ?? 0))) > 0);

    if (!rentalId) return res.status(400).json({ error: 'Debe seleccionar un alquiler para registrar la devolucion.' });
    if (!lines.length) return res.status(400).json({ error: 'Debe enviar el detalle de devolucion por item.' });

    let responseData = null;
    const result = await updateStateSnapshot((state) => {
      state.items = Array.isArray(state.items) ? state.items : [];
      state.rentals = Array.isArray(state.rentals) ? state.rentals : [];
      state.deliveries = Array.isArray(state.deliveries) ? state.deliveries : [];
      state.stockRecoveries = Array.isArray(state.stockRecoveries) ? state.stockRecoveries : [];
      state.inventoryMovements = Array.isArray(state.inventoryMovements) ? state.inventoryMovements : [];
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
      const changedItems = new Map();
      const lossMovements = [];
      previousPartialItems.forEach((line) => {
        const chargeOwner = normalizeReturnChargeOwner(line?.chargeOwner);
        const damagedQty = Math.max(0, Math.trunc(Number(line?.damagedQty ?? 0)));
        const damagedUnitChargeBs = Math.max(0, Number(line?.damagedUnitChargeBs ?? 0));
        const damagedFeeBs = directMoney(damagedQty * damagedUnitChargeBs);
        const legacyPending = !Object.prototype.hasOwnProperty.call(line ?? {}, 'pendingClientQty')
          && Boolean(rental.operational?.clientPendingPickup?.active);
        const missingQty = legacyPending ? 0 : Math.max(0, Math.trunc(Number(line?.missingQty ?? 0)));
        const missingUnitChargeBs = Math.max(0, Number(line?.missingUnitChargeBs ?? 0));
        const missingFeeBs = directMoney(missingQty * missingUnitChargeBs);
        const previousFeeBs = directMoney(damagedFeeBs + missingFeeBs);
        if (chargeOwner === 'cliente') penaltiesBs = directMoney(penaltiesBs + previousFeeBs);
        else internalPenaltiesBs = directMoney(internalPenaltiesBs + previousFeeBs);
      });
      const isLegacyClientPendingLine = (entry) => (
        !Object.prototype.hasOwnProperty.call(entry ?? {}, 'pendingClientQty')
        && Boolean(rental.operational?.clientPendingPickup?.active)
      );
      const getConfirmedMissingQty = (entry) => (
        isLegacyClientPendingLine(entry)
          ? 0
          : Math.max(0, Math.trunc(Number(entry?.missingQty ?? 0)))
      );
      const getPreviouslyProcessedQty = (rentalLine, rentalLineKey) => previousPartialItems
        .filter((entry) => (
          String(entry?.lineKey ?? '') === String(rentalLineKey)
          || (!entry?.lineKey && String(entry?.itemId ?? '') === String(rentalLine.itemId ?? ''))
        ))
        .reduce((sum, entry) => sum
          + Math.max(0, Math.trunc(Number(entry?.returnedQty ?? 0)))
          + Math.max(0, Math.trunc(Number(entry?.damagedQty ?? 0)))
          + getConfirmedMissingQty(entry), 0);

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
        const pendingClientQty = Math.max(0, directInteger(incomingLine.pendingClientQty ?? 0, `con cliente (${rentalLine.itemName})`));
        const chargeOwner = normalizeReturnChargeOwner(incomingLine.chargeOwner);
        const damageNote = String(incomingLine.damageNote ?? '').trim();
        const originalExpectedQty = Math.max(0, Math.trunc(Number(rentalLine.quantity ?? 0)));
        const previousProcessedQty = getPreviouslyProcessedQty(rentalLine, rentalLineKey);
        const expectedQty = Math.max(0, originalExpectedQty - previousProcessedQty);
        if (returnedQty + damagedQty + missingQty + pendingClientQty !== expectedQty) {
          const error = new Error(`La suma de devuelto + daniado + faltante + con cliente para "${rentalLine.itemName}" debe ser ${expectedQty}.`);
          error.statusCode = 400;
          throw error;
        }
        if ((damagedQty > 0 || missingQty > 0 || pendingClientQty > 0) && !damageNote) {
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
        let damagedStockLossQty = 0;
        let missingStockLossQty = 0;
        let stockLossQty = 0;
        if (item) {
          internalExpectedQty = Math.max(0, Math.min(expectedQty, Math.trunc(Number(rentalLine.internalReservedQty ?? expectedQty))));
          const internalDamagedQty = Math.min(damagedQty, internalExpectedQty);
          const internalMissingQty = Math.min(missingQty, Math.max(0, internalExpectedQty - internalDamagedQty));
          const internalGoodQty = Math.min(returnedQty, Math.max(0, internalExpectedQty - internalDamagedQty - internalMissingQty));

          // Antes de aplicar la devolución, reconstruimos el disponible desde el
          // stock físico y los compromisos activos. Esto evita que saldos históricos
          // inflados (availableStock > totalStock) bloqueen una devolución válida.
          directNormalizeAvailableStockForItem(state, item);

          // Nuevo flujo: todo lo que vuelve bien se reinserta inmediatamente.
          // Ya no existe una segunda etapa de lavado/reparacion.
          returnedToAvailableQty = internalGoodQty;
          item.availableStock = Number(item.availableStock ?? 0) + returnedToAvailableQty;

          // Dañado es baja física al confirmarse. Faltante solo es baja definitiva
          // cuando se cierra la devolución; en una devolución parcial sigue con cliente.
          damagedStockLossQty = internalDamagedQty;
          missingStockLossQty = internalMissingQty;
          stockLossQty = damagedStockLossQty + missingStockLossQty;
          if (stockLossQty > 0) {
            const beforeTotalStock = Number(item.totalStock ?? 0);
            const beforeAvailableStock = Number(item.availableStock ?? 0);
            const nextTotalStock = beforeTotalStock - stockLossQty;
            if (nextTotalStock < beforeAvailableStock) {
              const error = new Error(`El stock de "${item.name}" quedaria por debajo de sus unidades disponibles.`);
              error.statusCode = 409;
              throw error;
            }
            item.totalStock = nextTotalStock;

            const pushLossMovement = (kind, qty, unitValueBs, totalValueBs) => {
              if (qty <= 0) return;
              const previousTotal = kind === 'faltante' ? beforeTotalStock - damagedStockLossQty : beforeTotalStock;
              const nextTotal = previousTotal - qty;
              const movement = {
                id: directId('mov'),
                itemId: item.id,
                itemName: item.name,
                category: item.category,
                type: 'salida',
                reason: `${kind === 'danado' ? 'Daño' : 'Faltante'} en devolución · Contrato ${rental.contractCode || rental.orderCode || rental.id}`,
                detail: `${qty} unidad(es) · ${rental.customerName || 'Cliente'}${damageNote ? ` · ${damageNote}` : ''}`,
                reference: rental.orderCode ?? rental.contractCode ?? rental.id,
                deltaUnits: -qty,
                beforeTotalStock: previousTotal,
                afterTotalStock: nextTotal,
                beforeAvailableStock,
                afterAvailableStock: Number(item.availableStock ?? 0),
                reservedStockAfter: Math.max(0, nextTotal - Number(item.availableStock ?? 0)),
                sourceType: 'rental_return_loss',
                sourceRentalId: rental.id,
                sourceId: rental.id,
                sourceContractId: rental.contractId ?? null,
                contractCode: rental.contractCode ?? '',
                orderCode: rental.orderCode ?? '',
                customerName: rental.customerName ?? '',
                lossType: kind,
                unitValueBs: directMoney(unitValueBs),
                lossValueBs: directMoney(totalValueBs),
                note: damageNote,
                userName: String(payload?.userName ?? payload?.createdByName ?? 'Inventario').trim() || 'Inventario',
                userRole: String(payload?.userRole ?? payload?.createdByRole ?? 'Inventario').trim() || 'Inventario',
                createdAt: now,
              };
              state.inventoryMovements.unshift(movement);
              lossMovements.push(structuredClone(movement));
            };
            pushLossMovement('danado', damagedStockLossQty, damagedUnitChargeBs, damagedFeeBs);
            pushLossMovement('faltante', missingStockLossQty, missingUnitChargeBs, missingFeeBs);
          }
          item.updatedAt = now;
          changedItems.set(String(item.id), structuredClone(item));
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
          damagedStockLossQty,
          missingStockLossQty,
          stockLossQty,
          damagedQty,
          missingQty,
          pendingClientQty,
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
          .filter((line) => Math.max(0, Math.trunc(Number(line.pendingClientQty ?? 0))) > 0)
          .map((line) => ({
            lineKey: line.lineKey,
            itemId: line.itemId,
            itemName: line.itemName,
            expectedQty: line.expectedQty,
            pendingQty: Math.max(0, Math.trunc(Number(line.pendingClientQty ?? 0))),
            note: String(line.damageNote ?? '').trim(),
          }));
        if (!pendingItems.length) { const error = new Error('Para registrar material con cliente debe existir al menos una cantidad pendiente.'); error.statusCode = 400; throw error; }
        const partialRegisteredLines = returnReport.filter((line) => (
          Math.max(0, Math.trunc(Number(line.returnedQty ?? 0))) > 0
          || Math.max(0, Math.trunc(Number(line.damagedQty ?? 0))) > 0
          || Math.max(0, Math.trunc(Number(line.missingQty ?? 0))) > 0
          || Math.max(0, Math.trunc(Number(line.pendingClientQty ?? 0))) > 0
        )).map((line) => ({ ...line, partialRegisteredAt: now }));
        rental.partialReturnReport = {
          updatedAt: now,
          updatedByName: String(payload?.userName ?? payload?.createdByName ?? 'Inventario').trim() || 'Inventario',
          items: [...previousPartialItems, ...partialRegisteredLines],
        };
        const confirmedPartialLines = partialRegisteredLines.filter((line) => (
          Math.max(0, Math.trunc(Number(line.returnedQty ?? 0))) > 0
          || Math.max(0, Math.trunc(Number(line.damagedQty ?? 0))) > 0
          || Math.max(0, Math.trunc(Number(line.missingQty ?? 0))) > 0
        ));
        rental.returnReport = [
          ...(Array.isArray(rental.returnReport) ? rental.returnReport : []),
          ...confirmedPartialLines,
        ];
        rental.penaltiesBs = penaltiesBs;
        rental.internalPenaltiesBs = internalPenaltiesBs;
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
        responseData = { rental: summarizeInventoryRental(rental), items: [...changedItems.values()], movements: lossMovements };
        return state;
      }

      const linkedContract = state.contracts.find((contract) => (
        String(contract?.id ?? '') === String(rental?.contractId ?? '')
        || String(contract?.rentalId ?? '') === String(rental.id)
        || (rental?.orderCode && String(contract?.orderCode ?? '') === String(rental.orderCode))
      )) ?? null;
      const totalBs = getRentalChargeTargetBs(linkedContract, rental);
      const alreadyPaidBs = directMoney(Math.max(
        Number(
          rental?.payment?.paidAtRentalBs
          ?? rental?.totals?.paidAtRentalBs
          ?? linkedContract?.payment?.paidAtApprovalBs
          ?? totalBs,
        ),
        Number(linkedContract?.payment?.paidAtApprovalBs ?? 0),
      ));
      const outstandingRentalBs = directMoney(Math.max(0, totalBs - alreadyPaidBs));
      const totalDiscountAgainstDepositBs = directMoney(penaltiesBs + outstandingRentalBs);
      const depositBs = directMoney(rental.depositBs);
      const refundBs = directMoney(Math.max(0, depositBs - totalDiscountAgainstDepositBs));
      const pendingCollectionBs = directMoney(Math.max(0, totalDiscountAgainstDepositBs - depositBs));
      const discountCoveredByDepositBs = directMoney(Math.min(depositBs, totalDiscountAgainstDepositBs));

      rental.status = 'returned';
      rental.returnedAt = now;
      const existingReturnReport = Array.isArray(rental.returnReport) ? rental.returnReport : [];
      const existingFingerprints = new Set(existingReturnReport.map((line) => [
        String(line?.lineKey ?? ''),
        Number(line?.returnedQty ?? 0),
        Number(line?.damagedQty ?? 0),
        Number(line?.missingQty ?? 0),
        String(line?.partialRegisteredAt ?? ''),
      ].join('|')));
      const legacyConfirmedPartialLines = previousPartialItems.map((line) => {
        const legacyPending = !Object.prototype.hasOwnProperty.call(line ?? {}, 'pendingClientQty')
          && Boolean(rental.operational?.clientPendingPickup?.active);
        return {
          ...line,
          missingQty: legacyPending ? 0 : Math.max(0, Math.trunc(Number(line?.missingQty ?? 0))),
          pendingClientQty: legacyPending
            ? Math.max(0, Math.trunc(Number(line?.missingQty ?? 0)))
            : Math.max(0, Math.trunc(Number(line?.pendingClientQty ?? 0))),
        };
      }).filter((line) => (
        Math.max(0, Math.trunc(Number(line?.returnedQty ?? 0))) > 0
        || Math.max(0, Math.trunc(Number(line?.damagedQty ?? 0))) > 0
        || Math.max(0, Math.trunc(Number(line?.missingQty ?? 0))) > 0
      )).filter((line) => !existingFingerprints.has([
        String(line?.lineKey ?? ''),
        Number(line?.returnedQty ?? 0),
        Number(line?.damagedQty ?? 0),
        Number(line?.missingQty ?? 0),
        String(line?.partialRegisteredAt ?? ''),
      ].join('|')));
      rental.returnReport = [...existingReturnReport, ...legacyConfirmedPartialLines, ...returnReport];
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
      responseData = { rental: summarizeInventoryRental(rental), items: [...changedItems.values()], movements: lossMovements };
      return state;
    });

    res.json({ ok: true, ...responseData, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});


const isReturnChargeLineSettled = (line = {}) => {
  const penaltyBs = directMoney(
    line?.penaltyBs
    ?? (directMoney(line?.damagedFeeBs) + directMoney(line?.missingFeeBs)),
  );
  const appliedBs = Math.max(
    directMoney(line?.chargedBs),
    directMoney(line?.paidBs),
    directMoney(line?.collectedBs),
    directMoney(line?.appliedToGuaranteeBs),
    directMoney(line?.guaranteeAppliedBs),
  );
  const statuses = [
    line?.chargeStatus,
    line?.paymentStatus,
    line?.accountingStatus,
  ].map((value) => String(value ?? '').trim().toLowerCase());

  return Boolean(
    line?.isPaid
    || line?.isCollected
    || line?.paidAt
    || line?.collectedAt
    || line?.settledAt
    || line?.cashMovementId
    || line?.receiptCode
    || (penaltyBs > 0 && appliedBs + 0.009 >= penaltyBs)
    || statuses.some((status) => [
      'paid',
      'pagado',
      'collected',
      'cobrado',
      'settled',
      'liquidado',
      'cancelado',
      'cancelled',
      'aplicado_garantia',
      'cubierto_garantia',
    ].includes(status))
  );
};

const findReturnChargeLineIndex = (report, payload = {}) => {
  const lineKey = String(payload?.lineKey ?? '').trim();
  const itemId = String(payload?.itemId ?? '').trim();
  const reportIndex = Number.isInteger(Number(payload?.reportIndex))
    ? Number(payload.reportIndex)
    : null;

  if (lineKey) {
    const matches = report
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => String(line?.lineKey ?? '').trim() === lineKey);
    if (matches.length === 1) return matches[0].index;
    if (matches.length > 1) {
      const error = new Error('La línea de devolución no es única. Vuelve a abrir el económico antes de editar.');
      error.statusCode = 409;
      throw error;
    }
  }

  if (reportIndex != null && reportIndex >= 0 && reportIndex < report.length) {
    const line = report[reportIndex];
    if (!itemId || String(line?.itemId ?? '').trim() === itemId) return reportIndex;
  }

  if (itemId) {
    const matches = report
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => String(line?.itemId ?? '').trim() === itemId);
    if (matches.length === 1) return matches[0].index;
    if (matches.length > 1) {
      const error = new Error('Hay más de una línea del mismo producto. Vuelve a abrir el económico para identificar la línea correcta.');
      error.statusCode = 409;
      throw error;
    }
  }

  return -1;
};

const updateAutomaticReturnMovementDescriptions = (state, rental) => {
  const settlement = rental?.returnSettlement ?? {};
  const customerName = String(rental?.customerName ?? 'Cliente');
  const penaltiesBs = directMoney(settlement?.penaltiesBs ?? rental?.penaltiesBs);
  const internalPenaltiesBs = directMoney(settlement?.internalPenaltiesBs ?? rental?.internalPenaltiesBs);
  const outstandingRentalBs = directMoney(settlement?.outstandingRentalBs);
  const pendingCollectionBs = directMoney(settlement?.pendingCollectionBs);
  const refundBs = directMoney(settlement?.refundBs ?? rental?.refundBs);

  (Array.isArray(state.cashMovements) ? state.cashMovements : []).forEach((movement) => {
    if (String(movement?.sourceId ?? '') !== String(rental?.id ?? '')) return;
    if (Number(movement?.amountBs ?? 0) !== 0) return;

    if (movement?.type === 'liquidacion_devolucion') {
      movement.description = `Liquidacion devolucion (${customerName}) | Penalidad cliente: Bs ${penaltiesBs.toFixed(2)} | Perdida interna: Bs ${internalPenaltiesBs.toFixed(2)} | Saldo alquiler: Bs ${outstandingRentalBs.toFixed(2)} | Reembolso: Bs ${refundBs.toFixed(2)}`;
    } else if (movement?.type === 'saldo_pendiente_cobro') {
      movement.description = `Saldo pendiente por cobrar (${customerName}): Bs ${pendingCollectionBs.toFixed(2)}`;
    } else if (movement?.type === 'perdida_interna_devolucion') {
      movement.description = `Perdida interna por devolucion (${customerName}): Bs ${internalPenaltiesBs.toFixed(2)}`;
    }
  });
};

router.patch('/__copetin_db/rentals/:id/return-charge', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {};
    const rentalId = String(req.params.id ?? '').trim();

    if (!rentalId) {
      res.status(400).json({ error: 'Debes indicar la orden de devolución.' });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'revision')) {
      res.status(400).json({ error: 'Debes enviar la revisión actual para editar el cargo.' });
      return;
    }

    const hasDamagedCharge = Object.prototype.hasOwnProperty.call(payload, 'damagedUnitChargeBs');
    const hasMissingCharge = Object.prototype.hasOwnProperty.call(payload, 'missingUnitChargeBs');
    if (!hasDamagedCharge && !hasMissingCharge) {
      res.status(400).json({ error: 'Debes indicar al menos un precio de daño o faltante.' });
      return;
    }

    let responseRental = null;
    let responseLine = null;

    const result = await updateStateSnapshot((state) => {
      state.rentals = Array.isArray(state.rentals) ? state.rentals : [];
      state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];

      const rental = state.rentals.find((entry) => (
        !entry?.deletedAt
        && (
          String(entry?.id ?? '') === rentalId
          || String(entry?.orderCode ?? '') === rentalId
          || String(entry?.contractCode ?? '') === rentalId
        )
      ));
      if (!rental) {
        const error = new Error('No se encontró la orden de devolución.');
        error.statusCode = 404;
        throw error;
      }

      const report = Array.isArray(rental.returnReport) ? rental.returnReport : [];
      const lineIndex = findReturnChargeLineIndex(report, payload);
      if (lineIndex < 0) {
        const error = new Error('No se encontró la línea de daño o faltante que deseas editar.');
        error.statusCode = 404;
        throw error;
      }

      const line = report[lineIndex];
      const damagedQty = Math.max(0, Math.trunc(Number(line?.damagedQty ?? 0)));
      const missingQty = Math.max(0, Math.trunc(Number(line?.missingQty ?? 0)));
      if (damagedQty <= 0 && missingQty <= 0) {
        const error = new Error('La línea seleccionada no tiene daño ni faltante registrado.');
        error.statusCode = 409;
        throw error;
      }

      // Si ya existe cobro/aplicación de garantía asociado a esta línea, cambiar
      // el precio reescribiría historia contable. Se bloquea para proteger recibos.
      if (isReturnChargeLineSettled(line)) {
        const error = new Error('Este cargo ya fue cobrado o aplicado. No se puede cambiar el precio sin modificar un movimiento contable histórico.');
        error.statusCode = 409;
        throw error;
      }

      const collectedDamageBs = directMoney(Math.max(
        Number(rental?.payment?.damageCollectedBs ?? 0),
        Number(rental?.totals?.damageCollectedBs ?? 0),
        Number(rental?.payment?.penaltiesCollectedBs ?? 0),
        Number(rental?.totals?.penaltiesCollectedBs ?? 0),
        Number(rental?.payment?.returnChargesCollectedBs ?? 0),
        Number(rental?.totals?.returnChargesCollectedBs ?? 0),
      ));
      if (collectedDamageBs > 0) {
        const error = new Error('Ya existen cobros de daños/faltantes en esta devolución. Para evitar alterar recibos históricos, el precio debe corregirse antes del cobro.');
        error.statusCode = 409;
        throw error;
      }

      const damagedUnitChargeBs = damagedQty > 0
        ? directMoney(hasDamagedCharge ? payload.damagedUnitChargeBs : line?.damagedUnitChargeBs)
        : 0;
      const missingUnitChargeBs = missingQty > 0
        ? directMoney(hasMissingCharge ? payload.missingUnitChargeBs : line?.missingUnitChargeBs)
        : 0;

      const damagedFeeBs = directMoney(damagedQty * damagedUnitChargeBs);
      const missingFeeBs = directMoney(missingQty * missingUnitChargeBs);
      const penaltyBs = directMoney(damagedFeeBs + missingFeeBs);
      const now = new Date().toISOString();

      report[lineIndex] = {
        ...line,
        damagedUnitChargeBs,
        missingUnitChargeBs,
        damagedFeeBs,
        missingFeeBs,
        penaltyBs,
        chargeUpdatedAt: now,
        chargeUpdatedById: payload.updatedById ?? payload.userId ?? null,
        chargeUpdatedByName: String(payload.updatedByName ?? payload.userName ?? 'Sistema').trim() || 'Sistema',
      };
      rental.returnReport = report;

      const normalizeOwner = (value) => {
        const normalized = String(value ?? '').trim().toLowerCase();
        return ['transporte', 'lavado'].includes(normalized) ? normalized : 'cliente';
      };
      const totals = report.reduce((acc, entry) => {
        const entryPenalty = directMoney(
          entry?.penaltyBs
          ?? (directMoney(entry?.damagedFeeBs) + directMoney(entry?.missingFeeBs)),
        );
        if (normalizeOwner(entry?.chargeOwner) === 'cliente') {
          acc.penaltiesBs = directMoney(acc.penaltiesBs + entryPenalty);
        } else {
          acc.internalPenaltiesBs = directMoney(acc.internalPenaltiesBs + entryPenalty);
        }
        return acc;
      }, { penaltiesBs: 0, internalPenaltiesBs: 0 });

      rental.penaltiesBs = totals.penaltiesBs;
      rental.internalPenaltiesBs = totals.internalPenaltiesBs;

      const settlement = rental.returnSettlement ?? {};
      const linkedContract = state.contracts.find((contract) => (
        String(contract?.id ?? '') === String(rental?.contractId ?? '')
        || String(contract?.rentalId ?? '') === String(rental.id)
        || (rental?.orderCode && String(contract?.orderCode ?? '') === String(rental.orderCode))
      )) ?? null;
      const outstandingRentalBs = getCurrentCommercialOutstandingBs(linkedContract, rental);
      const depositBs = directMoney(rental?.depositBs);
      const originalDiscountCoveredByDepositBs = directMoney(settlement?.discountCoveredByDepositBs);
      const economicResetApplied = Boolean(settlement?.economicResetAt);

      let totalDiscountAgainstDepositBs;
      let discountCoveredByDepositBs;
      let pendingCollectionBs;
      let refundBs;

      if (economicResetApplied) {
        // Tras Reset económico la garantía ya no se reaplica automáticamente:
        // únicamente cambia el saldo pendiente de daño/faltante.
        totalDiscountAgainstDepositBs = directMoney(outstandingRentalBs + totals.penaltiesBs);
        discountCoveredByDepositBs = originalDiscountCoveredByDepositBs;
        pendingCollectionBs = directMoney(Math.max(
          0,
          outstandingRentalBs + totals.penaltiesBs - discountCoveredByDepositBs,
        ));
        refundBs = directMoney(settlement?.refundBs ?? rental?.refundBs);
      } else {
        totalDiscountAgainstDepositBs = directMoney(outstandingRentalBs + totals.penaltiesBs);
        discountCoveredByDepositBs = directMoney(Math.min(depositBs, totalDiscountAgainstDepositBs));
        pendingCollectionBs = directMoney(Math.max(0, totalDiscountAgainstDepositBs - depositBs));
        // No se reescribe un egreso de garantía ya emitido. El valor sugerido solo
        // cambia si todavía no existe una devolución efectiva registrada.
        const hasGuaranteeRefundMovement = state.cashMovements.some((movement) => (
          !movement?.voidedAt
          && String(movement?.linkedRentalId ?? movement?.sourceId ?? '') === String(rental.id)
          && (
            isGuaranteeRefundMovement(movement)
            || String(movement?.type ?? '').toLowerCase() === 'devolucion_garantia'
          )
          && Math.abs(Number(movement?.amountBs ?? 0)) > 0
        ));
        refundBs = hasGuaranteeRefundMovement
          ? directMoney(settlement?.refundBs ?? rental?.refundBs)
          : directMoney(Math.max(0, depositBs - totalDiscountAgainstDepositBs));
      }

      rental.refundBs = refundBs;
      rental.returnSettlement = {
        ...settlement,
        outstandingRentalBs,
        penaltiesBs: totals.penaltiesBs,
        internalPenaltiesBs: totals.internalPenaltiesBs,
        totalDiscountAgainstDepositBs,
        discountCoveredByDepositBs,
        pendingCollectionBs,
        refundBs,
        accountingStatus: pendingCollectionBs <= 0.009 ? 'liquidado' : 'saldo_pendiente',
        chargeUpdatedAt: now,
        chargeUpdatedById: payload.updatedById ?? payload.userId ?? null,
        chargeUpdatedByName: String(payload.updatedByName ?? payload.userName ?? 'Sistema').trim() || 'Sistema',
      };
      rental.payment = {
        ...(rental.payment ?? {}),
        pendingPaymentBs: pendingCollectionBs,
        status: pendingCollectionBs <= 0.009 ? 'liquidado' : 'saldo_pendiente',
      };
      rental.totals = {
        ...(rental.totals ?? {}),
        pendingPaymentBs: pendingCollectionBs,
      };
      rental.accountingStatus = pendingCollectionBs <= 0.009
        ? 'cobrado_finalizado'
        : 'finalizado_pendiente_cobro';
      rental.updatedAt = now;

      // Solo se actualizan movimientos informativos automáticos de monto 0.
      // Nunca se crea, borra o reescribe un recibo/cobro real.
      updateAutomaticReturnMovementDescriptions(state, rental);

      state.systemAuditLog = Array.isArray(state.systemAuditLog) ? state.systemAuditLog : [];
      state.systemAuditLog.unshift({
        id: `audit-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        type: 'return_charge_updated',
        action: 'editar_cargo_devolucion',
        entityType: 'rental',
        entityId: rental.id,
        entityCode: rental.orderCode ?? rental.contractCode ?? '',
        lineKey: report[lineIndex]?.lineKey ?? '',
        itemId: report[lineIndex]?.itemId ?? '',
        itemName: report[lineIndex]?.itemName ?? '',
        penaltyBs,
        userId: payload.updatedById ?? payload.userId ?? null,
        userName: String(payload.updatedByName ?? payload.userName ?? 'Sistema').trim() || 'Sistema',
        createdAt: now,
      });

      responseRental = structuredClone(rental);
      responseLine = structuredClone(report[lineIndex]);
      return state;
    }, payload.revision);

    res.set('Cache-Control', 'private, no-store');
    res.json({
      ok: true,
      rental: responseRental,
      returnLine: responseLine,
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

router.post('/__copetin_db/cash/collect-receivable', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const rentalId = String(payload.rentalId ?? '').trim();
    const amountBs = directMoney(payload.amountBs);
    const receivedAmountBs = directMoney(payload.receivedAmountBs ?? amountBs);
    if (!rentalId) return res.status(400).json({ error: 'No se pudo identificar la orden a cobrar.' });
    if (amountBs <= 0) return res.status(400).json({ error: 'El monto cobrado debe ser mayor a 0.' });
    if (receivedAmountBs + 0.01 < amountBs) return res.status(400).json({ error: 'El total recibido no puede ser menor al monto aplicado al contrato.' });

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
      reconcileVipPrepaidRental(state, rental, linkedContract);
      const isReturned = rental.status === 'returned';
      const settlement = rental.returnSettlement ?? {};
      const storedRentalTotalBs = directMoney(Math.max(
        Number(rental?.totals?.totalBs ?? 0),
        Number(linkedContract?.totals?.totalBs ?? linkedContract?.totalBs ?? 0),
      ));
      const repairedRentalTotalBs = getRentalChargeTargetBs(linkedContract, rental);
      const commercialTotalCorrectionBs = directMoney(Math.max(
        0,
        repairedRentalTotalBs - storedRentalTotalBs,
      ));
      const breakdown = Array.isArray(payload.collectionBreakdown) && payload.collectionBreakdown.length
        ? payload.collectionBreakdown.map((entry) => ({ ...entry, amountBs: directMoney(entry?.amountBs) })).filter((entry) => entry.amountBs > 0)
        : [{ target: String(payload.collectionTarget ?? 'balance'), amountBs }];
      const isDamageOnlyCollection = breakdown.length > 0
        && breakdown.every((entry) => String(entry?.target ?? '').trim() === 'damage');
      const requestedDamageBs = directMoney(
        breakdown
          .filter((entry) => String(entry?.target ?? '').trim() === 'damage')
          .reduce((sum, entry) => sum + directMoney(entry?.amountBs), 0),
      );

      const storedPendingBs = Number(isReturned
        ? settlement.pendingCollectionBs ?? rental?.payment?.pendingPaymentBs ?? 0
        : rental?.payment?.pendingPaymentBs ?? rental?.totals?.pendingPaymentBs ?? 0);
      const previousPaid = directMoney(Math.max(
        Number(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs ?? 0),
        Number(linkedContract?.payment?.paidAtApprovalBs ?? 0),
      ));
      const derivedCommercialPendingBs = getCurrentCommercialOutstandingBs(linkedContract, rental);
      const deliveryFeeBs = directMoney(Math.max(
        Number(rental?.deliveryFeeBs ?? 0),
        Number(rental?.totals?.deliveryFeeBs ?? 0),
        Number(linkedContract?.deliveryFeeBs ?? 0),
        Number(linkedContract?.totals?.deliveryFeeBs ?? 0),
      ));
      const previousTransport = directMoney(Math.max(
        Number(rental?.payment?.deliveryFeeCollectedBs ?? 0),
        Number(rental?.totals?.deliveryFeeCollectedBs ?? 0),
      ));
      // En devoluciones, reemplazamos la parte comercial de la liquidacion por
      // total vigente menos pagos. La diferencia no comercial (danos/garantia)
      // permanece intacta y el resultado se persiste con el cobro.
      const currentPending = directMoney(isReturned
        ? getReconciledReturnedPendingCollectionBs(linkedContract, rental)
        : Math.max(
            Math.max(0, storedPendingBs) + commercialTotalCorrectionBs,
            derivedCommercialPendingBs,
          ));

      // Los daños/faltantes son una obligación económica separada del saldo de
      // alquiler. Un contrato puede estar totalmente pagado y, aun así, tener un
      // faltante cobrado después de la devolución. En ese caso NO se debe usar
      // pendingPaymentBs como límite, porque ese campo representa el saldo
      // comercial del contrato y puede ser 0.
      let pendingDamageBs = 0;
      if (isDamageOnlyCollection) {
        const normalizeChargeOwner = (value) => {
          const normalized = String(value ?? '').trim().toLowerCase();
          return ['transporte', 'lavado'].includes(normalized) ? normalized : 'cliente';
        };
        const reportPenaltyBs = directMoney((Array.isArray(rental?.returnReport) ? rental.returnReport : [])
          .reduce((sum, line) => {
            if (normalizeChargeOwner(line?.chargeOwner) !== 'cliente') return sum;
            return sum + directMoney(
              line?.penaltyBs
              ?? (directMoney(line?.damagedFeeBs) + directMoney(line?.missingFeeBs)),
            );
          }, 0));
        const totalDamageBs = reportPenaltyBs > 0
          ? reportPenaltyBs
          : directMoney(rental?.penaltiesBs ?? settlement?.penaltiesBs ?? 0);

        const contractLedger = Array.isArray(linkedContract?.economicLedger)
          ? linkedContract.economicLedger
          : [];
        // Una linea "charge" sin movimiento de Caja representa aplicación
        // explícita de garantía. Las líneas charge vinculadas a Caja son cobros
        // reales y se contabilizan abajo desde cashMovements, no dos veces.
        const guaranteeAppliedToDamageBs = directMoney(contractLedger.reduce((sum, entry) => {
          if (entry?.deletedAt || String(entry?.type ?? '').trim().toLowerCase() !== 'charge') return sum;
          const cashMovementId = String(entry?.cashMovementId ?? '').trim();
          const isCashDamage = String(entry?.cashCollectionTarget ?? '').trim().toLowerCase() === 'damage';
          if (cashMovementId || isCashDamage || entry?.isCashRegistered) return sum;
          return sum + Math.max(0, directMoney(entry?.amountBs));
        }, 0));

        const collectedDamageBs = directMoney(state.cashMovements.reduce((sum, movement) => {
          if (movement?.voidedAt || String(movement?.receiptStatus ?? '').trim().toLowerCase() === 'anulado') return sum;
          const sameRental = String(movement?.linkedRentalId ?? movement?.sourceId ?? '') === String(rental.id);
          const sameContract = linkedContract && String(movement?.linkedContractId ?? '') === String(linkedContract.id);
          const sameOrder = String(movement?.linkedOrderCode ?? '') === String(rental?.orderCode ?? linkedContract?.orderCode ?? '');
          if (!sameRental && !sameContract && !sameOrder) return sum;

          const movementBreakdown = Array.isArray(movement?.collectionBreakdown) ? movement.collectionBreakdown : [];
          const breakdownDamageBs = directMoney(movementBreakdown
            .filter((entry) => String(entry?.target ?? '').trim() === 'damage')
            .reduce((subtotal, entry) => subtotal + directMoney(entry?.amountBs), 0));
          if (breakdownDamageBs > 0) return sum + breakdownDamageBs;

          const storedDamageBs = Math.max(0, directMoney(movement?.damageCollectedBs));
          if (storedDamageBs > 0) return sum + storedDamageBs;

          const target = String(movement?.collectionTarget ?? '').trim().toLowerCase();
          const category = String(movement?.category ?? '').trim().toLowerCase();
          const tag = String(movement?.accountingTag ?? '').trim().toLowerCase();
          const type = String(movement?.type ?? '').trim().toLowerCase();
          const isDamageMovement = target === 'damage'
            || category === 'cobro_danos_faltantes'
            || tag === 'contract_damage_collection'
            || type.includes('dano')
            || type.includes('faltante');
          return isDamageMovement ? sum + Math.max(0, directMoney(movement?.amountBs)) : sum;
        }, 0));

        pendingDamageBs = directMoney(Math.max(
          0,
          totalDamageBs - guaranteeAppliedToDamageBs - collectedDamageBs,
        ));
        if (pendingDamageBs <= 0) {
          const error = new Error('Esta orden no tiene daños o faltantes pendientes por cobrar.');
          error.statusCode = 409;
          throw error;
        }
        if (requestedDamageBs - pendingDamageBs > 0.01 || amountBs - pendingDamageBs > 0.01) {
          const error = new Error(`Los daños/faltantes pendientes son Bs ${pendingDamageBs.toFixed(2)}.`);
          error.statusCode = 409;
          throw error;
        }
      } else {
        if (currentPending <= 0) { const error = new Error('Esta orden no tiene saldo pendiente por cobrar.'); error.statusCode = 409; throw error; }
        if (amountBs - currentPending > 0.01) { const error = new Error(`El saldo pendiente es Bs ${currentPending.toFixed(2)}.`); error.statusCode = 409; throw error; }
      }

      const explicitTransport = directMoney(breakdown.filter((e) => e.target === 'transport').reduce((s,e)=>s+e.amountBs,0));
      const explicitDamage = directMoney(breakdown.filter((e) => e.target === 'damage').reduce((s,e)=>s+e.amountBs,0));
      const explicitRental = directMoney(breakdown.filter((e) => e.target === 'rental').reduce((s,e)=>s+e.amountBs,0));
      const balance = directMoney(breakdown.filter((e) => e.target === 'balance').reduce((s,e)=>s+e.amountBs,0));
      // En una devolución, pendingCollectionBs representa el saldo total aún
      // pendiente (alquiler + daños/faltantes no cubiertos). Un cobro exclusivo
      // de daños no cambia outstandingRentalBs, pero sí debe reducir ese saldo
      // total; de lo contrario Caja Grande sigue mostrando como deuda un cargo
      // que ya tiene movimiento y recibo reales.
      const remainingBs = Number(Math.max(
        0,
        currentPending - (isDamageOnlyCollection ? explicitDamage : amountBs),
      ).toFixed(2));
      // Si todavía existe deuda comercial, el transporte pendiente conserva su
      // clasificación incluso después de la devolución. No se aplica a cobros
      // exclusivos de daños ni a contratos cuyo total comercial ya fue cubierto.
      const collectibleTransportBs = !isReturned || derivedCommercialPendingBs > 0
        ? deliveryFeeBs
        : 0;
      const remainingTransport = directMoney(collectibleTransportBs - previousTransport);
      const balanceTransport = Math.min(balance, remainingTransport);
      const transportNow = directMoney(explicitTransport + balanceTransport);
      const rentalNow = directMoney(explicitRental + Math.max(0, balance - balanceTransport));
      const now = new Date().toISOString();
      const commercialAppliedNow = directMoney(rentalNow + transportNow);
      const nextPaymentStatus = isReturned
        ? (remainingBs > 0 ? 'saldo_pendiente' : 'cobrado_finalizado')
        : isDamageOnlyCollection
          ? String(rental?.payment?.status ?? rental?.totals?.status ?? '').trim()
          : remainingBs > 0 ? 'saldo_pendiente' : 'cancelado';
      const nextPaymentMode = isReturned
        ? (remainingBs > 0 ? 'a_cuenta' : 'cancelado')
        : isDamageOnlyCollection
          ? String(rental?.payment?.mode ?? rental?.totals?.mode ?? '').trim()
          : remainingBs > 0 ? 'a_cuenta' : 'cancelado';

      rental.payment = { ...(rental.payment ?? {}), paidAtRentalBs: directMoney(previousPaid + commercialAppliedNow), pendingPaymentBs: remainingBs,
        deliveryFeeCollectedBs: directMoney(previousTransport + transportNow),
        rentalCollectedBs: directMoney(Number(rental?.payment?.rentalCollectedBs ?? rental?.totals?.rentalCollectedBs ?? 0) + rentalNow),
        damageCollectedBs: directMoney(Number(rental?.payment?.damageCollectedBs ?? rental?.totals?.damageCollectedBs ?? 0) + explicitDamage),
        status: nextPaymentStatus,
        mode: nextPaymentMode, lastCollectionAt: now, lastCollectionBy: String(payload.createdBy ?? 'Sistema') };
      rental.totals = {
        ...(rental.totals ?? {}),
        ...(repairedRentalTotalBs > storedRentalTotalBs
          ? {
              totalBs: repairedRentalTotalBs,
              baseSubtotalBs: directMoney(
                Number(rental?.totals?.itemsNetSubtotalBs ?? rental?.totals?.itemsSubtotalBs ?? 0)
                + Number(rental?.totals?.servicesSubtotalBs ?? 0),
              ),
            }
          : {}),
        ...rental.payment,
      };
      if (isReturned) {
        const repairedOutstandingRentalBs = directMoney(Math.max(
          0,
          derivedCommercialPendingBs
            - rentalNow
            - transportNow,
        ));
        rental.returnSettlement = {
          ...settlement,
          outstandingRentalBs: repairedOutstandingRentalBs,
          pendingCollectionBs: remainingBs,
          paidBs: directMoney(
            Number(settlement.paidBs ?? previousPaid) + rentalNow + transportNow,
          ),
          damageCollectedBs: directMoney(Number(settlement.damageCollectedBs ?? 0) + explicitDamage),
          penaltiesCollectedBs: directMoney(Number(settlement.penaltiesCollectedBs ?? 0) + explicitDamage),
          collectedAfterReturnBs: directMoney(Number(settlement.collectedAfterReturnBs ?? 0) + amountBs),
          accountingStatus: remainingBs === 0 ? 'liquidado' : 'saldo_pendiente',
          settledAt: remainingBs === 0 ? (settlement.settledAt ?? now) : null,
          collectedAt: remainingBs === 0 ? (settlement.collectedAt ?? now) : settlement.collectedAt ?? null,
          collectedBy: remainingBs === 0 ? (settlement.collectedBy ?? String(payload.createdBy ?? 'Sistema')) : settlement.collectedBy ?? null,
        };
        rental.accountingStatus = remainingBs === 0 ? 'cobrado_finalizado' : 'finalizado_pendiente_cobro';
        rental.finalizedAt = remainingBs === 0 ? (rental.finalizedAt ?? now) : rental.finalizedAt ?? null;
      } else if (!isDamageOnlyCollection) rental.accountingStatus = remainingBs === 0 ? 'cobrado' : 'saldo_pendiente';
      rental.updatedAt = now;

      state.contracts.forEach((contract) => {
        if (String(contract?.rentalId ?? '') === rental.id || (contract?.orderCode && contract.orderCode === rental.orderCode)) {
          if (repairedRentalTotalBs > storedRentalTotalBs) {
            const deliveryFeeBs = directMoney(
              rental?.totals?.deliveryFeeBs
              ?? rental?.deliveryFeeBs
              ?? contract?.totals?.deliveryFeeBs
              ?? contract?.deliveryFeeBs
              ?? 0,
            );
            contract.totals = {
              ...(contract.totals ?? {}),
              totalBs: repairedRentalTotalBs,
              baseSubtotalBs: directMoney(
                Number(rental?.totals?.itemsNetSubtotalBs ?? rental?.totals?.itemsSubtotalBs ?? contract?.totals?.itemsNetSubtotalBs ?? contract?.totals?.itemsSubtotalBs ?? 0)
                + Number(rental?.totals?.servicesSubtotalBs ?? contract?.totals?.servicesSubtotalBs ?? 0),
              ),
              subtotalBs: directMoney(Math.max(0, repairedRentalTotalBs - deliveryFeeBs)),
            };
          }
          contract.accountingStatus = rental.accountingStatus;
          if (!isDamageOnlyCollection) contract.paymentStatus = rental.payment.status;
          contract.updatedAt = now;
        }
      });
      state.serviceOrders.forEach((order) => {
        if (String(order?.rentalId ?? '') === rental.id || String(order?.id ?? '') === rental.id || order?.codigo === rental.orderCode) {
          order.saldo_pendiente = remainingBs;
          order.estado = isReturned && remainingBs === 0 ? 'cobrado_finalizado' : remainingBs === 0 ? 'cobrada' : 'pendiente_cobro';
          order.updated_at = now;
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
      const movement = buildDirectMovement(state, { ...payload, type, amountBs: receivedAmountBs,
        description: String(payload.receiptDetail ?? '').trim().split('\n').filter(Boolean).slice(0,2).join(' | ') || String(payload.note ?? '').trim() || `Cobro contrato: ${rental.customerName ?? ''}`,
        sourceType: isReturned ? 'return' : 'rental', sourceId: rental.id, cashBoxType: 'BIG_CASH',
        category: String(payload.category ?? '').trim() || (mixed ? 'cobro_mixto_contrato' : target === 'transport' ? 'transporte_cobrado' : target === 'damage' ? 'cobro_danos_faltantes' : isReturned ? 'cobro_liquidacion' : 'cobro_contrato'),
        linkedRentalId: rental.id, linkedContractId: String(payload.linkedContractId ?? matchedContract?.id ?? rental.contractId ?? '').trim(), linkedOrderCode: rental.orderCode,
        transportRevenueBs: transportNow, damageCollectedBs: explicitDamage, notes: payload.note,
        contractAllocationBs: commercialAppliedNow,
        guaranteeAllocationBs: directMoney(payload.guaranteeAllocationBs),
        surplusAllocationBs: directMoney(payload.surplusAllocationBs),
        receivedAmountBs });
      state.cashMovements.push(movement);
      responseData = { rental: structuredClone(rental), movement: structuredClone(movement), movements: [structuredClone(movement)] };
      return state;
    });
    res.json({ ok: true, ...responseData, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
  } catch (error) { if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message }); next(error); }
});



router.post('/__copetin_db/cash/vip-prepaid/top-up', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const clientId = String(payload.clientId ?? '').trim();
    const amountBs = directMoney(payload.amountBs);
    const reason = String(payload.reason ?? payload.notes ?? '').trim();
    const requestedDate = String(payload.date ?? '').trim();
    if (!clientId) return res.status(400).json({ error: 'Selecciona un cliente VIP.' });
    if (amountBs <= 0) return res.status(400).json({ error: 'El monto de la recarga debe ser mayor a 0.' });
    if (!reason) return res.status(400).json({ error: 'Indica el motivo de la recarga.' });
    if (!requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return res.status(400).json({ error: 'Indica una fecha valida para la recarga.' });

    let responseData = null;
    const result = await updateStateSnapshot((state) => {
      state.clients = Array.isArray(state.clients) ? state.clients : [];
      state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
      state.cashSessions = Array.isArray(state.cashSessions) ? state.cashSessions : [];
      state.rentals = Array.isArray(state.rentals) ? state.rentals : [];
      state.contracts = Array.isArray(state.contracts) ? state.contracts : [];
      state.serviceOrders = Array.isArray(state.serviceOrders) ? state.serviceOrders : [];

      const duplicate = findDirectOperation(state, payload.clientOperationId);
      if (duplicate) {
        const duplicateClient = state.clients.find((entry) => String(entry?.id ?? '') === clientId) ?? null;
        responseData = { client: structuredClone(duplicateClient), movement: structuredClone(duplicate), movements: [structuredClone(duplicate)], duplicate: true, repairs: [] };
        return state;
      }

      const repairs = repairVipPrepaidBalances(state);
      const client = state.clients.find((entry) => String(entry?.id ?? '') === clientId && !entry?.deletedAt);
      if (!client) { const error = new Error('No se encontro el cliente seleccionado.'); error.statusCode = 404; throw error; }
      if (!client.prepaidEnabled) { const error = new Error('El cliente no tiene una cuenta prepago VIP activa.'); error.statusCode = 409; throw error; }

      client.prepaidMovements = Array.isArray(client.prepaidMovements) ? client.prepaidMovements : [];
      const previousBalanceBs = directMoney(client.prepaidBalanceBs);
      const nextBalanceBs = directMoney(previousBalanceBs + amountBs);
      const now = new Date();
      const [year, month, day] = requestedDate.split('-').map(Number);
      const requestedAt = new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
      const createdAt = Number.isNaN(requestedAt.getTime()) ? now.toISOString() : requestedAt.toISOString();
      const movementId = directId('pre');
      client.prepaidEnabled = true;
      client.prepaidBalanceBs = nextBalanceBs;
      client.prepaidTotalDepositedBs = directMoney(Number(client.prepaidTotalDepositedBs ?? 0) + amountBs);
      client.prepaidTotalUsedBs = directMoney(client.prepaidTotalUsedBs);
      client.prepaidMovements.push({
        id: movementId,
        type: 'deposit',
        amountBs,
        description: reason,
        sourceType: 'client_topup',
        sourceId: client.id,
        orderCode: null,
        balanceAfterBs: nextBalanceBs,
        nonPhysical: false,
        createdAt,
        paymentMethod: directPaymentMethod(payload.paymentMethod),
        paymentAccount: directPaymentAccount(payload.paymentMethod, payload.paymentAccount),
        createdBy: String(payload.createdBy ?? 'Sistema').trim() || 'Sistema',
      });
      client.updatedAt = now.toISOString();

      const activeSession = state.cashSessions.find((session) => String(session?.status ?? '').toLowerCase() === 'open') ?? null;
      const cashMovement = buildDirectMovement(state, {
        ...payload,
        sessionId: activeSession?.id ?? null,
        type: 'ingreso_prepago_cliente',
        amountBs,
        description: `Recarga cuenta VIP: ${client.name ?? client.companyName ?? 'Cliente'}`,
        sourceType: 'client_prepaid',
        sourceId: client.id,
        cashBoxType: 'BIG_CASH',
        category: 'prepago_cliente_vip',
        accountingTag: 'vip_prepaid_topup',
        receiptDetail: `Cliente VIP: ${client.name ?? ''}\nMotivo: ${reason}${String(payload.notes ?? '').trim() ? `\nObservacion: ${String(payload.notes).trim()}` : ''}\nSaldo anterior: Bs ${previousBalanceBs.toFixed(2)}\nNuevo saldo: Bs ${nextBalanceBs.toFixed(2)}`,
        notes: [reason, String(payload.notes ?? '').trim()].filter(Boolean).join(' | '),
        clientOperationId: payload.clientOperationId,
      });
      cashMovement.createdAt = createdAt;
      cashMovement.vipClientId = client.id;
      cashMovement.vipPrepaidMovementId = movementId;
      cashMovement.vipPreviousBalanceBs = previousBalanceBs;
      cashMovement.vipNewBalanceBs = nextBalanceBs;
      state.cashMovements.push(cashMovement);
      const prepaidMovement = client.prepaidMovements[client.prepaidMovements.length - 1];
      prepaidMovement.cashMovementId = cashMovement.id;
      prepaidMovement.cashReceiptCode = cashMovement.receiptCode;

      responseData = {
        client: structuredClone(client),
        movement: structuredClone(cashMovement),
        movements: [structuredClone(cashMovement)],
        prepaidMovement: structuredClone(client.prepaidMovements[client.prepaidMovements.length - 1]),
        previousBalanceBs,
        newBalanceBs: nextBalanceBs,
        repairs,
      };
      return state;
    });
    res.json({ ok: true, ...responseData, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
  } catch (error) { if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message }); next(error); }
});

router.post('/__copetin_db/accounting/vip-prepaid/repair', async (req, res, next) => {
  try {
    let repairs = [];
    const result = await updateStateSnapshot((state) => {
      state.clients = Array.isArray(state.clients) ? state.clients : [];
      state.rentals = Array.isArray(state.rentals) ? state.rentals : [];
      state.contracts = Array.isArray(state.contracts) ? state.contracts : [];
      state.serviceOrders = Array.isArray(state.serviceOrders) ? state.serviceOrders : [];
      repairs = repairVipPrepaidBalances(state);
      return state;
    });
    res.json({ ok: true, repaired: repairs.length, repairs, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
  } catch (error) { next(error); }
});

router.get('/__copetin_db/accounting/summary', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    const currentMovements = (Array.isArray(state.cashMovements) ? state.cashMovements : [])
      .filter((movement) => !isArchivedAccountingRecord(movement))
      .filter((movement) => (
        !movement?.voidedAt
        && String(movement?.receiptStatus ?? '').toLowerCase() !== 'anulado'
      ));
    const currentSessions = (Array.isArray(state.cashSessions) ? state.cashSessions : [])
      .filter((session) => !isArchivedAccountingRecord(session));
    const activeSession = currentSessions.find(
      (session) => String(session?.status ?? '').toLowerCase() === 'open',
    ) ?? null;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayMovements = currentMovements.filter((movement) => {
      const createdAt = new Date(movement?.createdAt ?? '').getTime();
      return Number.isFinite(createdAt) && createdAt >= startOfDay;
    });
    const realTodayMovements = todayMovements.filter((movement) => !movement?.isInternalTransfer);

    const sum = (rows, predicate = () => true) => Number(rows
      .filter(predicate)
      .reduce((total, movement) => total + Number(movement?.amountBs ?? 0), 0)
      .toFixed(2));
    const boxIs = (movement, type) => String(movement?.cashBoxType ?? '').toUpperCase() === type;

    const bigCashBalanceBs = sum(currentMovements, (movement) => boxIs(movement, 'BIG_CASH'));
    const pettyCashBalanceBs = sum(currentMovements, (movement) => boxIs(movement, 'PETTY_CASH'));
    const todayIncomeBs = sum(realTodayMovements, (movement) => Number(movement?.amountBs ?? 0) > 0);
    const todayExpenseBs = Math.abs(sum(
      realTodayMovements,
      (movement) => Number(movement?.amountBs ?? 0) < 0,
    ));
    const todayBigCashIncomeBs = sum(
      realTodayMovements,
      (movement) => boxIs(movement, 'BIG_CASH') && Number(movement?.amountBs ?? 0) > 0,
    );
    const todayBigCashExpenseBs = Math.abs(sum(
      realTodayMovements,
      (movement) => boxIs(movement, 'BIG_CASH') && Number(movement?.amountBs ?? 0) < 0,
    ));
    const todayPettyCashIncomeBs = sum(
      realTodayMovements,
      (movement) => boxIs(movement, 'PETTY_CASH') && Number(movement?.amountBs ?? 0) > 0,
    );
    const todayPettyCashExpenseBs = Math.abs(sum(
      realTodayMovements,
      (movement) => boxIs(movement, 'PETTY_CASH') && Number(movement?.amountBs ?? 0) < 0,
    ));

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      ok: true,
      activeSession: activeSession
        ? {
            ...activeSession,
            expectedBigCashBs: bigCashBalanceBs,
            expectedPettyCashBs: pettyCashBalanceBs,
            expectedBalanceBs: Number((bigCashBalanceBs + pettyCashBalanceBs).toFixed(2)),
          }
        : null,
      sessionsCount: currentSessions.length,
      movementsCount: currentMovements.length,
      orphanMovementsCount: currentMovements.filter((movement) => !movement?.sessionId).length,
      todayIncomeBs,
      todayExpenseBs,
      todayBigCashIncomeBs,
      todayBigCashExpenseBs,
      todayPettyCashIncomeBs,
      todayPettyCashExpenseBs,
      bigCashBalanceBs,
      pettyCashBalanceBs,
      totalAvailableBs: Number((bigCashBalanceBs + pettyCashBalanceBs).toFixed(2)),
      currentPeriodId: state?.settings?.accounting?.currentPeriodId ?? null,
      revision: snapshot?.revision ?? null,
      updatedAt: snapshot?.updatedAt ?? null,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/__copetin_db/personnel/options', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const query = directNormalizeText(req.query?.query ?? '').trim();
    const limit = Math.min(30, Math.max(5, Number.parseInt(req.query?.limit, 10) || 20));
    const rows = (Array.isArray(snapshot?.state?.personnelEmployees) ? snapshot.state.personnelEmployees : [])
      .filter((employee) => !employee?.deletedAt && String(employee?.status ?? 'active').toLowerCase() !== 'inactive')
      .filter((employee) => {
        if (!query) return true;
        return [
          employee?.fullName,
          employee?.documentId,
          employee?.employeeCode,
          employee?.position,
          employee?.department,
        ].some((value) => directNormalizeText(value).includes(query));
      })
      .sort((left, right) => String(left?.fullName ?? '').localeCompare(String(right?.fullName ?? ''), 'es'))
      .slice(0, limit)
      .map((employee) => ({
        id: employee.id,
        employeeCode: employee.employeeCode ?? '',
        fullName: employee.fullName ?? '',
        documentId: employee.documentId ?? '',
        department: employee.department ?? '',
        position: employee.position ?? '',
        status: employee.status ?? 'active',
      }));

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      ok: true,
      employees: rows,
      total: rows.length,
      revision: snapshot?.revision ?? null,
      updatedAt: snapshot?.updatedAt ?? null,
    });
  } catch (error) {
    next(error);
  }
});


const nextDirectAttendanceCode = (state) => {
  const maxPersisted = (Array.isArray(state?.attendanceRecords) ? state.attendanceRecords : [])
    .reduce((max, record) => {
      const match = String(record?.code ?? '').match(/^ASI-(\d+)$/i);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
  return `ASI-${String(maxPersisted + 1).padStart(5, '0')}`;
};

const getAttendanceClientDateKey = (value, timezoneOffsetMinutes = 0) => {
  const time = new Date(value ?? 0).getTime();
  if (!Number.isFinite(time)) return '';
  return new Date(time - Number(timezoneOffsetMinutes || 0) * 60000).toISOString().slice(0, 10);
};

const summarizeAttendanceRecord = (record = {}) => ({
  id: record.id,
  code: record.code ?? '',
  type: record.type ?? '',
  location: record.location ?? '',
  reason: record.reason ?? '',
  photoUrl: record.photoUrl ?? '',
  photoMimeType: record.photoMimeType ?? '',
  photoSizeBytes: Number(record.photoSizeBytes ?? 0) || 0,
  photoWidth: record.photoWidth ?? null,
  photoHeight: record.photoHeight ?? null,
  latitude: record.latitude ?? null,
  longitude: record.longitude ?? null,
  capturedAt: record.capturedAt ?? record.createdAt ?? null,
  createdAt: record.createdAt ?? record.capturedAt ?? null,
  userId: record.userId ?? '',
  userName: record.userName ?? '',
  role: record.role ?? '',
  markingMode: record.markingMode ?? 'personal',
  attendanceGroupId: record.attendanceGroupId ?? '',
  attendanceGroupSize: Number(record.attendanceGroupSize ?? 1) || 1,
  responsibleUserId: record.responsibleUserId ?? '',
  responsibleName: record.responsibleName ?? '',
  groupMemberNames: Array.isArray(record.groupMemberNames) ? record.groupMemberNames : [],
  isManualParticipant: Boolean(record.isManualParticipant),
  notes: record.notes ?? '',
});

const summarizeAttendanceUser = (user = {}) => ({
  id: user.id,
  fullName: user.fullName ?? '',
  username: user.username ?? '',
  role: user.role ?? '',
  roleId: user.roleId ?? '',
  roleIds: Array.isArray(user.roleIds) ? user.roleIds : [],
  status: user.status ?? 'active',
});

router.get('/__copetin_db/attendance/users', async (_req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const users = (Array.isArray(snapshot?.state?.users) ? snapshot.state.users : [])
      .filter((user) => !user?.deletedAt && String(user?.status ?? 'active').toLowerCase() === 'active')
      .sort((left, right) => String(left?.fullName ?? left?.username ?? '')
        .localeCompare(String(right?.fullName ?? right?.username ?? ''), 'es'))
      .map(summarizeAttendanceUser);

    res.setHeader('Cache-Control', 'private, max-age=30');
    res.json({
      ok: true,
      users,
      total: users.length,
      revision: snapshot?.revision ?? null,
      updatedAt: snapshot?.updatedAt ?? null,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/__copetin_db/attendance', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const dateFrom = String(req.query?.dateFrom ?? '').trim();
    const dateTo = String(req.query?.dateTo ?? dateFrom).trim();
    const type = String(req.query?.type ?? 'all').trim().toLowerCase();
    const query = String(req.query?.query ?? '').trim().toLowerCase();
    const timezoneOffsetMinutes = Number(req.query?.timezoneOffsetMinutes ?? 0) || 0;
    const limit = Math.min(1000, Math.max(20, Number.parseInt(req.query?.limit, 10) || 300));

    const rows = (Array.isArray(snapshot?.state?.attendanceRecords) ? snapshot.state.attendanceRecords : [])
      .filter((record) => {
        const dateKey = getAttendanceClientDateKey(record?.capturedAt ?? record?.createdAt, timezoneOffsetMinutes);
        if (dateFrom && dateKey < dateFrom) return false;
        if (dateTo && dateKey > dateTo) return false;
        if (type !== 'all' && String(record?.type ?? '').toLowerCase() !== type) return false;
        if (query) {
          const haystack = [
            record?.code,
            record?.userName,
            record?.location,
            record?.reason,
            record?.type,
            record?.responsibleName,
            ...(Array.isArray(record?.groupMemberNames) ? record.groupMemberNames : []),
          ].map((value) => String(value ?? '').toLowerCase()).join(' ');
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b?.capturedAt ?? b?.createdAt ?? 0) - new Date(a?.capturedAt ?? a?.createdAt ?? 0))
      .slice(0, limit)
      .map(summarizeAttendanceRecord);

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      ok: true,
      records: rows,
      total: rows.length,
      revision: snapshot?.revision ?? null,
      version: snapshot?.version ?? null,
      updatedAt: snapshot?.updatedAt ?? null,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/__copetin_db/attendance', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const type = String(payload?.type ?? '').trim().toLowerCase();
    const location = String(payload?.location ?? '').trim();
    const reason = String(payload?.reason ?? '').trim();
    const photoUrl = String(payload?.photoUrl ?? '').trim();
    const userName = String(payload?.userName ?? payload?.createdBy ?? '').trim() || 'Usuario';
    const userId = String(payload?.userId ?? '').trim();
    const role = String(payload?.role ?? '').trim();
    const clientOperationId = String(payload?.clientOperationId ?? '').trim();

    if (!['entrada', 'salida'].includes(type)) {
      res.status(400).json({ error: 'Debes seleccionar si es entrada o salida.' });
      return;
    }
    if (!location) {
      res.status(400).json({ error: 'Debes registrar la ubicacion.' });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: 'Debes indicar el motivo.' });
      return;
    }
    if (!photoUrl) {
      res.status(400).json({ error: 'Debes tomar o subir una foto para respaldar la marca.' });
      return;
    }

    let responseRecord = null;
    let duplicated = false;
    const result = await updateStateSnapshot((state) => {
      state.attendanceRecords = Array.isArray(state.attendanceRecords) ? state.attendanceRecords : [];

      if (clientOperationId) {
        const duplicate = state.attendanceRecords.find(
          (record) => String(record?.clientOperationId ?? '') === clientOperationId,
        );
        if (duplicate) {
          responseRecord = structuredClone(duplicate);
          duplicated = true;
          return state;
        }
      }

      const capturedAt = new Date().toISOString();
      const record = {
        id: directId('att'),
        code: nextDirectAttendanceCode(state),
        type,
        location,
        reason,
        photoDataUrl: '',
        photoUrl,
        photoMimeType: String(payload?.photoMimeType ?? '').trim(),
        photoSizeBytes: Number(payload?.photoSizeBytes ?? 0) || 0,
        photoWidth: payload?.photoWidth ?? null,
        photoHeight: payload?.photoHeight ?? null,
        latitude: payload?.latitude ?? null,
        longitude: payload?.longitude ?? null,
        capturedAt,
        createdAt: capturedAt,
        userId,
        userName,
        role,
        markingMode: String(payload?.markingMode ?? '') === 'responsable' ? 'responsable' : 'personal',
        attendanceGroupId: String(payload?.attendanceGroupId ?? '').trim(),
        attendanceGroupSize: Math.max(1, Number.parseInt(payload?.attendanceGroupSize, 10) || 1),
        responsibleUserId: String(payload?.responsibleUserId ?? '').trim(),
        responsibleName: String(payload?.responsibleName ?? '').trim(),
        groupMemberNames: Array.isArray(payload?.groupMemberNames)
          ? payload.groupMemberNames.map((name) => String(name ?? '').trim()).filter(Boolean)
          : [],
        isManualParticipant: Boolean(payload?.isManualParticipant),
        notes: String(payload?.notes ?? '').trim(),
        createdBy: String(payload?.createdBy ?? userName).trim() || userName,
        clientOperationId: clientOperationId || null,
      };
      state.attendanceRecords.push(record);
      responseRecord = structuredClone(record);
      return state;
    });

    res.setHeader('Cache-Control', 'private, no-store');
    res.status(duplicated ? 200 : 201).json({
      ok: true,
      record: summarizeAttendanceRecord(responseRecord),
      duplicated,
      revision: result.revision,
      version: result.version,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/__copetin_db/cash/movement', async (req, res, next) => {
  try {
    const rawPayload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const payload = normalizeDirectCashMovementPayload(rawPayload);
    const amountBs = directMoney(payload.amountBs);

    if (amountBs <= 0) {
      res.status(400).json({ error: 'El monto del movimiento debe ser mayor a 0.' });
      return;
    }
    if (!payload.description) {
      res.status(400).json({ error: 'Debes escribir una descripcion para el movimiento.' });
      return;
    }
    if (!['ingreso', 'egreso', 'transferencia'].includes(payload.type)) {
      res.status(400).json({ error: 'Tipo de movimiento de caja no valido.' });
      return;
    }

    let responseData = null;
    const result = await updateStateSnapshot((state) => {
      state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
      state.cashSessions = Array.isArray(state.cashSessions) ? state.cashSessions : [];

      const duplicate = findDirectOperation(state, payload.clientOperationId);
      if (duplicate) {
        const linked = duplicate.transferGroupId
          ? state.cashMovements.filter((movement) => movement.transferGroupId === duplicate.transferGroupId)
          : [duplicate];
        responseData = {
          movement: duplicate,
          movements: linked,
          summary: summarizeDirectCashState(state),
          duplicated: true,
        };
        return state;
      }

      let activeSession = getDirectCurrentCashSession(state);
      if (!activeSession && payload.type === 'transferencia') {
        activeSession = {
          id: directId('cash'),
          status: 'open',
          openingAmountBs: 0,
          openingBigCashBs: 0,
          openingPettyCashBs: 0,
          openedBy: payload.createdBy,
          openedAt: new Date().toISOString(),
          openNotes: 'Apertura automatica por reposicion a Caja Chica.',
          accountingPeriodId: state?.settings?.accounting?.currentPeriodId ?? null,
          accountingPeriodStatus: 'current',
          treasuryAccounts: [],
          treasuryUpdatedAt: null,
          treasuryUpdatedBy: '',
        };
        state.cashSessions.push(activeSession);
      }

      const periodId = state?.settings?.accounting?.currentPeriodId ?? activeSession?.accountingPeriodId ?? null;
      const bigCashBalance = getDirectCurrentCashBalance(state, 'BIG_CASH');
      const pettyCashBalance = getDirectCurrentCashBalance(state, 'PETTY_CASH');

      if (payload.type === 'transferencia' && amountBs > bigCashBalance) {
        const error = new Error(`Caja Grande no tiene saldo suficiente. Disponible: Bs ${bigCashBalance.toFixed(2)}.`);
        error.statusCode = 400;
        throw error;
      }
      if (payload.type === 'egreso') {
        if (payload.cashBoxType !== 'PETTY_CASH') {
          const error = new Error('Los gastos operativos deben registrarse desde Caja Chica.');
          error.statusCode = 400;
          throw error;
        }
        if (!activeSession) {
          const error = new Error('No existe una sesion vigente de Caja Chica.');
          error.statusCode = 400;
          throw error;
        }
        if (amountBs > pettyCashBalance) {
          const error = new Error(`Caja Chica no tiene saldo suficiente. Disponible: Bs ${pettyCashBalance.toFixed(2)}.`);
          error.statusCode = 400;
          throw error;
        }
      }

      if (payload.type === 'transferencia') {
        const transferGroupId = directId('trf');
        const receiptCode = nextDirectReceiptCode(state);
        const common = {
          ...payload,
          sessionId: activeSession?.id ?? null,
          sourceType: 'transferencia',
          sourceId: transferGroupId,
          category: payload.category || 'reposicion_caja_chica',
          receiptCode,
          accountingPeriodId: periodId,
        };
        const outMovement = {
          ...buildDirectMovement(state, {
            ...common,
            type: 'transferencia_salida_caja_chica',
            amountBs: -amountBs,
            cashBoxType: 'BIG_CASH',
          }),
          isInternalTransfer: true,
          transferGroupId,
          accountingPeriodId: periodId,
          accountingPeriodStatus: 'current',
        };
        const inMovement = {
          ...buildDirectMovement(state, {
            ...common,
            type: 'transferencia_entrada_caja_chica',
            amountBs,
            cashBoxType: 'PETTY_CASH',
            receiptCode,
          }),
          isInternalTransfer: true,
          transferGroupId,
          accountingPeriodId: periodId,
          accountingPeriodStatus: 'current',
        };
        state.cashMovements.push(outMovement, inMovement);
        responseData = {
          movement: outMovement,
          movements: [outMovement, inMovement],
          summary: summarizeDirectCashState(state),
        };
        return state;
      }

      const signedAmount = payload.type === 'egreso' ? -amountBs : amountBs;
      const movement = {
        ...buildDirectMovement(state, {
          ...payload,
          sessionId: payload.type === 'egreso' ? activeSession?.id ?? null : activeSession?.id ?? null,
          type: payload.type === 'egreso' ? 'egreso_manual' : 'ingreso_manual',
          amountBs: signedAmount,
          cashBoxType: payload.type === 'egreso' ? 'PETTY_CASH' : payload.cashBoxType,
        }),
        accountingPeriodId: periodId,
        accountingPeriodStatus: 'current',
      };
      state.cashMovements.push(movement);
      responseData = {
        movement,
        movements: [movement],
        summary: summarizeDirectCashState(state),
      };
      return state;
    });

    res.setHeader('Cache-Control', 'no-store');
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


const requireDeveloperCashAction = (payload = {}) => {
  const role = String(payload?.userRole ?? payload?.createdByRole ?? payload?.role ?? '')
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (role !== 'developer' && !role.includes('desarrollador')) {
    const error = new Error('Esta accion esta disponible solamente para Developer.');
    error.statusCode = 403;
    throw error;
  }
};

router.patch('/__copetin_db/cash/petty-expense/:movementId', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    requireDeveloperCashAction(payload);
    const movementId = String(req.params.movementId ?? '').trim();
    const amountBs = directMoney(payload.amountBs);
    if (!movementId) return res.status(400).json({ error: 'Movimiento no identificado.' });
    if (amountBs <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
    if (!String(payload.description ?? '').trim()) return res.status(400).json({ error: 'Debes escribir el concepto.' });

    let responseData = null;
    const result = await updateStateSnapshot((state) => {
      state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
      const movement = state.cashMovements.find((row) => String(row?.id ?? '') === movementId);
      if (!movement) { const error = new Error('Gasto de Caja Chica no encontrado.'); error.statusCode = 404; throw error; }
      if (isArchivedAccountingRecord(movement) || movement?.voidedAt || String(movement?.receiptStatus ?? '').toLowerCase() === 'anulado') {
        const error = new Error('No se puede editar un movimiento anulado o eliminado.'); error.statusCode = 409; throw error;
      }
      if (String(movement?.cashBoxType ?? '').toUpperCase() !== 'PETTY_CASH' || Number(movement?.amountBs ?? 0) >= 0 || movement?.isInternalTransfer) {
        const error = new Error('Solo se pueden editar gastos activos de Caja Chica.'); error.statusCode = 409; throw error;
      }
      const oldAmountBs = Math.abs(Number(movement.amountBs ?? 0));
      const availableIncludingCurrent = directMoney(getDirectCurrentCashBalance(state, 'PETTY_CASH') + oldAmountBs);
      if (amountBs > availableIncludingCurrent) {
        const error = new Error(`Caja Chica no tiene saldo suficiente. Maximo editable: Bs ${availableIncludingCurrent.toFixed(2)}.`);
        error.statusCode = 400;
        throw error;
      }
      const now = new Date().toISOString();
      const previousSnapshot = {
        amountBs: movement.amountBs, description: movement.description, category: movement.category,
        paymentMethod: movement.paymentMethod, paymentAccount: movement.paymentAccount,
        responsible: movement.responsible, receipt: movement.receipt, notes: movement.notes,
      };
      movement.amountBs = -amountBs;
      movement.description = String(payload.description ?? '').trim();
      movement.category = String(payload.category ?? movement.category ?? 'varios').trim();
      movement.paymentMethod = directPaymentMethod(payload.paymentMethod ?? movement.paymentMethod);
      movement.paymentAccount = directPaymentAccount(movement.paymentMethod, payload.paymentAccount ?? movement.paymentAccount);
      movement.responsible = String(payload.responsible ?? movement.responsible ?? '').trim();
      movement.receipt = String(payload.receipt ?? movement.receipt ?? '').trim();
      movement.notes = String(payload.notes ?? movement.notes ?? '').trim();
      movement.editedAt = now;
      movement.editedBy = String(payload.updatedBy ?? payload.createdBy ?? 'Developer').trim() || 'Developer';
      movement.editReason = String(payload.reason ?? 'Correccion de gasto desde Caja Chica.').trim();
      movement.editHistory = [
        ...(Array.isArray(movement.editHistory) ? movement.editHistory : []),
        { ...previousSnapshot, changedAt: now, changedBy: movement.editedBy, reason: movement.editReason },
      ];
      movement.updatedAt = now;
      responseData = { movement: structuredClone(movement), summary: summarizeDirectCashState(state) };
      return state;
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ...responseData, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});

router.delete('/__copetin_db/cash/petty-expense/:movementId', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    requireDeveloperCashAction(payload);
    const movementId = String(req.params.movementId ?? '').trim();
    const reason = String(payload.reason ?? '').trim();
    if (!movementId) return res.status(400).json({ error: 'Movimiento no identificado.' });
    if (!reason) return res.status(400).json({ error: 'Debes indicar el motivo de eliminacion.' });

    let responseData = null;
    const result = await updateStateSnapshot((state) => {
      state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
      const movement = state.cashMovements.find((row) => String(row?.id ?? '') === movementId);
      if (!movement) { const error = new Error('Gasto de Caja Chica no encontrado.'); error.statusCode = 404; throw error; }
      if (isArchivedAccountingRecord(movement)) {
        responseData = { movement: structuredClone(movement), summary: summarizeDirectCashState(state), duplicated: true };
        return state;
      }
      if (String(movement?.cashBoxType ?? '').toUpperCase() !== 'PETTY_CASH' || Number(movement?.amountBs ?? 0) >= 0 || movement?.isInternalTransfer) {
        const error = new Error('Solo se pueden eliminar gastos de Caja Chica.'); error.statusCode = 409; throw error;
      }
      const now = new Date().toISOString();
      movement.deletedAt = now;
      movement.deletedBy = String(payload.deletedBy ?? payload.createdBy ?? 'Developer').trim() || 'Developer';
      movement.deletionReason = reason;
      movement.updatedAt = now;
      responseData = { movement: structuredClone(movement), summary: summarizeDirectCashState(state) };
      return state;
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ...responseData, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});

router.post('/__copetin_db/cash/manual-economic-movement', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const requestedAmountBs = directMoney(payload.amountBs);
    if (requestedAmountBs <= 0) return res.status(400).json({ error: 'El monto del movimiento debe ser mayor a 0.' });
    if (!String(payload.description ?? '').trim()) return res.status(400).json({ error: 'Debes escribir una descripcion para el movimiento.' });
    const isGuaranteeRefund = isGuaranteeRefundMovement(payload);
    const paymentMethod = String(payload?.paymentMethod ?? '').trim().toLowerCase();
    if (isGuaranteeRefund && paymentMethod === 'qr' && !String(payload?.paymentAccount ?? '').trim()) {
      return res.status(400).json({ error: 'Debes seleccionar la cuenta QR usada para devolver la garantia.' });
    }

    let movement = null;
    let updatedRental = null;
    let reconciliation = null;
    const result = await updateStateSnapshot((state) => {
      state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
      state.rentals = Array.isArray(state.rentals) ? state.rentals : [];
      state.contracts = Array.isArray(state.contracts) ? state.contracts : [];
      const duplicate = findDirectOperation(state, payload.clientOperationId);
      if (duplicate) { movement = duplicate; return state; }

      let amountBs = requestedAmountBs;
      if (isGuaranteeRefund) {
        const rentalId = String(payload?.linkedRentalId ?? payload?.sourceId ?? '').trim();
        const contractId = String(payload?.linkedContractId ?? '').trim();
        const orderCode = String(payload?.linkedOrderCode ?? '').trim();
        const rental = state.rentals.find((row) => (
          (rentalId && String(row?.id ?? '') === rentalId)
          || (contractId && String(row?.contractId ?? '') === contractId)
          || (orderCode && String(row?.orderCode ?? '') === orderCode)
        ));
        if (!rental) {
          const error = new Error('No se encontro el alquiler vinculado a esta garantia.');
          error.statusCode = 404;
          throw error;
        }
        if (String(rental?.status ?? '').trim().toLowerCase() !== 'returned') {
          const error = new Error('La garantia solo puede devolverse cuando el material ya fue devuelto.');
          error.statusCode = 409;
          throw error;
        }
        const contract = state.contracts.find((row) => (
          String(row?.id ?? '') === String(rental?.contractId ?? '')
          || (contractId && String(row?.id ?? '') === contractId)
          || (String(row?.contractCode ?? '') && String(row?.contractCode ?? '') === String(rental?.contractCode ?? ''))
        )) ?? null;
        const linkedKeys = new Set([rental?.id, rental?.orderCode, rental?.contractCode, contract?.id, contract?.contractCode, contract?.orderCode]
          .map((value) => String(value ?? '').trim()).filter(Boolean));
        const matchesLinked = (row) => [row?.linkedRentalId, row?.sourceId, row?.linkedContractId, row?.linkedOrderCode, row?.contractCode, row?.orderCode]
          .map((value) => String(value ?? '').trim()).some((value) => value && linkedKeys.has(value));
        const previousRefund = state.cashMovements.find((row) => (
          !row?.voidedAt
          && !row?.deletedAt
          && isGuaranteeRefundMovement(row)
          && matchesLinked(row)
          && Math.abs(Number(row?.amountBs ?? 0)) > 0.009
        ));
        if (previousRefund) {
          const error = new Error(`La garantia de este contrato ya tiene una devolucion registrada${previousRefund?.receiptCode ? ` (${previousRefund.receiptCode})` : ''}.`);
          error.statusCode = 409;
          throw error;
        }

        const guaranteeIncomeBs = directMoney(state.cashMovements.reduce((sum, row) => {
          if (row?.voidedAt || row?.deletedAt || !matchesLinked(row)) return sum;
          const type = String(row?.type ?? '').trim().toLowerCase();
          const category = String(row?.category ?? '').trim().toLowerCase();
          const isIncome = type === 'ingreso_garantia' || category === 'garantia';
          return isIncome && Number(row?.amountBs ?? 0) > 0 ? sum + Number(row.amountBs) : sum;
        }, 0));
        const storedGuaranteeBs = directMoney(Math.max(
          Number(rental?.depositBs ?? 0),
          Number(rental?.guarantee?.validatedBs ?? 0),
          String(rental?.guarantee?.status ?? rental?.payment?.guaranteeStatus ?? '').trim().toLowerCase() === 'validado'
            ? Number(rental?.guaranteeDeclaredBs ?? rental?.guarantee?.amountBs ?? 0)
            : 0,
        ));
        const guaranteePaidBs = guaranteeIncomeBs > 0 ? guaranteeIncomeBs : storedGuaranteeBs;
        if (guaranteePaidBs <= 0) {
          const error = new Error('Esta garantia no tiene dinero recibido para devolver.');
          error.statusCode = 409;
          throw error;
        }

        const totalBs = directMoney(rental?.totals?.totalBs ?? contract?.totals?.totalBs);
        const prepaidAppliedBs = directMoney(rental?.payment?.prepaidAppliedBs ?? rental?.prepaidAppliedBs ?? contract?.payment?.prepaidAppliedBs ?? contract?.prepaidAppliedBs);
        const storedPaidBs = directMoney(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs ?? contract?.payment?.paidAtApprovalBs);
        const effectivePaidBs = storedPaidBs + 0.01 >= prepaidAppliedBs
          ? storedPaidBs
          : directMoney(storedPaidBs + prepaidAppliedBs);
        const outstandingRentalBs = directMoney(Math.max(0, totalBs - effectivePaidBs));
        const normalizeOwner = (value) => {
          const normalized = String(value ?? '').trim().toLowerCase();
          return ['transporte', 'lavado'].includes(normalized) ? normalized : 'cliente';
        };
        const penaltiesBs = directMoney((Array.isArray(rental?.returnReport) ? rental.returnReport : []).reduce((sum, line) => {
          if (normalizeOwner(line?.chargeOwner) !== 'cliente') return sum;
          return sum + directMoney(line?.penaltyBs ?? (directMoney(line?.damagedFeeBs) + directMoney(line?.missingFeeBs)));
        }, 0));
        const collectedDamageBs = directMoney(state.cashMovements.reduce((sum, row) => {
          if (row?.voidedAt || row?.deletedAt || !matchesLinked(row) || isGuaranteeRefundMovement(row)) return sum;
          const breakdown = Array.isArray(row?.collectionBreakdown) ? row.collectionBreakdown : [];
          const breakdownDamageBs = directMoney(breakdown
            .filter((entry) => String(entry?.target ?? '').trim().toLowerCase() === 'damage')
            .reduce((subtotal, entry) => subtotal + directMoney(entry?.amountBs), 0));
          if (breakdownDamageBs > 0) return sum + breakdownDamageBs;
          const storedDamageBs = directMoney(row?.damageCollectedBs);
          if (storedDamageBs > 0) return sum + storedDamageBs;
          const marker = [row?.collectionTarget, row?.category, row?.accountingTag, row?.type]
            .map((value) => String(value ?? '').trim().toLowerCase()).join(' ');
          return /(damage|dano|daño|faltante)/.test(marker) && Number(row?.amountBs ?? 0) > 0
            ? sum + Number(row.amountBs)
            : sum;
        }, 0));
        const pendingDamageBs = directMoney(Math.max(0, penaltiesBs - collectedDamageBs));
        const totalDiscountAgainstDepositBs = directMoney(outstandingRentalBs + pendingDamageBs);
        const discountCoveredByDepositBs = directMoney(Math.min(guaranteePaidBs, totalDiscountAgainstDepositBs));
        const pendingCollectionBs = directMoney(Math.max(0, totalDiscountAgainstDepositBs - guaranteePaidBs));
        const refundBs = directMoney(Math.max(0, guaranteePaidBs - discountCoveredByDepositBs));
        if (refundBs <= 0) {
          const error = new Error('No existe saldo de garantia para devolver despues de cubrir las obligaciones pendientes.');
          error.statusCode = 409;
          throw error;
        }

        amountBs = refundBs;
        rental.refundBs = refundBs;
        rental.returnSettlement = {
          ...(rental.returnSettlement ?? {}),
          outstandingRentalBs,
          penaltiesBs,
          totalDiscountAgainstDepositBs,
          discountCoveredByDepositBs,
          pendingCollectionBs,
          refundBs,
          guaranteeReconciledAt: new Date().toISOString(),
          guaranteeReconciledBy: String(payload?.createdBy ?? payload?.responsible ?? 'Sistema').trim() || 'Sistema',
        };
        rental.updatedAt = new Date().toISOString();
        updatedRental = structuredClone(rental);
        reconciliation = { guaranteePaidBs, outstandingRentalBs, penaltiesBs, collectedDamageBs, pendingDamageBs, discountCoveredByDepositBs, pendingCollectionBs, refundBs };
      }

      movement = buildDirectMovement(state, {
        ...payload,
        type: payload.type === 'egreso' ? 'egreso_manual' : 'ingreso_manual',
        amountBs: payload.type === 'egreso' ? -amountBs : amountBs,
        receivedAmountBs: payload.type === 'egreso' ? 0 : amountBs,
      });
      if (isGuaranteeRefund && reconciliation) {
        movement.guaranteePaidBs = reconciliation.guaranteePaidBs;
        movement.guaranteeAppliedBs = reconciliation.discountCoveredByDepositBs;
        movement.guaranteeRefundBs = reconciliation.refundBs;
        movement.receiptDetail = String(payload?.receiptDetail ?? '').trim()
          || `Garantia pagada Bs ${reconciliation.guaranteePaidBs.toFixed(2)} | Aplicado Bs ${reconciliation.discountCoveredByDepositBs.toFixed(2)} | Devuelto Bs ${reconciliation.refundBs.toFixed(2)}`;
      }
      state.cashMovements.push(movement);
      return state;
    });
    res.json({ ok: true, movement, rental: updatedRental, reconciliation, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});

router.post('/__copetin_db/cash/update-receipt-metadata', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const movementId = String(payload.movementId ?? payload.id ?? '').trim();
    const receiptCode = String(payload.receiptCode ?? '').trim().slice(0, 80);
    const receiptDetail = String(payload.receiptDetail ?? payload.description ?? '').trim().slice(0, 2400);
    const receiptCustomerName = String(payload.receiptCustomerName ?? payload.customerName ?? '').trim().slice(0, 240);
    const notes = String(payload.notes ?? '').trim().slice(0, 2400);
    const editorName = String(payload.editedByName ?? payload.userName ?? 'Sistema').trim().slice(0, 180) || 'Sistema';
    const receiptIssuedAtDate = new Date(payload.receiptIssuedAt ?? payload.createdAt ?? '');

    if (!movementId) return res.status(400).json({ error: 'Debes indicar el movimiento del recibo.' });
    if (!receiptCode) return res.status(400).json({ error: 'Debes escribir el numero del recibo.' });
    if (!receiptDetail) return res.status(400).json({ error: 'Debes escribir el detalle del recibo.' });
    if (!receiptCustomerName) return res.status(400).json({ error: 'Debes escribir el nombre del cliente.' });
    if (Number.isNaN(receiptIssuedAtDate.getTime())) return res.status(400).json({ error: 'La fecha y hora del recibo no son validas.' });

    let updatedMovement = null;
    let updatedContract = null;
    const result = await updateStateSnapshot((state) => {
      state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
      const movement = state.cashMovements.find((entry) => String(entry?.id ?? '') === movementId);
      if (!movement) {
        const error = new Error('No se encontro el movimiento asociado al recibo.');
        error.statusCode = 404;
        throw error;
      }
      if (String(movement?.receiptStatus ?? '').toLowerCase() === 'anulado' || movement?.voidedAt) {
        const error = new Error('No se puede editar un recibo anulado.');
        error.statusCode = 409;
        throw error;
      }

      const now = new Date().toISOString();
      const previousMetadata = {
        receiptCode: String(movement.receiptCode ?? movement.receipt ?? '').trim(),
        receiptDetail: String(movement.receiptDetail ?? movement.description ?? '').trim(),
        receiptCustomerName: String(movement.receiptCustomerName ?? movement.customerName ?? '').trim(),
        description: String(movement.description ?? '').trim(),
        notes: String(movement.notes ?? '').trim(),
        paymentMethod: String(movement.paymentMethod ?? '').trim(),
        paymentAccount: String(movement.paymentAccount ?? '').trim(),
        createdAt: movement.createdAt ?? null,
        receiptIssuedAt: movement.receiptIssuedAt ?? movement.createdAt ?? null,
        editedAt: now,
        editedByName: editorName,
      };
      if (!movement.receiptOriginalMetadata) movement.receiptOriginalMetadata = structuredClone(previousMetadata);
      movement.receiptEditHistory = [
        ...(Array.isArray(movement.receiptEditHistory) ? movement.receiptEditHistory : []),
        previousMetadata,
      ].slice(-25);
      movement.receiptCode = receiptCode;
      movement.receiptDetail = receiptDetail;
      movement.description = receiptDetail.split('\n').filter(Boolean).slice(0, 2).join(' | ') || receiptDetail;
      movement.receiptCustomerName = receiptCustomerName;
      movement.customerName = receiptCustomerName;
      movement.notes = notes;
      movement.receiptIssuedAt = receiptIssuedAtDate.toISOString();
      movement.paymentMethod = directPaymentMethod(payload.paymentMethod ?? movement.paymentMethod);
      movement.paymentAccount = directPaymentAccount(movement.paymentMethod, payload.paymentAccount ?? movement.paymentAccount);
      movement.updatedAt = now;
      movement.receiptEditedAt = now;
      movement.receiptEditedByName = editorName;

      state.contracts = Array.isArray(state.contracts) ? state.contracts : [];
      state.contracts.forEach((contract) => {
        let touched = false;
        contract.economicLedger = (Array.isArray(contract.economicLedger) ? contract.economicLedger : []).map((entry) => {
          if (String(entry?.cashMovementId ?? '') !== movementId) return entry;
          touched = true;
          return {
            ...entry,
            cashReceiptCode: receiptCode,
            createdAt: movement.receiptIssuedAt,
            receiptIssuedAt: movement.receiptIssuedAt,
            editedAt: now,
            editedByName: editorName,
          };
        });
        if (touched) {
          contract.economicLedgerUpdatedAt = now;
          contract.economicLedgerUpdatedByName = editorName;
          contract.updatedAt = now;
          updatedContract = structuredClone(contract);
        }
      });

      state.generatedReports = Array.isArray(state.generatedReports) ? state.generatedReports : [];
      state.generatedReports.forEach((report) => {
        const reportMovementId = String(
          report?.cashMovementId
          ?? (report?.sourceType === 'cashMovement' ? report?.sourceId : '')
          ?? '',
        ).trim();
        if (reportMovementId !== movementId) return;
        report.receiptCode = receiptCode;
        report.receiptIssuedAt = movement.receiptIssuedAt;
        report.updatedAt = now;
      });

      updatedMovement = structuredClone(movement);
      return state;
    });

    res.json({
      ok: true,
      movement: updatedMovement,
      contract: updatedContract,
      revision: result.revision,
      version: result.version,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});



router.post('/__copetin_db/accounting/reset-preview', requireInternalKey, async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const currentUser = assertDeveloperDatabaseAccess(snapshot?.state ?? {}, {
      code: req.body?.code,
      userId: req.body?.userId,
    });
    const analysis = buildAccountingResetAnalysis(snapshot?.state ?? {});
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      user: {
        id: currentUser.id,
        fullName: currentUser.fullName,
        role: getUserDisplayRole(currentUser),
      },
      analysis,
      revision: snapshot?.revision ?? null,
      updatedAt: snapshot?.updatedAt ?? null,
    });
  } catch (error) {
    if (error?.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.post('/__copetin_db/accounting/reset', requireInternalKey, async (req, res, next) => {
  try {
    const confirmation = String(req.body?.confirmation ?? '').trim().toUpperCase();
    if (!['CONFIRMAR', 'RESET'].includes(confirmation)) {
      res.status(400).json({ error: 'Debes escribir CONFIRMAR o RESET para iniciar el nuevo periodo contable.' });
      return;
    }

    const snapshot = await getStateSnapshot();
    const currentUser = assertDeveloperDatabaseAccess(snapshot?.state ?? {}, {
      code: req.body?.code,
      userId: req.body?.userId,
    });
    const backup = await writeAccountingResetBackup({ snapshot, currentUser });
    const now = new Date().toISOString();
    const periodId = `accounting-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    let responseData = null;

    const result = await updateStateSnapshot((state) => {
      state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
      state.cashSessions = Array.isArray(state.cashSessions) ? state.cashSessions : [];
      state.cashDebts = Array.isArray(state.cashDebts) ? state.cashDebts : [];
      state.resetLogs = Array.isArray(state.resetLogs) ? state.resetLogs : [];
      state.systemAuditLog = Array.isArray(state.systemAuditLog) ? state.systemAuditLog : [];

      const analysis = buildAccountingResetAnalysis(state);
      let archivedMovements = 0;
      let archivedSessions = 0;
      let archivedDebts = 0;

      state.cashMovements = state.cashMovements.map((movement) => {
        if (isArchivedAccountingRecord(movement)) return movement;
        archivedMovements += 1;
        return {
          ...movement,
          accountingArchivedAt: now,
          accountingArchivedById: currentUser.id,
          accountingArchivedByName: currentUser.fullName,
          accountingPeriodStatus: 'archived',
        };
      });

      state.cashSessions = state.cashSessions.map((session) => {
        if (isArchivedAccountingRecord(session)) return session;
        archivedSessions += 1;
        return {
          ...session,
          status: String(session?.status ?? '').toLowerCase() === 'open' ? 'closed' : session.status,
          closedAt: session.closedAt ?? now,
          closedBy: session.closedBy ?? currentUser.fullName,
          closeNotes: [session.closeNotes, 'Periodo cerrado por reinicio contable seguro.']
            .map((value) => String(value ?? '').trim())
            .filter(Boolean)
            .join(' | '),
          accountingArchivedAt: now,
          accountingArchivedById: currentUser.id,
          accountingArchivedByName: currentUser.fullName,
          accountingPeriodStatus: 'archived',
        };
      });

      state.cashDebts = state.cashDebts.map((debt) => {
        if (isArchivedAccountingRecord(debt)) return debt;
        archivedDebts += 1;
        return {
          ...debt,
          accountingArchivedAt: now,
          accountingArchivedById: currentUser.id,
          accountingArchivedByName: currentUser.fullName,
          accountingPeriodStatus: 'archived',
        };
      });

      const newSession = {
        id: `cash-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        status: 'open',
        openingAmountBs: 0,
        openingBigCashBs: 0,
        openingPettyCashBs: 0,
        openedBy: currentUser.fullName,
        openedAt: now,
        openNotes: 'Nuevo periodo contable iniciado en Bs 0,00.',
        accountingPeriodId: periodId,
        accountingPeriodStatus: 'current',
        treasuryAccounts: [],
        treasuryUpdatedAt: null,
        treasuryUpdatedBy: '',
      };
      state.cashSessions.push(newSession);

      state.settings = {
        ...(state.settings ?? {}),
        accounting: {
          ...(state.settings?.accounting ?? {}),
          currentPeriodId: periodId,
          resetAt: now,
          resetById: currentUser.id,
          resetByName: currentUser.fullName,
          previousPeriodBackup: backup.filename,
        },
      };

      const resetLog = {
        id: `rst-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        userId: currentUser.id,
        userName: currentUser.fullName,
        userRole: getUserDisplayRole(currentUser),
        action: 'accounting_period_reset',
        modules: ['cash_accounting'],
        summary: {
          total: archivedMovements + archivedSessions + archivedDebts,
          archivedMovements,
          archivedSessions,
          archivedDebts,
          bigCashBs: 0,
          pettyCashBs: 0,
        },
        result: 'success',
        errors: [],
        observations: String(req.body?.observations ?? '').trim(),
        backupFile: backup.filename,
        ip: req.ip,
        createdAt: now,
      };
      state.resetLogs.unshift(resetLog);
      state.systemAuditLog.unshift({
        id: `audit-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        type: 'accounting_period_reset',
        action: 'Nuevo periodo de Caja Grande y Caja Chica',
        entityType: 'accounting',
        entityId: periodId,
        detail: `Se archivaron ${archivedMovements} movimientos, ${archivedSessions} sesiones y ${archivedDebts} deudas. Contratos y recibos conservados.`,
        userId: currentUser.id,
        userName: currentUser.fullName,
        createdAt: now,
      });

      responseData = {
        analysis,
        log: resetLog,
        period: state.settings.accounting,
        cashSessions: [newSession],
        cashMovements: [],
        cashDebts: [],
        summary: {
          bigCashBs: 0,
          pettyCashBs: 0,
          archivedMovements,
          archivedSessions,
          archivedDebts,
        },
        backup: { filename: backup.filename },
      };
      return state;
    });

    res.setHeader('Cache-Control', 'no-store');
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
      const matchingContracts = state.contracts.filter((entry) => [
        entry?.id,
        entry?.contractCode,
        entry?.number,
        entry?.orderCode,
        entry?.rentalId,
      ].some((value) => normalizeStrictEconomicKey(value) === requestedKey));
      const contract = matchingContracts.find((entry) => !entry?.deletedAt)
        ?? matchingContracts[0]
        ?? null;

      if (!contract) {
        const error = new Error('Contrato no encontrado para ejecutar el Reset economico.');
        error.statusCode = 404;
        throw error;
      }

      const preliminaryOrder = resolveServiceOrderForContract(state.serviceOrders, contract);
      const rental = resolveActiveRentalForContract(state.rentals, contract, preliminaryOrder);
      const serviceOrder = resolveServiceOrderForContract(state.serviceOrders, contract, rental)
        ?? preliminaryOrder;
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
      // Los daños/faltantes físicos se conservan, pero el Reset económico debe
      // quitar cualquier marca de cobro, aplicación a garantía o liquidación.
      const returnReportRows = Array.isArray(rental?.returnReport) ? rental.returnReport : [];
      const reportPenaltiesBs = directMoney(returnReportRows.reduce((sum, line) => (
        sum + directMoney(line?.penaltyBs ?? (
          directMoney(line?.damagedFeeBs) + directMoney(line?.missingFeeBs)
        ))
      ), 0));
      const penaltiesBs = reportPenaltiesBs > 0
        ? reportPenaltiesBs
        : directMoney(rental?.returnSettlement?.penaltiesBs ?? rental?.penaltiesBs ?? 0);
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
        initialPaymentMethod: seed.paymentMethod,
        initialPaymentAccount: seed.paymentAccount,
        guaranteeStatus: seed.guaranteeStatus || contract?.payment?.guaranteeStatus || 'no_validado',
        guaranteePaymentMethod: seed.guaranteeMethod,
        guaranteePaymentAccount: seed.guaranteeAccount,
      };
      contract.guarantee = {
        ...(contract.guarantee ?? {}),
        amountBs: seed.guaranteeDeclaredBs,
        validatedBs: seed.guaranteePaidBs,
        status: seed.guaranteeStatus || 'no_validado',
        paymentMethod: seed.guaranteeMethod,
        paymentAccount: seed.guaranteeAccount,
        method: seed.guaranteeMethod,
        account: seed.guaranteeAccount,
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
          damageCollectedBs: 0,
          penaltiesCollectedBs: 0,
          returnChargesCollectedBs: 0,
          status: paymentStatus,
          mode: paymentStatus,
          initialPaymentMethod: seed.paymentMethod,
          initialPaymentAccount: seed.paymentAccount,
          guaranteeStatus: seed.guaranteeStatus || rental?.payment?.guaranteeStatus || 'no_validado',
          guaranteePaymentMethod: seed.guaranteeMethod,
          guaranteePaymentAccount: seed.guaranteeAccount,
        };
        rental.totals = {
          ...(rental.totals ?? {}),
          paidAtRentalBs: seed.initialPaymentBs,
          paidAtApprovalBs: seed.initialPaymentBs,
          pendingPaymentBs: outstandingRentalBs,
          damageCollectedBs: 0,
          penaltiesCollectedBs: 0,
          returnChargesCollectedBs: 0,
        };
        rental.depositBs = seed.guaranteePaidBs;
        rental.guaranteeDeclaredBs = seed.guaranteeDeclaredBs;
        rental.guarantee = {
          ...(rental.guarantee ?? {}),
          amountBs: seed.guaranteeDeclaredBs,
          validatedBs: seed.guaranteePaidBs,
          status: seed.guaranteeStatus || 'no_validado',
          paymentMethod: seed.guaranteeMethod,
          paymentAccount: seed.guaranteeAccount,
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
            damageCollectedBs: 0,
            penaltiesCollectedBs: 0,
            collectedAfterReturnBs: 0,
            discountCoveredByDepositBs: 0,
            totalDiscountAgainstDepositBs: 0,
            refundBs: seed.guaranteePaidBs,
            accountingStatus: pendingCollectionBs <= 0.009 ? 'liquidado' : 'saldo_pendiente',
            settledAt: null,
            collectedAt: null,
            collectedBy: null,
            economicResetAt: now,
          };

          // Mantener intacto qué producto se dañó/faltó, cantidades, notas y
          // montos calculados; limpiar solamente su estado económico.
          rental.returnReport = returnReportRows.map((line) => ({
            ...line,
            chargedBs: 0,
            paidBs: 0,
            collectedBs: 0,
            appliedToGuaranteeBs: 0,
            guaranteeAppliedBs: 0,
            isPaid: false,
            isCollected: false,
            chargeStatus: 'pending',
            paymentStatus: 'pending',
            accountingStatus: 'pending',
            cashMovementId: null,
            receiptCode: '',
            paidAt: null,
            collectedAt: null,
            settledAt: null,
            economicResetAt: now,
          }));
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



const findContractIndexForNoteMutation = (contracts, requestedId) => {
  const cleanId = String(requestedId ?? '').trim();
  if (!cleanId) return -1;
  const exactIdIndex = contracts.findIndex((contract) => String(contract?.id ?? '') === cleanId);
  if (exactIdIndex >= 0) return exactIdIndex;
  const activeCodeIndex = contracts.findIndex((contract) => (
    !contract?.deletedAt
    && (
      String(contract?.contractCode ?? '') === cleanId
      || String(contract?.number ?? '') === cleanId
    )
  ));
  if (activeCodeIndex >= 0) return activeCodeIndex;
  return contracts.findIndex((contract) => (
    String(contract?.contractCode ?? '') === cleanId
    || String(contract?.number ?? '') === cleanId
  ));
};

const getContractNoteActor = (body = {}) => ({
  userId: body.updatedById ?? body.userId ?? null,
  userName: String(body.updatedByName ?? body.userName ?? 'Sistema').trim() || 'Sistema',
  userRole: String(body.updatedByRole ?? body.userRole ?? 'Sistema').trim() || 'Sistema',
});

const validateContractNoteText = (value) => {
  const note = String(value ?? '').trim();
  if (!note) {
    const error = new Error('La nota no puede estar vacia.');
    error.statusCode = 400;
    throw error;
  }
  if (note.length > 2000) {
    const error = new Error('La nota no puede superar los 2000 caracteres.');
    error.statusCode = 400;
    throw error;
  }
  return note;
};

const appendContractNoteAudit = (state, {
  action,
  contract,
  note,
  actor,
  now,
}) => {
  state.systemAuditLog = Array.isArray(state.systemAuditLog) ? state.systemAuditLog : [];
  const actionMeta = {
    create: {
      type: 'contract_note_created',
      action: 'crear_nota_contrato',
      detail: 'Nota interna registrada desde Cotizaciones y Contratos.',
    },
    update: {
      type: 'contract_note_updated',
      action: 'editar_nota_contrato',
      detail: 'Nota interna editada desde Cotizaciones y Contratos.',
    },
    delete: {
      type: 'contract_note_deleted',
      action: 'eliminar_nota_contrato',
      detail: 'Nota interna eliminada desde Cotizaciones y Contratos.',
    },
  }[action] ?? {
    type: 'contract_note_updated',
    action: 'actualizar_nota_contrato',
    detail: 'Nota interna actualizada desde Cotizaciones y Contratos.',
  };

  state.systemAuditLog.unshift({
    id: `audit-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    type: actionMeta.type,
    action: actionMeta.action,
    entityType: 'contract',
    entityId: contract.id,
    entityCode: contract.contractCode ?? '',
    detail: actionMeta.detail,
    noteId: note?.id ?? null,
    userId: actor.userId,
    userName: actor.userName,
    userRole: actor.userRole,
    createdAt: now,
  });
};

const mutateContractInternalNote = async ({
  requestedId,
  revision,
  action,
  noteId = '',
  noteText = '',
  actor,
}) => {
  let responseContract = null;
  let responseRental = null;
  let responseNote = null;

  const result = await updateStateSnapshot((state) => {
    const contracts = Array.isArray(state.contracts) ? state.contracts : [];
    const contractIndex = findContractIndexForNoteMutation(contracts, requestedId);
    if (contractIndex < 0) {
      const error = new Error('Contrato no encontrado para guardar la nota.');
      error.statusCode = 404;
      throw error;
    }

    const now = new Date().toISOString();
    const existingContract = contracts[contractIndex];
    const ledger = normalizeEconomicLedgerRows(existingContract?.economicLedger);
    let targetNote = null;

    if (action === 'create') {
      const createdNote = normalizeEconomicLedgerRows([{
        id: makeEconomicLedgerId(),
        type: 'note',
        note: validateContractNoteText(noteText),
        createdAt: now,
        createdById: actor.userId,
        createdByName: actor.userName,
      }])[0];
      ledger.push(createdNote);
      targetNote = createdNote;
    } else {
      const cleanNoteId = String(noteId ?? '').trim();
      if (!cleanNoteId) {
        const error = new Error('Debes indicar la nota.');
        error.statusCode = 400;
        throw error;
      }
      targetNote = ledger.find((entry) => (
        String(entry?.id ?? '') === cleanNoteId
        && entry.type === 'note'
        && !entry.deletedAt
      ));
      if (!targetNote) {
        const error = new Error('La nota ya no existe o fue eliminada.');
        error.statusCode = 404;
        throw error;
      }

      if (action === 'update') {
        targetNote.note = validateContractNoteText(noteText);
        targetNote.editedAt = now;
        targetNote.editedByName = actor.userName;
        targetNote.createdById = targetNote.createdById ?? actor.userId;
        targetNote.createdByName = targetNote.createdByName || actor.userName;
      } else if (action === 'delete') {
        targetNote.deletedAt = now;
        targetNote.deletedById = actor.userId;
        targetNote.deletedByName = actor.userName;
        targetNote.deletionReason = 'Eliminada desde Cotizaciones y Contratos';
      }
    }

    const updatedContract = {
      ...existingContract,
      economicLedger: ledger,
      economicLedgerUpdatedAt: now,
      economicLedgerUpdatedById: actor.userId,
      economicLedgerUpdatedByName: actor.userName,
      updatedAt: now,
    };
    contracts[contractIndex] = updatedContract;

    const rentals = Array.isArray(state.rentals) ? state.rentals : [];
    const referenceKeys = new Set([
      updatedContract.id,
      updatedContract.rentalId,
      updatedContract.contractCode,
      updatedContract.orderCode,
    ].map((value) => String(value ?? '').trim()).filter(Boolean));
    const linkedRental = rentals.find((rental) => [
      rental?.id,
      rental?.rentalId,
      rental?.contractId,
      rental?.contractCode,
      rental?.orderCode,
    ].some((value) => referenceKeys.has(String(value ?? '').trim()))) ?? null;

    appendContractNoteAudit(state, {
      action,
      contract: updatedContract,
      note: targetNote,
      actor,
      now,
    });

    responseContract = summarizeContract(structuredClone(updatedContract));
    responseRental = linkedRental ? summarizeRental(structuredClone(linkedRental)) : null;
    responseNote = targetNote ? structuredClone(targetNote) : null;
    return state;
  }, revision);

  return {
    result,
    contract: responseContract,
    rental: responseRental,
    note: responseNote,
  };
};

const sendContractNoteMutation = (res, mutation) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({
    ok: true,
    contract: mutation.contract,
    ...(mutation.rental ? { rental: mutation.rental } : {}),
    note: mutation.note,
    revision: mutation.result.revision,
    version: mutation.result.version,
    updatedAt: mutation.result.updatedAt,
  });
};

router.post('/__copetin_db/contracts/:id/notes', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'La solicitud debe enviarse como objeto JSON.' });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(req.body, 'revision')) {
      res.status(400).json({ error: 'Debes enviar la revision actual para guardar la nota.' });
      return;
    }

    const requestedId = String(req.params.id ?? '').trim();
    if (!requestedId) {
      res.status(400).json({ error: 'Debes indicar el contrato.' });
      return;
    }

    const mutation = await mutateContractInternalNote({
      requestedId,
      revision: req.body.revision,
      action: 'create',
      noteText: req.body.note,
      actor: getContractNoteActor(req.body),
    });
    sendContractNoteMutation(res, mutation);
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

router.patch('/__copetin_db/contracts/:id/notes/:noteId', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'La solicitud debe enviarse como objeto JSON.' });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(req.body, 'revision')) {
      res.status(400).json({ error: 'Debes enviar la revision actual para editar la nota.' });
      return;
    }

    const requestedId = String(req.params.id ?? '').trim();
    const noteId = String(req.params.noteId ?? '').trim();
    if (!requestedId || !noteId) {
      res.status(400).json({ error: 'Debes indicar el contrato y la nota.' });
      return;
    }

    const mutation = await mutateContractInternalNote({
      requestedId,
      revision: req.body.revision,
      action: 'update',
      noteId,
      noteText: req.body.note,
      actor: getContractNoteActor(req.body),
    });
    sendContractNoteMutation(res, mutation);
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

router.delete('/__copetin_db/contracts/:id/notes/:noteId', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'La solicitud debe enviarse como objeto JSON.' });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(req.body, 'revision')) {
      res.status(400).json({ error: 'Debes enviar la revision actual para eliminar la nota.' });
      return;
    }

    const requestedId = String(req.params.id ?? '').trim();
    const noteId = String(req.params.noteId ?? '').trim();
    if (!requestedId || !noteId) {
      res.status(400).json({ error: 'Debes indicar el contrato y la nota.' });
      return;
    }

    const mutation = await mutateContractInternalNote({
      requestedId,
      revision: req.body.revision,
      action: 'delete',
      noteId,
      actor: getContractNoteActor(req.body),
    });
    sendContractNoteMutation(res, mutation);
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

// Compatibilidad con clientes antiguos: PUT conserva la semántica anterior.
// Con noteId edita esa nota; sin noteId crea una nota nueva en vez de sobrescribir
// silenciosamente la última.
router.put('/__copetin_db/contracts/:id/note', async (req, res, next) => {
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

    const requestedNoteId = String(req.body.noteId ?? '').trim();
    const snapshot = await getStateSnapshot();
    const mutation = await mutateContractInternalNote({
      requestedId,
      revision: Object.prototype.hasOwnProperty.call(req.body, 'revision')
        ? req.body.revision
        : snapshot.revision,
      action: requestedNoteId ? 'update' : 'create',
      noteId: requestedNoteId,
      noteText: req.body.note,
      actor: getContractNoteActor(req.body),
    });
    sendContractNoteMutation(res, mutation);
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

router.patch('/__copetin_db/contracts/:id/finalized', async (req, res, next) => {
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
    if (!Object.prototype.hasOwnProperty.call(req.body, 'isFinalized')) {
      res.status(400).json({ error: 'Debes indicar el estado finalizado.' });
      return;
    }

    const nextFinalized = Boolean(req.body.isFinalized);
    const actor = getContractNoteActor(req.body);
    let responseContract = null;
    const result = await updateStateSnapshot((state) => {
      const contracts = Array.isArray(state.contracts) ? state.contracts : [];
      const contractIndex = findContractIndexForNoteMutation(contracts, requestedId);
      if (contractIndex < 0) {
        const error = new Error('Contrato no encontrado para actualizar su finalizacion.');
        error.statusCode = 404;
        throw error;
      }

      const now = new Date().toISOString();
      const existingContract = contracts[contractIndex];
      const updatedContract = {
        ...existingContract,
        isFinalized: nextFinalized,
        finalizedAt: nextFinalized
          ? (req.body.finalizedAt ?? existingContract.finalizedAt ?? now)
          : null,
        finalizedById: nextFinalized ? actor.userId : null,
        finalizedByName: nextFinalized ? actor.userName : '',
        finalizedByRole: nextFinalized ? actor.userRole : '',
        updatedAt: now,
      };

      const changed = Boolean(existingContract.isFinalized) !== nextFinalized;
      if (changed) {
        const changeText = nextFinalized
          ? 'Contrato marcado como finalizado'
          : 'Contrato desmarcado como finalizado';
        updatedContract.revisionHistory = Array.isArray(existingContract.revisionHistory)
          ? [...existingContract.revisionHistory]
          : [];
        updatedContract.revisionHistory.push({
          id: `rev-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
          updatedAt: now,
          updatedById: actor.userId,
          updatedByName: actor.userName,
          updatedByRole: actor.userRole,
          changes: [changeText],
        });

        state.systemAuditLog = Array.isArray(state.systemAuditLog) ? state.systemAuditLog : [];
        state.systemAuditLog.unshift({
          id: `audit-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
          type: 'contract_updated',
          action: 'actualizar_contrato',
          module: 'Contratos',
          entityType: 'contract',
          entityId: updatedContract.id,
          entityCode: updatedContract.contractCode ?? '',
          title: `${nextFinalized ? 'Finalizo' : 'Reabrio'} contrato ${updatedContract.contractCode ?? ''}`.trim(),
          detail: updatedContract.customerName ?? '',
          changes: [changeText],
          userId: actor.userId,
          userName: actor.userName,
          userRole: actor.userRole,
          createdAt: now,
        });
      }

      contracts[contractIndex] = updatedContract;
      responseContract = {
        id: updatedContract.id,
        contractCode: updatedContract.contractCode ?? '',
        orderCode: updatedContract.orderCode ?? '',
        isFinalized: updatedContract.isFinalized,
        finalizedAt: updatedContract.finalizedAt,
        finalizedById: updatedContract.finalizedById,
        finalizedByName: updatedContract.finalizedByName,
        finalizedByRole: updatedContract.finalizedByRole,
        updatedAt: updatedContract.updatedAt,
      };
      return state;
    });

    if (!result.initialized) {
      res.status(404).json({ error: 'La base de datos aun no esta inicializada.' });
      return;
    }

    res.set('Cache-Control', 'private, no-store');
    res.json({
      ok: true,
      contract: responseContract,
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
      const exactIdIndex = contracts.findIndex((contract) =>
        String(contract?.id ?? '') === requestedId
      );
      const activeCodeIndex = contracts.findIndex((contract) =>
        !contract?.deletedAt
        && (
          String(contract?.contractCode ?? '') === requestedId
          || String(contract?.number ?? '') === requestedId
        )
      );
      const fallbackCodeIndex = contracts.findIndex((contract) =>
        String(contract?.contractCode ?? '') === requestedId
        || String(contract?.number ?? '') === requestedId
      );
      const contractIndex = exactIdIndex >= 0
        ? exactIdIndex
        : activeCodeIndex >= 0
          ? activeCodeIndex
          : fallbackCodeIndex;

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
            const mergedEntry = {
              ...(previous ?? {}),
              ...normalizedEntry,
              deletedAt: null,
              deletedById: null,
              deletedByName: '',
              deletionReason: '',
              editedAt: previous ? (normalizedEntry.editedAt || now) : normalizedEntry.editedAt,
            };
            ledgerById.set(String(normalizedEntry.id), mergedEntry);

            // Una linea del cuaderno con recibo representa el mismo movimiento
            // de Caja Grande. Al editar su fecha, ambas vistas y el PDF del
            // recibo deben leer exactamente la misma marca de tiempo.
            const linkedCashMovementId = String(
              mergedEntry.cashMovementId
              ?? previous?.cashMovementId
              ?? '',
            ).trim();
            if (linkedCashMovementId && mergedEntry.createdAt) {
              state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
              const linkedMovement = state.cashMovements.find((movement) =>
                String(movement?.id ?? '') === linkedCashMovementId
              );
              if (linkedMovement) {
                linkedMovement.createdAt = mergedEntry.createdAt;
                linkedMovement.receiptIssuedAt = mergedEntry.createdAt;
                linkedMovement.updatedAt = now;
                linkedMovement.editedAt = now;
                linkedMovement.editedById = req.body.updatedById ?? req.body.userId ?? null;
                linkedMovement.editedByName = String(
                  req.body.updatedByName
                  ?? req.body.userName
                  ?? 'Sistema',
                ).trim() || 'Sistema';

                state.generatedReports = Array.isArray(state.generatedReports) ? state.generatedReports : [];
                state.generatedReports.forEach((report) => {
                  const reportMovementId = String(
                    report?.cashMovementId
                    ?? (report?.sourceType === 'cashMovement' ? report?.sourceId : '')
                    ?? '',
                  ).trim();
                  if (reportMovementId !== linkedCashMovementId) return;
                  report.generatedAt = mergedEntry.createdAt;
                  report.createdAt = mergedEntry.createdAt;
                  report.receiptIssuedAt = mergedEntry.createdAt;
                  report.updatedAt = now;
                });
              }
            }
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

      const existingRefundIds = new Set(existingLedger
        .filter((entry) => entry.type === 'refund')
        .map((entry) => String(entry.id)));
      const unsupportedRefund = savedLedger.find((entry) => (
        !entry.deletedAt
        && entry.type === 'refund'
        && !existingRefundIds.has(String(entry.id))
        && !entry.isCashRegistered
        && !String(entry.cashMovementId ?? '').trim()
        && !String(entry.cashReceiptCode ?? '').trim()
      ));
      if (unsupportedRefund) {
        const error = new Error('Las devoluciones deben registrarse desde "Devolver dinero" para generar el egreso y recibo de Caja Grande.');
        error.statusCode = 409;
        throw error;
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


const normalizeAccountingMethod = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.includes('qr')) return 'qr';
  if (normalized.includes('transfer')) return 'transferencia';
  if (normalized.includes('efect')) return 'efectivo';
  return normalized || 'sin_metodo';
};

const getAccountingAccountDescriptor = (paymentMethod, paymentAccount) => {
  const method = normalizeAccountingMethod(paymentMethod);
  const account = ['qr', 'transferencia'].includes(method)
    ? String(paymentAccount ?? '').trim().toUpperCase() || 'SIN CUENTA'
    : '';
  const key = `${method}:${account}`;
  const methodLabel = method === 'efectivo'
    ? 'Efectivo'
    : method === 'qr'
      ? 'QR'
      : method === 'transferencia'
        ? 'Transferencia'
        : 'Sin método';
  return {
    key,
    method,
    account,
    label: account ? `${methodLabel} · ${account}` : methodLabel,
  };
};

const accountingDateKey = (value) => {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(value ?? '');
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

router.get('/__copetin_db/accounting/accounts-ledger', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    const accountKey = String(req.query?.accountKey ?? 'all').trim();
    const dateFrom = String(req.query?.dateFrom ?? '').trim();
    const dateTo = String(req.query?.dateTo ?? '').trim();
    const query = String(req.query?.query ?? '').trim().toLowerCase();
    const limit = Math.min(1000, Math.max(20, Number(req.query?.limit ?? 600) || 600));

    const contracts = Array.isArray(state.contracts) ? state.contracts : [];
    const contractById = new Map(contracts.map((contract) => [String(contract?.id ?? ''), contract]));
    const rentals = Array.isArray(state.rentals) ? state.rentals : [];
    const rentalById = new Map(rentals.map((rental) => [String(rental?.id ?? ''), rental]));

    const allRows = (Array.isArray(state.cashMovements) ? state.cashMovements : [])
      .filter((movement) => !isArchivedAccountingRecord(movement))
      .filter((movement) => String(movement?.cashBoxType ?? '').toUpperCase() === 'BIG_CASH')
      .map((movement) => {
        const descriptor = getAccountingAccountDescriptor(movement?.paymentMethod, movement?.paymentAccount);
        const contract = movement?.linkedContractId
          ? contractById.get(String(movement.linkedContractId))
          : null;
        const rental = movement?.linkedRentalId
          ? rentalById.get(String(movement.linkedRentalId))
          : null;
        const linkedContract = contract
          ?? (rental?.contractId ? contractById.get(String(rental.contractId)) : null);
        const referenceLabel = String(
          movement?.contractCode
          ?? linkedContract?.contractCode
          ?? rental?.contractCode
          ?? movement?.linkedOrderCode
          ?? rental?.orderCode
          ?? movement?.receiptCode
          ?? movement?.receipt
          ?? movement?.sourceId
          ?? '-'
        ).trim() || '-';
        return {
          ...summarizeAccountingMovement(movement),
          accountKey: descriptor.key,
          accountLabel: descriptor.label,
          referenceLabel,
          customerName: String(
            movement?.receiptCustomerName
            ?? rental?.customerName
            ?? linkedContract?.customerName
            ?? ''
          ).trim(),
          userLabel: String(
            movement?.responsible
            ?? movement?.createdByName
            ?? movement?.userName
            ?? movement?.createdBy
            ?? 'Sistema'
          ).trim() || 'Sistema',
        };
      });

    const accountMap = new Map();
    allRows.forEach((movement) => {
      const descriptor = getAccountingAccountDescriptor(movement?.paymentMethod, movement?.paymentAccount);
      const current = accountMap.get(descriptor.key) ?? { ...descriptor, count: 0, incomeBs: 0, outBs: 0 };
      if (!movement?.deletedAt && !movement?.voidedAt && String(movement?.receiptStatus ?? '').toLowerCase() !== 'anulado') {
        const amount = Number(movement?.amountBs ?? 0);
        if (amount > 0) current.incomeBs += amount;
        if (amount < 0) current.outBs += Math.abs(amount);
      }
      current.count += 1;
      accountMap.set(descriptor.key, current);
    });

    const filtered = allRows
      .filter((movement) => accountKey === 'all' || movement.accountKey === accountKey)
      .filter((movement) => {
        const dateKey = accountingDateKey(movement?.createdAt);
        return (!dateFrom || dateKey >= dateFrom) && (!dateTo || dateKey <= dateTo);
      })
      .filter((movement) => {
        if (!query) return true;
        return [
          movement?.description,
          movement?.category,
          movement?.type,
          movement?.referenceLabel,
          movement?.customerName,
          movement?.userLabel,
          movement?.receipt,
          movement?.receiptCode,
          movement?.receiptCustomerName,
          movement?.paymentAccount,
        ].some((value) => String(value ?? '').toLowerCase().includes(query));
      })
      .sort((a, b) => new Date(b?.createdAt ?? 0) - new Date(a?.createdAt ?? 0));

    const effectiveRows = filtered.filter((movement) => (
      !movement?.deletedAt
      && !movement?.voidedAt
      && String(movement?.receiptStatus ?? '').toLowerCase() !== 'anulado'
    ));
    const incomeBs = effectiveRows.reduce((sum, movement) => {
      const amount = Number(movement?.amountBs ?? 0);
      return sum + (amount > 0 ? amount : 0);
    }, 0);
    const outBs = effectiveRows.reduce((sum, movement) => {
      const amount = Number(movement?.amountBs ?? 0);
      return sum + (amount < 0 ? Math.abs(amount) : 0);
    }, 0);

    await sendJsonPayload(req, res, {
      revision: snapshot?.revision ?? null,
      updatedAt: snapshot?.updatedAt ?? null,
      accounts: [...accountMap.values()]
        .map((row) => ({
          ...row,
          incomeBs: Math.round(row.incomeBs * 100) / 100,
          outBs: Math.round(row.outBs * 100) / 100,
          netBs: Math.round((row.incomeBs - row.outBs) * 100) / 100,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es')),
      rows: filtered.slice(0, limit),
      total: filtered.length,
      summary: {
        incomeBs: Math.round(incomeBs * 100) / 100,
        outBs: Math.round(outBs * 100) / 100,
        netBs: Math.round((incomeBs - outBs) * 100) / 100,
      },
    });
  } catch (error) {
    next(error);
  }
});


router.get('/__copetin_db/accounting/comprobantes', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    const accountKey = String(req.query?.accountKey ?? 'all').trim();
    const dateFrom = String(req.query?.dateFrom ?? '').trim();
    const dateTo = String(req.query?.dateTo ?? '').trim();
    const query = String(req.query?.query ?? '').trim().toLowerCase();
    const limit = Math.min(300, Math.max(20, Number(req.query?.limit ?? 160) || 160));

    const movements = (Array.isArray(state.cashMovements) ? state.cashMovements : [])
      .filter((movement) => !isArchivedAccountingRecord(movement));
    const movementById = new Map(movements.map((movement) => [String(movement?.id ?? ''), movement]));
    const accountMap = new Map();
    const rows = [];

    const registerAccount = (descriptor) => {
      const key = String(descriptor?.key ?? 'sin_metodo:').trim() || 'sin_metodo:';
      const current = accountMap.get(key) ?? {
        key,
        label: descriptor?.label ?? 'Sin método',
        method: descriptor?.method ?? 'sin_metodo',
        account: descriptor?.account ?? '',
        count: 0,
      };
      current.count += 1;
      accountMap.set(key, current);
    };

    (Array.isArray(state.contracts) ? state.contracts : [])
      .filter((contract) => contract && !contract.deletedAt)
      .forEach((contract) => {
        const ledger = Array.isArray(contract?.economicLedger) ? contract.economicLedger : [];
        ledger
          .filter((entry) => !entry?.deletedAt && entry?.attachment)
          .forEach((entry) => {
            const normalizedAttachment = normalizeEconomicLedgerAttachment(entry.attachment);
            if (!normalizedAttachment) return;
            const movement = entry?.cashMovementId
              ? movementById.get(String(entry.cashMovementId))
              : null;
            const descriptor = getAccountingAccountDescriptor(
              entry?.paymentMethod ?? movement?.paymentMethod,
              entry?.paymentAccount ?? movement?.paymentAccount,
            );
            registerAccount(descriptor);
            rows.push({
              browserId: `attachment:${contract.id}:${entry.id}`,
              sourceKind: 'attachment',
              contractId: contract.id,
              contractCode: contract.contractCode ?? contract.code ?? '',
              customerName: contract.customerName ?? '',
              ledgerEntryId: entry.id,
              type: entry.type,
              typeLabel: 'Comprobante adjunto',
              amountBs: Math.abs(Number(entry.amountBs ?? movement?.amountBs ?? 0)),
              paymentMethod: entry.paymentMethod ?? movement?.paymentMethod ?? 'efectivo',
              paymentAccount: entry.paymentAccount ?? movement?.paymentAccount ?? '',
              accountKey: descriptor.key,
              accountLabel: descriptor.label,
              note: entry.note ?? movement?.description ?? '',
              createdAt: entry.createdAt ?? movement?.createdAt ?? normalizedAttachment?.uploadedAt ?? null,
              createdByName: entry.createdByName ?? movement?.createdByName ?? movement?.responsible ?? 'Sistema',
              cashMovementId: entry.cashMovementId ?? null,
              cashReceiptCode: entry.cashReceiptCode ?? movement?.receiptCode ?? movement?.receipt ?? '',
              attachment: normalizedAttachment,
              referenceLabel: contract.contractCode ?? contract.code ?? '',
            });
          });
      });

    movements
      .filter((movement) => String(movement?.receiptCode ?? movement?.receipt ?? '').trim())
      .forEach((movement) => {
        const descriptor = getAccountingAccountDescriptor(movement?.paymentMethod, movement?.paymentAccount);
        registerAccount(descriptor);
        rows.push({
          browserId: `receipt:${movement.id}`,
          sourceKind: 'receipt',
          contractId: movement?.contractId ?? movement?.relatedContractId ?? null,
          contractCode: movement?.contractCode ?? movement?.reference ?? movement?.receiptCode ?? movement?.receipt ?? '',
          customerName: movement?.customerName ?? movement?.clientName ?? movement?.customer ?? '',
          ledgerEntryId: null,
          type: movement?.type ?? 'receipt',
          typeLabel: 'Recibo del sistema',
          amountBs: Math.abs(Number(movement?.amountBs ?? 0)),
          paymentMethod: movement?.paymentMethod ?? 'efectivo',
          paymentAccount: movement?.paymentAccount ?? '',
          accountKey: descriptor.key,
          accountLabel: descriptor.label,
          note: movement?.description ?? movement?.category ?? movement?.type ?? 'Recibo',
          createdAt: movement?.createdAt ?? null,
          createdByName: movement?.createdByName ?? movement?.responsible ?? 'Sistema',
          cashMovementId: movement?.id ?? null,
          cashReceiptCode: movement?.receiptCode ?? movement?.receipt ?? '',
          attachment: null,
          referenceLabel: movement?.referenceLabel ?? movement?.reference ?? movement?.contractCode ?? '',
        });
      });

    const filtered = rows
      .filter((row) => accountKey === 'all' || row.accountKey === accountKey)
      .filter((row) => {
        const dateKey = accountingDateKey(row?.createdAt);
        return (!dateFrom || dateKey >= dateFrom) && (!dateTo || dateKey <= dateTo);
      })
      .filter((row) => {
        if (!query) return true;
        return [
          row.customerName,
          row.contractCode,
          row.note,
          row.typeLabel,
          row.paymentAccount,
          row.cashReceiptCode,
          row.createdByName,
          row.attachment?.originalName,
          row.referenceLabel,
        ].some((value) => String(value ?? '').toLowerCase().includes(query));
      })
      .sort((a, b) => new Date(b?.createdAt ?? 0) - new Date(a?.createdAt ?? 0));

    await sendJsonPayload(req, res, {
      revision: snapshot?.revision ?? null,
      updatedAt: snapshot?.updatedAt ?? null,
      accounts: [...accountMap.values()].sort((a, b) => a.label.localeCompare(b.label, 'es')),
      rows: filtered.slice(0, limit),
      total: filtered.length,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/__copetin_db/accounting-context', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    const allMovements = (Array.isArray(state.cashMovements) ? state.cashMovements : [])
      .filter((movement) => !isArchivedAccountingRecord(movement));
    const recentLimit = Math.min(1500, Math.max(100, Number(req.query.limit ?? 750) || 750));
    const sortedMovements = allMovements
      .slice()
      .sort((a, b) => new Date(b?.createdAt ?? 0) - new Date(a?.createdAt ?? 0));
    const selectedMovements = new Map();
    sortedMovements.slice(0, recentLimit).forEach((movement) => selectedMovements.set(String(movement?.id), movement));
    allMovements.filter(isGuaranteeRefundMovement).forEach((movement) => selectedMovements.set(String(movement?.id), movement));

    const contractRows = Array.isArray(state.contracts) ? state.contracts : [];
    const channelMap = new Map();
    contractRows.flatMap((contract) => Array.isArray(contract?.economicLedger) ? contract.economicLedger : [])
      .filter((entry) => !entry?.deletedAt && String(entry?.type ?? '').toLowerCase() !== 'note')
      .forEach((entry) => {
      const rawMethod = String(entry?.paymentMethod ?? '').trim().toLowerCase();
      const method = rawMethod.includes('qr')
        ? 'qr'
        : rawMethod.includes('transfer')
          ? 'transferencia'
          : rawMethod.includes('efect')
            ? 'efectivo'
            : 'sin_metodo';
      const account = method === 'qr' || method === 'transferencia'
        ? String(entry?.paymentAccount ?? '').trim().toUpperCase() || 'SIN CUENTA'
        : '';
      const key = `${method}:${account}`;
      const current = channelMap.get(key) ?? {
        key,
        method,
        account,
        incomeBs: 0,
        outBs: 0,
        count: 0,
      };
      const amount = Math.abs(Number(entry?.amountBs ?? 0));
      if (String(entry?.type ?? '').toLowerCase() === 'refund') current.outBs += amount;
      else current.incomeBs += amount;
      current.count += 1;
      channelMap.set(key, current);
    });

    const paymentChannels = [...channelMap.values()]
      .map((row) => ({
        ...row,
        incomeBs: Math.round(row.incomeBs * 100) / 100,
        outBs: Math.round(row.outBs * 100) / 100,
        netBs: Math.round((row.incomeBs - row.outBs) * 100) / 100,
      }))
      .sort((a, b) => b.netBs - a.netBs || a.key.localeCompare(b.key, 'es'));

    const contractsById = new Map(contractRows
      .map((contract) => [String(contract?.id ?? ''), contract]));
    const returnIssues = (Array.isArray(state.rentals) ? state.rentals : [])
      .filter((rental) => !rental?.deletedAt && String(rental?.status ?? '').toLowerCase() === 'returned')
      .flatMap((rental) => {
        const contract = contractsById.get(String(rental?.contractId ?? ''));
        return (Array.isArray(rental?.returnReport) ? rental.returnReport : [])
          .filter((line) => (
            Number(line?.damagedQty ?? 0) > 0
            || Number(line?.missingQty ?? 0) > 0
            || Number(line?.penaltyBs ?? 0) > 0
          ))
          .map((line, index) => ({
            id: `${rental.id}-${line?.itemId ?? index}`,
            rentalId: rental.id,
            contractId: contract?.id ?? rental?.contractId ?? '',
            orderCode: rental?.orderCode ?? '',
            contractCode: contract?.contractCode ?? rental?.contractCode ?? rental?.orderCode ?? rental?.id,
            customerName: rental?.customerName ?? contract?.customerName ?? 'Cliente',
            responsibleName: contract?.responsibles?.[0]?.name ?? contract?.responsibleName ?? rental?.createdByName ?? '-',
            eventDate: rental?.eventDate ?? contract?.eventDate ?? rental?.rentalDate ?? rental?.createdAt,
            returnedAt: rental?.returnedAt,
            itemName: line?.itemName ?? line?.name ?? 'Item',
            damagedQty: Number(line?.damagedQty ?? 0),
            missingQty: Number(line?.missingQty ?? 0),
            damagedUnitChargeBs: Number(line?.damagedUnitChargeBs ?? 0),
            missingUnitChargeBs: Number(line?.missingUnitChargeBs ?? 0),
            penaltyBs: Number(line?.penaltyBs ?? 0),
            chargeOwner: ['transporte', 'lavado'].includes(String(line?.chargeOwner ?? '').toLowerCase())
              ? String(line.chargeOwner).toLowerCase()
              : 'cliente',
            note: line?.damageNote ?? '',
            pendingCollectionBs: getReconciledReturnedPendingCollectionBs(contract, rental),
          }));
      })
      .sort((a, b) => new Date(b?.returnedAt ?? 0) - new Date(a?.returnedAt ?? 0));

    await sendJsonPayload(req, res, {
      revision: snapshot?.revision ?? null,
      updatedAt: snapshot?.updatedAt ?? null,
      movements: [...selectedMovements.values()]
        .sort((a, b) => new Date(b?.createdAt ?? 0) - new Date(a?.createdAt ?? 0))
        .map(summarizeAccountingMovement),
      debts: (Array.isArray(state.cashDebts) ? state.cashDebts : [])
        .filter((debt) => !isArchivedAccountingRecord(debt)),
      paymentChannels,
      returnIssues,
      totalMovements: allMovements.length,
      visibleMovements: selectedMovements.size,
      truncated: selectedMovements.size < allMovements.length,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/__copetin_db/accounting/petty-history', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const movements = (Array.isArray(snapshot?.state?.cashMovements) ? snapshot.state.cashMovements : [])
      .filter((movement) => !isArchivedAccountingRecord(movement))
      .filter((movement) => String(movement?.cashBoxType ?? '').toUpperCase() === 'PETTY_CASH')
      .sort((a, b) => new Date(b?.createdAt ?? 0) - new Date(a?.createdAt ?? 0))
      .map(summarizeAccountingMovement);

    await sendJsonPayload(req, res, {
      revision: snapshot?.revision ?? null,
      updatedAt: snapshot?.updatedAt ?? null,
      movements,
      total: movements.length,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/__copetin_db/accounting/petty-sector', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    const sector = String(req.query.sector ?? 'expenses').trim().toLowerCase();
    const allowedSectors = new Set(['expenses', 'advances', 'suppliers', 'debts', 'history']);
    if (!allowedSectors.has(sector)) {
      res.status(400).json({ error: 'Sector de Caja Chica no valido.' });
      return;
    }

    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(80, Math.max(1, Number.parseInt(req.query.limit, 10) || 80));
    const dateFrom = String(req.query.dateFrom ?? '').trim();
    const dateTo = String(req.query.dateTo ?? '').trim();
    const movementFilter = String(req.query.movement ?? 'all').trim().toLowerCase();
    const categoryFilter = String(req.query.category ?? 'all').trim().toLowerCase();
    const search = String(req.query.query ?? '').trim().toLowerCase();
    const normalizeValue = (value) => String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    const dateKey = (value) => {
      const parsed = new Date(value ?? '');
      if (Number.isNaN(parsed.getTime())) return '';
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/La_Paz',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(parsed);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    };
    const isVoided = (movement) => String(movement?.receiptStatus ?? '').toLowerCase() === 'anulado' || Boolean(movement?.voidedAt);
    const isAdvance = (movement) => {
      const category = normalizeValue(movement?.category);
      const tag = normalizeValue(movement?.accountingTag);
      return category.includes('adelanto') || tag === 'personnel_advance';
    };
    const expenseCategory = (movement) => {
      const text = `${normalizeValue(movement?.category)} ${normalizeValue(movement?.description)}`;
      if (text.includes('servicio') || text.includes('luz') || text.includes('agua') || text.includes('internet')) return 'services';
      if (text.includes('aliment') || text.includes('almuerzo') || text.includes('comida') || text.includes('refrigerio')) return 'food';
      if (text.includes('taxi') || text.includes('pasaje') || text.includes('movilidad') || text.includes('transporte')) return 'mobility';
      if (text.includes('mante') || text.includes('camion') || text.includes('reparacion')) return 'maintenance';
      if (text.includes('compra')) return 'purchase';
      if (isAdvance(movement)) return 'advance';
      if (text.includes('limpieza') || text.includes('detergente')) return 'cleaning';
      if (text.includes('interes')) return 'interest';
      if (text.includes('eess') || text.includes('monica') || text.includes('combustible') || text.includes('gasolina')) return 'fuel';
      if (text.includes('sueldo') || text.includes('salario')) return 'payroll';
      if (text.includes('proveedor') || text.includes('supplier')) return 'supplier';
      if (text.includes('varios') || text.includes('otro')) return 'misc';
      return 'other';
    };

    const pettyMovements = (Array.isArray(state.cashMovements) ? state.cashMovements : [])
      // Los eliminados siguen visibles en Caja Chica como historial tachado,
      // pero summarizeDirectCashState ya los excluye de saldos y totales.
      .filter((movement) => !movement?.accountingArchivedAt && movement?.accountingPeriodStatus !== 'archived')
      .filter((movement) => String(movement?.cashBoxType ?? '').toUpperCase() === 'PETTY_CASH');
    let rows;
    if (sector === 'suppliers') {
      rows = (Array.isArray(state.supplierLoans) ? state.supplierLoans : []).filter((loan) => !loan?.deletedAt);
    } else if (sector === 'debts') {
      rows = (Array.isArray(state.cashDebts) ? state.cashDebts : [])
        .filter((debt) => !isArchivedAccountingRecord(debt));
    } else if (sector === 'advances') {
      rows = pettyMovements.filter((movement) => Number(movement?.amountBs ?? 0) < 0 && !movement?.isInternalTransfer && isAdvance(movement));
    } else if (sector === 'expenses') {
      rows = pettyMovements.filter((movement) => Number(movement?.amountBs ?? 0) < 0 && !movement?.isInternalTransfer && !isAdvance(movement));
    } else {
      rows = pettyMovements.filter((movement) => {
        const amount = Number(movement?.amountBs ?? 0);
        const type = String(movement?.type ?? '').toLowerCase();
        return (type === 'apertura' && amount > 0)
          || (movement?.isInternalTransfer && amount > 0)
          || (!movement?.isInternalTransfer && amount < 0);
      });
    }

    rows = rows
      .filter((row) => {
        const rowDate = dateKey(row?.createdAt ?? row?.debtDate ?? row?.requestDate);
        if (dateFrom && rowDate < dateFrom) return false;
        if (dateTo && rowDate > dateTo) return false;
        if (sector === 'history') {
          const amount = Number(row?.amountBs ?? 0);
          const reposition = (String(row?.type ?? '').toLowerCase() === 'apertura' || row?.isInternalTransfer) && amount > 0;
          const expense = !row?.isInternalTransfer && amount < 0;
          const transport = Number(row?.transportExpenseBs ?? 0) > 0
            || String(row?.accountingTag ?? '') === 'transport_expense'
            || ['movilidad', 'transporte'].includes(String(row?.category ?? '').toLowerCase());
          if (movementFilter === 'reposition' && !reposition) return false;
          if (movementFilter === 'expense' && (!expense || isVoided(row))) return false;
          if (movementFilter === 'voided' && !isVoided(row)) return false;
          if (movementFilter === 'transport' && (!transport || isVoided(row))) return false;
        }
        if (['expenses', 'history'].includes(sector) && categoryFilter !== 'all' && expenseCategory(row) !== categoryFilter) return false;
        if (!search) return true;
        return [row?.description, row?.receipt, row?.receiptCode, row?.responsible, row?.createdBy, row?.category, row?.notes, row?.personName, row?.supplierName, row?.loanCode]
          .some((value) => normalizeValue(value).includes(normalizeValue(search)));
      })
      .sort((a, b) => new Date(b?.createdAt ?? b?.debtDate ?? b?.requestDate ?? 0) - new Date(a?.createdAt ?? a?.debtDate ?? a?.requestDate ?? 0));

    const summary = sector === 'history'
      ? rows.reduce((result, movement) => {
        if (isVoided(movement)) {
          result.voidedCount += 1;
          return result;
        }
        const amount = Number(movement?.amountBs ?? 0);
        if ((String(movement?.type ?? '').toLowerCase() === 'apertura' || movement?.isInternalTransfer) && amount > 0) result.repositionsBs += amount;
        if (!movement?.isInternalTransfer && amount < 0) result.expensesBs += Math.abs(amount);
        result.netBs = Math.round((result.repositionsBs - result.expensesBs) * 100) / 100;
        return result;
      }, { repositionsBs: 0, expensesBs: 0, netBs: 0, voidedCount: 0 })
      : null;
    const total = rows.length;
    const pageRows = rows.slice(offset, offset + limit).map((row) => (
      ['expenses', 'advances', 'history'].includes(sector) ? summarizeAccountingMovement(row) : row
    ));

    await sendJsonPayload(req, res, {
      revision: snapshot?.revision ?? null,
      sector,
      rows: pageRows,
      offset,
      limit,
      total,
      hasMore: offset + pageRows.length < total,
      summary,
    });
  } catch (error) {
    next(error);
  }
});


const summarizeCalendarContract = (contract = {}) => ({
  id: contract.id ?? '',
  contractCode: contract.contractCode ?? '',
  rentalId: contract.rentalId ?? '',
  orderCode: contract.orderCode ?? '',
  deletedAt: contract.deletedAt ?? null,
  status: contract.status ?? '',
  pickupDate: contract.pickupDate ?? null,
  validUntil: contract.validUntil ?? null,
  deliveryDate: contract.deliveryDate ?? null,
  pickupWindowStart: contract.pickupWindowStart ?? '',
  pickupWindowEnd: contract.pickupWindowEnd ?? '',
  deliveryWindowStart: contract.deliveryWindowStart ?? '',
  deliveryWindowEnd: contract.deliveryWindowEnd ?? '',
  customerName: contract.customerName ?? '',
  eventType: contract.eventType ?? '',
  eventDate: contract.eventDate ?? null,
  logisticsMode: contract.logisticsMode ?? 'envio',
  address: contract.address ?? contract.deliveryAddress ?? contract.serviceAddress ?? '',
  city: contract.city ?? '',
  createdByName: contract.createdByName ?? '',
  createdBy: contract.createdBy ?? '',
  createdByRole: contract.createdByRole ?? '',
  totals: { totalBs: Number(contract?.totals?.totalBs ?? 0) },
  itemsCount: Array.isArray(contract.items) ? contract.items.length : Number(contract.itemsCount ?? 0),
  _calendarSummaryOnly: true,
});

const summarizeCalendarRental = (rental = {}) => ({
  id: rental.id ?? '',
  orderCode: rental.orderCode ?? '',
  deletedAt: rental.deletedAt ?? null,
  status: rental.status ?? '',
  rentalDate: rental.rentalDate ?? null,
  createdAt: rental.createdAt ?? null,
  dueDate: rental.dueDate ?? null,
  dueTime: rental.dueTime ?? '',
  deliveryWindowStart: rental.deliveryWindowStart ?? '',
  deliveryWindowEnd: rental.deliveryWindowEnd ?? '',
  customerName: rental.customerName ?? '',
  companyName: rental.companyName ?? '',
  logisticsMode: rental.logisticsMode ?? 'envio',
  eventAddress: rental.eventAddress ?? rental.address ?? '',
  address: rental.address ?? '',
  city: rental.city ?? '',
  createdByName: rental.createdByName ?? '',
  createdBy: rental.createdBy ?? '',
  createdByRole: rental.createdByRole ?? '',
  operational: rental.operational
    ? { inventoryStatus: rental.operational.inventoryStatus ?? 'pendiente' }
    : { inventoryStatus: 'pendiente' },
  totals: { totalBs: Number(rental?.totals?.totalBs ?? 0) },
  itemsCount: Array.isArray(rental.items) ? rental.items.length : Number(rental.itemsCount ?? 0),
  _calendarSummaryOnly: true,
});

const summarizeCalendarDelivery = (delivery = {}) => ({
  id: delivery.id ?? '',
  deliveryCode: delivery.deliveryCode ?? '',
  rentalId: delivery.rentalId ?? '',
  orderCode: delivery.orderCode ?? '',
  deletedAt: delivery.deletedAt ?? null,
  status: delivery.status ?? '',
  scheduledDate: delivery.scheduledDate ?? delivery.date ?? null,
  date: delivery.date ?? null,
  title: delivery.title ?? '',
  subtitle: delivery.subtitle ?? '',
  description: delivery.description ?? '',
  notes: delivery.notes ?? '',
  companyName: delivery.companyName ?? '',
  customerName: delivery.customerName ?? '',
  address: delivery.address ?? '',
  city: delivery.city ?? '',
  vehicleId: delivery.vehicleId ?? '',
  createdByName: delivery.createdByName ?? '',
  createdBy: delivery.createdBy ?? '',
  createdByRole: delivery.createdByRole ?? '',
  itemsCount: Array.isArray(delivery.items) ? delivery.items.length : Number(delivery.itemsCount ?? 0),
  _calendarSummaryOnly: true,
});


// El listado economico solo necesita estos campos para calcular saldos,
// garantia y notas. El cuaderno completo permanece en el servidor y se
// descarga de forma atomica al abrir o editar un contrato.
const summarizeOrdersEconomicLedgerEntry = (entry = {}) => ({
  id: entry.id ?? '',
  type: entry.type ?? '',
  amountBs: Number(entry.amountBs ?? 0),
  paymentMethod: entry.paymentMethod ?? '',
  paymentAccount: entry.paymentAccount ?? '',
  note: entry.type === 'note' ? (entry.note ?? '') : '',
  createdAt: entry.createdAt ?? null,
  createdByName: entry.createdByName ?? entry.createdBy ?? '',
  cashMovementId: entry.cashMovementId ?? null,
  cashReceiptCode: entry.cashReceiptCode ?? '',
  isCashRegistered: Boolean(entry.isCashRegistered),
  cashRegisteredAt: entry.cashRegisteredAt ?? null,
  cashCollectionTarget: entry.cashCollectionTarget ?? '',
  reclassifiedFromPayment: Boolean(entry.reclassifiedFromPayment),
  refundSource: entry.refundSource ?? '',
  sourceDepositId: entry.sourceDepositId ?? null,
  contractAllocationBs: Number(entry.contractAllocationBs ?? 0),
  guaranteeAllocationBs: Number(entry.guaranteeAllocationBs ?? 0),
  surplusAllocationBs: Number(entry.surplusAllocationBs ?? 0),
  deletedAt: entry.deletedAt ?? null,
  deletedByName: entry.deletedByName ?? '',
});


const summarizeOrdersContract = (contract = {}) => ({
  id: contract.id ?? '',
  rentalId: contract.rentalId ?? '',
  contractCode: contract.contractCode ?? '',
  orderCode: contract.orderCode ?? '',
  quoteId: contract.quoteId ?? '',
  status: contract.status ?? '',
  createdAt: contract.createdAt ?? null,
  updatedAt: contract.updatedAt ?? null,
  deletedAt: contract.deletedAt ?? null,
  deletedByName: contract.deletedByName ?? '',
  deletedByRole: contract.deletedByRole ?? '',
  customerName: contract.customerName ?? contract.clientName ?? '',
  customerPhone: contract.customerPhone ?? contract.phone ?? '',
  customerReferencePhone: contract.customerReferencePhone ?? contract.referencePhone ?? '',
  clientId: contract.clientId ?? contract.customerId ?? '',
  companyName: contract.companyName ?? '',
  eventDate: contract.eventDate ?? null,
  deliveryDate: contract.deliveryDate ?? null,
  pickupDate: contract.pickupDate ?? null,
  eventType: contract.eventType ?? '',
  logisticsMode: contract.logisticsMode ?? 'envio',
  address: contract.address ?? contract.deliveryAddress ?? contract.serviceAddress ?? '',
  city: contract.city ?? '',
  responsibleId: contract.responsibleId ?? null,
  responsibleName: contract.responsibleName ?? contract.assignedToName ?? '',
  responsibleRole: contract.responsibleRole ?? contract.assignedToRole ?? '',
  responsibles: (Array.isArray(contract.responsibles) ? contract.responsibles : []).map((entry) => ({
    id: entry?.id ?? '',
    name: entry?.name ?? '',
    role: entry?.role ?? '',
  })),
  createdByName: contract.createdByName ?? '',
  createdByRole: contract.createdByRole ?? '',
  notes: contract.notes ?? contract.note ?? '',
  observations: contract.observations ?? '',
  cancellationPenaltyPercent: Number(contract.cancellationPenaltyPercent ?? 0),
  cancellationPenaltyBs: Number(contract.cancellationPenaltyBs ?? 0),
  cancellationReason: contract.cancellationReason ?? '',
  accountingStatus: contract.accountingStatus ?? '',
  paymentStatus: contract.paymentStatus ?? '',
  payment: contract.payment
    ? {
        paidAtApprovalBs: Number(contract.payment.paidAtApprovalBs ?? 0),
        pendingPaymentBs: contract.payment.pendingPaymentBs ?? null,
        pendingBs: contract.payment.pendingBs ?? null,
        guaranteeStatus: contract.payment.guaranteeStatus ?? '',
      }
    : null,
  guarantee: contract.guarantee
    ? { status: contract.guarantee.status ?? '' }
    : null,
  totals: {
    totalBs: Number(contract?.totals?.totalBs ?? 0),
    guaranteeBs: Number(contract?.totals?.guaranteeBs ?? 0),
    deliveryFeeBs: Number(contract?.totals?.deliveryFeeBs ?? contract?.deliveryFeeBs ?? 0),
    itemsNetSubtotalBs: contract?.totals?.itemsNetSubtotalBs ?? contract?.totals?.itemsSubtotalBs ?? null,
    discountBs: contract?.totals?.discountBs ?? null,
    pendingPaymentBs: contract?.totals?.pendingPaymentBs ?? null,
  },
  pricingPlan: contract?.pricingPlan
    ? { mode: contract.pricingPlan.mode ?? 'simple' }
    : null,
  services: (Array.isArray(contract.services) ? contract.services : []).map((service) => ({
    lineTotalBs: Number(service?.lineTotalBs ?? 0),
  })),
  // El bootstrap conserva solo las lineas minimas que necesita la
  // disponibilidad por fecha. La edicion sigue descargando el contrato completo.
  itemsCount: (Array.isArray(contract.items) ? contract.items : [])
    .reduce((sum, line) => sum + Number(line?.quantity ?? 0), 0),
  economicLedger: (Array.isArray(contract.economicLedger) ? contract.economicLedger : [])
    .map(summarizeOrdersEconomicLedgerEntry),
  economicResetAt: contract.economicResetAt ?? null,
  economicResetVersion: contract.economicResetVersion ?? null,
  isFinalized: Boolean(contract.isFinalized),
  finalizedAt: contract.finalizedAt ?? null,
  finalizedByName: contract.finalizedByName ?? '',
  _summaryOnly: true,
  _ordersSummaryOnly: true,
});

const summarizeOrdersRental = (rental = {}) => ({
  id: rental.id ?? '',
  rentalId: rental.rentalId ?? rental.id ?? '',
  contractId: rental.contractId ?? '',
  contractCode: rental.contractCode ?? '',
  orderCode: rental.orderCode ?? '',
  deletedAt: rental.deletedAt ?? null,
  status: rental.status ?? '',
  createdAt: rental.createdAt ?? rental.rentalAt ?? null,
  eventDate: rental.eventDate ?? null,
  rentalDate: rental.rentalDate ?? null,
  dueDate: rental.dueDate ?? null,
  dueTime: rental.dueTime ?? '',
  customerName: rental.customerName ?? '',
  customerPhone: rental.customerPhone ?? rental.phone ?? '',
  companyName: rental.companyName ?? '',
  responsibleId: rental.responsibleId ?? null,
  responsibleName: rental.responsibleName ?? rental.assignedToName ?? '',
  responsibleRole: rental.responsibleRole ?? rental.assignedToRole ?? '',
  responsibles: (Array.isArray(rental.responsibles) ? rental.responsibles : []).map((entry) => ({
    id: entry?.id ?? '',
    name: entry?.name ?? '',
    role: entry?.role ?? '',
  })),
  logisticsMode: rental.logisticsMode ?? 'envio',
  eventAddress: rental.eventAddress ?? rental.address ?? '',
  address: rental.address ?? '',
  city: rental.city ?? '',
  accountingStatus: rental.accountingStatus ?? '',
  refundBs: Number(rental.refundBs ?? 0),
  cancelledAt: rental.cancelledAt ?? null,
  cancellationPenaltyPercent: Number(rental.cancellationPenaltyPercent ?? 0),
  cancellationPenaltyBs: Number(rental.cancellationPenaltyBs ?? 0),
  cancellationReason: rental.cancellationReason ?? '',
  operational: rental.operational
    ? {
        inventoryStatus: rental.operational.inventoryStatus ?? 'pendiente',
        transportStatus: rental.operational.transportStatus ?? 'pendiente',
        inventoryNote: rental.operational.inventoryNote ?? '',
        transportNote: rental.operational.transportNote ?? '',
        inventorySentAt: rental.operational.inventorySentAt ?? null,
        transportSentAt: rental.operational.transportSentAt ?? null,
        inventoryConfirmedAt: rental.operational.inventoryConfirmedAt ?? null,
        transportConfirmedAt: rental.operational.transportConfirmedAt ?? null,
      }
    : { inventoryStatus: 'pendiente', transportStatus: 'pendiente' },
  payment: rental.payment
    ? {
        status: rental.payment.status ?? '',
        pendingPaymentBs: rental.payment.pendingPaymentBs ?? null,
        damageCollectedBs: Number(rental.payment.damageCollectedBs ?? 0),
        penaltiesCollectedBs: Number(rental.payment.penaltiesCollectedBs ?? 0),
        returnChargesCollectedBs: Number(rental.payment.returnChargesCollectedBs ?? 0),
      }
    : null,
  totals: {
    totalBs: Number(rental?.totals?.totalBs ?? 0),
    pendingPaymentBs: rental?.totals?.pendingPaymentBs ?? null,
    damageCollectedBs: Number(rental?.totals?.damageCollectedBs ?? 0),
    penaltiesCollectedBs: Number(rental?.totals?.penaltiesCollectedBs ?? 0),
    returnChargesCollectedBs: Number(rental?.totals?.returnChargesCollectedBs ?? 0),
  },
  penaltiesBs: Number(rental.penaltiesBs ?? rental?.returnSettlement?.penaltiesBs ?? 0),
  returnSettlement: rental.returnSettlement
    ? {
        pendingCollectionBs: rental.returnSettlement.pendingCollectionBs ?? null,
        penaltiesBs: Number(rental.returnSettlement.penaltiesBs ?? rental.penaltiesBs ?? 0),
        damageCollectedBs: Number(rental.returnSettlement.damageCollectedBs ?? 0),
        penaltiesCollectedBs: Number(rental.returnSettlement.penaltiesCollectedBs ?? 0),
        discountCoveredByDepositBs: Number(rental.returnSettlement.discountCoveredByDepositBs ?? 0),
        totalDiscountAgainstDepositBs: Number(rental.returnSettlement.totalDiscountAgainstDepositBs ?? 0),
        refundBs: Number(rental.returnSettlement.refundBs ?? 0),
        accountingStatus: rental.returnSettlement.accountingStatus ?? '',
      }
    : null,
  itemsCount: (Array.isArray(rental.items) ? rental.items : [])
    .reduce((sum, line) => sum + Number(line?.quantity ?? 0), 0),
  firstItemName: (Array.isArray(rental.items) ? rental.items : [])
    .find((line) => String(line?.itemName ?? line?.name ?? '').trim())?.itemName
    ?? (Array.isArray(rental.items) ? rental.items : [])
      .find((line) => String(line?.itemName ?? line?.name ?? '').trim())?.name
    ?? '',
  _summaryOnly: true,
  _ordersSummaryOnly: true,
});

// Contabilidad necesita todos los saldos y referencias, pero no las lineas de
// productos, documentos ni revisiones completas de cada contrato. Este resumen
// conserva la informacion economica exacta y reduce varios MB de transferencia.
const summarizeAccountingContract = (contract = {}) => ({
  id: contract.id ?? '',
  rentalId: contract.rentalId ?? '',
  contractCode: contract.contractCode ?? '',
  orderCode: contract.orderCode ?? '',
  status: contract.status ?? '',
  customerName: contract.customerName ?? contract.clientName ?? '',
  eventDate: contract.eventDate ?? null,
  eventType: contract.eventType ?? '',
  responsibleName: contract.responsibleName ?? contract.assignedToName ?? '',
  responsibles: (Array.isArray(contract.responsibles) ? contract.responsibles : []).map((entry) => ({
    id: entry?.id ?? '',
    name: entry?.name ?? '',
    role: entry?.role ?? '',
  })),
  createdByName: contract.createdByName ?? '',
  isFinalized: Boolean(contract.isFinalized),
  finalizedAt: contract.finalizedAt ?? null,
  finalizedByName: contract.finalizedByName ?? '',
  totalBs: Number(contract?.totalBs ?? contract?.totals?.totalBs ?? 0),
  deliveryFeeBs: Number(contract?.deliveryFeeBs ?? contract?.totals?.deliveryFeeBs ?? 0),
  prepaidAppliedBs: Number(contract?.prepaidAppliedBs ?? contract?.payment?.prepaidAppliedBs ?? 0),
  payment: contract?.payment
    ? {
        paidAtApprovalBs: Number(contract.payment.paidAtApprovalBs ?? 0),
        pendingPaymentBs: contract.payment.pendingPaymentBs ?? null,
        pendingBs: contract.payment.pendingBs ?? null,
        prepaidAppliedBs: Number(contract.payment.prepaidAppliedBs ?? 0),
        guaranteeStatus: contract.payment.guaranteeStatus ?? '',
        guaranteePaymentMethod: contract.payment.guaranteePaymentMethod ?? '',
        guaranteePaymentAccount: contract.payment.guaranteePaymentAccount ?? '',
      }
    : null,
  guarantee: contract?.guarantee
    ? {
        status: contract.guarantee.status ?? '',
        amountBs: Number(contract.guarantee.amountBs ?? contract?.totals?.guaranteeBs ?? 0),
        validatedBs: Number(contract.guarantee.validatedBs ?? 0),
        paymentMethod: contract.guarantee.paymentMethod ?? '',
        paymentAccount: contract.guarantee.paymentAccount ?? '',
      }
    : null,
  totals: {
    totalBs: Number(contract?.totals?.totalBs ?? contract?.totalBs ?? 0),
    guaranteeBs: Number(contract?.totals?.guaranteeBs ?? 0),
    deliveryFeeBs: Number(contract?.totals?.deliveryFeeBs ?? contract?.deliveryFeeBs ?? 0),
    itemsNetSubtotalBs: contract?.totals?.itemsNetSubtotalBs ?? contract?.totals?.itemsSubtotalBs ?? null,
    discountBs: contract?.totals?.discountBs ?? null,
    pendingPaymentBs: contract?.totals?.pendingPaymentBs ?? null,
  },
  // Caja Grande necesita la misma evidencia economica resumida que Ordenes.
  // Sin estas lineas, los contratos antiguos vuelven a usar saldos guardados
  // antes del ultimo cobro o ajuste (por ejemplo 2049 y 2026).
  economicLedger: (Array.isArray(contract?.economicLedger) ? contract.economicLedger : [])
    .map(summarizeOrdersEconomicLedgerEntry),
  economicLedgerUpdatedAt: contract?.economicLedgerUpdatedAt ?? null,
  economicResetAt: contract?.economicResetAt ?? null,
  economicResetVersion: contract?.economicResetVersion ?? null,
  _summaryOnly: true,
  _accountingSummaryOnly: true,
});

const summarizeAccountingReturnLine = (line = {}) => ({
  lineKey: line.lineKey ?? '',
  itemId: line.itemId ?? '',
  itemName: line.itemName ?? line.name ?? 'Item',
  damagedQty: Number(line.damagedQty ?? 0),
  missingQty: Number(line.missingQty ?? 0),
  damagedUnitChargeBs: Number(line.damagedUnitChargeBs ?? 0),
  missingUnitChargeBs: Number(line.missingUnitChargeBs ?? 0),
  damagedFeeBs: Number(line.damagedFeeBs ?? 0),
  missingFeeBs: Number(line.missingFeeBs ?? 0),
  penaltyBs: Number(line.penaltyBs ?? 0),
  chargeOwner: line.chargeOwner ?? 'cliente',
  damageNote: line.damageNote ?? line.note ?? '',
});

const summarizeAccountingRental = (rental = {}) => {
  const returnReport = (Array.isArray(rental?.returnReport) ? rental.returnReport : [])
    .filter((line) => (
      Number(line?.damagedQty ?? 0) > 0
      || Number(line?.missingQty ?? 0) > 0
      || Number(line?.penaltyBs ?? line?.damagedFeeBs ?? line?.missingFeeBs ?? 0) > 0
    ))
    .map(summarizeAccountingReturnLine);
  return {
    id: rental.id ?? '',
    rentalId: rental.rentalId ?? rental.id ?? '',
    contractId: rental.contractId ?? '',
    contractCode: rental.contractCode ?? '',
    orderCode: rental.orderCode ?? '',
    status: rental.status ?? '',
    createdAt: rental.createdAt ?? rental.rentalAt ?? null,
    updatedAt: rental.updatedAt ?? null,
    returnedAt: rental.returnedAt ?? null,
    finalizedAt: rental.finalizedAt ?? null,
    deliveryDate: rental.deliveryDate ?? null,
    eventType: rental.eventType ?? '',
    eventDate: rental.eventDate ?? null,
    rentalDate: rental.rentalDate ?? null,
    customerName: rental.customerName ?? '',
    createdBy: rental.createdBy ?? '',
    createdByName: rental.createdByName ?? '',
    responsibleName: rental.responsibleName ?? rental.assignedToName ?? '',
    deliveryFeeBs: Number(rental.deliveryFeeBs ?? rental?.totals?.deliveryFeeBs ?? 0),
    depositBs: Number(rental.depositBs ?? 0),
    guaranteeDeclaredBs: Number(rental.guaranteeDeclaredBs ?? rental?.guarantee?.amountBs ?? 0),
    prepaidAppliedBs: Number(rental.prepaidAppliedBs ?? rental?.payment?.prepaidAppliedBs ?? 0),
    guarantee: rental?.guarantee
      ? {
          status: rental.guarantee.status ?? '',
          amountBs: Number(rental.guarantee.amountBs ?? 0),
          validatedBs: Number(rental.guarantee.validatedBs ?? 0),
          paymentMethod: rental.guarantee.paymentMethod ?? '',
          paymentAccount: rental.guarantee.paymentAccount ?? '',
        }
      : null,
    payment: rental?.payment
      ? {
          status: rental.payment.status ?? '',
          paidAtRentalBs: Number(rental.payment.paidAtRentalBs ?? 0),
          pendingPaymentBs: rental.payment.pendingPaymentBs ?? null,
          prepaidAppliedBs: Number(rental.payment.prepaidAppliedBs ?? 0),
          deliveryFeeCollectedBs: Number(rental.payment.deliveryFeeCollectedBs ?? 0),
          damageCollectedBs: Number(rental.payment.damageCollectedBs ?? 0),
          penaltiesCollectedBs: Number(rental.payment.penaltiesCollectedBs ?? 0),
          returnChargesCollectedBs: Number(rental.payment.returnChargesCollectedBs ?? 0),
          guaranteeStatus: rental.payment.guaranteeStatus ?? '',
          guaranteePaymentMethod: rental.payment.guaranteePaymentMethod ?? '',
          guaranteePaymentAccount: rental.payment.guaranteePaymentAccount ?? '',
        }
      : null,
    totals: rental?.totals
      ? {
          totalBs: Number(rental.totals.totalBs ?? 0),
          deliveryFeeBs: Number(rental.totals.deliveryFeeBs ?? rental.deliveryFeeBs ?? 0),
          paidAtRentalBs: Number(rental.totals.paidAtRentalBs ?? 0),
          pendingPaymentBs: rental.totals.pendingPaymentBs ?? null,
          prepaidAppliedBs: Number(rental.totals.prepaidAppliedBs ?? 0),
          deliveryFeeCollectedBs: Number(rental.totals.deliveryFeeCollectedBs ?? 0),
          damageCollectedBs: Number(rental.totals.damageCollectedBs ?? 0),
          penaltiesCollectedBs: Number(rental.totals.penaltiesCollectedBs ?? 0),
          returnChargesCollectedBs: Number(rental.totals.returnChargesCollectedBs ?? 0),
        }
      : null,
    penaltiesBs: Number(rental.penaltiesBs ?? rental?.returnSettlement?.penaltiesBs ?? 0),
    refundBs: Number(rental.refundBs ?? rental?.returnSettlement?.refundBs ?? 0),
    returnSettlement: rental?.returnSettlement
      ? {
          outstandingRentalBs: Number(rental.returnSettlement.outstandingRentalBs ?? 0),
          pendingCollectionBs: rental.returnSettlement.pendingCollectionBs ?? null,
          penaltiesBs: Number(rental.returnSettlement.penaltiesBs ?? rental.penaltiesBs ?? 0),
          damageCollectedBs: Number(rental.returnSettlement.damageCollectedBs ?? 0),
          penaltiesCollectedBs: Number(rental.returnSettlement.penaltiesCollectedBs ?? 0),
          discountCoveredByDepositBs: Number(rental.returnSettlement.discountCoveredByDepositBs ?? 0),
          totalDiscountAgainstDepositBs: Number(rental.returnSettlement.totalDiscountAgainstDepositBs ?? 0),
          paidBs: Number(rental.returnSettlement.paidBs ?? 0),
          refundBs: Number(rental.returnSettlement.refundBs ?? 0),
          accountingStatus: rental.returnSettlement.accountingStatus ?? '',
          settledAt: rental.returnSettlement.settledAt ?? null,
        }
      : null,
    returnReport,
    returnIssueSummary: returnReport,
    _summaryOnly: true,
    _accountingSummaryOnly: true,
  };
};

const summarizeOrdersDelivery = (delivery = {}) => ({
  id: delivery.id ?? '',
  rentalId: delivery.rentalId ?? '',
  orderCode: delivery.orderCode ?? '',
  status: delivery.status ?? '',
  scheduledDate: delivery.scheduledDate ?? delivery.date ?? null,
  date: delivery.date ?? null,
  address: delivery.address ?? '',
  city: delivery.city ?? '',
  deletedAt: delivery.deletedAt ?? null,
});

const summarizeInventoryLine = (line = {}, index = 0) => ({
  lineKey: line.lineKey ?? '',
  itemId: line.itemId ?? '',
  itemName: line.itemName ?? line.name ?? 'Item',
  quantity: Number(line.quantity ?? 0),
  internalReservedQty: line.internalReservedQty ?? null,
  supplierBackedQty: Number(line.supplierBackedQty ?? 0),
  controlsStock: line.controlsStock !== false,
  verificationStatus: line.verificationStatus ?? '',
  rentalPriceBs: Number(line.rentalPriceBs ?? line.unitPriceBs ?? 0),
  unitPriceBs: Number(line.unitPriceBs ?? line.rentalPriceBs ?? 0),
  lineTotalBs: Number(line.lineTotalBs ?? 0),
  damagedUnitChargeBs: line.damagedUnitChargeBs ?? null,
  missingUnitChargeBs: line.missingUnitChargeBs ?? null,
  comboId: line.comboId ?? null,
  comboName: line.comboName ?? '',
  comboLineKey: line.comboLineKey ?? null,
  comboComponentName: line.comboComponentName ?? '',
  comboRuleIndex: line.comboRuleIndex ?? index,
  comboQuantity: line.comboQuantity ?? null,
  comboPricingRole: line.comboPricingRole ?? '',
});

const summarizeAvailabilityLine = (line = {}) => {
  const summary = {
    itemId: line.itemId ?? '',
    quantity: Number(line.quantity ?? 0),
    supplierBackedQty: Number(line.supplierBackedQty ?? 0),
    controlsStock: line.controlsStock !== false,
    verificationStatus: line.verificationStatus ?? '',
  };
  // Ausente significa "cantidad - proveedor" en el motor de disponibilidad;
  // convertirlo a null haria que Number(null) reserve cero unidades.
  if (line?.internalReservedQty === undefined || line?.internalReservedQty === null) {
    delete summary.internalReservedQty;
  }
  return summary;
};

const summarizeAvailabilityItem = (item = {}) => ({
  id: item.id ?? '',
  name: item.name ?? item.itemName ?? 'Producto',
  sku: item.sku ?? '',
  category: item.category ?? '',
  brand: item.brand ?? '',
  itemColor: item.itemColor ?? item.color ?? '',
  description: item.description ?? '',
  inventoryArea: item.inventoryArea ?? '',
  controlsStock: item.controlsStock !== false,
  verificationStatus: item.verificationStatus ?? '',
  adoptionSource: item.adoptionSource ?? '',
  totalStock: Number(item.totalStock ?? 0),
  availableStock: Number(item.availableStock ?? 0),
  imageUrl: item.thumbnailUrl || item.imageUrl || item.imageDataUrl || item.image || item.photo || '',
  _summaryOnly: true,
  _availabilitySummaryOnly: true,
});

const summarizeAvailabilityClient = (client = {}) => ({
  id: client.id ?? '',
  address: client.address ?? '',
  city: client.city ?? '',
  _summaryOnly: true,
  _availabilitySummaryOnly: true,
});

const summarizeAvailabilityRecord = (record = {}) => ({
  id: record.id ?? '',
  rentalId: record.rentalId ?? '',
  contractId: record.contractId ?? '',
  quoteId: record.quoteId ?? '',
  contractCode: record.contractCode ?? '',
  orderCode: record.orderCode ?? '',
  quoteCode: record.quoteCode ?? '',
  code: record.code ?? '',
  status: record.status ?? '',
  deletedAt: record.deletedAt ?? null,
  createdAt: record.createdAt ?? record.rentalAt ?? null,
  updatedAt: record.updatedAt ?? null,
  clientId: record.clientId ?? record.customerId ?? '',
  customerName: record.customerName ?? record.clientName ?? '',
  customerPhone: record.customerPhone ?? record.phone ?? '',
  eventType: record.eventType ?? '',
  eventDate: record.eventDate ?? null,
  eventTime: record.eventTime ?? '',
  rentalDate: record.rentalDate ?? null,
  deliveryDate: record.deliveryDate ?? null,
  pickupDate: record.pickupDate ?? null,
  dueDate: record.dueDate ?? null,
  validUntil: record.validUntil ?? null,
  dueTime: record.dueTime ?? '',
  deliveryWindowStart: record.deliveryWindowStart ?? '',
  pickupWindowEnd: record.pickupWindowEnd ?? '',
  pickupTimeMode: record.pickupTimeMode ?? '',
  eventAddress: record.eventAddress ?? '',
  deliveryAddress: record.deliveryAddress ?? '',
  serviceAddress: record.serviceAddress ?? '',
  address: record.address ?? '',
  destination: record.destination ?? '',
  city: record.city ?? '',
  items: (Array.isArray(record.items) ? record.items : []).map(summarizeAvailabilityLine),
  _summaryOnly: true,
  _availabilitySummaryOnly: true,
});

const summarizeInventoryRental = (rental = {}) => ({
  id: rental.id ?? '',
  contractId: rental.contractId ?? '',
  contractCode: rental.contractCode ?? '',
  orderCode: rental.orderCode ?? '',
  status: rental.status ?? '',
  deletedAt: rental.deletedAt ?? null,
  createdAt: rental.createdAt ?? rental.rentalAt ?? null,
  updatedAt: rental.updatedAt ?? null,
  cancelledAt: rental.cancelledAt ?? null,
  eventDate: rental.eventDate ?? null,
  rentalDate: rental.rentalDate ?? null,
  dueDate: rental.dueDate ?? null,
  dueTime: rental.dueTime ?? '',
  deliveryWindowStart: rental.deliveryWindowStart ?? '',
  deliveryWindowEnd: rental.deliveryWindowEnd ?? '',
  pickupWindowStart: rental.pickupWindowStart ?? '',
  pickupWindowEnd: rental.pickupWindowEnd ?? '',
  customerName: rental.customerName ?? '',
  customerPhone: rental.customerPhone ?? rental.phone ?? '',
  companyName: rental.companyName ?? '',
  logisticsMode: rental.logisticsMode ?? 'envio',
  eventAddress: rental.eventAddress ?? rental.address ?? '',
  address: rental.address ?? '',
  city: rental.city ?? '',
  createdBy: rental.createdBy ?? '',
  createdByName: rental.createdByName ?? '',
  createdByRole: rental.createdByRole ?? '',
  cancellationPenaltyBs: Number(rental.cancellationPenaltyBs ?? 0),
  depositBs: Number(rental.depositBs ?? 0),
  penaltiesBs: Number(rental.penaltiesBs ?? 0),
  internalPenaltiesBs: Number(rental.internalPenaltiesBs ?? 0),
  refundBs: Number(rental.refundBs ?? 0),
  payment: rental.payment ? structuredClone(rental.payment) : null,
  totals: rental.totals ? structuredClone(rental.totals) : null,
  returnSettlement: rental.returnSettlement ? structuredClone(rental.returnSettlement) : null,
  operational: rental.operational ? structuredClone(rental.operational) : { inventoryStatus: 'pendiente' },
  pickupChecklist: rental.pickupChecklist ? structuredClone(rental.pickupChecklist) : null,
  partialReturnReport: rental.partialReturnReport ? structuredClone(rental.partialReturnReport) : null,
  returnReport: Array.isArray(rental.returnReport) ? rental.returnReport.map((line) => ({
    lineKey: line.lineKey ?? '', itemId: line.itemId ?? '', itemName: line.itemName ?? '',
    returnedQty: Number(line.returnedQty ?? 0), damagedQty: Number(line.damagedQty ?? 0),
    missingQty: Number(line.missingQty ?? 0), pendingClientQty: Number(line.pendingClientQty ?? 0), damageNote: line.damageNote ?? '',
    damagedUnitChargeBs: Number(line.damagedUnitChargeBs ?? 0),
    missingUnitChargeBs: Number(line.missingUnitChargeBs ?? 0),
    damagedFeeBs: Number(line.damagedFeeBs ?? 0),
    missingFeeBs: Number(line.missingFeeBs ?? 0),
    damagedStockLossQty: Number(line.damagedStockLossQty ?? 0),
    missingStockLossQty: Number(line.missingStockLossQty ?? 0),
    stockLossQty: Number(line.stockLossQty ?? 0),
  })) : null,
  items: (Array.isArray(rental.items) ? rental.items : []).map(summarizeInventoryLine),
  _summaryOnly: true,
  _inventorySummaryOnly: true,
});

const summarizeInventoryContract = (contract = {}) => ({
  id: contract.id ?? '',
  rentalId: contract.rentalId ?? '',
  contractCode: contract.contractCode ?? '',
  orderCode: contract.orderCode ?? '',
  status: contract.status ?? '',
  deletedAt: contract.deletedAt ?? null,
  customerName: contract.customerName ?? contract.clientName ?? '',
  eventType: contract.eventType ?? '',
  eventDate: contract.eventDate ?? null,
  logisticsMode: contract.logisticsMode ?? 'envio',
  deliveryDate: contract.deliveryDate ?? null,
  pickupDate: contract.pickupDate ?? null,
  deliveryWindowStart: contract.deliveryWindowStart ?? '',
  deliveryWindowEnd: contract.deliveryWindowEnd ?? '',
  pickupWindowStart: contract.pickupWindowStart ?? '',
  pickupWindowEnd: contract.pickupWindowEnd ?? '',
  address: contract.address ?? contract.deliveryAddress ?? contract.serviceAddress ?? '',
  city: contract.city ?? '',
  _summaryOnly: true,
  _inventorySummaryOnly: true,
});

const summarizeInventoryMovement = (movement = {}) => {
  const fields = [
    'id', 'itemId', 'itemName', 'category', 'type', 'reason', 'detail', 'reference',
    'contractCode', 'deltaUnits', 'beforeTotalStock', 'afterTotalStock',
    'beforeAvailableStock', 'afterAvailableStock', 'reservedStockAfter', 'userName',
    'userRole', 'createdAt', 'operationDate', 'deliveryDate', 'status', 'valueAmount',
    'imageUrl', 'imageDataUrl',
  ];
  return Object.fromEntries(fields
    .filter((field) => movement?.[field] !== undefined && movement?.[field] !== null && movement?.[field] !== '')
    .map((field) => [field, movement[field]]));
};

router.get('/__copetin_db/availability/overview', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    const activeRentals = (Array.isArray(state.rentals) ? state.rentals : []).filter((rental) => {
      const status = String(rental?.status ?? '').trim().toLowerCase();
      return !rental?.deletedAt && !['returned', 'cancelled', 'anulado'].includes(status);
    });
    const activeRentalIds = new Set(activeRentals.map((rental) => String(rental?.id ?? '')).filter(Boolean));
    const activeOrderCodes = new Set(activeRentals.map((rental) => String(rental?.orderCode ?? '')).filter(Boolean));
    const activeContractIds = new Set(activeRentals.map((rental) => String(rental?.contractId ?? '')).filter(Boolean));
    const availabilityContracts = (Array.isArray(state.contracts) ? state.contracts : []).filter((contract) => {
      if (!contract || contract.deletedAt) return false;
      const status = String(contract.status ?? '').trim().toLowerCase();
      const linkedToActiveRental = activeRentalIds.has(String(contract.rentalId ?? ''))
        || activeOrderCodes.has(String(contract.orderCode ?? ''))
        || activeContractIds.has(String(contract.id ?? ''));
      return linkedToActiveRental || (
        !contract.rentalId
        && !contract.orderCode
        && ['aprobado', 'pendiente', 'borrador'].includes(status)
      );
    });
    const availabilityQuotes = (Array.isArray(state.quotes) ? state.quotes : []).filter((quote) => {
      const status = String(quote?.status ?? '').trim().toLowerCase();
      return quote && !quote.deletedAt && !quote.rentalId && !quote.orderCode
        && ['enviada', 'borrador'].includes(status);
    });

    await sendJsonPayload(req, res, {
      revision: snapshot.revision,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      overview: {
        items: (Array.isArray(state.items) ? state.items : []).map(summarizeAvailabilityItem),
        categories: Array.isArray(state.categories) ? state.categories : [],
        clients: (Array.isArray(state.clients) ? state.clients : []).map(summarizeAvailabilityClient),
        contracts: availabilityContracts.map(summarizeAvailabilityRecord),
        rentals: activeRentals.map(summarizeAvailabilityRecord),
        quotes: availabilityQuotes.map(summarizeAvailabilityRecord),
      },
    });
  } catch (error) {
    next(error);
  }
});


router.get('/__copetin_db/inventory/damage-loss-overview', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    const rows = [];
    const inventoryItems = Array.isArray(state.items) ? state.items : [];
    const contracts = Array.isArray(state.contracts) ? state.contracts : [];
    const contractsById = new Map(contracts.map((contract) => [String(contract?.id ?? ''), contract]));

    const appendIssue = (
      rental,
      line,
      lossType,
      quantity,
      unitValueBs,
      totalValueBs,
      occurredAt,
      isPartial = false,
      reportIndex = -1,
      reportKind = 'final',
    ) => {
      const qty = Math.max(0, Math.trunc(Number(quantity ?? 0)));
      if (qty <= 0) return;
      const contract = contractsById.get(String(rental?.contractId ?? '')) ?? null;
      const repairedQty = lossType === 'danado'
        ? Math.min(qty, Math.max(0, Math.trunc(Number(line?.damageRepairedQty ?? 0))))
        : 0;
      rows.push({
        id: `${rental?.id ?? 'rental'}:${reportKind}:${reportIndex}:${line?.lineKey ?? line?.itemId ?? 'item'}:${lossType}:${occurredAt ?? ''}`,
        lossType,
        quantity: qty,
        repairedQty,
        repairableQuantity: lossType === 'danado' ? Math.max(0, qty - repairedQty) : 0,
        repairedAt: line?.damageRepairedAt ?? null,
        repairedByName: String(line?.damageRepairedByName ?? '').trim(),
        repairNote: String(line?.damageRepairNote ?? '').trim(),
        itemId: line?.itemId ?? '',
        itemName: line?.itemName ?? 'Item',
        category: inventoryItems.find((item) => String(item?.id ?? '') === String(line?.itemId ?? ''))?.category ?? '',
        unitValueBs: directMoney(unitValueBs),
        totalValueBs: directMoney(totalValueBs),
        contractId: rental?.contractId ?? '',
        contractCode: rental?.contractCode ?? contract?.contractCode ?? '',
        orderCode: rental?.orderCode ?? contract?.orderCode ?? '',
        rentalId: rental?.id ?? '',
        customerName: rental?.customerName ?? contract?.customerName ?? '',
        note: String(line?.damageNote ?? line?.note ?? '').trim(),
        chargeOwner: String(line?.chargeOwner ?? 'cliente').trim(),
        occurredAt: occurredAt ?? rental?.returnedAt ?? rental?.updatedAt ?? null,
        isPartial,
        reportIndex,
        reportKind,
        lineKey: String(line?.lineKey ?? '').trim(),
      });
    };

    (Array.isArray(state.rentals) ? state.rentals : []).forEach((rental) => {
      if (!rental || rental.deletedAt) return;
      const finalReport = Array.isArray(rental.returnReport) ? rental.returnReport : [];
      finalReport.forEach((line, reportIndex) => {
        const occurredAt = line?.partialRegisteredAt ?? rental?.returnedAt ?? rental?.updatedAt ?? null;
        appendIssue(rental, line, 'danado', line?.damagedQty, line?.damagedUnitChargeBs, line?.damagedFeeBs, occurredAt, false, reportIndex, 'final');
        appendIssue(rental, line, 'faltante', line?.missingQty, line?.missingUnitChargeBs, line?.missingFeeBs, occurredAt, false, reportIndex, 'final');
      });

      // Mientras una devolución siga parcial, solo el daño ya recibido es una pérdida.
      if (!finalReport.length && Array.isArray(rental?.partialReturnReport?.items)) {
        rental.partialReturnReport.items.forEach((line, reportIndex) => {
          const occurredAt = line?.partialRegisteredAt ?? rental?.partialReturnReport?.updatedAt ?? rental?.updatedAt ?? null;
          appendIssue(rental, line, 'danado', line?.damagedQty, line?.damagedUnitChargeBs, line?.damagedFeeBs, occurredAt, true, reportIndex, 'partial');
        });
      }
    });

    rows.sort((a, b) => new Date(b?.occurredAt ?? 0) - new Date(a?.occurredAt ?? 0));
    const summary = rows.reduce((acc, row) => {
      const qty = Number(row.quantity ?? 0);
      const value = Number(row.totalValueBs ?? 0);
      const repairedQty = Number(row.repairedQty ?? 0);
      const repairedValue = directMoney(repairedQty * Number(row.unitValueBs ?? 0));
      acc.totalUnits += qty;
      acc.totalValueBs += value;
      acc.repairedUnits += repairedQty;
      acc.repairedValueBs += repairedValue;
      if (String(row.chargeOwner ?? 'cliente').trim().toLowerCase() === 'cliente') acc.clientChargedBs += value;
      else acc.internalChargedBs += value;
      if (row.lossType === 'danado') {
        acc.damagedUnits += qty;
        acc.damagedValueBs += value;
      } else {
        acc.missingUnits += qty;
        acc.missingValueBs += value;
      }
      return acc;
    }, {
      totalUnits: 0,
      totalValueBs: 0,
      damagedUnits: 0,
      damagedValueBs: 0,
      missingUnits: 0,
      missingValueBs: 0,
      repairedUnits: 0,
      repairedValueBs: 0,
      clientChargedBs: 0,
      internalChargedBs: 0,
    });

    const affectedRentalIds = new Set(rows.map((row) => String(row.rentalId ?? '')).filter(Boolean));
    const cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
    const rentalById = new Map((Array.isArray(state.rentals) ? state.rentals : [])
      .map((rental) => [String(rental?.id ?? ''), rental]));

    const collectDamageCashEntriesForKeys = ({ rentalId, contractId, orderCode }) => cashMovements.flatMap((movement) => {
      if (movement?.voidedAt || String(movement?.receiptStatus ?? '').trim().toLowerCase() === 'anulado') return [];
      const movementRentalId = String(movement?.linkedRentalId ?? movement?.sourceId ?? '').trim();
      const movementContractId = String(movement?.linkedContractId ?? '').trim();
      const movementOrderCode = String(movement?.linkedOrderCode ?? movement?.orderCode ?? movement?.reference ?? '').trim();
      const matches = (rentalId && movementRentalId === rentalId)
        || (contractId && movementContractId === contractId)
        || (orderCode && movementOrderCode === orderCode);
      if (!matches) return [];

      const breakdown = Array.isArray(movement?.collectionBreakdown) ? movement.collectionBreakdown : [];
      const breakdownDamageBs = directMoney(breakdown
        .filter((entry) => String(entry?.target ?? '').trim().toLowerCase() === 'damage')
        .reduce((subtotal, entry) => subtotal + Math.max(0, Number(entry?.amountBs ?? 0)), 0));
      const storedDamageBs = Math.max(0, directMoney(movement?.damageCollectedBs));
      const target = String(movement?.collectionTarget ?? '').trim().toLowerCase();
      const category = String(movement?.category ?? '').trim().toLowerCase();
      const tag = String(movement?.accountingTag ?? '').trim().toLowerCase();
      const type = String(movement?.type ?? '').trim().toLowerCase();
      const isDamageMovement = target === 'damage'
        || category === 'cobro_danos_faltantes'
        || tag === 'contract_damage_collection'
        || type.includes('dano')
        || type.includes('faltante');
      const amountBs = breakdownDamageBs > 0
        ? breakdownDamageBs
        : storedDamageBs > 0
          ? storedDamageBs
          : isDamageMovement
            ? Math.max(0, directMoney(movement?.amountBs))
            : 0;
      if (amountBs <= 0.009) return [];

      return [{
        source: 'cash',
        amountBs,
        paymentMethod: String(movement?.paymentMethod ?? '').trim().toLowerCase() || 'efectivo',
        paymentAccount: String(movement?.paymentAccount ?? '').trim().toUpperCase(),
        receiptCode: String(movement?.receiptCode ?? movement?.receipt ?? '').trim(),
        occurredAt: movement?.createdAt ?? movement?.receiptIssuedAt ?? null,
        registeredBy: String(movement?.responsible ?? movement?.createdByName ?? movement?.userName ?? movement?.createdBy ?? '').trim(),
        movementId: String(movement?.id ?? '').trim(),
      }];
    });

    const guaranteeEntriesForContract = (contractId) => {
      const contract = contractsById.get(String(contractId ?? ''));
      if (!contract) return [];
      const ledger = Array.isArray(contract?.economicLedger) ? contract.economicLedger : [];
      return ledger.flatMap((entry) => {
        if (entry?.deletedAt || String(entry?.type ?? '').trim().toLowerCase() !== 'charge') return [];
        const cashMovementId = String(entry?.cashMovementId ?? '').trim();
        const isCashDamage = String(entry?.cashCollectionTarget ?? '').trim().toLowerCase() === 'damage';
        if (cashMovementId || isCashDamage || entry?.isCashRegistered) return [];
        const amountBs = Math.max(0, directMoney(entry?.amountBs));
        if (amountBs <= 0.009) return [];
        return [{
          source: 'guarantee',
          amountBs,
          paymentMethod: 'garantia',
          paymentAccount: '',
          receiptCode: String(entry?.cashReceiptCode ?? '').trim(),
          occurredAt: entry?.createdAt ?? null,
          registeredBy: String(entry?.createdByName ?? '').trim(),
          note: String(entry?.note ?? '').trim(),
          ledgerId: String(entry?.id ?? '').trim(),
        }];
      });
    };

    summary.economicsByRental = {};
    affectedRentalIds.forEach((rentalId) => {
      const rentalRows = rows.filter((row) => String(row.rentalId ?? '') === rentalId);
      const rental = rentalById.get(rentalId) ?? null;
      const contractId = String(rentalRows[0]?.contractId ?? rental?.contractId ?? '').trim();
      const orderCode = String(rentalRows[0]?.orderCode ?? rental?.orderCode ?? '').trim();
      const clientChargedBs = directMoney(rentalRows.reduce((sum, row) => (
        String(row?.chargeOwner ?? 'cliente').trim().toLowerCase() === 'cliente'
          ? sum + Math.max(0, Number(row?.totalValueBs ?? 0))
          : sum
      ), 0));
      const cashRecoveryEntries = collectDamageCashEntriesForKeys({ rentalId, contractId, orderCode });
      const guaranteeRecoveryEntries = guaranteeEntriesForContract(contractId);
      const recoveryBreakdown = [...guaranteeRecoveryEntries, ...cashRecoveryEntries]
        .sort((a, b) => new Date(a?.occurredAt ?? 0) - new Date(b?.occurredAt ?? 0));
      const cashCollectedBs = directMoney(cashRecoveryEntries.reduce((sum, entry) => sum + Number(entry?.amountBs ?? 0), 0));
      const guaranteeAppliedBs = directMoney(guaranteeRecoveryEntries.reduce((sum, entry) => sum + Number(entry?.amountBs ?? 0), 0));
      const totalRecoveredBs = directMoney(cashCollectedBs + guaranteeAppliedBs);
      const pendingRecoveryBs = directMoney(Math.max(0, clientChargedBs - totalRecoveredBs));
      let collectionStatus = 'pendiente';
      if (clientChargedBs <= 0.009) {
        collectionStatus = 'sin_cargo';
      } else if (pendingRecoveryBs <= 0.009) {
        if (cashCollectedBs > 0.009 && guaranteeAppliedBs > 0.009) collectionStatus = 'cubierto_mixto';
        else if (cashCollectedBs > 0.009) collectionStatus = 'cobrado_caja';
        else if (guaranteeAppliedBs > 0.009) collectionStatus = 'cubierto_garantia';
        else collectionStatus = 'cubierto';
      } else if (totalRecoveredBs > 0.009) {
        collectionStatus = 'parcial';
      }
      summary.economicsByRental[rentalId] = {
        clientChargedBs,
        cashCollectedBs,
        guaranteeAppliedBs,
        totalRecoveredBs,
        pendingRecoveryBs,
        recoveryDifferenceBs: directMoney(totalRecoveredBs - clientChargedBs),
        collectionStatus,
        recoveryBreakdown,
      };
    });

    summary.cashCollectedBs = directMoney(Object.values(summary.economicsByRental)
      .reduce((sum, entry) => sum + Number(entry?.cashCollectedBs ?? 0), 0));
    summary.guaranteeAppliedBs = directMoney(Object.values(summary.economicsByRental)
      .reduce((sum, entry) => sum + Number(entry?.guaranteeAppliedBs ?? 0), 0));
    summary.totalRecoveredBs = directMoney(summary.cashCollectedBs + summary.guaranteeAppliedBs);
    summary.pendingRecoveryBs = directMoney(Math.max(0, summary.clientChargedBs - summary.totalRecoveredBs));
    summary.recoveryDifferenceBs = directMoney(summary.totalRecoveredBs - summary.clientChargedBs);
    summary.remainingPhysicalValueBs = directMoney(Math.max(0, summary.totalValueBs - summary.repairedValueBs));
    Object.keys(summary).filter((key) => key.endsWith('Bs')).forEach((key) => { summary[key] = directMoney(summary[key]); });

    await sendJsonPayload(req, res, {
      revision: snapshot?.revision ?? null,
      version: snapshot?.version ?? null,
      updatedAt: snapshot?.updatedAt ?? null,
      rows: rows.slice(0, 1200),
      total: rows.length,
      summary,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/__copetin_db/inventory/damage-loss/reinsert', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const rentalId = String(payload.rentalId ?? '').trim();
    const itemId = String(payload.itemId ?? '').trim();
    const reportKind = String(payload.reportKind ?? 'final').trim() === 'partial' ? 'partial' : 'final';
    const reportIndex = Math.trunc(Number(payload.reportIndex ?? -1));
    const quantity = Math.trunc(Number(payload.quantity ?? 0));
    const note = String(payload.note ?? '').trim();
    const userName = String(payload.userName ?? payload.createdByName ?? payload.createdBy ?? 'Inventario').trim() || 'Inventario';
    const userRole = String(payload.userRole ?? payload.createdByRole ?? 'Inventario').trim() || 'Inventario';

    if (!rentalId || !itemId || reportIndex < 0) return res.status(400).json({ error: 'La incidencia dañada seleccionada no es válida.' });
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'La cantidad reparada debe ser mayor a 0.' });

    let responseData = null;
    const result = await updateStateSnapshot((state) => {
      state.items = Array.isArray(state.items) ? state.items : [];
      state.rentals = Array.isArray(state.rentals) ? state.rentals : [];
      state.inventoryMovements = Array.isArray(state.inventoryMovements) ? state.inventoryMovements : [];

      const rental = state.rentals.find((entry) => String(entry?.id ?? '') === rentalId && !entry?.deletedAt);
      if (!rental) { const error = new Error('No se encontró la devolución asociada al daño.'); error.statusCode = 404; throw error; }
      const report = reportKind === 'partial'
        ? (Array.isArray(rental?.partialReturnReport?.items) ? rental.partialReturnReport.items : [])
        : (Array.isArray(rental?.returnReport) ? rental.returnReport : []);
      const line = report[reportIndex];
      if (!line || String(line?.itemId ?? '') !== itemId) {
        const error = new Error('La incidencia cambió desde que se cargó la pantalla. Actualiza la vista e inténtalo nuevamente.');
        error.statusCode = 409;
        throw error;
      }

      const damagedQty = Math.max(0, Math.trunc(Number(line?.damagedQty ?? 0)));
      const repairedBefore = Math.min(damagedQty, Math.max(0, Math.trunc(Number(line?.damageRepairedQty ?? 0))));
      const pendingRepairQty = Math.max(0, damagedQty - repairedBefore);
      if (damagedQty <= 0 || pendingRepairQty <= 0) {
        const error = new Error('Este daño ya fue reinsertado completamente o no tiene unidades dañadas.');
        error.statusCode = 409;
        throw error;
      }
      if (quantity > pendingRepairQty) {
        const error = new Error(`Solo quedan ${pendingRepairQty} unidad(es) dañada(s) disponibles para reinsertar.`);
        error.statusCode = 409;
        throw error;
      }

      const item = state.items.find((entry) => String(entry?.id ?? '') === itemId && !entry?.deletedAt);
      if (!item) { const error = new Error('El ítem asociado ya no existe en inventario.'); error.statusCode = 404; throw error; }

      const now = new Date().toISOString();
      const beforeTotalStock = Math.max(0, Number(item.totalStock ?? 0));
      const beforeAvailableStock = Math.max(0, Number(item.availableStock ?? 0));
      item.totalStock = beforeTotalStock + quantity;
      item.availableStock = beforeAvailableStock + quantity;
      item.updatedAt = now;

      line.damageRepairedQty = repairedBefore + quantity;
      line.damageRepairedAt = now;
      line.damageRepairedByName = userName;
      line.damageRepairedByRole = userRole;
      line.damageRepairNote = note;
      line.damageRepairHistory = Array.isArray(line.damageRepairHistory) ? line.damageRepairHistory : [];
      line.damageRepairHistory.unshift({ quantity, note, repairedAt: now, repairedByName: userName, repairedByRole: userRole });
      rental.updatedAt = now;

      const movement = {
        id: directId('mov'),
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        type: 'reinsercion',
        reason: `Reparación de daño · Contrato ${rental.contractCode || rental.orderCode || rental.id}`,
        detail: `${quantity} unidad(es) reparada(s) reinsertada(s)${note ? ` · ${note}` : ''}`,
        reference: rental.orderCode ?? rental.contractCode ?? rental.id,
        deltaUnits: quantity,
        beforeTotalStock,
        afterTotalStock: item.totalStock,
        beforeAvailableStock,
        afterAvailableStock: item.availableStock,
        reservedStockAfter: Math.max(0, Number(item.totalStock ?? 0) - Number(item.availableStock ?? 0)),
        sourceType: 'damage_repair_reinsert',
        sourceRentalId: rental.id,
        sourceId: rental.id,
        sourceContractId: rental.contractId ?? null,
        sourceOrderCode: rental.orderCode ?? null,
        lossType: 'danado',
        repairedQuantity: quantity,
        userName,
        userRole,
        createdAt: now,
        status: 'aprobado',
      };
      state.inventoryMovements.unshift(movement);
      responseData = {
        item: structuredClone(item),
        rentalId: rental.id,
        reportKind,
        reportIndex,
        remainingRepairQty: pendingRepairQty - quantity,
        movement: structuredClone(movement),
      };
      return state;
    });

    await sendJsonPayload(req, res, {
      ...(responseData ?? {}),
      revision: result?.revision ?? null,
      version: result?.version ?? null,
      updatedAt: result?.updatedAt ?? null,
    });
  } catch (error) {
    if (error?.statusCode) { res.status(error.statusCode).json({ error: error.message }); return; }
    next(error);
  }
});

router.post('/__copetin_db/inventory/recoveries/:id/process', async (req, res, next) => {
  try {
    const recoveryId = String(req.params.id ?? '').trim();
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const action = String(payload.action ?? '').trim();
    const quantity = Math.trunc(Number(payload.quantity ?? 0));
    const note = String(payload.note ?? '').trim();
    const userName = String(payload.userName ?? payload.createdByName ?? payload.createdBy ?? '').trim() || 'Sistema';
    const userRole = String(payload.userRole ?? payload.createdByRole ?? '').trim() || 'Operacion';

    if (!recoveryId) return res.status(400).json({ error: 'Debes seleccionar un pendiente para procesar.' });
    if (!['reinsert', 'discard'].includes(action)) return res.status(400).json({ error: 'La accion de reinsercion no es valida.' });
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'La cantidad a procesar debe ser mayor a 0.' });

    let responseData = null;
    const result = await updateStateSnapshot((state) => {
      state.items = Array.isArray(state.items) ? state.items : [];
      state.stockRecoveries = Array.isArray(state.stockRecoveries) ? state.stockRecoveries : [];
      state.inventoryMovements = Array.isArray(state.inventoryMovements) ? state.inventoryMovements : [];

      const recoveryIndex = state.stockRecoveries.findIndex((entry) => String(entry?.id ?? '') === recoveryId);
      if (recoveryIndex < 0) {
        const error = new Error('No se encontro el pendiente seleccionado.');
        error.statusCode = 404;
        throw error;
      }

      const recovery = state.stockRecoveries[recoveryIndex];
      const pendingQuantity = Math.max(0, Math.trunc(Number(recovery?.quantity ?? 0)));
      if (quantity > pendingQuantity) {
        const error = new Error(`La cantidad maxima para este pendiente es ${pendingQuantity}.`);
        error.statusCode = 409;
        throw error;
      }

      const item = state.items.find((entry) => String(entry?.id ?? '') === String(recovery?.itemId ?? ''));
      if (!item) {
        const error = new Error('El item asociado ya no existe.');
        error.statusCode = 404;
        throw error;
      }

      const beforeTotalStock = Number(item.totalStock ?? 0);
      const beforeAvailableStock = Number(item.availableStock ?? 0);
      const now = new Date().toISOString();

      if (action === 'reinsert') {
        const nextAvailableStock = beforeAvailableStock + quantity;
        if (nextAvailableStock > beforeTotalStock) {
          const error = new Error('La reinsercion supera el stock total del item.');
          error.statusCode = 409;
          throw error;
        }
        item.availableStock = nextAvailableStock;
      } else {
        const nextTotalStock = beforeTotalStock - quantity;
        if (nextTotalStock < beforeAvailableStock) {
          const error = new Error('No se puede dar de baja mas unidades de las no disponibles.');
          error.statusCode = 409;
          throw error;
        }
        item.totalStock = nextTotalStock;
      }
      item.updatedAt = now;

      recovery.quantity = pendingQuantity - quantity;
      recovery.updatedAt = now;
      let remainingRecovery = recovery;
      if (recovery.quantity <= 0) {
        state.stockRecoveries.splice(recoveryIndex, 1);
        remainingRecovery = null;
      }

      const movement = {
        id: `mov-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        type: action === 'reinsert' ? 'reinsercion' : 'salida',
        reason: note || (action === 'reinsert'
          ? `Reinsercion desde ${recovery.stage === 'lavado' ? 'lavado' : 'reparacion'}`
          : `Baja definitiva desde ${recovery.stage === 'lavado' ? 'lavado' : 'reparacion'}`),
        detail: action === 'reinsert'
          ? `Reinsertadas ${quantity} unidades (${recovery.stage})`
          : `Baja definitiva de ${quantity} unidades (${recovery.stage})`,
        deltaUnits: action === 'reinsert' ? 0 : -quantity,
        beforeTotalStock,
        afterTotalStock: Number(item.totalStock ?? 0),
        beforeAvailableStock,
        afterAvailableStock: Number(item.availableStock ?? 0),
        reservedStockAfter: Number(item.totalStock ?? 0) - Number(item.availableStock ?? 0),
        userName,
        userRole,
        createdAt: now,
      };
      state.inventoryMovements.push(movement);

      responseData = {
        processed: { recoveryId, action, quantity, itemId: item.id },
        item: { ...item },
        recovery: remainingRecovery ? { ...remainingRecovery } : null,
        movement: summarizeInventoryMovement(movement),
      };
      return state;
    });

    res.json({
      ok: true,
      ...responseData,
      revision: result.revision,
      version: result.version,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});

router.get('/__copetin_db/inventory/movements-overview', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    const allRentals = Array.isArray(state.rentals) ? state.rentals : [];
    // Movimientos filtra por fecha real del evento en el cliente. Por eso el
    // overview no puede recortar devoluciones antiguas a "las últimas 100": ese
    // límite hacía que un mismo rango devolviera cantidades distintas según qué
    // devoluciones hubieran ocurrido después. Enviamos todas las órdenes válidas
    // en forma resumida; canceladas/anuladas no forman parte del flujo operativo.
    const overviewRentals = allRentals.filter((rental) => {
      const status = String(rental?.status ?? '').trim().toLowerCase();
      return !rental?.deletedAt && status !== 'cancelled' && status !== 'anulado';
    });
    const overviewRentalIds = new Set(overviewRentals.map((rental) => String(rental?.id ?? '')).filter(Boolean));
    const overviewContractIds = new Set(overviewRentals.map((rental) => String(rental?.contractId ?? '')).filter(Boolean));
    const allMovements = Array.isArray(state.inventoryMovements) ? state.inventoryMovements : [];
    const movementStats = allMovements.reduce((counts, movement) => {
      counts.total += 1;
      if (movement?.type === 'entrada' || movement?.type === 'reinsercion') counts.entrada += 1;
      else if (movement?.type === 'salida' || movement?.type === 'reserva') counts.salida += 1;
      else counts.ajuste += 1;
      return counts;
    }, { total: 0, entrada: 0, salida: 0, ajuste: 0 });
    const recentMovements = allMovements
      .slice()
      .sort((a, b) => new Date(b?.createdAt ?? b?.operationDate ?? 0) - new Date(a?.createdAt ?? a?.operationDate ?? 0))
      .slice(0, 300)
      .map(summarizeInventoryMovement);

    await sendJsonPayload(req, res, {
      revision: snapshot.revision,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      overview: {
        items: Array.isArray(state.items) ? state.items : [],
        inventoryCombos: Array.isArray(state.inventoryCombos) ? state.inventoryCombos : [],
        categories: Array.isArray(state.categories) ? state.categories : [],
        contracts: (Array.isArray(state.contracts) ? state.contracts : [])
          .filter((contract) => overviewContractIds.has(String(contract?.id ?? '')))
          .map(summarizeInventoryContract),
        rentals: overviewRentals.map(summarizeInventoryRental),
        deliveries: (Array.isArray(state.deliveries) ? state.deliveries : [])
          .filter((delivery) => overviewRentalIds.has(String(delivery?.rentalId ?? '')))
          .map(summarizeOrdersDelivery),
        inventoryMovements: recentMovements,
        movementStats,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/__copetin_db/accounting/base-overview', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    const includeCommercial = String(req.query?.scope ?? 'full').trim().toLowerCase() !== 'petty';
    await sendJsonPayload(req, res, {
      initialized: snapshot.initialized,
      revision: snapshot.revision,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      overview: {
        contracts: includeCommercial
          ? (Array.isArray(state.contracts) ? state.contracts : [])
            .filter((contract) => !contract?.deletedAt)
            .map(summarizeAccountingContract)
          : [],
        rentals: includeCommercial
          ? (Array.isArray(state.rentals) ? state.rentals : [])
            .filter((rental) => !rental?.deletedAt)
            .map(summarizeAccountingRental)
          : [],
        // Caja Grande solo usa clientes con prepago habilitado. El resto se
        // carga cuando se abre Clientes u Ordenes, sin bloquear Contabilidad.
        clients: includeCommercial
          ? (Array.isArray(state.clients) ? state.clients : [])
            .filter((client) => !client?.deletedAt && Boolean(client?.prepaidEnabled))
          : [],
        cashSessions: (Array.isArray(state.cashSessions) ? state.cashSessions : [])
          .filter((session) => !isArchivedAccountingRecord(session)),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/__copetin_db/orders/mobile-overview', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    const allContracts = Array.isArray(state.contracts) ? state.contracts : [];
    await sendJsonPayload(req, res, {
      initialized: snapshot.initialized,
      revision: snapshot.revision,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      overview: {
        contracts: allContracts.filter((contract) => !contract?.deletedAt).map(summarizeOrdersContract),
        hiddenContracts: allContracts.filter((contract) => Boolean(contract?.deletedAt)).map(summarizeOrdersContract),
        rentals: (Array.isArray(state.rentals) ? state.rentals : []).map(summarizeOrdersRental),
        deliveries: (Array.isArray(state.deliveries) ? state.deliveries : []).map(summarizeOrdersDelivery),
        // Cotizaciones permanecen disponibles porque comparten esta misma vista.
        // La numeración es configuración liviana y debe viajar desde el primer render
        // para no mostrar temporalmente 1/2 cuando el correlativo real ya está avanzado.
        quotes: Array.isArray(state.quotes) ? state.quotes : [],
        settings: state.settings ?? {},
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/__copetin_db/orders/editor-overview', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    await sendJsonPayload(req, res, {
      initialized: snapshot.initialized,
      revision: snapshot.revision,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      overview: {
        clients: Array.isArray(state.clients) ? state.clients : [],
        items: Array.isArray(state.items) ? state.items : [],
        inventoryCombos: Array.isArray(state.inventoryCombos) ? state.inventoryCombos : [],
        suppliers: Array.isArray(state.suppliers) ? state.suppliers : [],
        supplierQuotes: Array.isArray(state.supplierQuotes) ? state.supplierQuotes : [],
        supplierLoans: Array.isArray(state.supplierLoans) ? state.supplierLoans : [],
        vehicles: Array.isArray(state.vehicles) ? state.vehicles : [],
        drivers: Array.isArray(state.drivers) ? state.drivers : [],
        users: Array.isArray(state.users) ? state.users : [],
        personnelEmployees: Array.isArray(state.personnelEmployees) ? state.personnelEmployees : [],
        settings: state.settings ?? {},
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/__copetin_db/calendar/mobile-overview', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    await sendJsonPayload(req, res, {
      initialized: snapshot.initialized,
      revision: snapshot.revision,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      overview: {
        contracts: (Array.isArray(state.contracts) ? state.contracts : []).map(summarizeCalendarContract),
        rentals: (Array.isArray(state.rentals) ? state.rentals : []).map(summarizeCalendarRental),
        deliveries: (Array.isArray(state.deliveries) ? state.deliveries : []).map(summarizeCalendarDelivery),
        calendarEvents: Array.isArray(state.calendarEvents) ? state.calendarEvents : [],
      },
    });
  } catch (error) {
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
      requestedNames.map((name) => {
        const rows = Array.isArray(snapshot?.state?.[name]) ? snapshot.state[name] : [];
        if (['cashMovements', 'cashSessions', 'cashDebts'].includes(name)) {
          return [name, rows.filter((row) => !isArchivedAccountingRecord(row))];
        }
        return [name, rows];
      }),
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
