import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {buildLincolnContractDocumentHtml} from '../server/services/lincoln/lincolnContractDocumentService.js';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lincoln-readable-pdf-'));
const snapshot={contractDate:'2026-10-07',contractor1Name:'Contratante de prueba',contractor2Name:'Segundo contratante',eventType:'BODA',eventDate:'2026-10-10',roomName:'SALÓN GRANDE',pricingGroups:[{variantId:'gold',name:'PLATINO',guestCount:250,pricePerPersonBs:230,selected:true}],services:Array.from({length:14},(_,index)=>({description:['Plato servido: 2 carnes, 3 guarniciones','Montaje de mesas con mantelería fina, sillas, cristalería y mesa principal'][index%2],category:['CATERING','BEBIDAS','MONTAJE','SONIDO','PERSONAL'][Math.floor(index/3)],selected:true})),extras:[{description:'Atención para niños',custom:true,costMode:'per_event',quantity:20,unitCostBs:100,selected:true}],advanceBs:5000,guaranteeBs:700,guaranteeStatus:'due'};
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium'),headless:true});
try {
  const page=await browser.newPage();await page.setViewport({width:816,height:1056});
  await page.setContent(buildLincolnContractDocumentHtml({event:{contractDocumentSnapshot:snapshot}}));
  const measurements=await page.$$eval('.page',nodes=>nodes.map(node=>({height:node.offsetHeight,overflow:node.scrollHeight>node.clientHeight})));
  assert.ok(measurements.every(page=>!page.overflow),JSON.stringify(measurements));
  assert.ok(measurements[0].height<=1056 && measurements[1].height<=1056,`Logical pages exceed Letter height: ${JSON.stringify(measurements)}`);
  assert.ok(await page.$eval('.clauses',node=>parseFloat(getComputedStyle(node).fontSize)>=14));
  const text=await page.$eval('body',node=>node.innerText);
  const normalizedText=text.normalize('NFKC').replace(/\s+/gu,' ').trim();
  assert.ok(normalizedText.includes('ESTADO GARANTÍA DEBE'),normalizedText);
  assert.ok(normalizedText.includes('TOTAL PENDIENTE Bs 55.200,00'),normalizedText);
  await page.screenshot({path:path.join(directory,'document.png'),fullPage:true});
  const pdf=await page.pdf({path:path.join(directory,'contract.pdf'),preferCSSPageSize:true,printBackground:true});
  assert.equal((Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,2);
  console.log('Verified readable print, guarantee debt segmentation and two-page standard contract without clipping:',directory);
} finally {await browser.close();}
