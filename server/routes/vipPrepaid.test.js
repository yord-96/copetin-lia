import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('VIP routes enforce accounting permission and serialize retries without cash duplication', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-vip-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');process.env.APP_INTERNAL_KEY = 'vip-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  await replaceStateSnapshot({ settings: {}, clients: [{ id: 'vip', name: 'Cliente VIP', prepaidEnabled: true, prepaidBalanceBs: 100, updatedAt: 'start', prepaidMovements: [{ id: 'opening', type: 'deposit', amountBs: 100, createdAt: '2026-10-01' }] }], users: [{ id: 'admin', fullName: 'Admin', roleIds: ['developer'], status: 'active' }, { id: 'sales', roleIds: ['ventas'], status: 'active' }], cashMovements: [], contracts: [], rentals: [] }, null);
  const app = express();app.use(express.json());app.use(router);app.use((error, req, res, next) => { void next;res.status(error.statusCode || 500).json({ error: error.message }); });
  const server = app.listen(0, '127.0.0.1');await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__copetin_db/accounting/vip-prepaid`;
  const headers = { 'X-App-Internal-Key': 'vip-test', 'Content-Type': 'application/json' };
  const payload = { action: 'adjust', clientId: 'vip', balanceBs: 75, expectedBalanceBs: 100, expectedUpdatedAt: 'start', date: '2026-11-24', reference: 'Excel', reason: 'Saldo verificado', actorUserId: 'admin', clientOperationId: 'same-request' };
  const send = value => fetch(base + '/manage', { method: 'POST', headers, body: JSON.stringify(value) });
  try {
    assert.equal((await fetch(base + '/workspace?clientId=vip')).status, 401);
    assert.equal((await send({ ...payload, actorUserId: 'sales' })).status, 403);
    const results = await Promise.all([send(payload), send(payload)]);
    for (const result of results) assert.equal(result.status, 200, await result.clone().text());
    const snapshot = (await getStateSnapshot()).state;
    assert.equal(snapshot.clients[0].prepaidBalanceBs, 75);assert.equal(snapshot.clients[0].prepaidMovements.length, 2);assert.equal(snapshot.cashMovements.length, 0);assert.equal(snapshot.systemAuditLog.length, 1);
    const get = await fetch(base + '/workspace?clientId=vip', { headers });assert.equal(get.status, 200);assert.equal((await get.json()).summary.ledgerBalanceBs, 75);
    assert.equal((await send({ ...payload, clientOperationId: 'different-stale-request' })).status, 409);
    await replaceStateSnapshot({ settings: {}, users: snapshot.users, clients: [{ id: 'vip', name: 'Cliente VIP', prepaidEnabled: true, prepaidBalanceBs: 100, prepaidTotalUsedBs: 100, prepaidMovements: [{ id: 'original-credit', type: 'deposit', amountBs: 200, createdAt: '2026-06-01' }, { id: 'debit-2027', type: 'charge', amountBs: -100, sourceId: 'rental', orderCode: 'OS-2027', createdAt: '2026-06-02' }] }], contracts: [{ id: 'c2027', contractCode: '1623', clientId: 'vip', rentalId: 'rental', eventDate: '2027-07-17', totals: { totalBs: 100 }, payment: { paidAtApprovalBs: 100, prepaidAppliedBs: 100 }, economicLedger: [{ id: 'legacy-deposit', type: 'deposit', amountBs: 100 }] }], rentals: [{ id: 'rental', orderCode: 'OS-2027', clientId: 'vip', contractId: 'c2027', totals: { totalBs: 100 }, payment: { paidAtRentalBs: 100, prepaidAppliedBs: 100 } }], cashMovements: [] }, (await getStateSnapshot()).revision);
    const deletion = await fetch(`http://127.0.0.1:${server.address().port}/__copetin_db/contracts/c2027/economic-ledger`, { method: 'PUT', headers, body: JSON.stringify({ mutations: [{ type: 'void', entryId: 'legacy-deposit', reason: 'No se autorizó el pago de 2027' }], updatedByName: 'Admin' }) });
    assert.equal(deletion.status, 200, await deletion.clone().text());
    const fixed = (await getStateSnapshot()).state;
    assert.equal(fixed.clients[0].prepaidBalanceBs, 200);assert.ok(fixed.clients[0].prepaidMovements[1].deletedAt);assert.equal(fixed.contracts[0].payment.paidAtApprovalBs, 0);assert.equal(fixed.rentals[0].payment.pendingPaymentBs, 100);assert.equal(fixed.cashMovements.length, 0);
  } finally { await new Promise(resolve => server.close(resolve));await fs.rm(directory, { recursive: true, force: true }); }
});
