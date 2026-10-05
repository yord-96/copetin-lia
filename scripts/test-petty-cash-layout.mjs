import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import puppeteer from 'puppeteer-core';
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import AccountingSection from '/src/components/sections/AccountingSection.jsx';
import { api } from '/src/services/api.js';
import { addPettyExpenseCategory } from '/src/utils/pettyExpenseCategories.js';
import '/src/App.css';
import '/src/index.css';
const rows=[{id:'fund',cashBoxType:'PETTY_CASH',type:'ingreso',category:'ingreso_fondos',amountBs:500,description:'Fondo propio',fundBalanceBs:500,createdAt:'2026-10-02T15:00:00Z',cashLedgerSequence:1}, {id:'expense',cashBoxType:'PETTY_CASH',type:'egreso',category:'entrega_fondos',amountBs:-80,description:'Pago propio',fundBalanceBs:420,createdAt:'2026-10-01T08:00:00Z',cashLedgerSequence:2}];
if (location.search.includes('long')) {
  rows.splice(0, rows.length, ...Array.from({length:30}, (_, i) => ({id:'long-'+i,cashBoxType:'PETTY_CASH',type:i%3?'egreso':'ingreso',category:i%3?'alimentacion':'ingreso_fondos',amountBs:i%3?-140:10000,description:'PAGO DE BOCADITOS PARA CONTRATO DE ALCALDIA, 250 BROCHETAS Y 125 MUSLITOS',responsible:'NOELIA ELISA ORELLANA',createdBy:'LISBETH MUÑOZ',receipt:'FIRMA EN CUADERNO',fundBalanceBs:7517.50,cashLedgerSequence:i+1,createdAt:'2026-10-05T13:41:00Z'})));
}
api.cash.getPettyCategories=async()=>({categories:JSON.parse(localStorage.getItem('test-petty-categories')||'[]')});
api.cash.createPettyCategory=async label=>{const result=addPettyExpenseCategory(JSON.parse(localStorage.getItem('test-petty-categories')||'[]'),label);localStorage.setItem('test-petty-categories',JSON.stringify(result.categories));return result;};
api.cash.getPettySector=async ({sector})=>({rows:sector==='expenses'?rows:[],total:sector==='expenses'?rows.length:0,hasMore:false});
const formatBs=n=>'Bs '+Number(n).toFixed(2);
createRoot(document.getElementById('root')).render(<main className="app-main"><AccountingSection activeModule="contabilidad_caja_chica" cashMovements={[...rows,{id:'big-fund',cashBoxType:'BIG_CASH',type:'ingreso',category:'ingreso_fondos',amountBs:5000}]} cashSummary={{pettyCashBalanceBs:420}} onPrintCashMovementReceipt={async()=>({html:'<html><body>Recibo de ingreso de Caja Chica</body></html>'})} formatBs={formatBs} formatDate={v=>String(v??'')} formatDateTime={v=>String(v??'')} /></main>);
`;
const server=await createServer({configFile:false,plugins:[react(),{
  name:'petty-fixture',
  resolveId(id){if(id==='/petty-fixture.jsx')return process.cwd().replaceAll('\\','/')+'/petty-fixture.jsx';},
  load(id){if(id.endsWith('/petty-fixture.jsx'))return fixture;},
  configureServer(dev){dev.middlewares.use('/petty-layout',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await dev.transformIndexHtml('/petty-layout','<div id="root"></div><script type="module" src="/petty-fixture.jsx"></script>'));});},
}],server:{host:'127.0.0.1',port:0,open:false}});
let browser;
try {
  await server.listen();
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage(); const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const assertOverlay = async (selector) => {
    const geometry = await page.$eval(selector, modal => {
      const backdrop = modal.parentElement;
      const box = modal.getBoundingClientRect();
      const bounds = backdrop.getBoundingClientRect();
      return { position: getComputedStyle(backdrop).position,
        coversScreen: bounds.top === 0 && bounds.left === 0 && bounds.width === innerWidth && bounds.height === innerHeight,
        visible: box.top >= 0 && box.bottom <= innerHeight,
        centered: Math.abs((box.left + box.right) / 2 - innerWidth / 2) < 2 };
    });
    assert.equal(geometry.position, 'fixed');
    assert.ok(geometry.coversScreen); assert.ok(geometry.visible); assert.ok(geometry.centered);
  };
  for(const width of [1920,1440,1024]){
    await page.setViewport({width,height:1000});
    await page.goto(server.resolvedUrls.local[0]+'petty-layout');
    await page.waitForFunction(()=>document.querySelectorAll('.petty-expenses-card tbody tr:not(.petty-opening-balance)').length===2);
    const result=await page.evaluate(()=>({headers:[...document.querySelectorAll('.petty-expenses-card thead th')].map(e=>e.textContent),funds:[...document.querySelectorAll('.petty-expenses-card tbody tr:not(.petty-opening-balance) .petty-fund-cell > strong')].map(e=>e.textContent),opening:document.querySelector('.petty-opening-balance .petty-fund-cell strong')?.textContent,text:document.body.textContent}));
    assert.equal(result.headers.at(-1),'Acciones'); assert.deepEqual(result.funds,['Bs 500.00','Bs 0.00','Bs 420.00','Bs 0.00']);
    assert.deepEqual(result.headers.slice(-6),['Método / Cuenta','Ingresos','Egresos','Fondo efectivo','Fondo digital','Acciones']);
    assert.equal(result.opening,'Bs 0.00');
    assert.doesNotMatch(result.text,/↑ Sube|↓ Baja/);
    assert.ok(result.text.includes('Ingreso de fondos'));assert.ok(!result.text.includes('INGRESOS DESDE CAJA GRANDE'));
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='Ingreso de fondos').click());
    await page.waitForSelector('.fund-action-modal');
    await assertOverlay('.fund-action-modal');
    assert.match(await page.$eval('.fund-action-modal-head',e=>e.textContent),/CAJA CHICA/);
    assert.match(await page.$eval('.fund-current-summary',e=>e.textContent),/Bs 420.00/);
    await page.click('.fund-action-modal-head .bigcash-report-close');
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.includes('+ Registrar gasto')).click());
    await page.waitForSelector('.accounting-movement-form');
    await assertOverlay('.accounting-movement-form');
    if(width!==1920) await page.waitForFunction(()=>[...document.querySelectorAll('.accounting-movement-form option')].some(e=>e.textContent==='Reparación de equipos'));
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.includes('+ Crear categoría')).click());
    await page.type('[aria-label="Nombre de la nueva categoría"]','Reparación de equipos');
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='Guardar categoría').click());
    await page.waitForFunction(()=>[...document.querySelectorAll('.accounting-movement-form select')].some(e=>e.selectedOptions[0]?.textContent==='Reparación de equipos'));
    await page.click('.accounting-movement-form .orders-modal-close');
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='Históricos').click());
    await page.waitForSelector('.fund-history-modal');
    await assertOverlay('.fund-history-modal');
    assert.equal(await page.$$eval('.fund-history-document',rows=>rows.length),2);
    assert.match(await page.$eval('.fund-history-head',e=>e.textContent),/CAJA CHICA/);
    await page.evaluate(()=>[...document.querySelectorAll('.fund-history-tabs button')].find(e=>e.textContent==='Rendiciones de cuentas').click());
    assert.equal(await page.$$eval('.fund-history-document',rows=>rows.length),1);
    const popupPromise=new Promise(resolve=>page.once('popup',resolve));
    await page.click('.fund-history-open-document');
    const popup=await popupPromise;
    await popup.waitForFunction(()=>document.body.textContent.includes('Entrega / rendición de fondos'));
    assert.match(await popup.$eval('.brand',e=>e.textContent),/CAJA CHICA/);
    await popup.close();
    await page.evaluate(()=>[...document.querySelectorAll('.fund-history-tabs button')].find(e=>e.textContent==='Ingresos fondos').click());
    await page.waitForFunction(()=>document.querySelector('.fund-history-open-document')?.textContent==='Ver recibo');
    const incomePopupPromise=new Promise(resolve=>page.once('popup',resolve));
    await page.click('.fund-history-open-document');
    const incomePopup=await incomePopupPromise;
    await incomePopup.waitForFunction(()=>document.body.textContent.includes('Recibo de ingreso de Caja Chica'));
    await incomePopup.close();
    console.log('Caja Chica verificada',width);
  }
  assert.deepEqual(errors,[]);
  for (const width of [1920,1440,1024]) {
    await page.setViewport({width,height:1000});
    await page.goto(server.resolvedUrls.local[0]+'petty-layout?long');
    await page.waitForFunction(()=>document.querySelectorAll('.petty-expenses-card tbody tr:not(.petty-opening-balance)').length===30);
    const layout=await page.evaluate(()=>{
      const wrap=document.querySelector('.petty-expenses-card .petty-table-wrap');
      return {overflow:getComputedStyle(wrap).overflowY, full:wrap.scrollHeight<=wrap.clientHeight+2,
        right:wrap.getBoundingClientRect().right,
        dates:[...wrap.querySelectorAll('tbody tr:not(.petty-opening-balance) td:first-child')].every(td=>getComputedStyle(td.querySelector('small')).display==='block'),
        cellsFit:[...wrap.querySelectorAll('td')].every(td=>td.scrollWidth<=td.clientWidth+2),
        clipped:[...wrap.querySelectorAll('td')].filter(td=>td.scrollWidth>td.clientWidth+2).slice(0,3).map(td=>({column:td.cellIndex,text:td.textContent,width:td.clientWidth,scroll:td.scrollWidth,html:td.innerHTML}))};
    });
    assert.equal(layout.overflow,'visible');assert.ok(layout.full);assert.ok(layout.right<=width);
    assert.ok(layout.dates);assert.ok(layout.cellsFit,JSON.stringify(layout.clipped));
    await page.evaluate(()=>window.scrollTo(0,document.querySelector('.petty-expenses-card table').getBoundingClientRect().top+scrollY+150));
    const headerTop=await page.$eval('.petty-expenses-card th',th=>th.getBoundingClientRect().top);
    assert.ok(Math.abs(headerTop)<2);
    console.log('Tabla completa de Caja Chica y encabezado fijo',width);
  }
  assert.deepEqual(errors,[]);
}finally{await browser?.close();await server.close();}
