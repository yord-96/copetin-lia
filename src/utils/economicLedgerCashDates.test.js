import test from 'node:test';
import assert from 'node:assert/strict';
import { syncEconomicLedgerCashDate } from './economicLedgerCashDates.js';
import { getCashEffectiveDate } from './cashLedgerOrder.js';
test('date changes reach both explicit replacement receipts, reports and daily cash without changing amounts or order', () => {
  const c={id:'c'};const e={cashMovementId:'old',createdAt:'2026-09-05T12:37:58Z'};
  const s={cashMovements:[{id:'old',linkedContractId:'c',voidedAt:'yesterday'},
    ...['rental','guarantee'].map((id,i)=>({id,linkedContractId:'c',replacementOfMovementId:'old',amountBs:50,cashLedgerSequence:i+10,cashEffectiveDate:'2026-09-07'})),
    {id:'other',linkedContractId:'c',amountBs:50,createdAt:'2026-09-07'},
    {id:'foreign',linkedContractId:'x',replacementOfMovementId:'old',createdAt:'2026-09-07'}],generatedReports:[{cashMovementId:'rental'}]};
  const untouched=structuredClone([s.cashMovements[0],...s.cashMovements.slice(3)]);
  assert.deepEqual(syncEconomicLedgerCashDate(s,c,e),['rental','guarantee']);
  for(const m of s.cashMovements.slice(1,3)){assert.equal(getCashEffectiveDate(m),'2026-09-05');assert.equal(m.amountBs,50);}
  assert.equal(s.cashMovements[1].cashLedgerSequence,10);
  assert.equal(s.cashMovements[2].cashLedgerSequence,11);
  assert.deepEqual([s.cashMovements[0],...s.cashMovements.slice(3)],untouched);
  assert.equal(s.generatedReports[0].receiptIssuedAt,'2026-09-05T12:37:58.000Z');
});
test('receipt-code fallback syncs new payments and ignores deleted entries or ambiguous unlinked payments',()=>{
 const c={id:'c'};const s={cashMovements:[{id:'m',linkedContractId:'c',receiptCode:'RC-1',amountBs:100}]};
 assert.deepEqual(syncEconomicLedgerCashDate(s,c,{cashReceiptCode:'RC-1',createdAt:'2026-09-05T12:00:00Z'}),['m']);
 assert.deepEqual(syncEconomicLedgerCashDate(s,c,{cashReceiptCode:'RC-1',deletedAt:'now',createdAt:'2026-09-07'}),[]);
 assert.deepEqual(syncEconomicLedgerCashDate(s,c,{createdAt:'2026-09-07',amountBs:100}),[]);
});
