import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import './App.css';
import { useAppController } from './hooks/useAppController';
import { runtimeInfo } from './services/api';
import { formatBs, formatDate, formatDateTime } from './utils/formatters';
import TopBar from './components/layout/TopBar';
import TabsNav, { MobileNavigation } from './components/layout/TabsNav';
import WorkspaceHeader from './components/layout/WorkspaceHeader';
import ImageModal from './components/common/ImageModal';
import SystemResetPanel from './components/common/SystemResetPanel';
import LoginScreen from './components/auth/LoginScreen';
import { canAccessTab, getAllowedTabRoots, getDefaultTabForUser, isDeveloper } from './utils/permissions';

const DEVELOPER_COMPANY_STORAGE_KEY = 'copetin-developer-company-choice-v1';
const SIDEBAR_SEEN_STORAGE_KEY = 'copetin-sidebar-seen-counts-v3-empty';
const DEFAULT_SIDEBAR_SEEN_COUNTS = { inventario: 0, devolucion: 0 };
const SummarySection = lazy(() => import('./components/sections/SummarySection'));
const CategoriesSection = lazy(() => import('./components/sections/CategoriesSection'));
const RecibosSection = lazy(() => import('./components/sections/RecibosSection'));
const ReturnSection = lazy(() => import('./components/sections/ReturnSection'));
const CalendarSection = lazy(() => import('./components/sections/CalendarSection'));
const ClientsSection = lazy(() => import('./components/sections/ClientsSection'));
const UsersSection = lazy(() => import('./components/sections/UsersSection'));
const ServiceOrdersSection = lazy(() => import('./components/sections/ServiceOrdersSection'));
const InventoryDashboardSection = lazy(() => import('./components/sections/InventoryDashboardSection'));
const SuppliersSection = lazy(() => import('./components/sections/SuppliersSection'));
const PersonnelSection = lazy(() => import('./components/sections/PersonnelSection'));
const AccountingSection = lazy(() => import('./components/sections/AccountingSection'));
const LinconWorkspaceSection = lazy(() => import('./components/sections/LinconWorkspaceSection'));

const prefetchersByTab = {
  resumen: () => import('./components/sections/SummarySection'),
  caja: () => import('./components/sections/CalendarSection'),
  items: () => import('./components/sections/ClientsSection'),
  alquiler: () => import('./components/sections/ServiceOrdersSection'),
  proveedores: () => import('./components/sections/SuppliersSection'),
  personal: () => import('./components/sections/PersonnelSection'),
  inventario: () => import('./components/sections/InventoryDashboardSection'),
  devolucion: () => import('./components/sections/ReturnSection'),
  recibos: () => import('./components/sections/RecibosSection'),
  contabilidad: () => import('./components/sections/AccountingSection'),
  usuarios: () => import('./components/sections/UsersSection'),
  categorias: () => import('./components/sections/CategoriesSection'),
};

const readDeveloperCompanyChoice = () => {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(DEVELOPER_COMPANY_STORAGE_KEY) || '';
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

function DeveloperCompanyModal({ onSelect }) {
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
      id: 'lincon',
      title: 'Lincon',
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
              <span>Acceso developer</span>
              <strong>El Copetin</strong>
            </div>
          </div>
          <h2 id="developer-company-title">Elige tu espacio de trabajo</h2>
          <p>Selecciona el entorno que quieres abrir ahora. La eleccion se mantiene solo durante esta sesion.</p>
        </header>
        <div className="developer-company-options">
          {companies.map((company) => (
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
          <span>Sesion developer</span>
          <strong>El sistema abrira la operacion seleccionada sin mezclar datos.</strong>
        </footer>
      </section>
    </div>
  );
}

function App() {
  const controller = useAppController();
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [sidebarSeenCounts, setSidebarSeenCounts] = useState(readSidebarSeenCounts);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  const [developerCompanyChoice, setDeveloperCompanyChoice] = useState(readDeveloperCompanyChoice);
  const allowedTabRoots = useMemo(
    () => (controller.currentUser ? Array.from(getAllowedTabRoots(controller.currentUser)) : []),
    [controller.currentUser],
  );

  useEffect(() => {
    if (!controller.currentUser) return undefined;
    const timer = window.setTimeout(() => {
      allowedTabRoots
        .map((tab) => prefetchersByTab[tab])
        .filter(Boolean)
        .forEach((prefetch) => prefetch());
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [allowedTabRoots, controller.currentUser]);

  useEffect(() => {
    if (!controller.currentUser || !isDeveloper(controller.currentUser)) {
      if (typeof window !== 'undefined' && !controller.currentUser) {
        window.sessionStorage.removeItem(DEVELOPER_COMPANY_STORAGE_KEY);
      }
      // Keep the in-memory selection aligned with the session storage lifecycle.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeveloperCompanyChoice('');
      return;
    }
    setDeveloperCompanyChoice(readDeveloperCompanyChoice());
  }, [controller.currentUser]);

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
      controller.setActiveTab(getDefaultTabForUser(controller.currentUser));
      return;
    }
    markSidebarModuleAsSeen(targetTab);
    controller.setActiveTab(targetTab);
  };

  const openResetDialog = () => {
    if (!isDeveloper(controller.currentUser)) return;
    setIsResetDialogOpen(true);
  };

  const closeResetDialog = () => {
    setIsResetDialogOpen(false);
  };

  const handleDeveloperCompanySelect = (choice) => {
    saveDeveloperCompanyChoice(choice);
    setDeveloperCompanyChoice(choice);
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
      && controller.activeTab !== 'proveedores'
      && controller.activeTab !== 'personal'
      && controller.activeTab !== 'caja'
      && !String(controller.activeTab).startsWith('inventario')
      && !String(controller.activeTab).startsWith('devolucion')
      && !String(controller.activeTab).startsWith('contabilidad');

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
            onCreateEvent={controller.handleCreateCalendarEvent}
            onPrintContractDocument={controller.handlePrintContractDocument}
          />
        )}

        {controller.activeTab === 'recibos' && (
          <RecibosSection
            receipts={controller.receipts}
            generatedReports={controller.generatedReports}
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
            currentUser={controller.currentUser}
            formatBs={formatBs}
            formatDate={formatDate}
            formatDateTime={formatDateTime}
            onOpenCashSession={controller.handleOpenCashSession}
            onCloseCashSession={controller.handleCloseCashSession}
            onCreateCashMovement={controller.handleCreateCashMovement}
            onVoidAndReplaceCashMovementReceipt={controller.handleVoidAndReplaceCashMovementReceipt}
            onCollectReceivable={controller.handleCollectReceivable}
            onPrintCashMovementReceipt={controller.handlePrintCashMovementReceipt}
          />
        )}

        {String(controller.activeTab).startsWith('inventario') && (
          <InventoryDashboardSection
            activeModule={controller.activeTab}
            items={controller.items}
            combos={controller.inventoryCombos}
            categories={controller.categories}
            contracts={controller.contracts}
            activeRentals={controller.activeRentals}
            cancelledRentals={controller.cancelledRentals}
            deliveries={controller.deliveries}
            stockRecoveries={controller.stockRecoveries}
            inventoryMovements={controller.inventoryMovements}
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
            onCreateCategory={controller.handleCreateCategory}
            onUpdateCategory={controller.handleUpdateCategory}
            onRemoveCategory={controller.handleRemoveCategory}
            onReloadData={controller.loadData}
            onOpenImage={controller.setImagePreview}
            onUpdateOrderOperational={controller.handleUpdateOrderOperational}
            onReceiveReturnedOrder={controller.handleReceiveReturnedOrder}
            onPrintInventoryWeekDocument={controller.handlePrintInventoryWeekDocument}
          />
        )}

        {controller.activeTab === 'alquiler' && (
          <ServiceOrdersSection
            quotes={controller.quotes}
            contracts={controller.contracts}
            rentals={controller.rentals}
            deliveries={controller.deliveries}
            supplierBundle={controller.supplierBundle}
            generatedReports={controller.generatedReports}
            clients={controller.clients}
            items={controller.items}
            combos={controller.inventoryCombos}
            vehicles={controller.vehicles}
            drivers={controller.drivers}
            users={controller.users}
            personnelBundle={controller.personnelBundle}
            currentUser={controller.currentUser}
            formatDate={formatDate}
            formatDateTime={formatDateTime}
            formatBs={formatBs}
            onCreateQuote={controller.handleCreateQuote}
            onUpdateQuote={controller.handleUpdateQuote}
            onRemoveQuote={controller.handleRemoveQuote}
            onApproveQuote={controller.handleApproveQuote}
            onUpdateOrderOperational={controller.handleUpdateOrderOperational}
            onCancelOrderContract={controller.handleCancelOrderContract}
            onCreateContract={controller.handleCreateContract}
            onUpdateContract={controller.handleUpdateContract}
            onRemoveContract={controller.handleRemoveContract}
            onCreateContractFromQuote={controller.handleCreateContractFromQuote}
            onCreateContractFromOrder={controller.handleCreateContractFromOrder}
            onApproveContract={controller.handleApproveContract}
            onGenerateOrderDocuments={controller.handleGenerateOrderDocuments}
            onCreateSupplier={controller.handleCreateSupplier}
            onCreateSupplierQuote={controller.handleCreateSupplierQuote}
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
            onPrintInventoryOrderDocument={controller.handlePrintInventoryOrderDocument}
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
    isDeveloper(controller.currentUser)
    && !developerCompanyChoice;

  if (isDeveloper(controller.currentUser) && developerCompanyChoice === 'lincon') {
    return (
      <Suspense fallback={<p className="status">Preparando Lincoln...</p>}>
        <LinconWorkspaceSection
          currentUser={controller.currentUser}
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
            activeTab={controller.activeTab}
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
          />

          <main className="app-content">
            <section className={controller.isCatalogView ? 'workspace workspace-inventory' : 'workspace'}>
              <Suspense fallback={<p className="status">Preparando vista...</p>}>
                {renderWorkspaceContent()}
              </Suspense>
            </section>
          </main>
        </section>
      </div>

      <MobileNavigation
        activeTab={controller.activeTab}
        allowedTabs={allowedTabRoots}
        notificationCounts={sidebarNotificationCounts}
        isOpen={isMobileMoreOpen}
        onToggleMore={() => setIsMobileMoreOpen((current) => !current)}
        onCloseMore={() => setIsMobileMoreOpen(false)}
        onChange={handleSidebarTabChange}
      />

      <ImageModal imagePreview={controller.imagePreview} onClose={() => controller.setImagePreview(null)} />

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
        <DeveloperCompanyModal onSelect={handleDeveloperCompanySelect} />
      ) : null}
    </div>
  );
}

export default App;
