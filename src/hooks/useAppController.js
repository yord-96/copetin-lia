import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { canAccessTab, getDefaultTabForUser, getUserCompanyAccess, getUserDisplayRole } from '../utils/permissions';

const isPrintCanceledError = (error) => {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('print job canceled') || message.includes('cancel');
};

const APPROVAL_BATCH_COLLECTIONS = Object.freeze([
  'clients',
  'items',
  'quotes',
  'contracts',
  'rentals',
  'deliveries',
  'transportRoutes',
  'calendarEvents',
  'generatedReports',
  'inventoryMovements',
  'cashMovements',
  'supplierLoans',
  'systemAuditLog',
]);

const normalizePresenceList = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.active)) return value.active;
  if (Array.isArray(value?.presence)) return value.presence;
  return [];
};


const getPreferredStartupTab = (user) => (
  user && canAccessTab(user, 'alquiler') ? 'alquiler' : getDefaultTabForUser(user)
);

const shouldWaitForCompanyChoice = (user) => {
  if (typeof window === 'undefined') return false;
  const companies = getUserCompanyAccess(user);
  if (companies.length <= 1) return false;
  const selectedCompany = String(
    window.sessionStorage.getItem('copetin-developer-company-choice-v1') ?? '',
  ).trim();
  return !companies.includes(selectedCompany);
};



const buildReceiptsFromRentals = (rentals) => {
  const allReceipts = [];

  for (const rental of rentals) {
    const paidAtRentalBs = Number(
      rental?.payment?.paidAtRentalBs
      ?? rental?.totals?.paidAtRentalBs
      ?? rental?.totals?.totalBs
      ?? 0,
    );
    const pendingPaymentBs = Number(
      rental?.payment?.pendingPaymentBs
      ?? rental?.totals?.pendingPaymentBs
      ?? 0,
    );

    allReceipts.push({
      id: `${rental.id}-alquiler`,
      rentalId: rental.id,
      orderCode: rental.orderCode ?? rental.id,
      type: 'alquiler',
      customerName: rental.customerName,
      customerPhone: rental.customerPhone,
      createdAt: rental.createdAt ?? rental.rentalAt,
      dueDate: rental.dueDate,
      dueTime: rental.dueTime,
      totalBs: Number(rental?.totals?.totalBs ?? 0),
      paidAtRentalBs,
      pendingPaymentBs,
      paymentMode: rental?.payment?.mode ?? 'sin_pago',
      depositBs: Number(rental?.depositBs ?? 0),
      statusLabel: rental.status === 'active' ? 'Vigente' : 'Cerrado',
      items: rental.items ?? [],
    });

    if (rental.status === 'returned') {
      const settlement = rental?.returnSettlement ?? {};
      allReceipts.push({
        id: `${rental.id}-devolucion`,
        rentalId: rental.id,
        orderCode: rental.orderCode ?? rental.id,
        type: 'devolucion',
        customerName: rental.customerName,
        customerPhone: rental.customerPhone,
        createdAt: rental.returnedAt ?? rental.updatedAt ?? rental.createdAt,
        totalBs: Number(rental?.refundBs ?? 0),
        penaltiesBs: Number(rental?.penaltiesBs ?? 0),
        outstandingRentalBs: Number(settlement?.outstandingRentalBs ?? pendingPaymentBs),
        totalDiscountAgainstDepositBs: Number(
          settlement?.totalDiscountAgainstDepositBs
          ?? Number(rental?.penaltiesBs ?? 0) + pendingPaymentBs,
        ),
        pendingCollectionBs: Number(settlement?.pendingCollectionBs ?? 0),
        statusLabel: 'Procesado',
        items: rental.returnReport ?? [],
      });
    }
  }

  return allReceipts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

export const useAppController = () => {
  const [activeTab, setActiveTab] = useState('caja');
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [dashboard, setDashboard] = useState(null);
  const [items, setItems] = useState([]);
  const [inventoryCombos, setInventoryCombos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [hiddenContracts, setHiddenContracts] = useState([]);
  const [supplierBundle, setSupplierBundle] = useState({ suppliers: [], quotes: [], loans: [] });
  const [personnelBundle, setPersonnelBundle] = useState({ employees: [], attendance: [], incidents: [] });
  const [inventoryMovements, setInventoryMovements] = useState([]);
  const [inventoryMovementStats, setInventoryMovementStats] = useState(null);
  const [inventoryModuleLoading, setInventoryModuleLoading] = useState(false);
  const [stockRecoveries, setStockRecoveries] = useState([]);
  const [damageLossOverview, setDamageLossOverview] = useState({ rows: [], total: 0, summary: {} });
  const [rentals, setRentals] = useState([]);
  const [cashSummary, setCashSummary] = useState(null);
  const [cashSessions, setCashSessions] = useState([]);
  const [cashMovements, setCashMovements] = useState([]);
  const [cashDebts, setCashDebts] = useState([]);
  const [cashPaymentChannels, setCashPaymentChannels] = useState([]);
  const [cashReturnIssues, setCashReturnIssues] = useState([]);
  const [cashMovementMeta, setCashMovementMeta] = useState({ total: 0, visible: 0, truncated: false });
  const [accountingOperationsLoading, setAccountingOperationsLoading] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [attendanceUsersLoading, setAttendanceUsersLoading] = useState(false);
  const [userPresence, setUserPresence] = useState([]);
  const [updateNotice, setUpdateNotice] = useState(null);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [transportRoutes, setTransportRoutes] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);

  const getCurrentUserTrace = () => ({
    userId: currentUser?.id ?? null,
    userName: currentUser?.fullName || currentUser?.username || 'Sistema',
    createdBy: currentUser?.username || currentUser?.fullName || 'Sistema',
    createdById: currentUser?.id ?? null,
    createdByName: currentUser?.fullName || currentUser?.username || 'Sistema',
    userRole: currentUser ? getUserDisplayRole(currentUser) : 'Sistema',
    createdByRole: currentUser ? getUserDisplayRole(currentUser) : 'Sistema',
  });
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [settingsBundle, setSettingsBundle] = useState({ settings: null, categories: [] });
  const [generatedReports, setGeneratedReports] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const deferredGroupsLoadedRef = useRef(new Set());
  const calendarOverviewLoadedRef = useRef(false);
  const ordersOverviewLoadedRef = useRef(false);
  const ordersOverviewRequestRef = useRef(null);
  const ordersEditorDataLoadedRef = useRef(false);
  const ordersEditorDataRequestRef = useRef(null);
  const availabilityOverviewLoadedRef = useRef(false);
  const availabilityOverviewRequestRef = useRef(null);
  const fullWorkspaceLoadedRef = useRef(false);
  const [ordersModuleLoading, setOrdersModuleLoading] = useState(false);

  const [imagePreview, setImagePreview] = useState(null);

  const loadData = useCallback(async (options = {}) => {
    const silent = Boolean(options?.silent);
    const calendarFirst = !options?.forceComplete && !calendarOverviewLoadedRef.current;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      if (calendarFirst) {
        const calendarOverview = await api.sync.getMobileCalendarOverview();
        setContracts(Array.isArray(calendarOverview?.contracts) ? calendarOverview.contracts : []);
        setRentals(Array.isArray(calendarOverview?.rentals) ? calendarOverview.rentals : []);
        setDeliveries(Array.isArray(calendarOverview?.deliveries) ? calendarOverview.deliveries : []);
        setCalendarEvents(Array.isArray(calendarOverview?.calendarEvents) ? calendarOverview.calendarEvents : []);
        calendarOverviewLoadedRef.current = true;

        return;
      }

      await api.sync.ensureLoaded({ background: !options?.forceComplete });
      // Los resumenes de Calendario y Ordenes omiten las lineas pesadas. Los
      // modulos operativos que si las necesitan las reciben completas solo al
      // abrirse; nunca se elimina informacion de Inventario o Disponibilidad.
      await api.sync.refreshCollections(['contracts', 'rentals'], 'full-workspace-details');
      const [
        dashboardData,
        inventoryData,
        inventoryCombosData,
        categoriesData,
        quotesData,
        contractsData,
        hiddenContractsData,
        suppliersData,
        rentalsData,
        cashSummaryData,
        cashSessionsData,
        clientsData,
        usersData,
        deliveriesData,
        transportRoutesData,
        vehiclesData,
        driversData,
        calendarEventsData,
        settingsData,
        presenceData,
      ] = await Promise.all([
        api.dashboard.get(),
        api.inventory.list(),
        api.inventory.listCombos(),
        api.categories.list(),
        api.quotes.list(),
        api.contracts.list(),
        api.contracts.listHidden(),
        api.suppliers.listBundle(),
        api.rentals.list(),
        api.cash.getSummary(),
        api.cash.listSessions(),
        api.clients.list(),
        api.users.list(),
        api.transport.listDeliveries(),
        api.transport.listRoutes(),
        api.transport.listVehicles(),
        api.transport.listDrivers(),
        api.calendar.listEvents(),
        api.settings.get(),
        api.presence.listActive(),
      ]);

      setDashboard(dashboardData);
      setItems(inventoryData);
      setInventoryCombos(inventoryCombosData);
      setCategories(categoriesData);
      setQuotes(quotesData);
      setContracts(contractsData);
      setHiddenContracts(hiddenContractsData);
      setSupplierBundle(suppliersData);
      setRentals(rentalsData);
      setCashSummary(cashSummaryData);
      setCashSessions(cashSessionsData);
      setClients(clientsData);
      setUsers(usersData);
      setDeliveries(deliveriesData);
      setTransportRoutes(transportRoutesData);
      setVehicles(vehiclesData);
      setDrivers(driversData);
      setCalendarEvents(calendarEventsData);
      setSettingsBundle(settingsData);
      setUserPresence(normalizePresenceList(presenceData));
      fullWorkspaceLoadedRef.current = true;

      // Las colecciones historicas se cargan al abrir su modulo.

    } catch (loadError) {
      if (!silent) {
        setError(loadError.message || 'No se pudo cargar la informacion.');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  const prepareTabData = useCallback(async (targetTab) => {
    const requestedTab = String(targetTab);
    if (requestedTab === 'disponibilidad') {
      if (availabilityOverviewLoadedRef.current) return;
      if (availabilityOverviewRequestRef.current) {
        await availabilityOverviewRequestRef.current;
        return;
      }
      const request = api.sync.getAvailabilityOverview()
        .then((overview) => {
          setContracts(Array.isArray(overview?.contracts) ? overview.contracts : []);
          setRentals(Array.isArray(overview?.rentals) ? overview.rentals : []);
          setQuotes(Array.isArray(overview?.quotes) ? overview.quotes : []);
          setClients(Array.isArray(overview?.clients) ? overview.clients : []);
          setItems(Array.isArray(overview?.items) ? overview.items : []);
          setCategories(Array.isArray(overview?.categories) ? overview.categories : []);
          availabilityOverviewLoadedRef.current = true;
        })
        .catch((availabilityError) => {
          setError(availabilityError.message || 'No se pudo cargar Disponibilidad.');
          throw availabilityError;
        })
        .finally(() => {
          availabilityOverviewRequestRef.current = null;
        });
      availabilityOverviewRequestRef.current = request;
      await request;
      return;
    }

    if (requestedTab !== 'alquiler' || ordersOverviewLoadedRef.current) return;
    if (ordersOverviewRequestRef.current) {
      await ordersOverviewRequestRef.current;
      return;
    }
    setOrdersModuleLoading(true);
    const request = api.sync.getMobileOrdersOverview()
      .then((overview) => {
        setContracts(Array.isArray(overview?.contracts) ? overview.contracts : []);
        setHiddenContracts(Array.isArray(overview?.hiddenContracts) ? overview.hiddenContracts : []);
        setRentals(Array.isArray(overview?.rentals) ? overview.rentals : []);
        setDeliveries(Array.isArray(overview?.deliveries) ? overview.deliveries : []);
        setQuotes(Array.isArray(overview?.quotes) ? overview.quotes : []);
        ordersOverviewLoadedRef.current = true;
      })
      .catch((ordersError) => {
        setError(ordersError.message || 'No se pudo cargar Ordenes.');
        throw ordersError;
      })
      .finally(() => {
        ordersOverviewRequestRef.current = null;
        setOrdersModuleLoading(false);
      });

    ordersOverviewRequestRef.current = request;
    await request;
  }, []);

  const prepareOrdersEditorData = useCallback(async () => {
    if (ordersEditorDataLoadedRef.current) return;
    if (ordersEditorDataRequestRef.current) {
      await ordersEditorDataRequestRef.current;
      return;
    }

    const request = api.sync.getOrdersEditorOverview()
      .then((overview) => {
        setClients(Array.isArray(overview?.clients) ? overview.clients : []);
        setItems(Array.isArray(overview?.items) ? overview.items : []);
        setInventoryCombos(Array.isArray(overview?.inventoryCombos) ? overview.inventoryCombos : []);
        setSupplierBundle({
          suppliers: Array.isArray(overview?.suppliers) ? overview.suppliers : [],
          quotes: Array.isArray(overview?.supplierQuotes) ? overview.supplierQuotes : [],
          loans: Array.isArray(overview?.supplierLoans) ? overview.supplierLoans : [],
        });
        setVehicles(Array.isArray(overview?.vehicles) ? overview.vehicles : []);
        setDrivers(Array.isArray(overview?.drivers) ? overview.drivers : []);
        setUsers(Array.isArray(overview?.users) ? overview.users : []);
        setPersonnelBundle((current) => ({
          ...current,
          employees: Array.isArray(overview?.personnelEmployees) ? overview.personnelEmployees : [],
        }));
        setSettingsBundle((current) => ({
          ...current,
          settings: overview?.settings ?? current?.settings ?? null,
        }));
        ordersEditorDataLoadedRef.current = true;
      })
      .finally(() => {
        ordersEditorDataRequestRef.current = null;
      });

    ordersEditorDataRequestRef.current = request;
    await request;
  }, []);

  useEffect(() => {
    if (!authReady || !currentUser || !['alquiler', 'disponibilidad'].includes(String(activeTab))) return;
    prepareTabData(activeTab).catch(() => {});
  }, [activeTab, authReady, currentUser, prepareTabData]);

  useEffect(() => {
    if (!authReady || !currentUser || fullWorkspaceLoadedRef.current) return;
    // Calendario, Ordenes y Asistencia tienen endpoints pequenos propios. El
    // resto del sistema conserva la carga completa, pero ya de forma diferida.
    if (
      ['caja', 'alquiler', 'disponibilidad', 'asistencia'].includes(String(activeTab))
      || String(activeTab).startsWith('inventario')
    ) return;
    loadData({ forceComplete: true }).catch(() => {});
  }, [activeTab, authReady, currentUser, loadData]);

  useEffect(() => {
    if (!authReady || !currentUser) return;

    let group = null;
    let loader = null;
    const activeInventoryTab = String(activeTab);
    if (activeTab === 'asistencia') {
      group = 'attendance-users';
      loader = async () => {
        setAttendanceUsersLoading(true);
        try {
          // Muestra cualquier copia local inmediatamente y consulta despues el
          // endpoint atomico, que solo transporta los campos usados por Asistencia.
          const cachedUsers = await api.users.listCached();
          if (Array.isArray(cachedUsers) && cachedUsers.length > 0) {
            setUsers(cachedUsers);
            setAttendanceUsersLoading(false);
          }
          const attendanceUsers = await api.attendance.listUsers();
          setUsers(attendanceUsers);
        } finally {
          setAttendanceUsersLoading(false);
        }
      };
    } else if (activeTab === 'personal') {
      group = 'personnel';
      loader = async () => setPersonnelBundle(await api.personnel.listBundle());
    } else if (activeTab === 'recibos') {
      group = 'reports';
      loader = async () => {
        const [reportsData, auditData] = await Promise.all([
          api.reports.listGenerated(),
          api.audit.list(),
        ]);
        setGeneratedReports(reportsData);
        setAuditLog(auditData);
      };
    } else if (activeInventoryTab === 'inventario_mantenimiento') {
      group = 'inventory-damage-loss';
      loader = async () => {
        setInventoryModuleLoading(true);
        try {
          const overview = await api.inventory.getDamageLossOverview();
          setDamageLossOverview({
            rows: Array.isArray(overview?.rows) ? overview.rows : [],
            total: Number(overview?.total ?? overview?.rows?.length ?? 0),
            summary: overview?.summary ?? {},
          });
        } finally {
          setInventoryModuleLoading(false);
        }
      };
    } else if (activeInventoryTab.startsWith('inventario')) {
      group = 'inventory-overview';
      loader = async () => {
        setInventoryModuleLoading(true);
        try {
          const overview = await api.sync.getInventoryMovementsOverview();
          setItems(Array.isArray(overview?.items) ? overview.items : []);
          setInventoryCombos(Array.isArray(overview?.inventoryCombos) ? overview.inventoryCombos : []);
          setCategories(Array.isArray(overview?.categories) ? overview.categories : []);
          setContracts(Array.isArray(overview?.contracts) ? overview.contracts : []);
          setRentals(Array.isArray(overview?.rentals) ? overview.rentals : []);
          setDeliveries(Array.isArray(overview?.deliveries) ? overview.deliveries : []);
          setInventoryMovements(Array.isArray(overview?.inventoryMovements) ? overview.inventoryMovements : []);
          setInventoryMovementStats(overview?.movementStats ?? null);
        } finally {
          setInventoryModuleLoading(false);
        }
      };
    } else if (String(activeTab).startsWith('contabilidad')) {
      group = 'accounting-operations';
      loader = async () => {
        setAccountingOperationsLoading(true);
        try {
          const context = await api.cash.getAccountingContext();
          setCashMovements(Array.isArray(context?.movements) ? context.movements : []);
          setCashDebts(Array.isArray(context?.debts) ? context.debts : []);
          setCashPaymentChannels(Array.isArray(context?.paymentChannels) ? context.paymentChannels : []);
          setCashReturnIssues(Array.isArray(context?.returnIssues) ? context.returnIssues : []);
          setCashMovementMeta({
            total: Number(context?.totalMovements ?? context?.movements?.length ?? 0),
            visible: Number(context?.visibleMovements ?? context?.movements?.length ?? 0),
            truncated: Boolean(context?.truncated),
          });
        } finally {
          setAccountingOperationsLoading(false);
        }
      };
    }

    if (!group || !loader || deferredGroupsLoadedRef.current.has(group)) return;
    deferredGroupsLoadedRef.current.add(group);
    loader().catch((deferredError) => {
      deferredGroupsLoadedRef.current.delete(group);
      console.warn(`[copetin] No se pudo cargar el grupo diferido ${group}.`, deferredError);
    });
  }, [activeTab, authReady, currentUser]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleVipPrepaidRefresh = async () => {
      try {
        const [overview, context] = await Promise.all([
          api.sync.getMobileOrdersOverview(),
          api.cash.getAccountingContext(),
        ]);
        if (Array.isArray(overview?.clients)) setClients(overview.clients);
        if (Array.isArray(overview?.contracts)) setContracts(overview.contracts);
        if (Array.isArray(overview?.rentals)) setRentals(overview.rentals);
        if (Array.isArray(context?.movements)) setCashMovements(context.movements);
        if (Array.isArray(context?.debts)) setCashDebts(context.debts);
        if (Array.isArray(context?.paymentChannels)) setCashPaymentChannels(context.paymentChannels);
        if (Array.isArray(context?.returnIssues)) setCashReturnIssues(context.returnIssues);
      } catch (refreshError) {
        console.warn('[copetin] No se pudo refrescar el estado VIP.', refreshError);
      }
    };
    window.addEventListener('copetin:vip-prepaid-updated', handleVipPrepaidRefresh);
    return () => window.removeEventListener('copetin:vip-prepaid-updated', handleVipPrepaidRefresh);
  }, []);

  const publishPresence = useCallback(async () => {
    if (!currentUser) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
      const active = await api.presence.heartbeat({
        userId: currentUser.id,
        sessionId: currentUser.sessionId,
        fullName: currentUser.fullName ?? currentUser.username,
        role: getUserDisplayRole(currentUser),
        activeTab,
        device: currentUser.device,
      });
      setUserPresence(normalizePresenceList(active));
    } catch {
      // Presence is supportive; the app should keep working if the heartbeat fails.
    }
  }, [activeTab, currentUser]);

  const refreshUpdateNotice = useCallback(async () => {
    try {
      const notice = await api.updateNotice.get();
      setUpdateNotice(notice);
    } catch {
      // El aviso es informativo; no debe bloquear la operacion.
    }
  }, []);

  useEffect(() => {
    if (!authReady || !currentUser) return undefined;
    publishPresence();
    refreshUpdateNotice();
    const intervalId = window.setInterval(publishPresence, 60000);
    const noticeIntervalId = window.setInterval(refreshUpdateNotice, 60000);
    const publishWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        publishPresence();
      }
    };
    const leavePresence = () => {
      api.presence.leave({ userId: currentUser.id, sessionId: currentUser.sessionId }).catch(() => {});
    };
    document.addEventListener('visibilitychange', publishWhenVisible);
    window.addEventListener('pagehide', leavePresence);
    return () => {
      window.clearInterval(intervalId);
      window.clearInterval(noticeIntervalId);
      document.removeEventListener('visibilitychange', publishWhenVisible);
      window.removeEventListener('pagehide', leavePresence);
    };
  }, [authReady, currentUser, publishPresence, refreshUpdateNotice]);

  useEffect(() => {
    if (!authReady || !currentUser) return undefined;

    let refreshTimer = null;
    let presenceTimer = null;
    let disposed = false;

    const refreshPresence = async () => {
      try {
        const active = await api.presence.listActive();
        if (!disposed) {
          setUserPresence(normalizePresenceList(active));
        }
      } catch {
        // Presence should never block the main workflow.
      }
    };

    const refreshOrderContractsAndRentals = async () => {
      try {
        // En Ordenes sincronizamos solamente las dos colecciones que alimentan
        // la tabla y sus estados operativos. Esto permite reflejar notas y
        // movimientos de otros usuarios sin reemplazar todo el estado local.
        await api.sync.refreshCollections(['contracts', 'rentals'], 'orders-contract-change');
        const [contractsData, rentalsData] = await Promise.all([
          api.contracts.list(),
          api.rentals.list(),
        ]);
        if (!disposed) {
          setContracts(contractsData);
          setRentals(rentalsData);
        }
      } catch (refreshError) {
        console.warn('[copetin] No se pudieron sincronizar contratos y alquileres de las ordenes.', refreshError);
      }
    };

    const unsubscribe = api.sync.subscribe((event) => {
      if (disposed) return;

      if (
        String(activeTab) === 'inventario_mantenimiento'
        && event?.domain === 'inventory'
        && event?.method === 'damageRepairReinsert'
      ) {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(async () => {
          try {
            const [overview, inventoryData] = await Promise.all([
              api.inventory.getDamageLossOverview(),
              api.inventory.list(),
            ]);
            if (!disposed) {
              setDamageLossOverview({
                rows: Array.isArray(overview?.rows) ? overview.rows : [],
                total: Number(overview?.total ?? overview?.rows?.length ?? 0),
                summary: overview?.summary ?? {},
              });
              setItems(Array.isArray(inventoryData) ? inventoryData : []);
            }
          } catch (refreshError) {
            console.warn('[copetin] No se pudo refrescar Daños y Faltantes.', refreshError);
          }
        }, 50);
        return;
      }

      if (event?.domain === 'presence') {
        window.clearTimeout(presenceTimer);
        presenceTimer = window.setTimeout(() => {
          refreshPresence();
          refreshUpdateNotice();
        }, 250);
        return;
      }

      // Los cambios de esta misma pestaña ya actualizaron el estado React
      // desde el resultado de la mutacion. Solo refrescamos cuando el cambio
      // proviene de otra pestaña/usuario o de una sincronizacion remota real.
      const isRemoteChange = event?.reason === 'broadcast'
        || event?.reason === 'storage'
        || event?.reason === 'remote-revision'
        || event?.source === 'remote'
        || event?.source === 'storage';
      const isBackgroundStateReplacement = event?.source === 'background-sync';
      if (!isRemoteChange && !isBackgroundStateReplacement) return;
      // El reemplazo silencioso ya actualizó la base local. No reconstruimos
      // todas las vistas inmediatamente porque bloquea la navegación en PC.
      if (isBackgroundStateReplacement && !isRemoteChange) return;

      if (activeTab === 'asistencia') {
        const changedCollections = Array.isArray(event?.collections) ? event.collections : [];
        const attendanceChanged = event?.domain === 'attendance'
          || changedCollections.includes('attendanceRecords');
        if (attendanceChanged) {
          window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(async () => {
            try {
              const today = new Date();
              const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
                .toISOString().slice(0, 10);
              const records = await api.attendance.listRecords({
                dateFrom: localToday,
                dateTo: localToday,
                limit: 300,
              });
              if (!disposed) setAttendanceRecords(records);
            } catch (refreshError) {
              console.warn('[copetin] No se pudo refrescar asistencia.', refreshError);
            }
          }, 100);
        }
        return;
      }

      // Ordenes no necesita una recarga global para reflejar un cambio de
      // Movimientos. Sincroniza solamente alquileres y actualiza React una vez.
      if (activeTab === 'alquiler') {
        const changedCollections = Array.isArray(event?.collections) ? event.collections : [];
        const ordersChanged = event?.domain === 'rentals'
          || event?.domain === 'contracts'
          || changedCollections.includes('rentals')
          || changedCollections.includes('contracts');
        if (ordersChanged) {
          window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(refreshOrderContractsAndRentals, 100);
        }
        return;
      }

      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        if (!disposed) {
          loadData({ silent: true });
        }
      }, isRemoteChange ? 450 : 0);
    });

    return () => {
      disposed = true;
      window.clearTimeout(refreshTimer);
      window.clearTimeout(presenceTimer);
      unsubscribe();
    };
  }, [activeTab, authReady, currentUser, loadData, refreshUpdateNotice]);

  useEffect(() => {
    let isMounted = true;
    const loadSession = async () => {
      setAuthError('');
      try {
        const session = await api.auth.getSession();
        if (!isMounted) return;
        setCurrentUser(session);
        setActiveTab(session ? getPreferredStartupTab(session) : 'caja');
      } catch (sessionError) {
        if (!isMounted) return;
        setAuthError(sessionError.message || 'No se pudo verificar la sesion.');
      } finally {
        if (isMounted) setAuthReady(true);
      }
    };

    loadSession();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!currentUser) {
      setLoading(false);
      return;
    }
    if (!getUserCompanyAccess(currentUser).includes('copetin')) {
      setLoading(false);
      return;
    }
    // Si el usuario puede entrar a dos empresas, primero mostramos el selector.
    // Evita descargar, descomprimir y procesar la base de Copetin detras del modal.
    if (shouldWaitForCompanyChoice(currentUser)) {
      setLoading(false);
      return;
    }
    if (String(activeTab) === 'alquiler') {
      // Ordenes es la vista inicial preferida. Evitamos cargar Calendario primero:
      // su resumen se solicitará únicamente cuando el usuario abra esa sección.
      setLoading(false);
      return;
    }
    loadData();
  }, [activeTab, authReady, currentUser, loadData]);

  useEffect(() => {
    if (!currentUser || canAccessTab(currentUser, activeTab)) return;
    setActiveTab(getDefaultTabForUser(currentUser));
  }, [activeTab, currentUser]);

  const activeRentals = useMemo(() => rentals.filter((rental) => rental.status === 'active'), [rentals]);
  const returnedRentals = useMemo(() => rentals.filter((rental) => rental.status === 'returned'), [rentals]);
  const cancelledRentals = useMemo(() => rentals.filter((rental) => rental.status === 'cancelled'), [rentals]);
  const receipts = useMemo(() => buildReceiptsFromRentals(rentals), [rentals]);
  const activeCashSession = cashSummary?.activeSession ?? null;

  const summaryCards = dashboard
    ? [
      { id: 'active', title: 'Alquileres Activos', value: dashboard.cards.activeRentals, badge: 'ALQ' },
      { id: 'returned', title: 'Alquileres Devueltos', value: dashboard.cards.returnedRentals, badge: 'DEV' },
      { id: 'items', title: 'Items Registrados', value: dashboard.cards.totalItems, badge: 'ITM' },
      { id: 'rented', title: 'Stock Alquilado', value: dashboard.cards.rentedStock, badge: 'STK' },
    ]
    : [];

  const categoryItemCount = useMemo(() => {
    const counts = {};
    for (const item of items) {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  const isCatalogView =
    activeTab === 'caja'
    || activeTab === 'recibos'
    || activeTab === 'categorias'
    || activeTab === 'items'
    || activeTab === 'usuarios'
    || activeTab === 'proveedores'
    || activeTab === 'asistencia'
    || activeTab === 'personal'
    || activeTab === 'contabilidad'
    || String(activeTab).startsWith('inventario')
    || String(activeTab).startsWith('devolucion')
    || activeTab === 'alquiler'
    || activeTab === 'disponibilidad';

  const subtitleText =
    activeTab === 'resumen'
      ? ''
      : activeTab === 'caja'
      ? 'Visualiza y gestiona entregas, mantenimientos y vencimientos.'
      : activeTab === 'recibos'
      ? 'Analiza el rendimiento de tu negocio con reportes detallados.'
      : activeTab === 'categorias'
      ? 'Configura preferencias, numeracion y parametros regionales del sistema.'
      : activeTab === 'items'
      ? 'Gestiona tu base de clientes y consulta su historial.'
      : activeTab === 'usuarios'
      ? 'Gestiona usuarios, roles y permisos de operacion.'
      : activeTab === 'proveedores'
      ? 'Gestiona proveedores, listas de precios y solicitudes de abastecimiento con costo.'
      : activeTab === 'asistencia'
      ? 'Registra entradas, salidas, ubicaciones y respaldos de asistencia fuera de oficina.'
      : activeTab === 'personal'
      ? 'Gestiona personal, asistencia, permisos y horas trabajadas.'
      : activeTab === 'disponibilidad'
      ? 'Consulta el stock libre, comprometido y tentativo para cualquier fecha.'
      : activeTab === 'contabilidad'
      ? 'Controla caja, garantias, saldos por cobrar y liquidaciones de devolucion.'
      : String(activeTab).startsWith('inventario')
      ? 'Control operativo de stock, movimientos y ajustes de inventario.'
      : String(activeTab).startsWith('devolucion')
      ? 'Gestiona entregas, flota y choferes de forma integrada.'
      : 'Gestion de ordenes de servicio de alquiler.';

  const handleCreateClient = async (payload) => {
    setError('');
    try {
      await api.clients.create(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el cliente.');
      throw requestError;
    }
  };

  const handleUpdateClient = async (payload) => {
    setError('');
    try {
      await api.clients.update(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el cliente.');
      throw requestError;
    }
  };

  const handleCreateUser = async (payload) => {
    setError('');
    try {
      const createdUser = await api.users.create(payload);
      setUsers((current) => (
        [...current.filter((user) => user.id !== createdUser.id), createdUser]
          .sort((a, b) => String(a.fullName ?? '').localeCompare(String(b.fullName ?? ''), 'es'))
      ));
      return createdUser;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el usuario.');
      throw requestError;
    }
  };

  const handleLogin = async (payload) => {
    setAuthError('');
    setError('');
    setLoading(true);
    try {
      const session = await api.auth.login(payload);
      deferredGroupsLoadedRef.current.clear();
      calendarOverviewLoadedRef.current = false;
      ordersOverviewLoadedRef.current = false;
      ordersOverviewRequestRef.current = null;
      ordersEditorDataLoadedRef.current = false;
      ordersEditorDataRequestRef.current = null;
      availabilityOverviewLoadedRef.current = false;
      availabilityOverviewRequestRef.current = null;
      fullWorkspaceLoadedRef.current = false;
      setCurrentUser(session);
      setActiveTab(getPreferredStartupTab(session));
      return session;
    } catch (requestError) {
      setLoading(false);
      setAuthError(requestError.message || 'No se pudo iniciar sesion.');
      throw requestError;
    }
  };

  const handleLogout = async () => {
    setAuthError('');
    setError('');
    try {
      if (currentUser?.id) {
        await api.presence.leave({ userId: currentUser.id, sessionId: currentUser.sessionId });
      }
      await api.auth.logout();
    } finally {
      setCurrentUser(null);
      setUserPresence([]);
      setActiveTab('caja');
      setImagePreview(null);
    }
  };

  const handleUpdateUser = async (payload) => {
    setError('');
    try {
      const updatedUser = await api.users.update(payload);
      setUsers((current) => (
        current
          .map((user) => (user.id === updatedUser.id ? updatedUser : user))
          .sort((a, b) => String(a.fullName ?? '').localeCompare(String(b.fullName ?? ''), 'es'))
      ));

      // Si el developer modifica su propio usuario, mantenemos la sesión visual
      // sincronizada sin forzar una recarga completa de toda la aplicación.
      if (updatedUser?.id && updatedUser.id === currentUser?.id) {
        setCurrentUser((current) => current ? { ...current, ...updatedUser } : current);
      }
      return updatedUser;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el usuario.');
      throw requestError;
    }
  };

  const handleRemoveUser = async (payload) => {
    setError('');
    try {
      const removedUser = await api.users.remove(payload);
      const removedId = removedUser?.id ?? payload?.id;
      setUsers((current) => current.filter((user) => user.id !== removedId));
      return removedUser;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar el usuario.');
      throw requestError;
    }
  };

  const handleResendInvite = async (payload) => {
    setError('');
    try {
      const updatedUser = await api.users.resendInvite(payload);
      if (updatedUser?.id) {
        setUsers((current) => current.map((user) => (
          user.id === updatedUser.id ? updatedUser : user
        )));
      }
      return updatedUser;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo reenviar la invitacion.');
      throw requestError;
    }
  };

  const handleCreatePersonnelEmployee = async (payload) => {
    setError('');
    try {
      const created = await api.personnel.createEmployee(payload);
      await loadData();
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el personal.');
      throw requestError;
    }
  };

  const handleUpdatePersonnelEmployee = async (payload) => {
    setError('');
    try {
      const updated = await api.personnel.updateEmployee(payload);
      await loadData();
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el personal.');
      throw requestError;
    }
  };

  const handleRemovePersonnelEmployee = async (payload) => {
    setError('');
    try {
      await api.personnel.removeEmployee(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo dar de baja al personal.');
      throw requestError;
    }
  };

  const handleCreatePersonnelIncident = async (payload) => {
    setError('');
    try {
      const created = await api.personnel.createIncident(payload);
      await loadData();
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo registrar el permiso o falta.');
      throw requestError;
    }
  };

  const handleImportPersonnelAttendance = async (payload) => {
    setError('');
    try {
      const result = await api.personnel.importAttendance(payload);
      await loadData();
      return result;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo importar la asistencia.');
      throw requestError;
    }
  };

  const handleCreateDelivery = async (payload) => {
    setError('');
    try {
      await api.transport.createDelivery(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear la entrega.');
      throw requestError;
    }
  };

  const handleUpdateDelivery = async (payload) => {
    setError('');
    try {
      await api.transport.updateDelivery(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la entrega.');
      throw requestError;
    }
  };

  const handleCreateTransportRoute = async (payload) => {
    setError('');
    try {
      const created = await api.transport.createRoute(payload);
      await loadData();
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear la ruta.');
      throw requestError;
    }
  };

  const handleUpdateTransportRoute = async (payload) => {
    setError('');
    try {
      const updated = await api.transport.updateRoute(payload);
      await loadData();
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la ruta.');
      throw requestError;
    }
  };

  const handleRegisterPickupChecklist = async (payload) => {
    setError('');
    try {
      const updated = await api.transport.registerPickupChecklist(payload);
      await loadData();
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo registrar el recojo.');
      throw requestError;
    }
  };

  const handleReceiveReturnedOrder = async (payload) => {
    setError('');
    try {
      const returned = await api.rentals.registerReturn({
        ...payload,
        ...getCurrentUserTrace(),
        requireCashSession: false,
      });
      const inventoryItems = Array.isArray(returned?.__inventoryItems) ? returned.__inventoryItems : [];
      const lossMovements = Array.isArray(returned?.__inventoryLossMovements) ? returned.__inventoryLossMovements : [];
      const { __inventoryItems, __inventoryLossMovements, ...returnedRental } = returned ?? {};
      setRentals((current) => current.map((rental) => (
        rental.id === returnedRental.id
          ? {
              ...rental,
              ...returnedRental,
              operational: { ...(rental.operational ?? {}), ...(returnedRental.operational ?? {}) },
            }
          : rental
      )));
      if (inventoryItems.length > 0) {
        const byId = new Map(inventoryItems.map((item) => [String(item?.id ?? ''), item]));
        setItems((current) => current.map((item) => byId.has(String(item?.id ?? '')) ? { ...item, ...byId.get(String(item.id)) } : item));
      }
      if (lossMovements.length > 0) {
        setInventoryMovements((current) => {
          const incomingIds = new Set(lossMovements.map((movement) => String(movement?.id ?? '')));
          return [...lossMovements, ...current.filter((movement) => !incomingIds.has(String(movement?.id ?? '')))];
        });
      }
      deferredGroupsLoadedRef.current.delete('inventory-damage-loss');
      return returnedRental;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo recibir la devolucion en inventario.');
      throw requestError;
    }
  };

  const handleCreateVehicle = async (payload) => {
    setError('');
    try {
      await api.transport.createVehicle(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el vehiculo.');
      throw requestError;
    }
  };

  const handleUpdateVehicle = async (payload) => {
    setError('');
    try {
      await api.transport.updateVehicle(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el vehiculo.');
      throw requestError;
    }
  };

  const handleRemoveVehicle = async (payload) => {
    setError('');
    try {
      await api.transport.removeVehicle(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar el vehiculo.');
      throw requestError;
    }
  };

  const handleCreateDriver = async (payload) => {
    setError('');
    try {
      await api.transport.createDriver(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el chofer.');
      throw requestError;
    }
  };

  const handleRemoveDriver = async (payload) => {
    setError('');
    try {
      await api.transport.removeDriver(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar el chofer.');
      throw requestError;
    }
  };

  const handleUpdateDriver = async (payload) => {
    setError('');
    try {
      await api.transport.updateDriver(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el chofer.');
      throw requestError;
    }
  };

  const handleCreateCalendarEvent = async (payload) => {
    setError('');
    try {
      await api.calendar.createEvent(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el evento.');
      throw requestError;
    }
  };

  const handleUpdateSettings = async (payload) => {
    setError('');
    try {
      await api.settings.update(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudieron guardar los ajustes.');
      throw requestError;
    }
  };

  const handleGenerateReport = async (payload) => {
    setError('');
    try {
      await api.reports.generate({ ...getCurrentUserTrace(), ...payload });
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo generar el reporte.');
      throw requestError;
    }
  };

  const handleCreateInventoryItem = async (payload) => {
    setError('');
    try {
      const createdItem = await api.inventory.create({ ...getCurrentUserTrace(), ...payload });
      setItems((current) => (
        [...current.filter((item) => item.id !== createdItem.id), createdItem]
          .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es'))
      ));
      api.dashboard.get().then(setDashboard).catch(() => {});
      return createdItem;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el producto de inventario.');
      throw requestError;
    }
  };

  const handleUploadProductImage = async (file, options) => {
    setError('');
    try {
      return await api.uploads.productImage(file, options);
    } catch (requestError) {
      setError(requestError.message || 'No se pudo subir la imagen del producto.');
      throw requestError;
    }
  };

  const handleUpdateInventoryItem = async (payload) => {
    setError('');
    try {
      const updatedItem = await api.inventory.update({ ...getCurrentUserTrace(), ...payload });
      setItems((current) => (
        current
          .map((item) => (item.id === updatedItem.id ? updatedItem : item))
          .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es'))
      ));
      api.dashboard.get().then(setDashboard).catch(() => {});
      return updatedItem;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el producto de inventario.');
      throw requestError;
    }
  };

  const handleRemoveInventoryItem = async (payload) => {
    setError('');
    try {
      const removedItem = await api.inventory.remove({ ...getCurrentUserTrace(), ...payload });
      const removedId = removedItem?.id ?? payload?.id;
      setItems((current) => current.filter((item) => item.id !== removedId));
      api.dashboard.get().then(setDashboard).catch(() => {});
      return removedItem;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar el producto de inventario.');
      throw requestError;
    }
  };

  const handleCreateInventoryCombo = async (payload) => {
    setError('');
    try {
      await api.inventory.createCombo(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el combo de inventario.');
      throw requestError;
    }
  };

  const handleUpdateInventoryCombo = async (payload) => {
    setError('');
    try {
      await api.inventory.updateCombo(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el combo de inventario.');
      throw requestError;
    }
  };

  const handleRemoveInventoryCombo = async (payload) => {
    setError('');
    try {
      await api.inventory.removeCombo(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar el combo de inventario.');
      throw requestError;
    }
  };

  const handleCreateInventoryMovement = async (payload) => {
    setError('');
    try {
      await api.inventory.createMovement({
        ...payload,
        ...getCurrentUserTrace(),
      });
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo registrar el movimiento de inventario.');
      throw requestError;
    }
  };

  const handleProcessStockRecovery = async (payload) => {
    setError('');
    const recoveryId = String(payload?.recoveryId ?? '').trim();
    const action = String(payload?.action ?? '').trim();
    const quantity = Math.max(0, Math.trunc(Number(payload?.quantity ?? 0)));
    const currentRecovery = stockRecoveries.find((entry) => entry.id === recoveryId);
    try {
      const result = await api.inventory.processRecovery({
        ...payload,
        ...getCurrentUserTrace(),
      });

      if (result?.item?.id) {
        setItems((current) => current.map((item) => (
          String(item?.id ?? '') === String(result.item.id) ? { ...item, ...result.item } : item
        )));
      } else if (currentRecovery && quantity > 0) {
        // Compatibilidad con el bridge local si se ejecuta sin servidor.
        setItems((current) => current.map((item) => {
          if (item.id !== currentRecovery.itemId) return item;
          if (action === 'reinsert') {
            return {
              ...item,
              availableStock: Math.min(
                Number(item.totalStock ?? 0),
                Number(item.availableStock ?? 0) + quantity,
              ),
              updatedAt: new Date().toISOString(),
            };
          }
          if (action === 'discard') {
            return {
              ...item,
              totalStock: Math.max(0, Number(item.totalStock ?? 0) - quantity),
              updatedAt: new Date().toISOString(),
            };
          }
          return item;
        }));
      }

      if (Object.prototype.hasOwnProperty.call(result ?? {}, 'recovery')) {
        setStockRecoveries((current) => {
          if (!result.recovery) return current.filter((entry) => entry.id !== recoveryId);
          return current.map((entry) => (
            entry.id === recoveryId ? { ...entry, ...result.recovery } : entry
          ));
        });
      } else if (currentRecovery && quantity > 0) {
        setStockRecoveries((current) => current
          .map((entry) => (
            entry.id === recoveryId
              ? {
                  ...entry,
                  quantity: Math.max(0, Number(entry.quantity ?? 0) - quantity),
                  updatedAt: new Date().toISOString(),
                }
              : entry
          ))
          .filter((entry) => Number(entry.quantity ?? 0) > 0));
      }

      if (result?.movement?.id) {
        setInventoryMovements((current) => {
          const withoutDuplicate = current.filter((movement) => String(movement?.id ?? '') !== String(result.movement.id));
          return [result.movement, ...withoutDuplicate].slice(0, 300);
        });
        setInventoryMovementStats((current) => {
          if (!current) return current;
          const next = { ...current, total: Number(current.total ?? 0) + 1 };
          if (result.movement.type === 'entrada' || result.movement.type === 'reinsercion') {
            next.entrada = Number(current.entrada ?? 0) + 1;
          } else if (result.movement.type === 'salida' || result.movement.type === 'reserva') {
            next.salida = Number(current.salida ?? 0) + 1;
          } else {
            next.ajuste = Number(current.ajuste ?? 0) + 1;
          }
          return next;
        });
      }

      return result;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo procesar la unidad en lavado o reparacion.');
      throw requestError;
    }
  };

  const handleOpenCashSession = async (payload) => {
    setError('');
    try {
      const created = await api.cash.openSession(payload);
      const [summary, sessions, context] = await Promise.all([
        api.cash.getSummary(),
        api.cash.listSessions(),
        api.cash.getAccountingContext(),
      ]);
      setCashSummary(summary);
      setCashSessions(sessions);
      setCashMovements(Array.isArray(context?.movements) ? context.movements : []);
      setCashDebts(Array.isArray(context?.debts) ? context.debts : []);
      setCashPaymentChannels(Array.isArray(context?.paymentChannels) ? context.paymentChannels : []);
      setCashReturnIssues(Array.isArray(context?.returnIssues) ? context.returnIssues : []);
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo abrir la caja.');
      throw requestError;
    }
  };

  const handleCloseCashSession = async (payload) => {
    setError('');
    try {
      const closed = await api.cash.closeSession(payload);
      const [summary, sessions, context] = await Promise.all([
        api.cash.getSummary(),
        api.cash.listSessions(),
        api.cash.getAccountingContext(),
      ]);
      setCashSummary(summary);
      setCashSessions(sessions);
      setCashMovements(Array.isArray(context?.movements) ? context.movements : []);
      setCashDebts(Array.isArray(context?.debts) ? context.debts : []);
      setCashPaymentChannels(Array.isArray(context?.paymentChannels) ? context.paymentChannels : []);
      setCashReturnIssues(Array.isArray(context?.returnIssues) ? context.returnIssues : []);
      return closed;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo cerrar la caja.');
      throw requestError;
    }
  };

  const handleUpdateTreasuryAccounts = async (payload) => {
    setError('');
    try {
      const updated = await api.cash.updateTreasuryAccounts(payload);
      const [summary, sessions] = await Promise.all([
        api.cash.getSummary(),
        api.cash.listSessions(),
      ]);
      setCashSummary(summary);
      setCashSessions(sessions);
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la distribucion de caja grande.');
      throw requestError;
    }
  };

  const handleCreateCashMovement = async (payload) => {
    setError('');
    try {
      const created = await api.cash.createManualMovement({
        ...payload,
        clientOperationId: payload?.clientOperationId
          || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `cash-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      });
      const createdRows = [
        ...(Array.isArray(created?.movements) ? created.movements : []),
        created?.movement,
      ].filter((movement) => movement?.id);
      if (createdRows.length) {
        setCashMovements((current) => {
          const byId = new Map(current.map((movement) => [String(movement.id), movement]));
          createdRows.forEach((movement) => byId.set(String(movement.id), movement));
          return [...byId.values()];
        });
      }
      if (created?.summary) setCashSummary((current) => ({ ...(current ?? {}), ...created.summary }));
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo registrar el movimiento de caja.');
      throw requestError;
    }
  };

  const handleUpdatePettyExpense = async (payload) => {
    setError('');
    try {
      const result = await api.cash.updatePettyExpense({
        ...payload,
        userRole: getUserDisplayRole(currentUser),
        updatedBy: getCurrentUserTrace().createdByName,
      });
      if (result?.movement?.id) {
        setCashMovements((current) => current.map((movement) => (
          String(movement?.id) === String(result.movement.id) ? result.movement : movement
        )));
      }
      if (result?.summary) setCashSummary((current) => ({ ...(current ?? {}), ...result.summary }));
      return result;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo editar el gasto de Caja Chica.');
      throw requestError;
    }
  };

  const handleDeletePettyExpense = async (payload) => {
    setError('');
    try {
      const result = await api.cash.deletePettyExpense({
        ...payload,
        userRole: getUserDisplayRole(currentUser),
        deletedBy: getCurrentUserTrace().createdByName,
      });
      const deletedId = result?.movement?.id ?? payload?.movementId;
      if (deletedId) {
        setCashMovements((current) => current.filter((movement) => String(movement?.id) !== String(deletedId)));
      }
      if (result?.summary) setCashSummary((current) => ({ ...(current ?? {}), ...result.summary }));
      return result;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar el gasto de Caja Chica.');
      throw requestError;
    }
  };

  const handleCreateCashDebt = async (payload) => {
    setError('');
    try {
      const created = await api.cash.createDebt({
        ...payload,
        createdBy: payload?.createdBy || getCurrentUserTrace().createdByName,
      });
      setCashDebts((current) => (
        current.some((debt) => debt.id === created.id)
          ? current.map((debt) => (debt.id === created.id ? created : debt))
          : [created, ...current]
      ));
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo registrar la deuda.');
      throw requestError;
    }
  };

  const handlePayCashDebt = async (payload) => {
    setError('');
    try {
      const result = await api.cash.payDebt({
        ...payload,
        paidBy: payload?.paidBy || getCurrentUserTrace().createdByName,
        createdBy: payload?.createdBy || getCurrentUserTrace().createdByName,
      });
      if (result?.debt?.id) {
        setCashDebts((current) => current.map((debt) => (
          debt.id === result.debt.id ? result.debt : debt
        )));
      }
      if (result?.movement?.id) {
        setCashMovements((current) => (
          current.some((movement) => movement.id === result.movement.id)
            ? current.map((movement) => (movement.id === result.movement.id ? result.movement : movement))
            : [result.movement, ...current]
        ));
      }
      setCashSummary(await api.cash.getSummary());
      return result;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo pagar la deuda.');
      throw requestError;
    }
  };

  const handleDeleteCashDebt = async (payload) => {
    setError('');
    try {
      const result = await api.cash.deleteDebt({
        ...payload,
        deletedBy: payload?.deletedBy || getCurrentUserTrace().createdByName,
      });
      const deletedId = result?.debt?.id ?? payload?.debtId ?? payload?.id;
      if (deletedId) {
        setCashDebts((current) => current.filter((debt) => debt.id !== deletedId));
      }
      return result;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar la deuda.');
      throw requestError;
    }
  };

  const handleVoidAndReplaceCashMovementReceipt = async (payload) => {
    setError('');
    try {
      const result = await api.cash.voidAndReplaceMovementReceipt(payload);
      const [summary, context] = await Promise.all([
        api.cash.getSummary(),
        api.cash.getAccountingContext(),
      ]);
      setCashSummary(summary);
      setCashMovements(Array.isArray(context?.movements) ? context.movements : []);
      setCashDebts(Array.isArray(context?.debts) ? context.debts : []);
      setCashPaymentChannels(Array.isArray(context?.paymentChannels) ? context.paymentChannels : []);
      setCashReturnIssues(Array.isArray(context?.returnIssues) ? context.returnIssues : []);
      return result;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo anular y reemplazar el recibo.');
      throw requestError;
    }
  };

  const handleCollectReceivable = async (payload) => {
    setError('');
    try {
      const result = await api.cash.collectReceivable(payload);
      const createdMovements = [
        ...(Array.isArray(result?.movements) ? result.movements : []),
        result?.movement,
      ].filter((movement) => movement?.id);
      if (createdMovements.length > 0) {
        setCashMovements((current) => {
          const byId = new Map(current.map((movement) => [String(movement.id), movement]));
          createdMovements.forEach((movement) => byId.set(String(movement.id), movement));
          return [...byId.values()];
        });
      }
      if (result?.rental?.id) {
        setRentals((current) => current.map((rental) => (
          String(rental?.id) === String(result.rental.id) ? result.rental : rental
        )));
      }
      return result;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo confirmar el cobro.');
      throw requestError;
    }
  };

  const handleCreateCategory = async (payload) => {
    setError('');
    try {
      await api.categories.create(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear la categoria.');
      throw requestError;
    }
  };

  const handleCreateQuote = async (payload) => {
    setError('');
    try {
      const created = await api.quotes.create({ ...getCurrentUserTrace(), ...payload });
      await loadData();
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear la cotizacion.');
      throw requestError;
    }
  };

  const handleUpdateQuote = async (payload) => {
    setError('');
    try {
      const updated = await api.quotes.update(payload);
      await loadData();
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la cotizacion.');
      throw requestError;
    }
  };

  const handleRemoveQuote = async (payload) => {
    setError('');
    try {
      const removed = await api.quotes.remove(payload);
      await loadData();
      return removed;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar la cotizacion.');
      throw requestError;
    }
  };

  const handleUpdateOrderOperational = async (payload) => {
    setError('');
    try {
      const updated = await api.rentals.updateOperational({
        ...payload,
        ...getCurrentUserTrace(),
      });
      setRentals((current) => current.map((rental) => (
        rental.id === updated.id
          ? {
              ...rental,
              ...updated,
              operational: { ...(rental.operational ?? {}), ...(updated.operational ?? {}) },
            }
          : rental
      )));
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la orden operativa.');
      throw requestError;
    }
  };

  const handleRemoveOrder = async (payload) => {
    setError('');
    try {
      const removed = await api.rentals.remove(payload);
      await loadData();
      return removed;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar la orden de servicio.');
      throw requestError;
    }
  };

  const handleCancelOrderContract = async (payload) => {
    setError('');
    try {
      const cancelled = await api.rentals.cancel({
        ...payload,
        ...getCurrentUserTrace(),
      });
      setRentals((current) => current.map((rental) => (
        rental.id === cancelled.id ? { ...rental, ...cancelled } : rental
      )));
      setContracts((current) => current.map((contract) => (
        (payload.contractId && contract.id === payload.contractId)
          || (cancelled.contractCode && contract.contractCode === cancelled.contractCode)
          || (cancelled.orderCode && contract.orderCode === cancelled.orderCode)
          ? {
            ...contract,
            status: 'anulado',
            cancelledAt: cancelled.cancelledAt,
            cancellationPenaltyPercent: cancelled.cancellationPenaltyPercent,
            cancellationPenaltyBs: cancelled.cancellationPenaltyBs,
            cancellationReason: cancelled.cancellationReason,
            cancellationCutoffDate: cancelled.cancellationCutoffDate,
          }
          : contract
      )));
      void loadData({ silent: true });
      return cancelled;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo anular el contrato.');
      throw requestError;
    }
  };

  const handleCreateContract = async (payload) => {
    setError('');
    try {
      const created = await api.contracts.create({ ...getCurrentUserTrace(), ...payload });
      setContracts((current) => (
        current.some((entry) => entry.id === created.id)
          ? current.map((entry) => (entry.id === created.id ? created : entry))
          : [created, ...current]
      ));
      setHiddenContracts((current) => current.filter((entry) => entry.id !== created.id));
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el contrato.');
      throw requestError;
    }
  };

  const handleUpdateContract = async (payload) => {
    setError('');
    try {
      const trace = getCurrentUserTrace();
      const updated = await api.contracts.update({
        ...payload,
        updatedById: trace.userId,
        updatedByName: trace.userName,
        updatedByRole: trace.userRole,
      });
      setContracts((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setHiddenContracts((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el contrato.');
      throw requestError;
    }
  };

  const handleSetContractFinalized = async (payload) => {
    setError('');
    try {
      const trace = getCurrentUserTrace();
      const updated = await api.contracts.setFinalized({
        ...payload,
        updatedById: trace.userId,
        updatedByName: trace.userName,
        updatedByRole: trace.userRole,
      });
      if (!updated?.id) {
        throw new Error('El servidor no devolvio el contrato actualizado.');
      }
      const mergeUpdated = (contract) => String(contract?.id) === String(updated.id)
        ? { ...contract, ...updated }
        : contract;
      setContracts((current) => current.map(mergeUpdated));
      setHiddenContracts((current) => current.map(mergeUpdated));
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el finalizado del contrato.');
      throw requestError;
    }
  };

  const handleUpdateContractEconomicLedger = async (payload) => {
    setError('');
    try {
      const trace = getCurrentUserTrace();
      const updated = await api.contracts.updateEconomicLedger({
        ...payload,
        updatedById: trace.userId,
        updatedByName: trace.userName,
        updatedByRole: trace.userRole,
      });

      if (!updated?.id) {
        throw new Error('El servidor no devolvio el contrato actualizado.');
      }

      setContracts((current) => current.map((contract) => (
        String(contract?.id) === String(updated.id)
          ? updated
          : contract
      )));
      setHiddenContracts((current) => current.map((contract) => (
        String(contract?.id) === String(updated.id)
          ? updated
          : contract
      )));
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo guardar el seguimiento economico del contrato.');
      throw requestError;
    }
  };

  const handleRemoveContract = async (payload) => {
    setError('');
    try {
      const trace = getCurrentUserTrace();
      const removed = await api.contracts.remove({
        ...payload,
        updatedById: trace.userId,
        updatedByName: trace.userName,
        updatedByRole: trace.userRole,
      });

      // La mutación ya actualizó el estado local del bridge. Refrescamos solo
      // las colecciones operativas indispensables y cerramos el modal sin
      // volver a cargar toda la aplicación.
      const [contractsData, hiddenContractsData, rentalsData, inventoryData] = await Promise.all([
        api.contracts.list(),
        api.contracts.listHidden(),
        api.rentals.list(),
        api.inventory.list(),
      ]);

      setContracts(contractsData);
      setHiddenContracts(hiddenContractsData);
      setRentals(rentalsData);
      setItems(inventoryData);

      // Datos secundarios en segundo plano: no deben bloquear la eliminación.
      Promise.all([
        api.transport.listDeliveries(),
        api.transport.listRoutes(),
        api.dashboard.get(),
        api.settings.get(),
      ]).then(([deliveriesData, transportRoutesData, dashboardData, settingsData]) => {
        setDeliveries(deliveriesData);
        setTransportRoutes(transportRoutesData);
        setDashboard(dashboardData);
        setSettingsBundle(settingsData);
      }).catch(() => {});

      if (deferredGroupsLoadedRef.current.has('inventory-movements')) {
        api.inventory.listMovements()
          .then(setInventoryMovements)
          .catch(() => {});
      }
      if (deferredGroupsLoadedRef.current.has('inventory-recoveries')) {
        api.inventory.listRecoveries()
          .then(setStockRecoveries)
          .catch(() => {});
      }
      if (deferredGroupsLoadedRef.current.has('accounting-operations')) {
        Promise.all([
          api.cash.listMovements(),
          api.cash.listDebts(),
        ]).then(([movementsData, debtsData]) => {
          setCashMovements(movementsData);
          setCashDebts(debtsData);
        }).catch(() => {});
      }

      return removed;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar el contrato.');
      throw requestError;
    }
  };

  const handleRestoreContract = async (payload) => {
    setError('');
    try {
      const trace = getCurrentUserTrace();
      const restored = await api.contracts.restore({
        ...payload,
        updatedById: trace.userId,
        updatedByName: trace.userName,
        updatedByRole: trace.userRole,
      });

      await loadData();
      return restored;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo restaurar el contrato.');
      throw requestError;
    }
  };

  const handleRevertContractToQuote = async (payload) => {
    setError('');
    try {
      const trace = getCurrentUserTrace();
      const reverted = await api.contracts.revertToQuote({
        ...payload,
        updatedById: trace.userId,
        updatedByName: trace.userName,
        updatedByRole: trace.userRole,
      });
      await loadData();
      return reverted;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo volver el contrato a cotizacion.');
      throw requestError;
    }
  };

  const handleCreateSupplier = async (payload) => {
    setError('');
    try {
      const created = await api.suppliers.create(payload);
      setSupplierBundle((current) => ({
        suppliers: [created, ...(current.suppliers ?? [])]
          .filter(Boolean)
          .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es')),
        quotes: current.quotes ?? [],
        loans: current.loans ?? [],
      }));
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el proveedor.');
      throw requestError;
    }
  };

  const handleUpdateSupplier = async (payload) => {
    setError('');
    try {
      const updated = await api.suppliers.update(payload);
      await loadData();
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el proveedor.');
      throw requestError;
    }
  };

  const handleCreateSupplierQuote = async (payload) => {
    setError('');
    try {
      const created = await api.suppliers.createQuote(payload);
      setSupplierBundle((current) => ({
        suppliers: current.suppliers ?? [],
        quotes: [created, ...(current.quotes ?? [])]
          .filter(Boolean)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        loans: current.loans ?? [],
      }));
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear la cotizacion del proveedor.');
      throw requestError;
    }
  };

  const handleCreateSupplierLoan = async (payload) => {
    setError('');
    try {
      const created = await api.suppliers.createLoan(payload);
      await loadData();
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo registrar el prestamo del proveedor.');
      throw requestError;
    }
  };

  const handleUpdateSupplierLoanStatus = async (payload) => {
    setError('');
    try {
      const updated = await api.suppliers.updateLoanStatus(payload);
      await loadData();
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el prestamo.');
      throw requestError;
    }
  };

  const handleCreateContractFromQuote = async ({ quoteId }) => {
    setError('');
    try {
      const allQuotes = await api.quotes.list();
      const quote = quotes.find((entry) => entry.id === quoteId) ?? allQuotes.find((entry) => entry.id === quoteId);
      if (!quote) {
        throw new Error('No se encontro la cotizacion seleccionada.');
      }

      const allContracts = await api.contracts.list();
      const existingContract = contracts.find((entry) => entry.quoteId === quote.id) ?? allContracts.find((entry) => entry.quoteId === quote.id);
      if (existingContract) {
        return existingContract;
      }

      const createdContract = await api.contracts.create({
        ...getCurrentUserTrace(),
        quoteId: quote.id,
        clientId: quote.clientId ?? null,
        customerName: quote.customerName,
        customerPhone: quote.customerPhone,
        customerReferencePhone: quote.customerReferencePhone ?? '',
        companyName: quote.companyName || quote.customerName,
        eventType: quote.eventType,
        eventDate: quote.eventDate,
        eventTime: quote.eventTime,
        address: quote.address,
        city: quote.city,
        deliveryDate: quote.deliveryDate,
        logisticsMode: quote.logisticsMode ?? 'envio',
        deliveryChargeMode: quote.deliveryChargeMode ?? (Number(quote?.totals?.deliveryFeeBs ?? 0) > 0 ? 'extra' : 'included'),
        deliveryFeeBs: Number(quote?.totals?.deliveryFeeBs ?? quote?.deliveryFeeBs ?? 0),
        deliveryFeeReason: quote.deliveryFeeReason ?? (Number(quote?.totals?.deliveryFeeBs ?? 0) > 0 ? 'quantity' : 'covered'),
        deliveryWindowStart: quote.deliveryWindowStart,
        deliveryWindowEnd: quote.deliveryWindowEnd,
        deliveryTimeMode: quote.deliveryTimeMode === 'coordinate' ? 'coordinate' : 'fixed',
        pickupDate: quote.pickupDate,
        pickupWindowStart: quote.pickupWindowStart,
        pickupWindowEnd: quote.pickupWindowEnd,
        pickupTimeMode: quote.pickupTimeMode === 'coordinate' ? 'coordinate' : 'fixed',
        driverId: quote.driverId || null,
        vehicleId: quote.vehicleId || null,
        validUntil: quote.validUntil || null,
        observations: quote.observations,
        billingMode: quote.billingMode ?? 'sin_factura',
        pricingPlan: quote.pricingPlan ?? null,
        supplierFulfillmentPlan: quote.supplierFulfillmentPlan ?? [],
        discountBs: Number(quote?.totals?.discountBs ?? 0),
        guaranteeBs: Number(quote?.totals?.guaranteeBs ?? 0),
        guaranteeStatus: quote?.guarantee?.status ?? quote?.payment?.guaranteeStatus ?? 'no_validado',
        guaranteePaymentMethod: quote?.guarantee?.paymentMethod ?? quote?.payment?.guaranteePaymentMethod ?? 'efectivo',
        paidAtApprovalBs: Number(quote?.payment?.paidAtApprovalBs ?? 0),
        initialPaymentMethod: quote?.payment?.initialPaymentMethod ?? 'efectivo',
        status: 'pendiente',
        responsibles: quote.responsibles ?? [],
        createdBy: quote.createdBy ?? quote.createdByName ?? undefined,
        createdById: quote.createdById ?? undefined,
        createdByName: quote.createdByName ?? undefined,
        createdByRole: quote.createdByRole ?? undefined,
        items: (quote.items ?? []).map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          unitPriceBs: line.unitPriceBs,
          lineTotalBs: line.lineTotalBs,
          discountPercent: line.discountPercent,
          serviceDayId: line.serviceDayId ?? null,
          serviceDate: line.serviceDate ?? null,
          serviceDayLabel: line.serviceDayLabel ?? '',
        })),
        services: quote.services ?? [],
      });

      await api.quotes.update({
        id: quote.id,
        status: quote.status === 'borrador' ? 'enviada' : quote.status,
        rejectedAt: null,
      });

      await loadData();
      return createdContract;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo generar el contrato desde la cotizacion.');
      throw requestError;
    }
  };

  const buildRentalSnapshotFromContractForFlow = (contract) => ({
    id: contract?.rentalId ?? `contract-${contract?.id ?? 'sin-id'}`,
    orderCode: contract?.orderCode ?? contract?.contractCode ?? 'SIN-ORDEN',
    customerName: contract?.customerName ?? '',
    customerPhone: contract?.customerPhone ?? '',
    rentalDate: contract?.deliveryDate || contract?.eventDate || contract?.createdAt,
    dueDate: contract?.pickupDate || contract?.deliveryDate || contract?.eventDate || contract?.createdAt,
    createdAt: contract?.createdAt,
    items: contract?.items ?? [],
  });

  const resolveRentalForDocumentFlow = async ({ rentalId, orderCode, contractId, contractCode }) => {
    const normalizedRentalId = String(rentalId ?? '').trim();
    const normalizedOrderCode = String(orderCode ?? '').trim();
    const normalizedContractId = String(contractId ?? '').trim();
    const normalizedContractCode = String(contractCode ?? '').trim();
    const localRental = rentals.find(
      (row) =>
        (normalizedRentalId && row.id === normalizedRentalId)
        || (normalizedOrderCode && row.orderCode === normalizedOrderCode),
    );
    if (localRental && !localRental._summaryOnly) return localRental;

    const localContract = contracts.find(
      (row) =>
        (normalizedContractId && row.id === normalizedContractId)
        || (normalizedContractCode && row.contractCode === normalizedContractCode)
        || (normalizedOrderCode && row.orderCode === normalizedOrderCode),
    );
    if (localContract && !localContract._summaryOnly) {
      return buildRentalSnapshotFromContractForFlow(localContract);
    }

    await api.sync.ensureCollectionsLoaded(
      ['contracts', 'rentals'],
      'document-flow-details',
    );
    const allRentals = await api.rentals.list();
    const rentalFromApi = allRentals.find(
      (row) =>
        (normalizedRentalId && row.id === normalizedRentalId)
        || (normalizedOrderCode && row.orderCode === normalizedOrderCode),
    );
    if (rentalFromApi) return rentalFromApi;

    const allContracts = await api.contracts.list();
    const contractFromApi = allContracts.find(
      (row) =>
        (normalizedContractId && row.id === normalizedContractId)
        || (normalizedContractCode && row.contractCode === normalizedContractCode)
        || (normalizedOrderCode && row.orderCode === normalizedOrderCode),
    );
    return contractFromApi ? buildRentalSnapshotFromContractForFlow(contractFromApi) : null;
  };

  const resolveDeliveriesForDocumentFlow = async (rental) => {
    let linkedDeliveries = deliveries
      .filter((entry) => entry.rentalId === rental.id || entry.orderCode === rental.orderCode)
      .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));

    if (!linkedDeliveries.length) {
      const allDeliveries = await api.transport.listDeliveries();
      linkedDeliveries = allDeliveries
        .filter((entry) => entry.rentalId === rental.id || entry.orderCode === rental.orderCode)
        .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
    }

    return linkedDeliveries;
  };

  const handleCreateContractFromOrder = async ({ rentalId, orderCode }) => {
    setError('');
    try {
      const rental = await resolveRentalForDocumentFlow({ rentalId, orderCode });
      if (!rental) {
        throw new Error('No se encontro la orden seleccionada para crear contrato.');
      }

      const allContracts = await api.contracts.list();
      const existingContract = allContracts.find(
        (entry) =>
          (entry.rentalId && entry.rentalId === rental.id)
          || (entry.orderCode && entry.orderCode === rental.orderCode),
      );
      if (existingContract) {
        return existingContract;
      }

      const linkedDeliveries = await resolveDeliveriesForDocumentFlow(rental);
      const deliveryOut = linkedDeliveries[0] ?? null;
      const deliveryBack = linkedDeliveries[1] ?? null;

      const baseEventDate = rental.rentalDate ?? rental.createdAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const eventTime = rental.dueTime ?? '20:00';

      const createdContract = await api.contracts.create({
        quoteId: null,
        clientId: rental.clientId ?? null,
        customerName: rental.customerName,
        customerPhone: rental.customerPhone,
        companyName: rental.customerName,
        eventType: rental.eventType ?? 'general',
        eventDate: baseEventDate,
        eventTime,
        address: deliveryOut?.address ?? rental.eventAddress ?? '',
        city: deliveryOut?.city ?? '',
        deliveryDate: deliveryOut?.scheduledDate ?? baseEventDate,
        logisticsMode: rental.logisticsMode ?? 'envio',
        deliveryChargeMode: rental.deliveryChargeMode ?? (Number(rental?.totals?.deliveryFeeBs ?? 0) > 0 ? 'extra' : 'included'),
        deliveryFeeBs: Number(rental?.totals?.deliveryFeeBs ?? rental?.deliveryFeeBs ?? 0),
        deliveryFeeReason: rental.deliveryFeeReason ?? (Number(rental?.totals?.deliveryFeeBs ?? 0) > 0 ? 'quantity' : 'covered'),
        deliveryWindowStart: deliveryOut?.windowStart ?? '08:00',
        deliveryWindowEnd: deliveryOut?.windowEnd ?? '10:00',
        pickupDate: deliveryBack?.scheduledDate ?? rental.dueDate ?? baseEventDate,
        pickupWindowStart: deliveryBack?.windowStart ?? '20:00',
        pickupWindowEnd: deliveryBack?.windowEnd ?? '22:00',
        driverId: deliveryOut?.driverId ?? null,
        vehicleId: deliveryOut?.vehicleId ?? null,
        validUntil: rental.dueDate ?? null,
        observations: rental.notes ?? '',
        billingMode: rental.billingMode ?? 'sin_factura',
        supplierFulfillmentPlan: rental.supplierFulfillmentPlan ?? [],
        discountBs: Number(rental?.totals?.discountBs ?? 0),
        guaranteeBs: Number(rental?.depositBs ?? 0),
        paidAtApprovalBs: Number(rental?.payment?.paidAtRentalBs ?? 0),
        status: 'aprobado',
        items: (rental.items ?? []).map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          unitPriceBs: line.rentalPriceBs,
        })),
        services: rental.services ?? [],
        ...getCurrentUserTrace(),
      });

      const updatedContract = await api.contracts.update({
        id: createdContract.id,
        status: 'aprobado',
        approvedAt: rental.createdAt ?? new Date().toISOString(),
        rejectedAt: null,
        rentalId: rental.id,
        orderCode: rental.orderCode,
      });

      await loadData();
      return updatedContract;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el contrato desde la orden.');
      throw requestError;
    }
  };

  const handleGenerateOrderDocuments = async ({ rentalId, orderCode, contractId, contractCode }) => {
    const rental = await resolveRentalForDocumentFlow({ rentalId, orderCode, contractId, contractCode });
    if (!rental) {
      throw new Error('No se pudo identificar la orden de servicio para generar documentos.');
    }

    const baseDate = rental.rentalDate ?? rental.createdAt?.slice(0, 10) ?? null;
    const endDate = rental.dueDate ?? baseDate;

    await Promise.all([
      api.reports.generate({
        name: `Contrato ${rental.orderCode}`,
        category: 'Documentos',
        periodFrom: baseDate,
        periodTo: endDate,
        format: 'PDF',
        generatedBy: 'Sistema Copetin',
        sourceType: 'contrato',
        sourceId: rental.id,
      }),
      api.reports.generate({
        name: `Orden Inventario ${rental.orderCode}`,
        category: 'Inventario',
        periodFrom: baseDate,
        periodTo: endDate,
        format: 'PDF',
        generatedBy: 'Sistema Copetin',
        sourceType: 'orden_inventario',
        sourceId: rental.id,
      }),
    ]);
  };

  const handlePrintContractDocument = async ({
    rentalId,
    orderCode,
    contractId,
    contractCode,
    fullContract = null,
    fullRental = null,
  }) => {
    setError('');
    try {
      return await api.printer.printContract({
        rentalId,
        orderCode,
        contractId,
        contractCode,
        fullContract,
        fullRental,
      });
    } catch (requestError) {
      if (isPrintCanceledError(requestError)) return;
      setError(requestError.message || 'No se pudo abrir el contrato.');
      throw requestError;
    }
  };

  const handlePrintInventoryOrderDocument = async ({ rentalId, orderCode, contractId, contractCode }) => {
    setError('');
    try {
      return await api.printer.printInventoryOrder({ rentalId, orderCode, contractId, contractCode });
    } catch (requestError) {
      if (isPrintCanceledError(requestError)) return;
      setError(requestError.message || 'No se pudo abrir la orden de inventario.');
      throw requestError;
    }
  };

  const handlePrintInventoryWeekDocument = async ({
    weekStart,
    format,
    rentalId,
    orderCode,
    contractCode,
    fullRental = null,
  }) => {
    setError('');
    try {
      return await api.printer.printInventoryWeek({
        weekStart,
        format,
        rentalId,
        orderCode,
        contractCode,
        fullRental,
      });
    } catch (requestError) {
      if (isPrintCanceledError(requestError)) return;
      setError(requestError.message || 'No se pudo abrir la hoja semanal de inventario.');
      throw requestError;
    }
  };

  const handlePrintRouteSheetDocument = async ({ rentalId, orderCode, contractId, contractCode }) => {
    setError('');
    try {
      return await api.printer.printRouteSheet({ rentalId, orderCode, contractId, contractCode });
    } catch (requestError) {
      if (isPrintCanceledError(requestError)) return;
      setError(requestError.message || 'No se pudo abrir la hoja de ruta.');
      throw requestError;
    }
  };

  const handleCreateAndApproveContract = async (contractPayload) => {
    setError('');
    try {
      const payload = await api.contracts.createAndApprove({
        contract: {
          ...getCurrentUserTrace(),
          ...contractPayload,
        },
        trace: getCurrentUserTrace(),
      });
      const createdContract = payload?.contract;
      const createdRental = payload?.rental;
      if (!createdContract || !createdRental) {
        throw new Error('El servidor no devolvio el contrato y la orden completos.');
      }

      setContracts((current) => {
        const index = current.findIndex((entry) => entry.id === createdContract.id);
        if (index < 0) return [createdContract, ...current];
        return [...current.slice(0, index), createdContract, ...current.slice(index + 1)];
      });
      setRentals((current) => {
        const index = current.findIndex((entry) => entry.id === createdRental.id);
        if (index < 0) return [createdRental, ...current];
        return [...current.slice(0, index), createdRental, ...current.slice(index + 1)];
      });
      if (Array.isArray(payload?.changes?.deliveries)) {
        setDeliveries((current) => {
          const next = [...current];
          payload.changes.deliveries.forEach((row) => {
            const index = next.findIndex((entry) => entry.id === row.id);
            if (index < 0) next.unshift(row);
            else next[index] = row;
          });
          return next;
        });
      }
      if (Array.isArray(payload?.changes?.cashMovements)) {
        setCashMovements((current) => {
          const next = [...current];
          payload.changes.cashMovements.forEach((row) => {
            const index = next.findIndex((entry) => entry.id === row.id);
            if (index < 0) next.unshift(row);
            else next[index] = row;
          });
          return next;
        });
      }
      if (Array.isArray(payload?.changes?.generatedReports)) {
        setGeneratedReports((current) => {
          const next = [...current];
          payload.changes.generatedReports.forEach((row) => {
            const index = next.findIndex((entry) => entry.id === row.id);
            if (index < 0) next.unshift(row);
            else next[index] = row;
          });
          return next;
        });
      }
      if (Array.isArray(payload?.changes?.supplierLoans)) {
        setSupplierBundle((current) => {
          const nextLoans = [...(current.loans ?? [])];
          payload.changes.supplierLoans.forEach((row) => {
            const index = nextLoans.findIndex((entry) => entry.id === row.id);
            if (index < 0) nextLoans.unshift(row);
            else nextLoans[index] = row;
          });
          return { ...current, loans: nextLoans };
        });
      }

      return {
        contract: createdContract,
        rental: createdRental,
        durationMs: payload?.durationMs ?? null,
      };
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear y aprobar el contrato.');
      throw requestError;
    }
  };

  const handleApproveContract = async ({ contractId, contract: providedContract = null }) => {
    setError('');
    try {
      const localContract = contracts.find((entry) => entry.id === contractId);
      const candidateContract = providedContract ?? localContract;
      if (!candidateContract || candidateContract._summaryOnly) {
        await api.sync.ensureCollectionsLoaded(['contracts', 'rentals'], 'approve-contract-details');
      }
      const allContracts = candidateContract && !candidateContract._summaryOnly
        ? []
        : await api.contracts.list();
      const contract =
        (candidateContract && !candidateContract._summaryOnly ? candidateContract : null)
        ?? allContracts.find((entry) => entry.id === contractId);

      if (!contract) {
        throw new Error('No se encontro el contrato seleccionado.');
      }
      if (contract.status === 'aprobado') {
        throw new Error('Este contrato ya fue aprobado.');
      }

      const approvalItems = (contract.items ?? []).map((line) => ({
        itemId: line.itemId,
        lineKey: line.lineKey ?? null,
        quantity: line.quantity,
        unitPriceBs: line.unitPriceBs,
        grossLineTotalBs: line.grossLineTotalBs,
        discountPercent: line.discountPercent ?? 0,
        discountBs: line.discountBs ?? 0,
        lineTotalBs: line.lineTotalBs,
        controlsStock: line.controlsStock,
        verificationStatus: line.verificationStatus,
        supplierBackedQty: line.supplierBackedQty ?? 0,
        internalReservedQty: line.internalReservedQty ?? null,
        lineType: line.lineType ?? '',
        observation: line.observation ?? '',
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
        serviceDayId: line.serviceDayId ?? line.scheduleDayId ?? null,
        serviceDate: line.serviceDate ?? line.date ?? null,
        serviceDayLabel: line.serviceDayLabel ?? line.dayLabel ?? '',
      }));
      const approvalServices = (contract.services ?? []).map((service) => ({
        ...service,
        serviceDayId: service.serviceDayId ?? service.scheduleDayId ?? null,
        serviceDate: service.serviceDate ?? service.date ?? null,
        serviceDayLabel: service.serviceDayLabel ?? service.dayLabel ?? '',
      }));

      const paidAtApprovalBs = Number(contract?.payment?.paidAtApprovalBs ?? 0);
      const totalBs = Number(contract?.totals?.totalBs ?? 0);
      const rawGuaranteeStatus = String(contract?.guarantee?.status ?? contract?.payment?.guaranteeStatus ?? '').trim();
      const isGuaranteeValidated = rawGuaranteeStatus === 'validado' || (!rawGuaranteeStatus && Number(contract?.totals?.guaranteeBs ?? 0) > 0);
      const guaranteeForCashBs = isGuaranteeValidated ? Number(contract?.totals?.guaranteeBs ?? 0) : 0;
      const localClient = clients.find((entry) => entry.id === contract.clientId)
        ?? clients.find((entry) => String(entry.name ?? '').trim().toLowerCase() === String(contract.customerName ?? '').trim().toLowerCase());
      const allClients = localClient ? [] : await api.clients.list();
      const contractClient =
        localClient
        ?? allClients.find((entry) => entry.id === contract.clientId)
        ?? allClients.find((entry) => String(entry.name ?? '').trim().toLowerCase() === String(contract.customerName ?? '').trim().toLowerCase());
      const availablePrepaidBs = contractClient?.prepaidEnabled
        ? Math.max(0, Number(contractClient.prepaidBalanceBs ?? 0))
        : 0;
      const requestedPrepaidAppliedBs = Math.max(0, Number(contract?.payment?.prepaidAppliedBs ?? contract?.prepaidAppliedBs ?? 0));
      const prepaidAppliedBs = Math.min(
        requestedPrepaidAppliedBs,
        availablePrepaidBs,
        Math.max(0, totalBs - paidAtApprovalBs),
      );
      const coveredAtApprovalBs = Number((paidAtApprovalBs + prepaidAppliedBs).toFixed(2));
      const paymentMode =
        coveredAtApprovalBs >= totalBs && totalBs > 0
          ? 'cancelado'
          : coveredAtApprovalBs > 0
          ? 'a_cuenta'
          : 'sin_pago';
      const contractResponsible = Array.isArray(contract.responsibles)
        ? contract.responsibles.find((responsible) => String(responsible?.name ?? '').trim())
        : null;
      const approvalTrace = getCurrentUserTrace();
      const pickupCoordinatesPending = contract.pickupTimeMode === 'coordinate';

      let createdRental = null;
      let updatedContract = null;
      await api.sync.batchMutations(async () => {
        createdRental = await api.rentals.create({
          ...approvalTrace,
          createdBy: contractResponsible?.name ?? contract.createdBy ?? contract.createdByName ?? approvalTrace.createdBy,
          createdById: contractResponsible?.id ?? contract.createdById ?? approvalTrace.createdById,
          createdByName: contractResponsible?.name ?? contract.createdByName ?? approvalTrace.createdByName,
          createdByRole: contractResponsible?.role ?? contract.createdByRole ?? approvalTrace.createdByRole,
          clientId: contract.clientId ?? null,
          customerName: contract.customerName,
          customerPhone: contract.customerPhone,
          rentalDate: contract.deliveryDate || contract.eventDate,
          dueDate: pickupCoordinatesPending
            ? (contract.eventDate || contract.deliveryDate)
            : contract.pickupDate || contract.deliveryDate || contract.eventDate,
          dueTime: pickupCoordinatesPending ? '23:59' : contract.pickupWindowEnd || contract.eventTime || '23:59',
          deliveryWindowStart: contract.deliveryWindowStart || '00:00',
          deliveryWindowEnd: contract.deliveryWindowEnd || contract.eventTime || null,
          pickupWindowStart: pickupCoordinatesPending ? null : contract.pickupWindowStart || null,
          pickupWindowEnd: pickupCoordinatesPending ? null : contract.pickupWindowEnd || contract.eventTime || '23:59',
          pickupTimeMode: pickupCoordinatesPending ? 'coordinate' : 'fixed',
          depositBs: guaranteeForCashBs,
          guaranteeDeclaredBs: Number(contract?.totals?.guaranteeBs ?? 0),
          guaranteeStatus: isGuaranteeValidated ? 'validado' : 'no_validado',
          guaranteePaymentMethod: contract?.guarantee?.paymentMethod ?? contract?.payment?.guaranteePaymentMethod ?? 'efectivo',
          paidAtRentalBs: coveredAtApprovalBs,
          initialPaymentMethod: contract?.payment?.initialPaymentMethod ?? 'efectivo',
          paymentMode,
          prepaidClientId: prepaidAppliedBs > 0 ? contractClient.id : null,
          prepaidAppliedBs,
          notes: contract.observations,
          billingMode: contract.billingMode ?? 'sin_factura',
          logisticsMode: contract.logisticsMode ?? 'envio',
          deliveryChargeMode: contract.deliveryChargeMode ?? (Number(contract?.totals?.deliveryFeeBs ?? 0) > 0 ? 'extra' : 'included'),
          deliveryFeeBs: Number(contract?.totals?.deliveryFeeBs ?? contract?.deliveryFeeBs ?? 0),
          deliveryFeeReason: contract.deliveryFeeReason ?? (Number(contract?.totals?.deliveryFeeBs ?? 0) > 0 ? 'quantity' : 'covered'),
          pricingPlan: contract.pricingPlan ?? null,
          supplierFulfillmentPlan: contract.supplierFulfillmentPlan ?? [],
          quotedTotals: contract.totals ?? null,
          eventType: contract.eventType,
          eventAddress: contract.address,
          contractId: contract.id,
          contractCode: contract.contractCode,
          allowPastDueDate: true,
          items: approvalItems,
          services: approvalServices,
        });

        updatedContract = await api.contracts.update({
          id: contract.id,
          status: 'aprobado',
          approvedAt: contract.approvedAt ?? createdRental.createdAt ?? new Date().toISOString(),
          rejectedAt: null,
          rentalId: createdRental.id,
          orderCode: createdRental.orderCode,
          paidAtApprovalBs: coveredAtApprovalBs,
          prepaidAppliedBs,
          pricingPlan: contract.pricingPlan ?? null,
          items: approvalItems,
          services: approvalServices,
          supplierFulfillmentPlan: contract.supplierFulfillmentPlan ?? [],
        });
      }, {
        collections: APPROVAL_BATCH_COLLECTIONS,
        reason: 'approve-contract',
      });

      setContracts((current) => current.map((entry) => (entry.id === updatedContract.id ? updatedContract : entry)));
      setRentals((current) => (
        current.some((entry) => entry.id === createdRental.id) ? current : [createdRental, ...current]
      ));
      if (createdRental.reusedExisting) {
        return createdRental;
      }

      if (contract.quoteId) {
        api.quotes.update({
          id: contract.quoteId,
          status: 'aprobada',
          approvedAt: new Date().toISOString(),
          rejectedAt: null,
          rentalId: createdRental.id,
          orderCode: createdRental.orderCode,
        })
          .then((updatedQuote) => {
            setQuotes((current) => current.map((entry) => (entry.id === updatedQuote.id ? updatedQuote : entry)));
          })
          .catch((quoteError) => {
            setError(quoteError?.message || 'La orden fue aprobada, pero no se pudo actualizar la cotizacion vinculada.');
          });
      }

      const runApprovalFollowUps = async () => {
        let logisticsWarning = '';
        if ((contract.logisticsMode ?? 'envio') !== 'recojo') {
          try {
            await api.sync.batchMutations(async () => {
              const refreshedDeliveries = await api.transport.listDeliveries();
            const linkedDeliveries = refreshedDeliveries.filter((entry) => entry.rentalId === createdRental.id);
            const autoDelivery = linkedDeliveries[0] ?? null;
            if (autoDelivery) {
              await api.transport.updateDelivery({
                id: autoDelivery.id,
                scheduledDate: contract.deliveryDate || contract.eventDate,
                windowStart: contract.deliveryWindowStart || autoDelivery.windowStart,
                windowEnd: contract.deliveryWindowEnd || autoDelivery.windowEnd,
                address: contract.address || autoDelivery.address,
                city: contract.city || autoDelivery.city,
                driverId: contract.driverId || autoDelivery.driverId,
                vehicleId: contract.vehicleId || autoDelivery.vehicleId,
                notes: `Entrega de ${createdRental.orderCode}. ${contract.observations ?? ''}`.trim(),
              });
            }

            if (linkedDeliveries.length < 2) {
              await api.transport.createDelivery({
                rentalId: createdRental.id,
                orderCode: createdRental.orderCode,
                customerName: contract.customerName,
                companyName: contract.companyName || contract.customerName,
                address: contract.address || 'Direccion pendiente',
                city: contract.city || 'Ciudad',
                scheduledDate: contract.pickupDate || contract.deliveryDate || contract.eventDate,
                windowStart: contract.pickupWindowStart || '20:00',
                windowEnd: contract.pickupWindowEnd || '22:00',
                driverId: contract.driverId || null,
                vehicleId: contract.vehicleId || null,
                notes: `Recojo programado de ${createdRental.orderCode}`,
              });
            }
            }, {
              collections: ['deliveries', 'systemAuditLog'],
              reason: 'approve-contract-logistics',
            });
            const refreshedDeliveries = await api.transport.listDeliveries();
            setDeliveries(refreshedDeliveries);
          } catch (logisticsError) {
            logisticsWarning = logisticsError?.message || 'No se pudo completar la programacion de transporte.';
          }
        }

        const supplierPlan = Array.isArray(contract.supplierFulfillmentPlan)
          ? contract.supplierFulfillmentPlan
          : [];
        if (supplierPlan.length > 0) {
          const groupedBySupplier = new Map();
          supplierPlan.forEach((line) => {
            const supplierId = String(line?.supplierId ?? '').trim();
            const supplierName = String(line?.supplierName ?? '').trim();
            const itemName = String(line?.itemName ?? '').trim();
            const itemId = String(line?.itemId ?? '').trim();
            const neededQty = Math.max(0, Number(line?.neededQty ?? 0));
            const supplierUnitCostBs = Math.max(0, Number(line?.supplierUnitCostBs ?? 0));
            if (!supplierId || !supplierName || !itemName || neededQty <= 0) return;

            const key = supplierId;
            if (!groupedBySupplier.has(key)) {
              groupedBySupplier.set(key, {
                supplierId,
                supplierName,
                items: [],
              });
            }
            groupedBySupplier.get(key).items.push({
              itemId: itemId || null,
              itemName,
              category: '',
              quantity: Math.max(1, Math.trunc(neededQty)),
              unitPriceBs: supplierUnitCostBs,
            });
          });

          await Promise.all(
            Array.from(groupedBySupplier.values())
              .filter((entry) => entry.items.length > 0)
              .map((entry) =>
                api.suppliers.createLoan({
                  supplierId: entry.supplierId,
                  direction: 'from_supplier',
                  flowType: 'paid',
                  requestDate: contract.deliveryDate || contract.eventDate || new Date().toISOString().slice(0, 10),
                  returnDate: contract.pickupDate || null,
                  eventName: `Abastecimiento ${createdRental.orderCode}`,
                  notes: `Generado automaticamente desde contrato ${contract.contractCode}.`,
                  sourceContractId: contract.id,
                  sourceRentalId: createdRental.id,
                  sourceOrderCode: createdRental.orderCode,
                  autoCreated: true,
                  items: entry.items,
                })),
          );
        }

        let documentsWarning = '';
        try {
          await handleGenerateOrderDocuments({ rentalId: createdRental.id, orderCode: createdRental.orderCode });
        } catch (docsError) {
          documentsWarning = docsError?.message || 'No se pudieron generar los documentos automaticamente.';
        }


        if (documentsWarning || logisticsWarning) {
          const pendingTasks = [
            logisticsWarning ? 'programacion de transporte' : '',
            documentsWarning ? 'generacion de documentos' : '',
          ].filter(Boolean).join(' y ');
          setError(`${createdRental.orderCode} fue aprobada, pero queda pendiente revisar: ${pendingTasks}.`);
        }
      };

      window.setTimeout(() => {
        runApprovalFollowUps().catch((followUpError) => {
          setError(followUpError?.message || `${createdRental.orderCode} fue aprobada, pero no se completaron tareas secundarias.`);
        });
      }, 250);

      return createdRental;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo aprobar el contrato.');
      throw requestError;
    }
  };

  const handleApproveQuote = async ({ quoteId }) => {
    setError('');
    try {
      const contract = await handleCreateContractFromQuote({ quoteId });
      await api.quotes.update({
        id: quoteId,
        status: 'aprobada',
        approvedAt: new Date().toISOString(),
        rejectedAt: null,
      });
      await loadData();
      return contract;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo aprobar la cotizacion y crear el contrato.');
      throw requestError;
    }
  };

  const handleUpdateCategory = async (payload) => {
    setError('');
    try {
      await api.categories.update(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la categoria.');
      throw requestError;
    }
  };

  const handleRemoveCategory = async (payload) => {
    setError('');
    try {
      await api.categories.remove(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar la categoria.');
      throw requestError;
    }
  };

  const handlePrintRentalReceipt = async (rentalId) => {
    if (!rentalId) {
      setError('No se pudo identificar el recibo de alquiler.');
      return;
    }

    setError('');
    try {
      await api.printer.printRentalReceipt({ rentalId });
    } catch (requestError) {
      if (isPrintCanceledError(requestError)) return;
      setError(requestError.message || 'No se pudo imprimir el recibo de alquiler.');
    }
  };

  const handlePrintReturnReceipt = async (rentalId) => {
    if (!rentalId) {
      setError('No se pudo identificar el recibo de devolucion.');
      return;
    }

    setError('');
    try {
      await api.printer.printReturnReceipt({ rentalId });
    } catch (requestError) {
      if (isPrintCanceledError(requestError)) return;
      setError(requestError.message || 'No se pudo imprimir el recibo de devolucion.');
    }
  };

  const handlePrintCashMovementReceipt = async (payload) => {
    const requestPayload = payload && typeof payload === 'object' ? payload : { movementId: payload };
    const movementId = requestPayload.movementId;
    if (!movementId) {
      setError('No se pudo identificar el movimiento de caja.');
      return;
    }

    setError('');
    try {
      return await api.printer.printCashMovementReceipt(requestPayload);
    } catch (requestError) {
      if (isPrintCanceledError(requestError)) return;
      setError(requestError.message || 'No se pudo imprimir el recibo de caja.');
      throw requestError;
    }
  };

  const handleLoadAttendanceRecords = useCallback(async (filters = {}) => {
    try {
      const records = await api.attendance.listRecords(filters);
      setAttendanceRecords(Array.isArray(records) ? records : []);
      return records;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo cargar la asistencia.');
      throw requestError;
    }
  }, []);

  const handleCreateAttendanceRecord = async (payload) => {
    setError('');
    try {
      const trace = getCurrentUserTrace();
      const isResponsibleMark = String(payload?.markingMode ?? '') === 'responsable';
      const created = await api.attendance.createRecord({
        ...payload,
        clientOperationId: payload?.clientOperationId
          || (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `attendance-${Date.now()}-${Math.random().toString(16).slice(2)}`),
        userId: isResponsibleMark ? String(payload?.userId ?? '') : currentUser?.id ?? payload?.userId ?? '',
        userName: isResponsibleMark
          ? String(payload?.userName ?? '').trim() || 'Usuario'
          : currentUser?.fullName || currentUser?.username || payload?.userName || 'Usuario',
        role: isResponsibleMark
          ? String(payload?.role ?? '').trim() || 'Usuario'
          : currentUser ? getUserDisplayRole(currentUser) : payload?.role ?? 'Usuario',
        responsibleUserId: isResponsibleMark ? String(currentUser?.id ?? '') : '',
        responsibleName: isResponsibleMark
          ? currentUser?.fullName || currentUser?.username || 'Responsable'
          : '',
        createdBy: trace.createdByName,
      });
      if (created?.id) {
        setAttendanceRecords((current) => {
          const withoutDuplicate = current.filter((record) => String(record?.id) !== String(created.id));
          return [created, ...withoutDuplicate];
        });
      }
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo registrar la asistencia.');
      throw requestError;
    }
  };

  const handleVerifyResetAccess = async ({ code }) => {
    const cleanCode = String(code ?? '').trim();
    if (!cleanCode) {
      setError('Debes ingresar la contrasena de seguridad.');
      throw new Error('Debes ingresar la contrasena de seguridad.');
    }

    setError('');
    try {
      return await api.system.verifyResetAccess({ code: cleanCode });
    } catch (requestError) {
      setError(requestError.message || 'No se pudo validar el acceso al reset.');
      throw requestError;
    }
  };

  const handleAnalyzeSystemReset = async ({ code, modules }) => {
    const cleanCode = String(code ?? '').trim();
    if (!cleanCode) {
      setError('Debes ingresar la contrasena de seguridad.');
      throw new Error('Debes ingresar la contrasena de seguridad.');
    }
    if (!Array.isArray(modules) || modules.length === 0) {
      setError('Selecciona al menos un modulo para analizar.');
      throw new Error('Selecciona al menos un modulo para analizar.');
    }

    setError('');
    try {
      return await api.system.analyzeReset({ code: cleanCode, modules });
    } catch (requestError) {
      setError(requestError.message || 'No se pudo analizar el impacto del reset.');
      throw requestError;
    }
  };

  const handleExecuteSystemReset = async ({ code, modules, confirmation, observations }) => {
    const cleanCode = String(code ?? '').trim();
    if (!cleanCode) {
      setError('Debes ingresar la contrasena de seguridad.');
      throw new Error('Debes ingresar la contrasena de seguridad.');
    }

    setError('');
    try {
      const result = await api.system.executeReset({ code: cleanCode, modules, confirmation, observations });
      setActiveTab('inventario');
      setImagePreview(null);
      await loadData();
      return result;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo ejecutar el reset seleccionado.');
      throw requestError;
    }
  };

  const handleExportSystemDatabase = async ({ code, observations }) => {
    const cleanCode = String(code ?? '').trim();
    if (!cleanCode) {
      setError('Debes ingresar la contrasena de seguridad.');
      throw new Error('Debes ingresar la contrasena de seguridad.');
    }

    setError('');
    try {
      return await api.system.exportDatabase({ code: cleanCode, observations, userId: currentUser?.id });
    } catch (requestError) {
      setError(requestError.message || 'No se pudo exportar la base de datos.');
      throw requestError;
    }
  };

  const handleImportSystemDatabase = async ({ code, backup, file, confirmation, observations }) => {
    const cleanCode = String(code ?? '').trim();
    if (!cleanCode) {
      setError('Debes ingresar la contrasena de seguridad.');
      throw new Error('Debes ingresar la contrasena de seguridad.');
    }

    setError('');
    try {
      const result = await api.system.importDatabase({
        code: cleanCode,
        backup,
        file,
        confirmation,
        observations,
        userId: currentUser?.id,
      });
      await loadData();
      return result;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo importar la base de datos.');
      throw requestError;
    }
  };

  const handlePublishUpdateNotice = async () => {
    if (!currentUser) return null;
    const notice = await api.updateNotice.publish({
      message: 'Hay nuevas mejoras. Te recomiendo actualizar.',
      version: new Date().toISOString(),
      publishedBy: currentUser.fullName || currentUser.username || 'Developer',
    });
    setUpdateNotice(notice);
    return notice;
  };

  return {
    activeTab,
    setActiveTab,
    authReady,
    currentUser,
    authError,
    loading,
    ordersModuleLoading,
    prepareTabData,
    prepareOrdersEditorData,
    error,
    loadData,
    dashboard,
    summaryCards,
    isCatalogView,
    subtitleText,
    items,
    inventoryCombos,
    categories,
    quotes,
    contracts,
    hiddenContracts,
    supplierBundle,
    personnelBundle,
    inventoryMovements,
    inventoryMovementStats,
    inventoryModuleLoading,
    stockRecoveries,
    damageLossOverview,
    rentals,
    activeRentals,
    returnedRentals,
    cancelledRentals,
    receipts,
    cashSummary,
    cashSessions,
    cashMovements,
    cashDebts,
    cashPaymentChannels,
    cashReturnIssues,
    cashMovementMeta,
    accountingOperationsLoading,
    attendanceRecords,
    attendanceUsersLoading,
    userPresence,
    updateNotice,
    activeCashSession,
    clients,
    users,
    deliveries,
    transportRoutes,
    vehicles,
    drivers,
    calendarEvents,
    settingsBundle,
    generatedReports,
    auditLog,
    categoryItemCount,
    imagePreview,
    setImagePreview,
    handleLogin,
    handleLogout,
    handleCreateClient,
    handleUpdateClient,
    handleCreateUser,
    handleUpdateUser,
    handleRemoveUser,
    handleResendInvite,
    handleCreatePersonnelEmployee,
    handleUpdatePersonnelEmployee,
    handleRemovePersonnelEmployee,
    handleCreatePersonnelIncident,
    handleImportPersonnelAttendance,
    handleCreateDelivery,
    handleUpdateDelivery,
    handleCreateTransportRoute,
    handleUpdateTransportRoute,
    handleRegisterPickupChecklist,
    handleCreateVehicle,
    handleUpdateVehicle,
    handleRemoveVehicle,
    handleCreateDriver,
    handleUpdateDriver,
    handleRemoveDriver,
    handleCreateCalendarEvent,
    handleUpdateSettings,
    handleGenerateReport,
    handleCreateInventoryItem,
    handleUpdateInventoryItem,
    handleUploadProductImage,
    handleRemoveInventoryItem,
    handleCreateInventoryCombo,
    handleUpdateInventoryCombo,
    handleRemoveInventoryCombo,
    handleCreateInventoryMovement,
    handleProcessStockRecovery,
    handleOpenCashSession,
    handleCloseCashSession,
    handleCreateCashDebt,
    handlePayCashDebt,
    handleDeleteCashDebt,
    handleUpdateTreasuryAccounts,
    handleCreateCashMovement,
    handleUpdatePettyExpense,
    handleDeletePettyExpense,
    handleVoidAndReplaceCashMovementReceipt,
    handleCollectReceivable,
    handleReceiveReturnedOrder,
    handleCreateCategory,
    handleUpdateCategory,
    handleRemoveCategory,
    handleCreateQuote,
    handleUpdateQuote,
    handleRemoveQuote,
    handleUpdateOrderOperational,
    handleRemoveOrder,
    handleCancelOrderContract,
    handleCreateContract,
    handleUpdateContract,
    handleSetContractFinalized,
    handleUpdateContractEconomicLedger,
    handleRemoveContract,
    handleRestoreContract,
    handleRevertContractToQuote,
    handleCreateSupplier,
    handleUpdateSupplier,
    handleCreateSupplierQuote,
    handleCreateSupplierLoan,
    handleUpdateSupplierLoanStatus,
    handleCreateContractFromQuote,
    handleCreateContractFromOrder,
    handleCreateAndApproveContract,
    handleApproveContract,
    handleApproveQuote,
    handleGenerateOrderDocuments,
    handlePrintContractDocument,
    handlePrintInventoryOrderDocument,
    handlePrintInventoryWeekDocument,
    handlePrintRouteSheetDocument,
    handlePrintRentalReceipt,
    handlePrintReturnReceipt,
    handlePrintCashMovementReceipt,
    handleLoadAttendanceRecords,
    handleCreateAttendanceRecord,
    handleVerifyResetAccess,
    handleAnalyzeSystemReset,
    handleExecuteSystemReset,
    handleExportSystemDatabase,
    handleImportSystemDatabase,
    handlePublishUpdateNotice,
  };
};
