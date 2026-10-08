import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_CASH_COLUMNS, buildDailyCashRow, buildBigCashFundTimeline, filterDailyCashRows, totalDailyCashRows, getDailyCashFilterOptions, createDailyCashWorkbook, buildDailyCashReportHtml } from './dailyCashReport.js';

test('el día siguiente arrastra el cierre completo aunque una devolución retroactiva se registre después', async () => {
  const make = (id, amountBs, cashEffectiveDate, cashLedgerSequence, paymentMethod = 'efectivo') => ({
    id, amountBs, cashEffectiveDate, cashLedgerSequence, paymentMethod, cashBoxType: 'BIG_CASH',
  });
  const movements = [
    { ...make('fund',5000,'2026-10-01',3278), accountingTag:'big_cash_fund_in' },
    make('previous-net',-478,'2026-10-01',3306),
    make('previous-digital',1869,'2026-10-01',3292,'qr'),
    make('RC-13511',18,'2026-10-02',3307,'qr'),
    make('RC-1703',-200,'2026-10-01',3309),
    make('RC-13517',200,'2026-10-02',3312),
  ];
  const day1 = buildBigCashFundTimeline(movements,{asOfDate:'2026-10-01',reportDate:'2026-10-01'});
  const day2 = buildBigCashFundTimeline(movements,{asOfDate:'2026-10-02',reportDate:'2026-10-02'});
  assert.equal(day1.cashBs,4322);
  assert.equal(day2.openingBalance.cashBs,day1.cashBs);
  assert.equal(day2.openingBalance.digitalBs,day1.digitalBs);
  assert.equal(day2.byMovementId.get('RC-13511').cashBs,4322);
  assert.equal(day2.byMovementId.get('RC-13511').digitalBs,1887);
  assert.equal(day2.byMovementId.get('RC-13517').cashBs,4522);
  // El documento individual conserva el orden real de registro.
  assert.equal(buildBigCashFundTimeline(movements,{asOfDate:'2026-10-02'}).byMovementId.get('RC-13511').cashBs,4522);
  const labels = {hour:'01:37',customer:'Cliente',nature:{key:'damage',label:'Daños'},reference:'2741',method:'QR',user:'Usuario'};
  const rows = [buildDailyCashRow(movements.find(row=>row.id==='RC-13511'),labels,day2.byMovementId.get('RC-13511'))];
  const workbook = await createDailyCashWorkbook({rows,date:'2026-10-02',openingBalance:day2.openingBalance});
  const sheet = workbook.getWorksheet('Reporte diario');
  assert.equal(sheet.getCell('P7').value,4322);
  assert.equal(sheet.getCell('Q7').value,1869);
  assert.equal(sheet.getCell('P9').value,4322);
  assert.equal(sheet.getCell('Q9').value,1887);
  assert.match(buildDailyCashReportHtml({rows,date:'2026-10-02',openingBalance:day2.openingBalance}),/SALDO ANTERIOR/);
  const emptyBook = await createDailyCashWorkbook({rows:[],date:'2026-10-03',openingBalance:day2});
  assert.equal(emptyBook.getWorksheet('Reporte diario').getCell('P9').value,4522);
  assert.equal(emptyBook.getWorksheet('Reporte diario').getCell('Q9').value,1887);
});
import { preserveCashLedgerOrder } from './cashLedgerOrder.js';

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

test('Excel conserva las 17 columnas y filas filtradas, montos numéricos, rojos y subtotales', async () => {
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
  assert.equal(sheet.autoFilter, 'A8:Q10');
  const html = buildDailyCashReportHtml({ rows: visible, date: '2026-09-29', filters });
  assert.match(html, /RC-2/);
  assert.doesNotMatch(html, /RC-1/);
  assert.match(html, /TOTAL DE MOVIMIENTOS VISIBLES/);
  assert.equal((html.match(/<th>/g) || []).length, 15);
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
  const timeline = buildBigCashFundTimeline(movements, { asOfDate: '2026-10-03' });
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

test('fondo conserva el orden de registro aunque se retroceda la fecha del recibo', () => {
  const base = { cashBoxType: 'BIG_CASH', paymentMethod: 'efectivo' };
  const timeline = buildBigCashFundTimeline([
    { ...base, id: 'fund', amountBs: 5000, accountingTag: 'big_cash_fund_in', createdAt: '2026-09-30T16:00:00Z' },
    { ...base, id: 'later', amountBs: 100, createdAt: '2026-10-01T16:00:00Z' },
    { ...base, id: 'refund', amountBs: -150, createdAt: '2026-10-02T04:54:36Z', receiptIssuedAt: '2026-10-01T04:54:00Z' },
  ]);
  assert.equal(timeline.byMovementId.get('refund').totalBs, 4950);
  assert.equal(timeline.byMovementId.get('later').totalBs, 5100);
});

test('regresión 2752: solo pagos vigentes afectan su canal; excluye historia y futuros', async () => {
  const make = (id, amountBs, method = 'efectivo', date = '2026-10-01') => ({
    id, amountBs, cashBoxType: 'BIG_CASH', paymentMethod: method,
    receiptIssuedAt: `${date}T04:00:00Z`, createdAt: '2026-10-02T06:00:00Z',
  });
  const state = preserveCashLedgerOrder({ cashMovements: [
    { ...make('fund', 5000), accountingTag: 'big_cash_fund_in' },
    make('cash-160', 160), make('cash-444', 444), make('digital-235', 235, 'qr'),
    make('historical-375', 375, 'qr', '2026-09-25'), make('refund-15', -15), make('damage-10', 10),
    make('historical-425', 425, 'qr', '2026-09-12'), make('historical-36', 36, 'qr', '2026-09-12'),
    make('refund-150', -150), make('damage-25', 25), make('digital-406', 406, 'qr'),
    make('historical-cash-150', 150, 'efectivo', '2026-09-29'),
    make('digital-420', 420, 'qr'), make('digital-808', 808, 'qr'),
    make('future-2752', 255, 'qr', '2026-10-24'), make('refund-2752', -150),
    make('historical-339', 339, 'qr', '2026-09-26'), make('refund-2777', -150),
    make('historical-172', 172.5, 'qr', '2026-09-22'), make('refund-2709', -150),
    make('future-1219', 1219, 'qr', '2026-10-22'), make('future-cash-300', 300, 'efectivo', '2026-10-22'),
    make('refund-2713', -85), make('future-548', 548, 'qr', '2026-10-26'), make('refund-2775', -200),
    make('historical-cash-185', 185, 'efectivo', '2026-09-24'), make('historical-812', 812, 'qr', '2026-09-24'),
    make('refund-2741', -217), make('digital-next-day', 18, 'qr', '2026-10-02'),
    make('historical-300', 300, 'qr', '2026-09-27'), make('refund-2811', -200),
  ] });
  const timeline = buildBigCashFundTimeline(state.cashMovements, { asOfDate: '2026-10-01' });
  const at2752 = timeline.byMovementId.get('refund-2752');
  assert.equal(at2752.beforeCashBs, 5474);
  assert.equal(at2752.cashBs, 5324);
  assert.equal(at2752.digitalBs, 1869);
  assert.equal(at2752.cashChangeBs, -150);
  assert.equal(at2752.digitalChangeBs, 0);
  assert.equal(timeline.cashBs, 4322);
  assert.equal(timeline.digitalBs, 1869);
  assert.equal(timeline.totalBs, 6191);
  for (const movement of state.cashMovements.filter(row => row.id.startsWith('historical') || row.id.startsWith('future'))) {
    assert.equal(timeline.byMovementId.has(movement.id), false, movement.id);
  }
  for (const snapshot of timeline.byMovementId.values()) {
    assert.equal(snapshot.cashBs, snapshot.beforeCashBs + snapshot.cashChangeBs);
    assert.equal(snapshot.digitalBs, snapshot.beforeDigitalBs + snapshot.digitalChangeBs);
    assert.equal(snapshot.totalBs, snapshot.cashBs + snapshot.digitalBs);
  }
  const nextDay = buildBigCashFundTimeline(state.cashMovements, { asOfDate: '2026-10-02' });
  assert.equal(nextDay.cashBs, 4322);
  assert.equal(nextDay.digitalBs, 1887);
  const labels = { hour: '01:10', customer: 'ISMAEL OJEDA', nature: { key: 'guarantee_refund', label: 'Devolución' }, reference: '2752', method: 'Efectivo', user: 'Operador' };
  const row = buildDailyCashRow(state.cashMovements.find(row => row.id === 'refund-2752'), labels, at2752);
  const book = await createDailyCashWorkbook({ rows: [row], date: '2026-10-01' });
  const sheet = book.getWorksheet('Reporte diario');
  assert.equal(sheet.getCell('P9').value, 5324);
  assert.equal(sheet.getCell('Q9').value, 1869);
  assert.equal(sheet.getCell('P10').value, 5324);
  assert.equal(sheet.getCell('Q10').value, 1869);
  const html = buildDailyCashReportHtml({ rows: [row], date: '2026-10-01' });
  assert.match(html, /Fondo efectivo/);
  assert.match(html, /Fondo digital/);
});
