import { getCashBusinessDate } from './cashLedgerOrder.js';
import { cashMovementMatchesContractReferences } from './contractCashLinks.js';

const active = row => !row.deletedAt && !row.voidedAt && !['anulado', 'eliminado'].includes(String(row.receiptStatus ?? '').toLowerCase());

// Follow explicit receipt links only; never associate payments by date or amount.
export function syncEconomicLedgerCashDate(state, contract, entry, { now = new Date().toISOString(), userId = null, userName = 'Sistema' } = {}) {
  if (!entry?.createdAt || entry.deletedAt) return [];
  const date = new Date(entry.createdAt);
  if (Number.isNaN(date.getTime())) throw new Error('La fecha del movimiento economico no es valida.');
  const timestamp = date.toISOString();
  const rows = state.cashMovements ?? [];
  const references = { contractId: contract.id, rentalId: contract.rentalId, contractCode: contract.contractCode, orderCode: contract.orderCode };
  const linked = rows.filter(row => cashMovementMatchesContractReferences(row, references));
  const seed = linked.find(row => entry.cashMovementId && row.id === entry.cashMovementId)
    ?? linked.find(row => entry.cashReceiptCode && row.receiptCode === entry.cashReceiptCode);
  if (!seed) return [];
  const ids = new Set([seed.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of linked) {
      if (!ids.has(row.id) && (ids.has(row.replacementOfMovementId)
        || linked.some(parent => ids.has(parent.id) && parent.replacedByMovementId === row.id))) {
        ids.add(row.id); changed = true;
      }
    }
  }
  const targets = linked.filter(row => ids.has(row.id) && active(row));
  for (const movement of targets) {
    Object.assign(movement, { createdAt: timestamp, receiptIssuedAt: timestamp,
      cashEffectiveDate: getCashBusinessDate(timestamp), receiptEditedAt: now,
      updatedAt: now, editedAt: now, editedById: userId, editedByName: userName });
    for (const report of state.generatedReports ?? []) {
      const id = report.cashMovementId || (report.sourceType === 'cashMovement' ? report.sourceId : '');
      if (id === movement.id) Object.assign(report, { generatedAt: timestamp, createdAt: timestamp, receiptIssuedAt: timestamp, updatedAt: now });
    }
  }
  return targets.map(row => row.id);
}
