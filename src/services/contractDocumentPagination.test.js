import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import puppeteer from 'puppeteer-core';
import { buildContractDocumentHtml } from './webBridge.js';

test('six-line oficio contract keeps payment history, guarantee and signatures on one printed sheet', async () => {
  const items = [
    ['COPA DE VINO TINTO NADIR', 12, 1.2], ['JARRA LISO 1 (1/4) LITRO (PATITO)', 3, 8],
    ['PLATO BUFETERO / CUADRADO BLANCO', 24, 2.5], ['ESTRUCTURAS DE CHIFUNDIS', 2, 55],
    ['BANDEJA HONDA 1/2', 4, 0], ['QUEMADORES', 4, 0],
  ].map(([itemName, quantity, unitPriceBs], index) => ({ itemId: `item-${index}`, lineKey: `line-${index}`, itemName, quantity, unitPriceBs, lineTotalBs: quantity * unitPriceBs, ...(index >= 3 ? { observation: 'COMBO: CHIFUNDIS CON 2 DIVISIONES' } : {}) }));
  const economicLedger = [
    { id: 'payment', type: 'deposit', amountBs: 263.4, createdAt: '2026-11-18T16:34:00Z', paymentMethod: 'efectivo', note: 'PAGO TOTAL', cashReceiptCode: 'RC-1' },
    { id: 'guarantee', type: 'guarantee', amountBs: 100, sourceDepositId: 'payment', createdAt: '2026-11-18T16:34:00Z', note: 'DEL DEPOSITO SE APARTARON Bs 100.00 COMO GARANTIA.' },
    { id: 'addition', type: 'deposit', amountBs: 45, createdAt: '2026-11-18T18:08:00Z', paymentMethod: 'efectivo', note: 'PAGO AUMENTO', cashReceiptCode: 'RC-2' },
  ];
  let html = buildContractDocumentHtml({ paperSize: 'oficio', contract: { contractCode: '3630', customerName: 'CLIENTE DE PRUEBA', eventDate: '2026-11-19', items, totals: { subtotalBs: 208.4, totalBs: 208.4, guaranteeBs: 100 }, economicLedger }, rental: { customerName: 'CLIENTE DE PRUEBA', items, depositBs: 100, totals: { totalBs: 208.4 } }, deliveries: [], settings: {} });
  const logo = await fs.readFile(new URL('../../public/imagenes/logo_el_copetin_redisenado.png', import.meta.url));
  html = html.replace('/imagenes/logo_el_copetin_redisenado.png', `data:image/png;base64,${logo.toString('base64')}`);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome-stable'), headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html); await page.emulateMediaType('print');
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1);
    for (const selector of ['.rc-economic-control', '.rc-financial-block', '.rc-signatures']) assert.ok(await page.$eval(selector, element => element.getBoundingClientRect().height > 0));
  } finally { await browser.close(); }
});

test('3681: short two-day contract fits on one oficio sheet with both days, closing and signatures', async () => {
  const fixture = { paperSize:'oficio', contract:{contractCode:'3681',customerName:'CLIENTE DE PRUEBA',
    items:[
      {itemId:'a',itemName:'MANTEL ALTO RELIEVE / PERLA',quantity:7,unitPriceBs:25,lineTotalBs:175,serviceDayId:'day1'},
      {itemId:'b',itemName:'MANTEL DASTY / BLUE CLARO',quantity:8,unitPriceBs:28,lineTotalBs:224,serviceDayId:'day2'},
      {itemId:'c',itemName:'SERVILLETA LISO / DASTY BLUE',quantity:80,unitPriceBs:2,lineTotalBs:160,serviceDayId:'day2'},
    ], pricingPlan:{mode:'daily_schedule',scheduleDays:[{id:'day1',label:'Dia 1',date:'2026-12-04'},{id:'day2',label:'Dia 2',date:'2026-12-05'}]},
    totals:{itemsSubtotalBs:559,totalBs:559,guaranteeBs:0}}, rental:{}, deliveries:[],settings:{} };
  let html = buildContractDocumentHtml(fixture);
  const logo = await fs.readFile(new URL('../../public/imagenes/logo_el_copetin_redisenado.png', import.meta.url));
  html = html.replace('/imagenes/logo_el_copetin_redisenado.png', `data:image/png;base64,${logo.toString('base64')}`);
  const browser = await puppeteer.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || (process.platform==='win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome-stable'),headless:true,args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    await page.setContent(html); await page.emulateMediaType('print');
    await page.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));
    const pdf = Buffer.from(await page.pdf({preferCSSPageSize:true,printBackground:true}));
    assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,1);
    assert.equal(await page.$$eval('.rc-duration-day-row', rows=>rows.length),2);
    assert.match(await page.$eval('.rc-economic-status',node=>node.textContent),/559,00/);
    for (const selector of ['.rc-economic-control','.rc-financial-block','.rc-signatures']) assert.ok(await page.$eval(selector,node=>node.getBoundingClientRect().height>0));
  } finally { await browser.close(); }
});
