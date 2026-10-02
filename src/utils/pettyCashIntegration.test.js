import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import express from 'express';

test('migración única y API: Caja Chica empieza en cero, se financia sola y no modifica Caja Grande', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'copetin-petty-'));
  process.env.APP_STATE_FILE=path.join(directory,'state.json');
  process.env.APP_INTERNAL_KEY='test-petty-key';
  let server;
  try {
    const big={id:'big',cashBoxType:'BIG_CASH',type:'ingreso',amountBs:5000,createdAt:'2026-10-01T19:00:00Z'};
    await fs.writeFile(process.env.APP_STATE_FILE,JSON.stringify({version:1,state:{cashMovements:[big,{id:'old',cashBoxType:'PETTY_CASH',amountBs:150}],cashSessions:[{id:'shared',status:'open'}],cashDebts:[],supplierLoans:[{id:'old-loan'}],settings:{}}}));
    const store=await import('../../server/storage/fileStateStore.js');
    const {runPettyCashSeparation}=await import('../../server/migrations/separatePettyCash.js');
    await runPettyCashSeparation();
    let snapshot=await store.getStateSnapshot();
    assert.equal(snapshot.state.cashMovements[0].amountBs,5000);
    assert.equal(snapshot.state.cashMovements[1].accountingPeriodStatus,'archived');
    const backup=JSON.parse(await fs.readFile(snapshot.state.settings.accounting.pettyResetBackup,'utf8'));
    assert.equal(backup.state.cashMovements[1].amountBs,150);
    const app=express(); app.use(express.json());
    app.use((await import('../../server/routes/state.js')).default);
    server=app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}/__copetin_db`;
    const request=async (url,payload)=> {
      const response=await fetch(base+url,{method:payload?'POST':'GET',headers:{'Content-Type':'application/json','X-App-Internal-Key':'test-petty-key'},...(payload?{body:JSON.stringify(payload)}:{})});
      return {status:response.status,body:await response.json()};
    };
    const payload={cashBoxType:'PETTY_CASH',description:'Fondo propio',createdBy:'Admin',category:'ingreso_fondos',paymentMethod:'efectivo',type:'ingreso',amountBs:300};
    const income=await request('/cash/movement',payload);
    assert.equal(income.status,200,JSON.stringify(income.body));
    assert.equal(income.body.summary.pettyCashBalanceBs,300);
    assert.equal(income.body.summary.bigCashBalanceBs,5000);
    const expense=await request('/cash/movement',{...payload,type:'egreso',category:'entrega_fondos',amountBs:80,description:'Entrega propia',createdAt:'2026-09-01T12:00:00Z'});
    assert.equal(expense.status,200,JSON.stringify(expense.body));
    assert.equal(expense.body.summary.pettyCashBalanceBs,220);
    assert.equal(expense.body.summary.bigCashBalanceBs,5000);
    const rejected=await request('/cash/movement',{...payload,type:'transferencia'});
    assert.equal(rejected.status,400);
    const excessive=await request('/cash/movement',{...payload,type:'egreso',amountBs:221});
    assert.equal(excessive.status,400);
    const wrongChannel=await request('/cash/movement',{...payload,type:'egreso',amountBs:10,paymentMethod:'qr',paymentAccount:'CIDRE'});
    assert.equal(wrongChannel.status,400);
    const rows=await request('/accounting/petty-sector?sector=expenses');
    assert.equal(rows.body.total,2);
    assert.equal(rows.body.rows.find(row=>row.id===income.body.movement.id).fundBalanceBs,300);
    assert.equal(rows.body.rows.find(row=>row.id===expense.body.movement.id).fundBalanceBs,220);
    const suppliers=await request('/accounting/petty-sector?sector=suppliers');
    assert.equal(suppliers.body.total,0);
    await runPettyCashSeparation();
    snapshot=await store.getStateSnapshot();
    assert.equal(snapshot.state.resetLogs.length,1);
    assert.equal(snapshot.state.cashMovements.filter(row=>row.accountingPeriodStatus!=='archived'&&row.cashBoxType==='PETTY_CASH').length,2);
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    await fs.rm(directory,{recursive:true,force:true});
  }
});
