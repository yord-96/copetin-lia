import { useEffect, useMemo, useRef, useState } from 'react';
import { readFileAsDataUrl } from '../../utils/files';

const deliveryStateMap = {
  en_ruta: { label: 'En Ruta', className: 'route' },
  programada: { label: 'Programada', className: 'scheduled' },
  completada: { label: 'Completada', className: 'done' },
  incidencia: { label: 'Incidencia', className: 'issue' },
  cancelada: { label: 'Cancelada', className: 'issue' },
};

const vehicleStateMap = {
  activo: { label: 'Activo', className: 'done' },
  mantenimiento: { label: 'Mantenimiento', className: 'scheduled' },
  fuera_servicio: { label: 'Fuera de servicio', className: 'issue' },
};

const driverStateMap = {
  activo: { label: 'Activo', className: 'done' },
  vacaciones: { label: 'Vacaciones', className: 'route' },
  suspendido: { label: 'Suspendido', className: 'issue' },
};

const STATUS_PROGRESS = {
  programada: 0,
  en_ruta: 55,
  completada: 100,
  incidencia: 35,
  cancelada: 0,
};

const ROUTE_PRIORITY_META = {
  alta: { label: 'Alta', className: 'high', weight: 3 },
  media: { label: 'Media', className: 'medium', weight: 2 },
  baja: { label: 'Baja', className: 'low', weight: 1 },
};

const DELIVERY_PAGE_SIZES = [5, 10, 20];

const transportRouteStateMap = {
  borrador: { label: 'Borrador', className: 'scheduled' },
  planificada: { label: 'Planificada', className: 'route' },
  en_ruta: { label: 'En Ruta', className: 'route' },
  completada: { label: 'Completada', className: 'done' },
  cancelada: { label: 'Cancelada', className: 'issue' },
};

const initials = (name) =>
  String(name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

const formatDate = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatHour = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const clampProgress = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.trunc(numeric)));
};

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

const getRoutePriority = (delivery) => {
  const status = String(delivery?.status ?? '').trim();
  if (status === 'incidencia' || status === 'en_ruta') return ROUTE_PRIORITY_META.alta;
  if (status === 'completada') return ROUTE_PRIORITY_META.baja;

  const scheduledTime = new Date(String(delivery?.scheduledDate ?? '')).getTime();
  if (!Number.isFinite(scheduledTime)) return ROUTE_PRIORITY_META.media;

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.floor((scheduledTime - startToday) / (1000 * 60 * 60 * 24));
  if (diffDays <= 1) return ROUTE_PRIORITY_META.alta;
  if (diffDays <= 3) return ROUTE_PRIORITY_META.media;
  return ROUTE_PRIORITY_META.baja;
};

const getTodayKey = () => toDateKey(new Date());

const padDatePart = (value) => String(value).padStart(2, '0');

const toDateKey = (date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;

const parseDateKey = (value) => {
  const [year, month, day] = String(value ?? '').split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
};

const getMonthStartFromKey = (value) => {
  const parsed = parseDateKey(value);
  return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
};

const shiftMonth = (value, delta) => new Date(value.getFullYear(), value.getMonth() + delta, 1);

const getPlannerMonthDays = (monthDate) => {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(firstDay.getFullYear(), firstDay.getMonth(), 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      key: toDateKey(date),
      label: date.getDate(),
      inMonth: date.getMonth() === monthDate.getMonth(),
    };
  });
};

const formatPlannerMonth = (value) =>
  value.toLocaleDateString('es-BO', { month: 'long', year: 'numeric' });

const isPickupDelivery = (delivery) => {
  if (delivery?.routeType === 'recojo') return true;
  if (delivery?.routeType === 'envio') return false;
  const note = String(delivery?.notes ?? '').toLowerCase();
  return note.includes('recojo') || note.includes('recog');
};

const getDeliveryRouteType = (delivery) => (isPickupDelivery(delivery) ? 'recojo' : 'envio');

const getStopAddress = (delivery) =>
  [delivery?.address, delivery?.city].map((part) => String(part ?? '').trim()).filter(Boolean).join(', ');

const buildEmbeddedMapUrl = (query) => {
  const cleanQuery = String(query ?? '').trim();
  if (!cleanQuery) return '';
  return `https://maps.google.com/maps?q=${encodeURIComponent(cleanQuery)}&output=embed`;
};

const pseudoMapPoint = (text, index) => {
  const source = String(text ?? '') || `stop-${index}`;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % 9973;
  }
  return {
    left: 12 + ((hash + index * 17) % 76),
    top: 16 + ((Math.floor(hash / 7) + index * 23) % 68),
  };
};

const getDeliveryScheduleTime = (delivery) => {
  const dateText = String(delivery?.scheduledDate ?? '').trim();
  const timeText = String(delivery?.windowStart ?? '00:00').trim() || '00:00';
  const timestamp = new Date(`${dateText}T${timeText}`).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
};

const getDeliveryWorkSort = (delivery) => {
  const status = String(delivery?.status ?? '').trim();
  const scheduleTime = getDeliveryScheduleTime(delivery);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  if (status === 'completada' || status === 'cancelada') {
    return { bucket: 3, scheduleTime };
  }

  if (scheduleTime >= todayStart) {
    return { bucket: 0, scheduleTime };
  }

  return { bucket: 1, scheduleTime };
};

const getDeliveryTransition = (status) => {
  if (status === 'programada') {
    return { nextStatus: 'en_ruta', nextProgress: STATUS_PROGRESS.en_ruta, label: 'Iniciar ruta' };
  }
  if (status === 'en_ruta') {
    return { nextStatus: 'completada', nextProgress: STATUS_PROGRESS.completada, label: 'Completar' };
  }
  if (status === 'incidencia') {
    return { nextStatus: 'en_ruta', nextProgress: STATUS_PROGRESS.en_ruta, label: 'Retomar' };
  }
  return { nextStatus: 'programada', nextProgress: STATUS_PROGRESS.programada, label: 'Reabrir' };
};

function KpiIcon({ kind }) {
  if (kind === 'truck') {
    return <img className="asset-icon truck-asset-icon" src="/imagenes/camion.png" alt="" aria-hidden="true" />;
  }

  if (kind === 'maintenance') {
    return <img className="asset-icon maintenance-asset-icon" src="/imagenes/herramientas-de-construccion.png" alt="" aria-hidden="true" />;
  }

  if (kind === 'clock') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M12 7.5v5l3 2" />
      </svg>
    );
  }

  if (kind === 'check') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.2 2.2 2.2 4.8-4.8" />
      </svg>
    );
  }

  if (kind === 'alert') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 4 20 18H4L12 4Zm0 5v4m0 3h.01" />
      </svg>
    );
  }

  if (kind === 'speed') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M5 15a7 7 0 1 1 14 0" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M12 12l4-2" />
      </svg>
    );
  }

  if (kind === 'driver') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M5 18.5c0-3 2.8-4.8 7-4.8s7 1.8 7 4.8" />
      </svg>
    );
  }

  return null;
}

function ModalFrame({ title, subtitle, onClose, children, className = '' }) {
  return (
    <div className="transport-modal-backdrop" onClick={onClose}>
      <section
        className={`transport-modal ${className}`.trim()}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="transport-modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="transport-modal-close" onClick={onClose} aria-label="Cerrar">
            x
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function ReturnSection({
  activeModule = 'devolucion',
  onGoToRental,
  onSwitchTransportModule,
  deliveries = [],
  contracts = [],
  transportRoutes = [],
  rentals = [],
  vehicles = [],
  drivers = [],
  onCreateDelivery,
  onUpdateDelivery,
  onCreateTransportRoute,
  onUpdateTransportRoute,
  onRegisterPickupChecklist,
  onCreateVehicle,
  onUpdateVehicle,
  onRemoveVehicle,
  onCreateDriver,
  onUpdateDriver,
  onRemoveDriver,
  onPrintRouteSheetDocument,
}) {
  const currentView = activeModule === 'devolucion_entregas'
    ? 'entregas'
    : activeModule === 'devolucion_recojos'
    ? 'recojos'
    : activeModule === 'devolucion_planificador'
    ? 'planificador'
    : activeModule === 'devolucion_rutas'
    ? 'flota'
    : 'transporte';

  const activeDriverId = useMemo(
    () => drivers.find((row) => row.status === 'activo')?.id ?? drivers[0]?.id ?? '',
    [drivers],
  );
  const activeVehicleId = useMemo(
    () => vehicles.find((row) => row.status === 'activo')?.id ?? vehicles[0]?.id ?? '',
    [vehicles],
  );

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [driverFilter, setDriverFilter] = useState('todos');
  const [vehicleFilter, setVehicleFilter] = useState('todos');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [deliveryPageSize, setDeliveryPageSize] = useState(10);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState(deliveries[0]?.id ?? '');
  const plannerType = 'mixta';
  const [plannerDate, setPlannerDate] = useState(getTodayKey());
  const [isPlannerCalendarOpen, setIsPlannerCalendarOpen] = useState(false);
  const [plannerCalendarMonth, setPlannerCalendarMonth] = useState(() => getMonthStartFromKey(getTodayKey()));
  const [plannerSearch, setPlannerSearch] = useState('');
  const [plannerStopFilter, setPlannerStopFilter] = useState('all');
  const [plannerPanelView, setPlannerPanelView] = useState('day');
  const [plannerMapSearch, setPlannerMapSearch] = useState('');
  const [selectedPlannerDeliveryId, setSelectedPlannerDeliveryId] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [routeDraft, setRouteDraft] = useState({
    driverId: '',
    vehicleId: '',
    notes: '',
  });
  const [routeSaveError, setRouteSaveError] = useState('');
  const [isSavingRoute, setIsSavingRoute] = useState(false);

  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleStatusFilter, setVehicleStatusFilter] = useState('todos');
  const [driverSearch, setDriverSearch] = useState('');
  const [driverStatusFilter, setDriverStatusFilter] = useState('todos');

  const [deliveryModalMode, setDeliveryModalMode] = useState('create');
  const [deliveryForm, setDeliveryForm] = useState(null);
  const [deliveryFormError, setDeliveryFormError] = useState('');
  const [isSavingDelivery, setIsSavingDelivery] = useState(false);

  const [vehicleForm, setVehicleForm] = useState(null);
  const [vehicleFormMode, setVehicleFormMode] = useState('create');
  const [vehicleFormError, setVehicleFormError] = useState('');
  const [isSavingVehicle, setIsSavingVehicle] = useState(false);

  const [driverForm, setDriverForm] = useState(null);
  const [driverFormMode, setDriverFormMode] = useState('create');
  const [driverFormError, setDriverFormError] = useState('');
  const [isSavingDriver, setIsSavingDriver] = useState(false);

  const [vehicleDetail, setVehicleDetail] = useState(null);
  const [driverDetail, setDriverDetail] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [documentPreview, setDocumentPreview] = useState(null);
  const [pickupModal, setPickupModal] = useState(null);
  const [pickupFormError, setPickupFormError] = useState('');
  const [isSavingPickup, setIsSavingPickup] = useState(false);
  const [isSavingVehiclePhoto, setIsSavingVehiclePhoto] = useState(false);
  const [isSavingDriverPhoto, setIsSavingDriverPhoto] = useState(false);
  const [openFleetMenu, setOpenFleetMenu] = useState(null);
  const [floatingMenuStyle, setFloatingMenuStyle] = useState(null);
  const openFleetMenuRef = useRef(null);

  const deliveriesForCurrentView = useMemo(() => {
    if (currentView === 'recojos') {
      return deliveries.filter((row) => isPickupDelivery(row));
    }
    if (currentView === 'entregas') {
      return deliveries.filter((row) => !isPickupDelivery(row));
    }
    return deliveries;
  }, [currentView, deliveries]);

  const filteredDeliveries = useMemo(() => {
    const text = String(query ?? '').trim().toLowerCase();
    return deliveriesForCurrentView.filter((row) => {
      if (statusFilter !== 'todos' && row.status !== statusFilter) return false;
      if (driverFilter !== 'todos' && row.driverId !== driverFilter) return false;
      if (vehicleFilter !== 'todos' && row.vehicleId !== vehicleFilter) return false;

      const rowDate = String(row.scheduledDate ?? '').slice(0, 10);
      if (dateFrom && rowDate && rowDate < dateFrom) return false;
      if (dateTo && rowDate && rowDate > dateTo) return false;

      if (!text) return true;
      return (
        String(row.deliveryCode ?? '').toLowerCase().includes(text)
        || String(row.orderCode ?? '').toLowerCase().includes(text)
        || String(row.customerName ?? '').toLowerCase().includes(text)
        || String(row.companyName ?? '').toLowerCase().includes(text)
        || String(row.driverName ?? '').toLowerCase().includes(text)
        || String(row.vehicleCode ?? '').toLowerCase().includes(text)
        || String(row.address ?? '').toLowerCase().includes(text)
        || String(row.city ?? '').toLowerCase().includes(text)
      );
    }).map((row) => ({
      ...row,
      priority: getRoutePriority(row),
    })).sort((a, b) => {
      const orderA = getDeliveryWorkSort(a);
      const orderB = getDeliveryWorkSort(b);
      if (orderA.bucket !== orderB.bucket) return orderA.bucket - orderB.bucket;
      if (orderA.bucket === 1) return orderB.scheduleTime - orderA.scheduleTime;
      if (orderA.scheduleTime !== orderB.scheduleTime) return orderA.scheduleTime - orderB.scheduleTime;
      return (b.priority?.weight ?? 0) - (a.priority?.weight ?? 0);
    });
  }, [dateFrom, dateTo, deliveriesForCurrentView, driverFilter, query, statusFilter, vehicleFilter]);

  useEffect(() => {
    setDeliveryPage(1);
  }, [query, statusFilter, driverFilter, vehicleFilter, dateFrom, dateTo]);

  const deliveryPageCount = Math.max(1, Math.ceil(filteredDeliveries.length / deliveryPageSize));

  useEffect(() => {
    if (deliveryPage > deliveryPageCount) {
      setDeliveryPage(deliveryPageCount);
    }
  }, [deliveryPage, deliveryPageCount]);

  const paginatedDeliveries = useMemo(() => {
    const start = (deliveryPage - 1) * deliveryPageSize;
    return filteredDeliveries.slice(start, start + deliveryPageSize);
  }, [deliveryPage, deliveryPageSize, filteredDeliveries]);

  useEffect(() => {
    if (!filteredDeliveries.some((row) => row.id === selectedDeliveryId)) {
      setSelectedDeliveryId(filteredDeliveries[0]?.id ?? '');
    }
  }, [filteredDeliveries, selectedDeliveryId]);

  const selectedDelivery = useMemo(
    () => filteredDeliveries.find((row) => row.id === selectedDeliveryId) ?? filteredDeliveries[0] ?? null,
    [filteredDeliveries, selectedDeliveryId],
  );

  const contractByRentalId = useMemo(() => {
    const map = new Map();
    contracts.forEach((contract) => {
      if (contract?.rentalId) map.set(String(contract.rentalId), contract);
    });
    return map;
  }, [contracts]);

  const contractByOrderCode = useMemo(() => {
    const map = new Map();
    contracts.forEach((contract) => {
      if (contract?.orderCode) map.set(String(contract.orderCode), contract);
    });
    return map;
  }, [contracts]);

  const plannerDeliveries = useMemo(() => {
    const realRows = deliveries
      .filter((delivery) => !delivery.deletedAt)
      .map((delivery) => {
        const rental = rentals.find((entry) =>
          !entry?.deletedAt
          && (
            (delivery.rentalId && entry.id === delivery.rentalId)
            || (delivery.orderCode && entry.orderCode === delivery.orderCode)
          )
        ) ?? null;
        const contract = contractByRentalId.get(String(rental?.id ?? ''))
          ?? contractByOrderCode.get(String(delivery.orderCode ?? rental?.orderCode ?? ''))
          ?? null;
        return {
          ...delivery,
          rentalId: delivery.rentalId ?? rental?.id ?? null,
          contractCode: delivery.contractCode ?? contract?.contractCode ?? rental?.contractCode ?? '',
          routeType: delivery.routeType ?? getDeliveryRouteType(delivery),
          isSynthetic: false,
        };
      });
    const realKeySet = new Set(realRows.map((delivery) => [
      delivery.rentalId || '',
      delivery.orderCode || '',
      getDeliveryRouteType(delivery),
      String(delivery.scheduledDate ?? '').slice(0, 10),
    ].join('|')));
    const syntheticRows = [];

    rentals.forEach((rental) => {
      if (!rental || rental.deletedAt || ['cancelled', 'cancelado', 'anulado'].includes(String(rental.status ?? '').toLowerCase())) return;
      const contract = contractByRentalId.get(String(rental.id)) ?? contractByOrderCode.get(String(rental.orderCode ?? '')) ?? null;
      const contractCode = contract?.contractCode ?? rental.contractCode ?? '';
      const customerName = rental.customerName ?? contract?.customerName ?? 'Cliente';
      const companyName = rental.companyName ?? contract?.companyName ?? contract?.eventType ?? customerName;
      const address = contract?.serviceAddress ?? contract?.deliveryAddress ?? contract?.address ?? rental.deliveryAddress ?? rental.address ?? '';
      const city = contract?.city ?? rental.city ?? '';
      const logisticsMode = contract?.logisticsMode ?? rental.logisticsMode ?? 'envio';
      const orderCode = rental.orderCode ?? contract?.orderCode ?? '';

      const addSynthetic = (routeType, scheduledDate, windowStart, windowEnd, label) => {
        const dateKey = String(scheduledDate ?? '').slice(0, 10);
        if (!dateKey) return;
        const key = [rental.id || '', orderCode || '', routeType, dateKey].join('|');
        if (realKeySet.has(key)) return;
        syntheticRows.push({
          id: `synthetic-${routeType}-${rental.id}`,
          deliveryCode: label,
          orderCode,
          rentalId: rental.id,
          contractCode,
          customerName,
          companyName,
          address,
          city,
          windowStart: windowStart || (routeType === 'recojo' ? '20:00' : '08:00'),
          windowEnd: windowEnd || (routeType === 'recojo' ? '22:00' : '10:00'),
          scheduledDate: dateKey,
          status: rental.status === 'returned' && routeType === 'recojo' ? 'completada' : 'programada',
          progress: 0,
          notes: `${routeType === 'recojo' ? 'Recojo' : 'Envio'} generado desde contrato ${contractCode || orderCode}`.trim(),
          routeType,
          isSynthetic: true,
        });
      };

      if (logisticsMode === 'envio') {
        addSynthetic(
          'envio',
          contract?.deliveryDate ?? rental.rentalDate ?? rental.createdAt,
          contract?.deliveryWindowStart ?? rental.deliveryWindowStart ?? '08:00',
          contract?.deliveryWindowEnd ?? rental.deliveryWindowEnd ?? '10:00',
          `Entrega ${contractCode || orderCode}`,
        );
      }

      if (logisticsMode !== 'recojo') {
        addSynthetic(
          'recojo',
          contract?.pickupDate ?? rental.dueDate,
          contract?.pickupWindowStart ?? rental.dueTime ?? '20:00',
          contract?.pickupWindowEnd ?? '22:00',
          `Recojo ${contractCode || orderCode}`,
        );
      }
    });

    return [...realRows, ...syntheticRows];
  }, [contractByOrderCode, contractByRentalId, deliveries, rentals]);

  useEffect(() => {
    setPlannerCalendarMonth(getMonthStartFromKey(plannerDate));
  }, [plannerDate]);

  const plannerActivityByDate = useMemo(() => {
    const activity = new Map();
    plannerDeliveries.forEach((delivery) => {
      if (delivery.status === 'cancelada') return;
      const key = String(delivery.scheduledDate ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
      const current = activity.get(key) ?? { envio: 0, recojo: 0 };
      current[getDeliveryRouteType(delivery)] += 1;
      activity.set(key, current);
    });
    return activity;
  }, [plannerDeliveries]);

  const plannerCalendarDays = useMemo(
    () => getPlannerMonthDays(plannerCalendarMonth),
    [plannerCalendarMonth],
  );

  const plannerRoutes = useMemo(
    () => transportRoutes
      .filter((route) => route.type === plannerType && String(route.date ?? '').slice(0, 10) === plannerDate)
      .sort((a, b) => String(a.routeCode ?? '').localeCompare(String(b.routeCode ?? ''), 'es')),
    [plannerDate, plannerType, transportRoutes],
  );

  useEffect(() => {
    if (currentView !== 'planificador') return;
    if (!plannerRoutes.some((route) => route.id === selectedRouteId)) {
      const firstRoute = plannerRoutes[0] ?? null;
      setSelectedRouteId(firstRoute?.id ?? '');
      setRouteDraft({
        driverId: firstRoute?.driverId ?? activeDriverId,
        vehicleId: firstRoute?.vehicleId ?? activeVehicleId,
        notes: firstRoute?.notes ?? '',
      });
    }
  }, [activeDriverId, activeVehicleId, currentView, plannerRoutes, selectedRouteId]);

  const selectedRoute = useMemo(
    () => plannerRoutes.find((route) => route.id === selectedRouteId) ?? plannerRoutes[0] ?? null,
    [plannerRoutes, selectedRouteId],
  );

  useEffect(() => {
    if (!selectedRoute) {
      setRouteDraft((current) => ({
        driverId: current.driverId || activeDriverId,
        vehicleId: current.vehicleId || activeVehicleId,
        notes: current.notes ?? '',
      }));
      return;
    }
    setRouteDraft({
      driverId: selectedRoute.driverId ?? activeDriverId,
      vehicleId: selectedRoute.vehicleId ?? activeVehicleId,
      notes: selectedRoute.notes ?? '',
    });
  }, [activeDriverId, activeVehicleId, selectedRoute]);

  const selectedRouteStopIds = useMemo(
    () => new Set((selectedRoute?.stops ?? []).map((stop) => stop.deliveryId)),
    [selectedRoute],
  );

  const plannerDayDeliveries = useMemo(() => {
    return plannerDeliveries
      .filter((delivery) => String(delivery.scheduledDate ?? '').slice(0, 10) === plannerDate)
      .filter((delivery) => !['cancelada'].includes(delivery.status))
      .sort((a, b) => getDeliveryScheduleTime(a) - getDeliveryScheduleTime(b));
  }, [plannerDeliveries, plannerDate]);

  const plannerDayStats = useMemo(() => {
    const envios = plannerDayDeliveries.filter((delivery) => getDeliveryRouteType(delivery) === 'envio').length;
    const recojos = plannerDayDeliveries.filter((delivery) => getDeliveryRouteType(delivery) === 'recojo').length;
    const planned = plannerDayDeliveries.filter((delivery) => delivery.routeId || selectedRouteStopIds.has(delivery.id)).length;
    return {
      envios,
      recojos,
      total: plannerDayDeliveries.length,
      planned,
      unplanned: Math.max(0, plannerDayDeliveries.length - planned),
    };
  }, [plannerDayDeliveries, selectedRouteStopIds]);

  const plannerPendingDeliveries = useMemo(() => {
    const text = String(plannerSearch ?? '').trim().toLowerCase();
    return plannerDeliveries
      .filter((delivery) => {
        if (String(delivery.scheduledDate ?? '').slice(0, 10) !== plannerDate) return false;
        const routeType = getDeliveryRouteType(delivery);
        if (plannerStopFilter !== 'all' && routeType !== plannerStopFilter) return false;
        if (delivery.routeId && delivery.routeId !== selectedRoute?.id) return false;
        if (selectedRouteStopIds.has(delivery.id)) return false;
        if (['completada', 'cancelada'].includes(delivery.status)) return false;
        if (!text) return true;
        return (
          String(delivery.orderCode ?? '').toLowerCase().includes(text)
          || String(delivery.contractCode ?? '').toLowerCase().includes(text)
          || String(delivery.deliveryCode ?? '').toLowerCase().includes(text)
          || String(delivery.customerName ?? '').toLowerCase().includes(text)
          || String(delivery.companyName ?? '').toLowerCase().includes(text)
          || String(delivery.address ?? '').toLowerCase().includes(text)
          || String(delivery.city ?? '').toLowerCase().includes(text)
        );
      })
      .sort((a, b) => getDeliveryScheduleTime(a) - getDeliveryScheduleTime(b));
  }, [plannerDate, plannerDeliveries, plannerSearch, plannerStopFilter, selectedRoute?.id, selectedRouteStopIds]);

  const plannerStops = useMemo(
    () => (selectedRoute?.stops ?? []).slice().sort((a, b) => a.sequence - b.sequence),
    [selectedRoute],
  );

  const plannerMapStops = useMemo(() => {
    if (plannerStops.length > 0) {
      return plannerStops.map((stop, index) => ({
        id: stop.deliveryId,
        delivery: stop.delivery,
        sequence: index + 1,
        routeType: getDeliveryRouteType(stop.delivery),
        planned: true,
      }));
    }
    return plannerPendingDeliveries.map((delivery, index) => ({
      id: delivery.id,
      delivery,
      sequence: index + 1,
      routeType: getDeliveryRouteType(delivery),
      planned: false,
    }));
  }, [plannerPendingDeliveries, plannerStops]);

  const selectedPlannerDelivery = useMemo(() => {
    const allPlannerDeliveries = [
      ...plannerStops.map((stop) => stop.delivery).filter(Boolean),
      ...plannerPendingDeliveries,
    ];
    return allPlannerDeliveries.find((delivery) => delivery.id === selectedPlannerDeliveryId)
      ?? allPlannerDeliveries[0]
      ?? null;
  }, [plannerPendingDeliveries, plannerStops, selectedPlannerDeliveryId]);

  useEffect(() => {
    if (!selectedPlannerDelivery) {
      setSelectedPlannerDeliveryId('');
      return;
    }
    if (selectedPlannerDelivery.id !== selectedPlannerDeliveryId) {
      setSelectedPlannerDeliveryId(selectedPlannerDelivery.id);
    }
  }, [selectedPlannerDelivery, selectedPlannerDeliveryId]);

  const stats = useMemo(() => {
    const todayKey = getTodayKey();
    const deliveriesToday = deliveries.filter((row) => String(row.scheduledDate ?? '').slice(0, 10) === todayKey).length;
    const inRoute = deliveries.filter((row) => row.status === 'en_ruta').length;
    const completed = deliveries.filter((row) => row.status === 'completada').length;
    const incidents = deliveries.filter((row) => row.status === 'incidencia').length;
    const cancelled = deliveries.filter((row) => row.status === 'cancelada').length;
    const onTimeRate = deliveries.length > 0 ? Number(((completed / deliveries.length) * 100).toFixed(1)) : 0;
    const vehiclesActive = vehicles.filter((row) => row.status === 'activo').length;
    return { deliveriesToday, inRoute, completed, incidents, cancelled, onTimeRate, vehiclesActive };
  }, [deliveries, vehicles]);

  const deliveriesTodayList = useMemo(() => {
    const todayKey = getTodayKey();
    return deliveries
      .filter((row) => String(row.scheduledDate ?? '').slice(0, 10) === todayKey)
      .sort((a, b) => String(a.windowStart ?? '').localeCompare(String(b.windowStart ?? ''), 'es'));
  }, [deliveries]);

  const fleetStats = useMemo(() => {
    const available = vehicles.filter((row) => row.status === 'activo').length;
    const inRoute = deliveries.filter((row) => row.status === 'en_ruta').length;
    const maintenance = vehicles.filter((row) => row.status === 'mantenimiento').length;
    const outService = vehicles.filter((row) => row.status === 'fuera_servicio').length;
    const total = Math.max(1, available + inRoute + maintenance + outService);
    const availablePercent = Math.round((available / total) * 100);
    return { available, inRoute, maintenance, outService, total, availablePercent };
  }, [deliveries, vehicles]);

  const alerts = useMemo(() => {
    const issueDeliveries = deliveries
      .filter((delivery) => delivery.status === 'incidencia')
      .map((delivery) => ({
        id: `inc-${delivery.id}`,
        code: delivery.deliveryCode,
        detail: `Incidencia reportada en ${delivery.address}`,
        type: 'error',
      }));

    const maintenanceAlerts = vehicles
      .filter((vehicle) => vehicle.status === 'mantenimiento')
      .map((vehicle) => ({
        id: `veh-${vehicle.id}`,
        code: vehicle.code,
        detail: 'Vehiculo en mantenimiento preventivo',
        type: 'warn',
      }));

    const suspendedDrivers = drivers
      .filter((driver) => driver.status === 'suspendido')
      .map((driver) => ({
        id: `drv-${driver.id}`,
        code: driver.code,
        detail: `${driver.fullName} esta suspendido`,
        type: 'error',
      }));

    return [...issueDeliveries, ...maintenanceAlerts, ...suspendedDrivers].slice(0, 6);
  }, [deliveries, drivers, vehicles]);

  const filteredVehicles = useMemo(() => {
    const text = String(vehicleSearch ?? '').trim().toLowerCase();
    return vehicles.filter((row) => {
      if (vehicleStatusFilter !== 'todos' && row.status !== vehicleStatusFilter) return false;
      if (!text) return true;
      return (
        String(row.code ?? '').toLowerCase().includes(text)
        || String(row.name ?? '').toLowerCase().includes(text)
        || String(row.model ?? '').toLowerCase().includes(text)
        || String(row.type ?? '').toLowerCase().includes(text)
      );
    });
  }, [vehicleSearch, vehicleStatusFilter, vehicles]);

  const filteredDrivers = useMemo(() => {
    const text = String(driverSearch ?? '').trim().toLowerCase();
    return drivers.filter((row) => {
      if (driverStatusFilter !== 'todos' && row.status !== driverStatusFilter) return false;
      if (!text) return true;
      return (
        String(row.fullName ?? '').toLowerCase().includes(text)
        || String(row.code ?? '').toLowerCase().includes(text)
        || String(row.licenseNumber ?? '').toLowerCase().includes(text)
        || String(row.phone ?? '').toLowerCase().includes(text)
      );
    });
  }, [driverSearch, driverStatusFilter, drivers]);

  useEffect(() => {
    if (!openFleetMenu) return undefined;

    const handleOutside = (event) => {
      if (!openFleetMenuRef.current) return;
      if (!openFleetMenuRef.current.contains(event.target)) {
        setOpenFleetMenu(null);
        setFloatingMenuStyle(null);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOpenFleetMenu(null);
        setFloatingMenuStyle(null);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openFleetMenu]);

  const kpiCards = useMemo(() => {
    if (currentView === 'flota') {
      return [
        { key: 'fleet_all', tone: 'lilac', icon: 'truck', value: vehicles.filter((row) => row.status !== 'fuera_servicio').length, label: 'Vehiculos activos', link: 'Ver flota' },
        { key: 'fleet_drivers', tone: 'sky', icon: 'driver', value: drivers.length, label: 'Choferes registrados', link: 'Ver choferes' },
        { key: 'fleet_maintenance', tone: 'mint', icon: 'maintenance', value: vehicles.filter((row) => row.status === 'mantenimiento').length, label: 'En mantenimiento', link: 'Filtrar' },
        { key: 'fleet_alerts', tone: 'peach', icon: 'alert', value: drivers.filter((row) => row.status === 'suspendido').length, label: 'Con alerta', link: 'Revisar' },
      ];
    }

    if (currentView === 'entregas') {
      return [
        { key: 'all', tone: 'lilac', icon: 'truck', value: stats.deliveriesToday, label: 'Entregas hoy', link: 'Ver todas' },
        { key: 'route', tone: 'peach', icon: 'clock', value: stats.inRoute, label: 'En ruta', link: 'Filtrar' },
        { key: 'done', tone: 'mint', icon: 'check', value: stats.completed, label: 'Completadas', link: 'Filtrar' },
        { key: 'cancelled', tone: 'rose', icon: 'alert', value: stats.cancelled, label: 'Anuladas', link: 'Ver anuladas' },
        { key: 'ontime', tone: 'sky', icon: 'speed', value: `${stats.onTimeRate}%`, label: 'Entregas a tiempo', link: 'Ver rendimiento' },
      ];
    }

    if (currentView === 'planificador') {
      return [];
    }

    return [
      { key: 'all', tone: 'lilac', icon: 'truck', value: stats.deliveriesToday, label: 'Entregas hoy', link: 'Ver todas' },
      { key: 'route', tone: 'peach', icon: 'clock', value: stats.inRoute, label: 'En ruta', link: 'Ver en ruta' },
      { key: 'done', tone: 'sky', icon: 'check', value: stats.completed, label: 'Completadas este mes', link: 'Ver historial' },
      { key: 'cancelled', tone: 'rose', icon: 'alert', value: stats.cancelled, label: 'Anuladas', link: 'Ver anuladas' },
      { key: 'fleet', tone: 'mint', icon: 'truck', value: stats.vehiclesActive, label: 'Vehiculos activos', link: 'Gestionar flota' },
    ];
  }, [currentView, drivers, stats, vehicles]);

  const activeDeliveryFilterSummary = useMemo(() => {
    const parts = [];
    if (statusFilter !== 'todos') {
      parts.push(`Estado: ${(deliveryStateMap[statusFilter] ?? deliveryStateMap.programada).label}`);
    }
    if (driverFilter !== 'todos') {
      const driver = drivers.find((row) => row.id === driverFilter);
      parts.push(`Chofer: ${driver?.fullName ?? '-'}`);
    }
    if (vehicleFilter !== 'todos') {
      const vehicle = vehicles.find((row) => row.id === vehicleFilter);
      parts.push(`Vehiculo: ${vehicle?.code ?? '-'}`);
    }
    if (dateFrom || dateTo) {
      parts.push(`Rango: ${dateFrom || 'inicio'} a ${dateTo || 'fin'}`);
    }
    return parts.length > 0 ? parts.join(' | ') : 'Sin filtros operativos aplicados.';
  }, [dateFrom, dateTo, driverFilter, drivers, statusFilter, vehicleFilter, vehicles]);

  const clearDeliveryFilters = () => {
    setQuery('');
    setStatusFilter('todos');
    setDriverFilter('todos');
    setVehicleFilter('todos');
    setDateFrom('');
    setDateTo('');
  };

  const handleCardAction = (cardKey) => {
    if (cardKey === 'fleet') {
      onSwitchTransportModule?.('devolucion_rutas');
      return;
    }

    if (cardKey === 'all') {
      onSwitchTransportModule?.('devolucion_entregas');
      clearDeliveryFilters();
      return;
    }

    if (cardKey === 'route') {
      onSwitchTransportModule?.('devolucion_entregas');
      setStatusFilter('en_ruta');
      return;
    }

    if (cardKey === 'done') {
      onSwitchTransportModule?.('devolucion_entregas');
      setStatusFilter('completada');
      return;
    }

    if (cardKey === 'cancelled') {
      onSwitchTransportModule?.('devolucion_entregas');
      setStatusFilter('cancelada');
      return;
    }

    if (cardKey === 'issues') {
      onSwitchTransportModule?.('devolucion_entregas');
      setStatusFilter('incidencia');
      return;
    }

    if (cardKey === 'fleet_maintenance') {
      setVehicleStatusFilter('mantenimiento');
      return;
    }

    if (cardKey === 'fleet_all') {
      setVehicleSearch('');
      setVehicleStatusFilter('todos');
      return;
    }

    if (cardKey === 'fleet_drivers') {
      setDriverSearch('');
      setDriverStatusFilter('todos');
      return;
    }

    if (cardKey === 'fleet_alerts') {
      setDriverStatusFilter('suspendido');
      return;
    }

    if (cardKey === 'ontime') {
      setStatusFilter('completada');
    }
  };

  const handleCreatePlannerRoute = async () => {
    setRouteSaveError('');
    setIsSavingRoute(true);
    try {
      const created = await onCreateTransportRoute?.({
        type: 'mixta',
        date: plannerDate,
        driverId: routeDraft.driverId || activeDriverId || null,
        vehicleId: routeDraft.vehicleId || activeVehicleId || null,
        notes: routeDraft.notes,
        stops: [],
      });
      setSelectedRouteId(created?.id ?? '');
    } catch (requestError) {
      setRouteSaveError(requestError?.message ?? 'No se pudo crear la ruta.');
    } finally {
      setIsSavingRoute(false);
    }
  };

  const saveSelectedRoute = async (overrides = {}) => {
    if (!selectedRoute) {
      setRouteSaveError('Crea o selecciona una ruta primero.');
      return null;
    }
    const payload = {
      id: selectedRoute.id,
      date: plannerDate,
      type: 'mixta',
      driverId: routeDraft.driverId || null,
      vehicleId: routeDraft.vehicleId || null,
      notes: routeDraft.notes,
      stops: plannerStops.map((stop) => ({
        id: stop.id,
        deliveryId: stop.deliveryId,
        sequence: stop.sequence,
        eta: stop.eta,
        notes: stop.notes,
      })),
      ...overrides,
    };
    setRouteSaveError('');
    setIsSavingRoute(true);
    try {
      return await onUpdateTransportRoute?.(payload);
    } catch (requestError) {
      setRouteSaveError(requestError?.message ?? 'No se pudo guardar la ruta.');
      return null;
    } finally {
      setIsSavingRoute(false);
    }
  };

  const addStopToSelectedRoute = async (delivery) => {
    if (!selectedRoute) {
      setRouteSaveError('Crea una ruta para agregar esta parada.');
      return;
    }
    let routeDelivery = delivery;
    if (delivery?.isSynthetic) {
      setRouteSaveError('');
      setIsSavingRoute(true);
      try {
        routeDelivery = await onCreateDelivery?.({
          customerName: delivery.customerName,
          companyName: delivery.companyName,
          orderCode: delivery.orderCode,
          rentalId: delivery.rentalId,
          address: delivery.address,
          city: delivery.city,
          scheduledDate: delivery.scheduledDate,
          windowStart: delivery.windowStart,
          windowEnd: delivery.windowEnd,
          driverId: routeDraft.driverId || activeDriverId || null,
          vehicleId: routeDraft.vehicleId || activeVehicleId || null,
          notes: delivery.notes,
          routeType: getDeliveryRouteType(delivery),
        });
      } catch (requestError) {
        setRouteSaveError(requestError?.message ?? 'No se pudo crear la parada.');
        setIsSavingRoute(false);
        return;
      } finally {
        setIsSavingRoute(false);
      }
    }
    if (!routeDelivery?.id) {
      setRouteSaveError('No se pudo identificar la parada.');
      return;
    }
    const nextStops = [
      ...plannerStops.map((stop) => ({
        id: stop.id,
        deliveryId: stop.deliveryId,
        sequence: stop.sequence,
        eta: stop.eta,
        notes: stop.notes,
      })),
      {
        deliveryId: routeDelivery.id,
        sequence: plannerStops.length + 1,
        eta: routeDelivery.windowStart ?? '',
        notes: '',
      },
    ];
    await saveSelectedRoute({ stops: nextStops });
  };

  const moveRouteStop = async (deliveryId, direction) => {
    if (!selectedRoute) return;
    const currentIndex = plannerStops.findIndex((stop) => stop.deliveryId === deliveryId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= plannerStops.length) return;
    const nextStops = plannerStops.map((stop) => ({
      id: stop.id,
      deliveryId: stop.deliveryId,
      sequence: stop.sequence,
      eta: stop.eta,
      notes: stop.notes,
    }));
    const [moving] = nextStops.splice(currentIndex, 1);
    nextStops.splice(nextIndex, 0, moving);
    await saveSelectedRoute({ stops: nextStops.map((stop, index) => ({ ...stop, sequence: index + 1 })) });
  };

  const removeStopFromRoute = async (deliveryId) => {
    if (!selectedRoute) return;
    const nextStops = plannerStops
      .filter((stop) => stop.deliveryId !== deliveryId)
      .map((stop, index) => ({
        id: stop.id,
        deliveryId: stop.deliveryId,
        sequence: index + 1,
        eta: stop.eta,
        notes: stop.notes,
      }));
    await saveSelectedRoute({ stops: nextStops });
  };

  const updateRouteStopField = async (deliveryId, field, value) => {
    if (!selectedRoute) return;
    const nextStops = plannerStops.map((stop) => ({
      id: stop.id,
      deliveryId: stop.deliveryId,
      sequence: stop.sequence,
      eta: stop.deliveryId === deliveryId && field === 'eta' ? value : stop.eta,
      notes: stop.deliveryId === deliveryId && field === 'notes' ? value : stop.notes,
    }));
    await saveSelectedRoute({ stops: nextStops });
  };

  const openCreateDelivery = () => {
    setDeliveryModalMode('create');
    setDeliveryFormError('');
    setDeliveryForm({
      id: '',
      customerName: '',
      companyName: '',
      orderCode: '',
      address: '',
      city: '',
      scheduledDate: getTodayKey(),
      windowStart: '08:00',
      windowEnd: '10:00',
      driverId: activeDriverId,
      vehicleId: activeVehicleId,
      status: 'programada',
      progress: STATUS_PROGRESS.programada,
      notes: '',
    });
  };

  const openEditDelivery = (row) => {
    setDeliveryModalMode('edit');
    setDeliveryFormError('');
    setDeliveryForm({
      id: row.id,
      customerName: row.customerName ?? '',
      companyName: row.companyName ?? '',
      orderCode: row.orderCode ?? '',
      address: row.address ?? '',
      city: row.city ?? '',
      scheduledDate: String(row.scheduledDate ?? '').slice(0, 10) || getTodayKey(),
      windowStart: row.windowStart ?? '08:00',
      windowEnd: row.windowEnd ?? '10:00',
      driverId: row.driverId ?? '',
      vehicleId: row.vehicleId ?? '',
      status: row.status ?? 'programada',
      progress: clampProgress(row.progress),
      notes: row.notes ?? '',
    });
    setSelectedDeliveryId(row.id);
  };

  const closeDeliveryModal = () => {
    if (isSavingDelivery) return;
    setDeliveryForm(null);
    setDeliveryFormError('');
  };

  const updateDeliveryFormValue = (field, value) => {
    setDeliveryForm((current) => {
      if (!current) return current;
      if (field === 'status') {
        const nextStatus = String(value ?? 'programada');
        return {
          ...current,
          status: nextStatus,
          progress: STATUS_PROGRESS[nextStatus] ?? current.progress,
        };
      }
      if (field === 'progress') {
        return {
          ...current,
          progress: clampProgress(value),
        };
      }
      return {
        ...current,
        [field]: value,
      };
    });
  };

  const submitDeliveryForm = async (event) => {
    event.preventDefault();
    if (!deliveryForm) return;

    const customerName = String(deliveryForm.customerName ?? '').trim();
    const address = String(deliveryForm.address ?? '').trim();
    const scheduledDate = String(deliveryForm.scheduledDate ?? '').trim();
    const windowStart = String(deliveryForm.windowStart ?? '').trim();
    const windowEnd = String(deliveryForm.windowEnd ?? '').trim();

    if (deliveryModalMode === 'create') {
      if (!customerName) {
        setDeliveryFormError('Debes indicar el cliente de la entrega.');
        return;
      }
      if (!address) {
        setDeliveryFormError('Debes indicar la direccion de entrega.');
        return;
      }
      if (!scheduledDate || !windowStart || !windowEnd) {
        setDeliveryFormError('Debes completar fecha y ventana horaria.');
        return;
      }
    }
    if (windowStart && windowEnd && !isValidSameDayWindow(windowStart, windowEnd)) {
      setDeliveryFormError('La hora de finalizacion debe ser mayor que la hora de inicio para el mismo dia.');
      return;
    }

    setIsSavingDelivery(true);
    setDeliveryFormError('');

    try {
      if (deliveryModalMode === 'create') {
        const payload = {
          customerName,
          companyName: String(deliveryForm.companyName ?? '').trim() || customerName,
          address,
          city: String(deliveryForm.city ?? '').trim() || 'Sin ciudad',
          scheduledDate,
          windowStart,
          windowEnd,
          driverId: deliveryForm.driverId || null,
          vehicleId: deliveryForm.vehicleId || null,
          notes: String(deliveryForm.notes ?? '').trim(),
        };

        const orderCode = String(deliveryForm.orderCode ?? '').trim();
        if (orderCode) {
          payload.orderCode = orderCode;
        }

        await onCreateDelivery?.(payload);
      } else {
        await onUpdateDelivery?.({
          id: deliveryForm.id,
          scheduledDate,
          windowStart,
          windowEnd,
          address,
          city: String(deliveryForm.city ?? '').trim(),
          driverId: deliveryForm.driverId || null,
          vehicleId: deliveryForm.vehicleId || null,
          status: deliveryForm.status,
          progress: clampProgress(deliveryForm.progress),
          notes: String(deliveryForm.notes ?? '').trim(),
        });
      }

      setDeliveryForm(null);
      setDeliveryFormError('');
      setStatusFilter('todos');
    } catch (requestError) {
      setDeliveryFormError(requestError?.message ?? 'No se pudo guardar la entrega.');
    } finally {
      setIsSavingDelivery(false);
    }
  };

  const handleAdvanceDeliveryStatus = async (row) => {
    const transition = getDeliveryTransition(row.status);
    await onUpdateDelivery?.({ id: row.id, status: transition.nextStatus, progress: transition.nextProgress });
    setStatusFilter('todos');
  };

  const findRentalForDelivery = (delivery) =>
    rentals.find((rental) =>
      !rental.deletedAt
      && (
        (delivery?.rentalId && rental.id === delivery.rentalId)
        || (delivery?.orderCode && rental.orderCode === delivery.orderCode)
      ),
    ) ?? null;

  const openPickupChecklist = (delivery) => {
    const rental = findRentalForDelivery(delivery);
    if (!rental) {
      setDeliveryFormError('No se encontro la orden de servicio para este recojo.');
      return;
    }
    const existingItems = rental.pickupChecklist?.items ?? [];
    setPickupFormError('');
    setPickupModal({
      delivery,
      rental,
      receivedBy: delivery.driverName ?? 'Transporte',
      notes: rental.pickupChecklist?.notes ?? delivery.notes ?? '',
      items: (rental.items ?? []).map((line) => {
        const existing = existingItems.find((entry) => entry.itemId === line.itemId);
        return {
          itemId: line.itemId,
          itemName: line.itemName,
          expectedQty: Number(line.quantity ?? 0),
          quantity: existing?.pickedQty ?? line.quantity ?? 0,
          condition: existing?.condition ?? 'ok',
          note: existing?.note ?? '',
        };
      }),
    });
  };

  const updatePickupLine = (itemId, field, value) => {
    setPickupModal((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((line) => (
          line.itemId === itemId ? { ...line, [field]: value } : line
        )),
      };
    });
  };

  const submitPickupChecklist = async (event) => {
    event.preventDefault();
    if (!pickupModal || isSavingPickup) return;
    setPickupFormError('');
    setIsSavingPickup(true);
    try {
      await onRegisterPickupChecklist?.({
        deliveryId: pickupModal.delivery.id,
        rentalId: pickupModal.rental.id,
        receivedBy: pickupModal.receivedBy,
        notes: pickupModal.notes,
        items: pickupModal.items,
      });
      setPickupModal(null);
      setStatusFilter('todos');
    } catch (error) {
      setPickupFormError(error?.message || 'No se pudo guardar el checklist de recojo.');
    } finally {
      setIsSavingPickup(false);
    }
  };

  const openVehicleCreate = () => {
    setOpenFleetMenu(null);
    setVehicleFormMode('create');
    setVehicleFormError('');
    setVehicleForm({
      code: '',
      name: '',
      model: '',
      type: 'Camion',
      capacityKg: '',
      year: new Date().getFullYear(),
      status: 'activo',
      mileageKm: '0',
      nextMaintenanceAt: '',
      imageDataUrl: null,
    });
  };

  const openVehicleEdit = (row) => {
    setOpenFleetMenu(null);
    setVehicleFormMode('edit');
    setVehicleFormError('');
    setVehicleForm({
      id: row.id,
      code: row.code ?? '',
      name: row.name ?? '',
      model: row.model ?? '',
      type: row.type ?? 'Camion',
      capacityKg: String(row.capacityKg ?? ''),
      year: Number(row.year ?? new Date().getFullYear()),
      status: row.status ?? 'activo',
      mileageKm: String(row.mileageKm ?? 0),
      nextMaintenanceAt: row.nextMaintenanceAt ? String(row.nextMaintenanceAt).slice(0, 10) : '',
      imageDataUrl: row.imageDataUrl ?? null,
    });
  };

  const closeVehicleModal = () => {
    if (isSavingVehicle) return;
    setVehicleForm(null);
    setVehicleFormMode('create');
    setVehicleFormError('');
  };

  const submitVehicleForm = async (event) => {
    event.preventDefault();
    if (!vehicleForm) return;

    const code = String(vehicleForm.code ?? '').trim().toUpperCase();
    if (!code) {
      setVehicleFormError('Debes ingresar placa o codigo del vehiculo.');
      return;
    }

    setIsSavingVehicle(true);
    setVehicleFormError('');

    try {
      const payload = {
        code,
        name: String(vehicleForm.name ?? '').trim() || 'Vehiculo',
        model: String(vehicleForm.model ?? '').trim(),
        type: String(vehicleForm.type ?? '').trim() || 'Camion',
        capacityKg: Math.max(0, Math.trunc(Number(vehicleForm.capacityKg ?? 0))),
        year: Math.max(2000, Number(vehicleForm.year ?? new Date().getFullYear())),
        status: String(vehicleForm.status ?? 'activo').trim() || 'activo',
        mileageKm: Math.max(0, Math.trunc(Number(vehicleForm.mileageKm ?? 0))),
        nextMaintenanceAt: String(vehicleForm.nextMaintenanceAt ?? '').trim() || null,
        imageDataUrl: vehicleForm.imageDataUrl ?? null,
      };

      if (vehicleFormMode === 'edit') {
        await onUpdateVehicle?.({ id: vehicleForm.id, ...payload });
      } else {
        await onCreateVehicle?.(payload);
      }
      setVehicleForm(null);
      setVehicleFormError('');
      setOpenFleetMenu(null);
    } catch (requestError) {
      setVehicleFormError(requestError?.message ?? 'No se pudo registrar el vehiculo.');
    } finally {
      setIsSavingVehicle(false);
    }
  };

  const openDriverCreate = () => {
    setOpenFleetMenu(null);
    setDriverFormMode('create');
    setDriverFormError('');
    setDriverForm({
      fullName: '',
      licenseNumber: '',
      licenseCategory: 'B1 - Utilitarios',
      phone: '',
      status: 'activo',
      licenseExpiryAt: '',
      imageDataUrl: null,
    });
  };

  const openDriverEdit = (row) => {
    setOpenFleetMenu(null);
    setDriverFormMode('edit');
    setDriverFormError('');
    setDriverForm({
      id: row.id,
      fullName: row.fullName ?? '',
      licenseNumber: row.licenseNumber ?? '',
      licenseCategory: row.licenseCategory ?? 'B1 - Utilitarios',
      phone: row.phone ?? '',
      status: row.status ?? 'activo',
      licenseExpiryAt: row.licenseExpiryAt ? String(row.licenseExpiryAt).slice(0, 10) : '',
      imageDataUrl: row.imageDataUrl ?? null,
    });
  };

  const closeDriverModal = () => {
    if (isSavingDriver) return;
    setDriverForm(null);
    setDriverFormMode('create');
    setDriverFormError('');
  };

  const submitDriverForm = async (event) => {
    event.preventDefault();
    if (!driverForm) return;

    const fullName = String(driverForm.fullName ?? '').trim();
    const licenseNumber = String(driverForm.licenseNumber ?? '').trim().toUpperCase();
    if (!fullName || !licenseNumber) {
      setDriverFormError('Nombre y licencia son obligatorios.');
      return;
    }

    setIsSavingDriver(true);
    setDriverFormError('');

    try {
      const payload = {
        fullName,
        licenseNumber,
        licenseCategory: String(driverForm.licenseCategory ?? '').trim() || 'B1 - Utilitarios',
        phone: String(driverForm.phone ?? '').trim(),
        status: String(driverForm.status ?? 'activo').trim() || 'activo',
        licenseExpiryAt: String(driverForm.licenseExpiryAt ?? '').trim() || null,
        imageDataUrl: driverForm.imageDataUrl ?? null,
      };

      if (driverFormMode === 'edit') {
        await onUpdateDriver?.({ id: driverForm.id, ...payload });
      } else {
        await onCreateDriver?.(payload);
      }
      setDriverForm(null);
      setDriverFormError('');
      setOpenFleetMenu(null);
    } catch (requestError) {
      setDriverFormError(requestError?.message ?? 'No se pudo registrar el chofer.');
    } finally {
      setIsSavingDriver(false);
    }
  };

  const handleRemoveVehicle = async (row) => {
    const shouldDelete = window.confirm(`Se eliminara el vehiculo ${row.code}. Deseas continuar?`);
    if (!shouldDelete) return;
    await onRemoveVehicle?.({ id: row.id });
    setOpenFleetMenu(null);
    if (vehicleDetail?.id === row.id) {
      setVehicleDetail(null);
    }
  };

  const handleRemoveDriver = async (row) => {
    const shouldDelete = window.confirm(`Se eliminara el chofer ${row.fullName}. Deseas continuar?`);
    if (!shouldDelete) return;
    await onRemoveDriver?.({ id: row.id });
    setOpenFleetMenu(null);
    if (driverDetail?.id === row.id) {
      setDriverDetail(null);
    }
  };

  const toggleFleetMenu = (kind, id, event) => {
    if (openFleetMenu?.kind === kind && openFleetMenu?.id === id) {
      setOpenFleetMenu(null);
      setFloatingMenuStyle(null);
      return;
    }

    const rect = event?.currentTarget?.getBoundingClientRect?.() ?? null;
    if (rect) {
      const menuWidth = 184;
      const menuHeight = kind === 'delivery' ? 150 : 118;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const left = Math.max(12, Math.min(rect.right - menuWidth, viewportWidth - menuWidth - 12));
      const shouldOpenUp = rect.bottom + menuHeight + 8 > viewportHeight;
      const top = shouldOpenUp
        ? Math.max(12, rect.top - menuHeight - 6)
        : Math.min(rect.bottom + 6, viewportHeight - menuHeight - 12);
      setFloatingMenuStyle({ top: `${top}px`, left: `${left}px`, minWidth: `${menuWidth}px` });
    }
    setOpenFleetMenu({ kind, id });
  };

  const handleVehicleImageSelected = async (event, mode = 'create') => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (mode === 'detail') {
        setVehicleDetail((current) => (current ? { ...current, imageDataUrl: dataUrl } : current));
      } else {
        setVehicleForm((current) => (current ? { ...current, imageDataUrl: dataUrl } : current));
      }
    } catch (error) {
      setVehicleFormError(error?.message ?? 'No se pudo cargar la imagen.');
    } finally {
      event.target.value = '';
    }
  };

  const handleDriverImageSelected = async (event, mode = 'create') => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (mode === 'detail') {
        setDriverDetail((current) => (current ? { ...current, imageDataUrl: dataUrl } : current));
      } else {
        setDriverForm((current) => (current ? { ...current, imageDataUrl: dataUrl } : current));
      }
    } catch (error) {
      setDriverFormError(error?.message ?? 'No se pudo cargar la imagen.');
    } finally {
      event.target.value = '';
    }
  };

  const saveVehiclePhoto = async () => {
    if (!vehicleDetail?.id) return;
    setIsSavingVehiclePhoto(true);
    try {
      await onUpdateVehicle?.({
        id: vehicleDetail.id,
        imageDataUrl: vehicleDetail.imageDataUrl ?? null,
      });
    } finally {
      setIsSavingVehiclePhoto(false);
    }
  };

  const saveDriverPhoto = async () => {
    if (!driverDetail?.id) return;
    setIsSavingDriverPhoto(true);
    try {
      await onUpdateDriver?.({
        id: driverDetail.id,
        imageDataUrl: driverDetail.imageDataUrl ?? null,
      });
    } finally {
      setIsSavingDriverPhoto(false);
    }
  };

  const openRouteSheetDocument = async (row) => {
    try {
      const preview = await onPrintRouteSheetDocument?.({ rentalId: row.rentalId, orderCode: row.orderCode });
      if (preview?.html) {
        setDocumentPreview({
          title: preview.title ?? `Hoja de ruta ${row.orderCode}`,
          html: preview.html,
        });
      }
    } catch (error) {
      setDeliveryFormError(error.message || 'No se pudo abrir la hoja de ruta.');
    }
  };

  const printRoutePreview = () => {
    const frame = document.getElementById('transport-document-preview-frame');
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  };

  const openPlannerRouteSheet = () => {
    if (!selectedRoute || plannerStops.length === 0) {
      setRouteSaveError('Arma una ruta con paradas antes de imprimir.');
      return;
    }

    const esc = (value) =>
      String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

    const rows = plannerStops.map((stop, index) => {
      const delivery = stop.delivery ?? {};
      const routeType = getDeliveryRouteType(delivery);
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${routeType === 'recojo' ? 'Recojo' : 'Envio'}</td>
          <td>${esc(stop.eta || delivery.windowStart || '--:--')}</td>
          <td>${esc(delivery.orderCode || delivery.deliveryCode || '-')}</td>
          <td>${esc(delivery.customerName || '-')}</td>
          <td>${esc(getStopAddress(delivery) || '-')}</td>
          <td>${esc(stop.notes || delivery.notes || '-')}</td>
        </tr>
      `;
    }).join('');

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Hoja de ruta ${esc(selectedRoute.routeCode)}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #111827; margin: 28px; }
            header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #e84a00; padding-bottom: 16px; }
            h1 { margin: 0; color: #e84a00; font-size: 26px; }
            p { margin: 4px 0; color: #4b5563; }
            .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
            .summary div { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
            .summary span { display: block; color: #6b7280; font-size: 12px; }
            .summary strong { display: block; margin-top: 4px; font-size: 16px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th { background: #fff7ed; color: #9a3412; text-align: left; font-size: 12px; }
            th, td { border: 1px solid #e5e7eb; padding: 9px; vertical-align: top; font-size: 12px; }
            footer { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 36px; }
            footer div { border-top: 1px solid #9ca3af; padding-top: 8px; color: #4b5563; text-align: center; }
            @media print { body { margin: 18px; } }
          </style>
        </head>
        <body>
          <header>
            <div>
              <h1>El Copetin - Hoja de ruta</h1>
              <p>${esc(formatDate(plannerDate))} | ${esc(selectedRoute.routeCode)}</p>
            </div>
            <div>
              <p><strong>Chofer:</strong> ${esc(selectedRoute.driverName || 'Sin chofer asignado')}</p>
              <p><strong>Vehiculo:</strong> ${esc(selectedRoute.vehicleCode || 'Sin vehiculo asignado')}</p>
            </div>
          </header>
          <section class="summary">
            <div><span>Paradas</span><strong>${plannerStops.length}</strong></div>
            <div><span>Envios</span><strong>${plannerStops.filter((stop) => getDeliveryRouteType(stop.delivery) === 'envio').length}</strong></div>
            <div><span>Recojos</span><strong>${plannerStops.filter((stop) => getDeliveryRouteType(stop.delivery) === 'recojo').length}</strong></div>
            <div><span>Salida sugerida</span><strong>${plannerStops[0]?.eta || plannerStops[0]?.delivery?.windowStart || '--:--'}</strong></div>
          </section>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Tipo</th>
                <th>Hora</th>
                <th>Contrato</th>
                <th>Cliente</th>
                <th>Direccion</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <footer>
            <div>Administracion</div>
            <div>Chofer</div>
            <div>Recepcion / Cliente</div>
          </footer>
        </body>
      </html>
    `;

    setDocumentPreview({
      title: `Hoja de ruta ${selectedRoute.routeCode}`,
      html,
    });
  };

  const renderPlannerMap = () => {
    const embeddedMapQuery = plannerMapSearch.trim() || getStopAddress(selectedPlannerDelivery);
    const embeddedMapUrl = buildEmbeddedMapUrl(embeddedMapQuery);
    return (
      <article className="transport-planner-map">
        <header>
          <div>
            <h3>Mapa de la ruta</h3>
            <p>Busca direcciones y valida zonas antes de ordenar.</p>
          </div>
          <span>{plannerMapStops.length} paradas</span>
        </header>
        <form
          className="transport-map-search-row"
          onSubmit={(event) => {
            event.preventDefault();
            setPlannerMapSearch((current) => current.trim());
          }}
        >
          <input
            value={plannerMapSearch}
            onChange={(event) => setPlannerMapSearch(event.target.value)}
            placeholder="Buscar dirección en el mapa..."
          />
          <button
            type="submit"
            className="ghost-button"
          >
            Buscar
          </button>
        </form>
        <div className="transport-map-free">
          {embeddedMapUrl ? (
            <iframe
              className="transport-map-embed"
              title="Mapa de busqueda de ruta"
              src={embeddedMapUrl}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <div className="transport-map-grid-lines" />
          )}
          {plannerMapStops.length === 0 && !embeddedMapUrl ? (
            <div className="transport-map-empty">
              No hay paradas para visualizar en esta fecha.
            </div>
          ) : null}
          <svg className="transport-map-route-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {plannerStops.length > 1 ? (
              <polyline
                points={plannerMapStops.map((stop, index) => {
                  const point = pseudoMapPoint(getStopAddress(stop.delivery), index);
                  return `${point.left},${point.top}`;
                }).join(' ')}
              />
            ) : null}
          </svg>
          {plannerMapStops.map((stop, index) => {
            const point = pseudoMapPoint(getStopAddress(stop.delivery), index);
            const isSelected = selectedPlannerDelivery?.id === stop.delivery?.id;
            return (
              <button
                key={`map-${stop.id}`}
                type="button"
                className={`transport-map-stop ${stop.routeType === 'recojo' ? 'pickup' : 'delivery'} ${isSelected ? 'selected' : ''}`}
                style={{ left: `${point.left}%`, top: `${point.top}%` }}
                title={getStopAddress(stop.delivery)}
                onClick={() => setSelectedPlannerDeliveryId(stop.delivery?.id ?? '')}
              >
                {stop.sequence}
              </button>
            );
          })}
        </div>
        {selectedPlannerDelivery ? (
          <div className="transport-map-selected-card">
            <div>
              <span className={`planner-type-pill ${getDeliveryRouteType(selectedPlannerDelivery)}`}>
                {getDeliveryRouteType(selectedPlannerDelivery) === 'recojo' ? 'Recojo' : 'Envio'}
              </span>
              <strong>{selectedPlannerDelivery.customerName}</strong>
              <small>{selectedPlannerDelivery.contractCode || selectedPlannerDelivery.orderCode || selectedPlannerDelivery.deliveryCode}</small>
            </div>
            <p>{getStopAddress(selectedPlannerDelivery) || 'Direccion pendiente'}</p>
            <p>{selectedPlannerDelivery.notes || 'Sin observaciones registradas.'}</p>
          </div>
        ) : null}
      </article>
    );
  };

  const renderPlannerDatePicker = () => {
    const selectedActivity = plannerActivityByDate.get(plannerDate) ?? { envio: 0, recojo: 0 };
    const todayKey = getTodayKey();
    return (
      <div className="transport-date-picker">
        <button
          type="button"
          className="transport-date-trigger"
          onClick={() => setIsPlannerCalendarOpen((current) => !current)}
        >
          <span>{plannerDate}</span>
          <small>
            {selectedActivity.envio} envio{selectedActivity.envio === 1 ? '' : 's'} | {selectedActivity.recojo} recojo{selectedActivity.recojo === 1 ? '' : 's'}
          </small>
        </button>
        {isPlannerCalendarOpen ? (
          <div className="transport-mini-calendar" role="dialog" aria-label="Seleccionar fecha de ruta">
            <header>
              <button
                type="button"
                aria-label="Mes anterior"
                onClick={() => setPlannerCalendarMonth((current) => shiftMonth(current, -1))}
              >
                {'<'}
              </button>
              <strong>{formatPlannerMonth(plannerCalendarMonth)}</strong>
              <button
                type="button"
                aria-label="Mes siguiente"
                onClick={() => setPlannerCalendarMonth((current) => shiftMonth(current, 1))}
              >
                {'>'}
              </button>
            </header>
            <div className="transport-mini-calendar-weekdays">
              {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="transport-mini-calendar-grid">
              {plannerCalendarDays.map((day) => {
                const activity = plannerActivityByDate.get(day.key) ?? { envio: 0, recojo: 0 };
                const hasEnvio = activity.envio > 0;
                const hasRecojo = activity.recojo > 0;
                const classNames = [
                  day.inMonth ? '' : 'muted',
                  day.key === plannerDate ? 'selected' : '',
                  day.key === todayKey ? 'today' : '',
                  hasEnvio ? 'has-envio' : '',
                  hasRecojo ? 'has-recojo' : '',
                ].filter(Boolean).join(' ');
                return (
                  <button
                    key={day.key}
                    type="button"
                    className={classNames}
                    onClick={() => {
                      setPlannerDate(day.key);
                      setIsPlannerCalendarOpen(false);
                    }}
                    title={`${day.key} - ${activity.envio} envios - ${activity.recojo} recojos`}
                  >
                    <span>{day.label}</span>
                    {(hasEnvio || hasRecojo) ? (
                      <small>
                        {hasEnvio ? <i className="envio" aria-label={`${activity.envio} envios`} /> : null}
                        {hasRecojo ? <i className="recojo" aria-label={`${activity.recojo} recojos`} /> : null}
                      </small>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <footer>
              <span><i className="envio" /> Envios</span>
              <span><i className="recojo" /> Recojos</span>
              <button
                type="button"
                onClick={() => {
                  setPlannerDate(todayKey);
                  setPlannerCalendarMonth(getMonthStartFromKey(todayKey));
                  setIsPlannerCalendarOpen(false);
                }}
              >
                Hoy
              </button>
            </footer>
          </div>
        ) : null}
      </div>
    );
  };

  const renderPlannerView = () => {
    const routeStatus = transportRouteStateMap[selectedRoute?.status] ?? transportRouteStateMap.borrador;
    const plannedEnvios = plannerStops.filter((stop) => getDeliveryRouteType(stop.delivery) === 'envio').length;
    const plannedRecojos = plannerStops.filter((stop) => getDeliveryRouteType(stop.delivery) === 'recojo').length;
    const plannerRows = plannerPanelView === 'route'
      ? plannerStops.map((stop, index) => ({
        id: stop.deliveryId,
        delivery: stop.delivery,
        sequence: index + 1,
        eta: stop.eta || stop.delivery?.windowStart || '',
        notes: stop.notes ?? '',
        isPlanned: true,
      }))
      : plannerDayDeliveries
        .filter((delivery) => {
          if (plannerStopFilter !== 'all' && getDeliveryRouteType(delivery) !== plannerStopFilter) return false;
          const text = String(plannerSearch ?? '').trim().toLowerCase();
          if (!text) return true;
          return (
            String(delivery.orderCode ?? '').toLowerCase().includes(text)
            || String(delivery.contractCode ?? '').toLowerCase().includes(text)
            || String(delivery.deliveryCode ?? '').toLowerCase().includes(text)
            || String(delivery.customerName ?? '').toLowerCase().includes(text)
            || String(delivery.companyName ?? '').toLowerCase().includes(text)
            || String(delivery.address ?? '').toLowerCase().includes(text)
            || String(delivery.city ?? '').toLowerCase().includes(text)
          );
        })
        .map((delivery) => {
          const plannedIndex = plannerStops.findIndex((stop) => stop.deliveryId === delivery.id);
          const stop = plannedIndex >= 0 ? plannerStops[plannedIndex] : null;
          return {
            id: delivery.id,
            delivery,
            sequence: plannedIndex >= 0 ? plannedIndex + 1 : null,
            eta: stop?.eta || delivery.windowStart || '',
            notes: stop?.notes ?? '',
            isPlanned: plannedIndex >= 0,
          };
        });

    return (
      <div className="transport-planner">
        <article className="transport-planner-card transport-planner-controls transport-planner-topbar">
          <div className="transport-planner-toolbar">
            {renderPlannerDatePicker()}
            <button
              type="button"
              className="ghost-button"
              onClick={() => setPlannerDate(getTodayKey())}
            >
              Hoy
            </button>
          </div>

          <div className="transport-planner-day-metrics">
            <article>
              <strong>{plannerDayStats.envios}</strong>
              <span>Envios</span>
            </article>
            <article>
              <strong>{plannerDayStats.recojos}</strong>
              <span>Recojos</span>
            </article>
            <article>
              <strong>{plannerDayStats.total}</strong>
              <span>Paradas</span>
            </article>
            <article className={plannerDayStats.unplanned > 0 ? 'warning' : 'ready'}>
              <strong>{plannerDayStats.unplanned}</strong>
              <span>Sin planificar</span>
            </article>
          </div>

          <div className="transport-planner-toolbar transport-planner-route-toolbar">
            <label>
              <span>Ruta</span>
              <select value={selectedRoute?.id ?? ''} onChange={(event) => setSelectedRouteId(event.target.value)}>
                <option value="">Sin ruta planificada</option>
                {plannerRoutes.map((route) => (
                  <option key={route.id} value={route.id}>{route.routeCode}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Chofer</span>
              <select value={routeDraft.driverId} onChange={(event) => setRouteDraft((current) => ({ ...current, driverId: event.target.value }))}>
                <option value="">Sin chofer</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>{driver.fullName}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Vehiculo</span>
              <select value={routeDraft.vehicleId} onChange={(event) => setRouteDraft((current) => ({ ...current, vehicleId: event.target.value }))}>
                <option value="">Sin vehiculo</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{vehicle.code} - {vehicle.name}</option>
                ))}
              </select>
            </label>
            <button type="button" className="ghost-button" onClick={handleCreatePlannerRoute} disabled={isSavingRoute}>
              + Crear ruta
            </button>
            <button type="button" className="primary-button transport-schedule-btn" onClick={() => saveSelectedRoute({ status: 'planificada' })} disabled={!selectedRoute || isSavingRoute}>
              Guardar planificacion
            </button>
            <button type="button" className="primary-button transport-schedule-btn" onClick={openPlannerRouteSheet} disabled={!selectedRoute || plannerStops.length === 0}>
              Imprimir hoja de ruta
            </button>
          </div>

          {selectedRoute ? (
            <div className="transport-planner-route-meta">
              <strong>{selectedRoute.routeCode}</strong>
              <span className={`transport-status-pill ${routeStatus.className}`}>{routeStatus.label}</span>
              <span>{formatDate(selectedRoute.date)}</span>
              <span>{plannedEnvios} envios</span>
              <span>{plannedRecojos} recojos</span>
            </div>
          ) : (
            <p className="transport-form-note">
              <strong>Primero crea una ruta.</strong>
              <span>Luego agrega entregas o recojos del dia y ordenalos segun el viaje real.</span>
            </p>
          )}
        </article>

        <div className="transport-planner-board">
          <article className="transport-planner-card transport-planner-table-card">
            <header>
              <div className="transport-planner-tabs">
                <button
                  type="button"
                  className={plannerPanelView === 'day' ? 'active' : ''}
                  onClick={() => setPlannerPanelView('day')}
                >
                  Paradas del dia
                </button>
                <button
                  type="button"
                  className={plannerPanelView === 'route' ? 'active' : ''}
                  onClick={() => setPlannerPanelView('route')}
                >
                  Ruta planificada ({plannerStops.length})
                </button>
              </div>
              <div className="transport-planner-table-tools">
                <input
                  type="search"
                  value={plannerSearch}
                  onChange={(event) => setPlannerSearch(event.target.value)}
                  placeholder="Buscar por cliente, direccion o contrato..."
                />
                <select value={plannerStopFilter} onChange={(event) => setPlannerStopFilter(event.target.value)}>
                  <option value="all">Todos ({plannerDayStats.total})</option>
                  <option value="envio">Envios ({plannerDayStats.envios})</option>
                  <option value="recojo">Recojos ({plannerDayStats.recojos})</option>
                </select>
              </div>
            </header>

            <div className="transport-planner-table-wrap">
              <table className="transport-planner-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Tipo</th>
                    <th>Hora</th>
                    <th>Contrato</th>
                    <th>Cliente</th>
                    <th>Direccion</th>
                    <th>Referencia</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {plannerRows.map((row, index) => {
                    const delivery = row.delivery ?? {};
                    const routeType = getDeliveryRouteType(delivery);
                    const state = deliveryStateMap[delivery.status] ?? deliveryStateMap.programada;
                    return (
                      <tr
                        key={`planner-row-${row.id}`}
                        className={`${selectedPlannerDelivery?.id === delivery.id ? 'selected' : ''} ${row.isPlanned ? 'planned' : ''}`}
                        onClick={() => setSelectedPlannerDeliveryId(delivery.id)}
                      >
                        <td>{row.sequence ?? '-'}</td>
                        <td>
                          <span className={`planner-type-pill ${routeType}`}>
                            {routeType === 'recojo' ? 'Recojo' : 'Envio'}
                          </span>
                        </td>
                        <td>
                          {row.isPlanned ? (
                            <input
                              type="time"
                              value={row.eta}
                              onChange={(event) => updateRouteStopField(row.id, 'eta', event.target.value)}
                              onClick={(event) => event.stopPropagation()}
                            />
                          ) : (
                            <strong>{delivery.windowStart || '--:--'}</strong>
                          )}
                        </td>
                        <td>
                          <strong>{delivery.contractCode || delivery.orderCode || delivery.deliveryCode || '-'}</strong>
                          {delivery.contractCode && delivery.orderCode ? <span>{delivery.orderCode}</span> : null}
                        </td>
                        <td>
                          <strong>{delivery.customerName || '-'}</strong>
                          <span>{delivery.companyName || ''}</span>
                        </td>
                        <td>{getStopAddress(delivery) || 'Direccion pendiente'}</td>
                        <td>{delivery.notes || row.notes || '-'}</td>
                        <td>
                          <span className={`transport-status-pill ${row.isPlanned ? 'done' : state.className}`}>
                            {row.isPlanned ? 'Planificado' : state.label}
                          </span>
                        </td>
                        <td>
                          <div className="transport-planner-row-actions">
                            {row.isPlanned ? (
                              <>
                                <button type="button" onClick={(event) => { event.stopPropagation(); moveRouteStop(row.id, -1); }} disabled={index === 0 || isSavingRoute}>Subir</button>
                                <button type="button" onClick={(event) => { event.stopPropagation(); moveRouteStop(row.id, 1); }} disabled={index === plannerRows.length - 1 || isSavingRoute}>Bajar</button>
                                <button type="button" className="danger" onClick={(event) => { event.stopPropagation(); removeStopFromRoute(row.id); }} disabled={isSavingRoute}>Quitar</button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); addStopToSelectedRoute(delivery); }}
                                disabled={!selectedRoute || isSavingRoute}
                              >
                                Agregar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {plannerRows.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <p className="transport-empty-list">No hay paradas para esta vista.</p>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="transport-planner-bottom">
              <label>
                <span>Observaciones para transporte</span>
                <input
                  type="text"
                  value={routeDraft.notes}
                  onChange={(event) => setRouteDraft((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Ej. Revisar mercaderia fragil, confirmar punto 6 antes de salir"
                />
              </label>
              <div>
                <strong>Resumen del dia</strong>
                <span>{plannerDayStats.envios} envios | {plannerDayStats.recojos} recojos | {plannerStops.length} en ruta</span>
              </div>
            </div>
            {routeSaveError ? <p className="transport-form-error">{routeSaveError}</p> : null}
          </article>

          {renderPlannerMap()}
        </div>
      </div>
    );
  };

  const renderDeliveriesTable = (mode) => (
    <div className="transport-table-wrap">
      <table className={`transport-table ${mode === 'entregas' ? 'deliveries-table' : ''}`}>
        <thead>
          <tr>
            <th>{mode === 'recojos' ? 'Recojo' : 'Entrega'}</th>
            <th>Orden de Servicio</th>
            <th>Cliente</th>
            {mode === 'entregas' ? <th>Direccion</th> : null}
            <th>{mode === 'entregas' ? 'Ventana Horaria' : 'Fecha y Hora'}</th>
            <th>Chofer</th>
            <th>Vehiculo</th>
            <th>Estado</th>
            <th>Prioridad</th>
            <th>Progreso</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {paginatedDeliveries.map((row) => {
            const state = deliveryStateMap[row.status] ?? deliveryStateMap.programada;
            const transition = getDeliveryTransition(row.status);
            return (
              <tr
                key={row.id}
                className={selectedDelivery?.id === row.id ? 'is-selected' : ''}
                onClick={() => setSelectedDeliveryId(row.id)}
              >
                <td className="transport-delivery-id">
                  <strong>{row.deliveryCode}</strong>
                  <span>{formatDate(row.scheduledDate)}</span>
                </td>
                <td className="transport-service-order">{row.orderCode || '-'}</td>
                <td>
                  <strong className="transport-main-text">{row.customerName}</strong>
                  <span>{row.companyName || '-'}</span>
                </td>
                {mode === 'entregas' ? (
                  <td>
                    <strong className="transport-main-text">{row.address}</strong>
                    <span>{row.city}</span>
                  </td>
                ) : null}
                <td>
                  <strong className="transport-main-text">{row.scheduledDate ? formatDate(row.scheduledDate) : '-'}</strong>
                  <span>{`${row.windowStart || '--:--'} - ${row.windowEnd || '--:--'}`}</span>
                </td>
                <td>
                  <div className="transport-driver-cell">
                    <span className="transport-driver-avatar">
                      <span className="transport-driver-avatar-text">{initials(row.driverName)}</span>
                    </span>
                    <div>
                      <strong>{row.driverName}</strong>
                      <span>{row.driverLicense}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <strong className="transport-main-text">{row.vehicleCode}</strong>
                  <span>{row.vehicleType}</span>
                </td>
                <td>
                  <span className={`transport-status-pill ${state.className}`}>{state.label}</span>
                </td>
                <td>
                  <span className={`transport-priority-pill ${row.priority?.className ?? 'medium'}`}>
                    {row.priority?.label ?? 'Media'}
                  </span>
                </td>
                <td>
                  <div className="transport-progress-cell">
                    <strong>{row.progress}%</strong>
                    <div className="transport-progress-bar">
                      <span style={{ width: `${row.progress}%` }} />
                    </div>
                  </div>
                </td>
                <td className="transport-row-menu">
                  <div
                    className="transport-actions-menu-wrap"
                    ref={openFleetMenu?.kind === 'delivery' && openFleetMenu?.id === row.id ? openFleetMenuRef : null}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="transport-row-menu-button"
                      onClick={(event) => toggleFleetMenu('delivery', row.id, event)}
                      aria-label={`Acciones de ${row.deliveryCode}`}
                    >
                      {'\u22ee'}
                    </button>
                    {openFleetMenu?.kind === 'delivery' && openFleetMenu?.id === row.id ? (
                      <div className="orders-floating-menu transport-row-dropdown" style={floatingMenuStyle ?? undefined}>
                        <button
                          type="button"
                          onClick={() => {
                            openEditDelivery(row);
                            setOpenFleetMenu(null);
                          }}
                          disabled={row.status === 'cancelada'}
                        >
                          Editar entrega
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await handleAdvanceDeliveryStatus(row);
                            setOpenFleetMenu(null);
                          }}
                          disabled={row.status === 'cancelada'}
                        >
                          {transition.label}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            openRouteSheetDocument(row);
                            setOpenFleetMenu(null);
                          }}
                        >
                          Ver hoja de ruta
                        </button>
                        {isPickupDelivery(row) ? (
                          <button
                            type="button"
                            onClick={() => {
                              openPickupChecklist(row);
                              setOpenFleetMenu(null);
                            }}
                          >
                            Checklist de recojo
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
          {paginatedDeliveries.length === 0 ? (
            <tr>
              <td colSpan={11}>
                <p className="status">No hay {mode === 'recojos' ? 'recojos' : 'entregas'} para los filtros seleccionados.</p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );

  const pageStart = filteredDeliveries.length === 0 ? 0 : (deliveryPage - 1) * deliveryPageSize + 1;
  const pageEnd = Math.min(deliveryPage * deliveryPageSize, filteredDeliveries.length);

  return (
    <section className={`panel transport-dashboard transport-view-${currentView}`}>
      <header className="transport-header">
        <div>
          <h2>{currentView === 'entregas' ? 'Entregas' : currentView === 'recojos' ? 'Recojos' : currentView === 'planificador' ? 'Planificador de Rutas' : currentView === 'flota' ? 'Flota y Choferes' : 'Transporte'}</h2>
          <p>
            {currentView === 'entregas'
              ? 'Gestiona y da seguimiento a todas las entregas programadas.'
              : currentView === 'recojos'
              ? 'Registra checklist de recojo, estado de items y entrega a inventario.'
              : currentView === 'planificador'
              ? 'Arma rutas de envio y recojo para ventas y transporte con mapa de apoyo.'
              : currentView === 'flota'
              ? 'Gestiona los vehiculos y conductores de transporte.'
              : 'Gestiona entregas, flota y choferes.'}
          </p>
        </div>

        <div className="transport-header-actions">
          {currentView === 'entregas' || currentView === 'recojos' ? (
            <button
              type="button"
              className="link-button transport-calendar-link"
              onClick={() => onSwitchTransportModule?.('caja')}
            >
              Ver en Calendario
            </button>
          ) : null}

          {currentView === 'planificador' ? (
            <>
              <button
                type="button"
                className="link-button transport-calendar-link"
                onClick={() => onSwitchTransportModule?.('devolucion_entregas')}
              >
                Ver entregas
              </button>
              <button
                type="button"
                className="link-button transport-calendar-link"
                onClick={() => onSwitchTransportModule?.('devolucion_recojos')}
              >
                Ver recojos
              </button>
            </>
          ) : currentView === 'flota' ? (
            <>
              <button type="button" className="primary-button transport-schedule-btn" onClick={openVehicleCreate}>
                + Nuevo Vehiculo
              </button>
              <button type="button" className="primary-button transport-schedule-btn" onClick={openDriverCreate}>
                + Nuevo Chofer
              </button>
            </>
          ) : (
            <button type="button" className="primary-button transport-schedule-btn" onClick={openCreateDelivery}>
              {currentView === 'recojos' ? '+ Programar Recojo' : '+ Programar Entrega'}
            </button>
          )}
        </div>
      </header>

      {kpiCards.length > 0 ? (
        <div className={`transport-kpis ${currentView === 'flota' ? 'fleet' : ''}`}>
          {kpiCards.map((card) => (
            <article key={card.key} className={`transport-kpi-card ${card.tone}`}>
              <span className={`transport-kpi-icon ${card.tone}`}>
                <KpiIcon kind={card.icon} />
              </span>
              <strong>{card.value}</strong>
              <p>{card.label}</p>
              <button type="button" onClick={() => handleCardAction(card.key)}>
                {card.link} {'->'}
              </button>
            </article>
          ))}
        </div>
      ) : null}

      {currentView === 'planificador' ? (
        renderPlannerView()
      ) : currentView === 'flota' ? (
        <div className="fleet-module">
          <article className="fleet-section-card">
            <header className="fleet-section-head">
              <h3>Vehiculos</h3>
            </header>

            <div className="fleet-toolbar">
              <label className="fleet-search">
                <input
                  type="search"
                  placeholder="Buscar por placa, nombre o tipo..."
                  value={vehicleSearch}
                  onChange={(event) => setVehicleSearch(event.target.value)}
                />
              </label>
              <select value={vehicleStatusFilter} onChange={(event) => setVehicleStatusFilter(event.target.value)}>
                <option value="todos">Estado: Todos</option>
                <option value="activo">Activos</option>
                <option value="mantenimiento">Mantenimiento</option>
                <option value="fuera_servicio">Fuera de servicio</option>
              </select>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setVehicleSearch('');
                  setVehicleStatusFilter('todos');
                }}
              >
                Limpiar
              </button>
            </div>

            <div className="transport-table-wrap">
              <table className="transport-table transport-fleet-table">
                <thead>
                  <tr>
                    <th>Vehiculo</th>
                    <th>Patente</th>
                    <th>Tipo</th>
                    <th>Capacidad</th>
                    <th>Ano</th>
                    <th>Estado</th>
                    <th>Proximo Mantenimiento</th>
                    <th>Kilometraje</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVehicles.map((row) => {
                    const state = vehicleStateMap[row.status] ?? vehicleStateMap.activo;
                    return (
                      <tr key={row.id}>
                        <td>
                          <div className="transport-entity-cell">
                            <button
                              type="button"
                              className={`transport-entity-photo ${row.imageDataUrl ? 'has-photo' : ''}`}
                              onClick={() => row.imageDataUrl && setMediaPreview({ title: row.name, src: row.imageDataUrl })}
                              disabled={!row.imageDataUrl}
                              aria-label={row.imageDataUrl ? `Ver foto de ${row.name}` : `Sin foto de ${row.name}`}
                            >
                              {row.imageDataUrl ? (
                                <img src={row.imageDataUrl} alt={row.name} />
                              ) : (
                                <span>VH</span>
                              )}
                            </button>
                            <div>
                              <strong className="transport-main-text">{row.name}</strong>
                              <span>{row.model}</span>
                            </div>
                          </div>
                        </td>
                        <td className="transport-service-order">{row.code}</td>
                        <td>{row.type}</td>
                        <td>{row.capacityKg ? `${Number(row.capacityKg).toLocaleString('es-BO')} kg` : '-'}</td>
                        <td>{row.year}</td>
                        <td>
                          <span className={`transport-status-pill ${state.className}`}>{state.label}</span>
                        </td>
                        <td>
                          <strong className="transport-main-text">{row.nextMaintenanceAt ? formatDate(row.nextMaintenanceAt) : '-'}</strong>
                        </td>
                        <td>{Number(row.mileageKm ?? 0).toLocaleString('es-BO')} km</td>
                        <td className="transport-row-menu">
                          <div
                            className="transport-actions-menu-wrap"
                            ref={openFleetMenu?.kind === 'vehicle' && openFleetMenu?.id === row.id ? openFleetMenuRef : null}
                          >
                            <button
                              type="button"
                              className="transport-row-menu-button"
                              onClick={(event) => toggleFleetMenu('vehicle', row.id, event)}
                              aria-label={`Acciones de ${row.code}`}
                            >
                              {'\u22ee'}
                            </button>
                            {openFleetMenu?.kind === 'vehicle' && openFleetMenu?.id === row.id ? (
                              <div className="orders-floating-menu transport-row-dropdown" style={floatingMenuStyle ?? undefined}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setVehicleDetail(row);
                                    setOpenFleetMenu(null);
                                  }}
                                >
                                  Ver detalle
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    openVehicleEdit(row);
                                    setOpenFleetMenu(null);
                                  }}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={async () => {
                                    await handleRemoveVehicle(row);
                                  }}
                                >
                                  Eliminar
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredVehicles.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <p className="status">No hay vehiculos para los filtros seleccionados.</p>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="status">Mostrando {filteredVehicles.length} de {vehicles.length} vehiculos</p>
          </article>

          <article className="fleet-section-card">
            <header className="fleet-section-head">
              <h3>Choferes</h3>
            </header>

            <div className="fleet-toolbar">
              <label className="fleet-search">
                <input
                  type="search"
                  placeholder="Buscar por nombre, legajo o licencia..."
                  value={driverSearch}
                  onChange={(event) => setDriverSearch(event.target.value)}
                />
              </label>
              <select value={driverStatusFilter} onChange={(event) => setDriverStatusFilter(event.target.value)}>
                <option value="todos">Estado: Todos</option>
                <option value="activo">Activos</option>
                <option value="vacaciones">Vacaciones</option>
                <option value="suspendido">Suspendidos</option>
              </select>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setDriverSearch('');
                  setDriverStatusFilter('todos');
                }}
              >
                Limpiar
              </button>
            </div>

            <div className="transport-table-wrap">
              <table className="transport-table transport-fleet-table">
                <thead>
                  <tr>
                    <th>Chofer</th>
                    <th>Licencia</th>
                    <th>Categoria</th>
                    <th>Telefono</th>
                    <th>Estado</th>
                    <th>Vencimiento Licencia</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDrivers.map((row) => {
                    const state = driverStateMap[row.status] ?? driverStateMap.activo;
                    return (
                      <tr key={row.id}>
                        <td>
                          <div className="transport-driver-cell">
                            <button
                              type="button"
                              className={`transport-driver-avatar transport-photo-avatar ${row.imageDataUrl ? 'has-photo' : ''}`}
                              onClick={() => row.imageDataUrl && setMediaPreview({ title: row.fullName, src: row.imageDataUrl })}
                              disabled={!row.imageDataUrl}
                              aria-label={row.imageDataUrl ? `Ver foto de ${row.fullName}` : `Sin foto de ${row.fullName}`}
                            >
                              {row.imageDataUrl ? (
                                <img src={row.imageDataUrl} alt={row.fullName} />
                              ) : (
                                initials(row.fullName)
                              )}
                            </button>
                            <div>
                              <strong>{row.fullName}</strong>
                              <span>Legajo: {row.code}</span>
                            </div>
                          </div>
                        </td>
                        <td>{row.licenseNumber}</td>
                        <td>{row.licenseCategory}</td>
                        <td>{row.phone || '-'}</td>
                        <td>
                          <span className={`transport-status-pill ${state.className}`}>{state.label}</span>
                        </td>
                        <td>{row.licenseExpiryAt ? formatDate(row.licenseExpiryAt) : '-'}</td>
                        <td className="transport-row-menu">
                          <div
                            className="transport-actions-menu-wrap"
                            ref={openFleetMenu?.kind === 'driver' && openFleetMenu?.id === row.id ? openFleetMenuRef : null}
                          >
                            <button
                              type="button"
                              className="transport-row-menu-button"
                              onClick={(event) => toggleFleetMenu('driver', row.id, event)}
                              aria-label={`Acciones de ${row.fullName}`}
                            >
                              {'\u22ee'}
                            </button>
                            {openFleetMenu?.kind === 'driver' && openFleetMenu?.id === row.id ? (
                              <div className="orders-floating-menu transport-row-dropdown" style={floatingMenuStyle ?? undefined}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDriverDetail(row);
                                    setOpenFleetMenu(null);
                                  }}
                                >
                                  Ver detalle
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    openDriverEdit(row);
                                    setOpenFleetMenu(null);
                                  }}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={async () => {
                                    await handleRemoveDriver(row);
                                  }}
                                >
                                  Eliminar
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredDrivers.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <p className="status">No hay choferes para los filtros seleccionados.</p>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="status">Mostrando {filteredDrivers.length} de {drivers.length} choferes</p>
          </article>
        </div>
      ) : (
        <div className="transport-layout">
          <article className="transport-main-card">
            {currentView === 'transporte' ? (
              <div className="transport-subtabs">
                <button
                  type="button"
                  onClick={() => onSwitchTransportModule?.('devolucion_planificador')}
                >
                  Planificador
                </button>
                <button
                  type="button"
                  className="active"
                  onClick={() => onSwitchTransportModule?.('devolucion_entregas')}
                >
                  Entregas
                </button>
                <button
                  type="button"
                  onClick={() => onSwitchTransportModule?.('devolucion_recojos')}
                >
                  Recojos
                </button>
                <button
                  type="button"
                  onClick={() => onSwitchTransportModule?.('devolucion_rutas')}
                >
                  Flota y Choferes
                </button>
              </div>
            ) : null}

            <header className="transport-toolbar transport-toolbar-v2">
              <label className="transport-search">
                <input
                  type="search"
                  placeholder={currentView === 'recojos' ? 'Buscar por recojo, cliente, chofer o vehiculo...' : 'Buscar por entrega, cliente, chofer o vehiculo...'}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>

              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="todos">Estado: Todos</option>
                <option value="programada">Programada</option>
                <option value="en_ruta">En ruta</option>
                <option value="completada">Completada</option>
                <option value="incidencia">Incidencia</option>
                <option value="cancelada">Cancelada</option>
              </select>

              <select value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)}>
                <option value="todos">Chofer: Todos</option>
                {drivers.map((row) => (
                  <option key={row.id} value={row.id}>{row.fullName}</option>
                ))}
              </select>

              <select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)}>
                <option value="todos">Vehiculo: Todos</option>
                {vehicles.map((row) => (
                  <option key={row.id} value={row.id}>{row.code} - {row.name}</option>
                ))}
              </select>

              <label className="transport-date-filter">
                <span>Desde</span>
                <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              </label>

              <label className="transport-date-filter">
                <span>Hasta</span>
                <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </label>

              <button type="button" className="link-button transport-clear-filters" onClick={clearDeliveryFilters}>
                Limpiar filtros
              </button>
            </header>

            <div className="transport-filter-line">
              <span className="transport-filter-chip">{activeDeliveryFilterSummary}</span>
            </div>

            {renderDeliveriesTable(currentView)}

            <footer className="transport-footer">
            <span>Mostrando {pageStart}-{pageEnd} de {filteredDeliveries.length} {currentView === 'recojos' ? 'recojos' : 'entregas'}</span>
              <div className="transport-pagination">
                <button
                  type="button"
                  onClick={() => setDeliveryPage((current) => Math.max(1, current - 1))}
                  disabled={deliveryPage <= 1}
                >
                  {'<'}
                </button>
                <button type="button" className="active">{deliveryPage}</button>
                <button
                  type="button"
                  onClick={() => setDeliveryPage((current) => Math.min(deliveryPageCount, current + 1))}
                  disabled={deliveryPage >= deliveryPageCount}
                >
                  {'>'}
                </button>
                <select
                  className="transport-page-size"
                  value={deliveryPageSize}
                  onChange={(event) => {
                    setDeliveryPageSize(Number(event.target.value));
                    setDeliveryPage(1);
                  }}
                >
                  {DELIVERY_PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>{size} por pagina</option>
                  ))}
                </select>
              </div>
            </footer>
          </article>

          <aside className="transport-side">
            <article className="transport-side-card">
              <header>
                <h3>Entregas del Dia</h3>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onSwitchTransportModule?.('caja')}
                >
                  Ver calendario
                </button>
              </header>
              <ul className="transport-day-list">
                {deliveriesTodayList.map((row) => {
                  const state = deliveryStateMap[row.status] ?? deliveryStateMap.programada;
                  return (
                    <li key={`day-${row.id}`} onClick={() => setSelectedDeliveryId(row.id)}>
                      <span className="time">{row.windowStart || formatHour(row.createdAt)}</span>
                      <div>
                        <strong>{row.deliveryCode}</strong>
                        <p>{row.customerName}</p>
                      </div>
                      <span className={`transport-status-pill ${state.className}`}>{state.label}</span>
                    </li>
                  );
                })}
                {deliveriesTodayList.length === 0 ? (
                  <li>
                    <div>
                      <strong>Sin entregas para hoy</strong>
                      <p>Programa una nueva entrega para verla aqui.</p>
                    </div>
                  </li>
                ) : null}
              </ul>
            </article>

            {currentView === 'entregas' && selectedDelivery ? (
              <article className="transport-side-card transport-detail-card">
                <header>
                  <h3>[{selectedDelivery.deliveryCode}]</h3>
                  <span className={`transport-status-pill ${(deliveryStateMap[selectedDelivery.status] ?? deliveryStateMap.programada).className}`}>
                    {(deliveryStateMap[selectedDelivery.status] ?? deliveryStateMap.programada).label}
                  </span>
                </header>

                <div className="transport-detail-grid">
                  <div>
                    <small>Orden de Servicio</small>
                    <strong>{selectedDelivery.orderCode || '-'}</strong>
                  </div>
                  <div>
                    <small>Cliente</small>
                    <strong>{selectedDelivery.customerName}</strong>
                    <span>{selectedDelivery.companyName}</span>
                  </div>
                  <div>
                    <small>WhatsApp / Celular</small>
                    <strong>{selectedDelivery.customerPhone || '-'}</strong>
                  </div>
                  <div>
                    <small>Ventana de Entrega</small>
                    <strong>{selectedDelivery.windowStart} - {selectedDelivery.windowEnd}</strong>
                  </div>
                </div>

                <div className="transport-driver-inline">
                  <span className="transport-driver-avatar">
                    <span className="transport-driver-avatar-text">{initials(selectedDelivery.driverName)}</span>
                  </span>
                  <div>
                    <strong>{selectedDelivery.driverName}</strong>
                    <span>{selectedDelivery.driverLicense}</span>
                  </div>
                </div>

                <div className="transport-location-box">
                  <small>Ubicacion Actual</small>
                  <p>{selectedDelivery.address}, {selectedDelivery.city}</p>
                  <span>Actualizado hace 5 min</span>
                </div>

                <button type="button" className="ghost-button" onClick={() => openEditDelivery(selectedDelivery)}>
                  Editar entrega
                </button>

                <button type="button" className="ghost-button" onClick={() => openRouteSheetDocument(selectedDelivery)}>
                  Ver hoja de ruta
                </button>

                <button type="button" className="primary-button transport-live-button" onClick={onGoToRental}>
                  Ver Seguimiento en Vivo
                </button>
              </article>
            ) : (
              <>
                <article className="transport-side-card">
                  <header>
                    <h3>Flota Activa</h3>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onSwitchTransportModule?.('devolucion_rutas')}
                    >
                      Gestionar flota
                    </button>
                  </header>
                  <div className="transport-fleet-summary">
                    <div className="transport-fleet-ring" style={{ '--pct': `${fleetStats.availablePercent}%` }}>
                      <strong>{fleetStats.total}</strong>
                      <span>Total</span>
                    </div>
                    <ul>
                      <li><span className="dot available" /> {fleetStats.available} Disponibles</li>
                      <li><span className="dot route" /> {fleetStats.inRoute} En ruta</li>
                      <li><span className="dot maintenance" /> {fleetStats.maintenance} Mantenimiento</li>
                      <li><span className="dot out" /> {fleetStats.outService} Fuera de servicio</li>
                    </ul>
                  </div>
                </article>

                <article className="transport-side-card">
                  <header>
                    <h3>Alertas</h3>
                    <button type="button" className="link-button" onClick={() => setStatusFilter('incidencia')}>
                      Ver todas
                    </button>
                  </header>
                  <ul className="transport-alert-list">
                    {alerts.map((alert) => (
                      <li key={alert.id} className={alert.type}>
                        <span className="marker">{alert.type === 'error' ? '!' : '~'}</span>
                        <div>
                          <strong>{alert.code}</strong>
                          <p>{alert.detail}</p>
                        </div>
                      </li>
                    ))}
                    {alerts.length === 0 ? (
                      <li className="warn">
                        <div>
                          <strong>Sin alertas</strong>
                          <p>Operacion de transporte normal.</p>
                        </div>
                      </li>
                    ) : null}
                  </ul>
                </article>
              </>
            )}
          </aside>
        </div>
      )}

      {deliveryForm ? (
        <ModalFrame
          title={deliveryModalMode === 'create' ? 'Programar Entrega' : 'Editar Entrega'}
          subtitle={deliveryModalMode === 'create'
            ? 'Registra una entrega y asigna recursos de transporte.'
            : 'Ajusta estado, horario, direccion y asignaciones de la entrega.'}
          onClose={closeDeliveryModal}
          className="transport-modal-lg"
        >
          <form className="transport-modal-body transport-form" onSubmit={submitDeliveryForm}>
            {deliveryModalMode === 'edit' ? (
              <div className="transport-form-note">
                <strong>{deliveryForm.orderCode || '-'}</strong>
                <span>{deliveryForm.customerName} - {deliveryForm.companyName}</span>
              </div>
            ) : null}

            <div className="transport-form-grid">
              {deliveryModalMode === 'create' ? (
                <>
                  <label>
                    Cliente
                    <input
                      type="text"
                      value={deliveryForm.customerName}
                      onChange={(event) => updateDeliveryFormValue('customerName', event.target.value)}
                      placeholder="Nombre del cliente"
                      required
                    />
                  </label>

                  <label>
                    Empresa
                    <input
                      type="text"
                      value={deliveryForm.companyName}
                      onChange={(event) => updateDeliveryFormValue('companyName', event.target.value)}
                      placeholder="Razon social o empresa"
                    />
                  </label>

                  <label>
                    Orden de Servicio (opcional)
                    <input
                      type="text"
                      value={deliveryForm.orderCode}
                      onChange={(event) => updateDeliveryFormValue('orderCode', event.target.value)}
                      placeholder="OS-00001"
                    />
                  </label>

                  <span />
                </>
              ) : null}

              <label>
                Direccion
                <input
                  type="text"
                  value={deliveryForm.address}
                  onChange={(event) => updateDeliveryFormValue('address', event.target.value)}
                  placeholder="Direccion de entrega"
                  required
                />
              </label>

              <label>
                Ciudad
                <input
                  type="text"
                  value={deliveryForm.city}
                  onChange={(event) => updateDeliveryFormValue('city', event.target.value)}
                  placeholder="Ciudad"
                />
              </label>

              <label>
                Fecha programada
                <input
                  type="date"
                  value={deliveryForm.scheduledDate}
                  onChange={(event) => updateDeliveryFormValue('scheduledDate', event.target.value)}
                  required
                />
              </label>

              {deliveryModalMode === 'edit' ? (
                <label>
                  Estado
                  <select
                    value={deliveryForm.status}
                    onChange={(event) => updateDeliveryFormValue('status', event.target.value)}
                  >
                    <option value="programada">Programada</option>
                    <option value="en_ruta">En ruta</option>
                    <option value="completada">Completada</option>
                    <option value="incidencia">Incidencia</option>
                  </select>
                </label>
              ) : (
                <span />
              )}

              <label>
                Hora inicio
                <input
                  type="time"
                  value={deliveryForm.windowStart}
                  onChange={(event) => updateDeliveryFormValue('windowStart', event.target.value)}
                  required
                />
              </label>

              <label>
                Hora fin
                <input
                  type="time"
                  value={deliveryForm.windowEnd}
                  onChange={(event) => updateDeliveryFormValue('windowEnd', event.target.value)}
                  required
                />
              </label>

              <label>
                Chofer
                <select
                  value={deliveryForm.driverId || ''}
                  onChange={(event) => updateDeliveryFormValue('driverId', event.target.value)}
                >
                  <option value="">Sin chofer</option>
                  {drivers.map((row) => (
                    <option key={row.id} value={row.id}>{row.fullName} ({row.code})</option>
                  ))}
                </select>
              </label>

              <label>
                Vehiculo
                <select
                  value={deliveryForm.vehicleId || ''}
                  onChange={(event) => updateDeliveryFormValue('vehicleId', event.target.value)}
                >
                  <option value="">Sin vehiculo</option>
                  {vehicles.map((row) => (
                    <option key={row.id} value={row.id}>{row.code} - {row.name}</option>
                  ))}
                </select>
              </label>

              {deliveryModalMode === 'edit' ? (
                <label>
                  Progreso (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={deliveryForm.progress}
                    onChange={(event) => updateDeliveryFormValue('progress', event.target.value)}
                  />
                </label>
              ) : (
                <span />
              )}

              <label className="full-width">
                Observaciones
                <textarea
                  rows={3}
                  value={deliveryForm.notes}
                  onChange={(event) => updateDeliveryFormValue('notes', event.target.value)}
                  placeholder="Notas operativas"
                />
              </label>
            </div>

            {deliveryFormError ? <p className="status error">{deliveryFormError}</p> : null}

            <div className="transport-modal-actions">
              <button type="button" className="ghost-button" onClick={closeDeliveryModal} disabled={isSavingDelivery}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isSavingDelivery}>
                {isSavingDelivery
                  ? 'Guardando...'
                  : deliveryModalMode === 'create'
                  ? 'Programar entrega'
                  : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </ModalFrame>
      ) : null}

      {vehicleForm ? (
        <ModalFrame
          title={vehicleFormMode === 'edit' ? `Editar Vehiculo ${vehicleForm.code ?? ''}` : 'Nuevo Vehiculo'}
          subtitle={vehicleFormMode === 'edit'
            ? 'Actualiza datos operativos del vehiculo.'
            : 'Registra un nuevo vehiculo para asignarlo en entregas y recojos.'}
          onClose={closeVehicleModal}
        >
          <form className="transport-modal-body transport-form" onSubmit={submitVehicleForm}>
            <div className="transport-form-grid">
              <label>
                Placa o codigo
                <input
                  type="text"
                  value={vehicleForm.code}
                  onChange={(event) => setVehicleForm((current) => ({ ...current, code: event.target.value }))}
                  placeholder="IVE-999"
                  required
                />
              </label>

              <label>
                Nombre
                <input
                  type="text"
                  value={vehicleForm.name}
                  onChange={(event) => setVehicleForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Camion 3.5T"
                />
              </label>

              <label>
                Modelo
                <input
                  type="text"
                  value={vehicleForm.model}
                  onChange={(event) => setVehicleForm((current) => ({ ...current, model: event.target.value }))}
                  placeholder="Marca / Modelo"
                />
              </label>

              <label>
                Tipo
                <input
                  type="text"
                  value={vehicleForm.type}
                  onChange={(event) => setVehicleForm((current) => ({ ...current, type: event.target.value }))}
                  placeholder="Camion / Furgon"
                />
              </label>

              <label>
                Capacidad (kg)
                <input
                  type="number"
                  min="0"
                  value={vehicleForm.capacityKg}
                  onChange={(event) => setVehicleForm((current) => ({ ...current, capacityKg: event.target.value }))}
                />
              </label>

              <label>
                Ano
                <input
                  type="number"
                  min="2000"
                  value={vehicleForm.year}
                  onChange={(event) => setVehicleForm((current) => ({ ...current, year: event.target.value }))}
                />
              </label>

              <label>
                Estado
                <select
                  value={vehicleForm.status}
                  onChange={(event) => setVehicleForm((current) => ({ ...current, status: event.target.value }))}
                >
                  <option value="activo">Activo</option>
                  <option value="mantenimiento">Mantenimiento</option>
                  <option value="fuera_servicio">Fuera de servicio</option>
                </select>
              </label>

              <label>
                Kilometraje
                <input
                  type="number"
                  min="0"
                  value={vehicleForm.mileageKm}
                  onChange={(event) => setVehicleForm((current) => ({ ...current, mileageKm: event.target.value }))}
                />
              </label>

              <label className="full-width">
                Proximo mantenimiento
                <input
                  type="date"
                  value={vehicleForm.nextMaintenanceAt}
                  onChange={(event) => setVehicleForm((current) => ({ ...current, nextMaintenanceAt: event.target.value }))}
                />
              </label>

              <label className="full-width">
                Foto del vehiculo
                <input type="file" accept="image/*" onChange={(event) => handleVehicleImageSelected(event, 'create')} />
              </label>

              {vehicleForm.imageDataUrl ? (
                <div className="transport-photo-preview">
                  <img src={vehicleForm.imageDataUrl} alt="Foto del vehiculo" />
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setVehicleForm((current) => ({ ...current, imageDataUrl: null }))}
                  >
                    Quitar foto
                  </button>
                </div>
              ) : null}
            </div>

            {vehicleFormError ? <p className="status error">{vehicleFormError}</p> : null}

            <div className="transport-modal-actions">
              <button type="button" className="ghost-button" onClick={closeVehicleModal} disabled={isSavingVehicle}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isSavingVehicle}>
                {isSavingVehicle ? 'Guardando...' : vehicleFormMode === 'edit' ? 'Guardar cambios' : 'Guardar vehiculo'}
              </button>
            </div>
          </form>
        </ModalFrame>
      ) : null}

      {driverForm ? (
        <ModalFrame
          title={driverFormMode === 'edit' ? `Editar Chofer ${driverForm.fullName ?? ''}` : 'Nuevo Chofer'}
          subtitle={driverFormMode === 'edit'
            ? 'Actualiza los datos del chofer.'
            : 'Registra choferes disponibles para asignacion de transporte.'}
          onClose={closeDriverModal}
        >
          <form className="transport-modal-body transport-form" onSubmit={submitDriverForm}>
            <div className="transport-form-grid">
              <label>
                Nombre completo
                <input
                  type="text"
                  value={driverForm.fullName}
                  onChange={(event) => setDriverForm((current) => ({ ...current, fullName: event.target.value }))}
                  required
                />
              </label>

              <label>
                Licencia
                <input
                  type="text"
                  value={driverForm.licenseNumber}
                  onChange={(event) => setDriverForm((current) => ({ ...current, licenseNumber: event.target.value }))}
                  required
                />
              </label>

              <label>
                Categoria licencia
                <input
                  type="text"
                  value={driverForm.licenseCategory}
                  onChange={(event) => setDriverForm((current) => ({ ...current, licenseCategory: event.target.value }))}
                />
              </label>

              <label>
                Telefono
                <input
                  type="text"
                  value={driverForm.phone}
                  onChange={(event) => setDriverForm((current) => ({ ...current, phone: event.target.value }))}
                />
              </label>

              <label>
                Estado
                <select
                  value={driverForm.status}
                  onChange={(event) => setDriverForm((current) => ({ ...current, status: event.target.value }))}
                >
                  <option value="activo">Activo</option>
                  <option value="vacaciones">Vacaciones</option>
                  <option value="suspendido">Suspendido</option>
                </select>
              </label>

              <label className="full-width">
                Vencimiento licencia
                <input
                  type="date"
                  value={driverForm.licenseExpiryAt}
                  onChange={(event) => setDriverForm((current) => ({ ...current, licenseExpiryAt: event.target.value }))}
                />
              </label>

              <label className="full-width">
                Foto del chofer
                <input type="file" accept="image/*" onChange={(event) => handleDriverImageSelected(event, 'create')} />
              </label>

              {driverForm.imageDataUrl ? (
                <div className="transport-photo-preview">
                  <img src={driverForm.imageDataUrl} alt="Foto del chofer" />
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setDriverForm((current) => ({ ...current, imageDataUrl: null }))}
                  >
                    Quitar foto
                  </button>
                </div>
              ) : null}
            </div>

            {driverFormError ? <p className="status error">{driverFormError}</p> : null}

            <div className="transport-modal-actions">
              <button type="button" className="ghost-button" onClick={closeDriverModal} disabled={isSavingDriver}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isSavingDriver}>
                {isSavingDriver ? 'Guardando...' : driverFormMode === 'edit' ? 'Guardar cambios' : 'Guardar chofer'}
              </button>
            </div>
          </form>
        </ModalFrame>
      ) : null}

      {vehicleDetail ? (
        <ModalFrame
          title={`Vehiculo ${vehicleDetail.code}`}
          subtitle="Ficha operativa del vehiculo"
          onClose={() => setVehicleDetail(null)}
        >
          <div className="transport-modal-body transport-detail-list">
            <div className="transport-photo-preview transport-photo-preview-detail">
              {vehicleDetail.imageDataUrl ? (
                <img
                  src={vehicleDetail.imageDataUrl}
                  alt={`Foto de ${vehicleDetail.name}`}
                  onClick={() => setMediaPreview({ title: vehicleDetail.name, src: vehicleDetail.imageDataUrl })}
                />
              ) : (
                <div className="transport-empty-photo">Sin foto</div>
              )}
              <div className="transport-photo-actions">
                <input type="file" accept="image/*" onChange={(event) => handleVehicleImageSelected(event, 'detail')} />
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setVehicleDetail((current) => (current ? { ...current, imageDataUrl: null } : current))}
                >
                  Quitar foto
                </button>
              </div>
            </div>
            <p><strong>Nombre:</strong> {vehicleDetail.name}</p>
            <p><strong>Modelo:</strong> {vehicleDetail.model || '-'}</p>
            <p><strong>Tipo:</strong> {vehicleDetail.type || '-'}</p>
            <p><strong>Capacidad:</strong> {vehicleDetail.capacityKg ? `${Number(vehicleDetail.capacityKg).toLocaleString('es-BO')} kg` : '-'}</p>
            <p><strong>Estado:</strong> {(vehicleStateMap[vehicleDetail.status] ?? vehicleStateMap.activo).label}</p>
            <p><strong>Kilometraje:</strong> {Number(vehicleDetail.mileageKm ?? 0).toLocaleString('es-BO')} km</p>
            <p><strong>Proximo mantenimiento:</strong> {vehicleDetail.nextMaintenanceAt ? formatDate(vehicleDetail.nextMaintenanceAt) : '-'}</p>
            <div className="transport-modal-actions">
              <button type="button" className="primary-button" onClick={saveVehiclePhoto} disabled={isSavingVehiclePhoto}>
                {isSavingVehiclePhoto ? 'Guardando...' : 'Guardar foto'}
              </button>
              <button type="button" className="primary-button" onClick={() => setVehicleDetail(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </ModalFrame>
      ) : null}

      {driverDetail ? (
        <ModalFrame
          title={`Chofer ${driverDetail.code}`}
          subtitle="Ficha operativa del chofer"
          onClose={() => setDriverDetail(null)}
          className="transport-modal-lg transport-driver-detail-modal"
        >
          {(() => {
            const state = driverStateMap[driverDetail.status] ?? driverStateMap.activo;
            return (
              <div className="transport-modal-body transport-driver-profile">
                <section className="transport-driver-profile-hero">
                  <div className="transport-driver-profile-photo">
                    {driverDetail.imageDataUrl ? (
                      <button
                        type="button"
                        onClick={() => setMediaPreview({ title: driverDetail.fullName, src: driverDetail.imageDataUrl })}
                        aria-label={`Ver foto de ${driverDetail.fullName}`}
                      >
                        <img src={driverDetail.imageDataUrl} alt={`Foto de ${driverDetail.fullName}`} />
                      </button>
                    ) : (
                      <span>{initials(driverDetail.fullName)}</span>
                    )}
                  </div>
                  <div className="transport-driver-profile-main">
                    <span className={`transport-status-pill ${state.className}`}>{state.label}</span>
                    <h4>{driverDetail.fullName}</h4>
                    <p>Legajo {driverDetail.code} - conductor registrado para operaciones de entrega y recojo.</p>
                  </div>
                  <div className="transport-driver-profile-code">
                    <small>Licencia</small>
                    <strong>{driverDetail.licenseNumber}</strong>
                    <span>{driverDetail.licenseCategory || 'Sin categoria'}</span>
                  </div>
                </section>

                <section className="transport-driver-profile-grid">
                  <article>
                    <span>Telefono</span>
                    <strong>{driverDetail.phone || 'Sin telefono'}</strong>
                    <small>Contacto operativo para rutas y alertas.</small>
                  </article>
                  <article>
                    <span>Vencimiento licencia</span>
                    <strong>{driverDetail.licenseExpiryAt ? formatDate(driverDetail.licenseExpiryAt) : 'Sin fecha'}</strong>
                    <small>Control documental del conductor.</small>
                  </article>
                  <article>
                    <span>Estado operativo</span>
                    <strong>{state.label}</strong>
                    <small>{driverDetail.status === 'activo' ? 'Disponible para asignacion.' : 'Revisar disponibilidad antes de asignar.'}</small>
                  </article>
                  <article>
                    <span>Registro</span>
                    <strong>{driverDetail.code || '-'}</strong>
                    <small>Identificador interno de transporte.</small>
                  </article>
                </section>

                <section className="transport-driver-photo-card">
                  <div>
                    <h4>Foto del chofer</h4>
                    <p>Actualiza la foto de identificacion que se usa en flota y asignaciones.</p>
                  </div>
                  <label>
                    Seleccionar nueva foto
                    <input type="file" accept="image/*" onChange={(event) => handleDriverImageSelected(event, 'detail')} />
                  </label>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setDriverDetail((current) => (current ? { ...current, imageDataUrl: null } : current))}
                  >
                    Quitar foto
                  </button>
                </section>

                <div className="transport-modal-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      openDriverEdit(driverDetail);
                      setDriverDetail(null);
                    }}
                  >
                    Editar datos
                  </button>
                  <button type="button" className="primary-button" onClick={saveDriverPhoto} disabled={isSavingDriverPhoto}>
                    {isSavingDriverPhoto ? 'Guardando...' : 'Guardar foto'}
                  </button>
                  <button type="button" className="primary-button" onClick={() => setDriverDetail(null)}>
                    Cerrar
                  </button>
                </div>
              </div>
            );
          })()}
        </ModalFrame>
      ) : null}

      {mediaPreview ? (
        <ModalFrame title={mediaPreview.title} subtitle="Vista previa de imagen" onClose={() => setMediaPreview(null)} className="transport-modal-lg">
          <div className="transport-modal-body">
            <div className="transport-media-preview">
              <img src={mediaPreview.src} alt={mediaPreview.title} />
            </div>
          </div>
        </ModalFrame>
      ) : null}

      {pickupModal ? (
        <ModalFrame
          title={`Checklist de recojo ${pickupModal.delivery.deliveryCode}`}
          subtitle={`${pickupModal.rental.orderCode ?? '-'} - ${pickupModal.rental.customerName}`}
          onClose={() => setPickupModal(null)}
          className="transport-modal-lg"
        >
          <form className="transport-modal-body" onSubmit={submitPickupChecklist}>
            <div className="transport-form-grid">
              <label>
                Responsable
                <input
                  type="text"
                  value={pickupModal.receivedBy}
                  onChange={(event) => setPickupModal((current) => ({ ...current, receivedBy: event.target.value }))}
                />
              </label>
              <label className="full-width">
                Observaciones del recojo
                <textarea
                  value={pickupModal.notes}
                  onChange={(event) => setPickupModal((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Acceso, responsable que entrega, novedades de carga..."
                />
              </label>
            </div>

            <div className="transport-checklist-table">
              <div className="transport-checklist-head">
                <span>Item</span>
                <span>Esperado</span>
                <span>Recogido</span>
                <span>Estado</span>
                <span>Observacion</span>
              </div>
              {pickupModal.items.map((line) => (
                <div key={line.itemId} className="transport-checklist-row">
                  <strong>{line.itemName}</strong>
                  <span>{line.expectedQty}</span>
                  <input
                    type="number"
                    min="0"
                    max={line.expectedQty}
                    value={line.quantity}
                    onChange={(event) => updatePickupLine(line.itemId, 'quantity', event.target.value)}
                  />
                  <select
                    value={line.condition}
                    onChange={(event) => updatePickupLine(line.itemId, 'condition', event.target.value)}
                  >
                    <option value="ok">Buen estado</option>
                    <option value="observado">Observado</option>
                    <option value="danado">Danado</option>
                    <option value="faltante">Faltante</option>
                  </select>
                  <input
                    type="text"
                    value={line.note}
                    onChange={(event) => updatePickupLine(line.itemId, 'note', event.target.value)}
                    placeholder="Detalle si aplica"
                  />
                </div>
              ))}
            </div>

            {pickupFormError ? <p className="status error">{pickupFormError}</p> : null}

            <div className="transport-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setPickupModal(null)} disabled={isSavingPickup}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isSavingPickup}>
                {isSavingPickup ? 'Guardando...' : 'Guardar checklist'}
              </button>
            </div>
          </form>
        </ModalFrame>
      ) : null}

      {documentPreview ? (
        <div className="orders-modal-backdrop" onClick={() => setDocumentPreview(null)}>
          <div className="orders-modal orders-preview-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>{documentPreview.title}</h3>
                <p>Vista previa de la hoja de ruta para transporte.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setDocumentPreview(null)}>
                x
              </button>
            </header>
            <div className="orders-preview-body">
              <iframe
                id="transport-document-preview-frame"
                title={documentPreview.title}
                srcDoc={documentPreview.html}
                className="orders-document-frame"
              />
            </div>
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setDocumentPreview(null)}>
                Cerrar
              </button>
              <button type="button" className="primary-button" onClick={printRoutePreview}>
                Imprimir / guardar PDF
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default ReturnSection;

