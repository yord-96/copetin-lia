import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('loan lookup returns active clients with their contact fields and excludes attachments', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-loan-lookup-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'loan-lookup-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  await replaceStateSnapshot({ settings: {}, items: [], itemLoans: [], clients: [
    { id: 'active', name: 'Jimena Illanes', phone: '70000000', nitCi: '123456', attachments: [{ dataUrl: 'private' }], prepaidBalanceBs: 500 },
    { id: 'fallback', name: 'Carlos', whatsapp: '71111111', customerCi: '654321' },
    { id: 'deleted', name: 'Eliminado', deletedAt: '2026-11-01' },
  ] }, null);
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/__copetin_db/inventory/item-loans`, { headers: { 'X-App-Internal-Key': 'loan-lookup-test' } });
    assert.equal(response.status, 200);
    const { clients } = await response.json();
    assert.deepEqual(clients, [
      { id: 'active', name: 'Jimena Illanes', phone: '70000000', ci: '123456' },
      { id: 'fallback', name: 'Carlos', phone: '71111111', ci: '654321' },
    ]);
    await replaceStateSnapshot({ settings: {}, items: [{ id: 'cloth', name: 'MANTEL SATINADO / HUESO', totalStock: 68, availableStock: 0, controlsStock: true }], itemLoans: [], inventoryMovements: [], contracts: [], rentals: [{ id: 'rental', status: 'active', rentalDate: '2026-11-16', dueDate: '2026-11-20', operational: { inventoryStatus: 'salio' }, items: [{ itemId: 'cloth', quantity: 66 }] }] }, (await getStateSnapshot()).revision);
    const base = `http://127.0.0.1:${server.address().port}/__copetin_db/inventory`;
    const headers = { 'Content-Type': 'application/json', 'X-App-Internal-Key': 'loan-lookup-test' };
    const lookup = await (await fetch(`${base}/item-loans`, { headers })).json();
    const kardex = await (await fetch(`${base}/products-kardex`, { headers })).json();
    assert.equal(lookup.items[0].availableStock, 2);
    assert.equal(lookup.items[0].availableStock, kardex.rows[0].availableStock);
    const command = { requestId: 'new-loan', kind: 'new', personName: 'QA', date: '2026-11-16', lines: [{ id: 'line', itemId: 'cloth', quantity: 1 }] };
    const created = await fetch(`${base}/item-loans/create`, { method: 'POST', headers, body: JSON.stringify(command) });
    assert.equal(created.status, 200, await created.clone().text());
    const result = await created.json();
    assert.equal(result.items[0].availableStock, 1);
    const blocked = await fetch(`${base}/item-loans/create`, { method: 'POST', headers, body: JSON.stringify({ ...command, requestId: 'too-many', lines: [{ id: 'other', itemId: 'cloth', quantity: 2 }] }) });
    assert.equal(blocked.status, 409);
    assert.match((await blocked.json()).error, /Disponible: 1/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
