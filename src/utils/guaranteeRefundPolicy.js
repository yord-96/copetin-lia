import { reconcileContractDocumentPayments } from './contractDocumentPayments.js';
import { getConfirmedContractLedgerPaidBs } from './receivables.js';
import { cashMovementMatchesContractReferences } from './contractCashLinks.js';
import { getEconomicCommercialCashAmount } from './commercialCashAmount.js';

const money = value => Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
export const guaranteeRefundDebtMessage = (pendingBs, format = value => `Bs ${Number(value).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) =>
  `No se puede devolver la garantía porque aún debe ${format(pendingBs)} del contrato. Te recomendamos aplicar la deuda a la garantía para poder devolver el saldo restante.`;

// La garantia recibida y los cobros de danos no pagan el servicio. Solo una
// aplicacion explicita de garantia al contrato reduce su saldo comercial.
export function getGuaranteeRefundCommercialPendingBs(contract = {}, rental = {}, movements = [], totalOverride = null) {
  const total = money(totalOverride ?? contract.totals?.totalBs ?? rental.totals?.totalBs);
  const reconciled = reconcileContractDocumentPayments(contract, rental, movements);
  const ledger = reconciled.ledger.filter(row => !row.deletedAt);
  const applied = ledger.reduce((sum, row) => row.type === 'guarantee_apply'
    ? sum + money(row.contractAllocationBs ?? (row.applicationTarget === 'rental' ? row.amountBs : 0)) : sum, 0);
  const reset = contract.economicResetAt || Number(contract.economicResetVersion) >= 1;
  const prepaid = Math.max(money(contract.payment?.prepaidUsedBs), money(contract.payment?.prepaidAppliedBs), money(contract.prepaidAppliedBs), reset ? 0 : money(rental.prepaidAppliedBs));
  const cashPaid = movements.reduce((sum, row) => !row.isInternalTransfer && cashMovementMatchesContractReferences(row, {
    contractId: contract.id, rentalId: rental.id, contractCode: contract.contractCode, orderCode: rental.orderCode,
  }) ? sum + getEconomicCommercialCashAmount(row) : sum, 0);
  const confirmed = reconciled.hasPayments
    ? Math.min(reconciled.appliedBs, getConfirmedContractLedgerPaidBs({ ...contract, economicLedger: ledger }, total))
    : cashPaid;
  const stored = reset || reconciled.hasPayments || cashPaid > 0 ? 0 : Math.max(money(contract.payment?.paidAtApprovalBs), money(rental.payment?.paidAtRentalBs));
  return money(total - Math.max(stored, confirmed + applied + prepaid));
}
