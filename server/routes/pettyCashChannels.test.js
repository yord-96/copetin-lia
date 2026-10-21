import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('petty cash and digital: independent funds, banks, CRUD and histories preserve Big Cash', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-petty-channels-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'petty-channel-test';
  const { default: router } = await import('./state.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  const big = { id: 'big', cashRegisteredAt: null, cashBoxType: 'BIG_CASH', amountBs: 5000, paymentMethod: 'qr', paymentAccount: 'BANCO FIE', createdAt: '2026-10-01T12:00:00Z' };
  await replaceStateSnapshot({ settings: {}, cashMovements: [big], cashSessions: [], cashDebts: [], supplierLoans: [] }, null);
  const originalBig = structuredClone((await getStateSnapshot()).state.cashMovements.find(row => row.id === big.id));
  const app = express(); app.use(express.json()); app.use(router);
  app.use((error, req, res, next) => { void next; res.status(error.statusCode || 500).json({ error: error.message }); });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__copetin_db`;
  const send = (url, method = 'GET', payload) => fetch(base + url, { method, headers: { 'X-App-Internal-Key': 'petty-channel-test', 'Content-Type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const movement = (amountBs, paymentMethod, paymentAccount = '', type = 'ingreso') => send('/cash/movement', 'POST', {
    amountBs, paymentMethod, paymentAccount, type, cashBoxType: 'PETTY_CASH', description: 'QA funds',
    category: 'ingreso_fondos', accountingTag: 'petty_cash_fund_in', createdBy: 'QA',
  });
  try {
    const cashResponse = await movement(200, 'efectivo'); assert.equal(cashResponse.status, 200, await cashResponse.clone().text());
    const cash = (await cashResponse.json()).movement;
    const qrResponse = await movement(500, 'qr', 'BANCO FIE'); assert.equal(qrResponse.status, 200, await qrResponse.clone().text());
    const qr = (await qrResponse.json()).movement;
    assert.equal((await movement(1000, 'qr', 'CIDRE')).status, 200);
    assert.equal((await movement(201, 'efectivo', '', 'egreso')).status, 400, 'digital cannot fund cash');
    assert.equal((await movement(501, 'qr', 'BANCO FIE', 'egreso')).status, 400, 'other bank cannot fund FIE');
    assert.equal((await movement(1, 'qr', 'UNKNOWN')).status, 400);
    assert.equal((await movement(100, 'qr', 'BANCO FIE', 'egreso')).status, 200);
    assert.equal((await send(`/cash/petty-expense/${qr.id}`, 'PATCH', { description: 'QA edit', amountBs: 50, paymentMethod: 'qr', paymentAccount: 'BANCO FIE' })).status, 400, 'spent income cannot be reduced');
    assert.equal((await send(`/cash/petty-expense/${cash.id}`, 'PATCH', { description: 'QA edit', amountBs: 200, paymentMethod: 'qr', paymentAccount: 'CIDRE' })).status, 400, 'editing cannot transfer between boxes');
    assert.equal((await send(`/cash/petty-expense/${qr.id}`, 'DELETE', { reason: 'QA', userRole: 'developer' })).status, 400, 'spent income cannot be deleted');
    const cashHistory = await (await send('/accounting/petty-sector?sector=history&channel=cash')).json();
    const digitalHistory = await (await send('/accounting/petty-sector?sector=history&channel=digital')).json();
    assert.equal(cashHistory.total, 1); assert.equal(digitalHistory.total, 3);
    assert.equal(cashHistory.rows[0].fundBalanceBs, 200);
    assert.equal(digitalHistory.rows.reduce((sum, row) => sum + Number(row.amountBs), 0), 1400);
    assert.ok(!digitalHistory.rows.some(row => row.id === cash.id || row.id === big.id));
    assert.equal((await send(`/cash/petty-expense/${cash.id}`, 'PATCH', { description: 'QA edit', amountBs: 250, paymentMethod: 'efectivo' })).status, 200);
    assert.equal((await send(`/cash/petty-expense/${cash.id}`, 'DELETE', { reason: 'QA', userRole: 'developer' })).status, 200);
    assert.deepEqual((await getStateSnapshot()).state.cashMovements.find(row => row.id === big.id), originalBig);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (directory.startsWith(path.join(os.tmpdir(), 'copetin-petty-channels-'))) await fs.rm(directory, { recursive: true, force: true });
  }
});
