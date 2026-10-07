import { organizerTotals } from '../../../shared/lincolnOrganizerContract.js';
import { getLincolnReservationAvailability } from './lincolnReservationService.js';

export const normalizeOrganizerEvent = (payload, state, { excludeEventId = '', excludeReservationId = '' } = {}) => {
  if ((payload.contractType || payload.contractDocumentSnapshot?.contractType) !== 'organizer') return payload;
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { statusCode: status, code: 'LINCOLN_ORGANIZER_INVALID' }); };
  const snapshot = payload.contractDocumentSnapshot || {};
  const rawDays = payload.organizerDays || snapshot.organizerDays;
  if (!Array.isArray(rawDays) || !rawDays.length || rawDays.length > 30) fail('Indica entre 1 y 30 jornadas de alquiler.');
  const occupied = new Set();
  const days = rawDays.map((day, index) => {
    if (!day || typeof day !== 'object') fail('Jornada inválida.');
    const room = state.rooms.find(row => String(row.id) === String(day.roomId));
    const date = String(day.date || '');
    if (!room || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00`)) || !Number.isInteger(Number(day.guestCount)) || Number(day.guestCount) <= 0 || !Number.isFinite(Number(day.amountBs)) || Number(day.amountBs) <= 0) fail('Completa fecha, salón, asistentes y precio de cada jornada.');
    const key = `${date}:${room.id}`;
    if (new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) fail('Fecha de jornada inválida.');
    if (occupied.has(key)) fail('El mismo salón y fecha no pueden repetirse en las jornadas.');
    occupied.add(key);
    if (payload.status !== 'cancelled' && !getLincolnReservationAvailability(state, { eventDate: date, roomId: room.id, excludeEventId, excludeReservationId }).isRoomFree) fail(`El salón ${room.name} no está disponible el ${date}.`, 409);
    return { ...day, id: String(day.id || `day-${index + 1}`), date, roomId: room.id, roomName: room.name, guestCount: Number(day.guestCount), amountBs: Number(Number(day.amountBs).toFixed(2)) };
  });
  if (snapshot.extras != null && !Array.isArray(snapshot.extras)) fail('Lista de extras inválida.');
  const extras = (snapshot.extras || []).map(line => {
    if (!line || typeof line !== 'object') fail('Extra inválido.');
    if (!String(line.description || '').trim() || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || !Number.isFinite(Number(line.unitCostBs)) || Number(line.unitCostBs) < 0) fail('Revisa descripción, cantidad y precio de cada extra.');
    if (line.dayId && !days.some(day => day.id === line.dayId)) fail('La jornada asignada a un extra no existe.');
    return { ...line, kind: ['rental', 'sale', 'service'].includes(line.kind) ? line.kind : 'service', costMode: 'per_event', variantIds: [], quantity: Number(line.quantity), unitCostBs: Number(Number(line.unitCostBs).toFixed(2)), selected: line.selected !== false };
  });
  const discountPercent = Math.min(100, Math.max(0, Number(snapshot.discountPercent) || 0));
  const contractDocumentSnapshot = { ...snapshot, discountPercent, contractType: 'organizer', organizerDays: days, services: [], pricingGroups: [], extras, eventDate: days[0].date, roomId: days[0].roomId, roomName: days[0].roomName };
  const totals = organizerTotals(contractDocumentSnapshot);
  contractDocumentSnapshot.totals = totals;
  contractDocumentSnapshot.guestCount = totals.guestCount;
  return { ...payload, contractType: 'organizer', organizerDays: days, contractDocumentSnapshot, eventDate: days[0].date, roomId: days[0].roomId, roomName: days[0].roomName, guestCount: totals.guestCount, estimatedTotalBs: totals.totalBs, totalBs: totals.totalBs };
};
