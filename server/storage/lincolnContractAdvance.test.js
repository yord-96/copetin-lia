import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lincoln-advance-test-'));
process.env.LINCOLN_STATE_FILE=path.join(directory,'lincoln.json');
process.env.APP_STATE_FILE=path.join(directory,'app.json');
const store=await import('./lincolnStateStore.js');
after(()=>fs.rm(directory,{recursive:true,force:true}));

test('wizard advance generates payment, receipt, cash income and ledger atomically without duplicates',async()=>{
  const snapshot=await store.getLincolnStateSnapshot();
  const created=await store.createLincolnRecord('events',{clientName:'Cliente de prueba',totalBs:57500,contractDocumentSnapshot:{advanceBs:5000,contractDate:'2026-10-07',advanceMethod:'qr'}},snapshot.revision,{id:'tester',name:'Prueba'});
  let saved=await store.getLincolnStateSnapshot();
  assert.equal(saved.state.payments.length,1);assert.equal(saved.state.receipts.length,1);assert.equal(saved.state.incomeEntries.length,1);assert.equal(saved.state.economicLedgerEntries.length,1);
  assert.equal(saved.state.payments[0].serviceAllocationBs,5000);assert.equal(saved.state.receipts[0].method,'qr');
  assert.equal(created.record.financial.serviceBalanceBs,52500);
  await store.updateLincolnRecord('events',created.record.id,{contractDocumentSnapshot:{advanceBs:5000}},saved.revision);
  saved=await store.getLincolnStateSnapshot();assert.equal(saved.state.payments.length,1);
  await store.voidLincolnPayment(saved.state.payments[0].id,{reason:'Prueba de anulación'},saved.revision);
  saved=await store.getLincolnStateSnapshot();
  await store.updateLincolnRecord('events',created.record.id,{notes:'Editar sin volver a cobrar'},saved.revision);
  saved=await store.getLincolnStateSnapshot();assert.equal(saved.state.payments.length,1);assert.ok(saved.state.payments[0].voidedAt);
});
test('saving an older contract repairs its unregistered advance, considering payments already present',async()=>{
  let saved=await store.getLincolnStateSnapshot();
  const state={...saved.state,events:[{id:'legacy',code:'EVE-LEGACY',clientName:'Prueba',totalBs:10000,contractDocumentSnapshot:{advanceBs:5000}}],payments:[],receipts:[],incomeEntries:[],economicLedgerEntries:[]};
  await store.replaceLincolnStateSnapshot(state,saved.revision);saved=await store.getLincolnStateSnapshot();
  await store.registerLincolnEventPayment('legacy',{type:'advance',amountBs:2000},saved.revision);saved=await store.getLincolnStateSnapshot();
  await store.updateLincolnRecord('events','legacy',{contractDocumentSnapshot:{advanceBs:5000}},saved.revision);saved=await store.getLincolnStateSnapshot();
  assert.deepEqual(saved.state.payments.map(row=>row.amountBs).sort((a,b)=>a-b),[2000,3000]);
  assert.equal(saved.state.events[0].financial.servicePaidBs,5000);
});

test('guarantee marked PAGADO generates its own receipt and is not duplicated on save',async()=>{
  let saved=await store.getLincolnStateSnapshot();
  const created=await store.createLincolnRecord('events',{
    clientName:'Cliente garantía',totalBs:10000,guaranteeBs:700,
    contractDocumentSnapshot:{advanceBs:0,guaranteeBs:700,guaranteeStatus:'paid',guaranteeMethod:'cash',guaranteeDestination:'CAJA CHICA',contractDate:'2026-10-07'}
  },saved.revision,{id:'tester',name:'Prueba'});
  saved=await store.getLincolnStateSnapshot();
  const guaranteePayments=saved.state.payments.filter(row=>row.eventId===created.record.id && row.type==='guarantee');
  assert.equal(guaranteePayments.length,1);
  assert.equal(guaranteePayments[0].amountBs,700);
  assert.equal(guaranteePayments[0].guaranteeAllocationBs,700);
  assert.equal(saved.state.receipts.find(row=>row.id===guaranteePayments[0].receiptId)?.amountBs,700);
  assert.equal(saved.state.events.find(row=>row.id===created.record.id)?.financial.guaranteePendingBs,0);
  await store.updateLincolnRecord('events',created.record.id,{notes:'Guardar otra vez'},saved.revision);
  saved=await store.getLincolnStateSnapshot();
  assert.equal(saved.state.payments.filter(row=>row.eventId===created.record.id && row.type==='guarantee').length,1);
});

test('guarantee marked DEBE does not create receipt and remains segmented as pending',async()=>{
  let saved=await store.getLincolnStateSnapshot();
  const created=await store.createLincolnRecord('events',{
    clientName:'Cliente deuda garantía',totalBs:10000,guaranteeBs:700,
    contractDocumentSnapshot:{advanceBs:1000,guaranteeBs:700,guaranteeStatus:'due',contractDate:'2026-10-07'}
  },saved.revision,{id:'tester',name:'Prueba'});
  saved=await store.getLincolnStateSnapshot();
  const event=saved.state.events.find(row=>row.id===created.record.id);
  assert.equal(saved.state.payments.filter(row=>row.eventId===created.record.id && row.type==='guarantee').length,0);
  assert.equal(event.financial.serviceBalanceBs,9000);
  assert.equal(event.financial.guaranteePendingBs,700);
});
