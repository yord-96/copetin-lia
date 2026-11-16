import test from 'node:test';
import assert from 'node:assert/strict';
import { contractDocumentMovement as movement } from './contractDocumentMovement.js';
import { buildContractDocumentHtml } from '../services/webBridge.js';
const paid = { lineKey: 'paid', itemId: 'cup', itemName: 'COPA MORADA', quantity: 35, unitPriceBs: 4 };
const courtesy = { ...paid, lineKey: 'courtesy', quantity: 5, unitPriceBs: 0 };
const rental = { items: [paid, courtesy], operational: { inventoryStatus: 'salio' }, returnReport: [{ lineKey: 'paid', itemId: 'cup', returnedQty: 30, missingQty: 5 }] };

test('sent and partial return are tied to the correct line, never copied to courtesy', () => {
  assert.deepEqual(movement(paid, rental), { delivered: true, returned: true, returnedQty: 30, quantity: 35 });
  assert.equal(movement(courtesy, rental).returned, false);
  const document = buildContractDocumentHtml({ rental, contract: { items: [paid, courtesy] }, deliveries: [], settings: {} });
  assert.equal((document.match(/class="rc-movement-mark">E</g) ?? []).length, 2);
  assert.equal((document.match(/class="rc-movement-mark">DV/g) ?? []).length, 1);
  assert.match(document, /rc-movement-count">30\/35/);
});

test('confirmation alone is not delivery; dispatch review distinguishes unshipped lines', () => {
  assert.equal(movement(paid, { items: [paid], operational: { inventoryStatus: 'confirmado', inventorySentAt: '2026-11-16' } }).delivered, false);
  const reviewed = { ...rental, operational: { inventoryStatus: 'salio', dispatchReview: { items: [{ lineKey: 'paid', dispatchedQty: 35 }, { lineKey: 'courtesy', dispatchedQty: 0 }] } } };
  assert.equal(movement(courtesy, reviewed).delivered, false);
});

test('successive receptions are accumulated once and missing units never count as returned', () => {
  const report = [{ lineKey: 'paid', returnedQty: 20, previousProcessedQty: 0 }, { lineKey: 'paid', returnedQty: 10, previousProcessedQty: 20, missingQty: 5 }];
  assert.equal(movement(paid, { ...rental, returnReport: report, partialReturnReport: { items: report } }).returnedQty, 30);
  assert.equal(movement(paid, { ...rental, returnReport: [{ lineKey: 'paid', returnedQty: 0, missingQty: 35 }] }).returned, false);
  assert.equal(movement(paid, { items: [paid], status: 'returned' }).returnedQty, 35);
});
