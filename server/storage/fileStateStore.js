import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const defaultStateFile = path.join(projectRoot, 'data', 'app-state.json');
const stateFilePath = path.resolve(process.env.APP_STATE_FILE || defaultStateFile);
let writeQueue = Promise.resolve();

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

    const version = Number(current?.version ?? 0) + 1;
    const checksum = checksumForState(state);
    const updatedAt = new Date().toISOString();

    await writeJsonFile({
      state,
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

    const version = Number(current?.version ?? 0) + 1;
    const checksum = checksumForState(nextState);
    const updatedAt = new Date().toISOString();

    await writeJsonFile({
      state: nextState,
      version,
      checksum,
      updatedAt,
    });

    return {
      ok: true,
      initialized: true,
      state: nextState,
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
