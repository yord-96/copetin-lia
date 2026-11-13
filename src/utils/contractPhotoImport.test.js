import test from 'node:test';
import assert from 'node:assert/strict';
import { photoDate, photoTime, matchPhotoItems, preparePhotoReview, photoReviewToContract } from './contractPhotoImport.js';

// Manual transcriptions of the supplied photos exercise mapping, not OCR accuracy.
const items = [
  { id: 'chair', name: 'SILLA TIFFANY / DORADO', rentalPriceBs: 12 },
  { id: 'medallon', name: 'SILLA / MEDALLON DORADO', rentalPriceBs: 28 },
  { id: 'cup-a', name: 'TACITA + PLATILLO (2 PIEZAS)', rentalPriceBs: 2.5 },
  { id: 'cup-b', name: 'TAZA + PLATILLO', rentalPriceBs: 2.5 },
  { id: 'spoon-a', name: 'CUCHARILLA LISA TRAMONTINA', rentalPriceBs: 1 },
  { id: 'spoon-b', name: 'CUCHARILLA DORADA', rentalPriceBs: 1 },
];
const responsibles = [{ id: 'carla', name: 'CARLA TERCEROS', role: 'Solo asistencia' }];
const photo3506 = () => ({ contractCode: '003506', customerName: 'Nombre por revisar', customerPhone: '',
  responsibleName: 'Carla', eventDate: '2026-11-21', address: 'Paso', logisticsMode: 'recojo',
  guaranteeBs: 200, initialPaymentBs: null, writtenTotalBs: 4080, warnings: [], uncertainFields: ['customerName'],
  items: [{ description: 'Silla palitico', printedLabel: 'SILLA COCTELERA', quantity: 260, unitPriceBs: 12, writtenTotalBs: 3120, uncertain: true },
    { description: 'Medallón c/espalda', printedLabel: 'SILLAS', quantity: 30, unitPriceBs: 32, writtenTotalBs: 960, uncertain: false }] });

test('3506 separates 4080 rent from 200 guarantee, keeps 32 negotiated price and resolves Carla', () => {
  const review = preparePhotoReview(photo3506(), { items, responsibles });
  assert.equal(review.responsibleId, 'carla'); assert.equal(review.contractCode, '3506');
  assert.equal(review.items[0].selectedItemId, '', 'uncertain handwriting cannot select inventory');
  review.items[0].selectedItemId = 'chair'; review.items[1].selectedItemId = 'medallon';
  const record = photoReviewToContract(review, { items, responsibles, today: '2026-11-13' });
  assert.equal(record.totals.totalBs, 4080); assert.equal(record.totals.guaranteeBs, 200);
  assert.equal(record.guarantee.status, 'no_validado'); assert.equal(record.payment.paidAtApprovalBs, 0);
  assert.equal(record.items[1].unitPriceBs, 32); assert.equal(record.logisticsMode, 'recojo');
  assert.equal(record.pickupDateMode, 'coordinate'); assert.equal(record.deliveryTimeMode, 'coordinate');
  assert.equal(record.eventDate, '2026-11-21'); assert.equal(record.responsibles[0].id, 'carla');
  assert.equal(record.id, undefined); assert.deepEqual(record.supplierFulfillmentPlan, []);
});

test('3503 handwriting overrides printed labels and ambiguous catalog entries require selection', () => {
  const review = preparePhotoReview({ contractCode: '003503', customerName: 'HOTEL CAMINO PLAZA', eventDate: '2026-11-12',
    items: [{ description: 'Tacita + platillo', printedLabel: 'C. AGUA', quantity: 60, unitPriceBs: 2.5 },
      { description: 'Cucharillas', printedLabel: 'V. LARGOS', quantity: 36, unitPriceBs: 1.2 }] }, { items });
  assert.ok(review.items[0].matches.every(item => item.id.startsWith('cup')));
  assert.equal(review.items[0].selectedItemId, ''); assert.equal(review.items[1].selectedItemId, '');
  assert.throws(() => photoReviewToContract(review, { items }), /producto exacto/);
  review.items[0].selectedItemId = 'cup-b'; review.items[1].selectedItemId = 'spoon-a';
  const record = photoReviewToContract(review, { items });
  assert.equal(record.totals.totalBs, 193.2); assert.equal(record.items[1].unitPriceBs, 1.2);
  assert.equal(record.items.length, 2);
});

test('duplicate number is flagged without linking or overwriting the existing contract', () => {
  const existing = { id: 'original', contractCode: '3506' };
  const review = preparePhotoReview(photo3506(), { contracts: [existing], items });
  assert.equal(review.duplicate, true); assert.match(review.warnings.join(' '), /ya existe/);
  assert.deepEqual(existing, { id: 'original', contractCode: '3506' });
});

test('shared client phone and ambiguous responsible never silently choose a person', () => {
  const review = preparePhotoReview({ customerName: 'Hotel Camino Plaza', customerPhone: '72212369', responsibleName: 'Carla', items: [] }, {
    clients: [{ id: 'a', name: 'DAVID - HOTEL CAMINO PLAZA', phone: '72212369' }, { id: 'b', name: 'HOTEL CAMINO PLAZA', phone: '72212369' }],
    responsibles: [...responsibles, { id: 'c2', name: 'CARLA OTRO' }],
  });
  assert.equal(review.clientId, ''); assert.equal(review.clientMatches.length, 2); assert.equal(review.responsibleId, '');
});

test('unknown item must be explicitly marked free and keeps stock verification pending', () => {
  const review = preparePhotoReview({ customerName: 'Cliente', eventDate: '2026-11-21', items: [{ description: 'Especial', quantity: 2, unitPriceBs: 4 }] });
  assert.throws(() => photoReviewToContract(review), /producto exacto/);
  review.items[0].selectedItemId = '__free__';
  const record = photoReviewToContract(review);
  assert.equal(record.items[0].controlsStock, false); assert.equal(record.items[0].verificationStatus, 'pending_verification');
  assert.equal(record.items[0].quickItem.name, 'Especial');
});

test('invalid dates, missing quantities/prices and empty sheets cannot create a draft', () => {
  assert.equal(photoDate('2026-02-31'), ''); assert.equal(photoDate('2026-11-21'), '2026-11-21');
  const review = preparePhotoReview({ customerName: 'Cliente', items: [] });
  assert.equal(review.eventDate, ''); assert.throws(() => photoReviewToContract(review), /al menos un/);
  review.items = [{ selectedItemId: 'chair', quantity: '', unitPriceBs: 12 }]; review.eventDate = '2026-11-21';
  assert.throws(() => photoReviewToContract(review, { items }), /cantidad/);
  review.items[0].quantity = 1; review.items[0].unitPriceBs = '';
  assert.throws(() => photoReviewToContract(review, { items }), /precio/);
});

test('retired products are excluded and explicit time windows survive the handoff', () => {
  assert.equal(matchPhotoItems('Mesa', [{ id: 'retired', name: 'Mesa', deletedAt: '2026-01-01' }]).length, 0);
  assert.equal(photoTime('29:99'), '');
  const review = preparePhotoReview({ customerName: 'Cliente', eventDate: '2026-11-21',
    deliveryWindowStart: '08:00', deliveryWindowEnd: '10:00', deliveryTime: '08:00', items: [{ description: 'SILLA TIFFANY / DORADO', quantity: 1, unitPriceBs: 12 }] }, { items });
  const record = photoReviewToContract(review, { items });
  assert.equal(record.deliveryTimeMode, 'fixed'); assert.equal(record.deliveryWindowStart, '08:00');
  assert.match(record.observations, /Hora de entrega escrita: 08:00/);
});
