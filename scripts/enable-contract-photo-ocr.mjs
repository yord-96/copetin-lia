import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import { contractPhotoReaderStatus } from '../server/services/contractPhotoReader.js';

export async function enableContractPhotoOcr({ directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  probe = () => contractPhotoReaderStatus({ env: { ...process.env, CONTRACT_PHOTO_ENGINE: 'python', CONTRACT_PHOTO_ENABLED: 'true' } }) } = {}) {
  const status = await probe();
  if (!status.ready) throw new Error(status.message || 'Instala y verifica el OCR antes de activarlo.');
  const envPath = path.join(directory, '.env');
  const original = await fs.readFile(envPath, 'utf8');
  const changes = { CONTRACT_PHOTO_ENABLED: 'true', CONTRACT_PHOTO_ENGINE: 'python', CONTRACT_PHOTO_PYTHON_TIMEOUT_MS: '60000' };
  const lines = original.split(/\r?\n/).filter(line => !Object.keys(changes).some(key => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line)));
  const backupDirectory = path.join(directory, 'data', 'contract-photo-python');
  await fs.mkdir(backupDirectory, { recursive: true });
  const backup = path.join(backupDirectory, `env-before-activation-${Date.now()}-${randomUUID()}.env`);
  await fs.writeFile(backup, original, { flag: 'wx', mode: 0o600 });
  const temporary = `${envPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${lines.join('\n').trimEnd()}\n${Object.entries(changes).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, envPath);
  } finally { await fs.rm(temporary, { force: true }); }
  return { ready: true, engine: 'python', timeoutSeconds: 60, backup };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await enableContractPhotoOcr(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
