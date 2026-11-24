const money = value => Math.round(Number(value || 0) * 100) / 100;
export const vipDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
export function getVipAvailableBalance(client, date = vipDate()) {
  const balance = Math.max(0, money(client?.prepaidBalanceBs));
  if (client?.prepaidUsageFrom && date < client.prepaidUsageFrom) return 0;
  const locked = (client?.prepaidMovements || []).filter(row => !row.deletedAt && Number(row.amountBs) > 0 && row.availableFromDate && row.availableFromDate > date)
    .reduce((sum, row) => sum + Number(row.amountBs), 0);
  return money(Math.max(0, balance - locked));
}

export function findOrphanedVipCharges(state, client) {
  return (client.prepaidMovements || []).filter(movement => {
    if (movement.deletedAt || movement.type !== 'charge') return false;
    const rental = (state.rentals || []).find(row => row.id === movement.sourceId || movement.orderCode && row.orderCode === movement.orderCode);
    const contract = (state.contracts || []).find(row => row.id === movement.sourceId || row.id === rental?.contractId || row.rentalId === rental?.id && rental?.id);
    if (!contract || contract.deletedAt || !Array.isArray(contract.economicLedger)) return false;
    if ((contract.vipSettlements || []).some(row => row.id === movement.id && !row.deletedAt)) return false;
    const amount = Number(movement.serviceBs ?? Math.abs(movement.amountBs));
    const backing = contract.economicLedger.some(row => !row.deletedAt && row.type === 'deposit' && Number(row.amountBs) > 0);
    const cash = (state.cashMovements || []).some(row => !row.deletedAt && !row.voidedAt && row.receiptStatus !== 'anulado' && Number(row.amountBs) > 0 && [row.linkedContractId, row.linkedRentalId, row.sourceId].filter(Boolean).some(id => [contract.id, rental?.id].includes(id)));
    const deleted = contract.economicLedger.some(row => row.deletedAt && (row.id === movement.id || row.type === 'deposit' && Math.abs(Number(row.amountBs) - amount) < .01));
    return !backing && !cash && (deleted || contract.economicLedger.length === 0);
  });
}

/** Reverse the VIP side and commercial fields together, never adding cash. */
export function voidVipUsage(state, client, movement, { now, reason, actorName }) {
  if (!movement || movement.deletedAt || movement.type !== 'charge') return false;
  if ((client.prepaidMovements || []).some(row => !row.deletedAt && row.sourceType === 'rental_reversal' && row.sourceId === movement.sourceId && Number(row.amountBs) > 0)) throw Object.assign(new Error('Esta aplicación ya fue devuelta al saldo al anular la orden. Revisa su movimiento de reversión.'), { statusCode: 409 });
  const contract = (state.contracts || []).find(row => row.id === movement.sourceId || row.rentalId === movement.sourceId || row.orderCode && row.orderCode === movement.orderCode)
    || (state.contracts || []).find(row => (state.rentals || []).some(rental => rental.contractId === row.id && (rental.id === movement.sourceId || rental.orderCode === movement.orderCode)));
  const rental = contract && ((state.rentals || []).find(row => !row.deletedAt && row.id === contract.rentalId) || (state.rentals || []).find(row => !row.deletedAt && row.contractId === contract.id));
  const service = money(movement.serviceBs ?? Math.abs(Number(movement.amountBs)));
  const damage = money(movement.damageBs);
  movement.deletedAt = now; movement.deletedByName = actorName; movement.deletionReason = reason;
  client.prepaidBalanceBs = money(Number(client.prepaidBalanceBs || 0) + Math.abs(Number(movement.amountBs)));
  client.prepaidTotalUsedBs = money(Math.max(0, Number(client.prepaidTotalUsedBs || 0) - Math.abs(Number(movement.amountBs))));
  client.updatedAt = now;
  if (!contract) return true;
  const prepaid = Math.max(0, Number(contract.payment?.prepaidAppliedBs || 0), Number(contract.prepaidAppliedBs || 0), Number(rental?.payment?.prepaidAppliedBs || 0), Number(rental?.totals?.prepaidAppliedBs || 0), Number(rental?.prepaidAppliedBs || 0));
  const removedService = Math.min(service, prepaid);
  const paid = Math.max(Number(contract.payment?.paidAtApprovalBs || 0), Number(rental?.payment?.paidAtRentalBs || 0), Number(rental?.returnSettlement?.paidBs || 0));
  const paidAfter = money(Math.max(0, paid - removedService));
  const appliedAfter = money(Math.max(0, prepaid - removedService));
  const total = Math.max(Number(contract.totals?.totalBs || 0), Number(rental?.totals?.totalBs || 0));
  contract.payment = { ...contract.payment, paidAtApprovalBs: paidAfter, prepaidAppliedBs: appliedAfter, prepaidUsedBs: appliedAfter, pendingBs: money(Math.max(0, total - paidAfter)), pendingPaymentBs: money(Math.max(0, total - paidAfter)) };
  contract.prepaidAppliedBs = appliedAfter; contract.updatedAt = now;
  const settlement = (contract.vipSettlements || []).find(row => row.id === movement.id && !row.deletedAt);
  if (settlement) { settlement.deletedAt = now;settlement.deletedByName = actorName;settlement.deletionReason = reason; }
  for (const entry of contract.economicLedger || []) {
    const ownSettlement = entry.id === movement.id;
    const legacyPayment = !movement.serviceBs && removedService > 0 && entry.type === 'deposit' && !entry.deletedAt && Math.abs(Number(entry.amountBs) - removedService) < .01 && !entry.cashMovementId && !entry.cashReceiptCode;
    if (ownSettlement || legacyPayment) { entry.deletedAt = now;entry.deletedByName = actorName;entry.deletionReason = reason; }
  }
  if (rental) {
    const damagePaid = money(Math.max(0, Math.max(Number(rental.payment?.damageCollectedBs || 0), Number(rental.returnSettlement?.damageCollectedBs || 0)) - damage));
    const damagePending = money(Math.max(0, Number(rental.returnSettlement?.penaltiesBs || 0) - Number(rental.returnSettlement?.discountCoveredByDepositBs || 0) - damagePaid));
    const pending = money(Math.max(0, total - paidAfter) + damagePending);
    rental.payment = { ...rental.payment, paidAtRentalBs: paidAfter, prepaidAppliedBs: appliedAfter, prepaidUsedBs: appliedAfter, damageCollectedBs: damagePaid, pendingPaymentBs: pending, status: pending > .009 ? 'saldo_pendiente' : 'cancelado' };
    rental.totals = { ...rental.totals, paidAtRentalBs: paidAfter, prepaidAppliedBs: appliedAfter, pendingPaymentBs: pending };
    rental.prepaidAppliedBs = appliedAfter;rental.updatedAt = now;
    if (rental.returnSettlement) rental.returnSettlement = { ...rental.returnSettlement, paidBs: paidAfter, damageCollectedBs: damagePaid, penaltiesCollectedBs: damagePaid, pendingCollectionBs: pending };
  }
  return true;
}

export function syncVoidedVipLedger(state, contract, before, after, meta) {
  const removed = before.filter(entry => !entry.deletedAt && ['deposit', 'note'].includes(entry.type) && !after.some(next => next.id === entry.id && !next.deletedAt));
  if (!removed.length) return 0;
  const rental = (state.rentals || []).find(row => row.id === contract.rentalId || row.contractId === contract.id);
  const client = (state.clients || []).find(row => !row.deletedAt && (row.id === contract.clientId || (row.mergedClientIds || []).includes(contract.clientId)));
  if (!client) return 0;
  let count = 0;
  for (const movement of client.prepaidMovements || []) {
    if (movement.deletedAt || movement.type !== 'charge' || ![contract.id, contract.rentalId, rental?.id].filter(Boolean).includes(movement.sourceId) && !(movement.orderCode && movement.orderCode === (rental?.orderCode || contract.orderCode))) continue;
    const matched = removed.some(entry => entry.id === movement.id || entry.type === 'deposit' && !entry.cashMovementId && !entry.cashReceiptCode && Math.abs(Number(entry.amountBs) - Number(movement.serviceBs ?? Math.abs(movement.amountBs))) < .01);
    if (matched && voidVipUsage(state, client, movement, meta)) count++;
  }
  return count;
}
