const normalizeText = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const timeToMinutes = (value) => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const minutesToHours = (minutes) => Number(Math.max(0, minutes / 60).toFixed(2));

const getWeekdayFromDate = (date) => {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getDay();
};

const calculateAttendanceMeta = ({ employee, date, checkIn, checkOut }) => {
  const inMinutes = timeToMinutes(checkIn);
  const outMinutes = timeToMinutes(checkOut);
  const workingDays = Array.isArray(employee?.schedule?.workingDays) && employee.schedule.workingDays.length
    ? employee.schedule.workingDays.map((day) => Number(day))
    : [1, 2, 3, 4, 5, 6];
  const weekday = getWeekdayFromDate(date);
  const isWorkingDay = !employee || weekday === null || workingDays.includes(weekday);
  const scheduleStart = timeToMinutes(employee?.schedule?.start ?? '08:00') ?? 480;
  const scheduleEnd = timeToMinutes(employee?.schedule?.end ?? '17:00') ?? 1020;
  const expectedMinutes = isWorkingDay
    ? Math.max(60, Number(employee?.schedule?.dailyHours ?? 8) * 60)
    : 0;

  if (!date || inMinutes === null || outMinutes === null || outMinutes <= inMinutes) {
    return {
      workedHours: 0,
      overtimeHours: 0,
      missingHours: employee && isWorkingDay ? minutesToHours(expectedMinutes) : 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      status: 'incompleto',
    };
  }

  const workedMinutes = outMinutes - inMinutes;
  const lateMinutes = isWorkingDay ? Math.max(0, inMinutes - scheduleStart) : 0;
  const earlyLeaveMinutes = isWorkingDay ? Math.max(0, scheduleEnd - outMinutes) : 0;
  const overtimeMinutes = Math.max(0, workedMinutes - expectedMinutes);
  const missingMinutes = Math.max(0, expectedMinutes - workedMinutes);
  const status = missingMinutes > 0 || lateMinutes > 0 || earlyLeaveMinutes > 0
    ? 'observado'
    : overtimeMinutes > 0
      ? 'extra'
      : 'normal';

  return {
    workedHours: minutesToHours(workedMinutes),
    overtimeHours: minutesToHours(overtimeMinutes),
    missingHours: minutesToHours(missingMinutes),
    lateMinutes,
    earlyLeaveMinutes,
    workingDay: isWorkingDay,
    status,
  };
};

const nextPersonnelCode = (employees) => {
  let nextNumber = employees.length + 1;
  let code = `EMP-${String(nextNumber).padStart(4, '0')}`;
  const existingCodes = new Set(employees.map((employee) => normalizeText(employee?.employeeCode)));
  while (existingCodes.has(normalizeText(code))) {
    nextNumber += 1;
    code = `EMP-${String(nextNumber).padStart(4, '0')}`;
  }
  return code;
};


// Shared business rules; the caller owns the transaction and persistence.
export const createPersonnelOperations = ({ transaction, readQueryState, makeId, deepClone, consumeDocumentCode }) => ({
    listBundle: async () => {
      const state = readQueryState();
      return {
        employees: state.personnelEmployees
          .filter((row) => !row.deletedAt)
          .slice()
          .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es')),
        attendance: state.personnelAttendance
          .slice()
          .sort((a, b) => new Date(`${b.date}T${b.checkIn || '00:00'}`) - new Date(`${a.date}T${a.checkIn || '00:00'}`)),
        incidents: state.personnelIncidents
          .filter((row) => !row.deletedAt)
          .slice()
          .sort((a, b) => new Date(b.dateFrom || b.createdAt) - new Date(a.dateFrom || a.createdAt)),
      };
    },
    createEmployee: async (payload) => {
      const fullName = String(payload?.fullName ?? '').trim();
      if (!fullName) throw new Error('El nombre del trabajador es obligatorio.');

      let created = null;
      transaction((state) => {
        const now = new Date().toISOString();
        const employeeCode = String(payload?.employeeCode ?? '').trim()
          || nextPersonnelCode(state.personnelEmployees);
        const exists = state.personnelEmployees.some(
          (entry) => !entry.deletedAt && normalizeText(entry.employeeCode) === normalizeText(employeeCode),
        );
        if (exists) throw new Error('Ya existe personal con ese codigo.');

        created = {
          id: makeId('emp'),
          employeeCode,
          biometricCode: String(payload?.biometricCode ?? employeeCode).trim(),
          fullName,
          documentId: String(payload?.documentId ?? '').trim(),
          phone: String(payload?.phone ?? payload?.whatsapp ?? '').trim(),
          whatsapp: String(payload?.whatsapp ?? payload?.phone ?? '').trim(),
          photoUrl: String(payload?.photoUrl ?? '').trim(),
          email: String(payload?.email ?? '').trim().toLowerCase(),
          address: String(payload?.address ?? '').trim(),
          city: String(payload?.city ?? '').trim(),
          department: String(payload?.department ?? 'Operaciones').trim() || 'Operaciones',
          position: String(payload?.position ?? '').trim(),
          contractType: String(payload?.contractType ?? 'indefinido').trim() || 'indefinido',
          hireDate: String(payload?.hireDate ?? '').trim() || null,
          salaryBs: Math.max(0, Number(payload?.salaryBs ?? 0)),
          schedule: {
            start: String(payload?.schedule?.start ?? '08:00').trim() || '08:00',
            end: String(payload?.schedule?.end ?? '17:00').trim() || '17:00',
            dailyHours: Math.max(1, Number(payload?.schedule?.dailyHours ?? 8)),
            workingDays: Array.isArray(payload?.schedule?.workingDays) && payload.schedule.workingDays.length
              ? payload.schedule.workingDays.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6)
              : [1, 2, 3, 4, 5, 6],
          },
          emergencyContact: String(payload?.emergencyContact ?? '').trim(),
          emergencyPhone: String(payload?.emergencyPhone ?? '').trim(),
          notes: String(payload?.notes ?? '').trim(),
          status: String(payload?.status ?? 'active').trim() || 'active',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.personnelEmployees.push(created);
        return state;
      });

      return created;
    },
    updateEmployee: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el trabajador.');

      let updated = null;
      transaction((state) => {
        const employee = state.personnelEmployees.find((entry) => entry.id === id && !entry.deletedAt);
        if (!employee) throw new Error('Personal no encontrado.');

        const nextCode = String(payload?.employeeCode ?? employee.employeeCode).trim();
        if (!nextCode) throw new Error('El codigo no puede estar vacio.');
        const exists = state.personnelEmployees.some(
          (entry) => entry.id !== id && !entry.deletedAt && normalizeText(entry.employeeCode) === normalizeText(nextCode),
        );
        if (exists) throw new Error('Ya existe otro trabajador con ese codigo.');

        employee.employeeCode = nextCode;
        employee.biometricCode = String(payload?.biometricCode ?? employee.biometricCode ?? nextCode).trim();
        employee.fullName = String(payload?.fullName ?? employee.fullName).trim() || employee.fullName;
        employee.documentId = String(payload?.documentId ?? employee.documentId ?? '').trim();
        employee.phone = String(payload?.phone ?? payload?.whatsapp ?? employee.phone ?? '').trim();
        employee.whatsapp = String(payload?.whatsapp ?? payload?.phone ?? employee.whatsapp ?? '').trim();
        employee.photoUrl = String(payload?.photoUrl ?? employee.photoUrl ?? '').trim();
        employee.email = String(payload?.email ?? employee.email ?? '').trim().toLowerCase();
        employee.address = String(payload?.address ?? employee.address ?? '').trim();
        employee.city = String(payload?.city ?? employee.city ?? '').trim();
        employee.department = String(payload?.department ?? employee.department ?? 'Operaciones').trim() || 'Operaciones';
        employee.position = String(payload?.position ?? employee.position ?? '').trim();
        employee.contractType = String(payload?.contractType ?? employee.contractType ?? 'indefinido').trim() || 'indefinido';
        employee.hireDate = String(payload?.hireDate ?? employee.hireDate ?? '').trim() || null;
        employee.salaryBs = Math.max(0, Number(payload?.salaryBs ?? employee.salaryBs ?? 0));
        employee.schedule = {
          start: String(payload?.schedule?.start ?? employee.schedule?.start ?? '08:00').trim() || '08:00',
          end: String(payload?.schedule?.end ?? employee.schedule?.end ?? '17:00').trim() || '17:00',
          dailyHours: Math.max(1, Number(payload?.schedule?.dailyHours ?? employee.schedule?.dailyHours ?? 8)),
          workingDays: Array.isArray(payload?.schedule?.workingDays) && payload.schedule.workingDays.length
            ? payload.schedule.workingDays.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6)
            : (Array.isArray(employee.schedule?.workingDays) && employee.schedule.workingDays.length
              ? employee.schedule.workingDays
              : [1, 2, 3, 4, 5, 6]),
        };
        employee.emergencyContact = String(payload?.emergencyContact ?? employee.emergencyContact ?? '').trim();
        employee.emergencyPhone = String(payload?.emergencyPhone ?? employee.emergencyPhone ?? '').trim();
        employee.notes = String(payload?.notes ?? employee.notes ?? '').trim();
        employee.status = String(payload?.status ?? employee.status ?? 'active').trim() || 'active';
        employee.updatedAt = new Date().toISOString();

        state.personnelAttendance.forEach((entry) => {
          if (entry.employeeId === id) {
            entry.employeeCode = employee.employeeCode;
            entry.employeeName = employee.fullName;
          }
        });
        state.personnelIncidents.forEach((entry) => {
          if (entry.employeeId === id) entry.employeeName = employee.fullName;
        });
        updated = deepClone(employee);
        return state;
      });

      return updated;
    },
    removeEmployee: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el trabajador.');

      let removed = null;
      transaction((state) => {
        const employee = state.personnelEmployees.find((entry) => entry.id === id && !entry.deletedAt);
        if (!employee) throw new Error('Personal no encontrado.');
        employee.deletedAt = new Date().toISOString();
        employee.status = 'inactive';
        employee.updatedAt = employee.deletedAt;
        removed = deepClone(employee);
        return state;
      });
      return removed;
    },
    createIncident: async (payload) => {
      const employeeId = String(payload?.employeeId ?? '').trim();
      const dateFrom = String(payload?.dateFrom ?? payload?.date ?? '').trim();
      if (!employeeId) throw new Error('Selecciona un trabajador.');
      if (!dateFrom) throw new Error('Indica la fecha del registro.');

      let created = null;
      transaction((state) => {
        const employee = state.personnelEmployees.find((entry) => entry.id === employeeId && !entry.deletedAt);
        if (!employee) throw new Error('Personal no encontrado.');
        const now = new Date().toISOString();
        created = {
          id: makeId('hrinc'),
          employeeId,
          employeeName: employee.fullName,
          type: String(payload?.type ?? 'permiso').trim() || 'permiso',
          dateFrom,
          dateTo: String(payload?.dateTo ?? dateFrom).trim() || dateFrom,
          hours: Math.max(0, Number(payload?.hours ?? 0)),
          status: String(payload?.status ?? 'aprobado').trim() || 'aprobado',
          reason: String(payload?.reason ?? '').trim(),
          notes: String(payload?.notes ?? '').trim(),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.personnelIncidents.push(created);
        return state;
      });

      return created;
    },
    updateIncident: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el registro.');

      let updated = null;
      transaction((state) => {
        const incident = state.personnelIncidents.find((entry) => entry.id === id && !entry.deletedAt);
        if (!incident) throw new Error('Registro no encontrado.');
        if (payload.type !== undefined) incident.type = String(payload.type ?? '').trim() || incident.type;
        if (payload.dateFrom !== undefined) incident.dateFrom = String(payload.dateFrom ?? '').trim() || incident.dateFrom;
        if (payload.dateTo !== undefined) incident.dateTo = String(payload.dateTo ?? '').trim() || incident.dateTo;
        if (payload.hours !== undefined) incident.hours = Math.max(0, Number(payload.hours ?? 0));
        if (payload.status !== undefined) incident.status = String(payload.status ?? '').trim() || incident.status;
        if (payload.reason !== undefined) incident.reason = String(payload.reason ?? '').trim();
        if (payload.notes !== undefined) incident.notes = String(payload.notes ?? '').trim();
        incident.updatedAt = new Date().toISOString();
        updated = deepClone(incident);
        return state;
      });
      return updated;
    },
    importAttendance: async (payload) => {
      const records = Array.isArray(payload?.records) ? payload.records : [];
      if (!records.length) throw new Error('No hay registros validos para importar.');

      let result = { imported: 0, unmatched: 0, observed: 0, overtime: 0 };
      transaction((state) => {
        const importCode = consumeDocumentCode(state, 'hrImportPrefix', 'hrImportNext', 5);
        const now = new Date().toISOString();

        records.forEach((record) => {
          const employeeCode = String(record?.employeeCode ?? record?.biometricCode ?? '').trim();
          const employeeName = String(record?.employeeName ?? record?.fullName ?? '').trim();
          const employee = state.personnelEmployees.find((entry) =>
            !entry.deletedAt
            && (
              (employeeCode && normalizeText(entry.biometricCode || entry.employeeCode) === normalizeText(employeeCode))
              || (employeeCode && normalizeText(entry.employeeCode) === normalizeText(employeeCode))
              || (employeeName && normalizeText(entry.fullName) === normalizeText(employeeName))
            ));
          if (!employee) result.unmatched += 1;

          const date = String(record?.date ?? '').trim();
          const checkIn = String(record?.checkIn ?? '').trim();
          const checkOut = String(record?.checkOut ?? '').trim();
          if (!date || !checkIn || !checkOut) return;

          const meta = calculateAttendanceMeta({ employee, date, checkIn, checkOut });
          const duplicateIndex = state.personnelAttendance.findIndex(
            (entry) =>
              entry.date === date
              && (
                (employee?.id && entry.employeeId === employee.id)
                || (!employee?.id && entry.employeeCode === employeeCode && entry.employeeName === employeeName)
              ),
          );
          const nextEntry = {
            id: duplicateIndex >= 0 ? state.personnelAttendance[duplicateIndex].id : makeId('att'),
            employeeId: employee?.id ?? null,
            employeeCode: employee?.employeeCode ?? employeeCode,
            employeeName: employee?.fullName ?? employeeName,
            date,
            checkIn,
            checkOut,
            ...meta,
            source: String(payload?.source ?? 'ZKTeco').trim() || 'ZKTeco',
            importCode,
            notes: employee ? '' : 'No se encontro coincidencia con el personal registrado.',
            createdAt: duplicateIndex >= 0 ? state.personnelAttendance[duplicateIndex].createdAt : now,
            updatedAt: now,
          };
          if (duplicateIndex >= 0) {
            state.personnelAttendance[duplicateIndex] = nextEntry;
          } else {
            state.personnelAttendance.push(nextEntry);
          }

          result.imported += 1;
          if (meta.overtimeHours > 0) result.overtime += 1;
          if (meta.status === 'observado' || meta.status === 'incompleto') result.observed += 1;
        });
        return state;
      });

      return result;
    },
  });
