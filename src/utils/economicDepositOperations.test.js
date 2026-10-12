import test from 'node:test';
import assert from 'node:assert/strict';
import { economicDepositGroup, reviseEconomicDeposit, syncEconomicDepositOperations } from './economicDepositOperations.js';

const fixture = () => {
  const ledger = [{ id: 'deposit', type: 'deposit', amountBs: 1000, contractAllocationBs: 800, guaranteeAllocationBs: 200, cashMovementId: 'cash', cashReceiptCode: 'RC-1', isCashRegistered: true },
    { id: 'guarantee', type: 'guarantee', amountBs: 200, sourceDepositId: 'deposit', reclassifiedFromPayment: true }];
  const state = { cashMovements: [{ id: 'cash', receiptCode: 'RC-1', amountBs: 1000, contractAllocationBs: 800, guaranteeAllocationBs: 200, cashLedgerSequence: 123 }], rentals: [{ id: 'rental', payment: { paidAtRentalBs: 800, pendingPaymentBs: 150 } }] };
  return { ledger, state, contract: { rentalId: 'rental' } };
};
test('950 service and 50 guarantee update the same cash receipt without a second income', () => {
  const { ledger, state, contract } = fixture();
  const next = reviseEconomicDeposit(ledger, ledger[0], { receivedBs: 1000, guaranteeBs: 50, createdAt: '2026-10-01T12:00:00Z' });
  syncEconomicDepositOperations(state, contract, ledger, next);
  assert.equal(next[0].contractAllocationBs, 950);
  assert.equal(next[1].amountBs, 50);
  assert.equal(state.cashMovements.length, 1);
  assert.equal(state.cashMovements[0].amountBs, 1000);
  assert.equal(state.cashMovements[0].receiptCode, 'RC-1');
  assert.equal(state.cashMovements[0].cashLedgerSequence, 123);
  assert.equal(state.rentals[0].payment.pendingPaymentBs, 0);
  assert.match(state.cashMovements[0].receiptDetail, /950.00/);
});
test('zero guarantee can be reserved again from the same deposit', () => {
  const { ledger } = fixture();
  const zero = reviseEconomicDeposit(ledger, ledger[0], { receivedBs: 1000, guaranteeBs: 0 });
  assert.equal(zero.length, 1);
  const next = reviseEconomicDeposit(zero, zero[0], { receivedBs: 1000, guaranteeBs: 200 });
  assert.equal(next.length, 2);
  assert.equal(next[0].contractAllocationBs, 800);
  assert.equal(economicDepositGroup(next, next[1])[0].id, 'deposit');
});
test('deleting deposit also voids its reserved guarantee and cash receipt', () => {
  const { ledger, state, contract } = fixture();
  const next = [{ ...ledger[0], deletedAt: 'now' }, { ...ledger[1] }];
  syncEconomicDepositOperations(state, contract, ledger, next);
  assert.ok(next[1].deletedAt);
  assert.equal(state.cashMovements[0].receiptStatus, 'eliminado');
  assert.equal(state.rentals[0].payment.paidAtRentalBs, 0);
});
test('already returned guarantee cannot be reassigned to service', () => {
  const { ledger, state, contract } = fixture();
  ledger.push({ id: 'refund', type: 'refund', refundSource: 'guarantee', amountBs: 200 });
  const next = reviseEconomicDeposit(ledger, ledger[0], { receivedBs: 1000, guaranteeBs: 50 });
  assert.throws(() => syncEconomicDepositOperations(state, contract, ledger, next), /ya fue devuelta/);
  assert.equal(state.cashMovements[0].contractAllocationBs, 800);
});
test('invalid amounts and replaced receipts are rejected', () => {
  const { ledger, state, contract } = fixture();
  assert.throws(() => reviseEconomicDeposit(ledger, ledger[0], { receivedBs: 1000, guaranteeBs: 1001 }));
  state.cashMovements[0].deletedAt = 'now';
  const next = reviseEconomicDeposit(ledger, ledger[0], { receivedBs: 1000, guaranteeBs: 50 });
  assert.throws(() => syncEconomicDepositOperations(state, contract, ledger, next), /recibos reemplazados/);
});
