import { Router } from 'express';
import crypto from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { getStateMeta, getStateSnapshot, replaceStateSnapshot, updateStateSnapshot } from '../storage/fileStateStore.js';
import { heartbeatPresence, leavePresence, listPresence } from '../storage/presenceStore.js';

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
  ...deferredBootstrapCollections,
  ...summarizedBootstrapCollections,
]);

const summarizeItemLine = (line = {}) => ({
  itemId: line.itemId ?? '',
  itemName: line.itemName ?? line.name ?? '',
  name: line.name ?? line.itemName ?? '',
  quantity: line.quantity ?? 0,
  controlsStock: line.controlsStock,
  verificationStatus: line.verificationStatus,
  supplierBackedQty: line.supplierBackedQty ?? 0,
  internalReservedQty: line.internalReservedQty ?? null,
  serviceDayId: line.serviceDayId ?? null,
  serviceDate: line.serviceDate ?? null,
  serviceDayLabel: line.serviceDayLabel ?? null,
});

const summarizeContract = (contract = {}) => ({
  ...contract,
  items: (Array.isArray(contract.items) ? contract.items : []).map(summarizeItemLine),
  revisionHistory: [],
  economicLedger: [],
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
