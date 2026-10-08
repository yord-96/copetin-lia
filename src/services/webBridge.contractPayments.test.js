import assert from 'node:assert/strict';
import test from 'node:test';
import { getWebBridge } from './webBridge.js';

const fixture = () => ({
  settings: {}, items: [{ id: 'item', name: 'MESA PRUEBA', totalStock: 100, availableStock: 100, rentalPriceBs: 1000 }], contracts: [{
    id: 'contract', contractCode: '1179', status: 'aprobado',
    customerName: 'CLIENTE PRUEBA', items: [{ itemId: 'item', itemName: 'MESA PRUEBA', quantity: 2, unitPriceBs: 1000, lineTotalBs: 2000, controlsStock: false }], services: [],
    deliveryDate: '2026-10-10', pickupDate: '2026-10-13',
    deliveryWindowStart: '08:00', deliveryWindowEnd: '12:00',
    pickupWindowStart: '08:00', pickupWindowEnd: '12:00',
    totals: { totalBs: 33341, guaranteeBs: 3000 },
    payment: { paidAtApprovalBs: 0, prepaidAppliedBs: 0 },
    guarantee: { amountBs: 3000, status: 'no_validado' },
    economicResetAt: '2026-10-06T21:49:56Z',
    economicLedger: [
      { id: 'first', type: 'deposit', amountBs: 5000, note: 'PRIMER PAGO', cashMovementId: 'first-cash', isCashRegistered: true, guaranteeAllocationBs: 3000 },
      { id: 'guarantee', type: 'guarantee', amountBs: 3000, sourceDepositId: 'first', reclassifiedFromPayment: true },
      { id: 'second', type: 'deposit', amountBs: 28078.5, note: 'SEGUNDO PAGO', cashMovementId: 'second-cash', isCashRegistered: true },
    ],
  }], rentals: [], cashSessions: [],
  cashMovements: [5000, 28078.5].map((amountBs, i) => ({
    id: i ? 'second-cash' : 'first-cash', linkedContractId: 'contract',
    type: 'cobro_saldo_alquiler', cashBoxType: 'BIG_CASH', amountBs,
    receiptCode: `RC-${i + 1}`, accountingTag: 'contract_deposit_receipt',
    createdAt: '2026-10-07T10:00:00Z',
  })),
});

test('commercial saves preserve receipts and deposits, including stale wizard payment fields', async () => {
  const bridge = getWebBridge();
  const state = fixture();
  const cashBefore = structuredClone(state.cashMovements);
  const ledgerBefore = structuredClone(state.contracts[0].economicLedger);
  await bridge.__storage.beginBatch(state);
  try {
    for (const quantity of [3, 1, 2]) {
      await bridge.contracts.update({ id: 'contract', items: [{ itemId: 'item', quantity, unitPriceBs: 1000, lineTotalBs: quantity * 1000, controlsStock: false }], paidAtApprovalBs: 33078.5, prepaidAppliedBs: 500, economicLedger: [] });
      assert.equal(state.contracts[0].totals.totalBs, quantity * 1000);
      assert.deepEqual(state.cashMovements, cashBefore);
      assert.deepEqual(state.contracts[0].economicLedger, ledgerBefore);
      assert.equal(state.contracts[0].payment.paidAtApprovalBs, 0);
      assert.equal(state.contracts[0].payment.prepaidAppliedBs, 0);
    }
    await bridge.contracts.updateEconomicLedger({ id: 'contract', economicLedger: ledgerBefore });
    assert.deepEqual(state.cashMovements, cashBefore);
    assert.equal(state.contracts[0].economicLedger.find(row => row.id === 'first').amountBs, 5000);
  } finally { await bridge.__storage.rollbackBatch(); }
});

test('normalizing an approved contract does not reconstruct payments or rewrite a legitimate surplus', async () => {
  const bridge = getWebBridge();
  const state = fixture();
  state.contracts[0].payment.paidAtApprovalBs = 33078.5;
  state.contracts[0].totals.totalBs = 1000;
  await bridge.__storage.replaceState(state);
  const saved = await bridge.__storage.exportState();
  assert.equal(saved.cashMovements.length, 2);
  assert.ok(saved.cashMovements.every(row => !row.voidedAt && row.receiptStatus !== 'anulado'));
  assert.equal(saved.contracts[0].economicLedger.find(row => row.id === 'first').amountBs, 5000);
  assert.equal(saved.contracts[0].payment.paidAtApprovalBs, 33078.5);
});
