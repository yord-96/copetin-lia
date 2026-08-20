const normalizeReference = (value) => String(value ?? '').trim().toLowerCase();

const referenceSet = (...values) => new Set(
  values.flat().map(normalizeReference).filter(Boolean),
);

const firstReference = (...values) => values
  .map(normalizeReference)
  .find(Boolean) ?? '';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const textHasExplicitContractCode = (value, contractCodes) => {
  const text = normalizeReference(value);
  if (!text) return false;
  return [...contractCodes].some((code) => new RegExp(
    `\\bcontrato\\s*(?:n(?:ro|o)?\\.?\\s*)?[:#-]?\\s*${escapeRegExp(code)}\\b`,
    'i',
  ).test(text));
};

const textHasOrderCode = (value, orderCodes) => {
  const text = normalizeReference(value);
  if (!text) return false;
  return [...orderCodes].some((code) => new RegExp(
    `(?:^|[^a-z0-9])${escapeRegExp(code)}(?:$|[^a-z0-9])`,
    'i',
  ).test(text));
};

/**
 * Relaciona un movimiento de caja con un contrato sin buscar el numero de
 * contrato como subcadena libre. Esa busqueda confundia, por ejemplo, el
 * contrato 2026 con cualquier observacion que contuviera una fecha de 2026.
 */
export const cashMovementMatchesContractReferences = (movement, references = {}) => {
  const contractIds = referenceSet(references.contractIds ?? [], references.contractId);
  const rentalIds = referenceSet(references.rentalIds ?? [], references.rentalId);
  const orderCodes = referenceSet(references.orderCodes ?? [], references.orderCode);
  const contractCodes = referenceSet(references.contractCodes ?? [], references.contractCode);

  const movementContractId = firstReference(movement?.linkedContractId, movement?.contractId);
  const movementRentalId = firstReference(movement?.linkedRentalId, movement?.rentalId);
  const movementSourceId = normalizeReference(movement?.sourceId);
  const movementSourceType = normalizeReference(movement?.sourceType);

  // Los IDs son definitivos: si existen, nunca se intenta asociar por texto.
  if (movementContractId) return contractIds.has(movementContractId);
  if (movementRentalId) return rentalIds.has(movementRentalId);
  if (movementSourceId && movementSourceType.includes('contract')) return contractIds.has(movementSourceId);
  if (movementSourceId && movementSourceType.includes('rental')) return rentalIds.has(movementSourceId);

  const movementOrderCode = firstReference(movement?.linkedOrderCode, movement?.orderCode);
  const movementContractCode = normalizeReference(movement?.contractCode);
  const movementReference = normalizeReference(movement?.reference);
  const hasStructuredCode = Boolean(movementOrderCode || movementContractCode || movementReference || movementSourceId);

  if (movementOrderCode && orderCodes.has(movementOrderCode)) return true;
  if (movementContractCode && contractCodes.has(movementContractCode)) return true;
  if (movementReference && (orderCodes.has(movementReference) || contractCodes.has(movementReference))) return true;
  if (movementSourceId && (orderCodes.has(movementSourceId) || contractCodes.has(movementSourceId))) return true;
  if (hasStructuredCode) return false;

  // Compatibilidad conservadora para movimientos antiguos sin ningun vinculo.
  // Requiere una referencia explicita ("Contrato 2026" u "OS-00658").
  const movementCreatedAtMs = new Date(movement?.createdAt ?? 0).getTime();
  const contractCreatedAtMs = Number(references.createdAtMs ?? 0);
  if (
    Number.isFinite(contractCreatedAtMs)
    && contractCreatedAtMs > 0
    && Number.isFinite(movementCreatedAtMs)
    && movementCreatedAtMs > 0
    && movementCreatedAtMs + 1000 < contractCreatedAtMs
  ) return false;

  return [movement?.notes, movement?.description].some((value) => (
    textHasOrderCode(value, orderCodes)
    || textHasExplicitContractCode(value, contractCodes)
  ));
};
