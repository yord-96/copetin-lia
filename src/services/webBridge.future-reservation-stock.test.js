import test from 'node:test';
import assert from 'node:assert/strict';

import { getWebBridge } from './webBridge.js';

test('una reserva futura activa descuenta el stock libre desde que el contrato queda guardado', async () => {
  const bridge = getWebBridge();
  const itemId = 'mantel-huesito';
  const rentalId = 'rental-futuro';

  await bridge.__storage.replaceState({
    settings: {},
    items: [{
      id: itemId,
      name: 'MANTEL ARRUGADO / AMERICANO HUESITO',
      category: 'MANTELERIA',
      totalStock: 19,
      availableStock: 19,
      controlsStock: true,
      verificationStatus: 'verified',
    }],
    rentals: [{
      id: rentalId,
      contractId: 'contract-futuro',
      contractCode: '2510',
      orderCode: 'OS-01142',
      customerName: 'CLIENTE TEST',
      customerPhone: '70000000',
      status: 'active',
      rentalDate: '2099-09-11',
      dueDate: '2099-09-13',
      operational: { inventoryStatus: 'pendiente' },
      items: [{
        lineKey: 'linea-mantel',
        itemId,
        itemName: 'MANTEL ARRUGADO / AMERICANO HUESITO',
        quantity: 12,
        supplierBackedQty: 0,
        internalReservedQty: 12,
        controlsStock: true,
        verificationStatus: 'verified',
      }],
    }],
    contracts: [{
      id: 'contract-futuro',
      contractCode: '2510',
      rentalId,
      orderCode: 'OS-01142',
      status: 'aprobado',
    }],
  });

  const state = await bridge.__storage.exportState();
  const item = state.items.find((entry) => entry.id === itemId);

  assert.equal(item.totalStock, 19);
  assert.equal(item.availableStock, 7);
});

test('una devolucion parcial reinserta lo devuelto y deja comprometido solo lo que sigue con el cliente', async () => {
  const bridge = getWebBridge();
  const itemId = 'capuchon-hueso-parcial';
  const rentalId = 'rental-parcial';

  await bridge.__storage.replaceState({
    settings: { missingMultiplier: 2, damageMultiplier: 1.2 },
    items: [{
      id: itemId,
      name: 'CAPUCHON ARRUGADO BOAL / HUESO',
      category: 'CAPUCHON',
      totalStock: 371,
      availableStock: 291,
      controlsStock: true,
      verificationStatus: 'verified',
    }],
    rentals: [{
      id: rentalId,
      contractId: 'contract-parcial',
      contractCode: '1401',
      orderCode: 'OS-00181',
      customerName: 'CLIENTE TEST',
      customerPhone: '70000000',
      status: 'active',
      rentalDate: '2099-08-06',
      dueDate: '2099-08-07',
      depositBs: 0,
      totals: { totalBs: 0, paidAtRentalBs: 0 },
      payment: { paidAtRentalBs: 0 },
      operational: { inventoryStatus: 'salio' },
      items: [{
        lineKey: 'linea-capuchon',
        itemId,
        itemName: 'CAPUCHON ARRUGADO BOAL / HUESO',
        quantity: 80,
        supplierBackedQty: 0,
        internalReservedQty: 80,
        controlsStock: true,
        verificationStatus: 'verified',
        rentalPriceBs: 0,
      }],
    }],
    contracts: [{
      id: 'contract-parcial',
      contractCode: '1401',
      rentalId,
      orderCode: 'OS-00181',
      status: 'aprobado',
      totals: { totalBs: 0 },
    }],
    deliveries: [],
    stockRecoveries: [],
    inventoryMovements: [],
    cashSessions: [],
    cashMovements: [],
  });

  await bridge.rentals.registerReturn({
    rentalId,
    requireCashSession: false,
    partialReturn: true,
    returnReview: { status: 'left_with_client', note: 'CLIENTE NO DEVOLVIO 2' },
    clientPendingPickup: { active: true, note: 'CLIENTE NO DEVOLVIO 2' },
    returnedItems: [{
      sourceLineIndex: 0,
      lineKey: 'linea-capuchon',
      itemId,
      itemName: 'CAPUCHON ARRUGADO BOAL / HUESO',
      returnedQty: 78,
      damagedQty: 0,
      missingQty: 0,
      pendingClientQty: 2,
      damageNote: 'CLIENTE NO DEVOLVIO 2',
      chargeOwner: 'cliente',
    }],
  });

  let state = await bridge.__storage.exportState();
  let item = state.items.find((entry) => entry.id === itemId);
  let rental = state.rentals.find((entry) => entry.id === rentalId);

  assert.equal(item.totalStock, 371, 'las 2 unidades siguen siendo propiedad de la empresa');
  assert.equal(item.availableStock, 369, 'solo las 2 unidades que siguen con el cliente quedan fuera');
  assert.equal(rental.operational.clientPendingPickup.items[0].pendingQty, 2);
  assert.equal(rental.partialReturnReport.items[0].returnedToAvailableQty, 78);
  assert.equal(rental.partialReturnReport.items[0].pendingClientQty, 2);

  await bridge.rentals.registerReturn({
    rentalId,
    requireCashSession: false,
    partialReturn: false,
    returnReview: { status: 'complete', note: '' },
    clientPendingPickup: { active: false, note: '' },
    returnedItems: [{
      sourceLineIndex: 0,
      lineKey: 'linea-capuchon',
      itemId,
      itemName: 'CAPUCHON ARRUGADO BOAL / HUESO',
      returnedQty: 2,
      damagedQty: 0,
      missingQty: 0,
      pendingClientQty: 0,
      damageNote: '',
      chargeOwner: 'cliente',
    }],
  });

  state = await bridge.__storage.exportState();
  item = state.items.find((entry) => entry.id === itemId);
  rental = state.rentals.find((entry) => entry.id === rentalId);

  assert.equal(item.totalStock, 371);
  assert.equal(item.availableStock, 371);
  assert.equal(rental.status, 'returned');
  assert.equal(rental.operational.clientPendingPickup, null);
});


test('reparar una aprobacion conserva el prepago historico sin volver a descontarlo', async () => {
  const bridge = getWebBridge();
  const clientId = 'cliente-prepago-reparacion';
  const itemId = 'item-prepago-reparacion';

  await bridge.__storage.replaceState({
    settings: {
      numbering: {
        serviceOrderPrefix: 'OS-',
        serviceOrderNext: 1,
      },
    },
    clients: [{
      id: clientId,
      name: 'CLIENTE PREPAGO',
      phone: '70000000',
      prepaidEnabled: true,
      prepaidBalanceBs: 200,
      prepaidTotalUsedBs: 300,
      prepaidMovements: [{
        id: 'pre-historico',
        type: 'charge',
        amountBs: -300,
        description: 'Consumo prepago historico',
        balanceAfterBs: 200,
        createdAt: '2099-01-01T00:00:00.000Z',
      }],
    }],
    items: [{
      id: itemId,
      name: 'ITEM SIN STOCK',
      category: 'SERVICIO',
      rentalPriceBs: 1000,
      totalStock: 0,
      availableStock: 0,
      controlsStock: false,
      verificationStatus: 'pending_verification',
    }],
    contracts: [],
    rentals: [],
    deliveries: [],
    inventoryMovements: [],
    cashMovements: [],
    generatedReports: [],
    supplierLoans: [],
  });

  const rental = await bridge.rentals.create({
    customerName: 'CLIENTE PREPAGO',
    customerPhone: '70000000',
    contractId: 'contrato-reparacion',
    contractCode: '9999',
    rentalDate: '2099-10-10',
    dueDate: '2099-10-11',
    dueTime: '22:00',
    eventDate: '2099-10-10',
    paymentMode: 'a_cuenta',
    prepaidClientId: clientId,
    prepaidAppliedBs: 300,
    paidAtRentalBs: 800,
    items: [{
      itemId,
      quantity: 1,
      unitPriceBs: 1000,
      rentalPriceBs: 1000,
      controlsStock: false,
    }],
  }, {
    registerInitialCash: false,
    registerPrepaidUsage: false,
  });

  const state = await bridge.__storage.exportState();
  const client = state.clients.find((entry) => entry.id === clientId);

  assert.equal(rental.prepaidAppliedBs, 300);
  assert.equal(rental.payment.prepaidAppliedBs, 300);
  assert.equal(rental.payment.paidAtRentalBs, 800);
  assert.equal(rental.payment.cashCollectedBs, 500);
  assert.equal(client.prepaidBalanceBs, 200, 'la reparacion no vuelve a consumir el prepago');
  assert.equal(client.prepaidTotalUsedBs, 300);
  assert.equal(client.prepaidMovements.length, 1, 'no agrega un segundo movimiento prepago');
  assert.equal(state.cashMovements.length, 0, 'la reparacion no duplica movimientos de caja');
});
