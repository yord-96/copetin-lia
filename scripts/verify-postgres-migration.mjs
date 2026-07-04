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
const companyCode = readArgument(args, '--company') || process.env.ACTIVE_COMPANY_CODE || DEFAULT_COMPANY_CODE;
const stateFile = path.resolve(readArgument(args, '--state') || process.env.APP_STATE_FILE || path.join(projectRoot, 'data', 'app-state.json'));
const reportDir = path.resolve(readArgument(args, '--report-dir') || path.join(projectRoot, 'reports'));

const CRITICAL_MODELS = new Set([
  'company',
  'user',
  'userCompany',
  'client',
  'category',
  'item',
  'contract',
  'contractItem',
  'quote',
  'rental',
  'rentalItem',
  'cashMovement',
  'attendanceRecord',
]);

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

const renderMarkdown = (report) => {
  const lines = [];
  lines.push('# Verificacion de migracion PostgreSQL');
  lines.push('');
  lines.push(`Resultado global: \`${report.status}\``);
  lines.push(`Empresa: \`${report.companyCode}\``);
  lines.push(`Archivo JSON: \`${report.stateFile}\``);
  lines.push('');
  lines.push('| Modelo | Esperado | PostgreSQL | Estado |');
  lines.push('|---|---:|---:|---|');
  report.models.forEach((row) => {
    lines.push(`| ${row.model} | ${row.expected} | ${row.actual} | ${row.status} |`);
  });
  lines.push('');
  lines.push('## Conteos JSON por coleccion');
  lines.push('');
  Object.entries(report.expectedCollections).forEach(([collection, count]) => {
    lines.push(`- ${collection}: ${count}`);
  });
  return lines;
};

const main = async () => {
  const { state } = loadJsonState(stateFile);
  const { plan, warnings } = buildMigrationPlan(state, { companyCode });
  const expected = planCounts(plan);
  const { prisma, disconnectPrisma } = await import('../server/database/prisma.js');
  const models = [];
  let hasFail = false;
  let hasWarn = false;

  try {
    for (const model of MODEL_ORDER) {
      if (!prisma[model]) continue;
      const actual = await prisma[model].count();
      const expectedCount = expected[model] ?? 0;
      const status = actual === expectedCount
        ? 'PASS'
        : CRITICAL_MODELS.has(model)
          ? 'FAIL'
          : 'WARN';
      if (status === 'FAIL') hasFail = true;
      if (status === 'WARN') hasWarn = true;
      models.push({ model, expected: expectedCount, actual, status });
    }
  } finally {
    await disconnectPrisma();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    status: hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'PASS',
    stateFile,
    companyCode,
    expectedCollections: expectedCollectionCounts(state),
    warnings,
    models,
  };

  writeJsonReport(reportDir, 'postgres-verification.json', report);
  writeMarkdownReport(reportDir, 'postgres-verification.md', renderMarkdown(report));
  console.log(JSON.stringify({
    status: report.status,
    models: report.models,
    reportDir,
  }, null, 2));
  if (hasFail) process.exitCode = 2;
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
