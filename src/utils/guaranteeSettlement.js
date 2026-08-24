const toMoney = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(2))) : 0;
};

export const calculateGuaranteePaidEvidence = (
  movements = [],
  isDirectGuarantee = () => false,
) => toMoney((Array.isArray(movements) ? movements : []).reduce((sum, movement) => {
  const directGuaranteeBs = isDirectGuarantee(movement)
    ? toMoney(movement?.amountBs)
    : 0;
  const allocatedGuaranteeBs = toMoney(movement?.guaranteeAllocationBs);
  return sum + Math.max(directGuaranteeBs, allocatedGuaranteeBs);
}, 0));

export const calculateGuaranteeSettlement = ({
  paidBs = 0,
  appliedBs = 0,
  refundedBs = 0,
} = {}) => {
  const paid = toMoney(paidBs);
  const applied = Math.min(paid, toMoney(appliedBs));
  const refundableBeforeRefundBs = toMoney(paid - applied);
  const refunded = Math.min(refundableBeforeRefundBs, toMoney(refundedBs));
  const pendingRefundBs = toMoney(refundableBeforeRefundBs - refunded);
  const isPartiallyRefunded = refunded > 0.009 && pendingRefundBs > 0.009;
  const isFullyResolved = paid > 0.009 && pendingRefundBs <= 0.009;

  return {
    paidBs: paid,
    appliedBs: applied,
    refundableBeforeRefundBs,
    refundedBs: refunded,
    pendingRefundBs,
    isPartiallyRefunded,
    isFullyResolved,
  };
};
