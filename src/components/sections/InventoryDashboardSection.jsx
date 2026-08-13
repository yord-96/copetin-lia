import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { getProductImageSrc } from '../../utils/productImage';
import { getInventoryAreaLabel, INVENTORY_AREAS, resolveInventoryArea } from '../../utils/inventoryArea';
import ProductImage from '../common/ProductImage';
import { api } from '../../services/api';
import InventoryOpsSection from './InventoryOpsSection';

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

const expandSearchAliases = (value) => {
  const base = normalizeText(value);
  if (!base) return '';
  const aliases = new Set(base.split(' ').filter(Boolean));
  const compact = base.replace(/[^a-z0-9]+/g, '');
  if (compact.includes('crossback') || compact.includes('crosback')) {
    aliases.add('crossback');
    aliases.add('crosback');
    aliases.add('cruz');
  }
  if (compact.includes('infantil') || compact.includes('nino') || compact.includes('nina')) {
    aliases.add('infantil');
    aliases.add('nino');
    aliases.add('nina');
    aliases.add('kids');
  }
  return [base, ...aliases].join(' ');
};

const normalizeInventorySearchText = (value) =>
  expandSearchAliases(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const compactInventorySearchText = (value) => normalizeInventorySearchText(value).replace(/\s+/g, '');

const getInventorySearchTokens = (value) => normalizeInventorySearchText(value).split(' ').filter(Boolean);

const getComboIngredientSignature = (line) => {
  if (!line) return '';
  const optionIds = Array.isArray(line?.optionItemIds) && line.optionItemIds.length > 0
    ? line.optionItemIds
    : [line?.itemId];
  const optionKey = [...new Set(optionIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
    .sort()
    .join('|');
  const categoryKey = normalizeText(line?.categoryRule ?? line?.category ?? '');
  const labelKey = normalizeText(line?.slotLabel ?? line?.itemName ?? '');
  return [
    normalizeText(line?.selectionMode ?? 'item'),
    categoryKey,
    optionKey,
    categoryKey ? '' : labelKey,
  ].join('::');
};

const dedupeComboIngredientLines = (ingredients = []) => {
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

const getInventorySearchFields = (row) => [
  row?.name ?? row?.itemName,
  row?.category,
  row?.brand,
  row?.itemColor,
  row?.sku,
  row?.contractCode,
  row?.reference,
  row?.userName,
  row?.registeredByName,
  row?.reason,
  getInventoryAreaLabel(row?.resolvedInventoryArea ?? row?.inventoryArea),
  ...(row?.ingredients ?? []).flatMap((line) => [
    line?.itemName,
    line?.name,
    line?.category,
  ]),
];

const getInventorySearchScore = (searchValue, row) => {
  const query = normalizeInventorySearchText(searchValue);
  if (!query) return 1;

  const tokens = getInventorySearchTokens(searchValue);
  const fields = getInventorySearchFields(row).map(normalizeInventorySearchText).filter(Boolean);
  const combined = fields.join(' ');
  const compactCombined = compactInventorySearchText(fields.join(' '));
  const compactQuery = compactInventorySearchText(searchValue);

  if (!tokens.every((token) => combined.includes(token) || compactCombined.includes(token))) return -1;

  const primary = fields[0] ?? '';
  const compactPrimary = compactInventorySearchText(primary);
  if (primary === query) return 100;
  if (primary.startsWith(query)) return 92;
  if (primary.includes(query)) return 86;
  if (compactPrimary.includes(compactQuery)) return 82;
  if (tokens.every((token) => primary.includes(token) || compactPrimary.includes(token))) return 74;
  return 50 + tokens.filter((token) => primary.includes(token) || compactPrimary.includes(token)).length;
};

const isPickupDeliveryRecord = (delivery) => {
  const routeType = normalizeText(delivery?.routeType);
  const notes = normalizeText(delivery?.notes);
  return routeType === 'recojo'
    || notes.includes('recojo')
    || notes.includes('recog')
    || notes.includes('devolucion');
};

const getMondayDateKey = (value = new Date()) => {
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};

const addDaysToDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};

const getDateKey = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return [
    parsed.getFullYear(),
    String(parsed.getMonth() + 1).padStart(2, '0'),
    String(parsed.getDate()).padStart(2, '0'),
  ].join('-');
};

const getDateKeyDiffDays = (fromDateKey, toDateKey) => {
  if (!fromDateKey || !toDateKey) return null;
  const from = new Date(`${fromDateKey}T12:00:00`);
  const to = new Date(`${toDateKey}T12:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
};

const hasExplicitOperationalConfirmation = (rental) => {
  const operational = rental?.operational ?? {};
  return Boolean(
    operational.inventoryConfirmedByName
    || operational.inventoryDispatchedByName
    || operational.inventoryReturnedByName
    || operational.dispatchReview?.reviewedByName
    || operational.returnReview?.reviewedByName
    || rental?.returnedByName
  );
};

const getEffectiveInventoryStatus = (rental, operational = rental?.operational ?? {}) => {
  if (rental?.historicalReconstruction && !hasExplicitOperationalConfirmation(rental)) {
    return 'pendiente';
  }
  return operational?.inventoryStatus ?? 'pendiente';
};

const getInventoryUsageStatusMeta = (entry, todayKey = getDateKey(new Date())) => {
  const startKey = getDateKey(entry?.deliveryDate);
  const endKey = getDateKey(entry?.pickupDate);
  const inventoryStatus = normalizeText(entry?.inventoryStatus);
  const transportStatus = normalizeText(entry?.transportStatus);
  const daysToReturn = endKey ? getDateKeyDiffDays(todayKey, endKey) : null;

  if (endKey && endKey < todayKey) {
    return {
      key: 'overdue',
      label: 'Debe volver',
      tone: 'danger',
      returnText: daysToReturn === 0 ? 'Vuelve hoy' : `Atrasado ${Math.abs(daysToReturn)} dia(s)`,
    };
  }
  if (startKey && startKey > todayKey) {
    return {
      key: 'scheduled',
      label: 'Reservado',
      tone: 'planned',
      returnText: endKey ? `Vuelve ${endKey}` : 'Retorno pendiente',
    };
  }
  if (inventoryStatus === 'salio' || transportStatus === 'en_ruta') {
    return {
      key: 'out',
      label: 'Fuera de almacen',
      tone: 'warning',
      returnText: daysToReturn === 0 ? 'Debe volver hoy' : daysToReturn > 0 ? `Vuelve en ${daysToReturn} dia(s)` : 'Retorno pendiente',
    };
  }
  if (inventoryStatus === 'confirmado') {
    return {
      key: 'ready',
      label: 'Listo para salir',
      tone: 'info',
      returnText: endKey ? `Vuelve ${endKey}` : 'Retorno pendiente',
    };
  }
  return {
    key: 'reserved',
    label: 'Reservado',
    tone: 'neutral',
    returnText: endKey ? `Vuelve ${endKey}` : 'Retorno pendiente',
  };
};

const getCurrentWeekRange = () => {
  const from = getMondayDateKey(new Date());
  return { from, to: addDaysToDateKey(from, 6) };
};

const toCategoryClass = (category) => {
  const value = normalizeText(category);
  if (value.includes('silla')) return 'cat-violet';
  if (value.includes('mesa')) return 'cat-blue';
  if (value.includes('cristal')) return 'cat-lilac';
  if (value.includes('cubierto')) return 'cat-cyan';
  if (value.includes('mantel')) return 'cat-indigo';
  if (value.includes('vajilla')) return 'cat-green';
  if (value.includes('mobili')) return 'cat-orange';
  return 'cat-rose';
};

const DEFAULT_CATEGORY_COLOR = '#5d59e0';
const SIDEBAR_CATEGORY_LIMIT = 5;
const PRODUCT_FILTERS_STORAGE_KEY = 'copetin.inventory.productFilters';

const DEFAULT_PRODUCT_FILTERS = {
  query: '',
  page: 1,
  pageSize: 8,
  showFilters: false,
  categoryFilter: 'all',
  stockFilter: 'all',
  controlFilter: 'all',
  sortFilter: 'default',
};
const INVENTORY_MOVEMENT_RENDER_LIMIT = 650;

const INVENTORY_OPS_FILTERS_STORAGE_KEY = 'copetin.inventory.opsFilters';
const RETURN_CHARGE_OWNER_OPTIONS = [
  { value: 'cliente', label: 'Contrato / cliente' },
  { value: 'transporte', label: 'Mal manejo transporte' },
  { value: 'lavado', label: 'Lavado / post evento' },
];

const DISPATCH_REVIEW_OPTIONS = [
  { value: 'complete', label: 'Salio completo' },
  { value: 'partial', label: 'Salio parcial' },
  { value: 'pending_extra', label: 'Falta enviar material' },
];

const RETURN_REVIEW_OPTIONS = [
  { value: 'complete', label: 'Todo volvio al galpon' },
  { value: 'left_with_client', label: 'Material quedo con cliente' },
  { value: 'issues', label: 'Con danos o faltantes' },
];

const buildDispatchReviewForm = (row = null) => ({
  status: row?.dispatchReview?.status ?? 'complete',
  note: row?.dispatchReview?.note ?? '',
  items: (row?.rental?.items ?? []).map((line, index) => {
    const lineKey = String(line.lineKey ?? `${line.comboLineKey || 'item'}-${line.itemId || 'sin-item'}-${line.comboRuleIndex ?? index}-${index}`);
    const savedLine = (row?.dispatchReview?.items ?? []).find((entry) => (
      String(entry?.lineKey ?? '') === lineKey
      || (!entry?.lineKey && String(entry?.itemId ?? '') === String(line.itemId ?? ''))
    ));
    const expectedQty = Math.max(0, Math.trunc(Number(line.quantity ?? 0)));
    const dispatchedQty = Math.max(0, Math.min(expectedQty, Math.trunc(Number(savedLine?.dispatchedQty ?? expectedQty))));
    return {
      lineKey,
      itemId: line.itemId,
      itemName: line.itemName,
      expectedQty,
      dispatchedQty,
      pendingQty: Math.max(0, expectedQty - dispatchedQty),
      note: String(savedLine?.note ?? '').trim(),
    };
  }),
});

const readStoredProductFilters = () => {
  if (typeof window === 'undefined') return DEFAULT_PRODUCT_FILTERS;
  try {
    const rawValue = window.sessionStorage.getItem(PRODUCT_FILTERS_STORAGE_KEY);
    if (!rawValue) return DEFAULT_PRODUCT_FILTERS;
    const parsed = JSON.parse(rawValue);
    return {
      query: typeof parsed.query === 'string' ? parsed.query : DEFAULT_PRODUCT_FILTERS.query,
      page: Number.isFinite(Number(parsed.page)) && Number(parsed.page) > 0 ? Number(parsed.page) : DEFAULT_PRODUCT_FILTERS.page,
      pageSize: Number.isFinite(Number(parsed.pageSize)) && Number(parsed.pageSize) > 0 ? Number(parsed.pageSize) : DEFAULT_PRODUCT_FILTERS.pageSize,
      showFilters: Boolean(parsed.showFilters),
      categoryFilter: typeof parsed.categoryFilter === 'string' ? parsed.categoryFilter : DEFAULT_PRODUCT_FILTERS.categoryFilter,
      stockFilter: typeof parsed.stockFilter === 'string' ? parsed.stockFilter : DEFAULT_PRODUCT_FILTERS.stockFilter,
      controlFilter: typeof parsed.controlFilter === 'string' ? parsed.controlFilter : DEFAULT_PRODUCT_FILTERS.controlFilter,
      sortFilter: typeof parsed.sortFilter === 'string' ? parsed.sortFilter : DEFAULT_PRODUCT_FILTERS.sortFilter,
    };
  } catch {
    return DEFAULT_PRODUCT_FILTERS;
  }
};

const readStoredInventoryOpsFilters = () => {
  const weekRange = getCurrentWeekRange();
  const defaults = {
    query: '',
    dateFrom: weekRange.from,
    dateTo: weekRange.to,
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const rawValue = window.sessionStorage.getItem(INVENTORY_OPS_FILTERS_STORAGE_KEY);
    if (!rawValue) return defaults;
    const parsed = JSON.parse(rawValue);
    return {
      query: typeof parsed.query === 'string' ? parsed.query : defaults.query,
      dateFrom: typeof parsed.dateFrom === 'string' ? parsed.dateFrom : defaults.dateFrom,
      dateTo: typeof parsed.dateTo === 'string' ? parsed.dateTo : defaults.dateTo,
    };
  } catch {
    return defaults;
  }
};

const writeStoredProductFilters = (filters) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PRODUCT_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // El filtro es comodidad de UI; si el navegador no permite guardarlo, el sistema sigue funcionando.
  }
};

const writeStoredInventoryOpsFilters = (filters) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(INVENTORY_OPS_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Persistencia de comodidad; si falla, la operacion principal no se afecta.
  }
};

const CATEGORY_ICON_OPTIONS = [
  { value: 'box', label: 'Caja' },
  { value: 'chair', label: 'Silla' },
  { value: 'table', label: 'Mesa' },
  { value: 'plate', label: 'Vajilla' },
  { value: 'fabric', label: 'Mantel' },
  { value: 'star', label: 'Decoracion' },
  { value: 'light', label: 'Iluminacion' },
];

const normalizeHexColor = (value, fallback = DEFAULT_CATEGORY_COLOR) => {
  const text = String(value ?? '').trim();
  const shortHex = /^#([0-9a-fA-F]{3})$/;
  const longHex = /^#([0-9a-fA-F]{6})$/;
  if (shortHex.test(text)) {
    const [, shortValue] = shortHex.exec(text);
    return `#${shortValue[0]}${shortValue[0]}${shortValue[1]}${shortValue[1]}${shortValue[2]}${shortValue[2]}`.toUpperCase();
  }
  if (longHex.test(text)) {
    return text.toUpperCase();
  }
  return fallback;
};

const withHexAlpha = (color, alpha) => {
  const safe = normalizeHexColor(color, DEFAULT_CATEGORY_COLOR);
  return `${safe}${alpha}`;
};

const csvEscape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const downloadCsv = (name, lines) => {
  const csv = `${lines.join('\n')}\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const downloadBlob = (name, blob) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const getExcelImageExtension = (dataUrl) => {
  const match = /^data:image\/(png|jpe?g);base64,/i.exec(String(dataUrl ?? ''));
  if (!match) return null;
  return match[1].toLowerCase() === 'png' ? 'png' : 'jpeg';
};

const resolveExcelImageDataUrl = async (source) => {
  if (!source) return null;
  if (String(source).startsWith('data:image/')) return source;
  const response = await fetch(source);
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(blob);
  });
};

const exportProductsWorkbook = async ({ rows, filters }) => {
  const excelModule = await import('exceljs');
  const ExcelJS = excelModule.default ?? excelModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'El Copetin';
  workbook.company = 'Copetin SRL';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const sheet = workbook.addWorksheet('Productos', {
    properties: { defaultRowHeight: 18 },
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    views: [{ state: 'frozen', ySplit: 6, xSplit: 2 }],
  });

  sheet.mergeCells('A1:L1');
  sheet.getCell('A1').value = 'EL COPETIN - REPORTE DE INVENTARIO';
  sheet.getCell('A1').font = { name: 'Calibri', size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D2433' } };
  sheet.getRow(1).height = 34;

  sheet.mergeCells('A2:L2');
  sheet.getCell('A2').value = 'Listado profesional de productos y disponibilidad';
  sheet.getCell('A2').font = { name: 'Calibri', size: 12, italic: true, color: { argb: 'FF596579' } };
  sheet.getRow(2).height = 23;

  sheet.mergeCells('A3:D3');
  sheet.getCell('A3').value = `Generado: ${new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date())}`;
  sheet.mergeCells('E3:L3');
  sheet.getCell('E3').value = `Filtros: ${filters}`;
  ['A3', 'E3'].forEach((cellAddress) => {
    const cell = sheet.getCell(cellAddress);
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF39465C' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6F9' } };
  });
  sheet.getRow(3).height = 28;

  sheet.mergeCells('A4:L4');
  sheet.getCell('A4').value = `${rows.length} producto${rows.length === 1 ? '' : 's'} en este reporte`;
  sheet.getCell('A4').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFE84A00' } };
  sheet.getCell('A4').alignment = { vertical: 'middle', horizontal: 'right' };

  const headerRowNumber = 6;
  const headers = [
    'Imagen',
    'Producto',
    'Categoria',
    'Marca / material',
    'Color / descripcion',
    'Codigo',
    'Disponible',
    'Reservado',
    'Mantenimiento',
    'Stock total',
    'Precio alquiler (Bs)',
    'Estado',
  ];
  const headerRow = sheet.getRow(headerRowNumber);
  headerRow.values = headers;
  headerRow.height = 27;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE84A00' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD63E00' } },
      left: { style: 'thin', color: { argb: 'FFF2A27E' } },
      bottom: { style: 'thin', color: { argb: 'FFD63E00' } },
      right: { style: 'thin', color: { argb: 'FFF2A27E' } },
    };
  });

  sheet.columns = [
    { key: 'image', width: 11 },
    { key: 'name', width: 38 },
    { key: 'category', width: 18 },
    { key: 'brand', width: 20 },
    { key: 'color', width: 24 },
    { key: 'sku', width: 15 },
    { key: 'available', width: 12 },
    { key: 'reserved', width: 12 },
    { key: 'maintenance', width: 15 },
    { key: 'total', width: 12 },
    { key: 'price', width: 18 },
    { key: 'status', width: 17 },
  ];

  rows.forEach((row, index) => {
    const rowNumber = headerRowNumber + index + 1;
    const status = !row.controlsStock
      ? 'Por validar'
      : row.lowAvailability
      ? 'Stock bajo'
      : 'Disponible';
    const excelRow = sheet.getRow(rowNumber);
    excelRow.values = [
      getProductImageSrc(row) ? '' : 'Sin imagen',
      row.name,
      row.category || '-',
      row.brand || '-',
      row.itemColor || '-',
      row.sku,
      row.available,
      row.reserved,
      row.maintenance,
      row.total,
      row.price,
      status,
    ];
    excelRow.height = 58;

    excelRow.eachCell((cell, columnNumber) => {
      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF253047' } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: columnNumber >= 7 && columnNumber <= 11 ? 'center' : 'left',
        wrapText: true,
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : 'FFFFFAF7' },
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE4E8EF' } },
        right: { style: 'thin', color: { argb: 'FFF0F2F5' } },
      };
    });

    excelRow.getCell(1).font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF8A94A6' } };
    excelRow.getCell(2).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF17213D' } };
    excelRow.getCell(7).numFmt = '0';
    excelRow.getCell(8).numFmt = '0';
    excelRow.getCell(9).numFmt = '0';
    excelRow.getCell(10).numFmt = '0';
    excelRow.getCell(11).numFmt = '"Bs" #,##0.00';
    excelRow.getCell(12).font = {
      name: 'Calibri',
      size: 9,
      bold: true,
      color: { argb: status === 'Disponible' ? 'FF137548' : status === 'Stock bajo' ? 'FFC2420A' : 'FF9B5A20' },
    };

  });

  await Promise.all(rows.map(async (row, index) => {
    try {
      const imageDataUrl = await resolveExcelImageDataUrl(getProductImageSrc(row));
      const extension = getExcelImageExtension(imageDataUrl);
      if (!extension) return;
      const imageId = workbook.addImage({ base64: imageDataUrl, extension });
      sheet.addImage(imageId, {
        tl: { col: 0.18, row: headerRowNumber + index + 0.12 },
        ext: { width: 58, height: 58 },
        editAs: 'oneCell',
      });
    } catch {
      // La exportacion continua aunque una imagen puntual no este disponible.
    }
  }));

  const totalRowNumber = headerRowNumber + rows.length + 1;
  const totalRow = sheet.getRow(totalRowNumber);
  totalRow.values = ['', 'TOTALES', '', '', '', '', '', '', '', '', '', ''];
  totalRow.height = 26;
  totalRow.getCell(7).value = { formula: `SUM(G${headerRowNumber + 1}:G${totalRowNumber - 1})` };
  totalRow.getCell(8).value = { formula: `SUM(H${headerRowNumber + 1}:H${totalRowNumber - 1})` };
  totalRow.getCell(9).value = { formula: `SUM(I${headerRowNumber + 1}:I${totalRowNumber - 1})` };
  totalRow.getCell(10).value = { formula: `SUM(J${headerRowNumber + 1}:J${totalRowNumber - 1})` };
  totalRow.eachCell((cell, columnNumber) => {
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF273148' } };
    cell.alignment = { vertical: 'middle', horizontal: columnNumber >= 7 ? 'center' : 'left' };
  });

  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 2 },
    to: { row: totalRowNumber - 1, column: 12 },
  };
  sheet.pageSetup.printTitlesRow = '1:6';
  sheet.pageSetup.printArea = `A1:L${totalRowNumber}`;
  sheet.headerFooter.oddFooter = '&LEl Copetin - Inventario&C&P de &N&RDocumento interno';

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    `inventario-productos-${new Date().toISOString().slice(0, 10)}.xlsx`,
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
};

const buildPremiumCatalogHtml = ({ rows }) => {
  const areaMeta = {
    vajilla: {
      title: 'Cristaleria y Vajilla',
      subtitle: 'Piezas para mesa, bar, servicio y montaje fino.',
      accent: '#0ea5e9',
      soft: '#e8f7ff',
    },
    manteleria: {
      title: 'Manteleria',
      subtitle: 'Textiles, caminos, fundas y acabados para vestir el evento.',
      accent: '#8b5cf6',
      soft: '#f3efff',
    },
    mobiliario: {
      title: 'Mobiliario',
      subtitle: 'Mesas, sillas, lounges, estructuras y apoyo operativo.',
      accent: '#16a34a',
      soft: '#ecfdf3',
    },
  };
  const groups = INVENTORY_AREAS.map((area) => ({
    id: area.id,
    ...(areaMeta[area.id] ?? { title: getInventoryAreaLabel(area.id), subtitle: '', accent: '#e65300', soft: '#fff4ec' }),
    rows: rows
      .filter((row) => resolveInventoryArea(row) === area.id)
      .slice()
      .sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? ''), 'es')),
  })).filter((group) => group.rows.length > 0);
  const productCards = (group) => group.rows.map((row) => {
    const imageSrc = getProductImageSrc(row);
    const detail = [row.brand, row.itemColor].map((value) => String(value ?? '').trim()).filter(Boolean).join(' - ');
    return `
      <article class="product-card">
        <div class="product-image${imageSrc ? ' has-image' : ' is-empty'}">
          ${imageSrc ? `
            <img class="product-image-backdrop" src="${escapeHtml(imageSrc)}" alt="" aria-hidden="true">
            <img class="product-image-main" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(row.name)}">
          ` : '<span><b>EL COPETIN</b><small>IMAGEN PENDIENTE</small></span>'}
        </div>
        <div class="product-copy">
          <small>${escapeHtml(row.category || group.title)}</small>
          <h3>${escapeHtml(row.name)}</h3>
          <p>${escapeHtml(detail || 'Disponible para eventos')}</p>
        </div>
        <footer>
          <span>${Number(row.total ?? 0)} u.</span>
        </footer>
      </article>
    `;
  }).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Catalogo El Copetin</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;background:#f2ede6;color:#102044;font-family:"Inter","Segoe UI",Arial,sans-serif}
    .catalog{max-width:1180px;margin:0 auto;background:#fffaf4;min-height:100vh}
    .actions{position:sticky;top:0;z-index:5;display:flex;justify-content:flex-end;gap:10px;padding:12px 16px;background:rgba(255,255,255,.95);border-bottom:1px solid #eadfd3}
    .actions button{border:0;border-radius:10px;background:#e65300;color:#fff;padding:10px 14px;font-weight:900;cursor:pointer}
    .hero{height:508px;background:#050505 url("/imagenes/catalogo-hero-eventos.png") top center/cover no-repeat;border-bottom:1px solid #d85a00}
    .section{padding:34px 42px 42px;page-break-inside:avoid}
    .section+.section{border-top:1px solid #eadfd3}
    .section-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:18px}
    .kicker{display:inline-flex;border-radius:999px;padding:7px 11px;color:var(--accent);background:var(--soft);font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
    .section h2{margin:10px 0 5px;font-size:30px;letter-spacing:-.01em}
    .section p{margin:0;color:#697386;font-size:14px}
    .section-count{color:var(--accent);font-size:28px;font-weight:950}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
    .product-card{min-height:450px;border:1px solid #eadfd3;border-radius:12px;overflow:hidden;background:#fff;display:grid;grid-template-rows:310px 1fr auto;break-inside:avoid;box-shadow:0 10px 24px rgba(16,32,68,.06)}
    .product-image{position:relative;display:grid;place-items:center;overflow:hidden;background:#f7f3ee;border-bottom:1px solid #f1e5db;isolation:isolate}
    .product-image.has-image::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.2));z-index:-1}
    .product-image-backdrop{position:absolute;inset:-18px;width:calc(100% + 36px);height:calc(100% + 36px);object-fit:cover;filter:blur(18px) saturate(.8);opacity:.2;transform:scale(1.08);z-index:-2}
    .product-image-main{position:relative;display:block;width:100%;height:100%;padding:12px;object-fit:contain;object-position:center;z-index:1}
    .product-image.is-empty{background:linear-gradient(145deg,#fffaf4,#f7efe7)}
    .product-image span{display:grid;place-items:center;gap:7px;color:#d64a00;text-align:center}
    .product-image span b{font-size:13px;font-weight:950;letter-spacing:.14em}
    .product-image span small{color:#9a7765;font-size:9px;font-weight:850;letter-spacing:.1em}
    .product-copy{padding:14px 15px 4px}
    .product-copy small{color:var(--accent);font-size:11px;font-weight:900;text-transform:uppercase}
    .product-copy h3{margin:6px 0;color:#102044;font-size:18px;line-height:1.12}
    .product-copy p{color:#697386;font-size:12px;line-height:1.35}
    .product-card footer{padding:12px 15px 14px;display:flex;align-items:center;justify-content:flex-start;gap:12px}
    .product-card footer span{border-radius:999px;background:#f3f4f6;padding:7px 10px;color:#4b5563;font-size:12px;font-weight:900}
    .foot{padding:28px 42px 38px;color:#697386;font-size:12px;border-top:1px solid #eadfd3}
    @media print{body{background:#fff}.catalog{max-width:none}.actions{display:none}.hero{height:calc((100vw - 20mm) * .43);min-height:310px;max-height:500px;background-size:cover;background-position:top center}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.section{padding:24px 24px 30px}.product-card{min-height:445px;grid-template-rows:305px 1fr auto;box-shadow:none}.product-image-main{padding:8px}.product-image-backdrop{opacity:.12;filter:blur(14px)}@page{size:A4;margin:10mm}}
  </style>
</head>
<body>
  <main class="catalog">
    <div class="actions"><button type="button" onclick="window.print()">Imprimir / guardar PDF</button></div>
    <section class="hero" aria-label="Catalogo de alquiler para eventos"></section>
    ${groups.map((group) => `
      <section class="section" style="--accent:${group.accent};--soft:${group.soft}">
        <header class="section-head">
          <div><span class="kicker">${escapeHtml(group.title)}</span><h2>${escapeHtml(group.title)}</h2><p>${escapeHtml(group.subtitle)}</p></div>
          <strong class="section-count">${group.rows.length}</strong>
        </header>
        <div class="grid">${productCards(group)}</div>
      </section>
    `).join('')}
    <footer class="foot">El Copetin - Catalogo referencial para clientes. Las cantidades y disponibilidad se validan al confirmar el contrato.</footer>
  </main>
</body>
</html>`;
};

const getDateRangeLabel = (dateFrom, dateTo) => {
  if (!dateFrom && !dateTo) return 'Todo el periodo';
  const fromText = dateFrom || '...';
  const toText = dateTo || '...';
  return `${fromText} - ${toText}`;
};

const isBetweenDates = (value, dateFrom, dateTo) => {
  const current = new Date(value).getTime();
  if (!Number.isFinite(current)) return false;
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
  const to = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;
  if (from !== null && current < from) return false;
  if (to !== null && current > to) return false;
  return true;
};

const yieldToBrowser = () => new Promise((resolve) => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
    return;
  }
  setTimeout(resolve, 0);
});

const parseInventoryCsv = (text, allowedCategories) => {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('El archivo CSV debe incluir cabecera y al menos una fila.');
  }

  const delimiter = lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const headers = lines[0]
    .split(delimiter)
    .map((value) => normalizeText(value).replaceAll(' ', '_'));

  const categoriesByNormalized = new Map(
    allowedCategories.map((name) => [normalizeText(name), name]),
  );

  const parsedRows = [];
  for (const line of lines.slice(1)) {
    const values = line.split(delimiter).map((value) => String(value ?? '').trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });

    const name =
      row.nombre
      || row.producto
      || row.name
      || '';
    const categoryRaw =
      row.categoria
      || row.category
      || '';
    const brand =
      row.marca
      || row.brand
      || '';
    const itemColor =
      row.color_o_descripcion
      || row.color_descripcion
      || row.descripcion_color
      || row.color
      || row.description
      || '';
    const totalStockRaw =
      row.stock_total
      || row.stock
      || row.total
      || '';
    const rentalPriceRaw =
      row.precio_alquiler
      || row.precio
      || row.rental_price
      || '0';
    const damagedRaw =
      row.cargo_danio
      || row.cargo_dano
      || row.danio
      || row.dano
      || '';
    const missingRaw =
      row.cargo_perdida
      || row.perdida
      || '';
    const sku =
      row.codigo
      || row.code
      || row.sku
      || '';

    const normalizedCategory = categoriesByNormalized.get(normalizeText(categoryRaw));
    const totalStock = Number(totalStockRaw);
    const rentalPriceBs = Number(rentalPriceRaw);
    if (!name || !normalizedCategory || !Number.isFinite(totalStock) || totalStock <= 0) {
      continue;
    }

    const safePrice = Number.isFinite(rentalPriceBs) && rentalPriceBs >= 0 ? rentalPriceBs : 0;
    const damagedUnitChargeBs = Number.isFinite(Number(damagedRaw))
      ? Number(damagedRaw)
      : Number((safePrice * 1.2).toFixed(2));
    const missingUnitChargeBs = Number.isFinite(Number(missingRaw))
      ? Number(missingRaw)
      : Number((safePrice * 2).toFixed(2));

    parsedRows.push({
      name: name.trim(),
      sku: String(sku ?? '').trim(),
      category: normalizedCategory,
      brand: String(brand ?? '').trim(),
      itemColor: String(itemColor ?? '').trim(),
      totalStock: Math.trunc(totalStock),
      rentalPriceBs: Number(safePrice.toFixed(2)),
      damagedUnitChargeBs: Number(Math.max(0, damagedUnitChargeBs).toFixed(2)),
      missingUnitChargeBs: Number(Math.max(0, missingUnitChargeBs).toFixed(2)),
      needsCleaningOnReturn: normalizeText(normalizedCategory).includes('mantel'),
    });
  }

  if (parsedRows.length === 0) {
    throw new Error('No se encontraron filas validas para importar.');
  }

  return parsedRows;
};

function CategoryIcon({ category, iconKey, className = '' }) {
  const icon = normalizeText(iconKey);
  if (icon === 'chair') {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M8 12h8v6H8zM9 6h6v6H9zM8 18v2M16 18v2" />
      </svg>
    );
  }
  if (icon === 'table') {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M4 10h16v4H4zM7 14v5M17 14v5" />
      </svg>
    );
  }
  if (icon === 'plate') {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (icon === 'fabric') {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M6 8h12v10H6zM9 6h6M8 4h8" />
      </svg>
    );
  }
  if (icon === 'star') {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="m12 4.2 2.2 4.4 4.9.7-3.5 3.4.8 4.8L12 15.8l-4.4 2.3.8-4.8L4.9 9.3l4.9-.7L12 4.2Z" />
      </svg>
    );
  }
  if (icon === 'light') {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 3c-3.7 0-6.4 2-6.4 4.8 0 2.1 1.6 3.8 4.1 4.4v2.4h4.6v-2.4c2.5-.6 4.1-2.3 4.1-4.4C18.4 5 15.7 3 12 3Z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M10 18h4m-3 3h2" />
      </svg>
    );
  }
  if (icon === 'box') {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M6 6h12v12H6zM9 9h6v6H9z" />
      </svg>
    );
  }

  const value = normalizeText(category);
  if (value.includes('silla')) {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M8 12h8v6H8zM9 6h6v6H9zM8 18v2M16 18v2" />
      </svg>
    );
  }
  if (value.includes('mesa')) {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M4 10h16v4H4zM7 14v5M17 14v5" />
      </svg>
    );
  }
  if (value.includes('cristal')) {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M5 4h6l-1 6H6L5 4ZM13 4h6l-1 6h-4l-1-6ZM8 10v7m8-7v7M6 17h4M14 17h4" />
      </svg>
    );
  }
  if (value.includes('cubierto')) {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M7 4v6M5 4v6M9 4v6M7 10v10M16 4v20M14 4h4" />
      </svg>
    );
  }
  if (value.includes('mantel')) {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M6 8h12v10H6zM9 6h6M8 4h8" />
      </svg>
    );
  }
  if (value.includes('vajilla')) {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M6 6h12v12H6zM9 9h6v6H9z" />
    </svg>
  );
}

function ActivityIcon({ type }) {
  if (type === 'entrada') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 6v12M6 12h12" />
      </svg>
    );
  }
  if (type === 'salida') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 12h12" />
      </svg>
    );
  }
  if (type === 'ajuste') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="M14.5 6.5 17.5 9.5M8.8 17.2l-2.3.3.3-2.3 7-7a2.1 2.1 0 0 1 3 3l-8 8Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="M12 5 20 19H4L12 5Zm0 5v4m0 3h.01" />
    </svg>
  );
}

function KpiIcon({ kind }) {
  if (kind === 'box') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 3 20 7.2v9.6L12 21l-8-4.2V7.2L12 3Z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 3v8m0 0 8-3.8M12 11 4 7.2" />
      </svg>
    );
  }
  if (kind === 'check') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="m8 12 2.6 2.6L16 9.8" />
      </svg>
    );
  }
  if (kind === 'bag') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M6 7h12l-1 13H7L6 7Z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M9 7a3 3 0 0 1 6 0" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 3c-4.1 0-7 2.3-7 5.4 0 2.4 1.8 4.3 4.6 5v4.2h4.8v-4.2c2.8-.7 4.6-2.6 4.6-5C19 5.3 16.1 3 12 3Z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M12 7.5v4" />
    </svg>
  );
}

const EMPTY_PRODUCT_FORM = {
  id: '',
  name: '',
  sku: '',
  category: '',
  brand: '',
  itemColor: '',
  totalStock: '1',
  originalTotalStock: null,
  rentalPriceBs: '0',
  damagedUnitChargeBs: '0',
  missingUnitChargeBs: '0',
  needsCleaningOnReturn: false,
  imageUrl: null,
  imageDataUrl: null,
  imageFile: null,
  imagePreviewUrl: null,
  imageRemoved: false,
  imageFileName: '',
};

const EMPTY_COMBO_FORM = {
  id: '',
  name: '',
  category: 'COMBOS',
  rentalPriceBs: '0',
  pricingCondition: {
    enabled: false,
    upToQuantity: '3',
    upToUnitPriceBs: '0',
    aboveUnitPriceBs: '0',
  },
  notes: '',
  ingredients: [],
  priceIngredientSignature: '',
  imageUrl: null,
  imageDataUrl: null,
  imageFile: null,
  imagePreviewUrl: null,
  imageRemoved: false,
  imageFileName: '',
};

const EMPTY_MOVEMENT_FORM = {
  itemId: '',
  type: 'ajuste',
  quantity: '1',
  targetTotalStock: '',
  reason: '',
};

const EMPTY_CATEGORY_FORM = {
  id: '',
  name: '',
  icon: 'box',
  color: DEFAULT_CATEGORY_COLOR,
};

function InventoryDashboardSection({
  activeModule = 'inventario',
  items = [],
  combos = [],
  categories = [],
  contracts = [],
  activeRentals = [],
  cancelledRentals = [],
  deliveries = [],
  stockRecoveries = [],
  inventoryMovements = [],
  inventoryMovementStats = null,
  moduleLoading = false,
  formatBs,
  formatDateTime,
  onSwitchInventoryModule,
  onCreateInventoryItem,
  onUpdateInventoryItem,
  onUploadProductImage,
  onRemoveInventoryItem,
  onCreateInventoryCombo,
  onUpdateInventoryCombo,
  onRemoveInventoryCombo,
  onCreateInventoryMovement,
  onProcessStockRecovery,
  onCreateCategory,
  onUpdateCategory,
  onRemoveCategory,
  onReloadData,
  onOpenImage,
  onUpdateOrderOperational,
  onRemoveOrder,
  onReceiveReturnedOrder,
  onPrintContractDocument,
  onPrintInventoryWeekDocument,
  rentals = [],
}) {
  const initialProductFiltersRef = useRef(null);
  if (!initialProductFiltersRef.current) {
    initialProductFiltersRef.current = readStoredProductFilters();
  }
  const initialInventoryOpsFiltersRef = useRef(null);
  if (!initialInventoryOpsFiltersRef.current) {
    initialInventoryOpsFiltersRef.current = readStoredInventoryOpsFilters();
  }
  const [query, setQuery] = useState(initialProductFiltersRef.current.query);
  const [page, setPage] = useState(initialProductFiltersRef.current.page);
  const [pageSize, setPageSize] = useState(initialProductFiltersRef.current.pageSize);
  const [showFilters, setShowFilters] = useState(initialProductFiltersRef.current.showFilters);
  const [feedback, setFeedback] = useState('');
  const [feedbackType, setFeedbackType] = useState('ok');
  const [rowMenuOpenId, setRowMenuOpenId] = useState(null);
  const [rowMenuPosition, setRowMenuPosition] = useState(null);
  const [operationalReportRow, setOperationalReportRow] = useState(null);
  const [isLoadingOperationalReport, setIsLoadingOperationalReport] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState(initialProductFiltersRef.current.categoryFilter);
  const [stockFilter, setStockFilter] = useState(initialProductFiltersRef.current.stockFilter);
  const [controlFilter, setControlFilter] = useState(initialProductFiltersRef.current.controlFilter);
  const [sortFilter, setSortFilter] = useState(initialProductFiltersRef.current.sortFilter);
  const [productFilterMenu, setProductFilterMenu] = useState(null);
  const [movementTypeFilter, setMovementTypeFilter] = useState('all');
  const [movementUserFilter, setMovementUserFilter] = useState('all');
  const [adjustStatusFilter, setAdjustStatusFilter] = useState('all');
  const [categoryUsageFilter, setCategoryUsageFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [productModalMode, setProductModalMode] = useState(null);
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT_FORM);
  const [productError, setProductError] = useState('');
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [areaAssignment, setAreaAssignment] = useState(null);
  const [isSavingArea, setIsSavingArea] = useState(false);
  const [comboModalMode, setComboModalMode] = useState(null);
  const [comboForm, setComboForm] = useState(EMPTY_COMBO_FORM);
  const [comboError, setComboError] = useState('');
  const [isSavingCombo, setIsSavingCombo] = useState(false);
  const [comboIngredientQuery, setComboIngredientQuery] = useState('');
  const [comboRuleDraft, setComboRuleDraft] = useState({
    mode: 'items',
    label: '',
    quantity: '1',
    category: '',
    itemIds: [],
  });
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [movementForm, setMovementForm] = useState(EMPTY_MOVEMENT_FORM);
  const [movementError, setMovementError] = useState('');
  const [movementItemQuery, setMovementItemQuery] = useState('');
  const [categoryModalMode, setCategoryModalMode] = useState(null);
  const [showAllCategoriesModal, setShowAllCategoriesModal] = useState(false);
  const [categoryForm, setCategoryForm] = useState(EMPTY_CATEGORY_FORM);
  const [categoryError, setCategoryError] = useState('');
  const [detailRow, setDetailRow] = useState(null);
  const [valuationOpen, setValuationOpen] = useState(false);
  const [documentPreview, setDocumentPreview] = useState(null);
  const [operationalEditRow, setOperationalEditRow] = useState(null);
  const [operationalEditForm, setOperationalEditForm] = useState({
    inventoryStatus: 'pendiente',
    inventoryNote: '',
  });
  const [operationalEditError, setOperationalEditError] = useState('');
  const [isSavingOperationalEdit, setIsSavingOperationalEdit] = useState(false);
  const [inventoryOrderQuery, setInventoryOrderQuery] = useState(initialInventoryOpsFiltersRef.current.query);
  const [inventoryOperationDateFrom, setInventoryOperationDateFrom] = useState(initialInventoryOpsFiltersRef.current.dateFrom);
  const [inventoryOperationDateTo, setInventoryOperationDateTo] = useState(initialInventoryOpsFiltersRef.current.dateTo);
  const [showAllInventoryOrders, setShowAllInventoryOrders] = useState(false);
  const [operationalOverrides, setOperationalOverrides] = useState({});
  const [dispatchReviewModal, setDispatchReviewModal] = useState(null);
  const [dispatchReviewForm, setDispatchReviewForm] = useState(buildDispatchReviewForm);
  const [dispatchReviewError, setDispatchReviewError] = useState('');
  const [isSavingDispatchReview, setIsSavingDispatchReview] = useState(false);
  const [receivingModal, setReceivingModal] = useState(null);
  const [receivingError, setReceivingError] = useState('');
  const [isReceiving, setIsReceiving] = useState(false);
  const [returnProcessingMessage, setReturnProcessingMessage] = useState('');
  const deferredQuery = useDeferredValue(query);
  const deferredMovementItemQuery = useDeferredValue(movementItemQuery);

  const rowMenuRef = useRef(null);
  const productFilterRef = useRef(null);

  const getInventoryDocumentWeekStart = (dateValue = '') =>
    getMondayDateKey(dateValue || new Date());

  useEffect(() => () => {
    if (productForm.imageFile && productForm.imagePreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(productForm.imagePreviewUrl);
    }
  }, [productForm.imageFile, productForm.imagePreviewUrl]);

  const openInventoryWeekDocument = async (format = 'standard') => {
    try {
      const preview = await onPrintInventoryWeekDocument?.({
        weekStart: getInventoryDocumentWeekStart(inventoryOperationDateFrom || inventoryOperationDateTo),
        format,
      });
      if (preview?.html) {
        setDocumentPreview({
          title: preview.title ?? 'Control semanal de inventario',
          html: preview.html,
          format,
        });
      }
    } catch (error) {
      setFeedback(error.message || 'No se pudo abrir la hoja semanal de inventario.');
      setFeedbackType('error');
    }
  };

  const openInventorySingleOrderDocument = async (row) => {
    try {
      const operationDate = inventoryOperationDateFrom
        || inventoryOperationDateTo
        || row.deliveryDate
        || row.pickupDate;
      const preview = await onPrintInventoryWeekDocument?.({
        weekStart: getInventoryDocumentWeekStart(operationDate),
        format: 'individual',
        rentalId: row.rentalId,
        orderCode: row.orderCode,
        contractCode: row.contractCode,
      });
      if (preview?.html) {
        setDocumentPreview({
          title: preview.title ?? `Inventario ${row.contractCode}`,
          html: preview.html,
          format: 'individual',
        });
      }
    } catch (error) {
      setFeedback(error.message || 'No se pudo abrir la impresion individual.');
      setFeedbackType('error');
    }
  };

  const openContractDocument = async (row) => {
    try {
      const preview = await onPrintContractDocument?.({
        rentalId: row.rentalId,
        orderCode: row.orderCode,
        contractId: row.contractId,
        contractCode: row.contractCode,
      });
      if (preview?.html) {
        setDocumentPreview({
          title: preview.title ?? `Contrato ${row.contractCode}`,
          html: preview.html,
          format: 'contract',
        });
        return;
      }
      setFeedback('No se pudo generar la vista del contrato.');
      setFeedbackType('error');
    } catch (error) {
      setFeedback(error.message || 'No se pudo abrir el contrato.');
      setFeedbackType('error');
    }
  };

  const printInventoryPreview = () => {
    const frame = document.getElementById('inventory-document-preview-frame');
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  };
  const importInputRef = useRef(null);
  const productImageInputRef = useRef(null);
  const comboImageInputRef = useRef(null);

  const isProductsModule = activeModule === 'inventario_productos';
  const isCombosModule = activeModule === 'inventario_combos';
  const isCategoriesModule = activeModule === 'inventario_categorias';
  const isMovementsModule = activeModule === 'inventario_movimientos';
  const isMaintenanceModule = activeModule === 'inventario_mantenimiento';
  const isAdjustModule = activeModule === 'inventario_ajustes';
  const isOverviewModule = !isProductsModule && !isCombosModule && !isCategoriesModule && !isMovementsModule && !isMaintenanceModule && !isAdjustModule;

  const moduleViewClass = isMaintenanceModule
    ? 'inventory-view-maintenance'
    : isMovementsModule
    ? 'inventory-view-movements'
    : isAdjustModule
    ? 'inventory-view-adjust'
    : isCombosModule
    ? 'inventory-view-combos'
    : isCategoriesModule
    ? 'inventory-view-categories'
    : isProductsModule
    ? 'inventory-view-products'
    : '';

  const moduleTitle = isMaintenanceModule
    ? 'Lavado y Reparacion'
    : isProductsModule
    ? 'Productos'
    : isCombosModule
    ? 'Combos'
    : isCategoriesModule
    ? 'Categorias'
    : isMovementsModule
    ? 'Movimientos de Stock'
    : isAdjustModule
    ? 'Ajustes de Stock'
    : 'Inventario';

  const moduleSubtitle = isMaintenanceModule
    ? 'Revisa unidades pendientes y devuelve al stock solo las que ya estan listas'
    : isProductsModule
    ? 'Gestiona el catalogo de items alquilables'
    : isCombosModule
    ? 'Arma paquetes con productos existentes, precio propio y control de stock por ingrediente'
    : isCategoriesModule
    ? 'Administra categorias de inventario con icono, color y estado'
    : isMovementsModule
    ? 'Ordenes por alistar y trazabilidad de reservas, entradas, salidas y ajustes'
    : isAdjustModule
    ? 'Correcciones de stock segun conteo fisico'
    : 'Controla tu stock en tiempo real';

  useEffect(() => {
    if (isMovementsModule || isMaintenanceModule || isAdjustModule || isCategoriesModule || isCombosModule) return;
    writeStoredProductFilters({
      query,
      page,
      pageSize,
      showFilters,
      categoryFilter,
      stockFilter,
      controlFilter,
      sortFilter,
    });
  }, [
    query,
    page,
    pageSize,
    showFilters,
    categoryFilter,
    stockFilter,
    controlFilter,
    sortFilter,
    isMovementsModule,
    isMaintenanceModule,
    isAdjustModule,
    isCategoriesModule,
    isCombosModule,
  ]);

  useEffect(() => {
    if (!isMovementsModule) return;
    writeStoredInventoryOpsFilters({
      query: inventoryOrderQuery,
      dateFrom: inventoryOperationDateFrom,
      dateTo: inventoryOperationDateTo,
    });
  }, [
    inventoryOperationDateFrom,
    inventoryOperationDateTo,
    inventoryOrderQuery,
    isMovementsModule,
  ]);

  useEffect(() => {
    if (!rowMenuOpenId) return undefined;
    const closeOnOutside = (event) => {
      if (rowMenuRef.current && !rowMenuRef.current.contains(event.target)) {
        setRowMenuOpenId(null);
        setRowMenuPosition(null);
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [rowMenuOpenId]);

  useEffect(() => {
    if (!productFilterMenu) return undefined;
    const closeOnOutside = (event) => {
      if (productFilterRef.current && !productFilterRef.current.contains(event.target)) {
        setProductFilterMenu(null);
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [productFilterMenu]);

  const reservedByItem = useMemo(() => {
    const map = {};
    const todayKey = getDateKey(new Date());
    activeRentals.forEach((rental) => {
      const inventoryStatus = normalizeText(rental?.operational?.inventoryStatus ?? '');
      const startKey = getDateKey(rental?.rentalDate ?? rental?.deliveryDate);
      const endKey = getDateKey(rental?.dueDate ?? rental?.pickupDate ?? startKey);
      const affectsCurrentStock = inventoryStatus === 'salio'
        || Boolean(startKey && todayKey >= startKey && (!endKey || todayKey <= endKey));
      if (!affectsCurrentStock || inventoryStatus === 'devuelto' || inventoryStatus === 'anulado') return;
      (rental.items ?? []).forEach((line) => {
        if (line?.controlsStock === false || String(line?.verificationStatus ?? '').trim() === 'pending_verification') return;
        map[line.itemId] = (map[line.itemId] ?? 0) + Number(line.internalReservedQty ?? line.quantity ?? 0);
      });
    });
    return map;
  }, [activeRentals]);

  const itemUsageById = useMemo(() => {
    const usage = new Map();
    const contractById = new Map(contracts.map((contract) => [String(contract.id), contract]));
    const deliveriesByRental = new Map();
    deliveries
      .filter((delivery) => delivery?.rentalId)
      .forEach((delivery) => {
        const key = String(delivery.rentalId);
        const rows = deliveriesByRental.get(key) ?? [];
        rows.push(delivery);
        deliveriesByRental.set(key, rows);
      });
    activeRentals.forEach((rental) => {
      const contract = contractById.get(String(rental.contractId ?? ''));
      const linkedDeliveries = (deliveriesByRental.get(String(rental.id)) ?? []).slice()
        .sort((a, b) => String(a.scheduledDate ?? '').localeCompare(String(b.scheduledDate ?? '')));
      const deliveryOut = linkedDeliveries.find((entry) => !isPickupDeliveryRecord(entry)) ?? linkedDeliveries[0] ?? null;
      const deliveryBack = linkedDeliveries.find((entry) => isPickupDeliveryRecord(entry)) ?? linkedDeliveries[1] ?? null;
      (rental.items ?? []).forEach((line) => {
        if (line?.controlsStock === false || String(line?.verificationStatus ?? '').trim() === 'pending_verification') return;
        const quantity = Math.max(0, Number(line.internalReservedQty ?? line.quantity ?? 0));
        if (!line.itemId || quantity <= 0) return;
        const rows = usage.get(line.itemId) ?? [];
        const deliveryDate = contract?.deliveryDate ?? deliveryOut?.scheduledDate ?? rental.rentalDate ?? null;
        const pickupDate = contract?.pickupDate ?? deliveryBack?.scheduledDate ?? rental.dueDate ?? null;
        const deliveryWindowStart = contract?.deliveryWindowStart ?? deliveryOut?.windowStart ?? rental.deliveryWindowStart ?? '';
        const deliveryWindowEnd = contract?.deliveryWindowEnd ?? deliveryOut?.windowEnd ?? rental.deliveryWindowEnd ?? '';
        const pickupWindowStart = contract?.pickupWindowStart ?? deliveryBack?.windowStart ?? rental.pickupWindowStart ?? '';
        const pickupWindowEnd = contract?.pickupWindowEnd ?? deliveryBack?.windowEnd ?? rental.pickupWindowEnd ?? rental.dueTime ?? '';
        rows.push({
          rentalId: rental.id,
          orderCode: rental.orderCode ?? 'Orden sin codigo',
          contractCode: contract?.contractCode ?? rental.contractCode ?? 'Sin contrato',
          customerName: rental.customerName ?? contract?.customerName ?? 'Cliente',
          quantity,
          deliveryDate,
          pickupDate,
          deliveryWindowStart,
          deliveryWindowEnd,
          pickupWindowStart,
          pickupWindowEnd,
          address: contract?.address ?? deliveryOut?.address ?? deliveryBack?.address ?? rental.eventAddress ?? '',
          city: contract?.city ?? deliveryOut?.city ?? deliveryBack?.city ?? '',
          eventType: contract?.eventType ?? rental.eventType ?? '',
          inventoryStatus: rental.operational?.inventoryStatus ?? 'pendiente',
          transportStatus: rental.operational?.transportStatus ?? 'pendiente',
          inventoryNote: rental.operational?.inventoryNote ?? '',
          logisticsMode: contract?.logisticsMode ?? rental.logisticsMode ?? 'envio',
        });
        usage.set(line.itemId, rows);
      });
    });
    usage.forEach((rows, itemId) => {
      usage.set(itemId, rows.sort((a, b) => {
        const aEnd = getDateKey(a.pickupDate) || getDateKey(a.deliveryDate) || '9999-12-31';
        const bEnd = getDateKey(b.pickupDate) || getDateKey(b.deliveryDate) || '9999-12-31';
        if (aEnd !== bEnd) return aEnd.localeCompare(bEnd);
        return String(a.orderCode ?? '').localeCompare(String(b.orderCode ?? ''));
      }));
    });
    return usage;
  }, [activeRentals, contracts, deliveries]);

  const comboUsageById = useMemo(() => {
    const usage = new Map();
    const contractById = new Map(contracts.map((contract) => [String(contract.id), contract]));
    const deliveriesByRental = new Map();
    deliveries
      .filter((delivery) => delivery?.rentalId)
      .forEach((delivery) => {
        const key = String(delivery.rentalId);
        const rows = deliveriesByRental.get(key) ?? [];
        rows.push(delivery);
        deliveriesByRental.set(key, rows);
      });

    activeRentals.forEach((rental) => {
      const contract = contractById.get(String(rental.contractId ?? ''));
      const linkedDeliveries = (deliveriesByRental.get(String(rental.id)) ?? []).slice()
        .sort((a, b) => String(a.scheduledDate ?? '').localeCompare(String(b.scheduledDate ?? '')));
      const deliveryOut = linkedDeliveries.find((entry) => !isPickupDeliveryRecord(entry)) ?? linkedDeliveries[0] ?? null;
      const deliveryBack = linkedDeliveries.find((entry) => isPickupDeliveryRecord(entry)) ?? linkedDeliveries[1] ?? null;
      const comboGroups = new Map();

      (rental.items ?? []).forEach((line, index) => {
        if (line?.controlsStock === false || String(line?.verificationStatus ?? '').trim() === 'pending_verification') return;
        const comboId = String(line?.comboId ?? '').trim();
        if (!comboId) return;
        const groupKey = String(line?.comboLineKey ?? '').trim() || `${comboId}-${line?.comboName ?? ''}-${index}`;
        const current = comboGroups.get(groupKey) ?? {
          comboId,
          comboName: line?.comboName ?? 'Combo',
          quantity: 0,
          componentLines: 0,
          componentUnits: 0,
          price: 0,
        };
        const comboQuantity = Math.max(1, Math.trunc(Number(line?.comboQuantity ?? 1)));
        current.quantity = Math.max(current.quantity, comboQuantity);
        current.componentLines += 1;
        current.componentUnits += Math.max(0, Number(line?.internalReservedQty ?? line?.quantity ?? 0));
        if (line?.comboPricingRole === 'price') {
          current.price = Number(line?.lineTotalBs ?? line?.unitPriceBs ?? 0);
        }
        comboGroups.set(groupKey, current);
      });

      comboGroups.forEach((group, groupKey) => {
        const rows = usage.get(group.comboId) ?? [];
        const deliveryDate = contract?.deliveryDate ?? deliveryOut?.scheduledDate ?? rental.rentalDate ?? null;
        const pickupDate = contract?.pickupDate ?? deliveryBack?.scheduledDate ?? rental.dueDate ?? null;
        const deliveryWindowStart = contract?.deliveryWindowStart ?? deliveryOut?.windowStart ?? rental.deliveryWindowStart ?? '';
        const deliveryWindowEnd = contract?.deliveryWindowEnd ?? deliveryOut?.windowEnd ?? rental.deliveryWindowEnd ?? '';
        const pickupWindowStart = contract?.pickupWindowStart ?? deliveryBack?.windowStart ?? rental.pickupWindowStart ?? '';
        const pickupWindowEnd = contract?.pickupWindowEnd ?? deliveryBack?.windowEnd ?? rental.pickupWindowEnd ?? rental.dueTime ?? '';
        rows.push({
          usageKey: `${rental.id}-${groupKey}`,
          rentalId: rental.id,
          orderCode: rental.orderCode ?? 'Orden sin codigo',
          contractCode: contract?.contractCode ?? rental.contractCode ?? 'Sin contrato',
          customerName: rental.customerName ?? contract?.customerName ?? 'Cliente',
          quantity: group.quantity,
          componentLines: group.componentLines,
          componentUnits: group.componentUnits,
          price: group.price,
          comboName: group.comboName,
          deliveryDate,
          pickupDate,
          deliveryWindowStart,
          deliveryWindowEnd,
          pickupWindowStart,
          pickupWindowEnd,
          address: contract?.address ?? deliveryOut?.address ?? deliveryBack?.address ?? rental.eventAddress ?? '',
          city: contract?.city ?? deliveryOut?.city ?? deliveryBack?.city ?? '',
          eventType: contract?.eventType ?? rental.eventType ?? '',
          inventoryStatus: rental.operational?.inventoryStatus ?? 'pendiente',
          transportStatus: rental.operational?.transportStatus ?? 'pendiente',
          inventoryNote: rental.operational?.inventoryNote ?? '',
          logisticsMode: contract?.logisticsMode ?? rental.logisticsMode ?? 'envio',
        });
        usage.set(group.comboId, rows);
      });
    });

    usage.forEach((rows, comboId) => {
      usage.set(comboId, rows.sort((a, b) => {
        const aEnd = getDateKey(a.pickupDate) || getDateKey(a.deliveryDate) || '9999-12-31';
        const bEnd = getDateKey(b.pickupDate) || getDateKey(b.deliveryDate) || '9999-12-31';
        if (aEnd !== bEnd) return aEnd.localeCompare(bEnd);
        return String(a.orderCode ?? '').localeCompare(String(b.orderCode ?? ''));
      }));
    });
    return usage;
  }, [activeRentals, contracts, deliveries]);

  const maintenanceByItem = useMemo(() => {
    const map = {};
    stockRecoveries.forEach((entry) => {
      map[entry.itemId] = (map[entry.itemId] ?? 0) + Number(entry.quantity ?? 0);
    });
    return map;
  }, [stockRecoveries]);

  const operationalRentals = useMemo(() => {
    const source = Array.isArray(rentals) && rentals.length > 0 ? rentals : activeRentals;
    return source.filter((rental) => {
      const status = String(rental?.status ?? '').toLowerCase();
      return !rental?.deletedAt && status !== 'cancelled' && status !== 'anulado';
    });
  }, [activeRentals, rentals]);

  const prepOrderRows = useMemo(() => {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const contractById = new Map(contracts.map((contract) => [String(contract.id), contract]));
    const deliveryByRental = new Map();

    deliveries
      .filter((delivery) => delivery.rentalId)
      .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))
      .forEach((delivery) => {
        const key = String(delivery.rentalId);
        const list = deliveryByRental.get(key) ?? [];
        list.push(delivery);
        deliveryByRental.set(key, list);
      });

    const formatWindow = (start, end) => {
      const windowStart = String(start ?? '').trim();
      const windowEnd = String(end ?? '').trim();
      if (!windowStart && !windowEnd) return 'Sin horario';
      return `${windowStart || '--:--'} - ${windowEnd || '--:--'}`;
    };

    const getPriority = (dateValue, delivery) => {
      if (delivery?.status === 'incidencia' || delivery?.status === 'en_ruta') {
        return { key: 'alta', label: 'Alta', weight: 3 };
      }
      const deliveryTime = new Date(String(dateValue ?? '')).getTime();
      if (!Number.isFinite(deliveryTime)) return { key: 'media', label: 'Media', weight: 2 };
      const diffDays = Math.floor((deliveryTime - startOfToday) / (1000 * 60 * 60 * 24));
      if (diffDays <= 1) return { key: 'alta', label: 'Alta', weight: 3 };
      if (diffDays <= 3) return { key: 'media', label: 'Media', weight: 2 };
      return { key: 'baja', label: 'Baja', weight: 1 };
    };

    const getInventoryMeta = (status) => {
      if (status === 'devuelto') {
        return { sortWeight: 0, secondarySortWeight: 1, text: 'Devuelto', actionLabel: 'Devuelto', action: 'returned', canConfirm: false };
      }
      if (status === 'salio') {
        return { sortWeight: 0, secondarySortWeight: 0, text: 'Fuera de almacen', actionLabel: 'Marcar que volvio', action: 'return', canConfirm: true };
      }
      if (status === 'confirmado') {
        return { sortWeight: 1, secondarySortWeight: 0, text: 'Lista para salir', actionLabel: 'Marcar que salio', action: 'dispatch', canConfirm: true };
      }
      if (status === 'enviado') {
        return { sortWeight: 2, secondarySortWeight: 0, text: 'Asignada, pendiente de confirmar', actionLabel: 'Marcar lista', action: 'ready', canConfirm: true };
      }
      return { sortWeight: 3, secondarySortWeight: 0, text: 'Por alistar', actionLabel: 'Marcar lista', action: 'ready', canConfirm: true };
    };

    return operationalRentals
      .map((rental) => {
        const contract = contractById.get(String(rental.contractId ?? '')) ?? null;
        const linkedDeliveries = (deliveryByRental.get(String(rental.id)) ?? []).slice();
        const deliveryOut = linkedDeliveries.find((entry) => !isPickupDeliveryRecord(entry)) ?? linkedDeliveries[0] ?? null;
        const deliveryBack = linkedDeliveries.find((entry) => isPickupDeliveryRecord(entry)) ?? linkedDeliveries[1] ?? null;
        const logisticsMode = contract?.logisticsMode ?? rental.logisticsMode ?? 'envio';
        const deliveryLabel = logisticsMode === 'recojo' ? 'Alistamiento' : 'Entrega';
        const deliveryDate = contract?.deliveryDate ?? deliveryOut?.scheduledDate ?? rental.rentalDate ?? null;
        const deliveryWindowStart = contract?.deliveryWindowStart ?? deliveryOut?.windowStart ?? rental.deliveryWindowStart ?? '';
        const deliveryWindowEnd = contract?.deliveryWindowEnd ?? deliveryOut?.windowEnd ?? rental.deliveryWindowEnd ?? '';
        const pickupDate = contract?.pickupDate ?? deliveryBack?.scheduledDate ?? rental.dueDate ?? null;
        const pickupWindowStart = contract?.pickupWindowStart ?? deliveryBack?.windowStart ?? rental.pickupWindowStart ?? '';
        const pickupWindowEnd = contract?.pickupWindowEnd ?? deliveryBack?.windowEnd ?? rental.pickupWindowEnd ?? rental.dueTime ?? '';
        const operationDates = [deliveryDate, pickupDate]
          .map((value) => String(value ?? '').slice(0, 10))
          .filter(Boolean)
          .sort();
        const totalItems = (rental.items ?? []).reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
        const lines = (rental.items ?? []).length;
        const priority = getPriority(operationDates[0] ?? deliveryDate, deliveryOut ?? deliveryBack);
        const operational = {
          ...(rental.operational ?? {}),
          ...(operationalOverrides[String(rental.id)] ?? {}),
        };
        const inventoryStatus = getEffectiveInventoryStatus(rental, operational);
        const inventoryMeta = getInventoryMeta(inventoryStatus);
        const revisionAlert = operational.revisionAlert?.active ? operational.revisionAlert : null;
        const clientPendingPickup = operational.clientPendingPickup?.active ? operational.clientPendingPickup : null;
        const dispatchReview = operational.dispatchReview ?? null;
        const returnReview = operational.returnReview ?? null;
        return {
          id: rental.id,
          rental,
          rentalId: rental.id,
          contractId: contract?.id ?? rental.contractId ?? null,
          orderCode: rental.orderCode ?? rental.id,
          contractCode: contract?.contractCode ?? rental.contractCode ?? rental.orderCode ?? rental.id,
          customerName: contract?.customerName ?? rental.customerName,
          address: contract?.address ?? deliveryOut?.address ?? deliveryBack?.address ?? rental.eventAddress ?? 'Direccion pendiente',
          itemsText: `${totalItems} unidades · ${lines} items`,
          deliveryLabel,
          deliveryDate,
          deliveryWindow: formatWindow(deliveryWindowStart, deliveryWindowEnd),
          pickupDate,
          pickupWindow: formatWindow(pickupWindowStart, pickupWindowEnd),
          operationSortDate: operationDates[0] ?? null,
          priority,
          inventoryStatus,
          inventoryStatusText: inventoryMeta.text,
          inventoryActionLabel: inventoryMeta.actionLabel,
          inventoryAction: inventoryMeta.action,
          canConfirmInventory: inventoryMeta.canConfirm,
          inventorySortWeight: inventoryMeta.sortWeight,
          inventorySecondarySortWeight: inventoryMeta.secondarySortWeight,
          inventoryNote: operational.inventoryNote ?? '',
          inventoryConfirmedAt: operational.inventoryConfirmedAt ?? null,
          inventoryConfirmedByName: operational.inventoryConfirmedByName ?? null,
          inventoryDispatchedAt: operational.inventoryDispatchedAt ?? null,
          inventoryDispatchedByName: operational.inventoryDispatchedByName ?? null,
          inventoryReturnedAt: operational.inventoryReturnedAt ?? null,
          inventoryReturnedByName: operational.inventoryReturnedByName ?? null,
          dispatchReview,
          returnReview,
          revisionAlert,
          clientPendingPickup,
          hasOperationalAlert: Boolean(revisionAlert || clientPendingPickup || ['partial', 'pending_extra'].includes(dispatchReview?.status)),
        };
      })
      .sort((a, b) => {
        if (a.inventorySortWeight !== b.inventorySortWeight) {
          return a.inventorySortWeight - b.inventorySortWeight;
        }
        if (a.inventorySecondarySortWeight !== b.inventorySecondarySortWeight) {
          return a.inventorySecondarySortWeight - b.inventorySecondarySortWeight;
        }
        if (b.priority.weight !== a.priority.weight) return b.priority.weight - a.priority.weight;
        return new Date(a.operationSortDate ?? a.deliveryDate ?? 0) - new Date(b.operationSortDate ?? b.deliveryDate ?? 0);
      });
  }, [contracts, deliveries, operationalOverrides, operationalRentals]);

  const filteredPrepOrderRows = useMemo(() => {
    const normalizedQuery = normalizeText(inventoryOrderQuery);
    const selectedDateFrom = String(inventoryOperationDateFrom ?? '').slice(0, 10);
    const selectedDateTo = String(inventoryOperationDateTo ?? '').slice(0, 10);

    return prepOrderRows.filter((row) => {
      const matchesQuery = !normalizedQuery || [
        row.contractCode,
        row.orderCode,
        row.customerName,
      ].some((value) => normalizeText(value).includes(normalizedQuery));
      const operationDates = [row.deliveryDate, row.pickupDate]
        .map((value) => String(value ?? '').slice(0, 10))
        .filter(Boolean);
      const matchesDate = (!selectedDateFrom && !selectedDateTo) || operationDates.some((date) => (
        (!selectedDateFrom || date >= selectedDateFrom)
        && (!selectedDateTo || date <= selectedDateTo)
      ));
      return matchesQuery && matchesDate;
    });
  }, [inventoryOperationDateFrom, inventoryOperationDateTo, inventoryOrderQuery, prepOrderRows]);

  const inventoryFiltersAreCleared = !inventoryOrderQuery && !inventoryOperationDateFrom && !inventoryOperationDateTo;
  const visiblePrepOrderRows = inventoryFiltersAreCleared
    ? filteredPrepOrderRows.slice(0, 7)
    : filteredPrepOrderRows;

  const cancelledOrderRows = useMemo(() => {
    return cancelledRentals
      .map((rental) => {
        const totalItems = (rental.items ?? []).reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
        const lines = (rental.items ?? []).length;
        return {
          id: rental.id,
          orderCode: rental.orderCode ?? rental.id,
          customerName: rental.customerName,
          cancelledAt: rental.cancelledAt ?? rental.updatedAt ?? rental.createdAt,
          itemsText: `${totalItems} unidades · ${lines} items`,
          penaltyBs: Number(rental.cancellationPenaltyBs ?? 0),
        };
      })
      .sort((a, b) => new Date(b.cancelledAt ?? 0) - new Date(a.cancelledAt ?? 0));
  }, [cancelledRentals]);

  const receptionRows = useMemo(() => {
    return activeRentals
      .filter((rental) => rental.pickupChecklist && !rental.returnReport)
      .map((rental) => ({
        id: rental.id,
        rental,
        orderCode: rental.orderCode ?? rental.id,
        customerName: rental.customerName,
        checkedAt: rental.pickupChecklist?.checkedAt ?? rental.updatedAt ?? rental.createdAt,
        checkedBy: rental.pickupChecklist?.checkedBy ?? 'Transporte',
        itemsText: `${(rental.items ?? []).reduce((sum, line) => sum + Number(line.quantity ?? 0), 0)} unidades - ${(rental.items ?? []).length} items`,
      }))
      .sort((a, b) => new Date(a.checkedAt) - new Date(b.checkedAt));
  }, [activeRentals]);

  const inventoryRows = useMemo(() => {
    return items.map((item) => {
      const reserved = Number(reservedByItem[item.id] ?? 0);
      const maintenance = Number(maintenanceByItem[item.id] ?? 0);
      const totalStock = Number(item.totalStock ?? 0);
      const effectiveAvailable = Math.max(0, totalStock - reserved - maintenance);
      const stockControlled = item.controlsStock !== false
        && String(item.verificationStatus ?? '').trim() !== 'pending_verification'
        && String(item.adoptionSource ?? '').trim() !== 'service_order_quick_item'
        && totalStock > 0;
      const lowThreshold = Math.max(3, Math.ceil(totalStock * 0.15));
      const lowAvailability = stockControlled && effectiveAvailable <= lowThreshold;
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        brand: String(item.brand ?? '').trim(),
        itemColor: String(item.itemColor ?? '').trim(),
        imageUrl: item.imageUrl ?? null,
        imageDataUrl: item.imageUrl ?? item.imageDataUrl ?? null,
        inventoryArea: item.inventoryArea ?? '',
        resolvedInventoryArea: resolveInventoryArea(item),
        sku: String(item.sku ?? '').trim()
          || String(item.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 7).toUpperCase()
          || 'GEN',
        available: effectiveAvailable,
        reserved,
        maintenance,
        total: totalStock,
        controlsStock: stockControlled,
        verificationStatus: item.verificationStatus ?? (stockControlled ? 'verified' : 'pending_verification'),
        adoptionSource: item.adoptionSource ?? '',
        lowAvailability,
        price: Number(item.rentalPriceBs ?? 0),
        damagedUnitChargeBs: Number(item.damagedUnitChargeBs ?? 0),
        missingUnitChargeBs: Number(item.missingUnitChargeBs ?? 0),
        needsCleaningOnReturn: Boolean(item.needsCleaningOnReturn),
        createdAt: item.createdAt ?? item.updatedAt ?? null,
        updatedAt: item.updatedAt ?? null,
        usage: itemUsageById.get(item.id) ?? [],
      };
    });
  }, [itemUsageById, items, maintenanceByItem, reservedByItem]);

  const detailUsageRows = useMemo(() => {
    const rows = Array.isArray(detailRow?.usage) ? detailRow.usage : [];
    const todayKey = getDateKey(new Date());
    const formatDateLabel = (value) => {
      if (!value) return 'Sin fecha';
      const formatted = formatDateTime?.(value);
      return formatted ? (formatted.split(',')[0] || formatted) : String(value);
    };
    const formatWindowLabel = (start, end) => {
      const label = [start, end].filter(Boolean).join(' - ');
      return label || 'Sin horario';
    };

    return rows
      .map((entry) => {
        const startKey = getDateKey(entry.deliveryDate);
        const endKey = getDateKey(entry.pickupDate);
        const statusMeta = getInventoryUsageStatusMeta(entry, todayKey);
        const periodDays = startKey && endKey ? Math.max(1, (getDateKeyDiffDays(startKey, endKey) ?? 0) + 1) : null;
        return {
          ...entry,
          startKey,
          endKey,
          sortKey: endKey || startKey || '9999-12-31',
          statusMeta,
          deliveryLabel: formatDateLabel(entry.deliveryDate),
          pickupLabel: formatDateLabel(entry.pickupDate),
          deliveryWindowLabel: formatWindowLabel(entry.deliveryWindowStart, entry.deliveryWindowEnd),
          pickupWindowLabel: formatWindowLabel(entry.pickupWindowStart, entry.pickupWindowEnd),
          periodDays,
        };
      })
      .sort((a, b) => {
        if (a.sortKey !== b.sortKey) return a.sortKey.localeCompare(b.sortKey);
        return String(a.orderCode ?? '').localeCompare(String(b.orderCode ?? ''));
      });
  }, [detailRow, formatDateTime]);

  const detailUsageSummary = useMemo(() => {
    const todayKey = getDateKey(new Date());
    const totalCommitted = detailUsageRows.reduce((sum, entry) => sum + Number(entry.quantity ?? 0), 0);
    const orderCount = new Set(detailUsageRows.map((entry) => `${entry.rentalId ?? ''}-${entry.orderCode ?? ''}`)).size;
    const clientCount = new Set(detailUsageRows.map((entry) => normalizeText(entry.customerName)).filter(Boolean)).size;
    const overdueQty = detailUsageRows
      .filter((entry) => entry.statusMeta.key === 'overdue')
      .reduce((sum, entry) => sum + Number(entry.quantity ?? 0), 0);
    const nextReturn = detailUsageRows
      .filter((entry) => entry.endKey && entry.endKey >= todayKey)
      .sort((a, b) => a.endKey.localeCompare(b.endKey))[0] ?? null;
    const maxQuantity = Math.max(1, ...detailUsageRows.map((entry) => Number(entry.quantity ?? 0)));

    return {
      totalCommitted,
      orderCount,
      clientCount,
      overdueQty,
      nextReturn,
      maxQuantity,
    };
  }, [detailUsageRows]);

  const comboRows = useMemo(() => {
    const itemById = new Map(inventoryRows.map((row) => [row.id, row]));
    return (combos ?? []).map((combo) => {
      const ingredients = dedupeComboIngredientLines(
        (Array.isArray(combo.ingredients) ? combo.ingredients : [])
          .map((line) => {
          const item = itemById.get(String(line?.itemId ?? ''));
          const selectionMode = line?.selectionMode ?? 'item';
          const categoryRule = line?.category ?? '';
          const optionRows = selectionMode === 'category' && categoryRule
            ? inventoryRows.filter((row) => normalizeText(row.category) === normalizeText(categoryRule))
            : (Array.isArray(line?.optionItemIds) && line.optionItemIds.length > 0 ? line.optionItemIds : [line?.itemId])
              .map((id) => itemById.get(String(id ?? '')))
              .filter(Boolean);
          const quantity = Math.max(1, Math.trunc(Number(line?.quantity ?? 1)));
          const available = optionRows.reduce((sum, option) => (
            option.controlsStock ? sum + Number(option.available ?? 0) : sum
          ), 0);
          const controlsStock = optionRows.length > 0 && optionRows.every((option) => option.controlsStock);
          return {
            itemId: line?.itemId ?? '',
            itemName: item?.name ?? line?.itemName ?? 'Producto',
            category: item?.category ?? '',
            quantity,
            unitPriceBs: Number(item?.price ?? line?.unitPriceBs ?? 0),
            controlsStock,
            available,
            selectionMode,
            optionItemIds: optionRows.map((option) => option.id),
            slotLabel: line?.slotLabel ?? line?.itemName ?? '',
            categoryRule,
            optionsCount: optionRows.length,
          };
          })
          .filter((line) => line.itemId),
      );
      const catalogValue = ingredients.reduce((sum, line) => sum + (line.quantity * line.unitPriceBs), 0);
      const allVerified = ingredients.length > 0 && ingredients.every((line) => line.controlsStock);
      const minAvailable = ingredients.reduce((min, line) => {
        if (!line.controlsStock) return min;
        const possible = Math.floor(line.available / Math.max(1, line.quantity));
        return Math.min(min, possible);
      }, Number.POSITIVE_INFINITY);
      return {
        id: combo.id,
        detailKind: 'combo',
        name: combo.name,
        category: combo.category || 'COMBOS',
        sku: String(combo.id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 7).toUpperCase() || 'COMBO',
        price: Number(combo.rentalPriceBs ?? 0),
        pricingCondition: combo.pricingCondition ?? null,
        priceIngredientSignature: String(combo.priceIngredientSignature ?? '').trim(),
        catalogValue,
        ingredients,
        ingredientsCount: ingredients.length,
        totalUnits: ingredients.reduce((sum, line) => sum + line.quantity, 0),
        controlsStock: allVerified,
        availableCombos: Number.isFinite(minAvailable) ? Math.max(0, minAvailable) : 0,
        notes: combo.notes ?? '',
        imageUrl: combo.imageUrl ?? null,
        imageDataUrl: combo.imageDataUrl ?? null,
        createdAt: combo.createdAt ?? combo.updatedAt ?? null,
        updatedAt: combo.updatedAt ?? null,
        usage: comboUsageById.get(String(combo.id)) ?? [],
      };
    });
  }, [comboUsageById, combos, inventoryRows]);

  const movementRows = useMemo(() => {
    const itemById = new Map(inventoryRows.map((row) => [row.id, row]));
    const contractById = new Map(contracts.map((contract) => [String(contract.id), contract]));
    const rentalsForTrace = [...activeRentals, ...cancelledRentals];
    const rentalByOrderCode = new Map(rentalsForTrace.map((rental) => [rental.orderCode ?? rental.id, rental]));
    const sortedInventoryMovements = inventoryMovements
      .slice()
      .sort((a, b) => new Date(b.createdAt ?? b.operationDate ?? 0) - new Date(a.createdAt ?? a.operationDate ?? 0));
    const reservationMovementKeys = new Set(
      sortedInventoryMovements
        .filter((movement) => movement.type === 'reserva')
        .map((movement) => `${movement.reference ?? ''}::${movement.itemId ?? ''}`),
    );
    const visibleInventoryMovements = sortedInventoryMovements.slice(0, INVENTORY_MOVEMENT_RENDER_LIMIT);

    const persistedRows = visibleInventoryMovements.map((movement) => {
      const itemRow = itemById.get(movement.itemId);
      const linkedRental = rentalByOrderCode.get(movement.reference ?? '');
      const linkedContract = linkedRental ? contractById.get(String(linkedRental.contractId ?? '')) : null;
      const isEntry = movement.type === 'entrada' || movement.type === 'reinsercion';
      const isExit = movement.type === 'salida' || movement.type === 'reserva';
      const isReservation = movement.type === 'reserva';
      const inventoryStatus = linkedRental?.operational?.inventoryStatus ?? movement.status ?? 'pendiente';
      const inventoryHandled = ['confirmado', 'salio', 'devuelto'].includes(inventoryStatus);
      const rawMovementUserName = movement.userName;
      const movementUserName =
        rawMovementUserName && rawMovementUserName !== 'Sistema'
          ? rawMovementUserName
          : linkedRental?.createdByName ?? linkedRental?.createdBy ?? rawMovementUserName ?? 'Sistema';
      const responsibleName =
        isReservation && !inventoryHandled
          ? 'Por alistar'
          : isReservation && inventoryStatus === 'salio'
          ? linkedRental?.operational?.inventoryDispatchedByName ?? linkedRental?.operational?.inventoryConfirmedByName ?? movementUserName
          : isReservation
          ? linkedRental?.operational?.inventoryConfirmedByName ?? movementUserName
          : movementUserName;
      const responsibleRole =
        isReservation && !inventoryHandled
          ? inventoryStatus === 'enviado'
            ? 'Inventario recibido'
            : 'Inventario pendiente'
          : isReservation && inventoryStatus === 'salio'
          ? linkedRental?.operational?.inventoryDispatchedByRole ?? 'Salida de almacen'
          : isReservation
          ? linkedRental?.operational?.inventoryConfirmedByRole ?? linkedRental?.createdByRole ?? movement.userRole ?? 'Inventario'
          : movement.userRole && movement.userRole !== 'Operacion'
          ? movement.userRole
          : linkedRental?.createdByRole ?? movement.userRole ?? 'Operacion';
      return {
        id: movement.id,
        createdAt: isReservation
          ? movement.operationDate ?? movement.deliveryDate ?? linkedContract?.deliveryDate ?? linkedRental?.rentalDate ?? movement.createdAt
          : movement.createdAt,
        registeredAt: movement.createdAt,
        typeKey: isEntry ? 'entrada' : isExit ? 'salida' : 'ajuste',
        typeLabel: movement.type === 'reserva' ? 'Reserva' : isEntry ? 'Entrada' : movement.type === 'salida' ? 'Salida' : 'Ajuste',
        itemName: movement.itemName ?? 'Item',
        itemId: movement.itemId ?? '',
        imageUrl: movement.imageUrl ?? itemRow?.imageUrl ?? null,
        imageDataUrl: movement.imageDataUrl ?? itemRow?.imageDataUrl ?? null,
        sku: String(movement.itemId ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 7).toUpperCase() || 'COD',
        contractCode: linkedContract?.contractCode ?? linkedRental?.contractCode ?? movement.contractCode ?? '',
        reference: linkedContract?.contractCode ?? linkedRental?.contractCode ?? movement.reference ?? movement.id,
        deltaUnits: Number(movement.deltaUnits ?? 0),
        beforeStock: Number(movement.beforeAvailableStock ?? movement.beforeTotalStock ?? 0),
        afterStock: Number(movement.afterAvailableStock ?? movement.afterTotalStock ?? 0),
        userName: responsibleName,
        userRole: responsibleRole,
        registeredByName: movementUserName,
        registeredByRole: movement.userRole && movement.userRole !== 'Operacion' ? movement.userRole : linkedRental?.createdByRole ?? movement.userRole ?? 'Operacion',
        observation: movement.reason ?? movement.detail ?? '-',
        valueAmount: Number(movement.valueAmount ?? 0),
        status: isReservation ? inventoryStatus : movement.status ?? 'aprobado',
        isPendingReservation: isReservation && !['confirmado', 'salio', 'devuelto', 'anulado'].includes(inventoryStatus),
      };
    });

    const serviceOrderRows = rentalsForTrace.flatMap((rental) => {
      const reference = rental.orderCode ?? rental.id;
      const contract = contractById.get(String(rental.contractId ?? '')) ?? null;
      const displayReference = contract?.contractCode ?? rental.contractCode ?? reference;
      const operationDate = contract?.deliveryDate ?? contract?.eventDate ?? rental.rentalDate ?? rental.createdAt ?? rental.rentalAt ?? new Date().toISOString();
      return (rental.items ?? [])
        .map((line, index) => {
          const key = `${reference}::${line.itemId ?? ''}`;
          if (reservationMovementKeys.has(key)) {
            return null;
          }

          const itemRow = itemById.get(line.itemId);
          const quantity = Number(line.quantity ?? 0);
          const afterStock = Number(itemRow?.available ?? 0);
          return {
            id: `service-order-${rental.id}-${line.itemId}-${index}`,
            createdAt: operationDate,
            registeredAt: rental.createdAt ?? rental.rentalAt ?? new Date().toISOString(),
            typeKey: 'salida',
            typeLabel: 'Reserva',
            itemName: line.itemName ?? itemRow?.name ?? 'Item',
            itemId: line.itemId ?? '',
            imageUrl: itemRow?.imageUrl ?? null,
            imageDataUrl: itemRow?.imageDataUrl ?? null,
            sku: String(line.itemId ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 7).toUpperCase() || 'COD',
            reference: displayReference,
            deltaUnits: -quantity,
            beforeStock: afterStock + quantity,
            afterStock,
            userName: ['confirmado', 'salio', 'devuelto'].includes(rental.operational?.inventoryStatus)
              ? rental.operational?.inventoryConfirmedByName ?? rental.createdByName ?? rental.createdBy ?? 'Sistema'
              : 'Por alistar',
            userRole: ['confirmado', 'salio', 'devuelto'].includes(rental.operational?.inventoryStatus)
              ? rental.operational?.inventoryConfirmedByRole ?? rental.createdByRole ?? 'Inventario'
              : rental.operational?.inventoryStatus === 'enviado'
              ? 'Inventario recibido'
              : 'Inventario pendiente',
            registeredByName: rental.createdByName ?? rental.createdBy ?? 'Sistema',
            registeredByRole: rental.createdByRole ?? 'Inventario',
            observation: `Reservado para contrato ${displayReference} - ${rental.customerName ?? 'Cliente'}`,
            contractCode: displayReference,
            valueAmount: Number(line.lineTotalBs ?? 0),
            status: rental.operational?.inventoryStatus ?? 'pendiente',
            isPendingReservation: !['confirmado', 'salio', 'devuelto', 'anulado'].includes(rental.operational?.inventoryStatus ?? 'pendiente'),
          };
        })
        .filter(Boolean);
    });

    return [...persistedRows, ...serviceOrderRows]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, INVENTORY_MOVEMENT_RENDER_LIMIT);
  }, [activeRentals, cancelledRentals, contracts, inventoryMovements, inventoryRows]);

  const movementStats = useMemo(() => {
    const counts = inventoryMovementStats
      ? {
          total: Number(inventoryMovementStats.total ?? 0),
          entrada: Number(inventoryMovementStats.entrada ?? 0),
          salida: Number(inventoryMovementStats.salida ?? 0),
          ajuste: Number(inventoryMovementStats.ajuste ?? 0),
        }
      : { total: 0, entrada: 0, salida: 0, ajuste: 0 };
    if (!inventoryMovementStats) {
    inventoryMovements.forEach((movement) => {
      counts.total += 1;
      if (movement.type === 'entrada' || movement.type === 'reinsercion') counts.entrada += 1;
      else if (movement.type === 'salida' || movement.type === 'reserva') counts.salida += 1;
      else counts.ajuste += 1;
    });
    }
    activeRentals.forEach((rental) => {
      const lines = Array.isArray(rental?.items) ? rental.items : [];
      const status = rental?.operational?.inventoryStatus ?? 'pendiente';
      if (['confirmado', 'salio', 'devuelto', 'anulado'].includes(status)) return;
      lines.forEach((line) => {
        if (!line?.itemId || Number(line?.quantity ?? 0) <= 0) return;
        counts.total += 1;
        counts.salida += 1;
      });
    });
    return counts;
  }, [activeRentals, inventoryMovements, inventoryMovementStats]);

  const detailMovementTrace = useMemo(() => {
    if (!detailRow?.id) return [];
    return movementRows
      .filter((row) => String(row.itemId ?? '') === String(detailRow.id))
      .map((row) => ({
        ...row,
        dateLabel: row.createdAt ? formatDateTime(row.createdAt) : 'Sin fecha',
        affectsPhysicalStock: row.typeLabel !== 'Reserva',
        beforeAfterLabel: row.typeLabel === 'Reserva' ? 'Disponible antes / despues' : 'Stock fisico antes / despues',
      }));
  }, [detailRow, formatDateTime, movementRows]);

  const detailStockExplanation = useMemo(() => {
    if (!detailRow || detailRow.total === undefined) return null;
    const total = Number(detailRow.total ?? 0);
    const reserved = Number(detailRow.reserved ?? 0);
    const maintenance = Number(detailRow.maintenance ?? 0);
    const available = Number(detailRow.available ?? 0);
    const rawAvailable = total - reserved - maintenance;
    return {
      total,
      reserved,
      maintenance,
      available,
      rawAvailable,
      overReserved: rawAvailable < 0,
      missingToCover: rawAvailable < 0 ? Math.abs(rawAvailable) : 0,
    };
  }, [detailRow]);

  const movementSelectableRows = useMemo(() => {
    if (!normalizeInventorySearchText(deferredMovementItemQuery)) return inventoryRows.slice(0, 80);
    return inventoryRows
      .map((row) => ({ row, searchScore: getInventorySearchScore(deferredMovementItemQuery, row) }))
      .filter((entry) => entry.searchScore >= 0)
      .sort((a, b) => b.searchScore - a.searchScore || a.row.name.localeCompare(b.row.name, 'es'))
      .slice(0, 80)
      .map((entry) => entry.row);
  }, [deferredMovementItemQuery, inventoryRows]);

  const adjustRows = useMemo(
    () =>
      movementRows
        .filter((row) => row.typeKey === 'ajuste')
        .map((row, index) => ({
          ...row,
          adjustId: row.reference?.startsWith('AJ-') ? row.reference : `AJ-${String(index + 1).padStart(5, '0')}`,
          reason: row.observation,
          reasonDetail: 'Ajuste de stock',
        })),
    [movementRows],
  );

  const movementUsers = useMemo(() => {
    return Array.from(new Set(movementRows.map((row) => row.userName))).sort((a, b) => a.localeCompare(b, 'es'));
  }, [movementRows]);

  const totals = useMemo(() => {
    const totalUnits = inventoryRows.reduce((sum, row) => sum + row.total, 0);
    const availableUnits = inventoryRows.reduce((sum, row) => sum + row.available, 0);
    const availability = totalUnits > 0 ? (availableUnits / totalUnits) * 100 : 0;
    const lowStockCount = inventoryRows.filter((row) => row.lowAvailability).length;
    const value = inventoryRows.reduce((sum, row) => sum + row.total * row.price, 0);
    return { totalUnits, availability, lowStockCount, value };
  }, [inventoryRows]);

  const categoriesList = useMemo(() => {
    const countMap = {};
    inventoryRows.forEach((row) => {
      const key = normalizeText(row.category);
      if (!countMap[key]) {
        countMap[key] = {
          name: row.category,
          count: 0,
        };
      }
      countMap[key].count += 1;
    });

    const baseMap = new Map();
    categories.forEach((entry) => {
      const key = normalizeText(entry.name);
      baseMap.set(key, {
        id: entry.id,
        name: entry.name,
        icon: entry.icon || 'box',
        color: normalizeHexColor(entry.color, DEFAULT_CATEGORY_COLOR),
        status: entry.status || 'active',
        createdAt: entry.createdAt || null,
        updatedAt: entry.updatedAt || null,
        count: Number(countMap[key]?.count ?? 0),
      });
    });

    Object.entries(countMap).forEach(([key, value]) => {
      if (baseMap.has(key)) return;
      baseMap.set(key, {
        id: `virtual-${key}`,
        name: value.name,
        icon: 'box',
        color: DEFAULT_CATEGORY_COLOR,
        status: 'active',
        createdAt: null,
        updatedAt: null,
        count: Number(value.count ?? 0),
      });
    });

    return Array.from(baseMap.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));
  }, [categories, inventoryRows]);

  const kpiCards = useMemo(() => {
    if (isMovementsModule) {
      return [
        { tone: 'lilac', icon: 'box', value: movementStats.total, label: 'Total movimientos', link: 'Historial optimizado' },
        { tone: 'mint', icon: 'check', value: movementStats.entrada, label: 'Entradas', link: 'Filtrar entradas' },
        { tone: 'peach', icon: 'tag', value: movementStats.salida, label: 'Reservas / salidas', link: 'Filtrar salidas' },
        { tone: 'sky', icon: 'bag', value: movementStats.ajuste, label: 'Ajustes', link: 'Filtrar ajustes' },
      ];
    }

    if (isAdjustModule) {
      const pending = adjustRows.filter((row) => row.status === 'pendiente').length;
      return [
        { tone: 'lilac', icon: 'box', value: adjustRows.length, label: 'Ajustes este mes', link: 'Ver historial' },
        { tone: 'mint', icon: 'check', value: formatBs(adjustRows.reduce((sum, row) => sum + row.valueAmount, 0)), label: 'Valor total de ajustes', link: 'Ver resumen' },
        { tone: 'peach', icon: 'tag', value: pending, label: 'Pendientes de aprobar', link: 'Ver pendientes' },
        { tone: 'sky', icon: 'check', value: `${totals.availability.toFixed(1)}%`, label: 'Precision de inventario', link: 'Ver reportes' },
      ];
    }

    if (isCategoriesModule) {
      const withItems = categoriesList.filter((entry) => Number(entry.count ?? 0) > 0).length;
      const empty = categoriesList.filter((entry) => Number(entry.count ?? 0) === 0).length;
      const active = categoriesList.filter((entry) => String(entry.status ?? 'active') !== 'inactive').length;
      return [
        { tone: 'lilac', icon: 'box', value: categoriesList.length, label: 'Total categorias', link: 'Ver catalogo' },
        { tone: 'mint', icon: 'check', value: withItems, label: 'Con productos', link: 'Ver en uso' },
        { tone: 'sky', icon: 'bag', value: empty, label: 'Sin productos', link: 'Revisar vacias' },
        { tone: 'peach', icon: 'tag', value: active, label: 'Categorias activas', link: 'Gestionar' },
      ];
    }

    if (isCombosModule) {
      const controlled = comboRows.filter((row) => row.controlsStock).length;
      const units = comboRows.reduce((sum, row) => sum + row.totalUnits, 0);
      const value = comboRows.reduce((sum, row) => sum + row.price, 0);
      return [
        { tone: 'lilac', icon: 'box', value: comboRows.length, label: 'Combos creados', link: 'Ver catalogo' },
        { tone: 'mint', icon: 'check', value: controlled, label: 'Listos para descontar', link: 'Ver controlados' },
        { tone: 'sky', icon: 'bag', value: units, label: 'Productos vinculados', link: 'Revisar ingredientes' },
        { tone: 'peach', icon: 'tag', value: formatBs(value), label: 'Valor de combos', link: 'Ver precios' },
      ];
    }

    return [
      { tone: 'lilac', icon: 'box', value: totals.totalUnits, label: 'Total de items', link: 'Ver detalles' },
      { tone: 'mint', icon: 'check', value: `${totals.availability.toFixed(1)}%`, label: 'Disponibilidad promedio', link: 'Ver reporte' },
      { tone: 'sky', icon: 'bag', value: totals.lowStockCount, label: 'Stock bajo minimo', link: 'Revisar alertas' },
      { tone: 'peach', icon: 'tag', value: formatBs(totals.value), label: 'Valor total del inventario', link: 'Ver valuacion' },
    ];
  }, [adjustRows, categoriesList, comboRows, formatBs, isAdjustModule, isCategoriesModule, isCombosModule, isMovementsModule, movementStats, totals]);

  const recentActivity = useMemo(() => {
    return movementRows.slice(0, 4).map((movement) => ({
      id: movement.id,
      itemName: movement.itemName,
      type: movement.typeKey,
      title:
        movement.typeKey === 'entrada'
          ? 'Entrada de inventario'
          : movement.typeKey === 'salida'
          ? 'Salida por orden'
          : 'Ajuste de inventario',
      detail: `${Math.abs(movement.deltaUnits)} unidades de ${movement.itemName}`,
      when: formatDateTime(movement.createdAt),
    }));
  }, [formatDateTime, movementRows]);

  const valuationRows = useMemo(() => {
    const map = {};
    inventoryRows.forEach((row) => {
      if (!map[row.category]) {
        map[row.category] = {
          category: row.category,
          items: 0,
          units: 0,
          value: 0,
        };
      }
      map[row.category].items += 1;
      map[row.category].units += row.total;
      map[row.category].value += row.total * row.price;
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [inventoryRows]);

  const filteredRows = useMemo(() => {
    const text = normalizeInventorySearchText(deferredQuery);
    let base = isMovementsModule
      ? movementRows
      : isAdjustModule
      ? adjustRows
      : isCombosModule
      ? comboRows
      : isCategoriesModule
      ? categoriesList
      : inventoryRows;

    if (!isMovementsModule && !isAdjustModule && !isCategoriesModule && !isCombosModule) {
      if (categoryFilter !== 'all') {
        base = base.filter((row) => normalizeText(row.category) === normalizeText(categoryFilter));
      }
      if (stockFilter === 'low') {
        base = base.filter((row) => row.lowAvailability);
      } else if (stockFilter === 'ok') {
        base = base.filter((row) => row.controlsStock && !row.lowAvailability);
      } else if (stockFilter === 'untracked') {
        base = base.filter((row) => !row.controlsStock);
      }
      if (controlFilter === 'controlled') {
        base = base.filter((row) => row.controlsStock);
      } else if (controlFilter === 'pending') {
        base = base.filter((row) => !row.controlsStock);
      }
      if (sortFilter !== 'default') {
        const timestamp = (row) => {
          const value = new Date(row.createdAt ?? row.updatedAt ?? 0).getTime();
          return Number.isFinite(value) ? value : 0;
        };
        base = [...base].sort((a, b) =>
          sortFilter === 'oldest'
            ? timestamp(a) - timestamp(b)
            : timestamp(b) - timestamp(a),
        );
      }
    }

    if (isMovementsModule) {
      if (movementTypeFilter !== 'all') {
        base = base.filter((row) => row.typeKey === movementTypeFilter);
      }
      if (movementUserFilter !== 'all') {
        base = base.filter((row) => row.userName === movementUserFilter);
      }
      if (dateFrom || dateTo) {
        base = base.filter((row) => isBetweenDates(row.createdAt, dateFrom, dateTo));
      }
    }

    if (isAdjustModule) {
      if (adjustStatusFilter !== 'all') {
        base = base.filter((row) => row.status === adjustStatusFilter);
      }
      if (dateFrom || dateTo) {
        base = base.filter((row) => isBetweenDates(row.createdAt, dateFrom, dateTo));
      }
    }

    if (isCategoriesModule) {
      if (categoryUsageFilter === 'with_items') {
        base = base.filter((row) => Number(row.count ?? 0) > 0);
      } else if (categoryUsageFilter === 'empty') {
        base = base.filter((row) => Number(row.count ?? 0) === 0);
      }
    }

    if (!text) return base;
    const matchedRows = base
      .map((row) => ({ row, searchScore: getInventorySearchScore(deferredQuery, row) }))
      .filter((entry) => entry.searchScore >= 0);

    if (!isMovementsModule && !isAdjustModule && !isCategoriesModule && !isCombosModule && sortFilter === 'default') {
      matchedRows.sort((a, b) => b.searchScore - a.searchScore || a.row.name.localeCompare(b.row.name, 'es'));
    }

    return matchedRows.map((entry) => entry.row);
  }, [
    adjustRows,
    categoriesList,
    comboRows,
    inventoryRows,
    movementRows,
    isCategoriesModule,
    isAdjustModule,
    isCombosModule,
    isMovementsModule,
    deferredQuery,
    categoryFilter,
    stockFilter,
    controlFilter,
    sortFilter,
    movementTypeFilter,
    movementUserFilter,
    adjustStatusFilter,
    categoryUsageFilter,
    dateFrom,
    dateTo,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, pageSize, safePage]);

  const showMessage = (message, type = 'ok') => {
    setFeedback(message);
    setFeedbackType(type);
  };

  const resetAdvancedFilters = () => {
    setCategoryFilter('all');
    setStockFilter('all');
    setControlFilter('all');
    setSortFilter('default');
    setProductFilterMenu(null);
    setMovementTypeFilter('all');
    setMovementUserFilter('all');
    setAdjustStatusFilter('all');
    setCategoryUsageFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const categoryFilterOptions = useMemo(() => [
    {
      value: 'all',
      label: 'Todas las categorias',
      meta: `${inventoryRows.length} productos`,
      color: DEFAULT_CATEGORY_COLOR,
    },
    ...categoriesList.map((entry) => ({
      value: entry.name,
      label: entry.name,
      meta: `${Number(entry.count ?? 0)} productos`,
      color: entry.color ?? DEFAULT_CATEGORY_COLOR,
    })),
  ], [categoriesList, inventoryRows.length]);

  const stockFilterOptions = [
    { value: 'all', label: 'Todo el stock', meta: 'Disponible, bajo y por validar' },
    { value: 'ok', label: 'Stock disponible', meta: 'Controlados sin alerta' },
    { value: 'low', label: 'Stock bajo', meta: 'Requiere revision' },
    { value: 'untracked', label: 'No descuenta stock', meta: 'Pendientes de verificacion' },
  ];

  const controlFilterOptions = [
    { value: 'all', label: 'Todos los estados', meta: 'Controlados y por validar' },
    { value: 'controlled', label: 'Controlados', meta: 'Ya descuentan inventario' },
    { value: 'pending', label: 'Por validar', meta: 'No descuentan inventario' },
  ];

  const sortFilterOptions = [
    { value: 'default', label: 'Orden actual', meta: 'Como viene del sistema' },
    { value: 'recent', label: 'Recientes primero', meta: 'Ultimos agregados arriba' },
    { value: 'oldest', label: 'Antiguos primero', meta: 'Primeros registros arriba' },
  ];

  const getFilterLabel = (options, value) =>
    options.find((option) => option.value === value)?.label ?? options[0]?.label ?? '';

  const renderProductFilterDropdown = ({ id, label, value, options, onChange, wide = false }) => (
    <div className={`inventory-filter-select-wrap ${wide ? 'wide' : ''}`}>
      <button
        type="button"
        className={`inventory-filter-trigger ${productFilterMenu === id ? 'open' : ''}`}
        onClick={() => setProductFilterMenu((current) => (current === id ? null : id))}
        aria-expanded={productFilterMenu === id}
      >
        <span>
          <small>{label}</small>
          <strong>{getFilterLabel(options, value)}</strong>
        </span>
        <span className="inventory-filter-chevron">v</span>
      </button>
      {productFilterMenu === id ? (
        <div className={`inventory-filter-popover ${wide ? 'wide' : ''}`}>
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`inventory-filter-option ${option.value === value ? 'active' : ''}`}
              onClick={() => {
                onChange(option.value);
                setProductFilterMenu(null);
              }}
            >
              {option.color ? (
                <span
                  className="inventory-filter-dot"
                  style={{ background: option.color }}
                  aria-hidden="true"
                />
              ) : null}
              <span className="inventory-filter-option-copy">
                <strong>{option.label}</strong>
                {option.meta ? <small>{option.meta}</small> : null}
              </span>
              {option.value === value ? <span className="inventory-filter-check">OK</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  const handleHeaderAdjustClick = () => {
    onSwitchInventoryModule?.('inventario_ajustes');
  };

  const handleHeaderNewClick = () => {
    setProductModalMode('create');
    setProductForm({
      ...EMPTY_PRODUCT_FORM,
      category: categories[0]?.name ?? '',
    });
    setProductError('');
  };

  const handleHeaderImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const content = await file.text();
      const parsedRows = parseInventoryCsv(content, categories.map((entry) => entry.name));
      let success = 0;
      let failed = 0;
      for (const row of parsedRows) {
        try {
          await onCreateInventoryItem?.(row);
          success += 1;
        } catch {
          failed += 1;
        }
      }
      if (onReloadData) {
        await onReloadData();
      }
      showMessage(`Importacion finalizada. Creados: ${success}. Fallidos: ${failed}.`, failed > 0 ? 'error' : 'ok');
    } catch (error) {
      showMessage(error?.message || 'No se pudo importar el inventario.', 'error');
    }
  };

  const handleExport = async () => {
    if (filteredRows.length === 0) {
      showMessage('No hay datos para exportar con los filtros actuales.', 'error');
      return;
    }

    if (isCategoriesModule) {
      const lines = [
        [
          'categoria',
          'icono',
          'color',
          'productos_asociados',
          'estado',
          'creada',
        ].join(','),
        ...filteredRows.map((row) =>
          [
            csvEscape(row.name),
            csvEscape(row.icon ?? 'box'),
            csvEscape(row.color ?? DEFAULT_CATEGORY_COLOR),
            csvEscape(row.count ?? 0),
            csvEscape(row.status ?? 'active'),
            csvEscape(row.createdAt ? String(row.createdAt).slice(0, 10) : '-'),
          ].join(','),
        ),
      ];
      downloadCsv(`inventario-categorias-${new Date().toISOString().slice(0, 10)}.csv`, lines);
      showMessage('Exportacion de categorias completada.');
      return;
    }

    if (isCombosModule) {
      const lines = [
        [
          'combo',
          'categoria',
          'precio_combo_bs',
          'precio_componentes_bs',
          'ingredientes',
          'unidades',
          'estado_stock',
          'notas',
        ].join(','),
        ...filteredRows.map((row) =>
          [
            csvEscape(row.name),
            csvEscape(row.category),
            csvEscape(Number(row.price ?? 0).toFixed(2)),
            csvEscape(Number(row.catalogValue ?? 0).toFixed(2)),
            csvEscape(row.ingredients.map((line) => `${line.quantity}x ${line.itemName}`).join(' | ')),
            csvEscape(row.totalUnits),
            csvEscape(row.controlsStock ? 'Listo para descontar' : 'Con productos por validar'),
            csvEscape(row.notes),
          ].join(','),
        ),
      ];
      downloadCsv(`inventario-combos-${new Date().toISOString().slice(0, 10)}.csv`, lines);
      showMessage('Exportacion de combos completada.');
      return;
    }

    if (isMovementsModule) {
      const lines = [
        [
          'fecha_hora',
          'tipo',
          'producto',
          'codigo',
          'referencia',
          'cantidad',
          'stock_anterior',
          'stock_nuevo',
          'responsable',
          'observacion',
        ].join(','),
        ...filteredRows.map((row) =>
          [
            csvEscape(formatDateTime(row.createdAt)),
            csvEscape(row.typeLabel),
            csvEscape(row.itemName),
            csvEscape(row.sku),
            csvEscape(row.reference),
            csvEscape(row.deltaUnits),
            csvEscape(row.beforeStock),
            csvEscape(row.afterStock),
            csvEscape(row.userName),
            csvEscape(row.observation),
          ].join(','),
        ),
      ];
      downloadCsv(`inventario-movimientos-${new Date().toISOString().slice(0, 10)}.csv`, lines);
      showMessage('Exportacion de movimientos completada.');
      return;
    }

    if (isAdjustModule) {
      const lines = [
        [
          'ajuste',
          'fecha_hora',
          'producto',
          'codigo',
          'motivo',
          'cantidad',
          'stock_anterior',
          'stock_nuevo',
          'valor_ajuste_bs',
          'responsable',
          'estado',
        ].join(','),
        ...filteredRows.map((row) =>
          [
            csvEscape(row.adjustId),
            csvEscape(formatDateTime(row.createdAt)),
            csvEscape(row.itemName),
            csvEscape(row.sku),
            csvEscape(row.reason),
            csvEscape(row.deltaUnits),
            csvEscape(row.beforeStock),
            csvEscape(row.afterStock),
            csvEscape(Number(row.valueAmount ?? 0).toFixed(2)),
            csvEscape(row.userName),
            csvEscape(row.status),
          ].join(','),
        ),
      ];
      downloadCsv(`inventario-ajustes-${new Date().toISOString().slice(0, 10)}.csv`, lines);
      showMessage('Exportacion de ajustes completada.');
      return;
    }

    try {
      showMessage('Preparando documento profesional de productos...');
      const activeFilters = [
        query.trim() ? `Busqueda: ${query.trim()}` : '',
        categoryFilter !== 'all' ? `Categoria: ${categoryFilter}` : '',
        stockFilter !== 'all' ? `Stock: ${stockFilter}` : '',
        controlFilter !== 'all' ? `Estado: ${controlFilter}` : '',
      ].filter(Boolean);
      await exportProductsWorkbook({
        rows: filteredRows,
        filters: activeFilters.length > 0 ? activeFilters.join(' | ') : 'Todos los productos',
      });
      showMessage('Documento Excel de productos exportado correctamente.');
    } catch (error) {
      showMessage(error?.message || 'No se pudo generar el documento Excel.', 'error');
    }
  };

  const handleExportPremiumCatalog = () => {
    if (inventoryRows.length === 0) {
      showMessage('No hay productos para generar el catalogo.', 'error');
      return;
    }
    const catalogWindow = window.open('', '_blank', 'width=1180,height=860');
    if (!catalogWindow) {
      showMessage('Chrome bloqueo la ventana del catalogo. Habilita ventanas emergentes para guardar el PDF.', 'error');
      return;
    }
    catalogWindow.document.open();
    catalogWindow.document.write(buildPremiumCatalogHtml({ rows: inventoryRows }));
    catalogWindow.document.close();
    catalogWindow.focus();
    showMessage('Catalogo abierto. Usa "Imprimir / guardar PDF" para descargarlo.');
  };

  const handleKpiLink = (card) => {
    if (!card) return;
    if (isCategoriesModule) {
      if (card.label === 'Con productos') {
        setCategoryUsageFilter('with_items');
        setShowFilters(true);
        return;
      }
      if (card.label === 'Sin productos') {
        setCategoryUsageFilter('empty');
        setShowFilters(true);
        return;
      }
      if (card.label === 'Categorias activas') {
        setCategoryUsageFilter('all');
        setShowFilters(true);
        return;
      }
      setShowFilters(false);
      return;
    }

    if (!isMovementsModule && !isAdjustModule && !isCombosModule) {
      if (card.label === 'Total de items') {
        onSwitchInventoryModule?.('inventario_productos');
      } else if (card.label === 'Stock bajo minimo') {
        setStockFilter('low');
        setShowFilters(true);
        showMessage('Filtro aplicado: stock bajo.');
      } else if (card.label === 'Valor total del inventario') {
        setValuationOpen(true);
      } else {
        setShowFilters(true);
      }
      return;
    }

    if (isMovementsModule) {
      if (card.label === 'Entradas') setMovementTypeFilter('entrada');
      if (card.label === 'Salidas') setMovementTypeFilter('salida');
      if (card.label === 'Ajustes') setMovementTypeFilter('ajuste');
      setShowFilters(true);
      return;
    }

    if (isAdjustModule) {
      if (card.label === 'Pendientes de aprobar') {
        setAdjustStatusFilter('pendiente');
      }
      setShowFilters(true);
    }
  };

  const handleSelectCategory = (categoryName) => {
    onSwitchInventoryModule?.('inventario');
    setCategoryFilter(categoryName);
    setShowFilters(true);
    setQuery('');
    setShowAllCategoriesModal(false);
  };

  const handleOpenImagePreview = (imageDataUrl, itemName) => {
    if (!imageDataUrl) return;
    onOpenImage?.({
      url: imageDataUrl,
      name: `Imagen de ${itemName || 'producto'}`,
    });
  };

  const handleViewAllCategories = () => {
    setShowAllCategoriesModal(true);
  };

  const handleManageCategories = () => {
    setShowAllCategoriesModal(false);
    onSwitchInventoryModule?.('inventario_categorias');
    setCategoryUsageFilter('all');
    setQuery('');
    setShowFilters(false);
    showMessage('Mostrando todas las categorias.');
  };

  const openMovementModal = (row, type = 'ajuste') => {
    const initialTarget = type === 'ajuste' ? String(row?.total ?? row?.afterStock ?? '') : '';
    setMovementForm({
      itemId: row?.itemId ?? row?.id ?? '',
      type,
      quantity: '1',
      targetTotalStock: initialTarget,
      reason: '',
    });
    setMovementItemQuery(row?.name ?? row?.itemName ?? '');
    setMovementError('');
    setMovementModalOpen(true);
  };

  const closeMovementModal = () => {
    setMovementModalOpen(false);
    setMovementForm(EMPTY_MOVEMENT_FORM);
    setMovementItemQuery('');
    setMovementError('');
  };

  const openEditProductModal = (row) => {
    setProductModalMode('edit');
    setProductError('');
    setProductForm({
      id: row.id,
      name: row.name,
      sku: row.sku ?? '',
      category: row.category,
      brand: row.brand ?? '',
      itemColor: row.itemColor ?? '',
      totalStock: String(row.total),
      originalTotalStock: Math.trunc(Number(row.total ?? 0)),
      rentalPriceBs: String(row.price),
      damagedUnitChargeBs: String(row.damagedUnitChargeBs),
      missingUnitChargeBs: String(row.missingUnitChargeBs),
      needsCleaningOnReturn: Boolean(row.needsCleaningOnReturn),
      imageUrl: row.imageUrl ?? null,
      imageDataUrl: row.imageDataUrl ?? null,
      imageFile: null,
      imagePreviewUrl: row.imageUrl ?? row.imageDataUrl ?? null,
      imageRemoved: false,
      imageFileName: '',
    });
  };

  const openAreaAssignment = (row) => {
    setAreaAssignment({
      id: row.id,
      name: row.name,
      area: row.inventoryArea || row.resolvedInventoryArea || resolveInventoryArea(row),
    });
    setRowMenuOpenId(null);
  };

  const saveAreaAssignment = async () => {
    if (!areaAssignment?.id || isSavingArea) return;
    try {
      setIsSavingArea(true);
      await onUpdateInventoryItem?.({
        id: areaAssignment.id,
        inventoryArea: areaAssignment.area,
      });
      showMessage(`${areaAssignment.name} asignado a ${getInventoryAreaLabel(areaAssignment.area)}.`);
      setAreaAssignment(null);
    } catch (error) {
      showMessage(error?.message || 'No se pudo asignar el area.', 'error');
    } finally {
      setIsSavingArea(false);
    }
  };

  const openCreateComboModal = () => {
    setComboModalMode('create');
    setComboError('');
    setComboIngredientQuery('');
    setComboRuleDraft({ mode: 'items', label: '', quantity: '1', category: '', itemIds: [] });
    setComboForm({
      ...EMPTY_COMBO_FORM,
      category: categories.find((entry) => normalizeText(entry.name) === 'combos')?.name ?? 'COMBOS',
    });
  };

  const openEditComboModal = (row) => {
    setComboModalMode('edit');
    setComboError('');
    setComboIngredientQuery('');
    setComboRuleDraft({ mode: 'items', label: '', quantity: '1', category: '', itemIds: [] });
    const editableIngredients = dedupeComboIngredientLines(row.ingredients)
      .filter((line) => inventoryRows.some((item) => item.id === line.itemId))
      .map((line) => ({
        itemId: line.itemId,
        quantity: String(line.quantity),
        selectionMode: line.selectionMode ?? 'item',
        optionItemIds: (line.optionItemIds ?? [line.itemId])
          .filter((itemId) => inventoryRows.some((item) => item.id === itemId)),
        category: line.categoryRule ?? '',
        slotLabel: line.slotLabel ?? line.itemName ?? '',
      }));
    const availablePriceSignatures = new Set(editableIngredients.map(getComboIngredientSignature));
    const savedPriceSignature = String(row.priceIngredientSignature ?? '').trim();
    setComboForm({
      id: row.id,
      name: row.name,
      category: row.category || 'COMBOS',
      rentalPriceBs: String(row.price ?? 0),
      pricingCondition: {
        enabled: Boolean(row.pricingCondition?.enabled),
        upToQuantity: String(row.pricingCondition?.upToQuantity ?? 3),
        upToUnitPriceBs: String(row.pricingCondition?.upToUnitPriceBs ?? row.price ?? 0),
        aboveUnitPriceBs: String(row.pricingCondition?.aboveUnitPriceBs ?? 0),
      },
      notes: row.notes ?? '',
      ingredients: editableIngredients,
      priceIngredientSignature: availablePriceSignatures.has(savedPriceSignature)
        ? savedPriceSignature
        : getComboIngredientSignature(editableIngredients[0]),
      imageUrl: row.imageUrl ?? null,
      imageDataUrl: row.imageDataUrl ?? null,
      imageFile: null,
      imagePreviewUrl: row.imageUrl ?? row.imageDataUrl ?? null,
      imageRemoved: false,
      imageFileName: '',
    });
  };

  const toggleComboRuleItem = (itemId) => {
    setComboRuleDraft((current) => ({
      ...current,
      itemIds: current.itemIds.includes(itemId)
        ? current.itemIds.filter((id) => id !== itemId)
        : [...current.itemIds, itemId],
    }));
  };

  const addComboRule = () => {
    const quantity = Math.max(1, Math.trunc(Number(comboRuleDraft.quantity ?? 1)));
    if (comboRuleDraft.mode === 'category') {
      if (!comboRuleDraft.category) {
        setComboError('Selecciona una categoria para este componente.');
        return;
      }
      const candidates = inventoryRows.filter((row) => normalizeText(row.category) === normalizeText(comboRuleDraft.category));
      if (candidates.length === 0) {
        setComboError('La categoria seleccionada no tiene productos.');
        return;
      }
      const defaultItem = candidates[0];
      const nextLine = {
        itemId: defaultItem.id,
        quantity: String(quantity),
        selectionMode: 'category',
        category: comboRuleDraft.category,
        optionItemIds: candidates.map((row) => row.id),
        slotLabel: comboRuleDraft.label.trim() || comboRuleDraft.category,
      };
      setComboForm((current) => {
        const ingredients = dedupeComboIngredientLines([...current.ingredients, nextLine]);
        return {
          ...current,
          ingredients,
          priceIngredientSignature: current.priceIngredientSignature || getComboIngredientSignature(ingredients[0]),
        };
      });
    } else {
      if (comboRuleDraft.itemIds.length === 0) {
        setComboError('Selecciona uno o mas productos alternativos.');
        return;
      }
      const defaultItem = inventoryRows.find((row) => row.id === comboRuleDraft.itemIds[0]);
      const nextLine = {
        itemId: comboRuleDraft.itemIds[0],
        quantity: String(quantity),
        selectionMode: comboRuleDraft.itemIds.length > 1 ? 'options' : 'item',
        category: '',
        optionItemIds: comboRuleDraft.itemIds,
        slotLabel: comboRuleDraft.label.trim() || defaultItem?.name || 'Componente',
      };
      setComboForm((current) => {
        const ingredients = dedupeComboIngredientLines([...current.ingredients, nextLine]);
        return {
          ...current,
          ingredients,
          priceIngredientSignature: current.priceIngredientSignature || getComboIngredientSignature(ingredients[0]),
        };
      });
    }
    setComboRuleDraft({ mode: 'items', label: '', quantity: '1', category: '', itemIds: [] });
    setComboIngredientQuery('');
    setComboError('');
  };

  const updateComboIngredientQuantity = (lineIndex, value) => {
    setComboForm((current) => ({
      ...current,
      ingredients: current.ingredients.map((line, index) => (
        index === lineIndex ? { ...line, quantity: value } : line
      )),
    }));
  };

  const selectComboPriceIngredient = (lineIndex) => {
    setComboForm((current) => ({
      ...current,
      priceIngredientSignature: getComboIngredientSignature(current.ingredients[lineIndex]),
    }));
  };

  const removeComboIngredient = (lineIndex) => {
    setComboForm((current) => {
      const removedSignature = getComboIngredientSignature(current.ingredients[lineIndex]);
      const ingredients = current.ingredients.filter((_, index) => index !== lineIndex);
      return {
        ...current,
        ingredients,
        priceIngredientSignature: current.priceIngredientSignature === removedSignature
          ? getComboIngredientSignature(ingredients[0])
          : current.priceIngredientSignature,
      };
    });
  };

  const handleDeleteCombo = async (row) => {
    const shouldDelete = window.confirm(`Se eliminara el combo "${row.name}". Deseas continuar?`);
    if (!shouldDelete) return;
    try {
      await onRemoveInventoryCombo?.({ id: row.id });
      showMessage('Combo eliminado correctamente.');
      setRowMenuOpenId(null);
    } catch (error) {
      showMessage(error?.message || 'No se pudo eliminar el combo.', 'error');
    }
  };

  const handleProductImageChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        throw new Error('Selecciona una imagen valida (JPG, PNG o WEBP).');
      }
      if (file.size > 8 * 1024 * 1024) {
        throw new Error('La imagen supera el limite de 8 MB.');
      }
      const previewUrl = URL.createObjectURL(file);
      setProductForm((current) => ({
        ...current,
        imageFile: file,
        imagePreviewUrl: previewUrl,
        imageRemoved: false,
        imageFileName: file.name,
      }));
    } catch (error) {
      setProductError(error?.message || 'No se pudo cargar la imagen.');
    }
  };

  const handleComboImageChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        throw new Error('Selecciona una imagen valida (JPG, PNG o WEBP).');
      }
      if (file.size > 8 * 1024 * 1024) {
        throw new Error('La imagen supera el limite de 8 MB.');
      }
      const previewUrl = URL.createObjectURL(file);
      setComboForm((current) => ({
        ...current,
        imageFile: file,
        imagePreviewUrl: previewUrl,
        imageRemoved: false,
        imageFileName: file.name,
      }));
    } catch (error) {
      setComboError(error?.message || 'No se pudo cargar la imagen del combo.');
    }
  };

  const handleDeleteProduct = async (row) => {
    const shouldDelete = window.confirm(`Se eliminara "${row.name}". Deseas continuar?`);
    if (!shouldDelete) return;
    try {
      await onRemoveInventoryItem?.({ id: row.id });
      showMessage('Producto eliminado correctamente.');
      setRowMenuOpenId(null);
    } catch (error) {
      showMessage(error?.message || 'No se pudo eliminar el producto.', 'error');
    }
  };

  const handleValidateProductStock = async (row) => {
    if (Number(row.total ?? 0) <= 0) {
      showMessage('Antes de validar este item, registra su stock total real con un ajuste o editando el producto.', 'error');
      setRowMenuOpenId(null);
      return;
    }
    const shouldValidate = window.confirm(
      `Se validara "${row.name}" con stock total ${row.total} y disponible ${row.available}. Desde ahora descontara stock en nuevas ordenes. Continuar?`,
    );
    if (!shouldValidate) return;
    try {
      await onUpdateInventoryItem?.({
        id: row.id,
        controlsStock: true,
        verificationStatus: 'verified',
        adoptionSource: 'inventory_verified',
      });
      showMessage('Item validado. Desde ahora controla y descuenta stock en nuevas ordenes.');
      setRowMenuOpenId(null);
    } catch (error) {
      showMessage(error?.message || 'No se pudo validar el item.', 'error');
    }
  };

  const handlePauseProductStockControl = async (row) => {
    const shouldPause = window.confirm(
      `Se desactivara el control de stock para "${row.name}". Seguira disponible para ordenes, pero no descontara cantidades nuevas hasta volver a validarlo. Continuar?`,
    );
    if (!shouldPause) return;
    try {
      await onUpdateInventoryItem?.({
        id: row.id,
        controlsStock: false,
        verificationStatus: 'pending_verification',
        adoptionSource: 'manual_inventory_pending',
      });
      showMessage('Control de stock pausado para este item.');
      setRowMenuOpenId(null);
    } catch (error) {
      showMessage(error?.message || 'No se pudo pausar el control del item.', 'error');
    }
  };

  const openCreateCategoryModal = () => {
    setCategoryModalMode('create');
    setCategoryForm(EMPTY_CATEGORY_FORM);
    setCategoryError('');
  };

  const openEditCategoryModal = (row) => {
    if (!row?.id || String(row.id).startsWith('virtual-')) {
      showMessage('Esta categoria no se puede editar desde aqui.', 'error');
      return;
    }
    setCategoryModalMode('edit');
    setCategoryForm({
      id: row.id,
      name: row.name ?? '',
      icon: row.icon ?? 'box',
      color: normalizeHexColor(row.color, DEFAULT_CATEGORY_COLOR),
    });
    setCategoryError('');
  };

  const handleDeleteCategory = async (row) => {
    if (!row?.id || String(row.id).startsWith('virtual-')) {
      showMessage('Esta categoria no se puede eliminar desde aqui.', 'error');
      return;
    }
    const shouldDelete = window.confirm(`Se eliminara la categoria "${row.name}". Deseas continuar?`);
    if (!shouldDelete) return;
    try {
      await onRemoveCategory?.({ id: row.id });
      showMessage('Categoria eliminada correctamente.');
      setRowMenuOpenId(null);
    } catch (error) {
      showMessage(error?.message || 'No se pudo eliminar la categoria.', 'error');
    }
  };

  const handleSubmitCategory = async (event) => {
    event.preventDefault();
    setCategoryError('');

    const payload = {
      id: String(categoryForm.id ?? '').trim(),
      name: String(categoryForm.name ?? '').trim(),
      icon: String(categoryForm.icon ?? 'box').trim() || 'box',
      color: normalizeHexColor(categoryForm.color, DEFAULT_CATEGORY_COLOR),
    };
    const rawColor = String(categoryForm.color ?? '').trim();
    const isHexColor = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(rawColor);

    if (!payload.name) {
      setCategoryError('El nombre de categoria es obligatorio.');
      return;
    }
    if (!isHexColor) {
      setCategoryError('El color debe estar en formato HEX valido, por ejemplo #5D59E0.');
      return;
    }

    try {
      if (categoryModalMode === 'edit') {
        await onUpdateCategory?.(payload);
        showMessage('Categoria actualizada correctamente.');
      } else {
        await onCreateCategory?.(payload);
        showMessage('Categoria creada correctamente.');
      }
      setCategoryModalMode(null);
      setCategoryForm(EMPTY_CATEGORY_FORM);
    } catch (error) {
      setCategoryError(error?.message || 'No se pudo guardar la categoria.');
    }
  };

  const handleSubmitProduct = async (event) => {
    event.preventDefault();
    if (isSavingProduct) return;
    setProductError('');

    const nextTotalStock = Math.trunc(Number(productForm.totalStock ?? 0));
    const originalTotalStock = productForm.originalTotalStock === null || productForm.originalTotalStock === undefined
      ? null
      : Math.trunc(Number(productForm.originalTotalStock));
    const stockWasEdited = productModalMode !== 'edit'
      || originalTotalStock === null
      || nextTotalStock !== originalTotalStock;

    const payload = {
      id: productForm.id,
      name: String(productForm.name ?? '').trim(),
      sku: String(productForm.sku ?? '').trim(),
      category: String(productForm.category ?? '').trim(),
      brand: String(productForm.brand ?? '').trim(),
      itemColor: String(productForm.itemColor ?? '').trim(),
      rentalPriceBs: Number(productForm.rentalPriceBs ?? 0),
      damagedUnitChargeBs: Number(productForm.damagedUnitChargeBs ?? 0),
      missingUnitChargeBs: Number(productForm.missingUnitChargeBs ?? 0),
      needsCleaningOnReturn: Boolean(productForm.needsCleaningOnReturn),
      imageUrl: productForm.imageUrl || null,
    };
    if (stockWasEdited) {
      payload.totalStock = nextTotalStock;
    }
    if (productForm.imageRemoved) {
      payload.imageUrl = null;
      payload.imageDataUrl = null;
    }

    if (!payload.name) {
      setProductError('El nombre del producto es obligatorio.');
      return;
    }
    if (!payload.category) {
      setProductError('Selecciona una categoria para el producto.');
      return;
    }
    if (stockWasEdited && (!Number.isFinite(payload.totalStock) || payload.totalStock <= 0)) {
      setProductError('El stock total debe ser mayor a 0.');
      return;
    }
    if (!Number.isFinite(payload.rentalPriceBs) || payload.rentalPriceBs < 0) {
      setProductError('El precio de alquiler no es valido.');
      return;
    }

    try {
      setIsSavingProduct(true);
      if (productForm.imageFile) {
        const upload = await onUploadProductImage?.(productForm.imageFile, {
          itemId: productForm.id || productForm.sku || productForm.name,
        });
        if (!upload?.imageUrl) {
          throw new Error('El servidor no devolvio la URL de la imagen.');
        }
        payload.imageUrl = upload.imageUrl;
        payload.imageDataUrl = null;
      }
      if (productModalMode === 'edit') {
        await onUpdateInventoryItem?.(payload);
        showMessage('Producto actualizado correctamente.');
      } else {
        await onCreateInventoryItem?.(payload);
        showMessage('Producto creado correctamente.');
      }
      setProductModalMode(null);
      setProductForm(EMPTY_PRODUCT_FORM);
    } catch (error) {
      setProductError(error?.message || 'No se pudo guardar el producto.');
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleSubmitCombo = async (event) => {
    event.preventDefault();
    if (isSavingCombo) return;
    setComboError('');

    const activeItemIds = new Set(inventoryRows.map((item) => item.id));
    const normalizedIngredients = dedupeComboIngredientLines(comboForm.ingredients)
      .filter((line) => activeItemIds.has(line.itemId))
      .map((line) => ({
        ...line,
        optionItemIds: (line.optionItemIds ?? [line.itemId]).filter((itemId) => activeItemIds.has(itemId)),
      }));
    const normalizedPriceSignatures = new Set(normalizedIngredients.map(getComboIngredientSignature));
    const requestedPriceSignature = String(comboForm.priceIngredientSignature ?? '').trim();
    const payload = {
      id: comboForm.id,
      name: String(comboForm.name ?? '').trim(),
      category: String(comboForm.category ?? 'COMBOS').trim() || 'COMBOS',
      rentalPriceBs: Number(comboForm.rentalPriceBs ?? 0),
      pricingCondition: {
        enabled: Boolean(comboForm.pricingCondition?.enabled),
        upToQuantity: Math.max(1, Math.trunc(Number(comboForm.pricingCondition?.upToQuantity ?? 3))),
        upToUnitPriceBs: Number(comboForm.pricingCondition?.upToUnitPriceBs ?? 0),
        aboveUnitPriceBs: Number(comboForm.pricingCondition?.aboveUnitPriceBs ?? 0),
      },
      notes: String(comboForm.notes ?? '').trim(),
      imageUrl: comboForm.imageUrl || null,
      priceIngredientSignature: normalizedPriceSignatures.has(requestedPriceSignature)
        ? requestedPriceSignature
        : getComboIngredientSignature(normalizedIngredients[0]),
      ingredients: normalizedIngredients.map((line) => ({
        itemId: line.itemId,
        quantity: Math.max(1, Math.trunc(Number(line.quantity ?? 1))),
        selectionMode: line.selectionMode ?? 'item',
        optionItemIds: line.optionItemIds ?? [line.itemId],
        category: line.category ?? '',
        slotLabel: line.slotLabel ?? '',
      })),
    };

    if (!payload.name) {
      setComboError('El nombre del combo es obligatorio.');
      return;
    }
    if (!Number.isFinite(payload.rentalPriceBs) || payload.rentalPriceBs < 0) {
      setComboError('El precio del combo no es valido.');
      return;
    }
    if (
      payload.pricingCondition.enabled
      && (
        !Number.isFinite(payload.pricingCondition.upToUnitPriceBs)
        || !Number.isFinite(payload.pricingCondition.aboveUnitPriceBs)
        || payload.pricingCondition.upToUnitPriceBs < 0
        || payload.pricingCondition.aboveUnitPriceBs < 0
      )
    ) {
      setComboError('Los precios condicionados del combo no son validos.');
      return;
    }
    if (payload.ingredients.length === 0) {
      setComboError('Agrega al menos un producto existente al combo.');
      return;
    }

    try {
      setIsSavingCombo(true);
      if (comboForm.imageRemoved) {
        payload.imageUrl = null;
        payload.imageDataUrl = null;
      }
      if (comboForm.imageFile) {
        const upload = await onUploadProductImage?.(comboForm.imageFile, {
          itemId: `combo-${comboForm.id || comboForm.name}`,
        });
        if (!upload?.imageUrl) {
          throw new Error('El servidor no devolvio la URL de la imagen.');
        }
        payload.imageUrl = upload.imageUrl;
        payload.imageDataUrl = null;
      }
      if (comboModalMode === 'edit') {
        await onUpdateInventoryCombo?.(payload);
        showMessage('Combo actualizado correctamente.');
      } else {
        await onCreateInventoryCombo?.(payload);
        showMessage('Combo creado correctamente.');
      }
      setComboModalMode(null);
      setComboForm(EMPTY_COMBO_FORM);
    } catch (error) {
      setComboError(error?.message || 'No se pudo guardar el combo.');
    } finally {
      setIsSavingCombo(false);
    }
  };

  const handleSubmitMovement = async (event) => {
    event.preventDefault();
    setMovementError('');
    const payload = {
      itemId: movementForm.itemId,
      type: movementForm.type,
      reason: String(movementForm.reason ?? '').trim(),
    };
    if (!payload.itemId) {
      setMovementError('Debes seleccionar un producto.');
      return;
    }
    if (!payload.reason) {
      setMovementError('Debes escribir el motivo del movimiento.');
      return;
    }
    if (payload.type === 'ajuste') {
      const targetTotalStock = Math.trunc(Number(movementForm.targetTotalStock ?? 0));
      if (!Number.isFinite(targetTotalStock) || targetTotalStock < 0) {
        setMovementError('Ingresa un stock fisico valido.');
        return;
      }
      payload.targetTotalStock = targetTotalStock;
    } else {
      const quantity = Math.trunc(Number(movementForm.quantity ?? 0));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setMovementError('La cantidad debe ser mayor a 0.');
        return;
      }
      payload.quantity = quantity;
    }

    try {
      await onCreateInventoryMovement?.(payload);
      showMessage(
        payload.type === 'ajuste'
          ? `Stock fisico ajustado al valor final ${payload.targetTotalStock}.`
          : 'Movimiento registrado correctamente.',
      );
      closeMovementModal();
    } catch (error) {
      setMovementError(error?.message || 'No se pudo registrar el movimiento.');
    }
  };

  const openReceivingModal = (row) => {
    const pickupItems = row.rental.pickupChecklist?.items ?? [];
    const partialItems = Array.isArray(row.rental.partialReturnReport?.items) ? row.rental.partialReturnReport.items : [];
    const getPreviouslyProcessedQty = (line, lineKey) => partialItems
      .filter((entry) => (
        String(entry?.lineKey ?? '') === String(lineKey)
        || (!entry?.lineKey && String(entry?.itemId ?? '') === String(line.itemId ?? ''))
      ))
      .reduce((sum, entry) => sum
        + Math.max(0, Math.trunc(Number(entry?.returnedQty ?? 0)))
        + Math.max(0, Math.trunc(Number(entry?.damagedQty ?? 0))), 0);
    setReceivingError('');
    setReceivingModal({
      rental: {
        ...row.rental,
        contractCode: row.contractCode ?? row.rental.contractCode ?? '',
      },
      returnReviewStatus: row.returnReview?.status ?? 'complete',
      clientPendingNote: row.clientPendingPickup?.note ?? '',
      notes: '',
      items: (row.rental.items ?? []).map((line, index) => {
        const returnLineKey = String(
          line.lineKey
          ?? `${line.comboLineKey || 'item'}-${line.itemId || 'sin-item'}-${line.comboRuleIndex ?? index}-${index}`,
        );
        const picked = pickupItems.find((entry) =>
          String(entry.lineKey ?? entry.returnLineKey ?? '') === returnLineKey
          || (!entry.lineKey && !entry.returnLineKey && entry.itemId === line.itemId)
        );
        const originalExpectedQty = Math.max(0, Math.trunc(Number(line.quantity ?? 0)));
        const expectedQty = Math.max(0, originalExpectedQty - getPreviouslyProcessedQty(line, returnLineKey));
        const inventoryItem = items.find((item) => String(item?.id ?? '') === String(line?.itemId ?? ''));
        const configuredDamagedUnitChargeBs = Math.max(
          0,
          Number(
            inventoryItem?.damagedUnitChargeBs
            ?? line?.damagedUnitChargeBs
            ?? line?.rentalPriceBs
            ?? 0,
          ),
        );
        const configuredMissingUnitChargeBs = Math.max(
          0,
          Number(
            inventoryItem?.missingUnitChargeBs
            ?? line?.missingUnitChargeBs
            ?? line?.rentalPriceBs
            ?? 0,
          ),
        );
        const damagedQty = expectedQty <= 0
          ? 0
          : picked?.condition === 'danado'
            ? Math.min(expectedQty, Number(picked?.pickedQty ?? 0))
            : 0;
        const missingQty = picked?.condition === 'faltante'
          ? expectedQty
          : Math.max(0, expectedQty - Number(picked?.pickedQty ?? expectedQty));
        return {
          lineKey: line.lineKey ?? returnLineKey,
          returnLineKey,
          itemId: line.itemId,
          itemName: line.itemName,
          comboId: line.comboId ?? null,
          comboName: line.comboName ?? '',
          comboLineKey: line.comboLineKey ?? null,
          comboComponentName: line.comboComponentName ?? '',
          comboRuleIndex: line.comboRuleIndex ?? index,
          expectedQty,
          originalExpectedQty,
          returnedQty: expectedQty <= 0 ? 0 : picked?.condition === 'faltante' ? 0 : Math.min(expectedQty, Number(picked?.pickedQty ?? expectedQty)),
          damagedQty,
          missingQty,
          configuredDamagedUnitChargeBs,
          configuredMissingUnitChargeBs,
          damagedUnitChargeBs: damagedQty > 0 ? configuredDamagedUnitChargeBs : 0,
          missingUnitChargeBs: missingQty > 0 ? configuredMissingUnitChargeBs : 0,
          chargeOwner: 'cliente',
          damageNote: picked?.note ?? '',
        };
      }),
    });
  };

  const openDispatchReviewModal = (row) => {
    setDispatchReviewError('');
    setDispatchReviewModal(row);
    setDispatchReviewForm(buildDispatchReviewForm(row));
  };

  const updateDispatchLine = (lineKey, field, value) => {
    setDispatchReviewForm((current) => ({
      ...current,
      items: current.items.map((line) => {
        if (line.lineKey !== lineKey) return line;
        const nextLine = { ...line, [field]: value };
        if (field === 'dispatchedQty') {
          const expectedQty = Math.max(0, Math.trunc(Number(nextLine.expectedQty ?? 0)));
          const dispatchedQty = Math.max(0, Math.min(expectedQty, Math.trunc(Number(nextLine.dispatchedQty ?? 0))));
          nextLine.dispatchedQty = dispatchedQty;
          nextLine.pendingQty = Math.max(0, expectedQty - dispatchedQty);
        }
        if (field === 'pendingQty') {
          const expectedQty = Math.max(0, Math.trunc(Number(nextLine.expectedQty ?? 0)));
          const pendingQty = Math.max(0, Math.min(expectedQty, Math.trunc(Number(nextLine.pendingQty ?? 0))));
          nextLine.pendingQty = pendingQty;
          nextLine.dispatchedQty = Math.max(0, expectedQty - pendingQty);
        }
        return nextLine;
      }),
    }));
  };

  const submitDispatchReview = async (event) => {
    event.preventDefault();
    if (!dispatchReviewModal || isSavingDispatchReview) return;
    const normalizedItems = dispatchReviewForm.items.map((line) => ({
      ...line,
      expectedQty: Math.max(0, Math.trunc(Number(line.expectedQty ?? 0))),
      dispatchedQty: Math.max(0, Math.trunc(Number(line.dispatchedQty ?? 0))),
      pendingQty: Math.max(0, Math.trunc(Number(line.pendingQty ?? 0))),
      note: String(line.note ?? '').trim(),
    }));
    const invalidLine = normalizedItems.find((line) => line.dispatchedQty + line.pendingQty !== line.expectedQty);
    if (invalidLine) {
      setDispatchReviewError(`Revisa "${invalidLine.itemName}": salio + pendiente debe sumar ${invalidLine.expectedQty}.`);
      return;
    }
    const pendingQty = normalizedItems.reduce((sum, line) => sum + line.pendingQty, 0);
    const status = pendingQty > 0
      ? dispatchReviewForm.status === 'pending_extra' ? 'pending_extra' : 'partial'
      : 'complete';
    const needsNote = pendingQty > 0;
    if (needsNote && !String(dispatchReviewForm.note ?? '').trim()) {
      setDispatchReviewError('Describe que salio parcial o que queda pendiente por enviar.');
      return;
    }
    setDispatchReviewError('');
    setIsSavingDispatchReview(true);
    const optimisticReview = {
      status,
      note: String(dispatchReviewForm.note ?? '').trim(),
      items: normalizedItems,
    };
    setOperationalOverrides((current) => ({
      ...current,
      [dispatchReviewModal.rentalId]: {
        ...(current[dispatchReviewModal.rentalId] ?? {}),
        inventoryStatus: 'salio',
        dispatchReview: optimisticReview,
        revisionAlert: null,
      },
    }));
    const targetOrderCode = dispatchReviewModal.orderCode;
    setDispatchReviewModal(null);
    try {
      await onUpdateOrderOperational?.({
        id: dispatchReviewModal.rentalId,
        inventoryStatus: 'salio',
        dispatchReview: optimisticReview,
        clearOperationalRevisionAlert: true,
      });
      showMessage(`Salida revisada para ${targetOrderCode}.`);
    } catch (error) {
      setOperationalOverrides((current) => {
        const next = { ...current };
        delete next[dispatchReviewModal.rentalId];
        return next;
      });
      setFeedback(error?.message || 'No se pudo registrar la salida.');
      setFeedbackType('error');
    } finally {
      setIsSavingDispatchReview(false);
    }
  };

  const handleInventoryOrderAction = async (row) => {
    try {
      if (row.inventoryAction === 'return') {
        openReceivingModal(row);
        return;
      }
      if (row.inventoryAction === 'dispatch') {
        openDispatchReviewModal(row);
        return;
      }
      const inventoryStatus = row.inventoryAction === 'dispatch' ? 'salio' : 'confirmado';
      setOperationalOverrides((current) => ({
        ...current,
        [row.rentalId]: {
          ...(current[row.rentalId] ?? {}),
          inventoryStatus,
        },
      }));
      await onUpdateOrderOperational?.({ id: row.rentalId, inventoryStatus });
      showMessage(
        inventoryStatus === 'salio'
          ? `Salida registrada para ${row.orderCode}.`
          : `${row.orderCode} marcada como lista para salir.`,
      );
    } catch (error) {
      setOperationalOverrides((current) => {
        const next = { ...current };
        delete next[row.rentalId];
        return next;
      });
      setFeedback(error?.message || 'No se pudo actualizar el estado de la orden.');
      setFeedbackType('error');
    }
  };

  const openOperationalEditModal = (row) => {
    setRowMenuOpenId(null);
    setOperationalEditError('');
    setOperationalEditRow(row);
    setOperationalEditForm({
      inventoryStatus: row.inventoryStatus ?? 'pendiente',
      inventoryNote: row.inventoryNote ?? '',
    });
  };

  const submitOperationalEdit = async (event) => {
    event.preventDefault();
    if (!operationalEditRow || isSavingOperationalEdit) return;
    setOperationalEditError('');
    setIsSavingOperationalEdit(true);
    try {
      await onUpdateOrderOperational?.({
        id: operationalEditRow.rentalId,
        inventoryStatus: operationalEditForm.inventoryStatus,
        inventoryNote: operationalEditForm.inventoryNote,
      });
      setOperationalEditRow(null);
      showMessage(`Orden ${operationalEditRow.orderCode} actualizada correctamente.`);
    } catch (error) {
      setOperationalEditError(error?.message || 'No se pudo editar la orden operativa.');
    } finally {
      setIsSavingOperationalEdit(false);
    }
  };

  const handleDeleteOperationalOrder = async (row) => {
    setRowMenuOpenId(null);
    if (!onRemoveOrder) {
      setFeedback('No hay permisos para eliminar esta orden.');
      setFeedbackType('error');
      return;
    }
    const confirmed = window.confirm(`Eliminar la orden ${row.orderCode} del contrato ${row.contractCode}?`);
    if (!confirmed) return;
    try {
      await onRemoveOrder({ id: row.rentalId });
      showMessage(`Orden ${row.orderCode} eliminada correctamente.`);
    } catch (error) {
      setFeedback(error?.message || 'No se pudo eliminar la orden.');
      setFeedbackType('error');
    }
  };

  const updateReceivingLine = (returnLineKey, field, value) => {
    setReceivingModal((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((line) => {
          if (line.returnLineKey !== returnLineKey) return line;
          const nextLine = { ...line, [field]: value };
          if (field === 'returnedQty' || field === 'damagedQty') {
            const expectedQty = Math.max(0, Math.trunc(Number(nextLine.expectedQty ?? 0)));
            const returnedQty = Math.max(0, Math.trunc(Number(nextLine.returnedQty ?? 0)));
            const damagedQty = Math.max(0, Math.trunc(Number(nextLine.damagedQty ?? 0)));
            nextLine.missingQty = String(Math.max(0, expectedQty - returnedQty - damagedQty));
          }

          const damagedQty = Math.max(0, Math.trunc(Number(nextLine.damagedQty ?? 0)));
          const missingQty = Math.max(0, Math.trunc(Number(nextLine.missingQty ?? 0)));

          if (field !== 'damagedUnitChargeBs') {
            nextLine.damagedUnitChargeBs = damagedQty > 0
              ? Number(nextLine.damagedUnitChargeBs ?? 0) > 0
                ? nextLine.damagedUnitChargeBs
                : nextLine.configuredDamagedUnitChargeBs
              : 0;
          }
          if (field !== 'missingUnitChargeBs') {
            nextLine.missingUnitChargeBs = missingQty > 0
              ? Number(nextLine.missingUnitChargeBs ?? 0) > 0
                ? nextLine.missingUnitChargeBs
                : nextLine.configuredMissingUnitChargeBs
              : 0;
          }

          return nextLine;
        }),
      };
    });
  };

  const getReceivingLineNumbers = (line) => {
    const expectedQty = Math.max(0, Math.trunc(Number(line.expectedQty ?? 0)));
    const returnedQty = Math.max(0, Math.trunc(Number(line.returnedQty ?? 0)));
    const damagedQty = Math.max(0, Math.trunc(Number(line.damagedQty ?? 0)));
    const missingQty = Math.max(0, Math.trunc(Number(line.missingQty ?? 0)));
    const damagedUnitChargeBs = Math.max(0, Number(line.damagedUnitChargeBs ?? 0));
    const missingUnitChargeBs = Math.max(0, Number(line.missingUnitChargeBs ?? 0));
    const penaltyBs = Number(((damagedQty * damagedUnitChargeBs) + (missingQty * missingUnitChargeBs)).toFixed(2));
    const balanceQty = expectedQty - returnedQty - damagedQty - missingQty;
    return { expectedQty, returnedQty, damagedQty, missingQty, damagedUnitChargeBs, missingUnitChargeBs, penaltyBs, balanceQty };
  };

  const receivingTotals = useMemo(() => {
    if (!receivingModal) return { penaltyBs: 0, clientPenaltyBs: 0, internalPenaltyBs: 0, issueRows: 0 };
    const isPendingWithClient = receivingModal.returnReviewStatus === 'left_with_client';
    return receivingModal.items.reduce((totals, line) => {
      const values = getReceivingLineNumbers(line);
      if (values.damagedQty > 0 || values.missingQty > 0) totals.issueRows += 1;
      const linePenaltyBs = isPendingWithClient
        ? Number((values.damagedQty * values.damagedUnitChargeBs).toFixed(2))
        : values.penaltyBs;
      totals.penaltyBs = Number((totals.penaltyBs + linePenaltyBs).toFixed(2));
      if (line.chargeOwner === 'cliente') {
        totals.clientPenaltyBs = Number((totals.clientPenaltyBs + linePenaltyBs).toFixed(2));
      } else {
        totals.internalPenaltyBs = Number((totals.internalPenaltyBs + linePenaltyBs).toFixed(2));
      }
      return totals;
    }, { penaltyBs: 0, clientPenaltyBs: 0, internalPenaltyBs: 0, issueRows: 0 });
  }, [receivingModal]);

  const submitReceiving = async (event) => {
    event.preventDefault();
    if (!receivingModal || isReceiving) return;
    setReceivingError('');
    if (receivingModal.returnReviewStatus === 'left_with_client') {
      const note = String(receivingModal.clientPendingNote ?? '').trim();
      const pendingItems = receivingModal.items
        .map((line) => {
          const values = getReceivingLineNumbers(line);
          return {
            lineKey: line.lineKey,
            itemId: line.itemId,
            itemName: line.itemName,
            expectedQty: values.expectedQty,
            pendingQty: values.missingQty,
            note: String(line.damageNote ?? '').trim(),
          };
        })
        .filter((line) => line.pendingQty > 0);
      if (!note) {
        setReceivingError('Describe que material quedo con el cliente y como se recogera despues.');
        return;
      }
      if (pendingItems.length === 0) {
        setReceivingError('Registra en la columna pendiente la cantidad que quedo con el cliente.');
        return;
      }
      setIsReceiving(true);
      const currentRentalId = receivingModal.rental.id;
      setReceivingModal(null);
      setReturnProcessingMessage('Registrando recepcion de inventario...');
      try {
        await yieldToBrowser();
        await onReceiveReturnedOrder?.({
          rentalId: currentRentalId,
          partialReturn: true,
          returnReview: {
            status: 'left_with_client',
            note,
          },
          clientPendingPickup: {
            active: true,
            note,
            items: pendingItems,
          },
          returnedItems: receivingModal.items.map((line) => {
            const values = getReceivingLineNumbers(line);
            return {
              ...line,
              returnedQty: values.returnedQty,
              damagedQty: values.damagedQty,
              missingQty: values.missingQty,
              damagedUnitChargeBs: values.damagedUnitChargeBs,
              missingUnitChargeBs: values.missingUnitChargeBs,
            };
          }),
        });
        showMessage('Se reingreso lo recibido y quedo registrado el saldo pendiente con cliente.');
      } catch (error) {
        setReceivingModal(receivingModal);
        setReceivingError(error?.message || 'No se pudo registrar el pendiente con cliente.');
      } finally {
        setIsReceiving(false);
        setReturnProcessingMessage('');
      }
      return;
    }
    setIsReceiving(true);
    const currentRentalId = receivingModal.rental.id;
    setReceivingModal(null);
    setReturnProcessingMessage('Cerrando recepcion de inventario...');
    setOperationalOverrides((current) => ({
      ...current,
      [currentRentalId]: {
        ...(current[currentRentalId] ?? {}),
        inventoryStatus: 'devuelto',
        returnReview: {
          status: receivingModal.returnReviewStatus,
          note: String(receivingModal.notes ?? '').trim(),
        },
        clientPendingPickup: null,
        inventoryReturnedAt: new Date().toISOString(),
      },
    }));
    try {
      await yieldToBrowser();
      await onReceiveReturnedOrder?.({
        rentalId: currentRentalId,
        returnReview: {
          status: receivingModal.returnReviewStatus,
          note: String(receivingModal.notes ?? '').trim(),
        },
        clientPendingPickup: { active: false, note: '' },
        returnedItems: receivingModal.items.map((line) => {
          const values = getReceivingLineNumbers(line);
          return {
            ...line,
            returnedQty: values.returnedQty,
            damagedQty: values.damagedQty,
            missingQty: values.missingQty,
            damagedUnitChargeBs: values.damagedUnitChargeBs,
            missingUnitChargeBs: values.missingUnitChargeBs,
          };
        }),
      });
      showMessage('Recepcion de inventario registrada correctamente.');
    } catch (error) {
      setOperationalOverrides((current) => {
        const next = { ...current };
        delete next[currentRentalId];
        return next;
      });
      setReceivingModal(receivingModal);
      setReceivingError(error?.message || 'No se pudo registrar la recepcion.');
    } finally {
      setIsReceiving(false);
      setReturnProcessingMessage('');
    }
  };

  const shouldOpenMenuUp = (index, total) => {
    if (total <= 1) return false;
    if (total === 2) return index === 1;
    return index >= total - 2;
  };

  const toggleRowMenu = (rowId, event, openUp = false) => {
    if (rowMenuOpenId === rowId) {
      setRowMenuOpenId(null);
      setRowMenuPosition(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 188;
    const gutter = 8;
    const left = Math.min(
      Math.max(gutter, rect.right - menuWidth),
      window.innerWidth - menuWidth - gutter,
    );

    setRowMenuPosition({
      top: openUp ? rect.top - 6 : rect.bottom + 6,
      left,
    });
    setRowMenuOpenId(rowId);
  };

  const getRowMenuStyle = () =>
    rowMenuPosition
      ? {
          top: rowMenuPosition.top,
          left: rowMenuPosition.left,
        }
      : undefined;

  const openOperationalReport = async (row) => {
    setRowMenuOpenId(null);
    setRowMenuPosition(null);
    setFeedback('');
    setIsLoadingOperationalReport(true);
    try {
      const identifier = row?.rental?.id
        || row?.rentalId
        || row?.orderCode
        || row?.contractCode;
      const fullRental = await api.rentals.getFull(identifier);
      setOperationalReportRow({
        ...row,
        rental: fullRental,
        dispatchReview: fullRental?.dispatchReview ?? row?.dispatchReview ?? null,
        returnReview: fullRental?.returnReview ?? row?.returnReview ?? null,
        clientPendingPickup: fullRental?.clientPendingPickup ?? row?.clientPendingPickup ?? null,
        inventoryStatus: fullRental?.inventoryStatus ?? row?.inventoryStatus,
        inventoryConfirmedAt: fullRental?.inventoryConfirmedAt ?? row?.inventoryConfirmedAt,
        inventoryConfirmedByName: fullRental?.inventoryConfirmedByName ?? row?.inventoryConfirmedByName,
        inventoryDispatchedAt: fullRental?.inventoryDispatchedAt ?? row?.inventoryDispatchedAt,
        inventoryDispatchedByName: fullRental?.inventoryDispatchedByName ?? row?.inventoryDispatchedByName,
        inventoryReturnedAt: fullRental?.inventoryReturnedAt ?? fullRental?.returnedAt ?? row?.inventoryReturnedAt,
        inventoryReturnedByName: fullRental?.inventoryReturnedByName ?? row?.inventoryReturnedByName,
      });
    } catch (reportError) {
      setFeedbackType('error');
      setFeedback(reportError?.message || 'No se pudo cargar el reporte operativo completo.');
    } finally {
      setIsLoadingOperationalReport(false);
    }
  };

  const renderOperationalRowMenu = (row, openUp = false) => (
    <div className={`inventory-row-dropdown floating ${openUp ? 'open-up' : ''}`} style={getRowMenuStyle()} role="menu">
      <button
        type="button"
        onClick={() => openOperationalReport(row)}
        disabled={isLoadingOperationalReport}
      >
        {isLoadingOperationalReport ? 'Cargando reporte...' : 'Reporte operativo'}
      </button>
      <button type="button" onClick={() => openOperationalEditModal(row)}>
        Editar
      </button>
      <button type="button" className="danger" onClick={() => handleDeleteOperationalOrder(row)}>
        Eliminar
      </button>
    </div>
  );

  const comboIngredientRows = comboForm.ingredients
    .map((line, index) => {
      const item = inventoryRows.find((row) => row.id === line.itemId);
      if (!item) return null;
      const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
      const optionRows = inventoryRows.filter((row) => (line.optionItemIds ?? [line.itemId]).includes(row.id));
      return {
        ...line,
        lineIndex: index,
        ingredientSignature: getComboIngredientSignature(line),
        quantity,
        item,
        optionRows,
        lineValue: quantity * Number(item.price ?? 0),
      };
    })
    .filter(Boolean);

  const comboIngredientValue = comboIngredientRows.reduce((sum, line) => sum + line.lineValue, 0);

  const comboSelectableRows = inventoryRows
    .map((row) => ({ row, searchScore: getInventorySearchScore(comboIngredientQuery, row) }))
    .filter((entry) => entry.searchScore >= 0)
    .sort((a, b) => b.searchScore - a.searchScore || a.row.name.localeCompare(b.row.name, 'es'))
    .map((entry) => entry.row)
    .slice(0, 30);

  const renderComboRowMenu = (row, openUp = false) => (
    <div
      className={`inventory-row-dropdown inventory-combo-actions-dropdown floating ${openUp ? 'open-up' : ''}`}
      style={getRowMenuStyle()}
      role="menu"
      aria-label={`Acciones para ${row.name}`}
    >
      <button type="button" onClick={() => { setDetailRow(row); setRowMenuOpenId(null); setRowMenuPosition(null); }}>
        Ver detalle y ubicacion
      </button>
      <button type="button" onClick={() => { openEditComboModal(row); setRowMenuOpenId(null); }}>
        Editar
      </button>
      <button type="button" className="danger" onClick={() => handleDeleteCombo(row)}>
        Eliminar
      </button>
    </div>
  );

  const renderProductRowMenu = (row, openUp = false) => (
    <div className={`inventory-row-dropdown floating ${openUp ? 'open-up' : ''}`} style={getRowMenuStyle()}>
      <button type="button" onClick={() => { setDetailRow(row); setRowMenuOpenId(null); }}>
        Ver detalle y ubicacion
      </button>
      <button type="button" onClick={() => { openEditProductModal(row); setRowMenuOpenId(null); }}>
        Editar producto
      </button>
      <button type="button" onClick={() => openAreaAssignment(row)}>
        Asignar área
      </button>
      <button type="button" onClick={() => { openMovementModal(row, 'ajuste'); setRowMenuOpenId(null); }}>
        Ajuste rapido
      </button>
      {row.controlsStock ? (
        <button type="button" onClick={() => handlePauseProductStockControl(row)}>
          Pausar control de stock
        </button>
      ) : (
        <button type="button" onClick={() => handleValidateProductStock(row)}>
          Validar item y controlar stock
        </button>
      )}
      <button type="button" className="danger" onClick={() => { handleDeleteProduct(row); }}>
        Eliminar
      </button>
    </div>
  );

  const renderInventoryRowMenu = (row, openUp = false) => (
    <div className={`inventory-row-dropdown floating ${openUp ? 'open-up' : ''}`} style={getRowMenuStyle()}>
      <button type="button" onClick={() => { setDetailRow(row); setRowMenuOpenId(null); }}>
        Ver detalle de stock
      </button>
      <button
        type="button"
        onClick={() => {
          onSwitchInventoryModule?.('inventario_movimientos');
          setQuery(row.name || '');
          setShowFilters(true);
          setRowMenuOpenId(null);
        }}
      >
        Ver movimientos del item
      </button>
      <button
        type="button"
        onClick={() => {
          onSwitchInventoryModule?.('inventario_ajustes');
          openMovementModal(row, 'ajuste');
          setRowMenuOpenId(null);
        }}
      >
        Crear ajuste
      </button>
    </div>
  );

  const renderCategoryRowMenu = (row, openUp = false) => (
    <div className={`inventory-row-dropdown floating ${openUp ? 'open-up' : ''}`} style={getRowMenuStyle()}>
      <button
        type="button"
        onClick={() => {
          onSwitchInventoryModule?.('inventario_productos');
          setCategoryFilter(row.name);
          setShowFilters(true);
          setRowMenuOpenId(null);
        }}
      >
        Ver productos de categoria
      </button>
      <button
        type="button"
        onClick={() => {
          openEditCategoryModal(row);
          setRowMenuOpenId(null);
        }}
      >
        Editar categoria
      </button>
      <button
        type="button"
        className="danger"
        onClick={() => {
          handleDeleteCategory(row);
        }}
      >
        Eliminar categoria
      </button>
    </div>
  );

  const renderMovementRowMenu = (row, openUp = false) => (
    <div className={`inventory-row-dropdown floating ${openUp ? 'open-up' : ''}`} style={getRowMenuStyle()}>
      <button type="button" onClick={() => { setDetailRow(row); setRowMenuOpenId(null); }}>
        Ver detalle
      </button>
      <button type="button" onClick={() => { setQuery(row.itemName || row.name || ''); setRowMenuOpenId(null); }}>
        Filtrar por producto
      </button>
      <button
        type="button"
        onClick={() => {
          if (row.itemId) {
            onSwitchInventoryModule?.('inventario_ajustes');
            openMovementModal(row, 'ajuste');
          }
          setRowMenuOpenId(null);
        }}
      >
        Crear ajuste
      </button>
    </div>
  );

  if (isMaintenanceModule) {
    return (
      <section className={`inventory-maintenance-workspace ${moduleViewClass}`}>
        <header className="inventory-header">
          <div>
            <h2>{moduleTitle}</h2>
            <p>{moduleSubtitle}</p>
          </div>
          <div className="inventory-actions">
            <button type="button" className="link-button" onClick={() => onSwitchInventoryModule?.('inventario')}>
              Volver a Inventario
            </button>
            <button type="button" className="ghost-button" onClick={() => onSwitchInventoryModule?.('inventario_movimientos')}>
              Ver Movimientos
            </button>
          </div>
        </header>

        {feedback ? (
          <p className={`status ${feedbackType === 'error' ? 'error' : ''}`}>{feedback}</p>
        ) : null}
        {moduleLoading ? <p className="status">Cargando inventario...</p> : null}
        {returnProcessingMessage ? <p className="status">{returnProcessingMessage}</p> : null}

        <InventoryOpsSection
          items={items}
          activeRentals={activeRentals}
          stockRecoveries={stockRecoveries}
          inventoryMovements={inventoryMovements}
          stockMovementForm={movementForm}
          setStockMovementForm={setMovementForm}
          handleStockMovementSubmit={handleSubmitMovement}
          handleProcessRecovery={onProcessStockRecovery}
          formatBs={formatBs}
        />
      </section>
    );
  }

  return (
    <section className={`panel inventory-dashboard ${moduleViewClass}`}>
      <header className="inventory-header">
        <div>
          <h2>{moduleTitle}</h2>
          <p>{moduleSubtitle}</p>
        </div>
        <div className="inventory-actions">
          {isOverviewModule ? (
            <>
              <button type="button" className="link-button" onClick={() => onSwitchInventoryModule?.('inventario_movimientos')}>
                Ver movimientos
              </button>
              <button type="button" className="ghost-button" onClick={() => onSwitchInventoryModule?.('inventario_productos')}>
                Ir a Productos
              </button>
              <button type="button" className="ghost-button" onClick={() => onSwitchInventoryModule?.('inventario_combos')}>
                Ir a Combos
              </button>
              <button type="button" className="ghost-button" onClick={() => onSwitchInventoryModule?.('inventario_categorias')}>
                Ir a Categorias
              </button>
              <button type="button" className="primary-button" onClick={() => onSwitchInventoryModule?.('inventario_ajustes')}>
                Ir a Ajustes
              </button>
            </>
          ) : null}

          {isProductsModule ? (
            <>
              <button type="button" className="link-button" onClick={handleHeaderAdjustClick}>
                Ajuste de Stock
              </button>
              <button type="button" className="ghost-button" onClick={() => onSwitchInventoryModule?.('inventario_combos')}>
                Ver Combos
              </button>
              <button type="button" className="ghost-button" onClick={handleHeaderImportClick}>
                Importar Inventario
              </button>
              <button type="button" className="primary-button" onClick={handleHeaderNewClick}>
                + Nuevo Producto
              </button>
            </>
          ) : null}

          {isCombosModule ? (
            <>
              <button type="button" className="link-button" onClick={() => onSwitchInventoryModule?.('inventario_productos')}>
                Ir a Productos
              </button>
              <button type="button" className="ghost-button" onClick={handleExport}>
                Exportar Combos
              </button>
              <button type="button" className="primary-button" onClick={openCreateComboModal}>
                + Nuevo Combo
              </button>
            </>
          ) : null}

          {isCategoriesModule ? (
            <>
              <button type="button" className="link-button" onClick={() => onSwitchInventoryModule?.('inventario')}>
                Volver a Inventario
              </button>
              <button type="button" className="ghost-button" onClick={() => onSwitchInventoryModule?.('inventario_productos')}>
                Ir a Productos
              </button>
              <button type="button" className="primary-button" onClick={openCreateCategoryModal}>
                + Nueva Categoria
              </button>
            </>
          ) : null}

          {isMovementsModule ? (
            <>
              <button type="button" className="link-button" onClick={() => onSwitchInventoryModule?.('inventario_productos')}>
                Ir a Productos
              </button>
              <button type="button" className="ghost-button" onClick={handleExport}>
                Exportar Movimientos
              </button>
              <button type="button" className="primary-button" onClick={() => openMovementModal({}, 'entrada')}>
                + Registrar Movimiento
              </button>
            </>
          ) : null}

          {isAdjustModule ? (
            <>
              <button type="button" className="link-button" onClick={() => onSwitchInventoryModule?.('inventario_productos')}>
                Ir a Productos
              </button>
              <button type="button" className="ghost-button" onClick={() => onSwitchInventoryModule?.('inventario_movimientos')}>
                Ver Movimientos
              </button>
              <button type="button" className="primary-button" onClick={() => openMovementModal({}, 'ajuste')}>
                + Nuevo Ajuste
              </button>
            </>
          ) : null}
        </div>
      </header>

      {moduleLoading ? <p className="status">Cargando movimientos y ordenes...</p> : null}

      <input ref={importInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleImportFile} />

      {feedback ? (
        <p className={`status ${feedbackType === 'error' ? 'error' : ''}`}>{feedback}</p>
      ) : null}
      {returnProcessingMessage ? <p className="status">{returnProcessingMessage}</p> : null}

      <div className="inventory-content-grid">
        <div className="inventory-left-stack">
          <div className="inventory-kpis">
            {kpiCards.map((card) => (
              <article key={card.label} className={`inventory-kpi-card ${card.tone}`}>
                <div className="inventory-kpi-head">
                  <span className={`inventory-kpi-icon ${card.tone}`}><KpiIcon kind={card.icon} /></span>
                </div>
                <strong>{card.value}</strong>
                <p>{card.label}</p>
                <button type="button" className="inventory-kpi-link" onClick={() => handleKpiLink(card)}>
                  {card.link} {card.link?.startsWith('Bs') ? '' : '->'}
                </button>
              </article>
            ))}
          </div>

          {isMovementsModule ? (
            <article className="inventory-ops-card">
              <header className="inventory-ops-head">
                <div>
                  <h3>Ordenes operativas de inventario</h3>
                  <span>Consulta todas las ordenes o filtra por cliente, contrato y fecha exacta.</span>
                </div>
                <div className="inventory-week-actions">
                  <button type="button" className="primary-button" onClick={() => openInventoryWeekDocument('standard')}>
                    Ver documento semanal
                  </button>
                </div>
              </header>
              <div className="inventory-ops-toolbar">
                <label className="inventory-ops-search">
                  <span>Buscar contrato o cliente</span>
                  <input
                    type="search"
                    value={inventoryOrderQuery}
                    onChange={(event) => setInventoryOrderQuery(event.target.value)}
                    placeholder="Ej. 1348 o Paola Fernandez"
                  />
                </label>
                <label className="inventory-ops-date-filter">
                  <span>Desde</span>
                  <input
                    type="date"
                    value={inventoryOperationDateFrom}
                    max={inventoryOperationDateTo || undefined}
                    onChange={(event) => {
                      const nextDate = event.target.value;
                      setInventoryOperationDateFrom(nextDate);
                      if (inventoryOperationDateTo && nextDate > inventoryOperationDateTo) {
                        setInventoryOperationDateTo(nextDate);
                      }
                    }}
                  />
                </label>
                <label className="inventory-ops-date-filter">
                  <span>Hasta</span>
                  <input
                    type="date"
                    value={inventoryOperationDateTo}
                    min={inventoryOperationDateFrom || undefined}
                    onChange={(event) => {
                      const nextDate = event.target.value;
                      setInventoryOperationDateTo(nextDate);
                      if (inventoryOperationDateFrom && nextDate < inventoryOperationDateFrom) {
                        setInventoryOperationDateFrom(nextDate);
                      }
                    }}
                  />
                </label>
                <div className="inventory-ops-filter-summary">
                  <strong>{filteredPrepOrderRows.length}</strong>
                  <span>{filteredPrepOrderRows.length === 1 ? 'orden visible' : 'ordenes visibles'}</span>
                </div>
                {(inventoryOrderQuery || inventoryOperationDateFrom || inventoryOperationDateTo) ? (
                  <button
                    type="button"
                    className="link-button inventory-ops-clear"
                    onClick={() => {
                      setInventoryOrderQuery('');
                      setInventoryOperationDateFrom('');
                      setInventoryOperationDateTo('');
                    }}
                  >
                    Limpiar
                  </button>
                ) : null}
              </div>
              <div className="inventory-ops-list">
                <div className="inventory-ops-table-head" aria-hidden="true">
                  <span>Contrato y cliente</span>
                  <span>Inventario</span>
                  <span>Entrega / alistamiento</span>
                  <span>Recojo</span>
                  <span>Estado</span>
                  <span>Acciones</span>
                </div>
                {visiblePrepOrderRows.map((row) => (
                  <div key={row.id} className="inventory-ops-row">
                    <div className="inventory-ops-identity">
                      <div className="inventory-ops-contract-line">
                        <button
                          type="button"
                          className="inventory-ops-contract-link"
                          onClick={() => openContractDocument(row)}
                          title={`Ver contrato ${row.contractCode}`}
                        >
                          Contrato {row.contractCode}
                        </button>
                        <span>{row.orderCode}</span>
                      </div>
                      <span className="inventory-ops-customer">{row.customerName}</span>
                      <span className="inventory-ops-address">{row.address}</span>
                    </div>
                    <div className="inventory-ops-inventory">
                      <strong>{row.itemsText}</strong>
                      <span className={`inventory-ops-stock-state state-${row.inventoryStatus}`}>
                        {row.inventoryStatusText}
                      </span>
                    </div>
                    <div className="inventory-ops-schedule-line">
                      <span className="inventory-ops-label">{row.deliveryLabel}</span>
                      <strong>{row.deliveryDate ? formatDateTime(row.deliveryDate).split(',')[0] : 'Sin fecha'}</strong>
                      <span>{row.deliveryWindow}</span>
                    </div>
                    <div className="inventory-ops-schedule-line">
                      <span className="inventory-ops-label">Recojo</span>
                      <strong>{row.pickupDate ? formatDateTime(row.pickupDate).split(',')[0] : 'Sin fecha'}</strong>
                      <span>{row.pickupWindow}</span>
                    </div>
                    <div className="inventory-ops-state">
                      <span className={`inventory-ops-priority ${row.priority.key}`}>{row.priority.label}</span>
                      <strong>{row.inventoryStatus === 'salio' ? 'Fuera de almacen' : row.inventoryStatus === 'confirmado' ? 'Lista para salir' : row.inventoryStatus === 'devuelto' ? 'Devuelto' : 'Pendiente'}</strong>
                      {row.revisionAlert ? <small className="inventory-ops-alert">Revisar cambios nuevos</small> : null}
                      {row.clientPendingPickup ? <small className="inventory-ops-alert pending">Pendiente con cliente</small> : null}
                      {['partial', 'pending_extra'].includes(row.dispatchReview?.status) ? <small className="inventory-ops-alert pending">Salida parcial</small> : null}
                    </div>
                    <div className="inventory-ops-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => openInventorySingleOrderDocument(row)}
                      >
                        Imprimir
                      </button>
                      <div className="inventory-ops-process" aria-label={`Proceso de inventario para ${row.contractCode}`}>
                        <button
                          type="button"
                          className={`inventory-ops-check ${['confirmado', 'salio', 'devuelto'].includes(row.inventoryStatus) ? 'done' : ''}`}
                          disabled={!row.canConfirmInventory || ['confirmado', 'salio', 'devuelto'].includes(row.inventoryStatus)}
                          onClick={() => handleInventoryOrderAction({ ...row, inventoryAction: 'ready' })}
                        >
                          <span aria-hidden="true">{['confirmado', 'salio', 'devuelto'].includes(row.inventoryStatus) ? '✓' : ''}</span>
                          Alistado
                        </button>
                        <button
                          type="button"
                          className={`inventory-ops-check ${['salio', 'devuelto'].includes(row.inventoryStatus) ? 'done' : ''}`}
                          disabled={!row.canConfirmInventory || row.inventoryStatus !== 'confirmado'}
                          onClick={() => handleInventoryOrderAction({ ...row, inventoryAction: 'dispatch' })}
                        >
                          <span aria-hidden="true">{['salio', 'devuelto'].includes(row.inventoryStatus) ? '✓' : ''}</span>
                          Salió
                        </button>
                        <button
                          type="button"
                          className={`inventory-ops-check ${row.inventoryStatus === 'devuelto' ? 'done' : ''}`}
                          disabled={!row.canConfirmInventory || row.inventoryStatus !== 'salio'}
                          onClick={() => handleInventoryOrderAction({ ...row, inventoryAction: 'return' })}
                        >
                          <span aria-hidden="true">{row.inventoryStatus === 'devuelto' ? '✓' : ''}</span>
                          Volvió
                        </button>
                      </div>
                      <div
                        className="inventory-actions-menu-wrap inventory-ops-menu-wrap"
                        ref={rowMenuOpenId === `ops-${row.id}` ? rowMenuRef : null}
                      >
                        <button
                          type="button"
                          className="inventory-row-menu-button inventory-ops-menu-button"
                          aria-label={`Mas opciones para ${row.contractCode}`}
                          aria-expanded={rowMenuOpenId === `ops-${row.id}`}
                          onClick={(event) => toggleRowMenu(`ops-${row.id}`, event)}
                        >
                          ⋮
                        </button>
                        {rowMenuOpenId === `ops-${row.id}` ? renderOperationalRowMenu(row) : null}
                      </div>
                    </div>
                  </div>
                ))}
                {filteredPrepOrderRows.length === 0 ? (
                  <p className="status">
                    {(inventoryOperationDateFrom || inventoryOperationDateTo)
                      ? 'No hay entregas ni recojos programados para el rango seleccionado.'
                      : 'No hay ordenes que coincidan con la busqueda.'}
                  </p>
                ) : null}
                {inventoryFiltersAreCleared && filteredPrepOrderRows.length > visiblePrepOrderRows.length ? (
                  <div className="inventory-ops-view-all">
                    <span>Mostrando 7 de {filteredPrepOrderRows.length} órdenes.</span>
                    <button type="button" className="ghost-button" onClick={() => setShowAllInventoryOrders(true)}>
                      Ver todas
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ) : null}

          {showAllInventoryOrders ? (
            <div className="reset-modal-backdrop" onClick={() => setShowAllInventoryOrders(false)}>
              <section className="reset-modal inventory-ops-all-modal" onClick={(event) => event.stopPropagation()}>
                <header className="inventory-ops-all-head">
                  <div>
                    <span className="inventory-detail-kicker">Inventario operativo</span>
                    <h3>Todas las órdenes visibles</h3>
                    <p>{filteredPrepOrderRows.length} órdenes según los filtros actuales.</p>
                  </div>
                  <button type="button" className="modal-close" onClick={() => setShowAllInventoryOrders(false)}>×</button>
                </header>
                <div className="inventory-ops-list inventory-ops-list-modal">
                  <div className="inventory-ops-table-head" aria-hidden="true">
                    <span>Contrato y cliente</span>
                    <span>Inventario</span>
                    <span>Entrega / alistamiento</span>
                    <span>Recojo</span>
                    <span>Estado</span>
                    <span>Acciones</span>
                  </div>
                  {filteredPrepOrderRows.map((row) => (
                    <div key={`all-${row.id}`} className="inventory-ops-row">
                      <div className="inventory-ops-identity">
                        <div className="inventory-ops-contract-line">
                          <button
                            type="button"
                            className="inventory-ops-contract-link"
                            onClick={() => openContractDocument(row)}
                            title={`Ver contrato ${row.contractCode}`}
                          >
                            Contrato {row.contractCode}
                          </button>
                          <span>{row.orderCode}</span>
                        </div>
                        <span className="inventory-ops-customer">{row.customerName}</span>
                        <span className="inventory-ops-address">{row.address}</span>
                      </div>
                      <div className="inventory-ops-inventory">
                        <strong>{row.itemsText}</strong>
                        <span className={`inventory-ops-stock-state state-${row.inventoryStatus}`}>
                          {row.inventoryStatusText}
                        </span>
                      </div>
                      <div className="inventory-ops-schedule-line">
                        <span className="inventory-ops-label">{row.deliveryLabel}</span>
                        <strong>{row.deliveryDate ? formatDateTime(row.deliveryDate).split(',')[0] : 'Sin fecha'}</strong>
                        <span>{row.deliveryWindow}</span>
                      </div>
                      <div className="inventory-ops-schedule-line">
                        <span className="inventory-ops-label">Recojo</span>
                        <strong>{row.pickupDate ? formatDateTime(row.pickupDate).split(',')[0] : 'Sin fecha'}</strong>
                        <span>{row.pickupWindow}</span>
                      </div>
                      <div className="inventory-ops-state">
                        <span className={`inventory-ops-priority ${row.priority.key}`}>{row.priority.label}</span>
                        <strong>{row.inventoryStatus === 'salio' ? 'Fuera de almacen' : row.inventoryStatus === 'confirmado' ? 'Lista para salir' : row.inventoryStatus === 'devuelto' ? 'Devuelto' : 'Pendiente'}</strong>
                        {row.revisionAlert ? <small className="inventory-ops-alert">Revisar cambios nuevos</small> : null}
                        {row.clientPendingPickup ? <small className="inventory-ops-alert pending">Pendiente con cliente</small> : null}
                        {['partial', 'pending_extra'].includes(row.dispatchReview?.status) ? <small className="inventory-ops-alert pending">Salida parcial</small> : null}
                      </div>
                      <div className="inventory-ops-actions">
                        <button type="button" className="ghost-button" onClick={() => openInventorySingleOrderDocument(row)}>
                          Imprimir
                        </button>
                        <div className="inventory-ops-process" aria-label={`Proceso de inventario para ${row.contractCode}`}>
                          <button
                            type="button"
                            className={`inventory-ops-check ${['confirmado', 'salio', 'devuelto'].includes(row.inventoryStatus) ? 'done' : ''}`}
                            disabled={!row.canConfirmInventory || ['confirmado', 'salio', 'devuelto'].includes(row.inventoryStatus)}
                            onClick={() => handleInventoryOrderAction({ ...row, inventoryAction: 'ready' })}
                          >
                            <span aria-hidden="true">{['confirmado', 'salio', 'devuelto'].includes(row.inventoryStatus) ? '✓' : ''}</span>
                            Alistado
                          </button>
                          <button
                            type="button"
                            className={`inventory-ops-check ${['salio', 'devuelto'].includes(row.inventoryStatus) ? 'done' : ''}`}
                            disabled={!row.canConfirmInventory || row.inventoryStatus !== 'confirmado'}
                            onClick={() => handleInventoryOrderAction({ ...row, inventoryAction: 'dispatch' })}
                          >
                            <span aria-hidden="true">{['salio', 'devuelto'].includes(row.inventoryStatus) ? '✓' : ''}</span>
                            Salió
                          </button>
                          <button
                            type="button"
                            className={`inventory-ops-check ${row.inventoryStatus === 'devuelto' ? 'done' : ''}`}
                            disabled={!row.canConfirmInventory || row.inventoryStatus !== 'salio'}
                            onClick={() => handleInventoryOrderAction({ ...row, inventoryAction: 'return' })}
                          >
                            <span aria-hidden="true">{row.inventoryStatus === 'devuelto' ? '✓' : ''}</span>
                            Volvió
                          </button>
                        </div>
                        <div
                          className="inventory-actions-menu-wrap inventory-ops-menu-wrap"
                          ref={rowMenuOpenId === `ops-all-${row.id}` ? rowMenuRef : null}
                        >
                          <button
                            type="button"
                            className="inventory-row-menu-button inventory-ops-menu-button"
                            aria-label={`Mas opciones para ${row.contractCode}`}
                            aria-expanded={rowMenuOpenId === `ops-all-${row.id}`}
                            onClick={(event) => toggleRowMenu(`ops-all-${row.id}`, event)}
                          >
                            ⋮
                          </button>
                          {rowMenuOpenId === `ops-all-${row.id}` ? renderOperationalRowMenu(row) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {operationalEditRow ? (
            <div className="reset-modal-backdrop" onClick={() => setOperationalEditRow(null)}>
              <form className="reset-modal inventory-ops-edit-modal" onSubmit={submitOperationalEdit} onClick={(event) => event.stopPropagation()}>
                <header className="inventory-ops-all-head">
                  <div>
                    <span className="inventory-detail-kicker">Inventario operativo</span>
                    <h3>Editar {operationalEditRow.orderCode}</h3>
                    <p>Contrato {operationalEditRow.contractCode} · {operationalEditRow.customerName}</p>
                  </div>
                  <button type="button" className="modal-close" onClick={() => setOperationalEditRow(null)}>×</button>
                </header>
                <div className="inventory-ops-edit-body">
                  <label className="form-field">
                    <span>Estado de inventario</span>
                    <select
                      value={operationalEditForm.inventoryStatus}
                      onChange={(event) => setOperationalEditForm((current) => ({ ...current, inventoryStatus: event.target.value }))}
                    >
                      <option value="pendiente">Pendiente</option>
                      <option value="enviado">Asignada / pendiente</option>
                      <option value="confirmado">Alistado</option>
                      <option value="salio">Salio</option>
                      <option value="devuelto">Volvio</option>
                    </select>
                  </label>
                  <label className="form-field">
                    <span>Observacion de inventario</span>
                    <textarea
                      rows={4}
                      value={operationalEditForm.inventoryNote}
                      onChange={(event) => setOperationalEditForm((current) => ({ ...current, inventoryNote: event.target.value }))}
                      placeholder="Detalle operativo, novedades o aclaraciones."
                    />
                  </label>
                  {operationalEditError ? <p className="form-error">{operationalEditError}</p> : null}
                </div>
                <footer className="inventory-ops-edit-actions">
                  <button type="button" className="ghost-button" onClick={() => setOperationalEditRow(null)}>
                    Cancelar
                  </button>
                  <button type="submit" className="primary-button" disabled={isSavingOperationalEdit}>
                    {isSavingOperationalEdit ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </footer>
              </form>
            </div>
          ) : null}

          {isMovementsModule && (cancelledOrderRows.length > 0 || receptionRows.length > 0) ? (
            <section className="inventory-movement-summary-grid" aria-label="Resumen de incidencias operativas">
              {cancelledOrderRows.length > 0 ? (
              <article className="inventory-ops-card inventory-movement-summary-card">
                <header className="inventory-ops-head">
                  <div>
                    <h3>Ordenes anuladas</h3>
                    <span>Historial visible del periodo consultado</span>
                  </div>
                  <strong className="inventory-summary-count cancelled">{cancelledOrderRows.length}</strong>
                </header>
                <div className="inventory-ops-list">
                  {cancelledOrderRows.slice(0, 6).map((row) => (
                    <div key={row.id} className="inventory-summary-row">
                      <div>
                        <strong>{row.orderCode}</strong>
                        <span>{row.customerName}</span>
                      </div>
                      <div>
                        <strong>{row.itemsText}</strong>
                        <span>{row.cancelledAt ? formatDateTime(row.cancelledAt).split(',')[0] : 'Sin fecha'}</span>
                      </div>
                      <div className="inventory-summary-status">
                        <span className="inventory-ops-priority alta">Anulado</span>
                        <small>Penalidad {formatBs(row.penaltyBs)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
              ) : null}

              {receptionRows.length > 0 ? (
              <article className="inventory-ops-card inventory-movement-summary-card">
                <header className="inventory-ops-head">
                  <div>
                    <h3>Recepciones pendientes</h3>
                    <span>Recojos enviados desde transporte al galpon</span>
                  </div>
                  <strong className="inventory-summary-count pending">{receptionRows.length}</strong>
                </header>
                <div className="inventory-ops-list">
                  {receptionRows.slice(0, 8).map((row) => (
                    <div key={row.id} className="inventory-summary-row">
                      <div>
                        <strong>{row.orderCode}</strong>
                        <span>{row.customerName}</span>
                      </div>
                      <div>
                        <strong>{row.itemsText}</strong>
                        <span>Controlado por {row.checkedBy}</span>
                      </div>
                      <div className="inventory-summary-status">
                        <small>{formatDateTime(row.checkedAt).split(',')[0]}</small>
                        <button type="button" className="link-button" onClick={() => openReceivingModal(row)}>
                          Recibir y constatar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
              ) : null}
            </section>
          ) : null}

          <article className="inventory-table-card">
            <header className={`inventory-toolbar ${isMovementsModule ? 'inventory-toolbar-movements' : ''} ${isAdjustModule ? 'inventory-toolbar-adjust' : ''}`}>
              {isMovementsModule ? (
                <div className="inventory-history-heading">
                  <h3>Historial de movimientos</h3>
                  <span>Detalle cronologico de reservas, salidas, entradas y ajustes de stock</span>
                </div>
              ) : null}
              <label className="inventory-search">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={
                    isMovementsModule
                      ? 'Buscar por producto, referencia o responsable...'
                      : isAdjustModule
                      ? 'Buscar por numero, producto o motivo...'
                      : isCombosModule
                      ? 'Buscar combos o ingredientes...'
                      : isCategoriesModule
                      ? 'Buscar categorias por nombre o icono...'
                      : 'Buscar productos, codigo o categoria...'
                  }
                />
              </label>
              <button type="button" className="ghost-button inventory-filter-btn" onClick={() => setShowFilters((value) => !value)}>
                Filtros
              </button>
              {isMovementsModule || isAdjustModule ? (
                <>
                  <button type="button" className="ghost-button inventory-date-chip" onClick={() => setShowFilters(true)}>
                    {getDateRangeLabel(dateFrom, dateTo)}
                  </button>
                  <button
                    type="button"
                    className="link-button inventory-clear-inline"
                    onClick={() => {
                      resetAdvancedFilters();
                      setQuery('');
                      setShowFilters(false);
                    }}
                  >
                    Limpiar filtros
                  </button>
                </>
              ) : (
                <>
                  {isProductsModule ? (
                    <>
                      <button
                        type="button"
                        className="ghost-button inventory-export-btn"
                        onClick={() => window.open('/catalogo', '_blank', 'noopener,noreferrer')}
                      >
                        Catalogo web
                      </button>
                      <button type="button" className="ghost-button inventory-export-btn" onClick={handleExportPremiumCatalog}>
                        Catalogo PDF
                      </button>
                    </>
                  ) : null}
                  <button type="button" className="link-button inventory-export-btn" onClick={handleExport}>
                    {isCategoriesModule ? 'Exportar categorias' : isCombosModule ? 'Exportar combos' : 'Exportar Excel'}
                  </button>
                </>
              )}
            </header>

            {showFilters ? (
              <div
                className={`inventory-filter-line ${!isMovementsModule && !isAdjustModule && !isCategoriesModule && !isCombosModule ? 'product-filter-line' : ''}`}
                ref={!isMovementsModule && !isAdjustModule && !isCategoriesModule && !isCombosModule ? productFilterRef : null}
              >
                {!isMovementsModule && !isAdjustModule && !isCategoriesModule && !isCombosModule ? (
                  <>
                    {renderProductFilterDropdown({
                      id: 'category',
                      label: 'Categoria',
                      value: categoryFilter,
                      options: categoryFilterOptions,
                      onChange: setCategoryFilter,
                      wide: true,
                    })}
                    {renderProductFilterDropdown({
                      id: 'stock',
                      label: 'Stock',
                      value: stockFilter,
                      options: stockFilterOptions,
                      onChange: setStockFilter,
                    })}
                    {renderProductFilterDropdown({
                      id: 'control',
                      label: 'Estado',
                      value: controlFilter,
                      options: controlFilterOptions,
                      onChange: setControlFilter,
                    })}
                    {renderProductFilterDropdown({
                      id: 'sort',
                      label: 'Orden',
                      value: sortFilter,
                      options: sortFilterOptions,
                      onChange: setSortFilter,
                    })}
                    <button
                      type="button"
                      className="inventory-clear-chip inventory-clear-filter-button"
                      onClick={() => {
                        setCategoryFilter('all');
                        setStockFilter('all');
                        setControlFilter('all');
                        setSortFilter('default');
                        setProductFilterMenu(null);
                      }}
                    >
                      Limpiar filtros
                    </button>
                  </>
                ) : null}

                {isCategoriesModule ? (
                  <>
                    <select
                      className="ghost-button inventory-filter-btn"
                      value={categoryUsageFilter}
                      onChange={(event) => setCategoryUsageFilter(event.target.value)}
                    >
                      <option value="all">Todas las categorias</option>
                      <option value="with_items">Con productos</option>
                      <option value="empty">Sin productos</option>
                    </select>
                    <button
                      type="button"
                      className="inventory-clear-chip"
                      onClick={() => {
                        setCategoryUsageFilter('all');
                      }}
                    >
                      Limpiar seleccion
                    </button>
                  </>
                ) : null}

                {isMovementsModule ? (
                  <>
                    <select className="ghost-button inventory-filter-btn" value={movementTypeFilter} onChange={(event) => setMovementTypeFilter(event.target.value)}>
                      <option value="all">Todos los tipos</option>
                      <option value="entrada">Entradas</option>
                      <option value="salida">Reservas y salidas</option>
                      <option value="ajuste">Ajustes</option>
                    </select>
                    <select className="ghost-button inventory-filter-btn" value={movementUserFilter} onChange={(event) => setMovementUserFilter(event.target.value)}>
                      <option value="all">Todos los responsables</option>
                      {movementUsers.map((userName) => (
                        <option key={userName} value={userName}>{userName}</option>
                      ))}
                    </select>
                    <label>
                      Desde
                      <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                    </label>
                    <label>
                      Hasta
                      <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                    </label>
                  </>
                ) : null}

                {isAdjustModule ? (
                  <>
                    <select className="ghost-button inventory-filter-btn" value={adjustStatusFilter} onChange={(event) => setAdjustStatusFilter(event.target.value)}>
                      <option value="all">Todos los estados</option>
                      <option value="aprobado">Aprobado</option>
                      <option value="pendiente">Pendiente</option>
                      <option value="rechazado">Rechazado</option>
                    </select>
                    <label>
                      Desde
                      <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                    </label>
                    <label>
                      Hasta
                      <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                    </label>
                  </>
                ) : null}
              </div>
            ) : null}

            {isMovementsModule ? (
              <div className="inventory-table-wrap-modern">
                <table className="inventory-table-modern movements-table-modern">
                  <colgroup>
                    <col className="movement-col-date" />
                    <col className="movement-col-type" />
                    <col className="movement-col-product" />
                    <col className="movement-col-reference" />
                    <col className="movement-col-quantity" />
                    <col className="movement-col-stock" />
                    <col className="movement-col-stock" />
                    <col className="movement-col-user" />
                    <col className="movement-col-observation" />
                    <col className="movement-col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Fecha y Hora</th>
                      <th>Tipo</th>
                      <th>Producto</th>
                      <th>Referencia</th>
                      <th>Cantidad</th>
                      <th>Stock Anterior</th>
                      <th>Stock Nuevo</th>
                      <th>Responsable</th>
                      <th>Observaciones</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((row, rowIndex) => (
                      <tr key={row.id}>
                        <td className="movement-date-cell">
                          <strong>{formatDateTime(row.createdAt).split(',')[0]}</strong>
                          <span>{formatDateTime(row.createdAt).split(',')[1] ?? ''}</span>
                        </td>
                        <td>
                          <span className={`movement-type-pill ${row.typeKey}`}>{row.typeLabel}</span>
                        </td>
                        <td className="movement-product-table-cell">
                          <div className="inventory-product-cell movement-product-cell">
                            {getProductImageSrc(row) ? (
                              <button
                                type="button"
                                className="inventory-product-thumb inventory-product-thumb-button"
                                onClick={() => handleOpenImagePreview(getProductImageSrc(row), row.itemName)}
                                aria-label={`Ver imagen de ${row.itemName}`}
                              >
                                <ProductImage
                                  item={row}
                                  alt={`Imagen de ${row.itemName}`}
                                  fallback={<span className="inventory-thumb-fallback">IMG</span>}
                                />
                              </button>
                            ) : (
                              <div className="inventory-product-thumb">
                                <span className="inventory-thumb-fallback">IMG</span>
                              </div>
                            )}
                            <div>
                              <strong>{row.itemName}</strong>
                              <span>Codigo: {row.sku}</span>
                            </div>
                          </div>
                        </td>
                        <td className="movement-reference-cell" title={row.reference}>{row.reference}</td>
                        <td className={row.deltaUnits > 0 ? 'movement-delta-positive' : row.deltaUnits < 0 ? 'movement-delta-negative' : 'movement-delta-neutral'}>
                          {row.deltaUnits > 0 ? `+${row.deltaUnits}` : row.deltaUnits}
                        </td>
                        <td>{row.beforeStock}</td>
                        <td>{row.afterStock}</td>
                        <td>
                          <div className={`movement-user-cell ${row.isPendingReservation ? 'pending' : ''}`}>
                            <span className="movement-user-avatar">{row.userName.slice(0, 2).toUpperCase()}</span>
                            <div>
                              <strong>{row.userName}</strong>
                              <span>{row.userRole}</span>
                              {row.isPendingReservation && row.registeredByName ? (
                                <small>Registrado por {row.registeredByName}</small>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="movement-observation">{row.observation}</td>
                        <td className="inventory-row-menu">
                          <div className="inventory-actions-menu-wrap" ref={rowMenuOpenId === row.id ? rowMenuRef : null}>
                            <button
                              type="button"
                              className={`inventory-row-menu-button ${rowMenuOpenId && rowMenuOpenId !== row.id ? 'is-hidden-while-menu-open' : ''}`}
                              aria-label={`Acciones para ${row.itemName}`}
                              onClick={(event) => toggleRowMenu(row.id, event, shouldOpenMenuUp(rowIndex, pagedRows.length))}
                            >
                              {'\u22ee'}
                            </button>
                            {rowMenuOpenId === row.id
                              ? renderMovementRowMenu(row, shouldOpenMenuUp(rowIndex, pagedRows.length))
                              : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {pagedRows.length === 0 ? (
                      <tr>
                        <td colSpan={10}><p className="status">No hay movimientos para los filtros actuales.</p></td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : isAdjustModule ? (
              <div className="inventory-table-wrap-modern">
                <table className="inventory-table-modern adjustments-table-modern">
                  <thead>
                    <tr>
                      <th>Ajuste</th>
                      <th>Fecha y Hora</th>
                      <th>Producto</th>
                      <th>Motivo</th>
                      <th>Cantidad</th>
                      <th>Stock Anterior</th>
                      <th>Stock Nuevo</th>
                      <th>Valor del Ajuste</th>
                      <th>Responsable</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((row, rowIndex) => (
                      <tr key={row.id}>
                        <td className="adjust-id-cell">
                          <strong>{row.adjustId}</strong>
                          <span>Creado: {formatDateTime(row.createdAt)}</span>
                        </td>
                        <td className="movement-date-cell">
                          <strong>{formatDateTime(row.createdAt).split(',')[0]}</strong>
                          <span>{formatDateTime(row.createdAt).split(',')[1] ?? ''}</span>
                        </td>
                        <td>
                          <div className="inventory-product-cell movement-product-cell">
                            {getProductImageSrc(row) ? (
                              <button
                                type="button"
                                className="inventory-product-thumb inventory-product-thumb-button"
                                onClick={() => handleOpenImagePreview(getProductImageSrc(row), row.itemName)}
                                aria-label={`Ver imagen de ${row.itemName}`}
                              >
                                <ProductImage
                                  item={row}
                                  alt={`Imagen de ${row.itemName}`}
                                  fallback={<span className="inventory-thumb-fallback">IMG</span>}
                                />
                              </button>
                            ) : (
                              <div className="inventory-product-thumb">
                                <span className="inventory-thumb-fallback">IMG</span>
                              </div>
                            )}
                            <div>
                              <strong>{row.itemName}</strong>
                              <span>Codigo: {row.sku}</span>
                            </div>
                          </div>
                        </td>
                        <td className="adjust-reason-cell">
                          <strong>{row.reason}</strong>
                          <span>{row.reasonDetail}</span>
                        </td>
                        <td className={row.deltaUnits > 0 ? 'movement-delta-positive' : 'movement-delta-negative'}>
                          {row.deltaUnits > 0 ? `+${row.deltaUnits}` : row.deltaUnits}
                        </td>
                        <td>{row.beforeStock}</td>
                        <td>{row.afterStock}</td>
                        <td className={row.valueAmount >= 0 ? 'adjust-value-positive' : 'adjust-value-negative'}>
                          {row.valueAmount >= 0 ? '' : '-'}{formatBs(Math.abs(row.valueAmount))}
                        </td>
                        <td>{row.userName}</td>
                        <td>
                          <span className={`adjust-status-pill ${row.status}`}>
                            {row.status === 'aprobado' ? 'Aprobado' : row.status === 'pendiente' ? 'Pendiente' : 'Rechazado'}
                          </span>
                        </td>
                        <td className="inventory-row-menu">
                          <div className="inventory-actions-menu-wrap" ref={rowMenuOpenId === row.id ? rowMenuRef : null}>
                            <button
                              type="button"
                              className={`inventory-row-menu-button ${rowMenuOpenId && rowMenuOpenId !== row.id ? 'is-hidden-while-menu-open' : ''}`}
                              aria-label={`Acciones para ${row.itemName}`}
                              onClick={(event) => toggleRowMenu(row.id, event, shouldOpenMenuUp(rowIndex, pagedRows.length))}
                            >
                              {'\u22ee'}
                            </button>
                            {rowMenuOpenId === row.id
                              ? renderMovementRowMenu(row, shouldOpenMenuUp(rowIndex, pagedRows.length))
                              : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {pagedRows.length === 0 ? (
                      <tr>
                        <td colSpan={11}><p className="status">No hay ajustes para los filtros actuales.</p></td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : isCombosModule ? (
              <div className="inventory-table-wrap-modern">
                <table className="inventory-table-modern">
                  <thead>
                    <tr>
                      <th>Combo</th>
                      <th>Componentes</th>
                      <th>Precio combo</th>
                      <th>Precio separado</th>
                      <th>Disponibles</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((row, rowIndex) => (
                      <tr key={row.id}>
                        <td>
                          <div className="inventory-product-cell">
                            <button
                              type="button"
                              className="inventory-product-thumb inventory-product-thumb-button inventory-combo-thumb"
                              onClick={() => handleOpenImagePreview(getProductImageSrc(row), row.name)}
                              disabled={!getProductImageSrc(row)}
                              aria-label={getProductImageSrc(row) ? `Ver imagen de ${row.name}` : `${row.name} sin imagen`}
                            >
                              {getProductImageSrc(row) ? (
                                <ProductImage
                                  item={row}
                                  alt={`Imagen de ${row.name}`}
                                  fallback={<span className="inventory-thumb-fallback">CB</span>}
                                />
                              ) : (
                                <span className="inventory-thumb-fallback">CB</span>
                              )}
                            </button>
                            <div>
                              <strong>{row.name}</strong>
                              <span>{row.notes || `Codigo: ${row.sku}`}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="inventory-combo-components">
                            {row.ingredients.slice(0, 4).map((line) => (
                              <span key={`${row.id}-${line.itemId}`}>
                                {line.quantity}x {line.itemName}
                              </span>
                            ))}
                            {row.ingredients.length > 4 ? <span>+{row.ingredients.length - 4} mas</span> : null}
                          </div>
                        </td>
                        <td>
                          <strong>{formatBs(row.price)}</strong>
                          {row.pricingCondition?.enabled ? (
                            <small className="inventory-combo-price-rule">
                              1-{row.pricingCondition.upToQuantity}: {formatBs(row.pricingCondition.upToUnitPriceBs)} | Mas de {row.pricingCondition.upToQuantity}: {formatBs(row.pricingCondition.aboveUnitPriceBs)}
                            </small>
                          ) : null}
                        </td>
                        <td>{formatBs(row.catalogValue)}</td>
                        <td className={row.controlsStock ? 'good' : 'muted'}>
                          {row.controlsStock ? row.availableCombos : 'Pendiente'}
                        </td>
                        <td>
                          <span className={row.controlsStock ? 'inventory-status ok' : 'inventory-status pending'}>
                            {row.controlsStock ? 'Descuenta stock' : 'Revisar ingredientes'}
                          </span>
                          {!row.controlsStock ? <small className="inventory-stock-mode-note">Hay productos por validar</small> : null}
                        </td>
                        <td className="inventory-row-menu">
                          <div className="inventory-actions-menu-wrap" ref={rowMenuOpenId === row.id ? rowMenuRef : null}>
                            <button
                              type="button"
                              className={`inventory-row-menu-button ${rowMenuOpenId && rowMenuOpenId !== row.id ? 'is-hidden-while-menu-open' : ''}`}
                              aria-label={`Acciones para ${row.name}`}
                              onClick={(event) => toggleRowMenu(row.id, event, shouldOpenMenuUp(rowIndex, pagedRows.length))}
                            >
                              {'\u22ee'}
                            </button>
                            {rowMenuOpenId === row.id
                              ? renderComboRowMenu(row, shouldOpenMenuUp(rowIndex, pagedRows.length))
                              : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {pagedRows.length === 0 ? (
                      <tr>
                        <td colSpan={7}><p className="status">No hay combos para los filtros actuales.</p></td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : isCategoriesModule ? (
              <div className="inventory-table-wrap-modern">
                <table className="inventory-table-modern categories-table-modern">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Color</th>
                      <th>Productos</th>
                      <th>Creada</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((row, rowIndex) => {
                      const categoryColor = normalizeHexColor(row.color, DEFAULT_CATEGORY_COLOR);
                      const categoryStatus = String(row.status ?? 'active');
                      return (
                        <tr key={row.id}>
                          <td>
                            <div className="inventory-category-cell">
                              <span
                                className="inventory-category-icon-custom"
                                style={{
                                  color: categoryColor,
                                  borderColor: withHexAlpha(categoryColor, '66'),
                                  backgroundColor: withHexAlpha(categoryColor, '1A'),
                                }}
                              >
                                <CategoryIcon category={row.name} iconKey={row.icon} />
                              </span>
                              <div>
                                <strong>{row.name}</strong>
                                <span>Icono: {row.icon || 'box'}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="inventory-color-chip">
                              <span className="inventory-color-swatch" style={{ backgroundColor: categoryColor }} />
                              {categoryColor}
                            </span>
                          </td>
                          <td className={Number(row.count ?? 0) > 0 ? 'good' : ''}>{Number(row.count ?? 0)}</td>
                          <td>{row.createdAt ? String(row.createdAt).slice(0, 10) : '-'}</td>
                          <td>
                            <span className={categoryStatus === 'inactive' ? 'inventory-status low' : 'inventory-status ok'}>
                              {categoryStatus === 'inactive' ? 'Inactiva' : 'Activa'}
                            </span>
                          </td>
                          <td className="inventory-row-menu">
                            <div className="inventory-actions-menu-wrap" ref={rowMenuOpenId === row.id ? rowMenuRef : null}>
                              <button
                                type="button"
                                className={`inventory-row-menu-button ${rowMenuOpenId && rowMenuOpenId !== row.id ? 'is-hidden-while-menu-open' : ''}`}
                                aria-label={`Acciones para ${row.name}`}
                                onClick={(event) => toggleRowMenu(row.id, event, shouldOpenMenuUp(rowIndex, pagedRows.length))}
                              >
                                {'\u22ee'}
                              </button>
                              {rowMenuOpenId === row.id
                                ? renderCategoryRowMenu(row, shouldOpenMenuUp(rowIndex, pagedRows.length))
                                : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {pagedRows.length === 0 ? (
                      <tr>
                        <td colSpan={6}><p className="status">No hay categorias para los filtros actuales.</p></td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="inventory-table-wrap-modern">
                <table className="inventory-table-modern">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Categoria</th>
                      {isProductsModule ? <th>Marca</th> : null}
                      {isProductsModule ? <th>Color / descripcion</th> : null}
                      {isProductsModule ? <th>Unidad</th> : null}
                      {isProductsModule ? <th>Stock</th> : null}
                      <th>Disponible</th>
                      {!isProductsModule ? <th>Reservado</th> : null}
                      {!isProductsModule ? <th>En Mantenimiento</th> : null}
                      {!isProductsModule ? <th>Total</th> : null}
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((row, rowIndex) => (
                      <tr key={row.id}>
                        <td>
                          <div className="inventory-product-cell">
                            {getProductImageSrc(row) ? (
                              <button
                                type="button"
                                className="inventory-product-thumb inventory-product-thumb-button"
                                onClick={() => handleOpenImagePreview(getProductImageSrc(row), row.name)}
                                aria-label={`Ver imagen de ${row.name}`}
                              >
                                <ProductImage
                                  item={row}
                                  alt={`Imagen de ${row.name}`}
                                  fallback={<span className="inventory-thumb-fallback">IMG</span>}
                                />
                              </button>
                            ) : (
                              <div className="inventory-product-thumb">
                                <span className="inventory-thumb-fallback">IMG</span>
                              </div>
                            )}
                            <div>
                              <strong>{row.name}</strong>
                              <span>Codigo: {row.sku}</span>
                            </div>
                          </div>
                        </td>
                        <td><span className={`inventory-pill ${toCategoryClass(row.category)}`}>{row.category}</span></td>
                        {isProductsModule ? <td className="inventory-attribute-cell">{row.brand || '-'}</td> : null}
                        {isProductsModule ? <td className="inventory-attribute-cell">{row.itemColor || '-'}</td> : null}
                        {isProductsModule ? <td>Unidad</td> : null}
                        {isProductsModule ? <td>{row.total}</td> : null}
                        <td className={!row.controlsStock ? 'muted' : row.lowAvailability ? 'bad' : 'good'}>
                          {row.controlsStock ? row.available : 'No controla'}
                        </td>
                        {!isProductsModule ? <td className="warn">{row.reserved}</td> : null}
                        {!isProductsModule ? <td className="bad">{row.maintenance}</td> : null}
                        {!isProductsModule ? <td>{row.total}</td> : null}
                        <td>
                          <span className={!row.controlsStock ? 'inventory-status pending' : row.lowAvailability ? 'inventory-status low' : 'inventory-status ok'}>
                            {!row.controlsStock ? 'Por validar' : row.lowAvailability ? 'Stock Bajo' : 'Controlado'}
                          </span>
                          {!row.controlsStock ? <small className="inventory-stock-mode-note">No descuenta</small> : null}
                        </td>
                        <td className="inventory-row-menu">
                          <div className="inventory-actions-menu-wrap" ref={rowMenuOpenId === row.id ? rowMenuRef : null}>
                            <button
                              type="button"
                              className={`inventory-row-menu-button ${rowMenuOpenId && rowMenuOpenId !== row.id ? 'is-hidden-while-menu-open' : ''}`}
                              aria-label={`Acciones para ${row.name}`}
                              onClick={(event) => toggleRowMenu(row.id, event, shouldOpenMenuUp(rowIndex, pagedRows.length))}
                            >
                              {'\u22ee'}
                            </button>
                            {rowMenuOpenId === row.id
                              ? isProductsModule
                                ? renderProductRowMenu(row, shouldOpenMenuUp(rowIndex, pagedRows.length))
                                : renderInventoryRowMenu(row, shouldOpenMenuUp(rowIndex, pagedRows.length))
                              : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {pagedRows.length === 0 ? (
                      <tr>
                        <td colSpan={isProductsModule ? 10 : 9}><p className="status">No hay productos para los filtros actuales.</p></td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}

            <footer className="inventory-table-footer-modern">
              <span>
                Mostrando {pagedRows.length} de {filteredRows.length} {isMovementsModule ? 'movimientos' : isAdjustModule ? 'ajustes' : isCombosModule ? 'combos' : isCategoriesModule ? 'categorias' : 'productos'}
              </span>
              <div className="inventory-pagination-modern">
                <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))}>{'<'}</button>
                <button type="button" className="active">{safePage}</button>
                <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>{'>'}</button>
                <select className="inventory-page-size-select" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  <option value={8}>8 por pagina</option>
                  <option value={15}>15 por pagina</option>
                  <option value={25}>25 por pagina</option>
                </select>
              </div>
            </footer>
          </article>
        </div>

        {isOverviewModule ? (
          <div className="inventory-right-stack">
            <aside className="inventory-categories-card">
              <header>
                <h3>Categorias</h3>
                <button type="button" className="link-button" onClick={handleViewAllCategories}>
                  Ver todas
                </button>
              </header>
              <ul>
                {categoriesList.slice(0, SIDEBAR_CATEGORY_LIMIT).map((category) => (
                  <li key={category.name}>
                    <button type="button" className="inventory-category-action" onClick={() => handleSelectCategory(category.name)}>
                      <span
                        className={`inventory-category-icon ${toCategoryClass(category.name)}`}
                        style={{
                          color: normalizeHexColor(category.color, DEFAULT_CATEGORY_COLOR),
                          borderColor: withHexAlpha(category.color, '66'),
                          backgroundColor: withHexAlpha(category.color, '1A'),
                        }}
                      >
                        <CategoryIcon category={category.name} iconKey={category.icon} />
                      </span>
                      <div>
                        <strong>{category.name}</strong>
                        <span>{category.count} productos</span>
                      </div>
                      <span className="inventory-category-arrow">{'>'}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {categoriesList.length > SIDEBAR_CATEGORY_LIMIT ? (
                <button type="button" className="inventory-categories-more" onClick={handleViewAllCategories}>
                  Ver todas las categorias
                  <span>{categoriesList.length}</span>
                </button>
              ) : null}
            </aside>

            <aside className="inventory-activity-card">
              <header>
                <h3>Actividad Reciente</h3>
                <button type="button" className="link-button" onClick={() => onSwitchInventoryModule?.('inventario_movimientos')}>
                  Ver movimientos
                </button>
              </header>
              <ul>
                {recentActivity.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="inventory-activity-action"
                      onClick={() => {
                        onSwitchInventoryModule?.('inventario_movimientos');
                        setQuery(entry.itemName ?? '');
                        setMovementTypeFilter(entry.type);
                        setShowFilters(true);
                      }}
                    >
                      <span className={`inventory-activity-dot ${entry.type}`}>
                        <ActivityIcon type={entry.type} />
                      </span>
                      <div>
                        <strong>{entry.title}</strong>
                        <p>{entry.detail}</p>
                        <small>{entry.when}</small>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        ) : null}
      </div>

      {showAllCategoriesModal ? (
        <div className="reset-modal-backdrop" onClick={() => setShowAllCategoriesModal(false)}>
          <section className="reset-modal inventory-all-categories-modal" onClick={(event) => event.stopPropagation()}>
            <header className="inventory-all-categories-header">
              <div>
                <span className="inventory-detail-kicker">Catalogo completo</span>
                <h3>Todas las categorias</h3>
                <p>Selecciona una categoria para filtrar productos o entra a gestionarlas.</p>
              </div>
              <button type="button" className="ghost-button" onClick={() => setShowAllCategoriesModal(false)}>
                Cerrar
              </button>
            </header>
            <div className="inventory-all-categories-list">
              {categoriesList.map((category) => (
                <button key={category.name} type="button" className="inventory-category-action" onClick={() => handleSelectCategory(category.name)}>
                  <span
                    className={`inventory-category-icon ${toCategoryClass(category.name)}`}
                    style={{
                      color: normalizeHexColor(category.color, DEFAULT_CATEGORY_COLOR),
                      borderColor: withHexAlpha(category.color, '66'),
                      backgroundColor: withHexAlpha(category.color, '1A'),
                    }}
                  >
                    <CategoryIcon category={category.name} iconKey={category.icon} />
                  </span>
                  <div>
                    <strong>{category.name}</strong>
                    <span>{category.count} productos</span>
                  </div>
                  <span className="inventory-category-arrow">{'>'}</span>
                </button>
              ))}
            </div>
            <div className="reset-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setShowAllCategoriesModal(false)}>
                Cerrar
              </button>
              <button type="button" className="primary-button" onClick={handleManageCategories}>
                Gestionar categorias
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {productModalMode ? (
        <div className="reset-modal-backdrop" onClick={() => setProductModalMode(null)}>
          <form className="reset-modal inventory-product-modal" onSubmit={handleSubmitProduct} onClick={(event) => event.stopPropagation()}>
            <h3>{productModalMode === 'edit' ? 'Editar Producto' : 'Nuevo Producto'}</h3>
            <p>Registra informacion base para mantener stock, precios y valorizacion.</p>
            <div className="inventory-modal-grid">
              <label>
                Nombre
                <input value={productForm.name} onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))} required />
              </label>
              <label>
                Codigo del item (opcional)
                <input
                  value={productForm.sku}
                  onChange={(event) => setProductForm((current) => ({ ...current, sku: event.target.value }))}
                  placeholder="Ej: SILLA-001"
                />
              </label>
              <label>
                Categoria
                <select value={productForm.category} onChange={(event) => setProductForm((current) => ({ ...current, category: event.target.value }))} required>
                  {categories.map((category) => (
                    <option key={category.id} value={category.name}>{category.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Marca
                <input value={productForm.brand} onChange={(event) => setProductForm((current) => ({ ...current, brand: event.target.value }))} />
              </label>
              <label>
                Color o descripcion
                <input value={productForm.itemColor} onChange={(event) => setProductForm((current) => ({ ...current, itemColor: event.target.value }))} />
              </label>
              <label>
                Stock fisico final
                <input type="number" min="0" step="1" value={productForm.totalStock} onChange={(event) => setProductForm((current) => ({ ...current, totalStock: event.target.value }))} required />
                <small>
                  Este valor reemplaza el stock actual; no suma unidades. No registres luego la misma diferencia como entrada.
                </small>
              </label>
              <label>
                Precio alquiler (Bs)
                <input type="number" min="0" step="0.01" value={productForm.rentalPriceBs} onChange={(event) => setProductForm((current) => ({ ...current, rentalPriceBs: event.target.value }))} required />
              </label>
              <label>
                Cargo dano (Bs)
                <input type="number" min="0" step="0.01" value={productForm.damagedUnitChargeBs} onChange={(event) => setProductForm((current) => ({ ...current, damagedUnitChargeBs: event.target.value }))} required />
              </label>
              <label>
                Cargo perdida (Bs)
                <input type="number" min="0" step="0.01" value={productForm.missingUnitChargeBs} onChange={(event) => setProductForm((current) => ({ ...current, missingUnitChargeBs: event.target.value }))} required />
              </label>
              <div className="full-width inventory-image-editor">
                <input
                  ref={productImageInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleProductImageChange}
                />
                <div className="inventory-image-preview">
                  {productForm.imagePreviewUrl ? (
                    <ProductImage
                      src={productForm.imagePreviewUrl}
                      alt="Vista previa del producto"
                      fallback={<span className="inventory-thumb-fallback">IMG</span>}
                    />
                  ) : (
                    <span>Sin imagen</span>
                  )}
                </div>
                <div className="inventory-image-actions">
                  <button type="button" className="ghost-button" onClick={() => productImageInputRef.current?.click()}>
                    {productForm.imagePreviewUrl ? 'Cambiar imagen' : 'Subir imagen'}
                  </button>
                  {productForm.imagePreviewUrl ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setProductForm((current) => ({
                        ...current,
                        imageUrl: null,
                        imageDataUrl: null,
                        imageFile: null,
                        imagePreviewUrl: null,
                        imageRemoved: true,
                        imageFileName: '',
                      }))}
                    >
                      Quitar imagen
                    </button>
                  ) : null}
                  {productForm.imageFileName ? <small>{productForm.imageFileName}</small> : null}
                </div>
              </div>
            </div>
            {productError ? <p className="status error reset-modal-error">{productError}</p> : null}
            <div className="reset-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setProductModalMode(null)} disabled={isSavingProduct}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isSavingProduct}>
                {isSavingProduct
                  ? 'Guardando...'
                  : productModalMode === 'edit'
                    ? 'Guardar cambios'
                    : 'Crear producto'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {comboModalMode ? (
        <div className="reset-modal-backdrop inventory-combo-modal-backdrop" onClick={() => setComboModalMode(null)}>
          <form className="reset-modal inventory-product-modal inventory-combo-modal" onSubmit={handleSubmitCombo} onClick={(event) => event.stopPropagation()}>
            <header className="inventory-combo-modal-head">
              <div>
                <h3>{comboModalMode === 'edit' ? 'Editar Combo' : 'Nuevo Combo'}</h3>
                <p>Combina productos existentes y define un precio final independiente para contratos y cotizaciones.</p>
              </div>
              <button
                type="button"
                className="inventory-combo-modal-close"
                onClick={() => setComboModalMode(null)}
                aria-label="Cerrar"
              >
                ×
              </button>
            </header>
            <div className="inventory-modal-grid">
              <label>
                Nombre del combo
                <input value={comboForm.name} onChange={(event) => setComboForm((current) => ({ ...current, name: event.target.value }))} required />
              </label>
              <label>
                Precio del combo (Bs)
                <input type="number" min="0" step="0.01" value={comboForm.rentalPriceBs} onChange={(event) => setComboForm((current) => ({ ...current, rentalPriceBs: event.target.value }))} required />
              </label>
              <div className="full-width inventory-combo-pricing-condition">
                <label className="inventory-toggle-line">
                  <input
                    type="checkbox"
                    checked={Boolean(comboForm.pricingCondition?.enabled)}
                    onChange={(event) => setComboForm((current) => ({
                      ...current,
                      pricingCondition: {
                        ...(current.pricingCondition ?? {}),
                        enabled: event.target.checked,
                        upToUnitPriceBs: event.target.checked && Number(current.pricingCondition?.upToUnitPriceBs ?? 0) <= 0
                          ? current.rentalPriceBs
                          : current.pricingCondition?.upToUnitPriceBs,
                      },
                    }))}
                  />
                  Precio condicionado por cantidad
                </label>
                {comboForm.pricingCondition?.enabled ? (
                  <div className="inventory-modal-grid compact">
                    <label>
                      Hasta cantidad
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={comboForm.pricingCondition.upToQuantity}
                        onChange={(event) => setComboForm((current) => ({
                          ...current,
                          pricingCondition: {
                            ...(current.pricingCondition ?? {}),
                            upToQuantity: event.target.value,
                          },
                        }))}
                      />
                    </label>
                    <label>
                      Precio unitario hasta ahi
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={comboForm.pricingCondition.upToUnitPriceBs}
                        onChange={(event) => setComboForm((current) => ({
                          ...current,
                          pricingCondition: {
                            ...(current.pricingCondition ?? {}),
                            upToUnitPriceBs: event.target.value,
                          },
                        }))}
                      />
                    </label>
                    <label>
                      Precio unitario arriba
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={comboForm.pricingCondition.aboveUnitPriceBs}
                        onChange={(event) => setComboForm((current) => ({
                          ...current,
                          pricingCondition: {
                            ...(current.pricingCondition ?? {}),
                            aboveUnitPriceBs: event.target.value,
                          },
                        }))}
                      />
                    </label>
                  </div>
                ) : null}
              </div>
              <label className="full-width">
                Notas internas
                <input value={comboForm.notes} onChange={(event) => setComboForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Ej: Mesa coctelera + mantel + capuchon" />
              </label>
              <div className="full-width inventory-image-editor inventory-combo-image-editor">
                <input
                  ref={comboImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={handleComboImageChange}
                />
                <div className="inventory-image-preview">
                  {comboForm.imagePreviewUrl ? (
                    <ProductImage
                      src={comboForm.imagePreviewUrl}
                      alt="Vista previa del combo"
                      fallback={<span className="inventory-thumb-fallback">CB</span>}
                    />
                  ) : (
                    <span className="inventory-combo-image-empty">CB</span>
                  )}
                </div>
                <div className="inventory-image-actions">
                  <strong>Imagen del combo</strong>
                  <small>Usa una foto clara del paquete armado. JPG, PNG o WEBP.</small>
                  <button type="button" className="ghost-button" onClick={() => comboImageInputRef.current?.click()}>
                    {comboForm.imagePreviewUrl ? 'Cambiar imagen' : 'Subir imagen'}
                  </button>
                  {comboForm.imagePreviewUrl ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setComboForm((current) => ({
                        ...current,
                        imageUrl: null,
                        imageDataUrl: null,
                        imageFile: null,
                        imagePreviewUrl: null,
                        imageRemoved: true,
                        imageFileName: '',
                      }))}
                    >
                      Quitar imagen
                    </button>
                  ) : null}
                  {comboForm.imageFileName ? <small>{comboForm.imageFileName}</small> : null}
                </div>
              </div>
              <div className="full-width inventory-combo-rule-builder">
                <header>
                  <div>
                    <strong>Agregar componente</strong>
                    <span>Define si el cliente podrá elegir entre productos específicos o toda una categoría.</span>
                  </div>
                  <label>
                    Cantidad por combo
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={comboRuleDraft.quantity}
                      onChange={(event) => setComboRuleDraft((current) => ({ ...current, quantity: event.target.value }))}
                    />
                  </label>
                </header>
                <div className="inventory-combo-mode-switch">
                  <button
                    type="button"
                    className={comboRuleDraft.mode === 'items' ? 'active' : ''}
                    onClick={() => setComboRuleDraft((current) => ({ ...current, mode: 'items', category: '' }))}
                  >
                    Productos permitidos
                  </button>
                  <button
                    type="button"
                    className={comboRuleDraft.mode === 'category' ? 'active' : ''}
                    onClick={() => setComboRuleDraft((current) => ({ ...current, mode: 'category', itemIds: [] }))}
                  >
                    Categoría completa
                  </button>
                </div>
                <label>
                  Nombre visible del componente
                  <input
                    value={comboRuleDraft.label}
                    onChange={(event) => setComboRuleDraft((current) => ({ ...current, label: event.target.value }))}
                    placeholder="Ej: Mesa, Mantel, Capuchón o Sillas"
                  />
                </label>
                {comboRuleDraft.mode === 'category' ? (
                  <label>
                    Categoría permitida
                    <select
                      value={comboRuleDraft.category}
                      onChange={(event) => setComboRuleDraft((current) => ({ ...current, category: event.target.value }))}
                    >
                      <option value="">Seleccionar categoría...</option>
                      {categoriesList.map((category) => (
                        <option key={category.name} value={category.name}>{category.name}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <input
                      type="search"
                      value={comboIngredientQuery}
                      onChange={(event) => setComboIngredientQuery(event.target.value)}
                      placeholder="Buscar por nombre, categoria, color, material o codigo..."
                    />
                    <p className="inventory-combo-search-hint">
                      {comboSelectableRows.length} resultado{comboSelectableRows.length === 1 ? '' : 's'} visibles. Puedes seleccionar uno o varios modelos para este componente.
                    </p>
                    <div className="inventory-movement-gallery inventory-combo-options-gallery">
                      {comboSelectableRows.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          className={`inventory-movement-item-card${comboRuleDraft.itemIds.includes(row.id) ? ' selected' : ''}`}
                          onClick={() => toggleComboRuleItem(row.id)}
                        >
                      <div className="inventory-product-cell">
                        {getProductImageSrc(row) ? (
                          <div className="inventory-product-thumb">
                            <ProductImage
                              item={row}
                              alt={`Imagen de ${row.name}`}
                              fallback={<span className="inventory-thumb-fallback">IMG</span>}
                            />
                          </div>
                        ) : (
                          <div className="inventory-product-thumb">
                            <span className="inventory-thumb-fallback">IMG</span>
                          </div>
                        )}
                        <div>
                          <strong>{row.name}</strong>
                          <span>{row.category} - {formatBs(row.price)}</span>
                        </div>
                      </div>
                      <div className="inventory-movement-item-meta">
                        <span>{row.controlsStock ? `Disponible: ${row.available}` : 'No descuenta aun'}</span>
                        <span>{comboRuleDraft.itemIds.includes(row.id) ? 'Seleccionado' : 'Elegir'}</span>
                      </div>
                        </button>
                      ))}
                      {comboSelectableRows.length === 0 ? (
                        <p className="inventory-movement-empty">No hay productos con ese criterio.</p>
                      ) : null}
                    </div>
                  </>
                )}
                <button type="button" className="primary-button inventory-combo-add-rule" onClick={addComboRule}>
                  + Agregar componente al combo
                </button>
              </div>
              <div className="full-width inventory-combo-editor">
                <header>
                  <strong>Ingredientes seleccionados</strong>
                  <span>Separado: {formatBs(comboIngredientValue)} | Combo: {formatBs(Number(comboForm.rentalPriceBs ?? 0))}</span>
                </header>
                <p className="inventory-combo-price-help">
                  Elige en que componente se mostrara el precio total del combo. Este cambio no modifica contratos ya guardados.
                </p>
                {comboIngredientRows.length === 0 ? (
                  <p className="status">Aun no agregaste ingredientes.</p>
                ) : (
                  comboIngredientRows.map((line) => (
                    <div
                      key={`${line.itemId}-${line.lineIndex}`}
                      className={`inventory-combo-line${comboForm.priceIngredientSignature === line.ingredientSignature ? ' is-price-target' : ''}`}
                    >
                      <span>
                        <strong>{line.slotLabel || line.item.name}</strong>
                        <small>
                          {line.selectionMode === 'category'
                            ? `Categoría: ${line.category} · ${line.optionRows.length} opciones`
                            : `${line.optionRows.length} producto(s) permitido(s)`}
                        </small>
                      </span>
                      <label>
                        Cant.
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={line.quantity}
                          onChange={(event) => updateComboIngredientQuantity(line.lineIndex, event.target.value)}
                        />
                      </label>
                      <label className="inventory-combo-price-target">
                        <input
                          type="radio"
                          name="combo-price-ingredient"
                          checked={comboForm.priceIngredientSignature === line.ingredientSignature}
                          onChange={() => selectComboPriceIngredient(line.lineIndex)}
                        />
                        <span>Mostrar precio aqu&iacute;</span>
                      </label>
                      <strong>{line.quantity} por combo</strong>
                      <button type="button" className="danger-button" onClick={() => removeComboIngredient(line.lineIndex)}>
                        Quitar
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
            {comboError ? <p className="status error reset-modal-error">{comboError}</p> : null}
            <div className="reset-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setComboModalMode(null)} disabled={isSavingCombo}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isSavingCombo}>
                {isSavingCombo
                  ? 'Guardando...'
                  : comboModalMode === 'edit'
                    ? 'Guardar cambios'
                    : 'Crear combo'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {areaAssignment ? (
        <div className="reset-modal-backdrop" onClick={() => !isSavingArea && setAreaAssignment(null)}>
          <section
            className="reset-modal inventory-area-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-area-title"
          >
            <div className="inventory-area-modal-head">
              <div>
                <span>Organización de inventario</span>
                <h3 id="inventory-area-title">Asignar área</h3>
                <p>{areaAssignment.name}</p>
              </div>
              <button type="button" onClick={() => setAreaAssignment(null)} aria-label="Cerrar" disabled={isSavingArea}>×</button>
            </div>
            <div className="inventory-area-options">
              {INVENTORY_AREAS.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  className={areaAssignment.area === area.id ? 'selected' : ''}
                  onClick={() => setAreaAssignment((current) => ({ ...current, area: area.id }))}
                >
                  <span className={`inventory-area-icon ${area.id}`}>
                    {area.id === 'vajilla' ? 'V' : area.id === 'manteleria' ? 'M' : 'MB'}
                  </span>
                  <span>
                    <strong>{area.label}</strong>
                    <small>
                      {area.id === 'vajilla'
                        ? 'Cristalería, cubiertos, vasos y accesorios.'
                        : area.id === 'manteleria'
                          ? 'Manteles, servilletas, gasas y textiles.'
                          : 'Mesas, sillas, paneles, toldos y estructuras.'}
                    </small>
                  </span>
                  <i aria-hidden="true">{areaAssignment.area === area.id ? '✓' : ''}</i>
                </button>
              ))}
            </div>
            <div className="inventory-area-current">
              Las impresiones individuales colocarán este producto en <strong>{getInventoryAreaLabel(areaAssignment.area)}</strong>.
            </div>
            <div className="reset-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setAreaAssignment(null)} disabled={isSavingArea}>
                Cancelar
              </button>
              <button type="button" className="primary-button" onClick={saveAreaAssignment} disabled={isSavingArea}>
                {isSavingArea ? 'Guardando...' : 'Guardar área'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {movementModalOpen ? (
        <div className="reset-modal-backdrop" onClick={closeMovementModal}>
          <form className="reset-modal inventory-movement-modal" onSubmit={handleSubmitMovement} onClick={(event) => event.stopPropagation()}>
            <h3>Registrar Movimiento</h3>
            <p>Registra entradas, salidas o ajustes para mantener trazabilidad del stock.</p>
            <div className="inventory-modal-grid">
              <div className="full-width inventory-movement-product-picker">
                Producto
                <input
                  type="search"
                  value={movementItemQuery}
                  onChange={(event) => setMovementItemQuery(event.target.value)}
                  placeholder="Buscar por nombre, codigo o categoria..."
                />
                <div className="inventory-movement-gallery">
                  {movementSelectableRows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className={`inventory-movement-item-card ${movementForm.itemId === row.id ? 'active' : ''}`}
                      onClick={() =>
                        setMovementForm((current) => ({
                          ...current,
                          itemId: row.id,
                          targetTotalStock:
                            current.type === 'ajuste' ? String(row.total) : current.targetTotalStock,
                        }))}
                    >
                      <div className="inventory-product-cell">
                        {getProductImageSrc(row) ? (
                          <div className="inventory-product-thumb">
                            <ProductImage
                              item={row}
                              alt={`Imagen de ${row.name}`}
                              fallback={<span className="inventory-thumb-fallback">IMG</span>}
                            />
                          </div>
                        ) : (
                          <div className="inventory-product-thumb">
                            <span className="inventory-thumb-fallback">IMG</span>
                          </div>
                        )}
                        <div>
                          <strong>{row.name}</strong>
                          <span>Codigo: {row.sku}</span>
                        </div>
                      </div>
                      <div className="inventory-movement-item-meta">
                        <span>Categoria: {row.category}</span>
                        <span>Disponible: {row.available} / Total: {row.total}</span>
                      </div>
                    </button>
                  ))}
                  {movementSelectableRows.length === 0 ? (
                    <p className="inventory-movement-empty">No hay productos con ese criterio.</p>
                  ) : null}
                </div>
              </div>
              <label>
                Tipo
                <select value={movementForm.type} onChange={(event) => setMovementForm((current) => ({ ...current, type: event.target.value }))}>
                  <option value="entrada">Entrada</option>
                  <option value="salida">Salida</option>
                  <option value="ajuste">Ajuste</option>
                </select>
              </label>
              {movementForm.type === 'ajuste' ? (
                <label>
                  Stock fisico
                  <input type="number" min="0" step="1" value={movementForm.targetTotalStock} onChange={(event) => setMovementForm((current) => ({ ...current, targetTotalStock: event.target.value }))} required />
                </label>
              ) : (
                <label>
                  Cantidad
                  <input type="number" min="1" step="1" value={movementForm.quantity} onChange={(event) => setMovementForm((current) => ({ ...current, quantity: event.target.value }))} required />
                </label>
              )}
              <label className="full-width">
                Motivo
                <input value={movementForm.reason} onChange={(event) => setMovementForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Ej: Conteo fisico, reposicion, rotura, etc." required />
              </label>
            </div>
            {movementError ? <p className="status error reset-modal-error">{movementError}</p> : null}
            <div className="reset-modal-actions">
              <button type="button" className="ghost-button" onClick={closeMovementModal}>
                Cancelar
              </button>
              <button type="submit" className="primary-button">Guardar movimiento</button>
            </div>
          </form>
        </div>
      ) : null}

      {categoryModalMode ? (
        <div className="reset-modal-backdrop" onClick={() => setCategoryModalMode(null)}>
          <form className="reset-modal inventory-category-modal" onSubmit={handleSubmitCategory} onClick={(event) => event.stopPropagation()}>
            <h3>{categoryModalMode === 'edit' ? 'Editar Categoria' : 'Nueva Categoria'}</h3>
            <p>Configura nombre, icono y color para usar esta categoria en productos.</p>
            <div className="inventory-modal-grid">
              <label>
                Nombre de categoria
                <input
                  value={categoryForm.name}
                  onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Ej: Iluminacion"
                  required
                />
              </label>
              <label>
                Icono
                <div className="inventory-icon-catalog" role="radiogroup" aria-label="Catalogo de iconos">
                  {CATEGORY_ICON_OPTIONS.map((entry) => {
                    const selected = categoryForm.icon === entry.value;
                    return (
                      <button
                        key={entry.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`inventory-icon-option ${selected ? 'active' : ''}`}
                        onClick={() => setCategoryForm((current) => ({ ...current, icon: entry.value }))}
                      >
                        <span className="inventory-icon-option-glyph">
                          <CategoryIcon iconKey={entry.value} category={entry.label} />
                        </span>
                        <span>{entry.label}</span>
                      </button>
                    );
                  })}
                </div>
              </label>
              <label>
                Color principal
                <input
                  type="color"
                  value={normalizeHexColor(categoryForm.color, DEFAULT_CATEGORY_COLOR)}
                  onChange={(event) => setCategoryForm((current) => ({ ...current, color: event.target.value }))}
                />
              </label>
              <label>
                Codigo HEX
                <input
                  value={categoryForm.color}
                  onChange={(event) => setCategoryForm((current) => ({ ...current, color: event.target.value }))}
                  placeholder="#5D59E0"
                />
              </label>
              <div className="full-width inventory-category-preview">
                <span
                  className="inventory-category-icon-custom"
                  style={{
                    color: normalizeHexColor(categoryForm.color, DEFAULT_CATEGORY_COLOR),
                    borderColor: withHexAlpha(categoryForm.color, '66'),
                    backgroundColor: withHexAlpha(categoryForm.color, '1A'),
                  }}
                >
                  <CategoryIcon category={categoryForm.name} iconKey={categoryForm.icon} />
                </span>
                <div>
                  <strong>{categoryForm.name || 'Nombre de categoria'}</strong>
                  <small>Vista previa del icono y color.</small>
                </div>
              </div>
            </div>
            {categoryError ? <p className="status error reset-modal-error">{categoryError}</p> : null}
            <div className="reset-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setCategoryModalMode(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary-button">
                {categoryModalMode === 'edit' ? 'Guardar cambios' : 'Crear categoria'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {detailRow ? (
        <div className="reset-modal-backdrop" onClick={() => setDetailRow(null)}>
          <section className="reset-modal inventory-detail-modal" onClick={(event) => event.stopPropagation()}>
            <header className="inventory-detail-head">
              <div className="inventory-detail-media">
                {getProductImageSrc(detailRow) ? (
                  <button
                    type="button"
                    className="inventory-detail-image-button"
                    onClick={() => handleOpenImagePreview(getProductImageSrc(detailRow), detailRow.name || detailRow.itemName)}
                    title="Ver imagen en grande"
                  >
                    <ProductImage
                      item={detailRow}
                      alt={`Imagen de ${detailRow.name || detailRow.itemName || 'producto'}`}
                      fallback={<CategoryIcon category={detailRow.category || detailRow.name || detailRow.itemName} />}
                    />
                  </button>
                ) : (
                  <CategoryIcon category={detailRow.category || detailRow.name || detailRow.itemName} />
                )}
              </div>
              <div className="inventory-detail-title">
                <span className="inventory-detail-kicker">{detailRow.reference ? 'Movimiento de inventario' : detailRow.detailKind === 'combo' ? 'Combo de inventario' : 'Producto de inventario'}</span>
                <h3>{detailRow.name || detailRow.itemName || 'Detalle'}</h3>
                <div className="inventory-detail-tags">
                  {detailRow.category ? <span className={`inventory-pill ${toCategoryClass(detailRow.category)}`}>{detailRow.category}</span> : null}
                  {detailRow.sku ? <span>Codigo {detailRow.sku}</span> : null}
                  {detailRow.lowAvailability !== undefined ? (
                    <span className={detailRow.lowAvailability ? 'inventory-status low' : 'inventory-status ok'}>
                      {detailRow.lowAvailability ? 'Stock bajo' : 'Disponible'}
                    </span>
                  ) : null}
                </div>
              </div>
            </header>

            {detailRow.available !== undefined || detailRow.total !== undefined || detailRow.beforeStock !== undefined ? (
              <div className="inventory-detail-stats">
                {detailRow.available !== undefined ? (
                  <div>
                    <span>Disponible</span>
                    <strong>{detailRow.available}</strong>
                  </div>
                ) : null}
                {detailRow.reserved !== undefined ? (
                  <div>
                    <span>Reservado</span>
                    <strong>{detailRow.reserved}</strong>
                  </div>
                ) : null}
                {detailRow.maintenance !== undefined ? (
                  <div>
                    <span>Mantenimiento</span>
                    <strong>{detailRow.maintenance}</strong>
                  </div>
                ) : null}
                {detailRow.total !== undefined ? (
                  <div>
                    <span>Total</span>
                    <strong>{detailRow.total}</strong>
                  </div>
                ) : null}
                {detailRow.beforeStock !== undefined ? (
                  <div>
                    <span>Stock anterior</span>
                    <strong>{detailRow.beforeStock}</strong>
                  </div>
                ) : null}
                {detailRow.afterStock !== undefined ? (
                  <div>
                    <span>Stock nuevo</span>
                    <strong>{detailRow.afterStock}</strong>
                  </div>
                ) : null}
                {detailRow.deltaUnits !== undefined ? (
                  <div>
                    <span>Diferencia</span>
                    <strong>{detailRow.deltaUnits > 0 ? `+${detailRow.deltaUnits}` : detailRow.deltaUnits}</strong>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="inventory-detail-grid">
              {detailRow.brand ? (
                <div>
                  <span>Marca</span>
                  <strong>{detailRow.brand}</strong>
                </div>
              ) : null}
              {detailRow.itemColor ? (
                <div>
                  <span>Color o descripcion</span>
                  <strong>{detailRow.itemColor}</strong>
                </div>
              ) : null}
              {detailRow.reference ? (
                <div>
                  <span>Referencia</span>
                  <strong>{detailRow.reference}</strong>
                </div>
              ) : null}
              {detailRow.createdAt ? (
                <div>
                  <span>Fecha</span>
                  <strong>{formatDateTime(detailRow.createdAt)}</strong>
                </div>
              ) : null}
              {detailRow.observation ? (
                <div className="inventory-detail-note">
                  <span>Observacion</span>
                  <strong>{detailRow.observation}</strong>
                </div>
              ) : null}
            </div>

            {detailRow.price !== undefined || detailRow.damagedUnitChargeBs !== undefined || detailRow.missingUnitChargeBs !== undefined ? (
              <div className="inventory-detail-money">
                {detailRow.price !== undefined ? (
                  <div>
                    <span>Precio alquiler</span>
                    <strong>{formatBs(detailRow.price)}</strong>
                  </div>
                ) : null}
                {detailRow.damagedUnitChargeBs !== undefined ? (
                  <div>
                    <span>Cargo dano</span>
                    <strong>{formatBs(detailRow.damagedUnitChargeBs)}</strong>
                  </div>
                ) : null}
                {detailRow.missingUnitChargeBs !== undefined ? (
                  <div>
                    <span>Cargo perdida</span>
                    <strong>{formatBs(detailRow.missingUnitChargeBs)}</strong>
                  </div>
                ) : null}
              </div>
            ) : null}
            {detailRow.detailKind === 'combo' && Array.isArray(detailRow.ingredients) ? (
              <section className="inventory-detail-combo-components">
                <div>
                  <span className="inventory-detail-kicker">Componentes del combo</span>
                  <strong>{detailRow.ingredients.length} producto(s) dentro del combo</strong>
                </div>
                <div className="inventory-detail-combo-list">
                  {detailRow.ingredients.map((line) => (
                    <span key={`${detailRow.id}-${line.itemId}-${line.slotLabel || line.itemName}`}>
                      {line.quantity}x {line.itemName}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}
            {detailStockExplanation ? (
              <section className="inventory-stock-explain">
                <div className="inventory-stock-explain-head">
                  <div>
                    <span className="inventory-detail-kicker">Trazabilidad de stock</span>
                    <h4>Por que este producto queda con {detailStockExplanation.available} disponible</h4>
                  </div>
                  {detailStockExplanation.overReserved ? (
                    <strong className="is-alert">Faltan {detailStockExplanation.missingToCover} u. para cubrir reservas</strong>
                  ) : (
                    <strong>Stock cubierto</strong>
                  )}
                </div>
                <div className="inventory-stock-equation">
                  <div>
                    <span>Stock fisico</span>
                    <strong>{detailStockExplanation.total}</strong>
                  </div>
                  <b>-</b>
                  <div>
                    <span>Comprometido</span>
                    <strong>{detailStockExplanation.reserved}</strong>
                  </div>
                  <b>-</b>
                  <div>
                    <span>Mantenimiento</span>
                    <strong>{detailStockExplanation.maintenance}</strong>
                  </div>
                  <b>=</b>
                  <div className={detailStockExplanation.available <= 0 ? 'is-zero' : ''}>
                    <span>Disponible</span>
                    <strong>{detailStockExplanation.available}</strong>
                  </div>
                </div>
                {detailMovementTrace.length > 0 ? (
                  <div className="inventory-stock-trace-list">
                    {detailMovementTrace.slice(0, 18).map((entry) => (
                      <article key={entry.id}>
                        <div>
                          <strong>{entry.dateLabel}</strong>
                          <span>{entry.typeLabel} - {entry.reference}</span>
                        </div>
                        <div>
                          <span>Responsable</span>
                          <strong>{entry.userName}</strong>
                          <small>Registrado por {entry.registeredByName}</small>
                        </div>
                        <div>
                          <span>Cantidad</span>
                          <strong className={entry.deltaUnits < 0 ? 'is-negative' : 'is-positive'}>
                            {entry.deltaUnits > 0 ? `+${entry.deltaUnits}` : entry.deltaUnits}
                          </strong>
                        </div>
                        <div>
                          <span>{entry.beforeAfterLabel}</span>
                          <strong>{entry.beforeStock} {'->'} {entry.afterStock}</strong>
                        </div>
                        <p>{entry.observation}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="inventory-stock-trace-empty">
                    No hay movimientos historicos registrados para este item. Si el stock fisico ya aparece en {detailStockExplanation.total}, el cambio pudo haberse hecho antes de que la bitacora/movimientos empezaran a registrar ese dato.
                  </p>
                )}
              </section>
            ) : null}
            {Array.isArray(detailRow.usage) ? (
              <section className="inventory-usage-section inventory-usage-pro">
                <div className="inventory-usage-head">
                  <div>
                    <span className="inventory-detail-kicker">Ubicacion del inventario</span>
                    <h4>Agenda de contratos y retornos</h4>
                  </div>
                  <strong>{detailUsageSummary.totalCommitted} {detailRow.detailKind === 'combo' ? 'combo(s)' : 'unidades'} comprometidas</strong>
                </div>
                {detailUsageRows.length > 0 ? (
                  <>
                    <div className="inventory-usage-kpis">
                      <div>
                        <span>Contratos / ordenes</span>
                        <strong>{detailUsageSummary.orderCount}</strong>
                      </div>
                      <div>
                        <span>Clientes involucrados</span>
                        <strong>{detailUsageSummary.clientCount}</strong>
                      </div>
                      <div>
                        <span>Proximo retorno</span>
                        <strong>{detailUsageSummary.nextReturn ? detailUsageSummary.nextReturn.pickupLabel : 'Sin retorno'}</strong>
                        {detailUsageSummary.nextReturn ? <small>{detailUsageSummary.nextReturn.customerName}</small> : null}
                      </div>
                      <div className={detailUsageSummary.overdueQty > 0 ? 'is-alert' : ''}>
                        <span>Atrasado</span>
                        <strong>{detailUsageSummary.overdueQty} {detailRow.detailKind === 'combo' ? 'combo(s)' : 'u.'}</strong>
                      </div>
                    </div>

                    <div className="inventory-usage-panorama">
                      <div className="inventory-usage-panorama-head">
                        <div>
                          <span>Panorama operativo</span>
                          <strong>Ordenado por fecha de retorno</strong>
                        </div>
                        <small>La barra muestra el peso de unidades comprometidas por contrato.</small>
                      </div>
                      <div className="inventory-usage-timeline">
                        {detailUsageRows.map((entry) => (
                          <article className={`inventory-usage-timeline-row tone-${entry.statusMeta.tone}`} key={`${entry.usageKey ?? `${entry.rentalId}-${entry.orderCode}`}-timeline`}>
                            <div className="inventory-usage-timeline-date">
                              <strong>{entry.pickupLabel}</strong>
                              <span>{entry.statusMeta.returnText}</span>
                            </div>
                            <div className="inventory-usage-timeline-track">
                              <i style={{ width: `${Math.max(12, Math.min(100, (Number(entry.quantity ?? 0) / detailUsageSummary.maxQuantity) * 100))}%` }} />
                            </div>
                            <div className="inventory-usage-timeline-meta">
                              <strong>{entry.orderCode}</strong>
                              <span>{entry.quantity} {detailRow.detailKind === 'combo' ? 'combo(s)' : 'u.'}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                    <div className="inventory-usage-card-grid">
                    {detailUsageRows.map((entry) => (
                        <article className={`inventory-usage-card tone-${entry.statusMeta.tone}`} key={entry.usageKey ?? `${entry.rentalId}-${entry.orderCode}`}>
                          <header>
                            <div>
                              <strong>{entry.orderCode}</strong>
                              <span>Contrato {entry.contractCode}</span>
                            </div>
                            <b>{entry.quantity} {detailRow.detailKind === 'combo' ? 'combo(s)' : 'u.'}</b>
                          </header>
                          {detailRow.detailKind === 'combo' ? (
                            <p className="inventory-usage-note">
                              {entry.componentLines} componente(s) - {entry.componentUnits} unidad(es) internas
                            </p>
                          ) : null}
                          <div className="inventory-usage-client">
                            <span>Cliente</span>
                            <strong>{entry.customerName}</strong>
                            {entry.eventType ? <small>{entry.eventType}</small> : null}
                          </div>
                          <div className="inventory-usage-dates">
                            <div>
                              <span>Sale / entrega</span>
                              <strong>{entry.deliveryLabel}</strong>
                              <small>{entry.deliveryWindowLabel}</small>
                            </div>
                            <div>
                              <span>Debe volver</span>
                              <strong>{entry.pickupLabel}</strong>
                              <small>{entry.pickupWindowLabel}</small>
                            </div>
                          </div>
                          <div className="inventory-usage-card-foot">
                            <span className={`inventory-usage-status tone-${entry.statusMeta.tone}`}>{entry.statusMeta.label}</span>
                            <strong>{entry.statusMeta.returnText}</strong>
                          </div>
                          {entry.address || entry.city ? (
                            <p className="inventory-usage-location">{[entry.address, entry.city].filter(Boolean).join(' - ')}</p>
                          ) : null}
                          {entry.inventoryNote ? <p className="inventory-usage-note">{entry.inventoryNote}</p> : null}
                        </article>
                    ))}
                  </div>
                  </>
                ) : (
                  <div className="inventory-usage-empty">
                    <strong>Disponible sin compromisos activos</strong>
                    <span>Este {detailRow.detailKind === 'combo' ? 'combo' : 'producto'} no aparece reservado, alistado ni pendiente de retorno en contratos u ordenes activas.</span>
                  </div>
                )}
              </section>
            ) : null}
            <div className="reset-modal-actions">
              {detailRow.detailKind === 'combo' ? (
                <button type="button" className="ghost-button" onClick={() => { openEditComboModal(detailRow); setDetailRow(null); }}>
                  Editar combo
                </button>
              ) : null}
              {detailRow.name && detailRow.total !== undefined ? (
                <>
                  <button type="button" className="ghost-button" onClick={() => { openEditProductModal(detailRow); setDetailRow(null); }}>
                    Editar producto
                  </button>
                  <button type="button" className="ghost-button" onClick={() => { openMovementModal(detailRow, 'ajuste'); setDetailRow(null); }}>
                    Ajuste rapido
                  </button>
                </>
              ) : null}
              <button type="button" className="primary-button" onClick={() => setDetailRow(null)}>Cerrar</button>
            </div>
          </section>
        </div>
      ) : null}

      {operationalReportRow ? (() => {
        const dispatchItems = Array.isArray(operationalReportRow.dispatchReview?.items)
          ? operationalReportRow.dispatchReview.items
          : (operationalReportRow.rental?.items ?? []).map((line) => ({
              itemId: line.itemId,
              itemName: line.itemName ?? line.name,
              expectedQty: Math.max(0, Number(line.quantity ?? 0)),
              dispatchedQty: operationalReportRow.inventoryStatus === 'pendiente' || operationalReportRow.inventoryStatus === 'confirmado'
                ? 0
                : Math.max(0, Number(line.quantity ?? 0)),
              pendingQty: 0,
              note: '',
            }));
        const returnItems = Array.isArray(operationalReportRow.rental?.returnReport)
          ? operationalReportRow.rental.returnReport
          : [];
        const expectedTotal = dispatchItems.reduce((sum, line) => sum + Math.max(0, Number(line.expectedQty ?? 0)), 0);
        const dispatchedTotal = dispatchItems.reduce((sum, line) => sum + Math.max(0, Number(line.dispatchedQty ?? 0)), 0);
        const pendingDispatchTotal = dispatchItems.reduce((sum, line) => sum + Math.max(0, Number(line.pendingQty ?? 0)), 0);
        const returnedGoodTotal = returnItems.reduce((sum, line) => sum + Math.max(0, Number(line.returnedQty ?? 0)), 0);
        const damagedTotal = returnItems.reduce((sum, line) => sum + Math.max(0, Number(line.damagedQty ?? 0)), 0);
        const missingTotal = returnItems.reduce((sum, line) => sum + Math.max(0, Number(line.missingQty ?? 0)), 0);
        const pendingClientItems = Array.isArray(operationalReportRow.clientPendingPickup?.items)
          ? operationalReportRow.clientPendingPickup.items
          : [];
        const pendingClientTotal = pendingClientItems.reduce((sum, line) => sum + Math.max(0, Number(line.pendingQty ?? 0)), 0);
        const finalMissingTotal = Math.max(missingTotal, pendingClientTotal);
        const returnStatusLabel = operationalReportRow.returnReview?.status === 'left_with_client'
          ? 'Material con cliente'
          : operationalReportRow.inventoryStatus === 'devuelto'
            ? (missingTotal > 0 || damagedTotal > 0 ? 'Volvió con novedades' : 'Volvió completo')
            : 'Retorno pendiente';
        const finalTone = operationalReportRow.inventoryStatus === 'devuelto'
          ? (damagedTotal > 0 || finalMissingTotal > 0 ? 'warning' : 'success')
          : 'pending';
        const timeline = [
          {
            key: 'ready',
            label: 'Alistado',
            date: operationalReportRow.inventoryConfirmedAt,
            person: operationalReportRow.inventoryConfirmedByName,
            done: Boolean(operationalReportRow.inventoryConfirmedAt),
          },
          {
            key: 'out',
            label: 'Salida',
            date: operationalReportRow.inventoryDispatchedAt,
            person: operationalReportRow.inventoryDispatchedByName,
            done: Boolean(operationalReportRow.inventoryDispatchedAt),
          },
          {
            key: 'back',
            label: 'Retorno',
            date: operationalReportRow.inventoryReturnedAt,
            person: operationalReportRow.inventoryReturnedByName,
            done: Boolean(operationalReportRow.inventoryReturnedAt),
          },
        ];
        const metrics = [
          { label: 'Esperado', value: expectedTotal, tone: 'navy' },
          { label: 'Salió', value: dispatchedTotal, tone: 'orange' },
          { label: 'Falta enviar', value: pendingDispatchTotal, tone: pendingDispatchTotal > 0 ? 'warning' : 'muted' },
          { label: 'Volvió bien', value: returnedGoodTotal, tone: 'success' },
          { label: 'Dañado', value: damagedTotal, tone: damagedTotal > 0 ? 'warning' : 'muted' },
          { label: 'Faltante / cliente', value: finalMissingTotal, tone: finalMissingTotal > 0 ? 'danger' : 'muted' },
        ];
        return (
          <div className="orders-modal-backdrop inventory-report-backdrop" onClick={() => setOperationalReportRow(null)}>
            <section className="inventory-report-modal" onClick={(event) => event.stopPropagation()}>
              <header className="inventory-report-hero">
                <div className="inventory-report-hero-main">
                  <div className="inventory-report-eyebrow-row">
                    <span className="inventory-report-eyebrow">Reporte operativo</span>
                    <span className={`inventory-report-status ${finalTone}`}>{returnStatusLabel}</span>
                  </div>
                  <h3>Contrato {operationalReportRow.contractCode}</h3>
                  <p>{operationalReportRow.orderCode} · {operationalReportRow.customerName}</p>
                </div>
                <button type="button" className="inventory-report-close" onClick={() => setOperationalReportRow(null)} aria-label="Cerrar reporte">×</button>
              </header>

              <div className="inventory-report-body">
                <section className="inventory-report-overview">
                  <div className="inventory-report-client-card">
                    <span>Cliente</span>
                    <strong>{operationalReportRow.customerName}</strong>
                    <small>{operationalReportRow.deliveryAddress || 'Sin dirección registrada'}</small>
                  </div>
                  <div className="inventory-report-client-card">
                    <span>Contrato y orden</span>
                    <strong>{operationalReportRow.contractCode}</strong>
                    <small>{operationalReportRow.orderCode}</small>
                  </div>
                  <div className="inventory-report-client-card wide">
                    <span>Observación general</span>
                    <strong>{operationalReportRow.returnReview?.note || operationalReportRow.dispatchReview?.note || operationalReportRow.clientPendingPickup?.note || 'Sin observaciones registradas.'}</strong>
                  </div>
                </section>

                <section className="inventory-report-timeline-card">
                  <div className="inventory-report-section-head">
                    <div>
                      <span>Trazabilidad</span>
                      <h4>Flujo de la orden</h4>
                    </div>
                    <small>Fechas, horas y responsables</small>
                  </div>
                  <div className="inventory-report-timeline">
                    {timeline.map((step, index) => (
                      <article key={step.key} className={`inventory-report-step ${step.done ? 'done' : 'pending'}`}>
                        <div className="inventory-report-step-marker">{step.done ? '✓' : index + 1}</div>
                        <div>
                          <span>{step.label}</span>
                          <strong>{step.date ? formatDateTime(step.date) : 'Pendiente'}</strong>
                          <small>{step.person || 'Sin responsable registrado'}</small>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="inventory-report-metrics">
                  {metrics.map((metric) => (
                    <article key={metric.label} className={`inventory-report-metric ${metric.tone}`}>
                      <span>{metric.label}</span>
                      <strong>{metric.value}</strong>
                      <small>unidades</small>
                    </article>
                  ))}
                </section>

                <section className="inventory-report-panel">
                  <div className="inventory-report-section-head">
                    <div>
                      <span>Salida</span>
                      <h4>Detalle de material despachado</h4>
                    </div>
                    <div className="inventory-report-inline-status orange">{dispatchedTotal} de {expectedTotal} unidades</div>
                  </div>
                  <div className="inventory-report-table-wrap">
                    <table className="inventory-report-table">
                      <thead><tr><th>Ítem</th><th>Esperado</th><th>Salió</th><th>Pendiente</th><th>Observación</th></tr></thead>
                      <tbody>
                        {dispatchItems.map((line, index) => (
                          <tr key={line.lineKey || `${line.itemId}-${index}`}>
                            <td><strong>{line.itemName || 'Ítem'}</strong></td>
                            <td>{Math.max(0, Number(line.expectedQty ?? 0))}</td>
                            <td><span className="inventory-report-number success">{Math.max(0, Number(line.dispatchedQty ?? 0))}</span></td>
                            <td><span className={`inventory-report-number ${Number(line.pendingQty ?? 0) > 0 ? 'warning' : 'muted'}`}>{Math.max(0, Number(line.pendingQty ?? 0))}</span></td>
                            <td>{line.note || 'Sin observación'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="inventory-report-panel">
                  <div className="inventory-report-section-head">
                    <div>
                      <span>Retorno</span>
                      <h4>Detalle de material recibido</h4>
                    </div>
                    <div className={`inventory-report-inline-status ${finalMissingTotal > 0 || damagedTotal > 0 ? 'warning' : 'success'}`}>
                      {returnedGoodTotal} bien · {damagedTotal} dañados · {finalMissingTotal} faltantes
                    </div>
                  </div>
                  <div className="inventory-report-table-wrap">
                    <table className="inventory-report-table">
                      <thead><tr><th>Ítem</th><th>Bueno</th><th>Dañado</th><th>Faltante</th><th>Observación</th></tr></thead>
                      <tbody>
                        {returnItems.length > 0 ? returnItems.map((line, index) => (
                          <tr key={line.lineKey || line.returnLineKey || `${line.itemId}-${index}`}>
                            <td><strong>{line.itemName || 'Ítem'}</strong></td>
                            <td><span className="inventory-report-number success">{Math.max(0, Number(line.returnedQty ?? 0))}</span></td>
                            <td><span className={`inventory-report-number ${Number(line.damagedQty ?? 0) > 0 ? 'warning' : 'muted'}`}>{Math.max(0, Number(line.damagedQty ?? 0))}</span></td>
                            <td><span className={`inventory-report-number ${Number(line.missingQty ?? 0) > 0 ? 'danger' : 'muted'}`}>{Math.max(0, Number(line.missingQty ?? 0))}</span></td>
                            <td>{line.damageNote || line.note || 'Sin observación'}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan="5" className="inventory-report-empty">Todavía no existe una recepción cerrada para esta orden.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <footer className="inventory-report-footer">
                <span>Documento interno de trazabilidad de inventario</span>
                <button type="button" className="primary-button" onClick={() => setOperationalReportRow(null)}>Cerrar</button>
              </footer>
            </section>
          </div>
        );
      })() : null}

      {dispatchReviewModal ? (
        <div className="orders-modal-backdrop" onClick={() => !isSavingDispatchReview && setDispatchReviewModal(null)}>
          <form className="orders-modal orders-preview-modal" onSubmit={submitDispatchReview} onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>Revision de salida {dispatchReviewModal.contractCode}</h3>
                <p>Inventario constata que salio del galpon y que queda pendiente por enviar.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setDispatchReviewModal(null)} disabled={isSavingDispatchReview}>
                x
              </button>
            </header>
            <div className="orders-preview-body inventory-receiving-body">
              <label className="form-field">
                <span>Resultado de salida</span>
                <select
                  value={dispatchReviewForm.status}
                  onChange={(event) => setDispatchReviewForm((current) => ({ ...current, status: event.target.value }))}
                >
                  {DISPATCH_REVIEW_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Nota general</span>
                <textarea
                  rows={3}
                  value={dispatchReviewForm.note}
                  onChange={(event) => setDispatchReviewForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder="Ej: salieron 202 sillas propias; quedan 80 de proveedor para enviar en segundo viaje."
                />
              </label>
              <div className="inventory-receiving-summary">
                <span><small>Items revisados</small><strong>{dispatchReviewForm.items.length}</strong></span>
                <span><small>Unidades esperadas</small><strong>{dispatchReviewForm.items.reduce((sum, line) => sum + Math.max(0, Number(line.expectedQty ?? 0)), 0)}</strong></span>
                <span><small>Salieron</small><strong>{dispatchReviewForm.items.reduce((sum, line) => sum + Math.max(0, Number(line.dispatchedQty ?? 0)), 0)}</strong></span>
                <span><small>Pendientes</small><strong>{dispatchReviewForm.items.reduce((sum, line) => sum + Math.max(0, Number(line.pendingQty ?? 0)), 0)}</strong></span>
              </div>
              <div className="transport-checklist-table">
                <div className="transport-checklist-head inventory-dispatch-head">
                  <span>Item</span>
                  <span>Esperado</span>
                  <span>Salio</span>
                  <span>Pendiente</span>
                  <span>Observacion</span>
                </div>
                {dispatchReviewForm.items.map((line) => {
                  const expectedQty = Math.max(0, Math.trunc(Number(line.expectedQty ?? 0)));
                  const dispatchedQty = Math.max(0, Math.trunc(Number(line.dispatchedQty ?? 0)));
                  const pendingQty = Math.max(0, Math.trunc(Number(line.pendingQty ?? 0)));
                  const hasMismatch = dispatchedQty + pendingQty !== expectedQty;
                  return (
                    <div key={line.lineKey} className={`transport-checklist-row inventory-dispatch-row ${hasMismatch ? 'has-mismatch' : ''}`}>
                      <strong>{line.itemName}</strong>
                      <span>{expectedQty}</span>
                      <input type="number" min="0" max={expectedQty} value={line.dispatchedQty} onChange={(event) => updateDispatchLine(line.lineKey, 'dispatchedQty', event.target.value)} />
                      <input type="number" min="0" max={expectedQty} value={line.pendingQty} onChange={(event) => updateDispatchLine(line.lineKey, 'pendingQty', event.target.value)} />
                      <input type="text" value={line.note} onChange={(event) => updateDispatchLine(line.lineKey, 'note', event.target.value)} placeholder="Detalle si salio parcial" />
                    </div>
                  );
                })}
              </div>
              {dispatchReviewModal.revisionAlert ? (
                <p className="status warning">Este contrato tuvo cambios despues de salir. Al guardar esta revision se limpia la alerta.</p>
              ) : null}
              {dispatchReviewError ? <p className="status error">{dispatchReviewError}</p> : null}
            </div>
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setDispatchReviewModal(null)} disabled={isSavingDispatchReview}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isSavingDispatchReview}>
                {isSavingDispatchReview ? 'Guardando...' : 'Registrar salida'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {receivingModal ? (
        <div className="orders-modal-backdrop" onClick={() => setReceivingModal(null)}>
          <form className="orders-modal orders-preview-modal" onSubmit={submitReceiving} onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>Recepcion de contrato {receivingModal.rental.contractCode || receivingModal.rental.orderCode}</h3>
                {receivingModal.rental.contractCode && receivingModal.rental.orderCode ? <small>Orden {receivingModal.rental.orderCode}</small> : null}
                <p>Inventario constata si todo volvio o si queda material pendiente con el cliente.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setReceivingModal(null)}>
                x
              </button>
            </header>
            <div className="orders-preview-body inventory-receiving-body">
              <div className="inventory-ops-return-mode">
                <label className="form-field">
                  <span>Resultado del retorno</span>
                  <select
                    value={receivingModal.returnReviewStatus}
                    onChange={(event) => setReceivingModal((current) => (current ? { ...current, returnReviewStatus: event.target.value } : current))}
                  >
                    {RETURN_REVIEW_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Nota general</span>
                  <textarea
                    rows={3}
                    value={receivingModal.returnReviewStatus === 'left_with_client' ? receivingModal.clientPendingNote : receivingModal.notes}
                    onChange={(event) => setReceivingModal((current) => {
                      if (!current) return current;
                      return current.returnReviewStatus === 'left_with_client'
                        ? { ...current, clientPendingNote: event.target.value }
                        : { ...current, notes: event.target.value };
                    })}
                    placeholder={receivingModal.returnReviewStatus === 'left_with_client' ? 'Detalle que quedo con el cliente y cuando se recogera.' : 'Observaciones generales del retorno.'}
                  />
                </label>
              </div>
              {receivingModal.returnReviewStatus === 'left_with_client' ? (
                <p className="status warning">Se reingresara lo que llego y la orden seguira abierta solo por el material pendiente con cliente.</p>
              ) : null}
              <div className="inventory-receiving-summary">
                <span><small>Items revisados</small><strong>{receivingModal.items.length}</strong></span>
                <span><small>Con novedad</small><strong>{receivingTotals.issueRows}</strong></span>
                <span><small>Cobra cliente / garantia</small><strong>{formatBs(receivingTotals.clientPenaltyBs)}</strong></span>
                <span><small>Perdida interna</small><strong>{formatBs(receivingTotals.internalPenaltyBs)}</strong></span>
              </div>
              <div className="transport-checklist-table">
                <div className="transport-checklist-head inventory-receiving-head">
                  <span>Item</span>
                  <span>Esperado</span>
                  <span>Bueno</span>
                  <span>Danado</span>
                  <span>{receivingModal.returnReviewStatus === 'left_with_client' ? 'Pendiente' : 'Faltante'}</span>
                  <span>Precio</span>
                  <span>Origen</span>
                  <span>Total</span>
                  <span>Observacion</span>
                </div>
                {receivingModal.items.map((line) => {
                  const values = getReceivingLineNumbers(line);
                  const hasMismatch = values.balanceQty !== 0;
                  const displayPenaltyBs = receivingModal.returnReviewStatus === 'left_with_client'
                    ? Number((values.damagedQty * values.damagedUnitChargeBs).toFixed(2))
                    : values.penaltyBs;
                  return (
                    <div key={line.returnLineKey} className={`transport-checklist-row inventory-receiving-row ${hasMismatch ? 'has-mismatch' : ''}`}>
                      <strong>{line.itemName}</strong>
                      <span>{line.expectedQty}</span>
                      <input type="number" min="0" max={line.expectedQty} value={line.returnedQty} onChange={(event) => updateReceivingLine(line.returnLineKey, 'returnedQty', event.target.value)} />
                      <input type="number" min="0" max={line.expectedQty} value={line.damagedQty} onChange={(event) => updateReceivingLine(line.returnLineKey, 'damagedQty', event.target.value)} />
                      <input type="number" min="0" max={line.expectedQty} value={line.missingQty} onChange={(event) => updateReceivingLine(line.returnLineKey, 'missingQty', event.target.value)} />
                      <div className="inventory-receiving-price-stack">
                        <label>
                          <small>Dano</small>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={values.damagedQty > 0 ? line.damagedUnitChargeBs : 0}
                            disabled={values.damagedQty <= 0}
                            onChange={(event) => updateReceivingLine(line.returnLineKey, 'damagedUnitChargeBs', event.target.value)}
                            title={values.damagedQty > 0 ? 'Cargo unitario por dano para esta recepcion' : 'Se habilita al registrar unidades danadas'}
                          />
                        </label>
                        <label>
                          <small>Falta</small>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={values.missingQty > 0 ? line.missingUnitChargeBs : 0}
                            disabled={values.missingQty <= 0}
                            onChange={(event) => updateReceivingLine(line.returnLineKey, 'missingUnitChargeBs', event.target.value)}
                            title={values.missingQty > 0 ? 'Cargo unitario por faltante para esta recepcion' : 'Se habilita al registrar unidades faltantes'}
                          />
                        </label>
                      </div>
                      <select value={line.chargeOwner} onChange={(event) => updateReceivingLine(line.returnLineKey, 'chargeOwner', event.target.value)}>
                        {RETURN_CHARGE_OWNER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <span className="inventory-receiving-total">
                        <strong>{formatBs(displayPenaltyBs)}</strong>
                        {hasMismatch ? <small>Revisar suma: {values.balanceQty > 0 ? `faltan ${values.balanceQty}` : `sobran ${Math.abs(values.balanceQty)}`}</small> : null}
                      </span>
                      <input
                        type="text"
                        value={line.damageNote}
                        onChange={(event) => updateReceivingLine(line.returnLineKey, 'damageNote', event.target.value)}
                        placeholder={receivingModal.returnReviewStatus === 'left_with_client' ? 'Detalle de lo pendiente' : 'Detalle si hay dano/faltante'}
                      />
                    </div>
                  );
                })}
              </div>
              {receivingError ? <p className="status error">{receivingError}</p> : null}
            </div>
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setReceivingModal(null)} disabled={isReceiving}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isReceiving}>
                {isReceiving ? 'Registrando...' : receivingModal.returnReviewStatus === 'left_with_client' ? 'Registrar pendiente' : 'Cerrar recepcion'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {documentPreview ? (
        <div className="orders-modal-backdrop" onClick={() => setDocumentPreview(null)}>
          <div className="orders-modal orders-preview-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>{documentPreview.title}</h3>
              <p>
                {documentPreview.format === 'contract'
                  ? 'Vista previa del contrato comercial.'
                  : documentPreview.format === 'individual'
                  ? 'Formato individual en media carta o carta completa segun la cantidad de items.'
                  : 'Vista previa del control operativo de inventario.'}
              </p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setDocumentPreview(null)}>
                x
              </button>
            </header>
            <div className="orders-preview-body">
              <iframe
                id="inventory-document-preview-frame"
                title={documentPreview.title}
                srcDoc={documentPreview.html}
                className="orders-document-frame"
              />
            </div>
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setDocumentPreview(null)}>
                Cerrar
              </button>
              <button type="button" className="primary-button" onClick={printInventoryPreview}>
                Imprimir / guardar PDF
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {valuationOpen ? (
        <div className="reset-modal-backdrop" onClick={() => setValuationOpen(false)}>
          <section className="reset-modal inventory-valuation-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Valuacion de Inventario</h3>
            <p>Resumen de valor por categoria segun stock total y precio de alquiler.</p>
            <div className="inventory-table-wrap-modern">
              <table className="inventory-table-modern inventory-valuation-table">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th>Items</th>
                    <th>Unidades</th>
                    <th>Valor (Bs)</th>
                  </tr>
                </thead>
                <tbody>
                  {valuationRows.map((row) => (
                    <tr key={row.category}>
                      <td>{row.category}</td>
                      <td>{row.items}</td>
                      <td>{row.units}</td>
                      <td>{formatBs(row.value)}</td>
                    </tr>
                  ))}
                  {valuationRows.length === 0 ? (
                    <tr>
                      <td colSpan={4}>Sin datos para valuacion.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="reset-modal-actions">
              <button type="button" className="ghost-button" onClick={handleExport}>Exportar vista actual</button>
              <button type="button" className="primary-button" onClick={() => setValuationOpen(false)}>Cerrar</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export default InventoryDashboardSection;
