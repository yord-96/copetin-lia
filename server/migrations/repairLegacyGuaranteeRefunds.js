import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStateSnapshot, updateStateSnapshot } from '../storage/fileStateStore.js';

const MIGRATION_ID = 'repair-finalized-guarantee-refunds-v1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupDirectory = path.resolve(__dirname, '../../data/backups');

const money = (value) => Math.max(0, Number(Number(value ?? 0).toFixed(2)) || 0);
const text = (value) => String(value ?? '').trim();
const lower = (value) => text(value).toLowerCase();

const isActiveMovement = (movement) => (
  movement
  && !movement.deletedAt
  && !movement.voidedAt
  && lower(movement.receiptStatus) !== 'anulado'
);

const isGuaranteeRefundMovement = (movement) => {
  if (!isActiveMovement(movement)) return false;
  const tag = lower(movement.accountingTag);
  const category = lower(movement.category);
  const type = lower(movement.type);
  return tag === 'guarantee_refund'
    || category.includes('garantia_devuelta')
    || (type.includes('egreso') && `${category} ${movement.description ?? ''}`.toLowerCase().includes('garantia'));
};

const movementMatchesContract = (movement, contract, rental) => {
  const contractId = text(contract?.id);
  const rentalId = text(rental?.id ?? contract?.rentalId);
  const orderCode = text(contract?.orderCode ?? rental?.orderCode);
  const linkedContractId = text(movement?.linkedContractId);
  const linkedRentalId = text(movement?.linkedRentalId);
  const sourceId = text(movement?.sourceId);
  if (linkedContractId) return linkedContractId === contractId;
  if (linkedRentalId) return linkedRentalId === rentalId;
  if (sourceId) return sourceId === contractId || sourceId === rentalId;
  return Boolean(orderCode && text(movement?.linkedOrderCode) === orderCode);
};

const nextReceiptCode = (movements) => {
  const max = movements.reduce((current, movement) => {
    const match = text(movement?.receiptCode).match(/^RC-(\d+)$/i);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `RC-${String(max > 0 ? max + 1 : movements.length + 1).padStart(4, '0')}`;
};

const movementIdForEntry = (entryId) => (
  `mov-legacy-refund-${crypto.createHash('sha1').update(text(entryId)).digest('hex').slice(0, 20)}`
);

export const findLegacyFinalizedGuaranteeRefunds = (state = {}) => {
  const contracts = Array.isArray(state.contracts) ? state.contracts : [];
  const rentals = Array.isArray(state.rentals) ? state.rentals : [];
  const movements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
  const rentalById = new Map(rentals.map((rental) => [text(rental?.id), rental]));
  const movementById = new Map(movements.map((movement) => [text(movement?.id), movement]));
  const candidates = [];

  contracts.forEach((contract) => {
    if (!contract?.isFinalized || contract?.deletedAt) return;
    const rental = rentalById.get(text(contract.rentalId));
    if (!rental || rental.deletedAt || lower(rental.status) !== 'returned') return;

    (Array.isArray(contract.economicLedger) ? contract.economicLedger : []).forEach((entry) => {
      if (!entry || entry.deletedAt || entry.type !== 'refund' || entry.refundSource === 'surplus') return;
      const amountBs = money(entry.amountBs);
      if (amountBs <= 0) return;
      const linkedMovement = movementById.get(text(entry.cashMovementId));
      if (linkedMovement && isActiveMovement(linkedMovement)) return;

      const matchingMovement = movements.find((movement) => (
        isGuaranteeRefundMovement(movement)
        && movementMatchesContract(movement, contract, rental)
        && Math.abs(Math.abs(Number(movement.amountBs ?? 0)) - amountBs) <= 0.009
      ));
      if (matchingMovement) return;
      if (text(entry.cashReceiptCode)) return;

      candidates.push({ contract, rental, entry, amountBs });
    });
  });

  return candidates;
};

export const repairLegacyFinalizedGuaranteeRefunds = (state = {}) => {
  state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
  state.systemAuditLog = Array.isArray(state.systemAuditLog) ? state.systemAuditLog : [];
  state.resetLogs = Array.isArray(state.resetLogs) ? state.resetLogs : [];
  const candidates = findLegacyFinalizedGuaranteeRefunds(state);
  const repaired = [];

  candidates.forEach(({ contract, rental, entry, amountBs }) => {
    const receiptCode = nextReceiptCode(state.cashMovements);
    const movementId = movementIdForEntry(entry.id);
    const createdAt = text(entry.createdAt) || text(contract.finalizedAt) || new Date().toISOString();
    const createdBy = text(entry.createdByName) || text(contract.finalizedByName) || 'Sistema';
    const customerName = text(contract.customerName ?? rental.customerName) || 'Cliente';
    const paymentMethod = ['efectivo', 'qr', 'transferencia'].includes(lower(entry.paymentMethod))
      ? lower(entry.paymentMethod)
      : 'efectivo';
    const paymentAccount = paymentMethod === 'qr' ? text(entry.paymentAccount).toUpperCase() : '';
    const receiptDetail = [
      `DEVOLUCION DE GARANTIA DEL CONTRATO ${contract.contractCode || contract.id}`,
      `Cliente: ${customerName}`,
      `Monto devuelto: Bs ${amountBs.toFixed(2)}`,
      'Recibo reconstruido desde una devolucion historica confirmada en el cuaderno economico.',
    ].join('\n');
    const movement = {
      id: movementId,
      sessionId: null,
      type: 'egreso_manual',
      amountBs: -amountBs,
      description: `DEVOLUCION GARANTIA: ${customerName}`,
      sourceType: 'contract',
      sourceId: contract.id,
      createdBy,
      createdByName: createdBy,
      userName: createdBy,
      cashBoxType: 'BIG_CASH',
      category: 'garantia_devuelta_legacy',
      paymentMethod,
      paymentAccount,
      responsible: createdBy,
      receipt: '',
      receiptCode,
      notes: text(entry.note) || `Devolucion historica de garantia del contrato ${contract.contractCode || contract.id}`,
      isInternalTransfer: false,
      transferGroupId: null,
      receiptStatus: '',
      voidedAt: null,
      voidedBy: '',
      voidReason: '',
      replacedByMovementId: null,
      replacementOfMovementId: null,
      linkedRentalId: rental.id,
      linkedContractId: contract.id,
      linkedOrderCode: contract.orderCode ?? rental.orderCode ?? null,
      accountingTag: 'guarantee_refund',
      collectionTarget: '',
      collectionTargets: [],
      collectionBreakdown: [],
      receiptDetail,
      receiptCustomerName: customerName,
      receivedAmountBs: amountBs,
      contractAllocationBs: 0,
      guaranteeAllocationBs: 0,
      surplusAllocationBs: 0,
      transportRevenueBs: 0,
      damageCollectedBs: 0,
      transportExpenseBs: 0,
      createdAt,
      receiptIssuedAt: createdAt,
      updatedAt: createdAt,
      legacyRepairId: MIGRATION_ID,
      legacyEconomicLedgerEntryId: entry.id,
    };

    state.cashMovements.push(movement);
    entry.cashMovementId = movementId;
    entry.cashReceiptCode = receiptCode;
    entry.cashRegisteredAt = createdAt;
    entry.isCashRegistered = true;
    entry.refundSource = 'guarantee';
    contract.economicLedgerUpdatedAt = contract.economicLedgerUpdatedAt ?? createdAt;
    repaired.push({
      contractId: contract.id,
      contractCode: contract.contractCode ?? '',
      rentalId: rental.id,
      entryId: entry.id,
      movementId,
      receiptCode,
      amountBs,
    });
  });

  if (repaired.length > 0) {
    const repairedAt = new Date().toISOString();
    const totalBs = money(repaired.reduce((sum, row) => sum + row.amountBs, 0));
    state.systemAuditLog.unshift({
      id: `audit-${MIGRATION_ID}-${Date.now()}`,
      type: 'legacy_guarantee_refunds_repaired',
      action: 'regularizar_devoluciones_garantia_historicas',
      entityType: 'accounting',
      entityId: MIGRATION_ID,
      detail: `${repaired.length} devolucion(es) de garantia finalizadas fueron vinculadas a Caja Grande por Bs ${totalBs.toFixed(2)}.`,
      userName: 'Migracion del sistema',
      userRole: 'Sistema',
      createdAt: repairedAt,
    });
    state.resetLogs.unshift({
      id: `${MIGRATION_ID}-${Date.now()}`,
      action: MIGRATION_ID,
      result: 'success',
      repairedCount: repaired.length,
      repairedTotalBs: totalBs,
      createdAt: repairedAt,
    });
  }

  return { state, repaired };
};

export const runLegacyGuaranteeRefundRepair = async () => {
  const snapshot = await getStateSnapshot();
  if (!snapshot.initialized || !snapshot.state) return { repaired: [], backupPath: null };
  const candidates = findLegacyFinalizedGuaranteeRefunds(snapshot.state);
  if (candidates.length === 0) return { repaired: [], backupPath: null };

  await fs.mkdir(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDirectory, `before-${MIGRATION_ID}-${stamp}.json`);
  await fs.writeFile(backupPath, JSON.stringify({
    state: snapshot.state,
    version: snapshot.version,
    updatedAt: snapshot.updatedAt,
    revision: snapshot.revision,
  }, null, 2), 'utf8');

  let repaired = [];
  await updateStateSnapshot((state) => {
    const result = repairLegacyFinalizedGuaranteeRefunds(state);
    repaired = result.repaired;
    return result.state;
  });
  console.info('[migration] Devoluciones historicas de garantia regularizadas.', {
    repairedCount: repaired.length,
    repairedTotalBs: money(repaired.reduce((sum, row) => sum + row.amountBs, 0)),
    backupPath,
  });
  return { repaired, backupPath };
};
