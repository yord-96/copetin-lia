export const ATTENDANCE_TIME_ZONE = 'America/La_Paz';
export const ATTENDANCE_DUPLICATE_WINDOW_MINUTES = 3;

export const getAttendanceDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== 'literal') accumulator[part.type] = part.value;
    return accumulator;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const formatAttendanceDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-BO', {
    timeZone: ATTENDANCE_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

export const formatAttendanceTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-BO', {
    timeZone: ATTENDANCE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
};

export const formatAttendanceSpan = (minutes) => {
  const totalMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(totalMinutes / 60);
  const remainder = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

export const shiftAttendanceDateKey = (dateKey, days) => {
  const match = String(dateKey ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey || '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
};

export const getAttendanceRecordMs = (record) => {
  const value = new Date(record?.capturedAt ?? record?.createdAt ?? '').getTime();
  return Number.isFinite(value) ? value : NaN;
};

export const getAttendancePersonKey = (record) =>
  record?.userId ? `id:${record.userId}` : `manual:${String(record?.userName || 'usuario').trim().toLocaleLowerCase('es')}`;

export const getAttendanceRecordKey = (record, index = 0) =>
  String(record?.id || record?.code || `${getAttendancePersonKey(record)}-${record?.type || 'marca'}-${getAttendanceRecordMs(record)}-${index}`);

export const DEFAULT_MAX_INTERVAL_HOURS = 18;
export const attendanceDurationValue = (minutes) => Number(minutes) / 1440;

export function buildAttendanceWorkAnalysis(records, { now = new Date(), maxIntervalHours = DEFAULT_MAX_INTERVAL_HOURS } = {}) {
  if (!Number.isFinite(Number(maxIntervalHours)) || maxIntervalHours < 1 || maxIntervalHours > 24) throw new Error('El límite de intervalo debe estar entre 1 y 24 horas.');
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error('Fecha de análisis inválida.');
  const limitMs = Number(maxIntervalHours) * 3600000;
  const byPerson = new Map();
  const journeys = [];
  const anomalies = [];
  const openEntries = [];
  (Array.isArray(records) ? records : []).forEach((record, index) => {
    const personKey = getAttendancePersonKey(record);
    if (!byPerson.has(personKey)) byPerson.set(personKey, []);
    byPerson.get(personKey).push({ record, timestampMs: getAttendanceRecordMs(record), recordKey: getAttendanceRecordKey(record, index), index });
  });
  byPerson.forEach((personRows, personKey) => {
    const ordered = personRows.slice().sort((a, b) => (a.timestampMs - b.timestampMs) || a.index - b.index);
    const userName = ordered[0]?.record.userName || 'Usuario';
    const role = ordered[0]?.record.role || '';
    const journeyMap = new Map();
    const ensure = (dateKey) => {
      if (!journeyMap.has(dateKey)) journeyMap.set(dateKey, { personKey, userName, role, dateKey, intervals: [], anomalies: [], openEntries: [], records: [], markKeys: new Set(), entryCount: 0, exitCount: 0 });
      return journeyMap.get(dateKey);
    };
    const dateOf = (row) => Number.isFinite(row.timestampMs) ? getAttendanceDateKey(row.timestampMs) : '';
    const assign = (row, dateKey = dateOf(row)) => {
      const journey = ensure(dateKey);
      if (!journey.markKeys.has(row.recordKey)) {
        journey.markKeys.add(row.recordKey);
        journey.records.push(row.record);
        if (row.record.type === 'entrada') journey.entryCount++;
        if (row.record.type === 'salida') journey.exitCount++;
      }
      return journey;
    };
    const issue = (row, code, label, treatment, dateKey = dateOf(row)) => {
      const item = { personKey, userName, role, timestampMs: row.timestampMs, record: row.record, dateKey, code, issue: label, treatment };
      anomalies.push(item);
      assign(row, dateKey).anomalies.push(item);
    };
    let pending = null;
    let lastExit = null;
    ordered.forEach((row) => {
      if (!Number.isFinite(row.timestampMs)) {
        issue(row, 'invalid_date', 'Fecha inválida', 'No suma tiempo. Corregir la fecha conservando la marca original.');
        return;
      }
      if (row.timestampMs > nowMs) {
        issue(row, 'future_mark', 'Marca con fecha futura', 'No suma tiempo. Revisar la fecha y hora del dispositivo.');
        return;
      }
      if (row.record.type === 'entrada') {
        if (pending) {
          const elapsed = row.timestampMs - pending.timestampMs;
          if (elapsed <= ATTENDANCE_DUPLICATE_WINDOW_MINUTES * 60000) {
            issue(row, 'duplicate_entry', 'Posible entrada duplicada', 'No suma tiempo adicional. Se conserva la primera entrada.', dateOf(pending));
            return;
          }
          issue(pending, 'missing_exit', 'Entrada sin salida antes de una nueva entrada', 'No se inventa una salida. Se excluye el tramo incompleto y se continúa desde la nueva entrada.');
        }
        pending = row;
        lastExit = null;
        return;
      }
      if (row.record.type !== 'salida') {
        issue(row, 'invalid_type', 'Tipo de marca desconocido', 'No suma tiempo. Revisar el tipo de marcación.');
        return;
      }
      if (!pending) {
        const duplicate = lastExit && row.timestampMs - lastExit.timestampMs <= ATTENDANCE_DUPLICATE_WINDOW_MINUTES * 60000;
        issue(row, duplicate ? 'duplicate_exit' : 'missing_entry', duplicate ? 'Posible salida duplicada' : 'Salida sin entrada pendiente', 'No suma tiempo. Se conserva la marca para revisión.', duplicate ? lastExit.journeyDate : dateOf(row));
        return;
      }
      const elapsed = row.timestampMs - pending.timestampMs;
      if (elapsed > limitMs || elapsed <= 0) {
        const label = elapsed > limitMs ? 'Duración excesiva: revisar' : 'Entrada y salida simultáneas: revisar';
        const treatment = `Tramo ${pending.record.code || 'entrada'} → ${row.record.code || 'salida'}: ${formatAttendanceSpan(elapsed / 60000)} h. Límite ${maxIntervalHours} h. Ambas marcas se conservan, sin sumar este intervalo.`;
        issue(pending, 'invalid_interval', label, treatment);
        issue(row, 'invalid_interval', label, treatment);
        pending = null;
        lastExit = null;
        return;
      }
      const dateKey = dateOf(pending);
      const journey = assign(pending, dateKey);
      assign(row, dateKey);
      journey.intervals.push({ personKey, userName, role, dateKey, startMs: pending.timestampMs, endMs: row.timestampMs, minutes: elapsed / 60000, entryRecord: pending.record, exitRecord: row.record, entryKey: pending.recordKey, exitKey: row.recordKey, crossesMidnight: dateKey !== dateOf(row) });
      lastExit = { ...row, journeyDate: dateKey };
      pending = null;
    });
    if (pending) {
      if (nowMs - pending.timestampMs <= limitMs) {
        const item = { personKey, userName, role, record: pending.record, dateKey: dateOf(pending), timestampMs: pending.timestampMs };
        openEntries.push(item);
        assign(pending).openEntries.push(item);
      } else {
        issue(pending, 'missing_exit', 'Entrada sin salida: plazo superado', `Superó el límite de ${maxIntervalHours} h. No se inventa una salida ni se suman horas.`);
      }
    }
    journeyMap.forEach((journey) => journeys.push(journey));
  });
  return { journeys, anomalies, openEntries, maxIntervalHours, analyzedAt: new Date(nowMs) };
}

// The API caps responses at 1,000. Split saturated date ranges instead of silently truncating.
export async function loadAttendanceReportRecords(listRecords, filters) {
  const rows = await listRecords({ ...filters, limit: 1000 });
  if (!Array.isArray(rows)) throw new Error('Respuesta de asistencia inválida.');
  if (rows.length < 1000) return rows;
  const { dateFrom, dateTo } = filters;
  if (!dateFrom || !dateTo || dateFrom >= dateTo) throw new Error('El reporte alcanza el límite de marcas. Selecciona un período menor o filtra por persona para exportarlo completo.');
  const fromMs = Date.parse(`${dateFrom}T00:00:00Z`);
  const toMs = Date.parse(`${dateTo}T00:00:00Z`);
  const middle = new Date(fromMs + Math.floor((toMs - fromMs) / 86400000 / 2) * 86400000).toISOString().slice(0, 10);
  const left = await loadAttendanceReportRecords(listRecords, { ...filters, dateTo: middle });
  const right = await loadAttendanceReportRecords(listRecords, { ...filters, dateFrom: shiftAttendanceDateKey(middle, 1) });
  const unique = new Map();
  [...left, ...right].forEach((record, index) => unique.set(getAttendanceRecordKey(record, index), record));
  return [...unique.values()];
}
