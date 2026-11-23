import { buildAvailabilityPeriod, buildRentalAvailabilityPeriod, buildCommercialAvailabilityPeriod, getOutstandingInventoryLineQuantity } from './availability.js';
import { findScheduleDayForLine } from './scheduleDayAssignment.js';

const qty = value => Math.max(0, Math.trunc(Number(value) || 0));
const knownQty = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const active = record => record && !record.deletedAt && !['returned', 'cancelled', 'anulado'].includes(String(record.status).toLowerCase());

export function buildDailyContractStockModel({ date, items = [], contracts = [], rentals = [], suppliers = [], clients = [] }) {
  const target = buildAvailabilityPeriod({ deliveryDate: date, pickupDate: date });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(target.start) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Selecciona una fecha válida.');
  const itemById = new Map(items.map(item => [String(item.id), item]));
  const clientById = new Map(clients.map(client => [String(client.id), client]));
  const supplierById = new Map(suppliers.map(supplier => [String(supplier.id), supplier]));
  const contractByRental = new Map(contracts.filter(c => !c.deletedAt).map(c => [String(c.rentalId), c]));
  const contractByOrder = new Map(contracts.filter(c => !c.deletedAt && c.orderCode).map(c => [String(c.orderCode), c]));
  const contractById = new Map(contracts.map(c => [String(c.id), c]));
  const linked = new Set();
  const sources = [];
  for (const rental of rentals) {
    const contract = contractById.get(String(rental.contractId)) || contractByRental.get(String(rental.id)) || contractByOrder.get(String(rental.orderCode));
    if (contract) linked.add(String(contract.id));
    if (!active(rental) || (contract && !active(contract))) continue;
    sources.push({ record: rental, contract, period: buildRentalAvailabilityPeriod(rental, contract) });
  }
  for (const contract of contracts) {
    if (!active(contract) || linked.has(String(contract.id)) || String(contract.status).toLowerCase() !== 'aprobado') continue;
    sources.push({ record: contract, contract, period: buildCommercialAvailabilityPeriod(contract) });
  }
  const groups = [];
  for (const { record, contract, period } of sources) {
    if (!(period.start < target.end && period.end > target.start)) continue;
    const commercial = contract || record;
    const plan = commercial.supplierFulfillmentPlan?.length ? commercial.supplierFulfillmentPlan : record.supplierFulfillmentPlan || [];
    const planUsed = new Map();
    const lines = record.items?.length ? record.items : commercial.items || [];
    const pricing = commercial.pricingPlan || record.pricingPlan;
    const days = pricing?.scheduleDays || [];
    const byItem = new Map();
    const add = (line, own, external, supports) => {
      const id = String(line.itemId || line.lineKey || line.itemName || 'sin-item');
      const item = itemById.get(id);
      const controlled = item ? item.controlsStock !== false && item.verificationStatus !== 'pending_verification' && item.adoptionSource !== 'service_order_quick_item' : false;
      let row = byItem.get(id);
      if (!row) { row = { itemId: id, name: item?.name || line.itemName || line.name || 'Producto sin nombre', sku: item?.sku || '', stock: controlled ? qty(item.totalStock) : null, own: 0, external: 0, suppliers: [] }; byItem.set(id, row); }
      row.own += controlled ? own : 0;
      row.external += external;
      row.suppliers.push(...supports);
      row.requested = (row.requested || 0) + own + external;
    };
    for (const [index, line] of lines.entries()) {
      if (pricing?.mode === 'daily_schedule' && (line.serviceDayId || line.serviceDate || line.serviceDayLabel)) {
        const day = findScheduleDayForLine(line, days);
        if (String(day?.date || line.serviceDate || '').slice(0, 10) !== date) continue;
      }
      const supports = [];
      let external = 0;
      let manual = false;
      for (const [planIndex, support] of plan.entries()) {
        if (String(support.itemId) !== String(line.itemId) || (support.lineKey && support.lineKey !== line.lineKey)) continue;
        if (support.serviceDate && String(support.serviceDate).slice(0, 10) !== date) continue;
        const remaining = Math.max(0, qty(support.neededQty ?? support.quantity) - (planUsed.get(planIndex) || 0));
        const allocated = support.manualCoverage ? remaining : Math.min(remaining, Math.max(0, qty(line.quantity) - external));
        if (!allocated) continue;
        planUsed.set(planIndex, (planUsed.get(planIndex) || 0) + allocated);
        external += allocated;
        manual ||= Boolean(support.manualCoverage);
        supports.push({ name: support.supplierName || supplierById.get(String(support.supplierId))?.name || 'Subalquiladora sin identificar', quantity: allocated });
      }
      external = Math.max(external, qty(line.supplierBackedQty));
      if (external > supports.reduce((sum, s) => sum + s.quantity, 0)) supports.push({ name: line.supplierName || 'Subalquiladora sin identificar', quantity: external - supports.reduce((sum, s) => sum + s.quantity, 0) });
      const reserved = knownQty(line.internalReservedQty) ? qty(line.internalReservedQty) : manual ? qty(line.quantity) : Math.max(0, qty(line.quantity) - external);
      const own = record._availabilitySummaryOnly ? reserved : getOutstandingInventoryLineQuantity(record, { ...line, internalReservedQty: reserved }, index);
      const lineKey = String(line.lineKey || line.returnLineKey || `${line.comboLineKey || 'item'}-${line.itemId || 'sin-item'}-${line.comboRuleIndex ?? index}-${index}`);
      const unique = lines.filter(other => other.itemId === line.itemId).length === 1;
      const returnedExternal = (record.partialReturnReport?.items || []).filter(entry => entry.lineKey ? String(entry.lineKey) === lineKey : unique && entry.itemId === line.itemId)
        .reduce((sum, entry) => entry.returnedToAvailableQty == null ? sum : sum + Math.max(0, qty(entry.returnedQty) - qty(entry.returnedToAvailableQty) - qty(entry.movedToCleaningQty)), 0);
      external = Math.max(0, external - returnedExternal);
      if (own || external) add(line, own, external, supports);
    }
    for (const [index, support] of plan.entries()) {
      if (lines.some(line => String(line.itemId) === String(support.itemId))) continue;
      if (support.serviceDate && String(support.serviceDate).slice(0, 10) !== date) continue;
      const remaining = Math.max(0, qty(support.neededQty ?? support.quantity) - (planUsed.get(index) || 0));
      if (remaining) add(support, 0, remaining, [{ name: support.supplierName || supplierById.get(String(support.supplierId))?.name || 'Subalquiladora sin identificar', quantity: remaining }]);
    }
    if (!byItem.size) continue;
    const client = clientById.get(String(commercial.clientId || commercial.customerId || record.clientId || record.customerId));
    const address = commercial.eventAddress || commercial.deliveryAddress || commercial.serviceAddress || commercial.address || record.eventAddress || record.deliveryAddress || record.serviceAddress || record.address || client?.address || '';
    const logisticsMode = commercial.logisticsMode || record.logisticsMode || '';
    const logisticsLabel = logisticsMode === 'recojo' ? 'Recojo por el cliente' : logisticsMode === 'envio' ? 'Envío por el equipo' : 'Por definir';
    groups.push({ id: String(commercial.id), code: commercial.contractCode || record.contractCode || record.orderCode || 'Sin código', orderCode: record.orderCode || commercial.orderCode || '', customerName: commercial.customerName || record.customerName || 'Sin cliente', eventDate: commercial.eventDate || record.eventDate || '', deliveryDate: commercial.deliveryDate || record.rentalDate || period.startDate, pickupDate: commercial.pickupDate || record.dueDate || period.endDate, address, city: commercial.city || record.city || client?.city || '', logisticsMode, logisticsLabel, rows: [...byItem.values()] });
  }
  const totals = new Map();
  for (const group of groups) for (const row of group.rows) totals.set(row.itemId, (totals.get(row.itemId) || 0) + row.own);
  for (const group of groups) for (const row of group.rows) {
    row.other = Math.max(0, (totals.get(row.itemId) || 0) - row.own);
    row.free = row.stock === null ? null : Math.max(0, row.stock - row.own - row.other);
    row.shortage = row.stock === null ? 0 : Math.max(0, row.own + row.other - row.stock);
    const suppliers = new Map();
    for (const s of row.suppliers) suppliers.set(s.name, (suppliers.get(s.name) || 0) + s.quantity);
    row.suppliers = [...suppliers].map(([name, quantity]) => ({ name, quantity }));
  }
  groups.sort((a, b) => String(a.code).localeCompare(String(b.code), 'es', { numeric: true }));
  return { date, groups };
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = value => String(value || '').slice(0, 10).split('-').reverse().join('/');
const n = value => value === null ? '—' : qty(value).toLocaleString('es-BO');
export function buildDailyContractStockHtml({ date, groups = [] }) {
  return `<!doctype html><html lang="es"><head><meta charset="UTF-8"><title>Contratos e inventario ${esc(date)}</title><style>@page{size:Letter portrait;margin:12mm}*{box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact}body{width:185mm;max-width:100%;margin:auto;font:10pt/1.3 Arial;color:#111}h1{font-size:16pt;margin:0 0 2mm}h2{font-size:12pt;margin:0 0 1mm}p{margin:1mm 0}.note,small{font-size:9pt}small{display:block}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:4mm 0 4mm}th,td{border:.5pt solid #777;padding:1.2mm 1mm;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}th{background:#e7e7e7;font-size:9pt;text-align:left}.contract{text-align:left;background:#f0f3f5;font-size:10pt;font-weight:normal}.num{text-align:right}.danger{font-weight:bold}header{border-bottom:2px solid #444;margin-bottom:3mm;padding-bottom:3mm}</style></head><body><header><h1>CONTRATOS E INVENTARIO DEL DÍA</h1><p><strong>El Copetín · ${day(date)} · ${groups.length} contrato(s)</strong></p></header><p class="note">Contratos activos que ocupan inventario en la fecha elegida. Origen = stock físico propio actual. Libre del día = origen − propio en este contrato − otros contratos. La subalquiladora se muestra aparte y no aumenta el stock propio. No incluye cotizaciones tentativas.</p>
    ${groups.map(group => `<table><colgroup><col style="width:30%"><col style="width:8%"><col style="width:10%"><col style="width:12%"><col style="width:11%"><col style="width:10%"><col style="width:19%"></colgroup><thead><tr><th colspan="7" class="contract"><h2>CONTRATO ${esc(group.code)} · ${esc(group.customerName)}</h2><p>${esc(group.orderCode)} · Evento ${day(group.eventDate)} · Entrega ${day(group.deliveryDate)} · Recojo ${day(group.pickupDate)}</p><p><strong>Tipo de entrega:</strong> ${esc(group.logisticsLabel || 'Por definir')} · <strong>Ubicación:</strong> ${esc(group.address || 'Sin ubicación registrada')}${group.city && !String(group.address).toLowerCase().includes(String(group.city).toLowerCase()) ? ` · ${esc(group.city)}` : ''}</p></th></tr><tr><th>Producto</th><th>Cant. total</th><th>Origen propio</th><th>Propio en contrato</th><th>Otros contratos</th><th>Libre del día</th><th>Subalquiladora / cantidad</th></tr></thead><tbody>${group.rows.map(row => `<tr><td><strong>${esc(row.name)}</strong></td><td class="num">${n(row.requested)}</td><td class="num">${n(row.stock)}</td><td class="num">${n(row.own)}</td><td class="num">${n(row.other)}</td><td class="num">${n(row.free)}${row.shortage ? `<small class="danger">Faltan ${n(row.shortage)}</small>` : ''}</td><td>${row.suppliers.length ? row.suppliers.map(s => `${esc(s.name)}: <strong>${n(s.quantity)}</strong>`).join('<br>') + (row.suppliers.reduce((sum, s) => sum + s.quantity, 0) !== row.external ? `<small>Plan original. Pendiente externo: ${n(row.external)}</small>` : '') : row.external ? `Sin identificar: ${n(row.external)}` : '—'}${row.stock === null ? '<small>Sin control de stock propio</small>' : ''}</td></tr>`).join('')}</tbody></table>`).join('') || '<p>No hay contratos activos con productos comprometidos para esta fecha.</p>'}</body></html>`;
}
