import test from 'node:test';
import assert from 'node:assert/strict';
import { distributeComboUnits } from './comboDistribution.js';

test('reparte diez mesas en cinco pequeñas y cinco grandes', () => {
  assert.deepEqual(distributeComboUnits({ requiredUnits: 10, selectedIds: ['pequena', 'grande'] }), {
    pequena: 5,
    grande: 5,
  });
});

test('reparte las cuarenta sillas de diez combos en veinte y veinte', () => {
  assert.deepEqual(distributeComboUnits({ requiredUnits: 40, selectedIds: ['blanca', 'negra'] }), {
    blanca: 20,
    negra: 20,
  });
});

test('una cantidad manual redistribuye el resto sin cambiar el total requerido', () => {
  const result = distributeComboUnits({
    requiredUnits: 40,
    selectedIds: ['blanca', 'negra'],
    lockedId: 'blanca',
    lockedQuantity: 12,
  });
  assert.deepEqual(result, { blanca: 12, negra: 28 });
  assert.equal(Object.values(result).reduce((sum, quantity) => sum + quantity, 0), 40);
});

test('un único modelo conserva todas las unidades obligatorias del combo', () => {
  assert.deepEqual(distributeComboUnits({
    requiredUnits: 40,
    selectedIds: ['blanca'],
    lockedId: 'blanca',
    lockedQuantity: 20,
  }), { blanca: 40 });
});

