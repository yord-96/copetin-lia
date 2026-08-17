import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const defaultUploadDirectory = path.join(projectRoot, 'uploads', 'economic-receipts');
const uploadDirectory = path.resolve(process.env.ECONOMIC_RECEIPT_UPLOAD_DIR || defaultUploadDirectory);
const publicPrefix = '/uploads/economic-receipts';

const IMAGE_TYPES = {
  'image/jpeg': { extension: 'jpg' },
  'image/png': { extension: 'png' },
  'image/webp': { extension: 'webp' },
};

const detectImageMime = (buffer) => {
  if (
    buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
  ) return 'image/jpeg';

  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return 'image/png';

  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';

  return null;
};

const sanitizeIdentifier = (value, fallback) => {
  const safe = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return safe || fallback;
};

const sanitizeFilename = (value) => path.basename(String(value ?? '').trim());

export const getEconomicReceiptUploadInfo = () => ({
  uploadDirectory,
  publicPrefix,
});

export const ensureEconomicReceiptUploadDirectory = async () => {
  await fs.mkdir(uploadDirectory, { recursive: true });
  await fs.access(uploadDirectory);
  return uploadDirectory;
};

export const validateEconomicReceiptImage = (buffer, declaredMime = '') => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('La imagen del comprobante esta vacia.');
  }
  const detectedMime = detectImageMime(buffer);
  if (!detectedMime || !IMAGE_TYPES[detectedMime]) {
    throw new Error('El comprobante debe ser una imagen JPG, PNG o WEBP valida.');
  }
  if (declaredMime && declaredMime !== 'application/octet-stream' && declaredMime !== detectedMime) {
    throw new Error('El contenido de la imagen no coincide con su tipo declarado.');
  }
  return {
    mimeType: detectedMime,
    extension: IMAGE_TYPES[detectedMime].extension,
  };
};

export const saveEconomicReceiptImage = async ({ buffer, declaredMime, contractId, ledgerEntryId }) => {
  await ensureEconomicReceiptUploadDirectory();
  const { mimeType, extension } = validateEconomicReceiptImage(buffer, declaredMime);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
  const contractPart = sanitizeIdentifier(contractId, 'contract');
  const ledgerPart = sanitizeIdentifier(ledgerEntryId, 'ledger');
  const filename = `${contractPart}-${ledgerPart}-${hash}.${extension}`;
  const destination = path.join(uploadDirectory, filename);
  await fs.writeFile(destination, buffer, { flag: 'wx' }).catch((error) => {
    if (error?.code !== 'EEXIST') throw error;
  });
  return {
    filename,
    mimeType,
    bytes: buffer.length,
    imageUrl: `${publicPrefix}/${filename}`,
    absolutePath: destination,
  };
};

export const deleteEconomicReceiptImage = async (filename) => {
  const safeFilename = sanitizeFilename(filename);
  if (!safeFilename || safeFilename !== filename) {
    throw new Error('Nombre de comprobante invalido.');
  }
  const destination = path.join(uploadDirectory, safeFilename);
  await fs.unlink(destination).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return { ok: true, filename: safeFilename };
};
