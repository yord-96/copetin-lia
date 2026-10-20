import test from 'node:test';
import assert from 'node:assert/strict';

test('quote client sends only its document and reuses the operation after an interrupted response', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const storage = new Map();
  globalThis.window = { location: { hostname: 'tucopetin.test', protocol: 'https:' }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  const calls = [];
  let interrupt = true;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/__copetin_db/quotes/create', 'no bootstrap, full-state PUT or chunk upload is allowed');
    const body = JSON.parse(options.body);
    calls.push(body);
    assert.deepEqual(Object.keys(body).sort(), ['operationId', 'quote']);
    assert.ok(options.body.length < 1024);
    if (interrupt) { interrupt = false; throw new Error('Connection interrupted after commit'); }
    return new Response(JSON.stringify({ quote: { id: 'confirmed', quoteCode: 'COT-00109', updatedAt: '2026-10-20T14:00:00Z', ...body.quote }, revision: '2:confirmed' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { api } = await import('./api.js');
    const { getWebBridge } = await import('./webBridge.js');
    await getWebBridge().__storage.applyServerState({ quotes: [], items: [], clients: [], deliveries: [] }, { replace: true });
    const quote = { customerName: 'QA', customerPhone: '70000000', eventDate: '2026-10-22', items: [{ itemId: 'chair', quantity: 2 }] };
    await assert.rejects(api.quotes.create(quote), /Connection interrupted/);
    const first = api.quotes.create(quote);
    const duplicate = api.quotes.create({ ...quote });
    assert.equal(first, duplicate, 'double click shares one in-flight request');
    const saved = await first;
    assert.equal(saved.id, 'confirmed');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].operationId, calls[1].operationId);
    assert.equal((await getWebBridge().__storage.exportCollections(['quotes'])).quotes[0].id, 'confirmed');
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
});

test('conversion sends a quote reference and its version without fetching or uploading the database', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const storage = new Map();
  globalThis.window = { location: { hostname: 'tucopetin.test', protocol: 'https:' }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, '/__copetin_db/quotes/quote-id/convert');
    assert.deepEqual(JSON.parse(options.body), { trace: { userId: 'qa' }, quoteUpdatedAt: 'version' });
    return new Response(JSON.stringify({ contract: { id: 'c', rentalId: 'r' }, rental: { id: 'r' }, changes: {}, revision: '3:confirmed' }), { status: 200 });
  };
  try {
    const { api } = await import('./api.js');
    const result = await api.contracts.createAndApprove({ contract: { quoteId: 'quote-id', expectedQuoteUpdatedAt: 'version', items: [{ itemId: 'chair', quantity: 999 }], customerName: 'untrusted browser copy' }, trace: { userId: 'qa' } });
    assert.equal(result.contract.id, 'c'); assert.equal(calls, 1);
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
});
