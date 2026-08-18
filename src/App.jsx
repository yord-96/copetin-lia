import { Suspense, lazy, memo, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { useAppController } from './hooks/useAppController';
import { runtimeInfo } from './services/api';
import { formatBs, formatDate, formatDateTime } from './utils/formatters';
import TopBar from './components/layout/TopBar';
import TabsNav, { MobileNavigation } from './components/layout/TabsNav';
import WorkspaceHeader from './components/layout/WorkspaceHeader';
import ImageModal from './components/common/ImageModal';
import GlobalUpdateNotice from './components/common/GlobalUpdateNotice';
import SystemResetPanel from './components/common/SystemResetPanel';
import LoginScreen from './components/auth/LoginScreen';
import PublicCatalogPage from './components/public/PublicCatalogPage';
import {
  canAccessCompany,
  canAccessTab,
  canWriteTab,
  getAllowedTabRoots,
  getDefaultTabForUser,
  getUserCompanyAccess,
  isDeveloper,
} from './utils/permissions';

const DEVELOPER_COMPANY_STORAGE_KEY = 'copetin-developer-company-choice-v1';
const SIDEBAR_SEEN_STORAGE_KEY = 'copetin-sidebar-seen-counts-v3-empty';
const DEFAULT_SIDEBAR_SEEN_COUNTS = { inventario: 0, devolucion: 0 };
const loadSummarySection = () => import('./components/sections/SummarySection');
const loadCategoriesSection = () => import('./components/sections/CategoriesSection');
const loadRecibosSection = () => import('./components/sections/RecibosSection');
const loadReturnSection = () => import('./components/sections/ReturnSection');
const loadCalendarSection = () => import('./components/sections/CalendarSection');
const loadClientsSection = () => import('./components/sections/ClientsSection');
const loadUsersSection = () => import('./components/sections/UsersSection');
const loadServiceOrdersSection = () => import('./components/sections/ServiceOrdersSection');
const loadAvailabilitySection = () => import('./components/sections/AvailabilitySection');
const loadAttendanceSection = () => import('./components/sections/AttendanceSection');
const loadInventoryDashboardSection = () => import('./components/sections/InventoryDashboardSection');
const loadSuppliersSection = () => import('./components/sections/SuppliersSection');
const loadPersonnelSection = () => import('./components/sections/PersonnelSection');
const loadLinconWorkspaceSection = () => import('./components/sections/LinconWorkspaceSection');
const loadAccountingSection = () => import('./components/sections/AccountingSection');

const SummarySection = lazy(loadSummarySection);
const CategoriesSection = lazy(loadCategoriesSection);
const RecibosSection = lazy(loadRecibosSection);
const ReturnSection = lazy(loadReturnSection);
const CalendarSection = lazy(loadCalendarSection);
const ClientsSection = lazy(loadClientsSection);
const UsersSection = lazy(loadUsersSection);
const ServiceOrdersSection = lazy(loadServiceOrdersSection);
const AccountingSection = lazy(loadAccountingSection);
const collectionSignatureCache = new WeakMap();

const getCollectionSignature = (rows, kind) => {
  if (!Array.isArray(rows)) return '';
  const cached = collectionSignatureCache.get(rows);
  if (cached?.kind === kind) return cached.signature;

  const signature = rows.map((row) => {
    if (kind === 'contracts') {
      return [
        row?.id,
        row?.contractCode,
        row?.orderCode,
        row?.status,
        row?.updatedAt,
        row?.deletedAt,
        row?.totals?.totalBs,
        row?.totals?.guaranteeBs,
        row?.payment?.paidAtApprovalBs,
        row?.guarantee?.status,
      ].join(':');
    }

    return [
      row?.id,
      row?.contractId,
      row?.contractCode,
      row?.orderCode,
      row?.status,
      row?.updatedAt,
      row?.paidAtRentalBs,
      row?.depositBs,
      row?.returnedAt,
      row?.cancelledAt,
    ].join(':');
  }).join('|');

  collectionSignatureCache.set(rows, { kind, signature });
  return signature;
};

const areServiceOrdersPropsEqual = (previous, next) => {
  const ignoredKeys = new Set(['contracts', 'rentals', 'cashMovements']);
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);

  for (const key of keys) {
    if (ignoredKeys.has(key)) continue;
    if (previous[key] !== next[key]) return false;
  }

  return (
    getCollectionSignature(previous.contracts, 'contracts')
      === getCollectionSignature(next.contracts, 'contracts')
    && getCollectionSignature(previous.rentals, 'rentals')
      === getCollectionSignature(next.rentals, 'rentals')
  );
};

const StableServiceOrdersSection = memo(ServiceOrdersSection, areServiceOrdersPropsEqual);
const AvailabilitySection = lazy(loadAvailabilitySection);
const AttendanceSection = lazy(loadAttendanceSection);
const InventoryDashboardSection = lazy(loadInventoryDashboardSection);
const SuppliersSection = lazy(loadSuppliersSection);
const PersonnelSection = lazy(loadPersonnelSection);
const LinconWorkspaceSection = lazy(loadLinconWorkspaceSection);

const PRELOADERS_BY_TAB = Object.freeze({
  resumen: loadSummarySection,
  caja: loadCalendarSection,
  items: loadClientsSection,
  alquiler: loadServiceOrdersSection,
  disponibilidad: loadAvailabilitySection,
  asistencia: loadAttendanceSection,
  proveedores: loadSuppliersSection,
  personal: loadPersonnelSection,
  recibos: loadRecibosSection,
  categorias: loadCategoriesSection,
  usuarios: loadUsersSection,
  inventario: loadInventoryDashboardSection,
  devolucion: loadReturnSection,
  contabilidad: loadAccountingSection,
});

const getTabPreloadKey = (tabId) => {
  const target = String(tabId ?? '');
  if (target.startsWith('inventario')) return 'inventario';
  if (target.startsWith('devolucion')) return 'devolucion';
  if (target.startsWith('contabilidad')) return 'contabilidad';
  return target;
};

const getTabLabel = (tabId) => {
  const target = getTabPreloadKey(tabId);
  if (target === 'alquiler') return 'Ordenes';
  if (target === 'asistencia') return 'Asistencia';
  if (target === 'proveedores') return 'Proveedores';
  if (target === 'inventario') return 'Inventario';
  if (target === 'devolucion') return 'Transporte';
  if (target === 'caja') return 'Calendario';
  if (target === 'items') return 'Clientes';
  if (target === 'recibos') return 'Reportes';
  if (target === 'personal') return 'Personal';
  if (target === 'contabilidad') return 'Contabilidad';
  return 'vista';
};

const preloadTabModule = (tabId) => {
  const loader = PRELOADERS_BY_TAB[getTabPreloadKey(tabId)];
  if (!loader) return;
  loader().catch(() => {});
};

const readDeveloperCompanyChoice = () => {
  if (typeof window === 'undefined') return '';
  const choice = window.sessionStorage.getItem(DEVELOPER_COMPANY_STORAGE_KEY) || '';
  return choice === 'lincon' ? 'lincoln' : choice;
};

const saveDeveloperCompanyChoice = (choice) => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(DEVELOPER_COMPANY_STORAGE_KEY, choice);
};

const readSidebarSeenCounts = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_SIDEBAR_SEEN_COUNTS;
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(SIDEBAR_SEEN_STORAGE_KEY) || '{}');
    return {
      inventario: Number(parsed.inventario) || 0,
      devolucion: Number(parsed.devolucion) || 0,
    };
  } catch {
    return DEFAULT_SIDEBAR_SEEN_COUNTS;
  }
};

const saveSidebarSeenCounts = (counts) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SIDEBAR_SEEN_STORAGE_KEY, JSON.stringify(counts));
};

function DeveloperCompanyIcon({ type }) {
  if (type === 'salon') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 20h16" />
        <path d="M5 20V9l7-4 7 4v11" />
        <path d="M9 20v-7h6v7" />
        <path d="M8 10h8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h16v12H4z" />
      <path d="M8 7V5h8v2" />
      <path d="M4 12h16" />
      <path d="M9 12v2h6v-2" />
    </svg>
  );
}

function DeveloperCompanyModal({ availableCompanies = [], onSelect }) {
  const companies = [
    {
      id: 'copetin',
      title: 'El Copetin',
      eyebrow: 'Sistema principal',
      description: 'Administracion, inventario, contratos, transporte y caja del negocio.',
      tags: ['Inventario', 'Contratos', 'Clientes', 'Caja'],
      type: 'main',
    },
    {
      id: 'lincoln',
      title: 'Lincoln',
      eyebrow: 'Salon de eventos',
      description: 'Reservas, ambientes, paquetes y agenda operativa del salon.',
      tags: ['Reservas', 'Ambientes', 'Paquetes', 'Eventos'],
      type: 'salon',
    },
  ];

  return (
    <div className="developer-company-backdrop" role="presentation">
      <section className="developer-company-modal" role="dialog" aria-modal="true" aria-labelledby="developer-company-title">
        <header className="developer-company-header">
          <div className="developer-company-brand">
            <span className="developer-company-brand-mark" aria-hidden="true">
              EC
            </span>
            <div>
              <span>Acceso empresarial</span>
              <strong>Copetin / Lincoln</strong>
            </div>
          </div>
          <h2 id="developer-company-title">Elige tu espacio de trabajo</h2>
          <p>Selecciona el entorno que quieres abrir ahora. La eleccion se mantiene solo durante esta sesion.</p>
        </header>
        <div className="developer-company-options">
          {companies.filter((company) => availableCompanies.includes(company.id)).map((company) => (
            <button
              key={company.id}
              type="button"
              className={`developer-company-card developer-company-card--${company.type}`}
              onClick={() => onSelect(company.id)}
            >
              <span className="developer-company-card-top">
                <span className="developer-company-icon">
                  <DeveloperCompanyIcon type={company.type} />
                </span>
                <span className="developer-company-eyebrow">{company.eyebrow}</span>
              </span>
              <strong>{company.title}</strong>
              <span className="developer-company-description">{company.description}</span>
              <span className="developer-company-tags">
                {company.tags.map((tag) => (
                  <em key={tag}>{tag}</em>
                ))}
              </span>
              <span className="developer-company-action">
                Ingresar
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </span>
            </button>
          ))}
        </div>
        <footer className="developer-company-footer">
          <span>Acceso empresarial</span>
          <strong>El sistema abrira solamente una base empresarial a la vez.</strong>
        </footer>
      </section>
    </div>
  );
}

function AdminApp() {
  const controller = useAppController();
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [sidebarSeenCounts, setSidebarSeenCounts] = useState(readSidebarSeenCounts);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  const [developerCompanyChoice, setDeveloperCompanyChoice] = useState(readDeveloperCompanyChoice);
  const [pendingNavigationTab, setPendingNavigationTab] = useState('');
  const navigationRequestRef = useRef(0);
  const allowedTabRoots = useMemo(
    () => (controller.currentUser
      ? Array.from(getAllowedTabRoots(controller.currentUser)).filter((tab) => canAccessTab(controller.currentUser, tab))
      : []),
    [controller.currentUser],
  );
  const navigationDisplayTab = pendingNavigationTab || controller.activeTab;
  const isNavigating = Boolean(pendingNavigationTab);
  const availableCompanies = useMemo(
    () => (controller.currentUser ? getUserCompanyAccess(controller.currentUser) : []),
    [controller.currentUser],
  );
  const selectedCompany = availableCompanies.length === 1
    ? availableCompanies[0]
    : availableCompanies.includes(developerCompanyChoice)
      ? developerCompanyChoice
      : '';

  useEffect(() => {
    if (!controller.currentUser) {
      if (typeof window !== 'undefined' && !controller.currentUser) {
        window.sessionStorage.removeItem(DEVELOPER_COMPANY_STORAGE_KEY);
      }
      // Keep the in-memory selection aligned with the session storage lifecycle.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeveloperCompanyChoice('');
      return;
    }
    const storedChoice = readDeveloperCompanyChoice();
    setDeveloperCompanyChoice(getUserCompanyAccess(controller.currentUser).includes(storedChoice) ? storedChoice : '');
  }, [controller.currentUser]);

  useEffect(() => {
    if (
      !controller.authReady
      || !controller.currentUser
      || controller.loading
      || selectedCompany !== 'copetin'
      || typeof window === 'undefined'
    ) return undefined;
    const mobileStartup = window.matchMedia?.('(max-width: 900px), (pointer: coarse)')?.matches ?? window.innerWidth <= 900;
    if (mobileStartup) return undefined;

    const preloadOrder = ['alquiler']
      .filter((tabId) => allowedTabRoots.length === 0 || allowedTabRoots.includes(tabId));
    const timeoutIds = [];
    const runPreload = () => {
      preloadOrder.forEach((tabId) => {
        const timeoutId = window.setTimeout(() => preloadTabModule(tabId), 0);
        timeoutIds.push(timeoutId);
      });
    };

    let idleId = null;
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(runPreload, { timeout: 15000 });
    } else {
      timeoutIds.push(window.setTimeout(runPreload, 10000));
    }

    return () => {
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [allowedTabRoots, controller.authReady, controller.currentUser, controller.loading, selectedCompany]);

  useEffect(() => {
    if (!controller.currentUser || canAccessTab(controller.currentUser, controller.activeTab)) return;
    controller.setActiveTab(getDefaultTabForUser(controller.currentUser));
  }, [controller]);

  const sidebarPendingCounts = useMemo(() => {
    const activeRentals = Array.isArray(controller.activeRentals)
      ? controller.activeRentals
      : (controller.rentals ?? []).filter((rental) => rental.status === 'active');

    return activeRentals.reduce(
      (counts, rental) => {
        const inventoryStatus = rental?.operational?.inventoryStatus ?? 'pendiente';
        const transportStatus = rental?.operational?.transportStatus ?? 'pendiente';
        const logisticsMode = rental?.logisticsMode ?? 'envio';

        if (inventoryStatus !== 'confirmado') {
          counts.inventario += 1;
        }

        if (
          logisticsMode !== 'recojo'
          && transportStatus !== 'confirmado'
          && transportStatus !== 'no_aplica'
        ) {
          counts.devolucion += 1;
        }

        return counts;
      },
      { inventario: 0, devolucion: 0 },
    );
  }, [controller.activeRentals, controller.rentals]);

  const sidebarNotificationCounts = useMemo(() => ({
    inventario: Math.max(0, sidebarPendingCounts.inventario - (Number(sidebarSeenCounts.inventario) || 0)),
    devolucion: Math.max(0, sidebarPendingCounts.devolucion - (Number(sidebarSeenCounts.devolucion) || 0)),
  }), [sidebarPendingCounts, sidebarSeenCounts]);

  const markSidebarModuleAsSeen = (targetTab) => {
    const target = String(targetTab);
    const seenKey = target.startsWith('inventario')
      ? 'inventario'
      : target.startsWith('devolucion')
        ? 'devolucion'
        : null;

    if (!seenKey) {
      return;
    }

    setSidebarSeenCounts((current) => {
      const nextSeenValue = sidebarPendingCounts[seenKey] ?? 0;
      if ((Number(current[seenKey]) || 0) === nextSeenValue) {
        return current;
      }

      const next = { ...current, [seenKey]: nextSeenValue };
      saveSidebarSeenCounts(next);
      return next;
    });
  };

  const handleSidebarTabChange = (targetTab) => {
    if (!canAccessTab(controller.currentUser, targetTab)) {
      navigationRequestRef.current += 1;
      setPendingNavigationTab('');
      controller.setActiveTab(getDefaultTabForUser(controller.currentUser));
      return;
    }
    markSidebarModuleAsSeen(targetTab);
    if (targetTab === controller.activeTab) {
      navigationRequestRef.current += 1;
      setPendingNavigationTab('');
      return;
    }
    const requestId = navigationRequestRef.current + 1;
    navigationRequestRef.current = requestId;
    setPendingNavigationTab(targetTab);

    // Primero dejamos que React pinte la confirmacion de navegacion. Despues
    // cargamos y montamos el modulo pesado en otra tarea, para que el clic no
    // parezca congelado ni mantenga Calendario trabajando debajo.
    Promise.all([
      Promise.resolve(preloadTabModule(targetTab)).catch(() => {}),
      Promise.resolve(controller.prepareTabData?.(targetTab)).catch(() => {}),
    ])
      .catch(() => {})
      .then(() => new Promise((resolve) => window.requestAnimationFrame(resolve)))
      .then(() => {
        if (navigationRequestRef.current !== requestId) return;
        controller.setActiveTab(targetTab);
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (navigationRequestRef.current === requestId) setPendingNavigationTab('');
          });
        });
      });
  };

  const openResetDialog = () => {
    if (!isDeveloper(controller.currentUser)) return;
    setIsResetDialogOpen(true);
  };

  const closeResetDialog = () => {
    setIsResetDialogOpen(false);
  };

  const handleDeveloperCompanySelect = (choice) => {
    if (!canAccessCompany(controller.currentUser, choice)) return;
    saveDeveloperCompanyChoice(choice);
    setDeveloperCompanyChoice(choice);
    if (choice === 'copetin') {
      // La carga fue diferida mientras el selector estaba abierto. Iniciarla
      // despues del clic mantiene el acceso empresarial ligero e inmediato.
      controller.loadData();
    }
  };

  const handleCompanyChooserOpen = () => {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(DEVELOPER_COMPANY_STORAGE_KEY);
    setDeveloperCompanyChoice('');
  };

  const renderWorkspaceContent = () => {
    if (controller.loading) {
      return <p className="status">Cargando informacion...</p>;
    }

    const showWorkspaceHeader =
      controller.activeTab !== 'resumen'
      && controller.activeTab !== 'items'
      && controller.activeTab !== 'usuarios'
      && controller.activeTab !== 'recibos'
      && controller.activeTab !== 'categorias'
      && controller.activeTab !== 'alquiler'
      && controller.activeTab !== 'disponibilidad'
      && controller.activeTab !== 'proveedores'
      && controller.activeTab !== 'asistencia'
      && controller.activeTab !== 'personal'
      && controller.activeTab !== 'caja'
      && !String(controller.activeTab).startsWith('inventario')
      && !String(controller.activeTab).startsWith('devolucion')
      && !String(controller.activeTab).startsWith('contabilidad');
    const canWriteCalendar = canWriteTab(controller.currentUser, 'caja');
    const canWriteOrders = canWriteTab(controller.currentUser, 'alquiler');
    const canMarkAttendance = canAccessTab(controller.currentUser, 'asistencia');

    return (
      <>
        {showWorkspaceHeader ? (
          <WorkspaceHeader subtitleText={controller.subtitleText} onRefresh={controller.loadData} />
        ) : null}

        {controller.error && <p className="status error">{controller.error}</p>}

        {controller.activeTab === 'resumen' && (
          <SummarySection
            dashboard={controller.dashboard}
            summaryCards={controller.summaryCards}
            formatBs={formatBs}
            rentals={controller.rentals}
            deliveries={controller.deliveries}
            calendarEvents={controller.calendarEvents}
            contracts={controller.contracts}
            supplierBundle={controller.supplierBundle}
            items={controller.items}
            onOpenImage={controller.setImagePreview}
            onOpenCalendar={() => controller.setActiveTab('caja')}
          />
        )}

        {controller.activeTab === 'caja' && (
          <CalendarSection
            events={controller.calendarEvents}
            items={controller.items}
            rentals={controller.rentals}
            contracts={controller.contracts}
            deliveries={controller.deliveries}
            supplierBundle={controller.supplierBundle}
            readOnly={!canWriteCalendar}
            onCreateEvent={canWriteCalendar ? controller.handleCreateCalendarEvent : undefined}
            onPrintContractDocument={controller.handlePrintContractDocument}
            onPrintInventoryOrderDocument={controller.handlePrintInventoryOrderDocument}
            onPrintInventoryWeekDocument={controller.handlePrintInventoryWeekDocument}
          />
        )}

        {controller.activeTab === 'recibos' && (
          <RecibosSection
            receipts={controller.receipts}
            generatedReports={controller.generatedReports}
            auditLog={controller.auditLog}
            formatBs={formatBs}
            formatDateTime={formatDateTime}
            onPrintRentalReceipt={controller.handlePrintRentalReceipt}
            onPrintReturnReceipt={controller.handlePrintReturnReceipt}
            onGenerateReport={controller.handleGenerateReport}
          />
        )}

        {controller.activeTab === 'categorias' && (
          <CategoriesSection
            settingsBundle={controller.settingsBundle}
            categoryItemCount={controller.categoryItemCount}
            onUpdateSettings={controller.handleUpdateSettings}
          />
        )}

        {controller.activeTab === 'items' && (
          <ClientsSection
            clients={controller.clients}
            quotes={controller.quotes}
            rentals={controller.rentals}
            contracts={controller.contracts}
            deliveries={controller.deliveries}
            formatBs={formatBs}
            formatDate={formatDate}
            onCreateClient={controller.handleCreateClient}
            onUpdateClient={controller.handleUpdateClient}
            onSwitchToOrders={() => controller.setActiveTab('alquiler')}
            onPrintContractDocument={controller.handlePrintContractDocument}
            onPrintInventoryOrderDocument={controller.handlePrintInventoryOrderDocument}
            onPrintRouteSheetDocument={controller.handlePrintRouteSheetDocument}
          />
        )}

        {controller.activeTab === 'usuarios' && (
          <UsersSection
            users={controller.users}
            currentUser={controller.currentUser}
            formatDateTime={formatDateTime}
            onCreateUser={controller.handleCreateUser}
            onUpdateUser={controller.handleUpdateUser}
            onRemoveUser={controller.handleRemoveUser}
          />
        )}

        {controller.activeTab === 'proveedores' && (
          <SuppliersSection
            supplierBundle={controller.supplierBundle}
            items={controller.items}
            formatBs={formatBs}
            onCreateSupplier={controller.handleCreateSupplier}
            onUpdateSupplier={controller.handleUpdateSupplier}
            onCreateSupplierQuote={controller.handleCreateSupplierQuote}
            onCreateSupplierLoan={controller.handleCreateSupplierLoan}
            onUpdateSupplierLoanStatus={controller.handleUpdateSupplierLoanStatus}
          />
        )}

        {controller.activeTab === 'asistencia' && (
          <AttendanceSection
            records={controller.attendanceRecords}
            users={controller.users}
            usersLoading={controller.attendanceUsersLoading}
            currentUser={controller.currentUser}
            formatDateTime={formatDateTime}
            canMark={canMarkAttendance}
            onLoadRecords={controller.handleLoadAttendanceRecords}
            onCreateRecord={canMarkAttendance ? controller.handleCreateAttendanceRecord : undefined}
          />
        )}

        {controller.activeTab === 'personal' && (
          <PersonnelSection
            personnelBundle={controller.personnelBundle}
            formatDate={formatDate}
            formatBs={formatBs}
            onCreateEmployee={controller.handleCreatePersonnelEmployee}
            onUpdateEmployee={controller.handleUpdatePersonnelEmployee}
            onRemoveEmployee={controller.handleRemovePersonnelEmployee}
            onCreateIncident={controller.handleCreatePersonnelIncident}
            onImportAttendance={controller.handleImportPersonnelAttendance}
          />
        )}

        {String(controller.activeTab).startsWith('contabilidad') && (
          <AccountingSection
            activeModule={controller.activeTab}
            clients={controller.clients}
            rentals={controller.rentals}
            contracts={controller.contracts}
            quotes={controller.quotes}
            supplierBundle={controller.supplierBundle}
            personnelBundle={controller.personnelBundle}
            inventoryMovements={controller.inventoryMovements}
            stockRecoveries={controller.stockRecoveries}
            cashSummary={controller.cashSummary}
            cashSessions={controller.cashSessions}
            cashMovements={controller.cashMovements}
            cashDebts={controller.cashDebts}
            cashPaymentChannels={controller.cashPaymentChannels}
            cashReturnIssues={controller.cashReturnIssues}
            cashMovementMeta={controller.cashMovementMeta}
            operationsLoading={controller.accountingOperationsLoading}
            currentUser={controller.currentUser}
            formatBs={formatBs}
            formatDate={formatDate}
            formatDateTime={formatDateTime}
            onOpenCashSession={controller.handleOpenCashSession}
            onCloseCashSession={controller.handleCloseCashSession}
            onCreateCashMovement={controller.handleCreateCashMovement}
            onUpdatePettyExpense={controller.handleUpdatePettyExpense}
            onDeletePettyExpense={controller.handleDeletePettyExpense}
            onCreateCashDebt={controller.handleCreateCashDebt}
            onPayCashDebt={controller.handlePayCashDebt}
            onDeleteCashDebt={controller.handleDeleteCashDebt}
            onUpdateSupplierLoanStatus={controller.handleUpdateSupplierLoanStatus}
            onVoidAndReplaceCashMovementReceipt={controller.handleVoidAndReplaceCashMovementReceipt}
            onCollectReceivable={controller.handleCollectReceivable}
            onPrintCashMovementReceipt={controller.handlePrintCashMovementReceipt}
            onCreateEmployee={controller.handleCreatePersonnelEmployee}
          />
        )}

        {String(controller.activeTab).startsWith('inventario') && (
          <InventoryDashboardSection
            activeModule={controller.activeTab}
            items={controller.items}
            combos={controller.inventoryCombos}
            categories={controller.categories}
            contracts={controller.contracts}
            rentals={controller.rentals}
            activeRentals={controller.activeRentals}
            cancelledRentals={controller.cancelledRentals}
            deliveries={controller.deliveries}
            stockRecoveries={controller.stockRecoveries}
            damageLossOverview={controller.damageLossOverview}
            inventoryMovements={controller.inventoryMovements}
            inventoryMovementStats={controller.inventoryMovementStats}
            moduleLoading={controller.inventoryModuleLoading}
            formatBs={formatBs}
            formatDateTime={formatDateTime}
            onSwitchInventoryModule={controller.setActiveTab}
            onCreateInventoryItem={controller.handleCreateInventoryItem}
            onUpdateInventoryItem={controller.handleUpdateInventoryItem}
            onUploadProductImage={controller.handleUploadProductImage}
            onRemoveInventoryItem={controller.handleRemoveInventoryItem}
            onCreateInventoryCombo={controller.handleCreateInventoryCombo}
            onUpdateInventoryCombo={controller.handleUpdateInventoryCombo}
            onRemoveInventoryCombo={controller.handleRemoveInventoryCombo}
            onCreateInventoryMovement={controller.handleCreateInventoryMovement}
            onProcessStockRecovery={controller.handleProcessStockRecovery}
            onCreateCategory={controller.handleCreateCategory}
            onUpdateCategory={controller.handleUpdateCategory}
            onRemoveCategory={controller.handleRemoveCategory}
            onReloadData={controller.loadData}
            onOpenImage={controller.setImagePreview}
            onUpdateOrderOperational={controller.handleUpdateOrderOperational}
            onRemoveOrder={controller.handleRemoveOrder}
            onReceiveReturnedOrder={controller.handleReceiveReturnedOrder}
            onPrintContractDocument={controller.handlePrintContractDocument}
            onPrintInventoryWeekDocument={controller.handlePrintInventoryWeekDocument}
          />
        )}


        {controller.activeTab === 'disponibilidad' && (
          <AvailabilitySection
            items={controller.items}
            contracts={controller.contracts}
            rentals={controller.rentals}
            quotes={controller.quotes}
            clients={controller.clients}
            categories={controller.categories}
            formatDate={formatDate}
            onOpenImage={controller.setImagePreview}
          />
        )}

        {controller.activeTab === 'alquiler' && controller.ordersModuleLoading && (
          <p className="status">Cargando Ordenes...</p>
        )}

        {controller.activeTab === 'alquiler' && !controller.ordersModuleLoading && (
          <StableServiceOrdersSection
            quotes={controller.quotes}
            contracts={controller.contracts}
            hiddenContracts={controller.hiddenContracts}
            rentals={controller.rentals}
            deliveries={controller.deliveries}
            cashMovements={controller.cashMovements}
            supplierBundle={controller.supplierBundle}
            generatedReports={controller.generatedReports}
            clients={controller.clients}
            items={controller.items}
            combos={controller.inventoryCombos}
            vehicles={controller.vehicles}
            drivers={controller.drivers}
            users={controller.users}
            personnelBundle={controller.personnelBundle}
            settings={controller.settingsBundle?.settings}
            currentUser={controller.currentUser}
            readOnly={!canWriteOrders}
            formatDate={formatDate}
            formatDateTime={formatDateTime}
            formatBs={formatBs}
            onCreateQuote={canWriteOrders ? controller.handleCreateQuote : undefined}
            onUpdateQuote={canWriteOrders ? controller.handleUpdateQuote : undefined}
            onRemoveQuote={canWriteOrders ? controller.handleRemoveQuote : undefined}
            onApproveQuote={canWriteOrders ? controller.handleApproveQuote : undefined}
            onUpdateOrderOperational={canWriteOrders ? controller.handleUpdateOrderOperational : undefined}
            onCancelOrderContract={canWriteOrders ? controller.handleCancelOrderContract : undefined}
            onCreateContract={canWriteOrders ? controller.handleCreateContract : undefined}
            onUpdateContract={canWriteOrders ? controller.handleUpdateContract : undefined}
            onSetContractFinalized={canWriteOrders ? controller.handleSetContractFinalized : undefined}
            onUpdateEconomicLedger={canWriteOrders ? controller.handleUpdateContractEconomicLedger : undefined}
            onRemoveContract={canWriteOrders ? controller.handleRemoveContract : undefined}
            onRestoreContract={canWriteOrders ? controller.handleRestoreContract : undefined}
            onRevertContractToQuote={canWriteOrders ? controller.handleRevertContractToQuote : undefined}
            onCreateContractFromQuote={canWriteOrders ? controller.handleCreateContractFromQuote : undefined}
            onCreateContractFromOrder={canWriteOrders ? controller.handleCreateContractFromOrder : undefined}
            onCreateAndApproveContract={canWriteOrders ? controller.handleCreateAndApproveContract : undefined}
            onApproveContract={canWriteOrders ? controller.handleApproveContract : undefined}
            onGenerateOrderDocuments={controller.handleGenerateOrderDocuments}
            onCreateSupplier={canWriteOrders ? controller.handleCreateSupplier : undefined}
            onCreateSupplierQuote={canWriteOrders ? controller.handleCreateSupplierQuote : undefined}
            onCollectReceivable={canWriteOrders ? controller.handleCollectReceivable : undefined}
            onPrintCashMovementReceipt={controller.handlePrintCashMovementReceipt}
            onUpdateSettings={isDeveloper(controller.currentUser) ? controller.handleUpdateSettings : undefined}
            onOpenTransportModule={() => {
              markSidebarModuleAsSeen('devolucion_entregas');
              controller.setActiveTab('devolucion_entregas');
            }}
            onOpenInventoryModule={() => {
              markSidebarModuleAsSeen('inventario_movimientos');
              controller.setActiveTab('inventario_movimientos');
            }}
            onOpenReportsModule={() => controller.setActiveTab('recibos')}
            onOpenImage={controller.setImagePreview}
            onPrintContractDocument={controller.handlePrintContractDocument}
            onPrintInventoryWeekDocument={controller.handlePrintInventoryWeekDocument}
            onPrintRouteSheetDocument={controller.handlePrintRouteSheetDocument}
            canAccessTransport={canAccessTab(controller.currentUser, 'devolucion_entregas')}
            canAccessInventory={canAccessTab(controller.currentUser, 'inventario_movimientos')}
          />
        )}

        {String(controller.activeTab).startsWith('devolucion') && (
          <ReturnSection
            activeModule={controller.activeTab}
            onSwitchTransportModule={controller.setActiveTab}
            deliveries={controller.deliveries}
            contracts={controller.contracts}
            transportRoutes={controller.transportRoutes}
            rentals={controller.rentals}
            vehicles={controller.vehicles}
            drivers={controller.drivers}
            onCreateDelivery={controller.handleCreateDelivery}
            onUpdateDelivery={controller.handleUpdateDelivery}
            onCreateTransportRoute={controller.handleCreateTransportRoute}
            onUpdateTransportRoute={controller.handleUpdateTransportRoute}
            onRegisterPickupChecklist={controller.handleRegisterPickupChecklist}
            onCreateVehicle={controller.handleCreateVehicle}
            onUpdateVehicle={controller.handleUpdateVehicle}
            onRemoveVehicle={controller.handleRemoveVehicle}
            onCreateDriver={controller.handleCreateDriver}
            onUpdateDriver={controller.handleUpdateDriver}
            onRemoveDriver={controller.handleRemoveDriver}
            onGoToRental={() => controller.setActiveTab('alquiler')}
            onPrintRouteSheetDocument={controller.handlePrintRouteSheetDocument}
          />
        )}
      </>
    );
  };

  if (!controller.authReady || !controller.currentUser) {
    return (
      <LoginScreen
        authReady={controller.authReady}
        error={controller.authError}
        onLogin={controller.handleLogin}
      />
    );
  }

  const shouldShowDeveloperCompanyModal =
    availableCompanies.length > 1
    && !selectedCompany;

  if (selectedCompany === 'lincoln') {
    const canMarkAttendance = canAccessTab(controller.currentUser, 'asistencia');
    return (
      <Suspense fallback={<p className="status">Preparando Lincoln...</p>}>
        <LinconWorkspaceSection
          currentUser={controller.currentUser}
          availableCompanies={availableCompanies}
          attendanceProps={{
            records: controller.attendanceRecords,
            users: controller.users,
            usersLoading: controller.attendanceUsersLoading,
            currentUser: controller.currentUser,
            formatDateTime,
            canMark: canMarkAttendance,
            onLoadRecords: controller.handleLoadAttendanceRecords,
            onCreateRecord: canMarkAttendance ? controller.handleCreateAttendanceRecord : undefined,
          }}
          onOpenAttendance={() => controller.setActiveTab('asistencia')}
          onSwitchWorkspace={handleDeveloperCompanySelect}
          onLogout={controller.handleLogout}
        />
      </Suspense>
    );
  }

  return (
    <div className={`app-frame app-runtime-${runtimeInfo.mode}`}>
      <div className="app-layout">
        <aside className="app-sidebar">
          <TabsNav
            activeTab={navigationDisplayTab}
            isCatalogView={controller.isCatalogView}
            onChange={handleSidebarTabChange}
            notificationCounts={sidebarNotificationCounts}
            allowedTabs={allowedTabRoots}
            userPresence={controller.userPresence}
          />
        </aside>

        <section className="app-main">
          <TopBar
            onOpenResetDialog={openResetDialog}
            currentUser={controller.currentUser}
            onLogout={controller.handleLogout}
            canReset={isDeveloper(controller.currentUser)}
            userPresence={controller.userPresence}
            activeTab={controller.activeTab}
            onSwitchCompany={availableCompanies.length > 1 ? handleCompanyChooserOpen : undefined}
            onPublishUpdateNotice={isDeveloper(controller.currentUser) ? controller.handlePublishUpdateNotice : undefined}
          />

          <main className="app-content">
            <section className={controller.isCatalogView ? 'workspace workspace-inventory' : 'workspace'}>
              {isNavigating ? (
                <p className="status navigation-status" aria-live="polite">
                  Abriendo {getTabLabel(pendingNavigationTab || controller.activeTab)}...
                </p>
              ) : null}
              {isNavigating || shouldShowDeveloperCompanyModal ? null : (
                <Suspense fallback={<p className="status">Preparando vista...</p>}>
                  {renderWorkspaceContent()}
                </Suspense>
              )}
            </section>
          </main>
        </section>
      </div>

      <MobileNavigation
        activeTab={navigationDisplayTab}
        allowedTabs={allowedTabRoots}
        notificationCounts={sidebarNotificationCounts}
        isOpen={isMobileMoreOpen}
        onToggleMore={() => setIsMobileMoreOpen((current) => !current)}
        onCloseMore={() => setIsMobileMoreOpen(false)}
        onChange={handleSidebarTabChange}
      />

      <ImageModal imagePreview={controller.imagePreview} onClose={() => controller.setImagePreview(null)} />
      <GlobalUpdateNotice notice={controller.updateNotice} />

      {isResetDialogOpen && (
        <SystemResetPanel
          onClose={closeResetDialog}
          onVerify={controller.handleVerifyResetAccess}
          onAnalyze={controller.handleAnalyzeSystemReset}
          onExecute={controller.handleExecuteSystemReset}
          onExportDatabase={controller.handleExportSystemDatabase}
          onImportDatabase={controller.handleImportSystemDatabase}
        />
      )}

      {shouldShowDeveloperCompanyModal ? (
        <DeveloperCompanyModal availableCompanies={availableCompanies} onSelect={handleDeveloperCompanySelect} />
      ) : null}
    </div>
  );
}

function App() {
  const isPublicCatalogRoute = typeof window !== 'undefined'
    && window.location.pathname.replace(/\/+$/, '') === '/catalogo';

  if (isPublicCatalogRoute) {
    return <PublicCatalogPage />;
  }

  return <AdminApp />;
}

export default App;
