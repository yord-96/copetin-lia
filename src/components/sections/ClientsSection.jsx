import { CalendarDays, Clock3, MapPin, Pencil, ReceiptText, Tag } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const initialsFromName = (name) =>
  String(name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

const toneFromIndex = (index) => {
  const tones = ['violet', 'orange', 'blue', 'lilac', 'sand', 'purple', 'green', 'peach', 'mint'];
  return tones[index % tones.length];
};

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
  const url = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message || '')}`;
  window.open(url, '_blank', 'noopener,noreferrer');
};

const escapeDocText = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const getDateKey = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const directDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directDate) return directDate[1];

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${parsed.getFullYear()}-${month}-${day}`;
};

const getTodayDateKey = () => {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
};

const formatCompactBolivianos = (value) => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return 'Bs 0';
  const absolute = Math.abs(amount);
  if (absolute >= 1000000) return `Bs ${(amount / 1000000).toFixed(1).replace('.', ',')}M`;
  if (absolute >= 1000) return `Bs ${(amount / 1000).toFixed(1).replace('.', ',')}k`;
  return `Bs ${Math.round(amount)}`;
};

const getQuoteTimelineLabel = (quote) => {
  const status = normalizeText(quote?.status);
  const validUntil = getDateKey(quote?.validUntil || quote?.eventDate || quote?.deliveryDate);
  const isPast = validUntil && validUntil < getTodayDateKey();

  if (status === 'aprobada') return 'Finalizada';
  if (status === 'rechazada') return 'Rechazada';
  if (status === 'vencida' || isPast) return 'Pasada';
  if (status === 'borrador') return 'Vigente borrador';
  if (status === 'enviada') return 'Vigente enviada';
  return 'Vigente';
};

const getContractTimelineLabel = (contract) => {
  const status = normalizeText(contract?.status);
  const endDate = getDateKey(contract?.pickupDate || contract?.validUntil || contract?.returnDate);
  const isPast = endDate && endDate < getTodayDateKey();

  if (status === 'rechazado') return 'Rechazado';
  if (status === 'borrador') return 'Borrador';
  if (status === 'pendiente') return 'Pendiente';
  if (status === 'aprobado' && isPast) return 'Finalizado';
  if (status === 'aprobado') return 'Vigente';
  return isPast ? 'Pasado' : 'Vigente';
};

const getOrderTimelineLabel = (order) => {
  const status = normalizeText(order?.status);
  const dueDate = getDateKey(order?.dueDate || order?.dueAt || order?.createdAt);
  const isPast = dueDate && dueDate < getTodayDateKey();

  if (status === 'returned' || status === 'completed' || status === 'completada') return 'Finalizada';
  return isPast ? 'Pasada' : 'Vigente';
};

const ORDER_DOCUMENT_META = {
  inventory: { label: 'Inventario', statusFallback: 'pendiente' },
  route: { label: 'Hoja de ruta', statusFallback: 'pendiente' },
};

const BLACKLIST_REASON_LABELS = {
  rude: 'Descortes',
  unpaid: 'No pagaron',
  problematic: 'Problematicos',
  other: 'Otro motivo',
};

const normalizeBlacklistReason = (value) => {
  const normalized = normalizeText(value);
  if (normalized.includes('descortes') || normalized.includes('rude')) return 'rude';
  if (normalized.includes('no pag') || normalized.includes('deuda') || normalized.includes('unpaid')) return 'unpaid';
  if (normalized.includes('proble') || normalized.includes('conflict')) return 'problematic';
  return normalized ? 'other' : 'problematic';
};

const OPERATIONAL_STATUS_LABELS = {
  pendiente: 'Pendiente',
  enviado: 'Enviado',
  confirmado: 'Confirmado',
  no_aplica: 'No aplica',
};

const resolveOperationalStatusLabel = (value, fallback = 'pendiente') => {
  const normalized = normalizeText(value) || fallback;
  return OPERATIONAL_STATUS_LABELS[normalized] || value || OPERATIONAL_STATUS_LABELS[fallback];
};

const buildDeliveryLocationLabel = (rental, delivery = null) => {
  const address =
    delivery?.address
    || rental?.eventAddress
    || rental?.deliveryAddress
    || rental?.address
    || '';
  const city = delivery?.city || rental?.city || '';
  const formatted = [address, city].filter(Boolean).join(' - ').trim();
  return formatted || 'Lugar pendiente';
};

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.04 3.25a8.65 8.65 0 0 0-7.5 12.95L3.5 20.75l4.66-1.02a8.64 8.64 0 1 0 3.88-16.48Zm0 1.74a6.9 6.9 0 0 1 5.84 10.58 6.9 6.9 0 0 1-8.87 2.35l-.3-.16-2.55.56.58-2.48-.18-.32a6.91 6.91 0 0 1 5.48-10.53Zm-2.3 3.52c-.14 0-.36.05-.55.26-.2.22-.72.7-.72 1.72s.74 2  .84 2.14c.1.14 1.43 2.29 3.57 3.12 1.76.7 2.14.56 2.53.52.38-.04 1.24-.5 1.41-.99.18-.48.18-.9.13-.99-.05-.08-.2-.14-.42-.25-.22-.11-1.3-.64-1.5-.71-.2-.08-.35-.12-.5.11-.14.22-.57.72-.7.87-.13.14-.26.16-.48.05-.22-.11-.94-.34-1.78-1.1-.66-.58-1.1-1.3-1.23-1.52-.13-.22-.01-.34.1-.45.1-.1.22-.26.33-.39.11-.13.15-.22.22-.37.07-.14.04-.27-.02-.38-.05-.11-.5-1.22-.69-1.66-.18-.43-.37-.37-.5-.38h-.44Z"
      />
    </svg>
  );
}

const newAddress = () => ({
  id: `addr-${Math.random().toString(36).slice(2, 9)}`,
  label: 'Entrega',
  address: '',
  city: '',
  reference: '',
  isPrimary: true,
});

const getVisibleAddressLabel = (label) =>
  normalizeText(label) === 'principal' ? 'Entrega' : String(label ?? '').trim();

const EMPTY_FORM = {
  id: null,
  customerType: 'persona',
  name: '',
  companyName: '',
  contactName: '',
  contactRole: 'Contacto',
  nitCi: '',
  phone: '',
  whatsapp: '',
  referencePhone: '',
  email: '',
  address: '',
  city: '',
  observations: '',
  isBlacklisted: false,
  blacklistReason: 'problematic',
  blacklistNotes: '',
  prepaidEnabled: false,
  prepaidOpeningBs: '0',
  prepaidTopUpBs: '0',
  prepaidTopUpNotes: '',
  deliveryAddresses: [newAddress()],
  attachments: [],
};

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo adjunto.'));
    reader.readAsDataURL(file);
  });

const parseCsvToClients = (text) => {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('El archivo CSV debe tener cabecera y al menos una fila.');
  }

  const delimiter = lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const headers = lines[0]
    .split(delimiter)
    .map((value) => normalizeText(value).replaceAll(' ', '_'));

  const rows = [];
  for (const line of lines.slice(1)) {
    const values = line.split(delimiter).map((value) => String(value ?? '').trim());
    const payload = {};
    headers.forEach((header, index) => {
      payload[header] = values[index] ?? '';
    });

    const name = payload.nombre || payload.nombre_completo || payload.name || '';
    const phone = payload.telefono || payload.phone || '';
    const referencePhone = payload.telefono_referencia || payload.reference_phone || payload.telefono_alterno || payload.alternate_phone || '';
    const nitCi = payload.nit_ci || payload.nit || payload.ci || '';
    if (!name || !phone || !nitCi) continue;

    const address = payload.direccion || payload.address || '';
    const city = payload.ciudad || payload.city || '';
    const deliveryAddresses = address || city
      ? [{ ...newAddress(), address, city, isPrimary: true }]
      : [];

    rows.push({
      customerType: payload.tipo_cliente || payload.customer_type || 'persona',
      name,
      companyName: payload.razon_social || payload.company_name || payload.empresa || name,
      contactName: payload.contacto || payload.contact_name || name,
      contactRole: payload.cargo_contacto || payload.contact_role || 'Contacto',
      nitCi,
      phone,
      whatsapp: payload.whatsapp || phone,
      referencePhone,
      email: payload.email || '',
      address,
      city,
      observations: payload.observaciones || payload.observation || '',
      isBlacklisted: ['si', 'true', '1', 'lista negra', 'no deseado'].includes(normalizeText(payload.lista_negra || payload.no_deseado || payload.blacklist || '')),
      blacklistReason: normalizeBlacklistReason(payload.motivo_lista_negra || payload.blacklist_reason || ''),
      blacklistNotes: payload.detalle_lista_negra || payload.blacklist_notes || '',
      prepaidEnabled: ['si', 'true', '1', 'prepago', 'especial'].includes(normalizeText(payload.cliente_especial || payload.prepago || payload.prepaid || '')),
      prepaidOpeningBs: Math.max(0, Number(payload.saldo_prepago_bs || payload.prepaid_balance_bs || 0)),
      deliveryAddresses,
      attachments: [],
      status: 'active',
    });
  }

  if (rows.length === 0) {
    throw new Error('No se encontraron filas validas (nombre + telefono + NIT/CI).');
  }

  return rows;
};

const buildCsvFromClients = (rows) => {
  const headers = [
    'tipo_cliente',
    'nombre_completo',
    'razon_social',
    'nit_ci',
    'telefono',
    'whatsapp',
    'telefono_referencia',
    'email',
    'direccion',
    'ciudad',
    'estado',
    'ordenes',
    'ultima_orden',
    'total_facturado_bs',
    'lista_negra',
    'motivo_lista_negra',
    'detalle_lista_negra',
    'cliente_especial',
    'saldo_prepago_bs',
  ];

  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = rows.map((row) => {
    const firstAddress = Array.isArray(row.deliveryAddresses) && row.deliveryAddresses.length > 0
      ? row.deliveryAddresses.find((entry) => entry.isPrimary) ?? row.deliveryAddresses[0]
      : null;

    return [
      row.customerType || '',
      row.name || '',
      row.companyName || '',
      row.nitCi || '',
      row.phone || '',
      row.whatsapp || '',
      row.referencePhone || '',
      row.email || '',
      firstAddress?.address ?? row.address ?? '',
      firstAddress?.city ?? row.city ?? '',
      row.status || '',
      row.ordersCount ?? 0,
      row.lastOrderAt ? String(row.lastOrderAt).slice(0, 10) : '',
      Number(row.totalBilledBs ?? 0).toFixed(2),
      row.isBlacklisted ? 'si' : 'no',
      row.isBlacklisted ? BLACKLIST_REASON_LABELS[row.blacklistReason] ?? row.blacklistReason ?? '' : '',
      row.blacklistNotes ?? '',
      row.prepaidEnabled ? 'si' : 'no',
      Number(row.prepaidBalanceBs ?? 0).toFixed(2),
    ].map(escape).join(',');
  });

  return `${headers.join(',')}\n${lines.join('\n')}`;
};

function CardIcon({ kind }) {
  if (kind === 'customerService') {
    return <img className="asset-icon customer-service-asset-icon" src="/imagenes/agente-de-servicio-al-cliente.png" alt="" aria-hidden="true" />;
  }

  if (kind === 'salesPoint') {
    return <img className="asset-icon sales-point-asset-icon" src="/imagenes/punto-de-venta.png" alt="" aria-hidden="true" />;
  }

  if (kind === 'averageOrders') {
    return <img className="asset-icon average-orders-asset-icon" src="/imagenes/hora.png" alt="" aria-hidden="true" />;
  }

  if (kind === 'newClients') {
    return <img className="asset-icon new-clients-asset-icon" src="/imagenes/demanda.png" alt="" aria-hidden="true" />;
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 7.5v4.8l3 1.8" />
    </svg>
  );
}

function ClientsSection({
  clients = [],
  quotes = [],
  rentals = [],
  contracts = [],
  deliveries = [],
  formatBs,
  formatDate,
  onCreateClient,
  onUpdateClient,
  onSwitchToOrders,
  onPrintContractDocument,
  onPrintInventoryOrderDocument,
  onPrintRouteSheetDocument,
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [rowMenuOpenId, setRowMenuOpenId] = useState(null);
  const [rowMenuPosition, setRowMenuPosition] = useState(null);
  const [modalMode, setModalMode] = useState(null);
  const [clientModalTab, setClientModalTab] = useState('basic');
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [detailClient, setDetailClient] = useState(null);
  const [documentPreview, setDocumentPreview] = useState(null);
  const [documentError, setDocumentError] = useState('');
  const [whatsAppModal, setWhatsAppModal] = useState(null);
  const [importFeedback, setImportFeedback] = useState('');

  const importInputRef = useRef(null);
  const attachmentsInputRef = useRef(null);
  const rowMenuRef = useRef(null);

  const closeRowMenu = useCallback(() => {
    setRowMenuOpenId(null);
    setRowMenuPosition(null);
  }, []);

  useEffect(() => {
    if (!rowMenuOpenId) return undefined;

    const closeOnOutside = (event) => {
      if (rowMenuRef.current && !rowMenuRef.current.contains(event.target)) {
        closeRowMenu();
      }
    };

    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('resize', closeRowMenu);
    window.addEventListener('scroll', closeRowMenu, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('resize', closeRowMenu);
      window.removeEventListener('scroll', closeRowMenu, true);
    };
  }, [closeRowMenu, rowMenuOpenId]);

  const toggleRowMenu = (rowId, event) => {
    if (rowMenuOpenId === rowId) {
      closeRowMenu();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 220;
    const menuHeight = 250;
    const viewportGap = 12;
    const left = Math.max(
      viewportGap,
      Math.min(window.innerWidth - menuWidth - viewportGap, rect.right - menuWidth),
    );
    const opensBelow = rect.bottom + menuHeight + viewportGap <= window.innerHeight;
    const top = opensBelow
      ? rect.bottom + 6
      : Math.max(viewportGap, rect.top - menuHeight - 6);

    setRowMenuOpenId(rowId);
    setRowMenuPosition({ top, left });
  };

  const filteredRows = useMemo(() => {
    const text = String(query ?? '').trim().toLowerCase();
    return clients.filter((client) => {
      const normalizedStatus = String(client.status ?? '').toLowerCase();
      const isActive = normalizedStatus === 'active';
      const statusMatch =
        statusFilter === 'all'
          || (statusFilter === 'active' && isActive)
          || (statusFilter === 'inactive' && !isActive)
          || (statusFilter === 'blacklist' && Boolean(client.isBlacklisted))
          || (statusFilter === 'prepaid' && Boolean(client.prepaidEnabled));
      if (!statusMatch) return false;
      if (!text) return true;
      return (
        String(client.name).toLowerCase().includes(text)
        || String(client.companyName).toLowerCase().includes(text)
        || String(client.contactName).toLowerCase().includes(text)
        || String(client.phone).toLowerCase().includes(text)
        || String(client.referencePhone).toLowerCase().includes(text)
        || String(client.email).toLowerCase().includes(text)
        || String(client.nitCi).toLowerCase().includes(text)
        || String(client.blacklistReason).toLowerCase().includes(text)
        || String(client.blacklistNotes).toLowerCase().includes(text)
      );
    });
  }, [clients, query, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, pageSize]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = useMemo(
    () => filteredRows.slice(pageStart, pageStart + pageSize),
    [filteredRows, pageStart, pageSize],
  );

  const cards = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const activeClients = clients.filter((client) => String(client.status ?? '').toLowerCase() === 'active').length;

    const revenueMonth = rentals
      .filter((rental) => {
        const created = new Date(rental.createdAt ?? rental.rentalAt ?? now.toISOString());
        return created.getMonth() === currentMonth && created.getFullYear() === currentYear;
      })
      .reduce((sum, rental) => sum + Number(rental?.totals?.totalBs ?? 0), 0);

    const newMonth = clients.filter((client) => {
      const created = new Date(client.createdAt ?? now.toISOString());
      return created.getMonth() === currentMonth && created.getFullYear() === currentYear;
    }).length;

    const avgOrders = clients.length > 0
      ? Number(
        (clients.reduce((sum, client) => sum + Number(client.ordersCount ?? 0), 0) / clients.length).toFixed(1),
      )
      : 0;

    return [
      { tone: 'lilac', value: String(activeClients), mobileValue: String(activeClients), label: 'Clientes registrados', mobileLabel: 'Clientes registrados', icon: 'customerService' },
      { tone: 'mint', value: formatBs(revenueMonth), mobileValue: formatCompactBolivianos(revenueMonth), label: 'Generado este mes', mobileLabel: 'Generado mes', icon: 'salesPoint' },
      { tone: 'sky', value: String(avgOrders), mobileValue: String(avgOrders), label: 'Ordenes promedio', mobileLabel: 'Ordenes promedio', icon: 'averageOrders' },
      { tone: 'peach', value: String(newMonth), mobileValue: String(newMonth), label: 'Clientes nuevos este mes', mobileLabel: 'Nuevos este mes', icon: 'newClients' },
    ];
  }, [clients, formatBs, rentals]);

  const getRelatedClientRecords = useCallback((client) => {
    if (!client) return { orders: [], contracts: [], quotes: [], deliveries: [] };

    const clientName = normalizeText(client.name);
    const clientCompany = normalizeText(client.companyName);
    const isSameClientName = (value) => {
      const normalized = normalizeText(value);
      return normalized && (normalized === clientName || normalized === clientCompany);
    };

    const relatedOrders = rentals
      .filter((rental) => {
        if (client.id && rental.clientId && rental.clientId === client.id) return true;
        return isSameClientName(rental.customerName);
      })
      .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));
    const relatedOrderIds = new Set(relatedOrders.map((rental) => String(rental.id ?? '')));
    const relatedOrderCodes = new Set(relatedOrders.map((rental) => String(rental.orderCode ?? '')).filter(Boolean));

    const relatedContracts = contracts
      .filter((contract) => {
        if (client.id && contract.clientId && contract.clientId === client.id) return true;
        if (contract.rentalId && relatedOrderIds.has(String(contract.rentalId))) return true;
        if (contract.orderCode && relatedOrderCodes.has(String(contract.orderCode))) return true;
        return isSameClientName(contract.customerName);
      })
      .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));

    const relatedQuotes = quotes
      .filter((quote) => {
        if (client.id && quote.clientId && quote.clientId === client.id) return true;
        if (quote.rentalId && relatedOrderIds.has(String(quote.rentalId))) return true;
        if (quote.orderCode && relatedOrderCodes.has(String(quote.orderCode))) return true;
        return isSameClientName(quote.customerName);
      })
      .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));

    const relatedDeliveries = deliveries
      .filter((delivery) => {
        if (delivery.rentalId && relatedOrderIds.has(String(delivery.rentalId))) return true;
        if (delivery.orderCode && relatedOrderCodes.has(String(delivery.orderCode))) return true;
        return false;
      })
      .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));

    return { orders: relatedOrders, contracts: relatedContracts, quotes: relatedQuotes, deliveries: relatedDeliveries };
  }, [contracts, deliveries, quotes, rentals]);

  const detailHistory = useMemo(() => {
    if (!detailClient) return null;

    const {
      orders: relatedOrders,
      contracts: relatedContracts,
      quotes: relatedQuotes,
      deliveries: relatedDeliveries,
    } = getRelatedClientRecords(detailClient);

    const deliveriesByOrderKey = new Map();
    relatedDeliveries.forEach((delivery) => {
      const rentalIdKey = String(delivery?.rentalId ?? '').trim();
      const orderCodeKey = String(delivery?.orderCode ?? '').trim();
      if (rentalIdKey && !deliveriesByOrderKey.has(rentalIdKey)) {
        deliveriesByOrderKey.set(rentalIdKey, delivery);
      }
      if (orderCodeKey && !deliveriesByOrderKey.has(orderCodeKey)) {
        deliveriesByOrderKey.set(orderCodeKey, delivery);
      }
    });

    const payments = relatedOrders.map((rental) => {
      const paid = Number(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs ?? 0);
      const pending = Number(rental?.payment?.pendingPaymentBs ?? rental?.totals?.pendingPaymentBs ?? 0);
      return {
        id: `${rental.id}-payment`,
        rentalId: rental.id,
        date: rental.createdAt ?? rental.rentalAt ?? null,
        orderCode: rental.orderCode ?? rental.id,
        paid,
        pending,
        total: Number(rental?.totals?.totalBs ?? 0),
        status: pending > 0 ? 'pendiente' : 'cancelado',
      };
    });

    const serviceOrders = relatedOrders.flatMap((rental) => {
      const rentalIdKey = String(rental?.id ?? '').trim();
      const orderCode = String(rental?.orderCode ?? rental?.id ?? '').trim();
      const linkedDelivery = deliveriesByOrderKey.get(rentalIdKey) ?? deliveriesByOrderKey.get(orderCode) ?? null;
      const locationLabel = buildDeliveryLocationLabel(rental, linkedDelivery);
      const baseOrder = {
        rentalId: rental.id,
        orderCode: orderCode || rental.id,
        date: rental.createdAt ?? rental.rentalAt ?? null,
        total: Number(rental?.totals?.totalBs ?? 0),
        responsibleName: rental.createdByName ?? rental.createdBy ?? 'Sistema',
        responsibleRole: rental.createdByRole ?? 'Operacion',
      };
      const rows = [{
        id: `${rental.id}-inventory`,
        ...baseOrder,
        documentType: 'inventory',
        documentTypeLabel: ORDER_DOCUMENT_META.inventory.label,
        operationStatus: resolveOperationalStatusLabel(rental?.operational?.inventoryStatus, ORDER_DOCUMENT_META.inventory.statusFallback),
        location: locationLabel,
      }];

      if (normalizeText(rental?.logisticsMode ?? 'envio') !== 'recojo') {
        rows.push({
          id: `${rental.id}-route`,
          ...baseOrder,
          documentType: 'route',
          documentTypeLabel: ORDER_DOCUMENT_META.route.label,
          operationStatus: resolveOperationalStatusLabel(rental?.operational?.transportStatus, ORDER_DOCUMENT_META.route.statusFallback),
          location: locationLabel,
        });
      }

      return rows;
    });

    const incidents = [];
    relatedOrders.forEach((rental) => {
      (rental.returnReport ?? []).forEach((line) => {
        const damagedQty = Number(line.damagedQty ?? 0);
        const missingQty = Number(line.missingQty ?? 0);
        if (damagedQty > 0 || missingQty > 0) {
          incidents.push({
            id: `${rental.id}-${line.itemId}`,
            date: rental.returnedAt ?? rental.createdAt ?? null,
            orderCode: rental.orderCode ?? rental.id,
            itemName: line.itemName,
            damagedQty,
            missingQty,
            penaltyBs: Number(line.penaltyBs ?? 0),
          });
        }
      });
    });

    return {
      orders: relatedOrders,
      contracts: relatedContracts,
      quotes: relatedQuotes,
      payments,
      serviceOrders,
      incidents,
      totalFacturedBs: relatedOrders.reduce((sum, rental) => sum + Number(rental?.totals?.totalBs ?? 0), 0),
      totalPaidBs: payments.reduce((sum, payment) => sum + payment.paid, 0),
      totalPendingBs: payments.reduce((sum, payment) => sum + payment.pending, 0),
      totalPenaltyBs: incidents.reduce((sum, incident) => sum + incident.penaltyBs, 0),
    };
  }, [detailClient, getRelatedClientRecords]);

  const openCreateModal = () => {
    setModalMode('create');
    setClientModalTab('basic');
    setForm({ ...EMPTY_FORM, deliveryAddresses: [newAddress()], attachments: [] });
    setFormError('');
  };

  const openEditModal = (client) => {
    setModalMode('edit');
    setClientModalTab('basic');
    const deliveryAddresses =
      Array.isArray(client.deliveryAddresses) && client.deliveryAddresses.length > 0
        ? client.deliveryAddresses.map((entry, index) => ({
          ...entry,
          label: getVisibleAddressLabel(entry.label) || `Entrega ${index + 1}`,
        }))
        : client.address || client.city
          ? [{ ...newAddress(), address: client.address || '', city: client.city || '', isPrimary: true }]
          : [newAddress()];

    setForm({
      id: client.id,
      customerType: client.customerType || 'persona',
      name: client.name || '',
      companyName: client.companyName || '',
      contactName: client.contactName || '',
      contactRole: client.contactRole || 'Contacto',
      nitCi: client.nitCi || '',
      phone: client.phone || '',
      whatsapp: client.whatsapp || '',
      referencePhone: client.referencePhone || '',
      email: client.email || '',
      address: client.address || '',
      city: client.city || '',
      observations: client.observations || '',
      isBlacklisted: Boolean(client.isBlacklisted),
      blacklistReason: client.blacklistReason || 'problematic',
      blacklistNotes: client.blacklistNotes || '',
      prepaidEnabled: Boolean(client.prepaidEnabled),
      prepaidOpeningBs: String(client.prepaidBalanceBs ?? 0),
      prepaidTopUpBs: '0',
      prepaidTopUpNotes: '',
      deliveryAddresses,
      attachments: Array.isArray(client.attachments) ? client.attachments : [],
    });
    setFormError('');
  };

  const closeModal = () => {
    if (isSubmitting) return;
    setModalMode(null);
    setClientModalTab('basic');
    setFormError('');
  };

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const setAddressField = (addressId, key, value) => {
    setForm((current) => ({
      ...current,
      deliveryAddresses: (current.deliveryAddresses ?? []).map((entry) =>
        entry.id === addressId ? { ...entry, [key]: value } : entry
      ),
    }));
  };

  const addAddress = () => {
    setForm((current) => ({
      ...current,
      deliveryAddresses: [...(current.deliveryAddresses ?? []), { ...newAddress(), isPrimary: false, label: 'Entrega' }],
    }));
  };

  const removeAddress = (addressId) => {
    setForm((current) => {
      const remaining = (current.deliveryAddresses ?? []).filter((entry) => entry.id !== addressId);
      if (remaining.length === 0) return { ...current, deliveryAddresses: [newAddress()] };
      if (!remaining.some((entry) => entry.isPrimary)) {
        remaining[0] = { ...remaining[0], isPrimary: true };
      }
      return { ...current, deliveryAddresses: remaining };
    });
  };

  const handleAddAttachments = async (event) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    try {
      const parsed = await Promise.all(
        files.map(async (file) => ({
          id: `att-${Math.random().toString(36).slice(2, 9)}`,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          dataUrl: await fileToDataUrl(file),
          uploadedAt: new Date().toISOString(),
        })),
      );

      setForm((current) => ({
        ...current,
        attachments: [...(current.attachments ?? []), ...parsed],
      }));
    } catch (error) {
      setFormError(error?.message || 'No se pudo adjuntar el archivo.');
    }
  };

  const removeAttachment = (attachmentId) => {
    setForm((current) => ({
      ...current,
      attachments: (current.attachments ?? []).filter((entry) => entry.id !== attachmentId),
    }));
  };

  const validateClient = (payload) => {
    if (!payload.name) {
      return 'El nombre completo es obligatorio.';
    }
    if (!payload.whatsapp) {
      return 'El WhatsApp o celular es obligatorio.';
    }
    if (!payload.nitCi) {
      return payload.customerType === 'empresa'
        ? 'El NIT es obligatorio para cliente empresa.'
        : 'El CI es obligatorio para cliente persona.';
    }
    if (payload.customerType === 'empresa' && !payload.companyName) {
      return 'La razon social es obligatoria para cliente empresa.';
    }
    if (payload.isBlacklisted && !payload.blacklistReason) {
      return 'Selecciona el motivo para marcarlo como cliente no deseado.';
    }
    return '';
  };

  const handleSubmitClient = async (event) => {
    event.preventDefault();
    setFormError('');

    const name = String(form.name ?? '').trim();
    const contactNumber = String(form.whatsapp ?? '').trim() || String(form.phone ?? '').trim();
    const customerType = String(form.customerType ?? 'persona').trim();
    const companyName = customerType === 'empresa'
      ? String(form.companyName ?? '').trim()
      : String(form.companyName ?? '').trim() || name;

    const normalizedAddresses = (form.deliveryAddresses ?? [])
      .map((entry) => ({
        id: entry.id,
        label: String(entry.label ?? '').trim() || 'Entrega',
        address: String(entry.address ?? '').trim(),
        city: String(entry.city ?? '').trim(),
        reference: String(entry.reference ?? '').trim(),
        isPrimary: Boolean(entry.isPrimary),
      }))
      .filter((entry) => entry.address || entry.city);

    if (normalizedAddresses.length > 0 && !normalizedAddresses.some((entry) => entry.isPrimary)) {
      normalizedAddresses[0] = { ...normalizedAddresses[0], isPrimary: true };
    }
    const primaryAddress = normalizedAddresses.find((entry) => entry.isPrimary) ?? normalizedAddresses[0];
    const mainAddress = String(primaryAddress?.address ?? '').trim();
    const mainCity = String(form.city ?? '').trim() || String(primaryAddress?.city ?? '').trim();

    const payload = {
      customerType,
      name,
      companyName,
      contactName: String(form.contactName ?? '').trim() || name,
      contactRole: String(form.contactRole ?? '').trim() || 'Contacto',
      nitCi: String(form.nitCi ?? '').trim(),
      phone: contactNumber,
      whatsapp: contactNumber,
      referencePhone: String(form.referencePhone ?? '').trim(),
      email: String(form.email ?? '').trim().toLowerCase(),
      address: mainAddress,
      city: mainCity,
      observations: String(form.observations ?? '').trim(),
      isBlacklisted: Boolean(form.isBlacklisted),
      blacklistReason: form.isBlacklisted ? String(form.blacklistReason ?? 'problematic').trim() : '',
      blacklistNotes: form.isBlacklisted ? String(form.blacklistNotes ?? '').trim() : '',
      prepaidEnabled: Boolean(form.prepaidEnabled),
      prepaidOpeningBs: modalMode === 'edit' ? 0 : Math.max(0, Number(form.prepaidOpeningBs ?? 0)),
      prepaidTopUpBs: modalMode === 'edit' ? Math.max(0, Number(form.prepaidTopUpBs ?? 0)) : 0,
      prepaidTopUpNotes: String(form.prepaidTopUpNotes ?? '').trim(),
      deliveryAddresses: normalizedAddresses,
      attachments: (form.attachments ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        mimeType: entry.mimeType,
        size: entry.size,
        dataUrl: entry.dataUrl ?? null,
        uploadedAt: entry.uploadedAt ?? new Date().toISOString(),
      })),
    };

    const validationError = validateClient(payload);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      if (modalMode === 'edit' && form.id) {
        await onUpdateClient?.({
          id: form.id,
          ...payload,
        });
      } else {
        await onCreateClient?.({
          ...payload,
          status: 'active',
        });
      }
      closeModal();
    } catch (error) {
      setFormError(error?.message || 'No se pudo guardar el cliente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (client) => {
    const nextStatus = String(client.status ?? '').toLowerCase() === 'active' ? 'inactive' : 'active';
    await onUpdateClient?.({
      id: client.id,
      status: nextStatus,
    });
  };

  const handleToggleBlacklist = async (client) => {
    const nextIsBlacklisted = !client.isBlacklisted;
    await onUpdateClient?.({
      id: client.id,
      isBlacklisted: nextIsBlacklisted,
      blacklistReason: nextIsBlacklisted ? client.blacklistReason || 'problematic' : '',
      blacklistNotes: nextIsBlacklisted ? client.blacklistNotes || '' : '',
    });
  };

  const openDocumentPreview = async ({ type, record }) => {
    setDocumentError('');
    try {
      if (type === 'quote') {
        setDocumentPreview({
          title: `Cotizacion ${record.quoteCode ?? record.id}`,
          html: buildQuoteDocumentHtml(record),
        });
        return;
      }

      const preview =
        type === 'contract'
          ? await onPrintContractDocument?.({
          contractId: record.id,
          rentalId: record.rentalId,
          orderCode: record.orderCode,
        })
          : type === 'route'
            ? await onPrintRouteSheetDocument?.({
              rentalId: record.rentalId,
              orderCode: record.orderCode,
            })
            : await onPrintInventoryOrderDocument?.({
              rentalId: record.rentalId,
              orderCode: record.orderCode,
            });

      if (preview?.html) {
        const defaultTitle =
          type === 'contract'
            ? `Contrato ${record.contractCode ?? record.id}`
            : type === 'route'
              ? `Hoja de ruta ${record.orderCode ?? record.id}`
              : `Orden ${record.orderCode ?? record.id}`;
        setDocumentPreview({
          title: preview.title ?? defaultTitle,
          html: preview.html,
        });
      }
    } catch (error) {
      setDocumentError(error?.message || 'No se pudo abrir el documento seleccionado.');
    }
  };

  const buildClientDocumentOptions = (client) => {
    const history = getRelatedClientRecords(client);
    const options = [
      {
        id: 'general',
        label: 'Mensaje general',
        title: 'Mensaje general',
        description: 'Sin documento seleccionado.',
        recordType: 'general',
        reference: '',
      },
      ...history.quotes.slice(0, 6).map((quote) => {
        const title = `Cotizacion ${quote.quoteCode || quote.id}`;
        const timeline = getQuoteTimelineLabel(quote);
        const validity = quote.validUntil ? `vence ${formatDate(quote.validUntil)}` : 'sin vencimiento';
        return {
          id: `quote-${quote.id}`,
          label: `${title} - ${timeline}`,
          title,
          description: `${quote.eventType || 'Evento'} | ${formatBs(Number(quote?.totals?.totalBs ?? 0))} | ${validity}`,
          recordType: 'quote',
          reference: quote.quoteCode || '',
          record: quote,
        };
      }),
      ...history.contracts.slice(0, 6).map((contract) => {
        const title = `Contrato ${contract.contractCode || contract.id}`;
        const timeline = getContractTimelineLabel(contract);
        const validityDate = contract.validUntil || contract.pickupDate || contract.returnDate;
        const validity = validityDate ? `hasta ${formatDate(validityDate)}` : 'sin vencimiento';
        return {
          id: `contract-${contract.id}`,
          label: `${title} - ${timeline}`,
          title,
          description: `${contract.orderCode || 'Sin orden'} | ${formatBs(Number(contract?.totals?.totalBs ?? 0))} | ${validity}`,
          recordType: 'contract',
          reference: contract.contractCode || contract.orderCode || '',
          record: contract,
        };
      }),
      ...history.orders.slice(0, 6).flatMap((order) => {
        const title = `Orden ${order.orderCode || order.id}`;
        const timeline = getOrderTimelineLabel(order);
        const options = [{
          id: `inventory-${order.id}`,
          label: `${title} - ${timeline}`,
          title,
          description: `${order.items?.length ?? 0} items | ${formatBs(Number(order?.totals?.totalBs ?? 0))}`,
          recordType: 'inventory',
          reference: order.orderCode || '',
          record: order,
        }];
        if (normalizeText(order?.logisticsMode ?? 'envio') !== 'recojo') {
          options.push({
            id: `route-${order.id}`,
            label: `Hoja de ruta ${order.orderCode || order.id} - ${timeline}`,
            title: `Hoja de ruta ${order.orderCode || order.id}`,
            description: 'Entrega y recojo de transporte',
            recordType: 'route',
            reference: order.orderCode || '',
            record: order,
          });
        }
        return options;
      }),
    ];

    return options;
  };

  const openClientWhatsAppModal = (client, preferredDocumentId = 'general') => {
    const documentOptions = buildClientDocumentOptions(client);
    const selectedDocumentId = documentOptions.some((option) => option.id === preferredDocumentId)
      ? preferredDocumentId
      : documentOptions[0]?.id ?? 'general';
    const selectedDocument = documentOptions.find((option) => option.id === selectedDocumentId) ?? documentOptions[0];
    const phone = client.whatsapp || client.phone || '';
    const documentLine = selectedDocument?.reference ? ` sobre ${selectedDocument.title || selectedDocument.label}` : '';
    setWhatsAppModal({
      mode: 'client',
      title: `Contactar a ${client.name}`,
      customerName: client.name,
      phone,
      documentOptions,
      selectedDocumentId,
      message: `Hola ${client.contactName || client.name}, te escribo de El Copetin${documentLine}. Quedo atento a tu confirmacion.`,
      error: '',
    });
    setRowMenuOpenId(null);
  };

  const updateWhatsAppModal = (patch) => {
    setWhatsAppModal((current) => (current ? { ...current, ...patch } : current));
  };

  const updateWhatsAppDocument = (documentId) => {
    setWhatsAppModal((current) => {
      if (!current) return current;
      const selectedDocument = current.documentOptions.find((option) => option.id === documentId);
      const documentLine = selectedDocument?.reference ? ` sobre ${selectedDocument.title || selectedDocument.label}` : '';
      return {
        ...current,
        selectedDocumentId: documentId,
        message: `Hola ${current.customerName}, te escribo de El Copetin${documentLine}. Quedo atento a tu confirmacion.`,
        error: '',
      };
    });
  };

  const sendWhatsAppMessage = () => {
    try {
      openWhatsAppComposer({
        phone: whatsAppModal?.phone,
        message: whatsAppModal?.message,
      });
      setWhatsAppModal(null);
    } catch (error) {
      updateWhatsAppModal({ error: error.message || 'No se pudo abrir WhatsApp.' });
    }
  };

  const buildQuoteDocumentHtml = (quote) => {
    const rows = (quote?.items ?? []).map((line) => `
      <tr>
        <td>${escapeDocText(line.itemName)}</td>
        <td>${escapeDocText(line.quantity)}</td>
        <td>${formatBs(Number(line.unitPriceBs ?? 0))}</td>
        <td>${formatBs(Number(line.lineTotalBs ?? 0))}</td>
      </tr>
    `).join('');

    return `
      <html>
        <head>
          <style>
            body { font-family: Inter, Arial, sans-serif; color: #172554; padding: 32px; }
            h1 { margin: 0 0 6px; color: #0f1f49; }
            .muted { color: #647094; margin: 0 0 24px; }
            .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 18px; }
            .box { border: 1px solid #d8e0ef; padding: 10px; border-radius: 8px; }
            .box strong { display: block; font-size: 11px; text-transform: uppercase; color: #6f7da3; margin-bottom: 4px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border-bottom: 1px solid #e4eaf4; padding: 10px; text-align: left; font-size: 13px; }
            th { background: #f6f8fc; color: #53628e; text-transform: uppercase; font-size: 11px; }
            .total { margin-top: 18px; margin-left: auto; width: 280px; background: #0f1f49; color: #fff; padding: 12px; border-radius: 8px; display: flex; justify-content: space-between; font-weight: 800; }
          </style>
        </head>
        <body>
          <h1>Cotizacion ${escapeDocText(quote?.quoteCode || '')}</h1>
          <p class="muted">Documento comercial para revision del cliente.</p>
          <div class="grid">
            <div class="box"><strong>Cliente</strong>${escapeDocText(quote?.customerName)}</div>
            <div class="box"><strong>WhatsApp</strong>${escapeDocText(quote?.customerPhone)}</div>
            <div class="box"><strong>Evento</strong>${escapeDocText(quote?.eventType)} | ${escapeDocText(formatDate(quote?.eventDate))}</div>
            <div class="box"><strong>Direccion</strong>${escapeDocText(`${quote?.address ?? ''} ${quote?.city ?? ''}`.trim())}</div>
          </div>
          <table>
            <thead><tr><th>Item</th><th>Cant.</th><th>Precio unit.</th><th>Subtotal</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">Sin items registrados.</td></tr>'}</tbody>
          </table>
          <div class="total"><span>Total</span><strong>${formatBs(Number(quote?.totals?.totalBs ?? 0))}</strong></div>
        </body>
      </html>
    `;
  };

  const previewWhatsAppClientDocument = async () => {
    const selectedDocument = whatsAppModal?.documentOptions?.find((option) => option.id === whatsAppModal.selectedDocumentId);
    if (!selectedDocument || selectedDocument.recordType === 'general') {
      updateWhatsAppModal({ error: 'Selecciona una cotizacion, contrato u orden para ver el documento.' });
      return;
    }

    if (selectedDocument.recordType === 'quote') {
      setDocumentPreview({
        title: selectedDocument.title || selectedDocument.label,
        html: buildQuoteDocumentHtml(selectedDocument.record),
      });
      return;
    }

    if (selectedDocument.recordType === 'contract') {
      await openDocumentPreview({ type: 'contract', record: selectedDocument.record });
      return;
    }

    await openDocumentPreview({
      type: selectedDocument.recordType === 'route' ? 'route' : 'inventory',
      record: {
        id: selectedDocument.record?.id,
        rentalId: selectedDocument.record?.id,
        orderCode: selectedDocument.record?.orderCode,
      },
    });
  };

  const printDocumentPreview = () => {
    const frame = document.getElementById('clients-document-preview-frame');
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  };

  const handleExport = () => {
    if (filteredRows.length === 0) {
      setImportFeedback('No hay datos para exportar con los filtros actuales.');
      return;
    }

    const csv = buildCsvFromClients(filteredRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setImportFeedback('Exportacion completada.');
  };

  const handleOpenImport = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImportFeedback('');
    try {
      const text = await file.text();
      const rows = parseCsvToClients(text);

      let success = 0;
      let failed = 0;
      for (const row of rows) {
        try {
          await onCreateClient?.(row);
          success += 1;
        } catch {
          failed += 1;
        }
      }

      setImportFeedback(`Importacion finalizada. Exitosos: ${success}. Fallidos: ${failed}.`);
    } catch (error) {
      setImportFeedback(error?.message || 'No se pudo importar el archivo.');
    }
  };

  const handleGoToOrdersWithClient = (client) => {
    try {
      window.sessionStorage.setItem(
        'copetin_selected_client',
        JSON.stringify({
          id: client.id,
          name: client.name,
          phone: client.phone,
          companyName: client.companyName,
          isBlacklisted: Boolean(client.isBlacklisted),
          blacklistReason: client.blacklistReason || '',
          blacklistNotes: client.blacklistNotes || '',
        }),
      );
    } catch {
      // ignore storage errors
    }
    onSwitchToOrders?.();
  };

  const renderClientModal = () => {
    if (!modalMode) return null;

    const idLabel = form.customerType === 'empresa' ? 'NIT' : 'CI';
    const idPlaceholder = form.customerType === 'empresa' ? 'Ej: 1020304050' : 'Ej: 1234567 LP';
    const tabs = [
      { id: 'basic', label: 'Datos basicos' },
      { id: 'addresses', label: `Direcciones (${(form.deliveryAddresses ?? []).length})` },
      { id: 'documents', label: `Documentos y notas (${(form.attachments ?? []).length})` },
    ];
    const activeTabIndex = tabs.findIndex((tab) => tab.id === clientModalTab);

    return (
      <div className="reset-modal-backdrop" onClick={closeModal}>
        <form
          className="reset-modal clients-create-modal"
          onSubmit={handleSubmitClient}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="clients-modal-head">
            <h3>{modalMode === 'edit' ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
            <p>Completa los datos para registrar y relacionar este cliente con ordenes, pagos y penalidades.</p>
          </div>

          <div className="clients-modal-tabs" role="tablist" aria-label="Secciones del formulario de cliente">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={clientModalTab === tab.id}
                className={`clients-modal-tab ${clientModalTab === tab.id ? 'is-active' : ''}`}
                onClick={() => setClientModalTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="clients-modal-body">
            {clientModalTab === 'basic' ? (
              <div className="clients-basic-panels">
                <div className="clients-form-section clients-form-section-surface">
                  <h4>Identificacion</h4>
                  <div className="clients-create-grid">
                    <label>
                      Tipo de cliente
                      <select value={form.customerType} onChange={(event) => setField('customerType', event.target.value)}>
                        <option value="persona">Persona</option>
                        <option value="empresa">Empresa</option>
                      </select>
                      <small>Define si se facturara como persona natural o empresa.</small>
                    </label>

                    <label>
                      Nombre completo
                      <input value={form.name} onChange={(event) => setField('name', event.target.value)} required />
                      <small>Nombre visible en ordenes y reportes.</small>
                    </label>

                    <label>
                      Razon social
                      <input
                        value={form.companyName}
                        onChange={(event) => setField('companyName', event.target.value)}
                        required={form.customerType === 'empresa'}
                        placeholder={form.customerType === 'empresa' ? 'Razon social obligatoria' : 'Opcional'}
                      />
                      <small>
                        {form.customerType === 'empresa'
                          ? 'Obligatorio para empresas.'
                          : 'Opcional para persona.'}
                      </small>
                    </label>

                    <label>
                      {idLabel}
                      <input
                        value={form.nitCi}
                        onChange={(event) => setField('nitCi', event.target.value)}
                        placeholder={idPlaceholder}
                        required
                      />
                      <small>Campo obligatorio para control documental.</small>
                    </label>
                  </div>
                </div>

                <div className="clients-form-section clients-form-section-surface">
                  <h4>Contacto y comunicacion</h4>
                  <div className="clients-create-grid">
                    <label>
                      Contacto
                      <input value={form.contactName} onChange={(event) => setField('contactName', event.target.value)} />
                      <small>Persona de referencia para coordinacion.</small>
                    </label>

                    <label>
                      Cargo de contacto
                      <input value={form.contactRole} onChange={(event) => setField('contactRole', event.target.value)} />
                      <small>Ejemplo: Compras, Coordinacion, Administracion.</small>
                    </label>

                    <label>
                      WhatsApp / Celular
                      <input
                        value={form.whatsapp || form.phone}
                        onChange={(event) => {
                          setField('whatsapp', event.target.value);
                          setField('phone', event.target.value);
                        }}
                        required
                      />
                      <small>Usado para recordatorios y confirmaciones.</small>
                    </label>

                    <label>
                      Telefono de referencia
                      <input
                        value={form.referencePhone}
                        onChange={(event) => setField('referencePhone', event.target.value)}
                      />
                      <small>Alternativo si el cliente no contesta.</small>
                    </label>

                    <label>
                      Email
                      <input type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} />
                      <small>Se usa para envio de documentos y reportes.</small>
                    </label>

                    <label>
                      Ciudad
                      <input value={form.city} onChange={(event) => setField('city', event.target.value)} />
                      <small>Ciudad del cliente.</small>
                    </label>
                  </div>
                </div>
              </div>
            ) : null}

            {clientModalTab === 'addresses' ? (
              <div className="clients-form-section clients-form-section-surface">
                <div className="clients-section-head">
                  <h4>Direcciones de entrega</h4>
                  <button type="button" className="ghost-button" onClick={addAddress}>+ Agregar direccion</button>
                </div>
                <p className="clients-helper-text">
                  Registra una o varias direcciones donde normalmente se realizan entregas/recojos.
                </p>
                <div className="clients-address-list">
                  {(form.deliveryAddresses ?? []).map((entry, index) => (
                    <article key={entry.id} className="clients-address-card">
                      <div className="clients-address-grid">
                        <label>
                          Etiqueta
                          <input
                            value={getVisibleAddressLabel(entry.label)}
                            onChange={(event) => setAddressField(entry.id, 'label', event.target.value)}
                            placeholder="Ej: Salon Norte"
                          />
                        </label>
                        <label>
                          Ciudad
                          <input
                            value={entry.city}
                            onChange={(event) => setAddressField(entry.id, 'city', event.target.value)}
                          />
                        </label>
                        <label className="clients-create-full">
                          Direccion
                          <input
                            value={entry.address}
                            onChange={(event) => setAddressField(entry.id, 'address', event.target.value)}
                          />
                        </label>
                        <label className="clients-create-full">
                          Referencia
                          <input
                            value={entry.reference}
                            onChange={(event) => setAddressField(entry.id, 'reference', event.target.value)}
                            placeholder="Punto de referencia, piso, puerta, etc."
                          />
                        </label>
                      </div>
                      <div className="clients-address-actions">
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => removeAddress(entry.id)}
                          disabled={(form.deliveryAddresses ?? []).length === 1 && index === 0}
                        >
                          Quitar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            {clientModalTab === 'documents' ? (
              <>
                <div className="clients-form-section clients-form-section-surface">
                  <div className="clients-section-head">
                    <h4>Documentos adjuntos</h4>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => attachmentsInputRef.current?.click()}
                    >
                      + Adjuntar archivo
                    </button>
                  </div>
                  <p className="clients-helper-text">
                    Puedes adjuntar CI/NIT, contrato marco u otros documentos de referencia.
                  </p>
                  <input
                    ref={attachmentsInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                    hidden
                    multiple
                    onChange={handleAddAttachments}
                  />
                  <ul className="clients-attachments-list">
                    {(form.attachments ?? []).map((entry) => (
                      <li key={entry.id}>
                        <div>
                          <strong>{entry.name}</strong>
                          <small>{entry.mimeType || 'archivo'} | {Math.round(Number(entry.size ?? 0) / 1024)} KB</small>
                        </div>
                        <button type="button" className="link-button" onClick={() => removeAttachment(entry.id)}>
                          Quitar
                        </button>
                      </li>
                    ))}
                    {(form.attachments ?? []).length === 0 ? (
                      <li className="empty">Sin documentos adjuntos.</li>
                    ) : null}
                  </ul>
                </div>

                <div className="clients-form-section clients-form-section-surface">
                  <h4>Observaciones</h4>
                  <label className="clients-create-full">
                    Notas internas
                    <textarea
                      value={form.observations}
                      onChange={(event) => setField('observations', event.target.value)}
                      placeholder="Condiciones especiales, preferencias del cliente, etc."
                    />
                  </label>
                </div>

                <div className={`clients-form-section clients-form-section-surface clients-blacklist-section ${form.isBlacklisted ? 'is-alert' : ''}`}>
                  <div className="clients-section-head">
                    <h4>Lista negra</h4>
                    <label className="clients-switch-control">
                      <input
                        type="checkbox"
                        checked={Boolean(form.isBlacklisted)}
                        onChange={(event) => setForm((current) => ({
                          ...current,
                          isBlacklisted: event.target.checked,
                          blacklistReason: event.target.checked ? current.blacklistReason || 'problematic' : '',
                          blacklistNotes: event.target.checked ? current.blacklistNotes : '',
                        }))}
                      />
                      <span>Cliente no deseado</span>
                    </label>
                  </div>
                  <p className="clients-helper-text">
                    Marca clientes que no conviene atender por mal trato, deudas o problemas recurrentes.
                  </p>
                  {form.isBlacklisted ? (
                    <div className="clients-create-grid">
                      <label>
                        Motivo
                        <select value={form.blacklistReason || 'problematic'} onChange={(event) => setField('blacklistReason', event.target.value)}>
                          <option value="rude">Descortes</option>
                          <option value="unpaid">No pagaron</option>
                          <option value="problematic">Problematicos</option>
                          <option value="other">Otro motivo</option>
                        </select>
                      </label>
                      <label className="clients-create-full">
                        Detalle interno
                        <textarea
                          value={form.blacklistNotes}
                          onChange={(event) => setField('blacklistNotes', event.target.value)}
                          placeholder="Ej: no pago saldo, trato descortes al equipo, problemas en devolucion..."
                        />
                      </label>
                    </div>
                  ) : null}
                </div>

                <div className={`clients-form-section clients-form-section-surface clients-prepaid-section ${form.prepaidEnabled ? 'is-active' : ''}`}>
                  <div className="clients-section-head">
                    <h4>Cuenta prepago</h4>
                    <label className="clients-switch-control">
                      <input
                        type="checkbox"
                        checked={Boolean(form.prepaidEnabled)}
                        onChange={(event) => setForm((current) => ({
                          ...current,
                          prepaidEnabled: event.target.checked,
                        }))}
                      />
                      <span>Cliente especial</span>
                    </label>
                  </div>
                  <p className="clients-helper-text">
                    Usa esta cuenta para clientes que dejan dinero por adelantado y luego consumen eventos contra ese saldo.
                  </p>
                  {form.prepaidEnabled ? (
                    <div className="clients-create-grid">
                      {modalMode === 'edit' ? (
                        <>
                          <div className="clients-prepaid-current">
                            <small>Saldo disponible</small>
                            <strong>{formatBs(Number(form.prepaidOpeningBs ?? 0))}</strong>
                          </div>
                          <label>
                            Registrar nuevo abono (Bs)
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={form.prepaidTopUpBs}
                              onChange={(event) => setField('prepaidTopUpBs', event.target.value)}
                            />
                          </label>
                          <label className="clients-create-full">
                            Nota del abono
                            <input
                              value={form.prepaidTopUpNotes}
                              onChange={(event) => setField('prepaidTopUpNotes', event.target.value)}
                              placeholder="Ej: abono para eventos del semestre"
                            />
                          </label>
                        </>
                      ) : (
                        <label>
                          Saldo inicial recibido (Bs)
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={form.prepaidOpeningBs}
                            onChange={(event) => setField('prepaidOpeningBs', event.target.value)}
                          />
                        </label>
                      )}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          {formError ? <p className="status error reset-modal-error">{formError}</p> : null}
          <div className="reset-modal-actions clients-modal-actions">
            <div className="clients-modal-step-nav">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setClientModalTab(tabs[Math.max(0, activeTabIndex - 1)].id)}
                disabled={activeTabIndex <= 0}
              >
                Anterior
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setClientModalTab(tabs[Math.min(tabs.length - 1, activeTabIndex + 1)].id)}
                disabled={activeTabIndex >= tabs.length - 1}
              >
                Siguiente
              </button>
            </div>
            <div className="clients-modal-submit-actions">
              <button type="button" className="ghost-button" onClick={closeModal} disabled={isSubmitting}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isSubmitting}>
                {isSubmitting ? 'Guardando...' : modalMode === 'edit' ? 'Guardar cambios' : 'Guardar cliente'}
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  };

  const renderDetailModal = () => {
    if (!detailClient || !detailHistory) return null;

    const addresses = Array.isArray(detailClient.deliveryAddresses) ? detailClient.deliveryAddresses : [];
    const attachments = Array.isArray(detailClient.attachments) ? detailClient.attachments : [];
    const contractStatusLabels = {
      borrador: 'Borrador',
      pendiente: 'Pendiente',
      aprobado: 'Aprobado',
      rechazado: 'Rechazado',
    };

    return (
      <div className="reset-modal-backdrop" onClick={() => setDetailClient(null)}>
        <section className="reset-modal clients-detail-modal" onClick={(event) => event.stopPropagation()}>
          <div className="clients-detail-head">
            <div>
              <h3>{detailClient.name}</h3>
              <p>{detailClient.companyName || 'Sin razon social'}</p>
            </div>
            <button type="button" className="whatsapp-send-button compact" onClick={() => openClientWhatsAppModal(detailClient)}>
              <WhatsAppGlyph />
              Contactar
            </button>
          </div>
          {detailClient.isBlacklisted ? (
            <div className="clients-blacklist-alert">
              <strong>No atender: {BLACKLIST_REASON_LABELS[detailClient.blacklistReason] ?? 'Revisar cliente'}</strong>
              <span>{detailClient.blacklistNotes || 'Cliente marcado en lista negra.'}</span>
            </div>
          ) : null}
          {detailClient.prepaidEnabled ? (
            <div className="clients-prepaid-alert">
              <div>
                <strong>Cliente especial con saldo prepago</strong>
                <span>Disponible: {formatBs(Number(detailClient.prepaidBalanceBs ?? 0))}</span>
              </div>
              <button type="button" className="ghost-button" onClick={() => openEditModal(detailClient)}>
                Registrar abono
              </button>
            </div>
          ) : null}
          {documentError ? <p className="status error clients-document-error">{documentError}</p> : null}

          <div className="clients-detail-kpis">
            <article>
              <small>Ordenes</small>
              <strong>{detailHistory.orders.length}</strong>
            </article>
            <article>
              <small>Contratos</small>
              <strong>{detailHistory.contracts.length}</strong>
            </article>
            <article>
              <small>Cotizaciones</small>
              <strong>{detailHistory.quotes.length}</strong>
            </article>
            <article>
              <small>Ingreso</small>
              <strong>{formatBs(detailHistory.totalFacturedBs)}</strong>
            </article>
            <article>
              <small>Total pagado</small>
              <strong>{formatBs(detailHistory.totalPaidBs)}</strong>
            </article>
            <article>
              <small>Penalidades</small>
              <strong>{formatBs(detailHistory.totalPenaltyBs)}</strong>
            </article>
            {detailClient.prepaidEnabled ? (
              <article>
                <small>Saldo prepago</small>
                <strong>{formatBs(Number(detailClient.prepaidBalanceBs ?? 0))}</strong>
              </article>
            ) : null}
          </div>

          <div className="clients-detail-columns">
            <article className="clients-detail-card">
              <h4>Datos de contacto</h4>
              <ul>
                <li>Tipo: {detailClient.customerType || 'persona'}</li>
                <li>NIT/CI: {detailClient.nitCi || '-'}</li>
                <li>WhatsApp / Celular: {detailClient.whatsapp || detailClient.phone || '-'}</li>
                <li>Telefono de referencia: {detailClient.referencePhone || '-'}</li>
                <li>Email: {detailClient.email || '-'}</li>
                <li>Ciudad: {detailClient.city || '-'}</li>
              </ul>
            </article>

            <article className="clients-detail-card">
              <h4>Resumen de pagos</h4>
              <ul>
                <li>Pagado: {formatBs(detailHistory.totalPaidBs)}</li>
                <li>Pendiente: {formatBs(detailHistory.totalPendingBs)}</li>
                {detailClient.prepaidEnabled ? <li>Prepago disponible: {formatBs(Number(detailClient.prepaidBalanceBs ?? 0))}</li> : null}
                <li>Estado: {detailHistory.totalPendingBs > 0 ? 'Con saldo pendiente' : 'Al dia'}</li>
              </ul>
            </article>
          </div>

          {detailClient.prepaidEnabled ? (
            <article className="clients-detail-table-card">
              <h4>Movimientos de cuenta prepago</h4>
              <div className="clients-detail-table-wrap">
                <table className="clients-detail-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Detalle</th>
                      <th>Monto</th>
                      <th>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailClient.prepaidMovements ?? []).slice().reverse().map((movement) => (
                      <tr key={movement.id}>
                        <td>{formatDate(movement.createdAt)}</td>
                        <td>{movement.type === 'charge' ? 'Consumo' : 'Abono'}</td>
                        <td>{movement.description || movement.orderCode || '-'}</td>
                        <td>{formatBs(Number(movement.amountBs ?? 0))}</td>
                        <td>{formatBs(Number(movement.balanceAfterBs ?? 0))}</td>
                      </tr>
                    ))}
                    {(detailClient.prepaidMovements ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={5}>Sin movimientos prepago.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </article>
          ) : null}

          <article className="clients-detail-table-card">
            <h4>Direcciones de entrega</h4>
            <div className="clients-detail-table-wrap">
              <table className="clients-detail-table">
                <thead>
                  <tr>
                    <th>Etiqueta</th>
                    <th>Direccion</th>
                    <th>Ciudad</th>
                    <th>Referencia</th>
                  </tr>
                </thead>
                <tbody>
                  {addresses.map((entry) => (
                    <tr key={entry.id}>
                      <td>{getVisibleAddressLabel(entry.label) || '-'}</td>
                      <td>{entry.address || '-'}</td>
                      <td>{entry.city || '-'}</td>
                      <td>{entry.reference || '-'}</td>
                    </tr>
                  ))}
                  {addresses.length === 0 ? (
                    <tr>
                      <td colSpan={4}>Sin direcciones de entrega registradas.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>

          <article className="clients-detail-table-card">
            <h4>Documentos adjuntos</h4>
            <div className="clients-detail-table-wrap">
              <table className="clients-detail-table">
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Tipo</th>
                    <th>Tamano</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {attachments.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.name}</td>
                      <td>{entry.mimeType || '-'}</td>
                      <td>{Math.round(Number(entry.size ?? 0) / 1024)} KB</td>
                      <td>{entry.uploadedAt ? formatDate(entry.uploadedAt) : '-'}</td>
                    </tr>
                  ))}
                  {attachments.length === 0 ? (
                    <tr>
                      <td colSpan={4}>Sin documentos adjuntos.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>

          <article className="clients-detail-table-card">
            <h4>Cotizaciones</h4>
            <div className="clients-detail-table-wrap">
              <table className="clients-detail-table">
                <thead>
                  <tr>
                    <th>Cotizacion</th>
                    <th>Estado</th>
                    <th>Evento</th>
                    <th>Vigencia</th>
                    <th>Responsable</th>
                    <th>Total</th>
                    <th>Contacto</th>
                  </tr>
                </thead>
                <tbody>
                  {detailHistory.quotes.slice(0, 8).map((quote) => (
                    <tr key={quote.id}>
                      <td>
                        <button
                          type="button"
                          className="clients-document-link"
                          onClick={() => openDocumentPreview({ type: 'quote', record: quote })}
                        >
                          {quote.quoteCode || quote.id}
                        </button>
                      </td>
                      <td>{quote.status || '-'}</td>
                      <td>{quote.eventType || '-'}</td>
                      <td>{quote.validUntil ? formatDate(quote.validUntil) : '-'}</td>
                      <td>
                        <span className="clients-responsible-pill">
                          {quote.createdByName ?? quote.createdBy ?? 'Sistema'} · {quote.createdByRole ?? 'Operacion'}
                        </span>
                      </td>
                      <td>{formatBs(Number(quote?.totals?.totalBs ?? 0))}</td>
                      <td>
                        <button
                          type="button"
                          className="whatsapp-inline-link"
                          onClick={() => openClientWhatsAppModal(detailClient, `quote-${quote.id}`)}
                        >
                          <WhatsAppGlyph />
                          Enviar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {detailHistory.quotes.length === 0 ? (
                    <tr>
                      <td colSpan={7}>Sin cotizaciones registradas para este cliente.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>

          <article className="clients-detail-table-card">
            <h4>Contratos</h4>
            <div className="clients-detail-table-wrap">
              <table className="clients-detail-table">
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th>Estado</th>
                    <th>Orden vinculada</th>
                    <th>Evento</th>
                    <th>Vigencia</th>
                    <th>Responsable</th>
                    <th>Total</th>
                    <th>Contacto</th>
                  </tr>
                </thead>
                <tbody>
                  {detailHistory.contracts.slice(0, 8).map((contract) => (
                    <tr key={contract.id}>
                      <td>
                        <button
                          type="button"
                          className="clients-document-link"
                          onClick={() => openDocumentPreview({ type: 'contract', record: contract })}
                        >
                          {contract.contractCode || contract.id}
                        </button>
                      </td>
                      <td>{contractStatusLabels[contract.status] || contract.status || '-'}</td>
                      <td>{contract.orderCode || '-'}</td>
                      <td>{contract.eventType || '-'}</td>
                      <td>
                        {contract.eventDate ? formatDate(contract.eventDate) : '-'}
                        {contract.returnDate ? ` / ${formatDate(contract.returnDate)}` : ''}
                      </td>
                      <td>
                        <span className="clients-responsible-pill">
                          {contract.createdByName ?? contract.createdBy ?? 'Sistema'} · {contract.createdByRole ?? 'Operacion'}
                        </span>
                      </td>
                      <td>{formatBs(Number(contract?.totals?.totalBs ?? 0))}</td>
                      <td>
                        <button
                          type="button"
                          className="whatsapp-inline-link"
                          onClick={() => openClientWhatsAppModal(detailClient, `contract-${contract.id}`)}
                        >
                          <WhatsAppGlyph />
                          Enviar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {detailHistory.contracts.length === 0 ? (
                    <tr>
                      <td colSpan={8}>Sin contratos registrados para este cliente.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>

          <article className="clients-detail-table-card">
            <h4>Ordenes de servicio</h4>
            <div className="clients-detail-table-wrap">
              <table className="clients-detail-table">
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th>Tipo</th>
                    <th>Lugar</th>
                    <th>Fecha</th>
                    <th>Responsable</th>
                    <th>Estado</th>
                    <th>Total</th>
                    <th>Contacto</th>
                  </tr>
                </thead>
                <tbody>
                  {detailHistory.serviceOrders.slice(0, 12).map((serviceOrder) => (
                    <tr key={serviceOrder.id}>
                      <td>
                        <button
                          type="button"
                          className="clients-document-link"
                          onClick={() => openDocumentPreview({ type: serviceOrder.documentType, record: serviceOrder })}
                        >
                          {serviceOrder.orderCode}
                        </button>
                      </td>
                      <td>{serviceOrder.documentTypeLabel}</td>
                      <td>{serviceOrder.location}</td>
                      <td>{serviceOrder.date ? formatDate(serviceOrder.date) : '-'}</td>
                      <td>
                        <span className="clients-responsible-pill">
                          {serviceOrder.responsibleName} · {serviceOrder.responsibleRole}
                        </span>
                      </td>
                      <td>{serviceOrder.operationStatus}</td>
                      <td>{formatBs(serviceOrder.total)}</td>
                      <td>
                        <button
                          type="button"
                          className="whatsapp-inline-link"
                          onClick={() => openClientWhatsAppModal(detailClient, `${serviceOrder.documentType}-${serviceOrder.rentalId}`)}
                        >
                          <WhatsAppGlyph />
                          Enviar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {detailHistory.serviceOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8}>Sin ordenes registradas para este cliente.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>

          <article className="clients-detail-table-card">
            <h4>Danos y faltantes</h4>
            <div className="clients-detail-table-wrap">
              <table className="clients-detail-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Orden</th>
                    <th>Item</th>
                    <th>Danado</th>
                    <th>Faltante</th>
                    <th>Cargo</th>
                  </tr>
                </thead>
                <tbody>
                  {detailHistory.incidents.slice(0, 8).map((incident) => (
                    <tr key={incident.id}>
                      <td>{incident.date ? formatDate(incident.date) : '-'}</td>
                      <td>{incident.orderCode}</td>
                      <td>{incident.itemName}</td>
                      <td>{incident.damagedQty}</td>
                      <td>{incident.missingQty}</td>
                      <td>{formatBs(incident.penaltyBs)}</td>
                    </tr>
                  ))}
                  {detailHistory.incidents.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Sin danos ni faltantes registrados.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>

          <div className="reset-modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setDetailClient(null);
                onSwitchToOrders?.();
              }}
            >
              Ver ordenes
            </button>
            <button type="button" className="primary-button" onClick={() => setDetailClient(null)}>
              Cerrar
            </button>
          </div>
        </section>
      </div>
    );
  };

  const renderDocumentPreviewModal = () => {
    if (!documentPreview) return null;

    return (
      <div className="orders-modal-backdrop document-preview-backdrop" onClick={() => setDocumentPreview(null)}>
        <div className="orders-modal orders-preview-modal clients-document-preview-modal" onClick={(event) => event.stopPropagation()}>
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
              id="clients-document-preview-frame"
              title={documentPreview.title}
              srcDoc={documentPreview.html}
              className="orders-document-frame"
            />
          </div>
          <footer className="orders-modal-foot">
            <button type="button" className="ghost-button" onClick={() => setDocumentPreview(null)}>
              Cerrar
            </button>
            <button type="button" className="primary-button" onClick={printDocumentPreview}>
              Imprimir / guardar PDF
            </button>
          </footer>
        </div>
      </div>
    );
  };

  const renderWhatsAppModal = () => {
    if (!whatsAppModal) return null;
    const selectedDocument = whatsAppModal.documentOptions.find((option) => option.id === whatsAppModal.selectedDocumentId);

    return (
      <div className="orders-modal-backdrop" onClick={() => setWhatsAppModal(null)}>
        <section className="orders-modal whatsapp-modal" onClick={(event) => event.stopPropagation()}>
          <header className="orders-modal-head">
            <div>
              <h3>{whatsAppModal.title}</h3>
              <p>Elige la referencia, ajusta el mensaje y abre WhatsApp con todo listo para enviar.</p>
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
              Documento o referencia
              <select value={whatsAppModal.selectedDocumentId} onChange={(event) => updateWhatsAppDocument(event.target.value)}>
                {whatsAppModal.documentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {selectedDocument ? (
              <article className="whatsapp-document-summary">
                <button
                  type="button"
                  className="whatsapp-document-title"
                  onClick={previewWhatsAppClientDocument}
                  disabled={selectedDocument.recordType === 'general'}
                >
                  {selectedDocument.label}
                </button>
                <span>{selectedDocument.description}</span>
                <small>
                  WhatsApp permite cargar el mensaje automaticamente. El PDF se adjunta manualmente desde la vista previa si corresponde.
                </small>
              </article>
            ) : null}
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
    );
  };

  const renderRowActionsDropdown = (row) => (
    <div
      className="clients-row-dropdown clients-row-dropdown-floating"
      style={rowMenuPosition ? { top: rowMenuPosition.top, left: rowMenuPosition.left } : undefined}
    >
      <button
        type="button"
        onClick={() => {
          setDetailClient(row);
          closeRowMenu();
        }}
      >
        Ver detalle e historial
      </button>
      <button
        type="button"
        onClick={() => {
          openEditModal(row);
          closeRowMenu();
        }}
      >
        Editar cliente
      </button>
      <button
        type="button"
        onClick={() => {
          openClientWhatsAppModal(row);
          closeRowMenu();
        }}
      >
        Contactar por WhatsApp
      </button>
      <button
        type="button"
        onClick={() => {
          handleGoToOrdersWithClient(row);
          closeRowMenu();
        }}
      >
        Nueva orden
      </button>
      <button
        type="button"
        className="danger"
        onClick={async () => {
          await handleToggleBlacklist(row);
          closeRowMenu();
        }}
      >
        {row.isBlacklisted ? 'Quitar de lista negra' : 'Marcar no deseado'}
      </button>
      <button
        type="button"
        className="danger"
        onClick={async () => {
          await handleToggleStatus(row);
          closeRowMenu();
        }}
      >
        {String(row.status).toLowerCase() === 'active' ? 'Inactivar cliente' : 'Activar cliente'}
      </button>
    </div>
  );

  return (
    <section className="panel clients-view">
      <header className="clients-header">
        <div>
          <h2>Clientes</h2>
          <p>Gestiona tu base de clientes y consulta su historial</p>
        </div>
        <div className="clients-actions">
          <button type="button" className="link-button clients-import-btn" onClick={handleOpenImport}>
            Importar Clientes
          </button>
          <button type="button" className="primary-button clients-new-btn" onClick={openCreateModal}>
            + Nuevo Cliente
          </button>
        </div>
      </header>

      <input ref={importInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleImportFile} />

      {importFeedback ? <p className="status">{importFeedback}</p> : null}

      <section className="clients-mobile-hero" aria-label="Resumen de clientes">
        <div className="clients-mobile-hero-copy">
          <span>Base comercial</span>
          <h2>Clientes</h2>
          <p>{clients.length} registrados - {filteredRows.length} visibles</p>
        </div>
        <div className="clients-mobile-hero-actions">
          <button type="button" className="clients-mobile-import" onClick={handleOpenImport}>
            Importar
          </button>
          <button type="button" className="clients-mobile-new" onClick={openCreateModal}>
            + Cliente
          </button>
        </div>
      </section>

      <div className="clients-kpi-grid">
        {cards.map((card) => (
          <article key={card.label} className={`clients-kpi-card ${card.tone}`}>
            <span className={`clients-kpi-icon ${card.tone}`}>
              <CardIcon kind={card.icon} />
            </span>
            <strong>
              <span className="clients-kpi-value-desktop">{card.value}</span>
              <span className="clients-kpi-value-mobile">{card.mobileValue ?? card.value}</span>
            </strong>
            <p>
              <span className="clients-kpi-label-desktop">{card.label}</span>
              <span className="clients-kpi-label-mobile">{card.mobileLabel ?? card.label}</span>
            </p>
          </article>
        ))}
      </div>

      <article className="clients-table-card">
        <header className="clients-toolbar">
          <label className="clients-search">
            <span aria-hidden="true" className="clients-search-glyph">
              <svg viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="6" />
                <path d="m15.5 15.5 4 4" />
              </svg>
            </span>
            <input
              type="search"
              placeholder="Buscar por nombre, empresa, email, telefonos o NIT/CI..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            className="ghost-button clients-filter-btn"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="blacklist">Lista negra</option>
            <option value="prepaid">Clientes especiales</option>
          </select>
          <button type="button" className="link-button clients-export-btn" onClick={handleExport}>
            Exportar
          </button>
        </header>

        <div className="clients-table-wrap">
          <table className="clients-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contacto</th>
                <th>WhatsApp / Celular</th>
                <th>Referencia</th>
                <th>Email</th>
                <th>Ordenes</th>
                <th>Ultima Orden</th>
                <th>Ingreso</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row, index) => (
                <tr key={row.id}>
                  <td>
                    <div className="clients-cell-main">
                      <span className={`client-avatar ${toneFromIndex(index)}`}>{initialsFromName(row.name)}</span>
                      <div>
                        <strong>{row.name}</strong>
                        <span>{row.companyName || '-'}</span>
                        {row.isBlacklisted ? (
                          <small className="clients-blacklist-mini">No atender: {BLACKLIST_REASON_LABELS[row.blacklistReason] ?? 'Revisar'}</small>
                        ) : null}
                        {row.prepaidEnabled ? (
                          <small className="clients-prepaid-mini">Especial: {formatBs(Number(row.prepaidBalanceBs ?? 0))}</small>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="clients-cell-stack">
                      <strong>{row.contactName || row.name}</strong>
                      <span>{row.contactRole || 'Contacto'}</span>
                    </div>
                  </td>
                  <td>
                    <div className="clients-whatsapp-cell">
                      <span>{row.whatsapp || row.phone || '-'}</span>
                      <button
                        type="button"
                        className="whatsapp-bubble-button"
                        onClick={() => openClientWhatsAppModal(row)}
                        aria-label={`Contactar por WhatsApp a ${row.name}`}
                      >
                        <WhatsAppGlyph />
                      </button>
                    </div>
                  </td>
                  <td>{row.referencePhone || '-'}</td>
                  <td>{row.email || '-'}</td>
                  <td>
                    <button
                      type="button"
                      className={`clients-orders-badge ${Number(row.ordersCount ?? 0) > 0 ? 'has-orders' : 'is-empty'}`}
                      onClick={() => setDetailClient(row)}
                      disabled={Number(row.ordersCount ?? 0) <= 0}
                      aria-label={`Ver ordenes y contratos de ${row.name}`}
                    >
                      {row.ordersCount ?? 0}
                    </button>
                  </td>
                  <td>{row.lastOrderAt ? formatDate(row.lastOrderAt) : '-'}</td>
                  <td className="clients-money">{formatBs(Number(row.totalBilledBs ?? 0))}</td>
                  <td>
                    <div className="clients-status-stack">
                      <span className={`client-status ${String(row.status).toLowerCase() !== 'active' ? 'inactive' : ''}`}>
                        {String(row.status).toLowerCase() === 'active' ? 'Activo' : 'Inactivo'}
                      </span>
                      {row.isBlacklisted ? <span className="client-status blacklisted">Lista negra</span> : null}
                    </div>
                  </td>
                  <td className="clients-row-menu">
                    <div className="clients-actions-menu-wrap" ref={rowMenuOpenId === row.id ? rowMenuRef : null}>
                      <button
                        type="button"
                        className="clients-row-menu-button"
                        aria-label={`Acciones para ${row.name}`}
                        onClick={(event) => toggleRowMenu(row.id, event)}
                      >
                        {'\u22ee'}
                      </button>
                      {rowMenuOpenId === row.id ? renderRowActionsDropdown(row) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <p className="status">No hay clientes con esos filtros.</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="clients-mobile-list" aria-label="Clientes encontrados">
          {pagedRows.map((row, index) => {
            const primaryAddress = Array.isArray(row.deliveryAddresses) && row.deliveryAddresses.length > 0
              ? row.deliveryAddresses.find((entry) => entry.isPrimary) ?? row.deliveryAddresses[0]
              : null;
            const addressText = [primaryAddress?.address ?? row.address, primaryAddress?.city ?? row.city]
              .filter(Boolean)
              .join(' - ');
            const isActive = String(row.status).toLowerCase() === 'active';

            return (
              <article key={`mobile-${row.id}`} className={`clients-mobile-card ${row.isBlacklisted ? 'is-blacklisted' : ''}`}>
                <header className="clients-mobile-card-head">
                  <span className={`client-avatar ${toneFromIndex(index)}`}>{initialsFromName(row.name)}</span>
                  <div>
                    <strong>{row.name}</strong>
                    <small>{row.companyName || row.contactName || 'Sin empresa registrada'}</small>
                  </div>
                  <div className="clients-actions-menu-wrap" ref={rowMenuOpenId === row.id ? rowMenuRef : null}>
                    <button
                      type="button"
                      className="clients-row-menu-button"
                      aria-label={`Acciones para ${row.name}`}
                      onClick={(event) => toggleRowMenu(row.id, event)}
                    >
                      {'\u22ee'}
                    </button>
                    {rowMenuOpenId === row.id ? renderRowActionsDropdown(row) : null}
                  </div>
                </header>

                <div className="clients-mobile-badges">
                  <span className={`client-status ${isActive ? '' : 'inactive'}`}>{isActive ? 'Activo' : 'Inactivo'}</span>
                  <button
                    type="button"
                    className={`clients-mobile-orders ${Number(row.ordersCount ?? 0) > 0 ? 'has-orders' : ''}`}
                    onClick={() => setDetailClient(row)}
                    disabled={Number(row.ordersCount ?? 0) <= 0}
                  >
                    {row.ordersCount ?? 0} ordenes
                  </button>
                  {row.prepaidEnabled ? <span className="clients-mobile-prepaid">Especial {formatBs(Number(row.prepaidBalanceBs ?? 0))}</span> : null}
                  {row.isBlacklisted ? <span className="client-status blacklisted">No atender</span> : null}
                </div>

                <div className="clients-mobile-native-facts">
                  <button
                    type="button"
                    className="clients-mobile-native-fact clients-mobile-native-phone"
                    onClick={() => openClientWhatsAppModal(row)}
                    disabled={!row.whatsapp && !row.phone}
                  >
                    <WhatsAppGlyph />
                    <span>
                      <small>Telefono</small>
                      <strong>{row.whatsapp || row.phone || '-'}</strong>
                    </span>
                  </button>
                  <article className="clients-mobile-native-fact">
                    <ReceiptText aria-hidden="true" />
                    <span>
                      <small>Ingreso</small>
                      <strong>{formatBs(Number(row.totalBilledBs ?? 0))}</strong>
                    </span>
                  </article>
                  <article className="clients-mobile-native-fact">
                    <CalendarDays aria-hidden="true" />
                    <span>
                      <small>Ultima orden</small>
                      <strong>{row.lastOrderAt ? formatDate(row.lastOrderAt) : '-'}</strong>
                    </span>
                  </article>
                  <article className="clients-mobile-native-fact">
                    <Tag aria-hidden="true" />
                    <span>
                      <small>Referencia</small>
                      <strong>{row.referencePhone || '-'}</strong>
                    </span>
                  </article>
                  <article className="clients-mobile-native-fact clients-mobile-native-address">
                    <MapPin aria-hidden="true" />
                    <span>
                      <small>Direccion</small>
                      <strong>{addressText || '-'}</strong>
                    </span>
                  </article>
                </div>

                <footer className="clients-mobile-card-actions">
                  <button type="button" className="ghost-button" onClick={() => setDetailClient(row)}>
                    <Clock3 aria-hidden="true" />
                    Historial
                  </button>
                  <button type="button" className="primary-button" onClick={() => openEditModal(row)}>
                    <Pencil aria-hidden="true" />
                    Editar
                  </button>
                </footer>
              </article>
            );
          })}

          {pagedRows.length === 0 ? (
            <p className="clients-mobile-empty">No hay clientes con esos filtros.</p>
          ) : null}
        </div>

        <footer className="clients-table-footer">
          <span>
            Mostrando {pagedRows.length} de {filteredRows.length} clientes
          </span>
          <div className="clients-pagination">
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))}>{'<'}</button>
            <button type="button" className="is-active">{safePage}</button>
            <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>{'>'}</button>
            <select
              className="clients-page-size-select"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
            >
              <option value={8}>8 por pagina</option>
              <option value={15}>15 por pagina</option>
              <option value={25}>25 por pagina</option>
            </select>
          </div>
        </footer>
      </article>

      {renderClientModal()}
      {renderDetailModal()}
      {renderDocumentPreviewModal()}
      {renderWhatsAppModal()}
    </section>
  );
}

export default ClientsSection;
