import { getCashEffectiveDate } from './cashLedgerOrder.js';

export const DIGITAL_CONTRACT_START_DATE = '2026-10-01';
const text = value => String(value || '').trim().toLowerCase();
const internalApplication = row => ['aplicacion_garantia', 'guarantee_apply'].includes(text(row.type)) || ['guarantee_damage_application', 'guarantee_application'].includes(text(row.accountingTag));
export const isDigitalContractCashMovement = row => {
  if (text(row?.paymentMethod) !== 'qr' || String(row?.cashBoxType).toUpperCase() !== 'BIG_CASH' || row.isInternalTransfer) return false;
  if (!Number.isFinite(Number(row.amountBs)) || Number(row.amountBs) === 0) return false;
  if (getCashEffectiveDate(row) < DIGITAL_CONTRACT_START_DATE || !getCashEffectiveDate(row)) return false;
  if (internalApplication(row) || text(row.accountingTag) === 'opening_balance') return false;
  return Boolean(row.linkedContractId || row.linkedRentalId || row.linkedOrderCode || ['rental', 'contract', 'return', 'legacy_contract'].includes(text(row.sourceType)) || text(row.accountingTag) === 'big_cash_fund_out');
};

// Safety cap shared with Caja Grande: a reflected receipt cannot finance two
// bank withdrawals simply because it is visible in both workspaces.
export const actualDigitalBankBalance = (rows, account) => Number(rows.filter(row => text(row.paymentMethod) === 'qr'
  && ['BIG_CASH', 'PETTY_CASH'].includes(String(row.cashBoxType).toUpperCase())
  && String(row.paymentAccount || '').trim().toUpperCase() === String(account || '').trim().toUpperCase()
  && !row.deletedAt && !row.voidedAt && text(row.receiptStatus) !== 'anulado' && !row.accountingArchivedAt && row.accountingPeriodStatus !== 'archived'
  && !row.isInternalTransfer && !internalApplication(row))
  .reduce((sum, row) => sum + (Number(row.amountBs) || 0), 0).toFixed(2));

// Bank view of the same receipt: no new movement, amount or receipt is stored.
// The original remains available in the contract and in Caja Grande.
export const reflectDigitalContractCash = (rows = []) => rows.map(row => isDigitalContractCashMovement(row)
  ? { ...row, cashBoxType: 'PETTY_CASH', digitalContractReflection: true, originalCashBoxType: 'BIG_CASH' }
  : row);

export const isZeroDigitalOpening = payload => Number(payload?.amountBs) === 0
  && payload?.type === 'ingreso' && payload?.cashBoxType === 'PETTY_CASH'
  && text(payload?.paymentMethod) === 'qr' && payload?.accountingTag === 'opening_balance' && payload?.category === 'apertura';
