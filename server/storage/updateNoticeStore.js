import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const defaultNoticeFile = path.join(projectRoot, 'data', 'update-notice.json');
const noticeFilePath = path.resolve(process.env.APP_UPDATE_NOTICE_FILE || defaultNoticeFile);

let writeLock = Promise.resolve();

const cleanText = (value, fallback = '') => String(value ?? fallback).trim();

const withWriteLock = async (operation) => {
  const next = writeLock.then(operation, operation);
  writeLock = next.catch(() => {});
  return next;
};

const readNoticeFile = async () => {
  try {
    const raw = await fs.readFile(noticeFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
};

const writeNoticeFile = async (payload) => {
  await fs.mkdir(path.dirname(noticeFilePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(noticeFilePath),
    `.${path.basename(noticeFilePath)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`,
  );
  await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2));
  await fs.rename(temporaryPath, noticeFilePath);
};

const normalizeNotice = (notice = {}) => {
  const version = cleanText(notice.version);
  const message = cleanText(notice.message, 'Hay nuevas mejoras. Te recomiendo actualizar.');
  if (!version || !message) return null;
  return {
    id: cleanText(notice.id, version),
    version,
    message,
    status: cleanText(notice.status, 'active') === 'active' ? 'active' : 'inactive',
    publishedAt: cleanText(notice.publishedAt, new Date().toISOString()),
    publishedBy: cleanText(notice.publishedBy, 'Developer'),
  };
};

export const getUpdateNotice = async () => {
  const payload = await readNoticeFile();
  return normalizeNotice(payload.notice);
};

export const publishUpdateNotice = async (payload = {}) => withWriteLock(async () => {
  const now = new Date().toISOString();
  const notice = normalizeNotice({
    id: crypto.randomUUID(),
    version: cleanText(payload.version, `${Date.now()}`),
    message: cleanText(payload.message, 'Hay nuevas mejoras. Te recomiendo actualizar.'),
    status: 'active',
    publishedAt: now,
    publishedBy: cleanText(payload.publishedBy, 'Developer'),
  });
  await writeNoticeFile({ notice, updatedAt: now });
  return notice;
});

export const clearUpdateNotice = async () => withWriteLock(async () => {
  const now = new Date().toISOString();
  await writeNoticeFile({ notice: null, updatedAt: now });
  return null;
});

export { noticeFilePath };
