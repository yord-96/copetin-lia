import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const stateFilePath = path.resolve(process.argv.slice(2).find((argument) => !argument.startsWith('--')) ?? 'data/app-state.json');

const checksumForState = (state) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(state ?? null))
    .digest('hex')
    .slice(0, 16);

const isActiveRental = (rental) => rental && !rental.deletedAt && !['cancelled', 'anulado'].includes(String(rental.status ?? '').toLowerCase());

const duplicateActiveRentalCodes = (rentals) => {
  const byCode = new Map();
  rentals.filter(isActiveRental).forEach((rental) => {
    const code = String(rental.contractCode ?? '').trim();
    if (!code) return;
    const rows = byCode.get(code) ?? [];
    rows.push(rental);
    byCode.set(code, rows);
  });
  return Array.from(byCode.entries()).filter(([, rows]) => rows.length > 1);
};

const raw = await fs.readFile(stateFilePath, 'utf8');
const payload = JSON.parse(raw);
const state = payload.state ?? payload;

const contracts = Array.isArray(state.contracts) ? state.contracts : [];
const rentals = Array.isArray(state.rentals) ? state.rentals : [];
const contractById = new Map(contracts.map((contract) => [String(contract.id), contract]));
const activeContractById = new Map(
  contracts
    .filter((contract) => contract && !contract.deletedAt)
    .map((contract) => [String(contract.id), contract]),
);

const beforeDuplicates = duplicateActiveRentalCodes(rentals);
const changes = [];
const now = new Date().toISOString();

rentals.filter(isActiveRental).forEach((rental) => {
  const contractId = String(rental.contractId ?? '').trim();
  if (!contractId) return;

  const activeContract = activeContractById.get(contractId);
  if (activeContract) {
    const expectedCode = String(activeContract.contractCode ?? '').trim();
    const currentCode = String(rental.contractCode ?? '').trim();
    if (expectedCode && currentCode !== expectedCode) {
      changes.push({
        type: 'sync_rental_contract_code',
        rentalId: rental.id,
        orderCode: rental.orderCode,
        customerName: rental.customerName,
        from: currentCode,
        to: expectedCode,
        contractId,
      });
      rental.contractCode = expectedCode;
      rental.updatedAt = now;
    }
    return;
  }

  const deletedContract = contractById.get(contractId);
  const currentCode = String(rental.contractCode ?? '').trim();
  changes.push({
    type: deletedContract ? 'detach_deleted_contract' : 'detach_missing_contract',
    rentalId: rental.id,
    orderCode: rental.orderCode,
    customerName: rental.customerName,
    rentalStatus: rental.status,
    inventoryStatus: rental.operational?.inventoryStatus ?? null,
    oldContractId: contractId,
    oldContractCode: currentCode,
    contractDeletedAt: deletedContract?.deletedAt ?? null,
  });
  rental.legacyContractId = rental.legacyContractId ?? contractId;
  rental.legacyContractCode = rental.legacyContractCode ?? currentCode;
  rental.contractId = null;
  rental.contractCode = null;
  rental.updatedAt = now;
});

const afterDuplicates = duplicateActiveRentalCodes(rentals);

const result = {
  stateFilePath,
  dryRun,
  beforeDuplicateCodes: beforeDuplicates.map(([code, rows]) => ({
    code,
    rows: rows.map((rental) => ({
      rentalId: rental.id,
      orderCode: rental.orderCode,
      contractId: rental.contractId,
      customerName: rental.customerName,
      status: rental.status,
      inventoryStatus: rental.operational?.inventoryStatus ?? null,
    })),
  })),
  afterDuplicateCodes: afterDuplicates.map(([code, rows]) => ({
    code,
    rows: rows.map((rental) => ({
      rentalId: rental.id,
      orderCode: rental.orderCode,
      contractId: rental.contractId,
      customerName: rental.customerName,
      status: rental.status,
      inventoryStatus: rental.operational?.inventoryStatus ?? null,
    })),
  })),
  changes,
};

if (dryRun) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const backupDirectory = path.join(path.dirname(stateFilePath), 'repairs');
await fs.mkdir(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDirectory, `app-state-before-contract-code-repair-${stamp}.json`);
await fs.writeFile(backupPath, raw, 'utf8');

const nextPayload = payload.state
  ? {
    ...payload,
    state,
    version: Number(payload.version ?? 0) + 1,
    checksum: checksumForState(state),
    updatedAt: now,
  }
  : state;

await fs.writeFile(stateFilePath, JSON.stringify(nextPayload, null, 2), 'utf8');

console.log(JSON.stringify({ ...result, backupPath }, null, 2));
