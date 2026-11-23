import test from 'node:test';
import assert from 'node:assert/strict';
import { updateDraftEventDate } from './draftEventDate.js';
import { buildDraftAvailabilityPeriod, getProjectedInventoryAvailability } from './availability.js';

test('moving the event backwards moves logistics too and excludes later contracts', () => {
  const original = { entityType: 'contract', eventDate: '2026-12-21', deliveryDate: '2026-12-21', pickupDate: '2026-12-21',
    items: [{ itemId: 'cojin', quantity: 10 }] };
  const draft = updateDraftEventDate(original, '2026-12-12');
  assert.equal(draft.pickupDate, '2026-12-12');
  assert.equal(draft.deliveryDate, '2026-12-12');
  assert.deepEqual(draft.items, original.items);
  assert.equal(original.eventDate, '2026-12-21');
  const contracts = [{ id: 'later', status: 'aprobado', eventDate: '2026-12-19', pickupDate: '2026-12-21', items: [{ itemId: 'cojin', quantity: 100 }] },
    { id: 'same-day', status: 'aprobado', eventDate: '2026-12-12', pickupDate: '2026-12-13', items: [{ itemId: 'cojin', quantity: 200 }] }];
  const summary = getProjectedInventoryAvailability({ items: [{ id: 'cojin', totalStock: 672 }], contracts,
    period: buildDraftAvailabilityPeriod(draft) }).get('cojin');
  assert.equal(summary.hardReservedQty, 200);
  assert.equal(summary.projectedAvailable, 472);
});

test('date changes preserve early delivery and multi-day duration across months', () => {
  const original = { entityType: 'quote', eventDate: '2026-12-21', deliveryDate: '2026-12-20', pickupDate: '2026-12-23', validUntil: '2026-12-23' };
  const draft = updateDraftEventDate(original, '2027-01-01');
  assert.equal(draft.deliveryDate, '2026-12-31');
  assert.equal(draft.pickupDate, '2027-01-03');
  assert.equal(draft.validUntil, '2027-01-03');
  assert.deepEqual(updateDraftEventDate(draft, '2026-12-21'), original);
});
