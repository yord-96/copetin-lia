import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('refund commits cash and flexible ledger together; replay cannot duplicate either', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-refund-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'refund-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  await replaceStateSnapshot({ settings: {}, contracts: [{ id: 'c', rentalId: 'r', contractCode: '2459',
    totals: { totalBs: 900, guaranteeBs: 200 }, guarantee: { status: 'validado' }, economicLedger: [] }],
    rentals: [{ id: 'r', contractId: 'c', status: 'returned', depositBs: 200 }],
    cashMovements: [{ id: 'original', linkedContractId: 'c', type: 'ingreso_garantia', amountBs: 200,
      category: 'garantia', cashBoxType: 'BIG_CASH', receiptCode: 'RC-12907', createdAt: '2026-09-11T12:57:00Z' }] }, null);
  const app = express(); app.use(express.json()); app.use(router);
  app.use((error, req, res, next) => { void next; res.status(500).json({ error: error.message }); });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__copetin_db`;
  const headers = { 'X-App-Internal-Key': 'refund-test', 'Content-Type': 'application/json' };
  const body = { type: 'egreso', amountBs: 200, description: 'Devolucion garantia',
    accountingTag: 'guarantee_refund', linkedContractId: 'c', linkedRentalId: 'r',
    cashBoxType: 'BIG_CASH', paymentMethod: 'efectivo', clientOperationId: 'refund-2459' };
  const send = value => fetch(`${base}/cash/manual-economic-movement`, { method: 'POST', headers, body: JSON.stringify(value) });
  try {
    for (const response of await Promise.all([send(body), send(body)])) {
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json();
      assert.equal(result.contract.economicLedger.length, 1);
      assert.equal(result.contract.economicLedger[0].cashMovementId, result.movement.id);
      assert.equal(result.contract.economicLedger[0].amountBs, 200);
      assert.equal(result.movement.amountBs, -200);
    }
    const state = (await getStateSnapshot()).state;
    assert.equal(state.cashMovements.length, 2); assert.equal(state.contracts[0].economicLedger.length, 1);
    assert.equal((await send({ ...body, clientOperationId: 'second-refund' })).status, 409);
    const overview = await (await fetch(`${base}/orders/mobile-overview`, { headers })).json();
    assert.equal(overview.overview.contracts[0].guaranteeEconomicSummary.status, 'returned');
    assert.equal(overview.overview.contracts[0].guaranteeEconomicSummary.pendingRefundBs, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
});
