import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lincoln-economic-edit-'));
process.env.LINCOLN_STATE_FILE=path.join(directory,'lincoln.json');process.env.APP_STATE_FILE=path.join(directory,'app.json');
const store=await import('./lincolnStateStore.js');
after(()=>fs.rm(directory,{recursive:true,force:true}));
beforeEach(async()=>{const saved=await store.getLincolnStateSnapshot();await store.replaceLincolnStateSnapshot({...saved.state,events:[{id:'event',code:'EVE-TEST',clientName:'Cliente',totalBs:10000}],payments:[],receipts:[],incomeEntries:[],expenseEntries:[],economicLedgerEntries:[],reservations:[],auditLog:[]},saved.revision);});
const revision=async()=>(await store.getLincolnStateSnapshot()).revision;
const payment=async(type='advance',amountBs=5000)=>store.registerLincolnEventPayment('event',{type,amountBs,date:'2026-10-07'},await revision());

test('complete receipt edit keeps identifiers and updates payment, receipt, cash, ledger and financial summary',async()=>{
  const created=await payment();
  await store.updateLincolnEconomicMovement(created.ledgerEntry.id,{type:'installment',amountBs:3000,date:'2026-09-02',receiptCode:'RCL-CORREGIDO',method:'qr',destination:'BANCO',payerName:'Pagador',clientName:'Cliente corregido',description:'Concepto corregido',reference:'QR123'},await revision(),{id:'editor'});
  const state=(await store.getLincolnStateSnapshot()).state;
  assert.equal(state.payments.length,1);assert.equal(state.receipts.length,1);assert.equal(state.payments[0].id,created.payment.id);assert.equal(state.receipts[0].id,created.receipt.id);
  for(const row of [state.payments[0],state.receipts[0],state.incomeEntries[0],state.economicLedgerEntries[0]]){assert.equal(row.amountBs,3000);assert.equal(row.date,'2026-09-02');assert.equal(row.method,'qr');assert.equal(row.destination,'BANCO');assert.equal(row.receiptCode,'RCL-CORREGIDO');}
  assert.equal(state.receipts[0].concept,'Concepto corregido');assert.equal(state.receipts[0].clientName,'Cliente corregido');assert.equal(state.events[0].financial.serviceBalanceBs,7000);
});
test('invalid allocation and duplicate receipt number fail atomically',async()=>{
  const first=await payment();const second=await payment();
  await assert.rejects(store.updateLincolnEconomicMovement(first.ledgerEntry.id,{amountBs:1000,type:'deposit',serviceAllocationBs:2000,date:'2026-10-07'},await revision()),/distribución/);
  await assert.rejects(store.updateLincolnEconomicMovement(first.ledgerEntry.id,{amountBs:1000,receiptCode:second.receipt.code,date:'2026-10-07'},await revision()),/ya existe/);
  assert.equal((await store.getLincolnStateSnapshot()).state.payments.find(row=>row.id===first.payment.id).amountBs,5000);
});
test('deleting an income removes it from active cash, receipt and ledger and updates balance',async()=>{
  const created=await payment();await store.deleteLincolnEconomicMovement(created.ledgerEntry.id,{},await revision());
  const state=(await store.getLincolnStateSnapshot()).state;
  assert.ok(state.payments[0].voidedAt);assert.equal(state.receipts[0].status,'voided');assert.ok(state.incomeEntries[0].voidedAt);assert.ok(state.economicLedgerEntries[0].voidedAt);assert.equal(state.events[0].financial.servicePaidBs,0);
});
test('legacy payment without ledger entry remains editable and deletable',async()=>{
  const created=await payment();let saved=await store.getLincolnStateSnapshot();saved.state.economicLedgerEntries=[];await store.replaceLincolnStateSnapshot(saved.state,saved.revision);
  const id=`legacy-${created.payment.id}`;
  await store.updateLincolnEconomicMovement(id,{amountBs:4000,date:'2026-10-07',receivedByName:'Personal corregido'},await revision());
  saved=await store.getLincolnStateSnapshot();assert.equal(saved.state.receipts[0].receivedByName,'Personal corregido');assert.equal(saved.state.events[0].financial.servicePaidBs,4000);
  await store.deleteLincolnEconomicMovement(id,{},saved.revision);assert.ok((await store.getLincolnStateSnapshot()).state.payments[0].voidedAt);
});
test('internal charges and notes can be edited and deleted',async()=>{
  const created=await store.registerLincolnEconomicLedgerEntry('event',{type:'charge',amountBs:100,note:'Cargo'},await revision());
  await store.updateLincolnEconomicMovement(created.ledgerEntry.id,{type:'charge',amountBs:200,note:'Cargo corregido'},await revision());
  assert.equal((await store.getLincolnStateSnapshot()).state.events[0].financial.replacementChargedBs,200);
  await store.deleteLincolnEconomicMovement(created.ledgerEntry.id,{},await revision());
  assert.equal((await store.getLincolnStateSnapshot()).state.events[0].financial.replacementChargedBs,0);
});
test('refund edits and deletions update the expense receipt and guarantee balance',async()=>{
  await payment('guarantee',500);
  const refund=await store.returnLincolnGuarantee('event',{amountBs:200},await revision());
  await store.updateLincolnEconomicMovement(refund.ledgerEntry.id,{amountBs:100,date:'2026-10-08',description:'Devolución corregida'},await revision());
  let state=(await store.getLincolnStateSnapshot()).state;assert.equal(state.expenseEntries[0].amountBs,100);assert.equal(state.events[0].financial.guaranteeHeldBs,400);
  await store.deleteLincolnEconomicMovement(refund.ledgerEntry.id,{},await revision());state=(await store.getLincolnStateSnapshot()).state;assert.ok(state.expenseEntries[0].voidedAt);assert.equal(state.events[0].financial.guaranteeHeldBs,500);
});
test('deleting a contract removes the event, voids linked cash and receipts and unlinks its reservation',async()=>{
  await payment();let saved=await store.getLincolnStateSnapshot();saved.state.events[0].reservationId='reservation';saved.state.reservations=[{id:'reservation',eventId:'event',status:'converted',reservationPaymentBs:500}];await store.replaceLincolnStateSnapshot(saved.state,saved.revision);
  await store.deleteLincolnContract('event',{reason:'Contrato de prueba'},await revision());const state=(await store.getLincolnStateSnapshot()).state;
  assert.equal(state.events.length,0);assert.ok(state.payments[0].voidedAt);assert.equal(state.receipts[0].status,'voided');assert.equal(state.reservations[0].status,'confirmed');assert.equal(state.reservations[0].eventId,null);assert.ok(state.auditLog.some(row=>row.action==='events.delete'));
});
