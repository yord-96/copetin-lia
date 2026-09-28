const qty = (value) => Math.max(0, Math.trunc(Number(value) || 0));
const rows = (value) => Array.isArray(value) ? value : [];

// Read-only history: operational reports are the source of truth. These events
// never modify stock or pretend that an unknown historical balance was zero.
export const buildInventoryLifecycleHistory = (state = {}) => {
  const persisted = rows(state.inventoryMovements).filter((row) => !row.deletedAt);
  const result = [...persisted];
  const byReference = new Map();
  for (const movement of persisted) {
    for (const key of new Set([movement.sourceRentalId, movement.reference, movement.orderCode].filter(Boolean))) {
      if (!byReference.has(key)) byReference.set(key, []);
      byReference.get(key).push(movement);
    }
  }
  for (const rental of rows(state.rentals)) {
    if (!rental || rental.deletedAt) continue;
    const op = rental.operational || {};
    const existing = [...new Set([...(byReference.get(rental.id) || []), ...(byReference.get(rental.orderCode) || [])])];
    const base = {
      reference: rental.orderCode || rental.id, orderCode: rental.orderCode,
      contractCode: rental.contractCode, customerName: rental.customerName,
      sourceRentalId: rental.id, sourceContractId: rental.contractId,
      stockEffect: 'trace_only', derivedFromReport: true,
    };
    const append = (event) => {
      const duplicate = existing.some((m) => m.id === event.id || (
        m.sourceType === event.sourceType && m.itemId === event.itemId
        && String(m.lineKey || '') === String(event.lineKey || '')
        && String(m.operationDate || m.createdAt) === String(event.createdAt)
      ));
      if (!duplicate) result.push({ ...base, ...event, operationDate: event.createdAt });
    };
    const dispatchAt = op.inventoryDispatchedAt || op.dispatchReview?.reviewedAt;
    if (dispatchAt) {
      const dispatchLines = rows(op.dispatchReview?.items);
      for (const [index, line] of rows(rental.items).entries()) {
        const reviewed = dispatchLines.find((entry) => line.lineKey && entry.lineKey === line.lineKey)
          || (rows(rental.items).filter((entry) => entry.itemId === line.itemId).length === 1
            ? dispatchLines.find((entry) => entry.itemId === line.itemId) : null);
        // A partial dispatch without line evidence must not imply a full exit.
        if (!reviewed && op.dispatchReview?.status === 'partial') continue;
        const quantity = qty(reviewed?.dispatchedQty ?? line.quantity);
        if (!quantity) continue;
        const own = Math.min(quantity, qty(line.internalReservedQty ?? Math.max(0, quantity - qty(line.supplierBackedQty))));
        append({
          id: `lifecycle:dispatch:${rental.id}:${line.lineKey || index}`, sourceType: 'rental_dispatch',
          lineKey: line.lineKey, itemId: line.itemId, itemName: line.itemName || line.name,
          type: 'salida', typeLabel: 'Salida de material', quantity, deltaUnits: -own,
          ownQuantity: own, supplierQuantity: quantity - own,
          reason: `Salieron ${quantity} unidades: ${own} propias y ${quantity - own} de proveedor.`,
          createdAt: dispatchAt, userName: op.inventoryDispatchedByName || op.dispatchReview?.reviewedByName || 'Sin responsable registrado',
          userRole: op.inventoryDispatchedByRole || 'Inventario',
        });
      }
    }

    const reports = [];
    const fingerprints = new Set();
    for (const line of [...rows(rental.returnReport), ...rows(rental.partialReturnReport?.items)]) {
      const at = line.partialRegisteredAt || line.registeredAt || rental.returnedAt || op.inventoryReturnedAt || rental.partialReturnReport?.updatedAt;
      const key = JSON.stringify([line.lineKey || line.itemId, at, line.returnedQty, line.damagedQty, line.missingQty, line.pendingClientQty]);
      if (fingerprints.has(key)) continue;
      fingerprints.add(key);
      reports.push({ line, at });
    }
    for (const [index, { line, at }] of reports.entries()) {
      if (!at) continue;
      const good = qty(line.returnedQty);
      const damaged = qty(line.damagedQty);
      // Old partial reports used missingQty for material still with the client.
      const legacyPending = !Object.hasOwn(line, 'pendingClientQty') && op.clientPendingPickup?.active;
      const pending = qty(legacyPending ? line.missingQty : line.pendingClientQty);
      const missing = legacyPending ? 0 : qty(line.missingQty);
      if (!(good + damaged + pending + missing)) continue;
      const own = line.returnedToAvailableQty == null ? null : qty(line.returnedToAvailableQty);
      const partial = Boolean(line.partialRegisteredAt || pending);
      append({
        id: `lifecycle:return:${rental.id}:${line.lineKey || line.itemId}:${at}:${index}`,
        sourceType: 'rental_return', lineKey: line.lineKey,
        itemId: line.itemId, itemName: line.itemName,
        type: good + damaged > 0 ? 'entrada' : 'seguimiento',
        typeLabel: partial ? 'Devolución parcial' : 'Devolución',
        quantity: good + damaged, deltaUnits: own ?? 0, ownQuantity: own,
        returnedQty: good, damagedQty: damaged, missingQty: missing, pendingClientQty: pending,
        reason: `Recibidas ${good + damaged}: ${good} en buen estado y ${damaged} dañadas. Pendientes con cliente: ${pending}. Faltantes definitivos: ${missing}.${own == null ? '' : ` Reingresan al disponible propio: ${own}.`}${line.damageNote ? ` ${line.damageNote}` : ''}`,
        createdAt: at,
        userName: line.registeredByName || (partial ? rental.partialReturnReport?.updatedByName : op.inventoryReturnedByName) || 'Sin responsable registrado',
        userRole: line.registeredByRole || op.inventoryReturnedByRole || 'Inventario',
      });
    }
  }
  return result;
};
