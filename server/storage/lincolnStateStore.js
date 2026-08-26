import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeLincolnReservation } from '../services/lincoln/lincolnReservationService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const defaultStateFile = path.join(projectRoot, 'data', 'lincoln-state.json');
const stateFilePath = path.resolve(process.env.LINCOLN_STATE_FILE || defaultStateFile);
const copetinStateFilePath = path.resolve(process.env.APP_STATE_FILE || path.join(projectRoot, 'data', 'app-state.json'));
if (stateFilePath === copetinStateFilePath) {
  throw new Error('LINCOLN_STATE_FILE debe ser diferente de APP_STATE_FILE para impedir mezcla de datos.');
}
let writeQueue = Promise.resolve();
let cachedPayload = null;
let cachedSignature = null;

const createEmptyLincolnState = () => ({
  schemaVersion: 5,
  company: {
    id: 'lincoln',
    name: 'Centro de Eventos Lincoln',
    timezone: 'America/La_Paz',
    currency: 'BOB',
  },
  reservations: [],
  leads: [],
  events: [],
  rooms: [],
  packages: [],
  packageServices: [],
  packageExtras: [],
  clients: [],
  meetings: [],
  suppliers: [],
  inventory: [],
  payments: [],
  receipts: [],
  incomeEntries: [],
  expenseEntries: [],
  eventSettlements: [],
  settings: {
    eventTypes: ['BODA', '15 AÑOS', 'CUMPLEAÑOS', 'EVENTO CORPORATIVO', 'OTRO'],
    paymentDestinations: ['CAJA CHICA', 'SRA. LIA'],
    expenseCategories: ['PERSONAL', 'COMIDA', 'BEBIDAS', 'AGUA', 'BOCADITOS', 'TRANSPORTE', 'AMPLIFICACION', 'TORTA', 'OTROS'],
  },
  auditLog: [],
});

const checksumForState = (state) => crypto
  .createHash('sha256')
  .update(JSON.stringify(state ?? null))
  .digest('hex')
  .slice(0, 16);

const signatureForFile = async () => {
  try {
    const stats = await fs.stat(stateFilePath);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const writePayload = async (payload) => {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  const temporaryPath = `${stateFilePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const serialized = JSON.stringify(payload, null, 2);
    await fs.writeFile(temporaryPath, serialized, 'utf8');
    if (process.platform === 'win32') {
      await fs.writeFile(stateFilePath, serialized, 'utf8');
    } else {
      await fs.rename(temporaryPath, stateFilePath);
    }
    cachedPayload = payload;
    cachedSignature = await signatureForFile();
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
};

const readPayload = async () => {
  const signature = await signatureForFile();
  if (signature && cachedPayload && cachedSignature === signature) return cachedPayload;
  if (!signature) return null;
  const payload = JSON.parse(await fs.readFile(stateFilePath, 'utf8'));
  cachedPayload = payload;
  cachedSignature = signature;
  return payload;
};


const INITIAL_PACKAGE_DOCUMENTS_MIGRATION = 'packageDocuments20260826';

const seedServiceLine = ({ id, category, description, variantIds = [], catalogId = '' }) => ({
  id,
  category,
  sourceType: 'internal',
  description,
  quantity: 1,
  unit: 'SERVICIO',
  costMode: 'fixed_event',
  unitCostBs: 0,
  supplierId: '',
  supplierName: '',
  included: true,
  notes: '',
  variantIds,
  catalogId,
  catalogKind: 'service',
});

const seedExtraLine = ({ id, description, priceBs, costMode = 'per_person', catalogId }) => ({
  id,
  category: 'OTROS',
  sourceType: 'internal',
  description,
  quantity: 1,
  unit: costMode === 'per_person' ? 'PERSONA' : 'EVENTO',
  costMode,
  unitCostBs: priceBs,
  supplierId: '',
  supplierName: '',
  included: false,
  notes: 'Precio referencial tomado del documento comercial entregado por Lincoln.',
  variantIds: [],
  catalogId,
  catalogKind: 'extra',
});

const initialPackageDocumentSeed = (state) => {
  const serviceCatalog = [
    ['SRV-DOC-001', 'CATERING', 'Plato servido: 2 carnes, 3 guarniciones'],
    ['SRV-DOC-002', 'CATERING', 'Bocaditos: 2 rondas'],
    ['SRV-DOC-003', 'CATERING', 'Galleta de champagne (hojaldre con almendras)'],
    ['SRV-DOC-004', 'BEBIDAS', 'Jugos de fruta natural'],
    ['SRV-DOC-005', 'BEBIDAS', 'Cereser para el brindis'],
    ['SRV-DOC-006', 'BEBIDAS', 'Singani: Casa Real negro'],
    ['SRV-DOC-007', 'BEBIDAS', 'Ron: Bacardi añejo'],
    ['SRV-DOC-008', 'BEBIDAS', 'Gaseosas: barra libre'],
    ['SRV-DOC-009', 'BEBIDAS', 'Agua: barra libre'],
    ['SRV-DOC-010', 'BEBIDAS', 'Hielo: barra libre'],
    ['SRV-DOC-011', 'MONTAJE', 'Montaje de mesas con mantelería fina, sillas Tiffany, cristalería, mesa principal para novios, torta, postres y otras mesas especiales'],
    ['SRV-DOC-012', 'SONIDO', 'Amplificación, iluminación y maestro de ceremonia'],
    ['SRV-DOC-013', 'PERSONAL', 'Coordinador de evento, recepcionista, guardia de seguridad, personal de limpieza y garzones'],
    ['SRV-DOC-014', 'SALÓN', 'Alquiler de instalaciones del Salón Grande, gaseado de salón'],
    ['SRV-DOC-015', 'CATERING', 'Bocaditos: 5 rondas – menú amplio a elección'],
    ['SRV-DOC-016', 'MONTAJE', 'Montaje de mesas con mantelería, sillas Tiffany y cristalería básica; mesas especiales de torta y postres'],
    ['SRV-DOC-017', 'PERSONAL', 'Garzones (1 garzón por cada 30 personas)'],
    ['SRV-DOC-018', 'SALÓN', 'Alquiler de instalaciones del Salón Pequeño gaseado'],
    ['SRV-DOC-019', 'CATERING', 'Plato servido: 2 carnes, 3 guarniciones – menú amplio a elección'],
    ['SRV-DOC-020', 'MONTAJE', 'Montaje de mesas con mantelería fina, sillas, cristalería, vajilla, mesa principal de torta, postres, juego de lounge y mesas altas con taburetes'],
    ['SRV-DOC-021', 'PERSONAL', 'Coordinador de evento, recepcionista, guardia de seguridad, garzones (1 garzón por cada 30 personas) y personal de limpieza permanente'],
    ['SRV-DOC-022', 'SALÓN', 'Alquiler de instalaciones del Salón Principal gaseado'],
  ].map(([id, category, description], index) => ({
    id,
    code: `SRV-DOC-${String(index + 1).padStart(3, '0')}`,
    name: description,
    category,
    description,
    sourceType: 'internal',
    costMode: 'fixed_event',
    unit: 'SERVICIO',
    unitCostBs: 0,
    supplierId: '',
    supplierName: '',
    status: 'active',
    notes: 'Servicio inicial cargado una sola vez desde los documentos comerciales de Lincoln.',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));

  const extraCatalog = [
    ['EXT-DOC-001', 'Singani: Casa Real negro o Vodka', 7, 'per_person'],
    ['EXT-DOC-002', 'Ron: Bacardi añejo o Fernet', 8.5, 'per_person'],
    ['EXT-DOC-003', 'Ron: Habana 7 años, Solera', 13, 'per_person'],
    ['EXT-DOC-004', 'Whisky: Johnnie Walker o Chivas Regal', 29, 'per_person'],
    ['EXT-DOC-005', 'Whisky: Old Parr', 32, 'per_person'],
    ['EXT-DOC-006', 'Buffet de postres: 3 postres por persona de 5 variedades', 21, 'per_person'],
    ['EXT-DOC-007', 'Buffet de picaditos: variedad de quesos, jamón y otros', 21, 'per_person'],
    ['EXT-DOC-008', 'Torta con maqueta', 15, 'per_person'],
    ['EXT-DOC-009', 'Saladitos (papa frita, maní)', 5, 'per_person'],
    ['EXT-DOC-010', 'Cócteles (margarita, martini, mojitos, daiquiri, kalua entre otros) con o sin alcohol', 24, 'per_person'],
    ['EXT-DOC-011', 'Vino tinto o blanco (Campos de Solana, Kohlberg fino)', 4, 'per_person'],
    ['EXT-DOC-012', 'Vino tinto o blanco (Rosé, Duo, Terruño, Cabernet)', 7, 'per_person'],
    ['EXT-DOC-013', 'Servicio de amplificación, iluminación, DJ y maestro de ceremonias', 1200, 'fixed_event'],
    ['EXT-DOC-014', 'Servicio de amplificación, iluminación con juego de luces, DJ y maestro de ceremonias para 15 años', 3000, 'fixed_event'],
  ].map(([id, description, unitCostBs, costMode], index) => ({
    id,
    code: `EXT-DOC-${String(index + 1).padStart(3, '0')}`,
    name: description,
    category: 'OTROS',
    description,
    sourceType: 'internal',
    costMode,
    unit: costMode === 'per_person' ? 'PERSONA' : 'EVENTO',
    unitCostBs,
    supplierId: '',
    supplierName: '',
    status: 'active',
    notes: 'Precio referencial inicial cargado una sola vez desde los documentos comerciales de Lincoln.',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));

  const roomByName = (terms) => (state.rooms ?? []).find((room) => {
    const name = String(room?.name ?? '').toUpperCase();
    return terms.some((term) => name.includes(term));
  }) ?? null;
  const largeRoom = roomByName(['GRANDE', 'PRINCIPAL']);
  const smallRoom = roomByName(['PEQUEÑO', 'PEQUENO']);

  const grandeVariants = [
    { id: 'VAR-GRANDE-COBRE', name: 'COBRE', pricePerPersonBs: 120, minimumGuests: 120, status: 'active' },
    { id: 'VAR-GRANDE-PLATA', name: 'PLATA', pricePerPersonBs: 145, minimumGuests: 120, status: 'active' },
    { id: 'VAR-GRANDE-ORO', name: 'ORO', pricePerPersonBs: 210, minimumGuests: 120, status: 'active' },
    { id: 'VAR-GRANDE-PLATINO', name: 'PLATINO', pricePerPersonBs: 245, minimumGuests: 120, status: 'active' },
  ];
  const smallVariants = [
    { id: 'VAR-PEQ-BASICO', name: 'BÁSICO', pricePerPersonBs: 70, minimumGuests: 50, status: 'active' },
    { id: 'VAR-PEQ-PLATA', name: 'PLATA', pricePerPersonBs: 80, minimumGuests: 50, status: 'active' },
    { id: 'VAR-PEQ-PLATINO', name: 'PLATINO', pricePerPersonBs: 145, minimumGuests: 50, status: 'active' },
    { id: 'VAR-PEQ-ORO', name: 'ORO', pricePerPersonBs: 160, minimumGuests: 50, status: 'active' },
  ];
  const quinceVariants = [
    { id: 'VAR-15-BASICO', name: 'BÁSICO', pricePerPersonBs: 120, minimumGuests: 120, status: 'active' },
    { id: 'VAR-15-JOVENES', name: 'JÓVENES', pricePerPersonBs: 180, minimumGuests: 120, status: 'active' },
    { id: 'VAR-15-ADULTOS', name: 'ADULTOS', pricePerPersonBs: 190, minimumGuests: 120, status: 'active' },
  ];

  const packages = [
    {
      id: 'PKG-DOC-SALON-GRANDE', code: 'PAQ-DOC-001', name: 'SALÓN GRANDE', familyName: 'SALÓN GRANDE',
      roomId: largeRoom?.id ?? '', roomName: largeRoom?.name ?? 'SALÓN GRANDE', segment: 'EVENTOS',
      eventTypes: ['BODA', '15 AÑOS', 'CUMPLEAÑOS', 'EVENTO CORPORATIVO', 'OTRO'], minimumGuests: 120,
      pricePerPersonBs: 120, status: 'active', description: 'Paquetes Cobre, Plata, Oro y Platino del Salón Grande según documento comercial entregado por Lincoln.', images: [], variants: grandeVariants,
      serviceLines: [
        seedServiceLine({ id: 'L-GR-001', category: 'CATERING', description: 'Plato servido: 2 carnes, 3 guarniciones', variantIds: ['VAR-GRANDE-ORO','VAR-GRANDE-PLATINO'], catalogId: 'SRV-DOC-001' }),
        seedServiceLine({ id: 'L-GR-002', category: 'CATERING', description: 'Bocaditos: 2 rondas', variantIds: ['VAR-GRANDE-ORO','VAR-GRANDE-PLATINO'], catalogId: 'SRV-DOC-002' }),
        seedServiceLine({ id: 'L-GR-003', category: 'CATERING', description: 'Galleta de champagne (hojaldre con almendras)', variantIds: ['VAR-GRANDE-PLATA','VAR-GRANDE-ORO','VAR-GRANDE-PLATINO'], catalogId: 'SRV-DOC-003' }),
        seedServiceLine({ id: 'L-GR-004', category: 'BEBIDAS', description: 'Jugos de fruta natural', variantIds: ['VAR-GRANDE-PLATA','VAR-GRANDE-ORO','VAR-GRANDE-PLATINO'], catalogId: 'SRV-DOC-004' }),
        seedServiceLine({ id: 'L-GR-005', category: 'BEBIDAS', description: 'Cereser para el brindis', variantIds: ['VAR-GRANDE-PLATA','VAR-GRANDE-ORO','VAR-GRANDE-PLATINO'], catalogId: 'SRV-DOC-005' }),
        seedServiceLine({ id: 'L-GR-006', category: 'BEBIDAS', description: 'Singani: Casa Real negro', variantIds: ['VAR-GRANDE-PLATINO'], catalogId: 'SRV-DOC-006' }),
        seedServiceLine({ id: 'L-GR-007', category: 'BEBIDAS', description: 'Ron: Bacardi añejo', variantIds: ['VAR-GRANDE-PLATINO'], catalogId: 'SRV-DOC-007' }),
        seedServiceLine({ id: 'L-GR-008', category: 'BEBIDAS', description: 'Gaseosas: barra libre', variantIds: ['VAR-GRANDE-PLATA','VAR-GRANDE-ORO','VAR-GRANDE-PLATINO'], catalogId: 'SRV-DOC-008' }),
        seedServiceLine({ id: 'L-GR-009', category: 'BEBIDAS', description: 'Agua: barra libre', variantIds: ['VAR-GRANDE-PLATA','VAR-GRANDE-ORO','VAR-GRANDE-PLATINO'], catalogId: 'SRV-DOC-009' }),
        seedServiceLine({ id: 'L-GR-010', category: 'BEBIDAS', description: 'Hielo: barra libre', variantIds: ['VAR-GRANDE-PLATA','VAR-GRANDE-ORO','VAR-GRANDE-PLATINO'], catalogId: 'SRV-DOC-010' }),
        seedServiceLine({ id: 'L-GR-011', category: 'MONTAJE', description: 'Montaje de mesas con mantelería fina, sillas Tiffany, cristalería, mesa principal para novios, torta, postres y otras mesas especiales', variantIds: [], catalogId: 'SRV-DOC-011' }),
        seedServiceLine({ id: 'L-GR-012', category: 'SONIDO', description: 'Amplificación, iluminación y maestro de ceremonia', variantIds: ['VAR-GRANDE-PLATINO'], catalogId: 'SRV-DOC-012' }),
        seedServiceLine({ id: 'L-GR-013', category: 'PERSONAL', description: 'Coordinador de evento, recepcionista, guardia de seguridad, personal de limpieza y garzones', variantIds: [], catalogId: 'SRV-DOC-013' }),
        seedServiceLine({ id: 'L-GR-014', category: 'SALÓN', description: 'Alquiler de instalaciones del Salón Grande, gaseado de salón', variantIds: [], catalogId: 'SRV-DOC-014' }),
      ],
      servicesText: '', sourceDocument: 'PAQUETES SALÓN GRANDE', createdAt: nowIso(), updatedAt: nowIso(),
    },
    {
      id: 'PKG-DOC-SALON-PEQUENO', code: 'PAQ-DOC-002', name: 'SALÓN PEQUEÑO 2024', familyName: 'SALÓN PEQUEÑO 2024',
      roomId: smallRoom?.id ?? '', roomName: smallRoom?.name ?? 'SALÓN PEQUEÑO', segment: 'EVENTOS',
      eventTypes: ['BODA', '15 AÑOS', 'CUMPLEAÑOS', 'EVENTO CORPORATIVO', 'OTRO'], minimumGuests: 50,
      pricePerPersonBs: 70, status: 'active', description: 'Paquetes Básico, Plata, Platino y Oro del Salón Pequeño según documento comercial 2024.', images: [], variants: smallVariants,
      serviceLines: [
        seedServiceLine({ id: 'L-PEQ-001', category: 'CATERING', description: 'Plato servido: 2 carnes, 3 guarniciones – menú amplio a elección', variantIds: ['VAR-PEQ-ORO'], catalogId: 'SRV-DOC-019' }),
        seedServiceLine({ id: 'L-PEQ-002', category: 'CATERING', description: 'Bocaditos: 5 rondas – menú amplio a elección', variantIds: ['VAR-PEQ-PLATINO'], catalogId: 'SRV-DOC-015' }),
        seedServiceLine({ id: 'L-PEQ-003', category: 'CATERING', description: 'Galleta de champagne (hojaldre con almendras)', variantIds: ['VAR-PEQ-PLATINO','VAR-PEQ-ORO'], catalogId: 'SRV-DOC-003' }),
        seedServiceLine({ id: 'L-PEQ-004', category: 'BEBIDAS', description: 'Jugos de fruta natural', variantIds: ['VAR-PEQ-PLATINO','VAR-PEQ-ORO'], catalogId: 'SRV-DOC-004' }),
        seedServiceLine({ id: 'L-PEQ-005', category: 'BEBIDAS', description: 'Cereser para el brindis', variantIds: ['VAR-PEQ-PLATINO','VAR-PEQ-ORO'], catalogId: 'SRV-DOC-005' }),
        seedServiceLine({ id: 'L-PEQ-006', category: 'BEBIDAS', description: 'Gaseosas: barra libre', variantIds: ['VAR-PEQ-PLATINO','VAR-PEQ-ORO'], catalogId: 'SRV-DOC-008' }),
        seedServiceLine({ id: 'L-PEQ-007', category: 'BEBIDAS', description: 'Agua: barra libre', variantIds: ['VAR-PEQ-PLATINO','VAR-PEQ-ORO'], catalogId: 'SRV-DOC-009' }),
        seedServiceLine({ id: 'L-PEQ-008', category: 'BEBIDAS', description: 'Hielo: barra libre', variantIds: ['VAR-PEQ-PLATINO','VAR-PEQ-ORO'], catalogId: 'SRV-DOC-010' }),
        seedServiceLine({ id: 'L-PEQ-009', category: 'MONTAJE', description: 'Montaje de mesas con mantelería, sillas Tiffany y cristalería básica; mesas especiales de torta y postres', variantIds: [], catalogId: 'SRV-DOC-016' }),
        seedServiceLine({ id: 'L-PEQ-010', category: 'PERSONAL', description: 'Garzones (1 garzón por cada 30 personas)', variantIds: ['VAR-PEQ-PLATA','VAR-PEQ-PLATINO','VAR-PEQ-ORO'], catalogId: 'SRV-DOC-017' }),
        seedServiceLine({ id: 'L-PEQ-011', category: 'SALÓN', description: 'Alquiler de instalaciones del Salón Pequeño gaseado', variantIds: [], catalogId: 'SRV-DOC-018' }),
        ...extraCatalog.filter((item) => item.id !== 'EXT-DOC-014').map((item, index) => seedExtraLine({ id: `L-PEQ-EXT-${index + 1}`, description: item.description, priceBs: item.unitCostBs, costMode: item.costMode, catalogId: item.id })),
      ], servicesText: '', sourceDocument: 'PAQUETES SALÓN PEQUEÑO 2024', createdAt: nowIso(), updatedAt: nowIso(),
    },
    {
      id: 'PKG-DOC-15-ANOS', code: 'PAQ-DOC-003', name: 'PAQUETE 15 AÑOS', familyName: 'PAQUETE 15 AÑOS',
      roomId: largeRoom?.id ?? '', roomName: largeRoom?.name ?? 'SALÓN PRINCIPAL', segment: '15 AÑOS',
      eventTypes: ['15 AÑOS'], minimumGuests: 120, pricePerPersonBs: 120, status: 'active',
      description: 'Paquete 15 Años con niveles Básico, Jóvenes y Adultos según documento comercial entregado por Lincoln.', images: [], variants: quinceVariants,
      serviceLines: [
        seedServiceLine({ id: 'L-15-001', category: 'CATERING', description: 'Plato servido: 2 carnes, 3 guarniciones – menú amplio a elección', variantIds: ['VAR-15-ADULTOS'], catalogId: 'SRV-DOC-019' }),
        seedServiceLine({ id: 'L-15-002', category: 'CATERING', description: 'Bocaditos: 5 rondas – menú amplio a elección', variantIds: ['VAR-15-JOVENES'], catalogId: 'SRV-DOC-015' }),
        seedServiceLine({ id: 'L-15-003', category: 'CATERING', description: 'Galleta de champagne (hojaldre con almendras)', variantIds: ['VAR-15-JOVENES','VAR-15-ADULTOS'], catalogId: 'SRV-DOC-003' }),
        seedServiceLine({ id: 'L-15-004', category: 'BEBIDAS', description: 'Jugos de fruta natural', variantIds: ['VAR-15-JOVENES','VAR-15-ADULTOS'], catalogId: 'SRV-DOC-004' }),
        seedServiceLine({ id: 'L-15-005', category: 'BEBIDAS', description: 'Cereser para el brindis', variantIds: ['VAR-15-JOVENES','VAR-15-ADULTOS'], catalogId: 'SRV-DOC-005' }),
        seedServiceLine({ id: 'L-15-006', category: 'BEBIDAS', description: 'Gaseosas: barra libre', variantIds: ['VAR-15-JOVENES','VAR-15-ADULTOS'], catalogId: 'SRV-DOC-008' }),
        seedServiceLine({ id: 'L-15-007', category: 'BEBIDAS', description: 'Agua: barra libre', variantIds: ['VAR-15-JOVENES','VAR-15-ADULTOS'], catalogId: 'SRV-DOC-009' }),
        seedServiceLine({ id: 'L-15-008', category: 'BEBIDAS', description: 'Hielo: barra libre', variantIds: ['VAR-15-JOVENES','VAR-15-ADULTOS'], catalogId: 'SRV-DOC-010' }),
        seedServiceLine({ id: 'L-15-009', category: 'MONTAJE', description: 'Montaje de mesas con mantelería fina, sillas, cristalería, vajilla, mesa principal de torta, postres, juego de lounge y mesas altas con taburetes', variantIds: [], catalogId: 'SRV-DOC-020' }),
        seedServiceLine({ id: 'L-15-010', category: 'PERSONAL', description: 'Coordinador de evento, recepcionista, guardia de seguridad, garzones (1 garzón por cada 30 personas) y personal de limpieza permanente', variantIds: [], catalogId: 'SRV-DOC-021' }),
        seedServiceLine({ id: 'L-15-011', category: 'SALÓN', description: 'Alquiler de instalaciones del Salón Principal gaseado', variantIds: [], catalogId: 'SRV-DOC-022' }),
        ...extraCatalog.filter((item) => item.id !== 'EXT-DOC-013').map((item, index) => seedExtraLine({ id: `L-15-EXT-${index + 1}`, description: item.description, priceBs: item.unitCostBs, costMode: item.costMode, catalogId: item.id })),
      ], servicesText: '', sourceDocument: 'PAQUETE 15 AÑOS', createdAt: nowIso(), updatedAt: nowIso(),
    },
  ];

  return { packages, serviceCatalog, extraCatalog };
};

const applyInitialPackageDocumentSeed = (state) => {
  const settings = state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings) ? state.settings : {};
  const migrations = settings.dataMigrations && typeof settings.dataMigrations === 'object' && !Array.isArray(settings.dataMigrations)
    ? settings.dataMigrations
    : {};
  if (migrations[INITIAL_PACKAGE_DOCUMENTS_MIGRATION]) return { state, changed: false };

  const { packages, serviceCatalog, extraCatalog } = initialPackageDocumentSeed(state);
  const packageIds = new Set((state.packages ?? []).map((row) => row?.id));
  const serviceIds = new Set((state.packageServices ?? []).map((row) => row?.id));
  const extraIds = new Set((state.packageExtras ?? []).map((row) => row?.id));
  state.packages = [...(state.packages ?? []), ...packages.filter((row) => !packageIds.has(row.id))];
  state.packageServices = [...(state.packageServices ?? []), ...serviceCatalog.filter((row) => !serviceIds.has(row.id))];
  state.packageExtras = [...(state.packageExtras ?? []), ...extraCatalog.filter((row) => !extraIds.has(row.id))];
  state.settings = {
    ...settings,
    dataMigrations: {
      ...migrations,
      [INITIAL_PACKAGE_DOCUMENTS_MIGRATION]: {
        appliedAt: nowIso(),
        source: 'Documentos comerciales Lincoln entregados por el usuario',
        packagesAdded: packages.length,
      },
    },
  };
  state.schemaVersion = Math.max(5, Number(state.schemaVersion ?? 1));
  return { state, changed: true };
};

export const ensureLincolnStateStore = async () => {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  const signature = await signatureForFile();
  if (!signature) {
    const seeded = applyInitialPackageDocumentSeed(createEmptyLincolnState()).state;
    const updatedAt = new Date().toISOString();
    await writePayload({
      state: seeded,
      version: 1,
      checksum: checksumForState(seeded),
      updatedAt,
    });
    return;
  }

  const payload = await readPayload();
  const normalized = normalizeLincolnStateShape(payload?.state ?? createEmptyLincolnState());
  const migration = applyInitialPackageDocumentSeed(normalized);
  if (!migration.changed) return;
  const version = Number(payload?.version ?? 1) + 1;
  const checksum = checksumForState(migration.state);
  const updatedAt = new Date().toISOString();
  await writePayload({ state: migration.state, version, checksum, updatedAt });
};

export const getLincolnStateSnapshot = async () => {
  await ensureLincolnStateStore();
  const payload = await readPayload();
  return {
    initialized: Boolean(payload?.state),
    state: normalizeLincolnStateShape(payload?.state ?? createEmptyLincolnState()),
    version: Number(payload?.version ?? 1),
    revision: payload?.state ? `${payload.version ?? 1}:${payload.checksum ?? 'state'}` : null,
    updatedAt: payload?.updatedAt ?? null,
  };
};

export const replaceLincolnStateSnapshot = async (state, expectedRevision) => {
  const operation = writeQueue.then(async () => {
    const current = await getLincolnStateSnapshot();
    if (String(expectedRevision ?? '') !== String(current.revision ?? '')) {
      const error = new Error('La revision de Lincoln no coincide con la version actual.');
      error.statusCode = 409;
      error.code = 'LINCOLN_REVISION_CONFLICT';
      throw error;
    }
    const nextState = normalizeLincolnStateShape(
      state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : createEmptyLincolnState(),
    );
    const version = current.version + 1;
    const checksum = checksumForState(nextState);
    const updatedAt = new Date().toISOString();
    await writePayload({ state: nextState, version, checksum, updatedAt });
    return { ok: true, version, revision: `${version}:${checksum}`, updatedAt };
  });
  writeQueue = operation.catch(() => {});
  return operation;
};


const LINCOLN_MUTABLE_COLLECTIONS = new Set(['clients', 'rooms', 'packages', 'packageServices', 'packageExtras', 'reservations', 'events', 'meetings', 'expenseEntries']);

const normalizeLincolnStateShape = (state) => {
  const base = createEmptyLincolnState();
  const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const next = {
    ...base,
    ...source,
    company: { ...base.company, ...(source.company ?? {}), id: 'lincoln' },
    settings: { ...base.settings, ...(source.settings ?? {}) },
  };
  ['reservations', 'leads', 'events', 'rooms', 'packages', 'packageServices', 'packageExtras', 'clients', 'meetings', 'suppliers', 'inventory', 'payments', 'receipts', 'incomeEntries', 'expenseEntries', 'eventSettlements', 'auditLog'].forEach((key) => {
    next[key] = Array.isArray(source[key]) ? source[key] : [];
  });
  next.schemaVersion = Math.max(5, Number(source.schemaVersion ?? 1));
  return next;
};

const makeLincolnId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const nowIso = () => new Date().toISOString();

const nextLincolnCode = (prefix, rows = []) => {
  const year = new Date().getFullYear();
  const regex = new RegExp(`^${prefix}-${year}-(\\d+)$`, 'i');
  const max = rows.reduce((currentMax, row) => {
    const match = String(row?.code ?? '').match(regex);
    return match ? Math.max(currentMax, Number(match[1])) : currentMax;
  }, 0);
  return `${prefix}-${year}-${String(max + 1).padStart(4, '0')}`;
};

const getCollectionPrefix = (collection) => ({
  clients: 'CLI',
  rooms: 'SAL',
  packages: 'PAQ',
  packageServices: 'SRV',
  packageExtras: 'EXT',
  reservations: 'RES',
  events: 'EVE',
  meetings: 'REU',
  expenseEntries: 'EGR',
}[collection] ?? 'LIN');

const appendLincolnAudit = (state, entry) => {
  state.auditLog = [{ id: makeLincolnId('AUD'), createdAt: nowIso(), ...entry }, ...(Array.isArray(state.auditLog) ? state.auditLog : [])].slice(0, 5000);
};

const normalizeClientText = (value) => String(value ?? '').trim();
const normalizeClientKey = (value) => normalizeClientText(value).toLowerCase().replace(/\s+/g, ' ');
const normalizeClientPhone = (value) => normalizeClientText(value).replace(/\D/g, '');

const ensureReservationClient = (state, person, actor, sourceCode = '') => {
  const name = normalizeClientText(person?.name);
  if (!name) return null;
  const ci = normalizeClientText(person?.ci);
  const phone = normalizeClientText(person?.phone);
  const normalizedCi = normalizeClientKey(ci);
  const normalizedPhone = normalizeClientPhone(phone);
  const normalizedName = normalizeClientKey(name);
  const existing = state.clients.find((client) => {
    const clientCi = normalizeClientKey(client?.ci);
    const clientPhone = normalizeClientPhone(client?.phone);
    const clientName = normalizeClientKey(client?.name);
    if (normalizedCi && clientCi) return normalizedCi === clientCi;
    if (normalizedPhone && clientPhone) return normalizedPhone === clientPhone;
    return normalizedName && clientName === normalizedName;
  });
  if (existing) {
    let changed = false;
    if (!normalizeClientText(existing.ci) && ci) { existing.ci = ci; changed = true; }
    if (!normalizeClientText(existing.phone) && phone) { existing.phone = phone; changed = true; }
    if (changed) existing.updatedAt = nowIso();
    return existing;
  }
  const createdAt = nowIso();
  const client = {
    id: makeLincolnId('CLI'),
    code: nextLincolnCode('CLI', state.clients),
    name, ci, phone, secondaryPhone: '', email: '', notes: sourceCode ? `Creado automáticamente desde ${sourceCode}.` : 'Creado automáticamente desde Reservas Lincoln.',
    status: 'active', createdAt, updatedAt: createdAt,
    createdById: String(actor?.id ?? '').trim() || null, createdByName: String(actor?.name ?? '').trim() || null,
  };
  state.clients.unshift(client);
  appendLincolnAudit(state, { action: 'clients.auto_create', entityType: 'clients', entityId: client.id, entityCode: client.code, actorId: client.createdById, actorName: client.createdByName, sourceCode });
  return client;
};

const mutateLincolnState = async (expectedRevision, mutator) => {
  const operation = writeQueue.then(async () => {
    const current = await getLincolnStateSnapshot();
    if (String(expectedRevision ?? '') !== String(current.revision ?? '')) {
      const error = new Error('La revision de Lincoln no coincide con la version actual.');
      error.statusCode = 409;
      error.code = 'LINCOLN_REVISION_CONFLICT';
      error.currentRevision = current.revision;
      throw error;
    }
    const state = normalizeLincolnStateShape(current.state);
    const result = await mutator(state);
    const version = current.version + 1;
    const checksum = checksumForState(state);
    const updatedAt = nowIso();
    await writePayload({ state, version, checksum, updatedAt });
    return { ok: true, version, revision: `${version}:${checksum}`, updatedAt, ...result };
  });
  writeQueue = operation.catch(() => {});
  return operation;
};

export const createLincolnRecord = async (collection, payload, expectedRevision, actor = {}) => {
  if (!LINCOLN_MUTABLE_COLLECTIONS.has(collection)) {
    const error = new Error('Coleccion Lincoln no permitida.');
    error.statusCode = 400;
    error.code = 'LINCOLN_COLLECTION_INVALID';
    throw error;
  }
  return mutateLincolnState(expectedRevision, (state) => {
    const rows = state[collection];
    const prefix = getCollectionPrefix(collection);
    const createdAt = nowIso();
    let normalizedPayload = collection === 'reservations'
      ? normalizeLincolnReservation({ ...payload, reservationDate: payload?.reservationDate || createdAt.slice(0, 10) }, state)
      : (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {});
    if (collection === 'reservations') {
      const primaryClient = ensureReservationClient(state, { name: normalizedPayload.contractor1Name, ci: normalizedPayload.contractor1Ci, phone: normalizedPayload.contractor1Phone }, actor, String(payload?.code ?? '').trim() || 'RESERVA LINCOLN');
      const secondaryClient = ensureReservationClient(state, { name: normalizedPayload.contractor2Name, ci: normalizedPayload.contractor2Ci, phone: normalizedPayload.contractor2Phone }, actor, String(payload?.code ?? '').trim() || 'RESERVA LINCOLN');
      normalizedPayload = { ...normalizedPayload, clientId: primaryClient?.id ?? null, secondClientId: secondaryClient?.id ?? null };
    }
    const record = {
      ...normalizedPayload,
      id: makeLincolnId(prefix),
      code: String(payload?.code ?? '').trim() || nextLincolnCode(prefix, rows),
      createdAt,
      updatedAt: createdAt,
      createdById: String(actor?.id ?? '').trim() || null,
      createdByName: String(actor?.name ?? '').trim() || null,
    };
    rows.unshift(record);
    appendLincolnAudit(state, { action: `${collection}.create`, entityType: collection, entityId: record.id, entityCode: record.code, actorId: String(actor?.id ?? '').trim() || null, actorName: String(actor?.name ?? '').trim() || null });
    return { record };
  });
};

export const updateLincolnRecord = async (collection, id, payload, expectedRevision, actor = {}) => {
  if (!LINCOLN_MUTABLE_COLLECTIONS.has(collection)) {
    const error = new Error('Coleccion Lincoln no permitida.');
    error.statusCode = 400;
    error.code = 'LINCOLN_COLLECTION_INVALID';
    throw error;
  }
  return mutateLincolnState(expectedRevision, (state) => {
    const rows = state[collection];
    const index = rows.findIndex((row) => String(row?.id ?? '') === String(id ?? ''));
    if (index < 0) {
      const error = new Error('Registro Lincoln no encontrado.');
      error.statusCode = 404;
      error.code = 'LINCOLN_RECORD_NOT_FOUND';
      throw error;
    }
    const current = rows[index];
    const incoming = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    let normalizedIncoming = collection === 'reservations'
      ? normalizeLincolnReservation(incoming, state, { existing: current })
      : incoming;
    if (collection === 'reservations') {
      const primaryClient = ensureReservationClient(state, { name: normalizedIncoming.contractor1Name, ci: normalizedIncoming.contractor1Ci, phone: normalizedIncoming.contractor1Phone }, actor, current.code);
      const secondaryClient = ensureReservationClient(state, { name: normalizedIncoming.contractor2Name, ci: normalizedIncoming.contractor2Ci, phone: normalizedIncoming.contractor2Phone }, actor, current.code);
      normalizedIncoming = { ...normalizedIncoming, clientId: primaryClient?.id ?? null, secondClientId: secondaryClient?.id ?? null };
    }
    const linkedEvent = collection === 'reservations'
      ? state.events.find((event) => String(event?.reservationId ?? '') === String(current.id) || String(event?.id ?? '') === String(current.eventId ?? ''))
      : null;
    const protectedIncoming = linkedEvent
      ? { ...normalizedIncoming, status: 'converted', eventId: linkedEvent.id }
      : normalizedIncoming;
    const record = {
      ...current,
      ...protectedIncoming,
      id: current.id,
      code: current.code,
      createdAt: current.createdAt,
      updatedAt: nowIso(),
      updatedById: String(actor?.id ?? '').trim() || null,
      updatedByName: String(actor?.name ?? '').trim() || null,
    };
    rows[index] = record;
    appendLincolnAudit(state, { action: `${collection}.update`, entityType: collection, entityId: record.id, entityCode: record.code, actorId: String(actor?.id ?? '').trim() || null, actorName: String(actor?.name ?? '').trim() || null });
    return { record };
  });
};

export const convertLincolnReservationToEvent = async (reservationId, payload, expectedRevision, actor = {}) =>
  mutateLincolnState(expectedRevision, (state) => {
    const reservationIndex = state.reservations.findIndex((row) => String(row?.id ?? '') === String(reservationId ?? ''));
    if (reservationIndex < 0) {
      const error = new Error('Reserva Lincoln no encontrada.');
      error.statusCode = 404;
      error.code = 'LINCOLN_RESERVATION_NOT_FOUND';
      throw error;
    }
    const reservation = state.reservations[reservationIndex];
    const existing = state.events.find((row) => String(row?.reservationId ?? '') === String(reservation.id));
    if (existing) {
      const repairedReservation = {
        ...reservation,
        status: 'converted',
        eventId: existing.id,
        updatedAt: nowIso(),
      };
      state.reservations[reservationIndex] = repairedReservation;
      return { record: existing, reservation: repairedReservation, alreadyConverted: true };
    }
    const createdAt = nowIso();
    const event = {
      clientId: reservation.clientId ?? null,
      clientName: reservation.clientName ?? '',
      clientCi: reservation.clientCi ?? '',
      clientPhone: reservation.clientPhone ?? '',
      contractor1Name: reservation.contractor1Name ?? reservation.clientName ?? '',
      contractor1Ci: reservation.contractor1Ci ?? reservation.clientCi ?? '',
      contractor1Phone: reservation.contractor1Phone ?? reservation.clientPhone ?? '',
      contractor2Name: reservation.contractor2Name ?? reservation.secondContractorName ?? '',
      contractor2Ci: reservation.contractor2Ci ?? reservation.secondContractorCi ?? '',
      contractor2Phone: reservation.contractor2Phone ?? reservation.secondContractorPhone ?? '',
      organizerId: reservation.organizerId ?? null,
      organizerName: reservation.organizerName ?? '',
      organizerPhone: reservation.organizerPhone ?? '',
      reservationDate: reservation.reservationDate ?? '',
      eventType: reservation.eventType ?? '',
      eventDate: reservation.eventDate ?? '',
      startTime: reservation.startTime ?? '',
      durationHours: Number(reservation.durationHours ?? 8),
      roomId: reservation.roomId ?? null,
      roomName: reservation.roomName ?? '',
      guestCount: Number(reservation.guestCount ?? 0),
      packageId: reservation.packageId ?? null,
      packageName: reservation.packageName ?? '',
      packageVariantId: reservation.packageVariantId ?? null,
      packageVariantName: reservation.packageVariantName ?? '',
      packageSnapshot: reservation.packageSnapshot && typeof reservation.packageSnapshot === 'object' ? reservation.packageSnapshot : null,
      packageLines: Array.isArray(reservation.packageLines) ? reservation.packageLines : [],
      estimatedTotalBs: Number(reservation.estimatedTotalBs ?? 0),
      reservationPaymentBs: Number(reservation.reservationPaymentBs ?? 0),
      accountPaymentBs: Number(reservation.accountPaymentBs ?? 0),
      guaranteeBs: Number(reservation.guaranteeBs ?? 0),
      notes: reservation.notes ?? '',
      status: 'contract_pending',
      ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
      id: makeLincolnId('EVE'),
      code: nextLincolnCode('EVE', state.events),
      reservationId: reservation.id,
      createdAt,
      updatedAt: createdAt,
      createdById: String(actor?.id ?? '').trim() || null,
      createdByName: String(actor?.name ?? '').trim() || null,
    };
    state.events.unshift(event);
    state.reservations[reservationIndex] = { ...reservation, status: 'converted', eventId: event.id, updatedAt: createdAt };
    appendLincolnAudit(state, { action: 'reservations.convert_to_event', entityType: 'events', entityId: event.id, entityCode: event.code, actorId: String(actor?.id ?? '').trim() || null, actorName: String(actor?.name ?? '').trim() || null });
    return { record: event, reservation: state.reservations[reservationIndex] };
  });


const SERVICE_PAYMENT_TYPES = new Set(['advance', 'installment', 'balance']);
const PAYMENT_TYPE_LABELS = {
  advance: 'ANTICIPO',
  installment: 'A CUENTA',
  balance: 'SALDO',
  guarantee: 'GARANTIA',
  replacement: 'REPOSICION',
};

const roundMoney = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};

const requirePositiveMoney = (value, label = 'monto') => {
  const amount = roundMoney(value);
  if (amount <= 0) {
    const error = new Error(`El ${label} debe ser mayor a cero.`);
    error.statusCode = 400;
    error.code = 'LINCOLN_AMOUNT_INVALID';
    throw error;
  }
  return amount;
};

const findLincolnEvent = (state, eventId) => {
  const event = state.events.find((row) => String(row?.id ?? '') === String(eventId ?? ''));
  if (!event) {
    const error = new Error('Evento Lincoln no encontrado.');
    error.statusCode = 404;
    error.code = 'LINCOLN_EVENT_NOT_FOUND';
    throw error;
  }
  return event;
};

const activeEventPayments = (state, eventId) => state.payments.filter((row) =>
  String(row?.eventId ?? '') === String(eventId ?? '') && !row?.voidedAt,
);

const buildEventFinancialSummary = (state, event) => {
  const payments = activeEventPayments(state, event.id);
  const servicePaidBs = roundMoney(sumMoney(payments.filter((row) => SERVICE_PAYMENT_TYPES.has(row.type)), 'amountBs'));
  const guaranteeCollectedBs = roundMoney(sumMoney(payments.filter((row) => row.type === 'guarantee'), 'amountBs'));
  const guaranteeReturnedBs = roundMoney(sumMoney(payments.filter((row) => row.type === 'guarantee_return'), 'amountBs'));
  const replacementBs = roundMoney(sumMoney(payments.filter((row) => row.type === 'replacement'), 'amountBs'));
  const eventTotalBs = roundMoney(event.totalBs ?? event.estimatedTotalBs ?? 0);
  const guaranteeRequiredBs = roundMoney(event.guaranteeBs ?? 0);
  return {
    eventTotalBs,
    servicePaidBs,
    serviceBalanceBs: Math.max(0, roundMoney(eventTotalBs - servicePaidBs)),
    guaranteeRequiredBs,
    guaranteeCollectedBs,
    guaranteePendingBs: Math.max(0, roundMoney(guaranteeRequiredBs - guaranteeCollectedBs)),
    guaranteeReturnedBs,
    guaranteeHeldBs: Math.max(0, roundMoney(guaranteeCollectedBs - guaranteeReturnedBs)),
    replacementBs,
  };
};

const sumMoney = (rows, key) => rows.reduce((total, row) => total + roundMoney(row?.[key] ?? 0), 0);

const appendIncomeForPayment = (state, payment, actor) => {
  const income = {
    id: makeLincolnId('ING'),
    code: nextLincolnCode('ING', state.incomeEntries),
    paymentId: payment.id,
    receiptId: payment.receiptId ?? null,
    eventId: payment.eventId,
    eventCode: payment.eventCode,
    clientId: payment.clientId ?? null,
    clientName: payment.clientName ?? '',
    date: payment.date,
    category: PAYMENT_TYPE_LABELS[payment.type] ?? String(payment.type ?? 'INGRESO').toUpperCase(),
    description: payment.description,
    method: payment.method,
    destination: payment.destination,
    amountBs: payment.amountBs,
    createdAt: payment.createdAt,
    createdById: String(actor?.id ?? '').trim() || null,
    createdByName: String(actor?.name ?? '').trim() || null,
  };
  state.incomeEntries.unshift(income);
  return income;
};

export const registerLincolnEventPayment = async (eventId, payload, expectedRevision, actor = {}) =>
  mutateLincolnState(expectedRevision, (state) => {
    const event = findLincolnEvent(state, eventId);
    const type = String(payload?.type ?? 'installment').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(PAYMENT_TYPE_LABELS, type)) {
      const error = new Error('Tipo de pago Lincoln no permitido.');
      error.statusCode = 400;
      error.code = 'LINCOLN_PAYMENT_TYPE_INVALID';
      throw error;
    }
    const amountBs = requirePositiveMoney(payload?.amountBs, 'monto del pago');
    const createdAt = nowIso();
    const receipt = {
      id: makeLincolnId('RCL'),
      code: nextLincolnCode('RCL', state.receipts),
      eventId: event.id,
      eventCode: event.code,
      clientId: event.clientId ?? null,
      clientName: event.clientName ?? '',
      date: String(payload?.date ?? '').trim() || createdAt.slice(0, 10),
      type,
      concept: String(payload?.description ?? '').trim() || PAYMENT_TYPE_LABELS[type],
      method: String(payload?.method ?? 'cash').trim().toLowerCase(),
      destination: String(payload?.destination ?? '').trim() || 'CAJA CHICA',
      payerName: String(payload?.payerName ?? event.clientName ?? '').trim(),
      amountBs,
      status: 'active',
      createdAt,
      createdById: String(actor?.id ?? '').trim() || null,
      createdByName: String(actor?.name ?? '').trim() || null,
    };
    const payment = {
      id: makeLincolnId('PAG'),
      code: nextLincolnCode('PAG', state.payments),
      receiptId: receipt.id,
      receiptCode: receipt.code,
      eventId: event.id,
      eventCode: event.code,
      clientId: event.clientId ?? null,
      clientName: event.clientName ?? '',
      date: receipt.date,
      type,
      amountBs,
      method: receipt.method,
      destination: receipt.destination,
      payerName: receipt.payerName,
      description: receipt.concept,
      reference: String(payload?.reference ?? '').trim(),
      createdAt,
      createdById: String(actor?.id ?? '').trim() || null,
      createdByName: String(actor?.name ?? '').trim() || null,
    };
    state.receipts.unshift(receipt);
    state.payments.unshift(payment);
    const income = appendIncomeForPayment(state, payment, actor);
    event.updatedAt = createdAt;
    event.financial = buildEventFinancialSummary(state, event);
    appendLincolnAudit(state, {
      action: 'events.payment.create', entityType: 'payments', entityId: payment.id, entityCode: payment.code,
      actorId: String(actor?.id ?? '').trim() || null, actorName: String(actor?.name ?? '').trim() || null,
      eventId: event.id, receiptCode: receipt.code, amountBs,
    });
    return { payment, receipt, income, eventFinancial: event.financial };
  });

export const voidLincolnPayment = async (paymentId, payload, expectedRevision, actor = {}) =>
  mutateLincolnState(expectedRevision, (state) => {
    const payment = state.payments.find((row) => String(row?.id ?? '') === String(paymentId ?? ''));
    if (!payment) {
      const error = new Error('Pago Lincoln no encontrado.');
      error.statusCode = 404;
      error.code = 'LINCOLN_PAYMENT_NOT_FOUND';
      throw error;
    }
    if (payment.voidedAt) return { payment };
    const voidedAt = nowIso();
    const reason = String(payload?.reason ?? '').trim() || 'ANULACION ADMINISTRATIVA';
    payment.voidedAt = voidedAt;
    payment.voidReason = reason;
    payment.voidedById = String(actor?.id ?? '').trim() || null;
    payment.voidedByName = String(actor?.name ?? '').trim() || null;
    const receipt = state.receipts.find((row) => String(row?.id ?? '') === String(payment.receiptId ?? ''));
    if (receipt) {
      receipt.status = 'voided';
      receipt.voidedAt = voidedAt;
      receipt.voidReason = reason;
    }
    const income = state.incomeEntries.find((row) => String(row?.paymentId ?? '') === String(payment.id));
    if (income) {
      income.voidedAt = voidedAt;
      income.voidReason = reason;
    }
    const event = findLincolnEvent(state, payment.eventId);
    event.updatedAt = voidedAt;
    event.financial = buildEventFinancialSummary(state, event);
    appendLincolnAudit(state, {
      action: 'payments.void', entityType: 'payments', entityId: payment.id, entityCode: payment.code,
      actorId: String(actor?.id ?? '').trim() || null, actorName: String(actor?.name ?? '').trim() || null,
      eventId: event.id, reason,
    });
    return { payment, eventFinancial: event.financial };
  });

export const returnLincolnGuarantee = async (eventId, payload, expectedRevision, actor = {}) =>
  mutateLincolnState(expectedRevision, (state) => {
    const event = findLincolnEvent(state, eventId);
    const before = buildEventFinancialSummary(state, event);
    const amountBs = requirePositiveMoney(payload?.amountBs ?? before.guaranteeHeldBs, 'monto de devolución');
    if (amountBs > before.guaranteeHeldBs) {
      const error = new Error('La devolución supera la garantía actualmente retenida.');
      error.statusCode = 400;
      error.code = 'LINCOLN_GUARANTEE_RETURN_EXCEEDS_HELD';
      throw error;
    }
    const createdAt = nowIso();
    const payment = {
      id: makeLincolnId('PAG'),
      code: nextLincolnCode('PAG', state.payments),
      receiptId: null,
      receiptCode: null,
      eventId: event.id,
      eventCode: event.code,
      clientId: event.clientId ?? null,
      clientName: event.clientName ?? '',
      date: String(payload?.date ?? '').trim() || createdAt.slice(0, 10),
      type: 'guarantee_return',
      amountBs,
      method: String(payload?.method ?? 'cash').trim().toLowerCase(),
      destination: String(payload?.destination ?? '').trim() || 'CAJA CHICA',
      payerName: event.clientName ?? '',
      description: String(payload?.description ?? '').trim() || 'DEVOLUCION DE GARANTIA',
      reference: String(payload?.reference ?? '').trim(),
      createdAt,
      createdById: String(actor?.id ?? '').trim() || null,
      createdByName: String(actor?.name ?? '').trim() || null,
    };
    const expense = {
      id: makeLincolnId('EGR'),
      code: nextLincolnCode('EGR', state.expenseEntries),
      eventId: event.id,
      eventCode: event.code,
      date: payment.date,
      category: 'DEVOLUCION GARANTIA',
      description: payment.description,
      method: payment.method,
      destination: payment.destination,
      amountBs,
      paymentId: payment.id,
      createdAt,
      createdById: payment.createdById,
      createdByName: payment.createdByName,
    };
    state.payments.unshift(payment);
    state.expenseEntries.unshift(expense);
    event.updatedAt = createdAt;
    event.financial = buildEventFinancialSummary(state, event);
    appendLincolnAudit(state, {
      action: 'events.guarantee.return', entityType: 'expenseEntries', entityId: expense.id, entityCode: expense.code,
      actorId: String(actor?.id ?? '').trim() || null, actorName: String(actor?.name ?? '').trim() || null,
      eventId: event.id, amountBs,
    });
    return { payment, expense, eventFinancial: event.financial };
  });

export const createLincolnExpense = async (payload, expectedRevision, actor = {}) =>
  mutateLincolnState(expectedRevision, (state) => {
    const amountBs = requirePositiveMoney(payload?.amountBs, 'monto del egreso');
    const eventId = String(payload?.eventId ?? '').trim() || null;
    const event = eventId ? findLincolnEvent(state, eventId) : null;
    const createdAt = nowIso();
    const expense = {
      id: makeLincolnId('EGR'),
      code: nextLincolnCode('EGR', state.expenseEntries),
      eventId: event?.id ?? null,
      eventCode: event?.code ?? null,
      date: String(payload?.date ?? '').trim() || createdAt.slice(0, 10),
      category: String(payload?.category ?? 'OTROS').trim().toUpperCase() || 'OTROS',
      description: String(payload?.description ?? '').trim(),
      method: String(payload?.method ?? 'cash').trim().toLowerCase(),
      destination: String(payload?.destination ?? '').trim() || 'CAJA CHICA',
      supplierName: String(payload?.supplierName ?? '').trim(),
      reference: String(payload?.reference ?? '').trim(),
      amountBs,
      createdAt,
      createdById: String(actor?.id ?? '').trim() || null,
      createdByName: String(actor?.name ?? '').trim() || null,
    };
    state.expenseEntries.unshift(expense);
    if (event) event.updatedAt = createdAt;
    appendLincolnAudit(state, {
      action: 'expenses.create', entityType: 'expenseEntries', entityId: expense.id, entityCode: expense.code,
      actorId: String(actor?.id ?? '').trim() || null, actorName: String(actor?.name ?? '').trim() || null,
      eventId: event?.id ?? null, amountBs,
    });
    return { expense };
  });

export const updateLincolnExpense = async (expenseId, payload, expectedRevision, actor = {}) =>
  mutateLincolnState(expectedRevision, (state) => {
    const expense = state.expenseEntries.find((row) => String(row?.id ?? '') === String(expenseId ?? ''));
    if (!expense || expense?.voidedAt) {
      const error = new Error('Egreso Lincoln no encontrado o anulado.');
      error.statusCode = 404;
      error.code = 'LINCOLN_EXPENSE_NOT_FOUND';
      throw error;
    }
    const nextEventId = String(payload?.eventId ?? expense.eventId ?? '').trim() || null;
    const event = nextEventId ? findLincolnEvent(state, nextEventId) : null;
    const updatedAt = nowIso();
    Object.assign(expense, {
      eventId: event?.id ?? null,
      eventCode: event?.code ?? null,
      date: String(payload?.date ?? expense.date ?? '').trim() || updatedAt.slice(0, 10),
      category: String(payload?.category ?? expense.category ?? 'OTROS').trim().toUpperCase() || 'OTROS',
      description: String(payload?.description ?? expense.description ?? '').trim(),
      method: String(payload?.method ?? expense.method ?? 'cash').trim().toLowerCase(),
      destination: String(payload?.destination ?? expense.destination ?? '').trim() || 'CAJA CHICA',
      supplierName: String(payload?.supplierName ?? expense.supplierName ?? '').trim(),
      reference: String(payload?.reference ?? expense.reference ?? '').trim(),
      amountBs: requirePositiveMoney(payload?.amountBs ?? expense.amountBs, 'monto del egreso'),
      updatedAt,
      updatedById: String(actor?.id ?? '').trim() || null,
      updatedByName: String(actor?.name ?? '').trim() || null,
    });
    appendLincolnAudit(state, {
      action: 'expenses.update', entityType: 'expenseEntries', entityId: expense.id, entityCode: expense.code,
      actorId: String(actor?.id ?? '').trim() || null, actorName: String(actor?.name ?? '').trim() || null,
      eventId: event?.id ?? null,
    });
    return { expense };
  });


export const setLincolnSettlementStatus = async (eventId, payload, expectedRevision, actor = {}) =>
  mutateLincolnState(expectedRevision, (state) => {
    const event = findLincolnEvent(state, eventId);
    const requestedStatus = String(payload?.status ?? 'closed').trim().toLowerCase();
    if (!['open', 'closed'].includes(requestedStatus)) {
      const error = new Error('Estado de rendición Lincoln no permitido.');
      error.statusCode = 400;
      error.code = 'LINCOLN_SETTLEMENT_STATUS_INVALID';
      throw error;
    }
    const existingIndex = state.eventSettlements.findIndex((row) => String(row?.eventId ?? '') === String(event.id));
    const changedAt = nowIso();
    const current = existingIndex >= 0 ? state.eventSettlements[existingIndex] : null;
    const settlement = {
      ...(current ?? {}),
      id: current?.id ?? makeLincolnId('REN'),
      code: current?.code ?? nextLincolnCode('REN', state.eventSettlements),
      eventId: event.id,
      eventCode: event.code ?? '',
      status: requestedStatus,
      notes: String(payload?.notes ?? current?.notes ?? '').trim(),
      createdAt: current?.createdAt ?? changedAt,
      createdById: current?.createdById ?? (String(actor?.id ?? '').trim() || null),
      createdByName: current?.createdByName ?? (String(actor?.name ?? '').trim() || null),
      updatedAt: changedAt,
      updatedById: String(actor?.id ?? '').trim() || null,
      updatedByName: String(actor?.name ?? '').trim() || null,
      closedAt: requestedStatus === 'closed' ? changedAt : null,
      closedById: requestedStatus === 'closed' ? String(actor?.id ?? '').trim() || null : null,
      closedByName: requestedStatus === 'closed' ? String(actor?.name ?? '').trim() || null : null,
    };
    if (existingIndex >= 0) state.eventSettlements[existingIndex] = settlement;
    else state.eventSettlements.unshift(settlement);
    appendLincolnAudit(state, {
      action: requestedStatus === 'closed' ? 'settlements.close' : 'settlements.reopen',
      entityType: 'eventSettlements',
      entityId: settlement.id,
      entityCode: settlement.code,
      eventId: event.id,
      actorId: String(actor?.id ?? '').trim() || null,
      actorName: String(actor?.name ?? '').trim() || null,
    });
    return { settlement };
  });

export const getLincolnStateStoreInfo = () => ({ storage: 'file', stateFilePath });
