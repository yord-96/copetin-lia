import test from 'node:test';
import assert from 'node:assert/strict';
import { addPettyExpenseCategory } from './pettyExpenseCategories.js';

test('crea una categoría reutilizable y evita duplicados por tildes, espacios o mayúsculas', () => {
  const first = addPettyExpenseCategory([], '  Reparación de equipos  ');
  assert.equal(first.category.label, 'Reparación de equipos');
  assert.equal(first.created, true);
  const duplicate = addPettyExpenseCategory(first.categories, 'REPARACION DE EQUIPOS');
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.category.id, first.category.id);
  assert.equal(duplicate.categories.length, 1);
  const builtin = addPettyExpenseCategory(first.categories, 'Alimentación');
  assert.equal(builtin.category.id, 'alimentacion');
  assert.equal(builtin.categories.length, 1);
});

test('rechaza nombres vacíos o demasiado largos', () => {
  for (const label of ['', '  ', '!!!', 'a'.repeat(81)]) assert.throws(() => addPettyExpenseCategory([], label), /categoría/);
});
