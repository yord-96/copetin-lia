import assert from 'node:assert/strict';
import test from 'node:test';
import { buildItemLoanDocumentHtml } from './itemLoanDocument.js';

test('loan document uses only active returns for balances and preserves voided history', () => {
  const loan = { code: 'PR-00001', kind: 'legacy', personName: 'Jimena', phone: '70000000', document: '123456', date: '2025-10-27', dueDate: '',
    lines: [{ id: 'l', itemName: 'MANTEL BLANCO', quantity: 10 }], returns: [
      { lineId: 'l', date: '2026-11-09', quantity: 3, note: 'Entrega parcial' },
      { lineId: 'l', date: '2026-11-08', quantity: 5, deletedAt: '2026-11-09' },
    ] };
  const html = buildItemLoanDocumentHtml({ loan });
  assert.match(html, /Unidades prestadas<\/small><strong>10/);
  assert.match(html, /Unidades devueltas<\/small><strong>3/);
  assert.match(html, /Unidades pendientes<\/small><strong>7/);
  assert.match(html, /Anulada/);
  assert.match(html, /Entrega parcial/);
  assert.match(html, /Por coordinar/);
  assert.match(html, /27\/10\/2025/);
  assert.match(html, /Antiguo/);
  assert.match(html, /Recibido por/);
});

test('document escapes names and observations and identifies a fully returned loan', () => {
  const html = buildItemLoanDocumentHtml({ loan: { code: 'PR-2', personName: '<script>alert(1)</script>', notes: 'Detalle <img src=x> & notas', lines: [{ id: 'l', itemName: 'Mesa <grande>', quantity: 2 }], returns: [{ lineId: 'l', quantity: 2 }] }, settings: { companyName: '<empresa>' } });
  assert.doesNotMatch(html, /<script>|<img src=x>|Mesa <grande>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Mesa &lt;grande&gt;/);
  assert.match(html, /Devuelto por completo/);
  assert.match(html, /Unidades pendientes<\/small><strong>0/);
});
