import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('editing product and combo images uses small requests despite old revision and large unrelated data', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-edit-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'test-inventory';
  const { default: router } = await import('./inventoryEdits.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  const originalDate = '2026-11-27T10:00:00Z';
  const attachment = 'data:application/pdf;base64,' + 'A'.repeat(2_100_000);
  await replaceStateSnapshot({ settings: {}, categories: [{ id: 'cat', name: 'MANTELERIA' }],
    items: [{ id: 'item', name: 'MANTEL', category: 'MANTELERIA', totalStock: 28, availableStock: 8, controlsStock: true, rentalPriceBs: 10, updatedAt: originalDate }, { id: 'other', name: 'OTRO', totalStock: 2 }],
    inventoryCombos: [{ id: 'combo', name: 'COMBO', rentalPriceBs: 30, ingredients: [{ itemId: 'item', quantity: 2 }], updatedAt: originalDate }],
    clients: [{ id: 'client', attachments: [{ dataUrl: attachment }] }],
    contracts: [{ id: 'contract', totalBs: 500 }], cashMovements: [{ id: 'cash', amountBs: 100, cashRegisteredAt: null }], systemAuditLog: [],
  }, null);
  const before = await getStateSnapshot();
  const app = express(); app.use(express.json({ limit: '2kb' })); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const send = (kind, id, payload, key = 'test-inventory') => fetch(`http://127.0.0.1:${server.address().port}/__copetin_db/inventory/edit/${kind}/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Internal-Key': key }, body: JSON.stringify(payload),
  });
  try {
    const metadata = await fetch(`http://127.0.0.1:${server.address().port}/__copetin_db/inventory/edit/item/item`, { headers: { 'X-App-Internal-Key': 'test-inventory' } });
    assert.equal(metadata.status, 200);
    assert.deepEqual(await metadata.json(), { id: 'item', updatedAt: originalDate });
    assert.equal(metadata.headers.get('Cache-Control'), 'no-store');
    assert.equal((await send('item', 'item', {}, 'wrong')).status, 403);
    // The global revision can advance during the 30 minutes without invalidating this item.
    const response = await send('item', 'item', { expectedUpdatedAt: originalDate, imageUrl: '/uploads/products/item-new.webp', imageDataUrl: null });
    assert.equal(response.status, 200, await response.clone().text());
    const item = (await response.json()).record;
    assert.equal(item.imageUrl, '/uploads/products/item-new.webp');
    assert.equal(item.availableStock, 8); assert.equal(item.totalStock, 28);
    assert.equal((await send('item', 'item', { expectedUpdatedAt: originalDate, name: 'STALE' })).status, 409);
    const invalid = await send('item', 'item', { rentalPriceBs: -10 });
    assert.equal(invalid.status, 400);
    const comboResponse = await send('combo', 'combo', { expectedUpdatedAt: originalDate, imageUrl: '/uploads/products/combo-new.webp' });
    assert.equal(comboResponse.status, 200, await comboResponse.clone().text());
    const combo = (await comboResponse.json()).record;
    assert.deepEqual(combo.ingredients, before.state.inventoryCombos[0].ingredients);
    const after = await getStateSnapshot();
    assert.deepEqual(after.state.clients, before.state.clients);
    assert.deepEqual(after.state.contracts, before.state.contracts);
    assert.deepEqual(after.state.cashMovements, before.state.cashMovements);
    assert.deepEqual(after.state.items.find(row => row.id === 'other'), before.state.items.find(row => row.id === 'other'));
    assert.equal(after.state.items.find(row => row.id === 'item').rentalPriceBs, 10);
    assert.equal(after.state.items.find(row => row.id === 'item').name, 'MANTEL');
  } finally {
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), 'inventory-edit-')));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
