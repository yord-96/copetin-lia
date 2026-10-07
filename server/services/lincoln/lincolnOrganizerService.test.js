import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestedOrganizerRate, organizerTotals } from '../../../shared/lincolnOrganizerContract.js';
import { normalizeOrganizerEvent } from './lincolnOrganizerService.js';
import { getLincolnReservationAvailability } from './lincolnReservationService.js';
import { buildLincolnAgendaItems } from './lincolnAgendaService.js';
import { buildLincolnContractDocumentHtml, normalizeLincolnContractDocument } from './lincolnContractDocumentService.js';

const state = { rooms: [{ id: 'room', name: 'Salón grande' }], events: [], reservations: [] };
const payload = () => ({ id: 'event', status: 'contracted', contractType: 'organizer', totalBs: 1,
  organizerDays: [{ id: 'one', date: '2026-11-20', roomId: 'room', guestCount: 240, amountBs: 7680 }, { id: 'two', date: '2026-11-21', roomId: 'room', guestCount: 170, amountBs: 5000 }],
  contractDocumentSnapshot: { advanceBs: 3500, guaranteeBs: 500, extras: [
    { id: 'table', description: 'Mesa de vidrio', kind: 'rental', quantity: 1, unitCostBs: 300, dayId: 'one', selected: true },
    { id: 'cleaning', description: 'Limpieza', kind: 'service', quantity: 2, unitCostBs: 180, selected: true },
    { id: 'products', description: 'Productos adicionales', kind: 'sale', quantity: 1, unitCostBs: 137, selected: true },
  ] } });

test('reference bands charge a fixed hall fee, including boundaries', () => {
  assert.deepEqual([1,150,151,200,201,250,251,300,301].map(suggestedOrganizerRate), [7000,7000,8000,8000,9000,9000,10000,10000,null]);
});
test('document example totals are fixed per day, extras by quantity, guarantee separate', () => {
  const event = normalizeOrganizerEvent(payload(), state);
  assert.equal(event.totalBs, 13477);
  assert.equal(event.guestCount, 240);
  const doc = normalizeLincolnContractDocument(event);
  assert.deepEqual([doc.totals.baseBs,doc.totals.extrasBs,doc.totals.totalBs,doc.totals.balanceBs], [12680,797,13477,9977]);
  const html = buildLincolnContractDocumentHtml({ event });
  assert.match(html, /ALQUILER PARA ORGANIZADORES/);
  assert.match(html, /2026-11-21/);
  assert.match(html, /VENTA/);
  assert.doesNotMatch(html, /COSTO POR PERSONA/);
  assert.equal(organizerTotals({organizerDays:[{amountBs:7000,guestCount:150}],extras:[{quantity:.5,unitCostBs:100,costMode:'per_person'}]}).totalBs,7050);
});
test('each organizer day appears in agenda and blocks availability; editing excludes itself', () => {
  const event = normalizeOrganizerEvent(payload(), state);
  const occupied = {...state,events:[event]};
  assert.equal(buildLincolnAgendaItems(occupied).length, 2);
  assert.equal(getLincolnReservationAvailability(occupied,{eventDate:'2026-11-21',roomId:'room'}).isRoomFree,false);
  assert.throws(()=>normalizeOrganizerEvent({...payload(),id:'other'},occupied),error=>error.statusCode===409);
  assert.equal(normalizeOrganizerEvent(event,occupied,{excludeEventId:'event'}).totalBs,13477);
});
test('invalid dates, repeated hall dates and unknown extra days are rejected', () => {
  const invalid=payload();invalid.organizerDays[0].date='2026-02-30';
  assert.throws(()=>normalizeOrganizerEvent(invalid,state),/Fecha/);
  const duplicate=payload();duplicate.organizerDays[1].date=duplicate.organizerDays[0].date;
  assert.throws(()=>normalizeOrganizerEvent(duplicate,state),/repetirse/);
  const extra=payload();extra.contractDocumentSnapshot.extras[0].dayId='missing';
  assert.throws(()=>normalizeOrganizerEvent(extra,state),/no existe/);
});
