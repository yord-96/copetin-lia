const money = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(2))) : 0;
};

// Reconstruct the balance at this operation, rather than using the original
// reserve or today's balance after subsequent applications/refunds.
export const getGuaranteeApplicationReceiptBalances = ({
  entry, ledger = [], availableGuaranteeBs = 0,
  isCashCharge = () => false,
  isConfirmedRefund = () => false,
  isBackedGuarantee = () => false,
} = {}) => {
  const rows = ledger.filter(row => !row.deletedAt).map((row, index) => ({ row, index }))
    .sort((a, b) => (Date.parse(a.row.createdAt) || 0) - (Date.parse(b.row.createdAt) || 0) || a.index - b.index);
  const position = rows.findIndex(({ row }) => String(row.id) === String(entry?.id));
  if (position < 0) throw new Error('No se encontró la aplicación de garantía en el historial.');
  let afterBs = money(availableGuaranteeBs);
  for (const { row } of rows.slice(position + 1)) {
    if (row.type === 'guarantee' && isBackedGuarantee(row)) afterBs -= money(row.amountBs);
    if (row.type === 'guarantee_apply'
      || (row.type === 'charge' && !isCashCharge(row))
      || (row.type === 'refund' && row.refundSource !== 'surplus' && isConfirmedRefund(row))) {
      afterBs += money(row.amountBs);
    }
  }
  return { guaranteeBeforeBs: money(afterBs + money(entry.amountBs)), guaranteeAfterBs: money(afterBs) };
};

export const buildGuaranteeApplicationPlan = ({
  availableGuaranteeBs = 0,
  rentalPendingBs = 0,
  damagePendingBs = 0,
} = {}) => {
  const guaranteeBs = money(availableGuaranteeBs);
  const rentalPending = money(rentalPendingBs);
  const damagePending = money(damagePendingBs);
  const rentalAppliedBs = Math.min(guaranteeBs, rentalPending);
  const afterRentalBs = money(guaranteeBs - rentalAppliedBs);
  const damageAppliedBs = Math.min(afterRentalBs, damagePending);
  const appliedBs = money(rentalAppliedBs + damageAppliedBs);
  const refundBs = money(guaranteeBs - appliedBs);

  return {
    guaranteeBs,
    rentalPendingBs: rentalPending,
    damagePendingBs: damagePending,
    rentalAppliedBs,
    damageAppliedBs,
    appliedBs,
    refundBs,
  };
};
