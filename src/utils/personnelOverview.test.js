import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonnelOverview } from './personnelOverview.js';
import { mutatePersonnel } from '../../server/services/personnelService.js';

test('pages and searches employees without leaking unrelated collections or deleted rows', () => {
  const employees = Array.from({ length: 61 }, (_, index) => ({ id: String(index), fullName: `Persona ${String(index).padStart(2, '0')}`, status: 'active' }));
  employees.push({ id: 'deleted', fullName: 'Borrado', deletedAt: '2026-01-01' });
  employees[40].documentId = '12345';
  employees[40].position = 'Administración';
  const state = { personnelEmployees: employees, contracts: [{ private: true }] };
  const page = buildPersonnelOverview(state, { page: 3, pageSize: 25 });
  assert.equal(page.rows.length, 11);
  assert.equal(page.counts.employees, 61);
  assert.equal(page.summary.activeEmployees, 61);
  assert.equal(page.contracts, undefined);
  assert.equal(buildPersonnelOverview(state, { query: 'administracion' }).rows[0].id, '40');
  assert.equal(buildPersonnelOverview(state, { query: '12345' }).total, 1);
  assert.equal(buildPersonnelOverview(state, { page: 100 }).page, 3);
});

test('monthly totals cover all pages and remain independent of search', () => {
  const state = {
    personnelAttendance: [
      { id: 'a', date: '2026-09-23', employeeName: 'Ana', overtimeHours: 2, missingHours: 1 },
      { id: 'b', date: '2026-09-22', employeeName: 'Luis', overtimeHours: 3 },
      { id: 'c', date: '2026-08-22', overtimeHours: 99 },
    ],
    personnelIncidents: [{ id: 'i', status: 'aprobado' }, { id: 'j', status: 'rechazado' }],
  };
  const result = buildPersonnelOverview(state, { view: 'attendance', month: '2026-09', query: 'Ana', pageSize: 1 });
  assert.equal(result.total, 1);
  assert.equal(result.summary.monthOvertime, 5);
  assert.equal(result.summary.monthMissing, 1);
  assert.equal(result.summary.openIncidents, 1);
  assert.deepEqual(buildPersonnelOverview({}, {}).rows, []);
});

test('personnel operations preserve business data, match imports and update linked history', async () => {
  const state = { contracts: [{ id: 'untouched' }] };
  const employee = await mutatePersonnel(state, 'createEmployee', { fullName: 'José Pérez', biometricCode: '42' });
  await assert.rejects(mutatePersonnel(state, 'createEmployee', { fullName: 'Otro', employeeCode: employee.employeeCode }), /codigo/);
  const records = [{ employeeCode: '42', date: '2026-09-23', checkIn: '08:00', checkOut: '18:00' }];
  const imported = await mutatePersonnel(state, 'importAttendance', { records });
  assert.equal(imported.imported, 1);
  assert.equal(imported.unmatched, 0);
  assert.equal(state.personnelAttendance[0].employeeId, employee.id);
  assert.equal(state.personnelAttendance[0].overtimeHours, 2);
  await mutatePersonnel(state, 'importAttendance', { records });
  assert.equal(state.personnelAttendance.length, 1);
  const incident = await mutatePersonnel(state, 'createIncident', { employeeId: employee.id, dateFrom: '2026-09-24' });
  await mutatePersonnel(state, 'updateIncident', { id: incident.id, status: 'pendiente' });
  await mutatePersonnel(state, 'updateEmployee', { id: employee.id, fullName: 'José Actualizado' });
  assert.equal(state.personnelAttendance[0].employeeName, 'José Actualizado');
  assert.equal(state.personnelIncidents[0].employeeName, 'José Actualizado');
  await mutatePersonnel(state, 'removeEmployee', { id: employee.id });
  assert.equal(buildPersonnelOverview(state).total, 0);
  assert.equal(state.personnelAttendance.length, 1);
  assert.deepEqual(state.contracts, [{ id: 'untouched' }]);
  await assert.rejects(mutatePersonnel(state, 'invalid', {}), /Operacion/);
});
