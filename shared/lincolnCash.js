export const cashMoney = value => Math.round((Number(value) || 0) * 100) / 100;
export const cashDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const cashPocket = method => String(method || 'cash').toLowerCase() === 'cash' ? 'cash' : 'digital';
export const cashMovementKey = (direction, id) => `${direction}:${id}`;
const active = row => !row.voidedAt && !row.deletedAt && row.status !== 'voided';

export function buildLincolnCashLedger(state, { from = '', to = '', destination = '', eventId = '', status = 'all', query = '' } = {}) {
  const receiptsById = new Map((state.receipts || []).map(row => [row.id, row]));
  const receiptsByPayment = new Map((state.receipts || []).filter(row => row.paymentId).map(row => [row.paymentId, row]));
  const ledger = [
    ...(state.incomeEntries || []).filter(active).map(row => ({ ...row, direction: 'income', key: cashMovementKey('income', row.id) })),
    ...(state.expenseEntries || []).filter(active).map(row => ({ ...row, direction: 'expense', key: cashMovementKey('expense', row.id) })),
  ].filter(row => !destination || row.destination === destination)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.key.localeCompare(b.key));
  let cashBs = 0, digitalBs = 0;
  const opening = { cashBs: 0, digitalBs: 0 };
  const closing = { cashBs: 0, digitalBs: 0 };
  const rows = [];
  for (const entry of ledger) {
    const amountBs = cashMoney(entry.amountBs);
    const delta = entry.direction === 'income' ? amountBs : -amountBs;
    if (cashPocket(entry.method) === 'cash') cashBs = cashMoney(cashBs + delta);
    else digitalBs = cashMoney(digitalBs + delta);
    if (from && entry.date < from) Object.assign(opening, { cashBs, digitalBs });
    if (!to || entry.date <= to) Object.assign(closing, { cashBs, digitalBs });
    if ((from && entry.date < from) || (to && entry.date > to)) continue;
    if (eventId && entry.eventId !== eventId) continue;
    if (status === 'pending' && entry.cashRenditionId) continue;
    if (status === 'rendered' && !entry.cashRenditionId) continue;
    const receipt = receiptsById.get(entry.receiptId) || receiptsByPayment.get(entry.paymentId);
    const row = { ...entry, receiptId: receipt?.id || entry.receiptId, receiptCode: receipt?.code || entry.receiptCode, amountBs, incomeBs: entry.direction === 'income' ? amountBs : 0, expenseBs: entry.direction === 'expense' ? amountBs : 0, cashBalanceBs: cashBs, digitalBalanceBs: digitalBs };
    if (query && !`${row.code} ${row.receiptCode || ''} ${row.eventCode || ''} ${row.clientName || ''} ${row.category || ''} ${row.description || ''} ${row.supplierName || ''}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))) continue;
    rows.push(row);
  }
  return { rows, opening, closing, incomeBs: cashMoney(rows.reduce((sum, row) => sum + row.incomeBs, 0)), expenseBs: cashMoney(rows.reduce((sum, row) => sum + row.expenseBs, 0)) };
}
