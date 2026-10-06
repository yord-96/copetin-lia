import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import bcrypt from 'bcryptjs';

let directory, server, base, staffToken, clientToken, accountId;
const call = async (route, { token, method = 'GET', body } = {}) => {
  const response = await fetch(`${base}/api/lincoln-portal${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
};
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lincoln-portal-test-'));
  process.env.APP_STATE_FILE = path.join(directory, 'app.json');
  process.env.LINCOLN_STATE_FILE = path.join(directory, 'lincoln.json');
  process.env.LINCOLN_PORTAL_FILE = path.join(directory, 'portal.json');
  await fs.writeFile(process.env.APP_STATE_FILE, JSON.stringify({ state: { users: [
    { id: 'staff', username: 'admin', fullName: 'Admin Lincoln', status: 'active', role: 'admin', companyAccess: ['lincoln'], passwordHash: await bcrypt.hash('staff-password', 4) },
    { id: 'other', username: 'other', status: 'active', role: 'admin', companyAccess: ['copetin'], passwordHash: await bcrypt.hash('other-password', 4) },
  ] }, version: 1 }));
  await fs.writeFile(process.env.LINCOLN_STATE_FILE, JSON.stringify({ state: { events: [{ id: 'event-1', clientName: 'Cliente uno', code: '001', eventDate: '2026-10-24', totalBs: 9000, privateNotes: 'INTERNAL-SECRET' }, { id: 'event-2', clientName: 'Cliente dos' }] }, version: 1 }));
  const { default: routes } = await import('../../routes/lincolnPortal.js');
  const app = express(); app.use(express.json()); app.use(routes);
  // Portal authentication runs before the legacy Lincoln internal-key middleware.
  app.use((await import('../../routes/lincoln.js')).default);
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); if (directory) await fs.rm(directory, { recursive: true, force: true }); });

test('portal access, event isolation, concurrent edits and immediate revocation', async () => {
  assert.equal((await call('/accounts')).status, 401);
  assert.equal((await call('/login', { method: 'POST', body: { staff: true, username: 'other', password: 'other-password' } })).status, 401);
  assert.equal((await call('/login', { method: 'POST', body: { staff: true, username: 'admin', password: 'wrong' } })).status, 401);
  const staff = await call('/login', { method: 'POST', body: { staff: true, username: 'admin', password: 'staff-password' } });
  assert.equal(staff.status, 200); staffToken = staff.body.token;
  const created = await call('/accounts', { token: staffToken, method: 'POST', body: { eventId: 'event-1', name: 'Cliente', username: 'client', password: 'client-password' } });
  assert.equal(created.status, 201); accountId = created.body.account.id;
  assert.equal(Object.hasOwn(created.body.account, 'passwordHash'), false);
  assert.equal((await call('/accounts', { token: staffToken, method: 'POST', body: { eventId: 'event-1', username: 'CLIENT', password: 'client-password' } })).status, 409);
  const client = await call('/login', { method: 'POST', body: { username: 'client', password: 'client-password' } });
  assert.equal(client.status, 200); clientToken = client.body.token;
  assert.equal((await call('/accounts', { token: clientToken })).status, 403);
  assert.equal((await call('/plan?eventId=event-2', { token: clientToken })).status, 403);
  const initial = await call('/plan', { token: clientToken });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.event.id, 'event-1');
  assert.equal(Object.hasOwn(initial.body.event, 'totalBs'), false);
  assert.equal(JSON.stringify(initial.body).includes('INTERNAL-SECRET'), false);
  const plan = initial.body.plan;
  plan.guests.push({ id: 'g1', name: 'Invitado', people: 3, children: 1, status: 'Sí', table: 'Mesa 1' });
  plan.layout.objects.push({ id: 't1', type: 'round', label: 'Mesa 1', x: 100, y: 100, width: 90, height: 90, seats: 8, rotation: 45 });
  const saved = await call('/plan', { token: clientToken, method: 'PUT', body: { eventId: 'event-1', revision: 0, plan, accounts: [{ active: true }] } });
  assert.equal(saved.status, 200); assert.equal(saved.body.revision, 1);
  assert.equal(saved.body.plan.guests[0].people, 3); assert.equal(saved.body.plan.layout.objects[0].rotation, 45);
  assert.equal((await call('/plan', { token: staffToken, method: 'PUT', body: { eventId: 'event-1', revision: 0, plan } })).status, 409);
  assert.equal((await call('/plan', { token: clientToken, method: 'PUT', body: { eventId: 'event-2', revision: 0, plan } })).status, 403);
  const stored = JSON.parse(await fs.readFile(process.env.LINCOLN_PORTAL_FILE, 'utf8'));
  assert.ok(stored.accounts[0].passwordHash.startsWith('$2'));
  assert.equal(JSON.stringify(stored).includes('client-password'), false);
  assert.equal(JSON.stringify(stored).includes(clientToken), false);
  const invalid = structuredClone(plan); invalid.layout.objects[0].type = '__proto__';
  assert.equal((await call('/plan', { token: clientToken, method: 'PUT', body: { revision: 1, plan: invalid } })).status, 400);
  assert.equal((await call(`/accounts/${accountId}`, { token: staffToken, method: 'PATCH', body: { active: false } })).status, 200);
  assert.equal((await call('/plan', { token: clientToken })).status, 401);
  assert.equal((await call('/login', { method: 'POST', body: { username: 'client', password: 'client-password' } })).status, 401);
  await call(`/accounts/${accountId}`, { token: staffToken, method: 'PATCH', body: { active: true, password: 'new-client-password' } });
  assert.equal((await call('/login', { method: 'POST', body: { username: 'client', password: 'client-password' } })).status, 401);
  const relogin = await call('/login', { method: 'POST', body: { username: 'client', password: 'new-client-password' } });
  assert.equal(relogin.status, 200);
  assert.equal((await call('/plan', { token: relogin.body.token })).body.plan.guests[0].name, 'Invitado');
  await call('/logout', { token: relogin.body.token, method: 'POST' });
  assert.equal((await call('/plan', { token: relogin.body.token })).status, 401);
});

test('legacy staff authentication remains compatible', async () => {
  const { verifyStaffPassword } = await import('./lincolnPortalService.js');
  const password = 'legacy-password'; let hash = 2166136261;
  for (let i = 0; i < password.length; i += 1) { hash ^= password.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  const user = { status: 'active', role: 'developer', passwordHash: `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}` };
  assert.equal(await verifyStaffPassword(user, password), true);
  assert.equal(await verifyStaffPassword(user, 'wrong'), false);
});

test('portal is reachable through the existing Lincoln reverse proxy prefix', async () => {
  const response = await fetch(`${base}/__lincoln_db/portal/accounts`, { headers: { Authorization: `Bearer ${staffToken}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /application\/json/);
  assert.equal((await response.json()).accounts[0].id, accountId);
  const unauthenticated = await fetch(`${base}/__lincoln_db/portal/accounts`);
  assert.equal(unauthenticated.status, 401);
  assert.match((await unauthenticated.json()).error, /sesión/);
});
