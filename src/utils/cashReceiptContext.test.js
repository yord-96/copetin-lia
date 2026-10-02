import test from 'node:test';
import assert from 'node:assert/strict';
import { getWebBridge } from '../services/webBridge.js';

test('imprime con el contexto puntual del servidor sin depender de la base local', async () => {
  const movement = { id: 'receipt-context-test', cashBoxType: 'BIG_CASH', type: 'ingreso', amountBs: 30,
    receiptCode: 'RC-13516', linkedContractId: 'contract-context-test', createdAt: '2026-09-27T13:42:00Z',
    paymentMethod: 'qr', paymentAccount: 'CIDRE', receiptDetail: 'SEGUNDO PAGO' };
  const result = await getWebBridge().printer.printCashMovementReceipt({
    movementId: movement.id, receiptContext: {
      settings: {}, cashMovements: [movement], rentals: [],
      contracts: [{ id: 'contract-context-test', contractCode: '2088', customerName: 'Armando Osorio' }],
    },
  });
  assert.match(result.html, /RC-13516/);
  assert.match(result.html, /Armando Osorio/);
  assert.match(result.html, /SEGUNDO PAGO/);
  assert.match(result.html, /2088/);
});
