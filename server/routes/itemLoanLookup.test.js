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
  const { replaceStateSnapshot } = await import('../storage/fileStateStore.js');
  await replaceStateSnapshot({ settings: {}, items: [], itemLoans: [], clients: [
    { id: 'active', name: 'Jimena Illanes', phone: '70000000', nitCi: '123456', attachments: [{ dataUrl: 'private' }], prepaidBalanceBs: 500 },
    { id: 'fallback', name: 'Carlos', whatsapp: '71111111', customerCi: '654321' },
    { id: 'deleted', name: 'Eliminado', deletedAt: '2026-11-01' },
  ] }, null);
  const app = express(); app.use(router);
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
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
