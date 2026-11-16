import test from 'node:test';
import assert from 'node:assert/strict';
import { contractDraftRecoveryKey, readContractDraft, saveContractDraft, createContractDraftAutosave } from './contractDraftRecovery.js';

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
  storage.setItem(key, JSON.stringify({ version: 1, savedAt: Date.now() - 25 * 3600000, draft }));
  assert.equal(readContractDraft(storage, key), null);
  storage.setItem(key, '{broken');
  assert.equal(readContractDraft(storage, key), null);
});

test('typing only replaces a pending reference; flush writes the latest snapshot once and cancel prevents resurrection', () => {
  const timers = new Map(); let serial = 0; const writes = [];
  const autosave = createContractDraftAutosave({ write: (draft, step) => { writes.push({ draft, step }); return true; }, schedule: fn => { timers.set(++serial, fn); return serial; }, cancel: id => timers.delete(id) });
  for (let i = 0; i < 100; i++) autosave.update({ customerName: `Cliente ${i}` }, 2);
  assert.equal(writes.length, 0);
  assert.equal(timers.size, 1);
  autosave.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].draft.customerName, 'Cliente 99');
  assert.equal(timers.size, 0);
  autosave.flush();
  assert.equal(writes.length, 1);
  autosave.update({ customerName: 'No recrear después de guardar' }, 4);
  autosave.cancel();
  autosave.flush();
  assert.equal(writes.length, 1);
});

test('storage failures are reported to the caller rather than silently claiming a saved draft', () => {
  assert.throws(() => saveContractDraft({ setItem() { throw new Error('quota'); } }, 'user', { entityType: 'contract', customerName: 'Cliente', items: [] }, 0), /quota/);
});
