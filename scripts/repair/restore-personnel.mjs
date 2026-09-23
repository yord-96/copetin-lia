import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getStateSnapshot, updateStateSnapshot } from '../../server/storage/fileStateStore.js';

const args = process.argv.slice(2);
const sourceFile = args.find((arg) => !arg.startsWith('--'));
const serverUrl = args.find((arg) => arg.startsWith('--url='))?.slice(6).replace(/\/$/, '');
if (!sourceFile) throw new Error('Uso: node scripts/repair/restore-personnel.mjs respaldo-personal.json [--url=http://127.0.0.1:4000] [--apply]');
if (args.includes('--apply') && !serverUrl && !args.includes('--offline')) {
  throw new Error('Usa --url para restaurar mediante el servidor activo; --offline solo con el servicio detenido.');
}
const request = async (suffix, body) => {
  const response = await fetch(`${serverUrl}/__copetin_db${suffix}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-App-Internal-Key': process.env.APP_INTERNAL_KEY ?? '' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`El servidor rechazo la recuperacion (${response.status}). No se aplicaron nuevos cambios.`);
  return response.json();
};
const backup = JSON.parse((await fs.readFile(sourceFile, 'utf8')).replace(/^\uFEFF/, ''));
const source = backup.state ?? backup;
const employees = source.personnelEmployees;
if (!Array.isArray(employees) || !employees.length || employees.some((row) => !row?.id || !row.fullName)) {
  throw new Error('El respaldo no contiene fichas de Personal validas.');
}
// A full snapshot here is intentional: this one-off server repair also keeps
// a complete pre-recovery backup and works on older deployed versions.
const snapshot = serverUrl ? await request('') : await getStateSnapshot();
if (!snapshot?.state) throw new Error('La base de destino no esta inicializada.');
const existing = snapshot.state.personnelEmployees ?? [];
// Preserve newer edits and explicit terminations; never overwrite a current row.
const normalize = (value) => String(value ?? '').trim().toLowerCase();
const matches = (a, b) => ['id', 'employeeCode', 'documentId'].some((key) => normalize(a[key]) && normalize(a[key]) === normalize(b[key]));
const additions = [];
for (const row of employees) {
  if (!row.deletedAt && ![...existing, ...additions].some((current) => matches(current, row))) additions.push(row);
}
console.log(JSON.stringify({ current: existing.length, recoverable: additions.length, skipped: employees.length - additions.length, apply: args.includes('--apply') }));
if (args.includes('--apply') && additions.length) {
  const directory = path.resolve('data/backups');
  await fs.mkdir(directory, { recursive: true });
  const backupPath = path.join(directory, `before-personnel-recovery-${Date.now()}.json`);
  await fs.writeFile(backupPath, JSON.stringify(snapshot));
  if (serverUrl) {
    await request('/patch', { revision: snapshot.revision, upserts: { personnelEmployees: additions } });
    const verified = await request('');
    if (!additions.every((row) => verified.state?.personnelEmployees?.some((saved) => saved.id === row.id))) {
      throw new Error('La verificacion de los trabajadores recuperados no coincide.');
    }
  } else {
    const result = await updateStateSnapshot((state) => {
      state.personnelEmployees = [...existing, ...additions];
      return state;
    }, snapshot.revision);
    if (!result.initialized) throw new Error('No se pudo restaurar Personal.');
  }
  console.log(`Recuperados ${additions.length} trabajadores. Respaldo previo: ${backupPath}`);
}
