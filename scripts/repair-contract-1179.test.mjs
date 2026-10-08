import assert from 'node:assert/strict';
import test from 'node:test';
import { repairContract1179 } from './repair-contract-1179.mjs';
const fixture = () => {
  const id = '35768b37-eb3f-45e4-b839-d03535a487e5';
  return { contracts: [{ id, contractCode: '1179', rentalId: 'r', totals: { totalBs: 33341, guaranteeBs: 3000 }, payment: {},
    economicLedger: [{ id: 'first', type: 'deposit', amountBs: 33078.5, cashMovementId: 'm1' },
      { id: 'second', type: 'deposit', amountBs: 28078.5, cashMovementId: 'm2' },
      { id: 'g', type: 'guarantee', amountBs: 3000, sourceDepositId: 'first', reclassifiedFromPayment: true }] }],
    rentals: [{ id: 'r', payment: { deliveryFeeCollectedBs: 3700 }, totals: { deliveryFeeCollectedBs: 3700 } }],
    cashMovements: [
      { id: 'm1', linkedContractId: id, receiptCode: 'RC-13559', amountBs: 5000 },
      { id: 'm2', linkedContractId: id, receiptCode: 'RC-13560', amountBs: 28078.5 },
      { id: 'auto', linkedContractId: id, receiptCode: 'RC-13629', amountBs: 33078.5,
        accountingTag: 'initial_rental_payment', notes: 'Pago inicial registrado desde contrato 1179', createdAt: '2026-10-07T19:49:42.331Z' },
      { id: 'foreign', linkedContractId: 'other', amountBs: 900 },
    ] };
};
test('targeted repair restores deposit, voids only duplicate, keeps guarantee and is idempotent', () => {
  const s = fixture();
  const untouched = structuredClone([s.cashMovements[0], s.cashMovements[1], s.cashMovements[3], s.contracts[0].economicLedger[2]]);
  const result = repairContract1179(s, '2026-10-08T14:00:00Z');
  assert.equal(result.pendingBs, 3262.5);
  assert.equal(s.cashMovements.length, 4);
  assert.equal(s.cashMovements[2].receiptStatus, 'anulado');
  assert.equal(s.contracts[0].economicLedger[0].amountBs, 5000);
  assert.equal(s.rentals[0].payment.rentalCollectedBs, 26378.5);
  assert.deepEqual([s.cashMovements[0], s.cashMovements[1], s.cashMovements[3], s.contracts[0].economicLedger[2]], untouched);
  const after = structuredClone(s);
  assert.equal(repairContract1179(s).status, 'already_applied');
  assert.deepEqual(s, after);
});
test('changed receipt, additional payment or changed guarantee aborts before modifying anything', () => {
  for (const change of [s => { s.cashMovements[0].amountBs = 6000; },
    s => { s.cashMovements.push({ id: 'new', linkedContractId: s.contracts[0].id, amountBs: 10 }); },
    s => { s.contracts[0].economicLedger[2].amountBs = 2000; }]) {
    const s = fixture(); change(s); const before = structuredClone(s);
    assert.throws(() => repairContract1179(s), /Sin cambios:/);
    assert.deepEqual(s, before);
  }
});
