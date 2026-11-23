const dayValue = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
};

// Move logistics with the event, preserving the chosen duration in either direction.
export function updateDraftEventDate(current, value) {
  const previous = dayValue(current.eventDate);
  const next = dayValue(value);
  const shift = date => {
    const timestamp = dayValue(date);
    if (previous === null || next === null || timestamp === null) return value || date;
    return new Date(timestamp + next - previous).toISOString().slice(0, 10);
  };
  return {
    ...current,
    eventDate: value,
    deliveryDate: shift(current.deliveryDate),
    pickupDate: shift(current.pickupDate),
    ...(current.entityType !== 'contract' ? { validUntil: shift(current.validUntil) } : {}),
  };
}
