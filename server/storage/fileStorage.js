import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const uploadRoot = path.resolve(process.env.UPLOAD_ROOT || path.join(projectRoot, 'uploads'));

export const getUploadRoot = () => uploadRoot;

export const checksumFile = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

export const resolveUploadPath = (relativePath) => {
  const clean = String(relativePath ?? '').replace(/^\/+/, '');
  const resolved = path.resolve(projectRoot, clean);
  if (!resolved.startsWith(uploadRoot)) {
    throw new Error('Ruta de archivo fuera de uploads.');
  }
  return resolved;
};

export const getUploadMetadata = async (url) => {
  const cleanUrl = String(url ?? '').trim();
  if (!cleanUrl.startsWith('/uploads/')) return null;
  const storagePath = cleanUrl.replace(/^\/+/, '');
  const filePath = resolveUploadPath(storagePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) return null;
  return {
    url: cleanUrl,
    storagePath,
    sizeBytes: stat.size,
    checksum: await checksumFile(filePath),
  };
};
