import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import express from 'express';

test('revision bootstrap keeps other requests responsive and preserves cash summaries and full records', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-bootstrap-responsive-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'bootstrap-test';
  let server;
  try {
    const { default: router } = await import('./state.js');
    const store = await import('../storage/fileStateStore.js');
    const contracts = Array.from({ length: 400 }, (_, index) => ({ id: `c-${index}`, contractCode: `C-${index}`,
      orderCode: `OS-${index}`, totals: { totalBs: 100, guaranteeBs: 20 },
      economicLedger: [{ id: `deposit-${index}`, type: 'deposit', amountBs: 120, guaranteeAllocationBs: 20,
        cashMovementId: `pay-${index}-0`, cashReceiptCode: `RC-${index}-0`, isCashRegistered: true }],
      notes: 'Original full contract', items: [{ itemId: 'item', quantity: 1, lineTotalBs: 100 }] }));
    const cashMovements = contracts.flatMap((contract, index) => Array.from({ length: 4 }, (_, part) => ({
      id: `pay-${index}-${part}`, type: 'ingreso_alquiler', cashBoxType: 'BIG_CASH', linkedContractId: contract.id,
      amountBs: part === 0 ? 120 : 1, contractAllocationBs: part === 0 ? 100 : 1,
      guaranteeAllocationBs: part === 0 ? 20 : 0, receiptCode: `RC-${index}-${part}`,
      createdAt: '2026-11-24T12:00:00Z',
    })));
    await store.replaceStateSnapshot({ contracts, cashMovements, settings: {}, rentals: [], items: [] }, null);
    const revision = (await store.getStateMeta()).revision;
    const app = express(); app.use(router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const options = { headers: { 'X-App-Internal-Key': 'bootstrap-test' } };
    const start = performance.now();
    const bootstrap = fetch(base + '/__copetin_db?bootstrap=1', options).then(response => response.json());
    await new Promise(resolve => setTimeout(resolve, 20));
    const meta = await (await fetch(base + '/__copetin_db?meta=1', options)).json();
    assert.ok(performance.now() - start < 2000, 'bootstrap must not monopolize the server for seconds');
    assert.equal(meta.revision, revision);
    const payload = await bootstrap;
    assert.equal(payload.state.contracts.length, contracts.length);
    assert.equal(payload.partial, true);
    for (const contract of payload.state.contracts) {
      assert.equal(contract.economicCashSummary.contractPaidBs, 103);
      assert.equal(contract.economicCashSummary.guaranteePaidBs, 20);
      assert.equal(contract.economicCashSummary.totalReceivedBs, 123);
    }
    assert.equal((await store.getStateMeta()).revision, revision);
    assert.deepEqual((await store.getStateSnapshot()).state.contracts, contracts);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
