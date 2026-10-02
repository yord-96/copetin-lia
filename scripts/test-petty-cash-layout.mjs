import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import puppeteer from 'puppeteer-core';
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import AccountingSection from '/src/components/sections/AccountingSection.jsx';
import { api } from '/src/services/api.js';
import '/src/App.css';
import '/src/index.css';
const rows=[{id:'fund',cashBoxType:'PETTY_CASH',type:'ingreso',amountBs:500,description:'Fondo propio',fundBalanceBs:500,createdAt:'2026-10-02T15:00:00Z',cashLedgerSequence:1}, {id:'expense',cashBoxType:'PETTY_CASH',type:'egreso',amountBs:-80,description:'Pago propio',fundBalanceBs:420,createdAt:'2026-10-01T08:00:00Z',cashLedgerSequence:2}];
api.cash.getPettySector=async ({sector})=>({rows:sector==='expenses'?rows:[],total:sector==='expenses'?2:0,hasMore:false});
const formatBs=n=>'Bs '+Number(n).toFixed(2);
createRoot(document.getElementById('root')).render(<main className="app-main"><AccountingSection activeModule="contabilidad_caja_chica" cashMovements={rows} cashSummary={{pettyCashBalanceBs:420}} formatBs={formatBs} formatDate={v=>String(v??'')} formatDateTime={v=>String(v??'')} /></main>);
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
  for(const width of [1920,1440,1024]){
    await page.setViewport({width,height:1000});
    await page.goto(server.resolvedUrls.local[0]+'petty-layout');
    await page.waitForFunction(()=>document.querySelectorAll('.petty-expenses-card tbody tr').length===2);
    const result=await page.evaluate(()=>({headers:[...document.querySelectorAll('.petty-expenses-card th')].map(e=>e.textContent),funds:[...document.querySelectorAll('.petty-expenses-card .petty-fund-cell')].map(e=>e.textContent),text:document.body.textContent}));
    assert.equal(result.headers.at(-1),'Fondo'); assert.deepEqual(result.funds,['Bs 500.00','Bs 420.00']);
    assert.ok(result.text.includes('Ingreso de fondos'));assert.ok(!result.text.includes('INGRESOS DESDE CAJA GRANDE'));
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='Ingreso de fondos').click());
    await page.waitForSelector('.fund-action-modal');
    assert.match(await page.$eval('.fund-action-modal-head',e=>e.textContent),/CAJA CHICA/);
    assert.match(await page.$eval('.fund-current-summary',e=>e.textContent),/Bs 420.00/);
    console.log('Caja Chica verificada',width);
  }
  assert.deepEqual(errors,[]);
}finally{await browser?.close();await server.close();}
