const text = (value) => String(value ?? '').trim();
const normalized = (value) => text(value).toLowerCase();
const money = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(Math.max(0, parsed).toFixed(2)) : 0;
};
const dateKey = (value) => text(value).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';

const reservationBlocksDate = (reservation) => {
  const status = normalized(reservation?.status);
  if (['cancelled', 'converted', 'lead'].includes(status)) return false;
  if (reservation?.reservationPaymentBs !== undefined) return money(reservation.reservationPaymentBs) > 0;
  return ['pending', 'confirmed', 'tentative'].includes(status);
};

const eventBlocksDate = (event) => !['cancelled'].includes(normalized(event?.status));

export const getLincolnReservationAvailability = (state = {}, {
  eventDate = '',
  roomId = '',
  excludeReservationId = '',
  excludeEventId = '',
} = {}) => {
  const requestedDate = dateKey(eventDate);
  const requestedRoomId = text(roomId);
  if (!requestedDate) return { eventDate: '', commitments: [], interests: [], roomConflicts: [], isDateFree: false, isRoomFree: false };

  const reservations = (Array.isArray(state.reservations) ? state.reservations : [])
    .filter((row) => text(row?.id) !== text(excludeReservationId))
    .filter((row) => dateKey(row?.eventDate) === requestedDate)
    .map((row) => ({
      id: row.id,
      code: row.code ?? '',
      kind: reservationBlocksDate(row) ? 'reservation' : 'interested',
      clientName: row.contractor1Name ?? row.clientName ?? '',
      roomId: row.roomId ?? '',
      roomName: row.roomName ?? '',
      startTime: row.startTime ?? '',
      blocksDate: reservationBlocksDate(row),
    }));
  const events = (Array.isArray(state.events) ? state.events : [])
    .filter((row) => text(row?.id) !== text(excludeEventId))
    .filter((row) => text(row?.reservationId) !== text(excludeReservationId))
    .filter((row) => dateKey(row?.eventDate) === requestedDate)
    .filter(eventBlocksDate)
    .map((row) => ({
      id: row.id,
      code: row.code ?? '',
      kind: 'event',
      clientName: row.contractor1Name ?? row.clientName ?? '',
      roomId: row.roomId ?? '',
      roomName: row.roomName ?? '',
      startTime: row.startTime ?? '',
      blocksDate: true,
    }));
  const all = [...reservations, ...events];
  const commitments = all.filter((row) => row.blocksDate);
  const interests = all.filter((row) => !row.blocksDate);
  const roomConflicts = requestedRoomId
    ? commitments.filter((row) => text(row.roomId) === requestedRoomId)
    : [];

  return {
    eventDate: requestedDate,
    commitments,
    interests,
    roomConflicts,
    isDateFree: commitments.length === 0,
    isRoomFree: requestedRoomId ? roomConflicts.length === 0 : commitments.length === 0,
  };
};

const validationError = (message, code) => {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
};

export const normalizeLincolnReservation = (payload, state = {}, { existing = null } = {}) => {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const contractor1Name = text(source.contractor1Name ?? source.clientName);
  const contractor1Ci = text(source.contractor1Ci ?? source.clientCi);
  const contractor1Phone = text(source.contractor1Phone ?? source.clientPhone);
  const contractor2Name = text(source.contractor2Name ?? source.secondContractorName);
  const contractor2Ci = text(source.contractor2Ci ?? source.secondContractorCi);
  const contractor2Phone = text(source.contractor2Phone ?? source.secondContractorPhone);
  const reservationDate = dateKey(source.reservationDate ?? existing?.reservationDate ?? existing?.createdAt);
  const eventDate = dateKey(source.eventDate);
  const roomId = text(source.roomId);
  const durationHours = Number(source.durationHours ?? 8);
  const reservationPaymentBs = money(source.reservationPaymentBs);
  const guaranteeBs = money(source.guaranteeBs);
  const accountPaymentBs = money(source.accountPaymentBs);

  if (!contractor1Name) throw validationError('Debes indicar el nombre del contratante 1.', 'LINCOLN_CONTRACTOR_REQUIRED');
  if (!reservationDate) throw validationError('Debes indicar la fecha en que se registró la reserva.', 'LINCOLN_RESERVATION_DATE_REQUIRED');
  if (!eventDate) throw validationError('Debes indicar la fecha del evento.', 'LINCOLN_EVENT_DATE_REQUIRED');
  if (!roomId) throw validationError('Debes seleccionar un salón.', 'LINCOLN_ROOM_REQUIRED');
  if (!Number.isFinite(durationHours) || durationHours <= 0) throw validationError('La duración del evento debe ser mayor a cero.', 'LINCOLN_DURATION_INVALID');

  const room = (Array.isArray(state.rooms) ? state.rooms : [])
    .find((row) => text(row?.id) === roomId && normalized(row?.status) !== 'inactive');
  if (!room) throw validationError('El salón seleccionado ya no está disponible.', 'LINCOLN_ROOM_INVALID');
  const organizer = (Array.isArray(state.clients) ? state.clients : [])
    .find((row) => text(row?.id) === text(source.organizerId));
  const availability = getLincolnReservationAvailability(state, {
    eventDate,
    roomId,
    excludeReservationId: existing?.id,
    excludeEventId: existing?.eventId,
  });
  if (reservationPaymentBs > 0 && availability.roomConflicts.length) {
    const conflict = availability.roomConflicts[0];
    throw validationError(
      `El salón ya está comprometido en esa fecha por ${conflict.code || conflict.clientName || 'otro evento'}.`,
      'LINCOLN_ROOM_UNAVAILABLE',
    );
  }

  const protectedStatus = ['cancelled', 'converted'].includes(normalized(source.status))
    ? normalized(source.status)
    : null;
  return {
    ...source,
    clientId: null,
    clientName: contractor1Name,
    clientCi: contractor1Ci,
    clientPhone: contractor1Phone,
    contractor1Name,
    contractor1Ci,
    contractor1Phone,
    contractor2Name,
    contractor2Ci,
    contractor2Phone,
    secondContractorName: contractor2Name,
    secondContractorCi: contractor2Ci,
    secondContractorPhone: contractor2Phone,
    organizerId: organizer?.id ?? null,
    organizerName: organizer?.name ?? '',
    organizerPhone: organizer?.phone ?? '',
    reservationDate,
    eventDate,
    eventType: text(source.eventType),
    startTime: text(source.startTime),
    durationHours: Number(durationHours.toFixed(2)),
    roomId,
    roomName: text(room.name),
    reservationPaymentBs,
    guaranteeBs,
    accountPaymentBs,
    estimatedTotalBs: money(source.estimatedTotalBs),
    status: protectedStatus ?? (reservationPaymentBs > 0 ? 'confirmed' : 'lead'),
  };
};
