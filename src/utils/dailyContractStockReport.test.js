import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyContractStockModel, buildDailyContractStockHtml } from './dailyContractStockReport.js';

const contract = (id, quantity, extra = {}) => ({ id, contractCode: id, status: 'aprobado', customerName: `Cliente ${id}`, eventDate: '2026-11-24', pickupDate: '2026-11-24', items: [{ itemId: 'cojin', lineKey: `line-${id}`, quantity }], ...extra });
const item = { id: 'cojin', name: 'COJÍN MARFIL', totalStock: 600, availableStock: 0 };

test('600 physical, 300 in this contract, no other reservations leaves 300; linked contract/rental is counted once', () => {
  const c = contract('100', 300, { rentalId: 'r' });
  const input = { date: '2026-11-24', items: [item], contracts: [c, contract('future', 600, { eventDate: '2026-12-12', pickupDate: '2026-12-13' })], rentals: [{ ...c, id: 'r', contractId: c.id, status: 'active' }] };
  const before = JSON.stringify(input);
  const model = buildDailyContractStockModel(input);
  assert.equal(model.groups.length, 1);
  assert.deepEqual(model.groups[0].rows.map(row => [row.stock, row.own, row.other, row.free]), [[600, 300, 0, 300]]);
  assert.equal(JSON.stringify(input), before);
});

test('other contracts reduce the true daily free balance; external coverage never increases own stock', () => {
  const c = contract('100', 400, { supplierFulfillmentPlan: [{ itemId: 'cojin', lineKey: 'line-100', neededQty: 100, supplierName: 'ALQUILADORA <CENTRO>' }] });
  const model = buildDailyContractStockModel({ date: '2026-11-24', items: [item], contracts: [c, contract('200', 100), contract('deleted', 500, { deletedAt: '2026-11-23' }), contract('cancelled', 500, { status: 'cancelled' })] });
  assert.equal(model.groups.length, 2);
  const row = model.groups[0].rows[0];
  assert.equal(row.requested, 400);
  assert.equal(row.own, 300);
  assert.equal(row.external, 100);
  assert.equal(row.other, 100);
  assert.equal(row.free, 200);
  assert.deepEqual(row.suppliers, [{ name: 'ALQUILADORA <CENTRO>', quantity: 100 }]);
  const html = buildDailyContractStockHtml(model);
  assert.match(html, /ALQUILADORA &lt;CENTRO&gt;/);
  assert.match(html, /Origen propio/);
  assert.match(html, /Otros contratos/);
});

test('supplier-only products are included, and each scheduled day keeps its own quantities', () => {
  const c = contract('100', 100, { pricingPlan: { mode: 'daily_schedule', scheduleDays: [{ id: 'one', date: '2026-11-24' }, { id: 'two', date: '2026-11-25' }] }, pickupDate: '2026-11-25', items: [{ itemId: 'cojin', quantity: 300, serviceDayId: 'one' }, { itemId: 'cojin', quantity: 200, serviceDayId: 'two' }], supplierFulfillmentPlan: [{ itemId: 'supplier-only', itemName: 'SILLA SUBALQUILADA', supplierName: 'PROVEEDORA', neededQty: 50 }] });
  const model = buildDailyContractStockModel({ date: '2026-11-24', items: [item], contracts: [c] });
  assert.equal(model.groups[0].rows[0].own, 300);
  assert.equal(model.groups[0].rows[0].free, 300);
  assert.equal(model.groups[0].rows[1].external, 50);
  assert.equal(model.groups[0].rows[1].stock, null);
});

test('partial returns release own stock; completed rentals are excluded and invalid dates fail', () => {
  const c = contract('100', 300, { rentalId: 'r' });
  const r = { ...c, id: 'r', contractId: '100', status: 'active', partialReturnReport: { items: [{ lineKey: 'line-100', returnedToAvailableQty: 100 }] } };
  const request = { date: '2026-11-24', items: [item], contracts: [c], rentals: [r] };
  assert.equal(buildDailyContractStockModel(request).groups[0].rows[0].own, 200);
  assert.equal(buildDailyContractStockModel({ ...request, rentals: [{ ...r, status: 'returned' }] }).groups.length, 0);
  assert.throws(() => buildDailyContractStockModel({ date: '2026-02-31' }), /fecha válida/);
});

test('supplier partial returns retain original provider plan and show the remaining external quantity', () => {
  const c = contract('100', 400, { rentalId: 'r', supplierFulfillmentPlan: [{ itemId: 'cojin', lineKey: 'line-100', supplierName: 'SUB', neededQty: 100 }] });
  const r = { ...c, id: 'r', contractId: '100', status: 'active', partialReturnReport: { items: [{ lineKey: 'line-100', returnedQty: 150, returnedToAvailableQty: 100 }] } };
  const model = buildDailyContractStockModel({ date: '2026-11-24', items: [item], contracts: [c], rentals: [r] });
  const row = model.groups[0].rows[0];
  assert.equal(row.own, 200);
  assert.equal(row.external, 50);
  assert.equal(row.requested, 250);
  assert.match(buildDailyContractStockHtml(model), /Pendiente externo: 50/);
});
