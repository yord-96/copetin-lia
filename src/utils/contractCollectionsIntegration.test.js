import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import process from 'node:process';

test('2808 receipt date reaches daily report; 2404 deleted damage receipt does not block recollection or misclassify General', async () => {
  const filename = path.join(os.tmpdir(), `copetin-collections-${crypto.randomUUID()}.json`);
  process.env.APP_STATE_FILE = filename;
  process.env.APP_INTERNAL_KEY = 'collections-test';
  let server;
  try {
    const contracts = ['damage', 'general'].map(id => ({ id: `c-${id}`, contractCode: id,
      rentalId: `r-${id}`, orderCode: `OS-${id}`, status: 'aprobado', totals: { totalBs: 504 }, economicLedger: [] }));
    const rentals = contracts.map(c => ({ id: c.rentalId, contractId: c.id, orderCode: c.orderCode, status: 'returned',
      totals: { totalBs: 504 }, payment: { paidAtRentalBs: 504, pendingPaymentBs: 164 }, penaltiesBs: 164,
      returnReport: [{ penaltyBs: 164, chargeOwner: 'cliente' }],
      returnSettlement: { penaltiesBs: 164, outstandingRentalBs: 164, pendingCollectionBs: 164 } }));
    const cashMovements = contracts.map(c => ({ id: `deleted-${c.id}`, linkedContractId: c.id, linkedRentalId: c.rentalId,
      linkedOrderCode: c.orderCode, amountBs: 164, collectionTarget: 'damage', damageCollectedBs: 164,
      collectionBreakdown: [{ target: 'damage', amountBs: 164 }], deletedAt: '2026-10-08', receiptStatus: 'eliminado' }));
    cashMovements.push({ id: 'refund-2808', receiptCode: 'RC-1701', amountBs: -200, type: 'egreso_manual',
      accountingTag: 'guarantee_refund', cashBoxType: 'BIG_CASH', paymentMethod: 'efectivo', cashLedgerSequence: 20,
      cashEffectiveDate: '2026-10-08', createdAt: '2026-10-08T04:01:58Z',
      receiptIssuedAt: '2026-10-01T13:01:00Z', receiptEditedAt: '2026-10-08T04:02:29Z' });
    await fs.writeFile(filename, JSON.stringify({ version: 1, state: { settings: {}, contracts, rentals, cashMovements } }));
    const app = express(); app.use(express.json()); app.use((await import('../../server/routes/state.js')).default);
    app.use((error, req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.message }));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'Content-Type': 'application/json', 'X-App-Internal-Key': 'collections-test' };
    const day1 = await (await fetch(`${url}/__copetin_db/accounting/daily-report?date=2026-10-01`, { headers })).json();
    assert.ok(day1.movements.some(row => row.id === 'refund-2808'));
    const day8 = await (await fetch(`${url}/__copetin_db/accounting/daily-report?date=2026-10-08`, { headers })).json();
    assert.ok(!day8.movements.some(row => row.id === 'refund-2808'));
    for (const id of ['damage', 'general']) {
      const target = id === 'general' ? 'balance' : 'damage';
      const payload = { rentalId: `r-${id}`, linkedContractId: `c-${id}`, linkedOrderCode: `OS-${id}`,
        amountBs: 164, collectionTarget: target, collectionBreakdown: [{ target, amountBs: 164 }],
        category: target === 'balance' ? 'cobro_contrato' : 'cobro_danos_faltantes',
        accountingTag: target === 'balance' ? 'contract_economic_collection' : 'contract_damage_collection', paymentMethod: 'efectivo' };
      const response = await fetch(`${url}/__copetin_db/cash/collect-receivable`, { method: 'POST', headers, body: JSON.stringify(payload) });
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data));
      const snapshot = await (await import('../../server/storage/fileStateStore.js')).getStateSnapshot();
      const movement = snapshot.state.cashMovements.find(row => row.linkedContractId === `c-${id}` && !row.deletedAt);
      assert.equal(movement.collectionTarget, 'damage');
      assert.equal(movement.damageCollectedBs, 164);
      assert.equal(movement.contractAllocationBs, 0);
      assert.equal(snapshot.state.rentals.find(row => row.id === `r-${id}`).payment.paidAtRentalBs, 504);
      const repeated = await fetch(`${url}/__copetin_db/cash/collect-receivable`, { method: 'POST', headers, body: JSON.stringify(payload) });
      assert.equal(repeated.status, 409);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.unlink(filename).catch(() => {});
  }
});
