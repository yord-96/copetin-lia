import test from 'node:test';
import assert from 'node:assert/strict';

test('confirmed refund updates local contract, rental and cash with one small request', async () => {
  const originalWindow = globalThis.window, originalFetch = globalThis.fetch;
  const storage = new Map();
  globalThis.window = { location: { hostname: 'tucopetin.test', protocol: 'https:' }, localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  const movement = { id: 'refund', amountBs: -200, receiptCode: 'RC-14011' };
  const ledger = [{ id: 'refund-line', type: 'refund', amountBs: 200, cashMovementId: 'refund' }];
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    requests++; assert.equal(url, '/__copetin_db/cash/manual-economic-movement');
    assert.ok(options.body.length < 1024); assert.equal(JSON.parse(options.body).clientOperationId, 'same-refund');
    return new Response(JSON.stringify({ movement, contract: { id: 'c', economicLedger: ledger },
      rental: { id: 'r', refundBs: 200 }, revision: 'saved' }), { status: 200 });
  };
  try {
    const { api } = await import('./api.js'); const { getWebBridge } = await import('./webBridge.js');
    await getWebBridge().__storage.applyServerState({ contracts: [{ id: 'c', economicLedger: [] }],
      rentals: [{ id: 'r', refundBs: 0 }], cashMovements: [{ id: 'income', amountBs: 200 }] }, { replace: true });
    const result = await api.cash.createManualMovement({ linkedContractId: 'c', accountingTag: 'guarantee_refund',
      type: 'egreso', amountBs: 200, description: 'Devolucion', clientOperationId: 'same-refund' });
    const local = await getWebBridge().__storage.exportCollections(['contracts', 'rentals', 'cashMovements']);
    assert.equal(requests, 1); assert.deepEqual(result.contract.economicLedger, ledger);
    assert.deepEqual(local.contracts[0].economicLedger, ledger); assert.equal(local.rentals[0].refundBs, 200);
    assert.equal(local.cashMovements.length, 2); assert.equal(local.cashMovements.reduce((sum, row) => sum + row.amountBs, 0), 0);
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
});
