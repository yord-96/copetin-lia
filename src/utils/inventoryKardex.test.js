import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInventoryKardexRows,
  filterInventoryKardexMovements,
  getMovementPhysicalDelta,
} from './inventoryKardex.js';

test('el kardex reconcilia inicio, entradas, bajas y stock fisico actual', () => {
  const movements = [
    { itemId: 'chair', type: 'entrada', beforeTotalStock: 40, afterTotalStock: 50, beforeAvailableStock: 40, afterAvailableStock: 50 },
    { itemId: 'chair', type: 'reserva', deltaUnits: -8, beforeTotalStock: 50, afterTotalStock: 50, beforeAvailableStock: 50, afterAvailableStock: 42 },
    { itemId: 'chair', type: 'salida', beforeTotalStock: 50, afterTotalStock: 48, beforeAvailableStock: 42, afterAvailableStock: 40 },
  ];
  const [row] = buildInventoryKardexRows([{ id: 'chair', totalStock: 48, availableStock: 40 }], movements);

  assert.deepEqual(row, {
    itemId: 'chair', initialStock: 40, stockIn: 10, stockOut: 2,
    currentStock: 48, availableStock: 40, committedStock: 8,
    movementCount: 3, physicalMovementCount: 2, availableNet: 0,
  });
});

test('una reserva cambia disponibilidad pero no se cuenta como baja fisica', () => {
  const reservation = { type: 'reserva', deltaUnits: -4 };
  assert.equal(getMovementPhysicalDelta(reservation), 0);
  assert.deepEqual(filterInventoryKardexMovements([reservation], 'decreases'), []);
  assert.deepEqual(filterInventoryKardexMovements([reservation], 'available'), [reservation]);
});
