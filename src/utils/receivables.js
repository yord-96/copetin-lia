const money = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};

const isConfirmedLedgerEntry = (entry) => Boolean(
  entry?.isCashRegistered
  || String(entry?.cashMovementId ?? '').trim()
  || String(entry?.cashReceiptCode ?? '').trim()
);

/**
 * Returns the commercial portion of confirmed deposits recorded in the
 * contract ledger. Guarantees and surplus are deliberately excluded.
 */
export const getConfirmedContractLedgerPaidBs = (contract, contractTotalBs = 0) => {
  const ledger = (Array.isArray(contract?.economicLedger) ? contract.economicLedger : [])
    .filter((entry) => !entry?.deletedAt);
  const deposits = ledger
    .filter((entry) => {
      if (entry?.type !== 'deposit' || entry?.reclassifiedFromPayment || !isConfirmedLedgerEntry(entry)) return false;
      const target = String(entry?.cashCollectionTarget ?? '').trim().toLowerCase();
      return !['damage', 'guarantee'].includes(target);
    })
    .sort((left, right) => new Date(left?.createdAt ?? 0) - new Date(right?.createdAt ?? 0));
  const guarantees = ledger.filter((entry) => entry?.type === 'guarantee');
  const guaranteeByDeposit = guarantees.reduce((map, entry) => {
    const sourceId = String(entry?.sourceDepositId ?? '').trim();
    if (sourceId) map.set(sourceId, money((map.get(sourceId) ?? 0) + money(entry?.amountBs)));
    return map;
  }, new Map());
  let unassignedGuaranteeBs = guarantees.reduce((sum, entry) => {
    if (String(entry?.sourceDepositId ?? '').trim()) return sum;
    if (isConfirmedLedgerEntry(entry)) return sum;
    return sum + Math.max(0, money(entry?.amountBs));
  }, 0);
  let remainingContractBs = Math.max(0, money(contractTotalBs));
  let paidBs = 0;

  deposits.forEach((entry) => {
    const receivedBs = Math.max(0, money(entry?.amountBs));
    const savedContractBs = Math.max(0, money(entry?.contractAllocationBs));
    const savedGuaranteeBs = Math.max(0, money(entry?.guaranteeAllocationBs));
    const savedSurplusBs = Math.max(0, money(entry?.surplusAllocationBs));
    const savedTotalBs = money(savedContractBs + savedGuaranteeBs + savedSurplusBs);
    let contractBs;

    if (savedTotalBs > 0 && Math.abs(savedTotalBs - receivedBs) < 0.01) {
      contractBs = Math.min(savedContractBs, remainingContractBs);
      const explicitlyLinkedBs = Math.max(0, money(guaranteeByDeposit.get(String(entry?.id ?? ''))));
      unassignedGuaranteeBs = Math.max(0, money(unassignedGuaranteeBs - Math.max(0, savedGuaranteeBs - explicitlyLinkedBs)));
    } else {
      const explicitGuaranteeBs = Math.min(receivedBs, Math.max(0, money(guaranteeByDeposit.get(String(entry?.id ?? '')))));
      const afterExplicitBs = Math.max(0, money(receivedBs - explicitGuaranteeBs));
      const inferredGuaranteeBs = Math.min(afterExplicitBs, unassignedGuaranteeBs);
      unassignedGuaranteeBs = Math.max(0, money(unassignedGuaranteeBs - inferredGuaranteeBs));
      contractBs = Math.min(Math.max(0, money(afterExplicitBs - inferredGuaranteeBs)), remainingContractBs);
    }

    paidBs = money(paidBs + contractBs);
    remainingContractBs = Math.max(0, money(remainingContractBs - contractBs));
  });

  return Math.min(Math.max(0, money(contractTotalBs)), Math.max(0, paidBs));
};

/** Builds the same auditable receivable breakdown for every screen/report. */
export const calculateReceivableBreakdown = ({
  rental,
  contract,
  confirmedCommercialPaidBs = 0,
  commercialPaidOverrideBs = null,
  prepaidAppliedBs = 0,
  damageChargeOverrideBs = null,
  damageCoveredOverrideBs = null,
  damageCollectedOverrideBs = null,
  deliveryFeeOverrideBs = null,
  deliveryCollectedOverrideBs = null,
} = {}) => {
  const settlement = rental?.returnSettlement ?? {};
  const totalBs = Math.max(0, money(rental?.totals?.totalBs), money(contract?.totals?.totalBs ?? contract?.totalBs));
  const storedPaidBs = Math.max(
    0,
    money(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs),
    money(contract?.payment?.paidAtApprovalBs),
    // Returned rentals keep the reconciled commercial amount here. This is
    // the canonical fallback when old payment fields were not synchronized
    // after collecting the balance from the return workflow.
    money(settlement?.paidBs),
  );
  const paidBs = Math.min(
    totalBs,
    commercialPaidOverrideBs === null
      ? Math.max(storedPaidBs, money(confirmedCommercialPaidBs), money(prepaidAppliedBs))
      : Math.max(0, money(commercialPaidOverrideBs)),
  );
  const commercialPendingBs = Math.max(0, money(totalBs - paidBs));
  const damageChargeBs = Math.max(0, money(damageChargeOverrideBs ?? settlement?.penaltiesBs ?? rental?.penaltiesBs));
  const damageCoveredBs = Math.max(0, money(damageCoveredOverrideBs ?? settlement?.discountCoveredByDepositBs));
  const damageCollectedBs = damageCollectedOverrideBs === null
    ? Math.max(
        0,
        money(settlement?.damageCollectedBs),
        money(settlement?.penaltiesCollectedBs),
        money(rental?.payment?.damageCollectedBs),
        money(rental?.payment?.penaltiesCollectedBs),
        money(rental?.payment?.returnChargesCollectedBs),
        money(rental?.totals?.damageCollectedBs),
        money(rental?.totals?.penaltiesCollectedBs),
        money(rental?.totals?.returnChargesCollectedBs),
      )
    : Math.max(0, money(damageCollectedOverrideBs));
  const damagePendingBs = Math.max(0, money(damageChargeBs - damageCoveredBs - damageCollectedBs));
  const deliveryFeeBs = deliveryFeeOverrideBs === null
    ? Math.max(0, money(rental?.totals?.deliveryFeeBs), money(rental?.deliveryFeeBs), money(contract?.totals?.deliveryFeeBs), money(contract?.deliveryFeeBs))
    : Math.max(0, money(deliveryFeeOverrideBs));
  const deliveryCollectedBs = Math.max(0, money(deliveryCollectedOverrideBs ?? rental?.payment?.deliveryFeeCollectedBs ?? rental?.totals?.deliveryFeeCollectedBs));
  const transportPendingBs = Math.min(commercialPendingBs, Math.max(0, money(deliveryFeeBs - deliveryCollectedBs)));
  const contractPendingBs = Math.max(0, money(commercialPendingBs - transportPendingBs));

  return {
    totalBs,
    paidBs,
    contractPendingBs,
    transportPendingBs,
    damagePendingBs,
    commercialPendingBs,
    totalPendingBs: money(commercialPendingBs + damagePendingBs),
    status: commercialPendingBs + damagePendingBs > 0.009 ? 'pending' : 'paid',
  };
};
