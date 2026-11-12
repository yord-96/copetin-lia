// Prior bookings are uses of the same stock across dates, not new physical units.
// Group multiple lines for a product within one booking before showing its count.
export function groupPriorAvailabilityRecords(records = []) {
  const grouped = new Map();
  for (const record of records) {
    const key = [record.rentalId || record.id || record.contractId || record.orderCode || record.contractCode || record.code,
      record.startDate, record.startTime, record.endDate, record.endTime].join('|');
    const existing = grouped.get(key);
    if (existing) existing.quantity += Math.max(0, Number(record.quantity) || 0);
    else grouped.set(key, { ...record, quantity: Math.max(0, Number(record.quantity) || 0) });
  }
  return [...grouped.values()].sort((a, b) =>
    [b.endDate || '', b.endTime || ''].join(' ').localeCompare([a.endDate || '', a.endTime || ''].join(' ')));
}
