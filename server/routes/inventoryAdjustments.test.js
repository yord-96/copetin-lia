import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('adjustment history finds older adjustments beyond recent contract movements before applying the limit', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-adjustments-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'adjustments-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot } = await import('../storage/fileStateStore.js');
  const adjustment = { id: 'old-adjustment', itemId: 'i', itemName: 'PLAQUET', type: 'ajuste', reason: 'CONTEO FISICO', deltaUnits: 5,
    beforeTotalStock: 200, afterTotalStock: 205, beforeAvailableStock: 100, afterAvailableStock: 105,
    userName: 'Operador', createdAt: '2026-09-02T12:00:00Z' };
  const recent = Array.from({ length: 900 }, (_, index) => ({ id: `reservation-${index}`, itemId: 'i', type: 'reserva', deltaUnits: -1, createdAt: '2026-10-26T12:00:00Z' }));
  await replaceStateSnapshot({ settings: {}, items: [{ id: 'i', name: 'PLAQUET', totalStock: 205, availableStock: 105 }], inventoryMovements: [adjustment, ...recent], rentals: [], contracts: [] }, null);
  const app = express(); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__copetin_db/inventory/movements-history`;
  const read = async query => { const response = await fetch(base + query, { headers: { 'X-App-Internal-Key': 'adjustments-test' } }); assert.equal(response.status, 200); return response.json(); };
  try {
    const general = await read('?limit=650');
    assert.equal(general.rows.some(row => row.id === adjustment.id), false);
    const history = await read('?type=ajuste&limit=650');
    assert.equal(history.total, 1);
    assert.equal(history.rows[0].id, adjustment.id);
    assert.equal(history.rows[0].beforeTotalStock, 200);
    assert.equal(history.rows[0].afterTotalStock, 205);
    assert.equal((await read('?type=ajuste&query=PLAQUET&from=2026-09-01&to=2026-09-03&user=Operador')).total, 1);
    assert.equal((await read('?type=ajuste&from=2026-10-01')).total, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
