import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateReceivableBreakdown, getConfirmedContractLedgerPaidBs } from './receivables.js';

test('a confirmed historical ledger payment prevents a stale debt from returning', () => {
  const contract = {
    totals: { totalBs: 257 },
    payment: { paidAtApprovalBs: 0, pendingPaymentBs: 257 },
    economicLedger: [{ type: 'deposit', amountBs: 257, isCashRegistered: true, cashReceiptCode: 'RC-6147' }],
  };
  const rental = {
    status: 'returned',
    totals: { totalBs: 257, paidAtRentalBs: 0 },
    returnSettlement: { outstandingRentalBs: 0, pendingCollectionBs: 0, penaltiesBs: 0 },
  };
  const ledgerPaidBs = getConfirmedContractLedgerPaidBs(contract, 257);
  assert.equal(ledgerPaidBs, 257);
  assert.equal(calculateReceivableBreakdown({ rental, contract, confirmedCommercialPaidBs: ledgerPaidBs }).totalPendingBs, 0);
});

test('separates contract, transport and damage without counting guarantee twice', () => {
  const contract = { totals: { totalBs: 250, deliveryFeeBs: 50 } };
  const rental = {
    totals: { totalBs: 250, deliveryFeeBs: 50 },
    returnSettlement: { penaltiesBs: 80, discountCoveredByDepositBs: 30, damageCollectedBs: 10 },
  };
  assert.deepEqual(calculateReceivableBreakdown({ rental, contract }), {
    totalBs: 250,
    paidBs: 0,
    contractPendingBs: 200,
    transportPendingBs: 50,
    damagePendingBs: 40,
    commercialPendingBs: 250,
    totalPendingBs: 290,
    status: 'pending',
  });
});

test('a separately confirmed guarantee is not treated as contract payment', () => {
  const contract = {
    economicLedger: [
      { id: 'payment', type: 'deposit', amountBs: 800, isCashRegistered: true },
      { id: 'guarantee', type: 'guarantee', amountBs: 500, isCashRegistered: true },
    ],
  };
  const paidBs = getConfirmedContractLedgerPaidBs(contract, 2172);
  assert.equal(paidBs, 800);
  const rental = {
    totals: { totalBs: 2172 },
    payment: { paidAtRentalBs: 800, rentalCollectedBs: 2172 },
    returnSettlement: { penaltiesBs: 400, pendingCollectionBs: 1772 },
  };
  const breakdown = calculateReceivableBreakdown({ rental, contract: { ...contract, totals: { totalBs: 2172 } }, confirmedCommercialPaidBs: paidBs });
  assert.equal(breakdown.commercialPendingBs, 1372);
  assert.equal(breakdown.damagePendingBs, 400);
  assert.equal(breakdown.totalPendingBs, 1772);
});

test('a damage receipt is not applied again to the commercial contract balance', () => {
  const contract = {
    economicLedger: [
      { type: 'deposit', amountBs: 100, isCashRegistered: true, cashCollectionTarget: 'damage' },
    ],
  };
  assert.equal(getConfirmedContractLedgerPaidBs(contract, 100), 0);
});
