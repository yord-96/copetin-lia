import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttendanceSubmissionTracker } from './attendanceSubmission.js';
test('interrupted individual/group submissions reuse operation ids and evidence; new marks use new ids', () => {
 let id = 0; const tracker = createAttendanceSubmissionTracker(() => String(++id));
 const first = tracker.get('group-a', 20, true); first.photo = { photoUrl: '/uploads/attendance/group.jpg' };
 const retry = tracker.get('group-a', 20, true);
 assert.equal(retry, first); assert.equal(new Set(retry.operations).size, 20); assert.equal(retry.photo.photoUrl, first.photo.photoUrl);
 const different = tracker.get('group-b', 20, true); assert.notEqual(different.groupId, first.groupId);
 tracker.clear(); const next = tracker.get('group-b', 20, true); assert.notEqual(next.operations[0], different.operations[0]);
 const personal = tracker.get('personal', 1, false); assert.equal(personal.groupId, '');
 assert.equal(tracker.get('personal', 1, false).operations[0], personal.operations[0]);
});
