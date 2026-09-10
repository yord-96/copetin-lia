import assert from 'node:assert/strict';
import test from 'node:test';

import { repriceSupplierFulfillmentPlanFromItems } from './webBridge.js';

test('no revive una cobertura retirada cuando la linea nueva usa el mismo producto', () => {
  const plan = [{
    id: 'coverage-old',
    lineKey: 'item-mantel-linea-vieja',
    itemId: 'item-mantel',
    itemName: 'MANTEL ARRUGADO / AMERICANO HUESITO',
    supplierId: 'supplier-copetin',
    supplierName: 'COPETIN',
    neededQty: 12,
    supplierUnitCostBs: 0,
    saleUnitPriceBs: 23,
    manualCoverage: false,
  }];
  const items = [{
    lineKey: 'item-mantel-linea-nueva',
    itemId: 'item-mantel',
    itemName: 'MANTEL ARRUGADO / AMERICANO HUESITO',
    quantity: 12,
    unitPriceBs: 23,
    discountPercent: 0,
  }];

  assert.deepEqual(repriceSupplierFulfillmentPlanFromItems(plan, items), []);
});

test('mantiene compatibilidad con una cobertura legacy sin lineKey', () => {
  const plan = [{
    id: 'coverage-legacy',
    lineKey: null,
    itemId: 'item-mantel',
    itemName: 'MANTEL ARRUGADO / AMERICANO HUESITO',
    supplierId: 'supplier-real',
    supplierName: 'PROVEEDOR REAL',
    neededQty: 4,
    supplierUnitCostBs: 10,
    saleUnitPriceBs: 23,
    manualCoverage: false,
  }];
  const items = [{
    lineKey: 'item-mantel-linea-actual',
    itemId: 'item-mantel',
    itemName: 'MANTEL ARRUGADO / AMERICANO HUESITO',
    quantity: 12,
    unitPriceBs: 23,
    discountPercent: 0,
  }];

  const result = repriceSupplierFulfillmentPlanFromItems(plan, items);
  assert.equal(result.length, 1);
  assert.equal(result[0].lineKey, 'item-mantel-linea-actual');
  assert.equal(result[0].neededQty, 4);
});
