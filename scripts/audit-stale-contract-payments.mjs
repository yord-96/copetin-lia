import fs from 'node:fs/promises';
import { cashMovementMatchesContractReferences } from '../src/utils/contractCashLinks.js';
export function auditStaleContractPayments(state) {
  const rows=[];
  for(const contract of state.contracts??[]) {
    if(contract.deletedAt)continue;
    const issues=[];
    for(const entry of contract.economicLedger??[]) {
      if(entry.deletedAt||entry.type!=='deposit')continue;
      const movement=(state.cashMovements??[]).find(row=>row.id===entry.cashMovementId||(entry.cashReceiptCode&&row.receiptCode===entry.cashReceiptCode));
      if(!movement)continue;
      const voided=movement.deletedAt||movement.voidedAt||['anulado','eliminado'].includes(movement.receiptStatus);
      if(voided || (Number(entry.amountBs)===0 && Number(movement.amountBs)>0))issues.push({entryId:entry.id,receiptCode:movement.receiptCode,ledgerBs:entry.amountBs,receiptBs:movement.amountBs,voided:Boolean(voided)});
    }
    if(!issues.length)continue;
    const references={contractId:contract.id,rentalId:contract.rentalId,contractCode:contract.contractCode,orderCode:contract.orderCode};
    rows.push({contractCode:contract.contractCode,totalBs:contract.totals?.totalBs,issues,activeReceipts:(state.cashMovements??[]).filter(row=>!row.deletedAt&&!row.voidedAt&&!['anulado','eliminado'].includes(row.receiptStatus)&&Number(row.amountBs)>0&&cashMovementMatchesContractReferences(row,references)).map(row=>({receiptCode:row.receiptCode,amountBs:row.amountBs,tag:row.accountingTag}))});
  }
  return rows;
}
const args=process.argv.slice(2),index=args.indexOf('--input');
if(index>=0){const raw=JSON.parse(await fs.readFile(args[index+1],'utf8'));console.log(JSON.stringify({mode:'read-only',contracts:auditStaleContractPayments(raw.state??raw)},null,2));}
