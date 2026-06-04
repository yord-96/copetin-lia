import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const defaultPresenceFile = path.join(projectRoot, 'data', 'presence-state.json');
const presenceFilePath = path.resolve(process.env.APP_PRESENCE_FILE || defaultPresenceFile);
const PRESENCE_TTL_MS = Number(process.env.APP_PRESENCE_TTL_MS ?? 2.5 * 60 * 1000);

let writeQueue = Promise.resolve();

const withWriteLock = async (operation) => {
  const run = writeQueue.then(operation, operation);
  writeQueue = run.catch(() => {});
  return run;
};

const readPresenceFile = async () => {
  try {
    const raw = await fs.readFile(presenceFilePath, 'utf8');
    const payload = JSON.parse(raw);
    if (Array.isArray(payload)) {
      return { presence: payload, updatedAt: null };
    }
    return payload;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { presence: [], updatedAt: null };
    }
    throw error;
  }
};

const writePresenceFile = async (payload) => {
  await fs.mkdir(path.dirname(presenceFilePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(presenceFilePath),
    `.${path.basename(presenceFilePath)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`,
  );

  try {
    await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(temporaryPath, presenceFilePath);
  } catch (error) {
    console.error('[presence-store] No se pudo escribir la presencia del sistema.', {
      presenceFilePath,
      temporaryPath,
      code: error?.code,
      message: error?.message,
    });
    throw error;
  }
};

const cleanText = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const normalizeDevice = (device = {}) => ({
  type: cleanText(device.type, 'desktop'),
  typeLabel: cleanText(device.typeLabel, 'PC'),
  browser: cleanText(device.browser, 'Navegador'),
  os: cleanText(device.os, 'Equipo'),
  label: cleanText(device.label, device.typeLabel || 'PC'),
  screen: cleanText(device.screen),
  userAgent: cleanText(device.userAgent),
});

const normalizePresence = (presence) => {
  const userId = cleanText(presence?.userId);
  const sessionId = cleanText(presence?.sessionId, userId);
  if (!userId || !sessionId) return null;

  const now = new Date().toISOString();
  return {
    sessionId,
    userId,
    fullName: cleanText(presence?.fullName, 'Usuario'),
    role: cleanText(presence?.role, 'Operador'),
    activeTab: cleanText(presence?.activeTab, 'resumen'),
    color: cleanText(presence?.color),
    device: normalizeDevice(presence?.device),
    lastSeenAt: cleanText(presence?.lastSeenAt, now),
    updatedAt: cleanText(presence?.updatedAt ?? presence?.lastSeenAt, now),
  };
};

const getActivePresence = (presence = []) => {
  const threshold = Date.now() - PRESENCE_TTL_MS;
  return presence
    .map(normalizePresence)
    .filter((entry) => entry && new Date(entry.lastSeenAt).getTime() >= threshold)
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
};

export const listPresence = async () => {
  const payload = await readPresenceFile();
  return getActivePresence(payload?.presence);
};

export const heartbeatPresence = async (payload) => {
  const nextPresence = normalizePresence({
    ...payload,
    lastSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (!nextPresence) {
    return listPresence();
  }

  return withWriteLock(async () => {
    const current = await readPresenceFile();
    const activePresence = getActivePresence(current?.presence);
    const nextRows = activePresence.filter((entry) => entry.sessionId !== nextPresence.sessionId);
    nextRows.push(nextPresence);

    await writePresenceFile({
      presence: nextRows,
      updatedAt: new Date().toISOString(),
    });

    return getActivePresence(nextRows);
  });
};

export const leavePresence = async (payload) => {
  const userId = cleanText(payload?.userId);
  const sessionId = cleanText(payload?.sessionId);

  if (!userId && !sessionId) {
    return listPresence();
  }

  return withWriteLock(async () => {
    const current = await readPresenceFile();
    const nextRows = getActivePresence(current?.presence).filter((entry) => {
      if (sessionId) return entry.sessionId !== sessionId;
      return entry.userId !== userId;
    });

    await writePresenceFile({
      presence: nextRows,
      updatedAt: new Date().toISOString(),
    });

    return nextRows;
  });
};

export const getPresenceStoreInfo = () => ({
  storage: 'file',
  presenceFilePath,
});
