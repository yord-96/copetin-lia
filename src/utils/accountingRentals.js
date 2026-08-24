const normalizeReference = (value) => String(value ?? '').trim().toLocaleLowerCase('es-BO');

const isCancelledStatus = (value) => [
  'cancelled',
  'canceled',
  'anulado',
  'eliminado',
].includes(normalizeReference(value));

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
