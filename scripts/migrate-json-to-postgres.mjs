import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import {
  DEFAULT_COMPANY_CODE,
  buildMigrationPlan,
  expectedCollectionCounts,
  loadJsonState,
  planCounts,
  readArgument,
  writeJsonReport,
  writeMarkdownReport,
} from './postgres-migration-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const mode = args.includes('--apply') ? 'apply' : args.includes('--verify') ? 'verify' : 'dry-run';
const resetTarget = args.includes('--reset-target');
const companyCode = readArgument(args, '--company') || process.env.ACTIVE_COMPANY_CODE || DEFAULT_COMPANY_CODE;
const stateFile = path.resolve(readArgument(args, '--state') || process.env.APP_STATE_FILE || path.join(projectRoot, 'data', 'app-state.json'));
const reportDir = path.resolve(readArgument(args, '--report-dir') || path.join(projectRoot, 'reports'));

const MODEL_ORDER = [
  'company',
  'permission',
  'role',
  'rolePermission',
  'user',
  'userCompany',
  'companySettings',
  'category',
  'client',
  'item',
  'inventoryCombo',
  'inventoryComboItem',
  'inventoryMovement',
  'stockRecovery',
  'supplier',
  'supplierQuote',
  'supplierQuoteItem',
  'contract',
  'contractItem',
  'quote',
  'quoteItem',
  'rental',
  'rentalItem',
  'delivery',
  'transportRoute',
  'transportRouteStop',
  'vehicle',
  'driver',
  'cashSession',
  'cashMovement',
  'cashDebt',
  'personnelEmployee',
  'attendanceRecord',
  'personnelAttendance',
  'personnelIncident',
  'calendarEvent',
  'calendarBoardNote',
  'generatedReport',
  'resetLog',
  'uploadedFile',
];

const DELETE_ORDER = [...MODEL_ORDER].reverse();

const uniqueById = (rows) => {
  const seen = new Map();
  rows.forEach((row) => {
    if (!row?.id) return;
    seen.set(row.id, row);
  });
  return [...seen.values()];
};

const uniqueComposite = (rows, fields) => {
  const seen = new Map();
  rows.forEach((row) => {
    const key = fields.map((field) => row[field]).join('|');
    seen.set(key, row);
  });
  return [...seen.values()];
};

const normalizeRows = (model, rows) => {
  if (model === 'rolePermission') return uniqueComposite(rows, ['roleId', 'permissionId']);
  if (model === 'userCompany') return uniqueComposite(rows, ['userId', 'companyId']);
  if (model === 'inventoryComboItem') return uniqueById(rows);
  return uniqueById(rows);
};

const upsertModelRows = async (tx, model, rows) => {
  const delegate = tx[model];
  if (!delegate) throw new Error(`Modelo Prisma no disponible: ${model}`);
  const normalized = normalizeRows(model, rows);
  for (const row of normalized) {
    if (model === 'rolePermission') {
      await delegate.upsert({
        where: { roleId_permissionId: { roleId: row.roleId, permissionId: row.permissionId } },
        update: {},
        create: row,
      });
    } else if (model === 'userCompany') {
      await delegate.upsert({
        where: { userId_companyId: { userId: row.userId, companyId: row.companyId } },
        update: row,
        create: row,
      });
    } else {
      await delegate.upsert({
        where: { id: row.id },
        update: row,
        create: row,
      });
    }
  }
  return normalized.length;
};

const deleteTarget = async (tx) => {
  for (const model of DELETE_ORDER) {
    const delegate = tx[model];
    if (!delegate) continue;
    await delegate.deleteMany({});
  }
};

const renderMarkdown = (report) => {
  const lines = [];
  lines.push('# Migracion JSON a PostgreSQL');
  lines.push('');
  lines.push(`Modo: \`${report.mode}\``);
  lines.push(`Archivo JSON: \`${report.stateFile}\``);
  lines.push(`Empresa destino: \`${report.companyCode}\``);
  lines.push(`Duracion ms: \`${report.durationMs}\``);
  lines.push('');
  lines.push('## Conteos origen JSON');
  lines.push('');
  lines.push('| Coleccion | Registros |');
  lines.push('|---|---:|');
  Object.entries(report.expectedCollections).forEach(([name, count]) => {
    lines.push(`| ${name} | ${count} |`);
  });
  lines.push('');
  lines.push('## Plan PostgreSQL');
  lines.push('');
  lines.push('| Modelo | Filas |');
  lines.push('|---|---:|');
  Object.entries(report.planCounts).forEach(([name, count]) => {
    lines.push(`| ${name} | ${count} |`);
  });
  lines.push('');
  lines.push(`Warnings: \`${report.warnings.length}\``);
  if (report.warnings.length) {
    report.warnings.slice(0, 50).forEach((warning) => {
      lines.push(`- ${warning.collection ?? 'n/a'} ${warning.id ?? ''} ${warning.field ?? ''}: ${warning.value ?? ''}`);
    });
  }
  return lines;
};

const runVerifyOnly = async (plan) => {
  const { prisma, disconnectPrisma } = await import('../server/database/prisma.js');
  try {
    const databaseCounts = {};
    for (const model of MODEL_ORDER) {
      if (!prisma[model]) continue;
      databaseCounts[model] = await prisma[model].count();
    }
    return {
      databaseCounts,
      expectedPlanCounts: planCounts(plan),
    };
  } finally {
    await disconnectPrisma();
  }
};

const runApply = async (plan) => {
  const { prisma, disconnectPrisma } = await import('../server/database/prisma.js');
  const applied = {};
  try {
    await prisma.$transaction(async (tx) => {
      if (resetTarget) await deleteTarget(tx);
      for (const model of MODEL_ORDER) {
        const rows = plan[model] ?? [];
        if (!rows.length) {
          applied[model] = 0;
          continue;
        }
        applied[model] = await upsertModelRows(tx, model, rows);
      }
    }, { timeout: 120000 });
    return applied;
  } finally {
    await disconnectPrisma();
  }
};

const main = async () => {
  const startedAt = Date.now();
  const { raw, root, state } = loadJsonState(stateFile);
  const { plan, warnings } = buildMigrationPlan(state, { companyCode });
  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    stateFile,
    companyCode,
    resetTarget,
    jsonBytes: Buffer.byteLength(raw),
    jsonWrapper: Boolean(root?.state),
    jsonVersion: root?.version ?? null,
    expectedCollections: expectedCollectionCounts(state),
    planCounts: planCounts(plan),
    warnings,
    applied: null,
    verification: null,
    durationMs: 0,
  };

  if (mode === 'apply') {
    report.applied = await runApply(plan);
  }

  if (mode === 'verify') {
    report.verification = await runVerifyOnly(plan);
  }

  report.durationMs = Date.now() - startedAt;
  writeJsonReport(reportDir, 'postgres-migration-report.json', report);
  writeMarkdownReport(reportDir, 'postgres-migration-report.md', renderMarkdown(report));
  console.log(JSON.stringify({
    mode,
    companyCode,
    jsonBytes: report.jsonBytes,
    expectedCollections: report.expectedCollections,
    planCounts: report.planCounts,
    warnings: report.warnings.length,
    applied: report.applied,
    verification: report.verification,
    reportDir,
    durationMs: report.durationMs,
  }, null, 2));
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
