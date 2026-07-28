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
  returnSettlement: null,
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

router.use('/__copetin_db', requireInternalKey);

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
    const rental = rentals.find((entry) => {
      const rentalIdentifiers = getEconomicContextIdentifiers(entry);
      return [...rentalIdentifiers].some((key) => contractIdentifiers.has(key));
    }) ?? null;

    const identifiers = getEconomicContextIdentifiers(contract, rental);
    const serviceOrder = serviceOrders.find((entry) => {
      const orderIdentifiers = getEconomicContextIdentifiers(entry);
      return [...orderIdentifiers].some((key) => identifiers.has(key));
    }) ?? null;

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


const directMoney = (value) => Number(Math.max(0, Number(value ?? 0)).toFixed(2));
const directId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
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
const findDirectOperation = (state, clientOperationId) => {
  const operationId = String(clientOperationId ?? '').trim();
  if (!operationId) return null;
  return (Array.isArray(state.cashMovements) ? state.cashMovements : [])
    .find((movement) => String(movement?.clientOperationId ?? '') === operationId) ?? null;
};

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

      const rental = state.rentals.find((entry) => String(entry?.id) === rentalId && !entry?.deletedAt);
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

      const target = String(payload.collectionTarget ?? 'balance');
      const mixed = breakdown.length > 1 || target === 'mixed';
      const type = mixed ? 'ingreso_cobro_mixto_contrato' : target === 'transport' ? 'ingreso_transporte_cliente' : target === 'damage' ? 'ingreso_danos_faltantes' : isReturned ? 'cobro_saldo_devolucion' : 'cobro_saldo_alquiler';
      const movement = buildDirectMovement(state, { ...payload, type, amountBs,
        description: String(payload.receiptDetail ?? '').trim().split('\n').filter(Boolean).slice(0,2).join(' | ') || String(payload.note ?? '').trim() || `Cobro contrato: ${rental.customerName ?? ''}`,
        sourceType: isReturned ? 'return' : 'rental', sourceId: rental.id, cashBoxType: 'BIG_CASH',
        category: String(payload.category ?? '').trim() || (mixed ? 'cobro_mixto_contrato' : target === 'transport' ? 'transporte_cobrado' : target === 'damage' ? 'cobro_danos_faltantes' : isReturned ? 'cobro_liquidacion' : 'cobro_contrato'),
        linkedRentalId: rental.id, linkedContractId: rental.contractId, linkedOrderCode: rental.orderCode,
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

    const ledger = normalizeEconomicLedgerRows(req.body.economicLedger);
    const now = new Date().toISOString();
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

      updatedContract = {
        ...contracts[contractIndex],
        economicLedger: ledger,
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
      rows: ledger.length,
      firstAmountBs: ledger[0]?.amountBs ?? null,
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
