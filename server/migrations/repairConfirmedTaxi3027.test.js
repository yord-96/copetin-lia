import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getOrdersContractCashEconomicSummary } from '../services/ordersEconomicSummary.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-taxi-repair-'));
process.env.APP_STATE_FILE = path.join(directory, 'state.json');
const { repairConfirmedTaxi3027 } = await import('./repairConfirmedTaxi3027.js');
after(async () => { await fs.rm(directory, { recursive: true, force: true }); });

const fixture = () => {
 const cid = '837c76ae-318c-4bad-9830-a2e6f00dfb28', mid = 'mov-f1cc3989-7853-495f-8340-bf2ec4d1a605';
 return { settings: {}, contracts: [{ id: cid, rentalId: 'r', contractCode: '3027', services: [{ id: 'service-1792261076855', name: 'Transporte', lineTotalBs: 35 }], totals: { totalBs: 90, guaranteeBs: 195 }, economicLedger: [
  { id: 'initial', type: 'deposit', amountBs: 250, contractAllocationBs: 55, guaranteeAllocationBs: 195, cashMovementId: 'initial-cash', isCashRegistered: true },
  { id: 'reserve', type: 'guarantee', amountBs: 195, sourceDepositId: 'initial', reclassifiedFromPayment: true },
  { id: 'refund', type: 'refund', amountBs: 195, cashMovementId: 'refund-cash', refundSource: 'guarantee' },
  { id: 'extra', type: 'extra', amountBs: 35, cashMovementId: mid, isCashRegistered: true },
  { id: 'eco-1794500090446-7e5103813be37', type: 'deposit', amountBs: 35, note: 'TAXI' },
 ] }], rentals: [{ id: 'r', payment: { paidAtRentalBs: 55, pendingPaymentBs: 35 }, totals: { totalBs: 90 }, status: 'returned', refundBs: 195, returnSettlement: { paidBs: 55, pendingCollectionBs: 35, outstandingRentalBs: 35 } }], cashMovements: [
  { id: 'initial-cash', linkedContractId: cid, cashBoxType: 'BIG_CASH', type: 'cobro_saldo_devolucion', amountBs: 250, contractAllocationBs: 55, guaranteeAllocationBs: 195, accountingTag: 'contract_deposit_receipt', receiptCode: 'RC-14277' },
  { id: 'refund-cash', linkedContractId: cid, cashBoxType: 'BIG_CASH', type: 'egreso_manual', amountBs: -195, accountingTag: 'guarantee_refund', receiptCode: 'RC-1813' },
  { id: mid, linkedContractId: cid, linkedRentalId: 'r', cashBoxType: 'BIG_CASH', type: 'ingreso_manual', amountBs: 35, accountingTag: 'contract_extra_collection', category: 'cobro_extra_contrato', receiptCode: 'RC-510' },
 ] };
};
test('confirmed 3027 repair retains all cash and refund amounts, corrects the ledger and balance, and is idempotent', () => {
 const state = fixture(); const cash = state.cashMovements.map(row => [row.id, row.amountBs, row.receiptCode]);
 assert.equal(repairConfirmedTaxi3027(state), true);
 assert.deepEqual(state.cashMovements.map(row => [row.id, row.amountBs, row.receiptCode]), cash);
 assert.equal(getOrdersContractCashEconomicSummary(state.contracts[0], state.cashMovements).contractPaidBs, 90);
 assert.equal(state.rentals[0].payment.pendingPaymentBs, 0); assert.equal(state.rentals[0].refundBs, 195);
 assert.equal(state.contracts[0].economicLedger.filter(row => !row.deletedAt).length, 4);
 const corrected = structuredClone(state); assert.equal(repairConfirmedTaxi3027(state), false); assert.deepEqual(state, corrected);
 const other = fixture(); other.cashMovements[2].id = 'another-extra'; assert.equal(repairConfirmedTaxi3027(other), false);
 const voided = fixture(); voided.cashMovements[2].voidedAt = '2026-11-12'; assert.equal(repairConfirmedTaxi3027(voided), false);
});
test('startup repair writes a backup before changing the confirmed service and does not repeat on restart', async () => {
 const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
 const { runConfirmedTaxi3027Repair } = await import('./repairConfirmedTaxi3027.js');
 try {
  await replaceStateSnapshot(fixture(), null);
  await runConfirmedTaxi3027Repair();
  const saved = await getStateSnapshot(); assert.equal(saved.state.rentals[0].payment.pendingPaymentBs, 0);
  const files = await fs.readdir(path.join(directory, 'backups')); assert.equal(files.length, 1);
  const backup = JSON.parse(await fs.readFile(path.join(directory, 'backups', files[0]), 'utf8'));
  assert.equal(backup.state.rentals[0].payment.pendingPaymentBs, 35);
  await runConfirmedTaxi3027Repair(); assert.equal((await getStateSnapshot()).revision, saved.revision);
 } finally { /* shared temporary store is removed by the suite hook */ }
});
