import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileContractDocumentPayments} from './contractDocumentPayments.js';
import {buildContractDocumentHtml} from '../services/webBridge.js';

test('1836: el historial inicial y RC-0327 representan un solo ingreso de 440', () => {
  const contract = { id: '1836-id', contractCode: '1836', totals: { totalBs: 940 }, items: [],
    economicLedger: [{ id: 'initial-payment-1836-id', type: 'deposit', amountBs: 440,
      createdAt: '2026-07-21', paymentMethod: 'efectivo', note: 'PAGO INICIAL' }] };
  const cash = [{ id: 'cash', linkedContractId: contract.id, cashBoxType: 'BIG_CASH',
    type: 'ingreso_alquiler', amountBs: 440, receiptCode: 'RC-0327',
    accountingTag: 'initial_rental_payment', createdAt: '2026-07-21T23:06:15.330Z' }];
  const result = reconcileContractDocumentPayments(contract, {}, cash);
  assert.equal(result.ledger.length, 1);
  assert.equal(result.ledger[0].cashReceiptCode, 'RC-0327');
  assert.equal(result.receivedBs, 440);
  assert.equal(result.appliedBs, 440);
  assert.equal(940 - result.appliedBs, 500);
  assert.equal(contract.economicLedger[0].cashMovementId, undefined);
  // Editing the initial receipt date or amount retains its identity.
  const edited = reconcileContractDocumentPayments(contract, {}, [{ ...cash[0], amountBs: 450,
    receiptIssuedAt: '2025-07-21' }]);
  assert.equal(edited.ledger.length, 1);
  assert.equal(edited.receivedBs, 450);
});

test('pagos iguales en otros dias y recibos explicitamente enlazados no se fusionan', () => {
  const contract = { id: 'contract', economicLedger: [
    { id: 'legacy', type: 'deposit', amountBs: 440, createdAt: '2026-07-20' },
    { id: 'linked', type: 'deposit', amountBs: 440, createdAt: '2026-07-21', cashMovementId: 'cash' },
  ] };
  const cash = [{ id: 'cash', linkedContractId: 'contract', cashBoxType: 'BIG_CASH',
    type: 'abono', amountBs: 440, receiptCode: 'RC-1', createdAt: '2026-07-21' }];
  const result = reconcileContractDocumentPayments(contract, {}, cash);
  assert.equal(result.ledger.length, 2);
  assert.equal(result.ledger[0].cashMovementId, undefined);
  assert.equal(result.receivedBs, 440);
});

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
