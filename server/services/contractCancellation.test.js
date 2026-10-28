import test from 'node:test';
import assert from 'node:assert/strict';
import { cancellationPreview, applyCancellationSettlement } from './contractCancellation.js';

const fixture = () => ({ contracts: [{ id: 'c', rentalId: 'r', contractCode: '1833', guarantee: { amountBs: 700 } }], rentals: [{ id: 'r', contractId: 'c' }], cashMovements: [
  { id: 'in', linkedContractId: 'c', type: 'ingreso_alquiler', amountBs: 2000, guaranteeAllocationBs: 500, createdAt: '2026-07-21' },
  { id: 'refund', linkedContractId: 'c', type: 'egreso_devolucion_garantia', amountBs: -300 },
  { id: 'transport-cost', linkedContractId: 'c', type: 'egreso_flete', amountBs: -200 },
  { id: 'other', linkedContractId: 'other', type: 'ingreso_alquiler', amountBs: 9000 },
  { id: 'void', linkedContractId: 'c', amountBs: 1000, voidedAt: 'now' },
] });

test('preview separates real guarantee, prior refunds and unrelated operating costs', () => {
  const state = fixture(); const preview = cancellationPreview(state, state.contracts[0], state.rentals[0]);
  assert.equal(preview.receivedBs, 2000); assert.equal(preview.refundedBs, 300); assert.equal(preview.availableBs, 1700);
  assert.equal(preview.guaranteeReceivedBs, 500); assert.equal(preview.guaranteeConfiguredBs, 700);
});

test('retaining all available funds creates no cash movement; guarantee closes to zero', () => {
  const state = fixture(); const contract = state.contracts[0]; const rental = state.rentals[0];
  const preview = cancellationPreview(state, contract, rental); const before = structuredClone(state.cashMovements);
  const result = applyCancellationSettlement(state, contract, rental, { reason: 'Acuerdo', economicSettlement: {
    operationId: 'all-retained', version: preview.version, retainedPenaltyBs: 1700, refundBs: 0,
  } }, () => { throw new Error('No cash movement should be created'); });
  assert.equal(result.movement, null); assert.deepEqual(state.cashMovements, before);
  assert.equal(result.settlement.retainedPenaltyBs, 1700); assert.equal(contract.guarantee.amountBs, 0);
});

test('unbacked payments, changed finances, negative allocations and missing refund accounts block settlement', () => {
  for (const kind of ['unbacked', 'stale', 'negative', 'account']) {
    const state = fixture(); const contract = state.contracts[0]; const rental = state.rentals[0];
    if (kind === 'unbacked') rental.payment = { paidAtRentalBs: 3000 };
    const preview = cancellationPreview(state, contract, rental);
    const draft = { operationId: kind, version: kind === 'stale' ? 'old' : preview.version, retainedPenaltyBs: kind === 'negative' ? -1 : 200,
      refundBs: kind === 'negative' ? 1701 : 1500, paymentMethod: 'qr', paymentAccount: kind === 'account' ? '' : 'CIDRE' };
    const before = structuredClone(state);
    assert.throws(() => applyCancellationSettlement(state, contract, rental, { economicSettlement: draft }, () => ({})));
    assert.deepEqual(state, before);
  }
});

test('2489: corrected receipt 1063 supersedes stale paid snapshot 1663 without creating income', () => {
  const contract = { id: 'c', rentalId: 'r', contractCode: '2489', economicResetAt: '2026-10-28T18:00:00Z', economicResetVersion: 1, payment: { paidAtApprovalBs: 1663 },
    economicLedger: [{ id: 'initial-payment-c', type: 'deposit', amountBs: 1663, isCashRegistered: false },
      { id: 'confirmed-deposit', type: 'deposit', amountBs: 1063, cashMovementId: 'receipt', isCashRegistered: true }] };
  const rental = { id: 'r', payment: { paidAtRentalBs: 1663, cashCollectedBs: 1663 } };
  const state = { contracts: [contract], rentals: [rental], cashMovements: [
    { id: 'old', linkedContractId: 'c', cashBoxType: 'BIG_CASH', amountBs: 1663, voidedAt: 'now' },
    { id: 'receipt', linkedContractId: 'c', cashBoxType: 'BIG_CASH', type: 'ingreso_alquiler', amountBs: 1063, receiptCode: 'RC-14405', paymentMethod: 'qr', paymentAccount: 'MERCANTIL' }] };
  const preview = cancellationPreview(state, contract, rental);
  assert.equal(preview.unbackedBs, 0); assert.equal(preview.availableBs, 1063);
  const result = applyCancellationSettlement(state, contract, rental, { reason: 'Acuerdo con cliente', economicSettlement: {
    operationId: '2489', version: preview.version, retainedPenaltyBs: 332.60, refundBs: 730.40, paymentMethod: 'qr', paymentAccount: 'MERCANTIL',
  } }, payload => ({ ...payload, id: 'refund', receiptCode: 'RC-new' }));
  assert.equal(result.movement.amountBs, -730.4); assert.equal(result.settlement.retainedPenaltyBs, 332.6);
  assert.equal(state.cashMovements.filter(row => !row.voidedAt).reduce((sum, row) => sum + row.amountBs, 0), 332.6);
});

test('corrected initial receipt is reconciled by initial identity, but unrelated unbacked deposits still block', () => {
  const contract = { id: 'c', payment: { paidAtApprovalBs: 1663 }, economicLedger: [
    { id: 'initial-payment-c', type: 'deposit', amountBs: 1663 },
  ] };
  const rental = { id: 'r', payment: { paidAtRentalBs: 1663 } };
  const state = { cashMovements: [{ id: 'receipt', linkedContractId: 'c', cashBoxType: 'BIG_CASH',
    type: 'ingreso_alquiler', accountingTag: 'initial_rental_payment', amountBs: 1063 }] };
  assert.equal(cancellationPreview(state, contract, rental).unbackedBs, 0);
  contract.economicLedger.push({ id: 'unconfirmed-extra-deposit', type: 'deposit', amountBs: 600 });
  assert.equal(cancellationPreview(state, contract, rental).unbackedBs, 600);
});

test('zero receipts after economic reset allows cancellation without fee, refund or new cash', () => {
  const contract = { id: 'c', economicResetAt: '2026-10-28', economicResetVersion: 1,
    payment: { paidAtApprovalBs: 0 }, economicLedger: [] };
  const rental = { id: 'r', payment: { paidAtRentalBs: 1663, cashCollectedBs: 1663 } };
  const state = { cashMovements: [{ id: 'old', linkedContractId: 'c', amountBs: 1663, voidedAt: 'reset' }] };
  const preview = cancellationPreview(state, contract, rental);
  assert.equal(preview.availableBs, 0); assert.equal(preview.unbackedBs, 0);
  const before = structuredClone(state.cashMovements);
  applyCancellationSettlement(state, contract, rental, { reason: 'Sin cobros vigentes', economicSettlement: {
    operationId: 'zero-reset', version: preview.version, retainedPenaltyBs: 0, refundBs: 0,
  } }, () => { throw new Error('Must not create any cash'); });
  assert.deepEqual(state.cashMovements, before);
  contract.economicLedger.push({ id: 'missing', type: 'deposit', amountBs: 50 });
  assert.equal(cancellationPreview(state, contract, rental).unbackedBs, 50);
});
