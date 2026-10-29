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
  const { replaceStateSnapshot, getStateSnapshot, updateStateSnapshot } = await import('../storage/fileStateStore.js');
  await replaceStateSnapshot({ settings: {}, contracts: [{ id: 'c', rentalId: 'r', contractCode: '2459',
    totals: { totalBs: 900, guaranteeBs: 200 }, payment: { paidAtApprovalBs: 900 }, guarantee: { status: 'validado' }, economicLedger: [] }],
    rentals: [{ id: 'r', contractId: 'c', status: 'returned', depositBs: 200, payment: { paidAtRentalBs: 900 } }],
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
    await replaceStateSnapshot({ settings: {}, contracts: [{ id: 'c', rentalId: 'r', contractCode: '2967', totals: { totalBs: 200, guaranteeBs: 200 },
      economicLedger: [{ id: 'deposit', type: 'deposit', amountBs: 340, contractAllocationBs: 140, guaranteeAllocationBs: 200, cashMovementId: 'deposit-cash' },
        { id: 'reserve', type: 'guarantee', amountBs: 200, sourceDepositId: 'deposit', reclassifiedFromPayment: true }] }],
      rentals: [{ id: 'r', contractId: 'c', status: 'returned', depositBs: 200, totals: { totalBs: 200 } }],
      cashMovements: [{ id: 'deposit-cash', type: 'ingreso_alquiler', linkedContractId: 'c', cashBoxType: 'BIG_CASH', amountBs: 340,
        contractAllocationBs: 140, guaranteeAllocationBs: 200, accountingTag: 'contract_deposit_receipt' }] }, (await getStateSnapshot()).revision);
    const denied = await send({ ...body, clientOperationId: 'blocked-2967' });
    assert.equal(denied.status, 409); assert.match((await denied.json()).error, /60[.,]00/);
    assert.equal((await getStateSnapshot()).state.cashMovements.length, 1, 'blocked refund creates no expense');
    await updateStateSnapshot(current => { current.contracts[0].economicLedger.push({ id: 'apply', type: 'guarantee_apply', amountBs: 60, contractAllocationBs: 60, applicationTarget: 'rental' }); return current; });
    const allowed = await send({ ...body, amountBs: 140, clientOperationId: 'settled-2967' });
    assert.equal(allowed.status, 200, await allowed.clone().text());
    assert.equal((await allowed.json()).movement.amountBs, -140);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
});
