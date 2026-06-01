import { useEffect, useMemo, useRef, useState } from 'react';
import { readFileAsDataUrl } from '../../utils/files';

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

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
  category: '',
  brand: '',
  itemColor: '',
  totalStock: '1',
  rentalPriceBs: '0',
  damagedUnitChargeBs: '0',
  missingUnitChargeBs: '0',
  needsCleaningOnReturn: false,
  imageDataUrl: null,
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
  categories = [],
  activeRentals = [],
  cancelledRentals = [],
  deliveries = [],
  stockRecoveries = [],
  inventoryMovements = [],
  formatBs,
  formatDateTime,
  onSwitchInventoryModule,
  onCreateInventoryItem,
  onUpdateInventoryItem,
  onRemoveInventoryItem,
  onCreateInventoryMovement,
  onCreateCategory,
  onUpdateCategory,
  onRemoveCategory,
  onReloadData,
  onOpenImage,
  onUpdateOrderOperational,
  onReceiveReturnedOrder,
  onPrintInventoryOrderDocument,
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [showFilters, setShowFilters] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackType, setFeedbackType] = useState('ok');
  const [rowMenuOpenId, setRowMenuOpenId] = useState(null);
  const [rowMenuPosition, setRowMenuPosition] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [movementTypeFilter, setMovementTypeFilter] = useState('all');
  const [movementUserFilter, setMovementUserFilter] = useState('all');
  const [adjustStatusFilter, setAdjustStatusFilter] = useState('all');
  const [categoryUsageFilter, setCategoryUsageFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [productModalMode, setProductModalMode] = useState(null);
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT_FORM);
  const [productError, setProductError] = useState('');
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [movementForm, setMovementForm] = useState(EMPTY_MOVEMENT_FORM);
  const [movementError, setMovementError] = useState('');
  const [movementItemQuery, setMovementItemQuery] = useState('');
  const [categoryModalMode, setCategoryModalMode] = useState(null);
  const [categoryForm, setCategoryForm] = useState(EMPTY_CATEGORY_FORM);
  const [categoryError, setCategoryError] = useState('');
  const [detailRow, setDetailRow] = useState(null);
  const [valuationOpen, setValuationOpen] = useState(false);
  const [documentPreview, setDocumentPreview] = useState(null);
  const [receivingModal, setReceivingModal] = useState(null);
  const [receivingError, setReceivingError] = useState('');
  const [isReceiving, setIsReceiving] = useState(false);

  const rowMenuRef = useRef(null);

  const openInventoryOrderDocument = async (row) => {
    try {
      const preview = await onPrintInventoryOrderDocument?.({ rentalId: row.rentalId, orderCode: row.orderCode });
      if (preview?.html) {
        setDocumentPreview({
          title: preview.title ?? `Orden inventario ${row.orderCode}`,
          html: preview.html,
        });
      }
    } catch (error) {
      setFeedback(error.message || 'No se pudo abrir la orden de inventario.');
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

  const isProductsModule = activeModule === 'inventario_productos';
  const isCategoriesModule = activeModule === 'inventario_categorias';
  const isMovementsModule = activeModule === 'inventario_movimientos';
  const isAdjustModule = activeModule === 'inventario_ajustes';
  const isOverviewModule = !isProductsModule && !isCategoriesModule && !isMovementsModule && !isAdjustModule;

  const moduleViewClass = isMovementsModule
    ? 'inventory-view-movements'
    : isAdjustModule
    ? 'inventory-view-adjust'
    : isCategoriesModule
    ? 'inventory-view-categories'
    : isProductsModule
    ? 'inventory-view-products'
    : '';

  const moduleTitle = isProductsModule
    ? 'Productos'
    : isCategoriesModule
    ? 'Categorias'
    : isMovementsModule
    ? 'Movimientos de Stock'
    : isAdjustModule
    ? 'Ajustes de Stock'
    : 'Inventario';

  const moduleSubtitle = isProductsModule
    ? 'Gestiona el catalogo de items alquilables'
    : isCategoriesModule
    ? 'Administra categorias de inventario con icono, color y estado'
    : isMovementsModule
    ? 'Ordenes por alistar y trazabilidad de reservas, entradas, salidas y ajustes'
    : isAdjustModule
    ? 'Correcciones de stock segun conteo fisico'
    : 'Controla tu stock en tiempo real';

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

  const reservedByItem = useMemo(() => {
    const map = {};
    activeRentals.forEach((rental) => {
      (rental.items ?? []).forEach((line) => {
        map[line.itemId] = (map[line.itemId] ?? 0) + Number(line.quantity ?? 0);
      });
    });
    return map;
  }, [activeRentals]);

  const maintenanceByItem = useMemo(() => {
    const map = {};
    stockRecoveries.forEach((entry) => {
      map[entry.itemId] = (map[entry.itemId] ?? 0) + Number(entry.quantity ?? 0);
    });
    return map;
  }, [stockRecoveries]);

  const prepOrderRows = useMemo(() => {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const deliveryByRental = new Map();

    deliveries
      .filter((delivery) => delivery.rentalId)
      .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))
      .forEach((delivery) => {
        if (!deliveryByRental.has(delivery.rentalId)) {
          deliveryByRental.set(delivery.rentalId, delivery);
        }
      });

    const getPriority = (delivery) => {
      if (!delivery) return { key: 'media', label: 'Media', weight: 2 };
      if (delivery.status === 'incidencia' || delivery.status === 'en_ruta') {
        return { key: 'alta', label: 'Alta', weight: 3 };
      }
      const deliveryTime = new Date(String(delivery.scheduledDate ?? '')).getTime();
      if (!Number.isFinite(deliveryTime)) return { key: 'media', label: 'Media', weight: 2 };
      const diffDays = Math.floor((deliveryTime - startOfToday) / (1000 * 60 * 60 * 24));
      if (diffDays <= 1) return { key: 'alta', label: 'Alta', weight: 3 };
      if (diffDays <= 3) return { key: 'media', label: 'Media', weight: 2 };
      return { key: 'baja', label: 'Baja', weight: 1 };
    };

    const getInventoryMeta = (status) => {
      if (status === 'confirmado') {
        return { sortWeight: 0, secondarySortWeight: 1, text: 'Alistada y asignada', actionLabel: 'Ya asignada', canConfirm: false };
      }
      if (status === 'enviado') {
        return { sortWeight: 1, secondarySortWeight: 0, text: 'Asignada, pendiente de confirmar', actionLabel: 'Confirmar alistado', canConfirm: true };
      }
      return { sortWeight: 2, secondarySortWeight: 0, text: 'Por alistar', actionLabel: 'Asignar y confirmar', canConfirm: true };
    };

    return activeRentals
      .map((rental) => {
        const delivery = deliveryByRental.get(rental.id) ?? null;
        const totalItems = (rental.items ?? []).reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
        const lines = (rental.items ?? []).length;
        const priority = getPriority(delivery);
        const inventoryStatus = rental.operational?.inventoryStatus ?? 'pendiente';
        const inventoryMeta = getInventoryMeta(inventoryStatus);
        return {
          id: rental.id,
          rentalId: rental.id,
          orderCode: rental.orderCode ?? rental.id,
          customerName: rental.customerName,
          itemsText: `${totalItems} unidades · ${lines} items`,
          deliveryDate: delivery?.scheduledDate ?? rental.dueDate ?? null,
          deliveryWindow: delivery ? `${delivery.windowStart || '--:--'} - ${delivery.windowEnd || '--:--'}` : 'Pendiente',
          priority,
          inventoryStatus,
          inventoryStatusText: inventoryMeta.text,
          inventoryActionLabel: inventoryMeta.actionLabel,
          canConfirmInventory: inventoryMeta.canConfirm,
          inventorySortWeight: inventoryMeta.sortWeight,
          inventorySecondarySortWeight: inventoryMeta.secondarySortWeight,
          inventoryNote: rental.operational?.inventoryNote ?? '',
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
        return new Date(a.deliveryDate ?? 0) - new Date(b.deliveryDate ?? 0);
      });
  }, [activeRentals, deliveries]);

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
      const stockControlled = item.controlsStock !== false
        && String(item.verificationStatus ?? '').trim() !== 'pending_verification'
        && String(item.adoptionSource ?? '').trim() !== 'service_order_quick_item'
        && Number(item.totalStock ?? 0) > 0;
      const lowThreshold = Math.max(3, Math.ceil(Number(item.totalStock ?? 0) * 0.15));
      const lowAvailability = stockControlled && Number(item.availableStock ?? 0) <= lowThreshold;
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        brand: String(item.brand ?? '').trim(),
        itemColor: String(item.itemColor ?? '').trim(),
        imageDataUrl: item.imageDataUrl,
        sku: String(item.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 7).toUpperCase() || 'GEN',
        available: Number(item.availableStock ?? 0),
        reserved,
        maintenance,
        total: Number(item.totalStock ?? 0),
        controlsStock: stockControlled,
        verificationStatus: item.verificationStatus ?? (stockControlled ? 'verified' : 'pending_verification'),
        adoptionSource: item.adoptionSource ?? '',
        lowAvailability,
        price: Number(item.rentalPriceBs ?? 0),
        damagedUnitChargeBs: Number(item.damagedUnitChargeBs ?? 0),
        missingUnitChargeBs: Number(item.missingUnitChargeBs ?? 0),
        needsCleaningOnReturn: Boolean(item.needsCleaningOnReturn),
      };
    });
  }, [items, maintenanceByItem, reservedByItem]);

  const movementRows = useMemo(() => {
    const itemById = new Map(inventoryRows.map((row) => [row.id, row]));
    const rentalsForTrace = [...activeRentals, ...cancelledRentals];
    const rentalByOrderCode = new Map(rentalsForTrace.map((rental) => [rental.orderCode ?? rental.id, rental]));
    const reservationMovementKeys = new Set(
      inventoryMovements
        .filter((movement) => movement.type === 'reserva')
        .map((movement) => `${movement.reference ?? ''}::${movement.itemId ?? ''}`),
    );

    const persistedRows = inventoryMovements.map((movement) => {
      const itemRow = itemById.get(movement.itemId);
      const linkedRental = rentalByOrderCode.get(movement.reference ?? '');
      const isEntry = movement.type === 'entrada' || movement.type === 'reinsercion';
      const isExit = movement.type === 'salida' || movement.type === 'reserva';
      const isReservation = movement.type === 'reserva';
      const inventoryStatus = linkedRental?.operational?.inventoryStatus ?? movement.status ?? 'pendiente';
      const rawMovementUserName = movement.userName;
      const movementUserName =
        rawMovementUserName && rawMovementUserName !== 'Sistema'
          ? rawMovementUserName
          : linkedRental?.createdByName ?? linkedRental?.createdBy ?? rawMovementUserName ?? 'Sistema';
      const responsibleName =
        isReservation && inventoryStatus !== 'confirmado'
          ? 'Por alistar'
          : isReservation
          ? linkedRental?.operational?.inventoryConfirmedByName ?? movementUserName
          : movementUserName;
      const responsibleRole =
        isReservation && inventoryStatus !== 'confirmado'
          ? inventoryStatus === 'enviado'
            ? 'Inventario recibido'
            : 'Inventario pendiente'
          : isReservation
          ? linkedRental?.operational?.inventoryConfirmedByRole ?? linkedRental?.createdByRole ?? movement.userRole ?? 'Inventario'
          : movement.userRole && movement.userRole !== 'Operacion'
          ? movement.userRole
          : linkedRental?.createdByRole ?? movement.userRole ?? 'Operacion';
      return {
        id: movement.id,
        createdAt: movement.createdAt,
        typeKey: isEntry ? 'entrada' : isExit ? 'salida' : 'ajuste',
        typeLabel: movement.type === 'reserva' ? 'Reserva' : isEntry ? 'Entrada' : movement.type === 'salida' ? 'Salida' : 'Ajuste',
        itemName: movement.itemName ?? 'Item',
        itemId: movement.itemId ?? '',
        imageDataUrl: movement.imageDataUrl ?? itemRow?.imageDataUrl ?? null,
        sku: String(movement.itemId ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 7).toUpperCase() || 'COD',
        reference: movement.reference ?? movement.id,
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
        isPendingReservation: isReservation && !['confirmado', 'anulado'].includes(inventoryStatus),
      };
    });

    const serviceOrderRows = rentalsForTrace.flatMap((rental) => {
      const reference = rental.orderCode ?? rental.id;
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
            createdAt: rental.createdAt ?? rental.rentalAt ?? new Date().toISOString(),
            typeKey: 'salida',
            typeLabel: 'Reserva',
            itemName: line.itemName ?? itemRow?.name ?? 'Item',
            itemId: line.itemId ?? '',
            imageDataUrl: itemRow?.imageDataUrl ?? null,
            sku: String(line.itemId ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 7).toUpperCase() || 'COD',
            reference,
            deltaUnits: -quantity,
            beforeStock: afterStock + quantity,
            afterStock,
            userName: rental.operational?.inventoryStatus === 'confirmado'
              ? rental.operational?.inventoryConfirmedByName ?? rental.createdByName ?? rental.createdBy ?? 'Sistema'
              : 'Por alistar',
            userRole: rental.operational?.inventoryStatus === 'confirmado'
              ? rental.operational?.inventoryConfirmedByRole ?? rental.createdByRole ?? 'Inventario'
              : rental.operational?.inventoryStatus === 'enviado'
              ? 'Inventario recibido'
              : 'Inventario pendiente',
            registeredByName: rental.createdByName ?? rental.createdBy ?? 'Sistema',
            registeredByRole: rental.createdByRole ?? 'Inventario',
            observation: `Reservado para ${reference} - ${rental.customerName ?? 'Cliente'}`,
            valueAmount: Number(line.lineTotalBs ?? 0),
            status: rental.operational?.inventoryStatus ?? 'pendiente',
            isPendingReservation: !['confirmado', 'anulado'].includes(rental.operational?.inventoryStatus ?? 'pendiente'),
          };
        })
        .filter(Boolean);
    });

    return [...persistedRows, ...serviceOrderRows]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [activeRentals, cancelledRentals, inventoryMovements, inventoryRows]);

  const movementSelectableRows = useMemo(() => {
    const text = normalizeText(movementItemQuery);
    if (!text) return inventoryRows;
    return inventoryRows.filter((row) =>
      normalizeText(row.name).includes(text)
      || normalizeText(row.category).includes(text)
      || normalizeText(row.sku).includes(text),
    );
  }, [inventoryRows, movementItemQuery]);

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
      const entries = movementRows.filter((row) => row.typeKey === 'entrada');
      const exits = movementRows.filter((row) => row.typeKey === 'salida');
      const adjusts = movementRows.filter((row) => row.typeKey === 'ajuste');
      return [
        { tone: 'lilac', icon: 'box', value: movementRows.length, label: 'Total movimientos', link: 'Ver historial completo' },
        { tone: 'mint', icon: 'check', value: entries.length, label: 'Entradas', link: 'Filtrar entradas' },
        { tone: 'peach', icon: 'tag', value: exits.length, label: 'Reservas / salidas', link: 'Filtrar salidas' },
        { tone: 'sky', icon: 'bag', value: adjusts.length, label: 'Ajustes', link: 'Filtrar ajustes' },
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

    return [
      { tone: 'lilac', icon: 'box', value: totals.totalUnits, label: 'Total de items', link: 'Ver detalles' },
      { tone: 'mint', icon: 'check', value: `${totals.availability.toFixed(1)}%`, label: 'Disponibilidad promedio', link: 'Ver reporte' },
      { tone: 'sky', icon: 'bag', value: totals.lowStockCount, label: 'Stock bajo minimo', link: 'Revisar alertas' },
      { tone: 'peach', icon: 'tag', value: formatBs(totals.value), label: 'Valor total del inventario', link: 'Ver valuacion' },
    ];
  }, [adjustRows, categoriesList, formatBs, isAdjustModule, isCategoriesModule, isMovementsModule, movementRows, totals]);

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
    const text = String(query ?? '').trim().toLowerCase();
    let base = isMovementsModule
      ? movementRows
      : isAdjustModule
      ? adjustRows
      : isCategoriesModule
      ? categoriesList
      : inventoryRows;

    if (!isMovementsModule && !isAdjustModule && !isCategoriesModule) {
      if (categoryFilter !== 'all') {
        base = base.filter((row) => normalizeText(row.category) === normalizeText(categoryFilter));
      }
      if (stockFilter === 'low') {
        base = base.filter((row) => row.lowAvailability);
      } else if (stockFilter === 'ok') {
        base = base.filter((row) => !row.lowAvailability);
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
    return base.filter((row) =>
      String(row.name ?? row.itemName ?? '').toLowerCase().includes(text)
      || String(row.category ?? '').toLowerCase().includes(text)
      || String(row.brand ?? '').toLowerCase().includes(text)
      || String(row.itemColor ?? '').toLowerCase().includes(text)
      || String(row.sku ?? '').toLowerCase().includes(text)
      || String(row.reference ?? '').toLowerCase().includes(text)
      || String(row.userName ?? '').toLowerCase().includes(text)
      || String(row.registeredByName ?? '').toLowerCase().includes(text)
      || String(row.reason ?? '').toLowerCase().includes(text),
    );
  }, [
    adjustRows,
    categoriesList,
    inventoryRows,
    movementRows,
    isCategoriesModule,
    isAdjustModule,
    isMovementsModule,
    query,
    categoryFilter,
    stockFilter,
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
    setMovementTypeFilter('all');
    setMovementUserFilter('all');
    setAdjustStatusFilter('all');
    setCategoryUsageFilter('all');
    setDateFrom('');
    setDateTo('');
  };

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

  const handleExport = () => {
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

    const lines = [
      [
        'producto',
        'categoria',
        'marca',
        'color_o_descripcion',
        'codigo',
        'disponible',
        'reservado',
        'mantenimiento',
        'total',
        'precio_alquiler_bs',
        'estado',
      ].join(','),
      ...filteredRows.map((row) =>
        [
          csvEscape(row.name),
          csvEscape(row.category),
          csvEscape(row.brand),
          csvEscape(row.itemColor),
          csvEscape(row.sku),
          csvEscape(row.available),
          csvEscape(row.reserved),
          csvEscape(row.maintenance),
          csvEscape(row.total),
          csvEscape(Number(row.price ?? 0).toFixed(2)),
          csvEscape(row.lowAvailability ? 'Stock Bajo' : 'Disponible'),
        ].join(','),
      ),
    ];
    downloadCsv(`inventario-productos-${new Date().toISOString().slice(0, 10)}.csv`, lines);
    showMessage('Exportacion de productos completada.');
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

    if (!isMovementsModule && !isAdjustModule) {
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
  };

  const handleOpenImagePreview = (imageDataUrl, itemName) => {
    if (!imageDataUrl) return;
    onOpenImage?.({
      url: imageDataUrl,
      name: `Imagen de ${itemName || 'producto'}`,
    });
  };

  const handleViewAllCategories = () => {
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
      category: row.category,
      brand: row.brand ?? '',
      itemColor: row.itemColor ?? '',
      totalStock: String(row.total),
      rentalPriceBs: String(row.price),
      damagedUnitChargeBs: String(row.damagedUnitChargeBs),
      missingUnitChargeBs: String(row.missingUnitChargeBs),
      needsCleaningOnReturn: Boolean(row.needsCleaningOnReturn),
      imageDataUrl: row.imageDataUrl ?? null,
      imageFileName: '',
    });
  };

  const handleProductImageChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!String(dataUrl).startsWith('data:image/')) {
        throw new Error('Selecciona una imagen valida (JPG, PNG o WEBP).');
      }
      setProductForm((current) => ({
        ...current,
        imageDataUrl: dataUrl,
        imageFileName: file.name,
      }));
    } catch (error) {
      setProductError(error?.message || 'No se pudo cargar la imagen.');
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
    setProductError('');

    const payload = {
      id: productForm.id,
      name: String(productForm.name ?? '').trim(),
      category: String(productForm.category ?? '').trim(),
      brand: String(productForm.brand ?? '').trim(),
      itemColor: String(productForm.itemColor ?? '').trim(),
      totalStock: Math.trunc(Number(productForm.totalStock ?? 0)),
      rentalPriceBs: Number(productForm.rentalPriceBs ?? 0),
      damagedUnitChargeBs: Number(productForm.damagedUnitChargeBs ?? 0),
      missingUnitChargeBs: Number(productForm.missingUnitChargeBs ?? 0),
      needsCleaningOnReturn: Boolean(productForm.needsCleaningOnReturn),
      imageDataUrl: productForm.imageDataUrl || null,
    };

    if (!payload.name) {
      setProductError('El nombre del producto es obligatorio.');
      return;
    }
    if (!payload.category) {
      setProductError('Selecciona una categoria para el producto.');
      return;
    }
    if (!Number.isFinite(payload.totalStock) || payload.totalStock <= 0) {
      setProductError('El stock total debe ser mayor a 0.');
      return;
    }
    if (!Number.isFinite(payload.rentalPriceBs) || payload.rentalPriceBs < 0) {
      setProductError('El precio de alquiler no es valido.');
      return;
    }

    try {
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
      showMessage('Movimiento registrado correctamente.');
      closeMovementModal();
    } catch (error) {
      setMovementError(error?.message || 'No se pudo registrar el movimiento.');
    }
  };

  const openReceivingModal = (row) => {
    const pickupItems = row.rental.pickupChecklist?.items ?? [];
    setReceivingError('');
    setReceivingModal({
      rental: row.rental,
      notes: '',
      items: (row.rental.items ?? []).map((line) => {
        const picked = pickupItems.find((entry) => entry.itemId === line.itemId);
        return {
          itemId: line.itemId,
          itemName: line.itemName,
          expectedQty: Number(line.quantity ?? 0),
          returnedQty: picked?.condition === 'faltante' ? 0 : Number(picked?.pickedQty ?? line.quantity ?? 0),
          damagedQty: picked?.condition === 'danado' ? Number(picked?.pickedQty ?? 0) : 0,
          missingQty: picked?.condition === 'faltante'
            ? Number(line.quantity ?? 0)
            : Math.max(0, Number(line.quantity ?? 0) - Number(picked?.pickedQty ?? line.quantity ?? 0)),
          damageNote: picked?.note ?? '',
        };
      }),
    });
  };

  const updateReceivingLine = (itemId, field, value) => {
    setReceivingModal((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((line) => (
          line.itemId === itemId ? { ...line, [field]: value } : line
        )),
      };
    });
  };

  const submitReceiving = async (event) => {
    event.preventDefault();
    if (!receivingModal || isReceiving) return;
    setReceivingError('');
    setIsReceiving(true);
    try {
      await onReceiveReturnedOrder?.({
        rentalId: receivingModal.rental.id,
        returnedItems: receivingModal.items,
      });
      setReceivingModal(null);
      showMessage('Recepcion de inventario registrada correctamente.');
    } catch (error) {
      setReceivingError(error?.message || 'No se pudo registrar la recepcion.');
    } finally {
      setIsReceiving(false);
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

  const renderProductRowMenu = (row, openUp = false) => (
    <div className={`inventory-row-dropdown floating ${openUp ? 'open-up' : ''}`} style={getRowMenuStyle()}>
      <button type="button" onClick={() => { setDetailRow(row); setRowMenuOpenId(null); }}>
        Ver detalle
      </button>
      <button type="button" onClick={() => { openEditProductModal(row); setRowMenuOpenId(null); }}>
        Editar producto
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
              <button type="button" className="ghost-button" onClick={handleHeaderImportClick}>
                Importar Inventario
              </button>
              <button type="button" className="primary-button" onClick={handleHeaderNewClick}>
                + Nuevo Producto
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

      <input ref={importInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleImportFile} />

      {feedback ? (
        <p className={`status ${feedbackType === 'error' ? 'error' : ''}`}>{feedback}</p>
      ) : null}

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
                <h3>Ordenes operativas para asignar y alistar</h3>
              </header>
              <div className="inventory-ops-list">
                {prepOrderRows.slice(0, 6).map((row) => (
                  <div key={row.id} className="inventory-ops-row">
                    <div>
                      <strong>{row.orderCode}</strong>
                      <span>{row.customerName}</span>
                    </div>
                    <div>
                      <strong>{row.itemsText}</strong>
                      <span>{row.inventoryStatusText}</span>
                    </div>
                    <div>
                      <strong>{row.deliveryDate ? formatDateTime(row.deliveryDate).split(',')[0] : 'Sin fecha'}</strong>
                      <span>{row.deliveryWindow}</span>
                    </div>
                    <div className="inventory-ops-state">
                      <span className={`inventory-ops-priority ${row.priority.key}`}>{row.priority.label}</span>
                      <span>{row.inventoryStatus === 'confirmado' ? 'Listo' : row.inventoryStatus === 'enviado' ? 'Recibida' : 'Pendiente'}</span>
                    </div>
                    <div className="inventory-ops-actions">
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => openInventoryOrderDocument(row)}
                      >
                        Ver documento
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        disabled={!row.canConfirmInventory}
                        onClick={() => onUpdateOrderOperational?.({ id: row.rentalId, inventoryStatus: 'confirmado' })}
                      >
                        {row.inventoryActionLabel}
                      </button>
                    </div>
                  </div>
                ))}
                {prepOrderRows.length === 0 ? (
                  <p className="status">No hay ordenes activas para alistamiento en este momento.</p>
                ) : null}
              </div>
            </article>
          ) : null}

          {isMovementsModule ? (
            <article className="inventory-ops-card">
              <header className="inventory-ops-head">
                <h3>Ordenes anuladas (historial visible)</h3>
              </header>
              <div className="inventory-ops-list">
                {cancelledOrderRows.slice(0, 6).map((row) => (
                  <div key={row.id} className="inventory-ops-row">
                    <div>
                      <strong>{row.orderCode}</strong>
                      <span>{row.customerName}</span>
                    </div>
                    <div>
                      <strong>{row.itemsText}</strong>
                      <span>Estado: anulado</span>
                    </div>
                    <div>
                      <strong>{row.cancelledAt ? formatDateTime(row.cancelledAt).split(',')[0] : 'Sin fecha'}</strong>
                      <span>Anulada en esta fecha</span>
                    </div>
                    <div className="inventory-ops-state">
                      <span className="inventory-ops-priority alta">Anulado</span>
                      <span>Penalidad {formatBs(row.penaltyBs)}</span>
                    </div>
                    <div className="inventory-ops-actions">
                      <button type="button" className="link-button" disabled>
                        Sin accion operativa
                      </button>
                    </div>
                  </div>
                ))}
                {cancelledOrderRows.length === 0 ? (
                  <p className="status">No hay ordenes anuladas en el periodo visible.</p>
                ) : null}
              </div>
            </article>
          ) : null}

          {isMovementsModule ? (
            <article className="inventory-ops-card">
              <header className="inventory-ops-head">
                <h3>Recepciones pendientes desde transporte</h3>
              </header>
              <div className="inventory-ops-list">
                {receptionRows.slice(0, 8).map((row) => (
                  <div key={row.id} className="inventory-ops-row">
                    <div>
                      <strong>{row.orderCode}</strong>
                      <span>{row.customerName}</span>
                    </div>
                    <div>
                      <strong>{row.itemsText}</strong>
                      <span>Recojo controlado por {row.checkedBy}</span>
                    </div>
                    <div>
                      <strong>{formatDateTime(row.checkedAt).split(',')[0]}</strong>
                      <span>Pendiente de recibir</span>
                    </div>
                    <div className="inventory-ops-state">
                      <span className="inventory-ops-priority media">Recepcion</span>
                      <span>Inventario</span>
                    </div>
                    <div className="inventory-ops-actions">
                      <button type="button" className="link-button" onClick={() => openReceivingModal(row)}>
                        Recibir y constatar
                      </button>
                    </div>
                  </div>
                ))}
                {receptionRows.length === 0 ? (
                  <p className="status">No hay recojos pendientes de recepcion en galpon.</p>
                ) : null}
              </div>
            </article>
          ) : null}

          <article className="inventory-table-card">
            <header className={`inventory-toolbar ${isMovementsModule ? 'inventory-toolbar-movements' : ''} ${isAdjustModule ? 'inventory-toolbar-adjust' : ''}`}>
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
                <button type="button" className="link-button inventory-export-btn" onClick={handleExport}>
                  {isCategoriesModule ? 'Exportar categorias' : 'Exportar'}
                </button>
              )}
            </header>

            {showFilters ? (
              <div className="inventory-filter-line">
                {!isMovementsModule && !isAdjustModule && !isCategoriesModule ? (
                  <>
                    <select className="ghost-button inventory-filter-btn" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                      <option value="all">Todas las categorias</option>
                      {categoriesList.map((entry) => (
                        <option key={entry.name} value={entry.name}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                    <select className="ghost-button inventory-filter-btn" value={stockFilter} onChange={(event) => setStockFilter(event.target.value)}>
                      <option value="all">Todo el stock</option>
                      <option value="low">Solo stock bajo</option>
                      <option value="ok">Solo disponible</option>
                    </select>
                    <button type="button" className="inventory-clear-chip" onClick={() => { setCategoryFilter('all'); setStockFilter('all'); }}>
                      Limpiar seleccion
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
                        <td>
                          <div className="inventory-product-cell movement-product-cell">
                            {row.imageDataUrl ? (
                              <button
                                type="button"
                                className="inventory-product-thumb inventory-product-thumb-button"
                                onClick={() => handleOpenImagePreview(row.imageDataUrl, row.itemName)}
                                aria-label={`Ver imagen de ${row.itemName}`}
                              >
                                <img src={row.imageDataUrl} alt={`Imagen de ${row.itemName}`} />
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
                        <td>{row.reference}</td>
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
                        <td>{row.observation}</td>
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
                            {row.imageDataUrl ? (
                              <button
                                type="button"
                                className="inventory-product-thumb inventory-product-thumb-button"
                                onClick={() => handleOpenImagePreview(row.imageDataUrl, row.itemName)}
                                aria-label={`Ver imagen de ${row.itemName}`}
                              >
                                <img src={row.imageDataUrl} alt={`Imagen de ${row.itemName}`} />
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
                            {row.imageDataUrl ? (
                              <button
                                type="button"
                                className="inventory-product-thumb inventory-product-thumb-button"
                                onClick={() => handleOpenImagePreview(row.imageDataUrl, row.name)}
                                aria-label={`Ver imagen de ${row.name}`}
                              >
                                <img src={row.imageDataUrl} alt={`Imagen de ${row.name}`} />
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
                Mostrando {pagedRows.length} de {filteredRows.length} {isMovementsModule ? 'movimientos' : isAdjustModule ? 'ajustes' : isCategoriesModule ? 'categorias' : 'productos'}
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
                {categoriesList.map((category) => (
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
                Stock total
                <input type="number" min="1" step="1" value={productForm.totalStock} onChange={(event) => setProductForm((current) => ({ ...current, totalStock: event.target.value }))} required />
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
                  {productForm.imageDataUrl ? (
                    <img src={productForm.imageDataUrl} alt="Vista previa del producto" />
                  ) : (
                    <span>Sin imagen</span>
                  )}
                </div>
                <div className="inventory-image-actions">
                  <button type="button" className="ghost-button" onClick={() => productImageInputRef.current?.click()}>
                    {productForm.imageDataUrl ? 'Cambiar imagen' : 'Subir imagen'}
                  </button>
                  {productForm.imageDataUrl ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setProductForm((current) => ({ ...current, imageDataUrl: null, imageFileName: '' }))}
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
              <button type="button" className="ghost-button" onClick={() => setProductModalMode(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary-button">
                {productModalMode === 'edit' ? 'Guardar cambios' : 'Crear producto'}
              </button>
            </div>
          </form>
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
                        {row.imageDataUrl ? (
                          <div className="inventory-product-thumb">
                            <img src={row.imageDataUrl} alt={`Imagen de ${row.name}`} />
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
                {detailRow.imageDataUrl ? (
                  <button
                    type="button"
                    className="inventory-detail-image-button"
                    onClick={() => handleOpenImagePreview(detailRow.imageDataUrl, detailRow.name || detailRow.itemName)}
                    title="Ver imagen en grande"
                  >
                    <img src={detailRow.imageDataUrl} alt={`Imagen de ${detailRow.name || detailRow.itemName || 'producto'}`} />
                  </button>
                ) : (
                  <CategoryIcon category={detailRow.category || detailRow.name || detailRow.itemName} />
                )}
              </div>
              <div className="inventory-detail-title">
                <span className="inventory-detail-kicker">{detailRow.reference ? 'Movimiento de inventario' : 'Producto de inventario'}</span>
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
            <div className="reset-modal-actions">
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

      {receivingModal ? (
        <div className="orders-modal-backdrop" onClick={() => setReceivingModal(null)}>
          <form className="orders-modal orders-preview-modal" onSubmit={submitReceiving} onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>Recepcion de {receivingModal.rental.orderCode}</h3>
                <p>Inventario constata cantidades y estado final antes de cerrar cargos.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setReceivingModal(null)}>
                x
              </button>
            </header>
            <div className="orders-preview-body inventory-receiving-body">
              <div className="transport-checklist-table">
                <div className="transport-checklist-head inventory-receiving-head">
                  <span>Item</span>
                  <span>Esperado</span>
                  <span>Bueno</span>
                  <span>Danado</span>
                  <span>Faltante</span>
                  <span>Observacion</span>
                </div>
                {receivingModal.items.map((line) => (
                  <div key={line.itemId} className="transport-checklist-row inventory-receiving-row">
                    <strong>{line.itemName}</strong>
                    <span>{line.expectedQty}</span>
                    <input type="number" min="0" max={line.expectedQty} value={line.returnedQty} onChange={(event) => updateReceivingLine(line.itemId, 'returnedQty', event.target.value)} />
                    <input type="number" min="0" max={line.expectedQty} value={line.damagedQty} onChange={(event) => updateReceivingLine(line.itemId, 'damagedQty', event.target.value)} />
                    <input type="number" min="0" max={line.expectedQty} value={line.missingQty} onChange={(event) => updateReceivingLine(line.itemId, 'missingQty', event.target.value)} />
                    <input type="text" value={line.damageNote} onChange={(event) => updateReceivingLine(line.itemId, 'damageNote', event.target.value)} placeholder="Detalle si hay dano/faltante" />
                  </div>
                ))}
              </div>
              {receivingError ? <p className="status error">{receivingError}</p> : null}
            </div>
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setReceivingModal(null)} disabled={isReceiving}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isReceiving}>
                {isReceiving ? 'Registrando...' : 'Cerrar recepcion'}
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
                <p>Vista previa de la orden operativa de inventario.</p>
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
