import assert from 'node:assert/strict';
import test from 'node:test';

test('conserva el acceso exclusivo a Lincoln al normalizar usuarios descargados', async () => {
  const browserStorage = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => browserStorage.get(`local:${key}`) ?? null,
      setItem: (key, value) => browserStorage.set(`local:${key}`, value),
      removeItem: (key) => browserStorage.delete(`local:${key}`),
    },
    sessionStorage: {
      getItem: (key) => browserStorage.get(`session:${key}`) ?? null,
      setItem: (key, value) => browserStorage.set(`session:${key}`, value),
      removeItem: (key) => browserStorage.delete(`session:${key}`),
    },
    screen: { width: 1920, height: 1080 },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Node test', platform: 'Win32' },
    configurable: true,
  });
  globalThis.document = {};

  const { getWebBridge } = await import('./webBridge.js');
  const bridge = getWebBridge();
  await bridge.__storage.mergeState({
    users: [{
      id: 'usr-lincoln',
      fullName: 'USUARIO LINCOLN',
      username: 'lincoln.user',
      passwordHash: 'fnv1a:00000000',
      roleIds: ['ventas'],
      roleId: 'ventas',
      role: 'Ventas',
      permissions: {
        attendanceEnabled: true,
        calendarReadOnly: false,
        ordersReadOnly: false,
      },
      companyAccess: ['lincoln'],
      status: 'active',
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
      deletedAt: null,
    }],
  });

  const users = await bridge.users.list();
  const lincolnUser = users.find((user) => user.id === 'usr-lincoln');
  assert.deepEqual(lincolnUser?.companyAccess, ['lincoln']);
});
