import { reconcileContractDocumentPayments } from '../../src/utils/contractDocumentPayments.js';
const toPositiveRoundedNumber = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100) / 100;
};

export const getOrdersContractCashEconomicSummary = (contract = {}, cashMovements = []) => {
  const keys = new Set([
    contract?.id,
    contract?.rentalId,
    contract?.contractCode,
    contract?.orderCode,
  ].map((value) => String(value ?? '').trim()).filter(Boolean));

  if (!keys.size || !Array.isArray(cashMovements) || !cashMovements.length) {
    return { contractPaidBs: 0, guaranteePaidBs: 0, totalReceivedBs: 0, receiptCount: 0 };
  }

  const matchesContract = (movement) => [
    movement?.linkedContractId,
    movement?.linkedRentalId,
    movement?.linkedOrderCode,
    movement?.contractId,
    movement?.rentalId,
    movement?.contractCode,
    movement?.orderCode,
    movement?.reference,
    movement?.sourceId,
  ].map((value) => String(value ?? '').trim()).some((value) => value && keys.has(value));

  const totals = (cashMovements ?? []).reduce((acc, movement) => {
    if (!movement || movement?.deletedAt || movement?.voidedAt || !matchesContract(movement)) return acc;
    const receiptStatus = String(movement?.receiptStatus ?? '').trim().toLowerCase();
    if (receiptStatus === 'anulado') return acc;

    const type = String(movement?.type ?? '').trim().toLowerCase();
    const category = String(movement?.category ?? '').trim().toLowerCase();
    const tag = String(movement?.accountingTag ?? '').trim().toLowerCase();
    const amountBs = toPositiveRoundedNumber(Math.abs(Number(movement?.amountBs ?? 0)));
    const receivedAmountBs = toPositiveRoundedNumber(
      movement?.receivedAmountBs ?? (amountBs > 0 ? amountBs : 0),
    );
    const explicitContractBs = toPositiveRoundedNumber(movement?.contractAllocationBs);
    const explicitGuaranteeBs = toPositiveRoundedNumber(movement?.guaranteeAllocationBs);
    const target = String(movement?.collectionTarget ?? '').trim().toLowerCase();
    const isExtra = tag === 'contract_extra_collection' || category === 'cobro_extra_contrato';
    const isDamage = target === 'damage' || tag.includes('damage') || category.includes('dano');
    const isDepositReceipt = tag === 'contract_deposit_receipt' || category === 'abono_contrato';
    const isCommercialCollection = isDepositReceipt
      || tag === 'contract_economic_collection'
      || category === 'cobro_contrato'
      || type === 'ingreso_alquiler'
      || type.includes('cobro_saldo');

    if (!isExtra && !isDamage && isCommercialCollection) {
      acc.contractPaidBs += explicitContractBs > 0
        ? explicitContractBs
        : (target === 'balance' ? amountBs : 0);
    }
    acc.guaranteePaidBs += explicitGuaranteeBs;
    if (isDepositReceipt || explicitContractBs > 0 || explicitGuaranteeBs > 0) {
      acc.totalReceivedBs += receivedAmountBs;
      if (String(movement?.receiptCode ?? movement?.receipt ?? '').trim()) acc.receiptCount += 1;
    }
    return acc;
  }, { contractPaidBs: 0, guaranteePaidBs: 0, totalReceivedBs: 0, receiptCount: 0 });

  return {
    contractPaidBs: toPositiveRoundedNumber(Math.max(totals.contractPaidBs, reconcileContractDocumentPayments(contract, {id:contract.rentalId,orderCode:contract.orderCode}, cashMovements).appliedBs)),
    guaranteePaidBs: toPositiveRoundedNumber(totals.guaranteePaidBs),
    totalReceivedBs: toPositiveRoundedNumber(totals.totalReceivedBs),
    receiptCount: totals.receiptCount,
  };
};

export const getOrdersGuaranteeEconomicSummary = (contract = {}, cashMovements = [], cashSummary = getOrdersContractCashEconomicSummary(contract, cashMovements)) => {
  const declaredBs = toPositiveRoundedNumber(
    contract?.totals?.guaranteeBs ?? contract?.guarantee?.amountBs ?? 0,
  );
  const rawLedger = Array.isArray(contract?.economicLedger) ? contract.economicLedger : [];
  const ledger = rawLedger.filter((entry) => !entry?.deletedAt);
  const byId = new Map(ledger
    .map((entry) => [String(entry?.id ?? '').trim(), entry])
    .filter(([id]) => Boolean(id)));
  const isCashConfirmed = (entry) => Boolean(
    entry?.isCashRegistered
    || String(entry?.cashMovementId ?? '').trim()
    || String(entry?.cashReceiptCode ?? '').trim()
  );

  const confirmedDepositGuaranteeBs = ledger.reduce((sum, entry) => {
    if (entry?.type !== 'deposit' || entry?.reclassifiedFromPayment || !isCashConfirmed(entry)) return sum;
    return sum + toPositiveRoundedNumber(entry?.guaranteeAllocationBs);
  }, 0);

  const explicitGuaranteePaidBs = ledger.reduce((sum, entry) => {
    if (entry?.type !== 'guarantee') return sum;
    const sourceDeposit = String(entry?.sourceDepositId ?? '').trim();
    const backedByDeposit = Boolean(
      entry?.reclassifiedFromPayment
      && sourceDeposit
      && isCashConfirmed(byId.get(sourceDeposit)),
    );
    if (!isCashConfirmed(entry) && !backedByDeposit) return sum;
    return sum + toPositiveRoundedNumber(entry?.amountBs);
  }, 0);

  const rawStatus = String(
    contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? '',
  ).trim().toLowerCase();
  const storedValidatedBs = toPositiveRoundedNumber(contract?.guarantee?.validatedBs);

  const paidBs = toPositiveRoundedNumber(Math.max(
    rawStatus === 'validado' ? Math.max(storedValidatedBs, declaredBs) : storedValidatedBs,
    explicitGuaranteePaidBs,
    confirmedDepositGuaranteeBs,
    cashSummary.guaranteePaidBs,
  ));

  const refundedBs = toPositiveRoundedNumber(Math.min(
    paidBs,
    ledger.reduce((sum, entry) => {
      if (entry?.type !== 'refund' || entry?.refundSource === 'surplus') return sum;
      if (!isCashConfirmed(entry)) return sum;
      return sum + toPositiveRoundedNumber(entry?.amountBs);
    }, 0),
  ));

  const appliedBs = toPositiveRoundedNumber(Math.min(
    Math.max(0, paidBs - refundedBs),
    ledger.reduce((sum, entry) => {
      if (entry?.type === 'guarantee_apply') {
        return sum + toPositiveRoundedNumber(entry?.amountBs);
      }
      if (entry?.type !== 'charge') return sum;
      const note = String(entry?.note ?? '').trim().toLowerCase();
      const target = String(entry?.cashCollectionTarget ?? '').trim().toLowerCase();
      const isGuaranteeApplication = Boolean(
        entry?.appliedFromGuarantee
        || entry?.guaranteeApplied
        || target === 'guarantee'
        || (note.includes('garantia') && (note.includes('aplic') || note.includes('descont'))),
      );
      return isGuaranteeApplication ? sum + toPositiveRoundedNumber(entry?.amountBs) : sum;
    }, 0),
  ));

  const pendingRefundBs = toPositiveRoundedNumber(Math.max(0, paidBs - appliedBs - refundedBs));
  const isFullyResolved = paidBs > 0 && pendingRefundBs <= 0.009;
  const status = declaredBs <= 0
    ? 'none'
    : isFullyResolved && refundedBs > 0 && appliedBs > 0
      ? 'mixed'
    : isFullyResolved && refundedBs > 0
      ? 'returned'
      : isFullyResolved && appliedBs > 0
        ? 'charged'
        : refundedBs > 0
          ? 'partial'
          : paidBs > 0
            ? 'held'
            : 'pending';

  return {
    declaredBs,
    paidBs,
    appliedBs,
    refundedBs,
    pendingRefundBs,
    status,
  };
};

