import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateGuaranteePaidEvidence,
  calculateGuaranteeSettlement,
  getGuaranteeLedgerEvidence,
  getGuaranteeResolutionLabel,
  getStoredGuaranteeValidation,
} from './guaranteeSettlement.js';

test('reconoce una garantía apartada dentro de un pago combinado', () => {
  const movements = [{
    type: 'cobro_saldo_devolucion',
    amountBs: 1956,
    contractAllocationBs: 1786,
    guaranteeAllocationBs: 170,
  }];

  assert.equal(
    calculateGuaranteePaidEvidence(movements, (movement) => movement.type === 'ingreso_garantia'),
    170,
  );
});

test('no duplica una garantía directa que también conserva su asignación', () => {
  const movements = [{ type: 'ingreso_garantia', amountBs: 170, guaranteeAllocationBs: 170 }];
  assert.equal(
    calculateGuaranteePaidEvidence(movements, (movement) => movement.type === 'ingreso_garantia'),
    170,
  );
});

test('mantiene pendiente el saldo de una devolución parcial', () => {
  assert.deepEqual(calculateGuaranteeSettlement({
    paidBs: 170,
    appliedBs: 0,
    refundedBs: 150,
  }), {
    paidBs: 170,
    appliedBs: 0,
    refundableBeforeRefundBs: 170,
    refundedBs: 150,
    pendingRefundBs: 20,
    isPartiallyRefunded: true,
    isFullyResolved: false,
  });
});

test('considera finalizada una garantía completamente devuelta', () => {
  const result = calculateGuaranteeSettlement({ paidBs: 170, refundedBs: 170 });
  assert.equal(result.pendingRefundBs, 0);
  assert.equal(result.isPartiallyRefunded, false);
  assert.equal(result.isFullyResolved, true);
});

test('combina monto aplicado y devolución sin exceder la garantía pagada', () => {
  const result = calculateGuaranteeSettlement({ paidBs: 170, appliedBs: 20, refundedBs: 150 });
  assert.equal(result.appliedBs, 20);
  assert.equal(result.refundedBs, 150);
  assert.equal(result.pendingRefundBs, 0);
  assert.equal(result.isFullyResolved, true);
});

test('reconstruye una garantia combinada y su devolucion parcial desde la hoja economica', () => {
  const contract = {
    economicLedger: [
      {
        id: 'deposit-1',
        type: 'deposit',
        amountBs: 1956,
        contractAllocationBs: 1786,
        guaranteeAllocationBs: 170,
        cashMovementId: 'cash-payment',
        cashReceiptCode: 'RC-6511',
        paymentMethod: 'qr',
        paymentAccount: 'MERCANTIL',
      },
      {
        id: 'guarantee-1',
        type: 'guarantee',
        amountBs: 170,
        reclassifiedFromPayment: true,
        sourceDepositId: 'deposit-1',
      },
      {
        id: 'refund-1',
        type: 'refund',
        refundSource: 'guarantee',
        amountBs: 150,
        cashMovementId: 'cash-refund',
        cashReceiptCode: 'RC-6513',
      },
    ],
  };

  const evidence = getGuaranteeLedgerEvidence(contract);
  assert.equal(evidence.paidBs, 170);
  assert.equal(evidence.appliedBs, 0);
  assert.equal(evidence.refundedBs, 150);
  assert.equal(evidence.paymentEntries.length, 1);
  assert.equal(evidence.applicationEntries.length, 0);
  assert.equal(evidence.refundEntries.length, 1);
});

test('no trata como pagada una garantia sin evidencia de caja', () => {
  const evidence = getGuaranteeLedgerEvidence({
    economicLedger: [{ type: 'guarantee', amountBs: 170 }],
  });
  assert.equal(evidence.paidBs, 0);
  assert.equal(evidence.appliedBs, 0);
  assert.equal(evidence.refundedBs, 0);
});

test('no aplica automaticamente la garantia por el solo hecho de existir danos', () => {
  const evidence = getGuaranteeLedgerEvidence({
    economicLedger: [{
      type: 'guarantee',
      amountBs: 117.7,
      cashMovementId: 'cash-guarantee',
    }],
  });

  assert.equal(evidence.paidBs, 117.7);
  assert.equal(evidence.appliedBs, 0);
  assert.equal(evidence.applicationEntries.length, 0);
});

test('solo reconoce como aplicada la garantia registrada en la hoja economica', () => {
  const evidence = getGuaranteeLedgerEvidence({
    economicLedger: [
      { type: 'guarantee', amountBs: 117.7, cashMovementId: 'cash-guarantee' },
      { id: 'apply-1', type: 'charge', amountBs: 117.7, note: 'Aplicado contra la garantia' },
      {
        id: 'cash-damage-1',
        type: 'charge',
        amountBs: 35,
        cashCollectionTarget: 'damage',
        cashMovementId: 'cash-damage',
      },
    ],
  });

  assert.equal(evidence.appliedBs, 117.7);
  assert.equal(evidence.applicationEntries.length, 1);
  assert.equal(evidence.applicationEntries[0].id, 'apply-1');
});

test('una validacion positiva del contrato prevalece sobre el estado antiguo del alquiler', () => {
  assert.deepEqual(getStoredGuaranteeValidation({
    declaredBs: 150,
    rental: {
      depositBs: 150,
      guarantee: { status: 'no_validado', validatedBs: 0 },
      payment: { guaranteeStatus: 'no_validado' },
    },
    contract: {
      guarantee: { status: 'validado' },
      payment: { guaranteeStatus: 'validado' },
    },
  }), {
    isValidated: true,
    validatedBs: 150,
  });
});

test('distingue una garantia consumida por danos de una garantia devuelta', () => {
  assert.equal(
    getGuaranteeResolutionLabel({ appliedBs: 117.7, refundedBs: 0 }),
    'Aplicada a daños',
  );
  assert.equal(
    getGuaranteeResolutionLabel({ appliedBs: 0, refundedBs: 150 }),
    'Devuelta y finalizada',
  );
});
