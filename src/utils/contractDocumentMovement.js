const count = value => Math.max(0, Math.trunc(Number(value) || 0));
const key = row => String(row?.lineKey ?? '').trim();

export function contractDocumentMovement(line, rental = {}) {
  const items = rental.items ?? [];
  const sameItems = items.filter(row => row.itemId === line.itemId);
  const matched = items.find(row => key(line) && key(row) === key(line))
    ?? (sameItems.length === 1 ? sameItems[0] : null);
  if (!matched) return { delivered: false, returned: false, returnedQty: 0, quantity: count(line.quantity) };
  const belongs = row => key(row) ? key(row) === key(matched) : sameItems.length === 1 && row.itemId === matched.itemId;
  const reports = (rental.returnReport ?? []).filter(belongs);
  const partials = (rental.partialReturnReport?.items ?? []).filter(belongs);
  const stages = new Map();
  for (const row of reports.length ? reports : partials) {
    if (row.deletedAt) continue;
    stages.set(count(row.previousProcessedQty), row);
  }
  const quantity = count(line.quantity);
  const returnedQty = Math.min(quantity, [...stages.values()].reduce((sum, row) => sum + count(row.returnedQty) + count(row.damagedQty), 0));
  const op = rental.operational ?? {};
  const dispatchRows = op.dispatchReview?.items ?? [];
  const dispatch = dispatchRows.find(belongs);
  const dispatchConfirmed = Boolean(op.inventoryDispatchedAt)
    || ['salio', 'en_ruta', 'entregado', 'devuelto', 'retorno_parcial'].includes(op.inventoryStatus)
    || rental.status === 'returned' || stages.size > 0;
  const delivered = dispatchRows.length ? count(dispatch?.dispatchedQty) > 0 : dispatchConfirmed;
  const legacyFullReturn = !rental.returnReport?.length && !rental.partialReturnReport?.items?.length
    && (rental.status === 'returned' || op.inventoryStatus === 'devuelto');
  return { delivered, returned: returnedQty > 0 || legacyFullReturn, returnedQty: legacyFullReturn ? quantity : returnedQty, quantity };
}
