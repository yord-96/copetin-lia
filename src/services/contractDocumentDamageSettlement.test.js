import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractDocumentHtml } from './webBridge.js';

export const paidDamageContractFixture = () => {
  const items = [{itemId:'glass',lineKey:'glass',itemName:'VASO LARGO LISO',quantity:65,unitPriceBs:1.2,lineTotalBs:78}];
  const contract = {contractCode:'3659',customerName:'CLIENTE DE PRUEBA',items,totals:{totalBs:78,itemsSubtotalBs:78,guaranteeBs:72},economicLedger:[
    {id:'deposit',type:'deposit',amountBs:150,contractAllocationBs:78,guaranteeAllocationBs:72,isCashRegistered:true,cashMovementId:'income',cashReceiptCode:'RC-773',createdAt:'2026-11-20T18:53:00Z'},
    {id:'guarantee',type:'guarantee',amountBs:72,sourceDepositId:'deposit',createdAt:'2026-11-20T18:53:00Z'},
    {id:'application',type:'charge',amountBs:36,note:'Daños/faltantes aplicados contra la garantia de CLIENTE DE PRUEBA.',createdAt:'2026-11-22T14:00:00Z'},
    {id:'refund',type:'refund',amountBs:36,isCashRegistered:true,cashReceiptCode:'RC-14952',createdAt:'2026-11-22T14:04:00Z'},
  ]};
  const rental = {items,depositBs:0,totals:{totalBs:78},returnReport:[{itemId:'glass',lineKey:'glass',missingQty:2,missingUnitChargeBs:18,missingFeeBs:36,penaltyBs:36}],returnSettlement:{outstandingRentalBs:0,penaltiesBs:36,discountCoveredByDepositBs:0,pendingCollectionBs:36}};
  return {contract,rental,deliveries:[],settings:{}};
};

test('3659: guarantee application clears stale damage debt without adding cash or changing rental totals', () => {
  const fixture = paidDamageContractFixture();
  const before = structuredClone(fixture);
  const html = buildContractDocumentHtml(fixture);
  assert.match(html, /LIQUIDADO Y DEVUELTO/);
  assert.doesNotMatch(html, /TOTAL PENDIENTE Bs/);
  assert.doesNotMatch(html, /Daños \/ faltantes pendientes/);
  assert.match(html, /CANCELADO/);
  assert.deepEqual(fixture, before);
});

test('partial guarantee application leaves only the uncovered damage amount pending', () => {
  const fixture = paidDamageContractFixture();
  fixture.contract.economicLedger[2].amountBs = 18;
  const html = buildContractDocumentHtml(fixture);
  assert.match(html, /TOTAL PENDIENTE Bs\s*18,00/);
  assert.match(html, /PENDIENTE/);
});

test('pending, deleted and rental-only guarantee entries do not settle damages', () => {
  for (const patch of [{note:'Daños pendientes de pago'}, {deletedAt:'2026-11-23'}, {type:'guarantee_apply',applicationTarget:'rental',note:'Garantia aplicada al alquiler'}]) {
    const fixture = paidDamageContractFixture();
    Object.assign(fixture.contract.economicLedger[2], patch);
    assert.match(buildContractDocumentHtml(fixture), /TOTAL PENDIENTE Bs\s*36,00/);
  }
});

test('already reconciled return balances are not reduced twice', () => {
  const fixture = paidDamageContractFixture();
  fixture.rental.returnSettlement.pendingCollectionBs = 0;
  fixture.rental.returnSettlement.discountCoveredByDepositBs = 36;
  assert.match(buildContractDocumentHtml(fixture), /LIQUIDADO Y DEVUELTO/);
});
