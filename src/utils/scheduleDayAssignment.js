const dateKey = value => String(value || '').slice(0, 10);
const labelKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

// A date is editable; the day ID is the stable owner of its items and services.
export function findScheduleDayForLine(line, days, fallback = null) {
  const id = String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim();
  return (id ? days.find(day => String(day.id) === id) : null)
    ?? (line?.serviceDate || line?.date ? days.find(day => dateKey(day.date) === dateKey(line.serviceDate || line.date)) : null)
    ?? (line?.serviceDayLabel || line?.dayLabel ? days.find(day => labelKey(day.label) === labelKey(line.serviceDayLabel || line.dayLabel)) : null)
    ?? fallback ?? days[0] ?? null;
}

export function updateDraftScheduleDay(draft, dayId, updatedDay) {
  const updateLine = line => {
    const owner = findScheduleDayForLine(line, draft.scheduleDays || []);
    return owner?.id === dayId ? { ...line, serviceDayId: dayId, serviceDate: updatedDay.date, serviceDayLabel: updatedDay.label } : line;
  };
  return { ...draft, scheduleDays: draft.scheduleDays.map(day => day.id === dayId ? updatedDay : day),
    items: (draft.items || []).map(updateLine), services: (draft.services || []).map(updateLine) };
}
