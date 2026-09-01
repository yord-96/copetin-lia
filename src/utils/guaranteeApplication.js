const money = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(2))) : 0;
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
