import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractPayloadFromQuote } from './quoteConversion.js';
import { buildAvailabilityPeriod, validateProjectedInventoryRequest } from './availability.js';

test('conversion retains quote prices, guarantees, combo structure and payment accounts', () => {
  const quote = { id: 'q', updatedAt: 'version', customerName: 'CLIENT', totals: { discountMode: 'fixed', discountBs: 15, guaranteeBs: 200, deliveryFeeBs: 40 }, guarantee: { status: 'validado', paymentMethod: 'qr', paymentAccount: 'BCP' }, payment: { paidAtApprovalBs: 100, initialPaymentMethod: 'qr', initialPaymentAccount: 'FIE' }, items: [{ itemId: 'chair', quantity: 4, unitPriceBs: 10, comboId: 'combo', comboPricingRole: 'price_main' }], services: [{ name: 'Servicio', lineTotalBs: 20 }], supplierFulfillmentPlan: [{ supplierId: 's', quantity: 1 }] };
  const result = buildContractPayloadFromQuote(quote);
  assert.equal(result.quoteId, 'q'); assert.equal(result.id, undefined);
  assert.equal(result.expectedQuoteUpdatedAt, 'version');
  assert.equal(result.discountBs, 15); assert.equal(result.guaranteeBs, 200);
  assert.equal(result.guaranteePaymentAccount, 'BCP'); assert.equal(result.initialPaymentAccount, 'FIE');
  assert.equal(result.deliveryFeeBs, 40); assert.equal(result.paidAtApprovalBs, 100);
  assert.deepEqual(result.items, quote.items); assert.deepEqual(result.services, quote.services);
  assert.deepEqual(result.supplierFulfillmentPlan, quote.supplierFulfillmentPlan);
});

test('an unset internal reservation validates the requested units, while explicit zero remains zero', () => {
  const input = { items: [{ id: 'chair', name: 'SILLA', totalStock: 10, availableStock: 10, controlsStock: true }], period: buildAvailabilityPeriod({ deliveryDate: '2026-11-22', pickupDate: '2026-11-23' }) };
  for (const value of [undefined, null, '']) {
    assert.equal(validateProjectedInventoryRequest({ ...input, requestedItems: [{ itemId: 'chair', quantity: 15, internalReservedQty: value }] })[0].shortageQty, 5);
  }
  assert.deepEqual(validateProjectedInventoryRequest({ ...input, requestedItems: [{ itemId: 'chair', quantity: 15, internalReservedQty: 0 }] }), []);
});
