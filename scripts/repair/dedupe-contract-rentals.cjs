const fs = require('node:fs');
const path = require('node:path');

const databasePath = path.resolve(process.cwd(), '.copetin-shared-db.json');
const document = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
const state = document.state ?? document;

const contracts = Array.isArray(state.contracts) ? state.contracts : [];
const rentals = Array.isArray(state.rentals) ? state.rentals : [];
const duplicateIds = new Set();
const duplicateOrderCodes = new Set();

contracts.forEach((contract) => {
  if (contract.deletedAt || !contract.id || !contract.rentalId) return;
  rentals
    .filter((rental) => (
      !rental.deletedAt
      && String(rental.contractId ?? '') === String(contract.id)
      && String(rental.id) !== String(contract.rentalId)
    ))
    .forEach((rental) => {
      duplicateIds.add(String(rental.id));
      if (rental.orderCode) duplicateOrderCodes.add(String(rental.orderCode));
    });
});

if (duplicateIds.size === 0) {
  console.log('No se encontraron ordenes duplicadas por contrato.');
  process.exit(0);
}

const stockMovements = (state.inventoryMovements ?? []).filter((movement) => (
  duplicateOrderCodes.has(String(movement.reference ?? ''))
  && Number(movement.deltaUnits ?? 0) !== 0
));
if (stockMovements.length > 0) {
  throw new Error(
    `Reparacion detenida: ${stockMovements.length} movimientos de inventario requieren revision manual.`,
  );
}

const before = {
  rentals: rentals.length,
  deliveries: (state.deliveries ?? []).length,
  reports: (state.generatedReports ?? []).length,
  cashMovements: (state.cashMovements ?? []).length,
};

state.rentals = rentals.filter((rental) => !duplicateIds.has(String(rental.id)));
state.deliveries = (state.deliveries ?? []).filter((delivery) => (
  !duplicateIds.has(String(delivery.rentalId ?? ''))
  && !duplicateOrderCodes.has(String(delivery.orderCode ?? ''))
));
state.generatedReports = (state.generatedReports ?? []).filter(
  (report) => !duplicateIds.has(String(report.sourceId ?? '')),
);
state.cashMovements = (state.cashMovements ?? []).filter(
  (movement) => !duplicateIds.has(String(movement.sourceId ?? '')),
);
state.quotes = (state.quotes ?? []).map((quote) => {
  if (!duplicateIds.has(String(quote.rentalId ?? ''))) return quote;
  const contract = contracts.find((entry) => entry.id === quote.contractId);
  return contract?.rentalId
    ? { ...quote, rentalId: contract.rentalId, orderCode: contract.orderCode ?? quote.orderCode }
    : quote;
});

const serialized = `${JSON.stringify(document, null, 2)}\n`;
const temporaryPath = `${databasePath}.repairing`;
fs.writeFileSync(temporaryPath, serialized);
fs.renameSync(temporaryPath, databasePath);

console.log(JSON.stringify({
  removedRentalIds: [...duplicateIds],
  removedOrderCodes: [...duplicateOrderCodes],
  removed: {
    rentals: before.rentals - state.rentals.length,
    deliveries: before.deliveries - state.deliveries.length,
    reports: before.reports - state.generatedReports.length,
    cashMovements: before.cashMovements - state.cashMovements.length,
  },
}, null, 2));
