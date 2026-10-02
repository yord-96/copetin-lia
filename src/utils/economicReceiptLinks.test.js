import test from 'node:test';
import assert from 'node:assert/strict';
import { linkEconomicReceiptRows } from './economicReceiptLinks.js';

const entry = (id, day, extra = {}) => ({ id, type: 'deposit', amountBs: 30, createdAt: `2026-09-${day}T13:42:00Z`, paymentMethod: 'qr', paymentAccount: 'CIDRE', ...extra });
const receipt = (id, day) => ({ id, amountBs: 30, createdAt: `2026-09-${day}T13:42:00Z`, receiptCode: `RC-${id}`, paymentMethod: 'qr', paymentAccount: 'CIDRE' });
const link = (entries, movements) => linkEconomicReceiptRows(entries, {
  postedMovements: movements, deposits: movements, refunds: [],
  getAmount: row => row.amountBs, isVoided: row => Boolean(row?.voidedAt),
  isGuarantee: row => row.category === 'garantia',
  normalizeMethod: value => String(value ?? '').toLowerCase(),
  normalizeAccount: value => String(value ?? '').toUpperCase(),
});

test('dos pagos iguales en días distintos nunca comparten el recibo existente del 27', () => {
  const rows = link([entry('first', '27', { cashMovementId: 'one' }), entry('second', '28')], [receipt('one', '27')]);
  assert.equal(rows[0].cashMovementId, 'one');
  assert.equal(rows[1].cashMovementId, null);
  assert.equal(rows[1].isCashRegistered, false);
});
test('reserva los enlaces explícitos aun si aparecen después y asigna un recibo distinto por fecha', () => {
  const rows = link([entry('second', '28'), entry('first', '27', { cashMovementId: 'one' })], [receipt('one', '27'), receipt('two', '28')]);
  assert.deepEqual(rows.map(row => row.cashMovementId), ['two', 'one']);
});
test('un enlace duplicado guardado deja de confirmar dos pagos y respeta un recibo anulado', () => {
  const rows = link([entry('first', '27', { cashMovementId: 'one' }), entry('second', '28', { cashMovementId: 'one' })], [receipt('one', '27')]);
  assert.equal(rows[1].cashMovementId, null);
  assert.equal(link([entry('first', '27', { cashMovementId: 'one' })], [{ ...receipt('one', '27'), voidedAt: '2026-10-02' }])[0].isCashRegistered, false);
});
test('no reasigna un recibo explícito al editar la fecha y compara días de Bolivia', () => {
  assert.equal(link([entry('first', '28', { cashMovementId: 'one' })], [receipt('one', '27')])[0].cashMovementId, 'one');
  const row = { ...receipt('one', '28'), createdAt: '2026-09-28T02:00:00Z' };
  assert.equal(link([entry('first', '27')], [row])[0].cashMovementId, 'one');
});
