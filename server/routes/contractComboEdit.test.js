import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

test('historical combo edits save 174 paid packages, preserve receipts and explain supplier removal', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-combo-edit-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'combo-test';
  const { default: router } = await import('./contractTransactions.js');
  const { replaceStateSnapshot, getStateSnapshot } = await import('../storage/fileStateStore.js');
  const lines = ['chair', 'cushion'].map((id, index) => ({
    itemId: id, itemName: id, lineKey: id, quantity: 174, unitPriceBs: index ? 0 : 12,
    grossLineTotalBs: index ? 0 : 1968, lineTotalBs: index ? 0 : 1968,
    comboId: 'combo', comboLineKey: 'package', comboPricingRole: index ? 'component' : 'price',
    comboQuantity: 164, comboComponentQuantity: 1, comboRuleIndex: index,
  }));
  const plan = lines.map(line => ({ id: 'coverage-' + line.itemId, lineKey: line.lineKey,
    itemId: line.itemId, itemName: line.itemName, supplierId: 'provider', supplierName: 'Provider', neededQty: 10, saleUnitPriceBs: line.unitPriceBs }));
  const fixture = status => ({ settings: {}, clients: [], deliveries: [],
    items: lines.map(line => ({ id: line.itemId, name: line.itemName, totalStock: 300, availableStock: 0 })),
    contracts: [{ id: 'c', contractCode: '1148', rentalId: 'r', status: 'aprobado',
      eventDate: '2026-10-10', deliveryDate: '2026-10-09', pickupDate: '2026-10-11',
      deliveryWindowStart: '08:00', deliveryWindowEnd: '10:00', pickupWindowStart: '10:00', pickupWindowEnd: '12:00',
      items: lines, supplierFulfillmentPlan: plan, totals: { totalBs: 1968 }, payment: { paidAtApprovalBs: 1000 },
      economicLedger: [{ id: 'deposit', type: 'deposit', amountBs: 1000, cashMovementId: 'receipt' }] }],
    rentals: [{ id: 'r', contractId: 'c', status, items: lines.map(line => ({ ...line, internalReservedQty: 164, supplierBackedQty: 10 })),
      operational: { inventoryStatus: status === 'returned' ? 'devuelto' : 'pendiente' }, payment: { paidAtRentalBs: 1000 } }],
    cashMovements: [{ id: 'receipt', linkedContractId: 'c', amountBs: 1000, receiptCode: 'RC-ORIGINAL', cashBoxType: 'BIG_CASH', cashRegisteredAt: null }],
    inventoryMovements: [],
  });
  const app = express(); app.use(express.json()); app.use(router);
  app.use((error, _req, res, next) => { void next; res.status(500).json({ error: error.message }); });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const send = contract => fetch(`http://127.0.0.1:${server.address().port}/__copetin_db/contracts/c/update`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-App-Internal-Key': 'combo-test' }, body: JSON.stringify({ contract }),
  });
  try {
    for (const status of ['returned', 'active']) {
      const initial = fixture(status); await replaceStateSnapshot(initial, (await getStateSnapshot()).revision);
      const before = (await getStateSnapshot()).state;
      const payload = { id: 'c', items: lines, supplierFulfillmentPlan: [] };
      const blocked = await send(payload);
      assert.equal(blocked.status, 409);
      assert.equal((await blocked.json()).code, 'SUPPLIER_PLAN_REMOVAL_CONFIRMATION_REQUIRED');
      assert.equal((await getStateSnapshot()).state.contracts[0].totals.totalBs, 1968, 'rejected edit is atomic');
      const response = await send({ ...payload, confirmSupplierPlanRemoval: true });
      assert.equal(response.status, 200, await response.clone().text());
      const saved = (await getStateSnapshot()).state;
      assert.equal(saved.contracts[0].items[0].lineTotalBs, 2088);
      assert.equal(saved.contracts[0].items[1].lineTotalBs, 0);
      assert.equal(saved.contracts[0].totals.totalBs, 2088);
      assert.equal(saved.rentals[0].items[0].lineTotalBs, 2088);
      assert.equal(saved.rentals[0].status, status);
      assert.deepEqual(saved.cashMovements, before.cashMovements);
      assert.deepEqual(saved.contracts[0].economicLedger, before.contracts[0].economicLedger);
      assert.deepEqual(saved.items.map(row => row.totalStock), [300, 300]);
      if (status === 'returned') assert.deepEqual(saved.inventoryMovements, []);
      else {
        assert.equal(saved.rentals[0].items[0].internalReservedQty, 174);
        assert.ok(saved.inventoryMovements.every(row => row.stockEffect === 'reservation_only'));
        assert.equal(saved.inventoryMovements.find(row => row.itemId === 'chair').deltaUnits, -10);
      }
    }
    const unavailable = fixture('active');
    await replaceStateSnapshot(unavailable, (await getStateSnapshot()).revision);
    const shortage = await send({ id: 'c', items: lines.map(row => ({ ...row, quantity: 10000, comboQuantity: 10000 })), supplierFulfillmentPlan: [], confirmSupplierPlanRemoval: true });
    assert.equal(shortage.status, 409);
    assert.equal((await shortage.json()).code, 'CONTRACT_STOCK_SHORTAGE');
    assert.equal((await getStateSnapshot()).state.contracts[0].totals.totalBs, 1968);
  } finally {
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
