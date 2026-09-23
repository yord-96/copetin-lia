import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('personnel HTTP endpoints persist concurrent changes without touching commercial data', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-personnel-'));
  const stateFile = path.join(directory, 'state.json');
  process.env.APP_STATE_FILE = stateFile;
  process.env.APP_INTERNAL_KEY = 'personnel-test-key';
  await fs.writeFile(stateFile, JSON.stringify({ version: 1, state: {
    contracts: [{ id: 'contract-1', detail: 'preserved' }],
    personnelEmployees: [], personnelAttendance: [], personnelIncidents: [],
  } }));
  const { default: routes } = await import('../routes/state.js');
  const app = express();
  app.use(express.json());
  app.use(routes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}/__copetin_db/personnel`;
  const headers = { 'Content-Type': 'application/json', 'X-App-Internal-Key': 'personnel-test-key' };
  const post = async (method, body) => {
    const response = await fetch(`${root}/${method}`, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const responses = await Promise.all(['Ana', 'Luis', 'Pedro'].map((fullName) => post('createEmployee', { fullName })));
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(new Set(responses.map((response) => response.body.record.employeeCode)).size, 3);
    const overview = await (await fetch(`${root}/overview?pageSize=2`, { headers })).json();
    assert.equal(overview.total, 3);
    assert.equal(overview.rows.length, 2);
    assert.equal(overview.contracts, undefined);
    assert.equal((await post('createEmployee', { fullName: '' })).status, 400);
    const id = responses[0].body.record.id;
    assert.equal((await post('updateEmployee', { id, fullName: 'Ana Editada' })).status, 200);
    assert.equal((await post('createIncident', { employeeId: id, dateFrom: '2026-09-23' })).status, 200);
    assert.equal((await post('removeEmployee', { id })).status, 200);
    const final = JSON.parse(await fs.readFile(stateFile, 'utf8')).state;
    assert.equal(final.personnelEmployees.length, 3);
    assert.ok(final.personnelEmployees.find((employee) => employee.id === id).deletedAt);
    assert.equal(final.personnelIncidents.length, 1);
    assert.deepEqual(final.contracts, [{ id: 'contract-1', detail: 'preserved' }]);
    const recoveryFile = path.join(directory, 'personnel.json');
    await fs.writeFile(recoveryFile, JSON.stringify({ personnelEmployees: Array.from({ length: 41 }, (_, index) => ({
      id: `recovery-${index}`, fullName: `Recuperado ${index}`, employeeCode: `REC-${index}`,
    })) }));
    const recoveryScript = fileURLToPath(new URL('../../scripts/repair/restore-personnel.mjs', import.meta.url));
    const recoveryArgs = [recoveryScript, recoveryFile, `--url=http://127.0.0.1:${server.address().port}`, '--apply'];
    await promisify(execFile)(process.execPath, recoveryArgs, { cwd: directory, env: process.env });
    await promisify(execFile)(process.execPath, recoveryArgs, { cwd: directory, env: process.env });
    const recovered = JSON.parse(await fs.readFile(stateFile, 'utf8')).state;
    assert.equal(recovered.personnelEmployees.length, 44);
    assert.deepEqual(recovered.contracts, final.contracts);
    const { updateStateSnapshot } = await import('../storage/fileStateStore.js');
    await assert.rejects(updateStateSnapshot((state) => ({ ...state, personnelEmployees: [] })), {
      code: 'STATE_COLLECTION_REGRESSION_BLOCKED',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
