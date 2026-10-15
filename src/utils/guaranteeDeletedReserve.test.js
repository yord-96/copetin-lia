import test from 'node:test';
import assert from 'node:assert/strict';
import {getActiveEconomicLedger,getGuaranteeLedgerEvidence,calculateGuaranteeSettlement} from './guaranteeSettlement.js';
test('2835: deleted 200 reserve must not inflate active 350 reserve after a 200 refund',()=>{
 const contract={economicLedger:[
  {id:'first',type:'deposit',amountBs:200,cashMovementId:'cash-first'},
  {id:'old-reserve',type:'guarantee',amountBs:200,sourceDepositId:'first',reclassifiedFromPayment:true,deletedAt:'2026-10-08'},
  {id:'second',type:'deposit',amountBs:1271,guaranteeAllocationBs:350,cashMovementId:'cash-second'},
  {id:'reserve',type:'guarantee',amountBs:350,sourceDepositId:'second',reclassifiedFromPayment:true},
  {id:'refund',type:'refund',amountBs:200,refundSource:'guarantee',isCashRegistered:false,cashMovementId:'cash-refund'},
 ]};
 const active=getActiveEconomicLedger(contract);
 assert.equal(active.filter(e=>e.type==='guarantee').reduce((s,e)=>s+e.amountBs,0),350);
 const evidence=getGuaranteeLedgerEvidence({...contract,economicLedger:active});
 assert.equal(evidence.paidBs,350);assert.equal(evidence.refundedBs,200);
 assert.equal(calculateGuaranteeSettlement(evidence).pendingRefundBs,150);
});
