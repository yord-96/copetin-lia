import assert from 'node:assert/strict';
import test from 'node:test';
import { consolidateReturnIssueLines } from './returnIssues.js';

test('consolida una linea de devolucion repetida sin duplicar la penalizacion', () => {
  const rows = consolidateReturnIssueLines([
    {
      lineKey: 'item-tablecloth-0-0', itemId: 'tablecloth', itemName: 'Mantel',
      missingQty: 1, missingUnitChargeBs: 300, penaltyBs: 300, damageNote: 'Se lo llevo el cliente',
    },
    {
      lineKey: 'item-tablecloth-0-0', itemId: 'tablecloth', itemName: 'Mantel',
      damagedQty: 1, damagedUnitChargeBs: 300, penaltyBs: 300, damageNote: 'Quemado',
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].penaltyBs, 300);
  assert.equal(rows[0].damagedQty, 1);
  assert.equal(rows[0].missingQty, 0);
  assert.equal(rows[0].damageNote, 'Quemado');
});

test('mantiene separadas novedades con claves de linea distintas', () => {
  const rows = consolidateReturnIssueLines([
    { lineKey: 'line-1', itemId: 'glass', missingQty: 1, penaltyBs: 15 },
    { lineKey: 'line-2', itemId: 'glass', missingQty: 1, penaltyBs: 15 },
  ]);
  assert.equal(rows.length, 2);
});

test('acumula daños de etapas distintas y conserva faltantes solo en la ultima', () => {
  const rows = consolidateReturnIssueLines([
    {
      lineKey: 'line-1', previousProcessedQty: 0,
      damagedQty: 1, missingQty: 2, damagedUnitChargeBs: 20, missingUnitChargeBs: 15,
    },
    {
      lineKey: 'line-1', previousProcessedQty: 3,
      damagedQty: 1, missingQty: 1, damagedUnitChargeBs: 20, missingUnitChargeBs: 15,
    },
  ]);
  assert.equal(rows[0].damagedQty, 2);
  assert.equal(rows[0].missingQty, 1);
  assert.equal(rows[0].penaltyBs, 55);
});
