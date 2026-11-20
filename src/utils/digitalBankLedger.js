import { compareCashLedgerOrder, getCashEffectiveDate } from './cashLedgerOrder.js';
import { isActivePettyCashMovement } from './pettyCashFund.js';

const round = value => Math.round(value * 100) / 100;
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function buildDigitalBankLedger(movements, { bank = 'all', dateFrom = '', dateTo = '', query = '', category = 'all' } = {}) {
  const balances = {};
  let totalBs = 0;
  const rows = movements.filter(row => isActivePettyCashMovement(row) && String(row.paymentMethod || '').trim().toLowerCase() === 'qr')
    .slice().sort(compareCashLedgerOrder).map(row => {
      const account = String(row.paymentAccount || 'SIN BANCO').trim().toUpperCase();
      const amount = Number(row.amountBs) || 0;
      const bankBeforeBs = balances[account] || 0;
      const totalBeforeBs = totalBs;
      balances[account] = round(bankBeforeBs + amount);
      totalBs = round(totalBs + amount);
      return { ...row, bank: account, bankBeforeBs, totalBeforeBs, bankBalanceBs: balances[account], digitalBalanceBs: totalBs };
    }).filter(row => {
      const date = getCashEffectiveDate(row);
      return (bank === 'all' || row.bank === bank) && (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo)
        && (category === 'all' || row.categoryClass === category)
        && (!query || normalize([row.description, row.customerLabel, row.referenceLabel, row.receipt, row.receiptCode, row.createdBy, row.responsible, row.bank].join(' ')).includes(normalize(query)));
    });
  return { rows, balances, totalBs, incomeBs: round(rows.reduce((sum, row) => sum + Math.max(0, Number(row.amountBs) || 0), 0)), expenseBs: round(rows.reduce((sum, row) => sum + Math.max(0, -Number(row.amountBs) || 0), 0)) };
}
