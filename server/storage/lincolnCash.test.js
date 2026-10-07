import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildLincolnCashLedger } from '../../shared/lincolnCash.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lincoln-cash-test-'));
process.env.LINCOLN_STATE_FILE = path.join(directory, 'lincoln.json');
process.env.APP_STATE_FILE = path.join(directory, 'app.json');
const store = await import('./lincolnStateStore.js');
const actor = { id: 'cashier', name: 'Responsable' };
const revision = async () => (await store.getLincolnStateSnapshot()).revision;
const funds = async (amountBs, date = '2026-10-01', method = 'cash', destination = 'CAJA CHICA') => store.registerLincolnCashFunds({ amountBs, date, method, destination, payerName: 'Dueña', description: 'Fondo inicial' }, await revision(), actor);
after(() => fs.rm(directory, { recursive: true, force: true }));
beforeEach(async () => {
  const saved = await store.getLincolnStateSnapshot();
  await store.replaceLincolnStateSnapshot({ ...saved.state, events: [{ id: 'event', code: 'EVE-TEST', clientName: 'Cliente', totalBs: 10000 }], payments: [], receipts: [], incomeEntries: [], expenseEntries: [], economicLedgerEntries: [], cashRenditions: [], auditLog: [] }, saved.revision);
});

test('range includes previous-year funds, separates pockets and excludes future and voided money', () => {
  const state = { incomeEntries: [
    { id: 'old', amountBs: 5000, date: '2025-10-12', method: 'cash' },
    { id: 'digital', amountBs: 1000, date: '2026-10-01', method: 'qr' },
    { id: 'event', eventId: 'event', amountBs: 2000, date: '2026-10-07', method: 'cash' },
    { id: 'future', amountBs: 9000, date: '2026-11-01', method: 'cash' },
    { id: 'void', amountBs: 9000, date: '2026-10-07', voidedAt: 'now' },
  ], expenseEntries: [{ id: 'expense', amountBs: 500, date: '2026-10-07', method: 'cash' }] };
  const result = buildLincolnCashLedger(state, { from: '2026-10-01', to: '2026-10-07' });
  assert.deepEqual(result.opening, { cashBs: 5000, digitalBs: 0 });
  assert.deepEqual(result.closing, { cashBs: 6500, digitalBs: 1000 });
  assert.equal(result.incomeBs, 3000); assert.equal(result.expenseBs, 500); assert.equal(result.rows.length, 3);
  const filtered = buildLincolnCashLedger(state, { from: '2026-10-07', to: '2026-10-07', eventId: 'event', query: '' });
  assert.deepEqual(filtered.closing, result.closing);
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].incomeBs, 2000);
});

test('funds and operating expenses generate documents without creating contract payments', async () => {
  const created = await funds(1000);
  assert.equal(created.receipt.cashEntryId, created.entry.id);
  assert.equal(created.receipt.direction, 'income');
  const expense = await store.createLincolnExpense({ amountBs: 100, date: '2026-10-02', description: 'Compra', supplierName: 'Proveedor' }, await revision(), actor);
  assert.equal(expense.receipt.direction, 'expense');
  await store.updateLincolnExpense(expense.expense.id, { amountBs: 150, date: '2026-10-03', description: 'Compra corregida' }, await revision(), actor);
  const { state } = await store.getLincolnStateSnapshot();
  assert.equal(state.payments.length, 0);
  assert.equal(state.receipts.find(row => row.id === expense.receipt.id).amountBs, 150);
  assert.equal(buildLincolnCashLedger(state).closing.cashBs, 850);
});

test('accounting marks selected entries, preserves an immutable snapshot and does not withdraw funds', async () => {
  await funds(1000);
  const payment = await store.registerLincolnEventPayment('event', { type: 'advance', amountBs: 500, date: '2026-10-02' }, await revision(), actor);
  const { state } = await store.getLincolnStateSnapshot();
  const keys = buildLincolnCashLedger(state).rows.map(row => row.key);
  const result = await store.registerLincolnCashRendition({ mode: 'accounting', date: '2026-10-03', destination: 'CAJA CHICA', recipientName: 'Dueña', movementKeys: keys }, await revision(), actor);
  assert.equal(result.rendition.incomeBs, 1500);
  assert.equal(result.rendition.deliveredCashBs, 0);
  const saved = await store.getLincolnStateSnapshot();
  assert.equal(buildLincolnCashLedger(saved.state).closing.cashBs, 1500);
  assert.equal(buildLincolnCashLedger(saved.state, { status: 'pending' }).rows.length, 0);
  assert.ok(saved.state.receipts.every(row => row.cashRenditionId === result.rendition.id));
  await assert.rejects(store.updateLincolnEconomicMovement(payment.ledgerEntry.id, { amountBs: 100 }, saved.revision), /ya fue rendido/);
  await assert.rejects(store.deleteLincolnEconomicMovement(payment.ledgerEntry.id, {}, saved.revision), /ya fue rendido/);
  await assert.rejects(store.deleteLincolnContract('event', {}, saved.revision), /ya fue rendido/);
  await assert.rejects(store.resetLincolnEventEconomics('event', {}, saved.revision, { role: 'developer' }), /ya fue rendido/);
  await assert.rejects(store.registerLincolnCashRendition({ mode: 'accounting', recipientName: 'Dueña', date: '2026-10-03', movementKeys: keys }, saved.revision), /ya fue rendido/);
  assert.equal((await store.getLincolnStateSnapshot()).revision, saved.revision);
});

test('delivery withdraws cash and digital once, generates expense receipts and leaves event balances intact', async () => {
  await funds(5000); await funds(1000, '2026-10-01', 'qr');
  await store.registerLincolnEventPayment('event', { type: 'advance', amountBs: 500, date: '2026-10-02' }, await revision(), actor);
  const before = await store.getLincolnStateSnapshot();
  const result = await store.registerLincolnCashRendition({ mode: 'delivery', date: '2026-10-03', destination: 'CAJA CHICA', recipientName: 'Dueña', cashBs: 2000, digitalBs: 500, movementKeys: buildLincolnCashLedger(before.state).rows.map(row => row.key) }, before.revision, actor);
  const saved = await store.getLincolnStateSnapshot();
  assert.deepEqual(buildLincolnCashLedger(saved.state).closing, { cashBs: 3500, digitalBs: 500 });
  assert.equal(result.rendition.receipts.length, 2);
  assert.equal(saved.state.expenseEntries.length, 2);
  assert.ok(saved.state.expenseEntries.every(row => row.cashRenditionId && row.receiptId));
  assert.deepEqual(saved.state.events[0].financial, before.state.events[0].financial);
  await assert.rejects(store.updateLincolnExpense(saved.state.expenseEntries[0].id, { amountBs: 100 }, saved.revision), /ya fue rendido/);
  // The remaining fund can be delivered later without re-rendering old movements.
  await store.registerLincolnCashRendition({ mode: 'delivery', date: '2026-10-04', recipientName: 'Dueña', cashBs: 500, movementKeys: [] }, saved.revision, actor);
  assert.equal(buildLincolnCashLedger((await store.getLincolnStateSnapshot()).state).closing.cashBs, 3000);
});

test('oversized, cross-destination, invalid-date and premature renditions reject atomically', async () => {
  await funds(1000, '2026-10-01'); await funds(500, '2026-10-02', 'qr', 'BANCO');
  const before = await store.getLincolnStateSnapshot();
  const rows = buildLincolnCashLedger(before.state).rows;
  const base = { mode: 'delivery', recipientName: 'Dueña', destination: 'CAJA CHICA', date: '2026-10-03', cashBs: 2000, movementKeys: [] };
  await assert.rejects(store.registerLincolnCashRendition(base, before.revision), /supera el fondo/);
  await assert.rejects(store.registerLincolnCashRendition({ ...base, cashBs: 100, movementKeys: rows.map(row => row.key) }, before.revision), /misma caja/);
  await assert.rejects(store.registerLincolnCashRendition({ ...base, cashBs: 100, date: '2026-02-30' }, before.revision), /Fecha/);
  await assert.rejects(store.registerLincolnCashRendition({ ...base, cashBs: 100, date: '2026-09-30', movementKeys: [rows[0].key] }, before.revision), /posterior/);
  await assert.rejects(store.registerLincolnCashFunds({ amountBs: 1, date: 'invalid', payerName: 'Dueña', description: 'Fondo' }, before.revision), /Fecha/);
  assert.equal((await store.getLincolnStateSnapshot()).revision, before.revision);
});
