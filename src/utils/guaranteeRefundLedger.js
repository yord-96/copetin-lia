import { cashMovementMatchesContractReferences } from './contractCashLinks.js';
import { getCashBusinessDate } from './cashLedgerOrder.js';

export const isConfirmedGuaranteeRefund = (row) => Boolean(row?.id
  && !row.deletedAt && !row.voidedAt && row.receiptStatus !== 'anulado'
  && !row.isInternalTransfer && Number(row.amountBs) < 0
  && (!row.cashBoxType || row.cashBoxType === 'BIG_CASH')
  && (row.accountingTag === 'guarantee_refund' || String(row.category ?? '').startsWith('garantia_devuelta')));

// Caja es la evidencia del egreso. Vincularla no crea ni modifica dinero.
// Incluimos filas eliminadas al reservar enlaces: una eliminacion deliberada
// nunca se revive automaticamente ni se asigna dos veces el mismo recibo.
export function reconcileGuaranteeRefundLedger(contract = {}, movements = []) {
  const ledger = (Array.isArray(contract.economicLedger) ? contract.economicLedger : []).map(row => ({ ...row }));
  const used = new Set(ledger.map(row => String(row.cashMovementId ?? '')).filter(Boolean));
  for (const movement of movements) {
    if (!isConfirmedGuaranteeRefund(movement) || used.has(String(movement.id))) continue;
    if (!cashMovementMatchesContractReferences(movement, {
      contractId: contract.id, rentalId: contract.rentalId,
      contractCode: contract.contractCode, orderCode: contract.orderCode,
    })) continue;
    const amountBs = Math.abs(Number(movement.amountBs));
    const receipt = String(movement.receiptCode ?? '').trim();
    const existing = ledger.find(row => row.type === 'refund' && row.refundSource !== 'surplus'
      && !row.cashMovementId && (receipt && row.cashReceiptCode === receipt
        || Math.abs(Number(row.amountBs) - amountBs) < .009
          && getCashBusinessDate(row.createdAt) === getCashBusinessDate(movement.receiptIssuedAt || movement.createdAt)));
    if (existing?.deletedAt) continue;
    const entry = existing ?? { id: `cash-refund-${movement.id}`, type: 'refund', refundSource: 'guarantee',
      amountBs, paymentMethod: movement.paymentMethod, paymentAccount: movement.paymentAccount ?? '',
      note: movement.notes || movement.description || 'Devolucion de garantia registrada en Caja Grande.',
      createdAt: movement.receiptIssuedAt || movement.createdAt,
      createdByName: movement.createdByName || movement.createdBy || 'Sistema' };
    Object.assign(entry, { cashMovementId: movement.id, cashReceiptCode: receipt,
      isCashRegistered: true, cashRegisteredAt: movement.cashRegisteredAt || movement.createdAt });
    if (!existing) ledger.push(entry);
    used.add(String(movement.id));
  }
  return ledger;
}
