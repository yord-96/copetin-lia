import { getGuaranteeRefundCommercialPendingBs } from './guaranteeRefundPolicy.js';

const money = value => Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
const activeCash = row => !row.deletedAt && !row.voidedAt && !['anulado', 'eliminado'].includes(row.receiptStatus);
const fail = message => { const error = new Error(message); error.statusCode = 409; throw error; };

// Persist receipt and its single ledger line in the same transaction. Services
// already in the contract are commercial payments; unrelated extras stay separate.
export function syncContractCashCollection(state, contract, movement, { includedServiceId = '', now = new Date().toISOString() } = {}) {
  if (!contract || contract.deletedAt) fail('No se encontro el contrato para registrar el cobro.');
  const rental = (state.rentals ?? []).find(row => row.id === contract.rentalId && !row.deletedAt);
  const ledger = contract.economicLedger ?? [];
  let entry = ledger.find(row => !row.deletedAt && row.cashMovementId === movement.id);
  const service = includedServiceId && (contract.services ?? []).find(row => String(row.id) === String(includedServiceId));
  const amountBs = money(movement.amountBs);
  if (includedServiceId) {
    if (!service) fail('El servicio seleccionado no pertenece a este contrato.');
    if (entry?.type !== 'deposit' || movement.includedServiceId !== includedServiceId) {
      const others = (state.cashMovements ?? []).filter(row => row.id !== movement.id);
      const pending = getGuaranteeRefundCommercialPendingBs(contract, rental ?? {}, others);
      const paidForService = others.filter(row => activeCash(row) && row.linkedContractId === contract.id && row.includedServiceId === includedServiceId)
        .reduce((sum, row) => sum + money(row.contractAllocationBs), 0);
      const serviceAmount = money(service.lineTotalBs ?? Number(service.quantity || 1) * Number(service.unitPriceBs || 0));
      if (amountBs <= 0 || amountBs > Math.min(pending, money(serviceAmount - paidForService)) + .009) fail('El monto supera el saldo pendiente de este servicio. Actualiza el contrato antes de cobrar.');
    }
    Object.assign(movement, { includedServiceId, contractAllocationBs: amountBs, guaranteeAllocationBs: 0, surplusAllocationBs: 0,
      collectionTarget: 'balance', accountingTag: 'contract_economic_collection', category: 'cobro_contrato',
      collectionBreakdown: [{ target: 'balance', amountBs, label: service.name, detail: 'Pago de servicio incluido en el total del contrato.' }] });
  }
  const type = includedServiceId ? 'deposit' : 'extra';
  if (!entry) { entry = { id: 'eco-' + type + '-' + movement.id, createdAt: movement.receiptIssuedAt || movement.createdAt || now, createdByName: movement.createdByName || movement.createdBy || 'Sistema' }; ledger.push(entry); }
  Object.assign(entry, { type, amountBs, paymentMethod: movement.paymentMethod || 'efectivo', paymentAccount: movement.paymentAccount || '',
    note: movement.notes || movement.note || service?.name || movement.description || '',
    cashMovementId: movement.id, cashReceiptCode: movement.receiptCode || movement.receipt || '', isCashRegistered: true,
    cashRegisteredAt: movement.createdAt || now, cashCollectionTarget: includedServiceId ? 'balance' : 'extra',
    contractAllocationBs: includedServiceId ? amountBs : 0, includedServiceId: includedServiceId || null });
  contract.economicLedger = ledger;
  contract.economicLedgerUpdatedAt = now;
  contract.updatedAt = now;
  if (includedServiceId) {
    const movements = [...(state.cashMovements ?? []).filter(row => row.id !== movement.id), movement];
    const pending = getGuaranteeRefundCommercialPendingBs(contract, rental ?? {}, movements);
    const total = money(contract.totals?.totalBs);
    const paid = money(total - pending);
    contract.payment = { ...contract.payment, paidAtApprovalBs: paid, pendingBs: pending, pendingPaymentBs: pending, status: pending > .009 ? 'saldo_pendiente' : 'pagado' };
    if (rental) {
      for (const key of ['payment', 'totals']) rental[key] = { ...rental[key], paidAtRentalBs: paid, rentalCollectedBs: paid, pendingPaymentBs: pending, status: pending > .009 ? 'saldo_pendiente' : 'pagado' };
      if (rental.returnSettlement) {
        const remainingDamage = money(money(rental.returnSettlement.penaltiesBs) - money(rental.returnSettlement.damageCollectedBs) - money(rental.returnSettlement.discountCoveredByDepositBs));
        Object.assign(rental.returnSettlement, { paidBs: paid, outstandingRentalBs: pending, pendingCollectionBs: money(pending + remainingDamage), accountingStatus: pending + remainingDamage > .009 ? 'saldo_pendiente' : 'liquidado' });
      }
      rental.updatedAt = now;
    }
  }
  return { contract, rental };
}
