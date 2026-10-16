import test from 'node:test';
import assert from 'node:assert/strict';
import { mutateItemLoan } from './itemLoans.js';
import { getProjectedInventoryAvailability, validateProjectedInventoryRequest, buildAvailabilityPeriod } from '../../src/utils/availability.js';

const state = () => ({ items: [{ id: 'chair', name: 'Silla blanca', controlsStock: true, totalStock: 100, availableStock: 90 }, { id: 'table', name: 'Mesa', controlsStock: true, totalStock: 20, availableStock: 20 }], itemLoans: [], inventoryMovements: [] });
const command = (overrides = {}) => ({ requestId: crypto.randomUUID(), kind: 'new', personName: 'Ana', date: '2026-10-16', dueDate: '', lines: [{ id: 'line', itemId: 'chair', quantity: 20 }], userName: 'Operador', ...overrides });
const next = (loan, overrides = {}) => ({ requestId: crypto.randomUUID(), id: loan.id, version: loan.version, userName: 'Operador', ...overrides });

test('new loans deduct once, explain availability, accept partial returns and restore only pending on deletion', () => {
  const db = state(), payload = command();
  let result = mutateItemLoan(db, 'create', payload);
  assert.equal(db.items[0].totalStock, 80);
  assert.equal(db.items[0].availableStock, 70);
  assert.equal(db.items[0].itemLoanAllocations[0].personName, 'Ana');
  assert.equal(mutateItemLoan(db, 'create', payload).duplicate, true);
  assert.equal(db.items[0].totalStock, 80);
  const returnCommand = next(result.loan, { lineId: 'line', quantity: 5, date: '2026-10-17' });
  result = mutateItemLoan(db, 'return', returnCommand);
  assert.equal(db.items[0].totalStock, 85);
  assert.equal(db.items[0].availableStock, 75);
  assert.equal(db.items[0].itemLoanAllocations[0].quantity, 15);
  assert.equal(mutateItemLoan(db, 'return', returnCommand).duplicate, true);
  const shortages = validateProjectedInventoryRequest({ items: db.items, period: buildAvailabilityPeriod({ deliveryDate: '2026-10-20', pickupDate: '2026-10-21' }), requestedItems: [{ itemId: 'chair', quantity: 90 }] });
  assert.equal(shortages[0].shortageQty, 5);
  assert.equal(shortages[0].loanRecords[0].personName, 'Ana');
  const availability = getProjectedInventoryAvailability({ items: db.items, rentals: [], contracts: [], quotes: [], targetPeriod: buildAvailabilityPeriod({ deliveryDate: '2026-10-20', pickupDate: '2026-10-21' }) });
  assert.equal(availability.get('chair').projectedAvailable, 85);
  assert.equal(availability.get('chair').loanRecords[0].personName, 'Ana');
  mutateItemLoan(db, 'delete', next(result.loan));
  assert.equal(db.items[0].totalStock, 100);
  assert.equal(db.items[0].availableStock, 90);
  assert.equal(db.items[0].itemLoanAllocations.length, 0);
});

test('historical loans leave stock unchanged and return into the explicitly selected product', () => {
  const db = state();
  let { loan } = mutateItemLoan(db, 'create', command({ kind: 'legacy', lines: [{ id: 'old', itemName: 'Material antiguo', quantity: 8 }] }));
  assert.equal(db.items[0].totalStock, 100);
  assert.equal(db.inventoryMovements.length, 0);
  ({ loan } = mutateItemLoan(db, 'return', next(loan, { lineId: 'old', itemId: 'table', quantity: 3, date: '2026-10-17' })));
  assert.equal(db.items[1].totalStock, 23);
  assert.equal(db.items[1].availableStock, 23);
  assert.equal(db.items[0].totalStock, 100);
  ({ loan } = mutateItemLoan(db, 'undo-return', next(loan, { returnId: loan.returns[0].id })));
  assert.equal(db.items[1].totalStock, 20);
  assert.ok(loan.returns[0].deletedAt);
});

test('edits apply only the stock difference, including moving a line to another item', () => {
  const db = state();
  let { loan } = mutateItemLoan(db, 'create', command());
  ({ loan } = mutateItemLoan(db, 'update', { ...loan, ...next(loan), lines: [{ id: 'line', itemId: 'chair', quantity: 25 }], personName: 'Beatriz' }));
  assert.equal(db.items[0].totalStock, 75);
  assert.equal(db.items[0].itemLoanAllocations[0].personName, 'Beatriz');
  ({ loan } = mutateItemLoan(db, 'update', { ...loan, ...next(loan), lines: [{ id: 'line', itemId: 'table', quantity: 10 }] }));
  assert.equal(db.items[0].totalStock, 100);
  assert.equal(db.items[1].totalStock, 10);
  assert.equal(db.items[0].itemLoanAllocations.length, 0);
});

test('invalid or concurrent operations do not mutate stock or history', () => {
  const db = state();
  const { loan } = mutateItemLoan(db, 'create', command());
  const before = structuredClone(db);
  for (const [action, payload] of [
    ['return', next(loan, { lineId: 'line', quantity: 21, date: '2026-10-17' })],
    ['return', next(loan, { lineId: 'line', quantity: 1.5, date: '2026-10-17' })],
    ['return', next(loan, { lineId: 'line', quantity: 1, date: '2026-10-15' })],
    ['delete', next(loan, { version: 0 })],
    ['create', command({ lines: [{ itemId: 'table', quantity: 5 }, { itemId: 'chair', quantity: 1000 }] })],
  ]) {
    assert.throws(() => mutateItemLoan(db, action, payload));
    assert.deepEqual(db, before);
  }
});

test('cannot erase received lines or reverse historical returns once the material is committed', () => {
  const db = state();
  let { loan } = mutateItemLoan(db, 'create', command({ kind: 'legacy' }));
  ({ loan } = mutateItemLoan(db, 'return', next(loan, { lineId: 'line', itemId: 'chair', quantity: 5, date: '2026-10-17' })));
  assert.throws(() => mutateItemLoan(db, 'update', { ...loan, ...next(loan), lines: [{ id: 'different', itemId: 'table', quantity: 5 }] }));
  assert.throws(() => mutateItemLoan(db, 'update', { ...loan, ...next(loan), kind: 'new' }));
  db.items[0].availableStock = 1;
  const before = structuredClone(db);
  assert.throws(() => mutateItemLoan(db, 'delete', next(loan)), /Stock insuficiente/);
  assert.deepEqual(db, before);
});

test('lending all units leaves zero controlled availability with borrower information', () => {
  const db = state(); db.items[0].availableStock = 100;
  mutateItemLoan(db, 'create', command({ lines: [{ id: 'line', itemId: 'chair', quantity: 100 }] }));
  const summary = getProjectedInventoryAvailability({ items: db.items }).get('chair');
  assert.equal(summary.stockControlled, true); assert.equal(summary.projectedAvailable, 0);
  assert.equal(summary.loanedQty, 100);
  assert.equal(validateProjectedInventoryRequest({ items: db.items, requestedItems: [{ itemId: 'chair', quantity: 1 }] })[0].shortageQty, 1);
});
