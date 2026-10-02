import { compareCashLedgerOrder } from './cashLedgerOrder.js';

export const isPettyCashRow = row => String(row?.cashBoxType ?? '').toUpperCase() === 'PETTY_CASH';
export const isActivePettyCashMovement = row => isPettyCashRow(row) && !row.deletedAt && !row.voidedAt
  && row.receiptStatus !== 'anulado' && row.accountingPeriodStatus !== 'archived' && !row.accountingArchivedAt;

export function buildPettyCashFundTimeline(movements = []) {
  let totalBs = 0;
  let cashBs = 0;
  let digitalBs = 0;
  const byMovementId = new Map();
  const accountBalances = new Map();
  const ordered = movements.filter(isActivePettyCashMovement).slice().sort(compareCashLedgerOrder);
  for (const row of ordered) {
    const amount = Number(row.amountBs) || 0;
    const cash = String(row.paymentMethod || 'efectivo').toLowerCase() === 'efectivo';
    totalBs = Math.round((totalBs + amount) * 100) / 100;
    if (cash) cashBs = Math.round((cashBs + amount) * 100) / 100;
    else {
      digitalBs = Math.round((digitalBs + amount) * 100) / 100;
      const key = String(row.paymentAccount || 'Digital').toUpperCase();
      accountBalances.set(key, Math.round(((accountBalances.get(key) || 0) + amount) * 100) / 100);
    }
    const accounts = [{ label: 'Efectivo', amountBs: cashBs }, ...[...accountBalances].map(([label, amountBs]) => ({ label: `QR · ${label}`, amountBs }))];
    byMovementId.set(String(row.id), { totalBs, cashBs, digitalBs, accounts });
  }
  return { totalBs, cashBs, digitalBs, byMovementId, accounts: [...byMovementId.values()].at(-1)?.accounts ?? [] };
}

export function resetPettyCashState(state, { now = new Date().toISOString(), userName = 'Administración', backupFile = null } = {}) {
  const archive = row => ({ ...row, accountingPeriodStatus: 'archived', accountingArchivedAt: now, accountingArchivedByName: userName });
  let movements = 0;
  let debts = 0;
  state.cashMovements = (state.cashMovements || []).map(row => {
    if (!isPettyCashRow(row) || row.accountingPeriodStatus === 'archived') return row;
    movements++;
    return archive(row);
  });
  state.cashDebts = (state.cashDebts || []).map(row => {
    if (!isPettyCashRow({ ...row, cashBoxType: row.cashBoxType || 'PETTY_CASH' }) || row.accountingPeriodStatus === 'archived') return row;
    debts++;
    return archive(row);
  });
  state.cashSessions = (state.cashSessions || []).map(row => row.cashBoxType === 'PETTY_CASH'
    ? { ...archive(row), status: 'closed', closedAt: now } : row);
  state.settings = { ...state.settings, accounting: { ...state.settings?.accounting,
    pettyResetAt: now, pettyResetBy: userName, pettyResetBackup: backupFile,
    pettyHiddenSupplierLoanIds: (state.supplierLoans || []).map(row => String(row.id)),
    cashBoxesIndependent: true,
  } };
  const log = { id: `petty-reset-${now}`, action: 'petty_cash_reset', createdAt: now, userName,
    backupFile, result: 'success', summary: { movements, debts, pettyCashBs: 0 } };
  state.resetLogs = [log, ...(state.resetLogs || [])];
  state.systemAuditLog = [{ ...log, type: 'petty_cash_reset', detail: 'Caja Chica reiniciada en cero. Caja Grande conservada.' }, ...(state.systemAuditLog || [])];
  return { state, log };
}

export function assertIndependentCashMovement(payload) {
  if (payload?.type === 'transferencia' || payload?.isInternalTransfer) {
    const error = new Error('Caja Grande y Caja Chica son independientes. Registra el ingreso o egreso en su propia caja.');
    error.statusCode = 400;
    throw error;
  }
}
