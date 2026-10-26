import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { applyDamageRepairToOverview } from '../../src/utils/damageRepairOverview.js';

test('repair response updates the rendered damage overview exactly like a fresh server read', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-damage-repair-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'damage-repair-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot } = await import('../storage/fileStateStore.js');
  await replaceStateSnapshot({ settings: {}, items: [{ id: 'i', name: 'MANTEL', totalStock: 10, availableStock: 10 }], rentals: [{
    id: 'r', status: 'returned', returnedAt: '2026-10-20T12:00:00Z', returnReport: [{ itemId: 'i', itemName: 'MANTEL', damagedQty: 3, missingQty: 0, damageDiscardedToMissingQty: 1 }],
  }], inventoryMovements: [] }, null);
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__copetin_db/inventory`;
  const headers = { 'X-App-Internal-Key': 'damage-repair-test', 'Content-Type': 'application/json' };
  const overview = async () => (await fetch(`${base}/damage-loss-overview`, { headers })).json();
  try {
    let current = await overview();
    for (let count = 1; count <= 2; count += 1) {
      const response = await fetch(`${base}/damage-loss/reinsert`, { method: 'POST', headers, body: JSON.stringify({ rentalId: 'r', itemId: 'i', reportKind: 'final', reportIndex: 0, quantity: 1, userName: 'Operador', note: 'Reparado' }) });
      assert.equal(response.status, 200);
      const result = await response.json();
      current = applyDamageRepairToOverview(current, result);
      const fresh = await overview();
      assert.deepEqual(current.rows.filter(row => row.lossType === 'danado'), fresh.rows.filter(row => row.lossType === 'danado'));
      const row = current.rows.find(row => row.lossType === 'danado');
      assert.equal(row.repairedQty, count);
      assert.equal(row.repairableQuantity, 2 - count);
      assert.equal(row.repairedByName, 'Operador');
      assert.equal(result.item.totalStock, 10 + count);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
