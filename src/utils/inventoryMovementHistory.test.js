import test from 'node:test';
import assert from 'node:assert/strict';

import { filterInventoryMovementHistory } from './inventoryMovementHistory.js';

const movements = [
  {
    id: 'recent-reservation',
    type: 'reserva',
    itemName: 'SERVILLETA LISO / VERDE BOTELLA',
    contractCode: '2293',
    customerName: 'LUZ AMERICA LUNA JALDIN',
    operationDate: '2026-12-18',
  },
  {
    id: 'historical-exit',
    type: 'salida',
    itemName: 'SERVILLETA LISO / VERDE BOTELLA',
    contractCode: '1181',
    customerName: 'CLIENTE HISTORICO',
    operationDate: '2025-05-13',
  },
  {
    id: 'other-product',
    type: 'salida',
    itemName: 'MANTEL BLANCO',
    contractCode: '900',
    operationDate: '2025-05-13',
  },
];

test('busca un producto en reservas actuales y salidas historicas', () => {
  const result = filterInventoryMovementHistory(movements, { query: 'servilleta verde botella' });

  assert.deepEqual(result.map((row) => row.id), ['recent-reservation', 'historical-exit']);
});

test('busca por contrato o cliente y respeta el periodo', () => {
  assert.deepEqual(
    filterInventoryMovementHistory(movements, { query: '1181 cliente historico' }).map((row) => row.id),
    ['historical-exit'],
  );
  assert.deepEqual(
    filterInventoryMovementHistory(movements, { query: 'servilleta', from: '2026-01-01' }).map((row) => row.id),
    ['recent-reservation'],
  );
});
