import { cashMovementMatchesContractReferences } from './contractCashLinks.js';

const isUnavailableMovement = (movement) => Boolean(
  movement?.deletedAt
  || movement?.accountingArchivedAt
  || movement?.accountingPeriodStatus === 'archived'
  || movement?.voidedAt
  || String(movement?.receiptStatus ?? '').toLowerCase() === 'anulado'
  || Number(movement?.amountBs ?? 0) <= 0
  || movement?.isInternalTransfer
);

const normalizeReference = (value) => String(value ?? '').trim().toLowerCase();
const firstReference = (...values) => values.find((value) => normalizeReference(value)) ?? '';

const addReferenceIndex = (index, value, groupIndex) => {
  const normalized = normalizeReference(value);
  if (!normalized) return;
  const positions = index.get(normalized) ?? new Set();
  positions.add(groupIndex);
  index.set(normalized, positions);
};

const collectCandidates = (index, value, target) => {
  const positions = index.get(normalizeReference(value));
  if (positions) positions.forEach((position) => target.add(position));
};

export const buildContractCollectionGroups = ({ movements = [], references = [] } = {}) => {
  const availableMovements = movements.filter((movement) => !isUnavailableMovement(movement));
  const groups = references.map((reference) => ({
    key: String(reference?.key ?? ''),
    movements: [],
  }));
  const contractIdIndex = new Map();
  const rentalIdIndex = new Map();
  const orderCodeIndex = new Map();
  const contractCodeIndex = new Map();
  references.forEach((reference, groupIndex) => {
    [...(reference?.contractIds ?? []), reference?.contractId]
      .forEach((value) => addReferenceIndex(contractIdIndex, value, groupIndex));
    [...(reference?.rentalIds ?? []), reference?.rentalId]
      .forEach((value) => addReferenceIndex(rentalIdIndex, value, groupIndex));
    [...(reference?.orderCodes ?? []), reference?.orderCode]
      .forEach((value) => addReferenceIndex(orderCodeIndex, value, groupIndex));
    [...(reference?.contractCodes ?? []), reference?.contractCode]
      .forEach((value) => addReferenceIndex(contractCodeIndex, value, groupIndex));
  });

  availableMovements.forEach((movement) => {
    const candidates = new Set();
    const movementContractId = firstReference(movement?.linkedContractId, movement?.contractId);
    const movementRentalId = firstReference(movement?.linkedRentalId, movement?.rentalId);
    const sourceId = movement?.sourceId;
    const sourceType = normalizeReference(movement?.sourceType);
    if (normalizeReference(movementContractId)) {
      collectCandidates(contractIdIndex, movementContractId, candidates);
    } else if (normalizeReference(movementRentalId)) {
      collectCandidates(rentalIdIndex, movementRentalId, candidates);
    } else if (normalizeReference(sourceId) && sourceType.includes('contract')) {
      collectCandidates(contractIdIndex, sourceId, candidates);
    } else if (normalizeReference(sourceId) && sourceType.includes('rental')) {
      collectCandidates(rentalIdIndex, sourceId, candidates);
    } else {
      collectCandidates(orderCodeIndex, firstReference(movement?.linkedOrderCode, movement?.orderCode), candidates);
      collectCandidates(contractCodeIndex, movement?.contractCode, candidates);
      collectCandidates(orderCodeIndex, movement?.reference, candidates);
      collectCandidates(contractCodeIndex, movement?.reference, candidates);
      collectCandidates(orderCodeIndex, sourceId, candidates);
      collectCandidates(contractCodeIndex, sourceId, candidates);

      const hasStructuredReference = [
        movement?.linkedOrderCode,
        movement?.orderCode,
        movement?.contractCode,
        movement?.reference,
        sourceId,
      ].some((value) => normalizeReference(value));
      if (!hasStructuredReference) {
        references.forEach((_, groupIndex) => candidates.add(groupIndex));
      }
    }

    candidates.forEach((groupIndex) => {
      if (cashMovementMatchesContractReferences(movement, references[groupIndex])) {
        groups[groupIndex].movements.push(movement);
      }
    });
  });

  groups.forEach((group) => group.movements
    .sort((left, right) => new Date(left?.createdAt ?? 0) - new Date(right?.createdAt ?? 0)));
  return groups;
};
