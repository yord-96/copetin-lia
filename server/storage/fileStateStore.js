import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const defaultStateFile = path.join(projectRoot, 'data', 'app-state.json');
const stateFilePath = path.resolve(process.env.APP_STATE_FILE || defaultStateFile);
let writeQueue = Promise.resolve();

const protectedBusinessCollections = [
  'items',
  'inventoryCombos',
  'clients',
  'quotes',
  'contracts',
  'rentals',
  'deliveries',
  'transportRoutes',
  'cashMovements',
  'cashDebts',
  'inventoryMovements',
  'stockRecoveries',
  'suppliers',
  'supplierQuotes',
  'supplierLoans',
  'calendarEvents',
  'generatedReports',
];

const destructiveResetActions = new Set(['database_import', 'execute']);

const checksumForState = (state) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(state ?? null))
    .digest('hex')
    .slice(0, 16);

const revisionForPayload = (payload) =>
  payload?.state
    ? `${payload.version ?? 1}:${payload.checksum ?? 'state'}`
    : null;

const normalizeRevision = (revision) => {
  if (revision === null) return null;
  const value = String(revision ?? '').trim();
  return value || null;
};

const readJsonFile = async () => {
  try {
    const raw = await fs.readFile(stateFilePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

const writeJsonFile = async (payload) => {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(stateFilePath),
    `.${path.basename(stateFilePath)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`,
  );

  try {
    await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(temporaryPath, stateFilePath);
  } catch (error) {
    console.error('[state-store] No se pudo escribir el estado del sistema.', {
      stateFilePath,
      temporaryPath,
      code: error?.code,
      message: error?.message,
    });
    throw error;
  }
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value ?? null));

const countProtectedBusinessRows = (state) =>
  protectedBusinessCollections.reduce((total, collection) => (
    total + (Array.isArray(state?.[collection]) ? state[collection].length : 0)
  ), 0);

const hasRecentDestructiveResetLog = (state) => {
  const logs = Array.isArray(state?.resetLogs) ? state.resetLogs : [];
  const cutoff = Date.now() - 15 * 60 * 1000;
  return logs.some((log) => {
    const action = String(log?.action ?? '').trim();
    if (!destructiveResetActions.has(action)) return false;
    if (String(log?.result ?? '').trim() === 'error') return false;
    const createdAt = new Date(log?.createdAt ?? '').getTime();
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  });
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const countLineMoneyRows = (record) =>
  (Array.isArray(record?.items) ? record.items : []).filter((line) => Math.max(
    toNumber(line?.unitPriceBs),
    toNumber(line?.rentalPriceBs),
    toNumber(line?.grossLineTotalBs),
    toNumber(line?.lineTotalBs),
    0,
  ) > 0).length;

const totalBs = (record) => toNumber(record?.totals?.totalBs ?? record?.totalBs);

const planRows = (value) => (Array.isArray(value) ? value.length : 0);

const hasPricingPlanData = (record) =>
  Boolean(record?.pricingPlan && typeof record.pricingPlan === 'object' && Object.keys(record.pricingPlan).length > 0);

const hasSameCommercialShape = (currentRecord, nextRecord) =>
  Math.abs(totalBs(currentRecord) - totalBs(nextRecord)) <= 0.01
  && (Array.isArray(currentRecord?.items) ? currentRecord.items.length : 0)
    === (Array.isArray(nextRecord?.items) ? nextRecord.items.length : 0);

const assertNoCommercialRecordRegression = (collection, currentRecord, nextRecord) => {
  if (!currentRecord || !nextRecord) return;
  const label = collection === 'contracts' ? 'contrato' : 'orden';
  const code = currentRecord.contractCode ?? currentRecord.orderCode ?? currentRecord.number ?? currentRecord.id;

  if (nextRecord._summaryOnly) {
    const error = new Error(`Guardado bloqueado por seguridad: el ${label} ${code} venia resumido y podria borrar precios o proveedores historicos.`);
    error.code = 'STATE_SUMMARY_RECORD_BLOCKED';
    error.statusCode = 409;
    throw error;
  }

  if (!hasSameCommercialShape(currentRecord, nextRecord)) return;

  const currentMoneyRows = countLineMoneyRows(currentRecord);
  const nextMoneyRows = countLineMoneyRows(nextRecord);
  if (totalBs(currentRecord) > 0 && currentMoneyRows > 0 && nextMoneyRows === 0) {
    const error = new Error(`Guardado bloqueado por seguridad: el ${label} ${code} perderia todos sus precios por linea.`);
    error.code = 'STATE_LINE_MONEY_REGRESSION_BLOCKED';
    error.statusCode = 409;
    throw error;
  }

  const currentSupplierRows = planRows(currentRecord.supplierFulfillmentPlan);
  const nextSupplierRows = planRows(nextRecord.supplierFulfillmentPlan);
  if (currentSupplierRows > 0 && nextSupplierRows === 0) {
    const error = new Error(`Guardado bloqueado por seguridad: el ${label} ${code} perderia su plan de proveedores.`);
    error.code = 'STATE_SUPPLIER_PLAN_REGRESSION_BLOCKED';
    error.statusCode = 409;
    throw error;
  }

  if (hasPricingPlanData(currentRecord) && !hasPricingPlanData(nextRecord)) {
    const error = new Error(`Guardado bloqueado por seguridad: el ${label} ${code} perderia su plan de precios.`);
    error.code = 'STATE_PRICING_PLAN_REGRESSION_BLOCKED';
    error.statusCode = 409;
    throw error;
  }
};

const assertNoCommercialDataRegression = (currentState, nextState) => {
  ['contracts', 'rentals'].forEach((collection) => {
    const currentRows = Array.isArray(currentState?.[collection]) ? currentState[collection] : [];
    const nextRows = Array.isArray(nextState?.[collection]) ? nextState[collection] : [];
    const currentById = new Map(currentRows
      .map((row) => [String(row?.id ?? '').trim(), row])
      .filter(([id]) => id));

    nextRows.forEach((nextRecord) => {
      const id = String(nextRecord?.id ?? '').trim();
      if (!id) return;
      assertNoCommercialRecordRegression(collection, currentById.get(id), nextRecord);
    });
  });
};

const preserveFullCommercialRecords = (currentState, nextState) => {
  if (!currentState || !nextState) return nextState;
  const next = { ...nextState };

  ['contracts', 'rentals'].forEach((collection) => {
    const currentRows = Array.isArray(currentState?.[collection]) ? currentState[collection] : [];
    const nextRows = Array.isArray(nextState?.[collection]) ? nextState[collection] : [];
    if (!nextRows.length) return;

    const currentById = new Map(currentRows
      .map((row) => [String(row?.id ?? '').trim(), row])
      .filter(([id]) => id));

    let changed = false;
    const mergedRows = nextRows.map((row) => {
      if (!row?._summaryOnly) return row;
      const current = currentById.get(String(row?.id ?? '').trim());
      if (!current || current._summaryOnly) return row;
      changed = true;
      return current;
    });

    if (changed) {
      console.warn('[state-store] Registros resumidos preservados desde estado completo.', {
        collection,
        preserved: mergedRows.filter((row, index) => row !== nextRows[index]).length,
      });
      next[collection] = mergedRows;
    }
  });

  return next;
};

const assertSafeStateTransition = (currentState, nextState) => {
  if (!currentState || !nextState) return;

  if (!hasRecentDestructiveResetLog(nextState)) {
    assertNoCommercialDataRegression(currentState, nextState);
  }

  const currentRows = countProtectedBusinessRows(currentState);
  const nextRows = countProtectedBusinessRows(nextState);
  if (currentRows < 50) return;
  if (nextRows > Math.max(10, Math.floor(currentRows * 0.15))) return;
  if (hasRecentDestructiveResetLog(nextState)) return;

  const error = new Error(
    `Guardado bloqueado por seguridad: la base pasaria de ${currentRows} registros operativos a ${nextRows}. Usa el panel de importacion/reset confirmado si realmente quieres reemplazarla.`,
  );
  error.code = 'STATE_DESTRUCTIVE_REPLACE_BLOCKED';
  error.statusCode = 409;
  error.currentRows = currentRows;
  error.nextRows = nextRows;
  throw error;
};

const withWriteLock = async (operation) => {
  const run = writeQueue.then(operation, operation);
  writeQueue = run.catch(() => {});
  return run;
};

export const ensureStateStore = async () => {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
};

export const getStateSnapshot = async () => {
  await ensureStateStore();
  const payload = await readJsonFile();

  if (!payload?.state) {
    return {
      initialized: false,
      state: null,
      revision: null,
      version: 0,
      updatedAt: null,
    };
  }

  return {
    initialized: true,
    state: payload.state,
    revision: revisionForPayload(payload),
    version: Number(payload.version ?? 1),
    updatedAt: payload.updatedAt ?? null,
  };
};

export const getStateMeta = async () => {
  const snapshot = await getStateSnapshot();
  return {
    initialized: snapshot.initialized,
    revision: snapshot.revision,
    version: snapshot.version,
    updatedAt: snapshot.updatedAt,
  };
};

export const replaceStateSnapshot = async (state, expectedRevision) => {
  return withWriteLock(async () => {
    await ensureStateStore();
    const current = await readJsonFile();
    const currentRevision = revisionForPayload(current);
    const providedRevision = normalizeRevision(expectedRevision);

    if (providedRevision !== currentRevision) {
      const error = new Error('La revision enviada no coincide con la revision actual.');
      error.code = 'STATE_REVISION_CONFLICT';
      error.currentRevision = currentRevision;
      error.providedRevision = providedRevision;
      error.version = Number(current?.version ?? 0);
      error.updatedAt = current?.updatedAt ?? null;
      throw error;
    }

    const safeState = preserveFullCommercialRecords(current?.state, state);
    assertSafeStateTransition(current?.state, safeState);

    const version = Number(current?.version ?? 0) + 1;
    const checksum = checksumForState(safeState);
    const updatedAt = new Date().toISOString();

    await writeJsonFile({
      state: safeState,
      version,
      checksum,
      updatedAt,
    });

    return {
      ok: true,
      revision: `${version}:${checksum}`,
      version,
      updatedAt,
    };
  });
};

export const updateStateSnapshot = async (updater, expectedRevision = undefined) => {
  if (typeof updater !== 'function') {
    throw new Error('Debes enviar una funcion de actualizacion.');
  }

  return withWriteLock(async () => {
    await ensureStateStore();
    const current = await readJsonFile();
    const currentRevision = revisionForPayload(current);
    if (expectedRevision !== undefined && normalizeRevision(expectedRevision) !== currentRevision) {
      const error = new Error('La revision enviada no coincide con la revision actual.');
      error.code = 'STATE_REVISION_CONFLICT';
      error.currentRevision = currentRevision;
      error.providedRevision = normalizeRevision(expectedRevision);
      error.version = Number(current?.version ?? 0);
      error.updatedAt = current?.updatedAt ?? null;
      throw error;
    }

    if (!current?.state) {
      return {
        ok: false,
        initialized: false,
        state: null,
        revision: null,
        version: 0,
        updatedAt: null,
      };
    }

    const nextState = await updater(cloneJson(current.state));
    if (!nextState || typeof nextState !== 'object' || Array.isArray(nextState)) {
      return {
        ok: true,
        initialized: true,
        state: current.state,
        revision: revisionForPayload(current),
        version: Number(current.version ?? 1),
        updatedAt: current.updatedAt ?? null,
      };
    }

    const safeState = preserveFullCommercialRecords(current.state, nextState);
    assertSafeStateTransition(current.state, safeState);

    const version = Number(current?.version ?? 0) + 1;
    const checksum = checksumForState(safeState);
    const updatedAt = new Date().toISOString();

    await writeJsonFile({
      state: safeState,
      version,
      checksum,
      updatedAt,
    });

    return {
      ok: true,
      initialized: true,
      state: safeState,
      revision: `${version}:${checksum}`,
      version,
      updatedAt,
    };
  });
};

export const getStateStoreInfo = () => ({
  storage: 'file',
  stateFilePath,
});
