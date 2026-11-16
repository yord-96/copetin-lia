import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/api';
import { buildAttendanceReportAnalysis, filterAttendanceReportRecords, loadAttendanceReportRecords, shiftAttendanceDateKey, formatAttendanceSpan, formatAttendanceTime, formatAttendanceDate } from '../../utils/attendanceAnalysis.js';
import './AttendanceHoursModal.css';
const dateLabel = value => value ? formatAttendanceDate(String(value).includes('T') ? value : value + 'T12:00:00Z') : String.fromCharCode(8212);

export default function AttendanceHoursModal({ filters, maxIntervalHours, onClose, onCreate }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, []);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState('people');
  const [page, setPage] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    (async () => {
      try {
        if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) throw new Error('La fecha inicial no puede ser posterior a la final.');
        const [records, calculationRecords] = await Promise.all([
          loadAttendanceReportRecords(api.attendance.listRecords, filters),
          loadAttendanceReportRecords(api.attendance.listRecords, { dateFrom: filters.dateFrom ? shiftAttendanceDateKey(filters.dateFrom, -2) : '', dateTo: filters.dateTo ? shiftAttendanceDateKey(filters.dateTo, 2) : '', type: 'all', query: '' }),
        ]);
        const next = buildAttendanceReportAnalysis({ records: filterAttendanceReportRecords(records, filters), calculationRecords, filters, maxIntervalHours });
        if (active) setReport(next);
      } catch (failure) { if (active) setError(failure.message || 'No se pudo cargar el reporte. Puedes volver a intentar.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [filters, maxIntervalHours, revision]);
  const people = useMemo(() => {
    const grouped = new Map();
    for (const day of report?.journeys ?? []) {
      const row = grouped.get(day.personKey) ?? { id: day.personKey, name: day.userName, minutes: 0, days: 0, pending: 0, issues: 0, calculated: false };
      row.calculated ||= day.intervals.length > 0;
      row.days++; row.pending += day.openEntries.length; row.issues += day.anomalies.length;
      row.minutes += day.intervals.reduce((sum, interval) => sum + interval.minutes, 0);
      grouped.set(day.personKey, row);
    }
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [report]);
  const tabs = [['people', 'Por persona'], ['days', 'Jornadas'], ['intervals', 'Intervalos'], ['pending', 'En curso'], ['issues', 'Incidencias']];
  const viewRows = !report ? [] : tab === 'people' ? people : tab === 'days' ? report.journeys : tab === 'intervals' ? report.intervals : tab === 'pending' ? report.pending : report.anomalies;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(viewRows.length / 100) - 1));
  const visibleRows = viewRows.slice(currentPage * 100, (currentPage + 1) * 100);
  return <div className="attendance-hours-backdrop"><section ref={dialog} tabIndex={-1} className="attendance-hours-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-hours-title" onKeyDown={event => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Tab') {
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header><div><h3 id="attendance-hours-title">Horas de asistencia</h3><p>{filters.dateFrom || 'Inicio'} — {filters.dateTo || 'Hoy'}{filters.query ? ` · ${filters.query}` : ''}</p></div><button type="button" onClick={onClose} aria-label="Cerrar horas de asistencia">Cerrar</button></header>
    <div className="attendance-hours-actions"><button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Actualizar</button>{onCreate && <button type="button" onClick={onCreate}>Crear asistencia</button>}</div>
    <p>Usa los mismos cálculos y filtros del Excel. Solo suma intervalos válidos; las entradas abiertas no suman horas. Límite por intervalo: {maxIntervalHours} horas.</p>
    {loading ? <p role="status">Calculando horas…</p> : error ? <p role="alert">{error}</p> : report && <>
      <div className="attendance-hours-totals"><strong>Total: {formatAttendanceSpan(report.workedMinutes)} h</strong><span>{report.journeys.length} jornadas</span><span>{report.pending.length} entradas en curso</span><span>{report.anomalies.length} incidencias</span></div>
      <nav aria-label="Vistas de horas de asistencia">{tabs.map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setPage(0); }}>{label}</button>)}</nav>
      <div className="attendance-hours-table"><table>
        <thead><tr>{(tab === 'people' ? ['Persona', 'Horas calculadas', 'Jornadas', 'En curso', 'Incidencias'] : tab === 'days' ? ['Fecha', 'Persona', 'Horas calculadas', 'Entradas', 'Salidas', 'Estado'] : tab === 'intervals' ? ['Fecha de entrada', 'Persona', 'Entrada', 'Salida', 'Duración', 'Turno'] : tab === 'pending' ? ['Persona', 'Fecha', 'Entrada', 'Estado'] : ['Persona', 'Fecha y hora', 'Incidencia', 'Tratamiento']).map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{tab === 'people' ? visibleRows.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.calculated ? formatAttendanceSpan(row.minutes) : String.fromCharCode(8212)}</td><td>{row.days}</td><td>{row.pending}</td><td>{row.issues}</td></tr>) : tab === 'days' ? visibleRows.map((day, index) => <tr key={index}><td>{dateLabel(day.dateKey)}</td><td>{day.userName}</td><td>{day.intervals.length ? formatAttendanceSpan(day.intervals.reduce((sum, interval) => sum + interval.minutes, 0)) : '—'}</td><td>{day.entryCount}</td><td>{day.exitCount}</td><td>{day.openEntries.length ? 'En curso' : day.anomalies.length ? 'Revisar incidencias' : 'Calculada'}</td></tr>) : tab === 'intervals' ? visibleRows.map((row, index) => <tr key={index}><td>{dateLabel(row.dateKey)}</td><td>{row.userName}</td><td>{formatAttendanceTime(row.startMs)}</td><td>{formatAttendanceTime(row.endMs)}</td><td>{formatAttendanceSpan(row.minutes)}</td><td>{row.crossesMidnight ? 'Cruza medianoche' : 'Mismo día'}</td></tr>) : tab === 'pending' ? visibleRows.map((row, index) => <tr key={index}><td>{row.userName}</td><td>{dateLabel(row.dateKey)}</td><td>{formatAttendanceTime(row.record.capturedAt)}</td><td>Pendiente de salida</td></tr>) : visibleRows.map((row, index) => <tr key={index}><td>{row.userName}</td><td>{dateLabel(row.record.capturedAt)} {formatAttendanceTime(row.record.capturedAt)}</td><td>{row.issue}</td><td>{row.treatment}</td></tr>)}</tbody>
      </table><div className="attendance-hours-actions"><span>{viewRows.length} filas</span><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>{currentPage + 1} / {Math.max(1, Math.ceil(viewRows.length / 100))}</span><button type="button" disabled={(currentPage + 1) * 100 >= viewRows.length} onClick={() => setPage(currentPage + 1)}>Siguiente</button></div>{!(tab === 'people' ? people : tab === 'days' ? report.journeys : tab === 'intervals' ? report.intervals : tab === 'pending' ? report.pending : report.anomalies).length && <p>Sin registros para esta vista y estos filtros.</p>}</div>
    </>}
  </section></div>;
}
