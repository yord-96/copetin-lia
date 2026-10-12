// A historical rental may retain a summary marker after its contract was
// recovered. Recover document lines from the complete linked contract only;
// never change the persisted rental or bypass a genuinely incomplete record.
export function recoverInventoryDocumentRental(rental, contract) {
  if (!rental?._summaryOnly) return rental;
  if (!contract || contract._summaryOnly || contract.deletedAt
    || String(contract.rentalId ?? '') !== String(rental.id ?? '')
    || String(rental.contractId ?? '') !== String(contract.id ?? '')
    || !Array.isArray(contract.items) || !contract.items.length
    || !contract.items.every(line => line.itemId && Number.isFinite(Number(line.quantity))
      && Number(line.quantity) > 0 && String(line.itemName ?? line.name ?? '').trim())) return rental;
  return {
    ...rental,
    _summaryOnly: false,
    items: contract.items.map(line => ({ ...line, name: line.itemName ?? line.name })),
    services: Array.isArray(contract.services) ? contract.services : rental.services,
  };
}
