import { formatAttendanceSpan } from './attendanceAnalysis.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const money = value => new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : value || 'Sin definir';
const cents = value => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateAttendancePayment(person, draft) {
  if (!person) throw new Error('Selecciona una persona para generar su boleta.');
  const number = (field) => {
    const value = String(draft[field] ?? '').trim();
    const result = value ? Number(value) : 0;
    if (!Number.isFinite(result) || result < 0 || result > 100000000) throw new Error('Revisa los importes: deben ser números válidos y no negativos.');
    return result;
  };
  const workedMinutes = Math.max(0, Math.round(person.minutes || 0));
  const extraMinutes = Math.round(number('extraHours') * 60);
  if (extraMinutes > workedMinutes) throw new Error('Las horas extra no pueden superar las horas calculadas de asistencia.');
  const regularMinutes = workedMinutes - extraMinutes;
  const salaryValue = number(draft.mode === 'hourly' ? 'hourRate' : 'salary');
  const hasSalary = salaryValue > 0;
  const salary = hasSalary ? (draft.mode === 'hourly' ? cents(regularMinutes / 60 * salaryValue) : cents(salaryValue)) : null;
  const extras = cents(extraMinutes / 60 * number('extraRate'));
  const bonus = cents(number('bonus')), advances = cents(number('advances')), discounts = cents(number('discounts'));
  const earned = hasSalary ? cents(salary + extras + bonus) : null, deductions = cents(advances + discounts);
  if (earned !== null && deductions > earned) throw new Error('Los anticipos y descuentos superan el total ganado. Revisa los importes.');
  const net = earned === null ? null : cents(earned - deductions);
  const paid = String(draft.paid ?? '').trim() === '' ? null : cents(number('paid'));
  if (paid !== null && net !== null && paid > net) throw new Error('El total pagado no puede superar el total a pagar.');
  return { workedMinutes, regularMinutes, extraMinutes, salary, extras, bonus, advances, discounts, earned, deductions, net, paid };
}

export function buildAttendancePaymentSlip({ person, draft, filters, reference }) {
  const totals = calculateAttendancePayment(person, draft);
  if (!draft.position?.trim()) throw new Error('Indica el cargo del trabajador.');
  if (!draft.representative?.trim()) throw new Error('Indica el nombre de quien representa a la empresa.');
  if (!draft.date) throw new Error('Indica la fecha de emisión.');
  const period = `${date(filters.dateFrom)} al ${date(filters.dateTo)}`;
  const rows = [['Salario / remuneración', totals.salary], ['Horas extra', totals.extras], ['Bono', totals.bonus], ['TOTAL GANADO', totals.earned, 'subtotal'], ['Anticipos', totals.advances], ['Descuentos', totals.discounts], ['TOTAL DESCUENTOS', totals.deductions, 'subtotal'], ['TOTAL A PAGAR', totals.net, 'total'], ['TOTAL PAGADO', totals.paid, 'paid']];
  const copy = label => `<article class="slip"><header><img src="/imagenes/logo_el_copetin_redisenado.png" alt="El Copetín"><div><span class="eyebrow">${label}</span><strong>BOLETA DE PAGO</strong><small>Expresado en bolivianos · ${escape(reference)}</small></div></header>
    <section class="identity"><div><small>TRABAJADOR/A</small><strong>${escape(person.name)}</strong></div><div><small>CARGO</small><span>${escape(draft.position)}</span></div><div><small>PERÍODO</small><span>${escape(period)}</span></div><div><small>FECHA DE EMISIÓN</small><span>${escape(date(draft.date))}</span></div></section>
    <div class="body"><table><thead><tr><th>Concepto</th><th>Importe (Bs)</th></tr></thead><tbody>${rows.map(([label, amount, className]) => `<tr class="${className || ''}"><td>${label}</td><td>${amount ? money(amount) : ''}</td></tr>`).join('')}</tbody></table>
    <aside><h2>RESUMEN DE ASISTENCIA</h2><dl><div><dt>Días con horas válidas</dt><dd>${person.workedDays}</dd></div><div><dt>Horas ordinarias</dt><dd>${formatAttendanceSpan(totals.regularMinutes)}</dd></div><div><dt>Horas extra</dt><dd>${formatAttendanceSpan(totals.extraMinutes)}</dd></div><div class="hours-total"><dt>Total trabajado</dt><dd>${formatAttendanceSpan(totals.workedMinutes)} h</dd></div></dl></aside></div>
    <p class="notes"><b>Observaciones:</b> ${escape(draft.notes || 'Sin observaciones.')}</p><footer><div><strong>${escape(draft.representative)}</strong><span>Representante de la empresa · Firma</span></div><div><strong>${escape(person.name)}</strong><span>Trabajador/a · Firma de conformidad</span></div></footer></article>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Boleta de pago - ${escape(person.name)}</title><style>
    @page{size:letter;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#24313c;background:white;font:10px Arial,sans-serif}.slip{height:124mm;border:1px solid #bac1c5;border-radius:6px;padding:5mm;display:flex;flex-direction:column;break-inside:avoid}header{display:flex;align-items:center;justify-content:space-between;gap:6mm;border-bottom:2px solid #ad783c;padding-bottom:3mm}header img{width:45mm;height:16mm;object-fit:contain}header>div{display:flex;flex-direction:column;align-items:flex-end;gap:3px}header strong{font-size:18px;letter-spacing:1px}header small{font-size:9px}.eyebrow{font-size:8px;letter-spacing:1px;color:#82603b;font-weight:bold}.identity{display:grid;grid-template-columns:1.4fr 1fr;gap:3mm 6mm;padding:3mm 0}.identity>div{display:flex;flex-direction:column;gap:3px;min-width:0}.identity small{font-size:8px;color:#647078}.identity strong,.identity span{overflow-wrap:anywhere}.body{display:grid;grid-template-columns:1.25fr 1fr;gap:5mm}table{width:100%;border-collapse:collapse;font-size:10px}th{background:#263c4c;color:white;text-align:left;font-size:9px}th,td{padding:1mm 2mm;border-bottom:1px solid #dfe3e6}th:last-child,td:last-child{text-align:right;white-space:nowrap;width:35%;border-left:1px solid #aab4bb}.subtotal{font-weight:bold;background:#f1f3f4}.total{background:#f6ebd8;font-weight:bold}.paid{font-weight:bold}aside{border:1px solid #dde2e4;border-radius:4px;padding:3mm}h2{font-size:9px;letter-spacing:.6px;margin:0 0 3mm}dl{margin:0}dl>div{display:flex;justify-content:space-between;gap:4mm;padding:1.7mm 0}dd{margin:0;font-weight:bold;white-space:nowrap}.hours-total{border-top:1px solid #bfc7cb;margin-top:1mm}aside p{font-size:9px;line-height:1.4;margin:2mm 0 0}.notice{color:#80521c}.notes{font-size:9px;margin:3mm 0;min-height:8mm;max-height:12mm;overflow-wrap:anywhere;white-space:pre-wrap}footer{display:grid;grid-template-columns:1fr 1fr;gap:15mm;margin-top:auto;padding-top:5mm}footer{flex-shrink:0;position:relative;top:-2mm}footer>div{border-top:1px solid #65717a;padding-top:2mm;text-align:center;display:flex;flex-direction:column;gap:2px}footer strong{font-size:10px;overflow-wrap:anywhere}footer span{font-size:8px;color:#647078}.cut{height:5mm;display:flex;align-items:center;gap:3mm;color:#8b9398;font-size:8px}.cut:before,.cut:after{content:'';border-top:1px dashed #a9b0b5;flex:1}@media print{*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body>${copy('COPIA DEL TRABAJADOR')}<div class="cut">LÍNEA DE CORTE</div>${copy('COPIA DE LA EMPRESA')}</body></html>`;
}
