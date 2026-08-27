import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveEconomicReceiptDisplayTimestamp,
  resolveEconomicReceiptTimestamps,
} from './economicReceiptTimestamp.js';

test('conserva la fecha historica al generar posteriormente el recibo', () => {
  const historicalDate = '2026-08-19T18:11:00.000Z';
  const result = resolveEconomicReceiptTimestamps(
    { createdAt: historicalDate, receiptIssuedAt: historicalDate },
    new Date('2026-08-27T18:12:00.000Z'),
  );

  assert.deepEqual(result, {
    createdAt: historicalDate,
    receiptIssuedAt: historicalDate,
  });
});

test('usa una sola fecha actual cuando el movimiento no define una', () => {
  const fallbackDate = '2026-08-27T18:12:00.000Z';
  assert.deepEqual(resolveEconomicReceiptTimestamps({}, fallbackDate), {
    createdAt: fallbackDate,
    receiptIssuedAt: fallbackDate,
  });
});

test('un recibo legacy recupera la fecha de su linea economica vinculada', () => {
  assert.equal(resolveEconomicReceiptDisplayTimestamp({
    movement: { createdAt: '2026-08-27T18:12:00.000Z' },
    ledgerEntry: { createdAt: '2026-08-19T18:11:00.000Z' },
  }), '2026-08-19T18:11:00.000Z');
});

test('una fecha editada expresamente prevalece sobre el historial vinculado', () => {
  assert.equal(resolveEconomicReceiptDisplayTimestamp({
    movement: {
      createdAt: '2026-08-27T18:12:00.000Z',
      receiptIssuedAt: '2026-08-20T15:00:00.000Z',
      receiptEditedAt: '2026-08-27T19:00:00.000Z',
    },
    ledgerEntry: { createdAt: '2026-08-19T18:11:00.000Z' },
  }), '2026-08-20T15:00:00.000Z');
});
