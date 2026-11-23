import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('daily contract inventory report reads full supplier plans, validates date/access and never changes stored balances', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-contract-stock-report-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'stock-report-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot, getStateMeta } = await import('../storage/fileStateStore.js');
  await replaceStateSnapshot({ settings: {}, items: [{ id: 'cojin', name: 'Cojín', totalStock: 600 }], contracts: [{ id: 'c', contractCode: '100', status: 'aprobado', eventDate: '2026-11-24', items: [{ itemId: 'cojin', lineKey: 'l', quantity: 400 }], supplierFulfillmentPlan: [{ itemId: 'cojin', lineKey: 'l', supplierName: 'ALQUILADORA', neededQty: 100 }] }], rentals: [], cashMovements: [{ id: 'cash', amountBs: 50 }] }, null);
  const original = await fs.readFile(process.env.APP_STATE_FILE, 'utf8');
  const revision = (await getStateMeta()).revision;
  const app = express(); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/__copetin_db/availability/contracts-report`;
  const headers = { 'X-App-Internal-Key': 'stock-report-test' };
  try {
    assert.equal((await fetch(`${endpoint}?date=2026-11-24`)).status, 401);
    assert.equal((await fetch(`${endpoint}?date=2026-02-31`, { headers })).status, 400);
    const response = await fetch(`${endpoint}?date=2026-11-24`, { headers });
    assert.equal(response.status, 200);
    const { report } = await response.json();
    assert.equal(report.groups[0].rows[0].own, 300);
    assert.equal(report.groups[0].rows[0].free, 300);
    assert.equal(report.groups[0].rows[0].external, 100);
    assert.equal(report.groups[0].rows[0].suppliers[0].name, 'ALQUILADORA');
    assert.equal((await getStateMeta()).revision, revision);
    assert.equal(await fs.readFile(process.env.APP_STATE_FILE, 'utf8'), original);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
});
