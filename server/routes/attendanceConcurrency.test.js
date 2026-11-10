import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createRequestLimiters } from '../middleware/requestLimits.js';

test('24 people sharing an IP can log in and mark with concurrent commercial writes; retries are durable and unique', async () => {
 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-attendance-concurrency-'));
 process.env.APP_STATE_FILE = path.join(directory, 'state.json');
 process.env.APP_PRESENCE_FILE = path.join(directory, 'presence.json');
 process.env.ATTENDANCE_UPLOAD_DIR = path.join(directory, 'photos');
 process.env.APP_INTERNAL_KEY = 'attendance-concurrency';
 const { default: router } = await import('./state.js');
 const { default: uploads } = await import('./uploads.js');
 const { replaceStateSnapshot, getStateSnapshot, getStateMeta, updateStateSnapshot, updateAttendanceStateSnapshot } = await import('../storage/fileStateStore.js');
 const users = Array.from({ length: 24 }, (_, index) => ({ id: 'u' + index, username: 'user' + index, fullName: 'Persona ' + index, status: 'active' }));
 const commercial = [{ id: 'contract', status: 'active', detail: 'No modificar', padding: 'x'.repeat(Number(process.env.ATTENDANCE_TEST_PAYLOAD_MB ?? 8) * 1024 * 1024) }];
 await replaceStateSnapshot({ users, settings: {}, attendanceRecords: [], contracts: commercial,
   items: [{ id: 'i', name: 'Producto', totalStock: 100, availableStock: 100 }], inventoryMovements: [], rentals: [] }, null);
 const app = express(); const limits = createRequestLimiters({ isProduction: true });
 app.use(limits.general, limits.attendance, limits.access);
 app.use('/__copetin_db/presence', limits.presence); app.use('/__copetin_db', limits.state);
 app.use(uploads); app.use(express.json()); app.use(router);
 app.use((error, _req, res, next) => { void next; res.status(error.statusCode || 500).json({ error: error.message }); });
 const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
 const base = 'http://127.0.0.1:' + server.address().port;
 const headers = { 'X-App-Internal-Key': 'attendance-concurrency', 'Content-Type': 'application/json' };
 const request = async (suffix, body) => {
   const response = await fetch(base + '/__copetin_db' + suffix, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
   assert.ok(response.ok, suffix + ' ' + response.status + ' ' + await response.clone().text()); return response.json();
 };
 const marks = users.map((user, index) => ({ userId: user.id, userName: user.fullName, type: 'entrada', location: 'Batallon Colorados', reason: 'Ingreso trabajo', clientOperationId: 'mark-' + index }));
 try {
   // Direct storage burst should need one disk commit, not 24 full-state writes.
   const before = await getStateMeta();
   await Promise.all(users.map(user => updateAttendanceStateSnapshot(state => { state.attendanceRecords.push({ id: 'pre-' + user.id, code: 'PRE-' + user.id, userId: user.id }); })));
   assert.equal((await getStateMeta()).version - before.version, 1);
   const photoStart = performance.now();
   const photos = await Promise.all(users.map(async user => {
     const response = await fetch(base + '/api/uploads/attendance', { method: 'POST', headers: { 'X-App-Internal-Key': 'attendance-concurrency', 'Content-Type': 'image/jpeg', 'X-Attendance-Id': user.id }, body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) });
     assert.equal(response.status, 201, await response.clone().text()); return response.json();
   }));
   assert.equal(new Set(photos.map(photo => photo.photoUrl)).size, 24);
   marks.forEach((mark, index) => { mark.photoUrl = photos[index].photoUrl; mark.location = 'Almacen externo'; });
   const start = performance.now();
   const results = await Promise.all([
     ...marks.map(mark => request('/attendance', mark)),
     ...users.map(() => request('/collections?names=users')),
     ...Array.from({ length: 4 }, (_, index) => request('/inventory/movements', { itemId: 'i', type: 'entrada', quantity: 1, reason: 'Compra', clientOperationId: 'purchase-' + index })),
     ...users.slice(0, 4).map(user => request('/presence/heartbeat', { userId: user.id, sessionId: user.id, activeTab: 'asistencia' })),
     request('?meta=1'), request('/attendance/users'),
   ]);
   const concurrentMs = performance.now() - start;
   console.log('Concurrent HTTP workload completed in ' + Math.round(concurrentMs) + 'ms');
   const saved = results.slice(0, marks.length).map(result => result.record);
   assert.equal(new Set(saved.map(row => row.id)).size, 24); assert.equal(new Set(saved.map(row => row.code)).size, 24);
   const after = await getStateSnapshot();
   assert.equal(after.state.items[0].totalStock, 104); assert.equal(after.state.inventoryMovements.length, 4);
   assert.deepEqual(after.state.contracts, commercial);
   assert.equal(after.state.attendanceRecords.length, 48);
   const retryBefore = await getStateMeta();
   const retried = await Promise.all(marks.map(mark => request('/attendance', mark)));
   assert.ok(retried.every(row => row.duplicated));
   assert.equal((await getStateMeta()).version, retryBefore.version);
   const conflict = await fetch(base + '/__copetin_db/attendance', { method: 'POST', headers, body: JSON.stringify({ ...marks[0], userId: 'someone-else' }) });
   assert.equal(conflict.status, 409);
   console.log('24 unique photo uploads: ' + Math.round(start - photoStart) + 'ms');
   // One invalid operation cannot roll back the remaining people in its batch.
   const rejected = updateAttendanceStateSnapshot(state => { state.attendanceRecords.push({ id: 'must-not-save' }); throw new Error('invalid mark'); });
   const valid = updateAttendanceStateSnapshot(state => { state.attendanceRecords.push({ id: 'valid-last' }); });
   const settled = await Promise.allSettled([rejected, valid]); assert.equal(settled[0].status, 'rejected'); assert.equal(settled[1].status, 'fulfilled');
   await updateStateSnapshot(state => { state.settings.concurrentCommercialEdit = true; return state; });
   const disk = JSON.parse(await fs.readFile(process.env.APP_STATE_FILE, 'utf8'));
   assert.equal(disk.state.attendanceRecords.filter(row => row.id === 'must-not-save').length, 0);
   assert.equal(disk.state.attendanceRecords.length, 49); assert.equal(disk.state.settings.concurrentCommercialEdit, true);
   const originalWriteFile = fs.writeFile;
   fs.writeFile = async (...args) => {
     if (String(args[0]).endsWith('.tmp')) throw new Error('simulated disk failure');
     return originalWriteFile(...args);
   };
   try {
     const failedWrites = await Promise.allSettled(users.slice(0, 4).map(user => updateAttendanceStateSnapshot(state => { state.attendanceRecords.push({ id: 'disk-failure-' + user.id }); })));
     assert.ok(failedWrites.every(result => result.status === 'rejected'));
   } finally { fs.writeFile = originalWriteFile; }
   assert.equal((await getStateSnapshot()).state.attendanceRecords.length, 49);
   const persisted = JSON.parse(await fs.readFile(process.env.APP_STATE_FILE, 'utf8'));
   assert.equal(persisted.state.attendanceRecords.length, 49);
   assert.ok(concurrentMs < 15000, 'concurrent requests must finish without a minute-long stall');
   console.log('24 logins + 24 marks + 4 inventory writes + presence: ' + Math.round(concurrentMs) + 'ms; durable records, no lost business edits');
 } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); }
});
