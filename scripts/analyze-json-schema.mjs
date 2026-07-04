import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const readArgument = (name) => {
  const direct = process.argv.find((entry) => entry.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
};

const stateFile = path.resolve(
  readArgument('--state')
    || process.env.APP_STATE_FILE
    || path.join(projectRoot, 'data', 'app-state.json'),
);
const reportDir = path.resolve(readArgument('--report-dir') || path.join(projectRoot, 'reports'));

const COLLECTION_NAME_HINTS = {
  userId: 'users',
  createdById: 'users',
  updatedById: 'users',
  clientId: 'clients',
  categoryId: 'categories',
  itemId: 'items',
  productId: 'items',
  comboId: 'inventoryCombos',
  contractId: 'contracts',
  quoteId: 'quotes',
  rentalId: 'rentals',
  deliveryId: 'deliveries',
  routeId: 'transportRoutes',
  vehicleId: 'vehicles',
  driverId: 'drivers',
  supplierId: 'suppliers',
  cashSessionId: 'cashSessions',
  movementId: 'cashMovements',
  employeeId: 'personnelEmployees',
  reportId: 'generatedReports',
};

const EPHEMERAL_COLLECTIONS = new Set(['userPresence', 'driverLoginLocations']);
const EPHEMERAL_FIELDS = new Set(['isCurrentUser', 'sessionId', 'browserTabId']);
const MONEY_TOKENS = new Set([
  'amount',
  'price',
  'subtotal',
  'total',
  'balance',
  'paid',
  'payment',
  'cost',
  'debt',
  'guarantee',
  'fee',
  'bs',
  'discount',
  'salary',
  'rate',
  'tariff',
  'monto',
  'saldo',
  'precio',
  'costo',
  'garantia',
  'pago',
]);
const DATE_TOKENS = new Set([
  'date',
  'fecha',
  'time',
  'since',
  'until',
  'from',
  'start',
  'end',
  'expires',
  'captured',
  'created',
  'updated',
  'deleted',
  'issued',
  'event',
  'delivery',
  'return',
]);

const getType = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  return typeof value;
};

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const getFieldTokens = (key) =>
  String(key ?? '')
    .split('.')
    .flatMap((part) => part
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^a-zA-Z0-9]+/))
    .map((part) => part.toLowerCase())
    .filter(Boolean);

const isMoneyField = (key) =>
  getFieldTokens(key).some((token) => MONEY_TOKENS.has(token))
  && !/(method|mode|type|status|note|notes|name|description|reason)$/i.test(String(key).split('.').pop() ?? '');

const isDateField = (key) => {
  const tokens = getFieldTokens(key);
  const last = tokens[tokens.length - 1] ?? '';
  const previous = tokens[tokens.length - 2] ?? '';
  if (['by', 'name', 'user', 'role', 'type', 'status'].includes(last)) return false;
  return (last === 'at' && ['created', 'updated', 'deleted', 'captured', 'paid', 'issued', 'expires', 'migrated', 'invited', 'settled'].includes(previous))
    || last === 'date'
    || last.endsWith('date')
    || ['fecha', 'time', 'since', 'until', 'start', 'end', 'expires'].includes(last);
};

const looksLikeDate = (key, value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  return isDateField(key) || /^\d{4}-\d{2}-\d{2}/.test(value);
};

const isValidDateValue = (value) => {
  if (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value.trim())) {
    return true;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time);
};

const flattenObject = (value, prefix = '', output = {}) => {
  if (!isPlainObject(value)) return output;
  Object.entries(value).forEach(([key, entry]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    output[fullKey] = entry;
    if (isPlainObject(entry)) {
      flattenObject(entry, fullKey, output);
    }
  });
  return output;
};

const summarizeScalar = (value) => {
  if (typeof value === 'string') {
    if (value.length > 80) return `${value.slice(0, 77)}...`;
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return undefined;
};

const loadState = () => {
  const raw = fs.readFileSync(stateFile, 'utf8');
  const root = JSON.parse(raw);
  const state = root?.state && isPlainObject(root.state) ? root.state : root;
  return { raw, root, state };
};

const makeCollectionAnalysis = (name, value, allIdSets) => {
  const isArray = Array.isArray(value);
  const rows = isArray ? value : isPlainObject(value) ? [value] : [];
  const fieldStats = new Map();
  const duplicateIds = [];
  const seenIds = new Map();
  const invalidDates = [];
  const invalidMoney = [];
  const orphanReferences = [];
  const nestedStructures = new Set();
  const historicalFields = new Set();
  const ephemeralFields = new Set();

  rows.forEach((row, rowIndex) => {
    if (!isPlainObject(row)) return;
    const id = String(row.id ?? '').trim();
    if (id) {
      if (seenIds.has(id)) duplicateIds.push({ id, firstIndex: seenIds.get(id), duplicateIndex: rowIndex });
      else seenIds.set(id, rowIndex);
    }

    const flat = flattenObject(row);
    Object.entries(flat).forEach(([field, fieldValue]) => {
      const type = getType(fieldValue);
      const stat = fieldStats.get(field) ?? {
        name: field,
        count: 0,
        nullish: 0,
        emptyString: 0,
        types: {},
        examples: [],
        enumValues: new Set(),
        maxStringLength: 0,
      };
      stat.count += 1;
      stat.types[type] = (stat.types[type] ?? 0) + 1;
      if (fieldValue === null || typeof fieldValue === 'undefined') stat.nullish += 1;
      if (fieldValue === '') stat.emptyString += 1;
      if (typeof fieldValue === 'string') stat.maxStringLength = Math.max(stat.maxStringLength, fieldValue.length);
      const scalar = summarizeScalar(fieldValue);
      if (typeof scalar !== 'undefined' && stat.examples.length < 3 && !stat.examples.includes(scalar)) {
        stat.examples.push(scalar);
      }
      if (['string', 'number', 'boolean'].includes(type) && stat.enumValues.size <= 40) {
        stat.enumValues.add(String(fieldValue));
      }
      fieldStats.set(field, stat);

      if (type === 'object' || type === 'array') nestedStructures.add(field);
      if (/created|updated|deleted|migrated|history|revision|audit|log/i.test(field)) historicalFields.add(field);
      if (EPHEMERAL_FIELDS.has(field.split('.').pop())) ephemeralFields.add(field);

      if (looksLikeDate(field, fieldValue) && !isValidDateValue(fieldValue)) {
        invalidDates.push({ rowId: id || null, rowIndex, field, value: summarizeScalar(fieldValue) });
      }
      if (
        isMoneyField(field)
        && ['string', 'number'].includes(type)
        && fieldValue !== null
        && fieldValue !== ''
        && typeof fieldValue !== 'undefined'
      ) {
        const numeric = Number(fieldValue);
        if (!Number.isFinite(numeric)) {
          invalidMoney.push({ rowId: id || null, rowIndex, field, value: summarizeScalar(fieldValue) });
        }
      }

      const lastKey = field.split('.').pop();
      const targetCollection = COLLECTION_NAME_HINTS[lastKey];
      if (targetCollection && fieldValue && allIdSets[targetCollection] && !allIdSets[targetCollection].has(String(fieldValue))) {
        orphanReferences.push({
          rowId: id || null,
          rowIndex,
          field,
          targetCollection,
          value: String(fieldValue),
        });
      }
    });
  });

  const fields = [...fieldStats.values()]
    .map((stat) => {
      const enumValues = [...stat.enumValues];
      const required = rows.length > 0 && stat.count === rows.length && stat.nullish === 0 && stat.emptyString === 0;
      const isLikelyEnum = enumValues.length > 0 && enumValues.length <= 25 && rows.length > 0 && enumValues.length <= Math.max(12, rows.length * 0.5);
      return {
        name: stat.name,
        required,
        optional: !required,
        presence: rows.length > 0 ? Number((stat.count / rows.length).toFixed(4)) : 0,
        types: stat.types,
        examples: stat.examples,
        maxStringLength: stat.maxStringLength,
        enumValues: isLikelyEnum ? enumValues.sort() : undefined,
        isMoney: isMoneyField(stat.name),
        isDate: isDateField(stat.name),
        isId: /(^id$|Id$|Ids$)/.test(stat.name.split('.').pop()),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    name,
    kind: Array.isArray(value) ? 'array' : getType(value),
    count: rows.length,
    idCount: seenIds.size,
    duplicateIds,
    fields,
    requiredFields: fields.filter((field) => field.required).map((field) => field.name),
    optionalFields: fields.filter((field) => field.optional).map((field) => field.name),
    references: fields.filter((field) => field.isId).map((field) => field.name),
    nestedStructures: [...nestedStructures].sort(),
    moneyFields: fields.filter((field) => field.isMoney).map((field) => field.name),
    dateFields: fields.filter((field) => field.isDate).map((field) => field.name),
    enumFields: fields.filter((field) => field.enumValues).map((field) => ({
      name: field.name,
      values: field.enumValues,
    })),
    invalidDates,
    invalidMoney,
    orphanReferences,
    historicalFields: [...historicalFields].sort(),
    ephemeralFields: [...new Set([...ephemeralFields, ...(EPHEMERAL_COLLECTIONS.has(name) ? ['__collection__'] : [])])].sort(),
    preserveInLegacyData: fields
      .filter((field) => field.types.object || field.types.array)
      .map((field) => field.name),
  };
};

const renderMarkdown = (analysis) => {
  const lines = [];
  lines.push('# Analisis de schema JSON');
  lines.push('');
  lines.push(`Archivo: \`${analysis.stateFile}\``);
  lines.push(`Bytes: \`${analysis.bytes}\``);
  lines.push(`SHA256: \`${analysis.sha256}\``);
  lines.push(`Wrapper con state: \`${analysis.wrapper}\``);
  lines.push(`Version: \`${analysis.version ?? 'n/a'}\``);
  lines.push(`Generado: \`${analysis.generatedAt}\``);
  lines.push('');
  lines.push('## Resumen de colecciones');
  lines.push('');
  lines.push('| Coleccion | Tipo | Registros | Campos | Duplicados | Huerfanos | Fechas invalidas |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  analysis.collections.forEach((collection) => {
    lines.push(`| ${collection.name} | ${collection.kind} | ${collection.count} | ${collection.fields.length} | ${collection.duplicateIds.length} | ${collection.orphanReferences.length} | ${collection.invalidDates.length} |`);
  });
  lines.push('');
  analysis.collections.forEach((collection) => {
    lines.push(`## ${collection.name}`);
    lines.push('');
    lines.push(`- Registros: ${collection.count}`);
    lines.push(`- Campos obligatorios: ${collection.requiredFields.length ? collection.requiredFields.map((field) => `\`${field}\``).join(', ') : 'ninguno detectado'}`);
    lines.push(`- Campos con dinero: ${collection.moneyFields.length ? collection.moneyFields.map((field) => `\`${field}\``).join(', ') : 'ninguno'}`);
    lines.push(`- Campos de fecha: ${collection.dateFields.length ? collection.dateFields.map((field) => `\`${field}\``).join(', ') : 'ninguno'}`);
    lines.push(`- Estructuras anidadas: ${collection.nestedStructures.length ? collection.nestedStructures.map((field) => `\`${field}\``).join(', ') : 'ninguna'}`);
    lines.push(`- Campos efimeros: ${collection.ephemeralFields.length ? collection.ephemeralFields.map((field) => `\`${field}\``).join(', ') : 'ninguno'}`);
    lines.push(`- Conservar en legacyData: ${collection.preserveInLegacyData.length ? collection.preserveInLegacyData.map((field) => `\`${field}\``).join(', ') : 'ninguno'}`);
    if (collection.enumFields.length) {
      lines.push('- Enums implicitos:');
      collection.enumFields.forEach((field) => {
        lines.push(`  - \`${field.name}\`: ${field.values.map((value) => `\`${value}\``).join(', ')}`);
      });
    }
    if (collection.duplicateIds.length) {
      lines.push(`- IDs duplicados: ${collection.duplicateIds.length}`);
    }
    if (collection.orphanReferences.length) {
      lines.push(`- Referencias huerfanas: ${collection.orphanReferences.length}`);
    }
    if (collection.invalidDates.length) {
      lines.push(`- Fechas invalidas: ${collection.invalidDates.length}`);
    }
    lines.push('');
  });
  return `${lines.join('\n')}\n`;
};

const main = () => {
  if (!fs.existsSync(stateFile)) {
    throw new Error(`No existe el archivo JSON: ${stateFile}`);
  }
  const { raw, root, state } = loadState();
  const entries = Object.entries(state);
  const allIdSets = {};
  entries.forEach(([name, value]) => {
    if (!Array.isArray(value)) return;
    allIdSets[name] = new Set(value.map((row) => String(row?.id ?? '').trim()).filter(Boolean));
  });

  const collections = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => makeCollectionAnalysis(name, value, allIdSets));

  const analysis = {
    generatedAt: new Date().toISOString(),
    stateFile,
    bytes: Buffer.byteLength(raw),
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    wrapper: Boolean(root?.state && isPlainObject(root.state)),
    version: root?.version ?? null,
    updatedAt: root?.updatedAt ?? null,
    collectionCount: collections.length,
    collections,
    totals: {
      rows: collections.reduce((sum, collection) => sum + collection.count, 0),
      duplicateIds: collections.reduce((sum, collection) => sum + collection.duplicateIds.length, 0),
      orphanReferences: collections.reduce((sum, collection) => sum + collection.orphanReferences.length, 0),
      invalidDates: collections.reduce((sum, collection) => sum + collection.invalidDates.length, 0),
      invalidMoney: collections.reduce((sum, collection) => sum + collection.invalidMoney.length, 0),
    },
  };

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'json-schema-analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
  fs.writeFileSync(path.join(reportDir, 'json-schema-analysis.md'), renderMarkdown(analysis));
  console.log(JSON.stringify({
    reportDir,
    collectionCount: analysis.collectionCount,
    rows: analysis.totals.rows,
    duplicateIds: analysis.totals.duplicateIds,
    orphanReferences: analysis.totals.orphanReferences,
    invalidDates: analysis.totals.invalidDates,
    invalidMoney: analysis.totals.invalidMoney,
  }, null, 2));
};

main();
