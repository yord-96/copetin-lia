import test from 'node:test';
import assert from 'node:assert/strict';
import { getAttendancePaymentCash } from './attendancePaymentCash.js';
const movement = (id, patch = {}) => ({ id, createdAt: '2026-11-18T03:59:00Z', cashBoxType: 'PETTY_CASH', category: 'anticipo_sueldos', responsible: ' FLÓR   FERRUFINO ', amountBs: -100, ...patch });
const state = { users: [{ id: 'f', fullName: 'FLOR FERRUFINO' }, { id: 'other', fullName: 'FLOR FERRUFINO PEREZ' }], cashMovements: [] };
const params = { personKey: 'id:f', dateFrom: '2026-11-01', dateTo: '2026-11-17' };
test('includes cash and digital advances and discounts only for exact worker and period, once per movement', () => {
  const result = getAttendancePaymentCash({ ...state, cashMovements: [movement('a'), movement('a'), movement('b', { paymentMethod: 'qr', accountingTag: 'personnel_advance', amountBs: -50 }), movement('c', { category: 'descuentos', amountBs: -20 }), movement('other', { responsible: 'FLOR FERRUFINO PEREZ' }), movement('late', { createdAt: '2026-11-18T04:00:00Z' }), movement('before', { createdAt: '2026-10-31T12:00:00Z' })] }, params);
  assert.equal(result.advances, 150); assert.equal(result.discounts, 20); assert.equal(result.movements.length, 3);
});
test('excludes cancelled, deleted, replaced and transferred records and unrelated commercial advances', () => {
  const patches = [{ deletedAt: 'date' }, { voidedAt: 'date' }, { receiptStatus: 'ANULADO' }, { replacedByMovementId: 'new' }, { isInternalTransfer: true }, { cashBoxType: 'MAIN' }, { amountBs: 100 }, { category: 'material_de_escritorio', description: 'PAGO ANTICIPO POR IMPRESION' }, { responsible: 'OTHER', createdBy: 'FLOR FERRUFINO' }];
  const result = getAttendancePaymentCash({ ...state, cashMovements: patches.map((patch, index) => movement(String(index), patch)) }, params);
  assert.equal(result.movements.length, 0);
});
test('historical archived movements remain included in their own period; ambiguous names need explicit identity', () => {
  assert.equal(getAttendancePaymentCash({ ...state, cashMovements: [movement('archived', { accountingArchivedAt: 'date' })] }, params).advances, 100);
  const result = getAttendancePaymentCash({ ...state, users: [...state.users, { id: 'duplicate', fullName: 'FLOR FERRUFINO' }], cashMovements: [movement('name-only'), movement('linked', { beneficiaryUserId: 'f', amountBs: -25 }), movement('wrong-link', { beneficiaryUserId: 'duplicate' })] }, params);
  assert.equal(result.advances, 25); assert.ok(result.warning);
  assert.throws(() => getAttendancePaymentCash(state, { ...params, personKey: 'id:missing' }));
  assert.throws(() => getAttendancePaymentCash(state, { ...params, dateFrom: '2026-12-01' }));
});
