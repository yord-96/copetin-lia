import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('3026: return-balance receipt unlocks only the paid guarantee, atomically and without new income', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-refund-3026-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'refund-3026-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  const contract = { id: 'c3026', rentalId: 'r3026', contractCode: '3026', economicResetVersion: 1,
    totals: { totalBs: 2514.4, guaranteeBs: 582.6 }, economicLedger: [
      { id: 'first', type: 'deposit', amountBs: 2255, contractAllocationBs: 1672.4, guaranteeAllocationBs: 582.6, cashMovementId: 'cash-first', isCashRegistered: true },
      { id: 'reserve', type: 'guarantee', amountBs: 582.6, sourceDepositId: 'first', reclassifiedFromPayment: true },
      { id: 'second', type: 'deposit', amountBs: 285.6, isCashRegistered: false },
      { id: 'third', type: 'deposit', amountBs: 476.4, cashMovementId: 'cash-third', isCashRegistered: true },
      { id: 'fourth', type: 'deposit', amountBs: 80, cashMovementId: 'cash-fourth', isCashRegistered: true },
      { id: 'damage-paid', type: 'charge', amountBs: 20, cashCollectionTarget: 'damage', cashMovementId: 'damage', isCashRegistered: true },
    ] };
  const cash = [
    { id: 'cash-first', amountBs: 2255, contractAllocationBs: 1672.4, guaranteeAllocationBs: 582.6 },
    { id: 'cash-second', amountBs: 285.6, contractAllocationBs: 285.6, clientOperationId: 'contract-deposit:c3026:second' },
    { id: 'cash-third', amountBs: 476.4, contractAllocationBs: 476.4 },
    { id: 'cash-fourth', amountBs: 80, contractAllocationBs: 80 },
  ].map(row => ({ ...row, linkedContractId: 'c3026', linkedRentalId: 'r3026', cashBoxType: 'BIG_CASH', type: 'cobro_saldo_devolucion', collectionTarget: 'balance', accountingTag: 'contract_deposit_receipt' }));
  cash.push({ id: 'damage', linkedContractId: 'c3026', linkedRentalId: 'r3026', cashBoxType: 'BIG_CASH', type: 'ingreso_danos_faltantes', amountBs: 20, collectionTarget: 'damage', accountingTag: 'contract_damage_collection' });
  await replaceStateSnapshot({ settings: {}, contracts: [contract], rentals: [{ id: 'r3026', contractId: 'c3026', status: 'returned', totals: { totalBs: 2514.4 }, penaltiesBs: 20 }], cashMovements: cash }, null);
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const headers = { 'X-App-Internal-Key': 'refund-3026-test', 'Content-Type': 'application/json' };
  const body = { type: 'egreso', amountBs: 582.6, description: 'Devolucion garantia', accountingTag: 'guarantee_refund', linkedContractId: 'c3026', linkedRentalId: 'r3026', cashBoxType: 'BIG_CASH', paymentMethod: 'efectivo', clientOperationId: 'refund-3026' };
  const send = payload => fetch('http://127.0.0.1:' + server.address().port + '/__copetin_db/cash/manual-economic-movement', { method: 'POST', headers, body: JSON.stringify(payload) });
  try {
    for (const response of await Promise.all([send(body), send(body)])) {
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json(); assert.equal(result.movement.amountBs, -582.6);
      assert.equal(result.contract.economicLedger.filter(row => row.type === 'refund').length, 1);
    }
    const saved = (await getStateSnapshot()).state;
    assert.equal(saved.cashMovements.length, 6);
    assert.deepEqual(saved.cashMovements.filter(row => row.amountBs > 0).map(row => [row.id, row.amountBs]), cash.map(row => [row.id, row.amountBs]));
    assert.equal(saved.cashMovements.find(row => row.id === 'damage').amountBs, 20);
    assert.equal((await send({ ...body, clientOperationId: 'refund-again' })).status, 409);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
});
