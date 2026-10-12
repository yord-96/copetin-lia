export const PETTY_EXPENSE_CATEGORIES = [
  { id: 'varios', label: 'Varios', className: 'misc', aliases: ['varios', 'otro', 'otros', 'misc'] },
  { id: 'servicios_basicos', label: 'Servicios Basicos', className: 'services', aliases: ['servicio', 'luz', 'agua', 'internet'] },
  { id: 'alimentacion', label: 'Alimentacion', className: 'food', aliases: ['almuerzo', 'comida', 'refrigerio'] },
  { id: 'taxis_pasajes', label: 'Taxis/Pasajes', className: 'mobility', aliases: ['taxi', 'pasaje', 'movilidad', 'transporte'] },
  { id: 'mante_camiones', label: 'Mante. Camiones', className: 'maintenance', aliases: ['mante', 'camion', 'reparacion', 'mantenimiento'] },
  { id: 'compras', label: 'Compras', className: 'purchase', aliases: ['compra'] },
  { id: 'anticipo_sueldos', label: 'Anticipo Sueldos', className: 'advance', aliases: ['adelanto', 'anticipo'] },
  { id: 'mate_limpieza', label: 'Mate. Limpieza', className: 'cleaning', aliases: ['limpieza', 'detergente'] },
  { id: 'intereses', label: 'Intereses', className: 'interest', aliases: ['interes'] },
  { id: 'eess_s_monica', label: 'EESS S. MONICA', className: 'fuel', aliases: ['eess', 'monica', 'combustible', 'gasolina'] },
  { id: 'sueldos', label: 'Sueldos', className: 'payroll', aliases: ['sueldo', 'salario'] },
];
const key = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
export function getPettyExpenseCategories(customCategories = []) {
  return [...new Map([...PETTY_EXPENSE_CATEGORIES, ...customCategories].map(row => [row.id, row])).values()];
}
export function renamePettyExpenseCategory(customCategories, id, rawLabel) {
  const categories = Array.isArray(customCategories) ? customCategories : [];
  const all = getPettyExpenseCategories(categories);
  const previous = all.find(row => row.id === id);
  const label = String(rawLabel ?? '').trim().replace(/\s+/g, ' ');
  if (!previous) throw new Error('La categoría ya no existe.');
  if (!key(label) || label.length > 80) throw new Error('Escribe una categoría de entre 1 y 80 caracteres.');
  if (all.some(row => row.id !== id && key(row.label) === key(label))) throw new Error('Ya existe una categoría con ese nombre.');
  const category = { ...previous, label, aliases: [...new Set([...(previous.aliases ?? []), previous.label])] };
  return { category, categories: [...categories.filter(row => row.id !== id), category] };
}
export function addPettyExpenseCategory(customCategories, rawLabel) {
  const label = String(rawLabel ?? '').trim().replace(/\s+/g, ' ');
  if (!key(label) || label.length > 80) throw new Error('Escribe una categoría de entre 1 y 80 caracteres.');
  const categories = Array.isArray(customCategories) ? customCategories : [];
  const existing = getPettyExpenseCategories(categories).find(row => key(row.label) === key(label));
  if (existing) return { category: existing, categories, created: false };
  const id = `petty_custom_${key(label)}`;
  const category = { id, label, className: id, aliases: [] };
  return { category, categories: [...categories, category], created: true };
}
