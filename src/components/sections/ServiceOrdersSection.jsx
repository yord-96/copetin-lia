import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Info,
  MapPin,
  MessageCircle,
  PackageOpen,
  Phone,
  Search,
  RefreshCw,
  Truck,
  UserRound,
  UsersRound,
  Trash2,
  X,
} from 'lucide-react';
import { buildAvailabilityPeriod, getProjectedInventoryAvailability } from '../../utils/availability';
import { getUserDisplayRole, isDeveloper } from '../../utils/permissions';
import { getProductImageSrc } from '../../utils/productImage';
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
const QR_ACCOUNT_OPTIONS = ['CIDRE', 'BCP', 'MERCANTIL', 'BNB', 'BANCO FIE'];

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
  return record?.createdByName ?? record?.userName ?? record?.createdBy ?? 'Sistema';
};

const getResponsibleDisplayRole = (record) => {
  const responsibles = Array.isArray(record?.responsibles) ? record.responsibles.filter((entry) => entry?.role) : [];
  if (responsibles.length > 1) return 'Responsables multiples';
  if (responsibles.length === 1) return responsibles[0].role;
  return record?.createdByRole ?? record?.userRole ?? 'Operacion';
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

const toOrderStatus = (rental, delivery) => {
  if (rental.status === 'cancelled') {
    return 'cancelled';
  }
  if (rental.status === 'returned') {
    if (rental.accountingStatus === 'cobrado_finalizado' || rental?.payment?.status === 'cobrado_finalizado') {
      return 'charged';
    }
    const pendingCollectionBs = Number(
      rental?.returnSettlement?.pendingCollectionBs
      ?? rental?.payment?.pendingPaymentBs
      ?? 0,
    );
    if (pendingCollectionBs > 0) return 'closed_pending';
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

const getDateKey = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const directDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directDate) return directDate[1];

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return getInputDate(parsed);
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
  const safeMode = mode === 'duration' ? 'duration' : 'simple';
  const normalizedTiers = normalizeDurationTiers(tiers);
  const safeDays = safeMode === 'duration' ? parsePositiveInteger(days, 1) : 1;

  if (safeMode !== 'duration') {
    return {
      mode: 'simple',
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

const buildQuoteApprovalDocumentHtml = ({ quote, formatDate, formatBs }) => {
  const pricingPlan = quote?.pricingPlan ?? {};
  const durationPricing = calculateDurationPricing({
    mode: pricingPlan.mode,
    days: pricingPlan.days,
    tiers: pricingPlan.tiers,
    baseSubtotalBs: quote?.totals?.baseSubtotalBs ?? pricingPlan.baseSubtotalBs ?? 0,
  });
  const hasDuration = durationPricing.mode === 'duration';
  const deliveryFeeBs = Number(quote?.totals?.deliveryFeeBs ?? quote?.deliveryFeeBs ?? 0);
  const itemRows = (quote?.items ?? []).map((line) => `
    <tr>
      <td>${escapeDocText(line.itemName)}</td>
      <td>${Number(line.quantity ?? 0)}</td>
      <td>${formatBs(Number(line.unitPriceBs ?? 0))}</td>
      <td>${formatBs(Number(line.lineTotalBs ?? 0))}</td>
    </tr>
  `).join('');
  const serviceRows = (quote?.services ?? []).map((service) => `
    <tr>
      <td>SERVICIO: ${escapeDocText(service.name)}${service.detail ? `<br /><small>${escapeDocText(service.detail)}</small>` : ''}</td>
      <td>${Number(service.quantity ?? 0)}</td>
      <td>${formatBs(Number(service.unitPriceBs ?? 0))}</td>
      <td>${formatBs(Number(service.lineTotalBs ?? Number(service.quantity ?? 0) * Number(service.unitPriceBs ?? 0)))}</td>
    </tr>
  `).join('');
  const rows = `${itemRows}${serviceRows}`;
  const subtotalBs = Number(quote?.totals?.subtotalBs ?? 0);
  const discountBs = Number(quote?.totals?.discountBs ?? 0);
  const guaranteeBs = Number(quote?.totals?.guaranteeBs ?? 0);
  const totalBs = Number(quote?.totals?.totalBs ?? 0);
  const totalWithGuaranteeBs = totalBs + guaranteeBs;
  const durationRows = hasDuration
    ? durationPricing.breakdown.map((day) => `
      <tr>
        <td>Dia ${day.day}</td>
        <td>${day.percent}%</td>
        <td>${formatBs(durationPricing.baseSubtotalBs)}</td>
        <td>${formatBs(day.amountBs)}</td>
      </tr>
    `).join('')
    : '';

  const documentCode = quote?.quoteCode ?? quote?.id ?? '';
  const documentTitle = buildDocumentFileBase(quote?.customerName, documentCode, 'cotizacion');

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeDocText(documentTitle)}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; padding: 32px; color: #1f1f1f; font-family: Inter, Arial, sans-serif; background: #faf7f3; }
          .page { max-width: 860px; margin: 0 auto; background: #fff; border: 1px solid #eaded4; border-radius: 18px; padding: 30px; }
          header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #e65a00; padding-bottom: 18px; margin-bottom: 22px; }
          h1 { margin: 0; font-size: 30px; color: #b84300; }
          h2 { margin: 26px 0 10px; font-size: 16px; color: #1f1f1f; }
          p { margin: 4px 0; color: #5f5047; }
          .code { text-align: right; color: #6b7280; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 24px; padding: 14px; border: 1px solid #eaded4; border-radius: 12px; background: #fffaf5; }
          .grid strong { display: block; color: #3c2f28; font-size: 12px; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; }
          th { text-align: left; background: #fff3e8; color: #7a3a13; font-size: 12px; text-transform: uppercase; }
          th, td { border-bottom: 1px solid #eaded4; padding: 10px; font-size: 13px; }
          td:nth-child(n+2), th:nth-child(n+2) { text-align: right; }
          .totals { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-top: 18px; width: 100%; }
          .line { min-height: 70px; display: flex; flex-direction: column; justify-content: center; gap: 6px; border: 1px solid #eaded4; border-radius: 12px; padding: 10px; color: #5f5047; background: #fffdfb; text-align: center; }
          .line span { font-size: 11px; font-weight: 800; text-transform: uppercase; }
          .line strong { color: #3c2f28; font-size: 15px; white-space: nowrap; }
          .line.total { color: #1f1f1f; background: #fff7ef; border-color: #efc7a5; }
          .line.managed { color: #1f1f1f; background: #f5fff8; border-color: #adddc0; }
          .line.managed strong { color: #087a36; }
          @media print {
            body { padding: 18px; }
            .page { max-width: none; border-radius: 12px; padding: 24px; }
            .totals { grid-template-columns: repeat(5, minmax(0, 1fr)); }
          }
        </style>
      </head>
      <body>
        <main class="page">
          <header>
            <div>
              <h1>Cotizacion de servicio</h1>
              <p>Documento previo para revision y aprobacion comercial.</p>
            </div>
            <div class="code">
              <strong>${escapeDocText(documentCode)}</strong>
              <p>${formatDate(quote?.createdAt)}</p>
            </div>
          </header>

          <section class="grid">
            <div><strong>Cliente</strong>${escapeDocText(quote?.customerName)}</div>
            <div><strong>WhatsApp / Celular</strong>${escapeDocText(quote?.customerPhone)}</div>
            <div><strong>Evento</strong>${escapeDocText(quote?.eventType)} - ${formatDate(quote?.eventDate)} ${escapeDocText(quote?.eventTime)}</div>
            <div><strong>Direccion</strong>${escapeDocText(quote?.address)} ${escapeDocText(quote?.city)}</div>
            <div><strong>Facturacion</strong>${escapeDocText(BILLING_MODE_META[quote?.billingMode] ?? 'Sin factura')}</div>
            <div><strong>Logistica</strong>${escapeDocText(LOGISTICS_MODE_META[quote?.logisticsMode] ?? 'Envio por equipo')}</div>
          </section>

          <h2>Items cotizados</h2>
          <table>
            <thead><tr><th>Item</th><th>Cantidad</th><th>Precio unit.</th><th>Subtotal</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">Sin items registrados.</td></tr>'}</tbody>
          </table>

          ${hasDuration ? `
            <h2>Cobro por duracion</h2>
            <table>
              <thead><tr><th>Dia</th><th>% cobro</th><th>Base</th><th>Monto</th></tr></thead>
              <tbody>${durationRows}</tbody>
            </table>
          ` : ''}

          <section class="totals">
            <div class="line"><span>Subtotal</span><strong>${formatBs(subtotalBs)}</strong></div>
            ${hasDuration ? `<div class="line"><span>Promocion duracion</span><strong>${formatBs(Number(quote?.totals?.durationDiscountBs ?? 0))}</strong></div>` : ''}
            <div class="line"><span>Descuento</span><strong>${formatBs(discountBs)}</strong></div>
            <div class="line"><span>Garantia</span><strong>${formatBs(guaranteeBs)}</strong></div>
            ${quote?.logisticsMode === 'envio' ? `<div class="line"><span>Envio por equipo</span><strong>${deliveryFeeBs > 0 ? formatBs(deliveryFeeBs) : 'Incluido'}</strong></div>` : ''}
            <div class="line total"><span>Total</span><strong>${formatBs(totalBs)}</strong></div>
            <div class="line managed"><span>Total + garantia</span><strong>${formatBs(totalWithGuaranteeBs)}</strong></div>
          </section>
        </main>
      </body>
    </html>`;
};

const buildSupplierInternalDocumentHtml = ({ order, contract, formatDate, formatBs }) => {
  const plan = Array.isArray(contract?.supplierFulfillmentPlan)
    ? contract.supplierFulfillmentPlan
    : Array.isArray(order?.supplierFulfillmentPlan)
      ? order.supplierFulfillmentPlan
      : [];
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

  return {
    mode,
    entityType: 'quote',
    recordId: '',
    quoteId: '',
    recordStatus: 'borrador',
    documentCodeMode: 'auto',
    manualDocumentCode: '',
    contractDate: deliveryDate,
    clientId: '',
    customerName: '',
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
    discountBs: '0',
    discountPercent: '0',
    guaranteeBs: '0',
    guaranteeStatus: 'no_validado',
    guaranteePaymentMethod: 'efectivo',
    guaranteePaymentAccount: '',
    paidAtApprovalBs: '0',
    initialPaymentMethod: 'efectivo',
    initialPaymentAccount: '',
    pricingMode: 'simple',
    pricingDays: '1',
    pricingTiers: DURATION_PRICING_DEFAULT_TIERS,
    validUntil: pickupDate,
    observations: '',
    responsibleIds: [],
    items: [],
    services: [],
    supplierFulfillmentPlan: [],
  };
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

function ServiceOrdersSection({
  quotes = [],
  contracts = [],
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
  onApproveQuote,
  onUpdateOrderOperational,
  onCancelOrderContract,
  onCreateContract,
  onUpdateContract,
  onRemoveContract,
  onRevertContractToQuote,
  onCreateContractFromOrder,
  onApproveContract,
  onGenerateOrderDocuments,
  onCreateSupplier,
  onCreateSupplierQuote,
  onUpdateSettings,
  onOpenTransportModule,
  onOpenInventoryModule,
  onOpenReportsModule,
  onOpenImage,
  onPrintContractDocument,
  onPrintInventoryWeekDocument,
  onPrintRouteSheetDocument,
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
  const [contractDateFrom, setContractDateFrom] = useState(DEFAULT_CONTRACT_WEEK_RANGE.from);
  const [contractDateTo, setContractDateTo] = useState(DEFAULT_CONTRACT_WEEK_RANGE.to);
  const [seenCounts, setSeenCounts] = useState(readSeenCounts);

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(buildEmptyDraft('quote'));
  const [quickItemDraft, setQuickItemDraft] = useState(buildEmptyQuickItemDraft);
  const [isQuickItemOpen, setIsQuickItemOpen] = useState(false);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [serviceDraft, setServiceDraft] = useState(buildEmptyServiceDraft);
  const [itemSearch, setItemSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('all');
  const [catalogVisibleCount, setCatalogVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [isWizardSummaryCollapsed, setIsWizardSummaryCollapsed] = useState(false);
  const [comboConfigurator, setComboConfigurator] = useState(null);
  const [formError, setFormError] = useState('');
  const [actionFeedback, setActionFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [documentsOrder, setDocumentsOrder] = useState(null);
  const [quoteToDelete, setQuoteToDelete] = useState(null);
  const [contractToRevert, setContractToRevert] = useState(null);
  const [orderToCancel, setOrderToCancel] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [operationalOrder, setOperationalOrder] = useState(null);
  const [operationalDraft, setOperationalDraft] = useState({ inventoryNote: '', transportNote: '' });
  const [documentPreview, setDocumentPreview] = useState(null);
  const [quoteApprovalPreview, setQuoteApprovalPreview] = useState(null);
  const [whatsAppModal, setWhatsAppModal] = useState(null);
  const [supplierCoverageModal, setSupplierCoverageModal] = useState(null);
  const [availabilityContractDetail, setAvailabilityContractDetail] = useState(null);
  const [supplierCoverageDraft, setSupplierCoverageDraft] = useState(buildEmptySupplierCoverageDraft);
  const [supplierCoverageError, setSupplierCoverageError] = useState('');
  const [isSavingSupplierCoverage, setIsSavingSupplierCoverage] = useState(false);
  const [numberingEditorOpen, setNumberingEditorOpen] = useState(false);
  const [numberingDraft, setNumberingDraft] = useState({ currentCode: '', followingCode: '' });
  const [numberingError, setNumberingError] = useState('');
  const [isSavingNumbering, setIsSavingNumbering] = useState(false);

  const [menuState, setMenuState] = useState(null);
  const menuRef = useRef(null);
  const submitLockRef = useRef(false);
  const [supplierFulfillmentDraftByItem, setSupplierFulfillmentDraftByItem] = useState({});
  const canChooseResponsibles = isDeveloper(currentUser);
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
    return true;
  };

  const endSubmit = () => {
    submitLockRef.current = false;
    setIsSubmitting(false);
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

  const deliveryByRentalId = useMemo(() => {
    const map = new Map();
    deliveries.forEach((entry) => {
      if (entry.rentalId && !map.has(entry.rentalId)) {
        map.set(entry.rentalId, entry);
      }
    });
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
      const linkedDeliveries = deliveries
        .filter((entry) => entry.rentalId === rental.id || (entry.orderCode && entry.orderCode === orderCode))
        .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
      const delivery = linkedDeliveries[0]
        ?? deliveryByRentalId.get(rental.id)
        ?? deliveries.find((entry) => entry.orderCode && entry.orderCode === orderCode)
        ?? null;
      const firstItem = rental.items?.[0];
      const itemsCount = (rental.items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
      const linkedContract = contractByRentalId.get(rental.id) ?? contractByOrderCode.get(orderCode) ?? null;
      const contractStatus = linkedContract?.status ?? 'sin_contrato';
      const contractMeta = CONTRACT_STATUS_META[contractStatus];
      const operational = rental.operational ?? {};
      const inventoryStatus = operational.inventoryStatus ?? 'pendiente';
      const transportStatus = operational.transportStatus ?? 'pendiente';
      const accountingStatus = rental.accountingStatus ?? rental.payment?.status ?? '';
      const pendingPaymentBs = Number(rental?.payment?.pendingPaymentBs ?? rental?.totals?.pendingPaymentBs ?? 0);
      const pendingCollectionBs = Number(rental?.returnSettlement?.pendingCollectionBs ?? pendingPaymentBs);

      return {
        id: rental.id,
        rentalId: rental.id,
        rentalStatus: rental.status ?? '',
        orderCode,
        createdAt: rental.createdAt ?? rental.rentalAt,
        responsibleName: getResponsibleDisplayName(linkedContract ?? rental),
        responsibleRole: getResponsibleDisplayRole(linkedContract ?? rental),
        client: rental.customerName,
        customerPhone: rental.customerPhone ?? rental.phone ?? '',
        clientMeta: rental.customerPhone ? `Cel: ${rental.customerPhone}` : 'Sin telefono',
        event: firstItem?.itemName ? `Servicio de ${firstItem.itemName}` : 'Servicio de alquiler',
        eventMeta: `${itemsCount} items`,
        serviceDate: rental.dueDate,
        serviceTime: rental.dueTime ? `${rental.dueTime} (max)` : '-',
        deliveryAt: delivery?.scheduledDate ?? rental.dueDate,
        deliveryMeta: delivery
          ? `${delivery.address ?? 'Direccion pendiente'} ${delivery.city ?? ''}`.trim()
          : 'Pendiente de ruta',
        status: toOrderStatus(rental, delivery),
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
        inventoryNote: operational.inventoryNote ?? '',
        transportNote: operational.transportNote ?? '',
        inventorySentAt: operational.inventorySentAt ?? null,
        transportSentAt: operational.transportSentAt ?? null,
        inventoryConfirmedAt: operational.inventoryConfirmedAt ?? null,
        transportConfirmedAt: operational.transportConfirmedAt ?? null,
        items: rental.items ?? [],
      };
    });
  }, [contracts, deliveries, deliveryByRentalId, rentals]);

  const documentsByOrderId = useMemo(() => {
    const map = new Map();
    orderRows.forEach((row) => {
      const orderCodeToken = normalizeText(row.orderCode);
      const docs = generatedReports
        .filter((report) => {
          const sourceId = String(report?.sourceId ?? '').trim();
          const reportName = normalizeText(report?.name ?? '');
          const bySourceId = sourceId && (sourceId === String(row.rentalId) || row.deliveryIds.includes(sourceId));
          const byOrderCode = orderCodeToken && reportName.includes(orderCodeToken);
          return bySourceId || byOrderCode;
        })
        .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
      map.set(row.id, docs);
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

  const returnedGuaranteeReferences = useMemo(() => {
    const references = new Set();
    cashMovements.forEach((movement) => {
      const tag = normalizeText(movement?.accountingTag);
      const category = normalizeText(movement?.category);
      const type = normalizeText(movement?.type);
      const isConfirmedGuaranteeReturn =
        tag === 'guarantee_refund'
        || category === 'garantia_devuelta_manual'
        || type === 'egreso_devolucion_garantia_manual';
      if (!isConfirmedGuaranteeReturn) return;
      [
        movement?.linkedContractId,
        movement?.linkedRentalId,
        movement?.linkedOrderCode,
        movement?.contractCode,
        movement?.reference,
        movement?.sourceId,
      ].forEach((value) => {
        const normalized = normalizeText(value);
        if (normalized) references.add(normalized);
      });
    });
    return references;
  }, [cashMovements]);

  const contractRows = useMemo(() => {
    return contracts.map((contract) => {
      const itemsCount = (contract.items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
      const status = CONTRACT_STATUS_META[contract.status] ? contract.status : 'borrador';
      const linkedOrder = orderByContractId.get(String(contract.id)) ?? null;
      const isReturned = normalizeText(linkedOrder?.rentalStatus).includes('returned')
        || normalizeText(linkedOrder?.inventoryStatus).includes('devuelto');
      const isSent = ['salio', 'devuelto'].includes(normalizeText(linkedOrder?.inventoryStatus));
      const guaranteeBs = Number(contract?.totals?.guaranteeBs ?? 0);
      const guaranteeReferenceKeys = [
        contract.id,
        contract.rentalId,
        contract.contractCode,
        contract.orderCode,
        linkedOrder?.id,
        linkedOrder?.orderCode,
      ].map(normalizeText);
      const hasReturnedGuarantee = guaranteeReferenceKeys.some((key) => key && returnedGuaranteeReferences.has(key));
      const rawGuaranteeStatus = String(contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? '').trim();
      const isGuaranteeValidated = rawGuaranteeStatus === 'validado' || (!rawGuaranteeStatus && guaranteeBs > 0);
      const guaranteeStatus = guaranteeBs <= 0
        ? 'none'
        : !isGuaranteeValidated
          ? 'pending'
          : hasReturnedGuarantee
          ? 'returned'
          : 'held';
      return {
        ...contract,
        status,
        itemsCount,
        responsibleName: getResponsibleDisplayName(contract),
        responsibleRole: getResponsibleDisplayRole(contract),
        totalBs: Number(contract?.totals?.totalBs ?? 0),
        isSent,
        isReturned,
        guaranteeBs,
        guaranteeStatus,
        guaranteePrimary: guaranteeBs > 0 ? formatBs(guaranteeBs) : 'Sin garantía',
        guaranteeSecondary: guaranteeBs > 0
          ? guaranteeStatus === 'pending' ? 'No validada' : guaranteeStatus === 'returned' ? 'Devuelta' : 'Recibida'
          : '',
      };
    });
  }, [contracts, formatBs, orderByContractId, returnedGuaranteeReferences]);

  const contractCounts = useMemo(() => {
    const base = { all: contractRows.length, borrador: 0, pendiente: 0, aprobado: 0, rechazado: 0, anulado: 0 };
    contractRows.forEach((row) => {
      base[row.status] = (base[row.status] ?? 0) + 1;
    });
    return base;
  }, [contractRows]);

  const searchedContracts = useMemo(() => {
    const text = normalizeText(contractQuery);
    return contractRows.filter((row) => {
      const eventKey = getDateKey(row.eventDate);
      if (contractDateFrom && (!eventKey || eventKey < contractDateFrom)) return false;
      if (contractDateTo && (!eventKey || eventKey > contractDateTo)) return false;
      if (!text) return true;
      return (
        normalizeText(row.contractCode).includes(text)
        || normalizeText(row.customerName).includes(text)
        || normalizeText(row.customerPhone).includes(text)
        || normalizeText(row.customerReferencePhone).includes(text)
        || normalizeText(row.eventType).includes(text)
        || normalizeText(row.orderCode).includes(text)
      );
    });
  }, [contractDateFrom, contractDateTo, contractQuery, contractRows]);

  const visibleContractCounts = useMemo(() => {
    const base = { all: searchedContracts.length, borrador: 0, pendiente: 0, aprobado: 0, rechazado: 0, anulado: 0 };
    searchedContracts.forEach((row) => {
      base[row.status] = (base[row.status] ?? 0) + 1;
    });
    return base;
  }, [searchedContracts]);

  const filteredContracts = useMemo(() => {
    return searchedContracts.filter((row) => contractFilter === 'all' || row.status === contractFilter);
  }, [contractFilter, searchedContracts]);

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

  const activeOrderMenuRow = useMemo(
    () => (menuState?.type === 'order' ? orderRowsWithMeta.find((row) => row.id === menuState.id) ?? null : null),
    [menuState, orderRowsWithMeta],
  );

  const activeQuoteMenuRow = useMemo(
    () => (menuState?.type === 'quote' ? quoteRows.find((row) => row.id === menuState.id) ?? null : null),
    [menuState, quoteRows],
  );

  const activeContractMenuRow = useMemo(
    () => (menuState?.type === 'contract' ? contractRows.find((row) => row.id === menuState.id) ?? null : null),
    [contractRows, menuState],
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
    if (!documentsOrder) return [];
    const isCenterDocument = (report) => {
      const sourceType = normalizeText(report?.sourceType ?? '');
      const reportName = normalizeText(report?.name ?? '');
      return sourceType === 'contrato'
        || sourceType === 'orden_inventario'
        || reportName.includes('contrato')
        || reportName.includes('inventario');
    };
    const directDocs = (documentsByOrderId.get(documentsOrder.id) ?? []).filter(isCenterDocument);
    if (directDocs.length) return directDocs;

    const tokens = [
      documentsOrder.rentalId,
      documentsOrder.orderCode,
      documentsOrder.contractId,
      documentsOrder.contractCode,
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
  }, [documentsByOrderId, documentsOrder, generatedReports]);

  const selectedDocumentsContract = useMemo(() => {
    if (!documentsOrder) return null;
    return contracts.find((contract) =>
      (documentsOrder.contractId && String(contract.id) === String(documentsOrder.contractId))
      || (documentsOrder.contractCode && String(contract.contractCode) === String(documentsOrder.contractCode))
      || (documentsOrder.rentalId && String(contract.rentalId) === String(documentsOrder.rentalId))
      || (documentsOrder.orderCode && String(contract.orderCode) === String(documentsOrder.orderCode)),
    ) ?? null;
  }, [contracts, documentsOrder]);

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

  const documentOverviewRows = useMemo(() => {
    if (!documentsOrder) return [];

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
        title: documentsOrder.contractCode ? `Contrato ${documentsOrder.contractCode}` : `Contrato ${documentsOrder.orderCode}`,
        description: documentsOrder.contractId ? 'Acuerdo comercial vinculado a la orden.' : 'Contrato pendiente de vincular.',
        status: documentsOrder.contractId ? 'Disponible' : 'Pendiente',
        statusClass: documentsOrder.contractId ? 'contract-approved' : 'contract-pending',
        generatedAt: contractReport?.generatedAt ?? null,
        format: contractReport?.format ?? 'PDF',
        latestReportId: contractReport?.id ?? null,
      },
      {
        id: 'inventory',
        kind: 'inventory',
        title: `Orden inventario ${documentsOrder.orderCode}`,
        description: 'Lista operativa para alistar, controlar y devolver items.',
        status: inventoryReport ? 'Generado' : 'Vista previa',
        statusClass: inventoryReport ? 'contract-approved' : 'quote-sent',
        generatedAt: inventoryReport?.generatedAt ?? null,
        format: inventoryReport?.format ?? 'PDF',
        latestReportId: inventoryReport?.id ?? null,
      },
    ];
  }, [documentsForSelectedOrder, documentsOrder]);

  const historicalDocumentsForSelectedOrder = useMemo(() => {
    if (!documentsOrder) return [];
    const latestReportIds = new Set(
      documentOverviewRows
        .map((entry) => String(entry.latestReportId ?? '').trim())
        .filter(Boolean),
    );
    return documentsForSelectedOrder.filter((doc) => !latestReportIds.has(String(doc.id ?? '').trim()));
  }, [documentOverviewRows, documentsForSelectedOrder, documentsOrder]);

  const selectedOperationalOrder = useMemo(() => {
    if (!operationalOrder) return null;
    return orderRowsWithMeta.find((row) => row.id === operationalOrder.id) ?? operationalOrder;
  }, [operationalOrder, orderRowsWithMeta]);

  const toggleActionsMenu = (type, id, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 220;
    const menuHeight = type === 'quote' ? 268 : type === 'contract' ? 384 : 470;
    const openUp = window.innerHeight - rect.bottom < menuHeight + 18;
    const clampedLeft = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, rect.right - menuWidth));
    const top = openUp ? Math.max(12, rect.top - 8) : Math.max(12, rect.bottom + 8);

    setMenuState((current) => {
      if (current?.type === type && current?.id === id) {
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

  const activeViewMeta = useMemo(() => {
    if (activeView === 'quotes') {
      return {
        title: 'Cotizaciones',
        count: filteredQuotes.length,
        total: quoteRows.length,
        helper: 'Propuestas comerciales antes de convertirse en contrato.',
      };
    }
    return {
      title: 'Contratos',
      count: filteredContracts.length,
      total: contractRows.length,
      helper: 'Acuerdos aprobados o pendientes. Cada contrato centraliza sus ordenes de servicio.',
    };
  }, [activeView, contractRows.length, filteredContracts.length, filteredQuotes.length, quoteRows.length]);

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
      pickupDate: draft.pickupDate || draft.eventDate,
      pickupWindowEnd: draft.pickupWindowEnd || draft.eventTime,
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
    ],
  );

  const availabilityByItemId = useMemo(
    () => {
      const linkedRental = draft.entityType === 'contract' && draft.recordId
        ? rentals.find((rental) => String(rental.contractId ?? '') === String(draft.recordId))
        : null;
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
          rentalId: linkedRental?.id ?? null,
          orderCode: linkedRental?.orderCode ?? null,
        },
      });
    },
    [contracts, draft.entityType, draft.recordId, draft.quoteId, draftAvailabilityPeriod, items, quotes, rentals],
  );

  const selectedItems = useMemo(() => {
    return draft.items
      .map((line) => {
        const item = items.find((entry) => entry.id === line.itemId) ?? (line.quickItem
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
        const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
        const unitPriceBs = Math.max(0, Number(line.unitPriceBs ?? item.rentalPriceBs ?? 0));
        const explicitGrossLineTotalBs = Number.isFinite(Number(line.grossLineTotalBs)) ? Math.max(0, Number(line.grossLineTotalBs)) : null;
        const explicitLineTotalBs = Number.isFinite(Number(line.lineTotalBs)) ? Math.max(0, Number(line.lineTotalBs)) : null;
        const grossLineTotalBs = explicitLineTotalBs !== null ? explicitLineTotalBs : quantity * unitPriceBs;
        const lineGrossTotalBs = explicitGrossLineTotalBs !== null ? explicitGrossLineTotalBs : grossLineTotalBs;
        const discountPercent = Math.min(100, Math.max(0, Number(line.discountPercent ?? 0)));
        const lineDiscountBs = Number((lineGrossTotalBs * (discountPercent / 100)).toFixed(2));
        const lineKey = String(line.lineKey ?? line.comboLineKey ?? line.itemId);
        return {
          ...line,
          lineKey,
          quantity,
          quantityInput: line.quantity === '' ? '' : String(line.quantity ?? quantity),
          unitPriceBs,
          unitPriceInput: line.unitPriceBs === '' ? '' : String(line.unitPriceBs ?? unitPriceBs),
          item,
          availability,
          discountPercent,
          grossLineTotalBs: lineGrossTotalBs,
          lineDiscountBs,
          lineTotalBs: Number(Math.max(0, lineGrossTotalBs - lineDiscountBs).toFixed(2)),
        };
      })
      .filter(Boolean);
  }, [availabilityByItemId, draft.items, items]);

  const selectedServices = useMemo(
    () => (draft.services ?? [])
      .map((service, index) => {
        const name = String(service?.name ?? '').trim();
        if (!name) return null;
        const quantity = Math.max(1, Math.trunc(Number(service?.quantity ?? 1)));
        const unitPriceBs = Math.max(0, Number(service?.unitPriceBs ?? 0));
        return {
          ...service,
          id: service?.id ?? `service-${index}`,
          name,
          detail: String(service?.detail ?? '').trim(),
          quantity,
          unitPriceBs,
          lineTotalBs: Number((quantity * unitPriceBs).toFixed(2)),
        };
      })
      .filter(Boolean),
    [draft.services],
  );

  const selectedDemandByItemId = useMemo(() => {
    const map = new Map();
    selectedItems.forEach((line) => {
      if (isDetachedFromInventory(line)) return;
      map.set(line.itemId, (map.get(line.itemId) ?? 0) + Math.max(0, Number(line.quantity ?? 0)));
    });
    return map;
  }, [selectedItems]);

  const stockIssues = useMemo(
    () => selectedItems.filter((line) => {
      if (isDetachedFromInventory(line)) return false;
      const available = Math.max(0, Number(line.availability?.projectedAvailable ?? line.item.availableStock ?? 0));
      const requestedForItem = Math.max(0, Number(selectedDemandByItemId.get(line.itemId) ?? line.quantity));
      return requestedForItem > available;
    }),
    [selectedDemandByItemId, selectedItems],
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
    if (!modalOpen) return;
    const fromRecord = {};
    (draft.supplierFulfillmentPlan ?? []).forEach((line) => {
      const itemId = String(line?.itemId ?? '').trim();
      if (!itemId) return;
      fromRecord[itemId] = {
        supplierId: String(line?.supplierId ?? '').trim(),
        supplierName: String(line?.supplierName ?? '').trim(),
        supplierQuoteId: String(line?.supplierQuoteId ?? '').trim() || null,
        supplierQuoteCode: String(line?.supplierQuoteCode ?? '').trim() || null,
        neededQty: Math.max(1, Math.trunc(Number(line?.neededQty ?? 1))),
        supplierUnitCostBs: Math.max(0, Number(line?.supplierUnitCostBs ?? 0)),
      };
    });
    setSupplierFulfillmentDraftByItem(fromRecord);
  }, [draft.recordId, draft.supplierFulfillmentPlan, modalOpen]);

  useEffect(() => {
    if (!modalOpen) return;
    setSupplierFulfillmentDraftByItem((current) => {
      const next = { ...current };
      const validItemIds = new Set(selectedItems.map((line) => String(line.itemId)));

      Object.keys(next).forEach((itemId) => {
        if (!validItemIds.has(itemId)) delete next[itemId];
      });

      selectedItems.forEach((line) => {
        if (isDetachedFromInventory(line)) {
          delete next[line.itemId];
          return;
        }
        const itemId = String(line.itemId);
        const available = Math.max(0, Number(line.availability?.projectedAvailable ?? line.item.availableStock ?? 0));
        const shortage = Math.max(0, line.quantity - available);
        if (shortage <= 0) {
          delete next[itemId];
          return;
        }

        const existing = next[itemId] ?? {};
        const offers = supplierOffersByItemId.get(itemId) ?? [];
        const fallbackOffer = offers[0] ?? null;
        const neededQty = Math.max(1, Math.min(shortage, Math.trunc(Number(existing.neededQty ?? shortage))));

        if (!existing.supplierId && fallbackOffer) {
          next[itemId] = {
            supplierId: fallbackOffer.supplierId,
            supplierName: fallbackOffer.supplierName,
            supplierQuoteId: fallbackOffer.supplierQuoteId,
            supplierQuoteCode: fallbackOffer.supplierQuoteCode,
            neededQty,
            supplierUnitCostBs: fallbackOffer.supplierUnitCostBs,
          };
          return;
        }

        next[itemId] = {
          ...existing,
          neededQty,
          supplierUnitCostBs: Math.max(0, Number(existing.supplierUnitCostBs ?? fallbackOffer?.supplierUnitCostBs ?? 0)),
        };
      });

      return next;
    });
  }, [modalOpen, selectedItems, supplierOffersByItemId]);

  const supplierCoverageRows = useMemo(
    () => {
      const processedItemIds = new Set();
      return selectedItems
        .map((line) => {
        if (isDetachedFromInventory(line)) return null;
        if (processedItemIds.has(line.itemId)) return null;
        processedItemIds.add(line.itemId);
        const available = Math.max(0, Number(line.availability?.projectedAvailable ?? line.item.availableStock ?? 0));
        const requestedForItem = Math.max(0, Number(selectedDemandByItemId.get(line.itemId) ?? line.quantity));
        const shortageQty = Math.max(0, requestedForItem - available);
        if (shortageQty <= 0) return null;
        const draftLine = supplierFulfillmentDraftByItem[line.itemId] ?? null;
        const hasSupplier = Boolean(String(draftLine?.supplierId ?? '').trim());
        const coveredQty = hasSupplier
          ? Math.min(shortageQty, Math.max(0, Math.trunc(Number(draftLine?.neededQty ?? 0))))
          : 0;
        return {
          itemId: line.itemId,
          itemName: line.item.name,
          saleUnitPriceBs: line.unitPriceBs,
          shortageQty,
          coveredQty,
          uncoveredQty: Math.max(0, shortageQty - coveredQty),
          supplierId: String(draftLine?.supplierId ?? '').trim(),
          supplierName: String(draftLine?.supplierName ?? '').trim(),
          supplierQuoteId: draftLine?.supplierQuoteId ?? null,
          supplierQuoteCode: draftLine?.supplierQuoteCode ?? null,
          supplierUnitCostBs: Math.max(0, Number(draftLine?.supplierUnitCostBs ?? 0)),
        };
      })
        .filter(Boolean);
    },
    [selectedDemandByItemId, selectedItems, supplierFulfillmentDraftByItem],
  );

  const uncoveredStockIssues = useMemo(
    () => supplierCoverageRows.filter((line) => line.uncoveredQty > 0),
    [supplierCoverageRows],
  );

  const supplierCoverageTotals = useMemo(() => {
    const coveredLines = supplierCoverageRows.filter((line) => line.coveredQty > 0 && line.supplierId);
    const totalCoveredQty = coveredLines.reduce((sum, line) => sum + line.coveredQty, 0);
    const totalCostBs = coveredLines.reduce((sum, line) => sum + (line.coveredQty * line.supplierUnitCostBs), 0);
    const totalSaleBs = coveredLines.reduce((sum, line) => sum + (line.coveredQty * line.saleUnitPriceBs), 0);
    return {
      lines: coveredLines.length,
      totalCoveredQty,
      totalCostBs: Number(totalCostBs.toFixed(2)),
      totalSaleBs: Number(totalSaleBs.toFixed(2)),
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

  const baseItemsSubtotalBs = useMemo(
    () => selectedItems.reduce((sum, line) => sum + line.lineTotalBs, 0),
    [selectedItems],
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

  const quotePricingPlan = useMemo(
    () => ({
      mode: durationPricing.mode,
      days: durationPricing.days,
      tiers: durationPricing.tiers.map((tier) => ({
        fromDay: tier.fromDay,
        toDay: tier.toDay,
        percent: tier.percent,
      })),
      baseSubtotalBs: durationPricing.baseSubtotalBs,
      theoreticalSubtotalBs: durationPricing.theoreticalSubtotalBs,
      chargeableSubtotalBs: durationPricing.chargeableSubtotalBs,
      durationDiscountBs: durationPricing.durationDiscountBs,
      effectiveMultiplier: durationPricing.effectiveMultiplier,
    }),
    [durationPricing],
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

  const generalDiscountPercent = Math.min(100, Math.max(0, Number(draft.discountPercent ?? 0)));
  const generalDiscountBs = useMemo(
    () => Number((quoteSubtotalBs * (generalDiscountPercent / 100)).toFixed(2)),
    [generalDiscountPercent, quoteSubtotalBs],
  );

  const quoteTotalBs = useMemo(() => (
    Math.max(0, quoteSubtotalBs - generalDiscountBs + quoteDeliveryFeeBs)
  ), [generalDiscountBs, quoteDeliveryFeeBs, quoteSubtotalBs]);

  const pendingAtApprovalBs = useMemo(() => {
    const paid = Math.max(0, Number(draft.paidAtApprovalBs ?? 0));
    return Math.max(0, quoteTotalBs - paid);
  }, [draft.paidAtApprovalBs, quoteTotalBs]);

  const overpaidAtApprovalBs = useMemo(() => {
    const paid = Math.max(0, Number(draft.paidAtApprovalBs ?? 0));
    return Math.max(0, Number((paid - quoteTotalBs).toFixed(2)));
  }, [draft.paidAtApprovalBs, quoteTotalBs]);

  const selectedClientForDraft = useMemo(
    () => clients.find((client) => client.id === draft.clientId) ?? null,
    [clients, draft.clientId],
  );

  const selectedClientAddresses = useMemo(
    () => getClientAddressOptions(selectedClientForDraft),
    [selectedClientForDraft],
  );

  const selectedClientPrepaidBalanceBs = selectedClientForDraft?.prepaidEnabled
    ? Math.max(0, Number(selectedClientForDraft.prepaidBalanceBs ?? 0))
    : 0;
  const selectedClientPrepaidCoverageBs = Math.min(selectedClientPrepaidBalanceBs, quoteTotalBs);
  const selectedClientPrepaidPendingBs = Math.max(0, quoteTotalBs - selectedClientPrepaidCoverageBs);

  const itemCategoryOptions = useMemo(
    () => Array.from(new Set([
      ...items.map((item) => item.category).filter(Boolean),
      ...(combos.length ? ['COMBOS'] : []),
    ])).sort((a, b) => a.localeCompare(b, 'es')),
    [combos, items],
  );

  const filteredCatalog = useMemo(() => {
    const productEntries = items
      .map((item) => {
        if (itemCategoryFilter !== 'all' && item.category !== itemCategoryFilter) return false;
        const score = getCatalogSearchScore(itemSearch, [
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
        const score = getCatalogSearchScore(itemSearch, [
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
  }, [combos, itemCategoryFilter, itemSearch, items]);

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

  const mapRecordToDraft = (record, entityType = 'quote') => ({
    ...buildEmptyDraft(entityType === 'contract' ? 'order' : 'quote'),
    entityType,
    mode: entityType === 'contract' ? 'order' : 'quote',
    recordId: record?.id ?? '',
    quoteId: entityType === 'contract' ? String(record?.quoteId ?? '').trim() : '',
    recordStatus: record?.status ?? (entityType === 'contract' ? 'pendiente' : 'borrador'),
    documentCodeMode: record?.contractCode || record?.quoteCode ? 'manual' : 'auto',
    manualDocumentCode: entityType === 'contract' ? String(record?.contractCode ?? '').trim() : String(record?.quoteCode ?? '').trim(),
    contractDate: (record?.contractDate ?? record?.createdAt ?? '').slice(0, 10) || getInputDate(new Date()),
    clientId: record?.clientId ?? '',
    customerName: record?.customerName ?? '',
    customerPhone: record?.customerPhone ?? '',
    customerReferencePhone: record?.customerReferencePhone ?? '',
    companyName: record?.companyName ?? '',
    eventType: record?.eventType ?? 'social',
    eventDate: record?.eventDate ?? getInputDate(new Date()),
    eventTime: record?.eventTime ?? '20:00',
    address: record?.address ?? '',
    addressSource: 'manual',
    city: record?.city ?? '',
    deliveryDate: record?.deliveryDate ?? getInputDate(new Date()),
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
    pickupDate: record?.pickupDate ?? getInputDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    pickupWindowStart: record?.pickupWindowStart ?? '20:00',
    pickupWindowEnd: record?.pickupWindowEnd ?? '22:00',
    pickupTimeMode: record?.pickupTimeMode === 'coordinate' ? 'coordinate' : 'fixed',
    driverId: record?.driverId ?? '',
    vehicleId: record?.vehicleId ?? '',
    discountBs: String(record?.totals?.discountBs ?? 0),
    discountPercent: String(record?.totals?.discountPercent ?? record?.discountPercent ?? 0),
    guaranteeBs: String(record?.totals?.guaranteeBs ?? 0),
    guaranteeStatus: record?.guarantee?.status ?? record?.payment?.guaranteeStatus ?? (Number(record?.totals?.guaranteeBs ?? 0) > 0 ? 'validado' : 'no_validado'),
    guaranteePaymentMethod: record?.guarantee?.paymentMethod ?? record?.payment?.guaranteePaymentMethod ?? 'efectivo',
    guaranteePaymentAccount: record?.guarantee?.paymentAccount ?? record?.payment?.guaranteePaymentAccount ?? '',
    paidAtApprovalBs: String(record?.payment?.paidAtApprovalBs ?? 0),
    initialPaymentMethod: record?.payment?.initialPaymentMethod ?? record?.payment?.paymentMethod ?? 'efectivo',
    initialPaymentAccount: record?.payment?.initialPaymentAccount ?? record?.payment?.paymentAccount ?? '',
    pricingMode: record?.pricingPlan?.mode === 'duration' ? 'duration' : 'simple',
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
    billingMode: record?.billingMode ?? 'sin_factura',
    validUntil: entityType === 'contract' ? '' : record?.validUntil ?? '',
    observations: record?.observations ?? '',
    responsibleIds: Array.isArray(record?.responsibles) && record.responsibles.length > 0
      ? record.responsibles.map((entry) => String(entry?.id ?? entry?.name ?? '').trim()).filter(Boolean)
      : [String(record?.createdById ?? record?.userId ?? record?.createdByName ?? record?.createdBy ?? '').trim()].filter(Boolean),
    items: (record?.items ?? []).map((line, index) => ({
      lineKey: line.lineKey ?? (line.comboLineKey ? `${line.comboLineKey}-${line.itemId}-${index}` : undefined),
      itemId: line.itemId,
      quantity: line.quantity,
      unitPriceBs: line.unitPriceBs,
      lineTotalBs: line.lineTotalBs,
      grossLineTotalBs: Number(line.grossLineTotalBs ?? 0) > 0
        ? Number(line.grossLineTotalBs)
        : Number(line.lineTotalBs ?? 0) + Number(line.discountBs ?? 0),
      discountPercent: String(line.discountPercent ?? 0),
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
    })),
    services: (record?.services ?? []).map((service, index) => ({
      id: service?.id ?? `service-${index}`,
      name: String(service?.name ?? ''),
      detail: String(service?.detail ?? ''),
      quantity: Math.max(1, Math.trunc(Number(service?.quantity ?? 1))),
      unitPriceBs: Math.max(0, Number(service?.unitPriceBs ?? 0)),
    })),
    supplierFulfillmentPlan: Array.isArray(record?.supplierFulfillmentPlan)
      ? record.supplierFulfillmentPlan.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        itemName: line.itemName,
        supplierId: line.supplierId,
        supplierName: line.supplierName,
        supplierQuoteId: line.supplierQuoteId ?? null,
        supplierQuoteCode: line.supplierQuoteCode ?? null,
        neededQty: Number(line.neededQty ?? 0),
        supplierUnitCostBs: Number(line.supplierUnitCostBs ?? 0),
        saleUnitPriceBs: Number(line.saleUnitPriceBs ?? 0),
      }))
      : [],
  });

  const openCreateModal = (mode, entityType = 'quote', sourceRecord = null) => {
    if (readOnly) return;
    setActionFeedback('');
    setFormError('');
    setItemSearch('');
    setItemCategoryFilter('all');
    setQuickItemDraft(buildEmptyQuickItemDraft());
    setIsQuickItemOpen(false);
    setCatalogModalOpen(false);
    setServiceModalOpen(false);
    setServiceDraft(buildEmptyServiceDraft());
    if (sourceRecord) {
      setDraft(mapRecordToDraft(sourceRecord, entityType));
    } else {
      const emptyDraft = buildEmptyDraft(mode);
      setDraft({
        ...emptyDraft,
        validUntil: entityType === 'contract' ? '' : emptyDraft.validUntil,
        entityType,
        mode,
        recordStatus: entityType === 'contract' && mode === 'order' ? 'pendiente' : 'borrador',
      });
    }
    setSupplierFulfillmentDraftByItem({});
    setCurrentStep(0);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (isSubmitting) return;
    setModalOpen(false);
    setFormError('');
    setItemSearch('');
    setItemCategoryFilter('all');
    setQuickItemDraft(buildEmptyQuickItemDraft());
    setIsQuickItemOpen(false);
    setServiceModalOpen(false);
    setServiceDraft(buildEmptyServiceDraft());
    setCurrentStep(0);
    setSupplierFulfillmentDraftByItem({});
    setSupplierCoverageModal(null);
    setSupplierCoverageDraft(buildEmptySupplierCoverageDraft());
    setSupplierCoverageError('');
    setIsSavingSupplierCoverage(false);
    setDraft(buildEmptyDraft('quote'));
  };

  const setDraftField = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
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

  const setSupplierCoverageField = (itemId, patch) => {
    setSupplierFulfillmentDraftByItem((current) => {
      const currentLine = current[itemId] ?? {};
      return {
        ...current,
        [itemId]: {
          ...currentLine,
          ...patch,
        },
      };
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

  const openSupplierCoverageModal = (line, availableStock) => {
    const shortageQty = Math.max(1, Math.trunc(Number(line.quantity ?? 1)) - Math.max(0, Number(availableStock ?? 0)));
    const currentCoverage = supplierFulfillmentDraftByItem[line.itemId] ?? {};
    const details = getOperationalItemDetails(line);
    const detailValue = (label) => details.find((entry) => entry.label === label)?.value ?? '';
    const hasSuppliers = (supplierBundle?.suppliers ?? []).length > 0;
    setSupplierCoverageModal({
      itemId: line.itemId,
      itemName: line.item.name,
      availableStock,
      shortageQty,
    });
    setSupplierCoverageDraft({
      ...buildEmptySupplierCoverageDraft(),
      supplierMode: currentCoverage.supplierId || hasSuppliers ? 'existing' : 'new',
      supplierId: currentCoverage.supplierId ?? '',
      supplierName: currentCoverage.supplierName ?? '',
      itemName: line.item.name,
      category: detailValue('Categoria') || line.item.category || '',
      color: detailValue('Color'),
      material: detailValue('Material'),
      quantity: String(Math.max(1, Math.trunc(Number(currentCoverage.neededQty ?? shortageQty)))),
      supplierUnitCostBs: String(Math.max(0, Number(currentCoverage.supplierUnitCostBs ?? 0))),
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
    const shortageQty = Math.max(1, Math.trunc(Number(supplierCoverageModal.shortageQty ?? 1)));
    const requestedQty = Math.max(1, Math.min(shortageQty, parseIntegerInput(supplierCoverageDraft.quantity, 1)));
    const supplierCost = Math.max(0, parseMoneyInput(supplierCoverageDraft.supplierUnitCostBs, 0));
    const salePrice = Math.max(0, parseMoneyInput(supplierCoverageDraft.saleUnitPriceBs, 0));
    const itemName = String(supplierCoverageDraft.itemName ?? '').trim();
    const category = String(supplierCoverageDraft.category ?? '').trim();
    const color = String(supplierCoverageDraft.color ?? '').trim();
    const material = String(supplierCoverageDraft.material ?? '').trim();
    const notes = String(supplierCoverageDraft.notes ?? '').trim();

    if (!itemName || !category) {
      setSupplierCoverageError('Indica nombre/modelo y categoria del item que prestara el proveedor.');
      return;
    }
    if (supplierCost <= 0) {
      setSupplierCoverageError('Indica el costo unitario que te cobrara el proveedor.');
      return;
    }
    if (salePrice <= 0) {
      setSupplierCoverageError('Indica el precio unitario que se cobrara al cliente.');
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

      const quote = await onCreateSupplierQuote?.({
        supplierId: supplier.id,
        title: `Cobertura para ${supplierCoverageModal.itemName}`,
        validFrom: draft.deliveryDate,
        validUntil: draft.pickupDate || draft.eventDate,
        notes: [
          `Cobertura creada desde ${draft.entityType === 'contract' ? 'contrato' : 'cotizacion'} en ordenes de servicio.`,
          color ? `Color: ${color}` : '',
          material ? `Material: ${material}` : '',
          notes,
        ].filter(Boolean).join(' | '),
        items: [{
          itemId: String(supplierCoverageModal.itemId).startsWith('quick-') ? '' : supplierCoverageModal.itemId,
          itemName,
          category,
          quantity: requestedQty,
          unitPriceBs: supplierCost,
          unit: 'unidad',
        }],
      });

      setDraftItemPrice(supplierCoverageModal.itemId, salePrice);
      setSupplierCoverageField(supplierCoverageModal.itemId, {
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplierQuoteId: quote?.id ?? null,
        supplierQuoteCode: quote?.quoteCode ?? null,
        neededQty: requestedQty,
        supplierUnitCostBs: supplierCost,
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

  const setClientFromSelection = (clientId) => {
    const selected = clients.find((row) => row.id === clientId);
    if (!selected) {
      setDraft((current) => ({ ...current, clientId: '' }));
      return;
    }

    const addressOptions = getClientAddressOptions(selected);
    const firstAddress = addressOptions[0] ?? null;

    setDraft((current) => ({
      ...current,
      clientId: selected.id,
      customerName: selected.name,
      customerPhone: selected.whatsapp || selected.phone,
      customerReferencePhone: selected.referencePhone || '',
      companyName: selected.companyName || selected.name,
      address: firstAddress?.address || selected.address || current.address,
      addressSource: firstAddress?.id || 'manual',
      city: firstAddress?.city || selected.city || current.city,
    }));
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

  const addDraftItem = (itemId) => {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    setDraft((current) => {
      const already = current.items.find((line) => line.itemId === itemId && !line.comboId);
      if (already) {
        const nextQty = Math.max(1, Number(already.quantity ?? 1) + 1);
        return {
          ...current,
          items: current.items.map((line) => ((line.lineKey ?? line.itemId) === (already.lineKey ?? already.itemId) ? { ...line, quantity: nextQty } : line)),
        };
      }
      return {
        ...current,
        items: [...current.items, { lineKey: `item-${itemId}-${Date.now()}`, itemId, quantity: 1, unitPriceBs: Number(item.rentalPriceBs ?? 0) }],
      };
    });
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

  const getComboOptionAvailable = (item) => {
    if (!item) return 0;
    const availability = availabilityByItemId.get(item.id);
    const projected = Math.max(0, Math.trunc(Number(availability?.projectedAvailable ?? item.availableStock ?? 0)));
    if (projected > 0) return projected;
    const stockValue = Math.max(0, Math.trunc(Number(item.totalStock ?? item.availableStock ?? 0)));
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
    (combo?.ingredients ?? []).forEach((rule, index) => {
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
    const ingredients = Array.isArray(combo?.ingredients) ? combo.ingredients : [];
    const groupMaximums = ingredients.map((rule, index) => {
      const options = getComboRuleOptions(rule);
      const selectedIds = getSelectedComboOptionIds(selections[index], []);
      const selectedOptions = options.filter((option) => selectedIds.includes(option.id));
      if (selectedOptions.length === 0) return 0;
      const requiredPerCombo = Math.max(1, Math.trunc(Number(rule?.quantity ?? 1)));
      const availableUnits = selectedOptions.reduce((sum, option) => sum + getComboOptionAvailable(option), 0);
      return Math.floor(availableUnits / requiredPerCombo);
    });
    if (groupMaximums.length === 0) return 0;
    return Math.max(0, Math.min(...groupMaximums));
  };

  const buildComboAllocations = (combo, selections, comboQuantity) => {
    const ingredients = Array.isArray(combo?.ingredients) ? combo.ingredients : [];
    const allocations = [];
    let shortageMessage = '';
    const quantityMap = getComboSelectionQuantityMap(selections);

    ingredients.forEach((rule, index) => {
      const options = getComboRuleOptions(rule);
      const selectedIds = getSelectedComboOptionIds(selections[index], []);
      const selectedOptions = options.filter((option) => selectedIds.includes(option.id));
      const requiredPerCombo = Math.max(1, Math.trunc(Number(rule?.quantity ?? 1)));
      let remaining = requiredPerCombo * comboQuantity;

      if (selectedOptions.length === 0) {
        if (!shortageMessage) {
          shortageMessage = `Selecciona al menos una opcion para "${rule.slotLabel || rule.itemName || `Componente ${index + 1}`}".`;
        }
        return;
      }

      selectedOptions.forEach((item) => {
        if (remaining <= 0) return;
        const available = getComboOptionAvailable(item);
        const manualQuantity = Math.max(0, Math.trunc(Number(quantityMap[`${index}:${item.id}`] ?? 0)));
        const quantity = Math.min(remaining, manualQuantity > 0 ? manualQuantity : available, available);
        if (quantity <= 0) return;
        allocations.push({
          rule,
          ruleIndex: index,
          item,
          quantity,
          requiredPerCombo,
          slotLabel: rule.slotLabel ?? rule.itemName ?? `Componente ${index + 1}`,
          options,
        });
        remaining -= quantity;
      });

      if (remaining > 0 && !shortageMessage) {
        shortageMessage = `No hay suficientes unidades para "${rule.slotLabel || rule.itemName || `Componente ${index + 1}`}". Faltan ${remaining}.`;
      }
    });

    return { allocations, shortageMessage };
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
    const ingredients = Array.isArray(combo.ingredients) ? combo.ingredients : [];
    const requestedComboQuantity = Math.max(1, Math.trunc(Number(selections.__comboQuantity ?? 1)));
    const maxQuantity = getComboMaxQuantity(combo, selections);
    if (maxQuantity <= 0) {
      setFormError('Selecciona opciones disponibles para poder armar este combo.');
      return false;
    }
    if (requestedComboQuantity > maxQuantity) {
      setFormError(`Solo puedes armar ${maxQuantity} combo(s) con las opciones seleccionadas.`);
      return false;
    }
    const { allocations, shortageMessage } = buildComboAllocations(combo, selections, requestedComboQuantity);
    if (shortageMessage) {
      setFormError(shortageMessage);
      return false;
    }
    if (ingredients.length > 0 && allocations.length === 0) {
      setFormError('Selecciona al menos una opcion disponible para el combo.');
      return false;
    }
    setDraft((current) => {
      const previousComboQuantity = existingComboLineKey
        ? Math.max(1, Number(current.items.find((line) => line.comboLineKey === existingComboLineKey)?.comboQuantity ?? 1))
        : 1;
      const previousItems = existingComboLineKey
        ? current.items.filter((line) => line.comboLineKey !== existingComboLineKey)
        : current.items;
      let priceAssigned = false;
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
          const isPriceLine = !priceAssigned;
          priceAssigned = true;
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
          };
        }),
        ],
      };
    });
    setFormError('');
    return true;
  };

  const openComboConfigurator = (combo, existingComboLineKey = '') => {
    const defaultSelections = buildDefaultComboSelections(combo);
    const selections = { ...defaultSelections };
    const quantityMap = { ...getComboSelectionQuantityMap(defaultSelections) };
    const existingLines = existingComboLineKey
      ? draft.items.filter((entry) => entry.comboLineKey === existingComboLineKey)
      : [];
    (combo.ingredients ?? []).forEach((line, index) => {
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
      quantity: String(existingComboLineKey ? existingQuantity : 1),
    });
  };

  const normalizeComboConfiguratorQuantities = (current, nextComboQuantity) => {
    if (!current) return current;
    const comboQty = Math.max(1, Math.trunc(Number(nextComboQuantity ?? current.quantity ?? 1)));
    const nextSelections = { ...(current.selections ?? {}) };
    const nextQuantityMap = { ...getComboSelectionQuantityMap(nextSelections) };

    (current.combo?.ingredients ?? []).forEach((rule, index) => {
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
      const rule = current.combo?.ingredients?.[ruleIndex] ?? {};
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
    const configurable = (combo.ingredients ?? []).some((line) => getComboRuleOptions(line).length > 1);
    if (configurable) {
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
          itemId,
          quantity: 1,
          unitPriceBs: Math.max(0, Number(quickItemDraft.rentalPriceBs ?? 0)),
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

  const setServiceDraftField = (field, value) => {
    const nextValue = field === 'unitPriceBs'
      ? cleanDecimalInput(value)
      : field === 'quantity'
      ? cleanIntegerInput(value)
      : value;
    setServiceDraft((current) => ({ ...current, [field]: nextValue }));
  };

  const openServiceModal = () => {
    setServiceDraft(buildEmptyServiceDraft());
    setFormError('');
    setServiceModalOpen(true);
  };

  const closeServiceModal = () => {
    setServiceModalOpen(false);
    setServiceDraft(buildEmptyServiceDraft());
    setFormError('');
  };

  const addDraftService = () => {
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
    setDraft((current) => ({
      ...current,
      services: [
        ...(current.services ?? []),
        {
          id: `service-${Date.now()}`,
          name,
          detail: serviceDraft.detail.trim(),
          quantity,
          unitPriceBs,
        },
      ],
    }));
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
      pricingMode: value === 'duration' ? 'duration' : 'simple',
      pricingDays: String(parsePositiveInteger(current.pricingDays, 1)),
      pricingTiers: Array.isArray(current.pricingTiers) && current.pricingTiers.length > 0
        ? current.pricingTiers
        : DURATION_PRICING_DEFAULT_TIERS,
    }));
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
      if (uncoveredStockIssues.length) {
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
      if (!draft.pickupDate) return 'Selecciona fecha de recojo.';
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
    if (!draft.pickupDate) throw new Error('Debes indicar la fecha de recojo.');
    if (draft.deliveryTimeMode !== 'coordinate' && !isValidSameDayWindow(draft.deliveryWindowStart, draft.deliveryWindowEnd)) {
      throw new Error('La ventana de entrega debe terminar despues de la hora de inicio.');
    }
    if (draft.pickupTimeMode !== 'coordinate' && !isValidSameDayWindow(draft.pickupWindowStart, draft.pickupWindowEnd)) {
      throw new Error('La ventana de recojo debe terminar despues de la hora de inicio.');
    }
    if (!selectedItems.length && !selectedServices.length) throw new Error('Debes agregar al menos un item o servicio.');
    if (uncoveredStockIssues.length) {
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

    const supplierFulfillmentPlan = supplierCoverageRows
      .filter((line) => line.coveredQty > 0 && line.supplierId && line.supplierName)
      .map((line) => ({
        itemId: line.itemId,
        itemName: line.itemName,
        supplierId: line.supplierId,
        supplierName: line.supplierName,
        supplierQuoteId: line.supplierQuoteId,
        supplierQuoteCode: line.supplierQuoteCode,
        neededQty: line.coveredQty,
        supplierUnitCostBs: line.supplierUnitCostBs,
        saleUnitPriceBs: line.saleUnitPriceBs,
      }));
    const selectedResponsibles = getSelectedResponsibles();
    const primaryResponsible = selectedResponsibles[0] ?? null;

    return {
      id: draft.recordId || undefined,
      quoteId: draft.quoteId || null,
      documentCodeMode: draft.documentCodeMode,
      manualDocumentCode: draft.manualDocumentCode.trim(),
      contractDate: draft.contractDate || null,
      clientId: draft.clientId || null,
      customerName: draft.customerName.trim(),
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
      pickupDate: draft.pickupDate,
      pickupWindowStart: draft.pickupWindowStart,
      pickupWindowEnd: draft.pickupWindowEnd,
      pickupTimeMode: draft.pickupTimeMode === 'coordinate' ? 'coordinate' : 'fixed',
      driverId: draft.driverId || null,
      vehicleId: draft.vehicleId || null,
      validUntil: draft.validUntil || null,
      observations: draft.observations.trim(),
      discountBs: generalDiscountBs,
      discountPercent: generalDiscountPercent,
      guaranteeBs,
      guaranteeStatus: draft.guaranteeStatus === 'validado' ? 'validado' : 'no_validado',
      guaranteePaymentMethod: draft.guaranteePaymentMethod || 'efectivo',
      guaranteePaymentAccount: draft.guaranteePaymentMethod === 'qr' ? draft.guaranteePaymentAccount : '',
      paidAtApprovalBs,
      initialPaymentMethod: draft.initialPaymentMethod || 'efectivo',
      initialPaymentAccount: draft.initialPaymentMethod === 'qr' ? draft.initialPaymentAccount : '',
      pricingPlan: quotePricingPlan,
      status: draft.mode === 'order' ? 'enviada' : 'borrador',
      items: selectedItems.map((line) => ({
        lineKey: line.lineKey,
        itemId: String(line.itemId).startsWith('quick-') ? '' : line.itemId,
        quantity: line.quantity,
        unitPriceBs: line.unitPriceBs,
        grossLineTotalBs: line.grossLineTotalBs,
        lineTotalBs: line.lineTotalBs,
        discountPercent: line.discountPercent,
        discountBs: line.lineDiscountBs,
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
      })),
      services: selectedServices.map((service) => ({
        id: service.id,
        name: service.name,
        detail: service.detail,
        quantity: service.quantity,
        unitPriceBs: service.unitPriceBs,
        lineTotalBs: service.lineTotalBs,
      })),
      supplierFulfillmentPlan,
      responsibles: selectedResponsibles,
      createdBy: primaryResponsible?.name ?? undefined,
      createdById: primaryResponsible?.id ?? undefined,
      createdByName: primaryResponsible?.name ?? undefined,
      createdByRole: primaryResponsible?.role ?? undefined,
    };
  };

  const handleSaveQuote = async ({ approveNow }) => {
    if (!beginSubmit()) return;
    setFormError('');
    setActionFeedback('');
    try {
      const payload = createQuotePayload();
      if (draft.entityType === 'contract') {
        const contractPayload = {
          ...payload,
          validUntil: null,
          status: draft.recordStatus || (draft.mode === 'order' ? 'pendiente' : 'borrador'),
        };
        const savedContract = draft.recordId
          ? await onUpdateContract?.(contractPayload)
          : await onCreateContract?.(contractPayload);
        if (!savedContract) {
          throw new Error('No se pudo guardar el contrato.');
        }

        if (approveNow) {
          await onApproveContract?.({ contractId: savedContract.id });
          setActionFeedback(`Contrato ${savedContract.contractCode ?? savedContract.id} aprobado y convertido en orden.`);
        } else {
          setActionFeedback(`Contrato ${savedContract.contractCode ?? savedContract.id} guardado correctamente.`);
        }
      } else {
        const savedQuote = draft.recordId
          ? await onUpdateQuote?.({
            ...payload,
            status: draft.recordStatus || payload.status,
          })
          : await onCreateQuote(payload);
        if (approveNow) {
          const contract = await onApproveQuote?.({ quoteId: savedQuote.id });
          setActiveView('contracts');
          setActionFeedback(
            contract?.contractCode
              ? `Cotizacion ${savedQuote.quoteCode} aprobada. Se genero el contrato ${contract.contractCode}.`
              : `Cotizacion ${savedQuote.quoteCode} aprobada y convertida en contrato.`,
          );
        } else {
          setActionFeedback(`Cotizacion ${savedQuote.quoteCode} guardada correctamente.`);
        }
      }
      setModalOpen(false);
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
    setQuoteApprovalPreview(quote);
  };

  const confirmApproveQuoteClick = async () => {
    if (!quoteApprovalPreview) return;
    if (!beginSubmit()) return;
    const quote = quoteApprovalPreview;
    setFormError('');
    try {
      const contract = await onApproveQuote?.({ quoteId: quote.id });
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

  const handleOpenQuoteDocument = (quote) => {
    setMenuState(null);
    setDocumentPreview({
      kind: 'quote',
      orderCode: quote.quoteCode ?? quote.id,
      title: `Cotizacion ${quote.quoteCode || quote.id}`,
      fileName: buildDocumentFileBase(quote.customerName, quote.quoteCode || quote.id, 'cotizacion'),
      html: buildQuoteApprovalDocumentHtml({ quote, formatDate, formatBs }),
    });
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

  const handleEditContractClick = (contract) => {
    setMenuState(null);
    openCreateModal('order', 'contract', contract);
  };

  const handleCancelContractClick = (contractRow) => {
    const linkedOrder = orderRowsWithMeta.find(
      (row) =>
        (contractRow.rentalId && row.rentalId === contractRow.rentalId)
        || (contractRow.orderCode && row.orderCode === contractRow.orderCode),
    );

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
    setCancelReason(String(contractRow?.cancellationReason ?? '').trim());
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

  const handleOpenDocumentsFromContract = (contractRow) => {
    const linkedOrder = orderRowsWithMeta.find(
      (row) =>
        (contractRow.rentalId && row.rentalId === contractRow.rentalId)
        || (contractRow.orderCode && row.orderCode === contractRow.orderCode),
    );
    if (linkedOrder) {
      setDocumentsOrder(linkedOrder);
      setMenuState(null);
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
  };

  const handlePrintOrderDocument = async (kind, orderRow) => {
    try {
      let preview = null;
      if (kind === 'contract') {
        preview = await onPrintContractDocument?.({
          rentalId: orderRow.rentalId,
          orderCode: orderRow.orderCode,
          contractId: orderRow.contractId,
          contractCode: orderRow.contractCode,
        });
      } else if (kind === 'inventory') {
        preview = await onPrintInventoryWeekDocument?.({
          weekStart: orderRow.deliveryDate ?? orderRow.rentalDate ?? orderRow.createdAt?.slice(0, 10),
          format: 'individual',
          rentalId: orderRow.rentalId,
          orderCode: orderRow.orderCode,
          contractCode: orderRow.contractCode,
        });
      } else if (kind === 'route') {
        preview = await onPrintRouteSheetDocument?.({
          rentalId: orderRow.rentalId,
          orderCode: orderRow.orderCode,
          contractId: orderRow.contractId,
          contractCode: orderRow.contractCode,
        });
      } else if (kind === 'supplier-internal') {
        const contract = selectedDocumentsContract
          ?? contracts.find((entry) =>
            (orderRow.contractId && String(entry.id) === String(orderRow.contractId))
            || (orderRow.contractCode && String(entry.contractCode) === String(orderRow.contractCode))
            || (orderRow.orderCode && String(entry.orderCode) === String(orderRow.orderCode)),
          )
          ?? null;
        preview = {
          title: `Resumen proveedor ${contract?.contractCode ?? orderRow.contractCode ?? orderRow.orderCode}`,
          html: buildSupplierInternalDocumentHtml({ order: orderRow, contract, formatDate, formatBs }),
        };
      }
      if (preview?.html) {
        const documentCode = kind === 'contract'
          ? orderRow.contractCode ?? orderRow.orderCode ?? orderRow.id
          : orderRow.orderCode ?? orderRow.id;
        setDocumentPreview({
          kind,
          orderCode: orderRow.orderCode,
          title: preview.title ?? `${kind === 'contract' ? 'Contrato' : kind === 'inventory' ? 'Orden de inventario' : kind === 'route' ? 'Hoja de ruta' : 'Resumen proveedor'} ${orderRow.orderCode}`,
          fileName: kind === 'contract'
            ? buildDocumentFileBase(orderRow.customerName ?? orderRow.client, documentCode, 'contrato')
            : undefined,
          html: preview.html,
        });
      }
      setActionFeedback(`Documento ${kind === 'contract' ? 'de contrato' : kind === 'inventory' ? 'de inventario' : kind === 'route' ? 'de ruta' : 'interno de proveedor'} cargado para contrato ${getOrderContractLabel(orderRow)}.`);
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo abrir el documento seleccionado.');
    } finally {
      setMenuState(null);
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

  const handlePrintPreview = () => {
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
        setDocumentPreview({
          kind: 'quote',
          orderCode: row.quoteCode,
          title: `Cotizacion ${row.quoteCode || row.id}`,
          fileName: buildDocumentFileBase(row.customerName, row.quoteCode || row.id, 'cotizacion'),
          html: buildQuoteApprovalDocumentHtml({ quote: row, formatDate, formatBs }),
        });
        return;
      }

      if (recordType === 'contract') {
        const preview = await onPrintContractDocument?.({
          contractId: row.id,
          rentalId: row.rentalId,
          orderCode: row.orderCode,
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

  const handleOpenOperationalPanel = (orderRow) => {
    if (orderRow.status === 'cancelled') {
      setFormError('La orden esta anulada y ya no admite gestion operativa.');
      setMenuState(null);
      return;
    }
    setOperationalOrder(orderRow);
    setOperationalDraft({
      inventoryNote: orderRow.inventoryNote ?? '',
      transportNote: orderRow.transportNote ?? '',
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
    setCancelReason('');
    setMenuState(null);
  };

  const closeCancelOrderDialog = () => {
    if (isSubmitting) return;
    setOrderToCancel(null);
    setCancelReason('');
  };

  const confirmCancelOrder = async () => {
    if (!orderToCancel) return;
    if (!beginSubmit()) return;
    setFormError('');
    try {
      const cancelled = await onCancelOrderContract?.({
        id: orderToCancel.rentalId,
        contractId: orderToCancel.contractId,
        reason: cancelReason,
      });
      const penaltyBs = Number(cancelled?.cancellationPenaltyBs ?? orderToCancel.cancellationPenaltyBs ?? 0);
      setActionFeedback(
        `Contrato ${orderToCancel.contractCode || orderToCancel.orderCode} anulado. Penalidad aplicada: ${formatBs(penaltyBs)}.`,
      );
      setOrderToCancel(null);
      setCancelReason('');
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
        <div className="orders-board-head">
          <div>
            <span className="orders-board-eyebrow">Flujo comercial</span>
            <h3>{activeViewMeta.title}</h3>
            <p>{activeViewMeta.helper}</p>
          </div>
          <div className="orders-board-count">
            <strong>{activeViewMeta.count}</strong>
            <span>de {activeViewMeta.total}</span>
          </div>
        </div>

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
                    <th>Total</th>
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
                    type="search"
                    placeholder="Buscar por numero de contrato, cliente o orden..."
                    value={contractQuery}
                    onChange={(event) => setContractQuery(event.target.value)}
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
                <button type="button" className="link-button orders-export-btn">Exportar</button>
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
                <div className="orders-contract-legend" aria-label="Leyenda operativa de contratos">
                  <span><i className="sent" /> Enviado</span>
                  <span><i className="returned" /> Volvió / devuelto</span>
                </div>
              </div>
            </div>

            <div className="orders-table-wrap orders-commercial-table-wrap">
              <table className="orders-table orders-commercial-table orders-contracts-table">
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th>Cliente</th>
                    <th>Responsable</th>
                    <th>Servicio</th>
                    <th>Estado</th>
                    <th>Garantía</th>
                    <th>Transporte</th>
                    <th>Total</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContracts.map((row) => {
                    const statusMeta = CONTRACT_STATUS_META[row.status] ?? CONTRACT_STATUS_META.borrador;
                    const transportMeta = getContractTransportLabel(row);
                    return (
                      <tr key={row.id} className={`orders-row contract-${row.status}${row.isSent ? ' is-sent' : ''}${row.isReturned ? ' is-returned' : ''}`}>
                        <td className={row.isSent ? 'orders-contract-sent-cell' : ''}>
                          <div className="orders-cell-main">
                            <strong className="orders-contract-code">{row.contractCode}</strong>
                            <span>{formatLongSpanishDate(row.eventDate)}</span>
                          </div>
                        </td>
                        <td className={row.isSent ? 'orders-contract-sent-cell' : ''}>
                          <div className="orders-cell-main">
                            <strong>{row.customerName}</strong>
                            <span>{row.customerPhone || 'Sin WhatsApp/celular'}</span>
                            {row.customerReferencePhone ? <span>Ref: {row.customerReferencePhone}</span> : null}
                          </div>
                        </td>
                        <td className={row.isReturned ? 'orders-contract-returned-cell' : ''}>
                          <div className="orders-responsible-cell">
                            <span>{String(row.responsibleName ?? 'Sistema').slice(0, 2).toUpperCase()}</span>
                            <div>
                              <strong>{row.responsibleName}</strong>
                              <small>{row.responsibleRole}</small>
                            </div>
                          </div>
                        </td>
                        <td className={row.isReturned ? 'orders-contract-returned-cell' : ''}>
                          <div className="orders-cell-main">
                            <strong>{[row.deliveryDate, row.pickupDate].filter(Boolean).map(formatDate).join(' - ') || formatDate(row.eventDate)}</strong>
                            <span>Entrega / recojo</span>
                          </div>
                        </td>
                        <td className={row.isReturned ? 'orders-contract-returned-cell' : ''}>
                          <span className={`orders-status-badge contract-${statusMeta.className}`}>{statusMeta.label}</span>
                        </td>
                        <td>
                          <div className={`orders-guarantee-cell ${row.guaranteeBs > 0 ? 'has-guarantee' : 'empty'}`}>
                            <strong>{row.guaranteePrimary}</strong>
                            <span className={`orders-guarantee-state ${row.guaranteeStatus}`}>{row.guaranteeSecondary}</span>
                          </div>
                        </td>
                        <td>
                          <div className="orders-transport-cell">
                            <strong>{transportMeta.title}</strong>
                            <span>{transportMeta.detail}</span>
                          </div>
                        </td>
                        <td className="orders-total">{formatBs(row.totalBs)}</td>
                        <td className="orders-menu">
                          <div className="orders-row-actions">
                            <button type="button" className="orders-open-btn" onClick={() => handleOpenDocumentsFromContract(row)}>
                              Abrir
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
                        </td>
                      </tr>
                    );
                  })}
                  {filteredContracts.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
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

            <div className="orders-mobile-commercial-list">
              {filteredContracts.map((row) => {
                const statusMeta = CONTRACT_STATUS_META[row.status] ?? CONTRACT_STATUS_META.borrador;
                const transportMeta = getContractTransportLabel(row);
                return (
                  <article key={row.id} className={`orders-mobile-contract-card contract-${row.status}${row.isSent ? ' is-sent' : ''}${row.isReturned ? ' is-returned' : ''}`}>
                    <header>
                      <div className={row.isSent ? 'orders-mobile-sent-zone' : ''}>
                        <strong>{row.contractCode}</strong>
                        <span>{formatLongSpanishDate(row.eventDate)}</span>
                      </div>
                      <span className={`orders-status-badge contract-${statusMeta.className}`}>{statusMeta.label}</span>
                      <b>{formatBs(row.totalBs)}</b>
                    </header>
                    <div className={`orders-mobile-contract-main ${row.isSent ? 'orders-mobile-sent-zone' : ''}`}>
                      <p><span>Cliente:</span> <strong>{row.customerName}</strong></p>
                      <p><span>Celular:</span> <strong>{row.customerPhone || 'Sin WhatsApp/celular'}</strong></p>
                    </div>
                    <div className={`orders-mobile-contract-bottom ${row.isReturned ? 'orders-mobile-returned-zone' : ''}`}>
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
                    <div className={`orders-mobile-contract-meta ${row.isReturned ? 'orders-mobile-returned-zone' : ''}`}>
                      <span className="orders-mobile-date-line">Servicio: {[row.deliveryDate, row.pickupDate].filter(Boolean).map(formatDate).join(' - ') || formatDate(row.eventDate)}</span>
                      <span>Entrega / recojo</span>
                    </div>
                    <div className="orders-mobile-contract-details">
                      <div className="orders-mobile-contract-service">
                        <CalendarDays aria-hidden="true" />
                        <span>
                          <small>Servicio</small>
                          <strong>{[row.deliveryDate, row.pickupDate].filter(Boolean).map(formatDate).join(' - ') || formatDate(row.eventDate)}</strong>
                          <em>Entrega / recojo</em>
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

            <footer className="orders-footer">
              <span>
                Mostrando {filteredContracts.length} de {searchedContracts.length} contratos
                {contractQuery ? ` filtrados (${contractRows.length} total)` : ''}
              </span>
            </footer>
          </>
        )}
      </article>

      {menuState ? (
        <div
          ref={menuRef}
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
            <>
              {!readOnly ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleApproveContractClick(activeContractMenuRow)}
                    disabled={activeContractMenuRow.status === 'aprobado' || activeContractMenuRow.status === 'anulado'}
                  >
                    Aprobar contrato
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEditContractClick(activeContractMenuRow)}
                    disabled={activeContractMenuRow.status === 'anulado'}
                  >
                    Editar contrato
                  </button>
                </>
              ) : null}
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
          ) : null}
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
                  {supplierCoverageModal.itemName} tiene faltante de {supplierCoverageModal.shortageQty} u.
                  Registra proveedor y precio sin salir del contrato.
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
                  <small>Faltante maximo: {supplierCoverageModal.shortageQty} u.</small>
                </label>
                <label className="supplier-coverage-field">
                  Costo proveedor Bs *
                  <input type="text" inputMode="decimal" value={supplierCoverageDraft.supplierUnitCostBs} onFocus={selectNumericInput} onChange={(event) => setSupplierCoverageDraftField('supplierUnitCostBs', event.target.value)} />
                </label>
                <label className="supplier-coverage-field">
                  Precio cliente Bs *
                  <input type="text" inputMode="decimal" value={supplierCoverageDraft.saleUnitPriceBs} onFocus={selectNumericInput} onChange={(event) => setSupplierCoverageDraftField('saleUnitPriceBs', event.target.value)} />
                  <small>Este precio queda en el item del contrato.</small>
                </label>
                <label className="supplier-coverage-field wide">
                  Notas internas
                  <input value={supplierCoverageDraft.notes} onChange={(event) => setSupplierCoverageDraftField('notes', event.target.value)} placeholder="Condiciones, entrega, pago al proveedor..." />
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
                  <strong>{selectedDocumentsChangeRows.length} cambios</strong>
                </article>
              </section>

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
                      {selectedDocumentsChangeRows.length === 0 ? (
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
              <iframe
                title={`Cotizacion ${quoteApprovalPreview.quoteCode}`}
                srcDoc={buildQuoteApprovalDocumentHtml({ quote: quoteApprovalPreview, formatDate, formatBs })}
                className="orders-document-frame"
              />
            </div>
            {formError ? <p className="status error orders-modal-error">{formError}</p> : null}
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setQuoteApprovalPreview(null)} disabled={isSubmitting}>
                Cerrar
              </button>
              <button type="button" className="primary-button" onClick={confirmApproveQuoteClick} disabled={isSubmitting}>
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
        <div className="orders-modal-backdrop document-preview-backdrop" onClick={() => setDocumentPreview(null)}>
          <div className="orders-modal orders-preview-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>{documentPreview.title}</h3>
                <p>Vista previa del documento. Puedes revisarlo e imprimirlo desde aqui.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setDocumentPreview(null)}>
                x
              </button>
            </header>
            <div className="orders-preview-body">
              <iframe
                id="orders-document-preview-frame"
                title={documentPreview.title}
                srcDoc={documentPreview.html}
                className="orders-document-frame"
              />
            </div>
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setDocumentPreview(null)}>
                Cerrar
              </button>
              <button type="button" className="primary-button" onClick={handlePrintPreview}>
                Imprimir / guardar PDF
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
                  Solo se permite hasta el dia de envio. La orden seguira visible como anulada en Inventario y Transporte.
                </p>
              </div>
            </header>

            <div className="orders-confirm-summary">
              <strong>{orderToCancel.contractCode || orderToCancel.orderCode}</strong>
              <span>{orderToCancel.client} · {formatBs(orderToCancel.totalBs)}</span>
              <small>
                La penalidad se calculara segun el porcentaje vigente en Configuracion.
              </small>
            </div>

            <label className="orders-note-field">
              Motivo de anulacion (opcional)
              <textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="Ej: cliente posterga el evento."
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
                  const ingredients = Array.isArray(combo.ingredients) ? combo.ingredients : [];
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
                    <button type="button" className="primary-button" onClick={() => addDraftItem(item.id)}>
                      {Number(draftQuantityByItem.get(item.id) ?? 0) > 0
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
              {(comboConfigurator.combo.ingredients ?? []).map((rule, index) => {
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
                return (
                  <article key={`${rule.slotLabel ?? rule.itemName}-${index}`} className="orders-combo-option-group">
                    <header>
                      <div>
                        <strong>{rule.slotLabel || rule.itemName || `Componente ${index + 1}`}</strong>
                        <span>{requiredPerCombo} por combo · {allOptions.length} opciones · {selectedIds.length} seleccionadas · {selectedUnits} unidades marcadas</span>
                      </div>
                      <div className="orders-combo-group-summary">
                        <span className={selectedUnits >= neededUnits ? 'ok' : 'danger'}>
                          {selectedUnits} marc. / {neededUnits} nec.
                        </span>
                        <small>{rule.selectionMode === 'category' ? rule.category : 'Productos elegidos'}</small>
                      </div>
                    </header>
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
                <h3>Asignar servicio</h3>
                <p>Registra personal o trabajo adicional sin afectar el inventario.</p>
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
              <button type="button" className="primary-button" onClick={addDraftService}>
                Agregar servicio
              </button>
            </footer>
          </div>
        </div>
      ) : null}

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
                      <label className="orders-icon-field search" data-client-nav-field>
                        Cliente registrado
                        <span>
                          <i aria-hidden="true"><Search /></i>
                          <select value={draft.clientId} onChange={(event) => setClientFromSelection(event.target.value)}>
                            <option value="">Seleccionar cliente...</option>
                            {clients.map((client) => (
                              <option key={client.id} value={client.id}>
                                {client.name}{client.isBlacklisted ? ' - No atender' : ''}
                              </option>
                            ))}
                          </select>
                        </span>
                      </label>
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
                          const ingredients = Array.isArray(combo.ingredients) ? combo.ingredients : [];
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
                                  <span className="primary">
                                    <small>Puede armar</small>
                                    <strong>{comboMaxQuantity}</strong>
                                  </span>
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
                                <span className="primary">
                                  <small>Para fecha</small>
                                  <strong>{projectedAvailable}</strong>
                                </span>
                                <span>
                                  <small>Ahora</small>
                                  <strong>{Math.max(0, Number(item.availableStock ?? 0))}</strong>
                                </span>
                                <span className={returningQty > 0 ? 'positive' : ''}>
                                  <small>Vuelven</small>
                                  <strong>{returningQty}</strong>
                                </span>
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
                            className="primary-button"
                            onClick={() => addDraftItem(item.id)}
                          >
                            Agregar
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
                        <strong>Seleccionados ({selectedItems.length})</strong>
                        <span>Edita cantidades y precio unitario negociado.</span>
                      </div>
                      {selectedItems.length > 0 ? (
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
                      {selectedItems.length === 0 ? (
                        <p className="status">Aun no agregaste items.</p>
                      ) : (
                        selectedItems.map((line, lineIndex) => {
                          const availability = line.availability;
                          const isProvisionalItem = isDetachedFromInventory(line);
                          const detailParts = getOperationalItemDetails(line);
                          const comboSiblingLines = line.comboLineKey
                            ? selectedItems.filter((entry) => entry.comboLineKey === line.comboLineKey)
                            : [];
                          const isFirstComboLine = Boolean(line.comboLineKey && selectedItems[lineIndex - 1]?.comboLineKey !== line.comboLineKey);
                          const isLastComboLine = Boolean(line.comboLineKey && selectedItems[lineIndex + 1]?.comboLineKey !== line.comboLineKey);
                          const comboGroupTotalBs = comboSiblingLines.reduce((sum, entry) => sum + Number(entry.lineTotalBs ?? 0), 0);
                          const comboGroupUnits = comboSiblingLines.reduce((sum, entry) => sum + Number(entry.quantity ?? 0), 0);
                          const availableStock = Math.max(0, Number(availability?.projectedAvailable ?? line.item.availableStock ?? 0));
                          const requestedForItem = Math.max(0, Number(selectedDemandByItemId.get(line.itemId) ?? line.quantity));
                          const shortageForItem = Math.max(0, requestedForItem - availableStock);
                          const supplierCoverageDraft = supplierFulfillmentDraftByItem[line.itemId] ?? {};
                          const supplierCoveredQty = String(supplierCoverageDraft.supplierId ?? '').trim()
                            ? Math.min(shortageForItem, Math.max(0, Math.trunc(Number(supplierCoverageDraft.neededQty ?? 0))))
                            : 0;
                          const uncoveredForItem = Math.max(0, shortageForItem - supplierCoveredQty);
                          const hasStockShortage = !isProvisionalItem && shortageForItem > 0;
                          const hasUncoveredShortage = !isProvisionalItem && uncoveredForItem > 0;
                          const returningRecords = availability?.returningBeforeStartQtyRecords ?? [];
                          const hardRecords = availability?.hardReservedQtyRecords ?? [];
                          const softRecords = availability?.softReservedQtyRecords ?? [];
                          return (
                          <div
                            key={line.lineKey}
                            className={`orders-selected-row${hasUncoveredShortage ? ' stock-warning' : ''}${line.comboLineKey ? ' is-combo-line' : ' is-standalone-line'}${line.comboPricingRole === 'price' ? ' is-combo-price-line' : ''}`}
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
                              <span className={`orders-selected-origin-badge${line.comboLineKey ? ' is-combo' : ''}`}>
                                {line.comboLineKey ? 'Parte del combo' : 'Item separado'}
                              </span>
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
                                Base: {formatBs(line.item.rentalPriceBs)} c/u
                                {isProvisionalItem ? ' | Pendiente de verificacion' : ''}
                              </p>
                              </div>
                            </div>
                            <label className={`orders-line-field${hasUncoveredShortage ? ' has-error' : ''}`}>
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
                              <div className={`orders-selected-availability${hasUncoveredShortage ? ' is-error' : ''}`}>
                                <span><small>Fecha</small><strong>{availableStock}</strong></span>
                                <span><small>Ahora</small><strong>{Math.max(0, Number(line.item.availableStock ?? 0))}</strong></span>
                              </div>
                              {isProvisionalItem ? (
                                <small className="orders-available-note is-warning">
                                  Item operativo: se guarda y vuelve en la orden, pero aun no descuenta stock.
                                </small>
                              ) : (
                                <small className={`orders-available-note${hasUncoveredShortage ? ' is-error' : ''}`}>
                                  Fecha {availableStock} · ahora {Math.max(0, Number(line.item.availableStock ?? 0))}
                                </small>
                              )}
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
                              {hasUncoveredShortage ? (
                                <small className="orders-stock-error">Faltan {uncoveredForItem}. Coordinar proveedor.</small>
                              ) : null}
                              {hasStockShortage && !hasUncoveredShortage ? (
                                <small className="orders-available-note is-positive">
                                  Faltante cubierto por proveedor: {supplierCoveredQty} u.
                                </small>
                              ) : null}
                            </label>
                            {hasStockShortage ? (
                              <label className="orders-line-field">
                                <span>Proveedor para faltante</span>
                                <select
                                  value={`${supplierFulfillmentDraftByItem[line.itemId]?.supplierQuoteId ?? ''}|${supplierFulfillmentDraftByItem[line.itemId]?.supplierId ?? ''}`}
                                  onChange={(event) => {
                                    const [quoteId, supplierId] = String(event.target.value).split('|');
                                    const offers = supplierOffersByItemId.get(line.itemId) ?? [];
                                    const selectedOffer = offers.find((offer) => (
                                      String(offer.supplierQuoteId ?? '') === quoteId
                                      && String(offer.supplierId ?? '') === supplierId
                                    ));
                                    if (!selectedOffer) {
                                      setSupplierCoverageField(line.itemId, {
                                        supplierId: '',
                                        supplierName: '',
                                        supplierQuoteId: null,
                                        supplierQuoteCode: null,
                                        supplierUnitCostBs: 0,
                                      });
                                      return;
                                    }
                                      setSupplierCoverageField(line.itemId, {
                                        supplierId: selectedOffer.supplierId,
                                        supplierName: selectedOffer.supplierName,
                                        supplierQuoteId: selectedOffer.supplierQuoteId,
                                        supplierQuoteCode: selectedOffer.supplierQuoteCode,
                                        supplierUnitCostBs: selectedOffer.supplierUnitCostBs,
                                        neededQty: Math.max(1, Math.min(
                                        shortageForItem,
                                        Math.trunc(Number(supplierFulfillmentDraftByItem[line.itemId]?.neededQty ?? shortageForItem)),
                                      )),
                                    });
                                  }}
                                >
                                  <option value="">Seleccionar proveedor...</option>
                                  {(supplierOffersByItemId.get(line.itemId) ?? []).map((offer) => (
                                    <option
                                      key={offer.offerKey}
                                      value={`${offer.supplierQuoteId ?? ''}|${offer.supplierId}`}
                                    >
                                      {offer.supplierName} - {formatBs(offer.supplierUnitCostBs)}
                                      {offer.supplierQuoteCode ? ` - ${offer.supplierQuoteCode}` : ''}
                                    </option>
                                  ))}
                                </select>
                                {(supplierOffersByItemId.get(line.itemId) ?? []).length === 0 ? (
                                  <small className="orders-stock-error">
                                    No hay cotizacion de proveedor para este item. Registra precios en Proveedores.
                                  </small>
                                ) : null}
                                <button
                                  type="button"
                                  className="orders-inline-link"
                                  onClick={() => openSupplierCoverageModal(line, availableStock)}
                                >
                                  + Registrar proveedor
                                </button>
                              </label>
                            ) : null}
                            {hasStockShortage ? (
                              <label className="orders-line-field">
                                <span>Cubrir con proveedor</span>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={Math.max(1, Math.trunc(Number(supplierFulfillmentDraftByItem[line.itemId]?.neededQty ?? shortageForItem)))}
                                  onFocus={selectNumericInput}
                                  onChange={(event) => {
                                    const shortage = Math.max(1, shortageForItem);
                                    const nextQty = Math.max(1, Math.min(shortage, Math.trunc(Number(event.target.value || 1))));
                                    setSupplierCoverageField(line.itemId, { neededQty: nextQty });
                                  }}
                                />
                                <small className="orders-available-note">
                                  Faltante total: {shortageForItem} unidades
                                </small>
                              </label>
                            ) : null}
                            {hasStockShortage ? (
                              <label className="orders-line-field">
                                <span>Costo proveedor (Bs)</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={supplierFulfillmentDraftByItem[line.itemId]?.supplierUnitCostBs ?? ''}
                                  onFocus={selectNumericInput}
                                  onChange={(event) => {
                                    const nextValue = cleanDecimalInput(event.target.value);
                                    setSupplierCoverageField(line.itemId, { supplierUnitCostBs: nextValue });
                                  }}
                                />
                              </label>
                            ) : null}
                            <label className="orders-line-field">
                              <span>Precio</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={line.unitPriceInput}
                                onFocus={selectNumericInput}
                                onChange={(event) => setDraftItemPrice(line.lineKey, event.target.value)}
                                onBlur={() => normalizeDraftItemPrice(line.lineKey)}
                                aria-label={`Precio unitario de ${line.item.name}`}
                                readOnly={Boolean(line.comboId && line.comboPricingRole !== 'price')}
                              />
                              {line.comboId && line.comboPricingRole !== 'price' ? (
                                <small className="orders-available-note">Incluido en el precio del combo</small>
                              ) : null}
                            </label>
                            <label className="orders-line-field orders-line-discount">
                              <span>Descuento</span>
                              <select
                                value={String(line.discountPercent ?? 0)}
                                onChange={(event) => setDraftItemDiscountPercent(line.lineKey, event.target.value)}
                              >
                                {[0, 5, 10, 15, 20, 25, 30, 40, 50].map((percent) => (
                                  <option key={percent} value={percent}>{percent}%</option>
                                ))}
                              </select>
                              <small className="orders-available-note">
                                Rebaja: {formatBs(line.lineDiscountBs ?? 0)}
                              </small>
                            </label>
                            <strong>{formatBs(line.lineTotalBs)}</strong>
                            <button
                              type="button"
                              className="danger-button orders-selected-remove"
                              onClick={() => removeDraftItem(line.lineKey)}
                              aria-label={`Quitar ${line.item.name}`}
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                            {isLastComboLine ? (
                              <div className="orders-selected-combo-group-foot">
                                Fin del combo {line.comboName || ''}
                              </div>
                            ) : null}
                          </div>
                          );
                        })
                      )}
                      </div>
                    </section>

                    {selectedServices.length > 0 ? (
                      <section className="orders-services-section">
                        <div className="orders-selected-head">
                          <strong>Servicios asignados ({selectedServices.length})</strong>
                          <span>No descuentan inventario y se cobran una sola vez.</span>
                        </div>
                        <div className="orders-services-list">
                          {selectedServices.map((service) => (
                            <article key={service.id}>
                              <BriefcaseBusiness aria-hidden="true" />
                              <span>
                                <strong>{service.name}</strong>
                                <small>{service.detail || 'Sin detalle adicional'}</small>
                              </span>
                              <span>{service.quantity} x {formatBs(service.unitPriceBs)}</span>
                              <strong>{formatBs(service.lineTotalBs)}</strong>
                              <button
                                type="button"
                                className="orders-service-remove"
                                onClick={() => removeDraftService(service.id)}
                                aria-label={`Quitar servicio ${service.name}`}
                              >
                                <Trash2 aria-hidden="true" />
                              </button>
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
                    <div className="orders-form-grid">
                      <label>
                        {draft.logisticsMode === 'recojo' ? 'Fecha de alistamiento *' : 'Fecha entrega *'}
                        <input type="date" value={draft.deliveryDate} onChange={(event) => setDraftField('deliveryDate', event.target.value)} />
                      </label>
                      <label>
                        Fecha devolucion / recojo *
                        <input type="date" value={draft.pickupDate} onChange={(event) => setDraftField('pickupDate', event.target.value)} />
                      </label>
                      <>
                        <label>
                          {draft.logisticsMode === 'recojo' ? 'Ventana alistamiento inicio' : 'Ventana entrega inicio'}
                          <input type="time" value={draft.deliveryWindowStart} disabled={draft.deliveryTimeMode === 'coordinate'} onChange={(event) => setDraftField('deliveryWindowStart', event.target.value)} />
                        </label>
                        <label>
                          {draft.logisticsMode === 'recojo' ? 'Ventana alistamiento fin' : 'Ventana entrega fin'}
                          <input type="time" value={draft.deliveryWindowEnd} disabled={draft.deliveryTimeMode === 'coordinate'} onChange={(event) => setDraftField('deliveryWindowEnd', event.target.value)} />
                        </label>
                        <label className="orders-time-coordinate">
                          <input
                            type="checkbox"
                            checked={draft.deliveryTimeMode === 'coordinate'}
                            onChange={(event) => setDraftField('deliveryTimeMode', event.target.checked ? 'coordinate' : 'fixed')}
                          />
                          <span>{draft.logisticsMode === 'recojo' ? 'Coordinar horario de alistamiento con el cliente' : 'Coordinar horario de entrega con el cliente'}</span>
                        </label>
                        <label>
                          {draft.logisticsMode === 'recojo' ? 'Ventana devolucion inicio' : 'Ventana recojo inicio'}
                          <input type="time" value={draft.pickupWindowStart} disabled={draft.pickupTimeMode === 'coordinate'} onChange={(event) => setDraftField('pickupWindowStart', event.target.value)} />
                        </label>
                        <label>
                          {draft.logisticsMode === 'recojo' ? 'Ventana devolucion fin' : 'Ventana recojo fin'}
                          <input type="time" value={draft.pickupWindowEnd} disabled={draft.pickupTimeMode === 'coordinate'} onChange={(event) => setDraftField('pickupWindowEnd', event.target.value)} />
                        </label>
                        <label className="orders-time-coordinate">
                          <input
                            type="checkbox"
                            checked={draft.pickupTimeMode === 'coordinate'}
                            onChange={(event) => setDraftField('pickupTimeMode', event.target.checked ? 'coordinate' : 'fixed')}
                          />
                          <span>{draft.logisticsMode === 'recojo' ? 'Coordinar horario de devolucion con el cliente' : 'Coordinar horario de recojo con el cliente'}</span>
                        </label>
                      </>
                      {draft.logisticsMode === 'envio' ? (
                        <>
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
                        </>
                      ) : (
                        <div className="orders-form-note orders-field-span-2">
                          El cliente recoge la orden. Al aprobar, se generara solo la tarea de inventario para alistar y verificar los items.
                        </div>
                      )}
                    </div>

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
                      <label>
                        Descuento general
                        <select value={String(draft.discountPercent ?? 0)} onChange={(event) => setDraftField('discountPercent', event.target.value)}>
                          {[0, 5, 10, 15, 20, 25, 30, 40, 50].map((percent) => (
                            <option key={percent} value={percent}>{percent}%</option>
                          ))}
                        </select>
                        <small>Rebaja: {formatBs(generalDiscountBs)}</small>
                      </label>
                      <label>
                        Garantia (Bs)
                        <input type="number" min="0" step="0.01" value={draft.guaranteeBs} onChange={(event) => setDraftField('guaranteeBs', event.target.value)} />
                      </label>
                      <label>
                        Estado garantia
                        <select value={draft.guaranteeStatus} onChange={(event) => setDraftField('guaranteeStatus', event.target.value)}>
                          <option value="no_validado">No validado</option>
                          <option value="validado">Validado</option>
                        </select>
                      </label>
                      <label>
                        Metodo garantia
                        <select value={draft.guaranteePaymentMethod} onChange={(event) => setDraftField('guaranteePaymentMethod', event.target.value)} disabled={draft.guaranteeStatus !== 'validado'}>
                          <option value="efectivo">Efectivo</option>
                          <option value="qr">QR</option>
                          <option value="transferencia">Transferencia</option>
                        </select>
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
                        </label>
                      ) : null}
                      <label>
                        Pago inicial (Bs)
                        <input type="number" min="0" step="0.01" value={draft.paidAtApprovalBs} onChange={(event) => setDraftField('paidAtApprovalBs', event.target.value)} />
                      </label>
                      <label>
                        Metodo pago inicial
                        <select value={draft.initialPaymentMethod} onChange={(event) => setDraftField('initialPaymentMethod', event.target.value)} disabled={Math.max(0, Number(draft.paidAtApprovalBs ?? 0)) <= 0}>
                          <option value="efectivo">Efectivo</option>
                          <option value="qr">QR</option>
                          <option value="transferencia">Transferencia</option>
                        </select>
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
                      <div className="orders-money-divider" />
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
                        <span>Descuento ({generalDiscountPercent}%)</span>
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
                          return (
                            <div key={line.lineKey} className="orders-side-line">
                              <span>
                                {line.quantity}x {line.item.name} - {formatBs(line.unitPriceBs)} c/u
                                {detailParts.length > 0 ? (
                                  <small className="orders-side-line-details">
                                    {detailParts.map((part) => `${part.label}: ${part.value}`).join(' | ')}
                                  </small>
                                ) : null}
                              </span>
                              <strong>{formatBs(line.lineTotalBs)}</strong>
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
                  <div className={`orders-form-note ${uncoveredStockIssues.length > 0 ? 'orders-form-note-warn' : ''}`}>
                    {uncoveredStockIssues.length > 0
                      ? `Hay ${uncoveredStockIssues.length} item(s) con faltante sin proveedor definido.`
                      : `Faltantes cubiertos por proveedor (${supplierCoverageTotals.totalCoveredQty} u.).`}
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
                  <div className="orders-money-divider" />
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
                    <span>Descuento ({generalDiscountPercent}%)</span>
                    <strong>{formatBs(generalDiscountBs)}</strong>
                  </div>
                  <div className="orders-money-row muted">
                    <span>Garantia</span>
                    <strong>
                      {formatBs(Math.max(0, Number(draft.guaranteeBs ?? 0)))}
                      {Math.max(0, Number(draft.guaranteeBs ?? 0)) > 0 ? ` | ${draft.guaranteeStatus === 'validado' ? 'Validada' : 'No validada'}` : ''}
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
                        ? 'Procesando...'
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
