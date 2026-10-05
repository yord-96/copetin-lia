import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractDocumentHtml } from './webBridge.js';

test('contrato diario incluye cobertura manual en el día correcto sin duplicar cobertura normal', () => {
  const days = [1,2,3].map(n => ({id:`day-${n}`,label:`Dia ${n}`,date:`2026-10-${9+n}`}));
  const items = [18198,9405.5,3450].map((amount,n) => ({lineKey:`line-${n}`,itemId:`item-${n}`,itemName:`Material ${n}`,quantity:1,unitPriceBs:amount,lineTotalBs:amount,serviceDayId:days[n].id,serviceDate:days[n].date}));
  const supplierFulfillmentPlan = [
    {lineKey:'line-0',itemId:'item-0',supplierId:'supplier',neededQty:50,saleUnitPriceBs:12,manualCoverage:true},
    {lineKey:'line-2',itemId:'item-2',supplierId:'supplier',neededQty:5,saleUnitPriceBs:45,manualCoverage:true},
    {lineKey:'line-1',itemId:'item-1',supplierId:'supplier',neededQty:1,saleUnitPriceBs:100,manualCoverage:false},
  ];
  const contract = {contractCode:'1179',items,supplierFulfillmentPlan:supplierFulfillmentPlan.map(line => ({...line,itemName:'Material',supplierName:'Proveedor'})),pricingPlan:{mode:'daily_schedule',days:3,scheduleDays:days},totals:{itemsNetSubtotalBs:31878.5,itemsGrossSubtotalBs:32266,itemDiscountsBs:387.5,totalBs:35078.5,deliveryFeeBs:3200}};
  const html = buildContractDocumentHtml({contract,rental:{items},deliveries:[],settings:{},items:[]}).replace(/\s|&nbsp;/g,'');
  assert.match(html,/<span>Dia1<\/span><strong>Bs18[.,]798[.,]00<\/strong>/);
  assert.match(html,/<span>Dia2<\/span><strong>Bs9[.,]405[.,]50<\/strong>/);
  assert.match(html,/<span>Dia3<\/span><strong>Bs3[.,]675[.,]00<\/strong>/);
  assert.match(html,/<span>Totaldelosdías<\/span><strong>Bs31[.,]878[.,]50<\/strong>/);
  assert.match(html,/<span>Descuentoyaincluidoenlosdías<\/span><strong>Bs387[.,]50<\/strong>/);
  assert.doesNotMatch(html,/<span>Items<\/span><strong>Bs32[.,]266/);
  const withoutManual = {...contract,supplierFulfillmentPlan:[],totals:{...contract.totals,itemsGrossSubtotalBs:31441,itemsNetSubtotalBs:31053.5,totalBs:34253.5}};
  for (const documentKind of ['contract','quote']) {
    const updated = buildContractDocumentHtml({contract:withoutManual,rental:{items},deliveries:[],settings:{},items:[],documentKind}).replace(/\s|&nbsp;/g,'');
    assert.match(updated,/<span>Totaldelosdías<\/span><strong>Bs31[.,]053[.,]50<\/strong>/);
    assert.doesNotMatch(updated,/<span>Items<\/span><strong>Bs31[.,]441/);
  }
});


test('estado económico muestra total, pago aplicado y diferencia con garantía separada', () => {
  const contract = {contractCode:'test',items:[{itemId:'item',itemName:'Material',quantity:1,unitPriceBs:100,lineTotalBs:100}],totals:{totalBs:100,itemsNetSubtotalBs:100,guaranteeBs:20},payment:{paidAtApprovalBs:40},economicLedger:[]};
  const html = buildContractDocumentHtml({contract,rental:{},deliveries:[],settings:{},items:[]}).replace(/\s|&nbsp;/g,'');
  assert.match(html,/<small>Totaldelalquilerytransporte<\/small><strong>Bs100[.,]00/);
  assert.match(html,/<small>Pagadoacuentadelcontrato<\/small><strong>Bs40[.,]00/);
  assert.match(html,/<small>Faltapagardelcontrato<\/small><strong>Bs60[.,]00/);
  assert.ok(html.includes('Lagarantíasemuestraporseparado'));
});

