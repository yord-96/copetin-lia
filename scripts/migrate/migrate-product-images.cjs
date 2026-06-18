const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config();

const projectRoot = path.resolve(__dirname, '..', '..');

const readArgument = (name) => {
  const direct = process.argv.find((entry) => entry.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
};

const stateFile = path.resolve(
  readArgument('--state')
    || process.env.APP_STATE_FILE
    || path.join(projectRoot, 'data', 'app-state.json'),
);
const uploadDirectory = path.resolve(
  readArgument('--uploads')
    || process.env.PRODUCT_UPLOAD_DIR
    || path.join(projectRoot, 'uploads', 'products'),
);
const backupDirectory = path.resolve(
  readArgument('--backups')
    || path.join(path.dirname(stateFile), 'backups'),
);
const dryRun = process.argv.includes('--dry-run');

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
const backupPath = path.join(
  backupDirectory,
  `app-state-before-image-migration-${timestamp}.json`,
);

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\s]+)$/;
const TYPE_INFO = {
  'image/jpeg': { extension: 'jpg' },
  'image/png': { extension: 'png' },
  'image/webp': { extension: 'webp' },
};

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
  return safe || 'product';
};

const checksumForState = (state) =>
  crypto.createHash('sha256').update(JSON.stringify(state ?? null)).digest('hex').slice(0, 16);

if (!fs.existsSync(stateFile)) {
  console.error(`No existe el archivo de estado: ${stateFile}`);
  process.exit(1);
}

const originalBytes = fs.statSync(stateFile).size;
const document = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const state = document?.state && typeof document.state === 'object' ? document.state : document;
const items = Array.isArray(state.items) ? state.items : [];
const candidates = items.filter((item) => typeof item?.imageDataUrl === 'string' && item.imageDataUrl);

const report = {
  dryRun,
  stateFile,
  uploadDirectory,
  backupPath: dryRun ? null : backupPath,
  originalBytes,
  finalBytes: originalBytes,
  items: items.length,
  candidates: candidates.length,
  migrated: 0,
  failed: 0,
  alreadyUsingImageUrl: items.filter((item) => item?.imageUrl).length,
  uploadedBytes: 0,
  errors: [],
};

if (dryRun) {
  candidates.forEach((item) => {
    const match = DATA_URL_PATTERN.exec(item.imageDataUrl);
    if (!match) {
      report.failed += 1;
      report.errors.push({ itemId: item.id, name: item.name, error: 'Data URL no soportado.' });
      return;
    }
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    const detectedMime = detectMime(buffer);
    if (!detectedMime || detectedMime !== match[1]) {
      report.failed += 1;
      report.errors.push({ itemId: item.id, name: item.name, error: 'Firma de imagen invalida.' });
      return;
    }
    report.migrated += 1;
    report.uploadedBytes += buffer.length;
  });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.failed > 0 ? 2 : 0);
}

if (candidates.length === 0) {
  console.log(JSON.stringify({
    ...report,
    message: 'No hay imagenes base64 pendientes de migracion.',
  }, null, 2));
  process.exit(0);
}

fs.mkdirSync(backupDirectory, { recursive: true });
fs.mkdirSync(uploadDirectory, { recursive: true });
fs.accessSync(uploadDirectory, fs.constants.R_OK | fs.constants.W_OK);
fs.copyFileSync(stateFile, backupPath, fs.constants.COPYFILE_EXCL);

candidates.forEach((item) => {
  try {
    const match = DATA_URL_PATTERN.exec(item.imageDataUrl);
    if (!match) {
      throw new Error('Data URL no soportado; se conserva el original.');
    }
    const declaredMime = match[1];
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    const detectedMime = detectMime(buffer);
    if (!detectedMime || detectedMime !== declaredMime) {
      throw new Error('La firma real no coincide con el MIME; se conserva el original.');
    }
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
    const extension = TYPE_INFO[detectedMime].extension;
    const filename = `${sanitizeIdentifier(item.id)}-${hash}.${extension}`;
    const destination = path.join(uploadDirectory, filename);
    if (!fs.existsSync(destination)) {
      fs.writeFileSync(destination, buffer, { flag: 'wx' });
    }
    const saved = fs.readFileSync(destination);
    const savedHash = crypto.createHash('sha256').update(saved).digest('hex').slice(0, 20);
    if (savedHash !== hash) {
      throw new Error('La verificacion del archivo escrito fallo; se conserva el original.');
    }

    item.imageUrl = `/uploads/products/${filename}`;
    item.imageFile = filename;
    item.imageMigratedAt = new Date().toISOString();
    delete item.imageDataUrl;
    report.migrated += 1;
    report.uploadedBytes += buffer.length;
  } catch (error) {
    report.failed += 1;
    report.errors.push({
      itemId: item?.id ?? null,
      name: item?.name ?? null,
      error: error.message,
    });
  }
});

if (document?.state && typeof document.state === 'object') {
  document.version = Number(document.version ?? 0) + 1;
  document.checksum = checksumForState(state);
  document.updatedAt = new Date().toISOString();
}

const serialized = `${JSON.stringify(document, null, 2)}\n`;
const temporaryPath = `${stateFile}.${process.pid}.${Date.now()}.migrating`;
fs.writeFileSync(temporaryPath, serialized, { flag: 'wx' });
JSON.parse(fs.readFileSync(temporaryPath, 'utf8'));
fs.renameSync(temporaryPath, stateFile);
report.finalBytes = fs.statSync(stateFile).size;
report.savedBytes = report.originalBytes - report.finalBytes;
report.uploadDirectoryBytes = fs.readdirSync(uploadDirectory).reduce((sum, filename) => {
  const filePath = path.join(uploadDirectory, filename);
  return sum + (fs.statSync(filePath).isFile() ? fs.statSync(filePath).size : 0);
}, 0);

console.log(JSON.stringify(report, null, 2));
if (report.failed > 0) {
  console.warn('La migracion termino con errores. Los imageDataUrl fallidos fueron conservados.');
  process.exitCode = 2;
}
