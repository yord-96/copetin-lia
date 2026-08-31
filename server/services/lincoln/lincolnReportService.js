import { getLincolnStateSnapshot } from '../../storage/lincolnStateStore.js';

const roundMoney = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};
const sumMoney = (rows) => roundMoney(rows.reduce((total, row) => total + roundMoney(row?.amountBs), 0));
const activeRows = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => !row?.voidedAt && row?.status !== 'voided');
const SERVICE_CATEGORIES = new Set(['ANTICIPO', 'A CUENTA', 'SALDO', 'REPOSICION']);
const isGuaranteeIncome = (row) => String(row?.category ?? '').toUpperCase() === 'GARANTIA';
const isGuaranteeReturn = (row) => String(row?.category ?? '').toUpperCase() === 'DEVOLUCION GARANTIA';
const operatingIncomeValue = (row) => {
  const hasAllocation = row?.serviceAllocationBs !== undefined || row?.replacementAllocationBs !== undefined;
  if (hasAllocation) return roundMoney(roundMoney(row?.serviceAllocationBs) + roundMoney(row?.replacementAllocationBs));
  return SERVICE_CATEGORIES.has(String(row?.category ?? '').toUpperCase()) ? roundMoney(row?.amountBs) : 0;
};
const guaranteeIncomeValue = (row) => row?.guaranteeAllocationBs !== undefined ? roundMoney(row.guaranteeAllocationBs) : (isGuaranteeIncome(row) ? roundMoney(row.amountBs) : 0);
const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

const sortByDateDesc = (a, b) => `${b?.date ?? ''}${b?.createdAt ?? ''}`.localeCompare(`${a?.date ?? ''}${a?.createdAt ?? ''}`);

const decorateIncome = (row) => ({
  ...row,
  movementKind: 'income',
  eventCode: row.eventCode ?? '',
  category: row.category ?? 'INGRESO',
});
const decorateExpense = (row) => ({
  ...row,
  movementKind: 'expense',
  eventCode: row.eventCode ?? '',
  category: row.category ?? 'OTROS',
});

export const getLincolnMonthlyReport = async ({ year, month }) => {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 2200 || !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
    const error = new Error('Periodo mensual Lincoln inválido.');
    error.statusCode = 400;
    error.code = 'LINCOLN_REPORT_PERIOD_INVALID';
    throw error;
  }
  const snapshot = await getLincolnStateSnapshot();
  const state = snapshot.state;
  const prefix = monthKey(numericYear, numericMonth);
  const income = activeRows(state.incomeEntries).filter((row) => String(row?.date ?? '').startsWith(prefix)).map(decorateIncome).sort(sortByDateDesc);
  const expenses = activeRows(state.expenseEntries).filter((row) => String(row?.date ?? '').startsWith(prefix)).map(decorateExpense).sort(sortByDateDesc);
  const operatingIncome = income.filter((row) => operatingIncomeValue(row) > 0);
  const operatingExpenses = expenses.filter((row) => !isGuaranteeReturn(row));
  const guaranteeIncome = income.filter((row) => guaranteeIncomeValue(row) > 0);
  const guaranteeReturns = expenses.filter(isGuaranteeReturn);
  const cashIncomeBs = sumMoney(income);
  const cashExpenseBs = sumMoney(expenses);
  const guaranteeAppliedBs = roundMoney((state.economicLedgerEntries ?? []).filter((row) => !row?.voidedAt && row?.type === 'guarantee_apply' && String(row?.createdAt ?? '').startsWith(prefix)).reduce((total, row) => total + roundMoney(row?.amountBs), 0));
  const operatingIncomeBs = roundMoney(operatingIncome.reduce((total, row) => total + operatingIncomeValue(row), 0) + guaranteeAppliedBs);
  const operatingExpenseBs = sumMoney(operatingExpenses);
  return {
    revision: snapshot.revision,
    year: numericYear,
    month: numericMonth,
    income,
    expenses,
    summary: {
      cashIncomeBs,
      cashExpenseBs,
      cashBalanceBs: roundMoney(cashIncomeBs - cashExpenseBs),
      operatingIncomeBs,
      operatingExpenseBs,
      utilityBs: roundMoney(operatingIncomeBs - operatingExpenseBs),
      guaranteeIncomeBs: roundMoney(guaranteeIncome.reduce((total, row) => total + guaranteeIncomeValue(row), 0)),
      guaranteeReturnBs: sumMoney(guaranteeReturns),
      guaranteeAppliedBs,
    },
  };
};

export const getLincolnAnnualReport = async ({ year }) => {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 2200) {
    const error = new Error('Año Lincoln inválido.');
    error.statusCode = 400;
    error.code = 'LINCOLN_REPORT_YEAR_INVALID';
    throw error;
  }
  const snapshot = await getLincolnStateSnapshot();
  const state = snapshot.state;
  const income = activeRows(state.incomeEntries);
  const expenses = activeRows(state.expenseEntries);
  const months = Array.from({ length: 12 }, (_, index) => {
    const prefix = monthKey(numericYear, index + 1);
    const monthIncome = income.filter((row) => String(row?.date ?? '').startsWith(prefix));
    const monthExpenses = expenses.filter((row) => String(row?.date ?? '').startsWith(prefix));
    const operatingIncome = monthIncome.filter((row) => operatingIncomeValue(row) > 0);
    const operatingExpenses = monthExpenses.filter((row) => !isGuaranteeReturn(row));
    const guaranteeAppliedBs = roundMoney((state.economicLedgerEntries ?? []).filter((row) => !row?.voidedAt && row?.type === 'guarantee_apply' && String(row?.createdAt ?? '').startsWith(prefix)).reduce((total, row) => total + roundMoney(row?.amountBs), 0));
    const operatingIncomeBs = roundMoney(operatingIncome.reduce((total, row) => total + operatingIncomeValue(row), 0) + guaranteeAppliedBs);
    const operatingExpenseBs = sumMoney(operatingExpenses);
    return {
      month: index + 1,
      cashIncomeBs: sumMoney(monthIncome),
      cashExpenseBs: sumMoney(monthExpenses),
      operatingIncomeBs,
      operatingExpenseBs,
      utilityBs: roundMoney(operatingIncomeBs - operatingExpenseBs),
    };
  });
  return {
    revision: snapshot.revision,
    year: numericYear,
    months,
    summary: {
      cashIncomeBs: roundMoney(months.reduce((total, row) => total + row.cashIncomeBs, 0)),
      cashExpenseBs: roundMoney(months.reduce((total, row) => total + row.cashExpenseBs, 0)),
      operatingIncomeBs: roundMoney(months.reduce((total, row) => total + row.operatingIncomeBs, 0)),
      operatingExpenseBs: roundMoney(months.reduce((total, row) => total + row.operatingExpenseBs, 0)),
      utilityBs: roundMoney(months.reduce((total, row) => total + row.utilityBs, 0)),
    },
  };
};

export const getLincolnEventReport = async ({ eventId }) => {
  const snapshot = await getLincolnStateSnapshot();
  const state = snapshot.state;
  const event = (Array.isArray(state.events) ? state.events : []).find((row) => String(row?.id ?? '') === String(eventId ?? ''));
  if (!event) {
    const error = new Error('Evento Lincoln no encontrado.');
    error.statusCode = 404;
    error.code = 'LINCOLN_EVENT_NOT_FOUND';
    throw error;
  }
  const income = activeRows(state.incomeEntries).filter((row) => String(row?.eventId ?? '') === String(event.id)).map(decorateIncome).sort(sortByDateDesc);
  const expenses = activeRows(state.expenseEntries).filter((row) => String(row?.eventId ?? '') === String(event.id)).map(decorateExpense).sort(sortByDateDesc);
  const operatingIncome = income.filter((row) => operatingIncomeValue(row) > 0);
  const operatingExpenses = expenses.filter((row) => !isGuaranteeReturn(row));
  const guaranteeAppliedBs = roundMoney((state.economicLedgerEntries ?? []).filter((row) => !row?.voidedAt && row?.type === 'guarantee_apply' && String(row?.eventId ?? '') === String(event.id)).reduce((total, row) => total + roundMoney(row?.amountBs), 0));
  const operatingIncomeBs = roundMoney(operatingIncome.reduce((total, row) => total + operatingIncomeValue(row), 0) + guaranteeAppliedBs);
  const operatingExpenseBs = sumMoney(operatingExpenses);
  return {
    revision: snapshot.revision,
    event,
    income,
    expenses,
    summary: {
      operatingIncomeBs,
      operatingExpenseBs,
      utilityBs: roundMoney(operatingIncomeBs - operatingExpenseBs),
      guaranteeIncomeBs: roundMoney(income.reduce((total, row) => total + guaranteeIncomeValue(row), 0)),
      guaranteeReturnBs: sumMoney(expenses.filter(isGuaranteeReturn)),
      guaranteeAppliedBs,
    },
  };
};
