import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWeeklyInventoryHtml } from './webBridge.js';

test('el inventario individual muestra la orden seleccionada aunque no tenga fechas dentro de la semana', () => {
  const rental = {
    id: 'rental-34',
    orderCode: 'OS-00034',
    contractCode: '2468',
    customerName: 'CLIENTE PRUEBA',
    status: 'active',
    items: [{ itemId: 'item-1', itemName: 'SERVILLETA VERDE BOTELLA', quantity: 10 }],
    createdAt: '2026-09-01T12:00:00.000Z',
  };

  const html = buildWeeklyInventoryHtml({
    rentals: [rental],
    contracts: [],
    deliveries: [],
    items: [],
    settings: {},
    weekStart: '2026-09-07',
    weekEnd: '2026-09-13',
    format: 'individual',
    targetRentalId: rental.id,
    targetOrderCode: rental.orderCode,
    targetContractCode: rental.contractCode,
  });

  assert.match(html, /CLIENTE PRUEBA/);
  assert.match(html, /SERVILLETA VERDE BOTELLA/);
  assert.doesNotMatch(html, /No se encontro la orden seleccionada para esta semana\./);
});
