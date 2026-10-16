import { randomUUID } from 'node:crypto';

const fail = (message, statusCode = 400) => { const error = new Error(message); error.statusCode = statusCode; throw error; };
const qty = value => { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) fail('La cantidad debe ser un entero mayor a cero.'); return number; };
const clean = value => String(value ?? '').trim();
const dateKey = value => { const date = clean(value); const stamp = Date.parse(date + 'T12:00:00Z'); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) fail('Indica una fecha válida.'); return date; };
const received = (loan, lineId) => (loan.returns ?? []).filter(row => row.lineId === lineId && !row.deletedAt).reduce((sum, row) => sum + row.quantity, 0);
export const pendingLoanQuantity = (loan, line) => Math.max(0, line.quantity - received(loan, line.id));

// A new loan removes physical stock until returned. Historical stock was already
// absent when imported: only its actual returns enter the warehouse.
const stockEffects = loan => {
  const map = new Map();
  const add = (id, delta) => { if (id) map.set(id, (map.get(id) ?? 0) + delta); };
  if (!loan || loan.deletedAt) return map;
  if (loan.kind === 'new') loan.lines.forEach(line => add(line.itemId, -line.quantity));
  (loan.returns ?? []).filter(row => !row.deletedAt).forEach(row => add(row.itemId, row.quantity));
  return map;
};

export function mutateItemLoan(state, action, payload, { now = new Date().toISOString(), makeId = randomUUID } = {}) {
  const loans = state.itemLoans ?? [];
  const items = state.items ?? [];
  const findItem = id => items.find(item => String(item.id) === id && !item.deletedAt && item.controlsStock !== false);
  const requestId = clean(payload.requestId);
  if (!requestId) fail('Falta el identificador de la operación.');
  const existing = action === 'create' ? loans.find(loan => loan.requestId === requestId) : loans.find(loan => loan.id === clean(payload.id));
  if (action === 'create' && existing) return { loan: existing, items: [], duplicate: true };
  if (action !== 'create' && (!existing || existing.deletedAt)) fail('Préstamo no encontrado.', 404);
  if (action === 'return' && existing.returns?.some(row => row.requestId === requestId)) return { loan: existing, items: [], duplicate: true };
  if (existing && Number(payload.version) !== existing.version) fail('El préstamo cambió. Actualiza la vista e inténtalo nuevamente.', 409);
  const before = existing ? structuredClone(existing) : null;
  const loan = before ? structuredClone(before) : { id: makeId(), code: `PR-${String(loans.length + 1).padStart(5, '0')}`, requestId, createdAt: now, createdByName: clean(payload.userName), lines: [], returns: [], version: 0 };

  if (action === 'create' || action === 'update') {
    const kind = clean(payload.kind);
    if (!['new', 'legacy'].includes(kind)) fail('Selecciona préstamo nuevo o antiguo.');
    if (before?.returns?.some(row => !row.deletedAt) && kind !== before.kind) fail('No puedes cambiar el tipo de un préstamo que ya tiene devoluciones.');
    const personName = clean(payload.personName);
    if (!personName) fail('Indica a quién se prestaron los ítems.');
    if (!Array.isArray(payload.lines) || !payload.lines.length) fail('Añade al menos un ítem.');
    const usedIds = new Set();
    const lines = payload.lines.map(row => {
      const id = clean(row.id) || makeId();
      if (usedIds.has(id)) fail('Hay líneas duplicadas.');
      usedIds.add(id);
      const old = before?.lines.find(line => line.id === id);
      const itemId = clean(row.itemId);
      const item = itemId ? findItem(itemId) : null;
      if ((kind === 'new' || itemId) && !item) fail('Selecciona un producto activo con control de stock.');
      const itemName = item?.name || clean(row.itemName);
      if (!itemName) fail('Indica el nombre del material antiguo.');
      const quantity = qty(row.quantity);
      if (old && received(before, id) > 0 && (old.itemId !== itemId || quantity < received(before, id))) fail('Una línea con devoluciones debe conservar su producto y cubrir la cantidad ya devuelta.');
      return { id, itemId, itemName, quantity };
    });
    if (before?.lines.some(line => !usedIds.has(line.id) && received(before, line.id) > 0)) fail('No puedes quitar una línea que ya tiene devoluciones.');
    const date = dateKey(payload.date);
    if (loan.returns.some(row => !row.deletedAt && row.date < date)) fail('La fecha del préstamo no puede ser posterior a una devolución registrada.');
    const dueDate = payload.dueDate ? dateKey(payload.dueDate) : '';
    if (dueDate && dueDate < date) fail('La devolución prevista no puede ser anterior al préstamo.');
    Object.assign(loan, { kind, personName, phone: clean(payload.phone), document: clean(payload.document), date, dueDate, notes: clean(payload.notes), lines });
  } else if (action === 'return') {
    const line = loan.lines.find(row => row.id === clean(payload.lineId));
    if (!line) fail('Selecciona el material a devolver.');
    const quantity = qty(payload.quantity);
    if (quantity > pendingLoanQuantity(loan, line)) fail('No puedes devolver más de lo pendiente.');
    const itemId = loan.kind === 'new' ? line.itemId : clean(payload.itemId);
    if (!findItem(itemId)) fail('Selecciona a qué producto del inventario ingresará la devolución.');
    const date = dateKey(payload.date);
    if (date < loan.date) fail('La devolución no puede ser anterior al préstamo.');
    loan.returns.push({ id: makeId(), requestId, lineId: line.id, itemId, quantity, date, note: clean(payload.note), createdAt: now, createdByName: clean(payload.userName) });
  } else if (action === 'undo-return') {
    const row = loan.returns.find(entry => entry.id === clean(payload.returnId) && !entry.deletedAt);
    if (!row) fail('Devolución no encontrada.', 404);
    row.deletedAt = now;
    row.deletedByName = clean(payload.userName);
  } else if (action === 'delete') {
    loan.deletedAt = now;
  } else fail('Operación no válida.');

  const oldEffects = stockEffects(before), newEffects = stockEffects(loan);
  const changes = [];
  for (const id of new Set([...oldEffects.keys(), ...newEffects.keys()])) {
    const delta = (newEffects.get(id) ?? 0) - (oldEffects.get(id) ?? 0);
    if (!delta) continue;
    const item = findItem(id);
    if (!item) fail('Uno de los productos vinculados ya no está disponible.');
    const total = Number(item.totalStock ?? 0), available = Number(item.availableStock ?? 0);
    if (![total, available, total + delta, available + delta].every(Number.isSafeInteger)) fail(`Revisa el stock registrado de ${item.name}.`, 409);
    if (delta < 0 && (available + delta < 0 || total + delta < 0)) fail(`Stock insuficiente de ${item.name}. Disponible: ${available}. No se puede retirar ${-delta}.`, 409);
    changes.push({ item, delta, beforeTotal: total, beforeAvailable: available });
  }
  loan.updatedAt = now;
  loan.updatedByName = clean(payload.userName);
  loan.version += 1;
  state.itemLoans = loans.filter(row => row.id !== loan.id).concat(loan);
  state.inventoryMovements ??= [];
  for (const { item, delta, beforeTotal, beforeAvailable } of changes) {
    item.totalStock = beforeTotal + delta;
    item.availableStock = beforeAvailable + delta;
    item.updatedAt = now;
    state.inventoryMovements.unshift({ id: makeId(), itemId: item.id, itemName: item.name, type: delta > 0 ? 'entrada' : 'salida', quantity: Math.abs(delta), deltaUnits: delta, beforeTotalStock: beforeTotal, afterTotalStock: item.totalStock, beforeAvailableStock: beforeAvailable, afterAvailableStock: item.availableStock, userName: clean(payload.userName), operationDate: payload.date || now.slice(0, 10), reason: `${loan.code} · ${loan.personName} · ${action}`, note: loan.notes, sourceType: 'item_loan', itemLoanId: loan.id, createdAt: now, createdByName: clean(payload.userName) });
  }
  // Keep a small projection on each product so every availability view can
  // explain missing stock without downloading the complete loan history.
  const touched = new Set([...(before?.lines ?? []), ...loan.lines].map(line => line.itemId).filter(Boolean));
  changes.forEach(({ item }) => touched.add(item.id));
  const updatedItems = items.filter(item => touched.has(item.id));
  updatedItems.forEach(item => {
    item.itemLoanAllocations = state.itemLoans.filter(row => !row.deletedAt && row.kind === 'new').flatMap(row => row.lines.filter(line => line.itemId === item.id && pendingLoanQuantity(row, line) > 0).map(line => ({ id: row.id, code: row.code, personName: row.personName, quantity: pendingLoanQuantity(row, line), date: row.date, dueDate: row.dueDate })));
  });
  return { loan, items: updatedItems };
}
