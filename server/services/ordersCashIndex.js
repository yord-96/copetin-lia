const movementFields = ['linkedContractId', 'linkedRentalId', 'linkedOrderCode', 'contractId', 'rentalId', 'contractCode', 'orderCode', 'reference', 'sourceId'];
const contractFields = ['id', 'rentalId', 'contractCode', 'orderCode'];
const reference = (value) => String(value ?? '').trim();

// This is a candidate index, not a replacement for the economic matching rules.
// Keep source order and both exact/case-insensitive matches. Each existing
// calculator still decides whether a candidate belongs to the contract.
export function createOrdersCashIndex(movements = []) {
  const rows = Array.isArray(movements) ? movements : [];
  const byReference = new Map();
  const legacy = [];
  const byId = new Map();
  const byReceipt = new Map();
  const remember = (map, key, position) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(position);
  };
  rows.forEach((row, position) => {
    if (!row) return;
    remember(byId, String(row.id ?? ''), position);
    remember(byReceipt, String(row.receiptCode ?? ''), position);
    if (row.deletedAt || row.voidedAt || ['anulado', 'eliminado'].includes(row.receiptStatus)) {
      return;
    }
    const keys = new Set(movementFields.map((field) => reference(row[field])).filter(Boolean));
    if (!keys.size) {
      // Payment reconciliation can associate unlinked legacy receipts by text.
      if (row.cashBoxType === 'BIG_CASH' && row.receiptStatus !== 'anulado' && Number(row.amountBs) > 0) legacy.push(position);
      return;
    }
    for (const key of keys) {
      for (const variant of new Set([key, key.toLowerCase()])) {
        if (!byReference.has(variant)) byReference.set(variant, []);
        byReference.get(variant).push(position);
      }
    }
  });
  return (contract) => {
    const positions = new Set(legacy);
    // Ledger evidence can refer to a receipt whose structured contract link is
    // absent or different. Keep all code matches (legacy codes are not unique),
    // including voided originals, in the same order as the complete ledger.
    for (const entry of contract.economicLedger ?? []) {
      for (const position of byId.get(String(entry.cashMovementId ?? '')) ?? []) positions.add(position);
      for (const position of byReceipt.get(String(entry.cashReceiptCode ?? '')) ?? []) positions.add(position);
    }
    for (const field of contractFields) {
      const key = reference(contract?.[field]);
      if (!key) continue;
      for (const variant of new Set([key, key.toLowerCase()])) {
        for (const position of byReference.get(variant) ?? []) positions.add(position);
      }
    }
    return [...positions].sort((a, b) => a - b).map((position) => rows[position]);
  };
}
