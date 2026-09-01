import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuaranteeApplicationPlan } from './guaranteeApplication.js';

test('aplica Bs 159 al saldo de items y devuelve Bs 41 de una garantia de Bs 200', () => {
  assert.deepEqual(buildGuaranteeApplicationPlan({
    availableGuaranteeBs: 200,
    rentalPendingBs: 159,
  }), {
    guaranteeBs: 200,
    rentalPendingBs: 159,
    damagePendingBs: 0,
    rentalAppliedBs: 159,
    damageAppliedBs: 0,
    appliedBs: 159,
    refundBs: 41,
  });
});

test('prioriza el saldo comercial, luego danos, y solo devuelve el remanente', () => {
  const plan = buildGuaranteeApplicationPlan({
    availableGuaranteeBs: 200,
    rentalPendingBs: 100,
    damagePendingBs: 50,
  });
  assert.equal(plan.rentalAppliedBs, 100);
  assert.equal(plan.damageAppliedBs, 50);
  assert.equal(plan.refundBs, 50);
});

test('no devuelve dinero si el saldo supera la garantia', () => {
  const plan = buildGuaranteeApplicationPlan({ availableGuaranteeBs: 200, rentalPendingBs: 250 });
  assert.equal(plan.appliedBs, 200);
  assert.equal(plan.refundBs, 0);
});
