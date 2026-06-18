import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { buildInventoryReturnRiskEvents } from '../../utils/availability';

const EVENT_TYPE_META = {
  all: { label: 'Todos', className: 'all' },
  delivery: { label: 'Entregas', singular: 'Entrega', className: 'delivery' },
  service: { label: 'Servicios', singular: 'Servicio', className: 'service' },
  maintenance: { label: 'Mantenimientos', singular: 'Mantenimiento', className: 'maintenance' },
  license: { label: 'Vencimientos', singular: 'Vencimiento', className: 'license' },
  contract: { label: 'Contratos', singular: 'Contrato', className: 'contract' },
  inventory_alert: { label: 'Alertas inventario', singular: 'Alerta inventario', className: 'inventory-alert' },
  loan: { label: 'Prestamos', singular: 'Prestamo', className: 'loan' },
  return: { label: 'Devoluciones', singular: 'Devolucion', className: 'return' },
  other: { label: 'Otros', singular: 'Otro evento', className: 'other' },
};

const EVENT_TYPE_ORDER = ['delivery', 'return', 'contract', 'inventory_alert', 'service', 'loan', 'maintenance', 'license', 'other'];

const STATUS_META = {
  programada: { label: 'Programada', className: 'scheduled' },
  programado: { label: 'Programado', className: 'scheduled' },
  scheduled: { label: 'Programado', className: 'scheduled' },
  confirmada: { label: 'Confirmada', className: 'confirmed' },
  confirmado: { label: 'Confirmado', className: 'confirmed' },
  confirmed: { label: 'Confirmado', className: 'confirmed' },
  en_ruta: { label: 'En ruta', className: 'route' },
  route: { label: 'En ruta', className: 'route' },
  completada: { label: 'Completada', className: 'done' },
  completado: { label: 'Completado', className: 'done' },
  completed: { label: 'Completado', className: 'done' },
  pendiente: { label: 'Pendiente', className: 'scheduled' },
  retrasado: { label: 'Retrasado', className: 'late' },
  vencido: { label: 'Vencido', className: 'late' },
  a_tiempo: { label: 'A tiempo', className: 'ontime' },
};

const OPERATIONAL_STATUS_META = {
  inventory: {
    pendiente: { label: 'Pendiente', className: 'pending', detail: 'Inventario aun no confirmo el alistamiento.' },
    enviado: { label: 'Recibida', className: 'transport', detail: 'La orden ya fue enviada a inventario.' },
    confirmado: { label: 'Listo', className: 'completed', detail: 'Inventario confirmo los items.' },
    no_aplica: { label: 'No aplica', className: 'draft', detail: 'No requiere gestion de inventario.' },
  },
  transport: {
    pendiente: { label: 'Pendiente', className: 'pending', detail: 'Transporte aun no confirmo la ruta.' },
    enviado: { label: 'Enviado', className: 'transport', detail: 'La ruta ya fue enviada a transporte.' },
    confirmado: { label: 'Confirmado', className: 'completed', detail: 'Transporte confirmo la atencion.' },
    no_aplica: { label: 'No aplica', className: 'draft', detail: 'El cliente gestiona el recojo/devolucion.' },
  },
};

const LOGISTICS_MODE_META = {
  envio: {
    label: 'Envio por mi equipo',
    detail: 'El equipo coordina la entrega y el recojo.',
    className: 'team',
  },
  recojo: {
    label: 'Recojo por cliente',
    detail: 'El cliente recoge y devuelve los items.',
    className: 'client',
  },
};

const monthNames = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const weekdayLabels = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

const pad2 = (value) => String(value).padStart(2, '0');

const toDateKey = (dateValue) => {
  if (!dateValue) return '';
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
    return dateValue.slice(0, 10);
  }
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
};

const dateFromKey = (key) => {
  const [year, month, day] = String(key ?? '').split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const formatShortDate = (dateValue) => {
  const parsed = dateFromKey(toDateKey(dateValue));
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: 'long' });
};

const formatLongDate = (dateValue) => {
  const parsed = dateFromKey(toDateKey(dateValue));
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('es-BO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
};

const addHoursToTime = (timeValue, hours = 2) => {
  const [hoursPart, minutesPart] = String(timeValue || '').split(':').map(Number);
  if (!Number.isFinite(hoursPart) || !Number.isFinite(minutesPart)) return '';
  const date = new Date(2026, 0, 1, hoursPart, minutesPart);
  date.setHours(date.getHours() + hours);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const getStatusMeta = (status) => STATUS_META[normalizeText(status).replaceAll(' ', '_')] ?? STATUS_META.programada;
const getTypeMeta = (type) => EVENT_TYPE_META[type] ?? EVENT_TYPE_META.other;
const getLogisticsMeta = (mode) => LOGISTICS_MODE_META[mode] ?? LOGISTICS_MODE_META.envio;
const getOperationalStatusMeta = (area, status) => {
  const key = normalizeText(status).replaceAll(' ', '_') || 'pendiente';
  return OPERATIONAL_STATUS_META[area]?.[key] ?? OPERATIONAL_STATUS_META[area]?.pendiente;
};

const getOperationalProgressValue = (status, { noAplicaComplete = true } = {}) => {
  const key = normalizeText(status).replaceAll(' ', '_');
  if (key === 'no_aplica') return noAplicaComplete ? 100 : 0;
  if (['confirmado', 'confirmada', 'completado', 'completada', 'completed', 'devuelto', 'devuelta', 'liquidado', 'liquidada', 'aprobado', 'aprobada'].includes(key)) return 100;
  if (['enviado', 'enviada', 'en_ruta', 'ruta', 'recibido', 'recibida'].includes(key)) return 50;
  return 0;
};

const averageProgress = (values = []) => {
  const validValues = values.filter((value) => Number.isFinite(value));
  if (!validValues.length) return 0;
  return Math.round(validValues.reduce((sum, value) => sum + value, 0) / validValues.length);
};

const getOperationLabel = (eventType, logisticsMode) => {
  if (eventType === 'delivery') {
    return logisticsMode === 'recojo' ? 'Recojo por cliente' : 'Envio';
  }
  if (eventType === 'return') {
    return logisticsMode === 'recojo' ? 'Devolucion por cliente' : 'Recojo';
  }
  return getTypeMeta(eventType).singular || getTypeMeta(eventType).label;
};

const getOperationDetail = (eventType, logisticsMode) => {
  if (eventType === 'delivery') {
    return logisticsMode === 'recojo'
      ? 'El cliente recoge los items en el horario acordado.'
      : 'El equipo lleva los items al cliente en el horario programado.';
  }
  if (eventType === 'return') {
    return logisticsMode === 'recojo'
      ? 'El cliente devuelve los items en el horario acordado.'
      : 'El equipo recoge los items en el horario programado.';
  }
  return getLogisticsMeta(logisticsMode).detail;
};

const initialsFromName = (name) =>
  String(name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

const getResponsibleTrace = (...records) => {
  const source = records.find((record) => (
    record?.responsibleName
    || record?.createdByName
    || record?.userName
    || record?.responsible
    || record?.createdBy
  ));
  const name = String(
    source?.responsibleName
    ?? source?.createdByName
    ?? source?.userName
    ?? source?.responsible
    ?? source?.createdBy
    ?? 'Sistema',
  ).trim() || 'Sistema';
  const role = String(
    source?.responsibleRole
    ?? source?.createdByRole
    ?? source?.userRole
    ?? 'Operacion',
  ).trim() || 'Operacion';

  return {
    name,
    role,
    initials: initialsFromName(name) || 'S',
  };
};

const compactUniqueParts = (parts = []) => {
  const seen = new Set();
  return parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .filter((part) => {
      const key = normalizeText(part);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const buildItemsSummary = (...records) => {
  const source = records.find((record) => Array.isArray(record?.items) && record.items.length > 0);
  if (!source) return '';
  return source.items
    .slice(0, 4)
    .map((line) => {
      const quantity = Number(line?.quantity ?? line?.qty ?? 0);
      const name = String(line?.itemName ?? line?.name ?? line?.title ?? 'item').trim();
      return `${quantity > 0 ? `${quantity} ` : ''}${name}`.trim();
    })
    .filter(Boolean)
    .join(', ');
};

const isDeliveryReturnLeg = (delivery, contract, rental) => {
  if (!delivery) return false;
  const text = normalizeText([
    delivery.notes,
    delivery.title,
    delivery.subtitle,
    delivery.deliveryCode,
    delivery.description,
  ].filter(Boolean).join(' '));
  if (text.includes('recojo') || text.includes('recog') || text.includes('devolucion')) return true;

  const deliveryKey = toDateKey(delivery.scheduledDate ?? delivery.date);
  const pickupKey = toDateKey(contract?.pickupDate ?? rental?.dueDate);
  const outboundKey = toDateKey(contract?.deliveryDate ?? rental?.rentalDate);
  return Boolean(pickupKey && deliveryKey === pickupKey && deliveryKey !== outboundKey);
};

const EMPTY_EVENT_FORM = {
  title: '',
  date: '',
  startTime: '08:00',
  endTime: '09:00',
  subtitle: '',
  type: 'other',
  status: 'programada',
};

function KpiIcon({ kind }) {
  if (kind === 'calendar') {
    return <img className="asset-icon calendar-asset-icon" src="/imagenes/calendario.png" alt="" aria-hidden="true" />;
  }
  if (kind === 'truck') {
    return <img className="asset-icon truck-asset-icon" src="/imagenes/camion.png" alt="" aria-hidden="true" />;
  }
  if (kind === 'tool') {
    return <img className="asset-icon maintenance-asset-icon" src="/imagenes/herramientas-de-construccion.png" alt="" aria-hidden="true" />;
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M12 7.5v5l3 2" />
    </svg>
  );
}

function DayEventIcon({ kind }) {
  if (kind === 'delivery') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M3 6h11v9H3zM14 9h3.5L21 12v3h-7z" />
        <circle cx="8" cy="17.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="18" cy="17.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }

  if (kind === 'maintenance') {
    return <img className="asset-icon maintenance-asset-icon" src="/imagenes/herramientas-de-construccion.png" alt="" aria-hidden="true" />;
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

const isClosedSupplierLoan = (status) => ['devuelto', 'liquidado', 'cancelado'].includes(normalizeText(status));

function CalendarSection({
  events = [],
  items = [],
  rentals = [],
  contracts = [],
  deliveries = [],
  supplierBundle = null,
  onCreateEvent,
  onPrintContractDocument,
}) {
  const todayKey = toDateKey(new Date());
  const today = dateFromKey(todayKey);
  const [monthDate, setMonthDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const [typeFilter, setTypeFilter] = useState('all');
  const [viewMode, setViewMode] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches ? 'day' : 'month'
  ));
  const [detailEvent, setDetailEvent] = useState(null);
  const [documentPreview, setDocumentPreview] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [eventForm, setEventForm] = useState({ ...EMPTY_EVENT_FORM, date: todayKey });
  const [formError, setFormError] = useState('');
  const [boardContextMenu, setBoardContextMenu] = useState(null);
  const [boardNoteTarget, setBoardNoteTarget] = useState(null);
  const [boardNoteText, setBoardNoteText] = useState('');
  const [openBoardReminderId, setOpenBoardReminderId] = useState(null);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [boardNotes, setBoardNotes] = useState({});

  useEffect(() => {
    let isMounted = true;
    const loadBoardNotes = async () => {
      try {
        const notes = await api.calendar.listBoardNotes();
        if (!isMounted) return;
        setBoardNotes(Object.fromEntries((notes || []).map((note) => [note.rowId, note])));
      } catch {
        if (!isMounted || typeof window === 'undefined') return;
        try {
          setBoardNotes(JSON.parse(window.localStorage.getItem('copetin-calendar-board-notes') || '{}'));
        } catch {
          setBoardNotes({});
        }
      }
    };

    loadBoardNotes();
    return () => {
      isMounted = false;
    };
  }, []);

  const relationshipMaps = useMemo(() => {
    const contractByRentalId = new Map();
    const contractByOrderCode = new Map();
    const contractById = new Map();
    const contractByCode = new Map();
    const rentalById = new Map();
    const rentalByOrderCode = new Map();
    const deliveryById = new Map();
    const deliveryByCode = new Map();

    contracts.forEach((contract) => {
      if (contract.id) contractById.set(contract.id, contract);
      if (contract.contractCode) contractByCode.set(contract.contractCode, contract);
      if (contract.rentalId) contractByRentalId.set(contract.rentalId, contract);
      if (contract.orderCode) contractByOrderCode.set(contract.orderCode, contract);
    });
    rentals.forEach((rental) => {
      if (rental.id) rentalById.set(rental.id, rental);
      if (rental.orderCode) rentalByOrderCode.set(rental.orderCode, rental);
    });
    deliveries.forEach((delivery) => {
      if (delivery.id) deliveryById.set(delivery.id, delivery);
      if (delivery.deliveryCode) deliveryByCode.set(delivery.deliveryCode, delivery);
    });

    return {
      contractByRentalId,
      contractByOrderCode,
      contractById,
      contractByCode,
      rentalById,
      rentalByOrderCode,
      deliveryById,
      deliveryByCode,
    };
  }, [contracts, deliveries, rentals]);

  const systemEvents = useMemo(() => {
    const rows = [];
    const todayDate = dateFromKey(todayKey);

    contracts.forEach((contract) => {
      const linkedRental =
        relationshipMaps.rentalById.get(contract.rentalId)
        ?? relationshipMaps.rentalByOrderCode.get(contract.orderCode);
      if (linkedRental) return;
      if (contract.pickupDate || contract.validUntil) {
        const dateKey = toDateKey(contract.pickupDate || contract.validUntil);
        if (dateKey) {
          rows.push({
            id: `contract-end-${contract.id}`,
            title: `Recojo ${contract.contractCode}`,
            subtitle: `${contract.customerName || 'Cliente'} - ${contract.eventType || 'sin evento'}`,
            detailLine: `${contract.items?.length ?? 0} items | ${contract.status || 'sin estado'}`,
            type: 'return',
            date: dateKey,
            startTime: contract.pickupWindowStart || '20:00',
            endTime: contract.pickupWindowEnd || '22:00',
            status: contract.status === 'aprobado' ? 'a_tiempo' : contract.status || 'programada',
            relatedType: 'contrato',
            relatedId: contract.contractCode,
            contractId: contract.id,
            contractCode: contract.contractCode,
            rentalId: contract.rentalId,
            orderCode: contract.orderCode,
            customerName: contract.customerName,
            totalBs: Number(contract?.totals?.totalBs ?? 0),
            itemsCount: contract.items?.length ?? 0,
            logisticsMode: contract.logisticsMode ?? 'envio',
            eventName: contract.eventType,
            operationLabel: getOperationLabel('return', contract.logisticsMode ?? 'envio'),
            responsibleName: contract.createdByName ?? contract.createdBy ?? 'Sistema',
            responsibleRole: contract.createdByRole ?? 'Operacion',
          });
        }
      }
    });

    rentals.forEach((rental) => {
      const contract = relationshipMaps.contractByRentalId.get(rental.id) ?? relationshipMaps.contractByOrderCode.get(rental.orderCode);
      const logisticsMode = contract?.logisticsMode ?? rental.logisticsMode ?? 'envio';
      if (logisticsMode === 'recojo') {
        const deliveryKey = toDateKey(contract?.deliveryDate || rental.rentalDate || rental.createdAt);
        if (deliveryKey) {
          const deliveryStart = contract?.deliveryWindowStart || rental.deliveryWindowStart || '08:00';
          const deliveryEnd = contract?.deliveryWindowEnd && contract.deliveryWindowEnd !== deliveryStart
            ? contract.deliveryWindowEnd
            : rental.deliveryWindowEnd || addHoursToTime(deliveryStart, 2) || '10:00';
          const inventoryStatus = rental.operational?.inventoryStatus ?? 'pendiente';
          const inventoryDone = getOperationalProgressValue(inventoryStatus, { noAplicaComplete: false }) >= 100;
          const deliveryDate = dateFromKey(deliveryKey);
          const isLateDelivery = !inventoryDone && deliveryDate < todayDate;
          rows.push({
            id: `rental-customer-pickup-${rental.id}`,
            title: `Alistamiento ${rental.orderCode}`,
            subtitle: `${rental.customerName || 'Cliente'} - ${contract?.eventType || rental.companyName || 'sin evento'}`,
            detailLine: `${rental.items?.length ?? 0} items | ${getOperationalStatusMeta('inventory', inventoryStatus).label}`,
            type: 'delivery',
            date: deliveryKey,
            startTime: deliveryStart,
            endTime: deliveryEnd,
            status: inventoryDone ? 'completada' : isLateDelivery ? 'retrasado' : 'programada',
            relatedType: 'orden',
            relatedId: rental.orderCode,
            contractId: contract?.id,
            contractCode: contract?.contractCode,
            rentalId: rental.id,
            orderCode: rental.orderCode,
            customerName: rental.customerName,
            totalBs: Number(rental?.totals?.totalBs ?? 0),
            itemsCount: rental.items?.length ?? 0,
            logisticsMode,
            eventName: contract?.eventType ?? rental.companyName,
            operationLabel: 'Alistamiento para recojo',
            logisticsLine: getLogisticsMeta(logisticsMode).label,
            responsibleName: rental.createdByName ?? contract?.createdByName ?? rental.createdBy ?? contract?.createdBy ?? 'Sistema',
            responsibleRole: rental.createdByRole ?? contract?.createdByRole ?? 'Operacion',
          });
        }
      }
      const dueKey = toDateKey(rental.dueDate);
      if (!dueKey) return;
      const dueDate = dateFromKey(dueKey);
      const isReturned = rental.status === 'returned';
      const isLate = !isReturned && dueDate < todayDate;
      const returnStart = contract?.pickupWindowStart || rental.dueTime || '20:00';
      const returnEnd = contract?.pickupWindowEnd && contract.pickupWindowEnd !== returnStart
        ? contract.pickupWindowEnd
        : addHoursToTime(returnStart, 2) || '22:00';
      const hasReturnDelivery = deliveries.some((delivery) => {
        if (delivery.deletedAt) return false;
        const sameRental = delivery.rentalId && delivery.rentalId === rental.id;
        const sameOrder = delivery.orderCode && delivery.orderCode === rental.orderCode;
        return (sameRental || sameOrder) && isDeliveryReturnLeg(delivery, contract, rental);
      });
      if (hasReturnDelivery) return;
      const returnVerb = isReturned ? 'Devuelto' : logisticsMode === 'recojo' ? 'Devolucion' : 'Recojo';
      rows.push({
        id: `rental-return-${rental.id}`,
        title: `${returnVerb} ${rental.orderCode}`,
        subtitle: `${rental.customerName || 'Cliente'} - ${contract?.eventType || rental.companyName || 'sin evento'}`,
        detailLine: `${rental.items?.length ?? 0} items | Total ${Number(rental?.totals?.totalBs ?? 0).toFixed(2)} Bs`,
        type: 'return',
        date: dueKey,
        startTime: returnStart,
        endTime: returnEnd,
        status: isReturned ? 'completada' : isLate ? 'retrasado' : 'a_tiempo',
        relatedType: 'orden',
        relatedId: rental.orderCode,
        contractId: contract?.id,
        contractCode: contract?.contractCode,
        rentalId: rental.id,
        orderCode: rental.orderCode,
        customerName: rental.customerName,
        totalBs: Number(rental?.totals?.totalBs ?? 0),
        itemsCount: rental.items?.length ?? 0,
        logisticsMode,
        eventName: contract?.eventType ?? rental.companyName,
        operationLabel: getOperationLabel('return', logisticsMode),
        responsibleName: rental.createdByName ?? contract?.createdByName ?? rental.createdBy ?? contract?.createdBy ?? 'Sistema',
        responsibleRole: rental.createdByRole ?? contract?.createdByRole ?? 'Operacion',
      });
    });

    rows.push(...buildInventoryReturnRiskEvents({
      items,
      rentals,
      contracts,
      todayKey,
    }));

    (supplierBundle?.loans ?? []).forEach((loan) => {
      const requestKey = toDateKey(loan.requestDate);
      const returnKey = toDateKey(loan.returnDate);
      const isClosed = isClosedSupplierLoan(loan.status);
      const isLate = returnKey && !isClosed && dateFromKey(returnKey) < todayDate;
      if (requestKey) {
        rows.push({
          id: `supplier-loan-start-${loan.id}`,
          title: loan.direction === 'from_supplier' ? `Recibir ${loan.loanCode}` : `Prestar ${loan.loanCode}`,
          subtitle: `${loan.supplierName} - ${loan.eventName || 'sin referencia'}`,
          detailLine: `${loan.items?.length ?? 0} items | ${loan.flowType === 'exchange' ? 'intercambio' : 'pago'}`,
          type: 'loan',
          date: requestKey,
          startTime: '09:00',
          endTime: '10:00',
          status: isLate ? 'retrasado' : loan.status || 'programada',
          relatedType: 'prestamo',
          relatedId: loan.loanCode,
        });
      }
      if (returnKey) {
        rows.push({
          id: `supplier-loan-return-${loan.id}`,
          title: `Devolver ${loan.loanCode}`,
          subtitle: `${loan.supplierName} - ${loan.direction === 'from_supplier' ? 'nos prestaron' : 'prestamos'}`,
          detailLine: `${loan.items?.length ?? 0} items | ${loan.status || 'pendiente'}`,
          type: 'loan',
          date: returnKey,
          startTime: '18:00',
          endTime: '19:00',
          status: isClosed ? 'completada' : isLate ? 'retrasado' : 'a_tiempo',
          relatedType: 'prestamo',
          relatedId: loan.loanCode,
        });
      }
    });

    return rows;
  }, [contracts, deliveries, items, relationshipMaps, rentals, supplierBundle, todayKey]);

  const normalizedEvents = useMemo(() => {
    return [...events, ...systemEvents]
      .map((event) => {
        const delivery =
          event.relatedType === 'delivery'
            ? relationshipMaps.deliveryById.get(event.relatedId) ?? relationshipMaps.deliveryByCode.get(event.title)
            : null;
        const rental =
          relationshipMaps.rentalById.get(event.rentalId ?? delivery?.rentalId)
          ?? relationshipMaps.rentalByOrderCode.get(event.orderCode ?? delivery?.orderCode);
        const contract =
          relationshipMaps.contractById.get(event.contractId)
          ?? relationshipMaps.contractByCode.get(event.relatedType === 'contrato' ? event.relatedId : event.contractCode)
          ?? relationshipMaps.contractByRentalId.get(rental?.id)
          ?? relationshipMaps.contractByOrderCode.get(rental?.orderCode ?? event.orderCode ?? delivery?.orderCode);
        const rawType = event.type || 'other';
        const isReturnLeg = rawType === 'delivery' && delivery && isDeliveryReturnLeg(delivery, contract, rental);
        const type = isReturnLeg ? 'return' : rawType;
        const logisticsMode = event.logisticsMode ?? contract?.logisticsMode ?? rental?.logisticsMode ?? (rawType === 'delivery' ? 'envio' : undefined);
        const logisticsMeta = logisticsMode ? getLogisticsMeta(logisticsMode) : null;
        const eventName = event.eventName ?? contract?.eventType ?? rental?.companyName ?? delivery?.companyName;
        const customerName = event.customerName ?? rental?.customerName ?? contract?.customerName ?? delivery?.customerName;
        const address = event.address ?? delivery?.address ?? contract?.address ?? rental?.eventAddress ?? rental?.address ?? '';
        const city = event.city ?? delivery?.city ?? contract?.city ?? rental?.city ?? '';
        const contractCode = event.contractCode ?? contract?.contractCode;
        const orderCode = event.orderCode ?? rental?.orderCode ?? delivery?.orderCode;
        const deliveryCode = event.deliveryCode ?? delivery?.deliveryCode ?? (rawType === 'delivery' ? event.title : undefined);
        const operationLabel = event.operationLabel ?? getOperationLabel(type, logisticsMode);
        const itemsSummary = buildItemsSummary(event, delivery, rental, contract);
        const notesLine = compactUniqueParts([
          event.notes,
          delivery?.notes,
          event.detailLine,
          itemsSummary,
          event.logisticsLine,
          delivery?.vehicleId ? 'Vehiculo asignado' : '',
        ]).join(' | ');
        const referenceLine = [
          contractCode ? `Contrato ${contractCode}` : null,
          orderCode ? `Orden ${orderCode}` : null,
          deliveryCode ? deliveryCode : null,
        ].filter(Boolean).join(' | ');
        const responsible = getResponsibleTrace(event, contract, rental, delivery);

        return {
          ...event,
          dateKey: toDateKey(event.date),
          type,
          startTime: event.startTime || '08:00',
          endTime: event.endTime || '09:00',
          rentalId: event.rentalId ?? rental?.id ?? delivery?.rentalId,
          orderCode,
          contractId: event.contractId ?? contract?.id,
          contractCode,
          customerName,
          eventName,
          address,
          city,
          deliveryCode,
          operationLabel,
          notesLine,
          itemsSummary,
          referenceLine,
          responsibleName: responsible.name,
          responsibleRole: responsible.role,
          responsibleInitials: responsible.initials,
          totalBs: event.totalBs ?? rental?.totals?.totalBs ?? contract?.totals?.totalBs,
          itemsCount: event.itemsCount ?? rental?.items?.length ?? contract?.items?.length,
          logisticsMode,
          logisticsLine: event.logisticsLine ?? logisticsMeta?.label,
          detailLine:
            event.detailLine
            ?? (contract?.contractCode
              ? `${eventName || 'Sin evento'} | ${operationLabel} | ${rental?.items?.length ?? contract.items?.length ?? 0} items`
              : undefined),
        };
      })
      .filter((event) => event.dateKey)
      .sort((a, b) => `${a.dateKey}T${a.startTime}`.localeCompare(`${b.dateKey}T${b.startTime}`, 'es'));
  }, [events, relationshipMaps, systemEvents]);

  const visibleEvents = useMemo(
    () => normalizedEvents.filter((event) => typeFilter === 'all' || event.type === typeFilter),
    [normalizedEvents, typeFilter],
  );

  const eventMap = useMemo(() => {
    const map = {};
    visibleEvents.forEach((event) => {
      if (!map[event.dateKey]) map[event.dateKey] = [];
      map[event.dateKey].push(event);
    });
    return map;
  }, [visibleEvents]);

  const monthGrid = useMemo(() => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - startOffset);

    return Array.from({ length: 42 }).map((_, index) => {
      const current = addDays(gridStart, index);
      const key = toDateKey(current);
      return {
        id: key,
        date: current,
        day: current.getDate(),
        inCurrentMonth: current.getMonth() === month,
        isToday: key === todayKey,
        events: eventMap[key] ?? [],
      };
    });
  }, [eventMap, monthDate, todayKey]);

  const selectedDate = dateFromKey(selectedDateKey);
  const selectedDayEvents = useMemo(() => eventMap[selectedDateKey] ?? [], [eventMap, selectedDateKey]);
  const selectedDispatchRows = useMemo(() => {
    const toRow = (event) => {
      const addressLine = [event.address, event.city].filter(Boolean).join(', ');
      const detailLine = compactUniqueParts([
        event.customerName || event.subtitle,
        event.eventName,
        event.itemsSummary,
        event.notesLine || event.detailLine,
        event.referenceLine,
      ]).join(' - ');
      const destinationLine = addressLine || event.eventName || event.title || event.customerName || event.subtitle || 'Sin destino';
      return {
        id: event.id,
        type: event.type,
        kind: event.type,
        time: event.startTime || '-',
        code: event.contractCode ?? event.orderCode ?? event.deliveryCode ?? event.relatedId ?? event.title ?? '-',
        responsible: event.responsibleName || 'Sistema',
        title: destinationLine,
        details: detailLine || event.title || 'Sin detalle adicional',
        notes: event.notesLine || event.detailLine || event.itemsSummary || event.referenceLine || 'Sin notas',
        date: formatShortDate(event.dateKey),
        status: getStatusMeta(event.status),
        event,
      };
    };

    const rows = selectedDayEvents.map(toRow);
    return {
      deliveries: rows.filter((row) => row.type === 'delivery'),
      returns: rows.filter((row) => row.type === 'return'),
      other: rows.filter((row) => row.type !== 'delivery' && row.type !== 'return'),
    };
  }, [selectedDayEvents]);

  const selectedWeekDays = useMemo(() => {
    const startOffset = (selectedDate.getDay() + 6) % 7;
    const weekStart = addDays(selectedDate, -startOffset);
    return Array.from({ length: 7 }).map((_, index) => {
      const date = addDays(weekStart, index);
      const key = toDateKey(date);
      return {
        id: key,
        date,
        dayLabel: weekdayLabels[index],
        isToday: key === todayKey,
        events: eventMap[key] ?? [],
      };
    });
  }, [eventMap, selectedDate, todayKey]);

  const upcomingEvents = useMemo(() => {
    const nowKey = todayKey;
    return visibleEvents.filter((event) => event.dateKey >= nowKey).slice(0, 6);
  }, [todayKey, visibleEvents]);

  const operationalInsights = useMemo(() => {
    const todayDate = dateFromKey(todayKey);
    const returnedRentals = rentals.filter((rental) => rental.status === 'returned');
    const successfulReturns = returnedRentals.filter((rental) => Number(rental.penaltiesBs ?? 0) <= 0);
    const activeRentals = rentals.filter((rental) => rental.status !== 'returned' && !rental.deletedAt);
    const lateRentals = activeRentals.filter((rental) => {
      const dueKey = toDateKey(rental.dueDate);
      return dueKey && dateFromKey(dueKey) < todayDate;
    });
    const onTimeRentals = activeRentals.filter((rental) => {
      const dueKey = toDateKey(rental.dueDate);
      return dueKey && dateFromKey(dueKey) >= todayDate;
    });
    const supplierLoans = supplierBundle?.loans ?? [];
    const activeLoans = supplierLoans.filter((loan) => !isClosedSupplierLoan(loan.status));
    const lateLoans = activeLoans.filter((loan) => {
      const returnKey = toDateKey(loan.returnDate);
      return returnKey && dateFromKey(returnKey) < todayDate;
    });

    return {
      successfulReturns,
      lateRentals,
      onTimeRentals,
      activeLoans,
      lateLoans,
    };
  }, [rentals, supplierBundle, todayKey]);

  const metrics = useMemo(() => {
    const month = monthDate.getMonth();
    const year = monthDate.getFullYear();
    const monthEvents = normalizedEvents.filter((event) => {
      const date = dateFromKey(event.dateKey);
      return date.getMonth() === month && date.getFullYear() === year;
    });
    return {
      total: monthEvents.length,
      deliveries: monthEvents.filter((event) => event.type === 'delivery').length,
      maintenance: monthEvents.filter((event) => event.type === 'maintenance').length,
      licenses: monthEvents.filter((event) => event.type === 'license').length,
      late: monthEvents.filter((event) => getStatusMeta(event.status).className === 'late').length,
    };
  }, [monthDate, normalizedEvents]);

  const monthTitle = `${monthNames[monthDate.getMonth()]} ${monthDate.getFullYear()}`;
  const pickerYears = useMemo(() => {
    const currentYear = today.getFullYear();
    return Array.from({ length: 7 }, (_, index) => currentYear - 3 + index);
  }, [today]);

  const getLinkedContext = (event) => {
    if (!event) return { contract: null, rental: null };
    const rental =
      relationshipMaps.rentalById.get(event.rentalId)
      ?? relationshipMaps.rentalByOrderCode.get(event.orderCode);
    const contract =
      relationshipMaps.contractById.get(event.contractId)
      ?? relationshipMaps.contractByCode.get(event.contractCode)
      ?? relationshipMaps.contractByRentalId.get(rental?.id)
      ?? relationshipMaps.contractByOrderCode.get(rental?.orderCode ?? event.orderCode);

    return { contract, rental };
  };

  const goToday = () => {
    const now = new Date();
    const key = toDateKey(now);
    setMonthDate(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDateKey(key);
    setIsMonthPickerOpen(false);
  };

  const jumpToMonth = (year, monthIndex) => {
    const nextDate = new Date(year, monthIndex, 1);
    setMonthDate(nextDate);
    setSelectedDateKey(toDateKey(nextDate));
    setIsMonthPickerOpen(false);
  };

  const openCreateModal = () => {
    setEventForm({ ...EMPTY_EVENT_FORM, date: selectedDateKey || todayKey });
    setFormError('');
    setIsCreateOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    setFormError('');
  };

  const handleSubmitEvent = async (event) => {
    event.preventDefault();
    setFormError('');
    const payload = {
      title: eventForm.title.trim(),
      date: eventForm.date,
      startTime: eventForm.startTime,
      endTime: eventForm.endTime,
      subtitle: eventForm.subtitle.trim(),
      type: eventForm.type,
      status: eventForm.status,
    };

    if (!payload.title) {
      setFormError('El titulo es obligatorio.');
      return;
    }
    if (!payload.date) {
      setFormError('La fecha es obligatoria.');
      return;
    }

    await onCreateEvent?.(payload);
    setSelectedDateKey(payload.date);
    setMonthDate(new Date(dateFromKey(payload.date).getFullYear(), dateFromKey(payload.date).getMonth(), 1));
    closeCreateModal();
  };

  const handleEventClick = (event, dateKey) => {
    setSelectedDateKey(dateKey || event.dateKey);
    setFormError('');
    setDetailEvent(event);
  };

  const persistBoardNotes = (nextNotes) => {
    setBoardNotes(nextNotes);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('copetin-calendar-board-notes', JSON.stringify(nextNotes));
    }
  };

  const openBoardContextMenu = (contextEvent, row) => {
    contextEvent.preventDefault();
    contextEvent.stopPropagation();
    const menuWidth = 238;
    const menuHeight = 168;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
    setBoardContextMenu({
      row,
      x: Math.min(contextEvent.clientX, viewportWidth - menuWidth - 14),
      y: Math.min(contextEvent.clientY, viewportHeight - menuHeight - 14),
    });
  };

  const openBoardNoteEditor = (row) => {
    setBoardContextMenu(null);
    setBoardNoteTarget(row);
    setBoardNoteText(boardNotes[row.id]?.text ?? '');
  };

  const saveBoardNote = async () => {
    if (!boardNoteTarget) return;
    const trimmed = boardNoteText.trim();
    const nextNotes = { ...boardNotes };
    if (trimmed) {
      nextNotes[boardNoteTarget.id] = {
        rowId: boardNoteTarget.id,
        eventId: boardNoteTarget.event?.id ?? null,
        kind: boardNoteTarget.kind,
        text: trimmed,
        updatedAt: new Date().toISOString(),
        dateKey: boardNoteTarget.event?.dateKey ?? selectedDateKey,
      };
    } else {
      delete nextNotes[boardNoteTarget.id];
    }
    persistBoardNotes(nextNotes);
    try {
      if (trimmed) {
        const savedNote = await api.calendar.upsertBoardNote({
          rowId: boardNoteTarget.id,
          eventId: boardNoteTarget.event?.id ?? null,
          kind: boardNoteTarget.kind,
          dateKey: boardNoteTarget.event?.dateKey ?? selectedDateKey,
          text: trimmed,
        });
        setBoardNotes((currentNotes) => ({ ...currentNotes, [savedNote.rowId]: savedNote }));
      } else {
        await api.calendar.removeBoardNote({ rowId: boardNoteTarget.id });
      }
    } catch {
      // La reserva local evita perder el recordatorio si la conexion compartida falla.
    }
    setBoardNoteTarget(null);
    setBoardNoteText('');
  };

  const getEventProgress = (event) => {
    if (!event) return 0;
    const statusMeta = getStatusMeta(event.status);
    const statusProgress = getOperationalProgressValue(event.status, { noAplicaComplete: true });
    if (statusMeta.className === 'done') return 100;
    if (statusMeta.className === 'late') return 0;

    const { contract, rental } = getLinkedContext(event);
    const logisticsMode = event.logisticsMode ?? contract?.logisticsMode ?? rental?.logisticsMode ?? 'envio';
    const operational = rental?.operational ?? {};

    if (event.type === 'delivery') {
      const steps = [getOperationalProgressValue(operational.inventoryStatus, { noAplicaComplete: false })];
      if (logisticsMode !== 'recojo') {
        steps.push(getOperationalProgressValue(operational.transportStatus, { noAplicaComplete: false }));
      }
      return averageProgress(steps);
    }

    if (event.type === 'return') {
      if (logisticsMode === 'recojo') return statusProgress;
      return getOperationalProgressValue(operational.transportStatus, { noAplicaComplete: false });
    }

    if (event.type === 'contract') {
      return getOperationalProgressValue(contract?.status ?? event.status, { noAplicaComplete: true });
    }

    return statusProgress;
  };

  const isEventCompleted = (event) => getStatusMeta(event?.status).className === 'done' || getEventProgress(event) >= 100;

  const hasSameOperationalReference = (left, right) => Boolean(
    (left?.rentalId && right?.rentalId && left.rentalId === right.rentalId)
    || (left?.orderCode && right?.orderCode && left.orderCode === right.orderCode)
    || (left?.contractId && right?.contractId && left.contractId === right.contractId)
    || (left?.contractCode && right?.contractCode && left.contractCode === right.contractCode)
  );

  const getRelatedDeliveryEvent = (event) => {
    const relatedDeliveries = normalizedEvents
      .filter((candidate) => (
        candidate.type === 'delivery'
        && candidate.dateKey <= event.dateKey
        && hasSameOperationalReference(candidate, event)
      ))
      .sort((left, right) => `${left.dateKey}T${left.startTime}`.localeCompare(`${right.dateKey}T${right.startTime}`, 'es'));
    return relatedDeliveries[relatedDeliveries.length - 1] ?? null;
  };

  const getOperationalAlertForEvent = (event) => {
    if (!event || !['delivery', 'return'].includes(event.type)) return null;
    const eventDateKey = event.dateKey || toDateKey(event.date);
    if (!eventDateKey || eventDateKey > todayKey) return null;

    const { contract, rental } = getLinkedContext(event);
    const logisticsMode = event.logisticsMode ?? contract?.logisticsMode ?? rental?.logisticsMode ?? 'envio';
    const operational = rental?.operational ?? {};
    const blockers = [];
    const progress = getEventProgress(event);
    const severity = eventDateKey < todayKey ? 'critical' : 'warning';

    if (event.type === 'delivery') {
      if (isEventCompleted(event)) return null;

      const inventoryProgress = getOperationalProgressValue(operational.inventoryStatus, { noAplicaComplete: false });
      if (inventoryProgress < 100) {
        blockers.push({
          area: 'Inventario',
          detail: getOperationalStatusMeta('inventory', operational.inventoryStatus).detail,
        });
      }

      if (logisticsMode !== 'recojo') {
        const transportProgress = getOperationalProgressValue(operational.transportStatus, { noAplicaComplete: false });
        if (transportProgress < 100) {
          blockers.push({
            area: 'Transporte',
            detail: getOperationalStatusMeta('transport', operational.transportStatus).detail,
          });
        }
      }

      if (!blockers.length) {
        blockers.push({
          area: 'Operacion',
          detail: 'La entrega no fue marcada como completada.',
        });
      }

      return {
        id: `delivery-alert-${event.id}`,
        event,
        severity,
        title: 'Entrega incompleta',
        reason: 'No se completo antes del recojo o cierre del evento.',
        blockers,
        progress,
        dateKey: eventDateKey,
      };
    }

    const relatedDelivery = getRelatedDeliveryEvent(event);
    const deliveryIsCompleted = relatedDelivery ? isEventCompleted(relatedDelivery) : false;
    const returnIsCompleted = isEventCompleted(event);

    if (logisticsMode === 'recojo' && !deliveryIsCompleted) {
      blockers.push({
        area: 'Inventario',
        detail: relatedDelivery
          ? `El alistamiento para recojo quedo en ${getEventProgress(relatedDelivery)}%.`
          : 'No se encontro el alistamiento de inventario para este recojo por cliente.',
      });
    } else if (!deliveryIsCompleted) {
      blockers.push({
        area: 'Entrega previa',
        detail: relatedDelivery
          ? `La entrega vinculada quedo en ${getEventProgress(relatedDelivery)}%.`
          : 'No se encontro una entrega completada para este recojo.',
      });
    }

    if (!returnIsCompleted && logisticsMode !== 'recojo') {
      const transportProgress = getOperationalProgressValue(operational.transportStatus, { noAplicaComplete: false });
      if (transportProgress < 100) {
        blockers.push({
          area: 'Transporte',
          detail: getOperationalStatusMeta('transport', operational.transportStatus).detail,
        });
      }
    }

    if (!blockers.length) return null;

    return {
      id: `return-alert-${event.id}`,
      event,
      severity,
      title: deliveryIsCompleted ? 'Recojo pendiente' : 'Recojo con entrega incompleta',
      reason: deliveryIsCompleted
        ? 'El recojo aun no fue confirmado.'
        : logisticsMode === 'recojo'
        ? 'Antes de que el cliente recoja, inventario debe confirmar el alistamiento.'
        : 'Antes de recoger, confirma que realmente se entrego al cliente.',
      blockers,
      progress,
      dateKey: eventDateKey,
    };
  };

  const operationalAlerts = normalizedEvents
    .map(getOperationalAlertForEvent)
    .filter(Boolean)
    .sort((left, right) => `${right.dateKey}T${right.event.startTime}`.localeCompare(`${left.dateKey}T${left.event.startTime}`, 'es'))
    .slice(0, 6);

  const getDaySummary = (dayEvents = []) => {
    const groupedByType = dayEvents.reduce(
      (acc, event) => {
        const type = EVENT_TYPE_META[event.type] ? event.type : 'other';
        if (!acc[type]) {
          acc[type] = { count: 0, progressTotal: 0 };
        }
        acc[type].count += 1;
        acc[type].progressTotal += getEventProgress(event);
        return acc;
      },
      {},
    );

    return {
      total: dayEvents.length,
      byType: EVENT_TYPE_ORDER
        .map((type) => {
          const group = groupedByType[type];
          return {
            type,
            count: group?.count ?? 0,
            progress: group?.count ? Math.round(group.progressTotal / group.count) : 0,
            meta: getTypeMeta(type),
          };
        })
        .filter((item) => item.count > 0),
    };
  };

  const renderEventChip = (event, dateKey, compact = false) => {
    const typeMeta = getTypeMeta(event.type);
    const statusMeta = getStatusMeta(event.status);
    return (
      <button
        type="button"
        key={`${dateKey}-${event.id}`}
        className={`event-chip ${typeMeta.className} ${compact ? 'compact' : ''}`}
        onClick={(clickEvent) => {
          clickEvent.stopPropagation();
          handleEventClick(event, dateKey);
        }}
      >
        <strong>{event.startTime}</strong>
        <span>{event.title}</span>
        {!compact ? <small>{statusMeta.label}</small> : null}
      </button>
    );
  };

  const renderMonthView = () => (
    <div className="calendar-grid">
      <div className="calendar-weekdays">
        {weekdayLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="calendar-days">
        {monthGrid.map((cell) => {
          const summary = getDaySummary(cell.events);
          const alertCount = normalizedEvents
            .filter((event) => event.dateKey === cell.id)
            .filter((event) => getOperationalAlertForEvent(event)).length;

          return (
            <button
              type="button"
              key={cell.id}
              className={`calendar-day ${cell.inCurrentMonth ? '' : 'muted'} ${selectedDateKey === cell.id ? 'selected' : ''} ${cell.isToday ? 'today' : ''} ${alertCount ? 'has-operational-alert' : ''}`}
              onClick={() => setSelectedDateKey(cell.id)}
            >
              <span className="day-number">{cell.day}</span>
              {alertCount ? (
                <span className="calendar-day-alert-dot" title={`${alertCount} alerta${alertCount === 1 ? '' : 's'} operativa${alertCount === 1 ? '' : 's'}`}>
                  {alertCount}
                </span>
              ) : null}
              {cell.events.length > 0 ? (
                <div className="calendar-day-bubbles" aria-label={`${cell.events.length} eventos`}>
                  {summary.byType.map((item) => (
                    <span
                      key={item.type}
                      className={`calendar-bubble calendar-progress-bubble ${item.meta.className}`}
                      title={`${item.meta.label}: ${item.count} | Avance ${item.progress}%`}
                    >
                      <strong>{item.count}</strong>
                      <small>{item.progress}%</small>
                    </span>
                  ))}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderWeekView = () => (
    <div className="calendar-week-board">
      {selectedWeekDays.map((day) => (
        <article key={day.id} className={`calendar-week-column ${day.id === selectedDateKey ? 'selected' : ''} ${day.isToday ? 'today' : ''}`}>
          <button type="button" className="calendar-week-head" onClick={() => setSelectedDateKey(day.id)}>
            <span>{day.dayLabel}</span>
            <strong>{day.date.getDate()}</strong>
          </button>
          <div className="calendar-week-events">
            {day.events.map((event) => renderEventChip(event, day.id))}
            {day.events.length === 0 ? <p>Sin eventos</p> : null}
          </div>
        </article>
      ))}
    </div>
  );

  const renderDayView = () => (
    <div className="calendar-day-board">
      <header>
        <span>{formatLongDate(selectedDateKey)}</span>
        <strong>{selectedDayEvents.length} eventos</strong>
      </header>
      <div className="calendar-day-agenda">
        {selectedDayEvents.map((event) => {
          const typeMeta = getTypeMeta(event.type);
          const statusMeta = getStatusMeta(event.status);
          return (
            <button
              type="button"
              key={event.id}
              className={`calendar-agenda-row ${typeMeta.className}`}
              onClick={() => handleEventClick(event, selectedDateKey)}
            >
              <span className={`calendar-event-icon ${statusMeta.className}`}>
                <DayEventIcon kind={event.type} />
              </span>
              <span>
                <strong>{event.startTime} - {event.endTime}</strong>
                <small>{typeMeta.singular || typeMeta.label}</small>
              </span>
              <span className="calendar-agenda-title">
                <strong>{event.operationLabel || event.title}</strong>
                <small>{event.customerName || 'Cliente sin registrar'}{event.eventName ? ` - ${event.eventName}` : ''}</small>
                {event.referenceLine ? <small>{event.referenceLine}</small> : null}
                {event.detailLine ? <small>{event.detailLine}</small> : null}
              </span>
              <span className={`calendar-event-state ${statusMeta.className}`}>{statusMeta.label}</span>
            </button>
          );
        })}
        {selectedDayEvents.length === 0 ? (
          <div className="calendar-empty-day">
            <strong>Sin eventos</strong>
            <p>No hay actividades programadas para este dia.</p>
            <button type="button" className="primary-button" onClick={openCreateModal}>Crear evento</button>
          </div>
        ) : null}
      </div>
    </div>
  );

  const renderDispatchTable = (title, rows, kind) => (
    <section className={`calendar-dispatch-column ${kind}`}>
      <header>
        <div>
          <h4>{title}</h4>
          <p>{rows.length} registros</p>
        </div>
      </header>
      <div className="calendar-dispatch-table">
        <div className="calendar-dispatch-row calendar-dispatch-row-head">
          <span>Hora</span>
          <span>Codigo</span>
          <span>Responsable</span>
          <span>Destino</span>
          <span>Estado</span>
          <span>Nota</span>
        </div>
        {rows.map((row) => {
          const rowAlert = getOperationalAlertForEvent(row.event);
          const savedNote = boardNotes[row.id]?.text;
          const isReminderOpen = Boolean(savedNote && openBoardReminderId === row.id);
          return (
            <button
              type="button"
              key={row.id}
              className={`calendar-dispatch-row ${row.status.className} ${savedNote ? 'has-board-note' : ''} ${isReminderOpen ? 'reminder-open' : ''} ${rowAlert ? `has-operational-alert ${rowAlert.severity}` : ''}`}
              onClick={() => handleEventClick(row.event, selectedDateKey)}
              onDoubleClick={(event) => {
                event.preventDefault();
                openBoardNoteEditor(row);
              }}
              onContextMenu={(contextEvent) => openBoardContextMenu(contextEvent, row)}
              title="Clic derecho o doble clic para ver detalles y recordatorios."
            >
              <strong>{row.time}</strong>
              <span>{row.code}</span>
              <span>{row.responsible}</span>
              <span className="calendar-dispatch-detail">
                <b>{row.title}</b>
                {rowAlert ? <small className="calendar-dispatch-warning">Alerta operativa</small> : null}
              </span>
              <span className={`calendar-event-state ${row.status.className}`}>{row.status.label}</span>
              <span
                className={`calendar-board-row-bell ${savedNote ? 'active' : ''}`}
                aria-label={savedNote ? 'Ver recordatorio' : 'Sin recordatorio'}
                aria-expanded={isReminderOpen}
                onClick={(event) => {
                  if (!savedNote) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setOpenBoardReminderId((currentId) => (currentId === row.id ? null : row.id));
                }}
              >
                {savedNote ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
                    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                  </svg>
                ) : null}
              </span>
              {isReminderOpen ? (
                <span className="calendar-board-reminder-card">
                  <span className="calendar-board-reminder-head">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
                      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                    </svg>
                    <b>Recordatorio operativo</b>
                  </span>
                  <small>{savedNote}</small>
                </span>
              ) : null}
            </button>
          );
        })}
        {rows.length === 0 ? (
          <div className="calendar-dispatch-empty">
            <strong>Sin {kind === 'return' ? 'recojos' : 'entregas'}</strong>
            <span>No hay registros para esta fecha.</span>
          </div>
        ) : null}
      </div>
    </section>
  );

  const renderCreateModal = () => {
    if (!isCreateOpen) return null;

    return (
      <div className="orders-modal-backdrop" onClick={closeCreateModal}>
        <form className="orders-modal calendar-event-modal" onSubmit={handleSubmitEvent} onClick={(event) => event.stopPropagation()}>
          <header className="orders-modal-head">
            <div>
              <h3>Nuevo evento</h3>
              <p>Agrega una actividad manual al calendario.</p>
            </div>
            <button type="button" className="orders-modal-close" onClick={closeCreateModal}>x</button>
          </header>
          <div className="calendar-event-form">
            <label>
              Titulo
              <input value={eventForm.title} onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label>
              Fecha
              <input type="date" value={eventForm.date} onChange={(event) => setEventForm((current) => ({ ...current, date: event.target.value }))} />
            </label>
            <label>
              Inicio
              <input type="time" value={eventForm.startTime} onChange={(event) => setEventForm((current) => ({ ...current, startTime: event.target.value }))} />
            </label>
            <label>
              Fin
              <input type="time" value={eventForm.endTime} onChange={(event) => setEventForm((current) => ({ ...current, endTime: event.target.value }))} />
            </label>
            <label>
              Tipo
              <select value={eventForm.type} onChange={(event) => setEventForm((current) => ({ ...current, type: event.target.value }))}>
                <option value="other">Otro</option>
                <option value="delivery">Entrega</option>
                <option value="service">Servicio</option>
                <option value="maintenance">Mantenimiento</option>
                <option value="license">Vencimiento</option>
              </select>
            </label>
            <label>
              Estado
              <select value={eventForm.status} onChange={(event) => setEventForm((current) => ({ ...current, status: event.target.value }))}>
                <option value="programada">Programada</option>
                <option value="confirmado">Confirmado</option>
                <option value="en_ruta">En ruta</option>
                <option value="completada">Completada</option>
              </select>
            </label>
            <label className="calendar-field-span-2">
              Descripcion
              <textarea value={eventForm.subtitle} onChange={(event) => setEventForm((current) => ({ ...current, subtitle: event.target.value }))} rows={3} />
            </label>
            {formError ? <p className="status error calendar-field-span-2">{formError}</p> : null}
          </div>
          <footer className="orders-modal-foot">
            <button type="button" className="ghost-button" onClick={closeCreateModal}>Cancelar</button>
            <button type="submit" className="primary-button">Guardar evento</button>
          </footer>
        </form>
      </div>
    );
  };

  const renderBoardContextMenu = () => {
    if (!boardContextMenu) return null;
    const { row, x, y } = boardContextMenu;
    const savedNote = boardNotes[row.id]?.text;
    return (
      <div className="calendar-context-backdrop" onClick={() => setBoardContextMenu(null)}>
        <div className="calendar-board-context-menu" style={{ left: x, top: y }} onClick={(event) => event.stopPropagation()}>
          <strong>{row.title}</strong>
          <small>{row.time} | {row.code}</small>
          <button
            type="button"
            onClick={() => {
              setBoardContextMenu(null);
              handleEventClick(row.event, selectedDateKey);
            }}
          >
            Ver detalle completo
          </button>
          <button type="button" onClick={() => openBoardNoteEditor(row)}>
            {savedNote ? 'Ver / editar recordatorio' : 'Crear recordatorio visible'}
          </button>
          {savedNote ? <p>{savedNote}</p> : null}
        </div>
      </div>
    );
  };

  const renderBoardNoteModal = () => {
    if (!boardNoteTarget) return null;
    const savedNote = boardNotes[boardNoteTarget.id];
    return (
      <div className="orders-modal-backdrop" onClick={() => setBoardNoteTarget(null)}>
        <section className="orders-modal calendar-board-note-modal" onClick={(event) => event.stopPropagation()}>
          <header className="orders-modal-head">
            <div>
              <span className="calendar-board-note-kicker">Pizarra operativa</span>
              <h3>Recordatorio operativo</h3>
              <p>{boardNoteTarget.time} | {boardNoteTarget.code} | {boardNoteTarget.title}</p>
            </div>
            <button type="button" className="orders-modal-close" onClick={() => setBoardNoteTarget(null)}>x</button>
          </header>
          <div className="calendar-board-note-body">
            <article>
              <small>Responsable</small>
              <strong>{boardNoteTarget.responsible}</strong>
            </article>
            <article>
              <small>Destino</small>
              <strong>{boardNoteTarget.title}</strong>
            </article>
            <article className="wide">
              <small>Detalle del sistema</small>
              <strong>{boardNoteTarget.details}</strong>
              <span>{boardNoteTarget.notes}</span>
            </article>
            <label className="wide">
              Recordatorio visible para todo el equipo
              <textarea
                value={boardNoteText}
                onChange={(event) => setBoardNoteText(event.target.value)}
                rows={5}
                placeholder="Ej: confirmar vajilla antes de cargar, llamar al cliente, llevar mantel extra..."
              />
            </label>
            {savedNote?.updatedAt ? (
              <p className="calendar-board-note-updated">
                Ultima actualizacion: {new Date(savedNote.updatedAt).toLocaleString('es-BO')}
              </p>
            ) : null}
          </div>
          <footer className="orders-modal-foot">
            <button type="button" className="ghost-button" onClick={() => setBoardNoteTarget(null)}>Cancelar</button>
            {boardNotes[boardNoteTarget.id]?.text ? (
              <button
                type="button"
                className="ghost-button danger"
                onClick={() => {
                  const nextNotes = { ...boardNotes };
                  delete nextNotes[boardNoteTarget.id];
                  persistBoardNotes(nextNotes);
                  api.calendar.removeBoardNote({ rowId: boardNoteTarget.id }).catch(() => {});
                  setBoardNoteText('');
                  setOpenBoardReminderId((currentId) => (currentId === boardNoteTarget.id ? null : currentId));
                  setBoardNoteTarget(null);
                }}
              >
                Quitar recordatorio
              </button>
            ) : null}
            <button type="button" className="primary-button" onClick={saveBoardNote}>Guardar</button>
          </footer>
        </section>
      </div>
    );
  };

  const renderOperationalAlertsPanel = () => (
    <section className={`calendar-main-alerts ${operationalAlerts.length ? 'has-alerts' : ''}`}>
      <header>
        <div>
          <h4>Alertas operativas</h4>
          <p>Entregas, recojos y responsables con pasos pendientes.</p>
        </div>
        <strong>{operationalAlerts.length} alerta{operationalAlerts.length === 1 ? '' : 's'}</strong>
      </header>
      <div>
        {operationalAlerts.map((alert) => (
          <button
            type="button"
            key={alert.id}
            className={alert.severity}
            onClick={() => handleEventClick(alert.event, alert.event.dateKey)}
          >
            <span>{alert.severity === 'critical' ? '!' : 'i'}</span>
            <span>
              <b>{alert.title}</b>
              <small>{formatShortDate(alert.dateKey)} | {alert.event.startTime} | {alert.event.customerName || alert.event.subtitle || 'Cliente sin registrar'}</small>
              <em>{alert.reason}</em>
              <small className="calendar-alert-blockers">
                {alert.blockers.map((blocker) => blocker.area).join(' / ')} | Avance {alert.progress}%
              </small>
            </span>
          </button>
        ))}
        {operationalAlerts.length === 0 ? (
          <article>
            <strong>Sin pendientes operativos</strong>
            <small>Si una entrega vence incompleta o un recojo depende de una entrega no realizada, aparecera aqui.</small>
          </article>
        ) : null}
      </div>
    </section>
  );

  const openLinkedContract = async (event) => {
    try {
      const { contract, rental } = getLinkedContext(event);
      const preview = await onPrintContractDocument?.({
        contractId: contract?.id ?? event.contractId,
        rentalId: rental?.id ?? event.rentalId,
        orderCode: rental?.orderCode ?? event.orderCode,
      });
      if (preview?.html) {
        setDocumentPreview({
          title: preview.title ?? `Contrato ${contract?.contractCode ?? event.contractCode ?? ''}`.trim(),
          html: preview.html,
        });
      }
    } catch (error) {
      setFormError(error?.message || 'No se pudo abrir el contrato vinculado.');
    }
  };

  const printDocumentPreview = () => {
    const frame = document.getElementById('calendar-document-preview-frame');
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  };

  const renderDetailModal = () => {
    if (!detailEvent) return null;
    const statusMeta = getStatusMeta(detailEvent.status);
    const { contract: linkedContract, rental: linkedRental } = getLinkedContext(detailEvent);
    const logisticsMode = detailEvent.logisticsMode ?? linkedContract?.logisticsMode ?? linkedRental?.logisticsMode ?? 'envio';
    const logisticsMeta = getLogisticsMeta(logisticsMode);
    const operational = linkedRental?.operational ?? {};
    const inventoryStatus = getOperationalStatusMeta('inventory', operational.inventoryStatus);
    const transportStatus = getOperationalStatusMeta('transport', operational.transportStatus);
    const detailProgress = getEventProgress(detailEvent);
    const detailAlert = getOperationalAlertForEvent(detailEvent);

    return (
      <div className="orders-modal-backdrop" onClick={() => setDetailEvent(null)}>
        <section className="orders-modal calendar-event-modal" onClick={(event) => event.stopPropagation()}>
          <header className="orders-modal-head">
            <div>
              <h3>{detailEvent.operationLabel || detailEvent.title}</h3>
              <p>{formatLongDate(detailEvent.dateKey)} | {detailEvent.customerName || 'Cliente sin registrar'}</p>
            </div>
            <button type="button" className="orders-modal-close" onClick={() => setDetailEvent(null)}>x</button>
          </header>
          {formError ? <p className="status error calendar-detail-error">{formError}</p> : null}
          {detailAlert ? (
            <div className={`calendar-detail-operational-alert ${detailAlert.severity}`}>
              <strong>{detailAlert.title}</strong>
              <span>{detailAlert.reason}</span>
              <small>
                Pendiente: {detailAlert.blockers.map((blocker) => `${blocker.area}: ${blocker.detail}`).join(' | ')}
              </small>
            </div>
          ) : null}
          <div className="calendar-detail-body">
            <article>
              <small>Horario</small>
              <strong>{detailEvent.startTime} - {detailEvent.endTime}</strong>
            </article>
            <article>
              <small>Estado</small>
              <strong>{statusMeta.label}</strong>
            </article>
            <article>
              <small>Avance</small>
              <strong>{detailProgress}%</strong>
            </article>
            <article>
              <small>Referencia</small>
              <strong>{detailEvent.referenceLine || (detailEvent.relatedType ? `${detailEvent.relatedType} ${detailEvent.relatedId ?? ''}` : 'Evento manual')}</strong>
            </article>
            <article className="calendar-detail-owner">
              <small>Responsable</small>
              <span>
                <b>{detailEvent.responsibleInitials || 'S'}</b>
                <strong>{detailEvent.responsibleName || 'Sistema'}</strong>
              </span>
              <em>{detailEvent.responsibleRole || 'Operacion'}</em>
            </article>
            <article>
              <small>Evento</small>
              <strong>{detailEvent.eventName || linkedContract?.eventType || 'Sin evento registrado'}</strong>
            </article>
            <article>
              <small>Logistica</small>
              <strong>{detailEvent.operationLabel || logisticsMeta.label}</strong>
              <span>{getOperationDetail(detailEvent.type, logisticsMode)}</span>
            </article>
            <article className="wide">
              <small>Descripcion</small>
              <strong>{detailEvent.title}</strong>
              <span>{detailEvent.subtitle || 'Sin descripcion registrada.'}</span>
              {detailEvent.detailLine ? <strong>{detailEvent.detailLine}</strong> : null}
            </article>
            {linkedContract || linkedRental ? (
              <article className="wide calendar-linked-contract-card">
                <small>Panorama del servicio</small>
                <strong>
                  {linkedContract?.contractCode ?? 'Sin contrato'} | {linkedRental?.orderCode ?? detailEvent.orderCode ?? 'sin orden'}
                </strong>
                <span>{linkedContract?.customerName ?? linkedRental?.customerName ?? detailEvent.customerName ?? 'Cliente sin registrar'}</span>
                <span className="calendar-linked-owner">
                  Responsable: {detailEvent.responsibleName || linkedContract?.createdByName || linkedRental?.createdByName || 'Sistema'}
                  {' | '}
                  {detailEvent.responsibleRole || linkedContract?.createdByRole || linkedRental?.createdByRole || 'Operacion'}
                </span>
                <span className={`calendar-logistics-badge ${logisticsMeta.className}`}>{detailEvent.operationLabel || logisticsMeta.label}</span>
                <span>
                  {(linkedContract?.items?.length ?? linkedRental?.items?.length ?? detailEvent.itemsCount ?? 0)} items
                  {' | '}
                  Total Bs {Number(linkedContract?.totals?.totalBs ?? linkedRental?.totals?.totalBs ?? detailEvent.totalBs ?? 0).toFixed(2)}
                  {' | '}
                  {linkedContract?.status ?? linkedRental?.status ?? 'sin estado'}
                </span>
                <div className="calendar-operational-flow">
                  <div>
                    <small>Inventario</small>
                    <strong className={`orders-progress-dot ${inventoryStatus.className}`}>{inventoryStatus.label}</strong>
                    <span>{inventoryStatus.detail}</span>
                  </div>
                  <div>
                    <small>Transporte</small>
                    <strong className={`orders-progress-dot ${transportStatus.className}`}>{transportStatus.label}</strong>
                    <span>{transportStatus.detail}</span>
                  </div>
                </div>
                {linkedContract ? (
                  <button type="button" className="primary-button" onClick={() => openLinkedContract(detailEvent)}>
                    Ver contrato completo
                  </button>
                ) : (
                  <span>No hay contrato vinculado a este evento.</span>
                )}
              </article>
            ) : null}
          </div>
          <footer className="orders-modal-foot">
            <button type="button" className="primary-button" onClick={() => setDetailEvent(null)}>Cerrar</button>
          </footer>
        </section>
      </div>
    );
  };

  const renderDocumentPreviewModal = () => {
    if (!documentPreview) return null;

    return (
      <div className="orders-modal-backdrop" onClick={() => setDocumentPreview(null)}>
        <div className="orders-modal orders-preview-modal" onClick={(event) => event.stopPropagation()}>
          <header className="orders-modal-head">
            <div>
              <h3>{documentPreview.title}</h3>
              <p>Vista previa del documento. Puedes revisarlo e imprimirlo desde aqui.</p>
            </div>
            <button type="button" className="orders-modal-close" onClick={() => setDocumentPreview(null)}>x</button>
          </header>
          <div className="orders-preview-body">
            <iframe
              id="calendar-document-preview-frame"
              title={documentPreview.title}
              srcDoc={documentPreview.html}
              className="orders-document-frame"
            />
          </div>
          <footer className="orders-modal-foot">
            <button type="button" className="ghost-button" onClick={() => setDocumentPreview(null)}>Cerrar</button>
            <button type="button" className="primary-button" onClick={printDocumentPreview}>Imprimir / guardar PDF</button>
          </footer>
        </div>
      </div>
    );
  };

  return (
    <section className="panel calendar-dashboard">
      <header className="calendar-header">
        <div>
          <h2>Calendario</h2>
          <p>Agenda diaria de entregas, servicios, mantenimientos y vencimientos.</p>
        </div>
        <div className="calendar-header-actions">
          <button type="button" className="ghost-button" onClick={goToday}>Hoy</button>
          <button type="button" className="primary-button" onClick={openCreateModal}>+ Nuevo Evento</button>
        </div>
      </header>

      <div className="calendar-kpis">
        <article className="calendar-kpi-card lilac">
          <span className="calendar-kpi-icon lilac"><KpiIcon kind="calendar" /></span>
          <strong>{metrics.total}</strong>
          <p>Eventos este mes</p>
          <button type="button" onClick={() => setTypeFilter('all')}>Ver agenda completa {'->'}</button>
        </article>
        <article className="calendar-kpi-card sky">
          <span className="calendar-kpi-icon sky"><KpiIcon kind="truck" /></span>
          <strong>{metrics.deliveries}</strong>
          <p>Entregas programadas</p>
          <button type="button" onClick={() => setTypeFilter('delivery')}>Ver entregas {'->'}</button>
        </article>
        <article className="calendar-kpi-card mint">
          <span className="calendar-kpi-icon mint"><KpiIcon kind="tool" /></span>
          <strong>{metrics.maintenance}</strong>
          <p>Mantenimientos proximos</p>
          <button type="button" onClick={() => setTypeFilter('maintenance')}>Ver mantenimiento {'->'}</button>
        </article>
        <article className="calendar-kpi-card peach">
          <span className="calendar-kpi-icon peach"><KpiIcon kind="clock" /></span>
          <strong>{Math.max(metrics.late, operationalAlerts.length)}</strong>
          <p>Alertas retrasadas</p>
          <button type="button" onClick={() => setViewMode('day')}>Ver alertas {'->'}</button>
        </article>
      </div>

      <div className="calendar-redesign-stack">
        <article className="calendar-main-card">
          <div className="calendar-card-title">
            <h3>Calendario</h3>
          </div>
          <header className="calendar-controls">
            <div className="calendar-filters">
              {Object.entries(EVENT_TYPE_META).map(([key, meta]) => (
                <button key={key} type="button" className={typeFilter === key ? 'active' : ''} onClick={() => setTypeFilter(key)}>
                  {meta.label}
                </button>
              ))}
            </div>
          </header>

          <div className="calendar-nav-strip">
            <span className="calendar-nav-spacer" aria-hidden="true" />
            <div className="calendar-month-bar">
              <button type="button" onClick={() => {
                setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1));
                setIsMonthPickerOpen(false);
              }}>{'<'}</button>
              <div>
                <button
                  type="button"
                  className="calendar-month-title-button"
                  onClick={() => setIsMonthPickerOpen((current) => !current)}
                  aria-expanded={isMonthPickerOpen}
                >
                  <h3>{monthTitle}</h3>
                </button>
                <p>{typeFilter === 'all' ? 'Todos los eventos' : EVENT_TYPE_META[typeFilter]?.label}</p>
                {isMonthPickerOpen ? (
                  <div className="calendar-month-picker">
                    <header>
                      <strong>Ir a mes</strong>
                      <button type="button" onClick={goToday}>Hoy</button>
                    </header>
                    <div className="calendar-year-row">
                      {pickerYears.map((year) => (
                        <button
                          type="button"
                          key={year}
                          className={monthDate.getFullYear() === year ? 'active' : ''}
                          onClick={() => setMonthDate(new Date(year, monthDate.getMonth(), 1))}
                        >
                          {year}
                        </button>
                      ))}
                    </div>
                    <div className="calendar-month-grid-picker">
                      {monthNames.map((name, index) => (
                        <button
                          type="button"
                          key={name}
                          className={monthDate.getMonth() === index ? 'active' : ''}
                          onClick={() => jumpToMonth(monthDate.getFullYear(), index)}
                        >
                          {name.slice(0, 3)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <button type="button" onClick={() => {
                setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1));
                setIsMonthPickerOpen(false);
              }}>{'>'}</button>
            </div>
            <div className="calendar-view-toggle">
              <button type="button" className={viewMode === 'month' ? 'active' : ''} onClick={() => setViewMode('month')}>Mes</button>
              <button type="button" className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>Semana</button>
              <button type="button" className={viewMode === 'day' ? 'active' : ''} onClick={() => setViewMode('day')}>Dia</button>
            </div>
          </div>

          {viewMode === 'month' ? renderMonthView() : viewMode === 'week' ? renderWeekView() : renderDayView()}

          <footer className="calendar-legend">
            <span><i className="delivery" /> Envio</span>
            <span><i className="service" /> Servicio</span>
            <span><i className="contract" /> Contrato</span>
            <span><i className="return" /> Recojo</span>
            <span><i className="loan" /> Prestamo</span>
            <span><i className="maintenance" /> Mantenimiento</span>
            <span><i className="license" /> Vencimiento</span>
            <span><i className="other" /> Otro</span>
          </footer>
        </article>

        <aside className="calendar-side-card calendar-board-card">
          <header>
            <div>
              <h3>Pizarra operativa</h3>
            </div>
            <span className="calendar-board-date">
              <KpiIcon kind="calendar" />
              {formatLongDate(selectedDateKey)}
            </span>
          </header>
          <div className="calendar-dispatch-board">
            {renderDispatchTable('Entregas', selectedDispatchRows.deliveries, 'delivery')}
            {renderDispatchTable('Recojos', selectedDispatchRows.returns, 'return')}
          </div>
          <ul>
            {selectedDayEvents.map((event) => {
              const statusMeta = getStatusMeta(event.status);
              const progress = getEventProgress(event);
              return (
                <li key={event.id} className={statusMeta.className}>
                  <button type="button" onClick={() => handleEventClick(event, selectedDateKey)}>
                    <span className={`calendar-event-icon ${statusMeta.className}`}>
                      <DayEventIcon kind={event.type} />
                    </span>
                    <span className="calendar-side-copy">
                      <strong>{event.startTime} - {event.endTime}</strong>
                      <em>{event.operationLabel || event.title}</em>
                      <small className="calendar-side-main">{event.customerName || 'Cliente sin registrar'}{event.eventName ? ` - ${event.eventName}` : ''}</small>
                      <span className="calendar-side-owner">
                        <b>{event.responsibleInitials || 'S'}</b>
                        <small>
                          Responsable: {event.responsibleName || 'Sistema'}
                          {event.responsibleRole ? ` · ${event.responsibleRole}` : ''}
                        </small>
                      </span>
                      {event.referenceLine ? <small>{event.referenceLine}</small> : null}
                      {event.detailLine ? <small>{event.detailLine}</small> : null}
                    </span>
                    <span className="calendar-side-state-stack">
                      <span className={`calendar-event-state ${statusMeta.className}`}>{statusMeta.label}</span>
                      <small>Avance {progress}%</small>
                    </span>
                  </button>
                </li>
              );
            })}
            {selectedDayEvents.length === 0 ? (
              <li className="scheduled empty">
                <strong>Sin eventos</strong>
                <p>No hay actividades para este dia.</p>
              </li>
            ) : null}
          </ul>
        </aside>
      </div>

      <div className="calendar-bottom-grid">
        <section className="calendar-upcoming">
          <h4>Proximos eventos</h4>
          {upcomingEvents.slice(0, 4).map((event) => (
            <button
              type="button"
              key={event.id}
              className={`calendar-upcoming-item ${getTypeMeta(event.type).className}`}
              onClick={() => handleEventClick(event, event.dateKey)}
            >
              <span className="calendar-upcoming-icon"><DayEventIcon kind={event.type} /></span>
              <span className="calendar-upcoming-date">{formatShortDate(event.dateKey)}</span>
              <strong>
                {event.operationLabel || event.title}
                <small>{event.customerName || event.subtitle}{event.eventName ? ` - ${event.eventName}` : ''}</small>
                <small>{event.responsibleName ? `Resp. ${event.responsibleName}` : 'Resp. Sistema'}</small>
              </strong>
            </button>
          ))}
          {upcomingEvents.length === 0 ? <p>Sin proximos eventos con este filtro.</p> : null}
        </section>

        {renderOperationalAlertsPanel()}

        <section className="calendar-ops-summary">
          <h4>Estado operativo</h4>
          <div className="calendar-ops-grid">
            <article className="ok"><span>Contratos finalizados</span><strong>{operationalInsights.successfulReturns.length}</strong><small>Sin penalidades</small></article>
            <article className="late"><span>Contratos retrasados</span><strong>{operationalInsights.lateRentals.length}</strong><small>Devolucion vencida</small></article>
            <article className="ontime"><span>Contratos a tiempo</span><strong>{operationalInsights.onTimeRentals.length}</strong><small>Activos vigentes</small></article>
            <article className="loan"><span>Prestamos activos</span><strong>{operationalInsights.activeLoans.length}</strong><small>{operationalInsights.lateLoans.length} retrasados</small></article>
          </div>
        </section>
      </div>

      {renderCreateModal()}
      {renderDetailModal()}
      {renderDocumentPreviewModal()}
      {renderBoardContextMenu()}
      {renderBoardNoteModal()}
    </section>
  );
}

export default CalendarSection;
