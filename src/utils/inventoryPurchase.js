export const inventoryBusinessDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export const normalizeInventoryPurchase = (payload) => {
  const purchaseDate = String(payload.purchaseDate ?? '').trim();
  if (purchaseDate && (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)
    || Number.isNaN(Date.parse(`${purchaseDate}T12:00:00Z`))
    || new Date(`${purchaseDate}T12:00:00Z`).toISOString().slice(0, 10) !== purchaseDate
    || purchaseDate > inventoryBusinessDate())) {
    throw new Error('La fecha de compra debe ser una fecha valida de hoy o anterior.');
  }
  const rawCost = payload.purchaseCostBs;
  const cost = rawCost == null || rawCost === '' ? null : Number(rawCost);
  if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > Number.MAX_SAFE_INTEGER / 100)) {
    throw new Error('El costo total debe ser un monto valido mayor o igual a cero.');
  }
  return { purchaseDate, purchaseCostBs: cost === null ? null : Math.round(cost * 100) / 100 };
};
