import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { buildContractDocumentHtml } from './webBridge.js';
import { prepareContractBookReport } from '../utils/contractBookReport.js';
import { buildContractBookWorkbook } from '../utils/contractBookWorkbook.js';

const fixture = () => ({contract:{id:'contract',contractCode:'3701',customerName:'CLIENTE PRUEBA',address:'DIRECCION DE PRUEBA',items:[
  {itemId:'chair',itemName:'SILLA',quantity:18,unitPriceBs:10,lineTotalBs:180,comboLineKey:'package'},
  {itemId:'cushion',itemName:'COJIN',quantity:18,unitPriceBs:0,lineTotalBs:0,comboLineKey:'package'},
],totals:{totalBs:180,itemsSubtotalBs:180,guaranteeBs:100}},rental:{},deliveries:[],settings:{}});

test('book Excel uses the same compact rows, numeric amounts and guarantee as the printable report', async () => {
  const source = fixture();
  const report = buildContractDocumentHtml({...source,documentKind:'book',bookOutput:'data'});
  const before = structuredClone(report);
  const compact = prepareContractBookReport(report);
  const workbook = await buildContractBookWorkbook(report);
  const sheet = workbook.worksheets[0];
  assert.equal(compact.compact.length,1);
  assert.equal(sheet.getCell('B6').value,'SILLA + COJIN');
  assert.equal(sheet.getCell('C6').value,18);
  assert.equal(sheet.getCell('D6').value,10);
  assert.equal(sheet.getCell('E6').value,180);
  const summary = [];
  sheet.eachRow(row => {if(String(row.getCell(1).value).startsWith('TOTAL GENERAL')) summary.push(row.getCell(5).value);});
  assert.equal(summary[0].result,280);
  assert.match(summary[0].formula,/^E\d+\+E\d+$/);
  assert.deepEqual(report,before);
  const {default:ExcelJS} = await import('exceljs');
  const reopened = new ExcelJS.Workbook();await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.equal(reopened.worksheets[0].getCell('E6').value,180);
  assert.match(buildContractDocumentHtml({...source,documentKind:'book'}),/width: 185mm/);
});

test('Excel keeps repeated combos separate for each day and includes daily services', async () => {
  const source=fixture();
  source.contract.pricingPlan={mode:'daily_schedule',scheduleDays:[{id:'d1',label:'Dia 1',date:'2026-12-04'},{id:'d2',label:'Dia 2',date:'2026-12-05'}]};
  source.contract.items=source.contract.pricingPlan.scheduleDays.flatMap(day=>fixture().contract.items.map(row=>({...row,serviceDayId:day.id})));
  source.contract.services=[{id:'transport',name:'TRANSPORTE',quantity:1,unitPriceBs:60,serviceDayId:'d2'}];
  source.contract.totals={itemsSubtotalBs:360,servicesSubtotalBs:60,totalBs:420,guaranteeBs:100};
  const report=buildContractDocumentHtml({...source,documentKind:'book',bookOutput:'data'});
  const workbook=await buildContractBookWorkbook(report);const sheet=workbook.worksheets[0];
  const descriptions=[];const days=[];
  sheet.eachRow(row=>{if(typeof row.getCell(1).value==='number')descriptions.push(row.getCell(2).value);if(String(row.getCell(1).value).startsWith('Dia '))days.push(row.getCell(1).value);});
  assert.deepEqual(descriptions,['SILLA + COJIN','SILLA + COJIN','SERVICIO: TRANSPORTE']);
  assert.match(days[0],/04\/12\/2026.*180.00/);assert.match(days[1],/05\/12\/2026.*240.00/);
});

test('book Excel download is protected and exports the full authoritative contract', async () => {
  const {default:express} = await import('express');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'copetin-book-export-'));
  process.env.APP_STATE_FILE=path.join(directory,'state.json');process.env.APP_INTERNAL_KEY='book-export-test';
  let server;
  try {
    await fs.writeFile(process.env.APP_STATE_FILE,JSON.stringify({version:1,state:{contracts:[fixture().contract],rentals:[],deliveries:[],items:[],settings:{}}}));
    const app=express();app.use((await import('../../server/routes/documents.js')).default);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const url=`http://127.0.0.1:${server.address().port}/__copetin_db/contracts/contract/book.xlsx`;
    assert.equal((await fetch(url)).status,401);
    const response=await fetch(url,{headers:{'X-App-Internal-Key':'book-export-test'}});
    assert.equal(response.status,200);
    assert.match(response.headers.get('Content-Type'),/spreadsheetml/);
    const {default:ExcelJS}=await import('exceljs');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await response.arrayBuffer());
    assert.equal(workbook.worksheets[0].getCell('B6').value,'SILLA + COJIN');
  } finally {if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
});
