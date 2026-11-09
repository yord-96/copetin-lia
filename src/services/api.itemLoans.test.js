import assert from 'node:assert/strict';
import test from 'node:test';

test('loan save uses only its direct endpoint, skips empty inventory patches and tolerates cache failure after confirmation', async () => {
  const originalFetch = globalThis.fetch;
  const { api } = await import('./api.js');
  const { getWebBridge } = await import('./webBridge.js');
  const storage = getWebBridge().__storage;
  const originalExport = storage.exportCollections;
  const calls = [];
  let cacheReads = 0;
  storage.exportCollections = async () => { cacheReads += 1; throw new Error('Local cache unavailable'); };
  const payload = { requestId: 'same-save', kind: 'legacy', personName: 'Persona', date: '2026-11-09', lines: [{ id: 'l', itemName: 'Material antiguo', quantity: 1 }] };
  let items = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/__copetin_db/inventory/item-loans/create', 'must not request bootstrap, metadata or other collections');
    assert.ok(options.signal instanceof AbortSignal);
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ loan: { id: 'loan', ...payload }, items, revision: '2:confirmed' }));
  };
  try {
    assert.equal((await api.inventory.itemLoans('create', payload)).loan.id, 'loan');
    assert.equal(cacheReads, 0, 'unlinked historical material must not load the inventory cache');
    items = [{ id: 'chair', totalStock: 20 }];
    assert.equal((await api.inventory.itemLoans('create', payload)).loan.id, 'loan', 'confirmed save must survive local cache failure');
    assert.equal(cacheReads, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].requestId, calls[1].requestId);
  } finally { globalThis.fetch = originalFetch; storage.exportCollections = originalExport; }
});

test('loan deadline covers response body and preserves the form operation identifier on retry', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimer = globalThis.setTimeout;
  const { api } = await import('./api.js');
  const payload = { requestId: 'retry-same-operation', kind: 'legacy' };
  const ids = [];
  globalThis.setTimeout = (callback, ms, ...args) => originalTimer(callback, ms === 20000 ? 5 : ms, ...args);
  globalThis.fetch = async (_url, options) => {
    ids.push(JSON.parse(options.body).requestId);
    return { ok: true, json: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) };
  };
  try {
    await assert.rejects(api.inventory.itemLoans('create', payload), /Tus datos siguen en el formulario/);
    await assert.rejects(api.inventory.itemLoans('create', payload), /misma operación/);
    assert.deepEqual(ids, ['retry-same-operation', 'retry-same-operation']);
  } finally { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimer; }
});
