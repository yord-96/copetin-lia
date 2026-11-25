import test from 'node:test';
import assert from 'node:assert/strict';
import { lincolnContractors } from './lincolnContractors.js';
import { normalizeLincolnContractDocument, buildLincolnContractDocumentHtml } from '../server/services/lincoln/lincolnContractDocumentService.js';

test('additional responsible people survive normalization and appear with identification, contact and signature', () => {
  const snapshot = { contractor1Name: 'Titular Uno', contractor2Name: 'Titular Dos', additionalContractors: [
    { name: 'Responsable Tres', ci: 'CI-333', phone: '70000003' },
    { name: 'Responsable <Cuatro>', ci: 'CI-444', phone: '70000004' },
  ] };
  const event = { contractDocumentSnapshot: snapshot };
  const doc = normalizeLincolnContractDocument(event);
  assert.equal(lincolnContractors(doc).length, 4);
  const html = buildLincolnContractDocumentHtml({ event });
  for (const value of ['Responsable Tres', 'Responsable &lt;Cuatro&gt;', 'CI-333', 'CI-444', '70000003', '70000004']) assert.ok(html.includes(value), value);
  assert.equal((html.match(/class="signature-box"/g) || []).length, 5);
  assert.ok(html.includes('signature-area has-additional'));
  assert.equal(lincolnContractors({ clientName: 'Cliente anterior', secondContractorName: 'Segundo' }).length, 2);
  assert.equal(lincolnContractors({ additionalContractors: [{ name: ' ' }] }).length, 0);
});
