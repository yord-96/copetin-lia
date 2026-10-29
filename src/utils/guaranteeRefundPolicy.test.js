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
