import { getLincolnStateSnapshot } from '../../storage/lincolnStateStore.js';

const roundMoney = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};

const sumMoney = (rows) => roundMoney(rows.reduce((total, row) => total + roundMoney(row?.amountBs), 0));
const activeRows = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => !row?.voidedAt && row?.status !== 'voided');
const SERVICE_TYPES = new Set(['advance', 'installment', 'balance']);

const eventDateValue = (event) => String(event?.eventDate ?? '').slice(0, 10);
const sortEvents = (a, b) => eventDateValue(b).localeCompare(eventDateValue(a)) || String(b?.createdAt ?? '').localeCompare(String(a?.createdAt ?? ''));

const settlementForEvent = (state, event) => {
  const payments = activeRows(state.payments).filter((row) => String(row?.eventId ?? '') === String(event.id));
  const expenses = activeRows(state.expenseEntries).filter((row) => String(row?.eventId ?? '') === String(event.id));
  const serviceIncome = payments.filter((row) => SERVICE_TYPES.has(String(row?.type ?? '').toLowerCase()));
  const replacements = payments.filter((row) => String(row?.type ?? '').toLowerCase() === 'replacement');
  const guaranteeCollected = payments.filter((row) => String(row?.type ?? '').toLowerCase() === 'guarantee');
  const guaranteeReturned = payments.filter((row) => String(row?.type ?? '').toLowerCase() === 'guarantee_return');
  const operatingExpenses = expenses.filter((row) => String(row?.category ?? '').toUpperCase() !== 'DEVOLUCION GARANTIA' && !row?.paymentId);
  const serviceIncomeBs = sumMoney(serviceIncome);
  const replacementIncomeBs = sumMoney(replacements);
  const operatingIncomeBs = roundMoney(serviceIncomeBs + replacementIncomeBs);
  const operatingExpenseBs = sumMoney(operatingExpenses);
  const utilityBs = roundMoney(operatingIncomeBs - operatingExpenseBs);
  const guaranteeCollectedBs = sumMoney(guaranteeCollected);
  const guaranteeReturnedBs = sumMoney(guaranteeReturned);
  const settlement = (Array.isArray(state.eventSettlements) ? state.eventSettlements : [])
    .find((row) => String(row?.eventId ?? '') === String(event.id));

  return {
    id: settlement?.id ?? null,
    eventId: event.id,
    eventCode: event.code ?? '',
    eventDate: event.eventDate ?? '',
    eventType: event.eventType ?? '',
    clientName: event.clientName ?? '',
    roomName: event.roomName ?? '',
    eventStatus: event.status ?? '',
    settlementStatus: settlement?.status ?? 'open',
    closedAt: settlement?.closedAt ?? null,
    closedByName: settlement?.closedByName ?? null,
    serviceIncomeBs,
    replacementIncomeBs,
    operatingIncomeBs,
    operatingExpenseBs,
    utilityBs,
    guaranteeCollectedBs,
    guaranteeReturnedBs,
    guaranteeHeldBs: Math.max(0, roundMoney(guaranteeCollectedBs - guaranteeReturnedBs)),
    expenseCount: operatingExpenses.length,
    paymentCount: serviceIncome.length + replacements.length,
  };
};

const requireEvent = (state, eventId) => {
  const event = (Array.isArray(state.events) ? state.events : []).find((row) => String(row?.id ?? '') === String(eventId ?? ''));
  if (!event) {
    const error = new Error('Evento Lincoln no encontrado.');
    error.statusCode = 404;
    error.code = 'LINCOLN_EVENT_NOT_FOUND';
    throw error;
  }
  return event;
};

export const getLincolnSettlements = async ({ year = '', status = 'all', query = '' } = {}) => {
  const snapshot = await getLincolnStateSnapshot();
  const state = snapshot.state;
  const normalizedYear = String(year ?? '').trim();
  const normalizedStatus = String(status ?? 'all').trim().toLowerCase();
  const normalizedQuery = String(query ?? '').trim().toLocaleLowerCase('es-BO');
  const rows = [...(Array.isArray(state.events) ? state.events : [])]
    .sort(sortEvents)
    .map((event) => settlementForEvent(state, event))
    .filter((row) => !normalizedYear || String(row.eventDate).startsWith(`${normalizedYear}-`))
    .filter((row) => normalizedStatus === 'all' || row.settlementStatus === normalizedStatus)
    .filter((row) => !normalizedQuery || `${row.eventCode} ${row.clientName} ${row.eventType} ${row.roomName}`.toLocaleLowerCase('es-BO').includes(normalizedQuery));

  return {
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    rows,
    summary: {
      events: rows.length,
      open: rows.filter((row) => row.settlementStatus !== 'closed').length,
      closed: rows.filter((row) => row.settlementStatus === 'closed').length,
      incomeBs: roundMoney(rows.reduce((total, row) => total + row.operatingIncomeBs, 0)),
      expenseBs: roundMoney(rows.reduce((total, row) => total + row.operatingExpenseBs, 0)),
      utilityBs: roundMoney(rows.reduce((total, row) => total + row.utilityBs, 0)),
    },
  };
};

export const getLincolnSettlementDetail = async ({ eventId }) => {
  const snapshot = await getLincolnStateSnapshot();
  const state = snapshot.state;
  const event = requireEvent(state, eventId);
  const summary = settlementForEvent(state, event);
  const payments = activeRows(state.payments)
    .filter((row) => String(row?.eventId ?? '') === String(event.id))
    .filter((row) => SERVICE_TYPES.has(String(row?.type ?? '').toLowerCase()) || String(row?.type ?? '').toLowerCase() === 'replacement')
    .sort((a, b) => `${a?.date ?? ''}${a?.createdAt ?? ''}`.localeCompare(`${b?.date ?? ''}${b?.createdAt ?? ''}`));
  const expenses = activeRows(state.expenseEntries)
    .filter((row) => String(row?.eventId ?? '') === String(event.id))
    .filter((row) => String(row?.category ?? '').toUpperCase() !== 'DEVOLUCION GARANTIA' && !row?.paymentId)
    .sort((a, b) => `${a?.date ?? ''}${a?.createdAt ?? ''}`.localeCompare(`${b?.date ?? ''}${b?.createdAt ?? ''}`));
  const guaranteeMovements = activeRows(state.payments)
    .filter((row) => String(row?.eventId ?? '') === String(event.id))
    .filter((row) => ['guarantee', 'guarantee_return'].includes(String(row?.type ?? '').toLowerCase()));

  return {
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    event,
    summary,
    payments,
    expenses,
    guaranteeMovements,
  };
};
