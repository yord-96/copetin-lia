import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveActiveRentalForContract } from '../../server/utils/economicRentalResolver.js';

const legacyCancelled = {
  id: 'rental-antiguo',
  contractId: 'contract-1629',
  contractCode: '1629',
  orderCode: 'OS-00099',
  status: 'cancelled',
  updatedAt: '2026-07-31T12:59:56.223Z',
};

const returnedOrder = {
  id: 'rental-correcto',
  contractId: 'contract-1629',
  contractCode: '1629',
  orderCode: 'OS-00570',
  status: 'returned',
  returnedAt: '2026-07-31T14:15:37.860Z',
  updatedAt: '2026-07-31T19:29:15.249Z',
};

test('an exact rental ID wins over an older rental sharing the contract', () => {
  const result = resolveActiveRentalForContract(
    [legacyCancelled, returnedOrder],
    { id: 'contract-1629', rentalId: 'rental-correcto', contractCode: '1629', orderCode: 'OS-00570' },
    null,
    { linkedRentalId: 'rental-correcto', linkedOrderCode: 'OS-00570' },
  );
  assert.equal(result?.id, 'rental-correcto');
  assert.equal(result?.status, 'returned');
});

test('an exact order code wins when no structured rental ID is available', () => {
  const result = resolveActiveRentalForContract(
    [legacyCancelled, returnedOrder],
    { id: 'contract-1629', contractCode: '1629' },
    null,
    { linkedOrderCode: 'OS-00570' },
  );
  assert.equal(result?.id, 'rental-correcto');
});

test('a returned current rental wins over a cancelled duplicate as last contract fallback', () => {
  const result = resolveActiveRentalForContract(
    [legacyCancelled, returnedOrder],
    { id: 'contract-1629', contractCode: '1629' },
  );
  assert.equal(result?.id, 'rental-correcto');
});

