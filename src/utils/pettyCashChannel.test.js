import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPettyCashChannel, matchesPettyCashChannel, pettyCashChannelBalance, assertPettyCashReplacement } from './pettyCashChannel.js';

test('legacy QR stays digital without copying money or touching Big Cash', () => {
  const rows = [
    { id: 'cash', cashBoxType: 'PETTY_CASH', paymentMethod: 'efectivo', amountBs: 200 },
    { id: 'fie', cashBoxType: 'PETTY_CASH', paymentMethod: 'qr', paymentAccount: 'BANCO FIE', amountBs: 500 },
    { id: 'cidre', cashBoxType: 'PETTY_CASH', paymentMethod: 'qr', paymentAccount: 'CIDRE', amountBs: 1000 },
    { id: 'big', cashBoxType: 'BIG_CASH', paymentMethod: 'efectivo', amountBs: 9000 },
  ];
  assert.equal(rows.filter(row => row.cashBoxType === 'PETTY_CASH' && matchesPettyCashChannel(row, 'digital')).length, 2);
  assert.equal(pettyCashChannelBalance(rows, 'efectivo'), 200);
  assert.equal(pettyCashChannelBalance(rows, 'qr', 'BANCO FIE'), 500);
  assert.throws(() => assertPettyCashChannel({ paymentMethod: 'qr', paymentAccount: 'UNKNOWN' }), /cuenta/);
  assert.throws(() => assertPettyCashChannel({ paymentMethod: 'efectivo' }, rows[1]), /trasladar/);
  const used = [...rows, { id: 'spent', cashBoxType: 'PETTY_CASH', paymentMethod: 'qr', paymentAccount: 'BANCO FIE', amountBs: -300 }];
  assert.throws(() => assertPettyCashReplacement(used, rows[1], { amountBs: 200 }), /fondos/);
  assert.throws(() => assertPettyCashReplacement(used, rows[1], { paymentMethod: 'qr', paymentAccount: 'CIDRE' }), /fondos/);
});

test('digital debts retain their box on reload and charge only the selected bank', async () => {
  const { getWebBridge } = await import('../services/webBridge.js');
  const bridge = getWebBridge();
  const state = await bridge.__storage.exportState();
  state.cashSessions = [{ id: 'session', status: 'open', openedAt: '2026-10-01T12:00:00Z' }];
  state.cashDebts = [];
  state.cashMovements = [
    { id: 'cash', cashBoxType: 'PETTY_CASH', paymentMethod: 'efectivo', amountBs: 200 },
    { id: 'fie', cashBoxType: 'PETTY_CASH', paymentMethod: 'qr', paymentAccount: 'BANCO FIE', amountBs: 500 },
  ];
  await bridge.__storage.replaceState(state);
  const debt = await bridge.cash.createDebt({ description: 'Digital debt', amountBs: 100, paymentMethod: 'qr', paymentAccount: 'BANCO FIE', pettyCashChannel: 'digital' });
  assert.equal(debt.pettyCashChannel, 'digital');
  const saved = await bridge.__storage.exportState(); await bridge.__storage.replaceState(saved);
  assert.equal((await bridge.__storage.exportState()).cashDebts[0].paymentMethod, 'qr');
  await assert.rejects(bridge.cash.payDebt({ debtId: debt.id, amountBs: 100, paymentMethod: 'efectivo' }), /trasladar/);
  await assert.rejects(bridge.cash.payDebt({ debtId: debt.id, amountBs: 100, paymentMethod: 'qr', paymentAccount: 'CIDRE' }), /saldo/);
  const result = await bridge.cash.payDebt({ debtId: debt.id, amountBs: 100, paymentMethod: 'qr', paymentAccount: 'BANCO FIE' });
  assert.ok(result);
  const final = await bridge.__storage.exportState();
  assert.equal(pettyCashChannelBalance(final.cashMovements, 'efectivo'), 200);
  assert.equal(pettyCashChannelBalance(final.cashMovements, 'qr', 'BANCO FIE'), 400);
});
