import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVipWorkspace, mutateVipAccount, previewVipMerge, vipContractToken } from './vipPrepaidWorkspace.js';

export const fixture = () => ({
  users: [{ id: 'operator', fullName: 'Operador', role: 'developer', roleIds: ['developer'] }],
  clients: [
    { id: 'vip', name: 'Daniela Ayala', phone: '76977764', prepaidEnabled: true, prepaidBalanceBs: 200, prepaidTotalDepositedBs: 200, prepaidTotalUsedBs: 0, prepaidMovements: [{ id: 'opening', type: 'deposit', amountBs: 200, createdAt: '2026-10-01' }], updatedAt: 'original' },
    { id: 'duplicate', name: 'Daniela Ayala, Casa Jardin', phone: '76977764', prepaidBalanceBs: 0, deliveryAddresses: [{ id: 'address', address: 'Casa Jardin' }], prepaidMovements: [], updatedAt: 'original' },
    { id: 'other', name: 'Otra cliente', phone: '70000000' },
  ],
  contracts: [{ id: 'c', clientId: 'duplicate', customerName: 'Daniela Ayala', contractCode: '100', rentalId: 'r', status: 'aprobado', eventDate: '2026-11-24', totals: { totalBs: 100 }, payment: { paidAtApprovalBs: 0 }, items: [{ itemId: 'item', itemName: 'Cojines', quantity: 20, lineTotalBs: 100 }] }],
  rentals: [{ id: 'r', clientId: 'duplicate', customerName: 'Daniela Ayala', contractId: 'c', orderCode: 'OS-100', totals: { totalBs: 100 }, payment: { paidAtRentalBs: 0 }, returnSettlement: { penaltiesBs: 30 } }],
  quotes: [{ id: 'q', clientId: 'duplicate' }], legacyContracts: [{ id: 'old', clientId: 'duplicate' }],
  cashMovements: [{ id: 'unrelated-cash', sourceId: 'other', amountBs: 50 }], systemAuditLog: [],
});
const merge = state => {
  const plan = previewVipMerge(state, 'vip', ['duplicate']);
  const payload = { action: 'merge', clientId: 'vip', sourceIds: ['duplicate'], previewToken: plan.token, clientOperationId: 'merge-1', actorUserId: 'operator', reason: 'Misma cliente, mismo teléfono' };
  mutateVipAccount(state, payload, '2026-11-24T15:00:00Z'); return payload;
};
const payment = (state, extra = {}) => ({ action: 'settle', clientId: 'vip', contractId: 'c', mode: 'balance', serviceBs: 100, damageBs: 30, date: '2026-11-24', reference: 'Contrato 100', reason: 'Conciliación comprobada', actorUserId: 'operator', clientOperationId: 'settlement-1', expectedBalanceBs: state.clients[0].prepaidBalanceBs, expectedUpdatedAt: state.clients[0].updatedAt, expectedContractToken: vipContractToken(state, 'c'), ...extra });

test('merge preserves money and history, transfers all references and is idempotent', () => {
  const s = fixture(); const cash = structuredClone(s.cashMovements);
  const before = JSON.stringify(s);
  assert.equal(buildVipWorkspace(s, 'vip').mergeCandidates.length, 1);
  assert.equal(JSON.stringify(s), before, 'read workspace must not mutate');
  const payload = merge(s);
  for (const name of ['contracts', 'rentals', 'quotes', 'legacyContracts']) assert.equal(s[name][0].clientId, 'vip');
  assert.deepEqual(s.cashMovements, cash); assert.equal(s.clients[0].prepaidBalanceBs, 200);
  assert.equal(s.clients[1].mergedIntoClientId, 'vip'); assert.ok(s.clients[1].deletedAt);
  assert.equal(buildVipWorkspace(s, 'vip').rows.length, 1);
  assert.equal(mutateVipAccount(s, payload).duplicate, true);
  assert.throws(() => mutateVipAccount(s, { ...payload, reason: 'Changed' }), /ya guardó/);
});
test('merge preview becomes invalid if a new contract arrives before confirmation', () => {
  const s = fixture();const plan = previewVipMerge(s, 'vip', ['duplicate']);
  s.contracts.push({ id: 'new', clientId: 'duplicate' });
  assert.throws(() => mutateVipAccount(s, { action: 'merge', clientId: 'vip', sourceIds: ['duplicate'], previewToken: plan.token, reason: 'test', actorUserId: 'operator', clientOperationId: 'stale' }), /datos cambiaron/);
  assert.equal(s.clients[1].deletedAt, undefined);
});
test('VIP application pays service and damage once without adding cash or counting damage as service', () => {
  const s = fixture();merge(s);const cash = structuredClone(s.cashMovements);const payload = payment(s);
  mutateVipAccount(s, payload);
  assert.equal(s.clients[0].prepaidBalanceBs, 70);assert.deepEqual(s.cashMovements, cash);
  const result = buildVipWorkspace(s, 'vip');const row = result.rows[0];
  assert.equal(row.paidBs, 100);assert.equal(row.damagePendingBs, 0);assert.equal(row.totalPendingBs, 0);assert.equal(row.prepaidBs, 100);assert.equal(row.vipConsumedBs, 130);
  assert.equal(s.contracts[0].economicLedger[0].type, 'note');
  assert.equal(mutateVipAccount(s, payload).duplicate, true);assert.equal(s.clients[0].prepaidBalanceBs, 70);
  assert.throws(() => mutateVipAccount(s, payment(s, { clientOperationId: 'overpay', serviceBs: 1, damageBs: 0 })), /supera/);
});
test('historical cancellation leaves current VIP balance unchanged, requires no second deposit', () => {
  const s = fixture();merge(s);const payload = payment(s, { mode: 'historical' });
  mutateVipAccount(s, payload);
  const result = buildVipWorkspace(s, 'vip');assert.equal(result.rows[0].totalPendingBs, 0);assert.equal(result.rows[0].historicalPaidBs, 130);
  assert.equal(s.clients[0].prepaidBalanceBs, 200);assert.equal(s.clients[0].prepaidMovements.length, 1);assert.equal(s.cashMovements.length, 1);
});
test('adjustments retain signed delta and zero balance with audit, stale/invalid operations reject', () => {
  const s = fixture();const payload = { action: 'adjust', clientId: 'vip', balanceBs: 0, expectedBalanceBs: 200, expectedUpdatedAt: 'original', date: '2026-11-24', reference: 'Excel F115', reason: 'Saldo verificado', actorUserId: 'operator', clientOperationId: 'adjust' };
  mutateVipAccount(s, payload);assert.equal(s.clients[0].prepaidMovements[1].amountBs, -200);assert.equal(s.clients[0].prepaidMovements[1].nonPhysical, true);
  assert.equal(buildVipWorkspace(s, 'vip').summary.ledgerBalanceBs, 0);assert.equal(s.cashMovements.length, 1);
  assert.throws(() => mutateVipAccount(s, { ...payload, clientOperationId: 'stale' }), /cuenta cambió/);
  const fresh = { ...payload, expectedBalanceBs: 0, expectedUpdatedAt: s.clients[0].updatedAt, clientOperationId: 'invalid', balanceBs: 5, date: '2026-02-31' };
  assert.throws(() => mutateVipAccount(s, fresh), /fecha válida/);
  assert.equal(s.clients[0].prepaidBalanceBs, 0);
});

test('client and contract normalization preserve merge evidence, signed adjustments and settlement history', async () => {
  const { getWebBridge, buildContractDocumentHtml } = await import('../../src/services/webBridge.js');
  const s = fixture();merge(s);
  mutateVipAccount(s, payment(s, { mode: 'historical' }));
  mutateVipAccount(s, { action: 'adjust', clientId: 'vip', balanceBs: 125, expectedBalanceBs: 200, expectedUpdatedAt: s.clients[0].updatedAt, date: '2026-11-24', reason: 'Conciliación de apertura', reference: 'Excel F115', actorUserId: 'operator', clientOperationId: 'adjustment' });
  const bridge = getWebBridge();await bridge.__storage.replaceState(s);
  const normalized = await bridge.__storage.exportState();
  const client = normalized.clients.find(row => row.id === 'vip');
  const archived = normalized.clients.find(row => row.id === 'duplicate');
  assert.equal(client.prepaidMovements.at(-1).type, 'adjustment');assert.equal(client.prepaidMovements.at(-1).amountBs, -75);
  assert.equal(client.vipOperations.length, 3);assert.equal(archived.mergedIntoClientId, 'vip');assert.ok(archived.deletedAt);
  assert.equal(normalized.contracts[0].vipSettlements.length, 1);
  assert.equal(normalized.cashMovements.length, 1);
  const html = buildContractDocumentHtml({ contract: normalized.contracts[0], rental: s.rentals[0], deliveries: [], settings: {}, items: [], cashMovements: [] });
  assert.ok(/Cancelaci[oó]n hist[oó]rica/i.test(html), 'document retains historical settlement note');
  assert.doesNotMatch(html, /TOTAL PENDIENTE BS 130,00/);
});
