import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const readArgument = (name) => {
  const direct = process.argv.find((entry) => entry.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
};

const mode = process.argv.includes('--apply') ? 'apply' : 'dry-run';
const dryRun = mode === 'dry-run';
const stateFile = path.resolve(
  readArgument('--state')
    || process.env.APP_STATE_FILE
    || path.join(projectRoot, 'data', 'app-state.json'),
);
const uploadDirectory = path.resolve(
  readArgument('--uploads')
    || process.env.ATTENDANCE_UPLOAD_DIR
    || path.join(projectRoot, 'uploads', 'attendance'),
);
const backupDirectory = path.resolve(
  readArgument('--backups')
    || path.join(path.dirname(stateFile), 'backups'),
);

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\s]+)$/;
const TYPE_INFO = {
  'image/jpeg': { extension: 'jpg' },
  'image/png': { extension: 'png' },
  'image/webp': { extension: 'webp' },
};

const now = new Date();
const timestamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
  '-',
  String(now.getHours()).padStart(2, '0'),
  String(now.getMinutes()).padStart(2, '0'),
  String(now.getSeconds()).padStart(2, '0'),
].join('');
const backupPath = path.join(backupDirectory, `app-state-before-attendance-photo-migration-${timestamp}.json`);

const detectMime = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
};

const sanitizeIdentifier = (value) => {
  const safe = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return safe || 'attendance';
};

const checksumForState = (state) =>
  crypto.createHash('sha256').update(JSON.stringify(state ?? null)).digest('hex').slice(0, 16);

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (!dryRun && !process.argv.includes('--apply')) {
  fail('Para modificar archivos debes ejecutar con --apply.');
}
if (!fs.existsSync(stateFile)) {
  fail(`No existe el archivo de estado: ${stateFile}`);
}

let document;
try {
  document = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
} catch (error) {
  fail(`No se pudo parsear el JSON. No se modifico nada. ${error.message}`);
}

const state = document?.state && typeof document.state === 'object' ? document.state : document;
const records = Array.isArray(state.attendanceRecords) ? state.attendanceRecords : [];
const originalBytes = fs.statSync(stateFile).size;
const candidates = records.filter((record) => String(record?.photoDataUrl ?? '').trim());

const report = {
  mode,
  stateFile,
  uploadDirectory,
  backupPath: dryRun ? null : backupPath,
  originalBytes,
  finalBytes: originalBytes,
  records: records.length,
  candidates: candidates.length,
  migrated: 0,
  skipped: records.filter((record) => record?.photoUrl && !record?.photoDataUrl).length,
  uploadedBytes: 0,
  removedJsonBytes: 0,
  plannedFiles: [],
  errors: [],
};

const prepared = [];

for (const record of candidates) {
  const dataUrl = String(record?.photoDataUrl ?? '').trim();
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) {
    report.errors.push({ recordId: record?.id ?? null, error: 'Data URL no soportado.' });
    continue;
  }
  const declaredMime = match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  const detectedMime = detectMime(buffer);
  if (!detectedMime || detectedMime !== declaredMime) {
    report.errors.push({ recordId: record?.id ?? null, error: 'Firma de imagen invalida.' });
    continue;
  }
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
  const extension = TYPE_INFO[detectedMime].extension;
  const filename = `${sanitizeIdentifier(record?.id)}-${hash}.${extension}`;
  const destination = path.join(uploadDirectory, filename);
  prepared.push({
    record,
    recordId: record?.id ?? null,
    buffer,
    mimeType: detectedMime,
    filename,
    destination,
    photoUrl: `/uploads/attendance/${filename}`,
    dataUrlBytes: Buffer.byteLength(dataUrl),
  });
  report.plannedFiles.push({ recordId: record?.id ?? null, filename, bytes: buffer.length, mimeType: detectedMime });
  report.uploadedBytes += buffer.length;
  report.removedJsonBytes += Buffer.byteLength(dataUrl);
}

if (report.errors.length > 0) {
  console.error(JSON.stringify(report, null, 2));
  fail('Migracion abortada: hay fotos invalidas. No se modifico nada.');
}

if (dryRun) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (prepared.length === 0) {
  console.log(JSON.stringify({
    ...report,
    message: 'No hay fotos base64 de asistencia pendientes de migracion.',
  }, null, 2));
  process.exit(0);
}

fs.mkdirSync(backupDirectory, { recursive: true });
fs.mkdirSync(uploadDirectory, { recursive: true });
fs.accessSync(uploadDirectory, fs.constants.R_OK | fs.constants.W_OK);
fs.copyFileSync(stateFile, backupPath, fs.constants.COPYFILE_EXCL);

for (const entry of prepared) {
  if (fs.existsSync(entry.destination)) {
    const existing = fs.readFileSync(entry.destination);
    const existingHash = crypto.createHash('sha256').update(existing).digest('hex').slice(0, 20);
    const expectedHash = crypto.createHash('sha256').update(entry.buffer).digest('hex').slice(0, 20);
    if (existingHash !== expectedHash || existing.length === 0) {
      fail(`Migracion abortada: existe un archivo distinto para ${entry.filename}. Backup creado en ${backupPath}.`);
    }
  } else {
    fs.writeFileSync(entry.destination, entry.buffer, { flag: 'wx' });
  }
  const stat = fs.statSync(entry.destination);
  if (!stat.isFile() || stat.size <= 0) {
    fail(`Migracion abortada: no se pudo validar ${entry.filename}. Backup creado en ${backupPath}.`);
  }
}

for (const entry of prepared) {
  entry.record.photoUrl = entry.photoUrl;
  entry.record.photoMimeType = entry.mimeType;
  entry.record.photoSizeBytes = entry.buffer.length;
  entry.record.photoMigratedAt = new Date().toISOString();
  delete entry.record.photoDataUrl;
  report.migrated += 1;
  console.log(`Migrado ${entry.recordId ?? 'sin-id'} -> ${entry.photoUrl}`);
}

if (document?.state && typeof document.state === 'object') {
  document.version = Number(document.version ?? 0) + 1;
  document.checksum = checksumForState(state);
  document.updatedAt = new Date().toISOString();
}

const serialized = `${JSON.stringify(document, null, 2)}\n`;
const temporaryPath = `${stateFile}.${process.pid}.${Date.now()}.attendance-migrating`;
fs.writeFileSync(temporaryPath, serialized, { flag: 'wx' });
JSON.parse(fs.readFileSync(temporaryPath, 'utf8'));
fs.renameSync(temporaryPath, stateFile);

report.finalBytes = fs.statSync(stateFile).size;
report.savedBytes = report.originalBytes - report.finalBytes;

console.log(JSON.stringify(report, null, 2));
