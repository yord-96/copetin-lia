import test from 'node:test';
import assert from 'node:assert/strict';

test('cancellation client merges confirmed refund and stock without reuploading state or losing July income', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const storage = new Map();
  globalThis.window = { location: { hostname: 'tucopetin.test', protocol: 'https:' }, localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  } };
  const original = { id: 'july', amountBs: 2000, createdAt: '2026-07-21T19:06:00Z' };
  let posts = 0;
  globalThis.fetch = async (url, options) => {
    if (url.startsWith('/__copetin_db/contracts/cancellation/preview?')) return new Response(JSON.stringify({ availableBs: 2000, version: 'v1' }), { status: 200 });
    assert.equal(url, '/__copetin_db/contracts/cancel'); assert.ok(options.body.length < 1024); posts += 1;
    const body = JSON.parse(options.body); assert.equal(body.economicSettlement.refundBs, 1800);
    return new Response(JSON.stringify({ rental: { id: 'r', status: 'cancelled', cancellationSettlement: { refundBs: 1800, retainedPenaltyBs: 200 } },
      contract: { id: 'c', status: 'anulado', guarantee: { amountBs: 0 } }, cashMovements: [{ id: 'refund', amountBs: -1800 }],
      items: [{ id: 'i', totalStock: 100, availableStock: 100 }], deliveries: [], supplierLoans: [], inventoryMovements: [], revision: 'confirmed' }), { status: 200 });
  };
  try {
    const { api } = await import('./api.js'); const { getWebBridge } = await import('./webBridge.js');
    await getWebBridge().__storage.applyServerState({ contracts: [{ id: 'c', status: 'aprobado' }], rentals: [{ id: 'r', status: 'active' }],
      cashMovements: [original], items: [{ id: 'i', totalStock: 100, availableStock: 90 }] }, { replace: true });
    const preview = await api.rentals.getCancellationPreview({ contractId: 'c', id: 'r' }); assert.equal(preview.availableBs, 2000);
    const result = await api.rentals.cancel({ id: 'r', contractId: 'c', reason: 'Acuerdo', economicSettlement: { operationId: 'same-cancel', version: 'v1', refundBs: 1800, retainedPenaltyBs: 200 } });
    assert.equal(posts, 1); assert.equal(result.cancellationSettlement.retainedPenaltyBs, 200);
    assert.equal(result.__cancellationResult.cashMovements[0].amountBs, -1800);
    const local = await getWebBridge().__storage.exportCollections(['items', 'contracts', 'cashMovements']);
    assert.equal(local.items[0].availableStock, 100); assert.equal(local.contracts[0].status, 'anulado');
    assert.deepEqual(local.cashMovements.find(row => row.id === 'july'), original);
    assert.equal(local.cashMovements.reduce((sum, row) => sum + row.amountBs, 0), 200);
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
});
