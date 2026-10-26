import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDamageRepairToOverview } from './damageRepairOverview.js';

test('confirmed partial and complete repairs update only the affected damage row without double counting', () => {
  const row = { id: 'damage', lossType: 'danado', rentalId: 'r', itemId: 'i', reportKind: 'final', reportIndex: 1, quantity: 3, repairedQty: 0, repairableQuantity: 3 };
  const others = [{ ...row, id: 'missing', lossType: 'faltante' }, { ...row, id: 'other-line', reportIndex: 2 }, { ...row, id: 'partial', reportKind: 'partial' }];
  const original = { rows: [row, ...others], total: 4, summary: { economicsByRental: { r: { charged: 50 } } } };
  const result = { repairUpdate: { rentalId: 'r', itemId: 'i', reportKind: 'final', reportIndex: 1,
    repairedQty: 1, repairableQuantity: 2, repairedAt: '2026-10-26T13:34:14Z', repairedByName: 'Operador', repairNote: 'Reparado' } };
  const first = applyDamageRepairToOverview(original, result);
  assert.equal(first.rows[0].repairedQty, 1);
  assert.equal(first.rows[0].repairableQuantity, 2);
  assert.deepEqual(first.rows.slice(1), others);
  assert.deepEqual(first.summary, original.summary);
  assert.equal(original.rows[0].repairedQty, 0);
  assert.deepEqual(applyDamageRepairToOverview(first, result), first);
  const final = applyDamageRepairToOverview(first, { repairUpdate: { ...result.repairUpdate, repairedQty: 3, repairableQuantity: 0 } });
  assert.equal(final.rows[0].repairedQty, 3);
  assert.equal(final.rows[0].repairableQuantity, 0);
});
