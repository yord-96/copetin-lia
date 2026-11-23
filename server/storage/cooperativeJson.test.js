import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { cloneState, serializeState, stringifyPayload } from './cooperativeJson.js';

test('chunked serialization preserves JSON and checksum, including Unicode and empty collections', async () => {
  const state = { settings: { name: 'El Copetín 🍸', optional: undefined }, items: [{ id: 'uno', price: 1.25 }, null], empty: [], unused: undefined };
  const chunks = [];
  for await (const chunk of serializeState(state)) chunks.push(chunk);
  assert.equal(chunks.join(''), JSON.stringify(state));
  assert.equal(crypto.createHash('sha256').update(chunks.join('')).digest('hex'), crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex'));
  const cloned = await cloneState(state);
  cloned.items[0].price = 99;
  assert.equal(state.items[0].price, 1.25);
  assert.equal(await stringifyPayload({ collections: state, updatedAt: new Date('2026-12-12') }), JSON.stringify({ collections: state, updatedAt: new Date('2026-12-12') }));
  const scoped = await cloneState(state, ['items']);
  assert.notEqual(scoped.items, state.items);
  assert.equal(scoped.settings, state.settings);
});

test('large snapshots yield to other requests and retain concurrent writes and rollback', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-responsive-state-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  const store = await import('./fileStateStore.js');
  try {
    const rows = Array.from({ length: 3000 }, (_, index) => ({ id: String(index), detail: 'x'.repeat(8192) }));
    await store.replaceStateSnapshot({ contracts: rows, settings: {}, items: [{ id: 'item', totalStock: 1 }] }, null);
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 1);
    try {
      await Promise.all([
        store.updateStateSnapshot(state => { state.items[0].totalStock++; return state; }),
        store.updateStateSnapshot(state => { state.settings.saved = true; return state; }),
      ]);
    } finally { clearInterval(timer); }
    assert.ok(ticks > 10, `other requests must run while saving (${ticks} ticks)`);
    const disk = JSON.parse(await fs.readFile(process.env.APP_STATE_FILE, 'utf8'));
    assert.equal(disk.state.items[0].totalStock, 2);
    assert.equal(disk.state.settings.saved, true);
    assert.equal(disk.state.contracts.length, 3000);
    assert.equal(disk.checksum, crypto.createHash('sha256').update(JSON.stringify(disk.state)).digest('hex').slice(0, 16));
    const revision = (await store.getStateMeta()).revision;
    await assert.rejects(store.updateStateSnapshot(state => { state.items[0].totalStock = 0; throw new Error('rollback'); }), /rollback/);
    assert.equal((await store.getStateSnapshot()).state.items[0].totalStock, 2);
    assert.equal((await store.getStateMeta()).revision, revision);
    await assert.rejects(store.updateStateSnapshot(state => state, 'outdated'), { code: 'STATE_REVISION_CONFLICT' });
    // A serialization failure after opening the temporary stream cannot publish
    // a partial snapshot or mutate the in-memory committed state.
    await assert.rejects(store.updateStateSnapshot(state => { state.settings.invalid = 1n; return state; }), /BigInt/);
    assert.equal((await store.getStateMeta()).revision, revision);
    assert.equal(JSON.parse(await fs.readFile(process.env.APP_STATE_FILE, 'utf8')).checksum, disk.checksum);

    process.env.APP_INTERNAL_KEY = 'responsive-test';
    const { default: router } = await import('../routes/state.js');
    const app = express(); app.use(express.json()); app.use(router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/__copetin_db/patch`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Internal-Key': 'responsive-test' },
        body: JSON.stringify({ revision, upserts: { items: [{ id: 'item', totalStock: 3 }] } }) });
      assert.equal(response.status, 200, await response.clone().text());
      const saved = await store.getStateSnapshot();
      assert.equal(saved.state.items[0].totalStock, 3);
      assert.deepEqual(saved.state.contracts, rows);
      assert.equal(saved.state.settings.saved, true);
    } finally { await new Promise(resolve => server.close(resolve)); }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
