const money = value => Math.max(0, Number(Number(value || 0).toFixed(2)));
const confirmed = entry => Boolean(entry.isCashRegistered || entry.cashMovementId || entry.cashReceiptCode);

// Las garantías apartadas de un depósito comparten su recibo: emitir otro
// ingreso por el mismo dinero duplicaría la caja.
export function resolveGuaranteeReceipt(entry, ledger, allocations = new Map()) {
  if (entry?.type !== 'guarantee' || entry.deletedAt) return { kind: 'unavailable' };
  if (confirmed(entry)) return { kind: 'own', entry };
  const deposits = ledger.filter(row => row.type === 'deposit' && !row.deletedAt && !row.reclassifiedFromPayment);
  if (entry.sourceDepositId) {
    const source = deposits.find(row => row.id === entry.sourceDepositId);
    return source ? { kind: 'source', entry: source } : { kind: 'unavailable' };
  }
  const sources = deposits.sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0)).map(deposit => ({
    entry: deposit,
    remainingBs: money(money(allocations.get(deposit.id)?.guaranteeBs) - ledger.filter(row => row.type === 'guarantee' && !row.deletedAt && row.sourceDepositId === deposit.id).reduce((sum, row) => sum + money(row.amountBs), 0)),
  }));
  for (const guarantee of ledger.filter(row => row.type === 'guarantee' && !row.deletedAt && !row.sourceDepositId && !confirmed(row))) {
    let remainingBs = money(guarantee.amountBs);
    const backing = [];
    for (const source of sources) {
      const appliedBs = Math.min(remainingBs, source.remainingBs);
      if (appliedBs > 0) backing.push(source.entry);
      source.remainingBs = money(source.remainingBs - appliedBs);
      remainingBs = money(remainingBs - appliedBs);
    }
    if (guarantee.id !== entry.id) continue;
    if (!backing.length && !entry.reclassifiedFromPayment) return { kind: 'standalone', entry };
    if (backing.length === 1 && remainingBs < 0.005) return { kind: 'source', entry: backing[0] };
    return { kind: 'unavailable' };
  }
  return { kind: 'unavailable' };
}
