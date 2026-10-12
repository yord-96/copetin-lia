import test from 'node:test';
import assert from 'node:assert/strict';
import { repairOriginalPayments } from './repair-contracts-2048-2277.mjs';
import { reconcileContractDocumentPayments } from '../src/utils/contractDocumentPayments.js';
import { createOrdersCashIndex } from '../server/services/ordersCashIndex.js';
const fixture = () => {
 const state={contracts:[],cashMovements:[]};
 for(const [code,total,originals,generated] of [['2048',104,[['RC-5865',104,104,0]],[['RC-5882',104,'initial_rental_payment']]],['2277',1272,[['RC-12492',1280,1080,200],['RC-12493',192,192,0]],[['RC-12746',1272,'initial_rental_payment'],['RC-12747',200,'validated_guarantee']]]]) {
  const c={id:code,contractCode:code,totals:{totalBs:total},economicLedger:[]};state.contracts.push(c);
  for(const [receipt,amount,commercial,guarantee] of originals){state.cashMovements.push({id:receipt,receiptCode:receipt,amountBs:amount,cashBoxType:'BIG_CASH',linkedContractId:code,type:'ingreso_alquiler',voidedAt:'old'});c.economicLedger.push({id:'eco-'+receipt,type:'deposit',cashMovementId:receipt,cashReceiptCode:receipt,isCashRegistered:true,amountBs:receipt==='RC-12492'?0:amount,contractAllocationBs:commercial,guaranteeAllocationBs:guarantee});if(guarantee)c.economicLedger.push({id:'guarantee',type:'guarantee',amountBs:guarantee,sourceDepositId:'eco-'+receipt});}
  for(const [receipt,amount,tag] of generated)state.cashMovements.push({id:receipt,receiptCode:receipt,amountBs:amount,cashBoxType:'BIG_CASH',linkedContractId:code,type:tag==='validated_guarantee'?'ingreso_garantia':'ingreso_alquiler',accountingTag:tag});
 }
 state.cashMovements.push({id:'refund',type:'egreso_manual',amountBs:-200,linkedContractId:'2277',accountingTag:'guarantee_refund'});
 return state;
};
test('voided original and cash replacement do not produce a second payment, with full or indexed data',()=>{
 const s=fixture(); const index=createOrdersCashIndex(s.cashMovements);
 for(const c of s.contracts){const full=reconcileContractDocumentPayments(c,null,s.cashMovements);assert.equal(full.appliedBs,c.totals.totalBs);assert.equal(reconcileContractDocumentPayments(c,null,index(c)).appliedBs,c.totals.totalBs);assert.equal(reconcileContractDocumentPayments(c,null,s.cashMovements.filter(row=>!row.voidedAt)).appliedBs,c.totals.totalBs);}
});
test('repair restores original deposits and preserves received net cash and guarantee refund; rerun is idempotent',()=>{
 const s=fixture();const total=()=>s.cashMovements.filter(row=>!row.voidedAt&&row.receiptStatus!=='anulado').reduce((sum,row)=>sum+row.amountBs,0); const before=total();const refund=structuredClone(s.cashMovements.at(-1));
 repairOriginalPayments(s,'2026-10-12');assert.equal(total(),before);assert.deepEqual(s.cashMovements.at(-1),refund);
 assert.equal(s.contracts[1].economicLedger[0].amountBs,1280);
 for(const c of s.contracts)assert.equal(reconcileContractDocumentPayments(c,null,s.cashMovements).appliedBs,c.totals.totalBs);
 const snapshot=structuredClone(s);assert.ok(repairOriginalPayments(s).every(row=>row.status==='already_applied'));assert.deepEqual(s,snapshot);
});
