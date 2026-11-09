import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { buildItemLoanDocumentHtml } from '../../src/utils/itemLoanDocument.js';

const chrome = [process.env.CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(value => value && existsSync(value));
test('eleven materials, return history and signatures fit one letter page; large loans paginate', { skip: !chrome }, async () => {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    for (const count of [11, 60]) {
      const loan = { code: 'PR-TEST', personName: 'CLIENTE DE EJEMPLO', date: '2026-11-09', notes: 'Devolución parcial de material registrada.', createdByName: 'RESPONSABLE DE INVENTARIO',
        lines: Array.from({ length: count }, (_, i) => ({ id: `l-${i}`, itemName: 'MANTEL SATINADO / AZUL MARINO', quantity: 5 })),
        returns: [{ lineId: 'l-0', quantity: 2, date: '2026-11-09', note: 'Entrega parcial' }],
      };
      await page.setContent(buildItemLoanDocumentHtml({ loan }));
      const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
      const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
      if (count === 11) assert.equal(pages, 1);
      else assert.ok(pages > 1);
    }
  } finally { await browser.close(); }
});
