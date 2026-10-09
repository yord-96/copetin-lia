import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { syncEconomicLedgerCashDate } from '../src/utils/economicLedgerCashDates.js';
const repairId = 'repair-contract-2430-cash-dates-v1';
const requireMatch = (value, message) => { if (!value) throw new Error(`Sin cambios: ${message}`); };
export function repairContract2430(state, now = new Date().toISOString()) {
  const c = state.contracts?.find(c => c.id === '703612f0-454a-45d6-abf7-d4f710432c4c' && c.contractCode === '2430' && !c.deletedAt);
  requireMatch(c, 'contrato ausente');
  if (c.revisionHistory?.some(r => r.id === repairId)) return {status:'already_applied',contractCode:'2430'};
  const e = c.economicLedger?.find(e => !e.deletedAt && e.type === 'deposit' && e.cashReceiptCode === 'RC-12637');
  const original = state.cashMovements?.find(m => m.id === e?.cashMovementId && m.receiptCode === 'RC-12637');
  const rental = state.cashMovements?.find(m => m.id === '53a0c179-4913-4573-a7cf-c1d1670e6673' && m.receiptCode === 'RC-12787');
  const guarantee = state.cashMovements?.find(m => m.id === '53fc7251-acc5-4891-9bbe-6b453593089f' && m.receiptCode === 'RC-12788');
  requireMatch(e?.amountBs === 100 && e.createdAt === '2026-09-05T12:37:58.000Z' && e.contractAllocationBs === 50 && e.guaranteeAllocationBs === 50, 'deposito cambiado');
  requireMatch(original?.voidReason === 'Anulado por cobro duplicado del contrato 2430' && original.amountBs === 100 && original.receiptStatus === 'anulado', 'recibo original cambiado');
  for (const m of [rental, guarantee]) requireMatch(m && !m.voidedAt && !m.deletedAt && !['anulado','eliminado'].includes(m.receiptStatus)
    && m.amountBs === 50 && m.linkedContractId === c.id && m.createdAt === '2026-09-07T12:37:17.891Z', 'recibos sustitutos cambiados');
  requireMatch(rental.accountingTag === 'initial_rental_payment' && guarantee.accountingTag === 'validated_guarantee', 'origen de recibos cambiado');
  for (const m of [rental,guarantee]) m.replacementOfMovementId = original.id;
  syncEconomicLedgerCashDate(state,c,e,{now,userName:'Reparacion de datos'});
  const reason = 'Fechas conciliadas con deposito real del 5 de septiembre; RC-12787 y RC-12788 sustituyen RC-12637 anulado. Sin cambios de importes ni devoluciones.';
  c.revisionHistory ??= [];c.revisionHistory.push({id:repairId,updatedAt:now,updatedByName:'Reparacion de datos',changes:[reason]});
  state.systemAuditLog ??= [];state.systemAuditLog.push({id:repairId,action:'repair',module:'Contratos',entityId:c.id,entityCode:c.contractCode,detail:reason,createdAt:now,userName:'Reparacion de datos'});
  return {status:'repaired',contractCode:'2430',receipts:['RC-12787','RC-12788'],date:'2026-09-05',totalBs:100};
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
  const result = repairContract2430(structuredClone(snapshot.state));
  if (!apply || result.status === 'already_applied') console.log(JSON.stringify({ mode: 'dry-run', ...result }, null, 2));
  else {
    const backupPath = path.resolve('backups', `before-${repairId}-${Date.now()}.json`);
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.copyFile(store.getStateStoreInfo().stateFilePath, backupPath, fs.constants.COPYFILE_EXCL);
    const saved = await store.updateStateSnapshot(state => { repairContract2430(state); return state; }, snapshot.revision);
    requireMatch(saved.ok, 'no se pudo guardar');
    console.log(JSON.stringify({ mode: 'applied', ...result, backupPath, revision: saved.revision }, null, 2));
  }
}
