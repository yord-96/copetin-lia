import test from 'node:test';
import assert from 'node:assert/strict';
import { getComboAvailabilityRows } from './comboAvailability.js';

const items = [{ id: 'a', category: 'SILLAS' }, { id: 'b', category: 'SILLAS' }, { id: 'table' }];
const availability = new Map([['a', 8], ['b', 4], ['table', 5]].map(([id, stock]) => [id, {
  stockControlled: true, totalStock: stock, currentAvailable: stock,
  projectedAvailable: stock, projectedAfterSoftAvailable: stock,
}]));
const combo = { id: 'set', name: 'Mesa vestida', ingredients: [
  { selectionMode: 'category', category: 'sillas', quantity: 4 },
  { itemId: 'table', quantity: 1 },
] };

test('combos aggregate category alternatives and respect component quantities', () => {
  const [row] = getComboAvailabilityRows({ combos: [combo], items, availability });
  assert.equal(row.projectedAvailable, 3);
  assert.equal(row.stockControlled, true);
  assert.equal(row.item.category, 'COMBOS');
  assert.equal(availability.size, 3);
});

test('date reservations reduce combo capacity without inventing rented combos', () => {
  const reserved = new Map(availability);
  reserved.set('table', { ...availability.get('table'), projectedAvailable: 1, projectedAfterSoftAvailable: 0 });
  const [row] = getComboAvailabilityRows({ combos: [combo], items, availability: reserved });
  assert.equal(row.totalStock, 3);
  assert.equal(row.projectedAvailable, 1);
  assert.equal(row.projectedAfterSoftAvailable, 0);
  assert.deepEqual(row.hardReservedQtyRecords, []);
});

test('deleted combos and missing components are not offered as available', () => {
  const rows = getComboAvailabilityRows({ combos: [{ ...combo, deletedAt: '2026-09-16' }, combo], items: items.slice(0, 2), availability });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].projectedAvailable, 0);
  assert.equal(rows[0].stockControlled, false);
});

test('explicit option IDs are deduplicated', () => {
  const [row] = getComboAvailabilityRows({ combos: [{ ...combo, ingredients: [{ optionItemIds: ['a', 'a', 'b'], quantity: 2 }] }], items, availability });
  assert.equal(row.projectedAvailable, 6);
});
