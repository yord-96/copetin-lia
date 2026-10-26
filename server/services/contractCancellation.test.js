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
