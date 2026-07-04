import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_COMPANY_CODE = 'COPETIN';
export const SECONDARY_COMPANY_CODE = 'SECONDARY';

export const PERMISSIONS = [
  'companies.view',
  'companies.switch',
  'users.view',
  'users.create',
  'users.update',
  'roles.manage',
  'clients.view',
  'clients.create',
  'clients.update',
  'contracts.view',
  'contracts.create',
  'contracts.update',
  'contracts.approve',
  'inventory.view',
  'inventory.adjust',
  'cash.view',
  'cash.open',
  'cash.close',
  'attendance.view',
  'attendance.register',
  'attendance.update',
  'calendar.view',
  'calendar.update',
  'reports.view',
  'reports.export',
  'system.reset',
  'system.audit',
];

export const ROLES = [
  { code: 'developer', name: 'Developer', permissions: PERMISSIONS },
  { code: 'superadmin', name: 'Super admin', permissions: PERMISSIONS.filter((code) => code !== 'system.reset') },
  { code: 'administrator', name: 'Administrador', permissions: PERMISSIONS.filter((code) => !code.startsWith('system.')) },
  { code: 'cashier', name: 'Caja', permissions: ['cash.view', 'cash.open', 'cash.close', 'reports.view'] },
  { code: 'inventory', name: 'Inventario', permissions: ['inventory.view', 'inventory.adjust', 'reports.view'] },
  { code: 'transport', name: 'Transporte', permissions: ['deliveries.view', 'calendar.view'] },
  { code: 'attendance', name: 'Asistencia', permissions: ['attendance.view', 'attendance.register'] },
  { code: 'viewer', name: 'Lectura', permissions: ['clients.view', 'contracts.view', 'inventory.view', 'reports.view'] },
];

const COLLECTION_MODEL_MAP = {
  clients: 'client',
  categories: 'category',
  items: 'item',
  inventoryCombos: 'inventoryCombo',
  inventoryMovements: 'inventoryMovement',
  stockRecoveries: 'stockRecovery',
  suppliers: 'supplier',
  supplierQuotes: 'supplierQuote',
  contracts: 'contract',
  quotes: 'quote',
  rentals: 'rental',
  deliveries: 'delivery',
  transportRoutes: 'transportRoute',
  vehicles: 'vehicle',
  drivers: 'driver',
  cashSessions: 'cashSession',
  cashMovements: 'cashMovement',
  cashDebts: 'cashDebt',
  personnelEmployees: 'personnelEmployee',
  attendanceRecords: 'attendanceRecord',
  personnelAttendance: 'personnelAttendance',
  personnelIncidents: 'personnelIncident',
  calendarEvents: 'calendarEvent',
  calendarBoardNotes: 'calendarBoardNote',
  generatedReports: 'generatedReport',
  resetLogs: 'resetLog',
};

export const COLLECTIONS = Object.keys(COLLECTION_MODEL_MAP);

export const readArgument = (argv, name) => {
  const direct = argv.find((entry) => entry.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : '';
};

export const loadJsonState = (stateFile) => {
  const raw = fs.readFileSync(stateFile, 'utf8');
  const root = JSON.parse(raw);
  const state = root?.state && typeof root.state === 'object' && !Array.isArray(root.state) ? root.state : root;
  return { raw, root, state };
};

export const ensureReportDir = (reportDir) => {
  fs.mkdirSync(reportDir, { recursive: true });
};

export const stableId = (...parts) =>
  crypto.createHash('sha1').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex').slice(0, 24);

export const collectionCount = (state, collection) =>
  Array.isArray(state[collection]) ? state[collection].length : 0;

export const parseDate = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00.000Z`);
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
};

export const decimalString = (value, fallback = null) => {
  if (value === null || typeof value === 'undefined' || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : fallback;
};

export const intValue = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
};

export const cleanText = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

export const mapStatus = (value, fallback = 'active') => {
  const status = cleanText(value).toLowerCase();
  if (['borrador', 'draft'].includes(status)) return 'draft';
  if (['pendiente', 'pending', 'enviado', 'enviada'].includes(status)) return 'pending';
  if (['activo', 'activa', 'active', 'vigente'].includes(status)) return 'active';
  if (['aprobado', 'aprobada', 'approved', 'validado'].includes(status)) return 'approved';
  if (['rechazado', 'rechazada', 'rejected'].includes(status)) return 'rejected';
  if (['anulado', 'anulada', 'cancelado', 'cancelada', 'cancelled'].includes(status)) return 'cancelled';
  if (['completado', 'completada', 'completed', 'cerrado', 'cerrada', 'devuelto'].includes(status)) return 'completed';
  if (['archivado', 'archived'].includes(status)) return 'archived';
  return fallback;
};

export const mapUserStatus = (value) => {
  const status = cleanText(value).toLowerCase();
  if (['suspended', 'suspendido', 'suspendida'].includes(status)) return 'suspended';
  if (['inactive', 'inactivo', 'inactiva'].includes(status)) return 'inactive';
  return 'active';
};

const hasId = (state, collection, id) =>
  Boolean(id) && Array.isArray(state[collection]) && state[collection].some((row) => String(row?.id ?? '') === String(id));

const itemRows = (parent, field = 'items') =>
  Array.isArray(parent?.[field]) ? parent[field] : [];

const makeLineId = (prefix, parentId, line, index) =>
  cleanText(line?.id) || stableId(prefix, parentId, index, line?.itemId, line?.itemName, line?.description);

const fileIdForUrl = (companyCode, url) => stableId('file', companyCode, url);

const addUploadedFile = (plan, companyId, row, category, url, extra = {}) => {
  const cleanUrl = cleanText(url);
  if (!cleanUrl || cleanUrl.startsWith('data:')) return;
  plan.uploadedFile.push({
    id: fileIdForUrl(companyId, cleanUrl),
    companyId,
    category,
    url: cleanUrl,
    storagePath: cleanUrl.startsWith('/uploads/') ? cleanUrl.replace(/^\/+/, '') : null,
    mimeType: cleanText(extra.mimeType) || null,
    sizeBytes: extra.sizeBytes ? intValue(extra.sizeBytes, null) : null,
    checksum: null,
    uploadedById: null,
    legacyData: { sourceId: row?.id ?? null },
  });
};

export const buildMigrationPlan = (state, { companyCode = DEFAULT_COMPANY_CODE } = {}) => {
  const warnings = [];
  const plan = {
    company: [
      {
        id: companyCode,
        code: companyCode,
        name: 'El Copetin',
        legalName: 'El Copetin',
        taxId: null,
        status: 'active',
        settings: state.settings ?? {},
      },
      {
        id: SECONDARY_COMPANY_CODE,
        code: SECONDARY_COMPANY_CODE,
        name: 'Empresa secundaria',
        legalName: null,
        taxId: null,
        status: 'inactive',
        settings: {},
      },
    ],
    permission: PERMISSIONS.map((code) => ({ id: code, code, description: code })),
    role: ROLES.map((role) => ({
      id: `global:${role.code}`,
      code: role.code,
      name: role.name,
      companyId: null,
      description: null,
    })),
    rolePermission: ROLES.flatMap((role) =>
      role.permissions
        .filter((permission) => PERMISSIONS.includes(permission))
        .map((permission) => ({ roleId: `global:${role.code}`, permissionId: permission }))),
    user: [],
    userCompany: [],
    companySettings: [],
    uploadedFile: [],
  };

  Object.values(COLLECTION_MODEL_MAP).forEach((model) => {
    plan[model] = [];
  });
  plan.inventoryComboItem = [];
  plan.supplierQuoteItem = [];
  plan.contractItem = [];
  plan.quoteItem = [];
  plan.rentalItem = [];
  plan.transportRouteStop = [];

  (state.users ?? []).forEach((user) => {
    const id = cleanText(user?.id);
    if (!id) return;
    const roleCode = cleanText(user?.roleId || user?.roleIds?.[0], 'viewer');
    plan.user.push({
      id,
      username: cleanText(user?.username, id),
      email: cleanText(user?.email) || null,
      displayName: cleanText(user?.fullName || user?.name || user?.username, 'Usuario'),
      passwordHash: cleanText(user?.passwordHash) || null,
      status: mapUserStatus(user?.status),
      lastAccessAt: parseDate(user?.lastAccessAt),
      createdAt: parseDate(user?.createdAt) ?? new Date(),
      updatedAt: parseDate(user?.updatedAt) ?? parseDate(user?.createdAt) ?? new Date(),
      deletedAt: parseDate(user?.deletedAt),
      legacyData: { ...user, isCurrentUser: undefined },
    });
    plan.userCompany.push({
      userId: id,
      companyId: companyCode,
      roleId: `global:${roleCode}`,
      status: mapUserStatus(user?.status),
      isDefault: true,
    });
  });

  plan.companySettings.push({
    id: `${companyCode}:settings`,
    companyId: companyCode,
    settings: state.settings ?? {},
  });

  (state.clients ?? []).forEach((row) => {
    plan.client.push({
      id: cleanText(row.id),
      companyId: companyCode,
      code: cleanText(row.code) || null,
      name: cleanText(row.name || row.fullName || row.customerName, 'Cliente'),
      phone: cleanText(row.phone || row.mobile) || null,
      ci: cleanText(row.ci || row.documentId) || null,
      email: cleanText(row.email) || null,
      address: cleanText(row.address) || null,
      status: mapStatus(row.status),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt) ?? parseDate(row.createdAt) ?? new Date(),
      deletedAt: parseDate(row.deletedAt),
      legacyData: row,
    });
  });

  (state.categories ?? []).forEach((row) => {
    plan.category.push({
      id: cleanText(row.id),
      companyId: companyCode,
      name: cleanText(row.name || row.label, 'Categoria'),
      type: cleanText(row.type) || null,
      status: mapStatus(row.status),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt) ?? parseDate(row.createdAt) ?? new Date(),
      deletedAt: parseDate(row.deletedAt),
      legacyData: row,
    });
  });

  (state.items ?? []).forEach((row) => {
    const categoryId = hasId(state, 'categories', row.categoryId) ? cleanText(row.categoryId) : null;
    if (row.categoryId && !categoryId) warnings.push({ collection: 'items', id: row.id, field: 'categoryId', value: row.categoryId });
    plan.item.push({
      id: cleanText(row.id),
      companyId: companyCode,
      categoryId,
      code: cleanText(row.code || row.sku) || null,
      name: cleanText(row.name || row.itemName, 'Item'),
      description: cleanText(row.description || row.notes) || null,
      color: cleanText(row.color) || null,
      material: cleanText(row.material) || null,
      unitPriceBs: decimalString(row.rentalPriceBs ?? row.unitPriceBs ?? row.priceBs),
      stock: row.stock !== undefined ? intValue(row.stock) : null,
      imageUrl: cleanText(row.imageUrl) || null,
      status: mapStatus(row.status),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt) ?? parseDate(row.createdAt) ?? new Date(),
      deletedAt: parseDate(row.deletedAt),
      legacyData: row,
    });
    addUploadedFile(plan, companyCode, row, 'product', row.imageUrl);
  });

  (state.inventoryCombos ?? []).forEach((row) => {
    plan.inventoryCombo.push({
      id: cleanText(row.id),
      companyId: companyCode,
      name: cleanText(row.name, 'Combo'),
      description: cleanText(row.description || row.notes) || null,
      priceBs: decimalString(row.rentalPriceBs ?? row.priceBs),
      status: mapStatus(row.status),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt) ?? parseDate(row.createdAt) ?? new Date(),
      deletedAt: parseDate(row.deletedAt),
      legacyData: row,
    });
    addUploadedFile(plan, companyCode, row, 'product', row.imageUrl);
    itemRows(row, 'ingredients').forEach((line, index) => {
      const itemId = hasId(state, 'items', line.itemId) ? cleanText(line.itemId) : null;
      if (!itemId) return;
      plan.inventoryComboItem.push({
        id: makeLineId('combo', row.id, line, index),
        comboId: cleanText(row.id),
        itemId,
        quantity: intValue(line.quantity, 1),
        legacyData: line,
      });
    });
  });

  (state.inventoryMovements ?? []).forEach((row) => {
    plan.inventoryMovement.push({
      id: cleanText(row.id),
      companyId: companyCode,
      itemId: hasId(state, 'items', row.itemId) ? cleanText(row.itemId) : null,
      type: cleanText(row.type, 'movement'),
      quantity: intValue(row.quantity ?? row.qty, 0),
      amountBs: decimalString(row.amountBs ?? row.totalBs),
      reason: cleanText(row.reason || row.notes) || null,
      referenceId: cleanText(row.referenceId || row.sourceId) || null,
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt) ?? parseDate(row.createdAt) ?? new Date(),
      legacyData: row,
    });
  });

  (state.stockRecoveries ?? []).forEach((row) => {
    plan.stockRecovery.push({
      id: cleanText(row.id),
      companyId: companyCode,
      status: mapStatus(row.status, 'pending'),
      totalBs: decimalString(row.totalBs),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt) ?? parseDate(row.createdAt) ?? new Date(),
      legacyData: row,
    });
  });

  (state.suppliers ?? []).forEach((row) => {
    plan.supplier.push({
      id: cleanText(row.id),
      companyId: companyCode,
      name: cleanText(row.name, 'Proveedor'),
      phone: cleanText(row.phone) || null,
      email: cleanText(row.email) || null,
      status: mapStatus(row.status),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt) ?? parseDate(row.createdAt) ?? new Date(),
      deletedAt: parseDate(row.deletedAt),
      legacyData: row,
    });
  });

  (state.supplierQuotes ?? []).forEach((row) => {
    plan.supplierQuote.push({
      id: cleanText(row.id),
      companyId: companyCode,
      supplierId: hasId(state, 'suppliers', row.supplierId) ? cleanText(row.supplierId) : null,
      status: mapStatus(row.status, 'pending'),
      totalBs: decimalString(row.totals?.totalBs ?? row.totalBs),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt) ?? parseDate(row.createdAt) ?? new Date(),
      legacyData: row,
    });
    itemRows(row).forEach((line, index) => {
      plan.supplierQuoteItem.push({
        id: makeLineId('supplierQuote', row.id, line, index),
        supplierQuoteId: cleanText(row.id),
        description: cleanText(line.description || line.itemName, 'Item'),
        quantity: intValue(line.quantity, 1),
        unitPriceBs: decimalString(line.unitPriceBs),
        subtotalBs: decimalString(line.lineTotalBs ?? line.subtotalBs),
        legacyData: line,
      });
    });
  });

  const addCommercialDocument = (collection, target, itemTarget, row, index) => {
    const id = cleanText(row.id) || stableId(collection, index);
    const clientId = hasId(state, 'clients', row.clientId) ? cleanText(row.clientId) : null;
    const common = {
      id,
      companyId: companyCode,
      clientId,
      status: mapStatus(row.status, collection === 'quotes' ? 'draft' : 'pending'),
      eventType: cleanText(row.eventType) || null,
      eventDate: parseDate(row.eventDate),
      totalBs: decimalString(row.totals?.totalBs ?? row.totalBs),
      createdAt: parseDate(row.createdAt ?? row.contractDate) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt ?? row.contractDate) ?? new Date(),
      deletedAt: parseDate(row.deletedAt),
      legacyData: row,
    };
    if (collection === 'contracts') {
      plan[target].push({ ...common, number: cleanText(row.contractCode || row.number) || null, balanceBs: decimalString(row.payment?.pendingBs ?? row.balanceBs) });
    } else if (collection === 'quotes') {
      plan[target].push({ ...common, code: cleanText(row.quoteCode || row.code) || null });
    }
    itemRows(row).forEach((line, lineIndex) => {
      plan[itemTarget].push({
        id: makeLineId(collection, id, line, lineIndex),
        [`${target}Id`]: id,
        itemId: hasId(state, 'items', line.itemId) ? cleanText(line.itemId) : null,
        description: cleanText(line.description || line.itemName, 'Item'),
        quantity: intValue(line.quantity, 1),
        unitPriceBs: decimalString(line.unitPriceBs ?? line.rentalPriceBs),
        subtotalBs: decimalString(line.lineTotalBs ?? line.subtotalBs),
        legacyData: line,
      });
    });
  };

  (state.contracts ?? []).forEach((row, index) => addCommercialDocument('contracts', 'contract', 'contractItem', row, index));
  (state.quotes ?? []).forEach((row, index) => addCommercialDocument('quotes', 'quote', 'quoteItem', row, index));

  (state.rentals ?? []).forEach((row, index) => {
    const id = cleanText(row.id) || stableId('rental', index);
    plan.rental.push({
      id,
      companyId: companyCode,
      clientId: hasId(state, 'clients', row.clientId) ? cleanText(row.clientId) : null,
      status: mapStatus(row.status),
      startDate: parseDate(row.rentalDate ?? row.rentalAt),
      endDate: parseDate(row.dueDate ?? row.dueAt),
      totalBs: decimalString(row.totals?.totalBs ?? row.totalBs ?? row.payment?.totalBs),
      balanceBs: decimalString(row.payment?.pendingBs ?? row.balanceBs),
      createdAt: parseDate(row.createdAt ?? row.rentalAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt ?? row.rentalAt) ?? new Date(),
      deletedAt: parseDate(row.deletedAt),
      legacyData: row,
    });
    itemRows(row).forEach((line, lineIndex) => {
      plan.rentalItem.push({
        id: makeLineId('rental', id, line, lineIndex),
        rentalId: id,
        itemId: hasId(state, 'items', line.itemId) ? cleanText(line.itemId) : null,
        description: cleanText(line.description || line.itemName, 'Item'),
        quantity: intValue(line.quantity, 1),
        unitPriceBs: decimalString(line.unitPriceBs ?? line.rentalPriceBs),
        subtotalBs: decimalString(line.lineTotalBs ?? line.subtotalBs),
        legacyData: line,
      });
    });
  });

  (state.deliveries ?? []).forEach((row) => {
    plan.delivery.push({
      id: cleanText(row.id),
      companyId: companyCode,
      status: mapStatus(row.status, 'pending'),
      scheduledAt: parseDate(row.scheduledAt ?? row.deliveryAt ?? row.date),
      completedAt: parseDate(row.completedAt),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt) ?? new Date(),
      legacyData: row,
    });
  });

  (state.transportRoutes ?? []).forEach((row) => {
    const routeId = cleanText(row.id);
    plan.transportRoute.push({
      id: routeId,
      companyId: companyCode,
      name: cleanText(row.name || row.code) || null,
      status: mapStatus(row.status, 'pending'),
      routeDate: parseDate(row.routeDate ?? row.date),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt) ?? new Date(),
      legacyData: row,
    });
    itemRows(row, 'stops').forEach((stop, index) => {
      plan.transportRouteStop.push({
        id: makeLineId('routeStop', routeId, stop, index),
        routeId,
        sortOrder: index,
        address: cleanText(stop.address || stop.location) || null,
        legacyData: stop,
      });
    });
  });

  (state.vehicles ?? []).forEach((row) => {
    plan.vehicle.push({
      id: cleanText(row.id),
      companyId: companyCode,
      plate: cleanText(row.plate) || null,
      name: cleanText(row.name || row.label) || null,
      status: mapStatus(row.status),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt) ?? new Date(),
      deletedAt: parseDate(row.deletedAt),
      legacyData: row,
    });
  });

  (state.drivers ?? []).forEach((row) => {
    plan.driver.push({
      id: cleanText(row.id),
      companyId: companyCode,
      name: cleanText(row.name, 'Conductor'),
      phone: cleanText(row.phone) || null,
      status: mapStatus(row.status),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt) ?? new Date(),
      deletedAt: parseDate(row.deletedAt),
      legacyData: row,
    });
  });

  (state.cashSessions ?? []).forEach((row) => {
    plan.cashSession.push({
      id: cleanText(row.id),
      companyId: companyCode,
      status: cleanText(row.status, 'open'),
      openedAt: parseDate(row.openedAt ?? row.createdAt),
      closedAt: parseDate(row.closedAt),
      openingBigCashBs: decimalString(row.openingBigCashBs),
      openingPettyCashBs: decimalString(row.openingPettyCashBs),
      createdAt: parseDate(row.createdAt ?? row.openedAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt ?? row.openedAt) ?? new Date(),
      legacyData: row,
    });
  });

  (state.cashMovements ?? []).forEach((row) => {
    plan.cashMovement.push({
      id: cleanText(row.id),
      companyId: companyCode,
      sessionId: hasId(state, 'cashSessions', row.sessionId) ? cleanText(row.sessionId) : null,
      type: cleanText(row.type, 'movement'),
      cashBoxType: cleanText(row.cashBoxType) || null,
      amountBs: decimalString(row.amountBs, '0.00'),
      description: cleanText(row.description) || null,
      sourceType: cleanText(row.sourceType) || null,
      sourceId: cleanText(row.sourceId) || null,
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt) ?? new Date(),
      legacyData: row,
    });
  });

  (state.cashDebts ?? []).forEach((row) => {
    plan.cashDebt.push({
      id: cleanText(row.id),
      companyId: companyCode,
      description: cleanText(row.description, 'Deuda'),
      amountBs: decimalString(row.amountBs, '0.00'),
      status: mapStatus(row.status, 'pending'),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt) ?? new Date(),
      legacyData: row,
    });
  });

  (state.personnelEmployees ?? []).forEach((row) => {
    plan.personnelEmployee.push({
      id: cleanText(row.id),
      companyId: companyCode,
      name: cleanText(row.name || row.fullName, 'Empleado'),
      phone: cleanText(row.phone) || null,
      role: cleanText(row.role || row.position) || null,
      status: mapStatus(row.status),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt) ?? new Date(),
      deletedAt: parseDate(row.deletedAt),
      legacyData: row,
    });
  });

  (state.attendanceRecords ?? []).forEach((row) => {
    plan.attendanceRecord.push({
      id: cleanText(row.id),
      companyId: companyCode,
      userId: cleanText(row.userId) || null,
      userName: cleanText(row.userName) || null,
      type: cleanText(row.type, 'entrada'),
      location: cleanText(row.location, 'Sin ubicacion'),
      reason: cleanText(row.reason) || null,
      photoUrl: cleanText(row.photoUrl) || null,
      photoMimeType: cleanText(row.photoMimeType) || null,
      photoSizeBytes: row.photoSizeBytes ? intValue(row.photoSizeBytes, null) : null,
      capturedAt: parseDate(row.capturedAt ?? row.createdAt) ?? new Date(),
      createdAt: parseDate(row.createdAt ?? row.capturedAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt ?? row.capturedAt) ?? new Date(),
      legacyData: row,
    });
    addUploadedFile(plan, companyCode, row, 'attendance', row.photoUrl, {
      mimeType: row.photoMimeType,
      sizeBytes: row.photoSizeBytes,
    });
  });

  (state.personnelAttendance ?? []).forEach((row) => {
    plan.personnelAttendance.push({
      id: cleanText(row.id),
      companyId: companyCode,
      employeeId: hasId(state, 'personnelEmployees', row.employeeId) ? cleanText(row.employeeId) : null,
      type: cleanText(row.type) || null,
      checkedAt: parseDate(row.checkedAt ?? row.date),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt) ?? new Date(),
      legacyData: row,
    });
  });

  (state.personnelIncidents ?? []).forEach((row) => {
    plan.personnelIncident.push({
      id: cleanText(row.id),
      companyId: companyCode,
      employeeId: hasId(state, 'personnelEmployees', row.employeeId) ? cleanText(row.employeeId) : null,
      type: cleanText(row.type) || null,
      status: mapStatus(row.status, 'pending'),
      occurredAt: parseDate(row.occurredAt ?? row.date),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt) ?? new Date(),
      legacyData: row,
    });
  });

  (state.calendarEvents ?? []).forEach((row) => {
    plan.calendarEvent.push({
      id: cleanText(row.id),
      companyId: companyCode,
      title: cleanText(row.title || row.name, 'Evento'),
      startAt: parseDate(row.startAt ?? row.date),
      endAt: parseDate(row.endAt),
      status: mapStatus(row.status),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt) ?? new Date(),
      legacyData: row,
    });
  });

  (state.calendarBoardNotes ?? []).forEach((row) => {
    plan.calendarBoardNote.push({
      id: cleanText(row.id),
      companyId: companyCode,
      title: cleanText(row.title) || null,
      content: cleanText(row.content || row.note) || null,
      noteDate: parseDate(row.noteDate ?? row.date),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt) ?? new Date(),
      legacyData: row,
    });
  });

  (state.generatedReports ?? []).forEach((row) => {
    plan.generatedReport.push({
      id: cleanText(row.id),
      companyId: companyCode,
      type: cleanText(row.type) || null,
      title: cleanText(row.title || row.name) || null,
      url: cleanText(row.url || row.fileUrl) || null,
      createdAt: parseDate(row.createdAt) ?? new Date(),
      updatedAt: parseDate(row.updatedAt ?? row.createdAt) ?? new Date(),
      legacyData: row,
    });
    addUploadedFile(plan, companyCode, row, 'report', row.url || row.fileUrl);
  });

  (state.resetLogs ?? []).forEach((row) => {
    plan.resetLog.push({
      id: cleanText(row.id),
      companyId: companyCode,
      userId: hasId(state, 'users', row.userId) ? cleanText(row.userId) : null,
      action: cleanText(row.action, 'reset_log'),
      createdAt: parseDate(row.createdAt) ?? new Date(),
      legacyData: row,
    });
  });

  return { plan, warnings };
};

export const planCounts = (plan) =>
  Object.fromEntries(Object.entries(plan).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0]));

export const expectedCollectionCounts = (state) =>
  Object.fromEntries(COLLECTIONS.map((collection) => [collection, collectionCount(state, collection)]));

export const writeJsonReport = (reportDir, filename, payload) => {
  ensureReportDir(reportDir);
  fs.writeFileSync(path.join(reportDir, filename), `${JSON.stringify(payload, null, 2)}\n`);
};

export const writeMarkdownReport = (reportDir, filename, lines) => {
  ensureReportDir(reportDir);
  fs.writeFileSync(path.join(reportDir, filename), `${lines.join('\n')}\n`);
};
