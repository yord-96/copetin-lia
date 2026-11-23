import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { getDailyGuaranteeApplications } from './dailyGuaranteeApplications.js';
import { buildDailyCashReportHtml, createDailyCashWorkbook, totalDailyCashRows } from './dailyCashReport.js';

export const guaranteeApplicationFixture = () => ({ contracts: [{ id: 'contract', contractCode: '3659', customerName: 'DANIELA SEVILLA', economicLedger: [
  { id: 'deposit', type: 'deposit', amountBs: 150, createdAt: '2026-11-20T18:53:00Z', cashMovementId: 'income', cashReceiptCode: 'RC-773', isCashRegistered: true },
  { id: 'guarantee', type: 'guarantee', amountBs: 72, sourceDepositId: 'deposit', createdAt: '2026-11-20T18:53:00Z' },
  { id: 'application-917318', type: 'charge', amountBs: 36, createdAt: '2026-11-22T14:00:00Z', note: 'Daños/faltantes aplicados contra la garantia de DANIELA SEVILLA.', createdByName: 'YORDY COPA CEREZO' },
  { id: 'pending', type: 'charge', amountBs: 50, createdAt: '2026-11-22T14:00:00Z', note: 'Daños pendientes de pago' },
  { id: 'cash-damage', type: 'charge', amountBs: 20, createdAt: '2026-11-22T14:00:00Z', note: 'Daños aplicados a garantia', cashMovementId: 'cash-damage' },
  { id: 'deleted', type: 'guarantee_apply', amountBs: 100, createdAt: '2026-11-22T14:00:00Z', deletedAt: '2026-11-23' },
] }], movements: [
  { id: 'income', cashBoxType: 'BIG_CASH', paymentMethod: 'efectivo', amountBs: 150, createdAt: '2026-11-20T18:53:19Z' },
  { id: 'refund', cashBoxType: 'BIG_CASH', paymentMethod: 'efectivo', amountBs: -36, cashEffectiveDate: '2026-11-22', createdAt: '2026-11-23T14:04:00Z' },
] });

test('3659: application on 22 is informational, original money stays on 20 and refund remains 36', async () => {
  const fixture = guaranteeApplicationFixture();
  const before = structuredClone(fixture);
  const rows = getDailyGuaranteeApplications(fixture.contracts, fixture.movements, '2026-11-22');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountBs, 36);
  assert.equal(rows[0].receipt, 'AG-3659-917318');
  assert.deepEqual(rows[0].origins, [{ receipt: 'RC-773', date: '2026-11-20' }]);
  assert.equal(getDailyGuaranteeApplications(fixture.contracts, fixture.movements, '2026-11-20').length, 0);
  assert.equal(getDailyGuaranteeApplications(fixture.contracts, fixture.movements, '2026-11-23').length, 0);
  const cashRows = [{receipt:'RC-14952', income:0, expense:36, refund:36, damage:0}];
  const totals = totalDailyCashRows(cashRows);
  assert.equal(totals.income, 0); assert.equal(totals.expense, 36); assert.equal(totals.damage, 0);
  const report = { rows: cashRows, date: '2026-11-22', guaranteeApplications: rows };
  const html = buildDailyCashReportHtml(report);
  assert.match(html, /sin movimiento de caja/);
  assert.match(html, /AG-3659-917318/);
  const workbook = await createDailyCashWorkbook(report);
  const info = workbook.getWorksheet('Garantias aplicadas');
  assert.equal(info.getCell('G5').value, 36);
  assert.equal(info.getCell('H5').value, '2026-11-20 RC-773');
  assert.deepEqual(fixture, before);
});

test('daily API returns guarantee applications separately from real cash movements', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { default: express } = await import('express');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-guarantee-report-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'test-guarantee-report';
  let server;
  try {
    const fixture = guaranteeApplicationFixture();
    const state = { contracts: fixture.contracts, cashMovements: fixture.movements, settings: {} };
    await fs.writeFile(process.env.APP_STATE_FILE, JSON.stringify({version:1,state}));
    const app = express(); app.use((await import('../../server/routes/state.js')).default);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/__copetin_db/accounting/daily-report?date=2026-11-22`, {headers:{'X-App-Internal-Key':'test-guarantee-report'}});
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.guaranteeApplications.length, 1);
    assert.equal(result.guaranteeApplications[0].amountBs, 36);
    assert.equal(result.movements.length, 1);
    assert.equal(result.movements[0].amountBs, -36);
    assert.equal(result.movements.filter(row => row.amountBs > 0).length, 0);
    assert.deepEqual(JSON.parse(await fs.readFile(process.env.APP_STATE_FILE, 'utf8')).state, state);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, {recursive:true,force:true});
  }
});
