const isSummaryRow = (row) => Boolean(
  row?._summaryOnly || row?._accountingSummaryOnly || row?._calendarSummaryOnly,
);

const mergeSummaryFields = (current, incoming) => {
  const merged = { ...current, ...incoming };
  // Un campo omitido no es un borrado. Los null, arrays vacios y ceros
  // explicitos si deben actualizar el dato anterior.
  for (const [key, value] of Object.entries(incoming)) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && current?.[key] && typeof current[key] === 'object' && !Array.isArray(current[key])) {
      merged[key] = mergeSummaryFields(current[key], value);
    }
  }
  return merged;
};

export const mergeProgressiveRows = (currentRows, incomingRows) => {
  const currentById = new Map((Array.isArray(currentRows) ? currentRows : [])
    .map((row) => [String(row?.id ?? ''), row]));
  const incomingIds = new Set();
  const mergedIncoming = (Array.isArray(incomingRows) ? incomingRows : []).map((incoming) => {
    const incomingId = String(incoming?.id ?? '');
    if (incomingId) incomingIds.add(incomingId);
    const current = currentById.get(incomingId);
    if (!current) return incoming;
    if (!isSummaryRow(incoming)) return incoming;
    const merged = mergeSummaryFields(current, incoming);
    if (!isSummaryRow(current)) {
      // El resumen no convierte un registro completo en uno parcial.
      for (const key of Object.keys(merged)) {
        if (key.endsWith('SummaryOnly') || key === '_summaryOnly') delete merged[key];
      }
    }
    return merged;
  });
  const untouchedCurrent = (Array.isArray(currentRows) ? currentRows : [])
    .filter((row) => {
      const rowId = String(row?.id ?? '');
      return !rowId || !incomingIds.has(rowId);
    });
  return [...mergedIncoming, ...untouchedCurrent];
};
