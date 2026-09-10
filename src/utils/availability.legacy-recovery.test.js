import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAvailabilityPeriod, getProjectedInventoryAvailability } from './availability.js';

const item = {
  id: 'mantel-huesito',
  name: 'MANTEL ARRUGADO / AMERICANO HUESITO',
  totalStock: 19,
  // Valor legacy que antes quedaba en 0 por una cola antigua de lavado.
  availableStock: 0,
  controlsStock: true,
  verificationStatus: 'verified',
};

test('lavado legacy no reduce disponibilidad si no hay contrato que ocupe el item', () => {
  const period = buildAvailabilityPeriod({
    deliveryDate: '2026-09-10',
    deliveryWindowStart: '20:00',
    pickupDate: '2026-09-11',
    pickupWindowEnd: '08:00',
  });

  const summary = getProjectedInventoryAvailability({
    items: [item],
    rentals: [],
    contracts: [],
    period,
  }).get(item.id);

  assert.equal(summary.totalStock, 19);
  assert.equal(summary.currentAvailable, 19);
  assert.equal(summary.unavailableOutsideRentals, 0);
  assert.equal(summary.projectedAvailable, 19);
});

test('solo una reserva que coincide con la fecha reduce disponibilidad temporal', () => {
  const rental = {
    id: 'rental-1',
    orderCode: 'OS-TEST',
    customerName: 'CLIENTE TEST',
    status: 'active',
    rentalDate: '2026-09-10',
    dueDate: '2026-09-11',
    items: [{ itemId: item.id, itemName: item.name, quantity: 4, internalReservedQty: 4 }],
  };
  const contract = {
    id: 'contract-1',
    rentalId: rental.id,
    orderCode: rental.orderCode,
    contractCode: '9999',
    status: 'aprobado',
    deliveryDate: '2026-09-10',
    deliveryWindowStart: '18:00',
    pickupDate: '2026-09-11',
    pickupWindowEnd: '10:00',
  };
  const period = buildAvailabilityPeriod({
    deliveryDate: '2026-09-10',
    deliveryWindowStart: '20:00',
    pickupDate: '2026-09-11',
    pickupWindowEnd: '08:00',
  });

  const summary = getProjectedInventoryAvailability({
    items: [item],
    rentals: [rental],
    contracts: [contract],
    period,
  }).get(item.id);

  assert.equal(summary.currentAvailable, 15);
  assert.equal(summary.hardReservedQty, 4);
  assert.equal(summary.projectedAvailable, 15);
  assert.equal(summary.unavailableOutsideRentals, 0);
});
