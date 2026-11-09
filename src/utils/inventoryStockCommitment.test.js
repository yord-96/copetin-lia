import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInventoryStockCommitments } from './inventoryStockCommitment.js';
import { applyInventoryStockMovement } from '../services/webBridge.js';

const rental = (id, start, end, quantity = 12) => ({ id, status: 'active', rentalDate: start, dueDate: end, operational: { inventoryStatus: 'pendiente' }, items: [{ lineKey: id, itemId: 'i', quantity, internalReservedQty: quantity }] });
test('different event dates reuse the same physical units, overlapping reservations still add up', () => {
  const rows = [rental('a', '2026-11-13', '2026-11-15'), rental('b', '2026-12-24', '2026-12-27')];
  assert.equal(buildInventoryStockCommitments(rows, { todayKey: '2026-11-09' }).get('i'), 12);
  rows.push(rental('c', '2026-11-14', '2026-11-16', 3));
  assert.equal(buildInventoryStockCommitments(rows, { todayKey: '2026-11-09' }).get('i'), 15);
});
test('late dispatched material remains committed until returned, while partial returns release only processed units', () => {
  const row = rental('a', '2026-10-01', '2026-10-02', 20);
  row.operational.inventoryStatus = 'salio';
  row.partialReturnReport = { items: [{ lineKey: 'a', itemId: 'i', returnedQty: 18, returnedToAvailableQty: 18, pendingClientQty: 2 }] };
  const today = rental('b', '2026-11-09', '2026-11-10', 3);
  assert.equal(buildInventoryStockCommitments([row, today], { todayKey: '2026-11-09' }).get('i'), 5);
  row.operational.inventoryStatus = 'devuelto';
  assert.equal(buildInventoryStockCommitments([row, today], { todayKey: '2026-11-09' }).get('i'), 3);
});
test('supplier units, unverified lines and cancelled orders do not lock owned stock', () => {
  const row = rental('a', '2026-11-13', '2026-11-15', 20);
  row.items[0].internalReservedQty = 5; row.items[0].supplierBackedQty = 15;
  const unverified = rental('u', '2026-11-13', '2026-11-15', 100); unverified.items[0].verificationStatus = 'pending_verification';
  const cancelled = rental('c', '2026-11-13', '2026-11-15', 100); cancelled.cancelledAt = '2026-11-09';
  assert.equal(buildInventoryStockCommitments([row, unverified, cancelled], { todayKey: '2026-11-09' }).get('i'), 5);
});
test('stock losses can use free units without stealing concurrent reservations; retries do not deduct twice', () => {
  const state = { items: [{ id: 'i', name: 'Vaso', totalStock: 20, availableStock: 20 }], rentals: [rental('a', '2099-11-13', '2099-11-15'), rental('b', '2099-12-24', '2099-12-27')], inventoryMovements: [] };
  const command = { itemId: 'i', type: 'salida', quantity: 5, reason: 'Pérdida en lavandería', clientOperationId: 'same' };
  applyInventoryStockMovement(state, command);
  assert.equal(state.items[0].totalStock, 15);
  assert.equal(state.items[0].availableStock, 3);
  applyInventoryStockMovement(state, command);
  assert.equal(state.items[0].totalStock, 15);
  assert.throws(() => applyInventoryStockMovement(state, { ...command, clientOperationId: 'too-much', quantity: 4 }), /Disponible real: 3/);
  assert.equal(state.items[0].totalStock, 15);
});
