import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryLossWorkbook } from './inventoryLossExcel.js';

test('Excel conserva importes numéricos, códigos y textos; no duplica cobros por contrato', async () => {
  const row = { rentalId: 'r1', contractCode: '0012', orderCode: 'OS-0002', itemName: '=1+1', quantity: 2, unitValueBs: 12.5, totalValueBs: 25, occurredAt: '2026-09-28T16:00:00-04:00', note: 'Daño confirmado' };
  const workbook = await createInventoryLossWorkbook({
    rows: [row, { ...row, quantity: 1, totalValueBs: 12.5 }], activeView: 'danado', query: 'confirmado', dateFrom: '2026-09-01',
    economicsByRental: { r1: { clientChargedBs: 37.5, totalRecoveredBs: 10, pendingRecoveryBs: 27.5, recoveryBreakdown: [{ amountBs: 10, paymentMethod: 'qr' }] } },
  });
  // Round-trip the actual XLSX to catch serialization and formula/type errors.
  await workbook.xlsx.load(await workbook.xlsx.writeBuffer());
  const detail = workbook.getWorksheet('Incidencias');
  assert.equal(detail.getCell('C7').value, '=1+1');
  assert.equal(detail.getCell('H7').value, '0012');
  assert.equal(detail.getCell('F7').value, 12.5);
  assert.ok(detail.getCell('B7').value instanceof Date);
  assert.equal(detail.getCell('G9').value.result, 37.5);
  assert.equal(detail.getCell('E9').value.result, 3);
  assert.equal(detail.getCell('G9').value.formula, 'SUBTOTAL(109,G7:G8)');
  const contracts = workbook.getWorksheet('Cobros por contrato');
  assert.equal(contracts.getCell('D8').value.result, 37.5);
  assert.equal(workbook.getWorksheet('Recuperaciones').getCell('G8').value.result, 10);
  assert.match(workbook.getWorksheet('Resumen').getCell('A3').value, /confirmado/);
});

test('Excel de faltantes maneja datos vacíos y fechas inválidas', async () => {
  const empty = await createInventoryLossWorkbook({ rows: [], activeView: 'faltante' });
  assert.equal(empty.getWorksheet('Resumen').getCell('B7').value, 0);
  assert.match(empty.getWorksheet('Incidencias').getCell('A7').value, /Sin registros/);
  const workbook = await createInventoryLossWorkbook({ rows: [{ occurredAt: 'fecha desconocida' }], activeView: 'faltante' });
  assert.equal(workbook.getWorksheet('Incidencias').getCell('B7').value, 'fecha desconocida');
  assert.equal(workbook.getWorksheet('Incidencias').getCell('G7').value, 0);
});
