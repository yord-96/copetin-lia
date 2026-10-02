import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPettyCashFundTimeline, resetPettyCashState, assertIndependentCashMovement } from './pettyCashFund.js';

test('fondo propio sigue registro aunque se cambien fechas y excluye Caja Grande y anulados', () => {
  const rows = [
    { id:'in', cashBoxType:'PETTY_CASH', amountBs:500, cashLedgerSequence:1, createdAt:'2026-10-02' },
    { id:'out', cashBoxType:'PETTY_CASH', amountBs:-100, cashLedgerSequence:3, createdAt:'2026-09-01' },
    { id:'qr', cashBoxType:'PETTY_CASH', amountBs:200, paymentMethod:'qr', cashLedgerSequence:2 },
    { id:'big', cashBoxType:'BIG_CASH', amountBs:5000 },
    { id:'void', cashBoxType:'PETTY_CASH', amountBs:-40, voidedAt:'2026-10-02' },
  ];
  const result=buildPettyCashFundTimeline(rows);
  assert.equal(result.totalBs,600);
  assert.equal(result.cashBs,400);
  assert.equal(result.digitalBs,200);
  assert.equal(result.byMovementId.get('out').totalBs,600);
  assert.equal(result.byMovementId.get('in').totalBs,500);
});

test('reinicio deja Caja Chica en cero y conserva exactamente Caja Grande y comerciales', () => {
  const big={id:'big',cashBoxType:'BIG_CASH',amountBs:5000};
  const state={cashMovements:[big,{id:'petty',cashBoxType:'PETTY_CASH',amountBs:300}], cashDebts:[{id:'d',amountBs:50}], cashSessions:[{id:'shared',status:'open'},{id:'petty',cashBoxType:'PETTY_CASH',status:'open'}], supplierLoans:[{id:'loan'}], contracts:[{id:'contract'}]};
  const result=resetPettyCashState(structuredClone(state),{now:'2026-10-02',backupFile:'backup.json'}).state;
  assert.deepEqual(result.cashMovements[0],big);
  assert.deepEqual(result.contracts,state.contracts);
  assert.deepEqual(result.supplierLoans,state.supplierLoans);
  assert.deepEqual(result.cashSessions[0],state.cashSessions[0]);
  assert.equal(buildPettyCashFundTimeline(result.cashMovements).totalBs,0);
  assert.equal(result.cashDebts[0].accountingPeriodStatus,'archived');
  assert.deepEqual(result.settings.accounting.pettyHiddenSupplierLoanIds,['loan']);
  assert.equal(result.settings.accounting.cashBoxesIndependent,true);
  result.cashMovements.push({id:'new',cashBoxType:'PETTY_CASH',amountBs:100});
  assert.equal(buildPettyCashFundTimeline(result.cashMovements).totalBs,100);
});

test('no permite transferencias entre cajas', () => {
  assert.throws(()=>assertIndependentCashMovement({type:'transferencia'}),/independientes/);
  assert.throws(()=>assertIndependentCashMovement({isInternalTransfer:true}),/independientes/);
  assert.doesNotThrow(()=>assertIndependentCashMovement({type:'ingreso',cashBoxType:'PETTY_CASH'}));
});
