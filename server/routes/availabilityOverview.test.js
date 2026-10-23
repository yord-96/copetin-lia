import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { buildDraftAvailabilityPeriod, getProjectedInventoryAvailability } from '../../src/utils/availability.js';

test('HTTP availability summary preserves outstanding internal quantities after partial returns', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-availability-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'availability-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot } = await import('../storage/fileStateStore.js');
  const rental = {
    id: 'r1995', contractCode: '1995', status: 'active', eventDate: '2026-10-17', dueDate: '2026-10-18',
    items: [{ itemId: 'plate', lineKey: 'p', quantity: 302, internalReservedQty: 237, supplierBackedQty: 65 },
      { itemId: 'fork', lineKey: 'f', quantity: 100 }],
    partialReturnReport: { items: [{ lineKey: 'p', returnedQty: 302, returnedToAvailableQty: 237 },
      { lineKey: 'f', returnedQty: 44, returnedToAvailableQty: 44, pendingClientQty: 56 }] },
  };
  await replaceStateSnapshot({ settings: {}, items: [{ id: 'plate', name: 'Plate', totalStock: 237, availableStock: 237 },
    { id: 'fork', name: 'Fork', totalStock: 100, availableStock: 44 }], rentals: [rental], contracts: [], quotes: [] }, null);
  const app = express(); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/__copetin_db/availability/overview`, { headers: { 'X-App-Internal-Key': 'availability-test' } });
    assert.equal(response.status, 200);
    const { overview } = await response.json();
    assert.equal(overview.rentals[0].items[0].internalReservedQty, 0);
    assert.equal(overview.rentals[0].items[1].internalReservedQty, 56);
    const result = getProjectedInventoryAvailability({ ...overview, period: buildDraftAvailabilityPeriod({ eventDate: '2026-10-17', pickupDate: '2026-10-18' }) });
    assert.equal(result.get('plate').projectedAvailable, 237);
    assert.equal(result.get('fork').projectedAvailable, 44);
    assert.equal(result.get('plate').hardReservedQtyRecords.length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
