import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWeeklyInventoryHtml, buildContractDocumentHtml } from './webBridge.js';

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

test('internal order uses the same contract creation date as the commercial contract', () => {
  const rental = { id: 'rental', contractId: 'contract', contractCode: '3647', orderCode: 'OS-02304', customerName: 'CLIENTE PRUEBA', createdAt: '2026-11-21T13:00:00Z', rentalDate: '2026-11-24', items: [{ itemId: 'item', itemName: 'PLAQUET', quantity: 3 }] };
  const contract = { id: 'contract', contractCode: '3647', contractDate: '2026-11-19', createdAt: '2026-11-21T12:00:00Z', items: rental.items };
  const render = (contracts, order = rental) => buildWeeklyInventoryHtml({ rentals: [order], contracts, deliveries: [], items: [], settings: {}, weekStart: '2026-11-23', weekEnd: '2026-11-29', format: 'individual', targetRentalId: rental.id });
  const date = html => html.match(/Contrato creado<\/small><strong>(.*?)<\/strong>/)[1];
  const expected = 'Jueves 19 de noviembre 2026';
  assert.equal(date(render([contract])), expected);
  assert.ok(buildContractDocumentHtml({ contract, rental, deliveries: [], settings: {} }).includes(expected));
  // Legacy records may retain the selected date only on the rental.
  assert.equal(date(render([], { ...rental, contractDate: '2026-11-19' })), expected);
  assert.equal(date(render([{ ...contract, contractDate: undefined }], { ...rental, contractDate: '2026-11-19' })), expected);
  assert.equal(date(render([{ ...contract, contractDate: undefined, createdAt: '2026-11-19T12:00:00Z' }])), expected);
});
