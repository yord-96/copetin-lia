import { cashMovementMatchesContractReferences } from './contractCashLinks.js';

import { getCashBusinessDate } from './cashLedgerOrder.js';

// Receipt amounts are authoritative when a ledger line still carries an old edit.
export function reconcileContractDocumentPayments(contract, rental, movements = []) {
  const ledger = (contract?.economicLedger ?? []).filter(row => !row.deletedAt).map(row => ({...row}));
  const cash = movements.filter(row => row.cashBoxType === 'BIG_CASH' && !row.deletedAt && !row.voidedAt && row.receiptStatus !== 'anulado' && Number(row.amountBs) > 0
    && cashMovementMatchesContractReferences(row, {contractId:contract?.id,contractCode:contract?.contractCode,rentalId:rental?.id,orderCode:rental?.orderCode}));
  const used = new Set();
  for (const entry of ledger.filter(row => row.type === 'deposit')) {
    const receipt = cash.find(row => !used.has(row.id) && (row.id === entry.cashMovementId || (entry.cashReceiptCode && row.receiptCode === entry.cashReceiptCode)));
    if (receipt) {
      Object.assign(entry, { amountBs: Number(receipt.amountBs), cashMovementId: receipt.id,
        cashReceiptCode: receipt.receiptCode || receipt.receipt || '', isCashRegistered: true });
      used.add(receipt.id);
    }
  }
  // A voided original deposit may be backed by explicit split replacements.
  // Consume all those receipts once, preserving the original deposit allocation.
  for (const entry of ledger.filter(row => row.type === 'deposit')) {
    if (used.has(entry.cashMovementId)) continue;
    const original = movements.find(row => row.id === entry.cashMovementId
      || (entry.cashReceiptCode && row.receiptCode === entry.cashReceiptCode));
    const originalId = original?.id || entry.cashMovementId;
    if (!originalId || (original && !original.voidedAt && original.receiptStatus !== 'anulado')) continue;
    const replacements = cash.filter(row => !used.has(row.id)
      && (row.replacementOfMovementId === originalId || original?.replacedByMovementId === row.id));
    if (!replacements.length) continue;
    const received = replacements.reduce((sum, row) => sum + Number(row.amountBs), 0);
    // Partial replacements do not prove the original full deposit remains valid.
    if (Math.abs(received - Number(entry.amountBs)) > .01) continue;
    for (const row of replacements) used.add(row.id);
  }
  // Historical initial payments may have no cash ID. Link their receipt before
  // adding cash-only deposits, reserving explicit links above first.
  const normalize = value => String(value ?? '').trim().toLowerCase();
  for (const entry of ledger.filter(row => row.type === 'deposit'
    && !row.cashMovementId && !row.cashReceiptCode && !row.reclassifiedFromPayment)) {
    const initial = entry.id === `initial-payment-${contract?.id}`;
    const candidates = cash.filter(row => !used.has(row.id)
      && ['ingreso_alquiler', 'cobro_saldo_alquiler', 'abono'].includes(row.type)
      && !['damage', 'guarantee', 'extra'].includes(row.collectionTarget)
      && (initial && row.accountingTag === 'initial_rental_payment'
        || (Math.abs(Number(row.amountBs) - Number(entry.amountBs)) < .01
          && getCashBusinessDate(entry.createdAt)
          && getCashBusinessDate(entry.createdAt) === getCashBusinessDate(row.receiptIssuedAt || row.createdAt)
          && (!entry.paymentMethod || !row.paymentMethod
            || normalize(entry.paymentMethod) === normalize(row.paymentMethod))
          && (!entry.paymentAccount || !row.paymentAccount
            || normalize(entry.paymentAccount) === normalize(row.paymentAccount)))));
    if (candidates.length !== 1) continue;
    const receipt = candidates[0];
    Object.assign(entry, { amountBs: Number(receipt.amountBs), cashMovementId: receipt.id,
      cashReceiptCode: receipt.receiptCode || receipt.receipt || '', isCashRegistered: true });
    used.add(receipt.id);
  }
  for (const receipt of cash) {
    if (used.has(receipt.id) || !['ingreso_alquiler','cobro_saldo_alquiler','abono'].includes(receipt.type)
      || ['damage','guarantee','extra'].includes(receipt.collectionTarget)) continue;
    ledger.push({id:`cash-${receipt.id}`,type:'deposit',amountBs:Number(receipt.amountBs),createdAt:receipt.receiptIssuedAt || receipt.createdAt,
      note:receipt.description,createdByName:receipt.createdByName || receipt.createdBy,cashMovementId:receipt.id,cashReceiptCode:receipt.receiptCode,isCashRegistered:true,
      guaranteeAllocationBs:receipt.guaranteeAllocationBs || 0,surplusAllocationBs:receipt.surplusAllocationBs || 0});
  }
  const deposits = ledger.filter(row => row.type === 'deposit' && !row.reclassifiedFromPayment
    && (row.isCashRegistered || row.cashMovementId || row.cashReceiptCode));
  let appliedBs = 0;
  let reservedBs = 0;
  for (const entry of deposits) {
    const received = Math.max(0, Number(entry.amountBs) || 0);
    const linkedGuarantee = ledger.filter(row => row.type === 'guarantee' && row.sourceDepositId === entry.id).reduce((sum,row)=>sum+(Number(row.amountBs)||0),0);
    const guarantee = Math.min(received, Math.max(linkedGuarantee,Number(entry.guaranteeAllocationBs)||0));
    const damage = Math.max(0,Number(entry.damageAllocationBs)||0);
    // El excedente guardado puede haberse calculado con un saldo anterior.
    // Todo el dinero comercial cuenta; el excedente se obtiene contra el total actual.
    entry.documentContractAllocationBs = Math.max(0, received-guarantee-damage);
    appliedBs += entry.documentContractAllocationBs;
    reservedBs += guarantee;
  }
  return {ledger,appliedBs,reservedBs,receivedBs:deposits.reduce((sum,row)=>sum+(Number(row.amountBs)||0),0),hasPayments:deposits.length>0};
}
