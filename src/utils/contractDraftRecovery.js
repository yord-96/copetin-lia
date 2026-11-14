export const contractDraftRecoveryKey = user => {
  const id = String(user?.id ?? user?.username ?? '').trim();
  return id ? `copetin:contract-draft:v1:${id}` : '';
};

export function readContractDraft(storage, key) {
  try {
    const saved = JSON.parse(storage.getItem(key));
    if (saved?.version !== 1 || !Number.isFinite(saved.savedAt) || saved.draft?.entityType !== 'contract' || saved.draft.recordId
      || !Array.isArray(saved.draft.items) || Date.now() - saved.savedAt > 7 * 86400000) return null;
    return saved;
  } catch { return null; }
}

export function saveContractDraft(storage, key, draft, step) {
  if (!key || draft.entityType !== 'contract' || draft.recordId) return false;
  if (!draft.customerName?.trim() && !draft.items?.length) return false;
  const saved = { version: 1, savedAt: Date.now(), draft, step };
  storage.setItem(key, JSON.stringify(saved));
  return saved;
}
