import test from 'node:test';
import assert from 'node:assert/strict';

test('client update sends only the customer edit and merges the confirmed name locally', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const storage = new Map();
  globalThis.window = { location: { hostname: 'tucopetin.test', protocol: 'https:' }, localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  } };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/__copetin_db/clients/client/update', 'no full-state commit or chunk upload');
    assert.ok(options.body.length < 1024);
    calls.push(JSON.parse(options.body));
    if (calls.length === 1) throw new Error('Interrupted response');
    return new Response(JSON.stringify({ client: { id: 'client', name: 'Corrected', phone: '70000000', updatedAt: 'v2' }, movements: [], revision: 'confirmed' }), { status: 200 });
  };
  try {
    const { api } = await import('./api.js');
    const { getWebBridge } = await import('./webBridge.js');
    await getWebBridge().__storage.applyServerState({ clients: [{ id: 'client', name: 'Original', ordersCount: 5 }], deliveries: [{ id: 'keep' }] }, { replace: true });
    const payload = { id: 'client', name: 'Corrected', expectedUpdatedAt: 'v1', clientOperationId: 'same-edit' };
    await assert.rejects(api.clients.update(payload), /Interrupted response/);
    const result = await api.clients.update(payload);
    assert.equal(result.client.name, 'Corrected');
    assert.equal(calls[0].clientOperationId, calls[1].clientOperationId);
    const local = await getWebBridge().__storage.exportCollections(['clients', 'deliveries']);
    assert.equal(local.clients[0].name, 'Corrected');
    assert.equal(local.clients[0].ordersCount, 5);
    assert.equal(local.deliveries[0].id, 'keep');
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
});
