import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContractTranscript } from './contractTranscript.js';
import { preparePhotoReview, photoReviewToContract } from './contractPhotoImport.js';

test('assisted transcript preserves existing client, agreed prices, dates and separate unpaid guarantee', () => {
  const items = [{ id: 'cup', name: 'COPA GOTA' }];
  const extraction = parseContractTranscript(JSON.stringify({ format: 'copetin-contract-transcript-v1',
    customerName: 'Eva', customerPhone: '70000001', contractCode: '3588', eventDate: '2026-12-05',
    eventTime: '20:00', deliveryDate: '2026-12-04', address: 'bosque norte', guaranteeBs: 100,
    items: [{ description: 'COPA GOTA', quantity: 50, unitPriceBs: 2.5 }] }));
  const review = preparePhotoReview(extraction, { items, clients: [{ id: 'existing', name: 'EVA MERIDA', phone: '70000001' }] });
  const source = photoReviewToContract(review, { items, origin: 'assisted' });
  assert.equal(source.clientId, 'existing');
  assert.equal(source.eventTime, '20:00');
  assert.equal(source.deliveryDate, '2026-12-04');
  assert.equal(source.address, 'BOSQUE NORTE');
  assert.equal(source.totals.totalBs, 125);
  assert.equal(source.guarantee.amountBs, 100);
  assert.equal(source.guarantee.status, 'no_validado');
  assert.equal(source.payment.paidAtApprovalBs, 0);
  assert.equal(source.pickupDateMode, 'coordinate');
  assert.equal(source.deliveryWindowStart, '08:00');
  assert.equal(source.entryMethod, undefined);
  assert.equal(source.observations, '');
  assert.equal(source.items[0].observation, '');
});

test('ambiguous existing clients remain unselected and a duplicate contract is detected', () => {
  const review = preparePhotoReview({ customerName: 'Eva', customerPhone: '70000001', contractCode: '3588', items: [] }, {
    clients: [{ id: 'a', name: 'Eva A', phone: '70000001' }, { id: 'b', name: 'Eva B', phone: '70000001' }],
    contracts: [{ id: 'c', contractCode: '3588' }],
  });
  assert.equal(review.clientId, ''); assert.equal(review.clientMatches.length, 2); assert.equal(review.duplicate, true);
  assert.throws(() => parseContractTranscript('{"format":"unknown"}'));
  assert.throws(() => parseContractTranscript(JSON.stringify({ format:'copetin-contract-transcript-v1', customerName:'Eva', items:[{description:'Cup', quantity:-1, unitPriceBs:2}] })));
});
