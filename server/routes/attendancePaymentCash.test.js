import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('payment cash endpoint restricts managers and returns only the selected worker without changing state', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-payment-cash-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json'); process.env.APP_INTERNAL_KEY = 'payment-cash-test';
  let server;
  try {
    const { default: router } = await import('./state.js');
    const { replaceStateSnapshot, getStateMeta } = await import('../storage/fileStateStore.js');
    await replaceStateSnapshot({ users: [{ id: 'manager', fullName: 'ARACELY SIERRA', status: 'active' }, { id: 'f', fullName: 'FLOR FERRUFINO' }, { id: 'other', fullName: 'OTRA PERSONA' }], cashMovements: [{ id: 'advance', cashBoxType: 'PETTY_CASH', amountBs: -100, category: 'anticipo_sueldos', responsible: 'FLOR FERRUFINO', createdAt: '2026-11-17T15:00:00Z' }] }, null);
    const revision = (await getStateMeta()).revision;
    const app = express(); app.use(router);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const call = async (actorId, personKey, key = 'payment-cash-test') => fetch(`http://127.0.0.1:${server.address().port}/__copetin_db/attendance/payment-cash?${new URLSearchParams({ actorId, personKey, dateFrom: '2026-11-01', dateTo: '2026-11-18' })}`, { headers: { 'X-App-Internal-Key': key } });
    assert.equal((await call('f', 'id:f')).status, 403);
    assert.equal((await call('manager', 'id:f', 'wrong')).status, 403);
    const response = await call('manager', 'id:f'); assert.equal(response.status, 200);
    assert.equal((await response.json()).advances, 100);
    assert.equal((await (await call('manager', 'id:other')).json()).advances, 0);
    assert.equal((await getStateMeta()).revision, revision);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
});
