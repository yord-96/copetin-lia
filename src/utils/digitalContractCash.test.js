import test from 'node:test';
import assert from 'node:assert/strict';
import { reflectDigitalContractCash, isDigitalContractCashMovement, isZeroDigitalOpening } from './digitalContractCash.js';
import { pettyCashChannelBalance } from './pettyCashChannel.js';

const receipt = { id: 'receipt', cashBoxType: 'BIG_CASH', paymentMethod: 'qr', paymentAccount: 'CIDRE', amountBs: 500, linkedContractId: 'contract', createdAt: '2026-10-01T04:00:00Z' };

test('October bank view preserves original receipts and excludes internal applications', () => {
  assert.equal(isDigitalContractCashMovement(receipt), true);
  assert.equal(isDigitalContractCashMovement({ ...receipt, createdAt: '2026-10-01T03:59:00Z' }), false);
  assert.equal(isDigitalContractCashMovement({ ...receipt, paymentMethod: 'efectivo' }), false);
  assert.equal(isDigitalContractCashMovement({ ...receipt, accountingTag: 'guarantee_damage_application' }), false);
  const rows = [receipt, { ...receipt, id: 'refund', amountBs: -100 }, { id: 'existing', cashBoxType: 'PETTY_CASH', paymentMethod: 'qr', paymentAccount: 'CIDRE', amountBs: 200 }];
  const before = structuredClone(rows);
  const reflected = reflectDigitalContractCash(rows);
  assert.deepEqual(rows, before);
  assert.equal(reflected[0].id, receipt.id);
  assert.equal(reflected[0].originalCashBoxType, 'BIG_CASH');
  assert.deepEqual(reflectDigitalContractCash(reflected), reflected);
  assert.equal(pettyCashChannelBalance(rows, 'qr', 'CIDRE'), 600);
  assert.equal(pettyCashChannelBalance(rows, 'qr', 'BCP'), 0);
  assert.equal(pettyCashChannelBalance([...rows, { ...receipt, id: 'void', voidedAt: '2026-11-20' }], 'qr', 'CIDRE'), 600);
});

test('shared bank availability prevents using historical or already spent funds twice', () => {
  const rows = [receipt, { ...receipt, id: 'old-debit', amountBs: -300, createdAt: '2026-09-01T12:00:00Z' }];
  assert.equal(pettyCashChannelBalance(rows, 'qr', 'CIDRE'), 200);
  assert.equal(pettyCashChannelBalance([...rows, { ...receipt, id: 'expense', cashBoxType: 'PETTY_CASH', amountBs: -150 }], 'qr', 'CIDRE'), 50);
});

test('zero is allowed exclusively as an explicit digital opening', () => {
  const opening = { type: 'ingreso', cashBoxType: 'PETTY_CASH', paymentMethod: 'qr', amountBs: 0, category: 'apertura', accountingTag: 'opening_balance' };
  assert.equal(isZeroDigitalOpening(opening), true);
  for (const change of [{ type: 'egreso' }, { paymentMethod: 'efectivo' }, { cashBoxType: 'BIG_CASH' }, { category: 'ingreso_fondos' }]) assert.equal(isZeroDigitalOpening({ ...opening, ...change }), false);
});
