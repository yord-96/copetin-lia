import test from 'node:test';
import assert from 'node:assert/strict';
import { applyInventoryStockMovement } from './webBridge.js';
const fixture = () => ({ settings: {}, rentals: [], items: [{ id: 'i', name: 'PANERO', totalStock: 190, availableStock: 190 }], inventoryMovements: [] });
const entry = state => applyInventoryStockMovement(state, { itemId: 'i', type: 'entrada', quantity: 156, reason: 'Compra', clientOperationId: 'create' });
const edit = movement => ({ editingMovementId: movement.id, expectedMovementVersion: movement.updatedAt ?? movement.createdAt, quantity: 150, reason: 'Compra corregida', userName: 'Milton', clientOperationId: 'edit' });
test('correcting a historical entry changes only the difference, preserves later movements and retries safely', () => {
 const state = fixture(); const movement = entry(state);
 applyInventoryStockMovement(state, { itemId: 'i', type: 'salida', quantity: 10, reason: 'Perdida', clientOperationId: 'exit' });
 const payload = edit(movement); applyInventoryStockMovement(state, payload);
 assert.equal(state.items[0].totalStock, 330); assert.equal(state.items[0].availableStock, 330);
 assert.equal(movement.deltaUnits, 150); assert.equal(movement.editHistory[0].previous.deltaUnits, 156);
 assert.equal(movement.editHistory[0].userName, 'Milton');
 assert.equal(state.inventoryMovements[1].beforeTotalStock, 340); assert.equal(state.inventoryMovements[1].afterTotalStock, 330);
 applyInventoryStockMovement(state, payload); assert.equal(state.items[0].totalStock, 330); assert.equal(movement.editHistory.length, 1);
 assert.throws(() => applyInventoryStockMovement(state, { ...payload, quantity: 140 }), /otros valores/);
 assert.throws(() => applyInventoryStockMovement(state, { ...payload, clientOperationId: 'stale' }), /otra sesion/);
});
test('corrections cannot remove committed stock or edit automatic movements', () => {
 const state = fixture(); const movement = entry(state);
 state.rentals = [{ id: 'r', status: 'active', rentalDate: '2099-01-01', dueDate: '2099-01-02', items: [{ itemId: 'i', quantity: 300 }] }];
 assert.throws(() => applyInventoryStockMovement(state, { ...edit(movement), quantity: 1 }), /comprometidas/);
 assert.equal(state.items[0].totalStock, 346); assert.equal(movement.deltaUnits, 156);
 movement.sourceType = 'rental_return'; assert.throws(() => applyInventoryStockMovement(state, edit(movement)), /manuales/);
});
test('editing an output restores only its corrected difference and rejects fractional quantities', () => {
 const state = fixture(); const movement = applyInventoryStockMovement(state, { itemId: 'i', type: 'salida', quantity: 10, reason: 'Rotura', clientOperationId: 'exit' });
 applyInventoryStockMovement(state, { ...edit(movement), quantity: 4 }); assert.equal(state.items[0].totalStock, 186);
 assert.throws(() => applyInventoryStockMovement(state, { ...edit(movement), clientOperationId: 'bad', quantity: 1.5 }), /entera/);
});
