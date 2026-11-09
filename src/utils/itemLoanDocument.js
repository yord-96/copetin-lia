const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const dateLabel = value => {
  if (!value) return 'Por coordinar';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-04:00` : value);
  return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
};

export function buildItemLoanDocumentHtml({ loan, settings = {} }) {
  const lines = loan.lines ?? [];
  const returns = loan.returns ?? [];
  const rows = lines.map(line => {
    const quantity = Number(line.quantity ?? 0);
    const returned = returns.filter(row => row.lineId === line.id && !row.deletedAt).reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    return { ...line, quantity, returned, pending: Math.max(0, quantity - returned) };
  });
  const totals = rows.reduce((sum, row) => ({ quantity: sum.quantity + row.quantity, returned: sum.returned + row.returned, pending: sum.pending + row.pending }), { quantity: 0, returned: 0, pending: 0 });
  const field = (label, value) => `<div class="field"><small>${label}</small><strong>${escapeHtml(value || '-')}</strong></div>`;
  const company = [settings.address, settings.phone, settings.email].filter(Boolean).map(escapeHtml).join(' · ');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Préstamo ${escapeHtml(loan.code)}</title><style>
    @page { size: Letter; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #20252d; font: 11px Arial, sans-serif; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .brand { display: flex; justify-content: space-between; align-items: center; gap: 8mm; border-bottom: .5mm solid #a86920; padding-bottom: 4mm; }
    .brand img { width: 62mm; height: 22mm; object-fit: contain; }
    .brand-code { text-align: right; }
    .brand-code small, .field small { display: block; font-size: 8px; color: #806037; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; }
    .brand-code strong { display: block; color: #a05a12; font-size: 22px; }
    h1 { font: 500 23px Georgia, serif; text-align: center; margin: 5mm 0 1mm; }
    .intro { text-align: center; color: #646a72; margin: 0 0 5mm; font-size: 10px; }
    .fields { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 3mm 5mm; padding: 4mm; border: .25mm solid #dfd0bc; border-radius: 2mm; background: #fffdfa; }
    .field { min-width: 0; }
    .field strong { display: block; margin-top: 1mm; overflow-wrap: anywhere; font-size: 11px; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin: 4mm 0; }
    .summary div { padding: 3mm 4mm; background: #f3f6fa; border: .25mm solid #d5deea; border-radius: 1.5mm; }
    .summary small { display: block; font-size: 9px; color: #5e6875; }
    .summary strong { font-size: 19px; color: #163a6b; }
    .summary .pending { background: #fff3e8; border-color: #e7c49f; }
    .summary .pending strong { color: #a35016; }
    h2 { color: #985813; font-size: 11px; margin: 4mm 0 2mm; text-transform: uppercase; break-after: avoid; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { background: #233447; color: white; font-size: 8px; text-transform: uppercase; padding: 2.5mm 2mm; text-align: left; }
    td { padding: 2.4mm 2mm; border-bottom: .25mm solid #ddd7cf; vertical-align: top; overflow-wrap: anywhere; }
    tbody tr:nth-child(even) { background: #faf8f4; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .number { text-align: center; font-variant-numeric: tabular-nums; }
    .material { font-weight: 700; font-size: 10px; }
    .notes { border: .25mm solid #dfd0bc; border-radius: 1.5mm; padding: 3mm; white-space: pre-wrap; overflow-wrap: anywhere; }
    .history td { font-size: 9px; }
    .history small { display: block; margin-top: 1mm; color: #646a72; }
    .void { color: #8a6363; }
    .closing { break-inside: avoid; page-break-inside: avoid; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 16mm; padding-top: 14mm; }
    .signature { border-top: .25mm solid #797979; text-align: center; padding-top: 2mm; font-size: 9px; }
    .signature strong { display: block; font-size: 10px; }
    footer { margin-top: 5mm; padding-top: 2mm; border-top: .25mm solid #dfd0bc; color: #747474; font-size: 8px; text-align: center; overflow-wrap: anywhere; }
    .compact .brand { padding-bottom: 3mm; }
    .compact .brand img { height: 18mm; }
    .compact h1 { margin-top: 4mm; }
    .compact .intro { margin-bottom: 3mm; }
    .compact .fields { padding: 3mm; gap: 2mm 5mm; }
    .compact .summary { margin: 3mm 0; }
    .compact .summary div { padding: 2mm 3mm; }
    .compact td { padding: 1.3mm 2mm; }
    .compact h2 { margin: 3mm 0 1.5mm; }
    .compact .notes { padding: 2mm; }
    .compact .signatures { padding-top: 10mm; }
    .compact footer { margin-top: 3mm; }
  </style></head><body class="${lines.length >= 7 ? 'compact' : ''}">
    <header class="brand"><img src="/imagenes/logo_el_copetin_redisenado.png" alt="El Copetín"><div class="brand-code"><small>Préstamo de materiales</small><strong>${escapeHtml(loan.code)}</strong><span>${totals.pending > 0 ? 'Pendiente de devolución' : 'Devuelto por completo'}</span></div></header>
    <h1>COMPROBANTE DE PRÉSTAMO</h1><p class="intro">Detalle de materiales prestados y su estado de devolución.</p>
    <section class="fields">
      ${field('Persona que recibe', loan.personName)}${field('Teléfono', loan.phone)}${field('CI / documento', loan.document)}
      ${field('Fecha del préstamo', dateLabel(loan.date))}${field('Devolución prevista', dateLabel(loan.dueDate))}${field('Tipo de préstamo', loan.kind === 'legacy' ? 'Antiguo' : 'Nuevo')}
    </section>
    <section class="summary"><div><small>Unidades prestadas</small><strong>${totals.quantity}</strong></div><div><small>Unidades devueltas</small><strong>${totals.returned}</strong></div><div class="pending"><small>Unidades pendientes</small><strong>${totals.pending}</strong></div></section>
    <h2>Materiales prestados</h2>
    <table><colgroup><col style="width:6%"><col style="width:55%"><col style="width:13%"><col style="width:13%"><col style="width:13%"></colgroup><thead><tr><th>N.º</th><th>Material</th><th class="number">Prestado</th><th class="number">Devuelto</th><th class="number">Pendiente</th></tr></thead><tbody>
      ${rows.map((line, index) => `<tr><td class="number">${index + 1}</td><td class="material">${escapeHtml(line.itemName)}</td><td class="number">${line.quantity}</td><td class="number">${line.returned}</td><td class="number"><strong>${line.pending}</strong></td></tr>`).join('')}
    </tbody></table>
    <h2>Observaciones</h2><div class="notes">${escapeHtml(loan.notes || 'Sin observaciones registradas.')}</div>
    ${returns.length ? `<h2>Historial de devoluciones</h2><table class="history"><colgroup><col style="width:17%"><col style="width:50%"><col style="width:13%"><col style="width:20%"></colgroup><thead><tr><th>Fecha</th><th>Material / detalle</th><th class="number">Cantidad</th><th>Estado</th></tr></thead><tbody>${returns.map(row => `<tr class="${row.deletedAt ? 'void' : ''}"><td>${escapeHtml(dateLabel(row.date))}</td><td>${escapeHtml(lines.find(line => line.id === row.lineId)?.itemName || 'Material del préstamo')}${row.note ? `<small>${escapeHtml(row.note)}</small>` : ''}</td><td class="number">${Number(row.quantity ?? 0)}</td><td>${row.deletedAt ? 'Anulada' : 'Registrada'}</td></tr>`).join('')}</tbody></table>` : ''}
    <section class="closing"><div class="signatures"><div class="signature"><strong>Entregado por</strong>${escapeHtml(loan.createdByName || 'Responsable de entrega')}<br>Firma</div><div class="signature"><strong>Recibido por</strong>${escapeHtml(loan.personName)}<br>Firma</div></div>
      <footer>${escapeHtml(settings.companyName || 'El Copetín')}${company ? ` · ${company}` : ''}<br>${escapeHtml(loan.code)} · Control de materiales · Actualizado: ${escapeHtml(dateLabel(loan.updatedAt || loan.createdAt || loan.date))}</footer>
    </section>
  </body></html>`;
}
