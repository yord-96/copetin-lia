import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewAllContractPayments, repairAllVerifiedContractPayments } from './review-all-contract-payments.mjs';
const fixture = () => ({contracts:[{id:'c',contractCode:'123',totals:{totalBs:80},economicLedger:[{id:'deposit',type:'deposit',amountBs:0,cashMovementId:'original',guaranteeAllocationBs:20},{id:'reserve',type:'guarantee',amountBs:20,sourceDepositId:'deposit'}]}],cashMovements:[
 {id:'original',receiptCode:'RC-1',cashBoxType:'BIG_CASH',linkedContractId:'c',type:'ingreso_alquiler',amountBs:100,voidedAt:'old',voidReason:'Anulado por cobro duplicado del contrato 123'},
 {id:'replacement',receiptCode:'RC-2',cashBoxType:'BIG_CASH',linkedContractId:'c',type:'ingreso_alquiler',amountBs:80,accountingTag:'initial_rental_payment'},
 {id:'guarantee',receiptCode:'RC-3',cashBoxType:'BIG_CASH',linkedContractId:'c',type:'ingreso_garantia',amountBs:20,accountingTag:'validated_guarantee'},
 {id:'refund',linkedContractId:'c',amountBs:-20,accountingTag:'guarantee_refund'}]});
test('restores the original receipt, preserves cash and refund, and is idempotent',()=>{
 const s=fixture(),refund=structuredClone(s.cashMovements.at(-1));
 const net=()=>s.cashMovements.filter(m=>!m.voidedAt&&m.receiptStatus!=='anulado').reduce((sum,m)=>sum+m.amountBs,0);
 const before=net();assert.equal(repairAllVerifiedContractPayments(s).repairable,1);
 assert.equal(net(),before);assert.deepEqual(s.cashMovements.at(-1),refund);
 assert.equal(s.contracts[0].economicLedger[0].amountBs,100);
 const saved=structuredClone(s);assert.equal(repairAllVerifiedContractPayments(s).repairable,0);assert.deepEqual(s,saved);
});
test('different amounts and undocumented cancellations remain unchanged',()=>{
 for(const mutate of [s=>s.cashMovements[1].amountBs=81,s=>s.cashMovements[0].voidReason='Correccion manual']){
  const s=fixture();mutate(s);const before=structuredClone(s);
  assert.equal(repairAllVerifiedContractPayments(s).requiresReview,1);assert.deepEqual(s,before);
 }
});
test('a receipt referenced by another contract cannot be restored automatically',()=>{
 const s=fixture();s.contracts.push({id:'other',contractCode:'456',economicLedger:[{id:'other-payment',type:'deposit',amountBs:100,cashMovementId:'original'}]});
 assert.equal(reviewAllContractPayments(s).repairable,0);
});
