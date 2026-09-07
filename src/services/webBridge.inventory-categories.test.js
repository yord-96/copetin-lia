import assert from 'node:assert/strict';
import test from 'node:test';

import { getWebBridge } from './webBridge.js';

test('permite reutilizar y formaliza una categoria historica visible en productos', async () => {
  const bridge = getWebBridge();
  await bridge.__storage.replaceState({
    categories: [],
    items: [{
      id: 'item-historico',
      name: 'SERVILLETA HISTORICA',
      category: 'SERVILLETAS',
      totalStock: 10,
      availableStock: 10,
    }],
  });

  const created = await bridge.inventory.create({
    name: 'SERVILLETA NUEVA',
    category: 'servilletas',
    totalStock: 1,
    rentalPriceBs: 0,
    damagedUnitChargeBs: 0,
    missingUnitChargeBs: 0,
  });

  assert.equal(created.category, 'SERVILLETAS');
  assert.equal((await bridge.categories.list()).filter((row) => row.name === 'SERVILLETAS').length, 1);
});

test('continua rechazando una categoria que no esta registrada ni usada', async () => {
  const bridge = getWebBridge();
  await bridge.__storage.replaceState({ categories: [], items: [] });

  await assert.rejects(
    bridge.inventory.create({
      name: 'PRODUCTO SIN CATEGORIA REAL',
      category: 'INVENTADA',
      totalStock: 1,
      rentalPriceBs: 0,
      damagedUnitChargeBs: 0,
      missingUnitChargeBs: 0,
    }),
    /La categoria seleccionada no existe/,
  );
});
