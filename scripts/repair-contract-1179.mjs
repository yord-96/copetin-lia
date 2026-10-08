import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cashMovementMatchesContractReferences } from '../src/utils/contractCashLinks.js';

const repairId = 'repair-contract-1179-duplicate-initial-v1';
const active = row => !row.deletedAt && !row.voidedAt && !['anulado', 'eliminado'].includes(row.receiptStatus);
const requireMatch = (value, message) => { if (!value) throw new Error(`Sin cambios: ${message}`); };

export function repairContract1179(state, now = new Date().toISOString()) {
  const c = state.contracts?.find(row => row.id === '35768b37-eb3f-45e4-b839-d03535a487e5');
  requireMatch(c && !c.deletedAt && c.contractCode === '1179', 'contrato no encontrado o cambiado');
  if (c.revisionHistory?.some(row => row.id === repairId)) return { status: 'already_applied', contractCode: '1179' };
  const linked = (state.cashMovements ?? []).filter(row => active(row) && cashMovementMatchesContractReferences(row,
    { contractId: c.id, rentalId: c.rentalId, contractCode: c.contractCode, orderCode: c.orderCode }));
  requireMatch(linked.length === 3, 'los recibos vigentes cambiaron; revisar el respaldo nuevo');
  const first = linked.find(row => row.receiptCode === 'RC-13559');
  const second = linked.find(row => row.receiptCode === 'RC-13560');
  const duplicate = linked.find(row => row.receiptCode === 'RC-13629');
  requireMatch(first?.amountBs === 5000 && second?.amountBs === 28078.5, 'cambiaron los pagos originales');
  requireMatch(duplicate?.amountBs === 33078.5 && duplicate.accountingTag === 'initial_rental_payment'
    && duplicate.notes === 'Pago inicial registrado desde contrato 1179'
    && duplicate.createdAt === '2026-10-07T19:49:42.331Z', 'cambio el cobro automatico');
  const deposits = c.economicLedger?.filter(row => !row.deletedAt && row.type === 'deposit') ?? [];
  const entry = deposits.find(row => row.cashMovementId === first.id);
  requireMatch(deposits.length === 2 && entry?.amountBs === 33078.5
    && deposits.some(row => row.cashMovementId === second.id && row.amountBs === 28078.5), 'cambio el historial de pagos');
  const ledger = c.economicLedger.filter(row => !row.deletedAt);
  requireMatch(ledger.length === 3 && ledger.some(row => row.type === 'guarantee' && row.amountBs === 3000
    && row.sourceDepositId === entry.id && row.reclassifiedFromPayment), 'cambiaron los movimientos de garantia');
  requireMatch(c.totals?.totalBs === 33341 && c.totals?.guaranteeBs === 3000
    && !Number(c.payment?.prepaidAppliedBs) && !Number(c.payment?.prepaidUsedBs), 'cambiaron total, garantia o prepago');
  const r = state.rentals?.find(row => row.id === c.rentalId);
  requireMatch(r && !r.deletedAt && !r.returnSettlement, 'orden ausente o con liquidacion de devolucion');
  const reason = 'Reparacion verificada: RC-13629 duplicaba RC-13559 + RC-13560 al editar contrato; no hubo ingreso nuevo.';
  duplicate.receiptStatus = 'anulado';
  duplicate.voidedAt = now;
  duplicate.voidedBy = 'Reparacion de datos';
  duplicate.voidReason = reason;
  duplicate.updatedAt = now;
  entry.amountBs = 5000;
  entry.contractAllocationBs = 2000;
  entry.guaranteeAllocationBs = 3000;
  entry.surplusAllocationBs = 0;
  entry.editedAt = now;
  entry.editedByName = 'Reparacion de datos';
  const appliedBs = 30078.5;
  const pendingBs = 3262.5;
  c.payment = { ...c.payment, paidAtApprovalBs: appliedBs, pendingBs, overpaidBs: 0 };
  for (const target of [r.payment ??= {}, r.totals ??= {}]) {
    Object.assign(target, { paidAtRentalBs: appliedBs, pendingPaymentBs: pendingBs, overpaidBs: 0,
      cashCollectedBs: appliedBs, rentalCollectedBs: Math.max(0, appliedBs - Number(target.deliveryFeeCollectedBs ?? 0)) });
  }
  r.payment.mode = 'a_cuenta';
  r.payment.status = 'a_cuenta';
  c.updatedAt = now;
  c.economicLedgerUpdatedAt = now;
  c.economicLedgerUpdatedByName = 'Reparacion de datos';
  r.updatedAt = now;
  c.revisionHistory ??= [];
  c.revisionHistory.push({ id: repairId, updatedAt: now, updatedByName: 'Reparacion de datos',
    changes: [reason, 'RC-13559: historial restaurado a Bs 5.000,00; garantia apartada Bs 3.000,00.',
      'Servicio pagado Bs 30.078,50; saldo pendiente Bs 3.262,50.'] });
  state.systemAuditLog ??= [];
  state.systemAuditLog.push({ id: repairId, action: 'repair', module: 'Contratos', entityType: 'contract',
    entityId: c.id, entityCode: c.contractCode, title: 'Reparacion de pago duplicado contrato 1179',
    detail: reason, userName: 'Reparacion de datos', createdAt: now });
  return { status: 'repaired', contractCode: '1179', voidedReceipt: 'RC-13629', restoredReceipt: 'RC-13559',
    receivedBs: 33078.5, guaranteeBs: 3000, appliedBs, pendingBs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  requireMatch(args.every((arg, i) => ['--apply', '--input'].includes(arg) || args[i - 1] === '--input'), 'argumento desconocido');
  const apply = args.includes('--apply');
  const inputIndex = args.indexOf('--input');
  requireMatch(!(apply && inputIndex >= 0), '--input solo admite simulacion');
  let snapshot, store;
  if (inputIndex >= 0) {
    const input = JSON.parse((await fs.readFile(args[inputIndex + 1], 'utf8')).replace(/^\uFEFF/, ''));
    snapshot = { state: input.state ?? input };
  } else {
    store = await import('../server/storage/fileStateStore.js');
    snapshot = await store.getStateSnapshot();
  }
  requireMatch(snapshot.state, 'base no inicializada');
  const result = repairContract1179(structuredClone(snapshot.state));
  if (!apply || result.status === 'already_applied') console.log(JSON.stringify({ mode: 'dry-run', ...result }, null, 2));
  else {
    const backupPath = path.resolve('backups', `before-${repairId}-${Date.now()}.json`);
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.copyFile(store.getStateStoreInfo().stateFilePath, backupPath, fs.constants.COPYFILE_EXCL);
    const saved = await store.updateStateSnapshot(state => { repairContract1179(state); return state; }, snapshot.revision);
    requireMatch(saved.ok, 'no se pudo guardar');
    console.log(JSON.stringify({ mode: 'applied', ...result, backupPath, revision: saved.revision }, null, 2));
  }
}
