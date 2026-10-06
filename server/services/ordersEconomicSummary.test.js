import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrdersCashIndex } from './ordersCashIndex.js';
import { getOrdersContractCashEconomicSummary, getOrdersGuaranteeEconomicSummary } from './ordersEconomicSummary.js';

const contract = { id: 'contract-1', rentalId: 'rental-1', contractCode: '2026', orderCode: 'OS-001', totals: { guaranteeBs: 200 }, economicLedger: [] };
const receipt = (id, fields = {}) => ({ id, type: 'ingreso_alquiler', cashBoxType: 'BIG_CASH', amountBs: 100, receiptCode: `REC-${id}`, collectionTarget: 'balance', ...fields });

test('candidate index preserves source order, deduplicates aliases and retains legacy text receipts', () => {
  const rows = [receipt('a', { linkedContractId: 'contract-1', linkedRentalId: 'rental-1' }), receipt('unrelated', { contractId: 'other' }), receipt('legacy', { description: 'Abono del Contrato 2026' }), receipt('case', { contractId: 'CONTRACT-1' }), receipt('void', { contractId: 'contract-1', voidedAt: '2026-10-06' })];
  const candidates = createOrdersCashIndex(rows)(contract);
  assert.deepEqual(candidates.map((row) => row.id), ['a', 'legacy', 'case']);
  const full = getOrdersContractCashEconomicSummary(contract, rows);
  assert.deepEqual(getOrdersContractCashEconomicSummary(contract, candidates), full);
  assert.equal(full.contractPaidBs, 300);
});

test('economic amounts retain payment allocation, guarantee use and confirmed refund behavior', () => {
  const item = { ...contract, economicLedger: [
    { id: 'deposit-1', type: 'deposit', amountBs: 1000, guaranteeAllocationBs: 200, cashMovementId: 'pay', isCashRegistered: true },
    { id: 'use', type: 'guarantee_apply', amountBs: 50 },
    { id: 'refund', type: 'refund', amountBs: 100, cashMovementId: 'refund-cash' },
    { id: 'unconfirmed-refund', type: 'refund', amountBs: 999 },
    { id: 'surplus', type: 'refund', refundSource: 'surplus', amountBs: 300, isCashRegistered: true },
  ] };
  const rows = [receipt('unrelated', { contractId: 'other', amountBs: 99999 }), receipt('pay', { contractId: item.id, amountBs: 1200, contractAllocationBs: 1000, guaranteeAllocationBs: 200 }), receipt('deleted', { contractId: item.id, deletedAt: 'now', amountBs: 9000 })];
  const candidates = createOrdersCashIndex(rows)(item);
  const cash = getOrdersContractCashEconomicSummary(item, candidates);
  assert.deepEqual(cash, { contractPaidBs: 1000, guaranteePaidBs: 200, totalReceivedBs: 1200, receiptCount: 1 });
  const guarantee = getOrdersGuaranteeEconomicSummary(item, candidates, cash);
  assert.deepEqual(guarantee, { declaredBs: 200, paidBs: 200, appliedBs: 50, refundedBs: 100, pendingRefundBs: 50, status: 'partial' });
  assert.deepEqual(cash, getOrdersContractCashEconomicSummary(item, rows));
  assert.deepEqual(guarantee, getOrdersGuaranteeEconomicSummary(item, rows));
});

test('wrong structured ID and incidental dates are not accepted by payment reconciliation', () => {
  const rows = [receipt('wrong-id', { contractId: 'other', reference: '2026', amountBs: 700, collectionTarget: '' }), receipt('date', { description: 'Pago registrado el 10/06/2026', amountBs: 800 }), receipt('order', { description: 'Abono OS-001 confirmado', amountBs: 90 }), receipt('explicit-code', { description: 'Contrato Nro. 2026', amountBs: 60 })];
  const cash = getOrdersContractCashEconomicSummary(contract, createOrdersCashIndex(rows)(contract));
  assert.equal(cash.contractPaidBs, 150);
  assert.deepEqual(cash, getOrdersContractCashEconomicSummary(contract, rows));
});

test('all legacy reference fields and floating-point addition order preserve existing summaries', () => {
  const fields = ['linkedContractId', 'linkedRentalId', 'linkedOrderCode', 'contractId', 'rentalId', 'contractCode', 'orderCode', 'reference', 'sourceId'];
  const rows = fields.map((field, i) => receipt(`r${i}`, { [field]: '  contract-1  ', amountBs: (i + 1) / 10, contractAllocationBs: (i + 1) / 10 }));
  rows.splice(3, 0, receipt('duplicate-link', { contractId: 'contract-1', reference: 'OS-001', amountBs: 0.1, contractAllocationBs: 0.1 }));
  const candidates = createOrdersCashIndex(rows)(contract);
  assert.deepEqual(candidates, rows);
  assert.deepEqual(getOrdersContractCashEconomicSummary(contract, candidates), getOrdersContractCashEconomicSummary(contract, rows));
  assert.deepEqual(getOrdersGuaranteeEconomicSummary(contract, candidates), getOrdersGuaranteeEconomicSummary(contract, rows));
});
