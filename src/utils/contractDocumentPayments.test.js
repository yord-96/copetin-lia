import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileContractDocumentPayments} from './contractDocumentPayments.js';
import {buildContractDocumentHtml} from '../services/webBridge.js';

test('1179: tres recibos suman 30000, garantía 3000 y abono comercial 27000 sin duplicar el primer pago editado', () => {
  const contract={id:'contract',contractCode:'1179',totals:{totalBs:34253.5,itemsNetSubtotalBs:31053.5,guaranteeBs:3000},items:[],economicLedger:[
    {id:'first',type:'deposit',amountBs:20000,cashMovementId:'cash1',isCashRegistered:true,guaranteeAllocationBs:3000},
    {id:'guarantee',type:'guarantee',amountBs:3000,sourceDepositId:'first',reclassifiedFromPayment:true},
    {id:'second',type:'deposit',amountBs:5000,cashMovementId:'cash2',isCashRegistered:true},
  ]};
  const rental={id:'rental',payment:{pendingPaymentBs:9253.5}};
  const cash=[5000,5000,20000].map((amountBs,i)=>({id:`cash${i+1}`,cashBoxType:'BIG_CASH',linkedContractId:'contract',type:i===2?'ingreso_alquiler':'cobro_saldo_alquiler',amountBs,receiptCode:`RC-${i+1}`}));
  cash.push({id:'foreign',cashBoxType:'BIG_CASH',linkedContractId:'other',type:'ingreso_alquiler',amountBs:900});
  const result=reconcileContractDocumentPayments(contract,rental,cash);
  assert.equal(result.receivedBs,30000); assert.equal(result.reservedBs,3000); assert.equal(result.appliedBs,27000);
  assert.equal(result.ledger.filter(row=>row.type==='deposit').length,3);
  assert.equal(contract.economicLedger[0].amountBs,20000);
  const html=buildContractDocumentHtml({contract,rental,cashMovements:cash,deliveries:[],settings:{},items:[]}).replace(/\s|&nbsp;/g,'');
  assert.match(html,/<small>Pagadoacuentadelcontrato<\/small><strong>Bs27[.,]000[.,]00/);
  assert.match(html,/<small>Faltapagardelcontrato<\/small><strong>Bs7[.,]253[.,]50/);
  assert.match(html,/<span>Acobrar<\/span><strong>Bs7[.,]253[.,]50/);
  assert.ok(html.includes('RC-3'));
});

test('un excedente guardado no oculta el pago: 38078.50 recibidos contra 34253.50 deja 825 a favor después de garantía pendiente', () => {
  const contract={id:'contract',totals:{totalBs:34253.5,itemsNetSubtotalBs:31053.5,guaranteeBs:3000},items:[],economicLedger:[
    {id:'first',type:'deposit',amountBs:5000,isCashRegistered:true},
    {id:'second',type:'deposit',amountBs:5000,isCashRegistered:true},
    {id:'third',type:'deposit',amountBs:28078.5,isCashRegistered:true,contractAllocationBs:0,surplusAllocationBs:28078.5},
  ]};
  const result=reconcileContractDocumentPayments(contract,{});
  assert.equal(result.receivedBs,38078.5); assert.equal(result.appliedBs,38078.5);
  const html=buildContractDocumentHtml({contract,rental:{},deliveries:[],settings:{},items:[]}).replace(/\s|&nbsp;/g,'');
  assert.match(html,/<small>Saldoafavordelcliente<\/small><strong>Bs825[.,]00/);
  assert.match(html,/<span>Excedenteafavordelcliente<\/span><strong>Bs825[.,]00/);
  assert.doesNotMatch(html,/PENDIENTETOTAL/);
});
