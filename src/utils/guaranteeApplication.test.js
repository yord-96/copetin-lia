import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuaranteeApplicationPlan, getGuaranteeApplicationReceiptBalances } from './guaranteeApplication.js';

test('comprobante 2826: garantía 800, aplicación 210, saldo 590 sin contar anulaciones', () => {
  const entry = { id: 'application', type: 'charge', amountBs: 210, createdAt: '2026-10-21T16:51:45Z' };
  const ledger = [
    { id: 'reserve', type: 'guarantee', amountBs: 800, createdAt: '2026-10-10T16:44:21Z' },
    { id: 'void-refund', type: 'refund', amountBs: 590, createdAt: '2026-10-21T17:00:00Z', deletedAt: '2026-10-21' },
    entry,
  ];
  assert.deepEqual(getGuaranteeApplicationReceiptBalances({ entry, ledger, availableGuaranteeBs: 590 }), {
    guaranteeBeforeBs: 800, guaranteeAfterBs: 590,
  });
});

test('reimprime el saldo histórico después de otras aplicaciones, devoluciones y nuevas garantías', () => {
  const entry = { id: 'first', type: 'charge', amountBs: 210, createdAt: '2026-10-21T10:00:00Z' };
  const ledger = [
    { id: 'later', type: 'guarantee_apply', amountBs: 90, createdAt: '2026-10-21T11:00:00Z' },
    { id: 'refund', type: 'refund', amountBs: 500, createdAt: '2026-10-21T12:00:00Z' },
    { id: 'cash-charge', type: 'charge', amountBs: 50, cashMovementId: 'cash', createdAt: '2026-10-21T13:00:00Z' },
    { id: 'surplus', type: 'refund', refundSource: 'surplus', amountBs: 100, createdAt: '2026-10-21T13:00:00Z' },
    { id: 'new-reserve', type: 'guarantee', amountBs: 200, createdAt: '2026-10-21T14:00:00Z' },
    entry,
  ];
  assert.deepEqual(getGuaranteeApplicationReceiptBalances({
    entry, ledger, availableGuaranteeBs: 200,
    isCashCharge: row => Boolean(row.cashMovementId),
    isConfirmedRefund: () => true, isBackedGuarantee: () => true,
  }), { guaranteeBeforeBs: 800, guaranteeAfterBs: 590 });
});

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
