import test from 'node:test';
import assert from 'node:assert/strict';

import { isInventoryCatalogItemActive } from './inventoryCatalogVisibility.js';

test('excluye del catalogo de nuevos contratos los productos eliminados', () => {
  assert.equal(isInventoryCatalogItemActive({ id: 'activo', deletedAt: null }), true);
  assert.equal(isInventoryCatalogItemActive({ id: 'borrado', deletedAt: '2026-09-09T16:19:51.887Z' }), false);
  assert.equal(isInventoryCatalogItemActive({ id: 'legacy-borrado', status: 'deleted' }), false);
});
