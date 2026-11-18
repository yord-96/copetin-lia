import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractDocumentHtml } from './webBridge.js';
import { dailyAmountsFixture } from './webBridge.contractDailyAmounts.test.js';

test('book report keeps combo components, separates courtesy issues and preserves financial totals', () => {
  const items = [
    { itemId: 'chair', lineKey: 'chair', comboLineKey: 'package', itemName: 'SILLA', quantity: 10, unitPriceBs: 12, lineTotalBs: 120 },
    { itemId: 'cushion', lineKey: 'cushion', comboLineKey: 'package', itemName: 'COJIN', quantity: 10, unitPriceBs: 0, lineTotalBs: 0 },
    { itemId: 'glass', lineKey: 'paid', itemName: 'COPA', quantity: 35, unitPriceBs: 4, lineTotalBs: 140 },
    { itemId: 'glass', lineKey: 'courtesy', itemName: 'COPA CORTESIA', quantity: 5, unitPriceBs: 0, lineTotalBs: 0 },
  ];
  const html = buildContractDocumentHtml({ documentKind: 'book', deliveries: [], settings: {},
    contract: { contractCode: '1003', customerName: '<Cliente>', address: 'SALÓN <CENTRO>', items, totals: { guaranteeBs: 200, subtotalBs: 260, itemsSubtotalBs: 260, discountPercent: 15, discountBs: 39, deliveryFeeBs: 10, totalBs: 231 } },
    rental: { items, status: 'returned', returnReport: [{ itemId: 'glass', lineKey: 'paid', missingQty: 5, missingUnitChargeBs: 35, penaltyBs: 175 }] },
  });
  assert.match(html, /size: Letter portrait/);
  assert.match(html, /&lt;Cliente&gt;/);
  assert.match(html, /DIRECCIÓN:<\/b> SALÓN &lt;CENTRO&gt;/);
  assert.match(html, /GARANTÍA \(SEPARADA DEL ALQUILER\)<\/th><td class="number">200,00/);
  assert.match(html, /SILLA \+ COJIN/);
  assert.equal((html.match(/<td class="index">/g) || []).length, 3);
  assert.equal((html.match(/F5×35=175/g) || []).length, 1);
  assert.match(html, /TOTAL ALQUILER<\/th><td class="number">231,00/);
  assert.match(html, /TOTAL ALQUILER \+ REPOSICIÓN<\/th><td class="number">406,00/);
});

test('book report retains every charged duration day', () => {
  const html = buildContractDocumentHtml({ ...dailyAmountsFixture(), documentKind: 'book' });
  assert.match(html, /DIA 1: MULETON COCTELERO/);
  assert.match(html, /DIA 5: MULETON COCTELERO/);
  assert.equal((html.match(/<td class="index">/g) || []).length, 20);
  assert.match(html, /TOTAL ALQUILER<\/th><td class="number">203,50/);
});
