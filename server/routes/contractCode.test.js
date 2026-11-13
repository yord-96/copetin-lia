import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
test('contract code check reads full state, preserves it and includes hidden and cancelled contracts', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-code-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json'); process.env.APP_INTERNAL_KEY = 'code-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  await replaceStateSnapshot({ settings: {}, contracts: [{ id: 'one', contractCode: '003506', hidden: true, status: 'cancelled' }], rentals: [{ id: 'r', contractCode: '3507', status: 'active' }] }, null);
  const before = await getStateSnapshot();
  const app = express(); app.use(router); const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/__copetin_db/orders/contract-code`;
    const check = code => fetch(`${base}?${new URLSearchParams({ code })}`, { headers: { 'X-App-Internal-Key': 'code-test' } });
    assert.equal((await (await check('3506')).json()).exists, true);
    assert.equal((await (await check('3507')).json()).exists, true);
    const unused = await check('3508'); assert.equal(unused.headers.get('cache-control'), 'no-store'); assert.deepEqual(await unused.json(), { code: '3508', exists: false });
    assert.equal((await check('no-es-numero')).status, 400);
    assert.equal((await fetch(`${base}?code=3508`)).status, 401);
    assert.deepEqual(await getStateSnapshot(), before);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
});
