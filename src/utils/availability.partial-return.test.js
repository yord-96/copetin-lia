import test from 'node:test';
import assert from 'node:assert/strict';
import { getOutstandingInventoryLineQuantity, getProjectedInventoryAvailability, buildDraftAvailabilityPeriod, validateProjectedInventoryRequest } from './availability.js';

test('partial return releases returned items while keeping other items reserved, including historical edits', () => {
  const items = [{ id: 'plate', totalStock: 237, availableStock: 237 }, { id: 'fork', totalStock: 100, availableStock: 44 }];
  const rental = {
    id: '1995', status: 'active', eventDate: '2026-10-17', dueDate: '2026-10-18',
    items: [{ itemId: 'plate', lineKey: 'p', quantity: 302, internalReservedQty: 237, supplierBackedQty: 65 }, { itemId: 'fork', lineKey: 'f', quantity: 100 }],
    partialReturnReport: { items: [
      { itemId: 'plate', lineKey: 'p', returnedQty: 302, returnedToAvailableQty: 237, stockLossQty: 0, pendingClientQty: 0 },
      { itemId: 'fork', lineKey: 'f', returnedQty: 44, returnedToAvailableQty: 44, pendingClientQty: 56 },
    ] },
  };
  // returnReport repeats the latest batch; it must not be counted twice.
  rental.returnReport = rental.partialReturnReport.items;
  const request = { items, rentals: [rental], period: buildDraftAvailabilityPeriod({ eventDate: '2026-10-17', pickupDate: '2026-10-18' }) };
  const result = getProjectedInventoryAvailability(request);
  assert.equal(result.get('plate').projectedAvailable, 237);
  assert.equal(result.get('plate').hardReservedQtyRecords.length, 0);
  assert.equal(result.get('fork').projectedAvailable, 44);
  assert.deepEqual(validateProjectedInventoryRequest({ ...request, requestedItems: [{ itemId: 'plate', quantity: 230 }] }), []);
});

test('supplier returns do not release internal units; multiple batches use their internal quantities', () => {
  const line = { itemId: 'p', lineKey: 'a', quantity: 100, internalReservedQty: 60 };
  const rental = { items: [line], partialReturnReport: { items: [
    { lineKey: 'a', returnedQty: 40, returnedToAvailableQty: 0 },
    { lineKey: 'a', returnedQty: 10, returnedToAvailableQty: 10 },
  ] } };
  assert.equal(getOutstandingInventoryLineQuantity(rental, line), 50);
});

test('duplicate product lines match their own key; ambiguous legacy entries cannot release both', () => {
  const lines = ['a', 'b'].map((lineKey) => ({ itemId: 'p', lineKey, quantity: 10 }));
  const rental = { items: lines, partialReturnReport: { items: [{ lineKey: 'a', returnedToAvailableQty: 10 }, { itemId: 'p', returnedQty: 10 }] } };
  assert.equal(getOutstandingInventoryLineQuantity(rental, lines[0]), 0);
  assert.equal(getOutstandingInventoryLineQuantity(rental, lines[1]), 10);
});

test('legacy pending missing units remain reserved, confirmed losses do not', () => {
  const line = { itemId: 'p', quantity: 10 };
  const rental = { items: [line], operational: { clientPendingPickup: { active: true } }, partialReturnReport: { items: [{ itemId: 'p', returnedQty: 4, missingQty: 6 }] } };
  assert.equal(getOutstandingInventoryLineQuantity(rental, line), 6);
  rental.partialReturnReport.items[0].pendingClientQty = 0;
  assert.equal(getOutstandingInventoryLineQuantity(rental, line), 0);
});
