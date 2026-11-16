import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceRecordMatchesQuery, filterAttendanceReportRecords, buildAttendanceReportAnalysis } from './attendanceAnalysis.js';

test('searching Aracely excludes other people she registered, including report hours', () => {
  const rows = [
    { id: 'a1', userId: 'a', userName: 'ARACELY SIERRA', type: 'entrada', capturedAt: '2026-11-16T12:00:00Z' },
    { id: 'a2', userId: 'a', userName: 'ARACELY SIERRA', type: 'salida', capturedAt: '2026-11-16T16:00:00Z' },
    { id: 'z', userId: 'z', userName: 'ZARELA VACA', responsibleName: 'ARACELY SIERRA', groupMemberNames: ['ARACELY SIERRA'], type: 'entrada', capturedAt: '2026-11-16T12:00:00Z' },
  ];
  assert.equal(attendanceRecordMatchesQuery(rows[0], 'aracely sier'), true);
  assert.equal(attendanceRecordMatchesQuery(rows[2], 'aracely sier'), false);
  const filters = { query: 'aracely sier', type: 'all', dateFrom: '2026-11-16', dateTo: '2026-11-16' };
  const filtered = filterAttendanceReportRecords(rows, filters);
  assert.deepEqual(filtered.map(row => row.id), ['a1', 'a2']);
  const report = buildAttendanceReportAnalysis({ records: filtered, calculationRecords: rows, filters, now: '2026-11-16T20:00:00Z' });
  assert.equal(report.journeys.length, 1);
  assert.equal(report.workedMinutes, 240);
  assert.equal(report.pending.length, 0);
  assert.equal(attendanceRecordMatchesQuery({ userName: 'LISBETH MUÑOZ' }, 'lisbeth munoz'), true);
});
