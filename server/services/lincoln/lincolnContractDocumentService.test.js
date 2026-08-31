import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLincolnContractDocumentHtml,
  normalizeLincolnContractDocument,
} from './lincolnContractDocumentService.js';

const event = {
  id: 'EVE-1',
  contractCode: 'CON-0001',
  contractor1Name: 'ANA PEREZ',
  contractor1Ci: '123',
  contractor1Phone: '70000001',
  contractor2Name: 'LUIS ROJAS',
  contractor2Ci: '456',
  contractor2Phone: '70000002',
  eventType: '15 AÑOS',
  eventDate: '2026-09-12',
  startTime: '18:00',
  durationHours: 8,
  roomName: 'SALÓN GRANDE',
  reservationPaymentBs: 1000,
  accountPaymentBs: 4000,
  guaranteeBs: 700,
  packageSnapshot: {
    templateName: 'PAQUETE 15 AÑOS',
    variants: [
      { id: 'young', name: 'JÓVENES', pricePerPersonBs: 180 },
      { id: 'adult', name: 'ADULTOS', pricePerPersonBs: 190 },
    ],
  },
  contractDocumentSnapshot: {
    contractDate: '2026-08-27',
    packageName: 'PAQUETE 15 AÑOS',
    pricingGroups: [
      { variantId: 'young', name: 'JÓVENES', guestCount: 70, pricePerPersonBs: 180, selected: true },
      { variantId: 'adult', name: 'ADULTOS', guestCount: 80, pricePerPersonBs: 190, selected: true },
    ],
    services: [
      { id: 's1', category: 'CATERING', description: 'Bocaditos', variantIds: ['young'], selected: true },
      { id: 's2', category: 'MONTAJE', description: 'Montaje completo', variantIds: [], selected: true },
    ],
    extras: [{ id: 'e1', description: 'Servicio de torta', costMode: 'fixed_event', unitCostBs: 2550, quantity: 1, selected: true }],
    discountPercent: 10,
    advanceBs: 15000,
    guaranteeBs: 700,
    balanceDueDays: 7,
  },
};

test('normalizes mixed pricing groups and keeps guarantee outside service balance', () => {
  const document = normalizeLincolnContractDocument(event);
  assert.equal(document.guestCount, 150);
  assert.equal(document.totals.baseBs, 27800);
  assert.equal(document.totals.extrasBs, 2550);
  assert.equal(document.totals.discountBs, 3035);
  assert.equal(document.totals.totalBs, 27315);
  assert.equal(document.totals.balanceBs, 12315);
  assert.equal(document.guaranteeBs, 700);
});

test('renders the legal contract and package matrix as two professional pages', () => {
  const html = buildLincolnContractDocumentHtml({ event });
  assert.match(html, /CONTRATO DE SERVICIOS/);
  assert.match(html, /HOJA DE COSTOS Y SERVICIOS/);
  assert.match(html, /JÓVENES/);
  assert.match(html, /ADULTOS/);
  assert.match(html, /BASILIA HERBAS SAHONERO/);
  assert.equal((html.match(/<section class="page(?: |")/g) ?? []).length, 2);
});

test('charges a per-person extra only to the selected group in a mixed package', () => {
  const mixedEvent = structuredClone(event);
  mixedEvent.contractDocumentSnapshot.discountPercent = 0;
  mixedEvent.contractDocumentSnapshot.advanceBs = 0;
  mixedEvent.contractDocumentSnapshot.extras = [{
    id: 'e-young',
    description: 'Bar para jóvenes',
    costMode: 'per_person',
    unitCostBs: 10,
    quantity: 1,
    selected: true,
    variantIds: ['young'],
  }];
  const document = normalizeLincolnContractDocument(mixedEvent);
  assert.equal(document.totals.baseBs, 27800);
  assert.equal(document.totals.extrasBs, 700);
  assert.equal(document.totals.totalBs, 28500);
  assert.match(buildLincolnContractDocumentHtml({ event: mixedEvent }), /Bar para jóvenes<small>JÓVENES<\/small>/);
});
