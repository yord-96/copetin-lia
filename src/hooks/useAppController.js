import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { canAccessTab, getDefaultTabForUser, getUserDisplayRole } from '../utils/permissions';

const isPrintCanceledError = (error) => {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('print job canceled') || message.includes('cancel');
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
  const [categories, setCategories] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [supplierBundle, setSupplierBundle] = useState({ suppliers: [], quotes: [], loans: [] });
  const [personnelBundle, setPersonnelBundle] = useState({ employees: [], attendance: [], incidents: [] });
  const [inventoryMovements, setInventoryMovements] = useState([]);
  const [stockRecoveries, setStockRecoveries] = useState([]);
  const [rentals, setRentals] = useState([]);
  const [cashSummary, setCashSummary] = useState(null);
  const [cashSessions, setCashSessions] = useState([]);
  const [cashMovements, setCashMovements] = useState([]);
  const [userPresence, setUserPresence] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
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

  const [imagePreview, setImagePreview] = useState(null);

  const loadData = useCallback(async (options = {}) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const [
        dashboardData,
        inventoryData,
        categoriesData,
        quotesData,
        contractsData,
        suppliersData,
        personnelData,
        movementsData,
        recoveriesData,
        rentalsData,
        cashSummaryData,
        cashSessionsData,
        cashMovementsData,
        clientsData,
        usersData,
        deliveriesData,
        vehiclesData,
        driversData,
        calendarEventsData,
        settingsData,
        reportsData,
        presenceData,
      ] = await Promise.all([
        api.dashboard.get(),
        api.inventory.list(),
        api.categories.list(),
        api.quotes.list(),
        api.contracts.list(),
        api.suppliers.listBundle(),
        api.personnel.listBundle(),
        api.inventory.listMovements(),
        api.inventory.listRecoveries(),
        api.rentals.list(),
        api.cash.getSummary(),
        api.cash.listSessions(),
        api.cash.listMovements(),
        api.clients.list(),
        api.users.list(),
        api.transport.listDeliveries(),
        api.transport.listVehicles(),
        api.transport.listDrivers(),
        api.calendar.listEvents(),
        api.settings.get(),
        api.reports.listGenerated(),
        api.presence.listActive(),
      ]);

      setDashboard(dashboardData);
      setItems(inventoryData);
      setCategories(categoriesData);
      setQuotes(quotesData);
      setContracts(contractsData);
      setSupplierBundle(suppliersData);
      setPersonnelBundle(personnelData);
      setInventoryMovements(movementsData);
      setStockRecoveries(recoveriesData);
      setRentals(rentalsData);
      setCashSummary(cashSummaryData);
      setCashSessions(cashSessionsData);
      setCashMovements(cashMovementsData);
      setClients(clientsData);
      setUsers(usersData);
      setDeliveries(deliveriesData);
      setVehicles(vehiclesData);
      setDrivers(driversData);
      setCalendarEvents(calendarEventsData);
      setSettingsBundle(settingsData);
      setGeneratedReports(reportsData);
      setUserPresence(presenceData);
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

  const publishPresence = useCallback(async () => {
    if (!currentUser) return;
    try {
      const active = await api.presence.heartbeat({
        userId: currentUser.id,
        fullName: currentUser.fullName ?? currentUser.username,
        role: getUserDisplayRole(currentUser),
        activeTab,
      });
      setUserPresence(active);
    } catch {
      // Presence is supportive; the app should keep working if the heartbeat fails.
    }
  }, [activeTab, currentUser]);

  useEffect(() => {
    if (!authReady || !currentUser) return undefined;
    publishPresence();
    const intervalId = window.setInterval(publishPresence, 20000);
    return () => window.clearInterval(intervalId);
  }, [authReady, currentUser, publishPresence]);

  useEffect(() => {
    if (!authReady || !currentUser) return undefined;

    let refreshTimer = null;
    let presenceTimer = null;
    let disposed = false;

    const refreshPresence = async () => {
      try {
        const active = await api.presence.listActive();
        if (!disposed) {
          setUserPresence(active);
        }
      } catch {
        // Presence should never block the main workflow.
      }
    };

    const unsubscribe = api.sync.subscribe((event) => {
      if (disposed) return;

      if (event?.domain === 'presence') {
        window.clearTimeout(presenceTimer);
        presenceTimer = window.setTimeout(refreshPresence, 250);
        return;
      }

      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        if (!disposed) {
          loadData({ silent: true });
        }
      }, 450);
    });

    return () => {
      disposed = true;
      window.clearTimeout(refreshTimer);
      window.clearTimeout(presenceTimer);
      unsubscribe();
    };
  }, [authReady, currentUser, loadData]);

  useEffect(() => {
    let isMounted = true;
    const loadSession = async () => {
      setAuthError('');
      try {
        const session = await api.auth.getSession();
        if (!isMounted) return;
        setCurrentUser(session);
        setActiveTab(session ? getDefaultTabForUser(session) : 'caja');
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
    loadData();
  }, [authReady, currentUser, loadData]);

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
    || activeTab === 'personal'
    || activeTab === 'contabilidad'
    || String(activeTab).startsWith('inventario')
    || String(activeTab).startsWith('devolucion')
    || activeTab === 'alquiler';

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
      : activeTab === 'personal'
      ? 'Gestiona personal, asistencia, permisos y horas trabajadas.'
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
      await api.users.create(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el usuario.');
      throw requestError;
    }
  };

  const handleLogin = async (payload) => {
    setAuthError('');
    setError('');
    try {
      const session = await api.auth.login(payload);
      setCurrentUser(session);
      setActiveTab(getDefaultTabForUser(session));
      return session;
    } catch (requestError) {
      setAuthError(requestError.message || 'No se pudo iniciar sesion.');
      throw requestError;
    }
  };

  const handleLogout = async () => {
    setAuthError('');
    setError('');
    try {
      if (currentUser?.id) {
        await api.presence.leave({ userId: currentUser.id });
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
      await api.users.update(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el usuario.');
      throw requestError;
    }
  };

  const handleRemoveUser = async (payload) => {
    setError('');
    try {
      await api.users.remove(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar el usuario.');
      throw requestError;
    }
  };

  const handleResendInvite = async (payload) => {
    setError('');
    try {
      await api.users.resendInvite(payload);
      await loadData();
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
        requireCashSession: false,
      });
      await loadData();
      return returned;
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
      await api.reports.generate(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo generar el reporte.');
      throw requestError;
    }
  };

  const handleCreateInventoryItem = async (payload) => {
    setError('');
    try {
      await api.inventory.create(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el producto de inventario.');
      throw requestError;
    }
  };

  const handleUpdateInventoryItem = async (payload) => {
    setError('');
    try {
      await api.inventory.update(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el producto de inventario.');
      throw requestError;
    }
  };

  const handleRemoveInventoryItem = async (payload) => {
    setError('');
    try {
      await api.inventory.remove(payload);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar el producto de inventario.');
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

  const handleOpenCashSession = async (payload) => {
    setError('');
    try {
      const created = await api.cash.openSession(payload);
      await loadData();
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
      await loadData();
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
      await loadData();
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la distribucion de caja grande.');
      throw requestError;
    }
  };

  const handleCreateCashMovement = async (payload) => {
    setError('');
    try {
      const created = await api.cash.createManualMovement(payload);
      await loadData();
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo registrar el movimiento de caja.');
      throw requestError;
    }
  };

  const handleCollectReceivable = async (payload) => {
    setError('');
    try {
      const result = await api.cash.collectReceivable(payload);
      await loadData();
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
      const created = await api.quotes.create({ ...payload, ...getCurrentUserTrace() });
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
      await loadData();
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
      await loadData();
      return cancelled;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo anular el contrato.');
      throw requestError;
    }
  };

  const handleCreateContract = async (payload) => {
    setError('');
    try {
      const created = await api.contracts.create({ ...payload, ...getCurrentUserTrace() });
      await loadData();
      return created;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear el contrato.');
      throw requestError;
    }
  };

  const handleUpdateContract = async (payload) => {
    setError('');
    try {
      const updated = await api.contracts.update(payload);
      await loadData();
      return updated;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar el contrato.');
      throw requestError;
    }
  };

  const handleRemoveContract = async (payload) => {
    setError('');
    try {
      const removed = await api.contracts.remove(payload);
      await loadData();
      return removed;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo eliminar el contrato.');
      throw requestError;
    }
  };

  const handleCreateSupplier = async (payload) => {
    setError('');
    try {
      const created = await api.suppliers.create(payload);
      await loadData();
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
      await loadData();
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
        quoteId: quote.id,
        clientId: quote.clientId ?? null,
        customerName: quote.customerName,
        customerPhone: quote.customerPhone,
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
        pickupDate: quote.pickupDate,
        pickupWindowStart: quote.pickupWindowStart,
        pickupWindowEnd: quote.pickupWindowEnd,
        driverId: quote.driverId || null,
        vehicleId: quote.vehicleId || null,
        validUntil: quote.validUntil || null,
        observations: quote.observations,
        billingMode: quote.billingMode ?? 'sin_factura',
        pricingPlan: quote.pricingPlan ?? null,
        supplierFulfillmentPlan: quote.supplierFulfillmentPlan ?? [],
        discountBs: Number(quote?.totals?.discountBs ?? 0),
        guaranteeBs: Number(quote?.totals?.guaranteeBs ?? 0),
        paidAtApprovalBs: Number(quote?.payment?.paidAtApprovalBs ?? 0),
        status: 'pendiente',
        items: (quote.items ?? []).map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          unitPriceBs: line.unitPriceBs,
        })),
        ...getCurrentUserTrace(),
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

  const resolveRentalForDocumentFlow = async ({ rentalId, orderCode }) => {
    const normalizedRentalId = String(rentalId ?? '').trim();
    const normalizedOrderCode = String(orderCode ?? '').trim();
    const localRental = rentals.find(
      (row) =>
        (normalizedRentalId && row.id === normalizedRentalId)
        || (normalizedOrderCode && row.orderCode === normalizedOrderCode),
    );
    if (localRental) return localRental;

    const allRentals = await api.rentals.list();
    return (
      allRentals.find(
        (row) =>
          (normalizedRentalId && row.id === normalizedRentalId)
          || (normalizedOrderCode && row.orderCode === normalizedOrderCode),
      ) ?? null
    );
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

  const handleGenerateOrderDocuments = async ({ rentalId, orderCode }) => {
    const rental = await resolveRentalForDocumentFlow({ rentalId, orderCode });
    if (!rental) {
      throw new Error('No se pudo identificar la orden de servicio para generar documentos.');
    }

    const linkedDeliveries = await resolveDeliveriesForDocumentFlow(rental);
    const firstDelivery = linkedDeliveries[0] ?? null;

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
      api.reports.generate({
        name: `Hoja Ruta ${rental.orderCode}${firstDelivery?.deliveryCode ? ` (${firstDelivery.deliveryCode})` : ''}`,
        category: 'Transporte',
        periodFrom: firstDelivery?.scheduledDate ?? baseDate,
        periodTo: firstDelivery?.scheduledDate ?? baseDate,
        format: 'PDF',
        generatedBy: 'Sistema Copetin',
        sourceType: 'hoja_ruta',
        sourceId: firstDelivery?.id ?? rental.id,
      }),
    ]);
  };

  const handlePrintContractDocument = async ({ rentalId, orderCode, contractId }) => {
    setError('');
    try {
      return await api.printer.printContract({ rentalId, orderCode, contractId });
    } catch (requestError) {
      if (isPrintCanceledError(requestError)) return;
      setError(requestError.message || 'No se pudo abrir el contrato.');
      throw requestError;
    }
  };

  const handlePrintInventoryOrderDocument = async ({ rentalId, orderCode }) => {
    setError('');
    try {
      return await api.printer.printInventoryOrder({ rentalId, orderCode });
    } catch (requestError) {
      if (isPrintCanceledError(requestError)) return;
      setError(requestError.message || 'No se pudo abrir la orden de inventario.');
      throw requestError;
    }
  };

  const handlePrintRouteSheetDocument = async ({ rentalId, orderCode }) => {
    setError('');
    try {
      return await api.printer.printRouteSheet({ rentalId, orderCode });
    } catch (requestError) {
      if (isPrintCanceledError(requestError)) return;
      setError(requestError.message || 'No se pudo abrir la hoja de ruta.');
      throw requestError;
    }
  };

  const handleApproveContract = async ({ contractId }) => {
    setError('');
    try {
      const allContracts = await api.contracts.list();
      const contract =
        contracts.find((entry) => entry.id === contractId)
        ?? allContracts.find((entry) => entry.id === contractId);

      if (!contract) {
        throw new Error('No se encontro el contrato seleccionado.');
      }
      if (contract.status === 'aprobado' && contract.rentalId) {
        throw new Error('Este contrato ya fue aprobado.');
      }

      const paidAtApprovalBs = Number(contract?.payment?.paidAtApprovalBs ?? 0);
      const totalBs = Number(contract?.totals?.totalBs ?? 0);
      const allClients = await api.clients.list();
      const contractClient =
        clients.find((entry) => entry.id === contract.clientId)
        ?? allClients.find((entry) => entry.id === contract.clientId)
        ?? allClients.find((entry) => String(entry.name ?? '').trim().toLowerCase() === String(contract.customerName ?? '').trim().toLowerCase());
      const availablePrepaidBs = contractClient?.prepaidEnabled
        ? Math.max(0, Number(contractClient.prepaidBalanceBs ?? 0))
        : 0;
      const prepaidAppliedBs = Math.min(availablePrepaidBs, Math.max(0, totalBs - paidAtApprovalBs));
      const coveredAtApprovalBs = Number((paidAtApprovalBs + prepaidAppliedBs).toFixed(2));
      const paymentMode =
        coveredAtApprovalBs >= totalBs && totalBs > 0
          ? 'cancelado'
          : coveredAtApprovalBs > 0
          ? 'a_cuenta'
          : 'sin_pago';

      const createdRental = await api.rentals.create({
        ...getCurrentUserTrace(),
        clientId: contract.clientId ?? null,
        customerName: contract.customerName,
        customerPhone: contract.customerPhone,
        rentalDate: contract.deliveryDate || contract.eventDate,
        dueDate: contract.pickupDate || contract.deliveryDate || contract.eventDate,
        dueTime: contract.pickupWindowEnd || contract.eventTime || '23:59',
        deliveryWindowStart: contract.deliveryWindowStart || '00:00',
        deliveryWindowEnd: contract.deliveryWindowEnd || contract.eventTime || null,
        pickupWindowStart: contract.pickupWindowStart || null,
        pickupWindowEnd: contract.pickupWindowEnd || contract.eventTime || '23:59',
        depositBs: Number(contract?.totals?.guaranteeBs ?? 0),
        paidAtRentalBs: coveredAtApprovalBs,
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
        items: (contract.items ?? []).map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          unitPriceBs: line.unitPriceBs,
        })),
      });

      if ((contract.logisticsMode ?? 'envio') !== 'recojo') {
        const refreshedDeliveries = await api.transport.listDeliveries();
        const autoDelivery = refreshedDeliveries.find((entry) => entry.rentalId === createdRental.id);
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

      if (contract.quoteId) {
        await api.quotes.update({
          id: contract.quoteId,
          status: 'aprobada',
          approvedAt: new Date().toISOString(),
          rejectedAt: null,
          rentalId: createdRental.id,
          orderCode: createdRental.orderCode,
        });
      }

      await api.contracts.update({
        id: contract.id,
        status: 'aprobado',
        approvedAt: new Date().toISOString(),
        rejectedAt: null,
        rentalId: createdRental.id,
        orderCode: createdRental.orderCode,
        paidAtApprovalBs: coveredAtApprovalBs,
        prepaidAppliedBs,
      });

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

      await loadData();

      if (documentsWarning) {
        setError(`${createdRental.orderCode} aprobada, pero hubo un problema al generar documentos.`);
      }

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

  const handleSystemReset = async (securityCode) => {
    const code = String(securityCode ?? '').trim();
    if (!code) {
      setError('Debes ingresar el codigo de seguridad.');
      return false;
    }

    setError('');
    try {
      await api.system.reset({ code });
      setActiveTab('caja');
      setImagePreview(null);
      await loadData();
      return true;
    } catch (requestError) {
      setError(requestError.message || 'No se pudo reiniciar la informacion.');
      return false;
    }
  };

  return {
    activeTab,
    setActiveTab,
    authReady,
    currentUser,
    authError,
    loading,
    error,
    loadData,
    dashboard,
    summaryCards,
    isCatalogView,
    subtitleText,
    items,
    categories,
    quotes,
    contracts,
    supplierBundle,
    personnelBundle,
    inventoryMovements,
    stockRecoveries,
    rentals,
    activeRentals,
    returnedRentals,
    cancelledRentals,
    receipts,
    cashSummary,
    cashSessions,
    cashMovements,
    userPresence,
    activeCashSession,
    clients,
    users,
    deliveries,
    vehicles,
    drivers,
    calendarEvents,
    settingsBundle,
    generatedReports,
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
    handleRemoveInventoryItem,
    handleCreateInventoryMovement,
    handleOpenCashSession,
    handleCloseCashSession,
    handleUpdateTreasuryAccounts,
    handleCreateCashMovement,
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
    handleRemoveContract,
    handleCreateSupplier,
    handleUpdateSupplier,
    handleCreateSupplierQuote,
    handleCreateSupplierLoan,
    handleUpdateSupplierLoanStatus,
    handleCreateContractFromQuote,
    handleCreateContractFromOrder,
    handleApproveContract,
    handleApproveQuote,
    handleGenerateOrderDocuments,
    handlePrintContractDocument,
    handlePrintInventoryOrderDocument,
    handlePrintRouteSheetDocument,
    handlePrintRentalReceipt,
    handlePrintReturnReceipt,
    handleSystemReset,
  };
};
