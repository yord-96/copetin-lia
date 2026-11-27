import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractDocumentHtml } from './webBridge.js';
import { buildContractBookWorkbook } from '../utils/contractBookWorkbook.js';

test('book PDF and Excel show item discounts separately without subtracting them twice', async () => {
  for (const documentKind of ['book', 'book_quote']) {
    for (const generalDiscount of [0, 100]) {
      const source = { documentKind, settings: {}, deliveries: [], rental: {}, contract: {
        contractCode: '3707', customerName: 'XIMENA VARGAS', items: [
          { itemId: '1', itemName: 'MANTEL MIL HOJAS', quantity: 1, unitPriceBs: 35, grossLineTotalBs: 35, discountBs: 3.5, lineTotalBs: 31.5 },
          { itemId: '2', itemName: 'MANTEL ALTO RELIEVE', quantity: 10, unitPriceBs: 25, grossLineTotalBs: 250, discountBs: 25, lineTotalBs: 225 },
          { itemId: '3', itemName: 'CAPUCHON', quantity: 100, unitPriceBs: 2, grossLineTotalBs: 200, discountBs: 20, lineTotalBs: 180 },
          { itemId: '4', itemName: 'SILLA', quantity: 100, unitPriceBs: 8, lineTotalBs: 800 },
        ], totals: { itemsGrossSubtotalBs: 1285, itemsSubtotalBs: 1236.5, itemDiscountsBs: 48.5, discountBs: generalDiscount, totalBs: 1236.5 - generalDiscount },
      } };
      const report = buildContractDocumentHtml({ ...source, bookOutput: 'data' });
      assert.equal(report.itemDiscountsBs, 48.5);
      assert.equal(report.subtotalBs, 1236.5);
      assert.equal(report.totalBs, 1236.5 - generalDiscount);
      const html = buildContractDocumentHtml(source).replace(/>\s+</g, '><');
      assert.match(html, /SUBTOTAL ANTES DE DESCUENTOS<\/th><td class="number">1\.285,00/);
      assert.match(html, /DESCUENTO POR ÍTEMS<\/th><td class="number">48,50/);
      assert.match(html, /SUBTOTAL NETO<\/th><td class="number">1\.236,50/);
      assert.match(html, /DESCUENTO GENERAL/);
      const workbook = await buildContractBookWorkbook(report);
      const values = new Map();
      workbook.worksheets[0].eachRow(row => values.set(row.getCell(1).value, row.getCell(5).value));
      assert.equal(values.get('SUBTOTAL ANTES DE DESCUENTOS'), 1285);
      assert.equal(values.get('DESCUENTO POR ÍTEMS'), 48.5);
      assert.equal(values.get('SUBTOTAL NETO'), 1236.5);
      assert.equal(values.get('DESCUENTO GENERAL'), generalDiscount);
      assert.equal(values.get('TOTAL ALQUILER'), 1236.5 - generalDiscount);
    }
  }
});
