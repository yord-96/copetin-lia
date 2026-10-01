import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_CASH_COLUMNS, buildDailyCashRow, buildBigCashFundTimeline, filterDailyCashRows, totalDailyCashRows, getDailyCashFilterOptions, createDailyCashWorkbook, buildDailyCashReportHtml } from './dailyCashReport.js';

const row = (id, amountBs, key, extra = {}) => buildDailyCashRow({ id, amountBs, receiptCode: `RC-${id}` }, {
  hour: '08:30', customer: 'Cliente de prueba', nature: { key, label: key }, reference: '0012', method: 'Efectivo', user: 'Operador', ...extra,
});
const rows = [row(1, 125.75, 'rental'), row(6, 35, 'extra'), row(2, -50, 'guarantee_refund'), row(3, 20, 'guarantee'), row(4, -10.25, 'transport_expense'), row(5, 12.5, 'damage')];

test('separa ingresos y egresos sin duplicar conceptos y conserva devolución positiva en su columna', () => {
  assert.equal(rows[2].refund, 50);
  assert.equal(rows[2].expense, 50);
  assert.equal(rows[2].income, null);
  const totals = totalDailyCashRows(rows);
  assert.equal(totals.income, 193.25);
  assert.equal(totals.expense, 60.25);
  assert.equal(totals.contract, 125.75);
  assert.equal(totals.extra, 35);
  assert.equal(totals.guarantee, 20);
  assert.equal(totals.damage, 12.5);
  assert.equal(totalDailyCashRows([row(1, .1, 'rental'), row(2, .2, 'rental')]).income, .3);
});

test('combina filtros, distingue vacíos de cero y admite selección vacía', () => {
  assert.deepEqual(filterDailyCashRows(rows, { income: [''], method: ['Efectivo'] }).map(({ id }) => id), [2, 4]);
  assert.equal(filterDailyCashRows(rows, { method: [] }).length, 0);
  assert.equal(filterDailyCashRows(rows, {}).length, 6);
  assert.equal(filterDailyCashRows(rows, { refund: ['50'] })[0].expense, 50);
  assert.equal(getDailyCashFilterOptions([row(8, 1, 'rental', { customer: 'José' })], DAILY_CASH_COLUMNS[2], 'jose')[0].label, 'José');
});

test('Excel conserva las 16 columnas y filas filtradas, montos numéricos, rojos y subtotales', async () => {
  const filters = { income: [''] };
  const visible = filterDailyCashRows(rows, filters);
  const workbook = await createDailyCashWorkbook({ rows: visible, date: '2026-09-29', filters });
  assert.equal(totalDailyCashRows(visible).income, 0);
  await workbook.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = workbook.getWorksheet('Reporte diario');
  assert.deepEqual(sheet.getRow(8).values.slice(1), DAILY_CASH_COLUMNS.map(({ label }) => label));
  assert.equal(sheet.getCell('A9').value, 'RC-2');
  assert.equal(sheet.getCell('E9').value, '0012');
  assert.equal(sheet.getCell('K9').value, 50);
  assert.equal(sheet.getCell('K9').font.color.argb, 'FFDC2626');
  assert.equal(sheet.getCell('O9').font.color.argb, 'FFDC2626');
  assert.equal(sheet.getCell('O11').value.result, 60.25);
  assert.equal(sheet.getCell('O11').value.formula, 'SUBTOTAL(109,O9:O10)');
  assert.equal(sheet.getCell('N11').value.formula, 'SUBTOTAL(109,N9:N10)');
  assert.equal(sheet.autoFilter, 'A8:P10');
  const html = buildDailyCashReportHtml({ rows: visible, date: '2026-09-29', filters });
  assert.match(html, /RC-2/);
  assert.doesNotMatch(html, /RC-1/);
  assert.match(html, /TOTAL DE MOVIMIENTOS VISIBLES/);
  assert.equal((html.match(/<th>/g) || []).length, 16);
});

test('fondo acumulado arrastra efectivo y digital entre movimientos y días', () => {
  const movements = [
    { id: 'old', cashBoxType: 'BIG_CASH', amountBs: 9999, paymentMethod: 'efectivo', createdAt: '2026-10-01T08:00:00-04:00' },
    { id: 'a', cashBoxType: 'BIG_CASH', amountBs: 5000, paymentMethod: 'efectivo', accountingTag: 'big_cash_fund_in', category: 'ingreso_fondos', createdAt: '2026-10-02T08:00:00-04:00' },
    { id: 'b', cashBoxType: 'BIG_CASH', amountBs: 500, paymentMethod: 'qr', paymentAccount: 'CIDRE', createdAt: '2026-10-02T09:00:00-04:00' },
    { id: 'c', cashBoxType: 'BIG_CASH', amountBs: -200, paymentMethod: 'efectivo', createdAt: '2026-10-02T10:00:00-04:00' },
    { id: 'd', cashBoxType: 'BIG_CASH', amountBs: -300, paymentMethod: 'qr', paymentAccount: 'CIDRE', createdAt: '2026-10-02T11:00:00-04:00' },
    { id: 'e', cashBoxType: 'BIG_CASH', amountBs: 100, paymentMethod: 'efectivo', createdAt: '2026-10-03T08:00:00-04:00' },
  ];
  const timeline = buildBigCashFundTimeline(movements);
  assert.equal(timeline.byMovementId.has('old'), false);
  assert.equal(timeline.byMovementId.get('a').totalBs, 5000);
  assert.equal(timeline.byMovementId.get('b').digitalBs, 500);
  assert.equal(timeline.byMovementId.get('c').cashBs, 4800);
  assert.equal(timeline.byMovementId.get('d').totalBs, 5000);
  assert.equal(timeline.byMovementId.get('e').totalBs, 5100);
  assert.equal(timeline.cashBs, 4900);
  assert.equal(timeline.digitalBs, 200);
});

test('reportes vacíos y texto con símbolos no generan fórmulas ni HTML ejecutable', async () => {
  const empty = await createDailyCashWorkbook({ rows: [], date: '2026-09-29' });
  assert.equal(empty.getWorksheet('Reporte diario').getCell('O9').value, 0);
  const suspicious = row(8, 30, 'rental', { customer: '<script>alert(1)</script>', reference: '=1+1' });
  const workbook = await createDailyCashWorkbook({ rows: [suspicious], date: '2026-09-29' });
  assert.equal(workbook.getWorksheet('Reporte diario').getCell('E9').value, '=1+1');
  const html = buildDailyCashReportHtml({ rows: [suspicious], date: '2026-09-29' });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});
