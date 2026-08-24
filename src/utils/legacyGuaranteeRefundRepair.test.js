import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findLegacyReturnedGuaranteeRefunds,
  repairLegacyReturnedGuaranteeRefunds,
} from '../../server/migrations/repairLegacyGuaranteeRefunds.js';

const makeState = ({ rentalStatus = 'returned', movement = null } = {}) => ({
  contracts: [{
    id: 'contract-1',
    contractCode: '1600',
    customerName: 'Cliente histórico',
    isFinalized: false,
    economicLedger: [{
      id: 'refund-entry-1',
      type: 'refund',
      refundSource: 'guarantee',
      amountBs: 150,
      cashMovementId: 'missing-movement-1',
      cashReceiptCode: 'RC-0042',
      isCashRegistered: false,
      paymentMethod: 'QR',
      paymentAccount: 'mercantil',
      createdAt: '2026-07-05T12:00:00.000Z',
      createdByName: 'Usuario histórico',
      note: 'Devolución histórica confirmada.',
    }],
  }],
  rentals: [{
    id: 'rental-1',
    contractId: 'contract-1',
    orderCode: 'OS-00001',
    status: rentalStatus,
  }],
  cashMovements: movement ? [movement] : [],
  systemAuditLog: [],
  resetLogs: [],
});

test('reconstruye el movimiento faltante conservando recibo, fecha y autor', () => {
  const state = makeState();
  assert.equal(findLegacyReturnedGuaranteeRefunds(state).length, 1);

  const result = repairLegacyReturnedGuaranteeRefunds(state);
  assert.equal(result.repaired.length, 1);
  assert.equal(state.cashMovements.length, 1);
  const movement = state.cashMovements[0];
  assert.equal(movement.id, 'missing-movement-1');
  assert.equal(movement.receiptCode, 'RC-0042');
  assert.equal(movement.amountBs, -150);
  assert.equal(movement.accountingTag, 'guarantee_refund');
  assert.equal(movement.linkedContractId, 'contract-1');
  assert.equal(movement.linkedRentalId, 'rental-1');
  assert.equal(movement.createdAt, '2026-07-05T12:00:00.000Z');
  assert.equal(movement.createdByName, 'Usuario histórico');
  assert.equal(movement.paymentMethod, 'qr');
  assert.equal(movement.paymentAccount, 'MERCANTIL');
  assert.equal(state.contracts[0].economicLedger[0].isCashRegistered, true);
  assert.equal(findLegacyReturnedGuaranteeRefunds(state).length, 0);
});

test('no repara si el material todavía no volvió', () => {
  const state = makeState({ rentalStatus: 'active' });
  assert.equal(findLegacyReturnedGuaranteeRefunds(state).length, 0);
});

test('no revive un movimiento que fue anulado explícitamente', () => {
  const state = makeState({
    movement: {
      id: 'missing-movement-1',
      amountBs: -150,
      accountingTag: 'guarantee_refund',
      linkedContractId: 'contract-1',
      receiptCode: 'RC-0042',
      voidedAt: '2026-07-06T10:00:00.000Z',
    },
  });
  assert.equal(findLegacyReturnedGuaranteeRefunds(state).length, 0);
});

test('no duplica una devolución ya respaldada por otro movimiento activo', () => {
  const state = makeState({
    movement: {
      id: 'another-movement',
      type: 'egreso_manual',
      amountBs: -150,
      accountingTag: 'guarantee_refund',
      linkedContractId: 'contract-1',
      receiptCode: 'RC-0100',
    },
  });
  assert.equal(findLegacyReturnedGuaranteeRefunds(state).length, 0);
});
