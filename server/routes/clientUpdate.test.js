import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('direct client edits preserve large attachments and business data; retries cannot duplicate prepaid deposits', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-client-update-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'client-update-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  const attachments = [{ id: 'large', name: 'original.pdf', dataUrl: 'data:application/pdf;base64,' + 'A'.repeat(2_100_000) }];
  const deliveries = Array.from({ length: 1621 }, (_, index) => ({ id: `d-${index}` }));
  const contract = { id: 'contract', customerName: 'Original', totalBs: 500 };
  await replaceStateSnapshot({ settings: {}, clients: [{ id: 'client', name: 'Original', phone: '70000000', updatedAt: '2026-10-23T10:00:00Z', attachments,
    prepaidEnabled: true, prepaidBalanceBs: 100, prepaidTotalDepositedBs: 100, prepaidTotalUsedBs: 0, prepaidMovements: [] },
    { id: 'other', name: 'Other', email: 'other@test.test' }], deliveries, contracts: [contract], cashMovements: [], cashSessions: [] }, null);
  const app = express(); app.use(express.json({ limit: '2kb' })); app.use(router);
  app.use((error, req, res, next) => { void next; res.status(error.statusCode || 500).json({ error: error.message }); });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__copetin_db`;
  const headers = { 'X-App-Internal-Key': 'client-update-test', 'Content-Type': 'application/json' };
  const send = payload => fetch(`${base}/clients/client/update`, { method: 'POST', headers, body: JSON.stringify(payload) });
  try {
    const payload = { name: 'Nombre corregido', expectedUpdatedAt: '2026-10-23T10:00:00Z', clientOperationId: 'edit-1' };
    const response = await send(payload); assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.client.name, 'Nombre corregido');
    assert.deepEqual(result.client.attachments, attachments);
    assert.equal(result.client.prepaidBalanceBs, 100);
    assert.equal((await send(payload)).status, 200, 'retry checked before version conflict');
    assert.equal((await send({ ...payload, name: 'Wrong' })).status, 409);
    assert.equal((await send({ ...payload, clientOperationId: 'stale', name: 'Stale' })).status, 409);
    assert.equal((await send({ clientOperationId: 'empty', name: '' })).status, 400);
    assert.equal((await send({ clientOperationId: 'duplicate-email', email: 'other@test.test' })).status, 400);
    const topUp = { prepaidTopUpBs: 50, clientOperationId: 'top-up-1' };
    const responses = await Promise.all([send(topUp), send(topUp)]);
    for (const res of responses) assert.equal(res.status, 200, await res.clone().text());
    const snapshot = (await getStateSnapshot()).state;
    assert.equal(snapshot.clients[0].prepaidBalanceBs, 150);
    assert.equal(snapshot.cashMovements.length, 1);
    assert.equal(snapshot.cashMovements[0].amountBs, 50);
    assert.deepEqual(snapshot.deliveries, deliveries);
    assert.deepEqual(snapshot.contracts, [contract]);
    assert.deepEqual(snapshot.clients[0].attachments, attachments);
    assert.equal(snapshot.clients[0].name, 'Nombre corregido');
    const overview = await (await fetch(`${base}/clients/overview`, { headers })).json();
    assert.equal(overview.overview.clients.find(row => row.id === 'client').name, 'Nombre corregido');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
