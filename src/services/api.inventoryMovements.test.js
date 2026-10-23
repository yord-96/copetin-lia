import test from 'node:test';
import assert from 'node:assert/strict';

test('stock movement client posts only the operation and preserves its retry identifier', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const storage = new Map();
  globalThis.window = { location: { hostname: 'tucopetin.test', protocol: 'https:' }, localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  } };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/__copetin_db/inventory/movements', 'must never upload chunks or commit the whole database');
    assert.ok(options.body.length < 1024);
    const body = JSON.parse(options.body); calls.push(body);
    if (calls.length === 1) throw new Error('Interrupted response');
    return new Response(JSON.stringify({ item: { id: 'plate', totalStock: 550, availableStock: 550 },
      movement: { id: 'm1', itemId: 'plate', deltaUnits: 350, ...body }, revision: 'confirmed' }), { status: 200 });
  };
  try {
    const { api } = await import('./api.js');
    const { getWebBridge } = await import('./webBridge.js');
    await getWebBridge().__storage.applyServerState({ items: [{ id: 'plate', totalStock: 200 }], deliveries: [{ id: 'keep' }] }, { replace: true });
    const payload = { itemId: 'plate', type: 'entrada', quantity: 350, reason: 'COMPRA', clientOperationId: 'same-purchase' };
    await assert.rejects(api.inventory.createMovement(payload), /Interrupted response/);
    const result = await api.inventory.createMovement(payload);
    assert.equal(result.item.totalStock, 550);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].clientOperationId, calls[1].clientOperationId);
    assert.deepEqual(Object.keys(calls[1]).sort(), Object.keys(payload).sort());
    const local = await getWebBridge().__storage.exportCollections(['items', 'deliveries']);
    assert.equal(local.items[0].totalStock, 550);
    assert.equal(local.deliveries[0].id, 'keep');
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
});
