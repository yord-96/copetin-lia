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
