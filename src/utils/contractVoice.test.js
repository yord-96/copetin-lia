import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceNumber, voiceDate, voiceContractCode, voiceCodeExists, voiceCatalogPrice, voiceProductChoice, voiceTime, voiceMoreAnswer, voiceResponsibleMatches } from './contractVoice.js';
import { photoReviewToContract } from './contractPhotoImport.js';

test('dictated numbers accept clear amounts and reject ambiguous grouping', () => {
  assert.equal(voiceNumber('260'), 260);
  assert.equal(voiceNumber('2,50 bolivianos.'), 2.5);
  assert.equal(voiceNumber('cero'), 0);
  assert.equal(voiceNumber('doscientos sesenta'), 260);
  assert.equal(voiceNumber('dos mil veintiséis'), 2026);
  assert.equal(voiceNumber('doce coma cincuenta'), 12.5);
  for (const text of ['2.500', '12 por 260', '-10', '', '1,2,3']) assert.equal(voiceNumber(text), null);
});
test('dates require explicit year and reject impossible calendar dates', () => {
  assert.equal(voiceDate('21 de noviembre de 2026.'), '2026-11-21');
  assert.equal(voiceDate('21/11/2026'), '2026-11-21');
  for (const text of ['21 de noviembre del 2026', 'veintiuno de noviembre del dos mil veintiséis', 'el 21 de nomviembre del 2026', '21 noviembre 2026']) assert.equal(voiceDate(text), '2026-11-21', text);
  assert.equal(voiceDate('treinta y uno de diciembre del dos mil veintiséis'), '2026-12-31');
  assert.equal(voiceDate('21 de noviembre, del 2.026.'), '2026-11-21');
  for (const text of ['mañana', '21 de noviembre', '31/02/2026']) assert.equal(voiceDate(text), '');
});
test('contract code normalizes speech and leading zeros, rejects duplicates including cancelled contracts', () => {
  assert.equal(voiceContractCode('tres mil quinientos seis'), '3506');
  assert.equal(voiceContractCode('Contrato 003506'), '3506');
  assert.equal(voiceContractCode('3.506'), '3506');
  assert.equal(voiceContractCode('automático'), '');
  assert.equal(voiceContractCode('3506 o 3507'), null);
  assert.equal(voiceCodeExists('3506', [{ id: 'c', contractCode: '003506', status: 'cancelled' }]), true);
  assert.equal(voiceCodeExists('3506', [{ contractCode: '3506', deletedAt: 'today' }]), false);
  assert.equal(voiceCodeExists('3506', [], [{ contractCode: '3506', status: 'active' }]), true);
  assert.equal(voiceCodeExists('3506', [], [{ contractCode: '3506', status: 'cancelled' }]), false);
  assert.equal(voiceCodeExists('3506', [{ id: 'c', contractCode: '3507' }], [{ contractId: 'c', contractCode: '3506' }]), false);
});
test('catalogue prices distinguish free, missing and invalid prices and choices do not guess variants', () => {
  assert.equal(voiceCatalogPrice({ rentalPriceBs: '12.5' }), 12.5);
  assert.equal(voiceCatalogPrice({ rentalPriceBs: 0 }), 0);
  for (const value of [null, undefined, '', ' ', false, -1, 'no']) assert.equal(voiceCatalogPrice({ rentalPriceBs: value }), null);
  const matches = [{ id: 'a', name: 'Silla Tiffany roja' }, { id: 'b', name: 'Silla Tiffany azul' }];
  assert.equal(voiceProductChoice('opción dos', matches)?.id, 'b');
  assert.equal(voiceProductChoice('la opción número dos', matches)?.id, 'b');
  assert.equal(voiceProductChoice('la azul', matches)?.id, 'b');
  assert.equal(voiceProductChoice('silla tiffany azul', matches)?.id, 'b');
  assert.equal(voiceProductChoice('silla tiffany', matches), null);
});
test('spoken event hours include afternoon and evening', () => {
  assert.equal(voiceTime('ocho de la noche'), '20:00');
  assert.equal(voiceTime('veinte horas'), '20:00');
  assert.equal(voiceTime('ocho y media de la noche'), '20:30');
  assert.equal(voiceTime('20:15'), '20:15');
  assert.equal(voiceTime('25:15'), '');
});
test('more-product responses recognize short confirmations without accepting uncertainty', () => {
  for (const text of ['sí', 'Si.', 'sí por favor']) assert.equal(voiceMoreAnswer(text), true);
  for (const text of ['no', 'No.', 'no gracias', 'no más']) assert.equal(voiceMoreAnswer(text), false);
  for (const text of ['no sé', 'sí o no', 'no, sí', '', '200']) assert.equal(voiceMoreAnswer(text), null);
});
test('responsible names ignore casing, accents and spoken introductions without guessing ambiguous people', () => {
  const people = [{ id: 'carla', name: 'CARLA TERCEROS' }, { id: 'other', name: 'CARLA PÉREZ' }, { id: 'deleted', name: 'CARLA TERCEROS', deletedAt: '2026-01-01' }];
  for (const value of ['carla terceros', 'la responsable Carla Terceros', 'La responsable del contrato es Carla Terceros.', 'quiero asignar a Carla Terceros', 'Carla Terceros como responsable', 'la señora Carla Terceros por favor', 'carla']) {
    if (value === 'carla') assert.equal(voiceResponsibleMatches(value, people).length, 2);
    else assert.deepEqual(voiceResponsibleMatches(value, people).map(row => row.id), ['carla'], value);
  }
  assert.deepEqual(voiceResponsibleMatches('carla pérez', people).map(row => row.id), ['other']);
  assert.equal(voiceResponsibleMatches('la responsable', people).length, 0);
  assert.equal(voiceResponsibleMatches('Carla Tercero', people).length, 0);
  assert.equal(voiceResponsibleMatches('Carla Terceros', [...people, { id: 'duplicate', name: 'Carla Terceros' }]).length, 2);
});
test('voice draft preserves catalogue IDs, totals, permissions and separate guarantee', () => {
  const items = [{ id: 'chair', name: 'Silla' }, { id: 'med', name: 'Medallón' }];
  const review = { customerName: 'Prueba', address: 'salón eterna Primavera tiquipaya', eventDate: '2026-11-21', guaranteeBs: 200, initialPaymentBs: 0, responsibleId: 'r',
    items: [{ selectedItemId: 'chair', description: 'Silla', quantity: 260, unitPriceBs: 12 }, { selectedItemId: 'med', description: 'Medallón', quantity: 30, unitPriceBs: 32 }] };
  const draft = photoReviewToContract(review, { items, responsibles: [{ id: 'r', name: 'Responsable' }], canChooseResponsibles: false, origin: 'voice' });
  assert.equal(draft.totals.totalBs, 4080);
  assert.equal(draft.guarantee.amountBs, 200);
  assert.equal(draft.payment.paidAtApprovalBs, 0);
  assert.deepEqual(draft.responsibles, []);
  assert.equal(draft.items[0].itemId, 'chair');
  assert.equal(draft.observations, '');
  assert.equal(draft.items[0].observation, '');
  assert.equal(draft.entryMethod, 'voice');
  assert.equal(draft.address, 'SALÓN ETERNA PRIMAVERA TIQUIPAYA');
  assert.deepEqual([draft.deliveryWindowStart, draft.deliveryWindowEnd, draft.deliveryTimeMode], ['08:00', '10:00', 'fixed']);
  assert.deepEqual([draft.pickupWindowStart, draft.pickupWindowEnd, draft.pickupTimeMode], ['20:00', '22:00', 'fixed']);
  assert.throws(() => photoReviewToContract({ ...review, items: [{ selectedItemId: 'unknown', quantity: 1, unitPriceBs: 12 }] }, { items }), /Selecciona el producto exacto/);
});
