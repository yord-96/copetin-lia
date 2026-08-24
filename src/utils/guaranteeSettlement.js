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

const isActiveLedgerEntry = (entry) => !entry?.deletedAt;

const isConfirmedLedgerEntry = (entry) => Boolean(
  entry?.isCashRegistered
  || String(entry?.cashMovementId ?? '').trim()
  || String(entry?.cashReceiptCode ?? '').trim()
);

const isGuaranteeRefundEntry = (entry) => {
  const type = String(entry?.type ?? '').trim().toLowerCase();
  const source = String(entry?.refundSource ?? entry?.source ?? '').trim().toLowerCase();
  const tag = String(entry?.accountingTag ?? '').trim().toLowerCase();
  return type === 'refund' && (source === 'guarantee' || source === 'garantia' || tag === 'guarantee_refund');
};

/**
 * Rebuilds guarantee evidence from the durable contract ledger when the fast
 * accounting bootstrap does not include old cash movements.
 */
export const getGuaranteeLedgerEvidence = (contract) => {
  const ledger = (Array.isArray(contract?.economicLedger) ? contract.economicLedger : [])
    .filter(isActiveLedgerEntry);
  const deposits = ledger.filter((entry) => entry?.type === 'deposit' && isConfirmedLedgerEntry(entry));
  const depositsById = new Map(deposits
    .map((entry) => [String(entry?.id ?? '').trim(), entry])
    .filter(([id]) => id));
  const reclassifiedByDeposit = new Map();

  ledger
    .filter((entry) => entry?.type === 'guarantee' && (entry?.reclassifiedFromPayment || entry?.sourceDepositId))
    .forEach((entry) => {
      const sourceId = String(entry?.sourceDepositId ?? '').trim();
      if (!sourceId || !depositsById.has(sourceId)) return;
      reclassifiedByDeposit.set(
        sourceId,
        Math.max(toMoney(reclassifiedByDeposit.get(sourceId)), toMoney(entry?.amountBs)),
      );
    });

  const getDepositGuaranteeBs = (entry) => Math.max(
    toMoney(entry?.guaranteeAllocationBs),
    toMoney(reclassifiedByDeposit.get(String(entry?.id ?? '').trim())),
  );
  const depositGuaranteeBs = deposits.reduce((sum, entry) => sum + getDepositGuaranteeBs(entry), 0);
  const directGuaranteeEntries = ledger.filter((entry) => (
    entry?.type === 'guarantee'
    && !entry?.reclassifiedFromPayment
    && !String(entry?.sourceDepositId ?? '').trim()
    && isConfirmedLedgerEntry(entry)
  ));
  const directGuaranteeBs = directGuaranteeEntries.reduce(
    (sum, entry) => sum + toMoney(entry?.amountBs),
    0,
  );
  const refundEntries = ledger.filter((entry) => isGuaranteeRefundEntry(entry) && isConfirmedLedgerEntry(entry));

  return {
    paidBs: toMoney(depositGuaranteeBs + directGuaranteeBs),
    refundedBs: toMoney(refundEntries.reduce((sum, entry) => sum + toMoney(entry?.amountBs), 0)),
    paymentEntries: [
      ...deposits.filter((entry) => getDepositGuaranteeBs(entry) > 0),
      ...directGuaranteeEntries,
    ],
    refundEntries,
  };
};

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
