import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRoleIds, getUserRoleIds, getAllowedTabRoots, getDefaultTabForUser, canAccessTab, canWriteTab, isAttendanceOnlyUser } from './permissions.js';

test('sin roles operativos conserva solo Asistencia aunque haya un rol anterior', () => {
  const user = { roleIds: [], roleId: 'ventas', role: 'Ventas', permissions: { attendanceEnabled: true, calendarReadOnly: true, ordersReadOnly: true } };
  assert.deepEqual(normalizeRoleIds([]), []);
  assert.deepEqual(getUserRoleIds(user), []);
  assert.equal(isAttendanceOnlyUser(user), true);
  assert.equal(getDefaultTabForUser(user), 'asistencia');
  assert.deepEqual([...getAllowedTabRoots(user)], ['asistencia']);
  assert.equal(canWriteTab(user, 'asistencia'), true);
  for (const tab of ['resumen', 'caja', 'items', 'alquiler', 'usuarios', 'personal', 'inventario_movimientos', 'devolucion_entregas', 'contabilidad']) {
    assert.equal(canAccessTab(user, tab), false, tab);
  }
});

test('desactivar asistencia no concede acceso a otros modulos', () => {
  const user = { roleIds: [], permissions: { attendanceEnabled: false } };
  assert.deepEqual([...getAllowedTabRoots(user)], []);
  assert.equal(canAccessTab(user, 'asistencia'), false);
});

test('conserva permisos operativos y compatibilidad con roles antiguos', () => {
  assert.equal(canAccessTab({ role: 'Ventas' }, 'alquiler'), true);
  assert.equal(canAccessTab({ roleIds: ['developer'] }, 'usuarios'), true);
  assert.equal(canAccessTab({ roleIds: ['ventas'], permissions: { attendanceEnabled: false } }, 'asistencia'), false);
});
