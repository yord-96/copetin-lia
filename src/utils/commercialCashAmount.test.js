import test from 'node:test';
import assert from 'node:assert/strict';
import { getEconomicCommercialCashAmount as commercial } from './commercialCashAmount.js';

test('2732: cobrar daños actualiza sin generar Bs 300 a favor en la tabla', () => {
  const deposit = { amountBs: 1924, accountingTag: 'contract_deposit_receipt', contractAllocationBs: 1924 };
  const damage = { amountBs: 300, accountingTag: 'contract_damage_collection', category: 'cobro_danos_faltantes', collectionTarget: 'damage' };
  const total = rows => rows.reduce((sum, row) => sum + commercial({ amountBs: row.amountBs, rawMovement: row }), 0);
  assert.equal(total([deposit]), 1924);
  assert.equal(total([deposit, damage]), 1924);
  assert.equal(Math.max(0, total([deposit, damage]) - 1924), 0);
});

test('solo suma la porción comercial de recibos mixtos y depósitos con garantía', () => {
  assert.equal(commercial({ amountBs: 600, collectionBreakdown: [
    { target: 'rental', amountBs: 200 }, { target: 'transport', amountBs: 100 },
    { target: 'damage', amountBs: 300 },
  ] }), 300);
  assert.equal(commercial({ amountBs: 1472, accountingTag: 'contract_deposit_receipt', contractAllocationBs: 672, guaranteeAllocationBs: 800 }), 672);
  assert.equal(commercial({ amountBs: 300, collectionTarget: 'extra' }), 0);
  assert.equal(commercial({ amountBs: 300, type: 'ingreso_danos_faltantes' }), 0);
  assert.equal(commercial({ amountBs: 300, type: 'ingreso_alquiler' }), 300);
  assert.equal(commercial({ amountBs: 300, voidedAt: '2026-10-21' }), 0);
});
