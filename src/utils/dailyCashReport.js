export const DAILY_CASH_COLUMNS = [
  { key: 'receipt', label: 'Recibo', width: 15 },
  { key: 'hour', label: 'Hora', width: 10 },
  { key: 'customer', label: 'Cliente', width: 32 },
  { key: 'nature', label: 'Clasificación', width: 27 },
  { key: 'reference', label: 'Referencia', width: 16 },
  { key: 'method', label: 'Método / cuenta', width: 23 },
  { key: 'contract', label: 'Contrato', width: 18, money: true },
  { key: 'transport', label: 'Transporte', width: 18, money: true },
  { key: 'guarantee', label: 'Garantía recibida', width: 18, money: true },
  { key: 'refund', label: 'Devol. garantía', width: 18, money: true, tone: 'out' },
  { key: 'damage', label: 'Daños / faltantes', width: 18, money: true },
  { key: 'user', label: 'Registrado por', width: 27 },
  { key: 'income', label: 'Ingresos', width: 20, money: true, tone: 'income' },
  { key: 'expense', label: 'Egresos', width: 20, money: true, tone: 'out' },
];

const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const bs = (value) => `Bs ${Number(value).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dailyCashFilterValue = (value) => value == null ? '' : String(value);
export const dailyCashCellText = (column, value, formatMoney = bs) => value == null ? '—' : column.money ? formatMoney(value) : String(value);

// One numeric row feeds the screen, column filters, PDF and XLSX.
export function buildDailyCashRow(movement, labels) {
  const parsed = Number(movement.amountBs);
  const signed = Number.isFinite(parsed) ? round(parsed) : 0;
  const amount = Math.abs(signed);
  const key = labels.nature.key;
  return {
    id: movement.id,
    receipt: String(movement.receiptCode || movement.receipt || '-'),
    hour: labels.hour,
    customer: labels.customer,
    nature: labels.nature.label,
    reference: String(labels.reference ?? '-'),
    method: labels.method,
    contract: ['rental', 'deposit'].includes(key) ? amount : null,
    transport: ['transport', 'transport_expense'].includes(key) ? amount : null,
    guarantee: key === 'guarantee' ? amount : null,
    refund: key === 'guarantee_refund' ? amount : null,
    damage: key === 'damage' ? amount : null,
    user: labels.user,
    income: signed > 0 ? amount : null,
    expense: signed < 0 ? amount : null,
  };
}

export function filterDailyCashRows(rows, filters, exceptKey) {
  return rows.filter((row) => Object.entries(filters).every(([key, selected]) => (
    key === exceptKey || !Array.isArray(selected) || selected.includes(dailyCashFilterValue(row[key]))
  )));
}

export function getDailyCashFilterOptions(rows, column, search = '', formatMoney = bs) {
  const options = [...new Set(rows.map((row) => dailyCashFilterValue(row[column.key])))];
  return options.sort((a, b) => column.money ? Number(a) - Number(b) : a.localeCompare(b, 'es', { numeric: true }))
    .map((value) => ({ value, label: value === '' ? '(Vacías)' : column.money ? formatMoney(Number(value)) : value }))
    .filter((option) => normalize(option.label).includes(normalize(search)));
}

export function totalDailyCashRows(rows) {
  return Object.fromEntries(DAILY_CASH_COLUMNS.filter((column) => column.money).map(({ key }) => [
    key, rows.reduce((total, row) => total + Math.round(Number(row[key] ?? 0) * 100), 0) / 100,
  ]));
}

export function describeDailyCashFilters(filters, formatMoney = bs) {
  return DAILY_CASH_COLUMNS.filter(({ key }) => Array.isArray(filters[key])).map((column) => {
    const values = filters[column.key];
    const labels = values.slice(0, 5).map((value) => value === '' ? '(Vacías)' : dailyCashCellText(column, column.money ? Number(value) : value, formatMoney));
    return `${column.label}: ${values.length ? `${labels.join(', ')}${values.length > 5 ? ` (+${values.length - 5})` : ''}` : 'ningún valor'}`;
  }).join(' · ') || 'Sin filtros por columna';
}

export async function createDailyCashWorkbook({ rows, date, filters = {}, generatedAt = new Date() }) {
  const module = await import('exceljs');
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'El Copetín';
  workbook.created = generatedAt;
  workbook.calcProperties.fullCalcOnLoad = true;
  const totals = totalDailyCashRows(rows);
  const sheet = workbook.addWorksheet('Reporte diario', {
    views: [{ state: 'frozen', ySplit: 8, xSplit: 2, showGridLines: false }],
    pageSetup: { paperSize: 8, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '8:8', margins: { left: .25, right: .25, top: .4, bottom: .4, header: .2, footer: .2 } },
  });
  sheet.columns = DAILY_CASH_COLUMNS.map(({ width }) => ({ width }));
  const moneyFormat = '"Bs" #,##0.00;[Red]-"Bs" #,##0.00;"—"';
  const banner = (row, value, size, color = 'FF15345F', background) => {
    sheet.mergeCells(row, 1, row, 14);
    const cell = sheet.getCell(row, 1);
    cell.value = value;
    cell.font = { name: 'Calibri', bold: row < 3, size, color: { argb: color } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    if (background) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: background } };
    sheet.getRow(row).height = row === 2 ? 34 : row === 4 ? 44 : 26;
  };
  banner(1, 'EL COPETÍN · CAJA GRANDE', 12, 'FFFFFFFF', 'FF15345F');
  banner(2, 'Reporte diario · Ingresos y egresos', 21);
  banner(3, `Día: ${date} · 00:00–23:59 (Bolivia) · ${rows.length} movimientos · Generado: ${generatedAt.toLocaleString('es-BO')}`, 11);
  banner(4, describeDailyCashFilters(filters), 11, 'FF64748B');
  [['A6:D6', 'Ingresos', totals.income, 'FF15803D'], ['E6:I6', 'Egresos', totals.expense, 'FFDC2626'], ['J6:N6', 'Resultado neto', round(totals.income - totals.expense), 'FF15345F']].forEach(([range, label, amount, color]) => {
    sheet.mergeCells(range);
    const cell = sheet.getCell(range.split(':')[0]);
    cell.value = `${label.toUpperCase()}   ${bs(amount)}`;
    cell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: color } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  sheet.getRow(6).height = 38;
  const header = sheet.getRow(8);
  header.values = DAILY_CASH_COLUMNS.map(({ label }) => label);
  header.height = 32;
  header.eachCell((cell) => {
    cell.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15345F' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  rows.forEach((entry, index) => {
    const row = sheet.addRow(DAILY_CASH_COLUMNS.map(({ key }) => entry[key] ?? null));
    row.height = Math.max(32, ...DAILY_CASH_COLUMNS.map(({ key, width, money }) => money ? 32 : Math.ceil(String(entry[key] ?? '').length / (width - 3)) * 15 + 8));
    DAILY_CASH_COLUMNS.forEach((column, col) => {
      const cell = row.getCell(col + 1);
      cell.font = { name: 'Calibri', size: 11, bold: column.money, color: { argb: column.tone === 'out' ? 'FFDC2626' : column.tone === 'income' ? 'FF15803D' : 'FF17233A' } };
      cell.alignment = { vertical: 'middle', horizontal: column.money ? 'right' : 'left', wrapText: !column.money };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? 'FFF1F5F9' : 'FFFFFFFF' } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9E1EB' } } };
      if (column.money) cell.numFmt = moneyFormat;
    });
  });
  sheet.autoFilter = { from: { row: 8, column: 1 }, to: { row: Math.max(8, 8 + rows.length), column: 14 } };
  const total = sheet.getRow(9 + rows.length);
  sheet.mergeCells(total.number, 1, total.number, 6);
  total.getCell(1).value = 'TOTAL DE MOVIMIENTOS VISIBLES';
  DAILY_CASH_COLUMNS.forEach((column, index) => {
    const cell = total.getCell(index + 1);
    if (column.money) {
      const letter = sheet.getColumn(index + 1).letter;
      cell.value = rows.length ? { formula: `SUBTOTAL(109,${letter}9:${letter}${8 + rows.length})`, result: totals[column.key] } : 0;
      cell.numFmt = moneyFormat;
    }
    cell.font = { name: 'Calibri', bold: true, size: 11, color: { argb: column.tone === 'out' ? 'FFDC2626' : column.tone === 'income' ? 'FF15803D' : 'FF15345F' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EFF8' } };
    cell.alignment = { vertical: 'middle', horizontal: column.money ? 'right' : 'left' };
  });
  total.height = 32;
  const note = total.number + 2;
  sheet.mergeCells(note, 1, note, 14);
  sheet.getCell(note, 1).value = 'Las columnas de conceptos desglosan los movimientos: no se suman nuevamente a Ingresos / Egresos. Los totales inferiores se actualizan al filtrar en Excel; el resumen superior corresponde a la exportación.';
  sheet.getCell(note, 1).alignment = { wrapText: true };
  sheet.getCell(note, 1).font = { name: 'Calibri', size: 10, color: { argb: 'FF64748B' } };
  sheet.getRow(note).height = 30;
  sheet.headerFooter.oddFooter = '&LEl Copetín · Caja Grande&RPágina &P de &N';
  sheet.pageSetup.printArea = `A1:N${note}`;
  return workbook;
}

export function buildDailyCashReportHtml({ rows, date, filters = {}, generatedAt = new Date() }, formatMoney = bs) {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const totals = totalDailyCashRows(rows);
  const money = (value) => esc(formatMoney(value));
  const cells = (row) => DAILY_CASH_COLUMNS.map((column) => `<td class="${column.money ? 'money' : ''} ${column.tone || ''}">${esc(dailyCashCellText(column, row[column.key], formatMoney))}</td>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte diario · ${esc(date)}</title><style>
@page{size:A3 landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#17233a;font:10px Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #15345f;padding-bottom:12px}.brand{color:#df4d00;font-size:11px;font-weight:bold;letter-spacing:1px}h1{font-size:25px;color:#15345f;margin:5px 0}.meta{text-align:right;line-height:1.7;color:#64748b}.filters{margin:12px 0;color:#64748b;overflow-wrap:anywhere}.summary{display:flex;gap:12px;margin:14px 0}.card{flex:1;border:1px solid #d9e1eb;border-left:4px solid #15345f;background:#f8fafc;padding:12px}.card span{display:block;font-size:10px;color:#64748b;text-transform:uppercase}.card strong{display:block;font-size:21px;margin-top:5px}.income{color:#15803d}.out{color:#dc2626}table{width:100%;table-layout:fixed;border-collapse:collapse}thead{display:table-header-group}th{background:#15345f;color:white;text-align:left;padding:10px 5px;font-size:9px}td{padding:9px 5px;border-bottom:1px solid #d9e1eb;vertical-align:middle;overflow-wrap:anywhere}tr{break-inside:avoid}tbody tr:nth-child(even){background:#f1f5f9}.money{text-align:right;white-space:nowrap;font-weight:bold;font-variant-numeric:tabular-nums}.totals td{background:#e8eff8;border-top:2px solid #15345f;font-weight:bold;padding:12px 5px}.note{margin-top:14px;color:#64748b;line-height:1.6}.toolbar{display:flex;justify-content:flex-end;padding:12px;background:#f1f5f9;margin-bottom:18px}.toolbar button{background:#15345f;color:white;border:0;border-radius:6px;padding:10px 16px;cursor:pointer}@media screen{body{padding:22px;min-width:1250px}}@media print{.toolbar{display:none}}
</style></head><body><div class="toolbar"><button onclick="window.print()">Imprimir / guardar PDF</button></div><header><div><div class="brand">EL COPETÍN · CAJA GRANDE</div><h1>Reporte diario de ingresos y egresos</h1><div>Movimientos confirmados · ${esc(date)} · 00:00–23:59 (hora Bolivia)</div></div><div class="meta">${rows.length} movimientos incluidos<br>Generado: ${esc(generatedAt.toLocaleString('es-BO'))}</div></header><div class="filters">${esc(describeDailyCashFilters(filters, formatMoney))}</div><section class="summary"><div class="card income"><span>Total ingresos</span><strong>${money(totals.income)}</strong></div><div class="card out"><span>Total egresos</span><strong>${money(totals.expense)}</strong></div><div class="card"><span>Resultado neto</span><strong>${money(round(totals.income - totals.expense))}</strong></div></section><table><colgroup>${DAILY_CASH_COLUMNS.map(({ width }) => `<col style="width:${width / DAILY_CASH_COLUMNS.reduce((sum, col) => sum + col.width, 0) * 100}%">`).join('')}</colgroup><thead><tr>${DAILY_CASH_COLUMNS.map(({ label }) => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${cells(row)}</tr>`).join('') || '<tr><td colspan="14">Sin movimientos para los filtros seleccionados.</td></tr>'}<tr class="totals"><td colspan="6">TOTAL DE MOVIMIENTOS VISIBLES</td>${DAILY_CASH_COLUMNS.slice(6).map((column) => `<td class="money ${column.tone || ''}">${column.money ? money(totals[column.key]) : ''}</td>`).join('')}</tr></tbody></table><div class="note">Los conceptos (contrato, transporte, garantías y daños / faltantes) desglosan cada movimiento; no se suman nuevamente a ingresos o egresos. Se excluyen movimientos anulados y saldos de apertura.<br>Este reporte conserva las columnas, el orden y los filtros de la tabla del sistema.</div></body></html>`;
}
