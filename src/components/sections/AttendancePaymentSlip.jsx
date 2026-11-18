import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { getAttendanceDateKey, formatAttendanceSpan } from '../../utils/attendanceAnalysis.js';
import { buildAttendancePaymentSlip, calculateAttendancePayment } from '../../utils/attendancePaymentSlip.js';

export default function AttendancePaymentSlip({ people, filters, actorId, onBack }) {
  const [personId, setPersonId] = useState(people.length === 1 ? people[0].id : '');
  const [draft, setDraft] = useState({ mode: 'fixed', hourRate: '', salary: '', extraHours: '', extraRate: '', bonus: '', advances: '', discounts: '', paid: '', position: '', representative: 'Marisol Sequeiros', date: getAttendanceDateKey(new Date()), notes: '' });
  const [cash, setCash] = useState(null);
  const [cashError, setCashError] = useState('');
  const [cashRevision, setCashRevision] = useState(0);
  const [reference] = useState(() => `BP-${getAttendanceDateKey(new Date()).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const controller = useRef(null), previewRef = useRef(''), formRef = useRef(null);
  useEffect(() => { formRef.current?.querySelector('select')?.focus(); return () => { controller.current?.abort(); if (previewRef.current) URL.revokeObjectURL(previewRef.current); }; }, []);
  useEffect(() => {
    if (!personId) return undefined;
    let active = true;
    const request = new AbortController();
    setCash(null); setCashError('');
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = ''; setPreview('');
    api.attendance.getPaymentCash({ actorId, personKey: personId, dateFrom: filters.dateFrom, dateTo: filters.dateTo, signal: request.signal }).then(result => {
      if (!active) return;
      setCash(result); setDraft(current => ({ ...current, advances: result.advances || '', discounts: result.discounts || '' }));
    }).catch(failure => { if (active && failure.name !== 'AbortError') setCashError(failure.message || 'No se pudo consultar Caja Chica. Reintenta antes de generar la boleta.'); });
    return () => { active = false; request.abort(); };
  }, [personId, actorId, filters.dateFrom, filters.dateTo, cashRevision]);
  const clearPreview = () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); previewRef.current = ''; setPreview(''); };
  const change = (field, value) => { clearPreview(); setError(''); setDraft(current => ({ ...current, [field]: value })); };
  const person = people.find(row => row.id === personId);
  let totals = null;
  try { totals = calculateAttendancePayment(person, draft); } catch { /* Show validation when generating; fields may still be incomplete. */ }
  const amount = (field, label, props = {}) => <label>{label}<input type="number" min="0" step="0.01" max="100000000" value={draft[field]} disabled={busy} onChange={event => change(field, event.target.value)} {...props} /></label>;
  const generate = async event => {
    event.preventDefault(); if (busy || !cash || cash.personKey !== personId || cashError) return;
    setError('');
    try {
      const html = buildAttendancePaymentSlip({ person, draft, filters, reference });
      setBusy(true); controller.current = new AbortController();
      const blob = await api.attendance.generatePaymentSlip({ html, fileName: `${reference}.pdf`, signal: controller.current.signal });
      clearPreview(); previewRef.current = URL.createObjectURL(blob); setPreview(previewRef.current);
    } catch (failure) { if (failure.name !== 'AbortError') setError(failure.message || 'No se pudo generar la boleta. Tus datos siguen aquí; puedes reintentar.'); }
    finally { setBusy(false); }
  };
  return <div className="attendance-payment" ref={formRef}>
    <div className="attendance-hours-actions"><button type="button" disabled={busy} onClick={onBack}>Volver a horas</button><strong>Boleta de pago · Dos copias en hoja carta</strong></div>
    <p>Revisa la remuneración del período. Generar esta boleta no registra un pago en Caja ni modifica las asistencias.</p>
    <form onSubmit={generate}>
      <div className="attendance-payment-fields">
        <label>Trabajador/a<select required value={personId} disabled={busy} onChange={event => { clearPreview(); setPersonId(event.target.value); setError(''); setDraft(current => ({ ...current, position: '', hourRate: '', salary: '', extraHours: '', extraRate: '', bonus: '', advances: '', discounts: '', paid: '', notes: '' })); }}><option value="">Selecciona una persona</option>{people.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Cargo<input required maxLength="60" value={draft.position} disabled={busy} onChange={event => change('position', event.target.value)} placeholder="Ej.: Operativo" /></label>
        <label>Representante de la empresa<input required maxLength="80" value={draft.representative} disabled={busy} onChange={event => change('representative', event.target.value)} placeholder="Nombre para la firma" /></label>
        <label>Fecha de emisión<input type="date" required value={draft.date} disabled={busy} onChange={event => change('date', event.target.value)} /></label>
      </div>
      {person && <div className="attendance-payment-summary"><strong>{person.name}</strong><span>{person.workedDays} días con horas válidas · {formatAttendanceSpan(person.minutes)} h calculadas</span><span>{person.pending} entradas abiertas · {person.issues} incidencias (no suman horas)</span></div>}
      <div className="attendance-payment-fields">
        <label>Forma de cálculo<select value={draft.mode} disabled={busy} onChange={event => change('mode', event.target.value)}><option value="hourly">Pago por hora trabajada</option><option value="fixed">Importe acordado para el período</option></select></label>
        {draft.mode === 'hourly' ? amount('hourRate', 'Tarifa ordinaria (Bs/h)') : amount('salary', 'Salario del período (Bs)', { placeholder: 'Opcional; en blanco para completar a mano' })}
        {amount('extraHours', 'Horas extra incluidas en el total (decimal)')}
        {amount('extraRate', 'Tarifa de hora extra (Bs/h)')}
        {amount('bonus', 'Bono (Bs)')}{amount('advances', 'Anticipos de Caja Chica (Bs)', { readOnly: true })}{amount('discounts', 'Descuentos de Caja Chica (Bs)', { readOnly: true })}{amount('paid', 'Total pagado (Bs)', { placeholder: 'En blanco para completar al pagar' })}
      </div>
      <p>Las horas extra se separan del total trabajado; no se suman dos veces. No se determinan automáticamente por falta de un horario salarial definido.</p>
      <label>Observaciones<textarea maxLength="150" rows="2" value={draft.notes} disabled={busy} onChange={event => change('notes', event.target.value)} /></label>
      {person && <section className="attendance-payment-summary" aria-label="Anticipos y descuentos registrados"><strong>Caja Chica del período seleccionado · Efectivo y Digital</strong>{cashError ? <p role="alert">{cashError}</p> : !cash || cash.personKey !== personId ? <p role="status">Consultando anticipos y descuentos…</p> : <><span>{cash.movements.length} registro(s). Los importes se completan desde Caja Chica.</span>{cash.warning && <p role="alert">{cash.warning}</p>}<details><summary>Ver registros incluidos</summary>{cash.movements.length ? <ul>{cash.movements.map(row => <li key={row.id}>{row.date} · {row.receiptCode || row.description} · {row.kind === 'advance' ? 'Anticipo' : 'Descuento'} · Bs {row.amountBs.toFixed(2)}</li>)}</ul> : <p>No hay anticipos ni descuentos registrados para esta persona en este período.</p>}</details></>}<button type="button" disabled={busy} onClick={() => setCashRevision(value => value + 1)}>Actualizar Caja Chica</button></section>}
      {totals && <div className="attendance-payment-summary"><span>Total ganado: {totals.earned ? `Bs ${totals.earned.toFixed(2)}` : 'En blanco'}</span><span>Descuentos y anticipos: {totals.deductions ? `Bs ${totals.deductions.toFixed(2)}` : 'En blanco'}</span><strong>Total a pagar: {totals.net ? `Bs ${totals.net.toFixed(2)}` : 'En blanco'}</strong></div>}
      {error && <p role="alert" className="attendance-payment-error">{error}</p>}
      <div className="attendance-hours-actions"><button type="submit" className="primary-button" disabled={busy || !person || !cash || cash.personKey !== personId || Boolean(cashError)}>{busy ? 'Generando PDF…' : 'Generar PDF con ambas copias'}</button>{preview && <><a className="ghost-button" href={preview} target="_blank" rel="noopener noreferrer">Abrir / imprimir</a><a className="ghost-button" href={preview} download={`${reference}.pdf`}>Descargar boleta</a></>}</div>
    </form>
    {preview && <iframe className="attendance-payment-preview" title="Boleta de pago en hoja carta" src={preview} />}
  </div>;
}
