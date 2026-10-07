import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lincoln-economic-routes-'));
process.env.LINCOLN_STATE_FILE = path.join(directory, 'lincoln.json');
process.env.APP_STATE_FILE = path.join(directory, 'app.json');
process.env.APP_INTERNAL_KEY = 'route-test-key';
const store = await import('../storage/lincolnStateStore.js');
const { default: router } = await import('./lincoln.js');
const app = express();
app.use(express.json());
app.use(router);
const server = await new Promise(resolve => {
  const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
});
after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await fs.rm(directory, { recursive: true, force: true });
});

test('HTTP receipt edit accepts a previous-year payment date without changing the contract', async () => {
  const initial = await store.getLincolnStateSnapshot();
  await store.replaceLincolnStateSnapshot({
    ...initial.state,
    events: [{ id: 'event', code: 'EVE-2026-TEST', clientName: 'Cliente', date: '2026-10-10', createdAt: '2026-10-07T12:00:00.000Z', totalBs: 10000 }],
    payments: [], receipts: [], incomeEntries: [], expenseEntries: [], economicLedgerEntries: [], auditLog: [],
  }, initial.revision);
  const created = await store.registerLincolnEventPayment('event', {
    type: 'advance', amountBs: 5000, date: '2026-10-07',
  }, (await store.getLincolnStateSnapshot()).revision);
  const before = await store.getLincolnStateSnapshot();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/__lincoln_db/economic-movements/${created.ledgerEntry.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-App-Internal-Key': 'route-test-key' },
    body: JSON.stringify({ movement: { type: 'advance', amountBs: 5000, date: '2025-10-12' }, revision: before.revision }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  const { state } = await store.getLincolnStateSnapshot();
  for (const collection of ['payments', 'receipts', 'incomeEntries', 'economicLedgerEntries']) {
    assert.equal(state[collection][0].date, '2025-10-12', collection);
  }
  assert.equal(state.receipts[0].id, created.receipt.id);
  assert.equal(state.receipts[0].code, created.receipt.code);
  assert.equal(state.events[0].date, before.state.events[0].date);
  assert.equal(state.events[0].createdAt, before.state.events[0].createdAt);
  assert.equal(state.events[0].financial.servicePaidBs, 5000);
});
