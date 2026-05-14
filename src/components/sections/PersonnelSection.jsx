import { useMemo, useRef, useState } from 'react';
import { readFileAsDataUrl } from '../../utils/files';

const EMPTY_EMPLOYEE = {
  id: '',
  employeeCode: '',
  biometricCode: '',
  fullName: '',
  documentId: '',
  whatsapp: '',
  email: '',
  photoUrl: '',
  address: '',
  city: '',
  department: 'Operaciones',
  position: '',
  contractType: 'indefinido',
  hireDate: '',
  salaryBs: '',
  scheduleStart: '08:00',
  scheduleEnd: '17:00',
  dailyHours: '8',
  workingDays: [1, 2, 3, 4, 5, 6],
  emergencyContact: '',
  emergencyPhone: '',
  notes: '',
  status: 'active',
};

const EMPTY_INCIDENT = {
  employeeId: '',
  type: 'permiso',
  dateFrom: '',
  dateTo: '',
  hours: '',
  status: 'aprobado',
  reason: '',
  notes: '',
};

const EMPLOYEE_STATUS_LABELS = {
  active: 'Activo',
  inactive: 'Inactivo',
  vacation: 'Vacaciones',
  suspended: 'Suspendido',
};

const ATTENDANCE_STATUS_LABELS = {
  normal: 'Normal',
  extra: 'Con extra',
  observado: 'Observado',
  incompleto: 'Incompleto',
};

const INCIDENT_STATUS_LABELS = {
  aprobado: 'Aprobado',
  pendiente: 'Pendiente',
  rechazado: 'Rechazado',
};

const INCIDENT_TYPE_LABELS = {
  permiso: 'Permiso',
  falta: 'Falta',
  atraso: 'Atraso',
  vacacion: 'Vacacion',
  licencia: 'Licencia',
};

const WEEK_DAYS = [
  { id: 1, short: 'Lun', label: 'Lunes' },
  { id: 2, short: 'Mar', label: 'Martes' },
  { id: 3, short: 'Mie', label: 'Miercoles' },
  { id: 4, short: 'Jue', label: 'Jueves' },
  { id: 5, short: 'Vie', label: 'Viernes' },
  { id: 6, short: 'Sab', label: 'Sabado' },
  { id: 0, short: 'Dom', label: 'Domingo' },
];

const labelFrom = (map, value) => map[value] ?? String(value ?? '-');

const formatWorkingDays = (days = []) => {
  const selected = Array.isArray(days) && days.length ? days : [1, 2, 3, 4, 5, 6];
  return WEEK_DAYS
    .filter((day) => selected.includes(day.id))
    .map((day) => day.short)
    .join(', ');
};

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const toDateKey = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const local = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (local) {
    const year = local[3].length === 2 ? `20${local[3]}` : local[3];
    return `${year}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

const toTimeValue = (value) => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
};

const splitDelimitedLine = (line, separator) => {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === separator && !inQuotes) {
      cells.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim().replace(/^"|"$/g, ''));
  return cells;
};

const findColumn = (headers, candidates) =>
  headers.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));

const parseAttendanceText = (text) => {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const separator = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const headers = splitDelimitedLine(lines[0], separator).map(normalizeText);
  const codeIndex = findColumn(headers, ['codigo', 'code', 'pin', 'id', 'no']);
  const nameIndex = findColumn(headers, ['nombre', 'name', 'empleado', 'personal']);
  const dateIndex = findColumn(headers, ['fecha', 'date', 'dia']);
  const timeIndex = findColumn(headers, ['hora', 'time', 'marcacion', 'punch']);
  const checkInIndex = findColumn(headers, ['entrada', 'check in', 'checkin', 'inicio']);
  const checkOutIndex = findColumn(headers, ['salida', 'check out', 'checkout', 'fin']);

  const grouped = new Map();
  const direct = [];

  lines.slice(1).forEach((line) => {
    const cells = splitDelimitedLine(line, separator);
    const rawCode = codeIndex >= 0 ? cells[codeIndex] : '';
    const rawName = nameIndex >= 0 ? cells[nameIndex] : '';
    let date = dateIndex >= 0 ? toDateKey(cells[dateIndex]) : '';
    let time = timeIndex >= 0 ? toTimeValue(cells[timeIndex]) : '';
    const checkIn = checkInIndex >= 0 ? toTimeValue(cells[checkInIndex]) : '';
    const checkOut = checkOutIndex >= 0 ? toTimeValue(cells[checkOutIndex]) : '';

    if (!date && timeIndex >= 0) {
      date = toDateKey(cells[timeIndex]);
      time = toTimeValue(cells[timeIndex]);
    }

    if (date && checkIn && checkOut) {
      direct.push({ employeeCode: rawCode, employeeName: rawName, date, checkIn, checkOut });
      return;
    }

    if (!date || !time) return;
    const key = `${rawCode || rawName}-${date}`;
    const existing = grouped.get(key) ?? {
      employeeCode: rawCode,
      employeeName: rawName,
      date,
      punches: [],
    };
    existing.punches.push(time);
    grouped.set(key, existing);
  });

  const groupedRecords = Array.from(grouped.values())
    .map((entry) => {
      const punches = entry.punches.sort();
      return {
        employeeCode: entry.employeeCode,
        employeeName: entry.employeeName,
        date: entry.date,
        checkIn: punches[0] ?? '',
        checkOut: punches[punches.length - 1] ?? '',
      };
    })
    .filter((entry) => entry.checkIn && entry.checkOut && entry.checkIn !== entry.checkOut);

  return [...direct, ...groupedRecords];
};

function PersonnelIcon({ kind }) {
  const icons = {
    user: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M5 20c0-3.2 2.8-5 7-5s7 1.8 7 5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    alert: (
      <>
        <path d="M12 4 21 20H3L12 4Z" />
        <path d="M12 9v5M12 17h.01" />
      </>
    ),
    file: (
      <>
        <path d="M7 4h7l4 4v12H7z" />
        <path d="M14 4v5h5M9.5 13h5M9.5 16h4" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {icons[kind] ?? icons.user}
      </g>
    </svg>
  );
}

function PersonnelSection({
  personnelBundle = { employees: [], attendance: [], incidents: [] },
  formatDate,
  formatBs,
  onCreateEmployee,
  onUpdateEmployee,
  onRemoveEmployee,
  onCreateIncident,
  onImportAttendance,
}) {
  const employees = useMemo(() => personnelBundle.employees ?? [], [personnelBundle.employees]);
  const attendance = useMemo(() => personnelBundle.attendance ?? [], [personnelBundle.attendance]);
  const incidents = useMemo(() => personnelBundle.incidents ?? [], [personnelBundle.incidents]);

  const [activeView, setActiveView] = useState('employees');
  const [query, setQuery] = useState('');
  const [employeeModal, setEmployeeModal] = useState(null);
  const [incidentModal, setIncidentModal] = useState(null);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importPreview, setImportPreview] = useState([]);
  const [importFeedback, setImportFeedback] = useState('');
  const fileInputRef = useRef(null);

  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);

  const filteredEmployees = useMemo(() => {
    const text = normalizeText(query);
    return employees.filter((employee) => {
      if (!text) return true;
      return [
        employee.fullName,
        employee.employeeCode,
        employee.biometricCode,
        employee.documentId,
        employee.department,
        employee.position,
      ].some((value) => normalizeText(value).includes(text));
    });
  }, [employees, query]);

  const monthAttendance = attendance.filter((entry) => String(entry.date ?? '').startsWith(currentMonth));
  const activeEmployees = employees.filter((employee) => employee.status === 'active');
  const monthOvertime = monthAttendance.reduce((sum, entry) => sum + Number(entry.overtimeHours ?? 0), 0);
  const monthMissing = monthAttendance.reduce((sum, entry) => sum + Number(entry.missingHours ?? 0), 0);
  const openIncidents = incidents.filter((entry) => ['pendiente', 'aprobado'].includes(entry.status)).length;

  const cards = [
    { tone: 'lilac', icon: 'user', value: activeEmployees.length, label: 'Personal activo' },
    { tone: 'mint', icon: 'clock', value: `${monthOvertime.toFixed(1)} h`, label: 'Horas extra del mes' },
    { tone: 'peach', icon: 'alert', value: `${monthMissing.toFixed(1)} h`, label: 'Horas faltantes' },
    { tone: 'sky', icon: 'file', value: openIncidents, label: 'Permisos y faltas' },
  ];

  const openCreateEmployee = () => {
    setEmployeeModal(EMPTY_EMPLOYEE);
    setFormError('');
  };

  const openEditEmployee = (employee) => {
    setEmployeeModal({
      ...EMPTY_EMPLOYEE,
      ...employee,
      salaryBs: String(employee.salaryBs ?? ''),
      scheduleStart: employee.schedule?.start ?? '08:00',
      scheduleEnd: employee.schedule?.end ?? '17:00',
      dailyHours: String(employee.schedule?.dailyHours ?? 8),
      workingDays: Array.isArray(employee.schedule?.workingDays) && employee.schedule.workingDays.length
        ? employee.schedule.workingDays
        : [1, 2, 3, 4, 5, 6],
    });
    setFormError('');
  };

  const closeEmployeeModal = () => {
    if (isSubmitting) return;
    setEmployeeModal(null);
    setFormError('');
  };

  const handleEmployeeSubmit = async (event) => {
    event.preventDefault();
    if (!employeeModal?.fullName?.trim()) {
      setFormError('Ingresa el nombre del trabajador.');
      return;
    }
    setIsSubmitting(true);
    setFormError('');
    try {
      const payload = {
        id: employeeModal.id || undefined,
        employeeCode: employeeModal.employeeCode,
        biometricCode: employeeModal.biometricCode || employeeModal.employeeCode,
        fullName: employeeModal.fullName,
        documentId: employeeModal.documentId,
        whatsapp: employeeModal.whatsapp,
        photoUrl: employeeModal.photoUrl,
        email: employeeModal.email,
        address: employeeModal.address,
        city: employeeModal.city,
        department: employeeModal.department,
        position: employeeModal.position,
        contractType: employeeModal.contractType,
        hireDate: employeeModal.hireDate || null,
        salaryBs: Number(employeeModal.salaryBs || 0),
        schedule: {
          start: employeeModal.scheduleStart,
          end: employeeModal.scheduleEnd,
          dailyHours: Number(employeeModal.dailyHours || 8),
          workingDays: employeeModal.workingDays,
        },
        emergencyContact: employeeModal.emergencyContact,
        emergencyPhone: employeeModal.emergencyPhone,
        notes: employeeModal.notes,
        status: employeeModal.status,
      };
      if (employeeModal.id) {
        await onUpdateEmployee?.(payload);
      } else {
        await onCreateEmployee?.(payload);
      }
      closeEmployeeModal();
    } catch (error) {
      setFormError(error?.message || 'No se pudo guardar el personal.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openIncidentModal = (employee = null) => {
    setIncidentModal({
      ...EMPTY_INCIDENT,
      employeeId: employee?.id ?? '',
      dateFrom: today,
      dateTo: today,
    });
    setFormError('');
  };

  const closeIncidentModal = () => {
    if (isSubmitting) return;
    setIncidentModal(null);
    setFormError('');
  };

  const handleIncidentSubmit = async (event) => {
    event.preventDefault();
    if (!incidentModal.employeeId) {
      setFormError('Selecciona un trabajador.');
      return;
    }
    setIsSubmitting(true);
    setFormError('');
    try {
      await onCreateIncident?.(incidentModal);
      closeIncidentModal();
    } catch (error) {
      setFormError(error?.message || 'No se pudo registrar el permiso o falta.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportFeedback('');
    try {
      const text = await file.text();
      const records = parseAttendanceText(text);
      setImportPreview(records);
      setActiveView('attendance');
      setImportFeedback(records.length ? `${records.length} registros listos para importar.` : 'No se encontraron marcaciones validas.');
    } catch (error) {
      setImportFeedback(error?.message || 'No se pudo leer el archivo.');
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview.length) return;
    setIsSubmitting(true);
    try {
      const result = await onImportAttendance?.({ records: importPreview, source: 'ZKTeco' });
      setImportFeedback(`Importados: ${result?.imported ?? 0}. Observados: ${result?.observed ?? 0}. Horas extra: ${result?.overtime ?? 0}. Sin coincidencia: ${result?.unmatched ?? 0}.`);
      setImportPreview([]);
    } catch (error) {
      setImportFeedback(error?.message || 'No se pudo importar la asistencia.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderEmployeeModal = () => {
    if (!employeeModal) return null;
    const setField = (field, value) => setEmployeeModal((current) => ({ ...current, [field]: value }));
    const handlePhotoChange = async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        setFormError('Selecciona una imagen valida para la foto.');
        return;
      }
      try {
        const photoUrl = await readFileAsDataUrl(file);
        setField('photoUrl', photoUrl);
        setFormError('');
      } catch (error) {
        setFormError(error?.message || 'No se pudo cargar la foto.');
      }
    };
    const toggleWorkingDay = (dayId) => {
      setEmployeeModal((current) => {
        const selected = new Set(current.workingDays ?? []);
        if (selected.has(dayId)) selected.delete(dayId);
        else selected.add(dayId);
        const nextDays = WEEK_DAYS.map((day) => day.id).filter((day) => selected.has(day));
        return { ...current, workingDays: nextDays.length ? nextDays : [dayId] };
      });
    };
    return (
      <div className="orders-modal-backdrop" onClick={closeEmployeeModal}>
        <form className="orders-modal personnel-modal" onSubmit={handleEmployeeSubmit} onClick={(event) => event.stopPropagation()}>
          <header className="orders-modal-head">
            <div>
              <h3>{employeeModal.id ? 'Editar personal' : 'Nuevo personal'}</h3>
              <p>Datos laborales, contacto, horario y referencia biometrica.</p>
            </div>
            <button type="button" className="orders-modal-close" onClick={closeEmployeeModal}>x</button>
          </header>
          <div className="personnel-form-grid">
            <div className="personnel-photo-field">
              <div className="personnel-photo-preview">
                {employeeModal.photoUrl ? (
                  <img src={employeeModal.photoUrl} alt={`Foto de ${employeeModal.fullName || 'personal'}`} />
                ) : (
                  <PersonnelIcon kind="user" />
                )}
              </div>
              <label className="personnel-photo-button">
                Subir foto
                <input type="file" accept="image/*" hidden onChange={handlePhotoChange} />
              </label>
              {employeeModal.photoUrl ? (
                <button type="button" className="link-button danger" onClick={() => setField('photoUrl', '')}>Quitar foto</button>
              ) : null}
            </div>
            <label>Nombre completo<input value={employeeModal.fullName} onChange={(event) => setField('fullName', event.target.value)} /></label>
            <label>Codigo interno<input value={employeeModal.employeeCode || 'Se genera al guardar'} disabled /></label>
            <label>Codigo ZKTeco<input value={employeeModal.biometricCode} onChange={(event) => setField('biometricCode', event.target.value)} /></label>
            <label>CI / Documento<input value={employeeModal.documentId} onChange={(event) => setField('documentId', event.target.value)} /></label>
            <label>WhatsApp / Celular<input value={employeeModal.whatsapp} onChange={(event) => setField('whatsapp', event.target.value)} /></label>
            <label>Email<input value={employeeModal.email} onChange={(event) => setField('email', event.target.value)} /></label>
            <label>Departamento<input value={employeeModal.department} onChange={(event) => setField('department', event.target.value)} /></label>
            <label>Cargo<input value={employeeModal.position} onChange={(event) => setField('position', event.target.value)} /></label>
            <label>Tipo de contrato<select value={employeeModal.contractType} onChange={(event) => setField('contractType', event.target.value)}><option value="indefinido">Indefinido</option><option value="eventual">Eventual</option><option value="servicio">Por servicio</option><option value="prueba">Prueba</option></select></label>
            <label>Fecha de ingreso<input type="date" value={employeeModal.hireDate || ''} onChange={(event) => setField('hireDate', event.target.value)} /></label>
            <label>Sueldo Bs<input type="number" min="0" value={employeeModal.salaryBs} onChange={(event) => setField('salaryBs', event.target.value)} /></label>
            <label>Entrada<input type="time" value={employeeModal.scheduleStart} onChange={(event) => setField('scheduleStart', event.target.value)} /></label>
            <label>Salida<input type="time" value={employeeModal.scheduleEnd} onChange={(event) => setField('scheduleEnd', event.target.value)} /></label>
            <label>Horas por dia<input type="number" min="1" step="0.5" value={employeeModal.dailyHours} onChange={(event) => setField('dailyHours', event.target.value)} /></label>
            <label>Estado<select value={employeeModal.status} onChange={(event) => setField('status', event.target.value)}><option value="active">Activo</option><option value="inactive">Inactivo</option><option value="vacation">Vacaciones</option><option value="suspended">Suspendido</option></select></label>
            <fieldset className="personnel-days-field span-2">
              <legend>Dias laborables</legend>
              <div>
                {WEEK_DAYS.map((day) => (
                  <label key={day.id} className={employeeModal.workingDays?.includes(day.id) ? 'selected' : ''}>
                    <input
                      type="checkbox"
                      checked={employeeModal.workingDays?.includes(day.id) ?? false}
                      onChange={() => toggleWorkingDay(day.id)}
                    />
                    <span>{day.short}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="span-2">Direccion<input value={employeeModal.address} onChange={(event) => setField('address', event.target.value)} /></label>
            <label>Ciudad<input value={employeeModal.city} onChange={(event) => setField('city', event.target.value)} /></label>
            <label>Contacto emergencia<input value={employeeModal.emergencyContact} onChange={(event) => setField('emergencyContact', event.target.value)} /></label>
            <label>Celular emergencia<input value={employeeModal.emergencyPhone} onChange={(event) => setField('emergencyPhone', event.target.value)} /></label>
            <label className="span-2">Notas<textarea value={employeeModal.notes} onChange={(event) => setField('notes', event.target.value)} /></label>
          </div>
          {formError ? <p className="status error">{formError}</p> : null}
          <footer className="orders-modal-foot">
            <button type="button" className="ghost-button" onClick={closeEmployeeModal}>Cancelar</button>
            <button type="submit" className="primary-button" disabled={isSubmitting}>{isSubmitting ? 'Guardando...' : 'Guardar personal'}</button>
          </footer>
        </form>
      </div>
    );
  };

  const renderIncidentModal = () => {
    if (!incidentModal) return null;
    const setField = (field, value) => setIncidentModal((current) => ({ ...current, [field]: value }));
    return (
      <div className="orders-modal-backdrop" onClick={closeIncidentModal}>
        <form className="orders-modal personnel-incident-modal" onSubmit={handleIncidentSubmit} onClick={(event) => event.stopPropagation()}>
          <header className="orders-modal-head">
            <div>
              <h3>Registrar permiso o falta</h3>
              <p>Deja constancia de ausencias, permisos, atrasos o vacaciones.</p>
            </div>
            <button type="button" className="orders-modal-close" onClick={closeIncidentModal}>x</button>
          </header>
          <div className="personnel-form-grid compact">
            <label>Trabajador<select value={incidentModal.employeeId} onChange={(event) => setField('employeeId', event.target.value)}><option value="">Seleccionar</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</select></label>
            <label>Tipo<select value={incidentModal.type} onChange={(event) => setField('type', event.target.value)}><option value="permiso">Permiso</option><option value="falta">Falta</option><option value="atraso">Atraso</option><option value="vacacion">Vacacion</option><option value="licencia">Licencia</option></select></label>
            <label>Desde<input type="date" value={incidentModal.dateFrom} onChange={(event) => setField('dateFrom', event.target.value)} /></label>
            <label>Hasta<input type="date" value={incidentModal.dateTo} onChange={(event) => setField('dateTo', event.target.value)} /></label>
            <label>Horas<input type="number" min="0" step="0.5" value={incidentModal.hours} onChange={(event) => setField('hours', event.target.value)} /></label>
            <label>Estado<select value={incidentModal.status} onChange={(event) => setField('status', event.target.value)}><option value="aprobado">Aprobado</option><option value="pendiente">Pendiente</option><option value="rechazado">Rechazado</option></select></label>
            <label className="span-2">Motivo<input value={incidentModal.reason} onChange={(event) => setField('reason', event.target.value)} /></label>
            <label className="span-2">Notas<textarea value={incidentModal.notes} onChange={(event) => setField('notes', event.target.value)} /></label>
          </div>
          {formError ? <p className="status error">{formError}</p> : null}
          <footer className="orders-modal-foot">
            <button type="button" className="ghost-button" onClick={closeIncidentModal}>Cancelar</button>
            <button type="submit" className="primary-button" disabled={isSubmitting}>{isSubmitting ? 'Guardando...' : 'Registrar'}</button>
          </footer>
        </form>
      </div>
    );
  };

  return (
    <section className="personnel-section">
      <header className="clients-header">
        <div>
          <h2>Personal</h2>
          <p>Gestiona trabajadores, asistencia, permisos, faltas y reportes del biometrico.</p>
        </div>
        <div className="clients-actions">
          <button type="button" className="ghost-button" onClick={() => fileInputRef.current?.click()}>Importar ZKTeco</button>
          <button type="button" className="primary-button" onClick={openCreateEmployee}>+ Nuevo Personal</button>
        </div>
      </header>

      <input ref={fileInputRef} type="file" accept=".csv,.txt,.tsv" hidden onChange={handleImportFile} />

      <div className="clients-kpi-grid personnel-kpi-grid">
        {cards.map((card) => (
          <article key={card.label} className={`clients-kpi-card ${card.tone}`}>
            <span className={`clients-kpi-icon ${card.tone}`}><PersonnelIcon kind={card.icon} /></span>
            <strong>{card.value}</strong>
            <p>{card.label}</p>
          </article>
        ))}
      </div>

      <article className="personnel-main-card">
        <header className="personnel-toolbar">
          <div className="personnel-view-tabs" role="tablist" aria-label="Vistas de personal">
            <button type="button" className={activeView === 'employees' ? 'active' : ''} onClick={() => setActiveView('employees')}>
              <span><PersonnelIcon kind="user" /></span>
              Personal
              <small>{employees.length}</small>
            </button>
            <button type="button" className={activeView === 'attendance' ? 'active' : ''} onClick={() => setActiveView('attendance')}>
              <span><PersonnelIcon kind="clock" /></span>
              Asistencia
              <small>{attendance.length}</small>
            </button>
            <button type="button" className={activeView === 'incidents' ? 'active' : ''} onClick={() => setActiveView('incidents')}>
              <span><PersonnelIcon kind="file" /></span>
              Permisos y faltas
              <small>{incidents.length}</small>
            </button>
          </div>
          <label className="clients-search personnel-search">
            <span aria-hidden="true" className="clients-search-glyph"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" /><path d="m15.5 15.5 4 4" /></svg></span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar personal por nombre, CI, codigo, cargo..." />
          </label>
        </header>

        {importFeedback ? <p className="status">{importFeedback}</p> : null}

        {importPreview.length > 0 ? (
          <div className="personnel-import-preview">
            <div>
              <strong>{importPreview.length} marcaciones listas</strong>
            <span>Se compararan con el codigo ZKTeco o el nombre del personal.</span>
            </div>
            <button type="button" className="primary-button" onClick={handleConfirmImport} disabled={isSubmitting}>
              {isSubmitting ? 'Importando...' : 'Confirmar importacion'}
            </button>
          </div>
        ) : null}

        {activeView === 'employees' ? (
          <div className="clients-table-wrap">
            <table className="clients-table personnel-table">
              <thead><tr><th>Trabajador</th><th>Departamento</th><th>Horario</th><th>Contacto</th><th>Sueldo</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {filteredEmployees.map((employee, index) => (
                  <tr key={employee.id}>
                    <td><div className="clients-cell-main"><span className={`personnel-avatar ${index % 2 ? 'green' : 'violet'}`}>{employee.photoUrl ? <img src={employee.photoUrl} alt={`Foto de ${employee.fullName}`} /> : <PersonnelIcon kind="user" />}</span><div><strong>{employee.fullName}</strong><span>{employee.employeeCode} | Bio {employee.biometricCode || '-'}</span></div></div></td>
                    <td><div className="clients-cell-stack"><strong>{employee.department}</strong><span>{employee.position || 'Sin cargo'}</span></div></td>
                    <td><div className="clients-cell-stack"><strong>{employee.schedule?.start} - {employee.schedule?.end}</strong><span>{employee.schedule?.dailyHours ?? 8} h/dia | {formatWorkingDays(employee.schedule?.workingDays)}</span></div></td>
                    <td><div className="clients-cell-stack"><strong>{employee.whatsapp || '-'}</strong><span>{employee.documentId || 'Sin CI'}</span></div></td>
                    <td>{formatBs(Number(employee.salaryBs ?? 0))}</td>
                    <td><span className={`personnel-status ${employee.status}`}>{labelFrom(EMPLOYEE_STATUS_LABELS, employee.status)}</span></td>
                    <td><div className="personnel-row-actions"><button type="button" className="ghost-button tiny" onClick={() => openEditEmployee(employee)}>Editar</button><button type="button" className="ghost-button tiny" onClick={() => openIncidentModal(employee)}>Permiso</button><button type="button" className="link-button danger" onClick={() => { if (window.confirm(`Dar de baja a ${employee.fullName}?`)) onRemoveEmployee?.({ id: employee.id }); }}>Baja</button></div></td>
                  </tr>
                ))}
                {filteredEmployees.length === 0 ? <tr><td colSpan="7">No hay personal con esos filtros.</td></tr> : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {activeView === 'attendance' ? (
          <div className="clients-table-wrap">
            <table className="clients-table personnel-table">
              <thead><tr><th>Fecha</th><th>Trabajador</th><th>Entrada</th><th>Salida</th><th>Trabajadas</th><th>Extras</th><th>Faltantes</th><th>Estado</th></tr></thead>
              <tbody>
                {attendance.slice(0, 80).map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.date)}</td>
                    <td><div className="clients-cell-stack"><strong>{entry.employeeName || 'Sin coincidencia'}</strong><span>{entry.employeeCode || '-'}</span></div></td>
                    <td>{entry.checkIn || '-'}</td>
                    <td>{entry.checkOut || '-'}</td>
                    <td>{Number(entry.workedHours ?? 0).toFixed(2)} h</td>
                    <td>{Number(entry.overtimeHours ?? 0).toFixed(2)} h</td>
                    <td>{Number(entry.missingHours ?? 0).toFixed(2)} h</td>
                    <td><span className={`personnel-status ${entry.status}`}>{labelFrom(ATTENDANCE_STATUS_LABELS, entry.status)}</span></td>
                  </tr>
                ))}
                {attendance.length === 0 ? <tr><td colSpan="8">Aun no hay asistencia importada. Exporta CSV o texto desde ZKTeco e importalo aqui.</td></tr> : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {activeView === 'incidents' ? (
          <div className="clients-table-wrap">
            <div className="personnel-inline-actions"><button type="button" className="primary-button" onClick={() => openIncidentModal()}>+ Registrar permiso/falta</button></div>
            <table className="clients-table personnel-table">
              <thead><tr><th>Trabajador</th><th>Tipo</th><th>Periodo</th><th>Horas</th><th>Motivo</th><th>Estado</th></tr></thead>
              <tbody>
                {incidents.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.employeeName}</td>
                    <td>{labelFrom(INCIDENT_TYPE_LABELS, entry.type)}</td>
                    <td>{formatDate(entry.dateFrom)} - {formatDate(entry.dateTo)}</td>
                    <td>{Number(entry.hours ?? 0).toFixed(1)} h</td>
                    <td>{entry.reason || entry.notes || '-'}</td>
                    <td><span className={`personnel-status ${entry.status}`}>{labelFrom(INCIDENT_STATUS_LABELS, entry.status)}</span></td>
                  </tr>
                ))}
                {incidents.length === 0 ? <tr><td colSpan="6">Sin permisos, faltas ni licencias registradas.</td></tr> : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      {renderEmployeeModal()}
      {renderIncidentModal()}
    </section>
  );
}

export default PersonnelSection;
