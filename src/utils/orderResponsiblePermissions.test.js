import test from 'node:test';
import assert from 'node:assert/strict';
import { canAssignOrderResponsibles } from './permissions.js';

test('Ventas can assign responsibles, including combined and legacy roles', () => {
  for (const user of [
    { roleIds: ['ventas'] }, { roleIds: ['inventario', 'ventas'] },
    { role: 'Ventas' }, { roleIds: ['developer'] }, { roleIds: ['super_admin'] },
    { role: 'Super Admin' }, { role: 'superadmin' },
  ]) assert.equal(canAssignOrderResponsibles(user), true);
});

test('read-only orders and unrelated roles cannot assign responsibles', () => {
  for (const user of [
    null, { roleIds: ['inventario'] }, { roleIds: ['contabilidad'] },
    { roleIds: ['ventas'], permissions: { ordersReadOnly: true } },
  ]) assert.equal(canAssignOrderResponsibles(user), false);
});
