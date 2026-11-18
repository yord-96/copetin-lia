import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { getAttendanceDateKey, formatAttendanceSpan } from '../../utils/attendanceAnalysis.js';
import { buildAttendancePaymentSlip, calculateAttendancePayment } from '../../utils/attendancePaymentSlip.js';

export default function AttendancePaymentSlip({ people, filters, onBack }) {
  const [personId, setPersonId] = useState(people.length === 1 ? people[0].id : '');
  const [draft, setDraft] = useState({ mode: 'hourly', hourRate: '', salary: '', extraHours: '0', extraRate: '', bonus: '0', advances: '0', discounts: '0', paid: '', position: '', representative: '', date: getAttendanceDateKey(new Date()), notes: '' });
  const [reference] = useState(() => `BP-${getAttendanceDateKey(new Date()).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const controller = useRef(null), previewRef = useRef(''), formRef = useRef(null);
  useEffect(() => { formRef.current?.querySelector('select')?.focus(); return () => { controller.current?.abort(); if (previewRef.current) URL.revokeObjectURL(previewRef.current); }; }, []);
  const clearPreview = () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); previewRef.current = ''; setPreview(''); };
  const change = (field, value) => { clearPreview(); setError(''); setDraft(current => ({ ...current, [field]: value })); };
  const person = people.find(row => row.id === personId);
  let totals = null;
  try { totals = calculateAttendancePayment(person, draft); } catch { /* Show validation when generating; fields may still be incomplete. */ }
  const amount = (field, label, props = {}) => <label>{label}<input type="number" min="0" step="0.01" max="100000000" value={draft[field]} disabled={busy} onChange={event => change(field, event.target.value)} {...props} /></label>;
  const generate = async event => {
    event.preventDefault(); if (busy) return;
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
        <label>Trabajador/a<select required value={personId} disabled={busy} onChange={event => { clearPreview(); setPersonId(event.target.value); setError(''); setDraft(current => ({ ...current, position: '', hourRate: '', salary: '', extraHours: '0', extraRate: '', bonus: '0', advances: '0', discounts: '0', paid: '', notes: '' })); }}><option value="">Selecciona una persona</option>{people.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Cargo<input required maxLength="60" value={draft.position} disabled={busy} onChange={event => change('position', event.target.value)} placeholder="Ej.: Operativo" /></label>
        <label>Representante de la empresa<input required maxLength="80" value={draft.representative} disabled={busy} onChange={event => change('representative', event.target.value)} placeholder="Nombre para la firma" /></label>
        <label>Fecha de emisión<input type="date" required value={draft.date} disabled={busy} onChange={event => change('date', event.target.value)} /></label>
      </div>
      {person && <div className="attendance-payment-summary"><strong>{person.name}</strong><span>{person.workedDays} días con horas válidas · {formatAttendanceSpan(person.minutes)} h calculadas</span><span>{person.pending} entradas abiertas · {person.issues} incidencias (no suman horas)</span></div>}
      <div className="attendance-payment-fields">
        <label>Forma de cálculo<select value={draft.mode} disabled={busy} onChange={event => change('mode', event.target.value)}><option value="hourly">Pago por hora trabajada</option><option value="fixed">Importe acordado para el período</option></select></label>
        {draft.mode === 'hourly' ? amount('hourRate', 'Tarifa ordinaria (Bs/h)', { required: true }) : amount('salary', 'Salario del período (Bs)', { required: true })}
        {amount('extraHours', 'Horas extra incluidas en el total (decimal)')}
        {amount('extraRate', 'Tarifa de hora extra (Bs/h)', { required: Number(draft.extraHours) > 0 })}
        {amount('bonus', 'Bono (Bs)')}{amount('advances', 'Anticipos (Bs)')}{amount('discounts', 'Descuentos (Bs)')}{amount('paid', 'Total pagado (Bs)', { placeholder: 'En blanco para completar al pagar' })}
      </div>
      <p>Las horas extra se separan del total trabajado; no se suman dos veces. No se determinan automáticamente por falta de un horario salarial definido.</p>
      <label>Observaciones<textarea maxLength="150" rows="2" value={draft.notes} disabled={busy} onChange={event => change('notes', event.target.value)} /></label>
      {totals && <div className="attendance-payment-summary"><span>Total ganado: Bs {totals.earned.toFixed(2)}</span><span>Descuentos y anticipos: Bs {totals.deductions.toFixed(2)}</span><strong>Total a pagar: Bs {totals.net.toFixed(2)}</strong></div>}
      {error && <p role="alert" className="attendance-payment-error">{error}</p>}
      <div className="attendance-hours-actions"><button type="submit" className="primary-button" disabled={busy || !person}>{busy ? 'Generando PDF…' : 'Generar PDF con ambas copias'}</button>{preview && <><a className="ghost-button" href={preview} target="_blank" rel="noopener noreferrer">Abrir / imprimir</a><a className="ghost-button" href={preview} download={`${reference}.pdf`}>Descargar boleta</a></>}</div>
    </form>
    {preview && <iframe className="attendance-payment-preview" title="Boleta de pago en hoja carta" src={preview} />}
  </div>;
}
