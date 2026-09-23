const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function buildPersonnelOverview(state = {}, params = {}) {
  const active = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => row && !row.deletedAt);
  const employees = active(state.personnelEmployees);
  const attendance = active(state.personnelAttendance);
  const incidents = active(state.personnelIncidents);
  const view = ['employees', 'attendance', 'incidents'].includes(params.view) ? params.view : 'employees';
  const query = normalize(params.query).trim();
  const month = /^\d{4}-\d{2}$/.test(params.month) ? params.month : new Date().toISOString().slice(0, 7);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize, 10) || 25));
  const fields = view === 'employees'
    ? ['fullName', 'employeeCode', 'biometricCode', 'documentId', 'department', 'position']
    : ['employeeName', 'employeeCode', 'date', 'dateFrom', 'type', 'status', 'reason'];
  const rows = ({ employees, attendance, incidents })[view]
    .filter((row) => !query || fields.some((field) => normalize(row[field]).includes(query)))
    .sort((a, b) => {
      const order = view === 'employees'
        ? String(a.fullName ?? '').localeCompare(String(b.fullName ?? ''), 'es')
        : String(view === 'attendance' ? `${b.date} ${b.checkIn}` : b.dateFrom || b.createdAt)
          .localeCompare(String(view === 'attendance' ? `${a.date} ${a.checkIn}` : a.dateFrom || a.createdAt));
      return order || String(a.id).localeCompare(String(b.id));
    });
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, parseInt(params.page, 10) || 1));
  const monthAttendance = attendance.filter((row) => String(row.date ?? '').startsWith(month));
  const sum = (field) => monthAttendance.reduce((total, row) => total + (Number(row[field]) || 0), 0);
  return {
    view, page, pageSize, total: rows.length, totalPages,
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    counts: { employees: employees.length, attendance: attendance.length, incidents: incidents.length },
    summary: {
      activeEmployees: employees.filter((row) => (row.status ?? 'active') === 'active').length,
      monthOvertime: sum('overtimeHours'), monthMissing: sum('missingHours'),
      openIncidents: incidents.filter((row) => ['pendiente', 'aprobado'].includes(row.status)).length,
    },
    employeeOptions: employees.map(({ id, fullName }) => ({ id, fullName }))
      .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'es')),
  };
}
