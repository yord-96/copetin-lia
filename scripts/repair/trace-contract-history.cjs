const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const projectRoot = path.resolve(__dirname, '..', '..');
const downloadsDir = path.join(process.env.USERPROFILE || 'C:\\Users\\Milton', 'Downloads');
const repairsDir = path.join(projectRoot, 'data', 'repairs');
const args = process.argv.slice(2);
const codesArg = args.find((arg) => arg.startsWith('--codes='))?.split('=')[1] ?? '';
const extraSourceFiles = args
  .filter((arg) => !arg.startsWith('--codes='))
  .map((entry) => path.resolve(entry));

const codes = new Set(codesArg
  .split(',')
  .map((code) => code.trim())
  .filter(Boolean));
const codeAliases = new Set([...codes].flatMap((code) => [
  code,
  String(Number(code)),
]).filter((code) => code && code !== 'NaN'));

if (!codes.size) {
  console.error('Uso: node scripts/repair/trace-contract-history.cjs --codes=300,0272,1833,1400');
  process.exit(1);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const getState = (payload) => payload?.state || payload;
const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
const totalBs = (record) => Number(record?.totals?.totalBs ?? record?.totalBs ?? 0);
const lineTotal = (line) => Number(line?.lineTotalBs ?? line?.grossLineTotalBs ?? 0);
const lineUnit = (line) => Number(line?.unitPriceBs ?? line?.rentalPriceBs ?? 0);
const countMoneyLines = (record) =>
  (Array.isArray(record?.items) ? record.items : []).filter((line) => Math.max(lineUnit(line), lineTotal(line), 0) > 0).length;
const itemSubtotal = (record) =>
  roundMoney((Array.isArray(record?.items) ? record.items : []).reduce((sum, line) => sum + lineTotal(line), 0));
const supplierRows = (record) => (Array.isArray(record?.supplierFulfillmentPlan) ? record.supplierFulfillmentPlan.length : 0);
const recordDate = (record) =>
  String(record?.eventDate ?? record?.deliveryDate ?? record?.pickupDate ?? record?.contractDate ?? record?.createdAt ?? '').slice(0, 10);
const fileStamp = (name) =>
  name.match(/(\d{4}-\d{2}-\d{2}[T-]\d{2}[-:]\d{2}[-:]\d{2})/)?.[1] ?? '';

const listBackupFiles = () => {
  const candidates = [];
  const seen = new Set();
  const addFile = (file) => {
    const resolved = path.resolve(file);
    if (seen.has(resolved) || !fs.existsSync(resolved)) return;
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size < 1000 || stat.size > 100 * 1024 * 1024) return;
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
      if (/money-restore-report-/i.test(entry.name)) return;
      if (!/\.json$/i.test(entry.name) && !/^\.app-state\.json\..*\.tmp$/i.test(entry.name)) return;
      addFile(file);
    });
  };
  extraSourceFiles.forEach(addFile);
  addFromDir(downloadsDir);
  addFromDir(path.join(projectRoot, 'data'));
  addFromDir(repairsDir);
  addFromDir(process.env.BACKUP_DIR || '');
  addFromDir('/var/www/prestamos-app/backups');
  return candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
};

const rows = [];
for (const { file, mtimeMs } of listBackupFiles()) {
  let payload;
  try {
    payload = readJson(file);
  } catch {
    continue;
  }
  const state = getState(payload);
  if (!Array.isArray(state?.contracts) || state.contracts.some((row) => !Array.isArray(row?.items) && !row?.totals)) {
    continue;
  }
  state.contracts
    .filter((contract) => codeAliases.has(String(contract?.contractCode ?? '')))
    .forEach((contract) => {
      const items = Array.isArray(contract.items) ? contract.items : [];
      rows.push({
        code: String(contract.contractCode ?? ''),
        file: path.basename(file),
        stamp: fileStamp(path.basename(file)),
        mtime: new Date(mtimeMs).toISOString(),
        id: contract.id ?? '',
        date: recordDate(contract),
        client: contract.clientName ?? contract.client?.name ?? '',
        total: roundMoney(totalBs(contract)),
        expected: roundMoney(contract?.totals?.baseSubtotalBs ?? contract?.pricingPlan?.chargeableSubtotalBs ?? 0),
        itemSubtotal: itemSubtotal(contract),
        items: items.length,
        moneyLines: countMoneyLines(contract),
        supplierRows: supplierRows(contract),
        pricingMode: contract.pricingPlan?.mode ?? '',
        updatedAt: contract.updatedAt ?? '',
      });
    });
}

const grouped = [...codes].map((code) => {
  const history = rows.filter((row) => row.code === code);
  const best = [...history].sort((a, b) =>
    b.moneyLines - a.moneyLines
    || b.supplierRows - a.supplierRows
    || b.total - a.total
    || String(b.updatedAt).localeCompare(String(a.updatedAt))
  )[0] ?? null;
  return { code, count: history.length, best };
});

console.log(JSON.stringify({
  ok: true,
  requestedCodes: [...codes],
  filesScanned: listBackupFiles().length,
  foundRows: rows.length,
  summary: grouped,
}, null, 2));

console.table(rows.map((row) => ({
  code: row.code,
  file: row.file,
  total: row.total,
  subtotal: row.itemSubtotal,
  items: row.items,
  money: row.moneyLines,
  suppliers: row.supplierRows,
  updatedAt: row.updatedAt,
})));
