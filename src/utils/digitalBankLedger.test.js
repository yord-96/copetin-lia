import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigitalBankLedger } from './digitalBankLedger.js';

test('bank and date filters retain prior balances and global current total', () => {
  const row = { cashBoxType: 'PETTY_CASH', paymentMethod: 'qr', createdAt: '2026-10-01T12:00:00Z' };
  const rows = [
    { ...row, id: 'a', cashLedgerSequence: 1, paymentAccount: 'CIDRE', amountBs: 500 },
    { ...row, id: 'b', cashLedgerSequence: 2, paymentAccount: 'BCP', amountBs: 200 },
    { ...row, id: 'c', cashLedgerSequence: 3, paymentAccount: 'CIDRE', amountBs: -50, createdAt: '2026-11-01T12:00:00Z' },
    { ...row, id: 'void', cashLedgerSequence: 4, paymentAccount: 'CIDRE', amountBs: 900, voidedAt: '2026-11-02' },
  ];
  const ledger = buildDigitalBankLedger(rows, { bank: 'CIDRE', dateFrom: '2026-11-01' });
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0].bankBeforeBs, 500);
  assert.equal(ledger.rows[0].totalBeforeBs, 700);
  assert.equal(ledger.rows[0].bankBalanceBs, 450);
  assert.equal(ledger.rows[0].digitalBalanceBs, 650);
  assert.equal(ledger.totalBs, 650);
  assert.equal(ledger.expenseBs, 50);
  assert.deepEqual(ledger.balances, { CIDRE: 450, BCP: 200 });
  assert.equal(buildDigitalBankLedger(rows, { bank: 'BNB' }).rows.length, 0);
  assert.equal(buildDigitalBankLedger(rows, { query: 'BCP' }).rows.length, 1);
});
