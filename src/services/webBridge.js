import { buildAvailabilityPeriod, getProjectedInventoryAvailability, validateProjectedInventoryRequest } from '../utils/availability.js';
import { normalizeInventoryArea, resolveInventoryArea } from '../utils/inventoryArea.js';

export const WEB_DB_STORAGE_KEY = 'prestamos-web-db-v3-empty';
const WEB_SESSION_STORAGE_KEY = 'prestamos-auth-session-v1';
const WEB_LEGACY_SESSION_STORAGE_KEY = 'prestamos-auth-session-v1';
const LOCAL_STORAGE_SAFE_STATE_BYTES = 3.5 * 1024 * 1024;
const RESET_SECURITY_CODE = '1703';
const PRESENCE_TTL_MS = 90 * 1000;
const SESSION_TTL_MS = 10 * 60 * 60 * 1000;
const USER_COLORS = ['#df3f05', '#2563eb', '#16a34a', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#dc2626'];

const ROLE_DEFINITIONS = {
  developer: {
    label: 'Developer',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'items', 'alquiler', 'disponibilidad', 'asistencia', 'proveedores', 'personal', 'inventario', 'devolucion', 'caja', 'recibos', 'usuarios', 'categorias', 'contabilidad'],
  },
  super_admin: {
    label: 'Super admin',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'items', 'alquiler', 'disponibilidad', 'asistencia', 'proveedores', 'personal', 'inventario', 'devolucion', 'caja', 'recibos', 'categorias'],
  },
  admin: {
    label: 'Admin',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'items', 'alquiler', 'disponibilidad', 'asistencia', 'proveedores', 'personal', 'inventario', 'devolucion', 'caja', 'recibos', 'categorias', 'contabilidad'],
  },
  user: {
    label: 'User',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'items', 'alquiler', 'disponibilidad', 'asistencia', 'caja'],
  },
  ventas: {
    label: 'Ventas',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'items', 'alquiler', 'disponibilidad', 'asistencia', 'proveedores', 'caja'],
  },
  inventario: {
    label: 'Inventario',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'disponibilidad', 'asistencia', 'caja', 'inventario'],
  },
  transporte: {
    label: 'Transporte',
    defaultTab: 'caja',
    allowedTabs: ['resumen', 'asistencia', 'devolucion', 'caja'],
  },
  contabilidad: {
    label: 'Contabilidad',
    defaultTab: 'contabilidad',
    allowedTabs: ['resumen', 'asistencia', 'personal', 'devolucion', 'contabilidad', 'recibos', 'caja'],
  },
};

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const getInventoryLineKey = (line, index = 0) => String(
  line?.lineKey
  ?? line?.returnLineKey
  ?? `${line?.comboLineKey || 'item'}-${line?.itemId || 'sin-item'}-${line?.comboRuleIndex ?? index}-${index}`,
).trim();

const rentalAffectsCurrentStock = (rental, todayKey = toDateKey(new Date())) => {
  if (!rental || rental.deletedAt || rental.cancelledAt || rental.returnedAt) return false;
  const status = normalizeRentalStatus(rental?.status);
  if (!['active', 'confirmed', 'pending'].includes(status)) return false;
  const inventoryStatus = normalizeText(rental?.operational?.inventoryStatus ?? '');
  if (inventoryStatus === 'devuelto' || inventoryStatus === 'anulado') return false;
  if (inventoryStatus === 'salio') return true;
  const startKey = toDateKey(rental?.rentalDate ?? rental?.deliveryDate);
  const endKey = toDateKey(rental?.dueDate ?? rental?.pickupDate ?? startKey);
  return Boolean(startKey && todayKey >= startKey && (!endKey || todayKey <= endKey));
};

const getActiveReservedStockForItem = (state, itemId) => {
  const requestedItemId = String(itemId ?? '').trim();
  if (!requestedItemId) return 0;

  const todayKey = toDateKey(new Date());
  return (Array.isArray(state?.rentals) ? state.rentals : [])
    .filter((rental) => rentalAffectsCurrentStock(rental, todayKey))
    .reduce((total, rental) => total + (Array.isArray(rental?.items) ? rental.items : [])
      .filter((line) => String(line?.itemId ?? '').trim() === requestedItemId)
      .reduce((lineTotal, line) => {
        if (line?.controlsStock === false) return lineTotal;
        const quantity = Math.max(0, Math.trunc(Number(line?.quantity ?? 0)));
        const supplierBackedQty = Math.max(0, Math.trunc(Number(line?.supplierBackedQty ?? 0)));
        const hasStoredReservedQty = line?.internalReservedQty !== undefined
          && line?.internalReservedQty !== null
          && line?.internalReservedQty !== '';
        const reservedQty = hasStoredReservedQty
          ? Math.max(0, Math.trunc(Number(line.internalReservedQty ?? 0)))
          : Math.max(0, quantity - supplierBackedQty);
        return lineTotal + reservedQty;
      }, 0), 0);
};

const getRecoveryStockForItem = (state, itemId) => {
  const requestedItemId = String(itemId ?? '').trim();
  if (!requestedItemId) return 0;
  return (Array.isArray(state?.stockRecoveries) ? state.stockRecoveries : [])
    .filter((entry) => String(entry?.itemId ?? '').trim() === requestedItemId)
    .reduce((total, entry) => total + Math.max(0, Math.trunc(Number(entry?.quantity ?? 0))), 0);
};

const getInventoryStockCommitment = (state, itemId) => {
  const reservedStock = getActiveReservedStockForItem(state, itemId);
  const recoveryStock = getRecoveryStockForItem(state, itemId);
  return {
    reservedStock,
    recoveryStock,
    minimumPhysicalStock: reservedStock + recoveryStock,
  };
};

const buildDocumentFileBase = (customerName, documentCode, fallback = 'copetin') => {
  const cleanFilePart = (value) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[<>:"/\\|?*]+/g, ' ')
      .replace(/[^a-zA-Z0-9 _-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const customer = cleanFilePart(customerName).split(' ').filter(Boolean).slice(0, 2).join(' ');
  const code = cleanFilePart(documentCode);
  return [customer, code].filter(Boolean).join(' ').toUpperCase() || cleanFilePart(fallback).toUpperCase() || 'COPETIN';
};

const toBusinessUppercase = (value) =>
  String(value ?? '').trim().toLocaleUpperCase('es-BO');

const normalizeComboRule = (line, inventoryItems = []) => {
  // Un producto eliminado no puede seguir formando parte de un combo. Antes se
  // conservaba como ingrediente fantasma: aparecía en contratos, pero no en el
  // editor porque el catálogo visible ya lo había filtrado.
  const activeInventoryItems = (Array.isArray(inventoryItems) ? inventoryItems : [])
    .filter((item) => item && !item.deletedAt && String(item.status ?? 'active') !== 'deleted');
  const itemById = new Map(activeInventoryItems.map((item) => [String(item.id), item]));
  const requestedMode = String(line?.selectionMode ?? '').trim();
  const selectionMode = ['item', 'options', 'category'].includes(requestedMode) ? requestedMode : 'item';
  const category = toBusinessUppercase(line?.category ?? '');
  const requestedOptionIds = Array.isArray(line?.optionItemIds)
    ? line.optionItemIds.map((id) => String(id ?? '').trim()).filter(Boolean)
    : [];
  const categoryOptionIds = selectionMode === 'category'
    ? activeInventoryItems
      .filter((item) => normalizeText(item.category) === normalizeText(category))
      .map((item) => String(item.id))
    : [];
  const optionItemIds = [...new Set(
    (selectionMode === 'category' ? categoryOptionIds : requestedOptionIds)
      .filter((id) => itemById.has(id)),
  )];
  const requestedItemId = String(line?.itemId ?? '').trim();
  const itemId = optionItemIds.includes(requestedItemId)
    ? requestedItemId
    : optionItemIds[0] ?? (itemById.has(requestedItemId) ? requestedItemId : '');
  const item = itemById.get(itemId);
  const quantity = Math.max(1, Math.trunc(Number(line?.quantity ?? 1)));
  if (!item || quantity <= 0) return null;
  const controlsStock =
    item.controlsStock !== false
    && String(item.verificationStatus ?? '').trim() !== 'pending_verification'
    && Number(item.totalStock ?? 0) > 0;
  return {
    itemId: item.id,
    itemName: item.name,
    quantity,
    selectionMode: selectionMode === 'item' && optionItemIds.length > 1 ? 'options' : selectionMode,
    optionItemIds: optionItemIds.length > 0 ? optionItemIds : [item.id],
    category: selectionMode === 'category' ? category : '',
    slotLabel: toBusinessUppercase(line?.slotLabel ?? item.name),
    unitPriceBs: Math.max(0, Number(item.rentalPriceBs ?? 0)),
    controlsStock,
    verificationStatus: controlsStock ? 'verified' : 'pending_verification',
  };
};

const getComboIngredientSignature = (line) => {
  const optionIds = Array.isArray(line?.optionItemIds) && line.optionItemIds.length > 0
    ? line.optionItemIds
    : [line?.itemId];
  const optionKey = [...new Set(optionIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
    .sort()
    .join('|');
  const categoryKey = normalizeText(line?.category ?? '');
  const labelKey = normalizeText(line?.slotLabel ?? '');
  return [
    normalizeText(line?.selectionMode ?? 'item'),
    categoryKey,
    optionKey,
    categoryKey ? '' : labelKey,
  ].join('::');
};

const dedupeComboIngredients = (ingredients = []) => {
  const bySignature = new Map();
  (Array.isArray(ingredients) ? ingredients : []).forEach((line) => {
    if (!line) return;
    const signature = getComboIngredientSignature(line);
    if (!signature.trim()) return;
    if (!bySignature.has(signature)) {
      bySignature.set(signature, line);
      return;
    }
    const current = bySignature.get(signature);
    const currentQuantity = Math.max(1, Math.trunc(Number(current?.quantity ?? 1)));
    const nextQuantity = Math.max(1, Math.trunc(Number(line?.quantity ?? 1)));
    bySignature.set(signature, {
      ...current,
      quantity: Math.max(currentQuantity, nextQuantity),
    });
  });
  return [...bySignature.values()];
};

const normalizeComboPricingCondition = (condition) => {
  const enabled = Boolean(condition?.enabled);
  const upToQuantity = Math.max(1, Math.trunc(Number(condition?.upToQuantity ?? 3)));
  const upToUnitPriceBs = Math.max(0, toPositiveRoundedNumber(condition?.upToUnitPriceBs ?? 0));
  const aboveUnitPriceBs = Math.max(0, toPositiveRoundedNumber(condition?.aboveUnitPriceBs ?? 0));
  return {
    enabled: enabled && upToUnitPriceBs >= 0 && aboveUnitPriceBs >= 0,
    upToQuantity,
    upToUnitPriceBs,
    aboveUnitPriceBs,
  };
};

const BUSINESS_UPPERCASE_KEYS = new Set([
  'name',
  'fullName',
  'companyName',
  'contactName',
  'contactRole',
  'businessName',
  'customerName',
  'supplierName',
  'providerName',
  'driverName',
  'vehicleName',
  'itemName',
  'category',
  'brand',
  'itemColor',
  'colorDescription',
  'color',
  'material',
  'sku',
  'title',
  'description',
  'detail',
  'concept',
  'reason',
  'reference',
  'observations',
  'notes',
  'note',
  'blacklistNotes',
  'address',
  'city',
  'deliveryAddress',
  'returnAddress',
  'serviceAddress',
  'destination',
  'eventName',
  'eventType',
  'routeName',
  'department',
  'position',
  'conditions',
]);

const normalizeBusinessTextInState = (value, key = '') => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeBusinessTextInState(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeBusinessTextInState(entryValue, entryKey),
      ]),
    );
  }
  if (typeof value === 'string' && BUSINESS_UPPERCASE_KEYS.has(key)) {
    return toBusinessUppercase(value);
  }
  return value;
};

const normalizeRoleId = (role) => {
  const normalized = normalizeText(role).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (normalized === 'developer' || normalized === 'dev' || normalized.includes('desarrollador')) return 'developer';
  if (normalized === 'super_admin' || normalized === 'superadmin' || normalized.includes('super')) return 'super_admin';
  if (normalized === 'admin' || normalized === 'administrador') return 'admin';
  if (normalized === 'user' || normalized === 'usuario') return 'user';
  if (normalized.includes('invent')) return 'inventario';
  if (normalized.includes('venta') || normalized.includes('comercial')) return 'ventas';
  if (normalized.includes('trans') || normalized.includes('chofer')) return 'transporte';
  if (normalized.includes('cont') || normalized.includes('caja') || normalized.includes('recibo')) return 'contabilidad';
  return ROLE_DEFINITIONS[normalized] ? normalized : 'ventas';
};

const normalizeRoleIds = (roles) => {
  const source = Array.isArray(roles) ? roles : [roles];
  const normalized = source
    .map((role) => normalizeRoleId(role))
    .filter((roleId) => ROLE_DEFINITIONS[roleId]);
  const unique = [...new Set(normalized)];
  return unique.length > 0 ? unique : ['ventas'];
};

const getUserRoleIds = (user) => normalizeRoleIds(user?.roleIds ?? user?.roleId ?? user?.role);

const getPrimaryRoleId = (user) => getUserRoleIds(user)[0] ?? 'ventas';

const isDeveloperUser = (user) => getUserRoleIds(user).includes('developer');

const getAllowedTabsForRoles = (roleIds) => [...new Set(
  normalizeRoleIds(roleIds).flatMap((roleId) => ROLE_DEFINITIONS[roleId]?.allowedTabs ?? []),
)];

const getDisplayRoleForIds = (roleIds) =>
  normalizeRoleIds(roleIds).map((roleId) => ROLE_DEFINITIONS[roleId]?.label ?? 'Ventas').join(', ');

const DEFAULT_USER_PERMISSIONS = {
  attendanceEnabled: true,
  calendarReadOnly: false,
  ordersReadOnly: false,
};

const normalizeUserPermissions = (permissions = {}) => ({
  ...DEFAULT_USER_PERMISSIONS,
  attendanceEnabled: permissions?.attendanceEnabled !== false,
  calendarReadOnly: Boolean(permissions?.calendarReadOnly),
  ordersReadOnly: Boolean(permissions?.ordersReadOnly),
});

const hashPassword = (password) => {
  const input = String(password ?? '');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const colorForUserId = (userId) => {
  const input = String(userId ?? 'user');
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return USER_COLORS[hash % USER_COLORS.length];
};

const normalizeUsername = (username) =>
  normalizeText(username)
    .replace(/[^a-z0-9._-]+/g, '')
    .slice(0, 32);

const usernameFromName = (name) => {
  const parts = normalizeText(name).split(/\s+/).filter(Boolean);
  return normalizeUsername(parts.slice(0, 2).join('.')) || `user${Date.now()}`;
};

const sanitizeUserForSession = (user) => {
  if (!user) return null;
  const roleIds = getUserRoleIds(user);
  const roleId = roleIds.includes('developer')
    ? 'developer'
    : roleIds.includes('super_admin')
      ? 'super_admin'
      : getPrimaryRoleId(user);
  const role = ROLE_DEFINITIONS[roleId] ?? ROLE_DEFINITIONS.ventas;
  const permissions = normalizeUserPermissions(user.permissions);
  const allowedTabs = getAllowedTabsForRoles(roleIds).filter((tabId) => tabId !== 'asistencia' || permissions.attendanceEnabled);
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    roleIds,
    roleId,
    role: getDisplayRoleForIds(roleIds),
    permissions,
    allowedTabs,
    defaultTab: role.defaultTab,
    status: user.status,
    lastAccessAt: user.lastAccessAt ?? null,
  };
};

const getBrowserName = (userAgent) => {
  const ua = String(userAgent ?? '');
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua) || /Opera/.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  return 'Navegador';
};

const getOsName = (userAgent, platform = '') => {
  const source = `${userAgent ?? ''} ${platform ?? ''}`;
  if (/Windows/i.test(source)) return 'Windows';
  if (/Android/i.test(source)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(source)) return 'iOS';
  if (/Mac/i.test(source)) return 'macOS';
  if (/Linux/i.test(source)) return 'Linux';
  return 'Equipo';
};

const detectDeviceInfo = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      type: 'desktop',
      typeLabel: 'Computadora',
      browser: 'Navegador',
      os: 'Equipo',
      label: 'Computadora',
      screen: '',
      userAgent: '',
    };
  }

  const userAgent = navigator.userAgent ?? '';
  const platform = navigator.platform ?? '';
  const width = window.screen?.width ?? window.innerWidth ?? 0;
  const height = window.screen?.height ?? window.innerHeight ?? 0;
  const hasTouch = Number(navigator.maxTouchPoints ?? 0) > 0;
  const isTablet = /iPad|Tablet/i.test(userAgent) || (hasTouch && Math.min(width, height) >= 700);
  const isMobile = /Android|iPhone|iPod|Mobile/i.test(userAgent) && !isTablet;
  const type = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';
  const typeLabel = type === 'mobile' ? 'Celular' : type === 'tablet' ? 'Tablet' : 'PC';
  const browser = getBrowserName(userAgent);
  const os = getOsName(userAgent, platform);

  return {
    type,
    typeLabel,
    browser,
    os,
    label: `${typeLabel} ${browser}`,
    screen: width && height ? `${width}x${height}` : '',
    userAgent,
  };
};

const readSessionRecord = () => {
  if (canUseLocalStorage()) {
    window.localStorage.removeItem(WEB_LEGACY_SESSION_STORAGE_KEY);
  }
  if (!canUseSessionStorage()) return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(WEB_SESSION_STORAGE_KEY) || 'null');
    if (!parsed?.userId || !parsed?.sessionId) return null;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
      window.sessionStorage.removeItem(WEB_SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    window.sessionStorage.removeItem(WEB_SESSION_STORAGE_KEY);
    return null;
  }
};

const writeSessionRecord = (record) => {
  if (!canUseSessionStorage()) return;
  window.sessionStorage.setItem(WEB_SESSION_STORAGE_KEY, JSON.stringify(record));
};

const createSessionRecord = (userId) => {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const record = {
    userId,
    sessionId: makeId('ses'),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(nowMs + SESSION_TTL_MS).toISOString(),
    device: detectDeviceInfo(),
  };
  writeSessionRecord(record);
  return record;
};

const touchSessionRecord = () => {
  const record = readSessionRecord();
  if (!record) return null;
  const nowMs = Date.now();
  const nextRecord = {
    ...record,
    lastSeenAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + SESSION_TTL_MS).toISOString(),
  };
  writeSessionRecord(nextRecord);
  return nextRecord;
};

const readSessionUserId = () => {
  const record = readSessionRecord();
  return record?.userId ?? null;
};

const clearSessionUserId = () => {
  if (canUseLocalStorage()) {
    window.localStorage.removeItem(WEB_LEGACY_SESSION_STORAGE_KEY);
  }
  if (!canUseSessionStorage()) return;
  window.sessionStorage.removeItem(WEB_SESSION_STORAGE_KEY);
};

const categoryRequiresCleaning = (category) => {
  const normalized = normalizeText(category);
  return normalized.includes('manteleria') || normalized.includes('mantel');
};

const toNumber = (value, fieldName) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`El campo "${fieldName}" debe ser numerico.`);
  }
  return parsed;
};

const toInteger = (value, fieldName) => Math.trunc(toNumber(value, fieldName));

const toPositiveRoundedNumber = (value) => Number(Number(value ?? 0).toFixed(2));

const normalizeDeliveryCharge = (source = {}) => {
  const logisticsMode = ['envio', 'recojo'].includes(source?.logisticsMode) ? source.logisticsMode : 'envio';
  const parsedDeliveryFeeBs = Number(source?.deliveryFeeBs ?? source?.totals?.deliveryFeeBs ?? 0);
  const deliveryChargeMode = logisticsMode === 'envio'
    && (source?.deliveryChargeMode === 'extra' || (Number.isFinite(parsedDeliveryFeeBs) && parsedDeliveryFeeBs > 0))
    ? 'extra'
    : 'included';
  const deliveryFeeBs = deliveryChargeMode === 'extra'
    ? Math.max(0, Number.isFinite(parsedDeliveryFeeBs) ? Number(parsedDeliveryFeeBs.toFixed(2)) : 0)
    : 0;
  const deliveryFeeReason = deliveryChargeMode === 'extra'
    ? String(source?.deliveryFeeReason ?? 'other').trim() || 'other'
    : 'covered';

  return {
    deliveryChargeMode,
    deliveryFeeBs,
    deliveryFeeReason,
  };
};

const normalizeBlacklistReason = (value) => {
  const normalized = normalizeText(value);
  if (normalized.includes('descortes') || normalized.includes('rude')) return 'rude';
  if (normalized.includes('no pag') || normalized.includes('deuda') || normalized.includes('unpaid')) return 'unpaid';
  if (normalized.includes('proble') || normalized.includes('conflict')) return 'problematic';
  return normalized ? 'other' : 'problematic';
};

const normalizePrepaidMovements = (movements, fallbackBalance = 0) => {
  if (!Array.isArray(movements)) return [];
  let runningBalance = 0;
  return movements
    .map((movement) => {
      const amountBs = toPositiveRoundedNumber(movement?.amountBs ?? 0);
      const type = movement?.type === 'charge' ? 'charge' : 'deposit';
      const signedAmountBs = type === 'charge' ? -Math.abs(amountBs) : Math.abs(amountBs);
      runningBalance = Number((runningBalance + signedAmountBs).toFixed(2));

      return {
        id: String(movement?.id ?? makeId('pre')).trim() || makeId('pre'),
        type,
        amountBs: Number(signedAmountBs.toFixed(2)),
        description: String(movement?.description ?? '').trim(),
        sourceType: String(movement?.sourceType ?? '').trim() || null,
        sourceId: String(movement?.sourceId ?? '').trim() || null,
        orderCode: String(movement?.orderCode ?? '').trim() || null,
        balanceAfterBs: Number(Number(movement?.balanceAfterBs ?? runningBalance ?? fallbackBalance).toFixed(2)),
        nonPhysical: Boolean(movement?.nonPhysical),
        createdAt: movement?.createdAt ?? new Date().toISOString(),
      };
    })
    .filter((movement) => movement.amountBs !== 0 || movement.description);
};

const normalizeSupplierFulfillmentPlan = (plan) => {
  if (!Array.isArray(plan)) return [];
  return plan
    .map((line) => {
      const itemId = String(line?.itemId ?? '').trim();
      const itemName = String(line?.itemName ?? '').trim();
      const supplierId = String(line?.supplierId ?? '').trim();
      const supplierName = String(line?.supplierName ?? '').trim();
      const neededQty = Math.max(1, Math.trunc(Number(line?.neededQty ?? line?.quantity ?? 1)));
      const supplierUnitCostBs = Math.max(0, toPositiveRoundedNumber(line?.supplierUnitCostBs ?? line?.unitPriceBs ?? 0));
      const saleUnitPriceBs = Math.max(0, toPositiveRoundedNumber(line?.saleUnitPriceBs ?? 0));
      const baseSaleUnitPriceBs = Math.max(0, toPositiveRoundedNumber(line?.baseSaleUnitPriceBs ?? saleUnitPriceBs));
      const saleDiscountPercent = Math.min(100, Math.max(0, toPositiveRoundedNumber(line?.saleDiscountPercent ?? 0)));
      const discountApplied = Boolean(line?.discountApplied || saleDiscountPercent > 0);
      if (!itemId || !supplierId || !supplierName || !itemName) return null;
      return {
        id: String(line?.id ?? makeId('supfill')).trim() || makeId('supfill'),
        lineKey: String(line?.lineKey ?? '').trim() || null,
        itemId,
        itemName,
        supplierId,
        supplierName,
        supplierQuoteId: String(line?.supplierQuoteId ?? '').trim() || null,
        supplierQuoteCode: String(line?.supplierQuoteCode ?? '').trim() || null,
        neededQty,
        supplierUnitCostBs,
        saleUnitPriceBs,
        baseSaleUnitPriceBs,
        saleDiscountPercent,
        discountApplied,
        manualCoverage: Boolean(line?.manualCoverage),
        totalCostBs: Number((neededQty * supplierUnitCostBs).toFixed(2)),
        totalSaleBs: Number((neededQty * saleUnitPriceBs).toFixed(2)),
        marginBs: Number((neededQty * (saleUnitPriceBs - supplierUnitCostBs)).toFixed(2)),
        createdAt: line?.createdAt ?? new Date().toISOString(),
      };
    })
    .filter(Boolean);
};

const repriceSupplierFulfillmentPlanFromItems = (plan, items = []) => {
  const normalizedPlan = normalizeSupplierFulfillmentPlan(plan);
  const normalizedItems = Array.isArray(items) ? items : [];
  const itemByLineKey = new Map();
  const itemsByItemId = new Map();

  normalizedItems.forEach((line) => {
    const lineKey = String(line?.lineKey ?? '').trim();
    const itemId = String(line?.itemId ?? '').trim();
    if (lineKey) itemByLineKey.set(lineKey, line);
    if (itemId) {
      const current = itemsByItemId.get(itemId) ?? [];
      current.push(line);
      itemsByItemId.set(itemId, current);
    }
  });

  return normalizedPlan.map((coverage) => {
    const lineKey = String(coverage?.lineKey ?? '').trim();
    const itemId = String(coverage?.itemId ?? '').trim();
    const candidates = itemsByItemId.get(itemId) ?? [];
    const linkedLine = (lineKey ? itemByLineKey.get(lineKey) : null)
      ?? (candidates.length === 1 ? candidates[0] : null);

    if (!linkedLine) return coverage;

    const baseSaleUnitPriceBs = Math.max(
      0,
      toPositiveRoundedNumber(
        linkedLine?.unitPriceBs
        ?? coverage?.baseSaleUnitPriceBs
        ?? coverage?.saleUnitPriceBs
        ?? 0,
      ),
    );
    const saleDiscountPercent = Math.min(
      100,
      Math.max(0, toPositiveRoundedNumber(linkedLine?.discountPercent ?? 0)),
    );
    const saleUnitPriceBs = Number(
      (baseSaleUnitPriceBs * (1 - (saleDiscountPercent / 100))).toFixed(2),
    );
    const neededQty = Math.max(1, Math.trunc(Number(coverage?.neededQty ?? 1)));
    const supplierUnitCostBs = Math.max(
      0,
      toPositiveRoundedNumber(coverage?.supplierUnitCostBs ?? 0),
    );

    return {
      ...coverage,
      lineKey: lineKey || String(linkedLine?.lineKey ?? '').trim() || null,
      baseSaleUnitPriceBs,
      saleDiscountPercent,
      discountApplied: saleDiscountPercent > 0,
      saleUnitPriceBs,
      totalCostBs: Number((neededQty * supplierUnitCostBs).toFixed(2)),
      totalSaleBs: Number((neededQty * saleUnitPriceBs).toFixed(2)),
      marginBs: Number((neededQty * (saleUnitPriceBs - supplierUnitCostBs)).toFixed(2)),
    };
  });
};

const getManualSupplierSaleTotalBs = (supplierFulfillmentPlan) =>
  normalizeSupplierFulfillmentPlan(supplierFulfillmentPlan)
    .filter((line) => line.manualCoverage)
    .reduce((sum, line) => sum + Number(line.totalSaleBs ?? 0), 0);

const addSupplierSupportToMaps = (maps, line) => {
  const itemId = String(line?.itemId ?? '').trim();
  if (!itemId) return;
  const quantity = Math.max(0, Math.trunc(Number(line?.neededQty ?? 0)));
  const lineKey = String(line?.lineKey ?? '').trim();
  const add = (map, key) => {
    if (!key) return;
    map.set(key, Number(map.get(key) ?? 0) + quantity);
  };
  add(maps.byItem, itemId);
  add(maps.byLineKey, lineKey);
  if (line?.manualCoverage) {
    add(maps.manualByItem, itemId);
    add(maps.manualByLineKey, lineKey);
  }
};

const buildSupplierSupportMaps = (supplierFulfillmentPlan) => {
  const maps = {
    byItem: new Map(),
    byLineKey: new Map(),
    manualByItem: new Map(),
    manualByLineKey: new Map(),
  };
  normalizeSupplierFulfillmentPlan(supplierFulfillmentPlan).forEach((line) => addSupplierSupportToMaps(maps, line));
  return maps;
};

const getSupplierSupportStatsForLine = (line, maps) => {
  const itemId = String(line?.itemId ?? '').trim();
  const lineKey = String(line?.lineKey ?? '').trim();
  const totalQty = Number(
    (lineKey && maps.byLineKey.has(lineKey))
      ? maps.byLineKey.get(lineKey)
      : maps.byItem.get(itemId) ?? 0,
  );
  const manualQty = Number(
    (lineKey && maps.manualByLineKey.has(lineKey))
      ? maps.manualByLineKey.get(lineKey)
      : maps.manualByItem.get(itemId) ?? 0,
  );
  return {
    totalQty: Math.max(0, Math.trunc(totalQty)),
    manualQty: Math.max(0, Math.trunc(manualQty)),
    subtractiveQty: Math.max(0, Math.trunc(totalQty - manualQty)),
  };
};

const normalizeContractServices = (services) => {
  if (!Array.isArray(services)) return [];
  return services
    .map((service) => {
      const name = String(service?.name ?? '').trim();
      if (!name) return null;
      const quantity = Math.max(1, Math.trunc(Number(service?.quantity ?? 1)));
      const unitPriceBs = Math.max(0, toPositiveRoundedNumber(service?.unitPriceBs ?? 0));
      return {
        id: String(service?.id ?? makeId('svc')).trim() || makeId('svc'),
        name,
        detail: String(service?.detail ?? '').trim(),
        quantity,
        unitPriceBs,
        lineTotalBs: Number((quantity * unitPriceBs).toFixed(2)),
        serviceDayId: String(service?.serviceDayId ?? service?.scheduleDayId ?? '').trim() || null,
        serviceDate: String(service?.serviceDate ?? '').trim() || null,
        serviceDayLabel: String(service?.serviceDayLabel ?? '').trim(),
      };
    })
    .filter(Boolean);
};

const normalizeRecordResponsibles = (payload = {}) => {
  const source = Array.isArray(payload?.responsibles) ? payload.responsibles : [];
  const normalized = source
    .map((entry) => {
      const name = String(entry?.name ?? entry?.fullName ?? '').trim();
      if (!name) return null;
      return {
        id: String(entry?.id ?? entry?.userId ?? entry?.employeeId ?? name).trim() || name,
        name,
        role: String(entry?.role ?? entry?.position ?? entry?.department ?? 'Operacion').trim() || 'Operacion',
        source: String(entry?.source ?? '').trim() || null,
      };
    })
    .filter(Boolean);

  if (normalized.length > 0) {
    const seen = new Set();
    return normalized.filter((entry) => {
      const key = normalizeText(entry.id || entry.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const fallbackName = String(payload?.createdByName ?? payload?.userName ?? payload?.createdBy ?? '').trim();
  if (!fallbackName) return [];
  return [{
    id: String(payload?.createdById ?? payload?.userId ?? fallbackName).trim() || fallbackName,
    name: fallbackName,
    role: String(payload?.createdByRole ?? payload?.userRole ?? 'Operacion').trim() || 'Operacion',
    source: 'trace',
  }];
};

const timeToMinutes = (value) => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const assertSameDayTimeWindow = (start, end, label = 'La ventana horaria') => {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes === null || endMinutes === null) {
    throw new Error(`${label} debe tener horas validas.`);
  }
  if (endMinutes <= startMinutes) {
    throw new Error(`${label} debe terminar despues de la hora de inicio.`);
  }
};

const minutesToHours = (minutes) => Number(Math.max(0, minutes / 60).toFixed(2));

const getWeekdayFromDate = (date) => {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getDay();
};

const calculateAttendanceMeta = ({ employee, date, checkIn, checkOut }) => {
  const inMinutes = timeToMinutes(checkIn);
  const outMinutes = timeToMinutes(checkOut);
  const workingDays = Array.isArray(employee?.schedule?.workingDays) && employee.schedule.workingDays.length
    ? employee.schedule.workingDays.map((day) => Number(day))
    : [1, 2, 3, 4, 5, 6];
  const weekday = getWeekdayFromDate(date);
  const isWorkingDay = !employee || weekday === null || workingDays.includes(weekday);
  const scheduleStart = timeToMinutes(employee?.schedule?.start ?? '08:00') ?? 480;
  const scheduleEnd = timeToMinutes(employee?.schedule?.end ?? '17:00') ?? 1020;
  const expectedMinutes = isWorkingDay
    ? Math.max(60, Number(employee?.schedule?.dailyHours ?? 8) * 60)
    : 0;

  if (!date || inMinutes === null || outMinutes === null || outMinutes <= inMinutes) {
    return {
      workedHours: 0,
      overtimeHours: 0,
      missingHours: employee && isWorkingDay ? minutesToHours(expectedMinutes) : 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      status: 'incompleto',
    };
  }

  const workedMinutes = outMinutes - inMinutes;
  const lateMinutes = isWorkingDay ? Math.max(0, inMinutes - scheduleStart) : 0;
  const earlyLeaveMinutes = isWorkingDay ? Math.max(0, scheduleEnd - outMinutes) : 0;
  const overtimeMinutes = Math.max(0, workedMinutes - expectedMinutes);
  const missingMinutes = Math.max(0, expectedMinutes - workedMinutes);
  const status = missingMinutes > 0 || lateMinutes > 0 || earlyLeaveMinutes > 0
    ? 'observado'
    : overtimeMinutes > 0
      ? 'extra'
      : 'normal';

  return {
    workedHours: minutesToHours(workedMinutes),
    overtimeHours: minutesToHours(overtimeMinutes),
    missingHours: minutesToHours(missingMinutes),
    lateMinutes,
    earlyLeaveMinutes,
    workingDay: isWorkingDay,
    status,
  };
};

const nextPersonnelCode = (employees) => {
  let nextNumber = employees.length + 1;
  let code = `EMP-${String(nextNumber).padStart(4, '0')}`;
  const existingCodes = new Set(employees.map((employee) => normalizeText(employee?.employeeCode)));
  while (existingCodes.has(normalizeText(code))) {
    nextNumber += 1;
    code = `EMP-${String(nextNumber).padStart(4, '0')}`;
  }
  return code;
};

const DEFAULT_DURATION_PRICING_TIERS = [
  { fromDay: 1, toDay: 1, percent: 100 },
  { fromDay: 2, toDay: 3, percent: 85 },
  { fromDay: 4, toDay: 0, percent: 50 },
];

const parsePositiveInteger = (value, fallback = 1) => {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parsePercentage = (value, fallback = 100) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
};

const normalizeDurationPricingTiers = (tiers) => {
  const source = Array.isArray(tiers) && tiers.length > 0 ? tiers : DEFAULT_DURATION_PRICING_TIERS;
  return source
    .map((tier, index) => {
      const fromDay = parsePositiveInteger(tier?.fromDay, index + 1);
      const rawToDay = String(tier?.toDay ?? '').trim();
      const parsedToDay = rawToDay === '' ? 0 : parsePositiveInteger(rawToDay, fromDay);
      return {
        fromDay,
        toDay: parsedToDay > 0 ? Math.max(fromDay, parsedToDay) : 0,
        percent: parsePercentage(tier?.percent),
      };
    })
    .sort((a, b) => a.fromDay - b.fromDay);
};

const calculateDurationPricing = ({ pricingPlan, baseSubtotalBs }) => {
  const safeBase = Math.max(0, Number(baseSubtotalBs ?? 0));
  const mode = pricingPlan?.mode === 'daily_schedule'
    ? 'daily_schedule'
    : pricingPlan?.mode === 'duration' ? 'duration' : 'simple';
  const days = mode === 'duration' ? parsePositiveInteger(pricingPlan?.days, 1) : 1;
  const tiers = normalizeDurationPricingTiers(pricingPlan?.tiers);

  if (mode !== 'duration') {
    const scheduleDays = mode === 'daily_schedule' && Array.isArray(pricingPlan?.scheduleDays)
      ? pricingPlan.scheduleDays.map((day, index) => ({
        id: String(day?.id ?? `day-${index + 1}`).trim() || `day-${index + 1}`,
        label: String(day?.label ?? `Dia ${index + 1}`).trim() || `Dia ${index + 1}`,
        date: String(day?.date ?? '').trim(),
        note: String(day?.note ?? '').trim(),
        itemCount: Math.max(0, Math.trunc(Number(day?.itemCount ?? 0))),
        itemSubtotalBs: toPositiveRoundedNumber(day?.itemSubtotalBs ?? 0),
        serviceSubtotalBs: toPositiveRoundedNumber(day?.serviceSubtotalBs ?? 0),
        subtotalBs: toPositiveRoundedNumber(day?.subtotalBs ?? 0),
      }))
      : [];
    const dailyItemsSubtotalBs = scheduleDays.reduce((sum, day) => sum + Number(day.itemSubtotalBs ?? 0), 0);
    const dailyChargeableSubtotalBs = mode === 'daily_schedule' && dailyItemsSubtotalBs > 0
      ? dailyItemsSubtotalBs
      : safeBase;
    return {
      mode,
      days: mode === 'daily_schedule' ? Math.max(1, scheduleDays.length) : 1,
      tiers,
      scheduleDays,
      baseSubtotalBs: toPositiveRoundedNumber(safeBase),
      theoreticalSubtotalBs: toPositiveRoundedNumber(safeBase),
      chargeableSubtotalBs: toPositiveRoundedNumber(dailyChargeableSubtotalBs),
      durationDiscountBs: 0,
      effectiveMultiplier: 1,
    };
  }

  const chargeableSubtotalBs = Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const tier = tiers.find((entry) => day >= entry.fromDay && (entry.toDay === 0 || day <= entry.toDay));
    return safeBase * ((tier?.percent ?? 100) / 100);
  }).reduce((sum, amount) => sum + amount, 0);
  const theoreticalSubtotalBs = safeBase * days;

  return {
    mode,
    days,
    tiers,
    baseSubtotalBs: toPositiveRoundedNumber(safeBase),
    theoreticalSubtotalBs: toPositiveRoundedNumber(theoreticalSubtotalBs),
    chargeableSubtotalBs: toPositiveRoundedNumber(chargeableSubtotalBs),
    durationDiscountBs: toPositiveRoundedNumber(Math.max(0, theoreticalSubtotalBs - chargeableSubtotalBs)),
    effectiveMultiplier: safeBase > 0 ? Number((chargeableSubtotalBs / safeBase).toFixed(4)) : 0,
  };
};

const enrichDailySchedulePricingPlan = (pricingPlan, itemLines = [], serviceLines = []) => {
  if (pricingPlan?.mode !== 'daily_schedule') return pricingPlan;
  const sourceDays = Array.isArray(pricingPlan?.scheduleDays) ? pricingPlan.scheduleDays : [];
  const days = sourceDays.map((day, index) => ({
    id: String(day?.id ?? `day-${index + 1}`).trim() || `day-${index + 1}`,
    label: String(day?.label ?? `Dia ${index + 1}`).trim() || `Dia ${index + 1}`,
    date: String(day?.date ?? '').trim(),
    note: String(day?.note ?? '').trim(),
    itemCount: 0,
    itemSubtotalBs: 0,
    serviceSubtotalBs: 0,
    subtotalBs: 0,
  }));
  const findOrCreateDay = (line) => {
    const lineDayId = String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim();
    const lineDate = String(line?.serviceDate ?? line?.date ?? '').trim();
    const lineLabel = String(line?.serviceDayLabel ?? line?.dayLabel ?? '').trim();
    let index = lineDate ? days.findIndex((day) => day.date === lineDate) : -1;
    if (index < 0 && lineDayId) index = days.findIndex((day) => day.id === lineDayId);
    if (index < 0 && lineLabel) index = days.findIndex((day) => normalizeText(day.label) === normalizeText(lineLabel));
    if (index >= 0) return days[index];
    const nextDay = {
      id: lineDayId || (lineDate ? `day-${lineDate}` : `day-${days.length + 1}`),
      label: lineLabel || `Dia ${days.length + 1}`,
      date: lineDate,
      note: '',
      itemCount: 0,
      itemSubtotalBs: 0,
      serviceSubtotalBs: 0,
      subtotalBs: 0,
    };
    days.push(nextDay);
    return nextDay;
  };
  itemLines.forEach((line) => {
    const day = findOrCreateDay(line);
    const amountBs = toPositiveRoundedNumber(line?.lineTotalBs ?? Number(line?.quantity ?? 0) * Number(line?.unitPriceBs ?? line?.rentalPriceBs ?? 0));
    day.itemCount += 1;
    day.itemSubtotalBs = toPositiveRoundedNumber(day.itemSubtotalBs + amountBs);
    day.subtotalBs = toPositiveRoundedNumber(day.subtotalBs + amountBs);
  });
  serviceLines.forEach((line) => {
    const day = findOrCreateDay(line);
    const amountBs = toPositiveRoundedNumber(line?.lineTotalBs ?? Number(line?.quantity ?? 0) * Number(line?.unitPriceBs ?? 0));
    day.itemCount += 1;
    day.serviceSubtotalBs = toPositiveRoundedNumber(day.serviceSubtotalBs + amountBs);
    day.subtotalBs = toPositiveRoundedNumber(day.subtotalBs + amountBs);
  });
  const sortedDays = days.sort((left, right) =>
    String(left.date || left.id).localeCompare(String(right.date || right.id)),
  );
  const itemSubtotalBs = sortedDays.reduce((sum, day) => sum + Number(day.itemSubtotalBs ?? 0), 0);
  return {
    ...pricingPlan,
    days: Math.max(1, sortedDays.length),
    scheduleDays: sortedDays,
    chargeableSubtotalBs: toPositiveRoundedNumber(itemSubtotalBs || pricingPlan.chargeableSubtotalBs || 0),
    theoreticalSubtotalBs: toPositiveRoundedNumber(itemSubtotalBs || pricingPlan.theoreticalSubtotalBs || 0),
  };
};

const alignLinesToDailySchedule = (pricingPlan, lines = []) => {
  if (pricingPlan?.mode !== 'daily_schedule') return Array.isArray(lines) ? lines : [];
  const scheduleDays = Array.isArray(pricingPlan?.scheduleDays) ? pricingPlan.scheduleDays : [];
  if (scheduleDays.length === 0) return Array.isArray(lines) ? lines : [];

  return (Array.isArray(lines) ? lines : []).map((line) => {
    const lineDate = String(line?.serviceDate ?? line?.date ?? '').trim();
    const lineDayId = String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim();
    const lineLabel = String(line?.serviceDayLabel ?? line?.dayLabel ?? '').trim();

    const dayByDate = lineDate
      ? scheduleDays.find((day) => String(day?.date ?? '').trim() === lineDate)
      : null;
    const dayById = lineDayId
      ? scheduleDays.find((day) => String(day?.id ?? '').trim() === lineDayId)
      : null;
    const dayByLabel = lineLabel
      ? scheduleDays.find((day) => normalizeText(day?.label) === normalizeText(lineLabel))
      : null;

    const assignedDay = dayByDate ?? dayById ?? dayByLabel ?? scheduleDays[0];
    return {
      ...line,
      serviceDayId: String(assignedDay?.id ?? lineDayId).trim() || null,
      serviceDate: String(assignedDay?.date ?? lineDate).trim() || null,
      serviceDayLabel: String(assignedDay?.label ?? lineLabel).trim(),
    };
  });
};

const makeId = (prefix = 'id') => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeTreasuryAccounts = (accounts = []) => {
  if (!Array.isArray(accounts)) return [];
  return accounts
    .map((account) => ({
      id: String(account?.id ?? makeId('acct')).trim(),
      name: String(account?.name ?? '').trim(),
      type: String(account?.type ?? 'banco').trim() || 'banco',
      amountBs: toPositiveRoundedNumber(account?.amountBs ?? 0),
      notes: String(account?.notes ?? '').trim(),
      updatedAt: account?.updatedAt ?? new Date().toISOString(),
    }))
    .filter((account) => account.name || account.amountBs > 0);
};

const canUseLocalStorage = () => {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage);
  } catch {
    return false;
  }
};

const canUseSessionStorage = () => {
  try {
    return typeof window !== 'undefined' && Boolean(window.sessionStorage);
  } catch {
    return false;
  }
};

function normalizeDeliveryStatus(value) {
  const normalized = String(value?.status ?? value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'en_ruta' || normalized === 'ruta') return 'en_ruta';
  if (normalized === 'completada' || normalized === 'completo' || normalized === 'entregada') return 'completada';
  if (normalized === 'incidencia' || normalized === 'problema') return 'incidencia';
  if (normalized === 'cancelada' || normalized === 'cancelado') return 'cancelada';
  return 'programada';
}

const normalizeRentalStatus = (value) => {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  if (normalized === 'returned' || normalized === 'devuelto') return 'returned';
  if (
    normalized === 'cancelled'
    || normalized === 'cancelado'
    || normalized === 'cancelada'
    || normalized === 'anulado'
    || normalized === 'anulada'
  ) return 'cancelled';
  return 'active';
};

const toDateKey = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

const isSameOrBeforeDay = (left, right) => {
  const leftKey = toDateKey(left);
  const rightKey = toDateKey(right);
  if (!leftKey || !rightKey) return false;
  return leftKey <= rightKey;
};

const syncRentalTransportStatus = (state, rental, now = new Date().toISOString()) => {
  if (!rental || rental.deletedAt || rental.status !== 'active') {
    return;
  }

  rental.operational = {
    inventoryStatus: rental.operational?.inventoryStatus ?? 'pendiente',
    transportStatus: rental.operational?.transportStatus ?? 'pendiente',
    inventoryNote: rental.operational?.inventoryNote ?? '',
    transportNote: rental.operational?.transportNote ?? '',
    inventorySentAt: rental.operational?.inventorySentAt ?? null,
    inventoryDispatchedAt: rental.operational?.inventoryDispatchedAt ?? null,
    inventoryDispatchedByName: rental.operational?.inventoryDispatchedByName ?? null,
    inventoryDispatchedByRole: rental.operational?.inventoryDispatchedByRole ?? null,
    transportSentAt: rental.operational?.transportSentAt ?? null,
    inventoryConfirmedAt: rental.operational?.inventoryConfirmedAt ?? null,
    inventoryConfirmedByName: rental.operational?.inventoryConfirmedByName ?? null,
    inventoryConfirmedByRole: rental.operational?.inventoryConfirmedByRole ?? null,
    inventoryReturnedAt: rental.operational?.inventoryReturnedAt ?? null,
    inventoryReturnedByName: rental.operational?.inventoryReturnedByName ?? null,
    inventoryReturnedByRole: rental.operational?.inventoryReturnedByRole ?? null,
    transportConfirmedAt: rental.operational?.transportConfirmedAt ?? null,
    transportConfirmedByName: rental.operational?.transportConfirmedByName ?? null,
    transportConfirmedByRole: rental.operational?.transportConfirmedByRole ?? null,
    dispatchReview: rental.operational?.dispatchReview ?? null,
    returnReview: rental.operational?.returnReview ?? null,
    revisionAlert: rental.operational?.revisionAlert ?? null,
    clientPendingPickup: rental.operational?.clientPendingPickup ?? null,
  };

  if (rental.logisticsMode === 'recojo') {
    rental.operational.transportStatus = 'no_aplica';
    return;
  }

  const linkedDeliveries = (state.deliveries ?? []).filter(
    (delivery) =>
      !delivery.deletedAt
      && (
        (delivery.rentalId && delivery.rentalId === rental.id)
        || (delivery.orderCode && rental.orderCode && delivery.orderCode === rental.orderCode)
      ),
  );

  if (linkedDeliveries.length === 0) {
    return;
  }

  const everyCompleted = linkedDeliveries.every((delivery) => normalizeDeliveryStatus(delivery) === 'completada');
  if (everyCompleted) {
    rental.operational.transportStatus = 'confirmado';
    rental.operational.transportSentAt = rental.operational.transportSentAt ?? now;
    rental.operational.transportConfirmedAt = rental.operational.transportConfirmedAt ?? now;
    return;
  }

  const anyInProgress = linkedDeliveries.some((delivery) => ['en_ruta', 'completada'].includes(normalizeDeliveryStatus(delivery)));
  if (anyInProgress && rental.operational.transportStatus !== 'confirmado') {
    rental.operational.transportStatus = 'enviado';
    rental.operational.transportSentAt = rental.operational.transportSentAt ?? now;
  }
};

const deepClone = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const createDefaultSettings = () => ({
  defaultDepositBs: 200,
  deliveryBaseFeeBs: 0,
  missingMultiplier: 2,
  damageMultiplier: 1.2,
  contractCancellationPenaltyPercent: 20,
  companyName: 'Copetin SRL',
  taxId: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  timezone: 'America/La_Paz',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  language: 'es',
  currency: 'BOB',
  fiscalCondition: 'Responsable Inscripto',
  activityStartDate: '2018-03-01',
  numbering: {
    quotePrefix: 'COT-',
    quoteNext: 1,
    contractPrefix: 'CON-',
    contractNext: 1,
    serviceOrderPrefix: 'OS-',
    serviceOrderNext: 1,
    deliveryPrefix: 'ENT-',
    deliveryNext: 1,
    supplierQuotePrefix: 'PRO-COT-',
    supplierQuoteNext: 1,
    supplierLoanPrefix: 'SUB-',
    supplierLoanNext: 1,
    hrImportPrefix: 'BIO-',
    hrImportNext: 1,
    adjustmentPrefix: 'AJ-',
    adjustmentNext: 1,
    movementPrefix: 'MOV-',
    movementNext: 1,
  },
  backupMode: 'automatico',
});

const createBootstrapSuperAdmin = (createdAt) => ({
  id: 'usr-admin',
  fullName: 'Administrador',
  username: 'admin',
  passwordHash: '',
  mustChangePassword: true,
  passwordChangedAt: null,
  roleId: 'super_admin',
  roleIds: ['super_admin'],
  role: 'Super admin',
  status: 'active',
  phone: '',
  isCurrentUser: false,
  invitedAt: null,
  lastAccessAt: createdAt,
  createdAt,
  updatedAt: createdAt,
});

const createSeedData = () => {
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: 3,
    settings: createDefaultSettings(),
    categories: [],
    clients: [],
    users: [createBootstrapSuperAdmin(createdAt)],
    items: [],
    inventoryCombos: [],
    quotes: [],
    contracts: [],
    rentals: [],
    deliveries: [],
    transportRoutes: [],
    vehicles: [],
    drivers: [],
    calendarEvents: [],
    calendarBoardNotes: [],
    generatedReports: [],
    suppliers: [],
    supplierQuotes: [],
    supplierLoans: [],
    personnelEmployees: [],
    personnelAttendance: [],
    personnelIncidents: [],
    inventoryMovements: [],
    stockRecoveries: [],
    cashSessions: [],
    cashMovements: [],
    cashDebts: [],
    attendanceRecords: [],
    resetLogs: [],
    systemAuditLog: [],
    userPresence: [],
  };
};

const consumeRepairDocumentCode = (state, fieldPrefix, fieldNext, size = 5) => {
  const numbering = state.settings.numbering;
  const prefix = String(numbering[fieldPrefix] ?? '');
  const current = Math.max(1, Number.parseInt(String(numbering[fieldNext] ?? '1'), 10) || 1);
  numbering[fieldNext] = current + 1;
  return `${prefix}${String(current).padStart(size, '0')}`;
};

const buildRepairDueAt = (dateKey, timeKey) => {
  const [year, month, day] = String(dateKey ?? '').split('-').map((value) => Number.parseInt(value, 10));
  const [hours, minutes] = String(timeKey || '23:59').split(':').map((value) => Number.parseInt(value, 10));
  const parsed = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const findActiveRentalForContract = (state, contract) => state.rentals.find((entry) => (
  !entry.deletedAt
  && entry.status !== 'cancelled'
  && (
    String(entry.contractId ?? '') === String(contract.id)
    || String(entry.contractCode ?? '') === String(contract.contractCode)
    || (contract.rentalId && String(entry.id ?? '') === String(contract.rentalId))
    || (contract.orderCode && String(entry.orderCode ?? '') === String(contract.orderCode))
  )
)) ?? null;

const buildRepairRentalFromContract = (state, contract, now, orderCode) => {
  const totalBs = Number(contract?.totals?.totalBs ?? 0);
  const paidAtRentalBs = Number(contract?.payment?.paidAtApprovalBs ?? 0);
  const pendingPaymentBs = Number(Math.max(0, totalBs - paidAtRentalBs).toFixed(2));
  const paymentStatus = paidAtRentalBs >= totalBs && totalBs > 0 ? 'cancelado' : paidAtRentalBs > 0 ? 'a_cuenta' : 'sin_pago';
  const guaranteeAmountBs = Number(contract?.totals?.guaranteeBs ?? contract?.guarantee?.amountBs ?? 0);
  const guaranteeStatus = contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? 'no_validado';

  return {
    id: makeId('rent'),
    clientId: contract.clientId ?? null,
    contractId: contract.id,
    contractCode: contract.contractCode,
    orderCode,
    customerName: contract.customerName,
    customerPhone: contract.customerPhone,
    contractDate: contract.contractDate || contract.createdAt || now,
    rentalDate: contract.deliveryDate || contract.eventDate,
    rentalAt: now,
    dueDate: contract.pickupDate || contract.deliveryDate || contract.eventDate,
    dueTime: contract.pickupWindowEnd || contract.eventTime || '23:59',
    dueAt: buildRepairDueAt(contract.pickupDate || contract.deliveryDate || contract.eventDate, contract.pickupWindowEnd || contract.eventTime || '23:59'),
    deliveryWindowStart: contract.deliveryWindowStart || null,
    deliveryWindowEnd: contract.deliveryWindowEnd || null,
    pickupWindowStart: contract.pickupWindowStart || null,
    pickupWindowEnd: contract.pickupWindowEnd || contract.eventTime || '23:59',
    idCardHeld: false,
    depositBs: guaranteeStatus === 'validado' ? guaranteeAmountBs : 0,
    guaranteeDeclaredBs: guaranteeAmountBs,
    guarantee: {
      amountBs: guaranteeAmountBs,
      validatedBs: guaranteeStatus === 'validado' ? guaranteeAmountBs : 0,
      status: guaranteeStatus,
      paymentMethod: contract?.guarantee?.paymentMethod ?? contract?.payment?.guaranteePaymentMethod ?? 'efectivo',
      paymentAccount: contract?.guarantee?.paymentAccount ?? contract?.payment?.guaranteePaymentAccount ?? '',
    },
    deliveryChargeMode: contract.deliveryChargeMode ?? 'included',
    deliveryFeeBs: Number(contract?.totals?.deliveryFeeBs ?? contract?.deliveryFeeBs ?? 0),
    deliveryFeeReason: contract.deliveryFeeReason ?? 'covered',
    prepaidClientId: null,
    prepaidAppliedBs: Number(contract?.payment?.prepaidAppliedBs ?? 0),
    items: (contract.items ?? []).map((line, index) => {
      const item = state.items.find((entry) => entry.id === line.itemId);
      const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
      const lineType = String(line?.lineType ?? '').trim();
      const isCourtesyLine = lineType === 'courtesy';
      const rentalPriceBs = isCourtesyLine ? 0 : Math.max(
        Number(line.unitPriceBs ?? 0),
        Number(line.rentalPriceBs ?? 0),
        Number(item?.rentalPriceBs ?? 0),
        0,
      );
      return {
        lineKey: getInventoryLineKey(line, index),
        itemId: line.itemId,
        itemName: line.itemName || item?.name || 'Item',
        rentalPriceBs,
        damagedUnitChargeBs: Number(item?.damagedUnitChargeBs ?? rentalPriceBs * 1.2),
        missingUnitChargeBs: Number(item?.missingUnitChargeBs ?? rentalPriceBs * 2),
        quantity,
        supplierBackedQty: 0,
        internalReservedQty: quantity,
        controlsStock: true,
        verificationStatus: 'verified',
        comboId: line.comboId ?? null,
        comboName: line.comboName ?? '',
        comboLineKey: line.comboLineKey ?? null,
        comboComponentName: line.comboComponentName || item?.name || line.itemName || '',
        comboQuantity: Math.max(1, Math.trunc(Number(line.comboQuantity ?? 1))),
        comboComponentQuantity: Math.max(1, Math.trunc(Number(line.comboComponentQuantity ?? 1))),
        comboRuleIndex: Math.max(0, Math.trunc(Number(line.comboRuleIndex ?? 0))),
        comboSlotLabel: line.comboSlotLabel ?? '',
        comboSelectionMode: line.comboSelectionMode ?? 'item',
        comboOptionItemIds: Array.isArray(line.comboOptionItemIds) ? line.comboOptionItemIds.map(String) : [],
        comboCategory: line.comboCategory ?? '',
        comboPricingRole: line.comboPricingRole ?? '',
        comboPricingCondition: line.comboPricingCondition ?? null,
        lineType,
        observation: String(line?.observation ?? line?.observations ?? line?.note ?? (isCourtesyLine ? 'Cortesia' : '')).trim(),
        grossLineTotalBs: isCourtesyLine ? 0 : Number(line.grossLineTotalBs ?? quantity * rentalPriceBs),
        discountPercent: isCourtesyLine ? 0 : Number(line.discountPercent ?? 0),
        discountBs: isCourtesyLine ? 0 : Number(line.discountBs ?? 0),
        lineTotalBs: isCourtesyLine ? 0 : Number(line.lineTotalBs ?? quantity * rentalPriceBs),
      };
    }),
    services: contract.services ?? [],
    pricingPlan: contract.pricingPlan ?? null,
    totals: {
      ...(contract.totals ?? {}),
      totalBs,
      paidAtRentalBs,
      pendingPaymentBs,
      overpaidBs: Number(Math.max(0, paidAtRentalBs - totalBs).toFixed(2)),
    },
    payment: {
      mode: paymentStatus,
      status: paymentStatus,
      paidAtRentalBs,
      pendingPaymentBs,
      overpaidBs: Number(Math.max(0, paidAtRentalBs - totalBs).toFixed(2)),
      prepaidAppliedBs: Number(contract?.payment?.prepaidAppliedBs ?? 0),
      initialPaymentMethod: contract?.payment?.initialPaymentMethod ?? 'efectivo',
      initialPaymentAccount: contract?.payment?.initialPaymentAccount ?? '',
      guaranteeStatus: contract?.payment?.guaranteeStatus ?? guaranteeStatus,
      guaranteePaymentMethod: contract?.payment?.guaranteePaymentMethod ?? contract?.guarantee?.paymentMethod ?? 'efectivo',
      guaranteePaymentAccount: contract?.payment?.guaranteePaymentAccount ?? contract?.guarantee?.paymentAccount ?? '',
    },
    notes: contract.observations ?? '',
    billingMode: contract.billingMode ?? 'sin_factura',
    logisticsMode: contract.logisticsMode ?? 'envio',
    supplierFulfillmentPlan: contract.supplierFulfillmentPlan ?? [],
    inventoryAvailabilityAssumptions: [],
    status: 'active',
    createdById: contract.createdById ?? null,
    createdByName: contract.createdByName || contract.createdBy || 'Sistema',
    createdByRole: contract.createdByRole || 'Operacion',
    operational: {
      inventoryStatus: 'pendiente',
      transportStatus: (contract.logisticsMode ?? 'envio') === 'recojo' ? 'no_aplica' : 'pendiente',
      inventoryNote: '',
      transportNote: '',
      inventorySentAt: null,
      inventoryDispatchedAt: null,
      inventoryDispatchedByName: null,
      inventoryDispatchedByRole: null,
      transportSentAt: null,
      inventoryConfirmedAt: null,
      transportConfirmedAt: null,
      inventoryConfirmedByName: null,
      inventoryConfirmedByRole: null,
      transportConfirmedByName: null,
      transportConfirmedByRole: null,
    },
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
};

const reserveRepairRentalInventory = (state, contract, rental, now) => {
  const linkedMovementCount = state.inventoryMovements.filter((movement) => (
    String(movement.contractCode ?? '') === String(contract.contractCode)
    || String(movement.contractId ?? '') === String(contract.id)
    || String(movement.rentalId ?? '') === String(rental.id)
    || String(movement.reference ?? '') === String(rental.orderCode)
    || String(movement.orderCode ?? '') === String(rental.orderCode)
  )).length;

  if (linkedMovementCount > 0) return 0;

  rental.items = (rental.items ?? []).map((line) => {
    const item = state.items.find((entry) => entry.id === line.itemId);
    if (!item) return line;
    const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
    const beforeAvailableStock = Number(item.availableStock ?? 0);
    const beforeTotalStock = Number(item.totalStock ?? 0);
    item.availableStock = Math.max(0, beforeAvailableStock - quantity);
    item.updatedAt = now;
    state.inventoryMovements.push({
      id: makeId('mov'),
      itemId: item.id,
      itemName: item.name,
      category: item.category,
      type: 'reserva',
      reason: `Reservado para contrato ${contract.contractCode} (${rental.orderCode})`,
      detail: `Reserva interna de ${quantity} unidades para contrato ${contract.contractCode}`,
      reference: rental.orderCode,
      contractCode: contract.contractCode,
      contractId: contract.id,
      rentalId: rental.id,
      orderCode: rental.orderCode,
      deltaUnits: -quantity,
      beforeTotalStock,
      afterTotalStock: Number(item.totalStock ?? 0),
      beforeAvailableStock,
      afterAvailableStock: Number(item.availableStock ?? 0),
      reservedStockAfter: Math.max(0, Number(item.totalStock ?? 0) - Number(item.availableStock ?? 0)),
      userName: rental.createdByName || contract.createdByName || 'Sistema',
      userRole: rental.createdByRole || contract.createdByRole || 'Operacion',
      createdAt: now,
    });
    return {
      ...line,
      controlsStock: true,
      internalReservedQty: quantity,
      verificationStatus: line.verificationStatus === 'pending_verification' ? 'verified' : line.verificationStatus,
    };
  });

  return rental.items.length;
};

const repairContract1544InventoryFlow = (state, now) => {
  if (!Array.isArray(state.contracts) || !Array.isArray(state.rentals) || !Array.isArray(state.items)) return 0;
  state.inventoryMovements = Array.isArray(state.inventoryMovements) ? state.inventoryMovements : [];

  const contract = state.contracts.find((entry) => entry?.contractCode === '1544' && !entry.deletedAt);
  if (!contract) return 0;

  let rental = findActiveRentalForContract(state, contract);

  let repairCount = 0;
  if (!rental) {
    const orderCode = consumeRepairDocumentCode(state, 'serviceOrderPrefix', 'serviceOrderNext', 5);
    rental = buildRepairRentalFromContract(state, contract, now, orderCode);
    state.rentals.push(rental);
    repairCount += 1;
  }

  repairCount += reserveRepairRentalInventory(state, contract, rental, now);

  const contractNeedsUpdate =
    contract.status !== 'aprobado'
    || !contract.approvedAt
    || contract.rejectedAt
    || String(contract.rentalId ?? '') !== String(rental.id)
    || String(contract.orderCode ?? '') !== String(rental.orderCode ?? '');

  if (contractNeedsUpdate) {
    contract.status = 'aprobado';
    contract.approvedAt = contract.approvedAt ?? rental.createdAt ?? rental.rentalAt ?? now;
    contract.rejectedAt = null;
    contract.rentalId = rental.id;
    contract.orderCode = rental.orderCode;
    contract.updatedAt = now;
  }

  if (repairCount > 0 || contractNeedsUpdate) {
    state.settings.maintenance.contract1544RepairAt = now;
    state.settings.maintenance.contract1544RepairCount = Number(state.settings.maintenance.contract1544RepairCount ?? 0) + repairCount;
  }
  return repairCount;
};

const repairApprovedContractsMissingRentals = (state, now) => {
  if (!Array.isArray(state.contracts) || !Array.isArray(state.rentals) || !Array.isArray(state.items)) return 0;
  state.inventoryMovements = Array.isArray(state.inventoryMovements) ? state.inventoryMovements : [];

  let repairCount = 0;
  state.contracts
    .filter((contract) => (
      !contract.deletedAt
      && contract.status === 'aprobado'
      && String(contract.orderCode ?? '').trim()
      && !findActiveRentalForContract(state, contract)
    ))
    .forEach((contract) => {
      const orderCode = String(contract.orderCode).trim();
      const rental = buildRepairRentalFromContract(state, contract, now, orderCode);
      state.rentals.push(rental);
      contract.rentalId = rental.id;
      contract.orderCode = rental.orderCode;
      contract.approvedAt = contract.approvedAt ?? rental.createdAt ?? now;
      contract.rejectedAt = null;
      contract.updatedAt = now;
      repairCount += 1;
      repairCount += reserveRepairRentalInventory(state, contract, rental, now);
    });

  if (repairCount > 0) {
    state.settings.maintenance.approvedContractRentalRepairAt = now;
    state.settings.maintenance.approvedContractRentalRepairCount = Number(state.settings.maintenance.approvedContractRentalRepairCount ?? 0) + repairCount;
  }

  return repairCount;
};

const normalizeState = (state) => {
  const source = deepClone(state ?? {});
  const now = new Date().toISOString();
  source.schemaVersion = 3;

  source.settings = {
    ...createDefaultSettings(),
    ...(source.settings ?? {}),
    numbering: {
      ...createDefaultSettings().numbering,
      ...(source.settings?.numbering ?? {}),
    },
  };
  source.settings.maintenance = {
    ...(source.settings?.maintenance && typeof source.settings.maintenance === 'object'
      ? source.settings.maintenance
      : {}),
  };

  if (!Array.isArray(source.categories)) {
    source.categories = [];
  } else {
    source.categories = source.categories
      .map((category) => ({
        id: category?.id ?? makeId('cat'),
        name: toBusinessUppercase(category?.name ?? ''),
        icon: String(category?.icon ?? 'box').trim() || 'box',
        color: String(category?.color ?? '#5d59e0').trim() || '#5d59e0',
        status: String(category?.status ?? 'active').trim() || 'active',
        createdAt: category?.createdAt ?? now,
        updatedAt: category?.updatedAt ?? category?.createdAt ?? now,
      }))
      .filter((category) => category.name);
  }

  const uniqueCategories = [];
  const seenCategoryNames = new Set();
  source.categories.forEach((category) => {
    const key = normalizeText(category.name);
    if (seenCategoryNames.has(key)) return;
    seenCategoryNames.add(key);
    uniqueCategories.push(category);
  });
  source.categories = uniqueCategories;

  const defaultCategory = source.categories[0]?.name ?? 'General';

  source.clients = Array.isArray(source.clients)
    ? source.clients.map((client) => {
      const prepaidEnabled = Boolean(client?.prepaidEnabled);
      const prepaidBalanceBs = Math.max(0, toPositiveRoundedNumber(client?.prepaidBalanceBs ?? 0));
      const prepaidMovements = normalizePrepaidMovements(client?.prepaidMovements, prepaidBalanceBs);

      return {
      id: client?.id ?? makeId('cli'),
      customerType: String(client?.customerType ?? 'persona').trim() || 'persona',
      name: String(client?.name ?? '').trim(),
      companyName: String(client?.companyName ?? '').trim(),
      contactName: String(client?.contactName ?? '').trim(),
      contactRole: String(client?.contactRole ?? '').trim(),
      nitCi: String(client?.nitCi ?? '').trim(),
      phone: String(client?.phone ?? '').trim(),
      whatsapp: String(client?.whatsapp ?? client?.phone ?? '').trim(),
      referencePhone: String(client?.referencePhone ?? client?.telefonoReferencia ?? client?.alternatePhone ?? '').trim(),
      email: String(client?.email ?? '').trim().toLowerCase(),
      address: String(client?.address ?? '').trim(),
      city: String(client?.city ?? '').trim(),
      observations: String(client?.observations ?? '').trim(),
      isBlacklisted: Boolean(client?.isBlacklisted),
      blacklistReason: client?.isBlacklisted ? normalizeBlacklistReason(client?.blacklistReason) : '',
      blacklistNotes: client?.isBlacklisted ? String(client?.blacklistNotes ?? '').trim() : '',
      blacklistedAt: client?.isBlacklisted ? client?.blacklistedAt ?? client?.updatedAt ?? now : null,
      prepaidEnabled,
      prepaidBalanceBs,
      prepaidTotalDepositedBs: Math.max(0, toPositiveRoundedNumber(client?.prepaidTotalDepositedBs ?? prepaidMovements.filter((entry) => entry.amountBs > 0).reduce((sum, entry) => sum + entry.amountBs, 0))),
      prepaidTotalUsedBs: Math.max(0, toPositiveRoundedNumber(client?.prepaidTotalUsedBs ?? Math.abs(prepaidMovements.filter((entry) => entry.amountBs < 0).reduce((sum, entry) => sum + entry.amountBs, 0)))),
      prepaidMovements,
      deliveryAddresses: Array.isArray(client?.deliveryAddresses)
        ? client.deliveryAddresses
          .map((entry) => ({
            id: entry?.id ?? makeId('addr'),
            label: String(entry?.label ?? entry?.etiqueta ?? 'Principal').trim() || 'Principal',
            address: String(entry?.address ?? entry?.direccion ?? '').trim(),
            city: String(entry?.city ?? entry?.ciudad ?? '').trim(),
            reference: String(entry?.reference ?? entry?.referencia ?? '').trim(),
            isPrimary: Boolean(entry?.isPrimary ?? entry?.predeterminada),
          }))
          .filter((entry) => entry.address || entry.city)
        : [],
      attachments: Array.isArray(client?.attachments)
        ? client.attachments
          .map((entry) => ({
            id: entry?.id ?? makeId('att'),
            name: String(entry?.name ?? '').trim(),
            mimeType: String(entry?.mimeType ?? '').trim(),
            size: Number(entry?.size ?? 0),
            dataUrl: entry?.dataUrl ?? null,
            url: entry?.url ?? null,
            uploadedAt: entry?.uploadedAt ?? now,
          }))
          .filter((entry) => entry.name)
        : [],
      status: String(client?.status ?? 'active').trim() || 'active',
      createdAt: client?.createdAt ?? now,
      updatedAt: client?.updatedAt ?? client?.createdAt ?? now,
      };
    }).filter((client) => client.name && client.phone)
    : [];

  source.users = Array.isArray(source.users)
    ? source.users.map((user) => ({
      id: user?.id ?? makeId('usr'),
      fullName: String(user?.fullName ?? '').trim(),
      username: normalizeUsername(user?.username)
        || normalizeUsername(String(user?.email ?? '').split('@')[0])
        || usernameFromName(user?.fullName),
      passwordHash: String(user?.passwordHash ?? '').trim()
        || (String(user?.password ?? '').trim() ? hashPassword(user.password) : ''),
      mustChangePassword: Boolean(
        user?.mustChangePassword
        || (!String(user?.passwordHash ?? '').trim() && !String(user?.password ?? '').trim()),
      ),
      passwordChangedAt: user?.passwordChangedAt ?? null,
      roleIds: getUserRoleIds(user),
      roleId: getUserRoleIds(user).includes('developer')
        ? 'developer'
        : getUserRoleIds(user).includes('super_admin')
          ? 'super_admin'
          : getPrimaryRoleId(user),
      role: getDisplayRoleForIds(getUserRoleIds(user)),
      permissions: normalizeUserPermissions(user?.permissions),
      status: String(user?.status ?? 'active').trim() || 'active',
      phone: String(user?.phone ?? '').trim(),
      isCurrentUser: Boolean(user?.isCurrentUser),
      invitedAt: user?.invitedAt ?? null,
      lastAccessAt: user?.lastAccessAt ?? null,
      createdAt: user?.createdAt ?? now,
      updatedAt: user?.updatedAt ?? user?.createdAt ?? now,
      deletedAt: user?.deletedAt ?? null,
    })).filter((user) => user.fullName && user.username)
    : [];

  if (source.users.length === 0) {
    source.users = [createBootstrapSuperAdmin(now)];
  }

  source.resetLogs = Array.isArray(source.resetLogs)
    ? source.resetLogs.map((log) => ({
      id: String(log?.id ?? makeId('rst')).trim(),
      userId: String(log?.userId ?? '').trim(),
      userName: String(log?.userName ?? '').trim(),
      userRole: String(log?.userRole ?? '').trim(),
      action: String(log?.action ?? 'execute').trim() || 'execute',
      modules: Array.isArray(log?.modules) ? log.modules.map((entry) => String(entry)) : [],
      summary: log?.summary && typeof log.summary === 'object' ? log.summary : {},
      result: String(log?.result ?? 'unknown').trim() || 'unknown',
      errors: Array.isArray(log?.errors) ? log.errors.map((entry) => String(entry)) : [],
      observations: String(log?.observations ?? '').trim(),
      ip: String(log?.ip ?? '').trim(),
      createdAt: log?.createdAt ?? now,
    }))
    : [];

  source.vehicles = Array.isArray(source.vehicles)
    ? source.vehicles.map((vehicle) => ({
      id: vehicle?.id ?? makeId('veh'),
      code: String(vehicle?.code ?? '').trim(),
      name: String(vehicle?.name ?? '').trim(),
      model: String(vehicle?.model ?? '').trim(),
      type: String(vehicle?.type ?? '').trim(),
      capacityKg: Math.max(0, Math.trunc(Number(vehicle?.capacityKg ?? 0))),
      year: Math.max(2000, Math.trunc(Number(vehicle?.year ?? new Date().getFullYear()))),
      status: String(vehicle?.status ?? 'activo').trim() || 'activo',
      mileageKm: Math.max(0, Math.trunc(Number(vehicle?.mileageKm ?? 0))),
      nextMaintenanceAt: String(vehicle?.nextMaintenanceAt ?? '').trim() || null,
      imageDataUrl: vehicle?.imageDataUrl ?? null,
      createdAt: vehicle?.createdAt ?? now,
      updatedAt: vehicle?.updatedAt ?? vehicle?.createdAt ?? now,
      deletedAt: vehicle?.deletedAt ?? null,
    })).filter((vehicle) => vehicle.code && vehicle.name)
    : [];

  source.drivers = Array.isArray(source.drivers)
    ? source.drivers.map((driver) => ({
      id: driver?.id ?? makeId('drv'),
      fullName: String(driver?.fullName ?? '').trim(),
      code: String(driver?.code ?? '').trim(),
      licenseNumber: String(driver?.licenseNumber ?? '').trim(),
      licenseCategory: String(driver?.licenseCategory ?? '').trim(),
      phone: String(driver?.phone ?? '').trim(),
      status: String(driver?.status ?? 'activo').trim() || 'activo',
      rating: driver?.rating === null ? null : Number(driver?.rating ?? 0),
      licenseExpiryAt: String(driver?.licenseExpiryAt ?? '').trim() || null,
      imageDataUrl: driver?.imageDataUrl ?? null,
      createdAt: driver?.createdAt ?? now,
      updatedAt: driver?.updatedAt ?? driver?.createdAt ?? now,
      deletedAt: driver?.deletedAt ?? null,
    })).filter((driver) => driver.fullName && driver.licenseNumber)
    : [];

  source.items = Array.isArray(source.items)
    ? source.items.map((item) => {
      const totalStock = Math.max(0, Math.trunc(Number(item?.totalStock ?? 0)));
      const availableStock = Math.max(0, Math.min(totalStock, Math.trunc(Number(item?.availableStock ?? 0))));
      const rentalPriceBs = Number(item?.rentalPriceBs ?? 0);
      const damagedUnitChargeBs = Number.isFinite(Number(item?.damagedUnitChargeBs))
        ? Number(item.damagedUnitChargeBs)
        : Number((rentalPriceBs * 1.2).toFixed(2));
      const missingUnitChargeBs = Number.isFinite(Number(item?.missingUnitChargeBs))
        ? Number(item.missingUnitChargeBs)
        : Number((rentalPriceBs * 2).toFixed(2));

      const rawVerificationStatus = String(item?.verificationStatus ?? '').trim();
      const adoptionSource = String(item?.adoptionSource ?? '').trim();
      const legacyControlsStock = typeof item?.controlsStock === 'boolean' ? item.controlsStock : null;
      const isPendingOperationalItem =
        rawVerificationStatus === 'pending_verification'
        || adoptionSource === 'service_order_quick_item'
        || (totalStock <= 0 && availableStock <= 0);
      const controlsStock =
        legacyControlsStock !== null
          ? legacyControlsStock
          : rawVerificationStatus === 'verified'
          ? true
          : false;
      const verificationStatus =
        rawVerificationStatus
        || (controlsStock && !isPendingOperationalItem ? 'verified' : 'pending_verification');
      const rawCategoryName = toBusinessUppercase(item?.category ?? '');
      const categoryName =
        source.categories.find((entry) => normalizeText(entry.name) === normalizeText(rawCategoryName))?.name
        || rawCategoryName
        || defaultCategory;

      return {
        id: item?.id ?? makeId('item'),
        name: toBusinessUppercase(item?.name ?? ''),
        category: categoryName,
        brand: toBusinessUppercase(item?.brand ?? ''),
        itemColor: toBusinessUppercase(item?.itemColor ?? item?.colorDescription ?? ''),
        sku: toBusinessUppercase(item?.sku ?? item?.code ?? ''),
        totalStock,
        availableStock,
        controlsStock: controlsStock && !isPendingOperationalItem,
        verificationStatus: controlsStock && !isPendingOperationalItem ? 'verified' : verificationStatus,
        adoptionSource,
        needsCleaningOnReturn: categoryRequiresCleaning(item?.category)
          ? true
          : Boolean(item?.needsCleaningOnReturn),
        rentalPriceBs: Number.isFinite(rentalPriceBs) ? rentalPriceBs : 0,
        damagedUnitChargeBs: Number.isFinite(damagedUnitChargeBs) ? damagedUnitChargeBs : 0,
        missingUnitChargeBs: Number.isFinite(missingUnitChargeBs) ? missingUnitChargeBs : 0,
        imageUrl: String(item?.imageUrl ?? '').trim() || null,
        imageDataUrl: item?.imageDataUrl ?? null,
        imageFile: String(item?.imageFile ?? '').trim() || null,
        imageMigratedAt: item?.imageMigratedAt ?? null,
        inventoryArea: normalizeInventoryArea(item?.inventoryArea),
        createdAt: item?.createdAt ?? now,
        updatedAt: item?.updatedAt,
        deletedAt: item?.deletedAt ?? null,
      };
    }).filter((item) => item.name)
    : [];

  const normalizeComboIngredients = (ingredients) => {
    return dedupeComboIngredients(
      (Array.isArray(ingredients) ? ingredients : [])
        .map((line) => normalizeComboRule(line, source.items))
        .filter(Boolean),
    );
  };

  source.inventoryCombos = Array.isArray(source.inventoryCombos)
    ? source.inventoryCombos.map((combo) => {
      const ingredients = normalizeComboIngredients(combo?.ingredients ?? combo?.items ?? []);
      const rawCategoryName = toBusinessUppercase(combo?.category ?? 'COMBOS');
      const categoryName =
        source.categories.find((entry) => normalizeText(entry.name) === normalizeText(rawCategoryName))?.name
        || rawCategoryName
        || 'COMBOS';
      return {
        id: combo?.id ?? makeId('combo'),
        name: toBusinessUppercase(combo?.name ?? ''),
        category: categoryName,
        rentalPriceBs: Math.max(0, toPositiveRoundedNumber(combo?.rentalPriceBs ?? combo?.priceBs ?? 0)),
        pricingCondition: normalizeComboPricingCondition(combo?.pricingCondition),
        notes: String(combo?.notes ?? '').trim(),
        imageUrl: String(combo?.imageUrl ?? '').trim() || null,
        imageDataUrl: combo?.imageDataUrl ?? null,
        ingredients,
        status: String(combo?.status ?? 'active').trim() || 'active',
        createdAt: combo?.createdAt ?? now,
        updatedAt: combo?.updatedAt ?? combo?.createdAt ?? now,
        deletedAt: combo?.deletedAt ?? null,
      };
    }).filter((combo) => combo.name && combo.ingredients.length > 0)
    : [];

  source.rentals = Array.isArray(source.rentals)
    ? source.rentals.map((rental) => {
      const logisticsMode = ['envio', 'recojo'].includes(rental?.logisticsMode) ? rental.logisticsMode : 'envio';
      const deliveryCharge = normalizeDeliveryCharge({ ...rental, logisticsMode });
      const totalBs = Number(rental?.totals?.totalBs ?? 0);
      const prepaidAppliedBs = Number(rental?.payment?.prepaidAppliedBs ?? rental?.totals?.prepaidAppliedBs ?? rental?.prepaidAppliedBs ?? 0);
      const deliveryFeeCollectedBs = Number(rental?.payment?.deliveryFeeCollectedBs ?? rental?.totals?.deliveryFeeCollectedBs ?? 0);
      const rentalCollectedBs = Number(rental?.payment?.rentalCollectedBs ?? rental?.totals?.rentalCollectedBs ?? 0);
      const paidAtRentalBs = Number(
        rental?.payment?.paidAtRentalBs
        ?? rental?.totals?.paidAtRentalBs
        ?? totalBs,
      );
      const pendingPaymentBs = Number(
        rental?.payment?.pendingPaymentBs
        ?? rental?.totals?.pendingPaymentBs
        ?? Math.max(0, totalBs - paidAtRentalBs),
      );
      const normalizedPendingPaymentBs = Math.max(0, pendingPaymentBs);
      const overpaidBs = Math.max(
        0,
        Number(
          (Number(rental?.payment?.overpaidBs ?? rental?.totals?.overpaidBs ?? paidAtRentalBs - totalBs)).toFixed(2),
        ),
      );
      const guaranteeDeclaredBs = Math.max(0, Number(rental?.guaranteeDeclaredBs ?? rental?.guarantee?.amountBs ?? rental?.depositBs ?? 0));
      const guaranteeStatus = String(rental?.guarantee?.status ?? rental?.payment?.guaranteeStatus ?? '').trim() === 'no_validado'
        ? 'no_validado'
        : Number(rental?.depositBs ?? 0) > 0
        ? 'validado'
        : 'no_validado';
      const guaranteeValidatedBs = guaranteeStatus === 'validado' ? Math.max(0, Number(rental?.depositBs ?? guaranteeDeclaredBs ?? 0)) : 0;
      const initialPaymentMethod = normalizePaymentMethod(rental?.payment?.initialPaymentMethod ?? rental?.payment?.paymentMethod);
      const guaranteePaymentMethod = normalizePaymentMethod(rental?.guarantee?.paymentMethod ?? rental?.payment?.guaranteePaymentMethod);

      return {
        ...rental,
        id: rental?.id ?? makeId('rent'),
        contractId: String(rental?.contractId ?? '').trim() || null,
        contractCode: String(rental?.contractCode ?? '').trim() || null,
        customerName: String(rental?.customerName ?? '').trim(),
        customerPhone: String(rental?.customerPhone ?? '').trim(),
        items: Array.isArray(rental?.items)
          ? rental.items.map((line, index) => ({
            ...line,
            lineKey: getInventoryLineKey(line, index),
          }))
          : [],
        services: normalizeContractServices(rental?.services),
        logisticsMode,
        deliveryChargeMode: deliveryCharge.deliveryChargeMode,
        deliveryFeeBs: Number(deliveryCharge.deliveryFeeBs.toFixed(2)),
        deliveryFeeReason: deliveryCharge.deliveryFeeReason,
        prepaidClientId: rental?.prepaidClientId ?? null,
        prepaidAppliedBs: Number(prepaidAppliedBs.toFixed(2)),
        depositBs: Number(guaranteeValidatedBs.toFixed(2)),
        guaranteeDeclaredBs: Number(guaranteeDeclaredBs.toFixed(2)),
        guarantee: {
          amountBs: Number(guaranteeDeclaredBs.toFixed(2)),
          validatedBs: Number(guaranteeValidatedBs.toFixed(2)),
          status: guaranteeStatus,
          paymentMethod: guaranteePaymentMethod,
        },
        status: normalizeRentalStatus(rental?.status),
        operational: {
          inventoryStatus:
            rental?.operational?.inventoryStatus
            ?? (normalizeRentalStatus(rental?.status) === 'cancelled' ? 'anulado' : 'pendiente'),
          transportStatus:
            rental?.operational?.transportStatus
            ?? (normalizeRentalStatus(rental?.status) === 'cancelled' ? 'anulado' : 'pendiente'),
          inventoryNote: String(rental?.operational?.inventoryNote ?? '').trim(),
          transportNote: String(rental?.operational?.transportNote ?? '').trim(),
          inventorySentAt: rental?.operational?.inventorySentAt ?? null,
          inventoryDispatchedAt: rental?.operational?.inventoryDispatchedAt ?? null,
          inventoryDispatchedByName: rental?.operational?.inventoryDispatchedByName ?? null,
          inventoryDispatchedByRole: rental?.operational?.inventoryDispatchedByRole ?? null,
          transportSentAt: rental?.operational?.transportSentAt ?? null,
          inventoryConfirmedAt: rental?.operational?.inventoryConfirmedAt ?? null,
          transportConfirmedAt: rental?.operational?.transportConfirmedAt ?? null,
          inventoryConfirmedByName: rental?.operational?.inventoryConfirmedByName ?? null,
          inventoryConfirmedByRole: rental?.operational?.inventoryConfirmedByRole ?? null,
          inventoryReturnedAt: rental?.operational?.inventoryReturnedAt ?? null,
          inventoryReturnedByName: rental?.operational?.inventoryReturnedByName ?? null,
          inventoryReturnedByRole: rental?.operational?.inventoryReturnedByRole ?? null,
          transportConfirmedByName: rental?.operational?.transportConfirmedByName ?? null,
          transportConfirmedByRole: rental?.operational?.transportConfirmedByRole ?? null,
          dispatchReview: rental?.operational?.dispatchReview ?? null,
          returnReview: rental?.operational?.returnReview ?? null,
          revisionAlert: rental?.operational?.revisionAlert ?? null,
          clientPendingPickup: rental?.operational?.clientPendingPickup ?? null,
        },
        totals: {
          ...(rental?.totals ?? {}),
          deliveryFeeBs: Number(deliveryCharge.deliveryFeeBs.toFixed(2)),
          prepaidAppliedBs: Number(prepaidAppliedBs.toFixed(2)),
          totalBs,
          paidAtRentalBs: Number(paidAtRentalBs.toFixed(2)),
          pendingPaymentBs: Number(normalizedPendingPaymentBs.toFixed(2)),
          overpaidBs: Number(overpaidBs.toFixed(2)),
        },
        payment: {
          mode:
            rental?.payment?.mode
            ?? (normalizedPendingPaymentBs <= 0 ? 'cancelado' : paidAtRentalBs > 0 ? 'a_cuenta' : 'sin_pago'),
          status:
            rental?.payment?.status
            ?? (normalizedPendingPaymentBs <= 0 ? 'cancelado' : paidAtRentalBs > 0 ? 'a_cuenta' : 'sin_pago'),
          paidAtRentalBs: Number(paidAtRentalBs.toFixed(2)),
          pendingPaymentBs: Number(normalizedPendingPaymentBs.toFixed(2)),
          overpaidBs: Number(overpaidBs.toFixed(2)),
          prepaidAppliedBs: Number(prepaidAppliedBs.toFixed(2)),
          deliveryFeeCollectedBs: Number(deliveryFeeCollectedBs.toFixed(2)),
          rentalCollectedBs: Number(rentalCollectedBs.toFixed(2)),
          cashCollectedBs: Number(Math.max(0, paidAtRentalBs - prepaidAppliedBs).toFixed(2)),
          initialPaymentMethod,
          guaranteeStatus,
          guaranteePaymentMethod,
        },
        createdById: rental?.createdById ?? rental?.userId ?? null,
        createdByName: String(rental?.createdByName ?? rental?.userName ?? rental?.createdBy ?? 'Sistema').trim() || 'Sistema',
        createdByRole: String(rental?.createdByRole ?? rental?.userRole ?? 'Sistema').trim() || 'Sistema',
        supplierFulfillmentPlan: normalizeSupplierFulfillmentPlan(rental?.supplierFulfillmentPlan),
        cancelledAt: rental?.cancelledAt ?? null,
        cancellationPenaltyPercent: Number(rental?.cancellationPenaltyPercent ?? 0),
        cancellationPenaltyBs: Number(rental?.cancellationPenaltyBs ?? 0),
        cancellationReason: String(rental?.cancellationReason ?? '').trim(),
        cancellationCutoffDate: String(rental?.cancellationCutoffDate ?? '').trim() || null,
        deletedAt: rental?.deletedAt ?? null,
      };
    }).filter((rental) => rental.customerName && rental.customerPhone)
    : [];

  source.deliveries = Array.isArray(source.deliveries)
    ? source.deliveries.map((delivery) => ({
      id: delivery?.id ?? makeId('del'),
      deliveryCode: String(delivery?.deliveryCode ?? '').trim(),
      orderCode: String(delivery?.orderCode ?? '').trim(),
      rentalId: delivery?.rentalId ?? null,
      customerName: String(delivery?.customerName ?? '').trim(),
      companyName: String(delivery?.companyName ?? '').trim(),
      address: String(delivery?.address ?? '').trim(),
      city: String(delivery?.city ?? '').trim(),
      windowStart: String(delivery?.windowStart ?? '08:00').trim(),
      windowEnd: String(delivery?.windowEnd ?? '10:00').trim(),
      scheduledDate: String(delivery?.scheduledDate ?? '').trim(),
      driverId: String(delivery?.driverId ?? '').trim() || null,
      vehicleId: String(delivery?.vehicleId ?? '').trim() || null,
      routeId: String(delivery?.routeId ?? '').trim() || null,
      routeType: ['envio', 'recojo'].includes(delivery?.routeType) ? delivery.routeType : null,
      routeSequence: Number.isFinite(Number(delivery?.routeSequence)) ? Math.max(0, Math.trunc(Number(delivery.routeSequence))) : null,
      status: String(delivery?.status ?? 'programada').trim() || 'programada',
      progress: Math.max(0, Math.min(100, Math.trunc(Number(delivery?.progress ?? 0)))),
      notes: String(delivery?.notes ?? '').trim(),
      createdAt: delivery?.createdAt ?? now,
      updatedAt: delivery?.updatedAt ?? delivery?.createdAt ?? now,
      deletedAt: delivery?.deletedAt ?? null,
    })).filter((delivery) => delivery.deliveryCode && delivery.customerName)
    : [];

  source.transportRoutes = Array.isArray(source.transportRoutes)
    ? source.transportRoutes.map((route) => ({
      id: String(route?.id ?? makeId('troute')).trim() || makeId('troute'),
      routeCode: String(route?.routeCode ?? '').trim(),
      type: ['envio', 'recojo', 'mixta'].includes(route?.type) ? route.type : 'envio',
      date: String(route?.date ?? '').trim(),
      driverId: String(route?.driverId ?? '').trim() || null,
      vehicleId: String(route?.vehicleId ?? '').trim() || null,
      status: ['borrador', 'planificada', 'en_ruta', 'completada', 'cancelada'].includes(route?.status)
        ? route.status
        : 'borrador',
      notes: String(route?.notes ?? '').trim(),
      stops: Array.isArray(route?.stops)
        ? route.stops
          .map((stop, index) => ({
            id: String(stop?.id ?? makeId('stop')).trim() || makeId('stop'),
            deliveryId: String(stop?.deliveryId ?? '').trim(),
            sequence: Math.max(1, Math.trunc(Number(stop?.sequence ?? index + 1))),
            eta: String(stop?.eta ?? '').trim(),
            notes: String(stop?.notes ?? '').trim(),
          }))
          .filter((stop) => stop.deliveryId)
          .sort((a, b) => a.sequence - b.sequence)
          .map((stop, index) => ({ ...stop, sequence: index + 1 }))
        : [],
      createdAt: route?.createdAt ?? now,
      updatedAt: route?.updatedAt ?? route?.createdAt ?? now,
      deletedAt: route?.deletedAt ?? null,
    })).filter((route) => route.routeCode && route.date)
    : [];

  source.rentals.forEach((rental) => syncRentalTransportStatus(source, rental, now));

  source.calendarEvents = Array.isArray(source.calendarEvents)
    ? source.calendarEvents.map((event) => ({
      id: event?.id ?? makeId('evt'),
      title: String(event?.title ?? '').trim(),
      subtitle: String(event?.subtitle ?? '').trim(),
      type: String(event?.type ?? 'other').trim(),
      date: String(event?.date ?? '').trim(),
      startTime: String(event?.startTime ?? '08:00').trim(),
      endTime: String(event?.endTime ?? '09:00').trim(),
      status: String(event?.status ?? '').trim() || null,
      relatedType: String(event?.relatedType ?? '').trim() || null,
      relatedId: String(event?.relatedId ?? '').trim() || null,
      createdAt: event?.createdAt ?? now,
      updatedAt: event?.updatedAt ?? event?.createdAt ?? now,
    })).filter((event) => event.title && event.date)
    : [];

  source.calendarBoardNotes = Array.isArray(source.calendarBoardNotes)
    ? source.calendarBoardNotes.map((note) => ({
      id: note?.id ?? makeId('cbn'),
      rowId: String(note?.rowId ?? '').trim(),
      eventId: String(note?.eventId ?? '').trim() || null,
      kind: String(note?.kind ?? '').trim() || null,
      dateKey: String(note?.dateKey ?? '').trim() || null,
      text: String(note?.text ?? '').trim(),
      createdAt: note?.createdAt ?? now,
      updatedAt: note?.updatedAt ?? note?.createdAt ?? now,
    })).filter((note) => note.rowId && note.text)
    : [];

  source.generatedReports = Array.isArray(source.generatedReports)
    ? source.generatedReports.map((report) => ({
      id: report?.id ?? makeId('rep'),
      name: String(report?.name ?? '').trim(),
      category: String(report?.category ?? 'General').trim(),
      periodFrom: String(report?.periodFrom ?? '').trim() || null,
      periodTo: String(report?.periodTo ?? '').trim() || null,
      format: String(report?.format ?? 'PDF').trim() || 'PDF',
      generatedBy: String(report?.generatedBy ?? 'Sistema').trim() || 'Sistema',
      generatedAt: report?.generatedAt ?? now,
      sourceType: String(report?.sourceType ?? '').trim() || null,
      sourceId: String(report?.sourceId ?? '').trim() || null,
      updatedAt: report?.updatedAt ?? null,
      deletedAt: report?.deletedAt ?? null,
    })).filter((report) => report.name)
    : [];

  source.systemAuditLog = Array.isArray(source.systemAuditLog)
    ? source.systemAuditLog.map((entry) => ({
      id: entry?.id ?? makeId('aud'),
      action: String(entry?.action ?? 'update').trim() || 'update',
      module: String(entry?.module ?? 'Sistema').trim() || 'Sistema',
      entityType: String(entry?.entityType ?? '').trim() || null,
      entityId: String(entry?.entityId ?? '').trim() || null,
      entityCode: String(entry?.entityCode ?? '').trim() || null,
      title: String(entry?.title ?? '').trim() || 'Actividad registrada',
      detail: String(entry?.detail ?? '').trim(),
      changes: Array.isArray(entry?.changes) ? entry.changes.map((change) => String(change ?? '').trim()).filter(Boolean) : [],
      userId: entry?.userId ?? null,
      userName: String(entry?.userName ?? 'Sistema').trim() || 'Sistema',
      userRole: String(entry?.userRole ?? 'Sistema').trim() || 'Sistema',
      createdAt: entry?.createdAt ?? now,
    })).filter((entry) => entry.title)
    : [];

  source.quotes = Array.isArray(source.quotes)
    ? source.quotes.map((quote) => {
      const items = Array.isArray(quote?.items)
        ? quote.items
          .map((line, index) => ({
            lineKey: getInventoryLineKey(line, index),
            itemId: String(line?.itemId ?? '').trim(),
            itemName: String(line?.itemName ?? '').trim(),
            quantity: Math.max(1, Math.trunc(Number(line?.quantity ?? 1))),
            unitPriceBs: Number(line?.unitPriceBs ?? 0),
            grossLineTotalBs: Number(line?.grossLineTotalBs ?? 0),
            discountPercent: Math.max(0, Number(line?.discountPercent ?? 0)),
            discountBs: Math.max(0, Number(line?.discountBs ?? 0)),
            lineTotalBs: Number(line?.lineTotalBs ?? 0),
            lineType: String(line?.lineType ?? '').trim(),
            comboId: String(line?.comboId ?? '').trim() || null,
            comboName: String(line?.comboName ?? '').trim(),
            comboLineKey: String(line?.comboLineKey ?? '').trim() || null,
            comboComponentName: String(line?.comboComponentName ?? '').trim(),
            comboQuantity: Math.max(1, Math.trunc(Number(line?.comboQuantity ?? 1))),
            comboComponentQuantity: Math.max(1, Math.trunc(Number(line?.comboComponentQuantity ?? (Number(line?.quantity ?? 1) / Math.max(1, Number(line?.comboQuantity ?? 1)))))),
            comboRuleIndex: Math.max(0, Math.trunc(Number(line?.comboRuleIndex ?? 0))),
            comboSlotLabel: String(line?.comboSlotLabel ?? '').trim(),
            comboSelectionMode: String(line?.comboSelectionMode ?? 'item').trim() || 'item',
            comboOptionItemIds: Array.isArray(line?.comboOptionItemIds) ? line.comboOptionItemIds.map(String) : [],
            comboCategory: String(line?.comboCategory ?? '').trim(),
            comboPricingRole: String(line?.comboPricingRole ?? '').trim(),
            comboPricingCondition: line?.comboPricingCondition ? normalizeComboPricingCondition(line.comboPricingCondition) : null,
            observation: String(line?.observation ?? line?.observations ?? line?.note ?? '').trim(),
            serviceDayId: String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim() || null,
            serviceDate: String(line?.serviceDate ?? line?.date ?? '').trim() || null,
            serviceDayLabel: String(line?.serviceDayLabel ?? line?.dayLabel ?? '').trim(),
          }))
          .filter((line) => line.itemId && line.itemName)
        : [];
      const services = normalizeContractServices(quote?.services);

      const itemsBaseSubtotalBs = items.reduce(
        (sum, line) => sum + Number(line.lineTotalBs ?? Number(line.quantity ?? 0) * Number(line.unitPriceBs ?? 0)),
        0,
      );
      const computedItemsGrossSubtotalBs = items.reduce((sum, line) => {
        const fallbackGross = Number(line.lineTotalBs ?? 0) + Number(line.discountBs ?? 0);
        const unitGross = Number(line.quantity ?? 0) * Number(line.unitPriceBs ?? 0);
        const storedGross = Number(line.grossLineTotalBs ?? 0);
        return sum + Math.max(0, storedGross || fallbackGross || unitGross);
      }, 0);
      const computedItemDiscountsBs = items.reduce((sum, line) => sum + Number(line.discountBs ?? 0), 0);
      const itemsGrossSubtotalBs = Number(quote?.totals?.itemsGrossSubtotalBs ?? computedItemsGrossSubtotalBs);
      const itemDiscountsBs = Number(quote?.totals?.itemDiscountsBs ?? computedItemDiscountsBs);
      const itemsNetSubtotalBs = Number(quote?.totals?.itemsNetSubtotalBs ?? quote?.totals?.itemsSubtotalBs ?? itemsBaseSubtotalBs);
      const servicesSubtotalBs = services.reduce((sum, line) => sum + Number(line.lineTotalBs ?? 0), 0);
      const pricingPlan = calculateDurationPricing({ pricingPlan: quote?.pricingPlan, baseSubtotalBs: itemsBaseSubtotalBs });
      const baseSubtotalBs = itemsBaseSubtotalBs + servicesSubtotalBs;
      const subtotalBs = Number(quote?.totals?.subtotalBs ?? pricingPlan.chargeableSubtotalBs + servicesSubtotalBs);
      const discountBs = Number(quote?.totals?.discountBs ?? 0);
      const guaranteeBs = Number(quote?.totals?.guaranteeBs ?? 0);
      const rawGuaranteeStatus = String(quote?.guarantee?.status ?? quote?.payment?.guaranteeStatus ?? '').trim();
      const guaranteeStatus = rawGuaranteeStatus === 'validado'
        ? 'validado'
        : rawGuaranteeStatus === 'no_validado'
        ? 'no_validado'
        : guaranteeBs > 0
        ? 'validado'
        : 'no_validado';
      const guaranteePaymentMethod = normalizePaymentMethod(quote?.guarantee?.paymentMethod ?? quote?.payment?.guaranteePaymentMethod);
      const logisticsMode = ['envio', 'recojo'].includes(quote?.logisticsMode) ? quote.logisticsMode : 'envio';
      const deliveryCharge = normalizeDeliveryCharge({ ...quote, logisticsMode });
      const totalBs = Number(quote?.totals?.totalBs ?? Math.max(0, subtotalBs - discountBs + deliveryCharge.deliveryFeeBs));
      const paidAtApprovalBs = Number(quote?.payment?.paidAtApprovalBs ?? 0);
      const pendingBs = Number(quote?.payment?.pendingBs ?? Math.max(0, totalBs - paidAtApprovalBs));
      const overpaidBs = Math.max(0, Number((Number(quote?.payment?.overpaidBs ?? paidAtApprovalBs - totalBs)).toFixed(2)));
      const responsibles = normalizeRecordResponsibles(quote);
      const primaryResponsible = responsibles[0] ?? null;

      return {
        id: quote?.id ?? makeId('quo'),
        quoteCode: String(quote?.quoteCode ?? '').trim(),
        clientId: quote?.clientId ?? null,
        customerName: String(quote?.customerName ?? '').trim(),
        customerCi: String(quote?.customerCi ?? quote?.nitCi ?? '').trim(),
        customerPhone: String(quote?.customerPhone ?? '').trim(),
        customerReferencePhone: String(quote?.customerReferencePhone ?? quote?.referencePhone ?? '').trim(),
        companyName: String(quote?.companyName ?? '').trim(),
        eventType: String(quote?.eventType ?? 'general').trim() || 'general',
        eventDate: String(quote?.eventDate ?? '').trim(),
        eventTime: String(quote?.eventTime ?? '').trim(),
        address: String(quote?.address ?? '').trim(),
        city: String(quote?.city ?? '').trim(),
        deliveryDate: String(quote?.deliveryDate ?? '').trim(),
        logisticsMode,
        deliveryChargeMode: deliveryCharge.deliveryChargeMode,
        deliveryFeeBs: Number(deliveryCharge.deliveryFeeBs.toFixed(2)),
        deliveryFeeReason: deliveryCharge.deliveryFeeReason,
        deliveryWindowStart: String(quote?.deliveryWindowStart ?? '08:00').trim(),
        deliveryWindowEnd: String(quote?.deliveryWindowEnd ?? '10:00').trim(),
        deliveryTimeMode: quote?.deliveryTimeMode === 'coordinate' ? 'coordinate' : 'fixed',
        pickupDate: String(quote?.pickupDate ?? '').trim(),
        pickupWindowStart: String(quote?.pickupWindowStart ?? '20:00').trim(),
        pickupWindowEnd: String(quote?.pickupWindowEnd ?? '22:00').trim(),
        pickupTimeMode: quote?.pickupTimeMode === 'coordinate' ? 'coordinate' : 'fixed',
        driverId: String(quote?.driverId ?? '').trim() || null,
        vehicleId: String(quote?.vehicleId ?? '').trim() || null,
        validUntil: String(quote?.validUntil ?? '').trim() || null,
        observations: String(quote?.observations ?? '').trim(),
        billingMode: ['con_factura', 'sin_factura'].includes(quote?.billingMode) ? quote.billingMode : 'sin_factura',
        status: String(quote?.status ?? 'borrador').trim() || 'borrador',
        totals: {
          itemsGrossSubtotalBs: Number(Math.max(0, itemsGrossSubtotalBs).toFixed(2)),
          itemDiscountsBs: Number(Math.max(0, itemDiscountsBs).toFixed(2)),
          itemsNetSubtotalBs: Number(Math.max(0, itemsNetSubtotalBs).toFixed(2)),
          itemsSubtotalBs: Number(Math.max(0, itemsNetSubtotalBs).toFixed(2)),
          servicesSubtotalBs: Number(servicesSubtotalBs.toFixed(2)),
          baseSubtotalBs: Number(baseSubtotalBs.toFixed(2)),
          subtotalBs: Number(subtotalBs.toFixed(2)),
          durationDiscountBs: Number(pricingPlan.durationDiscountBs.toFixed(2)),
          theoreticalSubtotalBs: Number(pricingPlan.theoreticalSubtotalBs.toFixed(2)),
          discountMode: quote?.totals?.discountMode === 'fixed'
            ? 'fixed'
            : Math.max(0, Number(quote?.totals?.discountPercent ?? quote?.discountPercent ?? 0)) > 0
              ? 'percent'
              : Number(discountBs) > 0 ? 'fixed' : 'percent',
          discountBs: Number(discountBs.toFixed(2)),
          discountPercent: Math.max(0, Number(quote?.totals?.discountPercent ?? quote?.discountPercent ?? 0)),
          deliveryFeeBs: Number(deliveryCharge.deliveryFeeBs.toFixed(2)),
          guaranteeBs: Number(guaranteeBs.toFixed(2)),
          totalBs: Number(totalBs.toFixed(2)),
        },
        pricingPlan,
        payment: {
          paidAtApprovalBs: Number(paidAtApprovalBs.toFixed(2)),
          pendingBs: Number(Math.max(0, pendingBs).toFixed(2)),
          overpaidBs: Number(overpaidBs.toFixed(2)),
          initialPaymentMethod: normalizePaymentMethod(quote?.payment?.initialPaymentMethod ?? quote?.payment?.paymentMethod),
          initialPaymentAccount: normalizeQrPaymentAccount(quote?.payment?.initialPaymentAccount ?? quote?.payment?.paymentAccount),
          guaranteeStatus,
          guaranteePaymentMethod,
          guaranteePaymentAccount: normalizeQrPaymentAccount(quote?.guarantee?.paymentAccount ?? quote?.payment?.guaranteePaymentAccount),
        },
        guarantee: {
          amountBs: Number(guaranteeBs.toFixed(2)),
          status: guaranteeStatus,
          paymentMethod: guaranteePaymentMethod,
          paymentAccount: normalizeQrPaymentAccount(quote?.guarantee?.paymentAccount ?? quote?.payment?.guaranteePaymentAccount),
        },
        items,
        services,
        supplierFulfillmentPlan: normalizeSupplierFulfillmentPlan(quote?.supplierFulfillmentPlan),
        approvedAt: quote?.approvedAt ?? null,
        rejectedAt: quote?.rejectedAt ?? null,
        rentalId: quote?.rentalId ?? null,
        orderCode: quote?.orderCode ?? null,
        createdBy: String(quote?.createdBy ?? 'system').trim() || 'system',
        createdById: quote?.createdById ?? quote?.userId ?? primaryResponsible?.id ?? null,
        createdByName: String(quote?.createdByName ?? quote?.userName ?? primaryResponsible?.name ?? quote?.createdBy ?? 'Sistema').trim() || 'Sistema',
        createdByRole: String(quote?.createdByRole ?? quote?.userRole ?? primaryResponsible?.role ?? 'Sistema').trim() || 'Sistema',
        responsibles,
        createdAt: quote?.createdAt ?? now,
        updatedAt: quote?.updatedAt ?? quote?.createdAt ?? now,
        deletedAt: quote?.deletedAt ?? null,
      };
    }).filter((quote) => quote.quoteCode && quote.customerName)
    : [];

  source.contracts = Array.isArray(source.contracts)
    ? source.contracts.map((contract) => {
      const items = Array.isArray(contract?.items)
        ? contract.items
          .map((line, index) => ({
            lineKey: getInventoryLineKey(line, index),
            itemId: String(line?.itemId ?? '').trim(),
            itemName: String(line?.itemName ?? '').trim(),
            quantity: Math.max(1, Math.trunc(Number(line?.quantity ?? 1))),
            unitPriceBs: Number(line?.unitPriceBs ?? 0),
            grossLineTotalBs: Number(line?.grossLineTotalBs ?? 0),
            discountPercent: Math.max(0, Number(line?.discountPercent ?? 0)),
            discountBs: Math.max(0, Number(line?.discountBs ?? 0)),
            lineTotalBs: Number(line?.lineTotalBs ?? 0),
            lineType: String(line?.lineType ?? '').trim(),
            comboId: String(line?.comboId ?? '').trim() || null,
            comboName: String(line?.comboName ?? '').trim(),
            comboLineKey: String(line?.comboLineKey ?? '').trim() || null,
            comboComponentName: String(line?.comboComponentName ?? '').trim(),
            comboQuantity: Math.max(1, Math.trunc(Number(line?.comboQuantity ?? 1))),
            comboComponentQuantity: Math.max(1, Math.trunc(Number(line?.comboComponentQuantity ?? (Number(line?.quantity ?? 1) / Math.max(1, Number(line?.comboQuantity ?? 1)))))),
            comboRuleIndex: Math.max(0, Math.trunc(Number(line?.comboRuleIndex ?? 0))),
            comboSlotLabel: String(line?.comboSlotLabel ?? '').trim(),
            comboSelectionMode: String(line?.comboSelectionMode ?? 'item').trim() || 'item',
            comboOptionItemIds: Array.isArray(line?.comboOptionItemIds) ? line.comboOptionItemIds.map(String) : [],
            comboCategory: String(line?.comboCategory ?? '').trim(),
            comboPricingRole: String(line?.comboPricingRole ?? '').trim(),
            comboPricingCondition: line?.comboPricingCondition ? normalizeComboPricingCondition(line.comboPricingCondition) : null,
            observation: String(line?.observation ?? line?.observations ?? line?.note ?? '').trim(),
            serviceDayId: String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim() || null,
            serviceDate: String(line?.serviceDate ?? line?.date ?? '').trim() || null,
            serviceDayLabel: String(line?.serviceDayLabel ?? line?.dayLabel ?? '').trim(),
          }))
          .filter((line) => line.itemId)
        : [];
      const services = normalizeContractServices(contract?.services);

      const itemsBaseSubtotalBs = items.reduce(
        (sum, line) => sum + Number(line.lineTotalBs ?? Number(line.quantity ?? 0) * Number(line.unitPriceBs ?? 0)),
        0,
      );
      const computedItemsGrossSubtotalBs = items.reduce((sum, line) => {
        const fallbackGross = Number(line.lineTotalBs ?? 0) + Number(line.discountBs ?? 0);
        const unitGross = Number(line.quantity ?? 0) * Number(line.unitPriceBs ?? 0);
        const storedGross = Number(line.grossLineTotalBs ?? 0);
        return sum + Math.max(0, storedGross || fallbackGross || unitGross);
      }, 0);
      const computedItemDiscountsBs = items.reduce((sum, line) => sum + Number(line.discountBs ?? 0), 0);
      const itemsGrossSubtotalBs = Number(contract?.totals?.itemsGrossSubtotalBs ?? computedItemsGrossSubtotalBs);
      const itemDiscountsBs = Number(contract?.totals?.itemDiscountsBs ?? computedItemDiscountsBs);
      const itemsNetSubtotalBs = Number(contract?.totals?.itemsNetSubtotalBs ?? contract?.totals?.itemsSubtotalBs ?? itemsBaseSubtotalBs);
      const servicesSubtotalBs = services.reduce((sum, line) => sum + Number(line.lineTotalBs ?? 0), 0);
      const pricingPlan = calculateDurationPricing({ pricingPlan: contract?.pricingPlan, baseSubtotalBs: itemsBaseSubtotalBs });
      const baseSubtotalBs = itemsBaseSubtotalBs + servicesSubtotalBs;
      const subtotalBs = Number(contract?.totals?.subtotalBs ?? pricingPlan.chargeableSubtotalBs + servicesSubtotalBs);
      const discountBs = Number(contract?.totals?.discountBs ?? 0);
      const guaranteeBs = Number(contract?.totals?.guaranteeBs ?? 0);
      const rawGuaranteeStatus = String(contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? '').trim();
      const guaranteeStatus = rawGuaranteeStatus === 'validado'
        ? 'validado'
        : rawGuaranteeStatus === 'no_validado'
        ? 'no_validado'
        : guaranteeBs > 0
        ? 'validado'
        : 'no_validado';
      const guaranteePaymentMethod = normalizePaymentMethod(contract?.guarantee?.paymentMethod ?? contract?.payment?.guaranteePaymentMethod);
      const logisticsMode = ['envio', 'recojo'].includes(contract?.logisticsMode) ? contract.logisticsMode : 'envio';
      const deliveryCharge = normalizeDeliveryCharge({ ...contract, logisticsMode });
      const totalBs = Number(contract?.totals?.totalBs ?? Math.max(0, subtotalBs - discountBs + deliveryCharge.deliveryFeeBs));
      const paidAtApprovalBs = Number(contract?.payment?.paidAtApprovalBs ?? 0);
      const pendingBs = Number(contract?.payment?.pendingBs ?? Math.max(0, totalBs - paidAtApprovalBs));
      const overpaidBs = Math.max(0, Number((Number(contract?.payment?.overpaidBs ?? paidAtApprovalBs - totalBs)).toFixed(2)));
      const prepaidAppliedBs = Number(contract?.payment?.prepaidAppliedBs ?? contract?.totals?.prepaidAppliedBs ?? contract?.prepaidAppliedBs ?? 0);
      const responsibles = normalizeRecordResponsibles(contract);
      const primaryResponsible = responsibles[0] ?? null;
      const normalizedEconomicLedger = Array.isArray(contract?.economicLedger)
        ? contract.economicLedger.map((entry, index) => {
          const type = ['deposit', 'guarantee', 'charge', 'refund', 'note'].includes(
            String(entry?.type ?? '').trim(),
          )
            ? String(entry.type).trim()
            : 'note';
          const paymentMethod = type === 'note'
            ? ''
            : normalizePaymentMethod(entry?.paymentMethod ?? entry?.method);
          return {
            id: String(entry?.id ?? `economic-ledger-${index}`).trim() || `economic-ledger-${index}`,
            type,
            amountBs: type === 'note'
              ? 0
              : Math.max(0, toPositiveRoundedNumber(entry?.amountBs ?? entry?.amount ?? 0)),
            paymentMethod,
            paymentAccount: paymentMethod === 'qr'
              ? normalizeQrPaymentAccount(entry?.paymentAccount ?? entry?.account)
              : '',
            note: String(entry?.note ?? '').trim(),
            cashMovementId: String(entry?.cashMovementId ?? '').trim() || null,
            cashReceiptCode: String(entry?.cashReceiptCode ?? '').trim(),
            isCashRegistered: Boolean(entry?.isCashRegistered),
            reclassifiedFromPayment: Boolean(entry?.reclassifiedFromPayment),
            createdAt: entry?.createdAt ?? now,
            createdById: entry?.createdById ?? entry?.userId ?? null,
            createdByName: String(
              entry?.createdByName
              ?? entry?.createdBy
              ?? entry?.userName
              ?? 'Sistema',
            ).trim() || 'Sistema',
            editedAt: entry?.editedAt ?? null,
            editedByName: String(entry?.editedByName ?? '').trim(),
          };
        })
        : [];
      const initialPaymentMethod = normalizePaymentMethod(
        contract?.payment?.initialPaymentMethod ?? contract?.payment?.paymentMethod,
      );
      const initialPaymentAccount = initialPaymentMethod === 'qr'
        ? normalizeQrPaymentAccount(
          contract?.payment?.initialPaymentAccount ?? contract?.payment?.paymentAccount,
        )
        : '';
      const guaranteePaymentAccount = guaranteePaymentMethod === 'qr'
        ? normalizeQrPaymentAccount(contract?.guarantee?.paymentAccount ?? contract?.payment?.guaranteePaymentAccount)
        : '';
      const hasInitialPaymentEntry = paidAtApprovalBs > 0 && normalizedEconomicLedger.some((entry) => {
        if (entry.type !== 'deposit') return false;
        const sameAmount = Math.abs(Number(entry.amountBs ?? 0) - paidAtApprovalBs) < 0.01;
        const entryId = normalizeText(entry.id);
        const entryNote = normalizeText(entry.note);
        return sameAmount && (
          entryId.includes('initial-payment')
          || entryNote.includes('pago inicial')
          || entryNote.includes('primer pago')
          || entryNote.includes('pimer pago')
        );
      });
      const hasValidatedGuaranteeEntry = guaranteeStatus === 'validado' && guaranteeBs > 0 && normalizedEconomicLedger.some((entry) => {
        if (entry.type !== 'guarantee') return false;
        const sameAmount = Math.abs(Number(entry.amountBs ?? 0) - guaranteeBs) < 0.01;
        const entryId = normalizeText(entry.id);
        const entryNote = normalizeText(entry.note);
        return sameAmount && (
          entryId.includes('validated-guarantee')
          || entryId.includes('garantia-validada')
          || entryNote.includes('garantia validada')
          || entryNote.includes('garantia ingresada')
          || entryNote.includes('ingreso garantia')
        );
      });
      if (paidAtApprovalBs > 0 && !hasInitialPaymentEntry) {
        normalizedEconomicLedger.unshift({
          id: `initial-payment-${contract?.id ?? contract?.contractCode ?? makeId('con')}`,
          type: 'deposit',
          amountBs: Number(paidAtApprovalBs.toFixed(2)),
          paymentMethod: initialPaymentMethod,
          paymentAccount: initialPaymentAccount,
          note: 'Pago inicial registrado al crear el contrato.',
          createdAt: contract?.approvedAt
            ?? contract?.contractDate
            ?? contract?.createdAt
            ?? now,
          createdById: contract?.createdById ?? contract?.userId ?? primaryResponsible?.id ?? null,
          createdByName: String(
            contract?.createdByName
            ?? contract?.userName
            ?? primaryResponsible?.name
            ?? contract?.createdBy
            ?? 'Sistema',
          ).trim() || 'Sistema',
          editedAt: null,
          editedByName: '',
        });
      }
      if (guaranteeStatus === 'validado' && guaranteeBs > 0 && !hasValidatedGuaranteeEntry) {
        normalizedEconomicLedger.unshift({
          id: `validated-guarantee-${contract?.id ?? contract?.contractCode ?? makeId('con')}`,
          type: 'guarantee',
          amountBs: Number(guaranteeBs.toFixed(2)),
          paymentMethod: guaranteePaymentMethod,
          paymentAccount: guaranteePaymentAccount,
          note: 'Garantia pagada registrada al crear el contrato.',
          createdAt: contract?.approvedAt
            ?? contract?.contractDate
            ?? contract?.createdAt
            ?? now,
          createdById: contract?.createdById ?? contract?.userId ?? primaryResponsible?.id ?? null,
          createdByName: String(
            contract?.createdByName
            ?? contract?.userName
            ?? primaryResponsible?.name
            ?? contract?.createdBy
            ?? 'Sistema',
          ).trim() || 'Sistema',
          editedAt: null,
          editedByName: '',
        });
      }

      return {
        id: contract?.id ?? makeId('con'),
        contractCode: String(contract?.contractCode ?? '').trim(),
        quoteId: String(contract?.quoteId ?? '').trim() || null,
        clientId: contract?.clientId ?? null,
        customerName: String(contract?.customerName ?? '').trim(),
        customerCi: String(contract?.customerCi ?? contract?.nitCi ?? '').trim(),
        customerPhone: String(contract?.customerPhone ?? '').trim(),
        customerReferencePhone: String(contract?.customerReferencePhone ?? contract?.referencePhone ?? '').trim(),
        companyName: String(contract?.companyName ?? '').trim(),
        eventType: String(contract?.eventType ?? 'general').trim() || 'general',
        eventDate: String(contract?.eventDate ?? '').trim(),
        eventTime: String(contract?.eventTime ?? '').trim(),
        contractDate: String(contract?.contractDate ?? contract?.createdAt ?? '').trim(),
        address: String(contract?.address ?? '').trim(),
        city: String(contract?.city ?? '').trim(),
        deliveryDate: String(contract?.deliveryDate ?? '').trim(),
        logisticsMode,
        deliveryChargeMode: deliveryCharge.deliveryChargeMode,
        deliveryFeeBs: Number(deliveryCharge.deliveryFeeBs.toFixed(2)),
        deliveryFeeReason: deliveryCharge.deliveryFeeReason,
        deliveryWindowStart: String(contract?.deliveryWindowStart ?? '08:00').trim(),
        deliveryWindowEnd: String(contract?.deliveryWindowEnd ?? '10:00').trim(),
        deliveryTimeMode: contract?.deliveryTimeMode === 'coordinate' ? 'coordinate' : 'fixed',
        pickupDate: String(contract?.pickupDate ?? '').trim(),
        pickupWindowStart: String(contract?.pickupWindowStart ?? '20:00').trim(),
        pickupWindowEnd: String(contract?.pickupWindowEnd ?? '22:00').trim(),
        pickupTimeMode: contract?.pickupTimeMode === 'coordinate' ? 'coordinate' : 'fixed',
        driverId: String(contract?.driverId ?? '').trim() || null,
        vehicleId: String(contract?.vehicleId ?? '').trim() || null,
        validUntil: null,
        observations: String(contract?.observations ?? '').trim(),
        billingMode: ['con_factura', 'sin_factura'].includes(contract?.billingMode) ? contract.billingMode : 'sin_factura',
        status: String(contract?.status ?? 'borrador').trim() || 'borrador',
        totals: {
          itemsGrossSubtotalBs: Number(Math.max(0, itemsGrossSubtotalBs).toFixed(2)),
          itemDiscountsBs: Number(Math.max(0, itemDiscountsBs).toFixed(2)),
          itemsNetSubtotalBs: Number(Math.max(0, itemsNetSubtotalBs).toFixed(2)),
          itemsSubtotalBs: Number(Math.max(0, itemsNetSubtotalBs).toFixed(2)),
          servicesSubtotalBs: Number(servicesSubtotalBs.toFixed(2)),
          baseSubtotalBs: Number(baseSubtotalBs.toFixed(2)),
          subtotalBs: Number(subtotalBs.toFixed(2)),
          durationDiscountBs: Number(pricingPlan.durationDiscountBs.toFixed(2)),
          theoreticalSubtotalBs: Number(pricingPlan.theoreticalSubtotalBs.toFixed(2)),
          discountMode: contract?.totals?.discountMode === 'fixed'
            ? 'fixed'
            : Math.max(0, Number(contract?.totals?.discountPercent ?? contract?.discountPercent ?? 0)) > 0
              ? 'percent'
              : Number(discountBs) > 0 ? 'fixed' : 'percent',
          discountBs: Number(discountBs.toFixed(2)),
          discountPercent: Math.max(0, Number(contract?.totals?.discountPercent ?? contract?.discountPercent ?? 0)),
          deliveryFeeBs: Number(deliveryCharge.deliveryFeeBs.toFixed(2)),
          guaranteeBs: Number(guaranteeBs.toFixed(2)),
          totalBs: Number(totalBs.toFixed(2)),
        },
        pricingPlan,
        payment: {
          paidAtApprovalBs: Number(paidAtApprovalBs.toFixed(2)),
          pendingBs: Number(Math.max(0, pendingBs).toFixed(2)),
          overpaidBs: Number(overpaidBs.toFixed(2)),
          prepaidAppliedBs: Number(prepaidAppliedBs.toFixed(2)),
          initialPaymentMethod: normalizePaymentMethod(contract?.payment?.initialPaymentMethod ?? contract?.payment?.paymentMethod),
          initialPaymentAccount: normalizeQrPaymentAccount(contract?.payment?.initialPaymentAccount ?? contract?.payment?.paymentAccount),
          guaranteeStatus,
          guaranteePaymentMethod,
          guaranteePaymentAccount,
        },
        guarantee: {
          amountBs: Number(guaranteeBs.toFixed(2)),
          status: guaranteeStatus,
          paymentMethod: guaranteePaymentMethod,
          paymentAccount: guaranteePaymentAccount,
        },
        items,
        services,
        supplierFulfillmentPlan: normalizeSupplierFulfillmentPlan(contract?.supplierFulfillmentPlan),
        economicLedger: normalizedEconomicLedger,
        economicLedgerUpdatedAt: contract?.economicLedgerUpdatedAt ?? null,
        economicLedgerUpdatedById: contract?.economicLedgerUpdatedById ?? null,
        economicLedgerUpdatedByName: String(
          contract?.economicLedgerUpdatedByName ?? '',
        ).trim(),
        approvedAt: contract?.approvedAt ?? null,
        rejectedAt: contract?.rejectedAt ?? null,
        isFinalized: Boolean(contract?.isFinalized),
        finalizedAt: contract?.isFinalized ? (contract?.finalizedAt ?? contract?.updatedAt ?? contract?.createdAt ?? now) : null,
        finalizedById: contract?.isFinalized ? (contract?.finalizedById ?? null) : null,
        finalizedByName: contract?.isFinalized ? String(contract?.finalizedByName ?? '').trim() : '',
        finalizedByRole: contract?.isFinalized ? String(contract?.finalizedByRole ?? '').trim() : '',
        rentalId: contract?.rentalId ?? null,
        orderCode: contract?.orderCode ?? null,
        createdBy: String(contract?.createdBy ?? 'system').trim() || 'system',
        createdById: contract?.createdById ?? contract?.userId ?? primaryResponsible?.id ?? null,
        createdByName: String(contract?.createdByName ?? contract?.userName ?? primaryResponsible?.name ?? contract?.createdBy ?? 'Sistema').trim() || 'Sistema',
        createdByRole: String(contract?.createdByRole ?? contract?.userRole ?? primaryResponsible?.role ?? 'Sistema').trim() || 'Sistema',
        deletedById: contract?.deletedById ?? null,
        deletedByName: String(contract?.deletedByName ?? '').trim(),
        deletedByRole: String(contract?.deletedByRole ?? '').trim(),
        responsibles,
        revisionHistory: (() => {
          const revisions = Array.isArray(contract?.revisionHistory)
            ? contract.revisionHistory.map((revision) => ({
              id: String(revision?.id ?? makeId('rev')).trim() || makeId('rev'),
              updatedAt: revision?.updatedAt ?? revision?.createdAt ?? now,
              updatedById: revision?.updatedById ?? null,
              updatedByName: String(revision?.updatedByName ?? 'Sistema').trim() || 'Sistema',
              updatedByRole: String(revision?.updatedByRole ?? 'Operacion').trim() || 'Operacion',
              changes: Array.isArray(revision?.changes)
                ? revision.changes.map((change) => String(change ?? '').trim()).filter(Boolean)
                : [],
            }))
            .filter((revision) => revision.changes.length > 0)
            : [];
          if (revisions.length > 0) return revisions;
          const createdByName = String(contract?.createdByName ?? contract?.userName ?? primaryResponsible?.name ?? contract?.createdBy ?? 'Sistema').trim() || 'Sistema';
          const createdByRole = String(contract?.createdByRole ?? contract?.userRole ?? primaryResponsible?.role ?? 'Sistema').trim() || 'Sistema';
          const contractCode = String(contract?.contractCode ?? contract?.code ?? '').trim();
          const customer = String(contract?.customerName ?? '').trim();
          const totalBs = Number(contract?.totals?.totalBs ?? contract?.totalBs ?? 0);
          return [{
            id: String(contract?.creationRevisionId ?? '').trim() || makeId('rev'),
            updatedAt: contract?.createdAt ?? now,
            updatedById: contract?.createdById ?? contract?.userId ?? primaryResponsible?.id ?? null,
            updatedByName: createdByName,
            updatedByRole: createdByRole,
            changes: [
              `Contrato creado por ${createdByName}`,
              contractCode ? `Numero de contrato: ${contractCode}` : '',
              customer ? `Cliente: ${customer}` : '',
              `Total inicial: ${formatBs(totalBs)}`,
            ].filter(Boolean),
          }];
        })(),
        cancelledAt: contract?.cancelledAt ?? null,
        cancellationPenaltyPercent: Number(contract?.cancellationPenaltyPercent ?? 0),
        cancellationPenaltyBs: Number(contract?.cancellationPenaltyBs ?? 0),
        cancellationReason: String(contract?.cancellationReason ?? '').trim(),
        cancellationCutoffDate: String(contract?.cancellationCutoffDate ?? '').trim() || null,
        createdAt: contract?.createdAt ?? now,
        updatedAt: contract?.updatedAt ?? contract?.createdAt ?? now,
        deletedAt: contract?.deletedAt ?? null,
      };
    }).filter((contract) => contract.contractCode && contract.customerName)
    : [];

  repairContract1544InventoryFlow(source, now);
  repairApprovedContractsMissingRentals(source, now);

  if (Number(source.settings.maintenance.deletedContractCleanupRevision ?? 0) < 1) {
    const repairedContracts = repairDeletedContractOperationalResidues(source, now);
    source.settings.maintenance.deletedContractCleanupRevision = 1;
    source.settings.maintenance.deletedContractCleanupAt = now;
    source.settings.maintenance.deletedContractCleanupCount = repairedContracts;
  }

  source.contracts.forEach((contract) => {
    const activeLinkedRentals = source.rentals
      .filter((rental) => (
        !contract.deletedAt
        &&
        String(rental.contractId ?? '') === String(contract.id)
        && !rental.deletedAt
        && rental.status !== 'cancelled'
      ))
      .sort((left, right) => new Date(right.createdAt ?? right.rentalAt ?? 0) - new Date(left.createdAt ?? left.rentalAt ?? 0));
    const linkedRental = activeLinkedRentals.find((rental) => rental.id === contract.rentalId)
      ?? activeLinkedRentals[0];
    if (!linkedRental) return;
    contract.status = 'aprobado';
    contract.approvedAt = contract.approvedAt ?? linkedRental.createdAt ?? linkedRental.rentalAt ?? now;
    contract.rejectedAt = null;
    contract.rentalId = linkedRental.id;
    contract.orderCode = linkedRental.orderCode ?? contract.orderCode ?? null;
  });

  source.suppliers = Array.isArray(source.suppliers)
    ? source.suppliers
      .map((supplier) => ({
        id: supplier?.id ?? makeId('sup'),
        name: String(supplier?.name ?? '').trim(),
        contactName: String(supplier?.contactName ?? '').trim(),
        phone: String(supplier?.phone ?? '').trim(),
        whatsapp: String(supplier?.whatsapp ?? supplier?.phone ?? '').trim(),
        email: String(supplier?.email ?? '').trim().toLowerCase(),
        address: String(supplier?.address ?? '').trim(),
        city: String(supplier?.city ?? '').trim(),
        type: 'regular',
        paymentTerms: String(supplier?.paymentTerms ?? '').trim(),
        notes: String(supplier?.notes ?? '').trim(),
        status: String(supplier?.status ?? 'active').trim() || 'active',
        createdAt: supplier?.createdAt ?? now,
        updatedAt: supplier?.updatedAt ?? supplier?.createdAt ?? now,
        deletedAt: supplier?.deletedAt ?? null,
      }))
      .filter((supplier) => supplier.name)
    : [];

  source.supplierQuotes = Array.isArray(source.supplierQuotes)
    ? source.supplierQuotes
      .map((quote) => {
        const supplier = source.suppliers.find((entry) => entry.id === quote?.supplierId) ?? null;
        const items = Array.isArray(quote?.items)
          ? quote.items
            .map((line) => {
              const quantity = Math.max(1, Math.trunc(Number(line?.quantity ?? 1)));
              const unitPriceBs = Math.max(0, Number(line?.unitPriceBs ?? 0));
              return {
                id: line?.id ?? makeId('supitem'),
                itemId: String(line?.itemId ?? '').trim() || null,
                itemName: String(line?.itemName ?? line?.name ?? '').trim(),
                category: String(line?.category ?? '').trim(),
                quantity,
                unit: String(line?.unit ?? 'unidad').trim() || 'unidad',
                unitPriceBs: Number(unitPriceBs.toFixed(2)),
                saleUnitPriceBs: Math.max(0, Number(line?.saleUnitPriceBs ?? line?.clientUnitPriceBs ?? 0)),
                lineTotalBs: Number((quantity * unitPriceBs).toFixed(2)),
              };
            })
            .filter((line) => line.itemName)
          : [];
        const totalBs = items.reduce((sum, line) => sum + Number(line.lineTotalBs ?? 0), 0);
        return {
          id: quote?.id ?? makeId('supquo'),
          quoteCode: String(quote?.quoteCode ?? '').trim(),
          supplierId: String(quote?.supplierId ?? '').trim(),
          supplierName: String(quote?.supplierName ?? supplier?.name ?? '').trim(),
          title: String(quote?.title ?? 'Lista de precios').trim() || 'Lista de precios',
          validFrom: String(quote?.validFrom ?? '').trim() || null,
          validUntil: String(quote?.validUntil ?? '').trim() || null,
          status: String(quote?.status ?? 'vigente').trim() || 'vigente',
          notes: String(quote?.notes ?? '').trim(),
          totals: { totalBs: Number(totalBs.toFixed(2)) },
          items,
          createdAt: quote?.createdAt ?? now,
          updatedAt: quote?.updatedAt ?? quote?.createdAt ?? now,
          deletedAt: quote?.deletedAt ?? null,
        };
      })
      .filter((quote) => quote.quoteCode && quote.supplierId && quote.supplierName)
    : [];

  source.supplierLoans = Array.isArray(source.supplierLoans)
    ? source.supplierLoans
      .map((loan) => {
        const supplier = source.suppliers.find((entry) => entry.id === loan?.supplierId) ?? null;
        const sourceContractId = String(loan?.sourceContractId ?? '').trim();
        const sourceRentalId = String(loan?.sourceRentalId ?? '').trim();
        const sourceOrderCode = String(loan?.sourceOrderCode ?? '').trim();

        const linkedRental = (Array.isArray(source.rentals) ? source.rentals : []).find((entry) => (
          (sourceRentalId && String(entry?.id ?? '').trim() === sourceRentalId)
          || (sourceOrderCode && String(entry?.orderCode ?? '').trim() === sourceOrderCode)
        )) ?? null;

        const linkedContract = (Array.isArray(source.contracts) ? source.contracts : []).find((entry) => (
          (sourceContractId && String(entry?.id ?? '').trim() === sourceContractId)
          || (
            linkedRental?.contractId
            && String(entry?.id ?? '').trim() === String(linkedRental.contractId).trim()
          )
          || (
            linkedRental?.contractCode
            && String(entry?.contractCode ?? '').trim() === String(linkedRental.contractCode).trim()
          )
        )) ?? null;

        const sourceContractCode = String(
          loan?.sourceContractCode
          ?? loan?.contractCode
          ?? linkedContract?.contractCode
          ?? linkedRental?.contractCode
          ?? '',
        ).trim();

        const eventDate = String(
          loan?.eventDate
          ?? loan?.serviceDate
          ?? linkedContract?.eventDate
          ?? linkedContract?.deliveryDate
          ?? linkedRental?.rentalDate
          ?? linkedRental?.deliveryDate
          ?? loan?.requestDate
          ?? '',
        ).trim();

        const items = Array.isArray(loan?.items)
          ? loan.items
            .map((line) => {
              const quantity = Math.max(1, Math.trunc(Number(line?.quantity ?? 1)));
              const unitPriceBs = Math.max(0, Number(line?.unitPriceBs ?? 0));
              return {
                id: line?.id ?? makeId('supline'),
                itemId: String(line?.itemId ?? '').trim() || null,
                itemName: String(line?.itemName ?? line?.name ?? '').trim(),
                category: String(line?.category ?? '').trim(),
              quantity,
              unitPriceBs: Number(unitPriceBs.toFixed(2)),
              saleUnitPriceBs: Math.max(0, Number(line?.saleUnitPriceBs ?? line?.clientUnitPriceBs ?? 0)),
              lineTotalBs: Number((quantity * unitPriceBs).toFixed(2)),
            };
            })
            .filter((line) => line.itemName)
          : [];
        const totalBs = items.reduce((sum, line) => sum + Number(line.lineTotalBs ?? 0), 0);
        const direction = 'from_supplier';
        return {
          id: loan?.id ?? makeId('suploan'),
          loanCode: String(loan?.loanCode ?? '').trim(),
          supplierId: String(loan?.supplierId ?? '').trim(),
          supplierName: String(loan?.supplierName ?? supplier?.name ?? '').trim(),
          direction,
          flowType: 'paid',
          requestDate: String(loan?.requestDate ?? '').trim(),
          eventDate,
          returnDate: String(loan?.returnDate ?? '').trim() || null,
          eventName: String(loan?.eventName ?? '').trim(),
          status: String(loan?.status ?? 'programado').trim() || 'programado',
          showPricesOnDocument: Boolean(loan?.showPricesOnDocument),
          notes: String(loan?.notes ?? '').trim(),
          totals: { totalBs: Number(totalBs.toFixed(2)) },
          items,
          settledAt: loan?.settledAt ?? null,
          sourceContractId: sourceContractId || linkedContract?.id || null,
          sourceContractCode: sourceContractCode || null,
          sourceRentalId: sourceRentalId || linkedRental?.id || null,
          sourceOrderCode: sourceOrderCode || linkedRental?.orderCode || null,
          autoCreated: Boolean(loan?.autoCreated),
          createdAt: loan?.createdAt ?? now,
          updatedAt: loan?.updatedAt ?? loan?.createdAt ?? now,
          deletedAt: loan?.deletedAt ?? null,
        };
      })
      .filter((loan) => loan.loanCode && loan.supplierId && loan.supplierName)
    : [];

  source.personnelEmployees = Array.isArray(source.personnelEmployees)
    ? source.personnelEmployees
      .map((employee) => ({
        id: employee?.id ?? makeId('emp'),
        employeeCode: String(employee?.employeeCode ?? employee?.code ?? '').trim(),
        biometricCode: String(employee?.biometricCode ?? employee?.employeeCode ?? employee?.code ?? '').trim(),
        fullName: String(employee?.fullName ?? employee?.name ?? '').trim(),
        documentId: String(employee?.documentId ?? employee?.ci ?? '').trim(),
        phone: String(employee?.phone ?? '').trim(),
        whatsapp: String(employee?.whatsapp ?? employee?.phone ?? '').trim(),
        photoUrl: String(employee?.photoUrl ?? employee?.photo ?? '').trim(),
        email: String(employee?.email ?? '').trim().toLowerCase(),
        address: String(employee?.address ?? '').trim(),
        city: String(employee?.city ?? '').trim(),
        department: String(employee?.department ?? 'Operaciones').trim() || 'Operaciones',
        position: String(employee?.position ?? '').trim(),
        contractType: String(employee?.contractType ?? 'indefinido').trim() || 'indefinido',
        hireDate: String(employee?.hireDate ?? '').trim() || null,
        salaryBs: Math.max(0, Number(employee?.salaryBs ?? 0)),
        schedule: {
          start: String(employee?.schedule?.start ?? employee?.shiftStart ?? '08:00').trim() || '08:00',
          end: String(employee?.schedule?.end ?? employee?.shiftEnd ?? '17:00').trim() || '17:00',
          dailyHours: Math.max(1, Number(employee?.schedule?.dailyHours ?? employee?.dailyHours ?? 8)),
          workingDays: Array.isArray(employee?.schedule?.workingDays) && employee.schedule.workingDays.length
            ? employee.schedule.workingDays.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6)
            : [1, 2, 3, 4, 5, 6],
        },
        emergencyContact: String(employee?.emergencyContact ?? '').trim(),
        emergencyPhone: String(employee?.emergencyPhone ?? '').trim(),
        notes: String(employee?.notes ?? '').trim(),
        status: String(employee?.status ?? 'active').trim() || 'active',
        createdAt: employee?.createdAt ?? now,
        updatedAt: employee?.updatedAt ?? employee?.createdAt ?? now,
        deletedAt: employee?.deletedAt ?? null,
      }))
      .filter((employee) => employee.fullName)
    : [];

  source.personnelAttendance = Array.isArray(source.personnelAttendance)
    ? source.personnelAttendance
      .map((entry) => ({
        id: entry?.id ?? makeId('att'),
        employeeId: String(entry?.employeeId ?? '').trim() || null,
        employeeCode: String(entry?.employeeCode ?? '').trim(),
        employeeName: String(entry?.employeeName ?? '').trim(),
        date: String(entry?.date ?? '').trim(),
        checkIn: String(entry?.checkIn ?? '').trim(),
        checkOut: String(entry?.checkOut ?? '').trim(),
        workedHours: Math.max(0, Number(entry?.workedHours ?? 0)),
        overtimeHours: Math.max(0, Number(entry?.overtimeHours ?? 0)),
        missingHours: Math.max(0, Number(entry?.missingHours ?? 0)),
        lateMinutes: Math.max(0, Math.trunc(Number(entry?.lateMinutes ?? 0))),
        earlyLeaveMinutes: Math.max(0, Math.trunc(Number(entry?.earlyLeaveMinutes ?? 0))),
        status: String(entry?.status ?? 'normal').trim() || 'normal',
        source: String(entry?.source ?? 'manual').trim() || 'manual',
        importCode: String(entry?.importCode ?? '').trim(),
        notes: String(entry?.notes ?? '').trim(),
        createdAt: entry?.createdAt ?? now,
        updatedAt: entry?.updatedAt ?? entry?.createdAt ?? now,
      }))
      .filter((entry) => entry.date && (entry.employeeId || entry.employeeName || entry.employeeCode))
    : [];

  source.personnelIncidents = Array.isArray(source.personnelIncidents)
    ? source.personnelIncidents
      .map((entry) => ({
        id: entry?.id ?? makeId('hrinc'),
        employeeId: String(entry?.employeeId ?? '').trim(),
        employeeName: String(entry?.employeeName ?? '').trim(),
        type: String(entry?.type ?? 'permiso').trim() || 'permiso',
        dateFrom: String(entry?.dateFrom ?? entry?.date ?? '').trim(),
        dateTo: String(entry?.dateTo ?? entry?.dateFrom ?? entry?.date ?? '').trim(),
        hours: Math.max(0, Number(entry?.hours ?? 0)),
        status: String(entry?.status ?? 'aprobado').trim() || 'aprobado',
        reason: String(entry?.reason ?? '').trim(),
        notes: String(entry?.notes ?? '').trim(),
        createdAt: entry?.createdAt ?? now,
        updatedAt: entry?.updatedAt ?? entry?.createdAt ?? now,
        deletedAt: entry?.deletedAt ?? null,
      }))
      .filter((entry) => entry.employeeId && entry.dateFrom)
    : [];

  source.inventoryMovements = Array.isArray(source.inventoryMovements)
    ? source.inventoryMovements
    : [];
  source.stockRecoveries = Array.isArray(source.stockRecoveries)
    ? source.stockRecoveries.filter((entry) => Number(entry?.quantity ?? 0) > 0)
    : [];
  source.cashSessions = Array.isArray(source.cashSessions)
    ? source.cashSessions.map((session) => ({
      ...session,
      openingBigCashBs: Number(session?.openingBigCashBs ?? session?.openingAmountBs ?? 0),
      openingPettyCashBs: Number(session?.openingPettyCashBs ?? 0),
      expectedBigCashBs: session?.expectedBigCashBs ?? null,
      expectedPettyCashBs: session?.expectedPettyCashBs ?? null,
      countedBigCashBs: session?.countedBigCashBs ?? null,
      countedPettyCashBs: session?.countedPettyCashBs ?? null,
      differenceBigCashBs: session?.differenceBigCashBs ?? null,
      differencePettyCashBs: session?.differencePettyCashBs ?? null,
      treasuryAccounts: normalizeTreasuryAccounts(session?.treasuryAccounts),
      treasuryUpdatedAt: session?.treasuryUpdatedAt ?? null,
      treasuryUpdatedBy: String(session?.treasuryUpdatedBy ?? '').trim(),
    }))
    : [];
  const contractByIdForCash = new Map(source.contracts.map((contract) => [String(contract.id), contract]));
  const contractByCodeForCash = new Map(source.contracts.map((contract) => [String(contract.contractCode), contract]));
  const contractByOrderCodeForCash = new Map(
    source.contracts
      .filter((contract) => contract.orderCode)
      .map((contract) => [String(contract.orderCode), contract]),
  );
  const rentalByIdForCash = new Map(source.rentals.map((rental) => [String(rental.id), rental]));
  const rentalByOrderCodeForCash = new Map(
    source.rentals
      .filter((rental) => rental.orderCode)
      .map((rental) => [String(rental.orderCode), rental]),
  );
  const findCashContractContext = (movement) => {
    const linkedContractId = String(movement?.linkedContractId ?? movement?.contractId ?? '').trim();
    if (linkedContractId && contractByIdForCash.has(linkedContractId)) {
      return contractByIdForCash.get(linkedContractId);
    }
    const linkedRentalId = String(movement?.linkedRentalId ?? movement?.rentalId ?? '').trim();
    const sourceId = String(movement?.sourceId ?? '').trim();
    const rental = (linkedRentalId && rentalByIdForCash.get(linkedRentalId))
      || (String(movement?.sourceType ?? '').trim() === 'rental' && sourceId && rentalByIdForCash.get(sourceId))
      || null;
    if (rental) {
      const rentalContractId = String(rental.contractId ?? '').trim();
      const rentalContractCode = String(rental.contractCode ?? '').trim();
      const rentalOrderCode = String(rental.orderCode ?? '').trim();
      return (rentalContractId && contractByIdForCash.get(rentalContractId))
        || (rentalContractCode && contractByCodeForCash.get(rentalContractCode))
        || (rentalOrderCode && contractByOrderCodeForCash.get(rentalOrderCode))
        || null;
    }
    const linkedOrderCode = String(movement?.linkedOrderCode ?? movement?.orderCode ?? '').trim();
    if (linkedOrderCode) {
      return contractByOrderCodeForCash.get(linkedOrderCode)
        || contractByCodeForCash.get(linkedOrderCode)
        || null;
    }
    return null;
  };
  const findCashRentalContext = (movement) => {
    const linkedRentalId = String(movement?.linkedRentalId ?? movement?.rentalId ?? '').trim();
    if (linkedRentalId && rentalByIdForCash.has(linkedRentalId)) {
      return rentalByIdForCash.get(linkedRentalId);
    }
    const sourceId = String(movement?.sourceId ?? '').trim();
    if (String(movement?.sourceType ?? '').trim() === 'rental' && sourceId && rentalByIdForCash.has(sourceId)) {
      return rentalByIdForCash.get(sourceId);
    }
    const linkedOrderCode = String(movement?.linkedOrderCode ?? movement?.orderCode ?? '').trim();
    if (linkedOrderCode && rentalByOrderCodeForCash.has(linkedOrderCode)) {
      return rentalByOrderCodeForCash.get(linkedOrderCode);
    }
    return null;
  };
  const resolveCashMovementResponsible = (movement) => {
    const currentResponsible = String(movement?.responsible ?? '').trim();
    const currentCreatedBy = String(movement?.createdBy ?? '').trim();
    const current = currentResponsible || currentCreatedBy;
    if (current && normalizeText(current) !== 'sistema') return current;
    const contract = findCashContractContext(movement);
    const rental = findCashRentalContext(movement);
    const primaryResponsible = contract?.responsibles?.[0] ?? null;
    return String(
      primaryResponsible?.name
      ?? contract?.createdByName
      ?? rental?.createdByName
      ?? contract?.createdBy
      ?? rental?.createdBy
      ?? current
      ?? '',
    ).trim();
  };
  source.cashMovements = Array.isArray(source.cashMovements)
    ? source.cashMovements.map((movement) => {
      const isPersonnelAdvanceMovement =
        String(movement?.accountingTag ?? '').toLowerCase() === 'personnel_advance'
        || String(movement?.category ?? '').toLowerCase() === 'adelanto_personal';
      const responsible = resolveCashMovementResponsible(movement);
      const createdBy = String(
        movement?.createdByName
        ?? movement?.userName
        ?? movement?.createdBy
        ?? '',
      ).trim();
      return {
        ...movement,
        cashBoxType: normalizeCashBoxType(movement?.cashBoxType),
        category: String(movement?.category ?? '').trim(),
        paymentMethod: String(movement?.paymentMethod ?? '').trim(),
        paymentAccount: normalizePaymentMethod(movement?.paymentMethod) === 'qr' ? normalizeQrPaymentAccount(movement?.paymentAccount) : '',
        responsible,
        createdBy: isPersonnelAdvanceMovement
          ? createdBy || String(movement?.createdBy ?? '').trim() || 'Contabilidad'
          : responsible || createdBy,
        createdByName: String(movement?.createdByName ?? movement?.userName ?? createdBy ?? movement?.createdBy ?? '').trim(),
        userName: String(movement?.userName ?? movement?.createdByName ?? createdBy ?? movement?.createdBy ?? '').trim(),
        receipt: String(movement?.receipt ?? '').trim(),
        receiptCode: String(movement?.receiptCode ?? '').trim(),
        notes: String(movement?.notes ?? '').trim(),
        isInternalTransfer: Boolean(movement?.isInternalTransfer),
        transferGroupId: movement?.transferGroupId ?? null,
        receiptStatus: String(movement?.receiptStatus ?? movement?.statusReceipt ?? '').trim(),
        voidedAt: movement?.voidedAt ?? null,
        voidedBy: String(movement?.voidedBy ?? '').trim(),
        voidReason: String(movement?.voidReason ?? '').trim(),
        replacedByMovementId: movement?.replacedByMovementId ?? null,
        replacementOfMovementId: movement?.replacementOfMovementId ?? null,
        linkedRentalId: String(movement?.linkedRentalId ?? movement?.rentalId ?? '').trim() || null,
        linkedContractId: String(movement?.linkedContractId ?? movement?.contractId ?? '').trim() || null,
        linkedOrderCode: String(movement?.linkedOrderCode ?? movement?.orderCode ?? '').trim() || null,
        accountingTag: String(movement?.accountingTag ?? '').trim(),
        collectionTarget: String(movement?.collectionTarget ?? '').trim(),
        collectionTargets: Array.isArray(movement?.collectionTargets)
          ? movement.collectionTargets.map((target) => String(target ?? '').trim()).filter(Boolean)
          : [],
        collectionBreakdown: Array.isArray(movement?.collectionBreakdown)
          ? movement.collectionBreakdown.map((entry) => ({
            target: String(entry?.target ?? '').trim(),
            label: String(entry?.label ?? '').trim(),
            amountBs: Number(Number(entry?.amountBs ?? 0).toFixed(2)),
            detail: String(entry?.detail ?? '').trim(),
            category: String(entry?.category ?? '').trim(),
            accountingTag: String(entry?.accountingTag ?? '').trim(),
          })).filter((entry) => entry.target && entry.amountBs > 0)
          : [],
        receiptDetail: String(movement?.receiptDetail ?? '').trim(),
        transportRevenueBs: Number(movement?.transportRevenueBs ?? 0),
        damageCollectedBs: Number(movement?.damageCollectedBs ?? 0),
        transportExpenseBs: Number(movement?.transportExpenseBs ?? 0),
      };
    })
    : [];
  source.cashMovements.forEach((movement) => {
    if (movement?.receiptCode || isVoidedCashMovement(movement)) return;
    if (Number(movement?.amountBs ?? 0) <= 0) return;
    if (normalizeCashBoxType(movement?.cashBoxType) !== CASH_BOX_TYPES.BIG_CASH) return;
    const tag = normalizeText(movement?.accountingTag);
    const shouldHaveReceipt = isContractCollectionCashMovement(movement)
      || isGuaranteeCashMovement(movement)
      || tag === 'transport_revenue';
    if (!shouldHaveReceipt) return;
    movement.receiptCode = nextCashReceiptCode(source);
  });
  source.contracts.forEach((contract) => {
    if (contract?.deletedAt || String(contract?.status ?? '').trim() !== 'aprobado') return;
    cleanupApprovedContractEconomicDuplicates(source, contract, { updatedByName: 'Sistema' }, now);
    syncInitialPaymentCashMovement(source, contract, { updatedByName: 'Sistema' }, contract?.approvedAt ?? contract?.createdAt ?? now);
    cleanupApprovedContractEconomicDuplicates(source, contract, { updatedByName: 'Sistema' }, now);
    const ledgerGuaranteeBs = (Array.isArray(contract?.economicLedger) ? contract.economicLedger : [])
      .filter((entry) => String(entry?.type ?? '').trim() === 'guarantee')
      .reduce((sum, entry) => sum + Math.max(0, Number(entry?.amountBs ?? 0)), 0);
    const guaranteeStatus = String(contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? '').trim();
    const validatedGuaranteeBs = Math.max(
      0,
      toPositiveRoundedNumber(contract?.totals?.guaranteeBs ?? 0),
      toPositiveRoundedNumber(contract?.guarantee?.amountBs ?? 0),
      toPositiveRoundedNumber(ledgerGuaranteeBs),
    );
    if (validatedGuaranteeBs <= 0 || (guaranteeStatus !== 'validado' && ledgerGuaranteeBs <= 0)) return;

    const references = [
      contract?.id,
      contract?.rentalId,
      contract?.contractCode,
      contract?.orderCode,
    ].map((value) => normalizeText(value)).filter(Boolean);
    const hasReference = (value) => {
      const normalized = normalizeText(value);
      return Boolean(normalized) && references.some((reference) => normalized.includes(reference));
    };
    const hasLinkedGuaranteeMovement = source.cashMovements.some((movement) => {
      if (isVoidedCashMovement(movement)) return false;
      const type = normalizeText(movement?.type);
      const category = normalizeText(movement?.category);
      const tag = normalizeText(movement?.accountingTag);
      const isGuarantee = type.includes('garantia') || category.includes('garantia') || tag.includes('guarantee');
      if (!isGuarantee) return false;
      if (Math.abs(Math.max(0, Number(movement?.amountBs ?? 0)) - validatedGuaranteeBs) >= 0.01) return false;
      return [
        movement?.linkedContractId,
        movement?.linkedRentalId,
        movement?.linkedOrderCode,
        movement?.sourceId,
        movement?.reference,
        movement?.notes,
        movement?.description,
      ].some(hasReference);
    });
    if (hasLinkedGuaranteeMovement) return;

    const activeSession = source.cashSessions.find((session) => String(session?.status ?? '').toLowerCase() === 'open') ?? null;
    const primaryResponsible = contract?.responsibles?.[0] ?? null;
    const responsible = String(
      primaryResponsible?.name
      ?? contract?.createdByName
      ?? contract?.createdBy
      ?? 'Sistema',
    ).trim() || 'Sistema';
    const paymentMethod = normalizePaymentMethod(contract?.guarantee?.paymentMethod ?? contract?.payment?.guaranteePaymentMethod);
    const paymentAccount = paymentMethod === 'qr'
      ? normalizeQrPaymentAccount(contract?.guarantee?.paymentAccount ?? contract?.payment?.guaranteePaymentAccount)
      : '';
    const firstGuaranteeLedgerDate = (Array.isArray(contract?.economicLedger) ? contract.economicLedger : [])
      .filter((entry) => String(entry?.type ?? '').trim() === 'guarantee')
      .map((entry) => entry?.createdAt)
      .find(Boolean);
    const movement = buildCashMovement({
      sessionId: activeSession?.id ?? null,
      type: 'ingreso_garantia',
      amountBs: validatedGuaranteeBs,
      description: `Ingreso garantia: ${contract?.customerName || 'Cliente'}`,
      sourceType: 'contract',
      sourceId: contract.id,
      createdBy: responsible,
      createdByName: responsible,
      userName: responsible,
      responsible,
      cashBoxType: CASH_BOX_TYPES.BIG_CASH,
      category: 'garantia',
      paymentMethod,
      paymentAccount,
      receiptCode: nextCashReceiptCode(source),
      notes: `Garantia pagada reparada para contrato ${contract?.contractCode || contract?.id || ''}`.trim(),
      linkedRentalId: contract?.rentalId ?? '',
      linkedContractId: contract?.id ?? '',
      linkedOrderCode: contract?.orderCode ?? '',
      accountingTag: 'validated_guarantee',
    });
    movement.createdAt = contract?.approvedAt ?? firstGuaranteeLedgerDate ?? contract?.createdAt ?? now;
    source.cashMovements.push(movement);
  });
  const legacyPettyRepositionRows = source.cashMovements.filter((movement) =>
    normalizeCashBoxType(movement?.cashBoxType) === CASH_BOX_TYPES.BIG_CASH
    && !movement?.isInternalTransfer
    && Number(movement?.amountBs ?? 0) > 0
    && normalizeCashCategory(movement?.category) === 'reposicion_caja_chica'
    && !isVoidedCashMovement(movement)
  );
  if (legacyPettyRepositionRows.length > 0) {
    let activeSession = source.cashSessions.find((session) => String(session?.status ?? '').toLowerCase() === 'open');
    if (!activeSession) {
      const firstReposition = legacyPettyRepositionRows
        .slice()
        .sort((left, right) => new Date(left.createdAt ?? 0) - new Date(right.createdAt ?? 0))[0];
      activeSession = {
        id: makeId('cash'),
        status: 'open',
        openingAmountBs: 0,
        openingBigCashBs: 0,
        openingPettyCashBs: 0,
        openedBy: firstReposition?.createdBy || firstReposition?.responsible || 'Sistema',
        openedAt: firstReposition?.createdAt ?? now,
        openNotes: `Apertura automatica por reparacion de reposicion a caja chica: ${firstReposition?.description || ''}`.trim(),
        expectedBigCashBs: null,
        expectedPettyCashBs: null,
        countedBigCashBs: null,
        countedPettyCashBs: null,
        differenceBigCashBs: null,
        differencePettyCashBs: null,
        treasuryAccounts: [],
        treasuryUpdatedAt: null,
        treasuryUpdatedBy: '',
      };
      source.cashSessions.push(activeSession);
    }
    legacyPettyRepositionRows.forEach((movement) => {
      const repairNote = 'Reclasificado automaticamente: reposicion de Caja Chica registrada anteriormente como ingreso de Caja Grande.';
      movement.cashBoxType = CASH_BOX_TYPES.PETTY_CASH;
      movement.sessionId = movement.sessionId || activeSession.id;
      movement.category = 'reposicion_caja_chica';
      movement.notes = String(movement.notes ?? '').includes(repairNote)
        ? movement.notes
        : [movement.notes, repairNote].map((entry) => String(entry ?? '').trim()).filter(Boolean).join('\n');
    });
  }
  source.cashDebts = Array.isArray(source.cashDebts)
    ? source.cashDebts.map((debt, index) => {
      const amountBs = toPositiveRoundedNumber(debt?.amountBs ?? debt?.totalBs ?? 0);
      const paidBs = toPositiveRoundedNumber(debt?.paidBs ?? 0);
      const balanceBs = toPositiveRoundedNumber(Math.max(0, Number(debt?.balanceBs ?? amountBs - paidBs)));
      const status = balanceBs <= 0
        ? 'pagada'
        : paidBs > 0
          ? 'parcial'
          : String(debt?.status ?? 'pendiente').trim() || 'pendiente';
      return {
        id: String(debt?.id ?? makeId('debt')).trim(),
        code: String(debt?.code ?? `DEU-${String(index + 1).padStart(5, '0')}`).trim(),
        description: String(debt?.description ?? debt?.detail ?? '').trim(),
        personName: String(debt?.personName ?? debt?.debtorName ?? debt?.responsible ?? '').trim(),
        amountBs,
        paidBs,
        balanceBs,
        debtDate: debt?.debtDate ?? debt?.date ?? debt?.createdAt ?? now,
        dueDate: debt?.dueDate ?? null,
        status,
        debtKind: normalizeCashDebtKind(debt?.debtKind ?? debt?.kind ?? debt?.category),
        category: String(debt?.category ?? '').trim(),
        sourceMovementId: String(debt?.sourceMovementId ?? debt?.movementId ?? '').trim(),
        sourceMovementReceipt: String(debt?.sourceMovementReceipt ?? debt?.receiptCode ?? debt?.receipt ?? '').trim(),
        notes: String(debt?.notes ?? '').trim(),
        createdAt: debt?.createdAt ?? now,
        createdBy: String(debt?.createdBy ?? '').trim(),
        paidAt: debt?.paidAt ?? null,
        payments: Array.isArray(debt?.payments)
          ? debt.payments.map((payment) => ({
            id: String(payment?.id ?? makeId('debtpay')).trim(),
            movementId: String(payment?.movementId ?? '').trim(),
            amountBs: toPositiveRoundedNumber(payment?.amountBs ?? 0),
            paidAt: payment?.paidAt ?? now,
            paidBy: String(payment?.paidBy ?? payment?.createdBy ?? '').trim(),
            notes: String(payment?.notes ?? '').trim(),
          }))
          : [],
      };
    }).filter((debt) => debt.description && debt.amountBs > 0)
    : [];
  source.attendanceRecords = Array.isArray(source.attendanceRecords)
    ? source.attendanceRecords.map((record) => ({
      id: String(record?.id ?? makeId('att')).trim(),
      code: String(record?.code ?? '').trim(),
      type: ['entrada', 'salida'].includes(String(record?.type ?? '').trim()) ? String(record?.type).trim() : 'entrada',
      location: String(record?.location ?? '').trim(),
      reason: String(record?.reason ?? record?.motivo ?? '').trim(),
      photoDataUrl: String(record?.photoDataUrl ?? record?.photo ?? '').trim(),
      photoUrl: String(record?.photoUrl ?? '').trim(),
      photoMimeType: String(record?.photoMimeType ?? '').trim(),
      photoSizeBytes: Number(record?.photoSizeBytes ?? 0) || 0,
      photoWidth: record?.photoWidth ?? null,
      photoHeight: record?.photoHeight ?? null,
      latitude: record?.latitude ?? null,
      longitude: record?.longitude ?? null,
      capturedAt: record?.capturedAt ?? record?.createdAt ?? now,
      createdAt: record?.createdAt ?? record?.capturedAt ?? now,
      userId: String(record?.userId ?? '').trim(),
      userName: String(record?.userName ?? record?.createdBy ?? 'Usuario').trim() || 'Usuario',
      role: String(record?.role ?? '').trim(),
      notes: String(record?.notes ?? '').trim(),
    }))
    : [];
  source.userPresence = Array.isArray(source.userPresence)
    ? source.userPresence.map((presence) => ({
      sessionId: String(presence?.sessionId ?? presence?.id ?? presence?.userId ?? '').trim(),
      userId: String(presence?.userId ?? '').trim(),
      fullName: String(presence?.fullName ?? 'Usuario').trim() || 'Usuario',
      role: String(presence?.role ?? 'Operador').trim() || 'Operador',
      activeTab: String(presence?.activeTab ?? 'resumen').trim() || 'resumen',
      color: String(presence?.color ?? colorForUserId(presence?.userId)).trim() || colorForUserId(presence?.userId),
      device: {
        type: String(presence?.device?.type ?? presence?.deviceType ?? 'desktop').trim() || 'desktop',
        typeLabel: String(presence?.device?.typeLabel ?? presence?.deviceLabel ?? 'Computadora').trim() || 'Computadora',
        browser: String(presence?.device?.browser ?? presence?.browser ?? 'Navegador').trim() || 'Navegador',
        os: String(presence?.device?.os ?? presence?.os ?? 'Equipo').trim() || 'Equipo',
        label: String(presence?.device?.label ?? presence?.deviceName ?? presence?.deviceLabel ?? 'Computadora').trim() || 'Computadora',
        screen: String(presence?.device?.screen ?? '').trim(),
        userAgent: String(presence?.device?.userAgent ?? '').trim(),
      },
      lastSeenAt: presence?.lastSeenAt ?? now,
      updatedAt: presence?.updatedAt ?? presence?.lastSeenAt ?? now,
    })).filter((presence) => presence.userId && presence.sessionId)
    : [];

  const activeReservedByItem = new Map();
  const todayKey = toDateKey(new Date());
  source.rentals
    .filter((rental) => rentalAffectsCurrentStock(rental, todayKey))
    .forEach((rental) => {
      (Array.isArray(rental?.items) ? rental.items : []).forEach((line) => {
        const itemId = String(line?.itemId ?? '').trim();
        if (!itemId) return;
        const reservedQty = Math.max(0, Math.trunc(Number(line?.internalReservedQty ?? line?.quantity ?? 0)));
        if (reservedQty <= 0) return;
        activeReservedByItem.set(itemId, Number(activeReservedByItem.get(itemId) ?? 0) + reservedQty);
      });
    });
  const recoveryByItem = new Map();
  source.stockRecoveries.forEach((entry) => {
    const itemId = String(entry?.itemId ?? '').trim();
    if (!itemId) return;
    recoveryByItem.set(itemId, Number(recoveryByItem.get(itemId) ?? 0) + Math.max(0, Math.trunc(Number(entry?.quantity ?? 0))));
  });
  source.items.forEach((item) => {
    if (!item || item.controlsStock === false) return;
    const totalStock = Math.max(0, Math.trunc(Number(item.totalStock ?? 0)));
    const reservedQty = Math.max(0, Math.trunc(Number(activeReservedByItem.get(String(item.id)) ?? 0)));
    const recoveryQty = Math.max(0, Math.trunc(Number(recoveryByItem.get(String(item.id)) ?? 0)));
    const expectedAvailable = Math.max(0, totalStock - reservedQty - recoveryQty);
    item.availableStock = expectedAvailable;
  });

  return normalizeBusinessTextInState(source);
};

let inMemoryState = createSeedData();
let inMemoryStateHydrated = false;
let localStorageStateDisabled = false;
let activeServerBatchState = null;
let serverBatchRollbackState = null;

const disableLocalStateStorage = () => {
  localStorageStateDisabled = true;
  try {
    window.localStorage.removeItem(WEB_DB_STORAGE_KEY);
  } catch {
    // The server remains the source of truth when browser storage is unavailable.
  }
};

const persistLocalStateSnapshot = (state) => {
  if (!canUseLocalStorage() || localStorageStateDisabled) return;
  try {
    const serialized = JSON.stringify(state);
    if (serialized.length > LOCAL_STORAGE_SAFE_STATE_BYTES) {
      disableLocalStateStorage();
      return;
    }
    window.localStorage.setItem(WEB_DB_STORAGE_KEY, serialized);
  } catch (error) {
    if (
      error?.name === 'QuotaExceededError'
      || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || Number(error?.code) === 22
      || Number(error?.code) === 1014
    ) {
      disableLocalStateStorage();
      return;
    }
    throw error;
  }
};

const invalidateQueryStateSnapshot = () => {};

const ensureStateHydrated = () => {
  if (inMemoryStateHydrated) return;

  if (localStorageStateDisabled || !canUseLocalStorage()) {
    inMemoryState = normalizeState(inMemoryState);
    inMemoryStateHydrated = true;
    invalidateQueryStateSnapshot();
    return;
  }

  const raw = window.localStorage.getItem(WEB_DB_STORAGE_KEY);
  if (!raw) {
    inMemoryState = normalizeState(createSeedData());
    inMemoryStateHydrated = true;
    persistLocalStateSnapshot(inMemoryState);
    invalidateQueryStateSnapshot();
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    inMemoryState = normalizeState(parsed);
  } catch {
    inMemoryState = normalizeState(createSeedData());
  }
  inMemoryStateHydrated = true;
  persistLocalStateSnapshot(inMemoryState);
  invalidateQueryStateSnapshot();
};

const readState = () => {
  ensureStateHydrated();
  return deepClone(inMemoryState);
};

const readQueryState = () => {
  ensureStateHydrated();
  // Las consultas son de solo lectura. Evitamos clonar toda la base para cada
  // ciclo de carga, porque en celulares esa copia duplicaba el consumo de memoria.
  // Cada listado que ordena o transforma arreglos debe trabajar sobre una copia
  // local con slice(), filter() o map().
  return inMemoryState;
};

const writeState = (state) => {
  const normalized = normalizeState(state);
  inMemoryState = normalized;
  inMemoryStateHydrated = true;
  invalidateQueryStateSnapshot();
  persistLocalStateSnapshot(normalized);
  return deepClone(normalized);
};

const transaction = (mutator) => {
  if (activeServerBatchState) {
    const result = mutator(activeServerBatchState);
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      activeServerBatchState = result;
      inMemoryState = activeServerBatchState;
    }
    return result ?? activeServerBatchState;
  }

  const state = readState();
  const clone = deepClone(state);
  const result = mutator(clone);
  const toPersist = result ?? clone;
  writeState(toPersist);
  return toPersist;
};

const RESET_MODULES = [
  {
    id: 'cash_accounting',
    level: 'safe',
    risk: 'medio',
    name: 'Reiniciar contabilidad de caja',
    description: 'Borra todos los movimientos y sesiones de Caja Grande y Caja Chica para dejar contabilidad limpia. Las garantias activas se recalculan desde contratos vigentes.',
    deletes: ['cashMovements', 'cashSessions'],
    warnings: ['No borra contratos, clientes ni inventario. Despues de ejecutar, Caja Grande queda sin ingresos operativos ni Caja Chica de prueba.'],
  },
  {
    id: 'trial_cleanup',
    level: 'validation',
    risk: 'alto',
    name: 'Limpiar datos de prueba',
    description: 'Borra operaciones, caja, transporte, proveedores, calendario y reportes. Conserva inventario, clientes, personal y usuarios.',
    deletes: ['quotes', 'contracts', 'rentals', 'deliveries', 'transportRoutes', 'cashMovements', 'cashSessions', 'vehicles', 'drivers', 'suppliers', 'supplierQuotes', 'supplierLoans', 'calendarEvents', 'generatedReports'],
    warnings: ['Tambien libera disponibilidad del inventario para quitar reservas de prueba, sin borrar productos ni categorias.'],
  },
];

const RESET_MODULE_MAP = new Map(RESET_MODULES.map((module) => [module.id, module]));

const TRIAL_CLEANUP_COLLECTIONS = [
  'quotes',
  'contracts',
  'rentals',
  'deliveries',
  'transportRoutes',
  'vehicles',
  'drivers',
  'calendarEvents',
  'generatedReports',
  'suppliers',
  'supplierQuotes',
  'supplierLoans',
  'cashSessions',
  'cashMovements',
  'cashDebts',
  'userPresence',
];

const TRIAL_CLEANUP_NUMBERING_RESETS = {
  quoteNext: 1,
  contractNext: 1,
  serviceOrderNext: 1,
  deliveryNext: 1,
  supplierQuoteNext: 1,
  supplierLoanNext: 1,
};

const FACTORY_RESET_COLLECTIONS = [
  'categories',
  'clients',
  'items',
  'quotes',
  'contracts',
  'rentals',
  'deliveries',
  'transportRoutes',
  'vehicles',
  'drivers',
  'calendarEvents',
  'generatedReports',
  'suppliers',
  'supplierQuotes',
  'supplierLoans',
  'personnelEmployees',
  'personnelAttendance',
  'personnelIncidents',
  'inventoryMovements',
  'stockRecoveries',
  'cashSessions',
  'cashMovements',
  'cashDebts',
  'attendanceRecords',
  'userPresence',
];

const DATABASE_BACKUP_COLLECTIONS = [
  ...FACTORY_RESET_COLLECTIONS,
  'users',
  'resetLogs',
];

const getCurrentSessionUser = (state) => {
  const sessionUserId = readSessionUserId();
  if (!sessionUserId) return null;
  return (state.users ?? []).find((user) => user.id === sessionUserId && !user.deletedAt) ?? null;
};

const assertDeveloperResetAccess = (state, code) => {
  const currentUser = getCurrentSessionUser(state);
  if (!currentUser || !isDeveloperUser(currentUser)) {
    throw new Error('Solo el rol developer puede acceder al Panel de Reset del Sistema.');
  }
  if (currentUser.status !== 'active') {
    throw new Error('El usuario developer no esta activo.');
  }
  const cleanCode = String(code ?? '').trim();
  if (!RESET_SECURITY_CODE || cleanCode !== RESET_SECURITY_CODE) {
    throw new Error('Contrasena de seguridad incorrecta.');
  }
  return currentUser;
};

const assertDeveloperUserManagementAccess = (state) => {
  const currentUser = getCurrentSessionUser(state);
  if (!currentUser || !isDeveloperUser(currentUser) || currentUser.status !== 'active') {
    throw new Error('Solo el rol developer puede gestionar usuarios.');
  }
  return currentUser;
};

const extractBackupState = (payload) => {
  const candidate = payload?.state ?? payload?.database ?? payload?.backup ?? payload;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('El archivo importado no contiene una base de datos valida.');
  }
  return candidate;
};

const countBackupRows = (state) =>
  DATABASE_BACKUP_COLLECTIONS.reduce((summary, key) => {
    const count = Array.isArray(state?.[key]) ? state[key].filter((entry) => !entry?.deletedAt).length : 0;
    return {
      ...summary,
      [key]: count,
      total: summary.total + count,
    };
  }, { total: 0 });

const buildDatabaseBackup = ({ state, currentUser, action = 'export' }) => ({
  app: 'el-copetin',
  kind: 'database-backup',
  schemaVersion: state?.schemaVersion ?? 3,
  exportedAt: new Date().toISOString(),
  exportedBy: {
    id: currentUser?.id ?? null,
    name: currentUser?.fullName ?? currentUser?.username ?? 'Developer',
    role: getDisplayRoleForIds(getUserRoleIds(currentUser)),
  },
  action,
  summary: countBackupRows(state),
  state: deepClone(state),
});

const recordLabel = (record, fallback = 'Registro') =>
  String(record?.name ?? record?.fullName ?? record?.code ?? record?.orderCode ?? record?.contractCode ?? record?.quoteCode ?? record?.id ?? fallback);

const activeRows = (rows) => (Array.isArray(rows) ? rows.filter((row) => !row?.deletedAt) : []);

const linkedToRental = (entry, rental) =>
  Boolean(
    entry
      && rental
      && (
        (entry.rentalId && entry.rentalId === rental.id)
        || (entry.orderCode && rental.orderCode && entry.orderCode === rental.orderCode)
        || (entry.reference && rental.orderCode && entry.reference === rental.orderCode)
      ),
  );

const addBlocked = (target, record, reason) => {
  target.blocked.push({
    id: String(record?.id ?? record?.code ?? makeId('blocked')),
    label: recordLabel(record),
    reason,
  });
};

const addDeletable = (target, record, collection, mode = 'delete') => {
  target.deletable.push({
    id: String(record?.id ?? record?.code ?? makeId('delete')),
    label: recordLabel(record),
    collection,
    mode,
  });
};

const analyzeTrialCleanup = (state) => {
  const module = RESET_MODULE_MAP.get('trial_cleanup');
  const result = {
    ...module,
    total: 0,
    deleteCount: 0,
    blockedCount: 0,
    dependencies: [
      'Preserva inventario: productos, categorias, kardex manual y stock fisico.',
      'Preserva clientes, personal, usuarios developer/administrativos y auditoria.',
      'Libera stock disponible para quitar reservas generadas por operaciones de prueba.',
      'Reinicia numeracion de cotizaciones, contratos, ordenes, entregas y documentos de proveedor.',
    ],
    records: {
      deletable: [],
      blocked: [],
    },
  };

  TRIAL_CLEANUP_COLLECTIONS.forEach((collection) => {
    const rows = Array.isArray(state[collection]) ? state[collection] : [];
    rows.forEach((row) => addDeletable(result.records, row, collection, 'trial-delete'));
  });

  result.total = result.records.deletable.length;
  result.deleteCount = result.records.deletable.length;
  return result;
};

const analyzeFactoryReset = (state) => {
  const module = RESET_MODULE_MAP.get('factory_reset');
  const result = {
    ...module,
    total: 0,
    deleteCount: 0,
    blockedCount: 0,
    dependencies: [],
    records: {
      deletable: [],
      blocked: [],
    },
  };

  FACTORY_RESET_COLLECTIONS.forEach((collection) => {
    const rows = Array.isArray(state[collection]) ? state[collection] : [];
    rows.forEach((row) => addDeletable(result.records, row, collection, 'factory-delete'));
  });

  activeRows(state.users).forEach((user) => {
    if (isDeveloperUser(user)) {
      addBlocked(result.records, user, 'Usuario developer preservado por seguridad.');
      return;
    }
    addDeletable(result.records, user, 'users', 'factory-delete');
  });

  addDeletable(
    result.records,
    { id: 'settings', name: 'Configuracion y numeracion operativa' },
    'settings',
    'factory-reset-settings',
  );

  result.total = result.records.deletable.length + result.records.blocked.length;
  result.deleteCount = result.records.deletable.length;
  result.blockedCount = result.records.blocked.length;
  result.dependencies = result.records.blocked.map((entry) => `${entry.label}: ${entry.reason}`);
  return result;
};

const analyzeResetModule = (state, moduleId) => {
  const module = RESET_MODULE_MAP.get(moduleId);
  if (!module) return null;
  const result = {
    ...module,
    total: 0,
    deleteCount: 0,
    blockedCount: 0,
    dependencies: [],
    records: {
      deletable: [],
      blocked: [],
    },
  };

  const clients = activeRows(state.clients);
  const quotes = activeRows(state.quotes);
  const contracts = activeRows(state.contracts);
  const rentals = activeRows(state.rentals);
  const deliveries = activeRows(state.deliveries);
  const items = activeRows(state.items);
  const inventoryMovements = Array.isArray(state.inventoryMovements) ? state.inventoryMovements : [];
  const cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];

  if (moduleId === 'trial_cleanup') {
    return analyzeTrialCleanup(state);
  }

  if (moduleId === 'factory_reset') {
    return analyzeFactoryReset(state);
  }

  if (moduleId === 'calendar_events') {
    result.total = activeRows(state.calendarEvents).length;
    activeRows(state.calendarEvents).forEach((event) => addDeletable(result.records, event, 'calendarEvents'));
  }

  if (moduleId === 'generated_reports') {
    result.total = activeRows(state.generatedReports).length;
    activeRows(state.generatedReports).forEach((report) => addDeletable(result.records, report, 'generatedReports'));
  }

  if (moduleId === 'clients') {
    result.total = clients.length;
    clients.forEach((client) => {
      const hasOperations =
        quotes.some((quote) => quote.clientId === client.id)
        || contracts.some((contract) => contract.clientId === client.id)
        || rentals.some((rental) => rental.clientId === client.id)
        || deliveries.some((delivery) => delivery.clientId === client.id)
        || cashMovements.some((movement) => movement.clientId === client.id || movement.reference === client.id);
      const hasBalance = Number(client?.prepaidAccount?.balanceBs ?? client?.totalIncomeBs ?? 0) > 0;
      const hasDocuments = Array.isArray(client?.attachments) && client.attachments.length > 0;
      const isBlockedClient = Boolean(client?.blacklist?.isBlacklisted);
      if (hasOperations || hasBalance || hasDocuments || isBlockedClient) {
        addBlocked(
          result.records,
          client,
          'Tiene historial comercial, saldos, documentos, lista negra u operaciones vinculadas.',
        );
        return;
      }
      addDeletable(result.records, client, 'clients');
    });
  }

  if (moduleId === 'quotes') {
    result.total = quotes.length;
    quotes.forEach((quote) => {
      const status = normalizeText(quote.status);
      const linked = Boolean(quote.rentalId || quote.contractId || quote.orderCode)
        || contracts.some((contract) => contract.quoteId === quote.id)
        || rentals.some((rental) => rental.quoteId === quote.id);
      if (linked || ['aprobada', 'approved', 'convertida'].includes(status)) {
        addBlocked(result.records, quote, 'Esta aprobada o vinculada a contrato/orden.');
        return;
      }
      addDeletable(result.records, quote, 'quotes', 'soft-delete');
    });
  }

  if (moduleId === 'contracts') {
    result.total = contracts.length;
    contracts.forEach((contract) => {
      const totalPaid = Number(contract?.payment?.paidAtApprovalBs ?? contract?.paidBs ?? 0);
      const guarantee = Number(contract?.totals?.guaranteeBs ?? contract?.guaranteeBs ?? 0);
      const linked = Boolean(contract.rentalId || contract.orderCode)
        || rentals.some((rental) => rental.contractId === contract.id);
      const status = normalizeText(contract.status);
      if (linked || totalPaid > 0 || guarantee > 0 || ['approved', 'aprobado', 'activo', 'firmado'].includes(status)) {
        addBlocked(result.records, contract, 'Tiene aprobacion, pago, garantia u orden asociada.');
        return;
      }
      addDeletable(result.records, contract, 'contracts', 'soft-delete');
    });
  }

  if (moduleId === 'service_orders') {
    result.total = rentals.length;
    rentals.forEach((rental) => {
      const totalPaid = Number(rental?.payment?.paidAtApprovalBs ?? rental?.paidBs ?? 0);
      const guarantee = Number(rental?.totals?.guaranteeBs ?? rental?.guaranteeBs ?? 0);
      const hasContract = contracts.some((contract) => linkedToRental(contract, rental));
      const hasDelivery = deliveries.some((delivery) => linkedToRental(delivery, rental));
      const hasMovement = inventoryMovements.some((movement) => linkedToRental(movement, rental));
      const hasCash = cashMovements.some((movement) => linkedToRental(movement, rental));
      const status = normalizeRentalStatus(rental.status);
      if (status !== 'cancelled' || totalPaid > 0 || guarantee > 0 || hasContract || hasDelivery || hasMovement || hasCash || Array.isArray(rental.returnReport)) {
        addBlocked(result.records, rental, 'Tiene pagos, garantia, contrato, movimientos, entregas, devolucion o estado comprometido.');
        return;
      }
      addDeletable(result.records, rental, 'rentals', 'soft-delete');
    });
  }

  if (moduleId === 'deliveries') {
    result.total = deliveries.length;
    deliveries.forEach((delivery) => {
      const linked = Boolean(delivery.rentalId || delivery.orderCode || delivery.contractId);
      const hasRouteResource = Boolean(delivery.driverId || delivery.vehicleId);
      if (linked || hasRouteResource || normalizeDeliveryStatus(delivery) !== 'programada') {
        addBlocked(result.records, delivery, 'Esta vinculada a orden, contrato, chofer, vehiculo o ruta avanzada.');
        return;
      }
      addDeletable(result.records, delivery, 'deliveries', 'soft-delete');
    });
  }

  if (moduleId === 'categories') {
    result.total = activeRows(state.categories).length;
    activeRows(state.categories).forEach((category) => {
      const linkedItems = items.filter((item) => item.category === category.name);
      if (linkedItems.length > 0) {
        addBlocked(result.records, category, `Tiene ${linkedItems.length} producto(s) asociado(s).`);
        return;
      }
      addDeletable(result.records, category, 'categories');
    });
  }

  if (moduleId === 'items') {
    result.total = items.length;
    items.forEach((item) => {
      const hasHistory =
        rentals.some((rental) => Array.isArray(rental.items) && rental.items.some((line) => line.itemId === item.id))
        || quotes.some((quote) => Array.isArray(quote.items) && quote.items.some((line) => line.itemId === item.id))
        || contracts.some((contract) => Array.isArray(contract.items) && contract.items.some((line) => line.itemId === item.id))
        || inventoryMovements.some((movement) => movement.itemId === item.id)
        || (state.stockRecoveries ?? []).some((entry) => entry.itemId === item.id)
        || (state.supplierLoans ?? []).some((loan) => Array.isArray(loan.items) && loan.items.some((line) => line.itemId === item.id));
      if (hasHistory || Number(item.availableStock ?? 0) < Number(item.totalStock ?? 0)) {
        addBlocked(result.records, item, 'Tiene historial de alquiler, inventario, proveedor o stock comprometido.');
        return;
      }
      addDeletable(result.records, item, 'items');
    });
  }

  if (moduleId === 'inventory_movements') {
    const recoveryRows = Array.isArray(state.stockRecoveries) ? state.stockRecoveries : [];
    result.total = inventoryMovements.length + recoveryRows.length;
    const hasBusinessLinks = rentals.length > 0 || contracts.length > 0 || deliveries.length > 0;
    if (hasBusinessLinks) {
      [...inventoryMovements, ...recoveryRows].forEach((entry) =>
        addBlocked(result.records, entry, 'Existen ordenes, contratos o entregas que requieren conservar kardex.'),
      );
    } else {
      inventoryMovements.forEach((entry) => addDeletable(result.records, entry, 'inventoryMovements'));
      recoveryRows.forEach((entry) => addDeletable(result.records, entry, 'stockRecoveries'));
    }
  }

  if (moduleId === 'cash_accounting') {
    result.total = cashMovements.length + (Array.isArray(state.cashSessions) ? state.cashSessions.length : 0);
    cashMovements.forEach((movement) => {
      addDeletable(result.records, movement, 'cashMovements');
    });
    activeRows(state.cashSessions).forEach((session) => {
      addDeletable(result.records, session, 'cashSessions');
    });
  }

  if (moduleId === 'transport_fleet') {
    const vehicles = activeRows(state.vehicles);
    const drivers = activeRows(state.drivers);
    result.total = vehicles.length + drivers.length;
    vehicles.forEach((vehicle) => {
      if (deliveries.some((delivery) => delivery.vehicleId === vehicle.id)) {
        addBlocked(result.records, vehicle, 'Vehiculo usado en entregas o rutas.');
        return;
      }
      addDeletable(result.records, vehicle, 'vehicles', 'soft-delete');
    });
    drivers.forEach((driver) => {
      if (deliveries.some((delivery) => delivery.driverId === driver.id)) {
        addBlocked(result.records, driver, 'Chofer usado en entregas o rutas.');
        return;
      }
      addDeletable(result.records, driver, 'drivers', 'soft-delete');
    });
  }

  if (moduleId === 'suppliers') {
    const suppliers = activeRows(state.suppliers);
    result.total = suppliers.length;
    suppliers.forEach((supplier) => {
      const linked = activeRows(state.supplierQuotes).some((quote) => quote.supplierId === supplier.id)
        || activeRows(state.supplierLoans).some((loan) => loan.supplierId === supplier.id);
      if (linked) {
        addBlocked(result.records, supplier, 'Tiene cotizaciones o prestamos de proveedor asociados.');
        return;
      }
      addDeletable(result.records, supplier, 'suppliers', 'soft-delete');
    });
  }

  if (moduleId === 'supplier_documents') {
    const supplierQuotes = activeRows(state.supplierQuotes);
    const supplierLoans = activeRows(state.supplierLoans);
    result.total = supplierQuotes.length + supplierLoans.length;
    supplierQuotes.forEach((quote) => {
      const status = normalizeText(quote.status);
      if (['approved', 'aprobada', 'aceptada'].includes(status)) {
        addBlocked(result.records, quote, 'Cotizacion de proveedor aprobada.');
        return;
      }
      addDeletable(result.records, quote, 'supplierQuotes', 'soft-delete');
    });
    supplierLoans.forEach((loan) => {
      const status = normalizeText(loan.status);
      if (!['draft', 'borrador', 'cancelled', 'cancelado'].includes(status)) {
        addBlocked(result.records, loan, 'Prestamo/subalquiler activo, completado o comprometido.');
        return;
      }
      addDeletable(result.records, loan, 'supplierLoans', 'soft-delete');
    });
  }

  if (moduleId === 'personnel') {
    const employees = activeRows(state.personnelEmployees);
    result.total = employees.length;
    employees.forEach((employee) => {
      const linked = (state.personnelAttendance ?? []).some((entry) => entry.employeeId === employee.id)
        || (state.personnelIncidents ?? []).some((entry) => entry.employeeId === employee.id);
      if (linked) {
        addBlocked(result.records, employee, 'Tiene asistencia o incidentes registrados.');
        return;
      }
      addDeletable(result.records, employee, 'personnelEmployees', 'soft-delete');
    });
  }

  if (moduleId === 'personnel_history') {
    const attendance = Array.isArray(state.personnelAttendance) ? state.personnelAttendance : [];
    const incidents = Array.isArray(state.personnelIncidents) ? state.personnelIncidents : [];
    result.total = attendance.length + incidents.length;
    attendance.forEach((entry) => addDeletable(result.records, entry, 'personnelAttendance'));
    incidents.forEach((entry) => addDeletable(result.records, entry, 'personnelIncidents'));
  }

  if (moduleId === 'users') {
    const users = activeRows(state.users);
    const currentUserId = readSessionUserId();
    result.total = users.length;
    users.forEach((user) => {
      const wouldKeepAdmins = users.filter((entry) =>
        entry.id !== user.id
        && entry.status === 'active'
        && getUserRoleIds(entry).some((roleId) => ['developer', 'super_admin', 'admin'].includes(roleId))
      );
      const activeDevelopers = users.filter((entry) => entry.status === 'active' && isDeveloperUser(entry));
      if (user.id === currentUserId) {
        addBlocked(result.records, user, 'No se puede borrar el usuario developer actual.');
        return;
      }
      if (isDeveloperUser(user) && activeDevelopers.length <= 1) {
        addBlocked(result.records, user, 'No se puede borrar el ultimo developer.');
        return;
      }
      if (wouldKeepAdmins.length === 0) {
        addBlocked(result.records, user, 'No se puede dejar el sistema sin usuarios administrativos activos.');
        return;
      }
      if (!['suspended', 'invited'].includes(user.status)) {
        addBlocked(result.records, user, 'Solo se eliminan usuarios secundarios suspendidos o invitados.');
        return;
      }
      addDeletable(result.records, user, 'users', 'soft-delete');
    });
  }

  result.deleteCount = result.records.deletable.length;
  result.blockedCount = result.records.blocked.length;
  result.dependencies = result.records.blocked.slice(0, 12).map((entry) => `${entry.label}: ${entry.reason}`);
  return result;
};

const analyzeSystemReset = (state, selectedModuleIds) => {
  const requested = [...new Set((Array.isArray(selectedModuleIds) ? selectedModuleIds : [])
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => RESET_MODULE_MAP.has(entry)))];
  const selected = requested.includes('factory_reset') ? ['factory_reset'] : requested;

  const modules = (selected.length > 0 ? selected : []).map((moduleId) => analyzeResetModule(state, moduleId)).filter(Boolean);
  const summary = modules.reduce(
    (acc, module) => {
      acc.total += module.total;
      acc.deletable += module.deleteCount;
      acc.blocked += module.blockedCount;
      if (module.level === 'critical') acc.critical += 1;
      return acc;
    },
    { total: 0, deletable: 0, blocked: 0, critical: 0 },
  );

  return {
    availableModules: RESET_MODULES,
    selectedModules: selected,
    modules,
    summary,
    canExecute: selected.length > 0 && summary.deletable > 0,
  };
};

const applyTrialCleanup = (state) => {
  const deletedByCollection = {};

  TRIAL_CLEANUP_COLLECTIONS.forEach((collection) => {
    const rows = Array.isArray(state[collection]) ? state[collection] : [];
    if (rows.length > 0) {
      deletedByCollection[collection] = rows.length;
    }
    state[collection] = [];
  });

  const now = new Date().toISOString();
  state.items = Array.isArray(state.items)
    ? state.items.map((item) => {
      if (item?.deletedAt) return item;
      const totalStock = Math.max(0, Math.trunc(Number(item?.totalStock ?? 0)));
      return {
        ...item,
        totalStock,
        availableStock: totalStock,
        updatedAt: now,
      };
    })
    : [];

  state.settings = {
    ...createDefaultSettings(),
    ...(state.settings ?? {}),
    numbering: {
      ...createDefaultSettings().numbering,
      ...(state.settings?.numbering ?? {}),
      ...TRIAL_CLEANUP_NUMBERING_RESETS,
    },
  };

  return deletedByCollection;
};

const applyCashAccountingReset = (state) => {
  const deletedByCollection = {};
  const previousMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
  const previousSessions = Array.isArray(state.cashSessions) ? state.cashSessions : [];

  if (previousMovements.length > 0) {
    deletedByCollection.cashMovements = previousMovements.length;
  }
  if (previousSessions.length > 0) {
    deletedByCollection.cashSessions = previousSessions.length;
  }

  state.cashSessions = [];
  state.cashMovements = [];

  const activeGuaranteeRentals = Array.isArray(state.rentals)
    ? state.rentals
      .filter((rental) => !rental?.deletedAt && String(rental?.status ?? '').toLowerCase() === 'active')
      .filter((rental) => Number(rental?.depositBs ?? 0) > 0)
    : [];
  const contractByRentalId = new Map(
    (Array.isArray(state.contracts) ? state.contracts : [])
      .filter((contract) => !contract?.deletedAt)
      .map((contract) => [String(contract.rentalId ?? ''), contract]),
  );

  activeGuaranteeRentals.forEach((rental) => {
    const contract = contractByRentalId.get(String(rental.id ?? ''));
    const primaryResponsible = contract?.responsibles?.[0] ?? null;
    const responsibleName = String(
      primaryResponsible?.name
      ?? contract?.createdByName
      ?? rental?.createdByName
      ?? contract?.createdBy
      ?? rental?.createdBy
      ?? 'Contabilidad',
    ).trim() || 'Contabilidad';
    state.cashMovements.push(buildCashMovement({
      type: 'ingreso_garantia',
      amountBs: Number(rental.depositBs ?? 0),
      description: `Ingreso garantia: ${rental.customerName ?? 'Cliente'}`,
      sourceType: 'rental',
      sourceId: rental.id,
      createdBy: responsibleName,
      responsible: responsibleName,
      cashBoxType: CASH_BOX_TYPES.BIG_CASH,
      category: 'garantia',
      linkedRentalId: rental.id,
      linkedContractId: rental.contractId ?? contract?.id ?? '',
      linkedOrderCode: rental.orderCode ?? contract?.orderCode ?? '',
      notes: 'Regenerado por reset contable: solo garantia activa.',
    }));
  });

  return deletedByCollection;
};

const applyFactoryReset = (state, analysis) => {
  const preservedDevelopers = activeRows(state.users)
    .filter((user) => isDeveloperUser(user))
    .map((user) => ({
      ...deepClone(user),
      status: 'active',
      deletedAt: null,
      updatedAt: new Date().toISOString(),
    }));
  if (preservedDevelopers.length === 0) {
    throw new Error('No se puede ejecutar reset total sin al menos un usuario developer para conservar.');
  }

  const currentUserId = readSessionUserId();
  if (!preservedDevelopers.some((user) => user.id === currentUserId)) {
    throw new Error('El usuario developer actual debe quedar preservado.');
  }

  const deletedByCollection = {};
  const factoryModule = analysis.modules.find((module) => module.id === 'factory_reset');
  factoryModule?.records?.deletable?.forEach((entry) => {
    deletedByCollection[entry.collection] = (deletedByCollection[entry.collection] ?? 0) + 1;
  });

  const preservedResetLogs = Array.isArray(state.resetLogs) ? deepClone(state.resetLogs) : [];
  const freshState = createSeedData();
  freshState.users = preservedDevelopers;
  freshState.resetLogs = preservedResetLogs;

  Object.keys(state).forEach((key) => {
    delete state[key];
  });
  Object.assign(state, freshState);
  return deletedByCollection;
};

const applyResetAnalysis = (state, analysis) => {
  if (analysis.selectedModules.includes('trial_cleanup')) {
    return applyTrialCleanup(state);
  }

  if (analysis.selectedModules.includes('factory_reset')) {
    return applyFactoryReset(state, analysis);
  }

  const deletedByCollection = {};
  const now = new Date().toISOString();
  if (analysis.selectedModules.includes('cash_accounting')) {
    Object.assign(deletedByCollection, applyCashAccountingReset(state));
  }
  analysis.modules.forEach((module) => {
    if (module.id === 'cash_accounting') return;
    module.records.deletable.forEach((entry) => {
      const rows = state[entry.collection];
      if (!Array.isArray(rows)) return;
      const index = rows.findIndex((row) => String(row?.id ?? row?.code) === entry.id);
      if (index < 0) return;
      if (entry.mode === 'soft-delete') {
        rows[index] = {
          ...rows[index],
          deletedAt: now,
          status: rows[index].status === 'active' ? 'suspended' : rows[index].status,
          updatedAt: now,
        };
      } else {
        rows.splice(index, 1);
      }
      deletedByCollection[entry.collection] = (deletedByCollection[entry.collection] ?? 0) + 1;
    });
  });
  return deletedByCollection;
};

const getActiveSession = (state) => state.cashSessions.find((session) => session.status === 'open') ?? null;
const CASH_BOX_TYPES = {
  BIG_CASH: 'BIG_CASH',
  PETTY_CASH: 'PETTY_CASH',
};

const normalizeCashBoxType = (value, fallback = CASH_BOX_TYPES.BIG_CASH) =>
  Object.values(CASH_BOX_TYPES).includes(value) ? value : fallback;

const normalizeCashCategory = (value) => String(value ?? '').trim().toLowerCase();

const normalizePaymentMethod = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['efectivo', 'qr', 'transferencia'].includes(normalized) ? normalized : 'efectivo';
};

const QR_PAYMENT_ACCOUNTS = ['CIDRE', 'BCP', 'MERCANTIL', 'BNB', 'BANCO FIE'];

const normalizeQrPaymentAccount = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return QR_PAYMENT_ACCOUNTS.includes(normalized) ? normalized : '';
};

const PETTY_CASH_CATEGORY_HINTS = [
  'gasto_menor',
  'materiales_menores',
  'transporte_menor',
  'lavado_menor',
  'reparacion_menor',
  'gasto_diario',
  'urgencia_evento',
];

const inferCashBoxType = ({ movementType, category, cashBoxType }) => {
  const normalized = normalizeCashBoxType(cashBoxType, null);
  if (normalized) return normalized;
  const normalizedCategory = normalizeCashCategory(category);
  if (
    normalizedCategory === 'reposicion_caja_chica'
    || (movementType === 'egreso' && PETTY_CASH_CATEGORY_HINTS.includes(normalizedCategory))
  ) {
    return CASH_BOX_TYPES.PETTY_CASH;
  }
  return CASH_BOX_TYPES.BIG_CASH;
};

const buildCashMovement = ({
  sessionId = null,
  type,
  amountBs,
  description,
  sourceType = null,
  sourceId = null,
  createdBy = 'Sistema',
  createdByName = '',
  userName = '',
  cashBoxType = CASH_BOX_TYPES.BIG_CASH,
  category = '',
  paymentMethod = '',
  paymentAccount = '',
  responsible = '',
  receipt = '',
  receiptCode = '',
  notes = '',
  isInternalTransfer = false,
  transferGroupId = null,
  receiptStatus = '',
  voidedAt = null,
  voidedBy = '',
  voidReason = '',
  replacedByMovementId = null,
  replacementOfMovementId = null,
  linkedRentalId = null,
  linkedContractId = null,
  linkedOrderCode = null,
  accountingTag = '',
  collectionTarget = '',
  collectionTargets = [],
  collectionBreakdown = [],
  receiptDetail = '',
  transportRevenueBs = 0,
  damageCollectedBs = 0,
  transportExpenseBs = 0,
}) => ({
  id: makeId('mov'),
  sessionId,
  type,
  amountBs: Number(Number(amountBs ?? 0).toFixed(2)),
  description,
  sourceType,
  sourceId,
  createdBy,
  createdByName: String(createdByName || userName || createdBy || '').trim(),
  userName: String(userName || createdByName || createdBy || '').trim(),
  cashBoxType: normalizeCashBoxType(cashBoxType),
  category: String(category ?? '').trim(),
  paymentMethod: String(paymentMethod ?? '').trim(),
  paymentAccount: normalizePaymentMethod(paymentMethod) === 'qr' ? normalizeQrPaymentAccount(paymentAccount) : '',
  responsible: String(responsible ?? createdBy ?? '').trim(),
  receipt: String(receipt ?? '').trim(),
  receiptCode: String(receiptCode ?? '').trim(),
  notes: String(notes ?? '').trim(),
  isInternalTransfer: Boolean(isInternalTransfer),
  transferGroupId,
  receiptStatus: String(receiptStatus ?? '').trim(),
  voidedAt,
  voidedBy: String(voidedBy ?? '').trim(),
  voidReason: String(voidReason ?? '').trim(),
  replacedByMovementId,
  replacementOfMovementId,
  linkedRentalId: String(linkedRentalId ?? '').trim() || null,
  linkedContractId: String(linkedContractId ?? '').trim() || null,
  linkedOrderCode: String(linkedOrderCode ?? '').trim() || null,
  accountingTag: String(accountingTag ?? '').trim(),
  collectionTarget: String(collectionTarget ?? '').trim(),
  collectionTargets: Array.isArray(collectionTargets) ? collectionTargets.map((target) => String(target ?? '').trim()).filter(Boolean) : [],
  collectionBreakdown: Array.isArray(collectionBreakdown)
    ? collectionBreakdown.map((entry) => ({
      target: String(entry?.target ?? '').trim(),
      label: String(entry?.label ?? '').trim(),
      amountBs: Number(Number(entry?.amountBs ?? 0).toFixed(2)),
      detail: String(entry?.detail ?? '').trim(),
      category: String(entry?.category ?? '').trim(),
      accountingTag: String(entry?.accountingTag ?? '').trim(),
    })).filter((entry) => entry.target && entry.amountBs > 0)
    : [],
  receiptDetail: String(receiptDetail ?? '').trim(),
  transportRevenueBs: Number(Number(transportRevenueBs ?? 0).toFixed(2)),
  damageCollectedBs: Number(Number(damageCollectedBs ?? 0).toFixed(2)),
  transportExpenseBs: Number(Number(transportExpenseBs ?? 0).toFixed(2)),
  createdAt: new Date().toISOString(),
});

const isVoidedCashMovement = (movement) =>
  String(movement?.receiptStatus ?? '').toLowerCase() === 'anulado'
  || Boolean(movement?.voidedAt);

const isGuaranteeCashMovement = (movement) => {
  const type = normalizeText(movement?.type);
  const category = normalizeText(movement?.category);
  const tag = normalizeText(movement?.accountingTag);
  return type.includes('garantia') || category.includes('garantia') || tag.includes('guarantee');
};

const getContractCashReferenceKeys = (state, contract) => {
  const rentals = Array.isArray(state?.rentals) ? state.rentals : [];
  const linkedRental = rentals.find((rental) => (
    !rental?.deletedAt
    && (
      String(rental?.id ?? '') === String(contract?.rentalId ?? '')
      || String(rental?.contractId ?? '') === String(contract?.id ?? '')
      || normalizeText(rental?.contractCode) === normalizeText(contract?.contractCode)
      || normalizeText(rental?.orderCode) === normalizeText(contract?.orderCode)
    )
  ));
  return [
    contract?.id,
    contract?.rentalId,
    contract?.contractCode,
    contract?.orderCode,
    linkedRental?.id,
    linkedRental?.contractId,
    linkedRental?.contractCode,
    linkedRental?.orderCode,
  ].map(normalizeText).filter(Boolean);
};

const cashMovementMatchesContract = (movement, referenceKeys) => {
  if (!referenceKeys.length) return false;
  const exactValues = [
    movement?.linkedContractId,
    movement?.linkedRentalId,
    movement?.linkedOrderCode,
    movement?.contractId,
    movement?.rentalId,
    movement?.orderCode,
    movement?.contractCode,
    movement?.sourceId,
    movement?.reference,
  ].map(normalizeText).filter(Boolean);
  if (exactValues.some((value) => referenceKeys.includes(value))) return true;
  return [movement?.notes, movement?.description]
    .map(normalizeText)
    .some((text) => text && referenceKeys.some((key) => text.includes(key)));
};

const isContractCollectionCashMovement = (movement) => {
  if (isVoidedCashMovement(movement) || isGuaranteeCashMovement(movement)) return false;
  const type = normalizeText(movement?.type);
  const category = normalizeText(movement?.category);
  const tag = normalizeText(movement?.accountingTag);
  const cashBoxType = normalizeText(movement?.cashBoxType);
  const receiptCode = String(movement?.receiptCode ?? movement?.receipt ?? '').trim();
  const isBigCash = ['big_cash', 'caja_grande', 'cajagrande'].includes(cashBoxType);
  const isIncome = type.includes('ingreso') || type.includes('cobro') || category === 'cobro_contrato';
  return tag === 'contract_economic_collection'
    || category === 'cobro_contrato'
    || type === 'ingreso_alquiler'
    || (Boolean(receiptCode) && isBigCash && isIncome);
};

const getRegisteredContractCollectionBs = (state, contract) => {
  const referenceKeys = getContractCashReferenceKeys(state, contract);
  return (Array.isArray(state?.cashMovements) ? state.cashMovements : [])
    .filter((movement) => cashMovementMatchesContract(movement, referenceKeys))
    .filter(isContractCollectionCashMovement)
    .reduce((sum, movement) => sum + Math.max(0, Number(movement?.amountBs ?? 0)), 0);
};

const getRegisteredContractGuaranteeBs = (state, contract) => {
  const referenceKeys = getContractCashReferenceKeys(state, contract);
  return (Array.isArray(state?.cashMovements) ? state.cashMovements : [])
    .filter((movement) => cashMovementMatchesContract(movement, referenceKeys))
    .filter((movement) => !isVoidedCashMovement(movement) && isGuaranteeCashMovement(movement))
    .reduce((sum, movement) => sum + Math.max(0, Number(movement?.amountBs ?? 0)), 0);
};

const getCashReceiptCode = (state, movement) => {
  const persisted = String(movement?.receiptCode ?? '').trim();
  if (persisted) return persisted;
  const index = (state.cashMovements ?? [])
    .slice()
    .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0))
    .findIndex((entry) => entry.id === movement?.id);
  return `RC-${String(index >= 0 ? index + 1 : (state.cashMovements?.length ?? 0) + 1).padStart(4, '0')}`;
};

const nextCashReceiptCode = (state) => {
  const maxPersisted = (state.cashMovements ?? []).reduce((max, movement) => {
    const match = String(movement?.receiptCode ?? '').match(/^RC-(\d+)$/i);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const next = maxPersisted > 0 ? maxPersisted + 1 : (state.cashMovements?.length ?? 0) + 1;
  return `RC-${String(next).padStart(4, '0')}`;
};

const nextDebtCode = (state) => {
  const maxPersisted = (state.cashDebts ?? []).reduce((max, debt) => {
    const match = String(debt?.code ?? '').match(/^DEU-(\d+)$/i);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `DEU-${String(maxPersisted + 1).padStart(5, '0')}`;
};

const normalizeCashDebtKind = (value) => {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  if (normalized.includes('lia') || normalized.includes('reembolso') || normalized.includes('cobrar')) return 'lia_reimbursement';
  return 'payable';
};

const nextAttendanceCode = (state) => {
  const maxPersisted = (state.attendanceRecords ?? []).reduce((max, record) => {
    const match = String(record?.code ?? '').match(/^ASI-(\d+)$/i);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `ASI-${String(maxPersisted + 1).padStart(5, '0')}`;
};

const calculateSessionBalance = (state, sessionId, cashBoxType = null) => {
  const balance = state.cashMovements
    .filter((movement) => !isVoidedCashMovement(movement))
    .filter((movement) => movement.sessionId === sessionId)
    .filter((movement) => !cashBoxType || normalizeCashBoxType(movement.cashBoxType) === cashBoxType)
    .reduce((sum, movement) => sum + Number(movement.amountBs ?? 0), 0);
  return Number(balance.toFixed(2));
};

const calculateCashBoxBalance = (state, cashBoxType) => Number(
  state.cashMovements
    .filter((movement) => !isVoidedCashMovement(movement))
    .filter((movement) => normalizeCashBoxType(movement.cashBoxType) === cashBoxType)
    .reduce((sum, movement) => sum + Number(movement.amountBs ?? 0), 0)
    .toFixed(2),
);

const calculateHeldGuarantees = (state) => Number(
  state.rentals
    .filter((rental) => !rental.deletedAt && String(rental.status ?? '').toLowerCase() === 'active')
    .reduce((sum, rental) => sum + Number(rental.depositBs ?? 0), 0)
    .toFixed(2),
);

const calculateOperationalBigCashBalance = (state) =>
  Number(Math.max(0, calculateCashBoxBalance(state, CASH_BOX_TYPES.BIG_CASH) - calculateHeldGuarantees(state)).toFixed(2));

const addRentalCashMovements = (state, rental) => {
  const activeSession = getActiveSession(state);
  const sessionId = activeSession?.id ?? null;
  const customerName = String(rental.customerName ?? 'Cliente');
  const paidAtRentalBs = Number(
    rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs ?? rental?.totals?.totalBs ?? 0,
  );
  const prepaidAppliedBs = Number(rental?.payment?.prepaidAppliedBs ?? rental?.totals?.prepaidAppliedBs ?? rental?.prepaidAppliedBs ?? 0);
  const cashCollectedBs = Math.max(0, Number((paidAtRentalBs - prepaidAppliedBs).toFixed(2)));
  const deliveryFeeBs = Math.max(0, Number(rental?.deliveryFeeBs ?? rental?.totals?.deliveryFeeBs ?? 0));
  const storedDeliveryFeeCollectedBs = Number(rental?.payment?.deliveryFeeCollectedBs ?? rental?.totals?.deliveryFeeCollectedBs ?? NaN);
  const deliveryFeeCollectedBs = Math.min(
    deliveryFeeBs,
    Number.isFinite(storedDeliveryFeeCollectedBs)
      ? storedDeliveryFeeCollectedBs
      : Math.min(cashCollectedBs, deliveryFeeBs),
  );
  const rentalCashCollectedBs = Math.max(0, Number((cashCollectedBs - deliveryFeeCollectedBs).toFixed(2)));
  const pendingPaymentBs = Number(rental?.payment?.pendingPaymentBs ?? rental?.totals?.pendingPaymentBs ?? 0);
  const depositBs = Number(rental?.depositBs ?? 0);
  const initialPaymentMethod = normalizePaymentMethod(rental?.payment?.initialPaymentMethod ?? rental?.payment?.paymentMethod);
  const guaranteePaymentMethod = normalizePaymentMethod(rental?.guarantee?.paymentMethod ?? rental?.payment?.guaranteePaymentMethod);
  const initialPaymentAccount = initialPaymentMethod === 'qr' ? normalizeQrPaymentAccount(rental?.payment?.initialPaymentAccount ?? rental?.payment?.paymentAccount) : '';
  const guaranteePaymentAccount = guaranteePaymentMethod === 'qr' ? normalizeQrPaymentAccount(rental?.guarantee?.paymentAccount ?? rental?.payment?.guaranteePaymentAccount) : '';
  const movementResponsible = String(
    rental?.createdByName
    ?? rental?.createdBy
    ?? rental?.userName
    ?? 'Contabilidad',
  ).trim() || 'Contabilidad';

  if (rentalCashCollectedBs > 0) {
    state.cashMovements.push(
      buildCashMovement({
        sessionId,
        type: 'ingreso_alquiler',
        amountBs: rentalCashCollectedBs,
        description: `Cobro inicial alquiler: ${customerName}`,
        sourceType: 'rental',
        sourceId: rental.id,
        createdBy: movementResponsible,
        responsible: movementResponsible,
        cashBoxType: CASH_BOX_TYPES.BIG_CASH,
        category: 'cobro_contrato',
        paymentMethod: initialPaymentMethod,
        paymentAccount: initialPaymentAccount,
        receiptCode: nextCashReceiptCode(state),
        linkedRentalId: rental.id,
        linkedContractId: rental.contractId,
        linkedOrderCode: rental.orderCode,
        accountingTag: 'initial_rental_payment',
        notes: `Pago inicial registrado al crear ${rental.orderCode ?? 'la orden'}`.trim(),
      }),
    );
  }

  if (deliveryFeeCollectedBs > 0) {
    state.cashMovements.push(
      buildCashMovement({
        sessionId,
        type: 'ingreso_transporte_cliente',
        amountBs: deliveryFeeCollectedBs,
        description: `Transporte cobrado al cliente: ${customerName}`,
        sourceType: 'rental',
        sourceId: rental.id,
        createdBy: movementResponsible,
        responsible: movementResponsible,
        cashBoxType: CASH_BOX_TYPES.BIG_CASH,
        category: 'transporte_cobrado',
        paymentMethod: initialPaymentMethod,
        paymentAccount: initialPaymentAccount,
        receiptCode: nextCashReceiptCode(state),
        linkedRentalId: rental.id,
        linkedContractId: rental.contractId,
        linkedOrderCode: rental.orderCode,
        accountingTag: 'transport_revenue',
        transportRevenueBs: deliveryFeeCollectedBs,
        notes: `Costo extra de envio ${rental.orderCode ?? ''}`.trim(),
      }),
    );
  }

  if (prepaidAppliedBs > 0) {
    state.cashMovements.push(
      buildCashMovement({
        sessionId,
        type: 'aplicacion_saldo_prepago',
        amountBs: 0,
        description: `Aplicacion saldo prepago (${customerName}): Bs ${prepaidAppliedBs.toFixed(2)}`,
        sourceType: 'rental',
        sourceId: rental.id,
        createdBy: movementResponsible,
        responsible: movementResponsible,
        cashBoxType: CASH_BOX_TYPES.BIG_CASH,
        category: 'garantia',
        paymentMethod: guaranteePaymentMethod,
        paymentAccount: guaranteePaymentAccount,
        receiptCode: nextCashReceiptCode(state),
        linkedRentalId: rental.id,
        linkedContractId: rental.contractId,
        linkedOrderCode: rental.orderCode,
        accountingTag: 'validated_guarantee',
        notes: `Garantia pagada registrada al crear ${rental.orderCode ?? 'la orden'}`.trim(),
      }),
    );
  }

  if (depositBs > 0) {
    state.cashMovements.push(
      buildCashMovement({
        sessionId,
        type: 'ingreso_garantia',
        amountBs: depositBs,
        description: `Ingreso garantia: ${customerName}`,
        sourceType: 'rental',
        sourceId: rental.id,
        createdBy: movementResponsible,
        responsible: movementResponsible,
        cashBoxType: CASH_BOX_TYPES.BIG_CASH,
        category: 'garantia',
        paymentMethod: guaranteePaymentMethod,
        paymentAccount: guaranteePaymentAccount,
        linkedRentalId: rental.id,
        linkedContractId: rental.contractId,
        linkedOrderCode: rental.orderCode,
      }),
    );
  }

  if (pendingPaymentBs > 0) {
    state.cashMovements.push(
      buildCashMovement({
        sessionId,
        type: 'saldo_alquiler_pendiente',
        amountBs: 0,
        description: `Saldo alquiler pendiente (${customerName}): Bs ${pendingPaymentBs.toFixed(2)}`,
        sourceType: 'rental',
        sourceId: rental.id,
        createdBy: movementResponsible,
        responsible: movementResponsible,
        cashBoxType: CASH_BOX_TYPES.BIG_CASH,
      }),
    );
  }
};

const addReturnCashMovements = (state, rental) => {
  const activeSession = getActiveSession(state);
  const sessionId = activeSession?.id ?? null;
  const customerName = String(rental.customerName ?? 'Cliente');
  const settlement = rental?.returnSettlement ?? {};
  const penaltiesBs = Number(settlement?.penaltiesBs ?? rental?.penaltiesBs ?? 0);
  const internalPenaltiesBs = Number(settlement?.internalPenaltiesBs ?? rental?.internalPenaltiesBs ?? 0);
  const outstandingRentalBs = Number(settlement?.outstandingRentalBs ?? 0);
  const pendingCollectionBs = Number(settlement?.pendingCollectionBs ?? 0);
  const refundBs = Number(settlement?.refundBs ?? rental?.refundBs ?? 0);

  state.cashMovements.push(
    buildCashMovement({
      sessionId,
      type: 'liquidacion_devolucion',
      amountBs: 0,
      description: `Liquidacion devolucion (${customerName}) | Penalidad cliente: Bs ${penaltiesBs.toFixed(2)} | Perdida interna: Bs ${internalPenaltiesBs.toFixed(2)} | Saldo alquiler: Bs ${outstandingRentalBs.toFixed(2)} | Reembolso: Bs ${refundBs.toFixed(2)}`,
      sourceType: 'return',
      sourceId: rental.id,
      cashBoxType: CASH_BOX_TYPES.BIG_CASH,
    }),
  );

  if (pendingCollectionBs > 0) {
    state.cashMovements.push(
      buildCashMovement({
        sessionId,
        type: 'saldo_pendiente_cobro',
        amountBs: 0,
        description: `Saldo pendiente por cobrar (${customerName}): Bs ${pendingCollectionBs.toFixed(2)}`,
        sourceType: 'return',
        sourceId: rental.id,
        cashBoxType: CASH_BOX_TYPES.BIG_CASH,
      }),
    );
  }

  if (internalPenaltiesBs > 0) {
    state.cashMovements.push(
      buildCashMovement({
        sessionId,
        type: 'perdida_interna_devolucion',
        amountBs: 0,
        description: `Perdida interna por devolucion (${customerName}): Bs ${internalPenaltiesBs.toFixed(2)}`,
        sourceType: 'return_internal_loss',
        sourceId: rental.id,
        cashBoxType: CASH_BOX_TYPES.BIG_CASH,
      }),
    );
  }
};

const revertReturnEffects = (state, rental) => {
  const previousReport = Array.isArray(rental?.returnReport) ? rental.returnReport : [];
  const now = new Date().toISOString();

  previousReport.forEach((line) => {
    const returnedToAvailableQty = Math.max(0, Math.trunc(Number(line?.returnedToAvailableQty ?? 0)));
    if (returnedToAvailableQty <= 0) return;
    const item = state.items.find((entry) => String(entry.id) === String(line.itemId));
    if (!item) return;
    item.availableStock = Math.max(0, Number(item.availableStock ?? 0) - returnedToAvailableQty);
    item.updatedAt = now;
  });

  state.stockRecoveries = (state.stockRecoveries ?? []).filter(
    (entry) => String(entry?.sourceRentalId ?? '') !== String(rental.id),
  );

  const automaticReturnMovementTypes = new Set([
    'liquidacion_devolucion',
    'saldo_pendiente_cobro',
    'perdida_interna_devolucion',
  ]);
  state.cashMovements = (state.cashMovements ?? []).filter((movement) => {
    const belongsToReturn = String(movement?.sourceId ?? '') === String(rental.id)
      && ['return', 'return_internal_loss'].includes(String(movement?.sourceType ?? ''));
    if (!belongsToReturn) return true;
    if (!automaticReturnMovementTypes.has(String(movement?.type ?? ''))) return true;
    return Number(movement?.amountBs ?? 0) !== 0;
  });
};

const getDueTimestamp = (rental) => {
  if (rental?.dueAt) {
    const parsed = new Date(rental.dueAt).getTime();
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  const dueDate = String(rental?.dueDate ?? '');
  const dueTime = String(rental?.dueTime ?? '23:59');
  const parsedFallback = new Date(`${dueDate}T${dueTime}:00`).getTime();
  return Number.isNaN(parsedFallback) ? Number.MAX_SAFE_INTEGER : parsedFallback;
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const resolveDocumentAssetUrl = (value) => {
  const source = String(value ?? '').trim();
  if (!source || source.startsWith('data:') || source.startsWith('blob:') || /^https?:\/\//i.test(source)) {
    return source;
  }
  if (typeof window === 'undefined' || !window.location?.origin) {
    return source;
  }
  try {
    return new URL(source.startsWith('/') ? source : `/${source}`, window.location.origin).toString();
  } catch {
    return source;
  }
};

const formatBs = (value) =>
  new Intl.NumberFormat('es-BO', {
    style: 'currency',
    currency: 'BOB',
    minimumFractionDigits: 2,
  }).format(Number(value ?? 0));

const formatDateTime = (value) => {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDate = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const openPrintWindow = (html) => {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=920,height=860');
  if (!printWindow) {
    throw new Error('No se pudo abrir la ventana de impresion. Habilita ventanas emergentes.');
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 120);
};

const cashReceiptIcon = (fileName) =>
  `<img class="cash-receipt-icon" src="${escapeHtml(`/imagenes/pdf contrato/${fileName}`)}" alt="" />`;

const numberToSpanish = (value) => {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  const units = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
  const specials = {
    10: 'diez',
    11: 'once',
    12: 'doce',
    13: 'trece',
    14: 'catorce',
    15: 'quince',
    20: 'veinte',
  };
  const tens = ['', '', 'veinti', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const hundreds = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
  if (n < 10) return units[n];
  if (specials[n]) return specials[n];
  if (n < 20) return `dieci${units[n - 10]}`;
  if (n < 30) return n === 21 ? 'veintiuno' : `${tens[2]}${units[n - 20]}`;
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const unit = n % 10;
    return unit ? `${tens[ten]} y ${units[unit]}` : tens[ten];
  }
  if (n === 100) return 'cien';
  if (n < 1000) {
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    return rest ? `${hundreds[hundred]} ${numberToSpanish(rest)}` : hundreds[hundred];
  }
  if (n < 1000000) {
    const thousand = Math.floor(n / 1000);
    const rest = n % 1000;
    const prefix = thousand === 1 ? 'mil' : `${numberToSpanish(thousand)} mil`;
    return rest ? `${prefix} ${numberToSpanish(rest)}` : prefix;
  }
  const million = Math.floor(n / 1000000);
  const rest = n % 1000000;
  const prefix = million === 1 ? 'un millon' : `${numberToSpanish(million)} millones`;
  return rest ? `${prefix} ${numberToSpanish(rest)}` : prefix;
};

const amountToBolivianosText = (value) => {
  const amount = Math.abs(Number(value ?? 0));
  const whole = Math.floor(amount);
  const cents = Math.round((amount - whole) * 100);
  return `${numberToSpanish(whole)} ${String(cents).padStart(2, '0')}/100 bolivianos`;
};

const buildCashReceiptHtml = ({ state, movement, printedByName = '' }) => {
  const company = getDocumentCompany(state.settings ?? {});
  const rentals = Array.isArray(state.rentals) ? state.rentals : [];
  const contracts = Array.isArray(state.contracts) ? state.contracts : [];
  const contractById = new Map(contracts.map((contract) => [String(contract?.id ?? ''), contract]));
  const contractByCode = new Map(contracts.map((contract) => [String(contract?.contractCode ?? ''), contract]));
  const contractByOrderCode = new Map(
    contracts
      .filter((contract) => contract?.orderCode)
      .map((contract) => [String(contract.orderCode), contract]),
  );
  const rentalById = new Map(rentals.map((rental) => [String(rental?.id ?? ''), rental]));
  const rentalByOrderCode = new Map(
    rentals
      .filter((rental) => rental?.orderCode)
      .map((rental) => [String(rental.orderCode), rental]),
  );
  const linkedRentalId = String(movement?.linkedRentalId ?? movement?.rentalId ?? '').trim();
  const linkedContractId = String(movement?.linkedContractId ?? movement?.contractId ?? '').trim();
  const linkedOrderCode = String(movement?.linkedOrderCode ?? movement?.orderCode ?? '').trim();
  const sourceId = String(movement?.sourceId ?? '').trim();
  const rentalContext = (linkedRentalId && rentalById.get(linkedRentalId))
    || (String(movement?.sourceType ?? '').trim() === 'rental' && sourceId && rentalById.get(sourceId))
    || (linkedOrderCode && rentalByOrderCode.get(linkedOrderCode))
    || null;
  const contractContext = (linkedContractId && contractById.get(linkedContractId))
    || (rentalContext?.contractId && contractById.get(String(rentalContext.contractId)))
    || (rentalContext?.contractCode && contractByCode.get(String(rentalContext.contractCode)))
    || (rentalContext?.orderCode && contractByOrderCode.get(String(rentalContext.orderCode)))
    || (linkedOrderCode && contractByOrderCode.get(linkedOrderCode))
    || (linkedOrderCode && contractByCode.get(linkedOrderCode))
    || null;
  const contractCode = String(
    contractContext?.contractCode
    ?? rentalContext?.contractCode
    ?? movement?.contractCode
    ?? '',
  ).trim();
  const primaryContractResponsible = Array.isArray(contractContext?.responsibles) ? contractContext.responsibles[0] : null;
  const contractResponsible = String(
    primaryContractResponsible?.name
    ?? contractContext?.responsibleName
    ?? contractContext?.createdByName
    ?? rentalContext?.responsibleName
    ?? rentalContext?.createdByName
    ?? rentalContext?.createdBy
    ?? '-',
  ).trim() || '-';
  const cashBoxType = normalizeCashBoxType(movement.cashBoxType);
  const amount = Math.abs(Number(movement.amountBs ?? 0));
  const isOut = Number(movement.amountBs ?? 0) < 0
    || String(movement.type ?? '').toLowerCase().includes('salida')
    || String(movement.type ?? '').toLowerCase().includes('egreso');
  const isPersonnelAdvance = String(movement?.accountingTag ?? '').toLowerCase() === 'personnel_advance'
    || String(movement?.category ?? '').toLowerCase() === 'adelanto_personal';
  const movementResponsible = String(movement?.responsible ?? '').trim();
  const movementCreator = String(
    movement?.createdByName
    ?? movement?.userName
    ?? movement?.createdBy
    ?? '',
  ).trim();
  const printedBy = String(printedByName ?? '').trim();
  const effectiveMovementCreator =
    isPersonnelAdvance && normalizeText(movementCreator) === normalizeText(movementResponsible)
      ? printedBy || movementCreator
      : movementCreator;
  const collectionUser = (isOut
    ? movementResponsible || movementCreator
    : movementCreator || movementResponsible) || 'Administracion';
  const contractCustomer = String(
    contractContext?.customerName
    ?? rentalContext?.customerName
    ?? movement?.customerName
    ?? movement?.clientName
    ?? '',
  ).trim();
  const partyName = isPersonnelAdvance
    ? movementResponsible || contractCustomer || movementCreator || 'Administracion'
    : isOut
    ? movementResponsible || contractCustomer || movementCreator || 'Administracion'
    : contractCustomer || movementResponsible || movementCreator || 'Administracion';
  const cashBoxLabel = cashBoxType === CASH_BOX_TYPES.PETTY_CASH ? 'Caja Chica' : 'Caja Grande';
  const movementLabel = isOut ? 'Egreso' : 'Ingreso';
  const title = isPersonnelAdvance
    ? 'RECIBO DE ADELANTO DE PERSONAL'
    : `RECIBO DE ${movementLabel.toUpperCase()} DE ${cashBoxLabel.toUpperCase()}`;
  const totalLabel = isPersonnelAdvance ? 'ADELANTO ENTREGADO' : isOut ? 'VALOR ENTREGADO' : 'VALOR RECIBIDO';
  const partyLabel = isPersonnelAdvance ? 'TRABAJADOR' : isOut ? 'ENTREGADO A' : 'RECIBIDO DE';
  const cashBoxRoleLabel = isOut ? 'Caja origen' : 'Caja destino';
  const createdAt = movement.createdAt ? new Date(movement.createdAt) : new Date();
  const dateLabel = formatDate(createdAt);
  const timeLabel = createdAt.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false });
  const receiptCode = getCashReceiptCode(state, movement);
  const reference = isPersonnelAdvance
    ? (movement.receipt || receiptCode)
    : contractCode ? `Contrato ${contractCode}` : movement.receipt || receiptCode;
  const storedReceiptDetail = String(movement?.receiptDetail ?? '').trim();
  const detail = storedReceiptDetail || (isPersonnelAdvance
    ? movement.description || 'Adelanto de personal'
    : contractCode && /cobro|saldo|alquiler|liquidacion/i.test(`${movement.description ?? ''} ${movement.category ?? ''}`)
    ? `${movementLabel} por contrato ${contractCode}`
    : movement.description || movement.category || 'Movimiento de caja');
  const detailHtml = escapeHtml(detail).replace(/\n/g, '<br>');
  const rawObservation = movement.notes || movement.note || movement.category || 'Movimiento registrado en sistema.';
  const observation = contractCode
    ? String(rawObservation).replace(/OS-\d+/gi, `Contrato ${contractCode}`)
    : rawObservation;
  const contextReferenceLabel = isPersonnelAdvance ? 'CI trabajador' : 'Contrato';
  const contextResponsibleLabel = isPersonnelAdvance ? 'Registrado por' : 'Resp. contrato';
  const contextResponsibleValue = isPersonnelAdvance ? effectiveMovementCreator || 'Administracion' : contractResponsible;
  const receiptUserHeader = isPersonnelAdvance ? 'Trabajador' : 'Usuario que cobra';
  const paymentMethodLabel = normalizePaymentMethod(movement.paymentMethod) === 'qr' && movement.paymentAccount
    ? `QR - ${movement.paymentAccount}`
    : movement.paymentMethod || 'Efectivo';

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)} ${escapeHtml(receiptCode)}</title>
      <style>
        @page { size: letter portrait; margin: 0; }
        * { box-sizing: border-box; }
        html { background: #f4f4f4; }
        body {
          margin: 0;
          padding: 8px 8px 12px;
          color: #06183f;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 10.4px;
          line-height: 1.22;
          overflow: auto;
        }
        h1, h2, h3, p { margin: 0; }
        .cash-receipt-sheet {
          width: 8.5in;
          height: 5.5in;
          margin: 0 auto;
          padding: 4.4mm 6mm 3.2mm;
          background:
            linear-gradient(135deg, rgba(255, 247, 237, 0.85), rgba(255, 255, 255, 0) 42%),
            #fff;
          border: 2px solid #f04b10;
          outline: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .receipt-top {
          display: grid;
          grid-template-columns: 72mm minmax(0, 1fr) 43mm;
          gap: 4mm;
          align-items: center;
          padding: 0 3mm 3mm;
          border-bottom: 2px solid #f04b10;
        }
        .receipt-brand { display: grid; grid-template-columns: 23mm minmax(0, 1fr); gap: 4mm; align-items: center; min-width: 0; }
        .brand-stamp {
          display: grid;
          place-items: center;
          width: 24mm;
          height: 24mm;
          color: #f04b10;
        }
        .brand-stamp svg {
          width: 24mm;
          height: 24mm;
          display: block;
        }
        .brand-name {
          font-family: Georgia, "Times New Roman", serif;
          font-size: 27px;
          font-style: italic;
          font-weight: 800;
          letter-spacing: 0;
          color: #111;
          white-space: nowrap;
        }
        .brand-subtitle { margin-top: 2px; color: #f04b10; font-size: 9px; font-weight: 900; line-height: 1.2; text-transform: uppercase; }
        .receipt-title {
          min-width: 0;
          text-align: center;
          border-left: 2px solid #111;
          border-right: 2px solid #111;
          padding: 1mm 3mm 0;
        }
        .receipt-title h1 {
          font-size: 15.2px;
          font-weight: 900;
          letter-spacing: 0;
          line-height: 1.02;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .receipt-code { display: inline-block; margin-top: 2.2mm; padding: 1.1mm 7mm; border: 1.5px solid #f04b10; border-radius: 7px; background: #fff7ed; color: #ea580c; font-size: 16px; font-weight: 900; }
        .receipt-contract-code {
          display: block;
          margin-top: 1.7mm;
          color: #f04b10;
          font-size: 18px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: 0.035em;
          text-transform: uppercase;
        }
        .receipt-contract-code small {
          display: block;
          margin-bottom: 0.6mm;
          color: #7c2d12;
          font-size: 7.4px;
          letter-spacing: 0.08em;
        }
        .receipt-datebox { display: grid; gap: 2.5mm; font-size: 11.5px; min-width: 0; }
        .receipt-datebox span { display: flex; justify-content: space-between; gap: 8px; min-width: 0; }
        .receipt-datebox strong { font-size: 11px; font-weight: 900; }
        .receipt-datebox .contract-chip {
          display: block;
          padding: 1.2mm 2.5mm;
          border: 1.4px solid #fdba74;
          border-radius: 8px;
          background: #fff7ed;
          color: #ea580c;
          text-align: center;
          font-size: 12.5px;
          font-weight: 950;
          letter-spacing: 0.02em;
        }
        .receipt-datebox .contract-chip small {
          display: block;
          color: #7c2d12;
          font-size: 7.5px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .receipt-contact {
          display: grid;
          grid-template-columns: 1fr 1.25fr 1.7fr;
          gap: 3mm;
          align-items: center;
          padding: 1.8mm 7mm;
          border-bottom: 1.5px solid #0f2a5f;
          color: #111;
          font-size: 9.5px;
          text-align: center;
        }
        .receipt-contact span {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 6px;
          min-width: 0;
          border-right: 1.5px solid #0f2a5f;
        }
        .receipt-contact span:last-child { border-right: 0; }
        .cash-receipt-icon {
          width: 14px;
          height: 14px;
          object-fit: contain;
          flex: 0 0 auto;
        }
        .receipt-info {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4mm;
          padding: 2.6mm 4mm;
          border: 1.3px solid #c7d2fe;
          border-radius: 8px;
          background: #ffffff;
          margin-top: 2.6mm;
          height: 28mm;
          overflow: hidden;
        }
        .info-col + .info-col { border-left: 1.3px solid #c7d2fe; padding-left: 4mm; }
        .info-line { display: grid; grid-template-columns: 32mm 4mm minmax(0, 1fr); gap: 1.6mm; margin-bottom: 1.25mm; font-size: 10.2px; line-height: 1.1; }
        .info-line strong { color: #0f2a5f; text-transform: uppercase; font-weight: 900; }
        .info-line span { max-height: 7.4mm; overflow: hidden; overflow-wrap: anywhere; }
        .info-line.is-important span {
          color: #ea580c;
          font-size: 11px;
          font-weight: 950;
          text-transform: uppercase;
        }
        table { width: 100%; border-collapse: collapse; margin-top: 2.6mm; table-layout: fixed; }
        th, td { border: 1.25px solid #0f2a5f; padding: 2.25mm 2.5mm; text-align: center; font-size: 10.4px; line-height: 1.12; overflow-wrap: anywhere; }
        th { background: #0f2a5f; color: #fff; font-size: 10.6px; letter-spacing: 0.035em; text-transform: uppercase; font-weight: 900; }
        td.detail { text-align: left; max-height: 11mm; overflow: hidden; }
        .receipt-total-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 63mm;
          gap: 6mm;
          align-items: center;
          margin-top: 2.2mm;
        }
        .amount-words { display: flex; gap: 3mm; justify-content: flex-end; align-items: flex-end; font-size: 9.5px; min-width: 0; }
        .amount-words span { min-width: 66mm; border-bottom: 1.4px solid #0f2a5f; padding-bottom: 0.8mm; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .total-box {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border: 1.4px solid #0f2a5f;
          background: #f8fafc;
          padding: 1.8mm 4.8mm;
          font-size: 12.5px;
          font-weight: 900;
          gap: 4mm;
        }
        .total-box span { white-space: nowrap; }
        .total-box b { white-space: nowrap; }
        .receipt-signatures {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24mm;
          margin: auto 17mm 3mm;
          padding-top: 7mm;
          text-align: center;
        }
        .signature-line { border-top: 1.4px solid #0f2a5f; padding-top: 1.6mm; }
        .signature-line strong { display: block; font-size: 10.5px; }
        .signature-line span { font-size: 9px; }
        .receipt-warning {
          margin-top: 0;
          border-bottom: 1.5px solid #f04b10;
          padding-bottom: 1.2mm;
          text-align: center;
          color: #f04b10;
          font-weight: 800;
          font-size: 10.5px;
        }
        .receipt-footer { margin-top: 1mm; text-align: center; font-size: 9.5px; }
        @media print {
          html, body {
            width: 8.5in;
            height: 11in;
            background: #fff;
            padding: 0;
            overflow: hidden;
          }
          body {
            display: block;
          }
          .cash-receipt-sheet {
            box-shadow: none;
            margin: 0;
            transform: none;
            page-break-after: avoid;
            break-after: avoid;
          }
          .receipt-preview-actions { display: none !important; }
        }
        @media screen {
          .cash-receipt-sheet {
            transform: scale(0.96);
            transform-origin: top center;
            margin-bottom: -5mm;
            box-shadow: 0 10px 36px rgba(17, 24, 39, 0.16);
          }
        }
        .receipt-preview-actions {
          position: sticky;
          top: 0;
          z-index: 10;
          display: flex;
          justify-content: center;
          gap: 10px;
          margin: 0 auto 10px;
          padding: 10px;
          background: rgba(255, 255, 255, 0.92);
          border-bottom: 1px solid #fed7aa;
          backdrop-filter: blur(10px);
        }
        .receipt-preview-actions button {
          min-height: 34px;
          padding: 0 14px;
          border: 1px solid #fed7aa;
          border-radius: 999px;
          background: #fff7ed;
          color: #c2410c;
          font: 800 12px Arial, sans-serif;
          cursor: pointer;
        }
        .receipt-preview-actions button.primary {
          background: #f04b10;
          border-color: #f04b10;
          color: #fff;
        }
      </style>
    </head>
    <body>
      <div class="receipt-preview-actions">
        <button type="button" class="primary" onclick="window.print()">Imprimir / guardar PDF</button>
        <button type="button" onclick="window.close()">Cerrar</button>
      </div>
      <main class="cash-receipt-sheet">
        <section class="receipt-top">
          <div class="receipt-brand">
            <span class="brand-stamp">
              <svg viewBox="0 0 64 64" role="img" aria-label="El Copetin">
                <circle cx="32" cy="32" r="28" fill="none" stroke="#f04b10" stroke-width="4" />
                <path d="M18 18h28L33 34v13" fill="none" stroke="#f04b10" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M24 47h18" fill="none" stroke="#f04b10" stroke-width="4" stroke-linecap="round" />
                <path d="M33 34l14-21" fill="none" stroke="#f04b10" stroke-width="4" stroke-linecap="round" />
              </svg>
            </span>
            <div>
              <div class="brand-name">El Copet&iacute;n</div>
              <p class="brand-subtitle">Alquiler de mobiliario, cristaler&iacute;a y equipos para eventos</p>
            </div>
          </div>
          <div class="receipt-title">
            <h1>${escapeHtml(title)}</h1>
            <span class="receipt-code">${escapeHtml(receiptCode)}</span>
            ${contractCode ? `<span class="receipt-contract-code"><small>N&deg; contrato</small>${escapeHtml(contractCode)}</span>` : ''}
          </div>
          <div class="receipt-datebox">
            ${contractCode ? `<span class="contract-chip"><small>Contrato</small>${escapeHtml(contractCode)}</span>` : ''}
            <span><strong>FECHA:</strong> ${escapeHtml(dateLabel)}</span>
            <span><strong>HORA:</strong> ${escapeHtml(timeLabel)}</span>
          </div>
        </section>

        <section class="receipt-contact">
          <span>${cashReceiptIcon('llamada-telefonica.png')} ${escapeHtml(company.phone)}</span>
          <span>${cashReceiptIcon('documento.png')} ${escapeHtml(company.email || 'Sin correo')}</span>
          <span>${cashReceiptIcon('ubicacion.png')} ${escapeHtml(company.address)}</span>
        </section>

        <section class="receipt-info">
          <div class="info-col">
            <p class="info-line"><strong>Tipo de movimiento</strong><b>:</b><span>${escapeHtml(movementLabel)}</span></p>
            <p class="info-line"><strong>${escapeHtml(cashBoxRoleLabel)}</strong><b>:</b><span>${escapeHtml(cashBoxLabel)}</span></p>
            <p class="info-line is-important"><strong>${escapeHtml(partyLabel)}</strong><b>:</b><span>${escapeHtml(partyName)}</span></p>
            <p class="info-line"><strong>Metodo de pago</strong><b>:</b><span>${escapeHtml(paymentMethodLabel)}</span></p>
          </div>
          <div class="info-col">
            <p class="info-line is-important"><strong>${escapeHtml(contextReferenceLabel)}</strong><b>:</b><span>${escapeHtml(contractCode || reference)}</span></p>
            <p class="info-line is-important"><strong>${escapeHtml(contextResponsibleLabel)}</strong><b>:</b><span>${escapeHtml(contextResponsibleValue)}</span></p>
            <p class="info-line"><strong>Concepto</strong><b>:</b><span>${detailHtml}</span></p>
            <p class="info-line"><strong>Observacion</strong><b>:</b><span>${escapeHtml(observation)}</span></p>
          </div>
        </section>

        <table>
          <thead>
            <tr>
              <th style="width: 10mm;">Nro</th>
              <th>Detalle</th>
              <th style="width: 26mm;">Caja</th>
              <th style="width: 34mm;">${escapeHtml(receiptUserHeader)}</th>
              <th style="width: 34mm;">${escapeHtml(contextResponsibleLabel)}</th>
              <th style="width: 32mm;">${escapeHtml(totalLabel)}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td class="detail">${detailHtml}</td>
              <td>${escapeHtml(cashBoxLabel)}</td>
              <td>${escapeHtml(collectionUser)}</td>
              <td>${escapeHtml(contextResponsibleValue)}</td>
              <td>${formatBs(amount)}</td>
            </tr>
          </tbody>
        </table>

        <section class="receipt-total-row">
          <p class="amount-words"><strong>Son:</strong><span>${escapeHtml(amountToBolivianosText(amount))}</span></p>
          <div class="total-box"><span>TOTAL ${isOut ? 'ENTREGADO' : 'RECIBIDO'}</span><b>${formatBs(amount)}</b></div>
        </section>

        <section class="receipt-signatures">
          <div class="signature-line"><strong>Entregue</strong><span>(Nombre y Firma)</span></div>
          <div class="signature-line"><strong>Recibi</strong><span>(Nombre y Firma)</span></div>
        </section>

        <p class="receipt-warning">Comprobante interno de ${isOut ? 'egreso' : 'ingreso'}. Conserve este recibo para control de caja.</p>
        <p class="receipt-footer">Documento generado por ${escapeHtml(company.name)}</p>
      </main>
    </body>
  </html>`;
};

const buildRentalReceiptHtml = (rental) => {
  const rows = (rental.items ?? [])
    .map(
      (line) => `
        <tr>
          <td>${escapeHtml(line.itemName)}</td>
          <td>${line.quantity}</td>
          <td>${formatBs(line.rentalPriceBs)}</td>
          <td>${formatBs(line.lineTotalBs ?? line.quantity * line.rentalPriceBs)}</td>
        </tr>`,
    )
    .join('');

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Recibo ${escapeHtml(rental.id)}</title>
      <style>
        body { font-family: "Segoe UI", sans-serif; margin: 24px; color: #1f2d33; }
        h1, h2, p { margin: 0; }
        .head { margin-bottom: 12px; }
        .box { border: 1px solid #d9e6e6; border-radius: 12px; padding: 12px; margin-bottom: 12px; }
        .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border-bottom: 1px solid #e4eeee; text-align: left; padding: 8px 6px; font-size: 13px; }
        th { font-size: 12px; text-transform: uppercase; color: #46606b; }
      </style>
    </head>
    <body>
      <div class="head">
        <h1>Recibo de Alquiler</h1>
        <p>El Copetin | ${escapeHtml(formatDateTime(rental.createdAt || rental.rentalAt))}</p>
      </div>
      <section class="box grid">
        <p><strong>Cliente:</strong> ${escapeHtml(rental.customerName)}</p>
        <p><strong>Celular:</strong> ${escapeHtml(rental.customerPhone)}</p>
        <p><strong>Orden:</strong> ${escapeHtml(String(rental.id).slice(0, 8).toUpperCase())}</p>
        <p><strong>Devolucion:</strong> ${escapeHtml(`${rental.dueDate} ${rental.dueTime}`)}</p>
      </section>
      <section class="box">
        <table>
          <thead>
            <tr><th>Item</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
      <section class="box">
        <p><strong>Total:</strong> ${formatBs(rental?.totals?.totalBs ?? 0)}</p>
        <p><strong>Garantia:</strong> ${formatBs(rental?.depositBs ?? 0)}</p>
      </section>
    </body>
  </html>`;
};

const buildReturnReceiptHtml = (rental) => {
  const ownerLabel = (owner) => {
    if (owner === 'transporte') return 'Transporte';
    if (owner === 'lavado') return 'Lavado';
    return 'Cliente';
  };
  const rows = (rental.returnReport ?? [])
    .map(
      (line) => `
      <tr>
        <td>${escapeHtml(line.itemName)}</td>
        <td>${line.expectedQty}</td>
        <td>${line.returnedQty}</td>
        <td>${line.damagedQty}</td>
        <td>${line.missingQty}</td>
        <td>${escapeHtml(ownerLabel(line.chargeOwner))}</td>
        <td>${escapeHtml(`${formatBs(line.damagedUnitChargeBs ?? 0)} / ${formatBs(line.missingUnitChargeBs ?? 0)}`)}</td>
        <td>${formatBs(line.penaltyBs ?? 0)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Recibo Devolucion ${escapeHtml(rental.id)}</title>
      <style>
        body { font-family: "Segoe UI", sans-serif; margin: 24px; color: #1f2d33; }
        h1, p { margin: 0; }
        .head { margin-bottom: 12px; }
        .box { border: 1px solid #d9e6e6; border-radius: 12px; padding: 12px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border-bottom: 1px solid #e4eeee; text-align: left; padding: 8px 6px; font-size: 13px; }
        th { font-size: 12px; text-transform: uppercase; color: #46606b; }
      </style>
    </head>
    <body>
      <div class="head">
        <h1>Recibo de Devolucion</h1>
        <p>El Copetin | ${escapeHtml(formatDateTime(rental.returnedAt))}</p>
      </div>
      <section class="box">
        <p><strong>Cliente:</strong> ${escapeHtml(rental.customerName)}</p>
        <p><strong>Orden:</strong> ${escapeHtml(String(rental.id).slice(0, 8).toUpperCase())}</p>
      </section>
      <section class="box">
        <table>
          <thead>
            <tr><th>Item</th><th>Esp.</th><th>Bueno</th><th>Dan.</th><th>Falt.</th><th>Origen</th><th>Precio d/f</th><th>Cargo</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
      <section class="box">
        <p><strong>Penalidades cliente:</strong> ${formatBs(rental.penaltiesBs ?? 0)}</p>
        <p><strong>Perdida interna:</strong> ${formatBs(rental.internalPenaltiesBs ?? 0)}</p>
        <p><strong>Reembolso:</strong> ${formatBs(rental.refundBs ?? 0)}</p>
      </section>
    </body>
  </html>`;
};

const resolveRentalForPrinting = (state, payload) => {
  const rentalId = String(payload?.rentalId ?? '').trim();
  const orderCode = String(payload?.orderCode ?? '').trim();
  const contractId = String(payload?.contractId ?? '').trim();
  const contractCode = String(payload?.contractCode ?? '').trim();
  const linkedRental = state.rentals.find(
    (entry) =>
      (rentalId && entry.id === rentalId)
      || (orderCode && entry.orderCode === orderCode),
  );
  if (linkedRental) return linkedRental;

  const linkedContract = state.contracts.find(
    (entry) =>
      !entry.deletedAt
      && (
        (contractId && entry.id === contractId)
        || (contractCode && entry.contractCode === contractCode)
        || (orderCode && entry.orderCode === orderCode)
      ),
  );
  return linkedContract ? buildRentalSnapshotFromContract(linkedContract) : null;
};

const resolveDeliveriesForRental = (state, rental) =>
  state.deliveries
    .filter(
      (entry) =>
        (entry.rentalId && entry.rentalId === rental.id)
        || (entry.orderCode && entry.orderCode === rental.orderCode),
    )
    .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));

const resolveContractForRental = (state, rental) =>
  state.contracts.find(
    (entry) =>
      !entry.deletedAt
      && (
        (rental.contractId && entry.id === rental.contractId)
        || (rental.contractCode && entry.contractCode === rental.contractCode)
        || (entry.rentalId && entry.rentalId === rental.id)
        || (entry.orderCode && entry.orderCode === rental.orderCode)
      ),
  ) ?? null;

const buildRentalSnapshotFromContract = (contract) => {
  const guaranteeDeclaredBs = Number(contract?.totals?.guaranteeBs ?? 0);
  const rawGuaranteeStatus = String(contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? '').trim();
  const isGuaranteeValidated = rawGuaranteeStatus === 'validado' || (!rawGuaranteeStatus && guaranteeDeclaredBs > 0);
  return ({
  id: contract?.rentalId ?? `contract-${contract?.id ?? 'sin-id'}`,
  orderCode: contract?.orderCode ?? contract?.contractCode ?? 'SIN-ORDEN',
  contractId: contract?.id ?? null,
  contractCode: contract?.contractCode ?? null,
  clientId: contract?.clientId ?? null,
  customerName: contract?.customerName ?? '',
  customerPhone: contract?.customerPhone ?? '',
  rentalDate: contract?.deliveryDate || contract?.eventDate || contract?.createdAt,
  dueDate: contract?.pickupDate || contract?.deliveryDate || contract?.eventDate || contract?.createdAt,
  contractDate: contract?.contractDate ?? contract?.createdAt,
  createdAt: contract?.createdAt,
  updatedAt: contract?.updatedAt ?? contract?.createdAt,
  eventType: contract?.eventType,
  eventDate: contract?.eventDate,
  eventAddress: contract?.address,
  deliveryWindowStart: contract?.deliveryWindowStart,
  deliveryWindowEnd: contract?.deliveryWindowEnd,
  pickupWindowStart: contract?.pickupWindowStart,
  pickupWindowEnd: contract?.pickupWindowEnd,
  billingMode: contract?.billingMode,
  logisticsMode: contract?.logisticsMode,
  pricingPlan: contract?.pricingPlan ?? null,
  observations: contract?.observations,
  depositBs: isGuaranteeValidated ? guaranteeDeclaredBs : 0,
  guaranteeDeclaredBs,
  totals: {
    ...(contract?.totals ?? {}),
    paidAtRentalBs: Number(contract?.payment?.paidAtApprovalBs ?? 0),
    pendingPaymentBs: Number(contract?.payment?.pendingBs ?? 0),
    overpaidBs: Number(contract?.payment?.overpaidBs ?? 0),
  },
  payment: {
    paidAtRentalBs: Number(contract?.payment?.paidAtApprovalBs ?? 0),
    pendingPaymentBs: Number(contract?.payment?.pendingBs ?? 0),
    overpaidBs: Number(contract?.payment?.overpaidBs ?? 0),
    initialPaymentMethod: normalizePaymentMethod(contract?.payment?.initialPaymentMethod),
    initialPaymentAccount: normalizeQrPaymentAccount(contract?.payment?.initialPaymentAccount ?? contract?.payment?.paymentAccount),
    guaranteeStatus: isGuaranteeValidated ? 'validado' : 'no_validado',
    guaranteePaymentMethod: normalizePaymentMethod(contract?.guarantee?.paymentMethod ?? contract?.payment?.guaranteePaymentMethod),
    guaranteePaymentAccount: normalizeQrPaymentAccount(contract?.guarantee?.paymentAccount ?? contract?.payment?.guaranteePaymentAccount),
  },
  guarantee: {
    amountBs: guaranteeDeclaredBs,
    validatedBs: isGuaranteeValidated ? guaranteeDeclaredBs : 0,
    status: isGuaranteeValidated ? 'validado' : 'no_validado',
    paymentMethod: normalizePaymentMethod(contract?.guarantee?.paymentMethod ?? contract?.payment?.guaranteePaymentMethod),
    paymentAccount: normalizeQrPaymentAccount(contract?.guarantee?.paymentAccount ?? contract?.payment?.guaranteePaymentAccount),
  },
  items: (contract?.items ?? []).map((line) => {
    const quantity = Number(line.quantity ?? 0);
    const hasStoredUnitPrice = line?.unitPriceBs !== undefined
      && line?.unitPriceBs !== null
      && line?.unitPriceBs !== '';
    const rentalPriceBs = hasStoredUnitPrice
      ? Math.max(0, Number(line.unitPriceBs ?? 0))
      : Math.max(0, Number(line.rentalPriceBs ?? 0));
    return {
      lineKey: line.lineKey ?? null,
      itemId: line.itemId,
      itemName: line.itemName,
      quantity: line.quantity,
      rentalPriceBs,
      lineTotalBs: Number(line.lineTotalBs ?? quantity * rentalPriceBs),
      lineType: String(line?.lineType ?? '').trim(),
      observation: String(line?.observation ?? line?.observations ?? line?.note ?? '').trim(),
      comboLineKey: line.comboLineKey ?? null,
      comboCategory: line.comboCategory ?? '',
      serviceDayId: line.serviceDayId ?? line.scheduleDayId ?? null,
      serviceDate: line.serviceDate ?? line.date ?? null,
      serviceDayLabel: line.serviceDayLabel ?? line.dayLabel ?? '',
    };
  }),
  services: normalizeContractServices(contract?.services),
  });
};

const formatDocumentDate = (value) => {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  return formatDate(value);
};

const formatDocumentLongDate = (value) => {
  const dateKey = toDateKey(value);
  if (!dateKey) return '-';
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return formatDocumentDate(value);
  const formatted = new Intl.DateTimeFormat('es-BO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  const cleanFormatted = formatted
    .replace(',', '')
    .replace(/\s+de\s+(\d{4})$/i, ' $1')
    .replace(/\s+/g, ' ')
    .trim();
  return cleanFormatted.charAt(0).toUpperCase() + cleanFormatted.slice(1);
};

const formatDocumentScheduleDate = (value) => {
  const dateKey = toDateKey(value);
  if (!dateKey) return '-';
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return formatDocumentDate(value);
  const formatted = new Intl.DateTimeFormat('es-BO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  const cleanFormatted = formatted
    .replace(',', '')
    .replace(/\s+de\s+(\d{4})$/i, ' del $1')
    .replace(/\s+/g, ' ')
    .trim();
  return cleanFormatted.charAt(0).toUpperCase() + cleanFormatted.slice(1);
};

const getDocumentCompany = (settings = {}) => ({
  name: String(settings.companyName ?? 'Copetin SRL').trim() || 'Copetin SRL',
  taxId: String(settings.taxId ?? '').trim() || '-',
  address: String(settings.address ?? '').trim() || '-',
  phone: String(settings.phone ?? '').trim() || '-',
  email: String(settings.email ?? '').trim() || '-',
  website: String(settings.website ?? '').trim() || '',
  fiscalCondition: String(settings.fiscalCondition ?? '').trim() || '',
});

const getProfessionalDocumentStyles = () => `
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  html { background: #edf1f7; }
  body {
    margin: 0;
    padding: 24px;
    color: #18262d;
    font-family: "Segoe UI", Arial, sans-serif;
    font-size: 12px;
    line-height: 1.45;
  }
  h1, h2, h3, p { margin: 0; }
  .document-sheet {
    display: flex;
    flex-direction: column;
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 16mm 17mm;
    background: #ffffff;
    border: 1px solid #dfe6f0;
    box-shadow: 0 18px 50px rgba(20, 32, 64, 0.16);
  }
  .doc-topbar {
    display: grid;
    grid-template-columns: 1fr 58mm;
    gap: 14px;
    align-items: stretch;
    padding-bottom: 14px;
    border-bottom: 2px solid #172554;
  }
  .brand-block { display: flex; gap: 11px; align-items: center; }
  .brand-mark {
    width: 42px;
    height: 42px;
    border: 2px solid #172554;
    display: grid;
    place-items: center;
    color: #172554;
    font-size: 22px;
    font-weight: 900;
    letter-spacing: 0;
  }
  .brand-name {
    color: #101a3d;
    font-size: 21px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .brand-meta {
    margin-top: 2px;
    color: #53627a;
    font-size: 11px;
    text-transform: uppercase;
  }
  .doc-id-card {
    border: 1px solid #172554;
    display: grid;
    align-content: center;
    gap: 3px;
    padding: 9px 11px;
    text-align: right;
  }
  .doc-id-card span {
    color: #53627a;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .doc-id-card strong {
    color: #101a3d;
    font-size: 19px;
    line-height: 1;
  }
  .doc-id-card small { color: #6a7488; font-size: 10px; }
  .company-line {
    display: grid;
    grid-template-columns: 1.35fr 1fr 1fr;
    gap: 8px;
    margin-top: 10px;
    padding: 8px 0 12px;
    border-bottom: 1px solid #d9e1ec;
    color: #334155;
    font-size: 11px;
  }
  .company-line strong {
    display: block;
    color: #64748b;
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .doc-title {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    align-items: end;
    margin: 18px 0 13px;
  }
  .doc-title h1 {
    color: #0f172a;
    font-size: 24px;
    line-height: 1.12;
    letter-spacing: 0;
  }
  .doc-title p { margin-top: 4px; color: #526173; font-size: 12px; }
  .status-stamp {
    min-width: 34mm;
    border: 1px solid #94a3b8;
    padding: 6px 10px;
    text-align: center;
    color: #0f766e;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .section {
    margin-top: 10px;
    border: 1px solid #d8e0eb;
    page-break-inside: avoid;
  }
  .section-title {
    padding: 7px 10px;
    border-bottom: 1px solid #d8e0eb;
    background: #f8fafc;
    color: #172554;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
  }
  .info-item {
    min-height: 38px;
    padding: 8px 10px;
    border-right: 1px solid #e5ebf3;
    border-bottom: 1px solid #e5ebf3;
  }
  .info-item:nth-child(2n) { border-right: 0; }
  .info-item strong {
    display: block;
    color: #64748b;
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .info-item span {
    display: block;
    margin-top: 2px;
    color: #16242d;
    font-weight: 700;
  }
  .doc-table {
    width: 100%;
    border-collapse: collapse;
  }
  .doc-table th,
  .doc-table td {
    padding: 7px 8px;
    border-bottom: 1px solid #e2e8f0;
    text-align: left;
    vertical-align: top;
  }
  .doc-table th {
    background: #f8fafc;
    color: #475569;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .doc-table td.number,
  .doc-table th.number { text-align: right; white-space: nowrap; }
  .totals-grid {
    display: grid;
    grid-template-columns: 1fr 72mm;
    gap: 12px;
    padding: 10px;
  }
  .note-box {
    min-height: 54px;
    border: 1px solid #e2e8f0;
    padding: 8px;
    color: #475569;
  }
  .money-lines { border: 1px solid #d8e0eb; }
  .money-line {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 9px;
    border-bottom: 1px solid #e5ebf3;
  }
  .money-line:last-child { border-bottom: 0; }
  .money-line.total {
    background: #172554;
    color: #ffffff;
    font-size: 13px;
    font-weight: 900;
  }
  .terms-list {
    margin: 0;
    padding: 9px 12px 9px 28px;
    color: #334155;
  }
  .terms-list li { margin: 4px 0; }
  .check-cell {
    height: 20px;
    border: 1px solid #94a3b8;
  }
  .route-summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-bottom: 1px solid #d8e0eb;
  }
  .route-summary div {
    padding: 8px 10px;
    border-right: 1px solid #e5ebf3;
  }
  .route-summary div:last-child { border-right: 0; }
  .route-summary strong {
    display: block;
    color: #64748b;
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .signature-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-top: auto;
    padding-top: 22px;
  }
  .signature-box {
    padding-top: 34px;
    border-top: 1px solid #334155;
    text-align: center;
    color: #475569;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
  }
  .doc-footer {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: 18px;
    padding-top: 8px;
    border-top: 1px solid #d8e0eb;
    color: #64748b;
    font-size: 10px;
  }
  @media print {
    html, body { background: #ffffff; }
    body {
      padding: 0;
      font-size: 10.2px;
      line-height: 1.26;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .document-sheet {
      width: auto;
      min-height: calc(297mm - 16mm);
      margin: 0;
      padding: 0;
      border: 0;
      box-shadow: none;
    }
    .doc-topbar {
      grid-template-columns: 1fr 50mm;
      gap: 9px;
      padding-bottom: 8px;
    }
    .brand-mark {
      width: 32px;
      height: 32px;
      font-size: 17px;
    }
    .brand-name { font-size: 17px; }
    .brand-meta { font-size: 8.5px; }
    .doc-id-card {
      padding: 6px 8px;
      gap: 2px;
    }
    .doc-id-card span,
    .doc-id-card small { font-size: 8px; }
    .doc-id-card strong { font-size: 16px; }
    .company-line {
      margin-top: 6px;
      padding: 5px 0 7px;
      font-size: 8.8px;
    }
    .company-line strong,
    .info-item strong,
    .doc-table th { font-size: 7.8px; }
    .doc-title {
      margin: 10px 0 7px;
      gap: 8px;
    }
    .doc-title h1 { font-size: 19px; }
    .doc-title p { font-size: 9.2px; }
    .status-stamp {
      min-width: 28mm;
      padding: 4px 7px;
      font-size: 9px;
    }
    .section {
      margin-top: 6px;
      page-break-inside: auto;
      break-inside: auto;
    }
    .section-title { padding: 4px 7px; }
    .info-item {
      min-height: 27px;
      padding: 4px 7px;
    }
    .doc-table th,
    .doc-table td { padding: 4px 6px; }
    .totals-grid {
      grid-template-columns: 1fr 58mm;
      gap: 7px;
      padding: 6px;
    }
    .note-box {
      min-height: 38px;
      padding: 6px;
    }
    .money-line {
      padding: 4px 7px;
      gap: 6px;
    }
    .money-line.total { font-size: 11px; }
    .terms-list {
      padding: 5px 9px 5px 22px;
    }
    .terms-list li { margin: 1px 0; }
    .signature-grid {
      gap: 9px;
      margin-top: auto;
      padding-top: 16mm;
    }
    .signature-box {
      padding-top: 23px;
      font-size: 8.5px;
    }
    .doc-footer {
      margin-top: 10px;
      padding-top: 5px;
      font-size: 8px;
    }
  }
`;

const buildDocumentShell = ({
  title,
  subtitle,
  documentLabel,
  documentCode,
  status,
  company,
  children,
}) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(`${documentLabel} ${documentCode}`)}</title>
    <style>${getProfessionalDocumentStyles()}</style>
  </head>
  <body>
    <main class="document-sheet">
      <header class="doc-topbar">
        <div class="brand-block">
          <div class="brand-mark">${escapeHtml(company.name.slice(0, 1).toUpperCase() || 'C')}</div>
          <div>
            <p class="brand-name">${escapeHtml(company.name)}</p>
            <p class="brand-meta">${escapeHtml(company.fiscalCondition || 'Administracion de alquileres')}</p>
          </div>
        </div>
        <div class="doc-id-card">
          <span>${escapeHtml(documentLabel)}</span>
          <strong>${escapeHtml(documentCode)}</strong>
          <small>Emitido: ${escapeHtml(formatDocumentDate(new Date().toISOString()))}</small>
        </div>
      </header>

      <section class="company-line">
        <div><strong>Domicilio fiscal</strong>${escapeHtml(company.address)}</div>
        <div><strong>NIT / CI</strong>${escapeHtml(company.taxId)}</div>
        <div><strong>Contacto</strong>${escapeHtml([company.phone, company.email].filter(Boolean).join(' | '))}</div>
      </section>

      <section class="doc-title">
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        ${status ? `<div class="status-stamp">${escapeHtml(status)}</div>` : ''}
      </section>

      ${children}

      <footer class="doc-footer">
        <span>Documento generado por ${escapeHtml(company.name)}${company.website ? ` | ${escapeHtml(company.website)}` : ''}</span>
        <span>Pagina 1 de 1</span>
      </footer>
    </main>
  </body>
</html>`;

const CONTRACT_LEGACY_DOCUMENT_STYLES = `
  ${getProfessionalDocumentStyles()}
  @page { size: 216mm 330mm; margin: 6mm; }
  body {
    background: #f3f4f7;
    color: #10131f;
    font-family: "Segoe UI", Arial, sans-serif;
    font-size: 11px;
    line-height: 1.34;
  }
  .contract-sheet {
    width: 216mm;
    min-height: 330mm;
    margin: 0 auto;
    padding: 8mm 8mm 6mm;
    background: #fff;
    border: 1px solid #eadfd9;
    border-radius: 3px;
    box-shadow: 0 18px 50px rgba(16, 19, 31, 0.14);
  }
  .contract-hero {
    display: grid;
    grid-template-columns: 1.15fr 1fr 39mm;
    gap: 8mm;
    align-items: center;
  }
  .contract-brand {
    display: grid;
    grid-template-columns: 20mm minmax(0, 1fr);
    gap: 5mm;
    align-items: center;
  }
  .contract-brand-mark {
    width: 18mm;
    height: 18mm;
    border: 1.2mm solid #e84a00;
    border-radius: 999px;
    display: grid;
    place-items: center;
    color: #e84a00;
  }
  .contract-brand-mark svg {
    width: 11mm;
    height: 11mm;
  }
  .contract-brand h1 {
    color: #090b12;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 26px;
    font-style: italic;
    line-height: 0.95;
  }
  .contract-brand p {
    margin-top: 5px;
    color: #f04b0b;
    font-size: 10px;
    font-weight: 800;
    line-height: 1.35;
    text-transform: uppercase;
  }
  .contract-title {
    text-align: center;
  }
  .contract-title h2 {
    color: #111522;
    font-size: 22px;
    font-weight: 950;
    letter-spacing: 0;
  }
  .contract-title p {
    margin-top: 5px;
    color: #111522;
    font-size: 15px;
    font-weight: 500;
    text-transform: uppercase;
  }
  .contract-title::after {
    content: "";
    display: block;
    width: 22mm;
    height: 2px;
    margin: 5px auto 0;
    border-radius: 999px;
    background: #f04b0b;
  }
  .contract-code-card {
    border: 1px solid #ffb98f;
    border-radius: 7px;
    padding: 7px 9px;
    text-align: center;
    box-shadow: 0 8px 22px rgba(232, 74, 0, 0.1);
  }
  .contract-code-label {
    display: block;
    color: #df4305;
    font-size: 22px;
    font-weight: 950;
    line-height: 1;
  }
  .contract-code-date {
    display: block;
    margin-top: 5px;
    color: #4d4f59;
    font-size: 10.5px;
    font-weight: 800;
  }
  .contract-status {
    margin-top: 7px;
    border-radius: 999px;
    padding: 6px 9px;
    background: linear-gradient(135deg, #ef4d04, #ff7b20);
    color: #fff;
    font-size: 11px;
    font-weight: 950;
    text-align: center;
    text-transform: uppercase;
  }
  .contract-company-strip {
    display: grid;
    grid-template-columns: 1.22fr 1.5fr 1.15fr 0.95fr;
    gap: 0;
    margin-top: 10mm;
    border: 1px solid #e3dedb;
    border-radius: 8px;
    overflow: hidden;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .contract-company-item {
    min-height: 20mm;
    display: grid;
    grid-template-columns: 8mm minmax(0, 1fr);
    gap: 6px;
    align-items: center;
    padding: 7px 8px;
    border-right: 1px solid #ebe6e2;
  }
  .contract-company-item:last-child { border-right: 0; }
  .contract-icon {
    display: grid;
    place-items: center;
    color: #f04b0b;
  }
  .contract-pdf-icon {
    width: 19px;
    height: 19px;
    object-fit: contain;
    display: block;
  }
  .contract-company-item .contract-pdf-icon,
  .contract-schedule-main .contract-pdf-icon,
  .contract-important .contract-pdf-icon {
    width: 24px;
    height: 24px;
  }
  .contract-status-icon {
    width: 13px;
    height: 13px;
    object-fit: contain;
    vertical-align: -2px;
    margin-right: 5px;
    filter: brightness(0) invert(1);
  }
  .contract-company-item strong,
  .contract-field strong,
  .contract-schedule-label,
  .contract-terms h4 {
    display: block;
    color: #151923;
    font-size: 9.5px;
    font-weight: 950;
    text-transform: uppercase;
  }
  .contract-company-item span,
  .contract-field span {
    display: block;
    margin-top: 3px;
    color: #10131f;
    font-size: 10.5px;
  }
  .contract-section-title {
    margin: 5.5mm 0 2.5mm;
    color: #111522;
    font-size: 13px;
    font-weight: 950;
    text-transform: uppercase;
  }
  .contract-section-title .number {
    margin-right: 5px;
  }
  .contract-panel {
    border: 1px solid #e1dcd8;
    border-radius: 8px;
    overflow: hidden;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .contract-data-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .contract-data-col {
    display: contents;
  }
  .contract-data-col + .contract-data-col {
    border-left: 0;
  }
  .contract-field {
    display: grid;
    grid-template-columns: 7mm minmax(0, 1fr);
    gap: 6px;
    align-items: center;
    min-height: 11.5mm;
    padding: 6px 8px;
    border-bottom: 1px solid #ebe6e2;
    border-right: 1px solid #ebe6e2;
  }
  .contract-data-grid > .contract-field:nth-child(4n) { border-right: 0; }
  .contract-data-grid > .contract-field:nth-last-child(-n + 4) { border-bottom: 0; }
  .contract-data-grid > .contract-field:last-child { border-right: 0; }
  .contract-field-icon {
    display: grid;
    place-items: center;
    color: #f04b0b;
  }
  .contract-schedule {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    min-height: 24mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .contract-schedule-main {
    display: grid;
    grid-template-columns: 10mm minmax(0, 1fr);
    gap: 9px;
    align-items: center;
    padding: 8px 10px;
    border-right: 1px solid #e5e0dc;
  }
  .contract-schedule-main:last-child { border-right: 0; }
  .contract-schedule-value {
    display: block;
    margin-top: 4px;
    color: #10131f;
    font-size: 12px;
    line-height: 1.45;
  }
  .contract-items-layout {
    display: block;
    break-inside: auto;
    page-break-inside: auto;
  }
  .contract-items-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    overflow: hidden;
    border: 1px solid #e1dcd8;
    border-radius: 8px;
  }
  .contract-items-table thead {
    display: table-header-group;
  }
  .contract-items-table tfoot {
    display: table-row-group;
  }
  .contract-items-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .contract-items-table th {
    background: linear-gradient(135deg, #ef4d04, #ff6a00);
    color: #fff;
    padding: 6px 8px;
    font-size: 10px;
    font-weight: 950;
    text-align: left;
    text-transform: uppercase;
  }
  .contract-items-table th.number,
  .contract-items-table td.number { text-align: right; white-space: nowrap; }
  .contract-items-table td {
    padding: 6px 8px;
    border-bottom: 1px solid #eee8e2;
    border-right: 1px solid #eee8e2;
    vertical-align: middle;
  }
  .contract-items-table td:last-child { border-right: 0; }
  .contract-items-table tr:last-child td { border-bottom: 0; }
  .contract-item-desc {
    display: grid;
    grid-template-columns: 13mm minmax(0, 1fr);
    gap: 7px;
    align-items: center;
  }
  .contract-item-thumb {
    width: 12mm;
    height: 12mm;
    border: 1px solid #eadfd8;
    border-radius: 3px;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: #fff8f4;
    color: #b26c4a;
    font-size: 7px;
    font-weight: 900;
  }
  .contract-item-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .contract-item-desc strong {
    display: block;
    color: #111522;
    font-size: 11px;
  }
  .contract-item-desc small {
    display: block;
    margin-top: 2px;
    color: #697083;
    font-size: 8.5px;
  }
  .contract-observation-row td {
    color: #111522;
    background: #fffdfb;
  }
  .contract-observation-row strong {
    color: #f04b0b;
    margin-right: 7px;
  }
  .contract-summary-title-row td {
    padding-top: 9px;
    background: #fff7f1;
    color: #e84a00;
    font-size: 12px;
    font-weight: 950;
    text-transform: uppercase;
  }
  .contract-summary-row td {
    background: #fffdfb;
    padding-top: 5px;
    padding-bottom: 5px;
  }
  .contract-summary-label {
    color: #4b4f5c;
    font-weight: 800;
    text-align: right;
  }
  .contract-summary-value {
    color: #10131f;
    font-weight: 950;
    text-align: right;
    white-space: nowrap;
  }
  .contract-summary-total td {
    background: #ffe2cf;
    color: #e84a00;
    font-weight: 950;
  }
  .contract-summary-total .contract-summary-label,
  .contract-summary-total .contract-summary-value {
    color: #e84a00;
    font-size: 12.5px;
  }
  .contract-summary-managed td {
    background: #fff7ed;
    border-top: 1px solid #ffb98f;
    border-bottom: 1px solid #ffb98f;
  }
  .contract-summary-managed .contract-summary-label,
  .contract-summary-managed .contract-summary-value {
    color: #bf3d00;
    font-size: 12.5px;
    font-weight: 950;
  }
  .contract-terms-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 53mm;
    gap: 8mm;
    padding: 8px 10px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .contract-terms-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 4px;
  }
  .contract-terms-list li {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    gap: 7px;
    color: #222631;
  }
  .contract-terms-list b {
    width: 16px;
    height: 16px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: #f04b0b;
    color: #fff;
    font-size: 9px;
  }
  .contract-important {
    border: 1px solid #e7ded8;
    border-radius: 8px;
    padding: 10px;
    display: grid;
    grid-template-columns: 10mm 1fr;
    gap: 9px;
    align-items: center;
  }
  .contract-important strong {
    color: #e84a00;
    text-transform: uppercase;
  }
  .contract-closing {
    margin-top: 5mm;
    padding-top: 4mm;
    border-top: 1px solid #f04b0b;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .contract-signatures {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10mm;
    margin-top: 0;
    text-align: center;
  }
  .contract-signature-label {
    color: #111522;
    font-size: 10px;
    font-weight: 950;
    text-transform: uppercase;
  }
  .contract-signature-script {
    min-height: 10mm;
    display: grid;
    place-items: end center;
    color: #252525;
    font-family: "Segoe Script", "Brush Script MT", cursive;
    font-size: 22px;
  }
  .contract-signature-line {
    height: 1px;
    background: #f04b0b;
  }
  .contract-signature-name {
    margin-top: 5px;
    color: #111522;
    font-size: 10px;
  }
  .contract-footer {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 10px;
    margin-top: 4mm;
    padding-top: 2mm;
    border-top: 1px solid #f04b0b;
    color: #111522;
    font-size: 10px;
  }
  .contract-footer span:nth-child(2) {
    color: #f04b0b;
    font-weight: 800;
  }
  .contract-footer span:last-child { text-align: right; }
  .contract-sheet.is-compact .contract-company-strip {
    margin-top: 7mm;
  }
  .contract-sheet.is-compact .contract-section-title {
    margin: 4mm 0 2mm;
  }
  .contract-sheet.is-compact .contract-field {
    min-height: 10mm;
    padding-top: 5px;
    padding-bottom: 5px;
  }
  .contract-sheet.is-compact .contract-schedule {
    min-height: 21mm;
  }
  .contract-sheet.is-compact .contract-schedule-main {
    padding-top: 6px;
    padding-bottom: 6px;
  }
  .contract-sheet.is-compact .contract-items-table th,
  .contract-sheet.is-compact .contract-items-table td {
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .contract-sheet.is-compact .contract-item-thumb {
    width: 10mm;
    height: 10mm;
  }
  .contract-sheet.is-compact .contract-item-desc {
    grid-template-columns: 11mm minmax(0, 1fr);
  }
  .contract-sheet.is-compact .contract-summary-title-row td {
    padding-top: 6px;
  }
  .contract-sheet.is-compact .contract-summary-row td {
    padding-top: 3px;
    padding-bottom: 3px;
  }
  .contract-sheet.is-compact .contract-terms-panel {
    padding-top: 6px;
    padding-bottom: 6px;
  }
  .contract-sheet.is-compact .contract-terms-list {
    gap: 2px;
  }
  .contract-sheet.is-compact .contract-important {
    padding: 7px;
  }
  .contract-sheet.is-compact .contract-closing {
    margin-top: 3mm;
    padding-top: 3mm;
  }
  .contract-sheet.is-compact .contract-signature-script {
    min-height: 7mm;
  }
  .contract-sheet.is-dense {
    font-size: 10px;
    line-height: 1.2;
  }
  .contract-sheet.is-dense .contract-company-strip {
    margin-top: 5mm;
  }
  .contract-sheet.is-dense .contract-section-title {
    margin: 3mm 0 1.5mm;
    font-size: 11px;
  }
  .contract-sheet.is-dense .contract-company-item {
    min-height: 16mm;
    padding-top: 5px;
    padding-bottom: 5px;
  }
  .contract-sheet.is-dense .contract-field {
    min-height: 8.5mm;
  }
  .contract-sheet.is-dense .contract-schedule {
    min-height: 18mm;
  }
  .contract-sheet.is-dense .contract-schedule-value {
    margin-top: 2px;
    font-size: 10px;
    line-height: 1.25;
  }
  .contract-sheet.is-dense .contract-items-table th,
  .contract-sheet.is-dense .contract-items-table td {
    padding-top: 3px;
    padding-bottom: 3px;
  }
  .contract-sheet.is-dense .contract-item-desc strong {
    font-size: 9.5px;
  }
  .contract-sheet.is-dense .contract-item-desc small {
    font-size: 7.5px;
  }
  .contract-sheet.is-dense .contract-signature-script {
    min-height: 5mm;
  }
  .contract-sheet.is-dense .contract-footer {
    margin-top: 2mm;
    padding-top: 1.5mm;
  }
  @media screen {
    .contract-items-layout {
      display: block;
    }
    .contract-items-table th {
      font-size: 11px;
    }
    .contract-items-table td {
      font-size: 11.5px;
      line-height: 1.36;
    }
    .contract-item-desc strong {
      font-size: 12.5px;
      line-height: 1.24;
    }
    .contract-item-desc small {
      font-size: 10px;
      line-height: 1.3;
    }
  }
  @media print {
    html, body {
      background: #ffffff;
    }
    body {
      padding: 0;
      font-size: 9.8px;
      line-height: 1.24;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .contract-sheet {
      width: auto;
      min-height: 0;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      box-shadow: none;
    }
    .contract-hero,
    .contract-company-strip,
    .contract-panel,
    .contract-schedule,
    .contract-terms-panel,
    .contract-closing {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .contract-brand h1 { font-size: 24px; }
    .contract-company-strip { margin-top: 7mm; }
    .contract-section-title {
      margin-top: 4mm;
      break-after: avoid;
      page-break-after: avoid;
    }
    .contract-field { min-height: 10mm; }
    .contract-schedule { min-height: 22mm; }
    .contract-items-table {
      border-collapse: collapse;
      border-radius: 0;
    }
    .contract-items-table th,
    .contract-items-table td {
      padding: 5px 7px;
    }
    .contract-signature-script { min-height: 7mm; font-size: 16px; }
    .contract-footer { margin-top: 2mm; padding-top: 1.5mm; }
    .contract-sheet.is-compact .contract-company-strip { margin-top: 6mm; }
    .contract-sheet.is-compact .contract-section-title { margin: 3mm 0 1.5mm; }
    .contract-sheet.is-compact .contract-field { min-height: 9mm; }
    .contract-sheet.is-compact .contract-schedule { min-height: 19mm; }
    .contract-sheet.is-compact .contract-items-table th,
    .contract-sheet.is-compact .contract-items-table td {
      padding-top: 3px;
      padding-bottom: 3px;
    }
    .contract-sheet.is-compact .contract-summary-row td {
      padding-top: 2px;
      padding-bottom: 2px;
    }
    .contract-sheet.is-compact .contract-closing {
      margin-top: 2mm;
      padding-top: 2mm;
    }
    .contract-sheet.is-compact .contract-signature-script { min-height: 5mm; }
    .contract-sheet.is-dense {
      font-size: 9px;
      line-height: 1.15;
    }
    .contract-sheet.is-dense .contract-company-strip { margin-top: 4mm; }
    .contract-sheet.is-dense .contract-section-title { margin: 2mm 0 1mm; font-size: 10px; }
    .contract-sheet.is-dense .contract-company-item { min-height: 14mm; }
    .contract-sheet.is-dense .contract-field { min-height: 7.5mm; }
    .contract-sheet.is-dense .contract-schedule { min-height: 16mm; }
    .contract-sheet.is-dense .contract-item-thumb { width: 8mm; height: 8mm; }
    .contract-sheet.is-dense .contract-item-desc { grid-template-columns: 9mm minmax(0, 1fr); }
    .contract-sheet.is-dense .contract-items-table th,
    .contract-sheet.is-dense .contract-items-table td {
      padding-top: 2px;
      padding-bottom: 2px;
    }
    .contract-sheet.is-dense .contract-terms-panel { padding-top: 4px; padding-bottom: 4px; }
    .contract-sheet.is-dense .contract-terms-list { gap: 1px; }
    .contract-sheet.is-dense .contract-signature-script { min-height: 3mm; }
  }
`;

const CONTRACT_AREA_ORDER = [
  { key: 'vajilla', label: 'VAJILLA', className: 'blue' },
  { key: 'manteleria', label: 'MANTELERIA', className: 'violet' },
  { key: 'mobiliario', label: 'MOBILIARIO', className: 'green' },
];

const getContractAreaMeta = (category) => {
  const assignedArea = normalizeInventoryArea(category);
  if (assignedArea === 'vajilla') return CONTRACT_AREA_ORDER[0];
  if (assignedArea === 'manteleria') return CONTRACT_AREA_ORDER[1];
  if (assignedArea === 'mobiliario') return CONTRACT_AREA_ORDER[2];

  const normalized = normalizeText(category);
  if (normalized.includes('cristal') || normalized.includes('vajilla') || normalized.includes('copa') || normalized.includes('vaso') || normalized.includes('plato') || normalized.includes('cubierto')) {
    return CONTRACT_AREA_ORDER[0];
  }
  if (normalized.includes('mantel') || normalized.includes('servilleta') || normalized.includes('camino') || normalized.includes('faldin') || normalized.includes('tela')) {
    return CONTRACT_AREA_ORDER[1];
  }
  return CONTRACT_AREA_ORDER[2];
};

const getContractLineCategory = (line, item) =>
  String(
    item?.category
    ?? line?.category
    ?? line?.comboCategory
    ?? line?.quickItem?.category
    ?? 'Sin categoria',
  ).trim() || 'Sin categoria';

const getContractAreaSource = (line, item) => ({
  ...(line ?? {}),
  ...(item ?? {}),
  inventoryArea: item?.inventoryArea ?? line?.inventoryArea ?? line?.quickItem?.inventoryArea ?? '',
  category: item?.category ?? line?.category ?? line?.comboCategory ?? line?.quickItem?.category ?? '',
  name: item?.name ?? line?.itemName ?? line?.quickItem?.name ?? '',
  itemName: line?.itemName ?? item?.name ?? line?.quickItem?.name ?? '',
  description: item?.description ?? line?.description ?? line?.quickItem?.description ?? '',
});

const getContractItemMeta = (line, _item) => [
  line?.lineType === 'courtesy' ? 'Cortesia' : '',
  line?.comboName ? `Combo: ${line.comboName}` : '',
  line?.comboComponentName && normalizeText(line.comboComponentName) !== normalizeText(line.itemName)
    ? `Pieza: ${line.comboComponentName}`
    : '',
].filter(Boolean).join(' | ');

const makeSupplierShortCode = (name) => {
  const cleaned = normalizeText(name).replace(/[^a-z0-9 ]/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0].slice(0, 3)} ${words[1].slice(0, 4)}`.toUpperCase();
  return (words[0] || 'PROV').slice(0, 7).toUpperCase();
};

const buildSupplierSupportByItem = (supplierFulfillmentPlan) => {
  const map = new Map();
  normalizeSupplierFulfillmentPlan(supplierFulfillmentPlan).forEach((line) => {
    const itemId = String(line?.itemId ?? '').trim();
    const lineKey = String(line?.lineKey ?? '').trim();
    const key = lineKey || itemId;
    if (!key) return;
    const current = map.get(key) ?? [];
    current.push({
      ...line,
      shortCode: makeSupplierShortCode(line.supplierName),
    });
    map.set(key, current);
  });
  return map;
};

const pickFirstSupplierFulfillmentPlan = (...plans) => {
  for (const plan of plans) {
    const normalized = normalizeSupplierFulfillmentPlan(plan);
    if (normalized.length > 0) return normalized;
  }
  return [];
};

const formatSupplierSupportLabel = (lines) => (Array.isArray(lines) ? lines : [])
  .filter((line) => Number(line?.neededQty ?? 0) > 0)
  .map((line) => `${Math.max(0, Math.trunc(Number(line.neededQty ?? 0)))} SUB ${line.shortCode || makeSupplierShortCode(line.supplierName)}`)
  .join(' · ');

const hasStoredQuantity = (value) =>
  value !== null && typeof value !== 'undefined' && String(value).trim() !== '' && Number.isFinite(Number(value));

const buildFulfillmentBreakdown = (line, supplierLines = []) => {
  const normalizedSupplierLines = (Array.isArray(supplierLines) ? supplierLines : [])
    .filter((entry) => Number(entry?.neededQty ?? 0) > 0)
    .map((entry) => ({
      ...entry,
      neededQty: Math.max(0, Math.trunc(Number(entry?.neededQty ?? 0))),
      shortCode: entry?.shortCode || makeSupplierShortCode(entry?.supplierName),
  }));
  const supplierQty = normalizedSupplierLines.reduce((sum, entry) => sum + entry.neededQty, 0);
  const hasManualSupplierCoverage = normalizedSupplierLines.some((entry) => entry.manualCoverage);
  const requestedQty = Math.max(0, Math.trunc(Number(line?.quantity ?? 0)));
  const storedInternalQty = hasStoredQuantity(line?.internalReservedQty)
    ? Math.max(0, Math.trunc(Number(line.internalReservedQty)))
    : null;
  const storedSupplierQty = hasStoredQuantity(line?.supplierBackedQty)
    ? Math.max(0, Math.trunc(Number(line.supplierBackedQty)))
    : null;
  const effectiveSupplierQty = Math.max(supplierQty, storedSupplierQty ?? 0);
  const ownQty = storedInternalQty !== null
    ? storedInternalQty
    : hasManualSupplierCoverage
      ? requestedQty
      : effectiveSupplierQty > requestedQty
        ? requestedQty
        : Math.max(0, requestedQty - effectiveSupplierQty);
  const totalQty = hasManualSupplierCoverage
    ? ownQty + effectiveSupplierQty
    : effectiveSupplierQty > requestedQty
      ? requestedQty + effectiveSupplierQty
      : requestedQty;

  if (effectiveSupplierQty <= 0) {
    return { ownQty: requestedQty, supplierQty: 0, totalQty: requestedQty, label: '' };
  }

  const parts = [];
  if (ownQty > 0) parts.push(`${ownQty} COPETIN`);
  normalizedSupplierLines.forEach((entry) => {
    parts.push(`${entry.neededQty} SUB ${entry.shortCode}`);
  });
  const label = parts.length > 1
    ? `${parts.join(' + ')} = TOTAL ${totalQty}`
    : parts.join('');

  return { ownQty, supplierQty: effectiveSupplierQty, totalQty, label };
};

const getReferenceContractStyles = () => `
  @page { size: 216mm 330mm; margin: 3mm 4mm 9mm; }
  * { box-sizing: border-box; }
  html { background: #d9d9d9; }
  body {
    margin: 0;
    padding: 10px 0;
    color: #161616;
    background: #d9d9d9;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10.5px;
    line-height: 1.28;
  }
  h1, h2, h3, p { margin: 0; }
  .rc-sheet {
    position: relative;
    width: 8.5in;
    min-height: 14in;
    margin: 0 auto;
    padding: .18in .42in .34in;
    display: flex;
    flex-direction: column;
    background: radial-gradient(circle at 50% 0, rgba(166, 106, 32, .08), transparent 58mm), #fffdfa;
    box-shadow: 0 12px 36px rgba(0, 0, 0, .18);
  }
  .rc-top {
    display: grid;
    grid-template-columns: minmax(0, 70mm) minmax(0, 1fr);
    gap: 5mm;
    align-items: center;
    min-height: 22mm;
  }
  .rc-logo { min-width: 0; overflow: hidden; }
  .rc-logo img { display: block; width: 67mm; max-width: 100%; height: auto; }
  .rc-code {
    display: grid;
    grid-template-columns: 24mm repeat(3, minmax(0, 1fr));
    align-items: stretch;
    gap: 0;
    min-height: 20mm;
    padding: 0 0 1.6mm;
    border-bottom: .25mm solid #d8d0c4;
    background: transparent;
  }
  .rc-number {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: .45mm;
    width: 100%;
    min-width: 0;
    padding: .7mm 1.8mm .7mm 0;
    border-right: .25mm solid #d8d0c4;
    font-family: Arial, Helvetica, sans-serif;
  }
  .rc-number strong { color: #8f5b1c; font-size: 25px; font-weight: 700; line-height: .95; letter-spacing: 0; }
  .rc-code-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: .45mm;
    width: 100%;
    min-width: 0;
    padding: .9mm 1.8mm;
    border-left: .25mm solid #d8d0c4;
    color: #2d2a26;
    font: 800 10.8px Arial, Helvetica, sans-serif;
    line-height: 1.18;
    text-align: center;
  }
  .rc-code-item img { display: none; }
  .rc-code-item span {
    display: block;
    min-width: 0;
  }
  .rc-code-item small {
    display: block;
    margin-bottom: .7mm;
    color: #62584d;
    font-size: 7.2px;
    font-weight: 800;
    letter-spacing: .25px;
    line-height: 1;
    text-transform: uppercase;
  }
  .rc-code-item b {
    display: block;
    color: #1f1f1f;
    font-size: 11.4px;
    font-weight: 800;
    line-height: 1.15;
  }
  .rc-responsible-date {
    color: #2d241a;
  }
  .rc-responsible-date b {
    color: #1f1f1f;
    font-size: 11.4px;
  }
  .rc-title { padding: 1mm 0 1.5mm; text-align: center; font-family: Georgia, "Times New Roman", serif; }
  .rc-title h1 { margin: 0; font-size: 24px; font-weight: 500; letter-spacing: 1.1px; }
  .rc-title p {
    margin: .7mm 0 0;
    color: #a66a20;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    letter-spacing: 5px;
    text-transform: uppercase;
  }
  .rc-title i { position: relative; display: block; width: 27mm; height: .3mm; margin: .8mm auto 0; background: #a66a20; }
  .rc-title i::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 2.2mm;
    height: 2.2mm;
    border: .32mm solid #a66a20;
    background: #fffdfa;
    transform: translate(-50%, -50%) rotate(45deg);
  }
  .rc-schedule-meta img, .rc-mode-row img { filter: sepia(1) saturate(1.5) brightness(.72); }
  .rc-upper { margin-top: 2.4mm; }
  .rc-operational {
    padding: 0 0 2.2mm;
  }
  .rc-operational-title {
    display: flex;
    align-items: baseline;
    gap: 2mm;
    margin: 0 0 1.6mm;
    color: #9a611d;
    font: 800 13.5px Arial, Helvetica, sans-serif;
    letter-spacing: .12px;
    text-transform: uppercase;
  }
  .rc-operational-title b {
    color: #9a611d;
    font-size: 17px;
    font-weight: 800;
  }
  .rc-operational-title::after {
    content: "";
    flex: 1 1 auto;
    height: .25mm;
    background: #d8d0c4;
    transform: translateY(-.6mm);
  }
  .rc-operational-grid {
    display: grid;
    grid-template-columns: .96fr 1.04fr;
    gap: 5mm;
    align-items: start;
  }
  .rc-info-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 4mm;
    row-gap: 1.8mm;
  }
  .rc-info-line,
  .rc-timeline-row,
  .rc-place-line,
  .rc-sign-line {
    min-width: 0;
    padding-bottom: 1mm;
    border-bottom: .2mm solid #ded6ca;
    font-family: Arial, Helvetica, sans-serif;
  }
  .rc-info-line.is-wide,
  .rc-place-line,
  .rc-sign-line {
    grid-column: 1 / -1;
  }
  .rc-info-line small,
  .rc-timeline-row small,
  .rc-place-line small,
  .rc-sign-line small {
    display: block;
    margin-bottom: .35mm;
    color: #6b5a46;
    font-size: 8.2px;
    font-weight: 600;
    letter-spacing: .15px;
    line-height: 1;
    text-transform: uppercase;
  }
  .rc-info-line strong,
  .rc-timeline-row strong,
  .rc-place-line strong {
    display: block;
    color: #111;
    font-size: 11.4px;
    font-weight: 500;
    line-height: 1.18;
    text-transform: uppercase;
  }
  .rc-timeline {
    display: grid;
    gap: 1.6mm;
  }
  .rc-timeline-row {
    display: grid;
    grid-template-columns: minmax(24mm, .95fr) minmax(0, .9fr) minmax(0, .9fr);
    gap: 3mm;
    align-items: end;
  }
  .rc-timeline-kind strong {
    color: #111;
  }
  .rc-timeline-kind em {
    display: block;
    margin-top: .35mm;
    color: #6b5a46;
    font-size: 8.4px;
    font-style: normal;
    font-weight: 500;
    line-height: 1;
    text-transform: none;
  }
  .rc-sign-line {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2.5mm;
    align-items: end;
    margin-top: 2mm;
    padding-top: .3mm;
  }
  .rc-sign-line small { display: none; }
  .rc-sign-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2.5mm;
  }
  .rc-sign-field {
    display: grid;
    grid-template-columns: auto minmax(18mm, 1fr);
    gap: 1.2mm;
    align-items: end;
    color: #111;
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
  }
  .rc-sign-field i {
    display: none;
  }
  .rc-block-title {
    display: flex;
    align-items: baseline;
    gap: 2mm;
    margin: 0 0 .8mm;
    color: #a66a20;
    font: 700 14px Georgia, "Times New Roman", serif;
    font-variant: small-caps;
  }
  .rc-block-title b { color: #a66a20; font-size: 19px; font-weight: 500; }
  .rc-block-title::after { content: ""; align-self: end; width: 20mm; height: .3mm; background: #a66a20; transform: translateY(1mm); }
  .rc-upper .rc-block-title::after { display: none; }
  .rc-client { padding-right: 5mm; border-right: .3mm solid #d8d0c4; }
  .rc-fields {
    display: grid;
    grid-template-columns: 42mm minmax(0, 1fr);
    row-gap: .55mm;
    padding-top: 0;
    font-size: 10.6px;
  }
  .rc-fields strong { font-weight: 800; }
  .rc-fields span {
    min-height: 3.2mm;
    border-bottom: .2mm solid #ded6ca;
    font-family: Georgia, "Times New Roman", serif;
    text-transform: uppercase;
  }
  .rc-schedule-box, .rc-mode-box, .rc-observations, .rc-money, .rc-terms {
    border: .25mm solid #e4d3bb;
    border-radius: 1.5mm;
    background: rgba(255, 255, 255, .45);
  }
  .rc-schedule-row {
    display: grid;
    grid-template-columns: 10mm minmax(0, 1fr) 30mm 30mm;
    align-items: center;
    min-height: 8.2mm;
    padding: .7mm 1.6mm;
    border-bottom: .25mm solid #d8d0c4;
  }
  .rc-schedule-row:last-child { border-bottom: 0; }
  .rc-round-icon {
    width: 6mm;
    height: 6mm;
    display: grid;
    place-items: center;
    border: .22mm solid #e0c899;
    border-radius: 50%;
    background: #f7f0e4;
  }
  .rc-round-icon img { width: 3.8mm; height: 3.8mm; filter: sepia(1) saturate(1.5) brightness(.7); }
  .rc-schedule-row strong { display: block; font-size: 10px; }
  .rc-schedule-row span { display: block; margin-top: .4mm; font-size: 8.8px; }
  .rc-schedule-meta {
    display: flex !important;
    align-items: center;
    gap: 2mm;
    margin: 0 !important;
    padding-left: 3mm;
    border-left: .25mm solid #d8d0c4;
    white-space: nowrap;
  }
  .rc-schedule-meta img { width: 4.5mm; height: 4.5mm; object-fit: contain; }
  .rc-schedule-meta.is-coordinate {
    align-items: flex-start;
    gap: 1.4mm;
    white-space: normal;
  }
  .rc-coordinate-time {
    display: block;
    flex: 1;
    min-width: 0;
    margin-top: 0 !important;
    font-size: 6.6px !important;
    font-weight: 900;
    line-height: 1;
    text-transform: uppercase;
  }
  .rc-coordinate-time i {
    display: block;
    width: 100%;
    height: 2.2mm;
    margin-top: .8mm;
    border-bottom: .2mm solid #8f806d;
  }
  .rc-mode-box { margin-top: .8mm; padding: .6mm 1.6mm; }
  .rc-mode-row { display: grid; grid-template-columns: 7mm minmax(0, 1fr); gap: 1.2mm; align-items: center; min-height: 6mm; }
  .rc-mode-row + .rc-mode-row { border-top: .25mm solid #d8d0c4; }
  .rc-mode-row img { width: 4.8mm; height: 4.8mm; object-fit: contain; }
  .rc-mode-row strong { display: block; }
  .rc-mode-row span { display: block; margin-top: .35mm; }
  .rc-handwrite-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2mm;
    margin-top: 1.2mm;
  }
  .rc-handwrite-field {
    display: grid;
    grid-template-columns: auto minmax(18mm, 1fr);
    align-items: end;
    gap: 1.2mm;
    min-height: 4.2mm;
    font-size: 8.2px;
    font-weight: 800;
    white-space: nowrap;
  }
  .rc-handwrite-field i {
    display: block;
    height: 3.2mm;
    border-bottom: .25mm solid #8f806d;
  }
  .rc-items { margin-top: 1mm; }
  .rc-items .rc-block-title { margin-bottom: 0; }
  .rc-day-section {
    break-inside: auto;
    page-break-inside: auto;
  }
  .rc-day-section.starts-new-page {
    padding-top: 0;
  }
  .rc-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    border: .25mm solid #d8d0c4;
    border-radius: 1.5mm;
    overflow: hidden;
    table-layout: fixed;
  }
  .rc-table thead { display: table-header-group; }
  .rc-table tr { break-inside: avoid; page-break-inside: avoid; }
  .rc-table th {
    padding: 1.2mm 1.7mm;
    color: #fff;
    background: linear-gradient(90deg, #181818, #323232);
    font-size: 8.9px;
    text-align: left;
    text-transform: uppercase;
  }
  .rc-table th.num, .rc-table td.num, .rc-table th.check, .rc-table td.check { text-align: center; white-space: nowrap; }
  .rc-table th.check { font-size: 7px; letter-spacing: 0; overflow-wrap: anywhere; white-space: normal; }
  .rc-table td {
    padding: .95mm 1.55mm;
    border-right: .25mm solid #e8ded0;
    border-bottom: .25mm solid #e8ded0;
    vertical-align: middle;
    font-size: 10px;
  }
  .rc-table tbody tr.rc-cat-amber td:nth-child(2) { box-shadow: inset 1.25mm 0 0 #c98a22; }
  .rc-table tbody tr.rc-cat-blue td:nth-child(2) { box-shadow: inset 1.25mm 0 0 #315f9f; }
  .rc-table tbody tr.rc-cat-green td:nth-child(2) { box-shadow: inset 1.25mm 0 0 #2e7d54; }
  .rc-table tbody tr.rc-cat-violet td:nth-child(2) { box-shadow: inset 1.25mm 0 0 #7553a7; }
  .rc-table tbody tr.rc-cat-rose td:nth-child(2) { box-shadow: inset 1.25mm 0 0 #ad4f64; }
  .rc-table tbody tr.rc-cat-slate td:nth-child(2) { box-shadow: inset 1.25mm 0 0 #56616f; }
  .rc-duration-day-row {
    break-after: avoid;
    page-break-after: avoid;
  }
  .rc-duration-day-row td {
    padding: .8mm 1.5mm;
    border-right: 0;
    background: #fff7ea;
    color: #8a4f12;
    font-size: 8.6px;
    font-weight: 900;
    letter-spacing: .15px;
    text-transform: uppercase;
  }
  .rc-category-chip {
    display: inline-block;
    max-width: 36mm;
    margin: 0 1.3mm .15mm 0;
    padding: .25mm 1.1mm;
    border-radius: 99mm;
    background: #f4eadc;
    color: #7a4b16;
    font: 900 6.7px Arial, Helvetica, sans-serif;
    letter-spacing: .18px;
    line-height: 1.08;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: .35mm;
  }
  .rc-cat-blue .rc-category-chip { background: #e8f0fb; color: #18477d; }
  .rc-cat-green .rc-category-chip { background: #e6f4eb; color: #1d6843; }
  .rc-cat-violet .rc-category-chip { background: #eee8f8; color: #5b3e88; }
  .rc-cat-rose .rc-category-chip { background: #f9e8ed; color: #8a374c; }
  .rc-cat-slate .rc-category-chip { background: #eef1f4; color: #3e4b5a; }
  .rc-row-index {
    color: #111;
    font-size: 8.5px;
    font-weight: 900;
    text-align: center;
  }
  .rc-table td:last-child { border-right: 0; }
  .rc-table tbody tr:last-child td { border-bottom: 0; }
  .rc-manual-block {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .rc-manual-table {
    border-top: 0;
    border-radius: 0;
  }
  .rc-financial-block {
    border: .25mm solid #d8d0c4;
    border-top: .45mm solid #a66a20;
    border-radius: 0 0 1.5mm 1.5mm;
    overflow: hidden;
    background: #fffaf2;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .rc-financial-summary {
    display: flex;
    width: 100%;
    align-items: stretch;
  }
  .rc-financial-item {
    min-width: 0;
    flex: 1 1 0;
    display: grid;
    align-content: center;
    gap: .55mm;
    min-height: 12mm;
    padding: 1.2mm .8mm;
    border-right: .22mm solid #d8c9b5;
    text-align: center;
  }
  .rc-financial-item:last-child { border-right: 0; }
  .rc-financial-item span {
    color: #665541;
    font-size: 6.7px;
    font-weight: 800;
    line-height: 1.05;
    text-transform: uppercase;
  }
  .rc-financial-item strong {
    color: #181818;
    font-size: 10.6px;
    font-weight: 900;
    line-height: 1;
    white-space: nowrap;
  }
  .rc-financial-item.transport { background: #fff7ea; }
  .rc-financial-item.transport span,
  .rc-financial-item.transport strong { color: #8a4f12; }
  .rc-financial-item.guarantee { background: #fff0d7; }
  .rc-financial-item.guarantee span,
  .rc-financial-item.guarantee strong { color: #96570f; }
  .rc-financial-item.total { background: #f3e4cf; }
  .rc-financial-item.total span { color: #4b3218; }
  .rc-financial-item.total strong { color: #161616; font-size: 12.4px; }
  .rc-financial-item.managed { background: #2e241a; }
  .rc-financial-item.managed span { color: #f5dfbe; }
  .rc-financial-item.managed strong { color: #fff; font-size: 12px; }
  .rc-financial-item.manual { background: #fff; }
  .rc-financial-item.manual strong {
    width: 82%;
    min-height: 3mm;
    margin: 0 auto;
  }
  .rc-item-name { display: block; font: 700 10.2px Georgia, "Times New Roman", serif; text-transform: uppercase; }
  .rc-item-meta { display: block; margin-top: .35mm; font-size: 7.6px; text-transform: uppercase; }
  .rc-item-observation { display: block; margin-top: .45mm; color: #0f766e; font: 900 7.5px Arial, Helvetica, sans-serif; text-transform: uppercase; }
  .rc-item-supplier { display: block; margin-top: .45mm; color: #1d4ed8; font: 900 7.4px Arial, Helvetica, sans-serif; text-transform: uppercase; }
  .rc-check { display: inline-block; width: 4mm; height: 4mm; border: .25mm solid #878787; border-radius: .25mm; }
  .rc-observation-line { display: block; width: 100%; min-width: 0; height: 4mm; }
  .rc-manual-row td { height: 8mm; }
  .rc-manual-write-line {
    display: block;
    width: 100%;
    height: 4.2mm;
  }
  .rc-closeout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 34mm;
    gap: 3mm;
    margin-top: 2mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .rc-closeout-writing {
    display: grid;
    gap: 2mm;
    min-width: 0;
  }
  .rc-closeout .rc-financial-block {
    margin-top: 0;
    border-top: 0;
  }
  .rc-closeout .rc-financial-summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    border-top: .45mm solid #a66a20;
  }
  .rc-closeout .rc-financial-item {
    min-height: 8.6mm;
    border-right: .25mm solid #d8c29c;
    border-bottom: .25mm solid #d8c29c;
  }
  .rc-closeout .rc-financial-item:last-child {
    border-right: .25mm solid #d8c29c;
  }
  .rc-bottom {
    display: contents;
  }
  .rc-bottom-title { margin: 0 0 1.2mm; color: #a66a20; font: 500 12.5px Georgia, "Times New Roman", serif; font-variant: small-caps; }
  .rc-bottom-title::after { content: ""; display: block; width: 18mm; height: .25mm; margin-top: .6mm; background: #a66a20; }
  .rc-observations, .rc-guarantee-control {
    min-height: 18mm;
    padding: 1.35mm 1.5mm;
    border: .25mm solid #d8c29c;
    border-radius: 1.5mm;
    background: #fffdf9;
  }
  .rc-observations strong { display: block; margin-bottom: 1.2mm; font-size: 8.2px; }
  .rc-observations p { margin: 0; text-transform: uppercase; white-space: pre-line; }
  .rc-change-lines { display: block; min-height: 12mm; padding-top: .2mm; }
  .rc-change-line { display: none; }
  .rc-client-materials {
    margin-top: 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .rc-material-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2.5mm;
  }
  .rc-material-box {
    min-height: 30mm;
    display: grid;
    grid-template-rows: auto 1fr;
    border: .25mm solid #e4d3bb;
    background: #fffefa;
  }
  .rc-material-box h4 {
    margin: 0;
    padding: 1mm 1.2mm;
    border-bottom: .25mm solid #e4d3bb;
    color: #7c4610;
    font-size: 8.2px;
    text-transform: uppercase;
  }
  .rc-material-lines {
    display: block;
    min-height: 24mm;
    padding: 1mm 1.2mm 1.4mm;
  }
  .rc-material-lines span { display: none; }
  .rc-terms-section {
    margin-top: 3mm;
    padding-top: 0;
    border-top: 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .rc-terms-head {
    display: grid;
    grid-template-columns: minmax(0, .78fr) minmax(0, 1.22fr);
    gap: 8mm;
    align-items: end;
    margin-bottom: 1.5mm;
  }
  .rc-terms-section .rc-block-title { margin-bottom: 0; }
  .rc-terms {
    padding: 1.7mm 2mm;
    border: .25mm solid #d8c29c;
    border-radius: 1.5mm;
    background: #fffdf9;
  }
  .rc-terms-list { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2.4mm; margin: 0; padding: 0; list-style: none; }
  .rc-terms-list li { display: grid; grid-template-columns: 4.2mm minmax(0, 1fr); gap: 1.2mm; font-size: 8.6px; line-height: 1.28; }
  .rc-terms-list b {
    width: 3.5mm;
    height: 3.5mm;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: #fff;
    background: #a66a20;
    font-size: 7px;
  }
  .rc-signatures {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10mm;
    margin: 0;
    break-inside: avoid;
    page-break-inside: avoid;
    text-align: center;
  }
  .rc-signature { display: flex; min-height: 13mm; flex-direction: column; justify-content: flex-end; }
  .rc-signature-line { padding-top: 1.2mm; border-top: .3mm solid #777; }
  .rc-signature strong { display: block; font-size: 8.5px; text-transform: uppercase; }
  .rc-signature span { display: block; margin-top: .45mm; font-size: 7.4px; line-height: 1.1; text-transform: uppercase; }
  .rc-footer {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 4mm;
    margin-top: 1.8mm;
    padding-top: 1.2mm;
    border-top: .3mm solid #a66a20;
    color: #555;
    font-size: 8.5px;
  }
  .rc-footer strong { color: #a66a20; font-size: 9px; }
  .rc-footer span { line-height: 1.2; }
  .rc-footer span:last-child { text-align: right; }
  .rc-page-bottom {
    position: static;
    margin-top: auto;
    padding-top: 3mm;
    background: transparent;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .rc-sheet.is-dense { font-size: 10px; }
  .rc-sheet.is-dense .rc-title { padding-top: 1mm; padding-bottom: 2.5mm; }
  .rc-sheet.is-dense .rc-upper { margin-top: 2.5mm; }
  .rc-sheet.is-dense .rc-schedule-row { min-height: 9.6mm; }
  .rc-sheet.is-dense .rc-items { margin-top: .5mm; }
  .rc-sheet.is-dense .rc-table th { padding-top: .9mm; padding-bottom: .9mm; font-size: 8.1px; }
  .rc-sheet.is-dense .rc-table td { padding-top: .68mm; padding-bottom: .68mm; }
  .rc-sheet.is-dense .rc-bottom { margin-top: 1.2mm; }
  .rc-sheet.is-dense .rc-observations, .rc-sheet.is-dense .rc-guarantee-control { min-height: 22mm; }
  .rc-sheet.is-dense .rc-client-materials { margin-top: 1.6mm; }
  .rc-sheet.is-dense .rc-signature { min-height: 12mm; }
  .rc-sheet.is-dense .rc-terms-list li { font-size: 8px; }
  .rc-sheet.is-multipage .rc-financial-block {
    margin-top: 0;
    border-top: 0;
  }
  .rc-sheet.is-multipage .rc-financial-summary {
    border-top: .45mm solid #a66a20;
  }
  .rc-continuation-head {
    display: none;
  }
  .rc-sheet.is-multipage .rc-continuation-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6mm;
    align-items: end;
    margin: 0 0 5mm;
    padding: 8mm 0 2.5mm;
    border-bottom: .32mm solid #a66a20;
    break-before: page;
    page-break-before: always;
  }
  .rc-continuation-head h2 {
    margin: 0;
    color: #161616;
    font: 500 18px Georgia, "Times New Roman", serif;
    letter-spacing: .4px;
    text-transform: uppercase;
  }
  .rc-continuation-head p {
    margin-top: .8mm;
    color: #6f5232;
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
  }
  .rc-continuation-head strong {
    color: #a66a20;
    font: 500 18px Georgia, "Times New Roman", serif;
    white-space: nowrap;
  }
  .rc-sheet.is-multipage .rc-bottom {
    margin-top: 3mm;
  }
  .rc-sheet.is-multipage .rc-client-materials {
    margin-top: 3mm;
  }
  @media print {
    html, body {
      width: auto;
      height: auto;
      margin: 0;
      padding: 0;
      background: #fff;
    }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .rc-sheet {
      position: relative;
      width: auto;
      max-width: none;
      min-height: auto;
      margin: 0;
      padding: 0;
      display: block;
      box-shadow: none;
      background: #fffdfa;
    }
    .rc-table {
      border-collapse: separate;
      border-spacing: 0;
      border-radius: 0;
      overflow: visible;
    }
    .rc-table thead { display: table-header-group; }
    .rc-table tbody { break-inside: auto; page-break-inside: auto; }
    .rc-table tr,
    .rc-table td,
    .rc-table th {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    .rc-table tr { position: relative; }
    .rc-day-section.starts-new-page {
      padding-top: 0;
    }
    .rc-bottom,
    .rc-closeout,
    .rc-client-materials,
    .rc-terms-section,
    .rc-page-bottom {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .rc-page-bottom {
      margin-top: 3mm;
      padding-top: 5mm;
    }
    .rc-items { padding-bottom: 1.5mm; }
  }
`;

export const buildContractDocumentHtml = ({ rental, contract, deliveries, settings, items = [] }) => {
  const deliveryOut = deliveries[0] ?? null;
  const deliveryBack = deliveries[1] ?? null;
  const company = getDocumentCompany(settings);
  const subtotalBs = contract?.totals?.subtotalBs ?? rental?.totals?.subtotalBs ?? rental?.totals?.totalBs ?? 0;
  const discountBs = contract?.totals?.discountBs ?? rental?.totals?.discountBs ?? 0;
  const guaranteeBs = contract?.totals?.guaranteeBs ?? rental?.depositBs ?? 0;
  const totalBs = contract?.totals?.totalBs ?? rental?.totals?.totalBs ?? 0;
  const deliveryFeeBs = Number(
    contract?.totals?.deliveryFeeBs
      ?? contract?.deliveryFeeBs
      ?? rental?.totals?.deliveryFeeBs
      ?? rental?.deliveryFeeBs
      ?? 0,
  );
  const isGuaranteeValidated = String(contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? rental?.guarantee?.status ?? rental?.payment?.guaranteeStatus ?? '').trim() === 'validado';
  const paidBs = contract?.payment?.paidAtApprovalBs ?? rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs ?? 0;
  const prepaidAppliedBs = contract?.payment?.prepaidAppliedBs ?? rental?.payment?.prepaidAppliedBs ?? rental?.totals?.prepaidAppliedBs ?? rental?.prepaidAppliedBs ?? 0;
  const pricingPlan = contract?.pricingPlan ?? rental?.pricingPlan ?? null;
  const hasDurationPricing = pricingPlan?.mode === 'duration';
  const hasDailySchedulePricing = pricingPlan?.mode === 'daily_schedule';
  const hasManualDiscount = Number(discountBs ?? 0) > 0;
  const logisticsMode = contract?.logisticsMode ?? rental?.logisticsMode ?? 'envio';
  const isCustomerPickup = logisticsMode === 'recojo';
  const cancellationPenaltyPercent = Number(settings?.contractCancellationPenaltyPercent ?? 20);
  const cancellationClause = `La anulacion del contrato se permite hasta la fecha de envio programada (${formatDocumentDate(contract?.deliveryDate ?? rental?.rentalDate)}). Si se anula dentro de ese plazo, se aplicara una penalidad del ${cancellationPenaltyPercent.toFixed(0)}% sobre el total del contrato.`;

  const catalogById = new Map((items ?? []).map((item) => [String(item.id), item]));
  const mainCode = contract?.contractCode ?? rental?.orderCode ?? contract?.orderCode ?? 'SIN-CODIGO';
  const documentCustomerName = contract?.customerName ?? rental?.customerName ?? '';
  const documentCustomerPhone = contract?.customerPhone ?? rental?.customerPhone ?? '';
  const documentCustomerReferencePhone = String(contract?.customerReferencePhone ?? rental?.customerReferencePhone ?? rental?.referencePhone ?? '').trim();
  const documentCustomerPhones = [documentCustomerPhone, documentCustomerReferencePhone]
    .map((phone) => String(phone ?? '').trim())
    .filter(Boolean);
  const documentCustomerCi = String(contract?.customerCi ?? contract?.nitCi ?? rental?.customerCi ?? rental?.nitCi ?? '').trim();
  const documentTitle = buildDocumentFileBase(documentCustomerName, mainCode, 'contrato');
  const issuedAt = formatDocumentLongDate(contract?.contractDate ?? rental?.contractDate ?? contract?.createdAt ?? rental.createdAt ?? new Date().toISOString());
  const eventLongDate = formatDocumentLongDate(contract?.eventDate ?? rental?.eventDate ?? contract?.deliveryDate ?? rental?.rentalDate);
  const eventAddress = contract?.address ?? rental.eventAddress ?? deliveryOut?.address ?? '-';
  const operationalPlaceLabel = isCustomerPickup ? 'Recojo por cliente' : eventAddress;
  const responsibleName = String(
    contract?.responsibles?.[0]?.name
    ?? contract?.createdByName
    ?? rental?.createdByName
    ?? contract?.createdBy
    ?? 'Sin responsable',
  ).trim() || 'Sin responsable';
  const contractDocumentItems = Array.isArray(contract?.items) ? contract.items : [];
  const rentalDocumentItems = Array.isArray(rental?.items) ? rental.items : [];
  const contractItemsByKey = new Map(contractDocumentItems.map((line, index) => [
    String(line?.lineKey ?? line?.comboLineKey ?? line?.itemId ?? `contract-${index}`),
    line,
  ]));
  const mergeDocumentItemLine = (primaryLine, fallbackLine = null) => {
    const primary = primaryLine ?? {};
    const fallback = fallbackLine ?? {};
    const quantity = Number(primary.quantity ?? fallback.quantity ?? 0);
    const primaryLineTotalBs = Number(primary.lineTotalBs ?? 0);
    const fallbackLineTotalBs = Number(fallback.lineTotalBs ?? 0);
    const hasPrimaryUnitPrice = primary?.unitPriceBs !== undefined
      && primary?.unitPriceBs !== null
      && primary?.unitPriceBs !== '';
    const hasPrimaryRentalPrice = primary?.rentalPriceBs !== undefined
      && primary?.rentalPriceBs !== null
      && primary?.rentalPriceBs !== '';
    const hasFallbackUnitPrice = fallback?.unitPriceBs !== undefined
      && fallback?.unitPriceBs !== null
      && fallback?.unitPriceBs !== '';
    const hasFallbackRentalPrice = fallback?.rentalPriceBs !== undefined
      && fallback?.rentalPriceBs !== null
      && fallback?.rentalPriceBs !== '';
    const rawUnitPriceBs = hasPrimaryUnitPrice
      ? Math.max(0, Number(primary.unitPriceBs ?? 0))
      : hasPrimaryRentalPrice
        ? Math.max(0, Number(primary.rentalPriceBs ?? 0))
        : hasFallbackUnitPrice
          ? Math.max(0, Number(fallback.unitPriceBs ?? 0))
          : hasFallbackRentalPrice
            ? Math.max(0, Number(fallback.rentalPriceBs ?? 0))
            : 0;
    const lineTotalBs = primaryLineTotalBs > 0
      ? primaryLineTotalBs
      : fallbackLineTotalBs > 0
        ? fallbackLineTotalBs
        : rawUnitPriceBs > 0
          ? Number((quantity * rawUnitPriceBs).toFixed(2))
          : 0;
    const unitPriceBs = rawUnitPriceBs > 0
      ? rawUnitPriceBs
      : quantity > 0 && lineTotalBs > 0
        ? Number((lineTotalBs / quantity).toFixed(2))
        : 0;
    return {
      ...fallback,
      ...primary,
      quantity,
      rentalPriceBs: unitPriceBs,
      unitPriceBs,
      grossLineTotalBs: Number(primary.grossLineTotalBs ?? fallback.grossLineTotalBs ?? lineTotalBs),
      lineTotalBs,
      serviceDayId: primary.serviceDayId ?? primary.scheduleDayId ?? null,
      serviceDate: primary.serviceDate ?? primary.date ?? null,
      serviceDayLabel: primary.serviceDayLabel ?? primary.dayLabel ?? '',
    };
  };
  const rawDocumentItems = contractDocumentItems.length > 0
    ? contractDocumentItems.map((line) => mergeDocumentItemLine(line, null))
    : rentalDocumentItems.map((line, index) => {
      const key = String(line?.lineKey ?? line?.comboLineKey ?? line?.itemId ?? `rental-${index}`);
      return mergeDocumentItemLine(line, contractItemsByKey.get(key));
    });
  const supplierSupportByItem = buildSupplierSupportByItem(
    pickFirstSupplierFulfillmentPlan(contract?.supplierFulfillmentPlan, rental?.supplierFulfillmentPlan),
  );
  const documentItems = rawDocumentItems
    .map((line, index) => {
      const item = catalogById.get(String(line.itemId ?? ''));
      const category = getContractLineCategory(line, item);
      const area = getContractAreaMeta(resolveInventoryArea(getContractAreaSource(line, item)));
      const areaIndex = CONTRACT_AREA_ORDER.findIndex((entry) => entry.key === area.key);
      return {
        ...line,
        _originalIndex: index,
        _category: category,
        _area: area,
        _areaIndex: areaIndex >= 0 ? areaIndex : CONTRACT_AREA_ORDER.length,
        _categoryKey: normalizeText(category),
      };
    })
    .sort((left, right) =>
      left._areaIndex - right._areaIndex
      || left._originalIndex - right._originalIndex
    );
  let contractRowNumber = 0;
  const durationBaseBs = Number(pricingPlan?.baseSubtotalBs ?? contract?.totals?.baseSubtotalBs ?? 0);
  const pricingDays = Math.max(1, Math.trunc(Number(pricingPlan?.days ?? 1)));
  const getDurationPercentForDay = (day) => {
    if (!hasDurationPricing) return 100;
    const tiers = Array.isArray(pricingPlan?.tiers) ? pricingPlan.tiers : [];
    const tier = tiers.find((entry) => {
      const fromDay = Math.max(1, Math.trunc(Number(entry?.fromDay ?? 1)));
      const rawToDay = Math.trunc(Number(entry?.toDay ?? 0));
      const toDay = rawToDay > 0 ? rawToDay : pricingDays;
      return day >= fromDay && day <= toDay;
    });
    return Math.max(0, Math.min(100, Number(tier?.percent ?? 100)));
  };
  const durationDayBreakdown = hasDurationPricing
    ? Array.from({ length: pricingDays }, (_, index) => {
      const day = index + 1;
      const percent = getDurationPercentForDay(day);
      return {
        day,
        percent,
        multiplier: percent / 100,
        totalBs: Number((durationBaseBs * (percent / 100)).toFixed(2)),
      };
    })
    : [];
  const getDocumentLineUnitPriceBs = (line) => Number(line.rentalPriceBs ?? line.unitPriceBs ?? 0);
  const getDocumentLineTotalBs = (line, multiplier = 1) => {
    const supplierSupportLines = supplierSupportByItem.get(String(line.lineKey ?? '').trim())
      ?? supplierSupportByItem.get(String(line.itemId ?? '').trim());
    const fulfillmentBreakdown = buildFulfillmentBreakdown(line, supplierSupportLines);
    const unitPriceBs = getDocumentLineUnitPriceBs(line);
    const storedLineTotalBs = Number(line.lineTotalBs);
    const hasStoredLineTotal = Number.isFinite(storedLineTotalBs);
    const ownLineTotalBs = Number((fulfillmentBreakdown.ownQty * unitPriceBs).toFixed(2));
    const totalQuantityLineTotalBs = Number((fulfillmentBreakdown.totalQty * unitPriceBs).toFixed(2));
    const discountPercent = Math.min(100, Math.max(0, Number(line.discountPercent ?? 0)));
    const supplierSaleBs = (Array.isArray(supplierSupportLines) ? supplierSupportLines : [])
      .reduce((sum, entry) => {
        const rawSaleBs = Number(entry.totalSaleBs ?? (Number(entry.neededQty ?? 0) * Number(entry.saleUnitPriceBs ?? unitPriceBs)));
        const alreadyDiscounted = Boolean(entry.discountApplied || Number(entry.saleDiscountPercent ?? 0) > 0);
        const effectiveSaleBs = alreadyDiscounted
          ? rawSaleBs
          : Number((rawSaleBs * (1 - (discountPercent / 100))).toFixed(2));
        return sum + effectiveSaleBs;
      }, 0);
    const ownStoredLineTotalBs = hasStoredLineTotal ? storedLineTotalBs : ownLineTotalBs;
    const baseLineTotalBs = fulfillmentBreakdown.supplierQty > 0
      ? (
        ownStoredLineTotalBs >= totalQuantityLineTotalBs - 0.01
          ? ownStoredLineTotalBs
          : Number((ownStoredLineTotalBs + supplierSaleBs).toFixed(2))
      )
      : (hasStoredLineTotal ? ownStoredLineTotalBs : totalQuantityLineTotalBs);

    return Number((baseLineTotalBs * multiplier).toFixed(2));
  };
  const getDocumentLineGrossTotalBs = (line, multiplier = 1) => {
    const supplierSupportLines = supplierSupportByItem.get(String(line.lineKey ?? '').trim())
      ?? supplierSupportByItem.get(String(line.itemId ?? '').trim());
    const fulfillmentBreakdown = buildFulfillmentBreakdown(line, supplierSupportLines);
    const unitPriceBs = getDocumentLineUnitPriceBs(line);
    const storedGrossLineTotalBs = Number(line.grossLineTotalBs);
    const storedLineTotalBs = Number(line.lineTotalBs);
    const storedDiscountBs = Number(line.discountBs ?? 0);
    const quantityGrossBs = Number((fulfillmentBreakdown.totalQty * unitPriceBs).toFixed(2));
    const recoveredGrossBs = storedLineTotalBs > 0 && storedDiscountBs > 0
      ? Number((storedLineTotalBs + storedDiscountBs).toFixed(2))
      : 0;
    const grossLineTotalBs = Number.isFinite(storedGrossLineTotalBs) && storedGrossLineTotalBs > 0
      ? storedGrossLineTotalBs
      : recoveredGrossBs > 0
        ? recoveredGrossBs
        : quantityGrossBs;

    return Number((grossLineTotalBs * multiplier).toFixed(2));
  };
  const renderContractItemRow = (line, multiplier = 1) => {
        const item = catalogById.get(String(line.itemId ?? ''));
        const meta = getContractItemMeta(line, item);
        const area = line._area || getContractAreaMeta(resolveInventoryArea(getContractAreaSource(line, item)));
        const supplierSupportLines = supplierSupportByItem.get(String(line.lineKey ?? '').trim())
          ?? supplierSupportByItem.get(String(line.itemId ?? '').trim());
        const fulfillmentBreakdown = buildFulfillmentBreakdown(line, supplierSupportLines);
        const supplierSupportLabel = fulfillmentBreakdown.label || formatSupplierSupportLabel(supplierSupportLines);
        const unitPriceBs = getDocumentLineUnitPriceBs(line) * multiplier;
        const displayQuantity = fulfillmentBreakdown.totalQty;
        const lineTotalBs = getDocumentLineGrossTotalBs(line, multiplier);
        contractRowNumber += 1;
        return `
        <tr class="rc-cat-${escapeHtml(area.className)}">
          <td class="rc-row-index">${contractRowNumber}</td>
          <td>
            <span class="rc-category-chip">${escapeHtml(area.label)}</span>
            <span class="rc-item-name">${escapeHtml(line.itemName)}</span>
            ${meta ? `<span class="rc-item-meta">${escapeHtml(meta)}</span>` : ''}
            ${supplierSupportLabel ? `<span class="rc-item-supplier">${escapeHtml(supplierSupportLabel)}</span>` : ''}
            ${String(line.observation ?? '').trim() ? `<span class="rc-item-observation">${escapeHtml(String(line.observation ?? '').trim())}</span>` : ''}
          </td>
          <td class="num">${displayQuantity}</td>
          <td class="num">${formatBs(unitPriceBs)}</td>
          <td class="num">${formatBs(lineTotalBs)}</td>
          <td class="check"></td>
          <td class="check"></td>
          <td><span class="rc-observation-line"></span></td>
        </tr>`;
  };
  let scheduleDaysForDocument = hasDailySchedulePricing && Array.isArray(pricingPlan?.scheduleDays)
    ? pricingPlan.scheduleDays.filter((day) => day?.id || day?.label || day?.date)
    : [];
  if (hasDailySchedulePricing) {
    const daysByDate = new Map(scheduleDaysForDocument.map((day) => [toDateKey(day?.date), day]).filter(([date]) => Boolean(date)));
    documentItems.forEach((line) => {
      const lineDate = toDateKey(line?.serviceDate ?? line?.date);
      if (!lineDate || daysByDate.has(lineDate)) return;
      daysByDate.set(lineDate, {
        id: String(line?.serviceDayId ?? line?.scheduleDayId ?? `day-${lineDate}`).trim() || `day-${lineDate}`,
        label: String(line?.serviceDayLabel ?? '').trim() || `Dia ${daysByDate.size + 1}`,
        date: lineDate,
        subtotalBs: 0,
      });
    });
    scheduleDaysForDocument = Array.from(daysByDate.values())
      .sort((left, right) => String(left?.date ?? '').localeCompare(String(right?.date ?? '')));
  }
  const resolveScheduleDayIndexForDocumentLine = (line) => {
    const lineDayId = String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim();
    const lineDate = toDateKey(line?.serviceDate ?? line?.date);
    const lineLabel = normalizeText(line?.serviceDayLabel ?? line?.dayLabel);
    const byDate = lineDate
      ? scheduleDaysForDocument.findIndex((day) => toDateKey(day?.date) === lineDate)
      : -1;
    if (byDate >= 0) return byDate;
    const byId = lineDayId
      ? scheduleDaysForDocument.findIndex((day) => String(day?.id ?? '') === lineDayId)
      : -1;
    if (byId >= 0) return byId;
    return lineLabel
      ? scheduleDaysForDocument.findIndex((day) => normalizeText(day?.label) === lineLabel)
      : -1;
  };
  const renderScheduleDayHeader = (day, fallbackIndex, lines) => {
    const dayLabel = String(day?.label ?? '').trim() || `Dia ${fallbackIndex + 1}`;
    const dateLabel = day?.date ? ` - ${formatDocumentDate(day.date)}` : '';
    const subtotal = lines.reduce((sum, line) => sum + getDocumentLineGrossTotalBs(line), 0);
    return `
        <tr class="rc-duration-day-row">
          <td colspan="8">${escapeHtml(dayLabel)}${escapeHtml(dateLabel)} - Subtotal ${formatBs(subtotal)}</td>
        </tr>`;
  };
  const itemRows = hasDailySchedulePricing
    ? (() => {
      const fallbackDay = scheduleDaysForDocument[0] ?? { id: 'daily-default', label: 'Dia 1', date: contract?.eventDate ?? rental?.eventDate ?? contract?.deliveryDate ?? rental?.rentalDate };
      const grouped = new Map();
      const ensureGroup = (day, index) => {
        const key = String(day?.id ?? `day-${index}`);
        if (!grouped.has(key)) {
          grouped.set(key, { day: { ...day, id: key }, index, lines: [] });
        }
        return grouped.get(key);
      };
      (scheduleDaysForDocument.length > 0 ? scheduleDaysForDocument : [fallbackDay])
        .forEach((day, index) => ensureGroup(day, index));
      documentItems.forEach((line) => {
        const foundIndex = resolveScheduleDayIndexForDocumentLine(line);
        const group = foundIndex >= 0
          ? ensureGroup(scheduleDaysForDocument[foundIndex], foundIndex)
          : ensureGroup(fallbackDay, 0);
        group.lines.push(line);
      });
      return Array.from(grouped.values())
        .filter((group) => group.lines.length > 0)
        .sort((a, b) => a.index - b.index)
        .map((group) => `${renderScheduleDayHeader(group.day, group.index, group.lines)}${group.lines.map((line) => renderContractItemRow(line)).join('')}`)
        .join('');
    })()
    : hasDurationPricing
    ? durationDayBreakdown.map((dayInfo) => `
        <tr class="rc-duration-day-row">
          <td colspan="8">Dia ${dayInfo.day} - ${dayInfo.percent}%</td>
        </tr>
        ${documentItems.map((line) => renderContractItemRow(line, dayInfo.multiplier)).join('')}`).join('')
    : documentItems.map((line) => renderContractItemRow(line)).join('');
  const contractServices = normalizeContractServices(contract?.services ?? rental?.services);
  const servicesSubtotalBs = Number(
    contract?.totals?.servicesSubtotalBs
      ?? rental?.totals?.servicesSubtotalBs
      ?? contractServices.reduce((sum, service) => sum + Number(service.lineTotalBs ?? 0), 0),
  );
  const computedDocumentItemsSubtotalBs = hasDurationPricing
    ? durationDayBreakdown.reduce((sum, dayInfo) => (
      sum + documentItems.reduce((lineSum, line) => lineSum + getDocumentLineTotalBs(line, dayInfo.multiplier), 0)
    ), 0)
    : documentItems.reduce((sum, line) => sum + getDocumentLineTotalBs(line), 0);
  const documentItemsSubtotalBs = Math.max(
    0,
    computedDocumentItemsSubtotalBs,
    hasDurationPricing
      ? Number(
        pricingPlan?.chargeableSubtotalBs
          ?? durationDayBreakdown.reduce((sum, dayInfo) => sum + Number(dayInfo.totalBs ?? 0), 0),
      )
      : Number(
        contract?.totals?.itemsSubtotalBs
          ?? rental?.totals?.itemsSubtotalBs
          ?? Number(subtotalBs ?? 0) - servicesSubtotalBs,
      ),
  );
  const itemDiscountsBs = Math.max(
    0,
    Number(
      contract?.totals?.itemDiscountsBs
        ?? rental?.totals?.itemDiscountsBs
        ?? documentItems.reduce((sum, line) => sum + Number(line.discountBs ?? 0), 0),
    ),
  );
  const documentItemsGrossSubtotalBs = Math.max(
    documentItemsSubtotalBs + itemDiscountsBs,
    Number(contract?.totals?.itemsGrossSubtotalBs ?? rental?.totals?.itemsGrossSubtotalBs ?? 0),
  );
  const computedContractTotalBs = Number(Math.max(
    0,
    documentItemsSubtotalBs + servicesSubtotalBs - Number(discountBs ?? 0) + deliveryFeeBs,
  ).toFixed(2));
  const printedTotalBs = Math.max(Number(totalBs ?? 0), computedContractTotalBs);
  const printedManagedBs = printedTotalBs + Math.max(0, Number(guaranteeBs ?? 0));
  const printedPendingBs = Math.max(
    0,
    printedTotalBs - Math.max(0, Number(paidBs ?? 0)) - Math.max(0, Number(prepaidAppliedBs ?? 0))
      + (isGuaranteeValidated ? 0 : Math.max(0, Number(guaranteeBs ?? 0))),
  );
  const serviceRows = contractServices
    .map((service) => {
      contractRowNumber += 1;
      return `
        <tr>
          <td class="rc-row-index">${contractRowNumber}</td>
          <td>
            <span class="rc-item-name">SERVICIO: ${escapeHtml(service.name)}</span>
            ${service.detail ? `<span class="rc-item-meta">${escapeHtml(service.detail)}</span>` : ''}
          </td>
          <td class="num">${service.quantity}</td>
          <td class="num">${formatBs(service.unitPriceBs)}</td>
          <td class="num">${formatBs(service.lineTotalBs)}</td>
          <td class="check"></td>
          <td class="check"></td>
          <td><span class="rc-observation-line"></span></td>
        </tr>`;
    })
    .join('');
  const realItemCount = documentItems.length + contractServices.length;
  const usesDailySchedulePages = hasDailySchedulePricing && scheduleDaysForDocument.length > 1;
  const usesMultipageContract = usesDailySchedulePages || realItemCount >= 15;
  const manualRowCount = realItemCount <= 8 ? 0 : realItemCount <= 13 ? 1 : 2;
  const rows = `${itemRows}${serviceRows}`;
  const contractTableCols = `
          <colgroup>
            <col style="width: 4.5%;" />
            <col style="width: 33%;" />
            <col style="width: 7%;" />
            <col style="width: 11%;" />
            <col style="width: 11%;" />
            <col style="width: 6.5%;" />
            <col style="width: 6.5%;" />
            <col style="width: 20.5%;" />
          </colgroup>`;
  const manualRows = Array.from({ length: manualRowCount }, () => `
        <tr class="rc-manual-row">
          <td class="rc-row-index"></td>
          <td><span class="rc-manual-write-line"></span></td>
          <td class="num"><span class="rc-manual-write-line"></span></td>
          <td class="num"><span class="rc-manual-write-line"></span></td>
          <td class="num"><span class="rc-manual-write-line"></span></td>
          <td class="check"></td>
          <td class="check"></td>
          <td></td>
        </tr>`).join('');
  const manualBlockHtml = manualRows
    ? `<section class="rc-manual-block">
          <table class="rc-table rc-manual-table">
            ${contractTableCols}
            <tbody>${manualRows}</tbody>
          </table>
        </section>`
    : '';
  const renderContractItemsTable = (bodyRows) => `
        <table class="rc-table">
          ${contractTableCols}
          <thead>
            <tr><th class="rc-row-index">N.</th><th>Descripcion</th><th class="num">Cant.</th><th class="num">Precio unit.</th><th class="num">Subtotal</th><th class="check">Entregado</th><th class="check">Recogido</th><th>Faltantes</th></tr>
          </thead>
          <tbody>${bodyRows || '<tr><td colspan="8">Sin items registrados</td></tr>'}</tbody>
        </table>`;
  contractRowNumber = 0;
  const dailyScheduleGroupsForPrint = hasDailySchedulePricing
    ? (() => {
      const fallbackDay = scheduleDaysForDocument[0] ?? { id: 'daily-default', label: 'Dia 1', date: contract?.eventDate ?? rental?.eventDate ?? contract?.deliveryDate ?? rental?.rentalDate };
      const grouped = new Map();
      const ensureGroup = (day, index) => {
        const key = String(day?.id ?? `day-${index}`);
        if (!grouped.has(key)) {
          grouped.set(key, { day: { ...day, id: key }, index, lines: [] });
        }
        return grouped.get(key);
      };
      (scheduleDaysForDocument.length > 0 ? scheduleDaysForDocument : [fallbackDay])
        .forEach((day, index) => ensureGroup(day, index));
      documentItems.forEach((line) => {
        const foundIndex = resolveScheduleDayIndexForDocumentLine(line);
        const group = foundIndex >= 0
          ? ensureGroup(scheduleDaysForDocument[foundIndex], foundIndex)
          : ensureGroup(fallbackDay, 0);
        group.lines.push(line);
      });
      return Array.from(grouped.values())
        .filter((group) => group.lines.length > 0)
        .sort((a, b) => a.index - b.index);
    })()
    : [];
  // Todos los dias comparten una sola tabla. El navegador pagina por espacio
  // disponible, repite el encabezado y evita desperdiciar una hoja por cada dia.
  const itemTablesHtml = renderContractItemsTable(rows);

  const observations = contract?.observations || rental?.observations || 'Sin observaciones registradas.';
  const itemCount = realItemCount + manualRowCount;
  const densityClass = itemCount >= 7 ? 'is-dense' : '';
  const multipageClass = usesMultipageContract ? 'is-multipage' : '';
  const durationFinancialItemsHtml = hasDurationPricing
    ? durationDayBreakdown.map((dayInfo) => `
            <div class="rc-financial-item transport"><span>Dia ${dayInfo.day} (${dayInfo.percent}%)</span><strong>${formatBs(dayInfo.totalBs)}</strong></div>`).join('')
    : '';
  const dailyScheduleFinancialItemsHtml = hasDailySchedulePricing
    ? dailyScheduleGroupsForPrint.map((group) => {
      const dayLabel = String(group.day?.label ?? '').trim() || `Dia ${group.index + 1}`;
      const dayLines = group.lines ?? [];
      const daySubtotalBs = dayLines.reduce((sum, line) => sum + getDocumentLineTotalBs(line), 0);
      return `
            <div class="rc-financial-item transport"><span>${escapeHtml(dayLabel)}</span><strong>${formatBs(daySubtotalBs)}</strong></div>`;
    }).join('')
    : '';
  const financialSummaryHtml = `
          <div class="rc-financial-summary">
            ${durationFinancialItemsHtml}
            ${dailyScheduleFinancialItemsHtml}
            <div class="rc-financial-item"><span>Items</span><strong>${formatBs(documentItemsGrossSubtotalBs)}</strong></div>
            ${itemDiscountsBs > 0 ? `<div class="rc-financial-item"><span>Descuento items</span><strong>- ${formatBs(itemDiscountsBs)}</strong></div>` : ''}
            ${itemDiscountsBs > 0 ? `<div class="rc-financial-item"><span>Items neto</span><strong>${formatBs(documentItemsSubtotalBs)}</strong></div>` : ''}
            <div class="rc-financial-item"><span>Servicio</span><strong>${formatBs(servicesSubtotalBs)}</strong></div>
            <div class="rc-financial-item transport"><span>Transporte</span><strong>${formatBs(deliveryFeeBs)}</strong></div>
            ${hasManualDiscount ? `<div class="rc-financial-item"><span>Descuento</span><strong>- ${formatBs(discountBs)}</strong></div>` : ''}
            <div class="rc-financial-item guarantee"><span>Garantia ${isGuaranteeValidated ? 'pagada' : 'debe'}</span><strong>${formatBs(guaranteeBs)}</strong></div>
            ${Number(prepaidAppliedBs ?? 0) > 0 ? `<div class="rc-financial-item"><span>Prepago</span><strong>${formatBs(prepaidAppliedBs)}</strong></div>` : ''}
            <div class="rc-financial-item"><span>Pagado</span><strong>${formatBs(paidBs)}</strong></div>
            <div class="rc-financial-item"><span>A cobrar</span><strong>${formatBs(printedPendingBs)}</strong></div>
            <div class="rc-financial-item manual"><span>A cuenta</span><strong>&nbsp;</strong></div>
            <div class="rc-financial-item manual"><span>Ajuste / nuevo monto</span><strong>&nbsp;</strong></div>
            <div class="rc-financial-item total"><span>Total contrato</span><strong>${formatBs(printedManagedBs)}</strong></div>
            <div class="rc-financial-item manual"><span>Reposicion</span><strong>&nbsp;</strong></div>
            <div class="rc-financial-item manual"><span>Devolucion final</span><strong>&nbsp;</strong></div>
          </div>`;
  const deliveryDate = formatDocumentScheduleDate(deliveryOut?.scheduledDate ?? contract?.deliveryDate ?? rental.rentalDate);
  const deliveryStart = deliveryOut?.windowStart ?? contract?.deliveryWindowStart ?? '-';
  const deliveryEnd = deliveryOut?.windowEnd ?? contract?.deliveryWindowEnd ?? '-';
  const pickupDate = formatDocumentScheduleDate(deliveryBack?.scheduledDate ?? contract?.pickupDate ?? rental.dueDate);
  const pickupStart = deliveryBack?.windowStart ?? contract?.pickupWindowStart ?? '-';
  const pickupEnd = deliveryBack?.windowEnd ?? contract?.pickupWindowEnd ?? '-';
  const deliveryTimeMode = contract?.deliveryTimeMode ?? rental?.deliveryTimeMode;
  const pickupTimeMode = contract?.pickupTimeMode ?? rental?.pickupTimeMode;
  const deliveryTimeLabel = deliveryTimeMode === 'coordinate' ? '' : `${deliveryStart} - ${deliveryEnd}`;
  const pickupTimeLabel = pickupTimeMode === 'coordinate' ? '' : `${pickupStart} - ${pickupEnd}`;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(documentTitle)}</title>
    <style>${getReferenceContractStyles()}</style>
  </head>
  <body>
    <main class="rc-sheet ${densityClass} ${multipageClass}">
      <header class="rc-top">
        <div class="rc-logo"><img src="/imagenes/logo_el_copetin_redisenado.png" alt="El Copetin" /></div>
        <div class="rc-code">
          <div class="rc-number"><strong>${escapeHtml(mainCode)}</strong></div>
          <div class="rc-code-item rc-date"><span><small>Fecha de creacion</small><b>${escapeHtml(issuedAt)}</b></span></div>
          <div class="rc-code-item rc-event-date"><span><small>Fecha del evento</small><b>${escapeHtml(eventLongDate)}</b></span></div>
          <div class="rc-code-item rc-responsible-date"><span><small>Responsable</small><b>${escapeHtml(responsibleName)}</b></span></div>
        </div>
      </header>

      <section class="rc-title">
        <h1>CONTRATO DE ALQUILER</h1>
        <i></i>
      </section>

      <section class="rc-upper rc-operational">
        <h2 class="rc-operational-title">Datos del cliente y cronograma</h2>
        <div class="rc-operational-grid">
          <div class="rc-info-list">
            <div class="rc-info-line is-wide"><small>Cliente</small><strong>${escapeHtml(documentCustomerName)}</strong></div>
            <div class="rc-info-line is-wide"><small>Telefono</small><strong>${escapeHtml(documentCustomerPhones.length ? documentCustomerPhones.join(' / ') : '-')}</strong></div>
            <div class="rc-info-line"><small>CI</small><strong>${escapeHtml(documentCustomerCi || '-')}</strong></div>
            <div class="rc-info-line"><small>Evento</small><strong>${escapeHtml(contract?.eventType ?? rental.eventType ?? 'General')}</strong></div>
          </div>
          <div class="rc-timeline">
            <div class="rc-timeline-row">
              <span class="rc-timeline-kind"><small>${isCustomerPickup ? 'Alistamiento' : 'Entrega'}</small><strong>${isCustomerPickup ? 'Para recojo' : 'Programada'}</strong></span>
              <span><small>Fecha</small><strong>${escapeHtml(deliveryDate)}</strong></span>
              <span><small>Horario</small><strong>${escapeHtml(deliveryTimeLabel)}</strong></span>
            </div>
            <div class="rc-timeline-row">
              <span class="rc-timeline-kind"><small>${isCustomerPickup ? 'Devolucion' : 'Recojo'}</small><strong>${isCustomerPickup ? 'Por cliente' : 'Programado'}</strong></span>
              <span><small>Fecha</small><strong>${escapeHtml(pickupDate)}</strong></span>
              <span><small>Horario</small><strong>${escapeHtml(pickupTimeLabel)}</strong></span>
            </div>
            <div class="rc-place-line"><small>Direccion</small><strong>${escapeHtml(operationalPlaceLabel)}</strong></div>
          </div>
        </div>
        <div class="rc-sign-line">
          <span class="rc-sign-fields"><b class="rc-sign-field">Entregado por:<i></i></b><b class="rc-sign-field">Recogido por:<i></i></b></span>
        </div>
      </section>

      <section class="rc-items">
        <h2 class="rc-block-title">Detalle de items contratados</h2>
        ${itemTablesHtml}
        ${manualBlockHtml}
        <section class="rc-continuation-head">
          <div>
            <h2>Resumen y cierre del contrato</h2>
            <p>Totales, observaciones, control de garantia y conformidad</p>
          </div>
          <strong>N&deg; ${escapeHtml(mainCode)}</strong>
        </section>
      </section>

      <section class="rc-closeout">
        <div class="rc-closeout-writing">
          <section class="rc-bottom">
            <div class="rc-observations">
              <h3 class="rc-bottom-title">Observaciones</h3>
              <strong>Observaciones:</strong>
              <p>${escapeHtml(observations)}</p>
            </div>
            <div class="rc-guarantee-control">
              <h3 class="rc-bottom-title">Control de garantia</h3>
              <div class="rc-change-lines">
                <span class="rc-change-line"></span>
                <span class="rc-change-line"></span>
                <span class="rc-change-line"></span>
              </div>
            </div>
          </section>

          <section class="rc-client-materials">
            <div class="rc-material-grid">
              <div class="rc-material-box">
                <h4>Material dejado al cliente</h4>
                <div class="rc-material-lines"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
              </div>
              <div class="rc-material-box">
                <h4>Material que falta entregar al cliente</h4>
                <div class="rc-material-lines"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
              </div>
            </div>
          </section>
        </div>

        <section class="rc-financial-block">
          ${financialSummaryHtml}
        </section>
      </section>

      <div class="rc-page-bottom">
        <section class="rc-terms-section">
          <div class="rc-terms-head">
            <h2 class="rc-block-title">Condiciones del servicio</h2>
            <section class="rc-signatures">
              <div class="rc-signature"><div class="rc-signature-line"><strong>Cliente - recibe conforme</strong><span>${escapeHtml(rental.customerName)} | Entrega revisada</span></div></div>
              <div class="rc-signature"><div class="rc-signature-line"><strong>Cliente - devuelve conforme</strong><span>${escapeHtml(rental.customerName)} | Devolucion revisada</span></div></div>
            </section>
          </div>
          <div class="rc-terms">
            <ol class="rc-terms-list">
              <li><b>1</b><span>La reserva queda sujeta a disponibilidad, aprobacion y condiciones de pago acordadas.</span></li>
              <li><b>2</b><span>Los faltantes, roturas o danos se liquidaran segun la revision de devolucion.</span></li>
              <li><b>3</b><span>Los cambios de direccion, horario o cantidades deben confirmarse antes de la preparacion logistica.</span></li>
              <li><b>4</b><span>${escapeHtml(cancellationClause)}</span></li>
            </ol>
          </div>
        </section>

        <footer class="rc-footer">
          <span>${escapeHtml(company.address || '-')}</span>
          <strong>${escapeHtml(company.email || '-')}</strong>
          <span>${escapeHtml([company.phone, '67402818'].filter(Boolean).join(' / ') || '-')}</span>
        </footer>
      </div>
    </main>
  </body>
</html>`;
};

const buildInventoryOrderHtml = ({ rental, deliveries, settings }) => {
  const deliveryOut = deliveries[0] ?? null;
  const company = getDocumentCompany(settings);
  const rows = (rental.items ?? [])
    .map(
      (line) => `
        <tr>
          <td>${escapeHtml(line.itemName)}</td>
          <td class="number">${line.quantity}</td>
          <td class="number">${line.quantity}</td>
          <td><div class="check-cell"></div></td>
          <td><div class="check-cell"></div></td>
        </tr>`,
    )
    .join('');

  return buildDocumentShell({
    title: 'Orden Operativa de Inventario',
    subtitle: `Orden ${rental.orderCode ?? rental.id} | Cliente ${rental.customerName}`,
    documentLabel: 'Inventario',
    documentCode: rental.orderCode ?? rental.id,
    status: deliveryOut?.status === 'en_ruta' ? 'Prioridad alta' : 'Programada',
    company,
    children: `
      <section class="section">
        <h2 class="section-title">Datos de preparacion</h2>
        <div class="info-grid">
          <div class="info-item"><strong>Fecha de alistamiento</strong><span>${escapeHtml(formatDocumentDate(deliveryOut?.scheduledDate ?? rental.rentalDate))}</span></div>
          <div class="info-item"><strong>Ventana operativa</strong><span>${escapeHtml(deliveryOut ? `${deliveryOut.windowStart} - ${deliveryOut.windowEnd}` : '-')}</span></div>
          <div class="info-item"><strong>Destino</strong><span>${escapeHtml(deliveryOut?.address ?? rental.eventAddress ?? '-')}</span></div>
          <div class="info-item"><strong>Estado de inventario</strong><span>${escapeHtml(rental.operational?.inventoryStatus ?? 'pendiente')}</span></div>
          <div class="info-item"><strong>Preparado por</strong><span>____________________________</span></div>
          <div class="info-item"><strong>Validado por</strong><span>____________________________</span></div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Checklist de alistamiento</h2>
        <table class="doc-table">
          <thead>
            <tr><th>Item</th><th class="number">Cantidad</th><th class="number">A alistar</th><th>Revisado</th><th>Cargado</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5">Sin items registrados</td></tr>'}</tbody>
        </table>
      </section>

      <section class="section">
        <h2 class="section-title">Control de salida</h2>
        <div class="info-grid">
          <div class="info-item"><strong>Hora fin de preparacion</strong><span>____ : ____</span></div>
          <div class="info-item"><strong>Estado general</strong><span>Completo / Observado</span></div>
          <div class="info-item"><strong>Observaciones de almacen</strong><span>${escapeHtml(rental.operational?.inventoryNote || 'Sin observaciones registradas.')}</span></div>
          <div class="info-item"><strong>Precintos / bultos</strong><span>____________________________</span></div>
        </div>
      </section>

      <div class="signature-grid">
        <div class="signature-box">Almacen</div>
        <div class="signature-box">Supervisor</div>
        <div class="signature-box">Transporte</div>
      </div>
    `,
  });
};

export const buildWeeklyInventoryHtml = ({
  rentals,
  contracts,
  deliveries,
  items,
  settings,
  weekStart,
  weekEnd,
  format = 'standard',
  targetRentalId = '',
  targetOrderCode = '',
  targetContractCode = '',
}) => {
  const company = getDocumentCompany(settings);
  const contractById = new Map((contracts ?? []).map((contract) => [String(contract.id), contract]));
  const contractByOrderCode = new Map(
    (contracts ?? [])
      .filter((contract) => String(contract?.orderCode ?? '').trim())
      .map((contract) => [String(contract.orderCode).trim(), contract]),
  );
  const contractByCode = new Map(
    (contracts ?? [])
      .filter((contract) => String(contract?.contractCode ?? '').trim())
      .map((contract) => [String(contract.contractCode).trim(), contract]),
  );
  const itemById = new Map((items ?? []).map((item) => [String(item.id), item]));
  const deliveryByRental = new Map();
  (deliveries ?? []).forEach((delivery) => {
    const rentalId = String(delivery?.rentalId ?? '').trim();
    if (!rentalId) return;
    const list = deliveryByRental.get(rentalId) ?? [];
    list.push(delivery);
    deliveryByRental.set(rentalId, list);
  });
  const dateInWeek = (value) => {
    const key = toDateKey(value);
    return Boolean(key && key >= weekStart && key <= weekEnd);
  };
  const formatWindow = (date, start, end) => (
    dateInWeek(date)
      ? `${format === 'individual' ? formatDocumentLongDate(date) : formatDocumentDate(date)} | ${String(start || '--:--')} - ${String(end || '--:--')}`
      : 'Fuera de esta semana'
  );
  const formatOperationDate = (value) => escapeHtml(formatDocumentDate(value));
  const getWeekOperations = (deliveryDate, pickupDate) => {
    const operations = [];
    if (dateInWeek(deliveryDate)) {
      operations.push({ type: 'entrega', label: `ENTREGA ${formatOperationDate(deliveryDate)}` });
    }
    if (dateInWeek(pickupDate)) {
      operations.push({ type: 'recojo', label: `RECOJO ${formatOperationDate(pickupDate)}` });
    }
    return operations;
  };
  const getOperationSummary = (operations) => {
    if (!operations?.length) return 'Fuera de semana';
    return operations.map((operation) => operation.label).join(' + ');
  };
  const getWeeklyDedupeKey = ({ rental, contract }) => {
    const contractCode = String(contract?.contractCode ?? rental.contractCode ?? '').trim();
    if (contractCode) return `contract-code:${contractCode}`;
    const contractKey = String(contract?.id ?? rental.contractId ?? '').trim();
    if (contractKey) return `contract:${contractKey}`;
    return `rental:${rental.id ?? rental.orderCode ?? `${rental.customerName ?? ''}-${rental.rentalDate ?? ''}-${rental.dueDate ?? ''}`}`;
  };
  const mergeOperations = (first = [], second = []) => {
    const byType = new Map();
    [...first, ...second].forEach((operation) => {
      if (!operation?.type) return;
      byType.set(operation.type, operation);
    });
    return [...byType.values()].sort((a, b) => (a.type === 'entrega' ? -1 : 1) - (b.type === 'entrega' ? -1 : 1));
  };
  const isNewerRental = (candidate, current) => {
    const candidateTime = new Date(candidate?.updatedAt ?? candidate?.createdAt ?? 0).getTime();
    const currentTime = new Date(current?.updatedAt ?? current?.createdAt ?? 0).getTime();
    return Number.isFinite(candidateTime) && candidateTime > (Number.isFinite(currentTime) ? currentTime : 0);
  };
  const weeklyOrderEntries = (rentals ?? [])
    .filter((rental) => !rental.deletedAt && rental.status !== 'cancelled')
    .map((rental) => {
      const contract = contractById.get(String(rental.contractId ?? ''))
        ?? contractByOrderCode.get(String(rental.orderCode ?? '').trim())
        ?? contractByCode.get(String(rental.contractCode ?? '').trim())
        ?? null;
      const linkedDeliveries = (deliveryByRental.get(String(rental.id)) ?? []).slice();
      const deliveryOut = linkedDeliveries.find((entry) => !isPickupDeliveryRecord(entry)) ?? linkedDeliveries[0] ?? null;
      const deliveryBack = linkedDeliveries.find((entry) => isPickupDeliveryRecord(entry)) ?? linkedDeliveries[1] ?? null;
      const deliveryDate = contract?.deliveryDate ?? deliveryOut?.scheduledDate ?? rental.rentalDate;
      const pickupDate = contract?.pickupDate ?? deliveryBack?.scheduledDate ?? rental.dueDate;
      const operations = getWeekOperations(deliveryDate, pickupDate);
      return {
        rental,
        contract,
        deliveryOut,
        deliveryBack,
        deliveryDate,
        pickupDate,
        operations,
        operationSummary: getOperationSummary(operations),
        matchesWeek: operations.length > 0,
      };
    })
    .filter((entry) => entry.matchesWeek);
  const weeklyOrdersByKey = new Map();
  weeklyOrderEntries.forEach((entry) => {
    const key = getWeeklyDedupeKey(entry);
    const existing = weeklyOrdersByKey.get(key);
    if (!existing) {
      weeklyOrdersByKey.set(key, entry);
      return;
    }
    const mergedOperations = mergeOperations(existing.operations, entry.operations);
    if (isNewerRental(entry.rental, existing.rental)) {
      weeklyOrdersByKey.set(key, {
        ...entry,
        operations: mergedOperations,
        operationSummary: getOperationSummary(mergedOperations),
      });
      return;
    }
    weeklyOrdersByKey.set(key, {
      ...existing,
      operations: mergedOperations,
      operationSummary: getOperationSummary(mergedOperations),
    });
  });
  const matchesTargetOrder = (entry) => {
    if (format !== 'individual') return true;
    const rentalId = String(entry.rental?.id ?? '').trim();
    const orderCode = String(entry.rental?.orderCode ?? '').trim();
    const contractCode = String(entry.contract?.contractCode ?? entry.rental?.contractCode ?? '').trim();
    return Boolean(
      (targetRentalId && rentalId === targetRentalId)
        || (targetOrderCode && orderCode === targetOrderCode)
        || (targetContractCode && contractCode === targetContractCode),
    );
  };
  const weeklyOrders = [...weeklyOrdersByKey.values()]
    .filter(matchesTargetOrder)
    .sort((a, b) => {
      const firstA = [a.deliveryDate, a.pickupDate].filter(dateInWeek).sort()[0] ?? '';
      const firstB = [b.deliveryDate, b.pickupDate].filter(dateInWeek).sort()[0] ?? '';
      return firstA.localeCompare(firstB) || String(a.rental.orderCode ?? '').localeCompare(String(b.rental.orderCode ?? ''));
    });

  const getInventoryGroup = (line) => {
    const catalogItem = itemById.get(String(line?.itemId ?? '')) ?? null;
    const area = resolveInventoryArea(catalogItem ?? line);
    if (area === 'vajilla') return { id: 'vajilla', label: 'Vajilla', order: 1 };
    if (area === 'manteleria') return { id: 'manteleria', label: 'Mantelería', order: 2 };
    return { id: 'mobiliario', label: 'Mobiliario', order: 3 };
  };
  const getInventoryLineProductKey = (line) => {
    const itemId = String(line?.itemId ?? '').trim();
    if (itemId) return `id:${itemId}`;
    return `name:${String(line?.itemName ?? line?.name ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()}`;
  };
  const pushUniqueText = (list, value) => {
    const normalized = String(value ?? '').trim();
    if (normalized && !list.includes(normalized)) list.push(normalized);
  };
  const aggregateInventoryLines = (lines, supplierSupportByItem = new Map()) => {
    const aggregated = new Map();
    (lines ?? []).forEach((line, lineIndex) => {
      const group = getInventoryGroup(line);
      const key = `${group.id}:${getInventoryLineProductKey(line)}`;
      const supplierSupportLines = supplierSupportByItem.get(String(line.lineKey ?? '').trim())
        ?? supplierSupportByItem.get(String(line.itemId ?? '').trim());
      const fulfillmentBreakdown = buildFulfillmentBreakdown(line, supplierSupportLines);
      const supplierSupportLabel = fulfillmentBreakdown.label || formatSupplierSupportLabel(supplierSupportLines);
      const itemObservation = String(line?.observation ?? line?.observations ?? line?.note ?? '').trim();
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          ...line,
          quantity: 0,
          _inventoryDisplayQty: 0,
          _inventoryGroup: group,
          _inventorySortIndex: lineIndex,
          _inventorySupplierLabels: [],
          _inventoryObservations: [],
          _inventoryMergedCount: 0,
        });
      }
      const nextLine = aggregated.get(key);
      nextLine.quantity = Number(nextLine.quantity ?? 0) + Math.max(0, Math.trunc(Number(line?.quantity ?? 0)));
      nextLine._inventoryDisplayQty += fulfillmentBreakdown.totalQty;
      nextLine._inventoryMergedCount += 1;
      pushUniqueText(nextLine._inventorySupplierLabels, supplierSupportLabel);
      pushUniqueText(nextLine._inventoryObservations, itemObservation);
      if (!nextLine.imageUrl && line?.imageUrl) nextLine.imageUrl = line.imageUrl;
      if (!nextLine.imageDataUrl && line?.imageDataUrl) nextLine.imageDataUrl = line.imageDataUrl;
    });

    return [...aggregated.values()]
      .sort((left, right) => left._inventorySortIndex - right._inventorySortIndex)
      .map((line) => ({
        ...line,
        quantity: line._inventoryDisplayQty,
        _inventorySupportLabel: line._inventorySupplierLabels.join(' / '),
        observation: line._inventoryMergedCount > 1
          ? ''
          : line._inventoryObservations[0] ?? line.observation ?? line.observations ?? line.note ?? '',
      }));
  };
  const groupInventoryLines = (lines, supplierSupportByItem = new Map()) => {
    const groups = new Map([
      ['vajilla', { id: 'vajilla', label: 'Vajilla', order: 1, lines: [] }],
      ['manteleria', { id: 'manteleria', label: 'Mantelería', order: 2, lines: [] }],
      ['mobiliario', { id: 'mobiliario', label: 'Mobiliario', order: 3, lines: [] }],
    ]);
    aggregateInventoryLines(lines, supplierSupportByItem).forEach((line) => {
      const group = line._inventoryGroup ?? getInventoryGroup(line);
      groups.get(group.id)?.lines.push(line);
    });
    return [...groups.values()].filter((group) => group.lines.length > 0).sort((a, b) => a.order - b.order);
  };
  const renderItemRows = (lines, offset = 0, supplierSupportByItem = new Map()) => lines.map((line, index) => {
    const catalogItem = itemById.get(String(line.itemId ?? '')) ?? null;
    const imageDataUrl = resolveDocumentAssetUrl(
      catalogItem?.imageUrl
        ?? catalogItem?.imageDataUrl
        ?? line.imageUrl
        ?? line.imageDataUrl
        ?? '',
    );
    const itemObservation = String(line?.observation ?? line?.observations ?? line?.note ?? '').trim();
    const supplierSupportLines = supplierSupportByItem.get(String(line.lineKey ?? '').trim())
      ?? supplierSupportByItem.get(String(line.itemId ?? '').trim());
    const fulfillmentBreakdown = buildFulfillmentBreakdown(line, supplierSupportLines);
    const supplierSupportLabel = line._inventorySupportLabel
      ?? fulfillmentBreakdown.label
      ?? formatSupplierSupportLabel(supplierSupportLines);
    const displayQuantity = Number.isFinite(Number(line._inventoryDisplayQty))
      ? Math.max(0, Math.trunc(Number(line._inventoryDisplayQty)))
      : fulfillmentBreakdown.totalQty;
    return `
          <tr>
            <td class="wi-index">${offset + index + 1}</td>
            <td class="wi-product">
              <div class="wi-product-content">
                ${imageDataUrl
                  ? `<img src="${escapeHtml(imageDataUrl)}" alt="${escapeHtml(line.itemName)}" />`
                  : '<span class="wi-no-image"></span>'}
                <div class="wi-product-text">
                  <strong>${escapeHtml(line.itemName)}</strong>
                  ${supplierSupportLabel ? `<span class="wi-item-supplier">${escapeHtml(supplierSupportLabel)}</span>` : ''}
                  ${itemObservation ? `<span class="wi-item-observation">${escapeHtml(itemObservation)}</span>` : ''}
                </div>
              </div>
            </td>
            <td class="wi-number"><span class="wi-qty-value">${displayQuantity}</span></td>
            <td class="wi-check"><i></i></td>
            <td class="wi-check"><i></i></td>
            <td class="wi-check"><i></i></td>
            <td class="wi-check"><i></i></td>
            <td class="wi-report"></td>
          </tr>`;
  }).join('');
  const renderGroupedItemRows = (lines, manualRowsPerGroup = 0, supplierSupportByItem = new Map()) => {
    let offset = 0;
    return groupInventoryLines(lines, supplierSupportByItem).map((group) => {
      const rows = renderItemRows(group.lines, offset, supplierSupportByItem);
      offset += group.lines.length;
      return `
          <tr class="wi-category-row">
            <td colspan="8">${escapeHtml(group.label)}</td>
          </tr>
          ${rows}
          ${manualRowsPerGroup > 0 ? renderManualItemRows(manualRowsPerGroup) : ''}`;
    }).join('');
  };
  const renderManualItemRows = (count = 3) => Array.from({ length: count }, () => `
          <tr class="wi-manual-row">
            <td class="wi-index"></td>
            <td class="wi-product"></td>
            <td class="wi-number"></td>
            <td class="wi-check"><i></i></td>
            <td class="wi-check"><i></i></td>
            <td class="wi-check"><i></i></td>
            <td class="wi-check"><i></i></td>
            <td class="wi-report"></td>
          </tr>`).join('');
  const inventoryTableCols = `
            <colgroup>
              <col class="wi-col-index" />
              <col class="wi-col-product" />
              <col class="wi-col-number" />
              <col class="wi-col-check" />
              <col class="wi-col-check" />
              <col class="wi-col-check" />
              <col class="wi-col-check" />
              <col class="wi-col-report" />
            </colgroup>`;
  const tableHead = `
    <thead>
      <tr class="wi-head-groups">
        <th class="wi-index" rowspan="2">N.</th>
        <th rowspan="2">ITEM</th>
        <th class="wi-number" rowspan="2">CANT.</th>
        <th class="wi-group-delivery" colspan="2">ENTREGA</th>
        <th class="wi-group-pickup" colspan="2">RECOJO</th>
        <th class="wi-report-head" rowspan="2">DETALLE / REPORTE</th>
      </tr>
      <tr class="wi-head-checks">
        <th>LISTO</th>
        <th>ENTREGADO<br />CLIENTE</th>
        <th class="wi-pickup-start">RECOGIDO</th>
        <th>DESPERFECTO</th>
      </tr>
    </thead>`;
  const orderSections = weeklyOrders.map((entry, orderIndex) => {
    const { rental, contract, deliveryOut, deliveryBack, deliveryDate, pickupDate } = entry;
    const orderItems = rental.items ?? [];
    const supplierSupportByItem = buildSupplierSupportByItem(
      pickFirstSupplierFulfillmentPlan(rental?.supplierFulfillmentPlan, contract?.supplierFulfillmentPlan),
    );
    const splitItems = format !== 'individual' && orderItems.length > 7;
    const firstColumnSize = splitItems ? Math.ceil(orderItems.length / 2) : orderItems.length;
    const manualRows = format === 'individual' ? '' : renderManualItemRows(3);
    const firstRows = `${format === 'individual' ? renderGroupedItemRows(orderItems, 2, supplierSupportByItem) : renderItemRows(orderItems.slice(0, firstColumnSize), 0, supplierSupportByItem)}${splitItems ? '' : manualRows}`;
    const secondRows = splitItems
      ? `${renderItemRows(orderItems.slice(firstColumnSize), firstColumnSize, supplierSupportByItem)}${manualRows}`
      : '';
    const itemTables = `
        <div class="wi-tables ${splitItems ? 'is-split' : ''}">
          <table class="wi-table">
            ${inventoryTableCols}
            ${tableHead}
            <tbody>${firstRows}</tbody>
          </table>
          ${splitItems ? `
          <table class="wi-table">
            ${inventoryTableCols}
            ${tableHead}
            <tbody>${secondRows}</tbody>
          </table>` : ''}
        </div>`;
    const responsible = contract?.responsibles?.[0]?.name
      ?? contract?.createdByName
      ?? rental.createdByName
      ?? 'Sin responsable';
    const address = contract?.address ?? deliveryOut?.address ?? rental.eventAddress ?? '-';
    const deliveryLongDate = formatDocumentLongDate(deliveryDate);
    const contractIdentity = format === 'individual'
      ? ''
      : `<div class="wi-order-number"><span>${orderIndex + 1}</span><div><small>CONTRATO</small><strong>${escapeHtml(contract?.contractCode ?? rental.contractCode ?? rental.orderCode ?? rental.id)}</strong></div></div>`;
    return `
      <section class="wi-order">
        <header class="wi-order-head">
          ${contractIdentity}
          <div class="wi-client"><small>CLIENTE</small><strong>${escapeHtml(rental.customerName)}</strong></div>
          <div><small>RESPONSABLE</small><strong>${escapeHtml(responsible)}</strong></div>
          <div><small>DIRECCION</small><strong>${escapeHtml(address)}</strong></div>
          <div class="wi-ready-date"><small>FECHA DE ENTREGA</small><strong>${escapeHtml(deliveryLongDate)}</strong><span class="wi-ready-check"><i></i>Listo</span></div>
        </header>
        <div class="wi-order-meta">
          <div><small>ENTREGA / SALIDA</small><strong>${escapeHtml(formatWindow(deliveryDate, contract?.deliveryWindowStart ?? deliveryOut?.windowStart, contract?.deliveryWindowEnd ?? deliveryOut?.windowEnd))}</strong></div>
          <div><small>RECOJO / RETORNO</small><strong>${escapeHtml(formatWindow(pickupDate, contract?.pickupWindowStart ?? deliveryBack?.windowStart, contract?.pickupWindowEnd ?? deliveryBack?.windowEnd))}</strong></div>
          <div><small>EVENTO</small><strong>${escapeHtml(contract?.eventType ?? rental.eventType ?? 'General')}</strong></div>
          <div><small>LOGISTICA</small><strong>${escapeHtml((contract?.logisticsMode ?? rental.logisticsMode) === 'recojo' ? 'Recojo por cliente' : 'Envio por equipo')}</strong></div>
        </div>
        ${itemTables}
        <div class="wi-order-foot">
          ${format === 'individual'
            ? '<span>Entregado por: ______________________________</span><span>Recogido por: ______________________________</span>'
            : '<span>Preparado por: ______________________________</span><span>Entregado por: ______________________________</span><span>Recogido y constatado por: ______________________________</span>'}
        </div>
      </section>`;
  }).join('');

  if (format === 'individual') {
    const selectedOrder = weeklyOrders[0] ?? null;
    const individualItemCount = selectedOrder?.rental?.items?.length ?? 0;
    const individualRenderedRowCount = individualItemCount + 6;
    const useFullLetterSheet = individualRenderedRowCount >= 6;
    const individualPageClass = useFullLetterSheet ? 'individual-full' : 'individual-half';
    const documentCode = selectedOrder
      ? selectedOrder.contract?.contractCode ?? selectedOrder.rental?.contractCode ?? selectedOrder.rental?.orderCode ?? ''
      : '';
    const eventDate = selectedOrder?.contract?.eventDate
      ?? selectedOrder?.rental?.eventDate
      ?? selectedOrder?.deliveryDate
      ?? '';
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Inventario individual ${escapeHtml(documentCode)}</title>
    <style>
      @page { margin: 7mm 6mm 8mm; }
      * { box-sizing: border-box; }
      html { background: #f4f4f4; }
      body { margin: 0; padding: 8px 8px 12px; color: #09255a; background: #eef1f6; font: 12px Arial, sans-serif; overflow: auto; }
      .wi-sheet { width: 8.5in; margin: 0 auto; padding: 4.5mm 5.5mm 3.5mm; background: #fff; box-shadow: 0 2mm 8mm rgba(9, 37, 90, .12); }
      .individual-half .wi-sheet { height: 5.5in; overflow: hidden; }
      .individual-full .wi-sheet { min-height: 11in; height: auto; overflow: visible; padding-bottom: 8mm; }
      .wi-header { display: grid; grid-template-columns: minmax(0, 1fr) 42mm 56mm; gap: 4mm; align-items: center; padding-bottom: 2.3mm; border-bottom: .45mm solid #09255a; }
      .wi-brand { display: flex; align-items: center; gap: 3.4mm; }
      .wi-brand-mark { width: 12.5mm; height: 12.5mm; display: grid; place-items: center; border: .7mm solid #ef5000; border-radius: 50%; color: #ef5000; font: 900 20px Arial, sans-serif; }
      .wi-brand h1 { margin: 0; color: #09255a; font: 900 22px Arial, sans-serif; letter-spacing: 0; }
      .wi-brand p { margin: .6mm 0 0; color: #ef5000; font-size: 9.8px; font-weight: 800; text-transform: uppercase; }
      .wi-header-contract { min-width: 0; text-align: center; }
      .wi-header-contract small { display: block; color: #8b3b1c; font-size: 8.8px; font-weight: 900; text-transform: uppercase; }
      .wi-header-contract strong { display: block; margin-top: .5mm; color: #d93600; font-size: 21px; font-weight: 950; line-height: 1; overflow-wrap: anywhere; }
      .wi-period { padding: 2mm 2.4mm; border: .3mm solid #09255a; border-radius: 2mm; text-align: center; }
      .wi-period small, .wi-order small, .wi-order-meta small { display: block; color: #09255a; font-size: 8.4px; font-weight: 900; letter-spacing: 0; text-transform: uppercase; }
      .wi-period strong { display: block; margin-top: .6mm; color: #ef5000; font-size: 12.2px; line-height: 1.15; }
      .wi-intro { display: grid; grid-template-columns: 1fr auto; gap: 4mm; align-items: center; margin: 2.4mm 0; }
      .wi-intro h2 { margin: 0; color: #09255a; font-size: 15.8px; line-height: 1.05; text-transform: uppercase; }
      .wi-intro p { margin: .7mm 0 0; color: #3c4967; font-size: 9.6px; line-height: 1.15; }
      .wi-event-date { min-width: 56mm; padding: 2mm 2.5mm; border: .3mm solid #efb58f; border-radius: 2mm; background: #fff8f3; text-align: center; }
      .wi-event-date small { display: block; color: #9e4b24; font-size: 8.4px; font-weight: 900; text-transform: uppercase; }
      .wi-event-date strong { display: block; margin-top: .6mm; color: #ef5000; font-size: 11.5px; line-height: 1.15; }
      .wi-order { margin-top: 0; border: .32mm solid #09255a; border-radius: 2mm; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
      .individual-full .wi-order { overflow: visible; break-inside: auto; page-break-inside: auto; }
      .wi-order-head { display: grid; grid-template-columns: 54mm 40mm 1fr 37mm; gap: 2mm; align-items: center; padding: 1.8mm 2mm; background: #fbfcff; border-bottom: .28mm solid #09255a; }
      .wi-order-head strong { display: block; margin-top: .35mm; color: #061b48; font-size: 10.8px; line-height: 1.08; text-transform: uppercase; }
      .wi-order-head .wi-client strong { font-size: 13.2px; line-height: 1.08; }
      .wi-order-number { display: flex; align-items: center; gap: 2mm; }
      .wi-order-number.is-individual { display: block; }
      .wi-order-number > span { width: 9.5mm; height: 11mm; display: grid; place-items: center; border-radius: 2mm 2mm 0 0; color: #fff; background: linear-gradient(135deg, #ef5000 0%, #ef5000 62%, #c63d00 63%, #f58b35 100%); font-size: 16px; font-weight: 900; }
      .wi-ready-date strong { color: #ef5000; font-size: 10.2px; line-height: 1.12; }
      .wi-ready-check { display: inline-flex; align-items: center; gap: 1.2mm; margin-top: .8mm; color: #09255a; font-size: 9px; font-weight: 900; text-transform: uppercase; }
      .wi-ready-check i { width: 4.4mm; height: 4.4mm; display: inline-block; border: .28mm solid #09255a; border-radius: .45mm; background: #fff; }
      .wi-order-meta { display: grid; grid-template-columns: 1.28fr 1.18fr .72fr .82fr; gap: 0; padding: 0; border-bottom: .28mm solid #09255a; }
      .wi-order-meta > div { min-height: 9.4mm; padding: 1.2mm 2.1mm 1mm 3.4mm; border-right: .24mm solid #09255a; }
      .wi-order-meta > div:last-child { border-right: 0; }
      .wi-order-meta strong { display: block; margin-top: .35mm; color: #061b48; font-size: 10.2px; line-height: 1.12; }
      .wi-tables { width: 100%; }
      .wi-tables.is-split { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
      .wi-tables.is-split .wi-table:first-child { border-right: .25mm solid #09255a; border-bottom: 0; }
      .wi-table { width: 100%; border-collapse: collapse; border-spacing: 0; table-layout: fixed; }
      .wi-col-index { width: 4%; }
      .wi-col-product { width: 40%; }
      .wi-col-number { width: 9%; }
      .wi-col-check { width: 6%; }
      .wi-col-report { width: 23%; }
      .wi-table { border: 0; outline: 0; }
      .individual-full .wi-table thead { display: table-header-group; }
      .individual-full .wi-table tr { break-inside: avoid; page-break-inside: avoid; }
      .wi-table th { padding: 1.15mm .45mm; border: .26mm solid #09255a; color: #fff; background: #09255a; font-size: 9.8px; line-height: 1.06; text-align: left; vertical-align: middle; overflow-wrap: anywhere; }
      .wi-table .wi-head-groups th { font-size: 11px; text-align: center; }
      .wi-table .wi-head-groups th:nth-child(2) { text-align: left; }
      .wi-table .wi-head-checks th { padding: .85mm .12mm; font-size: 7.4px; line-height: 1.02; text-align: center; }
      .wi-table .wi-group-delivery { background: #123b78; }
      .wi-table .wi-group-pickup { background: #ef5000; }
      .wi-table .wi-pickup-start, .wi-table td:nth-child(6) { border-left-width: .32mm; }
      .wi-table .wi-report-head, .wi-table td:nth-child(8) { border-left-width: .32mm; }
      .wi-table td { height: 9mm; padding: .65mm .75mm; border: .26mm solid #09255a; vertical-align: middle; font-size: 10.8px; font-weight: 800; }
      .wi-table .wi-manual-row td { height: 8.2mm; }
      .wi-table th:nth-child(n+4):nth-child(-n+7), .wi-table td:nth-child(n+4):nth-child(-n+7) { text-align: center; }
      .wi-table th:nth-child(n+4):nth-child(-n+7) { padding-left: .25mm; padding-right: .25mm; overflow-wrap: anywhere; }
      .wi-index { width: 5mm; text-align: center !important; }
      .wi-number { width: 14mm; text-align: left !important; padding-left: 1.8mm !important; font-size: 12px !important; font-weight: 900 !important; }
      .wi-qty-value { display: inline-block; min-width: 8mm; text-align: left; }
      .wi-product { min-width: 0; }
      .wi-product-content { width: 100%; min-width: 0; display: grid; grid-template-columns: 8mm minmax(0, 1fr); gap: 1mm; align-items: center; }
      .wi-product-content img, .wi-no-image { width: 7.2mm; height: 7.2mm; border: .18mm solid #09255a; border-radius: .7mm; object-fit: cover; }
      .wi-no-image { display: block; background: #f6f7fa; }
      .wi-product-text { min-width: 0; display: flex; flex-direction: column; gap: .55mm; }
      .wi-product-content strong { min-width: 0; color: #061b48; font-size: 10.8px; line-height: 1.08; text-transform: uppercase; overflow-wrap: anywhere; }
      .wi-item-supplier { display: block; color: #1d4ed8; font-size: 8.1px; line-height: 1.08; font-weight: 900; text-transform: uppercase; overflow-wrap: anywhere; }
      .wi-item-observation { display: block; color: #0f766e; font-size: 8.2px; line-height: 1.08; font-weight: 900; text-transform: uppercase; overflow-wrap: anywhere; }
      .wi-category-row td { height: 6.8mm !important; padding: 1.05mm 2mm !important; border: .26mm solid #09255a !important; color: #09255a; background: #e8eef8; font-size: 11.8px !important; font-weight: 900 !important; letter-spacing: .25px; text-align: left !important; text-transform: uppercase; }
      .wi-check i { display: inline-block; width: 4.7mm; height: 4.7mm; border: .3mm solid #09255a; border-radius: .35mm; }
      .wi-order-foot { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14mm; align-items: end; min-height: 18mm; padding: 5mm 10mm 4mm; color: #09255a; font-size: 10.2px; font-weight: 800; }
      .wi-empty { padding: 10mm; border: .3mm dashed #efb795; border-radius: 2mm; color: #7b8499; text-align: center; }
      @media print {
        html, body { width: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; background: #fff; }
        body.individual-half { height: auto !important; overflow: visible !important; }
        body.individual-half .wi-sheet { width: auto !important; min-height: 0 !important; height: auto !important; margin: 0 !important; padding: 0 !important; box-shadow: none; page-break-after: auto; break-after: auto; overflow: visible !important; }
        body.individual-full { min-height: 0 !important; height: auto !important; overflow: visible !important; }
        body.individual-full .wi-sheet { width: auto !important; min-height: 0 !important; height: auto !important; margin: 0 !important; padding: 0 !important; box-shadow: none; overflow: visible !important; }
        .wi-sheet, .wi-sheet * { color: #000 !important; text-shadow: none !important; }
        .wi-table th,
        .wi-table .wi-group-delivery,
        .wi-table .wi-group-pickup {
          color: #000 !important;
          background: transparent !important;
          border-color: #000 !important;
        }
        .wi-table td,
        .wi-category-row td,
        .wi-order,
        .wi-order-head,
        .wi-order-meta,
        .wi-order-meta > div,
        .wi-period,
        .wi-event-date,
        .wi-ready-check i,
        .wi-product-content img,
        .wi-no-image {
          border-color: #000 !important;
        }
        .wi-category-row td,
        .wi-order-head,
        .wi-event-date {
          background: transparent !important;
        }
      }
    </style>
  </head>
  <body class="${individualPageClass}">
    <main class="wi-sheet">
      <header class="wi-header">
        <div class="wi-brand"><span class="wi-brand-mark">C</span><div><h1>${escapeHtml(company.name)}</h1><p>Control operativo de inventario</p></div></div>
        <div class="wi-header-contract"><small>Contrato</small><strong>${escapeHtml(documentCode)}</strong></div>
        <div class="wi-period"><small>Contrato creado</small><strong>${escapeHtml(formatDocumentLongDate(selectedOrder?.contract?.createdAt ?? selectedOrder?.rental?.createdAt))}</strong></div>
      </header>
      <section class="wi-intro">
        <div><h2>Hoja de alistamiento, salida y retorno</h2><p>Control individual para una orden operativa.</p></div>
        <div class="wi-event-date"><small>Fecha del evento</small><strong>${escapeHtml(formatDocumentLongDate(eventDate))}</strong></div>
      </section>
      ${orderSections || '<div class="wi-empty">No se encontro la orden seleccionada para esta semana.</div>'}
    </main>
  </body>
</html>`;
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Control semanal de inventario ${escapeHtml(weekStart)}</title>
    <style>
      @page { margin: 6mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #09255a; background: #eef1f6; font: 11.5px Arial, sans-serif; }
      .wi-sheet { width: 100%; max-width: 204mm; min-height: 344mm; margin: 0 auto; padding: 4.5mm; background: #fff; box-shadow: 0 3mm 12mm rgba(9, 37, 90, .12); }
      .wi-header { display: grid; grid-template-columns: 1fr 62mm; gap: 6mm; align-items: center; padding-bottom: 3mm; border-bottom: .45mm solid #09255a; }
      .wi-brand { display: flex; align-items: center; gap: 4.5mm; }
      .wi-brand-mark { width: 15mm; height: 15mm; display: grid; place-items: center; border: .8mm solid #ef5000; border-radius: 50%; color: #ef5000; font: 900 22px Arial, sans-serif; }
      .wi-brand h1 { margin: 0; color: #09255a; font: 900 25px Arial, sans-serif; letter-spacing: 0; }
      .wi-brand p { margin: .8mm 0 0; color: #ef5000; font-size: 10.5px; font-weight: 800; text-transform: uppercase; }
      .wi-period { padding: 3mm 3.5mm; border: .35mm solid #09255a; border-radius: 2.5mm; text-align: center; }
      .wi-period small, .wi-order small, .wi-order-meta small { display: block; color: #09255a; font-size: 8.5px; font-weight: 900; letter-spacing: 0; text-transform: uppercase; }
      .wi-period strong { display: block; margin-top: .8mm; color: #ef5000; font-size: 13px; line-height: 1.18; }
      .wi-intro { display: grid; grid-template-columns: 1fr 44mm; gap: 6mm; align-items: center; margin: 3mm 0 2mm; }
      .wi-intro h2 { margin: 0; color: #09255a; font-size: 18.5px; line-height: 1.08; text-transform: uppercase; }
      .wi-intro p { margin: .8mm 0 0; max-width: 132mm; color: #3c4967; font-size: 11px; line-height: 1.18; }
      .wi-count { display: grid; place-items: center; min-height: 17mm; border-radius: 2.5mm; color: #fff; background: #ef5000; font-size: 10px; font-weight: 900; text-transform: uppercase; }
      .wi-count b { display: block; margin-bottom: -1mm; font-size: 25px; line-height: 1; }
      .wi-order { margin-top: 2mm; border: .25mm solid #d8deeb; border-radius: 2.5mm; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
      .wi-order-head { display: grid; grid-template-columns: 38mm 43mm 43mm 1fr 34mm; gap: 2.2mm; align-items: center; padding: 1.7mm 2.2mm; background: #fbfcff; border-bottom: .25mm solid #d8deeb; }
      .wi-order-head strong { display: block; margin-top: .4mm; color: #061b48; font-size: 11px; line-height: 1.1; text-transform: uppercase; }
      .wi-order-number { display: flex; align-items: center; gap: 2.2mm; }
      .wi-order-number > span { width: 10mm; height: 12.5mm; display: grid; place-items: center; border-radius: 2.2mm 2.2mm 0 0; color: #fff; background: linear-gradient(135deg, #ef5000 0%, #ef5000 62%, #c63d00 63%, #f58b35 100%); font-size: 17px; font-weight: 900; }
      .wi-ready-date strong { color: #ef5000; font-size: 10px; line-height: 1.12; }
      .wi-ready-check { display: inline-flex; align-items: center; gap: 1.2mm; margin-top: .8mm; color: #09255a; font-size: 9px; font-weight: 900; text-transform: uppercase; }
      .wi-ready-check i { width: 4.4mm; height: 4.4mm; display: inline-block; border: .28mm solid #09255a; border-radius: .45mm; background: #fff; }
      .wi-order-meta { display: grid; grid-template-columns: 1.25fr 1.25fr .85fr 1fr; gap: 0; padding: 0; border-bottom: .22mm solid #d8deeb; }
      .wi-order-meta > div { min-height: 10.2mm; padding: 1.45mm 3mm 1.25mm 5.8mm; border-right: .2mm solid #d8deeb; }
      .wi-order-meta > div:last-child { border-right: 0; }
      .wi-order-meta strong { display: block; margin-top: .4mm; color: #061b48; font-size: 10px; line-height: 1.1; }
      .wi-tables { width: 100%; }
      .wi-tables.is-split { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
      .wi-tables.is-split .wi-table:first-child { border-right: .3mm solid #09255a; }
      .wi-table { width: 100%; border: .28mm solid #aeb9cd; border-collapse: collapse; table-layout: fixed; }
      .wi-col-index { width: 4%; }
      .wi-col-product { width: 38%; }
      .wi-col-number { width: 7%; }
      .wi-col-check { width: 6.5%; }
      .wi-col-report { width: 25%; }
      .wi-table th { padding: .85mm .65mm; border-right: .22mm solid #51658b; border-bottom: .22mm solid #51658b; color: #fff; background: #09255a; font-size: 8.1px; line-height: 1.05; text-align: left; vertical-align: middle; }
      .wi-table .wi-head-groups th { font-size: 8.7px; text-align: center; }
      .wi-table .wi-head-groups th:nth-child(2) { text-align: left; }
      .wi-table .wi-head-checks th { padding: .65mm .2mm; font-size: 6.8px; text-align: center; }
      .wi-table .wi-group-delivery { background: #123b78; }
      .wi-table .wi-group-pickup { background: #ef5000; }
      .wi-table .wi-pickup-start, .wi-table td:nth-child(6) { border-left: .35mm solid #09255a; }
      .wi-table .wi-report-head, .wi-table td:nth-child(8) { border-left: .35mm solid #09255a; }
      .wi-table td { height: 6.8mm; padding: .45mm .75mm; border-right: .23mm solid #bac4d6; border-bottom: .23mm solid #bac4d6; vertical-align: middle; font-size: 8.8px; }
      .wi-table tr:last-child td { border-bottom: 0; }
      .wi-table th:nth-child(n+4):nth-child(-n+7), .wi-table td:nth-child(n+4):nth-child(-n+7) { text-align: center; }
      .wi-table th:last-child, .wi-table td:last-child { border-right: 0; }
      .wi-index { width: 6mm; text-align: center !important; }
      .wi-number { width: 11mm; text-align: center !important; }
      .wi-product-content { width: 100%; min-width: 0; display: grid; grid-template-columns: 7.2mm minmax(0, 1fr); gap: 1.1mm; align-items: center; }
      .wi-product img, .wi-no-image { width: 6.5mm; height: 6.5mm; border: .18mm solid #d8deea; border-radius: .8mm; object-fit: cover; }
      .wi-no-image { display: block; background: #f6f7fa; }
      .wi-product-text { min-width: 0; display: flex; flex-direction: column; gap: .35mm; }
      .wi-product strong { color: #061b48; font-size: 8.2px; line-height: 1.08; text-transform: uppercase; overflow-wrap: anywhere; }
      .wi-item-supplier { display: block; color: #1d4ed8; font-size: 6.9px; line-height: 1.05; font-weight: 900; text-transform: uppercase; overflow-wrap: anywhere; }
      .wi-item-observation { display: block; color: #0f766e; font-size: 6.9px; line-height: 1.05; font-weight: 900; text-transform: uppercase; overflow-wrap: anywhere; }
      .wi-check i { display: inline-block; width: 4.2mm; height: 4.2mm; border: .28mm solid #67748c; border-radius: .35mm; }
      .wi-order-foot { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; padding: 1.8mm 4mm; color: #09255a; font-size: 8.6px; }
      .wi-empty-order { padding: 5mm; color: #7b8499; text-align: center; }
      .wi-empty { padding: 20mm; border: .3mm dashed #efb795; border-radius: 2mm; color: #7b8499; text-align: center; }
      .wi-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 3mm; padding: 3.5mm 6mm; color: #fff; background: #09255a; font-size: 10px; }
      @media print {
        body { background: #fff; }
        .wi-sheet { max-width: none; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
        .wi-page::after { content: "Pagina " counter(page); }
        .wi-sheet, .wi-sheet * { color: #000 !important; text-shadow: none !important; }
        .wi-table th,
        .wi-table .wi-group-delivery,
        .wi-table .wi-group-pickup,
        .wi-footer {
          color: #000 !important;
          background: transparent !important;
          border-color: #000 !important;
        }
        .wi-table,
        .wi-table td,
        .wi-category-row td,
        .wi-order,
        .wi-order-head,
        .wi-order-meta,
        .wi-order-meta > div,
        .wi-period,
        .wi-ready-check i,
        .wi-product img,
        .wi-no-image,
        .wi-empty {
          border-color: #000 !important;
        }
      }
    </style>
  </head>
  <body>
    <main class="wi-sheet">
      <header class="wi-header">
        <div class="wi-brand"><span class="wi-brand-mark">C</span><div><h1>${escapeHtml(company.name)}</h1><p>Control operativo de inventario</p></div></div>
        <div class="wi-period"><small>Semana operativa</small><strong>${escapeHtml(`${formatDocumentDate(weekStart)} al ${formatDocumentDate(weekEnd)}`)}</strong></div>
      </header>
      <section class="wi-intro">
        <div><h2>Hoja semanal de alistamiento, salida y retorno</h2><p>Documento unico para controlar las ordenes de servicio con entrega o recojo dentro del periodo.</p></div>
        <div class="wi-count"><b>${weeklyOrders.length}</b> ordenes</div>
      </section>
      ${orderSections || '<div class="wi-empty">No existen contratos con entrega o recojo programados para esta semana.</div>'}
      <footer class="wi-footer"><span>${escapeHtml(company.address)} | ${escapeHtml(company.phone || '')}</span><span class="wi-page"></span></footer>
    </main>
  </body>
</html>`;
};

const getDeliveryStatusLabel = (value) => {
  const normalized = String(value ?? '').replace(/_/g, ' ').trim();
  if (!normalized) return '-';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const buildRouteSheetHtml = ({ rental, deliveries, drivers, vehicles, settings }) => {
  const company = getDocumentCompany(settings);
  const getStopType = (delivery, index) => {
    const note = normalizeText(delivery?.notes);
    if (note.includes('recojo') || note.includes('recog')) return 'Recojo';
    if (index === 0) return 'Entrega';
    if (index === deliveries.length - 1) return 'Recojo';
    return `Parada ${index + 1}`;
  };
  const rows = deliveries
    .map((delivery, index) => {
      const driver = drivers.find((entry) => entry.id === delivery.driverId) ?? null;
      const vehicle = vehicles.find((entry) => entry.id === delivery.vehicleId) ?? null;
      return `
        <tr>
          <td>${escapeHtml(delivery.deliveryCode ?? '-')}</td>
          <td>${escapeHtml(getStopType(delivery, index))}</td>
          <td>${escapeHtml(formatDocumentDate(delivery.scheduledDate))}</td>
          <td>${escapeHtml(`${delivery.windowStart} - ${delivery.windowEnd}`)}</td>
          <td>${escapeHtml(delivery.address ?? '-')}</td>
          <td>${escapeHtml(driver?.fullName ?? 'Sin asignar')}</td>
          <td>${escapeHtml(vehicle?.code ?? 'Sin vehiculo')}</td>
          <td>${escapeHtml(getDeliveryStatusLabel(delivery.status))}</td>
          <td>${escapeHtml(delivery.notes || rental.operational?.transportNote || '-')}</td>
        </tr>`;
    })
    .join('');
  const itemsRows = (rental.items ?? [])
    .map((line) => `
      <tr>
        <td>${escapeHtml(line.itemName ?? '-')}</td>
        <td class="number">${escapeHtml(line.quantity ?? 0)}</td>
        <td>${escapeHtml(line.itemId ?? '-')}</td>
        <td>________________</td>
        <td>________________</td>
      </tr>`)
    .join('');
  const firstDelivery = deliveries[0] ?? null;
  const lastDelivery = deliveries[deliveries.length - 1] ?? null;
  const assignedDrivers = deliveries
    .map((delivery) => drivers.find((entry) => entry.id === delivery.driverId)?.fullName)
    .filter(Boolean);
  const assignedVehicles = deliveries
    .map((delivery) => vehicles.find((entry) => entry.id === delivery.vehicleId)?.code)
    .filter(Boolean);

  return buildDocumentShell({
    title: 'Hoja de Ruta',
    subtitle: `Orden ${rental.orderCode ?? rental.id} | Cliente ${rental.customerName}`,
    documentLabel: 'Ruta',
    documentCode: rental.orderCode ?? rental.id,
    status: deliveries.length > 0 ? 'Despacho programado' : 'Sin ruta',
    company,
    children: `
      <section class="section">
        <h2 class="section-title">Resumen de despacho</h2>
        <div class="route-summary">
          <div><strong>Rutas</strong>${deliveries.length}</div>
          <div><strong>Entrega</strong>${escapeHtml(`${formatDocumentDate(firstDelivery?.scheduledDate)} ${firstDelivery ? `${firstDelivery.windowStart} - ${firstDelivery.windowEnd}` : ''}`)}</div>
          <div><strong>Recojo</strong>${escapeHtml(`${formatDocumentDate(lastDelivery?.scheduledDate)} ${lastDelivery ? `${lastDelivery.windowStart} - ${lastDelivery.windowEnd}` : ''}`)}</div>
          <div><strong>Cliente</strong>${escapeHtml(rental.customerName)}</div>
        </div>
        <div class="info-grid">
          <div class="info-item"><strong>Telefono cliente</strong><span>${escapeHtml(rental.customerPhone)}</span></div>
          <div class="info-item"><strong>Direccion de entrega</strong><span>${escapeHtml(firstDelivery?.address ?? rental.eventAddress ?? '-')}</span></div>
          <div class="info-item"><strong>Direccion de recojo</strong><span>${escapeHtml(lastDelivery?.address ?? firstDelivery?.address ?? rental.eventAddress ?? '-')}</span></div>
          <div class="info-item"><strong>Orden de servicio</strong><span>${escapeHtml(rental.orderCode ?? rental.id)}</span></div>
          <div class="info-item"><strong>Chofer asignado</strong><span>${escapeHtml([...new Set(assignedDrivers)].join(', ') || 'Sin asignar')}</span></div>
          <div class="info-item"><strong>Vehiculo asignado</strong><span>${escapeHtml([...new Set(assignedVehicles)].join(', ') || 'Sin vehiculo')}</span></div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Itinerario operativo: entrega y recojo</h2>
        <table class="doc-table">
          <thead>
            <tr><th>Codigo</th><th>Tipo</th><th>Fecha</th><th>Ventana</th><th>Direccion</th><th>Chofer</th><th>Vehiculo</th><th>Estado</th><th>Notas</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="9">Sin rutas programadas</td></tr>'}</tbody>
        </table>
      </section>

      <section class="section">
        <h2 class="section-title">Items a transportar</h2>
        <table class="doc-table">
          <thead>
            <tr><th>Item</th><th class="number">Cantidad</th><th>Codigo</th><th>Cargado</th><th>Devuelto</th></tr>
          </thead>
          <tbody>${itemsRows || '<tr><td colspan="5">Sin items registrados</td></tr>'}</tbody>
        </table>
      </section>

      <section class="section">
        <h2 class="section-title">Indicaciones para transporte</h2>
        <ol class="terms-list">
          <li>Confirmar carga completa contra la orden de inventario antes de salir de almacen.</li>
          <li>Registrar novedades de acceso, espera, entrega parcial o cambios de responsable en destino.</li>
          <li>Solicitar firma o conformidad del cliente al finalizar entrega y recojo.</li>
        </ol>
      </section>

      <section class="section">
        <h2 class="section-title">Observaciones de ruta</h2>
        <div class="note-box">${escapeHtml(rental.operational?.transportNote || firstDelivery?.notes || 'Sin observaciones registradas.')}</div>
      </section>

      <div class="signature-grid">
        <div class="signature-box">Chofer</div>
        <div class="signature-box">Cliente / receptor</div>
        <div class="signature-box">Control logistico</div>
      </div>
    `,
  });
};

const parseDateRange = (value, endOfDay = false) => {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }
  const [yearText, monthText, dayText] = text.split('-');
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
};

const isInRange = (value, fromDate, toDate) => {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return false;
  }
  if (fromDate && timestamp < fromDate.getTime()) {
    return false;
  }
  if (toDate && timestamp > toDate.getTime()) {
    return false;
  }
  return true;
};

const formatDocNumber = (value, size = 5) => String(Math.max(1, Number(value ?? 1))).padStart(size, '0');

const consumeDocumentCode = (state, fieldPrefix, fieldNext, size = 5) => {
  if (!state.settings) state.settings = {};
  if (!state.settings.numbering) state.settings.numbering = {};
  const numbering = state.settings?.numbering ?? {};
  const prefix = String(numbering[fieldPrefix] ?? '');
  const next = Math.max(1, Math.trunc(Number(numbering[fieldNext] ?? 1)));
  state.settings.numbering[fieldNext] = next + 1;
  return prefix ? `${prefix}${formatDocNumber(next, size)}` : String(next);
};

const parseDocumentNumericPart = (code) => {
  const match = String(code ?? '').trim().match(/(\d+)\s*$/);
  return match ? Math.max(1, Math.trunc(Number(match[1]))) : null;
};

const parseDocumentPrefix = (code) => String(code ?? '').trim().replace(/\d+\s*$/, '');

const normalizeCommercialDocumentCode = (code) => String(code ?? '').trim();

const isActiveRentalRecord = (rental) => rental && !rental.deletedAt && rental.status !== 'cancelled';

const commercialDocumentCodeExists = (state, collectionName, codeField, code, exclude = {}) => {
  const normalizedCode = normalizeCommercialDocumentCode(code);
  if (!normalizedCode) return false;
  const normalizedExcludeId = String(exclude.id ?? '').trim();
  const normalizedExcludeContractId = String(exclude.contractId ?? '').trim();
  const normalizedExcludeRentalId = String(exclude.rentalId ?? '').trim();
  const collectionHasCode = (state[collectionName] ?? []).some((entry) => (
    entry
    && !entry.deletedAt
    && (!normalizedExcludeId || String(entry.id ?? '') !== normalizedExcludeId)
    && normalizeCommercialDocumentCode(entry?.[codeField]) === normalizedCode
  ));
  if (collectionHasCode) return true;

  if (collectionName !== 'contracts' || codeField !== 'contractCode') return false;

  const activeContracts = (state.contracts ?? []).filter((contract) => contract && !contract.deletedAt);
  return (state.rentals ?? []).some((rental) => {
    if (!isActiveRentalRecord(rental)) return false;
    if (normalizedExcludeRentalId && String(rental.id ?? '') === normalizedExcludeRentalId) return false;
    if (normalizedExcludeContractId && String(rental.contractId ?? '') === normalizedExcludeContractId) return false;
    if (normalizeCommercialDocumentCode(rental.contractCode) !== normalizedCode) return false;

    const linkedContract = activeContracts.find((contract) => (
      (rental.contractId && String(contract.id ?? '') === String(rental.contractId))
      || (contract.rentalId && String(contract.rentalId ?? '') === String(rental.id ?? ''))
      || (
        rental.orderCode
        && contract.orderCode
        && String(contract.orderCode).trim() === String(rental.orderCode).trim()
      )
    ));

    // Una orden puede conservar un numero antiguo después de editar su contrato.
    // En ese caso manda el numero actual del contrato y el anterior queda libre.
    if (linkedContract) {
      return normalizeCommercialDocumentCode(linkedContract.contractCode) === normalizedCode;
    }

    // Una orden activa realmente huérfana sigue reservando su numero para evitar duplicados.
    return true;
  });
};

const consumeUniqueCommercialDocumentCode = (state, fieldPrefix, fieldNext, collectionName, codeField, size = 5) => {
  if (!state.settings) state.settings = {};
  if (!state.settings.numbering) state.settings.numbering = {};
  const numbering = state.settings.numbering;
  const prefix = String(numbering[fieldPrefix] ?? '');
  let next = Math.max(1, Math.trunc(Number(numbering[fieldNext] ?? 1)));
  let attempts = 0;

  while (attempts < 100000) {
    const code = prefix ? `${prefix}${formatDocNumber(next, size)}` : String(next);
    if (!commercialDocumentCodeExists(state, collectionName, codeField, code)) {
      numbering[fieldNext] = next + 1;
      return code;
    }
    next += 1;
    attempts += 1;
  }

  throw new Error('No se pudo encontrar un numero disponible para el documento.');
};

const consumeCommercialDocumentCode = (state, payload, fieldPrefix, fieldNext, collectionName, codeField, size = 5) => {
  const codeMode = ['manual', 'current'].includes(payload?.documentCodeMode) ? payload.documentCodeMode : 'auto';
  const manualCode = String(payload?.manualDocumentCode ?? '').trim();
  if (codeMode === 'auto') {
    return consumeUniqueCommercialDocumentCode(state, fieldPrefix, fieldNext, collectionName, codeField, size);
  }
  if (!manualCode) {
    throw new Error('Debes indicar el codigo del libro.');
  }
  const exists = commercialDocumentCodeExists(state, collectionName, codeField, manualCode);
  if (exists) {
    throw new Error(`Ya existe un registro con el codigo ${manualCode}.`);
  }
  if (codeMode === 'current') {
    const numericPart = parseDocumentNumericPart(manualCode);
    if (!numericPart) throw new Error('El codigo actual debe terminar en un numero.');
    if (!state.settings.numbering) state.settings.numbering = {};
    state.settings.numbering[fieldPrefix] = parseDocumentPrefix(manualCode);
    state.settings.numbering[fieldNext] = numericPart + 1;
  }
  return manualCode;
};

const releaseLatestCommercialDocumentCode = (state, code, fieldPrefix, fieldNext) => {
  const numericPart = parseDocumentNumericPart(code);
  if (!numericPart) return;
  if (!state.settings) state.settings = {};
  if (!state.settings.numbering) state.settings.numbering = {};
  const numbering = state.settings.numbering;
  const currentPrefix = String(numbering[fieldPrefix] ?? '');
  const codePrefix = parseDocumentPrefix(code);
  const currentNext = Math.max(1, Math.trunc(Number(numbering[fieldNext] ?? 1)));
  if (currentPrefix === codePrefix && currentNext === numericPart + 1) {
    let next = numericPart;
    while (next > 1) {
      const previousCode = currentPrefix ? `${currentPrefix}${formatDocNumber(next - 1)}` : String(next - 1);
      if (commercialDocumentCodeExists(state, 'contracts', 'contractCode', previousCode)) break;
      next -= 1;
    }
    numbering[fieldNext] = next;
  }
};

const rentalMatchesContract = (rental, contract) => {
  if (!rental || !contract) return false;
  const rentalId = String(rental.id ?? '');
  const rentalContractId = String(rental.contractId ?? '');
  const rentalOrderCode = String(rental.orderCode ?? '');
  const rentalContractCode = String(rental.contractCode ?? '').trim();
  return (
    (contract.rentalId && rentalId === String(contract.rentalId))
    || (contract.id && rentalContractId === String(contract.id))
    || (contract.orderCode && rentalOrderCode === String(contract.orderCode))
    || (contract.contractCode && rentalContractCode === String(contract.contractCode).trim())
  );
};

const isInventoryMovementLinkedToRental = (movement, rental, contract) => {
  const orderCode = String(rental?.orderCode ?? '').trim();
  const rentalId = String(rental?.id ?? '').trim();
  const contractCode = String(contract?.contractCode ?? '').trim();
  const contractId = String(contract?.id ?? '').trim();
  const reference = String(movement?.reference ?? movement?.orderCode ?? movement?.linkedOrderCode ?? '').trim();
  const sourceId = String(movement?.sourceId ?? movement?.rentalId ?? movement?.contractId ?? '').trim();
  const sourceType = String(movement?.sourceType ?? '').trim();
  const text = `${movement?.reason ?? ''} ${movement?.detail ?? ''} ${movement?.observations ?? ''}`.trim();
  return (
    (orderCode && reference === orderCode)
    || (rentalId && sourceId === rentalId)
    || (contractId && sourceId === contractId)
    || (sourceType === 'rental' && rentalId && sourceId === rentalId)
    || (sourceType === 'contract' && contractId && sourceId === contractId)
    || (orderCode && text.includes(orderCode))
    || (contractCode && text.includes(contractCode))
  );
};

const restoreRentalReservedStock = (state, rental, now) => {
  (rental.items ?? []).forEach((line) => {
    const item = state.items.find((entry) => entry.id === line.itemId);
    if (!item || lineControlsStock(line, item) === false) return;
    const reservedQty = Number.isFinite(Number(line.internalReservedQty))
      ? Math.max(0, Math.trunc(Number(line.internalReservedQty)))
      : Math.max(0, Math.trunc(Number(line.quantity ?? 0)));
    if (reservedQty <= 0) return;
    item.availableStock = Math.min(Number(item.totalStock ?? 0), Number(item.availableStock ?? 0) + reservedQty);
    item.updatedAt = now;
  });
};

const cleanupRentalOperationalResidues = (state, rental, contract, now, options = {}) => {
  const { skipReturned = false } = options;
  if (!rental || rental.deletedAt || rental.status === 'cancelled') return false;

  const wasReturned = rental.status === 'returned' || Boolean(rental.returnedAt);
  if (wasReturned && skipReturned) return false;

  // Una orden devuelta ya restituyó el stock al registrar la devolución.
  // Solo las órdenes todavía activas necesitan devolver la reserva al inventario.
  if (!wasReturned) {
    restoreRentalReservedStock(state, rental, now);
  }

  const linkedDeliveryIds = new Set();
  state.deliveries.forEach((delivery) => {
    if (delivery.rentalId === rental.id || delivery.orderCode === rental.orderCode) {
      linkedDeliveryIds.add(String(delivery.id ?? ''));
      delivery.status = 'cancelada';
      delivery.deletedAt = now;
      delivery.updatedAt = now;
    }
  });

  state.transportRoutes.forEach((route) => {
    const hasLinkedStop = Array.isArray(route.stops)
      && route.stops.some((stop) => linkedDeliveryIds.has(String(stop.deliveryId ?? '')));
    if (hasLinkedStop) {
      route.deletedAt = now;
      route.updatedAt = now;
    }
  });

  state.inventoryMovements = (state.inventoryMovements ?? [])
    .filter((movement) => !isInventoryMovementLinkedToRental(movement, rental, contract));

  // Los movimientos económicos, recibos, reportes emitidos y subalquileres
  // se conservan como historial. La eliminación operativa solo quita reservas,
  // estados de inventario/transporte y movimientos Listo/Enviado/Devuelto.

  rental.deletedAt = now;
  rental.status = 'cancelled';
  rental.cancelledAt = rental.cancelledAt ?? now;
  rental.operational = {
    ...(rental.operational ?? {}),
    inventoryStatus: 'anulado',
    transportStatus: rental.logisticsMode === 'recojo' ? 'no_aplica' : 'anulado',
    inventoryNote: '',
    transportNote: '',
  };
  rental.updatedAt = now;
  return true;
};


const upsertSnapshotRecords = (target, records = []) => {
  const source = Array.isArray(records) ? records : [];
  source.forEach((record) => {
    const id = String(record?.id ?? '').trim();
    if (!id) return;
    const index = target.findIndex((entry) => String(entry?.id ?? '').trim() === id);
    if (index >= 0) target[index] = deepClone(record);
    else target.push(deepClone(record));
  });
};

const buildContractDeletionSnapshot = (state, contract, now) => {
  const contractSnapshot = deepClone({
    ...contract,
    deletionSnapshot: undefined,
  });
  const linkedRentals = (state.rentals ?? []).filter((rental) => rentalMatchesContract(rental, contract));
  const rentalIds = new Set(linkedRentals.map((rental) => String(rental.id ?? '')).filter(Boolean));
  const orderCodes = new Set(linkedRentals.map((rental) => String(rental.orderCode ?? '')).filter(Boolean));
  const linkedDeliveryIds = new Set(
    (state.deliveries ?? [])
      .filter((delivery) => rentalIds.has(String(delivery?.rentalId ?? '')) || orderCodes.has(String(delivery?.orderCode ?? '')))
      .map((delivery) => String(delivery.id ?? ''))
      .filter(Boolean),
  );

  return {
    version: 2,
    capturedAt: now,
    contract: contractSnapshot,
    rentals: deepClone(linkedRentals),
    deliveries: deepClone((state.deliveries ?? []).filter((delivery) => linkedDeliveryIds.has(String(delivery?.id ?? '')))),
    transportRoutes: deepClone((state.transportRoutes ?? []).filter((route) => (
      Array.isArray(route?.stops)
      && route.stops.some((stop) => linkedDeliveryIds.has(String(stop?.deliveryId ?? '')))
    ))),
    inventoryMovements: deepClone((state.inventoryMovements ?? []).filter((movement) => (
      linkedRentals.some((rental) => isInventoryMovementLinkedToRental(movement, rental, contract))
    ))),
    cashMovements: deepClone((state.cashMovements ?? []).filter((movement) => {
      const sourceId = String(movement?.sourceId ?? '');
      const orderCode = String(movement?.linkedOrderCode ?? '');
      return rentalIds.has(sourceId) || orderCodes.has(orderCode);
    })),
    generatedReports: deepClone((state.generatedReports ?? []).filter((report) => (
      rentalIds.has(String(report?.sourceId ?? ''))
      || String(report?.sourceId ?? '') === String(contract.id ?? '')
    ))),
    supplierLoans: deepClone((state.supplierLoans ?? []).filter((loan) => (
      String(loan?.sourceContractId ?? '') === String(contract.id ?? '')
      || rentalIds.has(String(loan?.sourceRentalId ?? ''))
      || orderCodes.has(String(loan?.sourceOrderCode ?? ''))
    ))),
    quote: deepClone((state.quotes ?? []).find((quote) => String(quote?.id ?? '') === String(contract.quoteId ?? '')) ?? null),
  };
};


const getContractServiceDayKeys = (contract) => {
  const keys = new Set();
  const addLine = (line) => {
    const date = String(line?.serviceDate ?? line?.date ?? '').trim();
    const dayId = String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim();
    const label = normalizeText(line?.serviceDayLabel ?? line?.dayLabel);
    const key = date || dayId || label;
    if (key) keys.add(key);
  };
  (contract?.items ?? []).forEach(addLine);
  (contract?.services ?? []).forEach(addLine);
  (contract?.pricingPlan?.scheduleDays ?? []).forEach((day) => {
    const key = String(day?.date ?? day?.id ?? '').trim() || normalizeText(day?.label);
    if (key) keys.add(key);
  });
  return keys;
};

const getLegacyRestoreSourceScore = (contract) => {
  const dayCount = getContractServiceDayKeys(contract).size;
  const scheduleCount = Array.isArray(contract?.pricingPlan?.scheduleDays)
    ? contract.pricingPlan.scheduleDays.length
    : 0;
  const itemCount = Array.isArray(contract?.items) ? contract.items.length : 0;
  const serviceCount = Array.isArray(contract?.services) ? contract.services.length : 0;
  const approvedScore = contract?.status === 'aprobado' || contract?.approvedAt ? 100000 : 0;
  return approvedScore + (dayCount * 10000) + (scheduleCount * 1000) + itemCount + serviceCount;
};

const findLegacyRestoreDonor = (state, contract) => {
  const contractCode = String(contract?.contractCode ?? '').trim();
  const customerName = normalizeText(contract?.customerName);
  const eventDate = String(contract?.eventDate ?? '').trim();

  return (state.contracts ?? [])
    .filter((candidate) => String(candidate?.id ?? '') !== String(contract?.id ?? ''))
    .filter((candidate) => {
      if (contractCode && String(candidate?.contractCode ?? '').trim() !== contractCode) return false;
      if (customerName && normalizeText(candidate?.customerName) !== customerName) return false;
      if (eventDate && String(candidate?.eventDate ?? '').trim() !== eventDate) return false;
      return true;
    })
    .sort((left, right) => getLegacyRestoreSourceScore(right) - getLegacyRestoreSourceScore(left))[0] ?? null;
};

const getRestoreReservationRequirements = (state, rentals = []) => {
  const requiredByItem = new Map();
  (Array.isArray(rentals) ? rentals : []).forEach((rental) => {
    if (rental?.status === 'returned' || rental?.status === 'cancelled') return;
    (rental?.items ?? []).forEach((line) => {
      const item = state.items.find((entry) => String(entry.id) === String(line?.itemId));
      if (!item || lineControlsStock(line, item) === false) return;
      const quantity = Number.isFinite(Number(line?.internalReservedQty))
        ? Math.max(0, Math.trunc(Number(line.internalReservedQty)))
        : Math.max(0, Math.trunc(Number(line?.quantity ?? 0)));
      if (quantity <= 0) return;
      requiredByItem.set(String(item.id), Number(requiredByItem.get(String(item.id)) ?? 0) + quantity);
    });
  });
  return requiredByItem;
};

const reserveRestoredRentalStock = (state, rentals, now) => {
  const requirements = getRestoreReservationRequirements(state, rentals);
  const shortages = [];
  requirements.forEach((requiredQty, itemId) => {
    const item = state.items.find((entry) => String(entry.id) === itemId);
    const available = Math.max(0, Math.trunc(Number(item?.availableStock ?? 0)));
    if (!item || available < requiredQty) {
      shortages.push(`${item?.name ?? itemId}: requiere ${requiredQty}, disponible ${available}`);
    }
  });
  if (shortages.length > 0) {
    throw new Error(`No se puede restaurar como estaba porque falta stock: ${shortages.join(' | ')}`);
  }
  requirements.forEach((requiredQty, itemId) => {
    const item = state.items.find((entry) => String(entry.id) === itemId);
    item.availableStock = Math.max(0, Number(item.availableStock ?? 0) - requiredQty);
    item.updatedAt = now;
  });
};

const cleanupContractDeletionEffects = (state, contract, now, options = {}) => {
  if (!state.settings) state.settings = {};
  if (!state.settings.numbering) state.settings.numbering = {};
  if (!Array.isArray(state.rentals)) state.rentals = [];
  if (!Array.isArray(state.deliveries)) state.deliveries = [];
  if (!Array.isArray(state.transportRoutes)) state.transportRoutes = [];
  if (!Array.isArray(state.inventoryMovements)) state.inventoryMovements = [];
  if (!Array.isArray(state.cashMovements)) state.cashMovements = [];
  if (!Array.isArray(state.generatedReports)) state.generatedReports = [];
  if (!Array.isArray(state.supplierLoans)) state.supplierLoans = [];
  if (!Array.isArray(state.quotes)) state.quotes = [];

  const linkedRentals = state.rentals.filter((rental) => rentalMatchesContract(rental, contract));
  linkedRentals.forEach((rental) => cleanupRentalOperationalResidues(state, rental, contract, now, options));

  state.quotes.forEach((quote) => {
    const linkedByQuote = contract.quoteId && String(quote.id ?? '') === String(contract.quoteId);
    const linkedByRental = linkedRentals.some((rental) => quote.rentalId === rental.id || quote.orderCode === rental.orderCode);
    if (linkedByQuote || linkedByRental) {
      quote.status = quote.status === 'aprobada' ? 'borrador' : quote.status;
      quote.approvedAt = null;
      quote.rentalId = null;
      quote.orderCode = null;
      quote.updatedAt = now;
    }
  });

  releaseLatestCommercialDocumentCode(state, contract.contractCode, 'contractPrefix', 'contractNext');
};

const repairDeletedContractOperationalResidues = (state, now) => {
  if (!Array.isArray(state.contracts) || !Array.isArray(state.rentals)) return 0;
  const deletedContracts = state.contracts.filter((contract) => contract?.deletedAt);
  if (!deletedContracts.length) return 0;

  const byId = new Map();
  const byRentalId = new Map();
  const byOrderCode = new Map();
  const byContractCode = new Map();
  deletedContracts.forEach((contract) => {
    if (contract.id) byId.set(String(contract.id), contract);
    if (contract.rentalId) byRentalId.set(String(contract.rentalId), contract);
    if (contract.orderCode) byOrderCode.set(String(contract.orderCode), contract);
    if (contract.contractCode) byContractCode.set(String(contract.contractCode).trim(), contract);
  });

  const contractsToCleanup = new Set();
  state.rentals.forEach((rental) => {
    if (!rental || rental.deletedAt || rental.status === 'cancelled' || rental.status === 'returned') return;
    const contract = byId.get(String(rental.contractId ?? ''))
      ?? byRentalId.get(String(rental.id ?? ''))
      ?? byOrderCode.get(String(rental.orderCode ?? ''))
      ?? byContractCode.get(String(rental.contractCode ?? '').trim());
    if (contract) contractsToCleanup.add(contract);
  });

  contractsToCleanup.forEach((contract) => {
    cleanupContractDeletionEffects(state, contract, now, { skipReturned: true });
  });
  return contractsToCleanup.size;
};

const findOrCreateCategoryByName = (state, categoryName) => {
  const name = toBusinessUppercase(categoryName ?? '') || 'SIN CATEGORIA';
  const existing = state.categories.find((entry) => normalizeText(entry.name) === normalizeText(name));
  if (existing) return existing.name;
  const now = new Date().toISOString();
  state.categories.push({
    id: makeId('cat'),
    name,
    description: 'Creada automaticamente desde orden de servicio.',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  return name;
};

const buildQuickItemName = (quickItem = {}) => [
  quickItem.name,
  quickItem.color,
  quickItem.material,
].map((part) => toBusinessUppercase(part ?? '')).filter(Boolean).join(' ');

const resolveOperationalItemFromLine = (state, line, now = new Date().toISOString()) => {
  const explicitItemId = String(line?.itemId ?? '').trim();
  const existing = state.items.find((entry) => entry.id === explicitItemId);
  if (existing) return existing;

  const quickItem = line?.quickItem && typeof line.quickItem === 'object' ? line.quickItem : null;
  if (!quickItem) return null;

  const name = buildQuickItemName(quickItem);
  if (!name) throw new Error('El item rapido debe tener nombre o modelo.');
  const category = findOrCreateCategoryByName(state, quickItem.category);
  const brand = toBusinessUppercase(quickItem.material ?? quickItem.brand ?? '');
  const itemColor = toBusinessUppercase(quickItem.color ?? '');
  const rentalPriceBs = Math.max(0, toPositiveRoundedNumber(line?.unitPriceBs ?? quickItem.rentalPriceBs ?? 0));
  const duplicate = state.items.find((entry) => (
    !entry.deletedAt
    && normalizeText(entry.name) === normalizeText(name)
    && normalizeText(entry.category) === normalizeText(category)
    && normalizeText(entry.itemColor) === normalizeText(itemColor)
  ));
  if (duplicate) {
    const looksOperational = duplicate.adoptionSource === 'service_order_quick_item'
      || (Number(duplicate.totalStock ?? 0) <= 0 && Number(duplicate.availableStock ?? 0) <= 0);
    if (looksOperational) {
      duplicate.controlsStock = false;
      duplicate.verificationStatus = 'pending_verification';
      duplicate.adoptionSource = duplicate.adoptionSource || 'service_order_quick_item';
      duplicate.updatedAt = now;
    }
    return duplicate;
  }

  const created = {
    id: makeId('item'),
    name,
    category,
    brand,
    itemColor,
    totalStock: 0,
    availableStock: 0,
    controlsStock: false,
    verificationStatus: 'pending_verification',
    adoptionSource: 'service_order_quick_item',
    needsCleaningOnReturn: categoryRequiresCleaning(category),
    rentalPriceBs,
    damagedUnitChargeBs: Number((rentalPriceBs * Number(state.settings?.damageMultiplier ?? 1.2)).toFixed(2)),
    missingUnitChargeBs: Number((rentalPriceBs * Number(state.settings?.missingMultiplier ?? 2)).toFixed(2)),
    imageUrl: null,
    imageDataUrl: null,
    createdAt: now,
    updatedAt: now,
  };
  state.items.push(created);
  return created;
};

const itemControlsStock = (item) =>
  item?.controlsStock !== false
  && String(item?.verificationStatus ?? '').trim() !== 'pending_verification'
  && String(item?.adoptionSource ?? '').trim() !== 'service_order_quick_item'
  && !(Number(item?.totalStock ?? 0) <= 0 && Number(item?.availableStock ?? 0) <= 0);

const lineControlsStock = (line, item) =>
  line?.controlsStock !== false
  && String(line?.verificationStatus ?? '').trim() !== 'pending_verification'
  && itemControlsStock(item);


const buildDailyAssignmentSignature = (record) => {
  const normalizeLines = (lines = []) => (Array.isArray(lines) ? lines : [])
    .map((line, index) => ({
      lineKey: String(line?.lineKey ?? line?.comboLineKey ?? `${line?.itemId ?? 'line'}-${index}`),
      itemId: String(line?.itemId ?? line?.serviceId ?? ''),
      quantity: Number(line?.quantity ?? 0),
      unitPriceBs: Number(line?.unitPriceBs ?? line?.rentalPriceBs ?? 0),
      lineTotalBs: Number(line?.lineTotalBs ?? 0),
      serviceDayId: String(line?.serviceDayId ?? line?.scheduleDayId ?? ''),
      serviceDate: String(line?.serviceDate ?? line?.date ?? ''),
      serviceDayLabel: String(line?.serviceDayLabel ?? line?.dayLabel ?? ''),
    }))
    .sort((left, right) => left.lineKey.localeCompare(right.lineKey));

  const scheduleDays = (Array.isArray(record?.pricingPlan?.scheduleDays)
    ? record.pricingPlan.scheduleDays
    : [])
    .map((day, index) => ({
      id: String(day?.id ?? `day-${index}`),
      date: String(day?.date ?? ''),
      label: String(day?.label ?? ''),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return JSON.stringify({
    mode: String(record?.pricingPlan?.mode ?? ''),
    scheduleDays,
    items: normalizeLines(record?.items),
    services: normalizeLines(record?.services),
  });
};

const hasDailyAssignmentChanges = (before, after) =>
  buildDailyAssignmentSignature(before) !== buildDailyAssignmentSignature(after);

const summarizeContractChanges = (beforeContract, contract) => {
  const changes = [];
  const addTextChange = (label, beforeValue, afterValue) => {
    const beforeText = String(beforeValue ?? '').trim();
    const afterText = String(afterValue ?? '').trim();
    if (beforeText !== afterText) {
      changes.push(`${label}: ${beforeText || 'Sin definir'} -> ${afterText || 'Sin definir'}`);
    }
  };
  const addMoneyChange = (label, beforeValue, afterValue) => {
    const beforeNumber = Number(beforeValue ?? 0);
    const afterNumber = Number(afterValue ?? 0);
    if (Math.abs(beforeNumber - afterNumber) >= 0.01) {
      changes.push(`${label}: ${formatBs(beforeNumber)} -> ${formatBs(afterNumber)}`);
    }
  };
  const addGenericChange = (label, beforeValue, afterValue) => {
    if (JSON.stringify(beforeValue ?? null) !== JSON.stringify(afterValue ?? null)) {
      changes.push(`Actualizo ${label}`);
    }
  };

  addTextChange('Numero de contrato', beforeContract?.contractCode, contract?.contractCode);
  addTextChange('Fecha del contrato', beforeContract?.contractDate, contract?.contractDate);
  addTextChange('Cliente', beforeContract?.customerName, contract?.customerName);
  addTextChange('CI/NIT cliente', beforeContract?.customerCi, contract?.customerCi);
  addTextChange('Telefono cliente', beforeContract?.customerPhone, contract?.customerPhone);
  addTextChange('Telefono de referencia', beforeContract?.customerReferencePhone, contract?.customerReferencePhone);
  addTextChange('Nombre comercial', beforeContract?.companyName, contract?.companyName);
  addTextChange('Tipo de evento', beforeContract?.eventType, contract?.eventType);
  addTextChange('Fecha del evento', beforeContract?.eventDate, contract?.eventDate);
  addTextChange('Hora del evento', beforeContract?.eventTime, contract?.eventTime);
  addTextChange('Direccion', beforeContract?.address, contract?.address);
  addTextChange('Ciudad', beforeContract?.city, contract?.city);
  addTextChange('Fecha de entrega', beforeContract?.deliveryDate, contract?.deliveryDate);
  addTextChange(
    'Horario de entrega',
    `${beforeContract?.deliveryWindowStart ?? ''}-${beforeContract?.deliveryWindowEnd ?? ''}`,
    `${contract?.deliveryWindowStart ?? ''}-${contract?.deliveryWindowEnd ?? ''}`,
  );
  addTextChange('Fecha de recojo', beforeContract?.pickupDate, contract?.pickupDate);
  addTextChange(
    'Horario de recojo',
    `${beforeContract?.pickupWindowStart ?? ''}-${beforeContract?.pickupWindowEnd ?? ''}`,
    `${contract?.pickupWindowStart ?? ''}-${contract?.pickupWindowEnd ?? ''}`,
  );
  addTextChange('Logistica', beforeContract?.logisticsMode, contract?.logisticsMode);
  addTextChange('Modo de facturacion', beforeContract?.billingMode, contract?.billingMode);
  addTextChange('Estado', beforeContract?.status, contract?.status);
  addTextChange('Aprobado en', beforeContract?.approvedAt, contract?.approvedAt);
  addTextChange('Rechazado en', beforeContract?.rejectedAt, contract?.rejectedAt);
  addTextChange('Finalizado', beforeContract?.isFinalized ? 'Si' : 'No', contract?.isFinalized ? 'Si' : 'No');
  addTextChange('Finalizado en', beforeContract?.finalizedAt, contract?.finalizedAt);
  addTextChange('Finalizado por', beforeContract?.finalizedByName, contract?.finalizedByName);
  addTextChange('Orden vinculada', beforeContract?.orderCode, contract?.orderCode);
  addTextChange('Observaciones', beforeContract?.observations, contract?.observations);

  const beforeResponsible = beforeContract?.responsibles?.[0]?.name ?? '';
  const nextResponsible = contract?.responsibles?.[0]?.name ?? '';
  addTextChange('Responsable del contrato', beforeResponsible, nextResponsible);
  addGenericChange('equipo responsable', beforeContract?.responsibles ?? [], contract?.responsibles ?? []);

  const aggregateItems = (lines) => {
    const result = new Map();
    (Array.isArray(lines) ? lines : []).forEach((line) => {
      const key = String(line?.itemId ?? line?.itemName ?? '').trim();
      if (!key) return;
      const current = result.get(key) ?? { name: String(line?.itemName ?? 'Item').trim() || 'Item', quantity: 0 };
      current.quantity += Math.max(0, Math.trunc(Number(line?.quantity ?? 0)));
      result.set(key, current);
    });
    return result;
  };
  const beforeItems = aggregateItems(beforeContract?.items);
  const nextItems = aggregateItems(contract?.items);
  new Set([...beforeItems.keys(), ...nextItems.keys()]).forEach((key) => {
    const beforeLine = beforeItems.get(key);
    const nextLine = nextItems.get(key);
    const beforeQty = beforeLine?.quantity ?? 0;
    const nextQty = nextLine?.quantity ?? 0;
    if (beforeQty === nextQty) return;
    const itemName = nextLine?.name ?? beforeLine?.name ?? 'Item';
    if (beforeQty === 0) changes.push(`Agrego ${nextQty} x ${itemName}`);
    else if (nextQty === 0) changes.push(`Retiro ${beforeQty} x ${itemName}`);
    else changes.push(`${itemName}: ${beforeQty} -> ${nextQty}`);
  });
  const itemSignature = (lines) => (Array.isArray(lines) ? lines : [])
    .map((line) => [
      line?.itemId ?? '',
      line?.itemName ?? '',
      line?.quantity ?? 0,
      line?.unitPriceBs ?? 0,
      line?.discountBs ?? 0,
      line?.discountPercent ?? 0,
      line?.lineTotalBs ?? 0,
      line?.observation ?? '',
      line?.comboId ?? '',
      line?.comboLineKey ?? '',
    ].map((value) => String(value ?? '').trim()).join('|'))
    .sort()
    .join('||');
  if (itemSignature(beforeContract?.items) !== itemSignature(contract?.items)) {
    changes.push('Actualizo detalle, precios o descuentos de items');
  }

  const serviceSignature = (services) => normalizeContractServices(services)
    .map((service) => `${service.name}|${service.detail}|${service.quantity}|${service.unitPriceBs}`)
    .sort()
    .join('||');
  if (serviceSignature(beforeContract?.services) !== serviceSignature(contract?.services)) {
    changes.push('Actualizo los servicios asignados');
  }

  addGenericChange('plan de proveedor', beforeContract?.supplierFulfillmentPlan ?? [], contract?.supplierFulfillmentPlan ?? []);
  addGenericChange('plan de precios por duracion', beforeContract?.pricingPlan ?? null, contract?.pricingPlan ?? null);

  addMoneyChange('Subtotal base', beforeContract?.totals?.baseSubtotalBs, contract?.totals?.baseSubtotalBs);
  addMoneyChange('Descuento', beforeContract?.totals?.discountBs, contract?.totals?.discountBs);
  addMoneyChange('Transporte', beforeContract?.totals?.deliveryFeeBs, contract?.totals?.deliveryFeeBs);
  addMoneyChange('Garantia', beforeContract?.totals?.guaranteeBs ?? beforeContract?.guarantee?.amountBs, contract?.totals?.guaranteeBs ?? contract?.guarantee?.amountBs);
  addMoneyChange('Pago inicial', beforeContract?.payment?.paidAtApprovalBs, contract?.payment?.paidAtApprovalBs);
  addMoneyChange('Saldo pendiente', beforeContract?.payment?.pendingBs, contract?.payment?.pendingBs);
  addMoneyChange('Total', beforeContract?.totals?.totalBs, contract?.totals?.totalBs);

  const beforeGuaranteeStatus = String(beforeContract?.guarantee?.status ?? beforeContract?.payment?.guaranteeStatus ?? '').trim();
  const nextGuaranteeStatus = String(contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? '').trim();
  if (beforeGuaranteeStatus !== nextGuaranteeStatus) {
    changes.push(`Estado garantia: ${beforeGuaranteeStatus || 'Sin definir'} -> ${nextGuaranteeStatus || 'Sin definir'}`);
  }
  addTextChange('Metodo garantia', beforeContract?.guarantee?.paymentMethod ?? beforeContract?.payment?.guaranteePaymentMethod, contract?.guarantee?.paymentMethod ?? contract?.payment?.guaranteePaymentMethod);
  addTextChange('Metodo pago inicial', beforeContract?.payment?.initialPaymentMethod, contract?.payment?.initialPaymentMethod);
  addGenericChange('seguimiento economico', beforeContract?.economicLedger ?? [], contract?.economicLedger ?? []);

  return changes;
};

const appendContractRevision = (contract, payload, now, changes) => {
  const normalizedChanges = (Array.isArray(changes) ? changes : [])
    .map((change) => String(change ?? '').trim())
    .filter(Boolean);
  if (!normalizedChanges.length) return;
  contract.revisionHistory = Array.isArray(contract.revisionHistory) ? contract.revisionHistory : [];
  contract.revisionHistory.push({
    id: makeId('rev'),
    updatedAt: now,
    updatedById: payload?.updatedById ?? payload?.createdById ?? payload?.userId ?? null,
    updatedByName: String(
      payload?.updatedByName
      ?? payload?.createdByName
      ?? payload?.userName
      ?? payload?.createdBy
      ?? contract?.createdByName
      ?? contract?.createdBy
      ?? 'Sistema',
    ).trim() || 'Sistema',
    updatedByRole: String(
      payload?.updatedByRole
      ?? payload?.createdByRole
      ?? payload?.userRole
      ?? contract?.createdByRole
      ?? 'Operacion',
    ).trim() || 'Operacion',
    changes: normalizedChanges,
  });
};

const getAuditUserName = (payload) => String(
  payload?.updatedByName
  ?? payload?.createdByName
  ?? payload?.userName
  ?? payload?.createdBy
  ?? 'Sistema',
).trim() || 'Sistema';

const getAuditUserRole = (payload) => String(
  payload?.updatedByRole
  ?? payload?.createdByRole
  ?? payload?.userRole
  ?? 'Sistema',
).trim() || 'Sistema';

const appendAuditLog = (state, payload = {}) => {
  if (!state) return null;
  state.systemAuditLog = Array.isArray(state.systemAuditLog) ? state.systemAuditLog : [];
  const now = payload.createdAt ?? new Date().toISOString();
  const entry = {
    id: makeId('aud'),
    action: String(payload.action ?? 'update').trim() || 'update',
    module: String(payload.module ?? 'Sistema').trim() || 'Sistema',
    entityType: String(payload.entityType ?? '').trim() || null,
    entityId: String(payload.entityId ?? '').trim() || null,
    entityCode: String(payload.entityCode ?? '').trim() || null,
    title: String(payload.title ?? 'Actividad registrada').trim() || 'Actividad registrada',
    detail: String(payload.detail ?? '').trim(),
    changes: Array.isArray(payload.changes) ? payload.changes.map((change) => String(change ?? '').trim()).filter(Boolean) : [],
    userId: payload.userId ?? payload.updatedById ?? payload.createdById ?? null,
    userName: String(payload.userName ?? 'Sistema').trim() || 'Sistema',
    userRole: String(payload.userRole ?? 'Sistema').trim() || 'Sistema',
    createdAt: now,
  };
  state.systemAuditLog.unshift(entry);
  state.systemAuditLog = state.systemAuditLog.slice(0, 800);
  return entry;
};

const syncValidatedGuaranteeCashMovement = (state, contract, payload, now, beforeContract = null) => {
  if (String(contract?.status ?? '').trim() !== 'aprobado') return null;
  const guaranteeStatus = String(contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? '').trim();
  if (guaranteeStatus !== 'validado') return null;

  const nextValidatedGuaranteeBs = Math.max(0, toPositiveRoundedNumber(contract?.totals?.guaranteeBs ?? contract?.guarantee?.amountBs ?? 0));
  if (nextValidatedGuaranteeBs <= 0) return null;

  const beforeStatus = String(beforeContract?.guarantee?.status ?? beforeContract?.payment?.guaranteeStatus ?? '').trim();
  const beforeValidatedGuaranteeBs = beforeStatus === 'validado'
    ? Math.max(0, toPositiveRoundedNumber(beforeContract?.totals?.guaranteeBs ?? beforeContract?.guarantee?.amountBs ?? 0))
    : 0;
  const registeredGuaranteeBs = getRegisteredContractGuaranteeBs(state, contract);
  const alreadyCoveredGuaranteeBs = Math.max(beforeValidatedGuaranteeBs, registeredGuaranteeBs);
  const amountToRegisterBs = Math.max(0, Number((nextValidatedGuaranteeBs - alreadyCoveredGuaranteeBs).toFixed(2)));
  if (amountToRegisterBs <= 0) return null;

  state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
  const contractReferences = [
    contract?.id,
    contract?.rentalId,
    contract?.contractCode,
    contract?.orderCode,
  ].map((value) => normalizeText(value)).filter(Boolean);
  const hasReference = (value) => {
    const text = normalizeText(value);
    return Boolean(text) && contractReferences.some((reference) => text.includes(reference));
  };
  const alreadyRegistered = state.cashMovements.some((movement) => {
    if (isVoidedCashMovement(movement)) return false;
    const type = normalizeText(movement?.type);
    const category = normalizeText(movement?.category);
    if (!type.includes('garantia') && !category.includes('garantia')) return false;
    const amountMatches = Math.abs(Math.max(0, Number(movement?.amountBs ?? 0)) - amountToRegisterBs) < 0.01
      || Math.abs(Math.max(0, Number(movement?.amountBs ?? 0)) - nextValidatedGuaranteeBs) < 0.01;
    if (!amountMatches) return false;
    return [
      movement?.linkedContractId,
      movement?.linkedRentalId,
      movement?.linkedOrderCode,
      movement?.sourceId,
      movement?.reference,
      movement?.description,
      movement?.notes,
    ].some(hasReference);
  });
  if (alreadyRegistered) return null;

  const activeSession = getActiveSession(state);
  const responsibleName = String(
    payload?.updatedByName
    ?? payload?.userName
    ?? contract?.responsibles?.[0]?.name
    ?? contract?.createdByName
    ?? contract?.createdBy
    ?? 'Sistema',
  ).trim() || 'Sistema';
  const paymentMethod = normalizePaymentMethod(contract?.guarantee?.paymentMethod ?? contract?.payment?.guaranteePaymentMethod);
  const paymentAccount = paymentMethod === 'qr'
    ? normalizeQrPaymentAccount(contract?.guarantee?.paymentAccount ?? contract?.payment?.guaranteePaymentAccount)
    : '';
  const movement = buildCashMovement({
    sessionId: activeSession?.id ?? null,
    type: 'ingreso_garantia',
    amountBs: amountToRegisterBs,
    description: `Ingreso garantia: ${contract?.customerName || 'Cliente'}`,
    sourceType: 'contract',
    sourceId: contract.id,
    createdBy: responsibleName,
    createdByName: responsibleName,
    userName: responsibleName,
    responsible: responsibleName,
    cashBoxType: CASH_BOX_TYPES.BIG_CASH,
    category: 'garantia',
    paymentMethod,
    paymentAccount,
    receiptCode: nextCashReceiptCode(state),
    notes: `Garantia pagada desde contrato ${contract?.contractCode || contract?.id || ''}`.trim(),
    linkedRentalId: contract?.rentalId ?? '',
    linkedContractId: contract?.id ?? '',
    linkedOrderCode: contract?.orderCode ?? '',
    accountingTag: 'validated_guarantee',
  });
  movement.createdAt = now;
  state.cashMovements.push(movement);
  return movement;
};

const syncInitialPaymentCashMovement = (state, contract, payload, now) => {
  if (String(contract?.status ?? '').trim() !== 'aprobado') return null;

  const paidAtApprovalBs = Math.max(0, toPositiveRoundedNumber(contract?.payment?.paidAtApprovalBs ?? 0));
  const prepaidAppliedBs = Math.max(0, toPositiveRoundedNumber(contract?.payment?.prepaidAppliedBs ?? contract?.prepaidAppliedBs ?? 0));
  const cashPaymentBs = Math.max(0, Number((paidAtApprovalBs - prepaidAppliedBs).toFixed(2)));
  state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
  const referenceKeys = getContractCashReferenceKeys(state, contract);
  const activeSession = getActiveSession(state);
  const responsibleName = String(
    payload?.updatedByName
    ?? payload?.userName
    ?? contract?.responsibles?.[0]?.name
    ?? contract?.createdByName
    ?? contract?.createdBy
    ?? 'Sistema',
  ).trim() || 'Sistema';
  const paymentMethod = normalizePaymentMethod(contract?.payment?.initialPaymentMethod ?? contract?.payment?.paymentMethod);
  const paymentAccount = paymentMethod === 'qr'
    ? normalizeQrPaymentAccount(contract?.payment?.initialPaymentAccount ?? contract?.payment?.paymentAccount)
    : '';
  const linkedInitialMovements = state.cashMovements
    .filter((movement) => cashMovementMatchesContract(movement, referenceKeys))
    .filter((movement) => !isVoidedCashMovement(movement))
    .filter(isAutoInitialRentalPaymentMovement)
    .sort((a, b) => new Date(a?.createdAt ?? 0) - new Date(b?.createdAt ?? 0));

  if (cashPaymentBs <= 0) {
    linkedInitialMovements.forEach((movement) => {
      movement.receiptStatus = 'anulado';
      movement.voidedAt = movement.voidedAt ?? now;
      movement.voidedBy = movement.voidedBy || responsibleName;
      movement.voidReason = movement.voidReason || `Anulado porque el pago inicial del contrato ${contract?.contractCode || contract?.id || ''} quedo en cero`.trim();
    });
    return null;
  }

  const existingMovement = linkedInitialMovements[0] ?? null;
  if (existingMovement) {
    linkedInitialMovements.slice(1).forEach((movement) => {
      movement.receiptStatus = 'anulado';
      movement.voidedAt = movement.voidedAt ?? now;
      movement.voidedBy = movement.voidedBy || responsibleName;
      movement.voidReason = movement.voidReason || `Anulado por duplicado del pago inicial del contrato ${contract?.contractCode || contract?.id || ''}`.trim();
    });
    existingMovement.amountBs = cashPaymentBs;
    existingMovement.description = `Cobro inicial alquiler: ${contract?.customerName || 'Cliente'}`;
    existingMovement.sourceType = contract?.rentalId ? 'rental' : 'contract';
    existingMovement.sourceId = contract?.rentalId || contract?.id;
    existingMovement.createdByName = existingMovement.createdByName || responsibleName;
    existingMovement.userName = existingMovement.userName || responsibleName;
    existingMovement.responsible = existingMovement.responsible || responsibleName;
    existingMovement.cashBoxType = CASH_BOX_TYPES.BIG_CASH;
    existingMovement.category = 'cobro_contrato';
    existingMovement.paymentMethod = paymentMethod;
    existingMovement.paymentAccount = paymentAccount;
    existingMovement.receiptCode = existingMovement.receiptCode || nextCashReceiptCode(state);
    existingMovement.notes = `Pago inicial actualizado desde contrato ${contract?.contractCode || contract?.id || ''}`.trim();
    existingMovement.linkedRentalId = contract?.rentalId ?? existingMovement.linkedRentalId ?? '';
    existingMovement.linkedContractId = contract?.id ?? existingMovement.linkedContractId ?? '';
    existingMovement.linkedOrderCode = contract?.orderCode ?? existingMovement.linkedOrderCode ?? '';
    existingMovement.accountingTag = 'initial_rental_payment';
    existingMovement.updatedAt = now;
    return existingMovement;
  }

  const movement = buildCashMovement({
    sessionId: activeSession?.id ?? null,
    type: 'ingreso_alquiler',
    amountBs: cashPaymentBs,
    description: `Cobro inicial alquiler: ${contract?.customerName || 'Cliente'}`,
    sourceType: contract?.rentalId ? 'rental' : 'contract',
    sourceId: contract?.rentalId || contract?.id,
    createdBy: responsibleName,
    createdByName: responsibleName,
    userName: responsibleName,
    responsible: responsibleName,
    cashBoxType: CASH_BOX_TYPES.BIG_CASH,
    category: 'cobro_contrato',
    paymentMethod,
    paymentAccount,
    receiptCode: nextCashReceiptCode(state),
    notes: `Pago inicial registrado desde contrato ${contract?.contractCode || contract?.id || ''}`.trim(),
    linkedRentalId: contract?.rentalId ?? '',
    linkedContractId: contract?.id ?? '',
    linkedOrderCode: contract?.orderCode ?? '',
    accountingTag: 'initial_rental_payment',
  });
  movement.createdAt = now;
  state.cashMovements.push(movement);
  return movement;
};

const isAutoInitialRentalPaymentMovement = (movement) => {
  const tag = normalizeText(movement?.accountingTag);
  const notes = normalizeText(movement?.notes);
  return tag === 'initial_rental_payment'
    || notes.includes('pago inicial registrado desde contrato');
};

const isInitialPaymentLedgerEntry = (entry) => {
  if (String(entry?.type ?? '').trim() !== 'deposit') return false;
  const entryId = normalizeText(entry?.id);
  const entryNote = normalizeText(entry?.note);
  return entryId.includes('initial-payment')
    || entryNote.includes('pago inicial')
    || entryNote.includes('primer pago')
    || entryNote.includes('pimer pago');
};

const cleanupApprovedContractEconomicDuplicates = (state, contract, payload = {}, now = new Date().toISOString()) => {
  if (String(contract?.status ?? '').trim() !== 'aprobado') return;
  const targetCollectionBs = Math.max(0, toPositiveRoundedNumber(contract?.totals?.totalBs ?? contract?.totalBs ?? 0));
  if (targetCollectionBs <= 0) return;

  state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
  const referenceKeys = getContractCashReferenceKeys(state, contract);
  const linkedCollections = state.cashMovements
    .filter((movement) => cashMovementMatchesContract(movement, referenceKeys))
    .filter(isContractCollectionCashMovement)
    .filter((movement) => Math.max(0, Number(movement?.amountBs ?? 0)) > 0);
  let registeredBs = Number(linkedCollections.reduce((sum, movement) => (
    sum + Math.max(0, Number(movement?.amountBs ?? 0))
  ), 0).toFixed(2));

  if (registeredBs - targetCollectionBs > 0.01) {
    const responsibleName = String(
      payload?.updatedByName
      ?? payload?.userName
      ?? contract?.responsibles?.[0]?.name
      ?? contract?.createdByName
      ?? contract?.createdBy
      ?? 'Sistema',
    ).trim() || 'Sistema';
    const candidates = linkedCollections.slice().sort((left, right) => {
      const leftTag = normalizeText(left?.accountingTag);
      const rightTag = normalizeText(right?.accountingTag);
      const leftManual = leftTag === 'contract_economic_collection' ? 1 : 0;
      const rightManual = rightTag === 'contract_economic_collection' ? 1 : 0;
      if (leftManual !== rightManual) return rightManual - leftManual;
      const leftInitial = leftTag === 'initial_rental_payment' || normalizeText(left?.type) === 'ingreso_alquiler' ? 1 : 0;
      const rightInitial = rightTag === 'initial_rental_payment' || normalizeText(right?.type) === 'ingreso_alquiler' ? 1 : 0;
      if (leftInitial !== rightInitial) return leftInitial - rightInitial;
      return new Date(right?.createdAt ?? 0) - new Date(left?.createdAt ?? 0);
    });
    candidates.forEach((movement) => {
      if (registeredBs - targetCollectionBs <= 0.01) return;
      const amountBs = Math.max(0, Number(movement?.amountBs ?? 0));
      if (registeredBs - amountBs < targetCollectionBs - 0.01) return;
      movement.receiptStatus = 'anulado';
      movement.voidedAt = movement.voidedAt ?? now;
      movement.voidedBy = movement.voidedBy || responsibleName;
      movement.voidReason = movement.voidReason || `Anulado por cobro duplicado del contrato ${contract?.contractCode || contract?.id || ''}`.trim();
      registeredBs = Number((registeredBs - amountBs).toFixed(2));
    });
  }

  const validCollectionBs = Math.min(targetCollectionBs, getRegisteredContractCollectionBs(state, contract));
  if (contract.payment) {
    const currentPaidBs = Math.max(0, toPositiveRoundedNumber(contract.payment.paidAtApprovalBs ?? 0));
    const normalizedPaidBs = validCollectionBs > 0
      ? validCollectionBs
      : Math.min(currentPaidBs, targetCollectionBs);
    if (currentPaidBs - targetCollectionBs > 0.01 || (validCollectionBs > 0 && Math.abs(currentPaidBs - validCollectionBs) > 0.01)) {
      contract.payment.paidAtApprovalBs = normalizedPaidBs;
      contract.payment.pendingBs = Number(Math.max(0, targetCollectionBs - normalizedPaidBs).toFixed(2));
      contract.payment.overpaidBs = 0;
    }
  }
  const rental = (Array.isArray(state.rentals) ? state.rentals : []).find((entry) => (
    !entry?.deletedAt
    && (
      String(entry?.id ?? '') === String(contract?.rentalId ?? '')
      || String(entry?.contractId ?? '') === String(contract?.id ?? '')
      || normalizeText(entry?.orderCode) === normalizeText(contract?.orderCode)
    )
  ));
  if (rental?.payment) {
    const currentRentalPaidBs = Math.max(0, toPositiveRoundedNumber(rental.payment.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs ?? 0));
    const contractPaidBs = Math.max(0, toPositiveRoundedNumber(contract?.payment?.paidAtApprovalBs ?? 0));
    const normalizedRentalPaidBs = validCollectionBs > 0
      ? validCollectionBs
      : Math.min(contractPaidBs, targetCollectionBs);
    if (
      currentRentalPaidBs - targetCollectionBs > 0.01
      || Math.abs(currentRentalPaidBs - normalizedRentalPaidBs) > 0.01
    ) {
      rental.payment.paidAtRentalBs = normalizedRentalPaidBs;
      rental.payment.pendingPaymentBs = Number(Math.max(0, targetCollectionBs - normalizedRentalPaidBs).toFixed(2));
      rental.payment.overpaidBs = 0;
      rental.payment.status = normalizedRentalPaidBs >= targetCollectionBs && targetCollectionBs > 0
        ? 'cancelado'
        : normalizedRentalPaidBs > 0
        ? 'a_cuenta'
        : 'sin_pago';
      rental.payment.mode = rental.payment.status;
      rental.totals = {
        ...(rental.totals ?? {}),
        paidAtRentalBs: normalizedRentalPaidBs,
        pendingPaymentBs: rental.payment.pendingPaymentBs,
        overpaidBs: 0,
      };
    }
  }

  if (Array.isArray(contract.economicLedger)) {
    const initialRows = contract.economicLedger.filter(isInitialPaymentLedgerEntry);
    if (initialRows.length > 0) {
      const keepRow = initialRows.find((entry) => Math.abs(toPositiveRoundedNumber(entry?.amountBs ?? 0) - validCollectionBs) < 0.01)
        ?? initialRows[0];
      keepRow.amountBs = validCollectionBs;
      contract.economicLedger = contract.economicLedger.filter((entry) => (
        !isInitialPaymentLedgerEntry(entry) || entry.id === keepRow.id
      ));
    }
  }
};

const syncApprovedContractOperation = (state, contract, payload, now, beforeContract = null) => {
  if (String(contract?.status ?? '').trim() !== 'aprobado') return;

  const rental = state.rentals.find((entry) => (
    !entry.deletedAt
    && entry.status !== 'cancelled'
    && (
      String(entry.id ?? '') === String(contract.rentalId ?? '')
      || String(entry.contractId ?? '') === String(contract.id ?? '')
      || (contract.orderCode && String(entry.orderCode ?? '') === String(contract.orderCode))
    )
  ));
  if (!rental) return;

  const inventoryStatusBeforeSync = normalizeText(rental.operational?.inventoryStatus ?? '');
  const wasAlreadyOutOfWarehouse = ['salio', 'devuelto'].includes(inventoryStatusBeforeSync);
  const buildOperationalChangeSignature = (sourceContract) => JSON.stringify({
    items: (sourceContract?.items ?? []).map((line, index) => ({
      key: getInventoryLineKey(line, index),
      itemId: String(line?.itemId ?? '').trim(),
      name: normalizeText(line?.itemName ?? line?.name ?? ''),
      quantity: Math.max(0, Math.trunc(Number(line?.quantity ?? 0))),
      serviceDayId: String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim(),
    })),
    supplier: normalizeSupplierFulfillmentPlan(sourceContract?.supplierFulfillmentPlan).map((line) => ({
      itemId: String(line?.itemId ?? '').trim(),
      lineKey: String(line?.lineKey ?? '').trim(),
      quantity: Math.max(0, Math.trunc(Number(line?.quantity ?? 0))),
      mode: String(line?.mode ?? '').trim(),
    })),
  });
  const operationalItemsChanged = beforeContract
    ? buildOperationalChangeSignature(beforeContract) !== buildOperationalChangeSignature(contract)
    : false;

  const userName = String(payload?.updatedByName ?? payload?.userName ?? 'Sistema').trim() || 'Sistema';
  const userRole = String(payload?.updatedByRole ?? payload?.userRole ?? 'Operacion').trim() || 'Operacion';
  const oldLinesByItem = new Map();
  const oldLinesByName = new Map();
  (rental.items ?? []).forEach((line) => {
    const key = String(line?.itemId ?? '').trim();
    const nameKey = normalizeText(line?.itemName ?? line?.name ?? '');
    if (key) {
      const current = oldLinesByItem.get(key);
      if (!current) {
        oldLinesByItem.set(key, { ...line });
      } else {
        current.quantity = Number(current.quantity ?? 0) + Number(line.quantity ?? 0);
        current.internalReservedQty = Number(current.internalReservedQty ?? 0) + Number(line.internalReservedQty ?? 0);
        current.supplierBackedQty = Number(current.supplierBackedQty ?? 0) + Number(line.supplierBackedQty ?? 0);
      }
    }
    if (nameKey) {
      const currentByName = oldLinesByName.get(nameKey);
      if (!currentByName) {
        oldLinesByName.set(nameKey, { ...line });
      } else {
        currentByName.quantity = Number(currentByName.quantity ?? 0) + Number(line.quantity ?? 0);
        currentByName.internalReservedQty = Number(currentByName.internalReservedQty ?? 0) + Number(line.internalReservedQty ?? 0);
        currentByName.supplierBackedQty = Number(currentByName.supplierBackedQty ?? 0) + Number(line.supplierBackedQty ?? 0);
      }
    }
  });
  (beforeContract?.items ?? []).forEach((line) => {
    const key = String(line?.itemId ?? '').trim();
    const nameKey = normalizeText(line?.itemName ?? line?.name ?? '');
    if (key && !oldLinesByItem.has(key)) {
      oldLinesByItem.set(key, { ...line });
    }
    if (nameKey && !oldLinesByName.has(nameKey)) {
      oldLinesByName.set(nameKey, { ...line });
    }
  });

  const supplierSupportMaps = buildSupplierSupportMaps(contract.supplierFulfillmentPlan);
  const beforeSupplierSupportMaps = buildSupplierSupportMaps(beforeContract?.supplierFulfillmentPlan);

  const getLineInternalReservedQty = (line, { respectControlsStock = true } = {}) => {
    if (respectControlsStock && line?.controlsStock === false) return 0;
    const quantity = Math.max(0, Math.trunc(Number(line?.quantity ?? 0)));
    const storedReservedQty = Math.max(0, Math.trunc(Number(line?.internalReservedQty ?? 0)));
    const previousSupplierStats = getSupplierSupportStatsForLine(line, beforeSupplierSupportMaps);
    if (previousSupplierStats.manualQty > 0) {
      return Math.max(storedReservedQty, quantity);
    }
    if (storedReservedQty > 0) return storedReservedQty;
    return Math.max(0, Math.trunc(quantity - Number(line?.supplierBackedQty ?? 0)));
  };
  const remainingOldInternalReservedByItem = new Map();
  const remainingOldInternalReservedByName = new Map();
  oldLinesByItem.forEach((line, itemId) => {
    remainingOldInternalReservedByItem.set(itemId, getLineInternalReservedQty(line, { respectControlsStock: false }));
  });
  oldLinesByName.forEach((line, itemName) => {
    remainingOldInternalReservedByName.set(itemName, getLineInternalReservedQty(line, { respectControlsStock: false }));
  });
  (beforeContract?.items ?? []).forEach((line) => {
    const itemId = String(line?.itemId ?? '').trim();
    const itemName = normalizeText(line?.itemName ?? line?.name ?? '');
    const reservedQty = getLineInternalReservedQty(line, { respectControlsStock: false });
    if (itemId) {
      remainingOldInternalReservedByItem.set(
        itemId,
        Math.max(Number(remainingOldInternalReservedByItem.get(itemId) ?? 0), reservedQty),
      );
    }
    if (itemName) {
      remainingOldInternalReservedByName.set(
        itemName,
        Math.max(Number(remainingOldInternalReservedByName.get(itemName) ?? 0), reservedQty),
      );
    }
  });

  const availabilityPeriod = buildAvailabilityPeriod({
    deliveryDate: contract.deliveryDate || rental.rentalDate,
    deliveryWindowStart: contract.deliveryWindowStart || rental.deliveryWindowStart || '00:00',
    pickupDate: contract.pickupDate || rental.dueDate,
    pickupWindowEnd: contract.pickupWindowEnd || rental.pickupWindowEnd || rental.dueTime || '23:59',
  });
  const projectedRequestedItems = (contract.items ?? [])
    .map((line) => {
      const item = state.items.find((entry) => String(entry.id) === String(line.itemId));
      if (!item || !lineControlsStock(line, item)) return null;
      const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
      const lineKey = getInventoryLineKey(line, line._originalIndex ?? 0);
      const supplierStats = getSupplierSupportStatsForLine({ ...line, lineKey }, supplierSupportMaps);
      const internalRequestedQty = Math.max(0, quantity - Math.min(quantity, supplierStats.subtractiveQty));
      const itemId = String(line.itemId);
      const itemName = normalizeText(line.itemName ?? item.name ?? '');
      const oldReservedQty = Number(remainingOldInternalReservedByItem.get(itemId) ?? 0);
      const oldReservedByNameQty = itemName ? Number(remainingOldInternalReservedByName.get(itemName) ?? 0) : 0;
      const alreadyReservedQty = Math.min(internalRequestedQty, Math.max(oldReservedQty, oldReservedByNameQty));
      if (alreadyReservedQty > 0) {
        remainingOldInternalReservedByItem.set(itemId, Math.max(0, oldReservedQty - alreadyReservedQty));
        if (itemName) {
          remainingOldInternalReservedByName.set(itemName, Math.max(0, oldReservedByNameQty - alreadyReservedQty));
        }
      }
      return {
        itemId: item.id,
        itemName: item.name,
        quantity: internalRequestedQty - alreadyReservedQty,
      };
    })
    .filter((line) => line && Number(line.quantity ?? 0) > 0);
  const projectedIssues = validateProjectedInventoryRequest({
    items: state.items,
    rentals: state.rentals,
    contracts: state.contracts,
    period: availabilityPeriod,
    requestedItems: projectedRequestedItems,
    exclude: {
      rentalId: rental.id,
      orderCode: rental.orderCode,
      contractId: contract.id,
      contractCode: contract.contractCode,
      recordId: contract.id,
    },
  });
  if (projectedIssues.length) {
    const issue = projectedIssues[0];
    const conflictText = (issue.hardConflicts ?? [])
      .slice(0, 2)
      .map((record) => `contrato ${record.contractCode || record.code || record.orderCode || 'previo'} hasta ${record.endDate || 'fecha pendiente'}`)
      .join(', ');
    throw new Error(
      `Stock insuficiente para "${issue.itemName}" en esas fechas. Disponibles: ${issue.projectedAvailable}. Faltan: ${issue.shortageQty}.${conflictText ? ` Esta usado por ${conflictText}.` : ''} Coordina proveedor o cambia fechas.`,
    );
  }

  const nextLines = (contract.items ?? []).map((line, index) => {
    const item = state.items.find((entry) => String(entry.id) === String(line.itemId));
    const oldLine = oldLinesByItem.get(String(line.itemId))
      ?? oldLinesByName.get(normalizeText(line.itemName ?? line.name ?? item?.name ?? ''))
      ?? null;
    const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
    const lineKey = getInventoryLineKey(line, index);
    // Un contrato aprobado puede tener una linea historica cuyo producto fue retirado
    // del catalogo. Conservamos esa linea sin mover inventario, para permitir editar
    // el resto del contrato y agregar productos vigentes.
    if (!item) {
      if (!oldLine) throw new Error(`El item nuevo "${line.itemName}" no existe en inventario.`);
      const rentalPriceBs = line.rentalPriceBs !== undefined && line.rentalPriceBs !== null && line.rentalPriceBs !== ''
        ? Math.max(0, Number(line.rentalPriceBs ?? 0))
        : line.unitPriceBs !== undefined && line.unitPriceBs !== null && line.unitPriceBs !== ''
          ? Math.max(0, Number(line.unitPriceBs ?? 0))
          : oldLine.rentalPriceBs !== undefined && oldLine.rentalPriceBs !== null && oldLine.rentalPriceBs !== ''
            ? Math.max(0, Number(oldLine.rentalPriceBs ?? 0))
            : Math.max(0, Number(oldLine.unitPriceBs ?? 0));
      return {
        ...oldLine,
        ...line,
        lineKey,
        itemId: oldLine.itemId,
        itemName: line.itemName || oldLine.itemName || 'Item historico',
        quantity,
        rentalPriceBs,
        lineTotalBs: Number(line.lineTotalBs ?? quantity * rentalPriceBs),
      };
    }
    const supplierStats = getSupplierSupportStatsForLine({ ...line, lineKey }, supplierSupportMaps);
    const supplierBackedQty = supplierStats.manualQty > 0
      ? supplierStats.totalQty
      : Math.min(quantity, supplierStats.totalQty);
    const controlsStock = lineControlsStock(line, item);
    const internalReservedQty = controlsStock
      ? Math.max(0, quantity - Math.min(quantity, supplierStats.subtractiveQty))
      : 0;
    const oldInternalReservedQty = oldLine
      ? supplierStats.manualQty > 0
        ? Math.max(
          getLineInternalReservedQty(oldLine, { respectControlsStock: false }),
          Math.min(quantity, Math.max(0, Math.trunc(Number(oldLine.quantity ?? 0)))),
        )
        : getLineInternalReservedQty(oldLine, { respectControlsStock: false })
      : 0;
    const reservationDelta = internalReservedQty - oldInternalReservedQty;

    const currentAvailableStock = Math.max(0, Number(item.availableStock ?? 0));
    const canReserveFromCurrentStock = currentAvailableStock >= reservationDelta;
    const canReserveByDateProjection = reservationDelta > 0 && projectedRequestedItems.some((entry) => entry.itemId === item.id);
    if (reservationDelta > 0 && !canReserveFromCurrentStock && !canReserveByDateProjection) {
      throw new Error(
        `Stock insuficiente para "${item.name}". Disponibles: ${currentAvailableStock}. Faltan: ${reservationDelta - currentAvailableStock}.`,
      );
    }
    if (reservationDelta !== 0) {
      const beforeAvailableStock = Number(item.availableStock ?? 0);
      const beforeTotalStock = Number(item.totalStock ?? 0);
      item.updatedAt = now;
      const operationDate = String(contract.deliveryDate || contract.eventDate || rental.rentalDate || '').trim();
      if (!Array.isArray(state.inventoryMovements)) state.inventoryMovements = [];
      state.inventoryMovements.push({
        id: makeId('mov'),
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        type: reservationDelta > 0 ? 'reserva' : 'reinsercion',
        reason: `Edicion de contrato ${contract.contractCode}`,
        detail: reservationDelta > 0
          ? `Reserva adicional de ${reservationDelta} unidades para ${rental.orderCode}`
          : `Liberacion de ${Math.abs(reservationDelta)} unidades de ${rental.orderCode}`,
        reference: rental.orderCode,
        deltaUnits: -reservationDelta,
        beforeTotalStock,
        afterTotalStock: beforeTotalStock,
        beforeAvailableStock,
        afterAvailableStock: beforeAvailableStock,
        reservedStockAfter: beforeTotalStock - beforeAvailableStock,
        operationDate,
        deliveryDate: operationDate,
        eventDate: String(contract.eventDate ?? '').trim() || operationDate,
        stockEffect: 'reservation_only',
        userName,
        userRole,
        createdAt: now,
      });
    }

    const rentalPriceBs = line.rentalPriceBs !== undefined && line.rentalPriceBs !== null && line.rentalPriceBs !== ''
      ? Math.max(0, Number(line.rentalPriceBs ?? 0))
      : line.unitPriceBs !== undefined && line.unitPriceBs !== null && line.unitPriceBs !== ''
        ? Math.max(0, Number(line.unitPriceBs ?? 0))
        : oldLine?.rentalPriceBs !== undefined && oldLine?.rentalPriceBs !== null && oldLine?.rentalPriceBs !== ''
          ? Math.max(0, Number(oldLine.rentalPriceBs ?? 0))
          : oldLine?.unitPriceBs !== undefined && oldLine?.unitPriceBs !== null && oldLine?.unitPriceBs !== ''
            ? Math.max(0, Number(oldLine.unitPriceBs ?? 0))
            : Math.max(0, Number(item.rentalPriceBs ?? 0));
    return {
      ...oldLine,
      ...line,
      itemId: item.id,
      itemName: item.name,
      quantity,
      rentalPriceBs,
      lineTotalBs: Number(line.lineTotalBs ?? quantity * rentalPriceBs),
      supplierBackedQty,
      internalReservedQty,
      controlsStock,
      verificationStatus: controlsStock ? (item.verificationStatus ?? 'verified') : 'pending_verification',
      damagedUnitChargeBs: Number(oldLine?.damagedUnitChargeBs ?? item.damagedUnitChargeBs ?? 0),
      missingUnitChargeBs: Number(oldLine?.missingUnitChargeBs ?? item.missingUnitChargeBs ?? 0),
    };
  });

  oldLinesByItem.forEach((oldLine, itemId) => {
    if (nextLines.some((line) => String(line.itemId) === itemId)) return;
    const item = state.items.find((entry) => String(entry.id) === itemId);
    if (!item) return;
    const releasedQty = getLineInternalReservedQty(oldLine);
    if (releasedQty <= 0) return;
    const beforeAvailableStock = Number(item.availableStock ?? 0);
    const beforeTotalStock = Number(item.totalStock ?? 0);
    item.updatedAt = now;
    const operationDate = String(contract.deliveryDate || contract.eventDate || rental.rentalDate || '').trim();
    if (!Array.isArray(state.inventoryMovements)) state.inventoryMovements = [];
    state.inventoryMovements.push({
      id: makeId('mov'),
      itemId: item.id,
      itemName: item.name,
      category: item.category,
      type: 'reinsercion',
      reason: `Edicion de contrato ${contract.contractCode}`,
      detail: `Liberacion de ${releasedQty} unidades de ${rental.orderCode}`,
      reference: rental.orderCode,
      deltaUnits: releasedQty,
      beforeTotalStock,
      afterTotalStock: beforeTotalStock,
      beforeAvailableStock,
      afterAvailableStock: beforeAvailableStock,
      reservedStockAfter: beforeTotalStock - beforeAvailableStock,
      operationDate,
      deliveryDate: operationDate,
      eventDate: String(contract.eventDate ?? '').trim() || operationDate,
      stockEffect: 'reservation_only',
      userName,
      userRole,
      createdAt: now,
    });
  });

  rental.items = nextLines;
  rental.services = normalizeContractServices(contract.services);
  rental.contractCode = contract.contractCode;
  rental.contractDate = contract.contractDate ?? rental.contractDate ?? contract.createdAt;
  rental.customerName = contract.customerName;
  rental.customerPhone = contract.customerPhone;
  rental.rentalDate = contract.deliveryDate;
  rental.dueDate = contract.pickupDate;
  rental.dueTime = contract.pickupWindowEnd;
  rental.deliveryWindowStart = contract.deliveryWindowStart;
  rental.deliveryWindowEnd = contract.deliveryWindowEnd;
  rental.deliveryTimeMode = contract.deliveryTimeMode === 'coordinate' ? 'coordinate' : 'fixed';
  rental.pickupWindowStart = contract.pickupWindowStart;
  rental.pickupWindowEnd = contract.pickupWindowEnd;
  rental.pickupTimeMode = contract.pickupTimeMode === 'coordinate' ? 'coordinate' : 'fixed';
  rental.eventType = contract.eventType;
  rental.eventAddress = contract.address;
  rental.notes = contract.observations;
  rental.billingMode = contract.billingMode;
  rental.logisticsMode = contract.logisticsMode;
  rental.deliveryChargeMode = contract.deliveryChargeMode;
  rental.deliveryFeeBs = contract.deliveryFeeBs;
  rental.deliveryFeeReason = contract.deliveryFeeReason;
  const guaranteeDeclaredBs = Number(contract?.totals?.guaranteeBs ?? rental.guaranteeDeclaredBs ?? rental.depositBs ?? 0);
  const rawGuaranteeStatus = String(contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? '').trim();
  const isGuaranteeValidated = rawGuaranteeStatus === 'validado' || (!rawGuaranteeStatus && guaranteeDeclaredBs > 0);
  rental.depositBs = isGuaranteeValidated ? guaranteeDeclaredBs : 0;
  rental.guaranteeDeclaredBs = guaranteeDeclaredBs;
  rental.guarantee = {
    ...(rental.guarantee ?? {}),
    amountBs: guaranteeDeclaredBs,
    validatedBs: isGuaranteeValidated ? guaranteeDeclaredBs : 0,
    status: isGuaranteeValidated ? 'validado' : 'no_validado',
    paymentMethod: normalizePaymentMethod(contract?.guarantee?.paymentMethod ?? contract?.payment?.guaranteePaymentMethod),
    paymentAccount: normalizeQrPaymentAccount(contract?.guarantee?.paymentAccount ?? contract?.payment?.guaranteePaymentAccount),
  };
  rental.pricingPlan = deepClone(contract.pricingPlan);
  rental.supplierFulfillmentPlan = deepClone(contract.supplierFulfillmentPlan ?? []);
  const primaryResponsible = contract?.responsibles?.[0] ?? null;
  if (primaryResponsible?.name) {
    rental.createdById = primaryResponsible.id ?? rental.createdById ?? null;
    rental.createdByName = primaryResponsible.name;
    rental.createdByRole = primaryResponsible.role ?? rental.createdByRole ?? 'Operacion';
  }
  const paidAtRentalBs = Number(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs ?? 0);
  const totalBs = Number(contract?.totals?.totalBs ?? 0);
  const pendingPaymentBs = Math.max(0, Number((totalBs - paidAtRentalBs).toFixed(2)));
  const overpaidBs = Math.max(0, Number((paidAtRentalBs - totalBs).toFixed(2)));
  rental.totals = {
    ...(rental.totals ?? {}),
    itemsSubtotalBs: Number(((contract.items ?? []).reduce((sum, line) => sum + Number(line.lineTotalBs ?? 0), 0) + getManualSupplierSaleTotalBs(contract.supplierFulfillmentPlan)).toFixed(2)),
    servicesSubtotalBs: Number((contract.services ?? []).reduce((sum, line) => sum + Number(line.lineTotalBs ?? 0), 0).toFixed(2)),
    ...deepClone(contract.totals),
    paidAtRentalBs,
    pendingPaymentBs,
    overpaidBs,
  };
  rental.payment = {
    ...(rental.payment ?? {}),
    paidAtRentalBs,
    pendingPaymentBs,
    overpaidBs,
    initialPaymentMethod: normalizePaymentMethod(contract?.payment?.initialPaymentMethod ?? rental?.payment?.initialPaymentMethod),
    initialPaymentAccount: normalizeQrPaymentAccount(contract?.payment?.initialPaymentAccount ?? contract?.payment?.paymentAccount ?? rental?.payment?.initialPaymentAccount),
    guaranteeStatus: isGuaranteeValidated ? 'validado' : 'no_validado',
    guaranteePaymentMethod: normalizePaymentMethod(contract?.guarantee?.paymentMethod ?? contract?.payment?.guaranteePaymentMethod ?? rental?.payment?.guaranteePaymentMethod),
    guaranteePaymentAccount: normalizeQrPaymentAccount(contract?.guarantee?.paymentAccount ?? contract?.payment?.guaranteePaymentAccount ?? rental?.payment?.guaranteePaymentAccount),
  };
  const dueAt = new Date(`${contract.pickupDate}T${contract.pickupWindowEnd || '23:59'}:00`);
  if (!Number.isNaN(dueAt.getTime())) rental.dueAt = dueAt.toISOString();
  if (wasAlreadyOutOfWarehouse && operationalItemsChanged) {
    rental.operational = {
      ...(rental.operational ?? {}),
      revisionAlert: {
        active: true,
        reason: 'contract_changed_after_dispatch',
        message: 'Contrato editado despues de la salida. Revisar material agregado, salida y retorno.',
        changedAt: now,
        changedByName: userName,
        changedByRole: userRole,
      },
    };
  }
  rental.updatedAt = now;

  const linkedDeliveries = state.deliveries
    .filter((entry) => !entry.deletedAt && String(entry.rentalId ?? '') === String(rental.id))
    .sort((a, b) => {
      const aPickup = isPickupDeliveryRecord(a) ? 1 : 0;
      const bPickup = isPickupDeliveryRecord(b) ? 1 : 0;
      if (aPickup !== bPickup) return aPickup - bPickup;
      return String(a.scheduledDate ?? '').localeCompare(String(b.scheduledDate ?? ''));
    });
  const deliveryOut = linkedDeliveries.find((entry) => !isPickupDeliveryRecord(entry)) ?? linkedDeliveries[0] ?? null;
  const deliveryBack = linkedDeliveries.find((entry) => isPickupDeliveryRecord(entry)) ?? linkedDeliveries[1] ?? null;
  [deliveryOut, deliveryBack].forEach((delivery, index) => {
    if (!delivery) return;
    const isPickup = index === 1;
    delivery.customerName = contract.customerName;
    delivery.companyName = contract.companyName || contract.customerName;
    delivery.address = contract.address || delivery.address;
    delivery.city = contract.city || delivery.city;
    delivery.scheduledDate = isPickup ? contract.pickupDate : contract.deliveryDate;
    delivery.windowStart = isPickup ? contract.pickupWindowStart : contract.deliveryWindowStart;
    delivery.windowEnd = isPickup ? contract.pickupWindowEnd : contract.deliveryWindowEnd;
    delivery.driverId = contract.driverId ?? delivery.driverId;
    delivery.vehicleId = contract.vehicleId ?? delivery.vehicleId;
    if (primaryResponsible?.name) {
      delivery.responsibleName = primaryResponsible.name;
      delivery.responsibleRole = primaryResponsible.role ?? 'Operacion';
    }
    delivery.updatedAt = now;
  });

  syncClientOperationalData(state, contract.clientId, {
    customerPhone: contract.customerPhone,
    customerReferencePhone: contract.customerReferencePhone,
    address: contract.address,
    city: contract.city,
  });
};

const addClientDeliveryAddressIfNeeded = (client, address, city, now = new Date().toISOString()) => {
  const cleanAddress = String(address ?? '').trim();
  const cleanCity = String(city ?? '').trim();
  if (!cleanAddress && !cleanCity) return;
  const addresses = Array.isArray(client.deliveryAddresses) ? client.deliveryAddresses : [];
  const exists = addresses.some((entry) => (
    normalizeText(entry?.address) === normalizeText(cleanAddress)
    && normalizeText(entry?.city) === normalizeText(cleanCity)
  ));
  if (!exists) {
    client.deliveryAddresses = [
      ...addresses,
      {
        id: makeId('addr'),
        label: cleanAddress ? 'Direccion operativa' : 'Ciudad operativa',
        address: cleanAddress,
        city: cleanCity,
        notes: 'Creada desde orden de servicio.',
        createdAt: now,
      },
    ];
  }
};

const syncClientOperationalData = (state, clientId, { customerPhone, customerReferencePhone, customerCi, address, city } = {}) => {
  const client = state.clients.find((entry) => entry.id === clientId && !entry.deletedAt);
  if (!client) return;
  const now = new Date().toISOString();
  const phone = String(customerPhone ?? '').trim();
  const referencePhone = String(customerReferencePhone ?? '').trim();
  const nitCi = String(customerCi ?? '').trim();
  const cleanAddress = String(address ?? '').trim();
  const cleanCity = String(city ?? '').trim();
  let changed = false;
  if (!client.nitCi && nitCi) {
    client.nitCi = nitCi;
    changed = true;
  }
  if (!client.phone && phone) {
    client.phone = phone;
    changed = true;
  }
  if (!client.whatsapp && phone) {
    client.whatsapp = phone;
    changed = true;
  }
  if (!client.referencePhone && referencePhone) {
    client.referencePhone = referencePhone;
    changed = true;
  }
  if (!client.address && cleanAddress) {
    client.address = cleanAddress;
    changed = true;
  }
  if (!client.city && cleanCity) {
    client.city = cleanCity;
    changed = true;
  }
  const beforeCount = Array.isArray(client.deliveryAddresses) ? client.deliveryAddresses.length : 0;
  addClientDeliveryAddressIfNeeded(client, cleanAddress, cleanCity, now);
  if ((Array.isArray(client.deliveryAddresses) ? client.deliveryAddresses.length : 0) !== beforeCount) {
    changed = true;
  }
  if (changed) client.updatedAt = now;
};

const resolveClientFromName = (state, customerName, customerPhone, address = '', city = '', customerReferencePhone = '', customerCi = '') => {
  const normalizedTarget = normalizeText(customerName);
  const existing = state.clients.find((client) => normalizeText(client.name) === normalizedTarget);
  if (existing) {
    syncClientOperationalData(state, existing.id, { customerPhone, customerReferencePhone, customerCi, address, city });
    return existing.id;
  }

  const now = new Date().toISOString();
  const cleanAddress = String(address ?? '').trim();
  const cleanCity = String(city ?? '').trim();
  const nitCi = String(customerCi ?? '').trim();
  const created = {
    id: makeId('cli'),
    name: String(customerName ?? '').trim(),
    companyName: String(customerName ?? '').trim(),
    contactName: String(customerName ?? '').trim(),
    contactRole: 'Contacto',
    nitCi,
    phone: String(customerPhone ?? '').trim(),
    whatsapp: String(customerPhone ?? '').trim(),
    referencePhone: String(customerReferencePhone ?? '').trim(),
    email: '',
    address: cleanAddress,
    city: cleanCity,
    deliveryAddresses: cleanAddress || cleanCity
      ? [{
        id: makeId('addr'),
        label: 'Direccion operativa',
        address: cleanAddress,
        city: cleanCity,
        notes: 'Creada desde orden de servicio.',
        createdAt: now,
      }]
      : [],
    isBlacklisted: false,
    blacklistReason: '',
    blacklistNotes: '',
    blacklistedAt: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  state.clients.push(created);
  return created.id;
};

const createDeliveryFromRental = (state, rental) => {
  const defaultDriver = state.drivers.find((entry) => entry.status === 'activo') ?? state.drivers[0] ?? null;
  const defaultVehicle = state.vehicles.find((entry) => entry.status === 'activo') ?? state.vehicles[0] ?? null;
  const orderCode = rental.orderCode ?? consumeDocumentCode(state, 'serviceOrderPrefix', 'serviceOrderNext', 5);
  const deliveryCode = consumeDocumentCode(state, 'deliveryPrefix', 'deliveryNext', 5);
  const dateText = String(rental.dueDate ?? '').trim();
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const created = {
    id: makeId('del'),
    deliveryCode,
    orderCode,
    rentalId: rental.id,
    customerName: rental.customerName,
    companyName: rental.customerName,
    address: 'Direccion pendiente',
    city: 'Ciudad',
    windowStart: '08:00',
    windowEnd: '10:00',
    scheduledDate: safeDate,
    driverId: defaultDriver?.id ?? null,
    vehicleId: defaultVehicle?.id ?? null,
    status: 'programada',
    progress: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  };

  state.deliveries.push(created);
  return created;
};

const computeClientMetrics = (state) => {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const summaryByClientId = {};

  for (const rental of state.rentals) {
    if (rental.deletedAt) {
      continue;
    }
    const clientId = rental.clientId ?? null;
    if (!clientId) {
      continue;
    }
    if (!summaryByClientId[clientId]) {
      summaryByClientId[clientId] = {
        ordersCount: 0,
        totalBilledBs: 0,
        lastOrderAt: null,
      };
    }

    const entry = summaryByClientId[clientId];
    const createdAt = rental.createdAt ?? rental.rentalAt ?? null;
    entry.ordersCount += 1;
    entry.totalBilledBs += Number(rental?.totals?.totalBs ?? 0);
    if (!entry.lastOrderAt || new Date(createdAt) > new Date(entry.lastOrderAt)) {
      entry.lastOrderAt = createdAt;
    }
  }

  let newClientsThisMonth = 0;
  let activeClients = 0;
  for (const client of state.clients) {
    const created = new Date(client.createdAt ?? now.toISOString());
    if (created.getMonth() === month && created.getFullYear() === year) {
      newClientsThisMonth += 1;
    }
    if (client.status !== 'inactive') {
      activeClients += 1;
    }
  }

  return {
    activeClients,
    newClientsThisMonth,
    byClientId: summaryByClientId,
  };
};

const getStatusFromDelivery = (delivery) => {
  return normalizeDeliveryStatus(delivery);
};

const isPickupDeliveryRecord = (delivery) => {
  if (delivery?.routeType === 'recojo') return true;
  if (delivery?.routeType === 'envio') return false;
  const note = normalizeText(delivery?.notes);
  return note.includes('recojo') || note.includes('recog') || note.includes('devolucion');
};

const normalizeRouteStopsPayload = (stops) => {
  if (!Array.isArray(stops)) return [];
  return stops
    .map((stop, index) => ({
      id: String(stop?.id ?? makeId('stop')).trim() || makeId('stop'),
      deliveryId: String(stop?.deliveryId ?? '').trim(),
      sequence: Math.max(1, Math.trunc(Number(stop?.sequence ?? index + 1))),
      eta: String(stop?.eta ?? '').trim(),
      notes: String(stop?.notes ?? '').trim(),
    }))
    .filter((stop) => stop.deliveryId)
    .sort((a, b) => a.sequence - b.sequence)
    .map((stop, index) => ({ ...stop, sequence: index + 1 }));
};

const hydrateTransportRoute = (state, route) => {
  const driver = state.drivers.find((entry) => entry.id === route.driverId) ?? null;
  const vehicle = state.vehicles.find((entry) => entry.id === route.vehicleId) ?? null;
  const stops = (route.stops ?? [])
    .map((stop) => {
      const delivery = state.deliveries.find((entry) => entry.id === stop.deliveryId && !entry.deletedAt) ?? null;
      if (!delivery) return null;
      const stopDriver = state.drivers.find((entry) => entry.id === delivery.driverId) ?? driver ?? null;
      const stopVehicle = state.vehicles.find((entry) => entry.id === delivery.vehicleId) ?? vehicle ?? null;
      return {
        ...stop,
        delivery: {
          ...delivery,
          status: getStatusFromDelivery(delivery),
          driverName: stopDriver?.fullName ?? driver?.fullName ?? 'Sin chofer',
          vehicleCode: stopVehicle?.code ?? vehicle?.code ?? 'SIN-VEH',
          vehicleType: stopVehicle?.type ?? vehicle?.type ?? '-',
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sequence - b.sequence);

  return {
    ...route,
    driverName: driver?.fullName ?? 'Sin chofer',
    vehicleCode: vehicle?.code ?? 'SIN-VEH',
    vehicleName: vehicle?.name ?? 'Sin vehiculo',
    vehicleType: vehicle?.type ?? '-',
    stops,
  };
};

const syncRouteStopsToDeliveries = (state, route) => {
  const routeStopIds = new Set((route.stops ?? []).map((stop) => stop.deliveryId));
  state.deliveries.forEach((delivery) => {
    if (delivery.routeId === route.id && !routeStopIds.has(delivery.id)) {
      delivery.routeId = null;
      delivery.routeType = null;
      delivery.routeSequence = null;
      delivery.updatedAt = new Date().toISOString();
    }
  });

  (route.stops ?? []).forEach((stop, index) => {
    const delivery = state.deliveries.find((entry) => entry.id === stop.deliveryId && !entry.deletedAt);
    if (!delivery) return;
    const sequence = index + 1;
    delivery.routeId = route.id;
    delivery.routeType = route.type === 'mixta'
      ? isPickupDeliveryRecord(delivery) ? 'recojo' : 'envio'
      : route.type;
    delivery.routeSequence = sequence;
    delivery.driverId = route.driverId ?? delivery.driverId ?? null;
    delivery.vehicleId = route.vehicleId ?? delivery.vehicleId ?? null;
    delivery.updatedAt = new Date().toISOString();
  });
};

const createWebBridge = () => ({
  inventory: {
    list: async () => {
      const { items } = readQueryState();
      return items
        .filter((item) => !item.deletedAt)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },
    listCombos: async () => {
      const { inventoryCombos } = readQueryState();
      return (inventoryCombos ?? [])
        .filter((combo) => !combo.deletedAt && String(combo.status ?? 'active') !== 'deleted')
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },
    listMovements: async () => {
      const { inventoryMovements } = readQueryState();
      return inventoryMovements.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    listRecoveries: async () => {
      const { stockRecoveries } = readQueryState();
      return stockRecoveries
        .filter((entry) => Number(entry.quantity ?? 0) > 0)
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    create: async (payload) => {
      const name = toBusinessUppercase(payload?.name ?? '');
      const requestedCategory = toBusinessUppercase(payload?.category ?? '');
      const brand = toBusinessUppercase(payload?.brand ?? '');
      const itemColor = toBusinessUppercase(payload?.itemColor ?? '');
      const sku = toBusinessUppercase(payload?.sku ?? payload?.code ?? '');
      const totalStock = Math.trunc(toNumber(payload?.totalStock, 'stock total'));
      const rentalPriceBs = toNumber(payload?.rentalPriceBs, 'precio');
      const damagedUnitChargeBs = toNumber(payload?.damagedUnitChargeBs, 'cargo por danio');
      const missingUnitChargeBs = toNumber(payload?.missingUnitChargeBs, 'cargo por perdida');
      const requestedNeedsCleaningOnReturn = Boolean(payload?.needsCleaningOnReturn);
      const imageUrl = String(payload?.imageUrl ?? '').trim() || null;
      const imageDataUrl = payload?.imageDataUrl ?? null;
      const controlsStock = payload?.controlsStock === true;
      const inventoryArea = normalizeInventoryArea(payload?.inventoryArea);

      if (!name) {
        throw new Error('El nombre es obligatorio.');
      }
      if (!requestedCategory) {
        throw new Error('La categoria es obligatoria.');
      }
      if (totalStock <= 0) {
        throw new Error('El stock total debe ser mayor a 0.');
      }
      if (rentalPriceBs < 0) {
        throw new Error('El precio no puede ser negativo.');
      }
      if (damagedUnitChargeBs < 0 || missingUnitChargeBs < 0) {
        throw new Error('Los cargos por danio y perdida no pueden ser negativos.');
      }
      if (imageDataUrl && (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/'))) {
        throw new Error('La imagen enviada no es valida.');
      }
      if (imageUrl && !imageUrl.startsWith('/uploads/products/')) {
        throw new Error('La URL de imagen enviada no es valida.');
      }

      let createdItem = null;
      transaction((state) => {
        const category = state.categories.find((entry) => normalizeText(entry.name) === normalizeText(requestedCategory))?.name;
        if (!category) {
          throw new Error('La categoria seleccionada no existe.');
        }
        if (sku && state.items.some((entry) => normalizeText(entry.sku) === normalizeText(sku))) {
          throw new Error('Ya existe un item con ese codigo.');
        }

        createdItem = {
          id: makeId('item'),
          name,
          category,
          brand,
          itemColor,
          sku,
          totalStock,
          availableStock: totalStock,
          controlsStock,
          verificationStatus: controlsStock ? 'verified' : 'pending_verification',
          adoptionSource: controlsStock ? 'inventory_verified' : 'manual_inventory_pending',
          needsCleaningOnReturn: categoryRequiresCleaning(category)
            ? true
            : requestedNeedsCleaningOnReturn,
          rentalPriceBs,
          damagedUnitChargeBs,
          missingUnitChargeBs,
          imageUrl,
          imageDataUrl,
          inventoryArea,
          createdAt: new Date().toISOString(),
        };
        state.items.push(createdItem);
        appendAuditLog(state, {
          action: 'create',
          module: 'Inventario',
          entityType: 'item',
          entityId: createdItem.id,
          entityCode: createdItem.sku,
          title: `Creo producto ${createdItem.name}`,
          detail: `${createdItem.category} | Stock ${createdItem.totalStock}`,
          userName: getAuditUserName(payload),
          userRole: getAuditUserRole(payload),
          createdAt: createdItem.createdAt,
        });
        return state;
      });

      return createdItem;
    },
    update: async (payload) => {
      const id = payload?.id;
      if (!id) {
        throw new Error('Debe enviar el id del item.');
      }

      let updatedItem = null;
      transaction((state) => {
        const item = state.items.find((entry) => entry.id === id);
        if (!item) {
          throw new Error('No se encontro el item seleccionado.');
        }
        const beforeItem = deepClone(item);

        const {
          reservedStock,
          recoveryStock,
          minimumPhysicalStock,
        } = getInventoryStockCommitment(state, item.id);

        if (typeof payload.name === 'string') {
          const nextName = toBusinessUppercase(payload.name);
          if (!nextName) {
            throw new Error('El nombre no puede estar vacio.');
          }
          item.name = nextName;
        }

        if (typeof payload.category === 'string') {
          const requestedCategory = toBusinessUppercase(payload.category);
          if (!requestedCategory) {
            throw new Error('La categoria no puede estar vacia.');
          }
          const nextCategory = state.categories.find((entry) => normalizeText(entry.name) === normalizeText(requestedCategory))?.name;
          if (!nextCategory) {
            throw new Error('La categoria seleccionada no existe.');
          }
          item.category = nextCategory;
        }

        if (payload.brand !== undefined) {
          item.brand = toBusinessUppercase(payload.brand ?? '');
        }

        if (payload.itemColor !== undefined) {
          item.itemColor = toBusinessUppercase(payload.itemColor ?? '');
        }

        if (payload.inventoryArea !== undefined) {
          item.inventoryArea = normalizeInventoryArea(payload.inventoryArea);
        }

        if (payload.sku !== undefined || payload.code !== undefined) {
          const nextSku = toBusinessUppercase(payload.sku ?? payload.code ?? '');
          if (
            nextSku
            && state.items.some((entry) => entry.id !== id && normalizeText(entry.sku) === normalizeText(nextSku))
          ) {
            throw new Error('Ya existe otro item con ese codigo.');
          }
          item.sku = nextSku;
        }

        if (payload.totalStock !== undefined) {
          const nextTotalStock = Math.trunc(toNumber(payload.totalStock, 'stock total'));
          if (nextTotalStock < 0) {
            throw new Error('El stock fisico no puede ser negativo.');
          }
          if (nextTotalStock < minimumPhysicalStock) {
            throw new Error(
              `El stock fisico no puede ser menor a ${minimumPhysicalStock}: `
              + `${reservedStock} comprometido(s) y ${recoveryStock} en mantenimiento o recuperacion.`,
            );
          }
          item.totalStock = nextTotalStock;
          item.availableStock = Math.max(0, nextTotalStock - minimumPhysicalStock);
        }

        if (payload.rentalPriceBs !== undefined) {
          const nextPrice = toNumber(payload.rentalPriceBs, 'precio');
          if (nextPrice < 0) {
            throw new Error('El precio no puede ser negativo.');
          }
          item.rentalPriceBs = nextPrice;
        }

        if (payload.damagedUnitChargeBs !== undefined) {
          const nextDamagedCharge = toNumber(payload.damagedUnitChargeBs, 'cargo por danio');
          if (nextDamagedCharge < 0) {
            throw new Error('El cargo por danio no puede ser negativo.');
          }
          item.damagedUnitChargeBs = nextDamagedCharge;
        }

        if (payload.missingUnitChargeBs !== undefined) {
          const nextMissingCharge = toNumber(payload.missingUnitChargeBs, 'cargo por perdida');
          if (nextMissingCharge < 0) {
            throw new Error('El cargo por perdida no puede ser negativo.');
          }
          item.missingUnitChargeBs = nextMissingCharge;
        }

        const nextNeedsCleaningOnReturn =
          payload.needsCleaningOnReturn !== undefined
            ? Boolean(payload.needsCleaningOnReturn)
            : Boolean(item.needsCleaningOnReturn);
        item.needsCleaningOnReturn = categoryRequiresCleaning(item.category) ? true : nextNeedsCleaningOnReturn;

        if (payload.imageDataUrl !== undefined) {
          if (
            payload.imageDataUrl &&
            (typeof payload.imageDataUrl !== 'string' || !payload.imageDataUrl.startsWith('data:image/'))
          ) {
            throw new Error('La imagen enviada no es valida.');
          }
          item.imageDataUrl = payload.imageDataUrl;
        }
        if (payload.imageUrl !== undefined) {
          const nextImageUrl = String(payload.imageUrl ?? '').trim() || null;
          if (nextImageUrl && !nextImageUrl.startsWith('/uploads/products/')) {
            throw new Error('La URL de imagen enviada no es valida.');
          }
          item.imageUrl = nextImageUrl;
          if (nextImageUrl) {
            item.imageDataUrl = null;
          }
        }

        if (payload.controlsStock !== undefined) {
          const nextControlsStock = Boolean(payload.controlsStock);
          if (nextControlsStock && item.totalStock <= 0) {
            throw new Error('Para validar el item primero registra un stock total mayor a 0.');
          }
          item.controlsStock = nextControlsStock;
          item.verificationStatus = nextControlsStock ? 'verified' : 'pending_verification';
          item.adoptionSource = nextControlsStock ? 'inventory_verified' : 'manual_inventory_pending';
          item.verifiedAt = nextControlsStock ? new Date().toISOString() : null;
        }

        if (payload.verificationStatus !== undefined && payload.controlsStock === undefined) {
          const status = String(payload.verificationStatus ?? '').trim();
          item.verificationStatus = status || item.verificationStatus || 'pending_verification';
        }

        if (payload.adoptionSource !== undefined && payload.controlsStock === undefined) {
          item.adoptionSource = String(payload.adoptionSource ?? '').trim();
        }

        item.updatedAt = new Date().toISOString();
        const changes = [];
        if (beforeItem.name !== item.name) changes.push(`Nombre: ${beforeItem.name || '-'} -> ${item.name || '-'}`);
        if (beforeItem.category !== item.category) changes.push(`Categoria: ${beforeItem.category || '-'} -> ${item.category || '-'}`);
        if (String(beforeItem.brand ?? '') !== String(item.brand ?? '')) changes.push(`Marca: ${beforeItem.brand || '-'} -> ${item.brand || '-'}`);
        if (String(beforeItem.itemColor ?? '') !== String(item.itemColor ?? '')) changes.push(`Color / descripcion: ${beforeItem.itemColor || '-'} -> ${item.itemColor || '-'}`);
        if (String(beforeItem.sku ?? '') !== String(item.sku ?? '')) changes.push(`Codigo: ${beforeItem.sku || '-'} -> ${item.sku || '-'}`);
        if (String(beforeItem.inventoryArea ?? '') !== String(item.inventoryArea ?? '')) changes.push(`Area: ${beforeItem.inventoryArea || '-'} -> ${item.inventoryArea || '-'}`);
        if (Number(beforeItem.totalStock ?? 0) !== Number(item.totalStock ?? 0)) changes.push(`Stock fisico: ${beforeItem.totalStock ?? 0} -> ${item.totalStock ?? 0}`);
        if (Number(beforeItem.availableStock ?? 0) !== Number(item.availableStock ?? 0)) changes.push(`Stock disponible: ${beforeItem.availableStock ?? 0} -> ${item.availableStock ?? 0}`);
        if (Number(beforeItem.rentalPriceBs ?? 0) !== Number(item.rentalPriceBs ?? 0)) changes.push(`Precio alquiler: ${formatBs(beforeItem.rentalPriceBs ?? 0)} -> ${formatBs(item.rentalPriceBs ?? 0)}`);
        if (Number(beforeItem.damagedUnitChargeBs ?? 0) !== Number(item.damagedUnitChargeBs ?? 0)) changes.push(`Cargo dano: ${formatBs(beforeItem.damagedUnitChargeBs ?? 0)} -> ${formatBs(item.damagedUnitChargeBs ?? 0)}`);
        if (Number(beforeItem.missingUnitChargeBs ?? 0) !== Number(item.missingUnitChargeBs ?? 0)) changes.push(`Cargo perdida: ${formatBs(beforeItem.missingUnitChargeBs ?? 0)} -> ${formatBs(item.missingUnitChargeBs ?? 0)}`);
        if (Boolean(beforeItem.needsCleaningOnReturn) !== Boolean(item.needsCleaningOnReturn)) changes.push(`Limpieza al retorno: ${beforeItem.needsCleaningOnReturn ? 'Si' : 'No'} -> ${item.needsCleaningOnReturn ? 'Si' : 'No'}`);
        if (Boolean(beforeItem.controlsStock) !== Boolean(item.controlsStock)) changes.push(`Control de stock: ${beforeItem.controlsStock ? 'Activo' : 'Pendiente'} -> ${item.controlsStock ? 'Activo' : 'Pendiente'}`);
        if (String(beforeItem.verificationStatus ?? '') !== String(item.verificationStatus ?? '')) changes.push(`Validacion: ${beforeItem.verificationStatus || '-'} -> ${item.verificationStatus || '-'}`);
        if (String(beforeItem.adoptionSource ?? '') !== String(item.adoptionSource ?? '')) changes.push(`Origen/adopcion: ${beforeItem.adoptionSource || '-'} -> ${item.adoptionSource || '-'}`);
        if (String(beforeItem.imageUrl ?? '') !== String(item.imageUrl ?? '')) changes.push('Cambio imagen del producto');
        if (String(beforeItem.imageDataUrl ?? '') !== String(item.imageDataUrl ?? '')) changes.push('Cambio imagen cargada del producto');
        if (changes.length > 0) {
          appendAuditLog(state, {
            action: 'update',
            module: 'Inventario',
            entityType: 'item',
            entityId: item.id,
            entityCode: item.sku,
            title: `Edito producto ${item.name}`,
            detail: `${item.category} | Stock disponible ${item.availableStock}/${item.totalStock}`,
            changes,
            userName: getAuditUserName(payload),
            userRole: getAuditUserRole(payload),
            createdAt: item.updatedAt,
          });
        }
        updatedItem = deepClone(item);
        return state;
      });

      return updatedItem;
    },
    remove: async (payload) => {
      const id = payload?.id;
      if (!id) {
        throw new Error('Debe enviar el id del item.');
      }

      let deletedItem = null;
      transaction((state) => {
        const itemIndex = state.items.findIndex((entry) => entry.id === id);
        if (itemIndex < 0) {
          throw new Error('No se encontro el item seleccionado.');
        }

        const item = state.items[itemIndex];
        if (item.deletedAt) {
          deletedItem = deepClone(item);
          return state;
        }
        const controlsOperationalStock = itemControlsStock(item);
        const hasActiveRentals = state.rentals.some(
          (rental) =>
            normalizeRentalStatus(rental.status) === 'active'
            && !rental.deletedAt
            && Array.isArray(rental.items)
            && rental.items.some((line) => String(line.itemId) === String(item.id) && lineControlsStock(line, item)),
        );
        if (controlsOperationalStock && hasActiveRentals) {
          throw new Error('No puedes eliminar un item con unidades alquiladas.');
        }

        const hasRecoveryQueue = state.stockRecoveries.some((entry) => String(entry.itemId) === String(item.id));
        if (hasRecoveryQueue) {
          throw new Error('No puedes eliminar un item con unidades pendientes de lavado o reparacion.');
        }

        if (controlsOperationalStock && Number(item.availableStock ?? 0) < Number(item.totalStock ?? 0)) {
          throw new Error('No puedes eliminar un item con unidades no operativas o faltantes pendientes.');
        }

        deletedItem = deepClone(item);
        item.deletedAt = new Date().toISOString();
        item.updatedAt = item.deletedAt;
        appendAuditLog(state, {
          action: 'delete',
          module: 'Inventario',
          entityType: 'item',
          entityId: item.id,
          entityCode: item.sku,
          title: `Elimino producto ${item.name}`,
          detail: `${item.category} | Stock ${item.totalStock}`,
          changes: [
            `Producto eliminado: ${item.name}`,
            `Categoria: ${item.category || '-'}`,
            `Marca: ${item.brand || '-'}`,
            `Color / descripcion: ${item.itemColor || '-'}`,
            `Codigo: ${item.sku || '-'}`,
            `Stock fisico antes de eliminar: ${item.totalStock ?? 0}`,
            `Stock disponible antes de eliminar: ${item.availableStock ?? 0}`,
            `Precio alquiler: ${formatBs(item.rentalPriceBs ?? 0)}`,
          ],
          userName: getAuditUserName(payload),
          userRole: getAuditUserRole(payload),
          createdAt: item.deletedAt,
        });
        return state;
      });

      return deletedItem;
    },
    createCombo: async (payload) => {
      const name = toBusinessUppercase(payload?.name ?? '');
      const category = toBusinessUppercase(payload?.category ?? 'COMBOS') || 'COMBOS';
      const rentalPriceBs = toNumber(payload?.rentalPriceBs ?? payload?.priceBs ?? 0, 'precio del combo');
      const pricingCondition = normalizeComboPricingCondition(payload?.pricingCondition);
      const notes = String(payload?.notes ?? '').trim();
      const imageUrl = String(payload?.imageUrl ?? '').trim() || null;
      const imageDataUrl = payload?.imageDataUrl ?? null;

      if (!name) {
        throw new Error('El nombre del combo es obligatorio.');
      }
      if (rentalPriceBs < 0) {
        throw new Error('El precio del combo no puede ser negativo.');
      }
      if (imageDataUrl && (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/'))) {
        throw new Error('La imagen enviada no es valida.');
      }
      if (imageUrl && !imageUrl.startsWith('/uploads/products/')) {
        throw new Error('La URL de imagen enviada no es valida.');
      }

      let createdCombo = null;
      transaction((state) => {
        if ((state.inventoryCombos ?? []).some((entry) => !entry.deletedAt && normalizeText(entry.name) === normalizeText(name))) {
          throw new Error('Ya existe un combo con ese nombre.');
        }
        const ingredients = dedupeComboIngredients(
          (Array.isArray(payload?.ingredients) ? payload.ingredients : [])
            .map((line) => normalizeComboRule(line, state.items))
            .filter(Boolean),
        );
        if (ingredients.length === 0) {
          throw new Error('Agrega al menos un producto existente al combo.');
        }

        createdCombo = {
          id: makeId('combo'),
          name,
          category,
          rentalPriceBs,
          pricingCondition,
          notes,
          imageUrl,
          imageDataUrl,
          ingredients,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
        };
        state.inventoryCombos = Array.isArray(state.inventoryCombos) ? state.inventoryCombos : [];
        state.inventoryCombos.push(createdCombo);
        return state;
      });

      return createdCombo;
    },
    updateCombo: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) {
        throw new Error('Debe enviar el id del combo.');
      }

      let updatedCombo = null;
      transaction((state) => {
        state.inventoryCombos = Array.isArray(state.inventoryCombos) ? state.inventoryCombos : [];
        const combo = state.inventoryCombos.find((entry) => entry.id === id && !entry.deletedAt);
        if (!combo) {
          throw new Error('No se encontro el combo seleccionado.');
        }

        if (payload.name !== undefined) {
          const nextName = toBusinessUppercase(payload.name);
          if (!nextName) throw new Error('El nombre del combo no puede estar vacio.');
          if (state.inventoryCombos.some((entry) => entry.id !== id && !entry.deletedAt && normalizeText(entry.name) === normalizeText(nextName))) {
            throw new Error('Ya existe otro combo con ese nombre.');
          }
          combo.name = nextName;
        }
        if (payload.category !== undefined) {
          combo.category = toBusinessUppercase(payload.category ?? 'COMBOS') || 'COMBOS';
        }
        if (payload.rentalPriceBs !== undefined || payload.priceBs !== undefined) {
          const nextPrice = toNumber(payload.rentalPriceBs ?? payload.priceBs ?? 0, 'precio del combo');
          if (nextPrice < 0) throw new Error('El precio del combo no puede ser negativo.');
          combo.rentalPriceBs = nextPrice;
        }
        if (payload.pricingCondition !== undefined) {
          combo.pricingCondition = normalizeComboPricingCondition(payload.pricingCondition);
        }
        if (payload.notes !== undefined) {
          combo.notes = String(payload.notes ?? '').trim();
        }
        if (payload.imageDataUrl !== undefined) {
          if (
            payload.imageDataUrl
            && (typeof payload.imageDataUrl !== 'string' || !payload.imageDataUrl.startsWith('data:image/'))
          ) {
            throw new Error('La imagen enviada no es valida.');
          }
          combo.imageDataUrl = payload.imageDataUrl;
        }
        if (payload.imageUrl !== undefined) {
          const nextImageUrl = String(payload.imageUrl ?? '').trim() || null;
          if (nextImageUrl && !nextImageUrl.startsWith('/uploads/products/')) {
            throw new Error('La URL de imagen enviada no es valida.');
          }
          combo.imageUrl = nextImageUrl;
          if (nextImageUrl) combo.imageDataUrl = null;
        }
        if (payload.ingredients !== undefined) {
          const ingredients = dedupeComboIngredients(
            (Array.isArray(payload.ingredients) ? payload.ingredients : [])
              .map((line) => normalizeComboRule(line, state.items))
              .filter(Boolean),
          );
          if (ingredients.length === 0) {
            throw new Error('Agrega al menos un producto existente al combo.');
          }
          combo.ingredients = ingredients;
        }
        combo.updatedAt = new Date().toISOString();
        updatedCombo = deepClone(combo);
        return state;
      });

      return updatedCombo;
    },
    removeCombo: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) {
        throw new Error('Debe enviar el id del combo.');
      }

      let deletedCombo = null;
      transaction((state) => {
        state.inventoryCombos = Array.isArray(state.inventoryCombos) ? state.inventoryCombos : [];
        const combo = state.inventoryCombos.find((entry) => entry.id === id && !entry.deletedAt);
        if (!combo) {
          throw new Error('No se encontro el combo seleccionado.');
        }
        combo.deletedAt = new Date().toISOString();
        combo.status = 'deleted';
        combo.updatedAt = combo.deletedAt;
        deletedCombo = deepClone(combo);
        return state;
      });

      return deletedCombo;
    },
    createMovement: async (payload) => {
      const itemId = payload?.itemId;
      const type = String(payload?.type ?? '').trim();
      const reason = String(payload?.reason ?? '').trim();
      const userName = String(payload?.userName ?? payload?.createdByName ?? payload?.createdBy ?? '').trim() || 'Sistema';
      const userRole = String(payload?.userRole ?? payload?.createdByRole ?? '').trim() || 'Operacion';
      const quantity = payload?.quantity !== undefined ? toInteger(payload.quantity, 'cantidad') : 0;
      const targetTotalStock =
        payload?.targetTotalStock !== undefined ? toInteger(payload.targetTotalStock, 'stock fisico') : null;

      if (!itemId) {
        throw new Error('Debes seleccionar un item para registrar movimiento.');
      }
      if (!['entrada', 'salida', 'ajuste'].includes(type)) {
        throw new Error('Tipo de movimiento invalido.');
      }
      if (!reason) {
        throw new Error('Debes registrar el motivo del movimiento.');
      }

      let createdMovement = null;
      transaction((state) => {
        const item = state.items.find((entry) => entry.id === itemId);
        if (!item) {
          throw new Error('El item seleccionado no existe.');
        }

        const beforeTotalStock = Math.max(0, Math.trunc(Number(item.totalStock ?? 0)));
        const beforeAvailableStock = Math.max(0, Math.trunc(Number(item.availableStock ?? 0)));
        const {
          reservedStock,
          recoveryStock,
          minimumPhysicalStock,
        } = getInventoryStockCommitment(state, item.id);
        const realAvailableStock = Math.max(0, beforeTotalStock - minimumPhysicalStock);

        let deltaUnits = 0;
        let movementDetail = '';

        if (type === 'entrada') {
          if (quantity <= 0) {
            throw new Error('La cantidad de entrada debe ser mayor a 0.');
          }
          deltaUnits = quantity;
          movementDetail = `Entrada de ${quantity} unidades`;
          item.totalStock = beforeTotalStock + quantity;
          item.availableStock = Math.max(0, item.totalStock - minimumPhysicalStock);
        }

        if (type === 'salida') {
          if (quantity <= 0) {
            throw new Error('La cantidad de salida debe ser mayor a 0.');
          }
          if (quantity > realAvailableStock) {
            throw new Error(`No hay stock fisico libre suficiente para salida. Disponible real: ${realAvailableStock}.`);
          }
          deltaUnits = -quantity;
          movementDetail = `Salida de ${quantity} unidades`;
          item.totalStock = beforeTotalStock - quantity;
          item.availableStock = Math.max(0, item.totalStock - minimumPhysicalStock);
        }

        if (type === 'ajuste') {
          if (targetTotalStock === null) {
            throw new Error('Debes indicar el stock fisico final para el ajuste.');
          }
          if (targetTotalStock < minimumPhysicalStock) {
            throw new Error(
              `El stock fisico no puede ser menor a ${minimumPhysicalStock}: `
              + `${reservedStock} comprometido(s) y ${recoveryStock} en mantenimiento o recuperacion.`,
            );
          }
          deltaUnits = targetTotalStock - beforeTotalStock;
          movementDetail = `Ajuste de stock fisico final a ${targetTotalStock}`;
          item.totalStock = targetTotalStock;
          item.availableStock = Math.max(0, targetTotalStock - minimumPhysicalStock);
        }

        item.updatedAt = new Date().toISOString();

        createdMovement = {
          id: makeId('mov'),
          itemId: item.id,
          itemName: item.name,
          category: item.category,
          type,
          reason,
          detail: movementDetail,
          deltaUnits,
          beforeTotalStock,
          afterTotalStock: item.totalStock,
          beforeAvailableStock,
          afterAvailableStock: item.availableStock,
          reservedStockAfter: reservedStock,
          recoveryStockAfter: recoveryStock,
          minimumPhysicalStockAfter: minimumPhysicalStock,
          userName,
          userRole,
          createdAt: new Date().toISOString(),
        };

        state.inventoryMovements.push(createdMovement);
        return state;
      });

      return createdMovement;
    },
    processRecovery: async (payload) => {
      const recoveryId = String(payload?.recoveryId ?? '').trim();
      const action = String(payload?.action ?? '').trim();
      const quantity = toInteger(payload?.quantity ?? 0, 'cantidad');
      const note = String(payload?.note ?? '').trim();

      if (!recoveryId) {
        throw new Error('Debes seleccionar un pendiente para procesar.');
      }
      if (!['reinsert', 'discard'].includes(action)) {
        throw new Error('La accion de reinsercion no es valida.');
      }
      if (quantity <= 0) {
        throw new Error('La cantidad a procesar debe ser mayor a 0.');
      }

      let processedResult = null;
      transaction((state) => {
        const recoveryIndex = state.stockRecoveries.findIndex((entry) => entry.id === recoveryId);
        if (recoveryIndex < 0) {
          throw new Error('No se encontro el pendiente seleccionado.');
        }

        const recovery = state.stockRecoveries[recoveryIndex];
        if (quantity > recovery.quantity) {
          throw new Error(`La cantidad maxima para este pendiente es ${recovery.quantity}.`);
        }

        const item = state.items.find((entry) => entry.id === recovery.itemId);
        if (!item) {
          throw new Error('El item asociado ya no existe.');
        }

        const beforeTotalStock = item.totalStock;
        const beforeAvailableStock = item.availableStock;
        const now = new Date().toISOString();

        if (action === 'reinsert') {
          item.availableStock += quantity;
          if (item.availableStock > item.totalStock) {
            throw new Error('La reinsercion supera el stock total del item.');
          }
        } else {
          if (item.totalStock - quantity < item.availableStock) {
            throw new Error('No se puede dar de baja mas unidades de las no disponibles.');
          }
          item.totalStock -= quantity;
        }

        item.updatedAt = now;
        recovery.quantity -= quantity;
        recovery.updatedAt = now;

        if (recovery.quantity <= 0) {
          state.stockRecoveries.splice(recoveryIndex, 1);
        }

        state.inventoryMovements.push({
          id: makeId('mov'),
          itemId: item.id,
          itemName: item.name,
          category: item.category,
          type: action === 'reinsert' ? 'reinsercion' : 'salida',
          reason:
            note
            || (action === 'reinsert'
              ? `Reinsercion desde ${recovery.stage === 'lavado' ? 'lavado' : 'reparacion'}`
              : `Baja definitiva desde ${recovery.stage === 'lavado' ? 'lavado' : 'reparacion'}`),
          detail:
            action === 'reinsert'
              ? `Reinsertadas ${quantity} unidades (${recovery.stage})`
              : `Baja definitiva de ${quantity} unidades (${recovery.stage})`,
          deltaUnits: action === 'reinsert' ? 0 : -quantity,
          beforeTotalStock,
          afterTotalStock: item.totalStock,
          beforeAvailableStock,
          afterAvailableStock: item.availableStock,
          reservedStockAfter: item.totalStock - item.availableStock,
          createdAt: now,
        });

        processedResult = {
          recoveryId,
          action,
          quantity,
          itemId: item.id,
        };
        return state;
      });

      return processedResult;
    },
  },

  categories: {
    list: async () => {
      const { categories } = readQueryState();
      return categories.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },
    create: async (payload) => {
      const name = toBusinessUppercase(payload?.name ?? '');
      const icon = String(payload?.icon ?? 'box').trim() || 'box';
      const color = String(payload?.color ?? '#5d59e0').trim() || '#5d59e0';
      if (!name) {
        throw new Error('El nombre de categoria es obligatorio.');
      }

      let createdCategory = null;
      transaction((state) => {
        const exists = state.categories.some(
          (category) => normalizeText(category.name) === normalizeText(name),
        );

        if (exists) {
          throw new Error('Esa categoria ya existe.');
        }

        createdCategory = {
          id: makeId('cat'),
          name,
          icon,
          color,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.categories.push(createdCategory);
        return state;
      });

      return createdCategory;
    },
    update: async (payload) => {
      const categoryId = String(payload?.id ?? '').trim();
      const name = toBusinessUppercase(payload?.name ?? '');
      const icon = String(payload?.icon ?? 'box').trim() || 'box';
      const color = String(payload?.color ?? '#5d59e0').trim() || '#5d59e0';

      if (!categoryId) {
        throw new Error('No se pudo identificar la categoria.');
      }
      if (!name) {
        throw new Error('El nombre de categoria es obligatorio.');
      }

      let updatedCategory = null;
      transaction((state) => {
        const index = state.categories.findIndex((entry) => entry.id === categoryId);
        if (index === -1) {
          throw new Error('La categoria no existe.');
        }

        const exists = state.categories.some(
          (entry, entryIndex) =>
            entryIndex !== index
            && normalizeText(entry.name) === normalizeText(name),
        );
        if (exists) {
          throw new Error('Ya existe otra categoria con ese nombre.');
        }

        const previousName = state.categories[index].name;
        const now = new Date().toISOString();
        state.categories[index] = {
          ...state.categories[index],
          name,
          icon,
          color,
          updatedAt: now,
        };

        if (previousName !== name) {
          state.items = state.items.map((item) =>
            item.category === previousName
              ? { ...item, category: name }
              : item,
          );
        }

        updatedCategory = { ...state.categories[index] };
        return state;
      });

      return updatedCategory;
    },
    remove: async (payload) => {
      const categoryId = String(payload?.id ?? '').trim();
      if (!categoryId) {
        throw new Error('No se pudo identificar la categoria.');
      }

      let removedCategory = null;
      transaction((state) => {
        const index = state.categories.findIndex((entry) => entry.id === categoryId);
        if (index === -1) {
          throw new Error('La categoria no existe.');
        }
        if (state.categories.length <= 1) {
          throw new Error('Debe existir al menos una categoria activa.');
        }

        const target = state.categories[index];
        const linkedItems = state.items.filter((item) => item.category === target.name);
        if (linkedItems.length > 0) {
          throw new Error('No puedes eliminar una categoria con productos asociados.');
        }

        removedCategory = { ...target };
        state.categories.splice(index, 1);
        return state;
      });

      return removedCategory;
    },
  },

  clients: {
    list: async () => {
      const state = readQueryState();
      const metrics = computeClientMetrics(state);
      return state.clients
        .map((client) => {
          const summary = metrics.byClientId[client.id] ?? {
            ordersCount: 0,
            totalBilledBs: 0,
            lastOrderAt: null,
          };

          return {
            ...client,
            ordersCount: summary.ordersCount,
            totalBilledBs: Number(summary.totalBilledBs.toFixed(2)),
            lastOrderAt: summary.lastOrderAt,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },
    create: async (payload) => {
      const name = String(payload?.name ?? '').trim();
      const phone = String(payload?.phone ?? '').trim();
      const email = String(payload?.email ?? '').trim().toLowerCase();
      const customerType = String(payload?.customerType ?? 'persona').trim() || 'persona';
      const nitCi = String(payload?.nitCi ?? '').trim();
      if (!name) throw new Error('El nombre del cliente es obligatorio.');
      if (!phone) throw new Error('El telefono del cliente es obligatorio.');
      if (customerType === 'empresa' && !String(payload?.companyName ?? '').trim()) {
        throw new Error('La razon social es obligatoria para cliente empresa.');
      }

      let created = null;
      transaction((state) => {
        if (email && state.clients.some((client) => client.email === email)) {
          throw new Error('Ya existe un cliente con ese email.');
        }

        const now = new Date().toISOString();
        const prepaidEnabled = Boolean(payload?.prepaidEnabled);
        const prepaidOpeningBs = prepaidEnabled ? Math.max(0, toPositiveRoundedNumber(payload?.prepaidOpeningBs ?? payload?.prepaidBalanceBs ?? 0)) : 0;
        const prepaidMovements = prepaidOpeningBs > 0
          ? [{
            id: makeId('pre'),
            type: 'deposit',
            amountBs: prepaidOpeningBs,
            description: String(payload?.prepaidTopUpNotes ?? 'Saldo inicial prepago historico').trim() || 'Saldo inicial prepago historico',
            sourceType: 'client',
            sourceId: null,
            orderCode: null,
            balanceAfterBs: prepaidOpeningBs,
            nonPhysical: true,
            createdAt: now,
          }]
          : [];
        created = {
          id: makeId('cli'),
          customerType,
          name,
          companyName: String(payload?.companyName ?? name).trim(),
          contactName: String(payload?.contactName ?? name).trim(),
          contactRole: String(payload?.contactRole ?? 'Contacto').trim(),
          nitCi,
          phone,
          whatsapp: String(payload?.whatsapp ?? phone).trim(),
          referencePhone: String(payload?.referencePhone ?? '').trim(),
          email,
          address: String(payload?.address ?? '').trim(),
          city: String(payload?.city ?? '').trim(),
          observations: String(payload?.observations ?? '').trim(),
          isBlacklisted: Boolean(payload?.isBlacklisted),
          blacklistReason: payload?.isBlacklisted ? normalizeBlacklistReason(payload?.blacklistReason) : '',
          blacklistNotes: payload?.isBlacklisted ? String(payload?.blacklistNotes ?? '').trim() : '',
          blacklistedAt: payload?.isBlacklisted ? now : null,
          prepaidEnabled,
          prepaidBalanceBs: prepaidOpeningBs,
          prepaidTotalDepositedBs: prepaidOpeningBs,
          prepaidTotalUsedBs: 0,
          prepaidMovements,
          deliveryAddresses: Array.isArray(payload?.deliveryAddresses)
            ? payload.deliveryAddresses
              .map((entry) => ({
                id: entry?.id ?? makeId('addr'),
                label: String(entry?.label ?? 'Principal').trim() || 'Principal',
                address: String(entry?.address ?? '').trim(),
                city: String(entry?.city ?? '').trim(),
                reference: String(entry?.reference ?? '').trim(),
                isPrimary: Boolean(entry?.isPrimary),
              }))
              .filter((entry) => entry.address || entry.city)
            : [],
          attachments: Array.isArray(payload?.attachments)
            ? payload.attachments
              .map((entry) => ({
                id: entry?.id ?? makeId('att'),
                name: String(entry?.name ?? '').trim(),
                mimeType: String(entry?.mimeType ?? '').trim(),
                size: Number(entry?.size ?? 0),
                dataUrl: entry?.dataUrl ?? null,
                url: entry?.url ?? null,
                uploadedAt: entry?.uploadedAt ?? now,
              }))
              .filter((entry) => entry.name)
            : [],
          status: String(payload?.status ?? 'active').trim() || 'active',
          createdAt: now,
          updatedAt: now,
        };
        state.clients.push(created);
        return state;
      });

      return created;
    },
    update: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el cliente a actualizar.');

      let updated = null;
      transaction((state) => {
        const client = state.clients.find((entry) => entry.id === id);
        if (!client) throw new Error('Cliente no encontrado.');

        if (payload.name !== undefined) client.name = String(payload.name ?? '').trim() || client.name;
        if (payload.companyName !== undefined) {
          client.companyName = String(payload.companyName ?? '').trim() || client.companyName;
        }
        if (payload.contactName !== undefined) {
          client.contactName = String(payload.contactName ?? '').trim() || client.contactName;
        }
        if (payload.contactRole !== undefined) {
          client.contactRole = String(payload.contactRole ?? '').trim() || client.contactRole;
        }
        if (payload.customerType !== undefined) {
          client.customerType = String(payload.customerType ?? '').trim() || client.customerType;
        }
        if (payload.nitCi !== undefined) {
          client.nitCi = String(payload.nitCi ?? '').trim();
        }
        if (payload.phone !== undefined) {
          const nextPhone = String(payload.phone ?? '').trim();
          if (!nextPhone) throw new Error('El telefono no puede estar vacio.');
          client.phone = nextPhone;
        }
        if (payload.whatsapp !== undefined) {
          client.whatsapp = String(payload.whatsapp ?? '').trim();
        }
        if (payload.referencePhone !== undefined) {
          client.referencePhone = String(payload.referencePhone ?? '').trim();
        }
        if (payload.email !== undefined) {
          const nextEmail = String(payload.email ?? '').trim().toLowerCase();
          const duplicate = state.clients.some((entry) => entry.id !== id && entry.email === nextEmail);
          if (nextEmail && duplicate) throw new Error('Ya existe otro cliente con ese email.');
          client.email = nextEmail;
        }
        if (payload.address !== undefined) {
          client.address = String(payload.address ?? '').trim();
        }
        if (payload.city !== undefined) {
          client.city = String(payload.city ?? '').trim();
        }
        if (payload.observations !== undefined) {
          client.observations = String(payload.observations ?? '').trim();
        }
        if (payload.isBlacklisted !== undefined) {
          const nextIsBlacklisted = Boolean(payload.isBlacklisted);
          client.isBlacklisted = nextIsBlacklisted;
          client.blacklistedAt = nextIsBlacklisted ? client.blacklistedAt ?? new Date().toISOString() : null;
          if (!nextIsBlacklisted) {
            client.blacklistReason = '';
            client.blacklistNotes = '';
          }
        }
        if (payload.blacklistReason !== undefined) {
          client.blacklistReason = client.isBlacklisted
            ? normalizeBlacklistReason(payload.blacklistReason)
            : '';
        }
        if (payload.blacklistNotes !== undefined) {
          client.blacklistNotes = client.isBlacklisted ? String(payload.blacklistNotes ?? '').trim() : '';
        }
        if (payload.prepaidEnabled !== undefined) {
          client.prepaidEnabled = Boolean(payload.prepaidEnabled);
          client.prepaidBalanceBs = Math.max(0, toPositiveRoundedNumber(client.prepaidBalanceBs ?? 0));
          client.prepaidTotalDepositedBs = Math.max(0, toPositiveRoundedNumber(client.prepaidTotalDepositedBs ?? 0));
          client.prepaidTotalUsedBs = Math.max(0, toPositiveRoundedNumber(client.prepaidTotalUsedBs ?? 0));
          client.prepaidMovements = normalizePrepaidMovements(client.prepaidMovements, client.prepaidBalanceBs);
        }
        const prepaidTopUpBs = Math.max(0, toPositiveRoundedNumber(payload?.prepaidTopUpBs ?? 0));
        if (prepaidTopUpBs > 0) {
          client.prepaidEnabled = true;
          client.prepaidBalanceBs = Math.max(0, toPositiveRoundedNumber(client.prepaidBalanceBs ?? 0));
          client.prepaidTotalDepositedBs = Math.max(0, toPositiveRoundedNumber(client.prepaidTotalDepositedBs ?? 0));
          client.prepaidTotalUsedBs = Math.max(0, toPositiveRoundedNumber(client.prepaidTotalUsedBs ?? 0));
          client.prepaidMovements = normalizePrepaidMovements(client.prepaidMovements, client.prepaidBalanceBs);
          const nextBalance = Number((client.prepaidBalanceBs + prepaidTopUpBs).toFixed(2));
          client.prepaidBalanceBs = nextBalance;
          client.prepaidTotalDepositedBs = Number((client.prepaidTotalDepositedBs + prepaidTopUpBs).toFixed(2));
          client.prepaidMovements.push({
            id: makeId('pre'),
            type: 'deposit',
            amountBs: prepaidTopUpBs,
            description: String(payload?.prepaidTopUpNotes ?? 'Abono prepago').trim() || 'Abono prepago',
            sourceType: 'client',
            sourceId: client.id,
            orderCode: null,
            balanceAfterBs: nextBalance,
            createdAt: new Date().toISOString(),
          });
          state.cashMovements.push(buildCashMovement({
            sessionId: getActiveSession(state)?.id ?? null,
            type: 'ingreso_prepago_cliente',
            amountBs: prepaidTopUpBs,
            description: `Abono prepago cliente: ${client.name}`,
            sourceType: 'client',
            sourceId: client.id,
            cashBoxType: CASH_BOX_TYPES.BIG_CASH,
          }));
        }
        if (payload.deliveryAddresses !== undefined) {
          client.deliveryAddresses = Array.isArray(payload.deliveryAddresses)
            ? payload.deliveryAddresses
              .map((entry) => ({
                id: entry?.id ?? makeId('addr'),
                label: String(entry?.label ?? 'Principal').trim() || 'Principal',
                address: String(entry?.address ?? '').trim(),
                city: String(entry?.city ?? '').trim(),
                reference: String(entry?.reference ?? '').trim(),
                isPrimary: Boolean(entry?.isPrimary),
              }))
              .filter((entry) => entry.address || entry.city)
            : [];
        }
        if (payload.attachments !== undefined) {
          client.attachments = Array.isArray(payload.attachments)
            ? payload.attachments
              .map((entry) => ({
                id: entry?.id ?? makeId('att'),
                name: String(entry?.name ?? '').trim(),
                mimeType: String(entry?.mimeType ?? '').trim(),
                size: Number(entry?.size ?? 0),
                dataUrl: entry?.dataUrl ?? null,
                url: entry?.url ?? null,
                uploadedAt: entry?.uploadedAt ?? new Date().toISOString(),
              }))
              .filter((entry) => entry.name)
            : [];
        }
        if (payload.status !== undefined) {
          client.status = String(payload.status ?? '').trim() || client.status;
        }
        client.updatedAt = new Date().toISOString();
        updated = deepClone(client);
        return state;
      });

      return updated;
    },
  },

  users: {
    list: async () => {
      const { users } = readQueryState();
      const currentUserId = readSessionUserId();
      return users
        .filter((user) => !user.deletedAt)
        .map((user) => ({
          ...user,
          isCurrentUser: Boolean(currentUserId && user.id === currentUserId),
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
    },
    create: async (payload) => {
      const fullName = String(payload?.fullName ?? '').trim();
      const username = normalizeUsername(payload?.username);
      const password = String(payload?.password ?? '').trim();
      const roleIds = normalizeRoleIds(payload?.roleIds ?? payload?.roleId ?? payload?.role ?? 'ventas');
      const roleId = roleIds.includes('developer')
        ? 'developer'
        : roleIds.includes('super_admin')
          ? 'super_admin'
          : roleIds[0];
      if (!fullName) throw new Error('El nombre del usuario es obligatorio.');
      if (!username) throw new Error('El usuario de acceso es obligatorio.');
      if (!password || password.length < 4) throw new Error('La contrasena debe tener al menos 4 caracteres.');

      let created = null;
      transaction((state) => {
        assertDeveloperUserManagementAccess(state);
        if (state.users.some((user) => user.username === username)) {
          throw new Error('Ya existe un usuario con ese nombre de usuario.');
        }

        const now = new Date().toISOString();
        created = {
          id: makeId('usr'),
          fullName,
          username,
          passwordHash: hashPassword(password),
          mustChangePassword: false,
          passwordChangedAt: now,
          roleId,
          roleIds,
          role: getDisplayRoleForIds(roleIds),
          permissions: normalizeUserPermissions(payload?.permissions),
          status: String(payload?.status ?? 'active').trim() || 'active',
          phone: String(payload?.phone ?? '').trim(),
          isCurrentUser: false,
          invitedAt: null,
          lastAccessAt: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.users.push(created);
        return state;
      });

      return created;
    },
    update: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el usuario.');

      let updated = null;
      transaction((state) => {
        assertDeveloperUserManagementAccess(state);
        const user = state.users.find((entry) => entry.id === id);
        if (!user) throw new Error('Usuario no encontrado.');
        if (readSessionUserId() === user.id && payload.status === 'suspended') {
          throw new Error('No puedes suspender al usuario actual.');
        }

        const activeDevelopersBefore = state.users.filter((entry) =>
          !entry.deletedAt
          && entry.status === 'active'
          && isDeveloperUser(entry)
        );
        if (
          isDeveloperUser(user)
          && payload.status === 'suspended'
          && activeDevelopersBefore.length <= 1
        ) {
          throw new Error('No puedes suspender al ultimo usuario developer.');
        }

        if (payload.fullName !== undefined) user.fullName = String(payload.fullName ?? '').trim() || user.fullName;
        if (payload.username !== undefined) {
          const nextUsername = normalizeUsername(payload.username);
          if (!nextUsername) throw new Error('El usuario de acceso no puede estar vacio.');
          const duplicated = state.users.some((entry) => entry.id !== id && entry.username === nextUsername);
          if (duplicated) throw new Error('Ya existe otro usuario con ese nombre de usuario.');
          user.username = nextUsername;
        }
        if (payload.password !== undefined && String(payload.password ?? '').trim()) {
          const nextPassword = String(payload.password ?? '').trim();
          if (nextPassword.length < 4) throw new Error('La contrasena debe tener al menos 4 caracteres.');
          user.passwordHash = hashPassword(nextPassword);
          user.mustChangePassword = false;
          user.passwordChangedAt = new Date().toISOString();
        }
        if (payload.roleIds !== undefined || payload.role !== undefined || payload.roleId !== undefined) {
          const roleIds = normalizeRoleIds(payload.roleIds ?? payload.roleId ?? payload.role);
          const activeDevelopers = state.users.filter((entry) =>
            !entry.deletedAt
            && entry.status === 'active'
            && isDeveloperUser(entry)
          );
          if (isDeveloperUser(user) && !roleIds.includes('developer') && activeDevelopers.length <= 1) {
            throw new Error('No puedes quitar el rol developer al ultimo usuario developer.');
          }
          const roleId = roleIds.includes('developer')
            ? 'developer'
            : roleIds.includes('super_admin')
              ? 'super_admin'
              : roleIds[0];
          user.roleId = roleId;
          user.roleIds = roleIds;
          user.role = getDisplayRoleForIds(roleIds);
        }
        if (payload.status !== undefined) user.status = String(payload.status ?? '').trim() || user.status;
        if (payload.phone !== undefined) user.phone = String(payload.phone ?? '').trim();
        if (payload.permissions !== undefined) user.permissions = normalizeUserPermissions(payload.permissions);
        user.updatedAt = new Date().toISOString();
        updated = deepClone(user);
        return state;
      });

      return updated;
    },
    cancel: async (payload) => {
      const id = String(payload?.id ?? payload?.rentalId ?? '').trim();
      const contractId = String(payload?.contractId ?? '').trim();
      if (!id && !contractId) {
        throw new Error('No se pudo identificar el contrato u orden de servicio a anular.');
      }

      let cancelled = null;
      transaction((state) => {
        const nowIso = new Date().toISOString();
        const todayKey = toDateKey(nowIso);

        const linkedContractFromId = contractId
          ? state.contracts.find((entry) => entry.id === contractId && !entry.deletedAt)
          : null;
        const rental = id
          ? state.rentals.find((entry) => entry.id === id && !entry.deletedAt)
          : state.rentals.find((entry) =>
            !entry.deletedAt
            && linkedContractFromId
            && (
              (linkedContractFromId.rentalId && entry.id === linkedContractFromId.rentalId)
              || (linkedContractFromId.orderCode && entry.orderCode === linkedContractFromId.orderCode)
            ),
          );

        if (!rental) {
          throw new Error('Orden de servicio no encontrada.');
        }
        if (rental.status === 'returned') {
          throw new Error('No se puede anular una orden ya devuelta.');
        }
        if (rental.status === 'cancelled') {
          throw new Error('Esta orden ya fue anulada.');
        }

        const linkedContract = linkedContractFromId ?? state.contracts.find((entry) =>
          !entry.deletedAt
          && (
            (entry.rentalId && entry.rentalId === rental.id)
            || (entry.orderCode && rental.orderCode && entry.orderCode === rental.orderCode)
          ),
        ) ?? null;

        const cutoffDate =
          linkedContract?.deliveryDate
          ?? rental.rentalDate
          ?? linkedContract?.eventDate
          ?? null;
        if (!cutoffDate) {
          throw new Error('No se pudo validar la fecha limite de anulacion para este contrato.');
        }

        const isWithinCancellationWindow = isSameOrBeforeDay(todayKey, cutoffDate);
        const operational = rental.operational ?? {};
        const inventoryStatus = normalizeText(operational.inventoryStatus ?? '');
        const transportStatus = normalizeText(operational.transportStatus ?? '');
        const wasOperationallySent = Boolean(
          operational.inventorySentAt
          || operational.inventoryDispatchedAt
          || operational.transportSentAt
          || ['salio', 'enviado', 'en_ruta', 'entregado', 'devuelto'].includes(inventoryStatus)
          || ['salio', 'enviado', 'en_ruta', 'entregado', 'devuelto'].includes(transportStatus)
          || rental.returnedAt
          || Array.isArray(rental.returnReport),
        );
        const collectedBs = Math.max(
          Number(rental?.payment?.paidAtRentalBs ?? 0),
          Number(rental?.totals?.paidAtRentalBs ?? 0),
          Number(rental?.payment?.cashCollectedBs ?? 0),
          Number(rental?.payment?.rentalCollectedBs ?? 0),
          Number(rental?.payment?.deliveryFeeCollectedBs ?? 0),
          0,
        );
        const guaranteeWasCollected = ['pagada', 'pagado', 'validada', 'validado', 'retenida', 'retenido']
          .includes(normalizeText(rental?.payment?.guaranteeStatus ?? linkedContract?.guarantee?.status ?? ''));
        const canCancelUnfulfilledAfterCutoff = !wasOperationallySent && collectedBs <= 0 && !guaranteeWasCollected;

        if (!isWithinCancellationWindow && !canCancelUnfulfilledAfterCutoff) {
          throw new Error(
            `El plazo de anulacion vencio el ${toDateKey(cutoffDate)}. `
            + 'Solo puede anularse despues de esa fecha cuando la orden nunca salio, no fue entregada y no registra cobros.',
          );
        }

        const totalBs = Number(linkedContract?.totals?.totalBs ?? rental?.totals?.totalBs ?? 0);
        const settings = state.settings ?? {};
        const configuredPenaltyPercent = Math.max(0, Number(settings.contractCancellationPenaltyPercent ?? 20));
        const penaltyPercent = isWithinCancellationWindow ? configuredPenaltyPercent : 0;
        const penaltyBs = Number((totalBs * (penaltyPercent / 100)).toFixed(2));
        const reason = String(payload?.reason ?? '').trim();
        if (!reason) {
          throw new Error('Debes indicar por que se esta anulando el contrato.');
        }
        const userName = String(payload?.userName ?? payload?.createdByName ?? payload?.createdBy ?? '').trim() || 'Sistema';
        const userRole = String(payload?.userRole ?? payload?.createdByRole ?? '').trim() || 'Operacion';

        (rental.items ?? []).forEach((line) => {
          const item = state.items.find((entry) => entry.id === line.itemId);
          if (!item || lineControlsStock(line, item) === false) return;
          const reservedQty = Number.isFinite(Number(line.internalReservedQty))
            ? Math.max(0, Math.trunc(Number(line.internalReservedQty)))
            : Math.max(0, Math.trunc(Number(line.quantity ?? 0)));
          if (reservedQty <= 0) return;

          const beforeTotalStock = Number(item.totalStock ?? 0);
          const beforeAvailableStock = Number(item.availableStock ?? 0);
          item.availableStock = Math.min(beforeTotalStock, beforeAvailableStock + reservedQty);
          item.updatedAt = nowIso;

          state.inventoryMovements.push({
            id: makeId('mov'),
            itemId: item.id,
            itemName: item.name,
            category: item.category,
            type: 'reinsercion',
            reason: `Anulacion de contrato ${linkedContract?.contractCode ?? rental.orderCode}`,
            detail: `Reintegro de ${reservedQty} unidades por anulacion de ${rental.orderCode}`,
            reference: rental.orderCode,
            deltaUnits: reservedQty,
            beforeTotalStock,
            afterTotalStock: beforeTotalStock,
            beforeAvailableStock,
            afterAvailableStock: item.availableStock,
            reservedStockAfter: item.totalStock - item.availableStock,
            userName,
            userRole,
            createdAt: nowIso,
            status: 'cancelado',
          });
        });

        state.deliveries.forEach((delivery) => {
          if (delivery.deletedAt) return;
          if (delivery.rentalId === rental.id || delivery.orderCode === rental.orderCode) {
            delivery.status = 'cancelada';
            delivery.progress = 0;
            delivery.updatedAt = nowIso;
            if (!String(delivery.notes ?? '').includes('[ANULADO]')) {
              delivery.notes = `${String(delivery.notes ?? '').trim()} [ANULADO]`.trim();
            }
          }
        });

        rental.status = 'cancelled';
        rental.cancelledAt = nowIso;
        rental.cancellationPenaltyPercent = penaltyPercent;
        rental.cancellationPenaltyBs = penaltyBs;
        rental.cancellationReason = reason;
        rental.cancellationCutoffDate = toDateKey(cutoffDate);
        rental.penaltiesBs = Number((Number(rental.penaltiesBs ?? 0) + penaltyBs).toFixed(2));
        rental.operational = {
          ...(rental.operational ?? {}),
          inventoryStatus: 'anulado',
          transportStatus: 'anulado',
          inventoryNote: reason || rental.operational?.inventoryNote || '',
          transportNote: reason || rental.operational?.transportNote || '',
        };
        rental.updatedAt = nowIso;

        if (linkedContract) {
          linkedContract.status = 'anulado';
          linkedContract.cancelledAt = nowIso;
          linkedContract.cancellationPenaltyPercent = penaltyPercent;
          linkedContract.cancellationPenaltyBs = penaltyBs;
          linkedContract.cancellationReason = reason;
          linkedContract.cancellationCutoffDate = toDateKey(cutoffDate);
          linkedContract.updatedAt = nowIso;
          appendContractRevision(linkedContract, payload, nowIso, [
            `Contrato anulado por ${userName}`,
            `Motivo: ${reason}`,
            `Items liberados de inventario para ${rental.orderCode}`,
            `Numero de contrato conservado: ${linkedContract.contractCode}`,
          ]);
        }

        cancelled = deepClone({
          ...rental,
          contractId: linkedContract?.id ?? null,
          contractCode: linkedContract?.contractCode ?? null,
        });
        return state;
      });

      return cancelled;
    },
    remove: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el usuario.');

      let removed = null;
      transaction((state) => {
        assertDeveloperUserManagementAccess(state);
        const user = state.users.find((entry) => entry.id === id && !entry.deletedAt);
        if (!user) throw new Error('Usuario no encontrado.');
        if (readSessionUserId() === user.id) {
          throw new Error('No puedes eliminar al usuario actual.');
        }
        if (isDeveloperUser(user)) {
          const activeDevelopers = state.users.filter((entry) =>
            !entry.deletedAt
            && entry.status === 'active'
            && isDeveloperUser(entry)
          );
          if (activeDevelopers.length <= 1) {
            throw new Error('No puedes eliminar al ultimo usuario developer.');
          }
        }
        const activeAdminsAfter = state.users.filter((entry) =>
          entry.id !== id
          && !entry.deletedAt
          && entry.status === 'active'
          && getUserRoleIds(entry).some((roleId) => ['developer', 'super_admin', 'admin'].includes(roleId))
        );
        if (activeAdminsAfter.length === 0) {
          throw new Error('No puedes dejar el sistema sin usuarios administrativos activos.');
        }
        user.deletedAt = new Date().toISOString();
        user.status = 'suspended';
        user.updatedAt = user.deletedAt;
        removed = deepClone(user);
        return state;
      });

      return removed;
    },
    resendInvite: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el usuario.');

      let result = null;
      transaction((state) => {
        assertDeveloperUserManagementAccess(state);
        const user = state.users.find((entry) => entry.id === id);
        if (!user) throw new Error('Usuario no encontrado.');
        user.status = 'invited';
        user.invitedAt = new Date().toISOString();
        user.updatedAt = new Date().toISOString();
        result = deepClone(user);
        return state;
      });

      return result;
    },
  },

  personnel: {
    listBundle: async () => {
      const state = readQueryState();
      return {
        employees: state.personnelEmployees
          .filter((row) => !row.deletedAt)
          .slice()
          .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es')),
        attendance: state.personnelAttendance
          .slice()
          .sort((a, b) => new Date(`${b.date}T${b.checkIn || '00:00'}`) - new Date(`${a.date}T${a.checkIn || '00:00'}`)),
        incidents: state.personnelIncidents
          .filter((row) => !row.deletedAt)
          .slice()
          .sort((a, b) => new Date(b.dateFrom || b.createdAt) - new Date(a.dateFrom || a.createdAt)),
      };
    },
    createEmployee: async (payload) => {
      const fullName = String(payload?.fullName ?? '').trim();
      if (!fullName) throw new Error('El nombre del trabajador es obligatorio.');

      let created = null;
      transaction((state) => {
        const now = new Date().toISOString();
        const employeeCode = String(payload?.employeeCode ?? '').trim()
          || nextPersonnelCode(state.personnelEmployees);
        const exists = state.personnelEmployees.some(
          (entry) => !entry.deletedAt && normalizeText(entry.employeeCode) === normalizeText(employeeCode),
        );
        if (exists) throw new Error('Ya existe personal con ese codigo.');

        created = {
          id: makeId('emp'),
          employeeCode,
          biometricCode: String(payload?.biometricCode ?? employeeCode).trim(),
          fullName,
          documentId: String(payload?.documentId ?? '').trim(),
          phone: String(payload?.phone ?? payload?.whatsapp ?? '').trim(),
          whatsapp: String(payload?.whatsapp ?? payload?.phone ?? '').trim(),
          photoUrl: String(payload?.photoUrl ?? '').trim(),
          email: String(payload?.email ?? '').trim().toLowerCase(),
          address: String(payload?.address ?? '').trim(),
          city: String(payload?.city ?? '').trim(),
          department: String(payload?.department ?? 'Operaciones').trim() || 'Operaciones',
          position: String(payload?.position ?? '').trim(),
          contractType: String(payload?.contractType ?? 'indefinido').trim() || 'indefinido',
          hireDate: String(payload?.hireDate ?? '').trim() || null,
          salaryBs: Math.max(0, Number(payload?.salaryBs ?? 0)),
          schedule: {
            start: String(payload?.schedule?.start ?? '08:00').trim() || '08:00',
            end: String(payload?.schedule?.end ?? '17:00').trim() || '17:00',
            dailyHours: Math.max(1, Number(payload?.schedule?.dailyHours ?? 8)),
            workingDays: Array.isArray(payload?.schedule?.workingDays) && payload.schedule.workingDays.length
              ? payload.schedule.workingDays.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6)
              : [1, 2, 3, 4, 5, 6],
          },
          emergencyContact: String(payload?.emergencyContact ?? '').trim(),
          emergencyPhone: String(payload?.emergencyPhone ?? '').trim(),
          notes: String(payload?.notes ?? '').trim(),
          status: String(payload?.status ?? 'active').trim() || 'active',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.personnelEmployees.push(created);
        return state;
      });

      return created;
    },
    updateEmployee: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el trabajador.');

      let updated = null;
      transaction((state) => {
        const employee = state.personnelEmployees.find((entry) => entry.id === id && !entry.deletedAt);
        if (!employee) throw new Error('Personal no encontrado.');

        const nextCode = String(payload?.employeeCode ?? employee.employeeCode).trim();
        if (!nextCode) throw new Error('El codigo no puede estar vacio.');
        const exists = state.personnelEmployees.some(
          (entry) => entry.id !== id && !entry.deletedAt && normalizeText(entry.employeeCode) === normalizeText(nextCode),
        );
        if (exists) throw new Error('Ya existe otro trabajador con ese codigo.');

        employee.employeeCode = nextCode;
        employee.biometricCode = String(payload?.biometricCode ?? employee.biometricCode ?? nextCode).trim();
        employee.fullName = String(payload?.fullName ?? employee.fullName).trim() || employee.fullName;
        employee.documentId = String(payload?.documentId ?? employee.documentId ?? '').trim();
        employee.phone = String(payload?.phone ?? payload?.whatsapp ?? employee.phone ?? '').trim();
        employee.whatsapp = String(payload?.whatsapp ?? payload?.phone ?? employee.whatsapp ?? '').trim();
        employee.photoUrl = String(payload?.photoUrl ?? employee.photoUrl ?? '').trim();
        employee.email = String(payload?.email ?? employee.email ?? '').trim().toLowerCase();
        employee.address = String(payload?.address ?? employee.address ?? '').trim();
        employee.city = String(payload?.city ?? employee.city ?? '').trim();
        employee.department = String(payload?.department ?? employee.department ?? 'Operaciones').trim() || 'Operaciones';
        employee.position = String(payload?.position ?? employee.position ?? '').trim();
        employee.contractType = String(payload?.contractType ?? employee.contractType ?? 'indefinido').trim() || 'indefinido';
        employee.hireDate = String(payload?.hireDate ?? employee.hireDate ?? '').trim() || null;
        employee.salaryBs = Math.max(0, Number(payload?.salaryBs ?? employee.salaryBs ?? 0));
        employee.schedule = {
          start: String(payload?.schedule?.start ?? employee.schedule?.start ?? '08:00').trim() || '08:00',
          end: String(payload?.schedule?.end ?? employee.schedule?.end ?? '17:00').trim() || '17:00',
          dailyHours: Math.max(1, Number(payload?.schedule?.dailyHours ?? employee.schedule?.dailyHours ?? 8)),
          workingDays: Array.isArray(payload?.schedule?.workingDays) && payload.schedule.workingDays.length
            ? payload.schedule.workingDays.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6)
            : (Array.isArray(employee.schedule?.workingDays) && employee.schedule.workingDays.length
              ? employee.schedule.workingDays
              : [1, 2, 3, 4, 5, 6]),
        };
        employee.emergencyContact = String(payload?.emergencyContact ?? employee.emergencyContact ?? '').trim();
        employee.emergencyPhone = String(payload?.emergencyPhone ?? employee.emergencyPhone ?? '').trim();
        employee.notes = String(payload?.notes ?? employee.notes ?? '').trim();
        employee.status = String(payload?.status ?? employee.status ?? 'active').trim() || 'active';
        employee.updatedAt = new Date().toISOString();

        state.personnelAttendance.forEach((entry) => {
          if (entry.employeeId === id) {
            entry.employeeCode = employee.employeeCode;
            entry.employeeName = employee.fullName;
          }
        });
        state.personnelIncidents.forEach((entry) => {
          if (entry.employeeId === id) entry.employeeName = employee.fullName;
        });
        updated = deepClone(employee);
        return state;
      });

      return updated;
    },
    removeEmployee: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el trabajador.');

      let removed = null;
      transaction((state) => {
        const employee = state.personnelEmployees.find((entry) => entry.id === id && !entry.deletedAt);
        if (!employee) throw new Error('Personal no encontrado.');
        employee.deletedAt = new Date().toISOString();
        employee.status = 'inactive';
        employee.updatedAt = employee.deletedAt;
        removed = deepClone(employee);
        return state;
      });
      return removed;
    },
    createIncident: async (payload) => {
      const employeeId = String(payload?.employeeId ?? '').trim();
      const dateFrom = String(payload?.dateFrom ?? payload?.date ?? '').trim();
      if (!employeeId) throw new Error('Selecciona un trabajador.');
      if (!dateFrom) throw new Error('Indica la fecha del registro.');

      let created = null;
      transaction((state) => {
        const employee = state.personnelEmployees.find((entry) => entry.id === employeeId && !entry.deletedAt);
        if (!employee) throw new Error('Personal no encontrado.');
        const now = new Date().toISOString();
        created = {
          id: makeId('hrinc'),
          employeeId,
          employeeName: employee.fullName,
          type: String(payload?.type ?? 'permiso').trim() || 'permiso',
          dateFrom,
          dateTo: String(payload?.dateTo ?? dateFrom).trim() || dateFrom,
          hours: Math.max(0, Number(payload?.hours ?? 0)),
          status: String(payload?.status ?? 'aprobado').trim() || 'aprobado',
          reason: String(payload?.reason ?? '').trim(),
          notes: String(payload?.notes ?? '').trim(),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.personnelIncidents.push(created);
        return state;
      });

      return created;
    },
    updateIncident: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el registro.');

      let updated = null;
      transaction((state) => {
        const incident = state.personnelIncidents.find((entry) => entry.id === id && !entry.deletedAt);
        if (!incident) throw new Error('Registro no encontrado.');
        if (payload.type !== undefined) incident.type = String(payload.type ?? '').trim() || incident.type;
        if (payload.dateFrom !== undefined) incident.dateFrom = String(payload.dateFrom ?? '').trim() || incident.dateFrom;
        if (payload.dateTo !== undefined) incident.dateTo = String(payload.dateTo ?? '').trim() || incident.dateTo;
        if (payload.hours !== undefined) incident.hours = Math.max(0, Number(payload.hours ?? 0));
        if (payload.status !== undefined) incident.status = String(payload.status ?? '').trim() || incident.status;
        if (payload.reason !== undefined) incident.reason = String(payload.reason ?? '').trim();
        if (payload.notes !== undefined) incident.notes = String(payload.notes ?? '').trim();
        incident.updatedAt = new Date().toISOString();
        updated = deepClone(incident);
        return state;
      });
      return updated;
    },
    importAttendance: async (payload) => {
      const records = Array.isArray(payload?.records) ? payload.records : [];
      if (!records.length) throw new Error('No hay registros validos para importar.');

      let result = { imported: 0, unmatched: 0, observed: 0, overtime: 0 };
      transaction((state) => {
        const importCode = consumeDocumentCode(state, 'hrImportPrefix', 'hrImportNext', 5);
        const now = new Date().toISOString();

        records.forEach((record) => {
          const employeeCode = String(record?.employeeCode ?? record?.biometricCode ?? '').trim();
          const employeeName = String(record?.employeeName ?? record?.fullName ?? '').trim();
          const employee = state.personnelEmployees.find((entry) =>
            !entry.deletedAt
            && (
              (employeeCode && normalizeText(entry.biometricCode || entry.employeeCode) === normalizeText(employeeCode))
              || (employeeCode && normalizeText(entry.employeeCode) === normalizeText(employeeCode))
              || (employeeName && normalizeText(entry.fullName) === normalizeText(employeeName))
            ));
          if (!employee) result.unmatched += 1;

          const date = String(record?.date ?? '').trim();
          const checkIn = String(record?.checkIn ?? '').trim();
          const checkOut = String(record?.checkOut ?? '').trim();
          if (!date || !checkIn || !checkOut) return;

          const meta = calculateAttendanceMeta({ employee, date, checkIn, checkOut });
          const duplicateIndex = state.personnelAttendance.findIndex(
            (entry) =>
              entry.date === date
              && (
                (employee?.id && entry.employeeId === employee.id)
                || (!employee?.id && entry.employeeCode === employeeCode && entry.employeeName === employeeName)
              ),
          );
          const nextEntry = {
            id: duplicateIndex >= 0 ? state.personnelAttendance[duplicateIndex].id : makeId('att'),
            employeeId: employee?.id ?? null,
            employeeCode: employee?.employeeCode ?? employeeCode,
            employeeName: employee?.fullName ?? employeeName,
            date,
            checkIn,
            checkOut,
            ...meta,
            source: String(payload?.source ?? 'ZKTeco').trim() || 'ZKTeco',
            importCode,
            notes: employee ? '' : 'No se encontro coincidencia con el personal registrado.',
            createdAt: duplicateIndex >= 0 ? state.personnelAttendance[duplicateIndex].createdAt : now,
            updatedAt: now,
          };
          if (duplicateIndex >= 0) {
            state.personnelAttendance[duplicateIndex] = nextEntry;
          } else {
            state.personnelAttendance.push(nextEntry);
          }

          result.imported += 1;
          if (meta.overtimeHours > 0) result.overtime += 1;
          if (meta.status === 'observado' || meta.status === 'incompleto') result.observed += 1;
        });
        return state;
      });

      return result;
    },
  },

  auth: {
    hasStoredSession: async () => Boolean(readSessionRecord()),
    getSession: async () => {
      const sessionRecord = touchSessionRecord();
      const userId = sessionRecord?.userId ?? null;
      if (!userId) {
        clearSessionUserId();
        return null;
      }
      const state = readQueryState();
      const user = state.users.find((entry) => entry.id === userId && entry.status === 'active');
      if (!user) {
        clearSessionUserId();
        return null;
      }
      return {
        ...sanitizeUserForSession(user),
        sessionId: sessionRecord.sessionId,
        device: sessionRecord.device ?? detectDeviceInfo(),
        sessionExpiresAt: sessionRecord.expiresAt,
      };
    },
    login: async (payload) => {
      const username = normalizeUsername(payload?.username);
      const password = String(payload?.password ?? '').trim();
      const passwordHash = hashPassword(password);
      if (!username) throw new Error('Ingresa tu usuario.');
      if (!password) throw new Error('Ingresa tu contrasena.');

      let sessionUser = null;
      let requiresFullStatePush = false;
      const state = readQueryState();
      const user = state.users.find((entry) => entry.username === username);
      if (!user) {
        throw new Error('Usuario o contrasena incorrectos.');
      }
      if (user.status !== 'active') {
        throw new Error('Este usuario no esta activo. Consulta con administracion.');
      }

      if (user.mustChangePassword && !user.passwordHash) {
        const now = new Date().toISOString();
        transaction((draft) => {
          const draftUser = draft.users.find((entry) => entry.id === user.id);
          if (!draftUser) throw new Error('Usuario o contrasena incorrectos.');
          if (password.length < 8) {
            throw new Error('Define una contrasena inicial de al menos 8 caracteres.');
          }
          draftUser.passwordHash = passwordHash;
          draftUser.mustChangePassword = false;
          draftUser.passwordChangedAt = now;
          draftUser.updatedAt = now;
          sessionUser = sanitizeUserForSession(draftUser);
          requiresFullStatePush = true;
          return draft;
        });
      } else if (user.passwordHash !== passwordHash) {
        throw new Error('Usuario o contrasena incorrectos.');
      } else {
        sessionUser = sanitizeUserForSession(user);
      }

      const sessionRecord = createSessionRecord(sessionUser.id);
      return {
        ...sessionUser,
        sessionId: sessionRecord.sessionId,
        device: sessionRecord.device,
        sessionExpiresAt: sessionRecord.expiresAt,
        __requiresFullStatePush: requiresFullStatePush,
      };
    },
    logout: async () => {
      clearSessionUserId();
      return { ok: true };
    },
  },

  presence: {
    listActive: async () => {
      const state = readQueryState();
      const threshold = Date.now() - PRESENCE_TTL_MS;
      return (state.userPresence ?? [])
        .filter((presence) => new Date(presence.lastSeenAt).getTime() >= threshold)
        .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
    },
    heartbeat: async (payload) => {
      const userId = String(payload?.userId ?? '').trim();
      if (!userId) return [];
      const sessionRecord = touchSessionRecord();
      const sessionId = String(payload?.sessionId ?? sessionRecord?.sessionId ?? userId).trim();
      const device = payload?.device ?? sessionRecord?.device ?? detectDeviceInfo();
      let activePresence = [];
      transaction((state) => {
        if (!Array.isArray(state.userPresence)) state.userPresence = [];
        const now = new Date().toISOString();
        const threshold = Date.now() - PRESENCE_TTL_MS;
        state.userPresence = state.userPresence.filter((presence) => (
          presence.sessionId === sessionId || new Date(presence.lastSeenAt).getTime() >= threshold
        ));
        const existing = state.userPresence.find((presence) => presence.sessionId === sessionId);
        const nextPresence = {
          sessionId,
          userId,
          fullName: String(payload?.fullName ?? 'Usuario').trim() || 'Usuario',
          role: String(payload?.role ?? 'Operador').trim() || 'Operador',
          activeTab: String(payload?.activeTab ?? 'resumen').trim() || 'resumen',
          color: String(payload?.color ?? colorForUserId(userId)).trim() || colorForUserId(userId),
          device: {
            type: String(device?.type ?? 'desktop').trim() || 'desktop',
            typeLabel: String(device?.typeLabel ?? 'Computadora').trim() || 'Computadora',
            browser: String(device?.browser ?? 'Navegador').trim() || 'Navegador',
            os: String(device?.os ?? 'Equipo').trim() || 'Equipo',
            label: String(device?.label ?? device?.typeLabel ?? 'Computadora').trim() || 'Computadora',
            screen: String(device?.screen ?? '').trim(),
            userAgent: String(device?.userAgent ?? '').trim(),
          },
          lastSeenAt: now,
          updatedAt: now,
        };
        if (existing) {
          Object.assign(existing, nextPresence);
        } else {
          state.userPresence.push(nextPresence);
        }
        activePresence = state.userPresence
          .filter((presence) => new Date(presence.lastSeenAt).getTime() >= threshold)
          .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
        return state;
      });
      return activePresence;
    },
    leave: async (payload) => {
      const userId = String(payload?.userId ?? '').trim();
      const sessionId = String(payload?.sessionId ?? readSessionRecord()?.sessionId ?? '').trim();
      if (!userId && !sessionId) return { ok: true };
      transaction((state) => {
        state.userPresence = (state.userPresence ?? []).filter((presence) => {
          if (sessionId) return presence.sessionId !== sessionId;
          return presence.userId !== userId;
        });
        return state;
      });
      return { ok: true };
    },
  },

  transport: {
    listDeliveries: async () => {
      const state = readQueryState();
      return state.deliveries
        .filter((delivery) => !delivery.deletedAt)
        .map((delivery) => {
          const driver = state.drivers.find((entry) => entry.id === delivery.driverId) ?? null;
          const vehicle = state.vehicles.find((entry) => entry.id === delivery.vehicleId) ?? null;
          const rental = state.rentals.find(
            (entry) =>
              !entry.deletedAt
              && (
                (delivery.rentalId && entry.id === delivery.rentalId)
                || (delivery.orderCode && entry.orderCode === delivery.orderCode)
              ),
          ) ?? null;
          return {
            ...delivery,
            status: getStatusFromDelivery(delivery),
            customerPhone: rental?.customerPhone ?? '',
            driverName: driver?.fullName ?? 'Sin chofer',
            driverLicense: driver?.licenseNumber ?? '-',
            driverPhone: driver?.phone ?? '-',
            vehicleCode: vehicle?.code ?? 'SIN-VEH',
            vehicleName: vehicle?.name ?? 'Sin vehiculo',
            vehicleType: vehicle?.type ?? '-',
          };
        })
        .sort((a, b) => new Date(b.scheduledDate) - new Date(a.scheduledDate));
    },
    listRoutes: async () => {
      const state = readQueryState();
      return (state.transportRoutes ?? [])
        .filter((route) => !route.deletedAt)
        .map((route) => hydrateTransportRoute(state, route))
        .sort((a, b) => {
          const dateOrder = String(b.date ?? '').localeCompare(String(a.date ?? ''), 'es');
          if (dateOrder !== 0) return dateOrder;
          return String(a.routeCode ?? '').localeCompare(String(b.routeCode ?? ''), 'es');
        });
    },
    createDelivery: async (payload) => {
      const customerName = String(payload?.customerName ?? '').trim();
      const address = String(payload?.address ?? '').trim();
      const city = String(payload?.city ?? '').trim();
      const scheduledDate = String(payload?.scheduledDate ?? '').trim();
      const windowStart = String(payload?.windowStart ?? '').trim();
      const windowEnd = String(payload?.windowEnd ?? '').trim();
      if (!customerName) throw new Error('El cliente es obligatorio.');
      if (!address) throw new Error('La direccion es obligatoria.');
      if (!scheduledDate) throw new Error('La fecha programada es obligatoria.');
      if (!windowStart || !windowEnd) throw new Error('Debes indicar la ventana horaria.');
      assertSameDayTimeWindow(windowStart, windowEnd, 'La ventana horaria de la entrega');

      let created = null;
      transaction((state) => {
        created = {
          id: makeId('del'),
          deliveryCode: consumeDocumentCode(state, 'deliveryPrefix', 'deliveryNext', 5),
          orderCode: String(payload?.orderCode ?? '').trim() || consumeDocumentCode(
            state,
            'serviceOrderPrefix',
            'serviceOrderNext',
            5,
          ),
          rentalId: payload?.rentalId ?? null,
          customerName,
          companyName: String(payload?.companyName ?? customerName).trim(),
          address,
          city,
          windowStart,
          windowEnd,
          scheduledDate,
          driverId: payload?.driverId ?? null,
          vehicleId: payload?.vehicleId ?? null,
          routeType: ['envio', 'recojo'].includes(payload?.routeType) ? payload.routeType : null,
          status: 'programada',
          progress: 0,
          notes: String(payload?.notes ?? '').trim(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.deliveries.push(created);
        return state;
      });

      return created;
    },
    createRoute: async (payload) => {
      const type = ['envio', 'recojo', 'mixta'].includes(payload?.type) ? payload.type : 'envio';
      const date = String(payload?.date ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Debes indicar la fecha de la ruta.');
      }

      let created = null;
      transaction((state) => {
        state.transportRoutes = Array.isArray(state.transportRoutes) ? state.transportRoutes : [];
        const now = new Date().toISOString();
        const routeNumber = state.transportRoutes.filter((route) => !route.deletedAt && route.date === date && route.type === type).length + 1;
        const routeCode = String(payload?.routeCode ?? '').trim()
          || `${type === 'recojo' ? 'RR' : type === 'mixta' ? 'RM' : 'RE'}-${date.replaceAll('-', '')}-${String(routeNumber).padStart(2, '0')}`;
        const stops = normalizeRouteStopsPayload(payload?.stops);
        created = {
          id: makeId('troute'),
          routeCode,
          type,
          date,
          driverId: String(payload?.driverId ?? '').trim() || null,
          vehicleId: String(payload?.vehicleId ?? '').trim() || null,
          status: ['borrador', 'planificada', 'en_ruta', 'completada'].includes(payload?.status) ? payload.status : 'borrador',
          notes: String(payload?.notes ?? '').trim(),
          stops,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.transportRoutes.push(created);
        syncRouteStopsToDeliveries(state, created);
        return state;
      });

      return created;
    },
    updateRoute: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar la ruta.');

      let updated = null;
      transaction((state) => {
        state.transportRoutes = Array.isArray(state.transportRoutes) ? state.transportRoutes : [];
        const route = state.transportRoutes.find((entry) => entry.id === id && !entry.deletedAt);
        if (!route) throw new Error('Ruta no encontrada.');

        if (payload.type !== undefined && ['envio', 'recojo', 'mixta'].includes(payload.type)) route.type = payload.type;
        if (payload.date !== undefined) {
          const date = String(payload.date ?? '').trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Debes indicar una fecha valida.');
          route.date = date;
        }
        if (payload.driverId !== undefined) route.driverId = String(payload.driverId ?? '').trim() || null;
        if (payload.vehicleId !== undefined) route.vehicleId = String(payload.vehicleId ?? '').trim() || null;
        if (payload.status !== undefined && ['borrador', 'planificada', 'en_ruta', 'completada', 'cancelada'].includes(payload.status)) {
          route.status = payload.status;
        }
        if (payload.notes !== undefined) route.notes = String(payload.notes ?? '').trim();
        if (payload.stops !== undefined) {
          const stops = normalizeRouteStopsPayload(payload.stops);
          const seen = new Set();
          route.stops = stops.filter((stop) => {
            if (seen.has(stop.deliveryId)) return false;
            const delivery = state.deliveries.find((entry) => entry.id === stop.deliveryId && !entry.deletedAt);
            if (!delivery) return false;
            const deliveryType = isPickupDeliveryRecord(delivery) ? 'recojo' : 'envio';
            return route.type === 'mixta' || deliveryType === route.type;
          }).map((stop, index) => ({ ...stop, sequence: index + 1 }));
        }
        route.updatedAt = new Date().toISOString();
        syncRouteStopsToDeliveries(state, route);
        updated = deepClone(route);
        return state;
      });

      return updated;
    },
    updateDelivery: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar la entrega.');

      let updated = null;
      transaction((state) => {
        const delivery = state.deliveries.find((entry) => entry.id === id);
        if (!delivery) throw new Error('Entrega no encontrada.');

        if (payload.status !== undefined) delivery.status = getStatusFromDelivery({ status: payload.status });
        if (payload.progress !== undefined) {
          delivery.progress = Math.max(0, Math.min(100, Math.trunc(Number(payload.progress ?? 0))));
        }
        if (payload.driverId !== undefined) delivery.driverId = payload.driverId;
        if (payload.vehicleId !== undefined) delivery.vehicleId = payload.vehicleId;
        if (payload.routeType !== undefined && ['envio', 'recojo'].includes(payload.routeType)) delivery.routeType = payload.routeType;
        if (payload.windowStart !== undefined) delivery.windowStart = String(payload.windowStart ?? '').trim();
        if (payload.windowEnd !== undefined) delivery.windowEnd = String(payload.windowEnd ?? '').trim();
        if (payload.scheduledDate !== undefined) delivery.scheduledDate = String(payload.scheduledDate ?? '').trim();
        if (payload.address !== undefined) delivery.address = String(payload.address ?? '').trim();
        if (payload.city !== undefined) delivery.city = String(payload.city ?? '').trim();
        if (payload.notes !== undefined) delivery.notes = String(payload.notes ?? '').trim();
        assertSameDayTimeWindow(delivery.windowStart, delivery.windowEnd, 'La ventana horaria de la entrega');
        delivery.updatedAt = new Date().toISOString();
        const linkedRental = state.rentals.find(
          (rental) =>
            !rental.deletedAt
            && (
              (delivery.rentalId && rental.id === delivery.rentalId)
              || (delivery.orderCode && rental.orderCode && rental.orderCode === delivery.orderCode)
            ),
        );
        if (linkedRental) {
          syncRentalTransportStatus(state, linkedRental, delivery.updatedAt);
        }
        updated = deepClone(delivery);
        return state;
      });

      return updated;
    },
    registerPickupChecklist: async (payload) => {
      const deliveryId = String(payload?.deliveryId ?? '').trim();
      const rentalId = String(payload?.rentalId ?? '').trim();
      const lines = Array.isArray(payload?.items) ? payload.items : [];
      const receivedBy = String(payload?.receivedBy ?? 'Transporte').trim() || 'Transporte';
      const notes = String(payload?.notes ?? '').trim();

      if (!deliveryId) {
        throw new Error('Debes seleccionar el recojo.');
      }
      if (lines.length === 0) {
        throw new Error('Debes registrar el checklist de items recogidos.');
      }

      let updated = null;
      transaction((state) => {
        const delivery = state.deliveries.find((entry) => entry.id === deliveryId && !entry.deletedAt);
        if (!delivery) {
          throw new Error('Recojo no encontrado.');
        }

        const rental = state.rentals.find(
          (entry) =>
            !entry.deletedAt
            && (
              (rentalId && entry.id === rentalId)
              || (delivery.rentalId && entry.id === delivery.rentalId)
              || (delivery.orderCode && entry.orderCode === delivery.orderCode)
            ),
        );
        if (!rental) {
          throw new Error('Orden de servicio no encontrada para este recojo.');
        }

        const checklist = (rental.items ?? []).map((rentalLine) => {
          const incoming = lines.find((entry) => entry.itemId === rentalLine.itemId);
          if (!incoming) {
            throw new Error(`Falta checklist para "${rentalLine.itemName}".`);
          }
          const quantity = Math.max(0, toInteger(incoming.quantity ?? 0, `cantidad (${rentalLine.itemName})`));
          const condition = ['ok', 'observado', 'danado', 'faltante'].includes(incoming.condition)
            ? incoming.condition
            : 'ok';
          const note = String(incoming.note ?? '').trim();
          if (quantity > Number(rentalLine.quantity ?? 0)) {
            throw new Error(`La cantidad recogida de "${rentalLine.itemName}" no puede superar ${rentalLine.quantity}.`);
          }
          if (condition !== 'ok' && !note) {
            throw new Error(`Registra una observacion para "${rentalLine.itemName}".`);
          }
          return {
            itemId: rentalLine.itemId,
            itemName: rentalLine.itemName,
            expectedQty: Number(rentalLine.quantity ?? 0),
            pickedQty: quantity,
            condition,
            note,
          };
        });

        const now = new Date().toISOString();
        delivery.status = 'completada';
        delivery.progress = 100;
        delivery.pickupChecklist = checklist;
        delivery.pickupCheckedAt = now;
        delivery.pickupCheckedBy = receivedBy;
        delivery.notes = notes || delivery.notes;
        delivery.updatedAt = now;

        rental.pickupChecklist = {
          deliveryId: delivery.id,
          deliveryCode: delivery.deliveryCode,
          checkedAt: now,
          checkedBy: receivedBy,
          notes,
          items: checklist,
        };
        rental.updatedAt = now;
        syncRentalTransportStatus(state, rental, now);
        updated = deepClone(delivery);
        return state;
      });

      return updated;
    },
    listVehicles: async () => {
      const { vehicles } = readQueryState();
      return vehicles.filter((row) => !row.deletedAt).slice().sort((a, b) => a.code.localeCompare(b.code, 'es'));
    },
    createVehicle: async (payload) => {
      const code = String(payload?.code ?? '').trim().toUpperCase();
      if (!code) throw new Error('La patente/codigo es obligatorio.');

      let created = null;
      transaction((state) => {
        if (state.vehicles.some((vehicle) => vehicle.code === code)) {
          throw new Error('Ya existe un vehiculo con esa patente/codigo.');
        }
        const now = new Date().toISOString();
        created = {
          id: makeId('veh'),
          code,
          name: String(payload?.name ?? 'Vehiculo').trim(),
          model: String(payload?.model ?? '').trim(),
          type: String(payload?.type ?? '').trim() || 'Camion',
          capacityKg: Math.max(0, Math.trunc(Number(payload?.capacityKg ?? 0))),
          year: Math.max(2000, Math.trunc(Number(payload?.year ?? new Date().getFullYear()))),
          status: String(payload?.status ?? 'activo').trim() || 'activo',
          mileageKm: Math.max(0, Math.trunc(Number(payload?.mileageKm ?? 0))),
          nextMaintenanceAt: String(payload?.nextMaintenanceAt ?? '').trim() || null,
          imageDataUrl: payload?.imageDataUrl ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.vehicles.push(created);
        return state;
      });

      return created;
    },
    updateVehicle: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el vehiculo.');

      let updated = null;
      transaction((state) => {
        const vehicle = state.vehicles.find((entry) => entry.id === id);
        if (!vehicle) throw new Error('Vehiculo no encontrado.');

        const nextCode = payload?.code !== undefined
          ? String(payload.code ?? '').trim().toUpperCase()
          : vehicle.code;

        if (!nextCode) throw new Error('La patente/codigo es obligatorio.');
        if (state.vehicles.some((entry) => entry.id !== id && entry.code === nextCode)) {
          throw new Error('Ya existe un vehiculo con esa patente/codigo.');
        }

        vehicle.code = nextCode;
        if (payload.name !== undefined) vehicle.name = String(payload.name ?? '').trim() || vehicle.name;
        if (payload.model !== undefined) vehicle.model = String(payload.model ?? '').trim();
        if (payload.type !== undefined) vehicle.type = String(payload.type ?? '').trim() || 'Camion';
        if (payload.capacityKg !== undefined) vehicle.capacityKg = Math.max(0, Math.trunc(Number(payload.capacityKg ?? 0)));
        if (payload.year !== undefined) vehicle.year = Math.max(2000, Math.trunc(Number(payload.year ?? vehicle.year)));
        if (payload.status !== undefined) vehicle.status = String(payload.status ?? '').trim() || vehicle.status;
        if (payload.mileageKm !== undefined) vehicle.mileageKm = Math.max(0, Math.trunc(Number(payload.mileageKm ?? 0)));
        if (payload.nextMaintenanceAt !== undefined) vehicle.nextMaintenanceAt = String(payload.nextMaintenanceAt ?? '').trim() || null;
        if (payload.imageDataUrl !== undefined) vehicle.imageDataUrl = payload.imageDataUrl ?? null;
        if (payload.deletedAt !== undefined) vehicle.deletedAt = payload.deletedAt ?? null;
        vehicle.updatedAt = new Date().toISOString();
        updated = deepClone(vehicle);
        return state;
      });

      return updated;
    },
    removeVehicle: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el vehiculo.');

      let updated = null;
      transaction((state) => {
        const vehicle = state.vehicles.find((entry) => entry.id === id);
        if (!vehicle) throw new Error('Vehiculo no encontrado.');
        vehicle.deletedAt = new Date().toISOString();
        vehicle.updatedAt = new Date().toISOString();
        updated = deepClone(vehicle);
        return state;
      });

      return updated;
    },
    listDrivers: async () => {
      const { drivers } = readQueryState();
      return drivers.filter((row) => !row.deletedAt).slice().sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
    },
    createDriver: async (payload) => {
      const fullName = String(payload?.fullName ?? '').trim();
      const licenseNumber = String(payload?.licenseNumber ?? '').trim().toUpperCase();
      if (!fullName) throw new Error('El nombre del chofer es obligatorio.');
      if (!licenseNumber) throw new Error('La licencia es obligatoria.');

      let created = null;
      transaction((state) => {
        if (state.drivers.some((driver) => driver.licenseNumber === licenseNumber)) {
          throw new Error('Ya existe un chofer con esa licencia.');
        }
        const now = new Date().toISOString();
        created = {
          id: makeId('drv'),
          fullName,
          code: `CH-${formatDocNumber(state.drivers.length + 1, 3)}`,
          licenseNumber,
          licenseCategory: String(payload?.licenseCategory ?? 'B1 - Utilitarios').trim(),
          phone: String(payload?.phone ?? '').trim(),
          status: String(payload?.status ?? 'activo').trim() || 'activo',
          rating: Number.isFinite(Number(payload?.rating)) ? Number(payload.rating) : null,
          licenseExpiryAt: String(payload?.licenseExpiryAt ?? '').trim() || null,
          imageDataUrl: payload?.imageDataUrl ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.drivers.push(created);
        return state;
      });

      return created;
    },
    updateDriver: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el chofer.');

      let updated = null;
      transaction((state) => {
        const driver = state.drivers.find((entry) => entry.id === id);
        if (!driver) throw new Error('Chofer no encontrado.');

        const nextLicenseNumber = payload?.licenseNumber !== undefined
          ? String(payload.licenseNumber ?? '').trim().toUpperCase()
          : driver.licenseNumber;

        if (!nextLicenseNumber) throw new Error('La licencia es obligatoria.');
        if (state.drivers.some((entry) => entry.id !== id && entry.licenseNumber === nextLicenseNumber)) {
          throw new Error('Ya existe un chofer con esa licencia.');
        }

        if (payload.fullName !== undefined) driver.fullName = String(payload.fullName ?? '').trim() || driver.fullName;
        driver.licenseNumber = nextLicenseNumber;
        if (payload.licenseCategory !== undefined) driver.licenseCategory = String(payload.licenseCategory ?? '').trim() || driver.licenseCategory;
        if (payload.phone !== undefined) driver.phone = String(payload.phone ?? '').trim();
        if (payload.status !== undefined) driver.status = String(payload.status ?? '').trim() || driver.status;
        if (payload.rating !== undefined) {
          driver.rating = payload.rating === null ? null : (Number.isFinite(Number(payload.rating)) ? Number(payload.rating) : driver.rating);
        }
        if (payload.licenseExpiryAt !== undefined) driver.licenseExpiryAt = String(payload.licenseExpiryAt ?? '').trim() || null;
        if (payload.imageDataUrl !== undefined) driver.imageDataUrl = payload.imageDataUrl ?? null;
        if (payload.deletedAt !== undefined) driver.deletedAt = payload.deletedAt ?? null;
        driver.updatedAt = new Date().toISOString();
        updated = deepClone(driver);
        return state;
      });

      return updated;
    },
    removeDriver: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el chofer.');

      let updated = null;
      transaction((state) => {
        const driver = state.drivers.find((entry) => entry.id === id);
        if (!driver) throw new Error('Chofer no encontrado.');
        driver.deletedAt = new Date().toISOString();
        driver.updatedAt = new Date().toISOString();
        updated = deepClone(driver);
        return state;
      });

      return updated;
    },
  },

  calendar: {
    listBoardNotes: async () => {
      const state = readQueryState();
      return state.calendarBoardNotes
        .slice()
        .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0) - new Date(a.updatedAt ?? a.createdAt ?? 0))
        .map((note) => ({ ...note }));
    },
    upsertBoardNote: async (payload) => {
      const rowId = String(payload?.rowId ?? '').trim();
      const text = String(payload?.text ?? '').trim();
      if (!rowId) throw new Error('Debes indicar la fila del recordatorio.');
      if (!text) throw new Error('El recordatorio no puede estar vacio.');

      let saved = null;
      transaction((state) => {
        const now = new Date().toISOString();
        const existing = state.calendarBoardNotes.find((note) => note.rowId === rowId);
        if (existing) {
          existing.eventId = String(payload?.eventId ?? existing.eventId ?? '').trim() || null;
          existing.kind = String(payload?.kind ?? existing.kind ?? '').trim() || null;
          existing.dateKey = String(payload?.dateKey ?? existing.dateKey ?? '').trim() || null;
          existing.text = text;
          existing.updatedAt = now;
          saved = { ...existing };
          return state;
        }

        saved = {
          id: makeId('cbn'),
          rowId,
          eventId: String(payload?.eventId ?? '').trim() || null,
          kind: String(payload?.kind ?? '').trim() || null,
          dateKey: String(payload?.dateKey ?? '').trim() || null,
          text,
          createdAt: now,
          updatedAt: now,
        };
        state.calendarBoardNotes.push(saved);
        return state;
      });

      return saved;
    },
    removeBoardNote: async (payload) => {
      const rowId = String(payload?.rowId ?? '').trim();
      if (!rowId) throw new Error('Debes indicar la fila del recordatorio.');

      transaction((state) => {
        state.calendarBoardNotes = state.calendarBoardNotes.filter((note) => note.rowId !== rowId);
        return state;
      });

      return { ok: true, rowId };
    },
    listEvents: async () => {
      const state = readQueryState();
      const deliveryEvents = state.deliveries
        .filter((delivery) => !delivery.deletedAt && !['cancelada', 'cancelado', 'cancelled', 'anulada', 'anulado'].includes(normalizeText(delivery.status)))
        .map((delivery) => ({
          id: `del-${delivery.id}`,
          title: delivery.deliveryCode,
          subtitle: `${delivery.customerName} - ${delivery.companyName}`,
          type: 'delivery',
          date: delivery.scheduledDate,
          startTime: delivery.windowStart,
          endTime: delivery.windowEnd,
          status: delivery.status,
          relatedType: 'delivery',
          relatedId: delivery.id,
          rentalId: delivery.rentalId,
          orderCode: delivery.orderCode,
          customerName: delivery.customerName,
          companyName: delivery.companyName,
          address: delivery.address,
          city: delivery.city,
          notes: delivery.notes,
          deliveryCode: delivery.deliveryCode,
        }));

      const maintenanceEvents = state.vehicles
        .filter((vehicle) => vehicle.nextMaintenanceAt)
        .map((vehicle) => ({
          id: `veh-maint-${vehicle.id}`,
          title: 'Mantenimiento Preventivo',
          subtitle: `${vehicle.code} - ${vehicle.name}`,
          type: 'maintenance',
          date: vehicle.nextMaintenanceAt,
          startTime: '14:00',
          endTime: '16:00',
          status: vehicle.status === 'mantenimiento' ? 'programada' : 'confirmado',
          relatedType: 'vehicle',
          relatedId: vehicle.id,
        }));

      const licenseEvents = state.drivers
        .filter((driver) => driver.licenseExpiryAt)
        .map((driver) => ({
          id: `drv-exp-${driver.id}`,
          title: 'Vence licencia',
          subtitle: driver.fullName,
          type: 'license',
          date: driver.licenseExpiryAt,
          startTime: '08:00',
          endTime: '09:00',
          status: 'programada',
          relatedType: 'driver',
          relatedId: driver.id,
        }));

      const manualEvents = state.calendarEvents.map((event) => ({ ...event }));
      return [...deliveryEvents, ...maintenanceEvents, ...licenseEvents, ...manualEvents].sort(
        (a, b) => new Date(`${a.date}T${a.startTime}:00`) - new Date(`${b.date}T${b.startTime}:00`),
      );
    },
    createEvent: async (payload) => {
      const title = String(payload?.title ?? '').trim();
      const date = String(payload?.date ?? '').trim();
      const startTime = String(payload?.startTime ?? '').trim();
      const endTime = String(payload?.endTime ?? '').trim();
      if (!title) throw new Error('El titulo del evento es obligatorio.');
      if (!date) throw new Error('La fecha del evento es obligatoria.');
      if (!startTime || !endTime) throw new Error('La hora de inicio y fin son obligatorias.');

      let created = null;
      transaction((state) => {
        created = {
          id: makeId('evt'),
          title,
          subtitle: String(payload?.subtitle ?? '').trim(),
          type: String(payload?.type ?? 'other').trim() || 'other',
          date,
          startTime,
          endTime,
          status: String(payload?.status ?? 'programada').trim() || 'programada',
          relatedType: null,
          relatedId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.calendarEvents.push(created);
        return state;
      });

      return created;
    },
  },

  settings: {
    get: async () => {
      const state = readQueryState();
      return {
        settings: deepClone(state.settings),
        categories: state.categories.slice().sort((a, b) => a.name.localeCompare(b.name, 'es')),
      };
    },
    update: async (payload) => {
      let updated = null;
      transaction((state) => {
        const nextSettings = { ...(state.settings ?? {}) };
        Object.entries(payload ?? {}).forEach(([key, value]) => {
          if (key === 'numbering' && value && typeof value === 'object') {
            nextSettings.numbering = {
              ...(nextSettings.numbering ?? {}),
              ...value,
            };
          } else {
            nextSettings[key] = value;
          }
        });
        state.settings = {
          ...createDefaultSettings(),
          ...nextSettings,
          numbering: {
            ...createDefaultSettings().numbering,
            ...(nextSettings.numbering ?? {}),
          },
        };
        updated = deepClone(state.settings);
        return state;
      });

      return updated;
    },
  },

  reports: {
    listGenerated: async () => {
      const state = readQueryState();
      const receiptReports = state.rentals.filter((rental) => !rental.deletedAt).slice(0, 30).map((rental) => ({
        id: `rent-report-${rental.id}`,
        name: `Orden ${rental.orderCode ?? rental.id} - ${rental.customerName}`,
        category: 'Ordenes',
        periodFrom: rental.rentalDate ?? null,
        periodTo: rental.dueDate ?? null,
        format: rental.status === 'returned' ? 'PDF' : 'Excel',
        generatedBy: 'Yordy Copa Cerezo',
        generatedAt: rental.createdAt,
        sourceType: rental.status === 'returned' ? 'devolucion' : 'alquiler',
        sourceId: rental.id,
      }));

      const merged = [...state.generatedReports.filter((report) => !report.deletedAt), ...receiptReports];
      return merged
        .slice()
        .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))
        .slice(0, 60);
    },
    generate: async (payload) => {
      const name = String(payload?.name ?? '').trim();
      if (!name) throw new Error('El nombre del reporte es obligatorio.');
      let created = null;

      transaction((state) => {
        created = {
          id: makeId('rep'),
          name,
          category: String(payload?.category ?? 'General').trim() || 'General',
          periodFrom: String(payload?.periodFrom ?? '').trim() || null,
          periodTo: String(payload?.periodTo ?? '').trim() || null,
          format: String(payload?.format ?? 'PDF').trim() || 'PDF',
          generatedBy: String(payload?.generatedBy ?? 'Yordy Copa Cerezo').trim() || 'Yordy Copa Cerezo',
          generatedAt: new Date().toISOString(),
          sourceType: String(payload?.sourceType ?? '').trim() || null,
          sourceId: String(payload?.sourceId ?? '').trim() || null,
        };
        state.generatedReports.unshift(created);
        appendAuditLog(state, {
          action: 'create',
          module: 'Reportes',
          entityType: 'report',
          entityId: created.id,
          entityCode: created.category,
          title: `Genero reporte ${created.name}`,
          detail: `${created.category} | ${created.format}`,
          userName: getAuditUserName(payload),
          userRole: getAuditUserRole(payload),
          createdAt: created.generatedAt,
        });
        return state;
      });

      return created;
    },
  },

  audit: {
    list: async () => {
      const state = readQueryState();
      const storedLog = Array.isArray(state.systemAuditLog) ? state.systemAuditLog : [];
      const revisionLog = (Array.isArray(state.contracts) ? state.contracts : []).flatMap((contract) => {
        const revisions = Array.isArray(contract?.revisionHistory) ? contract.revisionHistory : [];
        return revisions
          .filter((revision) => {
            const revisionTime = new Date(revision?.updatedAt ?? '').getTime();
            return !storedLog.some((entry) => (
              String(entry.entityType ?? '') === 'contract'
              && String(entry.entityId ?? '') === String(contract.id ?? '')
              && Math.abs(new Date(entry.createdAt ?? '').getTime() - revisionTime) < 1500
            ));
          })
          .map((revision) => {
            const changes = Array.isArray(revision?.changes) ? revision.changes.map((change) => String(change ?? '').trim()).filter(Boolean) : [];
            const text = changes.join(' | ').toLowerCase();
            const action = text.includes('creado') ? 'create' : text.includes('eliminado') ? 'hide' : 'update';
            return {
              id: `audit-revision-${contract.id}-${revision.id ?? revision.updatedAt}`,
              action,
              module: 'Contratos',
              entityType: 'contract',
              entityId: contract.id,
              entityCode: contract.contractCode,
              title: action === 'create'
                ? `Creo contrato ${contract.contractCode}`
                : action === 'hide'
                ? `Oculto contrato ${contract.contractCode}`
                : `Edito contrato ${contract.contractCode}`,
              detail: contract.customerName || changes[0] || '',
              changes,
              userId: revision?.updatedById ?? null,
              userName: revision?.updatedByName ?? 'Sistema',
              userRole: revision?.updatedByRole ?? 'Sistema',
              createdAt: revision?.updatedAt ?? contract.updatedAt ?? contract.createdAt,
            };
          });
      });
      const movementLog = (Array.isArray(state.inventoryMovements) ? state.inventoryMovements : []).map((movement) => {
        const type = String(movement?.type ?? '').trim();
        const action = type === 'entrada' ? 'create' : type === 'ajuste' ? 'update' : 'hide';
        const beforeTotal = movement?.beforeTotalStock;
        const afterTotal = movement?.afterTotalStock;
        const beforeAvailable = movement?.beforeAvailableStock;
        const afterAvailable = movement?.afterAvailableStock;
        const changes = [
          `Cantidad: ${Number(movement?.deltaUnits ?? 0)}`,
          beforeTotal !== undefined || afterTotal !== undefined ? `Stock fisico: ${beforeTotal ?? '-'} -> ${afterTotal ?? '-'}` : '',
          beforeAvailable !== undefined || afterAvailable !== undefined ? `Disponible: ${beforeAvailable ?? '-'} -> ${afterAvailable ?? '-'}` : '',
          movement?.reference ? `Referencia: ${movement.reference}` : '',
          movement?.reason || movement?.detail || '',
        ].filter(Boolean);
        return {
          id: `audit-movement-${movement.id ?? movement.createdAt}`,
          action,
          module: 'Inventario',
          entityType: 'inventoryMovement',
          entityId: movement.itemId ?? null,
          entityCode: movement.reference ?? movement.itemId ?? '',
          title: `${type === 'reserva' ? 'Reservo' : type === 'entrada' ? 'Ingreso' : type === 'ajuste' ? 'Ajusto' : 'Movio'} producto ${movement.itemName ?? 'item'}`,
          detail: [movement.category, movement.reason || movement.detail].filter(Boolean).join(' | '),
          changes,
          userId: movement.userId ?? null,
          userName: movement.userName ?? movement.createdByName ?? 'Sistema',
          userRole: movement.userRole ?? movement.createdByRole ?? 'Inventario',
          createdAt: movement.createdAt ?? new Date().toISOString(),
        };
      });
      return [...storedLog, ...revisionLog, ...movementLog]
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 500);
    },
  },

  quotes: {
    list: async () => {
      const { quotes } = readQueryState();
      return quotes
        .filter((row) => !row.deletedAt)
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    create: async (payload) => {
      const customerName = String(payload?.customerName ?? '').trim();
      const customerCi = String(payload?.customerCi ?? payload?.nitCi ?? '').trim();
      const customerPhone = String(payload?.customerPhone ?? '').trim();
      const customerReferencePhone = String(payload?.customerReferencePhone ?? '').trim();
      const eventDate = String(payload?.eventDate ?? '').trim();
      const eventTime = String(payload?.eventTime ?? '').trim();
      const deliveryDate = String(payload?.deliveryDate ?? eventDate).trim();
      const deliveryWindowStart = String(payload?.deliveryWindowStart ?? '08:00').trim();
      const deliveryWindowEnd = String(payload?.deliveryWindowEnd ?? '10:00').trim();
      const deliveryTimeMode = payload?.deliveryTimeMode === 'coordinate' ? 'coordinate' : 'fixed';
      const pickupDate = String(payload?.pickupDate ?? eventDate).trim();
      const pickupWindowStart = String(payload?.pickupWindowStart ?? '20:00').trim();
      const pickupWindowEnd = String(payload?.pickupWindowEnd ?? '22:00').trim();
      const pickupTimeMode = payload?.pickupTimeMode === 'coordinate' ? 'coordinate' : 'fixed';
      const status = String(payload?.status ?? 'borrador').trim() || 'borrador';
      const requestedItems = Array.isArray(payload?.items) ? payload.items : [];
      const requestedServices = normalizeContractServices(payload?.services);

      if (!customerName) throw new Error('Debes indicar el cliente de la cotizacion.');
      if (!customerPhone) throw new Error('Debes indicar el WhatsApp o celular del cliente.');
      if (!eventDate) throw new Error('Debes indicar la fecha del evento.');
      if (!eventTime) throw new Error('Debes indicar la hora del evento.');
      if (!deliveryDate) throw new Error('Debes indicar la fecha de entrega.');
      if (!pickupDate) throw new Error('Debes indicar la fecha de recojo.');
      if (!requestedItems.length && !requestedServices.length) throw new Error('Debes agregar al menos un item o servicio en la cotizacion.');
      assertSameDayTimeWindow(deliveryWindowStart, deliveryWindowEnd, 'La ventana de entrega');
      assertSameDayTimeWindow(pickupWindowStart, pickupWindowEnd, 'La ventana de recojo');

      let created = null;
      transaction((state) => {
        const now = new Date().toISOString();
        const discountMode = payload?.discountMode === 'fixed' ? 'fixed' : 'percent';
        const discountBs = Math.max(0, toPositiveRoundedNumber(payload?.discountBs ?? 0));
        const generalDiscountPercent = discountMode === 'percent'
          ? Math.min(100, Math.max(0, toPositiveRoundedNumber(payload?.discountPercent ?? 0)))
          : 0;
        const guaranteeBs = Math.max(0, toPositiveRoundedNumber(payload?.guaranteeBs ?? 0));
        const guaranteeStatus = String(payload?.guaranteeStatus ?? '').trim() === 'validado' ? 'validado' : 'no_validado';
        const guaranteePaymentMethod = normalizePaymentMethod(payload?.guaranteePaymentMethod);
        const initialPaymentMethod = normalizePaymentMethod(payload?.initialPaymentMethod);
        const guaranteePaymentAccount = guaranteePaymentMethod === 'qr' ? normalizeQrPaymentAccount(payload?.guaranteePaymentAccount) : '';
        const initialPaymentAccount = initialPaymentMethod === 'qr' ? normalizeQrPaymentAccount(payload?.initialPaymentAccount) : '';
        const paidAtApprovalBs = Math.max(0, toPositiveRoundedNumber(payload?.paidAtApprovalBs ?? 0));
        const clientId = payload?.clientId || resolveClientFromName(state, customerName, customerPhone, payload?.address, payload?.city, customerReferencePhone, customerCi);
        if (payload?.clientId) {
          syncClientOperationalData(state, clientId, { customerPhone, customerReferencePhone, customerCi, address: payload?.address, city: payload?.city });
        }

        const normalizedItems = requestedItems.map((line, index) => {
          const item = resolveOperationalItemFromLine(state, line, now);
          if (!item) throw new Error('Uno de los items seleccionados no existe.');
          const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
          const lineType = String(line?.lineType ?? '').trim();
          const isCourtesyLine = lineType === 'courtesy';
          const unitPriceBs = isCourtesyLine ? 0 : Math.max(0, toPositiveRoundedNumber(line.unitPriceBs ?? item.rentalPriceBs ?? 0));
          const discountPercent = isCourtesyLine ? 0 : Math.min(100, Math.max(0, toPositiveRoundedNumber(line.discountPercent ?? 0)));
          const discountBs = isCourtesyLine ? 0 : Math.max(0, toPositiveRoundedNumber(line.discountBs ?? 0));
          const grossLineTotalBs = isCourtesyLine ? 0 : Number.isFinite(Number(line.grossLineTotalBs))
            ? Math.max(0, toPositiveRoundedNumber(line.grossLineTotalBs))
            : Number((quantity * unitPriceBs).toFixed(2));
          const lineTotalBs = isCourtesyLine ? 0 : Number.isFinite(Number(line.lineTotalBs))
            ? Math.max(0, toPositiveRoundedNumber(line.lineTotalBs))
            : Number(Math.max(0, grossLineTotalBs - discountBs).toFixed(2));
          return {
            lineKey: getInventoryLineKey(line, index),
            itemId: item.id,
            itemName: item.name,
            quantity,
            unitPriceBs,
            grossLineTotalBs,
            discountPercent,
            discountBs,
            lineTotalBs,
            lineType,
            controlsStock: lineControlsStock(line, item),
            verificationStatus: lineControlsStock(line, item) ? (item.verificationStatus ?? 'verified') : 'pending_verification',
            comboId: String(line?.comboId ?? '').trim() || null,
            comboName: String(line?.comboName ?? '').trim(),
            comboLineKey: String(line?.comboLineKey ?? '').trim() || null,
            comboComponentName: String(line?.comboComponentName ?? item.name).trim(),
            comboQuantity: Math.max(1, Math.trunc(Number(line?.comboQuantity ?? 1))),
            comboComponentQuantity: Math.max(1, Math.trunc(Number(line?.comboComponentQuantity ?? (Number(line?.quantity ?? 1) / Math.max(1, Number(line?.comboQuantity ?? 1)))))),
            comboRuleIndex: Math.max(0, Math.trunc(Number(line?.comboRuleIndex ?? 0))),
            comboSlotLabel: String(line?.comboSlotLabel ?? '').trim(),
            comboSelectionMode: String(line?.comboSelectionMode ?? 'item').trim() || 'item',
            comboOptionItemIds: Array.isArray(line?.comboOptionItemIds) ? line.comboOptionItemIds.map(String) : [],
            comboCategory: String(line?.comboCategory ?? '').trim(),
            comboPricingRole: String(line?.comboPricingRole ?? '').trim(),
            comboPricingCondition: line?.comboPricingCondition ? normalizeComboPricingCondition(line.comboPricingCondition) : null,
            observation: String(line?.observation ?? line?.observations ?? line?.note ?? (isCourtesyLine ? 'Cortesia' : '')).trim(),
            serviceDayId: String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim() || null,
            serviceDate: String(line?.serviceDate ?? '').trim() || null,
            serviceDayLabel: String(line?.serviceDayLabel ?? '').trim(),
          };
        });

        const normalizedSupplierFulfillmentPlan = repriceSupplierFulfillmentPlanFromItems(
          payload?.supplierFulfillmentPlan,
          normalizedItems,
        );
        const itemsGrossSubtotalBs = normalizedItems.reduce((sum, line) => sum + Number(line.grossLineTotalBs ?? line.lineTotalBs ?? 0), 0)
          + getManualSupplierSaleTotalBs(normalizedSupplierFulfillmentPlan);
        const itemDiscountsBs = normalizedItems.reduce((sum, line) => sum + Number(line.discountBs ?? 0), 0);
        const itemsBaseSubtotalBs = normalizedItems.reduce((sum, line) => sum + line.lineTotalBs, 0)
          + getManualSupplierSaleTotalBs(normalizedSupplierFulfillmentPlan);
        const servicesSubtotalBs = requestedServices.reduce((sum, line) => sum + line.lineTotalBs, 0);
        const pricingPlan = enrichDailySchedulePricingPlan(
          calculateDurationPricing({ pricingPlan: payload?.pricingPlan, baseSubtotalBs: itemsBaseSubtotalBs }),
          normalizedItems,
          requestedServices,
        );
        const alignedItems = alignLinesToDailySchedule(pricingPlan, normalizedItems);
        const alignedServices = alignLinesToDailySchedule(pricingPlan, requestedServices);
        const baseSubtotalBs = itemsBaseSubtotalBs + servicesSubtotalBs;
        const subtotalBs = pricingPlan.chargeableSubtotalBs + servicesSubtotalBs;
        const logisticsMode = ['envio', 'recojo'].includes(payload?.logisticsMode) ? payload.logisticsMode : 'envio';
        const deliveryCharge = normalizeDeliveryCharge({ ...payload, logisticsMode });
        const totalBs = Math.max(0, subtotalBs - discountBs + deliveryCharge.deliveryFeeBs);
        const overpaidBs = Math.max(0, Number((paidAtApprovalBs - totalBs).toFixed(2)));
        const responsibles = normalizeRecordResponsibles(payload);
        const primaryResponsible = responsibles[0] ?? null;

        created = {
          id: makeId('quo'),
          quoteCode: consumeCommercialDocumentCode(state, payload, 'quotePrefix', 'quoteNext', 'quotes', 'quoteCode', 5),
          clientId,
          customerName,
          customerCi,
          customerPhone,
          customerReferencePhone,
          companyName: String(payload?.companyName ?? customerName).trim(),
          eventType: String(payload?.eventType ?? 'general').trim() || 'general',
          eventDate,
          eventTime,
          address: String(payload?.address ?? '').trim(),
          city: String(payload?.city ?? '').trim(),
          deliveryDate,
          logisticsMode,
          deliveryChargeMode: deliveryCharge.deliveryChargeMode,
          deliveryFeeBs: Number(deliveryCharge.deliveryFeeBs.toFixed(2)),
          deliveryFeeReason: deliveryCharge.deliveryFeeReason,
          deliveryWindowStart,
          deliveryWindowEnd,
          deliveryTimeMode,
          pickupDate,
          pickupWindowStart,
          pickupWindowEnd,
          pickupTimeMode,
          driverId: String(payload?.driverId ?? '').trim() || null,
          vehicleId: String(payload?.vehicleId ?? '').trim() || null,
          validUntil: String(payload?.validUntil ?? '').trim() || null,
          observations: String(payload?.observations ?? '').trim(),
          billingMode: ['con_factura', 'sin_factura'].includes(payload?.billingMode) ? payload.billingMode : 'sin_factura',
          status,
          pricingPlan,
          totals: {
            itemsGrossSubtotalBs: Number(itemsGrossSubtotalBs.toFixed(2)),
            itemDiscountsBs: Number(itemDiscountsBs.toFixed(2)),
            itemsNetSubtotalBs: Number(itemsBaseSubtotalBs.toFixed(2)),
            itemsSubtotalBs: Number(itemsBaseSubtotalBs.toFixed(2)),
            servicesSubtotalBs: Number(servicesSubtotalBs.toFixed(2)),
            baseSubtotalBs: Number(baseSubtotalBs.toFixed(2)),
            subtotalBs: Number(subtotalBs.toFixed(2)),
            theoreticalSubtotalBs: Number(pricingPlan.theoreticalSubtotalBs.toFixed(2)),
            durationDiscountBs: Number(pricingPlan.durationDiscountBs.toFixed(2)),
            discountMode,
            discountBs: Number(discountBs.toFixed(2)),
            discountPercent: Number(generalDiscountPercent.toFixed(2)),
            deliveryFeeBs: Number(deliveryCharge.deliveryFeeBs.toFixed(2)),
            guaranteeBs: Number(guaranteeBs.toFixed(2)),
            totalBs: Number(totalBs.toFixed(2)),
          },
          payment: {
            paidAtApprovalBs: Number(paidAtApprovalBs.toFixed(2)),
            pendingBs: Number(Math.max(0, totalBs - paidAtApprovalBs).toFixed(2)),
            overpaidBs,
            prepaidAppliedBs: Math.max(0, Number(payload?.prepaidAppliedBs ?? 0)),
            initialPaymentMethod,
            initialPaymentAccount,
            guaranteeStatus,
            guaranteePaymentMethod,
            guaranteePaymentAccount,
          },
          guarantee: {
            amountBs: Number(guaranteeBs.toFixed(2)),
            status: guaranteeStatus,
            paymentMethod: guaranteePaymentMethod,
            paymentAccount: guaranteePaymentAccount,
          },
          items: alignedItems,
          services: alignedServices,
          supplierFulfillmentPlan: normalizedSupplierFulfillmentPlan,
          approvedAt: null,
          rejectedAt: null,
          isFinalized: false,
          finalizedAt: null,
          finalizedById: null,
          finalizedByName: '',
          finalizedByRole: '',
          rentalId: null,
          orderCode: null,
          createdBy: String(payload?.createdBy ?? primaryResponsible?.name ?? 'system').trim() || 'system',
          createdById: payload?.createdById ?? payload?.userId ?? primaryResponsible?.id ?? null,
          createdByName: String(payload?.createdByName ?? payload?.userName ?? primaryResponsible?.name ?? payload?.createdBy ?? 'Sistema').trim() || 'Sistema',
          createdByRole: String(payload?.createdByRole ?? payload?.userRole ?? primaryResponsible?.role ?? 'Sistema').trim() || 'Sistema',
          responsibles,
          revisionHistory: [],
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };

        if (!Array.isArray(state.quotes)) state.quotes = [];
        state.quotes.push(created);
        return state;
      });

      return created;
    },
    update: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar la cotizacion.');

      let updated = null;
      transaction((state) => {
        if (!Array.isArray(state.quotes)) state.quotes = [];
        const quote = state.quotes.find((entry) => entry.id === id && !entry.deletedAt);
        if (!quote) throw new Error('Cotizacion no encontrada.');

        if (payload.customerName !== undefined) quote.customerName = String(payload.customerName ?? '').trim() || quote.customerName;
        if (payload.customerCi !== undefined || payload.nitCi !== undefined) quote.customerCi = String(payload.customerCi ?? payload.nitCi ?? '').trim();
        if (payload.customerPhone !== undefined) quote.customerPhone = String(payload.customerPhone ?? '').trim() || quote.customerPhone;
        if (payload.customerReferencePhone !== undefined) quote.customerReferencePhone = String(payload.customerReferencePhone ?? '').trim();
        if (payload.companyName !== undefined) quote.companyName = String(payload.companyName ?? '').trim() || quote.companyName;
        if (payload.eventType !== undefined) quote.eventType = String(payload.eventType ?? '').trim() || quote.eventType;
        if (payload.eventDate !== undefined) quote.eventDate = String(payload.eventDate ?? '').trim() || quote.eventDate;
        if (payload.eventTime !== undefined) quote.eventTime = String(payload.eventTime ?? '').trim() || quote.eventTime;
        if (payload.address !== undefined) quote.address = String(payload.address ?? '').trim();
        if (payload.city !== undefined) quote.city = String(payload.city ?? '').trim();
        if (payload.deliveryDate !== undefined) quote.deliveryDate = String(payload.deliveryDate ?? '').trim() || quote.deliveryDate;
        if (payload.logisticsMode !== undefined) {
          quote.logisticsMode = ['envio', 'recojo'].includes(payload.logisticsMode) ? payload.logisticsMode : 'envio';
        }
        if (payload.deliveryWindowStart !== undefined) quote.deliveryWindowStart = String(payload.deliveryWindowStart ?? '').trim() || quote.deliveryWindowStart;
        if (payload.deliveryWindowEnd !== undefined) quote.deliveryWindowEnd = String(payload.deliveryWindowEnd ?? '').trim() || quote.deliveryWindowEnd;
        if (payload.deliveryTimeMode !== undefined) quote.deliveryTimeMode = payload.deliveryTimeMode === 'coordinate' ? 'coordinate' : 'fixed';
        if (payload.pickupDate !== undefined) quote.pickupDate = String(payload.pickupDate ?? '').trim() || quote.pickupDate;
        if (payload.pickupWindowStart !== undefined) quote.pickupWindowStart = String(payload.pickupWindowStart ?? '').trim() || quote.pickupWindowStart;
        if (payload.pickupWindowEnd !== undefined) quote.pickupWindowEnd = String(payload.pickupWindowEnd ?? '').trim() || quote.pickupWindowEnd;
        if (payload.pickupTimeMode !== undefined) quote.pickupTimeMode = payload.pickupTimeMode === 'coordinate' ? 'coordinate' : 'fixed';
        assertSameDayTimeWindow(quote.deliveryWindowStart, quote.deliveryWindowEnd, 'La ventana de entrega');
        assertSameDayTimeWindow(quote.pickupWindowStart, quote.pickupWindowEnd, 'La ventana de recojo');
        if (payload.clientId !== undefined) quote.clientId = payload.clientId ?? null;
        if (quote.clientId) {
          syncClientOperationalData(state, quote.clientId, {
            customerPhone: quote.customerPhone,
            customerReferencePhone: quote.customerReferencePhone,
            customerCi: quote.customerCi,
            address: quote.address,
            city: quote.city,
          });
        }
        if (payload.status !== undefined) quote.status = String(payload.status ?? '').trim() || quote.status;
        if (payload.observations !== undefined) quote.observations = String(payload.observations ?? '').trim();
        if (payload.billingMode !== undefined) {
          quote.billingMode = ['con_factura', 'sin_factura'].includes(payload.billingMode) ? payload.billingMode : 'sin_factura';
        }
        if (payload.validUntil !== undefined) quote.validUntil = String(payload.validUntil ?? '').trim() || null;
        if (payload.driverId !== undefined) quote.driverId = String(payload.driverId ?? '').trim() || null;
        if (payload.vehicleId !== undefined) quote.vehicleId = String(payload.vehicleId ?? '').trim() || null;
        if (payload.approvedAt !== undefined) quote.approvedAt = payload.approvedAt ?? null;
        if (payload.rejectedAt !== undefined) quote.rejectedAt = payload.rejectedAt ?? null;
        if (payload.rentalId !== undefined) quote.rentalId = payload.rentalId ?? null;
        if (payload.orderCode !== undefined) quote.orderCode = payload.orderCode ?? null;
        if (payload.supplierFulfillmentPlan !== undefined) {
          quote.supplierFulfillmentPlan = normalizeSupplierFulfillmentPlan(payload.supplierFulfillmentPlan);
        }

        if (payload.items !== undefined) {
          const requestedItems = Array.isArray(payload.items) ? payload.items : [];
          quote.items = requestedItems.map((line, index) => {
            const item = resolveOperationalItemFromLine(state, line);
            if (!item) throw new Error('Uno de los items seleccionados no existe.');
            const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
            const lineType = String(line?.lineType ?? '').trim();
            const isCourtesyLine = lineType === 'courtesy';
            const unitPriceBs = isCourtesyLine ? 0 : Math.max(0, toPositiveRoundedNumber(line.unitPriceBs ?? item.rentalPriceBs ?? 0));
            const discountPercent = isCourtesyLine ? 0 : Math.min(100, Math.max(0, toPositiveRoundedNumber(line.discountPercent ?? 0)));
            const discountBs = isCourtesyLine ? 0 : Math.max(0, toPositiveRoundedNumber(line.discountBs ?? 0));
            const grossLineTotalBs = isCourtesyLine ? 0 : Number.isFinite(Number(line.grossLineTotalBs))
              ? Math.max(0, toPositiveRoundedNumber(line.grossLineTotalBs))
              : Number((quantity * unitPriceBs).toFixed(2));
            const lineTotalBs = isCourtesyLine ? 0 : Number.isFinite(Number(line.lineTotalBs))
              ? Math.max(0, toPositiveRoundedNumber(line.lineTotalBs))
              : Number(Math.max(0, grossLineTotalBs - discountBs).toFixed(2));
            return {
              lineKey: getInventoryLineKey(line, index),
              itemId: item.id,
              itemName: item.name,
              quantity,
              unitPriceBs,
              grossLineTotalBs,
              discountPercent,
              discountBs,
              lineTotalBs,
              lineType,
              controlsStock: lineControlsStock(line, item),
              verificationStatus: lineControlsStock(line, item) ? (item.verificationStatus ?? 'verified') : 'pending_verification',
              comboId: String(line?.comboId ?? '').trim() || null,
              comboName: String(line?.comboName ?? '').trim(),
              comboLineKey: String(line?.comboLineKey ?? '').trim() || null,
              comboComponentName: String(line?.comboComponentName ?? item.name).trim(),
              comboQuantity: Math.max(1, Math.trunc(Number(line?.comboQuantity ?? 1))),
              comboComponentQuantity: Math.max(1, Math.trunc(Number(line?.comboComponentQuantity ?? (Number(line?.quantity ?? 1) / Math.max(1, Number(line?.comboQuantity ?? 1)))))),
              comboRuleIndex: Math.max(0, Math.trunc(Number(line?.comboRuleIndex ?? 0))),
              comboSlotLabel: String(line?.comboSlotLabel ?? '').trim(),
              comboSelectionMode: String(line?.comboSelectionMode ?? 'item').trim() || 'item',
              comboOptionItemIds: Array.isArray(line?.comboOptionItemIds) ? line.comboOptionItemIds.map(String) : [],
              comboCategory: String(line?.comboCategory ?? '').trim(),
              comboPricingRole: String(line?.comboPricingRole ?? '').trim(),
              comboPricingCondition: line?.comboPricingCondition ? normalizeComboPricingCondition(line.comboPricingCondition) : null,
              observation: String(line?.observation ?? line?.observations ?? line?.note ?? (isCourtesyLine ? 'Cortesia' : '')).trim(),
              serviceDayId: String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim() || null,
              serviceDate: String(line?.serviceDate ?? '').trim() || null,
              serviceDayLabel: String(line?.serviceDayLabel ?? '').trim(),
            };
          });
        }
        if (payload.services !== undefined) {
          quote.services = normalizeContractServices(payload.services);
        }
        if (!(quote.items ?? []).length && !(quote.services ?? []).length) {
          throw new Error('Debes agregar al menos un item o servicio en la cotizacion.');
        }

        if (payload.pricingPlan !== undefined) {
          quote.pricingPlan = payload.pricingPlan;
        }

        const itemsGrossSubtotalBs = quote.items.reduce((sum, line) => sum + Number(line.grossLineTotalBs ?? line.lineTotalBs ?? 0), 0)
          + getManualSupplierSaleTotalBs(quote.supplierFulfillmentPlan);
        const itemDiscountsBs = quote.items.reduce((sum, line) => sum + Number(line.discountBs ?? 0), 0);
        const itemsBaseSubtotalBs = quote.items.reduce((sum, line) => sum + Number(line.lineTotalBs ?? 0), 0)
          + getManualSupplierSaleTotalBs(quote.supplierFulfillmentPlan);
        const servicesSubtotalBs = (quote.services ?? []).reduce((sum, line) => sum + Number(line.lineTotalBs ?? 0), 0);
        const pricingPlan = enrichDailySchedulePricingPlan(
          calculateDurationPricing({ pricingPlan: quote.pricingPlan, baseSubtotalBs: itemsBaseSubtotalBs }),
          quote.items ?? [],
          quote.services ?? [],
        );
        const baseSubtotalBs = itemsBaseSubtotalBs + servicesSubtotalBs;
        const subtotalBs = pricingPlan.chargeableSubtotalBs + servicesSubtotalBs;
        const discountMode = payload?.discountMode === 'fixed'
          ? 'fixed'
          : payload?.discountMode === 'percent'
            ? 'percent'
            : quote?.totals?.discountMode === 'fixed' ? 'fixed' : 'percent';
        const discountBs = Math.max(0, toPositiveRoundedNumber(payload?.discountBs ?? quote?.totals?.discountBs ?? 0));
        const discountPercent = discountMode === 'percent'
          ? Math.min(100, Math.max(0, toPositiveRoundedNumber(payload?.discountPercent ?? quote?.totals?.discountPercent ?? 0)))
          : 0;
        const guaranteeBs = Math.max(0, toPositiveRoundedNumber(payload?.guaranteeBs ?? quote?.totals?.guaranteeBs ?? 0));
        const guaranteeStatus = String(payload?.guaranteeStatus ?? quote?.guarantee?.status ?? quote?.payment?.guaranteeStatus ?? '').trim() === 'validado'
          ? 'validado'
          : 'no_validado';
        const guaranteePaymentMethod = normalizePaymentMethod(payload?.guaranteePaymentMethod ?? quote?.guarantee?.paymentMethod ?? quote?.payment?.guaranteePaymentMethod);
        const initialPaymentMethod = normalizePaymentMethod(payload?.initialPaymentMethod ?? quote?.payment?.initialPaymentMethod);
        const guaranteePaymentAccount = guaranteePaymentMethod === 'qr'
          ? normalizeQrPaymentAccount(payload?.guaranteePaymentAccount ?? quote?.guarantee?.paymentAccount ?? quote?.payment?.guaranteePaymentAccount)
          : '';
        const initialPaymentAccount = initialPaymentMethod === 'qr'
          ? normalizeQrPaymentAccount(payload?.initialPaymentAccount ?? quote?.payment?.initialPaymentAccount ?? quote?.payment?.paymentAccount)
          : '';
        const deliveryCharge = normalizeDeliveryCharge({
          logisticsMode: quote.logisticsMode,
          deliveryChargeMode: payload?.deliveryChargeMode ?? quote?.deliveryChargeMode,
          deliveryFeeBs: payload?.deliveryFeeBs ?? quote?.deliveryFeeBs ?? quote?.totals?.deliveryFeeBs,
          deliveryFeeReason: payload?.deliveryFeeReason ?? quote?.deliveryFeeReason,
        });
        const totalBs = Math.max(0, subtotalBs - discountBs + deliveryCharge.deliveryFeeBs);
        const paidAtApprovalBs = Math.max(0, toPositiveRoundedNumber(payload?.paidAtApprovalBs ?? quote?.payment?.paidAtApprovalBs ?? 0));
        const overpaidBs = Math.max(0, Number((paidAtApprovalBs - totalBs).toFixed(2)));

        quote.deliveryChargeMode = deliveryCharge.deliveryChargeMode;
        quote.deliveryFeeBs = Number(deliveryCharge.deliveryFeeBs.toFixed(2));
        quote.deliveryFeeReason = deliveryCharge.deliveryFeeReason;
        quote.totals = {
          itemsGrossSubtotalBs: Number(itemsGrossSubtotalBs.toFixed(2)),
          itemDiscountsBs: Number(itemDiscountsBs.toFixed(2)),
          itemsNetSubtotalBs: Number(itemsBaseSubtotalBs.toFixed(2)),
          itemsSubtotalBs: Number(itemsBaseSubtotalBs.toFixed(2)),
          servicesSubtotalBs: Number(servicesSubtotalBs.toFixed(2)),
          baseSubtotalBs: Number(baseSubtotalBs.toFixed(2)),
          subtotalBs: Number(subtotalBs.toFixed(2)),
          theoreticalSubtotalBs: Number(pricingPlan.theoreticalSubtotalBs.toFixed(2)),
          durationDiscountBs: Number(pricingPlan.durationDiscountBs.toFixed(2)),
          discountMode,
          discountBs: Number(discountBs.toFixed(2)),
          discountPercent: Number(discountPercent.toFixed(2)),
          deliveryFeeBs: Number(deliveryCharge.deliveryFeeBs.toFixed(2)),
          guaranteeBs: Number(guaranteeBs.toFixed(2)),
          totalBs: Number(totalBs.toFixed(2)),
        };
        quote.pricingPlan = pricingPlan;
        quote.payment = {
          paidAtApprovalBs: Number(paidAtApprovalBs.toFixed(2)),
          pendingBs: Number(Math.max(0, totalBs - paidAtApprovalBs).toFixed(2)),
          overpaidBs,
          initialPaymentMethod,
          initialPaymentAccount,
          guaranteeStatus,
          guaranteePaymentMethod,
          guaranteePaymentAccount,
        };
        quote.guarantee = {
          amountBs: Number(guaranteeBs.toFixed(2)),
          status: guaranteeStatus,
          paymentMethod: guaranteePaymentMethod,
          paymentAccount: guaranteePaymentAccount,
        };
        if (payload.responsibles !== undefined) {
          const responsibles = normalizeRecordResponsibles(payload);
          const primaryResponsible = responsibles[0] ?? null;
          quote.responsibles = responsibles;
          if (primaryResponsible) {
            quote.createdBy = primaryResponsible.name;
            quote.createdById = primaryResponsible.id;
            quote.createdByName = primaryResponsible.name;
            quote.createdByRole = primaryResponsible.role;
          }
        }
        quote.updatedAt = new Date().toISOString();

        updated = deepClone(quote);
        return state;
      });

      return updated;
    },
    remove: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar la cotizacion.');

      let updated = null;
      transaction((state) => {
        if (!Array.isArray(state.quotes)) state.quotes = [];
        const quote = state.quotes.find((entry) => entry.id === id);
        if (!quote) throw new Error('Cotizacion no encontrada.');
        quote.deletedAt = new Date().toISOString();
        quote.updatedAt = new Date().toISOString();
        updated = deepClone(quote);
        return state;
      });

      return updated;
    },
  },

  contracts: {
    list: async () => {
      const { contracts } = readQueryState();
      return contracts
        .filter((row) => !row.deletedAt)
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    listHidden: async () => {
      const { contracts } = readQueryState();
      return contracts
        .filter((row) => row.deletedAt)
        .slice()
        .sort((a, b) => new Date(b.deletedAt ?? b.updatedAt ?? b.createdAt) - new Date(a.deletedAt ?? a.updatedAt ?? a.createdAt));
    },
    create: async (payload) => {
      const customerName = String(payload?.customerName ?? '').trim();
      const customerCi = String(payload?.customerCi ?? payload?.nitCi ?? '').trim();
      const customerPhone = String(payload?.customerPhone ?? '').trim();
      const customerReferencePhone = String(payload?.customerReferencePhone ?? '').trim();
      const eventDate = String(payload?.eventDate ?? '').trim();
      const eventTime = String(payload?.eventTime ?? '').trim();
      const deliveryDate = String(payload?.deliveryDate ?? eventDate).trim();
      const deliveryWindowStart = String(payload?.deliveryWindowStart ?? '08:00').trim();
      const deliveryWindowEnd = String(payload?.deliveryWindowEnd ?? '10:00').trim();
      const deliveryTimeMode = payload?.deliveryTimeMode === 'coordinate' ? 'coordinate' : 'fixed';
      const pickupDate = String(payload?.pickupDate ?? eventDate).trim();
      const pickupWindowStart = String(payload?.pickupWindowStart ?? '20:00').trim();
      const pickupWindowEnd = String(payload?.pickupWindowEnd ?? '22:00').trim();
      const pickupTimeMode = payload?.pickupTimeMode === 'coordinate' ? 'coordinate' : 'fixed';
      const status = String(payload?.status ?? 'borrador').trim() || 'borrador';
      const requestedItems = Array.isArray(payload?.items) ? payload.items : [];
      const requestedServices = normalizeContractServices(payload?.services);

      if (!customerName) throw new Error('Debes indicar el cliente del contrato.');
      if (!customerPhone) throw new Error('Debes indicar el WhatsApp o celular del cliente.');
      if (!eventDate) throw new Error('Debes indicar la fecha del evento.');
      if (!eventTime) throw new Error('Debes indicar la hora del evento.');
      if (!deliveryDate) throw new Error('Debes indicar la fecha de entrega.');
      if (!pickupDate) throw new Error('Debes indicar la fecha de recojo.');
      if (!requestedItems.length && !requestedServices.length) throw new Error('Debes agregar al menos un item o servicio en el contrato.');
      assertSameDayTimeWindow(deliveryWindowStart, deliveryWindowEnd, 'La ventana de entrega');
      assertSameDayTimeWindow(pickupWindowStart, pickupWindowEnd, 'La ventana de recojo');

      let created = null;
      transaction((state) => {
        const now = new Date().toISOString();
        const discountMode = payload?.discountMode === 'fixed' ? 'fixed' : 'percent';
        const discountBs = Math.max(0, toPositiveRoundedNumber(payload?.discountBs ?? 0));
        const discountPercent = discountMode === 'percent'
          ? Math.min(100, Math.max(0, toPositiveRoundedNumber(payload?.discountPercent ?? 0)))
          : 0;
        const guaranteeBs = Math.max(0, toPositiveRoundedNumber(payload?.guaranteeBs ?? 0));
        const guaranteeStatus = String(payload?.guaranteeStatus ?? '').trim() === 'validado' ? 'validado' : 'no_validado';
        const guaranteePaymentMethod = normalizePaymentMethod(payload?.guaranteePaymentMethod);
        const initialPaymentMethod = normalizePaymentMethod(payload?.initialPaymentMethod);
        const guaranteePaymentAccount = guaranteePaymentMethod === 'qr' ? normalizeQrPaymentAccount(payload?.guaranteePaymentAccount) : '';
        const initialPaymentAccount = initialPaymentMethod === 'qr' ? normalizeQrPaymentAccount(payload?.initialPaymentAccount) : '';
        const paidAtApprovalBs = Math.max(0, toPositiveRoundedNumber(payload?.paidAtApprovalBs ?? 0));
        const clientId = payload?.clientId || resolveClientFromName(state, customerName, customerPhone, payload?.address, payload?.city, customerReferencePhone, customerCi);
        if (payload?.clientId) {
          syncClientOperationalData(state, clientId, { customerPhone, customerReferencePhone, customerCi, address: payload?.address, city: payload?.city });
        }

        const normalizedItems = requestedItems.map((line, index) => {
          const item = resolveOperationalItemFromLine(state, line, now);
          if (!item) throw new Error('Uno de los items seleccionados no existe.');

          const quantity = Math.max(1, Math.trunc(Number(line?.quantity ?? 1)));
          const lineType = String(line?.lineType ?? '').trim();
          const isCourtesyLine = lineType === 'courtesy';
          const unitPriceBs = isCourtesyLine ? 0 : Math.max(0, toPositiveRoundedNumber(line?.unitPriceBs ?? item.rentalPriceBs ?? 0));
          const lineDiscountPercent = isCourtesyLine ? 0 : Math.min(100, Math.max(0, toPositiveRoundedNumber(line.discountPercent ?? 0)));
          const lineDiscountBs = isCourtesyLine ? 0 : Math.max(0, toPositiveRoundedNumber(line.discountBs ?? 0));
          const grossLineTotalBs = isCourtesyLine ? 0 : Number.isFinite(Number(line.grossLineTotalBs))
            ? Math.max(0, toPositiveRoundedNumber(line.grossLineTotalBs))
            : Number((quantity * unitPriceBs).toFixed(2));
          const lineTotalBs = isCourtesyLine ? 0 : Number.isFinite(Number(line.lineTotalBs))
            ? Math.max(0, toPositiveRoundedNumber(line.lineTotalBs))
            : Number(Math.max(0, grossLineTotalBs - lineDiscountBs).toFixed(2));
          return {
            lineKey: getInventoryLineKey(line, index),
            itemId: item.id,
            itemName: item.name,
            quantity,
            unitPriceBs,
            grossLineTotalBs,
            discountPercent: lineDiscountPercent,
            discountBs: lineDiscountBs,
            lineTotalBs,
            lineType,
            controlsStock: lineControlsStock(line, item),
            verificationStatus: lineControlsStock(line, item) ? (item.verificationStatus ?? 'verified') : 'pending_verification',
            comboId: String(line?.comboId ?? '').trim() || null,
            comboName: String(line?.comboName ?? '').trim(),
            comboLineKey: String(line?.comboLineKey ?? '').trim() || null,
            comboComponentName: String(line?.comboComponentName ?? item.name).trim(),
            comboQuantity: Math.max(1, Math.trunc(Number(line?.comboQuantity ?? 1))),
            comboComponentQuantity: Math.max(1, Math.trunc(Number(line?.comboComponentQuantity ?? (Number(line?.quantity ?? 1) / Math.max(1, Number(line?.comboQuantity ?? 1)))))),
            comboRuleIndex: Math.max(0, Math.trunc(Number(line?.comboRuleIndex ?? 0))),
            comboSlotLabel: String(line?.comboSlotLabel ?? '').trim(),
            comboSelectionMode: String(line?.comboSelectionMode ?? 'item').trim() || 'item',
            comboOptionItemIds: Array.isArray(line?.comboOptionItemIds) ? line.comboOptionItemIds.map(String) : [],
            comboCategory: String(line?.comboCategory ?? '').trim(),
            comboPricingRole: String(line?.comboPricingRole ?? '').trim(),
            comboPricingCondition: line?.comboPricingCondition ? normalizeComboPricingCondition(line.comboPricingCondition) : null,
            observation: String(line?.observation ?? line?.observations ?? line?.note ?? (isCourtesyLine ? 'Cortesia' : '')).trim(),
            serviceDayId: String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim() || null,
            serviceDate: String(line?.serviceDate ?? '').trim() || null,
            serviceDayLabel: String(line?.serviceDayLabel ?? '').trim(),
          };
        });

        const itemsGrossSubtotalBs = normalizedItems.reduce((sum, line) => sum + Number(line.grossLineTotalBs ?? line.lineTotalBs ?? 0), 0)
          + getManualSupplierSaleTotalBs(payload?.supplierFulfillmentPlan);
        const itemDiscountsBs = normalizedItems.reduce((sum, line) => sum + Number(line.discountBs ?? 0), 0);
        const itemsBaseSubtotalBs = normalizedItems.reduce((sum, line) => sum + line.lineTotalBs, 0)
          + getManualSupplierSaleTotalBs(payload?.supplierFulfillmentPlan);
        const servicesSubtotalBs = requestedServices.reduce((sum, line) => sum + line.lineTotalBs, 0);
        const pricingPlan = enrichDailySchedulePricingPlan(
          calculateDurationPricing({ pricingPlan: payload?.pricingPlan, baseSubtotalBs: itemsBaseSubtotalBs }),
          normalizedItems,
          requestedServices,
        );
        const baseSubtotalBs = itemsBaseSubtotalBs + servicesSubtotalBs;
        const subtotalBs = pricingPlan.chargeableSubtotalBs + servicesSubtotalBs;
        const logisticsMode = ['envio', 'recojo'].includes(payload?.logisticsMode) ? payload.logisticsMode : 'envio';
        const deliveryCharge = normalizeDeliveryCharge({ ...payload, logisticsMode });
        const totalBs = Math.max(0, subtotalBs - discountBs + deliveryCharge.deliveryFeeBs);
        const overpaidBs = Math.max(0, Number((paidAtApprovalBs - totalBs).toFixed(2)));
        const responsibles = normalizeRecordResponsibles(payload);
        const primaryResponsible = responsibles[0] ?? null;

        created = {
          id: makeId('con'),
          contractCode: consumeCommercialDocumentCode(state, payload, 'contractPrefix', 'contractNext', 'contracts', 'contractCode', 5),
          quoteId: String(payload?.quoteId ?? '').trim() || null,
          clientId,
          customerName,
          customerCi,
          customerPhone,
          customerReferencePhone,
          companyName: String(payload?.companyName ?? customerName).trim(),
          eventType: String(payload?.eventType ?? 'general').trim() || 'general',
          eventDate,
          eventTime,
          contractDate: String(payload?.contractDate ?? '').trim() || now,
          address: String(payload?.address ?? '').trim(),
          city: String(payload?.city ?? '').trim(),
          deliveryDate,
          logisticsMode,
          deliveryChargeMode: deliveryCharge.deliveryChargeMode,
          deliveryFeeBs: Number(deliveryCharge.deliveryFeeBs.toFixed(2)),
          deliveryFeeReason: deliveryCharge.deliveryFeeReason,
          deliveryWindowStart,
          deliveryWindowEnd,
          deliveryTimeMode,
          pickupDate,
          pickupWindowStart,
          pickupWindowEnd,
          pickupTimeMode,
          driverId: String(payload?.driverId ?? '').trim() || null,
          vehicleId: String(payload?.vehicleId ?? '').trim() || null,
          validUntil: null,
          observations: String(payload?.observations ?? '').trim(),
          billingMode: ['con_factura', 'sin_factura'].includes(payload?.billingMode) ? payload.billingMode : 'sin_factura',
          status,
          pricingPlan,
          totals: {
            itemsGrossSubtotalBs: Number(itemsGrossSubtotalBs.toFixed(2)),
            itemDiscountsBs: Number(itemDiscountsBs.toFixed(2)),
            itemsNetSubtotalBs: Number(itemsBaseSubtotalBs.toFixed(2)),
            itemsSubtotalBs: Number(itemsBaseSubtotalBs.toFixed(2)),
            servicesSubtotalBs: Number(servicesSubtotalBs.toFixed(2)),
            baseSubtotalBs: Number(baseSubtotalBs.toFixed(2)),
            subtotalBs: Number(subtotalBs.toFixed(2)),
            theoreticalSubtotalBs: Number(pricingPlan.theoreticalSubtotalBs.toFixed(2)),
            durationDiscountBs: Number(pricingPlan.durationDiscountBs.toFixed(2)),
            discountMode,
            discountBs: Number(discountBs.toFixed(2)),
            discountPercent: Number(discountPercent.toFixed(2)),
            deliveryFeeBs: Number(deliveryCharge.deliveryFeeBs.toFixed(2)),
            guaranteeBs: Number(guaranteeBs.toFixed(2)),
            totalBs: Number(totalBs.toFixed(2)),
          },
          payment: {
            paidAtApprovalBs: Number(paidAtApprovalBs.toFixed(2)),
            pendingBs: Number(Math.max(0, totalBs - paidAtApprovalBs).toFixed(2)),
            overpaidBs,
            initialPaymentMethod,
            initialPaymentAccount,
            guaranteeStatus,
            guaranteePaymentMethod,
            guaranteePaymentAccount,
          },
          guarantee: {
            amountBs: Number(guaranteeBs.toFixed(2)),
            status: guaranteeStatus,
            paymentMethod: guaranteePaymentMethod,
            paymentAccount: guaranteePaymentAccount,
          },
          items: normalizedItems,
          services: requestedServices,
          supplierFulfillmentPlan: normalizeSupplierFulfillmentPlan(payload?.supplierFulfillmentPlan),
          approvedAt: null,
          rejectedAt: null,
          rentalId: null,
          orderCode: null,
          createdBy: String(payload?.createdBy ?? primaryResponsible?.name ?? 'system').trim() || 'system',
          createdById: payload?.createdById ?? payload?.userId ?? primaryResponsible?.id ?? null,
          createdByName: String(payload?.createdByName ?? payload?.userName ?? primaryResponsible?.name ?? payload?.createdBy ?? 'Sistema').trim() || 'Sistema',
          createdByRole: String(payload?.createdByRole ?? payload?.userRole ?? primaryResponsible?.role ?? 'Sistema').trim() || 'Sistema',
          responsibles,
          revisionHistory: [],
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        appendContractRevision(created, payload, now, [
          `Contrato creado por ${created.createdByName || created.createdBy || 'Sistema'}`,
          `Numero de contrato: ${created.contractCode}`,
          `Cliente: ${created.customerName}`,
          `Total inicial: ${formatBs(created?.totals?.totalBs ?? 0)}`,
        ]);
        appendAuditLog(state, {
          action: 'create',
          module: 'Contratos',
          entityType: 'contract',
          entityId: created.id,
          entityCode: created.contractCode,
          title: `Creo contrato ${created.contractCode}`,
          detail: `${created.customerName} | Total ${formatBs(created?.totals?.totalBs ?? 0)}`,
          userId: created.createdById,
          userName: created.createdByName || created.createdBy || 'Sistema',
          userRole: created.createdByRole || 'Sistema',
          createdAt: now,
        });

        if (!Array.isArray(state.contracts)) state.contracts = [];
        state.contracts.push(created);
        return state;
      });

      return created;
    },
    update: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el contrato.');

      let updated = null;
      transaction((state) => {
        if (!Array.isArray(state.contracts)) state.contracts = [];
        const contract = state.contracts.find((entry) => entry.id === id && !entry.deletedAt);
        if (!contract) throw new Error('Contrato no encontrado.');
        const beforeContract = deepClone(contract);
        const requestedContractCode = String(payload?.manualDocumentCode ?? payload?.contractCode ?? '').trim();
        if (requestedContractCode && requestedContractCode !== String(contract.contractCode ?? '').trim()) {
          const duplicate = commercialDocumentCodeExists(state, 'contracts', 'contractCode', requestedContractCode, {
            id: contract.id,
            contractId: contract.id,
            rentalId: contract.rentalId,
          });
          if (duplicate) throw new Error('Ya existe un contrato con ese numero.');
          const previousContractCode = String(contract.contractCode ?? '').trim();
          contract.contractCode = requestedContractCode;
          if (Array.isArray(state.rentals)) {
            state.rentals.forEach((rental) => {
              const isLinkedRental = String(rental.contractId ?? '') === String(contract.id)
                || (previousContractCode && String(rental.contractCode ?? '').trim() === previousContractCode);
              if (isLinkedRental) rental.contractCode = requestedContractCode;
            });
          }
        }

        if (payload.customerName !== undefined) contract.customerName = String(payload.customerName ?? '').trim() || contract.customerName;
        if (payload.customerCi !== undefined || payload.nitCi !== undefined) contract.customerCi = String(payload.customerCi ?? payload.nitCi ?? '').trim();
        if (payload.customerPhone !== undefined) contract.customerPhone = String(payload.customerPhone ?? '').trim() || contract.customerPhone;
        if (payload.customerReferencePhone !== undefined) contract.customerReferencePhone = String(payload.customerReferencePhone ?? '').trim();
        if (payload.companyName !== undefined) contract.companyName = String(payload.companyName ?? '').trim() || contract.companyName;
        if (payload.eventType !== undefined) contract.eventType = String(payload.eventType ?? '').trim() || contract.eventType;
        if (payload.eventDate !== undefined) contract.eventDate = String(payload.eventDate ?? '').trim() || contract.eventDate;
        if (payload.eventTime !== undefined) contract.eventTime = String(payload.eventTime ?? '').trim() || contract.eventTime;
        if (payload.contractDate !== undefined) contract.contractDate = String(payload.contractDate ?? '').trim() || contract.contractDate || contract.createdAt;
        if (payload.address !== undefined) contract.address = String(payload.address ?? '').trim();
        if (payload.city !== undefined) contract.city = String(payload.city ?? '').trim();
        if (payload.deliveryDate !== undefined) contract.deliveryDate = String(payload.deliveryDate ?? '').trim() || contract.deliveryDate;
        if (payload.logisticsMode !== undefined) {
          contract.logisticsMode = ['envio', 'recojo'].includes(payload.logisticsMode) ? payload.logisticsMode : 'envio';
        }
        if (payload.deliveryWindowStart !== undefined) contract.deliveryWindowStart = String(payload.deliveryWindowStart ?? '').trim() || contract.deliveryWindowStart;
        if (payload.deliveryWindowEnd !== undefined) contract.deliveryWindowEnd = String(payload.deliveryWindowEnd ?? '').trim() || contract.deliveryWindowEnd;
        if (payload.deliveryTimeMode !== undefined) contract.deliveryTimeMode = payload.deliveryTimeMode === 'coordinate' ? 'coordinate' : 'fixed';
        if (payload.pickupDate !== undefined) contract.pickupDate = String(payload.pickupDate ?? '').trim() || contract.pickupDate;
        if (payload.pickupWindowStart !== undefined) contract.pickupWindowStart = String(payload.pickupWindowStart ?? '').trim() || contract.pickupWindowStart;
        if (payload.pickupWindowEnd !== undefined) contract.pickupWindowEnd = String(payload.pickupWindowEnd ?? '').trim() || contract.pickupWindowEnd;
        if (payload.pickupTimeMode !== undefined) contract.pickupTimeMode = payload.pickupTimeMode === 'coordinate' ? 'coordinate' : 'fixed';
        assertSameDayTimeWindow(contract.deliveryWindowStart, contract.deliveryWindowEnd, 'La ventana de entrega');
        assertSameDayTimeWindow(contract.pickupWindowStart, contract.pickupWindowEnd, 'La ventana de recojo');
        if (payload.clientId !== undefined) contract.clientId = payload.clientId ?? null;
        if (contract.clientId) {
          syncClientOperationalData(state, contract.clientId, {
            customerPhone: contract.customerPhone,
            customerReferencePhone: contract.customerReferencePhone,
            customerCi: contract.customerCi,
            address: contract.address,
            city: contract.city,
          });
        }
        if (payload.driverId !== undefined) contract.driverId = String(payload.driverId ?? '').trim() || null;
        if (payload.vehicleId !== undefined) contract.vehicleId = String(payload.vehicleId ?? '').trim() || null;
        contract.validUntil = null;
        if (payload.observations !== undefined) contract.observations = String(payload.observations ?? '').trim();
        if (payload.billingMode !== undefined) {
          contract.billingMode = ['con_factura', 'sin_factura'].includes(payload.billingMode) ? payload.billingMode : 'sin_factura';
        }
        if (payload.status !== undefined) contract.status = String(payload.status ?? '').trim() || contract.status;
        if (payload.approvedAt !== undefined) contract.approvedAt = payload.approvedAt ?? null;
        if (payload.rejectedAt !== undefined) contract.rejectedAt = payload.rejectedAt ?? null;
        if (payload.isFinalized !== undefined) {
          const nextFinalized = Boolean(payload.isFinalized);
          contract.isFinalized = nextFinalized;
          contract.finalizedAt = nextFinalized
            ? (payload.finalizedAt ?? contract.finalizedAt ?? new Date().toISOString())
            : null;
          contract.finalizedById = nextFinalized ? (payload.updatedById ?? payload.userId ?? null) : null;
          contract.finalizedByName = nextFinalized ? getAuditUserName(payload) : '';
          contract.finalizedByRole = nextFinalized ? getAuditUserRole(payload) : '';
        }
        if (payload.rentalId !== undefined) contract.rentalId = payload.rentalId ?? null;
        if (payload.orderCode !== undefined) contract.orderCode = payload.orderCode ?? null;
        const requestedSupplierFulfillmentPlan = payload.supplierFulfillmentPlan !== undefined
          ? payload.supplierFulfillmentPlan
          : contract.supplierFulfillmentPlan;

        if (payload.items !== undefined) {
          const requestedItems = Array.isArray(payload.items) ? payload.items : [];
          const normalizedItems = requestedItems.map((line, index) => {
            const lineKey = getInventoryLineKey(line, index);
            const previousLine = (contract.items ?? []).find((existingLine, existingIndex) => (
              getInventoryLineKey(existingLine, existingIndex) === lineKey
              || (
                String(existingLine?.itemId ?? '').trim()
                && String(existingLine?.itemId ?? '').trim() === String(line?.itemId ?? '').trim()
              )
            ));
            // Los contratos historicos pueden conservar referencias a productos que ya no
            // existen en el catalogo. Se permiten al editar para no bloquear la adicion de
            // productos vigentes, pero una linea nueva sin producto sigue siendo invalida.
            const item = resolveOperationalItemFromLine(state, line) ?? previousLine;
            if (!item) throw new Error('Uno de los items nuevos seleccionados no existe.');
            const quantity = Math.max(1, Math.trunc(Number(line?.quantity ?? 1)));
            const lineType = String(line?.lineType ?? '').trim();
            const isCourtesyLine = lineType === 'courtesy';
            const hasExplicitUnitPrice = line?.unitPriceBs !== undefined && line?.unitPriceBs !== null && line?.unitPriceBs !== '';
            const hasExplicitRentalPrice = line?.rentalPriceBs !== undefined && line?.rentalPriceBs !== null && line?.rentalPriceBs !== '';
            const hasPreviousUnitPrice = previousLine?.unitPriceBs !== undefined && previousLine?.unitPriceBs !== null && previousLine?.unitPriceBs !== '';
            const hasPreviousRentalPrice = previousLine?.rentalPriceBs !== undefined && previousLine?.rentalPriceBs !== null && previousLine?.rentalPriceBs !== '';
            const requestedLineTotalBs = Number.isFinite(Number(line?.lineTotalBs))
              ? Math.max(0, toPositiveRoundedNumber(line.lineTotalBs))
              : Number.isFinite(Number(previousLine?.lineTotalBs))
                ? Math.max(0, toPositiveRoundedNumber(previousLine.lineTotalBs))
                : 0;
            const explicitUnitPriceBs = hasExplicitUnitPrice
              ? toPositiveRoundedNumber(line.unitPriceBs)
              : hasExplicitRentalPrice
                ? toPositiveRoundedNumber(line.rentalPriceBs)
                : null;
            const previousUnitPriceBs = hasPreviousUnitPrice
              ? toPositiveRoundedNumber(previousLine.unitPriceBs)
              : hasPreviousRentalPrice
                ? toPositiveRoundedNumber(previousLine.rentalPriceBs)
                : null;
            const recoveredUnitPriceBs = explicitUnitPriceBs !== null
              ? explicitUnitPriceBs
              : previousUnitPriceBs !== null
                ? previousUnitPriceBs
              : requestedLineTotalBs > 0 && quantity > 0
                ? Number((requestedLineTotalBs / quantity).toFixed(2))
                : 0;
            const unitPriceBs = isCourtesyLine
              ? 0
              : recoveredUnitPriceBs > 0 || explicitUnitPriceBs !== null || previousUnitPriceBs !== null
                ? recoveredUnitPriceBs
                : Math.max(0, toPositiveRoundedNumber(item.rentalPriceBs ?? previousLine?.unitPriceBs ?? previousLine?.rentalPriceBs ?? 0));
            const discountPercent = isCourtesyLine ? 0 : Math.min(100, Math.max(0, toPositiveRoundedNumber(line.discountPercent ?? 0)));
            const discountBs = isCourtesyLine ? 0 : Math.max(0, toPositiveRoundedNumber(line.discountBs ?? 0));
            const grossLineTotalBs = isCourtesyLine ? 0 : Number.isFinite(Number(line.grossLineTotalBs))
              ? Math.max(0, toPositiveRoundedNumber(line.grossLineTotalBs))
              : Number((quantity * unitPriceBs).toFixed(2));
            const lineTotalBs = isCourtesyLine ? 0 : Number.isFinite(Number(line.lineTotalBs))
              ? Math.max(0, toPositiveRoundedNumber(line.lineTotalBs))
              : Number(Math.max(0, grossLineTotalBs - discountBs).toFixed(2));
            return {
              lineKey: getInventoryLineKey(line, index),
              itemId: item.id,
              itemName: item.name,
              quantity,
              unitPriceBs,
              grossLineTotalBs,
              discountPercent,
              discountBs,
              lineTotalBs,
              lineType,
              controlsStock: lineControlsStock(line, item),
              verificationStatus: lineControlsStock(line, item) ? (item.verificationStatus ?? 'verified') : 'pending_verification',
              comboId: String(line?.comboId ?? '').trim() || null,
              comboName: String(line?.comboName ?? '').trim(),
              comboLineKey: String(line?.comboLineKey ?? '').trim() || null,
              comboComponentName: String(line?.comboComponentName ?? item.name).trim(),
              comboQuantity: Math.max(1, Math.trunc(Number(line?.comboQuantity ?? 1))),
              comboComponentQuantity: Math.max(1, Math.trunc(Number(line?.comboComponentQuantity ?? (Number(line?.quantity ?? 1) / Math.max(1, Number(line?.comboQuantity ?? 1)))))),
              comboRuleIndex: Math.max(0, Math.trunc(Number(line?.comboRuleIndex ?? 0))),
              comboSlotLabel: String(line?.comboSlotLabel ?? '').trim(),
              comboSelectionMode: String(line?.comboSelectionMode ?? 'item').trim() || 'item',
              comboOptionItemIds: Array.isArray(line?.comboOptionItemIds) ? line.comboOptionItemIds.map(String) : [],
              comboCategory: String(line?.comboCategory ?? '').trim(),
              comboPricingRole: String(line?.comboPricingRole ?? '').trim(),
              comboPricingCondition: line?.comboPricingCondition ? normalizeComboPricingCondition(line.comboPricingCondition) : null,
              observation: String(line?.observation ?? line?.observations ?? line?.note ?? (isCourtesyLine ? 'Cortesia' : '')).trim(),
              serviceDayId: String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim() || null,
              serviceDate: String(line?.serviceDate ?? '').trim() || null,
              serviceDayLabel: String(line?.serviceDayLabel ?? '').trim(),
            };
          });
          contract.items = normalizedItems;
        }
        if (payload.services !== undefined) {
          contract.services = normalizeContractServices(payload.services);
        }
        if (!(contract.items ?? []).length && !(contract.services ?? []).length) {
          throw new Error('Debes agregar al menos un item o servicio en el contrato.');
        }

        if (payload.pricingPlan !== undefined) {
          contract.pricingPlan = payload.pricingPlan;
        }

        contract.supplierFulfillmentPlan = repriceSupplierFulfillmentPlanFromItems(
          requestedSupplierFulfillmentPlan,
          contract.items ?? [],
        );

        const itemsGrossSubtotalBs = contract.items.reduce((sum, line) => sum + Number(line.grossLineTotalBs ?? line.lineTotalBs ?? 0), 0)
          + getManualSupplierSaleTotalBs(contract.supplierFulfillmentPlan);
        const itemDiscountsBs = contract.items.reduce((sum, line) => sum + Number(line.discountBs ?? 0), 0);
        const itemsBaseSubtotalBs = contract.items.reduce((sum, line) => sum + Number(line.lineTotalBs ?? 0), 0)
          + getManualSupplierSaleTotalBs(contract.supplierFulfillmentPlan);
        const servicesSubtotalBs = (contract.services ?? []).reduce((sum, line) => sum + Number(line.lineTotalBs ?? 0), 0);
        const pricingPlan = enrichDailySchedulePricingPlan(
          calculateDurationPricing({ pricingPlan: contract.pricingPlan, baseSubtotalBs: itemsBaseSubtotalBs }),
          contract.items ?? [],
          contract.services ?? [],
        );
        contract.items = alignLinesToDailySchedule(pricingPlan, contract.items ?? []);
        contract.services = alignLinesToDailySchedule(pricingPlan, contract.services ?? []);
        const baseSubtotalBs = itemsBaseSubtotalBs + servicesSubtotalBs;
        const subtotalBs = pricingPlan.chargeableSubtotalBs + servicesSubtotalBs;
        const discountMode = payload?.discountMode === 'fixed'
          ? 'fixed'
          : payload?.discountMode === 'percent'
            ? 'percent'
            : contract?.totals?.discountMode === 'fixed' ? 'fixed' : 'percent';
        const discountBs = Math.max(0, Number(payload?.discountBs ?? contract?.totals?.discountBs ?? 0));
        const discountPercent = discountMode === 'percent'
          ? Math.min(100, Math.max(0, Number(payload?.discountPercent ?? contract?.totals?.discountPercent ?? 0)))
          : 0;
        const guaranteeBs = Math.max(0, Number(payload?.guaranteeBs ?? contract?.totals?.guaranteeBs ?? 0));
        const registeredGuaranteeBs = getRegisteredContractGuaranteeBs(state, contract);
        const requestedGuaranteeStatus = String(payload?.guaranteeStatus ?? contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? '').trim();
        const guaranteeStatus = requestedGuaranteeStatus === 'validado' || (guaranteeBs > 0 && registeredGuaranteeBs >= guaranteeBs)
          ? 'validado'
          : 'no_validado';
        const guaranteePaymentMethod = normalizePaymentMethod(payload?.guaranteePaymentMethod ?? contract?.guarantee?.paymentMethod ?? contract?.payment?.guaranteePaymentMethod);
        const initialPaymentMethod = normalizePaymentMethod(payload?.initialPaymentMethod ?? contract?.payment?.initialPaymentMethod);
        const guaranteePaymentAccount = guaranteePaymentMethod === 'qr'
          ? (
            normalizeQrPaymentAccount(payload?.guaranteePaymentAccount)
            || normalizeQrPaymentAccount(contract?.guarantee?.paymentAccount ?? contract?.payment?.guaranteePaymentAccount)
          )
          : '';
        const initialPaymentAccount = initialPaymentMethod === 'qr'
          ? (
            normalizeQrPaymentAccount(payload?.initialPaymentAccount)
            || normalizeQrPaymentAccount(contract?.payment?.initialPaymentAccount ?? contract?.payment?.paymentAccount)
          )
          : '';
        const deliveryCharge = normalizeDeliveryCharge({
          logisticsMode: contract.logisticsMode,
          deliveryChargeMode: payload?.deliveryChargeMode ?? contract?.deliveryChargeMode,
          deliveryFeeBs: payload?.deliveryFeeBs ?? contract?.deliveryFeeBs ?? contract?.totals?.deliveryFeeBs,
          deliveryFeeReason: payload?.deliveryFeeReason ?? contract?.deliveryFeeReason,
        });
        const totalBs = Math.max(0, subtotalBs - discountBs + deliveryCharge.deliveryFeeBs);
        const now = new Date().toISOString();
        const storedPaidAtApprovalBs = Math.max(
          0,
          Number(contract?.payment?.paidAtApprovalBs ?? 0),
          Number(contract?.payment?.paidAtRentalBs ?? 0),
        );
        const hasRequestedPaidAtApproval = Object.prototype.hasOwnProperty.call(payload ?? {}, 'paidAtApprovalBs');
        const requestedPaidAtApprovalBs = Math.max(
          0,
          Number(hasRequestedPaidAtApproval ? payload?.paidAtApprovalBs : storedPaidAtApprovalBs),
        );
        const prepaidAppliedBs = Math.max(0, Number(payload?.prepaidAppliedBs ?? contract?.payment?.prepaidAppliedBs ?? 0));
        const registeredCollectionBs = getRegisteredContractCollectionBs(state, contract);
        const paidAtApprovalBs = hasRequestedPaidAtApproval
          ? requestedPaidAtApprovalBs
          : Math.max(requestedPaidAtApprovalBs, storedPaidAtApprovalBs, registeredCollectionBs);
        const overpaidBs = Math.max(0, Number((paidAtApprovalBs - totalBs).toFixed(2)));

        contract.deliveryChargeMode = deliveryCharge.deliveryChargeMode;
        contract.deliveryFeeBs = Number(deliveryCharge.deliveryFeeBs.toFixed(2));
        contract.deliveryFeeReason = deliveryCharge.deliveryFeeReason;
        contract.totals = {
          itemsGrossSubtotalBs: Number(itemsGrossSubtotalBs.toFixed(2)),
          itemDiscountsBs: Number(itemDiscountsBs.toFixed(2)),
          itemsNetSubtotalBs: Number(itemsBaseSubtotalBs.toFixed(2)),
          itemsSubtotalBs: Number(itemsBaseSubtotalBs.toFixed(2)),
          servicesSubtotalBs: Number(servicesSubtotalBs.toFixed(2)),
          baseSubtotalBs: Number(baseSubtotalBs.toFixed(2)),
          subtotalBs: Number(subtotalBs.toFixed(2)),
          theoreticalSubtotalBs: Number(pricingPlan.theoreticalSubtotalBs.toFixed(2)),
          durationDiscountBs: Number(pricingPlan.durationDiscountBs.toFixed(2)),
          discountMode,
          discountBs: Number(discountBs.toFixed(2)),
          discountPercent: Number(discountPercent.toFixed(2)),
          deliveryFeeBs: Number(deliveryCharge.deliveryFeeBs.toFixed(2)),
          guaranteeBs: Number(guaranteeBs.toFixed(2)),
          totalBs: Number(totalBs.toFixed(2)),
        };
        contract.pricingPlan = pricingPlan;
        contract.payment = {
          paidAtApprovalBs: Number(paidAtApprovalBs.toFixed(2)),
          pendingBs: Number(Math.max(0, totalBs - paidAtApprovalBs).toFixed(2)),
          overpaidBs,
          prepaidAppliedBs,
          initialPaymentMethod,
          initialPaymentAccount,
          guaranteeStatus,
          guaranteePaymentMethod,
          guaranteePaymentAccount,
        };
        contract.guarantee = {
          amountBs: Number(guaranteeBs.toFixed(2)),
          status: guaranteeStatus,
          paymentMethod: guaranteePaymentMethod,
          paymentAccount: guaranteePaymentAccount,
        };
        if (payload.responsibles !== undefined) {
          const responsibles = normalizeRecordResponsibles(payload);
          contract.responsibles = responsibles;
        }
        cleanupApprovedContractEconomicDuplicates(state, contract, payload, now);
        syncInitialPaymentCashMovement(state, contract, payload, now);
        cleanupApprovedContractEconomicDuplicates(state, contract, payload, now);
        syncValidatedGuaranteeCashMovement(state, contract, payload, now, beforeContract);
        if (payload.economicLedger !== undefined) {
          const allowedEconomicLedgerTypes = new Set(['deposit', 'guarantee', 'charge', 'refund', 'note']);
          const rows = Array.isArray(payload.economicLedger) ? payload.economicLedger : [];
          contract.economicLedger = rows.map((entry) => {
            const type = String(entry?.type ?? '').trim();
            const normalizedType = allowedEconomicLedgerTypes.has(type) ? type : 'note';
            const paymentMethod = normalizedType === 'note'
              ? ''
              : normalizePaymentMethod(entry?.paymentMethod ?? entry?.method);
            return {
              id: String(entry?.id ?? makeId('eco')).trim() || makeId('eco'),
              type: normalizedType,
              amountBs: normalizedType === 'note'
                ? 0
                : Math.max(0, toPositiveRoundedNumber(entry?.amountBs ?? entry?.amount ?? 0)),
              paymentMethod,
              paymentAccount: paymentMethod === 'qr'
                ? normalizeQrPaymentAccount(entry?.paymentAccount ?? entry?.account)
                : '',
              note: String(entry?.note ?? '').trim(),
              cashMovementId: String(entry?.cashMovementId ?? '').trim() || null,
              cashReceiptCode: String(entry?.cashReceiptCode ?? '').trim(),
              isCashRegistered: Boolean(entry?.isCashRegistered),
            reclassifiedFromPayment: Boolean(entry?.reclassifiedFromPayment),
              createdAt: entry?.createdAt ?? now,
              createdByName: String(entry?.createdByName ?? entry?.createdBy ?? payload?.updatedByName ?? payload?.userName ?? 'Sistema').trim() || 'Sistema',
              editedAt: entry?.editedAt ?? null,
              editedByName: String(entry?.editedByName ?? '').trim(),
            };
          });
        }
        const dailyAssignmentChanged = hasDailyAssignmentChanges(beforeContract, contract);
        const changes = summarizeContractChanges(beforeContract, contract);
        if (dailyAssignmentChanged && !changes.includes('Distribucion por dias actualizada')) {
          changes.push('Distribucion por dias actualizada');
        }
        appendContractRevision(contract, payload, now, changes);
        if (changes.length > 0) {
          appendAuditLog(state, {
            action: 'update',
            module: 'Contratos',
            entityType: 'contract',
            entityId: contract.id,
            entityCode: contract.contractCode,
            title: `Edito contrato ${contract.contractCode}`,
            detail: contract.customerName,
            changes,
            userId: payload?.updatedById ?? payload?.userId ?? null,
            userName: getAuditUserName(payload),
            userRole: getAuditUserRole(payload),
            createdAt: now,
          });
        }
        if ((changes.length > 0 || dailyAssignmentChanged) && contract.status === 'aprobado') {
          syncApprovedContractOperation(state, contract, payload, now, beforeContract);
        }
        contract.updatedAt = now;
        updated = deepClone(contract);
        return state;
      });

      return updated;
    },
    updateEconomicLedger: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el contrato.');

      let updated = null;
      transaction((state) => {
        if (!Array.isArray(state.contracts)) state.contracts = [];
        const contract = state.contracts.find((entry) => entry.id === id && !entry.deletedAt);
        if (!contract) throw new Error('Contrato no encontrado.');
        const beforeContract = deepClone(contract);
        const now = new Date().toISOString();
        const allowedEconomicLedgerTypes = new Set(['deposit', 'guarantee', 'charge', 'refund', 'note']);
        const rows = Array.isArray(payload.economicLedger) ? payload.economicLedger : [];
        contract.economicLedger = rows.map((entry) => {
          const type = String(entry?.type ?? '').trim();
          const normalizedType = allowedEconomicLedgerTypes.has(type) ? type : 'note';
          const paymentMethod = normalizedType === 'note'
            ? ''
            : normalizePaymentMethod(entry?.paymentMethod ?? entry?.method);
          return {
            id: String(entry?.id ?? makeId('eco')).trim() || makeId('eco'),
            type: normalizedType,
            amountBs: normalizedType === 'note'
              ? 0
              : Math.max(0, toPositiveRoundedNumber(entry?.amountBs ?? entry?.amount ?? 0)),
            paymentMethod,
            paymentAccount: paymentMethod === 'qr'
              ? normalizeQrPaymentAccount(entry?.paymentAccount ?? entry?.account)
              : '',
            note: String(entry?.note ?? '').trim(),
            cashMovementId: String(entry?.cashMovementId ?? '').trim() || null,
            cashReceiptCode: String(entry?.cashReceiptCode ?? '').trim(),
            isCashRegistered: Boolean(entry?.isCashRegistered),
            createdAt: entry?.createdAt ?? now,
            createdByName: String(entry?.createdByName ?? entry?.createdBy ?? payload?.updatedByName ?? payload?.userName ?? 'Sistema').trim() || 'Sistema',
            editedAt: entry?.editedAt ?? null,
            editedByName: String(entry?.editedByName ?? '').trim(),
          };
        });
        contract.economicLedgerUpdatedAt = now;
        contract.economicLedgerUpdatedById = payload?.updatedById ?? payload?.userId ?? null;
        contract.economicLedgerUpdatedByName = String(payload?.updatedByName ?? payload?.userName ?? 'Sistema').trim() || 'Sistema';
        cleanupApprovedContractEconomicDuplicates(state, contract, payload, now);
        const changes = summarizeContractChanges(beforeContract, contract);
        appendContractRevision(contract, payload, now, changes);
        if (changes.length > 0) {
          appendAuditLog(state, {
            action: 'update',
            module: 'Contratos',
            entityType: 'contract',
            entityId: contract.id,
            entityCode: contract.contractCode,
            title: `Actualizo economico ${contract.contractCode}`,
            detail: contract.customerName,
            changes,
            userId: payload?.updatedById ?? payload?.userId ?? null,
            userName: getAuditUserName(payload),
            userRole: getAuditUserRole(payload),
            createdAt: now,
          });
        }
        contract.updatedAt = now;
        updated = deepClone(contract);
        return state;
      });

      return updated;
    },
    remove: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el contrato.');

      let updated = null;
      transaction((state) => {
        const contract = state.contracts.find((entry) => entry.id === id);
        if (!contract) throw new Error('Contrato no encontrado.');
        const now = new Date().toISOString();
        contract.deletionSnapshot = buildContractDeletionSnapshot(state, contract, now);
        cleanupContractDeletionEffects(state, contract, now);
        contract.deletedAt = now;
        contract.deletedById = payload?.updatedById ?? payload?.userId ?? null;
        contract.deletedByName = getAuditUserName(payload);
        contract.deletedByRole = getAuditUserRole(payload);
        contract.status = 'eliminado';
        contract.rentalId = null;
        contract.orderCode = null;
        appendContractRevision(contract, payload, now, ['Contrato eliminado']);
        appendAuditLog(state, {
          action: 'hide',
          module: 'Contratos',
          entityType: 'contract',
          entityId: contract.id,
          entityCode: contract.contractCode,
          title: `Oculto contrato ${contract.contractCode}`,
          detail: contract.customerName,
          changes: ['Contrato movido a Oculto por eliminacion operativa'],
          userId: payload?.updatedById ?? payload?.userId ?? null,
          userName: getAuditUserName(payload),
          userRole: getAuditUserRole(payload),
          createdAt: now,
        });
        contract.updatedAt = now;
        updated = deepClone(contract);
        return state;
      });

      return updated;
    },
    restore: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('Debes indicar el contrato.');

      let restored = null;
      transaction((state) => {
        const contract = state.contracts.find((entry) => entry.id === id && entry.deletedAt);
        if (!contract) throw new Error('Contrato oculto no encontrado.');

        const now = new Date().toISOString();
        const snapshot = contract.deletionSnapshot ?? {};
        const hasFullSnapshot = snapshot?.version >= 2 && snapshot?.contract;

        if (hasFullSnapshot) {
          reserveRestoredRentalStock(state, snapshot.rentals ?? [], now);

          const preservedRevisionHistory = Array.isArray(contract.revisionHistory)
            ? deepClone(contract.revisionHistory)
            : [];
          const original = deepClone(snapshot.contract);
          Object.keys(contract).forEach((key) => delete contract[key]);
          Object.assign(contract, original);
          contract.revisionHistory = preservedRevisionHistory;

          upsertSnapshotRecords(state.rentals, snapshot.rentals);
          upsertSnapshotRecords(state.deliveries, snapshot.deliveries);
          upsertSnapshotRecords(state.transportRoutes, snapshot.transportRoutes);
          upsertSnapshotRecords(state.inventoryMovements, snapshot.inventoryMovements);
          upsertSnapshotRecords(state.cashMovements, snapshot.cashMovements);
          upsertSnapshotRecords(state.generatedReports, snapshot.generatedReports);
          upsertSnapshotRecords(state.supplierLoans, snapshot.supplierLoans);
          if (snapshot.quote?.id) upsertSnapshotRecords(state.quotes, [snapshot.quote]);

          contract.deletedAt = null;
          contract.deletedById = null;
          contract.deletedByName = '';
          contract.deletedByRole = '';
          contract.restoredAt = now;
          contract.restoredById = payload?.updatedById ?? payload?.userId ?? null;
          contract.restoredByName = getAuditUserName(payload);
          contract.restoredByRole = getAuditUserRole(payload);
          contract.updatedAt = now;
          contract.deletionSnapshot = snapshot;
        } else {
          const donor = findLegacyRestoreDonor(state, contract);
          const currentScore = getLegacyRestoreSourceScore(contract);
          const donorScore = donor ? getLegacyRestoreSourceScore(donor) : -1;
          const useDonor = Boolean(donor && donorScore > currentScore);
          const source = useDonor ? donor : contract;

          const preservedId = contract.id;
          const preservedRevisionHistory = Array.isArray(contract.revisionHistory)
            ? deepClone(contract.revisionHistory)
            : [];
          const restoredSource = deepClone(source);
          Object.keys(contract).forEach((key) => delete contract[key]);
          Object.assign(contract, restoredSource);
          contract.id = preservedId;
          contract.revisionHistory = preservedRevisionHistory;

          const inferredStatus = source?.status === 'aprobado' || source?.approvedAt
            ? 'aprobado'
            : source?.status === 'rechazado' || source?.rejectedAt
              ? 'rechazado'
              : 'borrador';

          contract.deletedAt = null;
          contract.deletedById = null;
          contract.deletedByName = '';
          contract.deletedByRole = '';
          contract.status = inferredStatus;
          contract.rentalId = null;
          contract.orderCode = null;
          contract.restoredAt = now;
          contract.restoredById = payload?.updatedById ?? payload?.userId ?? null;
          contract.restoredByName = getAuditUserName(payload);
          contract.restoredByRole = getAuditUserRole(payload);
          contract.updatedAt = now;
          contract.restoredFromSiblingId = useDonor ? source.id : null;
          contract.legacyRestoreWarning = useDonor
            ? 'Jornadas y montos recuperados desde otra copia oculta del mismo contrato. La orden operativa debe revisarse.'
            : 'No existe snapshot operativo completo ni otra copia más rica; la orden operativa debe revisarse.';
        }

        appendContractRevision(contract, payload, now, [
          hasFullSnapshot
            ? 'Contrato restaurado exactamente desde snapshot operativo'
            : contract.restoredFromSiblingId
              ? 'Contrato antiguo restaurado usando la copia oculta más completa del mismo número'
              : 'Contrato antiguo restaurado sin snapshot operativo completo',
        ]);
        appendAuditLog(state, {
          action: 'restore',
          module: 'Contratos',
          entityType: 'contract',
          entityId: contract.id,
          entityCode: contract.contractCode,
          title: `Restauro contrato ${contract.contractCode}`,
          detail: contract.customerName,
          changes: [
            hasFullSnapshot
              ? 'Contrato, jornadas, orden, movimientos y montos recuperados desde snapshot'
              : contract.restoredFromSiblingId
                ? 'Jornadas, ítems, precios, totales y estado recuperados desde copia oculta hermana'
                : 'Contrato antiguo recuperado sin snapshot operativo completo',
          ],
          userId: payload?.updatedById ?? payload?.userId ?? null,
          userName: getAuditUserName(payload),
          userRole: getAuditUserRole(payload),
          createdAt: now,
        });

        restored = deepClone(contract);
        return state;
      });

      return restored;
    },
    revertToQuote: async (payload) => {
      const id = String(payload?.id ?? payload?.contractId ?? '').trim();
      if (!id) throw new Error('Debes indicar el contrato.');

      let reverted = null;
      transaction((state) => {
        const contract = state.contracts.find((entry) => entry.id === id && !entry.deletedAt);
        if (!contract) throw new Error('Contrato no encontrado.');
        const quoteId = String(contract.quoteId ?? '').trim();
        if (!quoteId) {
          throw new Error('Este contrato no proviene de una cotizacion y no se puede volver automaticamente.');
        }
        const quote = state.quotes.find((entry) => entry.id === quoteId && !entry.deletedAt);
        if (!quote) {
          throw new Error('No se encontro la cotizacion original para restaurarla.');
        }

        const now = new Date().toISOString();
        const rental = state.rentals.find((entry) => (
          !entry.deletedAt
          && (
            String(entry.id ?? '') === String(contract.rentalId ?? '')
            || String(entry.contractId ?? '') === String(contract.id)
            || (contract.orderCode && String(entry.orderCode ?? '') === String(contract.orderCode))
          )
        )) ?? null;

        if (rental) {
          if (rental.status === 'returned') {
            throw new Error('No se puede volver a cotizacion porque la orden ya fue devuelta/cerrada.');
          }

          (rental.items ?? []).forEach((line) => {
            const item = state.items.find((entry) => entry.id === line.itemId);
            if (!item || lineControlsStock(line, item) === false) return;
            const reservedQty = Number.isFinite(Number(line.internalReservedQty))
              ? Math.max(0, Math.trunc(Number(line.internalReservedQty)))
              : Math.max(0, Math.trunc(Number(line.quantity ?? 0)));
            if (reservedQty <= 0) return;
            const beforeTotalStock = Number(item.totalStock ?? 0);
            const beforeAvailableStock = Number(item.availableStock ?? 0);
            item.availableStock = Math.min(beforeTotalStock, beforeAvailableStock + reservedQty);
            item.updatedAt = now;
            state.inventoryMovements.push({
              id: makeId('mov'),
              itemId: item.id,
              itemName: item.name,
              category: item.category,
              type: 'reinsercion',
              reason: `Reversion de contrato ${contract.contractCode}`,
              detail: `Liberacion de ${reservedQty} unidades de ${rental.orderCode}`,
              reference: rental.orderCode,
              deltaUnits: reservedQty,
              beforeTotalStock,
              afterTotalStock: beforeTotalStock,
              beforeAvailableStock,
              afterAvailableStock: item.availableStock,
              reservedStockAfter: beforeTotalStock - item.availableStock,
              userName: String(payload?.updatedByName ?? payload?.userName ?? 'Sistema').trim() || 'Sistema',
              userRole: String(payload?.updatedByRole ?? payload?.userRole ?? 'Operacion').trim() || 'Operacion',
              createdAt: now,
            });
          });

          const prepaidAppliedBs = Math.max(0, toPositiveRoundedNumber(rental?.payment?.prepaidAppliedBs ?? rental?.totals?.prepaidAppliedBs ?? rental?.prepaidAppliedBs ?? 0));
          if (prepaidAppliedBs > 0 && rental.prepaidClientId) {
            const prepaidClient = state.clients.find((entry) => entry.id === rental.prepaidClientId && !entry.deletedAt);
            if (prepaidClient) {
              prepaidClient.prepaidBalanceBs = Number((Math.max(0, toPositiveRoundedNumber(prepaidClient.prepaidBalanceBs ?? 0)) + prepaidAppliedBs).toFixed(2));
              prepaidClient.prepaidTotalUsedBs = Math.max(0, Number((toPositiveRoundedNumber(prepaidClient.prepaidTotalUsedBs ?? 0) - prepaidAppliedBs).toFixed(2)));
              prepaidClient.prepaidMovements = normalizePrepaidMovements(prepaidClient.prepaidMovements, prepaidClient.prepaidBalanceBs);
              prepaidClient.prepaidMovements.push({
                id: makeId('pre'),
                type: 'adjustment',
                amountBs: prepaidAppliedBs,
                description: `Reversion prepago ${rental.orderCode}`,
                sourceType: 'rental_reversal',
                sourceId: rental.id,
                orderCode: rental.orderCode,
                balanceAfterBs: prepaidClient.prepaidBalanceBs,
                createdAt: now,
              });
              prepaidClient.updatedAt = now;
            }
          }

          state.deliveries.forEach((delivery) => {
            if (delivery.rentalId === rental.id || delivery.orderCode === rental.orderCode) {
              delivery.status = 'cancelada';
              delivery.deletedAt = now;
              delivery.updatedAt = now;
            }
          });

          state.transportRoutes.forEach((route) => {
            const hasLinkedStop = Array.isArray(route.stops)
              && route.stops.some((stop) =>
                state.deliveries.some((delivery) =>
                  (delivery.rentalId === rental.id || delivery.orderCode === rental.orderCode)
                  && String(delivery.id ?? '') === String(stop.deliveryId ?? ''),
                ),
              );
            if (hasLinkedStop) {
              route.deletedAt = now;
              route.updatedAt = now;
            }
          });

          state.cashMovements.forEach((movement) => {
            const linkedToRental = String(movement.sourceType ?? '') === 'rental' && String(movement.sourceId ?? '') === String(rental.id);
            const linkedByOrder = rental.orderCode && String(movement.linkedOrderCode ?? '') === String(rental.orderCode);
            if (linkedToRental || linkedByOrder) {
              movement.voidedAt = movement.voidedAt ?? now;
              movement.voidedBy = movement.voidedBy || (String(payload?.updatedByName ?? payload?.userName ?? 'Sistema').trim() || 'Sistema');
              movement.updatedAt = now;
              movement.notes = [movement.notes, `Anulado por reversion del contrato ${contract.contractCode}.`].filter(Boolean).join(' | ');
            }
          });

          state.generatedReports.forEach((report) => {
            if (String(report.sourceId ?? '') === String(rental.id)) {
              report.deletedAt = now;
              report.updatedAt = now;
            }
          });

          state.supplierLoans.forEach((loan) => {
            const linkedToContract = String(loan.sourceContractId ?? '') === String(contract.id);
            const linkedToRental = String(loan.sourceRentalId ?? '') === String(rental.id);
            if ((linkedToContract || linkedToRental) && loan.autoCreated) {
              loan.deletedAt = now;
              loan.updatedAt = now;
              loan.status = 'anulado';
            }
          });

          rental.deletedAt = now;
          rental.status = 'cancelled';
          rental.updatedAt = now;
        }

        quote.status = 'borrador';
        quote.approvedAt = null;
        quote.rejectedAt = null;
        quote.rentalId = null;
        quote.orderCode = null;
        quote.updatedAt = now;

        releaseLatestCommercialDocumentCode(state, contract.contractCode, 'contractPrefix', 'contractNext');
        contract.deletedAt = now;
        contract.status = 'revertido';
        contract.revertedToQuoteAt = now;
        contract.revertedQuoteId = quote.id;
        contract.rentalId = null;
        contract.orderCode = null;
        appendContractRevision(contract, payload, now, [
          `Contrato revertido a cotizacion ${quote.code || quote.quoteCode || quote.id}`,
          'Se liberaron ordenes, inventario y movimientos vinculados',
        ]);
        contract.updatedAt = now;

        reverted = {
          ok: true,
          contract: deepClone(contract),
          quote: deepClone(quote),
          rental: rental ? deepClone(rental) : null,
        };
        return state;
      });

      return reverted;
    },
  },

  suppliers: {
    listBundle: async () => {
      const state = readQueryState();
      return {
        suppliers: state.suppliers
          .filter((row) => !row.deletedAt)
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name, 'es')),
        quotes: state.supplierQuotes
          .filter((row) => !row.deletedAt)
          .slice()
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        loans: state.supplierLoans
          .filter((row) => !row.deletedAt)
          .slice()
          .sort((a, b) => new Date(b.requestDate || b.createdAt) - new Date(a.requestDate || a.createdAt)),
      };
    },
    create: async (payload) => {
      const name = String(payload?.name ?? '').trim();
      if (!name) throw new Error('El nombre del proveedor es obligatorio.');

      let created = null;
      transaction((state) => {
        const exists = state.suppliers.some(
          (supplier) => !supplier.deletedAt && normalizeText(supplier.name) === normalizeText(name),
        );
        if (exists) throw new Error('Ya existe un proveedor con ese nombre.');
        const now = new Date().toISOString();
        created = {
          id: makeId('sup'),
          name,
          contactName: String(payload?.contactName ?? '').trim(),
          phone: String(payload?.phone ?? '').trim(),
          whatsapp: String(payload?.whatsapp ?? payload?.phone ?? '').trim(),
          email: String(payload?.email ?? '').trim().toLowerCase(),
          address: String(payload?.address ?? '').trim(),
          city: String(payload?.city ?? '').trim(),
          type: 'regular',
          paymentTerms: String(payload?.paymentTerms ?? '').trim(),
          notes: String(payload?.notes ?? '').trim(),
          status: 'active',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.suppliers.push(created);
        return state;
      });
      return created;
    },
    update: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      const name = String(payload?.name ?? '').trim();
      if (!id) throw new Error('Debes indicar el proveedor.');
      if (!name) throw new Error('El nombre del proveedor es obligatorio.');

      let updated = null;
      transaction((state) => {
        const supplier = state.suppliers.find((entry) => entry.id === id && !entry.deletedAt);
        if (!supplier) throw new Error('Proveedor no encontrado.');
        const exists = state.suppliers.some(
          (entry) => entry.id !== id && !entry.deletedAt && normalizeText(entry.name) === normalizeText(name),
        );
        if (exists) throw new Error('Ya existe otro proveedor con ese nombre.');
        supplier.name = name;
        supplier.contactName = String(payload?.contactName ?? '').trim();
        supplier.phone = String(payload?.phone ?? '').trim();
        supplier.whatsapp = String(payload?.whatsapp ?? payload?.phone ?? '').trim();
        supplier.email = String(payload?.email ?? '').trim().toLowerCase();
        supplier.address = String(payload?.address ?? '').trim();
        supplier.city = String(payload?.city ?? '').trim();
        supplier.type = 'regular';
        supplier.paymentTerms = String(payload?.paymentTerms ?? '').trim();
        supplier.notes = String(payload?.notes ?? '').trim();
        supplier.status = String(payload?.status ?? supplier.status ?? 'active').trim() || 'active';
        supplier.updatedAt = new Date().toISOString();

        state.supplierQuotes.forEach((quote) => {
          if (quote.supplierId === id) quote.supplierName = name;
        });
        state.supplierLoans.forEach((loan) => {
          if (loan.supplierId === id) loan.supplierName = name;
        });
        updated = deepClone(supplier);
        return state;
      });
      return updated;
    },
    createQuote: async (payload) => {
      const supplierId = String(payload?.supplierId ?? '').trim();
      const requestedItems = Array.isArray(payload?.items) ? payload.items : [];
      if (!supplierId) throw new Error('Debes seleccionar un proveedor.');
      if (!requestedItems.length) throw new Error('Debes agregar al menos un precio a la cotizacion.');

      let created = null;
      transaction((state) => {
        const supplier = state.suppliers.find((entry) => entry.id === supplierId && !entry.deletedAt);
        if (!supplier) throw new Error('Proveedor no encontrado.');
        const now = new Date().toISOString();
        const items = requestedItems
          .map((line) => {
            const itemName = String(line?.itemName ?? line?.name ?? '').trim();
            const quantity = Math.max(1, Math.trunc(Number(line?.quantity ?? 1)));
            const unitPriceBs = Math.max(0, toPositiveRoundedNumber(line?.unitPriceBs ?? 0));
            return {
              id: makeId('supitem'),
              itemId: String(line?.itemId ?? '').trim() || null,
              itemName,
              category: String(line?.category ?? '').trim(),
              quantity,
              unit: String(line?.unit ?? 'unidad').trim() || 'unidad',
              unitPriceBs,
              saleUnitPriceBs: Math.max(0, toPositiveRoundedNumber(line?.saleUnitPriceBs ?? line?.clientUnitPriceBs ?? 0)),
              lineTotalBs: Number((quantity * unitPriceBs).toFixed(2)),
            };
          })
          .filter((line) => line.itemName);
        if (!items.length) throw new Error('Debes agregar productos validos a la cotizacion.');
        created = {
          id: makeId('supquo'),
          quoteCode: consumeDocumentCode(state, 'supplierQuotePrefix', 'supplierQuoteNext', 5),
          supplierId,
          supplierName: supplier.name,
          title: String(payload?.title ?? 'Lista de precios').trim() || 'Lista de precios',
          validFrom: String(payload?.validFrom ?? '').trim() || null,
          validUntil: String(payload?.validUntil ?? '').trim() || null,
          status: String(payload?.status ?? 'vigente').trim() || 'vigente',
          notes: String(payload?.notes ?? '').trim(),
          totals: { totalBs: Number(items.reduce((sum, line) => sum + line.lineTotalBs, 0).toFixed(2)) },
          items,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.supplierQuotes.push(created);
        return state;
      });
      return created;
    },
    createLoan: async (payload) => {
      const supplierId = String(payload?.supplierId ?? '').trim();
      const direction = 'from_supplier';
      const flowType = 'paid';
      const requestDate = String(payload?.requestDate ?? '').trim();
      const requestedItems = Array.isArray(payload?.items) ? payload.items : [];
      if (!supplierId) throw new Error('Debes seleccionar un proveedor.');
      if (!requestDate) throw new Error('Debes indicar la fecha solicitada.');
      if (!requestedItems.length) throw new Error('Debes agregar al menos un item al prestamo.');

      let created = null;
      transaction((state) => {
        const supplier = state.suppliers.find((entry) => entry.id === supplierId && !entry.deletedAt);
        if (!supplier) throw new Error('Proveedor no encontrado.');
        const now = new Date().toISOString();
        const items = requestedItems
          .map((line) => {
            const itemName = String(line?.itemName ?? line?.name ?? '').trim();
            const quantity = Math.max(1, Math.trunc(Number(line?.quantity ?? 1)));
            const unitPriceBs = Math.max(0, toPositiveRoundedNumber(line?.unitPriceBs ?? 0));
            return {
              id: makeId('supline'),
              itemId: String(line?.itemId ?? '').trim() || null,
              itemName,
              category: String(line?.category ?? '').trim(),
              quantity,
              unitPriceBs,
              saleUnitPriceBs: Math.max(0, toPositiveRoundedNumber(line?.saleUnitPriceBs ?? line?.clientUnitPriceBs ?? 0)),
              lineTotalBs: Number((quantity * unitPriceBs).toFixed(2)),
            };
          })
          .filter((line) => line.itemName);
        if (!items.length) throw new Error('Debes agregar items validos al prestamo.');
        created = {
          id: makeId('suploan'),
          loanCode: consumeDocumentCode(state, 'supplierLoanPrefix', 'supplierLoanNext', 5),
          supplierId,
          supplierName: supplier.name,
          direction,
          flowType,
          requestDate,
          eventDate: String(payload?.eventDate ?? payload?.serviceDate ?? requestDate).trim() || requestDate,
          returnDate: String(payload?.returnDate ?? '').trim() || null,
          eventName: String(payload?.eventName ?? '').trim(),
          status: String(payload?.status ?? 'programado').trim() || 'programado',
          showPricesOnDocument: Boolean(payload?.showPricesOnDocument),
          notes: String(payload?.notes ?? '').trim(),
          totals: { totalBs: Number(items.reduce((sum, line) => sum + line.lineTotalBs, 0).toFixed(2)) },
          items,
          settledAt: null,
          sourceContractId: String(payload?.sourceContractId ?? '').trim() || null,
          sourceContractCode: String(payload?.sourceContractCode ?? payload?.contractCode ?? '').trim() || null,
          sourceRentalId: String(payload?.sourceRentalId ?? '').trim() || null,
          sourceOrderCode: String(payload?.sourceOrderCode ?? '').trim() || null,
          autoCreated: Boolean(payload?.autoCreated),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.supplierLoans.push(created);
        return state;
      });
      return created;
    },
    updateLoanStatus: async (payload) => {
      const id = String(payload?.id ?? '').trim();
      const status = String(payload?.status ?? '').trim();
      if (!id) throw new Error('Debes indicar el prestamo.');
      if (!status) throw new Error('Debes indicar el estado.');
      let updated = null;
      transaction((state) => {
        const loan = state.supplierLoans.find((entry) => entry.id === id && !entry.deletedAt);
        if (!loan) throw new Error('Prestamo no encontrado.');
        loan.status = status;
        loan.updatedAt = new Date().toISOString();
        if (status === 'liquidado') loan.settledAt = loan.updatedAt;
        updated = deepClone(loan);
        return state;
      });
      return updated;
    },
  },

  rentals: {
    list: async () => {
      const { contracts, rentals } = readQueryState();
      const canonicalRentalByContractId = new Map(
        contracts
          .filter((contract) => !contract.deletedAt && contract.id && contract.rentalId)
          .map((contract) => [String(contract.id), String(contract.rentalId)]),
      );
      return rentals
        .filter((row) => !row.deletedAt)
        .filter((row) => {
          const canonicalRentalId = canonicalRentalByContractId.get(String(row.contractId ?? ''));
          return !canonicalRentalId || canonicalRentalId === String(row.id);
        })
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    create: async (payload) => {
      const customerName = String(payload?.customerName ?? '').trim();
      const customerPhone = String(payload?.customerPhone ?? '').trim();
      const dueDate = String(payload?.dueDate ?? '').trim();
      const dueTime = String(payload?.dueTime ?? '').trim();
      const notes = String(payload?.notes ?? '').trim();
      const idCardHeld = Boolean(payload?.idCardHeld);
      const paymentMode = ['sin_pago', 'a_cuenta', 'cancelado'].includes(payload?.paymentMode)
        ? payload.paymentMode
        : 'sin_pago';
      const requestedItems = Array.isArray(payload?.items) ? payload.items : [];
      const requestedServices = normalizeContractServices(payload?.services);
      const supplierFulfillmentPlan = normalizeSupplierFulfillmentPlan(payload?.supplierFulfillmentPlan);

      if (!customerName) {
        throw new Error('Debe registrar el nombre del cliente.');
      }
      if (!customerPhone) {
        throw new Error('Debe registrar el celular del cliente.');
      }
      if (!dueDate || !dueTime) {
        throw new Error('Debe registrar fecha y hora maxima de devolucion.');
      }
      if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(dueTime)) {
        throw new Error('La hora maxima de devolucion no es valida.');
      }
      if ((!Array.isArray(requestedItems) || requestedItems.length === 0) && requestedServices.length === 0) {
        throw new Error('Debe agregar al menos un item o servicio al alquiler.');
      }

      let createdRental = null;
      transaction((state) => {
        const contractId = String(payload?.contractId ?? '').trim();
        const requestedContractCode = String(payload?.contractCode ?? '').trim();
        const existingContractRental = contractId || requestedContractCode
          ? state.rentals.find((entry) => (
            isActiveRentalRecord(entry)
            && (
              (contractId && String(entry.contractId ?? '') === contractId)
              || (requestedContractCode && String(entry.contractCode ?? '').trim() === requestedContractCode)
            )
          ))
          : null;
        if (existingContractRental) {
          const existingContractId = String(existingContractRental.contractId ?? '').trim();
          if (contractId && existingContractId && existingContractId !== contractId) {
            throw new Error(`Ya existe una orden activa para el contrato ${requestedContractCode || existingContractRental.contractCode}.`);
          }
          const nowIso = new Date().toISOString();
          let repairedLink = false;
          if (contractId && !existingContractId) {
            existingContractRental.contractId = contractId;
            repairedLink = true;
          }
          if (requestedContractCode && !String(existingContractRental.contractCode ?? '').trim()) {
            existingContractRental.contractCode = requestedContractCode;
            repairedLink = true;
          }
          if (repairedLink) {
            existingContractRental.updatedAt = nowIso;
          }
          createdRental = {
            ...deepClone(existingContractRental),
            reusedExisting: true,
          };
          return state;
        }

        const settings = state.settings ?? {};
        const depositBs = toNumber(payload?.depositBs ?? settings.defaultDepositBs ?? 200, 'garantia');
        const guaranteeDeclaredBs = Math.max(0, toPositiveRoundedNumber(payload?.guaranteeDeclaredBs ?? depositBs));
        const guaranteeStatus = String(payload?.guaranteeStatus ?? '').trim() === 'validado' && depositBs > 0
          ? 'validado'
          : 'no_validado';
        const guaranteePaymentMethod = normalizePaymentMethod(payload?.guaranteePaymentMethod);
        const initialPaymentMethod = normalizePaymentMethod(payload?.initialPaymentMethod);
        const guaranteePaymentAccount = guaranteePaymentMethod === 'qr' ? normalizeQrPaymentAccount(payload?.guaranteePaymentAccount) : '';
        const initialPaymentAccount = initialPaymentMethod === 'qr' ? normalizeQrPaymentAccount(payload?.initialPaymentAccount) : '';
        const fallbackDamageMultiplier = toNumber(settings.damageMultiplier ?? 1.2, 'multiplicador dano');
        const fallbackMissingMultiplier = toNumber(settings.missingMultiplier ?? 2, 'multiplicador faltante');
        const now = new Date();
        const customerCi = String(payload?.customerCi ?? payload?.nitCi ?? '').trim();
        const customerReferencePhone = String(payload?.customerReferencePhone ?? '').trim();
        const clientId = resolveClientFromName(state, customerName, customerPhone, payload?.address, payload?.city, customerReferencePhone, customerCi);
        const orderCode = consumeDocumentCode(state, 'serviceOrderPrefix', 'serviceOrderNext', 5);
        const reservationMovements = [];
        const userId = payload?.userId ?? payload?.createdById ?? null;
        const userName = String(payload?.userName ?? payload?.createdByName ?? payload?.createdBy ?? '').trim() || 'Sistema';
        const userRole = String(payload?.userRole ?? payload?.createdByRole ?? '').trim() || 'Operacion';
        const supplierSupportMaps = buildSupplierSupportMaps(supplierFulfillmentPlan);
        const operationalRequestedItems = requestedItems.map((line, index) => {
          const item = resolveOperationalItemFromLine(state, line, now.toISOString());
          if (!item) throw new Error('Uno de los items seleccionados ya no existe.');
          return {
            ...line,
            lineKey: getInventoryLineKey(line, index),
            itemId: item.id,
            _resolvedItem: item,
          };
        });
        const adjustedRequestedItems = operationalRequestedItems
          .map((line) => {
            const requestedQty = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
            const supplierStats = getSupplierSupportStatsForLine(line, supplierSupportMaps);
            if (!lineControlsStock(line, line._resolvedItem)) {
              return {
                ...line,
                quantity: 0,
              };
            }
            const internalQty = Math.max(0, requestedQty - Math.min(requestedQty, supplierStats.subtractiveQty));
            return {
              ...line,
              quantity: internalQty,
            };
          })
          .filter((line) => Number(line.quantity ?? 0) > 0);
        const rentalDate = String(payload?.rentalDate ?? now.toISOString().slice(0, 10));
        const operationDate = String(payload?.deliveryDate ?? payload?.eventDate ?? rentalDate).trim() || rentalDate;
        const availabilityPeriod = buildAvailabilityPeriod({
          deliveryDate: rentalDate,
          deliveryWindowStart: payload?.deliveryWindowStart || '00:00',
          pickupDate: dueDate,
          pickupWindowEnd: payload?.pickupWindowEnd || dueTime,
        });
        const projectedIssues = validateProjectedInventoryRequest({
          items: state.items,
          rentals: state.rentals,
          contracts: state.contracts,
          period: availabilityPeriod,
          requestedItems: adjustedRequestedItems,
          exclude: {
            contractId,
            contractCode: requestedContractCode,
            recordId: contractId,
          },
        });
        if (projectedIssues.length) {
          const issue = projectedIssues[0];
          const conflictText = (issue.hardConflicts ?? [])
            .slice(0, 2)
            .map((record) => `contrato ${record.contractCode || record.code || record.orderCode || 'previo'} hasta ${record.endDate || 'fecha pendiente'}`)
            .join(', ');
          throw new Error(
            `Stock insuficiente para "${issue.itemName}" en esas fechas. Disponibles: ${issue.projectedAvailable}. Faltan: ${issue.shortageQty}.${conflictText ? ` Esta usado por ${conflictText}.` : ''} Coordina proveedor o cambia fechas.`,
          );
        }
        const availabilityAtApproval = getProjectedInventoryAvailability({
          items: state.items,
          rentals: state.rentals,
          contracts: state.contracts,
          period: availabilityPeriod,
          exclude: {
            contractId,
            contractCode: requestedContractCode,
            recordId: contractId,
          },
        });
        const inventoryAvailabilityAssumptions = operationalRequestedItems
          .map((line) => {
            const requestedQty = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
            const supplierStats = getSupplierSupportStatsForLine(line, supplierSupportMaps);
            return {
              ...line,
              quantity: Math.max(0, requestedQty - Math.min(requestedQty, supplierStats.subtractiveQty)),
            };
          })
          .filter((line) => Number(line.quantity ?? 0) > 0)
          .map((line) => {
            const item = line._resolvedItem ?? state.items.find((entry) => entry.id === line.itemId);
            if (!lineControlsStock(line, item)) return null;
            const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
            const summary = availabilityAtApproval.get(line.itemId);
            const currentAvailable = Math.max(0, Number(item?.availableStock ?? 0));
            if (!item || !summary || quantity <= currentAvailable || summary.returningBeforeStartQty <= 0) return null;
            return {
              itemId: item.id,
              itemName: item.name,
              requestedQty: quantity,
              currentAvailableAtApproval: currentAvailable,
              returningBeforeStartQty: summary.returningBeforeStartQty,
              sourceReturns: summary.returningBeforeStartQtyRecords,
              createdAt: now.toISOString(),
            };
          })
          .filter(Boolean);

        const rentalItems = operationalRequestedItems.map((line, index) => {
          const item = line._resolvedItem ?? state.items.find((entry) => entry.id === line.itemId);
          if (!item) {
            throw new Error('Uno de los items seleccionados ya no existe.');
          }

          const quantity = toInteger(line.quantity, `cantidad (${item.name})`);
          if (quantity <= 0) {
            throw new Error(`La cantidad de "${item.name}" debe ser mayor a 0.`);
          }
          const supplierStats = getSupplierSupportStatsForLine(line, supplierSupportMaps);
          const supplierBackedQty = supplierStats.manualQty > 0
            ? supplierStats.totalQty
            : Math.min(quantity, supplierStats.totalQty);
          const internalReservationQty = lineControlsStock(line, item)
            ? Math.max(0, quantity - Math.min(quantity, supplierStats.subtractiveQty))
            : 0;
          const lineType = String(line?.lineType ?? '').trim();
          const isCourtesyLine = lineType === 'courtesy';
          const rentalPriceBs = isCourtesyLine ? 0 : Math.max(0, toPositiveRoundedNumber(line.rentalPriceBs ?? line.unitPriceBs ?? item.rentalPriceBs ?? 0));
          const discountPercent = isCourtesyLine ? 0 : Math.min(100, Math.max(0, toPositiveRoundedNumber(line.discountPercent ?? 0)));
          const discountBs = isCourtesyLine ? 0 : Math.max(0, toPositiveRoundedNumber(line.discountBs ?? 0));
          const grossLineTotalBs = isCourtesyLine ? 0 : Number.isFinite(Number(line.grossLineTotalBs))
            ? Math.max(0, toPositiveRoundedNumber(line.grossLineTotalBs))
            : Number((quantity * rentalPriceBs).toFixed(2));
          const explicitLineTotalBs = isCourtesyLine ? 0 : Number.isFinite(Number(line.lineTotalBs))
            ? Math.max(0, toPositiveRoundedNumber(line.lineTotalBs))
            : null;

          if (internalReservationQty > 0) {
            const beforeTotalStock = item.totalStock;
            const beforeAvailableStock = item.availableStock;
            item.updatedAt = now.toISOString();

            reservationMovements.push({
              id: makeId('mov'),
              itemId: item.id,
              itemName: item.name,
              category: item.category,
              type: 'reserva',
              reason: `Asignado a orden de servicio ${orderCode}`,
              detail: `Reserva interna de ${internalReservationQty} unidades para ${orderCode}`,
              reference: orderCode,
              deltaUnits: -internalReservationQty,
              beforeTotalStock,
              afterTotalStock: item.totalStock,
              beforeAvailableStock,
              afterAvailableStock: beforeAvailableStock,
              reservedStockAfter: item.totalStock - beforeAvailableStock,
              operationDate,
              deliveryDate: operationDate,
              eventDate: String(payload?.eventDate ?? '').trim() || operationDate,
              stockEffect: 'reservation_only',
              userName,
              userRole,
              createdAt: now.toISOString(),
            });
          }

          return {
            lineKey: getInventoryLineKey(line, index),
            itemId: item.id,
            itemName: item.name,
            rentalPriceBs,
            damagedUnitChargeBs: Number.isFinite(Number(item.damagedUnitChargeBs))
              ? Number(item.damagedUnitChargeBs)
              : Number((rentalPriceBs * fallbackDamageMultiplier).toFixed(2)),
            missingUnitChargeBs: Number.isFinite(Number(item.missingUnitChargeBs))
              ? Number(item.missingUnitChargeBs)
              : Number((rentalPriceBs * fallbackMissingMultiplier).toFixed(2)),
            quantity,
            supplierBackedQty,
            internalReservedQty: internalReservationQty,
            controlsStock: lineControlsStock(line, item),
            verificationStatus: lineControlsStock(line, item) ? (item.verificationStatus ?? 'verified') : 'pending_verification',
            comboId: String(line?.comboId ?? '').trim() || null,
            comboName: String(line?.comboName ?? '').trim(),
            comboLineKey: String(line?.comboLineKey ?? '').trim() || null,
            comboComponentName: String(line?.comboComponentName ?? item.name).trim(),
            comboQuantity: Math.max(1, Math.trunc(Number(line?.comboQuantity ?? 1))),
            comboComponentQuantity: Math.max(1, Math.trunc(Number(line?.comboComponentQuantity ?? (Number(line?.quantity ?? 1) / Math.max(1, Number(line?.comboQuantity ?? 1)))))),
            comboRuleIndex: Math.max(0, Math.trunc(Number(line?.comboRuleIndex ?? 0))),
            comboSlotLabel: String(line?.comboSlotLabel ?? '').trim(),
            comboSelectionMode: String(line?.comboSelectionMode ?? 'item').trim() || 'item',
            comboOptionItemIds: Array.isArray(line?.comboOptionItemIds) ? line.comboOptionItemIds.map(String) : [],
            comboCategory: String(line?.comboCategory ?? '').trim(),
            comboPricingRole: String(line?.comboPricingRole ?? '').trim(),
            comboPricingCondition: line?.comboPricingCondition ? normalizeComboPricingCondition(line.comboPricingCondition) : null,
            grossLineTotalBs,
            discountPercent,
            discountBs,
            lineType,
            observation: String(line?.observation ?? line?.observations ?? line?.note ?? (isCourtesyLine ? 'Cortesia' : '')).trim(),
            serviceDayId: String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim() || null,
            serviceDate: String(line?.serviceDate ?? '').trim() || null,
            serviceDayLabel: String(line?.serviceDayLabel ?? '').trim(),
            lineTotalBs: explicitLineTotalBs !== null ? explicitLineTotalBs : Number(Math.max(0, grossLineTotalBs - discountBs).toFixed(2)),
          };
        });

        const [year, month, day] = dueDate.split('-').map((value) => Number.parseInt(value, 10));
        const [dueHours, dueMinutes] = dueTime.split(':').map((value) => Number.parseInt(value, 10));
        const dueAt = new Date(year, month - 1, day, dueHours, dueMinutes, 0, 0);
        const allowPastDueDate = Boolean(payload?.allowPastDueDate) && Boolean(contractId);
        if (Number.isNaN(dueAt.getTime()) || (!allowPastDueDate && dueAt <= now)) {
          throw new Error('La fecha y hora maxima de devolucion deben ser posteriores al momento actual.');
        }

        const itemsGrossSubtotalBs = rentalItems.reduce((sum, line) => sum + Number(line.grossLineTotalBs ?? line.lineTotalBs ?? 0), 0)
          + getManualSupplierSaleTotalBs(supplierFulfillmentPlan);
        const itemDiscountsBs = rentalItems.reduce((sum, line) => sum + Number(line.discountBs ?? 0), 0);
        const itemsSubtotalBs = rentalItems.reduce((sum, line) => sum + line.lineTotalBs, 0)
          + getManualSupplierSaleTotalBs(supplierFulfillmentPlan);
        const servicesSubtotalBs = requestedServices.reduce((sum, line) => sum + line.lineTotalBs, 0);
        const pricingPlan = enrichDailySchedulePricingPlan(
          calculateDurationPricing({ pricingPlan: payload?.pricingPlan, baseSubtotalBs: itemsSubtotalBs }),
          rentalItems,
          requestedServices,
        );
        const quotedTotals = payload?.quotedTotals && typeof payload.quotedTotals === 'object' ? payload.quotedTotals : null;
        const subtotalBs = Math.max(0, toPositiveRoundedNumber(
          quotedTotals?.subtotalBs ?? pricingPlan.chargeableSubtotalBs + servicesSubtotalBs,
        ));
        const discountBs = Math.max(0, toPositiveRoundedNumber(quotedTotals?.discountBs ?? 0));
        const discountPercent = Math.min(100, Math.max(0, toPositiveRoundedNumber(quotedTotals?.discountPercent ?? payload?.discountPercent ?? 0)));
        const logisticsMode = ['envio', 'recojo'].includes(payload?.logisticsMode) ? payload.logisticsMode : 'envio';
        const deliveryCharge = normalizeDeliveryCharge({
          ...payload,
          logisticsMode,
          deliveryFeeBs: payload?.deliveryFeeBs ?? quotedTotals?.deliveryFeeBs,
          totals: quotedTotals,
        });
        const totalBs = Math.max(0, toPositiveRoundedNumber(quotedTotals?.totalBs ?? subtotalBs - discountBs + deliveryCharge.deliveryFeeBs));
        const prepaidClientId = String(payload?.prepaidClientId ?? '').trim();
        let prepaidAppliedBs = Math.max(0, toPositiveRoundedNumber(payload?.prepaidAppliedBs ?? 0));
        let prepaidClient = null;
        if (prepaidAppliedBs > 0) {
          prepaidClient = state.clients.find((entry) => entry.id === prepaidClientId && !entry.deletedAt);
          if (!prepaidClient || !prepaidClient.prepaidEnabled) {
            throw new Error('El cliente no tiene una cuenta prepago activa.');
          }
          const availablePrepaidBs = Math.max(0, toPositiveRoundedNumber(prepaidClient.prepaidBalanceBs ?? 0));
          if (prepaidAppliedBs > availablePrepaidBs) {
            throw new Error(`Saldo prepago insuficiente. Disponible: Bs ${availablePrepaidBs.toFixed(2)}.`);
          }
          prepaidAppliedBs = Math.min(prepaidAppliedBs, totalBs);
        }
        let paidAtRentalBs = toNumber(payload?.paidAtRentalBs ?? 0, 'pago inicial');
        paidAtRentalBs = Math.max(paidAtRentalBs, prepaidAppliedBs);

        if (paymentMode === 'sin_pago') {
          paidAtRentalBs = 0;
        } else if (paymentMode === 'cancelado') {
          paidAtRentalBs = paidAtRentalBs > 0 ? paidAtRentalBs : totalBs;
        } else {
          if (paidAtRentalBs <= 0) {
            throw new Error('Si el pago es a cuenta, el monto inicial debe ser mayor a 0.');
          }
        }

        const pendingPaymentBs = Number(Math.max(0, totalBs - paidAtRentalBs).toFixed(2));
        const overpaidBs = Number(Math.max(0, paidAtRentalBs - totalBs).toFixed(2));
        const paymentStatus = paidAtRentalBs >= totalBs && totalBs > 0
          ? 'cancelado'
          : paidAtRentalBs > 0
          ? 'a_cuenta'
          : 'sin_pago';
        const cashCollectedAtApprovalBs = Math.max(0, Number((paidAtRentalBs - prepaidAppliedBs).toFixed(2)));
        const deliveryFeeCollectedAtApprovalBs = Math.min(
          toPositiveRoundedNumber(deliveryCharge.deliveryFeeBs),
          cashCollectedAtApprovalBs,
        );
        const rentalCollectedAtApprovalBs = Math.max(
          0,
          Number((cashCollectedAtApprovalBs - deliveryFeeCollectedAtApprovalBs).toFixed(2)),
        );

        createdRental = {
          id: makeId('rent'),
          clientId,
          contractId: contractId || null,
          contractCode: String(payload?.contractCode ?? '').trim() || null,
          orderCode,
          customerName,
          customerPhone,
          contractDate: String(payload?.contractDate ?? '').trim() || now.toISOString(),
          rentalDate,
          rentalAt: now.toISOString(),
          dueDate,
          dueTime,
          dueAt: dueAt.toISOString(),
          deliveryWindowStart: String(payload?.deliveryWindowStart ?? '').trim() || null,
          deliveryWindowEnd: String(payload?.deliveryWindowEnd ?? '').trim() || null,
          pickupWindowStart: String(payload?.pickupWindowStart ?? '').trim() || null,
          pickupWindowEnd: String(payload?.pickupWindowEnd ?? '').trim() || dueTime,
          idCardHeld,
          depositBs: guaranteeStatus === 'validado' ? toPositiveRoundedNumber(depositBs) : 0,
          guaranteeDeclaredBs,
          guarantee: {
            amountBs: guaranteeDeclaredBs,
            validatedBs: guaranteeStatus === 'validado' ? toPositiveRoundedNumber(depositBs) : 0,
            status: guaranteeStatus,
            paymentMethod: guaranteePaymentMethod,
            paymentAccount: guaranteePaymentAccount,
          },
          deliveryChargeMode: deliveryCharge.deliveryChargeMode,
          deliveryFeeBs: toPositiveRoundedNumber(deliveryCharge.deliveryFeeBs),
          deliveryFeeReason: deliveryCharge.deliveryFeeReason,
          prepaidClientId: prepaidClientId || null,
          prepaidAppliedBs: toPositiveRoundedNumber(prepaidAppliedBs),
          items: rentalItems,
          services: requestedServices,
          pricingPlan,
          totals: {
            itemsGrossSubtotalBs: toPositiveRoundedNumber(quotedTotals?.itemsGrossSubtotalBs ?? itemsGrossSubtotalBs),
            itemDiscountsBs: toPositiveRoundedNumber(quotedTotals?.itemDiscountsBs ?? itemDiscountsBs),
            itemsNetSubtotalBs: toPositiveRoundedNumber(quotedTotals?.itemsNetSubtotalBs ?? itemsSubtotalBs),
            itemsSubtotalBs: toPositiveRoundedNumber(itemsSubtotalBs),
            servicesSubtotalBs: toPositiveRoundedNumber(servicesSubtotalBs),
            baseSubtotalBs: toPositiveRoundedNumber(itemsSubtotalBs + servicesSubtotalBs),
            subtotalBs: toPositiveRoundedNumber(subtotalBs),
            theoreticalSubtotalBs: toPositiveRoundedNumber(quotedTotals?.theoreticalSubtotalBs ?? pricingPlan.theoreticalSubtotalBs),
            durationDiscountBs: toPositiveRoundedNumber(quotedTotals?.durationDiscountBs ?? pricingPlan.durationDiscountBs),
            discountBs: toPositiveRoundedNumber(discountBs),
            discountPercent: toPositiveRoundedNumber(discountPercent),
            deliveryFeeBs: toPositiveRoundedNumber(deliveryCharge.deliveryFeeBs),
            deliveryFeeCollectedBs: toPositiveRoundedNumber(deliveryFeeCollectedAtApprovalBs),
            prepaidAppliedBs: toPositiveRoundedNumber(prepaidAppliedBs),
            totalBs: toPositiveRoundedNumber(totalBs),
            paidAtRentalBs: toPositiveRoundedNumber(paidAtRentalBs),
            pendingPaymentBs: toPositiveRoundedNumber(pendingPaymentBs),
            overpaidBs: toPositiveRoundedNumber(overpaidBs),
          },
          payment: {
            mode: paymentStatus === 'cancelado' ? 'cancelado' : paymentMode,
            status: paymentStatus,
            paidAtRentalBs: toPositiveRoundedNumber(paidAtRentalBs),
            pendingPaymentBs: toPositiveRoundedNumber(pendingPaymentBs),
            overpaidBs: toPositiveRoundedNumber(overpaidBs),
            prepaidAppliedBs: toPositiveRoundedNumber(prepaidAppliedBs),
            deliveryFeeCollectedBs: toPositiveRoundedNumber(deliveryFeeCollectedAtApprovalBs),
            rentalCollectedBs: toPositiveRoundedNumber(rentalCollectedAtApprovalBs),
            cashCollectedBs: toPositiveRoundedNumber(cashCollectedAtApprovalBs),
            initialPaymentMethod,
            initialPaymentAccount,
            guaranteeStatus,
            guaranteePaymentMethod,
            guaranteePaymentAccount,
          },
          notes,
          billingMode: ['con_factura', 'sin_factura'].includes(payload?.billingMode) ? payload.billingMode : 'sin_factura',
          logisticsMode,
          supplierFulfillmentPlan,
          inventoryAvailabilityAssumptions,
          status: 'active',
          createdById: userId,
          createdByName: userName,
          createdByRole: userRole,
          operational: {
            inventoryStatus: 'pendiente',
            transportStatus: payload?.logisticsMode === 'recojo' ? 'no_aplica' : 'pendiente',
            inventoryNote: '',
            transportNote: '',
            inventorySentAt: null,
            inventoryDispatchedAt: null,
            inventoryDispatchedByName: null,
            inventoryDispatchedByRole: null,
            transportSentAt: null,
            inventoryConfirmedAt: null,
            transportConfirmedAt: null,
            inventoryConfirmedByName: null,
            inventoryConfirmedByRole: null,
            transportConfirmedByName: null,
            transportConfirmedByRole: null,
          },
          createdAt: now.toISOString(),
          deletedAt: null,
        };

        state.rentals.push(createdRental);
        if (prepaidClient && prepaidAppliedBs > 0) {
          prepaidClient.prepaidBalanceBs = Math.max(0, toPositiveRoundedNumber(prepaidClient.prepaidBalanceBs ?? 0));
          prepaidClient.prepaidTotalUsedBs = Math.max(0, toPositiveRoundedNumber(prepaidClient.prepaidTotalUsedBs ?? 0));
          prepaidClient.prepaidMovements = normalizePrepaidMovements(prepaidClient.prepaidMovements, prepaidClient.prepaidBalanceBs);
          const nextBalance = Number((prepaidClient.prepaidBalanceBs - prepaidAppliedBs).toFixed(2));
          prepaidClient.prepaidBalanceBs = nextBalance;
          prepaidClient.prepaidTotalUsedBs = Number((prepaidClient.prepaidTotalUsedBs + prepaidAppliedBs).toFixed(2));
          prepaidClient.prepaidMovements.push({
            id: makeId('pre'),
            type: 'charge',
            amountBs: -prepaidAppliedBs,
            description: `Consumo prepago ${orderCode}`,
            sourceType: 'rental',
            sourceId: createdRental.id,
            orderCode,
            balanceAfterBs: nextBalance,
            createdAt: now.toISOString(),
          });
          prepaidClient.updatedAt = now.toISOString();
        }
        state.inventoryMovements.push(...reservationMovements);
        if (createdRental.logisticsMode !== 'recojo') {
          createDeliveryFromRental(state, createdRental);
        }
        addRentalCashMovements(state, createdRental);
        return state;
      });

      return createdRental;
    },
    updateOperational: async (payload) => {
      const id = String(payload?.id ?? payload?.rentalId ?? '').trim();
      if (!id) {
        throw new Error('No se pudo identificar la orden de servicio.');
      }

      let updated = null;
      transaction((state) => {
        const rental = state.rentals.find((entry) => entry.id === id && !entry.deletedAt);
        if (!rental) {
          throw new Error('Orden de servicio no encontrada.');
        }
        if (rental.status === 'cancelled') {
          throw new Error('La orden esta anulada y ya no admite cambios operativos.');
        }

        const now = new Date().toISOString();
        const userName = String(payload?.userName ?? payload?.createdByName ?? payload?.createdBy ?? '').trim() || 'Sistema';
        const userRole = String(payload?.userRole ?? payload?.createdByRole ?? '').trim() || 'Operacion';
        rental.operational = {
          inventoryStatus: rental.operational?.inventoryStatus ?? 'pendiente',
          transportStatus: rental.operational?.transportStatus ?? 'pendiente',
          inventoryNote: rental.operational?.inventoryNote ?? '',
          transportNote: rental.operational?.transportNote ?? '',
          inventorySentAt: rental.operational?.inventorySentAt ?? null,
          inventoryDispatchedAt: rental.operational?.inventoryDispatchedAt ?? null,
          inventoryDispatchedByName: rental.operational?.inventoryDispatchedByName ?? null,
          inventoryDispatchedByRole: rental.operational?.inventoryDispatchedByRole ?? null,
          transportSentAt: rental.operational?.transportSentAt ?? null,
          inventoryConfirmedAt: rental.operational?.inventoryConfirmedAt ?? null,
          transportConfirmedAt: rental.operational?.transportConfirmedAt ?? null,
          inventoryConfirmedByName: rental.operational?.inventoryConfirmedByName ?? null,
          inventoryConfirmedByRole: rental.operational?.inventoryConfirmedByRole ?? null,
          inventoryReturnedAt: rental.operational?.inventoryReturnedAt ?? null,
          inventoryReturnedByName: rental.operational?.inventoryReturnedByName ?? null,
          inventoryReturnedByRole: rental.operational?.inventoryReturnedByRole ?? null,
          transportConfirmedByName: rental.operational?.transportConfirmedByName ?? null,
          transportConfirmedByRole: rental.operational?.transportConfirmedByRole ?? null,
          dispatchReview: rental.operational?.dispatchReview ?? null,
          returnReview: rental.operational?.returnReview ?? null,
          revisionAlert: rental.operational?.revisionAlert ?? null,
          clientPendingPickup: rental.operational?.clientPendingPickup ?? null,
        };

        if (payload.inventoryStatus !== undefined) {
          const previousInventoryStatus = rental.operational.inventoryStatus;
          rental.operational.inventoryStatus = String(payload.inventoryStatus ?? 'pendiente').trim() || 'pendiente';
          if (rental.operational.inventoryStatus === 'enviado' && !rental.operational.inventorySentAt) {
            rental.operational.inventorySentAt = now;
          }
          if (rental.operational.inventoryStatus === 'confirmado') {
            rental.operational.inventoryConfirmedAt = now;
            rental.operational.inventorySentAt = rental.operational.inventorySentAt ?? now;
            rental.operational.inventoryConfirmedByName = userName;
            rental.operational.inventoryConfirmedByRole = userRole;
          }
          if (rental.operational.inventoryStatus === 'salio') {
            if (previousInventoryStatus !== 'confirmado' && !rental.operational.inventoryConfirmedAt) {
              throw new Error('Primero debes marcar la orden como lista antes de registrar su salida.');
            }
            rental.operational.inventoryDispatchedAt = now;
            rental.operational.inventoryDispatchedByName = userName;
            rental.operational.inventoryDispatchedByRole = userRole;
          }
        }

        if (payload.transportStatus !== undefined) {
          rental.operational.transportStatus = String(payload.transportStatus ?? 'pendiente').trim() || 'pendiente';
          if (rental.operational.transportStatus === 'enviado' && !rental.operational.transportSentAt) {
            rental.operational.transportSentAt = now;
          }
          if (rental.operational.transportStatus === 'confirmado') {
            rental.operational.transportConfirmedAt = now;
            rental.operational.transportSentAt = rental.operational.transportSentAt ?? now;
            rental.operational.transportConfirmedByName = userName;
            rental.operational.transportConfirmedByRole = userRole;
          }
        }

        if (payload.inventoryNote !== undefined) {
          rental.operational.inventoryNote = String(payload.inventoryNote ?? '').trim();
        }
        if (payload.transportNote !== undefined) {
          rental.operational.transportNote = String(payload.transportNote ?? '').trim();
        }
        if (payload.dispatchReview !== undefined) {
          const status = String(payload.dispatchReview?.status ?? 'complete').trim() || 'complete';
          rental.operational.dispatchReview = {
            status,
            note: String(payload.dispatchReview?.note ?? '').trim(),
            items: Array.isArray(payload.dispatchReview?.items)
              ? payload.dispatchReview.items.map((line) => ({
                  lineKey: String(line?.lineKey ?? '').trim(),
                  itemId: String(line?.itemId ?? '').trim(),
                  itemName: String(line?.itemName ?? '').trim(),
                  expectedQty: Math.max(0, Math.trunc(Number(line?.expectedQty ?? 0))),
                  dispatchedQty: Math.max(0, Math.trunc(Number(line?.dispatchedQty ?? 0))),
                  pendingQty: Math.max(0, Math.trunc(Number(line?.pendingQty ?? 0))),
                  note: String(line?.note ?? '').trim(),
                }))
              : [],
            reviewedAt: now,
            reviewedByName: userName,
            reviewedByRole: userRole,
          };
        }
        if (payload.returnReview !== undefined) {
          const status = String(payload.returnReview?.status ?? 'complete').trim() || 'complete';
          rental.operational.returnReview = {
            status,
            note: String(payload.returnReview?.note ?? '').trim(),
            reviewedAt: now,
            reviewedByName: userName,
            reviewedByRole: userRole,
          };
        }
        if (payload.clientPendingPickup !== undefined) {
          const active = Boolean(payload.clientPendingPickup?.active);
          rental.operational.clientPendingPickup = active
            ? {
                active: true,
                note: String(payload.clientPendingPickup?.note ?? '').trim(),
                items: Array.isArray(payload.clientPendingPickup?.items)
                  ? payload.clientPendingPickup.items.map((line) => ({
                      lineKey: String(line?.lineKey ?? '').trim(),
                      itemId: String(line?.itemId ?? '').trim(),
                      itemName: String(line?.itemName ?? '').trim(),
                      expectedQty: Math.max(0, Math.trunc(Number(line?.expectedQty ?? 0))),
                      pendingQty: Math.max(0, Math.trunc(Number(line?.pendingQty ?? 0))),
                      note: String(line?.note ?? '').trim(),
                    })).filter((line) => line.pendingQty > 0)
                  : [],
                registeredAt: now,
                registeredByName: userName,
                registeredByRole: userRole,
              }
            : null;
        }
        if (payload.revisionAlert !== undefined) {
          rental.operational.revisionAlert = payload.revisionAlert ?? null;
        }
        if (payload.clearOperationalRevisionAlert) {
          rental.operational.revisionAlert = rental.operational.revisionAlert
            ? {
                ...rental.operational.revisionAlert,
                active: false,
                resolvedAt: now,
                resolvedByName: userName,
                resolvedByRole: userRole,
              }
            : null;
        }

        rental.updatedAt = now;
        updated = deepClone(rental);
        return state;
      });

      return updated;
    },
    cancel: async (payload) => {
      const id = String(payload?.id ?? payload?.rentalId ?? '').trim();
      const contractId = String(payload?.contractId ?? '').trim();
      if (!id && !contractId) {
        throw new Error('No se pudo identificar el contrato u orden de servicio a anular.');
      }

      let cancelled = null;
      transaction((state) => {
        const nowIso = new Date().toISOString();
        const todayKey = toDateKey(nowIso);
        const linkedContractFromId = contractId
          ? state.contracts.find((entry) => entry.id === contractId && !entry.deletedAt)
          : null;
        const rental = id
          ? state.rentals.find((entry) => entry.id === id && !entry.deletedAt)
          : state.rentals.find((entry) =>
            !entry.deletedAt
            && linkedContractFromId
            && (
              (linkedContractFromId.rentalId && entry.id === linkedContractFromId.rentalId)
              || (linkedContractFromId.orderCode && entry.orderCode === linkedContractFromId.orderCode)
            ),
          );

        if (!rental) throw new Error('Orden de servicio no encontrada.');
        if (rental.status === 'returned') throw new Error('No se puede anular una orden ya devuelta.');
        if (rental.status === 'cancelled') throw new Error('Esta orden ya fue anulada.');

        const linkedContract = linkedContractFromId ?? state.contracts.find((entry) =>
          !entry.deletedAt
          && (
            (entry.rentalId && entry.rentalId === rental.id)
            || (entry.orderCode && rental.orderCode && entry.orderCode === rental.orderCode)
          ),
        ) ?? null;
        const cutoffDate = linkedContract?.deliveryDate ?? rental.rentalDate ?? linkedContract?.eventDate ?? null;
        if (!cutoffDate) {
          throw new Error('No se pudo validar la fecha limite de anulacion para este contrato.');
        }

        const isWithinCancellationWindow = isSameOrBeforeDay(todayKey, cutoffDate);
        const operational = rental.operational ?? {};
        const inventoryStatus = normalizeText(operational.inventoryStatus ?? '');
        const transportStatus = normalizeText(operational.transportStatus ?? '');
        const wasOperationallySent = Boolean(
          operational.inventorySentAt
          || operational.inventoryDispatchedAt
          || operational.transportSentAt
          || ['salio', 'enviado', 'en_ruta', 'entregado', 'devuelto'].includes(inventoryStatus)
          || ['salio', 'enviado', 'en_ruta', 'entregado', 'devuelto'].includes(transportStatus)
          || rental.returnedAt
          || Array.isArray(rental.returnReport),
        );
        const collectedBs = Math.max(
          Number(rental?.payment?.paidAtRentalBs ?? 0),
          Number(rental?.totals?.paidAtRentalBs ?? 0),
          Number(rental?.payment?.cashCollectedBs ?? 0),
          Number(rental?.payment?.rentalCollectedBs ?? 0),
          Number(rental?.payment?.deliveryFeeCollectedBs ?? 0),
          0,
        );
        const guaranteeWasCollected = ['pagada', 'pagado', 'validada', 'validado', 'retenida', 'retenido']
          .includes(normalizeText(rental?.payment?.guaranteeStatus ?? linkedContract?.guarantee?.status ?? ''));
        const canCancelUnfulfilledAfterCutoff = !wasOperationallySent && collectedBs <= 0 && !guaranteeWasCollected;

        if (!isWithinCancellationWindow && !canCancelUnfulfilledAfterCutoff) {
          throw new Error(
            `El plazo de anulacion vencio el ${toDateKey(cutoffDate)}. `
            + 'Solo puede anularse despues de esa fecha cuando la orden nunca salio, no fue entregada y no registra cobros.',
          );
        }

        const totalBs = Number(linkedContract?.totals?.totalBs ?? rental?.totals?.totalBs ?? 0);
        const settings = state.settings ?? {};
        const configuredPenaltyPercent = Math.max(0, Number(settings.contractCancellationPenaltyPercent ?? 20));
        const penaltyPercent = isWithinCancellationWindow ? configuredPenaltyPercent : 0;
        const penaltyBs = Number((totalBs * (penaltyPercent / 100)).toFixed(2));
        const reason = String(payload?.reason ?? '').trim();
        if (!reason) throw new Error('Debes indicar por que se esta anulando el contrato.');
        const userName = String(payload?.userName ?? payload?.createdByName ?? payload?.createdBy ?? '').trim() || 'Sistema';
        const userRole = String(payload?.userRole ?? payload?.createdByRole ?? '').trim() || 'Operacion';

        (rental.items ?? []).forEach((line) => {
          const item = state.items.find((entry) => entry.id === line.itemId);
          if (!item || lineControlsStock(line, item) === false) return;
          const reservedQty = Number.isFinite(Number(line.internalReservedQty))
            ? Math.max(0, Math.trunc(Number(line.internalReservedQty)))
            : Math.max(0, Math.trunc(Number(line.quantity ?? 0)));
          if (reservedQty <= 0) return;
          const beforeTotalStock = Number(item.totalStock ?? 0);
          const beforeAvailableStock = Number(item.availableStock ?? 0);
          item.availableStock = Math.min(beforeTotalStock, beforeAvailableStock + reservedQty);
          item.updatedAt = nowIso;
          state.inventoryMovements.push({
            id: makeId('mov'),
            itemId: item.id,
            itemName: item.name,
            category: item.category,
            type: 'reinsercion',
            reason: `Anulacion de contrato ${linkedContract?.contractCode ?? rental.orderCode}`,
            detail: `Reintegro de ${reservedQty} unidades por anulacion de ${rental.orderCode}`,
            reference: rental.orderCode,
            deltaUnits: reservedQty,
            beforeTotalStock,
            afterTotalStock: beforeTotalStock,
            beforeAvailableStock,
            afterAvailableStock: item.availableStock,
            reservedStockAfter: item.totalStock - item.availableStock,
            userName,
            userRole,
            createdAt: nowIso,
            status: 'cancelado',
          });
        });

        state.deliveries.forEach((delivery) => {
          if (delivery.deletedAt) return;
          if (delivery.rentalId === rental.id || delivery.orderCode === rental.orderCode) {
            delivery.status = 'cancelada';
            delivery.progress = 0;
            delivery.updatedAt = nowIso;
            if (!String(delivery.notes ?? '').includes('[ANULADO]')) {
              delivery.notes = `${String(delivery.notes ?? '').trim()} [ANULADO]`.trim();
            }
          }
        });

        rental.status = 'cancelled';
        rental.cancelledAt = nowIso;
        rental.cancellationPenaltyPercent = penaltyPercent;
        rental.cancellationPenaltyBs = penaltyBs;
        rental.cancellationReason = reason;
        rental.cancellationCutoffDate = toDateKey(cutoffDate);
        rental.penaltiesBs = Number((Number(rental.penaltiesBs ?? 0) + penaltyBs).toFixed(2));
        rental.operational = {
          ...(rental.operational ?? {}),
          inventoryStatus: 'anulado',
          transportStatus: 'anulado',
          inventoryNote: reason || rental.operational?.inventoryNote || '',
          transportNote: reason || rental.operational?.transportNote || '',
        };
        rental.updatedAt = nowIso;

        if (linkedContract) {
          linkedContract.status = 'anulado';
          linkedContract.cancelledAt = nowIso;
          linkedContract.cancellationPenaltyPercent = penaltyPercent;
          linkedContract.cancellationPenaltyBs = penaltyBs;
          linkedContract.cancellationReason = reason;
          linkedContract.cancellationCutoffDate = toDateKey(cutoffDate);
          linkedContract.updatedAt = nowIso;
          appendContractRevision(linkedContract, payload, nowIso, [
            `Contrato anulado por ${userName}`,
            `Motivo: ${reason}`,
            `Items liberados de inventario para ${rental.orderCode}`,
            `Numero de contrato conservado: ${linkedContract.contractCode}`,
          ]);
        }

        cancelled = deepClone({
          ...rental,
          contractId: linkedContract?.id ?? null,
          contractCode: linkedContract?.contractCode ?? null,
        });
        return state;
      });

      return cancelled;
    },
    remove: async (payload) => {
      const id = String(payload?.id ?? payload?.rentalId ?? '').trim();
      if (!id) {
        throw new Error('No se pudo identificar la orden de servicio.');
      }

      let removed = null;
      transaction((state) => {
        const rental = state.rentals.find((entry) => entry.id === id && !entry.deletedAt);
        if (!rental) {
          throw new Error('Orden de servicio no encontrada.');
        }
        if (rental.status === 'returned') {
          throw new Error('No se puede eliminar una orden cerrada/devuelta.');
        }

        const now = new Date().toISOString();
        (rental.items ?? []).forEach((line) => {
          const item = state.items.find((entry) => entry.id === line.itemId);
          if (item) {
            item.availableStock += Math.max(0, Math.trunc(Number(line.quantity ?? 0)));
            item.updatedAt = now;
          }
        });

        state.deliveries.forEach((delivery) => {
          if (delivery.rentalId === rental.id || delivery.orderCode === rental.orderCode) {
            delivery.status = 'cancelada';
            delivery.deletedAt = now;
            delivery.updatedAt = now;
          }
        });

        state.contracts.forEach((contract) => {
          if (contract.rentalId === rental.id || contract.orderCode === rental.orderCode) {
            contract.rentalId = null;
            contract.orderCode = null;
            contract.updatedAt = now;
          }
        });

        state.quotes.forEach((quote) => {
          if (quote.rentalId === rental.id || quote.orderCode === rental.orderCode) {
            quote.rentalId = null;
            quote.orderCode = null;
            quote.updatedAt = now;
          }
        });

        rental.deletedAt = now;
        rental.status = 'cancelled';
        rental.updatedAt = now;
        removed = deepClone(rental);
        return state;
      });

      return removed;
    },
    registerReturn: async (payload) => {
      const rentalId = payload?.rentalId;
      const lines = payload?.returnedItems ?? [];
      const isPartialReturn = Boolean(payload?.partialReturn) || String(payload?.returnReview?.status ?? '').trim() === 'left_with_client';

      if (!rentalId) {
        throw new Error('Debe seleccionar un alquiler para registrar la devolucion.');
      }
      if (!Array.isArray(lines) || lines.length === 0) {
        throw new Error('Debe enviar el detalle de devolucion por item.');
      }

      let returnedRental = null;
      transaction((state) => {
        const hasOpenCashSession = state.cashSessions.some((session) => session.status === 'open');
        const requireCashSession = payload?.requireCashSession !== false;
        if (requireCashSession && !hasOpenCashSession) {
          throw new Error('No puedes registrar devoluciones con la caja cerrada. Abre caja primero.');
        }

        const settings = state.settings ?? {};
        const missingMultiplier = toNumber(settings.missingMultiplier ?? 2, 'multiplicador faltante');
        const damageMultiplier = toNumber(settings.damageMultiplier ?? 1.2, 'multiplicador dano');

        const rental = state.rentals.find((entry) => entry.id === rentalId && !entry.deletedAt);
        if (!rental) {
          throw new Error('No se encontro el alquiler seleccionado.');
        }
        if (rental.status === 'cancelled') {
          throw new Error('La orden esta anulada y no puede registrarse como devolucion.');
        }
        if (rental.status === 'returned' && !isPartialReturn) {
          revertReturnEffects(state, rental);
        }

        const normalizeReturnChargeOwner = (value) => {
          const normalized = normalizeText(value).replace(/\s+/g, '_');
          if (['transporte', 'lavado'].includes(normalized)) return normalized;
          return 'cliente';
        };

        let penaltiesBs = 0;
        let internalPenaltiesBs = 0;
        const previousPartialItems = Array.isArray(rental.partialReturnReport?.items)
          ? rental.partialReturnReport.items
          : [];
        previousPartialItems.forEach((line) => {
          const chargeOwner = normalizeReturnChargeOwner(line?.chargeOwner);
          const damagedQty = Math.max(0, Math.trunc(Number(line?.damagedQty ?? 0)));
          const damagedUnitChargeBs = Math.max(0, Number(line?.damagedUnitChargeBs ?? 0));
          const damagedFeeBs = Number((damagedQty * damagedUnitChargeBs).toFixed(2));
          if (chargeOwner === 'cliente') {
            penaltiesBs = Number((penaltiesBs + damagedFeeBs).toFixed(2));
          } else {
            internalPenaltiesBs = Number((internalPenaltiesBs + damagedFeeBs).toFixed(2));
          }
        });
        const getPreviouslyProcessedQty = (rentalLine, rentalLineKey) => previousPartialItems
          .filter((entry) => (
            String(entry?.lineKey ?? '') === String(rentalLineKey)
            || (!entry?.lineKey && String(entry?.itemId ?? '') === String(rentalLine.itemId ?? ''))
          ))
          .reduce((sum, entry) => sum
            + Math.max(0, Math.trunc(Number(entry?.returnedQty ?? 0)))
            + Math.max(0, Math.trunc(Number(entry?.damagedQty ?? 0))), 0);
        const consumedReturnLineIndexes = new Set();
        const returnReport = rental.items.map((rentalLine, index) => {
          const rentalLineKey = getInventoryLineKey(rentalLine, index);
          const normalizedRentalItemId = String(rentalLine?.itemId ?? '').trim();
          const normalizedRentalItemName = normalizeText(rentalLine?.itemName ?? rentalLine?.name ?? '');
          const normalizedRentalComboLineKey = String(rentalLine?.comboLineKey ?? '').trim();

          const findAvailableLineIndex = (predicate) => lines.findIndex(
            (entry, entryIndex) => !consumedReturnLineIndexes.has(entryIndex) && predicate(entry),
          );

          let incomingLineIndex = findAvailableLineIndex(
            (entry) => Number(entry?.sourceLineIndex) === index,
          );
          if (incomingLineIndex < 0) {
            incomingLineIndex = findAvailableLineIndex(
              (entry) => String(entry?.lineKey ?? entry?.returnLineKey ?? '') === rentalLineKey,
            );
          }
          if (incomingLineIndex < 0 && normalizedRentalComboLineKey) {
            incomingLineIndex = findAvailableLineIndex((entry) => (
              String(entry?.itemId ?? '').trim() === normalizedRentalItemId
              && String(entry?.comboLineKey ?? '').trim() === normalizedRentalComboLineKey
              && Number(entry?.comboRuleIndex ?? -1) === Number(rentalLine?.comboRuleIndex ?? -1)
            ));
          }
          if (incomingLineIndex < 0) {
            incomingLineIndex = findAvailableLineIndex((entry) => (
              String(entry?.itemId ?? '').trim() === normalizedRentalItemId
              && normalizeText(entry?.itemName ?? entry?.name ?? '') === normalizedRentalItemName
            ));
          }
          if (incomingLineIndex < 0) {
            incomingLineIndex = findAvailableLineIndex(
              (entry) => String(entry?.itemId ?? '').trim() === normalizedRentalItemId,
            );
          }

          const incomingLine = incomingLineIndex >= 0 ? lines[incomingLineIndex] : null;
          if (!incomingLine) {
            throw new Error(`Falta detalle de devolucion para "${rentalLine.itemName}".`);
          }
          consumedReturnLineIndexes.add(incomingLineIndex);

          const returnedQty = Math.max(0, toInteger(incomingLine.returnedQty, `devuelto (${rentalLine.itemName})`));
          const damagedQty = Math.max(0, toInteger(incomingLine.damagedQty, `daniado (${rentalLine.itemName})`));
          const missingQty = Math.max(0, toInteger(incomingLine.missingQty, `faltante (${rentalLine.itemName})`));
          const chargeOwner = normalizeReturnChargeOwner(incomingLine.chargeOwner);
          const damageNote = String(incomingLine.damageNote ?? '').trim();
          const originalExpectedQty = Math.max(0, Math.trunc(Number(rentalLine.quantity ?? 0)));
          const previousProcessedQty = getPreviouslyProcessedQty(rentalLine, rentalLineKey);
          const expectedQty = Math.max(0, originalExpectedQty - previousProcessedQty);

          if (returnedQty + damagedQty + missingQty !== expectedQty) {
            throw new Error(
              `La suma de devuelto + daniado + faltante para "${rentalLine.itemName}" debe ser ${expectedQty}.`,
            );
          }
          if ((damagedQty > 0 || missingQty > 0) && !damageNote) {
            throw new Error(`Debes registrar la observacion para "${rentalLine.itemName}".`);
          }

          const currentInventoryItem = state.items.find((entry) => entry.id === rentalLine.itemId);
          const configuredDamagedUnitChargeBs = Number.isFinite(Number(currentInventoryItem?.damagedUnitChargeBs))
            ? Math.max(0, Number(currentInventoryItem.damagedUnitChargeBs))
            : Number.isFinite(Number(rentalLine.damagedUnitChargeBs))
              ? Math.max(0, Number(rentalLine.damagedUnitChargeBs))
              : Number((rentalLine.rentalPriceBs * damageMultiplier).toFixed(2));
          const configuredMissingUnitChargeBs = Number.isFinite(Number(currentInventoryItem?.missingUnitChargeBs))
            ? Math.max(0, Number(currentInventoryItem.missingUnitChargeBs))
            : Number.isFinite(Number(rentalLine.missingUnitChargeBs))
              ? Math.max(0, Number(rentalLine.missingUnitChargeBs))
              : Number((rentalLine.rentalPriceBs * missingMultiplier).toFixed(2));
          const damagedUnitChargeBs = damagedQty > 0
            ? Number.isFinite(Number(incomingLine.damagedUnitChargeBs))
              ? Math.max(0, Number(incomingLine.damagedUnitChargeBs))
              : configuredDamagedUnitChargeBs
            : 0;
          const missingUnitChargeBs = missingQty > 0
            ? Number.isFinite(Number(incomingLine.missingUnitChargeBs))
              ? Math.max(0, Number(incomingLine.missingUnitChargeBs))
              : configuredMissingUnitChargeBs
            : 0;

          const damagedFeeBs = Number((damagedQty * damagedUnitChargeBs).toFixed(2));
          const missingFeeBs = Number((missingQty * missingUnitChargeBs).toFixed(2));
          const linePenaltyBs = Number((damagedFeeBs + missingFeeBs).toFixed(2));
          if (chargeOwner === 'cliente') {
            penaltiesBs = Number((penaltiesBs + linePenaltyBs).toFixed(2));
          } else {
            internalPenaltiesBs = Number((internalPenaltiesBs + linePenaltyBs).toFixed(2));
          }

          const item = currentInventoryItem;
          if (item) {
            const internalExpectedQty = Math.max(
              0,
              Math.min(
                expectedQty,
                Math.trunc(Number(rentalLine.internalReservedQty ?? expectedQty)),
              ),
            );
            const internalDamagedQty = Math.min(damagedQty, internalExpectedQty);
            const internalMissingQty = Math.min(missingQty, Math.max(0, internalExpectedQty - internalDamagedQty));
            const internalGoodQty = Math.min(
              returnedQty,
              Math.max(0, internalExpectedQty - internalDamagedQty - internalMissingQty),
            );
            const needsCleaningOnReturn = categoryRequiresCleaning(item.category) || Boolean(item.needsCleaningOnReturn);
            const movedToCleaningQty = needsCleaningOnReturn ? internalGoodQty : 0;
            const returnedToAvailableQty = internalGoodQty - movedToCleaningQty;

            item.availableStock += returnedToAvailableQty;
            item.updatedAt = new Date().toISOString();

            if (movedToCleaningQty > 0) {
              state.stockRecoveries.push({
                id: makeId('reco'),
                itemId: item.id,
                itemName: item.name,
                category: item.category,
                imageUrl: item.imageUrl ?? null,
                imageDataUrl: item.imageDataUrl ?? null,
                sourceRentalId: rental.id,
                sourceCustomerName: rental.customerName,
                stage: 'lavado',
                quantity: movedToCleaningQty,
                note: 'Devuelto y enviado a lavado.',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            }

            if (internalDamagedQty > 0) {
              state.stockRecoveries.push({
                id: makeId('reco'),
                itemId: item.id,
                itemName: item.name,
                category: item.category,
                imageUrl: item.imageUrl ?? null,
                imageDataUrl: item.imageDataUrl ?? null,
                sourceRentalId: rental.id,
                sourceCustomerName: rental.customerName,
                stage: 'reparacion',
                quantity: internalDamagedQty,
                note: damageNote || 'Dano reportado en devolucion.',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            }

            return {
              lineKey: rentalLineKey,
              itemId: rentalLine.itemId,
              itemName: rentalLine.itemName,
              expectedQty,
              originalExpectedQty,
              previousProcessedQty,
              internalExpectedQty,
              supplierBackedQty: Math.max(0, expectedQty - internalExpectedQty),
              returnedQty,
              returnedToAvailableQty,
              movedToCleaningQty,
              damagedQty,
              missingQty,
              damageNote,
              chargeOwner,
              damagedUnitChargeBs,
              missingUnitChargeBs,
              damagedFeeBs,
              missingFeeBs,
              penaltyBs: linePenaltyBs,
            };
          }

          return {
            lineKey: rentalLineKey,
            itemId: rentalLine.itemId,
            itemName: rentalLine.itemName,
            expectedQty,
            originalExpectedQty,
            previousProcessedQty,
            returnedQty,
            returnedToAvailableQty: returnedQty,
            movedToCleaningQty: 0,
            damagedQty,
            missingQty,
            damageNote,
            chargeOwner,
            damagedUnitChargeBs,
            missingUnitChargeBs,
            damagedFeeBs,
            missingFeeBs,
            penaltyBs: linePenaltyBs,
          };
        });

        if (isPartialReturn) {
          const pendingItems = returnReport
            .filter((line) => Math.max(0, Math.trunc(Number(line.missingQty ?? 0))) > 0)
            .map((line) => ({
              lineKey: line.lineKey,
              itemId: line.itemId,
              itemName: line.itemName,
              expectedQty: line.expectedQty,
              pendingQty: Math.max(0, Math.trunc(Number(line.missingQty ?? 0))),
              note: String(line.damageNote ?? '').trim(),
            }));
          if (pendingItems.length === 0) {
            throw new Error('Para registrar material con cliente debe existir al menos una cantidad pendiente.');
          }

          const partialItems = [
            ...previousPartialItems,
            ...returnReport
              .filter((line) => (
                Math.max(0, Math.trunc(Number(line.returnedQty ?? 0))) > 0
                || Math.max(0, Math.trunc(Number(line.damagedQty ?? 0))) > 0
                || Math.max(0, Math.trunc(Number(line.missingQty ?? 0))) > 0
              ))
              .map((line) => ({
                ...line,
                partialRegisteredAt: new Date().toISOString(),
              })),
          ];

          rental.partialReturnReport = {
            updatedAt: new Date().toISOString(),
            updatedByName: String(payload?.userName ?? payload?.createdByName ?? 'Inventario').trim() || 'Inventario',
            items: partialItems,
          };
          rental.operational = {
            ...(rental.operational ?? {}),
            inventoryStatus: 'salio',
            returnReview: {
              status: 'left_with_client',
              note: String(payload?.returnReview?.note ?? '').trim(),
              reviewedAt: rental.partialReturnReport.updatedAt,
              reviewedByName: String(payload?.userName ?? payload?.createdByName ?? 'Inventario').trim() || 'Inventario',
              reviewedByRole: String(payload?.userRole ?? payload?.createdByRole ?? 'Inventario').trim() || 'Inventario',
            },
            clientPendingPickup: {
              active: true,
              note: String(payload?.clientPendingPickup?.note ?? payload?.returnReview?.note ?? '').trim(),
              items: pendingItems,
              registeredAt: rental.partialReturnReport.updatedAt,
              registeredByName: String(payload?.userName ?? payload?.createdByName ?? 'Inventario').trim() || 'Inventario',
              registeredByRole: String(payload?.userRole ?? payload?.createdByRole ?? 'Inventario').trim() || 'Inventario',
            },
          };
          rental.updatedAt = rental.partialReturnReport.updatedAt;
          returnedRental = deepClone(rental);
          return state;
        }

        const totalBs = Number(rental?.totals?.totalBs ?? 0);
        const alreadyPaidBs = Number(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs ?? totalBs);
        const outstandingRentalBs = Number(Math.max(0, totalBs - alreadyPaidBs).toFixed(2));
        const totalDiscountAgainstDepositBs = Number((penaltiesBs + outstandingRentalBs).toFixed(2));
        const refundBs = Number(Math.max(0, rental.depositBs - totalDiscountAgainstDepositBs).toFixed(2));
        const pendingCollectionBs = Number(Math.max(0, totalDiscountAgainstDepositBs - rental.depositBs).toFixed(2));
        const discountCoveredByDepositBs = Number(
          Math.min(rental.depositBs, totalDiscountAgainstDepositBs).toFixed(2),
        );

        rental.status = 'returned';
        rental.returnedAt = new Date().toISOString();
        const settledPartialItems = previousPartialItems.filter((line) => (
          Math.max(0, Math.trunc(Number(line?.returnedQty ?? 0))) > 0
          || Math.max(0, Math.trunc(Number(line?.damagedQty ?? 0))) > 0
        ));
        rental.returnReport = [...settledPartialItems, ...returnReport];
        rental.partialReturnReport = null;
        rental.operational = {
          ...(rental.operational ?? {}),
          inventoryStatus: 'devuelto',
          inventoryReturnedAt: rental.returnedAt,
          inventoryReturnedByName: String(payload?.userName ?? payload?.createdByName ?? 'Inventario').trim() || 'Inventario',
          inventoryReturnedByRole: String(payload?.userRole ?? payload?.createdByRole ?? 'Inventario').trim() || 'Inventario',
          returnReview: {
            status: String(payload?.returnReview?.status ?? 'complete').trim() || 'complete',
            note: String(payload?.returnReview?.note ?? '').trim(),
            reviewedAt: rental.returnedAt,
            reviewedByName: String(payload?.userName ?? payload?.createdByName ?? 'Inventario').trim() || 'Inventario',
            reviewedByRole: String(payload?.userRole ?? payload?.createdByRole ?? 'Inventario').trim() || 'Inventario',
          },
          clientPendingPickup: null,
        };
        rental.penaltiesBs = penaltiesBs;
        rental.internalPenaltiesBs = internalPenaltiesBs;
        rental.refundBs = refundBs;
        rental.payment = {
          ...(rental.payment ?? {}),
          status: pendingCollectionBs > 0 ? 'saldo_pendiente' : 'liquidado',
          paidAtRentalBs: alreadyPaidBs,
          pendingPaymentBs: pendingCollectionBs,
        };
        rental.returnSettlement = {
          outstandingRentalBs,
          penaltiesBs,
          internalPenaltiesBs,
          totalDiscountAgainstDepositBs,
          discountCoveredByDepositBs,
          pendingCollectionBs,
          refundBs,
        };

        const linkedDeliveries = state.deliveries.filter(
          (delivery) =>
            (delivery.rentalId && delivery.rentalId === rental.id)
            || (delivery.orderCode && rental.orderCode && delivery.orderCode === rental.orderCode),
        );
        linkedDeliveries.forEach((delivery) => {
          delivery.status = 'completada';
          delivery.progress = 100;
          delivery.updatedAt = new Date().toISOString();
        });

        returnedRental = deepClone(rental);
        addReturnCashMovements(state, rental);
        return state;
      });

      return returnedRental;
    },
  },

  cash: {
    getSummary: async () => {
      const state = readQueryState();
      const activeSession = getActiveSession(state);
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

      const todayMovements = state.cashMovements.filter(
        (movement) => !isVoidedCashMovement(movement) && new Date(movement.createdAt).getTime() >= startOfDay,
      );
      const realTodayMovements = todayMovements.filter((movement) => !movement.isInternalTransfer);
      const sumMovements = (rows, predicate) => Number(
        rows
          .filter(predicate)
          .reduce((sum, movement) => sum + Number(movement.amountBs), 0)
          .toFixed(2),
      );
      const bigCashBalanceBs = calculateCashBoxBalance(state, CASH_BOX_TYPES.BIG_CASH);
      const guaranteeHeldBs = calculateHeldGuarantees(state);
      const operationalBigCashBs = calculateOperationalBigCashBalance(state);
      const pettyCashBalanceBs = activeSession
        ? calculateSessionBalance(state, activeSession.id, CASH_BOX_TYPES.PETTY_CASH)
        : 0;
      const treasuryAccounts = activeSession ? normalizeTreasuryAccounts(activeSession.treasuryAccounts) : [];
      const treasuryAllocatedBs = toPositiveRoundedNumber(
        treasuryAccounts.reduce((sum, account) => sum + Number(account.amountBs ?? 0), 0),
      );
      const treasuryUnassignedBs = Number((bigCashBalanceBs - treasuryAllocatedBs).toFixed(2));

      const todayIncomeBs = Number(
        realTodayMovements
          .filter((movement) => Number(movement.amountBs) > 0)
          .reduce((sum, movement) => sum + Number(movement.amountBs), 0)
          .toFixed(2),
      );
      const todayExpenseBs = Number(
        Math.abs(
          realTodayMovements
            .filter((movement) => Number(movement.amountBs) < 0)
            .reduce((sum, movement) => sum + Number(movement.amountBs), 0),
        ).toFixed(2),
      );
      const todayBigCashIncomeBs = sumMovements(
        realTodayMovements,
        (movement) => normalizeCashBoxType(movement.cashBoxType) === CASH_BOX_TYPES.BIG_CASH && Number(movement.amountBs) > 0,
      );
      const todayBigCashExpenseBs = Math.abs(sumMovements(
        realTodayMovements,
        (movement) => normalizeCashBoxType(movement.cashBoxType) === CASH_BOX_TYPES.BIG_CASH && Number(movement.amountBs) < 0,
      ));
      const todayPettyCashIncomeBs = sumMovements(
        realTodayMovements,
        (movement) => normalizeCashBoxType(movement.cashBoxType) === CASH_BOX_TYPES.PETTY_CASH && Number(movement.amountBs) > 0,
      );
      const todayPettyCashExpenseBs = Math.abs(sumMovements(
        realTodayMovements,
        (movement) => normalizeCashBoxType(movement.cashBoxType) === CASH_BOX_TYPES.PETTY_CASH && Number(movement.amountBs) < 0,
      ));

      return {
        activeSession: activeSession
          ? {
            ...activeSession,
            expectedBigCashBs: bigCashBalanceBs,
            expectedPettyCashBs: pettyCashBalanceBs,
            expectedBalanceBs: Number((bigCashBalanceBs + pettyCashBalanceBs).toFixed(2)),
          }
          : null,
        sessionsCount: state.cashSessions.length,
        movementsCount: state.cashMovements.length,
        orphanMovementsCount: state.cashMovements.filter((movement) => !movement.sessionId).length,
        todayIncomeBs,
        todayExpenseBs,
        todayBigCashIncomeBs,
        todayBigCashExpenseBs,
        todayPettyCashIncomeBs,
        todayPettyCashExpenseBs,
        bigCashBalanceBs,
        guaranteeHeldBs,
        operationalBigCashBs,
        pettyCashBalanceBs,
        totalAvailableBs: Number((bigCashBalanceBs + pettyCashBalanceBs).toFixed(2)),
        treasuryAccounts,
        treasuryAllocatedBs,
        treasuryUnassignedBs,
      };
    },
    listSessions: async () => {
      const { cashSessions } = readQueryState();
      return cashSessions.slice().sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
    },
    listMovements: async (payload) => {
      const filterSessionId = String(payload?.sessionId ?? '').trim();
      const { cashMovements } = readQueryState();
      const filtered = filterSessionId
        ? cashMovements.filter((movement) => movement.sessionId === filterSessionId)
        : cashMovements;

      return filtered.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    listDebts: async () => {
      const { cashDebts } = readQueryState();
      return cashDebts.slice().sort((a, b) => new Date(b.createdAt ?? b.debtDate) - new Date(a.createdAt ?? a.debtDate));
    },
    createDebt: async (payload) => {
      const description = String(payload?.description ?? payload?.detail ?? '').trim();
      const amountBs = toNumber(payload?.amountBs ?? 0, 'monto de deuda');
      const personName = String(payload?.personName ?? payload?.responsible ?? '').trim();
      const debtDate = String(payload?.debtDate ?? '').trim() || new Date().toISOString();
      const dueDate = String(payload?.dueDate ?? '').trim() || null;
      const debtKind = normalizeCashDebtKind(payload?.debtKind ?? payload?.kind ?? payload?.category);
      const category = String(payload?.category ?? '').trim();
      const sourceMovementId = String(payload?.sourceMovementId ?? '').trim();
      const sourceMovementReceipt = String(payload?.sourceMovementReceipt ?? '').trim();
      const notes = String(payload?.notes ?? '').trim();
      const createdBy = String(payload?.createdBy ?? '').trim() || 'Contabilidad';

      if (!description) {
        throw new Error('Debes escribir el detalle de la deuda.');
      }
      if (amountBs <= 0) {
        throw new Error('El monto de la deuda debe ser mayor a 0.');
      }

      let createdDebt = null;
      transaction((state) => {
        createdDebt = {
          id: makeId('debt'),
          code: nextDebtCode(state),
          description,
          personName,
          amountBs: toPositiveRoundedNumber(amountBs),
          paidBs: 0,
          balanceBs: toPositiveRoundedNumber(amountBs),
          debtDate,
          dueDate,
          debtKind,
          category,
          sourceMovementId,
          sourceMovementReceipt,
          status: 'pendiente',
          notes,
          createdAt: new Date().toISOString(),
          createdBy,
          paidAt: null,
          payments: [],
        };
        state.cashDebts.push(createdDebt);
        return state;
      });

      return createdDebt;
    },
    payDebt: async (payload) => {
      const debtId = String(payload?.debtId ?? payload?.id ?? '').trim();
      const amountBs = toNumber(payload?.amountBs ?? 0, 'monto de pago');
      const paymentDate = payload?.paymentDate ? new Date(payload.paymentDate).toISOString() : new Date().toISOString();
      const paymentMethod = String(payload?.paymentMethod ?? 'efectivo').trim() || 'efectivo';
      const notes = String(payload?.notes ?? '').trim();
      const paidBy = String(payload?.paidBy ?? payload?.createdBy ?? '').trim() || 'Contabilidad';
      let result = null;

      if (!debtId) {
        throw new Error('Debes seleccionar una deuda para pagar.');
      }
      if (amountBs <= 0) {
        throw new Error('El pago de deuda debe ser mayor a 0.');
      }

      transaction((state) => {
        const debt = state.cashDebts.find((entry) => entry.id === debtId);
        if (!debt) {
          throw new Error('No se encontro la deuda seleccionada.');
        }
        if (normalizeCashDebtKind(debt.debtKind ?? debt.category) !== 'payable') {
          throw new Error('Esta deuda es por cobrar/reembolsar y no se paga desde Caja Chica.');
        }
        if (String(debt.status ?? '').toLowerCase() === 'pagada' || Number(debt.balanceBs ?? 0) <= 0) {
          throw new Error('Esta deuda ya esta pagada.');
        }

        const activeSession = getActiveSession(state);
        if (!activeSession) {
          throw new Error('Debes abrir caja chica antes de pagar una deuda.');
        }
        const availablePettyCashBs = calculateSessionBalance(state, activeSession.id, CASH_BOX_TYPES.PETTY_CASH);
        const payableBs = Math.min(toPositiveRoundedNumber(amountBs), toPositiveRoundedNumber(debt.balanceBs));
        if (payableBs > availablePettyCashBs) {
          throw new Error(`Caja Chica no tiene saldo suficiente. Disponible: Bs ${availablePettyCashBs.toFixed(2)}.`);
        }

        const movement = buildCashMovement({
          sessionId: activeSession.id,
          type: 'egreso_pago_deuda',
          amountBs: -payableBs,
          description: `Pago deuda ${debt.code}: ${debt.description}`,
          sourceType: 'cash_debt',
          sourceId: debt.id,
          createdBy: paidBy,
          cashBoxType: CASH_BOX_TYPES.PETTY_CASH,
          category: 'pago_deuda',
          paymentMethod,
          responsible: debt.personName || paidBy,
          receipt: debt.code,
          receiptCode: nextCashReceiptCode(state),
          notes,
          accountingTag: 'petty_debt_payment',
        });
        const payment = {
          id: makeId('debtpay'),
          movementId: movement.id,
          amountBs: payableBs,
          paidAt: paymentDate,
          paidBy,
          notes,
        };
        debt.paidBs = toPositiveRoundedNumber(Number(debt.paidBs ?? 0) + payableBs);
        debt.balanceBs = toPositiveRoundedNumber(Math.max(0, Number(debt.amountBs ?? 0) - debt.paidBs));
        debt.status = debt.balanceBs <= 0 ? 'pagada' : 'parcial';
        debt.paidAt = debt.balanceBs <= 0 ? paymentDate : null;
        debt.payments = Array.isArray(debt.payments) ? [...debt.payments, payment] : [payment];
        state.cashMovements.push(movement);
        result = { debt: deepClone(debt), movement };
        return state;
      });

      return result;
    },
    deleteDebt: async (payload) => {
      const debtId = String(payload?.debtId ?? payload?.id ?? '').trim();
      if (!debtId) {
        throw new Error('Debes seleccionar una deuda para eliminar.');
      }
      let deletedDebt = null;
      transaction((state) => {
        const index = (state.cashDebts ?? []).findIndex((entry) => entry.id === debtId);
        if (index < 0) {
          throw new Error('No se encontro la deuda seleccionada.');
        }
        deletedDebt = state.cashDebts[index];
        state.cashDebts.splice(index, 1);
        return state;
      });
      return { deleted: true, debt: deepClone(deletedDebt) };
    },
    openSession: async (payload) => {
      const openingBigCashBs = toNumber(payload?.openingBigCashBs ?? payload?.openingAmountBs ?? 0, 'monto de apertura caja grande');
      const openingPettyCashBs = toNumber(payload?.openingPettyCashBs ?? 0, 'monto de apertura caja chica');
      const openedBy = String(payload?.openedBy ?? '').trim() || 'Admin';
      const notes = String(payload?.notes ?? '').trim();

      if (openingBigCashBs < 0 || openingPettyCashBs < 0) {
        throw new Error('El monto de apertura no puede ser negativo.');
      }

      let createdSession = null;
      const createdMovements = [];
      transaction((state) => {
        if (getActiveSession(state)) {
          throw new Error('Ya existe una caja abierta. Debes cerrarla antes de abrir otra.');
        }
        const availableBigCashBs = Number((calculateOperationalBigCashBalance(state) + openingBigCashBs).toFixed(2));
        if (openingPettyCashBs > availableBigCashBs) {
          throw new Error(`Caja Grande no tiene saldo suficiente para aperturar Caja Chica con Bs ${openingPettyCashBs.toFixed(2)}.`);
        }

        createdSession = {
          id: makeId('cash'),
          status: 'open',
          openingAmountBs: toPositiveRoundedNumber(openingBigCashBs + openingPettyCashBs),
          openingBigCashBs: toPositiveRoundedNumber(openingBigCashBs),
          openingPettyCashBs: toPositiveRoundedNumber(openingPettyCashBs),
          openedBy,
          openedAt: new Date().toISOString(),
          openNotes: notes,
          treasuryAccounts: normalizeTreasuryAccounts(payload?.treasuryAccounts),
          treasuryUpdatedAt: null,
          treasuryUpdatedBy: '',
        };

        state.cashSessions.push(createdSession);
        if (openingBigCashBs > 0) {
          const receiptCode = nextCashReceiptCode(state);
          const openingBigCashMovement = buildCashMovement({
            sessionId: createdSession.id,
            type: 'apertura',
            amountBs: openingBigCashBs,
            description: 'Apertura de caja grande',
            sourceType: 'caja',
            sourceId: createdSession.id,
            createdBy: openedBy,
            cashBoxType: CASH_BOX_TYPES.BIG_CASH,
            category: 'apertura',
            responsible: openedBy,
            receiptCode,
            notes,
          });
          state.cashMovements.push(openingBigCashMovement);
          createdMovements.push(openingBigCashMovement);
        }
        if (openingPettyCashBs > 0) {
          const transferGroupId = makeId('trf');
          const receiptCode = nextCashReceiptCode(state);
          const openingPettyOutputMovement = buildCashMovement({
            sessionId: createdSession.id,
            type: 'transferencia_salida_caja_chica',
            amountBs: -openingPettyCashBs,
            description: 'Apertura de caja chica desde Caja Grande',
            sourceType: 'transferencia',
            sourceId: transferGroupId,
            createdBy: openedBy,
            cashBoxType: CASH_BOX_TYPES.BIG_CASH,
            category: 'apertura_caja_chica',
            responsible: openedBy,
            receiptCode,
            notes,
            isInternalTransfer: true,
            transferGroupId,
          });
          const openingPettyInputMovement = buildCashMovement({
            sessionId: createdSession.id,
            type: 'apertura',
            amountBs: openingPettyCashBs,
            description: 'Apertura de caja chica desde Caja Grande',
            sourceType: 'transferencia',
            sourceId: transferGroupId,
            createdBy: openedBy,
            cashBoxType: CASH_BOX_TYPES.PETTY_CASH,
            category: 'apertura_caja_chica',
            responsible: openedBy,
            receiptCode,
            notes,
            isInternalTransfer: true,
            transferGroupId,
          });
          state.cashMovements.push(openingPettyOutputMovement, openingPettyInputMovement);
          createdMovements.push(openingPettyOutputMovement, openingPettyInputMovement);
        }
        return state;
      });

      return {
        ...createdSession,
        movements: createdMovements.map((movement) => deepClone(movement)),
      };
    },
    closeSession: async (payload) => {
      const countedBigCashBs = toNumber(payload?.countedBigCashBs ?? payload?.countedAmountBs ?? 0, 'monto contado caja grande');
      const countedPettyCashBs = toNumber(payload?.countedPettyCashBs ?? 0, 'monto contado caja chica');
      const closedBy = String(payload?.closedBy ?? '').trim() || 'Admin';
      const notes = String(payload?.notes ?? '').trim();

      if (countedBigCashBs < 0 || countedPettyCashBs < 0) {
        throw new Error('El monto de cierre no puede ser negativo.');
      }

      let closedSession = null;
      transaction((state) => {
        const activeSession = getActiveSession(state);
        if (!activeSession) {
          throw new Error('No existe una caja abierta para cerrar.');
        }

        const expectedBigCashBs = calculateCashBoxBalance(state, CASH_BOX_TYPES.BIG_CASH);
        const expectedPettyCashBs = calculateSessionBalance(state, activeSession.id, CASH_BOX_TYPES.PETTY_CASH);
        const expectedAmountBs = Number((expectedBigCashBs + expectedPettyCashBs).toFixed(2));
        const countedAmountBs = Number((countedBigCashBs + countedPettyCashBs).toFixed(2));
        const differenceBs = Number((countedAmountBs - expectedAmountBs).toFixed(2));
        const differenceBigCashBs = Number((countedBigCashBs - expectedBigCashBs).toFixed(2));
        const differencePettyCashBs = Number((countedPettyCashBs - expectedPettyCashBs).toFixed(2));

        activeSession.status = 'closed';
        activeSession.closedAt = new Date().toISOString();
        activeSession.closedBy = closedBy;
        activeSession.countedAmountBs = toPositiveRoundedNumber(countedAmountBs);
        activeSession.expectedAmountBs = expectedAmountBs;
        activeSession.differenceBs = differenceBs;
        activeSession.countedBigCashBs = toPositiveRoundedNumber(countedBigCashBs);
        activeSession.countedPettyCashBs = toPositiveRoundedNumber(countedPettyCashBs);
        activeSession.expectedBigCashBs = expectedBigCashBs;
        activeSession.expectedPettyCashBs = expectedPettyCashBs;
        activeSession.differenceBigCashBs = differenceBigCashBs;
        activeSession.differencePettyCashBs = differencePettyCashBs;
        activeSession.closeNotes = notes;
        activeSession.returnedPettyCashBs = toPositiveRoundedNumber(countedPettyCashBs);

        state.cashMovements.push(
          buildCashMovement({
            sessionId: activeSession.id,
            type: 'cierre',
            amountBs: 0,
            description: `Cierre de caja | Grande ${expectedBigCashBs.toFixed(2)} / Chica ${expectedPettyCashBs.toFixed(2)}`,
            sourceType: 'caja',
            sourceId: activeSession.id,
            createdBy: closedBy,
            cashBoxType: CASH_BOX_TYPES.BIG_CASH,
            category: 'cierre',
            responsible: closedBy,
          }),
        );
        if (countedPettyCashBs > 0) {
          const transferGroupId = makeId('trf');
          state.cashMovements.push(
            buildCashMovement({
              sessionId: activeSession.id,
              type: 'devolucion_saldo_caja_chica',
              amountBs: -countedPettyCashBs,
              description: `Devolucion saldo caja chica a Caja Grande: ${notes || 'cierre diario'}`,
              sourceType: 'transferencia',
              sourceId: transferGroupId,
              createdBy: closedBy,
              cashBoxType: CASH_BOX_TYPES.PETTY_CASH,
              category: 'cierre_caja_chica',
              responsible: closedBy,
              isInternalTransfer: true,
              transferGroupId,
            }),
            buildCashMovement({
              sessionId: activeSession.id,
              type: 'devolucion_saldo_caja_chica',
              amountBs: countedPettyCashBs,
              description: `Devolucion saldo caja chica a Caja Grande: ${notes || 'cierre diario'}`,
              sourceType: 'transferencia',
              sourceId: transferGroupId,
              createdBy: closedBy,
              cashBoxType: CASH_BOX_TYPES.BIG_CASH,
              category: 'cierre_caja_chica',
              responsible: closedBy,
              isInternalTransfer: true,
              transferGroupId,
            }),
          );
        }

        closedSession = deepClone(activeSession);
        return state;
      });

      return closedSession;
    },
    updateTreasuryAccounts: async (payload) => {
      const updatedBy = String(payload?.updatedBy ?? '').trim() || 'Contabilidad';
      const accounts = normalizeTreasuryAccounts(payload?.accounts);
      let updatedSession = null;

      transaction((state) => {
        const activeSession = getActiveSession(state);
        if (!activeSession) {
          throw new Error('Debes abrir caja antes de distribuir la caja grande.');
        }

        activeSession.treasuryAccounts = accounts.map((account) => ({
          ...account,
          updatedAt: new Date().toISOString(),
        }));
        activeSession.treasuryUpdatedAt = new Date().toISOString();
        activeSession.treasuryUpdatedBy = updatedBy;
        updatedSession = deepClone(activeSession);
        return state;
      });

      return updatedSession;
    },
    createManualMovement: async (payload) => {
      const movementType = String(payload?.type ?? '').trim();
      const amountRaw = toNumber(payload?.amountBs ?? 0, 'monto');
      const description = String(payload?.description ?? '').trim();
      const createdBy = String(payload?.createdBy ?? '').trim() || 'Admin';
      const category = String(payload?.category ?? '').trim();
      const paymentMethod = String(payload?.paymentMethod ?? '').trim();
      const paymentAccount = normalizePaymentMethod(paymentMethod) === 'qr' ? normalizeQrPaymentAccount(payload?.paymentAccount) : '';
      const responsible = String(payload?.responsible ?? createdBy).trim() || createdBy;
      const receipt = String(payload?.receipt ?? '').trim();
      const notes = String(payload?.notes ?? '').trim();
      const linkedRentalId = String(payload?.linkedRentalId ?? '').trim() || null;
      const linkedContractId = String(payload?.linkedContractId ?? '').trim() || null;
      const linkedOrderCode = String(payload?.linkedOrderCode ?? '').trim() || null;
      const accountingTag = String(payload?.accountingTag ?? '').trim();
      const transportExpenseBs = Math.max(0, Number(payload?.transportExpenseBs ?? 0));
      const cashBoxType = inferCashBoxType({ movementType, category, cashBoxType: payload?.cashBoxType });
      const isPettyCashRepositionIncome = movementType === 'ingreso'
        && cashBoxType === CASH_BOX_TYPES.PETTY_CASH
        && normalizeCashCategory(category) === 'reposicion_caja_chica';

      if (!['ingreso', 'egreso', 'transferencia'].includes(movementType)) {
        throw new Error('Tipo de movimiento invalido. Usa ingreso, egreso o transferencia.');
      }
      if (amountRaw <= 0) {
        throw new Error('El monto del movimiento debe ser mayor a 0.');
      }
      if (!description) {
        throw new Error('Debes escribir una descripcion para el movimiento.');
      }

      let createdMovement = null;
      transaction((state) => {
        let activeSession = getActiveSession(state);
        if (!activeSession && (movementType === 'transferencia' || isPettyCashRepositionIncome)) {
          activeSession = {
            id: makeId('cash'),
            status: 'open',
            openingAmountBs: 0,
            openingBigCashBs: 0,
            openingPettyCashBs: 0,
            openedBy: createdBy,
            openedAt: new Date().toISOString(),
            openNotes: `Apertura automatica por reposicion a caja chica: ${description}`,
            treasuryAccounts: normalizeTreasuryAccounts([]),
            treasuryUpdatedAt: null,
            treasuryUpdatedBy: '',
          };
          state.cashSessions.push(activeSession);
        }
        const requiresPettySession = cashBoxType === CASH_BOX_TYPES.PETTY_CASH;
        if (requiresPettySession && !activeSession) {
          throw new Error('Debes abrir caja chica antes de registrar este movimiento.');
        }
        const isBigCashGuaranteeRefund = movementType === 'egreso'
          && cashBoxType === CASH_BOX_TYPES.BIG_CASH
          && (
            String(accountingTag ?? '') === 'guarantee_refund'
            || String(category ?? '').toLowerCase() === 'garantia_devuelta_manual'
          );
        if (movementType === 'egreso' && cashBoxType === CASH_BOX_TYPES.BIG_CASH && !isBigCashGuaranteeRefund) {
          throw new Error('Caja Grande no registra gastos directos. Transfiere fondos a Caja Chica y registra el egreso alli.');
        }
        const availableBigCashBs = calculateOperationalBigCashBalance(state);
        const availablePettyCashBs = activeSession
          ? calculateSessionBalance(state, activeSession.id, CASH_BOX_TYPES.PETTY_CASH)
          : 0;
        if (movementType === 'transferencia' && amountRaw > availableBigCashBs) {
          throw new Error(`Caja Grande no tiene saldo suficiente. Disponible: Bs ${availableBigCashBs.toFixed(2)}.`);
        }
        if (movementType === 'egreso' && cashBoxType === CASH_BOX_TYPES.PETTY_CASH && amountRaw > availablePettyCashBs) {
          throw new Error(`Caja Chica no tiene saldo suficiente. Disponible: Bs ${availablePettyCashBs.toFixed(2)}.`);
        }
        const sessionId = activeSession?.id ?? null;

        if (movementType === 'transferencia') {
          const transferGroupId = makeId('trf');
          const receiptCode = nextCashReceiptCode(state);
          const fromMovement = buildCashMovement({
            sessionId,
            type: 'transferencia_salida_caja_chica',
            amountBs: -amountRaw,
            description: `Reposicion caja chica: ${description}`,
            sourceType: 'transferencia',
            sourceId: transferGroupId,
            createdBy,
            cashBoxType: CASH_BOX_TYPES.BIG_CASH,
            category: category || 'reposicion_caja_chica',
            paymentMethod,
            paymentAccount,
            responsible,
            receipt,
            receiptCode,
            notes,
            linkedRentalId,
            linkedContractId,
            linkedOrderCode,
            accountingTag,
            transportExpenseBs,
            isInternalTransfer: true,
            transferGroupId,
          });
          const toMovement = buildCashMovement({
            sessionId,
            type: 'transferencia_entrada_caja_chica',
            amountBs: amountRaw,
            description: `Reposicion caja chica: ${description}`,
            sourceType: 'transferencia',
            sourceId: transferGroupId,
            createdBy,
            cashBoxType: CASH_BOX_TYPES.PETTY_CASH,
            category: category || 'reposicion_caja_chica',
            paymentMethod,
            paymentAccount,
            responsible,
            receipt,
            receiptCode,
            notes,
            linkedRentalId,
            linkedContractId,
            linkedOrderCode,
            accountingTag,
            transportExpenseBs,
            isInternalTransfer: true,
            transferGroupId,
          });
          state.cashMovements.push(fromMovement, toMovement);
          createdMovement = {
            transferGroupId,
            movements: [fromMovement, toMovement],
          };
        } else {
          const signedAmount = movementType === 'ingreso' ? amountRaw : -amountRaw;
          const receiptCode = nextCashReceiptCode(state);
          createdMovement = buildCashMovement({
            sessionId,
            type: movementType === 'ingreso' ? 'ingreso_manual' : 'egreso_manual',
            amountBs: signedAmount,
            description,
            sourceType: 'manual',
            sourceId: null,
            createdBy,
            cashBoxType,
            category,
            paymentMethod,
            paymentAccount,
            responsible,
            receipt,
            receiptCode,
            notes,
            linkedRentalId,
            linkedContractId,
            linkedOrderCode,
            accountingTag,
            transportExpenseBs: accountingTag === 'transport_expense' ? amountRaw : transportExpenseBs,
          });
          state.cashMovements.push(createdMovement);
        }
        return state;
      });

      return createdMovement;
    },
    voidAndReplaceMovementReceipt: async (payload) => {
      const movementId = String(payload?.movementId ?? payload?.id ?? '').trim();
      const reason = String(payload?.reason ?? payload?.voidReason ?? '').trim();
      const replacement = payload?.replacement ?? {};
      const createdBy = String(payload?.createdBy ?? replacement?.createdBy ?? '').trim() || 'Contabilidad';
      const amountRaw = toNumber(replacement?.amountBs ?? 0, 'monto');
      const description = String(replacement?.description ?? '').trim();
      const category = String(replacement?.category ?? '').trim();
      const paymentMethod = String(replacement?.paymentMethod ?? '').trim();
      const paymentAccount = normalizePaymentMethod(paymentMethod) === 'qr' ? normalizeQrPaymentAccount(replacement?.paymentAccount) : '';
      const responsible = String(replacement?.responsible ?? createdBy).trim() || createdBy;
      const receipt = String(replacement?.receipt ?? '').trim();
      const notes = String(replacement?.notes ?? '').trim();
      const replacementLinkedRentalId = String(replacement?.linkedRentalId ?? '').trim() || null;
      const replacementLinkedContractId = String(replacement?.linkedContractId ?? '').trim() || null;
      const replacementLinkedOrderCode = String(replacement?.linkedOrderCode ?? '').trim() || null;
      const replacementAccountingTag = String(replacement?.accountingTag ?? '').trim();
      const replacementTransportExpenseBs = Math.max(0, Number(replacement?.transportExpenseBs ?? 0));
      const replacementTransportRevenueBs = Math.max(0, Number(replacement?.transportRevenueBs ?? 0));

      if (!movementId) {
        throw new Error('Debes indicar el movimiento a anular.');
      }
      if (!reason) {
        throw new Error('Debes indicar el motivo de anulacion.');
      }
      if (amountRaw <= 0) {
        throw new Error('El monto del nuevo recibo debe ser mayor a 0.');
      }
      if (!description) {
        throw new Error('Debes escribir el concepto del nuevo recibo.');
      }

      let result = null;
      transaction((state) => {
        const original = state.cashMovements.find((movement) => movement.id === movementId);
        if (!original) {
          throw new Error('No se encontro el movimiento de caja seleccionado.');
        }
        if (isVoidedCashMovement(original)) {
          throw new Error('Este recibo ya fue anulado.');
        }
        if (Number(original.amountBs ?? 0) === 0) {
          throw new Error('Este movimiento no tiene importe y no requiere recibo.');
        }

        const now = new Date().toISOString();
        const originalGroup = original.isInternalTransfer && original.transferGroupId
          ? state.cashMovements.filter((movement) => movement.transferGroupId === original.transferGroupId)
          : [original];
        const activeSession = getActiveSession(state);
        const sessionId = original.sessionId ?? activeSession?.id ?? null;
        const receiptCode = nextCashReceiptCode(state);

        originalGroup.forEach((movement) => {
          movement.receiptStatus = 'anulado';
          movement.voidedAt = now;
          movement.voidedBy = createdBy;
          movement.voidReason = reason;
        });

        if (original.isInternalTransfer) {
          const transferGroupId = makeId('trf');
          const fromMovement = buildCashMovement({
            sessionId,
            type: 'transferencia_salida_caja_chica',
            amountBs: -amountRaw,
            description: `Reposicion caja chica: ${description}`,
            sourceType: 'transferencia',
            sourceId: transferGroupId,
            createdBy,
            cashBoxType: CASH_BOX_TYPES.BIG_CASH,
            category: category || original.category || 'reposicion_caja_chica',
            paymentMethod,
            paymentAccount,
            responsible,
            receipt,
            receiptCode,
            notes,
            linkedRentalId: replacementLinkedRentalId ?? original.linkedRentalId,
            linkedContractId: replacementLinkedContractId ?? original.linkedContractId,
            linkedOrderCode: replacementLinkedOrderCode ?? original.linkedOrderCode,
            accountingTag: replacementAccountingTag || original.accountingTag,
            transportRevenueBs: replacementTransportRevenueBs || original.transportRevenueBs,
            transportExpenseBs: replacementTransportExpenseBs || original.transportExpenseBs,
            isInternalTransfer: true,
            transferGroupId,
            replacementOfMovementId: original.id,
          });
          const toMovement = buildCashMovement({
            sessionId,
            type: 'transferencia_entrada_caja_chica',
            amountBs: amountRaw,
            description: `Reposicion caja chica: ${description}`,
            sourceType: 'transferencia',
            sourceId: transferGroupId,
            createdBy,
            cashBoxType: CASH_BOX_TYPES.PETTY_CASH,
            category: category || original.category || 'reposicion_caja_chica',
            paymentMethod,
            paymentAccount,
            responsible,
            receipt,
            receiptCode,
            notes,
            linkedRentalId: replacementLinkedRentalId ?? original.linkedRentalId,
            linkedContractId: replacementLinkedContractId ?? original.linkedContractId,
            linkedOrderCode: replacementLinkedOrderCode ?? original.linkedOrderCode,
            accountingTag: replacementAccountingTag || original.accountingTag,
            transportRevenueBs: replacementTransportRevenueBs || original.transportRevenueBs,
            transportExpenseBs: replacementTransportExpenseBs || original.transportExpenseBs,
            isInternalTransfer: true,
            transferGroupId,
            replacementOfMovementId: original.id,
          });
          state.cashMovements.push(fromMovement, toMovement);
          originalGroup.forEach((movement) => {
            movement.replacedByMovementId = fromMovement.id;
          });
          result = { original, movements: [fromMovement, toMovement], replacement: fromMovement };
        } else {
          const originalAmount = Number(original.amountBs ?? 0);
          const signedAmount = originalAmount < 0 ? -amountRaw : amountRaw;
          const replacementMovement = buildCashMovement({
            sessionId,
            type: original.type || (signedAmount < 0 ? 'egreso_manual' : 'ingreso_manual'),
            amountBs: signedAmount,
            description,
            sourceType: original.sourceType ?? 'manual',
            sourceId: original.sourceId ?? null,
            createdBy,
            cashBoxType: original.cashBoxType,
            category: category || original.category,
            paymentMethod,
            paymentAccount,
            responsible,
            receipt,
            receiptCode,
            notes,
            linkedRentalId: replacementLinkedRentalId ?? original.linkedRentalId,
            linkedContractId: replacementLinkedContractId ?? original.linkedContractId,
            linkedOrderCode: replacementLinkedOrderCode ?? original.linkedOrderCode,
            accountingTag: replacementAccountingTag || original.accountingTag,
            transportRevenueBs: replacementTransportRevenueBs || original.transportRevenueBs,
            transportExpenseBs: replacementTransportExpenseBs || original.transportExpenseBs,
            isInternalTransfer: false,
            transferGroupId: null,
            replacementOfMovementId: original.id,
          });
          state.cashMovements.push(replacementMovement);
          original.replacedByMovementId = replacementMovement.id;
          result = { original, movement: replacementMovement, replacement: replacementMovement };
        }

        return state;
      });

      return result;
    },
    collectReceivable: async (payload) => {
      const rentalId = String(payload?.rentalId ?? '').trim();
      const amountRaw = toNumber(payload?.amountBs ?? 0, 'monto cobrado');
      const createdBy = String(payload?.createdBy ?? '').trim() || 'Contabilidad';
      const note = String(payload?.note ?? '').trim();
      const accountingTag = String(payload?.accountingTag ?? '').trim();
      const collectionTarget = ['rental', 'transport', 'damage', 'balance', 'mixed'].includes(String(payload?.collectionTarget ?? '').trim())
        ? String(payload.collectionTarget).trim()
        : 'balance';
      const collectionBreakdownPayload = Array.isArray(payload?.collectionBreakdown)
        ? payload.collectionBreakdown
          .map((entry) => {
            const target = String(entry?.target ?? '').trim();
            const amountBs = Math.max(0, Number(Number(entry?.amountBs ?? 0).toFixed(2)));
            return {
              target,
              amountBs,
              label: String(entry?.label ?? '').trim(),
              detail: String(entry?.detail ?? '').trim(),
              category: String(entry?.category ?? '').trim(),
              accountingTag: String(entry?.accountingTag ?? '').trim(),
            };
          })
          .filter((entry) => ['rental', 'transport', 'damage', 'balance'].includes(entry.target) && entry.amountBs > 0)
        : [];
      const collectionTargetsPayload = Array.isArray(payload?.collectionTargets)
        ? payload.collectionTargets.map((target) => String(target ?? '').trim()).filter((target) => ['rental', 'transport', 'damage', 'balance'].includes(target))
        : [];
      const receiptDetail = String(payload?.receiptDetail ?? '').trim();

      if (!rentalId) {
        throw new Error('No se pudo identificar la orden a cobrar.');
      }
      if (amountRaw <= 0) {
        throw new Error('El monto cobrado debe ser mayor a 0.');
      }

      let result = null;
      transaction((state) => {
        const activeSession = getActiveSession(state);

        const rental = state.rentals.find((entry) => entry.id === rentalId && !entry.deletedAt);
        if (!rental) {
          throw new Error('No se encontro la orden seleccionada.');
        }

        const isReturned = rental.status === 'returned';
        const settlement = rental.returnSettlement ?? {};
        const currentPending = isReturned
          ? Number(settlement.pendingCollectionBs ?? rental?.payment?.pendingPaymentBs ?? 0)
          : Number(rental?.payment?.pendingPaymentBs ?? rental?.totals?.pendingPaymentBs ?? 0);

        if (currentPending <= 0) {
          throw new Error('Esta orden no tiene saldo pendiente por cobrar.');
        }

        const amountBs = Number(amountRaw.toFixed(2));
        const remainingBs = Number(Math.max(0, currentPending - amountBs).toFixed(2));
        const overpaidNowBs = Number(Math.max(0, amountBs - currentPending).toFixed(2));
        const previousOverpaidBs = Number(rental?.payment?.overpaidBs ?? rental?.totals?.overpaidBs ?? 0);
        const previousPaidBs = Number(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs ?? 0);
        const deliveryFeeBs = !isReturned
          ? Math.max(0, Number(rental?.deliveryFeeBs ?? rental?.totals?.deliveryFeeBs ?? 0))
          : 0;
        const previousDeliveryFeeCollectedBs = Math.max(0, Number(rental?.payment?.deliveryFeeCollectedBs ?? rental?.totals?.deliveryFeeCollectedBs ?? 0));
        const remainingDeliveryFeeBs = Math.max(0, Number((deliveryFeeBs - previousDeliveryFeeCollectedBs).toFixed(2)));
        const collectionBreakdown = collectionBreakdownPayload.length
          ? collectionBreakdownPayload
          : [{ target: collectionTarget, amountBs, label: '', detail: '', category: '', accountingTag: '' }];
        const explicitTransportBs = collectionBreakdown
          .filter((entry) => entry.target === 'transport')
          .reduce((sum, entry) => sum + entry.amountBs, 0);
        const explicitDamageBs = collectionBreakdown
          .filter((entry) => entry.target === 'damage')
          .reduce((sum, entry) => sum + entry.amountBs, 0);
        const explicitRentalBs = collectionBreakdown
          .filter((entry) => entry.target === 'rental')
          .reduce((sum, entry) => sum + entry.amountBs, 0);
        const balanceBs = collectionBreakdown
          .filter((entry) => entry.target === 'balance')
          .reduce((sum, entry) => sum + entry.amountBs, 0);
        const balanceTransportBs = balanceBs > 0 ? Math.min(balanceBs, remainingDeliveryFeeBs) : 0;
        const transportCollectedNowBs = Number((explicitTransportBs + balanceTransportBs).toFixed(2));
        const damageCollectedNowBs = Number(explicitDamageBs.toFixed(2));
        const rentalCollectedNowBs = Number((explicitRentalBs + Math.max(0, balanceBs - balanceTransportBs)).toFixed(2));
        const now = new Date().toISOString();

        rental.payment = {
          ...(rental.payment ?? {}),
          paidAtRentalBs: Number((previousPaidBs + amountBs).toFixed(2)),
          pendingPaymentBs: remainingBs,
          overpaidBs: Number((previousOverpaidBs + overpaidNowBs).toFixed(2)),
          deliveryFeeCollectedBs: Number((previousDeliveryFeeCollectedBs + transportCollectedNowBs).toFixed(2)),
          rentalCollectedBs: Number((Number(rental?.payment?.rentalCollectedBs ?? rental?.totals?.rentalCollectedBs ?? 0) + rentalCollectedNowBs).toFixed(2)),
          damageCollectedBs: Number((Number(rental?.payment?.damageCollectedBs ?? rental?.totals?.damageCollectedBs ?? 0) + damageCollectedNowBs).toFixed(2)),
          status: remainingBs > 0
            ? 'saldo_pendiente'
            : isReturned
            ? 'cobrado_finalizado'
            : 'cancelado',
          mode: remainingBs > 0 ? 'a_cuenta' : 'cancelado',
          lastCollectionAt: now,
          lastCollectionBy: createdBy,
        };

        rental.totals = {
          ...(rental.totals ?? {}),
          paidAtRentalBs: rental.payment.paidAtRentalBs,
          pendingPaymentBs: remainingBs,
          overpaidBs: rental.payment.overpaidBs,
          deliveryFeeCollectedBs: rental.payment.deliveryFeeCollectedBs,
          rentalCollectedBs: rental.payment.rentalCollectedBs,
          damageCollectedBs: rental.payment.damageCollectedBs,
        };

        if (isReturned) {
          rental.returnSettlement = {
            ...settlement,
            pendingCollectionBs: remainingBs,
            collectedAfterReturnBs: Number((Number(settlement.collectedAfterReturnBs ?? 0) + amountBs).toFixed(2)),
            collectedAt: remainingBs === 0 ? now : settlement.collectedAt ?? null,
            collectedBy: remainingBs === 0 ? createdBy : settlement.collectedBy ?? null,
          };
          rental.accountingStatus = remainingBs === 0 ? 'cobrado_finalizado' : 'finalizado_pendiente_cobro';
          rental.finalizedAt = remainingBs === 0 ? now : rental.finalizedAt ?? null;
        } else {
          rental.accountingStatus = remainingBs === 0 ? 'cobrado' : 'saldo_pendiente';
        }

        rental.updatedAt = now;

        state.contracts.forEach((contract) => {
          if (contract.rentalId === rental.id || (contract.orderCode && contract.orderCode === rental.orderCode)) {
            contract.accountingStatus = rental.accountingStatus;
            contract.paymentStatus = rental.payment.status;
            contract.updatedAt = now;
          }
        });

        (state.serviceOrders ?? []).forEach((order) => {
          if (order.rentalId === rental.id || order.id === rental.id || order.codigo === rental.orderCode) {
            order.saldo_pendiente = remainingBs;
            order.estado = isReturned && remainingBs === 0
              ? 'cobrado_finalizado'
              : remainingBs === 0
              ? 'cobrada'
              : 'pendiente_cobro';
            order.updated_at = now;
          }
        });

        const sourceType = isReturned ? 'return' : 'rental';
        let movementType = isReturned ? 'cobro_saldo_devolucion' : 'cobro_saldo_alquiler';
        let defaultDescription = isReturned
          ? `Cobro saldo liquidacion: ${rental.customerName}`
          : `Cobro saldo alquiler: ${rental.customerName}`;
        let defaultCategory = isReturned ? 'cobro_liquidacion' : 'cobro_contrato';
        let defaultAccountingTag = '';

        if (collectionBreakdown.length > 1 || collectionTarget === 'mixed') {
          movementType = 'ingreso_cobro_mixto_contrato';
          defaultDescription = `Cobro mixto contrato: ${rental.customerName}`;
          defaultCategory = 'cobro_mixto_contrato';
          defaultAccountingTag = 'contract_mixed_collection';
        } else if (collectionTarget === 'transport') {
          movementType = 'ingreso_transporte_cliente';
          defaultDescription = `Transporte cobrado al cliente: ${rental.customerName}`;
          defaultCategory = 'transporte_cobrado';
          defaultAccountingTag = 'transport_revenue';
        } else if (collectionTarget === 'damage') {
          movementType = 'ingreso_danos_faltantes';
          defaultDescription = `Danos/faltantes cobrados al cliente: ${rental.customerName}`;
          defaultCategory = 'cobro_danos_faltantes';
          defaultAccountingTag = 'contract_damage_collection';
        }

        const description = note || defaultDescription;
        const movementDescription = receiptDetail
          ? receiptDetail.split('\n').filter(Boolean).slice(0, 2).join(' | ')
          : collectionTarget === 'balance' && transportCollectedNowBs > 0
          ? `${description} | Transporte incluido: Bs ${transportCollectedNowBs.toFixed(2)}`
          : description;
        const movementCategory = String(payload?.category ?? '').trim() || defaultCategory;
        const movementAccountingTag = accountingTag || defaultAccountingTag;
        const collectionTargets = collectionTargetsPayload.length
          ? collectionTargetsPayload
          : collectionBreakdown.map((entry) => entry.target).filter(Boolean);

        const receiptCode = nextCashReceiptCode(state);
        const commonMovementPayload = {
          sessionId: activeSession?.id ?? null,
          sourceType,
          sourceId: rental.id,
          createdBy,
          cashBoxType: CASH_BOX_TYPES.BIG_CASH,
          paymentMethod: String(payload?.paymentMethod ?? '').trim(),
          paymentAccount: normalizePaymentMethod(payload?.paymentMethod) === 'qr' ? normalizeQrPaymentAccount(payload?.paymentAccount) : '',
          responsible: createdBy,
          receipt: String(payload?.receipt ?? '').trim(),
          receiptCode,
          notes: note,
          linkedRentalId: rental.id,
          linkedContractId: rental.contractId,
          linkedOrderCode: rental.orderCode,
          collectionTarget,
          collectionTargets,
          collectionBreakdown,
          receiptDetail,
        };
        const createdMovements = [
          buildCashMovement({
            ...commonMovementPayload,
            type: movementType,
            amountBs,
            description: movementDescription,
            category: movementCategory,
            accountingTag: movementAccountingTag,
            transportRevenueBs: transportCollectedNowBs,
            damageCollectedBs: damageCollectedNowBs,
          }),
        ];
        state.cashMovements.push(...createdMovements);

        result = {
          rental: deepClone(rental),
          movement: deepClone(createdMovements[0]),
          movements: deepClone(createdMovements),
        };
        return state;
      });

      return result;
    },
    printHistoryReport: async (payload) => {
      const state = readState();
      const fromDate = parseDateRange(payload?.dateFrom, false);
      const toDate = parseDateRange(payload?.dateTo, true);
      const requestedCashBoxType = normalizeCashBoxType(payload?.cashBoxType, null);
      const requestedIds = new Set(
        (Array.isArray(payload?.movementIds) ? payload.movementIds : [])
          .map((id) => String(id ?? '').trim())
          .filter(Boolean),
      );
      const movements = state.cashMovements
        .filter((movement) => isInRange(movement.createdAt, fromDate, toDate))
        .filter((movement) => !requestedCashBoxType || normalizeCashBoxType(movement.cashBoxType) === requestedCashBoxType)
        .filter((movement) => requestedIds.size === 0 || requestedIds.has(String(movement.id)))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const title = String(payload?.title ?? '').trim()
        || (requestedCashBoxType === CASH_BOX_TYPES.PETTY_CASH ? 'Libro de Caja Chica' : 'Libro de Caja Grande');
      const cashBoxLabel = requestedCashBoxType === CASH_BOX_TYPES.PETTY_CASH ? 'Caja Chica' : 'Caja Grande';
      const validMovements = movements.filter((movement) => !isVoidedCashMovement(movement));
      const totalIncomeBs = validMovements.reduce(
        (sum, movement) => sum + Math.max(0, Number(movement.amountBs ?? 0)),
        0,
      );
      const totalExpenseBs = validMovements.reduce(
        (sum, movement) => sum + Math.abs(Math.min(0, Number(movement.amountBs ?? 0))),
        0,
      );
      const formatInputDate = (value) => {
        const [year, month, day] = String(value ?? '').split('-');
        return year && month && day ? `${day}/${month}/${year}` : String(value ?? '');
      };
      const periodLabel = fromDate || toDate
        ? `${payload?.dateFrom ? formatInputDate(payload.dateFrom) : 'Inicio'} al ${payload?.dateTo ? formatInputDate(payload.dateTo) : 'Hoy'}`
        : 'Historial completo';

      const rows = movements
        .map(
          (movement, index) => {
            const amountBs = Number(movement.amountBs ?? 0);
            const voided = isVoidedCashMovement(movement);
            const isGuarantee = String(movement.type ?? '').toLowerCase() === 'ingreso_garantia';
            const movementLabel = isGuarantee
              ? 'Garantia retenida'
              : movement.isInternalTransfer
              ? amountBs >= 0 ? 'Reposicion' : 'Transferencia'
              : amountBs >= 0 ? 'Ingreso' : 'Gasto';
            const reference = movement.receiptCode || movement.receipt || movement.linkedOrderCode || movement.sourceId || '-';
            return `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(formatDateTime(movement.createdAt))}</td>
              <td><span class="movement ${voided ? 'voided' : ''}">${escapeHtml(voided ? 'Anulado' : movementLabel)}</span></td>
              <td><strong>${escapeHtml(movement.description || '-')}</strong>${movement.notes ? `<small>${escapeHtml(movement.notes)}</small>` : ''}</td>
              <td>${escapeHtml(reference)}</td>
              <td class="money income">${!voided && amountBs > 0 ? formatBs(amountBs) : '-'}</td>
              <td class="money expense">${!voided && amountBs < 0 ? formatBs(Math.abs(amountBs)) : '-'}</td>
              <td>${escapeHtml(movement.responsible || movement.createdBy || '-')}</td>
            </tr>`;
          },
        )
        .join('');

      const html = `<!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(title)}</title>
            <style>
              @page { size: 216mm 330mm; margin: 10mm; }
              * { box-sizing: border-box; }
              body { font-family: Arial, sans-serif; margin: 0; color: #172033; font-size: 10px; }
              header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #f05a0b; padding-bottom: 8px; }
              .brand { display: flex; gap: 10px; align-items: center; }
              .brand-mark { width: 42px; height: 42px; border: 2px solid #f05a0b; border-radius: 50%; display: grid; place-items: center; color: #f05a0b; font-size: 20px; font-weight: 900; }
              h1 { margin: 0 0 3px; font-size: 20px; color: #101828; }
              header p, .meta p { margin: 2px 0; color: #667085; }
              .report-code { text-align: right; font-weight: 700; }
              .meta { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 8px; margin: 10px 0; }
              .meta article, .summary article { border: 1px solid #ead8cc; border-radius: 7px; padding: 7px 9px; background: #fffaf7; }
              .meta small, .summary small { display: block; color: #8a4b2a; font-weight: 700; text-transform: uppercase; margin-bottom: 3px; }
              .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
              .summary strong { font-size: 14px; }
              .income { color: #16834b; }
              .expense { color: #d94713; }
              table { width: 100%; border-collapse: collapse; table-layout: fixed; }
              th { background: #f05a0b; color: white; text-transform: uppercase; font-size: 8px; letter-spacing: .2px; }
              th, td { border: 1px solid #e4e7ec; text-align: left; padding: 5px 4px; vertical-align: top; }
              tbody tr:nth-child(even) { background: #fffaf7; }
              td small { display: block; margin-top: 2px; color: #667085; }
              .money { text-align: right; font-weight: 700; white-space: nowrap; }
              .movement { display: inline-block; border-radius: 10px; padding: 2px 5px; background: #eef4ff; color: #3157a4; font-weight: 700; }
              .movement.voided { background: #feecec; color: #b42318; }
              footer { display: flex; justify-content: space-between; margin-top: 12px; padding-top: 7px; border-top: 1px solid #f05a0b; color: #667085; }
              .actions { margin: 12px 0; text-align: right; }
              .actions button { border: 0; border-radius: 7px; background: #f05a0b; color: white; padding: 8px 14px; font-weight: 700; cursor: pointer; }
              @media print {
                .actions { display: none; }
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              }
            </style>
          </head>
          <body>
            <header>
              <div class="brand">
                <div class="brand-mark">EC</div>
                <div><h1>El Copetin</h1><p>Administrativo | Reporte contable</p></div>
              </div>
              <div class="report-code">${escapeHtml(title)}<p>Generado: ${escapeHtml(formatDateTime(new Date().toISOString()))}</p></div>
            </header>
            <section class="meta">
              <article><small>Libro contable</small><strong>${escapeHtml(cashBoxLabel)}</strong></article>
              <article><small>Periodo</small><strong>${escapeHtml(periodLabel)}</strong></article>
              <article><small>Movimientos</small><strong>${movements.length}</strong></article>
            </section>
            <section class="summary">
              <article><small>Ingresos / reposiciones</small><strong class="income">${formatBs(totalIncomeBs)}</strong></article>
              <article><small>Egresos / gastos</small><strong class="expense">${formatBs(totalExpenseBs)}</strong></article>
              <article><small>Movimiento neto</small><strong>${formatBs(totalIncomeBs - totalExpenseBs)}</strong></article>
              <article><small>Anulados</small><strong>${movements.filter(isVoidedCashMovement).length}</strong></article>
            </section>
            <table>
              <thead><tr><th style="width:4%">N.</th><th style="width:13%">Fecha</th><th style="width:10%">Movimiento</th><th style="width:26%">Concepto</th><th style="width:14%">Referencia</th><th style="width:10%">Ingreso</th><th style="width:10%">Egreso</th><th style="width:13%">Responsable</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="8">Sin movimientos en el periodo seleccionado.</td></tr>'}</tbody>
            </table>
            <footer><span>Documento generado por El Copetin Administrativo</span><span>${escapeHtml(cashBoxLabel)} | ${escapeHtml(periodLabel)}</span></footer>
            <div class="actions"><button type="button" onclick="window.print()">Imprimir / guardar PDF</button></div>
          </body>
        </html>`;

      return { ok: true, html };
    },
  },

  system: {
    verifyResetAccess: async (payload) => {
      const state = readState();
      const currentUser = assertDeveloperResetAccess(state, payload?.code);
      return {
        ok: true,
        user: sanitizeUserForSession(currentUser),
        modules: RESET_MODULES,
      };
    },
    analyzeReset: async (payload) => {
      const state = readState();
      assertDeveloperResetAccess(state, payload?.code);
      return analyzeSystemReset(state, payload?.modules);
    },
    executeReset: async (payload) => {
      const code = String(payload?.code ?? '').trim();
      const confirmation = String(payload?.confirmation ?? '').trim().toUpperCase();
      const selectedModules = Array.isArray(payload?.modules) ? payload.modules : [];
      if (!['CONFIRMAR', 'RESET'].includes(confirmation)) {
        throw new Error('Debes escribir CONFIRMAR o RESET para ejecutar el reset seleccionado.');
      }

      const preflightState = readState();
      const preflightUser = assertDeveloperResetAccess(preflightState, code);
      let response = null;
      try {
        transaction((state) => {
          const currentUser = assertDeveloperResetAccess(state, code);
          const analysis = analyzeSystemReset(state, selectedModules);
          if (!analysis.canExecute) {
            throw new Error('No hay registros seguros para eliminar con la seleccion actual.');
          }

          const deletedByCollection = applyResetAnalysis(state, analysis);
          const deletedTotal = Object.values(deletedByCollection).reduce((sum, value) => sum + Number(value ?? 0), 0);
          const resetLog = {
            id: makeId('rst'),
            userId: currentUser.id,
            userName: currentUser.fullName,
            userRole: getDisplayRoleForIds(getUserRoleIds(currentUser)),
            action: 'execute',
            modules: analysis.selectedModules,
            summary: {
              ...analysis.summary,
              deletedTotal,
              deletedByCollection,
            },
            result: analysis.summary.blocked > 0 ? 'partial' : 'success',
            errors: [],
            observations: String(payload?.observations ?? '').trim(),
            ip: String(payload?.ip ?? '').trim(),
            createdAt: new Date().toISOString(),
          };
          state.resetLogs = Array.isArray(state.resetLogs) ? state.resetLogs : [];
          state.resetLogs.unshift(resetLog);
          response = {
            ok: true,
            log: resetLog,
            analysis,
            deletedByCollection,
            deletedTotal,
          };
          return state;
        });
      } catch (error) {
        transaction((state) => {
          state.resetLogs = Array.isArray(state.resetLogs) ? state.resetLogs : [];
          state.resetLogs.unshift({
            id: makeId('rst'),
            userId: preflightUser.id,
            userName: preflightUser.fullName,
            userRole: getDisplayRoleForIds(getUserRoleIds(preflightUser)),
            action: 'execute',
            modules: selectedModules.map((moduleId) => String(moduleId ?? '').trim()).filter((moduleId) => RESET_MODULE_MAP.has(moduleId)),
            summary: { total: 0, deletable: 0, blocked: 0, critical: 0, deletedTotal: 0 },
            result: 'error',
            errors: [error.message || 'Error desconocido al ejecutar reset.'],
            observations: String(payload?.observations ?? '').trim(),
            ip: String(payload?.ip ?? '').trim(),
            createdAt: new Date().toISOString(),
          });
          return state;
        });
        throw error;
      }
      return response;
    },
    exportDatabase: async (payload) => {
      let backup = null;
      transaction((state) => {
        const currentUser = assertDeveloperResetAccess(state, payload?.code);
        const log = {
          id: makeId('rst'),
          userId: currentUser.id,
          userName: currentUser.fullName,
          userRole: getDisplayRoleForIds(getUserRoleIds(currentUser)),
          action: 'database_export',
          modules: ['database_backup'],
          summary: {
            ...countBackupRows(state),
            exportedCollections: DATABASE_BACKUP_COLLECTIONS.length,
          },
          result: 'success',
          errors: [],
          observations: String(payload?.observations ?? 'Descarga completa de base de datos.').trim(),
          ip: String(payload?.ip ?? '').trim(),
          createdAt: new Date().toISOString(),
        };
        state.resetLogs = Array.isArray(state.resetLogs) ? state.resetLogs : [];
        state.resetLogs.unshift(log);
        backup = buildDatabaseBackup({ state, currentUser, action: 'export' });
        return state;
      });
      return backup;
    },
    importDatabase: async (payload) => {
      const code = String(payload?.code ?? '').trim();
      const confirmation = String(payload?.confirmation ?? '').trim().toUpperCase();
      if (confirmation !== 'IMPORTAR') {
        throw new Error('Debes escribir IMPORTAR para reemplazar la base local.');
      }

      const preflightState = readState();
      const currentUser = assertDeveloperResetAccess(preflightState, code);
      const importedState = normalizeState(extractBackupState(payload?.backup ?? payload?.database ?? payload?.state ?? payload));
      const importedDevelopers = (importedState.users ?? []).filter((user) => !user.deletedAt && user.status === 'active' && isDeveloperUser(user));
      if (importedDevelopers.length === 0) {
        throw new Error('La base importada no tiene ningun usuario developer activo.');
      }

      const preservedLogs = [
        ...(Array.isArray(importedState.resetLogs) ? importedState.resetLogs : []),
        ...(Array.isArray(preflightState.resetLogs) ? preflightState.resetLogs : []),
      ];
      const uniqueLogs = [];
      const seenLogIds = new Set();
      preservedLogs.forEach((log) => {
        const id = String(log?.id ?? '').trim();
        if (id && seenLogIds.has(id)) return;
        if (id) seenLogIds.add(id);
        uniqueLogs.push(log);
      });

      const hasCurrentDeveloper = importedState.users.some((user) => user.id === currentUser.id && isDeveloperUser(user));
      if (!hasCurrentDeveloper) {
        importedState.users.push({
          ...deepClone(currentUser),
          status: 'active',
          deletedAt: null,
          isCurrentUser: true,
          updatedAt: new Date().toISOString(),
        });
      }
      importedState.users = importedState.users.map((user) => ({
        ...user,
        isCurrentUser: user.id === currentUser.id,
      }));

      const importLog = {
        id: makeId('rst'),
        userId: currentUser.id,
        userName: currentUser.fullName,
        userRole: getDisplayRoleForIds(getUserRoleIds(currentUser)),
        action: 'database_import',
        modules: ['database_backup'],
        summary: {
          ...countBackupRows(importedState),
          importedCollections: DATABASE_BACKUP_COLLECTIONS.length,
        },
        result: 'success',
        errors: [],
        observations: String(payload?.observations ?? 'Importacion completa de base de datos.').trim(),
        ip: String(payload?.ip ?? '').trim(),
        createdAt: new Date().toISOString(),
      };
      importedState.resetLogs = [importLog, ...uniqueLogs].slice(0, 500);
      writeState(importedState);

      return {
        ok: true,
        log: importLog,
        summary: importLog.summary,
        message: 'Base de datos importada correctamente.',
      };
    },
    listResetLogs: async () => {
      const state = readState();
      const currentUser = getCurrentSessionUser(state);
      if (!currentUser || !isDeveloperUser(currentUser)) {
        throw new Error('Solo el rol developer puede ver la auditoria de reset.');
      }
      return (state.resetLogs ?? []).slice(0, 50);
    },
    reset: async (payload) => {
      const state = readState();
      assertDeveloperResetAccess(state, payload?.code);
      throw new Error('El reset general fue deshabilitado. Usa el Panel de Reset del Sistema con analisis de impacto.');
    },
  },

  attendance: {
    listRecords: async () => {
      const { attendanceRecords } = readQueryState();
      return attendanceRecords.slice().sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
    },
    createRecord: async (payload) => {
      const type = String(payload?.type ?? '').trim();
      const location = String(payload?.location ?? '').trim();
      const reason = String(payload?.reason ?? '').trim();
      const userName = String(payload?.userName ?? payload?.createdBy ?? '').trim() || 'Usuario';
      const userId = String(payload?.userId ?? '').trim();
      const role = String(payload?.role ?? '').trim();
      const photoDataUrl = String(payload?.photoDataUrl ?? '').trim();
      const photoUrl = String(payload?.photoUrl ?? '').trim();
      const photoMimeType = String(payload?.photoMimeType ?? '').trim();
      const photoSizeBytes = Number(payload?.photoSizeBytes ?? 0) || 0;
      const photoWidth = payload?.photoWidth ?? null;
      const photoHeight = payload?.photoHeight ?? null;
      const latitude = payload?.latitude ?? null;
      const longitude = payload?.longitude ?? null;

      if (!['entrada', 'salida'].includes(type)) {
        throw new Error('Debes seleccionar si es entrada o salida.');
      }
      if (!location) {
        throw new Error('Debes registrar la ubicacion.');
      }
      if (!reason) {
        throw new Error('Debes indicar el motivo.');
      }
      if (!photoUrl && !photoDataUrl) {
        throw new Error('Debes tomar o subir una foto para respaldar la marca.');
      }

      let createdRecord = null;
      transaction((state) => {
        const capturedAt = new Date().toISOString();
        createdRecord = {
          id: makeId('att'),
          code: nextAttendanceCode(state),
          type,
          location,
          reason,
          photoDataUrl,
          photoUrl,
          photoMimeType,
          photoSizeBytes,
          photoWidth,
          photoHeight,
          latitude,
          longitude,
          capturedAt,
          createdAt: capturedAt,
          userId,
          userName,
          role,
          notes: String(payload?.notes ?? '').trim(),
        };
        state.attendanceRecords.push(createdRecord);
        return state;
      });

      return createdRecord;
    },
  },

  printer: {
    printRentalReceipt: async (payload) => {
      const rentalId = payload?.rentalId;
      if (!rentalId) {
        throw new Error('Debes indicar el alquiler para imprimir recibo.');
      }

      const state = readState();
      const rental = state.rentals.find((entry) => entry.id === rentalId);
      if (!rental) {
        throw new Error('No se encontro el alquiler para imprimir.');
      }

      openPrintWindow(buildRentalReceiptHtml(rental));
      return { ok: true };
    },
    printReturnReceipt: async (payload) => {
      const rentalId = payload?.rentalId;
      if (!rentalId) {
        throw new Error('Debes indicar la devolucion para imprimir recibo.');
      }

      const state = readState();
      const rental = state.rentals.find((entry) => entry.id === rentalId);
      if (!rental) {
        throw new Error('No se encontro la devolucion para imprimir.');
      }
      if (rental.status !== 'returned' || !Array.isArray(rental.returnReport)) {
        throw new Error('Este alquiler aun no tiene devolucion confirmada.');
      }

      openPrintWindow(buildReturnReceiptHtml(rental));
      return { ok: true };
    },
    printCashMovementReceipt: async (payload) => {
      const movementId = String(payload?.movementId ?? payload?.id ?? '').trim();
      const printedByName = String(payload?.printedByName ?? payload?.userName ?? payload?.createdByName ?? '').trim();
      if (!movementId) {
        throw new Error('Debes indicar el movimiento de caja para imprimir recibo.');
      }

      const state = readState();
      const payloadMovement = payload?.movement && typeof payload.movement === 'object'
        ? payload.movement
        : null;
      let receiptState = state;
      let movement = state.cashMovements.find((entry) => entry.id === movementId);
      if (!movement && payloadMovement && String(payloadMovement.id ?? '').trim() === movementId) {
        movement = payloadMovement;
        receiptState = {
          ...state,
          cashMovements: [...(Array.isArray(state.cashMovements) ? state.cashMovements : []), payloadMovement],
        };
      }
      if (!movement) {
        throw new Error('No se encontro el movimiento de caja para imprimir.');
      }
      if (Number(movement.amountBs ?? 0) === 0) {
        throw new Error('Este movimiento no tiene importe y no requiere recibo.');
      }
      if (isVoidedCashMovement(movement)) {
        throw new Error('Este recibo fue anulado. Usa el recibo de reemplazo.');
      }

      return {
        ok: true,
        title: `Recibo ${getCashReceiptCode(receiptState, movement)}`,
        html: buildCashReceiptHtml({ state: receiptState, movement, printedByName }),
      };
    },
    printContract: async (payload) => {
      const state = readQueryState();
      const payloadContract = payload?.fullContract && !payload.fullContract._summaryOnly
        ? payload.fullContract
        : null;
      const payloadRental = payload?.fullRental && !payload.fullRental._summaryOnly
        ? payload.fullRental
        : null;
      const contractId = String(payload?.contractId ?? '').trim();
      const contractCode = String(payload?.contractCode ?? '').trim();
      const contractById = payloadContract ?? (contractId || contractCode
        ? state.contracts.find(
          (entry) =>
            !entry.deletedAt
            && !entry._summaryOnly
            && (
              (contractId && entry.id === contractId)
              || (contractCode && entry.contractCode === contractCode)
            ),
        )
        : null);
      const linkedRental = payloadRental ?? resolveRentalForPrinting(state, payload);
      const rental = linkedRental ?? (contractById ? buildRentalSnapshotFromContract(contractById) : null);
      if (!rental) {
        throw new Error('No se encontro la orden o contrato completo para abrir el documento.');
      }
      const contract = contractById ?? resolveContractForRental(state, rental);
      if (!contract || contract._summaryOnly) {
        throw new Error('El contrato completo no esta disponible. No se genero el documento para proteger sus datos.');
      }
      const deliveries = resolveDeliveriesForRental(state, rental);
      const title = `Contrato ${contract?.contractCode ?? rental.orderCode ?? rental.id}`;
      return { ok: true, title, html: buildContractDocumentHtml({ rental, contract, deliveries, settings: state.settings, items: state.items }) };
    },
    printInventoryOrder: async (payload) => {
      const state = readState();
      const rental = resolveRentalForPrinting(state, payload);
      if (!rental) {
        throw new Error('No se encontro la orden para abrir documento de inventario.');
      }
      const deliveries = resolveDeliveriesForRental(state, rental);
      const title = `Orden inventario ${rental.orderCode ?? rental.id}`;
      return { ok: true, title, html: buildInventoryOrderHtml({ rental, deliveries, settings: state.settings }) };
    },
    printInventoryWeek: async (payload) => {
      const state = readQueryState();
      const requestedFormat = String(payload?.format ?? '').trim();
      const format = requestedFormat === 'individual' ? 'individual' : 'standard';
      const selectedRental = format === 'individual'
        ? payload?.fullRental && !payload.fullRental._summaryOnly
          ? payload.fullRental
          : resolveRentalForPrinting(state, payload)
        : null;
      const selectedContract = selectedRental ? resolveContractForRental(state, selectedRental) : null;
      const selectedDeliveries = selectedRental ? resolveDeliveriesForRental(state, selectedRental) : [];
      const rentalsForInventory = selectedRental
        && !state.rentals.some((rental) => (
          String(rental.id ?? '') === String(selectedRental.id ?? '')
          || (
            String(selectedRental.orderCode ?? '').trim()
            && String(rental.orderCode ?? '').trim() === String(selectedRental.orderCode).trim()
          )
        ))
        ? [...state.rentals, selectedRental]
        : state.rentals;
      const firstOutboundDelivery = selectedDeliveries.find((entry) => !isPickupDeliveryRecord(entry)) ?? selectedDeliveries[0] ?? null;
      const requestedStart = toDateKey(
        selectedContract?.deliveryDate
        ?? firstOutboundDelivery?.scheduledDate
        ?? selectedRental?.rentalDate
        ?? payload?.weekStart,
      );
      const baseDate = requestedStart ? new Date(`${requestedStart}T12:00:00`) : new Date();
      const day = baseDate.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      baseDate.setDate(baseDate.getDate() + mondayOffset);
      const weekStart = [
        baseDate.getFullYear(),
        String(baseDate.getMonth() + 1).padStart(2, '0'),
        String(baseDate.getDate()).padStart(2, '0'),
      ].join('-');
      const endDate = new Date(`${weekStart}T12:00:00`);
      endDate.setDate(endDate.getDate() + 6);
      const weekEnd = [
        endDate.getFullYear(),
        String(endDate.getMonth() + 1).padStart(2, '0'),
        String(endDate.getDate()).padStart(2, '0'),
      ].join('-');
      return {
        ok: true,
        title: `${format === 'individual' ? 'Inventario individual' : 'Control semanal de inventario'} ${weekStart}`,
        html: buildWeeklyInventoryHtml({
          rentals: rentalsForInventory,
          contracts: state.contracts,
          deliveries: state.deliveries,
          items: state.items,
          settings: state.settings,
          weekStart,
          weekEnd,
          format,
          targetRentalId: String(payload?.rentalId ?? '').trim(),
          targetOrderCode: String(payload?.orderCode ?? '').trim(),
          targetContractCode: String(payload?.contractCode ?? '').trim(),
        }),
      };
    },
    printRouteSheet: async (payload) => {
      const state = readState();
      const rental = resolveRentalForPrinting(state, payload);
      if (!rental) {
        throw new Error('No se encontro la orden para abrir hoja de ruta.');
      }
      const deliveries = resolveDeliveriesForRental(state, rental);
      const title = `Hoja de ruta ${rental.orderCode ?? rental.id}`;
      return {
        ok: true,
        title,
        html: buildRouteSheetHtml({
          rental,
          deliveries,
          drivers: state.drivers ?? [],
          vehicles: state.vehicles ?? [],
          settings: state.settings,
        }),
      };
    },
  },

  dashboard: {
    get: async () => {
      const state = readQueryState();
      const activeRentals = state.rentals.filter((rental) => rental.status === 'active' && !rental.deletedAt);
      const returnedRentals = state.rentals.filter((rental) => rental.status === 'returned' && !rental.deletedAt);

      const totalStock = state.items.reduce((sum, item) => sum + item.totalStock, 0);
      const availableStock = state.items.reduce((sum, item) => sum + item.availableStock, 0);
      const rentedStock = totalStock - availableStock;

      const guaranteeInBoxBs = activeRentals.reduce((sum, rental) => sum + (rental.depositBs ?? 0), 0);
      const activeRevenueBs = activeRentals.reduce((sum, rental) => sum + (rental.totals?.totalBs ?? 0), 0);
      const historicRevenueBs = returnedRentals.reduce((sum, rental) => sum + (rental.totals?.totalBs ?? 0), 0);
      const penaltiesBs = returnedRentals.reduce((sum, rental) => sum + (rental.penaltiesBs ?? 0), 0);

      return {
        cards: {
          activeRentals: activeRentals.length,
          returnedRentals: returnedRentals.length,
          totalItems: state.items.length,
          rentedStock,
        },
        money: {
          guaranteeInBoxBs,
          activeRevenueBs,
          historicRevenueBs,
          penaltiesBs,
        },
        itemsLowStock: state.items
          .filter((item) => item.totalStock > 0 && item.availableStock / item.totalStock <= 0.2)
          .sort((a, b) => a.availableStock - b.availableStock)
          .slice(0, 5),
        upcomingReturns: activeRentals
          .slice()
          .sort((a, b) => getDueTimestamp(a) - getDueTimestamp(b))
          .slice(0, 5),
      };
    },
  },

  __storage: {
    beginBatch: async (state) => {
      if (activeServerBatchState) {
        throw new Error('Ya existe una transaccion interna activa.');
      }
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new Error('El estado recibido para la transaccion no es valido.');
      }

      // updateStateSnapshot ya entrega una copia JSON aislada del estado persistido.
      // Volver a clonar y normalizar aqui recorria toda la base y consumia varios
      // segundos sin aportar aislamiento adicional.
      serverBatchRollbackState = inMemoryStateHydrated ? inMemoryState : null;
      activeServerBatchState = state;
      inMemoryState = activeServerBatchState;
      inMemoryStateHydrated = true;
      invalidateQueryStateSnapshot();
      return { ok: true };
    },
    commitBatch: async () => {
      if (!activeServerBatchState) {
        throw new Error('No existe una transaccion interna activa.');
      }

      // Las mutaciones del bridge ya operaron sobre la copia aislada de la
      // transaccion. fileStateStore vuelve a ejecutar las protecciones de
      // integridad, checksum y escritura antes de confirmar el cambio.
      const committed = activeServerBatchState;
      inMemoryState = committed;
      inMemoryStateHydrated = true;
      activeServerBatchState = null;
      serverBatchRollbackState = null;
      invalidateQueryStateSnapshot();
      return committed;
    },
    rollbackBatch: async () => {
      if (serverBatchRollbackState) {
        inMemoryState = serverBatchRollbackState;
        inMemoryStateHydrated = true;
      }
      activeServerBatchState = null;
      serverBatchRollbackState = null;
      invalidateQueryStateSnapshot();
      return { ok: true };
    },
    exportState: async () => deepClone(activeServerBatchState ?? readState()),
    exportCollections: async (names = []) => {
      const state = readState();
      const requestedNames = [...new Set((Array.isArray(names) ? names : [])
        .map((name) => String(name ?? '').trim())
        .filter(Boolean))];
      const snapshot = { settings: deepClone(state.settings ?? {}) };
      for (const name of requestedNames) {
        if (Object.prototype.hasOwnProperty.call(state, name)) {
          snapshot[name] = deepClone(state[name]);
        }
      }
      return snapshot;
    },
    replaceState: async (state) => {
      writeState(state);
      return { ok: true };
    },
    mergeState: async (partialState) => {
      ensureStateHydrated();
      if (!partialState || typeof partialState !== 'object' || Array.isArray(partialState)) {
        return { ok: false };
      }
      const mergedState = {
        ...inMemoryState,
        ...partialState,
      };
      writeState(mergedState);
      return { ok: true };
    },
  },
});

let webBridgeInstance = null;

export const getWebBridge = () => {
  if (!webBridgeInstance) {
    webBridgeInstance = createWebBridge();
  }
  return webBridgeInstance;
};

export const getWebRuntimeInfo = () => ({
  mode: 'web',
  storage: canUseLocalStorage() && !localStorageStateDisabled ? 'localStorage' : 'memory',
});
