export const contractDraftRecoveryKey = user => {
  const id = String(user?.id ?? user?.username ?? '').trim();
  return id ? `copetin:contract-draft:v1:${id}` : '';
};

export function readContractDraft(storage, key) {
  if (!key) return null;
  try {
    const saved = JSON.parse(storage.getItem(key));
    if (saved?.version !== 1 || !Number.isFinite(saved.savedAt) || saved.draft?.entityType !== 'contract' || saved.draft.recordId
      || !Array.isArray(saved.draft.items) || Date.now() - saved.savedAt > 86400000) {
      storage.removeItem?.(key);
      return null;
    }
    return saved;
  } catch { return null; }
}

// Updating the pending reference is cheap; serialization happens only after a
// pause, or explicitly when closing the editor / leaving the page.
export function createContractDraftAutosave({ write, onSaved, onError, delayMs = 1500, schedule = setTimeout, cancel = clearTimeout }) {
  let timer = null;
  let pending = null;
  const stop = () => { if (timer !== null) cancel(timer); timer = null; };
  const flush = () => {
    stop();
    if (!pending) return;
    const snapshot = pending;
    pending = null;
    try { const saved = write(snapshot.draft, snapshot.step); if (saved) onSaved?.(saved); }
    catch (error) { onError?.(error); }
  };
  return {
    update(draft, step) { pending = { draft, step }; stop(); timer = schedule(flush, delayMs); },
    flush,
    cancel() { stop(); pending = null; },
  };
}

export function saveContractDraft(storage, key, draft, step) {
  if (!key || draft.entityType !== 'contract' || draft.recordId) return false;
  if (!draft.customerName?.trim() && !draft.items?.length) return false;
  const saved = { version: 1, savedAt: Date.now(), draft, step };
  storage.setItem(key, JSON.stringify(saved));
  return saved;
}
