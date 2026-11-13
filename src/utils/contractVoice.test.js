import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceNumber, voiceDate } from './contractVoice.js';
import { photoReviewToContract } from './contractPhotoImport.js';

test('dictated numbers accept clear amounts and reject ambiguous grouping', () => {
  assert.equal(voiceNumber('260'), 260);
  assert.equal(voiceNumber('2,50 bolivianos.'), 2.5);
  assert.equal(voiceNumber('cero'), 0);
  for (const text of ['2.500', '12 por 260', '-10', '', '1,2,3']) assert.equal(voiceNumber(text), null);
});
test('dates require explicit year and reject impossible calendar dates', () => {
  assert.equal(voiceDate('21 de noviembre de 2026.'), '2026-11-21');
  assert.equal(voiceDate('21/11/2026'), '2026-11-21');
  for (const text of ['mañana', '21 de noviembre', '31/02/2026']) assert.equal(voiceDate(text), '');
});
test('voice draft preserves catalogue IDs, totals, permissions and separate guarantee', () => {
  const items = [{ id: 'chair', name: 'Silla' }, { id: 'med', name: 'Medallón' }];
  const review = { customerName: 'Prueba', eventDate: '2026-11-21', guaranteeBs: 200, initialPaymentBs: 0, responsibleId: 'r',
    items: [{ selectedItemId: 'chair', description: 'Silla', quantity: 260, unitPriceBs: 12 }, { selectedItemId: 'med', description: 'Medallón', quantity: 30, unitPriceBs: 32 }] };
  const draft = photoReviewToContract(review, { items, responsibles: [{ id: 'r', name: 'Responsable' }], canChooseResponsibles: false, origin: 'voice' });
  assert.equal(draft.totals.totalBs, 4080);
  assert.equal(draft.guarantee.amountBs, 200);
  assert.equal(draft.payment.paidAtApprovalBs, 0);
  assert.deepEqual(draft.responsibles, []);
  assert.equal(draft.items[0].itemId, 'chair');
  assert.match(draft.observations, /asistente de voz/);
  assert.doesNotMatch(draft.observations, /foto/);
  assert.throws(() => photoReviewToContract({ ...review, items: [{ selectedItemId: 'unknown', quantity: 1, unitPriceBs: 12 }] }, { items }), /Selecciona el producto exacto/);
});
