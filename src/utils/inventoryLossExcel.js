const moneyFormat = '"Bs" #,##0.00;[Red]-"Bs" #,##0.00';
const number = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const money = (value) => Math.round(number(value) * 100) / 100;
const text = (value) => String(value ?? '');

// Excel stores wall-clock dates without a timezone. Preserve the time shown in the UI.
const excelDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000);
};

export async function createInventoryLossWorkbook({ rows, activeView, dateFrom = '', dateTo = '', query = '', economicsByRental = {}, generatedAt = new Date() }) {
  const module = await import('exceljs');
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'El Copetín';
  workbook.created = generatedAt;
  const label = activeView === 'danado' ? 'Daños' : 'Faltantes';
  const period = `${dateFrom || 'Inicio'} — ${dateTo || 'Actualidad'}`;

  const makeSheet = (name, headers, widths, values, moneyColumns = [], totalColumns = []) => {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 6 }],
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:6' },
    });
    sheet.columns = widths.map((width) => ({ width }));
    [
      'EL COPETÍN · CONTROL DE INVENTARIO',
      `Reporte de ${label} · ${name}`,
      `Periodo: ${period} | Búsqueda: ${query.trim() || 'Sin filtro'}`,
      `Generado: ${generatedAt.toLocaleString('es-BO')} | ${rows.length} incidencia(s)`,
    ].forEach((value, index) => {
      sheet.mergeCells(index + 1, 1, index + 1, headers.length);
      const cell = sheet.getCell(index + 1, 1);
      cell.value = value;
      cell.font = { name: 'Calibri', size: index === 1 ? 18 : 11, bold: index < 2, color: { argb: index === 0 ? 'FFFFFFFF' : 'FF15345F' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (index === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15345F' } };
      sheet.getRow(index + 1).height = index === 1 ? 32 : 28;
    });
    sheet.getRow(6).values = headers;
    sheet.getRow(6).height = 30;
    sheet.getRow(6).eachCell((cell) => {
      cell.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15345F' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    values.forEach((values, index) => {
      const row = sheet.addRow(values);
      row.height = Math.min(120, Math.max(32, ...values.map((value, column) => (
        typeof value === 'string' ? value.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / Math.max(8, widths[column] - 2))), 0) * 15 : 32
      ))));
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF17233A' } };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? 'FFF1F5F9' : 'FFFFFFFF' } };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9E1EB' } } };
        if (cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy hh:mm';
      });
      moneyColumns.forEach((column) => { row.getCell(column).numFmt = moneyFormat; });
    });
    if (values.length) {
      sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + values.length, column: headers.length } };
      if (totalColumns.length) {
        const total = sheet.addRow(['TOTAL']);
        totalColumns.forEach((column) => {
          const letter = sheet.getColumn(column).letter;
          total.getCell(column).value = { formula: `SUBTOTAL(109,${letter}7:${letter}${6 + values.length})`, result: money(values.reduce((sum, row) => sum + number(row[column - 1]), 0)) };
          total.getCell(column).numFmt = moneyColumns.includes(column) ? moneyFormat : '#,##0';
        });
        total.height = 26;
        total.eachCell((cell) => {
          cell.font = { name: 'Calibri', bold: true, color: { argb: 'FF15345F' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEAD9' } };
        });
      }
    } else {
      sheet.addRow(['Sin registros para los filtros seleccionados.']);
    }
    sheet.headerFooter.oddFooter = 'El Copetín · Inventario&RPágina &P de &N';
    return sheet;
  };

  const contracts = new Map();
  rows.forEach((row) => {
    if (row.rentalId != null && text(row.rentalId)) contracts.set(text(row.rentalId), row);
  });
  const sum = (key) => money(rows.reduce((total, row) => total + number(row[key]), 0));
  const financialSum = (key) => money([...contracts.keys()].reduce((total, id) => total + money(economicsByRental[id]?.[key]), 0));
  const summary = makeSheet('Resumen', ['Indicador', 'Valor'], [66, 48], [
    ['Registros exportados', rows.length],
    ['Unidades afectadas', sum('quantity')],
    ['Valor de incidencias (Bs)', sum('totalValueBs')],
    ['Contratos afectados', new Set(rows.map((row) => text(row.rentalId ?? row.contractCode)).filter(Boolean)).size],
    ...(activeView === 'danado' ? [['Unidades reinsertadas', sum('repairedQty')], ['Valor reinsertado (Bs)', money(rows.reduce((total, row) => total + number(row.repairedQty) * number(row.unitValueBs), 0))]] : []),
    ['Cargos al cliente por contrato (Bs)', financialSum('clientChargedBs')],
    ['Cobrado en caja (Bs)', financialSum('cashCollectedBs')],
    ['Garantía aplicada (Bs)', financialSum('guaranteeAppliedBs')],
    ['Total recuperado (Bs)', financialSum('totalRecoveredBs')],
    ['Pendiente por recuperar (Bs)', financialSum('pendingRecoveryBs')],
    ['Alcance', 'Se exportan las incidencias de la pestaña activa que coinciden con las fechas y la búsqueda.'],
    ['Importes por contrato', 'Los cobros incluyen el total de daños y faltantes de cada contrato vinculado, una sola vez; no se prorratean por artículo ni por los filtros.'],
    ['Valor de incidencias', 'Son cargos de devolución; no equivalen al costo contable de reposición ni a utilidad neta.'],
  ]);
  summary.eachRow((row) => { if (text(row.getCell(1).value).includes('(Bs)')) row.getCell(2).numFmt = moneyFormat; });

  makeSheet('Incidencias', ['N°', 'Fecha', 'Ítem', 'Categoría', 'Cantidad', 'Valor unitario', 'Valor total', 'Contrato', 'Orden', 'Cliente', 'Observación', 'Reinsertadas', 'Descartado desde daños'],
    [7, 22, 38, 24, 12, 18, 18, 18, 18, 32, 56, 15, 20],
    rows.map((row, index) => [index + 1, excelDate(row.occurredAt), text(row.itemName), text(row.category), number(row.quantity), money(row.unitValueBs), money(row.totalValueBs), text(row.contractCode), text(row.orderCode), text(row.customerName), text(row.note), number(row.repairedQty), row.isDiscardedDamage ? 'Sí' : 'No']),
    [6, 7], [5, 7, 12]);

  makeSheet('Cobros por contrato', ['Contrato', 'Orden', 'Cliente', 'Cargo al cliente', 'Cobrado en caja', 'Garantía aplicada', 'Total recuperado', 'Pendiente'],
    [20, 20, 40, 22, 22, 22, 22, 22],
    [...contracts].map(([id, row]) => {
      const entry = economicsByRental[id] ?? {};
      return [text(row.contractCode), text(row.orderCode), text(row.customerName), ...['clientChargedBs', 'cashCollectedBs', 'guaranteeAppliedBs', 'totalRecoveredBs', 'pendingRecoveryBs'].map((key) => money(entry[key]))];
    }), [4, 5, 6, 7, 8], [4, 5, 6, 7, 8]);

  makeSheet('Recuperaciones', ['Contrato', 'Orden', 'Cliente', 'Fecha', 'Forma de cobro', 'Cuenta / destino', 'Monto', 'Recibo / referencia', 'Registrado por'],
    [18, 18, 36, 22, 22, 32, 20, 24, 28],
    [...contracts].flatMap(([id, row]) => {
      const entries = economicsByRental[id]?.recoveryBreakdown;
      return (Array.isArray(entries) ? entries : []).map((entry) => [text(row.contractCode), text(row.orderCode), text(row.customerName), excelDate(entry.occurredAt), entry.source === 'guarantee' ? 'Garantía' : text(entry.paymentMethod || 'Efectivo'), text(entry.paymentAccount || (entry.source === 'guarantee' ? 'Garantía del contrato' : '')), money(entry.amountBs), text(entry.receiptCode), text(entry.registeredBy)]);
    }), [7], [7]);
  return workbook;
}

export async function downloadInventoryLossExcel(options) {
  const workbook = await createInventoryLossWorkbook(options);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `reporte-${options.activeView === 'danado' ? 'danos' : 'faltantes'}-${options.dateFrom || 'inicio'}-${options.dateTo || 'actualidad'}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
