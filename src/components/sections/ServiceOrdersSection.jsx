import { useEffect, useMemo, useRef, useState } from 'react';
import { buildAvailabilityPeriod, getProjectedInventoryAvailability } from '../../utils/availability';

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

const ORDERS_SEEN_STORAGE_KEY = 'copetin-orders-seen-counts-v1';
const CATALOG_PAGE_SIZE = 12;

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

const normalizeWhatsAppNumber = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.length === 8) return `591${digits}`;
  return digits;
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

const getDurationDaysFromTiers = (tiers = []) =>
  normalizeDurationTiers(tiers).reduce(
    (maxDay, tier) => Math.max(maxDay, tier.toDay > 0 ? tier.toDay : tier.fromDay),
    1,
  );

const calculateDurationPricing = ({ mode, days, tiers, baseSubtotalBs }) => {
  const safeBase = Math.max(0, Number(baseSubtotalBs ?? 0));
  const safeMode = mode === 'duration' ? 'duration' : 'simple';
  const normalizedTiers = normalizeDurationTiers(tiers);
  const inferredDays = getDurationDaysFromTiers(normalizedTiers);
  const safeDays = safeMode === 'duration' ? Math.max(parsePositiveInteger(days, 1), inferredDays) : 1;

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
  const rows = (quote?.items ?? []).map((line) => `
    <tr>
      <td>${escapeDocText(line.itemName)}</td>
      <td>${Number(line.quantity ?? 0)}</td>
      <td>${formatBs(Number(line.unitPriceBs ?? 0))}</td>
      <td>${formatBs(Number(line.lineTotalBs ?? 0))}</td>
    </tr>
  `).join('');
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

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
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
          .totals { margin-top: 18px; margin-left: auto; width: 330px; border: 1px solid #eaded4; border-radius: 12px; padding: 12px 14px; }
          .line { display: flex; justify-content: space-between; gap: 16px; padding: 7px 0; color: #5f5047; }
          .line.total { border-top: 1px solid #eaded4; margin-top: 8px; padding-top: 12px; color: #1f1f1f; font-size: 16px; font-weight: 800; }
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
              <strong>${escapeDocText(quote?.quoteCode)}</strong>
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
            <div class="line"><span>Subtotal</span><strong>${formatBs(Number(quote?.totals?.subtotalBs ?? 0))}</strong></div>
            ${hasDuration ? `<div class="line"><span>Promocion duracion</span><strong>${formatBs(Number(quote?.totals?.durationDiscountBs ?? 0))}</strong></div>` : ''}
            <div class="line"><span>Descuento</span><strong>${formatBs(Number(quote?.totals?.discountBs ?? 0))}</strong></div>
            <div class="line"><span>Garantia</span><strong>${formatBs(Number(quote?.totals?.guaranteeBs ?? 0))}</strong></div>
            ${quote?.logisticsMode === 'envio' ? `<div class="line"><span>Envio por equipo</span><strong>${deliveryFeeBs > 0 ? formatBs(deliveryFeeBs) : 'Incluido'}</strong></div>` : ''}
            <div class="line total"><span>Total</span><strong>${formatBs(Number(quote?.totals?.totalBs ?? 0))}</strong></div>
          </section>
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
    clientId: '',
    customerName: '',
    customerPhone: '',
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
    pickupDate,
    pickupWindowStart: '20:00',
    pickupWindowEnd: '22:00',
    driverId: '',
    vehicleId: '',
    discountBs: '0',
    guaranteeBs: '0',
    paidAtApprovalBs: '0',
    pricingMode: 'simple',
    pricingDays: '1',
    pricingTiers: DURATION_PRICING_DEFAULT_TIERS,
    validUntil: pickupDate,
    observations: '',
    items: [],
    supplierFulfillmentPlan: [],
  };
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
  clients = [],
  items = [],
  vehicles = [],
  drivers = [],
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
  onCreateContractFromOrder,
  onApproveContract,
  onGenerateOrderDocuments,
  onOpenTransportModule,
  onOpenInventoryModule,
  onOpenReportsModule,
  onOpenImage,
  onPrintContractDocument,
  onPrintInventoryOrderDocument,
  onPrintRouteSheetDocument,
  canAccessInventory = true,
  canAccessTransport = true,
}) {
  const [activeView, setActiveView] = useState('quotes');
  const [orderFilter, setOrderFilter] = useState('all');
  const [orderQuery, setOrderQuery] = useState('');
  const [quoteFilter, setQuoteFilter] = useState('all');
  const [quoteQuery, setQuoteQuery] = useState('');
  const [contractFilter, setContractFilter] = useState('all');
  const [contractQuery, setContractQuery] = useState('');
  const [seenCounts, setSeenCounts] = useState(readSeenCounts);

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(buildEmptyDraft('quote'));
  const [itemSearch, setItemSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('all');
  const [catalogVisibleCount, setCatalogVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const [formError, setFormError] = useState('');
  const [actionFeedback, setActionFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [documentsOrder, setDocumentsOrder] = useState(null);
  const [quoteToDelete, setQuoteToDelete] = useState(null);
  const [orderToCancel, setOrderToCancel] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [operationalOrder, setOperationalOrder] = useState(null);
  const [operationalDraft, setOperationalDraft] = useState({ inventoryNote: '', transportNote: '' });
  const [documentPreview, setDocumentPreview] = useState(null);
  const [quoteApprovalPreview, setQuoteApprovalPreview] = useState(null);
  const [whatsAppModal, setWhatsAppModal] = useState(null);

  const [menuState, setMenuState] = useState(null);
  const menuRef = useRef(null);
  const [supplierFulfillmentDraftByItem, setSupplierFulfillmentDraftByItem] = useState({});

  useEffect(() => {
    setCatalogVisibleCount(CATALOG_PAGE_SIZE);
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
        orderCode,
        createdAt: rental.createdAt ?? rental.rentalAt,
        responsibleName: rental.createdByName ?? linkedContract?.createdByName ?? rental.createdBy ?? 'Sistema',
        responsibleRole: rental.createdByRole ?? linkedContract?.createdByRole ?? 'Operacion',
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
        accountingStatus,
        pendingPaymentBs,
        pendingCollectionBs,
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
        responsibleName: quote.createdByName ?? quote.userName ?? quote.createdBy ?? 'Sistema',
        responsibleRole: quote.createdByRole ?? quote.userRole ?? 'Operacion',
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
        || normalizeText(row.eventType).includes(text)
      );
    });
  }, [quoteFilter, quoteQuery, quoteRows]);

  const contractRows = useMemo(() => {
    return contracts.map((contract) => {
      const itemsCount = (contract.items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
      const status = CONTRACT_STATUS_META[contract.status] ? contract.status : 'borrador';
      return {
        ...contract,
        status,
        itemsCount,
        responsibleName: contract.createdByName ?? contract.userName ?? contract.createdBy ?? 'Sistema',
        responsibleRole: contract.createdByRole ?? contract.userRole ?? 'Operacion',
        totalBs: Number(contract?.totals?.totalBs ?? 0),
      };
    });
  }, [contracts]);

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
      if (!text) return true;
      return (
        normalizeText(row.contractCode).includes(text)
        || normalizeText(row.customerName).includes(text)
        || normalizeText(row.eventType).includes(text)
        || normalizeText(row.orderCode).includes(text)
      );
    });
  }, [contractQuery, contractRows]);

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
    return documentsByOrderId.get(documentsOrder.id) ?? [];
  }, [documentsByOrderId, documentsOrder]);

  const documentOverviewRows = useMemo(() => {
    if (!documentsOrder) return [];

    const findLatestReport = (sourceType, nameToken) =>
      documentsForSelectedOrder.find((doc) => doc.sourceType === sourceType)
      ?? documentsForSelectedOrder.find((doc) => normalizeText(doc.name).includes(nameToken))
      ?? null;

    const contractReport = findLatestReport('contrato', 'contrato');
    const inventoryReport = findLatestReport('orden_inventario', 'inventario');
    const routeReport = findLatestReport('hoja_ruta', 'ruta');

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
      {
        id: 'route',
        kind: 'route',
        title: `Hoja de ruta ${documentsOrder.orderCode}`,
        description: 'Documento de entrega, recojo y datos de transporte.',
        status: routeReport ? 'Generado' : 'Vista previa',
        statusClass: routeReport ? 'contract-approved' : 'quote-sent',
        generatedAt: routeReport?.generatedAt ?? null,
        format: routeReport?.format ?? 'PDF',
        latestReportId: routeReport?.id ?? null,
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

  const handleMetricClick = (card) => {
    setActiveView(card.view || 'quotes');
    if (card.view === 'quotes') setQuoteFilter(card.filter || 'all');
    if (card.view === 'contracts') setContractFilter(card.filter || 'all');
  };

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
    () => getProjectedInventoryAvailability({
      items,
      rentals,
      contracts,
      quotes,
      period: draftAvailabilityPeriod,
      exclude: {
        recordId: draft.recordId,
        quoteId: draft.quoteId,
        contractId: draft.entityType === 'contract' ? draft.recordId : null,
      },
    }),
    [contracts, draft.entityType, draft.recordId, draft.quoteId, draftAvailabilityPeriod, items, quotes, rentals],
  );

  const selectedItems = useMemo(() => {
    return draft.items
      .map((line) => {
        const item = items.find((entry) => entry.id === line.itemId);
        if (!item) return null;
        const availability = availabilityByItemId.get(line.itemId) ?? null;
        const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
        const unitPriceBs = Math.max(0, Number(line.unitPriceBs ?? item.rentalPriceBs ?? 0));
        return {
          ...line,
          quantity,
          unitPriceBs,
          item,
          availability,
          lineTotalBs: quantity * unitPriceBs,
        };
      })
      .filter(Boolean);
  }, [availabilityByItemId, draft.items, items]);

  const stockIssues = useMemo(
    () => selectedItems.filter((line) => {
      const available = Math.max(0, Number(line.availability?.projectedAvailable ?? line.item.availableStock ?? 0));
      return line.quantity > available;
    }),
    [selectedItems],
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
    () => selectedItems
      .map((line) => {
        const available = Math.max(0, Number(line.availability?.projectedAvailable ?? line.item.availableStock ?? 0));
        const shortageQty = Math.max(0, line.quantity - available);
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
      .filter(Boolean),
    [selectedItems, supplierFulfillmentDraftByItem],
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

  const durationPricing = useMemo(
    () => calculateDurationPricing({
      mode: draft.pricingMode,
      days: draft.pricingDays,
      tiers: draft.pricingTiers,
      baseSubtotalBs: baseItemsSubtotalBs,
    }),
    [baseItemsSubtotalBs, draft.pricingDays, draft.pricingMode, draft.pricingTiers],
  );

  const quoteSubtotalBs = durationPricing.chargeableSubtotalBs;

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

  const quoteTotalBs = useMemo(() => {
    const discount = Math.max(0, Number(draft.discountBs ?? 0));
    return Math.max(0, quoteSubtotalBs - discount + quoteDeliveryFeeBs);
  }, [draft.discountBs, quoteDeliveryFeeBs, quoteSubtotalBs]);

  const pendingAtApprovalBs = useMemo(() => {
    const paid = Math.max(0, Number(draft.paidAtApprovalBs ?? 0));
    return Math.max(0, quoteTotalBs - paid);
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
    () => Array.from(new Set(items.map((item) => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')),
    [items],
  );

  const filteredCatalog = useMemo(() => {
    const text = normalizeText(itemSearch);
    return items
      .filter((item) => {
        if (itemCategoryFilter !== 'all' && item.category !== itemCategoryFilter) return false;
        if (!text) return true;
        return normalizeText(item.name).includes(text) || normalizeText(item.category).includes(text);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [itemCategoryFilter, itemSearch, items]);

  const visibleCatalog = useMemo(
    () => filteredCatalog.slice(0, catalogVisibleCount),
    [catalogVisibleCount, filteredCatalog],
  );
  const remainingCatalogCount = Math.max(0, filteredCatalog.length - visibleCatalog.length);

  const handleOpenProductImage = (item) => {
    if (!item?.imageDataUrl) return;
    onOpenImage?.({
      url: item.imageDataUrl,
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
    clientId: record?.clientId ?? '',
    customerName: record?.customerName ?? '',
    customerPhone: record?.customerPhone ?? '',
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
    pickupDate: record?.pickupDate ?? getInputDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    pickupWindowStart: record?.pickupWindowStart ?? '20:00',
    pickupWindowEnd: record?.pickupWindowEnd ?? '22:00',
    driverId: record?.driverId ?? '',
    vehicleId: record?.vehicleId ?? '',
    discountBs: String(record?.totals?.discountBs ?? 0),
    guaranteeBs: String(record?.totals?.guaranteeBs ?? 0),
    paidAtApprovalBs: String(record?.payment?.paidAtApprovalBs ?? 0),
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
    items: (record?.items ?? []).map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      unitPriceBs: line.unitPriceBs,
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
    setActionFeedback('');
    setFormError('');
    setItemSearch('');
    setItemCategoryFilter('all');
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
    setCurrentStep(0);
    setSupplierFulfillmentDraftByItem({});
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
      const already = current.items.find((line) => line.itemId === itemId);
      if (already) {
        const nextQty = Math.max(1, Number(already.quantity ?? 1) + 1);
        return {
          ...current,
          items: current.items.map((line) => (line.itemId === itemId ? { ...line, quantity: nextQty } : line)),
        };
      }
      return {
        ...current,
        items: [...current.items, { itemId, quantity: 1, unitPriceBs: Number(item.rentalPriceBs ?? 0) }],
      };
    });
  };

  const setDraftItemQuantity = (itemId, quantityValue) => {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    const parsed = Math.max(1, Math.trunc(Number(quantityValue ?? 1)));
    setDraft((current) => ({
      ...current,
      items: current.items.map((line) => (line.itemId === itemId ? { ...line, quantity: parsed } : line)),
    }));
  };

  const removeDraftItem = (itemId) => {
    setDraft((current) => ({ ...current, items: current.items.filter((line) => line.itemId !== itemId) }));
  };

  const setDraftItemPrice = (itemId, value) => {
    const parsed = Math.max(0, Number(value ?? 0));
    setDraft((current) => ({
      ...current,
      items: current.items.map((line) => (line.itemId === itemId ? { ...line, unitPriceBs: parsed } : line)),
    }));
  };

  const setDraftPricingMode = (value) => {
    setDraft((current) => ({
      ...current,
      pricingMode: value === 'duration' ? 'duration' : 'simple',
      pricingDays: String(Math.max(parsePositiveInteger(current.pricingDays, 1), getDurationDaysFromTiers(current.pricingTiers))),
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
        pricingDays: String(Math.max(parsePositiveInteger(current.pricingDays, 1), getDurationDaysFromTiers(nextTiers))),
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

  const getStepValidationMessage = (stepIndex) => {
    if (stepIndex === 0) {
      if (!draft.customerName.trim()) return 'Completa el nombre del cliente para continuar.';
      if (!draft.customerPhone.trim()) return 'Completa el WhatsApp o celular del cliente.';
      return '';
    }
    if (stepIndex === 1) {
      if (!draft.eventType.trim()) return 'Indica el tipo de evento.';
      if (!draft.eventDate) return 'Selecciona la fecha del evento.';
      if (!draft.eventTime) return 'Selecciona la hora del evento.';
      return '';
    }
    if (stepIndex === 2) {
      if (!selectedItems.length) return 'Agrega al menos un item para continuar.';
      if (uncoveredStockIssues.length) {
        const issue = uncoveredStockIssues[0];
        return `${issue.itemName} tiene faltante sin cubrir. Faltan ${issue.uncoveredQty} unidades. Selecciona proveedor o reduce cantidad.`;
      }
      if (draft.pricingMode === 'duration' && parsePositiveInteger(draft.pricingDays, 0) <= 0) {
        return 'Indica cuantos dias de uso se deben cobrar.';
      }
      return '';
    }
    if (stepIndex === 3) {
      if (!draft.deliveryDate) return 'Selecciona fecha de entrega.';
      if (!draft.pickupDate) return 'Selecciona fecha de recojo.';
      if (!isValidSameDayWindow(draft.deliveryWindowStart, draft.deliveryWindowEnd)) {
        return 'La ventana de entrega debe terminar despues de la hora de inicio.';
      }
      if (!isValidSameDayWindow(draft.pickupWindowStart, draft.pickupWindowEnd)) {
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

  const createQuotePayload = () => {
    if (!draft.customerName.trim()) throw new Error('Debes indicar el cliente para la cotizacion.');
    if (!draft.customerPhone.trim()) throw new Error('Debes indicar el WhatsApp o celular del cliente.');
    if (!draft.eventDate) throw new Error('Debes indicar la fecha del evento.');
    if (!draft.deliveryDate) throw new Error('Debes indicar la fecha de entrega.');
    if (!draft.pickupDate) throw new Error('Debes indicar la fecha de recojo.');
    if (!isValidSameDayWindow(draft.deliveryWindowStart, draft.deliveryWindowEnd)) {
      throw new Error('La ventana de entrega debe terminar despues de la hora de inicio.');
    }
    if (!isValidSameDayWindow(draft.pickupWindowStart, draft.pickupWindowEnd)) {
      throw new Error('La ventana de recojo debe terminar despues de la hora de inicio.');
    }
    if (!selectedItems.length) throw new Error('Debes agregar al menos un item.');
    if (uncoveredStockIssues.length) {
      const issue = uncoveredStockIssues[0];
      throw new Error(`${issue.itemName} tiene faltante sin cubrir. Faltan ${issue.uncoveredQty} unidades. Selecciona proveedor o reduce cantidad.`);
    }
    if (draft.logisticsMode === 'envio' && draft.deliveryChargeMode === 'extra' && quoteDeliveryFeeBs <= 0) {
      throw new Error('Indica el costo extra de envio.');
    }

    const paidAtApprovalBs = Math.max(0, Number(draft.paidAtApprovalBs ?? 0));
    if (paidAtApprovalBs > quoteTotalBs) {
      throw new Error('El pago inicial no puede superar el total.');
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

    return {
      id: draft.recordId || undefined,
      quoteId: draft.quoteId || null,
      clientId: draft.clientId || null,
      customerName: draft.customerName.trim(),
      customerPhone: draft.customerPhone.trim(),
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
      pickupDate: draft.pickupDate,
      pickupWindowStart: draft.pickupWindowStart,
      pickupWindowEnd: draft.pickupWindowEnd,
      driverId: draft.driverId || null,
      vehicleId: draft.vehicleId || null,
      validUntil: draft.validUntil || null,
      observations: draft.observations.trim(),
      discountBs: Math.max(0, Number(draft.discountBs ?? 0)),
      guaranteeBs: Math.max(0, Number(draft.guaranteeBs ?? 0)),
      paidAtApprovalBs,
      pricingPlan: quotePricingPlan,
      status: draft.mode === 'order' ? 'enviada' : 'borrador',
      items: selectedItems.map((line) => ({ itemId: line.itemId, quantity: line.quantity, unitPriceBs: line.unitPriceBs })),
      supplierFulfillmentPlan,
      createdBy: 'maria.gonzalez',
    };
  };

  const handleSaveQuote = async ({ approveNow }) => {
    setIsSubmitting(true);
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
      setIsSubmitting(false);
    }
  };

  const handleApproveQuoteClick = async (quote) => {
    setMenuState(null);
    setQuoteApprovalPreview(quote);
  };

  const confirmApproveQuoteClick = async () => {
    if (!quoteApprovalPreview) return;
    const quote = quoteApprovalPreview;
    setIsSubmitting(true);
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
      setIsSubmitting(false);
    }
  };

  const handleRejectQuoteClick = async (quote) => {
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
      setMenuState(null);
    }
  };

  const handleEditQuoteClick = (quote) => {
    setMenuState(null);
    openCreateModal('quote', 'quote', quote);
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
    setIsSubmitting(true);
    setFormError('');
    try {
      await onRemoveQuote?.({ id: quoteToDelete.id });
      setActionFeedback(`Cotizacion ${quoteToDelete.quoteCode} eliminada.`);
      setQuoteToDelete(null);
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo eliminar la cotizacion.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveContractClick = async (contract) => {
    try {
      await onApproveContract?.({ contractId: contract.id });
      setActiveView('contracts');
      setActionFeedback(`Contrato ${contract.contractCode} aprobado.`);
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo aprobar el contrato.');
    } finally {
      setMenuState(null);
    }
  };

  const handleRejectContractClick = async (contract) => {
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
      setMenuState(null);
    }
  };

  const handleDeleteContractClick = async (contract) => {
    try {
      await onRemoveContract?.({ id: contract.id });
      setActionFeedback(`Contrato ${contract.contractCode} eliminado.`);
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo eliminar el contrato.');
    } finally {
      setMenuState(null);
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
    try {
      const contract = await onCreateContractFromOrder?.({ rentalId: orderRow.rentalId, orderCode: orderRow.orderCode });
      if (!contract) {
        throw new Error('No se pudo generar el contrato para esta orden.');
      }
      setActionFeedback(`Contrato ${contract.contractCode ?? contract.id} generado desde ${orderRow.orderCode}.`);
      setContractFilter('all');
      setContractQuery(contract.contractCode ?? orderRow.orderCode);
      setActiveView('contracts');
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo generar el contrato desde la orden.');
    } finally {
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
        preview = await onPrintContractDocument?.({ rentalId: orderRow.rentalId, orderCode: orderRow.orderCode });
      } else if (kind === 'inventory') {
        preview = await onPrintInventoryOrderDocument?.({ rentalId: orderRow.rentalId, orderCode: orderRow.orderCode });
      } else if (kind === 'route') {
        preview = await onPrintRouteSheetDocument?.({ rentalId: orderRow.rentalId, orderCode: orderRow.orderCode });
      }
      if (preview?.html) {
        setDocumentPreview({
          kind,
          orderCode: orderRow.orderCode,
          title: preview.title ?? `${kind === 'contract' ? 'Contrato' : kind === 'inventory' ? 'Orden de inventario' : 'Hoja de ruta'} ${orderRow.orderCode}`,
          html: preview.html,
        });
      }
      setActionFeedback(`Documento ${kind === 'contract' ? 'de contrato' : kind === 'inventory' ? 'de inventario' : 'de ruta'} cargado para ${orderRow.orderCode}.`);
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
    try {
      await onGenerateOrderDocuments({ rentalId: orderRow.rentalId, orderCode: orderRow.orderCode });
      setActionFeedback(`Documentos generados para ${orderRow.orderCode}.`);
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudieron generar los documentos.');
    } finally {
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
    setIsSubmitting(true);
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
        `${target === 'inventory' ? 'Inventario' : 'Transporte'} actualizado para ${orderRow.orderCode}.`,
      );
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo actualizar la orden operativa.');
    } finally {
      setIsSubmitting(false);
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
    setIsSubmitting(true);
    setFormError('');
    try {
      const cancelled = await onCancelOrderContract?.({
        id: orderToCancel.rentalId,
        contractId: orderToCancel.contractId,
        reason: cancelReason,
      });
      const penaltyBs = Number(cancelled?.cancellationPenaltyBs ?? orderToCancel.cancellationPenaltyBs ?? 0);
      setActionFeedback(
        `Contrato/orden ${orderToCancel.orderCode} anulado. Penalidad aplicada: ${formatBs(penaltyBs)}.`,
      );
      setOrderToCancel(null);
      setCancelReason('');
    } catch (requestError) {
      setFormError(requestError.message || 'No se pudo anular el contrato.');
    } finally {
      setIsSubmitting(false);
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
          <h2>Cotizaciones y Contratos</h2>
          <p>Gestion comercial centralizada: cotizaciones, contratos y apertura documental en un solo lugar.</p>
        </div>
        <div className="orders-header-actions">
          <button type="button" className="primary-button orders-new-btn" onClick={() => openCreateModal('order', 'contract')}>
            + Nuevo Contrato
          </button>
          <button type="button" className="ghost-button orders-new-btn" onClick={() => openCreateModal('quote')}>
            + Cotizacion
          </button>
        </div>
      </header>

      <div className={`orders-kpi-grid ${isCommercialCompactView ? 'is-two-up' : ''}`}>
        {metrics.map((card) => (
          <article key={card.label} className={`orders-kpi-card ${card.tone} ${activeView === card.view && (card.filter === 'all' || (card.view === 'orders' && orderFilter === card.filter)) ? 'is-active' : ''}`}>
            <span className={`orders-kpi-icon ${card.tone}`}>
              <OrdersKpiIcon kind={card.icon ?? 'orders'} />
            </span>
            <strong>{card.value}</strong>
            <p>{card.label}</p>
            <button type="button" onClick={() => handleMetricClick(card)}>{card.link} {'->'}</button>
          </article>
        ))}
      </div>

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

        <div className={`orders-view-switch orders-workflow-tabs ${isCommercialCompactView ? 'is-two-up' : ''}`}>
          {workflowTabs.map((tab) => (
            <button
              key={tab.id}
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
                          <p>Ajusta la busqueda o crea una nueva orden para iniciar el flujo operativo.</p>
                          <button type="button" className="primary-button" onClick={() => openCreateModal('order', 'contract')}>
                            + Nueva Orden
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
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

            <div className="orders-table-wrap">
              <table className="orders-table">
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
                            <button type="button" className="orders-open-btn" onClick={() => handleEditQuoteClick(row)}>
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
                          <p>Crea una cotizacion o limpia los filtros para revisar propuestas anteriores.</p>
                          <button type="button" className="primary-button" onClick={() => openCreateModal('quote')}>
                            + Cotizacion
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
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
                <select className="orders-select" value={contractFilter} onChange={(event) => setContractFilter(event.target.value)}>
                  <option value="all">Estado: Todos</option>
                  <option value="borrador">Borrador</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="aprobado">Aprobado</option>
                  <option value="rechazado">Rechazado</option>
                  <option value="anulado">Anulado</option>
                </select>
                <button type="button" className="ghost-button orders-range-btn">Todo el periodo</button>
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
              </div>
            </div>

            <div className="orders-table-wrap">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th>Cliente</th>
                    <th>Evento</th>
                    <th>Responsable</th>
                    <th>Servicio</th>
                    <th>Estado</th>
                    <th>Orden vinculada</th>
                    <th>Total</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContracts.map((row) => {
                    const statusMeta = CONTRACT_STATUS_META[row.status] ?? CONTRACT_STATUS_META.borrador;
                    return (
                      <tr key={row.id} className={`orders-row contract-${row.status}`}>
                        <td>
                          <div className="orders-cell-main">
                            <strong>{row.contractCode}</strong>
                            <span>{row.itemsCount} items | {BILLING_MODE_META[row.billingMode] ?? 'Sin factura'} | {formatDateTime(row.createdAt)}</span>
                          </div>
                        </td>
                        <td>
                          <div className="orders-cell-main">
                            <strong>{row.customerName}</strong>
                            <span>{row.customerPhone || 'Sin WhatsApp/celular'}</span>
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
                            <strong>{[row.deliveryDate, row.pickupDate].filter(Boolean).map(formatDate).join(' - ') || formatDate(row.eventDate)}</strong>
                            <span>Entrega / recojo</span>
                          </div>
                        </td>
                        <td>
                          <span className={`orders-status-badge contract-${statusMeta.className}`}>{statusMeta.label}</span>
                        </td>
                        <td>{row.orderCode || '-'}</td>
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
              {!activeOrderMenuRow.contractId ? (
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
              <button type="button" onClick={() => handleOpenOperationalPanel(activeOrderMenuRow)}>
                Revisar orden operativa
              </button>
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
              <button
                type="button"
                className="danger"
                onClick={() => handleCancelOrderClick(activeOrderMenuRow)}
                disabled={activeOrderMenuRow.status === 'cancelled'}
              >
                {activeOrderMenuRow.status === 'cancelled' ? 'Contrato anulado' : 'Anular contrato'}
              </button>
            </>
          ) : null}

          {menuState.type === 'quote' && activeQuoteMenuRow ? (
            <>
              <button type="button" onClick={() => handleEditQuoteClick(activeQuoteMenuRow)}>
                Editar cotizacion
              </button>
              <button type="button" onClick={() => openWhatsAppModal('quote', activeQuoteMenuRow)}>
                Enviar por WhatsApp
              </button>
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

          {menuState.type === 'contract' && activeContractMenuRow ? (
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
              <button type="button" onClick={() => openWhatsAppModal('contract', activeContractMenuRow)}>
                Enviar por WhatsApp
              </button>
              <button
                type="button"
                onClick={() => handleRejectContractClick(activeContractMenuRow)}
                disabled={activeContractMenuRow.status === 'rechazado' || activeContractMenuRow.status === 'anulado'}
              >
                Marcar rechazado
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => handleCancelContractClick(activeContractMenuRow)}
                disabled={activeContractMenuRow.status === 'anulado'}
              >
                {activeContractMenuRow.status === 'anulado' ? 'Ya anulado' : 'Anular contrato'}
              </button>
              <button
                type="button"
                onClick={() => handleOpenDocumentsFromContract(activeContractMenuRow)}
              >
                Abrir contrato
              </button>
              <button type="button" className="danger" onClick={() => handleDeleteContractClick(activeContractMenuRow)}>
                Eliminar
              </button>
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

      {documentsOrder ? (
        <div className="orders-modal-backdrop" onClick={handleCloseDocumentsPanel}>
          <div className="orders-modal orders-documents-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>Centro documental {documentsOrder.orderCode}</h3>
                <p>Vista unificada de contrato, inventario y ruta. Sin duplicados entre actuales e historial.</p>
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
                  <strong>{documentsForSelectedOrder.length} totales</strong>
                </article>
                <article>
                  <small>Orden vinculada</small>
                  <strong>{documentsOrder.orderCode || 'Pendiente'}</strong>
                </article>
              </section>

              <section className="orders-documents-panel">
                <div className="orders-documents-section-head">
                  <div>
                    <h4>Ordenes de servicio del contrato</h4>
                    <p>Inventario y transporte se gestionan dentro de este contrato.</p>
                  </div>
                </div>

                <div className="orders-documents-service-grid">
                  <button
                    type="button"
                    className="orders-document-service-card"
                    onClick={() => handlePrintOrderDocument('inventory', documentsOrder)}
                  >
                    <span className="orders-document-service-title">Inventario</span>
                    <span className={`orders-status-badge ${OPERATIONAL_STATUS_META[documentsOrder.inventoryStatus ?? 'no_aplica']?.className ?? 'draft'}`}>
                      {OPERATIONAL_STATUS_META[documentsOrder.inventoryStatus ?? 'no_aplica']?.label ?? 'No aplica'}
                    </span>
                    <small>Alistamiento, control y devolucion de items.</small>
                  </button>
                  <button
                    type="button"
                    className="orders-document-service-card"
                    onClick={() => handlePrintOrderDocument('route', documentsOrder)}
                  >
                    <span className="orders-document-service-title">Transporte</span>
                    <span className={`orders-status-badge ${OPERATIONAL_STATUS_META[documentsOrder.transportStatus ?? 'no_aplica']?.className ?? 'draft'}`}>
                      {OPERATIONAL_STATUS_META[documentsOrder.transportStatus ?? 'no_aplica']?.label ?? 'No aplica'}
                    </span>
                    <small>Entrega, ruta y recojo operativo.</small>
                  </button>
                </div>
              </section>

              <section className="orders-documents-panel">
                <div className="orders-documents-section-head">
                  <div>
                    <h4>Documentos actuales</h4>
                    <p>Un bloque por documento operativo. Abre vista previa o imprime desde aqui.</p>
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
              <strong>{orderToCancel.orderCode}</strong>
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

      {modalOpen ? (
        <div className="orders-modal-backdrop" onClick={closeModal}>
          <div className="orders-modal orders-wizard-modal" onClick={(event) => event.stopPropagation()}>
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
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => handleSaveQuote({ approveNow: false })}
                  disabled={isSubmitting || !isLastStep}
                >
                  {draft.entityType === 'contract' ? 'Guardar contrato' : 'Guardar borrador'}
                </button>
                <button type="button" className="orders-modal-close" onClick={closeModal}>x</button>
              </div>
            </header>

            <div className="orders-wizard-steps">
              {QUOTE_WIZARD_STEPS.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  className={`orders-wizard-step ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'done' : ''}`}
                  onClick={() => {
                    if (index <= currentStep) {
                      setFormError('');
                      setCurrentStep(index);
                    }
                  }}
                >
                  <span className="orders-wizard-step-index">{index + 1}</span>
                  <span className="orders-wizard-step-text">
                    <strong>{step.title}</strong>
                    <small>{step.subtitle}</small>
                  </span>
                </button>
              ))}
            </div>

            <div className="orders-modal-body orders-wizard-body">
              <section className="orders-form-panel orders-wizard-main">
                {currentStep === 0 ? (
                  <>
                    <h4>Informacion del cliente</h4>
                    <p className="orders-step-help">Busca un cliente registrado o completa los datos manualmente.</p>
                    <div className="orders-form-grid">
                      <label>
                        Cliente registrado
                        <select value={draft.clientId} onChange={(event) => setClientFromSelection(event.target.value)}>
                          <option value="">Seleccionar...</option>
                          {clients.map((client) => (
                            <option key={client.id} value={client.id}>
                              {client.name}{client.isBlacklisted ? ' - No atender' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Empresa / razon social
                        <input value={draft.companyName} onChange={(event) => setDraftField('companyName', event.target.value)} />
                      </label>
                      <label>
                        Nombre cliente *
                        <input value={draft.customerName} onChange={(event) => setDraftField('customerName', event.target.value)} />
                      </label>
                      <label>
                        WhatsApp / Celular *
                        <input value={draft.customerPhone} onChange={(event) => setDraftField('customerPhone', event.target.value)} />
                      </label>
                      <label>
                        Ciudad
                        <input value={draft.city} onChange={(event) => setDraftField('city', event.target.value)} />
                      </label>
                    </div>
                    <div className="orders-form-note">
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
                    <h4>Informacion del evento</h4>
                    <p className="orders-step-help">
                      {draft.entityType === 'contract'
                        ? 'Define el evento y las fechas operativas del servicio.'
                        : 'Define el evento y la vigencia comercial de la cotizacion.'}
                    </p>
                    <div className="orders-form-grid">
                      <label>
                        Tipo de evento *
                        <input value={draft.eventType} onChange={(event) => setDraftField('eventType', event.target.value)} placeholder="Social, corporativo, boda..." />
                      </label>
                      {draft.entityType !== 'contract' ? (
                        <label>
                          Vigente hasta
                          <input type="date" value={draft.validUntil || ''} onChange={(event) => setDraftField('validUntil', event.target.value)} />
                        </label>
                      ) : null}
                      <label>
                        Fecha evento *
                        <input type="date" value={draft.eventDate} onChange={(event) => setDraftEventDate(event.target.value)} />
                      </label>
                      <label>
                        Hora evento *
                        <input type="time" value={draft.eventTime} onChange={(event) => setDraftField('eventTime', event.target.value)} />
                      </label>
                      {selectedClientAddresses.length > 0 ? (
                        <label className="orders-field-span-2">
                          Seleccionar direccion del cliente
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
                        </label>
                      ) : null}
                      <label className="orders-field-span-2">
                        Direccion del evento
                        <input
                          value={draft.address}
                          onChange={(event) => {
                            setDraftField('addressSource', 'manual');
                            setDraftField('address', event.target.value);
                          }}
                          placeholder="Escribe una direccion o elige una del cliente"
                        />
                      </label>
                    </div>
                  </>
                ) : null}

                {currentStep === 2 ? (
                  <>
                    <h4>{draft.entityType === 'contract' ? 'Items para contrato' : 'Items para cotizacion'}</h4>
                    <p className="orders-step-help">Busca, agrega y ajusta precios por linea sin salir de esta vista.</p>

                    <div className="orders-items-toolbar">
                      <label className="orders-search">
                        <input
                          type="search"
                          placeholder="Buscar por nombre, SKU o categoria..."
                          value={itemSearch}
                          onChange={(event) => setItemSearch(event.target.value)}
                        />
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
                    </div>

                    <section className={`orders-duration-card ${draft.pricingMode === 'duration' ? 'active' : ''}`}>
                      <header className="orders-duration-head">
                        <div>
                          <strong>Tarifa por duracion</strong>
                          <span>Aplica porcentajes por dia sobre el subtotal base negociado.</span>
                        </div>
                        <label>
                          Modo de cobro
                          <select value={draft.pricingMode} onChange={(event) => setDraftPricingMode(event.target.value)}>
                            <option value="simple">Precio unico</option>
                            <option value="duration">Por dias y porcentajes</option>
                          </select>
                        </label>
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
                      ) : (
                        <p className="orders-duration-note">
                          El total usara solo cantidad por precio unitario. Activa el cobro por dias cuando el evento dure varias jornadas.
                        </p>
                      )}
                    </section>

                    <section className="orders-availability-strip" aria-label="Disponibilidad del inventario para estas fechas">
                      <article>
                        <span>Evento objetivo</span>
                        <strong>{formatDate(draft.eventDate)} {draft.eventTime || ''}</strong>
                        <small>Disponibilidad calculada para esta fecha.</small>
                      </article>
                      <article className="returns">
                        <span>Devoluciones consideradas</span>
                        {returnSummaryRows.length > 0 ? (
                          <>
                            <strong>{returnSummaryRows.reduce((sum, row) => sum + row.quantity, 0)} unidades vuelven antes</strong>
                            <div className="orders-return-mini-list">
                              {returnSummaryRows.map((row) => (
                                <small key={row.key}>
                                  {formatDate(row.date)} {row.time || ''} · {row.code} · {row.quantity} u.
                                  {row.itemText ? ` (${row.itemText})` : ''}
                                </small>
                              ))}
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
                      <span>
                        {visibleCatalog.length} visibles de {filteredCatalog.length} productos
                      </span>
                      {remainingCatalogCount > 0 ? (
                        <span>Lista paginada para trabajar comodo con inventarios grandes.</span>
                      ) : null}
                    </div>

                    <div className="orders-product-list">
                      {visibleCatalog.map((item) => {
                        const availability = availabilityByItemId.get(item.id) ?? null;
                        const projectedAvailable = Math.max(0, Number(availability?.projectedAvailable ?? item.availableStock ?? 0));
                        const returningQty = Math.max(0, Number(availability?.returningBeforeStartQty ?? 0));
                        const softQty = Math.max(0, Number(availability?.softReservedQty ?? 0));
                        return (
                        <article key={item.id} className={`orders-product-row${projectedAvailable <= 0 ? ' is-unavailable' : ''}`}>
                          <div className="orders-product-thumb">
                            {item.imageDataUrl ? (
                              <button
                                type="button"
                                className="orders-product-thumb-button"
                                onClick={() => handleOpenProductImage(item)}
                                aria-label={`Ver imagen de ${item.name} en grande`}
                                title="Ver imagen en grande"
                              >
                                <img src={item.imageDataUrl} alt={`Imagen de ${item.name}`} />
                              </button>
                            ) : (
                              <span>IMG</span>
                            )}
                          </div>
                          <div className="orders-product-info">
                            <strong>{item.name}</strong>
                            <span>{item.category || 'Sin categoria'}</span>
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
                          </div>
                          <strong className="orders-product-price">{formatBs(item.rentalPriceBs)}</strong>
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
                      {filteredCatalog.length === 0 ? <p className="status">No hay items para esta busqueda.</p> : null}
                    </div>
                    {remainingCatalogCount > 0 ? (
                      <div className="orders-catalog-actions">
                        <span>
                          Quedan {remainingCatalogCount} productos. Busca por nombre, SKU o categoria para llegar mas rapido.
                        </span>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => setCatalogVisibleCount((count) => count + CATALOG_PAGE_SIZE)}
                        >
                          Mostrar {Math.min(CATALOG_PAGE_SIZE, remainingCatalogCount)} mas
                        </button>
                      </div>
                    ) : null}

                    <section className="orders-selected-section">
                      <div className="orders-selected-head">
                        <strong>Seleccionados ({selectedItems.length})</strong>
                        <span>Cambia cantidad y precio unitario negociado.</span>
                      </div>
                      <div className="orders-selected-list orders-selected-editor">
                      {selectedItems.length === 0 ? (
                        <p className="status">Aun no agregaste items.</p>
                      ) : (
                        selectedItems.map((line) => {
                          const availability = line.availability;
                          const availableStock = Math.max(0, Number(availability?.projectedAvailable ?? line.item.availableStock ?? 0));
                          const isOverAvailable = line.quantity > availableStock;
                          const returningRecords = availability?.returningBeforeStartQtyRecords ?? [];
                          const hardRecords = availability?.hardReservedQtyRecords ?? [];
                          const softRecords = availability?.softReservedQtyRecords ?? [];
                          return (
                          <div key={line.itemId} className={`orders-selected-row${isOverAvailable ? ' stock-warning' : ''}`}>
                            <div>
                              <strong>{line.item.name}</strong>
                              <p>Base: {formatBs(line.item.rentalPriceBs)} c/u</p>
                            </div>
                            <label className={`orders-line-field${isOverAvailable ? ' has-error' : ''}`}>
                              <span>Cant.</span>
                              <input
                                type="number"
                                min="1"
                                value={line.quantity}
                                onChange={(event) => setDraftItemQuantity(line.itemId, event.target.value)}
                                aria-label={`Cantidad de ${line.item.name}`}
                                aria-invalid={isOverAvailable ? 'true' : 'false'}
                              />
                              <div className={`orders-selected-availability${isOverAvailable ? ' is-error' : ''}`}>
                                <span><small>Fecha</small><strong>{availableStock}</strong></span>
                                <span><small>Ahora</small><strong>{Math.max(0, Number(line.item.availableStock ?? 0))}</strong></span>
                              </div>
                              <small className={`orders-available-note${isOverAvailable ? ' is-error' : ''}`}>
                                Fecha {availableStock} · ahora {Math.max(0, Number(line.item.availableStock ?? 0))}
                              </small>
                              {returningRecords.length > 0 ? (
                                <small className="orders-available-note is-positive">
                                  Vuelven antes: {returningRecords.slice(0, 2).map((record) => `${record.quantity} ${record.code || ''} ${formatDate(record.endDate)}`).join(' · ')}
                                </small>
                              ) : null}
                              {hardRecords.length > 0 ? (
                                <small className="orders-available-note">
                                  Cruces: {hardRecords.slice(0, 2).map((record) => `${record.quantity} ${record.code || ''}`).join(' · ')}
                                </small>
                              ) : null}
                              {softRecords.length > 0 ? (
                                <small className="orders-available-note is-warning">
                                  Riesgo blando: {softRecords.slice(0, 2).map((record) => `${record.quantity} ${record.code || ''}`).join(' · ')}
                                </small>
                              ) : null}
                              {isOverAvailable ? (
                                <small className="orders-stock-error">Faltan {line.quantity - availableStock}. Coordinar proveedor.</small>
                              ) : null}
                            </label>
                            {isOverAvailable ? (
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
                                        line.quantity - availableStock,
                                        Math.trunc(Number(supplierFulfillmentDraftByItem[line.itemId]?.neededQty ?? line.quantity - availableStock)),
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
                              </label>
                            ) : null}
                            {isOverAvailable ? (
                              <label className="orders-line-field">
                                <span>Cubrir con proveedor</span>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={Math.max(1, Math.trunc(Number(supplierFulfillmentDraftByItem[line.itemId]?.neededQty ?? (line.quantity - availableStock))))}
                                  onChange={(event) => {
                                    const shortage = Math.max(1, line.quantity - availableStock);
                                    const nextQty = Math.max(1, Math.min(shortage, Math.trunc(Number(event.target.value || 1))));
                                    setSupplierCoverageField(line.itemId, { neededQty: nextQty });
                                  }}
                                />
                                <small className="orders-available-note">
                                  Faltante total: {Math.max(0, line.quantity - availableStock)} unidades
                                </small>
                              </label>
                            ) : null}
                            {isOverAvailable ? (
                              <label className="orders-line-field">
                                <span>Costo proveedor (Bs)</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={Math.max(0, Number(supplierFulfillmentDraftByItem[line.itemId]?.supplierUnitCostBs ?? 0))}
                                  onChange={(event) => {
                                    const nextValue = Math.max(0, Number(event.target.value ?? 0));
                                    setSupplierCoverageField(line.itemId, { supplierUnitCostBs: nextValue });
                                  }}
                                />
                              </label>
                            ) : null}
                            <label className="orders-line-field">
                              <span>Precio</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={line.unitPriceBs}
                                onChange={(event) => setDraftItemPrice(line.itemId, event.target.value)}
                                aria-label={`Precio unitario de ${line.item.name}`}
                              />
                            </label>
                            <strong>{formatBs(line.lineTotalBs)}</strong>
                            <button type="button" className="danger-button" onClick={() => removeDraftItem(line.itemId)}>
                              Quitar
                            </button>
                          </div>
                          );
                        })
                      )}
                      </div>
                    </section>
                  </>
                ) : null}

                {currentStep === 3 ? (
                  <>
                    <h4>Logistica de entrega y recojo</h4>
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
                      {draft.logisticsMode === 'envio' ? (
                        <>
                          <label>
                            Ventana entrega inicio
                            <input type="time" value={draft.deliveryWindowStart} onChange={(event) => setDraftField('deliveryWindowStart', event.target.value)} />
                          </label>
                          <label>
                            Ventana entrega fin
                            <input type="time" value={draft.deliveryWindowEnd} onChange={(event) => setDraftField('deliveryWindowEnd', event.target.value)} />
                          </label>
                          <label>
                            Ventana recojo inicio
                            <input type="time" value={draft.pickupWindowStart} onChange={(event) => setDraftField('pickupWindowStart', event.target.value)} />
                          </label>
                          <label>
                            Ventana recojo fin
                            <input type="time" value={draft.pickupWindowEnd} onChange={(event) => setDraftField('pickupWindowEnd', event.target.value)} />
                          </label>
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
                    <h4>Revision economica y cierre</h4>
                    <p className="orders-step-help">Revisa importes antes de guardar o aprobar la cotizacion.</p>
                    <div className="orders-money-grid">
                      <label>
                        Descuento (Bs)
                        <input type="number" min="0" step="0.01" value={draft.discountBs} onChange={(event) => setDraftField('discountBs', event.target.value)} />
                      </label>
                      <label>
                        Garantia (Bs)
                        <input type="number" min="0" step="0.01" value={draft.guaranteeBs} onChange={(event) => setDraftField('guaranteeBs', event.target.value)} />
                      </label>
                      <label>
                        Pago inicial (Bs)
                        <input type="number" min="0" step="0.01" value={draft.paidAtApprovalBs} onChange={(event) => setDraftField('paidAtApprovalBs', event.target.value)} />
                      </label>
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
                        <span>Descuento</span>
                        <strong>{formatBs(Math.max(0, Number(draft.discountBs ?? 0)))}</strong>
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
                  <span className="orders-status-badge quote-draft">Borrador</span>
                </header>

                <div className="orders-side-context">
                  <article>
                    <span>Cliente</span>
                    <strong>{sideSummaryClient}</strong>
                    <small>{sideSummaryClientMeta}</small>
                  </article>
                  <article>
                    <span>Evento</span>
                    <strong>{sideSummaryEvent}</strong>
                    <small>{sideSummaryEventMeta}</small>
                  </article>
                  <article className="wide">
                    <span>Direccion</span>
                    <strong>{sideSummaryAddress}</strong>
                  </article>
                </div>

                <div className="orders-selected-list compact orders-summary-items">
                  {selectedItems.length === 0 ? (
                    <p className="status">Aun no hay items agregados.</p>
                  ) : (
                    selectedItems.slice(0, 6).map((line) => (
                      <div key={line.itemId} className="orders-side-line">
                        <span>{line.quantity}x {line.item.name} - {formatBs(line.unitPriceBs)} c/u</span>
                        <strong>{formatBs(line.lineTotalBs)}</strong>
                      </div>
                    ))
                  )}
                </div>

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
                    <span>Descuento</span>
                    <strong>{formatBs(Math.max(0, Number(draft.discountBs ?? 0)))}</strong>
                  </div>
                  <div className="orders-money-row muted">
                    <span>Garantia</span>
                    <strong>{formatBs(Math.max(0, Number(draft.guaranteeBs ?? 0)))}</strong>
                  </div>
                  <div className="orders-money-row muted">
                    <span>Pago inicial</span>
                    <strong>{formatBs(Math.max(0, Number(draft.paidAtApprovalBs ?? 0)))}</strong>
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
                    Continuar
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
    </section>
  );
}

export default ServiceOrdersSection;

