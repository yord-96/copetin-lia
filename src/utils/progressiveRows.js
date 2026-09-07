export const mergeProgressiveRows = (currentRows, incomingRows) => {
  const currentById = new Map((Array.isArray(currentRows) ? currentRows : [])
    .map((row) => [String(row?.id ?? ''), row]));
  const incomingIds = new Set();
  const mergedIncoming = (Array.isArray(incomingRows) ? incomingRows : []).map((incoming) => {
    const incomingId = String(incoming?.id ?? '');
    if (incomingId) incomingIds.add(incomingId);
    const current = currentById.get(incomingId);
    if (!current) return incoming;
    const currentIsFull = !current?._summaryOnly && !current?._accountingSummaryOnly;
    if (!currentIsFull) return incoming;
    return {
      ...current,
      ...incoming,
      payment: { ...(current?.payment ?? {}), ...(incoming?.payment ?? {}) },
      totals: { ...(current?.totals ?? {}), ...(incoming?.totals ?? {}) },
      guarantee: { ...(current?.guarantee ?? {}), ...(incoming?.guarantee ?? {}) },
      returnSettlement: incoming?.returnSettlement
        ? { ...(current?.returnSettlement ?? {}), ...incoming.returnSettlement }
        : null,
      _summaryOnly: current?._summaryOnly,
      _accountingSummaryOnly: false,
    };
  });
  const untouchedCurrent = (Array.isArray(currentRows) ? currentRows : [])
    .filter((row) => {
      const rowId = String(row?.id ?? '');
      return !rowId || !incomingIds.has(rowId);
    });
  return [...mergedIncoming, ...untouchedCurrent];
};
