const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const dateLabel = value => {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Sin fecha';
};
const quantity = value => Math.max(0, Number(value) || 0).toLocaleString('es-BO');

export function buildAvailabilityReport({ entries = [], dateFrom, dateTo, filters = [], generatedAt = new Date(), clients = [] }) {
  const clientById = new Map(clients.map(client => [String(client.id), client]));
  const blocks = entries.map(({ row, commitments = [] }) => {
    const item = row.item ?? {};
    const details = [...commitments].sort((a, b) => String(a.startDate || a.eventDate || a.deliveryDate || '').localeCompare(String(b.startDate || b.eventDate || b.deliveryDate || ''))
      || String(a.contractCode || a.code || '').localeCompare(String(b.contractCode || b.code || ''), 'es', { numeric: true }));
    const rows = details.map(record => {
      const client = clientById.get(String(record.clientId));
      const tentative = record.commitmentTone === 'tentative';
      const startDate = record.deliveryDate || record.rentalDate || record.startDate || record.eventDate;
      const endDate = record.pickupDateMode === 'coordinate' ? record.eventDate
        : record.pickupDate || record.dueDate || record.endDate || record.validUntil || record.eventDate || startDate;
      const location = record.eventAddress || record.deliveryAddress || record.serviceAddress || record.address || record.destination || client?.address || record.city || client?.city || 'Sin ubicación registrada';
      const code = record.contractCode || record.quoteCode || record.code || record.orderCode || 'Sin código';
      return `<tr><td><strong>${escapeHtml(code)}</strong>${record.orderCode && record.orderCode !== code ? `<small>${escapeHtml(record.orderCode)}</small>` : ''}${record.type === 'cotizacion' ? '<small>Cotización</small>' : ''}</td>
        <td><strong>${escapeHtml(record.customerName || client?.name || 'Sin cliente')}</strong><small>${escapeHtml(record.eventType || 'Evento no especificado')}${record.eventDate ? ` · ${dateLabel(record.eventDate)}` : ''}</small></td>
        <td><strong>Entrega:</strong> ${dateLabel(startDate)}<small>${escapeHtml(record.deliveryTimeMode === 'coordinate' ? 'Por coordinar' : record.deliveryWindowStart || record.startTime || '00:00')}</small><strong>Recojo:</strong> ${dateLabel(endDate)}<small>${escapeHtml(record.pickupTimeMode === 'coordinate' ? 'Por coordinar' : record.pickupWindowEnd || record.dueTime || record.endTime || '23:59')}</small></td>
        <td>${escapeHtml(location)}${record.city && !String(location).includes(String(record.city)) ? `<small>${escapeHtml(record.city)}</small>` : ''}</td>
        <td class="number">${quantity(record.quantity)}</td><td>${tentative ? 'Tentativa' : 'Confirmada'}</td></tr>`;
    }).join('');
    return `<table class="product"><colgroup><col style="width:13%"><col style="width:20%"><col style="width:24%"><col style="width:25%"><col style="width:8%"><col style="width:10%"></colgroup><thead>
      <tr><th colspan="6" class="product-title"><h2>${escapeHtml(item.name || row.itemName)}</h2><div class="meta">${escapeHtml([item.sku, item.category, item.itemColor].filter(Boolean).join(' · '))}</div>
        <div class="summary"><span>Stock físico <b>${quantity(row.totalStock)}</b></span><span>Comprometido <b>${quantity(row.hardReservedQty)}</b></span><span>Disponible <b>${quantity(row.projectedAvailable)}</b></span><span>Tentativo <b>${quantity(row.softReservedQty)}</b></span></div>
      </th></tr><tr class="columns"><th>Contrato / orden</th><th>Cliente / evento</th><th>Entrega y recojo</th><th>Lugar</th><th>Cant.</th><th>Reserva</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${item.isCombo ? 'Combo: la disponibilidad se calcula a partir de sus componentes. Consulte los productos que lo integran para ver sus contratos.' : 'Sin contratos ni reservas registrados en el período consultado.'}</td></tr>`}</tbody>
      <tfoot><tr><td colspan="6">${details.length} registro(s) detallado(s)${row.stockControlled === false ? ' · Producto sin control de stock' : ''}.</td></tr></tfoot></table>`;
  }).join('');
  return `<!doctype html><html lang="es"><head><meta charset="UTF-8"><title>Disponibilidad ${escapeHtml(dateFrom)} al ${escapeHtml(dateTo)}</title><style>
    @page{size:Letter portrait;margin:12mm}*{box-sizing:border-box}body{width:185mm;max-width:100%;margin:0 auto;font:10pt/1.3 Arial,sans-serif;color:#111;background:#fff}h1{font-size:16pt;margin:0 0 2mm}h2{font-size:12pt;margin:0 0 1mm}header{margin-bottom:5mm;border-bottom:2px solid #444;padding-bottom:3mm}p{margin:1mm 0}.filters,.meta,.note{font-size:9pt}.product{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:4mm}th,td{border:0.5pt solid #777;padding:1.2mm 1.4mm;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tfoot{display:table-row-group;font-size:9pt}tr{break-inside:avoid}.product-title{text-align:left;background:#f0f3f5}.columns th{background:#e5e5e5;text-align:left;font-size:9.5pt}.summary{display:flex;gap:3mm;margin-top:2mm;font-size:9.5pt;font-weight:normal}.summary span{flex:1}.summary b{display:block;font-size:12pt}.product tbody td:last-child{font-size:9pt;white-space:nowrap;padding-left:1mm;padding-right:1mm}.number{text-align:right;font-weight:bold;font-size:11pt}small{display:block;font-size:9pt;margin-top:0.5mm}.note{color:#444;margin-bottom:4mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    </style></head><body><header><h1>REPORTE DE DISPONIBILIDAD</h1><p><strong>El Copetín · Del ${dateLabel(dateFrom)} al ${dateLabel(dateTo || dateFrom)}</strong> · Días completos, 00:00 a 23:59.</p><p class="filters">${escapeHtml(filters.filter(Boolean).join(' · ') || 'Todos los productos')} · ${entries.length} producto(s)</p><p class="filters">Emitido: ${escapeHtml(new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short' }).format(generatedAt))}</p></header>
    <p class="note">Cantidades de inventario propio comprometidas en el período seleccionado. Las reservas tentativas se muestran aparte y no se descuentan del disponible. Las fechas de entrega y recojo pueden extenderse fuera del rango consultado.</p>
    ${blocks || '<p>No hay productos que coincidan con los filtros.</p>'}</body></html>`;
}
