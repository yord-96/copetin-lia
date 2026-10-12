import test from 'node:test';
import assert from 'node:assert/strict';
import { getWebBridge } from './webBridge.js';
import { reviseEconomicDeposit } from '../utils/economicDepositOperations.js';

test('bridge saves deposit redistribution and grouped deletion atomically with one receipt', async () => {
  const bridge = getWebBridge();
  const ledger = [{ id: 'd', type: 'deposit', amountBs: 1000, contractAllocationBs: 800, guaranteeAllocationBs: 200, cashMovementId: 'm', isCashRegistered: true }, { id: 'g', type: 'guarantee', amountBs: 200, sourceDepositId: 'd', reclassifiedFromPayment: true }];
  const state = { settings: {}, contracts: [{ id: 'c', contractCode: 'TEST', economicLedger: ledger }], rentals: [], cashMovements: [{ id: 'm', linkedContractId: 'c', receiptCode: 'RC-TEST', amountBs: 1000, contractAllocationBs: 800, guaranteeAllocationBs: 200 }], generatedReports: [] };
  await bridge.__storage.beginBatch(state);
  try {
    const next = reviseEconomicDeposit(ledger, ledger[0], { receivedBs: 1000, guaranteeBs: 50 });
    await bridge.contracts.updateEconomicLedger({ id: 'c', mutations: next.map(entry => ({ type: 'upsert', entry })) });
    assert.equal(state.cashMovements.length, 1);
    assert.equal(state.cashMovements[0].contractAllocationBs, 950);
    assert.equal(state.cashMovements[0].receiptCode, 'RC-TEST');
    await bridge.contracts.updateEconomicLedger({ id: 'c', mutations: [{ type: 'void', entryId: 'd' }, { type: 'void', entryId: 'g' }] });
    assert.ok(state.cashMovements[0].deletedAt);
    assert.ok(state.contracts[0].economicLedger.every(row => row.deletedAt));
  } finally { await bridge.__storage.rollbackBatch(); }
});
