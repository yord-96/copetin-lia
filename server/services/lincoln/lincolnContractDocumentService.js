const text = (value) => String(value ?? '').trim();
const number = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const roundMoney = (value) => Number(number(value).toFixed(2));
const money = (value) => new Intl.NumberFormat('es-BO', {
  style: 'currency', currency: 'BOB', minimumFractionDigits: 2,
}).format(number(value));
const escapeHtml = (value) => text(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const dateLabel = (value) => {
  const raw = text(value).slice(0, 10);
  if (!raw) return '-';
  const parsed = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return escapeHtml(raw);
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: 'long', year: 'numeric' });
};
const dateLong = (value) => dateLabel(value).toUpperCase();

const defaultClauses = (doc) => {
  const groupLabel = doc.pricingGroups.map((group) => `${group.name}: ${money(group.pricePerPersonBs)} por persona`).join('; ');
  return [
    `Centro de Eventos LINCOLN prestará el servicio de atención para el evento ${text(doc.eventType) || 'programado'}, a realizarse el ${dateLong(doc.eventDate)} en ${text(doc.roomName) || 'el salón acordado'}.`,
    'Los servicios incluidos se encuentran detallados en la hoja de costos y servicios, que forma parte integrante e indivisible del presente contrato.',
    `El costo del servicio se determina para ${number(doc.guestCount)} invitados${groupLabel ? `, bajo la siguiente composición: ${groupLabel}` : ''}. Los importes pactados quedan congelados para este contrato, salvo cambios solicitados por escrito.`,
    `Los contratantes reconocen como anticipo y pagos a cuenta la suma de ${money(doc.advanceBs)}. El saldo deberá ser cancelado ${number(doc.balanceDueDays) || 7} días antes del evento, salvo acuerdo escrito diferente.`,
    'En caso de suspensión por decisión de los contratantes, se aplicarán las condiciones de devolución o penalidad expresamente acordadas. Toda modificación o reprogramación deberá constar por escrito.',
    `Los contratantes se obligan a resarcir los daños ocasionados por ellos o sus invitados en instalaciones, mobiliario, mantelería, vajilla, cristalería y demás bienes. La garantía separada es de ${money(doc.guaranteeBs)} y será devuelta cuando corresponda, previa verificación de obligaciones pendientes.`,
    'El incumplimiento comprobado de cualquiera de las partes dará lugar al resarcimiento de los daños y perjuicios que correspondan conforme a ley.',
    'Cuando por fuerza mayor o motivos coyunturales el evento no pueda realizarse en la fecha acordada, las partes podrán reprogramarlo de acuerdo con la disponibilidad de Centro de Eventos Lincoln.',
    `En conformidad con todas las cláusulas del presente contrato, las partes firman en fecha ${dateLong(doc.contractDate)} en señal de aceptación.`,
  ];
};

const normalizePricingGroups = ({ snapshot, selectedVariant, event, guestCount }) => {
  const snapshotGroups = Array.isArray(snapshot.pricingGroups) ? snapshot.pricingGroups : [];
  if (snapshotGroups.length) {
    return snapshotGroups
      .filter((group) => group?.selected !== false && number(group?.guestCount) > 0)
      .map((group, index) => ({
        id: text(group.id || group.variantId || `group-${index}`),
        variantId: text(group.variantId || group.id),
        name: text(group.name || group.variantName || `Grupo ${index + 1}`).toUpperCase(),
        guestCount: number(group.guestCount),
        pricePerPersonBs: number(group.pricePerPersonBs),
      }));
  }
  return [{
    id: text(selectedVariant.id || 'base'),
    variantId: text(selectedVariant.id || event?.packageVariantId || 'base'),
    name: text(selectedVariant.name || event?.packageVariantName || 'PAQUETE').toUpperCase(),
    guestCount,
    pricePerPersonBs: number(snapshot.pricePerPersonBs ?? event?.packagePricePerPersonBs ?? selectedVariant.pricePerPersonBs),
  }];
};

export const normalizeLincolnContractDocument = (event) => {
  const snapshot = event?.contractDocumentSnapshot && typeof event.contractDocumentSnapshot === 'object'
    ? event.contractDocumentSnapshot : {};
  const packageSnapshot = event?.packageSnapshot && typeof event.packageSnapshot === 'object'
    ? event.packageSnapshot : {};
  const selectedVariant = packageSnapshot.selectedVariant && typeof packageSnapshot.selectedVariant === 'object'
    ? packageSnapshot.selectedVariant : {};
  const services = Array.isArray(snapshot.services)
    ? snapshot.services.filter((line) => line?.selected !== false)
    : (Array.isArray(packageSnapshot.serviceLines)
      ? packageSnapshot.serviceLines.filter((line) => line?.included !== false && line?.catalogKind !== 'extra') : []);
  const extras = Array.isArray(snapshot.extras) ? snapshot.extras.filter((line) => line?.selected) : [];
  const fallbackGuestCount = number(snapshot.guestCount ?? event?.guestCount);
  const pricingGroups = normalizePricingGroups({ snapshot, selectedVariant, event, guestCount: fallbackGuestCount });
  const guestCount = pricingGroups.reduce((sum, group) => sum + number(group.guestCount), 0) || fallbackGuestCount;
  const grossBaseBs = pricingGroups.reduce((sum, group) => sum + number(group.guestCount) * number(group.pricePerPersonBs), 0);
  const extrasBs = extras.reduce((total, line) => {
    const quantity = Math.max(1, number(line?.quantity) || 1);
    return total + (line?.costMode === 'per_person'
      ? number(line?.unitCostBs) * guestCount * quantity
      : number(line?.unitCostBs) * quantity);
  }, 0);
  const discountPercent = number(snapshot.discountPercent);
  const discountBs = roundMoney((grossBaseBs + extrasBs) * discountPercent / 100);
  const totalBs = roundMoney(Math.max(0, grossBaseBs + extrasBs - discountBs));
  const advanceBs = number(snapshot.advanceBs ?? event?.reservationPaymentBs)
    + (snapshot.advanceBs == null ? number(event?.accountPaymentBs) : 0);
  const balanceBs = roundMoney(Math.max(0, totalBs - advanceBs));
  const doc = {
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
    packageVariants: Array.isArray(snapshot.packageVariants) ? snapshot.packageVariants : (Array.isArray(packageSnapshot.variants) ? packageSnapshot.variants : []),
    pricingGroups,
    services,
    extras,
    discountPercent,
    advanceBs,
    guaranteeBs: number(snapshot.guaranteeBs ?? event?.guaranteeBs),
    balanceDueDays: number(snapshot.balanceDueDays ?? 7),
    notes: snapshot.notes || event?.notes || '',
    totals: { baseBs: grossBaseBs, extrasBs, discountBs, totalBs, balanceBs },
  };
  return { ...doc, clauses: Array.isArray(snapshot.clauses) && snapshot.clauses.length ? snapshot.clauses : defaultClauses(doc) };
};

const clauseNames = ['PRIMERA', 'SEGUNDA', 'TERCERA', 'CUARTA', 'QUINTA', 'SEXTA', 'SÉPTIMA', 'OCTAVA', 'NOVENA', 'DÉCIMA'];
const serviceApplies = (line, group) => {
  const ids = Array.isArray(line?.variantIds) ? line.variantIds.map(text) : [];
  return !ids.length || ids.includes(text(group?.variantId));
};
const lincolnLogo = `<div class="logo-mark"><svg viewBox="0 0 180 28" aria-hidden="true"><path d="M24 21h132M42 18h96M55 14h70M66 10h48M76 6h28"/><path d="M34 21V17m112 4v-4M58 18v-8m64 8v-8M72 14V6m36 8V6"/></svg></div><small>CENTRO DE EVENTOS</small><h1>LINCOLN</h1>`;

export const buildLincolnContractDocumentHtml = ({ event }) => {
  const doc = normalizeLincolnContractDocument(event);
  const groups = doc.pricingGroups.length ? doc.pricingGroups : [{ name: doc.packageVariantName || 'PAQUETE', variantId: '', guestCount: doc.guestCount, pricePerPersonBs: 0 }];
  const categories = doc.services.reduce((result, line) => {
    const category = text(line?.category || 'OTROS').toUpperCase();
    (result[category] ||= []).push(line);
    return result;
  }, {});
  const matrixRows = Object.entries(categories).map(([category, lines]) => `<tr class="category"><th colspan="${groups.length + 1}">${escapeHtml(category)}</th></tr>${lines.map((line) => `<tr><td>${escapeHtml(line?.description || line?.name || 'Servicio')}</td>${groups.map((group) => `<td class="check">${serviceApplies(line, group) ? '&#10003;' : ''}</td>`).join('')}</tr>`).join('')}`).join('');
  const extraRows = doc.extras.map((line) => {
    const quantity = Math.max(1, number(line?.quantity) || 1);
    const value = line?.costMode === 'per_person' ? `${money(line?.unitCostBs)} / persona` : money(number(line?.unitCostBs) * quantity);
    return `<tr><td>${escapeHtml(line?.description || line?.name || 'Servicio adicional')}</td><td>${escapeHtml(quantity)}</td><td>${escapeHtml(value)}</td></tr>`;
  }).join('');
  const clauseRows = doc.clauses.map((clause, index) => `<li><b>${clauseNames[index] || `CLÁUSULA ${index + 1}`}.-</b> ${escapeHtml(clause)}</li>`).join('');
  const contractorNames = [doc.contractor1Name, doc.contractor2Name].filter(Boolean).join(' / ');
  const contractorPhones = [doc.contractor1Phone, doc.contractor2Phone].filter(Boolean).join(' / ');
  const contractorCis = [doc.contractor1Ci, doc.contractor2Ci].filter(Boolean).join(' / ');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>${escapeHtml(doc.contractCode || 'Contrato Lincoln')}</title><style>
  @page{size:Letter portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#211b1c;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:216mm;height:279mm;padding:0 15mm 13mm;break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid;position:relative;overflow:hidden}.page:last-child{break-after:auto;page-break-after:auto}
  .brandbar{height:31mm;margin:0 -15mm 8mm;padding:5mm 15mm;display:grid;grid-template-columns:1fr 1.12fr;gap:10mm;align-items:center;background:linear-gradient(100deg,#a61927,#7b1520);color:#fff;border-bottom:2mm solid #24504d}.brand{display:grid;place-items:center}.brand .logo-mark{width:48mm;height:7mm}.brand svg{width:100%;height:100%;fill:none;stroke:#fff;stroke-width:1}.brand small{font-size:6.4pt;letter-spacing:.38em}.brand h1{margin:.5mm 0 0;font-family:Georgia,serif;font-size:24pt;line-height:1;letter-spacing:.12em}.contact{padding-left:8mm;border-left:.3mm solid rgba(255,255,255,.35);font-size:8pt;line-height:1.5}.contact b{display:block;font-size:9pt}.doc-meta{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:4mm}.doc-meta h2{margin:0;color:#5c1720;font-family:Georgia,serif;font-size:15pt;font-weight:500;letter-spacing:.03em}.doc-meta div{text-align:right}.doc-meta strong{display:block;color:#24504d;font-size:10pt}.doc-meta span{font-size:7pt;color:#706461}
  .facts{width:100%;border-collapse:collapse;margin-bottom:4mm;font-size:8pt}.facts td{width:50%;padding:2.2mm 2.6mm;border:.28mm solid #776d6b;vertical-align:top}.facts span{display:block;color:#8d1722;font-size:6.2pt;font-weight:800;text-transform:uppercase}.facts b{display:block;margin-top:.6mm;font-size:8.6pt}.facts small{display:block;margin-top:.6mm;color:#625957;font-size:7pt}.intro{margin:3.5mm 0 2.5mm;font-family:Georgia,serif;font-size:8.3pt;line-height:1.45;text-align:justify}.clauses{margin:0;padding-left:5mm;font-family:Georgia,serif;font-size:7.8pt;line-height:1.4;text-align:justify}.clauses li{margin-bottom:1.5mm}.clauses b{color:#75151f}.financial-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:1.5mm;margin-top:4mm}.financial-strip div{padding:2.2mm;border:1px solid #e1d4cf;background:#faf6f3}.financial-strip span{display:block;color:#7e706c;font-size:5.8pt;text-transform:uppercase}.financial-strip b{display:block;margin-top:.7mm;color:#24504d;font-size:8pt}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:10mm;margin-top:13mm;text-align:center}.signature{padding-top:2mm;border-top:.25mm solid #443a38;font-size:7.2pt}.signature b{display:block}.signature small{display:block;margin-top:.8mm;color:#746865}.footer{position:absolute;left:15mm;right:15mm;bottom:6mm;display:flex;justify-content:space-between;border-top:.25mm solid #e3d7d2;padding-top:1.7mm;color:#8d7e79;font-size:6pt}
  .is-annex .brandbar{height:22mm;margin-bottom:4mm;padding-top:3mm;padding-bottom:3mm}.is-annex .brand .logo-mark{height:5mm}.is-annex .brand h1{font-size:19pt}.is-annex .contact{font-size:7pt}.annex-title{margin:0 0 2mm;text-align:center;color:#5e1720;font-size:12pt}.package-head{display:grid;grid-template-columns:1.4fr .7fr .7fr;gap:1.2mm;margin-bottom:2mm}.package-head div{padding:1.6mm 2mm;border:1px solid #ddcfca;background:#faf7f5}.package-head span{display:block;color:#8b7873;font-size:5.4pt;text-transform:uppercase}.package-head b{display:block;margin-top:.4mm;font-size:7.2pt}.matrix{width:100%;border-collapse:collapse;font-size:6pt}.matrix th,.matrix td{padding:.72mm 1.3mm;border:.25mm solid #807674}.matrix thead th{background:#24504d;color:#fff;font-size:6.1pt;text-transform:uppercase}.matrix thead th:first-child{width:68%;text-align:left}.matrix .category th{padding:.7mm;background:#9b1b27;color:#fff;text-align:center;letter-spacing:.04em}.matrix .check{width:16%;color:#a61927;font-size:8.5pt;font-weight:900;text-align:center}.matrix .cost td{background:#f2ece8;font-weight:800}.extras{margin-top:2mm}.extras h3{margin:0;padding:1mm 2mm;background:#9b1b27;color:#fff;font-size:6.4pt;text-align:center}.extras table{width:100%;border-collapse:collapse;font-size:6pt}.extras td{padding:.72mm 1.3mm;border:.25mm solid #807674}.extras td:nth-child(2){width:12%;text-align:center}.extras td:last-child{width:22%;text-align:right}.totals{width:86mm;margin:2mm 0 0 auto;border:.25mm solid #796e6b}.totals div{display:flex;justify-content:space-between;padding:.9mm 1.7mm;border-bottom:.25mm solid #ded2cd;font-size:6.4pt}.totals div:last-child{border-bottom:0}.totals .total{background:#9b1b27;color:#fff;font-size:7.2pt;font-weight:900}.totals .balance{background:#e7f2ef;color:#24504d;font-weight:900}.notes{margin-top:2mm;padding:1.4mm 1.8mm;border:1px solid #ddcfca;font-size:6pt}.notes b{display:block;margin-bottom:.5mm;color:#7f1721}.is-annex .signatures{margin-top:8mm}
  </style></head><body>
  <section class="page"><header class="brandbar"><div class="brand">${lincolnLogo}</div><div class="contact"><b>Calle Pachamama #2250 y Waldo Ballivián</b>Teléfono: 77922727<br/>Cochabamba - Bolivia</div></header><div class="doc-meta"><h2>CONTRATO DE SERVICIOS</h2><div><strong>${escapeHtml(doc.contractCode || 'CONTRATO')}</strong><span>${dateLabel(doc.contractDate)}</span></div></div>
  <table class="facts"><tr><td><span>Nombre de los contratantes</span><b>${escapeHtml(contractorNames || '-')}</b><small>C.I.: ${escapeHtml(contractorCis || '-')}</small></td><td><span>Teléfonos</span><b>${escapeHtml(contractorPhones || '-')}</b><small>Contacto para coordinación</small></td></tr><tr><td><span>Tipo de evento</span><b>${escapeHtml(doc.eventType || '-')}</b></td><td><span>Duración del evento</span><b>${escapeHtml(doc.durationHours)} horas - Inicio ${escapeHtml(doc.startTime || 'por definir')}</b></td></tr><tr><td><span>Fecha del evento</span><b>${dateLong(doc.eventDate)}</b></td><td><span>Salón</span><b>${escapeHtml(doc.roomName || '-')}</b></td></tr></table>
  <p class="intro">Conste por el presente documento privado, con valor legal mediante el reconocimiento de firmas ante autoridad competente, suscrito entre la Sra. <b>BASILIA HERBAS SAHONERO, C.I. 3131436 Cbba.</b>, por Centro de Eventos LINCOLN, y los contratantes identificados precedentemente, bajo las siguientes cláusulas:</p><ol class="clauses">${clauseRows}</ol>
  <div class="financial-strip"><div><span>Total contrato</span><b>${escapeHtml(money(doc.totals.totalBs))}</b></div><div><span>Anticipo / a cuenta</span><b>${escapeHtml(money(doc.advanceBs))}</b></div><div><span>Garantía separada</span><b>${escapeHtml(money(doc.guaranteeBs))}</b></div><div><span>Saldo</span><b>${escapeHtml(money(doc.totals.balanceBs))}</b></div></div>
  <div class="signatures"><div class="signature"><b>BASILIA HERBAS SAHONERO</b><small>Administradora - Centro de Eventos Lincoln</small></div><div class="signature"><b>${escapeHtml(doc.contractor1Name || 'CONTRATANTE 1')}</b><small>Contratante</small></div><div class="signature"><b>${escapeHtml(doc.contractor2Name || 'CONTRATANTE 2')}</b><small>Contratante</small></div></div><div class="footer"><span>Centro de Eventos Lincoln - Documento generado por el sistema</span><span>Página 1 de 2 - ${escapeHtml(doc.contractCode)}</span></div></section>
  <section class="page is-annex"><header class="brandbar"><div class="brand">${lincolnLogo}</div><div class="contact"><b>Calle Pachamama #2250 y Waldo Ballivián</b>Teléfono: 77922727<br/>Cochabamba - Bolivia</div></header><h2 class="annex-title">HOJA DE COSTOS Y SERVICIOS</h2><div class="package-head"><div><span>Paquete</span><b>${escapeHtml(doc.packageName || 'SIN PAQUETE')}</b></div><div><span>Evento</span><b>${escapeHtml(doc.eventType || '-')}</b></div><div><span>Invitados</span><b>${escapeHtml(doc.guestCount)}</b></div></div>
  <table class="matrix"><thead><tr><th>Servicios incluidos</th>${groups.map((group) => `<th>${escapeHtml(group.name)}</th>`).join('')}</tr></thead><tbody>${matrixRows}<tr class="cost"><td>COSTO POR PERSONA</td>${groups.map((group) => `<td>${escapeHtml(money(group.pricePerPersonBs))}</td>`).join('')}</tr><tr class="cost"><td>CANTIDAD DE INVITADOS</td>${groups.map((group) => `<td>${escapeHtml(group.guestCount)}</td>`).join('')}</tr><tr class="cost"><td>SUBTOTAL</td>${groups.map((group) => `<td>${escapeHtml(money(number(group.guestCount) * number(group.pricePerPersonBs)))}</td>`).join('')}</tr></tbody></table>
  ${extraRows ? `<section class="extras"><h3>SERVICIOS EXTRAS CONTRATADOS</h3><table><tbody>${extraRows}</tbody></table></section>` : ''}<section class="totals"><div><span>Paquete base</span><strong>${escapeHtml(money(doc.totals.baseBs))}</strong></div>${doc.totals.extrasBs > 0 ? `<div><span>Extras</span><strong>${escapeHtml(money(doc.totals.extrasBs))}</strong></div>` : ''}${doc.totals.discountBs > 0 ? `<div><span>Descuento (${escapeHtml(doc.discountPercent)}%)</span><strong>- ${escapeHtml(money(doc.totals.discountBs))}</strong></div>` : ''}<div class="total"><span>COSTO TOTAL</span><strong>${escapeHtml(money(doc.totals.totalBs))}</strong></div><div><span>A cuenta</span><strong>- ${escapeHtml(money(doc.advanceBs))}</strong></div><div><span>Garantía separada</span><strong>${escapeHtml(money(doc.guaranteeBs))}</strong></div><div class="balance"><span>SALDO TOTAL</span><strong>${escapeHtml(money(doc.totals.balanceBs))}</strong></div></section>${doc.notes ? `<section class="notes"><b>OBSERVACIONES Y ACUERDOS</b><div>${escapeHtml(doc.notes)}</div></section>` : ''}<div class="signatures"><div class="signature"><b>${escapeHtml(doc.contractor1Name || 'CONTRATANTE 1')}</b><small>Contratante</small></div><div class="signature"><b>${escapeHtml(doc.contractor2Name || 'CONTRATANTE 2')}</b><small>Contratante</small></div><div class="signature"><b>BASILIA HERBAS SAHONERO</b><small>Administradora</small></div></div><div class="footer"><span>Hoja de costos - parte integrante del contrato</span><span>Página 2 de 2 - ${escapeHtml(doc.contractCode)}</span></div></section></body></html>`;
};

export const buildLincolnContractPdfFileName = (event) => {
  const code = text(event?.contractCode || event?.code || 'CONTRATO-LINCOLN');
  const client = text(event?.contractor1Name || event?.clientName || 'CLIENTE');
  return `${code}-${client}-contrato`;
};
