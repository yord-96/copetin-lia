import { organizerTotals, organizerClauses } from '../../../shared/lincolnOrganizerContract.js';
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
const dateShort = (value) => {
  const raw = text(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (raw || '-');
};

const PAYMENT_LABELS = {
  deposit: 'PAGO',
  advance: 'ANTICIPO',
  installment: 'A CUENTA',
  balance: 'SALDO',
  guarantee: 'GARANTÍA',
  replacement: 'REPOSICIÓN',
};
const paymentServiceAllocation = (payment = {}) => {
  if (payment?.serviceAllocationBs !== undefined && payment?.serviceAllocationBs !== null && payment?.serviceAllocationBs !== '') {
    return roundMoney(payment.serviceAllocationBs);
  }
  return ['advance', 'installment', 'balance'].includes(text(payment?.type).toLowerCase())
    ? roundMoney(payment?.amountBs) : 0;
};
const paymentGuaranteeAllocation = (payment = {}) => {
  if (payment?.guaranteeAllocationBs !== undefined && payment?.guaranteeAllocationBs !== null && payment?.guaranteeAllocationBs !== '') {
    return roundMoney(payment.guaranteeAllocationBs);
  }
  return text(payment?.type).toLowerCase() === 'guarantee' ? roundMoney(payment?.amountBs) : 0;
};
const normalizeDocumentPayments = (rows, serviceTotalBs) => {
  if (!Array.isArray(rows)) return [];
  let serviceBalanceBs = roundMoney(serviceTotalBs);
  return [...rows]
    .filter((row) => row && !row.voidedAt)
    .sort((a, b) => {
      const left = `${text(a.date)}T${text(a.createdAt)}`;
      const right = `${text(b.date)}T${text(b.createdAt)}`;
      return left.localeCompare(right);
    })
    .map((row) => {
      const serviceAllocationBs = paymentServiceAllocation(row);
      const guaranteeAllocationBs = paymentGuaranteeAllocation(row);
      serviceBalanceBs = roundMoney(Math.max(0, serviceBalanceBs - serviceAllocationBs));
      return {
        id: text(row.id),
        date: text(row.date || row.createdAt).slice(0, 10),
        type: text(row.type).toLowerCase(),
        concept: text(row.description || row.concept || PAYMENT_LABELS[text(row.type).toLowerCase()] || 'PAGO'),
        receiptCode: text(row.receiptCode),
        amountBs: roundMoney(row.amountBs),
        serviceAllocationBs,
        guaranteeAllocationBs,
        serviceBalanceBs,
      };
    });
};

const defaultClauses = (doc) => {
  if (doc.contractType === 'organizer') return organizerClauses(doc);
  const groupLabel = doc.pricingGroups.map((group) => `${group.name}: ${money(group.pricePerPersonBs)} por persona`).join('; ');
  return [
    `Centro de Eventos LINCOLN prestará el servicio de atención para el evento ${text(doc.eventType) || 'programado'}, a realizarse el ${dateLong(doc.eventDate)} en ${text(doc.roomName) || 'el salón acordado'}.`,
    'Los servicios incluidos se encuentran detallados en la hoja de costos y servicios, que forma parte integrante e indivisible del presente contrato.',
    `El costo del servicio se determina para ${number(doc.guestCount)} invitados${groupLabel ? `, bajo la siguiente composición: ${groupLabel}` : ''}. Los importes pactados quedan congelados para este contrato, salvo cambios solicitados por escrito.`,
    `Los contratantes reconocen como anticipo y pagos a cuenta la suma de ${money(doc.advanceBs)}. El saldo deberá ser cancelado ${number(doc.balanceDueDays) || 7} días antes del evento, salvo acuerdo escrito diferente.`,
    'En caso de suspensión por decisión de los contratantes, se aplicarán las condiciones de devolución o penalidad expresamente acordadas. Toda modificación o reprogramación deberá constar por escrito.',
    `Los contratantes se obligan a resarcir los daños ocasionados por ellos o sus invitados en instalaciones, mobiliario, mantelería, vajilla, cristalería y demás bienes. La garantía separada es de ${money(doc.guaranteeBs)} y al momento de emitir este contrato figura como ${doc.guaranteeStatus === 'paid' ? 'PAGADA' : 'PENDIENTE DE PAGO'}. Será devuelta cuando corresponda, previa verificación de obligaciones pendientes.`,
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
  const isOrganizer = (snapshot.contractType || event?.contractType) === 'organizer';
  const organizerDays = snapshot.organizerDays || event?.organizerDays || [];
  const rentalTotals = isOrganizer ? organizerTotals({ ...snapshot, organizerDays, extras }) : null;
  const pricingGroups = normalizePricingGroups({ snapshot, selectedVariant, event, guestCount: fallbackGuestCount });
  const guestCount = rentalTotals?.guestCount ?? (pricingGroups.reduce((sum, group) => sum + number(group.guestCount), 0) || fallbackGuestCount);
  const grossBaseBs = rentalTotals?.baseBs ?? pricingGroups.reduce((sum, group) => sum + number(group.guestCount) * number(group.pricePerPersonBs), 0);
  const extrasBs = rentalTotals?.extrasBs ?? extras.reduce((total, line) => {
    const quantity = line.custom ? number(line.quantity ?? 1) : Math.max(1, number(line?.quantity) || 1);
    const assignedIds = Array.isArray(line?.variantIds) ? line.variantIds.map(text) : [];
    const applicableGuestCount = assignedIds.length
      ? pricingGroups.filter((group) => assignedIds.includes(text(group.variantId))).reduce((sum, group) => sum + number(group.guestCount), 0)
      : guestCount;
    return total + (line?.costMode === 'per_person'
      ? number(line?.unitCostBs) * applicableGuestCount * quantity
      : number(line?.unitCostBs) * quantity);
  }, 0);
  const discountPercent = number(snapshot.discountPercent);
  const discountBs = roundMoney((grossBaseBs + extrasBs) * discountPercent / 100);
  const totalBs = roundMoney(Math.max(0, grossBaseBs + extrasBs - discountBs));
  const snapshotAdvanceBs = number(snapshot.advanceBs ?? event?.reservationPaymentBs)
    + (snapshot.advanceBs == null ? number(event?.accountPaymentBs) : 0);
  const economicMovements = normalizeDocumentPayments(event?.documentPayments, totalBs);
  const hasLiveEconomicMovements = Array.isArray(event?.documentPayments);
  const servicePaidBs = hasLiveEconomicMovements
    ? roundMoney(economicMovements.reduce((sum, row) => sum + row.serviceAllocationBs, 0))
    : roundMoney(snapshotAdvanceBs);
  const advanceBs = servicePaidBs;
  const balanceBs = roundMoney(Math.max(0, totalBs - servicePaidBs));
  const guaranteeBs = number(snapshot.guaranteeBs ?? event?.guaranteeBs);
  const guaranteePaidBs = hasLiveEconomicMovements
    ? roundMoney(economicMovements.reduce((sum, row) => sum + row.guaranteeAllocationBs, 0))
    : (text(snapshot.guaranteeStatus ?? event?.guaranteeStatus ?? 'due').toLowerCase() === 'paid' ? guaranteeBs : 0);
  const guaranteePendingBs = roundMoney(Math.max(0, guaranteeBs - guaranteePaidBs));
  const guaranteeStatus = guaranteeBs > 0 && guaranteePendingBs <= 0.009 ? 'paid' : 'due';
  const totalPendingBs = roundMoney(balanceBs + guaranteePendingBs);
  const doc = {
    ...snapshot, contractType: isOrganizer ? 'organizer' : 'standard', organizerDays,
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
    pricingGroups: isOrganizer ? [] : pricingGroups,
    services: isOrganizer ? [] : services,
    extras,
    discountPercent,
    advanceBs,
    guaranteeBs,
    guaranteeStatus,
    guaranteeMethod: text(snapshot.guaranteeMethod || snapshot.advanceMethod || 'cash'),
    guaranteeDestination: text(snapshot.guaranteeDestination || snapshot.advanceDestination || 'CAJA CHICA'),
    balanceDueDays: number(snapshot.balanceDueDays ?? 7),
    notes: snapshot.notes || event?.notes || '',
    economicMovements,
    servicePaidBs,
    guaranteePaidBs,
    totals: { baseBs: grossBaseBs, extrasBs, discountBs, totalBs, balanceBs, guaranteePendingBs, totalPendingBs },
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
  const isOrganizer = doc.contractType === 'organizer';
  const rentalRows = (doc.organizerDays || []).map((day,index) => `<tr><td>Jornada ${index + 1} - ${escapeHtml(day.date)} - ${escapeHtml(day.roomName)}</td><td>${escapeHtml(day.guestCount)} personas</td><td>${escapeHtml(money(day.amountBs))}</td></tr>`).join('');
  const groups = doc.pricingGroups.length ? doc.pricingGroups : [{ name: doc.packageVariantName || 'PAQUETE', variantId: '', guestCount: doc.guestCount, pricePerPersonBs: 0 }];
  const categories = doc.services.reduce((result, line) => {
    const category = text(line?.category || 'OTROS').toUpperCase();
    (result[category] ||= []).push(line);
    return result;
  }, {});
  const matrixRows = Object.entries(categories).map(([category, lines]) => `<tr class="category"><th colspan="${groups.length + 1}">${escapeHtml(category)}</th></tr>${lines.map((line) => `<tr><td>${escapeHtml(line?.description || line?.name || 'Servicio')}</td>${groups.map((group) => `<td class="check">${serviceApplies(line, group) ? '&#10003;' : ''}</td>`).join('')}</tr>`).join('')}`).join('');
  const extraRows = doc.extras.map((line) => {
    const quantity = (isOrganizer || line.custom) ? number(line?.quantity ?? 1) : Math.max(1, number(line?.quantity) || 1);
    const value = !isOrganizer && line?.costMode === 'per_person' ? `${money(line?.unitCostBs)} / persona` : money(number(line?.unitCostBs) * quantity);
    const applicableGroups = groups.filter((group) => serviceApplies(line, group));
    const scope = isOrganizer ? `${({rental:'ALQUILER',sale:'VENTA',service:'SERVICIO'})[line.kind] || 'EXTRA'} - ${line.dayId ? `JORNADA ${doc.organizerDays.findIndex(day => day.id === line.dayId) + 1}` : 'TODO EL EVENTO'} - ${money(line.unitCostBs)} / unidad` : line.custom ? `${quantity} x ${money(line.unitCostBs)} / unidad` : applicableGroups.length === groups.length ? 'TODO EL EVENTO' : applicableGroups.map((group) => group.name).join(' + ');
    return `<tr><td>${escapeHtml(line?.description || line?.name || 'Servicio adicional')}<small>${escapeHtml(scope)}</small></td><td>${escapeHtml(quantity)}</td><td>${escapeHtml(value)}</td></tr>`;
  }).join('');
  const clauseRows = doc.clauses.map((clause, index) => `<li><b>${clauseNames[index] || `CLÁUSULA ${index + 1}`}.-</b> ${escapeHtml(clause)}</li>`).join('');
  const movementRows = doc.economicMovements.map((movement) => `<tr><td>${escapeHtml(dateShort(movement.date))}</td><td><b>${escapeHtml(movement.concept || PAYMENT_LABELS[movement.type] || 'PAGO')}</b>${movement.receiptCode ? `<small>RECIBO ${escapeHtml(movement.receiptCode)}</small>` : ''}</td><td>${escapeHtml(money(movement.amountBs))}</td></tr>`).join('');
  const settlementMarkup = `${movementRows ? `<section class="movements"><h3>MOVIMIENTO ECONÓMICO DEL CONTRATO</h3><table><thead><tr><th>FECHA</th><th>CONCEPTO / RECIBO</th><th>MONTO</th></tr></thead><tbody>${movementRows}</tbody></table></section>` : ''}<section class="totals"><div><span>${isOrganizer ? 'Alquiler del salón' : 'Paquete base'}</span><strong>${escapeHtml(money(doc.totals.baseBs))}</strong></div>${doc.totals.extrasBs > 0 ? `<div><span>Extras</span><strong>${escapeHtml(money(doc.totals.extrasBs))}</strong></div>` : ''}${doc.totals.discountBs > 0 ? `<div><span>Descuento (${escapeHtml(doc.discountPercent)}%)</span><strong>- ${escapeHtml(money(doc.totals.discountBs))}</strong></div>` : ''}<div class="total"><span>COSTO TOTAL</span><strong>${escapeHtml(money(doc.totals.totalBs))}</strong></div><div><span>TOTAL PAGADO SERVICIO</span><strong>- ${escapeHtml(money(doc.servicePaidBs))}</strong></div><div><span>SALDO DEL SERVICIO</span><strong>${escapeHtml(money(doc.totals.balanceBs))}</strong></div><div><span>GARANTÍA</span><strong>${escapeHtml(money(doc.guaranteeBs))}</strong></div><div><span>ESTADO GARANTÍA</span><strong>${doc.guaranteeStatus === 'paid' ? 'PAGADO' : 'DEBE'}</strong></div><div class="balance"><span>TOTAL PENDIENTE</span><strong>${escapeHtml(money(doc.totals.totalPendingBs))}</strong></div></section>${doc.notes ? `<section class="notes"><b>OBSERVACIONES Y ACUERDOS</b><div>${escapeHtml(doc.notes)}</div></section>` : ''}`;
  const contractorNames = [doc.contractor1Name, doc.contractor2Name].filter(Boolean).join(' / ');
  const contractorPhones = [doc.contractor1Phone, doc.contractor2Phone].filter(Boolean).join(' / ');
  const contractorCis = [doc.contractor1Ci, doc.contractor2Ci].filter(Boolean).join(' / ');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>${escapeHtml(doc.contractCode || 'Contrato Lincoln')}</title><style>
  @page{size:Letter portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#211b1c;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:216mm;height:279mm;padding:0 15mm 13mm;break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid;position:relative;overflow:hidden}.page:last-child{break-after:auto;page-break-after:auto}
  .brandbar{height:31mm;margin:0 -15mm 8mm;padding:5mm 15mm;display:grid;grid-template-columns:1fr 1.12fr;gap:10mm;align-items:center;background:linear-gradient(100deg,#a61927,#7b1520);color:#fff;border-bottom:2mm solid #24504d}.brand{display:grid;place-items:center}.brand .logo-mark{width:48mm;height:7mm}.brand svg{width:100%;height:100%;fill:none;stroke:#fff;stroke-width:1}.brand small{font-size:6.4pt;letter-spacing:.38em}.brand h1{margin:.5mm 0 0;font-family:Georgia,serif;font-size:24pt;line-height:1;letter-spacing:.12em}.contact{padding-left:8mm;border-left:.3mm solid rgba(255,255,255,.35);font-size:8pt;line-height:1.5}.contact b{display:block;font-size:9pt}.doc-meta{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:4mm}.doc-meta h2{margin:0;color:#5c1720;font-family:Georgia,serif;font-size:15pt;font-weight:500;letter-spacing:.03em}.doc-meta div{text-align:right}.doc-meta strong{display:block;color:#24504d;font-size:10pt}.doc-meta span{font-size:7pt;color:#706461}
  .facts{width:100%;border-collapse:collapse;margin-bottom:4mm;font-size:8pt}.facts td{width:50%;padding:2.2mm 2.6mm;border:.28mm solid #776d6b;vertical-align:top}.facts span{display:block;color:#8d1722;font-size:6.2pt;font-weight:800;text-transform:uppercase}.facts b{display:block;margin-top:.6mm;font-size:8.6pt}.facts small{display:block;margin-top:.6mm;color:#625957;font-size:7pt}.intro{margin:3.5mm 0 2.5mm;font-family:Georgia,serif;font-size:8.3pt;line-height:1.45;text-align:justify}.clauses{margin:0;padding-left:5mm;font-family:Georgia,serif;font-size:7.8pt;line-height:1.4;text-align:justify}.clauses li{margin-bottom:1.5mm}.clauses b{color:#75151f}.financial-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:1.5mm;margin-top:4mm}.financial-strip div{padding:2.2mm;border:1px solid #e1d4cf;background:#faf6f3}.financial-strip span{display:block;color:#7e706c;font-size:5.8pt;text-transform:uppercase}.financial-strip b{display:block;margin-top:.7mm;color:#24504d;font-size:8pt}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:10mm;margin-top:13mm;text-align:center}.signature{padding-top:2mm;border-top:.25mm solid #443a38;font-size:7.2pt}.signature b{display:block}.signature small{display:block;margin-top:.8mm;color:#746865}.footer{position:absolute;left:15mm;right:15mm;bottom:6mm;display:flex;justify-content:space-between;border-top:.25mm solid #e3d7d2;padding-top:1.7mm;color:#8d7e79;font-size:6pt}
  .is-annex .brandbar{height:22mm;margin-bottom:4mm;padding-top:3mm;padding-bottom:3mm}.is-annex .brand .logo-mark{height:5mm}.is-annex .brand h1{font-size:19pt}.is-annex .contact{font-size:7pt}.annex-title{margin:0 0 2mm;text-align:center;color:#5e1720;font-size:12pt}.package-head{display:grid;grid-template-columns:1.4fr .7fr .7fr;gap:1.2mm;margin-bottom:2mm}.package-head div{padding:1.6mm 2mm;border:1px solid #ddcfca;background:#faf7f5}.package-head span{display:block;color:#8b7873;font-size:5.4pt;text-transform:uppercase}.package-head b{display:block;margin-top:.4mm;font-size:7.2pt}.matrix{width:100%;border-collapse:collapse;font-size:6pt}.matrix th,.matrix td{padding:.72mm 1.3mm;border:.25mm solid #807674}.matrix thead th{background:#24504d;color:#fff;font-size:6.1pt;text-transform:uppercase}.matrix thead th:first-child{width:68%;text-align:left}.matrix .category th{padding:.7mm;background:#9b1b27;color:#fff;text-align:center;letter-spacing:.04em}.matrix .check{width:16%;color:#a61927;font-size:8.5pt;font-weight:900;text-align:center}.matrix .cost td{background:#f2ece8;font-weight:800}.extras{margin-top:2mm}.extras h3{margin:0;padding:1mm 2mm;background:#9b1b27;color:#fff;font-size:6.4pt;text-align:center}.extras table{width:100%;border-collapse:collapse;font-size:6pt}.extras td{padding:.72mm 1.3mm;border:.25mm solid #807674}.extras td small{display:block;margin-top:.35mm;color:#8d1722;font-size:5pt;font-weight:800}.extras td:nth-child(2){width:12%;text-align:center}.extras td:last-child{width:22%;text-align:right}.movements{margin-top:1.4mm}.movements h3{margin:0;padding:.8mm 1.5mm;background:#24504d;color:#fff;font-size:8.2pt;text-align:center}.movements table{width:100%;border-collapse:collapse;font-size:7.7pt}.movements th,.movements td{padding:.55mm 1.1mm;border:.25mm solid #807674}.movements th{background:#eef4f2;color:#24504d;text-transform:uppercase;font-size:7pt}.movements td:nth-child(1){width:20%}.movements td:nth-child(3){width:20%;text-align:right;font-weight:700}.movements td small{display:block;margin-top:.15mm;color:#786d69;font-size:6.3pt}.totals{width:86mm;margin:2mm 0 0 auto;border:.25mm solid #796e6b}.totals div{display:flex;justify-content:space-between;padding:.9mm 1.7mm;border-bottom:.25mm solid #ded2cd;font-size:6.4pt}.totals div:last-child{border-bottom:0}.totals .total{background:#9b1b27;color:#fff;font-size:7.2pt;font-weight:900}.totals .balance{background:#e7f2ef;color:#24504d;font-weight:900}.notes{margin-top:2mm;padding:1.4mm 1.8mm;border:1px solid #ddcfca;font-size:6pt}.notes b{display:block;margin-bottom:.5mm;color:#7f1721}.is-annex .signatures{margin-top:8mm}
  .page{height:auto;min-height:279mm;overflow:visible;break-inside:auto;page-break-inside:auto}.footer{position:static;margin-top:8mm}.matrix thead{display:table-header-group}.matrix tr,.extras tr,.movements tr,.signatures,.totals,.financial-strip,.package-head,.notes{break-inside:avoid;page-break-inside:avoid}.matrix td,.matrix th,.extras td{overflow-wrap:anywhere}.clauses li{break-inside:avoid;page-break-inside:avoid;orphans:3;widows:3}.matrix,.extras table{font-size:9pt}.extras td small{font-size:7pt}.matrix th,.matrix td,.extras td{padding:.6mm 1.3mm}.doc-meta h2{font-size:15pt}.intro,.clauses{font-size:10.5pt;line-height:1.35}.clauses li{margin-bottom:1.2mm}.page:not(.is-annex) .brandbar{height:24mm;margin-bottom:4mm;padding-top:2mm;padding-bottom:2mm}.page:not(.is-annex) .brand .logo-mark{height:5mm}.facts td{padding:1.4mm 2mm}.signatures{margin-top:8mm}.footer{margin-top:4mm}.facts{font-size:10pt}.facts b{font-size:11pt}.facts span,.facts small{font-size:9pt}.package-head span{font-size:8pt}.package-head b{font-size:10pt}.matrix thead th,.extras h3{font-size:9pt}.totals div,.totals .total{font-size:10pt;padding:1.5mm 2mm}.financial-strip span{font-size:8pt}.financial-strip b{font-size:11pt}.signature{font-size:9pt}.footer{font-size:8pt}.notes{font-size:9pt}.is-annex{padding-bottom:8mm}.is-annex .brandbar{height:19mm;margin-bottom:2.5mm;padding-top:2mm;padding-bottom:2mm}.is-annex .brand h1{font-size:17pt}.is-annex .contact{font-size:6.6pt;line-height:1.35}.is-annex .annex-title{margin-bottom:1.3mm;font-size:11pt}.is-annex .package-head{margin-bottom:1.3mm}.is-annex .package-head div{padding:1.1mm 1.6mm}.is-annex .package-head span{font-size:7pt}.is-annex .package-head b{font-size:9pt}.is-annex .matrix,.is-annex .extras table{font-size:8.2pt}.is-annex .matrix thead th,.is-annex .extras h3{font-size:8.2pt}.is-annex .matrix th,.is-annex .matrix td,.is-annex .extras td{padding:.45mm 1.15mm;line-height:1.12}.is-annex .extras{margin-top:1.3mm}.is-annex .extras h3{padding:.7mm 1.5mm}.is-annex .extras td small{font-size:6.5pt;margin-top:.15mm}.is-annex .totals{margin-top:1.3mm}.is-annex .totals div,.is-annex .totals .total{font-size:9pt;padding:1mm 1.6mm}.is-annex .notes{margin-top:1.3mm;padding:1mm 1.5mm;font-size:8pt}.is-annex .signatures{margin-top:3mm}.is-annex .signature{font-size:8pt;padding-top:1.2mm}.is-annex .footer{margin-top:2mm;font-size:7pt;padding-top:1mm}
  /* Impresión robusta: las firmas existen únicamente en la hoja final. */
  .contract-page{height:279mm;min-height:279mm;overflow:hidden;padding-bottom:16mm}.contract-page .footer{position:absolute;left:15mm;right:15mm;bottom:6mm;margin-top:0}
  .is-annex{padding-bottom:12mm}.is-annex .footer{display:none}.is-annex .totals{margin-bottom:0}.is-annex .notes{margin-bottom:0}
  .signature-page{height:279mm;min-height:279mm;overflow:hidden;padding-bottom:18mm;break-before:page;page-break-before:always;break-after:auto;page-break-after:auto}.signature-page .brandbar{height:24mm;margin-bottom:10mm;padding-top:2mm;padding-bottom:2mm}.signature-page .signature-title{text-align:center;margin:0 auto;max-width:160mm}.signature-page .signature-title span{display:block;color:#8d1722;font-size:8pt;font-weight:800;letter-spacing:.12em}.signature-page .signature-title h2{margin:2mm 0 3mm;color:#5e1720;font-family:Georgia,serif;font-size:18pt}.signature-page .signature-title p{margin:0 auto;color:#4f4644;font-family:Georgia,serif;font-size:10pt;line-height:1.5;max-width:150mm}.signature-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm;margin:12mm 0 0}.signature-summary div{padding:3mm 3mm;border:1px solid #ddcfca;background:#faf7f5}.signature-summary span{display:block;color:#8b7873;font-size:7pt;text-transform:uppercase}.signature-summary b{display:block;margin-top:1mm;color:#24504d;font-size:10pt}.signature-area{display:grid;grid-template-columns:repeat(3,1fr);gap:12mm;margin-top:36mm;text-align:center}.signature-box{font-size:9pt}.signature-box .sign-space{height:30mm;border-bottom:.35mm solid #443a38;margin-bottom:2.5mm}.signature-box b{display:block;line-height:1.25}.signature-box small{display:block;margin-top:1.2mm;color:#746865;font-size:8pt}.signature-note{margin-top:16mm;text-align:center;color:#8d7e79;font-size:8pt}.signature-page .footer{position:absolute;left:15mm;right:15mm;bottom:6mm;margin-top:0}

  /* Pagos, totales y firmas comparten el cierre del documento. */
  .page{width:215.9mm;min-height:279.4mm}.is-annex{min-height:279.4mm}
  .is-annex .matrix,.is-annex .extras table{font-size:9pt}
  .is-annex .matrix th,.is-annex .matrix td,.is-annex .extras td{padding:.8mm 1.3mm;line-height:1.2}
  .signature-page{height:auto;min-height:279.4mm;overflow:visible;padding-bottom:12mm}
  .signature-page .brandbar{margin-bottom:5mm}
  .signature-page .signature-title h2{font-size:16pt;margin:1.5mm 0 2mm}
  .signature-page .signature-title p{font-size:9pt;line-height:1.35}
  .signature-summary{margin-top:5mm}.signature-summary div{padding:2mm}
  .signature-summary b{font-size:9pt}
  .signature-page .movements{margin-top:5mm}.signature-page .movements table{font-size:9pt}
  .signature-page .movements th,.signature-page .movements td{padding:1.3mm 2mm}
  .signature-page .movements thead{display:table-header-group}
  .signature-page .movements td small{font-size:7.5pt}
  .signature-page .totals{width:100%;margin:4mm 0 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
  .signature-page .totals div{gap:3mm;font-size:9pt;padding:2mm;border:1px solid #ded2cd}
  .signature-page .totals strong{white-space:nowrap}
  .signature-page .totals .total,.signature-page .totals .balance{grid-column:1 / -1;font-size:10pt}
  .signature-page .notes{font-size:9pt;line-height:1.35;margin-top:4mm}
  .signature-area{margin-top:10mm;break-inside:avoid;page-break-inside:avoid}
  .signature-box .sign-space{height:22mm}
  .signature-note{margin-top:6mm}.signature-page .footer{position:static;margin-top:8mm}
  .movements h3,.extras h3,.annex-title{break-after:avoid;page-break-after:avoid}
</style></head><body>
  <section class="page contract-page"><header class="brandbar"><div class="brand">${lincolnLogo}</div><div class="contact"><b>Calle Pachamama #2250 y Waldo Ballivián</b>Teléfono: 77922727<br/>Cochabamba - Bolivia</div></header><div class="doc-meta"><h2>${isOrganizer ? 'CONTRATO DE ALQUILER PARA ORGANIZADORES' : 'CONTRATO DE SERVICIOS'}</h2><div><strong>${escapeHtml(doc.contractCode || 'CONTRATO')}</strong><span>${dateLabel(doc.contractDate)}</span></div></div>
  <table class="facts"><tr><td><span>Nombre de los contratantes</span><b>${escapeHtml(contractorNames || '-')}</b><small>C.I.: ${escapeHtml(contractorCis || '-')}</small></td><td><span>Teléfonos</span><b>${escapeHtml(contractorPhones || '-')}</b><small>Contacto para coordinación</small></td></tr><tr><td><span>Tipo de evento</span><b>${escapeHtml(doc.eventType || '-')}</b></td><td><span>Duración del evento</span><b>${escapeHtml(doc.durationHours)} horas - Inicio ${escapeHtml(doc.startTime || 'por definir')}</b></td></tr><tr><td><span>Fecha del evento</span><b>${dateLong(doc.eventDate)}</b></td><td><span>Salón</span><b>${escapeHtml(doc.roomName || '-')}</b></td></tr></table>
  <p class="intro">Conste por el presente documento privado, con valor legal mediante el reconocimiento de firmas ante autoridad competente, suscrito entre la Sra. <b>BASILIA HERBAS SAHONERO, C.I. 3131436 Cbba.</b>, por Centro de Eventos LINCOLN, y los contratantes identificados precedentemente, bajo las siguientes cláusulas:</p><ol class="clauses">${clauseRows}</ol>
  <div class="financial-strip"><div><span>Total contrato</span><b>${escapeHtml(money(doc.totals.totalBs))}</b></div><div><span>Total pagado servicio</span><b>${escapeHtml(money(doc.servicePaidBs))}</b></div><div><span>Garantía · ${doc.guaranteeStatus === 'paid' ? 'PAGADO' : 'DEBE'}</span><b>${escapeHtml(money(doc.guaranteeBs))}</b></div><div><span>Total pendiente</span><b>${escapeHtml(money(doc.totals.totalPendingBs))}</b></div></div>
  <div class="footer"><span>Centro de Eventos Lincoln - Documento generado por el sistema</span><span>Contrato - ${escapeHtml(doc.contractCode)}</span></div></section>
  <section class="page is-annex"><header class="brandbar"><div class="brand">${lincolnLogo}</div><div class="contact"><b>Calle Pachamama #2250 y Waldo Ballivián</b>Teléfono: 77922727<br/>Cochabamba - Bolivia</div></header><h2 class="annex-title">HOJA DE COSTOS Y SERVICIOS</h2><div class="package-head"><div><span>Paquete</span><b>${escapeHtml(isOrganizer ? 'ALQUILER PARA ORGANIZADOR' : doc.packageName || 'SIN PAQUETE')}</b></div><div><span>Evento</span><b>${escapeHtml(doc.eventType || '-')}</b></div><div><span>Invitados</span><b>${escapeHtml(doc.guestCount)}</b></div></div>
  ${isOrganizer ? `<table class="matrix"><thead><tr><th>ALQUILER DEL SALÓN POR JORNADA</th><th>ASISTENTES</th><th>TARIFA FIJA</th></tr></thead><tbody>${rentalRows}</tbody></table>` : `<table class="matrix"><thead><tr><th>Servicios incluidos</th>${groups.map((group) => `<th>${escapeHtml(group.name)}</th>`).join('')}</tr></thead><tbody>${matrixRows}<tr class="cost"><td>COSTO POR PERSONA</td>${groups.map((group) => `<td>${escapeHtml(money(group.pricePerPersonBs))}</td>`).join('')}</tr><tr class="cost"><td>CANTIDAD DE INVITADOS</td>${groups.map((group) => `<td>${escapeHtml(group.guestCount)}</td>`).join('')}</tr><tr class="cost"><td>SUBTOTAL</td>${groups.map((group) => `<td>${escapeHtml(money(number(group.guestCount) * number(group.pricePerPersonBs)))}</td>`).join('')}</tr></tbody></table>`}
  ${extraRows ? `<section class="extras"><h3>SERVICIOS EXTRAS CONTRATADOS</h3><table><tbody>${extraRows}</tbody></table></section>` : ''}</section>
  <section class="page signature-page"><header class="brandbar"><div class="brand">${lincolnLogo}</div><div class="contact"><b>Calle Pachamama #2250 y Waldo Ballivián</b>Teléfono: 77922727<br/>Cochabamba - Bolivia</div></header><div class="signature-title"><span>CIERRE DEL CONTRATO</span><h2>FIRMAS Y CONFORMIDAD</h2><p>Las partes declaran su conformidad con el contrato, la hoja de costos, los servicios contratados y el estado económico detallado en este documento.</p></div><div class="signature-summary"><div><span>Contrato</span><b>${escapeHtml(doc.contractCode || '-')}</b></div><div><span>Evento</span><b>${escapeHtml(doc.eventType || '-')}</b></div><div><span>Fecha del evento</span><b>${dateLong(doc.eventDate)}</b></div><div><span>Total pendiente</span><b>${escapeHtml(money(doc.totals.totalPendingBs))}</b></div></div>${settlementMarkup}<div class="signature-area"><div class="signature-box"><div class="sign-space"></div><b>BASILIA HERBAS SAHONERO</b><small>Administradora - Centro de Eventos Lincoln</small></div><div class="signature-box"><div class="sign-space"></div><b>${escapeHtml(doc.contractor1Name || 'CONTRATANTE 1')}</b><small>Contratante</small></div><div class="signature-box"><div class="sign-space"></div><b>${escapeHtml(doc.contractor2Name || 'CONTRATANTE 2')}</b><small>Contratante</small></div></div><div class="signature-note">Espacio reservado exclusivamente para firmas manuscritas.</div><div class="footer"><span>Centro de Eventos Lincoln - Firmas y conformidad</span><span>${escapeHtml(doc.contractCode)}</span></div></section></body></html>`;
};

export const buildLincolnContractPdfFileName = (event) => {
  const code = text(event?.contractCode || event?.code || 'CONTRATO-LINCOLN');
  const client = text(event?.contractor1Name || event?.clientName || 'CLIENTE');
  return `${code}-${client}-contrato`;
};
