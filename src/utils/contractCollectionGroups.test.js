import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractCollectionGroups } from './contractCollectionGroups.js';

test('reports an exact contract payment regardless of its history position', () => {
  const newerUnrelatedMovements = Array.from({ length: 900 }, (_, index) => ({
    id: `newer-${index}`,
    amountBs: 10,
    createdAt: new Date(Date.UTC(2026, 7, 25, 12, index)).toISOString(),
  }));
  const payment = {
    id: 'payment-1942',
    amountBs: 168,
    linkedContractId: 'contract-1942',
    linkedRentalId: 'rental-1942',
    linkedOrderCode: 'OS-00562',
    receiptCode: 'RC-0421',
    createdAt: '2026-07-30T21:30:16.403Z',
  };

  const [group] = buildContractCollectionGroups({
    movements: [...newerUnrelatedMovements, payment],
    references: [{
      key: 'rental-1942',
      contractIds: ['contract-1942'],
      rentalIds: ['rental-1942'],
      contractCodes: ['1942'],
      orderCodes: ['OS-00562'],
    }],
  });

  assert.deepEqual(group.movements.map((movement) => movement.id), ['payment-1942']);
});

test('excludes voided, deleted and unrelated movements from exact collections', () => {
  const reference = {
    key: 'rental-1',
    rentalIds: ['rental-1'],
  };
  const [group] = buildContractCollectionGroups({
    references: [reference],
    movements: [
      { id: 'valid', linkedRentalId: 'rental-1', amountBs: 20 },
      { id: 'voided', linkedRentalId: 'rental-1', amountBs: 20, voidedAt: '2026-01-01' },
      { id: 'deleted', linkedRentalId: 'rental-1', amountBs: 20, deletedAt: '2026-01-01' },
      { id: 'other', linkedRentalId: 'rental-2', amountBs: 20 },
    ],
  });

  assert.deepEqual(group.movements.map((movement) => movement.id), ['valid']);
});
