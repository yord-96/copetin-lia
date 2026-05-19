import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const defaultStateFile = path.join(projectRoot, 'data', 'app-state.json');
const stateFilePath = path.resolve(process.env.APP_STATE_FILE || defaultStateFile);

const checksumForState = (state) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(state ?? null))
    .digest('hex')
    .slice(0, 16);

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
  const temporaryPath = `${stateFilePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(temporaryPath, stateFilePath);
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
    revision: `${payload.version ?? 1}:${payload.checksum ?? 'state'}`,
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

export const replaceStateSnapshot = async (state) => {
  await ensureStateStore();
  const current = await readJsonFile();
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
};

export const getStateStoreInfo = () => ({
  storage: 'file',
  stateFilePath,
});
