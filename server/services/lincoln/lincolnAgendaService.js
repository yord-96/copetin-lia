import { getLincolnStateSnapshot } from '../../storage/lincolnStateStore.js';

const normalizeText = (value) => String(value ?? '').trim().toLowerCase();
const dateKey = (value) => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? '';
};

const statusLabel = (status) => ({
  lead: 'Interesado',
  tentative: 'Tentativa',
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  converted: 'Convertida',
  cancelled: 'Cancelada',
  contract_pending: 'Contrato pendiente',
  contracted: 'Contratado',
  completed: 'Realizado',
}[normalizeText(status)] ?? String(status || 'Pendiente'));

const localTodayKey = (timeZone = 'America/La_Paz') => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const canonicalEvents = (events = []) => {
  const ordered = [...events]
    .filter((row) => row && dateKey(row.eventDate))
    .sort((left, right) => String(left.createdAt ?? left.updatedAt ?? '').localeCompare(String(right.createdAt ?? right.updatedAt ?? '')));
  const seenRelations = new Set();
  const result = [];
  ordered.forEach((event) => {
    const reservationId = String(event?.reservationId ?? '').trim();
    const relationKey = reservationId ? `reservation:${reservationId}` : `event:${event.id}`;
    if (seenRelations.has(relationKey)) return;
    seenRelations.add(relationKey);
    result.push(event);
  });
  return result;
};

const markerClassFor = (kind, cancelled) => cancelled
  ? 'cancelled'
  : kind === 'interested'
    ? 'interested'
    : kind === 'reservation' ? 'reservation' : 'event';

const agendaItem = ({ row, kind, eventDate, status, key }) => {
  const normalizedStatus = normalizeText(status);
  const cancelled = normalizedStatus === 'cancelled';
  return {
    key,
    id: row?.id ?? null,
    code: row?.code ?? '',
    kind,
    kindLabel: kind === 'interested' ? 'Interesado' : kind === 'reservation' ? 'Reserva' : 'Evento',
    markerClass: markerClassFor(kind, cancelled),
    displayStatus: normalizedStatus || (kind === 'interested' ? 'lead' : 'pending'),
    statusLabel: statusLabel(normalizedStatus || (kind === 'interested' ? 'lead' : 'pending')),
    isCancelled: cancelled,
    eventDate,
    startTime: String(row?.startTime ?? row?.time ?? '').trim(),
    clientName: String(row?.clientName ?? row?.name ?? row?.contactName ?? '').trim(),
    eventType: String(row?.eventType ?? row?.title ?? row?.eventName ?? '').trim(),
    roomName: String(row?.roomName ?? row?.room ?? '').trim(),
    reservationId: String(row?.reservationId ?? '').trim() || null,
    eventId: kind === 'event' ? row?.id ?? null : String(row?.eventId ?? '').trim() || null,
  };
};

export const buildLincolnAgendaItems = (state = {}) => {
  const events = canonicalEvents(Array.isArray(state.events) ? state.events : []);
  const linkedReservationIds = new Set(events.map((event) => String(event?.reservationId ?? '').trim()).filter(Boolean));
  const linkedEventIds = new Set(events.map((event) => String(event?.id ?? '').trim()).filter(Boolean));

  const eventItems = events.map((row) => agendaItem({
    row,
    kind: 'event',
    eventDate: dateKey(row.eventDate),
    status: row.status,
    key: `event:${row.id}`,
  }));

  const reservationItems = (Array.isArray(state.reservations) ? state.reservations : [])
    .filter((row) => dateKey(row?.eventDate))
    .filter((row) => normalizeText(row?.status) !== 'converted')
    .filter((row) => !linkedReservationIds.has(String(row?.id ?? '').trim()))
    .filter((row) => !linkedEventIds.has(String(row?.eventId ?? '').trim()))
    .map((row) => agendaItem({
      row,
      kind: 'reservation',
      eventDate: dateKey(row.eventDate),
      status: row.status,
      key: `reservation:${row.id}`,
    }));

  const leadItems = (Array.isArray(state.leads) ? state.leads : [])
    .map((row) => ({ row, eventDate: dateKey(row?.eventDate ?? row?.date) }))
    .filter(({ eventDate }) => Boolean(eventDate))
    .map(({ row, eventDate }) => agendaItem({
      row,
      kind: 'interested',
      eventDate,
      status: row.status || 'lead',
      key: `lead:${row.id}`,
    }));

  return [...leadItems, ...reservationItems, ...eventItems]
    .sort((left, right) => `${left.eventDate}${left.startTime}`.localeCompare(`${right.eventDate}${right.startTime}`));
};

const activeForSummary = (item) => !item.isCancelled;
const summarize = (items) => ({
  interested: items.filter((item) => activeForSummary(item) && item.kind === 'interested').length,
  reservations: items.filter((item) => activeForSummary(item) && item.kind === 'reservation').length,
  events: items.filter((item) => activeForSummary(item) && item.kind === 'event').length,
});

const monthPrefix = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
const validateYear = (value) => {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : null;
};
const validateMonth = (value) => {
  const month = Number(value);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
};

export const getLincolnAgendaMonth = async ({ year, month }) => {
  const parsedYear = validateYear(year);
  const parsedMonth = validateMonth(month);
  if (!parsedYear || !parsedMonth) {
    const error = new Error('Año o mes inválido para la agenda Lincoln.');
    error.statusCode = 400;
    error.code = 'LINCOLN_AGENDA_PERIOD_INVALID';
    throw error;
  }
  const snapshot = await getLincolnStateSnapshot();
  const items = buildLincolnAgendaItems(snapshot.state);
  const prefix = monthPrefix(parsedYear, parsedMonth);
  const activity = items.filter((item) => item.eventDate.startsWith(prefix));
  const days = activity.reduce((result, item) => {
    if (!result[item.eventDate]) result[item.eventDate] = [];
    result[item.eventDate].push(item);
    return result;
  }, {});
  const today = localTodayKey(snapshot.state?.company?.timezone || 'America/La_Paz');
  const upcomingEvents = items
    .filter((item) => item.kind === 'event' && !item.isCancelled && item.eventDate >= today)
    .slice(0, 5);

  return {
    year: parsedYear,
    month: parsedMonth,
    revision: snapshot.revision,
    summary: summarize(activity),
    days,
    activity,
    upcomingEvents,
  };
};

export const getLincolnAgendaYear = async ({ year }) => {
  const parsedYear = validateYear(year);
  if (!parsedYear) {
    const error = new Error('Año inválido para el radar Lincoln.');
    error.statusCode = 400;
    error.code = 'LINCOLN_AGENDA_YEAR_INVALID';
    throw error;
  }
  const snapshot = await getLincolnStateSnapshot();
  const items = buildLincolnAgendaItems(snapshot.state);
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const rows = items.filter((item) => item.eventDate.startsWith(monthPrefix(parsedYear, month)));
    return { month, ...summarize(rows) };
  });
  return { year: parsedYear, revision: snapshot.revision, months };
};
