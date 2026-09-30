import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttendanceWorkAnalysis, loadAttendanceReportRecords, getAttendanceDateKey } from './attendanceAnalysis.js';
import { createAttendanceWorkbook } from './attendanceWorkbook.js';

const mark = (code, type, date, userId = '1') => ({ id: code, code, userId, userName: 'Persona de prueba', role: 'Ventas', type, capturedAt: `${date}-04:00` });
const analyze = (rows, options = {}) => buildAttendanceWorkAnalysis(rows, { now: '2026-09-29T16:30:00-04:00', ...options });
const minutes = (result) => result.journeys.flatMap((journey) => journey.intervals).reduce((sum, interval) => sum + interval.minutes, 0);

test('regresión: no computa 175:53 horas entre el 3 y el 10 de septiembre', () => {
  const result = analyze([mark('E', 'entrada', '2026-09-03T09:22:16'), mark('S', 'salida', '2026-09-10T17:15:02')]);
  assert.equal(minutes(result), 0);
  assert.equal(result.anomalies.length, 2);
  assert.ok(result.anomalies.every((issue) => issue.code === 'invalid_interval'));
  assert.equal(result.journeys.reduce((sum, journey) => sum + journey.markKeys.size, 0), 2);
});

test('turnos nocturnos válidos se atribuyen a la entrada y descuentan pausas', () => {
  const result = analyze([
    mark('1', 'entrada', '2026-09-23T09:00:00'), mark('2', 'salida', '2026-09-23T13:00:00'),
    mark('3', 'entrada', '2026-09-23T21:00:00'), mark('4', 'salida', '2026-09-24T02:00:00'),
  ]);
  assert.equal(minutes(result), 540);
  assert.equal(result.journeys.length, 1);
  assert.equal(result.journeys[0].dateKey, '2026-09-23');
  assert.equal(result.journeys[0].intervals[1].crossesMidnight, true);
  assert.equal(result.anomalies.length, 0);
});

test('entrada de hoy queda abierta; solo se suman tramos cerrados', () => {
  const result = analyze([mark('1', 'entrada', '2026-09-29T08:00:00'), mark('2', 'salida', '2026-09-29T13:00:00'), mark('3', 'entrada', '2026-09-29T14:58:00')]);
  assert.equal(minutes(result), 300);
  assert.equal(result.openEntries.length, 1);
  assert.equal(result.anomalies.length, 0);
  assert.equal(result.journeys[0].entryCount, 2);
  assert.equal(result.journeys[0].markKeys.size, 3);
});

test('entrada vencida es incidencia; límite configurable no se convierte en horas trabajadas', () => {
  const rows = [mark('1', 'entrada', '2026-09-28T19:00:00')];
  assert.equal(analyze(rows).anomalies[0].code, 'missing_exit');
  assert.equal(analyze(rows, { maxIntervalHours: 24 }).openEntries.length, 1);
  assert.equal(minutes(analyze(rows, { maxIntervalHours: 24 })), 0);
  assert.throws(() => analyze(rows, { maxIntervalHours: 100 }), /entre 1 y 24/);
});

test('duplicados no añaden tiempo y ninguna marca desaparece del recuento', () => {
  const result = analyze([mark('1', 'entrada', '2026-09-29T08:00:00'), mark('2', 'entrada', '2026-09-29T08:01:00'), mark('3', 'salida', '2026-09-29T12:00:00'), mark('4', 'salida', '2026-09-29T12:01:00')]);
  assert.equal(minutes(result), 240);
  assert.deepEqual(result.anomalies.map((item) => item.code), ['duplicate_entry', 'duplicate_exit']);
  assert.equal(result.journeys[0].markKeys.size, 4);
});

test('nueva entrada tras falta de salida no inventa horas; identidades distintas no se mezclan', () => {
  const result = analyze([mark('1', 'entrada', '2026-09-28T08:00:00'), mark('2', 'entrada', '2026-09-29T08:00:00'), mark('3', 'salida', '2026-09-29T12:00:00'), mark('4', 'salida', '2026-09-29T13:00:00', '2')]);
  assert.equal(minutes(result), 240);
  assert.deepEqual(result.anomalies.map((item) => item.code), ['missing_exit', 'missing_entry']);
});

test('marcas futuras, simultáneas o con fecha inválida quedan para revisión', () => {
  const result = analyze([mark('1', 'entrada', '2026-09-29T08:00:00'), mark('2', 'salida', '2026-09-29T08:00:00'), mark('3', 'entrada', '2026-09-30T08:00:00'), { id: '4', type: 'entrada', userId: '1', capturedAt: 'inválida' }]);
  assert.equal(minutes(result), 0);
  assert.equal(result.anomalies.length, 4);
  assert.equal(getAttendanceDateKey('2026-09-30T02:00:00Z'), '2026-09-29');
});

test('carga completa: divide rangos saturados y rechaza un día truncado', async () => {
  const calls = [];
  const rows = await loadAttendanceReportRecords(async (filters) => {
    calls.push(filters);
    if (filters.dateFrom !== filters.dateTo) return Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    return [{ id: filters.dateFrom }];
  }, { dateFrom: '2026-09-28', dateTo: '2026-09-29' });
  assert.equal(rows.length, 2);
  assert.equal(calls.length, 3);
  await assert.rejects(() => loadAttendanceReportRecords(async () => Array(1000).fill({}), { dateFrom: '2026-09-29', dateTo: '2026-09-29' }), /límite de marcas/);
});

test('Excel: horas numéricas, encabezados visibles, marcas incompletas y turnos al borde del período', async () => {
  const records = [mark('1', 'entrada', '2026-09-29T08:00:00'), mark('2', 'salida', '2026-09-29T13:00:00'), mark('3', 'entrada', '2026-09-29T14:58:00'), mark('4', 'entrada', '2026-09-29T15:00:00', '2')];
  const workbook = await createAttendanceWorkbook({ records, now: new Date('2026-09-29T16:30:00-04:00'), filters: { dateFrom: '2026-09-29', dateTo: '2026-09-29' } });
  assert.equal(workbook.getWorksheet('Resumen por persona').getCell('E2').value, 5 / 24);
  await workbook.xlsx.load(await workbook.xlsx.writeBuffer());
  const person = workbook.getWorksheet('Resumen por persona');
  assert.equal(person.getCell('E1').value, 'Horas calculadas');
  assert.equal(person.getCell('E1').font.color.argb, 'FFFFFFFF');
  assert.equal(person.getCell('E2').numFmt, '[h]:mm');
  // ExcelJS interprets numeric duration cells as dates on read; the XLSX value is numeric.
  assert.equal(person.getCell('E2').value.getTime(), Date.UTC(1899, 11, 30, 5));
  assert.equal(person.getCell('E3').value, null);
  assert.equal(workbook.getWorksheet('En curso').rowCount, 3);
  assert.equal(workbook.getWorksheet('Incidencias').rowCount, 1);
  const journeys = workbook.getWorksheet('Jornada por persona');
  assert.ok(journeys.getCell('D3').value instanceof Date);
  assert.equal(journeys.getCell('D3').value.getUTCHours(), 15);
  assert.equal(journeys.getCell('F3').value, null);
  const boundary = await createAttendanceWorkbook({ records: [mark('e', 'entrada', '2026-09-28T22:00:00')], calculationRecords: [mark('e', 'entrada', '2026-09-28T22:00:00'), mark('s', 'salida', '2026-09-29T06:00:00')], now: new Date('2026-09-29T10:00:00-04:00'), filters: { dateFrom: '2026-09-28', dateTo: '2026-09-28', type: 'entrada' } });
  assert.equal(boundary.getWorksheet('Jornada por persona').getCell('F2').value, 8 / 24);
});
