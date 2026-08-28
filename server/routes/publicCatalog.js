import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { getStateSnapshot, updateStateSnapshot } from '../storage/fileStateStore.js';
import { buildAvailabilityPeriod, getProjectedInventoryAvailability } from '../../src/utils/availability.js';
import { createPublicQuoteAccess } from '../security/publicQuoteAccess.js';

const router = Router();
const publicQuoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PUBLIC_QUOTE_RATE_LIMIT_MAX ?? 8),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Se enviaron demasiadas cotizaciones desde este dispositivo. Intenta nuevamente en unos minutos.' },
});
const DEFAULT_PUBLIC_PHONE = '67402818';

const INVENTORY_AREAS = [
  { id: 'combos', label: 'Combos' },
  { id: 'vajilla', label: 'Vajilla' },
  { id: 'manteleria', label: 'Manteleria' },
  { id: 'mobiliario', label: 'Mobiliario' },
];

const AREA_KEYWORDS = {
  vajilla: [
    'cristaleria', 'cubierto', 'plaquet plastico', 'plaquet vidrio', 'vaso',
    'plato hondo', 'butetero plano', 'jarra', 'juego de te', 'llajuero',
    'charola', 'dispensador', 'hielera', 'pinza', 'panero', 'cenicero',
    'varios', 'chifundi', 'aro',
  ],
  manteleria: [
    'faldon', 'cortina', 'gasa', 'caminito', 'capuchon', 'manteleria',
    'servilleta', 'mona', 'cancan', 'licra', 'muleton', 'mantel',
  ],
  mobiliario: [
    'mesa', 'tapiz', 'cojin', 'modulo', 'silla infantil', 'mesa infantil',
    'lounge', 'sombrilla', 'silla', 'silla coctelera', 'mesa coctelera',
    'calentador', 'panel', 'toldo', 'lona', 'tarima', 'plaquet',
  ],
};

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const resolveInventoryArea = (item) => {
  const assignedArea = normalizeText(item?.inventoryArea);
  if (INVENTORY_AREAS.some((area) => area.id === assignedArea)) return assignedArea;

  const haystack = normalizeText([
    item?.category,
    item?.name,
    item?.itemName,
    item?.description,
  ].filter(Boolean).join(' '));

  for (const area of INVENTORY_AREAS) {
    if ((AREA_KEYWORDS[area.id] ?? []).some((keyword) => haystack.includes(keyword))) {
      return area.id;
    }
  }

  return 'mobiliario';
};

const getProductImageSrc = (item) => {
  for (const field of ['imageUrl', 'imageDataUrl', 'image', 'photo', 'thumbnailUrl']) {
    const value = item?.[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const getPublicContactPhones = (state) => [...new Set([
  state?.settings?.phone,
  ...(Array.isArray(state?.settings?.publicContactPhones) ? state.settings.publicContactPhones : []),
  DEFAULT_PUBLIC_PHONE,
].map((value) => String(value ?? '').replace(/[^\d+]/g, '').trim()).filter(Boolean))];

const buildPublicCatalog = (state) => {
  const stockItems = (Array.isArray(state?.items) ? state.items : [])
    .filter((item) => !item?.deletedAt)
    .filter((item) => String(item?.adoptionSource ?? '').trim() !== 'service_order_quick_item')
    .filter((item) => String(item?.verificationStatus ?? '').trim() !== 'pending_verification')
    .filter((item) => toNumber(item?.totalStock) > 0);
  const stockItemById = new Map(stockItems.map((item) => [String(item?.id ?? ''), item]));

  const products = stockItems
    .map((item) => {
      const area = resolveInventoryArea(item);
      const name = String(item?.name ?? item?.itemName ?? '').trim();
      const category = String(item?.category ?? '').trim();
      const color = String(item?.itemColor ?? item?.color ?? '').trim();
      const material = String(item?.brand ?? item?.material ?? '').trim();
      const sku = String(item?.sku ?? item?.id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase();
      const totalStock = Math.max(0, Math.trunc(toNumber(item?.totalStock)));
      return {
        id: String(item?.id ?? sku).trim(),
        name,
        category,
        color,
        material,
        area,
        areaLabel: INVENTORY_AREAS.find((entry) => entry.id === area)?.label ?? 'Mobiliario',
        sku: sku || 'GEN',
        imageUrl: getProductImageSrc(item),
        totalStock,
        rentalPriceBs: Math.max(0, toNumber(item?.rentalPriceBs)),
        kind: 'product',
        searchText: normalizeText([name, category, color, material, sku, area].join(' ')),
      };
    })
    .filter((item) => item.name);

  const combos = (Array.isArray(state?.inventoryCombos) ? state.inventoryCombos : [])
    .filter((combo) => !combo?.deletedAt)
    .filter((combo) => String(combo?.status ?? 'active') !== 'inactive')
    .map((combo) => {
      const ingredients = (Array.isArray(combo?.ingredients) ? combo.ingredients : [])
        .map((line) => {
          const optionIds = Array.isArray(line?.optionItemIds) && line.optionItemIds.length > 0
            ? line.optionItemIds
            : [line?.itemId];
          const optionItems = optionIds
            .map((id) => stockItemById.get(String(id ?? '')))
            .filter(Boolean);
          const quantity = Math.max(1, Math.trunc(toNumber(line?.quantity ?? 1)));
          const available = optionItems.reduce((sum, item) => sum + toNumber(item?.totalStock), 0);
          return {
            name: String(line?.slotLabel ?? line?.itemName ?? optionItems[0]?.name ?? '').trim(),
            quantity,
            available,
            controlsStock: optionItems.length > 0,
          };
        })
        .filter((line) => line.name);
      const availableCombos = ingredients.reduce((min, line) => {
        if (!line.controlsStock) return min;
        return Math.min(min, Math.floor(line.available / Math.max(1, line.quantity)));
      }, Number.POSITIVE_INFINITY);
      const totalStock = Number.isFinite(availableCombos) ? Math.max(0, availableCombos) : 0;
      const name = String(combo?.name ?? '').trim();
      const category = String(combo?.category ?? 'COMBOS').trim() || 'COMBOS';
      const sku = String(combo?.id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase();
      const ingredientText = ingredients.map((line) => `${line.quantity}x ${line.name}`).join(' + ');
      return {
        id: `combo-${String(combo?.id ?? sku).trim()}`,
        name,
        category,
        color: '',
        material: '',
        area: 'combos',
        areaLabel: 'Combos',
        sku: sku || 'COMBO',
        imageUrl: getProductImageSrc(combo),
        totalStock,
        rentalPriceBs: Math.max(0, toNumber(combo?.rentalPriceBs)),
        kind: 'combo',
        ingredientsCount: ingredients.length,
        detailText: ingredientText,
        searchText: normalizeText([name, category, sku, 'combo combos', ingredientText].join(' ')),
      };
    })
    .filter((combo) => combo.name);

  const catalogItems = [...combos, ...products]
    .sort((left, right) => left.area.localeCompare(right.area, 'es') || left.name.localeCompare(right.name, 'es'));

  const categories = [...new Set(catalogItems.map((item) => item.category).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'es'));

  return {
    updatedAt: new Date().toISOString(),
    products: catalogItems,
    categories,
    areas: INVENTORY_AREAS,
    contactPhones: getPublicContactPhones(state),
  };
};

const dateKeyInBolivia = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const isValidDateKey = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const publicAvailabilityPeriod = (eventDate, eventTime = '12:00') => buildAvailabilityPeriod({
  deliveryDate: eventDate,
  deliveryWindowStart: eventTime,
  pickupDate: eventDate,
  pickupWindowEnd: '23:59',
});

const buildPublicAvailability = (state, eventDate, eventTime = '12:00') => {
  const period = publicAvailabilityPeriod(eventDate, eventTime);
  const availability = getProjectedInventoryAvailability({
    items: Array.isArray(state?.items) ? state.items : [],
    rentals: Array.isArray(state?.rentals) ? state.rentals : [],
    contracts: Array.isArray(state?.contracts) ? state.contracts : [],
    quotes: Array.isArray(state?.quotes) ? state.quotes : [],
    period,
  });
  return [...availability.values()].map((entry) => ({
    itemId: entry.itemId,
    totalStock: entry.totalStock,
    availableConfirmed: entry.projectedAvailable,
    requestedInQuotes: entry.softReservedQty,
    availableAfterRequests: entry.projectedAfterSoftAvailable,
  }));
};

const nextPublicQuoteCode = (state) => {
  state.settings = state.settings && typeof state.settings === 'object' ? state.settings : {};
  state.settings.numbering = state.settings.numbering && typeof state.settings.numbering === 'object'
    ? state.settings.numbering
    : {};
  const numbering = state.settings.numbering;
  const prefix = String(numbering.quotePrefix ?? 'COT-').trim() || 'COT-';
  const maxExisting = (Array.isArray(state.quotes) ? state.quotes : []).reduce((max, quote) => {
    const match = String(quote?.quoteCode ?? '').match(/(\d+)(?!.*\d)/);
    return Math.max(max, Number(match?.[1] ?? 0));
  }, 0);
  const next = Math.max(1, Math.trunc(Number(numbering.quoteNext ?? 1)), maxExisting + 1);
  numbering.quoteNext = next + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
};

const normalizePublicPhone = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('591') && digits.length === 11) return digits.slice(3);
  return digits;
};

const money = (value) => Number(Math.max(0, Number(value ?? 0)).toFixed(2));

const sendPublicCatalog = async (_req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(buildPublicCatalog(snapshot.state ?? {}));
  } catch (error) {
    next(error);
  }
};

router.get('/api/public/catalog', sendPublicCatalog);
router.get('/__copetin_db/public/catalog', sendPublicCatalog);

router.get('/api/public/availability', async (req, res, next) => {
  try {
    const eventDate = String(req.query?.date ?? '').trim();
    const eventTime = String(req.query?.time ?? '12:00').trim();
    if (!isValidDateKey(eventDate)) {
      res.status(400).json({ error: 'Selecciona una fecha válida para consultar disponibilidad.' });
      return;
    }
    const snapshot = await getStateSnapshot();
    const state = snapshot?.state ?? {};
    res.set('Cache-Control', 'private, no-store');
    res.json({
      ok: true,
      eventDate,
      eventTime,
      items: buildPublicAvailability(state, eventDate, eventTime),
      contactPhones: getPublicContactPhones(state),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/api/public/quotes', publicQuoteLimiter, async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const customerName = String(payload.customerName ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
    const customerPhone = normalizePublicPhone(payload.customerPhone);
    const eventDate = String(payload.eventDate ?? '').trim();
    const eventTime = /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(payload.eventTime ?? '').trim())
      ? String(payload.eventTime).trim()
      : '12:00';
    const eventType = String(payload.eventType ?? 'general').trim().slice(0, 60) || 'general';
    const address = String(payload.address ?? '').trim().slice(0, 220);
    const observations = String(payload.observations ?? '').trim().slice(0, 1000);
    const requestedLines = Array.isArray(payload.items) ? payload.items.slice(0, 80) : [];

    if (customerName.length < 3) {
      res.status(400).json({ error: 'Escribe tu nombre completo.' });
      return;
    }
    if (customerPhone.length < 8 || customerPhone.length > 15) {
      res.status(400).json({ error: 'Escribe un número de celular válido para poder contactarte.' });
      return;
    }
    if (!isValidDateKey(eventDate) || eventDate < dateKeyInBolivia()) {
      res.status(400).json({ error: 'Selecciona una fecha de evento válida.' });
      return;
    }
    if (!requestedLines.length) {
      res.status(400).json({ error: 'Agrega al menos un producto a tu cotización.' });
      return;
    }

    const access = createPublicQuoteAccess();
    let created = null;
    let contactPhones = [DEFAULT_PUBLIC_PHONE];
    const result = await updateStateSnapshot((state) => {
      state.items = Array.isArray(state.items) ? state.items : [];
      state.quotes = Array.isArray(state.quotes) ? state.quotes : [];
      contactPhones = getPublicContactPhones(state);
      const itemById = new Map(state.items.filter((item) => !item?.deletedAt).map((item) => [String(item.id), item]));
      const availability = new Map(buildPublicAvailability(state, eventDate, eventTime).map((entry) => [String(entry.itemId), entry]));
      const quantities = new Map();
      requestedLines.forEach((line) => {
        const itemId = String(line?.itemId ?? '').trim();
        const quantity = Math.max(0, Math.trunc(Number(line?.quantity ?? 0)));
        if (!itemId || quantity <= 0) return;
        quantities.set(itemId, Math.min(9999, Number(quantities.get(itemId) ?? 0) + quantity));
      });

      const items = [...quantities.entries()].map(([itemId, quantity], index) => {
        const item = itemById.get(itemId);
        if (!item) {
          const error = new Error('Uno de los productos seleccionados ya no está disponible en el catálogo.');
          error.statusCode = 409;
          throw error;
        }
        const available = Number(availability.get(itemId)?.availableConfirmed ?? 0);
        if (quantity > available) {
          const error = new Error(`Para ${item.name} quedan ${available} unidad(es) disponibles en esa fecha.`);
          error.statusCode = 409;
          throw error;
        }
        const unitPriceBs = money(item.rentalPriceBs);
        const lineTotalBs = money(quantity * unitPriceBs);
        return {
          lineKey: `public-${itemId}-${index + 1}`,
          itemId,
          itemName: String(item.name ?? '').trim(),
          quantity,
          unitPriceBs,
          grossLineTotalBs: lineTotalBs,
          discountPercent: 0,
          discountBs: 0,
          lineTotalBs,
          lineType: '',
          controlsStock: true,
          verificationStatus: item.verificationStatus ?? 'verified',
          observation: '',
          serviceDayId: `day-${eventDate}`,
          serviceDate: eventDate,
          serviceDayLabel: 'Día 1',
        };
      });
      if (!items.length) {
        const error = new Error('Agrega cantidades válidas a la cotización.');
        error.statusCode = 400;
        throw error;
      }

      const subtotalBs = money(items.reduce((sum, line) => sum + line.lineTotalBs, 0));
      const now = new Date().toISOString();
      const quoteCode = nextPublicQuoteCode(state);
      created = {
        id: crypto.randomUUID(),
        quoteCode,
        clientId: null,
        customerName,
        customerCi: '',
        customerPhone,
        customerReferencePhone: '',
        companyName: '',
        eventType,
        eventDate,
        eventTime,
        address,
        city: '',
        deliveryDate: eventDate,
        logisticsMode: 'recojo',
        deliveryChargeMode: 'included',
        deliveryFeeBs: 0,
        deliveryFeeReason: '',
        deliveryWindowStart: eventTime,
        deliveryWindowEnd: eventTime,
        deliveryTimeMode: 'coordinate',
        pickupDate: eventDate,
        pickupWindowStart: '20:00',
        pickupWindowEnd: '23:59',
        pickupDateMode: 'coordinate',
        pickupTimeMode: 'coordinate',
        validUntil: eventDate,
        observations: [
          'SOLICITUD RECIBIDA DESDE EL CATÁLOGO WEB. PENDIENTE DE CONTACTO Y ASIGNACIÓN.',
          'Los precios y cantidades son referenciales hasta confirmar logística, garantía y disponibilidad con el cliente.',
          observations,
        ].filter(Boolean).join('\n'),
        billingMode: 'sin_factura',
        status: 'borrador',
        source: 'public_catalog',
        awaitingAssignment: true,
        publicRequestStatus: 'waiting_contact',
        publicDocumentTokenHash: access.tokenHash,
        pricingPlan: {
          mode: 'simple', days: 1, tiers: [], scheduleDays: [],
          baseSubtotalBs: subtotalBs, theoreticalSubtotalBs: subtotalBs,
          chargeableSubtotalBs: subtotalBs, durationDiscountBs: 0, effectiveMultiplier: 1,
        },
        totals: {
          itemsGrossSubtotalBs: subtotalBs, itemDiscountsBs: 0, itemsNetSubtotalBs: subtotalBs,
          itemsSubtotalBs: subtotalBs, servicesSubtotalBs: 0, baseSubtotalBs: subtotalBs,
          subtotalBs, theoreticalSubtotalBs: subtotalBs, durationDiscountBs: 0,
          discountMode: 'percent', discountBs: 0, discountPercent: 0,
          deliveryFeeBs: 0, guaranteeBs: 0, totalBs: subtotalBs,
        },
        payment: {
          paidAtApprovalBs: 0, pendingBs: subtotalBs, overpaidBs: 0,
          prepaidAppliedBs: 0, initialPaymentMethod: 'efectivo', initialPaymentAccount: '',
          guaranteeStatus: 'no_validado', guaranteePaymentMethod: 'efectivo', guaranteePaymentAccount: '',
        },
        guarantee: { amountBs: 0, status: 'no_validado', paymentMethod: 'efectivo', paymentAccount: '' },
        items,
        services: [],
        supplierFulfillmentPlan: [],
        approvedAt: null,
        rejectedAt: null,
        rentalId: null,
        orderCode: null,
        createdBy: 'Solicitud web',
        createdById: null,
        createdByName: 'Solicitud web',
        createdByRole: 'Cliente web',
        responsibles: [],
        revisionHistory: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      state.quotes.push(created);
      state.systemAuditLog = Array.isArray(state.systemAuditLog) ? state.systemAuditLog : [];
      state.systemAuditLog.unshift({
        id: crypto.randomUUID(), action: 'create', module: 'Cotizaciones', entityType: 'quote',
        entityId: created.id, entityCode: quoteCode,
        title: `Solicitud web ${quoteCode}`,
        detail: `${customerName} | ${customerPhone} | Evento ${eventDate} | Pendiente de contacto`,
        userId: null, userName: 'Catálogo público', userRole: 'Cliente web', createdAt: now,
      });
      return state;
    });

    if (!created || !result?.ok) {
      res.status(503).json({ error: 'No se pudo registrar la cotización en este momento.' });
      return;
    }
    const encodedId = encodeURIComponent(created.id);
    const encodedToken = encodeURIComponent(access.token);
    res.status(201).json({
      ok: true,
      quote: {
        id: created.id,
        quoteCode: created.quoteCode,
        customerName: created.customerName,
        eventDate: created.eventDate,
        totalBs: created.totals.totalBs,
      },
      pdfUrl: `/api/public/quotes/${encodedId}/pdf?token=${encodedToken}`,
      contactPhones,
    });
  } catch (error) {
    if (error?.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

export default router;
