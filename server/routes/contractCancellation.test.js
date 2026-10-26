import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('cancellation settles historical 2000 into an 1800 refund and 200 retained without new income', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-cancellation-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'cancellation-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot, getStateSnapshot, updateStateSnapshot } = await import('../storage/fileStateStore.js');
  const income = { id: 'july-income', type: 'ingreso_alquiler', amountBs: 2000, cashBoxType: 'BIG_CASH',
    linkedContractId: 'c', linkedRentalId: 'r', receiptCode: 'RC-14335', paymentMethod: 'qr', paymentAccount: 'CIDRE', createdAt: '2026-07-21T19:06:00Z',
    accountingTag: 'contract_deposit_receipt', contractAllocationBs: 2000, guaranteeAllocationBs: 0,
    cashLedgerSequence: 1, cashEffectiveDate: '2026-07-21', cashRegisteredAt: null };
  const seed = { settings: {}, clients: [], items: [{ id: 'i', totalStock: 100, availableStock: 90 }],
    contracts: [{ id: 'c', contractCode: '1833', rentalId: 'r', orderCode: 'OS-00422', status: 'aprobado', customerName: 'ADRIANA GUZMAN',
      deliveryDate: '2099-12-05', totals: { totalBs: 6740, guaranteeBs: 700 }, guarantee: { amountBs: 700, status: 'debe' }, payment: { paidAtApprovalBs: 2000 }, updatedAt: 'original' }],
    rentals: [{ id: 'r', contractId: 'c', contractCode: '1833', orderCode: 'OS-00422', status: 'active', rentalDate: '2099-12-05',
      items: [{ itemId: 'i', quantity: 10, internalReservedQty: null }], totals: { totalBs: 6740 }, payment: { paidAtRentalBs: 2000 }, operational: { inventoryStatus: 'confirmado' } }],
    cashMovements: [income], inventoryMovements: [], deliveries: [{ id: 'd', rentalId: 'r', orderCode: 'OS-00422', status: 'programada', progress: 0 }], supplierLoans: [] };
  await replaceStateSnapshot(seed, null);
  const app = express(); app.use(express.json()); app.use(router);
  app.use((error, req, res, next) => { void next; res.status(error.statusCode || 500).json({ error: error.message }); });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__copetin_db/contracts`;
  const headers = { 'X-App-Internal-Key': 'cancellation-test', 'Content-Type': 'application/json' };
  const preview = async () => { const r = await fetch(`${base}/cancellation/preview?contractId=c`, { headers }); assert.equal(r.status, 200); return r.json(); };
  const send = body => fetch(`${base}/cancel`, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    const before = await preview();
    assert.equal(before.receivedBs, 2000); assert.equal(before.availableBs, 2000); assert.equal(before.guaranteeReceivedBs, 0); assert.equal(before.guaranteeConfiguredBs, 700);
    assert.equal(before.receipts[0].paymentAccount, 'CIDRE');
    const payload = { id: 'r', contractId: 'c', reason: 'Acuerdo de anulacion con multa de 200', userName: 'Operador',
      economicSettlement: { operationId: 'cancel-1833', version: before.version, retainedPenaltyBs: 200, refundBs: 1800, paymentMethod: 'qr', paymentAccount: 'CIDRE' } };
    assert.equal((await send({ id: 'r', contractId: 'c', reason: 'Unsafe' })).status, 409, 'money cannot be ignored');
    assert.equal((await send({ ...payload, economicSettlement: { ...payload.economicSettlement, refundBs: 2000 } })).status, 409);
    assert.equal((await send({ ...payload, economicSettlement: { ...payload.economicSettlement, version: 'stale' } })).status, 409);
    let state = (await getStateSnapshot()).state;
    assert.deepEqual(state.cashMovements, [income]); assert.equal(state.contracts[0].status, 'aprobado');
    await updateStateSnapshot(current => { current.rentals[0].operational.inventoryStatus = 'salio'; return current; });
    assert.equal((await send(payload)).status, 409, 'cannot cancel away physically dispatched material');
    await updateStateSnapshot(current => { current.rentals[0].operational.inventoryStatus = 'confirmado'; return current; });
    const responses = await Promise.all([send(payload), send(payload)]);
    for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
    const result = await responses[0].json();
    state = (await getStateSnapshot()).state;
    assert.deepEqual(state.cashMovements.find(row => row.id === income.id), income, 'July receipt is never edited or voided');
    assert.equal(state.cashMovements.length, 2);
    const refund = state.cashMovements.find(row => row.id !== income.id);
    assert.equal(refund.amountBs, -1800); assert.equal(refund.paymentAccount, 'CIDRE');
    assert.ok(refund.receiptCode); assert.ok(new Date(refund.createdAt) > new Date('2026-07-31'));
    assert.equal(state.cashMovements.reduce((sum, row) => sum + row.amountBs, 0), 200);
    assert.equal(state.cashMovements.filter(row => row.amountBs > 0).length, 1, 'retained fee creates no new cash income');
    assert.equal(state.contracts[0].status, 'anulado'); assert.equal(state.rentals[0].status, 'cancelled');
    assert.equal(state.contracts[0].guarantee.amountBs, 0);
    assert.equal(state.contracts[0].totals.guaranteeBs, 0);
    assert.equal(state.contracts[0].cancellationSettlement.retainedPenaltyBs, 200);
    assert.equal(state.contracts[0].cancellationSettlement.receivableAfterBs, 0);
    assert.equal(state.contracts[0].totals.totalBs, 6740, 'historical contract total remains auditable');
    assert.equal(state.items[0].availableStock, 100);
    assert.equal(state.inventoryMovements.length, 1, 'retry cannot release inventory twice');
    assert.equal(result.cashMovements[0].id, refund.id);
    const after = await preview(); assert.equal(after.settlement.refundReceiptCode, refund.receiptCode);
    assert.equal((await send({ ...payload, economicSettlement: { ...payload.economicSettlement, retainedPenaltyBs: 300 } })).status, 409);
    const july = await (await fetch(`${base.replace('/contracts', '')}/accounting/daily-report?date=2026-07-21`, { headers })).json();
    assert.equal(july.movements.reduce((sum, row) => sum + row.amountBs, 0), 2000);
    const refundDate = refund.cashEffectiveDate || refund.createdAt.slice(0, 10);
    const today = await (await fetch(`${base.replace('/contracts', '')}/accounting/daily-report?date=${refundDate}`, { headers })).json();
    assert.equal(today.movements.reduce((sum, row) => sum + row.amountBs, 0), -1800);
    const { getWebBridge } = await import('../../src/services/webBridge.js');
    await getWebBridge().__storage.applyServerState(state, { replace: true });
    const receipt = await getWebBridge().printer.printCashMovementReceipt({ movementId: refund.id });
    assert.match(receipt.html, /1[.,]800[.,]00/);
    assert.match(receipt.html, /Multa retenida/);
    assert.match(receipt.html, /no es un nuevo ingreso/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
