import crypto from 'node:crypto';
import { createPersonnelOperations } from '../../src/utils/personnelOperations.js';

export const personnelMutationMethods = new Set([
  'createEmployee', 'updateEmployee', 'removeEmployee', 'createIncident', 'updateIncident', 'importAttendance',
]);

export async function mutatePersonnel(state, method, payload) {
  if (!personnelMutationMethods.has(method)) throw Object.assign(new Error('Operacion no valida.'), { statusCode: 400 });
  for (const key of ['personnelEmployees', 'personnelAttendance', 'personnelIncidents']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  const operations = createPersonnelOperations({
    transaction: (update) => update(state),
    readQueryState: () => state,
    makeId: (prefix) => `${prefix}_${crypto.randomUUID()}`,
    deepClone: structuredClone,
    consumeDocumentCode: (target, prefixKey, nextKey, size) => {
      target.settings ??= {};
      target.settings.numbering ??= {};
      const numbering = target.settings.numbering;
      const next = Math.max(1, Math.trunc(Number(numbering[nextKey]) || 1));
      numbering[nextKey] = next + 1;
      return `${numbering[prefixKey] ?? 'BIO-'}${String(next).padStart(size, '0')}`;
    },
  });
  try {
    return await operations[method](payload);
  } catch (error) {
    error.statusCode ??= 400;
    throw error;
  }
}
