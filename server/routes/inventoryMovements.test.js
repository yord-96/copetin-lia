import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { applyInventoryStockMovement } from '../../src/services/webBridge.js';

test('stock movements preserve outstanding reservations and reject invalid quantities', () => {
  const state = { items: [{ id: 'plate', totalStock: 100, availableStock: 70 }], inventoryMovements: [], rentals: [{
    id: 'r', status: 'active', items: [{ itemId: 'plate', lineKey: 'p', quantity: 40 }],
    partialReturnReport: { items: [{ lineKey: 'p', returnedToAvailableQty: 10 }] },
  }] };
  const payload = { itemId: 'plate', type: 'entrada', quantity: 50, reason: 'COMPRA' };
  applyInventoryStockMovement(state, payload);
  assert.equal(state.items[0].totalStock, 150);
  assert.equal(state.items[0].availableStock, 120);
  assert.throws(() => applyInventoryStockMovement(state, { ...payload, type: 'salida', quantity: 121 }), /suficiente/);
  assert.throws(() => applyInventoryStockMovement(state, { ...payload, quantity: 1.5 }), /entero/);
  assert.throws(() => applyInventoryStockMovement(state, { ...payload, type: 'ajuste', targetTotalStock: 20 }), /menor/);
  assert.equal(state.items[0].totalStock, 150);
  assert.equal(state.inventoryMovements.length, 1);
});

test('small stock operations persist purchases and kardex atomically without uploading the database', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-stock-movement-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'stock-movement-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  const deliveries = Array.from({ length: 1621 }, (_, index) => ({ id: `delivery-${index}`, note: 'keep'.repeat(400) }));
  await replaceStateSnapshot({ settings: {}, items: [{ id: 'plate', name: 'PLAQUET CUADRITO VINO', totalStock: 200, availableStock: 200 }],
    inventoryMovements: [], deliveries, rentals: [] }, null);
  const app = express(); app.use(express.json({ limit: '2kb' })); app.use(router);
  app.use((error, req, res, next) => { void next; res.status(error.statusCode || 500).json({ error: error.message }); });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__copetin_db`;
  const headers = { 'X-App-Internal-Key': 'stock-movement-test', 'Content-Type': 'application/json' };
  const send = payload => fetch(`${base}/inventory/movements`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const get = async url => { const response = await fetch(base + url, { headers }); assert.equal(response.status, 200); return response.json(); };
  const purchase = { itemId: 'plate', type: 'entrada', quantity: 350, purchaseDate: '2026-09-02', purchaseCostBs: 1750, reason: 'COMPRA EL 02/09/2026 DE DIA CRUZ MELISA', userName: 'Inventario', clientOperationId: 'purchase-1' };
  try {
    const responses = await Promise.all([send(purchase), send(purchase)]);
    for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
    const [first, retry] = await Promise.all(responses.map(response => response.json()));
    assert.equal(first.movement.id, retry.movement.id, 'concurrent retry cannot duplicate stock');
    assert.equal(first.item.totalStock, 550);
    assert.equal(first.item.availableStock, 550);
    assert.equal(first.movement.beforeTotalStock, 200);
    assert.equal(first.movement.afterTotalStock, 550);
    assert.equal(first.movement.reason, purchase.reason);
    assert.equal(first.movement.purchaseDate, '2026-09-02');
    assert.equal(first.movement.purchaseCostBs, 1750);
    assert.equal(first.movement.valueAmount, 1750);
    assert.equal(first.movement.operationDate, '2026-09-02T12:00:00-04:00');
    assert.ok(Number.isFinite(Date.parse(first.movement.createdAt)));
    assert.equal((await send({ ...purchase, quantity: 351 })).status, 409);
    assert.equal((await send({ ...purchase, purchaseCostBs: 1800 })).status, 409);
    assert.equal((await send({ ...purchase, clientOperationId: 'future', purchaseDate: '2999-01-01' })).status, 400);
    assert.equal((await send({ ...purchase, clientOperationId: 'invalid-cost', purchaseCostBs: -1 })).status, 400);
    assert.equal((await send({ ...purchase, clientOperationId: 'negative', quantity: -1 })).status, 400);
    assert.equal((await send({ ...purchase, clientOperationId: 'stale', type: 'ajuste', targetTotalStock: 201, expectedTotalStock: 200 })).status, 409);
    const removal = await send({ itemId: 'plate', type: 'salida', quantity: 15, reason: 'ROTURA EN ALMACEN', clientOperationId: 'loss-1' });
    assert.equal(removal.status, 200);
    const increases = await get('/inventory/products/plate/kardex?metric=increases');
    assert.equal(increases.movements.length, 1);
    assert.equal(increases.movements[0].physicalDelta, 350);
    assert.equal(increases.movements[0].reason, purchase.reason);
    assert.equal(increases.movements[0].userName, 'Inventario');
    assert.equal(increases.movements[0].purchaseCostBs, 1750);
    const historical = await get('/inventory/movements-history?type=stock_adjustments&from=2026-09-02&to=2026-09-02');
    assert.equal(historical.total, 1);
    assert.equal(historical.rows[0].id, first.movement.id);
    assert.equal(historical.rows[0].purchaseCostBs, 1750);
    const decreases = await get('/inventory/products/plate/kardex?metric=decreases');
    assert.equal(decreases.movements.length, 1);
    assert.equal(decreases.movements[0].physicalDelta, -15);
    const { rows } = await get('/inventory/products-kardex');
    assert.equal(rows[0].initialStock, 200);
    assert.equal(rows[0].stockIn, 350);
    assert.equal(rows[0].stockOut, 15);
    assert.equal(rows[0].currentStock, 535);
    const snapshot = (await getStateSnapshot()).state;
    assert.deepEqual(snapshot.deliveries, deliveries);
    assert.equal(snapshot.inventoryMovements.length, 2);
    assert.deepEqual(snapshot.cashMovements ?? [], []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
