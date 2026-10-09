import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repairId='consolidate-contract-2430-receipt-v1';
const requireMatch=(value,message)=>{if(!value)throw new Error(`Sin cambios: ${message}`);};
export function consolidateContract2430(state,now=new Date().toISOString()) {
 const c=state.contracts?.find(c=>c.id==='703612f0-454a-45d6-abf7-d4f710432c4c'&&c.contractCode==='2430'&&!c.deletedAt);
 requireMatch(c,'contrato ausente');
 if(c.revisionHistory?.some(r=>r.id===repairId))return {status:'already_applied',contractCode:'2430'};
 const e=c.economicLedger?.find(e=>e.type==='deposit'&&!e.deletedAt&&e.cashReceiptCode==='RC-12637');
 const original=state.cashMovements?.find(m=>m.id===e?.cashMovementId&&m.receiptCode==='RC-12637');
 const children=['RC-12787','RC-12788'].map(code=>state.cashMovements?.find(m=>m.receiptCode===code&&m.linkedContractId===c.id));
 requireMatch(e?.amountBs===100&&e.contractAllocationBs===50&&e.guaranteeAllocationBs===50,'deposito cambiado');
 requireMatch(original?.amountBs===100&&original.receiptStatus==='anulado'&&original.voidReason==='Anulado por cobro duplicado del contrato 2430','original cambiado');
 requireMatch(original.contractAllocationBs===50&&original.guaranteeAllocationBs===50,'desglose original cambiado');
 for(const m of children)requireMatch(m&&m.amountBs===50&&!m.deletedAt&&!m.voidedAt&&m.receiptStatus!=='anulado'&&m.replacementOfMovementId===original.id,'sustitutos cambiados');
 requireMatch(children[0].accountingTag==='initial_rental_payment'&&children[1].accountingTag==='validated_guarantee','origen cambiado');
 const reason='Consolidacion de una sola entrega: RC-12637 Bs 100 (contrato Bs 50 y garantia Bs 50) sustituye los recibos separados RC-12787 y RC-12788. Sin dinero nuevo.';
 original.receiptConsolidationHistory ??=[];
 original.receiptConsolidationHistory.push({at:now,previousStatus:original.receiptStatus,previousVoidedAt:original.voidedAt,previousVoidReason:original.voidReason,reason});
 Object.assign(original,{receiptStatus:'',voidedAt:null,voidedBy:'',voidReason:'',replacementOfMovementId:null,replacedByMovementId:null,
  createdAt:e.createdAt,receiptIssuedAt:e.createdAt,cashEffectiveDate:e.createdAt.slice(0,10),receiptEditedAt:now,updatedAt:now,
  accountingTag:'contract_deposit_receipt',receivedAmountBs:100,contractAllocationBs:50,guaranteeAllocationBs:50,
  receiptDetail:'Total recibido: Bs 100,00 | Aplicado al contrato: Bs 50,00 | Apartado como garantia: Bs 50,00',
  description:'ABONO RECIBIDO PARA CONTRATO 2430 | TOTAL RECIBIDO: Bs 100,00'});
 for(const m of children)Object.assign(m,{receiptStatus:'anulado',voidedAt:now,voidedBy:'Reparacion de datos',voidReason:reason,updatedAt:now,replacedByMovementId:original.id});
 c.revisionHistory ??=[];c.revisionHistory.push({id:repairId,updatedAt:now,updatedByName:'Reparacion de datos',changes:[reason]});
 state.systemAuditLog ??=[];state.systemAuditLog.push({id:repairId,action:'repair',module:'Contratos',entityId:c.id,entityCode:'2430',detail:reason,createdAt:now});
 return {status:'repaired',contractCode:'2430',receipt:'RC-12637',receivedBs:100,contractBs:50,guaranteeBs:50,voidedReceipts:children.map(m=>m.receiptCode)};
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
  const result = consolidateContract2430(structuredClone(snapshot.state));
  if (!apply || result.status === 'already_applied') console.log(JSON.stringify({ mode: 'dry-run', ...result }, null, 2));
  else {
    const backupPath = path.resolve('backups', `before-${repairId}-${Date.now()}.json`);
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.copyFile(store.getStateStoreInfo().stateFilePath, backupPath, fs.constants.COPYFILE_EXCL);
    const saved = await store.updateStateSnapshot(state => { consolidateContract2430(state); return state; }, snapshot.revision);
    requireMatch(saved.ok, 'no se pudo guardar');
    console.log(JSON.stringify({ mode: 'applied', ...result, backupPath, revision: saved.revision }, null, 2));
  }
}
