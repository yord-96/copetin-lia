import test from 'node:test';
import assert from 'node:assert/strict';

test('attendance requests time out including response bodies, carry the same retry id, and never download the full state', async () => {
 const originalWindow = globalThis.window, originalFetch = globalThis.fetch, originalSetTimeout = globalThis.setTimeout;
 const storage = new Map();
 globalThis.window = { location: { hostname: 'tucopetin.test', protocol: 'https:' }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
 const { api } = await import('./api.js');
 const calls = [];
 globalThis.setTimeout = (fn, delay, ...args) => originalSetTimeout(fn, delay === 20000 ? 5 : delay, ...args);
 globalThis.fetch = async (url, options) => {
   assert.equal(url, '/__copetin_db/attendance'); calls.push(JSON.parse(options.body));
   assert.ok(options.signal instanceof AbortSignal);
   if (calls.length === 1) return { ok: true, json: () => new Promise((resolve, reject) => { void resolve; options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }) };
   return new Response(JSON.stringify({ record: { id: 'saved-mark', ...calls.at(-1) }, revision: '2:test' }), { status: 200 });
 };
 try {
   const payload = { type: 'entrada', userId: 'u', location: 'Batallon Colorados', reason: 'Ingreso trabajo', clientOperationId: 'same-mark' };
   await assert.rejects(api.attendance.createRecord(payload), /tardando/);
   const saved = await api.attendance.createRecord(payload); assert.equal(saved.id, 'saved-mark');
   assert.equal(calls.length, 2); assert.equal(calls[0].clientOperationId, calls[1].clientOperationId);
   assert.ok(JSON.stringify(calls[1]).length < 1000);
 } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; globalThis.setTimeout = originalSetTimeout; }
});
