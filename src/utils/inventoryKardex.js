const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const hasFiniteValue = (value) => value !== '' && value !== null && value !== undefined
  && Number.isFinite(Number(value));

export const getMovementPhysicalDelta = (movement = {}) => {
  if (hasFiniteValue(movement.beforeTotalStock) && hasFiniteValue(movement.afterTotalStock)) {
    return toFiniteNumber(movement.afterTotalStock) - toFiniteNumber(movement.beforeTotalStock);
  }
  const type = String(movement.type ?? '').trim().toLowerCase();
  if (['reserva', 'devolucion', 'retorno'].includes(type)) return 0;
  return toFiniteNumber(movement.deltaUnits);
};

export const getMovementAvailableDelta = (movement = {}) => {
  if (hasFiniteValue(movement.beforeAvailableStock) && hasFiniteValue(movement.afterAvailableStock)) {
    return toFiniteNumber(movement.afterAvailableStock) - toFiniteNumber(movement.beforeAvailableStock);
  }
  return toFiniteNumber(movement.deltaUnits);
};

export const buildInventoryKardexRows = (items = [], movements = []) => {
  const movementsByItem = new Map();
  (Array.isArray(movements) ? movements : []).forEach((movement) => {
    const itemId = String(movement?.itemId ?? '').trim();
    if (!itemId) return;
    const rows = movementsByItem.get(itemId) ?? [];
    rows.push(movement);
    movementsByItem.set(itemId, rows);
  });

  return (Array.isArray(items) ? items : [])
    .filter((item) => item && !item.deletedAt)
    .map((item) => {
      const itemMovements = movementsByItem.get(String(item.id ?? '')) ?? [];
      let stockIn = 0;
      let stockOut = 0;
      let availableNet = 0;
      let physicalMovementCount = 0;

      itemMovements.forEach((movement) => {
        const physicalDelta = getMovementPhysicalDelta(movement);
        const availableDelta = getMovementAvailableDelta(movement);
        if (physicalDelta > 0) stockIn += physicalDelta;
        if (physicalDelta < 0) stockOut += Math.abs(physicalDelta);
        if (physicalDelta !== 0) physicalMovementCount += 1;
        availableNet += availableDelta;
      });

      const currentStock = Math.max(0, toFiniteNumber(item.totalStock));
      const availableStock = Math.max(0, toFiniteNumber(item.availableStock, currentStock));
      const initialStock = Math.max(0, currentStock - stockIn + stockOut);

      return {
        itemId: String(item.id ?? ''),
        initialStock,
        stockIn,
        stockOut,
        currentStock,
        availableStock,
        committedStock: Math.max(0, currentStock - availableStock),
        movementCount: itemMovements.length,
        physicalMovementCount,
        availableNet,
      };
    });
};

export const filterInventoryKardexMovements = (movements = [], metric = 'current') => {
  const normalizedMetric = String(metric ?? 'current').trim().toLowerCase();
  return (Array.isArray(movements) ? movements : []).filter((movement) => {
    const physicalDelta = getMovementPhysicalDelta(movement);
    const availableDelta = getMovementAvailableDelta(movement);
    if (normalizedMetric === 'increases') return physicalDelta > 0;
    if (normalizedMetric === 'decreases') return physicalDelta < 0;
    if (normalizedMetric === 'available') return availableDelta !== 0;
    if (normalizedMetric === 'initial') return false;
    return physicalDelta !== 0;
  });
};
