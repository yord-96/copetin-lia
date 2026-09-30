import { ATTENDANCE_TIME_ZONE, buildAttendanceWorkAnalysis, attendanceDurationValue, getAttendanceDateKey, getAttendancePersonKey, getAttendanceRecordMs, formatAttendanceDate, formatAttendanceTime } from './attendanceAnalysis.js';

const stamp = (record) => record?.capturedAt ?? record?.createdAt;
const excelDate = (record) => {
  const value = stamp(record);
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  return new Date(`${getAttendanceDateKey(value)}T${formatAttendanceTime(value)}Z`);
};
const hasGps = (record) => [record.latitude, record.longitude].every((value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) && Math.abs(Number(record.latitude)) <= 90 && Math.abs(Number(record.longitude)) <= 180;
const sumMinutes = (journey) => journey.intervals.reduce((sum, interval) => sum + interval.minutes, 0);
const statusOf = (journey) => journey.openEntries.length
  ? (journey.anomalies.length ? 'EN CURSO · CON INCIDENCIAS' : 'EN CURSO · PENDIENTE DE SALIDA')
  : journey.anomalies.length ? (journey.intervals.length ? 'PARCIAL · REVISAR INCIDENCIAS' : 'REVISAR MARCACIÓN')
    : journey.intervals.some((interval) => interval.crossesMidnight) ? 'CALCULADA · TURNO NOCTURNO' : 'CALCULADA';

export async function createAttendanceWorkbook({ records, calculationRecords = records, filters = {}, maxIntervalHours = 18, now = new Date() }) {
  const module = await import('exceljs');
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'El Copetín';
  workbook.title = 'Control de asistencia y revisión de jornadas';
  workbook.created = new Date(now);
  const analysis = buildAttendanceWorkAnalysis(calculationRecords, { maxIntervalHours, now });
  const visiblePeople = new Set(records.map(getAttendancePersonKey));
  const inRange = (item) => (!item.dateKey || ((!filters.dateFrom || item.dateKey >= filters.dateFrom) && (!filters.dateTo || item.dateKey <= filters.dateTo))) && (!filters.query?.trim() || visiblePeople.has(item.personKey));
  const journeys = analysis.journeys.filter(inRange).sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.userName.localeCompare(b.userName, 'es'));
  const anomalies = analysis.anomalies.filter(inRange).sort((a, b) => a.timestampMs - b.timestampMs);
  const pending = analysis.openEntries.filter(inRange);
  const intervals = journeys.flatMap((journey) => journey.intervals);
  const workedMinutes = intervals.reduce((sum, interval) => sum + interval.minutes, 0);

  const table = (name, columns, entries) => {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
      pageSetup: { orientation: columns.length > 5 ? 'landscape' : 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' },
    });
    sheet.columns = columns.map(([header, key, width]) => ({ header, key, width }));
    const header = sheet.getRow(1);
    header.height = 42;
    header.eachCell((cell) => {
      cell.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173A6B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    entries.forEach((entry, index) => {
      const row = sheet.addRow(entry);
      row.height = Math.max(30, ...columns.map(([, key, width]) => Math.min(100, Math.ceil(String(entry[key] ?? '').length / Math.max(10, width - 2)) * 14 + 8)));
      columns.forEach(([, key, , format]) => {
        const cell = row.getCell(key);
        cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF173A6B' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? 'FFF3F6FA' : 'FFFFFFFF' } };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFD7DFEA' } } };
        cell.alignment = { vertical: 'middle', wrapText: true, horizontal: typeof entry[key] === 'number' ? 'right' : 'left' };
        if (format) cell.numFmt = format;
        if (key === 'status' || key === 'issue' || key === 'type') {
          const label = String(entry[key] ?? '');
          const color = /REVISAR|INCIDENCIAS/.test(label) || key === 'issue' ? 'FFB91C1C' : /EN CURSO/.test(label) ? 'FFB45309' : label === 'Salida' ? 'FFB91C1C' : 'FF15803D';
          cell.font = { name: 'Calibri', bold: true, size: 11, color: { argb: color } };
        }
      });
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, entries.length + 1), column: columns.length } };
    sheet.headerFooter.oddFooter = `&LEl Copetín · ${filters.dateFrom || 'Inicio'} a ${filters.dateTo || 'Actualidad'}&RPágina &P de &N`;
    return sheet;
  };
  const dateFormat = 'dd/mm/yyyy hh:mm:ss';
  const durationFormat = '[h]:mm';
  const summaryEntries = [
    { label: 'EL COPETÍN · CONTROL DE ASISTENCIA', value: 'Horas calculadas, jornadas abiertas e incidencias' },
    { label: 'Período', value: `${filters.dateFrom || 'Inicio'} — ${filters.dateTo || 'Actualidad'}` },
    { label: 'Generado / zona horaria', value: `${formatAttendanceDate(now)} ${formatAttendanceTime(now)} · ${ATTENDANCE_TIME_ZONE}` },
    { label: 'Filtro de marcas', value: `${filters.type === 'entrada' ? 'Entradas' : filters.type === 'salida' ? 'Salidas' : 'Todas'} · ${filters.query || 'Sin búsqueda'}` },
    { label: 'Marcas en el detalle', value: records.length },
    { label: 'Entradas / salidas en el detalle', value: `${records.filter((row) => row.type === 'entrada').length} / ${records.filter((row) => row.type === 'salida').length}` },
    { label: 'Personas con marcas en el detalle', value: visiblePeople.size },
    { label: 'Marcas con evidencia fotográfica', value: records.filter((row) => row.photoUrl || row.photoDataUrl).length },
    { label: 'Marcas con coordenadas GPS válidas', value: records.filter(hasGps).length },
    { label: 'Horas calculadas de intervalos válidos', value: attendanceDurationValue(workedMinutes), duration: true },
    { label: 'Intervalos válidos', value: intervals.length },
    { label: 'Jornadas analizadas', value: journeys.length },
    { label: 'Jornadas en curso / pendientes de salida', value: pending.length },
    { label: 'Jornadas con incidencias', value: journeys.filter((journey) => journey.anomalies.length).length },
    { label: 'Marcas con incidencias', value: anomalies.length },
    { label: 'Límite por intervalo', value: `${maxIntervalHours} horas. Es un control de coherencia, no una jornada laboral ni un cálculo de horas extra.` },
    { label: 'Criterio de cálculo', value: 'Se suman únicamente pares Entrada → Salida con duración positiva dentro del límite. Los tramos de almuerzo sin presencia no se suman. Se permiten turnos que cruzan medianoche.' },
    { label: 'Jornadas en curso', value: 'Una entrada reciente sin salida queda pendiente mientras no supere el límite al momento de generar el reporte. No suma horas abiertas ni cuenta como incidencia por sí sola.' },
    { label: 'Marcas incoherentes', value: 'Duraciones excesivas, marcas duplicadas, futuras, fechas inválidas y secuencias incompletas quedan visibles para revisión. No se inventan horas ni se modifican las marcas originales.' },
    { label: 'Alcance de los filtros', value: 'Detalle de marcas respeta fecha, tipo y búsqueda. El cálculo usa entradas y salidas de las personas seleccionadas, con contexto de fechas cercanas; una jornada nocturna se atribuye a su fecha de entrada. El filtro de tipo no elimina la pareja necesaria para calcular.' },
    { label: 'Trazabilidad', value: 'Intervalos muestra cada pareja y su duración. Marcas cortas o con notas de prueba no se eliminan automáticamente; las horas calculadas no equivalen a una aprobación de asistencia.' },
  ];
  const summary = table('Resumen', [['Indicador', 'label', 48], ['Valor / criterio', 'value', 100]], summaryEntries);
  summaryEntries.forEach((entry, index) => { if (entry.duration) summary.getRow(index + 2).getCell('value').numFmt = durationFormat; });

  table('Detalle de marcas', [['Código', 'code', 16], ['Fecha y hora', 'date', 24, dateFormat], ['Usuario', 'userName', 30], ['Cargo / rol', 'role', 23], ['Tipo', 'type', 14], ['Ubicación', 'location', 44], ['Motivo', 'reason', 42], ['Modo de marcación', 'mode', 24], ['Responsable', 'responsible', 28], ['Grupo', 'group', 28], ['Tama?o del grupo', 'groupSize', 18], ['Participante manual', 'manual', 19], ['Latitud', 'latitude', 15], ['Longitud', 'longitude', 15], ['Evidencia', 'evidence', 42], ['Formato foto', 'photoMimeType', 18], ['Tama?o foto (KB)', 'photoSizeKb', 19], ['Notas', 'notes', 42]], records.map((row) => ({
    code: String(row.code || ''), date: excelDate(row), userName: row.userName, role: row.role, type: row.type === 'entrada' ? 'Entrada' : row.type === 'salida' ? 'Salida' : String(row.type || 'Desconocido'), location: row.location, reason: row.reason || row.notes, mode: row.markingMode === 'responsable' ? 'Responsable / grupal' : 'Personal', responsible: row.responsibleName, group: row.attendanceGroupId, groupSize: row.attendanceGroupSize || 1, photoMimeType: row.photoMimeType, photoSizeKb: row.photoSizeBytes ? Math.round(Number(row.photoSizeBytes) / 1024 * 10) / 10 : null, notes: row.notes, manual: row.isManualParticipant ? 'Sí' : 'No', latitude: row.latitude, longitude: row.longitude, evidence: row.photoUrl || (row.photoDataUrl ? 'Evidencia almacenada en el sistema' : 'Sin evidencia'),
  })));
  table('Jornada por persona', [['Fecha jornada', 'date', 16], ['Usuario', 'userName', 30], ['Cargo / rol', 'role', 23], ['Primera entrada registrada', 'first', 25, dateFormat], ['Última salida registrada', 'last', 25, dateFormat], ['Horas calculadas', 'worked', 20, durationFormat], ['Intervalos válidos', 'intervals', 18], ['Entradas', 'entries', 12], ['Salidas', 'exits', 12], ['Total marcas', 'marks', 15], ['Cruza medianoche', 'night', 19], ['Incidencias', 'issues', 14], ['Estado', 'status', 34]], journeys.map((journey) => {
    const marks = journey.records.slice().sort((a, b) => getAttendanceRecordMs(a) - getAttendanceRecordMs(b));
    return { date: journey.dateKey || 'Fecha inválida', userName: journey.userName, role: journey.role, first: excelDate(marks.find((row) => row.type === 'entrada')), last: excelDate(marks.filter((row) => row.type === 'salida').at(-1)), worked: journey.intervals.length ? attendanceDurationValue(sumMinutes(journey)) : null, intervals: journey.intervals.length, entries: journey.entryCount, exits: journey.exitCount, marks: journey.markKeys.size, night: journey.intervals.some((interval) => interval.crossesMidnight) ? 'Sí' : 'No', issues: journey.anomalies.length, status: statusOf(journey) };
  }));

  const people = new Map();
  journeys.forEach((journey) => {
    const person = people.get(journey.personKey) || { userName: journey.userName, role: journey.role, journeys: 0, calculated: 0, minutes: 0, entries: 0, exits: 0, marks: 0, issueDays: 0, issues: 0, pending: 0 };
    person.journeys++;
    person.calculated += journey.intervals.length > 0 ? 1 : 0;
    person.minutes += sumMinutes(journey);
    person.entries += journey.entryCount;
    person.exits += journey.exitCount;
    person.marks += journey.markKeys.size;
    person.issueDays += journey.anomalies.length > 0 ? 1 : 0;
    person.issues += journey.anomalies.length;
    person.pending += journey.openEntries.length;
    people.set(journey.personKey, person);
  });
  const personSheet = table('Resumen por persona', [['Usuario', 'userName', 30], ['Cargo / rol', 'role', 23], ['Jornadas con marcas', 'journeys', 19], ['Jornadas con horas calculadas', 'calculated', 25], ['Horas calculadas', 'worked', 20, durationFormat], ['Entradas', 'entries', 12], ['Salidas', 'exits', 12], ['Total marcas', 'marks', 15], ['Jornadas con incidencia', 'issueDays', 24], ['Marcas con incidencia', 'issues', 22], ['Jornadas en curso', 'pending', 20], ['Observación', 'observation', 52]], [...people.values()].sort((a, b) => a.userName.localeCompare(b.userName, 'es')).map((person) => ({ ...person, worked: person.calculated ? attendanceDurationValue(person.minutes) : null, observation: `${person.pending ? `${person.pending} jornada(s) pendiente(s) de salida. ` : ''}${person.issues ? 'Revisar la hoja Incidencias; el total incluye solo intervalos válidos.' : person.calculated ? 'Intervalos calculados sin incidencias de secuencia.' : 'Sin intervalos completos para calcular.'}` })));
  const total = personSheet.addRow({ userName: 'TOTAL HORAS CALCULADAS', worked: attendanceDurationValue(workedMinutes) });
  total.getCell('worked').numFmt = durationFormat;
  total.font = { name: 'Calibri', bold: true, color: { argb: 'FF173A6B' } };
  total.height = 30;

  table('Intervalos', [['Jornada', 'date', 16], ['Usuario', 'userName', 30], ['Código entrada', 'entry', 18], ['Fecha y hora entrada', 'start', 25, dateFormat], ['Código salida', 'exit', 18], ['Fecha y hora salida', 'end', 25, dateFormat], ['Duración', 'worked', 18, durationFormat], ['Observación', 'note', 50]], intervals.map((interval) => ({ date: interval.dateKey, userName: interval.userName, entry: interval.entryRecord.code, start: excelDate(interval.entryRecord), exit: interval.exitRecord.code, end: excelDate(interval.exitRecord), worked: attendanceDurationValue(interval.minutes), note: interval.minutes < 5 ? 'Intervalo menor a 5 minutos: comprobar si fue una prueba. Se conserva en el cálculo.' : interval.crossesMidnight ? 'Turno nocturno dentro del límite.' : 'Intervalo dentro del límite.' })));
  table('En curso', [['Usuario', 'userName', 30], ['Código entrada', 'code', 18], ['Entrada registrada', 'date', 25, dateFormat], ['Estado', 'status', 35], ['Tratamiento', 'treatment', 70]], pending.map((item) => ({ userName: item.userName, code: item.record.code, date: excelDate(item.record), status: 'EN CURSO · PENDIENTE DE SALIDA', treatment: 'No suma horas del tramo abierto. Los tramos cerrados anteriores sí se mantienen. No es una incidencia mientras no supere el límite.' })));
  table('Incidencias', [['Fecha y hora', 'date', 25, dateFormat], ['Usuario', 'userName', 30], ['Código', 'code', 17], ['Tipo', 'type', 14], ['Incidencia detectada', 'issue', 38], ['Tratamiento en cálculo', 'treatment', 80], ['Ubicación', 'location', 42], ['Motivo / nota', 'note', 44]], anomalies.map((item) => ({ date: excelDate(item.record), userName: item.userName, code: item.record.code, type: item.record.type === 'entrada' ? 'Entrada' : item.record.type === 'salida' ? 'Salida' : String(item.record.type || 'Desconocido'), issue: item.issue, treatment: item.treatment, location: item.record.location, note: item.record.reason || item.record.notes })));
  return workbook;
}
