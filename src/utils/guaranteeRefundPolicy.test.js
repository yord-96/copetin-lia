import test from 'node:test';
import assert from 'node:assert/strict';
import { getGuaranteeRefundCommercialPendingBs as pending } from './guaranteeRefundPolicy.js';

test('2967: deposit 340 reserves 200, leaves 60 unpaid; applying 60 allows remaining refund', () => {
  const contract = { id: 'c', rentalId: 'r', totals: { totalBs: 200 }, economicLedger: [
    { id: 'd', type: 'deposit', amountBs: 340, contractAllocationBs: 140, guaranteeAllocationBs: 200, cashMovementId: 'cash' },
    { id: 'g', type: 'guarantee', amountBs: 200, sourceDepositId: 'd' }] };
  const cash = [{ id: 'cash', linkedContractId: 'c', cashBoxType: 'BIG_CASH', type: 'ingreso_alquiler', amountBs: 340,
    contractAllocationBs: 140, guaranteeAllocationBs: 200, accountingTag: 'contract_deposit_receipt' }];
  assert.equal(pending(contract, { id: 'r' }, cash), 60);
  cash.push({ id: 'damage', linkedContractId: 'c', cashBoxType: 'BIG_CASH', amountBs: 60, collectionTarget: 'damage' });
  assert.equal(pending(contract, { id: 'r' }, cash), 60, 'damage collection cannot pay commercial debt');
  contract.economicLedger.push({ id: 'application', type: 'guarantee_apply', amountBs: 60, contractAllocationBs: 60 });
  assert.equal(pending(contract, { id: 'r' }, cash), 0);
});

test('economic reset and corrected receipt override an outdated paid snapshot', () => {
  const contract = { id: 'c', totals: { totalBs: 200 }, economicResetVersion: 1, payment: { paidAtApprovalBs: 200 },
    economicLedger: [{ id: 'd', type: 'deposit', amountBs: 200, cashMovementId: 'cash' }] };
  assert.equal(pending(contract, { id: 'r' }, [{ id: 'cash', linkedContractId: 'c', type: 'ingreso_alquiler', cashBoxType: 'BIG_CASH', amountBs: 140 }]), 60);
});

const paidReturnFixture = () => {
  const contract = { id: 'c3026', contractCode: '3026', rentalId: 'r3026', economicResetVersion: 1, totals: { totalBs: 2514.4, guaranteeBs: 582.6 }, economicLedger: [
    { id: 'first', type: 'deposit', amountBs: 2255, contractAllocationBs: 1672.4, guaranteeAllocationBs: 582.6, cashMovementId: 'cash-first', isCashRegistered: true },
    { id: 'reserve', type: 'guarantee', amountBs: 582.6, sourceDepositId: 'first', reclassifiedFromPayment: true },
    { id: 'second', type: 'deposit', amountBs: 285.6, createdAt: '2026-10-31T20:30:46Z', paymentMethod: 'qr', paymentAccount: 'MERCANTIL', isCashRegistered: false },
    { id: 'third', type: 'deposit', amountBs: 476.4, cashMovementId: 'cash-third', isCashRegistered: true },
    { id: 'fourth', type: 'deposit', amountBs: 80, cashMovementId: 'cash-fourth', isCashRegistered: true },
  ] };
  const cash = [
    { id: 'cash-first', amountBs: 2255, contractAllocationBs: 1672.4, guaranteeAllocationBs: 582.6 },
    { id: 'cash-second', amountBs: 285.6, contractAllocationBs: 285.6, receiptIssuedAt: '2026-10-31T20:30:46Z', paymentMethod: 'qr', paymentAccount: 'MERCANTIL', receiptCode: 'RC-14679', clientOperationId: 'contract-deposit:c3026:second' },
    { id: 'cash-third', amountBs: 476.4, contractAllocationBs: 476.4 },
    { id: 'cash-fourth', amountBs: 80, contractAllocationBs: 80 },
  ].map(row => ({ ...row, linkedContractId: 'c3026', linkedRentalId: 'r3026', cashBoxType: 'BIG_CASH', type: 'cobro_saldo_devolucion', collectionTarget: 'balance', accountingTag: 'contract_deposit_receipt' }));
  cash.push({ id: 'damage', linkedContractId: 'c3026', type: 'ingreso_danos_faltantes', collectionTarget: 'damage', amountBs: 20, cashBoxType: 'BIG_CASH' });
  return { contract, rental: { id: 'r3026', status: 'returned' }, cash };
};
test('3026: paid return receipt without ledger link counts once and keeps guarantee and damages separate', () => {
  const { contract, rental, cash } = paidReturnFixture();
  const before = structuredClone({ contract, cash });
  assert.equal(pending(contract, rental, cash), 0);
  assert.deepEqual({ contract, cash }, before, 'reconciliation never rewrites real payments');
  assert.equal(pending(contract, rental, cash.filter(row => row.id !== 'cash-second')), 285.6);
  cash.find(row => row.id === 'cash-second').receiptStatus = 'anulado';
  assert.equal(pending(contract, rental, cash), 285.6, 'a voided receipt cannot unlock refund');
});
test('return balance receipt can be inferred without operation id or added without a ledger annotation', () => {
  const { contract, rental, cash } = paidReturnFixture();
  delete cash[1].clientOperationId;
  assert.equal(pending(contract, rental, cash), 0, 'legacy link uses date, amount, method and account');
  contract.economicLedger = contract.economicLedger.filter(row => row.id !== 'second');
  assert.equal(pending(contract, rental, cash), 0, 'cash-only return balance must not disappear');
  cash[1].collectionTarget = 'damage';
  assert.equal(pending(contract, rental, cash), 285.6, 'damage payments cannot settle commercial debt');
});
test('deposit operation identity links an edited receipt without trusting stale date or amount', () => {
  const { contract, rental, cash } = paidReturnFixture();
  cash[1].receiptIssuedAt = '2026-11-01T20:30:46Z'; cash[1].amountBs = 200; cash[1].contractAllocationBs = 200;
  assert.equal(pending(contract, rental, cash), 85.6);
});
