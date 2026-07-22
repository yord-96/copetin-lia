const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const projectRoot = path.resolve(__dirname, '..', '..');
const statePath = path.resolve(process.env.APP_STATE_FILE || path.join(projectRoot, 'data', 'app-state.json'));
const downloadsDir = path.join(process.env.USERPROFILE || 'C:\\Users\\Milton', 'Downloads');
const repairsDir = path.join(projectRoot, 'data', 'repairs');
const extraSourceFiles = process.argv.slice(2).map((entry) => path.resolve(entry));

const moneyKeys = [
  'unitPriceBs',
  'rentalPriceBs',
  'grossLineTotalBs',
  'lineTotalBs',
  'discountPercent',
  'discountBs',
  'lineType',
];

const supplierKeys = [
  'supplierFulfillmentPlan',
  'pricingPlan',
];

const checksumForState = (state) =>
  crypto.createHash('sha256').update(JSON.stringify(state ?? null)).digest('hex').slice(0, 16);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const getState = (payload) => payload?.state || payload;

const lineMoney = (line) => Math.max(
  Number(line?.unitPriceBs ?? 0),
  Number(line?.rentalPriceBs ?? 0),
  Number(line?.grossLineTotalBs ?? 0),
  Number(line?.lineTotalBs ?? 0),
  0,
);

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const deriveUnitPrice = (line) => {
  const quantity = Number(line?.quantity ?? 0);
  const lineTotal = Number(line?.lineTotalBs ?? line?.grossLineTotalBs ?? 0);
  if (quantity <= 0 || lineTotal <= 0) return 0;
  return roundMoney(lineTotal / quantity);
};

const normalizeLineMoneyFields = (line) => {
  const next = { ...line };
  let changed = false;
  const quantity = Number(next.quantity ?? 0);
  const existingUnitPrice = Number(next.unitPriceBs ?? next.rentalPriceBs ?? 0);
  const derivedUnitPrice = deriveUnitPrice(next);

  if (derivedUnitPrice > 0 && Number(next.unitPriceBs ?? 0) <= 0) {
    next.unitPriceBs = derivedUnitPrice;
    changed = true;
  }

  if (derivedUnitPrice > 0 && Number(next.rentalPriceBs ?? 0) <= 0) {
    next.rentalPriceBs = derivedUnitPrice;
    changed = true;
  }

  if (quantity > 0 && existingUnitPrice > 0 && Number(next.lineTotalBs ?? 0) <= 0) {
    next.lineTotalBs = roundMoney(quantity * existingUnitPrice);
    changed = true;
  }

  if (quantity > 0 && existingUnitPrice > 0 && Number(next.grossLineTotalBs ?? 0) <= 0) {
    next.grossLineTotalBs = roundMoney(quantity * existingUnitPrice);
    changed = true;
  }

  if (Number(next.lineTotalBs ?? 0) > 0 && Number(next.grossLineTotalBs ?? 0) <= 0) {
    next.grossLineTotalBs = roundMoney(next.lineTotalBs);
    changed = true;
  }

  return { line: next, changed };
};

const countMoneyLines = (record) =>
  (Array.isArray(record?.items) ? record.items : []).filter((line) => lineMoney(line) > 0).length;

const totalBs = (record) => Number(record?.totals?.totalBs ?? record?.totalBs ?? 0);

const itemSubtotalBs = (record) => Math.round(
  (Array.isArray(record?.items) ? record.items : [])
    .reduce((sum, line) => sum + Number(line?.lineTotalBs ?? line?.grossLineTotalBs ?? 0), 0) * 100,
) / 100;

const normalizeRecordTotals = (record) => {
  const subtotal = itemSubtotalBs(record);
  if (subtotal <= 0) return { record, changed: false };
  const totals = record?.totals && typeof record.totals === 'object' && !Array.isArray(record.totals)
    ? { ...record.totals }
    : {};
  let changed = false;

  ['baseSubtotalBs', 'subtotalBs', 'theoreticalSubtotalBs', 'totalBs'].forEach((key) => {
    if (Number(totals[key] ?? 0) > 0) return;
    totals[key] = subtotal;
    changed = true;
  });

  if (!changed) return { record, changed: false };
  return {
    record: {
      ...record,
      totals,
      totalBs: Number(record.totalBs ?? 0) > 0 ? record.totalBs : subtotal,
    },
    changed: true,
  };
};

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const lineKeyCandidates = (line, index) => [
  String(line?.lineKey ?? '').trim(),
  String(line?.comboLineKey ?? '').trim(),
  `${String(line?.itemId ?? '').trim()}|${normalizeText(line?.itemName ?? line?.name)}|${Math.trunc(Number(line?.quantity ?? 0))}|${index}`,
  `${String(line?.itemId ?? '').trim()}|${normalizeText(line?.itemName ?? line?.name)}|${Math.trunc(Number(line?.quantity ?? 0))}`,
  `${normalizeText(line?.itemName ?? line?.name)}|${Math.trunc(Number(line?.quantity ?? 0))}|${index}`,
].filter(Boolean);

const buildSourceLineMap = (lines) => {
  const map = new Map();
  (Array.isArray(lines) ? lines : []).forEach((line, index) => {
    lineKeyCandidates(line, index).forEach((key) => {
      if (!map.has(key)) map.set(key, line);
    });
  });
  return map;
};

const mergeLineMoney = (targetLine, sourceLine) => {
  if (!sourceLine || lineMoney(sourceLine) <= 0) return normalizeLineMoneyFields(targetLine);
  const next = { ...targetLine };
  let changed = false;
  moneyKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(sourceLine, key)) return;
    if (JSON.stringify(next[key] ?? null) === JSON.stringify(sourceLine[key] ?? null)) return;
    next[key] = sourceLine[key];
    changed = true;
  });
  const normalized = normalizeLineMoneyFields(next);
  return { line: normalized.line, changed: changed || normalized.changed };
};

const mergeRecordMoney = (target, source) => {
  if (!target || !source) return { record: target, changed: false, restoredLines: 0 };
  const targetLines = Array.isArray(target.items) ? target.items : [];
  const sourceLines = Array.isArray(source.items) ? source.items : [];
  if (!targetLines.length || !sourceLines.length) {
    return { record: target, changed: false, restoredLines: 0 };
  }

  const sourceLineMap = buildSourceLineMap(sourceLines);
  let restoredLines = 0;
  const nextItems = targetLines.map((line, index) => {
    const sourceLine = lineKeyCandidates(line, index)
      .map((key) => sourceLineMap.get(key))
      .find(Boolean);
    const result = mergeLineMoney(line, sourceLine);
    if (result.changed) restoredLines += 1;
    return result.line;
  });

  let next = restoredLines ? {
    ...target,
    items: nextItems,
    moneyRestoredAt: new Date().toISOString(),
    moneyRestoredFrom: source.__sourceFile || null,
  } : target;

  supplierKeys.forEach((key) => {
    if (target[key] === undefined || target[key] === null || (Array.isArray(target[key]) && target[key].length === 0)) {
      if (source[key] !== undefined && source[key] !== null) next[key] = source[key];
    }
  });

  if (target._summaryOnly && !source._summaryOnly) {
    Object.entries(source).forEach(([key, value]) => {
      if (key === 'items' || key === 'id') return;
      if (next[key] === undefined || next[key] === null || key === '_summaryOnly') next[key] = value;
    });
    delete next._summaryOnly;
  }

  const totalsResult = normalizeRecordTotals(next);
  next = totalsResult.record;

  if (!restoredLines && !totalsResult.changed) return { record: target, changed: false, restoredLines: 0 };

  return { record: next, changed: true, restoredLines };
};

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
    if (!fs.existsSync(dir)) return;
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

const currentPayload = readJson(statePath);
const currentState = getState(currentPayload);
const sourceByContractId = new Map();
const sourceByRentalId = new Map();

for (const { file } of listBackupFiles()) {
  let sourcePayload;
  try {
    sourcePayload = readJson(file);
  } catch {
    continue;
  }
  const sourceState = getState(sourcePayload);
  const sourceName = path.basename(file);
  (Array.isArray(sourceState.contracts) ? sourceState.contracts : []).forEach((contract) => {
    const id = String(contract?.id ?? '').trim();
    if (!id || countMoneyLines(contract) <= 0) return;
    if (!sourceByContractId.has(id)) sourceByContractId.set(id, { ...contract, __sourceFile: sourceName });
  });
  (Array.isArray(sourceState.rentals) ? sourceState.rentals : []).forEach((rental) => {
    const id = String(rental?.id ?? '').trim();
    if (!id || countMoneyLines(rental) <= 0) return;
    if (!sourceByRentalId.has(id)) sourceByRentalId.set(id, { ...rental, __sourceFile: sourceName });
  });
}

fs.mkdirSync(repairsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(repairsDir, `app-state-before-money-restore-${stamp}.json`);
fs.copyFileSync(statePath, backupPath);

const report = {
  backupPath,
  contracts: [],
  rentals: [],
};

currentState.contracts = (Array.isArray(currentState.contracts) ? currentState.contracts : []).map((contract) => {
  const source = sourceByContractId.get(String(contract?.id ?? '').trim());
  if (!source) return contract;
  if (Math.abs(totalBs(source) - totalBs(contract)) > 0.01) return contract;
  const result = mergeRecordMoney(contract, source);
  if (result.changed) {
    report.contracts.push({
      id: contract.id,
      contractCode: contract.contractCode,
      restoredLines: result.restoredLines,
      beforeMoneyLines: countMoneyLines(contract),
      afterMoneyLines: countMoneyLines(result.record),
      source: source.__sourceFile,
    });
  }
  return result.record;
});

currentState.rentals = (Array.isArray(currentState.rentals) ? currentState.rentals : []).map((rental) => {
  const source = sourceByRentalId.get(String(rental?.id ?? '').trim());
  if (!source) return rental;
  if (Math.abs(totalBs(source) - totalBs(rental)) > 0.01) return rental;
  const result = mergeRecordMoney(rental, source);
  if (result.changed) {
    report.rentals.push({
      id: rental.id,
      orderCode: rental.orderCode,
      contractCode: rental.contractCode,
      restoredLines: result.restoredLines,
      beforeMoneyLines: countMoneyLines(rental),
      afterMoneyLines: countMoneyLines(result.record),
      source: source.__sourceFile,
    });
  }
  return result.record;
});

const nextVersion = Number(currentPayload.version ?? 0) + 1;
const nextPayload = currentPayload.state
  ? {
      ...currentPayload,
      state: currentState,
      version: nextVersion,
      checksum: checksumForState(currentState),
      updatedAt: new Date().toISOString(),
    }
  : currentState;

fs.writeFileSync(statePath, `${JSON.stringify(nextPayload, null, 2)}\n`, 'utf8');
const reportPath = path.join(repairsDir, `money-restore-report-${stamp}.json`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  backupPath,
  reportPath,
  restoredContracts: report.contracts.length,
  restoredContractLines: report.contracts.reduce((sum, row) => sum + row.restoredLines, 0),
  restoredRentals: report.rentals.length,
  restoredRentalLines: report.rentals.reduce((sum, row) => sum + row.restoredLines, 0),
  examples: report.contracts
    .filter((row) => ['1779', '1228', '1448', '1291'].includes(String(row.contractCode)))
    .slice(0, 10),
}, null, 2));
