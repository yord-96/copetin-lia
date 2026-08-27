const toIsoOrNull = (value) => {
  const parsed = new Date(value ?? '');
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const resolveEconomicReceiptTimestamps = (
  { createdAt = null, receiptIssuedAt = null } = {},
  fallbackDate = new Date(),
) => {
  const fallbackIso = toIsoOrNull(fallbackDate) ?? new Date().toISOString();
  const createdAtIso = toIsoOrNull(createdAt) ?? fallbackIso;
  return {
    createdAt: createdAtIso,
    receiptIssuedAt: toIsoOrNull(receiptIssuedAt ?? createdAt) ?? createdAtIso,
  };
};

export const resolveEconomicReceiptDisplayTimestamp = ({ movement = {}, ledgerEntry = null } = {}) => {
  const explicitlyEditedAt = movement?.receiptEditedAt && toIsoOrNull(movement?.receiptIssuedAt);
  return explicitlyEditedAt
    ?? toIsoOrNull(ledgerEntry?.createdAt)
    ?? toIsoOrNull(movement?.receiptIssuedAt)
    ?? toIsoOrNull(movement?.createdAt)
    ?? new Date().toISOString();
};
