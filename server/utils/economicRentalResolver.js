const normalizeKey = (value) => String(value ?? '').trim().toLocaleLowerCase('es-BO');

const rentalStatusPriority = (rental) => {
  const status = normalizeKey(rental?.status);
  if (status === 'returned') return 50;
  if (['cancelled', 'canceled', 'anulado', 'eliminado'].includes(status)) return -50;
  if (['active', 'approved', 'aprobado', 'confirmed', 'confirmado'].includes(status)) return 30;
  return 10;
};

const pickBestRental = (rentals) => rentals
  .slice()
  .sort((left, right) => {
    const statusDifference = rentalStatusPriority(right) - rentalStatusPriority(left);
    if (statusDifference) return statusDifference;
    return new Date(right?.updatedAt ?? right?.createdAt ?? 0) - new Date(left?.updatedAt ?? left?.createdAt ?? 0);
  })[0] ?? null;

/**
 * Resolves one economic/operational rental without allowing a legacy duplicate
 * to win over the exact rental or order supplied by the caller.
 */
export const resolveActiveRentalForContract = (rentals, contract, serviceOrder = null, payload = null) => {
  const activeRentals = (Array.isArray(rentals) ? rentals : []).filter((entry) => !entry?.deletedAt);
  const exactRentalIds = [
    payload?.rentalId,
    payload?.linkedRentalId,
    contract?.rentalId,
    serviceOrder?.rentalId,
  ].map(normalizeKey).filter(Boolean);

  for (const rentalId of exactRentalIds) {
    const exact = activeRentals.find((entry) => normalizeKey(entry?.id) === rentalId);
    if (exact) return exact;
  }

  const contractId = normalizeKey(contract?.id ?? payload?.linkedContractId ?? payload?.contractId);
  const exactOrderCodes = [
    payload?.linkedOrderCode,
    payload?.orderCode,
    serviceOrder?.orderCode,
    serviceOrder?.codigo,
    contract?.orderCode,
  ].map(normalizeKey).filter(Boolean);

  for (const orderCode of exactOrderCodes) {
    const matches = activeRentals.filter((entry) => normalizeKey(entry?.orderCode) === orderCode);
    const sameContract = matches.filter((entry) => !normalizeKey(entry?.contractId) || normalizeKey(entry?.contractId) === contractId);
    const exact = pickBestRental(sameContract.length ? sameContract : matches);
    if (exact) return exact;
  }

  if (contractId) {
    const exact = pickBestRental(activeRentals.filter((entry) => normalizeKey(entry?.contractId) === contractId));
    if (exact) return exact;
  }

  const contractCode = normalizeKey(contract?.contractCode ?? contract?.number ?? payload?.contractCode);
  if (!contractCode) return null;
  const legacyMatches = activeRentals.filter((entry) => {
    const entryContractId = normalizeKey(entry?.contractId);
    return normalizeKey(entry?.contractCode ?? entry?.number) === contractCode
      && (!entryContractId || !contractId || entryContractId === contractId);
  });
  return pickBestRental(legacyMatches);
};

