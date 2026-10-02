const normalizeReference = (value) => String(value ?? '').trim().toLocaleLowerCase('es-BO');

const isCancelledStatus = (value) => [
  'cancelled',
  'canceled',
  'anulado',
  'eliminado',
].includes(normalizeReference(value));

export const getCommercialContractCode = (value) => {
  const code = String(value ?? '').trim();
  if (!code || /^OS(?:[-_\s]|$)/i.test(code)) return '';
  return code;
};

/**
 * Detecta alquileres historicos que sobrevivieron a la eliminacion de su
 * contrato. No elimina ni transforma el registro: solo evita presentarlo como
 * una deuda vigente e independiente.
 */
export const isRentalExcludedFromReceivables = (
  rental,
  deletedContracts = [],
  activeContracts = [],
) => {
  if (!rental || rental?.deletedAt || isCancelledStatus(rental?.status)) return true;
  if (rental?.receivablesExcludedAt || rental?.receivablesExclusionReason === 'deleted_contract') return true;

  const rentalId = normalizeReference(rental?.id ?? rental?.rentalId);
  const contractId = normalizeReference(rental?.contractId);
  const orderCode = normalizeReference(rental?.orderCode);

  const activeRows = Array.isArray(activeContracts) ? activeContracts : [];
  const deletedRows = Array.isArray(deletedContracts) ? deletedContracts : [];
  const hasActiveStructuredOwner = activeRows.some((contract) => {
    if (!contract || contract?.deletedAt) return false;
    return (rentalId && normalizeReference(contract?.rentalId) === rentalId)
      || (contractId && normalizeReference(contract?.id) === contractId);
  });
  if (hasActiveStructuredOwner) return false;

  const hasDeletedStructuredOwner = deletedRows.some((contract) => {
    if (!contract || !contract?.deletedAt) return false;
    if (rentalId && normalizeReference(contract?.rentalId) === rentalId) return true;
    return contractId && normalizeReference(contract?.id) === contractId;
  });
  if (hasDeletedStructuredOwner) return true;

  // Compatibilidad con eliminaciones antiguas que desprendian ambos IDs del
  // alquiler pero conservaban el codigo de orden en los dos registros. Este
  // fallback solo se usa cuando no existe ningun vinculo estructurado.
  if (contractId || normalizeReference(rental?.contractCode) || !orderCode) return false;
  const activeOrderExists = activeRows.some((contract) => (
    !contract?.deletedAt && normalizeReference(contract?.orderCode) === orderCode
  ));
  if (activeOrderExists) return false;
  return deletedRows.some((contract) => (
    contract?.deletedAt && normalizeReference(contract?.orderCode) === orderCode
  ));
};

export const getRentalReceivableEventDate = (rental, contract = null) => (
  rental?.eventDate
  ?? contract?.eventDate
  ?? rental?.rentalDate
  ?? contract?.deliveryDate
  ?? rental?.deliveryDate
  ?? rental?.createdAt
  ?? null
);

// Preparar las referencias una sola vez evita recorrer todos los contratos
// por cada alquiler al abrir Contabilidad.
export const createRentalReceivableExclusionMatcher = (deletedContracts = [], activeContracts = []) => {
  const index = (rows, deleted) => {
    const result = { rentals: new Set(), contracts: new Set(), orders: new Set() };
    for (const row of rows) {
      if (!row || Boolean(row.deletedAt) !== deleted) continue;
      for (const [key, value] of [['rentals', row.rentalId], ['contracts', row.id], ['orders', row.orderCode]]) {
        const reference = normalizeReference(value);
        if (reference) result[key].add(reference);
      }
    }
    return result;
  };
  const active = index(activeContracts, false);
  const deleted = index(deletedContracts, true);
  return rental => {
    if (!rental || rental.deletedAt || isCancelledStatus(rental.status)) return true;
    if (rental.receivablesExcludedAt || rental.receivablesExclusionReason === 'deleted_contract') return true;
    const rentalId = normalizeReference(rental.id ?? rental.rentalId);
    const contractId = normalizeReference(rental.contractId);
    if (active.rentals.has(rentalId) || active.contracts.has(contractId)) return false;
    if (deleted.rentals.has(rentalId) || deleted.contracts.has(contractId)) return true;
    const orderCode = normalizeReference(rental.orderCode);
    if (contractId || normalizeReference(rental.contractCode) || !orderCode) return false;
    return !active.orders.has(orderCode) && deleted.orders.has(orderCode);
  };
};
