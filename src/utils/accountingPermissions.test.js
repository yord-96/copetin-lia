import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessTab, getAllowedTabRoots } from './permissions.js';
test('only users with developer role can see or access accounting views', () => {
  for (const role of ['super_admin','ventas','inventario','transporte']) {
    const user = {role};
    assert.equal(getAllowedTabRoots(user).has('contabilidad'), false);
    for (const tab of ['contabilidad','contabilidad_caja_grande','contabilidad_caja_chica']) assert.equal(canAccessTab(user,tab),false);
  }
  for (const tab of ['contabilidad','contabilidad_caja_grande','contabilidad_caja_chica']) assert.equal(canAccessTab({role:'developer'},tab),true);
});
