import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const defaultStateFile = path.join(projectRoot, 'data', 'lincoln-state.json');
const stateFilePath = path.resolve(process.env.LINCOLN_STATE_FILE || defaultStateFile);
const copetinStateFilePath = path.resolve(process.env.APP_STATE_FILE || path.join(projectRoot, 'data', 'app-state.json'));
if (stateFilePath === copetinStateFilePath) {
  throw new Error('LINCOLN_STATE_FILE debe ser diferente de APP_STATE_FILE para impedir mezcla de datos.');
}
let writeQueue = Promise.resolve();
let cachedPayload = null;
let cachedSignature = null;

const createEmptyLincolnState = () => ({
  schemaVersion: 1,
  company: {
    id: 'lincoln',
    name: 'Centro de Eventos Lincoln',
    timezone: 'America/La_Paz',
    currency: 'BOB',
  },
  reservations: [],
  leads: [],
  events: [],
  rooms: [],
  packages: [],
  clients: [],
  suppliers: [],
  inventory: [],
  payments: [],
  auditLog: [],
});

const checksumForState = (state) => crypto
  .createHash('sha256')
  .update(JSON.stringify(state ?? null))
  .digest('hex')
  .slice(0, 16);

const signatureForFile = async () => {
  try {
    const stats = await fs.stat(stateFilePath);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const writePayload = async (payload) => {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  const temporaryPath = `${stateFilePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const serialized = JSON.stringify(payload, null, 2);
    await fs.writeFile(temporaryPath, serialized, 'utf8');
    if (process.platform === 'win32') {
      await fs.writeFile(stateFilePath, serialized, 'utf8');
    } else {
      await fs.rename(temporaryPath, stateFilePath);
    }
    cachedPayload = payload;
    cachedSignature = await signatureForFile();
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
};

const readPayload = async () => {
  const signature = await signatureForFile();
  if (signature && cachedPayload && cachedSignature === signature) return cachedPayload;
  if (!signature) return null;
  const payload = JSON.parse(await fs.readFile(stateFilePath, 'utf8'));
  cachedPayload = payload;
  cachedSignature = signature;
  return payload;
};

export const ensureLincolnStateStore = async () => {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  if (await signatureForFile()) return;
  const state = createEmptyLincolnState();
  const updatedAt = new Date().toISOString();
  await writePayload({
    state,
    version: 1,
    checksum: checksumForState(state),
    updatedAt,
  });
};

export const getLincolnStateSnapshot = async () => {
  await ensureLincolnStateStore();
  const payload = await readPayload();
  return {
    initialized: Boolean(payload?.state),
    state: payload?.state ?? createEmptyLincolnState(),
    version: Number(payload?.version ?? 1),
    revision: payload?.state ? `${payload.version ?? 1}:${payload.checksum ?? 'state'}` : null,
    updatedAt: payload?.updatedAt ?? null,
  };
};

export const replaceLincolnStateSnapshot = async (state, expectedRevision) => {
  const operation = writeQueue.then(async () => {
    const current = await getLincolnStateSnapshot();
    if (String(expectedRevision ?? '') !== String(current.revision ?? '')) {
      const error = new Error('La revision de Lincoln no coincide con la version actual.');
      error.statusCode = 409;
      error.code = 'LINCOLN_REVISION_CONFLICT';
      throw error;
    }
    const nextState = state && typeof state === 'object' && !Array.isArray(state)
      ? state
      : createEmptyLincolnState();
    const version = current.version + 1;
    const checksum = checksumForState(nextState);
    const updatedAt = new Date().toISOString();
    await writePayload({ state: nextState, version, checksum, updatedAt });
    return { ok: true, version, revision: `${version}:${checksum}`, updatedAt };
  });
  writeQueue = operation.catch(() => {});
  return operation;
};

export const getLincolnStateStoreInfo = () => ({ storage: 'file', stateFilePath });
