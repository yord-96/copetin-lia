import test from 'node:test';
import assert from 'node:assert/strict';
import { getVipAvailableBalance, syncVoidedVipLedger, voidVipUsage, findOrphanedVipCharges } from './vipPrepaidLedger.js';

test('funds are available only from their chosen date, never automatically consumed', () => {
  const client = { prepaidBalanceBs: 300, prepaidMovements: [{ amountBs: 200, availableFromDate: '2026-11-01' }, { amountBs: 100, availableFromDate: '2026-12-01' }] };
  assert.equal(getVipAvailableBalance(client, '2026-11-24'), 200);
  assert.equal(getVipAvailableBalance(client, '2026-12-01'), 300);
  client.prepaidUsageFrom = '2026-12-05';assert.equal(getVipAvailableBalance(client, '2026-12-01'), 0);
  assert.equal(client.prepaidBalanceBs, 300);
});
test('deleting a 2027 economic payment restores VIP and clears stale contract AND rental prepaid fields', () => {
  const debit = { id: 'debit', type: 'charge', amountBs: -1410, sourceId: 'rental', orderCode: 'OS-141' };
  const deposit = { id: 'old-deposit', type: 'deposit', amountBs: 1410 };
  const contract = { id: 'contract', clientId: 'vip', rentalId: 'rental', eventDate: '2027-07-17', totals: { totalBs: 1410 }, payment: { prepaidAppliedBs: 0, paidAtApprovalBs: 0 }, economicLedger: [deposit] };
  const client = { id: 'vip', prepaidBalanceBs: 19236.15, prepaidTotalUsedBs: 1410, prepaidMovements: [debit] };
  const rental = { id: 'rental', contractId: 'contract', totals: { totalBs: 1410, prepaidAppliedBs: 1410 }, payment: { paidAtRentalBs: 1410, prepaidAppliedBs: 1410, pendingPaymentBs: 0 } };
  const state = { clients: [client], contracts: [contract], rentals: [rental], cashMovements: [] };
  const before = structuredClone(contract.economicLedger);
  contract.economicLedger = [{ ...deposit, deletedAt: '2026-11-24' }];
  assert.equal(findOrphanedVipCharges(state, client).length, 1);
  assert.equal(syncVoidedVipLedger(state, contract, before, contract.economicLedger, { now: '2026-11-24', actorName: 'Admin', reason: 'Pago eliminado' }), 1);
  assert.equal(client.prepaidBalanceBs, 20646.15);assert.ok(debit.deletedAt);
  assert.equal(contract.payment.paidAtApprovalBs, 0);assert.equal(contract.payment.pendingBs, 1410);assert.equal(rental.payment.paidAtRentalBs, 0);assert.equal(rental.payment.pendingPaymentBs, 1410);assert.equal(rental.prepaidAppliedBs, 0);
  assert.equal(voidVipUsage(state, client, debit, { now: '2026-11-24' }), false);assert.equal(client.prepaidBalanceBs, 20646.15);assert.equal(state.cashMovements.length, 0);
  assert.equal(findOrphanedVipCharges(state, client).length, 0);
});
