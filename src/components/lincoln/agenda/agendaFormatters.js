export const LINCOLN_AGENDA_MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

export const formatAgendaMonthTitle = (year, month) => {
  const date = new Date(Number(year), Number(month) - 1, 1);
  const label = new Intl.DateTimeFormat('es-BO', { month: 'long' }).format(date);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${year}`;
};

export const formatAgendaDate = (value, options = {}) => {
  const raw = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'Sin fecha';
  const parsed = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat('es-BO', {
    weekday: options.weekday ? 'long' : undefined,
    day: '2-digit',
    month: options.longMonth ? 'long' : 'short',
    year: 'numeric',
  }).format(parsed);
};

export const getAgendaKindClass = (item) => item?.isCancelled
  ? 'cancelled'
  : item?.kind === 'interested'
    ? 'interested'
    : item?.kind === 'reservation'
      ? 'reservation'
      : 'event';

export const getAgendaKindLabel = (item) => item?.kindLabel
  || (item?.kind === 'interested' ? 'Interesado' : item?.kind === 'reservation' ? 'Reserva' : 'Evento');
