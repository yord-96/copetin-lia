import test from 'node:test';
import assert from 'node:assert/strict';
import { canReconstructHistoricalContracts } from './permissions.js';

test('sales and administrators can reconstruct history without granting access to other roles', () => {
  for (const role of ['ventas', 'admin', 'super_admin', 'developer']) {
    assert.equal(canReconstructHistoricalContracts({ role }), true, role);
  }
  for (const role of ['inventario', 'transporte', 'contabilidad', 'user']) {
    assert.equal(canReconstructHistoricalContracts({ role }), false, role);
  }
  assert.equal(canReconstructHistoricalContracts(null), false);
  assert.equal(canReconstructHistoricalContracts({ role: 'ventas', permissions: { ordersReadOnly: true } }), false);
});
