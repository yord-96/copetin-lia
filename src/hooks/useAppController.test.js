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
