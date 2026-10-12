const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
export const canManageAttendance = user => Boolean(user?.id && !user.deletedAt && !['inactive', 'inactivo', 'disabled', 'eliminado'].includes(normalize(user.status)) && normalize(user.fullName) === 'yordy copa cerezo');

export function manageAttendance(state, payload) {
  const actor = (state.users ?? []).find(user => String(user.id) === String(payload.actorId));
  if (!canManageAttendance(actor)) { const error = new Error('Solo Yordy Copa Cerezo puede administrar asistencias.'); error.statusCode = 403; throw error; }
  state.attendanceRecords ??= [];
  const now = new Date().toISOString();
  const record = state.attendanceRecords.find(row => row.id === payload.id && !row.deletedAt);
  if (payload.action !== 'create' && !record) { const error = new Error('Asistencia no encontrada.'); error.statusCode = 404; throw error; }
  if (payload.action === 'delete') {
    Object.assign(record, { deletedAt: now, deletedById: actor.id, deletedByName: actor.fullName });
    return record;
  }
  if (!['create', 'edit'].includes(payload.action)) throw new Error('Operacion no valida.');
  const draft = payload.record ?? {};
  const user = (state.users ?? []).find(row => String(row.id) === String(draft.userId));
  const capturedAt = new Date(draft.capturedAt);
  if (!user || !['entrada', 'salida'].includes(draft.type) || !draft.location?.trim() || !draft.reason?.trim() || Number.isNaN(capturedAt.getTime())) throw new Error('Completa usuario, fecha, tipo, ubicacion y motivo.');
  const next = record ?? { id: `att-${Date.now()}-${Math.random().toString(16).slice(2)}`, code: `ASI-${String(1 + state.attendanceRecords.reduce((max, row) => Math.max(max, Number(String(row.code ?? '').replace(/^ASI-/, '')) || 0), 0)).padStart(5, '0')}`, createdAt: now, createdBy: actor.fullName, manuallyCreated: true };
  if (record) next.editHistory = [...(record.editHistory ?? []), { capturedAt: record.capturedAt, userId: record.userId, type: record.type, location: record.location, reason: record.reason, editedAt: now, editedById: actor.id }];
  Object.assign(next, { userId: user.id, userName: user.fullName || user.username, role: user.role || '', capturedAt: capturedAt.toISOString(), type: draft.type, location: draft.location.trim(), reason: draft.reason.trim(), updatedAt: now, editedById: actor.id, editedByName: actor.fullName });
  if (!record) state.attendanceRecords.push(next);
  return next;
}
