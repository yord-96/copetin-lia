import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cashMovementMatchesContractReferences } from '../src/utils/contractCashLinks.js';

const repairId = 'repair-contract-2863-duplicate-initial-v1';
const active = row => !row.deletedAt && !row.voidedAt && !['anulado', 'eliminado'].includes(String(row.receiptStatus ?? '').toLowerCase());
const requireMatch = (value, message) => { if (!value) throw new Error(`Sin cambios: ${message}`); };

export function repairContract2863(state, now = new Date().toISOString()) {
  const c = state.contracts?.find(row => row.id === 'ad541fe2-a135-4b2c-9263-08d231188bca');
  requireMatch(c && !c.deletedAt && c.contractCode === '2863', 'contrato no encontrado o cambiado');
  if (c.revisionHistory?.some(row => row.id === repairId)) return { status: 'already_applied', contractCode: '2863' };
  const linked = (state.cashMovements ?? []).filter(row => active(row) && cashMovementMatchesContractReferences(row,
    { contractId: c.id, rentalId: c.rentalId, contractCode: c.contractCode, orderCode: c.orderCode }));
  requireMatch(linked.length === 2, 'los recibos vigentes cambiaron; revisar un respaldo nuevo');
  const original = linked.find(row => row.id === 'mov-f0548080-ded4-4cf0-9038-71486d4dbe4a' && row.receiptCode === 'RC-13498');
  const duplicate = linked.find(row => row.id === 'cf9435d0-6f22-40df-9b7b-293f50c63b73' && row.receiptCode === 'RC-13519');
  requireMatch(original?.amountBs === 235 && original.accountingTag === 'contract_deposit_receipt'
    && original.paymentMethod === 'qr' && original.paymentAccount === 'MERCANTIL'
    && original.receiptIssuedAt === '2026-10-01T04:27:40.000Z', 'cambio el pago original del 1 de octubre');
  requireMatch(duplicate?.amountBs === 235 && duplicate.accountingTag === 'initial_rental_payment'
    && duplicate.paymentMethod === 'efectivo' && duplicate.notes === 'Pago inicial registrado desde contrato 2863'
    && duplicate.createdAt === '2026-10-02T14:26:58.372Z', 'cambio el recibo automatico del 2 de octubre');
  const deposits = (c.economicLedger ?? []).filter(row => !row.deletedAt && row.type === 'deposit');
  requireMatch(deposits.length === 1 && deposits[0].cashMovementId === original.id && deposits[0].amountBs === 235
    && !c.economicLedger.some(row => !row.deletedAt && (row.cashMovementId === duplicate.id || row.cashReceiptCode === duplicate.receiptCode)),
    'el historial de depositos cambio');
  const history = c.revisionHistory?.find(row => row.updatedAt === duplicate.createdAt);
  requireMatch(history?.changes?.some(text => text.includes('15 -> 16'))
    && history.changes.some(text => text.includes('10 -> 11')), 'no coincide la edicion que genero el duplicado');
  // No payment summaries are rewritten: the valid deposit is already counted once.
  const reason = 'Reparacion verificada: RC-13519 duplico el abono RC-13498 al editar cantidades de items; no hubo ingreso nuevo. Se conserva el pago QR Mercantil del 1 de octubre.';
  Object.assign(duplicate, { receiptStatus: 'anulado', voidedAt: now, voidedBy: 'Reparacion de datos', voidReason: reason, updatedAt: now });
  c.revisionHistory ??= [];
  c.revisionHistory.push({ id: repairId, updatedAt: now, updatedByName: 'Reparacion de datos', changes: [reason] });
  state.systemAuditLog ??= [];
  state.systemAuditLog.push({ id: repairId, action: 'repair', module: 'Contratos', entityType: 'contract',
    entityId: c.id, entityCode: c.contractCode, title: 'Reparacion de recibo duplicado contrato 2863',
    detail: reason, userName: 'Reparacion de datos', createdAt: now });
  return { status: 'repaired', contractCode: '2863', preservedReceipt: original.receiptCode,
    voidedReceipt: duplicate.receiptCode, removedDuplicateBs: 235, preservedDate: '2026-10-01' };
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
  const result = repairContract2863(structuredClone(snapshot.state));
  if (!apply || result.status === 'already_applied') console.log(JSON.stringify({ mode: 'dry-run', ...result }, null, 2));
  else {
    const backupPath = path.resolve('backups', `before-${repairId}-${Date.now()}.json`);
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.copyFile(store.getStateStoreInfo().stateFilePath, backupPath, fs.constants.COPYFILE_EXCL);
    const saved = await store.updateStateSnapshot(state => { repairContract2863(state); return state; }, snapshot.revision);
    requireMatch(saved.ok, 'no se pudo guardar');
    console.log(JSON.stringify({ mode: 'applied', ...result, backupPath, revision: saved.revision }, null, 2));
  }
}
