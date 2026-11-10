import test from 'node:test';
import assert from 'node:assert/strict';
import { manageAttendance, canManageAttendance } from './attendanceManagement.js';
const fixture = () => ({ users: [{ id: 'owner', fullName: 'YORDY COPA CEREZO', status: 'active' }, { id: 'admin', fullName: 'Otra persona', role: 'super_admin' }, { id: 'worker', fullName: 'Trabajador' }, { id: '3331b08b-370c-4d6d-9577-b7f451d8be1d', fullName: 'LISBETH MUÑOZ', username: 'lisbeth', status: 'active' }], attendanceRecords: [] });
const draft = { userId: 'worker', type: 'entrada', capturedAt: '2026-10-01T12:00:00Z', location: 'Oficina', reason: 'Registro corregido' };

for (const actorId of ['owner', '3331b08b-370c-4d6d-9577-b7f451d8be1d']) {
  test(actorId + ' can create, edit and delete attendance while preserving evidence and audit history', () => {
    const state = fixture();
    const actor = state.users.find(user => user.id === actorId);
    assert.equal(canManageAttendance(actor), true);
    const record = manageAttendance(state, { actorId, action: 'create', record: draft });
    record.photoUrl = '/uploads/photo.jpg';
    assert.equal(record.code, 'ASI-00001');
    assert.equal(record.createdBy, actor.fullName);
    manageAttendance(state, { actorId, action: 'edit', id: record.id, record: { ...draft, type: 'salida', capturedAt: '2026-10-01T20:00:00Z' } });
    assert.equal(record.type, 'salida');
    assert.equal(record.photoUrl, '/uploads/photo.jpg');
    assert.equal(record.editHistory[0].type, 'entrada');
    assert.equal(record.editHistory[0].editedById, actorId);
    manageAttendance(state, { actorId, action: 'delete', id: record.id });
    assert.ok(record.deletedAt);
    assert.equal(record.deletedById, actorId);
    const next = manageAttendance(state, { actorId, action: 'create', record: draft });
    assert.equal(next.code, 'ASI-00002');
  });
}
test('other users including a super admin cannot manage attendance', () => {
  const state = fixture();
  for (const actorId of ['admin', 'worker', 'missing']) {
    for (const action of ['create', 'edit', 'delete']) assert.throws(() => manageAttendance(state, { actorId, action, record: draft }), error => error.statusCode === 403);
  }
  assert.equal(state.attendanceRecords.length, 0);
});
test('invalid input and inactive or deleted managers are rejected; name matching ignores accents, spaces and case', () => {
  const state = fixture();
  assert.throws(() => manageAttendance(state, { actorId: 'owner', action: 'create', record: { ...draft, capturedAt: 'invalid' } }));
  assert.equal(canManageAttendance({ id: 'lisbeth', fullName: '  Lisbeth  Munoz ', status: 'active' }), true);
  for (const actor of [state.users[0], state.users[3]]) {
    for (const status of ['inactive', 'inactivo', 'disabled', 'eliminado']) {
      actor.status = status;
      assert.equal(canManageAttendance(actor), false);
      assert.throws(() => manageAttendance(state, { actorId: actor.id, action: 'create', record: draft }), error => error.statusCode === 403);
    }
    actor.status = 'active'; actor.deletedAt = '2026-11-10T00:00:00Z';
    assert.equal(canManageAttendance(actor), false);
  }
  assert.equal(canManageAttendance({ id: 'other', fullName: 'YORDY TORRIENTE', status: 'active' }), false);
});
