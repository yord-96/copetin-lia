import { cashMovementMatchesContractReferences } from './contractCashLinks.js';

// Receipt amounts are authoritative when a ledger line still carries an old edit.
export function reconcileContractDocumentPayments(contract, rental, movements = []) {
  const ledger = (contract?.economicLedger ?? []).filter(row => !row.deletedAt).map(row => ({...row}));
  const cash = movements.filter(row => row.cashBoxType === 'BIG_CASH' && !row.deletedAt && !row.voidedAt && row.receiptStatus !== 'anulado' && Number(row.amountBs) > 0
    && cashMovementMatchesContractReferences(row, {contractId:contract?.id,contractCode:contract?.contractCode,rentalId:rental?.id,orderCode:rental?.orderCode}));
  const used = new Set();
  for (const entry of ledger.filter(row => row.type === 'deposit')) {
    const receipt = cash.find(row => row.id === entry.cashMovementId || (entry.cashReceiptCode && row.receiptCode === entry.cashReceiptCode));
    if (receipt) { entry.amountBs = Number(receipt.amountBs); used.add(receipt.id); }
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
