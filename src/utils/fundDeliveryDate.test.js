import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBigCashFundTimeline, getFundDeliveryCoverage } from './dailyCashReport.js';
const movement = (id,amountBs,date,sequence,tag='') => ({id,amountBs,cashBoxType:'BIG_CASH',paymentMethod:'efectivo',cashEffectiveDate:date,cashLedgerSequence:sequence,accountingTag:tag});
test('historical delivery uses only funds through that day and carries the remainder forward', () => {
  const rows = [movement('opening',5000,'2026-10-01',1,'big_cash_fund_in'),movement('payments',25000,'2026-10-05',2),movement('future',10000,'2026-10-06',3)];
  assert.equal(buildBigCashFundTimeline(rows,{asOfDate:'2026-10-05'}).cashBs,30000);
  rows.push(movement('delivery',-25000,'2026-10-05',4,'big_cash_fund_out'));
  const day5=buildBigCashFundTimeline(rows,{asOfDate:'2026-10-05',reportDate:'2026-10-05'});
  const day6=buildBigCashFundTimeline(rows,{asOfDate:'2026-10-06',reportDate:'2026-10-06'});
  assert.equal(day5.cashBs,5000);
  assert.equal(day6.openingBalance.cashBs,5000);
  assert.equal(day6.cashBs,15000);
  assert.equal(getFundDeliveryCoverage(rows,'2026-10-01').endDate,'2026-10-05');
  assert.equal(getFundDeliveryCoverage(rows,'2026-10-05').amountBs,25000);
  assert.equal(getFundDeliveryCoverage(rows,'2026-10-06'),null);
  rows.at(-1).voidedAt='voided';
  assert.equal(getFundDeliveryCoverage(rows,'2026-10-05'),null);
});
