import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeProgressiveRows } from '../utils/progressiveRows.js';

test('un resumen de movimientos no elimina contratos que ya estaban cargados', () => {
  const current = Array.from({ length: 1043 }, (_, index) => ({
    id: `contract-${index + 1}`,
    contractCode: String(index + 1),
    items: [{ id: `item-${index + 1}` }],
  }));
  const incoming = current.slice(0, 46).map((contract) => ({
    id: contract.id,
    contractCode: contract.contractCode,
    status: 'approved',
    _summaryOnly: true,
  }));

  const result = mergeProgressiveRows(current, incoming);

  assert.equal(result.length, 1043);
  assert.equal(result[0].status, 'approved');
  assert.deepEqual(result[0].items, [{ id: 'item-1' }]);
  assert.equal(result.some((contract) => contract.id === 'contract-1043'), true);
});

test('una respuesta vacia conserva las colecciones compartidas', () => {
  const current = [{ id: 'category-1', name: 'Manteleria' }];

  assert.deepEqual(mergeProgressiveRows(current, []), current);
});

test('Ordenes conserva responsables, telefonos y saldos tras Productos y Calendario', () => {
  const orders = Array.from({ length: 1166 }, (_, index) => ({
    id: `contract-${index + 1}`,
    _summaryOnly: true,
    _ordersSummaryOnly: true,
    status: index < 24 ? 'anulado' : 'aprobado',
    customerPhone: '70000000',
    responsibleName: 'Responsable de prueba',
    responsibles: [{ id: 'user-1', name: 'Responsable de prueba' }],
    payment: { pendingPaymentBs: 425 },
    totals: { totalBs: 500, discountBs: 25 },
    economicLedger: [{ id: 'payment-1', amountBs: 75 }],
  }));
  const inventory = orders.slice(0, 1145).map(({ id, status }) => ({
    id, status, _summaryOnly: true, _inventorySummaryOnly: true,
  }));
  const calendar = orders.filter((row) => row.status !== 'anulado').map(({ id, status }) => ({
    id, status, totals: { totalBs: 500 }, _calendarSummaryOnly: true,
  }));

  let result = orders;
  for (let visit = 0; visit < 3; visit += 1) {
    result = mergeProgressiveRows(mergeProgressiveRows(result, inventory), calendar);
    assert.equal(result.length, 1166);
    for (const row of result) {
      const original = orders.find((entry) => entry.id === row.id);
      for (const key of ['responsibleName', 'responsibles', 'customerPhone', 'payment', 'totals', 'economicLedger']) {
        assert.deepEqual(row[key], original[key], `${row.id}: ${key}`);
      }
      assert.equal(row._summaryOnly, true);
      assert.equal(row._ordersSummaryOnly, true);
    }
  }
});

test('los resumenes conservan detalles anidados y aceptan borrados explicitos', () => {
  const current = [{
    id: 'rental-1', _summaryOnly: true, _ordersSummaryOnly: true,
    responsibleName: 'Anterior', responsibles: [{ id: 'user-1' }],
    payment: { pendingPaymentBs: 425, status: 'pendiente' },
    returnSettlement: { pendingCollectionBs: 30 },
    operational: { inventoryStatus: 'enviado', returnReview: { status: 'revisado' } },
  }];
  const [updated] = mergeProgressiveRows(current, [{
    id: 'rental-1', _calendarSummaryOnly: true,
    operational: { inventoryStatus: 'devuelto' },
  }]);
  assert.deepEqual(updated.returnSettlement, current[0].returnSettlement);
  assert.deepEqual(updated.operational.returnReview, { status: 'revisado' });
  assert.equal(updated.operational.inventoryStatus, 'devuelto');

  const [cleared] = mergeProgressiveRows([updated], [{
    id: 'rental-1', _summaryOnly: true,
    responsibleName: '', responsibles: [], payment: { pendingPaymentBs: 0 }, returnSettlement: null,
  }]);
  assert.equal(cleared.responsibleName, '');
  assert.deepEqual(cleared.responsibles, []);
  assert.deepEqual(cleared.payment, { pendingPaymentBs: 0, status: 'pendiente' });
  assert.equal(cleared.returnSettlement, null);
});

test('un registro completo reemplaza al resumen y no hereda sus indicadores', () => {
  const full = { id: 'contract-1', responsibleName: 'Nuevo', items: [] };
  assert.deepEqual(mergeProgressiveRows([
    { id: 'contract-1', _summaryOnly: true, _ordersSummaryOnly: true, responsibleName: 'Anterior' },
  ], [full]), [full]);
  const [result] = mergeProgressiveRows([full], [{
    id: 'contract-1', _summaryOnly: true, _inventorySummaryOnly: true, status: 'aprobado',
  }]);
  assert.equal(result._summaryOnly, undefined);
  assert.equal(result._inventorySummaryOnly, undefined);
  assert.equal(result.responsibleName, 'Nuevo');
});
