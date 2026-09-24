import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDraftAvailabilityPeriod,
  getProjectedInventoryAvailability,
  validateProjectedInventoryRequest,
} from './availability.js';

test('editar incluye reservas del dia de recojo y excluye el propio contrato', () => {
  const item = { id: 'copa', name: 'Copa dorada', totalStock: 213, availableStock: 34 };
  const contracts = [
    ['1759', 128, '2026-09-26', '2026-09-27'],
    ['2612', 20, '2026-09-26', '2026-09-27'],
    ['2713', 35, '2026-09-27', '2026-09-28'],
    ['2741', 30, '2026-09-25', '2026-09-26'],
  ].map(([code, quantity, eventDate, pickupDate]) => ({
    id: code,
    contractCode: code,
    rentalId: `rental-${code}`,
    status: 'aprobado',
    eventDate,
    pickupDate,
    pickupWindowEnd: '18:00',
    items: [{ itemId: item.id, quantity }],
  }));
  const rentals = contracts.map((contract) => ({
    ...contract,
    id: contract.rentalId,
    contractId: contract.id,
    status: 'active',
  }));
  const period = buildDraftAvailabilityPeriod({
    eventDate: '2026-09-26',
    deliveryDate: '2026-09-25',
    pickupDate: '2026-09-27',
    pickupWindowEnd: '18:00',
  });
  assert.equal(period.startDate, '2026-09-26');
  assert.equal(period.endDate, '2026-09-27');
  const request = {
    items: [item], contracts, rentals, period,
    exclude: { contractId: '1759', rentalId: 'rental-1759' },
  };
  const summary = getProjectedInventoryAvailability(request).get(item.id);
  assert.equal(summary.projectedAvailable, 128);
  assert.deepEqual(summary.hardReservedQtyRecords.map((record) => record.code), ['2612', '2713', '2741']);
  assert.equal(validateProjectedInventoryRequest({
    ...request, requestedItems: [{ itemId: item.id, quantity: 128 }],
  }).length, 0);
  const [issue] = validateProjectedInventoryRequest({
    ...request, requestedItems: [{ itemId: item.id, quantity: 130 }],
  });
  assert.equal(issue.shortageQty, 2);
  assert.equal(issue.hardConflicts.length, 3);
});

test('recojo por coordinar usa el evento y horario por coordinar usa fin de dia', () => {
  const draft = { eventDate: '2026-09-26', pickupDate: '2026-09-27', pickupWindowEnd: '18:00' };
  const coordinate = buildDraftAvailabilityPeriod({ ...draft, pickupDateMode: 'coordinate', pickupTimeMode: 'coordinate' });
  assert.equal(coordinate.endDate, draft.eventDate);
  assert.equal(coordinate.endTime, '23:59');
  const fixedDate = buildDraftAvailabilityPeriod({ ...draft, pickupTimeMode: 'coordinate' });
  assert.equal(fixedDate.endDate, draft.pickupDate);
  assert.equal(fixedDate.endTime, '23:59');
});
