import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileGuaranteeRefundLedger } from './guaranteeRefundLedger.js';
import { getOrdersGuaranteeEconomicSummary } from '../../server/services/ordersEconomicSummary.js';
import { repairMissingRefundLedgerEntries } from '../../server/migrations/repairLegacyGuaranteeRefunds.js';

const contract = { id: 'c', rentalId: 'r', contractCode: '2459', totals: { guaranteeBs: 200 },
  guarantee: { status: 'validado' }, economicLedger: [{ id: 'g', type: 'guarantee', amountBs: 200, cashMovementId: 'in' }] };
const refund = { id: 'out', linkedContractId: 'c', linkedRentalId: 'r', type: 'egreso_manual', amountBs: -200,
  accountingTag: 'guarantee_refund', receiptCode: 'RC-14011', cashBoxType: 'BIG_CASH',
  createdAt: '2026-10-19T20:04:57.916Z', paymentMethod: 'efectivo', createdByName: 'ESTHER PLATA' };

test('2459: cash refund is linked once, retaining receipt/date/author and without changing cash', () => {
  const state = { contracts: [structuredClone(contract)], cashMovements: [structuredClone(refund)] };
  const before = JSON.stringify(state.cashMovements);
  assert.equal(repairMissingRefundLedgerEntries(state).length, 1);
  assert.equal(repairMissingRefundLedgerEntries(state).length, 0);
  assert.equal(JSON.stringify(state.cashMovements), before);
  const row = state.contracts[0].economicLedger[1];
  assert.equal(row.cashMovementId, 'out'); assert.equal(row.cashReceiptCode, 'RC-14011');
  assert.equal(row.createdAt, refund.createdAt); assert.equal(row.createdByName, 'ESTHER PLATA');
  assert.deepEqual(getOrdersGuaranteeEconomicSummary(contract, [refund]), {
    declaredBs: 200, paidBs: 200, appliedBs: 0, refundedBs: 200, pendingRefundBs: 0, status: 'returned' });
});

test('does not revive deleted rows, use voided receipts, cross contracts or duplicate a legacy refund', () => {
  for (const invalid of [{ ...refund, voidedAt: 'now' }, { ...refund, deletedAt: 'now' },
    { ...refund, receiptStatus: 'anulado' }, { ...refund, linkedContractId: 'other' }, { ...refund, amountBs: 200 }]) {
    assert.equal(reconcileGuaranteeRefundLedger(contract, [invalid]).length, 1);
  }
  const existing = { id: 'legacy', type: 'refund', amountBs: 200, createdAt: refund.createdAt };
  const linked = reconcileGuaranteeRefundLedger({ ...contract, economicLedger: [existing] }, [refund]);
  assert.equal(linked.length, 1); assert.equal(linked[0].id, 'legacy'); assert.equal(linked[0].cashMovementId, 'out');
  assert.deepEqual(reconcileGuaranteeRefundLedger({ ...contract, economicLedger: [{ ...existing, deletedAt: 'now' }] }, [refund]), [{ ...existing, deletedAt: 'now' }]);
});
