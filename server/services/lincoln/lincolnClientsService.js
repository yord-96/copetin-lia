import { getLincolnStateSnapshot } from '../../storage/lincolnStateStore.js';

const normalize = (value) => String(value ?? '').trim().toLowerCase();
const money = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const monthKeyInLincoln = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? String(date.getFullYear());
  const month = parts.find((part) => part.type === 'month')?.value ?? String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const dateKey = (value) => String(value ?? '').slice(0, 10);
const isActiveClient = (client) => !['inactive', 'disabled', 'archived'].includes(normalize(client?.status));

export const getLincolnClientsOverview = async ({ query = '', status = 'all' } = {}) => {
  const snapshot = await getLincolnStateSnapshot();
  const state = snapshot.state ?? {};
  const clients = Array.isArray(state.clients) ? state.clients : [];
  const events = Array.isArray(state.events) ? state.events : [];
  const incomeEntries = Array.isArray(state.incomeEntries)
    ? state.incomeEntries.filter((row) => !row?.voidedAt)
    : [];

  const currentMonth = monthKeyInLincoln();
  const normalizedQuery = normalize(query);
  const normalizedStatus = normalize(status || 'all');

  const incomeByClient = new Map();
  incomeEntries.forEach((entry) => {
    const clientId = String(entry?.clientId ?? '').trim();
    if (!clientId) return;
    incomeByClient.set(clientId, (incomeByClient.get(clientId) ?? 0) + money(entry.amountBs));
  });

  const eventsByClient = new Map();
  events.forEach((event) => {
    const clientId = String(event?.clientId ?? '').trim();
    if (!clientId) return;
    if (!eventsByClient.has(clientId)) eventsByClient.set(clientId, []);
    eventsByClient.get(clientId).push(event);
  });

  const rows = clients
    .map((client) => {
      const clientEvents = eventsByClient.get(String(client.id)) ?? [];
      const orderedEvents = clientEvents
        .slice()
        .sort((a, b) => dateKey(b.eventDate).localeCompare(dateKey(a.eventDate)));
      const lastEvent = orderedEvents[0] ?? null;
      const active = isActiveClient(client);

      return {
        id: client.id,
        code: client.code ?? '',
        name: client.name ?? '',
        ci: client.ci ?? '',
        phone: client.phone ?? '',
        secondaryPhone: client.secondaryPhone ?? '',
        email: client.email ?? '',
        notes: client.notes ?? '',
        status: active ? 'active' : 'inactive',
        eventCount: clientEvents.length,
        lastEventDate: lastEvent?.eventDate ?? '',
        lastEventType: lastEvent?.eventType ?? '',
        incomeBs: Number((incomeByClient.get(String(client.id)) ?? 0).toFixed(2)),
        createdAt: client.createdAt ?? '',
      };
    })
    .filter((row) => {
      if (normalizedStatus === 'active' && row.status !== 'active') return false;
      if (normalizedStatus === 'inactive' && row.status !== 'inactive') return false;
      if (!normalizedQuery) return true;
      return [
        row.code,
        row.name,
        row.ci,
        row.phone,
        row.secondaryPhone,
        row.email,
      ].some((value) => normalize(value).includes(normalizedQuery));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

  const totalIncomeThisMonth = incomeEntries
    .filter((entry) => dateKey(entry.date ?? entry.createdAt).startsWith(currentMonth))
    .reduce((total, entry) => total + money(entry.amountBs), 0);

  const activeEvents = events.filter((event) => !['cancelled', 'completed'].includes(normalize(event.status))).length;
  const newClientsThisMonth = clients.filter((client) => String(client.createdAt ?? '').slice(0, 7) === currentMonth).length;

  return {
    revision: snapshot.revision,
    summary: {
      totalClients: clients.length,
      incomeThisMonthBs: Number(totalIncomeThisMonth.toFixed(2)),
      activeEvents,
      newClientsThisMonth,
    },
    rows,
  };
};
