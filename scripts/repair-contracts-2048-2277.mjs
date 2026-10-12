import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repairId = 'repair-2048-2277-original-payments-v1';
const active = row => !row.deletedAt && !row.voidedAt && !['anulado','eliminado'].includes(row.receiptStatus);
const requireMatch = (condition, message) => { if (!condition) throw new Error('Sin cambios: ' + message); };
export function repairOriginalPayments(state, now = new Date().toISOString()) {
  const results = [];
  for (const code of ['2048','2277']) {
    const contract = state.contracts.find(row => row.contractCode === code && !row.deletedAt);
    requireMatch(contract, 'contrato ' + code + ' no encontrado');
    if (contract.revisionHistory?.some(row => row.id === repairId)) { results.push({ contractCode: code, status: 'already_applied' }); continue; }
    const specs = code === '2048' ? [['RC-5865',104,104,0]] : [['RC-12492',1280,1080,200],['RC-12493',192,192,0]];
    const generated = code === '2048' ? [['RC-5882',104,'initial_rental_payment']] : [['RC-12746',1272,'initial_rental_payment'],['RC-12747',200,'validated_guarantee']];
    requireMatch(contract.totals.totalBs === (code === '2048' ? 104 : 1272), 'cambio el total de ' + code);
    const restored = specs.map(([receipt,amount,commercial,guarantee]) => {
      const entry = contract.economicLedger.find(row => !row.deletedAt && row.cashReceiptCode === receipt && row.type === 'deposit');
      const movement = state.cashMovements.find(row => row.id === entry?.cashMovementId);
      requireMatch(entry && movement && movement.receiptCode === receipt && movement.amountBs === amount && !movement.deletedAt, 'cambio el recibo original ' + receipt);
      return { entry,movement,amount,commercial,guarantee };
    });
    const duplicates = generated.map(([receipt,amount,tag]) => {
      const movement = state.cashMovements.find(row => row.receiptCode === receipt && row.linkedContractId === contract.id);
      requireMatch(movement && active(movement) && movement.amountBs === amount && movement.accountingTag === tag, 'cambio el recibo automatico ' + receipt);
      return movement;
    });
    const reason = 'Reparacion verificada: se conservan los pagos originales del cuaderno y se anulan los recibos automaticos que los sustituyeron sin registrar dinero nuevo.';
    for (const {entry,movement,amount,commercial,guarantee} of restored) {
      movement.repairPreviousVoid = { voidedAt: movement.voidedAt, voidReason: movement.voidReason, receiptStatus: movement.receiptStatus };
      Object.assign(movement,{ voidedAt: null, voidReason:'', voidedBy:'', receiptStatus:'', amountBs:amount, receivedAmountBs:amount, contractAllocationBs:commercial, guaranteeAllocationBs:guarantee, surplusAllocationBs:0, accountingTag:'contract_deposit_receipt', updatedAt:now,
        receiptDetail:`Total recibido: Bs ${amount.toFixed(2)}\nAplicado al contrato: Bs ${commercial.toFixed(2)}\nApartado como garantia: Bs ${guarantee.toFixed(2)}` });
      Object.assign(entry,{ amountBs:amount, contractAllocationBs:commercial, guaranteeAllocationBs:guarantee, surplusAllocationBs:0, isCashRegistered:true, editedAt:now, editedByName:'Reparacion de datos' });
    }
    for (const movement of duplicates) Object.assign(movement,{ voidedAt:now, receiptStatus:'anulado', voidReason:reason, voidedBy:'Reparacion de datos', updatedAt:now });
    contract.revisionHistory ??= [];
    contract.revisionHistory.push({id:repairId,updatedAt:now,updatedByName:'Reparacion de datos',changes:[reason]});
    state.systemAuditLog ??= [];
    state.systemAuditLog.push({id:repairId+'-'+code,action:'repair',module:'Contratos',entityId:contract.id,entityCode:code,detail:reason,createdAt:now});
    results.push({contractCode:code,status:'repaired',restoredReceipts:restored.map(row=>row.movement.receiptCode),voidedReceipts:duplicates.map(row=>row.receiptCode),contractPaidBs:restored.reduce((sum,row)=>sum+row.commercial,0),guaranteeBs:restored.reduce((sum,row)=>sum+row.guarantee,0)});
  }
  return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);const apply=args.includes('--apply'), inputIndex=args.indexOf('--input');
  requireMatch(!(apply && inputIndex>=0),'--input solo admite simulacion');
  let store,snapshot;
  if(inputIndex>=0){const raw=JSON.parse(await fs.readFile(args[inputIndex+1],'utf8'));snapshot={state:raw.state??raw};}
  else {store=await import('../server/storage/fileStateStore.js');snapshot=await store.getStateSnapshot();}
  const results=repairOriginalPayments(structuredClone(snapshot.state));
  if(!apply || results.every(row=>row.status==='already_applied')) console.log(JSON.stringify({mode:'dry-run',results},null,2));
  else { const backupPath=path.resolve('backups',`before-${repairId}-${Date.now()}.json`);await fs.mkdir(path.dirname(backupPath),{recursive:true});await fs.copyFile(store.getStateStoreInfo().stateFilePath,backupPath,fs.constants.COPYFILE_EXCL);
    const saved=await store.updateStateSnapshot(state=>{repairOriginalPayments(state);return state;},snapshot.revision);requireMatch(saved.ok,'no se pudo guardar');console.log(JSON.stringify({mode:'applied',results,backupPath,revision:saved.revision},null,2)); }
}
