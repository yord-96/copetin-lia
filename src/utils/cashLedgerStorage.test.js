import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';

test('el almacenamiento conserva el orden de caja al editar y al reemplazar el estado', async () => {
  const filename = path.join(os.tmpdir(), `copetin-ledger-test-${crypto.randomUUID()}.json`);
  process.env.APP_STATE_FILE = filename;
  const { getStateSnapshot, updateStateSnapshot, replaceStateSnapshot } = await import('../../server/storage/fileStateStore.js');
  try {
    await fs.writeFile(filename, JSON.stringify({ version: 1, state: { cashMovements: [
      { id: 'fund', createdAt: '2026-10-01T19:46:00Z' },
      { id: 'payment', createdAt: '2026-10-01T04:27:40Z' },
    ] } }));
    const initial = await getStateSnapshot();
    assert.deepEqual(initial.state.cashMovements.map(row => row.cashLedgerSequence), [1, 2]);
    await updateStateSnapshot(state => {
      state.cashMovements.reverse();
      state.cashMovements[0].cashLedgerSequence = 999;
      state.cashMovements[0].receiptIssuedAt = '2020-01-01T00:00:00Z';
      state.cashMovements.push({ id: 'refund', cashLedgerSequence: 1, cashRegisteredAt: '2020-01-01' });
      return state;
    });
    const updated = await getStateSnapshot();
    assert.deepEqual(updated.state.cashMovements.map(row => row.cashLedgerSequence), [2, 1, 3]);
    const registeredAt = updated.state.cashMovements[2].cashRegisteredAt;
    assert.ok(new Date(registeredAt).getTime() >= Date.now() - 10000);
    await replaceStateSnapshot({ cashMovements: updated.state.cashMovements.map(row => ({ ...row,
      cashLedgerSequence: 999, cashRegisteredAt: '2020-01-01',
    })) }, updated.revision);
    const replaced = await getStateSnapshot();
    assert.deepEqual(replaced.state.cashMovements.map(row => row.cashLedgerSequence), [2, 1, 3]);
    assert.equal(replaced.state.cashMovements[2].cashRegisteredAt, registeredAt);
  } finally {
    await fs.rm(filename, { force: true });
  }
});
