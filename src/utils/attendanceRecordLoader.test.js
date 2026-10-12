import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttendanceRecordLoader } from './attendanceRecordLoader.js';
test('background refresh keeps report dates, query and type', async () => {
  const calls = []; const published = [];
  const loader = createAttendanceRecordLoader(async filters => { calls.push(filters); return [{ id: '1' }, { id: '2' }]; }, rows => published.push(rows));
  const filters = { dateFrom: '2026-10-01', dateTo: '2026-10-12', query: 'yordy copa', type: 'all', limit: 300 };
  await loader.load(filters);
  filters.dateFrom = '2026-10-12';
  await loader.load();
  assert.equal(calls[1].dateFrom, '2026-10-01');
  assert.equal(calls[1].query, 'yordy copa');
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(published[1].length, 2);
});
test('older responses cannot overwrite a newer search', async () => {
  const pending = []; const published = [];
  const loader = createAttendanceRecordLoader(filters => new Promise(resolve => pending.push({ filters, resolve })), rows => published.push(rows));
  const first = loader.load({ query: 'primero' });
  const second = loader.load({ query: 'segundo' });
  pending[1].resolve([{ id: 'correct' }]); await second;
  pending[0].resolve([{ id: 'outdated' }]); await first;
  assert.deepEqual(published, [[{ id: 'correct' }]]);
});
