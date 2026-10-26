import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInventoryPurchase } from './inventoryPurchase.js';
import { filterInventoryMovementHistory } from './inventoryMovementHistory.js';

test('purchase date and cost are optional, valid historical dates and zero costs are preserved', () => {
  assert.deepEqual(normalizeInventoryPurchase({}), { purchaseDate: '', purchaseCostBs: null });
  assert.deepEqual(normalizeInventoryPurchase({ purchaseDate: '2026-09-02', purchaseCostBs: '0' }), { purchaseDate: '2026-09-02', purchaseCostBs: 0 });
  assert.equal(normalizeInventoryPurchase({ purchaseCostBs: '123.45' }).purchaseCostBs, 123.45);
  for (const purchaseDate of ['2026-02-30', 'invalid', '2999-01-01']) assert.throws(() => normalizeInventoryPurchase({ purchaseDate }), /fecha/);
  for (const purchaseCostBs of [-1, 'bad', Infinity]) assert.throws(() => normalizeInventoryPurchase({ purchaseCostBs }), /costo/);
});

test('adjustment view includes manual purchases and legacy entries but excludes contract reservations and repairs', () => {
  const rows = [
    { id: 'purchase', type: 'entrada', sourceType: 'manual_stock_movement' },
    { id: 'legacy', type: 'entrada', minimumPhysicalStockAfter: 0 },
    { id: 'adjustment', type: 'ajuste' },
    { id: 'contract', type: 'reserva' },
    { id: 'repair', type: 'reinsercion', sourceType: 'damage_repair_reinsert' },
  ];
  assert.deepEqual(filterInventoryMovementHistory(rows, { type: 'stock_adjustments' }).map(row => row.id), ['purchase', 'legacy', 'adjustment']);
});
