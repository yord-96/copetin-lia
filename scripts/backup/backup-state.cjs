const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
require('dotenv').config();

const projectRoot = path.resolve(__dirname, '..', '..');
const stateFile = path.resolve(projectRoot, process.env.APP_STATE_FILE || 'data/app-state.json');
const backupsDir = path.resolve(projectRoot, process.env.BACKUP_DIR || 'backups');
const shouldGzip = process.argv.includes('--gzip');

const timestamp = new Date()
  .toISOString()
  .replace(/\.\d{3}Z$/, '')
  .replace('T', '-')
  .replace(/:/g, '-');

if (!fs.existsSync(stateFile)) {
  console.error(`No existe el archivo de estado: ${stateFile}`);
  process.exit(1);
}

fs.mkdirSync(backupsDir, { recursive: true });

const backupName = `app-state-${timestamp}.json`;
const backupPath = path.join(backupsDir, backupName);
fs.copyFileSync(stateFile, backupPath);

if (shouldGzip) {
  const gzPath = `${backupPath}.gz`;
  fs.writeFileSync(gzPath, zlib.gzipSync(fs.readFileSync(backupPath)));
  console.log(`Backup creado: ${gzPath}`);
} else {
  console.log(`Backup creado: ${backupPath}`);
}
