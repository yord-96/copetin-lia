const normalizeMovementSearchText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase()
  .trim();

const getMovementDateKey = (movement = {}) => {
  const value = movement.operationDate ?? movement.deliveryDate ?? movement.createdAt;
  const direct = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(value ?? 0);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
};

const getMovementTypeGroup = (movement = {}) => {
  const type = String(movement.type ?? '').trim().toLowerCase();
  if (type === 'entrada' || type === 'reinsercion') return 'entrada';
  if (type === 'salida' || type === 'reserva') return 'salida';
  return 'ajuste';
};

export const filterInventoryMovementHistory = (movements, filters = {}) => {
  const queryTokens = normalizeMovementSearchText(filters.query).split(' ').filter(Boolean);
  const from = String(filters.from ?? '').slice(0, 10);
  const to = String(filters.to ?? '').slice(0, 10);
  const type = String(filters.type ?? 'all').trim().toLowerCase();
  const user = normalizeMovementSearchText(filters.user);

  return (Array.isArray(movements) ? movements : []).filter((movement) => {
    const movementDate = getMovementDateKey(movement);
    if (from && (!movementDate || movementDate < from)) return false;
    if (to && (!movementDate || movementDate > to)) return false;
    if (type !== 'all' && getMovementTypeGroup(movement) !== type) return false;
    if (user && normalizeMovementSearchText(movement.userName) !== user) return false;
    if (queryTokens.length === 0) return true;

    const searchable = normalizeMovementSearchText([
      movement.itemName,
      movement.category,
      movement.itemId,
      movement.contractCode,
      movement.orderCode,
      movement.reference,
      movement.displayReference,
      movement.customerName,
      movement.userName,
      movement.reason,
      movement.detail,
      movement.displayReason,
    ].filter(Boolean).join(' '));
    return queryTokens.every((token) => searchable.includes(token));
  });
};
