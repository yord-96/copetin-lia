import { getCashBusinessDate } from './cashLedgerOrder.js';

// Los enlaces explícitos se reservan antes de inferir los históricos. Un recibo
// respalda una sola línea; coincidir en importe nunca permite cruzar de día.
export function linkEconomicReceiptRows(entries, { postedMovements, deposits, refunds,
  getAmount, isVoided, isGuarantee, normalizeMethod, normalizeAccount }) {
  const owners = new Map();
  const used = new Set();
  const byId = new Map(postedMovements.map(row => [String(row.id), row]));
  for (const entry of entries) {
    if (!['deposit', 'guarantee', 'refund'].includes(entry.type) || entry.amountBs <= 0) continue;
    const id = String(entry.cashMovementId ?? '').trim();
    if (id && !owners.has(id) && !isVoided(byId.get(id))) owners.set(id, entry.id);
  }
  return entries.map(entry => {
    const unlinked = () => ({ ...entry, isCashRegistered: false, cashReceiptCode: '', cashMovementId: null });
    if (!['deposit', 'guarantee', 'refund'].includes(entry.type) || entry.amountBs <= 0) {
      return { ...entry, isCashRegistered: false };
    }
    const linkedId = String(entry.cashMovementId ?? '').trim();
    if (linkedId && owners.get(linkedId) === entry.id && !used.has(linkedId)) {
      used.add(linkedId);
      const row = byId.get(linkedId);
      return { ...entry, isCashRegistered: true, cashMovementId: linkedId,
        cashReceiptCode: String(entry.cashReceiptCode || row?.receiptCode || row?.receipt || '').trim() };
    }
    const date = getCashBusinessDate(entry.createdAt);
    if (!date) return unlinked();
    const method = normalizeMethod(entry.paymentMethod);
    const account = normalizeAccount(entry.paymentAccount);
    const candidates = (entry.type === 'refund' ? refunds : deposits).filter(row => {
      const id = String(row.id ?? '');
      if (!id || used.has(id) || owners.has(id) || isVoided(row)) return false;
      if (getCashBusinessDate(row.receiptIssuedAt || row.createdAt) !== date) return false;
      if (Math.abs(Math.abs(getAmount(row)) - entry.amountBs) >= .01) return false;
      if (entry.type === 'refund') return true;
      if (entry.type === 'guarantee' ? !isGuarantee(row) : isGuarantee(row)) return false;
      const rowMethod = normalizeMethod(row.paymentMethod ?? row.method ?? row.payment?.method);
      const rowAccount = normalizeAccount(row.paymentAccount ?? row.account ?? row.qrAccount);
      return (!method || !rowMethod || method === rowMethod)
        && (method !== 'qr' || !account || !rowAccount || account === rowAccount);
    }).sort((a, b) => Math.abs(new Date(a.createdAt) - new Date(entry.createdAt))
      - Math.abs(new Date(b.createdAt) - new Date(entry.createdAt)));
    const row = candidates[0];
    if (!row) return unlinked();
    used.add(String(row.id));
    return { ...entry, isCashRegistered: true, cashMovementId: row.id,
      cashReceiptCode: String(row.receiptCode ?? row.receipt ?? '').trim() };
  });
}
