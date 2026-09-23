import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('recovery preserves current employees, terminations and other modules, and is repeatable', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-recovery-'));
  const target = path.join(directory, 'state.json');
  const source = path.join(directory, 'backup.json');
  const script = fileURLToPath(new URL('../../scripts/repair/restore-personnel.mjs', import.meta.url));
  const current = { personnelEmployees: [
    { id: '1', fullName: 'Nombre actualizado', employeeCode: 'EMP-1' },
    { id: '2', fullName: 'Baja', deletedAt: '2026-09-01' },
  ], contracts: [{ id: 'keep' }] };
  await fs.writeFile(target, JSON.stringify({ state: current, version: 1 }));
  await fs.writeFile(source, JSON.stringify({ state: { personnelEmployees: [
    { id: '1', fullName: 'Nombre viejo', employeeCode: 'EMP-1' },
    { id: '2', fullName: 'Baja antigua' },
    { id: '3', fullName: 'Recuperable', employeeCode: 'EMP-3' },
    { id: '4', fullName: 'Duplicado por codigo', employeeCode: 'EMP-1' },
  ] } }));
  const run = (...args) => execFileSync(process.execPath, [script, source, ...args], {
    cwd: directory, env: { ...process.env, APP_STATE_FILE: target }, encoding: 'utf8',
  });
  try {
    run();
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')).state, current);
    run('--apply', '--offline');
    const restored = JSON.parse(await fs.readFile(target, 'utf8')).state;
    assert.equal(restored.personnelEmployees.length, 3);
    assert.equal(restored.personnelEmployees[0].fullName, 'Nombre actualizado');
    assert.ok(restored.personnelEmployees[1].deletedAt);
    assert.deepEqual(restored.contracts, current.contracts);
    assert.equal((await fs.readdir(path.join(directory, 'data/backups'))).length, 1);
    run('--apply', '--offline');
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')).state, restored);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
