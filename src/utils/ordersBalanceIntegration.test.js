import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import express from 'express';

test('Órdenes entrega al listado 27000 pagados al contrato con garantía separada', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'copetin-orders-balance-'));
  process.env.APP_STATE_FILE = path.join(directory,'state.json');
  process.env.APP_INTERNAL_KEY = 'orders-test';
  let server;
  try {
    const contract = {id:'contract',contractCode:'1179',rentalId:'rental',status:'aprobado',totals:{totalBs:34253.5,guaranteeBs:3000},economicLedger:[
      {id:'first',type:'deposit',amountBs:20000,cashMovementId:'cash1',isCashRegistered:true,guaranteeAllocationBs:3000},
      {id:'reserve',type:'guarantee',amountBs:3000,sourceDepositId:'first',reclassifiedFromPayment:true},
      {id:'second',type:'deposit',amountBs:5000,cashMovementId:'cash2',isCashRegistered:true},
    ]};
    const cashMovements = [5000,5000,20000].map((amountBs,i)=>({id:`cash${i+1}`,linkedContractId:'contract',cashBoxType:'BIG_CASH',type:i===2?'ingreso_alquiler':'cobro_saldo_alquiler',amountBs,receiptCode:`RC-${i+1}`,createdAt:'2026-10-05T12:00:00Z'}));
    await fs.writeFile(process.env.APP_STATE_FILE,JSON.stringify({version:1,state:{contracts:[contract],cashMovements,rentals:[],settings:{}}}));
    const app = express(); app.use((await import('../../server/routes/state.js')).default);
    server = app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/__copetin_db/orders/mobile-overview`,{headers:{'X-App-Internal-Key':'orders-test'}});
    const result = await response.json();
    assert.equal(response.status,200);
    assert.equal(result.overview.contracts[0].economicCashSummary.contractPaidBs,27000);
    assert.equal(result.overview.contracts[0].totals.totalBs-result.overview.contracts[0].economicCashSummary.contractPaidBs,7253.5);
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    await fs.rm(directory,{recursive:true,force:true});
  }
});

