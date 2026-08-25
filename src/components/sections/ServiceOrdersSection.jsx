import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Box,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ClipboardCheck,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Gift,
  Filter,
  Info,
  MapPin,
  MessageCircle,
  MessageSquarePlus,
  PackageOpen,
  Phone,
  Pencil,
  Search,
  SquarePen,
  RefreshCw,
  Truck,
  UserRound,
  UsersRound,
  Trash2,
  X,
} from 'lucide-react';
import { buildAvailabilityPeriod, getProjectedInventoryAvailability } from '../../utils/availability';
import { resolveInventoryArea } from '../../utils/inventoryArea';
import { getUserDisplayRole, isDeveloper } from '../../utils/permissions';
import { getProductImageSrc } from '../../utils/productImage';
import { calculateReceivableBreakdown, getConfirmedContractLedgerPaidBs } from '../../utils/receivables';
import { cashMovementMatchesContractReferences } from '../../utils/contractCashLinks';
import { applyOrderTableControls } from '../../utils/orderTableControls';
import { calculateGuaranteeSettlement } from '../../utils/guaranteeSettlement';
import { api } from '../../services/api';
import ProductImage from '../common/ProductImage';

const ORDER_STATUS_META = {
  pending: { label: 'Pendiente', className: 'pending' },
  prep: { label: 'En Preparacion', className: 'prep' },
  transport: { label: 'En Transporte', className: 'transport' },
  completed: { label: 'Finalizada', className: 'completed' },
  closed_pending: { label: 'Finalizada / por cobrar', className: 'pending' },
  charged: { label: 'Cobrado y finalizado', className: 'completed' },
  cancelled: { label: 'Anulada', className: 'rejected' },
};

const QUOTE_STATUS_META = {
  borrador: { label: 'Borrador', className: 'draft' },
  enviada: { label: 'Enviada', className: 'sent' },
  aprobada: { label: 'Aprobada', className: 'approved' },
  rechazada: { label: 'Rechazada', className: 'rejected' },
  vencida: { label: 'Vencida', className: 'expired' },
};

const CONTRACT_STATUS_META = {
  borrador: { label: 'Borrador', className: 'draft' },
  pendiente: { label: 'Pendiente', className: 'pending' },
  aprobado: { label: 'Aprobado', className: 'approved' },
  rechazado: { label: 'Rechazado', className: 'rejected' },
  anulado: { label: 'Anulado', className: 'rejected' },
  oculto: { label: 'Oculto', className: 'draft' },
};

const BILLING_MODE_META = {
  sin_factura: 'Sin factura',
  con_factura: 'Con factura',
};

const LOGISTICS_MODE_META = {
  envio: 'Envio por equipo',
  recojo: 'Recojo por cliente',
};

const DELIVERY_CHARGE_MODE_META = {
  included: 'Envio incluido',
  extra: 'Cobrar envio extra',
};

const DELIVERY_FEE_REASON_META = {
  covered: 'Cubre lo alquilado',
  quantity: 'No cubre la cantidad alquilada',
  distance: 'Zona alejada',
  other: 'Otro motivo',
};

const DOCUMENT_SOURCE_LABELS = {
  contrato: 'Contrato',
  orden_inventario: 'Inventario',
  hoja_ruta: 'Ruta',
};

const DURATION_PRICING_DEFAULT_TIERS = [
  { id: 'tier-1', fromDay: '1', toDay: '1', percent: '100' },
  { id: 'tier-2', fromDay: '2', toDay: '3', percent: '85' },
  { id: 'tier-3', fromDay: '4', toDay: '', percent: '50' },
];

const formatCommercialDocumentCode = (prefix, value, size = 5) => {
  const nextValue = Math.max(1, Math.trunc(Number(value ?? 1)));
  const normalizedPrefix = String(prefix ?? '');
  return normalizedPrefix ? `${normalizedPrefix}${String(nextValue).padStart(size, '0')}` : String(nextValue);
};

const parseCommercialCodeNumericPart = (code) => {
  const match = String(code ?? '').trim().match(/(\d+)\s*$/);
  return match ? Math.max(1, Math.trunc(Number(match[1]))) : null;
};

const parseCommercialCodePrefix = (code) => String(code ?? '').trim().replace(/\d+\s*$/, '');

const ORDERS_SEEN_STORAGE_KEY = 'copetin-orders-seen-counts-v1';
const CATALOG_PAGE_SIZE = 8;
const CONTRACT_RENDER_BATCH_SIZE = 80;
const DEFAULT_ORDER_TABLE_FILTERS = Object.freeze({
  damage: 'all',
  notes: 'all',
  guarantee: 'all',
  payment: 'all',
  finalized: 'all',
});

const ORDER_COLUMN_MENU_OPTIONS = {
  contract: {
    label: 'Ordenar contrato',
    type: 'sort',
    options: [
      { value: 'desc', label: 'Mayor a menor' },
      { value: 'asc', label: 'Menor a mayor' },
    ],
  },
  date: {
    label: 'Ordenar fecha del evento',
    type: 'sort',
    options: [
      { value: 'desc', label: 'Más reciente primero' },
      { value: 'asc', label: 'Más antigua primero' },
    ],
  },
  client: {
    label: 'Ordenar cliente',
    type: 'sort',
    options: [
      { value: 'asc', label: 'A a Z' },
      { value: 'desc', label: 'Z a A' },
    ],
  },
  damage: {
    label: 'Daños y faltantes',
    type: 'filter',
    options: [
      { value: 'all', label: 'Todos' },
      { value: 'yes', label: 'Con daños o faltantes' },
      { value: 'no', label: 'Sin daños ni faltantes' },
    ],
  },
  notes: {
    label: 'Notas',
    type: 'filter',
    options: [
      { value: 'all', label: 'Todas' },
      { value: 'yes', label: 'Con notas' },
      { value: 'no', label: 'Sin notas' },
    ],
  },
  guarantee: {
    label: 'Garantía',
    type: 'filter',
    options: [
      { value: 'all', label: 'Todas' },
      { value: 'yes', label: 'Con garantía' },
      { value: 'no', label: 'Sin garantía' },
    ],
  },
  payment: {
    label: 'Estado de pago',
    type: 'filter',
    options: [
      { value: 'all', label: 'Todos' },
      { value: 'yes', label: 'Pagados' },
      { value: 'no', label: 'Por cobrar' },
    ],
  },
  finalized: {
    label: 'Finalización',
    type: 'filter',
    options: [
      { value: 'all', label: 'Todos' },
      { value: 'yes', label: 'Finalizados' },
      { value: 'no', label: 'No finalizados' },
    ],
  },
};
const QR_ACCOUNT_OPTIONS = ['CIDRE', 'BCP', 'MERCANTIL', 'BNB', 'BANCO FIE'];
const DOCUMENT_API_BASE_URL = String(import.meta.env?.VITE_API_URL ?? '').replace(/\/+$/, '');
const DOCUMENT_INTERNAL_KEY = String(
  import.meta.env?.VITE_APP_INTERNAL_KEY
    ?? import.meta.env?.APP_INTERNAL_KEY
    ?? '',
).trim();
const isMobileContractPdfViewer = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (navigator.userAgentData?.mobile === true) return true;
  return /Android|iPhone|iPod|Mobile/i.test(String(navigator.userAgent ?? ''));
};

const getDocumentApiUrl = (path) => DOCUMENT_API_BASE_URL ? `${DOCUMENT_API_BASE_URL}${path}` : path;

const clampPercentValue = (value) => Math.min(100, Math.max(0, Number(value ?? 0)));

const getSupplierCoverageEffectiveSaleUnitPriceBs = (line) => {
  const saleUnitPriceBs = Math.max(0, Number(line?.saleUnitPriceBs ?? line?.unitPriceBs ?? 0));
  const discountPercent = clampPercentValue(line?.discountPercent);
  return Number((saleUnitPriceBs * (1 - (discountPercent / 100))).toFixed(2));
};

const normalizeLedgerPaymentMethod = (value) => {
  const method = String(value ?? '').trim().toLowerCase();
  return ['efectivo', 'qr', 'transferencia'].includes(method) ? method : 'efectivo';
};

const normalizeLedgerPaymentAccount = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const match = QR_ACCOUNT_OPTIONS.find((account) => normalizeText(account) === normalizeText(raw));
  return match ?? raw.toUpperCase();
};

const formatPaymentMethodLabel = (method, account = '') => {
  if (method === 'qr') return account ? `QR - ${account}` : 'QR';
  if (method === 'transferencia') return 'Transferencia';
  return 'Efectivo';
};

const OPERATIONAL_STATUS_META = {
  pendiente: { label: 'Pendiente', className: 'pending' },
  enviado: { label: 'Enviado', className: 'transport' },
  confirmado: { label: 'Confirmado', className: 'completed' },
  no_aplica: { label: 'No aplica', className: 'draft' },
  anulado: { label: 'Anulado', className: 'rejected' },
};

const QUOTE_WIZARD_STEPS = [
  { id: 'client', title: 'Cliente', subtitle: 'Datos del cliente' },
  { id: 'event', title: 'Evento', subtitle: 'Informacion del evento' },
  { id: 'items', title: 'Items', subtitle: 'Productos y cantidades' },
  { id: 'logistics', title: 'Logistica', subtitle: 'Entrega y recojo' },
  { id: 'summary', title: 'Resumen', subtitle: 'Revision y totales' },
];

const timeToMinutes = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const isValidSameDayWindow = (start, end) => {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  return startMinutes !== null && endMinutes !== null && endMinutes > startMinutes;
};

const formatLongSpanishDate = (value) => {
  const key = getDateKey(value);
  if (!key) return 'SIN FECHA';
  const parsed = new Date(`${key}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'SIN FECHA';
  return parsed
    .toLocaleDateString('es-BO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    .toUpperCase();
};

const getContractTransportLabel = (row) => {
  if (row?.logisticsMode === 'recojo') {
    return {
      title: 'Cliente retira',
      detail: 'Cliente devuelve',
    };
  }
  return {
    title: 'Envío por equipo',
    detail: 'Recojo por equipo',
  };
};

function OrdersKpiIcon({ kind }) {
  if (kind === 'truck') {
    return <img className="asset-icon truck-asset-icon" src="/imagenes/camion.png" alt="" aria-hidden="true" />;
  }

  if (kind === 'quote') {
    return <img className="asset-icon quote-asset-icon" src="/imagenes/solicitud-de-cotizacion.png" alt="" aria-hidden="true" />;
  }

  if (kind === 'contract') {
    return <img className="asset-icon contract-asset-icon" src="/imagenes/contrato.png" alt="" aria-hidden="true" />;
  }

  const icons = {
    orders: (
      <>
        <rect x="7" y="5" width="10" height="16" rx="2" />
        <path d="M9 9h6M9 13h6M9 17h4" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12.2 2.2 2.2 4.8-5" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {icons[kind] ?? icons.orders}
      </g>
    </svg>
  );
}

function OrdersColumnFilterButton({ column, label, active, onOpen }) {
  return (
    <button
      type="button"
      className={`orders-column-filter-trigger${active ? ' is-active' : ''}`}
      onClick={(event) => onOpen(column, event)}
      title={`Filtrar u ordenar ${label.toLowerCase()}`}
      aria-label={`Filtrar u ordenar ${label}`}
      aria-haspopup="menu"
    >
      <Filter aria-hidden="true" />
    </button>
  );
}

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const normalizeSearchText = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getSearchTokens = (value) => normalizeSearchText(value).split(' ').filter(Boolean);

const toMoneyNumber = (value) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};


const consolidateReturnIssueLines = (rows, scopeKey = '') => {
  const source = Array.isArray(rows) ? rows : [];
  const groups = new Map();

  source.forEach((line, index) => {
    const lineKey = String(line?.lineKey ?? '').trim();
    const itemId = String(line?.itemId ?? '').trim();
    const itemName = String(line?.itemName ?? line?.name ?? 'Item').trim() || 'Item';
    const rowScope = String(
      scopeKey
      || line?.rentalId
      || line?.contractId
      || line?.orderCode
      || line?.contractCode
      || '',
    ).trim();
    const identity = lineKey || (itemId ? `item:${itemId}` : `name:${normalizeText(itemName)}`);
    const groupKey = `${rowScope}|${identity}`;
    const previousProcessedQty = Math.max(0, toMoneyNumber(line?.previousProcessedQty));
    const createdAtMs = new Date(
      line?.partialRegisteredAt
      ?? line?.registeredAt
      ?? line?.updatedAt
      ?? line?.createdAt
      ?? 0,
    ).getTime();

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        lineKey,
        itemId,
        itemName,
        stages: new Map(),
      });
    }

    const group = groups.get(groupKey);
    const stageKey = String(previousProcessedQty);
    const existing = group.stages.get(stageKey);
    const candidate = {
      line,
      index,
      previousProcessedQty,
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
    };

    // Una segunda recepción puede volver a traer el snapshot completo de una
    // línea ya procesada. Para el mismo punto de avance conservamos únicamente
    // la versión más reciente y evitamos contarla dos veces.
    if (
      !existing
      || candidate.createdAtMs > existing.createdAtMs
      || (candidate.createdAtMs === existing.createdAtMs && candidate.index > existing.index)
    ) {
      group.stages.set(stageKey, candidate);
    }
  });

  return Array.from(groups.values()).map((group) => {
    const stages = Array.from(group.stages.values())
      .sort((left, right) => (
        left.previousProcessedQty - right.previousProcessedQty
        || left.createdAtMs - right.createdAtMs
        || left.index - right.index
      ));
    const lastStage = stages[stages.length - 1];
    const lastLine = lastStage?.line ?? {};
    const damagedQty = stages.reduce((sum, stage) => sum + Math.max(0, toMoneyNumber(stage.line?.damagedQty)), 0);
    // Los faltantes de una recepción intermedia son provisionales si luego
    // existe una recepción que avanza previousProcessedQty. Solo el último
    // estado vigente conserva faltantes.
    const missingQty = Math.max(0, toMoneyNumber(lastLine?.missingQty));

    const findLastPositive = (field) => {
      for (let index = stages.length - 1; index >= 0; index -= 1) {
        const value = Math.max(0, toMoneyNumber(stages[index].line?.[field]));
        if (value > 0) return value;
      }
      return 0;
    };
    const findLastText = (...fields) => {
      for (let index = stages.length - 1; index >= 0; index -= 1) {
        for (const field of fields) {
          const value = String(stages[index].line?.[field] ?? '').trim();
          if (value) return value;
        }
      }
      return '';
    };

    const damagedUnitChargeBs = findLastPositive('damagedUnitChargeBs');
    const missingUnitChargeBs = findLastPositive('missingUnitChargeBs');
    const computedPenaltyBs = Number((
      damagedQty * damagedUnitChargeBs
      + missingQty * missingUnitChargeBs
    ).toFixed(2));
    const fallbackPenaltyBs = stages.reduce(
      (max, stage) => Math.max(max, Math.max(0, toMoneyNumber(stage.line?.penaltyBs))),
      0,
    );
    const penaltyBs = computedPenaltyBs > 0 ? computedPenaltyBs : fallbackPenaltyBs;

    return {
      ...lastLine,
      lineKey: group.lineKey || String(lastLine?.lineKey ?? '').trim(),
      itemId: group.itemId || String(lastLine?.itemId ?? '').trim(),
      itemName: group.itemName,
      damagedQty,
      missingQty,
      damagedUnitChargeBs,
      missingUnitChargeBs,
      damagedFeeBs: Number((damagedQty * damagedUnitChargeBs).toFixed(2)),
      missingFeeBs: Number((missingQty * missingUnitChargeBs).toFixed(2)),
      penaltyBs,
      damageNote: findLastText('damageNote', 'note'),
      chargeOwner: findLastText('chargeOwner') || 'cliente',
    };
  });
};

const isVoidedCashMovement = (movement) => Boolean(
  movement?.voidedAt
  || movement?.voidedBy
  || normalizeText(movement?.status) === 'anulado'
  || normalizeText(movement?.status) === 'voided'
);

const getCashMovementAmount = (movement) => toMoneyNumber(
  movement?.amountBs
  ?? movement?.amount
  ?? movement?.totalBs
  ?? 0,
);

const getEconomicMovementAmount = (movement, data = null) => {
  const amount = getCashMovementAmount(movement);
  if (amount !== 0) {
    const type = normalizeText(movement?.type);
    const tag = normalizeText(movement?.accountingTag);
    const category = normalizeText(movement?.category);
    if (type.includes('egreso') || tag === 'guarantee_refund' || category.includes('devolucion')) {
      return Math.abs(amount);
    }
    return amount;
  }

  const type = normalizeText(movement?.type);
  if (type === 'saldo_pendiente_cobro') {
    return toMoneyNumber(data?.balanceBs);
  }
  if (type === 'liquidacion_devolucion') {
    return Math.max(
      0,
      toMoneyNumber(data?.penaltiesBs)
        + toMoneyNumber(data?.outstandingRentalBs)
        + toMoneyNumber(data?.refundBs),
    );
  }
  if (type === 'saldo_alquiler_pendiente') {
    return toMoneyNumber(data?.outstandingRentalBs || data?.totalBs);
  }
  if (type === 'perdida_interna_devolucion') {
    return toMoneyNumber(movement?.internalPenaltiesBs);
  }
  return amount;
};

const getEconomicMovementKind = (movement) => {
  const type = normalizeText(movement?.type);
  const tag = normalizeText(movement?.accountingTag);
  const category = normalizeText(movement?.category);
  const amount = Math.abs(getCashMovementAmount(movement));
  const cashBoxType = normalizeText(movement?.cashBoxType);
  const receiptCode = String(movement?.receiptCode ?? movement?.receipt ?? '').trim();
  const isBigCash = ['big_cash', 'caja_grande', 'cajagrande'].includes(cashBoxType);
  const isCollection = tag === 'contract_economic_collection'
    || tag.includes('collection')
    || category.includes('cobro')
    || type.includes('cobro')
    || type.includes('ingreso')
    || (Boolean(receiptCode) && isBigCash && amount > 0);
  if (isVoidedCashMovement(movement)) return 'voided';
  if (amount > 0 && isCollection) return 'income';
  if (type.includes('egreso') || tag === 'guarantee_refund' || category.includes('devolucion')) return 'expense';
  if (type.includes('saldo') || type.includes('liquidacion') || type.includes('pendiente')) return 'pending';
  return 'income';
};

const getEconomicMovementKindLabel = (kind) => {
  if (kind === 'expense') return 'Egreso';
  if (kind === 'pending') return 'Pendiente';
  if (kind === 'voided') return 'Anulado';
  return 'Ingreso';
};

const formatCashMovementType = (movement) => {
  const tag = normalizeText(movement?.accountingTag);
  const category = normalizeText(movement?.category);
  const type = normalizeText(movement?.type);
  if (tag === 'guarantee_refund' || category.includes('garantia_devuelta')) return 'Devolucion garantia';
  if (tag.includes('guarantee') || category.includes('garantia')) return 'Garantia';
  if (category.includes('adelanto')) return 'Adelanto';
  if (type.includes('egreso')) return 'Egreso';
  if (type.includes('ingreso')) return 'Ingreso';
  if (type.includes('cobro')) return 'Cobro';
  return movement?.type || movement?.category || 'Movimiento';
};

const valuesMatch = (left, right) => {
  const a = String(left ?? '').trim();
  const b = String(right ?? '').trim();
  return Boolean(a && b && a === b);
};

const findByPriority = (rows, priorities = []) => {
  const source = Array.isArray(rows) ? rows : [];
  for (const priority of priorities) {
    const field = String(priority?.field ?? '').trim();
    const value = priority?.value;
    if (!field || !String(value ?? '').trim()) continue;
    const match = source.find((row) => valuesMatch(row?.[field], value));
    if (match) return match;
  }
  return null;
};

const ECONOMIC_LEDGER_TYPE_META = {
  deposit: { label: 'Deposito / pago', tone: 'blue' },
  guarantee: { label: 'Apartar garantia', tone: 'violet' },
  charge: { label: 'Dano / faltante', tone: 'orange' },
  refund: { label: 'Devolucion al cliente', tone: 'green' },
  note: { label: 'Nota interna', tone: 'slate' },
};

const ECONOMIC_COLLECTION_TARGETS = {
  rental: {
    label: 'Items / alquiler',
    shortLabel: 'Items',
    tag: 'contract_items_collection',
    category: 'cobro_items_contrato',
  },
  transport: {
    label: 'Transporte',
    shortLabel: 'Transporte',
    tag: 'transport_revenue',
    category: 'transporte_cobrado',
  },
  damage: {
    label: 'Danos / faltantes',
    shortLabel: 'Danos',
    tag: 'contract_damage_collection',
    category: 'cobro_danos_faltantes',
  },
  balance: {
    label: 'Saldo general',
    shortLabel: 'General',
    tag: 'contract_economic_collection',
    category: 'cobro_contrato',
  },
};

const ECONOMIC_COLLECTION_TARGET_ORDER = ['rental', 'transport', 'damage'];

const normalizeEconomicCollectionTargets = (targets) => {
  const rawTargets = Array.isArray(targets) ? targets : [targets];
  const unique = rawTargets
    .map((target) => String(target ?? '').trim())
    .filter((target, index, list) => ECONOMIC_COLLECTION_TARGETS[target] && list.indexOf(target) === index);
  if (unique.includes('balance')) return ['balance'];
  return unique.length ? ECONOMIC_COLLECTION_TARGET_ORDER.filter((target) => unique.includes(target)) : ['rental'];
};

const normalizeEconomicLedgerEntry = (entry, index = 0) => {
  const type = ECONOMIC_LEDGER_TYPE_META[entry?.type] ? entry.type : 'note';
  const paymentMethod = type === 'note' ? '' : normalizeLedgerPaymentMethod(entry?.paymentMethod ?? entry?.method);
  return {
    id: String(entry?.id ?? `economic-ledger-${index}`).trim(),
    type,
    amountBs: Math.max(0, toMoneyNumber(entry?.amountBs ?? entry?.amount ?? 0)),
    paymentMethod,
    paymentAccount: paymentMethod === 'qr'
      ? normalizeLedgerPaymentAccount(entry?.paymentAccount ?? entry?.account)
      : '',
    note: String(entry?.note ?? '').trim(),
    createdAt: entry?.createdAt ?? new Date().toISOString(),
    createdByName: String(entry?.createdByName ?? entry?.createdBy ?? 'Sistema').trim() || 'Sistema',
    editedAt: entry?.editedAt ?? null,
    editedByName: String(entry?.editedByName ?? '').trim(),
    cashMovementId: String(entry?.cashMovementId ?? '').trim() || null,
    cashReceiptCode: String(entry?.cashReceiptCode ?? '').trim(),
    isCashRegistered: Boolean(entry?.isCashRegistered),
    cashRegisteredAt: entry?.cashRegisteredAt ?? null,
    cashCollectionTarget: String(entry?.cashCollectionTarget ?? '').trim().toLowerCase(),
    reclassifiedFromPayment: Boolean(entry?.reclassifiedFromPayment),
    refundSource: entry?.refundSource === 'surplus' ? 'surplus' : 'guarantee',
    sourceDepositId: String(entry?.sourceDepositId ?? '').trim() || null,
    contractAllocationBs: Math.max(0, toMoneyNumber(entry?.contractAllocationBs)),
    guaranteeAllocationBs: Math.max(0, toMoneyNumber(entry?.guaranteeAllocationBs)),
    surplusAllocationBs: Math.max(0, toMoneyNumber(entry?.surplusAllocationBs)),
    attachment: entry?.attachment && typeof entry.attachment === 'object'
      ? {
          url: String(entry.attachment.url ?? '').trim(),
          filename: String(entry.attachment.filename ?? '').trim(),
          originalName: String(entry.attachment.originalName ?? entry.attachment.filename ?? '').trim(),
          mimeType: String(entry.attachment.mimeType ?? '').trim(),
          bytes: Math.max(0, Math.trunc(Number(entry.attachment.bytes ?? 0))),
          uploadedAt: entry.attachment.uploadedAt ?? null,
          uploadedById: entry.attachment.uploadedById ?? null,
          uploadedByName: String(entry.attachment.uploadedByName ?? '').trim(),
        }
      : null,
    deletedAt: entry?.deletedAt ?? null,
    deletedById: entry?.deletedById ?? null,
    deletedByName: String(entry?.deletedByName ?? '').trim(),
    deletionReason: String(entry?.deletionReason ?? '').trim(),
  };
};

const isGeneratedEconomicCollectionEntry = (entry) => (
  entry?.type === 'deposit'
  && (
    String(entry?.id ?? '').startsWith('eco-cash-')
    || Boolean(String(entry?.cashCollectionTarget ?? '').trim())
  )
);

const isEconomicLedgerEntryConfirmedInCash = (entry) => Boolean(
  entry?.isCashRegistered
  || String(entry?.cashMovementId ?? '').trim()
  || String(entry?.cashReceiptCode ?? '').trim()
);

const isStandaloneEconomicGuarantee = (entry) => (
  entry?.type === 'guarantee'
  && !entry?.reclassifiedFromPayment
  && !String(entry?.sourceDepositId ?? '').trim()
  && isEconomicLedgerEntryConfirmedInCash(entry)
);

const getEconomicDepositAllocations = (ledger = [], contractTotalBs = 0) => {
  const deposits = ledger
    .filter((entry) => entry?.type === 'deposit' && !entry?.reclassifiedFromPayment && !isGeneratedEconomicCollectionEntry(entry))
    .sort((left, right) => new Date(left?.createdAt ?? 0) - new Date(right?.createdAt ?? 0));
  const guarantees = ledger.filter((entry) => entry?.type === 'guarantee');
  const explicitByDeposit = guarantees.reduce((map, entry) => {
    const sourceDepositId = String(entry?.sourceDepositId ?? '').trim();
    if (!sourceDepositId) return map;
    map.set(sourceDepositId, toMoneyNumber(map.get(sourceDepositId)) + toMoneyNumber(entry?.amountBs));
    return map;
  }, new Map());
  // Una garantia con movimiento/recibo propio fue pagada aparte y no debe
  // volver a salir de un deposito del alquiler. Solo se infieren desde los
  // depositos las garantias antiguas sin respaldo independiente.
  let unassignedGuaranteeBs = guarantees.reduce((sum, entry) => {
    if (String(entry?.sourceDepositId ?? '').trim()) return sum;
    if (isStandaloneEconomicGuarantee(entry)) return sum;
    return sum + toMoneyNumber(entry?.amountBs);
  }, 0);
  let contractPendingBs = Math.max(0, toMoneyNumber(contractTotalBs));
  const allocations = new Map();

  deposits.forEach((entry) => {
    const receivedBs = Math.max(0, toMoneyNumber(entry?.amountBs));
    const savedContractBs = Math.max(0, toMoneyNumber(entry?.contractAllocationBs));
    const savedGuaranteeBs = Math.max(0, toMoneyNumber(entry?.guaranteeAllocationBs));
    const savedSurplusBs = Math.max(0, toMoneyNumber(entry?.surplusAllocationBs));
    const savedTotalBs = Number((savedContractBs + savedGuaranteeBs + savedSurplusBs).toFixed(2));
    if (savedTotalBs > 0 && Math.abs(savedTotalBs - receivedBs) < 0.01) {
      const explicitlyLinkedGuaranteeBs = Math.max(0, toMoneyNumber(explicitByDeposit.get(entry.id)));
      const savedFromUnassignedGuaranteeBs = Math.max(0, savedGuaranteeBs - explicitlyLinkedGuaranteeBs);
      unassignedGuaranteeBs = Math.max(
        0,
        Number((unassignedGuaranteeBs - savedFromUnassignedGuaranteeBs).toFixed(2)),
      );
      allocations.set(entry.id, {
        receivedBs,
        contractBs: savedContractBs,
        guaranteeBs: savedGuaranteeBs,
        surplusBs: savedSurplusBs,
      });
      contractPendingBs = Math.max(0, Number((contractPendingBs - savedContractBs).toFixed(2)));
      return;
    }

    const explicitGuaranteeBs = Math.min(receivedBs, Math.max(0, toMoneyNumber(explicitByDeposit.get(entry.id))));
    const remainingAfterExplicitBs = Math.max(0, Number((receivedBs - explicitGuaranteeBs).toFixed(2)));
    const inferredGuaranteeBs = Math.min(remainingAfterExplicitBs, unassignedGuaranteeBs);
    unassignedGuaranteeBs = Math.max(0, Number((unassignedGuaranteeBs - inferredGuaranteeBs).toFixed(2)));
    const guaranteeBs = Number((explicitGuaranteeBs + inferredGuaranteeBs).toFixed(2));
    const availableForContractBs = Math.max(0, Number((receivedBs - guaranteeBs).toFixed(2)));
    const contractBs = Math.min(availableForContractBs, contractPendingBs);
    const surplusBs = Math.max(0, Number((availableForContractBs - contractBs).toFixed(2)));
    contractPendingBs = Math.max(0, Number((contractPendingBs - contractBs).toFixed(2)));
    allocations.set(entry.id, { receivedBs, contractBs, guaranteeBs, surplusBs });
  });

  return allocations;
};

const getEconomicCommercialCashAmount = (movement) => {
  const amountBs = Math.max(0, getCashMovementAmount(movement));
  if (amountBs <= 0) return 0;

  // Los recibos creados desde un deposito pueden contener dinero con destinos
  // distintos dentro de un unico movimiento fisico (contrato + garantia +
  // excedente). Para el saldo comercial solo cuenta lo aplicado al contrato.
  const accountingTag = normalizeText(movement?.accountingTag);
  const category = normalizeText(movement?.category);
  const hasDepositAllocation = accountingTag === 'contract_deposit_receipt'
    || category === 'abono_contrato';
  if (hasDepositAllocation) {
    return Math.max(0, toMoneyNumber(movement?.contractAllocationBs));
  }

  return amountBs;
};

const isEconomicGuaranteeBackedByCash = (entry, ledgerById = new Map()) => {
  if (entry?.type !== 'guarantee') return false;
  if (isEconomicLedgerEntryConfirmedInCash(entry)) return true;

  // Apartar una garantia desde un deposito es una reclasificacion del mismo
  // dinero, no un segundo ingreso. Por eso la garantia queda respaldada cuando
  // el deposito origen tiene movimiento/recibo oficial en Caja Grande.
  const sourceDepositId = String(entry?.sourceDepositId ?? '').trim();
  if (!sourceDepositId) return false;
  const sourceDeposit = ledgerById.get(sourceDepositId);
  return sourceDeposit?.type === 'deposit'
    && isEconomicLedgerEntryConfirmedInCash(sourceDeposit);
};

const isCashCollectedDamageLedgerEntry = (entry) => (
  entry?.type === 'charge'
  && entry?.cashCollectionTarget === 'damage'
  && Boolean(
    entry?.isCashRegistered
    || String(entry?.cashMovementId ?? '').trim()
    || String(entry?.cashReceiptCode ?? '').trim()
  )
);

const getEconomicInternalNotes = (contract) => (Array.isArray(contract?.economicLedger) ? contract.economicLedger : [])
  .map(normalizeEconomicLedgerEntry)
  .filter((entry) => !entry.deletedAt && entry.type === 'note' && entry.note)
  .sort((left, right) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime());

const getCatalogSearchScore = (searchValue, fields = []) => {
  const query = normalizeSearchText(searchValue);
  if (!query) return 1;

  const tokens = getSearchTokens(searchValue);
  const normalizedFields = fields.map(normalizeSearchText).filter(Boolean);
  const combined = normalizedFields.join(' ');
  if (!tokens.every((token) => combined.includes(token))) return -1;

  const primary = normalizedFields[0] ?? '';
  if (primary === query) return 100;
  if (primary.startsWith(query)) return 90;
  if (primary.includes(query)) return 80;
  if (tokens.every((token) => primary.includes(token))) return 70;
  return 50 + tokens.filter((token) => primary.includes(token)).length;
};

const normalizeWhatsAppNumber = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.length === 8) return `591${digits}`;
  return digits;
};

const getResponsibleDisplayName = (record) => {
  const responsibles = Array.isArray(record?.responsibles) ? record.responsibles.filter((entry) => entry?.name) : [];
  if (responsibles.length > 1) return `${responsibles[0].name} + ${responsibles.length - 1} mas`;
  if (responsibles.length === 1) return responsibles[0].name;
  return record?.responsibleName
    ?? record?.assignedToName
    ?? record?.createdByName
    ?? record?.userName
    ?? record?.createdBy
    ?? 'Sistema';
};

const getResponsibleDisplayRole = (record) => {
  const responsibles = Array.isArray(record?.responsibles) ? record.responsibles.filter((entry) => entry?.role) : [];
  if (responsibles.length > 1) return 'Responsables multiples';
  if (responsibles.length === 1) return responsibles[0].role;
  return record?.responsibleRole
    ?? record?.assignedToRole
    ?? record?.createdByRole
    ?? record?.userRole
    ?? 'Operacion';
};

const buildResponsibleOption = ({ id, name, role, source }) => {
  const normalizedName = String(name ?? '').trim();
  if (!normalizedName) return null;
  return {
    id: String(id ?? normalizedName).trim() || normalizedName,
    name: normalizedName,
    role: String(role ?? 'Operacion').trim() || 'Operacion',
    source,
  };
};

const openWhatsAppComposer = ({ phone, message }) => {
  const normalizedPhone = normalizeWhatsAppNumber(phone);
  if (!normalizedPhone) {
    throw new Error('El cliente no tiene un numero de WhatsApp valido.');
  }
  window.open(`https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message || '')}`, '_blank', 'noopener,noreferrer');
};

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.04 3.25a8.65 8.65 0 0 0-7.5 12.95L3.5 20.75l4.66-1.02a8.64 8.64 0 1 0 3.88-16.48Zm0 1.74a6.9 6.9 0 0 1 5.84 10.58 6.9 6.9 0 0 1-8.87 2.35l-.3-.16-2.55.56.58-2.48-.18-.32a6.91 6.91 0 0 1 5.48-10.53Zm-2.3 3.52c-.14 0-.36.05-.55.26-.2.22-.72.7-.72 1.72s.74 2 .84 2.14c.1.14 1.43 2.29 3.57 3.12 1.76.7 2.14.56 2.53.52.38-.04 1.24-.5 1.41-.99.18-.48.18-.9.13-.99-.05-.08-.2-.14-.42-.25-.22-.11-1.3-.64-1.5-.71-.2-.08-.35-.12-.5.11-.14.22-.57.72-.7.87-.13.14-.26.16-.48.05-.22-.11-.94-.34-1.78-1.1-.66-.58-1.1-1.3-1.23-1.52-.13-.22-.01-.34.1-.45.1-.1.22-.26.33-.39.11-.13.15-.22.22-.37.07-.14.04-.27-.02-.38-.05-.11-.5-1.22-.69-1.66-.18-.43-.37-.37-.5-.38h-.44Z"
      />
    </svg>
  );
}

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

const getEffectiveRentalOperationalState = (rental) => {
  const isUnconfirmedHistorical = Boolean(
    rental?.historicalReconstruction
    && !hasExplicitOperationalConfirmation(rental)
  );
  if (!isUnconfirmedHistorical) {
    return {
      rentalStatus: rental?.status ?? '',
      inventoryStatus: rental?.operational?.inventoryStatus ?? 'pendiente',
      transportStatus: rental?.operational?.transportStatus ?? 'pendiente',
    };
  }
  return {
    rentalStatus: rental?.status === 'cancelled' ? 'cancelled' : 'active',
    inventoryStatus: 'pendiente',
    transportStatus: rental?.logisticsMode === 'recojo' ? 'no_aplica' : 'pendiente',
  };
};

const getEffectiveReturnedPendingCollectionBs = (rental, contract = null) => {
  const settlement = rental?.returnSettlement ?? {};
  const storedPendingBs = Number(
    settlement?.pendingCollectionBs
    ?? rental?.payment?.pendingPaymentBs
    ?? rental?.totals?.pendingPaymentBs
    ?? 0,
  );
  if (!rental?.returnSettlement) return Math.max(0, storedPendingBs);

  const currentTotalBs = Math.max(
    Number(rental?.totals?.totalBs ?? 0),
    Number(contract?.totals?.totalBs ?? contract?.totalBs ?? 0),
  );
  const currentPaidBs = Math.max(
    Number(rental?.payment?.paidAtRentalBs ?? 0),
    Number(rental?.totals?.paidAtRentalBs ?? 0),
    Number(contract?.payment?.paidAtApprovalBs ?? 0),
  );
  const currentCommercialOutstandingBs = Math.max(0, currentTotalBs - currentPaidBs);
  const storedCommercialOutstandingBs = Number(
    settlement?.outstandingRentalBs
    ?? storedPendingBs,
  );
  const reconciledStoredPendingBs = Math.max(
    0,
    Number((storedPendingBs + currentCommercialOutstandingBs - storedCommercialOutstandingBs).toFixed(2)),
  );
  const hasSettlementBreakdown = [
    settlement?.outstandingRentalBs,
    settlement?.penaltiesBs,
    settlement?.discountCoveredByDepositBs,
  ].some((value) => value !== undefined && value !== null);
  if (!hasSettlementBreakdown) return reconciledStoredPendingBs;

  const penaltiesBs = Math.max(0, Number(settlement?.penaltiesBs ?? rental?.penaltiesBs ?? 0));
  const coveredByDepositBs = Math.max(0, Number(settlement?.discountCoveredByDepositBs ?? 0));
  const damageCollectedBs = Math.max(
    0,
    Number(settlement?.damageCollectedBs ?? 0),
    Number(settlement?.penaltiesCollectedBs ?? 0),
    Number(rental?.payment?.damageCollectedBs ?? 0),
    Number(rental?.totals?.damageCollectedBs ?? 0),
  );
  const derivedPendingBs = Math.max(
    0,
    Number((currentCommercialOutstandingBs + penaltiesBs - coveredByDepositBs - damageCollectedBs).toFixed(2)),
  );
  return Math.max(0, Number(Math.min(reconciledStoredPendingBs, derivedPendingBs).toFixed(2)));
};

const toOrderStatus = (rental, delivery) => {
  if (rental.status === 'cancelled') {
    return 'cancelled';
  }
  if (rental.status === 'returned') {
    const pendingCollectionBs = getEffectiveReturnedPendingCollectionBs(rental);
    if (pendingCollectionBs > 0) return 'closed_pending';
    if (rental.accountingStatus === 'cobrado_finalizado' || rental?.payment?.status === 'cobrado_finalizado') {
      return 'charged';
    }
    return 'completed';
  }

  const deliveryStatus = normalizeText(delivery?.status ?? '');
  if (deliveryStatus.includes('ruta')) return 'transport';
  if (deliveryStatus.includes('complet')) return 'completed';
  if (deliveryStatus.includes('incidencia')) return 'prep';

  const dueAt = new Date(rental?.dueAt ?? `${rental?.dueDate ?? ''}T${rental?.dueTime ?? '23:59'}:00`);
  const diffHours = (dueAt.getTime() - Date.now()) / (1000 * 60 * 60);
  if (Number.isFinite(diffHours) && diffHours <= 24) return 'prep';
  return 'pending';
};

const getInputDate = (baseDate = new Date()) => {
  const cloned = new Date(baseDate);
  cloned.setMinutes(cloned.getMinutes() - cloned.getTimezoneOffset());
  return cloned.toISOString().slice(0, 10);
};

const getInputDateTime = (value = new Date()) => {
  const parsed = new Date(value);
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const local = new Date(safeDate.getTime() - safeDate.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const getDateKey = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const directDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directDate) return directDate[1];

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return getInputDate(parsed);
};

const buildDateTimeFromDateKey = (dateKey, fallbackValue = null) => {
  const selectedDate = getDateKey(dateKey) || getInputDate(new Date());
  const fallbackDate = fallbackValue ? new Date(fallbackValue) : new Date();
  const timeSource = Number.isNaN(fallbackDate.getTime()) ? new Date() : fallbackDate;
  const hours = String(timeSource.getHours()).padStart(2, '0');
  const minutes = String(timeSource.getMinutes()).padStart(2, '0');
  const seconds = String(timeSource.getSeconds()).padStart(2, '0');
  return new Date(`${selectedDate}T${hours}:${minutes}:${seconds}`).toISOString();
};

const getCurrentWeekRange = (baseDate = new Date()) => {
  const date = new Date(baseDate);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    from: getInputDate(monday),
    to: getInputDate(sunday),
  };
};

const DEFAULT_CONTRACT_WEEK_RANGE = getCurrentWeekRange();

const getQuoteTimelineLabel = (quote) => {
  const status = normalizeText(quote?.status);
  const validUntil = getDateKey(quote?.validUntil || quote?.eventDate || quote?.deliveryDate);
  const isPast = validUntil && validUntil < getInputDate();

  if (status === 'aprobada') return 'Finalizada';
  if (status === 'rechazada') return 'Rechazada';
  if (status === 'vencida' || isPast) return 'Pasada';
  if (status === 'borrador') return 'Vigente borrador';
  if (status === 'enviada') return 'Vigente enviada';
  return 'Vigente';
};

const getContractTimelineLabel = (contract) => {
  const status = normalizeText(contract?.status);
  const endDate = getDateKey(contract?.pickupDate || contract?.returnDate || contract?.deliveryDate || contract?.eventDate);
  const isPast = endDate && endDate < getInputDate();

  if (status === 'anulado' || status === 'anulada') return 'Anulado';
  if (status === 'rechazado') return 'Rechazado';
  if (status === 'borrador') return 'Borrador';
  if (status === 'pendiente') return 'Pendiente';
  if (status === 'aprobado' && isPast) return 'Finalizado';
  if (status === 'aprobado') return 'Vigente';
  return isPast ? 'Pasado' : 'Vigente';
};

const parsePositiveInteger = (value, fallback = 1) => {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parsePercentage = (value, fallback = 100) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
};

const normalizeDurationTiers = (tiers = []) => {
  const source = Array.isArray(tiers) && tiers.length > 0 ? tiers : DURATION_PRICING_DEFAULT_TIERS;
  return source
    .map((tier, index) => {
      const fromDay = parsePositiveInteger(tier.fromDay, index + 1);
      const rawToDay = String(tier.toDay ?? '').trim();
      const parsedToDay = rawToDay === '' ? 0 : parsePositiveInteger(rawToDay, fromDay);
      return {
        id: tier.id ?? `tier-${index + 1}`,
        fromDay,
        toDay: parsedToDay > 0 ? Math.max(fromDay, parsedToDay) : 0,
        percent: parsePercentage(tier.percent),
      };
    })
    .sort((a, b) => a.fromDay - b.fromDay);
};

const calculateDurationPricing = ({ mode, days, tiers, baseSubtotalBs }) => {
  const safeBase = Math.max(0, Number(baseSubtotalBs ?? 0));
  const safeMode = mode === 'daily_schedule' ? 'daily_schedule' : mode === 'duration' ? 'duration' : 'simple';
  const normalizedTiers = normalizeDurationTiers(tiers);
  const safeDays = safeMode === 'duration' ? parsePositiveInteger(days, 1) : 1;

  if (safeMode !== 'duration') {
    return {
      mode: safeMode,
      days: 1,
      tiers: normalizedTiers,
      baseSubtotalBs: Number(safeBase.toFixed(2)),
      theoreticalSubtotalBs: Number(safeBase.toFixed(2)),
      chargeableSubtotalBs: Number(safeBase.toFixed(2)),
      durationDiscountBs: 0,
      effectiveMultiplier: 1,
      breakdown: [],
    };
  }

  const breakdown = Array.from({ length: safeDays }, (_, index) => {
    const day = index + 1;
    const tier = normalizedTiers.find((entry) => day >= entry.fromDay && (entry.toDay === 0 || day <= entry.toDay));
    const percent = tier?.percent ?? 100;
    const amountBs = safeBase * (percent / 100);
    return { day, percent, amountBs: Number(amountBs.toFixed(2)) };
  });
  const chargeableSubtotalBs = breakdown.reduce((sum, day) => sum + day.amountBs, 0);
  const theoreticalSubtotalBs = safeBase * safeDays;

  return {
    mode: 'duration',
    days: safeDays,
    tiers: normalizedTiers,
    baseSubtotalBs: Number(safeBase.toFixed(2)),
    theoreticalSubtotalBs: Number(theoreticalSubtotalBs.toFixed(2)),
    chargeableSubtotalBs: Number(chargeableSubtotalBs.toFixed(2)),
    durationDiscountBs: Number(Math.max(0, theoreticalSubtotalBs - chargeableSubtotalBs).toFixed(2)),
    effectiveMultiplier: safeBase > 0 ? Number((chargeableSubtotalBs / safeBase).toFixed(4)) : 0,
    breakdown,
  };
};

const findScheduleDayForLine = (line, scheduleDays, fallbackDay = null, options = {}) => {
  const lineDayId = String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim();
  const lineDate = getDateKey(line?.serviceDate ?? line?.date);
  const lineLabel = normalizeText(line?.serviceDayLabel ?? line?.dayLabel);
  const dayById = scheduleDays.find((day) => String(day?.id ?? '') === lineDayId) ?? null;
  const dayByDate = lineDate ? scheduleDays.find((day) => getDateKey(day?.date) === lineDate) ?? null : null;
  const dayByLabel = lineLabel ? scheduleDays.find((day) => normalizeText(day?.label) === lineLabel) ?? null : null;
  const primaryDay = lineDate || options?.preferDate
    ? (dayByDate ?? dayById)
    : (dayById ?? dayByDate);
  return primaryDay
    ?? dayByLabel
    ?? fallbackDay
    ?? scheduleDays[0]
    ?? null;
};

const escapeDocText = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

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

const buildSupplierInternalDocumentHtml = ({ order, contract, formatDate, formatBs }) => {
  const contractPlan = Array.isArray(contract?.supplierFulfillmentPlan) ? contract.supplierFulfillmentPlan : [];
  const orderPlan = Array.isArray(order?.supplierFulfillmentPlan) ? order.supplierFulfillmentPlan : [];
  const plan = contractPlan.length > 0 ? contractPlan : orderPlan;
  const rows = plan.map((line) => {
    const quantity = Math.max(0, Number(line.neededQty ?? line.quantity ?? 0));
    const cost = Math.max(0, Number(line.supplierUnitCostBs ?? 0));
    const sale = Math.max(0, Number(line.saleUnitPriceBs ?? 0));
    const costTotal = quantity * cost;
    const saleTotal = quantity * sale;
    return {
      supplierName: String(line.supplierName ?? 'Proveedor').trim() || 'Proveedor',
      itemName: String(line.itemName ?? 'Item').trim() || 'Item',
      quantity,
      cost,
      sale,
      costTotal,
      saleTotal,
      margin: saleTotal - costTotal,
      quoteCode: String(line.supplierQuoteCode ?? '').trim(),
    };
  });
  const totals = rows.reduce((acc, row) => ({
    quantity: acc.quantity + row.quantity,
    costTotal: acc.costTotal + row.costTotal,
    saleTotal: acc.saleTotal + row.saleTotal,
    margin: acc.margin + row.margin,
  }), { quantity: 0, costTotal: 0, saleTotal: 0, margin: 0 });

  const tableRows = rows.map((row) => `
    <tr>
      <td>
        <strong>${escapeDocText(row.itemName)}</strong>
        ${row.quoteCode ? `<small>Cotizacion proveedor: ${escapeDocText(row.quoteCode)}</small>` : ''}
      </td>
      <td>${escapeDocText(row.supplierName)}</td>
      <td>${row.quantity}</td>
      <td>${formatBs(row.cost)}</td>
      <td>${formatBs(row.sale)}</td>
      <td>${formatBs(row.costTotal)}</td>
      <td>${formatBs(row.saleTotal)}</td>
      <td class="${row.margin >= 0 ? 'positive' : 'negative'}">${formatBs(row.margin)}</td>
    </tr>
  `).join('');

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; padding: 32px; color: #101828; font-family: Inter, Arial, sans-serif; background: #f6f8fc; }
          .page { max-width: 980px; margin: 0 auto; background: #fff; border: 1px solid #dbe3f1; border-radius: 18px; padding: 30px; box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08); }
          header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #f05a00; padding-bottom: 18px; margin-bottom: 20px; }
          h1 { margin: 0; color: #0b1f4f; font-size: 28px; }
          h2 { margin: 24px 0 10px; color: #0b1f4f; font-size: 16px; }
          p { margin: 4px 0; color: #667085; }
          .badge { display: inline-block; border: 1px solid #fed7aa; border-radius: 999px; background: #fff7ed; color: #c2410c; padding: 7px 12px; font-weight: 800; }
          .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; }
          .metric { border: 1px solid #e4eaf5; border-radius: 12px; background: #fbfcff; padding: 12px; display: grid; gap: 4px; }
          .metric small { color: #667085; font-weight: 700; }
          .metric strong { color: #0b1f4f; font-size: 18px; }
          table { width: 100%; border-collapse: collapse; border: 1px solid #e4eaf5; border-radius: 12px; overflow: hidden; }
          th { background: #fff3e8; color: #9a3412; text-align: left; font-size: 11px; text-transform: uppercase; }
          th, td { border-bottom: 1px solid #e4eaf5; padding: 10px; font-size: 13px; vertical-align: top; }
          td:nth-child(n+3), th:nth-child(n+3) { text-align: right; }
          td strong { display: block; color: #0b1f4f; }
          td small { display: block; margin-top: 3px; color: #667085; }
          .positive { color: #047857; font-weight: 900; }
          .negative { color: #b42318; font-weight: 900; }
          .empty { border: 1px dashed #dbe3f1; border-radius: 12px; padding: 18px; color: #667085; background: #fbfcff; }
          footer { margin-top: 22px; border-top: 1px solid #e4eaf5; padding-top: 12px; color: #667085; font-size: 12px; }
        </style>
      </head>
      <body>
        <main class="page">
          <header>
            <div>
              <span class="badge">Documento interno</span>
              <h1>Resumen administrativo de proveedor</h1>
              <p>No entregar al cliente. Controla costo, venta y margen de items externos.</p>
            </div>
            <div>
              <p><strong>Contrato:</strong> ${escapeDocText(contract?.contractCode ?? order?.contractCode ?? order?.orderCode ?? '-')}</p>
              <p><strong>Orden:</strong> ${escapeDocText(order?.orderCode ?? contract?.orderCode ?? '-')}</p>
              <p><strong>Fecha:</strong> ${formatDate(contract?.createdAt ?? order?.createdAt ?? new Date().toISOString())}</p>
            </div>
          </header>
          <section class="grid">
            <article class="metric"><small>Proveedor cubre</small><strong>${totals.quantity} u.</strong></article>
            <article class="metric"><small>Costo proveedor</small><strong>${formatBs(totals.costTotal)}</strong></article>
            <article class="metric"><small>Venta al cliente</small><strong>${formatBs(totals.saleTotal)}</strong></article>
            <article class="metric"><small>Margen estimado</small><strong>${formatBs(totals.margin)}</strong></article>
          </section>
          <h2>Items externos</h2>
          ${rows.length ? `
            <table>
              <thead>
                <tr>
                  <th>Item</th><th>Proveedor</th><th>Cant.</th><th>Costo unit.</th><th>Venta unit.</th><th>Costo total</th><th>Venta total</th><th>Margen</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          ` : '<div class="empty">Este contrato no tiene items cubiertos por proveedor.</div>'}
          <footer>Generado por El Copetin para control administrativo interno.</footer>
        </main>
      </body>
    </html>`;
};

const buildEmptyDraft = (mode = 'quote') => {
  const now = new Date();
  const deliveryDate = getInputDate(now);
  const pickupDate = getInputDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const defaultScheduleDay = {
    id: `day-${deliveryDate}`,
    label: 'Dia 1',
    date: deliveryDate,
    note: '',
  };

  return {
    mode,
    entityType: 'quote',
    recordId: '',
    rentalId: '',
    orderCode: '',
    quoteId: '',
    recordStatus: 'borrador',
    documentCodeMode: 'auto',
    manualDocumentCode: '',
    contractDate: deliveryDate,
    clientId: '',
    customerName: '',
    customerCi: '',
    customerPhone: '',
    customerReferencePhone: '',
    companyName: '',
    eventType: 'social',
    eventDate: deliveryDate,
    eventTime: '20:00',
    address: '',
    addressSource: 'manual',
    city: '',
    billingMode: 'sin_factura',
    deliveryDate,
    logisticsMode: 'envio',
    deliveryChargeMode: 'included',
    deliveryFeeBs: '0',
    deliveryFeeReason: 'covered',
    deliveryWindowStart: '08:00',
    deliveryWindowEnd: '10:00',
    deliveryTimeMode: 'fixed',
    pickupDate,
    pickupWindowStart: '20:00',
    pickupWindowEnd: '22:00',
    pickupTimeMode: 'fixed',
    driverId: '',
    vehicleId: '',
    discountMode: 'percent',
    discountBs: '0',
    discountPercent: '0',
    guaranteeBs: '0',
    guaranteeStatus: 'no_validado',
    guaranteePaymentMethod: 'efectivo',
    guaranteePaymentAccount: '',
    paidAtApprovalBs: '0',
    originalPaidAtApprovalBs: '0',
    initialPaymentMethod: 'efectivo',
    initialPaymentAccount: '',
    pricingMode: 'simple',
    pricingDays: '1',
    pricingTiers: DURATION_PRICING_DEFAULT_TIERS,
    scheduleDays: [defaultScheduleDay],
    validUntil: pickupDate,
    observations: '',
    responsibleIds: [],
    items: [],
    services: [],
    supplierFulfillmentPlan: [],
  };
};

const normalizeScheduleDay = (day, index = 0, fallbackDate = '') => {
  const date = getDateKey(day?.date) || fallbackDate || getInputDate(new Date());
  return {
    id: String(day?.id ?? `day-${date || index + 1}`).trim() || `day-${index + 1}`,
    label: String(day?.label ?? `Dia ${index + 1}`).trim() || `Dia ${index + 1}`,
    date,
    note: String(day?.note ?? '').trim(),
  };
};

const buildScheduleDaysFromRange = (startDate, endDate) => {
  const startKey = getDateKey(startDate) || getInputDate(new Date());
  const endKey = getDateKey(endDate) || startKey;
  const start = new Date(`${startKey}T12:00:00`);
  const end = new Date(`${endKey}T12:00:00`);
  const days = [];
  const maxDays = 14;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [normalizeScheduleDay({ id: `day-${startKey}`, label: 'Dia 1', date: startKey }, 0, startKey)];
  }
  for (let cursor = new Date(start); cursor <= end && days.length < maxDays; cursor.setDate(cursor.getDate() + 1)) {
    const date = getInputDate(cursor);
    days.push(normalizeScheduleDay({ id: `day-${date}`, label: `Dia ${days.length + 1}`, date }, days.length, date));
  }
  return days.length ? days : [normalizeScheduleDay({ id: `day-${startKey}`, label: 'Dia 1', date: startKey }, 0, startKey)];
};

const buildEmptyQuickItemDraft = () => ({
  category: '',
  name: '',
  color: '',
  material: '',
  rentalPriceBs: '0',
});

const buildEmptyServiceDraft = () => ({
  name: '',
  detail: '',
  quantity: '1',
  unitPriceBs: '0',
});

const selectNumericInput = (event) => {
  window.setTimeout(() => event.target.select(), 0);
};

const cleanIntegerInput = (value) => String(value ?? '').replace(/[^\d]/g, '');

const cleanDecimalInput = (value) => {
  const normalized = String(value ?? '').replace(',', '.').replace(/[^\d.]/g, '');
  const [integerPart = '', ...decimalParts] = normalized.split('.');
  const decimalPart = decimalParts.join('');
  return decimalParts.length > 0 ? `${integerPart}.${decimalPart}` : integerPart;
};

const parseIntegerInput = (value, fallback = 1) => {
  const cleaned = cleanIntegerInput(value);
  if (!cleaned) return fallback;
  const parsed = Math.trunc(Number(cleaned));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseMoneyInput = (value, fallback = 0) => {
  const cleaned = cleanDecimalInput(value);
  if (!cleaned || cleaned === '.') return fallback;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const makeSupplierShortCode = (name) => {
  const cleaned = normalizeText(name).replace(/[^a-z0-9 ]/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0].slice(0, 3)} ${words[1].slice(0, 4)}`.toUpperCase();
  return (words[0] ?? 'PROV').slice(0, 7).toUpperCase();
};

const normalizeCoverageDraftLines = (value) => {
  const lines = Array.isArray(value?.coverages) ? value.coverages : value ? [value] : [];
  return lines
    .map((line) => ({
      ...line,
      id: String(line?.id ?? `cov-${Date.now()}-${Math.random().toString(16).slice(2)}`).trim(),
      lineKey: String(line?.lineKey ?? '').trim() || null,
      supplierId: String(line?.supplierId ?? '').trim(),
      supplierName: String(line?.supplierName ?? '').trim(),
      supplierQuoteId: line?.supplierQuoteId ?? null,
      supplierQuoteCode: line?.supplierQuoteCode ?? null,
      neededQty: Math.max(0, Math.trunc(Number(line?.neededQty ?? 0))),
      supplierUnitCostBs: Math.max(0, Number(line?.supplierUnitCostBs ?? 0)),
      manualCoverage: Boolean(line?.manualCoverage),
    }))
    .filter((line) => line.neededQty > 0 || line.supplierId || line.supplierName);
};

const getSupplierCoverageKey = (line) => String(line?.lineKey ?? line?.itemId ?? line ?? '').trim();

const buildSupplierCoverageDraftByItem = (sourcePlan = []) => {
  const fromRecord = {};
  (Array.isArray(sourcePlan) ? sourcePlan : []).forEach((line) => {
    const itemId = String(line?.itemId ?? '').trim();
    if (!itemId) return;
    const coverageKey = String(line?.lineKey ?? itemId).trim();
    const current = normalizeCoverageDraftLines(fromRecord[coverageKey]);
    current.push({
      id: line?.id ?? `cov-${itemId}-${current.length}`,
      lineKey: coverageKey !== itemId ? coverageKey : String(line?.lineKey ?? '').trim() || null,
      supplierId: String(line?.supplierId ?? '').trim(),
      supplierName: String(line?.supplierName ?? '').trim(),
      supplierQuoteId: String(line?.supplierQuoteId ?? '').trim() || null,
      supplierQuoteCode: String(line?.supplierQuoteCode ?? '').trim() || null,
      neededQty: Math.max(1, Math.trunc(Number(line?.neededQty ?? 1))),
      supplierUnitCostBs: Math.max(0, Number(line?.supplierUnitCostBs ?? 0)),
      manualCoverage: Boolean(line?.manualCoverage),
    });
    fromRecord[coverageKey] = { coverages: current };
  });
  return fromRecord;
};

const buildEmptySupplierCoverageDraft = () => ({
  supplierMode: 'existing',
  supplierId: '',
  supplierName: '',
  contactName: '',
  phone: '',
  whatsapp: '',
  itemName: '',
  category: '',
  color: '',
  material: '',
  quantity: '1',
  supplierUnitCostBs: '0',
  saleUnitPriceBs: '0',
  notes: '',
});

const getOperationalItemDetails = (line) => {
  const quickItem = line?.quickItem ?? {};
  const item = line?.item ?? {};
  return [
    { label: 'Categoria', value: item.category || quickItem.category },
    { label: 'Color', value: item.itemColor || quickItem.color },
    { label: 'Material', value: item.brand || quickItem.material },
  ]
    .map((entry) => ({
      ...entry,
      value: String(entry.value ?? '').trim(),
    }))
    .filter((entry) => entry.value);
};

const WIZARD_ITEM_AREAS = [
  { key: 'vajilla', label: 'Vajilla', className: 'blue', order: 1 },
  { key: 'manteleria', label: 'Manteleria', className: 'violet', order: 2 },
  { key: 'mobiliario', label: 'Mobiliario', className: 'green', order: 3 },
];

const resolveWizardItemArea = (line) => {
  const resolvedArea = resolveInventoryArea(line?.item ?? line?.quickItem ?? line);
  if (resolvedArea === 'vajilla') return WIZARD_ITEM_AREAS[0];
  if (resolvedArea === 'manteleria') return WIZARD_ITEM_AREAS[1];

  const category = normalizeText(
    line?.item?.category
    ?? line?.quickItem?.category
    ?? line?.comboCategory
    ?? line?.category
    ?? '',
  );
  const name = normalizeText(line?.item?.name ?? line?.itemName ?? line?.quickItem?.name ?? '');
  const haystack = `${category} ${name}`;

  if (haystack.includes('vajilla') || haystack.includes('cristal') || haystack.includes('copa') || haystack.includes('vaso') || haystack.includes('plato')) {
    return WIZARD_ITEM_AREAS[0];
  }
  if (haystack.includes('mantel') || haystack.includes('muleton') || haystack.includes('servilleta') || haystack.includes('camino') || haystack.includes('faldon') || haystack.includes('faldin') || haystack.includes('tela')) {
    return WIZARD_ITEM_AREAS[1];
  }
  return WIZARD_ITEM_AREAS[2];
};

const getWizardItemMoveKey = (line) => String(line?.comboLineKey ?? line?.lineKey ?? line?.itemId ?? '');

const getDraftLineKey = (line, index = 0) => {
  const existingKey = String(line?.lineKey ?? '').trim();
  if (existingKey) return existingKey;
  const comboLineKey = String(line?.comboLineKey ?? '').trim();
  const itemId = String(line?.itemId ?? line?.quickItem?.id ?? 'item').trim() || 'item';
  return comboLineKey ? `${comboLineKey}-${itemId}-${index}` : `item-${itemId}-${index}`;
};

const isDetachedFromInventory = (lineOrItem) => {
  const item = lineOrItem?.item ?? lineOrItem ?? {};
  return lineOrItem?.controlsStock === false
    || String(lineOrItem?.verificationStatus ?? '').trim() === 'pending_verification'
    || item.controlsStock === false
    || String(item.verificationStatus ?? '').trim() === 'pending_verification'
    || String(item.adoptionSource ?? '').trim() === 'service_order_quick_item'
    || (Number(item.totalStock ?? 0) <= 0 && Number(item.availableStock ?? 0) <= 0);
};

const getClientAddressOptions = (client) => {
  if (!client) return [];

  const addresses = Array.isArray(client.deliveryAddresses) ? client.deliveryAddresses : [];
  const options = addresses
    .map((entry, index) => {
      const address = String(entry?.address ?? '').trim();
      const city = String(entry?.city ?? '').trim();
      if (!address && !city) return null;
      const rawLabel = String(entry?.label ?? '').trim();
      const label = normalizeText(rawLabel) === 'principal' || !rawLabel
        ? `Direccion ${index + 1}`
        : rawLabel;

      return {
        id: entry?.id ?? `address-${index}`,
        label,
        address,
        city,
        reference: String(entry?.reference ?? '').trim(),
      };
    })
    .filter(Boolean);

  if (options.length === 0 && (client.address || client.city)) {
    options.push({
      id: 'client-address',
      label: 'Direccion 1',
      address: String(client.address ?? '').trim(),
      city: String(client.city ?? '').trim(),
      reference: '',
    });
  }

  return options;
};

const readSeenCounts = () => {
  if (typeof window === 'undefined') {
    return { quotes: 0, contracts: 0 };
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ORDERS_SEEN_STORAGE_KEY) ?? '{}');
    return {
      quotes: Math.max(0, Number(parsed.quotes ?? 0)),
      contracts: Math.max(0, Number(parsed.contracts ?? 0)),
    };
  } catch {
    return { quotes: 0, contracts: 0 };
  }
};

const saveSeenCounts = (counts) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ORDERS_SEEN_STORAGE_KEY, JSON.stringify(counts));
  } catch {
    // ignore storage errors
  }
};


const escapeOrdersReportHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const exportOrdersRangeWorkbook = async (report = {}) => {
  const excelModule = await import('exceljs');
  const ExcelJS = excelModule.default ?? excelModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'El Copetin';
  workbook.company = 'El Copetin';
  workbook.created = new Date();
  workbook.modified = new Date();

  const navy = 'FF173A70';
  const dark = 'FF172033';
  const muted = 'FF64748B';
  const border = 'FFD7DEE8';
  const soft = 'FFF8FAFC';
  const success = 'FF16803C';
  const successBg = 'FFEDF9F0';
  const warning = 'FFB86A06';
  const warningBg = 'FFFFF8E8';
  const danger = 'FFB42332';
  const dangerBg = 'FFFFF0F2';
  const info = 'FF2563EB';
  const infoBg = 'FFEEF5FF';
  const mutedBg = 'FFF4F6F8';

  const tonePalette = {
    success: { fg: success, bg: successBg },
    warning: { fg: warning, bg: warningBg },
    danger: { fg: danger, bg: dangerBg },
    info: { fg: info, bg: infoBg },
    muted: { fg: muted, bg: mutedBg },
    navy: { fg: navy, bg: 'FFEAF0F8' },
  };
  const setThinBorders = (cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: border } },
      left: { style: 'thin', color: { argb: border } },
      bottom: { style: 'thin', color: { argb: border } },
      right: { style: 'thin', color: { argb: border } },
    };
  };

  const sheet = workbook.addWorksheet('Ordenes de servicio', {
    properties: { defaultRowHeight: 19 },
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.2, right: 0.2, top: 0.42, bottom: 0.42, header: 0.2, footer: 0.25 },
    },
    views: [{ state: 'frozen', ySplit: 10 }],
  });
  sheet.columns = [
    { width: 6 }, { width: 14 }, { width: 25 }, { width: 14 }, { width: 23 }, { width: 28 },
    { width: 15 }, { width: 17 }, { width: 16 }, { width: 15 }, { width: 16 }, { width: 17 },
    { width: 17 }, { width: 13 },
  ];

  sheet.mergeCells('A1:N1');
  sheet.getCell('A1').value = 'EL COPETÍN · ÓRDENES DE SERVICIO';
  sheet.getCell('A1').font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 23;

  sheet.mergeCells('A2:I2');
  sheet.getCell('A2').value = 'Reporte de Órdenes de Servicio';
  sheet.getCell('A2').font = { name: 'Calibri', size: 21, bold: true, color: { argb: dark } };
  sheet.mergeCells('J2:N2');
  sheet.getCell('J2').value = `Periodo: ${report.rangeLabel || '—'}`;
  sheet.getCell('J2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: dark } };
  sheet.getCell('J2').alignment = { horizontal: 'right' };
  sheet.getRow(2).height = 31;

  sheet.mergeCells('A3:I3');
  sheet.getCell('A3').value = `Filtros aplicados: ${report.filterLabel || 'Todos'}`;
  sheet.getCell('A3').font = { name: 'Calibri', size: 10, italic: true, color: { argb: muted } };
  sheet.mergeCells('J3:N3');
  sheet.getCell('J3').value = `Generado: ${report.generatedAt || '—'}`;
  sheet.getCell('J3').font = { name: 'Calibri', size: 9, color: { argb: muted } };
  sheet.getCell('J3').alignment = { horizontal: 'right' };

  sheet.mergeCells('A5:N5');
  sheet.getCell('A5').value = 'RESUMEN EJECUTIVO DEL PERIODO';
  sheet.getCell('A5').font = { name: 'Calibri', size: 9, bold: true, color: { argb: muted } };
  const cards = Array.isArray(report.summaryCards) ? report.summaryCards : [];
  cards.slice(0, 6).forEach((card, index) => {
    const start = index === 0 ? 1 : (index * 2);
    const end = index === 0 ? 1 : Math.min(11, start + 1);
    if (start !== end) sheet.mergeCells(6, start, 6, end);
    const cell = sheet.getCell(6, start);
    const palette = tonePalette[card.tone] ?? tonePalette.navy;
    cell.value = `${card.label}\n${card.value}`;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: palette.fg } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: palette.bg } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    setThinBorders(cell);
  });
  sheet.getRow(6).height = 40;

  sheet.mergeCells('A8:N8');
  sheet.getCell('A8').value = 'DETALLE DE CONTRATOS DEL RANGO';
  sheet.getCell('A8').font = { name: 'Calibri', size: 12, bold: true, color: { argb: dark } };
  const headers = ['N°', 'Contrato', 'Cliente', 'Evento', 'Responsable', 'Servicio', 'Estado', 'Garantía', 'Pendiente contrato', 'Pendiente transporte', 'Pendiente daños', 'Total por cobrar', 'Estado financiero', 'Finalizado'];
  const headerRow = sheet.getRow(10);
  headerRow.values = headers;
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    setThinBorders(cell);
  });

  const rows = Array.isArray(report.rows) ? report.rows : [];
  rows.forEach((row, index) => {
    const excelRow = sheet.getRow(11 + index);
    excelRow.values = [
      index + 1,
      row.contractCode || '—',
      row.customerName || 'Sin cliente',
      row.eventDateValue ? new Date(`${row.eventDateValue}T12:00:00`) : '',
      row.responsibleName || 'Sistema',
      row.serviceLabel || '—',
      row.statusLabel || '—',
      row.guaranteeLabel || 'Sin garantía',
      Number(row.contractPendingBs ?? 0),
      Number(row.transportPendingBs ?? 0),
      Number(row.damagePendingBs ?? 0),
      Number(row.totalReceivableBs ?? 0),
      row.financialStatusLabel || 'Pagado',
      row.finalizedLabel || 'No',
    ];
    excelRow.height = 26;
    excelRow.eachCell((cell, columnNumber) => {
      cell.font = { name: 'Calibri', size: 9, color: { argb: dark }, bold: [2, 3, 12, 13].includes(columnNumber) };
      cell.alignment = {
        vertical: 'middle',
        horizontal: [1, 4, 7, 8, 9, 10, 11, 12, 13, 14].includes(columnNumber) ? 'center' : 'left',
        wrapText: true,
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FFFFFFFF' : soft } };
      setThinBorders(cell);
    });
    if (row.eventDateValue) excelRow.getCell(4).numFmt = 'dd/mm/yyyy';
    [9, 10, 11, 12].forEach((column) => { excelRow.getCell(column).numFmt = '[$Bs ]#,##0.00;[Red]-[$Bs ]#,##0.00'; });
    const statusPalette = tonePalette[row.statusTone] ?? tonePalette.muted;
    excelRow.getCell(7).font = { name: 'Calibri', size: 9, bold: true, color: { argb: statusPalette.fg } };
    excelRow.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusPalette.bg } };
  });
  const lastRow = Math.max(10, 10 + rows.length);
  sheet.autoFilter = { from: { row: 10, column: 1 }, to: { row: lastRow, column: 14 } };
  sheet.pageSetup.printTitlesRow = '1:10';
  sheet.pageSetup.printArea = `A1:N${lastRow}`;
  sheet.headerFooter.oddFooter = '&LEl Copetín · Órdenes de Servicio&C&P de &N&RDocumento interno';

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `reporte-ordenes-${report.rangeFileLabel || 'todo-el-periodo'}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

function ServiceOrdersSection({
  quotes = [],
  contracts = [],
  hiddenContracts = [],
  rentals = [],
  deliveries = [],
  supplierBundle = { suppliers: [], quotes: [], loans: [] },
  generatedReports = [],
  cashMovements = [],
  clients = [],
  items = [],
  combos = [],
  vehicles = [],
  drivers = [],
  users = [],
  personnelBundle = { employees: [] },
  settings = null,
  currentUser = null,
  readOnly = false,
  formatDate,
  formatDateTime,
  formatBs,
  onCreateQuote,
  onUpdateQuote,
  onRemoveQuote,
  onApproveQuote: _onApproveQuote,
  onUpdateOrderOperational,
  onCancelOrderContract,
  onCreateContract,
  onUpdateContract,
  onSetContractFinalized,
  onUpdateEconomicLedger,
  onRemoveContract,
  onRestoreContract,
  onRevertContractToQuote,
  onCreateContractFromOrder,
  onCreateAndApproveContract,
  onApproveContract,
  onGenerateOrderDocuments,
  onCreateSupplier,
  onCreateSupplierQuote: _onCreateSupplierQuote,
  onPrintCashMovementReceipt,
  onUpdateSettings,
  onOpenTransportModule,
  onOpenInventoryModule,
  onOpenReportsModule,
  onOpenImage,
  onPrintContractDocument,
  onPrintRouteSheetDocument,
  onPrepareEditorData,
  canAccessInventory = true,
  canAccessTransport = true,
}) {
  const [activeView, setActiveView] = useState('contracts');
  const [orderFilter, setOrderFilter] = useState('all');
  const [orderQuery, setOrderQuery] = useState('');
  const [quoteFilter, setQuoteFilter] = useState('all');
  const [quoteQuery, setQuoteQuery] = useState('');
  const [contractFilter, setContractFilter] = useState('all');
  const [contractQuery, setContractQuery] = useState('');
  const deferredContractQuery = useDeferredValue(contractQuery);
  const [visibleContractLimit, setVisibleContractLimit] = useState(CONTRACT_RENDER_BATCH_SIZE);
  const [isMobileCommercialLayout, setIsMobileCommercialLayout] = useState(false);
  const [contractDateFrom, setContractDateFrom] = useState(DEFAULT_CONTRACT_WEEK_RANGE.from);
  const [contractDateTo, setContractDateTo] = useState(DEFAULT_CONTRACT_WEEK_RANGE.to);
  const [contractColumnFilters, setContractColumnFilters] = useState(() => ({ ...DEFAULT_ORDER_TABLE_FILTERS }));
  const [contractSort, setContractSort] = useState({ key: '', direction: '' });
  const [contractColumnMenu, setContractColumnMenu] = useState(null);
  const [seenCounts, setSeenCounts] = useState(readSeenCounts);

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(buildEmptyDraft('quote'));
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [isClientSearchOpen, setIsClientSearchOpen] = useState(false);
  const [activeClientResultIndex, setActiveClientResultIndex] = useState(0);
  const [quickItemDraft, setQuickItemDraft] = useState(buildEmptyQuickItemDraft);
  const [isQuickItemOpen, setIsQuickItemOpen] = useState(false);
  const [isCourtesyMode, setIsCourtesyMode] = useState(false);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [serviceDraft, setServiceDraft] = useState(buildEmptyServiceDraft);
  const [editingServiceId, setEditingServiceId] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('all');
  const [catalogVisibleCount, setCatalogVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [activeScheduleDayId, setActiveScheduleDayId] = useState('');
  const [isWizardSummaryCollapsed, setIsWizardSummaryCollapsed] = useState(false);
  const [comboConfigurator, setComboConfigurator] = useState(null);
  const [itemObservationModal, setItemObservationModal] = useState(null);
  const [availabilityDetailModal, setAvailabilityDetailModal] = useState(null);
  const [comboAvailabilityDetailModal, setComboAvailabilityDetailModal] = useState(null);
  const [draggedSelectedItemKey, setDraggedSelectedItemKey] = useState('');
  const [formError, setFormError] = useState('');
  const [actionFeedback, setActionFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatusMessage, setSubmitStatusMessage] = useState('');
  const [contractActionStatus, setContractActionStatus] = useState('');
  const [finalizedContractOverrides, setFinalizedContractOverrides] = useState(() => new Map());
  const [finalizingContractIds, setFinalizingContractIds] = useState(() => new Set());
  const [currentStep, setCurrentStep] = useState(0);
  const [documentsOrder, setDocumentsOrder] = useState(null);
  const deferredDocumentsOrder = useDeferredValue(documentsOrder);
  const [documentsFullContract, setDocumentsFullContract] = useState(null);
  const [documentsHistoryLoading, setDocumentsHistoryLoading] = useState(false);
  const [documentsHistoryError, setDocumentsHistoryError] = useState('');
  const [contractEconomicsTarget, setContractEconomicsTarget] = useState(null);
  const [contractEconomicsFullRental, setContractEconomicsFullRental] = useState(null);
  const [contractEconomicsContextMovements, setContractEconomicsContextMovements] = useState([]);
  const [isLoadingContractEconomics, setIsLoadingContractEconomics] = useState(false);
  const [contractEconomicsError, setContractEconomicsError] = useState('');
  const [returnChargeEditIssue, setReturnChargeEditIssue] = useState(null);
  const [returnChargeEditDraft, setReturnChargeEditDraft] = useState({ damagedUnitChargeBs: '', missingUnitChargeBs: '' });
  const [isSavingReturnCharge, setIsSavingReturnCharge] = useState(false);
  const [returnChargeEditError, setReturnChargeEditError] = useState('');
  const [contractEconomicsCollectionDraft, setContractEconomicsCollectionDraft] = useState({
    target: 'rental',
    targets: ['rental'],
    amountBs: '',
    paymentMethod: 'efectivo',
    paymentAccount: '',
    receipt: '',
    note: '',
  });
  const [contractEconomicsGuaranteeRefundDraft, setContractEconomicsGuaranteeRefundDraft] = useState({
    source: 'guarantee',
    amountBs: '',
    paymentMethod: 'efectivo',
    paymentAccount: '',
    receipt: '',
    note: '',
  });
  const [contractEconomicsLedgerDraft, setContractEconomicsLedgerDraft] = useState({
    date: getInputDate(new Date()),
    paymentMethod: 'efectivo',
    paymentAccount: '',
  });
  const [contractEconomicsLedgerEditingId, setContractEconomicsLedgerEditingId] = useState(null);
  const [contractEconomicNotePreview, setContractEconomicNotePreview] = useState(null);
  const [contractEconomicNoteDraft, setContractEconomicNoteDraft] = useState('');
  const [contractEconomicNoteEditingId, setContractEconomicNoteEditingId] = useState(null);
  const [contractEconomicNoteError, setContractEconomicNoteError] = useState('');
  const [isSavingContractEconomicNote, setIsSavingContractEconomicNote] = useState(false);
  const [contractNoteOverrides, setContractNoteOverrides] = useState(() => new Map());
  const contractEconomicsLedgerTypeRef = useRef(null);
  const contractEconomicsLedgerAmountRef = useRef(null);
  const contractEconomicsLedgerNoteRef = useRef(null);
  const [isSavingContractEconomicsCollection, setIsSavingContractEconomicsCollection] = useState(false);
  const [isSavingContractEconomicsGuaranteeRefund, setIsSavingContractEconomicsGuaranteeRefund] = useState(false);
  const [isSavingContractEconomicsLedger, setIsSavingContractEconomicsLedger] = useState(false);
  const [economicReceiptImageBusyId, setEconomicReceiptImageBusyId] = useState(null);
  const [generatingDepositReceiptId, setGeneratingDepositReceiptId] = useState(null);
  const [ledgerDateEditEntry, setLedgerDateEditEntry] = useState(null);
  const [ledgerDateEditValue, setLedgerDateEditValue] = useState('');
  const [ledgerDateEditError, setLedgerDateEditError] = useState('');
  const [receiptEditMovement, setReceiptEditMovement] = useState(null);
  const [receiptEditDraft, setReceiptEditDraft] = useState({
    receiptCode: '',
    receiptCustomerName: '',
    createdAt: '',
    receiptDetail: '',
    notes: '',
    paymentMethod: 'efectivo',
    paymentAccount: '',
  });
  const [receiptEditError, setReceiptEditError] = useState('');
  const [isSavingReceiptEdit, setIsSavingReceiptEdit] = useState(false);
  const [isResettingContractEconomics, setIsResettingContractEconomics] = useState(false);
  const [economicResetPendingByContract, setEconomicResetPendingByContract] = useState({});
  const [economicResetLedgerByContract, setEconomicResetLedgerByContract] = useState({});
  const [activeEconomicResetLedger, setActiveEconomicResetLedger] = useState(null);
  const [recentEconomicCashMovements, setRecentEconomicCashMovements] = useState([]);
  const [quoteToDelete, setQuoteToDelete] = useState(null);
  const [contractToRevert, setContractToRevert] = useState(null);
  const [orderToCancel, setOrderToCancel] = useState(null);
  const [zeroInitialPaymentConfirmation, setZeroInitialPaymentConfirmation] = useState(null);
  const [supplierPlanRemovalConfirmation, setSupplierPlanRemovalConfirmation] = useState(null);
  const cancelReasonRef = useRef(null);
  const [operationalOrder, setOperationalOrder] = useState(null);
  const [operationalDraft, setOperationalDraft] = useState({ inventoryNote: '', transportNote: '' });
  const [documentPreview, setDocumentPreview] = useState(null);
  const [isExportingOrdersReport, setIsExportingOrdersReport] = useState(false);
  const documentPreviewCacheRef = useRef(new Map());
  const documentPreviewUrlRef = useRef('');
  const deferredItemSearch = useDeferredValue(itemSearch);
  const [quoteApprovalPreview, setQuoteApprovalPreview] = useState(null);
  const [whatsAppModal, setWhatsAppModal] = useState(null);
  const [supplierCoverageModal, setSupplierCoverageModal] = useState(null);
  const [availabilityContractDetail, setAvailabilityContractDetail] = useState(null);
  const [clientPendingDetail, setClientPendingDetail] = useState(null);
  const [supplierCoverageDraft, setSupplierCoverageDraft] = useState(buildEmptySupplierCoverageDraft);
  const [supplierCoverageError, setSupplierCoverageError] = useState('');
  const [isSavingSupplierCoverage, setIsSavingSupplierCoverage] = useState(false);
  const [numberingEditorOpen, setNumberingEditorOpen] = useState(false);
  const [numberingDraft, setNumberingDraft] = useState({ currentCode: '', followingCode: '' });
  const [numberingError, setNumberingError] = useState('');
  const [isSavingNumbering, setIsSavingNumbering] = useState(false);

  const [menuState, setMenuState] = useState(null);
  const menuRef = useRef(null);
  const menuPreviewRef = useRef(null);
  const contractSearchInputRef = useRef(null);
  const contractSearchDebounceRef = useRef(null);
  const submitLockRef = useRef(false);
  const [supplierFulfillmentDraftByItem, setSupplierFulfillmentDraftByItem] = useState({});
  const supplierCoverageHydrationKeyRef = useRef('');
  const removedSupplierCoverageIdsRef = useRef(new Set());

  useEffect(() => {
    if (!contractColumnMenu) return undefined;
    const closeMenu = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && event.target.closest?.('.orders-column-filter-popover, .orders-column-filter-trigger')) return;
      setContractColumnMenu(null);
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [contractColumnMenu]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const updateLayout = () => setIsMobileCommercialLayout(mediaQuery.matches);
    updateLayout();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateLayout);
      return () => mediaQuery.removeEventListener('change', updateLayout);
    }
    mediaQuery.addListener(updateLayout);
    return () => mediaQuery.removeListener(updateLayout);
  }, []);

  useEffect(() => {
    if (documentPreview?.blobUrl) return undefined;

    const previousUrl = documentPreviewUrlRef.current;
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      documentPreviewUrlRef.current = '';
    }

    if (!documentPreview?.html) return undefined;

    const blob = new Blob([documentPreview.html], { type: 'text/html;charset=utf-8' });
    const nextUrl = URL.createObjectURL(blob);
    documentPreviewUrlRef.current = nextUrl;
    setDocumentPreview((current) => (
      current?.html === documentPreview.html
        ? { ...current, blobUrl: nextUrl }
        : current
    ));

    return () => {
      if (documentPreviewUrlRef.current === nextUrl) {
        URL.revokeObjectURL(nextUrl);
        documentPreviewUrlRef.current = '';
      }
    };
  }, [documentPreview?.blobUrl, documentPreview?.html]);

  const closeDocumentPreview = () => {
    setDocumentPreview(null);
  };

  useEffect(() => () => {
    documentPreviewCacheRef.current.forEach((entry) => {
      if (entry?.blobUrl) URL.revokeObjectURL(entry.blobUrl);
    });
    documentPreviewCacheRef.current.clear();
  }, []);

  const invalidateContractDocumentPreviewCache = useCallback((contractLike) => {
    const identifiers = new Set([
      contractLike?.id,
      contractLike?.contractId,
      contractLike?.contractCode,
      contractLike?.orderCode,
      contractLike?.rentalId,
    ].map((value) => String(value ?? '').trim()).filter(Boolean));
    if (!identifiers.size) return;

    documentPreviewCacheRef.current.forEach((entry, key) => {
      if (!String(key).startsWith('contract:')) return;
      const matches = [...identifiers].some((identifier) => String(key).includes(identifier));
      if (!matches) return;
      if (entry?.blobUrl) URL.revokeObjectURL(entry.blobUrl);
      documentPreviewCacheRef.current.delete(key);
    });

    setDocumentPreview((current) => {
      if (current?.kind !== 'contract') return current;
      const currentKey = String(current?.cacheKey ?? '');
      const currentOrderCode = String(current?.orderCode ?? '').trim();
      const matches = [...identifiers].some((identifier) => (
        currentKey.includes(identifier)
        || currentOrderCode === identifier
      ));
      if (!matches) return current;
      if (current?.blobUrl) URL.revokeObjectURL(current.blobUrl);
      return null;
    });
  }, []);

  const canChooseResponsibles = isDeveloper(currentUser);
  const canViewHiddenContracts = isDeveloper(currentUser);
  const canRemoveCancelledContract = isDeveloper(currentUser) && Boolean(onRemoveContract);
  const canManageContractEconomicLedger = !readOnly;
  const contractNumberingInfo = useMemo(() => {
    const numbering = settings?.numbering ?? {};
    const prefix = String(numbering.contractPrefix ?? '');
    const configuredNext = Math.max(1, Math.trunc(Number(numbering.contractNext ?? 1)));
    const occupiedCodes = new Set();
    const matchingNumbers = [];
    const addCode = (code) => {
      const normalizedCode = String(code ?? '').trim();
      if (!normalizedCode) return;
      occupiedCodes.add(normalizedCode);
      if (parseCommercialCodePrefix(normalizedCode) === prefix) {
        const numericPart = parseCommercialCodeNumericPart(normalizedCode);
        if (numericPart) matchingNumbers.push(numericPart);
      }
    };

    contracts.forEach((contract) => addCode(contract?.contractCode));
    rentals
      .filter((rental) => rental && !rental.deletedAt && rental.status !== 'cancelled')
      .forEach((rental) => addCode(rental?.contractCode));

    let next = configuredNext;
    let attempts = 0;
    while (attempts < 100000 && occupiedCodes.has(formatCommercialDocumentCode(prefix, next))) {
      next += 1;
      attempts += 1;
    }

    const latest = matchingNumbers.length > 0 ? Math.max(...matchingNumbers) : null;
    return {
      prefix,
      configuredNext,
      next,
      nextCode: formatCommercialDocumentCode(prefix, next),
      followingCode: formatCommercialDocumentCode(prefix, next + 1),
      latestCode: latest ? formatCommercialDocumentCode(prefix, latest) : '',
      nextAfterLatestCode: latest ? formatCommercialDocumentCode(prefix, latest + 1) : '',
    };
  }, [contracts, rentals, settings]);

  const canEditContractNumbering = Boolean(onUpdateSettings) && isDeveloper(currentUser);

  const openContractNumberingEditor = () => {
    if (!canEditContractNumbering) return;
    setNumberingDraft({
      currentCode: contractNumberingInfo.nextCode,
      followingCode: contractNumberingInfo.followingCode,
    });
    setNumberingError('');
    setNumberingEditorOpen(true);
  };

  const saveContractNumbering = async () => {
    if (!canEditContractNumbering) return;
    const currentCode = String(numberingDraft.currentCode ?? '').trim();
    const followingCode = String(numberingDraft.followingCode ?? '').trim();
    const currentNumber = parseCommercialCodeNumericPart(currentCode);
    const followingNumber = parseCommercialCodeNumericPart(followingCode);
    const currentPrefix = parseCommercialCodePrefix(currentCode);
    const followingPrefix = parseCommercialCodePrefix(followingCode);

    if (!currentNumber || !followingNumber) {
      setNumberingError('Ambos codigos deben terminar en un numero.');
      return;
    }
    if (currentPrefix !== followingPrefix) {
      setNumberingError('Actual y siguiente deben usar el mismo prefijo.');
      return;
    }
    if (followingNumber !== currentNumber + 1) {
      setNumberingError('El siguiente debe ser exactamente el numero posterior al actual.');
      return;
    }

    setIsSavingNumbering(true);
    setNumberingError('');
    try {
      await onUpdateSettings?.({
        numbering: {
          contractPrefix: currentPrefix,
          contractNext: currentNumber,
        },
      });
      setNumberingEditorOpen(false);
      setActionFeedback(`Numeracion de contratos actualizada: actual ${currentCode}, siguiente ${followingCode}.`);
    } catch (requestError) {
      setNumberingError(requestError.message || 'No se pudo actualizar la numeracion.');
    } finally {
      setIsSavingNumbering(false);
    }
  };

  const responsibleOptions = useMemo(() => {
    const entries = [];
    const addOption = (option) => {
      if (!option) return;
      const duplicateKey = normalizeText(option.id || option.name);
      const duplicateName = normalizeText(option.name);
      if (entries.some((entry) => normalizeText(entry.id) === duplicateKey || normalizeText(entry.name) === duplicateName)) return;
      entries.push(option);
    };

    addOption(buildResponsibleOption({
      id: currentUser?.id ?? currentUser?.username,
      name: currentUser?.fullName ?? currentUser?.name ?? currentUser?.username,
      role: currentUser ? getUserDisplayRole(currentUser) : 'Operacion',
      source: 'current',
    }));

    users
      .filter((user) => String(user?.status ?? 'active') !== 'suspended')
      .forEach((user) => addOption(buildResponsibleOption({
        id: user.id ?? user.username,
        name: user.fullName ?? user.name ?? user.username,
        role: getUserDisplayRole(user),
        source: 'user',
      })));

    (personnelBundle?.employees ?? [])
      .filter((employee) => String(employee?.status ?? 'active') === 'active')
      .forEach((employee) => addOption(buildResponsibleOption({
        id: employee.id ?? employee.employeeCode ?? employee.fullName,
        name: employee.fullName ?? employee.name,
        role: employee.position || employee.department || 'Personal',
        source: 'personnel',
      })));

    return entries.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [currentUser, personnelBundle?.employees, users]);

  const currentResponsibleId = String(currentUser?.id ?? currentUser?.username ?? '').trim();
  const fallbackResponsibleId = responsibleOptions.find((option) => (
    option.source === 'current'
    || (currentResponsibleId && String(option.id) === currentResponsibleId)
  ))?.id ?? responsibleOptions[0]?.id ?? '';

  useEffect(() => {
    if (!modalOpen || !canChooseResponsibles) return;
    setDraft((current) => {
      if (Array.isArray(current.responsibleIds) && current.responsibleIds.length > 0) return current;
      if (!fallbackResponsibleId) return current;
      return { ...current, responsibleIds: [fallbackResponsibleId] };
    });
  }, [canChooseResponsibles, fallbackResponsibleId, modalOpen]);

  const beginSubmit = () => {
    if (submitLockRef.current) return false;
    submitLockRef.current = true;
    setIsSubmitting(true);
    setSubmitStatusMessage('');
    return true;
  };

  const endSubmit = () => {
    submitLockRef.current = false;
    setIsSubmitting(false);
    setSubmitStatusMessage('');
  };

  useEffect(() => {
    setCatalogVisibleCount(CATALOG_PAGE_SIZE);
    setCatalogModalOpen(false);
  }, [itemCategoryFilter, itemSearch, modalOpen]);

  useEffect(() => {
    if (!menuState) return undefined;

    const closeOnOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuState(null);
      }
    };

    const closeOnScrollOrResize = () => setMenuState(null);

    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('scroll', closeOnScrollOrResize, true);
    window.addEventListener('resize', closeOnScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('scroll', closeOnScrollOrResize, true);
      window.removeEventListener('resize', closeOnScrollOrResize);
    };
  }, [menuState]);

  useEffect(() => {
    if (!contractEconomicsTarget) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, [contractEconomicsTarget]);

  const deliveriesByOrderReference = useMemo(() => {
    const map = new Map();
    deliveries.forEach((entry) => {
      [entry?.rentalId, entry?.orderCode]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .forEach((key) => {
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(entry);
        });
    });
    map.forEach((rows) => rows.sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate)));
    return map;
  }, [deliveries]);

  const orderRows = useMemo(() => {
    const contractByRentalId = new Map();
    const contractByOrderCode = new Map();
    contracts.forEach((contract) => {
      if (contract?.rentalId && !contractByRentalId.has(contract.rentalId)) {
        contractByRentalId.set(contract.rentalId, contract);
      }
      const normalizedOrderCode = String(contract?.orderCode ?? '').trim();
      if (normalizedOrderCode && !contractByOrderCode.has(normalizedOrderCode)) {
        contractByOrderCode.set(normalizedOrderCode, contract);
      }
    });

    return rentals.map((rental) => {
      const orderCode = String(rental.orderCode ?? rental.id).trim();
      const linkedDeliveriesById = new Map();
      [...(deliveriesByOrderReference.get(String(rental.id)) ?? []),
        ...(deliveriesByOrderReference.get(orderCode) ?? [])]
        .forEach((entry) => linkedDeliveriesById.set(String(entry.id), entry));
      const linkedDeliveries = [...linkedDeliveriesById.values()]
        .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
      const delivery = linkedDeliveries[0] ?? null;
      const firstItem = rental.items?.[0];
      const firstItemName = firstItem?.itemName ?? firstItem?.name ?? rental.firstItemName ?? '';
      const itemsCount = Number.isFinite(Number(rental.itemsCount))
        ? Number(rental.itemsCount)
        : (rental.items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
      const linkedContract = contractByRentalId.get(rental.id) ?? contractByOrderCode.get(orderCode) ?? null;
      const contractStatus = linkedContract?.status ?? 'sin_contrato';
      const contractMeta = CONTRACT_STATUS_META[contractStatus];
      const operational = rental.operational ?? {};
      const effectiveOperationalState = getEffectiveRentalOperationalState(rental);
      const inventoryStatus = effectiveOperationalState.inventoryStatus;
      const transportStatus = effectiveOperationalState.transportStatus;
      const effectiveRental = effectiveOperationalState.rentalStatus === rental.status
        ? rental
        : { ...rental, status: effectiveOperationalState.rentalStatus };
      const accountingStatus = rental.accountingStatus ?? rental.payment?.status ?? '';
      const pendingPaymentBs = Number(rental?.payment?.pendingPaymentBs ?? rental?.totals?.pendingPaymentBs ?? 0);
      const pendingCollectionBs = rental.status === 'returned'
        ? getEffectiveReturnedPendingCollectionBs(rental, linkedContract)
        : pendingPaymentBs;

      return {
        id: rental.id,
        rentalId: rental.id,
        rentalStatus: effectiveRental.status ?? '',
        orderCode,
        createdAt: rental.createdAt ?? rental.rentalAt,
        responsibleName: getResponsibleDisplayName(linkedContract ?? rental),
        responsibleRole: getResponsibleDisplayRole(linkedContract ?? rental),
        client: rental.customerName,
        customerPhone: rental.customerPhone ?? rental.phone ?? '',
        clientMeta: rental.customerPhone ? `Cel: ${rental.customerPhone}` : 'Sin telefono',
        event: firstItemName ? `Servicio de ${firstItemName}` : 'Servicio de alquiler',
        eventMeta: `${itemsCount} items`,
        serviceDate: rental.dueDate,
        serviceTime: rental.dueTime ? `${rental.dueTime} (max)` : '-',
        deliveryAt: delivery?.scheduledDate ?? rental.dueDate,
        deliveryMeta: delivery
          ? `${delivery.address ?? 'Direccion pendiente'} ${delivery.city ?? ''}`.trim()
          : 'Pendiente de ruta',
        status: toOrderStatus(effectiveRental, delivery),
        totalBs: Number(rental?.totals?.totalBs ?? 0),
        refundBs: Number(rental?.refundBs ?? rental?.returnSettlement?.refundBs ?? 0),
        accountingStatus,
        pendingPaymentBs,
        pendingCollectionBs,
        returnSettlement: rental.returnSettlement ?? null,
        cancelledAt: rental.cancelledAt ?? null,
        cancellationPenaltyPercent: Number(rental.cancellationPenaltyPercent ?? linkedContract?.cancellationPenaltyPercent ?? 0),
        cancellationPenaltyBs: Number(rental.cancellationPenaltyBs ?? linkedContract?.cancellationPenaltyBs ?? 0),
        cancellationReason: rental.cancellationReason ?? linkedContract?.cancellationReason ?? '',
        deliveryIds: linkedDeliveries.map((entry) => String(entry.id)),
        contractId: linkedContract?.id ?? null,
        contractCode: linkedContract?.contractCode ?? null,
        contractStatus,
        contractClassName: linkedContract ? `contract-${contractMeta?.className ?? 'pending'}` : 'contract-missing',
        contractLabel: linkedContract
          ? `${linkedContract.contractCode} · ${contractMeta?.label ?? 'Contrato'}`
          : 'Sin contrato',
        inventoryStatus,
        transportStatus,
        returnReview: operational.returnReview ?? null,
        clientPendingPickup: operational.clientPendingPickup ?? null,
        inventoryNote: operational.inventoryNote ?? '',
        transportNote: operational.transportNote ?? '',
        inventorySentAt: operational.inventorySentAt ?? null,
        transportSentAt: operational.transportSentAt ?? null,
        inventoryConfirmedAt: operational.inventoryConfirmedAt ?? null,
        transportConfirmedAt: operational.transportConfirmedAt ?? null,
        items: rental.items ?? [],
        supplierFulfillmentPlan: Array.isArray(linkedContract?.supplierFulfillmentPlan) && linkedContract.supplierFulfillmentPlan.length > 0
          ? linkedContract.supplierFulfillmentPlan
          : Array.isArray(rental.supplierFulfillmentPlan)
            ? rental.supplierFulfillmentPlan
            : [],
      };
    });
  }, [contracts, deliveriesByOrderReference, rentals]);

  const documentsByOrderId = useMemo(() => {
    const bySourceId = new Map();
    generatedReports.forEach((report) => {
      const sourceId = String(report?.sourceId ?? '').trim();
      if (!sourceId) return;
      if (!bySourceId.has(sourceId)) bySourceId.set(sourceId, []);
      bySourceId.get(sourceId).push(report);
    });

    const map = new Map();
    orderRows.forEach((row) => {
      const docsById = new Map();
      const addDocs = (docs = []) => docs.forEach((doc) => docsById.set(String(doc.id ?? `${doc.name}-${doc.generatedAt}`), doc));
      addDocs(bySourceId.get(String(row.rentalId ?? '').trim()));
      (row.deliveryIds ?? []).forEach((deliveryId) => addDocs(bySourceId.get(String(deliveryId ?? '').trim())));
      map.set(
        row.id,
        Array.from(docsById.values()).sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt)),
      );
    });
    return map;
  }, [generatedReports, orderRows]);

  const orderRowsWithMeta = useMemo(
    () => orderRows.map((row) => ({ ...row, documents: documentsByOrderId.get(row.id) ?? [] })),
    [documentsByOrderId, orderRows],
  );

  const orderCounts = useMemo(() => {
    const base = { all: orderRowsWithMeta.length, pending: 0, prep: 0, transport: 0, completed: 0, cancelled: 0 };
    orderRowsWithMeta.forEach((row) => {
      base[row.status] = (base[row.status] ?? 0) + 1;
      if (row.status === 'charged' || row.status === 'closed_pending') {
        base.completed += 1;
      }
    });
    return base;
  }, [orderRowsWithMeta]);

  const filteredOrders = useMemo(() => {
    const text = normalizeText(orderQuery);
    return orderRowsWithMeta.filter((row) => {
      if (
        orderFilter !== 'all'
        && !(
          orderFilter === 'completed'
          && ['completed', 'charged', 'closed_pending'].includes(row.status)
        )
        && row.status !== orderFilter
      ) return false;
      if (!text) return true;
      return (
        normalizeText(row.orderCode).includes(text)
        || normalizeText(row.client).includes(text)
        || normalizeText(row.event).includes(text)
      );
    });
  }, [orderFilter, orderQuery, orderRowsWithMeta]);

  const quoteRows = useMemo(() => {
    return quotes.map((quote) => {
      const itemsCount = (quote.items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
      const status = QUOTE_STATUS_META[quote.status] ? quote.status : 'borrador';
      return {
        ...quote,
        status,
        itemsCount,
        responsibleName: getResponsibleDisplayName(quote),
        responsibleRole: getResponsibleDisplayRole(quote),
        totalBs: Number(quote?.totals?.totalBs ?? 0),
      };
    });
  }, [quotes]);

  const quoteCounts = useMemo(() => {
    const base = { all: quoteRows.length, borrador: 0, enviada: 0, aprobada: 0, rechazada: 0, vencida: 0 };
    quoteRows.forEach((row) => {
      base[row.status] = (base[row.status] ?? 0) + 1;
    });
    return base;
  }, [quoteRows]);

  const filteredQuotes = useMemo(() => {
    const text = normalizeText(quoteQuery);
    return quoteRows.filter((row) => {
      if (quoteFilter !== 'all' && row.status !== quoteFilter) return false;
      if (!text) return true;
      return (
        normalizeText(row.quoteCode).includes(text)
        || normalizeText(row.customerName).includes(text)
        || normalizeText(row.customerPhone).includes(text)
        || normalizeText(row.customerReferencePhone).includes(text)
        || normalizeText(row.eventType).includes(text)
      );
    });
  }, [quoteFilter, quoteQuery, quoteRows]);

  const orderByContractId = useMemo(() => {
    const map = new Map();
    orderRowsWithMeta.forEach((order) => {
      if (order.contractId) map.set(String(order.contractId), order);
    });
    return map;
  }, [orderRowsWithMeta]);

  const effectiveCashMovements = useMemo(() => {
    const byId = new Map();
    [...cashMovements, ...contractEconomicsContextMovements, ...recentEconomicCashMovements].forEach((movement) => {
      const key = String(movement?.id ?? movement?.receiptCode ?? '').trim();
      if (key) byId.set(key, movement);
    });
    return [...byId.values()];
  }, [cashMovements, contractEconomicsContextMovements, recentEconomicCashMovements]);

  const returnedGuaranteeAmountsByReference = useMemo(() => {
    const amountsByReference = new Map();
    effectiveCashMovements.forEach((movement) => {
      if (isVoidedCashMovement(movement) || movement?.deletedAt) return;
      const tag = normalizeText(movement?.accountingTag);
      const category = normalizeText(movement?.category);
      const type = normalizeText(movement?.type);
      const isConfirmedGuaranteeReturn =
        tag === 'guarantee_refund'
        || category === 'garantia_devuelta_manual'
        || type === 'egreso_devolucion_garantia_manual';
      if (!isConfirmedGuaranteeReturn) return;
      const amountBs = Math.abs(getCashMovementAmount(movement));
      if (amountBs <= 0.009) return;
      new Set([
        movement?.linkedContractId,
        movement?.linkedRentalId,
        movement?.linkedOrderCode,
        movement?.contractCode,
        movement?.reference,
        movement?.sourceId,
      ].map(normalizeText).filter(Boolean)).forEach((value) => {
        const normalized = normalizeText(value);
        amountsByReference.set(normalized, Number(((amountsByReference.get(normalized) ?? 0) + amountBs).toFixed(2)));
      });
    });
    return amountsByReference;
  }, [effectiveCashMovements]);

  const collectionMovementIndex = useMemo(() => {
    const movementsByReference = new Map();
    const looseTextMovements = [];

    effectiveCashMovements.forEach((movement, index) => {
      if (isVoidedCashMovement(movement)) return;

      const movementType = normalizeText(movement?.type);
      const category = normalizeText(movement?.category);
      const tag = normalizeText(movement?.accountingTag);
      const isGuaranteeMovement = tag.includes('guarantee') || category.includes('garantia') || movementType.includes('garantia');
      const cashBoxType = normalizeText(movement?.cashBoxType);
      const receiptCode = String(movement?.receiptCode ?? movement?.receipt ?? '').trim();
      const isBigCash = ['big_cash', 'caja_grande', 'cajagrande'].includes(cashBoxType);
      const isIncome = movementType.includes('ingreso')
        || movementType.includes('cobro')
        || category === 'cobro_contrato';
      const isCollection = tag === 'contract_economic_collection'
        || category === 'cobro_contrato'
        || movementType === 'ingreso_alquiler'
        || (Boolean(receiptCode) && isBigCash && isIncome);
      if (isGuaranteeMovement || !isCollection) return;

      const amountBs = Math.max(0, getCashMovementAmount(movement));
      const indexedMovement = {
        id: String(movement?.id ?? `movement-${index}`),
        amountBs,
        accountingTag: movement?.accountingTag ?? '',
        category: movement?.category ?? '',
        contractAllocationBs: Math.max(0, toMoneyNumber(movement?.contractAllocationBs)),
        rawMovement: movement,
      };
      [
        movement?.linkedContractId,
        movement?.linkedRentalId,
        movement?.linkedOrderCode,
        movement?.contractId,
        movement?.rentalId,
        movement?.orderCode,
        movement?.contractCode,
        movement?.reference,
        movement?.sourceId,
      ].map(normalizeText).filter(Boolean).forEach((key) => {
        if (!movementsByReference.has(key)) movementsByReference.set(key, []);
        movementsByReference.get(key).push(indexedMovement);
      });

      const hasStructuredReference = [
        movement?.linkedContractId,
        movement?.linkedRentalId,
        movement?.linkedOrderCode,
        movement?.contractId,
        movement?.rentalId,
        movement?.orderCode,
        movement?.contractCode,
        movement?.sourceId,
        movement?.reference,
      ].some((value) => normalizeText(value));

      // Solo los movimientos historicos realmente sueltos pueden asociarse por
      // texto. Un movimiento vinculado a un contrato eliminado con el mismo
      // numero visible no debe contaminar el contrato activo.
      const notes = [movement?.notes, movement?.description].map(normalizeText).filter(Boolean).join(' ');
      if (notes && !hasStructuredReference) {
        looseTextMovements.push({ ...indexedMovement, notes });
      }
    });

    return { movementsByReference, looseTextMovements };
  }, [effectiveCashMovements]);

  const activeRentalByReference = useMemo(() => {
    const map = new Map();
    rentals.forEach((rental) => {
      if (rental?.deletedAt) return;
      [
        rental?.id,
        rental?.contractId,
        rental?.contractCode,
        rental?.orderCode,
      ].map(normalizeText).filter(Boolean).forEach((key) => {
        if (!map.has(key)) map.set(key, rental);
      });
    });
    return map;
  }, [rentals]);

  const buildContractRows = useCallback((sourceContracts) => {
    return sourceContracts.map((contract) => {
      const itemsCount = Number.isFinite(Number(contract.itemsCount))
        ? Number(contract.itemsCount)
        : (contract.items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
      const status = CONTRACT_STATUS_META[contract.status] ? contract.status : 'borrador';
      const deletionRevision = Array.isArray(contract?.revisionHistory)
        ? contract.revisionHistory.slice().reverse().find((revision) => (
          Array.isArray(revision?.changes)
          && revision.changes.some((change) => normalizeText(change).includes('contrato eliminado'))
        ))
        : null;
      const linkedOrder = orderByContractId.get(String(contract.id)) ?? null;
      // El color operativo del contrato debe reflejar exclusivamente el estado
      // vigente en Movimientos. El estado general del alquiler puede quedar
      // historicamente desincronizado y no confirma por si solo una devolucion.
      const inventoryStatus = normalizeText(linkedOrder?.inventoryStatus);
      // "Devuelto" conserva la evidencia visual de ambas etapas: primero salio
      // (naranja) y despues volvio (celeste).
      const isSent = ['salio', 'devuelto'].includes(inventoryStatus);
      const isReturned = inventoryStatus === 'devuelto';
      const clientPendingPickup = linkedOrder?.clientPendingPickup?.active ? linkedOrder.clientPendingPickup : null;
      const clientPendingUnits = (Array.isArray(clientPendingPickup?.items) ? clientPendingPickup.items : [])
        .reduce((sum, line) => sum + Math.max(0, Number(line?.pendingQty ?? 0)), 0);
      const hasClientPending = clientPendingUnits > 0;
      const economicLedger = (Array.isArray(contract?.economicLedger) ? contract.economicLedger : [])
        .map(normalizeEconomicLedgerEntry);
      const economicInternalNotes = getEconomicInternalNotes({ economicLedger });
      const hasEconomicLedger = economicLedger
        .some((entry) => toMoneyNumber(entry?.amountBs) > 0);
      const guaranteeBs = Number(contract?.totals?.guaranteeBs ?? 0);
      const servicesBs = (Array.isArray(contract?.services) ? contract.services : [])
        .reduce((sum, service) => sum + toMoneyNumber(service?.lineTotalBs), 0);
      const transportBs = toMoneyNumber(contract?.totals?.deliveryFeeBs ?? contract?.deliveryFeeBs);
      const storedTotalBs = Number(contract?.totals?.totalBs ?? 0);
      const storedItemsNetSubtotalBs = toMoneyNumber(
        contract?.totals?.itemsNetSubtotalBs ?? contract?.totals?.itemsSubtotalBs,
      );
      const storedDiscountBs = toMoneyNumber(contract?.totals?.discountBs);
      const pricingMode = normalizeText(contract?.pricingPlan?.mode);
      const repairedDailyScheduleTotalBs = pricingMode === 'daily_schedule' && storedItemsNetSubtotalBs > 0
        ? Math.max(
          0,
          Number((storedItemsNetSubtotalBs + servicesBs - storedDiscountBs + transportBs).toFixed(2)),
        )
        : storedTotalBs;
      // Reparación visual conservadora para contratos antiguos donde el plan diario
      // quedó con subtotal previo al subalquiler manual. No altera contratos con
      // pricing por duración ni reduce un total ya mayor/correcto.
      const totalBs = Math.max(storedTotalBs, repairedDailyScheduleTotalBs);
      const rentalTotalBs = Math.max(0, Number((totalBs - servicesBs - transportBs).toFixed(2)));
      const managedTotalBs = Number((rentalTotalBs + guaranteeBs + transportBs + servicesBs).toFixed(2));
      const rowLedgerTotals = economicLedger.reduce((totals, entry) => {
        if (entry.type === 'deposit') totals.receivedBs += toMoneyNumber(entry.amountBs);
        if (entry.type === 'guarantee') totals.guaranteeBs += toMoneyNumber(entry.amountBs);
        if (entry.type === 'charge' && !isCashCollectedDamageLedgerEntry(entry)) totals.chargesBs += toMoneyNumber(entry.amountBs);
        if (entry.type === 'refund' && isEconomicLedgerEntryConfirmedInCash(entry)) {
          totals.refundedBs += toMoneyNumber(entry.amountBs);
          if (entry.refundSource !== 'surplus') totals.guaranteeRefundedBs += toMoneyNumber(entry.amountBs);
        }
        return totals;
      }, {
        receivedBs: 0,
        guaranteeBs: 0,
        chargesBs: 0,
        refundedBs: 0,
        guaranteeRefundedBs: 0,
      });
      const rowLedgerById = new Map(economicLedger.map((entry) => [String(entry.id), entry]));
      const contractReferenceKeys = [
        contract.id,
        contract.rentalId,
        contract.contractCode,
        contract.orderCode,
        linkedOrder?.id,
        linkedOrder?.orderCode,
      ].map(normalizeText).filter(Boolean);
      const contractCashReferences = {
        contractIds: [contract.id, linkedOrder?.contractId],
        rentalIds: [contract.rentalId, linkedOrder?.id, linkedOrder?.rentalId],
        contractCodes: [contract.contractCode, linkedOrder?.contractCode],
        orderCodes: [contract.orderCode, linkedOrder?.orderCode],
        createdAtMs: new Date(
          contract?.approvedAt ?? contract?.contractDate ?? contract?.createdAt ?? 0,
        ).getTime(),
      };
      const linkedCollectionMovements = new Map();
      contractReferenceKeys.forEach((key) => {
        (collectionMovementIndex.movementsByReference.get(key) ?? [])
          .forEach((movement) => linkedCollectionMovements.set(movement.id, movement));
      });
      collectionMovementIndex.looseTextMovements.forEach((movement) => {
        if (cashMovementMatchesContractReferences(movement.rawMovement, contractCashReferences)) {
          linkedCollectionMovements.set(movement.id, movement);
        }
      });
      const collectionRegisteredBs = Number(
        Array.from(linkedCollectionMovements.values())
          .reduce((sum, movement) => sum + getEconomicCommercialCashAmount(movement), 0)
          .toFixed(2),
      );
      const linkedRental = contractReferenceKeys
        .map((key) => activeRentalByReference.get(key))
        .find(Boolean) ?? null;
      const rowChargeTargetBs = Number(totalBs.toFixed(2));
      const rowDepositAllocations = getEconomicDepositAllocations(economicLedger, rowChargeTargetBs);
      const rowLedgerConfirmedRentalBs = economicLedger.reduce((sum, entry) => {
        const isConfirmedInCash = Boolean(
          entry?.isCashRegistered
          || String(entry?.cashMovementId ?? '').trim()
          || String(entry?.cashReceiptCode ?? '').trim(),
        );
        if (entry.type !== 'deposit' || entry.reclassifiedFromPayment || !isConfirmedInCash) return sum;
        const allocation = rowDepositAllocations.get(entry.id);
        return sum + Math.max(0, toMoneyNumber(allocation?.contractBs));
      }, 0);
      const rawGuaranteeStatus = String(contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? '').trim();
      const rowLedgerBackedGuaranteeBs = economicLedger.reduce((sum, entry) => (
        isEconomicGuaranteeBackedByCash(entry, rowLedgerById)
          ? sum + toMoneyNumber(entry.amountBs)
          : sum
      ), 0);
      const rowGuaranteeReserveBs = Math.max(
        rawGuaranteeStatus === 'validado' ? guaranteeBs : 0,
        rowLedgerBackedGuaranteeBs,
      );
      const rowGuaranteeAppliedBs = Math.min(rowGuaranteeReserveBs, rowLedgerTotals.chargesBs);
      const damageChargeBs = Math.max(
        0,
        toMoneyNumber(linkedRental?.returnSettlement?.penaltiesBs ?? linkedRental?.penaltiesBs),
      );
      const damageCollectedBs = Math.max(
        0,
        toMoneyNumber(linkedRental?.returnSettlement?.damageCollectedBs),
        toMoneyNumber(linkedRental?.returnSettlement?.penaltiesCollectedBs),
        toMoneyNumber(linkedRental?.payment?.damageCollectedBs),
        toMoneyNumber(linkedRental?.payment?.penaltiesCollectedBs),
        toMoneyNumber(linkedRental?.payment?.returnChargesCollectedBs),
        toMoneyNumber(linkedRental?.totals?.damageCollectedBs),
        toMoneyNumber(linkedRental?.totals?.penaltiesCollectedBs),
        toMoneyNumber(linkedRental?.totals?.returnChargesCollectedBs),
      );
      const damageCoveredByGuaranteeBs = Math.min(
        damageChargeBs,
        Math.max(
          0,
          rowLedgerTotals.chargesBs,
          toMoneyNumber(linkedRental?.returnSettlement?.discountCoveredByDepositBs),
        ),
      );
      const damagePendingBs = Math.max(
        0,
        Number((damageChargeBs - damageCoveredByGuaranteeBs - damageCollectedBs).toFixed(2)),
      );
      const damageStatus = damageChargeBs <= 0.009
        ? 'none'
        : damagePendingBs <= 0.009
          ? 'paid'
          : 'pending';
      // La columna "Debe" del listado de contratos representa únicamente el
      // saldo comercial del contrato. Los daños/faltantes se consultan y cobran
      // por separado dentro del sector económico.
      const ledgerReceivedForRentalBs = Math.min(
        rowChargeTargetBs,
        Math.max(0, Number(rowLedgerConfirmedRentalBs.toFixed(2))),
      );
      const canonicalLedgerPaidBs = getConfirmedContractLedgerPaidBs(contract, rowChargeTargetBs);
      const paidOnAccountBs = Math.max(
        0,
        Number(collectionRegisteredBs.toFixed(2)),
        Number(ledgerReceivedForRentalBs.toFixed(2)),
        canonicalLedgerPaidBs,
      );
      const economicDueBs = Math.max(
        0,
        Number((rowChargeTargetBs - paidOnAccountBs).toFixed(2)),
      );
      const rentalAccountingStatus = normalizeText(
        linkedRental?.accountingStatus
        ?? linkedRental?.payment?.status
        ?? contract?.accountingStatus
        ?? contract?.paymentStatus,
      );
      const resetOverrideKey = String(contract?.id ?? contract?.contractCode ?? '').trim();
      const resetPendingOverride = resetOverrideKey
        ? economicResetPendingByContract[resetOverrideKey]
        : undefined;
      const rawAuthoritativePendingBs =
        resetPendingOverride
        ?? contract?.payment?.pendingPaymentBs
        ?? contract?.payment?.pendingBs
        ?? contract?.totals?.pendingPaymentBs
        ?? linkedRental?.payment?.pendingPaymentBs
        ?? linkedRental?.totals?.pendingPaymentBs
        ?? linkedRental?.returnSettlement?.pendingCollectionBs;
      const hasAuthoritativePending = rawAuthoritativePendingBs !== undefined
        && rawAuthoritativePendingBs !== null
        && rawAuthoritativePendingBs !== '';
      const authoritativePendingBs = hasAuthoritativePending
        ? toMoneyNumber(rawAuthoritativePendingBs)
        : null;
      const settledByStatus = [
        'cobrado_finalizado',
        'cobrado',
        'cancelado',
        'liquidado',
      ].includes(rentalAccountingStatus);
      const settledByAuthoritativeBalance = hasAuthoritativePending
        && authoritativePendingBs <= 0.009;
      const settledByCommercialPayment = paidOnAccountBs + 0.009 >= totalBs;
      const isEconomicallyPaid = settledByCommercialPayment
        || settledByAuthoritativeBalance
        || (settledByStatus && economicDueBs <= 0.009);
      const dueBs = isEconomicallyPaid
        ? 0
        : hasEconomicLedger
          ? economicDueBs
          : hasAuthoritativePending
            ? Math.max(0, Number(authoritativePendingBs.toFixed(2)))
            : Math.max(0, Number((totalBs - paidOnAccountBs).toFixed(2)));
      const deliveryCollectedBs = Math.max(
        0,
        toMoneyNumber(linkedRental?.payment?.deliveryFeeCollectedBs ?? linkedRental?.totals?.deliveryFeeCollectedBs),
      );
      const receivableBreakdown = calculateReceivableBreakdown({
        rental: linkedRental,
        contract,
        commercialPaidOverrideBs: Math.max(0, Number((totalBs - dueBs).toFixed(2))),
        damageChargeOverrideBs: damageChargeBs,
        damageCoveredOverrideBs: damageCoveredByGuaranteeBs,
        damageCollectedOverrideBs: damageCollectedBs,
        deliveryFeeOverrideBs: transportBs,
        deliveryCollectedOverrideBs: deliveryCollectedBs,
      });
      const guaranteeReferenceKeys = [
        contract.id,
        contract.rentalId,
        contract.contractCode,
        contract.orderCode,
        linkedOrder?.id,
        linkedOrder?.orderCode,
      ].map(normalizeText);
      const referencedGuaranteeRefundedBs = Math.max(
        0,
        ...guaranteeReferenceKeys
          .filter(Boolean)
          .map((key) => returnedGuaranteeAmountsByReference.get(key) ?? 0),
      );
      const guaranteeSettlement = calculateGuaranteeSettlement({
        paidBs: rowGuaranteeReserveBs,
        appliedBs: rowGuaranteeAppliedBs,
        refundedBs: Math.max(
          rowLedgerTotals.guaranteeRefundedBs,
          referencedGuaranteeRefundedBs,
        ),
      });
      const isGuaranteeValidated = rowGuaranteeReserveBs > 0;
      const guaranteeStatus = guaranteeBs <= 0
        ? 'none'
        : guaranteeSettlement.isFullyResolved && guaranteeSettlement.refundedBs > 0
          ? 'returned'
          : guaranteeSettlement.isPartiallyRefunded
            ? 'partial'
          : rowGuaranteeAppliedBs >= rowGuaranteeReserveBs && rowGuaranteeReserveBs > 0
            ? 'charged'
            : !isGuaranteeValidated
              ? 'pending'
              : 'held';
      return {
        ...contract,
        status,
        itemsCount,
        responsibleName: getResponsibleDisplayName(contract),
        responsibleRole: getResponsibleDisplayRole(contract),
        totalBs,
        managedTotalBs,
        paidOnAccountBs,
        dueBs,
        contractPendingBs: receivableBreakdown.contractPendingBs,
        transportPendingBs: receivableBreakdown.transportPendingBs,
        totalReceivableBs: receivableBreakdown.totalPendingBs,
        isSent,
        isReturned,
        hasClientPending,
        clientPendingUnits,
        clientPendingPickup,
        hasEconomicLedger,
        economicInternalNotes,
        guaranteeBs,
        guaranteeRefundedBs: guaranteeSettlement.refundedBs,
        guaranteePendingRefundBs: guaranteeSettlement.pendingRefundBs,
        guaranteeStatus,
        damageChargeBs,
        damageCollectedBs,
        damageCoveredByGuaranteeBs,
        damagePendingBs,
        damageStatus,
        deletedByName: String(contract?.deletedByName ?? deletionRevision?.updatedByName ?? '').trim(),
        deletedByRole: String(contract?.deletedByRole ?? deletionRevision?.updatedByRole ?? '').trim(),
        deletedAt: contract?.deletedAt ?? deletionRevision?.updatedAt ?? null,
        isFinalized: Boolean(contract?.isFinalized),
        finalizedAt: contract?.finalizedAt ?? null,
        finalizedByName: String(contract?.finalizedByName ?? '').trim(),
        guaranteePrimary: guaranteeBs > 0
          ? formatBs(guaranteeStatus === 'partial' ? guaranteeSettlement.pendingRefundBs : guaranteeBs)
          : 'Sin garantía',
        guaranteeSecondary: guaranteeBs > 0
          ? guaranteeStatus === 'pending'
            ? 'Debe'
            : guaranteeStatus === 'returned'
              ? 'Devuelta'
              : guaranteeStatus === 'partial'
                ? 'Por devolver'
                : 'Pagada'
          : '',
      };
    });
  }, [activeRentalByReference, collectionMovementIndex, economicResetPendingByContract, formatBs, orderByContractId, returnedGuaranteeAmountsByReference]);

  const contractRows = useMemo(() => buildContractRows(contracts), [buildContractRows, contracts]);
  const hiddenContractRows = useMemo(
    () => buildContractRows(hiddenContracts).map((row) => ({ ...row, status: 'oculto' })),
    [buildContractRows, hiddenContracts],
  );

  const contractCounts = useMemo(() => {
    const base = { all: contractRows.length, borrador: 0, pendiente: 0, aprobado: 0, rechazado: 0, anulado: 0, oculto: hiddenContractRows.length };
    contractRows.forEach((row) => {
      base[row.status] = (base[row.status] ?? 0) + 1;
    });
    return base;
  }, [contractRows, hiddenContractRows.length]);

  const matchesContractSearch = useCallback((row) => {
    const text = normalizeText(deferredContractQuery);
    const eventKey = getDateKey(row.eventDate);
    if (contractDateFrom && (!eventKey || eventKey < contractDateFrom)) return false;
    if (contractDateTo && (!eventKey || eventKey > contractDateTo)) return false;
    if (!text) return true;
    return (
      normalizeText(row.contractCode).includes(text)
      || normalizeText(row.customerName).includes(text)
      || normalizeText(row.customerPhone).includes(text)
      || normalizeText(row.customerReferencePhone).includes(text)
      || normalizeText(row.responsibleName).includes(text)
      || normalizeText(row.responsibleRole).includes(text)
      || (Array.isArray(row.responsibles) && row.responsibles.some((responsible) =>
        normalizeText(responsible?.name).includes(text)
        || normalizeText(responsible?.role).includes(text)
      ))
      || normalizeText(row.eventType).includes(text)
      || normalizeText(row.orderCode).includes(text)
    );
  }, [contractDateFrom, contractDateTo, deferredContractQuery]);

  const searchedVisibleContracts = useMemo(
    () => contractRows.filter(matchesContractSearch),
    [contractRows, matchesContractSearch],
  );

  const searchedHiddenContracts = useMemo(
    () => (canViewHiddenContracts ? hiddenContractRows.filter(matchesContractSearch) : []),
    [canViewHiddenContracts, hiddenContractRows, matchesContractSearch],
  );

  const searchedContracts = contractFilter === 'oculto' && canViewHiddenContracts
    ? searchedHiddenContracts
    : searchedVisibleContracts;

  const visibleContractCounts = useMemo(() => {
    const base = { all: searchedVisibleContracts.length, borrador: 0, pendiente: 0, aprobado: 0, rechazado: 0, anulado: 0, oculto: searchedHiddenContracts.length };
    searchedVisibleContracts.forEach((row) => {
      base[row.status] = (base[row.status] ?? 0) + 1;
    });
    return base;
  }, [searchedHiddenContracts.length, searchedVisibleContracts]);

  const filteredContracts = useMemo(() => {
    const statusRows = contractFilter === 'oculto'
      ? searchedHiddenContracts
      : searchedVisibleContracts.filter((row) => contractFilter === 'all' || row.status === contractFilter);
    const controlledRows = statusRows.map((row) => {
      const noteOverride = contractNoteOverrides.get(String(row.id ?? ''));
      const economicNotes = noteOverride ?? row.economicInternalNotes ?? [];
      const isFinalized = finalizedContractOverrides.has(row.id)
        ? finalizedContractOverrides.get(row.id)
        : Boolean(row.isFinalized);
      return {
        ...row,
        hasDamage: row.damageStatus !== 'none',
        hasNotes: Array.isArray(economicNotes) && economicNotes.length > 0,
        hasGuarantee: Number(row.guaranteeBs ?? 0) > 0,
        isPaid: Number(row.dueBs ?? 0) <= 0.009,
        isFinalized,
      };
    });
    return applyOrderTableControls(controlledRows, contractColumnFilters, contractSort);
  }, [contractColumnFilters, contractFilter, contractNoteOverrides, contractSort, finalizedContractOverrides, searchedHiddenContracts, searchedVisibleContracts]);

  useEffect(() => {
    setVisibleContractLimit(CONTRACT_RENDER_BATCH_SIZE);
  }, [activeView, contractColumnFilters, contractDateFrom, contractDateTo, contractFilter, contractSort, deferredContractQuery]);

  const openContractColumnMenu = useCallback((key, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 224;
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
    setContractColumnMenu((current) => current?.key === key
      ? null
      : { key, top: rect.bottom + 7, left });
  }, []);

  const selectContractColumnOption = useCallback((key, value) => {
    const menu = ORDER_COLUMN_MENU_OPTIONS[key];
    if (menu?.type === 'sort') {
      setContractSort({ key, direction: value });
    } else {
      setContractColumnFilters((current) => ({ ...current, [key]: value }));
    }
    setContractColumnMenu(null);
  }, []);

  const clearContractColumnControl = useCallback((key) => {
    const menu = ORDER_COLUMN_MENU_OPTIONS[key];
    if (menu?.type === 'sort') {
      setContractSort({ key: '', direction: '' });
    } else {
      setContractColumnFilters((current) => ({ ...current, [key]: 'all' }));
    }
    setContractColumnMenu(null);
  }, []);

  const visibleContractsForRender = useMemo(
    () => filteredContracts.slice(0, visibleContractLimit),
    [filteredContracts, visibleContractLimit],
  );

  const hasMoreFilteredContracts = visibleContractsForRender.length < filteredContracts.length;


  const openOrdersRangeReport = () => {
    const rows = filteredContracts;
    const from = String(contractDateFrom ?? '').slice(0, 10);
    const to = String(contractDateTo ?? '').slice(0, 10);
    const formatDateKey = (value) => {
      const key = getDateKey(value);
      if (!key) return 'Sin fecha';
      const [year, month, day] = key.split('-');
      return `${day}/${month}/${year}`;
    };
    const generatedAt = new Intl.DateTimeFormat('es-BO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date());
    const rangeLabel = from || to
      ? `${from ? formatDateKey(from) : 'Inicio'} — ${to ? formatDateKey(to) : 'Fin'}`
      : 'Todos los eventos visibles';
    const statusLabels = {
      borrador: 'Borrador', pendiente: 'Pendiente', aprobado: 'Aprobado',
      rechazado: 'Rechazado', anulado: 'Anulado', oculto: 'Oculto',
    };
    const statusTones = {
      aprobado: 'success', pendiente: 'warning', borrador: 'muted',
      rechazado: 'danger', anulado: 'danger', oculto: 'muted',
    };
    const filterParts = [];
    if (contractFilter !== 'all') filterParts.push(`Estado: ${statusLabels[contractFilter] || contractFilter}`);
    if (String(contractQuery ?? '').trim()) filterParts.push(`Búsqueda: ${String(contractQuery).trim()}`);
    const binaryFilterLabels = {
      damage: { yes: 'Con daños/faltantes', no: 'Sin daños/faltantes' },
      notes: { yes: 'Con notas', no: 'Sin notas' },
      guarantee: { yes: 'Con garantía', no: 'Sin garantía' },
      payment: { yes: 'Pagados', no: 'Por cobrar' },
      finalized: { yes: 'Finalizados', no: 'No finalizados' },
    };
    Object.entries(contractColumnFilters).forEach(([key, value]) => {
      if (value !== 'all') filterParts.push(binaryFilterLabels[key]?.[value] || value);
    });
    if (contractSort.key) {
      const sortLabels = { contract: 'Contrato', date: 'Fecha', client: 'Cliente' };
      filterParts.push(`Orden: ${sortLabels[contractSort.key] || contractSort.key} ${contractSort.direction === 'desc' ? 'descendente' : 'ascendente'}`);
    }
    const filterLabel = filterParts.length ? filterParts.join(' · ') : 'Todos los estados';

    const reportRows = rows.map((row) => {
      const isRowFinalized = finalizedContractOverrides.has(row.id)
        ? finalizedContractOverrides.get(row.id)
        : Boolean(row.isFinalized);
      const serviceLabel = normalizeText(row.logisticsMode) === 'recojo'
        ? 'Recojo por cliente'
        : row.address || 'Envío por mi equipo';
      const damageLabel = row.damageStatus === 'none'
        ? 'NO TIENE'
        : row.damageStatus === 'paid'
          ? 'PAGADO'
          : formatBs(row.damagePendingBs);
      const guaranteeLabel = row.guaranteeBs > 0
        ? `${formatBs(row.guaranteeBs)} · ${row.guaranteeSecondary || 'Pagada'}`
        : 'Sin garantía';
      return {
        contractCode: row.contractCode || '',
        customerName: row.customerName || '',
        eventDateValue: getDateKey(row.eventDate),
        eventDateLabel: formatDateKey(row.eventDate),
        responsibleName: row.responsibleName || 'Sistema',
        serviceLabel,
        statusLabel: statusLabels[row.status] || row.status || '—',
        statusTone: statusTones[row.status] || 'muted',
        guaranteeLabel,
        damageLabel,
        dueBs: Math.max(0, Number(row.dueBs ?? 0)),
        contractPendingBs: Math.max(0, Number(row.contractPendingBs ?? row.dueBs ?? 0)),
        transportPendingBs: Math.max(0, Number(row.transportPendingBs ?? 0)),
        damagePendingBs: Math.max(0, Number(row.damagePendingBs ?? 0)),
        totalReceivableBs: Math.max(0, Number(row.totalReceivableBs ?? (Number(row.dueBs ?? 0) + Number(row.damagePendingBs ?? 0)))),
        financialStatusLabel: Number(row.totalReceivableBs ?? (Number(row.dueBs ?? 0) + Number(row.damagePendingBs ?? 0))) > 0.009 ? 'Por cobrar' : 'Pagado',
        finalizedLabel: isRowFinalized ? 'Sí' : 'No',
        isPaid: Number(row.totalReceivableBs ?? (Number(row.dueBs ?? 0) + Number(row.damagePendingBs ?? 0))) <= 0.009,
        hasGuarantee: Number(row.guaranteeBs ?? 0) > 0,
        hasDamage: row.damageStatus !== 'none',
        isFinalized: isRowFinalized,
      };
    });
    const count = (predicate) => reportRows.filter(predicate).length;
    const totalPendingBs = reportRows.reduce((sum, row) => sum + Math.max(0, Number(row.totalReceivableBs ?? 0)), 0);
    const summaryCards = [
      { label: 'Contratos', value: reportRows.length, tone: 'navy' },
      { label: 'Aprobados', value: count((row) => row.statusLabel === 'Aprobado'), tone: 'success' },
      { label: 'Pagados', value: count((row) => row.isPaid), tone: 'success' },
      { label: 'Con saldo', value: count((row) => !row.isPaid), tone: 'warning' },
      { label: 'Con garantía', value: count((row) => row.hasGuarantee), tone: 'info' },
      { label: 'Daños / faltantes', value: count((row) => row.hasDamage), tone: 'danger' },
    ];
    const htmlRows = reportRows.map((row, index) => `
      <tr>
        <td class="center">${index + 1}</td>
        <td><strong>${escapeOrdersReportHtml(row.contractCode || '—')}</strong></td>
        <td>${escapeOrdersReportHtml(row.customerName || 'Sin cliente')}</td>
        <td class="center">${escapeOrdersReportHtml(row.eventDateLabel)}</td>
        <td>${escapeOrdersReportHtml(row.responsibleName)}</td>
        <td>${escapeOrdersReportHtml(row.serviceLabel)}</td>
        <td class="center"><span class="pill ${row.statusTone}">${escapeOrdersReportHtml(row.statusLabel)}</span></td>
        <td class="center">${escapeOrdersReportHtml(row.guaranteeLabel)}</td>
        <td class="amount">${escapeOrdersReportHtml(formatBs(row.contractPendingBs))}</td>
        <td class="amount">${escapeOrdersReportHtml(formatBs(row.transportPendingBs))}</td>
        <td class="amount">${escapeOrdersReportHtml(formatBs(row.damagePendingBs))}</td>
        <td class="amount ${row.isPaid ? 'paid' : 'due'}">${escapeOrdersReportHtml(formatBs(row.totalReceivableBs))}</td>
        <td class="center ${row.isPaid ? 'paid' : 'due'}">${escapeOrdersReportHtml(row.financialStatusLabel)}</td>
        <td class="center">${row.isFinalized ? '✓' : '—'}</td>
      </tr>`).join('');

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8" />
<title>Reporte de Órdenes de Servicio</title>
<style>
@page{size:A4 landscape;margin:10mm 8mm 12mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}body{font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:8.8px;line-height:1.25;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.header{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:24px;align-items:end;padding-bottom:11px;border-bottom:3px solid #173a70}.brand{margin-bottom:5px;color:#173a70;font-size:9px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}h1{margin:0;color:#111827;font-size:24px;line-height:1;letter-spacing:-.025em}.subtitle{margin:5px 0 0;color:#64748b;font-size:10px}.meta{border-left:1px solid #cbd5e1;padding-left:16px}.meta-row{display:grid;grid-template-columns:75px 1fr;gap:8px;padding:2px 0}.meta-row span{color:#64748b;font-size:8px;font-weight:700;text-transform:uppercase}.meta-row strong{text-align:right;font-size:9px}.summary-title{margin:13px 0 6px;color:#475569;font-size:8px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-bottom:13px}.card{min-height:48px;padding:8px 10px;border:1px solid #d7dee8;border-top:3px solid #173a70}.card span{display:block;color:#64748b;font-size:7.4px;font-weight:800;text-transform:uppercase}.card strong{display:block;margin-top:5px;color:#173a70;font-size:18px}.card.success{border-top-color:#16803c}.card.success strong{color:#16803c}.card.warning{border-top-color:#b86a06}.card.warning strong{color:#b86a06}.card.danger{border-top-color:#b42332}.card.danger strong{color:#b42332}.card.info{border-top-color:#2563eb}.card.info strong{color:#2563eb}.section-head{display:flex;justify-content:space-between;align-items:end;margin-bottom:5px;padding-bottom:5px;border-bottom:1px solid #cbd5e1}.section-head h2{margin:0;font-size:12px}.section-head small{color:#64748b}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th{padding:6px 5px;background:#173a70;color:#fff;border:1px solid #d7dee8;font-size:7.2px;text-transform:uppercase}td{padding:5px;border:1px solid #d7dee8;vertical-align:middle;overflow-wrap:anywhere}tbody tr:nth-child(even) td{background:#f8fafc}.center{text-align:center}.amount{text-align:right;font-weight:800}.paid{color:#16803c}.due{color:#b86a06}.pill{display:inline-block;border:1px solid transparent;border-radius:999px;padding:2px 6px;font-size:7.2px;font-weight:800;white-space:nowrap}.pill.success{border-color:#a7dfb7;background:#edf9f0;color:#16753a}.pill.warning{border-color:#f0cf8c;background:#fff8e8;color:#9a5b08}.pill.danger{border-color:#efb5bc;background:#fff0f2;color:#a52634}.pill.muted{border-color:#d5dbe4;background:#f4f6f8;color:#596678}small{color:#64748b}.footer{margin-top:10px;padding-top:7px;border-top:1px solid #cbd5e1;display:flex;justify-content:space-between;color:#7b8798;font-size:7.4px}
th:nth-child(1),td:nth-child(1){width:3%}th:nth-child(2),td:nth-child(2){width:8%}th:nth-child(3),td:nth-child(3){width:11%}th:nth-child(4),td:nth-child(4){width:7%}th:nth-child(5),td:nth-child(5){width:9%}th:nth-child(6),td:nth-child(6){width:13%}th:nth-child(7),td:nth-child(7){width:7%}th:nth-child(8),td:nth-child(8){width:9%}th:nth-child(n+9),td:nth-child(n+9){width:7%}
@media print{tr{break-inside:avoid}.header,.cards,.section-head{break-inside:avoid}}
</style></head><body>
<header class="header"><div><div class="brand">EL COPETÍN · ÓRDENES DE SERVICIO</div><h1>Reporte de Órdenes de Servicio</h1><p class="subtitle">Control comercial de contratos según los filtros visibles en la vista de Órdenes.</p></div><div class="meta"><div class="meta-row"><span>Periodo</span><strong>${escapeOrdersReportHtml(rangeLabel)}</strong></div><div class="meta-row"><span>Generado</span><strong>${escapeOrdersReportHtml(generatedAt)}</strong></div><div class="meta-row"><span>Contratos</span><strong>${reportRows.length}</strong></div><div class="meta-row"><span>Pendiente</span><strong>${escapeOrdersReportHtml(formatBs(totalPendingBs))}</strong></div></div></header>
<div class="summary-title">Resumen ejecutivo del periodo</div><section class="cards">${summaryCards.map((card) => `<div class="card ${card.tone}"><span>${escapeOrdersReportHtml(card.label)}</span><strong>${escapeOrdersReportHtml(card.value)}</strong></div>`).join('')}</section>
<section><div class="section-head"><h2>Detalle de contratos del rango</h2><small>${reportRows.length} contrato(s) encontrados · ${escapeOrdersReportHtml(filterLabel)}</small></div><table><thead><tr><th>N°</th><th>Contrato</th><th>Cliente</th><th>Evento</th><th>Responsable</th><th>Servicio</th><th>Estado</th><th>Garantía</th><th>Contrato</th><th>Transporte</th><th>Daños</th><th>Total por cobrar</th><th>Estado financiero</th><th>Finalizado</th></tr></thead><tbody>${htmlRows || '<tr><td colspan="14" class="center">No hay contratos con los filtros seleccionados.</td></tr>'}</tbody></table></section>
<footer class="footer"><span><strong>EL COPETÍN</strong> · Gestión comercial y operativa</span><span>Filtros: ${escapeOrdersReportHtml(filterLabel)} · ${escapeOrdersReportHtml(rangeLabel)}</span></footer>
</body></html>`;

    setDocumentPreview({
      kind: 'orders-report',
      title: `Reporte de Órdenes · ${rangeLabel}`,
      html,
      mimeType: 'text/html',
      fileName: `reporte-ordenes-${from || 'inicio'}-${to || 'fin'}.html`,
      reportData: {
        rangeLabel,
        rangeFileLabel: `${from || 'inicio'}_${to || 'fin'}`,
        generatedAt,
        filterLabel,
        totalPendingBs,
        summaryCards,
        rows: reportRows,
      },
    });
  };

  const exportOrdersPreviewToExcel = async () => {
    if (documentPreview?.kind !== 'orders-report' || !documentPreview?.reportData || isExportingOrdersReport) return;
    try {
      setIsExportingOrdersReport(true);
      await exportOrdersRangeWorkbook(documentPreview.reportData);
    } catch (error) {
      console.error('No se pudo exportar el reporte de Órdenes.', error);
      window.alert(error?.message || 'No se pudo generar el Excel. Intenta nuevamente.');
    } finally {
      setIsExportingOrdersReport(false);
    }
  };

  useEffect(() => {
    if (activeView !== 'quotes' && activeView !== 'contracts') return;

    setSeenCounts((current) => {
      const next = {
        ...current,
        ...(activeView === 'quotes' ? { quotes: quoteRows.length } : {}),
        ...(activeView === 'contracts' ? { contracts: contractRows.length } : {}),
      };
      if (next.quotes === current.quotes && next.contracts === current.contracts) return current;
      saveSeenCounts(next);
      return next;
    });
  }, [activeView, contractRows.length, quoteRows.length]);

  const quoteNotificationCount = Math.max(0, quoteRows.length - seenCounts.quotes);
  const contractNotificationCount = Math.max(0, contractRows.length - seenCounts.contracts);

  useEffect(() => {
    if (contractFilter === 'oculto' && !canViewHiddenContracts) {
      setContractFilter('all');
    }
  }, [canViewHiddenContracts, contractFilter]);

  useEffect(() => {
    const input = contractSearchInputRef.current;
    if (!input || document.activeElement === input) return;
    input.value = contractQuery;
  }, [contractQuery]);

  useEffect(() => () => {
    if (contractSearchDebounceRef.current) {
      clearTimeout(contractSearchDebounceRef.current);
    }
  }, []);

  const handleContractSearchChange = useCallback((event) => {
    const nextValue = event.target.value;
    if (contractSearchDebounceRef.current) {
      clearTimeout(contractSearchDebounceRef.current);
    }
    contractSearchDebounceRef.current = setTimeout(() => {
      setContractQuery(nextValue);
    }, 180);
  }, []);

  const activeOrderMenuRow = useMemo(
    () => (menuState?.type === 'order' ? orderRowsWithMeta.find((row) => row.id === menuState.id) ?? null : null),
    [menuState, orderRowsWithMeta],
  );

  const activeQuoteMenuRow = useMemo(
    () => (menuState?.type === 'quote' ? quoteRows.find((row) => row.id === menuState.id) ?? null : null),
    [menuState, quoteRows],
  );

  const activeContractMenuRow = useMemo(
    () => (menuState?.type === 'contract'
      ? [...contractRows, ...hiddenContractRows].find((row) => row.id === menuState.id) ?? null
      : null),
    [contractRows, hiddenContractRows, menuState],
  );

  const contractEconomicsData = useMemo(() => {
    if (!contractEconomicsTarget) return null;

    const target = contractEconomicsTarget;
    const matchedContract = contracts.find((entry) =>
      valuesMatch(entry.id, target.id)
      || valuesMatch(entry.contractCode, target.contractCode)
      || valuesMatch(entry.orderCode, target.orderCode)
      || valuesMatch(entry.rentalId, target.rentalId),
    ) ?? null;
    const contract = matchedContract?._summaryOnly && !target?._summaryOnly
      ? { ...matchedContract, ...target }
      : (matchedContract
        ? {
          ...target,
          ...matchedContract,
          ...(target?.economicLedger !== undefined ? { economicLedger: target.economicLedger } : {}),
          ...(target?.economicLedgerUpdatedAt !== undefined ? { economicLedgerUpdatedAt: target.economicLedgerUpdatedAt } : {}),
          ...(target?.economicResetAt !== undefined ? { economicResetAt: target.economicResetAt } : {}),
          ...(target?.economicResetVersion !== undefined ? { economicResetVersion: target.economicResetVersion } : {}),
          ...(target?.economicLedgerUpdatedByName !== undefined ? { economicLedgerUpdatedByName: target.economicLedgerUpdatedByName } : {}),
        }
        : target);

    const linkedOrder = orderRowsWithMeta.find((row) =>
      valuesMatch(row.contractId, contract.id)
      || valuesMatch(row.contractCode, contract.contractCode)
      || valuesMatch(row.orderCode, contract.orderCode)
      || valuesMatch(row.rentalId, contract.rentalId),
    ) ?? null;

    const matchedRental = rentals.find((entry) =>
      valuesMatch(entry.id, contract.rentalId)
      || valuesMatch(entry.contractId, contract.id)
      || valuesMatch(entry.contractCode, contract.contractCode)
      || valuesMatch(entry.orderCode, contract.orderCode)
      || valuesMatch(entry.id, linkedOrder?.rentalId)
      || valuesMatch(entry.orderCode, linkedOrder?.orderCode),
    ) ?? null;
    const isFullRentalMatch = contractEconomicsFullRental
      && (
        valuesMatch(contractEconomicsFullRental.id, contract.rentalId)
        || valuesMatch(contractEconomicsFullRental.contractId, contract.id)
        || valuesMatch(contractEconomicsFullRental.contractCode, contract.contractCode)
        || valuesMatch(contractEconomicsFullRental.orderCode, contract.orderCode)
        || valuesMatch(contractEconomicsFullRental.id, linkedOrder?.rentalId)
        || valuesMatch(contractEconomicsFullRental.orderCode, linkedOrder?.orderCode)
      );
    const rental = matchedRental?._summaryOnly && isFullRentalMatch
      ? { ...matchedRental, ...contractEconomicsFullRental }
      : (isFullRentalMatch && !contractEconomicsFullRental?._summaryOnly
        ? contractEconomicsFullRental
        : matchedRental);

    const cashReferences = {
      contractIds: [contract.id, linkedOrder?.contractId, rental?.contractId],
      rentalIds: [contract.rentalId, linkedOrder?.id, linkedOrder?.rentalId, rental?.id],
      contractCodes: [contract.contractCode, linkedOrder?.contractCode, rental?.contractCode],
      orderCodes: [contract.orderCode, linkedOrder?.orderCode, rental?.orderCode],
      createdAtMs: new Date(
        contract?.approvedAt ?? contract?.contractDate ?? contract?.createdAt ?? 0,
      ).getTime(),
    };

    const linkedMovements = effectiveCashMovements
      .filter((movement) => cashMovementMatchesContractReferences(movement, cashReferences))
      .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));

    // Esta tabla es exclusivamente de dinero confirmado. Las liquidaciones de
    // retorno y marcadores de saldo de versiones anteriores tienen monto cero:
    // son resúmenes operativos, no recibos ni movimientos de caja.
    const movements = linkedMovements.filter((movement) => (
      Math.abs(getCashMovementAmount(movement)) > 0
    ));

    const postedMovements = linkedMovements.filter((movement) => !isVoidedCashMovement(movement));
    const isGuaranteeMovement = (movement) => {
      const tag = normalizeText(movement?.accountingTag);
      const category = normalizeText(movement?.category);
      const type = normalizeText(movement?.type);
      return tag.includes('guarantee') || category.includes('garantia') || type.includes('garantia');
    };
    const incomeBs = postedMovements.reduce((sum, movement) => {
      const type = normalizeText(movement?.type);
      const tag = normalizeText(movement?.accountingTag);
      if (type.includes('egreso') || tag === 'guarantee_refund') return sum;
      return sum + Math.max(0, getCashMovementAmount(movement));
    }, 0);
    const paymentIncomeBs = postedMovements.reduce((sum, movement) => {
      const type = normalizeText(movement?.type);
      const tag = normalizeText(movement?.accountingTag);
      if (type.includes('egreso') || tag === 'guarantee_refund' || isGuaranteeMovement(movement)) return sum;
      return sum + getEconomicCommercialCashAmount(movement);
    }, 0);
    const expenseBs = postedMovements.reduce((sum, movement) => {
      const type = normalizeText(movement?.type);
      const tag = normalizeText(movement?.accountingTag);
      if (!type.includes('egreso') && tag !== 'guarantee_refund') return sum;
      return sum + Math.abs(getCashMovementAmount(movement));
    }, 0);
    const confirmedGuaranteeRefundBs = postedMovements.reduce((sum, movement) => {
      const type = normalizeText(movement?.type);
      const tag = normalizeText(movement?.accountingTag);
      const category = normalizeText(movement?.category);
      const isGuaranteeRefund = tag === 'guarantee_refund'
        || category.includes('garantia_devuelta')
        || (type.includes('egreso') && isGuaranteeMovement(movement));
      if (!isGuaranteeRefund) return sum;
      return sum + Math.abs(getCashMovementAmount(movement));
    }, 0);
    const collectionRegisteredBs = postedMovements.reduce((sum, movement) => {
      const movementType = normalizeText(movement?.type);
      const category = normalizeText(movement?.category);
      const tag = normalizeText(movement?.accountingTag);
      const cashBoxType = normalizeText(movement?.cashBoxType);
      const receiptCode = String(movement?.receiptCode ?? movement?.receipt ?? '').trim();
      const isBigCash = ['big_cash', 'caja_grande', 'cajagrande'].includes(cashBoxType);
      const isIncome = movementType.includes('ingreso')
        || movementType.includes('cobro')
        || category === 'cobro_contrato';
      const isCollection = tag === 'contract_economic_collection'
        || category === 'cobro_contrato'
        || movementType === 'ingreso_alquiler'
        || (Boolean(receiptCode) && isBigCash && isIncome);
      if (isGuaranteeMovement(movement)) return sum;
      if (!isCollection) return sum;
      return sum + getEconomicCommercialCashAmount(movement);
    }, 0);
    const collectionByTarget = postedMovements.reduce((totals, movement) => {
      const amount = Math.max(0, getCashMovementAmount(movement));
      if (amount <= 0 || isGuaranteeMovement(movement)) return totals;
      const type = normalizeText(movement?.type);
      const category = normalizeText(movement?.category);
      const tag = normalizeText(movement?.accountingTag);
      const cashBoxType = normalizeText(movement?.cashBoxType);
      const receiptCode = String(movement?.receiptCode ?? movement?.receipt ?? '').trim();
      const isBigCash = ['big_cash', 'caja_grande', 'cajagrande'].includes(cashBoxType);
      const isIncome = type.includes('ingreso') || type.includes('cobro') || category.includes('cobro');
      if (!isIncome && !(receiptCode && isBigCash)) return totals;
      const breakdown = Array.isArray(movement?.collectionBreakdown) ? movement.collectionBreakdown : [];
      if (breakdown.length) {
        const next = { ...totals };
        breakdown.forEach((entry) => {
          const amount = Math.max(0, toMoneyNumber(entry?.amountBs));
          if (amount <= 0) return;
          if (entry?.target === 'transport') next.transportBs = Number((next.transportBs + amount).toFixed(2));
          else if (entry?.target === 'damage') next.damageBs = Number((next.damageBs + amount).toFixed(2));
          else next.rentalBs = Number((next.rentalBs + amount).toFixed(2));
        });
        return next;
      }
      const transportPart = Math.max(0, Math.min(amount, toMoneyNumber(movement?.transportRevenueBs)));
      const storedDamagePart = Math.max(0, Math.min(amount, toMoneyNumber(movement?.damageCollectedBs)));
      const damagePart = storedDamagePart > 0
        ? storedDamagePart
        : tag === 'contract_damage_collection' || category === 'cobro_danos_faltantes' || type.includes('dano') || type.includes('faltante')
        ? amount
        : 0;
      const transportOnly = tag === 'transport_revenue' || category === 'transporte_cobrado' || type.includes('transporte');
      const next = { ...totals };
      if (damagePart > 0) {
        next.damageBs = Number((next.damageBs + damagePart).toFixed(2));
        return next;
      }
      if (transportOnly || transportPart > 0) {
        const appliedTransport = transportOnly ? amount : transportPart;
        next.transportBs = Number((next.transportBs + appliedTransport).toFixed(2));
        const remainder = Math.max(0, Number((amount - appliedTransport).toFixed(2)));
        if (remainder > 0) next.rentalBs = Number((next.rentalBs + remainder).toFixed(2));
        return next;
      }
      // Los cobros generales o pagos iniciales antiguos no siempre guardan un
      // desglose por concepto. No los imputamos directamente a items porque el
      // total del contrato puede incluir transporte. Se distribuyen después
      // contra los importes reales del contrato, sin crear recibos adicionales.
      next.unclassifiedBs = Number((next.unclassifiedBs + amount).toFixed(2));
      return next;
    }, {
      rentalBs: 0,
      transportBs: 0,
      damageBs: 0,
      unclassifiedBs: 0,
    });

    const storedTotalBs = toMoneyNumber(contract?.totals?.totalBs ?? contract?.totalBs ?? rental?.totals?.totalBs);
    const guaranteeDeclaredBs = toMoneyNumber(
      rental?.guaranteeDeclaredBs
      ?? rental?.guarantee?.amountBs
      ?? contract?.totals?.guaranteeBs
      ?? contract?.guarantee?.amountBs
      ?? rental?.depositBs,
    );
    const rawGuaranteeStatus = String(
      rental?.guarantee?.status
      ?? rental?.payment?.guaranteeStatus
      ?? contract?.guarantee?.status
      ?? contract?.payment?.guaranteeStatus
      ?? '',
    ).trim();
    const guaranteeValidatedBs = rawGuaranteeStatus === 'validado'
      ? Math.max(
        toMoneyNumber(rental?.depositBs),
        toMoneyNumber(rental?.guarantee?.validatedBs),
        guaranteeDeclaredBs,
      )
      : 0;
    const settlement = rental?.returnSettlement ?? {};
    const paidBs = Math.max(
      toMoneyNumber(contract?.payment?.paidAtApprovalBs),
      toMoneyNumber(rental?.payment?.paidAtRentalBs),
      paymentIncomeBs,
    );
    const penaltiesBs = toMoneyNumber(settlement.penaltiesBs ?? rental?.penaltiesBs);
    const refundBs = toMoneyNumber(settlement.refundBs ?? rental?.refundBs);
    const discountBs = toMoneyNumber(contract?.totals?.discountBs ?? rental?.totals?.discountBs);
    const itemDiscountsBs = toMoneyNumber(contract?.totals?.itemDiscountsBs ?? rental?.totals?.itemDiscountsBs);
    const deliveryFeeBs = toMoneyNumber(contract?.totals?.deliveryFeeBs ?? rental?.deliveryFeeBs ?? rental?.totals?.deliveryFeeBs);
    const servicesBs = (Array.isArray(contract?.services) ? contract.services : Array.isArray(rental?.services) ? rental.services : [])
      .reduce((sum, service) => sum + toMoneyNumber(service?.lineTotalBs), 0);
    const storedItemsNetSubtotalBs = toMoneyNumber(
      contract?.totals?.itemsNetSubtotalBs
      ?? contract?.totals?.itemsSubtotalBs
      ?? rental?.totals?.itemsNetSubtotalBs
      ?? rental?.totals?.itemsSubtotalBs,
    );
    const pricingMode = normalizeText(contract?.pricingPlan?.mode ?? rental?.pricingPlan?.mode);
    const repairedDailyScheduleTotalBs = pricingMode === 'daily_schedule' && storedItemsNetSubtotalBs > 0
      ? Math.max(
        0,
        Number((storedItemsNetSubtotalBs + servicesBs - discountBs + deliveryFeeBs).toFixed(2)),
      )
      : storedTotalBs;
    // Contratos antiguos con subalquiler manual podían guardar itemsNetSubtotalBs
    // correcto pero totalBs/chargeableSubtotalBs anterior. El económico debe usar
    // el mayor total comercial válido, sin duplicar pagos ni daños.
    const totalBs = Math.max(storedTotalBs, repairedDailyScheduleTotalBs);
    const pendingPaymentBs = rental?.status === 'returned' || rental?.returnSettlement
      ? getEffectiveReturnedPendingCollectionBs(rental, contract)
      : toMoneyNumber(
        rental?.payment?.pendingPaymentBs
        ?? contract?.payment?.pendingPaymentBs
        ?? contract?.totals?.pendingPaymentBs,
      );
    const outstandingRentalBs = rental?.status === 'returned' || rental?.returnSettlement
      ? Math.max(0, Number((totalBs - paidBs).toFixed(2)))
      : toMoneyNumber(settlement.outstandingRentalBs);
    const rentalTotalBs = Math.max(0, Number((totalBs - servicesBs - deliveryFeeBs).toFixed(2)));
    const itemsGrossSubtotalBs = Math.max(
      rentalTotalBs + itemDiscountsBs,
      toMoneyNumber(contract?.totals?.itemsGrossSubtotalBs ?? rental?.totals?.itemsGrossSubtotalBs),
    );
    const itemsNetSubtotalBs = Math.max(
      rentalTotalBs,
      toMoneyNumber(contract?.totals?.itemsNetSubtotalBs ?? contract?.totals?.itemsSubtotalBs ?? rental?.totals?.itemsNetSubtotalBs ?? rental?.totals?.itemsSubtotalBs),
    );
    const prepaidUsedBs = toMoneyNumber(contract?.payment?.prepaidUsedBs ?? rental?.payment?.prepaidUsedBs);

    const clientPendingPickup = rental?.operational?.clientPendingPickup?.active
      ? rental.operational.clientPendingPickup
      : linkedOrder?.clientPendingPickup?.active
        ? linkedOrder.clientPendingPickup
        : null;
    const clientPendingItems = (Array.isArray(clientPendingPickup?.items) ? clientPendingPickup.items : [])
      .filter((line) => toMoneyNumber(line?.pendingQty) > 0)
      .map((line, index) => ({
        id: `${rental?.id ?? contract?.id ?? 'contract'}-client-pending-${line?.lineKey ?? line?.itemId ?? index}`,
        lineKey: String(line?.lineKey ?? '').trim(),
        itemId: String(line?.itemId ?? '').trim(),
        itemName: line?.itemName ?? 'Item',
        pendingQty: toMoneyNumber(line?.pendingQty),
        note: line?.note ?? clientPendingPickup?.note ?? '',
      }));
    const clientPendingUnits = clientPendingItems.reduce((sum, line) => sum + toMoneyNumber(line.pendingQty), 0);

    const returnIssues = consolidateReturnIssueLines(
      Array.isArray(rental?.returnIssueSummary) && rental.returnIssueSummary.length > 0
        ? rental.returnIssueSummary
        : rental?.returnReport,
      rental?.id ?? contract?.id ?? 'contract',
    )
      .filter((line) =>
        toMoneyNumber(line?.damagedQty) > 0
        || toMoneyNumber(line?.missingQty) > 0
        || toMoneyNumber(line?.penaltyBs) > 0,
      )
      .map((line, index) => ({
        id: `${rental?.id ?? contract?.id ?? 'contract'}-${line?.lineKey ?? line?.itemId ?? index}`,
        lineKey: String(line?.lineKey ?? '').trim(),
        itemId: String(line?.itemId ?? '').trim(),
        reportIndex: index,
        itemName: line?.itemName ?? line?.name ?? 'Item',
        damagedQty: toMoneyNumber(line?.damagedQty),
        missingQty: toMoneyNumber(line?.missingQty),
        damagedUnitChargeBs: toMoneyNumber(line?.damagedUnitChargeBs),
        missingUnitChargeBs: toMoneyNumber(line?.missingUnitChargeBs),
        penaltyBs: toMoneyNumber(line?.penaltyBs),
        owner: line?.chargeOwner ?? 'cliente',
        note: line?.damageNote ?? line?.note ?? '',
      }));

    const receipts = movements.filter((movement) =>
      movement?.id
      && (movement?.receipt || movement?.receiptCode || Math.abs(getCashMovementAmount(movement)) > 0),
    );
    const resetLedgerKey = String(
      contract?.id
      ?? contract?.contractCode
      ?? rental?.contractId
      ?? '',
    ).trim();
    const resetLedgerOverride = resetLedgerKey
      ? economicResetLedgerByContract[resetLedgerKey]
      : undefined;
    const rawStoredEconomicLedger = (
      Array.isArray(activeEconomicResetLedger)
        ? activeEconomicResetLedger
        : Array.isArray(resetLedgerOverride)
          ? resetLedgerOverride
        : Array.isArray(contract?.economicLedger)
          ? contract.economicLedger
          : []
    )
      .map(normalizeEconomicLedgerEntry)
      .filter((entry) => !entry.deletedAt);

    // El Reset economico recrea una sola linea vigente para el pago inicial y
    // otra para la garantia. Algunas sincronizaciones antiguas pueden mezclar
    // esas lineas nuevas con las lineas automaticas legacy del contrato.
    // Cuando existe la linea conservada por Reset, se elimina solamente su
    // equivalente automatico anterior; las demas lineas del cuaderno quedan intactas.
    const hasResetInitialPaymentLine = rawStoredEconomicLedger.some((entry) => {
      if (entry.type !== 'deposit') return false;
      const note = normalizeText(entry?.note);
      return note.includes('pago inicial')
        && note.includes('conservad')
        && note.includes('reset economico');
    });
    const hasResetGuaranteeLine = rawStoredEconomicLedger.some((entry) => {
      if (entry.type !== 'guarantee') return false;
      const note = normalizeText(entry?.note);
      return note.includes('garantia')
        && note.includes('conservad')
        && note.includes('reset economico');
    });
    const storedEconomicLedger = rawStoredEconomicLedger.filter((entry) => {
      const entryId = normalizeText(entry?.id);
      const entryNote = normalizeText(entry?.note);
      if (hasResetInitialPaymentLine && entry.type === 'deposit') {
        const isLegacyInitialPayment = entryId.includes('initial-payment')
          || entryNote === 'pago inicial registrado al crear el contrato.'
          || entryNote === 'pago inicial registrado al crear el contrato';
        if (isLegacyInitialPayment) return false;
      }
      if (hasResetGuaranteeLine && entry.type === 'guarantee') {
        const isLegacyValidatedGuarantee = entryId.includes('validated-guarantee')
          || entryId.includes('garantia-validada')
          || entryNote === 'garantia pagada registrada al crear el contrato.'
          || entryNote === 'garantia pagada registrada al crear el contrato';
        if (isLegacyValidatedGuarantee) return false;
      }
      return true;
    });
    const initialPaymentBs = Math.max(
      0,
      toMoneyNumber(contract?.payment?.paidAtApprovalBs),
      toMoneyNumber(rental?.payment?.paidAtRentalBs),
      toMoneyNumber(rental?.totals?.paidAtRentalBs),
    );
    const initialPaymentMethod = normalizeLedgerPaymentMethod(
      contract?.payment?.initialPaymentMethod
      ?? rental?.payment?.initialPaymentMethod
      ?? 'efectivo',
    );
    const initialPaymentAccount = initialPaymentMethod === 'qr'
      ? normalizeLedgerPaymentAccount(
        contract?.payment?.initialPaymentAccount
        ?? rental?.payment?.initialPaymentAccount
        ?? '',
      )
      : '';
    const guaranteePaymentMethod = normalizeLedgerPaymentMethod(
      contract?.guarantee?.paymentMethod
      ?? contract?.payment?.guaranteePaymentMethod
      ?? rental?.guarantee?.paymentMethod
      ?? rental?.payment?.guaranteePaymentMethod
      ?? 'efectivo',
    );
    const guaranteePaymentAccount = guaranteePaymentMethod === 'qr'
      ? normalizeLedgerPaymentAccount(
        contract?.guarantee?.paymentAccount
        ?? contract?.payment?.guaranteePaymentAccount
        ?? rental?.guarantee?.paymentAccount
        ?? rental?.payment?.guaranteePaymentAccount
        ?? '',
      )
      : '';
    const hasEconomicResetLedger = Array.isArray(resetLedgerOverride)
      || Boolean(contract?.economicResetAt)
      || Number(contract?.economicResetVersion ?? 0) >= 1
      || storedEconomicLedger.some((entry) => {
        const entryNote = normalizeText(entry?.note);
        return entryNote.includes('reset economico')
          || (entryNote.includes('conservad') && entryNote.includes('reset'));
      });
    const hasInitialPaymentEntry = initialPaymentBs > 0 && storedEconomicLedger.some((entry) => {
      if (entry.type !== 'deposit') return false;
      const entryId = normalizeText(entry.id);
      const entryNote = normalizeText(entry.note);
      const sameAmount = Math.abs(toMoneyNumber(entry.amountBs) - initialPaymentBs) < 0.01;
      return (
        sameAmount
        || String(entry.cashMovementId ?? '').trim()
        || String(entry.cashReceiptCode ?? '').trim()
        || entryId.includes('initial-payment')
        || entryNote.includes('pago inicial')
        || entryNote.includes('primer pago')
        || entryNote.includes('pimer pago')
      );
    });
    const hasValidatedGuaranteeEntry = guaranteeValidatedBs > 0 && storedEconomicLedger.some((entry) => {
      if (entry.type !== 'guarantee') return false;
      const entryId = normalizeText(entry.id);
      const entryNote = normalizeText(entry.note);
      const sameAmount = Math.abs(toMoneyNumber(entry.amountBs) - guaranteeValidatedBs) < 0.01;
      return (
        sameAmount
        || entryId.includes('validated-guarantee')
        || entryId.includes('garantia-validada')
        || entryNote.includes('garantia validada')
        || entryNote.includes('garantia ingresada')
        || entryNote.includes('ingreso garantia')
        || entryNote.includes('garantia separada')
      );
    });
    const economicLedgerBaseUnfiltered = [
      ...(initialPaymentBs > 0 && !hasEconomicResetLedger && !hasInitialPaymentEntry
        ? [{
          id: `initial-payment-${contract?.id ?? contract?.contractCode ?? rental?.id ?? 'contract'}`,
          type: 'deposit',
          amountBs: initialPaymentBs,
          paymentMethod: initialPaymentMethod,
          paymentAccount: initialPaymentAccount,
          note: 'Pago inicial registrado al crear el contrato.',
          createdAt: contract?.approvedAt
            ?? contract?.contractDate
            ?? contract?.createdAt
            ?? rental?.rentalAt
            ?? rental?.createdAt
            ?? new Date().toISOString(),
          createdByName: String(
            contract?.createdByName
            ?? rental?.createdByName
            ?? 'Sistema',
          ).trim() || 'Sistema',
          editedAt: null,
          editedByName: '',
        }]
        : []),
      ...(guaranteeValidatedBs > 0 && !hasEconomicResetLedger && !hasValidatedGuaranteeEntry
        ? [{
          id: `validated-guarantee-${contract?.id ?? contract?.contractCode ?? rental?.id ?? 'contract'}`,
          type: 'guarantee',
          amountBs: guaranteeValidatedBs,
          paymentMethod: guaranteePaymentMethod,
          paymentAccount: guaranteePaymentAccount,
          note: 'Garantia pagada registrada al crear el contrato.',
          createdAt: contract?.approvedAt
            ?? contract?.contractDate
            ?? contract?.createdAt
            ?? rental?.rentalAt
            ?? rental?.createdAt
            ?? new Date().toISOString(),
          createdByName: String(
            contract?.createdByName
            ?? rental?.createdByName
            ?? 'Sistema',
          ).trim() || 'Sistema',
          editedAt: null,
          editedByName: '',
        }]
        : []),
      ...storedEconomicLedger,
    ].sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));

    // Ultima barrera contra la duplicacion posterior al Reset economico.
    // La lista puede recibir una linea automatica antigua y otra recreada por
    // el Reset desde fuentes distintas. Solo se elimina la automatica legacy
    // cuando existe una linea de Reset del mismo tipo y exactamente el mismo monto.
    const resetReplacementKeys = new Set(
      economicLedgerBaseUnfiltered
        .filter((entry) => {
          const note = normalizeText(entry?.note);
          return note.includes('reset economico') && note.includes('conservad');
        })
        .map((entry) => `${entry.type}:${toMoneyNumber(entry.amountBs).toFixed(2)}`),
    );
    const economicLedgerBase = economicLedgerBaseUnfiltered.filter((entry) => {
      const replacementKey = `${entry.type}:${toMoneyNumber(entry.amountBs).toFixed(2)}`;
      if (!resetReplacementKeys.has(replacementKey)) return true;

      const note = normalizeText(entry?.note);
      if (note.includes('reset economico') && note.includes('conservad')) return true;

      const entryId = normalizeText(entry?.id);
      const isLegacyInitialPayment = entry.type === 'deposit' && (
        entryId.includes('initial-payment')
        || note === 'pago inicial registrado al crear el contrato.'
        || note === 'pago inicial registrado al crear el contrato'
      );
      const isLegacyValidatedGuarantee = entry.type === 'guarantee' && (
        entryId.includes('validated-guarantee')
        || entryId.includes('garantia-validada')
        || note === 'garantia pagada registrada al crear el contrato.'
        || note === 'garantia pagada registrada al crear el contrato'
      );
      return !isLegacyInitialPayment && !isLegacyValidatedGuarantee;
    });

    // Marca cada deposito del cuaderno que tiene un ingreso real en Caja Grande.
    // La asignacion es uno-a-uno para que un mismo recibo no pinte varias lineas.
    const cashRegistrationCandidates = postedMovements
      .filter((movement) => {
        const amountBs = Math.max(0, getCashMovementAmount(movement));
        if (amountBs <= 0) return false;
        const type = normalizeText(movement?.type);
        const tag = normalizeText(movement?.accountingTag);
        const category = normalizeText(movement?.category);
        const cashBoxType = normalizeText(movement?.cashBoxType);
        const receiptCode = String(movement?.receiptCode ?? movement?.receipt ?? '').trim();
        const isExpense = type.includes('egreso') || tag === 'guarantee_refund';
        const isBigCash = ['big_cash', 'caja_grande', 'cajagrande'].includes(cashBoxType);
        const isContractCollection = tag === 'contract_economic_collection'
          || category === 'cobro_contrato'
          || type.includes('cobro')
          || type.includes('ingreso');
        const isLedgerCashMovement = isGuaranteeMovement(movement)
          || (isContractCollection && (Boolean(receiptCode) || isBigCash || tag === 'contract_economic_collection'));
        return !isExpense && isLedgerCashMovement;
      })
      .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
    const refundRegistrationCandidates = postedMovements
      .filter((movement) => {
        const amountBs = Math.abs(getCashMovementAmount(movement));
        if (amountBs <= 0) return false;
        const type = normalizeText(movement?.type);
        const tag = normalizeText(movement?.accountingTag);
        const category = normalizeText(movement?.category);
        return tag === 'guarantee_refund'
          || category.includes('garantia_devuelta')
          || (type.includes('egreso') && isGuaranteeMovement(movement));
      })
      .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
    const usedCashMovementIds = new Set();
    const economicLedger = economicLedgerBase.map((entry, entryIndex) => {
      if (!['deposit', 'guarantee', 'refund'].includes(entry.type) || entry.amountBs <= 0) {
        return { ...entry, isCashRegistered: false };
      }
      const linkedMovementId = String(entry.cashMovementId ?? '').trim();
      if (linkedMovementId) {
        const linkedMovement = postedMovements.find((movement) => String(movement?.id ?? '') === linkedMovementId);
        if (!linkedMovement || !isVoidedCashMovement(linkedMovement)) {
          return {
            ...entry,
            isCashRegistered: true,
            cashReceiptCode: String(entry.cashReceiptCode ?? linkedMovement?.receiptCode ?? linkedMovement?.receipt ?? '').trim(),
            cashMovementId: linkedMovementId,
          };
        }
      }
      const entryMethod = normalizeLedgerPaymentMethod(entry.paymentMethod);
      const entryAccount = normalizeLedgerPaymentAccount(entry.paymentAccount);
      const entryDateMs = new Date(entry.createdAt ?? 0).getTime();
      const candidates = entry.type === 'refund' ? refundRegistrationCandidates : cashRegistrationCandidates;
      const matches = candidates
        .map((movement, movementIndex) => ({ movement, movementIndex }))
        .filter(({ movement, movementIndex }) => {
          const movementKey = String(movement?.id ?? `cash-${movementIndex}`);
          if (usedCashMovementIds.has(movementKey)) return false;
          if (Math.abs(Math.abs(getCashMovementAmount(movement)) - entry.amountBs) >= 0.01) return false;
          if (entry.type === 'refund') return true;
          if (entry.type === 'guarantee' && !isGuaranteeMovement(movement)) return false;
          if (entry.type === 'deposit' && isGuaranteeMovement(movement)) return false;
          const movementMethod = normalizeLedgerPaymentMethod(
            movement?.paymentMethod ?? movement?.method ?? movement?.payment?.method,
          );
          const movementAccount = normalizeLedgerPaymentAccount(
            movement?.paymentAccount ?? movement?.account ?? movement?.qrAccount,
          );
          const methodCompatible = !entryMethod || !movementMethod || entryMethod === movementMethod;
          const accountCompatible = entryMethod !== 'qr' || !entryAccount || !movementAccount || entryAccount === movementAccount;
          return methodCompatible && accountCompatible;
        })
        .sort(({ movement: left }, { movement: right }) => {
          const leftDateMs = new Date(left?.createdAt ?? 0).getTime();
          const rightDateMs = new Date(right?.createdAt ?? 0).getTime();
          const leftDistance = Number.isFinite(entryDateMs) && Number.isFinite(leftDateMs)
            ? Math.abs(leftDateMs - entryDateMs)
            : Number.MAX_SAFE_INTEGER;
          const rightDistance = Number.isFinite(entryDateMs) && Number.isFinite(rightDateMs)
            ? Math.abs(rightDateMs - entryDateMs)
            : Number.MAX_SAFE_INTEGER;
          return leftDistance - rightDistance;
        });
      const matchedMovement = matches[0]?.movement ?? null;
      if (!matchedMovement) {
        return { ...entry, isCashRegistered: false, cashReceiptCode: '', cashMovementId: null };
      }
      const matchedIndex = matches[0]?.movementIndex ?? entryIndex;
      const matchedKey = String(matchedMovement?.id ?? `cash-${matchedIndex}`);
      usedCashMovementIds.add(matchedKey);
      return {
        ...entry,
        isCashRegistered: true,
        cashReceiptCode: String(matchedMovement?.receiptCode ?? matchedMovement?.receipt ?? '').trim(),
        cashMovementId: matchedMovement?.id ?? null,
      };
    });
    const ledgerTotals = economicLedger.reduce((totals, entry) => {
      if (entry.type === 'deposit') totals.receivedBs += entry.amountBs;
      if (entry.type === 'guarantee') totals.guaranteeBs += entry.amountBs;
      if (entry.type === 'charge' && !isCashCollectedDamageLedgerEntry(entry)) totals.chargesBs += entry.amountBs;
      if (entry.type === 'refund' && isEconomicLedgerEntryConfirmedInCash(entry)) totals.refundedBs += entry.amountBs;
      return totals;
    }, {
      receivedBs: 0,
      guaranteeBs: 0,
      chargesBs: 0,
      refundedBs: 0,
    });
    const economicLedgerById = new Map(economicLedger.map((entry) => [String(entry.id), entry]));
    const ledgerConfirmedRentalBs = economicLedger.reduce((sum, entry) => (
      entry.type === 'deposit' && !entry.reclassifiedFromPayment && isEconomicLedgerEntryConfirmedInCash(entry)
        ? sum + toMoneyNumber(entry.amountBs)
        : sum
    ), 0);
    const ledgerAnnotatedRentalBs = economicLedger.reduce((sum, entry) => (
      entry.type === 'deposit' && !entry.reclassifiedFromPayment
        ? sum + toMoneyNumber(entry.amountBs)
        : sum
    ), 0);
    const ledgerConfirmedGuaranteeBs = economicLedger.reduce((sum, entry) => (
      isEconomicGuaranteeBackedByCash(entry, economicLedgerById)
        ? sum + toMoneyNumber(entry.amountBs)
        : sum
    ), 0);
    const backedGuaranteeEntries = economicLedger.filter((entry) => (
      isEconomicGuaranteeBackedByCash(entry, economicLedgerById)
    ));
    const latestBackedGuaranteeEntry = backedGuaranteeEntries.at(-1) ?? null;
    const ledgerAnnotatedGuaranteeBs = economicLedger.reduce((sum, entry) => (
      entry.type === 'guarantee'
        ? sum + toMoneyNumber(entry.amountBs)
        : sum
    ), 0);
    // Las lineas agregadas manualmente como deposito representan el dinero que
    // el cliente realmente entrego. Una linea eco-cash posterior respalda la
    // aplicacion/cobro con recibo, pero no vuelve a sumar el mismo dinero.
    const ledgerManualCustomerDepositsBs = economicLedger.reduce((sum, entry) => (
      entry.type === 'deposit' && !entry.reclassifiedFromPayment && !isGeneratedEconomicCollectionEntry(entry)
        ? sum + toMoneyNumber(entry.amountBs)
        : sum
    ), 0);
    const ledgerCustomerDepositsBs = Math.max(ledgerManualCustomerDepositsBs, ledgerConfirmedRentalBs);
    const ledgerUnregisteredRentalBs = Math.max(0, Number((ledgerAnnotatedRentalBs - ledgerConfirmedRentalBs).toFixed(2)));
    const ledgerUnregisteredGuaranteeBs = Math.max(0, Number((ledgerAnnotatedGuaranteeBs - ledgerConfirmedGuaranteeBs).toFixed(2)));
    const ledgerUnregisteredTotalBs = Number((ledgerUnregisteredRentalBs + ledgerUnregisteredGuaranteeBs).toFixed(2));
    const effectiveGuaranteeDeclaredBs = Math.max(guaranteeDeclaredBs, ledgerTotals.guaranteeBs);
    const effectiveGuaranteeValidatedBs = Math.max(guaranteeValidatedBs, ledgerConfirmedGuaranteeBs);
    const effectiveChargesBs = Math.max(0, penaltiesBs);
    const guaranteeReserveBs = Math.max(ledgerConfirmedGuaranteeBs, effectiveGuaranteeValidatedBs);
    const explicitlyReclassifiedGuaranteeBs = economicLedger.reduce((sum, entry) => (
      entry.type === 'guarantee'
        && (entry.reclassifiedFromPayment || String(entry.sourceDepositId ?? '').trim())
        ? sum + toMoneyNumber(entry.amountBs)
        : sum
    ), 0);
    // Compatibilidad con hojas anteriores: si ya habia depositos anotados y se
    // aparto una garantia, esa garantia salio de esos fondos aunque las versiones
    // antiguas no guardaran reclassifiedFromPayment=true.
    const guaranteeNotExplicitlyReclassifiedBs = economicLedger.reduce((sum, entry) => (
      entry.type === 'guarantee'
        && !entry.reclassifiedFromPayment
        && !String(entry.sourceDepositId ?? '').trim()
        && !isStandaloneEconomicGuarantee(entry)
        ? sum + toMoneyNumber(entry.amountBs)
        : sum
    ), 0);
    const inferredReclassifiedGuaranteeBs = Math.min(
      guaranteeNotExplicitlyReclassifiedBs,
      Math.max(0, Number((ledgerManualCustomerDepositsBs - explicitlyReclassifiedGuaranteeBs).toFixed(2))),
    );
    const reclassifiedGuaranteeBs = Number((
      explicitlyReclassifiedGuaranteeBs + inferredReclassifiedGuaranteeBs
    ).toFixed(2));
    const ledgerFundsAfterGuaranteeBs = Math.max(
      0,
      Number((ledgerManualCustomerDepositsBs - reclassifiedGuaranteeBs).toFixed(2)),
    );
    const ledgerRecordedRentalBs = Math.max(0, Number((ledgerConfirmedRentalBs - explicitlyReclassifiedGuaranteeBs).toFixed(2)));
    // La garantia retenida no cancela automaticamente los daños.
    // Solo se considera aplicada cuando existe una linea explicita de cargo
    // creada desde "Aplicar daños a garantia". Despues de un Reset economico,
    // esa linea ya no existe y los daños deben volver a mostrarse pendientes.
    const guaranteeAppliedToChargesBs = Math.min(
      guaranteeReserveBs,
      Math.max(0, ledgerTotals.chargesBs),
    );
    const uncoveredChargesBs = Math.max(
      0,
      Number((effectiveChargesBs - guaranteeAppliedToChargesBs).toFixed(2)),
    );
    // El total comercial del contrato no debe sumar nuevamente los daños.
    // Los daños se controlan como obligación separada para evitar que un contrato
    // totalmente pagado aparezca con saldo de alquiler.
    const ledgerChargeTargetBs = Number(totalBs.toFixed(2));
    const rentalReceivedBs = Math.min(
      ledgerChargeTargetBs,
      Math.max(
        paymentIncomeBs,
        collectionRegisteredBs,
        ledgerRecordedRentalBs,
      ),
    );
    const collectionTargetTotals = {
      rentalBs: Math.max(0, Number((totalBs - deliveryFeeBs).toFixed(2))),
      transportBs: Math.max(0, Number(deliveryFeeBs.toFixed(2))),
      damageBs: uncoveredChargesBs,
    };
    // Un pago general cubre el total comercial completo. Cuando no existe un
    // desglose explícito, se aplica primero a items/alquiler, luego a transporte
    // y finalmente a daños. Así, un pago completo que ya incluye el transporte
    // no vuelve a mostrarlo como pendiente en "Cobro separado con recibo".
    const explicitlyClassifiedCollectionBs = Number((
      toMoneyNumber(collectionByTarget.rentalBs)
      + toMoneyNumber(collectionByTarget.transportBs)
      + toMoneyNumber(collectionByTarget.damageBs)
    ).toFixed(2));
    // Los pagos iniciales y cobros generales históricos normalmente no tienen
    // desglose. El importe confirmado debe distribuirse entre items y transporte
    // antes de ofrecer esos conceptos para un nuevo cobro.
    const rentalCollectionOverflowBs = Math.max(
      0,
      Number((toMoneyNumber(collectionByTarget.rentalBs) - collectionTargetTotals.rentalBs).toFixed(2)),
    );
    const transportCollectionOverflowBs = Math.max(
      0,
      Number((toMoneyNumber(collectionByTarget.transportBs) - collectionTargetTotals.transportBs).toFixed(2)),
    );
    let unclassifiedCollectionBs = Math.max(
      0,
      toMoneyNumber(collectionByTarget.unclassifiedBs),
      Number((rentalReceivedBs - explicitlyClassifiedCollectionBs).toFixed(2)),
    );
    // Algunos recibos históricos registraron el pago completo como "items".
    // El excedente sobre el subtotal de items debe cubrir transporte, no perderse
    // ni convertirse en un nuevo saldo por cobrar.
    unclassifiedCollectionBs = Number((
      unclassifiedCollectionBs
      + rentalCollectionOverflowBs
      + transportCollectionOverflowBs
    ).toFixed(2));
    const effectiveCollectionByTarget = {
      rentalBs: Math.min(collectionTargetTotals.rentalBs, collectionByTarget.rentalBs),
      transportBs: Math.min(collectionTargetTotals.transportBs, collectionByTarget.transportBs),
      damageBs: Math.min(collectionTargetTotals.damageBs, collectionByTarget.damageBs),
    };
    const allocateUnclassifiedCollection = (key, totalKey) => {
      const pendingBs = Math.max(0, Number((collectionTargetTotals[totalKey] - effectiveCollectionByTarget[key]).toFixed(2)));
      const appliedBs = Math.min(pendingBs, unclassifiedCollectionBs);
      effectiveCollectionByTarget[key] = Number((effectiveCollectionByTarget[key] + appliedBs).toFixed(2));
      unclassifiedCollectionBs = Math.max(0, Number((unclassifiedCollectionBs - appliedBs).toFixed(2)));
    };
    allocateUnclassifiedCollection('rentalBs', 'rentalBs');
    allocateUnclassifiedCollection('transportBs', 'transportBs');
    // Un pago comercial general nunca cancela daños automáticamente.
    // Los daños requieren un cobro dirigido a daños o una aplicación explícita
    // de garantía mediante el único botón disponible en el estado superior.

    const collectionTargetPending = {
      rentalBs: Math.max(0, Number((collectionTargetTotals.rentalBs - effectiveCollectionByTarget.rentalBs).toFixed(2))),
      transportBs: Math.max(0, Number((collectionTargetTotals.transportBs - effectiveCollectionByTarget.transportBs).toFixed(2))),
      damageBs: Math.max(0, Number((collectionTargetTotals.damageBs - effectiveCollectionByTarget.damageBs).toFixed(2))),
    };
    const damagePendingBs = collectionTargetPending.damageBs;
    const damagesSettled = penaltiesBs > 0 && damagePendingBs <= 0.009;
    const ledgerFundsAvailableForRentalBs = Math.max(rentalReceivedBs, ledgerRecordedRentalBs);
    const ledgerAppliedToRentalBs = Math.min(ledgerFundsAvailableForRentalBs, ledgerChargeTargetBs);
    const ledgerDebtBs = Math.max(0, Number((ledgerChargeTargetBs - ledgerFundsAvailableForRentalBs).toFixed(2)));
    const ledgerGrossSurplusBs = Math.max(
      0,
      Number((ledgerFundsAvailableForRentalBs - ledgerChargeTargetBs).toFixed(2)),
    );
    const ledgerSurplusRefundedBs = economicLedger.reduce((sum, entry) => (
      entry.type === 'refund' && entry.refundSource === 'surplus' && isEconomicLedgerEntryConfirmedInCash(entry)
        ? sum + toMoneyNumber(entry.amountBs)
        : sum
    ), 0);
    const ledgerGuaranteeRefundedBs = economicLedger.reduce((sum, entry) => (
      entry.type === 'refund' && entry.refundSource !== 'surplus' && isEconomicLedgerEntryConfirmedInCash(entry)
        ? sum + toMoneyNumber(entry.amountBs)
        : sum
    ), 0);
    const excessPaymentBs = Math.max(
      0,
      ledgerGrossSurplusBs,
      toMoneyNumber(contract?.payment?.overpaidBs),
      toMoneyNumber(rental?.payment?.overpaidBs),
      toMoneyNumber(rental?.totals?.overpaidBs),
    );
    const effectiveGuaranteeRefundedBs = Math.max(ledgerGuaranteeRefundedBs, confirmedGuaranteeRefundBs);
    const effectiveRefundedBs = Number((effectiveGuaranteeRefundedBs + ledgerSurplusRefundedBs).toFixed(2));
    const ledgerRefundSuggestedBs = Math.max(0, Number((ledgerGrossSurplusBs - ledgerSurplusRefundedBs).toFixed(2)));
    const guaranteeRefundAvailableBs = Math.max(
      0,
      Number((guaranteeReserveBs - guaranteeAppliedToChargesBs - effectiveGuaranteeRefundedBs).toFixed(2)),
    );
    // Las obligaciones pendientes se muestran como contexto, pero NO consumen la
    // garantia automaticamente. La garantia solo baja cuando el usuario la aplica
    // explicitamente a danos (linea charge) o cuando registra una devolucion real.
    const guaranteePendingObligationsBs = Math.max(
      0,
      Number((ledgerDebtBs + damagePendingBs).toFixed(2)),
    );
    const guaranteeCommittedToPendingBs = 0;
    const guaranteeRefundableBs = guaranteeRefundAvailableBs;
    const totalRefundAvailableBs = Number((guaranteeRefundableBs + ledgerRefundSuggestedBs).toFixed(2));
    const availableDepositsForGuaranteeBs = Math.max(
      0,
      Number((ledgerCustomerDepositsBs - reclassifiedGuaranteeBs).toFixed(2)),
    );
    const realIncomeBs = Number((rentalReceivedBs + collectionByTarget.damageBs).toFixed(2));
    const totalManagedBs = Number((rentalTotalBs + effectiveGuaranteeDeclaredBs + deliveryFeeBs + servicesBs).toFixed(2));
    const usesLedgerBalance = economicLedger.length > 0;
    const effectivePaidBs = usesLedgerBalance
      ? rentalReceivedBs
      : paidBs;
    const paidOnAccountBs = Math.max(
      0,
      Number(rentalReceivedBs.toFixed(2)),
      Number(collectionRegisteredBs.toFixed(2)),
    );
    const separatelyCollectedGuaranteeBs = backedGuaranteeEntries.reduce((sum, entry) => (
      entry.reclassifiedFromPayment || String(entry.sourceDepositId ?? '').trim()
        ? sum
        : sum + toMoneyNumber(entry.amountBs)
    ), 0);
    const ledgerCashRegisteredBs = Number((ledgerConfirmedRentalBs + separatelyCollectedGuaranteeBs).toFixed(2));
    const cashRegisteredBs = Math.max(incomeBs, ledgerCashRegisteredBs);
    // El cobro general pendiente combina únicamente el saldo comercial real
    // y los daños todavía no cobrados. Nunca vuelve a incluir pagos ya recibidos.
    const cashToRegisterBs = Math.max(
      0,
      Number((ledgerDebtBs + damagePendingBs).toFixed(2)),
    );
    const cashCollectionSuggestedBs = cashToRegisterBs;
    const managedDebtBs = usesLedgerBalance
      ? ledgerDebtBs
      : Math.max(0, Number((totalBs - paidOnAccountBs).toFixed(2)));
    const effectiveBalanceBs = managedDebtBs;
    const balanceDetailLabel = usesLedgerBalance
      ? `Cobrado con recibo ${formatBs(rentalReceivedBs)} - garantia en caja ${formatBs(guaranteeReserveBs)}`
      : pendingPaymentBs > 0
      ? `Alquiler ${formatBs(outstandingRentalBs || totalBs)} + danos ${formatBs(penaltiesBs)} - garantia ${formatBs(effectiveGuaranteeValidatedBs)}`
      : `Total ${formatBs(totalBs)} - pagado ${formatBs(paidBs)}`;

    return {
      contract,
      linkedOrder,
      rental,
      movements,
      receipts,
      returnIssues,
      clientPendingPickup,
      clientPendingItems,
      clientPendingUnits,
      totalBs,
      rentalTotalBs,
      itemsGrossSubtotalBs,
      itemDiscountsBs,
      itemsNetSubtotalBs,
      servicesBs,
      totalManagedBs,
      paidBs: effectivePaidBs,
      paidOnAccountBs,
      managedDebtBs,
      collectionRegisteredBs,
      collectionByTarget,
      collectionTargetTotals,
      collectionTargetPending,
      damagePendingBs,
      damagesSettled,
      balanceBs: effectiveBalanceBs,
      cashRegisteredBs,
      cashToRegisterBs,
      cashCollectionSuggestedBs,
      guaranteeRefundAvailableBs,
      guaranteePendingObligationsBs,
      guaranteeCommittedToPendingBs,
      guaranteeRefundableBs,
      balanceDetailLabel,
      incomeBs,
      expenseBs,
      discountBs,
      deliveryFeeBs,
      prepaidUsedBs,
      economicLedger,
      ledgerTotals,
      confirmedGuaranteeRefundBs,
      effectiveRefundedBs,
      effectiveGuaranteeRefundedBs,
      ledgerConfirmedRentalBs,
      ledgerConfirmedGuaranteeBs,
      ledgerUnregisteredRentalBs,
      ledgerUnregisteredGuaranteeBs,
      ledgerUnregisteredTotalBs,
      ledgerAnnotatedRentalBs,
      ledgerAnnotatedGuaranteeBs,
      ledgerCustomerDepositsBs,
      ledgerFundsAfterGuaranteeBs,
      ledgerGrossSurplusBs,
      ledgerSurplusRefundedBs,
      totalRefundAvailableBs,
      availableDepositsForGuaranteeBs,
      ledgerAppliedToRentalBs,
      ledgerChargeTargetBs,
      ledgerDebtBs,
      ledgerRefundSuggestedBs,
      guaranteeReserveBs,
      guaranteeAppliedToChargesBs,
      uncoveredChargesBs,
      excessPaymentBs,
      reclassifiedGuaranteeBs,
      rentalReceivedBs,
      realIncomeBs,
      guaranteeDeclaredBs: effectiveGuaranteeDeclaredBs,
      guaranteeValidatedBs: effectiveGuaranteeValidatedBs,
      guaranteeStatus: effectiveGuaranteeDeclaredBs <= 0
        ? 'Sin garantia'
        : guaranteeAppliedToChargesBs >= guaranteeReserveBs && guaranteeReserveBs > 0
          ? 'Cobrada por danos'
          : effectiveGuaranteeRefundedBs > 0 && guaranteeRefundAvailableBs <= 0
            ? 'Devuelta'
            : rawGuaranteeStatus === 'validado' || ledgerTotals.guaranteeBs > 0
              ? 'Retenida'
              : 'Debe',
      guaranteeMethod: formatPaymentMethodLabel(
        latestBackedGuaranteeEntry?.paymentMethod
          ?? contract?.guarantee?.paymentMethod
          ?? contract?.payment?.guaranteePaymentMethod
          ?? rental?.guarantee?.paymentMethod,
        latestBackedGuaranteeEntry?.paymentAccount
          ?? contract?.guarantee?.paymentAccount
          ?? contract?.payment?.guaranteePaymentAccount
          ?? rental?.guarantee?.paymentAccount,
      ),
      penaltiesBs,
      outstandingRentalBs,
      refundBs,
      statusLabel: effectiveBalanceBs > 0
        ? 'Saldo pendiente'
        : ledgerRefundSuggestedBs > 0
          ? 'Excedente por devolver'
        : penaltiesBs > 0
          ? 'Liquidacion con cargos'
          : 'Sin saldo pendiente',
    };
  }, [activeEconomicResetLedger, effectiveCashMovements, contractEconomicsFullRental, contractEconomicsTarget, contracts, economicResetLedgerByContract, formatBs, orderRowsWithMeta, rentals]);

  const contractEconomicsCollectionOptions = useMemo(() => {
    if (!contractEconomicsData) return [];
    const pending = contractEconomicsData.collectionTargetPending ?? {};
    return [
      {
        key: 'rental',
        amountBs: toMoneyNumber(pending.rentalBs),
        detail: 'Solo items, alquiler y servicios del contrato.',
      },
      {
        key: 'transport',
        amountBs: toMoneyNumber(pending.transportBs),
        detail: 'Solo envio, recojo o logistica cobrada al cliente.',
      },
      {
        key: 'damage',
        amountBs: toMoneyNumber(pending.damageBs),
        detail: 'Solo cargos no cubiertos por garantia.',
      },
      {
        key: 'balance',
        amountBs: toMoneyNumber(contractEconomicsData.cashCollectionSuggestedBs),
        detail: 'Saldo completo pendiente, para casos generales.',
      },
    ].map((option) => ({
      ...option,
      ...(ECONOMIC_COLLECTION_TARGETS[option.key] ?? ECONOMIC_COLLECTION_TARGETS.balance),
    }));
  }, [contractEconomicsData]);

  const selectedContractEconomicsCollectionTargets = useMemo(
    () => normalizeEconomicCollectionTargets(contractEconomicsCollectionDraft.targets ?? contractEconomicsCollectionDraft.target),
    [contractEconomicsCollectionDraft.target, contractEconomicsCollectionDraft.targets],
  );

  const selectedContractEconomicsCollectionOptions = useMemo(() => {
    const selected = contractEconomicsCollectionOptions.filter((option) =>
      selectedContractEconomicsCollectionTargets.includes(option.key)
      && option.amountBs > 0);
    if (selected.length) return selected;
    const fallback = contractEconomicsCollectionOptions.find((option) => option.key === selectedContractEconomicsCollectionTargets[0])
      ?? contractEconomicsCollectionOptions[0]
      ?? { key: 'rental', amountBs: 0, ...ECONOMIC_COLLECTION_TARGETS.rental };
    return [fallback];
  }, [contractEconomicsCollectionOptions, selectedContractEconomicsCollectionTargets]);

  const selectedContractEconomicsCollectionAmountBs = useMemo(
    () => Number(selectedContractEconomicsCollectionOptions.reduce((sum, option) => sum + toMoneyNumber(option.amountBs), 0).toFixed(2)),
    [selectedContractEconomicsCollectionOptions],
  );

  const selectedContractEconomicsCollectionLabel = useMemo(
    () => selectedContractEconomicsCollectionOptions.map((option) => option.label).join(' + '),
    [selectedContractEconomicsCollectionOptions],
  );

  const selectedContractEconomicsCollectionButtonLabel = useMemo(
    () => selectedContractEconomicsCollectionOptions.length > 1
      ? 'seleccion'
      : (selectedContractEconomicsCollectionOptions[0]?.shortLabel ?? 'Items'),
    [selectedContractEconomicsCollectionOptions],
  );

  const contractQuoteIdSet = useMemo(
    () =>
      new Set(
        contractRows
          .map((row) => String(row.quoteId ?? '').trim())
          .filter(Boolean),
      ),
    [contractRows],
  );

  const activeQuoteHasContract = useMemo(() => {
    if (!activeQuoteMenuRow) return false;
    return contractQuoteIdSet.has(String(activeQuoteMenuRow.id ?? '').trim());
  }, [activeQuoteMenuRow, contractQuoteIdSet]);

  const documentsForSelectedOrder = useMemo(() => {
    const activeDocumentsOrder = deferredDocumentsOrder;
    if (!activeDocumentsOrder) return [];
    const isCenterDocument = (report) => {
      const sourceType = normalizeText(report?.sourceType ?? '');
      const reportName = normalizeText(report?.name ?? '');
      return sourceType === 'contrato'
        || sourceType === 'orden_inventario'
        || reportName.includes('contrato')
        || reportName.includes('inventario');
    };
    const directDocs = (documentsByOrderId.get(activeDocumentsOrder.id) ?? []).filter(isCenterDocument);
    if (directDocs.length) return directDocs;

    const tokens = [
      activeDocumentsOrder.rentalId,
      activeDocumentsOrder.orderCode,
      activeDocumentsOrder.contractId,
      activeDocumentsOrder.contractCode,
    ].map((entry) => String(entry ?? '').trim()).filter(Boolean);
    const normalizedTokens = tokens.map(normalizeText).filter(Boolean);
    return generatedReports
      .filter((report) => {
        const sourceId = String(report?.sourceId ?? '').trim();
        const reportName = normalizeText(report?.name ?? '');
        return isCenterDocument(report)
          && (tokens.includes(sourceId) || normalizedTokens.some((token) => reportName.includes(token)));
      })
      .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  }, [deferredDocumentsOrder, documentsByOrderId, generatedReports]);

  useEffect(() => {
    const activeDocumentsOrder = deferredDocumentsOrder;
    if (!activeDocumentsOrder) {
      setDocumentsFullContract(null);
      setDocumentsHistoryLoading(false);
      setDocumentsHistoryError('');
      return undefined;
    }

    const identifier = activeDocumentsOrder.contractId
      ?? activeDocumentsOrder.contractCode
      ?? activeDocumentsOrder.orderCode
      ?? '';
    if (!String(identifier).trim()) {
      setDocumentsFullContract(null);
      setDocumentsHistoryLoading(false);
      setDocumentsHistoryError('No se pudo identificar el contrato para cargar su historial.');
      return undefined;
    }

    let cancelled = false;
    setDocumentsFullContract(null);
    setDocumentsHistoryLoading(true);
    setDocumentsHistoryError('');

    api.contracts.ensureFull(identifier, 'documents-history')
      .then((fullContract) => {
        if (cancelled) return;
        setDocumentsFullContract(fullContract);
      })
      .catch((requestError) => {
        if (cancelled) return;
        setDocumentsFullContract(null);
        setDocumentsHistoryError(requestError.message || 'No se pudo cargar el historial completo del contrato.');
      })
      .finally(() => {
        if (!cancelled) setDocumentsHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [deferredDocumentsOrder]);

  const selectedDocumentsContract = useMemo(() => {
    const activeDocumentsOrder = deferredDocumentsOrder;
    if (!activeDocumentsOrder) return null;
    const priorities = [
      { field: 'id', value: activeDocumentsOrder.contractId },
      { field: 'rentalId', value: activeDocumentsOrder.rentalId },
      { field: 'contractCode', value: activeDocumentsOrder.contractCode },
      { field: 'orderCode', value: activeDocumentsOrder.orderCode },
    ];
    const fullMatch = documentsFullContract
      ? findByPriority([documentsFullContract], priorities)
      : null;
    return fullMatch ?? findByPriority(contracts, priorities);
  }, [contracts, deferredDocumentsOrder, documentsFullContract]);

  const selectedDocumentsChangeRows = useMemo(() => {
    const revisions = Array.isArray(selectedDocumentsContract?.revisionHistory)
      ? selectedDocumentsContract.revisionHistory
      : [];
    return revisions
      .slice()
      .sort((a, b) => new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0))
      .map((revision, index) => ({
        id: `${revision.updatedAt ?? 'revision'}-${index}`,
        updatedAt: revision.updatedAt,
        updatedBy: [revision.updatedByName || 'Sistema', revision.updatedByRole].filter(Boolean).join(' | '),
        changes: Array.isArray(revision.changes) && revision.changes.length > 0
          ? revision.changes
          : ['Cambio registrado sin detalle.'],
      }));
  }, [selectedDocumentsContract]);

  const selectedDocumentsContractRow = useMemo(() => {
    const activeDocumentsOrder = deferredDocumentsOrder;
    if (!activeDocumentsOrder && !selectedDocumentsContract) return null;
    const candidates = [...contractRows, ...hiddenContractRows];
    return findByPriority(candidates, [
      { field: 'id', value: selectedDocumentsContract?.id },
      { field: 'rentalId', value: selectedDocumentsContract?.rentalId },
      { field: 'contractCode', value: selectedDocumentsContract?.contractCode },
      { field: 'id', value: activeDocumentsOrder?.contractId },
      { field: 'rentalId', value: activeDocumentsOrder?.rentalId },
      { field: 'contractCode', value: activeDocumentsOrder?.contractCode },
      { field: 'orderCode', value: selectedDocumentsContract?.orderCode },
      { field: 'orderCode', value: activeDocumentsOrder?.orderCode },
    ]) ?? selectedDocumentsContract ?? null;
  }, [contractRows, deferredDocumentsOrder, hiddenContractRows, selectedDocumentsContract]);

  const selectedDocumentsClosureSummary = useMemo(() => {
    const activeDocumentsOrder = deferredDocumentsOrder;
    if (!activeDocumentsOrder && !selectedDocumentsContractRow) return null;
    const contract = selectedDocumentsContract ?? selectedDocumentsContractRow ?? {};
    const linkedOrder = orderRowsWithMeta.find((row) =>
      valuesMatch(row.contractId, contract.id)
      || valuesMatch(row.contractCode, contract.contractCode)
      || valuesMatch(row.orderCode, contract.orderCode)
      || valuesMatch(row.rentalId, contract.rentalId)
      || valuesMatch(row.id, activeDocumentsOrder?.id)
      || valuesMatch(row.orderCode, activeDocumentsOrder?.orderCode)
    ) ?? activeDocumentsOrder ?? null;
    const rental = rentals.find((entry) =>
      valuesMatch(entry.id, contract.rentalId)
      || valuesMatch(entry.contractId, contract.id)
      || valuesMatch(entry.contractCode, contract.contractCode)
      || valuesMatch(entry.orderCode, contract.orderCode)
      || valuesMatch(entry.id, linkedOrder?.rentalId)
      || valuesMatch(entry.orderCode, linkedOrder?.orderCode)
    ) ?? null;
    const cashReferences = {
      contractIds: [contract.id, linkedOrder?.contractId, rental?.contractId],
      rentalIds: [contract.rentalId, linkedOrder?.id, linkedOrder?.rentalId, rental?.id],
      contractCodes: [contract.contractCode, linkedOrder?.contractCode, rental?.contractCode],
      orderCodes: [contract.orderCode, linkedOrder?.orderCode, rental?.orderCode],
      createdAtMs: new Date(
        contract?.approvedAt ?? contract?.contractDate ?? contract?.createdAt ?? 0,
      ).getTime(),
    };
    const relatedMovements = effectiveCashMovements
      .filter((movement) => cashMovementMatchesContractReferences(movement, cashReferences))
      .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));
    const receiptCodes = relatedMovements
      .map((movement) => String(movement?.receiptCode ?? movement?.receipt ?? '').trim())
      .filter(Boolean);
    const ledger = (Array.isArray(contract?.economicLedger) ? contract.economicLedger : [])
      .map(normalizeEconomicLedgerEntry);
    const ledgerTotals = ledger.reduce((totals, entry) => {
      if (entry.type === 'deposit') totals.receivedBs += entry.amountBs;
      if (entry.type === 'guarantee') totals.guaranteeBs += entry.amountBs;
      if (entry.type === 'charge' && !isCashCollectedDamageLedgerEntry(entry)) totals.chargesBs += entry.amountBs;
      if (entry.type === 'refund' && isEconomicLedgerEntryConfirmedInCash(entry)) totals.refundedBs += entry.amountBs;
      return totals;
    }, { receivedBs: 0, guaranteeBs: 0, chargesBs: 0, refundedBs: 0 });
    const returnIssues = consolidateReturnIssueLines(
      Array.isArray(rental?.returnIssueSummary) && rental.returnIssueSummary.length > 0
        ? rental.returnIssueSummary
        : rental?.returnReport,
      rental?.id ?? contract?.id ?? 'contract',
    )
      .filter((line) =>
        toMoneyNumber(line?.damagedQty) > 0
        || toMoneyNumber(line?.missingQty) > 0
        || toMoneyNumber(line?.penaltyBs) > 0,
      );
    const dueBs = Math.max(0, toMoneyNumber(selectedDocumentsContractRow?.dueBs));
    const guaranteeStatus = selectedDocumentsContractRow?.guaranteeStatus ?? '';
    const isGuaranteeClosed = !selectedDocumentsContractRow?.guaranteeBs
      || ['returned', 'charged', 'none'].includes(guaranteeStatus)
      || ledgerTotals.refundedBs > 0
      || (ledgerTotals.chargesBs > 0 && ledgerTotals.guaranteeBs <= ledgerTotals.chargesBs);
    const isFinalized = finalizedContractOverrides.has(selectedDocumentsContractRow?.id)
      ? finalizedContractOverrides.get(selectedDocumentsContractRow.id)
      : Boolean(contract?.isFinalized ?? selectedDocumentsContractRow?.isFinalized);
    const isSent = Boolean(selectedDocumentsContractRow?.isSent || rental?.status === 'active' || linkedOrder?.inventoryStatus === 'enviado' || linkedOrder?.transportStatus === 'enviado');
    const isReturned = Boolean(selectedDocumentsContractRow?.isReturned || rental?.status === 'returned' || linkedOrder?.status === 'completed' || linkedOrder?.transportStatus === 'confirmado');
    const canClose = isReturned && dueBs <= 0 && isGuaranteeClosed;

    return {
      contract,
      linkedOrder,
      rental,
      dueBs,
      receiptCodes,
      receiptCount: receiptCodes.length,
      ledgerCount: ledger.length,
      ledgerTotals,
      returnIssues,
      hasDamages: returnIssues.length > 0 || ledgerTotals.chargesBs > 0,
      isSent,
      isReturned,
      isFinalized,
      canClose,
      guaranteeStatusLabel: selectedDocumentsContractRow?.guaranteeSecondary || 'Sin garantia',
      inventoryLabel: OPERATIONAL_STATUS_META[linkedOrder?.inventoryStatus]?.label ?? 'Pendiente',
      inventoryClass: OPERATIONAL_STATUS_META[linkedOrder?.inventoryStatus]?.className ?? 'pending',
      transportLabel: OPERATIONAL_STATUS_META[linkedOrder?.transportStatus]?.label ?? 'Pendiente',
      transportClass: OPERATIONAL_STATUS_META[linkedOrder?.transportStatus]?.className ?? 'pending',
      finalLabel: isFinalized
        ? 'Contrato terminado'
        : canClose
          ? 'Listo para finalizar'
          : 'Cierre pendiente',
    };
  }, [
    deferredDocumentsOrder,
    effectiveCashMovements,
    finalizedContractOverrides,
    orderRowsWithMeta,
    rentals,
    selectedDocumentsContract,
    selectedDocumentsContractRow,
  ]);

  const documentOverviewRows = useMemo(() => {
    const activeDocumentsOrder = deferredDocumentsOrder;
    if (!activeDocumentsOrder) return [];

    const findLatestReport = (sourceType, nameToken) =>
      documentsForSelectedOrder.find((doc) => doc.sourceType === sourceType)
      ?? documentsForSelectedOrder.find((doc) => normalizeText(doc.name).includes(nameToken))
      ?? null;

    const contractReport = findLatestReport('contrato', 'contrato');
    const inventoryReport = findLatestReport('orden_inventario', 'inventario');

    return [
      {
        id: 'contract',
        kind: 'contract',
        title: activeDocumentsOrder.contractCode ? `Contrato ${activeDocumentsOrder.contractCode}` : `Contrato ${activeDocumentsOrder.orderCode}`,
        description: activeDocumentsOrder.contractId ? 'Acuerdo comercial vinculado a la orden.' : 'Contrato pendiente de vincular.',
        status: activeDocumentsOrder.contractId ? 'Disponible' : 'Pendiente',
        statusClass: activeDocumentsOrder.contractId ? 'contract-approved' : 'contract-pending',
        generatedAt: contractReport?.generatedAt ?? null,
        format: contractReport?.format ?? 'PDF',
        latestReportId: contractReport?.id ?? null,
      },
      {
        id: 'inventory',
        kind: 'inventory',
        title: `Orden inventario ${activeDocumentsOrder.orderCode}`,
        description: 'Lista operativa para alistar, controlar y devolver items.',
        status: inventoryReport ? 'Generado' : 'Vista previa',
        statusClass: inventoryReport ? 'contract-approved' : 'quote-sent',
        generatedAt: inventoryReport?.generatedAt ?? null,
        format: inventoryReport?.format ?? 'PDF',
        latestReportId: inventoryReport?.id ?? null,
      },
    ];
  }, [deferredDocumentsOrder, documentsForSelectedOrder]);

  const historicalDocumentsForSelectedOrder = useMemo(() => {
    if (!deferredDocumentsOrder) return [];
    const latestReportIds = new Set(
      documentOverviewRows
        .map((entry) => String(entry.latestReportId ?? '').trim())
        .filter(Boolean),
    );
    return documentsForSelectedOrder.filter((doc) => !latestReportIds.has(String(doc.id ?? '').trim()));
  }, [deferredDocumentsOrder, documentOverviewRows, documentsForSelectedOrder]);

  const selectedOperationalOrder = useMemo(() => {
    if (!operationalOrder) return null;
    const currentRow = orderRowsWithMeta.find((row) => row.id === operationalOrder.id);
    if (!currentRow) return operationalOrder;
    return {
      ...operationalOrder,
      ...currentRow,
      items: (operationalOrder.items ?? []).length > 0
        ? operationalOrder.items
        : currentRow.items ?? [],
    };
  }, [operationalOrder, orderRowsWithMeta]);

  const toggleActionsMenu = (type, id, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 220;
    const menuHeight = type === 'quote' ? 268 : type === 'contract' ? 384 : 470;
    const openUp = window.innerHeight - rect.bottom < menuHeight + 18;
    const clampedLeft = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, rect.right - menuWidth));
    const top = openUp ? Math.max(12, rect.top - 8) : Math.max(12, rect.bottom + 8);

    const preview = menuPreviewRef.current;
    if (preview) {
      preview.style.display = 'block';
      preview.style.left = `${clampedLeft}px`;
      preview.style.top = `${top}px`;
      preview.style.transform = openUp ? 'translateY(-100%)' : 'none';
    }

    setMenuState((current) => {
      if (current?.type === type && current?.id === id) {
        if (preview) preview.style.display = 'none';
        return null;
      }
      return { type, id, top, left: clampedLeft, openUp };
    });
  };

  const metrics = useMemo(
    () => [
      {
        tone: 'sand',
        icon: 'quote',
        value: quoteCounts.enviada + quoteCounts.borrador,
        label: 'Cotizaciones abiertas',
        link: 'Ver cotizaciones',
        view: 'quotes',
        filter: 'all',
      },
      {
        tone: 'sky',
        icon: 'contract',
        value: contractCounts.all,
        label: 'Contratos totales',
        link: 'Ver contratos',
        view: 'contracts',
        filter: 'all',
      },
    ],
    [contractCounts, quoteCounts],
  );

  const workflowTabs = useMemo(
    () => [
      {
        id: 'quotes',
        icon: 'quote',
        title: 'Cotizaciones',
        subtitle: 'Pendientes de decision',
        count: quoteRows.length,
        badge: quoteNotificationCount,
        accent: 'quotes',
      },
      {
        id: 'contracts',
        icon: 'contract',
        title: 'Contratos',
        subtitle: 'Documentos comerciales',
        count: contractRows.length,
        badge: contractNotificationCount,
        accent: 'contracts',
      },
    ],
    [contractNotificationCount, contractRows.length, quoteNotificationCount, quoteRows.length],
  );

  const draftAvailabilityPeriod = useMemo(
    () => buildAvailabilityPeriod({
      deliveryDate: draft.deliveryDate || draft.eventDate,
      deliveryWindowStart: draft.deliveryWindowStart || draft.eventTime,
      pickupDate: draft.pickupTimeMode === 'coordinate' ? draft.eventDate : draft.pickupDate || draft.eventDate,
      pickupWindowEnd: draft.pickupTimeMode === 'coordinate' ? '23:59' : draft.pickupWindowEnd || draft.eventTime,
      eventDate: draft.eventDate,
      eventTime: draft.eventTime,
    }),
    [
      draft.deliveryDate,
      draft.deliveryWindowStart,
      draft.eventDate,
      draft.eventTime,
      draft.pickupDate,
      draft.pickupWindowEnd,
      draft.pickupTimeMode,
    ],
  );

  const availabilityByItemId = useMemo(
    () => {
      const needsAvailability = modalOpen && currentStep >= 2;
      if (!needsAvailability) return new Map();
      const draftContractCode = draft.entityType === 'contract'
        ? String(draft.manualDocumentCode ?? '').trim()
        : '';
      const draftRentalId = draft.entityType === 'contract'
        ? String(draft.rentalId ?? '').trim()
        : '';
      const draftOrderCode = draft.entityType === 'contract'
        ? String(draft.orderCode ?? '').trim()
        : '';
      const currentContract = draft.entityType === 'contract' && draft.recordId
        ? contracts.find((contract) => String(contract.id ?? '') === String(draft.recordId)) ?? null
        : null;
      const linkedRental = draft.entityType === 'contract' && (draft.recordId || draftContractCode || draftRentalId || draftOrderCode)
        ? rentals.find((rental) => (
          (draftRentalId && String(rental.id ?? '') === draftRentalId)
          || (draftOrderCode && String(rental.orderCode ?? '').trim() === draftOrderCode)
          || String(rental.contractId ?? '') === String(draft.recordId)
          || (draftContractCode && String(rental.contractCode ?? '').trim() === draftContractCode)
        ))
        : null;
      const excludeRentalId = draftRentalId || currentContract?.rentalId || linkedRental?.id || null;
      const excludeOrderCode = draftOrderCode || currentContract?.orderCode || linkedRental?.orderCode || null;
      const excludeContractCode = draftContractCode || currentContract?.contractCode || null;
      return getProjectedInventoryAvailability({
        items,
        rentals,
        contracts,
        quotes,
        period: draftAvailabilityPeriod,
        exclude: {
          recordId: draft.recordId,
          quoteId: draft.quoteId,
          contractId: draft.entityType === 'contract' ? draft.recordId : null,
          contractCode: excludeContractCode,
          rentalId: excludeRentalId,
          orderCode: excludeOrderCode,
        },
      });
    },
    [contracts, currentStep, draft.entityType, draft.manualDocumentCode, draft.orderCode, draft.recordId, draft.rentalId, draft.quoteId, draftAvailabilityPeriod, items, modalOpen, quotes, rentals],
  );

  const itemById = useMemo(
    () => new Map(items.map((item) => [String(item.id), item])),
    [items],
  );

  const selectedItems = useMemo(() => {
    const draftScheduleDays = (Array.isArray(draft.scheduleDays) && draft.scheduleDays.length > 0
      ? draft.scheduleDays
      : buildScheduleDaysFromRange(draft.deliveryDate || draft.eventDate, draft.pickupDate || draft.eventDate)
    ).map((day, index) => normalizeScheduleDay(day, index, draft.deliveryDate || draft.eventDate));
    const explicitComboPriceLineKeys = new Set();
    const firstComboLineKeyByGroup = new Map();
    draft.items.forEach((line, index) => {
      const comboLineKey = String(line?.comboLineKey ?? '').trim();
      if (!comboLineKey) return;
      const draftLineKey = getDraftLineKey(line, index);
      if (!firstComboLineKeyByGroup.has(comboLineKey)) {
        firstComboLineKeyByGroup.set(comboLineKey, draftLineKey);
      }
      if (String(line?.comboPricingRole ?? '').trim() === 'price') {
        explicitComboPriceLineKeys.add(draftLineKey);
      }
    });
    return draft.items
      .map((line, index) => {
        const item = itemById.get(String(line.itemId)) ?? (line.quickItem
          ? {
            id: line.itemId,
            name: [line.quickItem.name, line.quickItem.color, line.quickItem.material].filter(Boolean).join(' '),
            category: line.quickItem.category || 'Sin categoria',
            brand: line.quickItem.material || '',
            itemColor: line.quickItem.color || '',
            rentalPriceBs: Number(line.unitPriceBs ?? line.quickItem.rentalPriceBs ?? 0),
            availableStock: 0,
            totalStock: 0,
            controlsStock: line.controlsStock ?? false,
            verificationStatus: line.verificationStatus ?? 'pending_verification',
          }
          : null);
        if (!item) return null;
        const availability = availabilityByItemId.get(line.itemId) ?? null;
        const isCourtesyLine = line.lineType === 'courtesy';
        const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
        const lineKey = String(line.lineKey ?? line.comboLineKey ?? line.itemId);
        const comboLineKey = String(line.comboLineKey ?? '').trim();
        const storedComboPricingRole = String(line.comboPricingRole ?? '').trim();
        const comboPricingRole = comboLineKey
          ? storedComboPricingRole
            || (explicitComboPriceLineKeys.size > 0
              ? explicitComboPriceLineKeys.has(getDraftLineKey(line, index)) ? 'price' : 'component'
              : firstComboLineKeyByGroup.get(comboLineKey) === getDraftLineKey(line, index) ? 'price' : 'component')
          : storedComboPricingRole;
        const isIncludedComboComponent = Boolean(comboLineKey && comboPricingRole !== 'price');
        const explicitLineTotalBs = Number.isFinite(Number(line.lineTotalBs)) ? Math.max(0, Number(line.lineTotalBs)) : null;
        const explicitGrossLineTotalBs = Number.isFinite(Number(line.grossLineTotalBs)) ? Math.max(0, Number(line.grossLineTotalBs)) : null;
        const hasExplicitUnitPrice = line.unitPriceBs !== undefined
          && line.unitPriceBs !== null
          && line.unitPriceBs !== '';
        const rawUnitPriceBs = isIncludedComboComponent
          ? 0
          : hasExplicitUnitPrice
            ? Math.max(0, parseMoneyInput(line.unitPriceBs, 0))
            : Math.max(0, Number(line.rentalPriceBs ?? item.rentalPriceBs ?? 0));
        const recoveredUnitPriceBs = !isIncludedComboComponent && explicitLineTotalBs && quantity > 0
          ? Number((explicitLineTotalBs / quantity).toFixed(2))
          : 0;
        const unitPriceBs = isCourtesyLine || isIncludedComboComponent
          ? 0
          : hasExplicitUnitPrice
            ? rawUnitPriceBs
            : recoveredUnitPriceBs > 0
              ? recoveredUnitPriceBs
              : Math.max(0, Number(item.rentalPriceBs ?? 0));
        const grossLineTotalBs = isCourtesyLine || isIncludedComboComponent
          ? 0
          : explicitLineTotalBs !== null ? explicitLineTotalBs : quantity * unitPriceBs;
        const lineGrossTotalBs = isCourtesyLine || isIncludedComboComponent
          ? 0
          : explicitGrossLineTotalBs !== null ? explicitGrossLineTotalBs : grossLineTotalBs;
        const discountPercent = isCourtesyLine || isIncludedComboComponent ? 0 : Math.min(100, Math.max(0, Number(line.discountPercent ?? 0)));
        const lineDiscountBs = Number((lineGrossTotalBs * (discountPercent / 100)).toFixed(2));
        const serviceDay = findScheduleDayForLine(line, draftScheduleDays, draftScheduleDays[0] ?? null);
        return {
          ...line,
          lineKey,
          comboPricingRole,
          quantity,
          quantityInput: line.quantity === '' ? '' : String(line.quantity ?? quantity),
          unitPriceBs,
          unitPriceInput: line.unitPriceInput !== undefined
            ? String(line.unitPriceInput ?? '')
            : line.unitPriceBs === ''
              ? ''
              : String(line.unitPriceBs ?? unitPriceBs),
          item,
          availability,
          discountPercent,
          serviceDayId: serviceDay?.id ?? line.serviceDayId ?? '',
          serviceDate: serviceDay?.date ?? line.serviceDate ?? '',
          serviceDayLabel: serviceDay?.label ?? line.serviceDayLabel ?? '',
          grossLineTotalBs: lineGrossTotalBs,
          lineDiscountBs,
          lineTotalBs: isCourtesyLine || isIncludedComboComponent ? 0 : Number(Math.max(0, lineGrossTotalBs - lineDiscountBs).toFixed(2)),
        };
      })
      .filter(Boolean);
  }, [availabilityByItemId, draft.deliveryDate, draft.eventDate, draft.items, draft.pickupDate, draft.scheduleDays, itemById]);

  const selectedServices = useMemo(
    () => (draft.services ?? [])
      .map((service, index) => {
        const name = String(service?.name ?? '').trim();
        if (!name) return null;
        const quantity = Math.max(1, Math.trunc(Number(service?.quantity ?? 1)));
        const unitPriceBs = Math.max(0, Number(service?.unitPriceBs ?? 0));
        const draftScheduleDays = (Array.isArray(draft.scheduleDays) && draft.scheduleDays.length > 0
          ? draft.scheduleDays
          : buildScheduleDaysFromRange(draft.deliveryDate || draft.eventDate, draft.pickupDate || draft.eventDate)
        ).map((day, dayIndex) => normalizeScheduleDay(day, dayIndex, draft.deliveryDate || draft.eventDate));
        const serviceDay = findScheduleDayForLine(service, draftScheduleDays, draftScheduleDays[0] ?? null);
        return {
          ...service,
          id: service?.id ?? `service-${index}`,
          name,
          detail: String(service?.detail ?? '').trim(),
          quantity,
          unitPriceBs,
          serviceDayId: serviceDay?.id ?? service.serviceDayId ?? '',
          serviceDate: serviceDay?.date ?? service.serviceDate ?? '',
          serviceDayLabel: serviceDay?.label ?? service.serviceDayLabel ?? '',
          lineTotalBs: Number((quantity * unitPriceBs).toFixed(2)),
        };
      })
      .filter(Boolean),
    [draft.deliveryDate, draft.eventDate, draft.pickupDate, draft.scheduleDays, draft.services],
  );

  const normalizedScheduleDays = useMemo(() => {
    const source = Array.isArray(draft.scheduleDays) && draft.scheduleDays.length > 0
      ? draft.scheduleDays
      : buildScheduleDaysFromRange(draft.deliveryDate || draft.eventDate, draft.pickupDate || draft.eventDate);
    return source.map((day, index) => normalizeScheduleDay(day, index, draft.deliveryDate || draft.eventDate));
  }, [draft.deliveryDate, draft.eventDate, draft.pickupDate, draft.scheduleDays]);

  const activeScheduleDay = useMemo(
    () => normalizedScheduleDays.find((day) => day.id === activeScheduleDayId) ?? normalizedScheduleDays[0] ?? null,
    [activeScheduleDayId, normalizedScheduleDays],
  );

  const isDailyScheduleMode = draft.pricingMode === 'daily_schedule';

  const selectedItemsForActiveDay = useMemo(() => {
    if (!isDailyScheduleMode || !activeScheduleDay) return selectedItems;
    return selectedItems.filter((line) => String(line.serviceDayId ?? '') === String(activeScheduleDay.id));
  }, [activeScheduleDay, isDailyScheduleMode, selectedItems]);

  const selectedServicesForActiveDay = useMemo(() => {
    if (!isDailyScheduleMode || !activeScheduleDay) return selectedServices;
    return selectedServices.filter((service) => String(service.serviceDayId ?? '') === String(activeScheduleDay.id));
  }, [activeScheduleDay, isDailyScheduleMode, selectedServices]);

  const scheduleDayTotals = useMemo(() => {
    const map = new Map(normalizedScheduleDays.map((day) => [day.id, {
      ...day,
      itemCount: 0,
      itemSubtotalBs: 0,
      serviceSubtotalBs: 0,
      totalBs: 0,
    }]));
    selectedItems.forEach((line) => {
      const dayId = String(line.serviceDayId ?? normalizedScheduleDays[0]?.id ?? '');
      const current = map.get(dayId);
      if (!current) return;
      current.itemCount += 1;
      current.itemSubtotalBs = Number((current.itemSubtotalBs + Number(line.lineTotalBs ?? 0)).toFixed(2));
      current.totalBs = Number((current.totalBs + Number(line.lineTotalBs ?? 0)).toFixed(2));
    });
    selectedServices.forEach((service) => {
      const dayId = String(service.serviceDayId ?? normalizedScheduleDays[0]?.id ?? '');
      const current = map.get(dayId);
      if (!current) return;
      current.itemCount += 1;
      current.serviceSubtotalBs = Number((current.serviceSubtotalBs + Number(service.lineTotalBs ?? 0)).toFixed(2));
      current.totalBs = Number((current.totalBs + Number(service.lineTotalBs ?? 0)).toFixed(2));
    });
    return Array.from(map.values());
  }, [normalizedScheduleDays, selectedItems, selectedServices]);

  useEffect(() => {
    if (!modalOpen || !normalizedScheduleDays.length) return;
    if (normalizedScheduleDays.some((day) => day.id === activeScheduleDayId)) return;
    setActiveScheduleDayId(normalizedScheduleDays[0].id);
  }, [activeScheduleDayId, modalOpen, normalizedScheduleDays]);

  const selectedItemAreaGroups = useMemo(() => {
    const groupMap = new Map();
    const comboAreaByLineKey = new Map();
    selectedItemsForActiveDay.forEach((line) => {
      const comboLineKey = String(line?.comboLineKey ?? '').trim();
      if (!comboLineKey || comboAreaByLineKey.has(comboLineKey)) return;
      comboAreaByLineKey.set(comboLineKey, resolveWizardItemArea(line));
    });
    selectedItemsForActiveDay.forEach((line) => {
      const area = comboAreaByLineKey.get(String(line?.comboLineKey ?? '').trim()) ?? resolveWizardItemArea(line);
      const current = groupMap.get(area.key) ?? { area, lines: [] };
      current.lines.push(line);
      groupMap.set(area.key, current);
    });
    return [...groupMap.values()].sort((left, right) => left.area.order - right.area.order);
  }, [selectedItemsForActiveDay]);

  const selectedDemandByItemId = useMemo(() => {
    const map = new Map();
    if (isDailyScheduleMode) {
      const demandByItemAndDay = new Map();
      selectedItems.forEach((line) => {
        if (isDetachedFromInventory(line)) return;
        const itemId = String(line.itemId ?? '').trim();
        if (!itemId) return;
        const day = findScheduleDayForLine(line, normalizedScheduleDays, normalizedScheduleDays[0] ?? null);
        const dayId = String(day?.id ?? normalizedScheduleDays[0]?.id ?? 'default');
        const byDay = demandByItemAndDay.get(itemId) ?? new Map();
        byDay.set(dayId, (byDay.get(dayId) ?? 0) + Math.max(0, Number(line.quantity ?? 0)));
        demandByItemAndDay.set(itemId, byDay);
      });
      demandByItemAndDay.forEach((byDay, itemId) => {
        map.set(itemId, Math.max(0, ...Array.from(byDay.values())));
      });
      return map;
    }
    selectedItems.forEach((line) => {
      if (isDetachedFromInventory(line)) return;
      map.set(line.itemId, (map.get(line.itemId) ?? 0) + Math.max(0, Number(line.quantity ?? 0)));
    });
    return map;
  }, [isDailyScheduleMode, normalizedScheduleDays, selectedItems]);

  const editingContractCommitment = useMemo(() => {
    if (draft.entityType !== 'contract' || !draft.recordId) {
      return {
        enabled: false,
        quantityByItemId: new Map(),
        sourceStartDate: '',
        sourceEndDate: '',
      };
    }

    const contract = contracts.find(
      (entry) => String(entry?.id ?? '') === String(draft.recordId),
    ) ?? null;
    if (!contract) {
      return {
        enabled: false,
        quantityByItemId: new Map(),
        sourceStartDate: '',
        sourceEndDate: '',
      };
    }

    const contractCode = String(contract?.contractCode ?? '').trim();
    const rentalId = String(contract?.rentalId ?? '').trim();
    const orderCode = String(contract?.orderCode ?? '').trim();
    const linkedRental = rentals.find((rental) => (
      (rentalId && String(rental?.id ?? '') === rentalId)
      || String(rental?.contractId ?? '') === String(contract?.id ?? '')
      || (contractCode && String(rental?.contractCode ?? '').trim() === contractCode)
      || (orderCode && String(rental?.orderCode ?? '').trim() === orderCode)
    )) ?? null;

    const normalizedStatus = normalizeText(contract?.status);
    const hasOperationalCommitment = Boolean(
      linkedRental
      || contract?.rentalId
      || contract?.orderCode
      || normalizedStatus === 'aprobado'
      || normalizedStatus === 'approved'
    );
    if (!hasOperationalCommitment) {
      return {
        enabled: false,
        quantityByItemId: new Map(),
        sourceStartDate: '',
        sourceEndDate: '',
      };
    }

    const quantityByItemId = new Map();
    (Array.isArray(contract?.items) ? contract.items : []).forEach((line) => {
      const itemId = String(line?.itemId ?? '').trim();
      if (!itemId) return;
      const quantity = Math.max(0, Math.trunc(Number(line?.quantity ?? 0)));
      quantityByItemId.set(itemId, (quantityByItemId.get(itemId) ?? 0) + quantity);
    });

    const sourceStartDate = getDateKey(
      contract?.deliveryDate
      || linkedRental?.rentalDate
      || contract?.eventDate,
    );
    const sourceEndDate = getDateKey(
      contract?.pickupDate
      || linkedRental?.dueDate
      || contract?.eventDate,
    );

    return {
      enabled: quantityByItemId.size > 0,
      quantityByItemId,
      sourceStartDate,
      sourceEndDate,
    };
  }, [contracts, draft.entityType, draft.recordId, rentals]);

  const editingCommitmentMatchesCurrentPeriod = useMemo(() => {
    if (!editingContractCommitment.enabled) return false;

    const currentStartDate = getDateKey(draft.deliveryDate || draft.eventDate);
    const currentEndDate = getDateKey(
      draft.pickupTimeMode === 'coordinate'
        ? draft.eventDate
        : draft.pickupDate || draft.eventDate,
    );

    return Boolean(
      currentStartDate
      && currentEndDate
      && currentStartDate === editingContractCommitment.sourceStartDate
      && currentEndDate === editingContractCommitment.sourceEndDate
    );
  }, [
    draft.deliveryDate,
    draft.eventDate,
    draft.pickupDate,
    draft.pickupTimeMode,
    editingContractCommitment,
  ]);

  const getExistingCommittedQtyForEdit = useCallback((line) => {
    if (!editingCommitmentMatchesCurrentPeriod) return 0;
    const itemId = String(line?.itemId ?? line?.item?.id ?? '').trim();
    if (!itemId) return 0;
    return Math.max(
      0,
      Math.trunc(Number(editingContractCommitment.quantityByItemId.get(itemId) ?? 0)),
    );
  }, [editingCommitmentMatchesCurrentPeriod, editingContractCommitment]);

  const getEditableAvailableStock = useCallback((line) => Math.max(
    0,
    Number(line.availability?.projectedAvailable ?? line.item.availableStock ?? 0),
  ), []);

  const isHistoricalReconstruction = useMemo(() => {
    if (!canChooseResponsibles || draft.entityType !== 'contract' || draft.recordId) return false;
    if (draft.documentCodeMode !== 'manual') return false;
    // En una reconstruccion manual manda la fecha historica del evento.
    // pickupDate y deliveryDate nacen con valores futuros en el borrador nuevo y
    // no deben reactivar la validacion de stock/proveedor de una operacion pasada.
    const historicalEventDate = getDateKey(draft.eventDate || draft.contractDate);
    const todayKey = getDateKey(new Date());
    return Boolean(historicalEventDate && todayKey && historicalEventDate < todayKey);
  }, [
    canChooseResponsibles,
    draft.contractDate,
    draft.documentCodeMode,
    draft.entityType,
    draft.eventDate,
    draft.recordId,
  ]);

  const isHistoricalReturnedContractEdit = useMemo(() => {
    if (draft.entityType !== 'contract' || !draft.recordId) return false;

    const contract = contracts.find(
      (entry) => String(entry?.id ?? '') === String(draft.recordId),
    ) ?? null;
    if (!contract) return false;

    const linkedRental = rentals.find((rental) => (
      String(rental?.id ?? '') === String(contract?.rentalId ?? '')
      || String(rental?.contractId ?? '') === String(contract?.id ?? '')
      || (contract?.orderCode && String(rental?.orderCode ?? '') === String(contract.orderCode))
    )) ?? null;
    if (!linkedRental) return false;

    const rentalStatus = normalizeText(linkedRental?.status);
    const inventoryStatus = normalizeText(linkedRental?.operational?.inventoryStatus);
    return rentalStatus === 'returned' || inventoryStatus === 'devuelto';
  }, [contracts, draft.entityType, draft.recordId, rentals]);

  const bypassStockValidation = isHistoricalReconstruction || isHistoricalReturnedContractEdit;

  const stockIssues = useMemo(
    () => {
      // La disponibilidad pesada se calcula desde el paso Items (currentStep >= 2).
      // En Cliente/Evento availabilityByItemId queda vacio a proposito para no hacer
      // trabajo innecesario; por eso no debemos interpretar availableStock=0 como faltante.
      if (currentStep < 2 || bypassStockValidation) return [];
      return selectedItems.filter((line) => {
        if (isDetachedFromInventory(line)) return false;
        const available = getEditableAvailableStock(line);
        const requestedForItem = Math.max(0, Number(selectedDemandByItemId.get(line.itemId) ?? line.quantity));
        return requestedForItem > available;
      });
    },
    [bypassStockValidation, currentStep, getEditableAvailableStock, selectedDemandByItemId, selectedItems],
  );

  const supplierOffersByItemId = useMemo(() => {
    const map = new Map();
    const supplierById = new Map(
      (supplierBundle?.suppliers ?? []).map((supplier) => [String(supplier.id), supplier]),
    );
    const quotesSorted = [...(supplierBundle?.quotes ?? [])]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    quotesSorted.forEach((quote) => {
      const quoteSupplierId = String(quote?.supplierId ?? '').trim();
      const quoteSupplierName = String(quote?.supplierName ?? supplierById.get(quoteSupplierId)?.name ?? '').trim();
      (quote?.items ?? []).forEach((line, lineIndex) => {
        const explicitItemId = String(line?.itemId ?? '').trim();
        const lineName = String(line?.itemName ?? '').trim();
        const resolvedItemId = explicitItemId || items.find((entry) => normalizeText(entry.name) === normalizeText(lineName))?.id || '';
        if (!resolvedItemId) return;

        const offer = {
          offerKey: `${quote?.id ?? 'quote'}-${line?.id ?? lineIndex}`,
          itemId: resolvedItemId,
          itemName: lineName,
          supplierId: quoteSupplierId,
          supplierName: quoteSupplierName || 'Proveedor',
          supplierQuoteId: quote?.id ?? null,
          supplierQuoteCode: quote?.quoteCode ?? null,
          supplierUnitCostBs: Math.max(0, Number(line?.unitPriceBs ?? 0)),
          createdAt: quote?.createdAt ?? null,
        };
        if (!offer.supplierId) return;
        const current = map.get(resolvedItemId) ?? [];
        current.push(offer);
        map.set(resolvedItemId, current);
      });
    });

    map.forEach((offers, itemId) => {
      const unique = [];
      const seen = new Set();
      offers
        .slice()
        .sort((a, b) => {
          if (a.supplierUnitCostBs !== b.supplierUnitCostBs) return a.supplierUnitCostBs - b.supplierUnitCostBs;
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        })
        .forEach((offer) => {
          const key = `${offer.supplierId}|${offer.supplierQuoteId}|${offer.supplierUnitCostBs}`;
          if (seen.has(key)) return;
          seen.add(key);
          unique.push(offer);
        });
      map.set(itemId, unique);
    });

    return map;
  }, [items, supplierBundle?.quotes, supplierBundle?.suppliers]);

  useEffect(() => {
    if (!modalOpen) {
      supplierCoverageHydrationKeyRef.current = '';
      return;
    }
    if (isHistoricalReconstruction) {
      supplierCoverageHydrationKeyRef.current = '';
      setSupplierFulfillmentDraftByItem({});
      return;
    }
    const sourcePlan = Array.isArray(draft.supplierFulfillmentPlan) ? draft.supplierFulfillmentPlan : [];
    const hydrationKey = `${draft.recordId || 'new'}|${sourcePlan
      .map((line) => [
        line?.lineKey ?? '',
        line?.itemId ?? '',
        line?.supplierId ?? '',
        line?.supplierName ?? '',
        line?.neededQty ?? '',
        line?.supplierUnitCostBs ?? '',
      ].join(':'))
      .join(';')}`;
    if (supplierCoverageHydrationKeyRef.current === hydrationKey) return;
    supplierCoverageHydrationKeyRef.current = hydrationKey;
    setSupplierFulfillmentDraftByItem(buildSupplierCoverageDraftByItem(sourcePlan));
  }, [draft.recordId, draft.supplierFulfillmentPlan, isHistoricalReconstruction, modalOpen]);

  useEffect(() => {
    if (!modalOpen || currentStep < 2) return;
    if (isHistoricalReconstruction) {
      setSupplierFulfillmentDraftByItem({});
      return;
    }
    if (isHistoricalReturnedContractEdit) return;
    setSupplierFulfillmentDraftByItem((current) => {
      const next = { ...current };
      const validCoverageKeys = new Set(selectedItems.flatMap((line) => [
        getSupplierCoverageKey(line),
        String(line.itemId),
      ]));

      Object.keys(next).forEach((coverageKey) => {
        if (!validCoverageKeys.has(coverageKey)) delete next[coverageKey];
      });

      selectedItems.forEach((line) => {
        const coverageKey = getSupplierCoverageKey(line);
        const legacyItemKey = String(line.itemId);
        if (isDetachedFromInventory(line)) {
          delete next[coverageKey];
          if (coverageKey !== legacyItemKey) delete next[legacyItemKey];
          return;
        }
        const available = getEditableAvailableStock(line);
        const shortage = Math.max(0, line.quantity - available);
        const existingCoverages = normalizeCoverageDraftLines(next[coverageKey] ?? next[legacyItemKey]);
        if (coverageKey !== legacyItemKey && next[legacyItemKey]) delete next[legacyItemKey];
        if (shortage <= 0 && existingCoverages.length === 0) {
          delete next[coverageKey];
          return;
        }

        const offers = supplierOffersByItemId.get(legacyItemKey) ?? [];
        const fallbackOffer = offers[0] ?? null;
        const normalizedCoverages = existingCoverages.map((entry) => ({
          ...entry,
          lineKey: coverageKey !== legacyItemKey ? coverageKey : entry.lineKey ?? null,
          neededQty: Math.max(1, Math.trunc(Number(entry.neededQty ?? 1))),
          supplierUnitCostBs: Math.max(0, Number(entry.supplierUnitCostBs ?? fallbackOffer?.supplierUnitCostBs ?? 0)),
        }));
        const coveredQty = normalizedCoverages
          .filter((entry) => !entry.manualCoverage)
          .reduce((sum, line) => sum + Math.max(0, Math.trunc(Number(line.neededQty ?? 0))), 0);
        const maxCoverageQty = Math.max(0, Math.trunc(Number(line.quantity ?? 0)));
        if (coveredQty > maxCoverageQty) {
          let remaining = maxCoverageQty;
          next[coverageKey] = {
            coverages: normalizedCoverages
              .map((entry) => {
                if (entry.manualCoverage) return entry;
                const quantity = Math.min(Math.max(0, remaining), Math.max(0, Math.trunc(Number(entry.neededQty ?? 0))));
                remaining -= quantity;
                return { ...entry, neededQty: quantity };
              })
              .filter((entry) => entry.neededQty > 0),
          };
          return;
        }
        next[coverageKey] = { coverages: normalizedCoverages };
      });

      return next;
    });
  }, [currentStep, getEditableAvailableStock, isHistoricalReconstruction, isHistoricalReturnedContractEdit, modalOpen, selectedItems, supplierOffersByItemId]);

  const supplierCoverageRows = useMemo(
    () => {
      // Igual que stockIssues: en Cliente/Evento no existe disponibilidad proyectada
      // porque se calcula recién desde Items. No debemos convertir el availableStock
      // físico (que puede ser 0 por el propio contrato) en un faltante de proveedor.
      if (currentStep < 2 || bypassStockValidation) return [];
      const processedLineKeys = new Set();
      return selectedItems
        .map((line) => {
        if (isDetachedFromInventory(line)) return null;
        const coverageKey = getSupplierCoverageKey(line);
        if (processedLineKeys.has(coverageKey)) return null;
        processedLineKeys.add(coverageKey);
        const available = getEditableAvailableStock(line);
        const requestedForItem = Math.max(0, Number(selectedDemandByItemId.get(line.itemId) ?? line.quantity));
        const shortageQty = Math.max(0, requestedForItem - available);
        const coverageLines = normalizeCoverageDraftLines(supplierFulfillmentDraftByItem[coverageKey] ?? supplierFulfillmentDraftByItem[line.itemId]);
        const validCoverageLines = coverageLines.filter((entry) => entry.supplierId && entry.supplierName && entry.neededQty > 0);
        const plannedCoveredQty = validCoverageLines.reduce((sum, entry) => sum + Math.max(0, Math.trunc(Number(entry.neededQty ?? 0))), 0);
        const manualCoveredQty = validCoverageLines
          .filter((entry) => entry.manualCoverage)
          .reduce((sum, entry) => sum + Math.max(0, Math.trunc(Number(entry.neededQty ?? 0))), 0);
        const effectiveShortageQty = Math.max(shortageQty, Math.min(requestedForItem + manualCoveredQty, plannedCoveredQty));
        if (effectiveShortageQty <= 0) return null;
        const coveredQty = Math.min(
          effectiveShortageQty,
          plannedCoveredQty,
        );
        return {
          lineKey: line.lineKey,
          itemId: line.itemId,
          itemName: line.item.name,
          saleUnitPriceBs: line.unitPriceBs,
          effectiveSaleUnitPriceBs: getSupplierCoverageEffectiveSaleUnitPriceBs(line),
          saleDiscountPercent: clampPercentValue(line.discountPercent),
          manualSaleQty: manualCoveredQty,
          shortageQty: effectiveShortageQty,
          coveredQty,
          uncoveredQty: Math.max(0, effectiveShortageQty - coveredQty),
          coverages: validCoverageLines,
        };
      })
        .filter(Boolean);
    },
    [bypassStockValidation, currentStep, getEditableAvailableStock, selectedDemandByItemId, selectedItems, supplierFulfillmentDraftByItem],
  );

  const getDisplayedItemSubtotalBs = useCallback((line) => {
    const baseLineTotalBs = Math.max(0, Number(line?.lineTotalBs ?? 0));
    const coverageKey = getSupplierCoverageKey(line);
    const coverageLines = normalizeCoverageDraftLines(
      supplierFulfillmentDraftByItem[coverageKey] ?? supplierFulfillmentDraftByItem[line?.itemId],
    );
    const manualCoveredQty = coverageLines
      .filter((coverage) => coverage?.manualCoverage)
      .reduce(
        (sum, coverage) => sum + Math.max(0, Math.trunc(Number(coverage?.neededQty ?? 0))),
        0,
      );
    if (manualCoveredQty <= 0) return baseLineTotalBs;
    const effectiveSaleUnitPriceBs = getSupplierCoverageEffectiveSaleUnitPriceBs(line);
    return Number((baseLineTotalBs + (manualCoveredQty * effectiveSaleUnitPriceBs)).toFixed(2));
  }, [supplierFulfillmentDraftByItem]);

  const uncoveredStockIssues = useMemo(
    () => supplierCoverageRows.filter((line) => line.uncoveredQty > 0),
    [supplierCoverageRows],
  );

  const supplierCoverageTotals = useMemo(() => {
    const coveredLines = supplierCoverageRows.flatMap((line) => line.coverages.map((coverage) => ({
      ...coverage,
      saleUnitPriceBs: line.effectiveSaleUnitPriceBs,
      baseSaleUnitPriceBs: line.saleUnitPriceBs,
      saleDiscountPercent: line.saleDiscountPercent,
      discountApplied: line.saleDiscountPercent > 0,
    })));
    const totalCoveredQty = coveredLines.reduce((sum, line) => sum + Math.max(0, Math.trunc(Number(line.neededQty ?? 0))), 0);
    const totalCostBs = coveredLines.reduce((sum, line) => sum + (Math.max(0, Math.trunc(Number(line.neededQty ?? 0))) * Math.max(0, Number(line.supplierUnitCostBs ?? 0))), 0);
    const totalSaleBs = coveredLines.reduce((sum, line) => sum + (Math.max(0, Math.trunc(Number(line.neededQty ?? 0))) * Math.max(0, Number(line.saleUnitPriceBs ?? 0))), 0);
    const manualSaleBs = coveredLines
      .filter((line) => line.manualCoverage)
      .reduce((sum, line) => sum + (Math.max(0, Math.trunc(Number(line.neededQty ?? 0))) * Math.max(0, Number(line.saleUnitPriceBs ?? 0))), 0);
    return {
      lines: coveredLines.length,
      totalCoveredQty,
      totalCostBs: Number(totalCostBs.toFixed(2)),
      totalSaleBs: Number(totalSaleBs.toFixed(2)),
      manualSaleBs: Number(manualSaleBs.toFixed(2)),
      totalMarginBs: Number((totalSaleBs - totalCostBs).toFixed(2)),
    };
  }, [supplierCoverageRows]);

  const returnSummaryRows = useMemo(() => {
    const grouped = new Map();
    availabilityByItemId.forEach((summary) => {
      (summary.returningBeforeStartQtyRecords ?? []).forEach((record) => {
        const key = `${record.id || record.code || 'retorno'}|${record.endDate || ''}|${record.endTime || ''}`;
        const current = grouped.get(key) ?? {
          key,
          code: record.code || 'Orden previa',
          date: record.endDate,
          time: record.endTime,
          quantity: 0,
          itemNames: new Set(),
        };
        current.quantity += Math.max(0, Number(record.quantity ?? 0));
        if (summary.itemName) current.itemNames.add(summary.itemName);
        grouped.set(key, current);
      });
    });

    return Array.from(grouped.values())
      .sort((a, b) => `${a.date || ''} ${a.time || ''}`.localeCompare(`${b.date || ''} ${b.time || ''}`))
      .slice(0, 3)
      .map((row) => ({
        ...row,
        itemText: Array.from(row.itemNames).slice(0, 2).join(', '),
      }));
  }, [availabilityByItemId]);

  const grossItemsSubtotalBs = useMemo(
    () => selectedItems.reduce((sum, line) => sum + Number(line.grossLineTotalBs ?? line.lineTotalBs ?? 0), 0)
      + supplierCoverageTotals.manualSaleBs,
    [selectedItems, supplierCoverageTotals.manualSaleBs],
  );

  const itemDiscountsBs = useMemo(
    () => selectedItems.reduce((sum, line) => sum + Number(line.lineDiscountBs ?? line.discountBs ?? 0), 0),
    [selectedItems],
  );

  const baseItemsSubtotalBs = useMemo(
    () => selectedItems.reduce((sum, line) => sum + line.lineTotalBs, 0) + supplierCoverageTotals.manualSaleBs,
    [selectedItems, supplierCoverageTotals.manualSaleBs],
  );

  const servicesSubtotalBs = useMemo(
    () => selectedServices.reduce((sum, line) => sum + line.lineTotalBs, 0),
    [selectedServices],
  );

  const durationPricing = useMemo(
    () => calculateDurationPricing({
      mode: draft.pricingMode,
      days: draft.pricingDays,
      tiers: draft.pricingTiers,
      baseSubtotalBs: baseItemsSubtotalBs,
    }),
    [baseItemsSubtotalBs, draft.pricingDays, draft.pricingMode, draft.pricingTiers],
  );

  const quoteSubtotalBs = durationPricing.chargeableSubtotalBs + servicesSubtotalBs;
  const generalDiscountBaseBs = durationPricing.chargeableSubtotalBs;

  const quotePricingPlan = useMemo(
    () => ({
      mode: durationPricing.mode,
      days: durationPricing.mode === 'daily_schedule' ? normalizedScheduleDays.length : durationPricing.days,
      tiers: durationPricing.tiers.map((tier) => ({
        fromDay: tier.fromDay,
        toDay: tier.toDay,
        percent: tier.percent,
      })),
      scheduleDays: durationPricing.mode === 'daily_schedule'
        ? scheduleDayTotals.map((day) => ({
          id: day.id,
          label: day.label,
          date: day.date,
          note: day.note,
          itemCount: day.itemCount,
          itemSubtotalBs: day.itemSubtotalBs,
          serviceSubtotalBs: day.serviceSubtotalBs,
          subtotalBs: day.totalBs,
        }))
        : [],
      baseSubtotalBs: durationPricing.baseSubtotalBs,
      theoreticalSubtotalBs: durationPricing.theoreticalSubtotalBs,
      chargeableSubtotalBs: durationPricing.chargeableSubtotalBs,
      durationDiscountBs: durationPricing.durationDiscountBs,
      effectiveMultiplier: durationPricing.effectiveMultiplier,
    }),
    [durationPricing, normalizedScheduleDays.length, scheduleDayTotals],
  );

  const durationTierSummaryRows = useMemo(() => {
    if (durationPricing.mode !== 'duration') return [];
    const groups = [];
    durationPricing.breakdown.forEach((entry) => {
      const previous = groups[groups.length - 1];
      if (previous && previous.percent === entry.percent && previous.endDay === entry.day - 1) {
        previous.endDay = entry.day;
        previous.days += 1;
        previous.totalBs = Number((previous.totalBs + entry.amountBs).toFixed(2));
        return;
      }

      groups.push({
        startDay: entry.day,
        endDay: entry.day,
        days: 1,
        percent: entry.percent,
        amountPerDayBs: entry.amountBs,
        totalBs: entry.amountBs,
      });
    });

    return groups.map((group) => ({
      ...group,
      label: group.startDay === group.endDay ? `Dia ${group.startDay}` : `Dias ${group.startDay}-${group.endDay}`,
    }));
  }, [durationPricing]);

  const sideSummaryClient = draft.customerName.trim() || 'Cliente sin seleccionar';
  const sideSummaryClientMeta = draft.customerPhone.trim() || draft.companyName.trim() || 'Sin WhatsApp registrado';
  const sideSummaryEvent = draft.eventType.trim() || 'Evento sin tipo';
  const sideSummaryEventMeta = draft.eventDate
    ? `${formatDate(draft.eventDate)}${draft.eventTime ? ` | ${draft.eventTime}` : ''}`
    : 'Fecha pendiente';
  const sideSummaryAddress = [draft.address, draft.city].filter(Boolean).join(', ') || 'Direccion pendiente';

  const quoteDeliveryFeeBs = useMemo(() => {
    if (draft.logisticsMode !== 'envio' || draft.deliveryChargeMode !== 'extra') return 0;
    const parsed = Number(draft.deliveryFeeBs ?? 0);
    return Math.max(0, Number.isFinite(parsed) ? parsed : 0);
  }, [draft.deliveryChargeMode, draft.deliveryFeeBs, draft.logisticsMode]);

  const generalDiscountMode = draft.discountMode === 'fixed' ? 'fixed' : 'percent';
  const generalDiscountPercent = generalDiscountMode === 'percent'
    ? Math.min(100, Math.max(0, Number(draft.discountPercent ?? 0)))
    : 0;
  const generalDiscountBs = useMemo(() => {
    if (generalDiscountMode === 'fixed') {
      const fixedDiscountBs = Math.max(0, Number(draft.discountBs ?? 0));
      return Number(Math.min(generalDiscountBaseBs, fixedDiscountBs).toFixed(2));
    }
    return Number((generalDiscountBaseBs * (generalDiscountPercent / 100)).toFixed(2));
  }, [draft.discountBs, generalDiscountBaseBs, generalDiscountMode, generalDiscountPercent]);
  const paidAtApprovalBs = Math.max(0, Number(draft.paidAtApprovalBs ?? 0));

  const quoteTotalBs = useMemo(() => (
    Math.max(0, quoteSubtotalBs - generalDiscountBs + quoteDeliveryFeeBs)
  ), [generalDiscountBs, quoteDeliveryFeeBs, quoteSubtotalBs]);

  const pendingAtApprovalBs = useMemo(() => {
    return Math.max(0, quoteTotalBs - paidAtApprovalBs);
  }, [paidAtApprovalBs, quoteTotalBs]);

  const overpaidAtApprovalBs = useMemo(() => {
    return Math.max(0, Number((paidAtApprovalBs - quoteTotalBs).toFixed(2)));
  }, [paidAtApprovalBs, quoteTotalBs]);

  const selectedClientForDraft = useMemo(
    () => clients.find((client) => client.id === draft.clientId) ?? null,
    [clients, draft.clientId],
  );

  const filteredClientOptions = useMemo(() => {
    const query = normalizeText(clientSearchQuery).trim();
    const tokens = query.split(/\s+/).filter(Boolean);
    return clients
      .map((client) => {
        const name = normalizeText(client.name);
        const company = normalizeText(client.companyName);
        const ci = normalizeText(client.nitCi || client.customerCi);
        const phone = normalizeText(client.whatsapp || client.phone);
        const referencePhone = normalizeText(client.referencePhone);
        const searchable = [name, company, ci, phone, referencePhone].filter(Boolean).join(' ');
        if (tokens.some((token) => !searchable.includes(token))) return null;

        let score = 0;
        if (query) {
          if (name === query) score += 1000;
          else if (name.startsWith(query)) score += 700;
          else if (name.split(' ').some((word) => word.startsWith(query))) score += 560;
          else if (name.includes(query)) score += 420;
          if (company.includes(query)) score += 220;
          if (ci.includes(query) || phone.includes(query) || referencePhone.includes(query)) score += 300;
          score += tokens.reduce((total, token) => (
            total + (name.split(' ').some((word) => word.startsWith(token)) ? 45 : 0)
          ), 0);
        }
        if (client.id === draft.clientId) score += 80;
        return { client, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.client.name.localeCompare(b.client.name, 'es'))
      .slice(0, 10)
      .map((entry) => entry.client);
  }, [clientSearchQuery, clients, draft.clientId]);

  const selectedClientAddresses = useMemo(
    () => getClientAddressOptions(selectedClientForDraft),
    [selectedClientForDraft],
  );

  const selectedClientPrepaidBalanceBs = selectedClientForDraft?.prepaidEnabled
    ? Math.max(0, Number(selectedClientForDraft.prepaidBalanceBs ?? 0))
    : 0;
  const selectedClientPrepaidCoverageBs = Math.min(
    selectedClientPrepaidBalanceBs,
    Math.max(0, quoteTotalBs - paidAtApprovalBs),
  );
  const selectedClientPrepaidPendingBs = Math.max(0, Number((quoteTotalBs - paidAtApprovalBs - selectedClientPrepaidCoverageBs).toFixed(2)));

  const itemCategoryOptions = useMemo(
    () => Array.from(new Set([
      ...items.map((item) => item.category).filter(Boolean),
      ...(combos.length ? ['COMBOS'] : []),
    ])).sort((a, b) => a.localeCompare(b, 'es')),
    [combos, items],
  );

  const filteredCatalog = useMemo(() => {
    const shouldBuildCatalog = modalOpen && (currentStep === 2 || catalogModalOpen);
    if (!shouldBuildCatalog) return [];
    const productEntries = items
      .map((item) => {
        if (itemCategoryFilter !== 'all' && item.category !== itemCategoryFilter) return false;
        const score = getCatalogSearchScore(deferredItemSearch, [
          item.name,
          item.sku,
          item.category,
          item.itemColor,
          item.color,
          item.brand,
          item.material,
          item.description,
        ]);
        if (score < 0) return null;
        return { type: 'product', id: item.id, item, name: item.name, searchScore: score };
      })
      .filter(Boolean);
    const comboEntries = (combos ?? [])
      .map((combo) => {
        if (itemCategoryFilter !== 'all' && itemCategoryFilter !== 'COMBOS') return false;
        const ingredientsText = (combo.ingredients ?? []).map((line) => line.itemName).join(' ');
        const score = getCatalogSearchScore(deferredItemSearch, [
          combo.name,
          combo.sku,
          combo.category,
          ingredientsText,
          combo.description,
        ]);
        if (score < 0) return null;
        return { type: 'combo', id: combo.id, combo, name: combo.name, searchScore: score };
      })
      .filter(Boolean);
    return [...productEntries, ...comboEntries].sort(
      (a, b) => b.searchScore - a.searchScore || a.name.localeCompare(b.name, 'es'),
    );
  }, [catalogModalOpen, combos, currentStep, deferredItemSearch, itemCategoryFilter, items, modalOpen]);

  const visibleCatalog = useMemo(
    () => filteredCatalog.slice(0, catalogVisibleCount),
    [catalogVisibleCount, filteredCatalog],
  );
  const remainingCatalogCount = Math.max(0, filteredCatalog.length - visibleCatalog.length);

  const handleOpenProductImage = (item) => {
    if (!getProductImageSrc(item)) return;
    onOpenImage?.({
      url: getProductImageSrc(item),
      name: `Imagen de ${item.name || 'producto'}`,
    });
  };

  const draftQuantityByItem = useMemo(() => {
    const map = new Map();
    draft.items.forEach((line) => {
      map.set(line.itemId, Math.max(0, Number(line.quantity ?? 0)));
    });
    return map;
  }, [draft.items]);

  const mapRecordToDraft = (record, entityType = 'quote') => {
    const deliveryDate = record?.deliveryDate ?? getInputDate(new Date());
    const pickupCoordinatesPending = record?.pickupTimeMode === 'coordinate';
    const pickupDate = pickupCoordinatesPending
      ? ''
      : record?.pickupDate ?? getInputDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
    let scheduleDays = Array.isArray(record?.pricingPlan?.scheduleDays) && record.pricingPlan.scheduleDays.length > 0
      ? record.pricingPlan.scheduleDays.map((day, index) => normalizeScheduleDay(day, index, deliveryDate))
      : buildScheduleDaysFromRange(deliveryDate, pickupDate);
    if (record?.pricingPlan?.mode === 'daily_schedule') {
      const daysByDate = new Map(scheduleDays.map((day) => [getDateKey(day.date), day]).filter(([date]) => Boolean(date)));
      [...(record?.items ?? []), ...(record?.services ?? [])].forEach((line) => {
        const lineDate = getDateKey(line?.serviceDate ?? line?.date);
        if (!lineDate || daysByDate.has(lineDate)) return;
        daysByDate.set(lineDate, normalizeScheduleDay({
          id: String(line?.serviceDayId ?? line?.scheduleDayId ?? `day-${lineDate}`).trim() || `day-${lineDate}`,
          label: String(line?.serviceDayLabel ?? '').trim() || `Dia ${daysByDate.size + 1}`,
          date: lineDate,
        }, daysByDate.size, lineDate));
      });
      scheduleDays = Array.from(daysByDate.values())
        .sort((left, right) => String(left.date ?? '').localeCompare(String(right.date ?? '')))
        .map((day, index) => normalizeScheduleDay({
          ...day,
          label: String(day.label ?? '').trim() || `Dia ${index + 1}`,
        }, index, deliveryDate));
    }
    const defaultScheduleDayId = scheduleDays[0]?.id ?? '';
    const resolveScheduleDay = (line) => findScheduleDayForLine(line, scheduleDays, scheduleDays[0] ?? null, { preferDate: true });
    const recordItems = Array.isArray(record?.items) ? record.items : [];
    return {
    ...buildEmptyDraft(entityType === 'contract' ? 'order' : 'quote'),
    entityType,
    mode: entityType === 'contract' ? 'order' : 'quote',
    recordId: record?.id ?? '',
    rentalId: record?.rentalId ?? '',
    orderCode: record?.orderCode ?? '',
    quoteId: entityType === 'contract' ? String(record?.quoteId ?? '').trim() : '',
    recordStatus: record?.status ?? (entityType === 'contract' ? 'pendiente' : 'borrador'),
    documentCodeMode: record?.contractCode || record?.quoteCode ? 'manual' : 'auto',
    manualDocumentCode: entityType === 'contract' ? String(record?.contractCode ?? '').trim() : String(record?.quoteCode ?? '').trim(),
    contractDate: (record?.contractDate ?? record?.createdAt ?? '').slice(0, 10) || getInputDate(new Date()),
    clientId: record?.clientId ?? '',
    customerName: record?.customerName ?? '',
    customerCi: record?.customerCi ?? record?.nitCi ?? clients.find((client) => client.id === record?.clientId)?.nitCi ?? '',
    customerPhone: record?.customerPhone ?? '',
    customerReferencePhone: record?.customerReferencePhone ?? '',
    companyName: record?.companyName ?? '',
    eventType: record?.eventType ?? 'social',
    eventDate: record?.eventDate ?? getInputDate(new Date()),
    eventTime: record?.eventTime ?? '20:00',
    address: record?.address ?? '',
    addressSource: 'manual',
    city: record?.city ?? '',
    deliveryDate,
    logisticsMode: record?.logisticsMode ?? 'envio',
    deliveryChargeMode: (record?.logisticsMode ?? 'envio') === 'envio'
      && (record?.deliveryChargeMode === 'extra' || Number(record?.totals?.deliveryFeeBs ?? record?.deliveryFeeBs ?? 0) > 0)
      ? 'extra'
      : 'included',
    deliveryFeeBs: String(record?.totals?.deliveryFeeBs ?? record?.deliveryFeeBs ?? 0),
    deliveryFeeReason: record?.deliveryFeeReason ?? (Number(record?.totals?.deliveryFeeBs ?? record?.deliveryFeeBs ?? 0) > 0 ? 'quantity' : 'covered'),
    deliveryWindowStart: record?.deliveryWindowStart ?? '08:00',
    deliveryWindowEnd: record?.deliveryWindowEnd ?? '10:00',
    deliveryTimeMode: record?.deliveryTimeMode === 'coordinate' ? 'coordinate' : 'fixed',
    pickupDate,
    pickupWindowStart: pickupCoordinatesPending ? '' : record?.pickupWindowStart ?? '20:00',
    pickupWindowEnd: pickupCoordinatesPending ? '' : record?.pickupWindowEnd ?? '22:00',
    pickupTimeMode: record?.pickupTimeMode === 'coordinate' ? 'coordinate' : 'fixed',
    driverId: record?.driverId ?? '',
    vehicleId: record?.vehicleId ?? '',
    discountMode: record?.totals?.discountMode === 'fixed'
      ? 'fixed'
      : Number(record?.totals?.discountPercent ?? record?.discountPercent ?? 0) > 0
        ? 'percent'
        : Number(record?.totals?.discountBs ?? 0) > 0
          ? 'fixed'
          : 'percent',
    discountBs: String(record?.totals?.discountBs ?? 0),
    discountPercent: String(record?.totals?.discountPercent ?? record?.discountPercent ?? 0),
    guaranteeBs: String(record?.totals?.guaranteeBs ?? 0),
    guaranteeStatus: record?.guarantee?.status ?? record?.payment?.guaranteeStatus ?? (Number(record?.totals?.guaranteeBs ?? 0) > 0 ? 'validado' : 'no_validado'),
    guaranteePaymentMethod: normalizeLedgerPaymentMethod(record?.guarantee?.paymentMethod ?? record?.payment?.guaranteePaymentMethod),
    guaranteePaymentAccount: normalizeLedgerPaymentAccount(record?.guarantee?.paymentAccount ?? record?.payment?.guaranteePaymentAccount),
    paidAtApprovalBs: String(record?.payment?.paidAtApprovalBs ?? 0),
    originalPaidAtApprovalBs: String(record?.payment?.paidAtApprovalBs ?? 0),
    initialPaymentMethod: normalizeLedgerPaymentMethod(record?.payment?.initialPaymentMethod ?? record?.payment?.paymentMethod),
    initialPaymentAccount: normalizeLedgerPaymentAccount(record?.payment?.initialPaymentAccount ?? record?.payment?.paymentAccount),
    pricingMode: record?.pricingPlan?.mode === 'daily_schedule'
      ? 'daily_schedule'
      : record?.pricingPlan?.mode === 'duration' ? 'duration' : 'simple',
    pricingDays: String(record?.pricingPlan?.days ?? 1),
    pricingTiers: (Array.isArray(record?.pricingPlan?.tiers) && record.pricingPlan.tiers.length > 0
      ? record.pricingPlan.tiers
      : DURATION_PRICING_DEFAULT_TIERS
    ).map((tier, index) => ({
      id: tier.id ?? `tier-${index + 1}`,
      fromDay: String(tier.fromDay ?? index + 1),
      toDay: Number(tier.toDay ?? 0) > 0 ? String(tier.toDay) : '',
      percent: String(tier.percent ?? 100),
    })),
    scheduleDays,
    billingMode: record?.billingMode ?? 'sin_factura',
    validUntil: entityType === 'contract' ? '' : record?.validUntil ?? '',
    observations: record?.observations ?? '',
    responsibleIds: Array.isArray(record?.responsibles) && record.responsibles.length > 0
      ? record.responsibles.map((entry) => String(entry?.id ?? entry?.name ?? '').trim()).filter(Boolean)
      : [String(record?.createdById ?? record?.userId ?? record?.createdByName ?? record?.createdBy ?? '').trim()].filter(Boolean),
    items: recordItems.map((line, index) => {
      const lineDay = resolveScheduleDay(line);
      const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
      const lineDiscountPercent = Math.min(100, Math.max(0, Number(line.discountPercent ?? 0)));
      const storedLineTotalBs = Math.max(0, Number(line.lineTotalBs ?? 0));
      const storedGrossLineTotalBs = Math.max(0, Number(line.grossLineTotalBs ?? 0));
      const effectiveLineTotalBs = storedLineTotalBs;
      const effectiveGrossLineTotalBs = storedGrossLineTotalBs > 0
        ? storedGrossLineTotalBs
        : lineDiscountPercent > 0 && effectiveLineTotalBs > 0
          ? Number((effectiveLineTotalBs / (1 - (lineDiscountPercent / 100))).toFixed(2))
          : effectiveLineTotalBs + Math.max(0, Number(line.discountBs ?? 0));
      const recoveredUnitPriceBs = effectiveGrossLineTotalBs > 0
        ? Number((effectiveGrossLineTotalBs / quantity).toFixed(2))
        : 0;
      const hasStoredUnitPrice = line?.unitPriceBs !== undefined
        && line?.unitPriceBs !== null
        && line?.unitPriceBs !== '';
      const hasLegacyRentalPrice = line?.rentalPriceBs !== undefined
        && line?.rentalPriceBs !== null
        && line?.rentalPriceBs !== '';
      const unitPriceBs = hasStoredUnitPrice
        ? Math.max(0, Number(line.unitPriceBs ?? 0))
        : recoveredUnitPriceBs > 0
          ? recoveredUnitPriceBs
          : hasLegacyRentalPrice
            ? Math.max(0, Number(line.rentalPriceBs ?? 0))
            : 0;
      return {
      lineKey: getDraftLineKey(line, index),
      itemId: line.itemId,
      quantity: line.quantity,
      originalQuantity: Math.max(0, Math.trunc(Number(line.quantity ?? 0))),
      unitPriceBs,
      lineTotalBs: effectiveLineTotalBs,
      grossLineTotalBs: effectiveGrossLineTotalBs,
      discountPercent: String(lineDiscountPercent),
      lineType: line.lineType ?? '',
      controlsStock: line.controlsStock,
      verificationStatus: line.verificationStatus,
      quickItem: line.quickItem ?? null,
      comboId: line.comboId ?? null,
      comboName: line.comboName ?? '',
      comboLineKey: line.comboLineKey ?? null,
      comboComponentName: line.comboComponentName ?? '',
      comboQuantity: line.comboQuantity ?? 1,
      comboComponentQuantity: line.comboComponentQuantity ?? (
        line.comboId
          ? Math.max(1, Math.trunc(Number(line.quantity ?? 1) / Math.max(1, Math.trunc(Number(line.comboQuantity ?? 1)))))
          : 1
      ),
      comboPricingRole: line.comboPricingRole ?? '',
      comboPricingCondition: line.comboPricingCondition ?? null,
      comboRuleIndex: line.comboRuleIndex ?? index,
      comboSlotLabel: line.comboSlotLabel ?? '',
      comboSelectionMode: line.comboSelectionMode ?? 'item',
      comboOptionItemIds: Array.isArray(line.comboOptionItemIds) ? line.comboOptionItemIds : [],
      comboCategory: line.comboCategory ?? '',
      observation: line.observation ?? line.observations ?? line.note ?? '',
      serviceDayId: lineDay?.id ?? line.serviceDayId ?? line.scheduleDayId ?? defaultScheduleDayId,
      serviceDate: lineDay?.date ?? line.serviceDate ?? '',
      serviceDayLabel: lineDay?.label ?? line.serviceDayLabel ?? '',
    };
    }),
    services: (record?.services ?? []).map((service, index) => {
      const serviceDay = resolveScheduleDay(service);
      return {
      id: service?.id ?? `service-${index}`,
      name: String(service?.name ?? ''),
      detail: String(service?.detail ?? ''),
      quantity: Math.max(1, Math.trunc(Number(service?.quantity ?? 1))),
      unitPriceBs: Math.max(0, Number(service?.unitPriceBs ?? 0)),
      serviceDayId: serviceDay?.id ?? service?.serviceDayId ?? service?.scheduleDayId ?? defaultScheduleDayId,
      serviceDate: serviceDay?.date ?? service?.serviceDate ?? '',
      serviceDayLabel: serviceDay?.label ?? service?.serviceDayLabel ?? '',
    };
    }),
    supplierFulfillmentPlan: Array.isArray(record?.supplierFulfillmentPlan)
      ? record.supplierFulfillmentPlan.map((line) => ({
        id: line.id,
        lineKey: line.lineKey ?? null,
        itemId: line.itemId,
        itemName: line.itemName,
        supplierId: line.supplierId,
        supplierName: line.supplierName,
        supplierQuoteId: line.supplierQuoteId ?? null,
        supplierQuoteCode: line.supplierQuoteCode ?? null,
        neededQty: Number(line.neededQty ?? 0),
        supplierUnitCostBs: Number(line.supplierUnitCostBs ?? 0),
        saleUnitPriceBs: Number(line.saleUnitPriceBs ?? 0),
        baseSaleUnitPriceBs: Number(line.baseSaleUnitPriceBs ?? line.saleUnitPriceBs ?? 0),
        saleDiscountPercent: clampPercentValue(line.saleDiscountPercent),
        discountApplied: Boolean(line.discountApplied || Number(line.saleDiscountPercent ?? 0) > 0),
        manualCoverage: Boolean(line.manualCoverage),
      }))
      : [],
  };
  };

  const openCreateModal = async (mode, entityType = 'quote', sourceRecord = null) => {
    if (readOnly) return;
    if (onPrepareEditorData) {
      try {
        await onPrepareEditorData();
      } catch (prepareError) {
        setActionFeedback(prepareError?.message || 'No se pudieron cargar los datos del editor.');
        return;
      }
    }
    setActionFeedback('');
    setFormError('');
    setSupplierPlanRemovalConfirmation(null);
    setItemSearch('');
    setItemCategoryFilter('all');
    setQuickItemDraft(buildEmptyQuickItemDraft());
    setIsQuickItemOpen(false);
    setIsCourtesyMode(false);
    setCatalogModalOpen(false);
    setServiceModalOpen(false);
    setServiceDraft(buildEmptyServiceDraft());
    removedSupplierCoverageIdsRef.current = new Set();
    if (sourceRecord) {
      const mappedDraft = mapRecordToDraft(sourceRecord, entityType);
      setDraft(mappedDraft);
      setClientSearchQuery(clients.find((client) => client.id === mappedDraft.clientId)?.name || mappedDraft.customerName || '');
      setSupplierFulfillmentDraftByItem(buildSupplierCoverageDraftByItem(mappedDraft.supplierFulfillmentPlan));
      setActiveScheduleDayId(mappedDraft.scheduleDays?.[0]?.id ?? '');
    } else {
      const emptyDraft = buildEmptyDraft(mode);
      const nextDraft = {
        ...emptyDraft,
        validUntil: entityType === 'contract' ? '' : emptyDraft.validUntil,
        entityType,
        mode,
        recordStatus: entityType === 'contract' && mode === 'order' ? 'pendiente' : 'borrador',
      };
      setDraft(nextDraft);
      setClientSearchQuery('');
      setSupplierFulfillmentDraftByItem({});
      setActiveScheduleDayId(nextDraft.scheduleDays?.[0]?.id ?? '');
    }
    setCurrentStep(0);
    setIsClientSearchOpen(false);
    setActiveClientResultIndex(0);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (isSubmitting) return;
    setModalOpen(false);
    setClientSearchQuery('');
    setIsClientSearchOpen(false);
    setActiveClientResultIndex(0);
    setSupplierPlanRemovalConfirmation(null);
    setFormError('');
    setItemSearch('');
    setItemCategoryFilter('all');
    setQuickItemDraft(buildEmptyQuickItemDraft());
    setIsQuickItemOpen(false);
    setIsCourtesyMode(false);
    setServiceModalOpen(false);
    setServiceDraft(buildEmptyServiceDraft());
    setCurrentStep(0);
    setSupplierFulfillmentDraftByItem({});
    setSupplierCoverageModal(null);
    setSupplierCoverageDraft(buildEmptySupplierCoverageDraft());
    setSupplierCoverageError('');
    setIsSavingSupplierCoverage(false);
    setActiveScheduleDayId('');
    setDraft(buildEmptyDraft('quote'));
  };

  const setDraftField = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const setPickupCoordinatesPending = (coordinatesPending) => {
    setDraft((current) => ({
      ...current,
      pickupTimeMode: coordinatesPending ? 'coordinate' : 'fixed',
      pickupDate: coordinatesPending
        ? ''
        : current.pickupDate || current.eventDate || current.deliveryDate || getInputDate(new Date()),
      pickupWindowStart: coordinatesPending ? '' : current.pickupWindowStart || '20:00',
      pickupWindowEnd: coordinatesPending ? '' : current.pickupWindowEnd || '22:00',
    }));
  };

  const setDraftLogisticsMode = (value) => {
    const logisticsMode = value === 'recojo' ? 'recojo' : 'envio';
    setDraft((current) => ({
      ...current,
      logisticsMode,
      deliveryChargeMode: logisticsMode === 'envio' ? current.deliveryChargeMode : 'included',
      deliveryFeeBs: logisticsMode === 'envio' ? current.deliveryFeeBs : '0',
      deliveryFeeReason: logisticsMode === 'envio' ? current.deliveryFeeReason : 'covered',
    }));
  };

  const setDraftDeliveryChargeMode = (value) => {
    const deliveryChargeMode = value === 'extra' ? 'extra' : 'included';
    setDraft((current) => ({
      ...current,
      deliveryChargeMode,
      deliveryFeeBs: deliveryChargeMode === 'extra' ? current.deliveryFeeBs : '0',
      deliveryFeeReason: deliveryChargeMode === 'extra'
        ? current.deliveryFeeReason === 'covered' ? 'quantity' : current.deliveryFeeReason
        : 'covered',
    }));
  };

  const setDraftBillingMode = (value) => {
    setDraft((current) => ({
      ...current,
      billingMode: value === 'con_factura' ? 'con_factura' : 'sin_factura',
    }));
  };

  const addSupplierCoverageLine = (itemId, coverage) => {
    setSupplierFulfillmentDraftByItem((current) => {
      const currentCoverages = normalizeCoverageDraftLines(current[itemId]);
      return {
        ...current,
        [itemId]: {
          coverages: [
            ...currentCoverages,
            {
              ...coverage,
              id: coverage.id ?? `cov-${itemId}-${Date.now()}`,
            },
          ],
        },
      };
    });
  };

  const removeSupplierCoverageLine = (itemId, coverageId) => {
    if (coverageId) removedSupplierCoverageIdsRef.current.add(String(coverageId));
    setSupplierFulfillmentDraftByItem((current) => {
      const next = { ...current };
      Object.keys(next).forEach((coverageKey) => {
        const nextCoverages = normalizeCoverageDraftLines(next[coverageKey])
          .filter((line) => String(line.id) !== String(coverageId));
        if (nextCoverages.length > 0) next[coverageKey] = { coverages: nextCoverages };
        else delete next[coverageKey];
      });
      return next;
    });
  };

  const setSupplierCoverageDraftField = (field, value) => {
    const nextValue = ['supplierUnitCostBs', 'saleUnitPriceBs'].includes(field)
      ? cleanDecimalInput(value)
      : field === 'quantity'
      ? cleanIntegerInput(value)
      : value;
    setSupplierCoverageDraft((current) => ({ ...current, [field]: nextValue }));
  };

  const openSupplierCoverageModal = (line, availableStock, options = {}) => {
    if (bypassStockValidation) return;
    const manualMode = Boolean(options.manual);
    const requestedForItem = Math.max(0, Number(
      options.requestedForItem
      ?? selectedDemandByItemId.get(line.itemId)
      ?? line.quantity,
    ));
    const shortageQty = Math.max(0, Math.trunc(Number(requestedForItem)) - Math.max(0, Number(availableStock ?? 0)));
    const coverageKey = getSupplierCoverageKey(line);
    const currentCoverages = normalizeCoverageDraftLines(supplierFulfillmentDraftByItem[coverageKey] ?? supplierFulfillmentDraftByItem[line.itemId]);
    const alreadyCoveredQty = currentCoverages.reduce((sum, entry) => sum + Math.max(0, Math.trunc(Number(entry.neededQty ?? 0))), 0);
    const coverLimitQty = manualMode ? null : Math.max(1, Math.trunc(Number(requestedForItem)) - alreadyCoveredQty);
    const remainingShortageQty = Math.max(0, shortageQty - alreadyCoveredQty);
    const defaultCoverageQty = manualMode
      ? Math.max(1, remainingShortageQty || Math.max(1, Math.trunc(Number(line.quantity ?? 1)) - Math.max(0, Math.trunc(Number(availableStock ?? 0)))))
      : Math.max(1, remainingShortageQty);
    const details = getOperationalItemDetails(line);
    const detailValue = (label) => details.find((entry) => entry.label === label)?.value ?? '';
    const hasSuppliers = (supplierBundle?.suppliers ?? []).length > 0;
    setSupplierCoverageModal({
      itemId: line.itemId,
      lineKey: line.lineKey,
      coverageKey,
      itemName: line.item.name,
      availableStock,
      shortageQty,
      remainingShortageQty,
      coverLimitQty,
      manualMode,
      requestedForItem,
    });
    setSupplierCoverageDraft({
      ...buildEmptySupplierCoverageDraft(),
      supplierMode: hasSuppliers ? 'existing' : 'new',
      itemName: line.item.name,
      category: detailValue('Categoria') || line.item.category || '',
      color: detailValue('Color'),
      material: detailValue('Material'),
      quantity: String(defaultCoverageQty),
      supplierUnitCostBs: '0',
      saleUnitPriceBs: String(Math.max(0, Number(line.unitPriceBs ?? line.item.rentalPriceBs ?? 0))),
    });
    setSupplierCoverageError('');
  };

  const closeSupplierCoverageModal = (force = false) => {
    if (isSavingSupplierCoverage && !force) return;
    setSupplierCoverageModal(null);
    setSupplierCoverageDraft(buildEmptySupplierCoverageDraft());
    setSupplierCoverageError('');
  };

  const saveSupplierCoverageFromModal = async () => {
    if (!supplierCoverageModal) return;
    setSupplierCoverageError('');
    const parsedRequestedQty = parseIntegerInput(supplierCoverageDraft.quantity, 1);
    const coverLimitQty = supplierCoverageModal.manualMode
      ? null
      : Math.max(1, Math.trunc(Number(
        supplierCoverageModal.coverLimitQty
        ?? supplierCoverageModal.remainingShortageQty
        ?? supplierCoverageModal.shortageQty
        ?? 1,
      )));
    const requestedQty = Math.max(1, coverLimitQty ? Math.min(coverLimitQty, parsedRequestedQty) : parsedRequestedQty);
    const supplierCost = Math.max(0, parseMoneyInput(supplierCoverageDraft.supplierUnitCostBs, 0));
    const salePrice = Math.max(0, parseMoneyInput(supplierCoverageDraft.saleUnitPriceBs, 0));
    const itemName = String(supplierCoverageDraft.itemName ?? '').trim();
    const category = String(supplierCoverageDraft.category ?? '').trim();
    const notes = String(supplierCoverageDraft.notes ?? '').trim();

    if (!itemName || !category) {
      setSupplierCoverageError('Indica nombre/modelo y categoria del item que prestara el proveedor.');
      return;
    }
    if (supplierCost < 0) {
      setSupplierCoverageError('El costo del proveedor no puede ser negativo.');
      return;
    }
    if (salePrice < 0) {
      setSupplierCoverageError('El precio al cliente no puede ser negativo.');
      return;
    }

    setIsSavingSupplierCoverage(true);
    try {
      let supplier = null;
      const selectedSupplierId = String(supplierCoverageDraft.supplierId ?? '').trim();
      if (supplierCoverageDraft.supplierMode === 'existing') {
        supplier = (supplierBundle?.suppliers ?? []).find((entry) => String(entry.id) === selectedSupplierId) ?? null;
        if (!supplier) throw new Error('Selecciona un proveedor existente o crea uno nuevo.');
      } else {
        const supplierName = String(supplierCoverageDraft.supplierName ?? '').trim();
        if (!supplierName) throw new Error('Indica el nombre del proveedor.');
        const existingByName = (supplierBundle?.suppliers ?? []).find((entry) => normalizeText(entry.name) === normalizeText(supplierName));
        supplier = existingByName ?? await onCreateSupplier?.({
          name: supplierName,
          contactName: String(supplierCoverageDraft.contactName ?? '').trim(),
          phone: String(supplierCoverageDraft.phone ?? '').trim(),
          whatsapp: String(supplierCoverageDraft.whatsapp ?? supplierCoverageDraft.phone ?? '').trim(),
          paymentTerms: 'Segun acuerdo operativo',
          notes: notes ? `Creado desde orden de servicio. ${notes}` : 'Creado desde orden de servicio.',
        });
      }

      if (!supplier?.id) throw new Error('No se pudo determinar el proveedor.');

      const coverageKey = supplierCoverageModal.coverageKey ?? supplierCoverageModal.lineKey ?? supplierCoverageModal.itemId;
      const coverageId = `cov-${coverageKey}-${Date.now()}`;
      setDraftItemPrice(supplierCoverageModal.lineKey ?? supplierCoverageModal.itemId, salePrice);
      addSupplierCoverageLine(coverageKey, {
        id: coverageId,
        lineKey: supplierCoverageModal.lineKey ?? null,
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplierQuoteId: null,
        supplierQuoteCode: null,
        neededQty: requestedQty,
        supplierUnitCostBs: supplierCost,
        manualCoverage: Boolean(supplierCoverageModal.manualMode),
      });
      setActionFeedback(`Proveedor ${supplier.name} vinculado al faltante de ${supplierCoverageModal.itemName}.`);
      closeSupplierCoverageModal(true);
    } catch (requestError) {
      setSupplierCoverageError(requestError.message || 'No se pudo registrar la cobertura del proveedor.');
    } finally {
      setIsSavingSupplierCoverage(false);
    }
  };

  const setDraftEventDate = (value) => {
    setDraft((current) => {
      const nextDraft = {
        ...current,
        eventDate: value,
        deliveryDate: value || current.deliveryDate,
        pickupDate: !current.pickupDate || (value && current.pickupDate < value) ? value : current.pickupDate,
      };

      if (current.entityType !== 'contract') {
        nextDraft.validUntil = !current.validUntil || (value && current.validUntil < value) ? value : current.validUntil;
      }

      return nextDraft;
    });
  };

  const clearClientFields = () => {
    setClientSearchQuery('');
    setIsClientSearchOpen(false);
    setActiveClientResultIndex(0);
    setDraft((current) => ({
      ...current,
      clientId: '',
      customerName: '',
      customerCi: '',
      customerPhone: '',
      customerReferencePhone: '',
      companyName: '',
      address: '',
      addressSource: 'manual',
      city: '',
    }));
  };

  const setClientFromSelection = (clientId) => {
    const selected = clients.find((row) => row.id === clientId);
    if (!selected) {
      clearClientFields();
      return;
    }

    const addressOptions = getClientAddressOptions(selected);
    const firstAddress = addressOptions[0] ?? null;

    setClientSearchQuery(selected.name);
    setIsClientSearchOpen(false);
    setActiveClientResultIndex(0);

    setDraft((current) => ({
      ...current,
      clientId: selected.id,
      customerName: selected.name,
      customerCi: selected.nitCi || selected.customerCi || current.customerCi,
      customerPhone: selected.whatsapp || selected.phone,
      customerReferencePhone: selected.referencePhone || '',
      companyName: selected.companyName || selected.name,
      address: firstAddress?.address || selected.address || current.address,
      addressSource: firstAddress?.id || 'manual',
      city: firstAddress?.city || selected.city || current.city,
    }));
  };

  const handleClientSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      setIsClientSearchOpen(true);
      setActiveClientResultIndex((index) => Math.max(0, Math.min(filteredClientOptions.length - 1, index + 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setIsClientSearchOpen(true);
      setActiveClientResultIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Enter' && isClientSearchOpen && filteredClientOptions[activeClientResultIndex]) {
      event.preventDefault();
      event.stopPropagation();
      setClientFromSelection(filteredClientOptions[activeClientResultIndex].id);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setIsClientSearchOpen(false);
    }
  };

  const setDraftAddressSource = (value) => {
    if (value === 'manual') {
      setDraft((current) => ({
        ...current,
        addressSource: 'manual',
        address: '',
      }));
      return;
    }

    const selectedAddress = selectedClientAddresses.find((entry) => entry.id === value);
    if (!selectedAddress) return;

    setDraft((current) => ({
      ...current,
      addressSource: selectedAddress.id,
      address: selectedAddress.address,
      city: selectedAddress.city || current.city,
    }));
  };

  const getActiveScheduleLineFields = (currentDraft = draft) => {
    const days = Array.isArray(currentDraft.scheduleDays) && currentDraft.scheduleDays.length > 0
      ? currentDraft.scheduleDays
      : buildScheduleDaysFromRange(currentDraft.deliveryDate || currentDraft.eventDate, currentDraft.pickupDate || currentDraft.eventDate);
    const day = days.find((entry) => entry.id === activeScheduleDayId) ?? days[0] ?? null;
    return {
      serviceDayId: day?.id ?? '',
      serviceDate: day?.date ?? '',
      serviceDayLabel: day?.label ?? '',
    };
  };

  const addDraftItem = (itemId, options = {}) => {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    const isCourtesy = Boolean(options?.courtesy);
    setDraft((current) => {
      const scheduleFields = current.pricingMode === 'daily_schedule' ? getActiveScheduleLineFields(current) : {};
      const already = isCourtesy
        ? null
        : current.items.find((line) => (
          line.itemId === itemId
          && !line.comboId
          && line.lineType !== 'courtesy'
          && (current.pricingMode !== 'daily_schedule' || line.serviceDayId === scheduleFields.serviceDayId)
        ));
      if (already) {
        const nextQty = Math.max(1, Number(already.quantity ?? 1) + 1);
        return {
          ...current,
          items: current.items.map((line) => ((line.lineKey ?? line.itemId) === (already.lineKey ?? already.itemId) ? { ...line, quantity: nextQty } : line)),
        };
      }
      if (isCourtesy) {
        return {
          ...current,
          items: [
            ...current.items,
            {
              lineKey: `courtesy-${itemId}-${Date.now()}`,
              itemId,
              quantity: 1,
              unitPriceBs: 0,
              grossLineTotalBs: 0,
              lineTotalBs: 0,
              discountPercent: 0,
              discountBs: 0,
              lineType: 'courtesy',
              observation: 'Cortesia',
              ...scheduleFields,
            },
          ],
        };
      }
      return {
        ...current,
        items: [...current.items, { lineKey: `item-${itemId}-${Date.now()}`, itemId, quantity: 1, unitPriceBs: Number(item.rentalPriceBs ?? 0), ...scheduleFields }],
      };
    });
    if (isCourtesy) setIsCourtesyMode(false);
  };

  const getComboRuleOptions = (rule) => {
    if (rule.selectionMode === 'category' && rule.category) {
      return items.filter((item) => normalizeText(item.category) === normalizeText(rule.category));
    }
    const optionIds = Array.isArray(rule.optionItemIds) && rule.optionItemIds.length > 0
      ? rule.optionItemIds
      : [rule.itemId];
    return optionIds.map((id) => items.find((item) => item.id === id)).filter(Boolean);
  };

  const getComboRuleSignature = (rule) => {
    if (!rule) return '';
    const optionIds = Array.isArray(rule?.optionItemIds) && rule.optionItemIds.length > 0
      ? rule.optionItemIds
      : [rule?.itemId];
    const optionKey = [...new Set(optionIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
      .sort()
      .join('|');
    const categoryKey = normalizeText(rule?.category ?? '');
    const labelKey = normalizeText(rule?.slotLabel ?? rule?.itemName ?? '');
    return [
      normalizeText(rule?.selectionMode ?? 'item'),
      categoryKey,
      optionKey,
      categoryKey ? '' : labelKey,
    ].join('::');
  };

  const getComboRules = (combo) => {
    const bySignature = new Map();
    (Array.isArray(combo?.ingredients) ? combo.ingredients : []).forEach((rule) => {
      const signature = getComboRuleSignature(rule);
      if (!signature.trim() || bySignature.has(signature)) return;
      bySignature.set(signature, rule);
    });
    return [...bySignature.values()];
  };

  const getComboOptionAvailable = (item) => {
    if (!item) return 0;
    const availability = availabilityByItemId.get(item.id);
    if (availability) {
      return Math.max(0, Math.trunc(Number(availability.projectedAvailable ?? 0)));
    }
    const availableStock = Math.max(0, Math.trunc(Number(item.availableStock ?? 0)));
    if (availableStock > 0) return availableStock;
    const stockValue = Math.max(0, Math.trunc(Number(item.totalStock ?? 0)));
    if (stockValue > 0) return stockValue;
    const verificationStatus = normalizeText(item.verificationStatus);
    if (item.controlsStock === false || verificationStatus.includes('pending') || verificationStatus.includes('validar')) {
      return 999;
    }
    return 0;
  };

  const getSelectedComboOptionIds = (selectionValue, fallbackOptions = []) => {
    if (Array.isArray(selectionValue)) return selectionValue.filter(Boolean);
    if (selectionValue) return [selectionValue];
    return fallbackOptions.map((option) => option.id).filter(Boolean);
  };

  const getComboSelectionQuantityMap = (selections = {}) => (
    selections && typeof selections.__quantities === 'object' && selections.__quantities
      ? selections.__quantities
      : {}
  );

  const getComboSelectedUnitsForRule = (ruleIndex, selectedIds = [], selections = {}) => {
    const quantityMap = getComboSelectionQuantityMap(selections);
    return selectedIds.reduce((sum, itemId) => {
      const key = `${ruleIndex}:${itemId}`;
      return sum + Math.max(0, Math.trunc(Number(quantityMap[key] ?? 0)));
    }, 0);
  };

  const buildDefaultComboSelections = (combo, comboQuantity = 1) => {
    const selections = {};
    const quantityMap = {};
    const comboQty = Math.max(1, Math.trunc(Number(comboQuantity ?? 1)));
    getComboRules(combo).forEach((rule, index) => {
      const options = getComboRuleOptions(rule);
      const firstAvailable = options.find((option) => getComboOptionAvailable(option) > 0);
      const selectedOption = firstAvailable ?? options[0] ?? null;
      if (!selectedOption) {
        selections[index] = [];
        return;
      }
      const requiredPerCombo = Math.max(1, Math.trunc(Number(rule?.quantity ?? 1)));
      selections[index] = [selectedOption.id];
      quantityMap[`${index}:${selectedOption.id}`] = requiredPerCombo * comboQty;
    });
    selections.__quantities = quantityMap;
    selections.__comboQuantity = comboQty;
    return selections;
  };

  const getComboMaxQuantity = (combo, selections = {}) => {
    const ingredients = getComboRules(combo);
    const groupMaximums = ingredients.map((rule, index) => {
      const options = getComboRuleOptions(rule);
      const selectedIds = getSelectedComboOptionIds(selections[index], []);
      const selectedOptions = options.filter((option) => selectedIds.includes(option.id));
      if (selectedOptions.length === 0) return null;
      const requiredPerCombo = Math.max(1, Math.trunc(Number(rule?.quantity ?? 1)));
      const availableUnits = selectedOptions.reduce((sum, option) => sum + getComboOptionAvailable(option), 0);
      return Math.floor(availableUnits / requiredPerCombo);
    }).filter((value) => value !== null);
    if (groupMaximums.length === 0) return 0;
    return Math.max(0, Math.min(...groupMaximums));
  };

  const getComboAvailabilityDetail = (combo, selections = {}) => {
    const components = getComboRules(combo).map((rule, index) => {
      const options = getComboRuleOptions(rule);
      const selectedIds = getSelectedComboOptionIds(selections[index], []);
      const selectedOptions = options.filter((option) => selectedIds.includes(option.id));
      const effectiveOptions = selectedOptions.length > 0 ? selectedOptions : options;
      const requiredPerCombo = Math.max(1, Math.trunc(Number(rule?.quantity ?? 1)));
      const availableUnits = effectiveOptions.reduce((sum, option) => sum + getComboOptionAvailable(option), 0);
      const maxCombos = Math.max(0, Math.floor(availableUnits / requiredPerCombo));
      const optionDetails = effectiveOptions.map((option) => {
        const summary = availabilityByItemId.get(option.id) ?? null;
        return {
          item: option,
          projectedAvailable: getComboOptionAvailable(option),
          hardRecords: Array.isArray(summary?.hardReservedQtyRecords) ? summary.hardReservedQtyRecords : [],
          softRecords: Array.isArray(summary?.softReservedQtyRecords) ? summary.softReservedQtyRecords : [],
          returnRecords: Array.isArray(summary?.returningBeforeStartQtyRecords) ? summary.returningBeforeStartQtyRecords : [],
        };
      });
      return {
        index,
        label: rule.slotLabel || rule.itemName || `Componente ${index + 1}`,
        requiredPerCombo,
        availableUnits,
        maxCombos,
        optionDetails,
      };
    });

    const comboMaxQuantity = components.length > 0
      ? Math.max(0, Math.min(...components.map((component) => component.maxCombos)))
      : 0;

    return {
      combo,
      comboMaxQuantity,
      components: components.map((component) => ({
        ...component,
        isLimiting: component.maxCombos === comboMaxQuantity,
      })),
    };
  };

  const buildComboAllocations = (combo, selections, comboQuantity) => {
    const ingredients = getComboRules(combo);
    const allocations = [];
    const shortages = [];
    const quantityMap = getComboSelectionQuantityMap(selections);

    ingredients.forEach((rule, index) => {
      const options = getComboRuleOptions(rule);
      const selectedIds = getSelectedComboOptionIds(selections[index], []);
      const selectedOptions = options.filter((option) => selectedIds.includes(option.id));
      const requiredPerCombo = Math.max(1, Math.trunc(Number(rule?.quantity ?? 1)));
      let remaining = requiredPerCombo * comboQuantity;

      if (selectedOptions.length === 0) return;

      selectedOptions.forEach((item) => {
        if (remaining <= 0) return;
        const available = getComboOptionAvailable(item);
        const manualQuantity = Math.max(0, Math.trunc(Number(quantityMap[`${index}:${item.id}`] ?? 0)));
        const quantity = Math.min(remaining, manualQuantity);
        if (quantity <= 0) return;
        const shortageQty = Math.max(0, quantity - available);
        allocations.push({
          rule,
          ruleIndex: index,
          item,
          quantity,
          available,
          shortageQty,
          requiredPerCombo,
          slotLabel: rule.slotLabel ?? rule.itemName ?? `Componente ${index + 1}`,
          options,
        });
        if (shortageQty > 0) {
          shortages.push({
            item,
            rule,
            ruleIndex: index,
            requestedQty: quantity,
            available,
            shortageQty,
          });
        }
        remaining -= quantity;
      });
    });

    return { allocations, shortages };
  };

  const getComboUnitPriceForQuantity = (combo, quantity) => {
    const condition = combo?.pricingCondition ?? {};
    if (!condition.enabled) return Math.max(0, Number(combo?.rentalPriceBs ?? 0));
    const safeQuantity = Math.max(1, Math.trunc(Number(quantity ?? 1)));
    const upToQuantity = Math.max(1, Math.trunc(Number(condition.upToQuantity ?? 3)));
    const upToUnitPriceBs = Math.max(0, Number(condition.upToUnitPriceBs ?? combo?.rentalPriceBs ?? 0));
    const aboveUnitPriceBs = Math.max(0, Number(condition.aboveUnitPriceBs ?? combo?.rentalPriceBs ?? 0));
    return safeQuantity <= upToQuantity ? upToUnitPriceBs : aboveUnitPriceBs;
  };

  const getComboLineUnitPriceForQuantity = (line, quantity) => {
    const combo = (combos ?? []).find((entry) => entry.id === line?.comboId);
    const condition = line?.comboPricingCondition ?? combo?.pricingCondition ?? {};
    if (!condition.enabled) return Math.max(0, Number(line?.unitPriceBs ?? combo?.rentalPriceBs ?? 0));
    return getComboUnitPriceForQuantity({ rentalPriceBs: combo?.rentalPriceBs ?? line?.unitPriceBs ?? 0, pricingCondition: condition }, quantity);
  };

  const appendConfiguredCombo = (combo, selections = {}, existingComboLineKey = '') => {
    const comboLineKey = existingComboLineKey || `combo-${combo.id}-${Date.now()}`;
    const ingredients = getComboRules(combo);
    const requestedComboQuantity = Math.max(1, Math.trunc(Number(selections.__comboQuantity ?? 1)));
    const { allocations, shortages } = buildComboAllocations(combo, selections, requestedComboQuantity);
    if (ingredients.length > 0 && allocations.length === 0) {
      setFormError('Selecciona al menos una opcion disponible para el combo.');
      return false;
    }
    setDraft((current) => {
      const scheduleFields = current.pricingMode === 'daily_schedule' ? getActiveScheduleLineFields(current) : {};
      const previousComboQuantity = existingComboLineKey
        ? Math.max(1, Number(current.items.find((line) => line.comboLineKey === existingComboLineKey)?.comboQuantity ?? 1))
        : 1;
      const previousItems = existingComboLineKey
        ? current.items.filter((line) => line.comboLineKey !== existingComboLineKey)
        : current.items;
      const requestedPriceSignature = String(combo?.priceIngredientSignature ?? '').trim();
      const priceAllocationIndex = Math.max(
        0,
        allocations.findIndex((allocation) => (
          getComboRuleSignature(allocation.rule) === requestedPriceSignature
        )),
      );
      return {
        ...current,
        items: [
          ...previousItems,
          ...allocations.map((allocation, allocationIndex) => {
          const line = allocation.rule;
          const index = allocation.ruleIndex;
          const options = allocation.options;
          const item = allocation.item;
          const quantity = allocation.quantity;
          const comboPrice = getComboUnitPriceForQuantity(combo, requestedComboQuantity);
          const isPriceLine = allocationIndex === priceAllocationIndex;
          return {
            lineKey: `${comboLineKey}-${item?.id ?? line.itemId}-${index}-${allocationIndex}`,
            itemId: item?.id ?? line.itemId,
            quantity,
            unitPriceBs: isPriceLine ? comboPrice : 0,
            lineTotalBs: isPriceLine ? comboPrice * requestedComboQuantity : 0,
            comboId: combo.id,
            comboName: combo.name,
            comboLineKey,
            comboComponentName: item?.name ?? line.itemName ?? '',
            comboQuantity: requestedComboQuantity || previousComboQuantity,
            comboComponentQuantity: allocation.requiredPerCombo,
            comboDistributed: true,
            comboPricingRole: isPriceLine ? 'price' : 'component',
            comboPricingCondition: combo.pricingCondition ?? null,
            comboRuleIndex: index,
            comboSlotLabel: line.slotLabel ?? line.itemName ?? `Componente ${index + 1}`,
            comboSelectionMode: line.selectionMode ?? 'item',
            comboOptionItemIds: options.map((option) => option.id),
            comboCategory: line.category ?? '',
            controlsStock: item?.controlsStock ?? line.controlsStock,
            verificationStatus: item?.verificationStatus ?? line.verificationStatus,
            ...scheduleFields,
          };
        }),
        ],
      };
    });
    setFormError('');
    if (shortages.length > 0) {
      const totalShortage = shortages.reduce((sum, entry) => sum + entry.shortageQty, 0);
      setActionFeedback(
        `El stock propio no cubre ${totalShortage} unidad(es) del combo. Te recomendamos asignar proveedor para completar la solicitud.`,
      );
      const firstShortage = shortages[0];
      const firstAllocationIndex = allocations.findIndex((entry) => (
        entry.ruleIndex === firstShortage.ruleIndex && entry.item.id === firstShortage.item.id
      ));
      const shortageLine = {
        lineKey: `${comboLineKey}-${firstShortage.item.id}-${firstShortage.ruleIndex}-${Math.max(0, firstAllocationIndex)}`,
        itemId: firstShortage.item.id,
        quantity: firstShortage.requestedQty,
        unitPriceBs: Number(combo?.rentalPriceBs ?? 0),
        item: firstShortage.item,
      };
      window.setTimeout(() => {
        openSupplierCoverageModal(shortageLine, firstShortage.available, {
          requestedForItem: firstShortage.requestedQty,
        });
      }, 0);
    }
    return true;
  };

  const openComboConfigurator = (combo, existingComboLineKey = '') => {
    const defaultSelections = buildDefaultComboSelections(combo);
    const selections = { ...defaultSelections };
    const quantityMap = { ...getComboSelectionQuantityMap(defaultSelections) };
    const existingLines = existingComboLineKey
      ? draft.items.filter((entry) => entry.comboLineKey === existingComboLineKey)
      : [];
    getComboRules(combo).forEach((line, index) => {
      const existingIds = existingLines
        .filter((entry) => Number(entry.comboRuleIndex) === index)
        .map((entry) => entry.itemId)
        .filter(Boolean);
      selections[index] = existingIds.length > 0 ? existingIds : selections[index] ?? [];
      existingLines
        .filter((entry) => Number(entry.comboRuleIndex) === index)
        .forEach((entry) => {
          quantityMap[`${index}:${entry.itemId}`] = Math.max(1, Math.trunc(Number(entry.quantity ?? 1)));
        });
    });
    selections.__quantities = quantityMap;
    const existingQuantity = Math.max(1, Math.trunc(Number(existingLines[0]?.comboQuantity ?? 0)));
    setComboConfigurator({
      combo,
      existingComboLineKey,
      selections,
      search: {},
      expandedGroups: {},
      quantity: String(existingComboLineKey ? existingQuantity : 1),
    });
  };

  const normalizeComboConfiguratorQuantities = (current, nextComboQuantity) => {
    if (!current) return current;
    const comboQty = Math.max(1, Math.trunc(Number(nextComboQuantity ?? current.quantity ?? 1)));
    const nextSelections = { ...(current.selections ?? {}) };
    const nextQuantityMap = { ...getComboSelectionQuantityMap(nextSelections) };

    getComboRules(current.combo).forEach((rule, index) => {
      const selectedIds = getSelectedComboOptionIds(nextSelections[index], []);
      if (selectedIds.length === 0) return;
      const requiredUnits = Math.max(1, Math.trunc(Number(rule.quantity ?? 1))) * comboQty;
      let assignedUnits = getComboSelectedUnitsForRule(index, selectedIds, { __quantities: nextQuantityMap });
      if (assignedUnits >= requiredUnits) return;
      selectedIds.forEach((itemId, optionIndex) => {
        if (assignedUnits >= requiredUnits) return;
        const item = items.find((entry) => entry.id === itemId);
        const available = getComboOptionAvailable(item);
        const key = `${index}:${itemId}`;
        const currentQty = Math.max(0, Math.trunc(Number(nextQuantityMap[key] ?? 0)));
        const missing = requiredUnits - assignedUnits;
        const extra = Math.min(missing, Math.max(0, available - currentQty));
        const fallbackExtra = optionIndex === selectedIds.length - 1 && extra <= 0 ? missing : extra;
        nextQuantityMap[key] = currentQty + Math.max(0, fallbackExtra);
        assignedUnits += Math.max(0, fallbackExtra);
      });
    });

    nextSelections.__quantities = nextQuantityMap;
    return {
      ...current,
      quantity: String(comboQty),
      selections: nextSelections,
    };
  };

  const updateComboOptionQuantity = (ruleIndex, itemId, value) => {
    setComboConfigurator((current) => {
      if (!current) return current;
      const parsedQty = Math.max(0, Math.trunc(Number(value ?? 0)));
      const rule = getComboRules(current.combo)[ruleIndex] ?? {};
      const requiredPerCombo = Math.max(1, Math.trunc(Number(rule.quantity ?? 1)));
      const currentSelectedIds = getSelectedComboOptionIds(current.selections?.[ruleIndex], []);
      const selectedIds = currentSelectedIds.includes(itemId)
        ? currentSelectedIds
        : [...currentSelectedIds, itemId];
      const quantityMap = { ...getComboSelectionQuantityMap(current.selections) };
      quantityMap[`${ruleIndex}:${itemId}`] = parsedQty;
      const selectedUnits = getComboSelectedUnitsForRule(ruleIndex, selectedIds, { __quantities: quantityMap });
      const nextComboQuantity = Math.max(1, Math.ceil(selectedUnits / requiredPerCombo));
      const nextState = {
        ...current,
        selections: {
          ...current.selections,
          [ruleIndex]: selectedIds,
          __quantities: quantityMap,
        },
      };
      return normalizeComboConfiguratorQuantities(nextState, nextComboQuantity);
    });
  };

  const toggleComboOption = (ruleIndex, itemId, requiredPerCombo, comboQty) => {
    setComboConfigurator((current) => {
      if (!current) return current;
      const selectedIds = getSelectedComboOptionIds(current.selections?.[ruleIndex], []);
      const selected = selectedIds.includes(itemId);
      const nextSelectedIds = selected
        ? selectedIds.filter((id) => id !== itemId)
        : [...selectedIds, itemId];
      const quantityMap = { ...getComboSelectionQuantityMap(current.selections) };
      if (selected) {
        delete quantityMap[`${ruleIndex}:${itemId}`];
      } else {
        const item = items.find((entry) => entry.id === itemId);
        const neededUnits = Math.max(1, Math.trunc(Number(requiredPerCombo ?? 1))) * Math.max(1, Math.trunc(Number(comboQty ?? current.quantity ?? 1)));
        const selectedUnits = getComboSelectedUnitsForRule(ruleIndex, selectedIds, { __quantities: quantityMap });
        const missingUnits = Math.max(1, neededUnits - selectedUnits);
        quantityMap[`${ruleIndex}:${itemId}`] = Math.min(missingUnits, Math.max(1, getComboOptionAvailable(item)));
      }
      const nextState = {
        ...current,
        selections: {
          ...current.selections,
          [ruleIndex]: nextSelectedIds,
          __quantities: quantityMap,
        },
      };
      return normalizeComboConfiguratorQuantities(nextState, current.quantity);
    });
  };

  const addDraftCombo = (comboId) => {
    const combo = (combos ?? []).find((entry) => entry.id === comboId);
    if (!combo) return;
    if (getComboRules(combo).length > 0) {
      openComboConfigurator(combo);
      return;
    }
    appendConfiguredCombo(combo, buildDefaultComboSelections(combo));
  };

  const setQuickItemField = (field, value) => {
    setQuickItemDraft((current) => ({ ...current, [field]: value }));
  };

  const addQuickDraftItem = () => {
    const name = quickItemDraft.name.trim();
    const category = quickItemDraft.category.trim();
    if (!name || !category) {
      setFormError('Para crear un item rapido, indica categoria y nombre/modelo.');
      return;
    }
    const itemId = `quick-${Date.now()}`;
    setDraft((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          lineKey: `item-${itemId}-${Date.now()}`,
          itemId,
          quantity: 1,
          unitPriceBs: Math.max(0, Number(quickItemDraft.rentalPriceBs ?? 0)),
          ...(current.pricingMode === 'daily_schedule' ? getActiveScheduleLineFields(current) : {}),
          quickItem: {
            category,
            name,
            color: quickItemDraft.color.trim(),
            material: quickItemDraft.material.trim(),
            rentalPriceBs: Math.max(0, Number(quickItemDraft.rentalPriceBs ?? 0)),
          },
        },
      ],
    }));
    setQuickItemDraft(buildEmptyQuickItemDraft());
    setIsQuickItemOpen(false);
    setFormError('');
  };

  const setDraftItemQuantity = (lineKeyOrItemId, quantityValue) => {
    const draftLine = draft.items.find((line) => (line.lineKey ?? line.itemId) === lineKeyOrItemId);
    const itemId = draftLine?.itemId ?? lineKeyOrItemId;
    const item = items.find((entry) => entry.id === itemId) ?? draft.items.find((line) => (line.lineKey ?? line.itemId) === lineKeyOrItemId && line.quickItem);
    if (!item) return;
    const cleanedValue = cleanIntegerInput(quantityValue);
    if (String(quantityValue ?? '') === '' || cleanedValue === '') {
      setDraft((current) => ({
        ...current,
        items: current.items.map((line) => ((line.lineKey ?? line.itemId) === lineKeyOrItemId || line.itemId === lineKeyOrItemId
          ? { ...line, quantity: '' }
          : line)),
      }));
      return;
    }
    const parsed = Math.max(1, parseIntegerInput(cleanedValue, 1));
    if (draftLine?.comboId && draftLine.comboLineKey) {
      const baseComponentQuantity = Math.max(
        1,
        Math.trunc(Number(
          draftLine.comboComponentQuantity
          ?? (Number(draftLine.quantity ?? 1) / Math.max(1, Number(draftLine.comboQuantity ?? 1))),
        )),
      );
      const nextComboQuantity = Math.max(1, Math.ceil(parsed / baseComponentQuantity));
      setDraft((current) => ({
        ...current,
        items: current.items.map((line) => {
          if (line.comboLineKey !== draftLine.comboLineKey) return line;
          const componentQuantity = Math.max(
            1,
            Math.trunc(Number(
              line.comboComponentQuantity
              ?? (Number(line.quantity ?? 1) / Math.max(1, Number(line.comboQuantity ?? 1))),
            )),
          );
          const nextQuantity = componentQuantity * nextComboQuantity;
          const nextUnitPrice = line.comboPricingRole === 'price'
            ? getComboLineUnitPriceForQuantity(line, nextComboQuantity)
            : 0;
          return {
            ...line,
            quantity: nextQuantity,
            unitPriceBs: line.comboPricingRole === 'price' ? nextUnitPrice : line.unitPriceBs,
            comboQuantity: nextComboQuantity,
            comboComponentQuantity: componentQuantity,
            lineTotalBs: line.comboPricingRole === 'price'
              ? Number((nextUnitPrice * nextComboQuantity).toFixed(2))
              : 0,
          };
        }),
      }));
      return;
    }
    setDraft((current) => ({
      ...current,
      items: current.items.map((line) => ((line.lineKey ?? line.itemId) === lineKeyOrItemId || line.itemId === lineKeyOrItemId
        ? {
          ...line,
          quantity: parsed,
          grossLineTotalBs: undefined,
          lineTotalBs: line.comboId ? Number(line.lineTotalBs ?? 0) : undefined,
        }
        : line)),
    }));
  };

  const removeDraftItem = (lineKeyOrItemId) => {
    const draftLine = draft.items.find((line) => (line.lineKey ?? line.itemId) === lineKeyOrItemId);
    setDraft((current) => ({
      ...current,
      items: current.items.filter((line) => (
        draftLine?.comboLineKey
          ? line.comboLineKey !== draftLine.comboLineKey
          : (line.lineKey ?? line.itemId) !== lineKeyOrItemId
      )),
    }));
  };

  const moveSelectedItemWithinArea = (sourceMoveKey, targetMoveKey) => {
    if (!sourceMoveKey || !targetMoveKey || sourceMoveKey === targetMoveKey) return;
    const sourceLine = selectedItems.find((line) => getWizardItemMoveKey(line) === sourceMoveKey);
    const targetLine = selectedItems.find((line) => getWizardItemMoveKey(line) === targetMoveKey);
    if (!sourceLine || !targetLine) return;
    if (resolveWizardItemArea(sourceLine).key !== resolveWizardItemArea(targetLine).key) return;

    setDraft((current) => {
      const getDraftMoveKey = (line) => String(line.comboLineKey ?? line.lineKey ?? line.itemId ?? '');
      const sourceFirstIndex = current.items.findIndex((line) => getDraftMoveKey(line) === sourceMoveKey);
      const targetOriginalIndex = current.items.findIndex((line) => getDraftMoveKey(line) === targetMoveKey);
      const sourceLines = current.items.filter((line) => getDraftMoveKey(line) === sourceMoveKey);
      if (!sourceLines.length) return current;
      const withoutSource = current.items.filter((line) => getDraftMoveKey(line) !== sourceMoveKey);
      const targetIndex = withoutSource.findIndex((line) => getDraftMoveKey(line) === targetMoveKey);
      if (targetIndex < 0) return current;
      const insertIndex = sourceFirstIndex >= 0 && targetOriginalIndex >= 0 && sourceFirstIndex < targetOriginalIndex
        ? targetIndex + 1
        : targetIndex;
      const nextItems = [
        ...withoutSource.slice(0, insertIndex),
        ...sourceLines,
        ...withoutSource.slice(insertIndex),
      ];
      return { ...current, items: nextItems };
    });
  };

  const handleSelectedItemDragStart = (event, line) => {
    if (event.target.closest('button, input, select, textarea, a')) {
      event.preventDefault();
      return;
    }
    const moveKey = getWizardItemMoveKey(line);
    setDraggedSelectedItemKey(moveKey);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', moveKey);
  };

  const handleSelectedItemDragOver = (event, targetLine) => {
    const sourceMoveKey = draggedSelectedItemKey || event.dataTransfer.getData('text/plain');
    const sourceLine = selectedItems.find((line) => getWizardItemMoveKey(line) === sourceMoveKey);
    if (!sourceLine || resolveWizardItemArea(sourceLine).key !== resolveWizardItemArea(targetLine).key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleSelectedItemDrop = (event, targetLine) => {
    event.preventDefault();
    const sourceMoveKey = draggedSelectedItemKey || event.dataTransfer.getData('text/plain');
    moveSelectedItemWithinArea(sourceMoveKey, getWizardItemMoveKey(targetLine));
    setDraggedSelectedItemKey('');
  };

  const openItemObservationModal = (line) => {
    setItemObservationModal({
      lineKey: line.lineKey,
      itemName: line.item?.name || line.itemName || 'Item',
      observation: String(line.observation ?? '').trim(),
    });
  };

  const saveItemObservation = () => {
    if (!itemObservationModal?.lineKey) return;
    const nextObservation = String(itemObservationModal.observation ?? '').trim();
    setDraft((current) => ({
      ...current,
      items: current.items.map((line) => (String(line.lineKey ?? line.comboLineKey ?? line.itemId) === itemObservationModal.lineKey
        ? { ...line, observation: nextObservation }
        : line)),
    }));
    setItemObservationModal(null);
  };

  const setServiceDraftField = (field, value) => {
    const nextValue = field === 'unitPriceBs'
      ? cleanDecimalInput(value)
      : field === 'quantity'
      ? cleanIntegerInput(value)
      : value;
    setServiceDraft((current) => ({ ...current, [field]: nextValue }));
  };

  const openServiceModal = () => {
    setEditingServiceId('');
    setServiceDraft(buildEmptyServiceDraft());
    setFormError('');
    setServiceModalOpen(true);
  };

  const openEditServiceModal = (service) => {
    setEditingServiceId(service.id);
    setServiceDraft({
      name: String(service.name ?? ''),
      detail: String(service.detail ?? ''),
      quantity: String(Math.max(1, Number(service.quantity ?? 1))),
      unitPriceBs: String(Math.max(0, Number(service.unitPriceBs ?? 0))),
    });
    setFormError('');
    setServiceModalOpen(true);
  };

  const closeServiceModal = () => {
    setServiceModalOpen(false);
    setEditingServiceId('');
    setServiceDraft(buildEmptyServiceDraft());
    setFormError('');
  };

  const saveDraftService = () => {
    const name = serviceDraft.name.trim();
    const quantity = Math.max(1, parseIntegerInput(serviceDraft.quantity, 1));
    const unitPriceBs = Math.max(0, parseMoneyInput(serviceDraft.unitPriceBs, 0));
    if (!name) {
      setFormError('Indica el nombre del servicio.');
      return;
    }
    if (!Number.isFinite(unitPriceBs) || unitPriceBs <= 0) {
      setFormError('Indica un precio mayor a cero para el servicio.');
      return;
    }
    setDraft((current) => {
      const serviceFields = {
        name,
        detail: serviceDraft.detail.trim(),
        quantity,
        unitPriceBs,
      };
      return {
        ...current,
        services: editingServiceId
          ? (current.services ?? []).map((service) => (
            service.id === editingServiceId ? { ...service, ...serviceFields } : service
          ))
          : [
            ...(current.services ?? []),
            {
              id: `service-${Date.now()}`,
              ...serviceFields,
              ...(current.pricingMode === 'daily_schedule' ? getActiveScheduleLineFields(current) : {}),
            },
          ],
      };
    });
    setFormError('');
    closeServiceModal();
  };

  const removeDraftService = (serviceId) => {
    setDraft((current) => ({
      ...current,
      services: (current.services ?? []).filter((service) => service.id !== serviceId),
    }));
  };

  const setDraftItemPrice = (lineKeyOrItemId, value) => {
    const cleanedValue = cleanDecimalInput(value);
    const isEmptyValue = String(value ?? '') === '' || cleanedValue === '';
    const parsed = Math.max(0, parseMoneyInput(cleanedValue, 0));
    setDraft((current) => ({
      ...current,
      items: current.items.map((line) => ((line.lineKey ?? line.itemId) === lineKeyOrItemId || line.itemId === lineKeyOrItemId
        ? {
          ...line,
          unitPriceBs: isEmptyValue ? '' : cleanedValue,
          unitPriceInput: isEmptyValue ? '' : cleanedValue,
          grossLineTotalBs: undefined,
          lineTotalBs: line.comboId
            ? Number((parsed * Math.max(1, Number(line.comboQuantity ?? 1))).toFixed(2))
            : undefined,
        }
        : line)),
    }));
  };

  const setDraftItemDiscountPercent = (lineKeyOrItemId, value) => {
    const nextPercent = Math.min(100, Math.max(0, Number(value ?? 0)));
    setDraft((current) => ({
      ...current,
      items: current.items.map((line) => ((line.lineKey ?? line.itemId) === lineKeyOrItemId || line.itemId === lineKeyOrItemId
        ? { ...line, discountPercent: String(nextPercent) }
        : line)),
    }));
  };

  const normalizeDraftItemQuantity = (lineKeyOrItemId) => {
    const draftLine = draft.items.find((line) => (line.lineKey ?? line.itemId) === lineKeyOrItemId || line.itemId === lineKeyOrItemId);
    if (draftLine?.comboId && draftLine.comboLineKey) {
      const parsed = Math.max(1, parseIntegerInput(draftLine.quantity, 1));
      const baseComponentQuantity = Math.max(
        1,
        Math.trunc(Number(
          draftLine.comboComponentQuantity
          ?? (Number(draftLine.quantity ?? 1) / Math.max(1, Number(draftLine.comboQuantity ?? 1))),
        )),
      );
      const nextComboQuantity = Math.max(1, Math.ceil(parsed / baseComponentQuantity));
      setDraft((current) => ({
        ...current,
        items: current.items.map((line) => {
          if (line.comboLineKey !== draftLine.comboLineKey) return line;
          const componentQuantity = Math.max(
            1,
            Math.trunc(Number(
              line.comboComponentQuantity
              ?? (Number(line.quantity ?? 1) / Math.max(1, Number(line.comboQuantity ?? 1))),
            )),
          );
          const nextQuantity = componentQuantity * nextComboQuantity;
          const nextUnitPrice = line.comboPricingRole === 'price'
            ? getComboLineUnitPriceForQuantity(line, nextComboQuantity)
            : 0;
          return {
            ...line,
            quantity: nextQuantity,
            unitPriceBs: line.comboPricingRole === 'price' ? nextUnitPrice : line.unitPriceBs,
            comboQuantity: nextComboQuantity,
            comboComponentQuantity: componentQuantity,
            grossLineTotalBs: undefined,
            lineTotalBs: line.comboPricingRole === 'price'
              ? Number((nextUnitPrice * nextComboQuantity).toFixed(2))
              : 0,
          };
        }),
      }));
      return;
    }
    setDraft((current) => ({
      ...current,
      items: current.items.map((line) => ((line.lineKey ?? line.itemId) === lineKeyOrItemId || line.itemId === lineKeyOrItemId
        ? { ...line, quantity: Math.max(1, parseIntegerInput(line.quantity, 1)), grossLineTotalBs: undefined }
        : line)),
    }));
  };

  const normalizeDraftItemPrice = (lineKeyOrItemId) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((line) => {
        if ((line.lineKey ?? line.itemId) !== lineKeyOrItemId && line.itemId !== lineKeyOrItemId) return line;
        const parsed = Math.max(0, parseMoneyInput(line.unitPriceBs, 0));
        return {
          ...line,
          unitPriceBs: Number(parsed.toFixed(2)),
          unitPriceInput: parsed.toFixed(2),
          grossLineTotalBs: undefined,
          lineTotalBs: line.comboId
            ? Number((parsed * Math.max(1, Number(line.comboQuantity ?? 1))).toFixed(2))
            : undefined,
        };
      }),
    }));
  };

  const setDraftPricingMode = (value) => {
    setDraft((current) => ({
      ...current,
      pricingMode: value === 'daily_schedule' ? 'daily_schedule' : value === 'duration' ? 'duration' : 'simple',
      pricingDays: String(parsePositiveInteger(current.pricingDays, 1)),
      pricingTiers: Array.isArray(current.pricingTiers) && current.pricingTiers.length > 0
        ? current.pricingTiers
        : DURATION_PRICING_DEFAULT_TIERS,
      scheduleDays: Array.isArray(current.scheduleDays) && current.scheduleDays.length > 0
        ? current.scheduleDays
        : buildScheduleDaysFromRange(current.deliveryDate || current.eventDate, current.pickupDate || current.eventDate),
    }));
  };

  const syncScheduleDaysFromLogistics = () => {
    setDraft((current) => {
      const nextDays = buildScheduleDaysFromRange(current.deliveryDate || current.eventDate, current.pickupDate || current.eventDate);
      const existingByDate = new Map(
        (current.scheduleDays ?? [])
          .map((day) => [getDateKey(day.date), day])
          .filter(([date]) => Boolean(date)),
      );
      const mergedDays = nextDays.map((day, index) => {
        const dateKey = getDateKey(day.date);
        const existingDay = existingByDate.get(dateKey);
        return {
          ...day,
          ...(existingDay ?? {}),
          id: existingDay?.id ?? day.id,
          label: existingDay?.label ?? `Dia ${index + 1}`,
          date: dateKey || day.date,
        };
      });
      const validDayIds = new Set(mergedDays.map((day) => day.id));
      const fallbackDayId = mergedDays[0]?.id ?? '';
      const resolveMergedDay = (line) => findScheduleDayForLine(
        line,
        mergedDays,
        mergedDays[0] ?? null,
        { preferDate: true },
      );
      return {
        ...current,
        scheduleDays: mergedDays,
        items: current.items.map((line) => {
          const day = resolveMergedDay(line);
          if (validDayIds.has(line.serviceDayId) && String(day?.id ?? '') === String(line.serviceDayId ?? '')) return line;
          return {
            ...line,
            serviceDayId: day?.id ?? fallbackDayId,
            serviceDate: day?.date ?? line.serviceDate ?? '',
            serviceDayLabel: day?.label ?? line.serviceDayLabel ?? '',
          };
        }),
        services: current.services.map((service) => {
          const day = resolveMergedDay(service);
          if (validDayIds.has(service.serviceDayId) && String(day?.id ?? '') === String(service.serviceDayId ?? '')) return service;
          return {
            ...service,
            serviceDayId: day?.id ?? fallbackDayId,
            serviceDate: day?.date ?? service.serviceDate ?? '',
            serviceDayLabel: day?.label ?? service.serviceDayLabel ?? '',
          };
        }),
      };
    });
  };

  const addScheduleDay = () => {
    setDraft((current) => {
      const source = Array.isArray(current.scheduleDays) && current.scheduleDays.length > 0
        ? current.scheduleDays
        : buildScheduleDaysFromRange(current.deliveryDate || current.eventDate, current.pickupDate || current.eventDate);
      const lastDate = getDateKey(source[source.length - 1]?.date) || current.pickupDate || current.deliveryDate || getInputDate(new Date());
      const nextDate = new Date(`${lastDate}T12:00:00`);
      nextDate.setDate(nextDate.getDate() + 1);
      const date = getInputDate(nextDate);
      const nextDay = normalizeScheduleDay({ id: `day-${date}-${Date.now()}`, label: `Dia ${source.length + 1}`, date }, source.length, date);
      setActiveScheduleDayId(nextDay.id);
      return { ...current, scheduleDays: [...source, nextDay] };
    });
  };

  const updateScheduleDay = (dayId, patch) => {
    setDraft((current) => ({
      ...current,
      scheduleDays: (current.scheduleDays ?? []).map((day, index) => (
        day.id === dayId ? normalizeScheduleDay({ ...day, ...patch }, index, current.deliveryDate || current.eventDate) : day
      )),
    }));
  };

  const removeScheduleDay = (dayId) => {
    setDraft((current) => {
      const source = Array.isArray(current.scheduleDays) && current.scheduleDays.length > 0 ? current.scheduleDays : [];
      if (source.length <= 1) return current;
      const nextDays = source.filter((day) => day.id !== dayId);
      const fallbackDayId = nextDays[0]?.id ?? '';
      if (activeScheduleDayId === dayId) setActiveScheduleDayId(fallbackDayId);
      return {
        ...current,
        scheduleDays: nextDays,
        items: current.items.map((line) => (
          line.serviceDayId === dayId ? { ...line, serviceDayId: fallbackDayId } : line
        )),
      };
    });
  };

  const setDraftPricingDays = (value) => {
    setDraft((current) => ({ ...current, pricingDays: String(Math.max(1, Math.trunc(Number(value || 1)))) }));
  };

  const updatePricingTier = (tierId, field, value) => {
    setDraft((current) => {
      const nextTiers = current.pricingTiers.map((tier) => (
        tier.id === tierId ? { ...tier, [field]: value } : tier
      ));
      return {
        ...current,
        pricingDays: String(parsePositiveInteger(current.pricingDays, 1)),
        pricingTiers: nextTiers,
      };
    });
  };

  const addPricingTier = () => {
    setDraft((current) => {
      const normalized = normalizeDurationTiers(current.pricingTiers);
      const lastTier = normalized[normalized.length - 1] ?? { fromDay: 1, toDay: 1, percent: 100 };
      const nextFromDay = lastTier.toDay > 0 ? lastTier.toDay + 1 : lastTier.fromDay + 1;
      return {
        ...current,
        pricingDays: String(Math.max(parsePositiveInteger(current.pricingDays, 1), nextFromDay)),
        pricingTiers: [
          ...current.pricingTiers,
          {
            id: `tier-${Date.now()}`,
            fromDay: String(nextFromDay),
            toDay: '',
            percent: String(lastTier.percent ?? 50),
          },
        ],
      };
    });
  };

  const removePricingTier = (tierId) => {
    setDraft((current) => {
      if (current.pricingTiers.length <= 1) return current;
      return {
        ...current,
        pricingTiers: current.pricingTiers.filter((tier) => tier.id !== tierId),
      };
    });
  };

  const getUncoveredStockIssueMessage = (issue) => {
    const selectedLine = selectedItems.find((line) => line.itemId === issue.itemId);
    const hardRecords = selectedLine?.availability?.hardReservedQtyRecords ?? [];
    const conflictText = hardRecords
      .slice(0, 2)
      .map((record) => `contrato ${record.contractCode || record.code || record.orderCode || ''} hasta ${formatDate(record.endDate)}`)
      .join(', ');
    return `${issue.itemName} tiene faltante sin cubrir. Faltan ${issue.uncoveredQty} unidades.${conflictText ? ` Esta usado por ${conflictText}.` : ''} Selecciona proveedor o reduce cantidad.`;
  };

  const getStepValidationMessage = (stepIndex) => {
    if (stepIndex === 0) {
      if (!draft.customerName.trim()) return 'Completa el nombre del cliente para continuar.';
      if (!draft.customerPhone.trim()) return 'Completa el WhatsApp o celular del cliente.';
      if (!draft.recordId && draft.documentCodeMode !== 'auto' && !draft.manualDocumentCode.trim()) {
        return 'Indica el codigo del libro o vuelve a automatico.';
      }
      return '';
    }
    if (stepIndex === 1) {
      if (!draft.eventType.trim()) return 'Indica el tipo de evento.';
      if (!draft.eventDate) return 'Selecciona la fecha del evento.';
      if (!draft.eventTime) return 'Selecciona la hora del evento.';
      if (!draft.address.trim()) return 'Indica la direccion del evento para guardar el historial del cliente.';
      return '';
    }
    if (stepIndex === 2) {
      if (!selectedItems.length && !selectedServices.length) return 'Agrega al menos un item o servicio para continuar.';
      if (!bypassStockValidation && uncoveredStockIssues.length) {
        const issue = uncoveredStockIssues[0];
        return getUncoveredStockIssueMessage(issue);
      }
      if (draft.pricingMode === 'duration' && parsePositiveInteger(draft.pricingDays, 0) <= 0) {
        return 'Indica cuantos dias de uso se deben cobrar.';
      }
      return '';
    }
    if (stepIndex === 3) {
      if (!draft.deliveryDate) return 'Selecciona fecha de entrega.';
      if (draft.pickupTimeMode !== 'coordinate' && !draft.pickupDate) return 'Selecciona fecha de recojo.';
      if (draft.deliveryTimeMode !== 'coordinate' && !isValidSameDayWindow(draft.deliveryWindowStart, draft.deliveryWindowEnd)) {
        return 'La ventana de entrega debe terminar despues de la hora de inicio.';
      }
      if (draft.pickupTimeMode !== 'coordinate' && !isValidSameDayWindow(draft.pickupWindowStart, draft.pickupWindowEnd)) {
        return 'La ventana de recojo debe terminar despues de la hora de inicio.';
      }
      return '';
    }
    return '';
  };

  const handleNextStep = () => {
    const message = getStepValidationMessage(currentStep);
    if (message) {
      setFormError(message);
      return;
    }
    setFormError('');
    setCurrentStep((step) => Math.min(QUOTE_WIZARD_STEPS.length - 1, step + 1));
  };

  const handlePrevStep = () => {
    setFormError('');
    setCurrentStep((step) => Math.max(0, step - 1));
  };

  const handleClientFieldsArrowNavigation = useCallback((event) => {
    const keyDeltas = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 2,
      ArrowUp: -2,
    };
    const delta = keyDeltas[event.key];
    if (!delta) return;

    const currentField = event.target.closest?.('[data-client-nav-field]');
    if (!currentField) return;
    const fields = Array.from(event.currentTarget.querySelectorAll('[data-client-nav-field]'))
      .map((field) => field.querySelector('input, select, textarea'))
      .filter((field) => field && !field.disabled && field.offsetParent !== null);
    const currentIndex = fields.findIndex((field) => field === event.target || field.contains?.(event.target));
    if (currentIndex < 0) return;

    const nextIndex = Math.max(0, Math.min(fields.length - 1, currentIndex + delta));
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const nextField = fields[nextIndex];
    nextField.focus();
    if (nextField.tagName === 'INPUT' && nextField.type !== 'date') {
      nextField.select?.();
    }
  }, []);

  const canJumpBetweenWizardSteps = Boolean(draft.recordId);
  const isEditingContract = draft.entityType === 'contract' && Boolean(draft.recordId);

  const handleWizardStepClick = (targetStep) => {
    if (!canJumpBetweenWizardSteps && targetStep > currentStep) return;
    setFormError('');
    setCurrentStep(targetStep);
  };

  const toggleDraftResponsible = (responsibleId) => {
    setDraft((current) => {
      const currentIds = Array.isArray(current.responsibleIds) ? current.responsibleIds : [];
      const exists = currentIds.includes(responsibleId);
      const nextIds = exists
        ? currentIds.filter((id) => id !== responsibleId)
        : [...currentIds, responsibleId];
      return {
        ...current,
        responsibleIds: nextIds.length > 0 ? nextIds : currentIds,
      };
    });
  };

  const getSelectedResponsibles = () => {
    const selectedIds = Array.isArray(draft.responsibleIds) ? draft.responsibleIds : [];
    const selected = responsibleOptions.filter((option) => selectedIds.includes(option.id));
    if (selected.length > 0) return selected;
    return fallbackResponsibleId
      ? responsibleOptions.filter((option) => option.id === fallbackResponsibleId)
      : [];
  };

  const createQuotePayload = () => {
    if (!draft.customerName.trim()) throw new Error('Debes indicar el cliente para la cotizacion.');
    if (!draft.customerPhone.trim()) throw new Error('Debes indicar el WhatsApp o celular del cliente.');
    if (!draft.recordId && draft.documentCodeMode !== 'auto' && !draft.manualDocumentCode.trim()) {
      throw new Error('Debes indicar el codigo del libro.');
    }
    if (!draft.eventDate) throw new Error('Debes indicar la fecha del evento.');
    if (!draft.address.trim()) throw new Error('Debes indicar la direccion del evento.');
    if (!draft.deliveryDate) throw new Error('Debes indicar la fecha de entrega.');
    if (draft.pickupTimeMode !== 'coordinate' && !draft.pickupDate) throw new Error('Debes indicar la fecha de recojo.');
    if (draft.deliveryTimeMode !== 'coordinate' && !isValidSameDayWindow(draft.deliveryWindowStart, draft.deliveryWindowEnd)) {
      throw new Error('La ventana de entrega debe terminar despues de la hora de inicio.');
    }
    if (draft.pickupTimeMode !== 'coordinate' && !isValidSameDayWindow(draft.pickupWindowStart, draft.pickupWindowEnd)) {
      throw new Error('La ventana de recojo debe terminar despues de la hora de inicio.');
    }
    if (!selectedItems.length && !selectedServices.length) throw new Error('Debes agregar al menos un item o servicio.');
    if (!bypassStockValidation && uncoveredStockIssues.length) {
      const issue = uncoveredStockIssues[0];
      throw new Error(getUncoveredStockIssueMessage(issue));
    }
    if (draft.logisticsMode === 'envio' && draft.deliveryChargeMode === 'extra' && quoteDeliveryFeeBs <= 0) {
      throw new Error('Indica el costo extra de envio.');
    }

    const paidAtApprovalBs = Math.max(0, Number(draft.paidAtApprovalBs ?? 0));
    const guaranteeBs = Math.max(0, Number(draft.guaranteeBs ?? 0));
    if (guaranteeBs > 0 && draft.guaranteeStatus === 'validado' && draft.guaranteePaymentMethod === 'qr' && !draft.guaranteePaymentAccount) {
      throw new Error('Selecciona la cuenta QR donde ingreso la garantia.');
    }
    if (paidAtApprovalBs > 0 && draft.initialPaymentMethod === 'qr' && !draft.initialPaymentAccount) {
      throw new Error('Selecciona la cuenta QR donde ingreso el pago inicial.');
    }

    const supplierFulfillmentPlan = (() => {
      if (isHistoricalReconstruction) return [];
      if (isHistoricalReturnedContractEdit) {
        return Array.isArray(draft.supplierFulfillmentPlan) ? draft.supplierFulfillmentPlan : [];
      }

      const removedIds = removedSupplierCoverageIdsRef.current;
      const retainedLineKeys = new Set(selectedItems.map((line) => String(line.lineKey ?? '').trim()).filter(Boolean));
      const retainedItemIds = new Set(selectedItems.map((line) => String(line.itemId ?? '').trim()).filter(Boolean));
      const livePlan = selectedItems.flatMap((line) => {
        const coverageKey = getSupplierCoverageKey(line);
        const coverages = normalizeCoverageDraftLines(
          supplierFulfillmentDraftByItem[coverageKey] ?? supplierFulfillmentDraftByItem[line.itemId],
        );
        return coverages.map((coverage) => ({
          id: coverage.id,
          lineKey: line.lineKey ?? coverage.lineKey ?? null,
          itemId: line.itemId,
          itemName: line.item?.name ?? line.itemName ?? '',
          supplierId: coverage.supplierId,
          supplierName: coverage.supplierName,
          supplierQuoteId: coverage.supplierQuoteId,
          supplierQuoteCode: coverage.supplierQuoteCode,
          neededQty: coverage.neededQty,
          supplierUnitCostBs: coverage.supplierUnitCostBs,
          saleUnitPriceBs: getSupplierCoverageEffectiveSaleUnitPriceBs(line),
          baseSaleUnitPriceBs: line.unitPriceBs,
          saleDiscountPercent: clampPercentValue(line.discountPercent),
          discountApplied: clampPercentValue(line.discountPercent) > 0,
          manualCoverage: Boolean(coverage.manualCoverage),
          createdAt: coverage.createdAt,
        }));
      }).filter((line) => (
        line.neededQty > 0
        && line.supplierId
        && line.supplierName
        && !removedIds.has(String(line.id ?? ''))
      ));

      const liveIds = new Set(livePlan.map((line) => String(line.id ?? '')).filter(Boolean));
      const preservedPlan = (Array.isArray(draft.supplierFulfillmentPlan) ? draft.supplierFulfillmentPlan : [])
        .filter((line) => {
          const id = String(line?.id ?? '').trim();
          if ((id && (removedIds.has(id) || liveIds.has(id)))) return false;
          const lineKey = String(line?.lineKey ?? '').trim();
          const itemId = String(line?.itemId ?? '').trim();
          return (lineKey && retainedLineKeys.has(lineKey)) || (itemId && retainedItemIds.has(itemId));
        });

      return [...livePlan, ...preservedPlan];
    })();
    const selectedResponsibles = getSelectedResponsibles();
    const primaryResponsible = selectedResponsibles[0] ?? null;
    const contractObservations = draft.observations.trim();

    return {
      id: draft.recordId || undefined,
      quoteId: draft.quoteId || null,
      documentCodeMode: draft.documentCodeMode,
      manualDocumentCode: draft.manualDocumentCode.trim(),
      contractDate: draft.contractDate || null,
      historicalReconstruction: isHistoricalReconstruction,
      clientId: draft.clientId || null,
      customerName: draft.customerName.trim(),
      customerCi: draft.customerCi.trim(),
      customerPhone: draft.customerPhone.trim(),
      customerReferencePhone: draft.customerReferencePhone.trim(),
      companyName: draft.companyName.trim() || draft.customerName.trim(),
      eventType: draft.eventType,
      eventDate: draft.eventDate,
      eventTime: draft.eventTime,
      address: draft.address.trim(),
      city: draft.city.trim(),
      billingMode: draft.billingMode,
      deliveryDate: draft.deliveryDate,
      logisticsMode: draft.logisticsMode,
      deliveryChargeMode: draft.logisticsMode === 'envio' ? draft.deliveryChargeMode : 'included',
      deliveryFeeBs: quoteDeliveryFeeBs,
      deliveryFeeReason: draft.logisticsMode === 'envio' && draft.deliveryChargeMode === 'extra'
        ? draft.deliveryFeeReason
        : 'covered',
      deliveryWindowStart: draft.deliveryWindowStart,
      deliveryWindowEnd: draft.deliveryWindowEnd,
      deliveryTimeMode: draft.deliveryTimeMode === 'coordinate' ? 'coordinate' : 'fixed',
      pickupDate: draft.pickupTimeMode === 'coordinate' ? null : draft.pickupDate,
      pickupWindowStart: draft.pickupTimeMode === 'coordinate' ? null : draft.pickupWindowStart,
      pickupWindowEnd: draft.pickupTimeMode === 'coordinate' ? null : draft.pickupWindowEnd,
      pickupTimeMode: draft.pickupTimeMode === 'coordinate' ? 'coordinate' : 'fixed',
      driverId: draft.driverId || null,
      vehicleId: draft.vehicleId || null,
      validUntil: draft.validUntil || null,
      observations: contractObservations,
      discountMode: generalDiscountMode,
      discountBs: generalDiscountBs,
      discountPercent: generalDiscountPercent,
      itemDiscountsBs,
      itemsGrossSubtotalBs: grossItemsSubtotalBs,
      itemsNetSubtotalBs: baseItemsSubtotalBs,
      guaranteeBs,
      guaranteeStatus: draft.guaranteeStatus === 'validado' ? 'validado' : 'no_validado',
      guaranteePaymentMethod: draft.guaranteePaymentMethod || 'efectivo',
      guaranteePaymentAccount: draft.guaranteePaymentMethod === 'qr' ? draft.guaranteePaymentAccount : '',
      paidAtApprovalBs,
      prepaidAppliedBs: selectedClientForDraft?.prepaidEnabled ? selectedClientPrepaidCoverageBs : 0,
      initialPaymentMethod: draft.initialPaymentMethod || 'efectivo',
      initialPaymentAccount: draft.initialPaymentMethod === 'qr' ? draft.initialPaymentAccount : '',
      pricingPlan: quotePricingPlan,
      status: draft.mode === 'order' ? 'enviada' : 'borrador',
      items: selectedItems.map((line, index) => {
        const assignedDay = findScheduleDayForLine(
          line,
          normalizedScheduleDays,
          normalizedScheduleDays[0] ?? null,
          { preferDate: true },
        );
        return {
        lineKey: getDraftLineKey(line, index),
        itemId: String(line.itemId).startsWith('quick-') ? '' : line.itemId,
        quantity: line.quantity,
        unitPriceBs: line.unitPriceBs,
        grossLineTotalBs: line.grossLineTotalBs,
        lineTotalBs: line.lineTotalBs,
        discountPercent: line.discountPercent,
        discountBs: line.lineDiscountBs,
        lineType: line.lineType ?? '',
        controlsStock: line.controlsStock,
        verificationStatus: line.verificationStatus,
        quickItem: line.quickItem ?? null,
        comboId: line.comboId ?? null,
        comboName: line.comboName ?? '',
        comboLineKey: line.comboLineKey ?? null,
        comboComponentName: line.comboComponentName ?? '',
        comboQuantity: line.comboQuantity ?? 1,
        comboComponentQuantity: line.comboComponentQuantity ?? 1,
        comboPricingRole: line.comboPricingRole ?? '',
        comboPricingCondition: line.comboPricingCondition ?? null,
        comboRuleIndex: line.comboRuleIndex ?? 0,
        comboSlotLabel: line.comboSlotLabel ?? '',
        comboSelectionMode: line.comboSelectionMode ?? 'item',
        comboOptionItemIds: Array.isArray(line.comboOptionItemIds) ? line.comboOptionItemIds : [],
        comboCategory: line.comboCategory ?? '',
        observation: String(line.observation ?? '').trim(),
        serviceDayId: line.serviceDayId ?? assignedDay?.id ?? null,
        serviceDate: line.serviceDate ?? assignedDay?.date ?? null,
        serviceDayLabel: line.serviceDayLabel ?? assignedDay?.label ?? '',
        };
      }),
      services: selectedServices.map((service) => {
        const assignedDay = findScheduleDayForLine(
          service,
          normalizedScheduleDays,
          normalizedScheduleDays[0] ?? null,
          { preferDate: true },
        );
        return {
        id: service.id,
        name: service.name,
        detail: service.detail,
        quantity: service.quantity,
        unitPriceBs: service.unitPriceBs,
        lineTotalBs: service.lineTotalBs,
        serviceDayId: service.serviceDayId ?? assignedDay?.id ?? null,
        serviceDate: service.serviceDate ?? assignedDay?.date ?? null,
        serviceDayLabel: service.serviceDayLabel ?? assignedDay?.label ?? '',
        };
      }),
      supplierFulfillmentPlan,
      responsibles: selectedResponsibles,
      createdBy: primaryResponsible?.name ?? undefined,
      createdById: primaryResponsible?.id ?? undefined,
      createdByName: primaryResponsible?.name ?? undefined,
      createdByRole: primaryResponsible?.role ?? undefined,
    };
  };

  const buildContractPayloadFromQuote = (quote) => ({
    ...quote,
    id: undefined,
    quoteCode: undefined,
    quoteId: quote?.id ?? null,
    status: 'borrador',
    validUntil: null,
    contractDate: quote?.contractDate ?? new Date().toISOString(),
    discountMode: quote?.totals?.discountMode ?? quote?.discountMode ?? 'percent',
    discountBs: quote?.totals?.discountBs ?? quote?.discountBs ?? 0,
    discountPercent: quote?.totals?.discountPercent ?? quote?.discountPercent ?? 0,
    guaranteeBs: quote?.totals?.guaranteeBs ?? quote?.guarantee?.amountBs ?? 0,
    guaranteeStatus: quote?.guarantee?.status ?? quote?.payment?.guaranteeStatus ?? 'no_validado',
    guaranteePaymentMethod: quote?.guarantee?.paymentMethod
      ?? quote?.payment?.guaranteePaymentMethod
      ?? 'efectivo',
    guaranteePaymentAccount: quote?.guarantee?.paymentAccount
      ?? quote?.payment?.guaranteePaymentAccount
      ?? '',
    paidAtApprovalBs: quote?.payment?.paidAtApprovalBs ?? 0,
    prepaidAppliedBs: quote?.payment?.prepaidAppliedBs ?? quote?.prepaidAppliedBs ?? 0,
    initialPaymentMethod: quote?.payment?.initialPaymentMethod ?? 'efectivo',
    initialPaymentAccount: quote?.payment?.initialPaymentAccount ?? '',
    deliveryFeeBs: quote?.totals?.deliveryFeeBs ?? quote?.deliveryFeeBs ?? 0,
    items: Array.isArray(quote?.items) ? quote.items : [],
    services: Array.isArray(quote?.services) ? quote.services : [],
    supplierFulfillmentPlan: Array.isArray(quote?.supplierFulfillmentPlan)
      ? quote.supplierFulfillmentPlan
      : [],
  });

  const handleSaveQuote = async ({
    approveNow,
    zeroInitialPaymentConfirmed = false,
    supplierPlanRemovalConfirmed = false,
  }) => {
    const originalPaidAtApprovalBs = Math.max(0, Number(draft.originalPaidAtApprovalBs ?? 0));
    const requestedPaidAtApprovalBs = Math.max(0, Number(draft.paidAtApprovalBs ?? 0));
    const requiresZeroPaymentConfirmation = Boolean(
      draft.entityType === 'contract'
      && draft.recordId
      && originalPaidAtApprovalBs > 0
      && requestedPaidAtApprovalBs <= 0
      && !zeroInitialPaymentConfirmed
    );

    if (requiresZeroPaymentConfirmation) {
      setZeroInitialPaymentConfirmation({
        approveNow: Boolean(approveNow),
        previousAmountBs: originalPaidAtApprovalBs,
        contractCode: draft.manualDocumentCode || draft.recordId,
        customerName: draft.customerName,
      });
      return;
    }

    let payload;
    try {
      payload = createQuotePayload();
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo validar el contrato.');
      return;
    }

    const originalSupplierPlan = Array.isArray(draft.supplierFulfillmentPlan)
      ? draft.supplierFulfillmentPlan
      : [];
    const nextSupplierPlan = Array.isArray(payload.supplierFulfillmentPlan)
      ? payload.supplierFulfillmentPlan
      : [];
    const nextSupplierPlanKeys = new Set(nextSupplierPlan.map((line) => (
      String(line?.id ?? '').trim()
      || [line?.lineKey, line?.itemId, line?.supplierId, line?.supplierName]
        .map((value) => String(value ?? '').trim())
        .join('|')
    )));
    const removedSupplierLines = originalSupplierPlan.filter((line) => {
      const key = String(line?.id ?? '').trim()
        || [line?.lineKey, line?.itemId, line?.supplierId, line?.supplierName]
          .map((value) => String(value ?? '').trim())
          .join('|');
      return key && !nextSupplierPlanKeys.has(key);
    });

    if (
      draft.entityType === 'contract'
      && draft.recordId
      && removedSupplierLines.length > 0
      && !supplierPlanRemovalConfirmed
    ) {
      setSupplierPlanRemovalConfirmation({
        approveNow: Boolean(approveNow),
        zeroInitialPaymentConfirmed: Boolean(zeroInitialPaymentConfirmed),
        contractCode: draft.manualDocumentCode || draft.recordId,
        customerName: draft.customerName,
        removedLines: removedSupplierLines.map((line) => ({
          supplierName: String(line?.supplierName ?? 'Proveedor').trim() || 'Proveedor',
          itemName: String(line?.itemName ?? 'Item').trim() || 'Item',
          quantity: Math.max(0, Number(line?.neededQty ?? line?.quantity ?? 0)),
        })),
      });
      return;
    }

    if (!beginSubmit()) return;
    setFormError('');
    setActionFeedback('');
    try {
      setSubmitStatusMessage('Validando datos del contrato...');
      if (draft.entityType === 'contract') {
        const contractPayload = {
          ...payload,
          validUntil: null,
          status: draft.recordStatus || (draft.mode === 'order' ? 'pendiente' : 'borrador'),
          confirmInitialPaymentReset: Boolean(
            zeroInitialPaymentConfirmed
            && Math.max(0, Number(draft.originalPaidAtApprovalBs ?? 0)) > 0
            && Math.max(0, Number(draft.paidAtApprovalBs ?? 0)) <= 0
          ),
          forceInitialPaymentBs: zeroInitialPaymentConfirmed
            && Math.max(0, Number(draft.originalPaidAtApprovalBs ?? 0)) > 0
            && Math.max(0, Number(draft.paidAtApprovalBs ?? 0)) <= 0
            ? 0
            : undefined,
          confirmSupplierPlanRemoval: Boolean(supplierPlanRemovalConfirmed && removedSupplierLines.length > 0),
          supplierPlanRemovalDetails: removedSupplierLines.map((line) => ({
            supplierName: String(line?.supplierName ?? 'Proveedor').trim() || 'Proveedor',
            itemName: String(line?.itemName ?? 'Item').trim() || 'Item',
            quantity: Math.max(0, Number(line?.neededQty ?? line?.quantity ?? 0)),
          })),
        };
        let savedContract = null;
        if (approveNow && !draft.recordId && onCreateAndApproveContract) {
          setSubmitStatusMessage('Creando contrato, orden, inventario y registros vinculados...');
          const transactionResult = await onCreateAndApproveContract(contractPayload);
          savedContract = transactionResult?.contract ?? null;
          if (!savedContract || !transactionResult?.rental) {
            throw new Error('No se pudo completar la aprobacion transaccional del contrato.');
          }
          invalidateContractDocumentPreviewCache(savedContract);
          setSubmitStatusMessage('Contrato aprobado. Cerrando wizard...');
          setActionFeedback(
            `Contrato ${savedContract.contractCode ?? savedContract.id} aprobado y convertido en orden.`,
          );
        } else {
          setSubmitStatusMessage(draft.recordId ? 'Actualizando contrato...' : 'Guardando contrato...');
          savedContract = draft.recordId
            ? await onUpdateContract?.(contractPayload)
            : await onCreateContract?.(contractPayload);
          if (!savedContract) {
            throw new Error('No se pudo guardar el contrato.');
          }
          invalidateContractDocumentPreviewCache(savedContract);
          setDocumentsOrder((current) => {
            if (!current) return current;
            const sameContract = [
              current.id,
              current.contractId,
              current.contractCode,
              current.orderCode,
              current.rentalId,
            ].some((value) => [
              savedContract.id,
              savedContract.contractId,
              savedContract.contractCode,
              savedContract.orderCode,
              savedContract.rentalId,
            ].map((entry) => String(entry ?? '').trim()).filter(Boolean).includes(String(value ?? '').trim()));
            return sameContract ? { ...current, ...savedContract } : current;
          });

          if (approveNow) {
            setSubmitStatusMessage('Generando orden de servicio y reservando inventario...');
            await onApproveContract?.({ contractId: savedContract.id, contract: savedContract });
            setSubmitStatusMessage('Contrato aprobado. Cerrando wizard...');
            setActionFeedback(`Contrato ${savedContract.contractCode ?? savedContract.id} aprobado y convertido en orden.`);
          } else {
            setSubmitStatusMessage('Contrato guardado. Cerrando wizard...');
            setActionFeedback(`Contrato ${savedContract.contractCode ?? savedContract.id} guardado correctamente.`);
          }
        }
      } else {
        setSubmitStatusMessage(draft.recordId ? 'Actualizando cotizacion...' : 'Guardando cotizacion...');
        const savedQuote = draft.recordId
          ? await onUpdateQuote?.({
            ...payload,
            status: draft.recordStatus || payload.status,
          })
          : await onCreateQuote(payload);
        if (approveNow) {
          if (!onCreateAndApproveContract) {
            throw new Error('La aprobacion transaccional de cotizaciones no esta disponible.');
          }
          setSubmitStatusMessage('Creando contrato, orden e inventario desde la cotizacion...');
          const transactionResult = await onCreateAndApproveContract(
            buildContractPayloadFromQuote(savedQuote),
          );
          const contract = transactionResult?.contract ?? null;
          if (!contract || !transactionResult?.rental) {
            throw new Error('No se pudo completar la aprobacion transaccional de la cotizacion.');
          }
          invalidateContractDocumentPreviewCache(contract);
          setActiveView('contracts');
          setActionFeedback(
            contract?.contractCode
              ? `Cotizacion ${savedQuote.quoteCode} aprobada. Se genero el contrato ${contract.contractCode}.`
              : `Cotizacion ${savedQuote.quoteCode} aprobada y convertida en contrato.`,
          );
        } else {
          setSubmitStatusMessage('Cotizacion guardada. Cerrando wizard...');
          setActionFeedback(`Cotizacion ${savedQuote.quoteCode} guardada correctamente.`);
        }
      }
      setModalOpen(false);
      setSupplierPlanRemovalConfirmation(null);
      setItemSearch('');
      setDraft(buildEmptyDraft('quote'));
      setFormError('');
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo guardar la cotizacion.');
    } finally {
      endSubmit();
    }
  };

  const handleApproveQuoteClick = async (quote) => {
    setMenuState(null);
    setFormError('');
    setQuoteApprovalPreview({ ...quote, __previewLoading: true, __previewBlobUrl: '' });
    try {
      const renderedPdf = await fetchQuotePdf({
        identifier: quote.id ?? quote.quoteCode,
        paperSize: 'oficio',
      });
      setQuoteApprovalPreview({
        ...quote,
        __previewLoading: false,
        __previewBlobUrl: renderedPdf.blobUrl,
        __previewViewerUrl: renderedPdf.viewerUrl,
      });
    } catch (requestError) {
      setQuoteApprovalPreview({ ...quote, __previewLoading: false, __previewBlobUrl: '' });
      setFormError(requestError.message || 'No se pudo preparar la cotizacion para aprobar.');
    }
  };

  const confirmApproveQuoteClick = async () => {
    if (!quoteApprovalPreview) return;
    if (!beginSubmit()) return;
    const quote = quoteApprovalPreview;
    setFormError('');
    try {
      if (!onCreateAndApproveContract) {
        throw new Error('La aprobacion transaccional de cotizaciones no esta disponible.');
      }
      setSubmitStatusMessage('Creando contrato, orden e inventario desde la cotizacion...');
      const transactionResult = await onCreateAndApproveContract(
        buildContractPayloadFromQuote(quote),
      );
      const contract = transactionResult?.contract ?? null;
      if (!contract || !transactionResult?.rental) {
        throw new Error('No se pudo completar la aprobacion transaccional de la cotizacion.');
      }
      invalidateContractDocumentPreviewCache(contract);
      setActiveView('contracts');
      setQuoteApprovalPreview(null);
      setActionFeedback(
        contract?.contractCode
          ? `Cotizacion ${quote.quoteCode} aprobada. Se genero el contrato ${contract.contractCode}.`
          : `Cotizacion ${quote.quoteCode} aprobada y convertida en contrato.`,
      );
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo aprobar la cotizacion.');
    } finally {
      endSubmit();
    }
  };

  const handleRejectQuoteClick = async (quote) => {
    if (!beginSubmit()) return;
    try {
      await onUpdateQuote({
        id: quote.id,
        status: 'rechazada',
        rejectedAt: new Date().toISOString(),
        approvedAt: null,
      });
      setActionFeedback(`Cotizacion ${quote.quoteCode} marcada como rechazada.`);
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo actualizar la cotizacion.');
    } finally {
      endSubmit();
      setMenuState(null);
    }
  };

  const handleEditQuoteClick = (quote) => {
    setMenuState(null);
    openCreateModal('quote', 'quote', quote);
  };

  const handleOpenQuoteDocument = async (quote, paperSize = 'oficio') => {
    setMenuState(null);
    setFormError('');
    try {
      const renderedPdf = await fetchQuotePdf({
        identifier: quote.id ?? quote.quoteCode,
        paperSize,
      });
      setDocumentPreview({
        kind: 'quote',
        orderCode: quote.quoteCode ?? quote.id,
        title: `Cotizacion ${quote.quoteCode || quote.id}`,
        fileName: buildDocumentFileBase(quote.customerName, quote.quoteCode || quote.id, 'cotizacion'),
        html: '',
        blobUrl: renderedPdf.blobUrl,
        viewerUrl: renderedPdf.viewerUrl,
        mimeType: 'application/pdf',
        paperSize,
        sourceRow: quote,
        loading: false,
      });
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo abrir la cotizacion.');
    }
  };

  const handleDeleteQuoteClick = async (quote) => {
    setQuoteToDelete(quote);
    setMenuState(null);
  };

  const closeDeleteQuoteDialog = () => {
    if (isSubmitting) return;
    setQuoteToDelete(null);
  };

  const confirmDeleteQuote = async () => {
    if (!quoteToDelete) return;
    if (!beginSubmit()) return;
    setFormError('');
    try {
      await onRemoveQuote?.({ id: quoteToDelete.id });
      setActionFeedback(`Cotizacion ${quoteToDelete.quoteCode} eliminada.`);
      setQuoteToDelete(null);
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo eliminar la cotizacion.');
    } finally {
      endSubmit();
    }
  };

  const handleApproveContractClick = async (contract) => {
    if (!contract || contract.status === 'aprobado' || contract.status === 'anulado') return;
    if (!beginSubmit()) return;
    try {
      await onApproveContract?.({ contractId: contract.id });
      setActiveView('contracts');
      setActionFeedback(`Contrato ${contract.contractCode} aprobado.`);
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo aprobar el contrato.');
    } finally {
      endSubmit();
      setMenuState(null);
    }
  };

  const handleRejectContractClick = async (contract) => {
    if (!beginSubmit()) return;
    try {
      await onUpdateContract?.({
        id: contract.id,
        status: 'rechazado',
        rejectedAt: new Date().toISOString(),
        approvedAt: null,
      });
      setActionFeedback(`Contrato ${contract.contractCode} marcado como rechazado.`);
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo actualizar el contrato.');
    } finally {
      endSubmit();
      setMenuState(null);
    }
  };

  const handleDeleteContractClick = async (contract) => {
    if (!beginSubmit()) return;
    try {
      await onRemoveContract?.({ id: contract.id });
      setActionFeedback(`Contrato ${contract.contractCode} eliminado.`);
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo eliminar el contrato.');
    } finally {
      endSubmit();
      setMenuState(null);
    }
  };

  const handleRestoreContractClick = async (contract) => {
    const confirmed = window.confirm(
      `¿Restaurar el contrato ${contract?.contractCode || contract?.id}? Volverá a aparecer en la lista de contratos.`,
    );
    if (!confirmed || !beginSubmit()) return;

    setFormError('');
    try {
      await onRestoreContract?.({ id: contract.id });
      setContractFilter('all');
      setActionFeedback(
        `Contrato ${contract.contractCode} restaurado. ${
          contract?.deletionSnapshot?.version >= 2
            ? 'Se recuperaron sus jornadas, orden y montos originales.'
            : contract?.restoredFromSiblingId
              ? 'Se recuperaron sus jornadas, montos y estado desde otra copia oculta del mismo contrato.'
              : 'Por ser una eliminación antigua sin otra copia completa, revisa el contrato antes de usarlo.'
        }`,
      );
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo restaurar el contrato.');
    } finally {
      endSubmit();
      setMenuState(null);
    }
  };

  const handleToggleContractFinalized = async (contract, checked) => {
    if (!contract?.id || finalizingContractIds.has(contract.id)) return;
    const previousValue = finalizedContractOverrides.has(contract.id)
      ? finalizedContractOverrides.get(contract.id)
      : Boolean(contract.isFinalized);
    setFinalizedContractOverrides((current) => {
      const next = new Map(current);
      next.set(contract.id, checked);
      return next;
    });
    setFinalizingContractIds((current) => {
      const next = new Set(current);
      next.add(contract.id);
      return next;
    });
    setFormError('');
    try {
      const updateFinalized = onSetContractFinalized ?? onUpdateContract;
      if (!updateFinalized) throw new Error('No tienes permiso para actualizar el contrato.');
      await updateFinalized({
        id: contract.id,
        isFinalized: checked,
        finalizedAt: checked ? new Date().toISOString() : null,
      });
      setActionFeedback(
        checked
          ? `Contrato ${contract.contractCode} marcado como finalizado.`
          : `Contrato ${contract.contractCode} desmarcado como finalizado.`,
      );
    } catch (requestError) {
      setFinalizedContractOverrides((current) => {
        const next = new Map(current);
        next.set(contract.id, previousValue);
        return next;
      });
      setFormError(requestError.message || 'No se pudo actualizar el finalizado del contrato.');
    } finally {
      setFinalizingContractIds((current) => {
        const next = new Set(current);
        next.delete(contract.id);
        return next;
      });
      setMenuState(null);
    }
  };

  const handleRevertContractClick = (contract) => {
    setMenuState(null);
    setFormError('');
    setContractToRevert(contract);
  };

  const closeRevertContractDialog = () => {
    if (isSubmitting) return;
    setContractToRevert(null);
  };

  const confirmRevertContract = async () => {
    if (!contractToRevert) return;
    if (!beginSubmit()) return;
    setFormError('');
    try {
      await onRevertContractToQuote?.({ id: contractToRevert.id });
      setActionFeedback(`Contrato ${contractToRevert.contractCode} vuelto a cotizacion. Items, fecha y numero quedaron liberados.`);
      setContractToRevert(null);
      setActiveView('quotes');
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo volver el contrato a cotizacion.');
    } finally {
      endSubmit();
    }
  };

  const handleEditContractClick = async (contract) => {
    let fullContract = contract;
    setContractActionStatus(`Cargando contrato ${contract?.contractCode || contract?.id || ''} para editar...`);
    try {
      // La fila de la tabla es deliberadamente liviana y puede haber perdido la
      // marca `_summaryOnly` al combinarse con la orden. Editar siempre exige la
      // version autoritativa del servidor para no reconstruir desde un resumen.
      fullContract = await api.contracts.ensureFull(
        fullContract?.id ?? fullContract?.contractCode ?? fullContract?.orderCode,
        'edit-contract',
      );
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo cargar el contrato completo para editar.');
      setMenuState(null);
      setContractActionStatus('');
      return;
    }
    const linkedOrder = findByPriority(orderRowsWithMeta, [
      { field: 'contractId', value: fullContract?.id },
      { field: 'rentalId', value: fullContract?.rentalId },
      { field: 'contractCode', value: fullContract?.contractCode },
      { field: 'orderCode', value: fullContract?.orderCode },
    ]);
    let linkedFullRental = null;
    const linkedRentalIdentifier = fullContract?.rentalId
      ?? linkedOrder?.rentalId
      ?? fullContract?.orderCode
      ?? linkedOrder?.orderCode
      ?? '';
    if (linkedRentalIdentifier) {
      try {
        linkedFullRental = await api.rentals.getFull(linkedRentalIdentifier);
      } catch {
        linkedFullRental = null;
      }
    }

    const contractPlan = Array.isArray(fullContract?.supplierFulfillmentPlan) ? fullContract.supplierFulfillmentPlan : [];
    const linkedOrderPlan = Array.isArray(linkedFullRental?.supplierFulfillmentPlan) && linkedFullRental.supplierFulfillmentPlan.length > 0
      ? linkedFullRental.supplierFulfillmentPlan
      : Array.isArray(linkedOrder?.supplierFulfillmentPlan) ? linkedOrder.supplierFulfillmentPlan : [];

    const getLineDayKeys = (lines = []) => new Set(
      (Array.isArray(lines) ? lines : [])
        .map((line) => getDateKey(line?.serviceDate ?? line?.date)
          || String(line?.serviceDayId ?? line?.scheduleDayId ?? '').trim()
          || normalizeText(line?.serviceDayLabel ?? line?.dayLabel))
        .filter(Boolean),
    );

    const contractItems = Array.isArray(fullContract?.items) ? fullContract.items : [];
    const linkedOrderItems = Array.isArray(linkedFullRental?.items) && linkedFullRental.items.length > 0
      ? linkedFullRental.items
      : Array.isArray(linkedOrder?.items) ? linkedOrder.items : [];
    const contractServices = Array.isArray(fullContract?.services) ? fullContract.services : [];
    const linkedOrderServices = Array.isArray(linkedFullRental?.services) && linkedFullRental.services.length > 0
      ? linkedFullRental.services
      : Array.isArray(linkedOrder?.services) ? linkedOrder.services : [];
    const contractDayCount = getLineDayKeys([...contractItems, ...contractServices]).size;
    const linkedOrderDayCount = getLineDayKeys([...linkedOrderItems, ...linkedOrderServices]).size;
    const shouldRecoverDailyLines = linkedOrderDayCount > contractDayCount
      || (
        linkedOrder?.pricingPlan?.mode === 'daily_schedule'
        && fullContract?.pricingPlan?.mode === 'daily_schedule'
        && linkedOrderDayCount > 1
        && contractDayCount <= 1
      );
    const lineMoneyValue = (line) => Math.max(
      Number(line?.unitPriceBs ?? 0),
      Number(line?.rentalPriceBs ?? 0),
      Number(line?.grossLineTotalBs ?? 0),
      Number(line?.lineTotalBs ?? 0),
      0,
    );
    const lineMatchKey = (line, index) => String(line?.lineKey ?? line?.comboLineKey ?? line?.itemId ?? line?.itemName ?? index ?? '').trim();
    const linkedMoneyByKey = new Map(linkedOrderItems.map((line, index) => [lineMatchKey(line, index), line]));
    const linkedMoneyByItem = new Map(linkedOrderItems.map((line) => [String(line?.itemId ?? '').trim(), line]).filter(([key]) => key));
    const linkedMoneyByName = new Map(linkedOrderItems.map((line) => [normalizeText(line?.itemName ?? line?.name), line]).filter(([key]) => key));
    const applyLinkedMoneyToContractLines = (lines = []) => (Array.isArray(lines) ? lines : []).map((line, index) => {
      if (lineMoneyValue(line) > 0) return line;
      const fallback = linkedMoneyByKey.get(lineMatchKey(line, index))
        ?? linkedMoneyByItem.get(String(line?.itemId ?? '').trim())
        ?? linkedMoneyByName.get(normalizeText(line?.itemName ?? line?.name))
        ?? null;
      if (!fallback || lineMoneyValue(fallback) <= 0) return line;
      const quantity = Math.max(1, Math.trunc(Number(line?.quantity ?? fallback?.quantity ?? 1)));
      const fallbackUnitPriceBs = Math.max(Number(fallback.unitPriceBs ?? 0), Number(fallback.rentalPriceBs ?? 0), 0);
      const fallbackLineTotalBs = Math.max(Number(fallback.lineTotalBs ?? 0), quantity * fallbackUnitPriceBs, 0);
      return {
        ...line,
        unitPriceBs: fallbackUnitPriceBs || Number((fallbackLineTotalBs / quantity).toFixed(2)),
        grossLineTotalBs: Number(fallback.grossLineTotalBs ?? fallbackLineTotalBs),
        lineTotalBs: fallbackLineTotalBs,
      };
    });
    const contractMetadataByKey = new Map(contractItems.map((line, index) => [lineMatchKey(line, index), line]));
    const contractMetadataByItem = new Map(contractItems.map((line) => [String(line?.itemId ?? '').trim(), line]).filter(([key]) => key));
    const contractMetadataByName = new Map(contractItems.map((line) => [normalizeText(line?.itemName ?? line?.name), line]).filter(([key]) => key));
    const preserveContractLineMetadata = (lines = []) => (Array.isArray(lines) ? lines : []).map((line, index) => {
      const original = contractMetadataByKey.get(lineMatchKey(line, index))
        ?? contractMetadataByItem.get(String(line?.itemId ?? '').trim())
        ?? contractMetadataByName.get(normalizeText(line?.itemName ?? line?.name))
        ?? null;
      if (!original) return line;
      return {
        ...original,
        ...line,
        lineKey: line?.lineKey ?? original?.lineKey,
        observation: String(line?.observation ?? line?.observations ?? line?.note ?? '').trim()
          || String(original?.observation ?? original?.observations ?? original?.note ?? '').trim(),
        quickItem: line?.quickItem ?? original?.quickItem ?? null,
        comboOptionItemIds: Array.isArray(line?.comboOptionItemIds)
          ? line.comboOptionItemIds
          : Array.isArray(original?.comboOptionItemIds) ? original.comboOptionItemIds : [],
      };
    });
    const sourceItems = shouldRecoverDailyLines && linkedOrderItems.length > 0
      ? preserveContractLineMetadata(linkedOrderItems)
      : contractItems.length > 0
        ? applyLinkedMoneyToContractLines(contractItems)
        : linkedOrderItems;
    const sourceContract = {
      ...fullContract,
      items: sourceItems,
      services: shouldRecoverDailyLines && linkedOrderServices.length > 0 ? linkedOrderServices : contractServices,
      pricingPlan: shouldRecoverDailyLines && linkedOrder?.pricingPlan
        ? linkedOrder.pricingPlan
        : fullContract?.pricingPlan,
      supplierFulfillmentPlan: contractPlan.length > 0 ? contractPlan : linkedOrderPlan,
    };

    setMenuState(null);
    openCreateModal('order', 'contract', sourceContract);
    setContractActionStatus('');
  };

  const handleCancelContractClick = (contractRow) => {
    const linkedOrder = findByPriority(orderRowsWithMeta, [
      { field: 'contractId', value: contractRow?.id },
      { field: 'rentalId', value: contractRow?.rentalId },
      { field: 'contractCode', value: contractRow?.contractCode },
      { field: 'orderCode', value: contractRow?.orderCode },
    ]);

    setOrderToCancel({
      id: linkedOrder?.id ?? `contract-${contractRow.id}`,
      rentalId: linkedOrder?.rentalId ?? contractRow.rentalId ?? null,
      contractId: contractRow.id,
      orderCode: linkedOrder?.orderCode ?? contractRow.orderCode ?? contractRow.contractCode,
      contractCode: contractRow.contractCode ?? linkedOrder?.contractCode ?? null,
      client: linkedOrder?.client ?? contractRow.customerName,
      totalBs: linkedOrder?.totalBs ?? Number(contractRow?.totals?.totalBs ?? 0),
      status: linkedOrder?.status ?? (contractRow.status === 'anulado' ? 'cancelled' : 'pending'),
      cancellationPenaltyPercent: Number(
        linkedOrder?.cancellationPenaltyPercent
        ?? contractRow?.cancellationPenaltyPercent
        ?? 20,
      ),
      cancellationPenaltyBs: Number(contractRow?.cancellationPenaltyBs ?? 0),
    });
    setMenuState(null);
  };

  const handleCreateContractFromOrderClick = async (orderRow) => {
    if (!beginSubmit()) return;
    try {
      const contract = await onCreateContractFromOrder?.({ rentalId: orderRow.rentalId, orderCode: orderRow.orderCode });
      if (!contract) {
        throw new Error('No se pudo generar el contrato para esta orden.');
      }
      setActionFeedback(`Contrato ${contract.contractCode ?? contract.id} generado correctamente.`);
      setContractFilter('all');
      setContractQuery(contract.contractCode ?? orderRow.orderCode);
      setActiveView('contracts');
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo generar el contrato desde la orden.');
    } finally {
      endSubmit();
      setMenuState(null);
    }
  };

  const requestQuotePdfViewerUrl = async ({ identifier, paperSize = 'oficio' }) => {
    const requestedId = String(identifier ?? '').trim();
    if (!requestedId) {
      throw new Error('No se pudo identificar la cotizacion.');
    }

    const response = await fetch(
      getDocumentApiUrl(`/__copetin_db/quotes/${encodeURIComponent(requestedId)}/pdf-access?paper=${encodeURIComponent(paperSize)}`),
      {
        method: 'POST',
        cache: 'no-store',
        headers: {
          ...(DOCUMENT_INTERNAL_KEY ? { 'X-App-Internal-Key': DOCUMENT_INTERNAL_KEY } : {}),
        },
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || 'No se pudo preparar el visor de la cotizacion.');
    }

    const payload = await response.json();
    const relativeUrl = String(payload?.url ?? '').trim();
    if (!relativeUrl) {
      throw new Error('El servidor no devolvio una URL valida para el PDF.');
    }
    return getDocumentApiUrl(relativeUrl);
  };

  const fetchQuotePdf = async ({ identifier, paperSize = 'oficio' }) => {
    const requestedId = String(identifier ?? '').trim();
    if (!requestedId) {
      throw new Error('No se pudo identificar la cotizacion.');
    }

    const response = await fetch(
      getDocumentApiUrl(`/__copetin_db/quotes/${encodeURIComponent(requestedId)}/pdf?paper=${encodeURIComponent(paperSize)}`),
      {
        method: 'GET',
        cache: 'no-store',
        headers: {
          ...(DOCUMENT_INTERNAL_KEY ? { 'X-App-Internal-Key': DOCUMENT_INTERNAL_KEY } : {}),
        },
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || 'No se pudo obtener el PDF de la cotizacion.');
    }

    const pdfBlob = await response.blob();
    if (pdfBlob.type && pdfBlob.type !== 'application/pdf') {
      throw new Error('El servidor no devolvio un documento PDF valido.');
    }

    const viewerUrl = await requestQuotePdfViewerUrl({ identifier: requestedId, paperSize });
    return {
      blobUrl: URL.createObjectURL(pdfBlob),
      viewerUrl,
      cacheStatus: response.headers.get('X-Document-Cache') ?? '',
      durationMs: Number(response.headers.get('X-Document-Duration-Ms') ?? 0),
    };
  };

  const requestContractPdfViewerUrl = async ({ identifier, paperSize = 'oficio' }) => {
    const requestedId = String(identifier ?? '').trim();
    if (!requestedId) {
      throw new Error('No se pudo identificar el contrato.');
    }

    const response = await fetch(
      getDocumentApiUrl(`/__copetin_db/contracts/${encodeURIComponent(requestedId)}/pdf-access?paper=${encodeURIComponent(paperSize)}`),
      {
        method: 'POST',
        cache: 'no-store',
        headers: {
          ...(DOCUMENT_INTERNAL_KEY ? { 'X-App-Internal-Key': DOCUMENT_INTERNAL_KEY } : {}),
        },
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || 'No se pudo preparar el visor del contrato.');
    }

    const payload = await response.json();
    const relativeUrl = String(payload?.url ?? '').trim();
    if (!relativeUrl) {
      throw new Error('El servidor no devolvió una URL válida para el PDF.');
    }
    return getDocumentApiUrl(relativeUrl);
  };

  const fetchContractPdf = async ({ identifier, paperSize = 'oficio' }) => {
    const requestedId = String(identifier ?? '').trim();
    if (!requestedId) {
      throw new Error('No se pudo identificar el contrato.');
    }

    const response = await fetch(
      getDocumentApiUrl(`/__copetin_db/contracts/${encodeURIComponent(requestedId)}/pdf?paper=${encodeURIComponent(paperSize)}`),
      {
        method: 'GET',
        cache: 'no-store',
        headers: {
          ...(DOCUMENT_INTERNAL_KEY ? { 'X-App-Internal-Key': DOCUMENT_INTERNAL_KEY } : {}),
        },
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || 'No se pudo obtener el PDF del contrato.');
    }

    const pdfBlob = await response.blob();
    if (pdfBlob.type && pdfBlob.type !== 'application/pdf') {
      throw new Error('El servidor no devolvió un documento PDF válido.');
    }

    const viewerUrl = await requestContractPdfViewerUrl({
      identifier: requestedId,
      paperSize,
    });

    return {
      blobUrl: URL.createObjectURL(pdfBlob),
      viewerUrl,
      cacheStatus: response.headers.get('X-Document-Cache') ?? '',
      durationMs: Number(response.headers.get('X-Document-Duration-Ms') ?? 0),
    };
  };

  const fetchInventoryOrderPdf = async ({ identifier }) => {
    const requestedId = String(identifier ?? '').trim();
    if (!requestedId) {
      throw new Error('No se pudo identificar la orden de inventario.');
    }

    const response = await fetch(
      getDocumentApiUrl(`/__copetin_db/inventory-orders/${encodeURIComponent(requestedId)}/pdf`),
      {
        method: 'GET',
        cache: 'no-store',
        headers: {
          ...(DOCUMENT_INTERNAL_KEY ? { 'X-App-Internal-Key': DOCUMENT_INTERNAL_KEY } : {}),
        },
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || 'No se pudo obtener el PDF de la orden interna.');
    }

    const pdfBlob = await response.blob();
    if (pdfBlob.type && pdfBlob.type !== 'application/pdf') {
      throw new Error('El servidor no devolvio un documento PDF valido.');
    }

    return {
      blobUrl: URL.createObjectURL(pdfBlob),
      cacheStatus: response.headers.get('X-Document-Cache') ?? '',
      durationMs: Number(response.headers.get('X-Document-Duration-Ms') ?? 0),
    };
  };

  const handleOpenDocumentsPanel = (orderRow) => {
    setDocumentsOrder(orderRow);
    setMenuState(null);
  };

  const handleCloseDocumentsPanel = () => {
    setDocumentsOrder(null);
  };

  const getOrderContractLabel = (orderRow) =>
    orderRow?.contractCode || orderRow?.orderCode || orderRow?.id || 'contrato';

  const openAvailabilityContractDetail = (record) => {
    const code = String(record?.contractCode || record?.code || '').trim();
    const orderCode = String(record?.orderCode || '').trim();
    const rentalId = String(record?.rentalId || record?.id || '').trim();
    const contract = contracts.find((entry) =>
      (record?.contractId && String(entry.id) === String(record.contractId))
      || (code && String(entry.contractCode) === code)
      || (orderCode && String(entry.orderCode) === orderCode)
      || (rentalId && String(entry.rentalId) === rentalId),
    ) ?? null;
    const order = orderRowsWithMeta.find((entry) =>
      (rentalId && String(entry.rentalId) === rentalId)
      || (orderCode && String(entry.orderCode) === orderCode)
      || (code && String(entry.contractCode) === code),
    ) ?? null;
    setAvailabilityContractDetail({
      code: contract?.contractCode || order?.contractCode || code || orderCode || 'Sin numero',
      orderCode: order?.orderCode || contract?.orderCode || orderCode || '',
      customerName: contract?.customerName || order?.client || record?.customerName || 'Cliente',
      phone: contract?.customerPhone || order?.customerPhone || '',
      eventType: contract?.eventType || order?.event || 'Evento',
      deliveryDate: contract?.deliveryDate || order?.deliveryAt || record?.startDate || '',
      pickupDate: contract?.pickupDate || order?.serviceDate || record?.endDate || '',
      pickupTime: contract?.pickupWindowEnd || order?.serviceTime || record?.endTime || '',
      status: contract?.status || order?.contractStatus || order?.status || '',
      totalBs: Number(contract?.totals?.totalBs ?? order?.totalBs ?? 0),
      items: Array.isArray(contract?.items) && contract.items.length > 0 ? contract.items : order?.items ?? [],
    });
  };

  const resetContractEconomicsCollectionDraft = () => {
    setContractEconomicsCollectionDraft({
      target: 'rental',
      targets: ['rental'],
      amountBs: '',
      paymentMethod: 'efectivo',
      paymentAccount: '',
      receipt: '',
      note: '',
    });
  };

  const loadFullContractEconomicsTarget = async (contractRow, reason = 'contract-economics') => {
    let fullContract = contractRow;
    if (fullContract?._summaryOnly) {
      fullContract = await api.contracts.ensureFull(
        fullContract.id ?? fullContract.contractCode ?? fullContract.orderCode,
        reason,
      );
    }

    const linkedOrder = findByPriority(orderRowsWithMeta, [
      { field: 'contractId', value: fullContract?.id },
      { field: 'rentalId', value: fullContract?.rentalId },
      { field: 'contractCode', value: fullContract?.contractCode },
      { field: 'orderCode', value: fullContract?.orderCode },
    ]);
    const rentalIdentifier = fullContract?.rentalId
      ?? linkedOrder?.rentalId
      ?? fullContract?.orderCode
      ?? linkedOrder?.orderCode
      ?? '';
    const fullRental = rentalIdentifier
      ? await api.rentals.getFull(rentalIdentifier)
      : null;
    return { fullContract, fullRental };
  };

  const handleOpenContractEconomics = async (contractRow) => {
    setContractEconomicsError('');
    resetContractEconomicsCollectionDraft();
    setMenuState(null);
    setActiveEconomicResetLedger(null);
    setContractEconomicsTarget(contractRow);
    setContractEconomicsFullRental(null);
    setContractEconomicsContextMovements([]);
    setIsLoadingContractEconomics(true);
    try {
      const identifier = contractRow?.id ?? contractRow?.contractCode ?? contractRow?.orderCode;
      const context = await api.contracts.getEconomicContext(identifier);
      setContractEconomicsTarget(context?.contract ?? contractRow);
      setContractEconomicsFullRental(context?.rental ?? null);
      setContractEconomicsContextMovements(
        Array.isArray(context?.cashMovements) ? context.cashMovements : [],
      );
    } catch (requestError) {
      setContractEconomicsError(
        requestError.message || 'No se pudo cargar el seguimiento economico completo.',
      );
      setContractEconomicsFullRental(null);
    } finally {
      setIsLoadingContractEconomics(false);
    }
  };

  const closeContractEconomics = () => {
    setReturnChargeEditIssue(null);
    setReturnChargeEditDraft({ damagedUnitChargeBs: '', missingUnitChargeBs: '' });
    setReturnChargeEditError('');
    setActiveEconomicResetLedger(null);
    setContractEconomicsTarget(null);
    setContractEconomicsFullRental(null);
    setContractEconomicsContextMovements([]);
    setIsLoadingContractEconomics(false);
    setContractEconomicsError('');
    setIsSavingContractEconomicsCollection(false);
    setIsSavingContractEconomicsLedger(false);
    setIsResettingContractEconomics(false);
    setReceiptEditMovement(null);
    setReceiptEditError('');
    setIsSavingReceiptEdit(false);
  };

  const handleContractEconomicsBackdropClick = (event) => {
    if (event.target !== event.currentTarget) return;
    closeContractEconomics();
  };

  const handleOpenDocumentsFromContract = (contractRow) => {
    setContractActionStatus(`Abriendo centro documental ${contractRow?.contractCode || contractRow?.orderCode || ''}...`);
    const linkedOrder = orderRowsWithMeta.find(
      (row) =>
        (contractRow.rentalId && row.rentalId === contractRow.rentalId)
        || (contractRow.orderCode && row.orderCode === contractRow.orderCode),
    );
    if (linkedOrder) {
      setDocumentsOrder(linkedOrder);
      setMenuState(null);
      window.setTimeout(() => setContractActionStatus(''), 150);
      return;
    }
    setDocumentsOrder({
      id: `contract-${contractRow.id}`,
      rentalId: contractRow.rentalId ?? null,
      orderCode: contractRow.orderCode ?? contractRow.contractCode,
      contractCode: contractRow.contractCode ?? null,
      contractId: contractRow.id ?? null,
      inventoryStatus: 'no_aplica',
      transportStatus: 'no_aplica',
      documents: [],
    });
    setMenuState(null);
    window.setTimeout(() => setContractActionStatus(''), 150);
  };

  const handleEditContractFromDocuments = async () => {
    const target = selectedDocumentsContractRow ?? selectedDocumentsContract;
    if (!target) return;
    setDocumentsOrder(null);
    await handleEditContractClick(target);
  };

  const handleOpenEconomicsFromDocuments = async () => {
    const target = selectedDocumentsContractRow ?? selectedDocumentsContract;
    if (!target) return;
    setContractEconomicsError('');
    resetContractEconomicsCollectionDraft();
    setDocumentsOrder(null);
    setMenuState(null);
    setContractActionStatus(`Cargando seguimiento economico ${target?.contractCode || target?.orderCode || ''}...`);
    try {
      const { fullContract, fullRental } = await loadFullContractEconomicsTarget(target, 'contract-economics-documents');
      setContractEconomicsFullRental(fullRental);
      setContractEconomicsTarget(fullContract);
    } catch (requestError) {
      setContractEconomicsError(requestError.message || 'No se pudo cargar el seguimiento economico completo.');
      setContractEconomicsFullRental(null);
      setContractEconomicsTarget(target);
    } finally {
      setContractActionStatus('');
    }
  };

  const handleSendClosureFromDocuments = () => {
    const target = selectedDocumentsContractRow ?? selectedDocumentsContract;
    if (!target) return;
    const summary = selectedDocumentsClosureSummary;
    setDocumentsOrder(null);
    openWhatsAppModal('contract', {
      ...target,
      customerName: target.customerName || selectedDocumentsClosureSummary?.contract?.customerName,
      customerPhone: target.customerPhone || selectedDocumentsClosureSummary?.contract?.customerPhone,
    });
    updateWhatsAppModal({
      message: [
        `Hola ${target.customerName || 'cliente'}, te escribo de El Copetin por el contrato ${target.contractCode || target.orderCode || ''}.`,
        `Estado: ${summary?.finalLabel || 'en revision'}.`,
        `Entrega: ${summary?.isSent ? 'concluida' : 'pendiente'} | Devolucion: ${summary?.isReturned ? 'concluida' : 'pendiente'}.`,
        `Saldo: ${summary?.dueBs > 0 ? formatBs(summary.dueBs) : 'pagado'} | Garantia: ${summary?.guaranteeStatusLabel || 'sin novedad'}.`,
        summary?.hasDamages ? 'Hay novedades registradas por danos/faltantes para revisar.' : 'Sin danos/faltantes registrados.',
        summary?.receiptCodes?.length ? `Recibos: ${summary.receiptCodes.slice(0, 4).join(', ')}.` : 'Sin recibos pendientes por informar.',
      ].filter(Boolean).join('\n'),
    });
  };

  const openCashReceiptWindow = () => {
    const printWindow = window.open('', '_blank', 'width=1120,height=760');
    if (!printWindow) {
      throw new Error('Chrome bloqueo la ventana del recibo. Habilita ventanas emergentes para este sitio.');
    }
    printWindow.document.open();
    printWindow.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Generando recibo</title></head><body style="font-family:Arial,sans-serif;padding:24px;color:#111827;"><strong>Generando recibo...</strong></body></html>');
    printWindow.document.close();
    printWindow.focus();
    return printWindow;
  };

  const handlePrintEconomicReceipt = async (movement, providedWindow = null) => {
    if (!movement?.id) return;
    let printWindow = providedWindow;
    try {
      setContractEconomicsError('');
      printWindow = printWindow || openCashReceiptWindow();
      const printedByName = String(currentUser?.fullName ?? currentUser?.name ?? currentUser?.username ?? currentUser?.email ?? 'Sistema').trim() || 'Sistema';
      const receiptPayload = { movementId: movement.id, movement, printedByName };
      let result = onPrintCashMovementReceipt
        ? await onPrintCashMovementReceipt(receiptPayload)
        : null;
      if (!result?.html) {
        result = await api.printer.printCashMovementReceipt(receiptPayload);
      }
      if (!result?.html) throw new Error('No se pudo generar el contenido del recibo.');
      printWindow.document.open();
      printWindow.document.write(result.html);
      printWindow.document.close();
      printWindow.focus();
    } catch (error) {
      if (printWindow && !printWindow.closed) printWindow.close();
      setContractEconomicsError(error.message || 'No se pudo abrir el recibo.');
    }
  };

  const openReceiptEditor = (movement) => {
    if (!movement?.id || isVoidedCashMovement(movement)) return;
    const customerName = String(
      movement?.receiptCustomerName
      ?? movement?.customerName
      ?? contractEconomicsData?.contract?.customerName
      ?? contractEconomicsData?.rental?.customerName
      ?? '',
    ).trim();
    setReceiptEditMovement(movement);
    setReceiptEditDraft({
      receiptCode: String(movement?.receiptCode ?? movement?.receipt ?? '').trim(),
      receiptCustomerName: customerName,
      createdAt: getInputDateTime(movement?.receiptIssuedAt ?? movement?.createdAt),
      receiptDetail: String(movement?.receiptDetail ?? movement?.description ?? movement?.notes ?? '').trim(),
      notes: String(movement?.notes ?? '').trim(),
      paymentMethod: normalizeLedgerPaymentMethod(movement?.paymentMethod),
      paymentAccount: normalizeLedgerPaymentAccount(movement?.paymentAccount),
    });
    setReceiptEditError('');
  };

  const closeReceiptEditor = () => {
    if (isSavingReceiptEdit) return;
    setReceiptEditMovement(null);
    setReceiptEditError('');
  };

  const handleSubmitReceiptEdit = async (event) => {
    event.preventDefault();
    if (!receiptEditMovement?.id || isSavingReceiptEdit) return;
    const receiptCode = receiptEditDraft.receiptCode.trim();
    const receiptCustomerName = receiptEditDraft.receiptCustomerName.trim();
    const receiptDetail = receiptEditDraft.receiptDetail.trim();
    if (!receiptCode || !receiptCustomerName || !receiptDetail || !receiptEditDraft.createdAt) {
      setReceiptEditError('Completa numero de recibo, cliente, fecha y detalle.');
      return;
    }
    if (receiptEditDraft.paymentMethod === 'qr' && !receiptEditDraft.paymentAccount) {
      setReceiptEditError('Selecciona la cuenta o banco para el pago QR.');
      return;
    }

    setIsSavingReceiptEdit(true);
    setReceiptEditError('');
    try {
      const editedByName = String(currentUser?.fullName ?? currentUser?.name ?? currentUser?.username ?? currentUser?.email ?? 'Sistema').trim() || 'Sistema';
      const result = await api.cash.updateMovementReceipt({
        movementId: receiptEditMovement.id,
        receiptCode,
        receiptCustomerName,
        receiptIssuedAt: new Date(receiptEditDraft.createdAt).toISOString(),
        receiptDetail,
        notes: receiptEditDraft.notes.trim(),
        paymentMethod: receiptEditDraft.paymentMethod,
        paymentAccount: receiptEditDraft.paymentMethod === 'qr' ? receiptEditDraft.paymentAccount : '',
        editedByName,
      });
      rememberEconomicCashResult(result);
      if (result?.movement?.id) {
        setContractEconomicsContextMovements((current) => current.map((movement) => (
          String(movement?.id ?? '') === String(result.movement.id) ? result.movement : movement
        )));
      }
      if (result?.contract?.id) {
        const updatedLedger = Array.isArray(result.contract.economicLedger)
          ? result.contract.economicLedger
          : null;
        if (updatedLedger) {
          const updatedLedgerKey = String(
            result.contract.id
            ?? result.contract.contractCode
            ?? '',
          ).trim();
          setActiveEconomicResetLedger(updatedLedger);
          if (updatedLedgerKey) {
            setEconomicResetLedgerByContract((current) => ({
              ...current,
              [updatedLedgerKey]: updatedLedger,
            }));
          }
        }
        setContractEconomicsTarget((current) => (
          current && String(current?.id ?? '') === String(result.contract.id)
            ? { ...current, ...result.contract }
            : current
        ));
      }
      setActionFeedback(`Recibo ${receiptCode} actualizado sin modificar el monto del movimiento.`);
      setReceiptEditMovement(null);
    } catch (error) {
      setReceiptEditError(error.message || 'No se pudo actualizar el recibo.');
    } finally {
      setIsSavingReceiptEdit(false);
    }
  };

  const rememberEconomicCashResult = (result) => {
    const movements = [
      ...(Array.isArray(result?.movements) ? result.movements : []),
      result?.movement,
      result?.replacement,
      result?.id ? result : null,
    ].filter((movement) => movement?.id);
    if (!movements.length) return;
    setRecentEconomicCashMovements((current) => {
      const byId = new Map(current.map((movement) => [String(movement.id), movement]));
      movements.forEach((movement) => byId.set(String(movement.id), movement));
      return [...byId.values()];
    });
  };

  const resolveEconomicMovementId = (result) => {
    if (!result) return '';
    if (result.id) return result.id;
    if (result.movement?.id) return result.movement.id;
    const rows = Array.isArray(result.movements) ? result.movements : [];
    return rows[0]?.id ?? '';
  };

  const buildEconomicCollectionReceiptDetail = (breakdown) => {
    if (!contractEconomicsData) return '';
    const contractCode = contractEconomicsData.contract?.contractCode || contractEconomicsData.contract?.id || '';
    const customerName = contractEconomicsData.contract?.customerName || contractEconomicsData.rental?.customerName || 'cliente';
    const lines = [`Contrato ${contractCode} - ${customerName}`];
    breakdown.forEach((entry) => {
      if (entry.target === 'rental') {
        const itemCount = Array.isArray(contractEconomicsData.contract?.items)
          ? contractEconomicsData.contract.items.length
          : Array.isArray(contractEconomicsData.rental?.items)
            ? contractEconomicsData.rental.items.length
            : 0;
        lines.push(`Items / alquiler: ${formatBs(entry.amountBs)}${itemCount ? ` (${itemCount} linea${itemCount === 1 ? '' : 's'} del contrato)` : ''}`);
      } else if (entry.target === 'transport') {
        const logistics = contractEconomicsData.contract?.deliveryMode
          || contractEconomicsData.rental?.deliveryMode
          || contractEconomicsData.contract?.logisticsMode
          || contractEconomicsData.rental?.logisticsMode
          || 'servicio logistico del contrato';
        lines.push(`Transporte: ${formatBs(entry.amountBs)} - ${logistics}`);
      } else if (entry.target === 'damage') {
        const issueLines = (contractEconomicsData.returnIssues ?? [])
          .filter((issue) => toMoneyNumber(issue.penaltyBs) > 0 || toMoneyNumber(issue.damagedQty) > 0 || toMoneyNumber(issue.missingQty) > 0)
          .map((issue) => {
            const parts = [];
            if (toMoneyNumber(issue.damagedQty) > 0) parts.push(`${issue.damagedQty} danado`);
            if (toMoneyNumber(issue.missingQty) > 0) parts.push(`${issue.missingQty} faltante`);
            return `${issue.itemName}: ${parts.join(', ') || 'cargo'} (${formatBs(issue.penaltyBs)})`;
          });
        lines.push(`Danos / faltantes: ${formatBs(entry.amountBs)}`);
        lines.push(...(issueLines.length ? issueLines : ['Cargos registrados en la devolucion del contrato.']));
      }
    });
    return lines.join('\n');
  };

  const handleSubmitContractEconomicCollection = async (event) => {
    event.preventDefault();
    if (!contractEconomicsData || isSavingContractEconomicsCollection) return;
    const rentalId = contractEconomicsData.rental?.id ?? contractEconomicsData.contract?.rentalId ?? '';
    const collectionTargets = selectedContractEconomicsCollectionTargets;
    const collectionTarget = collectionTargets.length === 1 ? collectionTargets[0] : 'mixed';
    const targetPending = contractEconomicsData.collectionTargetPending ?? {};
    const suggestedByTarget = {
      rental: toMoneyNumber(targetPending.rentalBs),
      transport: toMoneyNumber(targetPending.transportBs),
      damage: toMoneyNumber(targetPending.damageBs),
      balance: toMoneyNumber(contractEconomicsData.cashCollectionSuggestedBs),
    };
    const selectedBreakdown = collectionTargets
      .map((target) => {
        const meta = ECONOMIC_COLLECTION_TARGETS[target] ?? ECONOMIC_COLLECTION_TARGETS.rental;
        const amount = Math.max(0, suggestedByTarget[target] ?? 0);
        return {
          target,
          amountBs: amount,
          label: meta.label,
          category: meta.category,
          accountingTag: meta.tag,
        };
      })
      .filter((entry) => entry.amountBs > 0);
    const suggestedBs = Math.max(0, Number(selectedBreakdown.reduce((sum, entry) => sum + entry.amountBs, 0).toFixed(2)));
    const targetMeta = collectionTargets.length === 1
      ? ECONOMIC_COLLECTION_TARGETS[collectionTargets[0]] ?? ECONOMIC_COLLECTION_TARGETS.rental
      : {
        label: selectedBreakdown.map((entry) => entry.label).join(' + ') || 'seleccion',
        shortLabel: 'seleccion',
        tag: 'contract_mixed_collection',
        category: 'cobro_mixto_contrato',
      };
    const amountBs = Math.max(0, toMoneyNumber(contractEconomicsCollectionDraft.amountBs || suggestedBs));
    if (suggestedBs <= 0) {
      setContractEconomicsError(`Este contrato ya no tiene saldo pendiente para ${targetMeta.label.toLowerCase()}.`);
      return;
    }
    if (amountBs <= 0) {
      setContractEconomicsError('El monto a cobrar debe ser mayor a 0.');
      return;
    }
    if (amountBs - suggestedBs > 0.01) {
      setContractEconomicsError(`El saldo pendiente para ${targetMeta.label.toLowerCase()} es Bs ${suggestedBs.toFixed(2)}. No se puede registrar un cobro mayor.`);
      return;
    }
    const collectionBreakdown = selectedBreakdown.map((entry) => ({ ...entry }));
    if (Math.abs(amountBs - suggestedBs) > 0.01 && collectionBreakdown.length) {
      let remainingAmount = amountBs;
      collectionBreakdown.forEach((entry, index) => {
        const nextAmount = index === collectionBreakdown.length - 1
          ? remainingAmount
          : Math.min(entry.amountBs, remainingAmount);
        entry.amountBs = Math.max(0, Number(nextAmount.toFixed(2)));
        remainingAmount = Math.max(0, Number((remainingAmount - entry.amountBs).toFixed(2)));
      });
    }
    const receiptDetail = buildEconomicCollectionReceiptDetail(collectionBreakdown);
    const paymentMethod = normalizeLedgerPaymentMethod(contractEconomicsCollectionDraft.paymentMethod);
    const paymentAccount = paymentMethod === 'qr'
      ? normalizeLedgerPaymentAccount(contractEconomicsCollectionDraft.paymentAccount)
      : '';
    if (paymentMethod === 'qr' && !paymentAccount) {
      setContractEconomicsError('Selecciona la cuenta o banco QR para registrar el cobro.');
      return;
    }
    setIsSavingContractEconomicsCollection(true);
    setContractEconomicsError('');
    try {
      const createdBy = String(currentUser?.fullName ?? currentUser?.name ?? currentUser?.username ?? currentUser?.email ?? 'Sistema').trim() || 'Sistema';
      const defaultNote = contractEconomicsCollectionDraft.note
        || contractEconomicsCollectionDraft.receipt
        || `Cobro ${targetMeta.label.toLowerCase()} contrato ${contractEconomicsData.contract?.contractCode || ''}`;
      const commonPayload = {
        amountBs,
        paymentMethod,
        paymentAccount,
        receipt: contractEconomicsCollectionDraft.receipt,
        note: defaultNote,
        collectionTarget,
        collectionTargets,
        collectionBreakdown,
        receiptDetail,
        linkedContractId: contractEconomicsData.contract?.id ?? '',
        linkedOrderCode: contractEconomicsData.contract?.orderCode ?? contractEconomicsData.linkedOrder?.orderCode ?? '',
        accountingTag: targetMeta.tag,
        category: targetMeta.category,
        createdBy,
      };
      const result = rentalId ? await api.cash.collectReceivable({
        ...commonPayload,
        rentalId,
      }) : await api.cash.createManualMovement({
        ...commonPayload,
        type: 'ingreso',
        cashBoxType: 'BIG_CASH',
        description: `Cobro ${targetMeta.label.toLowerCase()} contrato ${contractEconomicsData.contract?.contractCode || ''}: ${contractEconomicsData.contract?.customerName || 'cliente'}`,
        category: targetMeta.category,
        responsible: createdBy,
        notes: defaultNote,
        linkedRentalId: rentalId,
      });
      rememberEconomicCashResult(result);
      const movementId = resolveEconomicMovementId(result);
      const movement = result?.movement ?? result ?? {};
      const receiptCode = String(movement?.receiptCode ?? movement?.receipt ?? contractEconomicsCollectionDraft.receipt ?? '').trim();

      // La micro-ruta de cobro devuelve inmediatamente el alquiler y el movimiento
      // actualizados. Los aplicamos al modal y al resumen de la tabla sin esperar
      // una recarga general ni volver a registrar el ingreso.
      if (result?.rental?.id) {
        setContractEconomicsFullRental(result.rental);
      }
      const pendingAfterCollectionBs = result?.rental
        ? toMoneyNumber(
          result.rental?.returnSettlement?.pendingCollectionBs
          ?? result.rental?.payment?.pendingPaymentBs
          ?? result.rental?.totals?.pendingPaymentBs,
        )
        : Math.max(0, Number((contractEconomicsData.managedDebtBs - amountBs).toFixed(2)));
      const pendingOverrideKey = String(
        contractEconomicsData.contract?.id
        ?? contractEconomicsData.contract?.contractCode
        ?? '',
      ).trim();
      if (pendingOverrideKey) {
        setEconomicResetPendingByContract((current) => ({
          ...current,
          [pendingOverrideKey]: pendingAfterCollectionBs,
        }));
      }

      // El recibo de Caja y la Hoja Flexible son dos respaldos del mismo cobro.
      // Se agrega una única línea vinculada al movimiento ya creado; no se genera
      // un segundo movimiento de caja.
      const commercialCollectionBs = Number(collectionBreakdown
        .filter((entry) => ['rental', 'transport', 'balance'].includes(entry.target))
        .reduce((sum, entry) => sum + toMoneyNumber(entry.amountBs), 0)
        .toFixed(2));
      const damageCollectionBs = Number(collectionBreakdown
        .filter((entry) => entry.target === 'damage')
        .reduce((sum, entry) => sum + toMoneyNumber(entry.amountBs), 0)
        .toFixed(2));
      if ((commercialCollectionBs > 0 || damageCollectionBs > 0) && movementId) {
        const currentLedger = contractEconomicsData.economicLedger ?? [];
        const alreadyLinked = currentLedger.some(
          (entry) => String(entry?.cashMovementId ?? '') === String(movementId),
        );
        if (!alreadyLinked) {
          const createdAt = movement?.createdAt ?? new Date().toISOString();
          const linkedEntries = [];
          if (commercialCollectionBs > 0) {
            linkedEntries.push({
              id: `eco-cash-${movementId}`,
              type: 'deposit',
              amountBs: commercialCollectionBs,
              paymentMethod,
              paymentAccount,
              note: defaultNote,
              createdAt,
              createdByName: createdBy,
              cashMovementId: movementId,
              cashReceiptCode: receiptCode,
              isCashRegistered: true,
            });
          }
          if (damageCollectionBs > 0) {
            linkedEntries.push({
              id: `eco-damage-cash-${movementId}`,
              type: 'charge',
              amountBs: damageCollectionBs,
              paymentMethod,
              paymentAccount,
              note: defaultNote || `Cobro de daños/faltantes del contrato ${contractEconomicsData.contract?.contractCode || ''}.`,
              createdAt,
              createdByName: createdBy,
              cashMovementId: movementId,
              cashReceiptCode: receiptCode,
              isCashRegistered: true,
              cashCollectionTarget: 'damage',
            });
          }
          await saveContractEconomicLedgerRows(
            [...currentLedger, ...linkedEntries],
            '',
            { force: true },
          );
        }
      }

      if (movementId) {
        void handlePrintEconomicReceipt({ ...movement, id: movementId }).catch((printError) => {
          console.error('[economic-receipt] No se pudo abrir el recibo automaticamente', printError);
          setActionFeedback('El cobro fue guardado correctamente, pero el recibo no pudo abrirse automaticamente. Puedes abrirlo desde Ver documentos.');
        });
      }
      setActionFeedback(`Cobro registrado en Caja Grande para contrato ${contractEconomicsData.contract?.contractCode || contractEconomicsData.contract?.id}${receiptCode ? ` con recibo ${receiptCode}` : ''}.`);
      setContractEconomicsCollectionDraft({
        target: 'rental',
        targets: ['rental'],
        amountBs: '',
        paymentMethod: 'efectivo',
        paymentAccount: '',
        receipt: '',
        note: '',
      });
    } catch (error) {
      setContractEconomicsError(error.message || 'No se pudo registrar el cobro del contrato.');
    } finally {
      setIsSavingContractEconomicsCollection(false);
    }
  };

  const saveContractEconomicLedgerRows = async (nextLedger, successMessage, options = {}) => {
    if (!contractEconomicsData || (isSavingContractEconomicsLedger && !options.force)) return null;

    setContractEconomicsError('');
    setIsSavingContractEconomicsLedger(true);

    try {
      const currentLedger = (contractEconomicsData.economicLedger ?? [])
        .map(normalizeEconomicLedgerEntry)
        .filter((entry) => !entry.deletedAt);
      const normalizedNextLedger = (Array.isArray(nextLedger) ? nextLedger : [])
        .map(normalizeEconomicLedgerEntry)
        .filter((entry) => !entry.deletedAt);
      const currentById = new Map(currentLedger.map((entry) => [String(entry.id), entry]));
      const nextById = new Map(normalizedNextLedger.map((entry) => [String(entry.id), entry]));
      const mutations = [];

      normalizedNextLedger.forEach((entry) => {
        const currentEntry = currentById.get(String(entry.id));
        if (!currentEntry || JSON.stringify(currentEntry) !== JSON.stringify(entry)) {
          mutations.push({ type: 'upsert', entry });
        }
      });
      currentLedger.forEach((entry) => {
        if (!nextById.has(String(entry.id))) {
          mutations.push({
            type: 'void',
            entryId: entry.id,
            reason: options.deletionReason || 'Linea anulada desde el cuaderno economico.',
          });
        }
      });

      if (!mutations.length) {
        return contractEconomicsData.contract;
      }

      const payload = {
        id: contractEconomicsData.contract.id,
        contractId: contractEconomicsData.contract.id,
        contractCode: contractEconomicsData.contract.contractCode,
        mutations,
      };

      console.info('[economic-ledger] Enviando mutacion atomica', {
        contractId: payload.contractId,
        mutationCount: mutations.length,
        mutationTypes: mutations.map((mutation) => mutation.type),
      });

      const updated = onUpdateEconomicLedger
        ? await onUpdateEconomicLedger(payload)
        : await api.contracts.updateEconomicLedger(payload);

      if (!updated) {
        throw new Error('El servidor respondio sin devolver el contrato actualizado.');
      }

      const updatedLedger = Array.isArray(updated?.economicLedger)
        ? updated.economicLedger
        : normalizedNextLedger;
      const updatedLedgerKey = String(
        updated?.id
        ?? updated?.contractCode
        ?? contractEconomicsData.contract?.id
        ?? contractEconomicsData.contract?.contractCode
        ?? '',
      ).trim();

      // Si el contrato fue reseteado, el modal puede conservar temporalmente un
      // override del ledger. Debe reemplazarse con la respuesta autoritativa del
      // servidor; de lo contrario la nueva linea queda oculta hasta recargar.
      setActiveEconomicResetLedger(updatedLedger);
      if (updatedLedgerKey) {
        setEconomicResetLedgerByContract((current) => ({
          ...current,
          [updatedLedgerKey]: updatedLedger,
        }));
      }
      setContractEconomicsTarget(updated);
      setActionFeedback(
        successMessage
        || `Seguimiento economico actualizado para contrato ${
          contractEconomicsData.contract?.contractCode
          || contractEconomicsData.contract?.id
        }.`,
      );
      return updated;
    } catch (error) {
      console.error('[economic-ledger] Error al guardar', error);
      setContractEconomicsError(
        error.message
        || 'No se pudo guardar el seguimiento economico del contrato.',
      );
      return null;
    } finally {
      setIsSavingContractEconomicsLedger(false);
    }
  };


  const openReturnChargeEditor = (issue) => {
    if (!issue || contractEconomicsData?.damagesSettled || readOnly) return;
    setReturnChargeEditIssue(issue);
    setReturnChargeEditDraft({
      damagedUnitChargeBs: issue.damagedQty > 0 ? String(issue.damagedUnitChargeBs ?? 0) : '',
      missingUnitChargeBs: issue.missingQty > 0 ? String(issue.missingUnitChargeBs ?? 0) : '',
    });
    setReturnChargeEditError('');
  };

  const closeReturnChargeEditor = () => {
    if (isSavingReturnCharge) return;
    setReturnChargeEditIssue(null);
    setReturnChargeEditDraft({ damagedUnitChargeBs: '', missingUnitChargeBs: '' });
    setReturnChargeEditError('');
  };

  const handleSaveReturnCharge = async () => {
    if (!returnChargeEditIssue || !contractEconomicsData?.rental || isSavingReturnCharge) return;

    const damagedUnitChargeBs = returnChargeEditIssue.damagedQty > 0
      ? Number(returnChargeEditDraft.damagedUnitChargeBs)
      : undefined;
    const missingUnitChargeBs = returnChargeEditIssue.missingQty > 0
      ? Number(returnChargeEditDraft.missingUnitChargeBs)
      : undefined;

    if (
      (returnChargeEditIssue.damagedQty > 0 && (!Number.isFinite(damagedUnitChargeBs) || damagedUnitChargeBs < 0))
      || (returnChargeEditIssue.missingQty > 0 && (!Number.isFinite(missingUnitChargeBs) || missingUnitChargeBs < 0))
    ) {
      setReturnChargeEditError('Ingresa un precio válido igual o mayor a Bs 0,00.');
      return;
    }

    setIsSavingReturnCharge(true);
    setReturnChargeEditError('');
    try {
      const userName = String(
        currentUser?.fullName
        ?? currentUser?.name
        ?? currentUser?.username
        ?? currentUser?.email
        ?? 'Sistema',
      ).trim() || 'Sistema';

      const result = await api.rentals.updateReturnCharge({
        rentalId: contractEconomicsData.rental.id,
        lineKey: returnChargeEditIssue.lineKey,
        itemId: returnChargeEditIssue.itemId,
        reportIndex: returnChargeEditIssue.reportIndex,
        ...(returnChargeEditIssue.damagedQty > 0 ? { damagedUnitChargeBs } : {}),
        ...(returnChargeEditIssue.missingQty > 0 ? { missingUnitChargeBs } : {}),
        updatedById: currentUser?.id ?? null,
        updatedByName: userName,
      });

      if (result?.rental) {
        setContractEconomicsFullRental(result.rental);
      }

      // Se recarga únicamente el contexto económico pequeño para reflejar
      // movimientos informativos y saldos derivados del servidor.
      const identifier = contractEconomicsData.contract?.id
        ?? contractEconomicsData.contract?.contractCode
        ?? contractEconomicsData.contract?.orderCode;
      if (identifier) {
        const context = await api.contracts.getEconomicContext(identifier);
        setContractEconomicsTarget(context?.contract ?? contractEconomicsData.contract);
        setContractEconomicsFullRental(context?.rental ?? result?.rental ?? contractEconomicsData.rental);
        setContractEconomicsContextMovements(
          Array.isArray(context?.cashMovements) ? context.cashMovements : [],
        );
      }

      setActionFeedback(`Cargo de ${returnChargeEditIssue.itemName} actualizado.`);
      closeReturnChargeEditor();
    } catch (error) {
      setReturnChargeEditError(error?.message || 'No se pudo actualizar el cargo.');
    } finally {
      setIsSavingReturnCharge(false);
    }
  };

  const handleResetContractEconomics = async () => {
    if (!contractEconomicsData || readOnly || isResettingContractEconomics) return;
    const contractCode = contractEconomicsData.contract?.contractCode
      || contractEconomicsData.contract?.id
      || '';
    const confirmation = window.prompt(
      [
        `RESET ECONOMICO DEL CONTRATO ${contractCode}`,
        '',
        'Se eliminaran solamente recibos, cobros, devoluciones de garantia, deudas y lineas de la Hoja Flexible.',
        'Se conservaran Listo, Enviado, Devuelto, inventario, transporte, daños/faltantes y Lavado/Reparacion.',
        '',
        'Escribe RESET para continuar.',
      ].join('\n'),
      '',
    );
    if (String(confirmation ?? '').trim().toUpperCase() !== 'RESET') return;

    setContractEconomicsError('');
    setIsResettingContractEconomics(true);
    try {
      const userName = String(
        currentUser?.fullName
        ?? currentUser?.name
        ?? currentUser?.username
        ?? currentUser?.email
        ?? 'Sistema',
      ).trim() || 'Sistema';
      const result = await api.contracts.resetEconomics({
        id: contractEconomicsData.contract?.id ?? contractCode,
        confirmation: 'RESET',
        updatedById: currentUser?.id ?? null,
        updatedByName: userName,
        updatedByRole: currentUser ? getUserDisplayRole(currentUser) : 'Sistema',
      });

      const returnedResetLedger = Array.isArray(result?.contract?.economicLedger)
        ? result.contract.economicLedger
        : [];
      const resetLedger = returnedResetLedger.filter((entry) => {
        const note = normalizeText(entry?.note);
        return note.includes('reset economico') && note.includes('conservad');
      });
      const effectiveResetLedger = resetLedger.length > 0 ? resetLedger : returnedResetLedger;
      const resetContract = result?.contract
        ? { ...result.contract, economicLedger: effectiveResetLedger }
        : { ...contractEconomicsData.contract, economicLedger: effectiveResetLedger };
      setActiveEconomicResetLedger(effectiveResetLedger);
      setContractEconomicsTarget(resetContract);
      setContractEconomicsFullRental(result?.rental ?? null);
      setContractEconomicsContextMovements(
        Array.isArray(result?.cashMovements) ? result.cashMovements : [],
      );
      setRecentEconomicCashMovements([]);
      resetContractEconomicsCollectionDraft();
      resetContractEconomicLedgerForm();

      const overrideKey = String(
        result?.contract?.id
        ?? result?.contract?.contractCode
        ?? contractEconomicsData.contract?.id
        ?? contractCode,
      ).trim();
      if (overrideKey) {
        setEconomicResetPendingByContract((current) => ({
          ...current,
          [overrideKey]: toMoneyNumber(result?.resetSummary?.pendingCollectionBs),
        }));
        setEconomicResetLedgerByContract((current) => ({
          ...current,
          [overrideKey]: effectiveResetLedger,
        }));
      }

      setActionFeedback(
        `Reset economico completado. Se conservaron pago inicial ${formatBs(result?.resetSummary?.initialPaymentBs ?? 0)} y garantia ${formatBs(result?.resetSummary?.guaranteePaidBs ?? 0)}.`,
      );
    } catch (error) {
      setContractEconomicsError(
        error.message || 'No se pudo ejecutar el Reset economico.',
      );
    } finally {
      setIsResettingContractEconomics(false);
    }
  };

  const resetContractEconomicLedgerForm = () => {
    setContractEconomicsLedgerEditingId(null);
    setContractEconomicsLedgerDraft({
      date: getInputDate(new Date()),
      paymentMethod: 'efectivo',
      paymentAccount: '',
    });

    if (contractEconomicsLedgerTypeRef.current) {
      contractEconomicsLedgerTypeRef.current.value = 'deposit';
    }

    if (contractEconomicsLedgerAmountRef.current) {
      contractEconomicsLedgerAmountRef.current.value = '';
    }

    if (contractEconomicsLedgerNoteRef.current) {
      contractEconomicsLedgerNoteRef.current.value = '';
    }
  };

  const handleSubmitContractEconomicLedger = async (event) => {
    event.preventDefault();

    if (!contractEconomicsData || isSavingContractEconomicsLedger) return;

    const selectedType = String(
      contractEconomicsLedgerTypeRef.current?.value ?? 'deposit',
    ).trim();

    const type = ECONOMIC_LEDGER_TYPE_META[selectedType]
      ? selectedType
      : 'note';

    const amountBs = type === 'note'
      ? 0
      : Math.max(
          0,
          toMoneyNumber(
            contractEconomicsLedgerAmountRef.current?.value ?? '',
          ),
        );

    const note = String(
      contractEconomicsLedgerNoteRef.current?.value ?? '',
    ).trim();
    const selectedDate = getDateKey(contractEconomicsLedgerDraft.date) || getInputDate(new Date());
    const editingEntry = contractEconomicsLedgerEditingId
      ? (contractEconomicsData.economicLedger ?? []).find((row) => row.id === contractEconomicsLedgerEditingId)
      : null;
    const createdAt = buildDateTimeFromDateKey(selectedDate, editingEntry?.createdAt);

    const paymentMethod = type === 'note'
      ? ''
      : normalizeLedgerPaymentMethod(contractEconomicsLedgerDraft.paymentMethod);
    const paymentAccount = paymentMethod === 'qr'
      ? normalizeLedgerPaymentAccount(contractEconomicsLedgerDraft.paymentAccount)
      : '';

    if (type !== 'note' && amountBs <= 0) {
      setContractEconomicsError(
        'El monto debe ser mayor a 0 para guardar esta linea.',
      );
      return;
    }

    if (!note) {
      setContractEconomicsError(
        'Escribe un detalle para que el historial sea entendible despues.',
      );
      return;
    }

    if (paymentMethod === 'qr' && !paymentAccount) {
      setContractEconomicsError(
        'Selecciona la cuenta o banco QR para guardar esta linea.',
      );
      return;
    }

    const createdByName = String(
      currentUser?.fullName
        ?? currentUser?.name
        ?? currentUser?.username
        ?? currentUser?.email
        ?? 'Sistema',
    ).trim() || 'Sistema';

    const entry = {
      id: `eco-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      amountBs,
      paymentMethod,
      paymentAccount,
      note,
      createdAt,
      createdByName,
    };

    const currentLedger = contractEconomicsData.economicLedger ?? [];
    const nextLedger = contractEconomicsLedgerEditingId
      ? currentLedger.map((row) =>
        row.id === contractEconomicsLedgerEditingId
          ? {
            ...row,
            type,
            amountBs,
            paymentMethod,
            paymentAccount,
            note,
            createdAt,
            createdByName: row.createdByName || createdByName,
            editedAt: new Date().toISOString(),
            editedByName: createdByName,
          }
          : row
      )
      : [
        ...currentLedger,
        entry,
      ];

    const updated = await saveContractEconomicLedgerRows(nextLedger);
    if (updated) resetContractEconomicLedgerForm();
  };

  const handleDepositReceipt = async (entry) => {
    if (!contractEconomicsData || entry?.type !== 'deposit' || generatingDepositReceiptId) return;

    const linkedMovementId = String(entry?.cashMovementId ?? '').trim();
    if (linkedMovementId) {
      const linkedMovement = (contractEconomicsData.movements ?? []).find(
        (movement) => String(movement?.id ?? '') === linkedMovementId,
      );
      if (linkedMovement) {
        await handlePrintEconomicReceipt(linkedMovement);
      } else {
        setContractEconomicsError('El recibo existe, pero no se pudo cargar su movimiento. Cierra y vuelve a abrir el sector economico.');
      }
      return;
    }

    const allocations = getEconomicDepositAllocations(
      contractEconomicsData.economicLedger,
      contractEconomicsData.ledgerChargeTargetBs,
    );
    const allocation = allocations.get(entry.id);
    if (!allocation || allocation.receivedBs <= 0) {
      setContractEconomicsError('No se pudo calcular el desglose de este deposito.');
      return;
    }

    const createdBy = String(
      currentUser?.fullName
      ?? currentUser?.name
      ?? currentUser?.username
      ?? currentUser?.email
      ?? 'Sistema',
    ).trim() || 'Sistema';
    const contractCode = contractEconomicsData.contract?.contractCode || contractEconomicsData.contract?.id || '';
    const customerName = contractEconomicsData.contract?.customerName || 'Cliente';
    const receiptDetail = [
      `ABONO RECIBIDO PARA CONTRATO ${contractCode}`,
      `Total recibido: ${formatBs(allocation.receivedBs)}`,
      `Aplicado al contrato: ${formatBs(allocation.contractBs)}`,
      allocation.guaranteeBs > 0 ? `Apartado como garantia: ${formatBs(allocation.guaranteeBs)}` : '',
      allocation.surplusBs > 0 ? `Excedente del cliente: ${formatBs(allocation.surplusBs)}` : '',
      entry.note ? `Detalle: ${entry.note}` : '',
    ].filter(Boolean).join('\n');
    const rentalId = contractEconomicsData.rental?.id ?? contractEconomicsData.contract?.rentalId ?? '';
    const commonPayload = {
      receivedAmountBs: allocation.receivedBs,
      guaranteeAllocationBs: allocation.guaranteeBs,
      surplusAllocationBs: allocation.surplusBs,
      paymentMethod: entry.paymentMethod || 'efectivo',
      paymentAccount: entry.paymentMethod === 'qr' ? entry.paymentAccount || '' : '',
      receiptDetail,
      receiptCustomerName: customerName,
      customerName,
      note: entry.note || `Abono contrato ${contractCode}`,
      notes: entry.note || `Abono contrato ${contractCode}`,
      linkedRentalId: rentalId,
      linkedContractId: contractEconomicsData.contract?.id ?? '',
      linkedOrderCode: contractEconomicsData.contract?.orderCode ?? contractEconomicsData.linkedOrder?.orderCode ?? '',
      accountingTag: 'contract_deposit_receipt',
      category: 'abono_contrato',
      createdBy,
      responsible: createdBy,
    };

    setGeneratingDepositReceiptId(entry.id);
    setContractEconomicsError('');
    let receiptWindow = null;
    try {
      receiptWindow = openCashReceiptWindow();
      const result = allocation.contractBs > 0 && rentalId
        ? await api.cash.collectReceivable({
            ...commonPayload,
            rentalId,
            amountBs: allocation.contractBs,
            collectionTarget: 'balance',
            collectionTargets: ['balance'],
            collectionBreakdown: [{
              target: 'balance',
              amountBs: allocation.contractBs,
              label: 'Contrato',
              detail: 'Aplicacion del abono al saldo comercial.',
            }],
          })
        : await api.cash.createManualMovement({
            ...commonPayload,
            type: 'ingreso',
            cashBoxType: 'BIG_CASH',
            amountBs: allocation.receivedBs,
            description: `Abono contrato ${contractCode}: ${customerName}`,
          });
      rememberEconomicCashResult(result);
      const movement = result?.movement ?? result ?? {};
      const movementId = resolveEconomicMovementId(result);
      if (!movementId) throw new Error('Caja registro el abono, pero no devolvio el movimiento para enlazar el recibo.');

      if (result?.rental?.id) setContractEconomicsFullRental(result.rental);
      const receiptCode = String(movement?.receiptCode ?? movement?.receipt ?? result?.receiptCode ?? '').trim();
      const nextLedger = (contractEconomicsData.economicLedger ?? []).map((row) => (
        row.id === entry.id
          ? {
              ...row,
              cashMovementId: movementId,
              cashReceiptCode: receiptCode,
              cashRegisteredAt: movement?.createdAt ?? new Date().toISOString(),
              isCashRegistered: true,
              contractAllocationBs: allocation.contractBs,
              guaranteeAllocationBs: allocation.guaranteeBs,
              surplusAllocationBs: allocation.surplusBs,
            }
          : row
      ));
      await saveContractEconomicLedgerRows(
        nextLedger,
        `Abono respaldado con recibo ${receiptCode || 'oficial'}.`,
        { force: true },
      );
      await handlePrintEconomicReceipt({ ...movement, id: movementId }, receiptWindow);
    } catch (error) {
      if (receiptWindow && !receiptWindow.closed) receiptWindow.close();
      setContractEconomicsError(error.message || 'No se pudo generar el recibo del deposito.');
    } finally {
      setGeneratingDepositReceiptId(null);
    }
  };

  const applyEconomicReceiptImageResult = (result) => {
    const updated = result?.contract;
    if (!updated?.id) return null;
    const updatedLedger = Array.isArray(updated.economicLedger) ? updated.economicLedger : [];
    const updatedLedgerKey = String(updated.id ?? updated.contractCode ?? '').trim();
    setActiveEconomicResetLedger(updatedLedger);
    if (updatedLedgerKey) {
      setEconomicResetLedgerByContract((current) => ({
        ...current,
        [updatedLedgerKey]: updatedLedger,
      }));
    }
    setContractEconomicsTarget(updated);
    return updated;
  };

  const handleSelectEconomicReceiptImage = (entry) => {
    if (!entry?.id || readOnly || economicReceiptImageBusyId) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setContractEconomicsError('');
      setEconomicReceiptImageBusyId(entry.id);
      try {
        const result = await api.uploads.economicReceiptImage(file, {
          contractId: contractEconomicsData?.contract?.id ?? contractEconomicsData?.contract?.contractCode,
          ledgerEntryId: entry.id,
          userId: currentUser?.id ?? '',
          userName: currentUser?.fullName ?? currentUser?.name ?? currentUser?.username ?? 'Sistema',
        });
        if (!applyEconomicReceiptImageResult(result)) {
          throw new Error('El servidor guardo la imagen, pero no devolvio el contrato actualizado.');
        }
        setActionFeedback(`Comprobante adjuntado a la linea ${entry.note || entry.type || 'economica'}.`);
      } catch (error) {
        setContractEconomicsError(error.message || 'No se pudo adjuntar el comprobante.');
      } finally {
        setEconomicReceiptImageBusyId(null);
      }
    };
    input.click();
  };

  const handleDeleteEconomicReceiptImage = async (entry) => {
    if (!entry?.id || !entry?.attachment?.filename || readOnly || economicReceiptImageBusyId) return;
    if (!window.confirm('Quitar el comprobante adjunto de esta linea?')) return;
    setContractEconomicsError('');
    setEconomicReceiptImageBusyId(entry.id);
    try {
      const result = await api.uploads.deleteEconomicReceiptImage({
        contractId: contractEconomicsData?.contract?.id ?? contractEconomicsData?.contract?.contractCode,
        ledgerEntryId: entry.id,
        userId: currentUser?.id ?? '',
        userName: currentUser?.fullName ?? currentUser?.name ?? currentUser?.username ?? 'Sistema',
      });
      if (!applyEconomicReceiptImageResult(result)) {
        throw new Error('El servidor quito la imagen, pero no devolvio el contrato actualizado.');
      }
      setActionFeedback('Comprobante quitado correctamente.');
    } catch (error) {
      setContractEconomicsError(error.message || 'No se pudo quitar el comprobante.');
    } finally {
      setEconomicReceiptImageBusyId(null);
    }
  };

  const handleEditContractEconomicLedgerEntry = (entry) => {
    if (!canManageContractEconomicLedger) return;
    setLedgerDateEditEntry(entry);
    setLedgerDateEditValue(getInputDateTime(entry.createdAt));
    setLedgerDateEditError('');
  };

  const closeLedgerDateEditor = () => {
    if (isSavingContractEconomicsLedger) return;
    setLedgerDateEditEntry(null);
    setLedgerDateEditValue('');
    setLedgerDateEditError('');
  };

  const handleSubmitLedgerDateEdit = async (event) => {
    event.preventDefault();
    if (!ledgerDateEditEntry?.id || isSavingContractEconomicsLedger) return;
    const parsedDate = new Date(ledgerDateEditValue);
    if (!ledgerDateEditValue || Number.isNaN(parsedDate.getTime())) {
      setLedgerDateEditError('Selecciona una fecha y hora validas.');
      return;
    }

    const nextCreatedAt = parsedDate.toISOString();
    const nextLedger = (contractEconomicsData?.economicLedger ?? []).map((entry) => (
      String(entry?.id ?? '') === String(ledgerDateEditEntry.id)
        ? { ...entry, createdAt: nextCreatedAt }
        : entry
    ));
    const updated = await saveContractEconomicLedgerRows(
      nextLedger,
      'Fecha del movimiento actualizada sin modificar sus demas datos.',
    );
    if (!updated) {
      setLedgerDateEditError('No se pudo actualizar la fecha. Intenta nuevamente.');
      return;
    }

    const linkedMovementId = String(ledgerDateEditEntry.cashMovementId ?? '').trim();
    if (linkedMovementId) {
      const applyDate = (movement) => (
        String(movement?.id ?? '') === linkedMovementId
          ? { ...movement, createdAt: nextCreatedAt, receiptIssuedAt: nextCreatedAt }
          : movement
      );
      setContractEconomicsContextMovements((current) => current.map(applyDate));
      setRecentEconomicCashMovements((current) => current.map(applyDate));
    }
    setLedgerDateEditEntry(null);
    setLedgerDateEditValue('');
    setLedgerDateEditError('');
  };

  const handleDeleteContractEconomicLedgerEntry = async (entry) => {
    if (!canManageContractEconomicLedger || !contractEconomicsData || isSavingContractEconomicsLedger) return;
    const confirmed = window.confirm('Eliminar esta linea del cuaderno economico?');
    if (!confirmed) return;

    const nextLedger = (contractEconomicsData.economicLedger ?? [])
      .filter((row) => row.id !== entry.id);
    const updated = await saveContractEconomicLedgerRows(
      nextLedger,
      'Linea anulada del cuaderno economico.',
      { deletionReason: `Anulada manualmente: ${entry.note || entry.type || 'sin detalle'}` },
    );
    if (updated && contractEconomicsLedgerEditingId === entry.id) {
      resetContractEconomicLedgerForm();
    }
  };

  const printGuaranteeOperationReceipt = ({ title, amountBs, detail, guaranteeBeforeBs, guaranteeAfterBs, receiptWindow: providedWindow = null }) => {
    const contractCode = contractEconomicsData?.contract?.contractCode || contractEconomicsData?.contract?.id || '';
    const customerName = contractEconomicsData?.contract?.customerName || 'Cliente';
    const receiptWindow = providedWindow || window.open('', '_blank', 'width=720,height=860');
    if (!receiptWindow) return;
    receiptWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title} ${contractCode}</title><style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;padding:28px;color:#10254f;background:#f7f4ef}.ticket{max-width:680px;margin:auto;background:#fff;border:1px solid #eaded4;border-radius:16px;padding:26px}.brand{color:#e65300;font-weight:800;letter-spacing:.08em}.head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #e65300;padding-bottom:16px}.head h1{margin:6px 0 0;font-size:24px}.amount{font-size:28px;font-weight:900;color:#0b2d63}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px}.box{border:1px solid #e5ddd6;border-radius:12px;padding:14px}.box span{display:block;font-size:11px;text-transform:uppercase;color:#7a6f68;font-weight:800;margin-bottom:6px}.detail{margin-top:18px;padding:16px;border-radius:12px;background:#fff8f1;line-height:1.5}.foot{margin-top:26px;padding-top:14px;border-top:1px solid #e5ddd6;font-size:12px;color:#6b7280}@media print{body{background:#fff;padding:0}.ticket{border:0;box-shadow:none}}</style></head><body><main class="ticket"><div class="head"><div><div class="brand">EL COPETIN</div><h1>${title}</h1><p>Contrato ${contractCode} · ${customerName}</p></div><div class="amount">${formatBs(amountBs)}</div></div><div class="grid"><div class="box"><span>Garantia antes</span><strong>${formatBs(guaranteeBeforeBs)}</strong></div><div class="box"><span>Garantia despues</span><strong>${formatBs(guaranteeAfterBs)}</strong></div></div><div class="detail">${detail}</div><div class="foot">Comprobante interno generado el ${formatDateTime(new Date().toISOString())}. No representa un nuevo ingreso de efectivo cuando se trata de una reclasificacion o aplicacion de garantia.</div></main><script>window.onload=()=>{window.print();}</script></body></html>`);
    receiptWindow.document.close();
  };

  const handleSeparateEconomicGuarantee = async (depositEntry) => {
    if (!canManageContractEconomicLedger || !contractEconomicsData || isSavingContractEconomicsLedger) return;
    if (!depositEntry || depositEntry.type !== 'deposit' || isGeneratedEconomicCollectionEntry(depositEntry)) return;

    const declaredGapBs = Math.max(
      0,
      Number((contractEconomicsData.guaranteeDeclaredBs - contractEconomicsData.ledgerAnnotatedGuaranteeBs).toFixed(2)),
    );
    const alreadyAllocatedFromDepositBs = (contractEconomicsData.economicLedger ?? []).reduce((sum, row) => (
      row.type === 'guarantee' && String(row.sourceDepositId ?? '') === String(depositEntry.id)
        ? sum + toMoneyNumber(row.amountBs)
        : sum
    ), 0);
    const depositAvailableBs = Math.max(
      0,
      Number((toMoneyNumber(depositEntry.amountBs) - alreadyAllocatedFromDepositBs).toFixed(2)),
    );
    const amount = Math.min(declaredGapBs, depositAvailableBs);
    if (amount <= 0) {
      setContractEconomicsError(declaredGapBs <= 0
        ? 'La garantia ya fue apartada completamente.'
        : 'Este deposito no tiene saldo suficiente para apartar la garantia.');
      return;
    }

    const createdByName = String(currentUser?.fullName ?? currentUser?.name ?? currentUser?.username ?? 'Sistema').trim() || 'Sistema';
    const entry = {
      id: `eco-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'guarantee',
      amountBs: amount,
      paymentMethod: depositEntry.paymentMethod || 'efectivo',
      paymentAccount: depositEntry.paymentMethod === 'qr' ? depositEntry.paymentAccount || '' : '',
      note: `Del deposito de ${formatBs(depositEntry.amountBs)} se apartaron ${formatBs(amount)} como garantia para ${contractEconomicsData.contract?.customerName || 'cliente'}.`,
      createdAt: new Date().toISOString(),
      createdByName,
      reclassifiedFromPayment: true,
      sourceDepositId: depositEntry.id,
      cashMovementId: null,
      cashReceiptCode: '',
      cashRegisteredAt: null,
    };
    const updated = await saveContractEconomicLedgerRows(
      [...(contractEconomicsData.economicLedger ?? []), entry],
      `Garantia ${formatBs(amount)} apartada desde el deposito ${formatBs(depositEntry.amountBs)}.`,
    );
    if (updated) resetContractEconomicLedgerForm();
  };

  const handleApplyEconomicCharge = async () => {
    if (!canManageContractEconomicLedger || !contractEconomicsData || isSavingContractEconomicsLedger) return;
    const pendingChargeBs = Math.max(0, contractEconomicsData.penaltiesBs - contractEconomicsData.ledgerTotals.chargesBs);
    const amount = Math.min(pendingChargeBs, contractEconomicsData.guaranteeRefundAvailableBs || contractEconomicsData.guaranteeReserveBs);
    if (amount <= 0) return;
    const createdByName = String(currentUser?.fullName ?? currentUser?.name ?? currentUser?.username ?? 'Sistema').trim() || 'Sistema';
    const entry = {
      id: `eco-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'charge',
      amountBs: amount,
      paymentMethod: '',
      paymentAccount: '',
      note: `Danos/faltantes aplicados contra la garantia de ${contractEconomicsData.contract?.customerName || 'cliente'}.`,
      createdAt: new Date().toISOString(),
      createdByName,
    };
    const receiptWindow = window.open('', '_blank', 'width=720,height=860');
    const updated = await saveContractEconomicLedgerRows([...(contractEconomicsData.economicLedger ?? []), entry], 'Dano o faltante aplicado contra la garantia.');
    if (updated) {
      printGuaranteeOperationReceipt({
        title: 'Comprobante de aplicacion de garantia',
        amountBs: amount,
        detail: 'Este importe fue descontado de la garantia para cubrir danos o faltantes registrados en la devolucion.',
        guaranteeBeforeBs: contractEconomicsData.guaranteeReserveBs,
        guaranteeAfterBs: Math.max(0, contractEconomicsData.guaranteeReserveBs - amount),
        receiptWindow,
      });
      resetContractEconomicLedgerForm();
    }
  };

  const handleSubmitContractEconomicGuaranteeRefund = async (event) => {
    event.preventDefault();
    if (!canManageContractEconomicLedger || !contractEconomicsData || isSavingContractEconomicsGuaranteeRefund) return;

    const requestedSource = contractEconomicsGuaranteeRefundDraft.source === 'surplus' ? 'surplus' : 'guarantee';
    const refundSource = requestedSource === 'guarantee' && contractEconomicsData.guaranteeRefundableBs <= 0
      ? 'surplus'
      : requestedSource === 'surplus' && contractEconomicsData.ledgerRefundSuggestedBs <= 0
        ? 'guarantee'
        : requestedSource;
    const refundableBs = Math.max(
      0,
      toMoneyNumber(refundSource === 'surplus'
        ? contractEconomicsData.ledgerRefundSuggestedBs
        : contractEconomicsData.guaranteeRefundableBs),
    );
    const amount = Math.max(0, toMoneyNumber(contractEconomicsGuaranteeRefundDraft.amountBs || refundableBs));
    const paymentMethod = normalizeLedgerPaymentMethod(contractEconomicsGuaranteeRefundDraft.paymentMethod);
    const paymentAccount = paymentMethod === 'qr'
      ? normalizeLedgerPaymentAccount(contractEconomicsGuaranteeRefundDraft.paymentAccount)
      : '';

    if (refundableBs <= 0) {
      setContractEconomicsError('No existe dinero disponible en ese concepto para devolver.');
      return;
    }
    if (amount <= 0) {
      setContractEconomicsError('El monto a devolver debe ser mayor a 0.');
      return;
    }
    if (amount > refundableBs) {
      setContractEconomicsError(`La devolucion no puede superar ${formatBs(refundableBs)}.`);
      return;
    }
    if (paymentMethod === 'qr' && !paymentAccount) {
      setContractEconomicsError('Selecciona la cuenta o banco QR para registrar la devolucion.');
      return;
    }

    const createdByName = String(
      currentUser?.fullName
        ?? currentUser?.name
        ?? currentUser?.username
        ?? currentUser?.email
        ?? 'Sistema',
    ).trim() || 'Sistema';

    setIsSavingContractEconomicsGuaranteeRefund(true);
    setContractEconomicsError('');

    try {
      const result = await api.cash.createManualMovement({
        type: 'egreso',
        cashBoxType: 'BIG_CASH',
        amountBs: amount,
        description: `${refundSource === 'surplus' ? 'Devolucion excedente' : 'Devolucion garantia'}: ${contractEconomicsData.contract?.customerName || 'cliente'}`,
        category: refundSource === 'surplus' ? 'excedente_devuelto_manual' : 'garantia_devuelta_manual',
        paymentMethod,
        paymentAccount,
        responsible: createdByName,
        receipt: contractEconomicsGuaranteeRefundDraft.receipt,
        notes: contractEconomicsGuaranteeRefundDraft.note
          || contractEconomicsGuaranteeRefundDraft.receipt
          || `Devolucion de ${refundSource === 'surplus' ? 'excedente' : 'garantia'} del contrato ${contractEconomicsData.contract?.contractCode || contractEconomicsData.contract?.id || ''}`,
        linkedRentalId: contractEconomicsData.rental?.id ?? contractEconomicsData.contract?.rentalId ?? '',
        linkedContractId: contractEconomicsData.contract?.id ?? '',
        linkedOrderCode: contractEconomicsData.contract?.orderCode ?? contractEconomicsData.linkedOrder?.orderCode ?? '',
        accountingTag: refundSource === 'surplus' ? 'contract_overpayment_refund' : 'guarantee_refund',
        createdBy: createdByName,
      });
      rememberEconomicCashResult(result);
      const movementId = resolveEconomicMovementId(result);
      const movement = result?.movement ?? result ?? {};
      if (movementId) {
        void handlePrintEconomicReceipt({ ...movement, id: movementId }).catch((printError) => {
          console.error('[economic-receipt] No se pudo abrir el recibo automaticamente', printError);
          setActionFeedback('La devolucion fue guardada correctamente, pero el recibo no pudo abrirse automaticamente. Puedes abrirlo desde Ver documentos.');
        });
      }

      const entry = {
        id: `eco-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: 'refund',
        refundSource,
        amountBs: amount,
        paymentMethod,
        paymentAccount,
        note: contractEconomicsGuaranteeRefundDraft.note
          || contractEconomicsGuaranteeRefundDraft.receipt
          || `Devolucion de ${refundSource === 'surplus' ? 'excedente' : 'garantia'} a ${contractEconomicsData.contract?.customerName || 'cliente'}.`,
        createdAt: new Date().toISOString(),
        createdByName,
        cashMovementId: movementId || null,
        cashReceiptCode: String(movement?.receiptCode ?? movement?.receipt ?? result?.receiptCode ?? result?.receipt ?? '').trim(),
        cashRegisteredAt: movement?.createdAt ?? result?.createdAt ?? new Date().toISOString(),
      };
      const updated = await saveContractEconomicLedgerRows(
        [...(contractEconomicsData.economicLedger ?? []), entry],
        `Devolucion de ${refundSource === 'surplus' ? 'excedente' : 'garantia'} registrada en Caja Grande con recibo.`,
        { force: true },
      );
      if (updated) {
        resetContractEconomicLedgerForm();
        setContractEconomicsGuaranteeRefundDraft({
          source: 'guarantee',
          amountBs: '',
          paymentMethod: 'efectivo',
          paymentAccount: '',
          receipt: '',
          note: '',
        });
      }
    } catch (error) {
      setContractEconomicsError(error.message || 'No se pudo registrar la devolucion de garantia.');
    } finally {
      setIsSavingContractEconomicsGuaranteeRefund(false);
    }
  };

  const handlePrintOrderDocument = async (kind, orderRow, requestedPaperSize = 'oficio') => {
    const paperSize = requestedPaperSize === 'carta' ? 'carta' : 'oficio';
    const documentLabel = kind === 'contract'
      ? 'contrato'
      : kind === 'inventory'
        ? 'orden de inventario'
        : kind === 'route'
          ? 'hoja de ruta'
          : 'documento';
    const baseDocumentCode = kind === 'contract'
      ? orderRow.contractCode ?? orderRow.orderCode ?? orderRow.id
      : orderRow.orderCode ?? orderRow.id;
    const loadingTitle = `${kind === 'contract'
      ? 'Contrato'
      : kind === 'inventory'
        ? 'Orden de inventario'
        : kind === 'route'
          ? 'Hoja de ruta'
          : 'Resumen proveedor'} ${baseDocumentCode}`;

    setDocumentPreview({
      kind,
      orderCode: orderRow.orderCode,
      title: loadingTitle,
      fileName: kind === 'contract'
        ? buildDocumentFileBase(orderRow.customerName ?? orderRow.client, baseDocumentCode, 'contrato')
        : undefined,
      html: '',
      blobUrl: '',
      paperSize,
      sourceRow: orderRow,
      loading: true,
    });
    setContractActionStatus(`Generando ${documentLabel} ${getOrderContractLabel(orderRow)}...`);
    setMenuState(null);

    // Permite que React pinte el modal de carga antes de construir el HTML pesado.
    await new Promise((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));

    try {
      let preview = null;
      let cacheKey = `${kind}:${String(baseDocumentCode ?? '').trim()}`;

      if (kind === 'contract') {
        const contractIdentifier = orderRow.contractId
          ?? orderRow.contractCode
          ?? orderRow.orderCode
          ?? orderRow.id;

        cacheKey = [
          kind,
          String(contractIdentifier ?? ''),
          paperSize,
          String(orderRow.updatedAt ?? orderRow.createdAt ?? ''),
        ].join(':');

        preview = documentPreviewCacheRef.current.get(cacheKey) ?? null;
        if (!preview) {
          const renderedPdf = await fetchContractPdf({
            identifier: contractIdentifier,
            paperSize,
          });

          preview = {
            title: loadingTitle,
            html: '',
            blobUrl: renderedPdf.blobUrl,
            viewerUrl: renderedPdf.viewerUrl,
            mimeType: 'application/pdf',
            cacheStatus: renderedPdf.cacheStatus,
            durationMs: renderedPdf.durationMs,
          };
          documentPreviewCacheRef.current.set(cacheKey, preview);
        }
      } else if (kind === 'inventory') {
        const rentalIdentifier = orderRow.rentalId
          ?? orderRow.orderCode
          ?? orderRow.contractCode
          ?? orderRow.id
          ?? '';

        cacheKey = [
          kind,
          String(rentalIdentifier ?? ''),
          String(orderRow.updatedAt ?? orderRow.createdAt ?? ''),
        ].join(':');

        preview = documentPreviewCacheRef.current.get(cacheKey) ?? null;
        if (!preview) {
          const renderedPdf = await fetchInventoryOrderPdf({
            identifier: rentalIdentifier,
          });
          preview = {
            title: loadingTitle,
            html: '',
            blobUrl: renderedPdf.blobUrl,
            mimeType: 'application/pdf',
            cacheStatus: renderedPdf.cacheStatus,
            durationMs: renderedPdf.durationMs,
          };
          documentPreviewCacheRef.current.set(cacheKey, preview);
        }
      } else if (kind === 'route') {
        cacheKey = [
          kind,
          orderRow.rentalId ?? orderRow.id,
          orderRow.updatedAt ?? orderRow.createdAt ?? '',
        ].join(':');
        preview = documentPreviewCacheRef.current.get(cacheKey) ?? null;
        if (!preview) {
          preview = await onPrintRouteSheetDocument?.({
            rentalId: orderRow.rentalId,
            orderCode: orderRow.orderCode,
            contractId: orderRow.contractId,
            contractCode: orderRow.contractCode,
          });
          if (preview?.html) documentPreviewCacheRef.current.set(cacheKey, preview);
        }
      } else if (kind === 'supplier-internal') {
        const contract = selectedDocumentsContract
          ?? contracts.find((entry) =>
            (orderRow.contractId && String(entry.id) === String(orderRow.contractId))
            || (orderRow.contractCode && String(entry.contractCode) === String(orderRow.contractCode))
            || (orderRow.orderCode && String(entry.orderCode) === String(orderRow.orderCode)),
          )
          ?? null;
        cacheKey = [
          kind,
          contract?.id ?? orderRow.contractId ?? orderRow.id,
          contract?.updatedAt ?? contract?.createdAt ?? '',
        ].join(':');
        preview = documentPreviewCacheRef.current.get(cacheKey) ?? null;
        if (!preview) {
          preview = {
            title: `Resumen proveedor ${contract?.contractCode ?? orderRow.contractCode ?? orderRow.orderCode}`,
            html: buildSupplierInternalDocumentHtml({ order: orderRow, contract, formatDate, formatBs }),
          };
          documentPreviewCacheRef.current.set(cacheKey, preview);
        }
      }

      if (!preview?.html && !preview?.blobUrl) {
        throw new Error('El documento no pudo prepararse correctamente.');
      }

      setDocumentPreview({
        kind,
        orderCode: orderRow.orderCode,
        title: preview.title ?? loadingTitle,
        fileName: kind === 'contract'
          ? buildDocumentFileBase(orderRow.customerName ?? orderRow.client, baseDocumentCode, 'contrato')
          : undefined,
        html: preview.html ?? '',
        blobUrl: preview.blobUrl ?? '',
        viewerUrl: preview.viewerUrl ?? '',
        mimeType: preview.mimeType ?? 'text/html',
        paperSize,
        sourceRow: orderRow,
        loading: false,
        cacheKey,
      });

      setActionFeedback(`Documento ${kind === 'contract' ? 'de contrato' : kind === 'inventory' ? 'de inventario' : kind === 'route' ? 'de ruta' : 'interno de proveedor'} cargado para contrato ${getOrderContractLabel(orderRow)}.`);
    } catch (requestError) {
      setDocumentPreview(null);
      setFormError(requestError.message || 'No se pudo abrir el documento seleccionado.');
    } finally {
      setContractActionStatus('');
    }
  };

  const handleOpenStoredDocument = (doc) => {
    const normalizedType = normalizeText(doc.sourceType || doc.name);
    const kind = normalizedType.includes('ruta')
      ? 'route'
      : normalizedType.includes('inventario')
        ? 'inventory'
        : 'contract';

    handlePrintOrderDocument(kind, documentsOrder);
  };

  const handleContractPaperSizeChange = async (event) => {
    const paperSize = event.target.value === 'carta' ? 'carta' : 'oficio';
    const current = documentPreview;
    if (!current || !current.sourceRow || current.paperSize === paperSize) return;
    if (current.kind === 'quote') {
      await handleOpenQuoteDocument(current.sourceRow, paperSize);
      return;
    }
    if (current.kind !== 'contract') return;
    await handlePrintOrderDocument('contract', current.sourceRow, paperSize);
  };

  const handlePrintPreview = () => {
    if (documentPreview?.loading || !documentPreview?.blobUrl) return;
    if (documentPreview?.mimeType === 'application/pdf') {
      const pdfUrl = documentPreview.viewerUrl || documentPreview.blobUrl;
      if (isMobileContractPdfViewer()) {
        // En celular se abre en la misma pestaña. Al volver con el botón Atrás,
        // sessionStorage pertenece a la misma pestaña y la sesión se conserva.
        window.location.assign(pdfUrl);
        return;
      }
      window.open(
        pdfUrl,
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }
    const frame = document.getElementById('orders-document-preview-frame');
    const frameDocument = frame?.contentDocument ?? frame?.contentWindow?.document;
    const previousTitle = document.title;
    if (frameDocument && documentPreview?.fileName) {
      frameDocument.title = documentPreview.fileName;
      document.title = documentPreview.fileName;
      const restoreTitle = () => {
        document.title = previousTitle;
        window.removeEventListener('focus', restoreTitle);
        frame?.contentWindow?.removeEventListener?.('afterprint', restoreTitle);
      };
      window.addEventListener('focus', restoreTitle);
      frame?.contentWindow?.addEventListener?.('afterprint', restoreTitle, { once: true });
    }
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  };

  const buildWhatsAppDocuments = (recordType, row) => {
    if (recordType === 'quote') {
      const title = `Cotizacion ${row.quoteCode || row.id}`;
      const timeline = getQuoteTimelineLabel(row);
      const validity = row.validUntil ? `vence ${formatDate(row.validUntil)}` : 'sin vencimiento';
      return [{
        id: 'quote',
        label: `${title} - ${timeline}`,
        title,
        description: `${row.itemsCount ?? 0} items | ${formatBs(Number(row.totalBs ?? 0))} | ${validity}`,
      }];
    }

    if (recordType === 'contract') {
      const title = `Contrato ${row.contractCode || row.id}`;
      const timeline = getContractTimelineLabel(row);
      const servicePeriod = [row.deliveryDate, row.pickupDate].filter(Boolean).map(formatDate).join(' - ') || 'Sin fechas operativas';
      return [{
        id: 'contract',
        label: `${title} - ${timeline}`,
        title,
        description: `${row.orderCode || 'Sin orden vinculada'} | ${formatBs(Number(row.totalBs ?? 0))} | ${servicePeriod}`,
      }];
    }

    return [
      row.contractCode
        ? {
          id: 'contract',
          label: `Contrato ${row.contractCode} - ${getContractTimelineLabel(row)}`,
          title: `Contrato ${row.contractCode}`,
          description: `Acuerdo comercial de ${row.orderCode}`,
        }
        : null,
      {
        id: 'inventory',
        label: `Orden inventario ${row.orderCode}`,
        title: `Orden inventario ${row.orderCode}`,
        description: 'Lista operativa de items.',
      },
      {
        id: 'route',
        label: `Hoja de ruta ${row.orderCode}`,
        title: `Hoja de ruta ${row.orderCode}`,
        description: 'Entrega, recojo y transporte.',
      },
    ].filter(Boolean);
  };

  const openWhatsAppModal = (recordType, row, preferredDocumentId = null) => {
    const documentOptions = buildWhatsAppDocuments(recordType, row);
    const selectedDocumentId = preferredDocumentId && documentOptions.some((option) => option.id === preferredDocumentId)
      ? preferredDocumentId
      : documentOptions[0]?.id ?? 'general';
    const selectedDocument = documentOptions.find((option) => option.id === selectedDocumentId) ?? documentOptions[0];
    const customerName = row.customerName || row.client || 'cliente';
    const phone = row.customerPhone || row.phone || '';
    const reference = selectedDocument?.label ? ` referente a ${selectedDocument.title || selectedDocument.label}` : '';

    setWhatsAppModal({
      recordType,
      row,
      title: `Contactar a ${customerName}`,
      customerName,
      phone,
      documentOptions,
      selectedDocumentId,
      message: `Hola ${customerName}, te escribo de El Copetin${reference}. Te comparto la informacion para revisar y quedo atento a tu confirmacion.`,
      error: '',
    });
    setMenuState(null);
  };

  const updateWhatsAppModal = (patch) => {
    setWhatsAppModal((current) => (current ? { ...current, ...patch } : current));
  };

  const updateWhatsAppDocument = (documentId) => {
    setWhatsAppModal((current) => {
      if (!current) return current;
      const selectedDocument = current.documentOptions.find((option) => option.id === documentId);
      const reference = selectedDocument?.label ? ` referente a ${selectedDocument.title || selectedDocument.label}` : '';
      return {
        ...current,
        selectedDocumentId: documentId,
        message: `Hola ${current.customerName}, te escribo de El Copetin${reference}. Te comparto la informacion para revisar y quedo atento a tu confirmacion.`,
        error: '',
      };
    });
  };

  const previewWhatsAppDocument = async () => {
    if (!whatsAppModal) return;
    const { recordType, row, selectedDocumentId } = whatsAppModal;

    try {
      if (recordType === 'quote') {
        await handleOpenQuoteDocument(row);
        return;
      }

      if (recordType === 'contract') {
        const fullContract = await api.contracts.ensureFull(
          row.id ?? row.contractCode ?? row.orderCode,
          'preview-whatsapp-contract',
        );
        const preview = await onPrintContractDocument?.({
          contractId: fullContract.id,
          rentalId: fullContract.rentalId ?? row.rentalId,
          orderCode: fullContract.orderCode ?? row.orderCode,
        });
        if (preview?.html) {
          setDocumentPreview({
            kind: 'contract',
            orderCode: row.orderCode ?? row.contractCode,
            title: preview.title ?? `Contrato ${row.contractCode ?? row.id}`,
            fileName: buildDocumentFileBase(row.customerName, row.contractCode || row.id, 'contrato'),
            html: preview.html,
          });
        }
        return;
      }

      await handlePrintOrderDocument(selectedDocumentId, row);
    } catch (requestError) {
      updateWhatsAppModal({ error: requestError.message || 'No se pudo cargar el documento.' });
    }
  };

  const sendWhatsAppMessage = () => {
    try {
      openWhatsAppComposer({
        phone: whatsAppModal?.phone,
        message: whatsAppModal?.message,
      });
      setWhatsAppModal(null);
    } catch (requestError) {
      updateWhatsAppModal({ error: requestError.message || 'No se pudo abrir WhatsApp.' });
    }
  };

  const handleGenerateDocuments = async (orderRow) => {
    if (!beginSubmit()) return;
    try {
      await onGenerateOrderDocuments({
        rentalId: orderRow.rentalId,
        orderCode: orderRow.orderCode,
        contractId: orderRow.contractId,
        contractCode: orderRow.contractCode,
      });
      setActionFeedback(`Documentos generados para contrato ${getOrderContractLabel(orderRow)}.`);
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudieron generar los documentos.');
    } finally {
      endSubmit();
      setMenuState(null);
    }
  };

  const handleOpenOperationalPanel = async (orderRow) => {
    let fullOrder = orderRow;
    if (orderRow?._summaryOnly || !(orderRow?.items ?? []).length) {
      try {
        const fullRental = await api.rentals.getFull(
          orderRow?.rentalId ?? orderRow?.id ?? orderRow?.orderCode,
        );
        fullOrder = { ...orderRow, ...fullRental };
      } catch (requestError) {
        setFormError(requestError.message || 'No se pudo cargar el detalle operativo de la orden.');
        setMenuState(null);
        return;
      }
    }
    if (orderRow.status === 'cancelled') {
      setFormError('La orden esta anulada y ya no admite gestion operativa.');
      setMenuState(null);
      return;
    }
    setOperationalOrder(fullOrder);
    setOperationalDraft({
      inventoryNote: fullOrder.inventoryNote ?? fullOrder.operational?.inventoryNote ?? '',
      transportNote: fullOrder.transportNote ?? fullOrder.operational?.transportNote ?? '',
    });
    setMenuState(null);
  };

  const handleCloseOperationalPanel = () => {
    if (isSubmitting) return;
    setOperationalOrder(null);
  };

  const handleUpdateOperationalStatus = async (target, status) => {
    const orderRow = selectedOperationalOrder;
    if (!orderRow) return;
    if (!beginSubmit()) return;
    setFormError('');
    try {
      const payload = {
        id: orderRow.rentalId,
        inventoryNote: operationalDraft.inventoryNote,
        transportNote: operationalDraft.transportNote,
      };
      if (target === 'inventory') payload.inventoryStatus = status;
      if (target === 'transport') payload.transportStatus = status;
      await onUpdateOrderOperational?.(payload);
      setActionFeedback(
        `${target === 'inventory' ? 'Inventario' : 'Transporte'} actualizado para contrato ${getOrderContractLabel(orderRow)}.`,
      );
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo actualizar la orden operativa.');
    } finally {
      endSubmit();
    }
  };

  const handleCancelOrderClick = (orderRow) => {
    setOrderToCancel(orderRow);
    setMenuState(null);
  };

  const closeCancelOrderDialog = () => {
    if (isSubmitting) return;
    setOrderToCancel(null);
  };

  const confirmCancelOrder = async () => {
    if (!orderToCancel) return;
    const cancellationReason = String(cancelReasonRef.current?.value ?? '').trim();
    if (!cancellationReason) {
      setFormError('Debes escribir por que se esta anulando el contrato.');
      cancelReasonRef.current?.focus();
      return;
    }
    if (!beginSubmit()) return;
    setFormError('');
    try {
      const cancelled = await onCancelOrderContract?.({
        id: orderToCancel.rentalId,
        contractId: orderToCancel.contractId,
        reason: cancellationReason,
      });
      const penaltyBs = Number(cancelled?.cancellationPenaltyBs ?? orderToCancel.cancellationPenaltyBs ?? 0);
      setActionFeedback(
        `Contrato ${orderToCancel.contractCode || orderToCancel.orderCode} anulado. Penalidad aplicada: ${formatBs(penaltyBs)}.`,
      );
      setOrderToCancel(null);
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo anular el contrato.');
    } finally {
      endSubmit();
    }
  };

  const handleOpenReportsClick = () => {
    setMenuState(null);
    onOpenReportsModule?.();
  };

  const isLastStep = currentStep === QUOTE_WIZARD_STEPS.length - 1;
  const isCommercialCompactView = metrics.length === 2;

  const getVisibleEconomicNotes = (row) => {
    const override = contractNoteOverrides.get(String(row?.id ?? ''));
    return override ?? row?.economicInternalNotes ?? getEconomicInternalNotes(row);
  };

  const getContractNoteActorPayload = () => {
    const userName = String(
      currentUser?.fullName
      ?? currentUser?.name
      ?? currentUser?.username
      ?? currentUser?.email
      ?? 'Sistema',
    ).trim() || 'Sistema';
    return {
      updatedById: currentUser?.id ?? null,
      updatedByName: userName,
      updatedByRole: currentUser ? getUserDisplayRole(currentUser) : 'Sistema',
    };
  };

  const applyContractNotesMutationResult = (result, fallbackContract) => {
    const updatedContract = result?.contract ?? fallbackContract;
    const updatedNotes = getEconomicInternalNotes(updatedContract);
    const contractId = String(updatedContract?.id ?? fallbackContract?.id ?? '');
    setContractNoteOverrides((current) => {
      const next = new Map(current);
      if (contractId) next.set(contractId, updatedNotes);
      return next;
    });
    setContractEconomicNotePreview({ contract: updatedContract, notes: updatedNotes });
    return updatedNotes;
  };

  const openContractEconomicNoteEditor = (row) => {
    const notes = getVisibleEconomicNotes(row);
    setContractEconomicNoteDraft('');
    setContractEconomicNoteEditingId(null);
    setContractEconomicNoteError('');
    setContractEconomicNotePreview({ contract: row, notes });
  };

  const closeContractEconomicNoteEditor = () => {
    if (isSavingContractEconomicNote) return;
    setContractEconomicNotePreview(null);
    setContractEconomicNoteDraft('');
    setContractEconomicNoteEditingId(null);
    setContractEconomicNoteError('');
  };

  const startContractEconomicNoteEdit = (note) => {
    if (!note?.id || readOnly || isSavingContractEconomicNote) return;
    setContractEconomicNoteEditingId(note.id);
    setContractEconomicNoteDraft(note.note ?? '');
    setContractEconomicNoteError('');
  };

  const cancelContractEconomicNoteEdit = () => {
    if (isSavingContractEconomicNote) return;
    setContractEconomicNoteEditingId(null);
    setContractEconomicNoteDraft('');
    setContractEconomicNoteError('');
  };

  const handleSaveContractEconomicNote = async () => {
    if (!contractEconomicNotePreview?.contract || isSavingContractEconomicNote) return;
    const note = String(contractEconomicNoteDraft ?? '').trim();
    if (!note) {
      setContractEconomicNoteError('Escribe una nota antes de guardar.');
      return;
    }

    setContractEconomicNoteError('');
    setIsSavingContractEconomicNote(true);
    try {
      const contract = contractEconomicNotePreview.contract;
      const payload = {
        id: contract.id ?? contract.contractCode,
        note,
        ...getContractNoteActorPayload(),
      };
      const result = contractEconomicNoteEditingId
        ? await api.contracts.updateNote({
          ...payload,
          noteId: contractEconomicNoteEditingId,
        })
        : await api.contracts.addNote(payload);

      applyContractNotesMutationResult(result, contract);
      setContractEconomicNoteDraft('');
      setContractEconomicNoteEditingId(null);
    } catch (error) {
      setContractEconomicNoteError(error?.message || 'No se pudo guardar la nota.');
    } finally {
      setIsSavingContractEconomicNote(false);
    }
  };

  const handleDeleteContractEconomicNote = async (note) => {
    if (!contractEconomicNotePreview?.contract || !note?.id || isSavingContractEconomicNote || readOnly) return;
    if (typeof window !== 'undefined' && !window.confirm('¿Eliminar esta nota? Las demás notas se conservarán.')) return;

    setContractEconomicNoteError('');
    setIsSavingContractEconomicNote(true);
    try {
      const contract = contractEconomicNotePreview.contract;
      const result = await api.contracts.deleteNote({
        id: contract.id ?? contract.contractCode,
        noteId: note.id,
        ...getContractNoteActorPayload(),
      });
      applyContractNotesMutationResult(result, contract);
      if (contractEconomicNoteEditingId === note.id) {
        setContractEconomicNoteEditingId(null);
        setContractEconomicNoteDraft('');
      }
    } catch (error) {
      setContractEconomicNoteError(error?.message || 'No se pudo eliminar la nota.');
    } finally {
      setIsSavingContractEconomicNote(false);
    }
  };

  const activeContractColumnMenu = contractColumnMenu
    ? ORDER_COLUMN_MENU_OPTIONS[contractColumnMenu.key]
    : null;
  const activeContractColumnValue = contractColumnMenu && activeContractColumnMenu?.type === 'sort'
    ? (contractSort.key === contractColumnMenu.key ? contractSort.direction : '')
    : (contractColumnFilters[contractColumnMenu?.key] ?? 'all');

  return (
    <section className="panel orders-view">
      <header className="orders-header">
        <div>
          <span className="orders-mobile-eyebrow">Gestión comercial</span>
          <h2>Cotizaciones y Contratos</h2>
          <p>Gestion comercial centralizada: cotizaciones, contratos y apertura documental en un solo lugar.</p>
          <span className="orders-mobile-summary">
            {quoteRows.length} cotizaciones · {contractRows.length} contratos
          </span>
        </div>
        {!readOnly ? (
          <div className="orders-header-actions">
            <button type="button" className="primary-button orders-new-btn" onClick={() => openCreateModal('order', 'contract')}>
              + Nuevo Contrato
            </button>
            <button type="button" className="ghost-button orders-new-btn" onClick={() => openCreateModal('quote')}>
              + Cotizacion
            </button>
          </div>
        ) : (
          <span className="orders-readonly-badge">Modo consulta</span>
        )}
      </header>

      <article className="orders-table-card">
        <div className={`orders-view-switch orders-workflow-tabs ${isCommercialCompactView ? 'is-two-up' : ''} ${activeView === 'contracts' ? 'has-numbering' : ''}`}>
          {workflowTabs.map((tab, index) => (
            <Fragment key={tab.id}>
              <button
                type="button"
                className={`${activeView === tab.id ? 'active' : ''} ${tab.accent}`}
                onClick={() => setActiveView(tab.id)}
              >
                <span className="orders-workflow-icon">
                  <OrdersKpiIcon kind={tab.icon} />
                </span>
                <span className="orders-workflow-copy">
                  <strong>{tab.title}</strong>
                  <small>{tab.subtitle}</small>
                </span>
                <span className="orders-workflow-count">{tab.count}</span>
                {tab.badge > 0 ? <span className="orders-notification-badge">{tab.badge}</span> : null}
              </button>
              {activeView === 'contracts' && index === 0 ? (
                <button
                  type="button"
                  className={`orders-board-next-code ${canEditContractNumbering ? 'can-edit' : ''}`}
                  onClick={openContractNumberingEditor}
                  disabled={!canEditContractNumbering}
                  title={canEditContractNumbering ? 'Editar numeracion de contratos' : 'Numeracion actual de contratos'}
                >
                  <span>Numeracion</span>
                  <strong><small>Actual</small>{contractNumberingInfo.nextCode}</strong>
                  <strong><small>Siguiente</small>{contractNumberingInfo.followingCode}</strong>
                </button>
              ) : null}
            </Fragment>
          ))}
        </div>

        {contractActionStatus ? <p className="status">{contractActionStatus}</p> : null}
        {actionFeedback ? <p className="status success">{actionFeedback}</p> : null}
        {formError ? <p className="status error">{formError}</p> : null}

        {activeView === 'orders' ? (
          <>
            <div className="orders-filter-panel">
              <header className="orders-toolbar">
                <label className="orders-search">
                  <input
                    type="search"
                    placeholder="Buscar por numero de orden, cliente o evento..."
                    value={orderQuery}
                    onChange={(event) => setOrderQuery(event.target.value)}
                  />
                </label>
                <button type="button" className="ghost-button orders-filter-btn">Filtros</button>
                <button type="button" className="ghost-button orders-range-btn">Todo el periodo</button>
                <button type="button" className="link-button orders-export-btn">Exportar</button>
              </header>

              <div className="orders-status-tabs">
                <button type="button" className={orderFilter === 'all' ? 'active' : ''} onClick={() => setOrderFilter('all')}>
                  Todas <span>{orderCounts.all}</span>
                </button>
                <button type="button" className={orderFilter === 'pending' ? 'active' : ''} onClick={() => setOrderFilter('pending')}>
                  Pendientes <span>{orderCounts.pending}</span>
                </button>
                <button type="button" className={orderFilter === 'prep' ? 'active' : ''} onClick={() => setOrderFilter('prep')}>
                  En Preparacion <span>{orderCounts.prep}</span>
                </button>
                <button type="button" className={orderFilter === 'transport' ? 'active' : ''} onClick={() => setOrderFilter('transport')}>
                  En Transporte <span>{orderCounts.transport}</span>
                </button>
                <button type="button" className={orderFilter === 'completed' ? 'active' : ''} onClick={() => setOrderFilter('completed')}>
                  Completadas <span>{orderCounts.completed}</span>
                </button>
                <button type="button" className={orderFilter === 'cancelled' ? 'active' : ''} onClick={() => setOrderFilter('cancelled')}>
                  Anuladas <span>{orderCounts.cancelled}</span>
                </button>
              </div>
            </div>

            <div className="orders-table-wrap">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th>Cliente y evento</th>
                    <th>Responsable</th>
                    <th>Servicio</th>
                    <th>Estado</th>
                    <th>Progreso</th>
                    <th>Debe</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((row) => (
                    <tr key={row.id} className={`orders-row ${row.status}`}>
                      <td>
                        <div className="orders-cell-main">
                          <strong>{row.orderCode}</strong>
                          <span>Creada: {formatDateTime(row.createdAt)}</span>
                          <span className={`orders-contract-mini ${row.contractClassName}`}>{row.contractLabel}</span>
                        </div>
                      </td>
                      <td>
                        <div className="orders-cell-main">
                          <strong>{row.client}</strong>
                          <span>{row.clientMeta}</span>
                          <span>{row.event} | {row.eventMeta}</span>
                        </div>
                      </td>
                      <td>
                        <div className="orders-responsible-cell">
                          <span>{String(row.responsibleName ?? 'Sistema').slice(0, 2).toUpperCase()}</span>
                          <div>
                            <strong>{row.responsibleName}</strong>
                            <small>{row.responsibleRole}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="orders-cell-main orders-service-cell">
                          <strong>{formatDate(row.serviceDate)} | {row.serviceTime}</strong>
                          <span>Entrega: {formatDate(row.deliveryAt)}</span>
                          <span>{row.deliveryMeta}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`orders-status-badge ${ORDER_STATUS_META[row.status].className}`}>
                          {ORDER_STATUS_META[row.status].label}
                        </span>
                        {row.status === 'closed_pending' ? (
                          <small className="orders-accounting-note">Saldo: {formatBs(row.pendingCollectionBs)}</small>
                        ) : null}
                        {row.status === 'charged' ? (
                          <small className="orders-accounting-note is-paid">Caja confirmo el cobro</small>
                        ) : null}
                        {row.status === 'cancelled' ? (
                          <small className="orders-accounting-note">
                            Penalidad: {formatBs(row.cancellationPenaltyBs ?? 0)}
                          </small>
                        ) : null}
                      </td>
                      <td>
                        <div className="orders-progress-stack">
                          <span>
                            <small>Inv.</small>
                            <strong className={`orders-progress-dot ${OPERATIONAL_STATUS_META[row.inventoryStatus]?.className ?? 'pending'}`}>
                              {OPERATIONAL_STATUS_META[row.inventoryStatus]?.label ?? 'Pendiente'}
                            </strong>
                          </span>
                          <span>
                            <small>Trans.</small>
                            <strong className={`orders-progress-dot ${OPERATIONAL_STATUS_META[row.transportStatus]?.className ?? 'pending'}`}>
                              {OPERATIONAL_STATUS_META[row.transportStatus]?.label ?? 'Pendiente'}
                            </strong>
                          </span>
                        </div>
                      </td>
                      <td className="orders-total">{formatBs(row.totalBs)}</td>
                      <td className="orders-menu">
                        <div className="orders-row-actions">
                          <button type="button" className="orders-open-btn" onClick={() => handleOpenDocumentsPanel(row)}>
                            Abrir
                          </button>
                          <button
                            type="button"
                            className="whatsapp-bubble-button"
                            onClick={() => openWhatsAppModal('order', row)}
                            aria-label={`Contactar por WhatsApp a ${row.client}`}
                          >
                            <WhatsAppGlyph />
                          </button>
                          <button
                            type="button"
                            className="transport-row-menu-button"
                            onClick={(event) => toggleActionsMenu('order', row.id, event)}
                            aria-label={`Mas acciones para ${row.orderCode}`}
                          >
                            {'\u22ee'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <div className="orders-empty-state">
                          <span className="orders-empty-icon"><OrdersKpiIcon kind="orders" /></span>
                          <strong>No hay ordenes con esos filtros</strong>
                          <p>{readOnly ? 'Ajusta la busqueda para revisar ordenes anteriores.' : 'Ajusta la busqueda o crea una nueva orden para iniciar el flujo operativo.'}</p>
                          {!readOnly ? (
                            <button type="button" className="primary-button" onClick={() => openCreateModal('order', 'contract')}>
                              + Nueva Orden
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="orders-mobile-order-list">
              {filteredOrders.map((row) => {
                const statusMeta = ORDER_STATUS_META[row.status] ?? ORDER_STATUS_META.pending;
                const inventoryMeta = OPERATIONAL_STATUS_META[row.inventoryStatus] ?? OPERATIONAL_STATUS_META.pendiente;
                const transportMeta = OPERATIONAL_STATUS_META[row.transportStatus] ?? OPERATIONAL_STATUS_META.pendiente;
                return (
                  <article key={row.id} className={`orders-mobile-order-card ${row.status}`}>
                    <header>
                      <div>
                        <span>Orden de servicio</span>
                        <strong>{row.orderCode}</strong>
                      </div>
                      <span className={`orders-status-badge ${statusMeta.className}`}>{statusMeta.label}</span>
                    </header>
                    <div className="orders-mobile-order-client">
                      <strong>{row.client}</strong>
                      <span>{row.event} · {row.eventMeta}</span>
                    </div>
                    <div className="orders-mobile-order-service">
                      <span>
                        <small>Servicio</small>
                        <strong>{formatDate(row.serviceDate)}</strong>
                      </span>
                      <span>
                        <small>Entrega</small>
                        <strong>{formatDate(row.deliveryAt)}</strong>
                      </span>
                      <span>
                        <small>Total</small>
                        <strong>{formatBs(row.totalBs)}</strong>
                      </span>
                    </div>
                    <div className="orders-mobile-order-progress">
                      <span>
                        <small>Inventario</small>
                        <strong className={inventoryMeta.className}>{inventoryMeta.label}</strong>
                      </span>
                      <span>
                        <small>Transporte</small>
                        <strong className={transportMeta.className}>{transportMeta.label}</strong>
                      </span>
                    </div>
                    <footer>
                      <div className="orders-responsible-cell">
                        <span>{String(row.responsibleName ?? 'Sistema').slice(0, 2).toUpperCase()}</span>
                        <div>
                          <strong>{row.responsibleName}</strong>
                          <small>{row.responsibleRole}</small>
                        </div>
                      </div>
                      <div className="orders-row-actions">
                        <button type="button" className="orders-open-btn" onClick={() => handleOpenDocumentsPanel(row)}>
                          Abrir
                        </button>
                        <button
                          type="button"
                          className="whatsapp-bubble-button"
                          onClick={() => openWhatsAppModal('order', row)}
                          aria-label={`Contactar por WhatsApp a ${row.client}`}
                        >
                          <WhatsAppGlyph />
                        </button>
                        <button
                          type="button"
                          className="transport-row-menu-button"
                          onClick={(event) => toggleActionsMenu('order', row.id, event)}
                          aria-label={`Mas acciones para ${row.orderCode}`}
                        >
                          {'\u22ee'}
                        </button>
                      </div>
                    </footer>
                  </article>
                );
              })}
              {filteredOrders.length === 0 ? (
                <div className="orders-empty-state">
                  <span className="orders-empty-icon"><OrdersKpiIcon kind="orders" /></span>
                  <strong>No hay ordenes con esos filtros</strong>
                  <p>Ajusta la busqueda o crea una nueva orden para iniciar el flujo operativo.</p>
                </div>
              ) : null}
            </div>

            <footer className="orders-footer">
              <span>Mostrando {filteredOrders.length} de {orderRowsWithMeta.length} ordenes</span>
            </footer>
          </>
        ) : activeView === 'quotes' ? (
          <>
            <div className="orders-filter-panel">
              <header className="orders-toolbar">
                <label className="orders-search">
                  <input
                    type="search"
                    placeholder="Buscar por numero de cotizacion, cliente o evento..."
                    value={quoteQuery}
                    onChange={(event) => setQuoteQuery(event.target.value)}
                  />
                </label>
                <select className="orders-select" value={quoteFilter} onChange={(event) => setQuoteFilter(event.target.value)}>
                  <option value="all">Estado: Todos</option>
                  <option value="borrador">Borrador</option>
                  <option value="enviada">Enviada</option>
                  <option value="aprobada">Aprobada</option>
                  <option value="rechazada">Rechazada</option>
                  <option value="vencida">Vencida</option>
                </select>
                <button type="button" className="ghost-button orders-range-btn">Todo el periodo</button>
                <button type="button" className="link-button orders-export-btn">Exportar</button>
              </header>

              <div className="orders-status-tabs">
                <button type="button" className={quoteFilter === 'all' ? 'active' : ''} onClick={() => setQuoteFilter('all')}>
                  Todas <span>{quoteCounts.all}</span>
                </button>
                <button type="button" className={quoteFilter === 'borrador' ? 'active' : ''} onClick={() => setQuoteFilter('borrador')}>
                  Borrador <span>{quoteCounts.borrador}</span>
                </button>
                <button type="button" className={quoteFilter === 'enviada' ? 'active' : ''} onClick={() => setQuoteFilter('enviada')}>
                  Enviada <span>{quoteCounts.enviada}</span>
                </button>
                <button type="button" className={quoteFilter === 'aprobada' ? 'active' : ''} onClick={() => setQuoteFilter('aprobada')}>
                  Aprobada <span>{quoteCounts.aprobada}</span>
                </button>
                <button type="button" className={quoteFilter === 'rechazada' ? 'active' : ''} onClick={() => setQuoteFilter('rechazada')}>
                  Rechazada <span>{quoteCounts.rechazada}</span>
                </button>
              </div>
            </div>

            <div className="orders-table-wrap orders-commercial-table-wrap">
              <table className="orders-table orders-commercial-table">
                <thead>
                  <tr>
                    <th>Cotizacion</th>
                    <th>Cliente</th>
                    <th>Evento</th>
                    <th>Responsable</th>
                    <th>Entrega / Recojo</th>
                    <th>Estado</th>
                    <th>Total</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotes.map((row) => {
                    const statusMeta = QUOTE_STATUS_META[row.status] ?? QUOTE_STATUS_META.borrador;
                    return (
                      <tr key={row.id} className={`orders-row quote-${row.status}`}>
                        <td>
                          <div className="orders-cell-main">
                            <strong>{row.quoteCode}</strong>
                            <span>{row.itemsCount} items | {BILLING_MODE_META[row.billingMode] ?? 'Sin factura'} | {formatDateTime(row.createdAt)}</span>
                          </div>
                        </td>
                        <td>
                          <div className="orders-cell-main">
                            <strong>{row.customerName}</strong>
                            <span>{row.customerPhone || 'Sin WhatsApp/celular'}</span>
                            {row.customerReferencePhone ? <span>Ref: {row.customerReferencePhone}</span> : null}
                          </div>
                        </td>
                        <td>
                          <div className="orders-cell-main">
                            <strong>{row.eventType || 'Evento general'}</strong>
                            <span>{formatDate(row.eventDate)} {row.eventTime || ''}</span>
                          </div>
                        </td>
                        <td>
                          <div className="orders-responsible-cell">
                            <span>{String(row.responsibleName ?? 'Sistema').slice(0, 2).toUpperCase()}</span>
                            <div>
                              <strong>{row.responsibleName}</strong>
                              <small>{row.responsibleRole}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="orders-cell-main">
                            <strong>{formatDate(row.deliveryDate)} / {formatDate(row.pickupDate)}</strong>
                            <span>{row.address || 'Direccion pendiente'}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`orders-status-badge quote-${statusMeta.className}`}>{statusMeta.label}</span>
                        </td>
                        <td className="orders-total">{formatBs(row.totalBs)}</td>
                        <td className="orders-menu">
                          <div className="orders-row-actions">
                            <button type="button" className="orders-open-btn" onClick={() => handleOpenQuoteDocument(row)}>
                              Abrir
                            </button>
                            <button
                              type="button"
                              className="whatsapp-bubble-button"
                              onClick={() => openWhatsAppModal('quote', row)}
                              aria-label={`Enviar cotizacion ${row.quoteCode} por WhatsApp`}
                            >
                              <WhatsAppGlyph />
                            </button>
                            <button
                              type="button"
                              className="transport-row-menu-button"
                              onClick={(event) => toggleActionsMenu('quote', row.id, event)}
                              aria-label={`Mas acciones para ${row.quoteCode}`}
                            >
                              {'\u22ee'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredQuotes.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <div className="orders-empty-state">
                          <span className="orders-empty-icon"><OrdersKpiIcon kind="quote" /></span>
                          <strong>No hay cotizaciones con esos filtros</strong>
                          <p>{readOnly ? 'Limpia los filtros para revisar propuestas anteriores.' : 'Crea una cotizacion o limpia los filtros para revisar propuestas anteriores.'}</p>
                          {!readOnly ? (
                            <button type="button" className="primary-button" onClick={() => openCreateModal('quote')}>
                              + Cotizacion
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {isMobileCommercialLayout ? (
              <div className="orders-mobile-commercial-list">
                {filteredQuotes.map((row) => {
                  const statusMeta = QUOTE_STATUS_META[row.status] ?? QUOTE_STATUS_META.borrador;
                  return (
                    <article key={row.id} className={`orders-mobile-contract-card quote-${row.status}`}>
                      <header>
                        <strong>{row.quoteCode}</strong>
                        <span className={`orders-status-badge quote-${statusMeta.className}`}>{statusMeta.label}</span>
                        <b>{formatBs(row.totalBs)}</b>
                      </header>
                      <div className="orders-mobile-contract-main">
                        <p><span>Cliente:</span> <strong>{row.customerName}</strong></p>
                        <p><span>Evento:</span> <strong>{row.eventType || 'Evento general'}</strong></p>
                      </div>
                      <div className="orders-mobile-contract-meta">
                        <span className="orders-mobile-date-line">Fecha: {formatDate(row.deliveryDate)} - {formatDate(row.pickupDate)}</span>
                        <span>{LOGISTICS_MODE_META[row.logisticsMode] ?? 'Entrega / recojo'}</span>
                      </div>
                      <div className="orders-mobile-contract-bottom">
                        <div className="orders-responsible-cell">
                          <span>{String(row.responsibleName ?? 'Sistema').slice(0, 2).toUpperCase()}</span>
                          <div>
                            <strong>{row.responsibleName}</strong>
                            <small>{row.responsibleRole}</small>
                          </div>
                        </div>
                        <div className="orders-row-actions">
                          <button type="button" className="orders-open-btn" onClick={() => handleOpenQuoteDocument(row)}>
                            Abrir
                          </button>
                          <button
                            type="button"
                            className="whatsapp-bubble-button"
                            onClick={() => openWhatsAppModal('quote', row)}
                            aria-label={`Enviar cotizacion ${row.quoteCode} por WhatsApp`}
                          >
                            <WhatsAppGlyph />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
                {filteredQuotes.length === 0 ? (
                  <div className="orders-empty-state">
                    <span className="orders-empty-icon"><OrdersKpiIcon kind="quote" /></span>
                    <strong>No hay cotizaciones con esos filtros</strong>
                    <p>Crea una cotizacion o limpia los filtros para revisar propuestas anteriores.</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <footer className="orders-footer">
              <span>Mostrando {filteredQuotes.length} de {quoteRows.length} cotizaciones</span>
            </footer>
          </>
        ) : (
          <>
            <div className="orders-filter-panel">
              <header className="orders-toolbar">
                <label className="orders-search">
                  <input
                    ref={contractSearchInputRef}
                    type="search"
                    placeholder="Buscar por numero, cliente, orden o responsable..."
                    defaultValue={contractQuery}
                    onChange={handleContractSearchChange}
                  />
                </label>
                <div className="orders-date-range-filter" aria-label="Rango de fecha del evento">
                  <label>
                    <span>Desde</span>
                    <input type="date" value={contractDateFrom} onChange={(event) => setContractDateFrom(event.target.value)} />
                  </label>
                  <label>
                    <span>Hasta</span>
                    <input type="date" value={contractDateTo} onChange={(event) => setContractDateTo(event.target.value)} />
                  </label>
                  {(contractDateFrom || contractDateTo) ? (
                    <button type="button" className="link-button" onClick={() => { setContractDateFrom(''); setContractDateTo(''); }}>
                      Limpiar
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={openOrdersRangeReport}
                  style={{ minWidth: '118px', whiteSpace: 'nowrap' }}
                >
                  Generar reporte
                </button>
              </header>

              <div className="orders-status-tabs">
                <button type="button" className={contractFilter === 'all' ? 'active' : ''} onClick={() => setContractFilter('all')}>
                  Todas <span>{visibleContractCounts.all}</span>
                </button>
                <button type="button" className={contractFilter === 'borrador' ? 'active' : ''} onClick={() => setContractFilter('borrador')}>
                  Borrador <span>{visibleContractCounts.borrador}</span>
                </button>
                <button type="button" className={contractFilter === 'pendiente' ? 'active' : ''} onClick={() => setContractFilter('pendiente')}>
                  Pendiente <span>{visibleContractCounts.pendiente}</span>
                </button>
                <button type="button" className={contractFilter === 'aprobado' ? 'active' : ''} onClick={() => setContractFilter('aprobado')}>
                  Aprobado <span>{visibleContractCounts.aprobado}</span>
                </button>
                <button type="button" className={contractFilter === 'rechazado' ? 'active' : ''} onClick={() => setContractFilter('rechazado')}>
                  Rechazado <span>{visibleContractCounts.rechazado}</span>
                </button>
                <button type="button" className={contractFilter === 'anulado' ? 'active' : ''} onClick={() => setContractFilter('anulado')}>
                  Anulado <span>{visibleContractCounts.anulado}</span>
                </button>
                {canViewHiddenContracts ? (
                  <button type="button" className={contractFilter === 'oculto' ? 'active' : ''} onClick={() => setContractFilter('oculto')}>
                    Oculto <span>{visibleContractCounts.oculto}</span>
                  </button>
                ) : null}
                <div className="orders-contract-legend" aria-label="Leyenda operativa de contratos">
                  <span><i className="sent" /> Enviado</span>
                  <span><i className="returned" /> Volvió / devuelto</span>
                  <span><i style={{ background: '#f59e0b' }} /> Volvió parcial / material con cliente</span>
                </div>
              </div>
            </div>

            <div className="orders-table-wrap orders-commercial-table-wrap" style={{ overflowX: 'hidden' }}>
              <table
                className="orders-table orders-commercial-table orders-contracts-table"
                style={{ width: '100%', minWidth: 0, tableLayout: 'fixed' }}
              >
                <colgroup>
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '5%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th><div className="orders-column-heading"><span>Contrato</span><OrdersColumnFilterButton column="contract" label="Contrato" active={contractSort.key === 'contract'} onOpen={openContractColumnMenu} /></div></th>
                    <th><div className="orders-column-heading"><span>Fecha evento</span><OrdersColumnFilterButton column="date" label="Fecha evento" active={contractSort.key === 'date'} onOpen={openContractColumnMenu} /></div></th>
                    <th><div className="orders-column-heading"><span>Cliente</span><OrdersColumnFilterButton column="client" label="Cliente" active={contractSort.key === 'client'} onOpen={openContractColumnMenu} /></div></th>
                    <th>Responsable</th>
                    <th>Servicio</th>
                    <th><div className="orders-column-heading"><span>Daños y faltantes</span><OrdersColumnFilterButton column="damage" label="Daños y faltantes" active={contractColumnFilters.damage !== 'all'} onOpen={openContractColumnMenu} /></div></th>
                    <th><div className="orders-column-heading"><span>Nota</span><OrdersColumnFilterButton column="notes" label="Nota" active={contractColumnFilters.notes !== 'all'} onOpen={openContractColumnMenu} /></div></th>
                    <th>Estado</th>
                    <th><div className="orders-column-heading"><span>Garantía</span><OrdersColumnFilterButton column="guarantee" label="Garantía" active={contractColumnFilters.guarantee !== 'all'} onOpen={openContractColumnMenu} /></div></th>
                    <th><div className="orders-column-heading"><span>Debe</span><OrdersColumnFilterButton column="payment" label="Debe" active={contractColumnFilters.payment !== 'all'} onOpen={openContractColumnMenu} /></div></th>
                    <th><div className="orders-column-heading"><span>Finalizado</span><OrdersColumnFilterButton column="finalized" label="Finalizado" active={contractColumnFilters.finalized !== 'all'} onOpen={openContractColumnMenu} /></div></th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleContractsForRender.map((row) => {
                    const statusMeta = CONTRACT_STATUS_META[row.status] ?? CONTRACT_STATUS_META.borrador;
                    const economicInternalNotes = getVisibleEconomicNotes(row);
                    const isCancelledRow = row.status === 'anulado';
                    const showSentStyle = !isCancelledRow && row.isSent;
                    const showReturnedStyle = !isCancelledRow && row.isReturned;
                    const isRowFinalized = finalizedContractOverrides.has(row.id)
                      ? finalizedContractOverrides.get(row.id)
                      : Boolean(row.isFinalized);
                    const showFinalizedStyle = !isCancelledRow && isRowFinalized;
                    return (
                      <tr key={row.id} className={`orders-row contract-${row.status}${showSentStyle ? ' is-sent' : ''}${showReturnedStyle ? ' is-returned' : ''}${showFinalizedStyle ? ' is-finalized' : ''}`}>
                        <td className={showSentStyle ? 'orders-contract-sent-cell' : ''}>
                          <div className="orders-cell-main">
                            <strong className="orders-contract-code">{row.contractCode}</strong>
                          </div>
                        </td>
                        <td className={showSentStyle ? 'orders-contract-sent-cell' : ''}>
                          <div className="orders-cell-main">
                            <strong>{formatDate(row.eventDate)}</strong>
                            <span>{formatLongSpanishDate(row.eventDate)}</span>
                          </div>
                        </td>
                        <td className={showSentStyle ? 'orders-contract-sent-cell' : ''}>
                          <div className="orders-cell-main">
                            <strong>{row.customerName}</strong>
                            <span>{row.customerPhone || 'Sin WhatsApp/celular'}</span>
                            {row.customerReferencePhone ? <span>Ref: {row.customerReferencePhone}</span> : null}
                          </div>
                        </td>
                        <td className={showReturnedStyle ? 'orders-contract-returned-cell' : ''}>
                          <div className="orders-responsible-cell">
                            <span>{String(row.responsibleName ?? 'Sistema').slice(0, 2).toUpperCase()}</span>
                            <div>
                              <strong>{row.responsibleName}</strong>
                              <small>{row.responsibleRole}</small>
                            </div>
                          </div>
                        </td>
                        <td className={showReturnedStyle ? 'orders-contract-returned-cell' : ''}>
                          <div className="orders-cell-main">
                            {normalizeText(row.logisticsMode) === 'recojo' ? (
                              <>
                                <strong>Recojo por cliente</strong>
                                <span>Cliente retira y devuelve</span>
                              </>
                            ) : (
                              <>
                                <strong>{row.address || 'Sin direccion registrada'}</strong>
                                <span>Envio por mi equipo</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className={showReturnedStyle ? 'orders-contract-returned-cell' : ''}>
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 32 }}>
                            {row.damageStatus === 'none' ? (
                              <span style={{ color: '#64748b', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>NO TIENE</span>
                            ) : row.damageStatus === 'paid' ? (
                              <span
                                title={`Daños/faltantes: ${formatBs(row.damageChargeBs)} · Recuperado: ${formatBs(row.damageChargeBs)}`}
                                style={{ color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 999, padding: '4px 8px', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap' }}
                              >
                                PAGADO
                              </span>
                            ) : (
                              <span
                                title={`Cargo total: ${formatBs(row.damageChargeBs)} · Pendiente: ${formatBs(row.damagePendingBs)}`}
                                style={{ color: '#b45309', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 999, padding: '4px 8px', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap' }}
                              >
                                {formatBs(row.damagePendingBs)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`orders-economic-note-cell ${row.isReturned ? 'orders-contract-returned-cell' : ''}`}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 30 }}>
                            {economicInternalNotes.length > 0 ? (
                              <button
                                type="button"
                                className="orders-economic-note-bubble"
                                onClick={() => openContractEconomicNoteEditor(row)}
                                title="Ver nota interna economica"
                                aria-label={`Ver nota interna economica del contrato ${row.contractCode}`}
                              >
                                <MessageCircle aria-hidden="true" />
                                <span>{economicInternalNotes.length}</span>
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => openContractEconomicNoteEditor(row)}
                              disabled={readOnly}
                              title="Agregar nueva nota"
                              aria-label={`Agregar nueva nota al contrato ${row.contractCode}`}
                              style={{
                                width: 29,
                                height: 29,
                                minWidth: 29,
                                padding: 0,
                                borderRadius: 8,
                                border: '1px solid rgba(234, 88, 12, 0.32)',
                                background: '#ffffff',
                                color: '#c2410c',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: readOnly ? 'not-allowed' : 'pointer',
                                opacity: readOnly ? 0.55 : 1,
                                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
                              }}
                            >
                              <MessageSquarePlus aria-hidden="true" size={14} />
                            </button>
                          </div>
                        </td>
                        <td className={showReturnedStyle ? 'orders-contract-returned-cell' : ''}>
                          <div className="orders-hidden-status-cell">
                            <span className={`orders-status-badge contract-${statusMeta.className}`}>{statusMeta.label}</span>
                            {row.hasClientPending ? (
                              <button
                                type="button"
                                onClick={() => setClientPendingDetail(row)}
                                title="Ver material que todavía está con el cliente"
                                aria-label={`Ver ${row.clientPendingUnits} unidad(es) con cliente del contrato ${row.contractCode}`}
                                style={{
                                  color: '#b45309',
                                  background: '#fff7ed',
                                  border: '1px solid #f5c26b',
                                  borderRadius: 999,
                                  padding: '3px 7px',
                                  fontWeight: 850,
                                  fontSize: 11,
                                  lineHeight: 1.2,
                                  cursor: 'pointer',
                                }}
                              >
                                {row.clientPendingUnits} con cliente
                              </button>
                            ) : null}
                            {row.status === 'oculto' ? (
                              <small>
                                Eliminado por {row.deletedByName || 'Sistema'}
                              </small>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div className={`orders-guarantee-cell ${row.guaranteeBs > 0 ? 'has-guarantee' : 'empty'}`}>
                            <strong>{row.guaranteePrimary}</strong>
                            <span className={`orders-guarantee-state ${row.guaranteeStatus}`}>{row.guaranteeSecondary}</span>
                          </div>
                        </td>
                        <td className={`orders-total ${row.dueBs <= 0 ? 'is-paid' : 'is-due'}`}>
                          <span className="orders-total-with-economics">
                            {row.dueBs <= 0 ? 'Pagado' : formatBs(row.dueBs)}
                            {row.hasEconomicLedger ? (
                              <i title="Seguimiento economico iniciado" aria-label="Seguimiento economico iniciado" />
                            ) : null}
                          </span>
                        </td>
                        <td className="orders-finalized-cell">
                          <button
                            type="button"
                            className={`orders-finalized-check ${isRowFinalized ? 'is-checked' : ''}`}
                            onClick={() => handleToggleContractFinalized(row, !isRowFinalized)}
                            disabled={finalizingContractIds.has(row.id) || row.status === 'oculto'}
                            title={isRowFinalized ? 'Contrato finalizado' : 'Marcar contrato finalizado'}
                            aria-pressed={isRowFinalized}
                            aria-label={`${isRowFinalized ? 'Desmarcar' : 'Marcar'} finalizado contrato ${row.contractCode}`}
                          >
                            {isRowFinalized ? <Check aria-hidden="true" /> : 'F'}
                          </button>
                        </td>
                        <td className="orders-menu">
                          <div className="orders-row-actions">
                            <button type="button" className="orders-open-btn" onClick={() => handleOpenDocumentsFromContract(row)}>
                              Abrir
                            </button>
                            <button
                              type="button"
                              className="transport-row-menu-button"
                              onClick={(event) => toggleActionsMenu('contract', row.id, event)}
                              aria-label={`Mas acciones para ${row.contractCode}`}
                            >
                              {'\u22ee'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredContracts.length === 0 ? (
                    <tr>
                      <td colSpan={12}>
                        <div className="orders-empty-state">
                          <span className="orders-empty-icon"><OrdersKpiIcon kind="contract" /></span>
                          <strong>No hay contratos con esos filtros</strong>
                          <p>Los contratos apareceran aqui cuando una cotizacion sea aprobada o registres un contrato manual.</p>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {contractColumnMenu && activeContractColumnMenu ? (
              <div
                className="orders-column-filter-popover"
                style={{ top: contractColumnMenu.top, left: contractColumnMenu.left }}
                role="menu"
                aria-label={activeContractColumnMenu.label}
              >
                <header>
                  <Filter aria-hidden="true" />
                  <strong>{activeContractColumnMenu.label}</strong>
                </header>
                <div className="orders-column-filter-options">
                  {activeContractColumnMenu.options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={activeContractColumnValue === option.value ? 'is-selected' : ''}
                      onClick={() => selectContractColumnOption(contractColumnMenu.key, option.value)}
                      role="menuitemradio"
                      aria-checked={activeContractColumnValue === option.value}
                    >
                      <span>{option.label}</span>
                      {activeContractColumnValue === option.value ? <Check aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
                {(activeContractColumnMenu.type === 'sort' ? activeContractColumnValue : activeContractColumnValue !== 'all') ? (
                  <button
                    type="button"
                    className="orders-column-filter-clear"
                    onClick={() => clearContractColumnControl(contractColumnMenu.key)}
                  >
                    Quitar filtro
                  </button>
                ) : null}
              </div>
            ) : null}

            {isMobileCommercialLayout ? (
              <div className="orders-mobile-commercial-list">
              {visibleContractsForRender.map((row) => {
                const statusMeta = CONTRACT_STATUS_META[row.status] ?? CONTRACT_STATUS_META.borrador;
                const transportMeta = getContractTransportLabel(row);
                const economicInternalNotes = getVisibleEconomicNotes(row);
                const isCancelledRow = row.status === 'anulado';
                const showSentStyle = !isCancelledRow && row.isSent;
                const showReturnedStyle = !isCancelledRow && row.isReturned;
                const isRowFinalized = finalizedContractOverrides.has(row.id)
                  ? finalizedContractOverrides.get(row.id)
                  : Boolean(row.isFinalized);
                const showFinalizedStyle = !isCancelledRow && isRowFinalized;
                const serviceDateLabel = [row.deliveryDate, row.pickupDate].filter(Boolean).map(formatDate).join(' - ') || formatDate(row.eventDate);
                const serviceAddressLabel = normalizeText(row.logisticsMode) === 'recojo'
                  ? 'Recojo por cliente'
                  : row.address || 'Sin direccion registrada';
                const serviceAddressDetail = normalizeText(row.logisticsMode) === 'recojo'
                  ? 'Cliente retira y devuelve'
                  : 'Envio por mi equipo';
                return (
                  <article key={row.id} className={`orders-mobile-contract-card contract-${row.status}${showSentStyle ? ' is-sent' : ''}${showReturnedStyle ? ' is-returned' : ''}${showFinalizedStyle ? ' is-finalized' : ''}`}>
                    <header>
                      <div className={showSentStyle ? 'orders-mobile-sent-zone' : ''}>
                        <strong>{row.contractCode}</strong>
                        <span>{formatLongSpanishDate(row.eventDate)}</span>
                      </div>
                      <span className={`orders-status-badge contract-${statusMeta.className}`}>{statusMeta.label}</span>
                      <div className="orders-mobile-contract-money">
                        <small>Debe</small>
                        <b className={`orders-total-with-economics ${row.dueBs <= 0 ? 'is-paid' : 'is-due'}`}>
                          {row.dueBs <= 0 ? 'Pagado' : formatBs(row.dueBs)}
                          {row.hasEconomicLedger ? (
                            <i title="Seguimiento economico iniciado" aria-label="Seguimiento economico iniciado" />
                          ) : null}
                        </b>
                      </div>
                    </header>
                    <div className={`orders-mobile-contract-main ${showSentStyle ? 'orders-mobile-sent-zone' : ''}`}>
                      <p><span>Cliente:</span> <strong>{row.customerName}</strong></p>
                      <p><span>Celular:</span> <strong>{row.customerPhone || 'Sin WhatsApp/celular'}</strong></p>
                      {row.customerReferencePhone ? <p><span>Ref:</span> <strong>{row.customerReferencePhone}</strong></p> : null}
                    </div>
                    <div className={`orders-mobile-contract-bottom ${showReturnedStyle ? 'orders-mobile-returned-zone' : ''}`}>
                      <div className="orders-responsible-cell">
                        <span>{String(row.responsibleName ?? 'Sistema').slice(0, 2).toUpperCase()}</span>
                        <div>
                          <strong>{row.responsibleName}</strong>
                          <small>{row.responsibleRole}</small>
                        </div>
                      </div>
                      <div className="orders-mobile-contract-order">
                        <span>Orden:</span>
                        <strong>{row.orderCode || '-'}</strong>
                      </div>
                    </div>
                    <div className={`orders-mobile-contract-meta ${showReturnedStyle ? 'orders-mobile-returned-zone' : ''}`}>
                      <span className="orders-mobile-date-line">Servicio: {serviceDateLabel}</span>
                      <span>Entrega / recojo</span>
                    </div>
                    <div className="orders-mobile-contract-details">
                      <div className="orders-mobile-contract-service">
                        <CalendarDays aria-hidden="true" />
                        <span>
                          <small>Servicio</small>
                          <strong>{serviceDateLabel}</strong>
                          <em>Entrega / recojo</em>
                        </span>
                      </div>
                      <div className={`orders-mobile-contract-address ${showReturnedStyle ? 'orders-mobile-returned-zone' : ''}`}>
                        <MapPin aria-hidden="true" />
                        <span>
                          <small>Direccion</small>
                          <strong>{serviceAddressLabel}</strong>
                          <em>{serviceAddressDetail}</em>
                        </span>
                      </div>
                      <div className={`orders-guarantee-cell ${row.guaranteeBs > 0 ? 'has-guarantee' : 'empty'}`}>
                        <Check aria-hidden="true" />
                        <small>Garantía</small>
                        <strong>{row.guaranteePrimary}</strong>
                        <span className={`orders-guarantee-state ${row.guaranteeStatus}`}>{row.guaranteeSecondary}</span>
                      </div>
                      <div className="orders-transport-cell">
                        <Truck aria-hidden="true" />
                        <small>Transporte</small>
                        <strong>{transportMeta.title}</strong>
                        <span>{transportMeta.detail}</span>
                      </div>
                    </div>
                    <div className="orders-mobile-contract-actions">
                      <button type="button" className="orders-open-btn" onClick={() => handleOpenDocumentsFromContract(row)}>
                        Abrir
                      </button>
                      <button
                        type="button"
                        className="orders-economic-note-mobile-button"
                        onClick={() => openContractEconomicNoteEditor(row)}
                        disabled={readOnly}
                      >
                        <MessageSquarePlus aria-hidden="true" />
                        {economicInternalNotes.length > 0
                          ? `Notas (${economicInternalNotes.length})`
                          : 'Agregar nota'}
                      </button>
                      <button
                        type="button"
                        className={`orders-finalized-check ${isRowFinalized ? 'is-checked' : ''}`}
                        onClick={() => handleToggleContractFinalized(row, !isRowFinalized)}
                        disabled={finalizingContractIds.has(row.id) || row.status === 'oculto'}
                        title={isRowFinalized ? 'Contrato finalizado' : 'Marcar contrato finalizado'}
                        aria-pressed={isRowFinalized}
                        aria-label={`${isRowFinalized ? 'Desmarcar' : 'Marcar'} finalizado contrato ${row.contractCode}`}
                      >
                        {isRowFinalized ? <Check aria-hidden="true" /> : 'F'}
                      </button>
                      <button
                        type="button"
                        className="whatsapp-bubble-button"
                        onClick={() => openWhatsAppModal('contract', row)}
                        aria-label={`Enviar contrato ${row.contractCode} por WhatsApp`}
                      >
                        <WhatsAppGlyph />
                      </button>
                      <button
                        type="button"
                        className="transport-row-menu-button"
                        onClick={(event) => toggleActionsMenu('contract', row.id, event)}
                        aria-label={`Mas acciones para ${row.contractCode}`}
                      >
                        {'\u22ee'}
                      </button>
                    </div>
                  </article>
                );
              })}
              {filteredContracts.length === 0 ? (
                <div className="orders-empty-state">
                  <span className="orders-empty-icon"><OrdersKpiIcon kind="contract" /></span>
                  <strong>No hay contratos con esos filtros</strong>
                  <p>Los contratos apareceran aqui cuando una cotizacion sea aprobada o registres un contrato manual.</p>
                </div>
              ) : null}
              </div>
            ) : null}

            <footer className="orders-footer">
              <span>
                Mostrando {visibleContractsForRender.length} de {filteredContracts.length} contratos
                {filteredContracts.length !== searchedContracts.length ? ` (${searchedContracts.length} encontrados)` : ''}
                {contractQuery ? ` filtrados (${contractRows.length} total)` : ''}
              </span>
              {hasMoreFilteredContracts ? (
                <button
                  type="button"
                  className="orders-load-more-button"
                  onClick={() => setVisibleContractLimit((current) => current + CONTRACT_RENDER_BATCH_SIZE)}
                >
                  Mostrar {Math.min(CONTRACT_RENDER_BATCH_SIZE, filteredContracts.length - visibleContractsForRender.length)} mas
                </button>
              ) : null}
            </footer>
          </>
        )}
      </article>

      <div
        ref={menuPreviewRef}
        className="transport-row-dropdown orders-floating-menu"
        style={{ display: 'none', pointerEvents: 'none', minHeight: 52 }}
        aria-hidden="true"
      >
        <span style={{ display: 'block', padding: '12px 14px' }}>Cargando acciones...</span>
      </div>

      {menuState ? (
        <div
          ref={(node) => {
            menuRef.current = node;
            if (node && menuPreviewRef.current) menuPreviewRef.current.style.display = 'none';
          }}
          className="transport-row-dropdown orders-floating-menu"
          style={{
            left: menuState.left,
            top: menuState.top,
            transform: menuState.openUp ? 'translateY(-100%)' : 'none',
          }}
        >
          {menuState.type === 'order' && activeOrderMenuRow ? (
            <>
              {!readOnly && !activeOrderMenuRow.contractId ? (
                <button type="button" onClick={() => handleCreateContractFromOrderClick(activeOrderMenuRow)}>
                  Generar contrato
                </button>
              ) : null}
              <button type="button" onClick={() => handleOpenDocumentsPanel(activeOrderMenuRow)}>
                Ver documentos
              </button>
              <button type="button" onClick={() => openWhatsAppModal('order', activeOrderMenuRow)}>
                Contactar por WhatsApp
              </button>
              {!readOnly ? (
                <button type="button" onClick={() => handleOpenOperationalPanel(activeOrderMenuRow)}>
                  Revisar orden operativa
                </button>
              ) : null}
              {canAccessTransport ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuState(null);
                    onOpenTransportModule?.();
                  }}
                >
                  Ver en transporte
                </button>
              ) : null}
              {canAccessInventory ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuState(null);
                    onOpenInventoryModule?.();
                  }}
                >
                  Ver en inventario
                </button>
              ) : null}
              <button type="button" onClick={handleOpenReportsClick}>
                Ver en reportes
              </button>
              {!readOnly ? (
                <button
                  type="button"
                  className="danger"
                  onClick={() => handleCancelOrderClick(activeOrderMenuRow)}
                  disabled={activeOrderMenuRow.status === 'cancelled'}
                >
                  {activeOrderMenuRow.status === 'cancelled' ? 'Contrato anulado' : 'Anular contrato'}
                </button>
              ) : null}
            </>
          ) : null}

          {menuState.type === 'quote' && activeQuoteMenuRow ? (
            <>
              {!readOnly ? (
                <button type="button" onClick={() => handleEditQuoteClick(activeQuoteMenuRow)}>
                  Editar cotizacion
                </button>
              ) : null}
              <button type="button" onClick={() => openWhatsAppModal('quote', activeQuoteMenuRow)}>
                Enviar por WhatsApp
              </button>
              {!readOnly ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleApproveQuoteClick(activeQuoteMenuRow)}
                    disabled={activeQuoteHasContract}
                  >
                    {activeQuoteHasContract ? 'Contrato ya generado' : 'Aprobar y crear contrato'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRejectQuoteClick(activeQuoteMenuRow)}
                    disabled={activeQuoteMenuRow.status === 'rechazada'}
                  >
                    Marcar rechazada
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuState(null);
                      openCreateModal('quote', 'quote', {
                        ...activeQuoteMenuRow,
                        id: '',
                        status: 'borrador',
                      });
                    }}
                  >
                    Duplicar cotizacion
                  </button>
                  <button type="button" className="danger" onClick={() => handleDeleteQuoteClick(activeQuoteMenuRow)}>
                    Eliminar cotizacion
                  </button>
                </>
              ) : null}
            </>
          ) : null}

          {menuState.type === 'contract' && activeContractMenuRow ? (
            activeContractMenuRow.status === 'anulado' ? (
              <>
                <button
                  type="button"
                  onClick={() => handleOpenDocumentsFromContract(activeContractMenuRow)}
                >
                  Previsualizar contrato PDF
                </button>
                {canRemoveCancelledContract ? (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handleDeleteContractClick(activeContractMenuRow)}
                  >
                    Eliminar
                  </button>
                ) : null}
              </>
            ) : activeContractMenuRow.status === 'oculto' ? (
              <>
                <button
                  type="button"
                  onClick={() => handleOpenDocumentsFromContract(activeContractMenuRow)}
                >
                  Abrir contrato
                </button>
                {!readOnly ? (
                  <button
                    type="button"
                    className="success"
                    onClick={() => handleRestoreContractClick(activeContractMenuRow)}
                  >
                    Restaurar
                  </button>
                ) : null}
              </>
            ) : (
              <>
                {!readOnly ? (
                  <>
                    {!['aprobado', 'anulado'].includes(activeContractMenuRow.status) ? (
                      <button
                        type="button"
                        onClick={() => handleApproveContractClick(activeContractMenuRow)}
                      >
                        Aprobar contrato
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleEditContractClick(activeContractMenuRow)}
                      disabled={activeContractMenuRow.status === 'anulado'}
                    >
                      Editar contrato
                    </button>
                  </>
                ) : null}
                <button type="button" className="economic-action" onClick={() => handleOpenContractEconomics(activeContractMenuRow)}>
                  Economico
                </button>
                <button type="button" onClick={() => openWhatsAppModal('contract', activeContractMenuRow)}>
                  Enviar por WhatsApp
                </button>
                {!readOnly ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleRejectContractClick(activeContractMenuRow)}
                      disabled={activeContractMenuRow.status === 'rechazado' || activeContractMenuRow.status === 'anulado'}
                    >
                      Marcar rechazado
                    </button>
                    {activeContractMenuRow.quoteId ? (
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handleRevertContractClick(activeContractMenuRow)}
                      >
                        Volver a cotizacion
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="danger"
                      onClick={() => handleCancelContractClick(activeContractMenuRow)}
                      disabled={activeContractMenuRow.status === 'anulado'}
                    >
                      {activeContractMenuRow.status === 'anulado' ? 'Ya anulado' : 'Anular contrato'}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleOpenDocumentsFromContract(activeContractMenuRow)}
                >
                  Abrir contrato
                </button>
                {!readOnly && !activeContractMenuRow.quoteId ? (
                  <button type="button" className="danger" onClick={() => handleDeleteContractClick(activeContractMenuRow)}>
                    Eliminar
                  </button>
                ) : null}
              </>
            )
          ) : null}
        </div>
      ) : null}

      {contractEconomicNotePreview ? (
        <div
          className="orders-modal-backdrop orders-economic-note-backdrop"
          onClick={closeContractEconomicNoteEditor}
        >
          <section
            className="orders-modal orders-economic-note-modal"
            onClick={(event) => event.stopPropagation()}
            style={{ width: 'min(650px, calc(100vw - 28px))', maxHeight: 'min(760px, calc(100vh - 28px))', overflow: 'hidden' }}
          >
            <header className="orders-modal-head">
              <div>
                <h3>Notas internas</h3>
                <p>
                  Contrato {contractEconomicNotePreview.contract?.contractCode || '-'}
                  {' | '}
                  {contractEconomicNotePreview.contract?.customerName || 'Cliente sin registrar'}
                  {' · '}
                  {contractEconomicNotePreview.notes.length} {contractEconomicNotePreview.notes.length === 1 ? 'nota' : 'notas'}
                </p>
              </div>
              <button type="button" className="orders-modal-close" onClick={closeContractEconomicNoteEditor} disabled={isSavingContractEconomicNote}>
                x
              </button>
            </header>

            <div
              className="orders-economic-note-modal-body"
              style={{ display: 'grid', gap: 14, overflowY: 'auto', padding: '14px 16px', minHeight: 0 }}
            >
              <section style={{ display: 'grid', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <strong style={{ fontSize: 15, color: '#334155' }}>Historial de notas</strong>
                  <span style={{ fontSize: 12.5, color: '#64748b' }}>
                    {contractEconomicNotePreview.notes.length
                      ? 'Las notas nuevas no reemplazan las anteriores'
                      : 'Todavía no hay notas'}
                  </span>
                </div>

                {contractEconomicNotePreview.notes.length > 0 ? (
                  <div style={{ display: 'grid', gap: 9 }}>
                    {contractEconomicNotePreview.notes.map((note, index) => (
                      <article
                        key={note.id}
                        className="orders-economic-note-card"
                        style={{
                          border: contractEconomicNoteEditingId === note.id ? '1px solid #fb923c' : '1px solid #e2e8f0',
                          borderRadius: 10,
                          padding: '10px 11px',
                          background: contractEconomicNoteEditingId === note.id ? '#fff7ed' : '#ffffff',
                          display: 'grid',
                          gap: 7,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ display: 'grid', gap: 2 }}>
                            <strong style={{ fontSize: 14, color: '#7c2d12' }}>
                              {index === 0 ? 'Más reciente · ' : ''}
                              {note.createdByName || 'Sistema'}
                            </strong>
                            <span style={{ fontSize: 12.5, color: '#64748b' }}>
                              {formatDateTime(note.createdAt)}
                              {note.editedAt ? ` · Editada ${formatDateTime(note.editedAt)}` : ''}
                            </span>
                          </div>
                          {!readOnly ? (
                            <div style={{ display: 'inline-flex', gap: 5 }}>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => startContractEconomicNoteEdit(note)}
                                disabled={isSavingContractEconomicNote}
                                title="Editar esta nota"
                                style={{ minHeight: 32, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}
                              >
                                <Pencil size={12} aria-hidden="true" />
                                Editar
                              </button>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => handleDeleteContractEconomicNote(note)}
                                disabled={isSavingContractEconomicNote}
                                title="Eliminar esta nota"
                                style={{ minHeight: 32, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#b91c1c' }}
                              >
                                <Trash2 size={12} aria-hidden="true" />
                                Eliminar
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#334155', fontSize: 14, lineHeight: 1.5 }}>
                          {note.note}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '14px 13px', borderRadius: 10, border: '1px dashed #cbd5e1', color: '#64748b', fontSize: 13.5, textAlign: 'center' }}>
                    Este contrato todavía no tiene notas internas.
                  </div>
                )}
              </section>

              {!readOnly ? (
                <section style={{ display: 'grid', gap: 8, paddingTop: 4, borderTop: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 7 }}>
                    <strong style={{ fontSize: 15, color: '#334155' }}>
                      {contractEconomicNoteEditingId ? 'Editar nota seleccionada' : '+ Nueva nota'}
                    </strong>
                    {contractEconomicNoteEditingId ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={cancelContractEconomicNoteEdit}
                        disabled={isSavingContractEconomicNote}
                        style={{ minHeight: 32, padding: '0 10px', fontSize: 12.5 }}
                      >
                        Cancelar edición
                      </button>
                    ) : null}
                  </div>
                  <textarea
                    value={contractEconomicNoteDraft}
                    onChange={(event) => setContractEconomicNoteDraft(event.target.value)}
                    rows={4}
                    maxLength={2000}
                    autoFocus
                    placeholder={contractEconomicNoteEditingId
                      ? 'Modifica únicamente esta nota...'
                      : 'Escribe una nueva nota. Las notas anteriores se conservarán...'}
                    disabled={isSavingContractEconomicNote}
                    style={{
                      width: '100%',
                      resize: 'vertical',
                      minHeight: 112,
                      maxHeight: 220,
                      border: '1px solid #cbd5e1',
                      borderRadius: 10,
                      padding: '11px 12px',
                      font: 'inherit',
                      fontSize: 14,
                      lineHeight: 1.5,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <small style={{ color: '#64748b', fontSize: 12.5 }}>{contractEconomicNoteDraft.length}/2000</small>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleSaveContractEconomicNote}
                      style={{ minHeight: 36, paddingInline: 14, fontSize: 13 }}
                      disabled={isSavingContractEconomicNote || !String(contractEconomicNoteDraft).trim()}
                    >
                      {isSavingContractEconomicNote
                        ? 'Guardando...'
                        : contractEconomicNoteEditingId
                          ? 'Guardar cambios'
                          : 'Agregar nota'}
                    </button>
                  </div>
                </section>
              ) : null}

              {contractEconomicNoteError ? (
                <div style={{ padding: '9px 11px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 12 }}>
                  {contractEconomicNoteError}
                </div>
              ) : null}
            </div>

            <footer className="orders-modal-foot">
              <button
                type="button"
                className="ghost-button"
                onClick={closeContractEconomicNoteEditor}
                disabled={isSavingContractEconomicNote}
                style={{ minHeight: 36, paddingInline: 14, fontSize: 13 }}
              >
                Cerrar
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {contractEconomicsData ? (
        <div className="orders-modal-backdrop contract-economics-backdrop" onClick={handleContractEconomicsBackdropClick}>
          <section
            className="orders-modal contract-economics-modal"
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <header className="orders-modal-head">
              <div>
                <h3>Economico contrato {contractEconomicsData.contract?.contractCode || contractEconomicsData.contract?.id}</h3>
                <p>
                  {contractEconomicsData.contract?.customerName || 'Cliente sin registrar'}
                  {' | '}
                  {contractEconomicsData.contract?.orderCode || contractEconomicsData.linkedOrder?.orderCode || 'Sin orden vinculada'}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {canManageContractEconomicLedger ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleResetContractEconomics}
                    disabled={readOnly || isResettingContractEconomics || isLoadingContractEconomics}
                    title="Limpia solamente el sector economico. No modifica movimientos operativos."
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <RefreshCw size={15} aria-hidden="true" />
                    {isResettingContractEconomics ? 'Limpiando...' : 'Reset economico'}
                  </button>
                ) : null}
                <button type="button" className="orders-modal-close" onClick={closeContractEconomics}>
                  x
                </button>
              </div>
            </header>

            <div className="contract-economics-body">
              {isLoadingContractEconomics ? (
                <p className="status">Cargando informacion economica del contrato...</p>
              ) : null}
              {contractEconomicsError ? <p className="status error">{contractEconomicsError}</p> : null}

              <div className="contract-economics-kpis">
                <article>
                  <span>Alquiler total</span>
                  <strong>{formatBs(contractEconomicsData.itemsNetSubtotalBs)}</strong>
                  <small>Items netos y ajustes</small>
                </article>
                {contractEconomicsData.itemDiscountsBs > 0 ? (
                  <article>
                    <span>Descuentos items</span>
                    <strong>- {formatBs(contractEconomicsData.itemDiscountsBs)}</strong>
                    <small>Sobre {formatBs(contractEconomicsData.itemsGrossSubtotalBs)}</small>
                  </article>
                ) : null}
                <article>
                  <span>Garantia</span>
                  <strong>{formatBs(contractEconomicsData.guaranteeDeclaredBs)}</strong>
                  <small>{contractEconomicsData.guaranteeStatus} | {contractEconomicsData.guaranteeMethod}</small>
                </article>
                <article>
                  <span>Transporte</span>
                  <strong>{formatBs(contractEconomicsData.deliveryFeeBs)}</strong>
                  <small>{contractEconomicsData.deliveryFeeBs > 0 ? 'Cargo adicional' : 'Incluido o sin cargo'}</small>
                </article>
                <article>
                  <span>Servicios</span>
                  <strong>{formatBs(contractEconomicsData.servicesBs)}</strong>
                  <small>Servicios agregados</small>
                </article>
                <article>
                  <span>Total manejado</span>
                  <strong>{formatBs(contractEconomicsData.totalManagedBs)}</strong>
                  <small>Alquiler + garantia + extras</small>
                </article>
              </div>

              <div className="contract-economics-balance-strip">
                <article>
                  <span>{contractEconomicsData.managedDebtBs > 0 ? 'A cuenta' : 'Pagado'}</span>
                  <strong>{formatBs(contractEconomicsData.paidOnAccountBs)}</strong>
                  <small>{contractEconomicsData.managedDebtBs > 0 ? 'Total recibido o abonado' : 'Cobrado con recibo'}</small>
                </article>
                <article className={contractEconomicsData.managedDebtBs > 0 ? 'is-due' : 'is-paid'}>
                  <span>{contractEconomicsData.managedDebtBs > 0 ? 'Debe' : 'Pagado'}</span>
                  <strong>{contractEconomicsData.managedDebtBs > 0 ? formatBs(contractEconomicsData.managedDebtBs) : 'Pagado'}</strong>
                  <small>{contractEconomicsData.managedDebtBs > 0 ? 'Saldo pendiente' : 'Sin saldo pendiente'}</small>
                </article>
              </div>

              <section
                className="contract-economics-panel"
                style={{
                  marginBottom: '14px',
                  borderColor: contractEconomicsData.managedDebtBs > 0 || contractEconomicsData.ledgerRefundSuggestedBs > 0 ? '#fdba74' : '#86efac',
                  background: contractEconomicsData.managedDebtBs > 0 || contractEconomicsData.ledgerRefundSuggestedBs > 0 ? '#fff7ed' : '#f0fdf4',
                }}
              >
                <header>
                  <div>
                    <span style={{ color: '#e65300', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase' }}>
                      1. Estado economico actual
                    </span>
                    <h4 style={{ marginTop: '4px' }}>
                      {contractEconomicsData.managedDebtBs > 0
                        ? `Saldo pendiente ${formatBs(contractEconomicsData.managedDebtBs)}`
                        : contractEconomicsData.damagePendingBs > 0
                          ? `Alquiler pagado | Danos pendientes ${formatBs(contractEconomicsData.damagePendingBs)}`
                          : contractEconomicsData.ledgerRefundSuggestedBs > 0
                            ? `Alquiler pagado | Excedente por devolver ${formatBs(contractEconomicsData.ledgerRefundSuggestedBs)}`
                          : contractEconomicsData.guaranteeRefundableBs > 0
                            ? `Alquiler pagado | Garantia por devolver ${formatBs(contractEconomicsData.guaranteeRefundableBs)}`
                            : 'Contrato economicamente al dia'}
                    </h4>
                    <p>
                      Vista resumida del estado con el que ingreso el contrato. Los datos historicos, recibos y movimientos anteriores se conservan sin transformarlos.
                    </p>
                  </div>
                  <span className={`orders-contract-close-pill ${contractEconomicsData.managedDebtBs > 0 || contractEconomicsData.damagePendingBs > 0 || contractEconomicsData.totalRefundAvailableBs > 0 ? 'is-pending' : 'is-ready'}`}>
                    {contractEconomicsData.managedDebtBs > 0
                      ? 'Pendiente de cobro'
                      : contractEconomicsData.damagePendingBs > 0
                        ? 'Danos pendientes'
                        : contractEconomicsData.ledgerRefundSuggestedBs > 0
                          ? 'Excedente pendiente'
                        : contractEconomicsData.guaranteeRefundableBs > 0
                          ? 'Garantia pendiente'
                          : 'Sin pendientes'}
                  </span>
                </header>

                <div className="contract-economics-kpis" style={{ marginTop: '12px' }}>
                  <article>
                    <span>Total contrato</span>
                    <strong>{formatBs(contractEconomicsData.totalBs)}</strong>
                    <small>Items, servicios y transporte</small>
                  </article>
                  <article>
                    <span>Total cobrado</span>
                    <strong>{formatBs(contractEconomicsData.rentalReceivedBs)}</strong>
                    <small>Ingresos confirmados del contrato</small>
                  </article>
                  <article className={contractEconomicsData.managedDebtBs > 0 ? 'is-due' : 'is-paid'}>
                    <span>Saldo alquiler</span>
                    <strong>{contractEconomicsData.managedDebtBs > 0 ? formatBs(contractEconomicsData.managedDebtBs) : 'Pagado'}</strong>
                    <small>{contractEconomicsData.managedDebtBs > 0 ? 'Pendiente de cobro' : 'Sin saldo pendiente'}</small>
                  </article>
                  <article>
                    <span>Garantia disponible</span>
                    <strong>{formatBs(contractEconomicsData.guaranteeRefundableBs)}</strong>
                    <small>{contractEconomicsData.guaranteeStatus}</small>
                  </article>
                  <article className={contractEconomicsData.damagePendingBs > 0 ? 'is-due' : 'is-paid'}>
                    <span>Danos / faltantes</span>
                    <strong>{contractEconomicsData.damagePendingBs > 0 ? formatBs(contractEconomicsData.damagePendingBs) : 'Sin pendiente'}</strong>
                    <small>{contractEconomicsData.returnIssues.length} observación(es){contractEconomicsData.clientPendingUnits > 0 ? ` · ${contractEconomicsData.clientPendingUnits} con cliente` : ''}</small>
                  </article>
                </div>

              </section>

              <div className="contract-economics-story-layout">
                <div style={{ gridColumn: '1 / -1', marginBottom: '-4px' }}>
                  <span style={{ color: '#e65300', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase' }}>
                    Movimientos y respaldo
                  </span>
                  <p style={{ margin: '4px 0 0', color: '#667085' }}>
                    Registra cobros o devoluciones, documenta el historial y consulta los recibos existentes sin alterar contratos anteriores.
                  </p>
                </div>
                <section className="contract-economics-flow-card">
                  <div
                    style={{
                      border: '1px solid #d9e2f2',
                      borderRadius: '14px',
                      background: '#ffffff',
                      overflow: 'hidden',
                    }}
                  >
                    <header
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '16px',
                        padding: '10px 12px',
                        borderBottom: '1px solid #e5eaf2',
                        background: '#f8faff',
                      }}
                    >
                      <div>
                        <span style={{ color: '#e65300', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' }}>
                          2. Centro de movimientos y recibos
                        </span>
                        <h4 style={{ margin: '2px 0', fontSize: '15px' }}>Cobrar, aplicar garantia o devolver dinero</h4>
                        <p style={{ margin: 0, color: '#667085' }}>
                          Todas las operaciones economicas del contrato se realizan desde este unico sector.
                        </p>
                      </div>
                      <span
                        style={{
                          border: '1px solid #fed7aa',
                          borderRadius: '999px',
                          background: '#fff7ed',
                          color: '#c2410c',
                          padding: '4px 8px',
                          fontSize: '10px',
                          fontWeight: 800,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Genera movimiento y recibo
                      </span>
                    </header>

                    <div style={{ padding: '10px 12px', display: 'grid', gap: '10px' }}>
                      <form
                        className="contract-economics-collect compact split-collection"
                        onSubmit={handleSubmitContractEconomicCollection}
                        style={{ margin: 0 }}
                      >
                        <div className="contract-economics-collection-intro">
                          <h4 style={{ marginBottom: '2px', fontSize: '14px' }}>A. Registrar cobro</h4>
                          <p>
                            {selectedContractEconomicsCollectionAmountBs > 0
                              ? `${selectedContractEconomicsCollectionLabel}: pendiente ${formatBs(selectedContractEconomicsCollectionAmountBs)}. Selecciona el concepto y genera el recibo correspondiente.`
                              : `No hay saldo nuevo para cobrar. Los recibos existentes se encuentran en "Pagos, movimientos y recibos".`}
                          </p>
                        </div>
                        <div className="contract-economics-collection-targets" role="group" aria-label="Concepto a cobrar">
                          {contractEconomicsCollectionOptions.map((option) => (
                            <button
                              key={option.key}
                              type="button"
                              className={selectedContractEconomicsCollectionTargets.includes(option.key) ? 'active' : ''}
                              onClick={() => setContractEconomicsCollectionDraft((current) => ({
                                ...current,
                                target: option.key === 'balance' ? 'balance' : option.key,
                                targets: (() => {
                                  const currentTargets = normalizeEconomicCollectionTargets(current.targets ?? current.target);
                                  if (option.key === 'balance') return ['balance'];
                                  const withoutBalance = currentTargets.filter((target) => target !== 'balance');
                                  if (withoutBalance.length === 1 && withoutBalance[0] === 'rental' && option.key !== 'rental') {
                                    return [option.key];
                                  }
                                  const nextTargets = withoutBalance.includes(option.key)
                                    ? withoutBalance.filter((target) => target !== option.key)
                                    : [...withoutBalance, option.key];
                                  return normalizeEconomicCollectionTargets(nextTargets);
                                })(),
                                amountBs: '',
                                note: current.note,
                              }))}
                              disabled={readOnly || isSavingContractEconomicsCollection || option.amountBs <= 0}
                              title={option.detail}
                            >
                              <span>{option.shortLabel}</span>
                              <strong>{formatBs(option.amountBs)}</strong>
                            </button>
                          ))}
                        </div>
                        <div className="contract-economics-collection-fields">
                          <label>
                            Monto
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={contractEconomicsCollectionDraft.amountBs}
                              onChange={(event) => setContractEconomicsCollectionDraft((current) => ({ ...current, amountBs: event.target.value }))}
                              placeholder={selectedContractEconomicsCollectionAmountBs > 0 ? String(selectedContractEconomicsCollectionAmountBs.toFixed(2)) : '0.00'}
                              disabled={readOnly || selectedContractEconomicsCollectionAmountBs <= 0 || isSavingContractEconomicsCollection}
                            />
                          </label>
                          <label>
                            Metodo
                            <select
                              value={contractEconomicsCollectionDraft.paymentMethod}
                              onChange={(event) => setContractEconomicsCollectionDraft((current) => ({ ...current, paymentMethod: event.target.value, paymentAccount: event.target.value === 'qr' ? current.paymentAccount : '' }))}
                              disabled={readOnly || selectedContractEconomicsCollectionAmountBs <= 0 || isSavingContractEconomicsCollection}
                            >
                              <option value="efectivo">Efectivo</option>
                              <option value="qr">QR</option>
                              <option value="transferencia">Transferencia</option>
                            </select>
                          </label>
                          {contractEconomicsCollectionDraft.paymentMethod === 'qr' ? (
                            <label>
                              Cuenta QR
                              <select
                                value={contractEconomicsCollectionDraft.paymentAccount}
                                onChange={(event) => setContractEconomicsCollectionDraft((current) => ({ ...current, paymentAccount: event.target.value }))}
                                disabled={readOnly || selectedContractEconomicsCollectionAmountBs <= 0 || isSavingContractEconomicsCollection}
                              >
                                <option value="">Seleccionar</option>
                                {QR_ACCOUNT_OPTIONS.map((account) => <option key={account} value={account}>{account}</option>)}
                              </select>
                            </label>
                          ) : null}
                          <label className="receipt-field">
                            Comprobante / nota
                            <input
                              value={contractEconomicsCollectionDraft.receipt}
                              onChange={(event) => setContractEconomicsCollectionDraft((current) => ({ ...current, receipt: event.target.value }))}
                              placeholder="Referencia opcional"
                              disabled={readOnly || selectedContractEconomicsCollectionAmountBs <= 0 || isSavingContractEconomicsCollection}
                            />
                          </label>
                          <button
                            type="submit"
                            className="primary-button"
                            disabled={readOnly || selectedContractEconomicsCollectionAmountBs <= 0 || isSavingContractEconomicsCollection}
                          >
                            {isSavingContractEconomicsCollection ? 'Registrando...' : `Cobrar ${selectedContractEconomicsCollectionButtonLabel}`}
                          </button>
                        </div>
                      </form>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                          gap: '10px',
                          alignItems: 'stretch',
                        }}
                      >
                        <section
                          style={{
                            gridColumn: '1 / -1',
                            border: '1px solid #fed7aa',
                            borderRadius: '12px',
                            background: '#fffaf5',
                            padding: '10px',
                            display: 'grid',
                            gridTemplateRows: 'auto 1fr auto',
                            gap: '6px',
                            minWidth: 0,
                          }}
                        >
                          <span style={{ color: '#c2410c', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' }}>
                            B. Aplicar daños
                          </span>
                          <div>
                            <h4 style={{ margin: '0 0 3px', fontSize: '14px' }}>Usar garantia retenida</h4>
                            <p style={{ margin: 0, color: '#667085', lineHeight: 1.45 }}>
                              Descuenta los daños pendientes de la garantia. No registra un nuevo ingreso en Caja Grande.
                            </p>
                          </div>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={handleApplyEconomicCharge}
                            disabled={
                              readOnly
                              || isSavingContractEconomicsLedger
                              || contractEconomicsData.guaranteeRefundAvailableBs <= 0
                              || Math.max(0, contractEconomicsData.penaltiesBs - contractEconomicsData.ledgerTotals.chargesBs) <= 0
                            }
                            style={{ width: '100%' }}
                          >
                            Aplicar a garantia {formatBs(Math.min(
                              Math.max(0, contractEconomicsData.penaltiesBs - contractEconomicsData.ledgerTotals.chargesBs),
                              contractEconomicsData.guaranteeRefundAvailableBs,
                            ))}
                          </button>
                        </section>

                        <form
                          className="contract-economics-collect compact guarantee-refund"
                          onSubmit={handleSubmitContractEconomicGuaranteeRefund}
                          style={{
                            margin: 0,
                            gridColumn: '1 / -1',
                            border: '1px solid #bbf7d0',
                            borderRadius: '12px',
                            background: '#f7fff9',
                            padding: '10px',
                            display: 'grid',
                            gridTemplateColumns: 'minmax(190px, 1.1fr) repeat(6, minmax(110px, 0.5fr))',
                            gap: '8px',
                            alignItems: 'end',
                          }}
                        >
                          <div style={{ alignSelf: 'center', minWidth: 0 }}>
                            <span style={{ color: '#15803d', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' }}>
                              C. Devolver dinero
                            </span>
                            <h4 style={{ margin: '2px 0', fontSize: '14px' }}>Garantia o excedente con recibo</h4>
                            <p style={{ margin: 0, color: '#667085', lineHeight: 1.4 }}>
                              {contractEconomicsData.totalRefundAvailableBs > 0
                                ? `Garantia disponible: ${formatBs(contractEconomicsData.guaranteeRefundableBs)} · Excedente: ${formatBs(contractEconomicsData.ledgerRefundSuggestedBs)}.${contractEconomicsData.guaranteePendingObligationsBs > 0 ? ` Hay ${formatBs(contractEconomicsData.guaranteePendingObligationsBs)} de obligaciones pendientes; aplicar garantia a danos es una accion separada.` : ''}`
                                : 'No existe dinero disponible para devolver.'}
                            </p>
                          </div>
                          <label>
                            Concepto
                            <select
                              value={contractEconomicsGuaranteeRefundDraft.source === 'surplus' && contractEconomicsData.ledgerRefundSuggestedBs > 0
                                ? 'surplus'
                                : contractEconomicsData.guaranteeRefundableBs > 0 ? 'guarantee' : 'surplus'}
                              onChange={(event) => setContractEconomicsGuaranteeRefundDraft((current) => ({ ...current, source: event.target.value, amountBs: '' }))}
                              disabled={readOnly || isSavingContractEconomicsGuaranteeRefund || contractEconomicsData.totalRefundAvailableBs <= 0}
                            >
                              <option value="guarantee" disabled={contractEconomicsData.guaranteeRefundableBs <= 0}>Garantia ({formatBs(contractEconomicsData.guaranteeRefundableBs)})</option>
                              <option value="surplus" disabled={contractEconomicsData.ledgerRefundSuggestedBs <= 0}>Excedente ({formatBs(contractEconomicsData.ledgerRefundSuggestedBs)})</option>
                            </select>
                          </label>
                          <label>
                            Monto
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={contractEconomicsGuaranteeRefundDraft.amountBs}
                              onChange={(event) => setContractEconomicsGuaranteeRefundDraft((current) => ({ ...current, amountBs: event.target.value }))}
                              placeholder={String((contractEconomicsGuaranteeRefundDraft.source === 'surplus' || contractEconomicsData.guaranteeRefundableBs <= 0
                                ? contractEconomicsData.ledgerRefundSuggestedBs
                                : contractEconomicsData.guaranteeRefundableBs).toFixed(2))}
                              disabled={readOnly || isSavingContractEconomicsGuaranteeRefund || contractEconomicsData.totalRefundAvailableBs <= 0}
                            />
                          </label>
                          <label>
                            Metodo
                            <select
                              value={contractEconomicsGuaranteeRefundDraft.paymentMethod}
                              onChange={(event) => setContractEconomicsGuaranteeRefundDraft((current) => ({
                                ...current,
                                paymentMethod: event.target.value,
                                paymentAccount: event.target.value === 'qr' ? current.paymentAccount : '',
                              }))}
                              disabled={readOnly || isSavingContractEconomicsGuaranteeRefund || contractEconomicsData.totalRefundAvailableBs <= 0}
                            >
                              <option value="efectivo">Efectivo</option>
                              <option value="qr">QR</option>
                              <option value="transferencia">Transferencia</option>
                            </select>
                          </label>
                          <label>
                            Comprobante / nota
                            <input
                              value={contractEconomicsGuaranteeRefundDraft.receipt}
                              onChange={(event) => setContractEconomicsGuaranteeRefundDraft((current) => ({ ...current, receipt: event.target.value }))}
                              placeholder="Referencia opcional"
                              disabled={readOnly || isSavingContractEconomicsGuaranteeRefund || contractEconomicsData.totalRefundAvailableBs <= 0}
                            />
                          </label>
                          {contractEconomicsGuaranteeRefundDraft.paymentMethod === 'qr' ? (
                            <label>
                              Cuenta QR
                              <select
                                value={contractEconomicsGuaranteeRefundDraft.paymentAccount}
                                onChange={(event) => setContractEconomicsGuaranteeRefundDraft((current) => ({ ...current, paymentAccount: event.target.value }))}
                                disabled={readOnly || isSavingContractEconomicsGuaranteeRefund || contractEconomicsData.totalRefundAvailableBs <= 0}
                              >
                                <option value="">Seleccionar</option>
                                {QR_ACCOUNT_OPTIONS.map((account) => <option key={account} value={account}>{account}</option>)}
                              </select>
                            </label>
                          ) : (
                            <span aria-hidden="true" />
                          )}
                          <button
                            type="submit"
                            className="primary-button"
                            disabled={readOnly || isSavingContractEconomicsGuaranteeRefund || contractEconomicsData.totalRefundAvailableBs <= 0}
                            style={{ width: '100%' }}
                          >
                            {isSavingContractEconomicsGuaranteeRefund ? 'Registrando...' : 'Registrar devolucion'}
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                </section>


                <aside className="contract-economics-money-story">
                  <h4>Que paso con el dinero</h4>
                  <div>
                    <span>Depositado por el cliente</span>
                    <strong>{formatBs(contractEconomicsData.ledgerCustomerDepositsBs)}</strong>
                  </div>
                  <div>
                    <span>Garantia apartada del deposito</span>
                    <strong>- {formatBs(contractEconomicsData.reclassifiedGuaranteeBs)}</strong>
                  </div>
                  <div>
                    <span>Aplicado al contrato</span>
                    <strong>- {formatBs(contractEconomicsData.ledgerAppliedToRentalBs)}</strong>
                  </div>
                  <div>
                    <span>Excedente pendiente de devolver</span>
                    <strong>{formatBs(contractEconomicsData.ledgerRefundSuggestedBs)}</strong>
                  </div>
                  <div>
                    <span>Garantia devuelta</span>
                    <strong>+ {formatBs(contractEconomicsData.effectiveGuaranteeRefundedBs)}</strong>
                  </div>
                  <div>
                    <span>Danos cobrados por separado</span>
                    <strong>+ {formatBs(contractEconomicsData.collectionByTarget.damageBs)}</strong>
                  </div>
                  <footer>
                    <span>Ingreso real alquiler</span>
                    <strong>{formatBs(contractEconomicsData.realIncomeBs)}</strong>
                  </footer>
                </aside>
              </div>

              <section className="contract-economics-notebook">
                <header className="contract-economics-notebook-head">
                  <div>
                    <span>3. Hoja Flexible</span>
                    <h4>Historial economico y respaldo del contrato</h4>
                    <p>Registra como realmente se movio el dinero: abonos, garantia separada, cargos, devoluciones y notas.</p>
                  </div>
                  <div className="contract-economics-notebook-summary">
                    <article className="tone-blue">
                      <span>Depositos del cliente</span>
                      <strong>{formatBs(contractEconomicsData.ledgerCustomerDepositsBs)}</strong>
                      <small>{contractEconomicsData.ledgerUnregisteredRentalBs > 0 ? `Sin recibo de caja: ${formatBs(contractEconomicsData.ledgerUnregisteredRentalBs)}` : 'Respaldado en Caja Grande'}</small>
                    </article>
                    <article className="tone-blue">
                      <span>Total contrato</span>
                      <strong>{formatBs(contractEconomicsData.ledgerChargeTargetBs)}</strong>
                      <small>Items, servicios y transporte</small>
                    </article>
                    <article className="tone-violet">
                      <span>Garantia reservada</span>
                      <strong>{formatBs(contractEconomicsData.ledgerConfirmedGuaranteeBs)}</strong>
                      <small>{contractEconomicsData.ledgerUnregisteredGuaranteeBs > 0 ? `Anotada sin recibo: ${formatBs(contractEconomicsData.ledgerUnregisteredGuaranteeBs)}` : 'Apartado, no es ingreso'}</small>
                    </article>
                    <article className="tone-green">
                      <span>Garantia disponible</span>
                      <strong>{formatBs(contractEconomicsData.guaranteeRefundableBs)}</strong>
                      <small>Solo baja al aplicar danos o devolver dinero</small>
                    </article>
                    <article className={contractEconomicsData.ledgerDebtBs > 0 ? 'tone-orange' : 'tone-green'}>
                      <span>{contractEconomicsData.ledgerDebtBs > 0 ? 'Falta por cobrar' : contractEconomicsData.ledgerRefundSuggestedBs > 0 ? 'Excedente a devolver' : 'Todo cubierto'}</span>
                      <strong>{formatBs(contractEconomicsData.ledgerDebtBs > 0 ? contractEconomicsData.ledgerDebtBs : contractEconomicsData.ledgerRefundSuggestedBs)}</strong>
                      <small>{contractEconomicsData.ledgerDebtBs > 0 ? 'El pago no alcanza' : contractEconomicsData.ledgerRefundSuggestedBs > 0 ? 'Dinero restante del cliente' : 'No falta dinero'}</small>
                    </article>
                  </div>
                  <strong>{contractEconomicsData.economicLedger.length} linea(s)</strong>
                </header>

                <div className="contract-economics-ledger-sheet">
                  <div className="contract-economics-ledger-head">
                    <span></span>
                    <span>Fecha</span>
                    <span>Movimiento</span>
                    <span>Monto Bs</span>
                    <span>Metodo</span>
                    <span>Cuenta QR</span>
                    <span>Detalle historico</span>
                    <span>Registrado por</span>
                    <span>Acciones</span>
                  </div>

                  <form className="contract-economics-ledger-form" onSubmit={handleSubmitContractEconomicLedger}>
                    <span className="contract-economics-ledger-dot" aria-hidden="true"></span>
                    <label className="contract-economics-ledger-date">
                      <span>Fecha</span>
                      <input
                        type="date"
                        value={contractEconomicsLedgerDraft.date}
                        onChange={(event) => setContractEconomicsLedgerDraft((current) => ({
                          ...current,
                          date: event.target.value,
                        }))}
                        disabled={readOnly || isSavingContractEconomicsLedger}
                      />
                    </label>
                    <label className="contract-economics-ledger-type">
                      <span>Movimiento</span>
                      <select
                        ref={contractEconomicsLedgerTypeRef}
                        defaultValue="deposit"
                        disabled={readOnly || isSavingContractEconomicsLedger}
                      >
                        {Object.entries(ECONOMIC_LEDGER_TYPE_META)
                          .filter(([value]) => value !== 'refund' || Boolean(contractEconomicsLedgerEditingId))
                          .map(([value, meta]) => (
                          <option key={value} value={value}>{meta.label}</option>
                          ))}
                      </select>
                    </label>
                    <label className="contract-economics-ledger-amount">
                      <span>Monto Bs</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        ref={contractEconomicsLedgerAmountRef}
                        placeholder="0,00"
                        disabled={readOnly || isSavingContractEconomicsLedger}
                      />
                    </label>
                    <label className="contract-economics-ledger-method">
                      <span>Metodo</span>
                      <select
                        value={contractEconomicsLedgerDraft.paymentMethod}
                        onChange={(event) => setContractEconomicsLedgerDraft((current) => ({
                          ...current,
                          paymentMethod: event.target.value,
                          paymentAccount: event.target.value === 'qr' ? current.paymentAccount : '',
                        }))}
                        disabled={readOnly || isSavingContractEconomicsLedger}
                      >
                        <option value="efectivo">Efectivo</option>
                        <option value="qr">QR</option>
                        <option value="transferencia">Transferencia</option>
                      </select>
                    </label>
                    {contractEconomicsLedgerDraft.paymentMethod === 'qr' ? (
                      <label className="contract-economics-ledger-qr">
                        <span>Cuenta QR</span>
                        <select
                          value={contractEconomicsLedgerDraft.paymentAccount}
                          onChange={(event) => setContractEconomicsLedgerDraft((current) => ({
                            ...current,
                            paymentAccount: event.target.value,
                          }))}
                          disabled={readOnly || isSavingContractEconomicsLedger}
                        >
                          <option value="">Seleccionar</option>
                          {QR_ACCOUNT_OPTIONS.map((account) => <option key={account} value={account}>{account}</option>)}
                        </select>
                      </label>
                    ) : null}
                    <label className="contract-economics-ledger-detail">
                      <span>Detalle historico</span>
                      <input
                        ref={contractEconomicsLedgerNoteRef}
                        placeholder="Ej. Deposito 1700, se separan 200 como garantia..."
                        disabled={readOnly || isSavingContractEconomicsLedger}
                      />
                    </label>
                    <div className="contract-economics-ledger-form-actions">
                      <button type="submit" className="primary-button" disabled={readOnly || isSavingContractEconomicsLedger}>
                        {isSavingContractEconomicsLedger
                          ? 'Guardando...'
                          : contractEconomicsLedgerEditingId
                            ? 'Guardar'
                            : 'Agregar linea'}
                      </button>
                      {contractEconomicsLedgerEditingId ? (
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={resetContractEconomicLedgerForm}
                          disabled={isSavingContractEconomicsLedger}
                        >
                          Cancelar
                        </button>
                      ) : null}
                    </div>
                  </form>

                  <div className="contract-economics-notebook-lines">
                    {contractEconomicsData.economicLedger.length > 0 ? contractEconomicsData.economicLedger.map((entry) => {
                      const meta = ECONOMIC_LEDGER_TYPE_META[entry.type] ?? ECONOMIC_LEDGER_TYPE_META.note;
                      const creatorLabel = entry.createdByName || 'Sistema';
                      const editedLabel = entry.editedByName
                        ? `Editado por ${entry.editedByName}${entry.editedAt ? ` el ${formatDateTime(entry.editedAt)}` : ''}`
                        : '';
                      const isIncomeFlow = entry.type === 'deposit';
                      const isReservedGuarantee = entry.type === 'guarantee';
                      const isRefundFlow = entry.type === 'refund';
                      const canHaveDepositReceipt = isIncomeFlow && !isGeneratedEconomicCollectionEntry(entry);
                      const depositAllocation = canHaveDepositReceipt
                        ? getEconomicDepositAllocations(
                            contractEconomicsData.economicLedger,
                            contractEconomicsData.ledgerChargeTargetBs,
                          ).get(entry.id)
                        : null;
                      const guaranteeGapBs = Math.max(
                        0,
                        Number((contractEconomicsData.guaranteeDeclaredBs - contractEconomicsData.ledgerAnnotatedGuaranteeBs).toFixed(2)),
                      );
                      const guaranteeAlreadyFromDepositBs = canHaveDepositReceipt
                        ? (contractEconomicsData.economicLedger ?? []).reduce((sum, row) => (
                            row.type === 'guarantee' && String(row.sourceDepositId ?? '') === String(entry.id)
                              ? sum + toMoneyNumber(row.amountBs)
                              : sum
                          ), 0)
                        : 0;
                      const guaranteeAvailableFromDepositBs = canHaveDepositReceipt
                        ? Math.max(0, Number((toMoneyNumber(entry.amountBs) - guaranteeAlreadyFromDepositBs).toFixed(2)))
                        : 0;
                      const guaranteeToSeparateFromDepositBs = Math.min(guaranteeGapBs, guaranteeAvailableFromDepositBs);
                      const moneyFlowTitle = entry.type === 'deposit'
                        ? entry.isCashRegistered
                          ? `Ingreso confirmado en Caja Grande${entry.cashReceiptCode ? ` - ${entry.cashReceiptCode}` : ''}`
                          : 'Ingreso anotado en el cuaderno economico'
                        : entry.type === 'refund'
                          ? `Devolucion confirmada en Caja Grande${entry.cashReceiptCode ? ` - ${entry.cashReceiptCode}` : ''}`
                          : 'Dinero separado como garantia en el cuaderno economico';
                      return (
                        <article
                          className={`contract-economics-notebook-line tone-${meta.tone}${entry.isCashRegistered ? ' is-cash-registered' : ''}${isIncomeFlow ? ' is-income-flow' : ''}${isReservedGuarantee ? ' is-reserved-guarantee' : ''}${isRefundFlow ? ' is-refund-flow' : ''}`}
                          key={entry.id}
                        >
                          <span
                            className="contract-economics-ledger-dot"
                            aria-hidden="true"
                          ></span>
                          <time>{entry.createdAt ? formatDateTime(entry.createdAt) : '-'}</time>
                          <span className="contract-economics-ledger-movement">
                            <span className="contract-economics-ledger-movement-label">{meta.label}</span>
                            {entry.type === 'deposit' ? (
                              <b
                                className={`contract-economics-money-flow-pill is-${entry.type}`}
                                title={moneyFlowTitle}
                              >
                                {entry.isCashRegistered
                                  ? `Cobrado en caja${entry.cashReceiptCode ? ` - ${entry.cashReceiptCode}` : ''}`
                                  : 'Ingreso anotado'}
                              </b>
                            ) : null}
                            {entry.type === 'guarantee' ? (
                              <b
                                className="contract-economics-reserved-guarantee-pill"
                                title={moneyFlowTitle}
                              >
                                Dinero separado
                              </b>
                            ) : null}
                            {entry.type === 'refund' ? (
                              <b
                                className="contract-economics-refund-pill"
                                title={moneyFlowTitle}
                              >
                                {entry.isCashRegistered || entry.cashMovementId || entry.cashReceiptCode
                                  ? entry.cashReceiptCode ? `Devuelto - ${entry.cashReceiptCode}` : 'Devuelto en caja'
                                  : 'Anotado sin recibo'}
                              </b>
                            ) : null}
                          </span>
                          <strong>{entry.type === 'note' ? '-' : formatBs(entry.amountBs)}</strong>
                          <em>{entry.type === 'note' ? 'Sin metodo' : formatPaymentMethodLabel(entry.paymentMethod)}</em>
                          <small>{entry.paymentAccount || '-'}</small>
                          <p>
                            {entry.note}
                            {depositAllocation ? (
                              <small style={{ display: 'block', marginTop: '3px' }}>
                                Recibido {formatBs(depositAllocation.receivedBs)} = contrato {formatBs(depositAllocation.contractBs)}
                                {depositAllocation.guaranteeBs > 0 ? ` + garantia ${formatBs(depositAllocation.guaranteeBs)}` : ''}
                                {depositAllocation.surplusBs > 0 ? ` + excedente ${formatBs(depositAllocation.surplusBs)}` : ''}
                              </small>
                            ) : null}
                          </p>
                          <small title={editedLabel ? `${creatorLabel}. ${editedLabel}` : creatorLabel}>
                            {creatorLabel}
                            {editedLabel ? <b>{editedLabel}</b> : null}
                          </small>
                          <div className="contract-economics-notebook-line-actions">
                            {canHaveDepositReceipt && guaranteeToSeparateFromDepositBs > 0 ? (
                              <button
                                type="button"
                                className="contract-economics-row-action"
                                onClick={() => handleSeparateEconomicGuarantee(entry)}
                                disabled={readOnly || isSavingContractEconomicsLedger || Boolean(entry.cashMovementId)}
                                title={entry.cashMovementId
                                  ? 'El recibo ya fue emitido; primero debe corregirse mediante anulacion y reemplazo.'
                                  : `Apartar ${formatBs(guaranteeToSeparateFromDepositBs)} de este deposito.`}
                              >
                                Apartar {formatBs(guaranteeToSeparateFromDepositBs)}
                              </button>
                            ) : null}
                            {canHaveDepositReceipt ? (
                              <button
                                type="button"
                                className="contract-economics-row-action"
                                onClick={() => handleDepositReceipt(entry)}
                                disabled={
                                  generatingDepositReceiptId === entry.id
                                  || (!entry.cashMovementId && (readOnly || isSavingContractEconomicsLedger))
                                }
                                title={entry.cashMovementId
                                  ? 'Abrir o reimprimir el recibo.'
                                  : guaranteeToSeparateFromDepositBs > 0
                                    ? 'Generar recibo como abono al contrato. Si parte de este deposito corresponde a garantia, usa Apartar antes de generar el recibo.'
                                    : 'Generar recibo oficial del deposito.'}
                                aria-label={`${entry.cashMovementId ? 'Abrir' : 'Generar'} recibo del deposito`}
                              >
                                {generatingDepositReceiptId === entry.id
                                  ? 'Generando...'
                                  : entry.cashReceiptCode || (entry.cashMovementId ? 'Ver recibo' : 'Generar recibo')}
                              </button>
                            ) : null}
                            {entry.attachment?.url ? (
                              <>
                                <a
                                  className="contract-economics-row-action"
                                  href={entry.attachment.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={`Comprobante: ${entry.attachment.originalName || entry.attachment.filename}${entry.attachment.uploadedByName ? ` · subido por ${entry.attachment.uploadedByName}` : ''}`}
                                >
                                  Ver comprobante
                                </a>
                                <button
                                  type="button"
                                  className="contract-economics-row-action"
                                  onClick={() => handleSelectEconomicReceiptImage(entry)}
                                  disabled={readOnly || economicReceiptImageBusyId === entry.id}
                                >
                                  {economicReceiptImageBusyId === entry.id ? 'Subiendo...' : 'Cambiar imagen'}
                                </button>
                                <button
                                  type="button"
                                  className="contract-economics-row-action danger"
                                  onClick={() => handleDeleteEconomicReceiptImage(entry)}
                                  disabled={readOnly || economicReceiptImageBusyId === entry.id}
                                  title="Quita solamente la imagen; no elimina la linea economica."
                                >
                                  Quitar comprobante
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="contract-economics-row-action"
                                onClick={() => handleSelectEconomicReceiptImage(entry)}
                                disabled={readOnly || economicReceiptImageBusyId === entry.id}
                                title="Adjuntar imagen del comprobante a esta linea."
                              >
                                {economicReceiptImageBusyId === entry.id ? 'Subiendo...' : 'Adjuntar comprobante'}
                              </button>
                            )}
                            <button
                              type="button"
                              className="contract-economics-row-action"
                              onClick={() => handleEditContractEconomicLedgerEntry(entry)}
                              disabled={readOnly || isSavingContractEconomicsLedger}
                              title="Cambia solamente la fecha y hora de esta linea y de su recibo vinculado."
                              aria-label={`Editar fecha de ${meta.label}`}
                            >
                              <Pencil aria-hidden="true" />
                              Editar fecha
                            </button>
                            <button
                              type="button"
                              className="contract-economics-row-action danger"
                              onClick={() => handleDeleteContractEconomicLedgerEntry(entry)}
                              disabled={readOnly || isSavingContractEconomicsLedger || (canHaveDepositReceipt && Boolean(entry.cashMovementId))}
                              title={canHaveDepositReceipt && entry.cashMovementId ? 'Para corregir un recibo oficial debe usarse el flujo de anulacion y reemplazo.' : ''}
                              aria-label={`Eliminar linea ${meta.label}`}
                            >
                              <Trash2 aria-hidden="true" />
                              Eliminar
                            </button>
                          </div>
                        </article>
                      );
                    }) : (
                      <p className="contract-economics-empty">
                        Todavia no hay lineas en el cuaderno. Agrega el primer movimiento para empezar el seguimiento historico.
                      </p>
                    )}
                    <p className="contract-economics-ledger-next">Escribe aqui el proximo movimiento...</p>
                  </div>
                </div>
              </section>

              <div className="contract-economics-grid">
                <article className="contract-economics-panel contract-economics-movements-card" style={{ gridColumn: '1 / -1' }}>
                  <header>
                    <div>
                      <h4>Pagos y movimientos de caja</h4>
                      <p>4. Solo ingresos y egresos reales. El retorno físico no genera recibos ni mueve dinero automáticamente.</p>
                    </div>
                  </header>
                  <div className="contract-economics-table">
                    <div className="contract-economics-table-head">
                      <span>Fecha</span>
                      <span>Estado</span>
                      <span>Detalle</span>
                      <span>Monto</span>
                      <span>Editar</span>
                      <span>Recibo</span>
                    </div>
                    {contractEconomicsData.movements.length > 0 ? contractEconomicsData.movements.map((movement) => {
                      const movementKind = getEconomicMovementKind(movement);
                      const movementAmount = getEconomicMovementAmount(movement, contractEconomicsData);
                      return (
                        <div
                          className={`contract-economics-table-row is-${movementKind}`}
                          key={movement.id ?? `${movement.createdAt}-${movement.description}`}
                        >
                          <span className="contract-economics-table-date">
                            {movement.receiptIssuedAt || movement.createdAt
                              ? (formatDateTime?.(movement.receiptIssuedAt ?? movement.createdAt) ?? formatDate?.(movement.receiptIssuedAt ?? movement.createdAt) ?? movement.receiptIssuedAt ?? movement.createdAt)
                              : '-'}
                          </span>
                          <span className={`contract-economics-movement-badge is-${movementKind}`}>
                            {getEconomicMovementKindLabel(movementKind)}
                          </span>
                          <span className="contract-economics-table-detail">
                            <small>{formatCashMovementType(movement)}</small>
                            <b>{movement.description || movement.notes || movement.category || '-'}</b>
                          </span>
                          <strong className={`contract-economics-table-amount is-${movementKind}`}>
                            {formatBs(movementAmount)}
                          </strong>
                          <span className="contract-economics-table-edit">
                            {movement.id && !isVoidedCashMovement(movement) && Math.abs(getCashMovementAmount(movement)) > 0 ? (
                              <button
                                type="button"
                                className="contract-economics-receipt-edit-button"
                                onClick={() => openReceiptEditor(movement)}
                                disabled={readOnly || isSavingReceiptEdit}
                                title="Corregir los datos impresos del recibo sin cambiar el monto"
                              >
                                <Pencil size={13} aria-hidden="true" />
                                Editar
                              </button>
                            ) : (
                              <span>-</span>
                            )}
                          </span>
                          <span className="contract-economics-table-receipt">
                            {movement.id && !isVoidedCashMovement(movement) && Math.abs(getCashMovementAmount(movement)) > 0 ? (
                              <button type="button" className="section-link blue" onClick={() => handlePrintEconomicReceipt(movement)}>
                                {movement.receiptCode || movement.receipt || 'Ver recibo'}
                              </button>
                            ) : (
                              movement.receiptCode || movement.receipt || (isVoidedCashMovement(movement) ? 'Anulado' : '-')
                            )}
                          </span>
                        </div>
                      );
                    }) : (
                      <p className="contract-economics-empty">No hay ingresos ni egresos reales vinculados a este contrato.</p>
                    )}
                  </div>
                </article>
              </div>

              <article className="contract-economics-panel">
                <header>
                  <div>
                    <h4>5. Retorno: daños, faltantes y material con cliente</h4>
                    <p>Separa pérdidas/cargos de las unidades que todavía siguen físicamente con el cliente.</p>
                  </div>
                </header>
                {contractEconomicsData.clientPendingItems.length > 0 ? (
                  <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
                    <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #f5c26b', background: '#fff7ed', color: '#92400e', display: 'grid', gap: 4 }}>
                      <strong>RETORNO PARCIAL · {contractEconomicsData.clientPendingUnits} unidad(es) todavía con el cliente</strong>
                      <span style={{ fontSize: 12 }}>No se consideran faltantes y no generan cargo mientras sigan registradas como pendientes de recojo.</span>
                    </div>
                    {contractEconomicsData.clientPendingItems.map((pending) => (
                      <div key={pending.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(180px,.9fr)', gap: 10, alignItems: 'center', padding: '9px 11px', border: '1px solid #fde3b4', borderRadius: 9, background: '#fffaf0' }}>
                        <strong>{pending.itemName}</strong>
                        <span style={{ fontWeight: 900, color: '#b45309' }}>{pending.pendingQty} con cliente</span>
                        <span style={{ color: '#7c5b24', fontSize: 12 }}>{pending.note || 'Pendiente de recojo'}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {contractEconomicsData.returnIssues.length > 0 ? (
                  <div className="contract-economics-issues">
                    {contractEconomicsData.returnIssues.map((issue) => (
                      <div
                        key={issue.id}
                        className={contractEconomicsData.damagesSettled ? 'is-cancelled' : ''}
                        style={contractEconomicsData.damagesSettled ? {
                          background: '#ecfdf3',
                          borderColor: '#86efac',
                          color: '#166534',
                        } : undefined}
                      >
                        <strong>{issue.itemName}</strong>
                        <span>Danado: {issue.damagedQty} | Faltante: {issue.missingQty}</span>
                        <span>
                          {contractEconomicsData.damagesSettled
                            ? `CANCELADO | Cargo cobrado: ${formatBs(issue.penaltyBs)}`
                            : `Cargo: ${formatBs(issue.penaltyBs)} | Origen: ${issue.owner}`}
                        </span>
                        {!contractEconomicsData.damagesSettled && !readOnly ? (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => openReturnChargeEditor(issue)}
                            disabled={isSavingReturnCharge}
                            style={{
                              minHeight: 30,
                              padding: '0 10px',
                              fontSize: 12,
                              justifySelf: 'end',
                            }}
                          >
                            <Pencil size={13} aria-hidden="true" />
                            Editar cargo
                          </button>
                        ) : null}
                        {returnChargeEditIssue?.id === issue.id ? (
                          <div
                            style={{
                              gridColumn: '1 / -1',
                              display: 'grid',
                              gridTemplateColumns: issue.damagedQty > 0 && issue.missingQty > 0
                                ? 'repeat(2, minmax(0, 1fr)) auto'
                                : 'minmax(0, 1fr) auto',
                              gap: 10,
                              alignItems: 'end',
                              padding: 10,
                              borderRadius: 9,
                              background: '#fff',
                              border: '1px solid #fed7aa',
                            }}
                          >
                            {issue.damagedQty > 0 ? (
                              <label style={{ display: 'grid', gap: 4 }}>
                                <span style={{ fontSize: 11, fontWeight: 800 }}>Precio unitario dañado</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={returnChargeEditDraft.damagedUnitChargeBs}
                                  onChange={(event) => setReturnChargeEditDraft((current) => ({
                                    ...current,
                                    damagedUnitChargeBs: event.target.value,
                                  }))}
                                  disabled={isSavingReturnCharge}
                                  style={{ minHeight: 34, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 9px' }}
                                />
                              </label>
                            ) : null}
                            {issue.missingQty > 0 ? (
                              <label style={{ display: 'grid', gap: 4 }}>
                                <span style={{ fontSize: 11, fontWeight: 800 }}>Precio unitario faltante</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={returnChargeEditDraft.missingUnitChargeBs}
                                  onChange={(event) => setReturnChargeEditDraft((current) => ({
                                    ...current,
                                    missingUnitChargeBs: event.target.value,
                                  }))}
                                  disabled={isSavingReturnCharge}
                                  style={{ minHeight: 34, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 9px' }}
                                />
                              </label>
                            ) : null}
                            <div style={{ display: 'flex', gap: 7 }}>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={closeReturnChargeEditor}
                                disabled={isSavingReturnCharge}
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                className="primary-button"
                                onClick={handleSaveReturnCharge}
                                disabled={isSavingReturnCharge}
                              >
                                {isSavingReturnCharge ? 'Guardando...' : 'Guardar'}
                              </button>
                            </div>
                            {returnChargeEditError ? (
                              <small style={{ gridColumn: '1 / -1', color: '#b91c1c', fontWeight: 700 }}>
                                {returnChargeEditError}
                              </small>
                            ) : null}
                          </div>
                        ) : null}
                        {issue.note ? <small>{issue.note}</small> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="contract-economics-empty">Sin danos, faltantes ni cargos registrados.</p>
                )}
              </article>
            </div>

            <footer className="orders-modal-foot">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  const row = contractEconomicsData.contract;
                  closeContractEconomics();
                  handleOpenDocumentsFromContract(row);
                }}
              >
                Ver documentos
              </button>
              <button type="button" className="primary-button" onClick={closeContractEconomics}>
                Cerrar
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {ledgerDateEditEntry ? (
        <div className="orders-modal-backdrop receipt-editor-backdrop" onClick={closeLedgerDateEditor}>
          <form
            className="orders-modal receipt-editor-modal ledger-date-editor-modal"
            onSubmit={handleSubmitLedgerDateEdit}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="orders-modal-head">
              <div>
                <h3>Editar fecha del movimiento</h3>
                <p>Solo cambiaran la fecha y la hora. El monto, metodo, detalle y saldos permaneceran iguales.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={closeLedgerDateEditor} disabled={isSavingContractEconomicsLedger}>
                x
              </button>
            </header>

            <div className="receipt-editor-body ledger-date-editor-body">
              <div className="ledger-date-editor-summary">
                <span>Movimiento</span>
                <strong>{ECONOMIC_LEDGER_TYPE_META[ledgerDateEditEntry.type]?.label ?? 'Movimiento economico'}</strong>
                <small>{ledgerDateEditEntry.type === 'note' ? ledgerDateEditEntry.note : formatBs(ledgerDateEditEntry.amountBs)}</small>
              </div>
              <label>
                <span>Nueva fecha y hora</span>
                <input
                  type="datetime-local"
                  value={ledgerDateEditValue}
                  onChange={(event) => setLedgerDateEditValue(event.target.value)}
                  autoFocus
                  required
                />
                <small>{ledgerDateEditEntry.cashMovementId ? 'El recibo vinculado mostrara esta misma fecha.' : 'Los demas datos de la linea no se modificaran.'}</small>
              </label>
              {ledgerDateEditError ? <p className="receipt-editor-error receipt-editor-field-wide">{ledgerDateEditError}</p> : null}
            </div>

            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={closeLedgerDateEditor} disabled={isSavingContractEconomicsLedger}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isSavingContractEconomicsLedger}>
                {isSavingContractEconomicsLedger ? 'Guardando...' : 'Guardar fecha'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {receiptEditMovement ? (
        <div className="orders-modal-backdrop receipt-editor-backdrop" onClick={closeReceiptEditor}>
          <form
            className="orders-modal receipt-editor-modal"
            onSubmit={handleSubmitReceiptEdit}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="orders-modal-head">
              <div>
                <h3>Editar datos del recibo</h3>
                <p>Corrige la informacion impresa. El monto y los saldos contables no se modifican.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={closeReceiptEditor} disabled={isSavingReceiptEdit}>
                x
              </button>
            </header>

            <div className="receipt-editor-body">
              <label>
                <span>Numero de recibo</span>
                <input
                  value={receiptEditDraft.receiptCode}
                  onChange={(event) => setReceiptEditDraft((current) => ({ ...current, receiptCode: event.target.value }))}
                  placeholder="Ej. RC-11071 o numero fisico"
                  required
                />
                <small>Puede coincidir con el numero de un recibo fisico anterior.</small>
              </label>

              <label>
                <span>Cliente / receptor</span>
                <input
                  value={receiptEditDraft.receiptCustomerName}
                  onChange={(event) => setReceiptEditDraft((current) => ({ ...current, receiptCustomerName: event.target.value }))}
                  placeholder="Nombre que aparecera en el recibo"
                  required
                />
              </label>

              <label>
                <span>Fecha y hora</span>
                <input
                  type="datetime-local"
                  value={receiptEditDraft.createdAt}
                  onChange={(event) => setReceiptEditDraft((current) => ({ ...current, createdAt: event.target.value }))}
                  required
                />
              </label>

              <label>
                <span>Metodo de pago</span>
                <select
                  value={receiptEditDraft.paymentMethod}
                  onChange={(event) => setReceiptEditDraft((current) => ({
                    ...current,
                    paymentMethod: event.target.value,
                    paymentAccount: event.target.value === 'qr' ? current.paymentAccount : '',
                  }))}
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="qr">QR</option>
                  <option value="transferencia">Transferencia</option>
                </select>
              </label>

              {receiptEditDraft.paymentMethod === 'qr' ? (
                <label>
                  <span>Cuenta QR / banco</span>
                  <select
                    value={receiptEditDraft.paymentAccount}
                    onChange={(event) => setReceiptEditDraft((current) => ({ ...current, paymentAccount: event.target.value }))}
                    required
                  >
                    <option value="">Seleccionar cuenta</option>
                    {QR_ACCOUNT_OPTIONS.map((account) => (
                      <option key={account} value={account}>{account}</option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="receipt-editor-field-wide">
                <span>Detalle del recibo</span>
                <textarea
                  rows={4}
                  value={receiptEditDraft.receiptDetail}
                  onChange={(event) => setReceiptEditDraft((current) => ({ ...current, receiptDetail: event.target.value }))}
                  placeholder="Describe claramente el concepto del pago o movimiento"
                  required
                />
              </label>

              <label className="receipt-editor-field-wide">
                <span>Observacion interna</span>
                <textarea
                  rows={2}
                  value={receiptEditDraft.notes}
                  onChange={(event) => setReceiptEditDraft((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Nota opcional"
                />
              </label>

              {receiptEditError ? <p className="receipt-editor-error receipt-editor-field-wide">{receiptEditError}</p> : null}
            </div>

            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={closeReceiptEditor} disabled={isSavingReceiptEdit}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isSavingReceiptEdit}>
                {isSavingReceiptEdit ? 'Guardando...' : 'Guardar correccion'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {whatsAppModal ? (
        <div className="orders-modal-backdrop" onClick={() => setWhatsAppModal(null)}>
          <section className="orders-modal whatsapp-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>{whatsAppModal.title}</h3>
                <p>Selecciona el documento, revisa el mensaje y abre WhatsApp con la conversacion preparada.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setWhatsAppModal(null)}>
                x
              </button>
            </header>
            <div className="whatsapp-modal-body">
              <label>
                WhatsApp del cliente
                <input
                  value={whatsAppModal.phone}
                  onChange={(event) => updateWhatsAppModal({ phone: event.target.value, error: '' })}
                  placeholder="Ej. 59170000000"
                />
              </label>
              <label>
                Documento
                <select value={whatsAppModal.selectedDocumentId} onChange={(event) => updateWhatsAppDocument(event.target.value)}>
                  {whatsAppModal.documentOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <article className="whatsapp-document-summary">
                <button type="button" className="whatsapp-document-title" onClick={previewWhatsAppDocument}>
                  {whatsAppModal.documentOptions.find((option) => option.id === whatsAppModal.selectedDocumentId)?.label}
                </button>
                <span>{whatsAppModal.documentOptions.find((option) => option.id === whatsAppModal.selectedDocumentId)?.description}</span>
                <small>
                  Se cargara el mensaje en WhatsApp. Si necesitas enviar el PDF, revisalo y adjuntalo manualmente desde la vista previa.
                </small>
              </article>
              <label className="whatsapp-message-field">
                Mensaje
                <textarea
                  value={whatsAppModal.message}
                  onChange={(event) => updateWhatsAppModal({ message: event.target.value, error: '' })}
                  rows={5}
                />
              </label>
              {whatsAppModal.error ? <p className="status error">{whatsAppModal.error}</p> : null}
            </div>
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setWhatsAppModal(null)}>
                Cancelar
              </button>
              <button type="button" className="whatsapp-send-button" onClick={sendWhatsAppMessage}>
                <WhatsAppGlyph />
                Abrir WhatsApp
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {supplierCoverageModal ? (
        <div className="orders-modal-backdrop supplier-coverage-backdrop" onClick={() => closeSupplierCoverageModal()}>
          <section className="orders-modal supplier-coverage-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>Cobertura con proveedor</h3>
                <p>
                  {supplierCoverageModal.manualMode
                    ? `${supplierCoverageModal.itemName}: puedes decidir cuantas unidades cubrir con proveedor.`
                    : `${supplierCoverageModal.itemName} tiene faltante de ${supplierCoverageModal.shortageQty} u.`}
                  {' '}
                  {supplierCoverageModal.manualMode
                    ? 'La cantidad del proveedor se suma a la cantidad propia.'
                    : `Maximo proveedor: ${supplierCoverageModal.coverLimitQty ?? supplierCoverageModal.remainingShortageQty ?? supplierCoverageModal.shortageQty} u.`}
                </p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => closeSupplierCoverageModal()}>
                x
              </button>
            </header>

            <div className="supplier-coverage-body">
              <div className="supplier-coverage-switch">
                <button
                  type="button"
                  className={supplierCoverageDraft.supplierMode === 'existing' ? 'active' : ''}
                  onClick={() => setSupplierCoverageDraftField('supplierMode', 'existing')}
                >
                  Buscar existente
                </button>
                <button
                  type="button"
                  className={supplierCoverageDraft.supplierMode === 'new' ? 'active' : ''}
                  onClick={() => setSupplierCoverageDraftField('supplierMode', 'new')}
                >
                  Crear proveedor
                </button>
              </div>

              {supplierCoverageDraft.supplierMode === 'existing' ? (
                <label className="supplier-coverage-field wide">
                  Proveedor
                  <select
                    value={supplierCoverageDraft.supplierId}
                    onChange={(event) => {
                      const supplierId = event.target.value;
                      const supplier = (supplierBundle?.suppliers ?? []).find((entry) => String(entry.id) === supplierId);
                      setSupplierCoverageDraft((current) => ({
                        ...current,
                        supplierId,
                        supplierName: supplier?.name ?? '',
                      }));
                    }}
                  >
                    <option value="">Seleccionar proveedor...</option>
                    {(supplierBundle?.suppliers ?? []).map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}{supplier.phone ? ` - ${supplier.phone}` : ''}
                      </option>
                    ))}
                  </select>
                  {(supplierBundle?.suppliers ?? []).length === 0 ? (
                    <small>No hay proveedores creados todavia. Cambia a "Crear proveedor".</small>
                  ) : null}
                </label>
              ) : (
                <div className="supplier-coverage-grid">
                  <label className="supplier-coverage-field">
                    Nombre del proveedor *
                    <input value={supplierCoverageDraft.supplierName} onChange={(event) => setSupplierCoverageDraftField('supplierName', event.target.value)} placeholder="Ej. Sillas Don Luis" />
                  </label>
                  <label className="supplier-coverage-field">
                    Contacto
                    <input value={supplierCoverageDraft.contactName} onChange={(event) => setSupplierCoverageDraftField('contactName', event.target.value)} placeholder="Persona de contacto" />
                  </label>
                  <label className="supplier-coverage-field">
                    Celular
                    <input value={supplierCoverageDraft.phone} onChange={(event) => setSupplierCoverageDraftField('phone', event.target.value)} placeholder="Numero" />
                  </label>
                  <label className="supplier-coverage-field">
                    WhatsApp
                    <input value={supplierCoverageDraft.whatsapp} onChange={(event) => setSupplierCoverageDraftField('whatsapp', event.target.value)} placeholder="Opcional" />
                  </label>
                </div>
              )}

              <div className="supplier-coverage-grid">
                <label className="supplier-coverage-field">
                  Categoria *
                  <input value={supplierCoverageDraft.category} onChange={(event) => setSupplierCoverageDraftField('category', event.target.value)} placeholder="Sillas, mesas..." />
                </label>
                <label className="supplier-coverage-field">
                  Nombre / modelo *
                  <input value={supplierCoverageDraft.itemName} onChange={(event) => setSupplierCoverageDraftField('itemName', event.target.value)} placeholder="Tiffany, Crossback..." />
                </label>
                <label className="supplier-coverage-field">
                  Color
                  <input value={supplierCoverageDraft.color} onChange={(event) => setSupplierCoverageDraftField('color', event.target.value)} placeholder="Blanco, dorado..." />
                </label>
                <label className="supplier-coverage-field">
                  Material
                  <input value={supplierCoverageDraft.material} onChange={(event) => setSupplierCoverageDraftField('material', event.target.value)} placeholder="Madera, metal..." />
                </label>
                <label className="supplier-coverage-field">
                  Cantidad a cubrir
                  <input type="text" inputMode="numeric" value={supplierCoverageDraft.quantity} onFocus={selectNumericInput} onChange={(event) => setSupplierCoverageDraftField('quantity', event.target.value)} />
                  <small>
                    {supplierCoverageModal.manualMode
                      ? 'Proveedor se suma aparte. Ej.: propio 70 + proveedor 130 = contrato 200.'
                      : `Maximo proveedor: ${supplierCoverageModal.coverLimitQty ?? supplierCoverageModal.remainingShortageQty ?? supplierCoverageModal.shortageQty} u.`}
                    {!supplierCoverageModal.manualMode && supplierCoverageModal.shortageQty > 0 ? ` Faltante automatico: ${supplierCoverageModal.remainingShortageQty ?? supplierCoverageModal.shortageQty} u.` : ''}
                  </small>
                </label>
                <label className="supplier-coverage-field">
                  Costo proveedor Bs
                  <input type="text" inputMode="decimal" value={supplierCoverageDraft.supplierUnitCostBs} onFocus={selectNumericInput} onChange={(event) => setSupplierCoverageDraftField('supplierUnitCostBs', event.target.value)} />
                  <small>Puede ser 0 para taller interno, reparacion propia o apoyo sin costo.</small>
                </label>
                <label className="supplier-coverage-field">
                  Precio cliente Bs
                  <input type="text" inputMode="decimal" value={supplierCoverageDraft.saleUnitPriceBs} onFocus={selectNumericInput} onChange={(event) => setSupplierCoverageDraftField('saleUnitPriceBs', event.target.value)} />
                  <small>Puede ser 0 si no debe afectar el total del contrato.</small>
                </label>
                <label className="supplier-coverage-field wide">
                  Notas internas
                  <input value={supplierCoverageDraft.notes} onChange={(event) => setSupplierCoverageDraftField('notes', event.target.value)} placeholder="Ej. verificar reparacion para la fecha, condiciones, entrega..." />
                </label>
              </div>

              <div className="supplier-coverage-summary">
                <article>
                  <span>Costo proveedor</span>
                  <strong>{formatBs(Math.max(0, parseIntegerInput(supplierCoverageDraft.quantity, 0)) * Math.max(0, parseMoneyInput(supplierCoverageDraft.supplierUnitCostBs, 0)))}</strong>
                </article>
                <article>
                  <span>Venta al cliente</span>
                  <strong>{formatBs(Math.max(0, parseIntegerInput(supplierCoverageDraft.quantity, 0)) * Math.max(0, parseMoneyInput(supplierCoverageDraft.saleUnitPriceBs, 0)))}</strong>
                </article>
                <article>
                  <span>Margen estimado</span>
                  <strong>{formatBs((Math.max(0, parseIntegerInput(supplierCoverageDraft.quantity, 0)) * Math.max(0, parseMoneyInput(supplierCoverageDraft.saleUnitPriceBs, 0))) - (Math.max(0, parseIntegerInput(supplierCoverageDraft.quantity, 0)) * Math.max(0, parseMoneyInput(supplierCoverageDraft.supplierUnitCostBs, 0))))}</strong>
                </article>
              </div>

              {supplierCoverageError ? <p className="orders-modal-error">{supplierCoverageError}</p> : null}
            </div>

            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => closeSupplierCoverageModal()}>
                Cancelar
              </button>
              <button type="button" className="primary-button" onClick={saveSupplierCoverageFromModal} disabled={isSavingSupplierCoverage}>
                {isSavingSupplierCoverage ? 'Guardando...' : 'Guardar y cubrir faltante'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {clientPendingDetail ? (
        <div className="orders-modal-backdrop" onClick={() => setClientPendingDetail(null)}>
          <section
            className="orders-modal"
            onClick={(event) => event.stopPropagation()}
            style={{ width: 'min(680px, calc(100vw - 28px))', maxHeight: 'min(76vh, 720px)', overflow: 'hidden' }}
          >
            <header className="orders-modal-head">
              <div>
                <span style={{ color: '#b45309', fontSize: 11, fontWeight: 850, textTransform: 'uppercase' }}>Material con cliente</span>
                <h3 style={{ marginTop: 3 }}>Contrato {clientPendingDetail.contractCode || '—'}</h3>
                <p>{clientPendingDetail.customerName || 'Cliente'}{clientPendingDetail.orderCode ? ` · ${clientPendingDetail.orderCode}` : ''}</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setClientPendingDetail(null)} aria-label="Cerrar detalle">
                x
              </button>
            </header>

            <div style={{ padding: '16px 18px 18px', overflowY: 'auto', display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 9 }}>
                <div style={{ border: '1px solid #fde3b4', background: '#fffaf0', borderRadius: 10, padding: '10px 12px' }}>
                  <small style={{ color: '#92400e', fontWeight: 750 }}>PENDIENTE</small>
                  <strong style={{ display: 'block', marginTop: 3, color: '#b45309', fontSize: 22 }}>{clientPendingDetail.clientPendingUnits}</strong>
                  <small>unidad(es)</small>
                </div>
                <div style={{ border: '1px solid #e2e8f0', background: '#fff', borderRadius: 10, padding: '10px 12px' }}>
                  <small style={{ color: '#64748b', fontWeight: 750 }}>REGISTRADO POR</small>
                  <strong style={{ display: 'block', marginTop: 5 }}>{clientPendingDetail.clientPendingPickup?.registeredByName || clientPendingDetail.responsibleName || 'Inventario'}</strong>
                  <small>{clientPendingDetail.clientPendingPickup?.registeredByRole || ''}</small>
                </div>
                <div style={{ border: '1px solid #e2e8f0', background: '#fff', borderRadius: 10, padding: '10px 12px' }}>
                  <small style={{ color: '#64748b', fontWeight: 750 }}>FECHA</small>
                  <strong style={{ display: 'block', marginTop: 5 }}>{clientPendingDetail.clientPendingPickup?.registeredAt ? formatDateTime(clientPendingDetail.clientPendingPickup.registeredAt) : 'Sin fecha'}</strong>
                  <small>última recepción parcial</small>
                </div>
              </div>

              {clientPendingDetail.clientPendingPickup?.note ? (
                <div style={{ border: '1px solid #f5c26b', background: '#fff7ed', borderRadius: 10, padding: '10px 12px', color: '#92400e' }}>
                  <small style={{ fontWeight: 850 }}>OBSERVACIÓN GENERAL</small>
                  <div style={{ marginTop: 4, fontWeight: 650 }}>{clientPendingDetail.clientPendingPickup.note}</div>
                </div>
              ) : null}

              <div style={{ display: 'grid', gap: 8 }}>
                <strong style={{ color: '#173a70' }}>Detalle pendiente</strong>
                {(Array.isArray(clientPendingDetail.clientPendingPickup?.items) ? clientPendingDetail.clientPendingPickup.items : []).map((item, index) => (
                  <article
                    key={item.lineKey || item.itemId || `${item.itemName}-${index}`}
                    style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', background: '#fff' }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block' }}>{item.itemName || 'Ítem'}</strong>
                      {item.note ? <small style={{ display: 'block', marginTop: 3, color: '#64748b' }}>{item.note}</small> : null}
                      {Number(item.expectedQty ?? 0) > 0 ? <small style={{ display: 'block', marginTop: 2, color: '#94a3b8' }}>Cantidad original: {item.expectedQty}</small> : null}
                    </div>
                    <div style={{ minWidth: 84, textAlign: 'center', border: '1px solid #f5c26b', background: '#fff7ed', borderRadius: 9, padding: '7px 10px' }}>
                      <small style={{ display: 'block', color: '#92400e', fontWeight: 750 }}>CON CLIENTE</small>
                      <strong style={{ color: '#b45309', fontSize: 20 }}>{item.pendingQty}</strong>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <footer className="orders-modal-foot">
              <button type="button" className="primary-button" onClick={() => setClientPendingDetail(null)}>Cerrar</button>
            </footer>
          </section>
        </div>
      ) : null}

      {documentsOrder ? (
        <div className="orders-modal-backdrop" onClick={handleCloseDocumentsPanel}>
          <div className="orders-modal orders-documents-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>Centro documental {documentsOrder.orderCode}</h3>
                <p>Consulta centralizada del contrato y su documento de inventario.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={handleCloseDocumentsPanel}>
                x
              </button>
            </header>

            <div className="orders-documents-body">
              <section className="orders-documents-summary">
                <article>
                  <small>Contrato</small>
                  <strong>{documentsOrder.contractCode || documentsOrder.orderCode}</strong>
                </article>
                <article>
                  <small>Documentos</small>
                  <strong>{documentOverviewRows.length} totales</strong>
                </article>
                <article>
                  <small>Orden vinculada</small>
                  <strong>{documentsOrder.orderCode || 'Pendiente'}</strong>
                </article>
                <article>
                  <small>Tabla de cambios</small>
                  <strong>{documentsHistoryLoading ? 'Cargando...' : `${selectedDocumentsChangeRows.length} cambios`}</strong>
                </article>
              </section>

              {selectedDocumentsClosureSummary ? (
                <section className="orders-documents-panel orders-contract-control-panel">
                  <div className="orders-documents-section-head">
                    <div>
                      <h4>Estado completo del contrato</h4>
                      <p>Actualizacion, economia, movimientos y cierre para enviar al cliente cuando termine.</p>
                    </div>
                    <span className={`orders-contract-close-pill ${selectedDocumentsClosureSummary.isFinalized ? 'is-finalized' : selectedDocumentsClosureSummary.canClose ? 'is-ready' : 'is-pending'}`}>
                      {selectedDocumentsClosureSummary.finalLabel}
                    </span>
                  </div>

                  <div className="orders-contract-control-grid">
                    <article>
                      <span>Contrato</span>
                      <strong>{selectedDocumentsClosureSummary.contract?.contractCode || documentsOrder.contractCode || documentsOrder.orderCode}</strong>
                      <small>{selectedDocumentsClosureSummary.contract?.customerName || selectedDocumentsContractRow?.customerName || 'Cliente'}</small>
                    </article>
                    <article>
                      <span>Entrega</span>
                      <strong>{selectedDocumentsClosureSummary.isSent ? 'Con salida' : 'Pendiente'}</strong>
                      <small className={`orders-status-badge ${selectedDocumentsClosureSummary.inventoryClass}`}>{selectedDocumentsClosureSummary.inventoryLabel}</small>
                    </article>
                    <article>
                      <span>Devolucion</span>
                      <strong>{selectedDocumentsClosureSummary.isReturned ? 'Con retorno' : 'Pendiente'}</strong>
                      <small className={`orders-status-badge ${selectedDocumentsClosureSummary.transportClass}`}>{selectedDocumentsClosureSummary.transportLabel}</small>
                    </article>
                    <article className={selectedDocumentsClosureSummary.dueBs > 0 ? 'is-due' : 'is-ok'}>
                      <span>Economico</span>
                      <strong>{selectedDocumentsClosureSummary.dueBs > 0 ? formatBs(selectedDocumentsClosureSummary.dueBs) : 'Pagado'}</strong>
                      <small>{selectedDocumentsClosureSummary.ledgerCount} linea(s) en cuaderno</small>
                    </article>
                    <article className={selectedDocumentsClosureSummary.hasDamages ? 'is-due' : 'is-ok'}>
                      <span>Danos / faltantes</span>
                      <strong>{selectedDocumentsClosureSummary.hasDamages ? formatBs(selectedDocumentsClosureSummary.ledgerTotals.chargesBs) : 'Sin novedades'}</strong>
                      <small>{selectedDocumentsClosureSummary.returnIssues.length} item(s) observados</small>
                    </article>
                    <article>
                      <span>Garantia</span>
                      <strong>{selectedDocumentsClosureSummary.guaranteeStatusLabel}</strong>
                      <small>Devuelto: {formatBs(selectedDocumentsClosureSummary.ledgerTotals.refundedBs)}</small>
                    </article>
                    <article>
                      <span>Recibos</span>
                      <strong>{selectedDocumentsClosureSummary.receiptCount || 'Sin recibos'}</strong>
                      <small>{selectedDocumentsClosureSummary.receiptCodes.slice(0, 2).join(', ') || 'Aun sin cobro registrado'}</small>
                    </article>
                  </div>

                  <div className="orders-contract-control-actions">
                    <button type="button" className="ghost-button" onClick={handleEditContractFromDocuments} disabled={!selectedDocumentsContractRow && !selectedDocumentsContract}>
                      <Pencil aria-hidden="true" />
                      Actualizar contrato
                    </button>
                    <button type="button" className="ghost-button" onClick={handleOpenEconomicsFromDocuments} disabled={!selectedDocumentsContractRow && !selectedDocumentsContract}>
                      <BookOpen aria-hidden="true" />
                      Economico
                    </button>
                    <button
                      type="button"
                      className={`orders-finalized-check ${selectedDocumentsClosureSummary.isFinalized ? 'is-checked' : ''}`}
                      onClick={() => handleToggleContractFinalized(selectedDocumentsContractRow ?? selectedDocumentsContract, !selectedDocumentsClosureSummary.isFinalized)}
                      disabled={
                        (!selectedDocumentsContractRow && !selectedDocumentsContract)
                        || finalizingContractIds.has((selectedDocumentsContractRow ?? selectedDocumentsContract)?.id)
                      }
                      title={selectedDocumentsClosureSummary.isFinalized ? 'Contrato finalizado' : 'Marcar contrato finalizado'}
                      aria-pressed={selectedDocumentsClosureSummary.isFinalized}
                    >
                      {selectedDocumentsClosureSummary.isFinalized ? <Check aria-hidden="true" /> : 'F'}
                    </button>
                    <button type="button" className="primary-button" onClick={handleSendClosureFromDocuments} disabled={!selectedDocumentsContractRow && !selectedDocumentsContract}>
                      <MessageCircle aria-hidden="true" />
                      Enviar cierre
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="orders-documents-panel">
                <div className="orders-documents-section-head">
                  <div>
                    <h4>Documentos actuales</h4>
                    <p>Contrato e inventario disponibles para consultar o imprimir.</p>
                  </div>
                  <button type="button" className="primary-button" onClick={() => handleGenerateDocuments(documentsOrder)}>
                    Generar / actualizar
                  </button>
                </div>

                <div className="orders-documents-main-grid">
                  {documentOverviewRows.map((doc) => (
                    <article key={doc.id} className="orders-document-card">
                      <div className="orders-document-card-head">
                        <span className="orders-document-icon">{doc.format}</span>
                        <span className={`orders-status-badge ${doc.statusClass}`}>{doc.status}</span>
                      </div>
                      <div className="orders-document-main">
                        <strong>{doc.title}</strong>
                        <small>{doc.description}</small>
                      </div>
                      <div className="orders-document-card-foot">
                        <span className="orders-document-meta">{doc.generatedAt ? formatDateTime(doc.generatedAt) : 'Sin generar'}</span>
                        <button
                          type="button"
                          className="ghost-button orders-document-open-button"
                          onClick={() => handlePrintOrderDocument(doc.kind, documentsOrder)}
                        >
                          Abrir
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="orders-documents-panel">
                <div className="orders-documents-section-head">
                  <div>
                    <h4>Tabla de cambios</h4>
                    <p>Historial completo del contrato, separado del documento imprimible.</p>
                  </div>
                </div>

                <div className="orders-change-table-wrap">
                  <table className="orders-change-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Usuario</th>
                        <th>Cambios</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDocumentsChangeRows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.updatedAt ? formatDateTime(row.updatedAt) : '-'}</td>
                          <td>{row.updatedBy}</td>
                          <td>
                            {row.changes.map((change, index) => (
                              <span key={`${row.id}-${index}`}>{change}</span>
                            ))}
                          </td>
                        </tr>
                      ))}
                      {documentsHistoryLoading ? (
                        <tr><td colSpan={3}>Cargando historial completo del contrato...</td></tr>
                      ) : documentsHistoryError ? (
                        <tr><td colSpan={3}>{documentsHistoryError}</td></tr>
                      ) : selectedDocumentsChangeRows.length === 0 ? (
                        <tr><td colSpan={3}>Sin cambios registrados para este contrato.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="orders-documents-panel">
                <div className="orders-documents-section-head">
                  <div>
                    <h4>Historial de versiones</h4>
                    <p>Solo muestra versiones anteriores para evitar repetir los documentos actuales.</p>
                  </div>
                </div>

                <div className="orders-documents-list compact">
                  {historicalDocumentsForSelectedOrder.length > 0 ? (
                    historicalDocumentsForSelectedOrder.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        className="orders-document-row compact"
                        onClick={() => handleOpenStoredDocument(doc)}
                      >
                        <span className="orders-document-icon">{doc.format || 'PDF'}</span>
                        <span className="orders-document-main">
                          <strong>{doc.name}</strong>
                          <small>{doc.category || 'Documento'} | {formatDateTime(doc.generatedAt)}</small>
                        </span>
                        <span className="orders-document-meta">{DOCUMENT_SOURCE_LABELS[doc.sourceType] || 'Documento'}</span>
                      </button>
                    ))
                  ) : (
                    <p className="status">No hay versiones anteriores. Todo lo vigente esta en "Documentos actuales".</p>
                  )}
                </div>
              </section>
            </div>

            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={handleCloseDocumentsPanel}>
                Cerrar
              </button>
              <button type="button" className="ghost-button" onClick={handleOpenReportsClick}>
                Ir a reportes
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {selectedOperationalOrder ? (
        <div className="orders-modal-backdrop" onClick={handleCloseOperationalPanel}>
          <div className="orders-modal orders-operational-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>Orden operativa {selectedOperationalOrder.orderCode}</h3>
                <p>Revisa y confirma lo que se enviara a Inventario y Transporte.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={handleCloseOperationalPanel}>
                x
              </button>
            </header>

            <div className="orders-operational-grid">
              <article className="orders-operational-card">
                <div className="orders-operational-card-head">
                  <div>
                    <h4>Inventario</h4>
                    <p>{selectedOperationalOrder.eventMeta} para alistar</p>
                  </div>
                  <span className={`orders-status-badge ${OPERATIONAL_STATUS_META[selectedOperationalOrder.inventoryStatus]?.className ?? 'pending'}`}>
                    {OPERATIONAL_STATUS_META[selectedOperationalOrder.inventoryStatus]?.label ?? 'Pendiente'}
                  </span>
                </div>
                <div className="orders-operational-detail">
                  <strong>Debe estar listo</strong>
                  <span>{formatDate(selectedOperationalOrder.deliveryAt)} | {selectedOperationalOrder.serviceTime}</span>
                </div>
                <div className="orders-operational-items">
                  {(selectedOperationalOrder.items ?? []).map((line) => (
                    <span key={line.itemId}>{line.quantity}x {line.itemName}</span>
                  ))}
                </div>
                <label className="orders-note-field">
                  Nota para inventario
                  <textarea
                    value={operationalDraft.inventoryNote}
                    onChange={(event) => setOperationalDraft((current) => ({ ...current, inventoryNote: event.target.value }))}
                    placeholder="Ej: dejar embalado por categoria y separado en sector despacho."
                  />
                </label>
                <div className="orders-operational-actions">
                  <button type="button" className="ghost-button" onClick={() => handlePrintOrderDocument('inventory', selectedOperationalOrder)}>
                    Ver documento
                  </button>
                  <button type="button" className="primary-button" onClick={() => handleUpdateOperationalStatus('inventory', 'enviado')} disabled={isSubmitting}>
                    Enviar a inventario
                  </button>
                  <button type="button" className="ghost-button" onClick={() => handleUpdateOperationalStatus('inventory', 'confirmado')} disabled={isSubmitting}>
                    Confirmar listo
                  </button>
                </div>
              </article>

              <article className="orders-operational-card">
                <div className="orders-operational-card-head">
                  <div>
                    <h4>Transporte</h4>
                    <p>{selectedOperationalOrder.deliveryMeta}</p>
                  </div>
                  <span className={`orders-status-badge ${OPERATIONAL_STATUS_META[selectedOperationalOrder.transportStatus]?.className ?? 'pending'}`}>
                    {OPERATIONAL_STATUS_META[selectedOperationalOrder.transportStatus]?.label ?? 'Pendiente'}
                  </span>
                </div>
                <div className="orders-operational-detail">
                  <strong>Ruta programada</strong>
                  <span>{formatDate(selectedOperationalOrder.deliveryAt)} | entrega y recojo vinculados</span>
                </div>
                <div className="orders-operational-items">
                  <span>Cliente: {selectedOperationalOrder.client}</span>
                  <span>Orden: {selectedOperationalOrder.orderCode}</span>
                  <span>Contrato: {selectedOperationalOrder.contractLabel}</span>
                </div>
                <label className="orders-note-field">
                  Nota para transporte
                  <textarea
                    value={operationalDraft.transportNote}
                    onChange={(event) => setOperationalDraft((current) => ({ ...current, transportNote: event.target.value }))}
                    placeholder="Ej: confirmar acceso, montaje, firma de contrato y horario de recojo."
                  />
                </label>
                <div className="orders-operational-actions">
                  <button type="button" className="ghost-button" onClick={() => handlePrintOrderDocument('route', selectedOperationalOrder)}>
                    Ver hoja de ruta
                  </button>
                  <button type="button" className="primary-button" onClick={() => handleUpdateOperationalStatus('transport', 'enviado')} disabled={isSubmitting}>
                    Enviar a transporte
                  </button>
                  <button type="button" className="ghost-button" onClick={() => handleUpdateOperationalStatus('transport', 'confirmado')} disabled={isSubmitting}>
                    Confirmar ruta
                  </button>
                </div>
              </article>
            </div>

            {formError ? <p className="status error">{formError}</p> : null}

            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={handleCloseOperationalPanel} disabled={isSubmitting}>
                Cerrar
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {quoteApprovalPreview ? (
        <div className="orders-modal-backdrop" onClick={() => (isSubmitting ? null : setQuoteApprovalPreview(null))}>
          <div className="orders-modal orders-preview-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>Cotizacion {quoteApprovalPreview.quoteCode}</h3>
                <p>Revisa el documento antes de aprobar y generar el contrato comercial.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setQuoteApprovalPreview(null)} disabled={isSubmitting}>
                x
              </button>
            </header>
            <div className="orders-preview-body">
              {quoteApprovalPreview.__previewLoading ? (
                <div className="orders-document-loading">Generando cotizacion...</div>
              ) : quoteApprovalPreview.__previewBlobUrl ? (
                <iframe
                  title={`Cotizacion ${quoteApprovalPreview.quoteCode}`}
                  src={quoteApprovalPreview.__previewBlobUrl}
                  className="orders-document-frame"
                />
              ) : (
                <div className="orders-document-loading">No se pudo cargar la vista previa.</div>
              )}
            </div>
            {formError ? <p className="status error orders-modal-error">{formError}</p> : null}
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setQuoteApprovalPreview(null)} disabled={isSubmitting}>
                Cerrar
              </button>
              <button type="button" className="primary-button" onClick={confirmApproveQuoteClick} disabled={isSubmitting || quoteApprovalPreview.__previewLoading || !quoteApprovalPreview.__previewBlobUrl}>
                {isSubmitting ? 'Aprobando...' : 'Aprobar y crear contrato'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {availabilityContractDetail ? (
        <div className="orders-modal-backdrop availability-contract-backdrop" onClick={() => setAvailabilityContractDetail(null)}>
          <section className="orders-modal availability-contract-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>Contrato {availabilityContractDetail.code}</h3>
                <p>{availabilityContractDetail.customerName} · {availabilityContractDetail.eventType}</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setAvailabilityContractDetail(null)}>
                x
              </button>
            </header>
            <div className="availability-contract-body">
              <section className="availability-contract-summary">
                <article>
                  <span>Cliente</span>
                  <strong>{availabilityContractDetail.customerName}</strong>
                  <small>{availabilityContractDetail.phone || 'Sin telefono'}</small>
                </article>
                <article>
                  <span>Recojo / retorno</span>
                  <strong>{formatDate(availabilityContractDetail.pickupDate)}</strong>
                  <small>{availabilityContractDetail.pickupTime || 'Horario pendiente'}</small>
                </article>
                <article>
                  <span>Estado</span>
                  <strong>{availabilityContractDetail.status || 'Sin estado'}</strong>
                  <small>{formatBs(availabilityContractDetail.totalBs)}</small>
                </article>
              </section>
              <div className="availability-contract-items">
                <div className="availability-contract-items-head">
                  <span>Item</span>
                  <span>Cantidad</span>
                  <span>Precio</span>
                </div>
                {(availabilityContractDetail.items ?? []).slice(0, 8).map((item, index) => (
                  <div key={`${item.itemId || item.name || index}`} className="availability-contract-item-row">
                    <strong>{item.itemName || item.name || 'Item'}</strong>
                    <span>{Math.max(0, Number(item.quantity ?? 0))} u.</span>
                    <span>{formatBs(Number(item.rentalPriceBs ?? item.unitPriceBs ?? 0))}</span>
                  </div>
                ))}
                {(availabilityContractDetail.items ?? []).length > 8 ? (
                  <p className="status">Y {(availabilityContractDetail.items ?? []).length - 8} item(s) mas.</p>
                ) : null}
              </div>
            </div>
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setAvailabilityContractDetail(null)}>
                Cerrar
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {documentPreview ? (
        <div className="orders-modal-backdrop document-preview-backdrop" onClick={closeDocumentPreview}>
          <div className="orders-modal orders-preview-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>{documentPreview.title}</h3>
                <p>{documentPreview.kind === 'orders-report' ? 'Vista previa del reporte de Órdenes según los filtros actuales.' : 'Vista previa del documento. Puedes revisarlo e imprimirlo desde aqui.'}</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={closeDocumentPreview}>
                x
              </button>
            </header>
            <div className="orders-preview-body">
              {documentPreview.loading || !documentPreview.blobUrl ? (
                <div
                  className="orders-document-loading"
                  role="status"
                  aria-live="polite"
                  style={{
                    minHeight: '28rem',
                    display: 'grid',
                    placeItems: 'center',
                    alignContent: 'center',
                    gap: '0.6rem',
                    color: '#667085',
                    textAlign: 'center',
                  }}
                >
                  <RefreshCw aria-hidden="true" />
                  <strong>Preparando documento...</strong>
                  <span>Estamos cargando la versión completa y verificando que no falte ningún dato.</span>
                </div>
              ) : (
                isMobileContractPdfViewer() && documentPreview.mimeType === 'application/pdf' ? (
                  <div
                    className="orders-document-frame"
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      alignContent: 'center',
                      gap: '0.75rem',
                      padding: '1.5rem',
                      textAlign: 'center',
                      color: '#475467',
                      background: '#f8fafc',
                    }}
                  >
                    <strong>El PDF está listo.</strong>
                    <span>
                      Pulsa “Abrir PDF” para visualizarlo correctamente. Se abrirá en esta misma pestaña y podrás volver al sistema sin perder la sesión.
                    </span>
                  </div>
                ) : (
                  <iframe
                    id="orders-document-preview-frame"
                    title={documentPreview.title}
                    src={documentPreview.viewerUrl || documentPreview.blobUrl}
                    className="orders-document-frame"
                  />
                )
              )}
            </div>
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={closeDocumentPreview}>
                Cerrar
              </button>
              {documentPreview.kind === 'orders-report' ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={exportOrdersPreviewToExcel}
                  disabled={isExportingOrdersReport}
                >
                  {isExportingOrdersReport ? 'Generando Excel...' : 'Exportar a Excel'}
                </button>
              ) : null}
              {['contract', 'quote'].includes(documentPreview.kind) ? (
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.55rem',
                    marginLeft: 'auto',
                    fontWeight: 700,
                    color: '#344054',
                  }}
                >
                  Formato
                  <select
                    value={documentPreview.paperSize ?? 'oficio'}
                    onChange={handleContractPaperSizeChange}
                    disabled={documentPreview.loading}
                    style={{
                      minWidth: '7.5rem',
                      minHeight: '2.5rem',
                      padding: '0.35rem 0.65rem',
                      border: '1px solid #d0d5dd',
                      borderRadius: '0.65rem',
                      background: '#fff',
                      fontWeight: 700,
                    }}
                  >
                    <option value="carta">Carta</option>
                    <option value="oficio">Oficio</option>
                  </select>
                </label>
              ) : null}
              <button
                type="button"
                className="primary-button"
                onClick={handlePrintPreview}
                disabled={documentPreview.loading || !documentPreview.blobUrl}
              >
                {isMobileContractPdfViewer() && documentPreview.mimeType === 'application/pdf'
                  ? 'Abrir PDF'
                  : 'Imprimir / guardar PDF'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {orderToCancel ? (
        <div className="orders-modal-backdrop" onClick={closeCancelOrderDialog}>
          <div className="orders-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <span className="orders-confirm-icon">!</span>
              <div>
                <h3>Anular contrato y orden</h3>
                <p>
                  Se permite hasta el dia de envio. Si la fecha ya paso, solo se anulara cuando la orden nunca salio,
                  no fue entregada y no registra cobros. El contrato conservara su codigo y los items quedaran liberados.
                </p>
              </div>
            </header>

            <div className="orders-confirm-summary">
              <strong>{orderToCancel.contractCode || orderToCancel.orderCode}</strong>
              <span>{orderToCancel.client} · {formatBs(orderToCancel.totalBs)}</span>
              <small>
                La penalidad se aplicara dentro del plazo normal. Para una orden vencida que nunca salio y no tiene cobros,
                la anulacion administrativa no generara penalidad.
              </small>
            </div>

            <label className="orders-note-field">
              Motivo de anulacion
              <textarea
                ref={cancelReasonRef}
                defaultValue={String(orderToCancel?.cancellationReason ?? '').trim()}
                placeholder="Ej: cliente posterga el evento."
                required
              />
            </label>

            {formError ? <p className="status error">{formError}</p> : null}

            <footer>
              <button type="button" className="ghost-button" onClick={closeCancelOrderDialog} disabled={isSubmitting}>
                Cancelar
              </button>
              <button type="button" className="danger-button" onClick={confirmCancelOrder} disabled={isSubmitting}>
                {isSubmitting ? 'Anulando...' : 'Confirmar anulacion'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {quoteToDelete ? (
        <div className="orders-modal-backdrop" onClick={closeDeleteQuoteDialog}>
          <div className="orders-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <span className="orders-confirm-icon">!</span>
              <div>
                <h3>Eliminar cotizacion</h3>
                <p>Esta accion quitara la cotizacion del flujo comercial, pero conservara la trazabilidad interna.</p>
              </div>
            </header>

            <div className="orders-confirm-summary">
              <strong>{quoteToDelete.quoteCode}</strong>
              <span>{quoteToDelete.customerName} · {formatBs(quoteToDelete.totalBs)}</span>
            </div>

            {formError ? <p className="status error">{formError}</p> : null}

            <footer>
              <button type="button" className="ghost-button" onClick={closeDeleteQuoteDialog} disabled={isSubmitting}>
                Cancelar
              </button>
              <button type="button" className="danger-button" onClick={confirmDeleteQuote} disabled={isSubmitting}>
                {isSubmitting ? 'Eliminando...' : 'Eliminar cotizacion'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {contractToRevert ? (
        <div className="orders-modal-backdrop" onClick={closeRevertContractDialog}>
          <div className="orders-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <span className="orders-confirm-icon">!</span>
              <div>
                <h3>Volver contrato a cotizacion</h3>
                <p>Esta accion elimina el contrato del flujo, libera inventario y fechas, anula movimientos vinculados y deja la cotizacion original en borrador.</p>
              </div>
            </header>

            <div className="orders-confirm-summary">
              <strong>{contractToRevert.contractCode}</strong>
              <span>{contractToRevert.customerName} · {formatBs(contractToRevert.totalBs)}</span>
            </div>

            {formError ? <p className="status error">{formError}</p> : null}

            <footer>
              <button type="button" className="ghost-button" onClick={closeRevertContractDialog} disabled={isSubmitting}>
                Cancelar
              </button>
              <button type="button" className="danger-button" onClick={confirmRevertContract} disabled={isSubmitting}>
                {isSubmitting ? 'Revirtiendo...' : 'Volver a cotizacion'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {catalogModalOpen ? (
        <div className="orders-modal-backdrop orders-catalog-browser-backdrop" onClick={() => setCatalogModalOpen(false)}>
          <div className="orders-modal orders-catalog-browser-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>Todos los productos disponibles</h3>
                <p>Busca y agrega productos o combos sin salir del contrato.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setCatalogModalOpen(false)} aria-label="Cerrar">
                <X aria-hidden="true" />
              </button>
            </header>

            <div className="orders-catalog-browser-toolbar">
              <label className="orders-icon-field">
                <span>
                  <i aria-hidden="true"><Search /></i>
                  <input
                    type="search"
                    placeholder="Buscar por producto, color o material..."
                    value={itemSearch}
                    onChange={(event) => setItemSearch(event.target.value)}
                  />
                </span>
              </label>
              <select value={itemCategoryFilter} onChange={(event) => setItemCategoryFilter(event.target.value)} aria-label="Filtrar categoria">
                <option value="all">Todas las categorias</option>
                {itemCategoryOptions.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setItemSearch('');
                  setItemCategoryFilter('all');
                }}
              >
                Limpiar filtros
              </button>
            </div>

            <div className="orders-catalog-browser-count">
              <strong>{filteredCatalog.length}</strong>
              <span>{filteredCatalog.length === 1 ? 'resultado disponible' : 'resultados disponibles'}</span>
            </div>

            <div className="orders-catalog-browser-list">
              {filteredCatalog.map((entry) => {
                if (entry.type === 'combo') {
                  const combo = entry.combo;
                  const ingredients = getComboRules(combo);
                  return (
                    <article className="orders-catalog-browser-card is-combo" key={`catalog-modal-combo-${combo.id}`}>
                      <div className="orders-product-thumb orders-combo-thumb">
                        {getProductImageSrc(combo) ? (
                          <ProductImage
                            item={combo}
                            alt={`Imagen de ${combo.name}`}
                            fallback={<span>CB</span>}
                          />
                        ) : <span>CB</span>}
                      </div>
                      <div className="orders-catalog-browser-info">
                        <strong>{combo.name}</strong>
                        <span>Combo · {ingredients.length} productos</span>
                        <small>{ingredients.slice(0, 4).map((line) => `${line.quantity}x ${line.itemName}`).join(' · ')}</small>
                      </div>
                      <strong className="orders-catalog-browser-price">{formatBs(combo.rentalPriceBs)}</strong>
                      <span className="orders-product-stock-badge">Combo</span>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => addDraftCombo(combo.id)}
                        disabled={ingredients.length === 0}
                      >
                        Agregar
                      </button>
                    </article>
                  );
                }

                const item = entry.item;
                const availability = availabilityByItemId.get(item.id) ?? null;
                const isProvisionalCatalogItem = isDetachedFromInventory(item);
                const projectedAvailable = Math.max(0, Number(availability?.projectedAvailable ?? item.availableStock ?? 0));
                const detailParts = getOperationalItemDetails({ item });
                return (
                  <article className="orders-catalog-browser-card is-product" key={`catalog-modal-item-${item.id}`}>
                    <div className={`orders-product-thumb${getProductImageSrc(item) ? ' has-image' : ' has-no-image'}`}>
                      {getProductImageSrc(item) ? (
                        <button
                          type="button"
                          className="orders-product-thumb-button"
                          onClick={() => handleOpenProductImage(item)}
                          aria-label={`Ver imagen de ${item.name}`}
                        >
                          <ProductImage
                            item={item}
                            alt={`Imagen de ${item.name}`}
                            fallback={<span className="orders-product-image-fallback"><Box aria-hidden="true" /></span>}
                          />
                        </button>
                      ) : (
                        <span className="orders-product-image-fallback"><Box aria-hidden="true" /></span>
                      )}
                    </div>
                    <div className="orders-catalog-browser-info">
                      <strong>{item.name}</strong>
                      <span>{item.category || 'Sin categoria'}</span>
                      <small>{detailParts.map((part) => `${part.label}: ${part.value}`).join(' · ') || 'Sin detalles adicionales'}</small>
                    </div>
                    <strong className="orders-catalog-browser-price">{formatBs(item.rentalPriceBs)}</strong>
                    <span className={`orders-product-stock-badge${!isProvisionalCatalogItem && projectedAvailable > 0 ? ' available' : ''}`}>
                      {isProvisionalCatalogItem ? 'No descuenta' : `${projectedAvailable} disponibles`}
                    </span>
                    <button
                      type="button"
                      className={isCourtesyMode ? 'ghost-button' : 'primary-button'}
                      onClick={() => addDraftItem(item.id, { courtesy: isCourtesyMode })}
                    >
                      {isCourtesyMode
                        ? 'Cortesía'
                        : Number(draftQuantityByItem.get(item.id) ?? 0) > 0
                        ? `Agregar otro (${draftQuantityByItem.get(item.id)})`
                        : 'Agregar'}
                    </button>
                  </article>
                );
              })}
              {filteredCatalog.length === 0 ? (
                <div className="orders-catalog-browser-empty">
                  <PackageOpen aria-hidden="true" />
                  <strong>No encontramos productos con esos filtros.</strong>
                  <span>Prueba otra palabra o limpia los filtros.</span>
                </div>
              ) : null}
            </div>

            <footer className="orders-modal-foot">
              <span className="orders-catalog-browser-selected">
                {selectedItems.length} producto(s) seleccionado(s)
              </span>
              <button type="button" className="primary-button" onClick={() => setCatalogModalOpen(false)}>
                Listo
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {comboConfigurator ? (
        <div className="orders-modal-backdrop orders-combo-configurator-backdrop" onClick={() => setComboConfigurator(null)}>
          <section className="orders-modal orders-combo-configurator" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <span className="orders-combo-configurator-kicker">Configurar combo</span>
                <h3>{comboConfigurator.combo.name}</h3>
                <p>Selecciona una o varias opciones por componente. El sistema reparte las unidades segun disponibilidad.</p>
              </div>
              <label className="orders-combo-quantity-field">
                <span>Cantidad de combos</span>
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, getComboMaxQuantity(comboConfigurator.combo, comboConfigurator.selections))}
                  value={comboConfigurator.quantity ?? '1'}
                  onFocus={selectNumericInput}
                  onChange={(event) => setComboConfigurator((current) => (
                    normalizeComboConfiguratorQuantities(current, event.target.value)
                  ))}
                />
                <small>Max. {getComboMaxQuantity(comboConfigurator.combo, comboConfigurator.selections)}</small>
              </label>
              <button type="button" className="orders-modal-close" onClick={() => setComboConfigurator(null)} aria-label="Cerrar">
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="orders-combo-configurator-body">
              {getComboRules(comboConfigurator.combo).map((rule, index) => {
                const allOptions = getComboRuleOptions(rule);
                const search = normalizeText(comboConfigurator.search[index] ?? '');
                const visibleOptions = allOptions.filter((item) => (
                  !search
                  || normalizeText(item.name).includes(search)
                  || normalizeText(item.category).includes(search)
                  || normalizeText(item.itemColor).includes(search)
                  || normalizeText(item.brand).includes(search)
                ));
                const selectedIds = getSelectedComboOptionIds(comboConfigurator.selections[index], []);
                const selectedUnits = getComboSelectedUnitsForRule(index, selectedIds, comboConfigurator.selections);
                const requiredPerCombo = Math.max(1, Math.trunc(Number(rule.quantity ?? 1)));
                const comboQty = Math.max(1, Math.trunc(Number(comboConfigurator.quantity ?? 1)));
                const neededUnits = requiredPerCombo * comboQty;
                const componentStatusClass = selectedIds.length === 0
                  ? 'muted'
                  : selectedUnits >= neededUnits
                    ? 'ok'
                    : 'danger';
                const componentStatusText = selectedIds.length === 0
                  ? 'No incluido'
                  : `${selectedUnits} marc. / ${neededUnits} sug.`;
                const isExpanded = Boolean(comboConfigurator.expandedGroups?.[index]);
                const selectedNames = selectedIds
                  .map((itemId) => allOptions.find((item) => item.id === itemId)?.name)
                  .filter(Boolean);
                return (
                  <article
                    key={`${rule.slotLabel ?? rule.itemName}-${index}`}
                    className={`orders-combo-option-group ${isExpanded ? 'expanded' : 'collapsed'}`}
                  >
                    <header>
                      <button
                        type="button"
                        className="orders-combo-group-toggle"
                        onClick={() => setComboConfigurator((current) => ({
                          ...current,
                          expandedGroups: {
                            ...(current?.expandedGroups ?? {}),
                            [index]: !current?.expandedGroups?.[index],
                          },
                        }))}
                        aria-expanded={isExpanded}
                        aria-controls={`combo-component-options-${index}`}
                      >
                        <span className="orders-combo-group-copy">
                          <strong>{rule.slotLabel || rule.itemName || `Componente ${index + 1}`}</strong>
                          <span>{requiredPerCombo} por combo · {allOptions.length} opciones · {selectedIds.length} seleccionadas · {selectedUnits} unidades marcadas</span>
                          {!isExpanded && selectedNames.length > 0 ? (
                            <small>{selectedNames.slice(0, 2).join(' · ')}{selectedNames.length > 2 ? ` · +${selectedNames.length - 2} mas` : ''}</small>
                          ) : null}
                        </span>
                        <span className="orders-combo-group-summary">
                          <span className={componentStatusClass}>
                            {componentStatusText}
                          </span>
                          <small>{rule.selectionMode === 'category' ? rule.category : 'Productos elegidos'}</small>
                        </span>
                        <ChevronRight className="orders-combo-group-chevron" aria-hidden="true" />
                      </button>
                    </header>
                    <div
                      id={`combo-component-options-${index}`}
                      className="orders-combo-group-content"
                      hidden={!isExpanded}
                    >
                      {allOptions.length > 4 ? (
                        <label className="orders-icon-field">
                          <span>
                            <i aria-hidden="true"><Search /></i>
                            <input
                              type="search"
                              placeholder={`Buscar ${rule.slotLabel || 'opcion'}...`}
                              value={comboConfigurator.search[index] ?? ''}
                              onChange={(event) => setComboConfigurator((current) => ({
                                ...current,
                                search: { ...current.search, [index]: event.target.value },
                              }))}
                            />
                          </span>
                        </label>
                      ) : null}
                      <div className="orders-combo-option-grid">
                        {visibleOptions.map((item) => {
                        const selected = selectedIds.includes(item.id);
                        const optionAvailable = getComboOptionAvailable(item);
                        const quantityKey = `${index}:${item.id}`;
                        const selectedQuantity = Math.max(0, Math.trunc(Number(
                          comboConfigurator.selections?.__quantities?.[quantityKey] ?? 0,
                        )));
                        return (
                          <article
                            key={item.id}
                            className={`orders-combo-option-card ${selected ? 'selected' : ''}`}
                          >
                            <button
                              type="button"
                              className="orders-combo-option-pick"
                              onClick={() => toggleComboOption(index, item.id, requiredPerCombo, comboQty)}
                            >
                              <span className="orders-combo-option-image">
                                {getProductImageSrc(item) ? (
                                  <ProductImage item={item} alt={item.name} fallback={<Box aria-hidden="true" />} />
                                ) : <Box aria-hidden="true" />}
                              </span>
                              <span>
                                <strong>{item.name}</strong>
                                <small>{[item.itemColor, item.brand, item.category].filter(Boolean).join(' · ')}</small>
                                <em>{optionAvailable >= 999 ? 'Sin control de stock' : `${optionAvailable} disponibles`}</em>
                              </span>
                              <i aria-hidden="true">{selected ? '✓' : ''}</i>
                            </button>
                            {selected ? (
                              <label className="orders-combo-option-qty">
                                <span>Cantidad a usar</span>
                                <input
                                  type="number"
                                  min="0"
                                  max={optionAvailable >= 999 ? undefined : optionAvailable}
                                  value={selectedQuantity}
                                  onFocus={selectNumericInput}
                                  onChange={(event) => updateComboOptionQuantity(index, item.id, event.target.value)}
                                />
                              </label>
                            ) : null}
                          </article>
                        );
                        })}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <footer className="orders-modal-foot">
              <div className="orders-combo-configurator-price">
                <span>Precio por combo</span>
                <strong>{formatBs(comboConfigurator.combo.rentalPriceBs)}</strong>
              </div>
              <button type="button" className="ghost-button" onClick={() => setComboConfigurator(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const saved = appendConfiguredCombo(
                    comboConfigurator.combo,
                    {
                      ...comboConfigurator.selections,
                      __comboQuantity: comboConfigurator.quantity,
                    },
                    comboConfigurator.existingComboLineKey,
                  );
                  if (saved) setComboConfigurator(null);
                }}
              >
                Confirmar selección
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {serviceModalOpen ? (
        <div className="orders-modal-backdrop orders-service-backdrop" onClick={closeServiceModal}>
          <div className="orders-modal orders-service-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>{editingServiceId ? 'Editar servicio' : 'Asignar servicio'}</h3>
                <p>
                  {editingServiceId
                    ? 'Corrige los datos del servicio sin eliminarlo ni cambiar el dia asignado.'
                    : 'Registra personal o trabajo adicional sin afectar el inventario.'}
                </p>
              </div>
              <button type="button" className="orders-modal-close" onClick={closeServiceModal} aria-label="Cerrar">
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="orders-service-form">
              <label>
                Nombre del servicio *
                <input
                  autoFocus
                  value={serviceDraft.name}
                  onChange={(event) => setServiceDraftField('name', event.target.value)}
                  placeholder="Ej: Garzon, armado de moños..."
                />
              </label>
              <label className="wide">
                Detalle
                <textarea
                  rows="3"
                  value={serviceDraft.detail}
                  onChange={(event) => setServiceDraftField('detail', event.target.value)}
                  placeholder="Describe el trabajo, horario o condiciones acordadas."
                />
              </label>
              <label>
                Cantidad
                <input
                  type="text"
                  inputMode="numeric"
                  value={serviceDraft.quantity}
                  onFocus={selectNumericInput}
                  onChange={(event) => setServiceDraftField('quantity', event.target.value)}
                />
              </label>
              <label>
                Precio unitario (Bs) *
                <input
                  type="text"
                  inputMode="decimal"
                  value={serviceDraft.unitPriceBs}
                  onFocus={selectNumericInput}
                  onChange={(event) => setServiceDraftField('unitPriceBs', event.target.value)}
                />
              </label>
              <div className="orders-service-preview wide">
                <BriefcaseBusiness aria-hidden="true" />
                <span>
                  <small>Total del servicio</small>
                  <strong>{formatBs(
                    Math.max(1, parseIntegerInput(serviceDraft.quantity, 1))
                    * Math.max(0, parseMoneyInput(serviceDraft.unitPriceBs, 0)),
                  )}</strong>
                </span>
              </div>
            </div>
            {formError ? <p className="status error orders-service-error">{formError}</p> : null}
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={closeServiceModal}>Cancelar</button>
              <button type="button" className="primary-button" onClick={saveDraftService}>
                {editingServiceId ? 'Guardar cambios' : 'Agregar servicio'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {itemObservationModal ? (
        <div className="orders-modal-backdrop orders-item-observation-backdrop" onClick={() => setItemObservationModal(null)}>
          <div className="orders-modal orders-item-observation-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>Observacion del item</h3>
                <p>{itemObservationModal.itemName}</p>
              </div>
              <button
                type="button"
                className="orders-modal-close"
                onClick={() => setItemObservationModal(null)}
                aria-label="Cerrar"
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <label className="orders-item-observation-field">
              Detalle para el contrato
              <textarea
                autoFocus
                rows="5"
                value={itemObservationModal.observation}
                onChange={(event) => setItemObservationModal((current) => ({
                  ...current,
                  observation: event.target.value,
                }))}
                placeholder="Ej: entregar limpio, revisar color, pieza con marca acordada..."
              />
            </label>
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setItemObservationModal(null)}>
                Cancelar
              </button>
              <button type="button" className="primary-button" onClick={saveItemObservation}>
                Guardar observacion
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {availabilityDetailModal ? (() => {
        const mode = availabilityDetailModal.mode;
        const item = availabilityDetailModal.item ?? {};
        const summary = availabilityDetailModal.summary ?? {};
        const totalStock = Math.max(0, Number(summary.totalStock ?? item.totalStock ?? 0));
        const currentAvailable = Math.max(0, Number(summary.currentAvailable ?? item.availableStock ?? 0));
        const activeQty = Math.max(0, Number(summary.activeRentalQty ?? 0));
        const externalUnavailable = Math.max(0, Number(summary.unavailableOutsideRentals ?? 0));
        const hardQty = Math.max(0, Number(summary.hardReservedQty ?? 0));
        const softQty = Math.max(0, Number(summary.softReservedQty ?? 0));
        const returningQty = Math.max(0, Number(summary.returningBeforeStartQty ?? 0));
        const projectedAvailable = Math.max(0, Number(summary.projectedAvailable ?? currentAvailable));
        const projectedAfterSoft = Math.max(0, Number(summary.projectedAfterSoftAvailable ?? projectedAvailable));
        const activeRecords = Array.isArray(summary.activeRentalQtyRecords) ? summary.activeRentalQtyRecords : [];
        const hardRecords = Array.isArray(summary.hardReservedQtyRecords) ? summary.hardReservedQtyRecords : [];
        const softRecords = Array.isArray(summary.softReservedQtyRecords) ? summary.softReservedQtyRecords : [];
        const returnRecords = Array.isArray(summary.returningBeforeStartQtyRecords) ? summary.returningBeforeStartQtyRecords : [];

        const modalMeta = mode === 'now'
          ? {
            eyebrow: 'DISPONIBILIDAD ACTUAL',
            title: `Por qué hay ${currentAvailable} ahora`,
            description: 'Muestra las unidades físicamente disponibles y las órdenes activas que mantienen este producto comprometido.',
            records: activeRecords.map((record) => ({ ...record, impactLabel: 'Compromete ahora', tone: 'danger' })),
          }
          : mode === 'returns'
            ? {
              eyebrow: 'DEVOLUCIONES ANTES DEL EVENTO',
              title: `Por qué vuelven ${returningQty}`,
              description: 'Estas órdenes deben devolver el producto antes de que empiece el periodo del nuevo contrato.',
              records: returnRecords.map((record) => ({ ...record, impactLabel: 'Se libera antes', tone: 'positive' })),
            }
            : {
              eyebrow: 'DISPONIBILIDAD PARA LA FECHA',
              title: `Por qué hay ${projectedAvailable} para la fecha`,
              description: 'Se parte del stock físico y solo se descuentan las ocupaciones que coinciden con el periodo seleccionado.',
              records: [
                ...hardRecords.map((record) => ({ ...record, impactLabel: 'Resta en la fecha', tone: 'danger' })),
                ...returnRecords.map((record) => ({ ...record, impactLabel: 'Vuelve antes', tone: 'positive' })),
                ...softRecords.map((record) => ({ ...record, impactLabel: 'Riesgo sin aprobar', tone: 'warning' })),
              ],
            };

        return (
          <div
            className="orders-modal-backdrop orders-availability-detail-backdrop"
            onClick={() => setAvailabilityDetailModal(null)}
          >
            <section
              className="orders-modal orders-availability-detail-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="orders-modal-head orders-availability-detail-head">
                <div>
                  <span>{modalMeta.eyebrow}</span>
                  <h3>{modalMeta.title}</h3>
                  <p>{item.name || summary.itemName || 'Producto'}</p>
                </div>
                <button
                  type="button"
                  className="orders-modal-close"
                  onClick={() => setAvailabilityDetailModal(null)}
                  aria-label="Cerrar detalle de disponibilidad"
                >
                  <X aria-hidden="true" />
                </button>
              </header>

              <div className="orders-availability-detail-body">
                <p className="orders-availability-detail-description">{modalMeta.description}</p>

                {mode === 'now' ? (
                  <div className="orders-availability-formula">
                    <span><small>Stock físico</small><strong>{totalStock}</strong></span>
                    <b>−</b>
                    <span><small>Comprometido ahora</small><strong>{activeQty}</strong></span>
                    <b>−</b>
                    <span><small>Mantenimiento / otros</small><strong>{externalUnavailable}</strong></span>
                    <b>=</b>
                    <span className="result"><small>Disponible ahora</small><strong>{currentAvailable}</strong></span>
                  </div>
                ) : null}

                {mode === 'date' ? (
                  <>
                    <div className="orders-availability-formula">
                      <span><small>Stock físico</small><strong>{totalStock}</strong></span>
                      <b>−</b>
                      <span><small>Mantenimiento / otros</small><strong>{externalUnavailable}</strong></span>
                      <b>−</b>
                      <span><small>Coinciden con la fecha</small><strong>{hardQty}</strong></span>
                      <b>=</b>
                      <span className="result"><small>Para fecha</small><strong>{projectedAvailable}</strong></span>
                    </div>
                    {softQty > 0 ? (
                      <div className="orders-availability-soft-note">
                        Hay {softQty} unidad(es) en cotizaciones o contratos aún no aprobados. Si se confirman, quedarían {projectedAfterSoft}.
                      </div>
                    ) : null}
                  </>
                ) : null}

                {mode === 'returns' ? (
                  <div className="orders-availability-formula returns">
                    <span><small>Órdenes que devuelven antes</small><strong>{returnRecords.length}</strong></span>
                    <b>→</b>
                    <span className="result"><small>Unidades que vuelven</small><strong>{returningQty}</strong></span>
                  </div>
                ) : null}

                <div className="orders-availability-records-head">
                  <div>
                    <h4>Contratos y órdenes relacionados</h4>
                    <p>Entrega, devolución, cliente, cantidad y efecto sobre el cálculo.</p>
                  </div>
                  <strong>{modalMeta.records.length}</strong>
                </div>

                <div className="orders-availability-records">
                  {modalMeta.records.length > 0 ? modalMeta.records.map((record, index) => {
                    const code = record.contractCode || record.code || record.orderCode || `Registro ${index + 1}`;
                    return (
                      <article
                        key={`${mode}-${record.id || code}-${record.startDate || ''}-${index}`}
                        className={`orders-availability-record is-${record.tone}`}
                      >
                        <div className="orders-availability-record-main">
                          <span>Contrato / orden</span>
                          <strong>{code}</strong>
                          {record.orderCode && record.orderCode !== code ? <small>{record.orderCode}</small> : null}
                        </div>
                        <div>
                          <span>Cliente</span>
                          <strong>{record.customerName || 'Sin cliente registrado'}</strong>
                        </div>
                        <div>
                          <span>Entrega</span>
                          <strong>{formatDate(record.startDate)}</strong>
                          <small>{record.startTime || '00:00'}</small>
                        </div>
                        <div>
                          <span>Devolución</span>
                          <strong>{formatDate(record.endDate)}</strong>
                          <small>{record.endTime || '23:59'}</small>
                        </div>
                        <div className="orders-availability-record-quantity">
                          <span>Cantidad</span>
                          <strong>{Math.max(0, Number(record.quantity ?? 0))}</strong>
                        </div>
                        <div className={`orders-availability-impact is-${record.tone}`}>
                          {record.impactLabel}
                        </div>
                      </article>
                    );
                  }) : (
                    <div className="orders-availability-empty">
                      <Box aria-hidden="true" />
                      <strong>No hay contratos que afecten este indicador.</strong>
                      <p>La cantidad se explica únicamente por el stock físico y las unidades fuera de disponibilidad por mantenimiento u otros motivos.</p>
                    </div>
                  )}
                </div>
              </div>

              <footer className="orders-modal-foot">
                <button type="button" className="primary-button" onClick={() => setAvailabilityDetailModal(null)}>
                  Entendido
                </button>
              </footer>
            </section>
          </div>
        );
      })() : null}

      {comboAvailabilityDetailModal ? (() => {
        const detail = comboAvailabilityDetailModal;
        const relatedRecords = detail.components.reduce((sum, component) => (
          sum + component.optionDetails.reduce((optionSum, option) => (
            optionSum + option.hardRecords.length + option.softRecords.length + option.returnRecords.length
          ), 0)
        ), 0);

        return (
          <div
            className="orders-modal-backdrop orders-availability-detail-backdrop"
            onClick={() => setComboAvailabilityDetailModal(null)}
          >
            <section
              className="orders-modal orders-availability-detail-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="orders-modal-head orders-availability-detail-head">
                <div>
                  <span>DISPONIBILIDAD DEL COMBO PARA LA FECHA</span>
                  <h3>Por qué puede armar {detail.comboMaxQuantity} combo(s)</h3>
                  <p>{detail.combo?.name || 'Combo'}</p>
                </div>
                <button
                  type="button"
                  className="orders-modal-close"
                  onClick={() => setComboAvailabilityDetailModal(null)}
                  aria-label="Cerrar detalle de disponibilidad del combo"
                >
                  <X aria-hidden="true" />
                </button>
              </header>

              <div className="orders-availability-detail-body">
                <p className="orders-availability-detail-description">
                  El máximo del combo lo define el componente que permite armar menos paquetes para el periodo seleccionado.
                  Cada componente usa la misma disponibilidad por fecha que los productos individuales.
                </p>

                <div className="orders-availability-records-head">
                  <div>
                    <h4>Componentes del combo</h4>
                    <p>Unidades requeridas, disponibles para la fecha y cantidad de combos que permite cada componente.</p>
                  </div>
                  <strong>{detail.components.length}</strong>
                </div>

                <div className="orders-availability-records">
                  {detail.components.map((component) => (
                    <article
                      key={`combo-availability-component-${component.index}`}
                      className={`orders-availability-record ${component.isLimiting ? 'is-warning' : 'is-positive'}`}
                    >
                      <div className="orders-availability-record-main">
                        <span>Componente</span>
                        <strong>{component.label}</strong>
                        {component.isLimiting ? <small>LIMITANTE DEL COMBO</small> : null}
                      </div>
                      <div>
                        <span>Requiere por combo</span>
                        <strong>{component.requiredPerCombo}</strong>
                      </div>
                      <div>
                        <span>Para la fecha</span>
                        <strong>{component.availableUnits}</strong>
                      </div>
                      <div>
                        <span>Permite armar</span>
                        <strong>{component.maxCombos}</strong>
                      </div>
                      <div className="orders-availability-record-quantity">
                        <span>Opciones</span>
                        <strong>{component.optionDetails.length}</strong>
                      </div>
                      <div className={`orders-availability-impact ${component.isLimiting ? 'is-warning' : 'is-positive'}`}>
                        {component.isLimiting ? 'Define el máximo' : 'Tiene margen'}
                      </div>
                    </article>
                  ))}
                </div>

                <div className="orders-availability-records-head">
                  <div>
                    <h4>Dónde están comprometidos los componentes</h4>
                    <p>Contratos, cotizaciones y devoluciones que explican la disponibilidad de cada opción del combo.</p>
                  </div>
                  <strong>{relatedRecords}</strong>
                </div>

                <div className="orders-availability-records">
                  {detail.components.flatMap((component) => component.optionDetails.flatMap((option) => {
                    const records = [
                      ...option.hardRecords.map((record) => ({ ...record, impactLabel: 'Resta en la fecha', tone: 'danger' })),
                      ...option.returnRecords.map((record) => ({ ...record, impactLabel: 'Vuelve antes', tone: 'positive' })),
                      ...option.softRecords.map((record) => ({ ...record, impactLabel: 'Riesgo sin aprobar', tone: 'warning' })),
                    ];
                    return records.map((record, index) => {
                      const code = record.contractCode || record.code || record.orderCode || `Registro ${index + 1}`;
                      return (
                        <article
                          key={`combo-${component.index}-${option.item.id}-${record.id || code}-${index}`}
                          className={`orders-availability-record is-${record.tone}`}
                        >
                          <div className="orders-availability-record-main">
                            <span>{component.label}</span>
                            <strong>{option.item.name}</strong>
                            <small>{code}</small>
                          </div>
                          <div>
                            <span>Cliente</span>
                            <strong>{record.customerName || 'Sin cliente registrado'}</strong>
                          </div>
                          <div>
                            <span>Entrega</span>
                            <strong>{formatDate(record.startDate)}</strong>
                            <small>{record.startTime || '00:00'}</small>
                          </div>
                          <div>
                            <span>Devolución</span>
                            <strong>{formatDate(record.endDate)}</strong>
                            <small>{record.endTime || '23:59'}</small>
                          </div>
                          <div className="orders-availability-record-quantity">
                            <span>Cantidad</span>
                            <strong>{Math.max(0, Number(record.quantity ?? 0))}</strong>
                          </div>
                          <div className={`orders-availability-impact is-${record.tone}`}>
                            {record.impactLabel}
                          </div>
                        </article>
                      );
                    });
                  }))}
                  {relatedRecords === 0 ? (
                    <div className="orders-availability-empty">
                      <Box aria-hidden="true" />
                      <strong>No hay contratos que afecten los componentes para esta fecha.</strong>
                      <p>La cantidad armable se explica por el stock disponible de sus componentes.</p>
                    </div>
                  ) : null}
                </div>
              </div>

              <footer className="orders-modal-foot">
                <button type="button" className="primary-button" onClick={() => setComboAvailabilityDetailModal(null)}>
                  Entendido
                </button>
              </footer>
            </section>
          </div>
        );
      })() : null}

      {modalOpen ? (
        <div className="orders-modal-backdrop">
          <div
            className={`orders-modal orders-wizard-modal${currentStep === 2 ? ' is-items-step' : ''}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="orders-modal-head">
              <div>
                <h3>
                  {draft.entityType === 'contract'
                    ? draft.recordId
                      ? 'Editar Contrato'
                      : 'Nuevo Contrato'
                    : draft.mode === 'order'
                    ? 'Nueva Orden de Servicio'
                    : 'Nueva Cotizacion'}
                </h3>
                <p>
                  {draft.entityType === 'contract'
                    ? 'Configura datos comerciales y operativos para validar el contrato con el cliente.'
                    : 'Completa los pasos para registrar cliente, evento, items y logistica.'}
                </p>
              </div>
              <div className="orders-modal-head-actions">
                <button type="button" className="orders-modal-close" onClick={closeModal} aria-label="Cerrar">
                  <X aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="orders-wizard-steps">
              {QUOTE_WIZARD_STEPS.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  className={`orders-wizard-step ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'done' : ''} ${canJumpBetweenWizardSteps ? 'is-jumpable' : ''}`}
                  onClick={() => handleWizardStepClick(index)}
                  aria-label={`Ir al paso ${index + 1}: ${step.title}`}
                >
                  <span className="orders-wizard-step-index">
                    {index < currentStep ? <Check aria-hidden="true" /> : index + 1}
                  </span>
                  <span className="orders-wizard-step-text">
                    <strong>{step.title}</strong>
                    <small>{step.subtitle}</small>
                  </span>
                </button>
              ))}
            </div>

            <div className={`orders-modal-body orders-wizard-body${isWizardSummaryCollapsed ? ' is-summary-collapsed' : ''}`}>
              <section className={`orders-form-panel orders-wizard-main orders-wizard-panel-step-${currentStep + 1}`}>
                {currentStep === 0 ? (
                  <>
                    <h4><span className="orders-section-icon"><UserRound aria-hidden="true" /></span>Informacion del cliente</h4>
                    <p className="orders-step-help">Busca un cliente registrado o completa los datos manualmente.</p>
                    <div className="orders-form-grid" onKeyDown={handleClientFieldsArrowNavigation}>
                      <div
                        className="orders-client-search-field"
                        data-client-nav-field
                        onBlur={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget)) {
                            setIsClientSearchOpen(false);
                            if (selectedClientForDraft) setClientSearchQuery(selectedClientForDraft.name);
                          }
                        }}
                      >
                        <label htmlFor="orders-client-search">Cliente registrado</label>
                        <div className={`orders-client-search-control${isClientSearchOpen ? ' is-open' : ''}${draft.clientId ? ' has-selection' : ''}`}>
                          <Search aria-hidden="true" />
                          <input
                            id="orders-client-search"
                            type="search"
                            role="combobox"
                            autoComplete="off"
                            aria-autocomplete="list"
                            aria-expanded={isClientSearchOpen}
                            aria-controls="orders-client-search-results"
                            aria-activedescendant={isClientSearchOpen && filteredClientOptions[activeClientResultIndex]
                              ? `orders-client-option-${filteredClientOptions[activeClientResultIndex].id}`
                              : undefined}
                            value={clientSearchQuery}
                            placeholder="Buscar por nombre, CI, telefono o empresa..."
                            onFocus={(event) => {
                              setIsClientSearchOpen(true);
                              setActiveClientResultIndex(0);
                              if (draft.clientId) event.currentTarget.select();
                            }}
                            onChange={(event) => {
                              setClientSearchQuery(event.target.value);
                              setIsClientSearchOpen(true);
                              setActiveClientResultIndex(0);
                            }}
                            onKeyDown={handleClientSearchKeyDown}
                          />
                          {draft.clientId ? (
                            <button
                              type="button"
                              className="orders-client-search-clear"
                              aria-label="Quitar cliente seleccionado"
                              title="Quitar cliente seleccionado"
                              onClick={clearClientFields}
                            >
                              <X aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                        {isClientSearchOpen ? (
                          <div id="orders-client-search-results" className="orders-client-search-results" role="listbox">
                            <button
                              type="button"
                              className="orders-client-search-new"
                              onClick={clearClientFields}
                            >
                              <span className="orders-client-result-icon"><UserRound aria-hidden="true" /></span>
                              <span>
                                <strong>Cliente nuevo</strong>
                                <small>Limpiar los datos y registrarlos manualmente</small>
                              </span>
                            </button>
                            {filteredClientOptions.length > 0 ? (
                              filteredClientOptions.map((client, index) => {
                                const clientPhone = client.whatsapp || client.phone || '';
                                const clientCi = client.nitCi || client.customerCi || '';
                                return (
                                  <button
                                    id={`orders-client-option-${client.id}`}
                                    key={client.id}
                                    type="button"
                                    role="option"
                                    aria-selected={draft.clientId === client.id}
                                    className={`orders-client-search-result${activeClientResultIndex === index ? ' is-active' : ''}${draft.clientId === client.id ? ' is-selected' : ''}`}
                                    onMouseEnter={() => setActiveClientResultIndex(index)}
                                    onClick={() => setClientFromSelection(client.id)}
                                  >
                                    <span className="orders-client-result-avatar" aria-hidden="true">
                                      {String(client.name || '?').trim().charAt(0).toUpperCase()}
                                    </span>
                                    <span className="orders-client-result-copy">
                                      <strong>{client.name}</strong>
                                      <small>
                                        {[clientCi && `CI ${clientCi}`, clientPhone && `Tel. ${clientPhone}`, client.companyName]
                                          .filter(Boolean)
                                          .join(' · ') || 'Sin datos adicionales'}
                                      </small>
                                    </span>
                                    {client.isBlacklisted ? (
                                      <span className="orders-client-result-warning">No atender</span>
                                    ) : draft.clientId === client.id ? (
                                      <Check className="orders-client-result-check" aria-label="Seleccionado" />
                                    ) : null}
                                  </button>
                                );
                              })
                            ) : (
                              <div className="orders-client-search-empty">
                                <Search aria-hidden="true" />
                                <strong>No encontramos coincidencias</strong>
                                <small>Prueba con otro nombre, CI, telefono o empresa.</small>
                              </div>
                            )}
                            <footer>
                              {filteredClientOptions.length} resultado(s) visible(s)
                              {clients.length > filteredClientOptions.length ? ` de ${clients.length} clientes` : ''}
                            </footer>
                          </div>
                        ) : null}
                        <small className="orders-client-search-hint">
                          Busca cualquier parte del nombre; por ejemplo, &ldquo;Daniela&rdquo;.
                        </small>
                      </div>
                      <label className="orders-icon-field company" data-client-nav-field>
                        Empresa / razon social
                        <span>
                          <i aria-hidden="true"><Building2 /></i>
                          <input
                            value={draft.companyName}
                            onChange={(event) => setDraftField('companyName', event.target.value)}
                            placeholder="Ingresa la empresa o razon social"
                          />
                        </span>
                      </label>
                      <label className="orders-icon-field person" data-client-nav-field>
                        Nombre cliente *
                        <span>
                          <i aria-hidden="true"><UserRound /></i>
                          <input
                            value={draft.customerName}
                            onChange={(event) => setDraftField('customerName', event.target.value)}
                            placeholder="Ingresa el nombre completo"
                          />
                        </span>
                      </label>
                      <label className="orders-icon-field document" data-client-nav-field>
                        CI / Carnet
                        <span>
                          <i aria-hidden="true"><CircleUserRound /></i>
                          <input
                            value={draft.customerCi}
                            onChange={(event) => setDraftField('customerCi', event.target.value)}
                            placeholder="Opcional"
                          />
                        </span>
                      </label>
                      <label className="orders-icon-field whatsapp" data-client-nav-field>
                        WhatsApp / Celular *
                        <span>
                          <i aria-hidden="true"><MessageCircle /></i>
                          <input
                            value={draft.customerPhone}
                            onChange={(event) => setDraftField('customerPhone', event.target.value)}
                            placeholder="Ej: 75976197"
                          />
                        </span>
                      </label>
                      <label className="orders-icon-field phone" data-client-nav-field>
                        Telefono de referencia
                        <span>
                          <i aria-hidden="true"><Phone /></i>
                          <input
                            value={draft.customerReferencePhone}
                            onChange={(event) => setDraftField('customerReferencePhone', event.target.value)}
                            placeholder="Ej: 2 1234567"
                          />
                        </span>
                      </label>
                      <label className="orders-icon-field location" data-client-nav-field>
                        Ciudad
                        <span>
                          <i aria-hidden="true"><MapPin /></i>
                          <input
                            value={draft.city}
                            onChange={(event) => setDraftField('city', event.target.value)}
                            placeholder="Ingresa la ciudad"
                          />
                        </span>
                      </label>
                      {(!draft.recordId || draft.entityType === 'contract') ? (
                        <>
                          <label className="orders-icon-field book" data-client-nav-field>
                            Codigo del libro
                            <span>
                              <i aria-hidden="true"><BookOpen /></i>
                              <select value={draft.recordId ? 'manual' : draft.documentCodeMode} onChange={(event) => setDraftField('documentCodeMode', event.target.value)} disabled={Boolean(draft.recordId)}>
                                <option value="auto">Automatico</option>
                                <option value="manual">Pasado / manual</option>
                                <option value="current">Actual y continuar desde aqui</option>
                              </select>
                            </span>
                          </label>
                          {(draft.recordId || draft.documentCodeMode !== 'auto') ? (
                            <label data-client-nav-field>
                              Numero o codigo *
                              <input
                                value={draft.manualDocumentCode}
                                onChange={(event) => setDraftField('manualDocumentCode', event.target.value)}
                                placeholder="Ej: 900 o 1700"
                              />
                            </label>
                          ) : null}
                          {draft.entityType === 'contract' ? (
                            <label className="orders-icon-field calendar" data-client-nav-field>
                              Fecha de contrato pasado
                              <span>
                                <i aria-hidden="true"><CalendarDays /></i>
                                <input
                                  type="date"
                                  value={draft.contractDate || ''}
                                  onChange={(event) => setDraftField('contractDate', event.target.value)}
                                />
                              </span>
                            </label>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                    {canChooseResponsibles ? (
                      <section className="orders-responsible-picker">
                        <header>
                          <div>
                            <strong><UsersRound aria-hidden="true" />Responsable(s) del registro</strong>
                            <span>Solo Developer: usa esto para cargar contratos o cotizaciones antiguas del cuaderno.</span>
                          </div>
                          <em>{(draft.responsibleIds ?? []).length || 1} seleccionado(s)</em>
                        </header>
                        <div className="orders-responsible-options">
                          {responsibleOptions.map((responsible) => {
                            const checked = (draft.responsibleIds ?? []).includes(responsible.id);
                            return (
                              <label key={responsible.id} className={checked ? 'is-selected' : ''}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleDraftResponsible(responsible.id)}
                                />
                                <span>
                                  <strong>{responsible.name}</strong>
                                  <small>{responsible.role}</small>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </section>
                    ) : null}
                    <div className="orders-form-note">
                      <Info aria-hidden="true" />
                      Estos datos se usaran en contrato, orden de servicio y hoja de ruta.
                    </div>
                    {selectedClientForDraft?.isBlacklisted ? (
                      <div className="orders-form-note orders-form-note-warn">
                        Cliente en lista negra: {selectedClientForDraft.blacklistNotes || 'revisar motivo antes de atender.'}
                      </div>
                    ) : null}
                    {selectedClientForDraft?.prepaidEnabled ? (
                      <div className="orders-form-note orders-form-note-prepaid">
                        Cliente especial con saldo prepago disponible: {formatBs(selectedClientPrepaidBalanceBs)}. Al aprobar contrato se descontara automaticamente del saldo.
                      </div>
                    ) : null}
                  </>
                ) : null}

                {currentStep === 1 ? (
                  <>
                    <h4><span className="orders-section-icon"><CalendarDays aria-hidden="true" /></span>Informacion del evento</h4>
                    <p className="orders-step-help">
                      {draft.entityType === 'contract'
                        ? 'Define el evento y las fechas operativas del servicio.'
                        : 'Define el evento y la vigencia comercial de la cotizacion.'}
                    </p>
                    <div className="orders-form-grid">
                      <label className="orders-icon-field event">
                        Tipo de evento *
                        <span>
                          <i aria-hidden="true"><CircleUserRound /></i>
                          <input value={draft.eventType} onChange={(event) => setDraftField('eventType', event.target.value)} placeholder="Social, corporativo, boda..." />
                        </span>
                      </label>
                      {draft.entityType !== 'contract' ? (
                        <label className="orders-icon-field calendar">
                          Vigente hasta
                          <span>
                            <i aria-hidden="true"><CalendarDays /></i>
                            <input type="date" value={draft.validUntil || ''} onChange={(event) => setDraftField('validUntil', event.target.value)} />
                          </span>
                        </label>
                      ) : null}
                      <label className="orders-icon-field calendar">
                        Fecha evento *
                        <span>
                          <i aria-hidden="true"><CalendarDays /></i>
                          <input type="date" value={draft.eventDate} onChange={(event) => setDraftEventDate(event.target.value)} />
                        </span>
                      </label>
                      <label className="orders-icon-field time">
                        Hora evento *
                        <span>
                          <i aria-hidden="true"><Clock3 /></i>
                          <input type="time" value={draft.eventTime} onChange={(event) => setDraftField('eventTime', event.target.value)} />
                        </span>
                      </label>
                      {selectedClientAddresses.length > 0 ? (
                        <label className="orders-field-span-2 orders-icon-field address-select">
                          Seleccionar direccion del cliente
                          <span>
                            <i aria-hidden="true"><MapPin /></i>
                            <select
                              value={selectedClientAddresses.some((entry) => entry.id === draft.addressSource) ? draft.addressSource : 'manual'}
                              onChange={(event) => setDraftAddressSource(event.target.value)}
                            >
                              {selectedClientAddresses.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entry.label} - {[entry.address, entry.city].filter(Boolean).join(', ')}
                                </option>
                              ))}
                              <option value="manual">Nueva direccion para este evento</option>
                            </select>
                          </span>
                        </label>
                      ) : null}
                      <label className="orders-field-span-2 orders-icon-field location">
                        Direccion del evento *
                        <span>
                          <i aria-hidden="true"><MapPin /></i>
                          <input
                            value={draft.address}
                            onChange={(event) => {
                              setDraftField('addressSource', 'manual');
                              setDraftField('address', event.target.value);
                            }}
                            placeholder="Escribe una direccion o elige una del cliente"
                          />
                        </span>
                      </label>
                    </div>
                  </>
                ) : null}

                {currentStep === 2 ? (
                  <>
                    <h4><span className="orders-section-icon"><PackageOpen aria-hidden="true" /></span>{draft.entityType === 'contract' ? 'Items para contrato' : 'Items para cotizacion'}</h4>
                    <p className="orders-step-help">Busca, agrega y ajusta precios por linea sin salir de esta vista.</p>

                    <div className="orders-items-toolbar">
                      <label className="orders-search orders-icon-field">
                        <span>
                          <i aria-hidden="true"><Search /></i>
                          <input
                            type="search"
                            placeholder="Buscar por producto, color, material..."
                            value={itemSearch}
                            onChange={(event) => setItemSearch(event.target.value)}
                          />
                        </span>
                      </label>
                      <label>
                        Categoria
                        <select value={itemCategoryFilter} onChange={(event) => setItemCategoryFilter(event.target.value)}>
                          <option value="all">Todas</option>
                          {itemCategoryOptions.map((category) => (
                            <option key={category} value={category}>{category}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Facturacion
                        <select value={draft.billingMode} onChange={(event) => setDraftBillingMode(event.target.value)}>
                          <option value="sin_factura">Sin factura</option>
                          <option value="con_factura">Con factura</option>
                        </select>
                      </label>
                      <label>
                        Modo de cobro
                        <select value={draft.pricingMode} onChange={(event) => setDraftPricingMode(event.target.value)}>
                          <option value="simple">Precio unico</option>
                          <option value="duration">Por dias y porcentajes</option>
                          <option value="daily_schedule">Items por dia</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        className="ghost-button orders-clear-item-filters"
                        onClick={() => {
                          setItemSearch('');
                          setItemCategoryFilter('all');
                        }}
                      >
                        Limpiar filtros
                      </button>
                    </div>

                    {itemSearch.trim() ? (
                      <div className="orders-search-feedback" role="status">
                        <div>
                          <strong>
                            {filteredCatalog.length} {filteredCatalog.length === 1 ? 'coincidencia' : 'coincidencias'}
                          </strong>
                          <span>
                            para "{itemSearch.trim()}". Se ignoran barras, guiones, tildes y espacios.
                          </span>
                        </div>
                        <button type="button" className="ghost-button" onClick={() => setItemSearch('')}>
                          Limpiar busqueda
                        </button>
                      </div>
                    ) : null}

                    <section className={`orders-quick-item-panel ${isQuickItemOpen ? 'is-open' : 'is-collapsed'}`}>
                      <header>
                        <div>
                          <strong>Agregar item fuera de inventario</strong>
                          <span>Usalo solo cuando el producto aun no fue registrado o verificado.</span>
                        </div>
                        <div className="orders-step3-link-actions">
                          <button
                            type="button"
                            className={`orders-inline-link${isCourtesyMode ? ' is-active' : ''}`}
                            onClick={() => {
                              setIsCourtesyMode((current) => !current);
                              setFormError('');
                            }}
                          >
                            <Gift aria-hidden="true" />
                            {isCourtesyMode ? 'Selecciona cortesía' : 'Asignar cortesía'}
                          </button>
                          <button type="button" className="orders-inline-link" onClick={openServiceModal}>
                            <BriefcaseBusiness aria-hidden="true" />
                            Asignar servicios
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              setIsQuickItemOpen((current) => !current);
                              setFormError('');
                            }}
                            aria-expanded={isQuickItemOpen}
                          >
                            {isQuickItemOpen ? 'Cancelar' : '+ Agregar item fuera de inventario'}
                          </button>
                        </div>
                      </header>
                      {isQuickItemOpen ? (
                        <>
                          <div className="orders-quick-item-grid">
                            <label>
                              Categoria *
                              <input
                                value={quickItemDraft.category}
                                onChange={(event) => setQuickItemField('category', event.target.value)}
                                placeholder="Sillas, vasos, manteles..."
                                list="orders-quick-item-categories"
                              />
                              <datalist id="orders-quick-item-categories">
                                {itemCategoryOptions.map((category) => (
                                  <option key={category} value={category} />
                                ))}
                              </datalist>
                            </label>
                            <label>
                              Nombre / modelo *
                              <input
                                value={quickItemDraft.name}
                                onChange={(event) => setQuickItemField('name', event.target.value)}
                                placeholder="Tiffany, cristal, redonda..."
                              />
                            </label>
                            <label>
                              Color
                              <input value={quickItemDraft.color} onChange={(event) => setQuickItemField('color', event.target.value)} placeholder="Blanco, dorado..." />
                            </label>
                            <label>
                              Material
                              <input value={quickItemDraft.material} onChange={(event) => setQuickItemField('material', event.target.value)} placeholder="Madera, vidrio..." />
                            </label>
                            <label>
                              Precio unitario Bs
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={quickItemDraft.rentalPriceBs}
                                onChange={(event) => setQuickItemField('rentalPriceBs', event.target.value)}
                              />
                            </label>
                          </div>
                          <footer className="orders-quick-item-actions">
                            <span>Se agregara al contrato sin descontar stock hasta que Inventario lo verifique.</span>
                            <button type="button" className="primary-button" onClick={addQuickDraftItem}>
                              Crear y agregar
                            </button>
                          </footer>
                        </>
                      ) : null}
                    </section>

                    {isDailyScheduleMode ? (
                      <section className="orders-daily-schedule-card">
                        <header>
                          <div>
                            <strong>Items por dia</strong>
                            <span>Agrega productos al dia activo. Cada dia suma su propio subtotal dentro del mismo contrato.</span>
                          </div>
                          <div className="orders-daily-schedule-actions">
                            <button type="button" className="ghost-button" onClick={syncScheduleDaysFromLogistics}>
                              Usar fechas de logistica
                            </button>
                            <button type="button" className="ghost-button" onClick={addScheduleDay}>
                              + Dia
                            </button>
                          </div>
                        </header>
                        <div className="orders-daily-tabs" role="tablist" aria-label="Dias del contrato">
                          {scheduleDayTotals.map((day) => (
                            <button
                              key={day.id}
                              type="button"
                              className={day.id === activeScheduleDay?.id ? 'active' : ''}
                              onClick={() => setActiveScheduleDayId(day.id)}
                            >
                              <strong>{day.label}</strong>
                              <span>{formatDate(day.date)}</span>
                              <small>{day.itemCount} linea(s) · {formatBs(day.totalBs)}</small>
                            </button>
                          ))}
                        </div>
                        {activeScheduleDay ? (
                          <div className="orders-daily-editor">
                            <label>
                              Nombre del dia
                              <input
                                value={activeScheduleDay.label}
                                onChange={(event) => updateScheduleDay(activeScheduleDay.id, { label: event.target.value })}
                                placeholder="Dia 1, Sabado noche..."
                              />
                            </label>
                            <label>
                              Fecha
                              <input
                                type="date"
                                value={activeScheduleDay.date}
                                onChange={(event) => updateScheduleDay(activeScheduleDay.id, { date: event.target.value })}
                              />
                            </label>
                            <label className="wide">
                              Nota interna del dia
                              <input
                                value={activeScheduleDay.note}
                                onChange={(event) => updateScheduleDay(activeScheduleDay.id, { note: event.target.value })}
                                placeholder="Ej: montaje salon principal, solo vajilla..."
                              />
                            </label>
                            <button
                              type="button"
                              className="danger-button"
                              onClick={() => removeScheduleDay(activeScheduleDay.id)}
                              disabled={normalizedScheduleDays.length <= 1}
                            >
                              Quitar dia
                            </button>
                          </div>
                        ) : null}
                      </section>
                    ) : null}

                    <section className={`orders-duration-card ${draft.pricingMode === 'duration' ? 'active' : ''}`}>
                      <header className="orders-duration-head">
                        <div>
                          <strong>Tarifa por duracion</strong>
                          <span>Aplica porcentajes por dia sobre el subtotal base negociado.</span>
                        </div>
                      </header>

                      {draft.pricingMode === 'duration' ? (
                        <>
                          <div className="orders-duration-controls">
                            <label>
                              Dias de uso
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={draft.pricingDays}
                                onChange={(event) => setDraftPricingDays(event.target.value)}
                              />
                            </label>
                            <div className="orders-duration-total">
                              <span>Base por dia</span>
                              <strong>{formatBs(durationPricing.baseSubtotalBs)}</strong>
                            </div>
                            <div className="orders-duration-total">
                              <span>Subtotal con duracion</span>
                              <strong>{formatBs(durationPricing.chargeableSubtotalBs)}</strong>
                            </div>
                          </div>

                          <div className="orders-duration-tiers">
                            <div className="orders-duration-tier-head">
                              <span>Desde dia</span>
                              <span>Hasta dia</span>
                              <span>% cobro</span>
                              <span />
                            </div>
                            {draft.pricingTiers.map((tier) => (
                              <div key={tier.id} className="orders-duration-tier-row">
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={tier.fromDay}
                                  onChange={(event) => updatePricingTier(tier.id, 'fromDay', event.target.value)}
                                  aria-label="Dia inicial del tramo"
                                />
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={tier.toDay}
                                  onChange={(event) => updatePricingTier(tier.id, 'toDay', event.target.value)}
                                  placeholder="En adelante"
                                  aria-label="Dia final del tramo"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="1"
                                  value={tier.percent}
                                  onChange={(event) => updatePricingTier(tier.id, 'percent', event.target.value)}
                                  aria-label="Porcentaje de cobro del tramo"
                                />
                                <button type="button" className="ghost-button" onClick={() => removePricingTier(tier.id)}>
                                  Quitar
                                </button>
                              </div>
                            ))}
                          </div>

                          <div className="orders-duration-foot">
                            <button type="button" className="ghost-button" onClick={addPricingTier}>
                              + Agregar tramo
                            </button>
                            <span>
                              Ahorro/promocion calculada: <strong>{formatBs(durationPricing.durationDiscountBs)}</strong>
                            </span>
                          </div>
                        </>
                      ) : null}
                    </section>

                    <section className="orders-availability-strip" aria-label="Disponibilidad del inventario para estas fechas">
                      <article>
                        <CalendarDays className="orders-availability-icon" aria-hidden="true" />
                        <span>Evento objetivo</span>
                        <strong>{formatDate(draft.eventDate)} {draft.eventTime || ''}</strong>
                        <small>Disponibilidad calculada para esta fecha.</small>
                      </article>
                      <article className="returns">
                        <RefreshCw className="orders-availability-icon" aria-hidden="true" />
                        <span>Devoluciones consideradas</span>
                        {returnSummaryRows.length > 0 ? (
                          <>
                            <strong>{returnSummaryRows.reduce((sum, row) => sum + row.quantity, 0)} unidades vuelven para la fecha</strong>
                            <div
                              className="orders-return-mini-list"
                              title={returnSummaryRows
                                .map((row) => `${formatDate(row.date)} ${row.time || ''} - Contrato ${row.code} - ${row.quantity} u.${row.itemText ? ` (${row.itemText})` : ''}`)
                                .join('\n')}
                            >
                              {returnSummaryRows.slice(0, 1).map((row) => (
                                <small key={row.key}>
                                  {formatDate(row.date)} {row.time || ''} · Contrato {row.code} · {row.quantity} u.
                                  {row.itemText ? ` (${row.itemText})` : ''}
                                </small>
                              ))}
                              {returnSummaryRows.length > 1 ? <small>Ver detalle</small> : null}
                            </div>
                          </>
                        ) : (
                          <>
                            <strong>Sin retornos previos</strong>
                            <small>La disponibilidad sale del stock libre actual.</small>
                          </>
                        )}
                      </article>
                      <article className={uncoveredStockIssues.length ? 'danger' : 'success'}>
                        <Box className="orders-availability-icon" aria-hidden="true" />
                        <span>Estado inventario</span>
                        <strong>
                          {stockIssues.length === 0
                            ? 'Disponible'
                            : uncoveredStockIssues.length > 0
                            ? `${uncoveredStockIssues.length} faltante sin cubrir`
                            : `${stockIssues.length} faltante cubierto por proveedor`}
                        </strong>
                        <small>
                          {stockIssues.length === 0
                            ? 'Validado con calendario operativo'
                            : uncoveredStockIssues.length > 0
                            ? 'Define proveedor y costo para completar cobertura'
                            : 'Cobertura lista desde proveedores'}
                        </small>
                      </article>
                    </section>

                    <div className="orders-products-head">
                      <strong>Productos disponibles</strong>
                      <span>Mostrando {visibleCatalog.length} de {filteredCatalog.length} productos y combos</span>
                    </div>

                    <div className="orders-product-list">
                      <div className="orders-product-table-head" aria-hidden="true">
                        <span>Producto</span>
                        <span>Detalles</span>
                        <span>Precio unitario</span>
                        <span>Stock</span>
                        <span>Agregado</span>
                        <span>Accion</span>
                      </div>
                      {visibleCatalog.map((entry) => {
                        if (entry.type === 'combo') {
                          const combo = entry.combo;
                          const ingredients = getComboRules(combo);
                          const defaultComboSelections = {};
                          ingredients.forEach((line, index) => {
                            defaultComboSelections[index] = getComboRuleOptions(line).map((option) => option.id);
                          });
                          const comboMaxQuantity = getComboMaxQuantity(combo, defaultComboSelections);
                          const allVerified = ingredients.every((line) => {
                            const item = items.find((candidate) => candidate.id === line.itemId);
                            return item?.controlsStock !== false && String(item?.verificationStatus ?? '').trim() !== 'pending_verification';
                          });
                          return (
                            <article key={`combo-${combo.id}`} className="orders-product-row orders-combo-catalog-row">
                              <div className="orders-product-thumb orders-combo-thumb">
                                {getProductImageSrc(combo) ? (
                                  <button
                                    type="button"
                                    className="orders-product-thumb-button"
                                    onClick={() => handleOpenProductImage(combo)}
                                    aria-label={`Ver imagen de ${combo.name} en grande`}
                                    title="Ver imagen en grande"
                                  >
                                    <ProductImage
                                      item={combo}
                                      alt={`Imagen de ${combo.name}`}
                                      fallback={<span>CB</span>}
                                    />
                                  </button>
                                ) : <span>CB</span>}
                              </div>
                              <div className="orders-product-info">
                                <strong title={combo.name}>{combo.name}</strong>
                                <span>Combo configurable · {ingredients.length} componente(s)</span>
                                <div className="orders-availability-metrics">
                                  <button
                                    type="button"
                                    className="primary orders-availability-metric-button"
                                    onClick={() => setComboAvailabilityDetailModal(
                                      getComboAvailabilityDetail(combo, defaultComboSelections),
                                    )}
                                    title="Ver por qué se puede armar esta cantidad de combos para la fecha"
                                  >
                                    <small>Puede armar</small>
                                    <strong>{comboMaxQuantity}</strong>
                                    <em>Ver detalle</em>
                                  </button>
                                  <span>
                                    <small>Componentes</small>
                                    <strong>{ingredients.length}</strong>
                                  </span>
                                  <span className={allVerified ? 'positive' : 'warning'}>
                                    <small>Descuento</small>
                                    <strong>{allVerified ? 'Activo' : 'Pendiente'}</strong>
                                  </span>
                                </div>
                              </div>
                              <div className="orders-product-table-details">
                                {ingredients.slice(0, 2).map((line) => (
                                  <span key={`${combo.id}-${line.itemId}`}>{line.quantity}x {line.slotLabel || line.itemName}</span>
                                ))}
                                {ingredients.length > 2 ? (
                                  <span
                                    className="orders-more-chip"
                                    title={ingredients
                                      .slice(2)
                                      .map((line) => `${line.quantity}x ${line.slotLabel || line.itemName}`)
                                      .join('\n')}
                                  >
                                    +{ingredients.length - 2} mas
                                  </span>
                                ) : null}
                              </div>
                              <strong className="orders-product-price">{formatBs(combo.rentalPriceBs)}<small>Precio unico</small></strong>
                              <span className={`orders-product-stock-badge${comboMaxQuantity > 0 ? ' available' : ''}`}>
                                {comboMaxQuantity > 0 ? `${comboMaxQuantity} combos` : 'Sin stock'}
                              </span>
                              <span className="orders-catalog-card-chip">Combo</span>
                              <button
                                type="button"
                                className="primary-button"
                                onClick={() => addDraftCombo(combo.id)}
                                disabled={ingredients.length === 0 || comboMaxQuantity <= 0}
                              >
                                Agregar
                              </button>
                            </article>
                          );
                        }
                        const item = entry.item;
                        const availability = availabilityByItemId.get(item.id) ?? null;
                        const isProvisionalCatalogItem = isDetachedFromInventory(item);
                        const projectedAvailable = Math.max(0, Number(availability?.projectedAvailable ?? item.availableStock ?? 0));
                        const returningQty = Math.max(0, Number(availability?.returningBeforeStartQty ?? 0));
                        const softQty = Math.max(0, Number(availability?.softReservedQty ?? 0));
                        const catalogHardRecords = availability?.hardReservedQtyRecords ?? [];
                        const catalogReturningRecords = availability?.returningBeforeStartQtyRecords ?? [];
                        const detailParts = getOperationalItemDetails({ item });
                        return (
                        <article
                          key={item.id}
                          className={`orders-product-row${!isProvisionalCatalogItem && projectedAvailable <= 0 ? ' is-unavailable' : ''}${isProvisionalCatalogItem ? ' is-provisional' : ''}`}
                        >
                          <div className={`orders-product-thumb${getProductImageSrc(item) ? ' has-image' : ' has-no-image'}`}>
                            {getProductImageSrc(item) ? (
                              <button
                                type="button"
                                className="orders-product-thumb-button"
                                onClick={() => handleOpenProductImage(item)}
                                aria-label={`Ver imagen de ${item.name} en grande`}
                                title="Ver imagen en grande"
                              >
                                <ProductImage
                                  item={item}
                                  alt={`Imagen de ${item.name}`}
                                  fallback={<span className="orders-product-image-fallback"><Box aria-hidden="true" /></span>}
                                />
                              </button>
                            ) : (
                              <span className="orders-product-image-fallback"><Box aria-hidden="true" /></span>
                            )}
                          </div>
                          <div className="orders-product-info">
                            <strong title={item.name}>{item.name}</strong>
                            <span>
                              {item.category || 'Sin categoria'}
                              {isProvisionalCatalogItem ? ' | Pendiente de inventario' : ''}
                            </span>
                            {detailParts.length > 0 ? (
                              <div className="orders-product-detail-line">
                                {detailParts.map((part) => (
                                  <span key={`${item.id}-${part.label}`}>{part.label}: {part.value}</span>
                                ))}
                              </div>
                            ) : null}
                            {isProvisionalCatalogItem ? (
                              <div className="orders-availability-metrics is-provisional">
                                <span className="primary">
                                  <small>Modo</small>
                                  <strong>Operativo</strong>
                                </span>
                                <span>
                                  <small>Stock</small>
                                  <strong>No descuenta</strong>
                                </span>
                                <span className="warning">
                                  <small>Estado</small>
                                  <strong>Verificar</strong>
                                </span>
                              </div>
                            ) : (
                              <div className="orders-availability-metrics">
                                <button
                                  type="button"
                                  className="primary orders-availability-metric-button"
                                  onClick={() => setAvailabilityDetailModal({
                                    mode: 'date',
                                    item,
                                    summary: availability,
                                  })}
                                  title="Ver por qué esta cantidad está disponible para la fecha"
                                >
                                  <small>Para fecha</small>
                                  <strong>{projectedAvailable}</strong>
                                  <em>Ver detalle</em>
                                </button>
                                <button
                                  type="button"
                                  className="orders-availability-metric-button"
                                  onClick={() => setAvailabilityDetailModal({
                                    mode: 'now',
                                    item,
                                    summary: availability,
                                  })}
                                  title="Ver por qué esta cantidad está disponible ahora"
                                >
                                  <small>Ahora</small>
                                  <strong>{Math.max(0, Number(item.availableStock ?? 0))}</strong>
                                  <em>Ver detalle</em>
                                </button>
                                <button
                                  type="button"
                                  className={`orders-availability-metric-button${returningQty > 0 ? ' positive' : ''}`}
                                  onClick={() => setAvailabilityDetailModal({
                                    mode: 'returns',
                                    item,
                                    summary: availability,
                                  })}
                                  title="Ver qué contratos devuelven este producto antes de la fecha"
                                >
                                  <small>Vuelven</small>
                                  <strong>{returningQty}</strong>
                                  <em>Ver detalle</em>
                                </button>
                                {softQty > 0 ? (
                                  <span className="warning">
                                    <small>Riesgo</small>
                                    <strong>{softQty}</strong>
                                  </span>
                                ) : null}
                              </div>
                            )}
                            {!isProvisionalCatalogItem && catalogReturningRecords.length > 0 ? (
                              <small className="orders-available-note is-positive orders-catalog-availability-note">
                                Vuelve para usar: contrato {catalogReturningRecords[0].contractCode || catalogReturningRecords[0].code || catalogReturningRecords[0].orderCode} el {formatDate(catalogReturningRecords[0].endDate)}
                              </small>
                            ) : null}
                            {!isProvisionalCatalogItem && catalogHardRecords.length > 0 && projectedAvailable <= 0 ? (
                              <small className="orders-available-note is-warning orders-catalog-availability-note">
                                Usado por contrato {catalogHardRecords[0].contractCode || catalogHardRecords[0].code || catalogHardRecords[0].orderCode} hasta {formatDate(catalogHardRecords[0].endDate)}
                              </small>
                            ) : null}
                          </div>
                          <div className="orders-product-table-details">
                            {detailParts.length > 0
                              ? detailParts.map((part) => (
                                <span key={`${item.id}-table-${part.label}`}>{part.value}</span>
                              ))
                              : <span>{item.category || 'Sin detalle'}</span>}
                          </div>
                          <strong className="orders-product-price">{formatBs(item.rentalPriceBs)}<small>Precio unico</small></strong>
                          <span className={`orders-product-stock-badge${!isProvisionalCatalogItem && projectedAvailable > 0 ? ' available' : ''}`}>
                            {isProvisionalCatalogItem ? 'No descuenta' : `${projectedAvailable} disponibles`}
                          </span>
                          {Number(draftQuantityByItem.get(item.id) ?? 0) > 0 ? (
                            <span className="orders-catalog-card-chip">x{draftQuantityByItem.get(item.id)}</span>
                          ) : (
                            <span />
                          )}
                          <button
                            type="button"
                            className={isCourtesyMode ? 'ghost-button' : 'primary-button'}
                            onClick={() => addDraftItem(item.id, { courtesy: isCourtesyMode })}
                          >
                            {isCourtesyMode ? 'Cortesía' : 'Agregar'}
                          </button>
                        </article>
                        );
                      })}
                      {filteredCatalog.length === 0 ? <p className="status">No hay productos o combos para esta busqueda.</p> : null}
                    </div>
                    {remainingCatalogCount > 0 ? (
                      <div className="orders-catalog-actions">
                        <span>
                          Quedan {remainingCatalogCount} resultados por mostrar.
                        </span>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => setCatalogModalOpen(true)}
                        >
                          Ver todos los productos ({filteredCatalog.length})
                        </button>
                      </div>
                    ) : null}

                    <section className="orders-selected-section">
                      <div className="orders-selected-head">
                        <strong>
                          {isDailyScheduleMode && activeScheduleDay
                            ? `${activeScheduleDay.label} (${selectedItemsForActiveDay.length})`
                            : `Seleccionados (${selectedItems.length})`}
                        </strong>
                        <span>
                          {isDailyScheduleMode
                            ? `Edita solo las lineas de ${activeScheduleDay?.label ?? 'este dia'}. El contrato suma todos los dias.`
                            : 'Edita cantidades y precio unitario negociado.'}
                        </span>
                      </div>
                      {selectedItemsForActiveDay.length > 0 ? (
                        <div className="orders-selected-table-head" aria-hidden="true">
                          <span>Producto</span>
                          <span>Cantidad</span>
                          <span>Precio unitario</span>
                          <span>Descuento</span>
                          <span>Subtotal</span>
                          <span>Accion</span>
                        </div>
                      ) : null}
                      <div className="orders-selected-list orders-selected-editor">
                      {selectedItemsForActiveDay.length === 0 ? (
                        <p className="status">
                          {isDailyScheduleMode ? 'Aun no agregaste items para este dia.' : 'Aun no agregaste items.'}
                        </p>
                      ) : (
                        selectedItemAreaGroups.map(({ area, lines: areaLines }) => (
                          <section className={`orders-selected-area-group area-${area.className}`} key={area.key}>
                            <header className="orders-selected-area-head">
                              <span>{area.label}</span>
                              <strong>{areaLines.length} item(s)</strong>
                            </header>
                            {areaLines.map((line, lineIndex) => {
                          const availability = line.availability;
                          const isProvisionalItem = isDetachedFromInventory(line);
                          const isCourtesyLine = line.lineType === 'courtesy';
                          const detailParts = getOperationalItemDetails(line);
                          const comboSiblingLines = line.comboLineKey
                            ? selectedItems.filter((entry) => entry.comboLineKey === line.comboLineKey)
                            : [];
                          const isFirstComboLine = Boolean(line.comboLineKey && areaLines[lineIndex - 1]?.comboLineKey !== line.comboLineKey);
                          const isLastComboLine = Boolean(line.comboLineKey && areaLines[lineIndex + 1]?.comboLineKey !== line.comboLineKey);
                          const comboGroupTotalBs = comboSiblingLines.reduce((sum, entry) => sum + Number(entry.lineTotalBs ?? 0), 0);
                          const comboGroupUnits = comboSiblingLines.reduce((sum, entry) => sum + Number(entry.quantity ?? 0), 0);
                          const availableStock = getEditableAvailableStock(line);
                          const existingCommittedQtyForEdit = getExistingCommittedQtyForEdit(line);
                          const requestedForItem = Math.max(0, Number(selectedDemandByItemId.get(line.itemId) ?? line.quantity));
                          const shortageForItem = bypassStockValidation
                            ? 0
                            : Math.max(0, requestedForItem - availableStock);
                          const supplierCoverageKey = getSupplierCoverageKey(line);
                          const supplierCoverageLines = normalizeCoverageDraftLines(supplierFulfillmentDraftByItem[supplierCoverageKey] ?? supplierFulfillmentDraftByItem[line.itemId])
                            .filter((coverage) => coverage.supplierId && coverage.supplierName && coverage.neededQty > 0);
                          const supplierPlannedQty = supplierCoverageLines.reduce((sum, coverage) => sum + Math.max(0, Math.trunc(Number(coverage.neededQty ?? 0))), 0);
                          const manuallyAddedSupplierQty = supplierCoverageLines
                            .filter((coverage) => coverage.manualCoverage)
                            .reduce((sum, coverage) => sum + Math.max(0, Math.trunc(Number(coverage.neededQty ?? 0))), 0);
                          const totalCommittedQty = Math.max(0, Math.trunc(Number(line.quantity ?? 0))) + manuallyAddedSupplierQty;
                          const effectiveShortageForItem = Math.max(shortageForItem, Math.min(requestedForItem, supplierPlannedQty));
                          const supplierCoveredQty = Math.min(
                            effectiveShortageForItem,
                            supplierPlannedQty,
                          );
                          const uncoveredForItem = Math.max(0, effectiveShortageForItem - supplierCoveredQty);
                          const hasStockShortage = !bypassStockValidation && !isProvisionalItem && effectiveShortageForItem > 0;
                          const hasUncoveredShortage = !bypassStockValidation && !isProvisionalItem && uncoveredForItem > 0;
                          const returningRecords = availability?.returningBeforeStartQtyRecords ?? [];
                          const hardRecords = availability?.hardReservedQtyRecords ?? [];
                          const softRecords = availability?.softReservedQtyRecords ?? [];
                          const moveKey = getWizardItemMoveKey(line);
                          return (
                          <div
                            key={line.lineKey}
                            className={`orders-selected-row area-${area.className}${hasUncoveredShortage ? ' stock-warning' : ''}${line.comboLineKey ? ' is-combo-line' : ' is-standalone-line'}${line.comboPricingRole === 'price' ? ' is-combo-price-line' : ''}${draggedSelectedItemKey === moveKey ? ' is-dragging' : ''}`}
                            draggable
                            onDragStart={(event) => handleSelectedItemDragStart(event, line)}
                            onDragOver={(event) => handleSelectedItemDragOver(event, line)}
                            onDrop={(event) => handleSelectedItemDrop(event, line)}
                            onDragEnd={() => setDraggedSelectedItemKey('')}
                          >
                            {isFirstComboLine ? (
                              <div className="orders-selected-combo-group-head">
                                <span>
                                  <strong>{line.comboName || 'Combo configurado'}</strong>
                                  <small>{line.comboQuantity || 1} combo(s) · {comboSiblingLines.length} componente(s) · {comboGroupUnits} unidad(es)</small>
                                </span>
                                <em>{formatBs(comboGroupTotalBs)}</em>
                              </div>
                            ) : null}
                            <div className="orders-selected-product-cell">
                              <div className={`orders-selected-thumb${getProductImageSrc(line.item) ? ' has-image' : ' has-no-image'}`}>
                                {getProductImageSrc(line.item) ? (
                                  <button
                                    type="button"
                                    className="orders-selected-thumb-button"
                                    onClick={() => handleOpenProductImage(line.item)}
                                    aria-label={`Ver imagen de ${line.item.name} en grande`}
                                    title="Ver imagen en grande"
                                  >
                                    <ProductImage
                                      item={line.item}
                                      alt={`Imagen de ${line.item.name}`}
                                      fallback={<span className="orders-product-image-fallback"><Box aria-hidden="true" /></span>}
                                    />
                                  </button>
                                ) : (
                                  <span className="orders-product-image-fallback"><Box aria-hidden="true" /></span>
                                )}
                              </div>
                              <div className="orders-selected-product-copy">
                              <div className="orders-selected-line-tools">
                                <span className={`orders-selected-origin-badge${line.comboLineKey ? ' is-combo' : ''}`}>
                                  {isCourtesyLine ? 'Cortesía' : line.comboLineKey ? 'Parte del combo' : 'Item separado'}
                                </span>
                                <button
                                  type="button"
                                  className={`orders-line-observation-link${String(line.observation ?? '').trim() ? ' has-note' : ''}`}
                                  onClick={() => openItemObservationModal(line)}
                                >
                                  Observacion
                                </button>
                                {isDailyScheduleMode ? (
                                  <select
                                    className="orders-line-day-select"
                                    value={line.serviceDayId ?? activeScheduleDay?.id ?? ''}
                                    onChange={(event) => {
                                      const nextDay = normalizedScheduleDays.find((day) => day.id === event.target.value);
                                      setDraft((current) => ({
                                        ...current,
                                        items: current.items.map((entry) => (
                                          (
                                            line.comboLineKey
                                              ? String(entry.comboLineKey ?? '') === String(line.comboLineKey)
                                              : String(entry.lineKey ?? entry.comboLineKey ?? entry.itemId) === String(line.lineKey)
                                          )
                                            ? {
                                              ...entry,
                                              serviceDayId: nextDay?.id ?? '',
                                              serviceDate: nextDay?.date ?? '',
                                              serviceDayLabel: nextDay?.label ?? '',
                                            }
                                            : entry
                                        )),
                                      }));
                                    }}
                                    aria-label={`Dia de servicio de ${line.item.name}`}
                                  >
                                    {normalizedScheduleDays.map((day) => (
                                      <option key={day.id} value={day.id}>{day.label}</option>
                                    ))}
                                  </select>
                                ) : null}
                                {!bypassStockValidation && !isProvisionalItem ? (
                                  <button
                                    type="button"
                                    className={`orders-line-provider-link${supplierCoverageLines.length > 0 ? ' has-provider' : ''}`}
                                    onClick={() => openSupplierCoverageModal(line, availableStock, { manual: true })}
                                  >
                                    Agregar proveedor
                                  </button>
                                ) : null}
                              </div>
                              <strong>{line.item.name}</strong>
                              {line.comboName ? (
                                <p className="orders-combo-line-note">
                                  Combo: {line.comboName} · {line.comboQuantity} paquete(s)
                                  {line.comboDistributed
                                    ? ` · ${line.comboSlotLabel || 'componente'} distribuido`
                                    : line.comboComponentQuantity > 1 ? ` · ${line.comboComponentQuantity} por paquete` : ''}
                                </p>
                              ) : null}
                              {line.comboId && line.comboPricingRole === 'price' ? (
                                <button
                                  type="button"
                                  className="orders-combo-configure-link"
                                  onClick={() => {
                                    const combo = (combos ?? []).find((entry) => entry.id === line.comboId);
                                    if (combo) openComboConfigurator(combo, line.comboLineKey);
                                  }}
                                >
                                  Tipo, color y modelo
                                </button>
                              ) : null}
                              {detailParts.length > 0 ? (
                                <div className="orders-item-detail-chips">
                                  {detailParts.map((part) => (
                                    <span key={`${line.itemId}-${part.label}`}>
                                      <small>{part.label}</small>
                                      {part.value}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              <p>
                                {isCourtesyLine ? 'Cortesia sin cargo' : `Base: ${formatBs(line.item.rentalPriceBs)} c/u`}
                                {isProvisionalItem ? ' | Pendiente de verificacion' : ''}
                              </p>
                              {String(line.observation ?? '').trim() ? (
                                <p className="orders-selected-item-note">{String(line.observation ?? '').trim()}</p>
                              ) : null}
                              {hasUncoveredShortage ? (
                                <div className="orders-provider-action-card">
                                  <span>
                                    <strong>Faltan {uncoveredForItem} u.</strong>
                                    <small>Necesita proveedor para completar este item.</small>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => openSupplierCoverageModal(line, availableStock)}
                                  >
                                    Agregar proveedor
                                  </button>
                                </div>
                              ) : null}
                              </div>
                            </div>
                            <div className={`orders-line-field orders-line-quantity${hasUncoveredShortage ? ' has-error' : ''}`}>
                              <span>Cant.</span>
                              <div className="orders-qty-stepper">
                                <button
                                  type="button"
                                  onClick={() => setDraftItemQuantity(line.lineKey, String(Math.max(1, Number(line.quantity ?? 1) - 1)))}
                                  aria-label={`Reducir cantidad de ${line.item.name}`}
                                >
                                  -
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={line.quantityInput}
                                  onFocus={selectNumericInput}
                                  onChange={(event) => setDraftItemQuantity(line.lineKey, event.target.value)}
                                  onBlur={() => normalizeDraftItemQuantity(line.lineKey)}
                                  aria-label={`Cantidad de ${line.item.name}`}
                                  aria-invalid={hasUncoveredShortage ? 'true' : 'false'}
                                />
                                <button
                                  type="button"
                                  onClick={() => setDraftItemQuantity(line.lineKey, String(Number(line.quantity ?? 1) + 1))}
                                  aria-label={`Aumentar cantidad de ${line.item.name}`}
                                >
                                  +
                                </button>
                              </div>
                              {!bypassStockValidation ? (
                                <div className={`orders-selected-availability${hasUncoveredShortage ? ' is-error' : ''}`}>
                                  <button
                                    type="button"
                                    onClick={() => setAvailabilityDetailModal({
                                      mode: 'date',
                                      item: line.item,
                                      summary: availability,
                                    })}
                                    title="Ver por qué esta cantidad está disponible para la fecha"
                                    aria-label={`Ver disponibilidad de ${line.item.name} para la fecha`}
                                  >
                                    <small>Fecha</small>
                                    <strong>{availableStock}</strong>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setAvailabilityDetailModal({
                                      mode: 'now',
                                      item: line.item,
                                      summary: availability,
                                    })}
                                    title="Ver por qué esta cantidad está disponible ahora"
                                    aria-label={`Ver disponibilidad actual de ${line.item.name}`}
                                  >
                                    <small>Ahora</small>
                                    <strong>{Math.max(0, Number(line.item.availableStock ?? 0))}</strong>
                                  </button>
                                </div>
                              ) : null}
                              {isHistoricalReturnedContractEdit ? (
                                <small className="orders-available-note is-positive">
                                  Operacion devuelta: esta correccion historica no revalida stock ni exige proveedor.
                                </small>
                              ) : isProvisionalItem ? (
                                <small className="orders-available-note is-warning">
                                  Item operativo: se guarda y vuelve en la orden, pero aun no descuenta stock.
                                </small>
                              ) : !bypassStockValidation ? (
                                <>
                                  <small className={`orders-available-note${hasUncoveredShortage ? ' is-error' : ''}`}>
                                    Fecha {availableStock} · ahora {Math.max(0, Number(line.item.availableStock ?? 0))}
                                  </small>
                                  {existingCommittedQtyForEdit > 0 ? (
                                    <small className="orders-available-note is-positive">
                                      {existingCommittedQtyForEdit} u. ya comprometidas en este contrato; solo los aumentos se revalidan.
                                    </small>
                                  ) : null}
                                </>
                              ) : null}
                              {returningRecords.length > 0 ? (
                                <small className="orders-available-note is-positive orders-return-contract-note">
                                  <span>Depende de retorno:</span>
                                  {returningRecords.slice(0, 2).map((record) => (
                                    <button
                                      key={`${record.id || record.code}-${record.endDate}`}
                                      type="button"
                                      onClick={() => openAvailabilityContractDetail(record)}
                                    >
                                      Contrato {record.contractCode || record.code || record.orderCode || 'previo'} · {record.quantity} u. · vuelve {formatDate(record.endDate)}
                                    </button>
                                  ))}
                                </small>
                              ) : null}
                              {hardRecords.length > 0 ? (
                                <small className="orders-available-note is-warning orders-return-contract-note">
                                  <span>Usado por:</span>
                                  {hardRecords.slice(0, 2).map((record) => (
                                    <button
                                      key={`${record.id || record.code}-hard-${record.endDate}`}
                                      type="button"
                                      onClick={() => openAvailabilityContractDetail(record)}
                                    >
                                      Contrato {record.contractCode || record.code || record.orderCode || 'previo'} · {record.quantity} u. · hasta {formatDate(record.endDate)}
                                    </button>
                                  ))}
                                </small>
                              ) : null}
                              {softRecords.length > 0 ? (
                                <small className="orders-available-note is-warning">
                                  Riesgo blando: {softRecords.slice(0, 2).map((record) => `${record.quantity} ${record.code || ''}`).join(' · ')}
                                </small>
                              ) : null}
                              {hasStockShortage && !hasUncoveredShortage ? (
                                <small className="orders-available-note is-positive">
                                  Faltante cubierto por proveedor: {supplierCoveredQty} u.
                                </small>
                              ) : null}
                              {manuallyAddedSupplierQty > 0 ? (
                                <small className="orders-available-note is-positive">
                                  Total comprometido: {totalCommittedQty} u. ({line.quantity} propias + {manuallyAddedSupplierQty} subalquiladas)
                                </small>
                              ) : null}
                            </div>
                            <label className="orders-line-field orders-line-price">
                              <span>Precio</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                pattern="[0-9]*[.,]?[0-9]*"
                                value={line.unitPriceInput}
                                onFocus={selectNumericInput}
                                onChange={(event) => setDraftItemPrice(line.lineKey, event.target.value)}
                                onBlur={() => normalizeDraftItemPrice(line.lineKey)}
                                title="Escribe el precio manualmente. La rueda del mouse no modifica este valor."
                                aria-label={`Precio unitario de ${line.item.name}`}
                                readOnly={isCourtesyLine || Boolean(line.comboId && line.comboPricingRole !== 'price')}
                              />
                              {isCourtesyLine ? (
                                <small className="orders-available-note">Cortesía sin cobro</small>
                              ) : null}
                              {line.comboId && line.comboPricingRole !== 'price' ? (
                                <small className="orders-available-note">Incluido en el precio del combo</small>
                              ) : null}
                            </label>
                            <label className="orders-line-field orders-line-discount">
                              <span>Descuento</span>
                              <select
                                value={String(line.discountPercent ?? 0)}
                                onChange={(event) => setDraftItemDiscountPercent(line.lineKey, event.target.value)}
                                disabled={isCourtesyLine}
                              >
                                {[0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75].map((percent) => (
                                  <option key={percent} value={percent}>{percent}%</option>
                                ))}
                              </select>
                              <small className="orders-available-note">
                                Rebaja: {formatBs(line.lineDiscountBs ?? 0)}
                              </small>
                            </label>
                            <strong>{formatBs(getDisplayedItemSubtotalBs(line))}</strong>
                            <button
                              type="button"
                              className="danger-button orders-selected-remove"
                              onClick={() => removeDraftItem(line.lineKey)}
                              aria-label={`Quitar ${line.item.name}`}
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                            {supplierCoverageLines.length > 0 ? (
                              <div className={`orders-supplier-coverage-field orders-supplier-coverage-band${hasUncoveredShortage ? ' needs-provider' : ''}`}>
                                <span>Subalquiler</span>
                                <div className="orders-supplier-coverage-list">
                                  {supplierCoverageLines.map((coverage) => (
                                    <span key={coverage.id} className="orders-supplier-coverage-chip">
                                      <strong>{coverage.neededQty} SUB {makeSupplierShortCode(coverage.supplierName)}</strong>
                                      <small>{formatBs(coverage.supplierUnitCostBs)} c/u</small>
                                      <button
                                        type="button"
                                        onClick={() => removeSupplierCoverageLine(supplierCoverageKey, coverage.id)}
                                        aria-label={`Quitar cobertura ${coverage.supplierName}`}
                                      >
                                        x
                                      </button>
                                    </span>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  className="orders-inline-link"
                                  disabled={uncoveredForItem <= 0}
                                  onClick={() => openSupplierCoverageModal(line, availableStock)}
                                >
                                  + Agregar proveedor
                                </button>
                                <small className="orders-available-note">
                                  Faltante {effectiveShortageForItem} u. · cubierto {supplierCoveredQty} u.
                                </small>
                              </div>
                            ) : null}
                            {isLastComboLine ? (
                              <div className="orders-selected-combo-group-foot">
                                Fin del combo {line.comboName || ''}
                              </div>
                            ) : null}
                          </div>
                          );
                            })}
                          </section>
                        ))
                      )}
                      </div>
                    </section>

                    {selectedServicesForActiveDay.length > 0 ? (
                      <section className="orders-services-section">
                        <div className="orders-selected-head">
                          <strong>Servicios asignados ({selectedServicesForActiveDay.length})</strong>
                          <span>{isDailyScheduleMode ? 'Servicios del dia activo.' : 'No descuentan inventario y se cobran una sola vez.'}</span>
                        </div>
                        <div className="orders-services-list">
                          {selectedServicesForActiveDay.map((service) => (
                            <article key={service.id}>
                              <BriefcaseBusiness aria-hidden="true" />
                              <span>
                                <strong>{service.name}</strong>
                                <small>{service.detail || 'Sin detalle adicional'}</small>
                              </span>
                              {isDailyScheduleMode ? (
                                <select
                                  className="orders-line-day-select"
                                  value={service.serviceDayId ?? activeScheduleDay?.id ?? ''}
                                  onChange={(event) => {
                                    const nextDay = normalizedScheduleDays.find((day) => day.id === event.target.value);
                                    setDraft((current) => ({
                                      ...current,
                                      services: (current.services ?? []).map((entry) => (
                                        entry.id === service.id
                                          ? {
                                            ...entry,
                                            serviceDayId: nextDay?.id ?? '',
                                            serviceDate: nextDay?.date ?? '',
                                            serviceDayLabel: nextDay?.label ?? '',
                                          }
                                          : entry
                                      )),
                                    }));
                                  }}
                                >
                                  {normalizedScheduleDays.map((day) => (
                                    <option key={day.id} value={day.id}>{day.label}</option>
                                  ))}
                                </select>
                              ) : null}
                              <span>{service.quantity} x {formatBs(service.unitPriceBs)}</span>
                              <strong>{formatBs(service.lineTotalBs)}</strong>
                              <div className="orders-service-actions">
                                <button
                                  type="button"
                                  className="orders-service-edit"
                                  onClick={() => openEditServiceModal(service)}
                                  aria-label={`Editar servicio ${service.name}`}
                                  title="Editar servicio"
                                >
                                  <Pencil aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="orders-service-remove"
                                  onClick={() => removeDraftService(service.id)}
                                  aria-label={`Quitar servicio ${service.name}`}
                                  title="Quitar servicio"
                                >
                                  <Trash2 aria-hidden="true" />
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    ) : null}
                  </>
                ) : null}

                {currentStep === 3 ? (
                  <>
                    <h4><span className="orders-section-icon"><Truck aria-hidden="true" /></span>Logistica de entrega y recojo</h4>
                    <p className="orders-step-help">Programa fechas, ventanas horarias y asignaciones sugeridas.</p>
                    <div className="orders-logistics-mode">
                      <button
                        type="button"
                        className={draft.logisticsMode === 'envio' ? 'active' : ''}
                        onClick={() => setDraftLogisticsMode('envio')}
                      >
                        Envio por mi equipo
                      </button>
                      <button
                        type="button"
                        className={draft.logisticsMode === 'recojo' ? 'active' : ''}
                        onClick={() => setDraftLogisticsMode('recojo')}
                      >
                        Recojo por cliente
                      </button>
                    </div>
                    {draft.logisticsMode === 'envio' ? (
                      <div className="orders-delivery-charge-panel">
                        <div className="orders-logistics-mode orders-delivery-charge-mode">
                          <button
                            type="button"
                            className={draft.deliveryChargeMode !== 'extra' ? 'active' : ''}
                            onClick={() => setDraftDeliveryChargeMode('included')}
                          >
                            {DELIVERY_CHARGE_MODE_META.included}
                          </button>
                          <button
                            type="button"
                            className={draft.deliveryChargeMode === 'extra' ? 'active' : ''}
                            onClick={() => setDraftDeliveryChargeMode('extra')}
                          >
                            {DELIVERY_CHARGE_MODE_META.extra}
                          </button>
                        </div>
                        {draft.deliveryChargeMode === 'extra' ? (
                          <div className="orders-form-grid orders-delivery-fee-grid">
                            <label>
                              Costo extra de envio (Bs) *
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={draft.deliveryFeeBs}
                                onChange={(event) => setDraftField('deliveryFeeBs', event.target.value)}
                              />
                            </label>
                            <label>
                              Motivo
                              <select
                                value={draft.deliveryFeeReason}
                                onChange={(event) => setDraftField('deliveryFeeReason', event.target.value)}
                              >
                                <option value="quantity">No cubre la cantidad alquilada</option>
                                <option value="distance">Zona alejada</option>
                                <option value="other">Otro motivo</option>
                              </select>
                            </label>
                          </div>
                        ) : (
                          <div className="orders-form-note">
                            El envio queda incluido porque el alquiler cubre el servicio logistico.
                          </div>
                        )}
                      </div>
                    ) : null}
                    <div className="orders-logistics-schedule">
                      <section className="orders-logistics-card is-delivery">
                        <header>
                          <span><Truck aria-hidden="true" /></span>
                          <div>
                            <strong>{draft.logisticsMode === 'recojo' ? 'Alistamiento para cliente' : 'Entrega al cliente'}</strong>
                            <small>{draft.logisticsMode === 'recojo' ? 'Inventario prepara la orden para retiro.' : 'El equipo entrega en la direccion del evento.'}</small>
                          </div>
                        </header>
                        <div className="orders-logistics-fields">
                          <label>
                            Fecha *
                            <input type="date" value={draft.deliveryDate} onChange={(event) => setDraftField('deliveryDate', event.target.value)} />
                          </label>
                          <label>
                            Inicio
                            <input type="time" value={draft.deliveryWindowStart} disabled={draft.deliveryTimeMode === 'coordinate'} onChange={(event) => setDraftField('deliveryWindowStart', event.target.value)} />
                          </label>
                          <label>
                            Fin
                            <input type="time" value={draft.deliveryWindowEnd} disabled={draft.deliveryTimeMode === 'coordinate'} onChange={(event) => setDraftField('deliveryWindowEnd', event.target.value)} />
                          </label>
                        </div>
                        <label className="orders-time-coordinate">
                          <input
                            type="checkbox"
                            checked={draft.deliveryTimeMode === 'coordinate'}
                            onChange={(event) => setDraftField('deliveryTimeMode', event.target.checked ? 'coordinate' : 'fixed')}
                          />
                          <span>{draft.logisticsMode === 'recojo' ? 'Coordinar horario de alistamiento con el cliente' : 'Coordinar horario de entrega con el cliente'}</span>
                        </label>
                      </section>

                      <section className="orders-logistics-card is-pickup">
                        <header>
                          <span><RefreshCw aria-hidden="true" /></span>
                          <div>
                            <strong>{draft.logisticsMode === 'recojo' ? 'Devolucion del cliente' : 'Recojo / retorno'}</strong>
                            <small>{draft.logisticsMode === 'recojo' ? 'El cliente devuelve los items al finalizar.' : 'El equipo recoge y retorna los items.'}</small>
                          </div>
                        </header>
                        <div className="orders-logistics-fields">
                          <label>
                            Fecha{draft.pickupTimeMode === 'coordinate' ? '' : ' *'}
                            <input type="date" value={draft.pickupDate} disabled={draft.pickupTimeMode === 'coordinate'} onChange={(event) => setDraftField('pickupDate', event.target.value)} />
                          </label>
                          <label>
                            Inicio
                            <input type="time" value={draft.pickupWindowStart} disabled={draft.pickupTimeMode === 'coordinate'} onChange={(event) => setDraftField('pickupWindowStart', event.target.value)} />
                          </label>
                          <label>
                            Fin
                            <input type="time" value={draft.pickupWindowEnd} disabled={draft.pickupTimeMode === 'coordinate'} onChange={(event) => setDraftField('pickupWindowEnd', event.target.value)} />
                          </label>
                        </div>
                        <label className="orders-time-coordinate">
                          <input
                            type="checkbox"
                            checked={draft.pickupTimeMode === 'coordinate'}
                            onChange={(event) => setPickupCoordinatesPending(event.target.checked)}
                          />
                          <span>{draft.logisticsMode === 'recojo' ? 'Coordinar fecha y horario de devolucion con el cliente' : 'Coordinar fecha y horario de recojo con el cliente'}</span>
                        </label>
                      </section>
                    </div>

                    {draft.logisticsMode === 'envio' ? (
                      <div className="orders-form-grid orders-transport-assignment-grid">
                        <label>
                          Chofer sugerido
                          <select value={draft.driverId} onChange={(event) => setDraftField('driverId', event.target.value)}>
                            <option value="">Asignar luego</option>
                            {drivers.map((driver) => (
                              <option key={driver.id} value={driver.id}>{driver.fullName}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Vehiculo sugerido
                          <select value={draft.vehicleId} onChange={(event) => setDraftField('vehicleId', event.target.value)}>
                            <option value="">Asignar luego</option>
                            {vehicles.map((vehicle) => (
                              <option key={vehicle.id} value={vehicle.id}>{vehicle.code} - {vehicle.name}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : (
                      <div className="orders-form-note">
                        El cliente recoge la orden. Al aprobar, se generara solo la tarea de inventario para alistar y verificar los items.
                      </div>
                    )}

                    <label>
                      Observaciones operativas
                      <textarea
                        value={draft.observations}
                        onChange={(event) => setDraftField('observations', event.target.value)}
                        placeholder="Indicaciones de montaje, acceso, contacto en sitio..."
                        rows={3}
                      />
                    </label>
                  </>
                ) : null}

                {currentStep === 4 ? (
                  <>
                    <h4><span className="orders-section-icon"><ClipboardCheck aria-hidden="true" /></span>Revision economica y cierre</h4>
                    <p className="orders-step-help">Revisa importes antes de guardar o aprobar la cotizacion.</p>
                    <div className="orders-money-grid">
                      <div className="orders-discount-control">
                        <label>
                          Tipo de descuento
                          <select
                            value={generalDiscountMode}
                            onChange={(event) => {
                              const discountMode = event.target.value === 'fixed' ? 'fixed' : 'percent';
                              setDraft((current) => ({
                                ...current,
                                discountMode,
                                discountPercent: discountMode === 'fixed' ? '0' : current.discountPercent,
                                discountBs: discountMode === 'percent' ? '0' : current.discountBs,
                              }));
                            }}
                          >
                            <option value="percent">Porcentaje (%)</option>
                            <option value="fixed">Monto fijo (Bs)</option>
                          </select>
                        </label>
                        <label>
                          {generalDiscountMode === 'fixed' ? 'Descuento (Bs)' : 'Porcentaje'}
                          {generalDiscountMode === 'fixed' ? (
                            <input
                              type="number"
                              min="0"
                              max={generalDiscountBaseBs}
                              step="0.01"
                              value={draft.discountBs}
                              onFocus={selectNumericInput}
                              onChange={(event) => setDraftField('discountBs', cleanDecimalInput(event.target.value))}
                            />
                          ) : (
                            <select
                              value={String(draft.discountPercent ?? 0)}
                              onChange={(event) => setDraftField('discountPercent', event.target.value)}
                            >
                              {[0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75].map((percent) => (
                                <option key={percent} value={percent}>{percent}%</option>
                              ))}
                            </select>
                          )}
                        </label>
                        <small className="orders-field-live-summary is-info">
                          {generalDiscountMode === 'fixed'
                            ? `Rebaja fija solo sobre items: ${formatBs(generalDiscountBs)}`
                            : `Seleccionado: ${generalDiscountPercent}% solo sobre items | Rebaja: ${formatBs(generalDiscountBs)}`}
                        </small>
                      </div>
                      <label>
                        Garantia (Bs)
                        <input type="number" min="0" step="0.01" value={draft.guaranteeBs} onChange={(event) => setDraftField('guaranteeBs', event.target.value)} />
                        <small className="orders-field-live-summary is-info">
                          Monto registrado: {formatBs(Math.max(0, Number(draft.guaranteeBs ?? 0)))}
                        </small>
                      </label>
                      <label>
                        Estado de pago garantia
                        <select value={draft.guaranteeStatus} onChange={(event) => setDraftField('guaranteeStatus', event.target.value)}>
                          <option value="no_validado">Debe</option>
                          <option value="validado">Pagado</option>
                        </select>
                        <small className={`orders-field-live-summary ${draft.guaranteeStatus === 'validado' ? 'is-ok' : 'is-warning'}`}>
                          {draft.guaranteeStatus === 'validado' ? 'Garantia cobrada y registrada en caja.' : 'Garantia pendiente de cobro.'}
                        </small>
                      </label>
                      <label>
                        Metodo garantia
                        <select value={draft.guaranteePaymentMethod} onChange={(event) => setDraftField('guaranteePaymentMethod', event.target.value)} disabled={draft.guaranteeStatus !== 'validado'}>
                          <option value="efectivo">Efectivo</option>
                          <option value="qr">QR</option>
                          <option value="transferencia">Transferencia</option>
                        </select>
                        <small className={`orders-field-live-summary ${draft.guaranteeStatus === 'validado' ? 'is-info' : 'is-muted'}`}>
                          {draft.guaranteeStatus === 'validado'
                            ? `Metodo actual: ${formatPaymentMethodLabel(draft.guaranteePaymentMethod, draft.guaranteePaymentAccount)}`
                            : 'Se activara al registrar el pago de garantia.'}
                        </small>
                      </label>
                      {draft.guaranteeStatus === 'validado' && draft.guaranteePaymentMethod === 'qr' ? (
                        <label>
                          Cuenta QR garantia
                          <select value={draft.guaranteePaymentAccount} onChange={(event) => setDraftField('guaranteePaymentAccount', event.target.value)}>
                            <option value="">Seleccionar cuenta</option>
                            {QR_ACCOUNT_OPTIONS.map((account) => (
                              <option key={account} value={account}>{account}</option>
                            ))}
                          </select>
                          <small className={`orders-field-live-summary ${draft.guaranteePaymentAccount ? 'is-ok' : 'is-warning'}`}>
                            {draft.guaranteePaymentAccount ? `Cuenta seleccionada: ${draft.guaranteePaymentAccount}` : 'Falta seleccionar cuenta QR.'}
                          </small>
                        </label>
                      ) : null}
                      <label>
                        Pago inicial (Bs)
                        <input type="number" min="0" step="0.01" value={draft.paidAtApprovalBs} onChange={(event) => setDraftField('paidAtApprovalBs', event.target.value)} />
                        <small className={`orders-field-live-summary ${paidAtApprovalBs > 0 ? 'is-ok' : 'is-muted'}`}>
                          {paidAtApprovalBs > 0 ? `Recibido: ${formatBs(paidAtApprovalBs)}` : 'Sin pago inicial registrado.'}
                        </small>
                      </label>
                      <label>
                        Metodo pago inicial
                        <select value={draft.initialPaymentMethod} onChange={(event) => setDraftField('initialPaymentMethod', event.target.value)} disabled={Math.max(0, Number(draft.paidAtApprovalBs ?? 0)) <= 0}>
                          <option value="efectivo">Efectivo</option>
                          <option value="qr">QR</option>
                          <option value="transferencia">Transferencia</option>
                        </select>
                        <small className={`orders-field-live-summary ${paidAtApprovalBs > 0 ? 'is-info' : 'is-muted'}`}>
                          {paidAtApprovalBs > 0
                            ? `Metodo actual: ${formatPaymentMethodLabel(draft.initialPaymentMethod, draft.initialPaymentAccount)}`
                            : 'Se activara al registrar pago inicial.'}
                        </small>
                      </label>
                      {Math.max(0, Number(draft.paidAtApprovalBs ?? 0)) > 0 && draft.initialPaymentMethod === 'qr' ? (
                        <label>
                          Cuenta QR pago inicial
                          <select value={draft.initialPaymentAccount} onChange={(event) => setDraftField('initialPaymentAccount', event.target.value)}>
                            <option value="">Seleccionar cuenta</option>
                            {QR_ACCOUNT_OPTIONS.map((account) => (
                              <option key={account} value={account}>{account}</option>
                            ))}
                          </select>
                          <small className={`orders-field-live-summary ${draft.initialPaymentAccount ? 'is-ok' : 'is-warning'}`}>
                            {draft.initialPaymentAccount ? `Cuenta seleccionada: ${draft.initialPaymentAccount}` : 'Falta seleccionar cuenta QR.'}
                          </small>
                        </label>
                      ) : null}
                    </div>

                    <div className="orders-money-summary orders-money-summary-pro">
                      <div className="orders-money-row">
                        <span>Facturacion</span>
                        <strong>{BILLING_MODE_META[draft.billingMode] ?? 'Sin factura'}</strong>
                      </div>
                      <div className="orders-money-row">
                        <span>Logistica</span>
                        <strong>{LOGISTICS_MODE_META[draft.logisticsMode] ?? 'Envio por equipo'}</strong>
                      </div>
                      {selectedClientForDraft?.prepaidEnabled ? (
                        <div className="orders-money-row">
                          <span>Saldo prepago cliente</span>
                          <strong>{formatBs(selectedClientPrepaidBalanceBs)}</strong>
                        </div>
                      ) : null}
                      {durationPricing.mode === 'duration' ? (
                        <div className="orders-duration-breakdown">
                          <header>
                            <strong>Cobro por dia</strong>
                            <span>{durationPricing.days} dias</span>
                          </header>
                          {durationTierSummaryRows.map((row) => (
                            <div key={row.label} className="orders-duration-breakdown-row">
                              <span>{row.label}</span>
                              <small>{row.days} dia{row.days > 1 ? 's' : ''} x {row.percent}% = {formatBs(row.amountPerDayBs)} c/dia</small>
                              <strong>{formatBs(row.totalBs)}</strong>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {durationPricing.mode === 'daily_schedule' && scheduleDayTotals.length > 1 ? (
                        <div className="orders-duration-breakdown orders-daily-subtotal-breakdown">
                          <header>
                            <strong>Subtotal por dia</strong>
                            <span>{scheduleDayTotals.length} dias</span>
                          </header>
                          {scheduleDayTotals.map((day) => (
                            <div key={day.id} className="orders-duration-breakdown-row">
                              <span>{day.label}</span>
                              <small>{formatDate(day.date)} | {day.itemCount} linea{day.itemCount === 1 ? '' : 's'}</small>
                              <strong>{formatBs(day.totalBs)}</strong>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="orders-money-divider" />
                      <div className="orders-money-row">
                        <span>Items</span>
                        <strong>{formatBs(grossItemsSubtotalBs)}</strong>
                      </div>
                      {itemDiscountsBs > 0 ? (
                        <div className="orders-money-row muted">
                          <span>Descuento items</span>
                          <strong>- {formatBs(itemDiscountsBs)}</strong>
                        </div>
                      ) : null}
                      <div className="orders-money-row muted">
                        <span>Subtotal items</span>
                        <strong>{formatBs(baseItemsSubtotalBs)}</strong>
                      </div>
                      {servicesSubtotalBs > 0 ? (
                        <div className="orders-money-row muted">
                          <span>Servicios</span>
                          <strong>{formatBs(servicesSubtotalBs)}</strong>
                        </div>
                      ) : null}
                      <div className="orders-money-row">
                        <span>Subtotal</span>
                        <strong>{formatBs(quoteSubtotalBs)}</strong>
                      </div>
                      {durationPricing.mode === 'duration' ? (
                        <div className="orders-money-row muted">
                          <span>Promocion por duracion</span>
                          <strong>{formatBs(durationPricing.durationDiscountBs)}</strong>
                        </div>
                      ) : null}
                      <div className="orders-money-row muted">
                        <span>Descuento items ({generalDiscountPercent}%)</span>
                        <strong>{formatBs(generalDiscountBs)}</strong>
                      </div>
                      <div className="orders-money-row muted">
                        <span>Garantia</span>
                        <strong>{formatBs(Math.max(0, Number(draft.guaranteeBs ?? 0)))}</strong>
                      </div>
                      {draft.logisticsMode === 'envio' ? (
                        <div className="orders-money-row muted">
                          <span>Envio por equipo</span>
                          <strong>{quoteDeliveryFeeBs > 0 ? formatBs(quoteDeliveryFeeBs) : 'Incluido'}</strong>
                        </div>
                      ) : null}
                      {quoteDeliveryFeeBs > 0 ? (
                        <div className="orders-money-row muted">
                          <span>Motivo envio</span>
                          <strong>{DELIVERY_FEE_REASON_META[draft.deliveryFeeReason] ?? 'Otro motivo'}</strong>
                        </div>
                      ) : null}
                      <div className="orders-money-row total">
                        <span>{draft.entityType === 'contract' ? 'Total contrato' : 'Total cotizacion'}</span>
                        <strong>{formatBs(quoteTotalBs)}</strong>
                      </div>
                      <div className="orders-money-row">
                        <span>Saldo pendiente</span>
                        <strong>{formatBs(pendingAtApprovalBs)}</strong>
                      </div>
                      {selectedClientForDraft?.prepaidEnabled ? (
                        <>
                          <div className="orders-money-row muted">
                            <span>Se descontaria de prepago</span>
                            <strong>{formatBs(selectedClientPrepaidCoverageBs)}</strong>
                          </div>
                          <div className="orders-money-row muted">
                            <span>Saldo por cobrar tras prepago</span>
                            <strong>{formatBs(selectedClientPrepaidPendingBs)}</strong>
                          </div>
                        </>
                      ) : null}
                    </div>

                    {supplierCoverageTotals.lines > 0 ? (
                      <div className="orders-form-note">
                        Cobertura proveedor: {supplierCoverageTotals.totalCoveredQty} u. en {supplierCoverageTotals.lines} linea(s)
                        · costo {formatBs(supplierCoverageTotals.totalCostBs)}
                        · venta {formatBs(supplierCoverageTotals.totalSaleBs)}
                        · margen {formatBs(supplierCoverageTotals.totalMarginBs)}.
                      </div>
                    ) : null}

                    <div className="orders-form-note orders-form-note-warn">
                      {draft.entityType === 'contract'
                        ? draft.logisticsMode === 'recojo'
                          ? 'Al aprobar este contrato se genera solo la orden de inventario para alistamiento.'
                          : 'Al aprobar este contrato se genera la orden para inventario y la hoja de ruta para transporte.'
                        : 'Al convertir la cotizacion se genera un contrato para aprobacion comercial.'}
                    </div>
                  </>
                ) : null}
              </section>

              <aside className="orders-catalog-panel orders-wizard-side">
                <header className="orders-summary-head">
                  <h4>{draft.entityType === 'contract' ? 'Resumen de contrato' : 'Resumen de cotizacion'}</h4>
                  <div className="orders-summary-actions">
                    <span className="orders-status-badge quote-draft">Borrador</span>
                    <button
                      type="button"
                      className="orders-summary-toggle"
                      onClick={() => setIsWizardSummaryCollapsed((current) => !current)}
                      aria-expanded={!isWizardSummaryCollapsed}
                      title={isWizardSummaryCollapsed ? 'Mostrar resumen' : 'Contraer resumen'}
                    >
                      <ChevronRight aria-hidden="true" />
                    </button>
                  </div>
                </header>

                <div className="orders-side-context">
                  <article>
                    <UserRound className="orders-side-context-icon" aria-hidden="true" />
                    <span>Cliente</span>
                    <strong>{sideSummaryClient}</strong>
                    <small>{sideSummaryClientMeta}</small>
                  </article>
                  <article>
                    <CalendarDays className="orders-side-context-icon" aria-hidden="true" />
                    <span>Evento</span>
                    <strong>{sideSummaryEvent}</strong>
                    <small>{sideSummaryEventMeta}</small>
                  </article>
                  <article className="wide">
                    <MapPin className="orders-side-context-icon" aria-hidden="true" />
                    <span>Direccion</span>
                    <strong>{sideSummaryAddress}</strong>
                  </article>
                </div>

                <section className="orders-summary-items-card">
                  <h5>{draft.entityType === 'contract' ? 'Items del contrato' : 'Items de la cotizacion'}</h5>
                  <div className="orders-selected-list compact orders-summary-items">
                    {selectedItems.length === 0 && selectedServices.length === 0 ? (
                      <div className="orders-summary-empty">
                        <PackageOpen aria-hidden="true" />
                        <strong>Aun no hay items ni servicios.</strong>
                        <small>Agrega productos o servicios en el paso de Items.</small>
                      </div>
                    ) : (
                      <>
                        {selectedItems.slice(0, 6).map((line) => {
                          const detailParts = getOperationalItemDetails(line);
                          const shortageLine = uncoveredStockIssues.find((issue) => issue.itemId === line.itemId);
                          const isCourtesyLine = line.lineType === 'courtesy';
                          return (
                            <div key={line.lineKey} className={`orders-side-line${shortageLine ? ' has-shortage' : ''}`}>
                              <span>
                                {line.quantity}x {line.item.name} - {isCourtesyLine ? 'Cortesía' : `${formatBs(line.unitPriceBs)} c/u`}
                                {detailParts.length > 0 ? (
                                  <small className="orders-side-line-details">
                                    {detailParts.map((part) => `${part.label}: ${part.value}`).join(' | ')}
                                  </small>
                                ) : null}
                                {Number(line.lineDiscountBs ?? line.discountBs ?? 0) > 0 ? (
                                  <small className="orders-side-line-details">
                                    Descuento item: - {formatBs(Number(line.lineDiscountBs ?? line.discountBs ?? 0))}
                                  </small>
                                ) : null}
                                {shortageLine ? (
                                  <small className="orders-side-line-shortage">
                                    Falta proveedor para {shortageLine.uncoveredQty} u.
                                  </small>
                                ) : null}
                              </span>
                              <strong>{formatBs(getDisplayedItemSubtotalBs(line))}</strong>
                            </div>
                          );
                        })}
                        {selectedServices.slice(0, Math.max(0, 6 - selectedItems.length)).map((service) => (
                          <div key={service.id} className="orders-side-line is-service">
                            <span>
                              {service.quantity}x {service.name}
                              <small className="orders-side-line-details">{service.detail || 'Servicio adicional'}</small>
                            </span>
                            <strong>{formatBs(service.lineTotalBs)}</strong>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </section>

                {stockIssues.length > 0 ? (
                  <div className={`orders-form-note ${uncoveredStockIssues.length > 0 ? 'orders-form-note-warn orders-shortage-side-note' : ''}`}>
                    {uncoveredStockIssues.length > 0 ? (
                      <>
                        <strong>Falta proveedor</strong>
                        {uncoveredStockIssues.slice(0, 3).map((issue) => (
                          <span key={issue.lineKey ?? issue.itemId}>
                            {issue.itemName}: {issue.uncoveredQty} u. sin cubrir
                          </span>
                        ))}
                      </>
                    ) : (
                      `Faltantes cubiertos por proveedor (${supplierCoverageTotals.totalCoveredQty} u.).`
                    )}
                  </div>
                ) : null}

                <div className="orders-money-summary orders-money-summary-pro">
                  <div className="orders-money-row">
                    <span>Facturacion</span>
                    <strong>{BILLING_MODE_META[draft.billingMode] ?? 'Sin factura'}</strong>
                  </div>
                  <div className="orders-money-row">
                    <span>Logistica</span>
                    <strong>{LOGISTICS_MODE_META[draft.logisticsMode] ?? 'Envio por equipo'}</strong>
                  </div>
                  {selectedClientForDraft?.prepaidEnabled ? (
                    <div className="orders-money-row">
                      <span>Saldo prepago cliente</span>
                      <strong>{formatBs(selectedClientPrepaidBalanceBs)}</strong>
                    </div>
                  ) : null}
                  {durationPricing.mode === 'duration' ? (
                    <div className="orders-duration-breakdown">
                      <header>
                        <strong>Cobro por dia</strong>
                        <span>{durationPricing.days} dias</span>
                      </header>
                      {durationTierSummaryRows.map((row) => (
                        <div key={row.label} className="orders-duration-breakdown-row">
                          <span>{row.label}</span>
                          <small>{row.days} dia{row.days > 1 ? 's' : ''} x {row.percent}% = {formatBs(row.amountPerDayBs)} c/dia</small>
                          <strong>{formatBs(row.totalBs)}</strong>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {durationPricing.mode === 'daily_schedule' && scheduleDayTotals.length > 1 ? (
                    <div className="orders-duration-breakdown orders-daily-subtotal-breakdown">
                      <header>
                        <strong>Subtotal por dia</strong>
                        <span>{scheduleDayTotals.length} dias</span>
                      </header>
                      {scheduleDayTotals.map((day) => (
                        <div key={day.id} className="orders-duration-breakdown-row">
                          <span>{day.label}</span>
                          <small>{formatDate(day.date)} | {day.itemCount} linea{day.itemCount === 1 ? '' : 's'}</small>
                          <strong>{formatBs(day.totalBs)}</strong>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="orders-money-divider" />
                  <div className="orders-money-row">
                    <span>Items</span>
                    <strong>{formatBs(grossItemsSubtotalBs)}</strong>
                  </div>
                  {itemDiscountsBs > 0 ? (
                    <div className="orders-money-row muted">
                      <span>Descuento items</span>
                      <strong>- {formatBs(itemDiscountsBs)}</strong>
                    </div>
                  ) : null}
                  <div className="orders-money-row muted">
                    <span>Subtotal items</span>
                    <strong>{formatBs(baseItemsSubtotalBs)}</strong>
                  </div>
                  {servicesSubtotalBs > 0 ? (
                    <div className="orders-money-row muted">
                      <span>Servicios</span>
                      <strong>{formatBs(servicesSubtotalBs)}</strong>
                    </div>
                  ) : null}
                  <div className="orders-money-row">
                    <span>Subtotal</span>
                    <strong>{formatBs(quoteSubtotalBs)}</strong>
                  </div>
                  {durationPricing.mode === 'duration' ? (
                    <div className="orders-money-row muted">
                      <span>Promocion por duracion</span>
                      <strong>{formatBs(durationPricing.durationDiscountBs)}</strong>
                    </div>
                  ) : null}
                  <div className="orders-money-row muted">
                    <span>Descuento items ({generalDiscountPercent}%)</span>
                    <strong>{formatBs(generalDiscountBs)}</strong>
                  </div>
                  <div className="orders-money-row muted">
                    <span>Garantia</span>
                    <strong>
                      {formatBs(Math.max(0, Number(draft.guaranteeBs ?? 0)))}
                      {Math.max(0, Number(draft.guaranteeBs ?? 0)) > 0 ? ` | ${draft.guaranteeStatus === 'validado' ? 'Pagada' : 'Debe'}` : ''}
                    </strong>
                  </div>
                  {draft.guaranteeStatus === 'validado' && Math.max(0, Number(draft.guaranteeBs ?? 0)) > 0 ? (
                    <div className="orders-money-row muted">
                      <span>Metodo garantia</span>
                      <strong>{formatPaymentMethodLabel(draft.guaranteePaymentMethod, draft.guaranteePaymentAccount)}</strong>
                    </div>
                  ) : null}
                  <div className="orders-money-row muted">
                    <span>Pago inicial</span>
                    <strong>{formatBs(Math.max(0, Number(draft.paidAtApprovalBs ?? 0)))}</strong>
                  </div>
                  {Math.max(0, Number(draft.paidAtApprovalBs ?? 0)) > 0 ? (
                    <div className="orders-money-row muted">
                      <span>Metodo pago inicial</span>
                      <strong>{formatPaymentMethodLabel(draft.initialPaymentMethod, draft.initialPaymentAccount)}</strong>
                    </div>
                  ) : null}
                  {overpaidAtApprovalBs > 0 ? (
                    <div className="orders-money-row muted">
                      <span>Saldo a favor</span>
                      <strong>{formatBs(overpaidAtApprovalBs)}</strong>
                    </div>
                  ) : null}
                  {draft.logisticsMode === 'envio' ? (
                    <div className="orders-money-row muted">
                      <span>Envio por equipo</span>
                      <strong>{quoteDeliveryFeeBs > 0 ? formatBs(quoteDeliveryFeeBs) : 'Incluido'}</strong>
                    </div>
                  ) : null}
                  {quoteDeliveryFeeBs > 0 ? (
                    <div className="orders-money-row muted">
                      <span>Motivo envio</span>
                      <strong>{DELIVERY_FEE_REASON_META[draft.deliveryFeeReason] ?? 'Otro motivo'}</strong>
                    </div>
                  ) : null}
                  <div className="orders-money-row total">
                    <span>Total estimado</span>
                    <strong>{formatBs(quoteTotalBs)}</strong>
                  </div>
                  {selectedClientForDraft?.prepaidEnabled ? (
                    <>
                      <div className="orders-money-row muted">
                        <span>Se descontaria de prepago</span>
                        <strong>{formatBs(selectedClientPrepaidCoverageBs)}</strong>
                      </div>
                      <div className="orders-money-row muted">
                        <span>Saldo por cobrar tras prepago</span>
                        <strong>{formatBs(selectedClientPrepaidPendingBs)}</strong>
                      </div>
                    </>
                  ) : null}
                </div>
              </aside>
            </div>

            {formError ? <p className="status error orders-modal-error">{formError}</p> : null}

            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={closeModal} disabled={isSubmitting}>
                Cancelar
              </button>

              <div className="orders-modal-foot-right">
                {isSubmitting && submitStatusMessage ? (
                  <span className="orders-submit-progress" role="status" aria-live="polite">
                    {submitStatusMessage}
                  </span>
                ) : null}
                <button type="button" className="ghost-button" onClick={handlePrevStep} disabled={isSubmitting || currentStep === 0}>
                  Anterior
                </button>

                {!isLastStep ? (
                  <button type="button" className="primary-button" onClick={handleNextStep} disabled={isSubmitting}>
                    Continuar <ChevronRight aria-hidden="true" />
                  </button>
                ) : draft.entityType !== 'contract' ? (
                  <button type="button" className="primary-button" onClick={() => handleSaveQuote({ approveNow: false })} disabled={isSubmitting}>
                    {isSubmitting ? 'Guardando...' : 'Guardar cotizacion'}
                  </button>
                ) : isEditingContract ? (
                  <button type="button" className="primary-button" onClick={() => handleSaveQuote({ approveNow: false })} disabled={isSubmitting}>
                    {isSubmitting ? 'Guardando...' : 'Guardar contrato'}
                  </button>
                ) : (
                  <>
                    <button type="button" className="ghost-button" onClick={() => handleSaveQuote({ approveNow: false })} disabled={isSubmitting}>
                      {isSubmitting
                        ? 'Guardando...'
                        : draft.entityType === 'contract'
                        ? 'Guardar contrato'
                        : 'Guardar cotizacion'}
                    </button>
                    <button type="button" className="primary-button" onClick={() => handleSaveQuote({ approveNow: true })} disabled={isSubmitting}>
                      {isSubmitting
                        ? 'Aprobando...'
                        : draft.entityType === 'contract'
                        ? 'Guardar y aprobar'
                        : 'Guardar y generar contrato'}
                    </button>
                  </>
                )}
              </div>
            </footer>
          </div>
        </div>
      ) : null}

      {zeroInitialPaymentConfirmation ? (
        <div
          className="orders-modal-backdrop"
          onClick={() => {
            if (!isSubmitting) setZeroInitialPaymentConfirmation(null);
          }}
        >
          <div className="orders-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <span className="orders-confirm-icon">!</span>
              <div>
                <h3>Confirmar pago inicial en cero</h3>
                <p>
                  Este contrato tenía un pago inicial registrado. Al confirmar, el pago quedará realmente
                  en cero y se anulará el registro automático vinculado.
                </p>
              </div>
            </header>

            <div className="orders-confirm-summary">
              <strong>
                {zeroInitialPaymentConfirmation.customerName || 'Cliente'}
                {zeroInitialPaymentConfirmation.contractCode
                  ? ` · ${zeroInitialPaymentConfirmation.contractCode}`
                  : ''}
              </strong>
              <span>
                Monto anterior: {formatBs(zeroInitialPaymentConfirmation.previousAmountBs)}
              </span>
              <small>Nuevo monto confirmado: {formatBs(0)}</small>
            </div>

            <footer>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setZeroInitialPaymentConfirmation(null)}
                disabled={isSubmitting}
              >
                No, conservar monto
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  const approveNow = Boolean(zeroInitialPaymentConfirmation.approveNow);
                  setZeroInitialPaymentConfirmation(null);
                  handleSaveQuote({
                    approveNow,
                    zeroInitialPaymentConfirmed: true,
                  });
                }}
                disabled={isSubmitting}
              >
                Sí, cambiar a cero
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {supplierPlanRemovalConfirmation ? (
        <div
          className="orders-modal-backdrop"
          onClick={() => {
            if (!isSubmitting) setSupplierPlanRemovalConfirmation(null);
          }}
        >
          <div className="orders-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <span className="orders-confirm-icon">!</span>
              <div>
                <h3>Guardar sin proveedores asignados</h3>
                <p>
                  Corregiste las fechas y quitaste coberturas de proveedor. ¿Estás seguro de guardar
                  este contrato usando ahora el inventario propio disponible?
                </p>
              </div>
            </header>

            <div className="orders-confirm-summary">
              <strong>
                {supplierPlanRemovalConfirmation.customerName || 'Cliente'}
                {supplierPlanRemovalConfirmation.contractCode
                  ? ` · ${supplierPlanRemovalConfirmation.contractCode}`
                  : ''}
              </strong>
              <span>Se quitarán estas coberturas:</span>
              <ul className="orders-confirm-list">
                {supplierPlanRemovalConfirmation.removedLines.map((line, index) => (
                  <li key={`${line.supplierName}-${line.itemName}-${index}`}>
                    <b>{line.supplierName}</b>
                    {' · '}{line.itemName}{line.quantity > 0 ? ` (${line.quantity} u.)` : ''}
                  </li>
                ))}
              </ul>
              <small>El sistema volverá a validar que exista inventario suficiente para las fechas corregidas.</small>
            </div>

            <footer>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setSupplierPlanRemovalConfirmation(null)}
                disabled={isSubmitting}
              >
                No, revisar proveedores
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  const confirmation = supplierPlanRemovalConfirmation;
                  setSupplierPlanRemovalConfirmation(null);
                  handleSaveQuote({
                    approveNow: Boolean(confirmation.approveNow),
                    zeroInitialPaymentConfirmed: Boolean(confirmation.zeroInitialPaymentConfirmed),
                    supplierPlanRemovalConfirmed: true,
                  });
                }}
                disabled={isSubmitting}
              >
                Sí, guardar sin esos proveedores
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {numberingEditorOpen ? (
        <div className="orders-modal-backdrop" onClick={() => setNumberingEditorOpen(false)}>
          <section className="orders-modal orders-numbering-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>Numeracion de contratos</h3>
                <p>Ajusta el correlativo automatico que se usara al crear contratos o aprobar cotizaciones.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setNumberingEditorOpen(false)}>
                x
              </button>
            </header>

            <div className="orders-numbering-form">
              <div className="orders-numbering-preview" aria-label="Vista previa de numeracion">
                <span>Numeracion</span>
                <strong>
                  <small>Actual</small>
                  {numberingDraft.currentCode || '-'}
                </strong>
                <strong>
                  <small>Siguiente</small>
                  {numberingDraft.followingCode || '-'}
                </strong>
              </div>

              <div className="orders-numbering-fields">
                <label>
                  Codigo actual
                  <input
                    value={numberingDraft.currentCode}
                    onChange={(event) => {
                      const currentCode = event.target.value;
                      const currentNumber = parseCommercialCodeNumericPart(currentCode);
                      const currentPrefix = parseCommercialCodePrefix(currentCode);
                      setNumberingDraft({
                        currentCode,
                        followingCode: currentNumber ? formatCommercialDocumentCode(currentPrefix, currentNumber + 1) : numberingDraft.followingCode,
                      });
                      setNumberingError('');
                    }}
                    placeholder="Ej: 1573"
                  />
                </label>
                <label>
                  Codigo siguiente
                  <input
                    value={numberingDraft.followingCode}
                    onChange={(event) => {
                      setNumberingDraft((current) => ({ ...current, followingCode: event.target.value }));
                      setNumberingError('');
                    }}
                    placeholder="Ej: 1574"
                  />
                </label>
              </div>
              <p className="orders-numbering-help">El codigo actual sera el proximo contrato automatico. El siguiente debe ser el correlativo inmediato.</p>
              {numberingError ? <p className="status error">{numberingError}</p> : null}
            </div>

            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setNumberingEditorOpen(false)} disabled={isSavingNumbering}>
                Cancelar
              </button>
              <button type="button" className="primary-button" onClick={saveContractNumbering} disabled={isSavingNumbering}>
                {isSavingNumbering ? 'Guardando...' : 'Guardar numeracion'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export default ServiceOrdersSection;
