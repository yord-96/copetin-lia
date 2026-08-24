import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOrderTableControls } from './orderTableControls.js';

const rows = [
  { contractCode: '20', eventDate: '2026-08-03', customerName: 'Zulema', hasDamage: false, hasNotes: true, hasGuarantee: false, isPaid: true, isFinalized: false },
  { contractCode: '3', eventDate: '2026-08-05', customerName: 'Ana', hasDamage: true, hasNotes: false, hasGuarantee: true, isPaid: false, isFinalized: true },
  { contractCode: '11', eventDate: '2026-08-04', customerName: 'Beatriz', hasDamage: false, hasNotes: false, hasGuarantee: true, isPaid: true, isFinalized: true },
];

test('filtra las banderas operativas combinadas', () => {
  const result = applyOrderTableControls(rows, { guarantee: 'yes', payment: 'no', finalized: 'yes' });
  assert.deepEqual(result.map((row) => row.contractCode), ['3']);
});

test('ordena contratos de forma numerica y estable', () => {
  const asc = applyOrderTableControls(rows, {}, { key: 'contract', direction: 'asc' });
  const desc = applyOrderTableControls(rows, {}, { key: 'contract', direction: 'desc' });
  assert.deepEqual(asc.map((row) => row.contractCode), ['3', '11', '20']);
  assert.deepEqual(desc.map((row) => row.contractCode), ['20', '11', '3']);
});

test('ordena fecha y cliente en ambas direcciones', () => {
  const dates = applyOrderTableControls(rows, {}, { key: 'date', direction: 'desc' });
  const clients = applyOrderTableControls(rows, {}, { key: 'client', direction: 'asc' });
  assert.deepEqual(dates.map((row) => row.contractCode), ['3', '11', '20']);
  assert.deepEqual(clients.map((row) => row.customerName), ['Ana', 'Beatriz', 'Zulema']);
});
