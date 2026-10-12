const money = value => Math.round(Number(value || 0) * 100) / 100;
const active = row => !row.deletedAt;
const fail = message => { const error = new Error(message); error.statusCode = 409; throw error; };
function adjustCommercialBalances(state, contract, delta, now) {
  for (const rental of state.rentals ?? []) {
    if (rental.id !== contract.rentalId) continue;
    for (const target of [rental.payment, rental.totals]) if (target) {
      target.paidAtRentalBs = Math.max(0, money(money(target.paidAtRentalBs) + delta));
      target.rentalCollectedBs = Math.max(0, money(money(target.rentalCollectedBs) + delta));
      target.pendingPaymentBs = Math.max(0, money(money(target.pendingPaymentBs) - delta));
      target.status = target.pendingPaymentBs > 0 ? 'saldo_pendiente' : 'pagado';
    }
    if (rental.returnSettlement) {
      rental.returnSettlement.paidBs = Math.max(0, money(money(rental.returnSettlement.paidBs) + delta));
      rental.returnSettlement.outstandingRentalBs = Math.max(0, money(money(rental.returnSettlement.outstandingRentalBs) - delta));
      rental.returnSettlement.pendingCollectionBs = Math.max(0, money(money(rental.returnSettlement.pendingCollectionBs) - delta));
    }
    for (const order of state.serviceOrders ?? []) {
      if (order.rentalId !== rental.id && order.id !== rental.id) continue;
      order.saldo_pendiente = rental.payment?.pendingPaymentBs ?? rental.totals?.pendingPaymentBs;
      order.updated_at = now;
    }
    rental.updatedAt = now;
  }
}

export function economicDepositGroup(ledger, entry) {
  const deposit = entry?.type === 'guarantee' && entry.sourceDepositId
    ? ledger.find(row => active(row) && row.id === entry.sourceDepositId && row.type === 'deposit')
    : entry?.type === 'deposit' ? entry : null;
  return deposit ? [deposit, ...ledger.filter(row => active(row) && row.type === 'guarantee' && row.sourceDepositId === deposit.id)] : [entry];
}

export function reviseEconomicDeposit(ledger, deposit, { receivedBs, guaranteeBs, createdAt, userName = 'Sistema' }) {
  receivedBs = money(receivedBs); guaranteeBs = money(guaranteeBs);
  if (!Number.isFinite(receivedBs) || !Number.isFinite(guaranteeBs) || receivedBs <= 0 || guaranteeBs < 0 || guaranteeBs > receivedBs) fail('El total debe ser mayor a cero y la garantia debe estar entre cero y el total recibido.');
  const group = economicDepositGroup(ledger, deposit);
  const ids = new Set(group.map(row => row.id));
  const now = new Date().toISOString();
  const contractBs = money(receivedBs - guaranteeBs);
  const next = ledger.filter(row => !ids.has(row.id));
  next.push({ ...deposit, amountBs: receivedBs, contractAllocationBs: contractBs, guaranteeAllocationBs: guaranteeBs, surplusAllocationBs: 0,
    createdAt, editedAt: now, editedByName: userName });
  if (guaranteeBs > 0) next.push({ ...(group[1] ?? {}), id: group[1]?.id ?? `eco-guarantee-${deposit.id}`, type: 'guarantee', amountBs: guaranteeBs,
    sourceDepositId: deposit.id, reclassifiedFromPayment: true, cashMovementId: null, cashReceiptCode: '', isCashRegistered: false,
    paymentMethod: deposit.paymentMethod, paymentAccount: deposit.paymentAccount, createdAt, createdByName: deposit.createdByName,
    editedAt: now, editedByName: userName, note: `Del deposito de Bs ${receivedBs.toFixed(2)} se apartaron Bs ${guaranteeBs.toFixed(2)} como garantia.` });
  return next;
}

// Run inside the same transaction as the ledger mutations, on server and local bridge.
export function syncEconomicDepositOperations(state, contract, before, after, now = new Date().toISOString()) {
  const changed = before.filter(row => active(row) && row.type === 'deposit').filter(previous => {
    const next = after.find(row => row.id === previous.id && active(row));
    return !next || ['amountBs', 'contractAllocationBs', 'guaranteeAllocationBs', 'surplusAllocationBs'].some(key => money(previous[key]) !== money(next[key]));
  });
  if (!changed.length) return;
  for (const previous of changed) {
    if (!after.some(row => row.id === previous.id && active(row))) {
      for (const child of after.filter(row => active(row) && row.sourceDepositId === previous.id && row.type === 'guarantee')) {
        Object.assign(child, { deletedAt: now, deletionReason: 'Anulada junto con su deposito.' });
      }
    }
  }
  const reserved = after.filter(row => active(row) && row.type === 'guarantee').reduce((sum, row) => sum + money(row.amountBs), 0);
  const spent = after.filter(row => active(row) && ((row.type === 'refund' && row.refundSource !== 'surplus') || row.type === 'guarantee_apply' || row.type === 'charge')).reduce((sum, row) => sum + money(row.amountBs), 0);
  if (money(reserved) < money(spent)) fail('Esta garantia ya fue devuelta o aplicada. Corrige primero esa operacion antes de reducirla o eliminar el pago.');
  for (const previous of changed) {
    const next = after.find(row => row.id === previous.id && active(row));
    for (const child of after.filter(row => active(row) && row.sourceDepositId === previous.id && row.type === 'guarantee')) {
      if (!next) Object.assign(child, { deletedAt: now, deletionReason: 'Anulada junto con su deposito.' });
    }
    const movement = (state.cashMovements ?? []).find(row => row.id === previous.cashMovementId || (previous.cashReceiptCode && row.receiptCode === previous.cashReceiptCode));
    if (!movement) { if (previous.isCashRegistered) fail('No se encontro el recibo del deposito. Recarga el contrato antes de editarlo.'); continue; }
    if (!next) {
      if (!movement.deletedAt) adjustCommercialBalances(state, contract, -money(movement.contractAllocationBs), now);
      Object.assign(movement, { deletedAt: now, receiptDeletedAt: now, receiptStatus: 'eliminado', deletionReason: 'Pago anulado desde la hoja flexible.', updatedAt: now });
      continue;
    }
    if (movement.deletedAt || movement.voidedAt) fail('Este pago tiene recibos reemplazados. Consolida su recibo antes de modificar los montos.');
    const total = money(next.amountBs), commercial = money(next.contractAllocationBs), guarantee = money(next.guaranteeAllocationBs), surplus = money(next.surplusAllocationBs);
    if (total <= 0 || [commercial, guarantee, surplus].some(value => !Number.isFinite(value) || value < 0) || money(commercial + guarantee + surplus) !== total) fail('El reparto del pago no coincide con el dinero recibido.');
    const previousGuarantee = before.filter(row => active(row) && row.type === 'guarantee' && row.sourceDepositId === previous.id).reduce((sum, row) => sum + money(row.amountBs), 0);
    const previousCommercial = Object.prototype.hasOwnProperty.call(movement, 'contractAllocationBs')
      ? money(movement.contractAllocationBs)
      : money(previous.amountBs) - Math.max(money(previous.guaranteeAllocationBs), previousGuarantee) - money(previous.surplusAllocationBs);
    const delta = money(commercial - previousCommercial);
    Object.assign(movement, { amountBs: total, receivedAmountBs: total, contractAllocationBs: commercial, guaranteeAllocationBs: guarantee, surplusAllocationBs: surplus,
      accountingTag: 'contract_deposit_receipt', receiptDetail: `Total recibido: Bs ${total.toFixed(2)}\nAplicado al contrato: Bs ${commercial.toFixed(2)}\nApartado como garantia: Bs ${guarantee.toFixed(2)}`,
      updatedAt: now, receiptEditedAt: now });
    adjustCommercialBalances(state, contract, delta, now);
    state.generatedReports = (state.generatedReports ?? []).filter(report => (report.cashMovementId || (report.sourceType === 'cashMovement' ? report.sourceId : '')) !== movement.id);
  }
}
