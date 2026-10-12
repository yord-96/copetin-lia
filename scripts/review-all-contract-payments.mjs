import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cashMovementMatchesContractReferences } from '../src/utils/contractCashLinks.js';
import { reconcileContractDocumentPayments } from '../src/utils/contractDocumentPayments.js';
const repairId='repair-all-verified-original-payments-v1';
const money=value=>Math.round(Number(value||0)*100)/100;
const active=row=>!row.deletedAt&&!row.voidedAt&&!['anulado','eliminado'].includes(row.receiptStatus);

export function reviewAllContractPayments(state) {
 const byId=new Map((state.cashMovements??[]).map(row=>[row.id,row]));
 const plans=[],review=[];let scanned=0;
 for(const c of state.contracts??[]) {
  if(c.deletedAt)continue;scanned++;
  const ledger=(c.economicLedger??[]).filter(row=>!row.deletedAt);
  const deposits=ledger.filter(row=>row.type==='deposit');
  const issues=deposits.filter(entry=>{const m=byId.get(entry.cashMovementId);return (m&&(!active(m)||(money(entry.amountBs)===0&&money(m.amountBs)>0)))||((entry.cashMovementId||entry.cashReceiptCode)&&!m);});
  if(!issues.length)continue;
  const references={contractId:c.id,rentalId:c.rentalId,contractCode:c.contractCode,orderCode:c.orderCode};
  const cash=(state.cashMovements??[]).filter(row=>cashMovementMatchesContractReferences(row,references));
  const generated=cash.filter(row=>active(row)&&['initial_rental_payment','validated_guarantee'].includes(row.accountingTag));
  const originals=issues.map(entry=>({entry,movement:byId.get(entry.cashMovementId)})).filter(row=>row.movement&&!active(row.movement)&&!row.movement.deletedAt&&money(row.movement.amountBs)>0);
  const reasons=[];
  if(issues.some(entry=>!byId.has(entry.cashMovementId)))reasons.push('Falta el recibo referenciado en el respaldo');
  if(originals.some(row=>!cash.some(m=>m.id===row.movement.id)))reasons.push('El recibo original pertenece a otro contrato');
  if(originals.some(row=>(state.contracts??[]).some(other=>other.id!==c.id&&!other.deletedAt&&(other.economicLedger??[]).some(e=>!e.deletedAt&&e.cashMovementId===row.movement.id))))reasons.push('El recibo original esta referenciado por otro contrato');
  if(!originals.length)reasons.push('No hay pagos originales anulados recuperables');
  if(!generated.length)reasons.push('No hay recibos automaticos vigentes equivalentes');
  if(new Set(originals.map(row=>row.movement.id)).size!==originals.length)reasons.push('Varias lineas apuntan al mismo recibo');
  if(originals.some(({movement})=>!String(movement.voidReason).includes('cobro duplicado del contrato '+c.contractCode)))reasons.push('La anulacion no documenta duplicacion del contrato');
  let service=0,guarantee=0;
  for(const row of originals){row.guarantee=money(Math.max(money(row.entry.guaranteeAllocationBs),ledger.filter(e=>e.type==='guarantee'&&e.sourceDepositId===row.entry.id).reduce((sum,e)=>sum+money(e.amountBs),0)));row.commercial=money(row.movement.amountBs-row.guarantee);service=money(service+row.commercial);guarantee=money(guarantee+row.guarantee);
   if(row.commercial<0||money(row.entry.damageAllocationBs)>0||money(row.entry.surplusAllocationBs)>0)reasons.push('El reparto tiene danos o excedentes que requieren revision');
  }
  const generatedService=money(generated.filter(m=>m.accountingTag==='initial_rental_payment').reduce((sum,m)=>sum+money(m.amountBs),0));
  const generatedGuarantee=money(generated.filter(m=>m.accountingTag==='validated_guarantee').reduce((sum,m)=>sum+money(m.amountBs),0));
  if(service!==generatedService||guarantee!==generatedGuarantee)reasons.push('Los originales y automaticos no coinciden en contrato y garantia');
  if(!reasons.length){
    const originalById=new Map(originals.map(row=>[row.movement.id,row]));const generatedIds=new Set(generated.map(row=>row.id));
    const simulatedCash=(state.cashMovements??[]).map(m=>{const row=originalById.get(m.id);return row?{...m,voidedAt:null,receiptStatus:'',accountingTag:'contract_deposit_receipt',contractAllocationBs:row.commercial,guaranteeAllocationBs:row.guarantee}:generatedIds.has(m.id)?{...m,voidedAt:'simulation',receiptStatus:'anulado'}:m;});
    const simulatedContract={...c,economicLedger:ledger.map(e=>{const row=originals.find(row=>row.entry.id===e.id);return row?{...e,amountBs:row.movement.amountBs,contractAllocationBs:row.commercial,guaranteeAllocationBs:row.guarantee,isCashRegistered:true}:e;})};
    const before=reconcileContractDocumentPayments(c,{id:c.rentalId,orderCode:c.orderCode},state.cashMovements).appliedBs;
    const after=reconcileContractDocumentPayments(simulatedContract,{id:c.rentalId,orderCode:c.orderCode},simulatedCash).appliedBs;
    if(Math.abs(before-after)>.01)reasons.push('La simulacion cambia el saldo confirmado; requiere revision individual');
  }
  const summary={contractId:c.id,contractCode:c.contractCode,totalBs:c.totals?.totalBs,originalContractBs:service,originalGuaranteeBs:guarantee,automaticContractBs:generatedService,automaticGuaranteeBs:generatedGuarantee,originalReceipts:originals.map(row=>row.movement.receiptCode),automaticReceipts:generated.map(row=>row.receiptCode),zeroEntries:issues.filter(e=>money(e.amountBs)===0).map(e=>e.id)};
  if(reasons.length)review.push({...summary,reasons:[...new Set(reasons)]});
  else plans.push({...summary,originals:originals.map(row=>({entryId:row.entry.id,movementId:row.movement.id,amountBs:money(row.movement.amountBs),commercialBs:row.commercial,guaranteeBs:row.guarantee})),generatedIds:generated.map(row=>row.id)});
 }
 return {scanned,repairable:plans.length,requiresReview:review.length,plans,review};
}

export function repairAllVerifiedContractPayments(state,now=new Date().toISOString()) {
 const result=reviewAllContractPayments(state);
 for(const plan of result.plans){const c=state.contracts.find(row=>row.id===plan.contractId);const before=reconcileContractDocumentPayments(c,{id:c.rentalId,orderCode:c.orderCode},state.cashMovements).appliedBs;
  const reason='Reparacion verificada: se recuperan los recibos originales anulados por duplicacion; los automaticos equivalentes se anulan. Coinciden los montos de contrato y garantia; no hubo dinero nuevo.';
  for(const row of plan.originals){const entry=c.economicLedger.find(e=>e.id===row.entryId),m=state.cashMovements.find(m=>m.id===row.movementId);m.repairPreviousVoid={voidedAt:m.voidedAt,voidReason:m.voidReason,receiptStatus:m.receiptStatus};Object.assign(m,{voidedAt:null,voidReason:'',voidedBy:'',receiptStatus:'',amountBs:row.amountBs,receivedAmountBs:row.amountBs,contractAllocationBs:row.commercialBs,guaranteeAllocationBs:row.guaranteeBs,surplusAllocationBs:0,accountingTag:'contract_deposit_receipt',updatedAt:now,receiptDetail:`Total recibido: Bs ${row.amountBs.toFixed(2)}\nAplicado al contrato: Bs ${row.commercialBs.toFixed(2)}\nApartado como garantia: Bs ${row.guaranteeBs.toFixed(2)}`});Object.assign(entry,{amountBs:row.amountBs,contractAllocationBs:row.commercialBs,guaranteeAllocationBs:row.guaranteeBs,surplusAllocationBs:0,isCashRegistered:true,editedAt:now,editedByName:'Reparacion de datos'});}
  for(const id of plan.generatedIds){const m=state.cashMovements.find(row=>row.id===id);Object.assign(m,{voidedAt:now,receiptStatus:'anulado',voidedBy:'Reparacion de datos',voidReason:reason,updatedAt:now});}
  const after=reconcileContractDocumentPayments(c,{id:c.rentalId,orderCode:c.orderCode},state.cashMovements).appliedBs;
  if(Math.abs(before-after)>.01)throw new Error('Sin guardar: cambio el saldo confirmado del contrato '+c.contractCode);
  c.revisionHistory??=[];c.revisionHistory.push({id:repairId,updatedAt:now,updatedByName:'Reparacion de datos',changes:[reason]});
  state.systemAuditLog??=[];state.systemAuditLog.push({id:repairId+'-'+c.id,action:'repair',module:'Contratos',entityId:c.id,entityCode:c.contractCode,detail:reason,createdAt:now});
 }
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2),apply=args.includes('--apply'),input=args.indexOf('--input'),output=args.indexOf('--report');
 if(apply&&input>=0)throw new Error('--input solo permite simulacion');
 let store,snapshot;
 if(input>=0){const raw=JSON.parse(await fs.readFile(args[input+1],'utf8'));snapshot={state:raw.state??raw};}else{store=await import('../server/storage/fileStateStore.js');snapshot=await store.getStateSnapshot();}
 const report=repairAllVerifiedContractPayments(structuredClone(snapshot.state));
 const reportPath=path.resolve(output>=0?args[output+1]:`reports/revision-pagos-contratos-${Date.now()}.json`);await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2));
 let backupPath,revision;
 if(apply&&report.repairable){backupPath=path.resolve('backups',`before-${repairId}-${Date.now()}.json`);await fs.mkdir(path.dirname(backupPath),{recursive:true});await fs.copyFile(store.getStateStoreInfo().stateFilePath,backupPath,fs.constants.COPYFILE_EXCL);const saved=await store.updateStateSnapshot(state=>{repairAllVerifiedContractPayments(state);return state;},snapshot.revision);if(!saved.ok)throw new Error('No se pudo guardar');revision=saved.revision;}
 console.log(JSON.stringify({mode:apply?'applied':'dry-run',scanned:report.scanned,repairable:report.repairable,requiresReview:report.requiresReview,reportPath,backupPath,revision},null,2));
}
