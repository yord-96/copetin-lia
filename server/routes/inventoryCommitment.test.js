import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('stock movement and kardex use the same peak reservation across different event dates', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-commitment-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'commitment-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  await replaceStateSnapshot({ settings: {}, items: [{ id: 'i', name: 'VASO AMASADIÑO', totalStock: 20, availableStock: 20 }], inventoryMovements: [], contracts: [], rentals: [
    { id: 'a', status: 'active', rentalDate: '2099-11-13', dueDate: '2099-11-15', items: [{ itemId: 'i', quantity: 12 }] },
    { id: 'b', status: 'active', rentalDate: '2099-12-24', dueDate: '2099-12-27', items: [{ itemId: 'i', quantity: 12 }] },
  ] }, null);
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__copetin_db/inventory`;
  const headers = { 'X-App-Internal-Key': 'commitment-test', 'Content-Type': 'application/json' };
  const payload = { itemId: 'i', type: 'salida', quantity: 5, reason: 'Pérdida en lavandería', clientOperationId: 'loss' };
  const send = value => fetch(`${base}/movements`, { method: 'POST', headers, body: JSON.stringify(value) });
  try {
    const response = await send(payload); assert.equal(response.status, 200, await response.clone().text());
    const saved = await response.json();
    assert.equal(saved.item.totalStock, 15);
    assert.equal(saved.item.availableStock, 3);
    const kardex = await (await fetch(`${base}/products-kardex`, { headers })).json();
    assert.equal(kardex.rows[0].availableStock, 3);
    assert.equal(kardex.rows[0].committedStock, 12);
    assert.equal((await (await send(payload)).json()).item.totalStock, 15);
    assert.equal((await send({ ...payload, quantity: 4, clientOperationId: 'blocked' })).status, 400);
    assert.equal((await getStateSnapshot()).state.items[0].totalStock, 15);
    const correction = { editingMovementId: saved.movement.id, expectedMovementVersion: saved.movement.createdAt, quantity: 3, reason: 'Correccion de cantidad', clientOperationId: 'edit-loss' };
    const edited = await send(correction); assert.equal(edited.status, 200, await edited.clone().text());
    const corrected = await edited.json(); assert.equal(corrected.item.totalStock, 17); assert.equal(corrected.item.availableStock, 5);
    assert.equal(corrected.movement.editHistory[0].previous.deltaUnits, -5);
    assert.equal((await (await send(correction)).json()).item.totalStock, 17);
    const stale = await send({ ...correction, clientOperationId: 'stale-edit' }); assert.equal(stale.status, 409);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
});
