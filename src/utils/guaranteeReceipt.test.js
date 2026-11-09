import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveGuaranteeReceipt } from './guaranteeReceipt.js';

test('3406: Bs 150 guarantee is separate from the Bs 50 and Bs 62.50 service receipts', () => {
  const ledger = [{ id: 'transport', type: 'deposit', amountBs: 50 }, { id: 'rental', type: 'deposit', amountBs: 62.5 }, { id: 'g', type: 'guarantee', amountBs: 150 }];
  const allocations = new Map([['transport', { guaranteeBs: 0 }], ['rental', { guaranteeBs: 0 }]]);
  assert.equal(resolveGuaranteeReceipt(ledger[2], ledger, allocations).kind, 'standalone');
  assert.equal(resolveGuaranteeReceipt({ ...ledger[2], cashMovementId: 'cash' }, ledger, allocations).kind, 'own');
});

test('explicit or inferred reservations use the original deposit rather than another income', () => {
  const deposit = { id: 'd', type: 'deposit', amountBs: 500 };
  const guarantee = { id: 'g', type: 'guarantee', amountBs: 150 };
  const allocations = new Map([['d', { guaranteeBs: 150 }]]);
  assert.deepEqual(resolveGuaranteeReceipt(guarantee, [deposit, guarantee], allocations), { kind: 'source', entry: deposit });
  assert.deepEqual(resolveGuaranteeReceipt({ ...guarantee, sourceDepositId: 'd' }, [deposit, guarantee]), { kind: 'source', entry: deposit });
});

test('split or missing backing cannot accidentally generate a second guarantee receipt', () => {
  const deposits = [{ id: 'a', type: 'deposit', amountBs: 100 }, { id: 'b', type: 'deposit', amountBs: 100 }];
  const guarantee = { id: 'g', type: 'guarantee', amountBs: 150 };
  assert.equal(resolveGuaranteeReceipt(guarantee, [...deposits, guarantee], new Map([['a', { guaranteeBs: 100 }], ['b', { guaranteeBs: 50 }]])).kind, 'unavailable');
  assert.equal(resolveGuaranteeReceipt({ ...guarantee, sourceDepositId: 'missing' }, deposits).kind, 'unavailable');
});
