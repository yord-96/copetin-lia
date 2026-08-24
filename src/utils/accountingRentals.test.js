import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRentalReceivableEventDate,
  isRentalExcludedFromReceivables,
} from './accountingRentals.js';

const deletedContract = {
  id: 'deleted-contract',
  rentalId: 'orphan-rental',
  contractCode: '1563',
  orderCode: 'OS-00048',
  eventDate: '2026-07-04',
  deletedAt: '2026-06-27T21:38:30.839Z',
};

test('excludes a returned rental whose original contract was deleted', () => {
  const rental = {
    id: 'orphan-rental',
    contractId: null,
    contractCode: null,
    orderCode: 'OS-00048',
    status: 'returned',
  };
  assert.equal(isRentalExcludedFromReceivables(rental, [deletedContract], []), true);
});

test('does not exclude a rental owned by an active contract', () => {
  const rental = { id: 'active-rental', orderCode: 'OS-00999', status: 'returned' };
  const activeContract = { id: 'active-contract', rentalId: 'active-rental', orderCode: 'OS-00999' };
  assert.equal(isRentalExcludedFromReceivables(rental, [deletedContract], [activeContract]), false);
});

test('an exact deleted rental link wins over a reused active order code', () => {
  const rental = { id: 'orphan-rental', orderCode: 'OS-00048', status: 'returned' };
  const activeContract = { id: 'new-contract', rentalId: 'new-rental', orderCode: 'OS-00048' };
  assert.equal(isRentalExcludedFromReceivables(rental, [deletedContract], [activeContract]), true);
});

test('uses the commercial rental date before the creation timestamp', () => {
  const rental = {
    rentalDate: '2026-07-04',
    createdAt: '2026-06-27T21:37:05.343Z',
  };
  assert.equal(getRentalReceivableEventDate(rental), '2026-07-04');
});
