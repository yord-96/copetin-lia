const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Combos are virtual stock: their components remain the source of inventory totals.
export function getComboAvailabilityRows({ combos = [], items = [], availability = new Map() }) {
  const activeItems = items.filter((item) => item && !item.deletedAt);
  const byId = new Map(activeItems.map((item) => [String(item.id), item]));
  return combos.filter((combo) => combo && !combo.deletedAt).map((combo) => {
    const components = (combo.ingredients ?? []).map((rule) => {
      const ids = [...new Set((rule.optionItemIds?.length ? rule.optionItemIds : [rule.itemId]).map(String))];
      const options = rule.selectionMode === 'category' && rule.category
        ? activeItems.filter((item) => normalize(item.category) === normalize(rule.category))
        : ids.map((id) => byId.get(id)).filter(Boolean);
      return { quantity: Math.max(1, Math.trunc(Number(rule.quantity) || 1)), summaries: options.map((item) => availability.get(String(item.id))).filter(Boolean) };
    });
    const capacity = (field) => components.length ? Math.min(...components.map(({ quantity, summaries }) =>
      Math.floor(summaries.reduce((sum, summary) => sum + Math.max(0, Number(summary[field]) || 0), 0) / quantity))) : 0;
    const totalStock = capacity('totalStock');
    const projectedAvailable = capacity('projectedAvailable');
    const projectedAfterSoftAvailable = capacity('projectedAfterSoftAvailable');
    return {
      item: { ...combo, id: `combo:${combo.id}`, category: combo.category || 'COMBOS', isCombo: true },
      stockControlled: components.length > 0 && components.every(({ summaries }) => summaries.length > 0 && summaries.every((summary) => summary.stockControlled)),
      totalStock,
      currentAvailable: capacity('currentAvailable'),
      projectedAvailable,
      projectedAfterSoftAvailable,
      hardReservedQty: Math.max(0, totalStock - projectedAvailable),
      softReservedQty: Math.max(0, projectedAvailable - projectedAfterSoftAvailable),
      hardReservedQtyRecords: [],
      softReservedQtyRecords: [],
    };
  });
}
