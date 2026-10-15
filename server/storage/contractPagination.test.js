import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { buildContractDocumentHtml } from '../../src/services/webBridge.js';

const executablePath = [process.env.CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(value => value && existsSync(value));

test('eight detailed items and economic closing fit oficio; large contracts still paginate', { skip: !executablePath }, async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 786, height: 1202 });
    await page.emulateMediaType('print');
    for (const count of [8, 35]) {
      const items = Array.from({ length: count }, (_, index) => ({
        itemId: `item-${index}`, itemName: index < 4 ? `MATERIAL DE ALQUILER ${index}` : `MESA RECTANGULAR / DIEZ PERSONAS (1X2 MTS) ${index}`,
        quantity: 2, unitPriceBs: 28, lineTotalBs: 56, category: 'MOBILIARIO',
        comboName: index >= 4 ? 'MESA RECTANGULAR / DIEZ PERSONAS + MULETON' : '',
      }));
      const contract = {
        contractCode: 'TEST', customerName: 'CLIENTE DE PRUEBA', items,
        address: 'DIRECCION DE ENTREGA CON REFERENCIAS ENTRE DOS CALLES Y UN PASAJE PARA ENCONTRAR EL LUGAR DEL EVENTO',
        eventDate: '2026-10-17', deliveryDate: '2026-10-16', pickupDate: '2026-10-17',
        totals: { totalBs: 286, subtotalBs: 492, discountBs: 246, deliveryFeeBs: 40, guaranteeBs: 100 },
        guarantee: { amountBs: 100, status: 'validado' }, payment: { paidAtApprovalBs: 286 },
        economicLedger: [
          { id: 'paid', type: 'deposit', amountBs: 386, note: 'PAGO TOTAL', createdAt: '2026-10-15T15:00:00Z' },
          { id: 'held', type: 'guarantee_reserve', amountBs: 100, note: 'DEL DEPOSITO SE APARTARON CIEN BOLIVIANOS COMO GARANTIA PARA EL CLIENTE', createdAt: '2026-10-15T15:00:00Z' },
        ],
      };
      const html = buildContractDocumentHtml({ contract, rental: contract, deliveries: [], settings: {}, paperSize: 'oficio' });
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
      const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
      if (count === 8) assert.equal(pages, 1, 'short contract must include its financial closing and signatures on one page');
      else assert.ok(pages > 1, 'long documents must paginate without shrinking to one page');
    }
  } finally { await browser.close(); }
});
