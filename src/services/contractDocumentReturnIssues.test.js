import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractDocumentHtml } from './webBridge.js';

const lines = [
  { lineKey: 'paid', itemId: 'cup', itemName: 'COPA MORADA', quantity: 35, unitPriceBs: 4, lineTotalBs: 140 },
  { lineKey: 'courtesy', itemId: 'cup', itemName: 'COPA MORADA CORTESIA', quantity: 5, unitPriceBs: 0, lineTotalBs: 0, lineType: 'courtesy' },
];
const issue = key => ({ itemId: 'cup', lineKey: key, missingQty: 5, missingUnitChargeBs: 35, missingFeeBs: 175 });
const html = (rows, issues) => buildContractDocumentHtml({
  contract: { contractCode: '3450', items: rows, totals: { totalBs: 140 } },
  rental: { items: rows, totals: { totalBs: 140 }, returnReport: issues }, deliveries: [], settings: {},
});
const issueRows = document => (document.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? []).filter(row => row.includes('F5×35=175'));

test('missing cups appear only on their own row, never repeated on courtesy', () => {
  const rows = issueRows(html(lines, [issue('paid')]));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /COPA MORADA/);
  assert.doesNotMatch(rows[0], /COPA MORADA CORTESIA/);
  const reversed = issueRows(html([...lines].reverse(), [issue('paid')]));
  assert.equal(reversed.length, 1);
  assert.doesNotMatch(reversed[0], /COPA MORADA CORTESIA/);
});

test('courtesy can have its own real issue without being copied to the paid row', () => {
  const rows = issueRows(html(lines, [issue('courtesy')]));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /COPA MORADA CORTESIA/);
});

test('legacy issues without a line key are printed once and separate keyed issues remain separate', () => {
  assert.equal(issueRows(html(lines, [issue('')])).length, 1);
  assert.equal(issueRows(html(lines, [issue('paid'), issue('courtesy')])).length, 2);
});
