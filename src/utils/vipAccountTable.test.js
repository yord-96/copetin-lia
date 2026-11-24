import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVipAccountTable } from './vipAccountTable.js';

test('unified table includes all merged contracts and funding without inventing VIP debits', () => {
  const data = { summary: { balanceDifferenceBs: 20 }, rows: [
    { id: 'primary', code: '1', orderCode: 'OS1', eventDate: '2026-12-01' },
    { id: 'victoria', code: '2', eventDate: '2026-11-24' },
    { id: 'jardin', code: '3', eventDate: '2027-07-17' },
  ], movements: [
    { id: 'fund', createdAt: '2026-11-20', amountBs: 100, calculatedBalanceBs: 100 },
    { id: 'pay', createdAt: '2026-11-25', sourceId: 'OS1', amountBs: -30, calculatedBalanceBs: 70 },
    { id: 'pay2', createdAt: '2026-11-26', contractCode: '1', amountBs: -10, calculatedBalanceBs: 60 },
  ] };
  const before = JSON.stringify(data);
  const entries = buildVipAccountTable(data);
  assert.equal(entries.length, 5);
  assert.equal(entries.filter(row => row.showContract).length, 3);
  assert.deepEqual(entries.filter(row => row.showContract).map(row => row.contract.id).sort(), ['jardin', 'primary', 'victoria']);
  assert.equal(entries.find(row => row.contract?.id === 'victoria').balanceBs, 120);
  assert.equal(entries.at(-1).balanceBs, 80);
  assert.equal(entries.at(-1).movement, undefined);
  assert.equal(entries.filter(row => row.movement).length, 3);
  assert.equal(JSON.stringify(data), before);
});
