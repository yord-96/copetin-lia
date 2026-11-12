import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPriorAvailabilityRecords } from './availabilityPresentation.js';
import { getProjectedInventoryAvailability, buildAvailabilityPeriod } from './availability.js';

test('110 physical units reused in prior bookings are presented as four bookings, without inflating date availability', () => {
  const quantities = [50, 20, 57, 100];
  const rentals = quantities.map((quantity, index) => ({ id: 'r' + index, status: 'active', rentalDate: ['2026-12-12','2026-08-29','2026-12-12','2027-01-23'][index], dueDate: ['2026-12-12','2026-08-30','2026-12-12','2027-01-24'][index], items: [{ itemId: 'i', quantity }] }));
  const summary = getProjectedInventoryAvailability({ items: [{ id: 'i', name: 'PLAQUET', totalStock: 110, availableStock: 110 }], rentals, period: buildAvailabilityPeriod({ eventDate: '2027-01-30', pickupDate: '2027-01-31' }) }).get('i');
  const before = structuredClone(summary);
  const prior = groupPriorAvailabilityRecords(summary.returningBeforeStartQtyRecords);
  assert.equal(summary.returningBeforeStartQty, 227);
  assert.equal(prior.length, 4); assert.equal(prior[0].id, 'r3');
  assert.equal(summary.projectedAvailable, 110);
  assert.deepEqual(summary, before, 'presentation cannot mutate stock or reservations');
});
test('two lines for one product in a booking count as one prior booking, retaining its quantity and date', () => {
  const rows = [{ id: 'r', startDate: '2026-12-01', endDate: '2026-12-02', quantity: 10 }, { id: 'r', startDate: '2026-12-01', endDate: '2026-12-02', quantity: 5 }];
  const result = groupPriorAvailabilityRecords(rows);
  assert.equal(result.length, 1); assert.equal(result[0].quantity, 15); assert.equal(rows[0].quantity, 10);
  assert.deepEqual(groupPriorAvailabilityRecords(), []);
});
