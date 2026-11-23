import { getCashBusinessDate, getCashEffectiveDate } from './cashLedgerOrder.js';

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const active = row => !row.deletedAt && !row.voidedAt && row.receiptStatus !== 'anulado';

export const isInternalGuaranteeApplication = entry => {
  if (!active(entry) || entry.cashMovementId || entry.isCashRegistered || entry.cashCollectionTarget || !Number.isFinite(Number(entry.amountBs)) || Number(entry.amountBs) <= 0) return false;
  const note = normalize(entry.note);
  return entry.type === 'guarantee_apply'
    || (entry.type === 'charge' && /garantia/.test(note) && /aplicad|aplicacion/.test(note));
};

export const isGuaranteeDamageApplication = entry => isInternalGuaranteeApplication(entry)
  && (entry.type === 'charge' || ['damage', 'penalties'].includes(entry.applicationTarget) || /dano|faltante/.test(normalize(entry.note)));

// Informational economic entries only. Never insert these into cashMovements,
// cash totals or bank/physical-fund timelines: that money was received earlier.
export function getDailyGuaranteeApplications(contracts = [], movements = [], date) {
  const cashById = new Map(movements.map(row => [String(row.id), row]));
  const seen = new Set();
  return contracts.filter(active).flatMap(contract => {
    const ledger = (contract.economicLedger || []).filter(active);
    return ledger.filter(entry => {
      return isInternalGuaranteeApplication(entry) && getCashBusinessDate(entry.receiptIssuedAt || entry.createdAt) === date;
    }).flatMap(entry => {
      const key = `${contract.id}:${entry.id}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const sources = ledger.filter(row => row.type === 'guarantee' && Number(row.amountBs) > 0 && row.createdAt <= entry.createdAt)
        .map(row => ledger.find(deposit => deposit.id === row.sourceDepositId) || row)
        .filter(row => row.type === 'deposit' || row.cashMovementId);
      const origin = [...new Map(sources.map(row => [row.id, row])).values()];
      const suffix = String(entry.id || '').replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'GARANT';
      return [{ id: key, date: entry.receiptIssuedAt || entry.createdAt,
        dateLabel: new Intl.DateTimeFormat('es-BO', {timeZone:'America/La_Paz',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(entry.receiptIssuedAt || entry.createdAt)),
        reference: String(contract.contractCode || contract.id), customer: contract.customerName || 'Cliente',
        receipt: `AG-${String(contract.contractCode || 'GAR').replace(/[^A-Za-z0-9-]/g, '')}-${suffix}`,
        amountBs: Math.round(Number(entry.amountBs) * 100) / 100,
        detail: entry.note || 'Aplicación de garantía', user: entry.createdByName || entry.createdBy || 'Sistema',
        origins: origin.map(row => ({ receipt: row.cashReceiptCode || cashById.get(String(row.cashMovementId))?.receiptCode || '',
          date: cashById.has(String(row.cashMovementId)) ? getCashEffectiveDate(cashById.get(String(row.cashMovementId))) : getCashBusinessDate(row.createdAt) })),
      }];
    });
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
