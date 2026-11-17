import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessTab, canWriteTab, canManageAccounting, isDeveloper, getAllowedTabRoots } from './permissions.js';
test('other business roles do not receive accounting access automatically', () => {
  for (const role of ['super_admin','ventas','inventario','transporte']) {
    const user = {role};
    assert.equal(getAllowedTabRoots(user).has('contabilidad'), false);
    for (const tab of ['contabilidad','contabilidad_caja_grande','contabilidad_caja_chica']) assert.equal(canAccessTab(user,tab),false);
  }
  for (const tab of ['contabilidad','contabilidad_caja_grande','contabilidad_caja_chica']) assert.equal(canAccessTab({role:'developer'},tab),true);
});

test('Aracely and Lisbeth can operate all three cash boxes without technical privileges', () => {
  const tabs = ['contabilidad', 'contabilidad_caja_grande', 'contabilidad_caja_chica', 'contabilidad_caja_chica_digital'];
  for (const fullName of ['ARACELY SIERRA', '  Aracely   Sierra ', 'LISBETH MUÑOZ', 'Lisbeth Munoz']) {
    const user = { id: 'operator', fullName, role: 'ventas', status: 'active' };
    assert.equal(canManageAccounting(user), true);
    assert.equal(getAllowedTabRoots(user).has('contabilidad'), true);
    for (const tab of tabs) {
      assert.equal(canAccessTab(user, tab), true);
      assert.equal(canWriteTab(user, tab), true);
    }
    assert.equal(isDeveloper(user), false);
    assert.equal(canAccessTab(user, 'usuarios'), false);
    assert.equal(canManageAccounting({ ...user, status: 'inactive' }), false);
    assert.equal(canManageAccounting({ ...user, deletedAt: '2026-11-17' }), false);
  }
  assert.equal(canManageAccounting({ id: 'other', role: 'ventas', fullName: 'ARACELY SIERRA OTRA' }), false);
});
