import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { getOrdersContractCashEconomicSummary } from '../services/ordersEconomicSummary.js';

test('service/extra receipts and their ledger lines are atomic, do not steal receipts and cannot collect the same service twice', async () => {
 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-service-collection-'));
 process.env.APP_STATE_FILE = path.join(directory, 'state.json'); process.env.APP_INTERNAL_KEY = 'service-test';
 const { default: router } = await import('./state.js');
 const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
 const fixture = () => ({ settings: {}, contracts: [{ id: 'c', rentalId: 'r', contractCode: '3027', totals: { totalBs: 90, guaranteeBs: 195 }, services: [{ id: 'service', name: 'Transporte', lineTotalBs: 35 }], economicLedger: [
  { id: 'first', type: 'deposit', amountBs: 250, cashMovementId: 'first-cash', contractAllocationBs: 55, guaranteeAllocationBs: 195, isCashRegistered: true },
  { id: 'reserve', type: 'guarantee', amountBs: 195, sourceDepositId: 'first', reclassifiedFromPayment: true },
 ] }], rentals: [{ id: 'r', contractId: 'c', status: 'returned', totals: { totalBs: 90 }, payment: { paidAtRentalBs: 55, pendingPaymentBs: 35 }, returnSettlement: { paidBs: 55, outstandingRentalBs: 35, pendingCollectionBs: 35 } }], cashMovements: [{ id: 'first-cash', linkedContractId: 'c', linkedRentalId: 'r', type: 'cobro_saldo_devolucion', amountBs: 250, contractAllocationBs: 55, guaranteeAllocationBs: 195, accountingTag: 'contract_deposit_receipt', cashBoxType: 'BIG_CASH' }] });
 await replaceStateSnapshot(fixture(), null);
 const app = express(); app.use(express.json()); app.use(router);
 app.use((error, _req, res, next) => { void next; res.status(error.statusCode || 500).json({ error: error.message }); });
 const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
 const url = 'http://127.0.0.1:' + server.address().port + '/__copetin_db/cash/manual-economic-movement';
 const body = { type: 'ingreso', amountBs: 35, description: 'TAXI', notes: 'TAXI', accountingTag: 'contract_extra_collection', cashBoxType: 'BIG_CASH', linkedContractId: 'c', linkedRentalId: 'r', paymentMethod: 'efectivo', includedServiceId: 'service', clientOperationId: 'service-retry' };
 const send = payload => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Internal-Key': 'service-test' }, body: JSON.stringify(payload) });
 try {
  const bad = await send({ ...body, includedServiceId: 'another-contract-service', clientOperationId: 'bad' }); assert.equal(bad.status, 409);
  assert.equal((await getStateSnapshot()).state.cashMovements.length, 1);
  for (const response of await Promise.all([send(body), send(body)])) {
   assert.equal(response.status, 200, await response.clone().text()); const result = await response.json();
   assert.equal(result.movement.contractAllocationBs, 35); assert.equal(result.movement.collectionTarget, 'balance');
   assert.equal(result.contract.economicLedger.filter(row => row.cashMovementId === result.movement.id).length, 1);
   assert.equal(result.rental.payment.pendingPaymentBs, 0); assert.equal(result.rental.returnSettlement.pendingCollectionBs, 0);
  }
  const saved = (await getStateSnapshot()).state; assert.equal(saved.cashMovements.length, 2);
  assert.equal(getOrdersContractCashEconomicSummary(saved.contracts[0], saved.cashMovements).contractPaidBs, 90);
  assert.equal((await send({ ...body, clientOperationId: 'collect-again' })).status, 409);
  const extra = await send({ ...body, includedServiceId: '', clientOperationId: 'new-extra', amountBs: 10, description: 'Extra nuevo' }); assert.equal(extra.status, 200);
  const result = await extra.json(); assert.equal(result.contract.economicLedger.filter(row => row.type === 'extra').length, 1);
  assert.equal(result.movement.contractAllocationBs, 0);
  const after = (await getStateSnapshot()).state;
  assert.equal(getOrdersContractCashEconomicSummary(after.contracts[0], after.cashMovements).contractPaidBs, 90, 'a distinct extra does not become commercial credit');
  assert.equal(after.cashMovements.length, 3);
 } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
});
