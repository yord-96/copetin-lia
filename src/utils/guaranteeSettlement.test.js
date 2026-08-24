import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateGuaranteeSettlement } from './guaranteeSettlement.js';

test('mantiene pendiente el saldo de una devolución parcial', () => {
  assert.deepEqual(calculateGuaranteeSettlement({
    paidBs: 170,
    appliedBs: 0,
    refundedBs: 150,
  }), {
    paidBs: 170,
    appliedBs: 0,
    refundableBeforeRefundBs: 170,
    refundedBs: 150,
    pendingRefundBs: 20,
    isPartiallyRefunded: true,
    isFullyResolved: false,
  });
});

test('considera finalizada una garantía completamente devuelta', () => {
  const result = calculateGuaranteeSettlement({ paidBs: 170, refundedBs: 170 });
  assert.equal(result.pendingRefundBs, 0);
  assert.equal(result.isPartiallyRefunded, false);
  assert.equal(result.isFullyResolved, true);
});

test('combina monto aplicado y devolución sin exceder la garantía pagada', () => {
  const result = calculateGuaranteeSettlement({ paidBs: 170, appliedBs: 20, refundedBs: 150 });
  assert.equal(result.appliedBs, 20);
  assert.equal(result.refundedBs, 150);
  assert.equal(result.pendingRefundBs, 0);
  assert.equal(result.isFullyResolved, true);
});
