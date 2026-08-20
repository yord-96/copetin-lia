import test from 'node:test';
import assert from 'node:assert/strict';
import { cashMovementMatchesContractReferences } from './contractCashLinks.js';

const references = {
  contractId: 'contract-2026-id',
  rentalId: 'rental-2026-id',
  contractCode: '2026',
  orderCode: 'OS-00658',
  createdAtMs: new Date('2026-08-05T16:26:10.032Z').getTime(),
};

test('does not confuse a contract number with the year inside personnel notes', () => {
  assert.equal(cashMovementMatchesContractReferences({
    type: 'egreso_manual',
    category: 'ADELANTO_PERSONAL',
    accountingTag: 'personnel_advance',
    notes: 'FECHA DE SOLICITUD: 01/08/2026 | ANTICIPO DEL MES DE JULIO',
    description: 'ADELANTO DE SUELDO - PERSONA AJENA',
    createdAt: '2026-08-04T21:31:04.055Z',
  }, references), false);
});

test('accepts immutable IDs and exact modern contract references', () => {
  assert.equal(cashMovementMatchesContractReferences({
    linkedContractId: 'contract-2026-id',
    description: 'SEGUNDO PAGO',
  }, references), true);
  assert.equal(cashMovementMatchesContractReferences({
    contractCode: '2026',
    description: 'COBRO HISTORICO',
  }, references), true);
});

test('rejects a mismatched structured ID even when free text names the contract', () => {
  assert.equal(cashMovementMatchesContractReferences({
    linkedContractId: 'another-contract-id',
    description: 'CONTRATO 2026',
  }, references), false);
});

test('supports only explicit legacy text references', () => {
  assert.equal(cashMovementMatchesContractReferences({
    description: 'COBRO DEL CONTRATO 2026 - CLIENTE',
    createdAt: '2026-08-07T12:00:00.000Z',
  }, references), true);
  assert.equal(cashMovementMatchesContractReferences({
    description: 'RUTA OS-00658 - CLIENTE',
    createdAt: '2026-08-07T12:00:00.000Z',
  }, references), true);
  assert.equal(cashMovementMatchesContractReferences({
    notes: 'OPERACION REALIZADA EL 20/08/2026',
    createdAt: '2026-08-07T12:00:00.000Z',
  }, references), false);
  assert.equal(cashMovementMatchesContractReferences({
    description: 'RUTA OS-006580 - OTRO CONTRATO',
    createdAt: '2026-08-07T12:00:00.000Z',
  }, references), false);
});
