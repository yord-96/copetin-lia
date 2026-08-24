import fs from 'node:fs';
import {
  findLegacyReturnedGuaranteeRefunds,
  repairLegacyReturnedGuaranteeRefunds,
} from '../server/migrations/repairLegacyGuaranteeRefunds.js';

const [filePath, from = '2026-06-29', to = '2026-07-05'] = process.argv.slice(2);
if (!filePath) throw new Error('Uso: node scripts/audit-guarantee-backup.mjs <respaldo.json> [desde] [hasta]');

const backup = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const root = backup.state && typeof backup.state === 'object'
  ? backup.state
  : (backup.data && typeof backup.data === 'object' ? backup.data : backup);

console.log(JSON.stringify({
  rootKeys: Object.keys(root),
  collections: Object.fromEntries(Object.entries(root).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.length : (value && typeof value === 'object' ? Object.keys(value).length : typeof value),
  ])),
  range: { from, to },
}, null, 2));

const text = (value) => String(value ?? '').trim();
const lower = (value) => text(value).toLowerCase();
const money = (value) => Math.max(0, Number(Number(value ?? 0).toFixed(2)) || 0);
const getDateKey = (value) => text(value).slice(0, 10);
const rentals = Array.isArray(root.rentals) ? root.rentals : [];
const movements = Array.isArray(root.cashMovements) ? root.cashMovements : [];
const rentalByContractId = new Map(rentals.filter((row) => row?.contractId).map((row) => [text(row.contractId), row]));
const rentalByCode = new Map(rentals.filter((row) => row?.contractCode).map((row) => [text(row.contractCode), row]));
const movementById = new Map(movements.map((row) => [text(row?.id), row]));

const isActiveMovement = (movement) => movement
  && !movement.deletedAt
  && !movement.voidedAt
  && lower(movement.receiptStatus) !== 'anulado';

const isRefundMovement = (movement) => {
  if (!isActiveMovement(movement)) return false;
  const values = [movement.accountingTag, movement.category, movement.type].map(lower);
  return values.includes('guarantee_refund')
    || values.some((value) => value.includes('garantia_devuelta'))
    || (values.some((value) => value.includes('egreso')) && lower(movement.description).includes('garantia'));
};

const movementMatches = (movement, contract, rental) => {
  const linkedContractId = text(movement.linkedContractId);
  const linkedRentalId = text(movement.linkedRentalId);
  const sourceId = text(movement.sourceId);
  if (linkedContractId) return linkedContractId === text(contract.id);
  if (linkedRentalId) return linkedRentalId === text(rental?.id);
  if (sourceId) return sourceId === text(contract.id) || sourceId === text(rental?.id);
  return Boolean(text(rental?.orderCode) && text(movement.linkedOrderCode) === text(rental.orderCode));
};

const contractsInRange = (Array.isArray(root.contracts) ? root.contracts : [])
  .filter((contract) => !contract?.deletedAt)
  .filter((contract) => {
    const date = getDateKey(contract.eventDate);
    return date >= from && date <= to;
  })
  .filter((contract) => money(contract?.guarantee?.amountBs ?? contract?.totals?.guaranteeBs) > 0);

const auditRows = contractsInRange.map((contract) => {
  const rental = rentalByContractId.get(text(contract.id)) ?? rentalByCode.get(text(contract.contractCode));
  const ledger = (Array.isArray(contract.economicLedger) ? contract.economicLedger : []).filter((entry) => entry && !entry.deletedAt);
  const guaranteeBs = money(contract?.guarantee?.amountBs ?? contract?.totals?.guaranteeBs);
  const refunds = ledger.filter((entry) => entry.type === 'refund' && entry.refundSource !== 'surplus');
  const refundBs = money(refunds.reduce((sum, entry) => sum + money(entry.amountBs), 0));
  const confirmedRefunds = refunds.filter((entry) => {
    const exact = movementById.get(text(entry.cashMovementId));
    if (isActiveMovement(exact)) return true;
    return movements.some((movement) => isRefundMovement(movement)
      && movementMatches(movement, contract, rental)
      && Math.abs(Math.abs(Number(movement.amountBs ?? 0)) - money(entry.amountBs)) <= 0.009);
  });
  const orphanRefunds = refunds.filter((entry) => !confirmedRefunds.includes(entry));
  const guaranteeEntries = ledger.filter((entry) => entry.type === 'guarantee');
  return {
    contract: text(contract.contractCode),
    eventDate: getDateKey(contract.eventDate),
    customer: text(contract.customerName),
    finalized: Boolean(contract.isFinalized),
    rentalStatus: lower(rental?.status) || 'sin alquiler',
    guaranteeStatus: lower(contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus),
    guaranteeBs,
    guaranteeLedgerBs: money(guaranteeEntries.reduce((sum, entry) => sum + money(entry.amountBs), 0)),
    refundLedgerBs: refundBs,
    confirmedRefundBs: money(confirmedRefunds.reduce((sum, entry) => sum + money(entry.amountBs), 0)),
    orphanRefundBs: money(orphanRefunds.reduce((sum, entry) => sum + money(entry.amountBs), 0)),
    orphanRefundCount: orphanRefunds.length,
    orphanEntries: orphanRefunds.map((entry) => ({
      id: entry.id,
      amountBs: money(entry.amountBs),
      createdAt: entry.createdAt,
      createdByName: entry.createdByName,
      note: entry.note,
      cashMovementId: entry.cashMovementId,
      cashReceiptCode: entry.cashReceiptCode,
      isCashRegistered: entry.isCashRegistered,
    })),
  };
});

console.log('\nAUDITORIA GARANTIAS DEL RANGO');
console.table(auditRows.map(({ orphanEntries, ...row }) => row));
const totals = {
  contractsWithGuarantee: auditRows.length,
  guaranteeBs: money(auditRows.reduce((sum, row) => sum + row.guaranteeBs, 0)),
  withRefundInLedger: auditRows.filter((row) => row.refundLedgerBs > 0).length,
  withConfirmedRefund: auditRows.filter((row) => row.confirmedRefundBs > 0).length,
  withOrphanRefund: auditRows.filter((row) => row.orphanRefundBs > 0).length,
  orphanRefundBs: money(auditRows.reduce((sum, row) => sum + row.orphanRefundBs, 0)),
  stillHeldWithoutRefund: auditRows.filter((row) => row.refundLedgerBs <= 0).length,
};
console.log('\nRESUMEN');
console.log(JSON.stringify(totals, null, 2));
console.log('\nDEVOLUCIONES EN HOJA FLEXIBLE SIN RECIBO');
console.log(JSON.stringify(auditRows.filter((row) => row.orphanRefundCount > 0), null, 2));

const allRepairCandidates = findLegacyReturnedGuaranteeRefunds(root);
const receiptOwners = new Map(movements
  .filter((movement) => text(movement?.receiptCode))
  .map((movement) => [text(movement.receiptCode).toUpperCase(), movement]));
const candidatesWithReceiptCollision = allRepairCandidates.filter(({ entry }) => (
  text(entry.cashReceiptCode)
  && receiptOwners.has(text(entry.cashReceiptCode).toUpperCase())
));
console.log('\nALCANCE DE LA REPARACION GENERAL EN TODO EL RESPALDO');
console.log(JSON.stringify({
  candidates: allRepairCandidates.length,
  totalBs: money(allRepairCandidates.reduce((sum, row) => sum + row.amountBs, 0)),
  candidatesInSelectedRange: allRepairCandidates.filter(({ contract }) => {
    const date = getDateKey(contract.eventDate);
    return date >= from && date <= to;
  }).length,
  receiptCodeCollisions: candidatesWithReceiptCollision.length,
  contracts: allRepairCandidates.map(({ contract }) => text(contract.contractCode || contract.id)),
}, null, 2));

const simulatedState = structuredClone(root);
const firstSimulation = repairLegacyReturnedGuaranteeRefunds(simulatedState);
const secondSimulation = repairLegacyReturnedGuaranteeRefunds(simulatedState);
console.log('\nSIMULACION SIN MODIFICAR EL RESPALDO');
console.log(JSON.stringify({
  repairedOnFirstRun: firstSimulation.repaired.length,
  totalBs: money(firstSimulation.repaired.reduce((sum, row) => sum + row.amountBs, 0)),
  repairedOnSecondRun: secondSimulation.repaired.length,
  remainingCandidates: findLegacyReturnedGuaranteeRefunds(simulatedState).length,
}, null, 2));
