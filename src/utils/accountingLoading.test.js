import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import express from 'express';

test('apertura compacta conserva todo el fondo y el servidor entrega días completos fuera de las 100 filas recientes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'copetin-opening-'));
  process.env.APP_STATE_FILE=path.join(directory,'state.json');
  process.env.APP_INTERNAL_KEY='test-opening';
  let server;
  try {
    const row=(id,amount,date,box='BIG_CASH')=>({id,amountBs:amount,cashBoxType:box,type:amount>=0?'ingreso':'egreso',cashEffectiveDate:date,createdAt:date+'T16:00:00Z',paymentMethod:'efectivo',receiptDetail:'x'.repeat(10000)});
    const movements=Array.from({length:150},(_,index)=>row('history-'+index,1,'2026-09-01'));
    movements.push({...row('fund',5000,'2026-10-01'),category:'ingreso_fondos'},row('old-refund',-200,'2026-10-01'));
    movements.push({...row('qr',18,'2026-10-02'),paymentMethod:'qr'});
    movements.push(row('late-refund',-100,'2026-10-01'));
    for(let index=0;index<110;index++)movements.push(row('petty-'+index,1,'2026-10-02','PETTY_CASH'));
    await fs.writeFile(process.env.APP_STATE_FILE,JSON.stringify({version:1,state:{cashMovements:movements, cashDebts:[],cashSessions:[{id:'petty-session',cashBoxType:'PETTY_CASH',status:'open'}],settings:{}}}));
    const app=express();app.use(express.json());app.use((await import('../../server/routes/state.js')).default);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const get=async url=>{
      const response=await fetch(`http://127.0.0.1:${server.address().port}/__copetin_db${url}`,{headers:{'X-App-Internal-Key':'test-opening'}});
      assert.equal(response.status,200);
      return response.json();
    };
    const opening=await get('/accounting/opening-overview');
    assert.ok(opening.movements.some(row=>row.id==='fund'));
    assert.equal(opening.summary.bigCashBalanceBs,4868);
    assert.equal(opening.summary.pettyCashBalanceBs,110);
    assert.equal(opening.summary.activeSession.id,'petty-session');
    assert.ok(opening.movements.every(row=>row.receiptDetail===undefined));
    assert.ok(JSON.stringify(opening).length<50000);
    assert.equal(opening.truncated,true);
    const cached=await get('/accounting/opening-overview');
    assert.deepEqual(cached,opening);
    const historical=await get('/accounting/daily-report?date=2026-09-01');
    assert.equal(historical.movements.length,150);
    const daily=await get('/accounting/daily-report?date=2026-10-02');
    assert.equal(daily.openingBalance.cashBs,4700);
    assert.equal(daily.movements.length,1);
    assert.equal(daily.fundByMovementId.qr.cashBs,4700);
    assert.equal(daily.fundByMovementId.qr.digitalBs,18);
    const store=await import('../../server/storage/fileStateStore.js');
    await store.updateStateSnapshot(state=>{state.cashMovements.push(row('new',25,'2026-10-02'));return state;});
    const refreshed=await get('/accounting/opening-overview');
    assert.notEqual(refreshed.revision,opening.revision);
    assert.equal(refreshed.summary.bigCashBalanceBs,4893);
    const updatedDaily=await get('/accounting/daily-report?date=2026-10-02');
    assert.equal(updatedDaily.fundByMovementId.new.cashBs,4725);
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    await fs.rm(directory,{recursive:true,force:true});
  }
});
