import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('consecutive contract collection POSTs do not share cached JSON or gzip across selections', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-collection-cache-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'collection-cache-test';
  let server;
  try {
    const { default: router } = await import('./state.js');
    const { replaceStateSnapshot, getStateMeta } = await import('../storage/fileStateStore.js');
    const receipts = ['RC-14678', 'RC-14679', 'RC-14680', 'RC-14681', 'RC-14682'];
    await replaceStateSnapshot({ settings: {}, cashMovements: receipts.map((receiptCode, index) => ({
      id: `payment-${index}`, receiptCode, amountBs: 20 + index, linkedContractId: 'contract-3026',
      linkedRentalId: 'rental-3026', cashBoxType: 'BIG_CASH', description: 'Receipt detail '.repeat(30),
      createdAt: '2026-11-10T20:30:00Z',
    })) }, null);
    const revision = (await getStateMeta()).revision;
    const app = express(); app.use(express.json()); app.use(router);
    app.use((error, req, res, next) => { void next; res.status(error.statusCode || 500).json({ error: error.message }); });
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const query = async (codes, encoding) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/__copetin_db/accounting/contract-collections`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Internal-Key': 'collection-cache-test', 'Accept-Encoding': encoding },
        body: JSON.stringify({ references: codes.map(code => ({ key: `rental-${code}`, contractIds: [`contract-${code}`], rentalIds: [`rental-${code}`] })) }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.groups.map(group => group.key), codes.map(code => `rental-${code}`));
      return body.groups;
    };
    for (const encoding of ['identity', 'gzip']) {
      assert.equal((await query(['unpaid'], encoding))[0].movements.length, 0);
      assert.deepEqual((await query(['3026'], encoding))[0].movements.map(movement => movement.receiptCode), receipts);
      assert.equal((await query(['other'], encoding))[0].movements.length, 0);
      const batch = await query(['other', '3026'], encoding);
      assert.equal(batch[0].movements.length, 0);
      assert.equal(batch[1].movements.length, 5);
    }
    assert.equal((await getStateMeta()).revision, revision, 'history queries must not change stored data');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
