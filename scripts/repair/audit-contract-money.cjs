const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const projectRoot = path.resolve(__dirname, '..', '..');
const statePath = path.resolve(process.env.APP_STATE_FILE || path.join(projectRoot, 'data', 'app-state.json'));
const downloadsDir = path.join(process.env.USERPROFILE || 'C:\\Users\\Milton', 'Downloads');
const repairsDir = path.join(projectRoot, 'data', 'repairs');

const args = process.argv.slice(2);
const monthArg = args.find((arg) => arg.startsWith('--month='))?.split('=')[1] ?? null;
const codesArg = args.find((arg) => arg.startsWith('--codes='))?.split('=')[1] ?? null;
const jsonOnly = args.includes('--json');
const extraSourceFiles = args
  .filter((arg) => !arg.startsWith('--month=') && !arg.startsWith('--codes=') && arg !== '--json')
  .map((entry) => path.resolve(entry));

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const getState = (payload) => payload?.state || payload;
const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
const totalBs = (record) => Number(record?.totals?.totalBs ?? record?.totalBs ?? 0);
const lineTotal = (line) => Number(line?.lineTotalBs ?? line?.grossLineTotalBs ?? 0);
const lineUnit = (line) => Number(line?.unitPriceBs ?? line?.rentalPriceBs ?? 0);
const lineQty = (line) => Number(line?.quantity ?? 0);
const lineMoney = (line) => Math.max(lineUnit(line), lineTotal(line), 0);
const countMoneyLines = (record) =>
  (Array.isArray(record?.items) ? record.items : []).filter((line) => lineMoney(line) > 0).length;
const itemSubtotal = (record) =>
  roundMoney((Array.isArray(record?.items) ? record.items : []).reduce((sum, line) => sum + lineTotal(line), 0));
const hasPricingPlan = (record) =>
  Boolean(record?.pricingPlan && typeof record.pricingPlan === 'object' && Object.keys(record.pricingPlan).length > 0);
const supplierRows = (record) => (Array.isArray(record?.supplierFulfillmentPlan) ? record.supplierFulfillmentPlan.length : 0);
const recordDate = (record) =>
  String(record?.eventDate ?? record?.deliveryDate ?? record?.pickupDate ?? record?.contractDate ?? record?.createdAt ?? '').slice(0, 10);

const selectedCodes = new Set(String(codesArg ?? '')
  .split(',')
  .map((code) => code.trim())
  .filter(Boolean));

const listBackupFiles = () => {
  const candidates = [];
  const seen = new Set();
  const addFile = (file) => {
    const resolved = path.resolve(file);
    if (seen.has(resolved) || !fs.existsSync(resolved)) return;
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size < 1000 || stat.size > 80 * 1024 * 1024) return;
    seen.add(resolved);
    candidates.push({ file: resolved, mtimeMs: stat.mtimeMs });
  };
  const addFromDir = (dir) => {
    if (!dir || !fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        addFromDir(file);
        return;
      }
      if (!/copetin-base-datos-\d{4}-\d{2}-\d{2}T.*\.json$/i.test(entry.name)
        && !/^app-state-\d{4}-\d{2}-\d{2}[-T].*\.json$/i.test(entry.name)
        && !/^app-state-before-.*\.json$/i.test(entry.name)
        && !/^pre-restore-.*\.json$/i.test(entry.name)
        && !/^\.app-state\.json\..*\.tmp$/i.test(entry.name)) return;
      addFile(file);
    });
  };
  extraSourceFiles.forEach(addFile);
  addFromDir(downloadsDir);
  addFromDir(path.join(projectRoot, 'data'));
  addFromDir(repairsDir);
  addFromDir(process.env.BACKUP_DIR || '');
  addFromDir('/var/www/prestamos-app/backups');
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
};

const sourceByContractId = new Map();
for (const { file } of listBackupFiles()) {
  let payload;
  try {
    payload = readJson(file);
  } catch {
    continue;
  }
  const state = getState(payload);
  const sourceName = path.basename(file);
  (Array.isArray(state?.contracts) ? state.contracts : []).forEach((contract) => {
    const id = String(contract?.id ?? '').trim();
    if (!id) return;
    const current = sourceByContractId.get(id);
    const score = countMoneyLines(contract) + supplierRows(contract) + (hasPricingPlan(contract) ? 1 : 0);
    if (!current || score > current.score) {
      sourceByContractId.set(id, { record: contract, source: sourceName, score });
    }
  });
}

const currentPayload = readJson(statePath);
const currentState = getState(currentPayload);
const contracts = Array.isArray(currentState?.contracts) ? currentState.contracts : [];
const audited = contracts
  .filter((contract) => !contract?.deletedAt)
  .filter((contract) => !monthArg || recordDate(contract).startsWith(monthArg))
  .filter((contract) => selectedCodes.size === 0 || selectedCodes.has(String(contract?.contractCode ?? '')));

const rows = audited.map((contract) => {
  const items = Array.isArray(contract.items) ? contract.items : [];
  const positiveSubtotalWithZeroUnit = items.filter((line) => lineTotal(line) > 0 && lineQty(line) > 0 && lineUnit(line) <= 0).length;
  const positiveUnitWithZeroSubtotal = items.filter((line) => lineUnit(line) > 0 && lineQty(line) > 0 && lineTotal(line) <= 0).length;
  const total = roundMoney(totalBs(contract));
  const subtotal = itemSubtotal(contract);
  const source = sourceByContractId.get(String(contract?.id ?? '').trim());
  const sourceRecord = source?.record ?? null;
  const issues = [];

  if (contract._summaryOnly) issues.push('summaryOnly');
  if (total > 0 && items.length > 0 && countMoneyLines(contract) === 0) issues.push('allLineMoneyZero');
  if (positiveSubtotalWithZeroUnit > 0) issues.push('subtotalWithoutUnit');
  if (positiveUnitWithZeroSubtotal > 0) issues.push('unitWithoutSubtotal');
  if (total > 0 && subtotal > 0 && Math.abs(total - subtotal) > 0.01) issues.push('lineSubtotalDiffersFromTotal');
  if (sourceRecord && countMoneyLines(sourceRecord) > countMoneyLines(contract)) issues.push('backupHasMorePricedLines');
  if (sourceRecord && supplierRows(sourceRecord) > supplierRows(contract)) issues.push('backupHasSupplierPlan');
  if (sourceRecord && hasPricingPlan(sourceRecord) && !hasPricingPlan(contract)) issues.push('backupHasPricingPlan');

  return {
    contractCode: contract.contractCode ?? '',
    id: contract.id ?? '',
    eventDate: recordDate(contract),
    clientName: contract.clientName ?? contract.client?.name ?? '',
    totalBs: total,
    itemSubtotalBs: subtotal,
    items: items.length,
    moneyLines: countMoneyLines(contract),
    positiveSubtotalWithZeroUnit,
    positiveUnitWithZeroSubtotal,
    supplierPlanRows: supplierRows(contract),
    pricingMode: contract.pricingPlan?.mode ?? '',
    source: source?.source ?? '',
    issues,
  };
});

const suspicious = rows.filter((row) => row.issues.length > 0);
const report = {
  ok: true,
  statePath,
  month: monthArg,
  auditedContracts: audited.length,
  suspiciousContracts: suspicious.length,
  summary: suspicious.reduce((acc, row) => {
    row.issues.forEach((issue) => {
      acc[issue] = (acc[issue] ?? 0) + 1;
    });
    return acc;
  }, {}),
  suspicious,
};

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(JSON.stringify({
    ok: report.ok,
    statePath: report.statePath,
    month: report.month,
    auditedContracts: report.auditedContracts,
    suspiciousContracts: report.suspiciousContracts,
    summary: report.summary,
  }, null, 2));
  console.table(suspicious.slice(0, 80).map((row) => ({
    code: row.contractCode,
    date: row.eventDate,
    total: row.totalBs,
    subtotal: row.itemSubtotalBs,
    items: row.items,
    money: row.moneyLines,
    zeroUnit: row.positiveSubtotalWithZeroUnit,
    suppliers: row.supplierPlanRows,
    issues: row.issues.join(','),
    source: row.source,
  })));
}
