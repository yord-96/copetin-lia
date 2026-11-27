import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAttendanceTime } from './attendanceAnalysis.js';
import { attendanceDateTimeInput, attendanceInputToIso, attendanceTimeTyping, formatAttendanceDateTime } from './attendanceDateTime.js';

test('attendance always shows 00 through 23 and preserves Bolivia times on create/edit', () => {
  for (const time of ['00:00', '00:01', '12:00', '13:30', '23:59']) {
    const local = `2026-11-27T${time}`;
    const iso = attendanceInputToIso(local);
    assert.equal(attendanceDateTimeInput(iso), local);
    assert.equal(formatAttendanceTime(iso), `${time}:00`);
    assert.ok(formatAttendanceDateTime(iso).includes(`${time}:00`));
    assert.doesNotMatch(formatAttendanceDateTime(iso), /[ap]\.?\s?m\.?/i);
  }
  assert.equal(attendanceInputToIso('2026-11-27T23:59'), '2026-11-28T03:59:00.000Z');
  assert.equal(attendanceDateTimeInput('2026-11-28T03:59:00Z'), '2026-11-27T23:59');
  assert.equal(attendanceTimeTyping('1830'), '18:30');
  assert.equal(attendanceTimeTyping('183'), '18:3');
  assert.equal(attendanceTimeTyping('00:00'), '00:00');
  for (const invalid of ['2026-11-27T24:00', '2026-11-27T18:60', '2026-11-27T06:30 PM', '2026-11-27T6:30', '2026-02-30T12:00']) assert.throws(() => attendanceInputToIso(invalid));
});
