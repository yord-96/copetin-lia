import test from 'node:test';
import assert from 'node:assert/strict';
import { auditContractPayments } from './audit-contract-payments.mjs';

test('audit distinguishes receipt mismatches and separate automatic collections from normal linked payments', () => {
  const contract = { id: 'c', contractCode: '1', economicLedger: [
    { id: 'first', type: 'deposit', amountBs: 500, cashMovementId: 'm1' },
  ], revisionHistory: [{ updatedAt: '2026-10-07T19:00:00Z', changes: ['Actualizo items'] }] };
  const cash = { id: 'm1', linkedContractId: 'c', amountBs: 500, receiptCode: 'RC-1',
    accountingTag: 'initial_rental_payment', notes: 'Pago inicial registrado desde contrato 1' };
  assert.equal(auditContractPayments({ contracts: [contract], cashMovements: [cash] }).contractsFlagged, 0);
  const state = { contracts: [contract], cashMovements: [{ ...cash, amountBs: 50, accountingTag: 'contract_deposit_receipt' },
    { ...cash, id: 'm2', receiptCode: 'RC-2', createdAt: '2026-10-07T19:00:00Z' },
    { ...cash, id: 'foreign', linkedContractId: 'other' },
    { ...cash, id: 'deleted', receiptStatus: 'eliminado' }] };
  const before = structuredClone(state);
  const result = auditContractPayments(state);
  assert.equal(result.confirmedInconsistencyContracts, 1);
  assert.equal(result.automaticPaymentReviewContracts, 1);
  assert.equal(result.findings[0].issues.length, 2);
  assert.equal(result.findings[0].issues[1].createdDuringContractEdit, true);
  assert.deepEqual(state, before);
});
