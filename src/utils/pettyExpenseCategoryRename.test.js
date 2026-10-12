import test from 'node:test';
import assert from 'node:assert/strict';
import { addPettyExpenseCategory, getPettyExpenseCategories, renamePettyExpenseCategory } from './pettyExpenseCategories.js';
test('renaming keeps the category identity used by all historical movements', () => {
  const created = addPettyExpenseCategory([], 'COOMBUSTIBLE');
  const movements = [{category:created.category.id,amountBs:50},{category:created.category.id,amountBs:70}];
  const saved = structuredClone(movements);
  const renamed = renamePettyExpenseCategory(created.categories, created.category.id, 'COMBUSTIBLE');
  const categories = getPettyExpenseCategories(renamed.categories);
  assert.ok(movements.every(m => categories.find(c => c.id === m.category).label === 'COMBUSTIBLE'));
  assert.deepEqual(movements, saved);
  assert.ok(renamed.category.aliases.includes('COOMBUSTIBLE'));
});
test('builtin rename overrides its label without duplicating its stable ID', () => {
  const result = renamePettyExpenseCategory([], 'compras', 'Compras de materiales');
  assert.equal(getPettyExpenseCategories(result.categories).filter(c => c.id === 'compras').length, 1);
  assert.equal(getPettyExpenseCategories(result.categories).find(c => c.id === 'compras').label, 'Compras de materiales');
});
test('rejects empty, duplicate and missing category names', () => {
  assert.throws(() => renamePettyExpenseCategory([], 'compras', ''), /Escribe/);
  assert.throws(() => renamePettyExpenseCategory([], 'compras', 'Alimentación'), /Ya existe/);
  assert.throws(() => renamePettyExpenseCategory([], 'missing', 'Nuevo'), /no existe/);
});
