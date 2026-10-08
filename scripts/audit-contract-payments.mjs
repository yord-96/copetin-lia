import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cashMovementMatchesContractReferences } from '../src/utils/contractCashLinks.js';

const money = value => Math.round((Number(value) || 0) * 100) / 100;
const active = row => !row.deletedAt && !row.voidedAt
  && !['anulado', 'eliminado'].includes(String(row.receiptStatus ?? '').toLowerCase());

// Read-only findings: never infer that a receipt is invalid merely because of an overpayment.
export function auditContractPayments(state) {
  const findings = [];
  const cash = (state.cashMovements ?? []).filter(active);
  for (const contract of state.contracts ?? []) {
    if (contract.deletedAt) continue;
    const references = { contractId: contract.id, rentalId: contract.rentalId,
      contractCode: contract.contractCode, orderCode: contract.orderCode };
    const linked = cash.filter(row => cashMovementMatchesContractReferences(row, references));
    const deposits = (contract.economicLedger ?? []).filter(row => !row.deletedAt && row.type === 'deposit');
    const issues = [];
    for (const entry of deposits) {
      const receipt = linked.find(row => row.id === entry.cashMovementId
        || (entry.cashReceiptCode && row.receiptCode === entry.cashReceiptCode));
      if (receipt && Math.abs(money(entry.amountBs) - money(receipt.amountBs)) > .01) {
        issues.push({ kind: 'ledger_receipt_mismatch', certainty: 'confirmed_inconsistency',
          entryId: entry.id, receiptCode: receipt.receiptCode, ledgerAmountBs: money(entry.amountBs),
          receiptAmountBs: money(receipt.amountBs) });
      }
    }
    const automatic = linked.filter(row => row.accountingTag === 'initial_rental_payment'
      && /pago inicial (registrado|actualizado) desde contrato/i.test(row.notes ?? ''));
    for (const receipt of automatic) {
      const otherDeposits = deposits.filter(entry => entry.cashMovementId !== receipt.id
        && (!entry.cashReceiptCode || entry.cashReceiptCode !== receipt.receiptCode));
      const backing = [...new Map(otherDeposits.map(entry => {
        const movement = linked.find(row => row.id === entry.cashMovementId
          || (entry.cashReceiptCode && row.receiptCode === entry.cashReceiptCode));
        return movement ? [movement.id, movement] : [null, null];
      }).filter(([id]) => id)).values()];
      if (!backing.length) continue;
      const sumBs = money(backing.reduce((sum, row) => sum + money(row.amountBs), 0));
      const history = (contract.revisionHistory ?? []).find(row =>
        Math.abs(Date.parse(row.updatedAt) - Date.parse(receipt.createdAt)) < 1000);
      issues.push({ kind: 'automatic_payment_with_separate_deposits', certainty: 'requires_review',
        receiptCode: receipt.receiptCode, cashMovementId: receipt.id,
        amountBs: money(receipt.amountBs), separateReceipts: backing.map(row => row.receiptCode),
        separateReceivedBs: sumBs, equalsSeparateTotal: Math.abs(sumBs - money(receipt.amountBs)) < .01,
        createdDuringContractEdit: Boolean(history), changes: history?.changes ?? [] });
    }
    if (issues.length) findings.push({ contractId: contract.id, contractCode: contract.contractCode,
      customerName: contract.customerName, totalBs: money(contract.totals?.totalBs), issues });
  }
  return { generatedAt: new Date().toISOString(), contractsScanned: (state.contracts ?? []).filter(row => !row.deletedAt).length,
    contractsFlagged: findings.length,
    confirmedInconsistencyContracts: findings.filter(row => row.issues.some(issue => issue.certainty === 'confirmed_inconsistency')).length,
    automaticPaymentReviewContracts: findings.filter(row => row.issues.some(issue => issue.kind === 'automatic_payment_with_separate_deposits')).length,
    findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const input = process.argv[2];
  if (!input) throw new Error('Uso: node scripts/audit-contract-payments.mjs <respaldo.json> [prefijo-salida]');
  const data = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
  const report = auditContractPayments(data.state ?? data);
  const prefix = path.resolve(process.argv[3] ?? 'data/audit-contract-payments');
  if ([`${prefix}.json`, `${prefix}.csv`].includes(path.resolve(input))) throw new Error('La salida no puede reemplazar el respaldo.');
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  fs.writeFileSync(`${prefix}.json`, JSON.stringify(report, null, 2));
  const csv = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['Contrato', 'Cliente', 'Hallazgo', 'Clasificacion', 'Recibo', 'Importe historial', 'Importe caja', 'Otros recibos']];
  for (const finding of report.findings) for (const issue of finding.issues) rows.push([
    finding.contractCode, finding.customerName, issue.kind, issue.certainty, issue.receiptCode,
    issue.ledgerAmountBs, issue.receiptAmountBs ?? issue.amountBs, issue.separateReceipts?.join(' / '),
  ]);
  fs.writeFileSync(`${prefix}.csv`, '\uFEFF' + rows.map(row => row.map(csv).join(',')).join('\n'));
  console.log(JSON.stringify({ ...report, findings: undefined, json: `${prefix}.json`, csv: `${prefix}.csv` }, null, 2));
}
