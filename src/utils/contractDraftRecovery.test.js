import test from 'node:test';
import assert from 'node:assert/strict';
import { contractDraftRecoveryKey, readContractDraft, saveContractDraft } from './contractDraftRecovery.js';

test('draft recovery keeps the complete contract, separates users and rejects edits and damaged data', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const key = contractDraftRecoveryKey({ id: 'sales' });
  const draft = { entityType: 'contract', customerName: 'CLIENTE', items: [{ itemId: 'chair', quantity: 250 }], supplierFulfillmentPlan: [{ supplierId: 'supplier', quantity: 200 }], deliveryWindowStart: '08:00', observations: 'Nota real' };
  saveContractDraft(storage, key, draft, 4);
  assert.deepEqual(readContractDraft(storage, key).draft, draft);
  assert.equal(readContractDraft(storage, key).step, 4);
  assert.equal(readContractDraft(storage, contractDraftRecoveryKey({ id: 'other' })), null);
  assert.equal(saveContractDraft(storage, key, { ...draft, recordId: 'saved' }, 2), false);
  assert.equal(saveContractDraft(storage, key, { ...draft, entityType: 'quote' }, 2), false);
  assert.deepEqual(readContractDraft(storage, key).draft, draft);
  storage.setItem(key, JSON.stringify({ version: 1, savedAt: Date.now() - 8 * 86400000, draft }));
  assert.equal(readContractDraft(storage, key), null);
  storage.setItem(key, '{broken');
  assert.equal(readContractDraft(storage, key), null);
});

test('storage failures are reported to the caller rather than silently claiming a saved draft', () => {
  assert.throws(() => saveContractDraft({ setItem() { throw new Error('quota'); } }, 'user', { entityType: 'contract', customerName: 'Cliente', items: [] }, 0), /quota/);
});
