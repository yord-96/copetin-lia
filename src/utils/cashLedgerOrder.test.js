import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveCashLedgerOrder, compareCashLedgerOrder } from './cashLedgerOrder.js';
import { buildBigCashFundTimeline } from './dailyCashReport.js';

test('recupera el orden legacy e incluye pagos y devoluciones retroactivos después del fondo', () => {
  const base = { cashBoxType: 'BIG_CASH', paymentMethod: 'efectivo' };
  const state = preserveCashLedgerOrder({ cashMovements: [
    { ...base, id: 'old', amountBs: 900, createdAt: '2026-09-01T10:00:00Z' },
    { ...base, id: 'fund', amountBs: 5000, accountingTag: 'big_cash_fund_in', createdAt: '2026-10-01T19:46:00Z' },
    { ...base, id: 'payment', amountBs: 235, createdAt: '2026-10-01T04:27:40Z', receiptIssuedAt: '2026-10-01T04:27:40Z' },
    { ...base, id: 'refund', amountBs: -150, createdAt: '2026-10-02T04:54:36Z', receiptIssuedAt: '2026-09-01T04:54:00Z' },
  ] });
  const timeline = buildBigCashFundTimeline(state.cashMovements.slice().reverse());
  assert.equal(timeline.byMovementId.has('old'), false);
  assert.equal(timeline.byMovementId.get('payment').totalBs, 5235);
  assert.equal(timeline.byMovementId.get('refund').totalBs, 5085);
  const changed = state.cashMovements.map(row => ({ ...row, createdAt: '2020-01-01T00:00:00Z', receiptIssuedAt: '2030-01-01T00:00:00Z' }));
  assert.deepEqual(buildBigCashFundTimeline(changed), timeline);
});

test('el servidor conserva la secuencia y hora guardadas y asigna el siguiente número a nuevos movimientos', () => {
  const previous = preserveCashLedgerOrder({ cashMovements: [{ id: 'a' }] });
  const registered = preserveCashLedgerOrder({ cashMovements: [...previous.cashMovements, { id: 'b', cashLedgerSequence: 1, cashRegisteredAt: '2020-01-01' }] }, previous, '2026-10-02T15:00:00Z');
  assert.equal(registered.cashMovements[1].cashLedgerSequence, 2);
  assert.equal(registered.cashMovements[1].cashRegisteredAt, '2026-10-02T15:00:00Z');
  const edited = preserveCashLedgerOrder({ cashMovements: registered.cashMovements.slice().reverse().map(row => ({ ...row, cashLedgerSequence: 999, cashRegisteredAt: '2030-01-01' })) }, registered);
  assert.deepEqual(edited.cashMovements.slice().sort(compareCashLedgerOrder), registered.cashMovements);
  const deleted = preserveCashLedgerOrder({ cashMovements: [] }, registered);
  const added = preserveCashLedgerOrder({ cashMovements: [{ id: 'c' }] }, preserveCashLedgerOrder(deleted));
  assert.equal(added.cashMovements[0].cashLedgerSequence, 3);
});
