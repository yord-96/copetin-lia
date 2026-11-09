import { getOutstandingInventoryLineQuantity } from './availability.js';

export const inventoryCommitmentDate = (timeZone = 'America/La_Paz') => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
};
const dateKey = value => String(value ?? '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';

export function peakInventoryCommitment(rows, todayKey) {
  const dates = new Set([todayKey]);
  rows.forEach(row => { dates.add(row.periodStartKey || todayKey); });
  let peak = 0;
  for (const date of dates) {
    const occupied = rows.reduce((sum, row) => date >= row.periodStartKey && date <= row.periodEndKey
      ? sum + Math.max(0, Math.abs(Number(row.deltaUnits ?? 0))) : sum, 0);
    peak = Math.max(peak, occupied);
  }
  return peak;
}

export function buildInventoryStockCommitments(rentals = [], { todayKey = inventoryCommitmentDate(), itemId = '' } = {}) {
  const rowsByItem = new Map();
  for (const rental of Array.isArray(rentals) ? rentals : []) {
    if (!rental || rental.deletedAt || rental.cancelledAt || rental.returnedAt) continue;
    const status = String(rental.status ?? '').trim().toLowerCase();
    const inventoryStatus = String(rental.operational?.inventoryStatus ?? '').trim().toLowerCase();
    if (!['active', 'confirmed', 'pending'].includes(status) || ['devuelto', 'anulado'].includes(inventoryStatus)) continue;
    const start = dateKey(rental.rentalDate || rental.deliveryDate) || todayKey;
    const originalEnd = dateKey(rental.dueDate || rental.pickupDate) || start;
    const outside = ['salio', 'retorno_parcial'].includes(inventoryStatus);
    const end = outside && originalEnd < todayKey ? todayKey : originalEnd;
    (rental.items ?? []).forEach((line, index) => {
      if (!line.itemId || (itemId && String(line.itemId) !== String(itemId)) || line.controlsStock === false || line.verificationStatus === 'pending_verification') return;
      const quantity = getOutstandingInventoryLineQuantity(rental, line, index);
      if (!quantity) return;
      const rows = rowsByItem.get(String(line.itemId)) || [];
      rows.push({ periodStartKey: start, periodEndKey: end < start ? start : end, deltaUnits: quantity });
      rowsByItem.set(String(line.itemId), rows);
    });
  }
  return new Map([...rowsByItem].map(([id, rows]) => [id, peakInventoryCommitment(rows, todayKey)]));
}
