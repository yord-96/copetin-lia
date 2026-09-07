import assert from 'node:assert/strict';
import test from 'node:test';

import { getWebBridge } from './webBridge.js';

test('guarda precios y asigna al editor de una cotizacion del catalogo web', async () => {
  const bridge = getWebBridge();
  await bridge.__storage.replaceState({
    items: [{
      id: 'item-catalogo',
      name: 'MANTEL DE PRUEBA',
      category: 'MANTELERIA',
      rentalPriceBs: 0,
      totalStock: 10,
      availableStock: 10,
    }],
    quotes: [{
      id: 'quote-catalogo',
      quoteCode: 'COT-00059',
      customerName: 'CLIENTE WEB',
      customerPhone: '70000000',
      eventDate: '2026-09-07',
      eventTime: '16:00',
      deliveryDate: '2026-09-07',
      deliveryWindowStart: '16:00',
      deliveryWindowEnd: '16:00',
      deliveryTimeMode: 'coordinate',
      pickupDateMode: 'coordinate',
      pickupTimeMode: 'coordinate',
      logisticsMode: 'recojo',
      source: 'public_catalog',
      awaitingAssignment: true,
      publicRequestStatus: 'waiting_contact',
      status: 'borrador',
      pricingPlan: { mode: 'simple', days: 1, tiers: [] },
      totals: { discountMode: 'percent', discountBs: 0, discountPercent: 0 },
      payment: { paidAtApprovalBs: 0 },
      guarantee: { amountBs: 0, status: 'no_validado' },
      items: [{
        lineKey: 'linea-catalogo',
        itemId: 'item-catalogo',
        itemName: 'MANTEL DE PRUEBA',
        quantity: 2,
        unitPriceBs: 0,
        grossLineTotalBs: 0,
        discountPercent: 0,
        discountBs: 0,
        lineTotalBs: 0,
        controlsStock: true,
      }],
      services: [],
      supplierFulfillmentPlan: [],
      responsibles: [],
      createdBy: 'Solicitud web',
      createdByName: 'Solicitud web',
      createdByRole: 'Cliente web',
      createdAt: '2026-09-07T16:23:21.211Z',
      updatedAt: '2026-09-07T16:23:21.211Z',
      deletedAt: null,
    }],
  });

  const updated = await bridge.quotes.update({
    id: 'quote-catalogo',
    items: [{
      lineKey: 'linea-catalogo',
      itemId: 'item-catalogo',
      quantity: 2,
      unitPriceBs: 20,
      grossLineTotalBs: 40,
      discountPercent: 0,
      discountBs: 0,
      lineTotalBs: 40,
      controlsStock: true,
    }],
    updatedById: 'usuario-ventas',
    updatedByName: 'VENDEDORA PRUEBA',
    updatedByRole: 'Ventas',
  });

  assert.equal(updated.items[0].unitPriceBs, 20);
  assert.equal(updated.totals.totalBs, 40);
  assert.equal(updated.awaitingAssignment, false);
  assert.equal(updated.publicRequestStatus, 'assigned');
  assert.deepEqual(updated.responsibles, [{
    id: 'usuario-ventas',
    name: 'VENDEDORA PRUEBA',
    role: 'Ventas',
    source: 'quote_editor',
  }]);
});
