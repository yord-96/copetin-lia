const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const projectRoot = path.resolve(__dirname, '..', '..');
const stateFile = path.resolve(projectRoot, process.env.APP_STATE_FILE || 'data/app-state.json');
const backupsDir = path.resolve(projectRoot, process.env.BACKUP_DIR || 'backups');
const requestedBackup = process.argv[2];

const timestamp = new Date()
  .toISOString()
  .replace(/\.\d{3}Z$/, '')
  .replace('T', '-')
  .replace(/:/g, '-');

if (!requestedBackup) {
  console.error('Uso: npm run restore -- app-state-YYYY-MM-DD-HH-mm-ss.json');
  process.exit(1);
}

const backupPath = path.isAbsolute(requestedBackup)
  ? requestedBackup
  : path.join(backupsDir, requestedBackup);

if (!fs.existsSync(backupPath)) {
  console.error(`No existe el backup: ${backupPath}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(stateFile), { recursive: true });
fs.mkdirSync(backupsDir, { recursive: true });

if (fs.existsSync(stateFile)) {
  const preRestorePath = path.join(backupsDir, `pre-restore-app-state-${timestamp}.json`);
  fs.copyFileSync(stateFile, preRestorePath);
  console.log(`Backup previo a restauracion creado: ${preRestorePath}`);
}

fs.copyFileSync(backupPath, stateFile);
console.log(`Estado restaurado desde: ${backupPath}`);
console.log(`Archivo activo: ${stateFile}`);
