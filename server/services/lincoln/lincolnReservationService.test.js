import test from 'node:test';
import assert from 'node:assert/strict';
import { getLincolnReservationAvailability, normalizeLincolnReservation } from './lincolnReservationService.js';

const baseState = {
  clients: [{ id: 'organizer-1', name: 'Organizadora Uno', phone: '70000001' }],
  rooms: [{ id: 'room-a', name: 'Salón A', status: 'active' }, { id: 'room-b', name: 'Salón B', status: 'active' }, { id: 'room-c', name: 'Salón C', status: 'active' }],
  reservations: [
    { id: 'lead-1', code: 'RES-1', status: 'lead', eventDate: '2026-10-10', roomId: 'room-a', clientName: 'Interesado' },
    { id: 'reserved-1', code: 'RES-2', status: 'confirmed', reservationPaymentBs: 500, eventDate: '2026-10-10', roomId: 'room-b', clientName: 'Reserva real' },
  ],
  events: [],
};

test('an interested lead does not block the date or room', () => {
  const availability = getLincolnReservationAvailability(baseState, { eventDate: '2026-10-10', roomId: 'room-a' });
  assert.equal(availability.interests.length, 1);
  assert.equal(availability.roomConflicts.length, 0);
  assert.equal(availability.isRoomFree, true);
});

test('a paid reservation blocks only its selected room', () => {
  assert.equal(getLincolnReservationAvailability(baseState, { eventDate: '2026-10-10', roomId: 'room-b' }).isRoomFree, false);
  assert.equal(getLincolnReservationAvailability(baseState, { eventDate: '2026-10-10', roomId: 'room-c' }).isRoomFree, true);
});

test('a legacy pending reservation remains blocking for compatibility', () => {
  const state = { ...baseState, reservations: [{ id: 'legacy', status: 'pending', eventDate: '2026-10-12', roomId: 'room-a' }] };
  assert.equal(getLincolnReservationAvailability(state, { eventDate: '2026-10-12', roomId: 'room-a' }).isRoomFree, false);
});

test('normalization stores independent contractors, organizer and amounts', () => {
  const record = normalizeLincolnReservation({
    contractor1Name: 'Ana Pérez', contractor1Ci: '123', contractor1Phone: '70000002',
    contractor2Name: 'Luis Rojas', contractor2Ci: '456', contractor2Phone: '70000003',
    organizerId: 'organizer-1', reservationDate: '2026-08-01', eventDate: '2026-10-11',
    eventType: 'BODA', durationHours: 6, roomId: 'room-a', reservationPaymentBs: 300,
    guaranteeBs: 200, accountPaymentBs: 1000,
  }, baseState);
  assert.equal(record.clientId, null);
  assert.equal(record.clientName, 'Ana Pérez');
  assert.equal(record.organizerName, 'Organizadora Uno');
  assert.equal(record.status, 'confirmed');
  assert.deepEqual([record.reservationPaymentBs, record.guaranteeBs, record.accountPaymentBs], [300, 200, 1000]);
});

test('a paid reservation cannot duplicate a committed room and date', () => {
  assert.throws(() => normalizeLincolnReservation({
    contractor1Name: 'Nueva pareja', reservationDate: '2026-08-01', eventDate: '2026-10-10',
    durationHours: 8, roomId: 'room-b', reservationPaymentBs: 100,
  }, baseState), (error) => error?.code === 'LINCOLN_ROOM_UNAVAILABLE');
});
