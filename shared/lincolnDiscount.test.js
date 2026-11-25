import test from 'node:test';
import assert from 'node:assert/strict';
import { lincolnBaseDiscount } from './lincolnDiscount.js';
import { organizerTotals } from './lincolnOrganizerContract.js';
import { normalizeLincolnContractDocument, buildLincolnContractDocumentHtml } from '../server/services/lincoln/lincolnContractDocumentService.js';
import { normalizeOrganizerEvent } from '../server/services/lincoln/lincolnOrganizerService.js';

test('percent and fixed discounts apply only to base, including old percentage snapshots and rendered documents', () => {
  const event = { contractDocumentSnapshot: { guestCount: 100, pricePerPersonBs: 120,
    pricingGroups: [{ guestCount: 100, pricePerPersonBs: 120, selected: true }],
    extras: [{ selected: true, description: 'Servicio adicional', unitCostBs: 3000, quantity: 1 }], discountPercent: 10, advanceBs: 4000, guaranteeBs: 700 } };
  const doc = normalizeLincolnContractDocument(event);
  assert.equal(doc.totals.baseBs, 12000);
  assert.equal(doc.totals.extrasBs, 3000);
  assert.equal(doc.totals.discountBs, 1200);
  assert.equal(doc.totals.totalBs, 13800);
  assert.equal(doc.totals.totalPendingBs, 10500);
  assert.match(buildLincolnContractDocumentHtml({ event }), /sobre paquete base/);
  event.contractDocumentSnapshot.discountMode = 'fixed';
  event.contractDocumentSnapshot.discountAmountBs = 25;
  const fixed = normalizeLincolnContractDocument(event);
  assert.equal(fixed.totals.discountBs, 25);
  assert.equal(fixed.totals.totalBs, 14975);
  assert.match(buildLincolnContractDocumentHtml({ event }), /Descuento fijo sobre paquete base/);
  const saved = normalizeOrganizerEvent(event, {});
  assert.equal(saved.totalBs, 14975);
  assert.equal(saved.contractDocumentSnapshot.discountMode, 'fixed');
  assert.equal(normalizeLincolnContractDocument(saved).totals.discountBs, 25);
  assert.equal(lincolnBaseDiscount({ discountMode: 'fixed', discountAmountBs: 15000 }, 12000).discountBs, 12000);
  assert.equal(lincolnBaseDiscount({ discountPercent: 200 }, 12000).discountBs, 12000);
  assert.equal(lincolnBaseDiscount({ discountAmountBs: -25, discountMode: 'fixed' }, 12000).discountBs, 0);
});

test('organizer base rent excludes extra services from both discount types', () => {
  const draft = { organizerDays: [{ amountBs: 12000 }], extras: [{ selected: true, unitCostBs: 3000, quantity: 1 }], discountPercent: 10 };
  assert.equal(organizerTotals(draft).totalBs, 13800);
  assert.equal(organizerTotals({ ...draft, discountMode: 'fixed', discountAmountBs: 25 }).totalBs, 14975);
});
