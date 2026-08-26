const text = (value) => String(value ?? '').trim();
const number = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value) => new Intl.NumberFormat('es-BO', {
  style: 'currency', currency: 'BOB', minimumFractionDigits: 2,
}).format(number(value));
const escapeHtml = (value) => text(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const dateLabel = (value) => {
  const raw = text(value).slice(0, 10);
  if (!raw) return '—';
  const parsed = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return escapeHtml(raw);
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: 'long', year: 'numeric' });
};

const defaultClauses = (event) => [
  `El Centro de Eventos LINCOLN prestará los servicios acordados para el evento ${text(event?.eventType) || 'programado'} en ${text(event?.roomName) || 'el salón acordado'}, en fecha ${dateLabel(event?.eventDate)}.`,
  `La duración referencial del servicio será de ${number(event?.durationHours) || 8} horas, iniciando a horas ${text(event?.startTime) || 'por definir'}.`,
  `El precio y los servicios incluidos corresponden a la propuesta comercial aceptada y a la hoja de costos que forma parte integrante de este contrato.`,
  'Los servicios adicionales, cambios de cantidad o condiciones especiales deberán constar por escrito y podrán modificar el saldo del evento.',
  'La garantía se administra de forma separada al costo del servicio y podrá ser devuelta después del evento, una vez verificadas las obligaciones pendientes.',
  'El saldo deberá ser cancelado dentro del plazo acordado entre las partes. Los pagos registrados por el sistema forman parte del historial económico del evento.',
  'Los contratantes declaran conocer y aceptar las condiciones del servicio, así como las reglas de uso de las instalaciones de Centro de Eventos LINCOLN.',
];

const normalizeDocument = (event) => {
  const snapshot = event?.contractDocumentSnapshot && typeof event.contractDocumentSnapshot === 'object'
    ? event.contractDocumentSnapshot
    : {};
  const packageSnapshot = event?.packageSnapshot && typeof event.packageSnapshot === 'object'
    ? event.packageSnapshot
    : {};
  const selectedVariant = packageSnapshot.selectedVariant && typeof packageSnapshot.selectedVariant === 'object'
    ? packageSnapshot.selectedVariant
    : {};
  const services = Array.isArray(snapshot.services)
    ? snapshot.services.filter((line) => line?.selected !== false)
    : (Array.isArray(packageSnapshot.serviceLines)
      ? packageSnapshot.serviceLines.filter((line) => line?.included !== false && line?.catalogKind !== 'extra')
      : []);
  const extras = Array.isArray(snapshot.extras)
    ? snapshot.extras.filter((line) => line?.selected)
    : [];
  const guestCount = number(snapshot.guestCount ?? event?.guestCount);
  const pricePerPersonBs = number(snapshot.pricePerPersonBs ?? event?.packagePricePerPersonBs ?? selectedVariant.pricePerPersonBs);
  const baseBs = number(snapshot?.totals?.baseBs || guestCount * pricePerPersonBs);
  const extrasBs = number(snapshot?.totals?.extrasBs || extras.reduce((total, line) => {
    const quantity = Math.max(1, number(line?.quantity) || 1);
    const unitCost = number(line?.unitCostBs);
    return total + (line?.costMode === 'per_person' ? unitCost * guestCount * quantity : unitCost * quantity);
  }, 0));
  const discountPercent = number(snapshot.discountPercent);
  const discountBs = number(snapshot?.totals?.discountBs || ((baseBs + extrasBs) * discountPercent / 100));
  const totalBs = number(snapshot?.totals?.totalBs ?? event?.totalBs ?? event?.estimatedTotalBs ?? Math.max(0, baseBs + extrasBs - discountBs));
  const advanceBs = number(snapshot.advanceBs ?? event?.reservationPaymentBs) + (snapshot.advanceBs == null ? number(event?.accountPaymentBs) : 0);
  const balanceBs = Math.max(0, number(snapshot?.totals?.balanceBs ?? totalBs - advanceBs));
  return {
    ...snapshot,
    contractCode: text(event?.contractCode || snapshot.contractCode || event?.code),
    contractDate: snapshot.contractDate || event?.contractedAt || event?.createdAt,
    contractor1Name: snapshot.contractor1Name || event?.contractor1Name || event?.clientName,
    contractor1Ci: snapshot.contractor1Ci || event?.contractor1Ci || event?.clientCi,
    contractor1Phone: snapshot.contractor1Phone || event?.contractor1Phone || event?.clientPhone,
    contractor2Name: snapshot.contractor2Name || event?.contractor2Name,
    contractor2Ci: snapshot.contractor2Ci || event?.contractor2Ci,
    contractor2Phone: snapshot.contractor2Phone || event?.contractor2Phone,
    eventType: snapshot.eventType || event?.eventType,
    eventDate: snapshot.eventDate || event?.eventDate,
    startTime: snapshot.startTime || event?.startTime,
    durationHours: number(snapshot.durationHours ?? event?.durationHours ?? 8),
    roomName: snapshot.roomName || event?.roomName,
    guestCount,
    packageName: snapshot.packageName || event?.packageName || packageSnapshot.templateName,
    packageVariantName: snapshot.packageVariantName || event?.packageVariantName || selectedVariant.name,
    pricePerPersonBs,
    services,
    extras,
    discountPercent,
    advanceBs,
    guaranteeBs: number(snapshot.guaranteeBs ?? event?.guaranteeBs),
    notes: snapshot.notes || event?.notes || '',
    clauses: Array.isArray(snapshot.clauses) && snapshot.clauses.length ? snapshot.clauses : defaultClauses(event),
    totals: { baseBs, extrasBs, discountBs, totalBs, balanceBs },
  };
};

const groupServices = (services) => services.reduce((groups, line) => {
  const category = text(line?.category || 'OTROS').toUpperCase();
  if (!groups[category]) groups[category] = [];
  groups[category].push(line);
  return groups;
}, {});

const clauseNames = ['PRIMERA', 'SEGUNDA', 'TERCERA', 'CUARTA', 'QUINTA', 'SEXTA', 'SÉPTIMA', 'OCTAVA', 'NOVENA', 'DÉCIMA'];

export const buildLincolnContractDocumentHtml = ({ event }) => {
  const doc = normalizeDocument(event);
  const grouped = groupServices(doc.services);
  const serviceSections = Object.entries(grouped).map(([category, lines]) => `
    <section class="service-group">
      <h3>${escapeHtml(category)}</h3>
      ${lines.map((line) => `<div class="service-line"><span>${escapeHtml(line?.description || line?.name || 'Servicio')}</span><b>✓</b></div>`).join('')}
    </section>`).join('');
  const extraRows = doc.extras.map((line) => {
    const quantity = Math.max(1, number(line?.quantity) || 1);
    const value = line?.costMode === 'per_person'
      ? `${money(line?.unitCostBs)} / persona`
      : money(number(line?.unitCostBs) * quantity);
    return `<div class="extra-line"><span>${escapeHtml(line?.description || line?.name || 'Servicio adicional')}</span><strong>${escapeHtml(value)}</strong></div>`;
  }).join('');
  const clauseRows = doc.clauses.map((clause, index) => `<li><b>${clauseNames[index] || `CLÁUSULA ${index + 1}`}.-</b> ${escapeHtml(clause)}</li>`).join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(doc.contractCode || 'Contrato Lincoln')}</title>
<style>
  @page{size:Letter portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#24191b;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:216mm;min-height:279mm;padding:14mm 16mm 13mm;page-break-after:always;position:relative}.page:last-child{page-break-after:auto}
  .head{display:flex;justify-content:space-between;gap:14mm;padding-bottom:5mm;border-bottom:1.2mm solid #7c1520}.brand small{display:block;color:#7c1520;font-size:8pt;font-weight:800;letter-spacing:.24em}.brand h1{margin:1mm 0 0;font-family:Georgia,serif;font-size:24pt;letter-spacing:.08em}.brand p{margin:1mm 0 0;color:#796b67;font-size:8pt}.code{text-align:right}.code strong{display:block;color:#7c1520;font-size:12pt}.code span{display:block;margin-top:1.5mm;color:#766864;font-size:8pt}
  h2{text-align:center;margin:7mm 0 5mm;font-size:14pt;letter-spacing:.04em}.facts{display:grid;grid-template-columns:1fr 1fr;gap:3mm}.fact{padding:3mm;border:1px solid #dfd4cf;border-radius:2mm}.fact span,.summary span{display:block;color:#897974;font-size:7pt;font-weight:800;text-transform:uppercase}.fact strong,.summary strong{display:block;margin-top:1mm;font-size:9pt}.fact small{display:block;margin-top:1mm;color:#6f625f;font-size:7.5pt}.intro{margin:5mm 0 3mm;font-size:9pt;line-height:1.5;text-align:justify}.clauses{margin:0;padding-left:6mm;font-size:8.8pt;line-height:1.45;text-align:justify}.clauses li{margin-bottom:2.2mm}.clauses b{color:#4d1b20}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:10mm;margin-top:16mm;text-align:center}.signature{padding-top:2mm;border-top:1px solid #3d3332;font-size:8pt}.signature b{display:block}.signature small{display:block;color:#7a6c68;margin-top:1mm}
  .cost-head h1{font-family:Arial,Helvetica,sans-serif;font-size:17pt;letter-spacing:0}.summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm;margin:5mm 0}.summary{padding:3mm;border:1px solid #e0d5d0}.service-group{margin:3mm 0}.service-group h3,.extras h3{margin:0;padding:2.2mm 3mm;background:#7c1520;color:#fff;font-size:8pt;letter-spacing:.04em}.service-line,.extra-line{display:grid;grid-template-columns:1fr auto;gap:3mm;padding:2.2mm 3mm;border:1px solid #ded2cd;border-top:0;font-size:8pt}.service-line b{color:#7c1520}.extras{margin-top:4mm}.totals{width:92mm;margin:6mm 0 0 auto;border:1px solid #ded3ce}.totals div{display:flex;justify-content:space-between;gap:6mm;padding:2.5mm 3mm;border-bottom:1px solid #e8ddd8;font-size:8.5pt}.totals div:last-child{border-bottom:0}.totals .total{background:#f8ecea;color:#78151e;font-weight:900;font-size:9.5pt}.notes{margin-top:5mm;padding:3mm;border:1px solid #e0d5d0;font-size:8pt}.notes b{display:block;margin-bottom:1.5mm}.footer{position:absolute;left:16mm;right:16mm;bottom:8mm;display:flex;justify-content:space-between;border-top:1px solid #ece1dc;padding-top:2mm;color:#9a8a84;font-size:6.8pt}
</style>
</head>
<body>
  <section class="page">
    <header class="head"><div class="brand"><small>CENTRO DE EVENTOS</small><h1>LINCOLN</h1><p>Pachamama #2250 y Waldo Ballivian · Cochabamba</p></div><div class="code"><strong>${escapeHtml(doc.contractCode || 'CONTRATO')}</strong><span>${dateLabel(doc.contractDate)}</span></div></header>
    <h2>CONTRATO DE SERVICIOS</h2>
    <div class="facts">
      <div class="fact"><span>Contratante 1</span><strong>${escapeHtml(doc.contractor1Name || '—')}</strong><small>C.I. ${escapeHtml(doc.contractor1Ci || '—')} · ${escapeHtml(doc.contractor1Phone || '—')}</small></div>
      <div class="fact"><span>Contratante 2</span><strong>${escapeHtml(doc.contractor2Name || '—')}</strong><small>C.I. ${escapeHtml(doc.contractor2Ci || '—')} · ${escapeHtml(doc.contractor2Phone || '—')}</small></div>
      <div class="fact"><span>Evento</span><strong>${escapeHtml(doc.eventType || '—')}</strong><small>${dateLabel(doc.eventDate)} · ${escapeHtml(doc.startTime || 'hora pendiente')}</small></div>
      <div class="fact"><span>Salón</span><strong>${escapeHtml(doc.roomName || '—')}</strong><small>${escapeHtml(doc.durationHours)} h · ${escapeHtml(doc.guestCount)} invitados</small></div>
    </div>
    <p class="intro">Conste por el presente documento privado de prestación de servicios, suscrito entre Centro de Eventos LINCOLN y los contratantes individualizados precedentemente, bajo las siguientes cláusulas:</p>
    <ol class="clauses">${clauseRows}</ol>
    <div class="signatures"><div class="signature"><b>BASILIA HERBAS SAHONERO</b><small>Centro de Eventos Lincoln</small></div><div class="signature"><b>${escapeHtml(doc.contractor1Name || 'CONTRATANTE 1')}</b><small>Contratante</small></div><div class="signature"><b>${escapeHtml(doc.contractor2Name || 'CONTRATANTE 2')}</b><small>Contratante</small></div></div>
    <div class="footer"><span>Centro de Eventos Lincoln</span><span>${escapeHtml(doc.contractCode)}</span></div>
  </section>
  <section class="page">
    <header class="head cost-head"><div class="brand"><small>ANEXO DEL CONTRATO</small><h1>HOJA DE COSTOS Y SERVICIOS</h1><p>${escapeHtml(doc.eventType || 'EVENTO')} · ${escapeHtml(doc.contractor1Name || '')}${doc.contractor2Name ? ` / ${escapeHtml(doc.contractor2Name)}` : ''}</p></div><div class="code"><strong>${escapeHtml(doc.contractCode || 'CONTRATO')}</strong><span>${dateLabel(doc.eventDate)}</span></div></header>
    <div class="summary-grid"><div class="summary"><span>Paquete</span><strong>${escapeHtml(doc.packageName || 'SIN PAQUETE')}</strong></div><div class="summary"><span>Nivel</span><strong>${escapeHtml(doc.packageVariantName || 'BASE')}</strong></div><div class="summary"><span>Invitados</span><strong>${escapeHtml(doc.guestCount)}</strong></div><div class="summary"><span>Precio / persona</span><strong>${escapeHtml(money(doc.pricePerPersonBs))}</strong></div></div>
    ${serviceSections || '<p class="intro">No se registraron servicios detallados en el snapshot comercial.</p>'}
    ${extraRows ? `<section class="extras"><h3>SERVICIOS ADICIONALES</h3>${extraRows}</section>` : ''}
    <section class="totals"><div><span>Paquete base</span><strong>${escapeHtml(money(doc.totals.baseBs))}</strong></div>${doc.totals.extrasBs > 0 ? `<div><span>Extras</span><strong>${escapeHtml(money(doc.totals.extrasBs))}</strong></div>` : ''}${doc.totals.discountBs > 0 ? `<div><span>Descuento (${escapeHtml(doc.discountPercent)}%)</span><strong>- ${escapeHtml(money(doc.totals.discountBs))}</strong></div>` : ''}<div class="total"><span>Total servicio</span><strong>${escapeHtml(money(doc.totals.totalBs))}</strong></div><div><span>Anticipo / a cuenta</span><strong>${escapeHtml(money(doc.advanceBs))}</strong></div><div><span>Saldo servicio</span><strong>${escapeHtml(money(doc.totals.balanceBs))}</strong></div><div><span>Garantía separada</span><strong>${escapeHtml(money(doc.guaranteeBs))}</strong></div></section>
    ${doc.notes ? `<section class="notes"><b>OBSERVACIONES / ACUERDOS</b><div>${escapeHtml(doc.notes)}</div></section>` : ''}
    <div class="footer"><span>Hoja de costos · parte integrante del contrato</span><span>${escapeHtml(doc.contractCode)}</span></div>
  </section>
</body>
</html>`;
};

export const buildLincolnContractPdfFileName = (event) => {
  const code = text(event?.contractCode || event?.code || 'CONTRATO-LINCOLN');
  const client = text(event?.contractor1Name || event?.clientName || 'CLIENTE');
  return `${code}-${client}-contrato`;
};
