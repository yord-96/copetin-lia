import fs from 'node:fs/promises';
import path from 'node:path';
import { syncContractCashCollection } from '../../src/utils/contractCashCollection.js';
import { cashMovementMatchesContractReferences } from '../../src/utils/contractCashLinks.js';
import { getStateSnapshot, getStateStoreInfo, updateStateSnapshot } from '../storage/fileStateStore.js';

const REPAIR_ID = 'included-service-taxi-3027-v1';
const CONTRACT_ID = '837c76ae-318c-4bad-9830-a2e6f00dfb28';
const MOVEMENT_ID = 'mov-f1cc3989-7853-495f-8340-bf2ec4d1a605';
const SERVICE_ID = 'service-1792261076855';
const ANNOTATION_ID = 'eco-1794500090446-7e5103813be37';

function targets(state) {
  const contract = (state.contracts ?? []).find(row => row.id === CONTRACT_ID && !row.deletedAt);
  const movement = (state.cashMovements ?? []).find(row => row.id === MOVEMENT_ID && !row.deletedAt && !row.voidedAt && !['anulado','eliminado'].includes(row.receiptStatus));
  if (!contract || !movement || movement.includedServiceRepairId === REPAIR_ID) return null;
  if (movement.linkedContractId !== CONTRACT_ID || Number(movement.amountBs) !== 35 || movement.receiptCode !== 'RC-510') return null;
  const service = (contract.services ?? []).find(row => row.id === SERVICE_ID && Number(row.lineTotalBs) === 35);
  if (!service || movement.accountingTag !== 'contract_extra_collection') return null;
  return { contract, movement };
}

// The user confirmed that RC-510 pays this existing service. Target only those
// verified IDs; matching an arbitrary extra by amount would misclassify income.
export function repairConfirmedTaxi3027(state, { now = new Date().toISOString(), backupFile = '' } = {}) {
  const target = targets(state);
  if (!target) return false;
  const { contract, movement } = target;
  const originalClassification = { accountingTag: movement.accountingTag, category: movement.category, collectionTarget: movement.collectionTarget,
    contractAllocationBs: movement.contractAllocationBs, collectionBreakdown: structuredClone(movement.collectionBreakdown ?? []) };
  syncContractCashCollection(state, contract, movement, { includedServiceId: SERVICE_ID, now });
  const annotation = (contract.economicLedger ?? []).find(row => row.id === ANNOTATION_ID && !row.deletedAt);
  if (annotation && (!annotation.cashMovementId && !annotation.cashReceiptCode && !annotation.isCashRegistered && Number(annotation.amountBs) === 35)) {
    Object.assign(annotation, { deletedAt: now, deletedByName: 'Correccion confirmada de servicio TAXI',
      deletionReason: 'Anotacion repetida del servicio TAXI ya cobrado con RC-510. Se conserva el ingreso original.', repairId: REPAIR_ID });
  }
  movement.includedServiceRepairId = REPAIR_ID;
  movement.classificationHistory = [...(movement.classificationHistory ?? []), { ...originalClassification, changedAt: now, reason: 'Usuario confirmo que TAXI paga el servicio de transporte ya incluido en 3027.', backupFile, repairId: REPAIR_ID }];
  state.systemAuditLog ??= [];
  state.systemAuditLog.push({ id: REPAIR_ID, action: 'repair_included_service_payment', entityId: CONTRACT_ID, createdAt: now,
    detail: 'RC-510: Bs 35 aplicados al servicio incluido; ingreso, importe y recibo conservados.', backupFile });
  return true;
}

export async function runConfirmedTaxi3027Repair() {
  const snapshot = await getStateSnapshot();
  const target = snapshot.state && targets(snapshot.state);
  if (!target) return;
  // Validate the exact change before scheduling a durable write.
  const preview = { contracts: [target.contract],
    rentals: (snapshot.state.rentals ?? []).filter(row => row.id === target.contract.rentalId),
    cashMovements: (snapshot.state.cashMovements ?? []).filter(row => cashMovementMatchesContractReferences(row, {
      contractId: target.contract.id, rentalId: target.contract.rentalId, contractCode: target.contract.contractCode, orderCode: target.contract.orderCode,
    })),
  };
  try { repairConfirmedTaxi3027(structuredClone(preview)); }
  catch (error) {
    console.warn('[migration] RC-510 requiere revision porque su saldo cambio desde la confirmacion.', { reason: error.message });
    return;
  }
  const directory = path.join(path.dirname(getStateStoreInfo().stateFilePath), 'backups');
  await fs.mkdir(directory, { recursive: true });
  const backupFile = path.join(directory, 'before-' + REPAIR_ID + '-' + Date.now() + '.json');
  await fs.writeFile(backupFile, JSON.stringify(snapshot), 'utf8');
  await updateStateSnapshot(state => { repairConfirmedTaxi3027(state, { backupFile }); return state; });
  console.info('[migration] RC-510 aplicado al servicio incluido del contrato 3027.', { backupFile });
}
