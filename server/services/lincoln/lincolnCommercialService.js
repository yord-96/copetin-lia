import { getLincolnStateSnapshot } from '../../storage/lincolnStateStore.js';

const asText = (value) => String(value ?? '').trim();
const normalize = (value) => asText(value).toLocaleLowerCase('es-BO');
const money = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};

const reservationStatusLabel = (status) => ({
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  cancelled: 'Anulada',
  converted: 'Convertida',
}[asText(status).toLowerCase()] ?? asText(status || 'Pendiente'));

const contractStatusLabel = (status) => ({
  contract_pending: 'Contrato pendiente',
  contracted: 'Contratado',
  completed: 'Realizado',
  cancelled: 'Anulado',
}[asText(status).toLowerCase()] ?? asText(status || 'Contrato pendiente'));

const activePaymentsForEvent = (state, eventId) => (state.payments ?? []).filter((payment) => (
  asText(payment?.eventId) === asText(eventId) && !payment?.voidedAt
));

const eventFinancial = (state, event) => {
  const paid = activePaymentsForEvent(state, event.id)
    .filter((payment) => ['advance', 'installment', 'balance'].includes(asText(payment.type).toLowerCase()))
    .reduce((total, payment) => total + money(payment.amountBs), 0);
  const total = money(event.totalBs ?? event.estimatedTotalBs ?? 0);
  return { totalBs: total, paidBs: money(paid), balanceBs: Math.max(0, money(total - paid)) };
};

const canonicalEvents = (events = []) => {
  const result = [];
  const seenReservationIds = new Set();
  const seenIds = new Set();
  for (const event of events) {
    if (!event?.id || seenIds.has(String(event.id))) continue;
    const reservationId = asText(event.reservationId);
    if (reservationId && seenReservationIds.has(reservationId)) continue;
    seenIds.add(String(event.id));
    if (reservationId) seenReservationIds.add(reservationId);
    result.push(event);
  }
  return result;
};

const parseSequence = (code) => {
  const match = asText(code).match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
};

export const getLincolnCommercialOverview = async ({ query = '', status = 'all', from = '', to = '' } = {}) => {
  const snapshot = await getLincolnStateSnapshot();
  const state = snapshot.state;
  const events = canonicalEvents(state.events ?? []);
  const linkedReservationIds = new Set(events.map((event) => asText(event.reservationId)).filter(Boolean));
  const linkedEventIds = new Set(events.map((event) => asText(event.id)).filter(Boolean));

  const reservationRows = (state.reservations ?? [])
    .filter((reservation) => {
      if (asText(reservation.status).toLowerCase() === 'converted') return false;
      if (linkedReservationIds.has(asText(reservation.id))) return false;
      if (asText(reservation.eventId) && linkedEventIds.has(asText(reservation.eventId))) return false;
      return true;
    })
    .map((reservation) => ({
      key: `reservation:${reservation.id}`,
      id: reservation.id,
      kind: 'reservation',
      kindLabel: 'Reserva',
      code: reservation.code,
      clientId: reservation.clientId ?? null,
      clientName: reservation.clientName ?? '',
      clientPhone: reservation.clientPhone ?? '',
      eventType: reservation.eventType ?? '',
      eventDate: reservation.eventDate ?? '',
      startTime: reservation.startTime ?? '',
      roomName: reservation.roomName ?? '',
      guestCount: Number(reservation.guestCount ?? 0),
      totalBs: money(reservation.estimatedTotalBs ?? 0),
      balanceBs: null,
      status: reservation.status ?? 'pending',
      statusLabel: reservationStatusLabel(reservation.status),
      reservationId: reservation.id,
      eventId: null,
      updatedAt: reservation.updatedAt ?? reservation.createdAt ?? '',
    }));

  const contractRows = events.map((event) => {
    const financial = eventFinancial(state, event);
    return {
      key: `contract:${event.id}`,
      id: event.id,
      kind: 'contract',
      kindLabel: 'Contrato',
      code: event.code,
      clientId: event.clientId ?? null,
      clientName: event.clientName ?? '',
      clientPhone: event.clientPhone ?? '',
      eventType: event.eventType ?? '',
      eventDate: event.eventDate ?? '',
      startTime: event.startTime ?? '',
      roomName: event.roomName ?? '',
      guestCount: Number(event.guestCount ?? 0),
      totalBs: financial.totalBs,
      balanceBs: financial.balanceBs,
      status: event.status ?? 'contract_pending',
      statusLabel: contractStatusLabel(event.status),
      reservationId: event.reservationId ?? null,
      eventId: event.id,
      updatedAt: event.updatedAt ?? event.createdAt ?? '',
    };
  });

  const q = normalize(query);
  const normalizedStatus = normalize(status || 'all');
  const rows = [...reservationRows, ...contractRows]
    .filter((row) => {
      if (q) {
        const haystack = normalize(`${row.code} ${row.clientName} ${row.clientPhone} ${row.eventType} ${row.roomName} ${row.statusLabel}`);
        if (!haystack.includes(q)) return false;
      }
      if (normalizedStatus !== 'all') {
        if (normalizedStatus === 'reservations' && row.kind !== 'reservation') return false;
        else if (normalizedStatus === 'contracts' && row.kind !== 'contract') return false;
        else if (!['reservations', 'contracts'].includes(normalizedStatus) && normalize(row.status) !== normalizedStatus) return false;
      }
      if (from && asText(row.eventDate) < asText(from)) return false;
      if (to && asText(row.eventDate) > asText(to)) return false;
      return true;
    })
    .sort((a, b) => {
      const byDate = asText(b.eventDate).localeCompare(asText(a.eventDate));
      return byDate || asText(b.updatedAt).localeCompare(asText(a.updatedAt));
    });

  const activeReservations = reservationRows.filter((row) => !['cancelled'].includes(asText(row.status).toLowerCase()));
  const activeContracts = contractRows.filter((row) => !['cancelled'].includes(asText(row.status).toLowerCase()));
  const sequences = contractRows.map((row) => parseSequence(row.code)).filter((value) => value > 0);
  const currentNumber = sequences.length ? Math.max(...sequences) : 0;

  return {
    revision: snapshot.revision,
    summary: {
      reservations: activeReservations.length,
      contracts: activeContracts.length,
      currentNumber,
      nextNumber: currentNumber + 1,
    },
    rows,
  };
};
