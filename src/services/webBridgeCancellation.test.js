import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLateCancellationErrorMessage } from './webBridge.js';

test('explains the active guarantee receipt that blocks a late cancellation', () => {
  const message = buildLateCancellationErrorMessage({
    cutoffDate: '2026-07-03',
    wasOperationallySent: false,
    collectedBs: 0,
    guaranteeWasCollected: true,
    cashReceipts: [{
      type: 'ingreso_garantia',
      category: 'garantia',
      amountBs: 100,
      receiptCode: 'RC-0052',
    }],
  });

  assert.match(message, /garantía/i);
  assert.match(message, /100[,.]00/);
  assert.match(message, /recibo RC-0052/i);
  assert.doesNotMatch(message, /nunca salió/i);
});

test('explains operational and stored collection blockers without a receipt', () => {
  const message = buildLateCancellationErrorMessage({
    cutoffDate: '2026-07-03',
    wasOperationallySent: true,
    collectedBs: 60,
    guaranteeWasCollected: false,
    cashReceipts: [],
  });

  assert.match(message, /salida, entrega o devolución/i);
  assert.match(message, /60[,.]00 cobrados/i);
});
