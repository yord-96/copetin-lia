import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { reconcileContractDocumentPayments } from '../../src/utils/contractDocumentPayments.js';

test('3406: standalone guarantee receipt adds Bs 150 to cash without paying the rental twice; retry is idempotent', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-guarantee-receipt-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'guarantee-receipt-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  const ledger = [
    { id: 'd1', type: 'deposit', amountBs: 50, contractAllocationBs: 50, cashMovementId: 'cash1', isCashRegistered: true },
    { id: 'd2', type: 'deposit', amountBs: 62.5, contractAllocationBs: 62.5, cashMovementId: 'cash2', isCashRegistered: true },
    { id: 'g', type: 'guarantee', amountBs: 150, paymentMethod: 'qr', paymentAccount: 'BANCO FIE', createdAt: '2026-11-06T20:18:00Z', note: 'Apartado de garantía' },
  ];
  await replaceStateSnapshot({ settings: {}, contracts: [{ id: 'c', rentalId: 'r', contractCode: '3406', customerName: 'CLIENTE', totals: { totalBs: 112.5, guaranteeBs: 150 }, economicLedger: ledger }],
    rentals: [{ id: 'r', contractId: 'c', totals: { totalBs: 112.5 }, payment: { paidAtRentalBs: 112.5, pendingPaymentBs: 0 } }],
    cashMovements: [{ id: 'cash1', linkedContractId: 'c', type: 'ingreso_alquiler', amountBs: 50, contractAllocationBs: 50, cashBoxType: 'BIG_CASH' }, { id: 'cash2', linkedContractId: 'c', type: 'ingreso_alquiler', amountBs: 62.5, contractAllocationBs: 62.5, cashBoxType: 'BIG_CASH' }],
  }, null);
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__copetin_db`;
  const headers = { 'X-App-Internal-Key': 'guarantee-receipt-test', 'Content-Type': 'application/json' };
  const payload = { clientOperationId: 'contract-guarantee:c:g', type: 'ingreso', amountBs: 150, receivedAmountBs: 150,
    description: 'Garantía contrato 3406', linkedContractId: 'c', linkedRentalId: 'r', cashBoxType: 'BIG_CASH',
    category: 'garantia', accountingTag: 'guarantee_collection', contractAllocationBs: 0, guaranteeAllocationBs: 150,
    collectionTarget: 'guarantee', paymentMethod: 'qr', paymentAccount: 'BANCO FIE', createdAt: ledger[2].createdAt, receiptIssuedAt: ledger[2].createdAt };
  const send = () => fetch(`${base}/cash/manual-economic-movement`, { method: 'POST', headers, body: JSON.stringify(payload) });
  try {
    const response = await send(); assert.equal(response.status, 200);
    const { movement } = await response.json();
    assert.ok(movement.receiptCode);
    assert.equal(movement.guaranteeAllocationBs, 150);
    assert.equal(movement.contractAllocationBs, 0);
    assert.equal(movement.paymentAccount, 'BANCO FIE');
    assert.equal(movement.receiptIssuedAt, new Date(ledger[2].createdAt).toISOString());
    const saved = await fetch(`${base}/contracts/c/economic-ledger`, { method: 'PUT', headers, body: JSON.stringify({ mutations: [{ type: 'upsert', entry: { ...ledger[2], cashMovementId: movement.id, cashReceiptCode: movement.receiptCode, isCashRegistered: true, guaranteeAllocationBs: 150, contractAllocationBs: 0 } }] }) });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal((await (await send()).json()).movement.id, movement.id);
    const { state } = await getStateSnapshot();
    assert.equal(state.cashMovements.length, 3);
    assert.equal(state.cashMovements.reduce((sum, row) => sum + row.amountBs, 0), 262.5);
    assert.equal(state.rentals[0].payment.paidAtRentalBs, 112.5);
    assert.equal(state.contracts[0].economicLedger.filter(row => row.type === 'guarantee').length, 1);
    assert.equal(reconcileContractDocumentPayments(state.contracts[0], state.rentals[0], state.cashMovements).appliedBs, 112.5);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
});
