import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFundDeliveryStatement,buildFundDeliveryDocumentHtml} from './fundDeliveryDocument.js';
const row=(id,amountBs,date,sequence,tag='')=>({id,amountBs,cashBoxType:'BIG_CASH',paymentMethod:'efectivo',cashEffectiveDate:date,cashLedgerSequence:sequence,accountingTag:tag});
test('statement reconciles opening, receipts, expenses, delivery and carryforward',()=>{
 const rows=[row('opening',5000,'2026-10-01',1,'big_cash_fund_in'),row('income',25000,'2026-10-05',2),row('future',10000,'2026-10-06',3)];
 const delivery=row('delivery',-25000,'2026-10-05',4,'big_cash_fund_out');
 const s=buildFundDeliveryStatement(rows,delivery);
 assert.equal(s.before.cashBs,30000);assert.equal(s.after.cashBs,5000);
 assert.equal(s.opening.totalBs+s.incomeBs-s.expenseBs-25000,s.after.totalBs);
 assert.equal(s.details.some(r=>r.movement.id==='future'),false);
 const later=row('later',-3000,'2026-10-06',5,'big_cash_fund_out');
 const next=buildFundDeliveryStatement([...rows,delivery],later);
 assert.equal(next.opening.totalBs,5000);
 assert.deepEqual(next.details.map(r=>r.movement.id),['future','later']);
 assert.equal(next.after.totalBs,12000);
 const html=buildFundDeliveryDocumentHtml({statement:s,delivery,labels:()=>({customer:'<cliente>',reference:'123',user:'Usuario'})});
 assert.ok(html.includes('&lt;cliente&gt;'));assert.ok(html.includes('Contrato 123'));assert.ok(html.includes('RECIBIDO POR'));
});
