import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('quote saves preserve deliveries, reject stale edits and deduplicate retried requests', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-quotes-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'quote-test-key';
  const { default: router } = await import('./contractTransactions.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  const deliveries = Array.from({ length: 1621 }, (_, i) => ({ id: `delivery-${i}`, status: 'delivered', note: 'Preserve original' }));
  const rentals = [{ id: 'rental-existing', items: [{ itemId: 'chair', quantity: 4 }] }];
  const inventory = [{ id: 'chair', name: 'SILLA', controlsStock: true, totalStock: 100, availableStock: 96, rentalPriceBs: 10 },
    ...Array.from({ length: 2082 }, (_, i) => ({ id: `item-${i}`, name: `ITEM ${i}`, totalStock: 20, availableStock: 20 }))];
  await replaceStateSnapshot({ deliveries, rentals, items: inventory, quotes: [], clients: [], settings: { numbering: { quotePrefix: 'COT', quoteNext: 1 } } }, null);
  const app = express(); app.use(express.json()); app.use(router);
  app.use((error, req, res, next) => { void next; res.status(error.statusCode || 400).json({ error: error.message }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/__copetin_db/quotes/`;
  const quote = { customerName: 'QA CLIENTE', customerPhone: '70000000', eventDate: '2026-10-22', eventTime: '08:00', address: 'FERIA', logisticsMode: 'recojo', guaranteeBs: 200, items: [{ itemId: 'chair', quantity: 2, unitPriceBs: 10 }] };
  const send = (action, payload, operationId, headers = { 'X-App-Internal-Key': 'quote-test-key' }) => fetch(url + action, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ quote: payload, operationId }) });
  try {
    assert.equal((await send('create', quote, 'operation-unauthorized', {})).status, 401);
    const createdResponses = await Promise.all([send('create', quote, 'operation-create-0001'), send('create', quote, 'operation-create-0001')]);
    assert.ok(createdResponses.every(response => response.status === 200));
    const [first, retry] = await Promise.all(createdResponses.map(response => response.json()));
    assert.equal(first.quote.id, retry.quote.id);
    const orderedRetry = Object.fromEntries(Object.entries(quote).reverse());
    assert.equal((await send('create', orderedRetry, 'operation-create-0001')).status, 200);
    assert.equal(first.quote.totals.totalBs, 20);
    assert.equal(first.quote.guarantee.amountBs, 200);
    assert.equal((await getStateSnapshot()).state.quotes.length, 1);
    assert.equal((await send('create', { ...quote, customerName: 'OTHER' }, 'operation-create-0001')).status, 409);
    let response = await send('update', { id: first.quote.id, address: 'NEW ADDRESS', expectedUpdatedAt: first.quote.updatedAt }, 'operation-update-0001');
    assert.equal(response.status, 200, await response.clone().text());
    const updated = (await response.json()).quote;
    assert.equal(updated.address, 'NEW ADDRESS');
    response = await send('update', { id: first.quote.id, address: 'NEW ADDRESS', expectedUpdatedAt: first.quote.updatedAt }, 'operation-update-0001');
    assert.equal(response.status, 200, 'retry with same operation must not fail version check');
    assert.equal((await send('update', { id: first.quote.id, address: 'STALE', expectedUpdatedAt: 'old-version' }, 'operation-stale-0001')).status, 409);
    response = await send('remove', { id: first.quote.id, expectedUpdatedAt: updated.updatedAt }, 'operation-remove-0001');
    assert.equal(response.status, 200, await response.clone().text());
    const after = (await getStateSnapshot()).state;
    assert.deepEqual(after.deliveries, deliveries);
    assert.deepEqual(after.rentals, rentals);
    assert.deepEqual(after.items, inventory);
    assert.ok(after.quotes[0].deletedAt);
    assert.equal((await send('create', { ...quote, items: [{ itemId: 'absent', quantity: 1 }] }, 'operation-invalid-001')).status, 400);
    assert.equal((await getStateSnapshot()).state.quotes.length, 1);
    // A new independent operation gets its own document and code.
    response = await send('create', quote, 'operation-create-0002');
    assert.equal(response.status, 200, await response.clone().text());
    assert.notEqual((await response.json()).quote.quoteCode, first.quote.quoteCode);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (directory.startsWith(path.join(os.tmpdir(), 'copetin-quotes-'))) await fs.rm(directory, { recursive: true, force: true });
  }
});
