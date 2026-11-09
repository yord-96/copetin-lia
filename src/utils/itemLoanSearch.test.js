import assert from 'node:assert/strict';
import test from 'node:test';
import { searchLoanClients, searchLoanItems } from './itemLoanSearch.js';

test('product search matches accents, unordered words and SKU across the full catalog', () => {
  const items = Array.from({ length: 90 }, (_, i) => ({ id: i, name: `SOBRE MANTEL ${i}`, sku: `SKU-${i}` }));
  items.push({ id: 'exact', name: 'MANTEL', sku: 'M-100' }, { id: 'blue', name: 'MANTEL SATINADO / AZÚL MARINO', sku: 'M-101' });
  assert.equal(searchLoanItems(items, 'mantel')[0].id, 'exact');
  assert.equal(searchLoanItems(items, 'azul mantel')[0].id, 'blue');
  assert.equal(searchLoanItems(items, '  m-101  ')[0].id, 'blue');
  assert.equal(searchLoanItems(items, 'sobre mantel').length, 90);
  assert.deepEqual(searchLoanItems(items, 'inexistente'), []);
});

test('client suggestions find names, phone and CI without including deleted clients', () => {
  const clients = [{ id: 'a', name: 'Jimena Illanes LUXOR', phone: '76436878', ci: '123456' }, { id: 'b', name: 'JIMÉNA', phone: '' }, { id: 'c', name: 'Jimena eliminada', deletedAt: '2026-11-01' }];
  assert.equal(searchLoanClients(clients, 'jimena')[0].id, 'b');
  assert.equal(searchLoanClients(clients, 'luxor jimena')[0].id, 'a');
  assert.equal(searchLoanClients(clients, '7643')[0].id, 'a');
  assert.equal(searchLoanClients(clients, '123456')[0].id, 'a');
  assert.equal(searchLoanClients(clients, 'jimena').length, 2);
  assert.deepEqual(searchLoanClients(clients, ' '), []);
});
