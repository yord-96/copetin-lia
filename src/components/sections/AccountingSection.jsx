import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/api';
import { cashMovementMatchesContractReferences } from '../../utils/contractCashLinks';
import {
  getRentalReceivableEventDate,
  isRentalExcludedFromReceivables,
} from '../../utils/accountingRentals';
import { calculateReceivableBreakdown, getConfirmedContractLedgerPaidBs } from '../../utils/receivables';
import {
  calculateGuaranteePaidEvidence,
  calculateGuaranteeSettlement,
  getGuaranteeLedgerEvidence,
  getGuaranteeResolutionLabel,
  getStoredGuaranteeValidation,
} from '../../utils/guaranteeSettlement';

const getInputDate = (baseDate = new Date()) => {
  const cloned = new Date(baseDate);
  cloned.setMinutes(cloned.getMinutes() - cloned.getTimezoneOffset());
  return cloned.toISOString().slice(0, 10);
};

const toNumber = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sumBy = (rows, getter) => Number(rows.reduce((sum, row) => sum + toNumber(getter(row)), 0).toFixed(2));

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const getDateKey = (value) => {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return '';
  // Las fechas comerciales YYYY-MM-DD no tienen zona horaria. Convertirlas con
  // new Date() puede moverlas al dia anterior segun el huso horario del navegador.
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) return rawValue;
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return '';
  return getInputDate(parsed);
};

const getHourLabel = (value) => {
  const parsed = new Date(value ?? '');
  if (Number.isNaN(parsed.getTime())) return '--:--';
  return parsed.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const getLongHourLabel = (value) => {
  const parsed = new Date(value ?? '');
  if (Number.isNaN(parsed.getTime())) return '--:--';
  return parsed.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const getMonthKey = (value) => {
  const dateKey = getDateKey(value);
  return dateKey ? dateKey.slice(0, 7) : '';
};

const MONTH_SHORT_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const getMonthLabel = (monthKey) => {
  const [, month] = String(monthKey ?? '').split('-');
  const index = Number(month) - 1;
  return MONTH_SHORT_LABELS[index] ?? monthKey;
};

const getMonthStartInput = (dateKey) => {
  const parsed = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return getInputDate(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
};

const getPeriodRange = (dateKey, period) => {
  const parsed = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return { dateFrom: dateKey, dateTo: dateKey };
  if (period === 'month') {
    return {
      dateFrom: getInputDate(new Date(parsed.getFullYear(), parsed.getMonth(), 1)),
      dateTo: getInputDate(new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0)),
    };
  }
  if (period === 'week') {
    const day = parsed.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(parsed);
    monday.setDate(parsed.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { dateFrom: getInputDate(monday), dateTo: getInputDate(sunday) };
  }
  if (period === 'recent') {
    const dateFrom = new Date(parsed);
    dateFrom.setDate(dateFrom.getDate() - 89);
    return { dateFrom: getInputDate(dateFrom), dateTo: dateKey };
  }
  return { dateFrom: dateKey, dateTo: dateKey };
};

const isBigCash = (movement) => String(movement?.cashBoxType ?? '').toUpperCase() === 'BIG_CASH';
const isPettyCash = (movement) => String(movement?.cashBoxType ?? '').toUpperCase() === 'PETTY_CASH';
const isGuaranteeMovement = (movement) =>
  String(movement?.type ?? '').toLowerCase() === 'ingreso_garantia'
  || String(movement?.category ?? '').toLowerCase() === 'garantia';
const isConfirmedGuaranteeReturnMovement = (movement) =>
  normalizeText(movement?.accountingTag) === 'guarantee_refund'
  || normalizeText(movement?.category) === 'garantia_devuelta_manual'
  || normalizeText(movement?.type) === 'egreso_devolucion_garantia_manual';
const isOpeningCashMovement = (movement) =>
  normalizeText(movement?.type) === 'apertura'
  || normalizeText(movement?.category) === 'apertura'
  || normalizeText(movement?.accountingTag) === 'opening_balance';
const isVoidedCashMovement = (movement) =>
  String(movement?.receiptStatus ?? '').toLowerCase() === 'anulado'
  || Boolean(movement?.voidedAt);
const isArchivedAccountingRecord = (record) => Boolean(
  record?.deletedAt
  || record?.accountingArchivedAt
  || record?.accountingPeriodStatus === 'archived'
);
const isDeletedCashMovement = (movement) => Boolean(movement?.deletedAt);


const PAYMENT_METHOD_META = {
  efectivo: { label: 'Efectivo', shortLabel: 'EFE', className: 'cash' },
  qr: { label: 'QR', shortLabel: 'QR', className: 'qr' },
  transferencia: { label: 'Transferencia', shortLabel: 'TRF', className: 'transfer' },
  sin_metodo: { label: 'Sin metodo', shortLabel: 'S/M', className: 'missing' },
};
const QR_ACCOUNT_OPTIONS = ['CIDRE', 'BCP', 'MERCANTIL', 'BNB', 'BANCO FIE'];

const PETTY_EXPENSE_CATEGORIES = [
  { id: 'varios', label: 'Varios', className: 'misc', aliases: ['varios', 'otro', 'otros', 'misc'] },
  { id: 'servicios_basicos', label: 'Servicios Basicos', className: 'services', aliases: ['servicio', 'luz', 'agua', 'internet'] },
  { id: 'alimentacion', label: 'Alimentacion', className: 'food', aliases: ['almuerzo', 'comida', 'refrigerio'] },
  { id: 'taxis_pasajes', label: 'Taxis/Pasajes', className: 'mobility', aliases: ['taxi', 'pasaje', 'movilidad', 'transporte'] },
  { id: 'mante_camiones', label: 'Mante. Camiones', className: 'maintenance', aliases: ['mante', 'camion', 'reparacion', 'mantenimiento'] },
  { id: 'compras', label: 'Compras', className: 'purchase', aliases: ['compra'] },
  { id: 'anticipo_sueldos', label: 'Anticipo Sueldos', className: 'advance', aliases: ['adelanto', 'anticipo'] },
  { id: 'mate_limpieza', label: 'Mate. Limpieza', className: 'cleaning', aliases: ['limpieza', 'detergente'] },
  { id: 'intereses', label: 'Intereses', className: 'interest', aliases: ['interes'] },
  { id: 'eess_s_monica', label: 'EESS S. MONICA', className: 'fuel', aliases: ['eess', 'monica', 'combustible', 'gasolina'] },
  { id: 'sueldos', label: 'Sueldos', className: 'payroll', aliases: ['sueldo', 'salario'] },
];

const PETTY_DEBT_TYPES = {
  payable: {
    label: 'Deuda por pagar',
    shortLabel: 'Por pagar',
    className: 'pending',
  },
  lia_reimbursement: {
    label: 'Reembolso Sra. Lia',
    shortLabel: 'Por cobrar Lia',
    className: 'receivable',
  },
};

const createPettySectorPage = () => ({ rows: [], total: 0, hasMore: false, loading: false, error: '' });

const normalizeCashDebtKind = (value) => {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  if (normalized.includes('lia') || normalized.includes('reembolso') || normalized.includes('cobrar')) return 'lia_reimbursement';
  return 'payable';
};

const getCashDebtMeta = (debt) => PETTY_DEBT_TYPES[normalizeCashDebtKind(debt?.debtKind ?? debt?.kind ?? debt?.category)] ?? PETTY_DEBT_TYPES.payable;

const normalizePaymentMethod = (value) => {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  if (!normalized) return 'sin_metodo';
  if (normalized.includes('qr')) return 'qr';
  if (normalized.includes('transfer')) return 'transferencia';
  if (normalized.includes('efect')) return 'efectivo';
  return normalized;
};

const getPaymentMethodMeta = (value) => {
  const key = normalizePaymentMethod(value);
  return PAYMENT_METHOD_META[key] ?? {
    label: String(value ?? 'Otro').trim() || 'Otro',
    shortLabel: 'OTR',
    className: 'other',
  };
};

const getPaymentMethodLabel = (movement) => {
  const method = normalizePaymentMethod(movement?.paymentMethod);
  const meta = getPaymentMethodMeta(method);
  const account = String(movement?.paymentAccount ?? '').trim();
  return method === 'qr' && account ? `${meta.label} - ${account}` : meta.label;
};

const getCollectionConceptLabel = (movement) => {
  const target = normalizeText(movement?.collectionTarget ?? movement?.accountingTag ?? movement?.category ?? movement?.type);
  if (target.includes('damage') || target.includes('dano') || target.includes('faltante')) return 'Daños / faltantes';
  if (target.includes('transport')) return 'Transporte';
  if (target.includes('guarantee') || target.includes('garantia')) return 'Garantía';
  if (target.includes('rental') || target.includes('alquiler') || target.includes('contract') || target.includes('adelanto')) return 'Alquiler / contrato';
  return String(movement?.description ?? 'Cobro').trim() || 'Cobro';
};

const getReceivableCollectionReferences = (row) => ({
  key: String(row?.id ?? ''),
  contractIds: [row?.contractId],
  rentalIds: [row?.id],
  contractCodes: [row?.contractCode],
  orderCodes: [row?.orderCode],
  createdAtMs: Number(row?.contractCreatedAtMs ?? 0),
});

function CashIcon({ kind }) {
  if (kind === 'safe') {
    return <img className="asset-icon safe-asset-icon" src="/imagenes/caja-fuerte.png" alt="" aria-hidden="true" />;
  }

  if (kind === 'petty') {
    return <img className="asset-icon wallet-asset-icon" src="/imagenes/billetera.png" alt="" aria-hidden="true" />;
  }

  const paths = {
    big: (
      <>
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.8" />
      </>
    ),
    summary: (
      <>
        <rect x="6" y="5" width="12" height="14" rx="2" />
        <path d="M9 9h6M9 13h6" />
      </>
    ),
    flow: (
      <>
        <path d="M5 12h14" />
        <path d="m15 8 4 4-4 4" />
      </>
    ),
    table: (
      <>
        <rect x="4.5" y="5" width="15" height="14" rx="2" />
        <path d="M8 9h8M8 13h8" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {paths[kind] ?? paths.summary}
      </g>
    </svg>
  );
}

function MiniIcon({ kind }) {
  const paths = {
    calendar: (
      <>
        <rect x="5" y="6" width="14" height="13" rx="2" />
        <path d="M8 4v4M16 4v4M5 10h14" />
      </>
    ),
    report: (
      <>
        <path d="M7 4h8l3 3v13H7z" />
        <path d="M15 4v4h4M9.5 11h7M9.5 15h5" />
      </>
    ),
    chevron: (
      <>
        <path d="m8 10 4 4 4-4" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="5" />
        <path d="m15 15 4 4" />
      </>
    ),
    export: (
      <>
        <path d="M12 4v10" />
        <path d="m8 10 4 4 4-4" />
        <path d="M5 20h14" />
      </>
    ),
    more: (
      <>
        <path d="M12 6h.01M12 12h.01M12 18h.01" />
      </>
    ),
    up: (
      <>
        <path d="M12 19V5" />
        <path d="m7 10 5-5 5 5" />
      </>
    ),
    down: (
      <>
        <path d="M12 5v14" />
        <path d="m7 14 5 5 5-5" />
      </>
    ),
    chart: (
      <>
        <path d="M5 18h14" />
        <path d="M7 15v-4M12 15V7M17 15v-7" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 16v-4M12 8h.01" />
      </>
    ),
    cart: (
      <>
        <path d="M5 5h2l1.2 8.2a2 2 0 0 0 2 1.7h5.8a2 2 0 0 0 1.9-1.4L20 8H8" />
        <circle cx="10" cy="19" r="1" />
        <circle cx="17" cy="19" r="1" />
      </>
    ),
    lock: (
      <>
        <rect x="6" y="10" width="12" height="10" rx="2" />
        <path d="M9 10V7a3 3 0 0 1 6 0v3" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {paths[kind] ?? paths.report}
      </g>
    </svg>
  );
}

function AccountingSection({
  activeModule = 'contabilidad',
  clients = [],
  personnelBundle = { employees: [] },
  cashSummary = null,
  cashMovements = [],
  cashDebts = [],
  cashReturnIssues = [],
  cashMovementMeta = { total: 0, visible: 0, truncated: false },
  operationsLoading = false,
  cashSessions = [],
  rentals = [],
  contracts = [],
  hiddenContracts = [],
  supplierBundle = { suppliers: [], quotes: [], loans: [] },
  currentUser = null,
  formatBs,
  formatDate,
  formatDateTime,
  onOpenCashSession,
  onCloseCashSession,
  onCreateCashMovement,
  onUpdatePettyExpense,
  onDeletePettyExpense,
  onCreateCashDebt,
  onPayCashDebt,
  onDeleteCashDebt,
  onUpdateSupplierLoanStatus,
  onVoidAndReplaceCashMovementReceipt,
  onCollectReceivable,
  onPrintCashMovementReceipt,
}) {
  const [selectedDate, setSelectedDate] = useState(() => getInputDate());
  const [visibleRows, setVisibleRows] = useState({ incomes: 5, transfers: 5, expenses: 5 });
  const [bigCashTypeFilter, setBigCashTypeFilter] = useState('all');
  const [bigCashPeriod, setBigCashPeriod] = useState('recent');
  const [bigCashQuery, setBigCashQuery] = useState('');
  const [bigCashWorkspaceTab, setBigCashWorkspaceTab] = useState('summary');
  const [bigCashWorkspaceQuery, setBigCashWorkspaceQuery] = useState('');
  const [receivablesView, setReceivablesView] = useState('pending');
  const [guaranteesView, setGuaranteesView] = useState('pending');
  const [returnIssuesView, setReturnIssuesView] = useState('pending');
  const [isExportingGuarantees, setIsExportingGuarantees] = useState(false);
  const [showReturnIssuesReport, setShowReturnIssuesReport] = useState(false);
  const [isExportingReturnIssues, setIsExportingReturnIssues] = useState(false);
  const [expandedFinalizedReceivableId, setExpandedFinalizedReceivableId] = useState('');
  const [showFinalizedReceivablesReport, setShowFinalizedReceivablesReport] = useState(false);
  const [isExportingFinalizedReceivables, setIsExportingFinalizedReceivables] = useState(false);
  const [exactFinalizedCollections, setExactFinalizedCollections] = useState({});
  const [loadingFinalizedCollectionIds, setLoadingFinalizedCollectionIds] = useState([]);
  const [finalizedCollectionsError, setFinalizedCollectionsError] = useState('');
  const [vipTopUpModalOpen, setVipTopUpModalOpen] = useState(false);
  const [vipTopUpSubmitting, setVipTopUpSubmitting] = useState(false);
  const [vipTopUpError, setVipTopUpError] = useState('');
  const [vipTopUpForm, setVipTopUpForm] = useState(() => ({ clientId: '', date: getInputDate(), amountBs: '', paymentMethod: 'efectivo', paymentAccount: '', reason: '', notes: '' }));
  const [vipReportClientId, setVipReportClientId] = useState('');
  const [showVipReport, setShowVipReport] = useState(false);
  const [isExportingVipReport, setIsExportingVipReport] = useState(false);
  const [accountLedgerKey, setAccountLedgerKey] = useState('all');
  const [accountLedgerData, setAccountLedgerData] = useState({
    accounts: [],
    rows: [],
    total: 0,
    summary: { incomeBs: 0, outBs: 0, netBs: 0 },
    loading: false,
    error: '',
  });
  const [receiptBrowserView, setReceiptBrowserView] = useState('gallery');
  const [receiptBrowserAccountKey, setReceiptBrowserAccountKey] = useState('all');
  const [receiptBrowserData, setReceiptBrowserData] = useState({
    accounts: [],
    rows: [],
    total: 0,
    loading: false,
    error: '',
  });
  const [bigCashWorkspaceRanges, setBigCashWorkspaceRanges] = useState(() => {
    const today = getInputDate();
    const recent = getPeriodRange(today, 'recent');
    return {
      summary: { dateFrom: recent.dateFrom, dateTo: recent.dateTo },
      accounts: { dateFrom: recent.dateFrom, dateTo: recent.dateTo },
      receipts: { dateFrom: recent.dateFrom, dateTo: recent.dateTo },
      receivables: { dateFrom: '', dateTo: '' },
      guarantees: { dateFrom: '', dateTo: '' },
      issues: { dateFrom: '', dateTo: '' },
      prepaid: { dateFrom: '', dateTo: '' },
      movements: { dateFrom: recent.dateFrom, dateTo: recent.dateTo },
    };
  });
  const [pettyCashTypeFilter, setPettyCashTypeFilter] = useState('all');
  const [pettyCashQuery, setPettyCashQuery] = useState('');
  const [pettyWorkspaceTab, setPettyWorkspaceTab] = useState('expenses');
  const [isPettyHistoryOpen, setIsPettyHistoryOpen] = useState(false);
  const [pettyHistorySource, setPettyHistorySource] = useState(null);
  const [pettyHistoryLoading, setPettyHistoryLoading] = useState(false);
  const [pettyHistoryError, setPettyHistoryError] = useState('');
  const [pettyHistoryMeta, setPettyHistoryMeta] = useState({ total: 0, hasMore: false, summary: null });
  const [pettySectorPages, setPettySectorPages] = useState(() => ({
    expenses: createPettySectorPage(),
    advances: createPettySectorPage(),
    suppliers: createPettySectorPage(),
    debts: createPettySectorPage(),
  }));
  const pettySectorRequestRef = useRef({});
  const [pettyHistoryFilters, setPettyHistoryFilters] = useState({
    dateFrom: '',
    dateTo: '',
    movement: 'all',
    category: 'all',
    query: '',
  });
  const [cashModal, setCashModal] = useState(null);
  const [editingPettyExpense, setEditingPettyExpense] = useState(null);
  const [advancePersonnelOptions, setAdvancePersonnelOptions] = useState([]);
  const [advancePersonnelLoading, setAdvancePersonnelLoading] = useState(false);
  const [advancePersonnelError, setAdvancePersonnelError] = useState('');
  const [bigCashListModal, setBigCashListModal] = useState(null);
  const [bigCashListQuery, setBigCashListQuery] = useState('');
  const [bigCashListMonth, setBigCashListMonth] = useState('');
  const [voidReceiptModal, setVoidReceiptModal] = useState(null);
  const [voidReceiptStep, setVoidReceiptStep] = useState('reason');
  const [voidReceiptReason, setVoidReceiptReason] = useState('');
  const [voidReceiptForm, setVoidReceiptForm] = useState({
    amountBs: '',
    description: '',
    category: '',
    paymentMethod: 'efectivo',
    paymentAccount: '',
    responsible: '',
    receipt: '',
    notes: '',
    linkedRentalId: '',
    debtId: '',
    supplierLoanId: '',
    debtKind: 'payable',
    debtDate: '',
    dueDate: '',
    employeeId: '',
    documentId: '',
    requestDate: '',
  });
  const [cashForm, setCashForm] = useState({
    amountBs: '',
    description: '',
    category: 'varios',
    paymentMethod: 'efectivo',
    paymentAccount: '',
    responsible: '',
    receipt: '',
    notes: '',
    linkedRentalId: '',
    debtId: '',
    supplierLoanId: '',
    debtKind: 'payable',
    debtDate: '',
    dueDate: '',
    employeeId: '',
    documentId: '',
    requestDate: '',
  });
  const [collectModal, setCollectModal] = useState(null);
  const [collectForm, setCollectForm] = useState({ amountBs: '', paymentMethod: 'efectivo', paymentAccount: '', receipt: '', note: '' });
  const [guaranteeRefundModal, setGuaranteeRefundModal] = useState(null);
  const [guaranteeRefundForm, setGuaranteeRefundForm] = useState({ paymentMethod: 'efectivo', paymentAccount: '', note: '' });
  const [isSubmittingCash, setIsSubmittingCash] = useState(false);
  const [cashActionError, setCashActionError] = useState('');
  const [cashActionFeedback, setCashActionFeedback] = useState('');
  const [debtActionMenuId, setDebtActionMenuId] = useState('');
  const [pettyExpenseActionMenuId, setPettyExpenseActionMenuId] = useState('');
  const [advancePeopleQuery, setAdvancePeopleQuery] = useState('');
  const cashSubmitLockRef = useRef(false);

  const loadAccountLedger = useCallback(async () => {
    const range = bigCashWorkspaceRanges.accounts ?? {};
    setAccountLedgerData((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await api.cash.getAccountLedger({
        accountKey: accountLedgerKey,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        query: bigCashWorkspaceQuery,
        limit: 600,
      });
      setAccountLedgerData({
        accounts: Array.isArray(result?.accounts) ? result.accounts : [],
        rows: Array.isArray(result?.rows) ? result.rows : [],
        total: Number(result?.total ?? 0),
        summary: result?.summary ?? { incomeBs: 0, outBs: 0, netBs: 0 },
        loading: false,
        error: '',
      });
    } catch (error) {
      setAccountLedgerData((current) => ({
        ...current,
        loading: false,
        error: error?.message || 'No se pudo cargar el movimiento de la cuenta.',
      }));
    }
  }, [accountLedgerKey, bigCashWorkspaceQuery, bigCashWorkspaceRanges]);

  const loadReceiptBrowser = useCallback(async () => {
    const range = bigCashWorkspaceRanges.receipts ?? {};
    setReceiptBrowserData((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await api.cash.getReceiptProofs({
        accountKey: receiptBrowserAccountKey,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        query: bigCashWorkspaceQuery,
        limit: 160,
      });
      setReceiptBrowserData({
        accounts: Array.isArray(result?.accounts) ? result.accounts : [],
        rows: Array.isArray(result?.rows) ? result.rows : [],
        total: Number(result?.total ?? 0),
        loading: false,
        error: '',
      });
    } catch (error) {
      setReceiptBrowserData((current) => ({
        ...current,
        loading: false,
        error: error?.message || 'No se pudieron cargar los comprobantes.',
      }));
    }
  }, [bigCashWorkspaceQuery, bigCashWorkspaceRanges, receiptBrowserAccountKey]);

  useEffect(() => {
    if (bigCashWorkspaceTab !== 'accounts') return undefined;
    const timer = window.setTimeout(() => { loadAccountLedger(); }, 180);
    return () => window.clearTimeout(timer);
  }, [bigCashWorkspaceTab, loadAccountLedger]);

  useEffect(() => {
    if (bigCashWorkspaceTab !== 'receipts') return undefined;
    const timer = window.setTimeout(() => { loadReceiptBrowser(); }, 180);
    return () => window.clearTimeout(timer);
  }, [bigCashWorkspaceTab, loadReceiptBrowser]);

  const loadPettySector = useCallback(async (sector, { append = false, offset = 0, filters = {} } = {}) => {
    const requestId = (pettySectorRequestRef.current[sector] ?? 0) + 1;
    pettySectorRequestRef.current[sector] = requestId;
    setPettySectorPages((current) => ({
      ...current,
      [sector]: { ...current[sector], loading: true, error: '' },
    }));
    try {
      const result = await api.cash.getPettySector({ sector, offset, limit: 80, ...filters });
      if (pettySectorRequestRef.current[sector] !== requestId) return;
      setPettySectorPages((current) => ({
        ...current,
        [sector]: {
          rows: append ? [...current[sector].rows, ...(result?.rows ?? [])] : (result?.rows ?? []),
          total: Number(result?.total ?? 0),
          hasMore: Boolean(result?.hasMore),
          loading: false,
          error: '',
        },
      }));
    } catch (sectorError) {
      if (pettySectorRequestRef.current[sector] !== requestId) return;
      setPettySectorPages((current) => ({
        ...current,
        [sector]: {
          ...current[sector],
          loading: false,
          error: sectorError?.message || 'No se pudo cargar esta sección.',
        },
      }));
    }
  }, []);

  const loadPettyHistoryPage = useCallback(async ({ append = false, offset = 0, filters = {} } = {}) => {
    const requestId = (pettySectorRequestRef.current.history ?? 0) + 1;
    pettySectorRequestRef.current.history = requestId;
    setPettyHistoryLoading(true);
    setPettyHistoryError('');
    try {
      const result = await api.cash.getPettySector({ sector: 'history', offset, limit: 80, ...filters });
      if (pettySectorRequestRef.current.history !== requestId) return;
      setPettyHistorySource((current) => (
        append ? [...(Array.isArray(current) ? current : []), ...(result?.rows ?? [])] : (result?.rows ?? [])
      ));
      setPettyHistoryMeta({
        total: Number(result?.total ?? 0),
        hasMore: Boolean(result?.hasMore),
        summary: result?.summary ?? null,
      });
    } catch (historyError) {
      if (pettySectorRequestRef.current.history !== requestId) return;
      if (!append) setPettyHistorySource([]);
      setPettyHistoryError(historyError?.message || 'No se pudo cargar el historial de Caja Chica.');
    } finally {
      if (pettySectorRequestRef.current.history === requestId) setPettyHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeModule !== 'contabilidad_caja_chica') return undefined;
    const timer = setTimeout(() => {
      if (pettyWorkspaceTab === 'expenses') {
        void loadPettySector('expenses', {
          filters: {
            category: pettyCashTypeFilter,
            query: pettyCashQuery,
          },
        });
        return;
      }
      void loadPettySector(pettyWorkspaceTab);
    }, pettyWorkspaceTab === 'expenses' && pettyCashQuery ? 250 : 0);
    return () => clearTimeout(timer);
  }, [activeModule, loadPettySector, pettyCashQuery, pettyCashTypeFilter, pettyWorkspaceTab]);

  useEffect(() => {
    if (!isPettyHistoryOpen) return undefined;
    const timer = setTimeout(() => {
      void loadPettyHistoryPage({ filters: pettyHistoryFilters });
    }, pettyHistoryFilters.query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [isPettyHistoryOpen, loadPettyHistoryPage, pettyHistoryFilters]);

  const beginCashSubmit = () => {
    if (cashSubmitLockRef.current) return false;
    cashSubmitLockRef.current = true;
    setIsSubmittingCash(true);
    return true;
  };

  const endCashSubmit = () => {
    cashSubmitLockRef.current = false;
    setIsSubmittingCash(false);
  };

  const rentalById = useMemo(() => new Map(rentals.map((rental) => [rental.id, rental])), [rentals]);
  const personnelEmployees = useMemo(() => {
    const source = advancePersonnelOptions.length > 0
      ? advancePersonnelOptions
      : (personnelBundle?.employees ?? []);
    return source
      .filter((employee) => !employee?.deletedAt && String(employee?.status ?? 'active') !== 'inactive')
      .slice()
      .sort((a, b) => String(a?.fullName ?? '').localeCompare(String(b?.fullName ?? ''), 'es'));
  }, [advancePersonnelOptions, personnelBundle?.employees]);
  const filteredAdvanceEmployees = useMemo(() => {
    const query = normalizeText(advancePeopleQuery);
    if (!query) return personnelEmployees.slice(0, 8);
    return personnelEmployees
      .filter((employee) => {
        const haystack = [
          employee.fullName,
          employee.documentId,
          employee.employeeCode,
          employee.position,
          employee.department,
        ].map(normalizeText).join(' ');
        return haystack.includes(query);
      })
      .slice(0, 10);
  }, [advancePeopleQuery, personnelEmployees]);
  const contractByRentalId = useMemo(() => {
    const map = new Map();
    contracts.forEach((contract) => {
      if (contract?.rentalId) map.set(contract.rentalId, contract);
    });
    return map;
  }, [contracts]);
  const contractById = useMemo(() => new Map(contracts.map((contract) => [contract.id, contract])), [contracts]);
  const contractByOrderCode = useMemo(() => new Map(
    contracts
      .filter((contract) => contract?.orderCode)
      .map((contract) => [String(contract.orderCode), contract]),
  ), [contracts]);
  const receivableExcludedRentalIds = useMemo(() => new Set(
    rentals
      .filter((rental) => isRentalExcludedFromReceivables(rental, hiddenContracts, contracts))
      .map((rental) => String(rental?.id ?? rental?.rentalId ?? ''))
      .filter(Boolean),
  ), [contracts, hiddenContracts, rentals]);

  const prepaidClientRows = useMemo(
    () => clients
      .filter((client) => Boolean(client?.prepaidEnabled))
      .map((client) => {
        const movements = Array.isArray(client?.prepaidMovements) ? client.prepaidMovements : [];
        const lastMovement = movements
          .slice()
          .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0))[0] ?? null;
        return {
          id: client.id,
          client,
          movements,
          name: client.name ?? client.companyName ?? 'Cliente VIP',
          phone: client.whatsapp ?? client.phone ?? '',
          balanceBs: Math.max(0, toNumber(client.prepaidBalanceBs)),
          depositedBs: Math.max(0, toNumber(client.prepaidTotalDepositedBs)),
          usedBs: Math.max(0, toNumber(client.prepaidTotalUsedBs)),
          lastMovement,
        };
      })
      .sort((a, b) => b.balanceBs - a.balanceBs || a.name.localeCompare(b.name, 'es')),
    [clients],
  );

  const prepaidLedgerRows = useMemo(
    () => prepaidClientRows
      .flatMap((entry) => entry.movements.map((movement) => {
        const rental = movement?.sourceType === 'rental'
          ? rentalById.get(String(movement.sourceId ?? ''))
          : null;
        const contract = rental?.contractId
          ? contractById.get(String(rental.contractId))
          : rental?.id
          ? contractByRentalId.get(rental.id)
          : null;
        return {
          id: movement.id ?? `${entry.id}-${movement.createdAt}-${movement.amountBs}`,
          client: entry.client,
          customerName: entry.name,
          movement,
          rental,
          contract,
          amountBs: toNumber(movement.amountBs),
          balanceAfterBs: toNumber(movement.balanceAfterBs),
          createdAt: movement.createdAt,
          description: movement.description ?? '',
          paymentMethodLabel: movement?.paymentMethod
            ? (movement.paymentMethod === 'qr' ? `QR${movement.paymentAccount ? ` - ${movement.paymentAccount}` : ''}` : movement.paymentMethod === 'transferencia' ? 'Transferencia' : 'Efectivo')
            : '',
          receiptCode: movement?.cashReceiptCode ?? '',
          reference: contract?.contractCode ?? rental?.contractCode ?? movement.orderCode ?? rental?.orderCode ?? '-',
          eventDate: contract?.eventDate ?? rental?.rentalDate ?? '',
        };
      }))
      .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0)),
    [contractById, contractByRentalId, prepaidClientRows, rentalById],
  );

  const prepaidChargeByRentalId = useMemo(() => {
    const map = new Map();
    prepaidLedgerRows.forEach((row) => {
      if (row.amountBs >= 0) return;
      const rentalId = String(row?.rental?.id ?? row?.movement?.sourceId ?? '').trim();
      if (!rentalId) return;
      map.set(rentalId, Number(((map.get(rentalId) ?? 0) + Math.abs(toNumber(row.amountBs))).toFixed(2)));
    });
    return map;
  }, [prepaidLedgerRows]);

  const getRentalReceivableBreakdown = useCallback((rental, contract = null) => {
    const storedPendingBs = Math.max(0, toNumber(rental?.payment?.pendingPaymentBs ?? rental?.totals?.pendingPaymentBs));
    const vipChargedBs = Math.max(0, toNumber(prepaidChargeByRentalId.get(String(rental?.id ?? ''))));
    const totalBs = Math.max(
      0,
      toNumber(rental?.totals?.totalBs),
      toNumber(contract?.totals?.totalBs ?? contract?.totalBs),
    );
    if (totalBs <= 0) {
      return {
        totalBs: 0, paidBs: 0, contractPendingBs: storedPendingBs, transportPendingBs: 0,
        damagePendingBs: 0, commercialPendingBs: storedPendingBs, totalPendingBs: storedPendingBs,
        status: storedPendingBs > 0.009 ? 'pending' : 'paid',
      };
    }
    const storedPrepaidBs = Math.max(
      0,
      toNumber(rental?.payment?.prepaidAppliedBs),
      toNumber(rental?.totals?.prepaidAppliedBs),
      toNumber(rental?.prepaidAppliedBs),
      toNumber(contract?.payment?.prepaidAppliedBs),
      toNumber(contract?.prepaidAppliedBs),
      vipChargedBs,
    );
    const storedPaidBs = Math.max(
      0,
      toNumber(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs),
      toNumber(contract?.payment?.paidAtApprovalBs),
    );
    const effectiveStoredPaidBs = storedPaidBs + 0.01 >= storedPrepaidBs
      ? storedPaidBs
      : Number((storedPaidBs + vipChargedBs).toFixed(2));
    const ledgerPaidBs = getConfirmedContractLedgerPaidBs(contract, totalBs);
    return calculateReceivableBreakdown({
      rental,
      contract,
      confirmedCommercialPaidBs: Math.max(
        effectiveStoredPaidBs,
        Number((ledgerPaidBs + vipChargedBs).toFixed(2)),
      ),
    });
  }, [prepaidChargeByRentalId]);

  const getVipAdjustedPendingBs = useCallback(
    (rental, contract = null) => getRentalReceivableBreakdown(rental, contract).totalPendingBs,
    [getRentalReceivableBreakdown],
  );

  const totalPrepaidBalanceBs = useMemo(
    () => sumBy(prepaidClientRows, (row) => row.balanceBs),
    [prepaidClientRows],
  );
  const totalPrepaidUsedBs = useMemo(
    () => sumBy(prepaidClientRows, (row) => row.usedBs),
    [prepaidClientRows],
  );

  const transportContractOptions = useMemo(
    () => rentals
      .filter((rental) => !rental?.deletedAt && String(rental?.status ?? '').toLowerCase() !== 'cancelled')
      .map((rental) => {
        const contract = contractByRentalId.get(rental.id);
        const deliveryFeeBs = toNumber(rental?.deliveryFeeBs ?? rental?.totals?.deliveryFeeBs);
        return {
          rentalId: rental.id,
          contractId: rental.contractId ?? contract?.id ?? '',
          orderCode: rental.orderCode ?? rental.id,
          contractCode: rental.contractCode ?? contract?.contractCode ?? '',
          customerName: rental.customerName ?? 'Cliente',
          eventType: rental.eventType ?? contract?.eventType ?? '',
          deliveryFeeBs,
        };
      })
      .sort((a, b) => new Date(rentalById.get(b.rentalId)?.createdAt ?? 0) - new Date(rentalById.get(a.rentalId)?.createdAt ?? 0)),
    [contractByRentalId, rentalById, rentals],
  );

  const sortedMovements = useMemo(
    () => cashMovements
      .filter((movement) => !isArchivedAccountingRecord(movement))
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [cashMovements],
  );

  const postedMovements = useMemo(
    () => sortedMovements.filter((movement) => !isVoidedCashMovement(movement)),
    [sortedMovements],
  );

  const sortedCashDebts = useMemo(
    () => cashDebts
      .filter((debt) => !isArchivedAccountingRecord(debt))
      .slice()
      .sort((a, b) => new Date(b.createdAt ?? b.debtDate ?? 0) - new Date(a.createdAt ?? a.debtDate ?? 0)),
    [cashDebts],
  );

  const pendingCashDebts = useMemo(
    () => sortedCashDebts.filter((debt) => normalizeCashDebtKind(debt?.debtKind ?? debt?.kind ?? debt?.category) === 'payable' && Number(debt?.balanceBs ?? debt?.amountBs ?? 0) > 0),
    [sortedCashDebts],
  );

  const normalizeSupplierLoanRow = useCallback((loan) => {
    const totalBs = toNumber(loan?.totals?.totalBs ?? loan?.totalBs);
    const contract = loan?.sourceContractId ? contractById.get(String(loan.sourceContractId)) : null;
    const rental = loan?.sourceRentalId ? rentalById.get(String(loan.sourceRentalId)) : null;
    const reference = contract?.contractCode ?? rental?.contractCode ?? loan?.sourceOrderCode ?? '-';
    const items = Array.isArray(loan?.items) ? loan.items : [];
    const statusKey = normalizeText(loan?.status || 'programado');
    return {
      ...loan,
      totalBs,
      items,
      reference,
      itemSummary: items.slice(0, 2).map((item) => `${item.quantity}x ${item.itemName}`).join(' | '),
      isPaid: ['liquidado', 'pagado', 'cerrado'].includes(statusKey),
      requestDate: loan?.requestDate || loan?.createdAt,
    };
  }, [contractById, rentalById]);

  const supplierLoanRows = useMemo(
    () => (supplierBundle?.loans ?? [])
      .filter((loan) => !loan?.deletedAt)
      .map(normalizeSupplierLoanRow)
      .sort((a, b) => Number(a.isPaid) - Number(b.isPaid) || new Date(b.createdAt ?? b.requestDate ?? 0) - new Date(a.createdAt ?? a.requestDate ?? 0)),
    [normalizeSupplierLoanRow, supplierBundle?.loans],
  );

  const pagedSupplierLoanRows = useMemo(
    () => pettySectorPages.suppliers.rows.map(normalizeSupplierLoanRow),
    [normalizeSupplierLoanRow, pettySectorPages.suppliers.rows],
  );

  const pendingSupplierLoanRows = useMemo(
    () => supplierLoanRows.filter((loan) => !loan.isPaid && loan.totalBs > 0),
    [supplierLoanRows],
  );

  const bigCashPositiveRows = useMemo(
    () => postedMovements.filter((movement) => isBigCash(movement) && !movement.isInternalTransfer && toNumber(movement.amountBs) > 0),
    [postedMovements],
  );

  const bigCashGuaranteeRows = useMemo(
    () => bigCashPositiveRows.filter(isGuaranteeMovement),
    [bigCashPositiveRows],
  );

  const bigCashIncomeRows = useMemo(
    () => bigCashPositiveRows.filter((movement) => !isGuaranteeMovement(movement) && !isOpeningCashMovement(movement)),
    [bigCashPositiveRows],
  );

  const pettyTransfersRows = useMemo(
    () => postedMovements.filter((movement) => isPettyCash(movement) && movement.isInternalTransfer && toNumber(movement.amountBs) > 0),
    [postedMovements],
  );

  const visiblePettyExpenseRows = useMemo(
    () => sortedMovements.filter((movement) => isPettyCash(movement) && !movement.isInternalTransfer && toNumber(movement.amountBs) < 0),
    [sortedMovements],
  );

  const bigCashMovementRows = useMemo(
    () => sortedMovements.filter((movement) => isBigCash(movement)),
    [sortedMovements],
  );

  const dayBigCashIncomeRows = useMemo(
    () => bigCashIncomeRows.filter((movement) => getDateKey(movement.createdAt) === selectedDate),
    [bigCashIncomeRows, selectedDate],
  );

  const dayBigIncomeBs = useMemo(
    () => sumBy(dayBigCashIncomeRows, (movement) => movement.amountBs),
    [dayBigCashIncomeRows],
  );

  const dayTransfersToPettyBs = useMemo(
    () => Math.abs(sumBy(pettyTransfersRows.filter((movement) => getDateKey(movement.createdAt) === selectedDate), (movement) => movement.amountBs)),
    [pettyTransfersRows, selectedDate],
  );

  const dayPettyExpensesRows = useMemo(
    () => visiblePettyExpenseRows.filter((movement) => getDateKey(movement.createdAt) === selectedDate),
    [visiblePettyExpenseRows, selectedDate],
  );

  const dayPettyExpenseBs = useMemo(
    () => Math.abs(sumBy(dayPettyExpensesRows.filter((movement) => !isVoidedCashMovement(movement)), (movement) => movement.amountBs)),
    [dayPettyExpensesRows],
  );

  const dayPettyOpeningBs = useMemo(() => {
    const openingRows = postedMovements.filter(
      (movement) => isPettyCash(movement)
        && String(movement.type ?? '').toLowerCase() === 'apertura'
        && getDateKey(movement.createdAt) === selectedDate,
    );
    return sumBy(openingRows, (movement) => movement.amountBs);
  }, [postedMovements, selectedDate]);

  const pettyLedgerThroughSelectedDate = useMemo(
    () => postedMovements.filter((movement) => (
      isPettyCash(movement)
      && getDateKey(movement.createdAt) <= selectedDate
    )),
    [postedMovements, selectedDate],
  );

  const pettyReceivedToDateBs = useMemo(
    () => sumBy(
      pettyLedgerThroughSelectedDate.filter((movement) => toNumber(movement.amountBs) > 0),
      (movement) => movement.amountBs,
    ),
    [pettyLedgerThroughSelectedDate],
  );

  const pettySpentToDateBs = useMemo(
    () => Math.abs(sumBy(
      pettyLedgerThroughSelectedDate.filter((movement) => toNumber(movement.amountBs) < 0),
      (movement) => movement.amountBs,
    )),
    [pettyLedgerThroughSelectedDate],
  );

  const pettyBalanceBeforeSelectedDateBs = useMemo(
    () => sumBy(
      postedMovements.filter((movement) => (
        isPettyCash(movement)
        && getDateKey(movement.createdAt) < selectedDate
      )),
      (movement) => movement.amountBs,
    ),
    [postedMovements, selectedDate],
  );

  const selectedDayPettyNetBs = Number((dayTransfersToPettyBs - dayPettyExpenseBs).toFixed(2));
  const selectedDayPettyClosingBs = Number((pettyBalanceBeforeSelectedDateBs + selectedDayPettyNetBs).toFixed(2));
  const pettyIncomeCountToDate = pettyLedgerThroughSelectedDate.filter((movement) => toNumber(movement.amountBs) > 0).length;
  const pettyExpenseCountToDate = pettyLedgerThroughSelectedDate.filter((movement) => toNumber(movement.amountBs) < 0).length;

  const bigCashBalanceBs = toNumber(cashSummary?.bigCashBalanceBs ?? 0);
  const pettyCashBalanceBs = toNumber(cashSummary?.pettyCashBalanceBs ?? 0);
  const selectedMonthKey = getMonthKey(`${selectedDate}T12:00:00`);
  const monthStartDate = getMonthStartInput(selectedDate);
  const currentUserName = currentUser?.fullName || currentUser?.name || currentUser?.username || 'Contabilidad';
  const isDeveloperUser = useMemo(() => {
    const roles = [
      ...(Array.isArray(currentUser?.roleIds) ? currentUser.roleIds : []),
      currentUser?.roleId,
      currentUser?.role,
    ];
    return roles.some((role) => normalizeText(role).replace(/\s+/g, '_').includes('developer'));
  }, [currentUser]);
  const bigCashPeriodRange = bigCashWorkspaceRanges.summary;
  const bigCashMovementRange = bigCashWorkspaceRanges.movements;
  const monthBigCashIncomeRows = useMemo(
    () => bigCashIncomeRows.filter((movement) => getMonthKey(movement.createdAt) === selectedMonthKey),
    [bigCashIncomeRows, selectedMonthKey],
  );
  const monthBigCashTransferRows = useMemo(
    () => pettyTransfersRows.filter((movement) => getMonthKey(movement.createdAt) === selectedMonthKey),
    [pettyTransfersRows, selectedMonthKey],
  );
  const monthTransportRevenueRows = useMemo(
    () => postedMovements.filter((movement) => {
      const dateKey = getDateKey(movement.createdAt);
      const matchesRange = (!bigCashPeriodRange.dateFrom || dateKey >= bigCashPeriodRange.dateFrom)
        && (!bigCashPeriodRange.dateTo || dateKey <= bigCashPeriodRange.dateTo);
      return matchesRange && (
          toNumber(movement?.transportRevenueBs) > 0
          ||
          String(movement?.accountingTag ?? '') === 'transport_revenue'
          || String(movement?.category ?? '').toLowerCase() === 'transporte_cobrado'
          || String(movement?.type ?? '').toLowerCase() === 'ingreso_transporte_cliente'
        );
    }),
    [bigCashPeriodRange, postedMovements],
  );
  const monthTransportExpenseRows = useMemo(
    () => postedMovements.filter((movement) => {
      const dateKey = getDateKey(movement.createdAt);
      const matchesRange = (!bigCashPeriodRange.dateFrom || dateKey >= bigCashPeriodRange.dateFrom)
        && (!bigCashPeriodRange.dateTo || dateKey <= bigCashPeriodRange.dateTo);
      return matchesRange
        && isPettyCash(movement)
        && toNumber(movement.amountBs) < 0
        && (
          toNumber(movement?.transportExpenseBs) > 0
          ||
          String(movement?.accountingTag ?? '') === 'transport_expense'
          || (
            Boolean(movement?.linkedRentalId || movement?.linkedOrderCode || movement?.linkedContractId)
            && ['movilidad', 'transporte'].includes(String(movement?.category ?? '').toLowerCase())
          ));
    }),
    [bigCashPeriodRange, postedMovements],
  );
  const monthTransportRevenueBs = useMemo(
    () => sumBy(monthTransportRevenueRows, (movement) => toNumber(movement.transportRevenueBs) > 0 ? movement.transportRevenueBs : movement.amountBs),
    [monthTransportRevenueRows],
  );
  const monthTransportExpenseBs = useMemo(
    () => sumBy(monthTransportExpenseRows, (movement) => toNumber(movement.transportExpenseBs) > 0 ? movement.transportExpenseBs : Math.abs(toNumber(movement.amountBs))),
    [monthTransportExpenseRows],
  );
  const monthTransportMarginBs = Number((monthTransportRevenueBs - monthTransportExpenseBs).toFixed(2));
  const getMovementReference = useCallback((movement) => {
    if (movement?.linkedRentalId) {
      const linkedRental = rentalById.get(movement.linkedRentalId);
      const linkedContract = contractByRentalId.get(movement.linkedRentalId);
      if (linkedContract?.contractCode) return linkedContract.contractCode;
      if (linkedRental?.contractCode) return linkedRental.contractCode;
      if (linkedRental?.orderCode) return linkedRental.orderCode;
    }
    if (movement?.linkedContractId) {
      const linkedContract = contractById.get(String(movement.linkedContractId));
      if (linkedContract?.contractCode) return linkedContract.contractCode;
    }
    if (movement?.contractCode) return movement.contractCode;
    if (movement?.linkedOrderCode) {
      const linkedContract = contractByOrderCode.get(String(movement.linkedOrderCode));
      if (linkedContract?.contractCode) return linkedContract.contractCode;
      return movement.linkedOrderCode;
    }
    const sourceId = String(movement?.sourceId ?? '').trim();
    if (!sourceId) return movement?.receipt || '-';
    const rental = rentalById.get(sourceId);
    const contract = contractByRentalId.get(sourceId);
    if (contract?.contractCode) return contract.contractCode;
    if (rental?.contractCode) return rental.contractCode;
    if (rental?.orderCode) return rental.orderCode;
    return movement?.receipt || sourceId;
  }, [contractById, contractByOrderCode, contractByRentalId, rentalById]);

  const getMovementUserLabel = useCallback((movement) => {
    const directUser = String(movement?.responsible || movement?.createdBy || '').trim();
    if (directUser && normalizeText(directUser) !== 'sistema') return directUser;

    const linkedRental = movement?.linkedRentalId ? rentalById.get(movement.linkedRentalId) : null;
    const linkedContract = movement?.linkedContractId
      ? contractById.get(movement.linkedContractId)
      : linkedRental
      ? contractByRentalId.get(linkedRental.id)
      : null;
    const primaryResponsible = Array.isArray(linkedContract?.responsibles) ? linkedContract.responsibles[0] : null;
    const resolved = String(
      primaryResponsible?.name
      ?? linkedContract?.createdByName
      ?? linkedRental?.createdByName
      ?? linkedContract?.createdBy
      ?? linkedRental?.createdBy
      ?? currentUserName
      ?? '',
    ).trim();
    return resolved && normalizeText(resolved) !== 'sistema' ? resolved : currentUserName;
  }, [contractById, contractByRentalId, currentUserName, rentalById]);

  const filteredBigCashRows = useMemo(() => {
    const text = bigCashQuery.trim().toLowerCase();
    return bigCashMovementRows.filter((movement) => {
      const dateKey = getDateKey(movement.createdAt);
      if (bigCashMovementRange.dateFrom && dateKey < bigCashMovementRange.dateFrom) return false;
      if (bigCashMovementRange.dateTo && dateKey > bigCashMovementRange.dateTo) return false;
      const amount = toNumber(movement.amountBs);
      const matchesType =
        bigCashTypeFilter === 'all'
        || (bigCashTypeFilter === 'income' && !movement.isInternalTransfer && amount > 0 && !isGuaranteeMovement(movement) && !isVoidedCashMovement(movement))
        || (bigCashTypeFilter === 'guarantee' && isGuaranteeMovement(movement) && !isVoidedCashMovement(movement))
        || (bigCashTypeFilter === 'transfer' && movement.isInternalTransfer && amount < 0 && !isVoidedCashMovement(movement));
      if (!matchesType) return false;
      if (!text) return true;
      return [
        movement.description,
        movement.receipt,
        movement.responsible,
        movement.createdBy,
        getMovementReference(movement),
      ].some((value) => String(value ?? '').toLowerCase().includes(text));
    });
  }, [bigCashMovementRange, bigCashMovementRows, bigCashQuery, bigCashTypeFilter, getMovementReference]);

  const periodBigCashRows = useMemo(
    () => bigCashMovementRows.filter((movement) => {
      const dateKey = getDateKey(movement.createdAt);
      return (!bigCashPeriodRange.dateFrom || dateKey >= bigCashPeriodRange.dateFrom)
        && (!bigCashPeriodRange.dateTo || dateKey <= bigCashPeriodRange.dateTo)
        && !isVoidedCashMovement(movement);
    }),
    [bigCashMovementRows, bigCashPeriodRange],
  );

  const periodBigCashTransactionRows = useMemo(
    () => periodBigCashRows.filter((movement) => !isOpeningCashMovement(movement)),
    [periodBigCashRows],
  );

  const periodBigCashCollectedBs = useMemo(
    () => sumBy(periodBigCashTransactionRows.filter((movement) => toNumber(movement.amountBs) > 0), (movement) => movement.amountBs),
    [periodBigCashTransactionRows],
  );

  const periodBigCashOutBs = useMemo(
    () => Math.abs(sumBy(periodBigCashTransactionRows.filter((movement) => toNumber(movement.amountBs) < 0 || movement.isInternalTransfer), (movement) => movement.amountBs)),
    [periodBigCashTransactionRows],
  );

  const periodOperationalIncomeBs = useMemo(
    () => sumBy(
      periodBigCashTransactionRows.filter((movement) => toNumber(movement.amountBs) > 0 && !isGuaranteeMovement(movement)),
      (movement) => movement.amountBs,
    ),
    [periodBigCashTransactionRows],
  );

  const periodGuaranteeIncomeBs = useMemo(
    () => sumBy(
      periodBigCashTransactionRows.filter((movement) => toNumber(movement.amountBs) > 0 && isGuaranteeMovement(movement)),
      (movement) => movement.amountBs,
    ),
    [periodBigCashTransactionRows],
  );

  const periodBigCashNetBs = Number((periodBigCashCollectedBs - periodBigCashOutBs).toFixed(2));

  const periodPaymentMethodRows = useMemo(() => {
    const summary = new Map();
    periodBigCashTransactionRows.forEach((movement) => {
      const methodKey = normalizePaymentMethod(movement.paymentMethod);
      const account = methodKey === 'qr' ? String(movement?.paymentAccount ?? '').trim() : '';
      const summaryKey = `${methodKey}::${normalizeText(account)}`;
      const meta = getPaymentMethodMeta(movement.paymentMethod);
      const current = summary.get(summaryKey) ?? {
        key: summaryKey,
        methodKey,
        account,
        ...meta,
        collectedBs: 0,
        outBs: 0,
        count: 0,
      };
      const amount = toNumber(movement.amountBs);
      if (amount > 0) current.collectedBs += amount;
      if (amount < 0 || movement.isInternalTransfer) current.outBs += Math.abs(amount);
      current.count += 1;
      summary.set(summaryKey, current);
    });
    const methodOrder = ['efectivo', 'qr', 'transferencia', 'sin_metodo'];
    return [...summary.values()]
      .sort((a, b) => {
        const aOrder = methodOrder.indexOf(a.methodKey);
        const bOrder = methodOrder.indexOf(b.methodKey);
        return (aOrder < 0 ? methodOrder.length : aOrder) - (bOrder < 0 ? methodOrder.length : bOrder);
      })
      .map((entry) => ({
        ...entry,
        collectedBs: Number(entry.collectedBs.toFixed(2)),
        outBs: Number(entry.outBs.toFixed(2)),
        netBs: Number((entry.collectedBs - entry.outBs).toFixed(2)),
      }));
  }, [periodBigCashTransactionRows]);

  const visiblePaymentChannelRows = periodPaymentMethodRows;

  const getPettyExpenseCategory = useCallback((movement) => {
    const raw = String(movement?.category ?? '').trim();
    const description = normalizeText(movement?.description);
    const normalized = normalizeText(raw).replace(/\s+/g, '_');
    const found = PETTY_EXPENSE_CATEGORIES.find((category) =>
      normalized === category.id
      || normalized.includes(category.id)
      || category.aliases.some((alias) => normalized.includes(normalizeText(alias)) || description.includes(normalizeText(alias)))
    );
    if (found) return found;
    if (normalized.includes('adelanto') || normalized.includes('personal_advance') || description.includes('adelanto')) {
      return PETTY_EXPENSE_CATEGORIES.find((category) => category.id === 'anticipo_sueldos') ?? { label: 'Anticipo Sueldos', className: 'advance' };
    }
    if (normalized.includes('proveedor') || normalized.includes('supplier') || description.includes('proveedor')) {
      return { label: 'Proveedor', className: 'supplier' };
    }
    return { label: raw || 'Varios', className: 'other' };
  }, []);

  const personnelAdvanceRows = useMemo(
    () => visiblePettyExpenseRows
      .filter((movement) => !isVoidedCashMovement(movement))
      .filter((movement) => {
        const category = normalizeText(movement?.category);
        const tag = normalizeText(movement?.accountingTag);
        return category.includes('adelanto') || tag === 'personnel_advance';
      })
      .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0)),
    [visiblePettyExpenseRows],
  );

  const getPettyCashRegisteredByForMovement = useCallback((movement) => {
    const cleanName = (value) => {
      const name = String(value ?? '').trim();
      return name && normalizeText(name) !== 'sistema' ? name : '';
    };
    const movementSessionId = String(movement?.sessionId ?? '').trim();
    const movementDateKey = getDateKey(movement?.createdAt);
    const movementTime = new Date(movement?.createdAt ?? 0).getTime();

    const sessionById = cashSessions.find((session) => (
      !isArchivedAccountingRecord(session)
      && String(session?.id ?? '').trim() === movementSessionId
    ));
    const sessionByIdName = cleanName(sessionById?.openedBy || sessionById?.createdBy || sessionById?.responsible);
    if (sessionByIdName) return sessionByIdName;

    const sessionByTime = cashSessions.find((session) => {
      if (isArchivedAccountingRecord(session)) return false;
      const openedAt = new Date(session?.openedAt ?? session?.createdAt ?? 0).getTime();
      const closedAt = session?.closedAt ? new Date(session.closedAt).getTime() : Number.POSITIVE_INFINITY;
      return Number.isFinite(movementTime)
        && Number.isFinite(openedAt)
        && movementTime >= openedAt
        && movementTime <= closedAt;
    });
    const sessionByTimeName = cleanName(sessionByTime?.openedBy || sessionByTime?.createdBy || sessionByTime?.responsible);
    if (sessionByTimeName) return sessionByTimeName;

    const sameDayOpening = postedMovements.find((entry) => (
      isPettyCash(entry)
      && String(entry?.type ?? '').toLowerCase() === 'apertura'
      && getDateKey(entry?.createdAt) === movementDateKey
    ));
    const sameDayOpeningName = cleanName(sameDayOpening?.responsible || sameDayOpening?.createdBy);
    if (sameDayOpeningName) return sameDayOpeningName;

    const sameDayReposition = pettyTransfersRows.find((entry) => getDateKey(entry?.createdAt) === movementDateKey);
    return cleanName(sameDayReposition?.responsible || sameDayReposition?.createdBy);
  }, [cashSessions, pettyTransfersRows, postedMovements]);

  const getPersonnelAdvanceRegisteredBy = useCallback((movement) => {
    const creator = String(movement?.createdByName ?? movement?.userName ?? movement?.createdBy ?? '').trim();
    const worker = String(movement?.responsible ?? '').trim();
    const pettyRegisteredBy = getPettyCashRegisteredByForMovement(movement);
    if (pettyRegisteredBy) return pettyRegisteredBy;
    if (creator && normalizeText(creator) !== normalizeText(worker)) return creator;
    return creator || currentUserName || '-';
  }, [currentUserName, getPettyCashRegisteredByForMovement]);

  const selectedDayAdvanceRows = useMemo(
    () => personnelAdvanceRows.filter((movement) => getDateKey(movement.createdAt) === selectedDate),
    [personnelAdvanceRows, selectedDate],
  );

  const selectedDayAdvanceBs = useMemo(
    () => Math.abs(sumBy(selectedDayAdvanceRows, (movement) => movement.amountBs)),
    [selectedDayAdvanceRows],
  );
  const pagedPettyExpenseRows = pettySectorPages.expenses.rows;
  const pagedPersonnelAdvanceRows = pettySectorPages.advances.rows;
  const pagedCashDebts = pettySectorPages.debts.rows;

  const pettyHistoryRows = useMemo(() => {
    const rows = [];
    const sourceMovements = Array.isArray(pettyHistorySource) ? pettyHistorySource : sortedMovements;

    sourceMovements.forEach((movement) => {
      if (!isPettyCash(movement)) return;
      const amount = toNumber(movement.amountBs);
      const type = String(movement.type ?? '').toLowerCase();
      const isOpening = type === 'apertura' && amount > 0;
      const isReposition = movement.isInternalTransfer && amount > 0;
      const isExpense = !movement.isInternalTransfer && amount < 0;

      if (!isOpening && !isReposition && !isExpense) return;

      const category = isExpense ? getPettyExpenseCategory(movement) : { label: isOpening ? 'Apertura' : 'Reposicion', className: 'reposition' };
      rows.push({
        ...movement,
        historyKind: isExpense ? 'expense' : 'reposition',
        historyLabel: isExpense ? 'Gasto' : isOpening ? 'Apertura' : 'Reposicion',
        historyAmountBs: Math.abs(amount),
        historySignedBs: isExpense ? -Math.abs(amount) : Math.abs(amount),
        historyCategory: category,
        historyReference: getMovementReference(movement),
      });
    });

    return rows.sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));
  }, [getMovementReference, getPettyExpenseCategory, pettyHistorySource, sortedMovements]);

  const filteredPettyHistoryRows = pettyHistoryRows;

  const clientPettyHistorySummary = useMemo(() => {
    const validRows = filteredPettyHistoryRows.filter((movement) => !isVoidedCashMovement(movement));
    const repositionsBs = sumBy(validRows.filter((movement) => movement.historyKind === 'reposition'), (movement) => movement.historyAmountBs);
    const expensesBs = sumBy(validRows.filter((movement) => movement.historyKind === 'expense'), (movement) => movement.historyAmountBs);
    return {
      repositionsBs,
      expensesBs,
      netBs: Number((repositionsBs - expensesBs).toFixed(2)),
      voidedCount: filteredPettyHistoryRows.filter((movement) => isVoidedCashMovement(movement)).length,
    };
  }, [filteredPettyHistoryRows]);
  const pettyHistorySummary = pettyHistoryMeta.summary ?? clientPettyHistorySummary;

  const getRentalContract = useCallback((rental) => (
    contractByRentalId.get(rental?.id)
    ?? contractById.get(rental?.contractId)
    ?? null
  ), [contractById, contractByRentalId]);

  const getRentalResponsibleName = useCallback((rental, contract = null) => {
    const primaryResponsible = Array.isArray(contract?.responsibles) ? contract.responsibles[0] : null;
    return String(
      primaryResponsible?.name
      ?? contract?.responsibleName
      ?? contract?.createdByName
      ?? rental?.createdByName
      ?? rental?.responsibleName
      ?? rental?.createdBy
      ?? '-',
    ).trim() || '-';
  }, []);

  const getRentalGuaranteeInfo = useCallback((rental, contract = null) => {
    const declaredBs = toNumber(
      rental?.guaranteeDeclaredBs
      ?? rental?.guarantee?.amountBs
      ?? contract?.totals?.guaranteeBs
      ?? rental?.depositBs,
    );
    const storedDepositBs = toNumber(rental?.depositBs);
    const storedValidatedBs = toNumber(rental?.guarantee?.validatedBs);
    const storedValidation = getStoredGuaranteeValidation({ rental, contract, declaredBs });
    const statuses = [
      rental?.guarantee?.status,
      rental?.payment?.guaranteeStatus,
      contract?.guarantee?.status,
      contract?.payment?.guaranteeStatus,
    ].map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean);
    const hasExplicitUnvalidatedStatus = statuses.includes('no_validado');
    const isValidated = storedValidation.isValidated
      || (!hasExplicitUnvalidatedStatus && storedDepositBs > 0);
    const validatedBs = isValidated
      ? Math.max(0, storedValidation.validatedBs, storedDepositBs, storedValidatedBs, declaredBs)
      : 0;
    return {
      declaredBs,
      validatedBs,
      unvalidatedBs: isValidated ? 0 : declaredBs,
      status: isValidated ? 'validado' : 'no_validado',
      isValidated,
    };
  }, []);

  const guaranteeLifecycleRows = useMemo(() => rentals
    .filter((rental) => !rental?.deletedAt)
    .map((rental) => {
      const contract = getRentalContract(rental);
      const guaranteeInfo = getRentalGuaranteeInfo(rental, contract);
      const guaranteeBs = guaranteeInfo.declaredBs;
      const status = String(rental?.status ?? '').toLowerCase();
      const isReturned = status === 'returned';
      if (!['active', 'returned'].includes(status)) return null;
      if (guaranteeBs <= 0) return null;

      const referenceKeys = new Set([
        rental?.id,
        rental?.orderCode,
        rental?.contractCode,
        contract?.id,
        contract?.contractCode,
        contract?.orderCode,
      ].map(normalizeText).filter(Boolean));
      const linkedContractMovements = postedMovements
        .filter((movement) => {
          if (isVoidedCashMovement(movement)) return false;
          return [
            movement?.linkedRentalId,
            movement?.linkedContractId,
            movement?.linkedOrderCode,
            movement?.contractCode,
            movement?.reference,
            movement?.sourceId,
          ].map(normalizeText).some((key) => key && referenceKeys.has(key));
        })
        .sort((a, b) => new Date(a?.createdAt ?? 0) - new Date(b?.createdAt ?? 0));
      const linkedGuaranteePaymentMovements = linkedContractMovements.filter((movement) => (
        isGuaranteeMovement(movement) || toNumber(movement?.guaranteeAllocationBs) > 0
      ));
      const contractReferences = {
        contractIds: [contract?.id, rental?.contractId],
        rentalIds: [rental?.id, contract?.rentalId],
        contractCodes: [contract?.contractCode, rental?.contractCode],
        orderCodes: [contract?.orderCode, rental?.orderCode],
        createdAtMs: new Date(
          contract?.approvedAt ?? contract?.contractDate ?? contract?.createdAt ?? rental?.createdAt ?? 0,
        ).getTime(),
      };
      const refundMovements = postedMovements
        .filter((movement) => isConfirmedGuaranteeReturnMovement(movement))
        .filter((movement) => cashMovementMatchesContractReferences(movement, contractReferences))
        .sort((left, right) => new Date(left?.createdAt ?? 0) - new Date(right?.createdAt ?? 0));
      const ledgerGuaranteeEvidence = getGuaranteeLedgerEvidence(contract);
      const cashRefundedBs = sumBy(refundMovements, (movement) => Math.abs(toNumber(movement?.amountBs)));
      const refundedBs = Math.max(cashRefundedBs, ledgerGuaranteeEvidence.refundedBs);
      const guaranteePaymentEvidence = [
        ...linkedGuaranteePaymentMovements,
        ...ledgerGuaranteeEvidence.paymentEntries,
      ];
      const refundEvidence = [
        ...refundMovements,
        ...ledgerGuaranteeEvidence.refundEntries,
      ].sort((left, right) => new Date(left?.createdAt ?? 0) - new Date(right?.createdAt ?? 0));
      const paidMethodLabels = [...new Set(guaranteePaymentEvidence
        .map((movement) => getPaymentMethodLabel(movement))
        .filter(Boolean))];
      const paymentReceiptCodes = [...new Set(guaranteePaymentEvidence
        .map((movement) => String(movement?.receiptCode ?? movement?.receipt ?? movement?.cashReceiptCode ?? '').trim())
        .filter(Boolean))];
      const paymentRegisteredByNames = [...new Set(guaranteePaymentEvidence
        .map((movement) => String(movement?.createdByName ?? movement?.createdBy ?? movement?.responsible ?? movement?.editedByName ?? '').trim())
        .filter(Boolean))];
      const fallbackMethod = rental?.guarantee?.paymentMethod
        ?? rental?.payment?.guaranteePaymentMethod
        ?? contract?.guarantee?.paymentMethod
        ?? contract?.payment?.guaranteePaymentMethod
        ?? '';
      const fallbackAccount = rental?.guarantee?.paymentAccount
        ?? rental?.payment?.guaranteePaymentAccount
        ?? contract?.guarantee?.paymentAccount
        ?? contract?.payment?.guaranteePaymentAccount
        ?? '';
      const paymentMethodLabel = paidMethodLabels.length
        ? paidMethodLabels.join(' + ')
        : fallbackMethod
          ? getPaymentMethodLabel({ paymentMethod: fallbackMethod, paymentAccount: fallbackAccount })
          : 'Sin método';
      const refundDefaultMethod = normalizePaymentMethod(guaranteePaymentEvidence[0]?.paymentMethod ?? fallbackMethod);
      const refundDefaultAccount = String(guaranteePaymentEvidence[0]?.paymentAccount ?? fallbackAccount ?? '').trim();

      const totalBs = Math.max(0, toNumber(rental?.totals?.totalBs ?? contract?.totals?.totalBs));
      const prepaidAppliedBs = Math.max(0, toNumber(rental?.payment?.prepaidAppliedBs ?? rental?.prepaidAppliedBs ?? contract?.payment?.prepaidAppliedBs ?? contract?.prepaidAppliedBs));
      const storedPaidBs = Math.max(0, toNumber(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs ?? contract?.payment?.paidAtApprovalBs));
      const effectivePaidBs = storedPaidBs + 0.01 >= prepaidAppliedBs ? storedPaidBs : storedPaidBs + prepaidAppliedBs;
      const confirmedLedgerPaidBs = getConfirmedContractLedgerPaidBs(contract, totalBs);
      const currentOutstandingRentalBs = Math.max(
        0,
        Number((totalBs - Math.max(effectivePaidBs, confirmedLedgerPaidBs)).toFixed(2)),
      );
      const clientPenaltyBs = Math.max(0, Number((Array.isArray(rental?.returnReport) ? rental.returnReport : []).reduce((sum, line) => {
        const owner = normalizeText(line?.chargeOwner);
        if (owner === 'transporte' || owner === 'lavado') return sum;
        return sum + Math.max(0, toNumber(line?.penaltyBs ?? (toNumber(line?.damagedFeeBs) + toNumber(line?.missingFeeBs))));
      }, 0).toFixed(2)));
      const collectedDamageBs = Math.max(0, Number(postedMovements.reduce((sum, movement) => {
        if (isVoidedCashMovement(movement)) return sum;
        const sameReference = [movement?.linkedRentalId, movement?.linkedContractId, movement?.linkedOrderCode, movement?.sourceId]
          .map(normalizeText)
          .some((key) => key && referenceKeys.has(key));
        if (!sameReference) return sum;
        const breakdown = Array.isArray(movement?.collectionBreakdown) ? movement.collectionBreakdown : [];
        const breakdownDamage = breakdown
          .filter((entry) => normalizeText(entry?.target) === 'damage')
          .reduce((subtotal, entry) => subtotal + Math.max(0, toNumber(entry?.amountBs)), 0);
        if (breakdownDamage > 0) return sum + breakdownDamage;
        const storedDamage = Math.max(0, toNumber(movement?.damageCollectedBs));
        if (storedDamage > 0) return sum + storedDamage;
        const targetText = normalizeText([movement?.collectionTarget, movement?.category, movement?.accountingTag, movement?.type].join(' '));
        return /(damage|dano|faltante)/.test(targetText) ? sum + Math.max(0, toNumber(movement?.amountBs)) : sum;
      }, 0).toFixed(2)));
      const pendingDamageBs = Math.max(0, Number((clientPenaltyBs - collectedDamageBs).toFixed(2)));
      const cashGuaranteePaidBs = calculateGuaranteePaidEvidence(
        linkedContractMovements,
        isGuaranteeMovement,
      );
      const guaranteePaidBs = Math.max(
        cashGuaranteePaidBs,
        ledgerGuaranteeEvidence.paidBs,
        guaranteeInfo.isValidated ? guaranteeInfo.validatedBs : 0,
      );
      const guaranteeUnpaidBs = Math.max(0, Number((guaranteeBs - guaranteePaidBs).toFixed(2)));
      const appliedBs = guaranteePaidBs > 0 && isReturned
        ? Math.min(guaranteePaidBs, Number((currentOutstandingRentalBs + pendingDamageBs).toFixed(2)))
        : 0;
      const guaranteeSettlement = calculateGuaranteeSettlement({
        paidBs: guaranteePaidBs,
        appliedBs,
        refundedBs,
      });
      const refundableBs = guaranteeSettlement.pendingRefundBs;
      const refundPaymentMethods = [...new Set(refundEvidence.map(getPaymentMethodLabel).filter(Boolean))];
      const receiptCodes = [...new Set(refundEvidence
        .map((movement) => String(movement?.receiptCode ?? movement?.receipt ?? movement?.cashReceiptCode ?? '').trim())
        .filter(Boolean))];
      const registeredByNames = [...new Set(refundEvidence
        .map((movement) => String(movement?.createdByName ?? movement?.createdBy ?? movement?.responsible ?? movement?.editedByName ?? '').trim())
        .filter(Boolean))];
      const lastRefundMovement = refundEvidence.at(-1);

      return {
        id: rental.id,
        rentalId: rental.id,
        contractId: contract?.id ?? rental?.contractId ?? '',
        orderCode: rental.orderCode ?? '',
        contractCode: contract?.contractCode ?? rental?.contractCode ?? rental?.orderCode ?? rental.id,
        customerName: rental.customerName ?? contract?.customerName ?? 'Cliente',
        responsibleName: getRentalResponsibleName(rental, contract),
        eventDate: rental.eventDate ?? contract?.eventDate ?? rental.deliveryDate ?? rental.createdAt,
        amountBs: refundableBs,
        declaredBs: guaranteeInfo.declaredBs,
        guaranteePaidBs,
        validatedBs: refundableBs,
        appliedBs: guaranteeSettlement.appliedBs,
        refundedBs: guaranteeSettlement.refundedBs,
        refundableBs,
        unvalidatedBs: guaranteeUnpaidBs,
        currentOutstandingRentalBs,
        pendingDamageBs,
        paymentMethodLabel,
        refundDefaultMethod: ['efectivo', 'qr', 'transferencia'].includes(refundDefaultMethod) ? refundDefaultMethod : 'efectivo',
        refundDefaultAccount,
        guaranteeStatus: guaranteeInfo.status,
        isMoneyHeld: refundableBs > 0,
        isReadyToReturn: isReturned && refundableBs > 0,
        isPartiallyRefunded: guaranteeSettlement.isPartiallyRefunded,
        isFullyResolved: guaranteeSettlement.isFullyResolved,
        returnedAt: lastRefundMovement?.receiptIssuedAt ?? lastRefundMovement?.createdAt ?? rental?.returnedAt,
        refundPaymentMethodLabel: refundPaymentMethods.join(' + ') || 'Sin método',
        paymentReceiptCodes: paymentReceiptCodes.join(', '),
        paymentRegisteredBy: paymentRegisteredByNames.join(', ') || '-',
        receiptCodes: receiptCodes.join(', '),
        registeredBy: registeredByNames.join(', ') || '-',
        refundMovements: refundEvidence,
        statusLabel: guaranteeUnpaidBs > 0.009
          ? guaranteePaidBs > 0.009 ? 'Pago parcial' : 'Falta pagar'
          : isReturned
            ? guaranteeSettlement.isPartiallyRefunded ? 'Devolución parcial' : refundableBs > 0 ? 'Lista para devolver' : 'Liquidada'
            : 'En custodia',
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.isReadyToReturn) - Number(a.isReadyToReturn) || new Date(b.eventDate ?? 0) - new Date(a.eventDate ?? 0)),
  [getRentalContract, getRentalGuaranteeInfo, getRentalResponsibleName, postedMovements, rentals]);

  const guaranteesToReturnRows = useMemo(() => guaranteeLifecycleRows
    .filter((row) => row.unvalidatedBs > 0.009 || row.refundableBs > 0.009)
    .sort((a, b) => Number(b.isReadyToReturn) - Number(a.isReadyToReturn) || new Date(b.eventDate ?? 0) - new Date(a.eventDate ?? 0)),
  [guaranteeLifecycleRows]);

  const returnedGuaranteeRows = useMemo(() => guaranteeLifecycleRows
    .filter((row) => row.isFullyResolved && (row.refundedBs > 0.009 || row.appliedBs > 0.009))
    .map((row) => {
      const hasRefund = row.refundedBs > 0.009;
      return {
        ...row,
        paymentMethodLabel: hasRefund ? row.refundPaymentMethodLabel : row.paymentMethodLabel,
        receiptCodes: hasRefund ? row.receiptCodes : row.paymentReceiptCodes,
        registeredBy: hasRefund ? row.registeredBy : row.paymentRegisteredBy,
        statusLabel: getGuaranteeResolutionLabel(row),
      };
    })
    .sort((left, right) => new Date(right?.returnedAt ?? 0) - new Date(left?.returnedAt ?? 0)),
  [guaranteeLifecycleRows]);

  const calculatedGuaranteesHeldBs = useMemo(
    () => sumBy(guaranteeLifecycleRows.filter((row) => row.isMoneyHeld), (row) => row.refundableBs),
    [guaranteeLifecycleRows],
  );
  const guaranteesHeldBs = calculatedGuaranteesHeldBs;
  const unvalidatedGuaranteesBs = useMemo(
    () => sumBy(guaranteeLifecycleRows, (row) => row.unvalidatedBs),
    [guaranteeLifecycleRows],
  );
  const operationalBigCashBs = useMemo(
    () => Math.max(0, Number((bigCashBalanceBs - guaranteesHeldBs).toFixed(2))),
    [bigCashBalanceBs, guaranteesHeldBs],
  );
  const dayGuaranteeIncomeBs = useMemo(
    () => sumBy(bigCashGuaranteeRows.filter((movement) => getDateKey(movement.createdAt) === selectedDate), (movement) => movement.amountBs),
    [bigCashGuaranteeRows, selectedDate],
  );

  const pendingReceivableRows = useMemo(
    () => rentals
      .filter((rental) => !receivableExcludedRentalIds.has(String(rental?.id ?? rental?.rentalId ?? '')))
      .map((rental) => {
        const isReturned = String(rental?.status ?? '').toLowerCase() === 'returned';
        const settlement = rental?.returnSettlement ?? {};
        const contract = contractByRentalId.get(rental.id);
        const breakdown = getRentalReceivableBreakdown(rental, contract);
        const totalBs = breakdown.totalBs;
        const pendingBs = breakdown.totalPendingBs;
        if (pendingBs <= 0) return null;
        return {
          id: rental.id,
          orderCode: rental.orderCode ?? rental.id,
          contractCode: contract?.contractCode ?? '',
          customerName: rental.customerName ?? 'Cliente',
          responsibleName: getRentalResponsibleName(rental, contract),
          eventDate: getRentalReceivableEventDate(rental, contract),
          status: isReturned ? 'Liquidacion' : 'Contrato',
          pendingBs,
          contractPendingBs: breakdown.contractPendingBs,
          transportPendingBs: breakdown.transportPendingBs,
          damagePendingBs: breakdown.damagePendingBs,
          totalBs,
          paidBs: breakdown.paidBs,
          guaranteeBs: toNumber(rental?.depositBs),
          penaltiesBs: toNumber(settlement.penaltiesBs ?? rental?.penaltiesBs),
          outstandingRentalBs: toNumber(settlement.outstandingRentalBs),
          refundBs: toNumber(settlement.refundBs ?? rental?.refundBs),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.pendingBs - a.pendingBs),
    [contractByRentalId, getRentalReceivableBreakdown, getRentalResponsibleName, receivableExcludedRentalIds, rentals],
  );

  const pendingReceivableBs = useMemo(
    () => sumBy(pendingReceivableRows, (row) => row.pendingBs),
    [pendingReceivableRows],
  );

  const finalizedReceivableRows = useMemo(
    () => rentals
      .filter((rental) => !receivableExcludedRentalIds.has(String(rental?.id ?? rental?.rentalId ?? '')))
      .map((rental) => {
        const contract = getRentalContract(rental);
        if (!contract?.isFinalized) return null;
        const settlement = rental?.returnSettlement ?? {};
        const pendingBs = getVipAdjustedPendingBs(rental, contract);
        if (pendingBs > 0.009) return null;
        const totalBs = toNumber(rental?.totals?.totalBs ?? contract?.totals?.totalBs);
        const penaltiesBs = toNumber(settlement.penaltiesBs ?? rental?.penaltiesBs);
        const contractReferences = {
          contractIds: [contract?.id, rental?.contractId],
          rentalIds: [rental?.id, contract?.rentalId],
          contractCodes: [contract?.contractCode, rental?.contractCode],
          orderCodes: [contract?.orderCode, rental?.orderCode],
          createdAtMs: new Date(
            contract?.approvedAt ?? contract?.contractDate ?? contract?.createdAt ?? rental?.createdAt ?? 0,
          ).getTime(),
        };
        const exactCollectionSource = exactFinalizedCollections[String(rental.id)];
        const collectionSource = Array.isArray(exactCollectionSource)
          ? exactCollectionSource
          : postedMovements;
        const collectionMovements = collectionSource
          .filter((movement) => {
            if (toNumber(movement?.amountBs) <= 0 || movement?.isInternalTransfer) return false;
            if (!cashMovementMatchesContractReferences(movement, contractReferences)) return false;

            const breakdown = Array.isArray(movement?.collectionBreakdown) ? movement.collectionBreakdown : [];
            const hasOperationalBreakdown = breakdown.some((entry) => {
              const target = normalizeText(entry?.target);
              return target && !target.includes('guarantee') && !target.includes('garantia') && toNumber(entry?.amountBs) > 0;
            });
            const hasOperationalAllocation = toNumber(movement?.contractAllocationBs) > 0
              || toNumber(movement?.damageCollectedBs) > 0
              || toNumber(movement?.transportRevenueBs) > 0;

            return !isGuaranteeMovement(movement) || hasOperationalBreakdown || hasOperationalAllocation;
          })
          .map((movement) => ({
            id: movement.id,
            concept: getCollectionConceptLabel(movement),
            description: String(movement?.receiptDetail ?? movement?.description ?? '').trim(),
            amountBs: toNumber(movement.amountBs),
            createdAt: movement.receiptIssuedAt ?? movement.createdAt,
            paymentMethodLabel: getPaymentMethodLabel(movement),
            registeredBy: getMovementUserLabel(movement),
            receiptCode: String(movement?.receiptCode ?? movement?.receipt ?? '').trim(),
          }))
          .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
        return {
          id: rental.id,
          contractId: contract.id ?? rental.contractId ?? '',
          orderCode: rental.orderCode ?? rental.id,
          contractCode: contract.contractCode ?? rental.contractCode ?? '',
          contractCreatedAtMs: contractReferences.createdAtMs,
          customerName: rental.customerName ?? contract.customerName ?? 'Cliente',
          responsibleName: getRentalResponsibleName(rental, contract),
          eventDate: getRentalReceivableEventDate(rental, contract),
          finalizedAt: contract.finalizedAt ?? rental.finalizedAt ?? rental.returnedAt ?? rental.updatedAt,
          finalizedByName: contract.finalizedByName ?? '',
          settledBs: Math.max(0, totalBs + penaltiesBs),
          collectionMovements,
          collectionsLoaded: Array.isArray(exactCollectionSource),
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.finalizedAt ?? 0) - new Date(a.finalizedAt ?? 0)),
    [exactFinalizedCollections, getMovementUserLabel, getRentalContract, getRentalResponsibleName, getVipAdjustedPendingBs, postedMovements, receivableExcludedRentalIds, rentals],
  );

  const derivedReturnIssueRows = useMemo(
    () => rentals
      .filter((rental) => !rental?.deletedAt && String(rental?.status ?? '').toLowerCase() === 'returned')
      .flatMap((rental) => {
        const contract = getRentalContract(rental);
        const settlement = rental?.returnSettlement ?? {};
        const damagePendingTotalBs = getRentalReceivableBreakdown(rental, contract).damagePendingBs;
        const issueLines = Array.isArray(rental.returnIssueSummary)
          ? rental.returnIssueSummary
          : Array.isArray(rental.returnReport)
            ? rental.returnReport
            : [];
        const relevantLines = issueLines
          .filter((line) => toNumber(line.damagedQty) > 0 || toNumber(line.missingQty) > 0 || toNumber(line.penaltyBs) > 0);
        const clientPenaltyBs = sumBy(
          relevantLines.filter((line) => !['transporte', 'lavado'].includes(String(line.chargeOwner ?? '').toLowerCase())),
          (line) => line.penaltyBs,
        );
        let remainingSettledBs = Math.max(0, Number((clientPenaltyBs - Math.min(clientPenaltyBs, damagePendingTotalBs)).toFixed(2)));
        return relevantLines
          .map((line, index) => {
            const chargeOwner = ['transporte', 'lavado'].includes(String(line.chargeOwner ?? '').toLowerCase())
              ? String(line.chargeOwner).toLowerCase()
              : 'cliente';
            const penaltyBs = toNumber(line.penaltyBs);
            const settledDamageBs = chargeOwner === 'cliente'
              ? Math.min(penaltyBs, remainingSettledBs)
              : 0;
            if (chargeOwner === 'cliente') remainingSettledBs = Math.max(0, Number((remainingSettledBs - settledDamageBs).toFixed(2)));
            const pendingDamageBs = chargeOwner === 'cliente'
              ? Math.max(0, Number((penaltyBs - settledDamageBs).toFixed(2)))
              : 0;
            return {
              id: `${rental.id}-${line.itemId ?? index}`,
              rentalId: rental.id,
              orderCode: rental.orderCode ?? '',
              contractCode: contract?.contractCode ?? rental?.contractCode ?? rental?.orderCode ?? rental.id,
              customerName: rental.customerName ?? contract?.customerName ?? 'Cliente',
              responsibleName: getRentalResponsibleName(rental, contract),
              eventDate: rental.eventDate ?? contract?.eventDate ?? rental.deliveryDate ?? rental.createdAt,
              returnedAt: rental.returnedAt,
              itemName: line.itemName ?? 'Item',
              damagedQty: toNumber(line.damagedQty),
              missingQty: toNumber(line.missingQty),
              damagedUnitChargeBs: toNumber(line.damagedUnitChargeBs),
              missingUnitChargeBs: toNumber(line.missingUnitChargeBs),
              penaltyBs,
              chargeOwner,
              note: line.damageNote ?? '',
              pendingDamageBs,
              settledDamageBs,
              damagePendingTotalBs,
              pendingCollectionBs: pendingDamageBs,
              pendingBs: pendingDamageBs,
              totalBs: toNumber(rental?.totals?.totalBs),
              paidBs: toNumber(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs),
              guaranteeBs: toNumber(rental?.depositBs),
              penaltiesBs: toNumber(settlement.penaltiesBs ?? rental?.penaltiesBs),
              outstandingRentalBs: toNumber(settlement.outstandingRentalBs),
              refundBs: toNumber(settlement.refundBs ?? rental?.refundBs),
              status: 'Liquidacion',
            };
          });
      })
      .sort((a, b) => new Date(b.returnedAt ?? 0) - new Date(a.returnedAt ?? 0)),
    [getRentalContract, getRentalReceivableBreakdown, getRentalResponsibleName, rentals],
  );

  const returnIssueRows = useMemo(
    () => (Array.isArray(cashReturnIssues) && cashReturnIssues.length > 0
      ? cashReturnIssues.map((row) => {
          const derivedRow = derivedReturnIssueRows.find((entry) => String(entry.id) === String(row.id));
          const merged = { ...(derivedRow ?? {}), ...row };
          const pendingDamageBs = row.pendingDamageBs !== undefined
            ? toNumber(row.pendingDamageBs)
            : toNumber(derivedRow?.pendingDamageBs ?? row.pendingCollectionBs);
          const settledDamageBs = row.settledDamageBs !== undefined
            ? toNumber(row.settledDamageBs)
            : toNumber(derivedRow?.settledDamageBs);
          return {
            ...merged,
            pendingDamageBs,
            settledDamageBs,
            pendingBs: pendingDamageBs,
            status: 'Liquidacion',
          };
        }).sort((a, b) => new Date(b?.returnedAt ?? 0) - new Date(a?.returnedAt ?? 0))
      : derivedReturnIssueRows),
    [cashReturnIssues, derivedReturnIssueRows],
  );

  const normalizedBigCashWorkspaceQuery = useMemo(
    () => normalizeText(bigCashWorkspaceQuery),
    [bigCashWorkspaceQuery],
  );
  const filterBigCashWorkspaceRows = (rows, rangeKey, getRowDate) => {
    const range = bigCashWorkspaceRanges[rangeKey] ?? {};
    return rows.filter((row) => {
      const dateKey = getDateKey(getRowDate(row));
      if (range.dateFrom && (!dateKey || dateKey < range.dateFrom)) return false;
      if (range.dateTo && (!dateKey || dateKey > range.dateTo)) return false;
      return !normalizedBigCashWorkspaceQuery
        || normalizeText(JSON.stringify(row)).includes(normalizedBigCashWorkspaceQuery);
    });
  };
  const visibleReceivableRows = filterBigCashWorkspaceRows(pendingReceivableRows, 'receivables', (row) => row.eventDate);
  const visibleFinalizedReceivableRows = filterBigCashWorkspaceRows(
    finalizedReceivableRows,
    'receivables',
    (row) => row.eventDate,
  );
  const loadExactFinalizedCollections = useCallback(async (rows, { force = false } = {}) => {
    const pendingRows = (Array.isArray(rows) ? rows : [])
      .filter((row) => force || !Object.prototype.hasOwnProperty.call(exactFinalizedCollections, String(row?.id ?? '')));
    if (!pendingRows.length) return true;

    const pendingIds = pendingRows.map((row) => String(row.id));
    setLoadingFinalizedCollectionIds((current) => [...new Set([...current, ...pendingIds])]);
    setFinalizedCollectionsError('');
    try {
      const references = pendingRows.map(getReceivableCollectionReferences);
      const result = await api.cash.getContractCollections(references);
      const groupsByKey = new Map((Array.isArray(result?.groups) ? result.groups : [])
        .map((group) => [String(group?.key ?? ''), group]));
      const loadedCollections = {};
      pendingRows.forEach((row) => {
        const key = String(row.id);
        const reference = getReceivableCollectionReferences(row);
        loadedCollections[key] = (groupsByKey.get(key)?.movements ?? [])
          .filter((movement) => cashMovementMatchesContractReferences(movement, reference));
      });
      setExactFinalizedCollections((current) => ({ ...current, ...loadedCollections }));
      return true;
    } catch (error) {
      setFinalizedCollectionsError(error?.message || 'No se pudo cargar el historial completo de cobros.');
      return false;
    } finally {
      setLoadingFinalizedCollectionIds((current) => current.filter((id) => !pendingIds.includes(id)));
    }
  }, [exactFinalizedCollections]);
  const toggleFinalizedCollections = useCallback((row) => {
    if (expandedFinalizedReceivableId === row.id) {
      setExpandedFinalizedReceivableId('');
      return;
    }
    setExpandedFinalizedReceivableId(row.id);
    void loadExactFinalizedCollections([row], { force: true });
  }, [expandedFinalizedReceivableId, loadExactFinalizedCollections]);
  const openFinalizedReceivablesReport = useCallback(async () => {
    if (!visibleFinalizedReceivableRows.length) return;
    const loaded = await loadExactFinalizedCollections(visibleFinalizedReceivableRows, { force: true });
    if (loaded) setShowFinalizedReceivablesReport(true);
  }, [loadExactFinalizedCollections, visibleFinalizedReceivableRows]);
  const visibleGuaranteeRows = filterBigCashWorkspaceRows(guaranteesToReturnRows, 'guarantees', (row) => row.eventDate);
  const visibleReturnedGuaranteeRows = filterBigCashWorkspaceRows(
    returnedGuaranteeRows,
    'guarantees',
    (row) => row.eventDate,
  );
  const filteredReturnIssueRows = filterBigCashWorkspaceRows(
    returnIssueRows,
    'issues',
    (row) => row.returnedAt ?? row.createdAt,
  );
  const visiblePendingReturnIssueRows = filteredReturnIssueRows.filter(
    (row) => row.chargeOwner === 'cliente' && toNumber(row.pendingDamageBs) > 0.009,
  );
  const visibleSettledReturnIssueRows = filteredReturnIssueRows.filter(
    (row) => row.chargeOwner !== 'cliente' || toNumber(row.pendingDamageBs) <= 0.009,
  );
  const visibleReturnIssueRows = returnIssuesView === 'pending'
    ? visiblePendingReturnIssueRows
    : visibleSettledReturnIssueRows;
  const visiblePrepaidRows = filterBigCashWorkspaceRows(prepaidLedgerRows, 'prepaid', (row) => row.createdAt);
  const visibleReceivableTotalBs = sumBy(visibleReceivableRows, (row) => row.pendingBs);
  const visibleFinalizedReceivableTotalBs = sumBy(visibleFinalizedReceivableRows, (row) => row.settledBs);
  const selectedVipReportClient = useMemo(
    () => prepaidClientRows.find((row) => String(row.id) === String(vipReportClientId)) ?? prepaidClientRows[0] ?? null,
    [prepaidClientRows, vipReportClientId],
  );
  const vipReportRows = useMemo(() => {
    if (!selectedVipReportClient) return [];
    const range = bigCashWorkspaceRanges.prepaid ?? { dateFrom: '', dateTo: '' };
    return prepaidLedgerRows
      .filter((row) => String(row.client?.id ?? '') === String(selectedVipReportClient.id))
      .filter((row) => {
        const key = getDateKey(row.createdAt);
        if (range.dateFrom && key < range.dateFrom) return false;
        if (range.dateTo && key > range.dateTo) return false;
        return true;
      })
      .slice()
      .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
  }, [bigCashWorkspaceRanges.prepaid, prepaidLedgerRows, selectedVipReportClient]);
  const vipReportSummary = useMemo(() => {
    const depositsBs = sumBy(vipReportRows.filter((row) => row.amountBs > 0), (row) => row.amountBs);
    const usedBs = sumBy(vipReportRows.filter((row) => row.amountBs < 0), (row) => Math.abs(row.amountBs));
    const first = vipReportRows[0];
    const openingBs = first ? Number((toNumber(first.balanceAfterBs) - toNumber(first.amountBs)).toFixed(2)) : toNumber(selectedVipReportClient?.balanceBs);
    const closingBs = vipReportRows.length ? toNumber(vipReportRows[vipReportRows.length - 1].balanceAfterBs) : toNumber(selectedVipReportClient?.balanceBs);
    return { depositsBs, usedBs, openingBs, closingBs };
  }, [selectedVipReportClient, vipReportRows]);

  const openVipTopUp = () => {
    const firstClientId = vipReportClientId || prepaidClientRows[0]?.id || '';
    setVipTopUpForm({ clientId: firstClientId, date: getInputDate(), amountBs: '', paymentMethod: 'efectivo', paymentAccount: '', reason: '', notes: '' });
    setVipTopUpError('');
    setVipTopUpModalOpen(true);
  };

  const submitVipTopUp = async (event) => {
    event.preventDefault();
    if (vipTopUpSubmitting) return;
    setVipTopUpError('');
    const amountBs = Math.max(0, toNumber(vipTopUpForm.amountBs));
    if (!vipTopUpForm.clientId || amountBs <= 0 || !String(vipTopUpForm.reason ?? '').trim()) {
      setVipTopUpError('Completa cliente, monto y motivo de la recarga.');
      return;
    }
    if (vipTopUpForm.paymentMethod === 'qr' && !vipTopUpForm.paymentAccount) {
      setVipTopUpError('Selecciona la cuenta QR que recibio el dinero.');
      return;
    }
    setVipTopUpSubmitting(true);
    try {
      const result = await api.cash.topUpVipPrepaid({
        ...vipTopUpForm,
        amountBs,
        createdBy: currentUserName,
        responsible: currentUserName,
      });
      if (result?.movement) await printCashReceipt(result.movement);
      setVipTopUpModalOpen(false);
      setVipReportClientId(vipTopUpForm.clientId);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('copetin:vip-prepaid-updated', { detail: result }));
    } catch (error) {
      setVipTopUpError(error?.message || 'No se pudo registrar la recarga VIP.');
    } finally {
      setVipTopUpSubmitting(false);
    }
  };

  const exportVipReportWorkbook = async () => {
    if (isExportingVipReport || !selectedVipReportClient) return;
    setIsExportingVipReport(true);
    try {
      const excelModule = await import('exceljs');
      const ExcelJS = excelModule.default ?? excelModule;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'El Copetín';
      workbook.company = 'Copetín SRL';
      const sheet = workbook.addWorksheet('Estado de cuenta VIP', { views: [{ state: 'frozen', ySplit: 8 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
      sheet.columns = [{ width: 7 }, { width: 19 }, { width: 30 }, { width: 18 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 18 }];
      sheet.mergeCells('A1:H1'); sheet.getCell('A1').value = 'EL COPETÍN · ESTADO DE CUENTA PREPAGO VIP';
      sheet.getCell('A1').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 }; sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173A70' } };
      sheet.mergeCells('A2:H2'); sheet.getCell('A2').value = selectedVipReportClient.name; sheet.getCell('A2').font = { bold: true, size: 18 };
      const range = bigCashWorkspaceRanges.prepaid ?? {};
      sheet.mergeCells('A3:H3'); sheet.getCell('A3').value = `Periodo: ${range.dateFrom || 'Inicio'} — ${range.dateTo || 'Fin'} · Generado: ${new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`;
      sheet.getRow(5).values = ['Saldo inicial', vipReportSummary.openingBs, 'Recargas', vipReportSummary.depositsBs, 'Consumos', vipReportSummary.usedBs, 'Saldo final', vipReportSummary.closingBs];
      [2,4,6,8].forEach((c) => { sheet.getRow(5).getCell(c).numFmt = '[$Bs-es-BO] #,##0.00'; });
      sheet.getRow(7).values = ['N°', 'Fecha / hora', 'Movimiento', 'Contrato / OS', 'Evento', 'Recarga', 'Consumo', 'Saldo'];
      sheet.getRow(7).eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173A70' } }; cell.alignment = { wrapText: true, horizontal: 'center' }; });
      vipReportRows.forEach((row, index) => {
        const excelRow = sheet.addRow([index + 1, row.createdAt ? new Date(row.createdAt) : '', row.description || (row.amountBs >= 0 ? 'Recarga VIP' : 'Consumo VIP'), row.reference || '-', row.eventDate ? new Date(row.eventDate) : '', row.amountBs > 0 ? row.amountBs : 0, row.amountBs < 0 ? Math.abs(row.amountBs) : 0, row.balanceAfterBs]);
        excelRow.getCell(2).numFmt = 'dd/mm/yyyy hh:mm'; excelRow.getCell(5).numFmt = 'dd/mm/yyyy'; [6,7,8].forEach((c) => { excelRow.getCell(c).numFmt = '[$Bs-es-BO] #,##0.00'; });
      });
      if (vipReportRows.length) sheet.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7 + vipReportRows.length, column: 8 } };
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `estado-cuenta-vip-${String(selectedVipReportClient.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xlsx`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (error) { console.error(error); window.alert('No se pudo generar el Excel VIP.'); }
    finally { setIsExportingVipReport(false); }
  };

  const printVipReport = () => {
    if (!selectedVipReportClient) return;
    const popup = window.open('', '_blank', 'width=1200,height=850');
    if (!popup) return window.alert('Habilita ventanas emergentes para imprimir el reporte.');
    const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    const rows = vipReportRows.map((row) => `<tr><td>${esc(formatDate(row.createdAt))}<br><small>${esc(getHourLabel(row.createdAt))}</small></td><td>${esc(row.description || (row.amountBs >= 0 ? 'Recarga VIP' : 'Consumo VIP'))}</td><td>${esc(row.reference || '-')}</td><td>${row.eventDate ? esc(formatDate(row.eventDate)) : '-'}</td><td class="money">${row.amountBs > 0 ? esc(formatBs(row.amountBs)) : '-'}</td><td class="money">${row.amountBs < 0 ? esc(formatBs(Math.abs(row.amountBs))) : '-'}</td><td class="money">${esc(formatBs(row.balanceAfterBs))}</td></tr>`).join('');
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Estado de cuenta VIP</title><style>body{font-family:Arial,sans-serif;color:#172033;padding:28px}h1{margin:0;color:#173a70}p{color:#64748b}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.kpis div{border:1px solid #d7dee8;border-radius:8px;padding:12px}.kpis small{display:block;color:#64748b}.kpis strong{font-size:18px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#173a70;color:white;padding:9px;text-align:left}td{padding:8px;border-bottom:1px solid #e5e7eb}.money{text-align:right;font-weight:700}@media print{body{padding:0}}</style></head><body><h1>EL COPETÍN · Estado de Cuenta Prepago VIP</h1><h2>${esc(selectedVipReportClient.name)}</h2><p>Rendición de recargas y consumos vinculados a contratos / órdenes.</p><div class="kpis"><div><small>Saldo inicial</small><strong>${esc(formatBs(vipReportSummary.openingBs))}</strong></div><div><small>Recargas</small><strong>${esc(formatBs(vipReportSummary.depositsBs))}</strong></div><div><small>Consumos</small><strong>${esc(formatBs(vipReportSummary.usedBs))}</strong></div><div><small>Saldo final</small><strong>${esc(formatBs(vipReportSummary.closingBs))}</strong></div></div><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Contrato / OS</th><th>Evento</th><th>Recarga</th><th>Consumo</th><th>Saldo</th></tr></thead><tbody>${rows || '<tr><td colspan="7">Sin movimientos en el rango.</td></tr>'}</tbody></table><script>window.onload=()=>window.print();</script></body></html>`); popup.document.close();
  };

  const finalizedReceivablesReportRange = useMemo(() => {
    const range = bigCashWorkspaceRanges.receivables ?? { dateFrom: '', dateTo: '' };
    const formatRangeDate = (value) => {
      if (!value) return '';
      const [year, month, day] = String(value).split('-');
      return year && month && day ? `${day}/${month}/${year}` : value;
    };
    if (!range.dateFrom && !range.dateTo) return 'Todos los eventos filtrados';
    return `${range.dateFrom ? formatRangeDate(range.dateFrom) : 'Inicio'} — ${range.dateTo ? formatRangeDate(range.dateTo) : 'Fin'}`;
  }, [bigCashWorkspaceRanges]);

  const guaranteesReportRange = useMemo(() => {
    const range = bigCashWorkspaceRanges.guarantees ?? { dateFrom: '', dateTo: '' };
    const formatRangeDate = (value) => {
      if (!value) return '';
      const [year, month, day] = String(value).split('-');
      return year && month && day ? `${day}/${month}/${year}` : value;
    };
    if (!range.dateFrom && !range.dateTo) return 'Todos los eventos filtrados';
    return `${range.dateFrom ? formatRangeDate(range.dateFrom) : 'Inicio'} — ${range.dateTo ? formatRangeDate(range.dateTo) : 'Fin'}`;
  }, [bigCashWorkspaceRanges]);

  const returnIssuesReportRange = useMemo(() => {
    const range = bigCashWorkspaceRanges.issues ?? { dateFrom: '', dateTo: '' };
    const formatRangeDate = (value) => {
      if (!value) return '';
      const [year, month, day] = String(value).split('-');
      return year && month && day ? `${day}/${month}/${year}` : value;
    };
    if (!range.dateFrom && !range.dateTo) return 'Todas las recepciones filtradas';
    return `${range.dateFrom ? formatRangeDate(range.dateFrom) : 'Inicio'} — ${range.dateTo ? formatRangeDate(range.dateTo) : 'Fin'}`;
  }, [bigCashWorkspaceRanges]);

  const exportReturnIssuesWorkbook = async () => {
    if (isExportingReturnIssues || visibleReturnIssueRows.length === 0) return;
    setIsExportingReturnIssues(true);
    try {
      const excelModule = await import('exceljs');
      const ExcelJS = excelModule.default ?? excelModule;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'El Copetín';
      workbook.company = 'Copetín SRL';
      workbook.created = new Date();
      const isPendingView = returnIssuesView === 'pending';
      const sheet = workbook.addWorksheet(isPendingView ? 'Por cobrar' : 'Cobrados y liquidados', {
        views: [{ state: 'frozen', ySplit: 6 }],
        pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });
      sheet.columns = [
        { width: 7 }, { width: 15 }, { width: 15 }, { width: 28 }, { width: 23 }, { width: 15 }, { width: 18 },
        { width: 30 }, { width: 22 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 21 },
      ];
      sheet.mergeCells('A1:N1');
      sheet.getCell('A1').value = 'EL COPETÍN · CONTROL DE DAÑOS Y FALTANTES';
      sheet.getCell('A1').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173A70' } };
      sheet.mergeCells('A2:I2');
      sheet.getCell('A2').value = isPendingView ? 'Daños y faltantes por cobrar' : 'Daños y faltantes cobrados y liquidados';
      sheet.getCell('A2').font = { name: 'Calibri', size: 20, bold: true, color: { argb: 'FF172033' } };
      sheet.mergeCells('J2:N2');
      sheet.getCell('J2').value = `Periodo: ${returnIssuesReportRange}`;
      sheet.getCell('J2').alignment = { horizontal: 'right' };
      sheet.mergeCells('A3:I3');
      sheet.getCell('A3').value = `${visibleReturnIssueRows.length} registro(s) · Total ${formatBs(visibleReturnIssueTotalBs)}`;
      sheet.mergeCells('J3:N3');
      sheet.getCell('J3').value = `Generado: ${new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`;
      sheet.getCell('J3').alignment = { horizontal: 'right' };
      sheet.mergeCells('A4:N4');
      sheet.getCell('A4').value = isPendingView
        ? 'Incluye únicamente cargos de daños o faltantes asignados al cliente que todavía tienen saldo pendiente.'
        : 'Incluye cargos ya cobrados, cubiertos con garantía o liquidados como responsabilidad interna.';
      sheet.getCell('A4').font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF64748B' } };
      const header = sheet.getRow(6);
      header.values = ['N°', 'Contrato', 'OS', 'Cliente', 'Responsable', 'Fecha evento', 'Fecha recepción', 'Ítem', 'Novedad', 'Origen', 'Penalización', 'Liquidado', 'Pendiente', 'Estado'];
      header.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173A70' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
      visibleReturnIssueRows.forEach((row, index) => {
        const eventDateKey = getDateKey(row.eventDate);
        const returnedDate = new Date(row.returnedAt ?? '');
        const validReturnedDate = Number.isNaN(returnedDate.getTime()) ? '' : returnedDate;
        const novelty = [row.damagedQty > 0 ? `${row.damagedQty} dañado(s)` : '', row.missingQty > 0 ? `${row.missingQty} faltante(s)` : ''].filter(Boolean).join(' / ');
        const statusLabel = row.chargeOwner !== 'cliente'
          ? 'Pérdida interna'
          : toNumber(row.pendingDamageBs) > 0.009 ? 'Por cobrar' : 'Cobrado / cubierto';
        const excelRow = sheet.addRow([
          index + 1, row.contractCode || '', row.orderCode || '', row.customerName || '', row.responsibleName || '',
          eventDateKey ? new Date(`${eventDateKey}T12:00:00`) : '', validReturnedDate, row.itemName || '', novelty,
          getReturnIssueOwnerLabel(row.chargeOwner), toNumber(row.penaltyBs), toNumber(row.settledDamageBs),
          toNumber(row.pendingDamageBs), statusLabel,
        ]);
        excelRow.getCell(6).numFmt = 'dd/mm/yyyy';
        excelRow.getCell(7).numFmt = 'dd/mm/yyyy hh:mm';
        [11, 12, 13].forEach((column) => { excelRow.getCell(column).numFmt = '[$Bs-es-BO] #,##0.00'; });
      });
      const lastRow = Math.max(6, 6 + visibleReturnIssueRows.length);
      sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: lastRow, column: 14 } };
      sheet.pageSetup.printTitlesRow = '1:6';
      const buffer = await workbook.xlsx.writeBuffer();
      const range = bigCashWorkspaceRanges.issues ?? {};
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `reporte-danos-faltantes-${isPendingView ? 'por-cobrar' : 'liquidados'}-${range.dateFrom || 'inicio'}-${range.dateTo || 'fin'}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('No se pudo exportar el reporte de daños y faltantes.', error);
      window.alert('No se pudo generar el Excel de daños y faltantes. Intenta nuevamente.');
    } finally {
      setIsExportingReturnIssues(false);
    }
  };

  const printReturnIssuesReport = () => {
    const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    const popup = window.open('', '_blank', 'width=1400,height=900');
    if (!popup) {
      window.alert('El navegador bloqueó la ventana de impresión. Habilita ventanas emergentes e intenta nuevamente.');
      return;
    }
    const isPendingView = returnIssuesView === 'pending';
    const rows = visibleReturnIssueRows.map((row, index) => {
      const novelty = [row.damagedQty > 0 ? `${row.damagedQty} dañado(s)` : '', row.missingQty > 0 ? `${row.missingQty} faltante(s)` : ''].filter(Boolean).join(' / ');
      const statusLabel = row.chargeOwner !== 'cliente' ? 'Pérdida interna' : toNumber(row.pendingDamageBs) > 0.009 ? 'Por cobrar' : 'Cobrado / cubierto';
      return `<tr><td>${index + 1}</td><td><strong>${escapeHtml(row.contractCode || row.orderCode)}</strong><br><small>${escapeHtml(row.customerName)}</small></td><td>${escapeHtml(row.itemName)}</td><td>${escapeHtml(novelty)}</td><td>${escapeHtml(getReturnIssueOwnerLabel(row.chargeOwner))}</td><td class="money">${escapeHtml(formatBs(row.penaltyBs))}</td><td class="money">${escapeHtml(formatBs(row.settledDamageBs))}</td><td class="money">${escapeHtml(formatBs(row.pendingDamageBs))}</td><td>${escapeHtml(statusLabel)}</td></tr>`;
    }).join('');
    popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de daños y faltantes</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;margin:0;font-size:9px;-webkit-print-color-adjust:exact;print-color-adjust:exact}header{display:flex;justify-content:space-between;border-bottom:3px solid #173a70;padding-bottom:10px}h1{margin:4px 0;font-size:23px}.brand{color:#173a70;font-weight:800;letter-spacing:.12em}.meta{text-align:right}.summary{display:flex;gap:10px;margin:12px 0}.summary div{border:1px solid #d7dee8;border-top:3px solid #173a70;padding:9px 12px;min-width:180px}.summary small{display:block;color:#64748b}.summary strong{font-size:17px}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#173a70;color:#fff;padding:7px;text-transform:uppercase;font-size:7px}td{padding:7px;border:1px solid #dbe2ea;vertical-align:top}tbody tr:nth-child(even){background:#f8fafc}.money{text-align:right;font-weight:800;white-space:nowrap}.no-print{text-align:right;margin-top:12px}.no-print button{border:0;border-radius:8px;background:#e84a00;color:#fff;padding:9px 14px;font-weight:700}@media print{.no-print{display:none}}</style></head><body><header><div><div class="brand">EL COPETÍN · CAJA GRANDE</div><h1>${isPendingView ? 'Daños y faltantes por cobrar' : 'Daños y faltantes cobrados y liquidados'}</h1><p>Control separado de cargos originados en la recepción de inventario.</p></div><div class="meta"><strong>${escapeHtml(returnIssuesReportRange)}</strong><br>${visibleReturnIssueRows.length} registro(s)</div></header><section class="summary"><div><small>Registros</small><strong>${visibleReturnIssueRows.length}</strong></div><div><small>${isPendingView ? 'Total pendiente' : 'Total liquidado'}</small><strong>${escapeHtml(formatBs(visibleReturnIssueTotalBs))}</strong></div></section><table><thead><tr><th>N°</th><th>Contrato / cliente</th><th>Ítem</th><th>Novedad</th><th>Origen</th><th>Penalización</th><th>Liquidado</th><th>Pendiente</th><th>Estado</th></tr></thead><tbody>${rows || '<tr><td colspan="9">Sin resultados.</td></tr>'}</tbody></table><div class="no-print"><button onclick="window.print()">Imprimir / guardar PDF</button></div></body></html>`);
    popup.document.close();
    popup.focus();
  };

  const exportPendingReceivablesWorkbook = async () => {
    try {
      const excelModule = await import('exceljs');
      const ExcelJS = excelModule.default ?? excelModule;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'El Copetín';
      workbook.company = 'Copetín SRL';
      workbook.created = new Date();
      const sheet = workbook.addWorksheet('Por cobrar', {
        views: [{ state: 'frozen', ySplit: 6 }],
        pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });
      sheet.columns = [
        { width: 7 }, { width: 16 }, { width: 16 }, { width: 30 }, { width: 25 }, { width: 15 },
        { width: 17 }, { width: 17 }, { width: 17 }, { width: 18 }, { width: 16 },
      ];
      sheet.mergeCells('A1:K1');
      sheet.getCell('A1').value = 'EL COPETÍN · CONTROL UNIFICADO DE CUENTAS POR COBRAR';
      sheet.getCell('A1').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173A70' } };
      sheet.mergeCells('A2:G2');
      sheet.getCell('A2').value = 'Pendientes por fecha de evento';
      sheet.getCell('A2').font = { name: 'Calibri', size: 20, bold: true, color: { argb: 'FF172033' } };
      sheet.mergeCells('H2:K2');
      sheet.getCell('H2').value = `Periodo: ${finalizedReceivablesReportRange}`;
      sheet.getCell('H2').alignment = { horizontal: 'right' };
      sheet.mergeCells('A3:G3');
      sheet.getCell('A3').value = `${visibleReceivableRows.length} contrato(s) con deuda real · Total ${formatBs(visibleReceivableTotalBs)}`;
      sheet.mergeCells('H3:K3');
      sheet.getCell('H3').value = `Generado: ${new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`;
      sheet.getCell('H3').alignment = { horizontal: 'right' };
      sheet.mergeCells('A4:K4');
      sheet.getCell('A4').value = 'El estado operativo “Finalizado” es independiente. Este reporte incluye únicamente contratos cuyo total por cobrar es mayor a cero.';
      sheet.getCell('A4').font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF64748B' } };
      const header = sheet.getRow(6);
      header.values = ['N°', 'Contrato', 'OS', 'Cliente', 'Responsable', 'Fecha evento', 'Contrato', 'Transporte', 'Daños / faltantes', 'Total por cobrar', 'Estado financiero'];
      header.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173A70' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
      visibleReceivableRows.forEach((row, index) => {
        const dateKey = getDateKey(row.eventDate);
        const excelRow = sheet.addRow([
          index + 1, row.contractCode || row.orderCode || '', row.orderCode || '', row.customerName || '',
          row.responsibleName || '', dateKey ? new Date(`${dateKey}T12:00:00`) : '',
          toNumber(row.contractPendingBs), toNumber(row.transportPendingBs), toNumber(row.damagePendingBs),
          toNumber(row.pendingBs), 'Por cobrar',
        ]);
        excelRow.getCell(6).numFmt = 'dd/mm/yyyy';
        [7, 8, 9, 10].forEach((column) => { excelRow.getCell(column).numFmt = '[$Bs-es-BO] #,##0.00'; });
      });
      const lastRow = Math.max(6, 6 + visibleReceivableRows.length);
      sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: lastRow, column: 11 } };
      sheet.pageSetup.printTitlesRow = '1:6';
      const buffer = await workbook.xlsx.writeBuffer();
      const range = bigCashWorkspaceRanges.receivables ?? {};
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `reporte-por-cobrar-${range.dateFrom || 'inicio'}-${range.dateTo || 'fin'}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('No se pudo exportar el reporte unificado por cobrar.', error);
      window.alert('No se pudo generar el Excel. Intenta nuevamente.');
    }
  };

  const exportGuaranteesWorkbook = async () => {
    if (isExportingGuarantees) return;
    setIsExportingGuarantees(true);
    try {
      const excelModule = await import('exceljs');
      const ExcelJS = excelModule.default ?? excelModule;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'El Copetín';
      workbook.company = 'Copetín SRL';
      workbook.created = new Date();

      const isReturnedView = guaranteesView === 'returned';
      const rows = isReturnedView ? visibleReturnedGuaranteeRows : visibleGuaranteeRows;
      const totalBs = isReturnedView
        ? sumBy(rows, (row) => row.appliedBs + row.refundedBs)
        : sumBy(rows, (row) => row.refundableBs);
      const sheet = workbook.addWorksheet(isReturnedView ? 'Garantías devueltas' : 'Por devolver', {
        views: [{ state: 'frozen', ySplit: 6 }],
        pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });
      sheet.columns = [
        { width: 7 }, { width: 15 }, { width: 15 }, { width: 30 }, { width: 24 }, { width: 15 },
        { width: 20 }, { width: 18 }, { width: 18 }, { width: 20 }, { width: 18 }, { width: 18 },
        { width: 20 }, { width: 18 },
      ];
      sheet.mergeCells('A1:N1');
      sheet.getCell('A1').value = 'EL COPETÍN · CONTROL UNIFICADO DE GARANTÍAS';
      sheet.getCell('A1').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173A70' } };
      sheet.mergeCells('A2:J2');
      sheet.getCell('A2').value = isReturnedView ? 'Garantías devueltas y finalizadas' : 'Garantías pendientes y por devolver';
      sheet.getCell('A2').font = { name: 'Calibri', size: 20, bold: true, color: { argb: 'FF172033' } };
      sheet.mergeCells('K2:N2');
      sheet.getCell('K2').value = `Periodo: ${guaranteesReportRange}`;
      sheet.getCell('K2').alignment = { horizontal: 'right' };
      sheet.mergeCells('A3:J3');
      sheet.getCell('A3').value = `${rows.length} garantía(s) · ${isReturnedView ? 'Total resuelto' : 'Saldo por devolver'} ${formatBs(totalBs)}`;
      sheet.mergeCells('K3:N3');
      sheet.getCell('K3').value = `Generado: ${new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`;
      sheet.getCell('K3').alignment = { horizontal: 'right' };
      sheet.mergeCells('A4:N4');
      sheet.getCell('A4').value = isReturnedView
        ? 'Historial de garantías resueltas mediante devolución o aplicación a daños, respaldadas por sus movimientos de Caja Grande.'
        : 'Detalle separado de garantía acordada, pagada, aplicada, ya devuelta, saldo por devolver y monto aún no pagado.';
      sheet.getCell('A4').font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF64748B' } };

      const header = sheet.getRow(6);
      header.values = isReturnedView
        ? ['N°', 'Contrato', 'OS', 'Cliente', 'Responsable', 'Fecha evento', 'Fecha resolución', 'Resultado', 'Garantía pagada', 'Aplicado', 'Devuelto', 'Método / recibo', 'Registrado por']
        : ['N°', 'Contrato', 'OS', 'Cliente', 'Responsable', 'Fecha evento', 'Situación', 'Acordada', 'Pagada', 'Método', 'Aplicado', 'Ya devuelto', 'Saldo por devolver', 'Falta pagar'];
      header.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173A70' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });

      rows.forEach((row, index) => {
        const eventDateKey = getDateKey(row.eventDate);
        const returnedDate = new Date(row.returnedAt ?? '');
        const validReturnedDate = Number.isNaN(returnedDate.getTime()) ? '' : returnedDate;
        const values = isReturnedView
          ? [
              index + 1, row.contractCode || '', row.orderCode || '', row.customerName || '', row.responsibleName || '',
              eventDateKey ? new Date(`${eventDateKey}T12:00:00`) : '',
              validReturnedDate, row.statusLabel || '',
              toNumber(row.guaranteePaidBs), toNumber(row.appliedBs), toNumber(row.refundedBs),
              [row.paymentMethodLabel, row.receiptCodes].filter(Boolean).join(' · '), row.registeredBy || '',
            ]
          : [
              index + 1, row.contractCode || '', row.orderCode || '', row.customerName || '', row.responsibleName || '',
              eventDateKey ? new Date(`${eventDateKey}T12:00:00`) : '', row.statusLabel || '',
              toNumber(row.declaredBs), toNumber(row.guaranteePaidBs), row.paymentMethodLabel || '',
              toNumber(row.appliedBs), toNumber(row.refundedBs), toNumber(row.refundableBs), toNumber(row.unvalidatedBs),
            ];
        const excelRow = sheet.addRow(values);
        excelRow.getCell(6).numFmt = 'dd/mm/yyyy';
        if (isReturnedView) excelRow.getCell(7).numFmt = 'dd/mm/yyyy hh:mm';
        (isReturnedView ? [9, 10, 11] : [8, 9, 11, 12, 13, 14]).forEach((column) => {
          excelRow.getCell(column).numFmt = '[$Bs-es-BO] #,##0.00';
        });
      });
      const lastRow = Math.max(6, 6 + rows.length);
      sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: lastRow, column: isReturnedView ? 13 : 14 } };
      sheet.pageSetup.printTitlesRow = '1:6';

      const buffer = await workbook.xlsx.writeBuffer();
      const range = bigCashWorkspaceRanges.guarantees ?? {};
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `reporte-garantias-${isReturnedView ? 'devueltas' : 'por-devolver'}-${range.dateFrom || 'inicio'}-${range.dateTo || 'fin'}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('No se pudo exportar el reporte de garantías.', error);
      window.alert('No se pudo generar el Excel de garantías. Intenta nuevamente.');
    } finally {
      setIsExportingGuarantees(false);
    }
  };

  const finalizedReceivablesCollectionRows = useMemo(
    () => visibleFinalizedReceivableRows.flatMap((row) =>
      row.collectionMovements.map((movement) => ({ ...movement, contractRow: row }))),
    [visibleFinalizedReceivableRows],
  );

  const exportFinalizedReceivablesWorkbook = async () => {
    if (isExportingFinalizedReceivables) return;
    setIsExportingFinalizedReceivables(true);
    try {
      const excelModule = await import('exceljs');
      const ExcelJS = excelModule.default ?? excelModule;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'El Copetín';
      workbook.company = 'Copetín SRL';
      workbook.created = new Date();
      workbook.modified = new Date();

      const navy = 'FF173A70';
      const ink = 'FF172033';
      const muted = 'FF64748B';
      const border = 'FFD7DEE8';
      const soft = 'FFF8FAFC';
      const green = 'FF16803C';
      const orange = 'FFE84A00';
      const moneyFormat = '[$Bs-es-BO] #,##0.00';
      const generatedAt = new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
      const setBorders = (cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: border } },
          left: { style: 'thin', color: { argb: border } },
          bottom: { style: 'thin', color: { argb: border } },
          right: { style: 'thin', color: { argb: border } },
        };
      };
      const styleHeader = (row) => {
        row.height = 26;
        row.eachCell((cell) => {
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          setBorders(cell);
        });
      };
      const styleDataRows = (sheet, startRow, endRow, moneyColumns = []) => {
        for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
          const row = sheet.getRow(rowNumber);
          row.height = 22;
          row.eachCell((cell) => {
            cell.font = { name: 'Calibri', size: 10, color: { argb: ink } };
            cell.alignment = { vertical: 'middle', wrapText: true };
            if (rowNumber % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: soft } };
            setBorders(cell);
          });
          moneyColumns.forEach((column) => {
            row.getCell(column).numFmt = moneyFormat;
            row.getCell(column).alignment = { vertical: 'middle', horizontal: 'right' };
          });
        }
      };

      const contractsSheet = workbook.addWorksheet('Contratos finalizados', {
        views: [{ state: 'frozen', ySplit: 8 }],
        pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });
      contractsSheet.columns = [
        { width: 7 }, { width: 15 }, { width: 15 }, { width: 30 }, { width: 24 },
        { width: 15 }, { width: 18 }, { width: 20 }, { width: 25 },
      ];
      contractsSheet.mergeCells('A1:I1');
      contractsSheet.getCell('A1').value = 'EL COPETÍN · CAJA GRANDE';
      contractsSheet.getCell('A1').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      contractsSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
      contractsSheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
      contractsSheet.getRow(1).height = 24;
      contractsSheet.mergeCells('A2:F2');
      contractsSheet.getCell('A2').value = 'Reporte de Cobros y Contratos Finalizados';
      contractsSheet.getCell('A2').font = { name: 'Calibri', size: 20, bold: true, color: { argb: ink } };
      contractsSheet.mergeCells('G2:I2');
      contractsSheet.getCell('G2').value = `Periodo: ${finalizedReceivablesReportRange}`;
      contractsSheet.getCell('G2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: muted } };
      contractsSheet.getCell('G2').alignment = { horizontal: 'right', vertical: 'middle' };
      contractsSheet.getRow(2).height = 30;
      contractsSheet.mergeCells('A3:F3');
      contractsSheet.getCell('A3').value = 'Historial de contratos sin saldo pendiente y finalizados administrativamente.';
      contractsSheet.getCell('A3').font = { name: 'Calibri', size: 10, italic: true, color: { argb: muted } };
      contractsSheet.mergeCells('G3:I3');
      contractsSheet.getCell('G3').value = `Generado: ${generatedAt}`;
      contractsSheet.getCell('G3').font = { name: 'Calibri', size: 9, color: { argb: muted } };
      contractsSheet.getCell('G3').alignment = { horizontal: 'right' };

      contractsSheet.mergeCells('A5:C5');
      contractsSheet.getCell('A5').value = `CONTRATOS EN RESULTADO\n${visibleFinalizedReceivableRows.length}`;
      contractsSheet.mergeCells('D5:F5');
      contractsSheet.getCell('D5').value = `TOTAL LIQUIDADO\n${visibleFinalizedReceivableTotalBs}`;
      contractsSheet.mergeCells('G5:I5');
      contractsSheet.getCell('G5').value = `MOVIMIENTOS DE COBRO\n${finalizedReceivablesCollectionRows.filter((row) => row.amountBs > 0).length}`;
      ['A5', 'D5', 'G5'].forEach((address, index) => {
        const cell = contractsSheet.getCell(address);
        cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: index === 1 ? green : navy } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index === 1 ? 'FFEDF9F0' : 'FFF1F5FA' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
      contractsSheet.getCell('D5').numFmt = moneyFormat;
      contractsSheet.getRow(5).height = 42;

      const contractHeaderRow = 7;
      contractsSheet.getRow(contractHeaderRow).values = ['N°', 'Contrato', 'OS', 'Cliente', 'Responsable', 'Fecha evento', 'Total liquidado', 'Finalizado', 'Finalizado por'];
      styleHeader(contractsSheet.getRow(contractHeaderRow));
      visibleFinalizedReceivableRows.forEach((row, index) => {
        const excelRow = contractsSheet.addRow([
          index + 1,
          row.contractCode || row.orderCode || '',
          row.orderCode || '',
          row.customerName || '',
          row.responsibleName || '',
          row.eventDate ? new Date(row.eventDate) : '',
          toNumber(row.settledBs),
          row.finalizedAt ? new Date(row.finalizedAt) : '',
          row.finalizedByName || '',
        ]);
        excelRow.getCell(6).numFmt = 'dd/mm/yyyy';
        excelRow.getCell(8).numFmt = 'dd/mm/yyyy hh:mm';
      });
      const contractEndRow = Math.max(contractHeaderRow, contractHeaderRow + visibleFinalizedReceivableRows.length);
      styleDataRows(contractsSheet, contractHeaderRow + 1, contractEndRow, [7]);
      if (visibleFinalizedReceivableRows.length) {
        contractsSheet.autoFilter = { from: { row: contractHeaderRow, column: 1 }, to: { row: contractEndRow, column: 9 } };
      }
      contractsSheet.pageSetup.printTitlesRow = `1:${contractHeaderRow}`;
      contractsSheet.headerFooter.oddFooter = '&LEl Copetín · Caja Grande&C&P de &N&RDocumento interno';

      const movementsSheet = workbook.addWorksheet('Detalle de cobros', {
        views: [{ state: 'frozen', ySplit: 7 }],
        pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });
      movementsSheet.columns = [
        { width: 7 }, { width: 15 }, { width: 15 }, { width: 28 }, { width: 15 },
        { width: 19 }, { width: 24 }, { width: 22 }, { width: 15 }, { width: 16 }, { width: 24 }, { width: 42 },
      ];
      movementsSheet.mergeCells('A1:L1');
      movementsSheet.getCell('A1').value = 'EL COPETÍN · DETALLE DE COBROS REGISTRADOS';
      movementsSheet.getCell('A1').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      movementsSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
      movementsSheet.mergeCells('A2:H2');
      movementsSheet.getCell('A2').value = 'Trazabilidad de cobros de contratos finalizados';
      movementsSheet.getCell('A2').font = { name: 'Calibri', size: 19, bold: true, color: { argb: ink } };
      movementsSheet.mergeCells('I2:L2');
      movementsSheet.getCell('I2').value = `Periodo: ${finalizedReceivablesReportRange}`;
      movementsSheet.getCell('I2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: muted } };
      movementsSheet.getCell('I2').alignment = { horizontal: 'right' };
      movementsSheet.mergeCells('A4:L4');
      movementsSheet.getCell('A4').value = `${finalizedReceivablesCollectionRows.filter((row) => row.amountBs > 0).length} movimientos de cobro vinculados a ${visibleFinalizedReceivableRows.length} contrato(s).`;
      movementsSheet.getCell('A4').font = { name: 'Calibri', size: 10, bold: true, color: { argb: orange } };

      const movementHeaderRow = 6;
      movementsSheet.getRow(movementHeaderRow).values = [
        'N°', 'Contrato', 'OS', 'Cliente', 'Fecha evento', 'Fecha / hora cobro', 'Qué se cobró', 'Cómo se cobró', 'Monto', 'Recibo', 'Registrado por', 'Detalle',
      ];
      styleHeader(movementsSheet.getRow(movementHeaderRow));
      finalizedReceivablesCollectionRows.forEach((movement, index) => {
        const row = movement.contractRow;
        const excelRow = movementsSheet.addRow([
          index + 1,
          row.contractCode || row.orderCode || '',
          row.orderCode || '',
          row.customerName || '',
          row.eventDate ? new Date(row.eventDate) : '',
          movement.createdAt ? new Date(movement.createdAt) : '',
          movement.concept || '',
          movement.paymentMethodLabel || '-',
          toNumber(movement.amountBs),
          movement.receiptCode || '-',
          movement.registeredBy || '-',
          movement.description || '',
        ]);
        excelRow.getCell(5).numFmt = 'dd/mm/yyyy';
        excelRow.getCell(6).numFmt = 'dd/mm/yyyy hh:mm';
      });
      const movementEndRow = Math.max(movementHeaderRow, movementHeaderRow + finalizedReceivablesCollectionRows.length);
      styleDataRows(movementsSheet, movementHeaderRow + 1, movementEndRow, [9]);
      if (finalizedReceivablesCollectionRows.length) {
        movementsSheet.autoFilter = { from: { row: movementHeaderRow, column: 1 }, to: { row: movementEndRow, column: 12 } };
      }
      movementsSheet.pageSetup.printTitlesRow = `1:${movementHeaderRow}`;
      movementsSheet.headerFooter.oddFooter = '&LEl Copetín · Caja Grande&C&P de &N&RDocumento interno';

      const buffer = await workbook.xlsx.writeBuffer();
      const range = bigCashWorkspaceRanges.receivables ?? {};
      const rangeFile = `${range.dateFrom || 'inicio'}-${range.dateTo || 'fin'}`;
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `reporte-cobros-finalizados-${rangeFile}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('No se pudo exportar el reporte de cobros finalizados.', error);
      window.alert('No se pudo generar el Excel. Intenta nuevamente.');
    } finally {
      setIsExportingFinalizedReceivables(false);
    }
  };

  const printFinalizedReceivablesReport = () => {
    const escapeHtml = (value) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
    const popup = window.open('', '_blank', 'width=1400,height=900');
    if (!popup) {
      window.alert('El navegador bloqueó la ventana de impresión. Habilita ventanas emergentes e intenta nuevamente.');
      return;
    }
    const contractRows = visibleFinalizedReceivableRows.map((row, index) => `
      <tr>
        <td class="center">${index + 1}</td>
        <td><strong>${escapeHtml(row.contractCode || row.orderCode || '—')}</strong><br><small>${escapeHtml(row.orderCode || '')}</small></td>
        <td>${escapeHtml(row.customerName || '—')}</td>
        <td>${escapeHtml(row.responsibleName || '—')}</td>
        <td class="center">${escapeHtml(formatDate(row.eventDate))}</td>
        <td class="amount">${escapeHtml(formatBs(row.settledBs))}</td>
        <td>${escapeHtml(formatDate(row.finalizedAt))}<br><small>${escapeHtml(row.finalizedByName || '—')}</small></td>
      </tr>`).join('');
    const collectionRows = finalizedReceivablesCollectionRows.map((movement, index) => {
      const row = movement.contractRow;
      return `<tr>
        <td class="center">${index + 1}</td>
        <td><strong>${escapeHtml(row.contractCode || row.orderCode || '—')}</strong><br><small>${escapeHtml(row.customerName || '')}</small></td>
        <td>${movement.createdAt ? `${escapeHtml(formatDate(movement.createdAt))}<br><small>${escapeHtml(getHourLabel(movement.createdAt))}</small>` : '—'}</td>
        <td><strong>${escapeHtml(movement.concept || '—')}</strong>${movement.description ? `<br><small>${escapeHtml(movement.description)}</small>` : ''}</td>
        <td>${escapeHtml(movement.paymentMethodLabel || '—')}</td>
        <td class="amount">${escapeHtml(formatBs(movement.amountBs))}</td>
        <td>${escapeHtml(movement.receiptCode || '—')}</td>
        <td>${escapeHtml(movement.registeredBy || '—')}</td>
      </tr>`;
    }).join('');
    popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de cobros y contratos finalizados</title><style>
      @page{size:A4 landscape;margin:10mm;}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#172033;margin:0;font-size:9px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.head{display:grid;grid-template-columns:1fr 260px;gap:20px;border-bottom:3px solid #173a70;padding-bottom:10px}.brand{font-size:8px;letter-spacing:.14em;color:#173a70;font-weight:800;text-transform:uppercase}.head h1{font-size:23px;margin:4px 0}.head p{color:#64748b;margin:0}.meta{border-left:1px solid #cbd5e1;padding-left:14px}.meta div{display:flex;justify-content:space-between;gap:10px;margin:3px 0}.meta span{color:#64748b;text-transform:uppercase;font-size:7px;font-weight:700}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.card{border:1px solid #d7dee8;border-top:3px solid #173a70;padding:8px 10px}.card span{display:block;color:#64748b;font-size:7px;font-weight:800;text-transform:uppercase}.card strong{display:block;font-size:17px;color:#173a70;margin-top:4px}.card.money{border-top-color:#16803c}.card.money strong{color:#16803c}.section{margin-top:13px}.section h2{font-size:12px;margin:0 0 5px;padding-bottom:4px;border-bottom:1px solid #cbd5e1}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#173a70;color:white;text-transform:uppercase;font-size:7px;padding:6px;border-right:1px solid rgba(255,255,255,.2)}td{padding:6px;border:1px solid #dbe2ea;vertical-align:top}tbody tr:nth-child(even){background:#f8fafc}.center{text-align:center}.amount{text-align:right;font-weight:800;white-space:nowrap}small{color:#64748b}.no-print{margin-top:12px;text-align:right}.no-print button{padding:9px 14px;border:0;border-radius:8px;background:#e84a00;color:white;font-weight:700}@media print{.no-print{display:none}}
    </style></head><body>
      <header class="head"><div><div class="brand">EL COPETÍN · CAJA GRANDE</div><h1>Reporte de Cobros y Contratos Finalizados</h1><p>Historial con trazabilidad de cobros registrados.</p></div><div class="meta"><div><span>Periodo</span><strong>${escapeHtml(finalizedReceivablesReportRange)}</strong></div><div><span>Generado</span><strong>${escapeHtml(new Intl.DateTimeFormat('es-BO',{dateStyle:'medium',timeStyle:'short'}).format(new Date()))}</strong></div><div><span>Contratos</span><strong>${visibleFinalizedReceivableRows.length}</strong></div></div></header>
      <section class="cards"><div class="card"><span>Contratos encontrados</span><strong>${visibleFinalizedReceivableRows.length}</strong></div><div class="card money"><span>Total liquidado</span><strong>${escapeHtml(formatBs(visibleFinalizedReceivableTotalBs))}</strong></div><div class="card"><span>Movimientos de cobro</span><strong>${finalizedReceivablesCollectionRows.filter((row)=>row.amountBs>0).length}</strong></div></section>
      <section class="section"><h2>Contratos finalizados</h2><table><thead><tr><th>N°</th><th>Contrato / OS</th><th>Cliente</th><th>Responsable</th><th>Evento</th><th>Total liquidado</th><th>Finalizado</th></tr></thead><tbody>${contractRows || '<tr><td colspan="7">Sin resultados.</td></tr>'}</tbody></table></section>
      <section class="section"><h2>Detalle de cobros realizados</h2><table><thead><tr><th>N°</th><th>Contrato / cliente</th><th>Fecha / hora</th><th>Qué se cobró</th><th>Cómo</th><th>Monto</th><th>Recibo</th><th>Registrado por</th></tr></thead><tbody>${collectionRows || '<tr><td colspan="8">Sin movimientos vinculados.</td></tr>'}</tbody></table></section>
      <div class="no-print"><button onclick="window.print()">Imprimir / guardar PDF</button></div>
    </body></html>`);
    popup.document.close();
    popup.focus();
  };
  const visibleGuaranteePendingRefundBs = sumBy(visibleGuaranteeRows, (row) => row.refundableBs);
  const visibleGuaranteeUnpaidBs = sumBy(visibleGuaranteeRows, (row) => row.unvalidatedBs);
  const visibleReturnedGuaranteeTotalBs = sumBy(visibleReturnedGuaranteeRows, (row) => row.appliedBs + row.refundedBs);
  const visibleReturnIssueTotalBs = sumBy(
    visibleReturnIssueRows,
    (row) => returnIssuesView === 'pending' ? row.pendingDamageBs : row.penaltyBs,
  );

  const getReturnIssueOwnerLabel = (owner) => {
    if (owner === 'transporte') return 'Transporte';
    if (owner === 'lavado') return 'Lavado';
    return 'Cliente / contrato';
  };

  const quickReportLinks = [
    'Libro de Caja Grande',
    'Libro de Caja Chica',
    'Flujo de Caja',
    'Movimientos por Fecha',
  ];

  const exportCashRows = (title, rows) => {
    const headers = ['Fecha', 'Caja', 'Tipo', 'Concepto', 'Referencia', 'Monto', 'Usuario'];
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const body = rows.map((movement) => [
      formatDateTime(movement.createdAt),
      isBigCash(movement) ? 'Caja Grande' : 'Caja Chica',
      movement.type || '-',
      movement.description || '-',
      getMovementReference(movement),
      toNumber(movement.amountBs).toFixed(2),
      movement.responsible || movement.createdBy || '-',
    ].map(escapeCsv).join(','));
    const csv = [headers.map(escapeCsv).join(','), ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title}-${selectedDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleQuickReport = (label) => {
    if (label === 'Libro de Caja Grande') {
      exportCashRows('libro-caja-grande', bigCashMovementRows);
      return;
    }
    if (label === 'Libro de Caja Chica') {
      exportCashRows('libro-caja-chica', sortedMovements.filter((movement) => isPettyCash(movement)));
      return;
    }
    if (label === 'Movimientos por Fecha') {
      exportCashRows(`movimientos-${selectedDate}`, sortedMovements.filter((movement) => getDateKey(movement.createdAt) === selectedDate));
      return;
    }
    exportCashRows('flujo-caja', sortedMovements);
  };

  const getBigCashMovementType = (movement) => {
    const amount = toNumber(movement?.amountBs);
    if (movement?.isInternalTransfer || amount < 0) {
      return {
        label: 'Retiro',
        className: 'out',
        icon: 'down',
        income: '-',
        withdrawal: formatBs(Math.abs(amount)),
      };
    }
    return {
      label: 'Ingreso',
      className: 'in',
      icon: 'up',
      income: formatBs(amount),
      withdrawal: '-',
    };
  };

  const runningBigCashBalance = (index) => {
    const laterMovements = filteredBigCashRows
      .slice(index + 1)
      .filter((movement) => !isVoidedCashMovement(movement));
    const laterDelta = sumBy(laterMovements, (movement) => movement.amountBs);
    return bigCashBalanceBs - laterDelta;
  };

  const resetCashForm = (patch = {}) => {
    setCashForm({
      amountBs: '',
      description: '',
      category: 'varios',
      paymentMethod: 'efectivo',
      paymentAccount: '',
      responsible: currentUserName,
      receipt: '',
      notes: '',
      linkedRentalId: '',
      debtId: '',
      supplierLoanId: '',
      debtKind: 'payable',
      debtDate: '',
      dueDate: '',
      employeeId: '',
      documentId: '',
      requestDate: selectedDate,
      ...patch,
    });
    setCashActionError('');
    setCashActionFeedback('');
  };

  const loadAdvancePersonnelOptions = useCallback(async (query = '') => {
    setAdvancePersonnelLoading(true);
    setAdvancePersonnelError('');
    try {
      const result = await api.personnel.getOptions({ query, limit: 20 });
      setAdvancePersonnelOptions(Array.isArray(result?.employees) ? result.employees : []);
    } catch (error) {
      setAdvancePersonnelError(error.message || 'No se pudo cargar el personal.');
    } finally {
      setAdvancePersonnelLoading(false);
    }
  }, []);

  const openCashAction = (type, patch = {}) => {
    resetCashForm(patch);
    if (type === 'advance') {
      setAdvancePeopleQuery('');
      void loadAdvancePersonnelOptions('');
    }
    setCashModal(type);
  };

  const handleAdvanceEmployeeChange = (employeeId) => {
    const employee = personnelEmployees.find((entry) => String(entry.id) === String(employeeId)) ?? null;
    setCashForm((current) => ({
      ...current,
      employeeId,
      responsible: employee?.fullName ?? '',
      documentId: employee?.documentId ?? '',
      description: employee ? `Adelanto de sueldo - ${employee.fullName}` : 'Adelanto de sueldo',
    }));
    if (employee) {
      setAdvancePeopleQuery(employee.fullName ?? '');
    }
  };


  const openPettyHistory = (movement = 'all') => {
    setPettyHistoryFilters((current) => ({
      ...current,
      movement,
      dateFrom: '',
      dateTo: '',
      query: '',
    }));
    setIsPettyHistoryOpen(true);
  };

  const applyPettyHistoryPeriod = (period) => {
    const range = getPeriodRange(selectedDate, period);
    setPettyHistoryFilters((current) => ({ ...current, ...range }));
  };

  const openEditPettyExpense = (movement) => {
    if (!isDeveloperUser || !movement || isVoidedCashMovement(movement)) return;
    setEditingPettyExpense(movement);
    setCashForm({
      amountBs: String(Math.abs(toNumber(movement.amountBs)) || ''),
      description: movement.description || '',
      category: movement.category || 'varios',
      paymentMethod: movement.paymentMethod || 'efectivo',
      paymentAccount: movement.paymentAccount || '',
      responsible: movement.responsible || movement.createdBy || '',
      receipt: movement.receipt || '',
      notes: movement.notes || '',
      linkedRentalId: movement.linkedRentalId || '',
      debtId: '', supplierLoanId: '', debtKind: 'payable', debtDate: '', dueDate: '',
      employeeId: '', documentId: '', requestDate: '',
    });
    setCashModal('expense');
    setCashActionError('');
    setCashActionFeedback('');
  };

  const handleDeletePettyExpenseAction = async (movement) => {
    if (!isDeveloperUser || !movement || isVoidedCashMovement(movement)) return;
    const reason = window.prompt('Motivo obligatorio para eliminar este gasto de Caja Chica:');
    if (!String(reason ?? '').trim()) return;
    if (!window.confirm(`Eliminar logicamente el gasto "${movement.description}" por ${formatBs(Math.abs(toNumber(movement.amountBs)))}?`)) return;
    setCashActionError('');
    try {
      await onDeletePettyExpense?.({ movementId: movement.id, reason: String(reason).trim() });
      setCashActionFeedback('Gasto eliminado correctamente. Se conservo la auditoria.');
      void loadPettySector('expenses', { filters: { category: pettyCashTypeFilter, query: pettyCashQuery } });
    } catch (error) {
      setCashActionError(error.message || 'No se pudo eliminar el gasto.');
    }
  };

  const closeCashAction = () => {
    setCashModal(null);
    setEditingPettyExpense(null);
    setAdvancePeopleQuery('');
    setCashActionError('');
  };

  const openCollectAction = (row) => {
    const contractReference = row.contractCode || row.orderCode;
    setCollectModal(row);
    setCollectForm({
      amountBs: String(row.pendingBs ?? ''),
      paymentMethod: 'efectivo',
      paymentAccount: '',
      receipt: '',
      note: row.status === 'Liquidacion'
        ? `Cobro liquidacion contrato ${contractReference}`
        : `Cobro saldo contrato ${contractReference}`,
    });
    setCashActionError('');
    setCashActionFeedback('');
  };

  const closeCollectAction = () => {
    setCollectModal(null);
    setCashActionError('');
  };

  const resolvePrintableCashMovementId = (result, preferredCashBoxType = '') => {
    if (!result) return '';
    if (result.id) return result.id;
    if (result.movement?.id) return result.movement.id;
    const rows = Array.isArray(result.movements) ? result.movements : [];
    if (rows.length === 0) return '';
    const preferred = rows.find((movement) => {
      if (preferredCashBoxType === 'BIG_CASH') return isBigCash(movement);
      if (preferredCashBoxType === 'PETTY_CASH') return isPettyCash(movement);
      return false;
    });
    return preferred?.id || rows[0]?.id || '';
  };

  const openReceiptWindow = () => {
    const printWindow = window.open('', '_blank', 'width=1120,height=760');
    if (!printWindow) {
      throw new Error('Chrome bloqueo la ventana del recibo. Habilita ventanas emergentes para este sitio.');
    }
    printWindow.document.open();
    printWindow.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Generando recibo</title></head><body style="font-family:Arial,sans-serif;padding:24px;color:#111827;"><strong>Generando recibo...</strong></body></html>');
    printWindow.document.close();
    printWindow.focus();
    return printWindow;
  };

  const writeReceiptWindow = (printWindow, result) => {
    if (!result?.html) {
      throw new Error('No se pudo generar el contenido del recibo.');
    }
    printWindow.document.open();
    printWindow.document.write(result.html);
    printWindow.document.close();
    printWindow.focus();
  };

  const printCashHistoryReport = async ({
    cashBoxType,
    rows,
    title,
    dateFrom = '',
    dateTo = '',
  }) => {
    let printWindow = null;
    try {
      printWindow = openReceiptWindow();
      const result = await api.cash.printHistoryReport({
        cashBoxType,
        movementIds: rows.map((movement) => movement.id),
        title,
        dateFrom,
        dateTo,
      });
      writeReceiptWindow(printWindow, result);
    } catch (error) {
      if (printWindow && !printWindow.closed) printWindow.close();
      setCashActionError(error.message || 'No se pudo generar el reporte de caja.');
    }
  };

  const printCashReceipt = async (movementOrId) => {
    const movement = typeof movementOrId === 'object' && movementOrId !== null
      ? movementOrId
      : sortedMovements.find((entry) => entry.id === movementOrId);
    const movementId = movement?.id ?? movementOrId;
    if (!movementId) return;
    const isPersonnelAdvanceMovement =
      normalizeText(movement?.accountingTag) === 'personnel_advance'
      || normalizeText(movement?.category).includes('adelanto');
    const printedByName = isPersonnelAdvanceMovement
      ? getPersonnelAdvanceRegisteredBy(movement)
      : currentUserName;
    let printWindow = null;
    try {
      printWindow = openReceiptWindow();
      const receiptPayload = {
        movementId,
        printedByName,
        movement: movement && typeof movement === 'object' ? movement : null,
      };
      let result = onPrintCashMovementReceipt
        ? await onPrintCashMovementReceipt(receiptPayload)
        : null;
      if (!result?.html) {
        result = await api.printer.printCashMovementReceipt(receiptPayload);
      }
      writeReceiptWindow(printWindow, result);
    } catch (error) {
      if (printWindow && !printWindow.closed) {
        printWindow.close();
      }
      setCashActionError(error.message || 'No se pudo abrir el recibo de caja.');
    }
  };

  const canPrintCashMovement = (movement) => Math.abs(toNumber(movement?.amountBs)) > 0 && !isVoidedCashMovement(movement);
  const canVoidCashMovement = (movement) => canPrintCashMovement(movement);

  const closeVoidReceiptAction = () => {
    setVoidReceiptModal(null);
    setVoidReceiptStep('reason');
    setVoidReceiptReason('');
    setCashActionError('');
  };

  const openVoidReceiptAction = (movement) => {
    if (!movement || !canVoidCashMovement(movement)) return;
    setVoidReceiptModal(movement);
    setVoidReceiptStep('reason');
    setVoidReceiptReason('');
    setVoidReceiptForm({
      amountBs: String(Math.abs(toNumber(movement.amountBs)) || ''),
      description: String(movement.description ?? '').replace(/^Reposicion caja chica:\s*/i, ''),
      category: movement.category || (movement.isInternalTransfer ? 'reposicion_caja_chica' : 'varios'),
      paymentMethod: movement.paymentMethod || 'efectivo',
      paymentAccount: movement.paymentAccount || '',
      responsible: movement.responsible || movement.createdBy || currentUserName,
      receipt: movement.receipt || '',
      notes: movement.notes || '',
      linkedRentalId: movement.linkedRentalId || movement.sourceId || '',
    });
    setCashActionError('');
    setCashActionFeedback('');
  };

  const handleConfirmVoidReason = (event) => {
    event.preventDefault();
    if (!voidReceiptReason.trim()) {
      setCashActionError('Debes indicar el motivo de anulacion.');
      return;
    }
    setCashActionError('');
    setVoidReceiptStep('edit');
  };

  const handleSubmitVoidReplacement = async (event) => {
    event.preventDefault();
    if (!voidReceiptModal) return;
    if (!beginCashSubmit()) return;
    setCashActionError('');
    try {
      const linkedTransportOption = transportContractOptions.find((entry) => entry.rentalId === voidReceiptForm.linkedRentalId) ?? null;
      const isTransportExpense = isPettyCash(voidReceiptModal)
        && (Boolean(linkedTransportOption) || String(voidReceiptForm.category ?? '').toLowerCase() === 'transporte');
      const result = await onVoidAndReplaceCashMovementReceipt?.({
        movementId: voidReceiptModal.id,
        reason: voidReceiptReason,
        createdBy: currentUserName,
        replacement: {
          amountBs: Math.max(0, toNumber(voidReceiptForm.amountBs)),
          description: voidReceiptForm.description,
          category: voidReceiptForm.category,
          paymentMethod: voidReceiptForm.paymentMethod,
          paymentAccount: voidReceiptForm.paymentMethod === 'qr' ? voidReceiptForm.paymentAccount : '',
          responsible: voidReceiptForm.responsible || currentUserName,
          receipt: voidReceiptForm.receipt,
          notes: voidReceiptForm.notes,
          linkedRentalId: linkedTransportOption?.rentalId ?? '',
          linkedContractId: linkedTransportOption?.contractId ?? '',
          linkedOrderCode: linkedTransportOption?.orderCode ?? '',
          accountingTag: isTransportExpense ? 'transport_expense' : '',
          transportExpenseBs: isTransportExpense ? Math.max(0, toNumber(voidReceiptForm.amountBs)) : 0,
          createdBy: currentUserName,
        },
      });
      await printCashReceipt(resolvePrintableCashMovementId(result, isPettyCash(voidReceiptModal) ? 'PETTY_CASH' : 'BIG_CASH'));
      setCashActionFeedback('Recibo anterior anulado y nuevo recibo generado.');
      closeVoidReceiptAction();
    } catch (error) {
      setCashActionError(error.message || 'No se pudo anular y reemplazar el recibo.');
    } finally {
      endCashSubmit();
    }
  };

  const handleSubmitCashAction = async (event) => {
    event.preventDefault();
    if (!cashModal) return;
    if (!beginCashSubmit()) return;
    const completedAction = cashModal;
    setCashActionError('');
    try {
      const amountBs = Math.max(0, toNumber(cashForm.amountBs));
      if (cashModal === 'openPetty') {
        const created = await onOpenCashSession?.({
          openingBigCashBs: 0,
          openingPettyCashBs: amountBs,
          openedBy: currentUserName,
          notes: cashForm.notes || cashForm.description || 'Apertura diaria de caja chica',
        });
        await printCashReceipt(resolvePrintableCashMovementId(created, 'PETTY_CASH'));
        setCashActionFeedback('Caja Chica aperturada desde Caja Grande.');
      } else if (cashModal === 'transfer') {
        const created = await onCreateCashMovement?.({
          type: 'transferencia',
          amountBs,
          description: cashForm.description || 'Reposicion de Caja Chica',
          category: 'reposicion_caja_chica',
          paymentMethod: cashForm.paymentMethod,
          paymentAccount: cashForm.paymentMethod === 'qr' ? cashForm.paymentAccount : '',
          responsible: cashForm.responsible || currentUserName,
          receipt: cashForm.receipt,
          notes: cashForm.notes,
          createdBy: currentUserName,
        });
        await printCashReceipt(resolvePrintableCashMovementId(created, 'BIG_CASH'));
        setCashActionFeedback('Reposicion registrada en Caja Grande y Caja Chica.');
      } else if (cashModal === 'expense') {
        const linkedTransportOption = transportContractOptions.find((entry) => entry.rentalId === cashForm.linkedRentalId) ?? null;
        const isTransportExpense = Boolean(linkedTransportOption) || String(cashForm.category ?? '').toLowerCase() === 'transporte';
        if (editingPettyExpense) {
          await onUpdatePettyExpense?.({
            movementId: editingPettyExpense.id,
            amountBs,
            description: cashForm.description,
            category: cashForm.category,
            paymentMethod: cashForm.paymentMethod,
            paymentAccount: cashForm.paymentMethod === 'qr' ? cashForm.paymentAccount : '',
            responsible: cashForm.responsible || currentUserName,
            receipt: cashForm.receipt,
            notes: cashForm.notes,
            reason: 'Edicion manual autorizada por Developer.',
          });
          setCashActionFeedback('Gasto de Caja Chica actualizado.');
        } else {
        const created = await onCreateCashMovement?.({
          type: 'egreso',
          cashBoxType: 'PETTY_CASH',
          amountBs,
          description: cashForm.description,
          category: cashForm.category,
          paymentMethod: cashForm.paymentMethod,
          paymentAccount: cashForm.paymentMethod === 'qr' ? cashForm.paymentAccount : '',
          responsible: cashForm.responsible || currentUserName,
          receipt: cashForm.receipt,
          notes: cashForm.notes,
          linkedRentalId: linkedTransportOption?.rentalId ?? '',
          linkedContractId: linkedTransportOption?.contractId ?? '',
          linkedOrderCode: linkedTransportOption?.orderCode ?? '',
          accountingTag: isTransportExpense ? 'transport_expense' : '',
          transportExpenseBs: isTransportExpense ? amountBs : 0,
          createdBy: currentUserName,
        });
        await printCashReceipt(resolvePrintableCashMovementId(created, 'PETTY_CASH'));
        setCashActionFeedback('Gasto registrado en Caja Chica.');
        }
      } else if (cashModal === 'advance') {
        const employee = personnelEmployees.find((entry) => String(entry.id) === String(cashForm.employeeId)) ?? null;
        if (!employee) {
          throw new Error('Selecciona un trabajador existente del modulo Personal.');
        }
        const employeeName = String(employee.fullName ?? '').trim();
        const documentId = String(employee.documentId ?? '').trim();
        const requestDate = cashForm.requestDate || selectedDate;
        if (!documentId) {
          throw new Error('El trabajador seleccionado no tiene carnet registrado en Personal.');
        }
        const created = await onCreateCashMovement?.({
          type: 'egreso',
          cashBoxType: 'PETTY_CASH',
          amountBs,
          description: `Adelanto de sueldo - ${employeeName}`,
          category: 'adelanto_personal',
          paymentMethod: 'efectivo',
          responsible: employeeName,
          receipt: documentId ? `CI ${documentId}` : '',
          notes: `Fecha de solicitud: ${formatDate(requestDate)} | CI: ${documentId}${cashForm.notes ? ` | ${cashForm.notes}` : ''}`,
          accountingTag: 'personnel_advance',
          createdBy: currentUserName,
          createdByName: currentUserName,
          userName: currentUserName,
        });
        await printCashReceipt(created?.movement ?? created ?? resolvePrintableCashMovementId(created, 'PETTY_CASH'));
        setCashActionFeedback('Adelanto registrado en Caja Chica y recibo generado.');
      } else if (cashModal === 'debt') {
        const debtKind = normalizeCashDebtKind(cashForm.debtKind);
        let linkedMovementResult = null;
        let linkedMovementId = '';
        let linkedMovementReceipt = '';
        if (debtKind === 'lia_reimbursement') {
          linkedMovementResult = await onCreateCashMovement?.({
            type: 'egreso',
            cashBoxType: 'PETTY_CASH',
            amountBs,
            description: cashForm.description,
            category: cashForm.category || 'reembolso_sra_lia',
            paymentMethod: cashForm.paymentMethod,
            paymentAccount: cashForm.paymentMethod === 'qr' ? cashForm.paymentAccount : '',
            responsible: cashForm.responsible || 'SRA. LIA',
            receipt: cashForm.receipt,
            notes: cashForm.notes,
            accountingTag: 'lia_reimbursement_debt',
            createdBy: currentUserName,
          });
          linkedMovementId = resolvePrintableCashMovementId(linkedMovementResult, 'PETTY_CASH');
          const movement = linkedMovementResult?.movement
            ?? (Array.isArray(linkedMovementResult?.movements) ? linkedMovementResult.movements.find((entry) => entry.id === linkedMovementId) : null);
          linkedMovementReceipt = movement?.receiptCode ?? movement?.receipt ?? '';
          await printCashReceipt(linkedMovementId);
        }
        await onCreateCashDebt?.({
          description: cashForm.description,
          personName: debtKind === 'lia_reimbursement' ? (cashForm.responsible || 'SRA. LIA') : cashForm.responsible,
          amountBs,
          debtDate: cashForm.debtDate || selectedDate,
          dueDate: cashForm.dueDate || null,
          debtKind,
          category: cashForm.category,
          sourceMovementId: linkedMovementId,
          sourceMovementReceipt: linkedMovementReceipt,
          notes: cashForm.notes,
          createdBy: currentUserName,
        });
        setCashActionFeedback(debtKind === 'lia_reimbursement'
          ? 'Gasto descontado de Caja Chica y reembolso registrado por cobrar a Sra. Lia.'
          : 'Deuda registrada. No afecta el saldo hasta que se pague.');
      } else if (cashModal === 'payDebt') {
        const paid = await onPayCashDebt?.({
          debtId: cashForm.debtId,
          amountBs,
          paymentDate: selectedDate,
          paymentMethod: cashForm.paymentMethod,
          notes: cashForm.notes,
          paidBy: currentUserName,
          createdBy: currentUserName,
        });
        await printCashReceipt(resolvePrintableCashMovementId(paid, 'PETTY_CASH'));
        setCashActionFeedback('Pago de deuda registrado en Caja Chica.');
      } else if (cashModal === 'supplierLoan') {
        const loan = supplierLoanRows.find((entry) => String(entry.id) === String(cashForm.supplierLoanId));
        if (!loan) {
          throw new Error('Selecciona el prestamo de proveedor que vas a pagar.');
        }
        if (amountBs < loan.totalBs) {
          throw new Error(`El pago debe cubrir el total del prestamo: ${formatBs(loan.totalBs)}.`);
        }
        const created = await onCreateCashMovement?.({
          type: 'egreso',
          cashBoxType: 'PETTY_CASH',
          amountBs,
          description: cashForm.description || `Pago proveedor ${loan.supplierName}`,
          category: 'pago_proveedor',
          paymentMethod: cashForm.paymentMethod,
          paymentAccount: cashForm.paymentMethod === 'qr' ? cashForm.paymentAccount : '',
          responsible: loan.supplierName || cashForm.responsible || currentUserName,
          receipt: cashForm.receipt || loan.loanCode,
          notes: cashForm.notes || `Prestamo ${loan.loanCode} | Contrato ${loan.reference} | ${loan.itemSummary || 'Items de proveedor'}`,
          accountingTag: 'supplier_loan_payment',
          linkedRentalId: loan.sourceRentalId ?? '',
          linkedContractId: loan.sourceContractId ?? '',
          linkedOrderCode: loan.sourceOrderCode ?? '',
          createdBy: currentUserName,
        });
        await onUpdateSupplierLoanStatus?.({ id: loan.id, status: 'liquidado' });
        await printCashReceipt(resolvePrintableCashMovementId(created, 'PETTY_CASH'));
        setCashActionFeedback('Prestamo de proveedor pagado desde Caja Chica.');
      } else if (cashModal === 'income') {
        const created = await onCreateCashMovement?.({
          type: 'ingreso',
          cashBoxType: 'BIG_CASH',
          amountBs,
          description: cashForm.description,
          category: cashForm.category || 'ingreso_manual',
          paymentMethod: cashForm.paymentMethod,
          paymentAccount: cashForm.paymentMethod === 'qr' ? cashForm.paymentAccount : '',
          responsible: cashForm.responsible || currentUserName,
          receipt: cashForm.receipt,
          notes: cashForm.notes,
          createdBy: currentUserName,
        });
        await printCashReceipt(resolvePrintableCashMovementId(created, 'BIG_CASH'));
        setCashActionFeedback('Ingreso registrado en Caja Grande.');
      } else if (cashModal === 'closePetty') {
        await onCloseCashSession?.({
          countedBigCashBs: bigCashBalanceBs,
          countedPettyCashBs: amountBs,
          closedBy: currentUserName,
          notes: cashForm.notes || cashForm.description || 'Cierre diario de caja chica',
        });
        setCashActionFeedback('Caja Chica cerrada y saldo devuelto a Caja Grande.');
      }
      closeCashAction();
      const sectorToRefresh = {
        expense: 'expenses',
        advance: 'advances',
        debt: 'debts',
        payDebt: 'debts',
        supplierLoan: 'suppliers',
      }[completedAction];
      if (sectorToRefresh) {
        const filters = sectorToRefresh === 'expenses'
          ? { category: pettyCashTypeFilter, query: pettyCashQuery }
          : {};
        void loadPettySector(sectorToRefresh, { filters });
      }
    } catch (error) {
      setCashActionError(error.message || 'No se pudo completar la operacion.');
    } finally {
      endCashSubmit();
    }
  };

  const handleDeleteCashDebt = async (debt) => {
    if (!debt || !isDeveloperUser) return;
    const confirmed = window.confirm(`Eliminar ${debt.code || 'esta deuda'}? Esta accion solo quitara el registro de deuda.`);
    if (!confirmed) return;
    setDebtActionMenuId('');
    setCashActionError('');
    try {
      await onDeleteCashDebt?.({ debtId: debt.id, deletedBy: currentUserName });
      setCashActionFeedback('Deuda eliminada correctamente.');
      void loadPettySector('debts');
    } catch (error) {
      setCashActionError(error.message || 'No se pudo eliminar la deuda.');
    }
  };

  const handleSubmitCollectAction = async (event) => {
    event.preventDefault();
    if (!collectModal) return;
    if (!beginCashSubmit()) return;
    setCashActionError('');
    try {
      const result = await onCollectReceivable?.({
        rentalId: collectModal.id,
        amountBs: Math.max(0, toNumber(collectForm.amountBs)),
        collectionTarget: collectModal.collectionTarget || 'balance',
        collectionBreakdown: collectModal.collectionTarget === 'damage'
          ? [{ target: 'damage', amountBs: Math.max(0, toNumber(collectForm.amountBs)) }]
          : undefined,
        paymentMethod: collectForm.paymentMethod,
        paymentAccount: collectForm.paymentMethod === 'qr' ? collectForm.paymentAccount : '',
        receipt: collectForm.receipt,
        note: collectForm.note,
        createdBy: currentUserName,
      });
      await printCashReceipt(resolvePrintableCashMovementId(result, 'BIG_CASH'));
      setCashActionFeedback('Cobro registrado en Caja Grande.');
      closeCollectAction();
    } catch (error) {
      setCashActionError(error.message || 'No se pudo registrar el cobro.');
    } finally {
      endCashSubmit();
    }
  };

  const openGuaranteeRefund = (row) => {
    if (row && !row.isMoneyHeld) {
      setCashActionError('Esta garantía figura como debe: no hay dinero recibido para devolver.');
      return;
    }
    if (row && !row.isReadyToReturn) {
      setCashActionError('Todavía no se puede devolver esta garantía: primero debe volver el material.');
      return;
    }
    if (!row) return;
    setCashActionError('');
    setGuaranteeRefundForm({
      paymentMethod: row.refundDefaultMethod || 'efectivo',
      paymentAccount: row.refundDefaultMethod === 'qr' ? row.refundDefaultAccount : '',
      note: '',
    });
    setGuaranteeRefundModal(row);
  };

  const closeGuaranteeRefund = () => {
    if (isSubmittingCash) return;
    setGuaranteeRefundModal(null);
    setGuaranteeRefundForm({ paymentMethod: 'efectivo', paymentAccount: '', note: '' });
  };

  const handleReturnGuarantee = async (event) => {
    event?.preventDefault?.();
    const row = guaranteeRefundModal;
    if (!row || !beginCashSubmit()) return;
    if (guaranteeRefundForm.paymentMethod === 'qr' && !guaranteeRefundForm.paymentAccount) {
      setCashActionError('Selecciona la cuenta QR desde la que se devolverá la garantía.');
      endCashSubmit();
      return;
    }
    setCashActionError('');
    try {
      const created = await onCreateCashMovement?.({
        type: 'egreso',
        cashBoxType: 'BIG_CASH',
        amountBs: row.refundableBs,
        description: `Devolucion garantia: ${row.customerName}`,
        category: 'garantia_devuelta_manual',
        paymentMethod: guaranteeRefundForm.paymentMethod,
        paymentAccount: guaranteeRefundForm.paymentMethod === 'qr' ? guaranteeRefundForm.paymentAccount : '',
        responsible: currentUserName,
        receipt: '',
        notes: guaranteeRefundForm.note || `Devolucion de garantia del contrato ${row.contractCode}`,
        linkedRentalId: row.rentalId,
        linkedContractId: row.contractId,
        linkedOrderCode: row.orderCode,
        accountingTag: 'guarantee_refund',
        createdBy: currentUserName,
      });
      await printCashReceipt(resolvePrintableCashMovementId(created, 'BIG_CASH'));
      setCashActionFeedback(`Garantía devuelta para contrato ${row.contractCode}.`);
      setGuaranteeRefundModal(null);
      setGuaranteeRefundForm({ paymentMethod: 'efectivo', paymentAccount: '', note: '' });
    } catch (error) {
      setCashActionError(error.message || 'No se pudo devolver la garantía.');
    } finally {
      endCashSubmit();
    }
  };

  const getCashModalTitle = () => {
    if (cashModal === 'openPetty') return 'Aperturar Caja Chica';
    if (cashModal === 'transfer') return 'Egreso de Caja Grande a Caja Chica';
    if (cashModal === 'expense') return editingPettyExpense ? 'Editar gasto de Caja Chica' : 'Registrar gasto de Caja Chica';
    if (cashModal === 'advance') return 'Registrar adelanto de personal';
    if (cashModal === 'debt') return 'Registrar deuda';
    if (cashModal === 'payDebt') return 'Pagar deuda';
    if (cashModal === 'supplierLoan') return 'Pagar proveedor';
    if (cashModal === 'income') return 'Registrar ingreso de Caja Grande';
    if (cashModal === 'closePetty') return 'Cerrar Caja Chica';
    return 'Movimiento de caja';
  };

  const renderReceiptActions = (movement) => {
    if (isDeletedCashMovement(movement)) {
      return (
        <div className="cash-receipt-status">
          <span className="cash-receipt-voided">Eliminado</span>
          {movement.deletionReason ? <small title={movement.deletionReason}>{movement.deletionReason}</small> : null}
        </div>
      );
    }
    if (isVoidedCashMovement(movement)) {
      return (
        <div className="cash-receipt-status">
          <span className="cash-receipt-voided">Anulado</span>
          {movement.voidReason ? <small title={movement.voidReason}>{movement.voidReason}</small> : null}
        </div>
      );
    }
    if (!canPrintCashMovement(movement)) {
      return <span className="cash-receipt-muted">Sin recibo</span>;
    }
    const isActivePettyExpense = isPettyCash(movement)
      && Number(movement?.amountBs ?? 0) < 0
      && !movement?.isInternalTransfer;
    if (isActivePettyExpense) {
      return (
        <div className="petty-debt-actions">
          <div className="petty-debt-menu">
            <button
              type="button"
              className="petty-debt-menu-button"
              aria-label={`Opciones del gasto ${movement.description || movement.id}`}
              onClick={() => setPettyExpenseActionMenuId((current) => current === movement.id ? '' : movement.id)}
            >
              ⋮
            </button>
            {pettyExpenseActionMenuId === movement.id ? (
              <div className="petty-debt-menu-popover">
                <button type="button" onClick={() => { setPettyExpenseActionMenuId(''); printCashReceipt(movement); }}>
                  Recibo
                </button>
                {isDeveloperUser ? (
                  <button type="button" onClick={() => { setPettyExpenseActionMenuId(''); openEditPettyExpense(movement); }}>
                    Editar
                  </button>
                ) : null}
                {isDeveloperUser ? (
                  <button type="button" onClick={() => { setPettyExpenseActionMenuId(''); handleDeletePettyExpenseAction(movement); }}>
                    Eliminar
                  </button>
                ) : null}
                <button type="button" onClick={() => { setPettyExpenseActionMenuId(''); openVoidReceiptAction(movement); }}>
                  Anular
                </button>
              </div>
            ) : null}
          </div>
        </div>
      );
    }
    return (
      <div className="cash-receipt-actions">
        <button
          type="button"
          className="cash-receipt-action"
          onClick={() => printCashReceipt(movement)}
          title="Previsualizar recibo"
        >
          Recibo
        </button>
        <button
          type="button"
          className="cash-receipt-action danger"
          onClick={() => openVoidReceiptAction(movement)}
          title="Anular recibo y generar reemplazo"
        >
          Anular
        </button>
      </div>
    );
  };

  const renderBigCashListModal = () => {
    if (!bigCashListModal) return null;
    const buildMovementConfig = ({ title, subtitle, rows }) => ({
      title,
      subtitle,
      rows,
      colSpan: 8,
      searchText: (movement) => [
        movement.description,
        getMovementReference(movement),
        movement.responsible,
        movement.createdBy,
        getMovementUserLabel(movement),
        movement.receipt,
        movement.receiptCode,
        movement.createdAt,
        movement.amountBs,
      ].join(' '),
      renderHeader: () => (
        <tr>
          <th>Fecha</th>
          <th>Concepto</th>
          <th>Referencia</th>
          <th>Metodo</th>
          <th>Ingreso</th>
          <th>Retiro</th>
          <th>Usuario</th>
          <th />
        </tr>
      ),
      renderRow: (movement) => {
        const meta = getBigCashMovementType(movement);
        const paymentMeta = getPaymentMethodMeta(movement.paymentMethod);
        return (
          <tr key={movement.id} className={isVoidedCashMovement(movement) ? 'cash-row-voided' : ''}>
            <td style={{ verticalAlign: 'top' }}><strong style={{ display: 'block' }}>{formatDate(movement.createdAt)}</strong><small style={{ display: 'block' }}>{getHourLabel(movement.createdAt)}</small></td>
            <td><strong>{movement.description}</strong></td>
            <td>{getMovementReference(movement)}</td>
            <td><span className={`payment-method-pill ${paymentMeta.className}`}>{getPaymentMethodLabel(movement)}</span></td>
            <td className="amount">{meta.income}</td>
            <td className="negative amount">{meta.withdrawal}</td>
            <td><span className="bigcash-user-label">{getMovementUserLabel(movement)}</span></td>
            <td>
                          {canPrintCashMovement(movement)
                            ? <button type="button" className="accounting-inline-action" onClick={() => printCashReceipt(movement)}>Recibo</button>
                            : <span className="cash-receipt-muted">Sin recibo</span>}
                        </td>
          </tr>
        );
      },
    });
    const modalConfig = {
      balanceMovements: buildMovementConfig({
        title: 'Movimientos del total fisico',
        subtitle: 'Movimientos de Caja Grande del periodo seleccionado.',
        rows: periodBigCashRows,
      }),
      dayIncome: buildMovementConfig({
        title: 'Ingresos cobrados del dia',
        subtitle: `Recibos cobrados el ${formatDate(selectedDate)}.`,
        rows: dayBigCashIncomeRows,
      }),
      monthIncome: buildMovementConfig({
        title: 'Ingresos cobrados del mes',
        subtitle: `Recibos cobrados del ${formatDate(monthStartDate)} al ${formatDate(selectedDate)}.`,
        rows: monthBigCashIncomeRows,
      }),
      guaranteeReceipts: buildMovementConfig({
        title: 'Recibos de garantias retenidas',
        subtitle: 'Ingresos de garantia registrados en Caja Grande.',
        rows: bigCashGuaranteeRows,
      }),
      monthTransfers: buildMovementConfig({
        title: 'Retiros a Caja Chica del mes',
        subtitle: `Reposiciones enviadas a Caja Chica del ${formatDate(monthStartDate)} al ${formatDate(selectedDate)}.`,
        rows: monthBigCashTransferRows,
      }),
      receivables: {
        title: 'Contratos por cobrar',
        subtitle: 'Saldos pendientes organizados por contrato, cliente, responsable y fecha del evento.',
        rows: pendingReceivableRows,
        colSpan: 6,
        searchText: (row) => [
          row.contractCode,
          row.orderCode,
          row.customerName,
          row.responsibleName,
          row.eventDate,
          row.pendingBs,
        ].join(' '),
        renderHeader: () => (
          <tr>
            <th>Contrato</th>
            <th>Cliente</th>
            <th>Responsable</th>
            <th>Fecha evento</th>
            <th>A cobrar</th>
            <th />
          </tr>
        ),
        renderRow: (row) => (
          <tr key={row.id}>
            <td><strong>{row.contractCode || row.orderCode}</strong><small>{row.orderCode}</small></td>
            <td>{row.customerName}</td>
            <td>{row.responsibleName}</td>
            <td>{formatDate(row.eventDate)}</td>
            <td className="amount">
              <strong>{formatBs(row.pendingBs)}</strong>
              <small>Contrato {formatBs(row.contractPendingBs)} · Transporte {formatBs(row.transportPendingBs)} · Daños {formatBs(row.damagePendingBs)}</small>
            </td>
            <td><button type="button" className="accounting-inline-action" onClick={() => openCollectAction(row)}>Cobrar</button></td>
          </tr>
        ),
        monthlyBrowser: true,
        getMonthKey: (row) => getMonthKey(row.eventDate),
      },
      guarantees: {
        title: 'Garantías pendientes y por devolver',
        subtitle: 'Separa lo acordado, pagado, aplicado, devuelto y todavía pendiente por contrato.',
        rows: guaranteesToReturnRows,
        colSpan: 12,
        searchText: (row) => [
          row.contractCode,
          row.orderCode,
          row.customerName,
          row.responsibleName,
          row.eventDate,
          row.statusLabel,
          row.paymentMethodLabel,
          row.guaranteePaidBs,
          row.appliedBs,
          row.refundableBs,
          row.unvalidatedBs,
        ].join(' '),
        renderHeader: () => (
          <tr>
            <th>Contrato</th>
            <th>Cliente</th>
            <th>Responsable</th>
            <th>Fecha evento</th>
            <th>Situación</th>
            <th>Acordada</th>
            <th>Pagada</th>
            <th>Aplicado</th>
            <th>Ya devuelto</th>
            <th>Saldo por devolver</th>
            <th>Falta pagar</th>
            <th />
          </tr>
        ),
        renderRow: (row) => (
          <tr key={row.id}>
            <td><strong>{row.contractCode}</strong><small>{row.orderCode}</small></td>
            <td>{row.customerName}</td>
            <td>{row.responsibleName}</td>
            <td>{formatDate(row.eventDate)}</td>
            <td><span className={`bigcash-status-pill ${row.isReadyToReturn ? 'ready' : 'waiting'}`}>{row.statusLabel}</span></td>
            <td className="amount">{formatBs(row.declaredBs)}</td>
            <td className="amount">{formatBs(row.guaranteePaidBs)}<small>{row.paymentMethodLabel}</small></td>
            <td className="amount">{formatBs(row.appliedBs)}</td>
            <td className="amount">{formatBs(row.refundedBs)}</td>
            <td className="amount"><strong>{formatBs(row.refundableBs)}</strong></td>
            <td className="amount">{formatBs(row.unvalidatedBs)}</td>
            <td>
              <button
                type="button"
                className="accounting-inline-action"
                onClick={() => openGuaranteeRefund(row)}
                disabled={!row.isReadyToReturn || !row.isMoneyHeld || isSubmittingCash}
                title={row.isMoneyHeld ? 'Devolver garantía y generar recibo' : 'Garantía pendiente de cobro, no hay dinero para devolver'}
              >
                {row.isReadyToReturn && row.isMoneyHeld ? 'Devolver' : row.isMoneyHeld ? 'No listo' : 'Sin dinero'}
              </button>
            </td>
          </tr>
        ),
        monthlyBrowser: true,
        getMonthKey: (row) => getMonthKey(row.eventDate),
      },
      movements: buildMovementConfig({
        title: 'Movimientos de Caja Grande',
        subtitle: 'Historial completo filtrado por el periodo actual.',
        rows: filteredBigCashRows,
      }),
    }[bigCashListModal];

    if (!modalConfig) return null;
    const normalizedQuery = normalizeText(bigCashListQuery);
    const searchedRows = normalizedQuery
      ? modalConfig.rows.filter((row) => normalizeText(modalConfig.searchText(row)).includes(normalizedQuery))
      : modalConfig.rows;
    const shouldShowMonthlyBrowser = Boolean(modalConfig.monthlyBrowser);
    const availableYears = shouldShowMonthlyBrowser
      ? [...new Set(modalConfig.rows.map((row) => modalConfig.getMonthKey(row).slice(0, 4)).filter(Boolean))]
        .sort((a, b) => Number(b) - Number(a))
      : [];
    const monthCounts = shouldShowMonthlyBrowser
      ? searchedRows.reduce((counts, row) => {
        const monthKey = modalConfig.getMonthKey(row);
        if (!monthKey) return counts;
        counts.set(monthKey, (counts.get(monthKey) ?? 0) + 1);
        return counts;
      }, new Map())
      : new Map();
    const selectedMonthHasRows = shouldShowMonthlyBrowser && bigCashListMonth
      ? monthCounts.has(bigCashListMonth)
      : false;
    const activeMonth = selectedMonthHasRows ? bigCashListMonth : '';
    const modalRows = activeMonth
      ? searchedRows.filter((row) => modalConfig.getMonthKey(row) === activeMonth)
      : searchedRows;

    return (
      <div className="accounting-modal-backdrop" onClick={() => setBigCashListModal(null)}>
        <section className="accounting-modal bigcash-list-modal" onClick={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h3>{modalConfig.title}</h3>
              <small>{modalConfig.subtitle}</small>
            </div>
            <button type="button" className="modal-close" onClick={() => setBigCashListModal(null)}>×</button>
          </header>
          <div className="bigcash-list-toolbar">
            <label>
              <MiniIcon kind="search" />
              <input
                value={bigCashListQuery}
                onChange={(event) => {
                  setBigCashListQuery(event.target.value);
                  setBigCashListMonth('');
                }}
                placeholder="Buscar por contrato, cliente, responsable, fecha o monto..."
              />
            </label>
            <span>{modalRows.length} de {modalConfig.rows.length} registros</span>
          </div>
          {shouldShowMonthlyBrowser ? (
            <div className="bigcash-month-browser">
              <div className="bigcash-month-browser-head">
                <strong>{activeMonth ? `Mostrando ${getMonthLabel(activeMonth)} ${activeMonth.slice(0, 4)}` : 'Todos los meses'}</strong>
                <button type="button" className={!activeMonth ? 'active' : ''} onClick={() => setBigCashListMonth('')}>
                  Todos <span>{searchedRows.length}</span>
                </button>
              </div>
              <div className="bigcash-month-years">
                {availableYears.map((year) => (
                  <section className="bigcash-month-year" key={year}>
                    <h4>{year}</h4>
                    <div className="bigcash-month-grid">
                      {MONTH_SHORT_LABELS.map((label, index) => {
                        const monthKey = `${year}-${String(index + 1).padStart(2, '0')}`;
                        const count = monthCounts.get(monthKey) ?? 0;
                        const isActive = activeMonth === monthKey;
                        return (
                          <button
                            type="button"
                            key={monthKey}
                            className={isActive ? 'active' : ''}
                            onClick={() => count > 0 && setBigCashListMonth(monthKey)}
                            disabled={count === 0}
                            title={count > 0 ? `${count} registros en ${label} ${year}` : `Sin registros en ${label} ${year}`}
                          >
                            <span>{label}</span>
                            <strong>{count}</strong>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : null}
          <div className="bigcash-table-wrap">
            <table className="accounting-table bigcash-table">
              <thead>{modalConfig.renderHeader()}</thead>
              <tbody>
                {modalRows.map(modalConfig.renderRow)}
                {modalRows.length === 0 ? (
                  <tr><td colSpan={modalConfig.colSpan}><p className="status">No hay registros para mostrar.</p></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  };

  const renderPettyHistoryModal = () => {
    if (!isPettyHistoryOpen) return null;
    return (
      <div className="accounting-modal-backdrop" onClick={() => setIsPettyHistoryOpen(false)}>
        <section className="accounting-modal petty-history-modal" onClick={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h3>Historial completo de Caja Chica</h3>
              <small>Reposiciones, gastos, recibos anulados y movimientos vinculados.</small>
            </div>
            <button type="button" className="orders-modal-close" onClick={() => setIsPettyHistoryOpen(false)}>x</button>
          </header>

          <div className="petty-history-summary-strip">
            <article>
              <small>Reposiciones validas</small>
              <strong className="value-green">{formatBs(pettyHistorySummary.repositionsBs)}</strong>
            </article>
            <article>
              <small>Gastos validos</small>
              <strong className="value-orange">- {formatBs(pettyHistorySummary.expensesBs)}</strong>
            </article>
            <article>
              <small>Neto del filtro</small>
              <strong className={pettyHistorySummary.netBs < 0 ? 'value-orange' : 'value-blue'}>{formatBs(pettyHistorySummary.netBs)}</strong>
            </article>
            <article>
              <small>Anulados visibles</small>
              <strong>{pettyHistorySummary.voidedCount}</strong>
            </article>
          </div>

          {pettyHistoryLoading ? <p className="status">Cargando únicamente el historial de Caja Chica...</p> : null}
          {pettyHistoryError ? <p className="status error">{pettyHistoryError}</p> : null}

          <div className="petty-history-filters">
            <label>
              Desde
              <input
                type="date"
                value={pettyHistoryFilters.dateFrom}
                onChange={(event) => setPettyHistoryFilters((current) => ({ ...current, dateFrom: event.target.value }))}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={pettyHistoryFilters.dateTo}
                onChange={(event) => setPettyHistoryFilters((current) => ({ ...current, dateTo: event.target.value }))}
              />
            </label>
            <label>
              Movimiento
              <select
                value={pettyHistoryFilters.movement}
                onChange={(event) => setPettyHistoryFilters((current) => ({ ...current, movement: event.target.value }))}
              >
                <option value="all">Todos</option>
                <option value="reposition">Reposiciones</option>
                <option value="expense">Gastos</option>
                <option value="transport">Gastos de transporte</option>
                <option value="voided">Anulados</option>
              </select>
            </label>
            <label>
              Tipo de gasto
              <select
                value={pettyHistoryFilters.category}
                onChange={(event) => setPettyHistoryFilters((current) => ({ ...current, category: event.target.value }))}
              >
                <option value="all">Todos</option>
                {PETTY_EXPENSE_CATEGORIES.map((category) => (
                  <option key={category.id} value={category.className}>{category.label}</option>
                ))}
                <option value="supplier">Proveedor</option>
                <option value="other">Varios</option>
              </select>
            </label>
            <label className="petty-history-search">
              Buscar
              <input
                value={pettyHistoryFilters.query}
                onChange={(event) => setPettyHistoryFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="Concepto, proveedor, recibo, contrato..."
              />
            </label>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setPettyHistoryFilters({ dateFrom: '', dateTo: '', movement: 'all', category: 'all', query: '' })}
            >
              Limpiar
            </button>
          </div>

          <div className="petty-history-report-bar">
            <span>Periodo rapido:</span>
            <button type="button" onClick={() => applyPettyHistoryPeriod('day')}>Dia</button>
            <button type="button" onClick={() => applyPettyHistoryPeriod('week')}>Semana</button>
            <button type="button" onClick={() => applyPettyHistoryPeriod('month')}>Mes</button>
            <button
              type="button"
              className="primary-button"
              disabled={filteredPettyHistoryRows.length === 0}
              onClick={() => printCashHistoryReport({
                cashBoxType: 'PETTY_CASH',
                rows: filteredPettyHistoryRows,
                title: 'Libro de Caja Chica',
                dateFrom: pettyHistoryFilters.dateFrom,
                dateTo: pettyHistoryFilters.dateTo,
              })}
            >
              <MiniIcon kind="report" />
              Imprimir reporte
            </button>
          </div>

          <div className="petty-history-modal-table-wrap">
            <table className="accounting-table petty-history-modal-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Movimiento</th>
                  <th>Concepto</th>
                  <th>Proveedor / destino</th>
                  <th>Tipo</th>
                  <th>Referencia</th>
                  <th>Monto</th>
                  <th>Recibo</th>
                </tr>
              </thead>
              <tbody>
                {!pettyHistoryError ? filteredPettyHistoryRows.map((movement) => {
                  const isVoided = isVoidedCashMovement(movement);
                  return (
                    <tr key={`petty-history-${movement.id}`} className={isVoided ? 'cash-row-voided' : ''}>
                      <td>
                        <strong>{formatDate(movement.createdAt)}</strong>
                        <small>{getLongHourLabel(movement.createdAt)}</small>
                      </td>
                      <td>
                        <span className={`petty-history-kind ${movement.historyKind}`}>
                          {movement.historyLabel}
                        </span>
                      </td>
                      <td>
                        <strong>{movement.description || '-'}</strong>
                        {isVoided && movement.voidReason ? <small>Anulado: {movement.voidReason}</small> : null}
                      </td>
                      <td>{movement.responsible || movement.createdBy || '-'}</td>
                      <td><span className={`petty-category ${movement.historyCategory.className}`}>{movement.historyCategory.label}</span></td>
                      <td>{movement.historyReference}</td>
                      <td>
                        <b className={movement.historyKind === 'expense' ? 'value-orange' : 'value-green'}>
                          {movement.historyKind === 'expense' ? '- ' : '+ '}
                          {formatBs(movement.historyAmountBs)}
                        </b>
                      </td>
                      <td>{renderReceiptActions(movement)}</td>
                    </tr>
                  );
                }) : null}
                {!pettyHistoryLoading && !pettyHistoryError && filteredPettyHistoryRows.length === 0 ? (
                  <tr><td colSpan={8}><p className="status">No hay movimientos con esos filtros.</p></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <footer>
            <small>Mostrando {pettyHistoryRows.length} de {pettyHistoryMeta.total} movimientos históricos.</small>
            {pettyHistoryMeta.hasMore ? (
              <button
                type="button"
                className="ghost-button"
                disabled={pettyHistoryLoading}
                onClick={() => loadPettyHistoryPage({ append: true, offset: pettyHistoryRows.length, filters: pettyHistoryFilters })}
              >
                {pettyHistoryLoading ? 'Cargando...' : 'Ver 80 más'}
              </button>
            ) : null}
            <button type="button" className="primary-button" onClick={() => setIsPettyHistoryOpen(false)}>Cerrar</button>
          </footer>
        </section>
      </div>
    );
  };

  const renderCashModals = () => (
    <>
      {renderPettyHistoryModal()}
      {cashActionFeedback ? <p className="status success accounting-floating-feedback">{cashActionFeedback}</p> : null}
      {cashActionError && !cashModal && !collectModal && !voidReceiptModal && !guaranteeRefundModal ? <p className="status error accounting-floating-feedback">{cashActionError}</p> : null}
      {voidReceiptModal ? (
        <div className="accounting-modal-backdrop" onClick={closeVoidReceiptAction}>
          {voidReceiptStep === 'reason' ? (
            <form className="accounting-modal accounting-void-receipt-modal" onSubmit={handleConfirmVoidReason} onClick={(event) => event.stopPropagation()}>
              <header>
                <div>
                  <h3>Anular recibo {voidReceiptModal.receiptCode || ''}</h3>
                  <small>El recibo anterior quedara visible como anulado con su motivo.</small>
                </div>
                <button type="button" className="orders-modal-close" onClick={closeVoidReceiptAction}>x</button>
              </header>
              <section className="accounting-void-summary">
                <span><small>Concepto</small><strong>{voidReceiptModal.description}</strong></span>
                <span><small>Monto</small><strong>{formatBs(Math.abs(toNumber(voidReceiptModal.amountBs)))}</strong></span>
              </section>
              <label>
                Motivo de anulacion
                <textarea
                  rows={4}
                  value={voidReceiptReason}
                  onChange={(event) => setVoidReceiptReason(event.target.value)}
                  placeholder="Ej: error en monto, referencia incorrecta, responsable equivocado..."
                  required
                />
              </label>
              {cashActionError ? <p className="status error">{cashActionError}</p> : null}
              <footer>
                <button type="button" className="ghost-button" onClick={closeVoidReceiptAction}>Cancelar</button>
                <button type="submit" className="primary-button">Continuar a editar</button>
              </footer>
            </form>
          ) : (
            <form className="accounting-modal accounting-movement-form accounting-void-receipt-modal" onSubmit={handleSubmitVoidReplacement} onClick={(event) => event.stopPropagation()}>
              <header>
                <div>
                  <h3>Nuevo recibo de reemplazo</h3>
                  <small>Se generara con nueva serie. El anterior conserva su numero y anulacion.</small>
                </div>
                <button type="button" className="orders-modal-close" onClick={closeVoidReceiptAction}>x</button>
              </header>
              <div className="accounting-form-grid two">
                <label>
                  Monto (Bs)
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={voidReceiptForm.amountBs}
                    onChange={(event) => setVoidReceiptForm((current) => ({ ...current, amountBs: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Metodo
                  <select value={voidReceiptForm.paymentMethod} onChange={(event) => setVoidReceiptForm((current) => ({ ...current, paymentMethod: event.target.value, paymentAccount: event.target.value === 'qr' ? current.paymentAccount : '' }))}>
                    <option value="efectivo">Efectivo</option>
                    <option value="qr">QR</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="otro">Otro</option>
                  </select>
                </label>
              </div>
              {voidReceiptForm.paymentMethod === 'qr' ? (
                <label>
                  Cuenta destino QR
                  <select value={voidReceiptForm.paymentAccount} onChange={(event) => setVoidReceiptForm((current) => ({ ...current, paymentAccount: event.target.value }))} required>
                    <option value="">Seleccionar cuenta</option>
                    {QR_ACCOUNT_OPTIONS.map((account) => <option key={account} value={account}>{account}</option>)}
                  </select>
                </label>
              ) : null}
              <label>
                Concepto
                <input
                  value={voidReceiptForm.description}
                  onChange={(event) => setVoidReceiptForm((current) => ({ ...current, description: event.target.value }))}
                  required
                />
              </label>
              <div className="accounting-form-grid two">
                <label>
                  Categoria
                  <input
                    value={voidReceiptForm.category}
                    onChange={(event) => setVoidReceiptForm((current) => ({ ...current, category: event.target.value }))}
                  />
                </label>
                <label>
                  Responsable / destino
                  <input
                    value={voidReceiptForm.responsible}
                    onChange={(event) => setVoidReceiptForm((current) => ({ ...current, responsible: event.target.value }))}
                    placeholder="Persona, proveedor o destino"
                  />
                </label>
              </div>
              <label>
                Comprobante / referencia
                <input
                  value={voidReceiptForm.receipt}
                  onChange={(event) => setVoidReceiptForm((current) => ({ ...current, receipt: event.target.value }))}
                  placeholder="Recibo, factura, QR, nota interna..."
                />
              </label>
              {isPettyCash(voidReceiptModal) ? (
                <label>
                  Enlazar gasto de transporte
                  <select
                    value={voidReceiptForm.linkedRentalId}
                    onChange={(event) => setVoidReceiptForm((current) => ({ ...current, linkedRentalId: event.target.value }))}
                  >
                    <option value="">Sin enlace a contrato</option>
                    {transportContractOptions.map((option) => (
                      <option key={option.rentalId} value={option.rentalId}>
                        {option.orderCode}{option.contractCode ? ` | ${option.contractCode}` : ''} - {option.customerName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                Nota
                <textarea
                  rows={3}
                  value={voidReceiptForm.notes}
                  onChange={(event) => setVoidReceiptForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </label>
              <p className="accounting-void-reason-note"><strong>Motivo de anulacion:</strong> {voidReceiptReason}</p>
              {cashActionError ? <p className="status error">{cashActionError}</p> : null}
              <footer>
                <button type="button" className="ghost-button" onClick={() => setVoidReceiptStep('reason')}>Volver</button>
                <button type="submit" className="primary-button" disabled={isSubmittingCash}>
                  {isSubmittingCash ? 'Generando...' : 'Anular y generar nuevo'}
                </button>
              </footer>
            </form>
          )}
        </div>
      ) : null}
      {cashModal ? (
        <div className="accounting-modal-backdrop" onClick={closeCashAction}>
          <form className={`accounting-modal accounting-movement-form ${cashModal === 'advance' ? 'is-advance' : ''}`} onSubmit={handleSubmitCashAction} onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h3>{getCashModalTitle()}</h3>
                <small>
                  {cashModal === 'income'
                    ? 'Los ingresos manuales entran a Caja Grande.'
                    : cashModal === 'debt'
                    ? 'Registra una deuda por pagar o un gasto ya salido que debe reembolsar Sra. Lia.'
                    : cashModal === 'payDebt'
                    ? 'El pago sale de Caja Chica y genera recibo.'
                    : cashModal === 'supplierLoan'
                    ? 'El pago al proveedor sale de Caja Chica y deja el prestamo liquidado.'
                    : cashModal === 'advance'
                    ? 'El adelanto sale solo de Caja Chica y genera un recibo firmado.'
                    : cashModal === 'expense'
                    ? 'Los gastos salen de la Caja Chica abierta.'
                    : cashModal === 'closePetty'
                    ? 'El saldo contado vuelve a Caja Grande al cerrar.'
                    : 'Se descuenta de Caja Grande, se registra recibo de egreso y el monto queda disponible en Caja Chica.'}
                </small>
              </div>
              <button type="button" className="orders-modal-close" onClick={closeCashAction}>x</button>
            </header>

            {cashModal === 'payDebt' ? (
              <label>
                Deuda a pagar
                <select
                  value={cashForm.debtId}
                  onChange={(event) => {
                    const debt = pendingCashDebts.find((entry) => entry.id === event.target.value);
                    setCashForm((current) => ({
                      ...current,
                      debtId: event.target.value,
                      amountBs: debt ? String(Number(debt.balanceBs ?? debt.amountBs ?? 0)) : current.amountBs,
                      description: debt?.description ?? current.description,
                      responsible: debt?.personName ?? current.responsible,
                    }));
                  }}
                  required
                >
                  <option value="">Seleccionar deuda pendiente</option>
                  {pendingCashDebts.map((debt) => (
                    <option key={debt.id} value={debt.id}>
                      {debt.code} - {debt.description} - saldo {formatBs(debt.balanceBs)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {cashModal === 'supplierLoan' ? (
              <label>
                Prestamo de proveedor
                <select
                  value={cashForm.supplierLoanId}
                  onChange={(event) => {
                    const loan = pendingSupplierLoanRows.find((entry) => entry.id === event.target.value);
                    setCashForm((current) => ({
                      ...current,
                      supplierLoanId: event.target.value,
                      amountBs: loan ? String(Number(loan.totalBs ?? 0)) : current.amountBs,
                      description: loan ? `Pago proveedor ${loan.supplierName} - ${loan.loanCode}` : current.description,
                      responsible: loan?.supplierName ?? current.responsible,
                      receipt: loan?.loanCode ?? current.receipt,
                      notes: loan ? `Contrato ${loan.reference} | ${loan.itemSummary || 'Items de proveedor'}` : current.notes,
                    }));
                  }}
                  required
                >
                  <option value="">Seleccionar prestamo pendiente</option>
                  {pendingSupplierLoanRows.map((loan) => (
                    <option key={loan.id} value={loan.id}>
                      {loan.loanCode} - {loan.supplierName} - {loan.reference} - {formatBs(loan.totalBs)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {cashModal === 'advance' ? (
              <section className="petty-advance-form">
                <div className="petty-advance-picker">
                  <label className="petty-advance-search">
                    Buscar o escribir nombre
                    <input
                      value={advancePeopleQuery}
                      onChange={(event) => {
                        const value = event.target.value;
                        setAdvancePeopleQuery(value);
                        void loadAdvancePersonnelOptions(value);
                        setCashForm((current) => ({
                          ...current,
                          employeeId: '',
                          responsible: value,
                          description: value.trim() ? `Adelanto de sueldo - ${value.trim()}` : 'Adelanto de sueldo',
                        }));
                      }}
                      placeholder="Nombre, apellido, CI o cargo"
                      autoComplete="off"
                    />
                  </label>

                  <div className="petty-advance-results" role="listbox" aria-label="Personal para adelanto">
                    {filteredAdvanceEmployees.map((employee) => {
                      const isSelected = String(cashForm.employeeId) === String(employee.id);
                      return (
                        <button
                          key={employee.id}
                          type="button"
                          className={`petty-advance-person ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleAdvanceEmployeeChange(employee.id)}
                        >
                          <strong>{employee.fullName}</strong>
                          <span>{employee.documentId ? `CI ${employee.documentId}` : 'CI pendiente'} · {employee.position || employee.department || 'Personal'}</span>
                        </button>
                      );
                    })}
                    {advancePersonnelLoading ? (
                      <p className="petty-advance-empty">Cargando personal...</p>
                    ) : null}
                    {!advancePersonnelLoading && filteredAdvanceEmployees.length === 0 ? (
                      <p className="petty-advance-empty">No hay coincidencias en Personal.</p>
                    ) : null}
                    {advancePersonnelError ? (
                      <p className="petty-advance-empty">{advancePersonnelError}</p>
                    ) : null}
                  </div>

                  {cashForm.employeeId || cashForm.responsible ? (
                    <div className="petty-advance-selected">
                      <small>{cashForm.employeeId ? 'Personal seleccionado' : 'Nuevo personal para registrar'}</small>
                      <strong>{cashForm.responsible || advancePeopleQuery}</strong>
                    </div>
                  ) : null}
                </div>
                <div className="accounting-form-grid two">
                  <label>
                    Fecha de solicitud
                    <input
                      type="date"
                      value={cashForm.requestDate}
                      onChange={(event) => setCashForm((current) => ({ ...current, requestDate: event.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    Numero de carnet
                    <input
                      value={cashForm.documentId}
                      onChange={(event) => setCashForm((current) => ({ ...current, documentId: event.target.value }))}
                      placeholder="CI del trabajador"
                      required
                    />
                  </label>
                </div>
              </section>
            ) : null}

            {cashModal === 'debt' ? (
              <section className="petty-debt-kind-panel">
                <label>
                  Tipo de deuda
                  <select
                    value={cashForm.debtKind}
                    onChange={(event) => {
                      const debtKind = normalizeCashDebtKind(event.target.value);
                      setCashForm((current) => ({
                        ...current,
                        debtKind,
                        category: debtKind === 'lia_reimbursement' ? 'reembolso_sra_lia' : 'deuda_por_pagar',
                        responsible: debtKind === 'lia_reimbursement' ? (current.responsible || 'SRA. LIA') : current.responsible,
                      }));
                    }}
                  >
                    <option value="payable">Deuda por pagar despues</option>
                    <option value="lia_reimbursement">Gasto pagado por Caja Chica / cobrar a Sra. Lia</option>
                  </select>
                </label>
                <p>
                  {normalizeCashDebtKind(cashForm.debtKind) === 'lia_reimbursement'
                    ? 'Este registro descuenta Caja Chica ahora y queda pendiente de reembolso.'
                    : 'Este registro solo queda pendiente; Caja Chica se descuenta cuando se pague.'}
                </p>
              </section>
            ) : null}

            <div className="accounting-form-grid two">
              <label>
                {cashModal === 'advance' ? 'Monto a solicitar (Bs)' : 'Monto (Bs)'}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={cashForm.amountBs}
                  onChange={(event) => setCashForm((current) => ({ ...current, amountBs: event.target.value }))}
                  required
                />
              </label>
              <label className={cashModal === 'advance' ? 'is-readonly-method' : ''}>
                Metodo
                <select
                  value={cashModal === 'advance' ? 'efectivo' : cashForm.paymentMethod}
                  onChange={(event) => setCashForm((current) => ({ ...current, paymentMethod: event.target.value, paymentAccount: event.target.value === 'qr' ? current.paymentAccount : '' }))}
                  disabled={cashModal === 'advance'}
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="qr">QR</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="otro">Otro</option>
                </select>
              </label>
            </div>
            {cashModal !== 'advance' && cashForm.paymentMethod === 'qr' ? (
              <label>
                Cuenta destino QR
                <select value={cashForm.paymentAccount} onChange={(event) => setCashForm((current) => ({ ...current, paymentAccount: event.target.value }))} required>
                  <option value="">Seleccionar cuenta</option>
                  {QR_ACCOUNT_OPTIONS.map((account) => <option key={account} value={account}>{account}</option>)}
                </select>
              </label>
            ) : null}

            {cashModal !== 'closePetty' && cashModal !== 'advance' ? (
              <>
                <label>
                  Concepto
                  <input
                    value={cashForm.description}
                    onChange={(event) => setCashForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder={
                      cashModal === 'expense'
                        ? 'Ej: almuerzo, taxi, reparacion, sueldo...'
                        : cashModal === 'debt'
                        ? 'Ej: deuda pendiente por compra, prestamo o servicio'
                        : cashModal === 'supplierLoan'
                        ? 'Pago de prestamo de proveedor'
                        : cashModal === 'transfer'
                        ? 'Ej: reposicion para gastos operativos'
                        : cashModal === 'payDebt'
                        ? 'Detalle del pago de deuda'
                        : 'Detalle del movimiento'
                    }
                    required={cashModal !== 'openPetty'}
                  />
                </label>
                <div className="accounting-form-grid two">
                  <label>
                    Categoria
                    <select value={cashForm.category} onChange={(event) => setCashForm((current) => ({ ...current, category: event.target.value }))}>
                      {cashModal === 'expense' ? (
                        <>
                          {PETTY_EXPENSE_CATEGORIES.map((category) => (
                            <option key={category.id} value={category.id}>{category.label}</option>
                          ))}
                        </>
                      ) : cashModal === 'debt' || cashModal === 'payDebt' ? (
                        <>
                          <option value="deuda_por_pagar">Deuda por pagar</option>
                          <option value="reembolso_sra_lia">Reembolso Sra. Lia</option>
                          {PETTY_EXPENSE_CATEGORIES.map((category) => (
                            <option key={category.id} value={category.id}>{category.label}</option>
                          ))}
                        </>
                      ) : cashModal === 'supplierLoan' ? (
                        <>
                          <option value="pago_proveedor">Pago proveedor</option>
                          <option value="prestamo_proveedor">Prestamo proveedor</option>
                        </>
                      ) : cashModal === 'transfer' ? (
                        <>
                          <option value="reposicion_caja_chica">Reposicion caja chica</option>
                          <option value="fondo_operativo">Fondo operativo</option>
                          <option value="ajuste_caja_chica">Ajuste caja chica</option>
                        </>
                      ) : (
                        <>
                          <option value="ingreso_manual">Ingreso manual</option>
                          <option value="ajuste">Ajuste</option>
                        </>
                      )}
                    </select>
                  </label>
                  <label>
                    {cashModal === 'debt'
                      ? normalizeCashDebtKind(cashForm.debtKind) === 'lia_reimbursement'
                        ? 'Quien debe reembolsar'
                        : 'A quien se debe'
                      : cashModal === 'supplierLoan' ? 'Proveedor' : 'Responsable / destino'}
                    <input
                      value={cashForm.responsible}
                      onChange={(event) => setCashForm((current) => ({ ...current, responsible: event.target.value }))}
                      placeholder={cashModal === 'debt' || cashModal === 'supplierLoan' ? 'Persona, proveedor o entidad' : 'Persona, proveedor o destino'}
                    />
                  </label>
                </div>
                {cashModal === 'debt' ? (
                  <div className="accounting-form-grid two">
                    <label>
                      Fecha de deuda
                      <input
                        type="date"
                        value={cashForm.debtDate}
                        onChange={(event) => setCashForm((current) => ({ ...current, debtDate: event.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      Fecha límite / vencimiento
                      <input
                        type="date"
                        value={cashForm.dueDate}
                        onChange={(event) => setCashForm((current) => ({ ...current, dueDate: event.target.value }))}
                      />
                    </label>
                  </div>
                ) : null}
                {cashModal === 'expense' ? (
                  <label>
                    Enlazar gasto de transporte
                    <select
                      value={cashForm.linkedRentalId}
                      onChange={(event) => setCashForm((current) => ({ ...current, linkedRentalId: event.target.value }))}
                    >
                      <option value="">Sin enlace a contrato</option>
                      {transportContractOptions.map((option) => (
                        <option key={option.rentalId} value={option.rentalId}>
                          {option.orderCode}{option.contractCode ? ` | ${option.contractCode}` : ''} - {option.customerName}
                          {option.deliveryFeeBs > 0 ? ` - envio ${formatBs(option.deliveryFeeBs)}` : ''}
                        </option>
                      ))}
                    </select>
                    <small>Usalo para taxis, fletes o envios externos asociados a un contrato.</small>
                  </label>
                ) : null}
                <label>
                  Comprobante / referencia
                  <input
                    value={cashForm.receipt}
                    onChange={(event) => setCashForm((current) => ({ ...current, receipt: event.target.value }))}
                    placeholder="Recibo, factura, QR, nota interna..."
                  />
                </label>
              </>
            ) : null}

            {cashModal === 'closePetty' ? (
              <div className="accounting-close-preview">
                <span><small>Saldo esperado Caja Chica</small><strong>{formatBs(pettyCashBalanceBs)}</strong></span>
                <span><small>Saldo que vuelve a Caja Grande</small><strong>{formatBs(toNumber(cashForm.amountBs))}</strong></span>
              </div>
            ) : null}

            <label>
              Nota
              <textarea
                rows={3}
                value={cashForm.notes}
                onChange={(event) => setCashForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Detalle adicional para auditoria interna"
              />
            </label>

            {cashActionError ? <p className="status error">{cashActionError}</p> : null}

            <footer>
              <button type="button" className="ghost-button" onClick={closeCashAction}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={isSubmittingCash}>
                {isSubmittingCash
                  ? 'Guardando...'
                  : cashModal === 'advance'
                  ? 'Registrar adelanto y generar recibo'
                  : cashModal === 'payDebt'
                  ? 'Pagar y generar recibo'
                  : cashModal === 'supplierLoan'
                  ? 'Pagar proveedor y generar recibo'
                  : cashModal === 'debt'
                  ? 'Registrar deuda'
                  : 'Guardar movimiento'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {guaranteeRefundModal ? (
        <div className="accounting-modal-backdrop" onClick={closeGuaranteeRefund}>
          <form className="accounting-modal is-collect" onSubmit={handleReturnGuarantee} onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h3>Devolver garantía</h3>
                <small>{guaranteeRefundModal.contractCode} | {guaranteeRefundModal.customerName}</small>
              </div>
              <button type="button" className="orders-modal-close" onClick={closeGuaranteeRefund}>x</button>
            </header>

            <section className="accounting-collect-summary">
              <div className="accounting-verify-money compact">
                <span><small>Garantía pagada</small><strong>{formatBs(guaranteeRefundModal.guaranteePaidBs)}</strong></span>
                <span><small>Método recibido</small><strong>{guaranteeRefundModal.paymentMethodLabel}</strong></span>
                <span><small>Aplicado</small><strong>{formatBs(guaranteeRefundModal.appliedBs)}</strong></span>
                <span><small>Ya devuelto</small><strong>{formatBs(guaranteeRefundModal.refundedBs)}</strong></span>
                <span className="highlight"><small>A devolver</small><strong>{formatBs(guaranteeRefundModal.refundableBs)}</strong></span>
              </div>
            </section>

            <div className="accounting-form-grid two">
              <label>
                Método de devolución
                <select value={guaranteeRefundForm.paymentMethod} onChange={(event) => setGuaranteeRefundForm((current) => ({ ...current, paymentMethod: event.target.value, paymentAccount: event.target.value === 'qr' ? current.paymentAccount : '' }))}>
                  <option value="efectivo">Efectivo</option>
                  <option value="qr">QR</option>
                  <option value="transferencia">Transferencia</option>
                </select>
              </label>
              {guaranteeRefundForm.paymentMethod === 'qr' ? (
                <label>
                  Cuenta QR
                  <select value={guaranteeRefundForm.paymentAccount} onChange={(event) => setGuaranteeRefundForm((current) => ({ ...current, paymentAccount: event.target.value }))} required>
                    <option value="">Seleccionar cuenta</option>
                    {QR_ACCOUNT_OPTIONS.map((account) => <option key={account} value={account}>{account}</option>)}
                  </select>
                </label>
              ) : <span />}
            </div>
            <label>
              Nota / referencia
              <textarea rows={3} value={guaranteeRefundForm.note} onChange={(event) => setGuaranteeRefundForm((current) => ({ ...current, note: event.target.value }))} placeholder="Ej. Devolución por QR al titular del contrato" />
            </label>

            {cashActionError ? <p className="status error">{cashActionError}</p> : null}

            <footer>
              <button type="button" className="ghost-button" onClick={closeGuaranteeRefund}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={isSubmittingCash}>
                {isSubmittingCash ? 'Registrando...' : `Devolver ${formatBs(guaranteeRefundModal.refundableBs)}`}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {collectModal ? (
        <div className="accounting-modal-backdrop" onClick={closeCollectAction}>
          <form className="accounting-modal is-collect" onSubmit={handleSubmitCollectAction} onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h3>Cobrar en Caja Grande</h3>
                <small>{collectModal.orderCode} | {collectModal.customerName}</small>
              </div>
              <button type="button" className="orders-modal-close" onClick={closeCollectAction}>x</button>
            </header>

            <section className="accounting-collect-summary">
              <div className="accounting-collect-hero">
                <div>
                  <span>{collectModal.status}</span>
                  <strong>{collectModal.customerName}</strong>
                  <small>{collectModal.contractCode || collectModal.orderCode}</small>
                </div>
                <div className="accounting-collect-amount">
                  <small>Por cobrar</small>
                  <strong>{formatBs(collectModal.pendingBs)}</strong>
                </div>
              </div>
              <div className="accounting-verify-money compact">
                <span><small>Total contrato</small><strong>{formatBs(collectModal.totalBs)}</strong></span>
                <span><small>Pagado</small><strong>{formatBs(collectModal.paidBs)}</strong></span>
                <span><small>Garantia retenida</small><strong>{formatBs(collectModal.guaranteeBs)}</strong></span>
                <span className="highlight"><small>Danos / perdidas</small><strong>{formatBs(collectModal.penaltiesBs)}</strong></span>
              </div>
              {collectModal.transportPendingBs > 0 ? (
                <div className="accounting-verify-money compact">
                  <span><small>Contrato por cobrar</small><strong>{formatBs(collectModal.contractPendingBs)}</strong></span>
                  <span><small>Transporte por cobrar</small><strong>{formatBs(collectModal.transportPendingBs)}</strong></span>
                </div>
              ) : null}
            </section>

            <div className="accounting-form-grid two">
              <label>
                Monto a cobrar
                <input
                  type="number"
                  min="0.01"
                  max={collectModal.pendingBs}
                  step="0.01"
                  value={collectForm.amountBs}
                  onChange={(event) => setCollectForm((current) => ({ ...current, amountBs: event.target.value }))}
                  required
                />
              </label>
              <label>
                Metodo
                <select value={collectForm.paymentMethod} onChange={(event) => setCollectForm((current) => ({ ...current, paymentMethod: event.target.value, paymentAccount: event.target.value === 'qr' ? current.paymentAccount : '' }))}>
                  <option value="efectivo">Efectivo</option>
                  <option value="qr">QR</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="otro">Otro</option>
                </select>
              </label>
            </div>
            {collectForm.paymentMethod === 'qr' ? (
              <label>
                Cuenta destino QR
                <select value={collectForm.paymentAccount} onChange={(event) => setCollectForm((current) => ({ ...current, paymentAccount: event.target.value }))} required>
                  <option value="">Seleccionar cuenta</option>
                  {QR_ACCOUNT_OPTIONS.map((account) => <option key={account} value={account}>{account}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              Comprobante
              <input value={collectForm.receipt} onChange={(event) => setCollectForm((current) => ({ ...current, receipt: event.target.value }))} />
            </label>
            <label>
              Nota del cobro
              <textarea rows={3} value={collectForm.note} onChange={(event) => setCollectForm((current) => ({ ...current, note: event.target.value }))} />
            </label>

            {cashActionError ? <p className="status error">{cashActionError}</p> : null}

            <footer>
              <button type="button" className="ghost-button" onClick={closeCollectAction}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={isSubmittingCash}>
                {isSubmittingCash ? 'Registrando...' : 'Confirmar cobro'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </>
  );

  const updateBigCashWorkspaceRange = (rangeKey, field, value) => {
    if (rangeKey === 'movements') setBigCashPeriod('custom');
    setBigCashWorkspaceRanges((current) => ({
      ...current,
      [rangeKey]: { ...current[rangeKey], [field]: value },
    }));
  };

  const clearBigCashWorkspaceRange = (rangeKey) => {
    if (rangeKey === 'movements') setBigCashPeriod('custom');
    setBigCashWorkspaceRanges((current) => ({
      ...current,
      [rangeKey]: { dateFrom: '', dateTo: '' },
    }));
  };

  const renderBigCashWorkspaceSearch = (placeholder, rangeKey, dateCaption, resultCount = null, resultLabel = 'resultados') => {
    const range = bigCashWorkspaceRanges[rangeKey] ?? { dateFrom: '', dateTo: '' };
    return (
      <div className="bigcash-workspace-filters">
        <div className="bigcash-workspace-search">
          <MiniIcon kind="search" />
          <input
            value={bigCashWorkspaceQuery}
            onChange={(event) => setBigCashWorkspaceQuery(event.target.value)}
            placeholder={placeholder}
          />
          {bigCashWorkspaceQuery ? (
            <button type="button" onClick={() => setBigCashWorkspaceQuery('')} aria-label="Limpiar búsqueda">×</button>
          ) : null}
        </div>
        <div className="bigcash-range-filter">
          <span>{dateCaption}</span>
          <label><small>Desde</small><input type="date" value={range.dateFrom} onChange={(event) => updateBigCashWorkspaceRange(rangeKey, 'dateFrom', event.target.value)} /></label>
          <label><small>Hasta</small><input type="date" value={range.dateTo} onChange={(event) => updateBigCashWorkspaceRange(rangeKey, 'dateTo', event.target.value)} /></label>
          {resultCount !== null ? (
            <span className="bigcash-filter-result-count">
              <strong>{resultCount}</strong>{resultLabel ? ` ${resultCount === 1 && resultLabel === 'contratos encontrados' ? 'contrato encontrado' : resultLabel}` : ''}
            </span>
          ) : null}
          {(range.dateFrom || range.dateTo) ? <button type="button" onClick={() => clearBigCashWorkspaceRange(rangeKey)}>Limpiar fechas</button> : null}
        </div>
      </div>
    );
  };

  const renderBigCashRangeOnly = (rangeKey, dateCaption) => {
    const range = bigCashWorkspaceRanges[rangeKey] ?? { dateFrom: '', dateTo: '' };
    return (
      <div className="bigcash-range-filter standalone">
        <span>{dateCaption}</span>
        <label><small>Desde</small><input type="date" value={range.dateFrom} onChange={(event) => updateBigCashWorkspaceRange(rangeKey, 'dateFrom', event.target.value)} /></label>
        <label><small>Hasta</small><input type="date" value={range.dateTo} onChange={(event) => updateBigCashWorkspaceRange(rangeKey, 'dateTo', event.target.value)} /></label>
        {(range.dateFrom || range.dateTo) ? <button type="button" onClick={() => clearBigCashWorkspaceRange(rangeKey)}>Limpiar fechas</button> : null}
      </div>
    );
  };

  if (activeModule === 'contabilidad_caja_grande') {
    return (
      <section className="panel accounting-bigcash-view accounting-redesign bigcash-balanced-layout">
        <style>{`
          .bigcash-balanced-layout {
            --bigcash-gap: 14px;
            --bigcash-border: #dde5ef;
            --bigcash-muted: #667085;
            --bigcash-ink: #102a56;
            --bigcash-surface: #ffffff;
          }

          .bigcash-receivables-header-actions {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            justify-content: flex-end;
          }
          .bigcash-generate-report-button {
            min-height: 42px;
            padding-inline: 18px;
            white-space: nowrap;
          }
          .bigcash-filter-result-count {
            min-height: 38px;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 0 12px;
            border: 1px solid #cfe8d7;
            border-radius: 10px;
            background: #eefbf2;
            color: #287542;
            font-size: 12px;
            font-weight: 700;
            white-space: nowrap;
          }
          .bigcash-filter-result-count strong {
            font-size: 17px;
            line-height: 1;
          }
          .bigcash-report-backdrop {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: rgba(15, 23, 42, .62);
          }
          .bigcash-report-modal {
            width: min(1240px, 96vw);
            max-height: 92vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border-radius: 18px;
            background: #fff;
            box-shadow: 0 24px 70px rgba(15, 23, 42, .28);
          }
          .bigcash-report-modal-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            padding: 18px 20px 14px;
            border-bottom: 1px solid #e2e8f0;
          }
          .bigcash-report-modal-head h2 { margin: 0; font-size: 24px; color: #111827; }
          .bigcash-report-modal-head p { margin: 4px 0 0; color: #64748b; }
          .bigcash-report-close {
            width: 34px; height: 34px; border: 1px solid #dbe3ee; border-radius: 9px; background: #fff; color: #64748b; font-size: 20px; cursor: pointer;
          }
          .bigcash-report-document {
            flex: 1;
            overflow: auto;
            padding: 18px 20px 24px;
            background: #f4f7fb;
          }
          .bigcash-report-page {
            max-width: 1120px;
            margin: 0 auto;
            padding: 20px;
            background: #fff;
            border: 1px solid #dbe3ee;
            box-shadow: 0 3px 12px rgba(15,23,42,.06);
          }
          .bigcash-report-doc-head { display: grid; grid-template-columns: minmax(0,1fr) 270px; gap: 22px; align-items: end; padding-bottom: 12px; border-bottom: 3px solid #173a70; }
          .bigcash-report-brand { color: #173a70; font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
          .bigcash-report-doc-head h3 { margin: 5px 0 4px; font-size: 27px; color: #111827; }
          .bigcash-report-doc-head p { margin: 0; color: #64748b; }
          .bigcash-report-meta { border-left: 1px solid #cbd5e1; padding-left: 15px; }
          .bigcash-report-meta div { display: flex; justify-content: space-between; gap: 10px; margin: 4px 0; font-size: 11px; }
          .bigcash-report-meta span { color: #64748b; font-weight: 700; text-transform: uppercase; }
          .bigcash-report-summary { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 9px; margin: 15px 0; }
          .bigcash-report-summary article { border: 1px solid #d7dee8; border-top: 3px solid #173a70; padding: 10px 12px; }
          .bigcash-report-summary article.money { border-top-color: #16803c; }
          .bigcash-report-summary small { display:block; color:#64748b; font-size:10px; font-weight:800; text-transform:uppercase; }
          .bigcash-report-summary strong { display:block; margin-top:5px; color:#173a70; font-size:21px; }
          .bigcash-report-summary article.money strong { color:#16803c; }
          .bigcash-report-section { margin-top: 17px; }
          .bigcash-report-section h4 { margin:0 0 7px; padding-bottom:5px; border-bottom:1px solid #cbd5e1; color:#172033; font-size:14px; }
          .bigcash-report-table { width:100%; border-collapse:collapse; font-size:11px; }
          .bigcash-report-table th { padding:7px 6px; background:#173a70; color:#fff; font-size:9px; text-transform:uppercase; text-align:left; }
          .bigcash-report-table td { padding:7px 6px; border:1px solid #dbe2ea; vertical-align:top; }
          .bigcash-report-table tbody tr:nth-child(even) { background:#f8fafc; }
          .bigcash-report-table .amount { text-align:right; font-weight:800; white-space:nowrap; }
          .bigcash-report-table small { display:block; margin-top:2px; color:#64748b; }
          .bigcash-report-footer { display:flex; justify-content:flex-end; gap:9px; padding:13px 18px; border-top:1px solid #e2e8f0; background:#fff; }
          @media (max-width: 900px) {
            .bigcash-report-doc-head { grid-template-columns: 1fr; }
            .bigcash-report-meta { border-left: 0; border-top: 1px solid #cbd5e1; padding: 10px 0 0; }
            .bigcash-report-summary { grid-template-columns: 1fr; }
          }
          .bigcash-balanced-layout .accounting-bigcash-head {
            min-height: auto;
            padding: 22px 24px;
            border-radius: 18px;
            align-items: center;
          }

          .bigcash-balanced-layout .accounting-bigcash-head h2 {
            margin: 0;
            font-size: clamp(30px, 2.4vw, 42px);
            line-height: 1;
            letter-spacing: -1.2px;
          }

          .bigcash-balanced-layout .accounting-bigcash-head p {
            margin: 7px 0 10px;
            font-size: 14px;
          }

          .bigcash-balanced-layout .accounting-overview-actions {
            align-items: center;
            gap: 10px;
          }

          .bigcash-balanced-layout .accounting-date-control,
          .bigcash-balanced-layout .accounting-bigcash-action-group button {
            min-height: 42px;
          }

          .bigcash-balanced-layout .accounting-core-kpis {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: var(--bigcash-gap);
            margin-top: 16px;
          }

          .bigcash-balanced-layout .bigcash-kpi-card {
            position: relative;
            min-width: 0;
            min-height: 116px;
            padding: 17px 18px;
            border: 1px solid var(--bigcash-border);
            border-radius: 16px;
            overflow: hidden;
            text-align: left;
          }

          .bigcash-balanced-layout .bigcash-kpi-content {
            display: grid;
            grid-template-columns: 36px minmax(0, 1fr);
            gap: 12px;
            align-items: start;
          }

          .bigcash-balanced-layout .bigcash-hero-icon {
            width: 36px;
            height: 36px;
            min-width: 36px;
            border-radius: 11px;
          }

          .bigcash-balanced-layout .bigcash-kpi-card strong {
            display: block;
            min-height: 28px;
            font-size: 11px;
            line-height: 1.25;
            letter-spacing: .25px;
          }

          .bigcash-balanced-layout .bigcash-kpi-card h3 {
            margin: 4px 0 4px;
            font-size: clamp(22px, 1.55vw, 29px);
            line-height: 1.05;
            letter-spacing: -.55px;
            white-space: nowrap;
          }

          .bigcash-balanced-layout .bigcash-kpi-card p {
            margin: 0;
            color: var(--bigcash-muted);
            font-size: 11.5px;
            line-height: 1.3;
          }

          .bigcash-balanced-layout .bigcash-kpi-card .pill {
            top: 9px;
            right: 10px;
            font-size: 9px;
          }

          .bigcash-balanced-layout .bigcash-ledger-overview {
            display: grid;
            grid-template-columns: minmax(360px, .92fr) minmax(0, 1.48fr);
            gap: var(--bigcash-gap);
            align-items: stretch;
            margin-top: 14px;
          }

          .bigcash-balanced-layout .bigcash-ledger-card {
            min-width: 0;
            min-height: 218px;
            padding: 18px;
            border: 1px solid var(--bigcash-border);
            border-radius: 16px;
            background: var(--bigcash-surface);
          }

          .bigcash-balanced-layout .bigcash-ledger-card.closing {
            display: grid;
            grid-template-rows: auto auto 1fr;
            gap: 14px;
            border-left: 4px solid #194b91;
          }

          .bigcash-balanced-layout .bigcash-ledger-card.closing > div:first-child {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }

          .bigcash-balanced-layout .bigcash-ledger-card.closing > div:first-child span,
          .bigcash-balanced-layout .bigcash-ledger-card.methods header span {
            color: var(--bigcash-muted);
            font-size: 11px;
            font-weight: 700;
          }

          .bigcash-balanced-layout .bigcash-ledger-card h3 {
            margin: 3px 0 0;
            color: var(--bigcash-ink);
            font-size: 18px;
            line-height: 1.2;
          }

          .bigcash-balanced-layout .bigcash-ledger-totals {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 9px;
          }

          .bigcash-balanced-layout .bigcash-ledger-totals > span,
          .bigcash-balanced-layout .bigcash-ledger-split > span {
            min-width: 0;
            padding: 11px 12px;
            border: 1px solid #e3eaf3;
            border-radius: 11px;
            background: #f8fafc;
          }

          .bigcash-balanced-layout .bigcash-ledger-totals small,
          .bigcash-balanced-layout .bigcash-ledger-split span {
            font-size: 10.5px;
          }

          .bigcash-balanced-layout .bigcash-ledger-totals strong {
            display: block;
            margin-top: 4px;
            font-size: 15px;
            white-space: nowrap;
          }

          .bigcash-balanced-layout .bigcash-ledger-split {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 9px;
            align-self: end;
          }

          .bigcash-balanced-layout .bigcash-ledger-split > span {
            display: flex;
            justify-content: space-between;
            gap: 10px;
          }

          .bigcash-balanced-layout .bigcash-ledger-card.methods {
            display: flex;
            flex-direction: column;
          }

          .bigcash-balanced-layout .bigcash-ledger-card.methods header {
            margin-bottom: 12px;
          }

          .bigcash-balanced-layout .bigcash-payment-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 9px;
            align-content: start;
          }

          .bigcash-balanced-layout .bigcash-payment-card {
            display: grid;
            grid-template-columns: 28px minmax(0, 1fr);
            grid-template-areas:
              "badge detail"
              "net net"
              "flow flow";
            gap: 4px 8px;
            min-width: 0;
            min-height: 88px;
            padding: 10px 11px;
            border-radius: 12px;
          }

          .bigcash-balanced-layout .bigcash-payment-card > span {
            grid-area: badge;
            width: 28px;
            height: 28px;
            min-width: 28px;
            font-size: 9px;
          }

          .bigcash-balanced-layout .bigcash-payment-card > div {
            grid-area: detail;
            min-width: 0;
          }

          .bigcash-balanced-layout .bigcash-payment-card strong {
            display: block;
            font-size: 11px;
            line-height: 1.15;
          }

          .bigcash-balanced-layout .bigcash-payment-card small {
            display: block;
            margin-top: 2px;
            overflow: hidden;
            color: var(--bigcash-muted);
            font-size: 9.5px;
            line-height: 1.2;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .bigcash-balanced-layout .bigcash-payment-card > b {
            grid-area: net;
            margin-top: 2px;
            font-size: 12px;
            line-height: 1.15;
          }

          .bigcash-balanced-layout .bigcash-payment-card > em {
            grid-area: flow;
            font-size: 9.5px;
            line-height: 1.2;
          }

          @media (max-width: 1280px) {
            .bigcash-balanced-layout .accounting-core-kpis {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .bigcash-balanced-layout .bigcash-ledger-overview {
              grid-template-columns: 1fr;
            }

            .bigcash-balanced-layout .bigcash-payment-grid {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
          }

          @media (max-width: 760px) {
            .bigcash-receivables-header-actions {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            justify-content: flex-end;
          }
          .bigcash-generate-report-button {
            min-height: 42px;
            padding-inline: 18px;
            white-space: nowrap;
          }
          .bigcash-filter-result-count {
            min-height: 38px;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 0 12px;
            border: 1px solid #cfe8d7;
            border-radius: 10px;
            background: #eefbf2;
            color: #287542;
            font-size: 12px;
            font-weight: 700;
            white-space: nowrap;
          }
          .bigcash-filter-result-count strong {
            font-size: 17px;
            line-height: 1;
          }
          .bigcash-report-backdrop {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: rgba(15, 23, 42, .62);
          }
          .bigcash-report-modal {
            width: min(1240px, 96vw);
            max-height: 92vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border-radius: 18px;
            background: #fff;
            box-shadow: 0 24px 70px rgba(15, 23, 42, .28);
          }
          .bigcash-report-modal-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            padding: 18px 20px 14px;
            border-bottom: 1px solid #e2e8f0;
          }
          .bigcash-report-modal-head h2 { margin: 0; font-size: 24px; color: #111827; }
          .bigcash-report-modal-head p { margin: 4px 0 0; color: #64748b; }
          .bigcash-report-close {
            width: 34px; height: 34px; border: 1px solid #dbe3ee; border-radius: 9px; background: #fff; color: #64748b; font-size: 20px; cursor: pointer;
          }
          .bigcash-report-document {
            flex: 1;
            overflow: auto;
            padding: 18px 20px 24px;
            background: #f4f7fb;
          }
          .bigcash-report-page {
            max-width: 1120px;
            margin: 0 auto;
            padding: 20px;
            background: #fff;
            border: 1px solid #dbe3ee;
            box-shadow: 0 3px 12px rgba(15,23,42,.06);
          }
          .bigcash-report-doc-head { display: grid; grid-template-columns: minmax(0,1fr) 270px; gap: 22px; align-items: end; padding-bottom: 12px; border-bottom: 3px solid #173a70; }
          .bigcash-report-brand { color: #173a70; font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
          .bigcash-report-doc-head h3 { margin: 5px 0 4px; font-size: 27px; color: #111827; }
          .bigcash-report-doc-head p { margin: 0; color: #64748b; }
          .bigcash-report-meta { border-left: 1px solid #cbd5e1; padding-left: 15px; }
          .bigcash-report-meta div { display: flex; justify-content: space-between; gap: 10px; margin: 4px 0; font-size: 11px; }
          .bigcash-report-meta span { color: #64748b; font-weight: 700; text-transform: uppercase; }
          .bigcash-report-summary { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 9px; margin: 15px 0; }
          .bigcash-report-summary article { border: 1px solid #d7dee8; border-top: 3px solid #173a70; padding: 10px 12px; }
          .bigcash-report-summary article.money { border-top-color: #16803c; }
          .bigcash-report-summary small { display:block; color:#64748b; font-size:10px; font-weight:800; text-transform:uppercase; }
          .bigcash-report-summary strong { display:block; margin-top:5px; color:#173a70; font-size:21px; }
          .bigcash-report-summary article.money strong { color:#16803c; }
          .bigcash-report-section { margin-top: 17px; }
          .bigcash-report-section h4 { margin:0 0 7px; padding-bottom:5px; border-bottom:1px solid #cbd5e1; color:#172033; font-size:14px; }
          .bigcash-report-table { width:100%; border-collapse:collapse; font-size:11px; }
          .bigcash-report-table th { padding:7px 6px; background:#173a70; color:#fff; font-size:9px; text-transform:uppercase; text-align:left; }
          .bigcash-report-table td { padding:7px 6px; border:1px solid #dbe2ea; vertical-align:top; }
          .bigcash-report-table tbody tr:nth-child(even) { background:#f8fafc; }
          .bigcash-report-table .amount { text-align:right; font-weight:800; white-space:nowrap; }
          .bigcash-report-table small { display:block; margin-top:2px; color:#64748b; }
          .bigcash-report-footer { display:flex; justify-content:flex-end; gap:9px; padding:13px 18px; border-top:1px solid #e2e8f0; background:#fff; }
          @media (max-width: 900px) {
            .bigcash-report-doc-head { grid-template-columns: 1fr; }
            .bigcash-report-meta { border-left: 0; border-top: 1px solid #cbd5e1; padding: 10px 0 0; }
            .bigcash-report-summary { grid-template-columns: 1fr; }
          }
          .bigcash-balanced-layout .accounting-bigcash-head {
              padding: 18px;
            }

            .bigcash-balanced-layout .accounting-core-kpis,
            .bigcash-balanced-layout .bigcash-payment-grid,
            .bigcash-balanced-layout .bigcash-ledger-totals,
            .bigcash-balanced-layout .bigcash-ledger-split {
              grid-template-columns: 1fr;
            }

            .bigcash-balanced-layout .bigcash-kpi-card h3 {
              white-space: normal;
            }
          }
        `}</style>
        <header className="accounting-bigcash-head">
          <div>
            <span className="accounting-head-eyebrow">CONTROL FINANCIERO CENTRAL</span>
            <h2>Caja Grande</h2>
            <p>Dinero recibido, custodiado y egresado desde contratos y operaciones.</p>
            <span className="accounting-source-badge"><i />Sincronizado con Órdenes y recibos</span>
          </div>
          <div className="accounting-overview-actions">
            <label className="accounting-date-control">
              <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
              <span className="date-icon"><MiniIcon kind="calendar" /></span>
            </label>
            <div className="accounting-bigcash-action-group" aria-label="Movimientos de Caja Grande">
              <button type="button" className="accounting-overview-primary" onClick={() => openCashAction('income', { category: 'ingreso_manual' })}>
                <span>+ Ingreso</span>
              </button>
              <button
                type="button"
                className="accounting-overview-secondary danger"
                onClick={() => openCashAction('transfer', {
                  description: 'Reposicion a caja chica',
                  category: 'reposicion_caja_chica',
                  responsible: currentUserName,
                })}
              >
                <MiniIcon kind="down" />
                <span>Egreso a caja chica</span>
              </button>
            </div>
          </div>
        </header>

        <section className="bigcash-kpi-grid accounting-core-kpis">
          <button type="button" className="bigcash-kpi-card balance is-clickable" onClick={() => setBigCashWorkspaceTab('movements')}>
            <small className="pill">Disponible</small>
            <div className="bigcash-kpi-content">
              <span className="bigcash-hero-icon blue"><CashIcon kind="petty" /></span>
              <div>
                <strong>DINERO OPERATIVO DISPONIBLE</strong>
                <h3 className="value-blue">{formatBs(operationalBigCashBs)}</h3>
                <p>Dinero propio que puede utilizarse ahora.</p>
              </div>
            </div>
          </button>
          <button type="button" className="bigcash-kpi-card guarantee is-clickable" onClick={() => setBigCashWorkspaceTab('guarantees')}>
            <small className="pill warning">No disponible</small>
            <div className="bigcash-kpi-content">
              <span className="bigcash-hero-icon violet"><MiniIcon kind="lock" /></span>
              <div>
                <strong>DINERO DE CLIENTES EN CUSTODIA</strong>
                <h3 className="value-violet">{formatBs(guaranteesHeldBs)}</h3>
                <p>No es ingreso ni dinero disponible de la empresa.</p>
              </div>
            </div>
            <small className="bigcash-kpi-footnote">Por validar: {formatBs(unvalidatedGuaranteesBs)}</small>
          </button>
          <button type="button" className="bigcash-kpi-card income is-clickable" onClick={() => setBigCashWorkspaceTab('receivables')}>
            <div className="bigcash-kpi-content">
              <span className="bigcash-hero-icon orange"><MiniIcon kind="info" /></span>
              <div>
                <strong>DINERO PENDIENTE DE COBRO</strong>
                <h3 className="value-orange">{formatBs(pendingReceivableBs)}</h3>
                <p>Todavía no forma parte del dinero en caja.</p>
              </div>
            </div>
            <small className="bigcash-kpi-footnote">{pendingReceivableRows.length} contrato{pendingReceivableRows.length === 1 ? '' : 's'} con saldo</small>
          </button>
        </section>

        <section className="bigcash-reconciliation" aria-label="Composición del dinero físico">
          <div>
            <span>TOTAL FÍSICO EN CAJA GRANDE</span>
            <strong>{formatBs(bigCashBalanceBs)}</strong>
            <small>Dinero contado entre caja y cuentas receptoras</small>
          </div>
          <div className="bigcash-reconciliation-formula">
            <span><small>Disponible para operar</small><b>{formatBs(operationalBigCashBs)}</b></span>
            <i>+</i>
            <span><small>Garantías pagadas en custodia</small><b>{formatBs(guaranteesHeldBs)}</b></span>
            <i>=</i>
            <span className="total"><small>Total físico</small><b>{formatBs(bigCashBalanceBs)}</b></span>
          </div>
        </section>

        <nav className="bigcash-workspace-tabs" aria-label="Áreas de Caja Grande" style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', gap: 12, scrollbarWidth: 'thin' }}>
          {[
            ['summary', 'Resumen', null],
            ['accounts', 'Cuentas', accountLedgerData.accounts.length || null],
            ['receipts', 'Comprobantes', receiptBrowserData.total || null],
            ['receivables', 'Cobros', pendingReceivableRows.length],
            ['guarantees', 'Garantías', guaranteesToReturnRows.length],
            ['issues', 'Daños y faltantes', returnIssueRows.length],
            ['prepaid', 'Prepago VIP', prepaidLedgerRows.length],
            ['movements', 'Movimientos', filteredBigCashRows.length],
          ].map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              className={bigCashWorkspaceTab === id ? 'active' : ''}
              style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
              onClick={() => {
                setBigCashWorkspaceTab(id);
                setBigCashWorkspaceQuery('');
              }}
            >
              <span>{label}</span>{count !== null ? <b>{count}</b> : null}
            </button>
          ))}
        </nav>

        <section className="bigcash-workspace-panel bigcash-summary-workspace" hidden={bigCashWorkspaceTab !== 'summary'}>
          {renderBigCashRangeOnly('summary', 'Filtrar resumen por fecha de movimiento')}
          <div className="bigcash-ledger-overview">
          <article className="bigcash-ledger-card closing bigcash-period-strip">
            <div className="bigcash-period-heading">
              <span>MOVIMIENTO DEL PERÍODO</span>
              <h3>{bigCashPeriodRange.dateFrom || bigCashPeriodRange.dateTo
                ? `${bigCashPeriodRange.dateFrom ? formatDate(bigCashPeriodRange.dateFrom) : 'Inicio'} - ${bigCashPeriodRange.dateTo ? formatDate(bigCashPeriodRange.dateTo) : 'Hoy'}`
                : 'Todo el historial'}</h3>
            </div>
            <div className="bigcash-period-equation">
              <span><small>Cobrado</small><strong className="value-green">{formatBs(periodBigCashCollectedBs)}</strong></span>
              <i>−</i>
              <span><small>Egresado</small><strong className="value-orange">{formatBs(periodBigCashOutBs)}</strong></span>
              <i>=</i>
              <span className="net"><small>Resultado neto</small><strong className={periodBigCashNetBs < 0 ? 'value-orange' : 'value-blue'}>{formatBs(periodBigCashNetBs)}</strong></span>
            </div>
            <div className="bigcash-period-allocation">
              <span><small>Aplicado a operación</small><b>{formatBs(periodOperationalIncomeBs)}</b></span>
              <span><small>Apartado en garantías</small><b>{formatBs(periodGuaranteeIncomeBs)}</b></span>
            </div>
          </article>

          <article className="bigcash-ledger-card methods">
            <header>
              <div>
                <span>COBROS DEL MISMO PERÍODO</span>
                <h3>Detalle por medio y cuenta receptora</h3>
              </div>
            </header>
            <div className="bigcash-channel-table-wrap">
              <table className="bigcash-channel-table">
                <thead>
                  <tr>
                    <th>Medio</th>
                    <th>Cuenta receptora</th>
                    <th>Movimientos</th>
                    <th>Ingresó</th>
                    <th>Devuelto</th>
                    <th>Neto</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePaymentChannelRows.map((method) => (
                    <tr key={method.key}>
                      <td><span className={`bigcash-channel-badge ${method.className}`}>{method.shortLabel}</span><strong>{method.label}</strong></td>
                      <td>{method.account || 'Caja física'}</td>
                      <td>{method.count}</td>
                      <td className="income">{formatBs(method.collectedBs)}</td>
                      <td className="out">{formatBs(method.outBs)}</td>
                      <td className={method.netBs < 0 ? 'out net' : 'income net'}>{formatBs(method.netBs)}</td>
                    </tr>
                  ))}
                  {visiblePaymentChannelRows.length === 0 ? <tr><td colSpan={6}><p className="status">Sin movimientos confirmados en este período.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </article>
          </div>
          <article className="bigcash-card bigcash-transport-summary">
            <header>
              <div>
                <span>RESULTADO COMPLEMENTARIO</span>
                <h3><span className="bigcash-title-icon orange"><MiniIcon kind="chart" /></span>Transporte del período</h3>
                <p>El transporte se controla por separado del alquiler y de las garantías.</p>
              </div>
            </header>
            <div className="transport-margin-grid">
              <span><small>Cobrado</small><b className="value-green">{formatBs(monthTransportRevenueBs)}</b></span>
              <span><small>Gastado</small><b className="value-orange">{formatBs(monthTransportExpenseBs)}</b></span>
              <span className={monthTransportMarginBs >= 0 ? 'positive' : 'negative'}><small>Resultado</small><b>{formatBs(monthTransportMarginBs)}</b></span>
            </div>
          </article>
        </section>

        <section className="bigcash-workspace-panel" hidden={bigCashWorkspaceTab !== 'accounts'}>
          <article className="bigcash-card bigcash-movements">
            <header>
              <div>
                <span>TRAZABILIDAD POR CUENTA</span>
                <h3><span className="bigcash-title-icon blue"><CashIcon kind="table" /></span>Cuentas receptoras y efectivo</h3>
                <p>Consulta ingresos y egresos confirmados de cada medio sin cargar el estado completo.</p>
              </div>
              <div className="bigcash-header-total">
                <small>Neto del filtro</small>
                <strong>{formatBs(accountLedgerData.summary?.netBs ?? 0)}</strong>
              </div>
            </header>
            {renderBigCashRangeOnly('accounts', 'Fecha del movimiento')}
            <div className="bigcash-toolbar">
              <label>
                <select value={accountLedgerKey} onChange={(event) => setAccountLedgerKey(event.target.value)}>
                  <option value="all">Todas las cuentas</option>
                  {accountLedgerData.accounts.map((account) => (
                    <option key={account.key} value={account.key}>
                      {account.label} · {account.count} mov.
                    </option>
                  ))}
                </select>
              </label>
              <label className="bigcash-search">
                <input
                  value={bigCashWorkspaceQuery}
                  onChange={(event) => setBigCashWorkspaceQuery(event.target.value)}
                  placeholder="Buscar concepto, contrato, cliente, recibo o usuario..."
                />
                <MiniIcon kind="search" />
              </label>
            </div>
            <div className="bigcash-period-equation" style={{ marginBottom: 14 }}>
              <span><small>Ingresos</small><strong className="value-green">{formatBs(accountLedgerData.summary?.incomeBs ?? 0)}</strong></span>
              <i>−</i>
              <span><small>Egresos</small><strong className="value-orange">{formatBs(accountLedgerData.summary?.outBs ?? 0)}</strong></span>
              <i>=</i>
              <span className="net"><small>Neto</small><strong>{formatBs(accountLedgerData.summary?.netBs ?? 0)}</strong></span>
            </div>
            {accountLedgerData.error ? <p className="status">{accountLedgerData.error}</p> : null}
            <div className="bigcash-table-wrap">
              <table className="accounting-table bigcash-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Fecha</th>
                    <th style={{ width: 140 }}>Cuenta</th>
                    <th>Movimiento</th>
                    <th style={{ width: 170 }}>Origen / referencia</th>
                    <th style={{ width: 110 }}>Ingreso</th>
                    <th style={{ width: 110 }}>Egreso</th>
                    <th style={{ width: 140 }}>Registrado por</th>
                    <th style={{ width: 110 }}>Recibo</th>
                  </tr>
                </thead>
                <tbody>
                  {accountLedgerData.rows.map((movement) => {
                    const amount = toNumber(movement.amountBs);
                    return (
                      <tr key={movement.id} className={isVoidedCashMovement(movement) ? 'cash-row-voided' : ''}>
                        <td style={{ verticalAlign: 'top' }}><strong style={{ display: 'block' }}>{formatDate(movement.createdAt)}</strong><small style={{ display: 'block' }}>{getHourLabel(movement.createdAt)}</small></td>
                        <td style={{ verticalAlign: 'top' }}><span className={`payment-method-pill ${getPaymentMethodMeta(movement.paymentMethod).className}`} style={{ display: 'inline-flex', maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word' }}>{getPaymentMethodLabel(movement)}</span></td>
                        <td style={{ verticalAlign: 'top' }}><strong style={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.25 }}>{movement.description || movement.category || 'Movimiento'}</strong><small style={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{movement.category || movement.type || ''}</small></td>
                        <td style={{ verticalAlign: 'top' }}><strong style={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{movement.referenceLabel || getMovementReference(movement)}</strong>{movement.customerName ? <small style={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{movement.customerName}</small> : null}</td>
                        <td className="amount">{amount > 0 && !isVoidedCashMovement(movement) ? formatBs(amount) : '-'}</td>
                        <td className="negative amount">{amount < 0 && !isVoidedCashMovement(movement) ? formatBs(Math.abs(amount)) : '-'}</td>
                        <td style={{ verticalAlign: 'top' }}><span className="bigcash-user-label" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{movement.userLabel || getMovementUserLabel(movement)}</span></td>
                        <td>{renderReceiptActions(movement)}</td>
                      </tr>
                    );
                  })}
                  {accountLedgerData.rows.length === 0 ? (
                    <tr><td colSpan={8}><p className="status">{accountLedgerData.loading ? 'Cargando movimientos de cuenta...' : 'No hay movimientos para esta cuenta y período.'}</p></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {accountLedgerData.total > accountLedgerData.rows.length ? (
              <small className="bigcash-action-muted">Mostrando {accountLedgerData.rows.length} de {accountLedgerData.total} movimientos. Ajusta el rango de fechas para acotar la consulta.</small>
            ) : null}
          </article>
        </section>

        
<section className="bigcash-workspace-panel" hidden={bigCashWorkspaceTab !== 'receipts'}>
          <article className="bigcash-card bigcash-movements">
            <header>
              <div>
                <span>RESPALDO DOCUMENTAL</span>
                <h3><span className="bigcash-title-icon blue"><MiniIcon kind="report" /></span>Comprobantes y recibos</h3>
                <p>Incluye comprobantes subidos a la Hoja Flexible y recibos generados por Caja Grande.</p>
              </div>
              <div className="bigcash-header-total"><small>Resultados</small><strong>{receiptBrowserData.total}</strong></div>
            </header>
            {renderBigCashRangeOnly('receipts', 'Fecha del movimiento')}
            <div className="bigcash-toolbar">
              <label>
                <select value={receiptBrowserAccountKey} onChange={(event) => setReceiptBrowserAccountKey(event.target.value)}>
                  <option value="all">Todas las cuentas</option>
                  {receiptBrowserData.accounts.map((account) => (
                    <option key={account.key} value={account.key}>{account.label}</option>
                  ))}
                </select>
              </label>
              <div className="bigcash-receivables-switch" role="tablist" aria-label="Vista de comprobantes">
                <button type="button" role="tab" aria-selected={receiptBrowserView === 'gallery'} className={receiptBrowserView === 'gallery' ? 'is-active' : ''} onClick={() => setReceiptBrowserView('gallery')}>Galería</button>
                <button type="button" role="tab" aria-selected={receiptBrowserView === 'table'} className={receiptBrowserView === 'table' ? 'is-active' : ''} onClick={() => setReceiptBrowserView('table')}>Tabla</button>
              </div>
              <label className="bigcash-search">
                <input
                  value={bigCashWorkspaceQuery}
                  onChange={(event) => setBigCashWorkspaceQuery(event.target.value)}
                  placeholder="Buscar cliente, contrato, banco, nota o recibo..."
                />
                <MiniIcon kind="search" />
              </label>
            </div>
            {receiptBrowserData.error ? <p className="status">{receiptBrowserData.error}</p> : null}
            {receiptBrowserView === 'gallery' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
                {receiptBrowserData.rows.map((row) => {
                  const linkedMovement = row.cashMovementId ? cashMovements.find((movement) => String(movement?.id ?? '') === String(row.cashMovementId)) : null;
                  return (
                    <article key={row.browserId || `${row.contractId || 'x'}-${row.ledgerEntryId || row.cashMovementId || 'y'}`} className="bigcash-card" style={{ padding: 12, margin: 0, minWidth: 0 }}>
                      {row.attachment?.url ? (
                        <button
                          type="button"
                          onClick={() => window.open(row.attachment?.url, '_blank', 'noopener,noreferrer')}
                          style={{ width: '100%', height: 150, border: 0, borderRadius: 12, overflow: 'hidden', padding: 0, background: '#f4f6fa', cursor: 'pointer' }}
                          title="Abrir comprobante"
                        >
                          <img
                            src={row.attachment?.url}
                            alt={`Comprobante ${row.contractCode || ''}`}
                            loading="lazy"
                            decoding="async"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (linkedMovement) printCashReceipt(linkedMovement);
                          }}
                          disabled={!linkedMovement}
                          style={{ width: '100%', height: 150, border: '1px dashed #cbd5e1', borderRadius: 12, overflow: 'hidden', padding: 16, background: '#f8fafc', cursor: linkedMovement ? 'pointer' : 'default', display: 'grid', alignContent: 'center', justifyItems: 'center', gap: 6 }}
                          title="Abrir recibo"
                        >
                          <span className="bigcash-title-icon blue" style={{ width: 42, height: 42 }}><MiniIcon kind="report" /></span>
                          <strong style={{ textAlign: 'center' }}>{row.cashReceiptCode || 'RECIBO'}</strong>
                          <small style={{ textAlign: 'center' }}>Recibo generado por el sistema</small>
                        </button>
                      )}
                      <div style={{ display: 'grid', gap: 4, marginTop: 10 }}>
                        <strong style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{row.customerName || 'Cliente'}</strong>
                        <small>{row.sourceKind === 'attachment' ? 'Comprobante adjunto' : 'Recibo del sistema'}</small>
                        <small>Contrato {row.contractCode || '-'} · {formatDate(row.createdAt)}</small>
                        <small>{getPaymentMethodLabel(row)} · {formatBs(row.amountBs)}</small>
                        <small>{row.cashReceiptCode ? `Recibo ${row.cashReceiptCode}` : 'Sin recibo de caja vinculado'}</small>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                        {row.attachment?.url ? (
                          <button type="button" className="accounting-inline-action" onClick={() => window.open(row.attachment?.url, '_blank', 'noopener,noreferrer')}>Abrir imagen</button>
                        ) : null}
                        {linkedMovement ? (
                          <button type="button" className="accounting-inline-action" onClick={() => printCashReceipt(linkedMovement)}>Ver recibo</button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
                {receiptBrowserData.rows.length === 0 ? <p className="status">{receiptBrowserData.loading ? 'Cargando comprobantes...' : 'No hay comprobantes o recibos en este período.'}</p> : null}
              </div>
            ) : (
              <div className="bigcash-table-wrap">
                <table className="accounting-table bigcash-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Fecha</th>
                      <th>Cliente / contrato</th>
                      <th>Respaldo</th>
                      <th style={{ width: 140 }}>Cuenta</th>
                      <th style={{ width: 110 }}>Monto</th>
                      <th style={{ width: 130 }}>Registrado por</th>
                      <th style={{ width: 110 }}>Recibo</th>
                      <th style={{ width: 120 }}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiptBrowserData.rows.map((row) => {
                      const linkedMovement = row.cashMovementId ? cashMovements.find((movement) => String(movement?.id ?? '') === String(row.cashMovementId)) : null;
                      return (
                        <tr key={row.browserId || `${row.contractId || 'x'}-${row.ledgerEntryId || row.cashMovementId || 'y'}`}>
                          <td><strong style={{ display: 'block' }}>{formatDate(row.createdAt)}</strong><small style={{ display: 'block' }}>{getHourLabel(row.createdAt)}</small></td>
                          <td><strong style={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{row.customerName || 'Cliente'}</strong><small style={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>Contrato {row.contractCode || '-'}</small></td>
                          <td><strong style={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{row.note || row.typeLabel || 'Comprobante'}</strong><small style={{ display: 'block' }}>{row.sourceKind === 'attachment' ? 'Comprobante adjunto' : 'Recibo del sistema'}</small></td>
                          <td><span className={`payment-method-pill ${getPaymentMethodMeta(row.paymentMethod).className}`} style={{ display: 'inline-flex', maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-word' }}>{getPaymentMethodLabel(row)}</span></td>
                          <td className="amount">{formatBs(row.amountBs)}</td>
                          <td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{row.createdByName || 'Sistema'}</td>
                          <td>{row.cashReceiptCode || '-'}</td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {row.attachment?.url ? <button type="button" className="accounting-inline-action" onClick={() => window.open(row.attachment?.url, '_blank', 'noopener,noreferrer')}>Imagen</button> : null}
                              {linkedMovement ? <button type="button" className="accounting-inline-action" onClick={() => printCashReceipt(linkedMovement)}>Recibo</button> : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {receiptBrowserData.rows.length === 0 ? <tr><td colSpan={8}><p className="status">{receiptBrowserData.loading ? 'Cargando comprobantes...' : 'No hay comprobantes o recibos en este período.'}</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            )}
            {receiptBrowserData.total > receiptBrowserData.rows.length ? (
              <small className="bigcash-action-muted">Mostrando {receiptBrowserData.rows.length} de {receiptBrowserData.total} respaldos. Ajusta las fechas para ver otro período.</small>
            ) : null}
          </article>
        </section>


        <section className="bigcash-card bigcash-vip-prepaid-card" hidden={bigCashWorkspaceTab !== 'prepaid'}>
          <header>
            <div>
              <span>Clientes VIP</span>
              <h3><span className="bigcash-title-icon blue"><MiniIcon kind="lock" /></span>Saldos prepago no físicos</h3>
              <p>Crédito de clientes VIP. Se consume en contratos, pero no representa dinero nuevo en Caja Grande.</p>
            </div>
            <div className="bigcash-vip-summary" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <span><small>Saldo disponible</small><strong>{formatBs(totalPrepaidBalanceBs)}</strong></span>
              <span><small>Consumido</small><strong>{formatBs(totalPrepaidUsedBs)}</strong></span>
              <button type="button" className="primary-button" onClick={openVipTopUp}>+ Recargar saldo VIP</button>
            </div>
          </header>

          {renderBigCashWorkspaceSearch('Buscar cliente VIP, contrato o movimiento...', 'prepaid', 'Fecha del movimiento')}
          <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', margin: '0 0 14px' }}>
            <label style={{ minWidth: 280, display: 'grid', gap: 5 }}><small>Cliente para estado de cuenta</small><select value={vipReportClientId || prepaidClientRows[0]?.id || ''} onChange={(event) => setVipReportClientId(event.target.value)}>{prepaidClientRows.map((row) => <option key={row.id} value={row.id}>{row.name} · {formatBs(row.balanceBs)}</option>)}</select></label>
            <button type="button" className="ghost-button" onClick={() => setShowVipReport(true)} disabled={!prepaidClientRows.length}>Generar reporte</button>
            <button type="button" className="ghost-button" onClick={exportVipReportWorkbook} disabled={!prepaidClientRows.length || isExportingVipReport}>{isExportingVipReport ? 'Generando Excel...' : 'Exportar a Excel'}</button>
          </div>
          <div className="bigcash-table-wrap bigcash-vip-table-wrap">
            <table className="accounting-table bigcash-table bigcash-vip-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente VIP</th>
                  <th>Movimiento</th>
                  <th>Contrato / Orden</th>
                  <th>Monto</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {visiblePrepaidRows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.createdAt)} <small>{getHourLabel(row.createdAt)}</small></td>
                    <td>
                      <strong>{row.customerName}</strong>
                      <small>{row.client.whatsapp || row.client.phone || 'Sin telefono'}</small>
                    </td>
                    <td>
                      <strong>{row.description || (row.amountBs >= 0 ? 'Abono prepago' : 'Consumo prepago')}</strong>
                      {row.paymentMethodLabel ? <small>{row.paymentMethodLabel}{row.receiptCode ? ` · ${row.receiptCode}` : ''}</small> : null}
                      {row.amountBs > 0 && !row.rental ? (
                        <small className="cash-linked-reference">Saldo inicial o abono registrado en cliente</small>
                      ) : null}
                    </td>
                    <td>
                      <strong>{row.reference}</strong>
                      {row.eventDate ? <small>Evento {formatDate(row.eventDate)}</small> : null}
                    </td>
                    <td className={row.amountBs < 0 ? 'negative amount' : 'amount'}>
                      {row.amountBs < 0 ? `- ${formatBs(Math.abs(row.amountBs))}` : formatBs(row.amountBs)}
                    </td>
                    <td className="amount">{formatBs(row.balanceAfterBs)}</td>
                  </tr>
                ))}
                {visiblePrepaidRows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <p className="status">{bigCashWorkspaceQuery ? 'No se encontraron movimientos prepago con ese criterio.' : 'Aún no hay clientes VIP con cuenta prepago activa.'}</p>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bigcash-workspace-stack">
          <article className="bigcash-card bigcash-command-card receivables" hidden={bigCashWorkspaceTab !== 'receivables'}>
            <header>
              <div>
                <span>01 · Seguimiento</span>
                <h3>
                  <span className="bigcash-title-icon orange"><MiniIcon kind="info" /></span>
                  {receivablesView === 'pending' ? 'Contratos por cobrar' : 'Contratos cobrados y finalizados'}
                </h3>
                <p>
                  {receivablesView === 'pending'
                    ? 'Contratos con saldo pendiente, cliente, responsable y fecha de evento.'
                    : 'Historial de contratos sin saldo pendiente y finalizados administrativamente.'}
                </p>
              </div>
              <div className="bigcash-receivables-header-actions">
                <div className="bigcash-header-total">
                  <small>{receivablesView === 'pending' ? 'Pendiente en resultados' : 'Total liquidado en resultados'}</small>
                  <strong>{formatBs(receivablesView === 'pending' ? visibleReceivableTotalBs : visibleFinalizedReceivableTotalBs)}</strong>
                </div>
                {receivablesView === 'pending' ? (
                  <button
                    type="button"
                    className="primary-button bigcash-generate-report-button"
                    onClick={exportPendingReceivablesWorkbook}
                    disabled={visibleReceivableRows.length === 0}
                  >
                    Generar reporte
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-button bigcash-generate-report-button"
                    onClick={openFinalizedReceivablesReport}
                    disabled={visibleFinalizedReceivableRows.length === 0 || loadingFinalizedCollectionIds.length > 0}
                  >
                    {loadingFinalizedCollectionIds.length > 0 ? 'Verificando cobros...' : 'Generar reporte'}
                  </button>
                )}
              </div>
            </header>
            <div className="bigcash-receivables-switch" role="tablist" aria-label="Estado de cobro de contratos">
              <button
                type="button"
                role="tab"
                aria-selected={receivablesView === 'pending'}
                className={receivablesView === 'pending' ? 'is-active' : ''}
                onClick={() => setReceivablesView('pending')}
              >
                Por cobrar <b>{pendingReceivableRows.length}</b>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={receivablesView === 'finalized'}
                className={receivablesView === 'finalized' ? 'is-active' : ''}
                onClick={() => setReceivablesView('finalized')}
              >
                Cobrados y finalizados <b>{finalizedReceivableRows.length}</b>
              </button>
            </div>
            {renderBigCashWorkspaceSearch(
              'Buscar contrato, cliente o responsable...',
              'receivables',
              'Fecha del evento',
              receivablesView === 'pending' ? visibleReceivableRows.length : visibleFinalizedReceivableRows.length,
              '',
            )}
            {finalizedCollectionsError && receivablesView === 'finalized' ? (
              <p className="status error">{finalizedCollectionsError}</p>
            ) : null}
            <div className="bigcash-table-wrap bigcash-command-table-wrap">
              <table className="accounting-table bigcash-table bigcash-command-table">
                <thead style={{ position: 'sticky', top: 0, zIndex: 6, background: '#fff', boxShadow: '0 1px 0 rgba(15,23,42,.08)' }}>
                  {receivablesView === 'pending' ? (
                    <tr>
                      <th>Contrato</th>
                      <th>Cliente</th>
                      <th>Responsable</th>
                      <th>Fecha evento</th>
                      <th>A cobrar</th>
                      <th />
                    </tr>
                  ) : (
                    <tr>
                      <th>Contrato</th>
                      <th>Cliente</th>
                      <th>Responsable</th>
                      <th>Fecha evento</th>
                      <th>Total liquidado</th>
                      <th>Finalizado</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {receivablesView === 'pending' ? visibleReceivableRows.map((row) => (
                      <tr key={row.id}>
                        <td><strong>{row.contractCode || row.orderCode}</strong><small>{row.orderCode}</small></td>
                        <td><strong>{row.customerName}</strong></td>
                        <td>{row.responsibleName}</td>
                        <td>{formatDate(row.eventDate)}</td>
                        <td className="amount">
                          <strong>{formatBs(row.pendingBs)}</strong>
                          <small>Contrato {formatBs(row.contractPendingBs)} · Transporte {formatBs(row.transportPendingBs)} · Daños {formatBs(row.damagePendingBs)}</small>
                        </td>
                        <td><button type="button" className="accounting-inline-action" onClick={() => openCollectAction(row)}>Cobrar</button></td>
                      </tr>
                    )) : visibleFinalizedReceivableRows.flatMap((row) => {
                      const isExpanded = expandedFinalizedReceivableId === row.id;
                      const isLoadingCollections = loadingFinalizedCollectionIds.includes(String(row.id));
                      return [
                        <tr key={row.id} className="bigcash-finalized-receivable-row">
                          <td><strong>{row.contractCode || row.orderCode}</strong><small>{row.orderCode}</small></td>
                          <td><strong>{row.customerName}</strong></td>
                          <td>{row.responsibleName}</td>
                          <td>{formatDate(row.eventDate)}</td>
                          <td className="amount">{formatBs(row.settledBs)}</td>
                          <td>
                            <span className="bigcash-status-pill ready">Cobrado y finalizado</span>
                            <small>{formatDate(row.finalizedAt)}{row.finalizedByName ? ` · ${row.finalizedByName}` : ''}</small>
                            <button
                              type="button"
                              className="accounting-inline-action"
                              onClick={() => toggleFinalizedCollections(row)}
                              style={{ marginTop: 6 }}
                            >
                              {isExpanded
                                ? 'Ocultar cobros'
                                : row.collectionsLoaded
                                  ? `Ver cobros (${row.collectionMovements.length})`
                                  : 'Ver cobros'}
                            </button>
                          </td>
                        </tr>,
                        isExpanded ? (
                          <tr key={`${row.id}-collections`}>
                            <td colSpan={6} style={{ padding: '10px 16px 16px' }}>
                              <div style={{ fontWeight: 700, marginBottom: 8 }}>Detalle de cobros registrados en Caja Grande</div>
                              {isLoadingCollections ? (
                                <p className="status">Consultando el historial completo de Caja Grande...</p>
                              ) : row.collectionMovements.length ? (
                                <div className="bigcash-table-wrap">
                                  <table className="accounting-table bigcash-table">
                                    <thead>
                                      <tr>
                                        <th>Fecha</th>
                                        <th>Qué se cobró</th>
                                        <th>Cómo</th>
                                        <th>Monto</th>
                                        <th>Recibo</th>
                                        <th>Registrado por</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.collectionMovements.map((movement) => (
                                        <tr key={movement.id}>
                                          <td>{formatDate(movement.createdAt)}<small>{getHourLabel(movement.createdAt)}</small></td>
                                          <td>
                                            <strong>{movement.concept}</strong>
                                            {movement.description ? <small style={{ whiteSpace: 'pre-line' }}>{movement.description}</small> : null}
                                          </td>
                                          <td>{movement.paymentMethodLabel}</td>
                                          <td className="amount">{formatBs(movement.amountBs)}</td>
                                          <td>{movement.receiptCode || '-'}</td>
                                          <td>{movement.registeredBy || '-'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="status">No se encontraron movimientos reales de Caja vinculados a este contrato.</p>
                              )}
                            </td>
                          </tr>
                        ) : null,
                      ].filter(Boolean);
                    })}
                  {receivablesView === 'pending' && visibleReceivableRows.length === 0 ? (
                    <tr><td colSpan={6}><p className="status">No se encontraron contratos por cobrar con ese criterio.</p></td></tr>
                  ) : null}
                  {receivablesView === 'finalized' && visibleFinalizedReceivableRows.length === 0 ? (
                    <tr><td colSpan={6}><p className="status">No se encontraron contratos cobrados y finalizados con ese criterio.</p></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>

          <article className="bigcash-card bigcash-command-card guarantees" hidden={bigCashWorkspaceTab !== 'guarantees'}>
            <header>
              <div>
                <span>02 · Control</span>
                <h3>
                  <span className="bigcash-title-icon violet"><MiniIcon kind="lock" /></span>
                  {guaranteesView === 'pending' ? 'Garantías pendientes y por devolver' : 'Garantías devueltas y finalizadas'}
                </h3>
                <p>
                  {guaranteesView === 'pending'
                    ? 'Distingue lo acordado, lo efectivamente pagado, lo ya devuelto y el saldo todavía pendiente.'
                    : 'Solo garantías completamente liquidadas, respaldadas por sus movimientos y recibos de Caja Grande.'}
                </p>
              </div>
              <div className="bigcash-receivables-header-actions">
                {guaranteesView === 'pending' ? (
                  <>
                    <div className="bigcash-header-total">
                      <small>Saldo real por devolver</small>
                      <strong>{formatBs(visibleGuaranteePendingRefundBs)}</strong>
                    </div>
                    <div className="bigcash-header-total is-secondary">
                      <small>Garantía aún no pagada</small>
                      <strong>{formatBs(visibleGuaranteeUnpaidBs)}</strong>
                    </div>
                  </>
                ) : (
                  <div className="bigcash-header-total">
                    <small>Total resuelto</small>
                    <strong>{formatBs(visibleReturnedGuaranteeTotalBs)}</strong>
                  </div>
                )}
                <button
                  type="button"
                  className="primary-button bigcash-generate-report-button"
                  onClick={exportGuaranteesWorkbook}
                  disabled={isExportingGuarantees || (guaranteesView === 'pending' ? visibleGuaranteeRows.length === 0 : visibleReturnedGuaranteeRows.length === 0)}
                >
                  {isExportingGuarantees ? 'Generando...' : 'Generar reporte'}
                </button>
              </div>
            </header>
            <div className="bigcash-receivables-switch" role="tablist" aria-label="Estado de las garantías">
              <button
                type="button"
                role="tab"
                aria-selected={guaranteesView === 'pending'}
                className={guaranteesView === 'pending' ? 'is-active' : ''}
                onClick={() => setGuaranteesView('pending')}
              >
                Pendientes / por devolver <b>{guaranteesToReturnRows.length}</b>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={guaranteesView === 'returned'}
                className={guaranteesView === 'returned' ? 'is-active' : ''}
                onClick={() => setGuaranteesView('returned')}
              >
                Devueltas y finalizadas <b>{returnedGuaranteeRows.length}</b>
              </button>
            </div>
            {renderBigCashWorkspaceSearch(
              'Buscar contrato, cliente, responsable o estado...',
              'guarantees',
              'Fecha del evento',
              guaranteesView === 'pending' ? visibleGuaranteeRows.length : visibleReturnedGuaranteeRows.length,
              '',
            )}
            <div className={`bigcash-table-wrap bigcash-command-table-wrap bigcash-guarantees-table-wrap is-${guaranteesView}`}>
              <table className={`accounting-table bigcash-table bigcash-command-table bigcash-guarantees-table is-${guaranteesView}`}>
                <thead>
                  {guaranteesView === 'pending' ? (
                    <tr>
                      <th>Contrato</th>
                      <th>Cliente</th>
                      <th>Responsable</th>
                      <th>Situación</th>
                      <th>Acordada</th>
                      <th>Pagada</th>
                      <th>Aplicado</th>
                      <th>Ya devuelto</th>
                      <th>Saldo por devolver</th>
                      <th>Falta pagar</th>
                      <th />
                    </tr>
                  ) : (
                    <tr>
                      <th>Contrato</th>
                      <th>Cliente</th>
                      <th>Responsable</th>
                      <th>Fecha evento</th>
                      <th>Fecha resolución</th>
                      <th>Resultado</th>
                      <th>Garantía pagada</th>
                      <th>Aplicado</th>
                      <th>Devuelto</th>
                      <th>Método / recibo</th>
                      <th>Registrado por</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {guaranteesView === 'pending' ? visibleGuaranteeRows.map((row) => (
                    <tr key={row.id} className={row.isReadyToReturn ? 'guarantee-ready-row' : ''}>
                      <td><strong>{row.contractCode}</strong><small>{formatDate(row.eventDate)}</small></td>
                      <td><strong>{row.customerName}</strong></td>
                      <td>{row.responsibleName}</td>
                      <td><span className={`bigcash-status-pill ${row.isReadyToReturn ? 'ready' : 'waiting'}`}>{row.statusLabel}</span></td>
                      <td className="amount">{formatBs(row.declaredBs)}</td>
                      <td className="amount"><strong>{formatBs(row.guaranteePaidBs)}</strong><small>{row.paymentMethodLabel}</small></td>
                      <td className="amount">{formatBs(row.appliedBs)}</td>
                      <td className="amount">{formatBs(row.refundedBs)}</td>
                      <td className="amount"><strong>{formatBs(row.refundableBs)}</strong></td>
                      <td className="amount">{formatBs(row.unvalidatedBs)}</td>
                      <td>
                        {row.isReadyToReturn && row.isMoneyHeld ? (
                          <button
                            type="button"
                            className="accounting-inline-action"
                            onClick={() => openGuaranteeRefund(row)}
                            disabled={isSubmittingCash}
                            title="Devolver garantía y generar recibo"
                          >
                            Devolver
                          </button>
                        ) : (
                          <span className="bigcash-action-muted">{row.isMoneyHeld ? 'No listo' : 'Sin dinero'}</span>
                        )}
                      </td>
                    </tr>
                  )) : visibleReturnedGuaranteeRows.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.contractCode}</strong><small>{row.orderCode}</small></td>
                      <td><strong>{row.customerName}</strong></td>
                      <td>{row.responsibleName}</td>
                      <td>{formatDate(row.eventDate)}</td>
                      <td><strong>{formatDate(row.returnedAt)}</strong><small>{getLongHourLabel(row.returnedAt)}</small></td>
                      <td><span className="bigcash-status-pill ready">{row.statusLabel}</span></td>
                      <td className="amount">{formatBs(row.guaranteePaidBs)}</td>
                      <td className="amount">{formatBs(row.appliedBs)}</td>
                      <td className="amount"><strong>{formatBs(row.refundedBs)}</strong></td>
                      <td><strong>{row.paymentMethodLabel}</strong><small>{row.receiptCodes || 'Sin recibo registrado'}</small></td>
                      <td>{row.registeredBy}</td>
                    </tr>
                  ))}
                  {guaranteesView === 'pending' && visibleGuaranteeRows.length === 0 ? (
                    <tr><td colSpan={11}><p className="status">No se encontraron garantías pendientes o por devolver con ese criterio.</p></td></tr>
                  ) : null}
                  {guaranteesView === 'returned' && visibleReturnedGuaranteeRows.length === 0 ? (
                    <tr><td colSpan={11}><p className="status">No se encontraron garantías finalizadas con ese criterio.</p></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <section className="bigcash-card bigcash-return-issues-card" hidden={bigCashWorkspaceTab !== 'issues'}>
          <header>
            <div>
              <span>03 - Recepción</span>
              <h3><span className="bigcash-title-icon orange"><MiniIcon kind="info" /></span>Daños y faltantes por contrato</h3>
              <p>{returnIssuesView === 'pending' ? 'Cargos al cliente que todavía deben cobrarse.' : 'Historial de cargos cobrados, cubiertos o liquidados internamente.'}</p>
            </div>
            <div className="bigcash-receivables-header-actions">
              <div className="bigcash-header-total">
                <small>{returnIssuesView === 'pending' ? 'Pendiente en resultados' : 'Total liquidado en resultados'}</small>
                <strong>{formatBs(visibleReturnIssueTotalBs)}</strong>
              </div>
              <button type="button" className="bigcash-export-button" onClick={() => setShowReturnIssuesReport(true)} disabled={visibleReturnIssueRows.length === 0}>Generar reporte</button>
            </div>
          </header>
          <div className="bigcash-receivables-switch" role="tablist" aria-label="Estado de daños y faltantes">
            <button type="button" role="tab" aria-selected={returnIssuesView === 'pending'} className={returnIssuesView === 'pending' ? 'is-active' : ''} onClick={() => setReturnIssuesView('pending')}>
              Por cobrar <b>{returnIssueRows.filter((row) => row.chargeOwner === 'cliente' && toNumber(row.pendingDamageBs) > 0.009).length}</b>
            </button>
            <button type="button" role="tab" aria-selected={returnIssuesView === 'settled'} className={returnIssuesView === 'settled' ? 'is-active' : ''} onClick={() => setReturnIssuesView('settled')}>
              Cobrados y liquidados <b>{returnIssueRows.filter((row) => row.chargeOwner !== 'cliente' || toNumber(row.pendingDamageBs) <= 0.009).length}</b>
            </button>
          </div>
          {renderBigCashWorkspaceSearch('Buscar contrato, cliente, ítem o novedad...', 'issues', 'Fecha de recepción', visibleReturnIssueRows.length, '')}
          <div className="bigcash-table-wrap bigcash-command-table-wrap">
            <table className="accounting-table bigcash-table bigcash-command-table bigcash-return-issues-table">
              <thead>
                <tr>
                  <th>Contrato</th>
                  <th>Item</th>
                  <th>Novedad</th>
                  <th>Origen</th>
                  <th>Penalización</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleReturnIssueRows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.contractCode}</strong><small>{row.customerName}</small></td>
                    <td><strong>{row.itemName}</strong>{row.note ? <small>{row.note}</small> : null}</td>
                    <td>
                      <strong>{row.damagedQty > 0 ? `${row.damagedQty} rotos` : ''}{row.damagedQty > 0 && row.missingQty > 0 ? ' / ' : ''}{row.missingQty > 0 ? `${row.missingQty} faltantes` : ''}</strong>
                      <small>Daño {formatBs(row.damagedUnitChargeBs)} | Falta {formatBs(row.missingUnitChargeBs)}</small>
                    </td>
                    <td><span className={`bigcash-status-pill ${row.chargeOwner === 'cliente' ? 'ready' : 'waiting'}`}>{getReturnIssueOwnerLabel(row.chargeOwner)}</span></td>
                    <td className="amount">{formatBs(row.penaltyBs)}</td>
                    <td>
                      {row.chargeOwner === 'cliente'
                        ? <span className={`bigcash-status-pill ${row.pendingDamageBs > 0.009 ? 'waiting' : 'ready'}`}>{row.pendingDamageBs > 0.009 ? `Por cobrar ${formatBs(row.pendingDamageBs)}` : 'Cobrado / cubierto'}</span>
                        : <span className="bigcash-status-pill waiting">Pérdida interna</span>}
                    </td>
                    <td>
                      {row.chargeOwner === 'cliente' && row.pendingDamageBs > 0.009 ? (
                        <button type="button" className="accounting-inline-action" onClick={() => openCollectAction({ ...row, id: row.rentalId, pendingBs: row.pendingDamageBs, damagePendingBs: row.pendingDamageBs, collectionTarget: 'damage' })}>Cobrar</button>
                      ) : (
                        <span className="bigcash-action-muted">Registro</span>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleReturnIssueRows.length === 0 ? <tr><td colSpan={7}><p className="status">No se encontraron daños o faltantes {returnIssuesView === 'pending' ? 'por cobrar' : 'liquidados'} con ese criterio.</p></td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        {bigCashWorkspaceTab === 'movements' ? (
        <section className="bigcash-operations-grid">
          <article className="bigcash-card bigcash-movements">
            <header>
              <div>
                <h3><span className="bigcash-title-icon blue"><CashIcon kind="table" /></span>Movimientos de Caja Grande</h3>
                <p>
                  {operationsLoading
                    ? 'Cargando historial contable...'
                    : cashMovementMeta?.truncated
                      ? `Historial reciente: ${cashMovementMeta.visible} de ${cashMovementMeta.total} movimientos. Los saldos consideran todo el historial.`
                      : `${filteredBigCashRows.length} movimiento${filteredBigCashRows.length === 1 ? '' : 's'} en el período seleccionado.`}
                </p>
              </div>
              <button
                type="button"
                className="bigcash-export-button"
                onClick={() => printCashHistoryReport({
                  cashBoxType: 'BIG_CASH',
                  rows: filteredBigCashRows,
                  title: 'Libro de Caja Grande',
                  dateFrom: bigCashMovementRange.dateFrom,
                  dateTo: bigCashMovementRange.dateTo,
                })}
              >
                <MiniIcon kind="report" />
                Reporte
              </button>
            </header>
            {renderBigCashRangeOnly('movements', 'Fecha del movimiento')}
            <div className="bigcash-toolbar">
              <label>
                <select value={bigCashTypeFilter} onChange={(event) => setBigCashTypeFilter(event.target.value)}>
                  <option value="all">Todos los tipos</option>
                  <option value="income">Ingresos operativos</option>
                  <option value="guarantee">Garantías retenidas</option>
                  <option value="transfer">Retiros</option>
                </select>
              </label>
              <label>
                <select value={bigCashPeriod} onChange={(event) => {
                  const nextPeriod = event.target.value;
                  setBigCashPeriod(nextPeriod);
                  if (nextPeriod !== 'custom') {
                    const nextRange = getPeriodRange(selectedDate, nextPeriod);
                    setBigCashWorkspaceRanges((current) => ({ ...current, movements: nextRange }));
                  }
                }}>
                  <option value="recent">Últimos 90 días</option>
                  <option value="day">Día</option>
                  <option value="week">Semana</option>
                  <option value="month">Mes</option>
                  <option value="custom">Rango personalizado</option>
                </select>
              </label>
              <label className="bigcash-search">
                <input
                  value={bigCashQuery}
                  onChange={(event) => setBigCashQuery(event.target.value)}
                  placeholder="Buscar concepto, contrato, recibo..."
                />
                <MiniIcon kind="search" />
              </label>
            </div>

            <div className="bigcash-table-wrap">
              <table className="accounting-table bigcash-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Concepto</th>
                    <th>Referencia</th>
                    <th>Método</th>
                    <th>Ingreso</th>
                    <th>Retiro</th>
                    <th>Saldo</th>
                    <th>Usuario</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredBigCashRows.map((movement, index) => {
                    const meta = getBigCashMovementType(movement);
                    const paymentMeta = getPaymentMethodMeta(movement.paymentMethod);
                    const hasTransportRevenue = toNumber(movement?.transportRevenueBs) > 0
                      || String(movement?.accountingTag ?? '') === 'transport_revenue'
                      || String(movement?.category ?? '').toLowerCase() === 'transporte_cobrado'
                      || String(movement?.type ?? '').toLowerCase() === 'ingreso_transporte_cliente';
                    return (
                      <tr key={movement.id} className={isVoidedCashMovement(movement) ? 'cash-row-voided' : ''}>
                        <td style={{ verticalAlign: 'top' }}><strong style={{ display: 'block' }}>{formatDate(movement.createdAt)}</strong><small style={{ display: 'block' }}>{getHourLabel(movement.createdAt)}</small></td>
                        <td><span className={`bigcash-type-icon ${meta.className}`}><MiniIcon kind={meta.icon} /></span></td>
                        <td>
                          <strong>{movement.description}</strong>
                          {hasTransportRevenue ? (
                            <small className="cash-linked-reference">
                              Transporte cobrado en {getMovementReference(movement)}
                            </small>
                          ) : null}
                        </td>
                        <td>{getMovementReference(movement)}</td>
                        <td><span className={`payment-method-pill ${paymentMeta.className}`}>{getPaymentMethodLabel(movement)}</span></td>
                        <td className="amount">{meta.income}</td>
                        <td className="negative amount">{meta.withdrawal}</td>
                        <td>{formatBs(runningBigCashBalance(index))}</td>
                        <td><span className="bigcash-user-label">{getMovementUserLabel(movement)}</span></td>
                        <td>{renderReceiptActions(movement)}</td>
                      </tr>
                    );
                  })}
                  {filteredBigCashRows.length === 0 ? <tr><td colSpan={10}><p className="status">{operationsLoading ? 'Cargando movimientos...' : 'Sin movimientos registrados en este periodo.'}</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </article>

        </section>
        ) : null}
        {vipTopUpModalOpen ? (
          <div className="bigcash-report-backdrop" onClick={() => !vipTopUpSubmitting && setVipTopUpModalOpen(false)}>
            <section className="bigcash-report-modal" style={{ maxWidth: 760 }} onClick={(event) => event.stopPropagation()}>
              <header className="bigcash-report-modal-head"><div><h2>Recargar saldo Prepago VIP</h2><p>El dinero entra una sola vez a Caja Grande y aumenta el crédito disponible del cliente.</p></div><button type="button" className="bigcash-report-close" onClick={() => setVipTopUpModalOpen(false)} disabled={vipTopUpSubmitting}>×</button></header>
              <form onSubmit={submitVipTopUp} style={{ padding: 22, display: 'grid', gap: 16 }}>
                <div className="accounting-form-grid two">
                  <label>Cliente VIP<select value={vipTopUpForm.clientId} onChange={(event) => setVipTopUpForm((current) => ({ ...current, clientId: event.target.value }))} required><option value="">Seleccionar cliente</option>{prepaidClientRows.map((row) => <option key={row.id} value={row.id}>{row.name} · saldo {formatBs(row.balanceBs)}</option>)}</select></label>
                  <label>Fecha<input type="date" value={vipTopUpForm.date} onChange={(event) => setVipTopUpForm((current) => ({ ...current, date: event.target.value }))} required /></label>
                  <label>Monto (Bs)<input type="number" min="0.01" step="0.01" value={vipTopUpForm.amountBs} onChange={(event) => setVipTopUpForm((current) => ({ ...current, amountBs: event.target.value }))} required /></label>
                  <label>Método<select value={vipTopUpForm.paymentMethod} onChange={(event) => setVipTopUpForm((current) => ({ ...current, paymentMethod: event.target.value, paymentAccount: event.target.value === 'qr' ? current.paymentAccount : '' }))}><option value="efectivo">Efectivo</option><option value="qr">QR</option><option value="transferencia">Transferencia</option></select></label>
                  {vipTopUpForm.paymentMethod === 'qr' ? <label>Cuenta QR<select value={vipTopUpForm.paymentAccount} onChange={(event) => setVipTopUpForm((current) => ({ ...current, paymentAccount: event.target.value }))} required><option value="">Seleccionar</option>{['CIDRE','BCP','MERCANTIL','BNB','BANCO FIE'].map((account) => <option key={account} value={account}>{account}</option>)}</select></label> : null}
                  <label style={{ gridColumn: '1 / -1' }}>Motivo<input value={vipTopUpForm.reason} onChange={(event) => setVipTopUpForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Ej: RECARGA PARA EVENTOS DE AGOSTO" required /></label>
                  <label style={{ gridColumn: '1 / -1' }}>Observación adicional<textarea value={vipTopUpForm.notes} onChange={(event) => setVipTopUpForm((current) => ({ ...current, notes: event.target.value }))} rows={3} /></label>
                </div>
                {vipTopUpError ? <p className="status error">{vipTopUpError}</p> : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}><button type="button" className="ghost-button" onClick={() => setVipTopUpModalOpen(false)} disabled={vipTopUpSubmitting}>Cancelar</button><button type="submit" className="primary-button" disabled={vipTopUpSubmitting}>{vipTopUpSubmitting ? 'Registrando...' : 'Registrar recarga y generar recibo'}</button></div>
              </form>
            </section>
          </div>
        ) : null}
        {showVipReport && selectedVipReportClient ? (
          <div className="bigcash-report-backdrop" onClick={() => setShowVipReport(false)}>
            <section className="bigcash-report-modal" onClick={(event) => event.stopPropagation()}>
              <header className="bigcash-report-modal-head"><div><h2>Estado de Cuenta Prepago VIP</h2><p>{selectedVipReportClient.name} · rendición de recargas y consumos.</p></div><button type="button" className="bigcash-report-close" onClick={() => setShowVipReport(false)}>×</button></header>
              <div className="bigcash-report-document"><div className="bigcash-report-page">
                <header className="bigcash-report-doc-head"><div><div className="bigcash-report-brand">EL COPETÍN · CAJA GRANDE</div><h3>Estado de Cuenta Prepago VIP</h3><p>{selectedVipReportClient.name}</p></div></header>
                <section className="bigcash-report-summary"><article><small>Saldo inicial</small><strong>{formatBs(vipReportSummary.openingBs)}</strong></article><article><small>Recargas</small><strong>{formatBs(vipReportSummary.depositsBs)}</strong></article><article><small>Consumos</small><strong>{formatBs(vipReportSummary.usedBs)}</strong></article><article><small>Saldo final</small><strong>{formatBs(vipReportSummary.closingBs)}</strong></article></section>
                <div className="bigcash-table-wrap"><table className="accounting-table bigcash-table"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Contrato / OS</th><th>Evento</th><th>Recarga</th><th>Consumo</th><th>Saldo</th></tr></thead><tbody>{vipReportRows.map((row) => <tr key={row.id}><td>{formatDate(row.createdAt)}<small>{getHourLabel(row.createdAt)}</small></td><td><strong>{row.description || (row.amountBs >= 0 ? 'Recarga VIP' : 'Consumo VIP')}</strong>{row.paymentMethodLabel ? <small>{row.paymentMethodLabel}{row.receiptCode ? ` · ${row.receiptCode}` : ''}</small> : null}</td><td>{row.reference}</td><td>{row.eventDate ? formatDate(row.eventDate) : '-'}</td><td className="amount">{row.amountBs > 0 ? formatBs(row.amountBs) : '-'}</td><td className="negative amount">{row.amountBs < 0 ? formatBs(Math.abs(row.amountBs)) : '-'}</td><td className="amount">{formatBs(row.balanceAfterBs)}</td></tr>)}{!vipReportRows.length ? <tr><td colSpan={7}><p className="status">Sin movimientos VIP en este rango.</p></td></tr> : null}</tbody></table></div>
              </div></div>
              <footer className="bigcash-report-modal-actions"><button type="button" className="ghost-button" onClick={() => setShowVipReport(false)}>Cerrar</button><button type="button" className="ghost-button" onClick={exportVipReportWorkbook} disabled={isExportingVipReport}>{isExportingVipReport ? 'Generando...' : 'Exportar a Excel'}</button><button type="button" className="primary-button" onClick={printVipReport}>Imprimir / guardar PDF</button></footer>
            </section>
          </div>
        ) : null}
        {showFinalizedReceivablesReport ? (
          <div className="bigcash-report-backdrop" onClick={() => setShowFinalizedReceivablesReport(false)}>
            <section className="bigcash-report-modal" onClick={(event) => event.stopPropagation()}>
              <header className="bigcash-report-modal-head">
                <div>
                  <h2>Reporte de cobros y contratos finalizados</h2>
                  <p>Vista previa del rango y filtros actualmente aplicados en Caja Grande.</p>
                </div>
                <button type="button" className="bigcash-report-close" onClick={() => setShowFinalizedReceivablesReport(false)} aria-label="Cerrar reporte">×</button>
              </header>
              <div className="bigcash-report-document">
                <div className="bigcash-report-page">
                  <header className="bigcash-report-doc-head">
                    <div>
                      <div className="bigcash-report-brand">EL COPETÍN · CAJA GRANDE</div>
                      <h3>Reporte de Cobros y Contratos Finalizados</h3>
                      <p>Seguimiento de contratos liquidados y trazabilidad de los cobros registrados.</p>
                    </div>
                    <div className="bigcash-report-meta">
                      <div><span>Periodo</span><strong>{finalizedReceivablesReportRange}</strong></div>
                      <div><span>Generado</span><strong>{new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</strong></div>
                      <div><span>Contratos</span><strong>{visibleFinalizedReceivableRows.length}</strong></div>
                    </div>
                  </header>
                  <section className="bigcash-report-summary">
                    <article><small>Contratos encontrados</small><strong>{visibleFinalizedReceivableRows.length}</strong></article>
                    <article className="money"><small>Total liquidado</small><strong>{formatBs(visibleFinalizedReceivableTotalBs)}</strong></article>
                    <article><small>Movimientos de cobro</small><strong>{finalizedReceivablesCollectionRows.filter((row) => row.amountBs > 0).length}</strong></article>
                  </section>
                  <section className="bigcash-report-section">
                    <h4>Detalle de contratos del rango</h4>
                    <div className="bigcash-table-wrap">
                      <table className="bigcash-report-table">
                        <thead><tr><th>N°</th><th>Contrato</th><th>Cliente</th><th>Responsable</th><th>Evento</th><th>Total liquidado</th><th>Finalizado</th></tr></thead>
                        <tbody>
                          {visibleFinalizedReceivableRows.map((row, index) => (
                            <tr key={`report-contract-${row.id}`}>
                              <td>{index + 1}</td>
                              <td><strong>{row.contractCode || row.orderCode}</strong><small>{row.orderCode}</small></td>
                              <td>{row.customerName}</td>
                              <td>{row.responsibleName}</td>
                              <td>{formatDate(row.eventDate)}</td>
                              <td className="amount">{formatBs(row.settledBs)}</td>
                              <td>{formatDate(row.finalizedAt)}<small>{row.finalizedByName || 'Sin usuario registrado'}</small></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="bigcash-report-section">
                    <h4>Cobros y recuperaciones realizadas</h4>
                    <div className="bigcash-table-wrap">
                      <table className="bigcash-report-table">
                        <thead><tr><th>N°</th><th>Contrato / cliente</th><th>Fecha / hora</th><th>Qué se cobró</th><th>Cómo</th><th>Monto</th><th>Recibo</th><th>Registrado por</th></tr></thead>
                        <tbody>
                          {finalizedReceivablesCollectionRows.map((movement, index) => (
                            <tr key={`report-movement-${movement.contractRow.id}-${movement.id}`}>
                              <td>{index + 1}</td>
                              <td><strong>{movement.contractRow.contractCode || movement.contractRow.orderCode}</strong><small>{movement.contractRow.customerName}</small></td>
                              <td>{movement.createdAt ? formatDate(movement.createdAt) : '-'}<small>{movement.createdAt ? getHourLabel(movement.createdAt) : ''}</small></td>
                              <td><strong>{movement.concept}</strong>{movement.description ? <small>{movement.description}</small> : null}</td>
                              <td>{movement.paymentMethodLabel || '-'}</td>
                              <td className="amount">{formatBs(movement.amountBs)}</td>
                              <td>{movement.receiptCode || '-'}</td>
                              <td>{movement.registeredBy || '-'}</td>
                            </tr>
                          ))}
                          {finalizedReceivablesCollectionRows.length === 0 ? (
                            <tr><td colSpan={8}>No se encontraron movimientos reales de Caja vinculados a estos contratos.</td></tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              </div>
              <footer className="bigcash-report-footer">
                <button type="button" className="ghost-button" onClick={() => setShowFinalizedReceivablesReport(false)}>Cerrar</button>
                <button type="button" className="ghost-button" onClick={exportFinalizedReceivablesWorkbook} disabled={isExportingFinalizedReceivables}>
                  {isExportingFinalizedReceivables ? 'Generando Excel...' : 'Exportar a Excel'}
                </button>
                <button type="button" className="primary-button" onClick={printFinalizedReceivablesReport}>Imprimir / guardar PDF</button>
              </footer>
            </section>
          </div>
        ) : null}
        {showReturnIssuesReport ? (
          <div className="bigcash-report-backdrop" onClick={() => setShowReturnIssuesReport(false)}>
            <section className="bigcash-report-modal" onClick={(event) => event.stopPropagation()}>
              <header className="bigcash-report-modal-head">
                <div>
                  <h2>Reporte de daños y faltantes</h2>
                  <p>Vista previa del estado, rango y filtros actualmente aplicados.</p>
                </div>
                <button type="button" className="bigcash-report-close" onClick={() => setShowReturnIssuesReport(false)} aria-label="Cerrar reporte">×</button>
              </header>
              <div className="bigcash-report-document">
                <div className="bigcash-report-page">
                  <header className="bigcash-report-doc-head">
                    <div>
                      <div className="bigcash-report-brand">EL COPETÍN · CAJA GRANDE</div>
                      <h3>{returnIssuesView === 'pending' ? 'Daños y faltantes por cobrar' : 'Daños y faltantes cobrados y liquidados'}</h3>
                      <p>Control separado de cargos originados en la recepción de inventario.</p>
                    </div>
                    <div className="bigcash-report-meta">
                      <div><span>Periodo</span><strong>{returnIssuesReportRange}</strong></div>
                      <div><span>Generado</span><strong>{new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</strong></div>
                      <div><span>Registros</span><strong>{visibleReturnIssueRows.length}</strong></div>
                    </div>
                  </header>
                  <section className="bigcash-report-summary">
                    <article><small>Registros encontrados</small><strong>{visibleReturnIssueRows.length}</strong></article>
                    <article className="money"><small>{returnIssuesView === 'pending' ? 'Total pendiente' : 'Total liquidado'}</small><strong>{formatBs(visibleReturnIssueTotalBs)}</strong></article>
                    <article><small>Estado</small><strong>{returnIssuesView === 'pending' ? 'Por cobrar' : 'Liquidados'}</strong></article>
                  </section>
                  <section className="bigcash-report-section">
                    <h4>Detalle de daños y faltantes</h4>
                    <div className="bigcash-table-wrap">
                      <table className="bigcash-report-table">
                        <thead><tr><th>N°</th><th>Contrato / cliente</th><th>Ítem</th><th>Novedad</th><th>Origen</th><th>Penalización</th><th>Liquidado</th><th>Pendiente</th><th>Estado</th></tr></thead>
                        <tbody>
                          {visibleReturnIssueRows.map((row, index) => (
                            <tr key={`report-issue-${row.id}`}>
                              <td>{index + 1}</td>
                              <td><strong>{row.contractCode || row.orderCode}</strong><small>{row.customerName}</small></td>
                              <td><strong>{row.itemName}</strong>{row.note ? <small>{row.note}</small> : null}</td>
                              <td>{row.damagedQty > 0 ? `${row.damagedQty} dañado(s)` : ''}{row.damagedQty > 0 && row.missingQty > 0 ? ' / ' : ''}{row.missingQty > 0 ? `${row.missingQty} faltante(s)` : ''}</td>
                              <td>{getReturnIssueOwnerLabel(row.chargeOwner)}</td>
                              <td className="amount">{formatBs(row.penaltyBs)}</td>
                              <td className="amount">{formatBs(row.settledDamageBs)}</td>
                              <td className="amount">{formatBs(row.pendingDamageBs)}</td>
                              <td>{row.chargeOwner !== 'cliente' ? 'Pérdida interna' : row.pendingDamageBs > 0.009 ? 'Por cobrar' : 'Cobrado / cubierto'}</td>
                            </tr>
                          ))}
                          {visibleReturnIssueRows.length === 0 ? <tr><td colSpan={9}>Sin resultados.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              </div>
              <footer className="bigcash-report-footer">
                <button type="button" className="ghost-button" onClick={() => setShowReturnIssuesReport(false)}>Cerrar</button>
                <button type="button" className="ghost-button" onClick={exportReturnIssuesWorkbook} disabled={isExportingReturnIssues || visibleReturnIssueRows.length === 0}>{isExportingReturnIssues ? 'Generando Excel...' : 'Exportar a Excel'}</button>
                <button type="button" className="primary-button" onClick={printReturnIssuesReport} disabled={visibleReturnIssueRows.length === 0}>Imprimir / guardar PDF</button>
              </footer>
            </section>
          </div>
        ) : null}
        {renderBigCashListModal()}
        {renderCashModals()}
      </section>
    );
  }

  if (activeModule === 'contabilidad_caja_chica') {
    return (
      <section className="panel accounting-pettycash-view accounting-redesign">
        <header className="accounting-bigcash-head pettycash-head">
          <div>
            <h2>Caja Chica</h2>
            <p>Control diario de gastos, adelantos, proveedores y deudas pagadas desde Caja Grande.</p>
            <span className="accounting-source-badge"><i />Fondo recibido únicamente desde Caja Grande</span>
          </div>
          <div className="accounting-overview-actions">
            <label className="accounting-date-control petty-date-control">
              <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
              <span className="date-icon"><MiniIcon kind="calendar" /></span>
            </label>
          </div>
        </header>

        <section className="petty-kpi-grid petty-money-grid">
          <article className="petty-kpi-card balance petty-balance-primary">
            <div className="petty-card-title">
              <span className="petty-hero-icon green"><CashIcon kind="petty" /></span>
              <div>
                <strong>SALDO DISPONIBLE</strong>
                <h3 className="value-green">{formatBs(pettyCashBalanceBs)}</h3>
                <p>Dinero disponible actualmente</p>
              </div>
            </div>
            <div className="petty-money-context">
              <span><small>Saldo antes de esta fecha</small><b>{formatBs(pettyBalanceBeforeSelectedDateBs)}</b></span>
              <span><small>Variación del día</small><b className={selectedDayPettyNetBs >= 0 ? 'value-green' : 'value-orange'}>{selectedDayPettyNetBs >= 0 ? '+' : '-'} {formatBs(Math.abs(selectedDayPettyNetBs))}</b></span>
            </div>
          </article>

          <article className="petty-kpi-card petty-day-movement">
            <div className="petty-card-title">
              <span className="petty-hero-icon blue"><MiniIcon kind="calendar" /></span>
              <div>
                <strong>MOVIMIENTO DEL DÍA</strong>
                <h3 className={selectedDayPettyNetBs >= 0 ? 'value-blue' : 'value-orange'}>{selectedDayPettyNetBs >= 0 ? '+' : '-'} {formatBs(Math.abs(selectedDayPettyNetBs))}</h3>
                <p>{formatDate(selectedDate)}</p>
              </div>
            </div>
            <div className="petty-day-equation" aria-label="Calculo del saldo del día">
              <span><small>Saldo anterior</small><b>{formatBs(pettyBalanceBeforeSelectedDateBs)}</b></span>
              <i>+</i>
              <span><small>Recibido hoy</small><b className="value-blue">{formatBs(dayTransfersToPettyBs)}</b></span>
              <i>−</i>
              <span><small>Gastado hoy</small><b className="value-orange">{formatBs(dayPettyExpenseBs)}</b></span>
            </div>
            <div className="petty-day-closing">
              <small>Saldo al cierre de la fecha</small>
              <strong className={selectedDayPettyClosingBs >= 0 ? 'value-green' : 'value-orange'}>{formatBs(selectedDayPettyClosingBs)}</strong>
            </div>
          </article>

          <article className="petty-kpi-card expenses petty-history-money">
            <div className="petty-card-title">
              <span className="petty-hero-icon orange"><MiniIcon kind="chart" /></span>
              <div>
                <strong>ACUMULADO HASTA LA FECHA</strong>
                <h3 className="value-blue">{formatBs(pettyReceivedToDateBs)}</h3>
                <p>Total recibido desde Caja Grande</p>
              </div>
            </div>
            <div className="petty-money-context">
              <span><small>Total utilizado</small><b className="value-orange">- {formatBs(pettySpentToDateBs)}</b></span>
              <span><small>Movimientos</small><b>{pettyIncomeCountToDate} ingresos · {pettyExpenseCountToDate} salidas</b></span>
            </div>
          </article>
        </section>

        <nav className="petty-workspace-tabs" aria-label="Secciones de Caja Chica">
          {[
            ['expenses', 'Gastos', pettySectorPages.expenses.total],
            ['advances', 'Adelantos', pettySectorPages.advances.total],
            ['suppliers', 'Proveedores', pettySectorPages.suppliers.total],
            ['debts', 'Deudas', pettySectorPages.debts.total],
          ].map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              className={pettyWorkspaceTab === id ? 'active' : ''}
              onClick={() => setPettyWorkspaceTab(id)}
            >
              <span>{label}</span><b>{count}</b>
            </button>
          ))}
        </nav>

        <section className="petty-main-grid">
          <article className="bigcash-card petty-expenses-card" hidden={pettyWorkspaceTab !== 'expenses'}>
            <header className="petty-table-head">
              <h3>GASTOS DE CAJA CHICA</h3>
              <div className="petty-action-pair">
                <button
                  type="button"
                  className="petty-secondary-button small"
                  onClick={() => openCashAction('debt', { category: 'deuda_por_pagar', debtKind: 'payable', debtDate: selectedDate })}
                >
                  + Registrar deuda
                </button>
                <button
                  type="button"
                  className="petty-primary-button small"
                  onClick={() => openCashAction('advance', {
                    category: 'adelanto_personal',
                    paymentMethod: 'efectivo',
                    requestDate: selectedDate,
                    description: 'Adelanto de sueldo',
                  })}
                  disabled={pettyCashBalanceBs <= 0}
                >
                  + Adelanto
                </button>
                <button
                  type="button"
                  className="petty-primary-button small"
                  onClick={() => openCashAction('expense', { category: 'compras' })}
                  disabled={pettyCashBalanceBs <= 0}
                >
                  + Registrar gasto
                </button>
              </div>
            </header>

            <div className="petty-toolbar">
              <label>
                <select value={pettyCashTypeFilter} onChange={(event) => setPettyCashTypeFilter(event.target.value)}>
                  <option value="all">Todos los tipos</option>
                  {PETTY_EXPENSE_CATEGORIES.map((category) => (
                    <option key={category.id} value={category.className}>{category.label}</option>
                  ))}
                  <option value="supplier">Proveedor</option>
                  <option value="other">Varios</option>
                </select>
              </label>
              <label className="petty-search">
                <input
                  value={pettyCashQuery}
                  onChange={(event) => setPettyCashQuery(event.target.value)}
                  placeholder="Buscar concepto, proveedor..."
                />
                <MiniIcon kind="search" />
              </label>
            </div>

            <div className="bigcash-table-wrap petty-table-wrap">
              <table className="accounting-table petty-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Concepto</th>
                    <th>Proveedor / Destino</th>
                    <th>Categoría</th>
                    <th>Monto</th>
                    <th>Comprobante</th>
                    <th>Registrado por</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pagedPettyExpenseRows.map((movement) => {
                    const category = getPettyExpenseCategory(movement);
                    const isPersonnelAdvanceMovement =
                      normalizeText(movement?.accountingTag) === 'personnel_advance'
                      || normalizeText(movement?.category).includes('adelanto');
                    const registeredBy = isPersonnelAdvanceMovement
                      ? getPersonnelAdvanceRegisteredBy(movement)
                      : movement.createdBy || movement.responsible || '-';
                    const hasTransportExpense = toNumber(movement?.transportExpenseBs) > 0
                      || String(movement?.accountingTag ?? '') === 'transport_expense'
                      || (
                        Boolean(movement?.linkedRentalId || movement?.linkedOrderCode || movement?.linkedContractId)
                        && ['movilidad', 'transporte'].includes(String(movement?.category ?? '').toLowerCase())
                      );
                    return (
                      <tr
                        key={movement.id}
                        className={isVoidedCashMovement(movement) || isDeletedCashMovement(movement) ? 'cash-row-voided' : ''}
                        title={isDeletedCashMovement(movement) ? `Eliminado: ${movement.deletionReason || 'sin motivo'}` : undefined}
                      >
                        <td>
                          <strong>{formatDate(movement.createdAt)}</strong>
                          <small>{getLongHourLabel(movement.createdAt)}</small>
                        </td>
                        <td>
                          <strong>{movement.description}</strong>
                          {hasTransportExpense ? (
                            <small className="cash-linked-reference">
                              Transporte ligado a {getMovementReference(movement)}
                            </small>
                          ) : null}
                        </td>
                        <td>{movement.responsible || movement.createdBy || 'Varios'}</td>
                        <td><span className={`petty-category ${category.className}`}>{category.label}</span></td>
                        <td>{formatBs(Math.abs(movement.amountBs))}</td>
                        <td>{movement.receipt || '-'}</td>
                        <td>{registeredBy}</td>
                        <td>{renderReceiptActions(movement)}</td>
                      </tr>
                    );
                  })}
                  {!pettySectorPages.expenses.loading && pagedPettyExpenseRows.length === 0 ? <tr><td colSpan={8}><p className="status">Sin gastos registrados.</p></td></tr> : null}
                  {pettySectorPages.expenses.loading && pagedPettyExpenseRows.length === 0 ? <tr><td colSpan={8}><p className="status">Cargando gastos...</p></td></tr> : null}
                </tbody>
              </table>
            </div>

            {pettySectorPages.expenses.error ? <p className="status error">{pettySectorPages.expenses.error}</p> : null}
            {pettySectorPages.expenses.hasMore ? (
              <button type="button" className="section-link blue" disabled={pettySectorPages.expenses.loading} onClick={() => loadPettySector('expenses', {
                append: true,
                offset: pagedPettyExpenseRows.length,
                filters: { category: pettyCashTypeFilter, query: pettyCashQuery },
              })}>Ver 80 más</button>
            ) : null}

            <button
              type="button"
              className="section-link blue"
              onClick={() => openPettyHistory('all')}
            >
              Ver historial completo
            </button>
          </article>

          <article className="bigcash-card petty-advances-card" hidden={pettyWorkspaceTab !== 'advances'}>
            <header className="petty-table-head">
              <div>
                <h3>ADELANTOS AL PERSONAL</h3>
                <p>Salida directa de Caja Chica con recibo y firmas del trabajador.</p>
              </div>
              <div className="petty-action-pair">
                <span className="petty-advance-total">Hoy: {formatBs(selectedDayAdvanceBs)}</span>
                <button
                  type="button"
                  className="petty-primary-button small"
                  onClick={() => openCashAction('advance', {
                    category: 'adelanto_personal',
                    paymentMethod: 'efectivo',
                    requestDate: selectedDate,
                    description: 'Adelanto de sueldo',
                  })}
                  disabled={pettyCashBalanceBs <= 0}
                >
                  + Nuevo adelanto
                </button>
              </div>
            </header>
            <div className="bigcash-table-wrap petty-table-wrap">
              <table className="accounting-table petty-table petty-advances-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Trabajador</th>
                    <th>CI</th>
                    <th>Monto</th>
                    <th>Registrado por</th>
                    <th>Recibo</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedPersonnelAdvanceRows.map((movement) => {
                    const ci = String(movement.receipt ?? '').replace(/^CI\s*/i, '').trim() || '-';
                    const requestMatch = String(movement.notes ?? '').match(/Fecha de solicitud:\s*([^|]+)/i);
                    return (
                      <tr key={movement.id}>
                        <td>
                          <strong>{formatDate(movement.createdAt)}</strong>
                          <small>{requestMatch?.[1]?.trim() ? `Solicitud ${requestMatch[1].trim()}` : getLongHourLabel(movement.createdAt)}</small>
                        </td>
                        <td>
                          <strong>{movement.responsible || movement.description?.replace(/^Adelanto de sueldo\s*-\s*/i, '') || '-'}</strong>
                          <small>{movement.description}</small>
                        </td>
                        <td>{ci}</td>
                        <td><strong className="value-orange">- {formatBs(Math.abs(toNumber(movement.amountBs)))}</strong></td>
                        <td>{getPersonnelAdvanceRegisteredBy(movement)}</td>
                        <td>{renderReceiptActions(movement)}</td>
                      </tr>
                    );
                  })}
                  {!pettySectorPages.advances.loading && pagedPersonnelAdvanceRows.length === 0 ? (
                    <tr><td colSpan={6}><p className="status">Sin adelantos registrados todavia.</p></td></tr>
                  ) : null}
                  {pettySectorPages.advances.loading && pagedPersonnelAdvanceRows.length === 0 ? <tr><td colSpan={6}><p className="status">Cargando adelantos...</p></td></tr> : null}
                </tbody>
              </table>
            </div>
            {pettySectorPages.advances.error ? <p className="status error">{pettySectorPages.advances.error}</p> : null}
            {pettySectorPages.advances.hasMore ? (
              <button type="button" className="section-link blue" disabled={pettySectorPages.advances.loading} onClick={() => loadPettySector('advances', { append: true, offset: pagedPersonnelAdvanceRows.length })}>Ver 80 más</button>
            ) : null}
          </article>

          <article className="bigcash-card petty-supplier-loans-card" hidden={pettyWorkspaceTab !== 'suppliers'}>
            <header className="petty-table-head">
              <div>
                <h3>PRESTAMOS DE PROVEEDORES</h3>
                <p>Faltantes cubiertos por proveedor y pagos pendientes desde Caja Chica.</p>
              </div>
              <div className="petty-action-pair">
                <span className="petty-advance-total">Pendiente: {formatBs(sumBy(pendingSupplierLoanRows, (loan) => loan.totalBs))}</span>
                <button
                  type="button"
                  className="petty-primary-button small"
                  onClick={() => {
                    const loan = pendingSupplierLoanRows[0];
                    openCashAction('supplierLoan', {
                      supplierLoanId: loan?.id ?? '',
                      amountBs: loan ? String(Number(loan.totalBs ?? 0)) : '',
                      description: loan ? `Pago proveedor ${loan.supplierName} - ${loan.loanCode}` : '',
                      responsible: loan?.supplierName ?? currentUserName,
                      receipt: loan?.loanCode ?? '',
                      category: 'pago_proveedor',
                      notes: loan ? `Contrato ${loan.reference} | ${loan.itemSummary || 'Items de proveedor'}` : '',
                    });
                  }}
                  disabled={pendingSupplierLoanRows.length === 0 || pettyCashBalanceBs <= 0}
                >
                  Pagar proveedor
                </button>
              </div>
            </header>
            <div className="bigcash-table-wrap petty-table-wrap">
              <table className="accounting-table petty-table petty-supplier-loans-table">
                <thead>
                  <tr>
                    <th>Prestamo</th>
                    <th>Proveedor</th>
                    <th>Contrato</th>
                    <th>Items</th>
                    <th>Costo</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pagedSupplierLoanRows.map((loan) => (
                    <tr key={loan.id}>
                      <td>
                        <strong>{loan.loanCode}</strong>
                        <small>{formatDate(loan.requestDate)}</small>
                      </td>
                      <td>{loan.supplierName}</td>
                      <td>
                        <strong>{loan.reference}</strong>
                        <small>{loan.sourceOrderCode || loan.eventName || '-'}</small>
                      </td>
                      <td>
                        <strong>{loan.items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)} u.</strong>
                        <small>{loan.itemSummary || 'Sin detalle de items'}</small>
                      </td>
                      <td><strong className={loan.isPaid ? 'value-green' : 'value-orange'}>{formatBs(loan.totalBs)}</strong></td>
                      <td><span className={`petty-debt-status ${loan.isPaid ? 'paid' : 'pending'}`}>{loan.isPaid ? 'Liquidado' : 'Pendiente'}</span></td>
                      <td>
                        {!loan.isPaid ? (
                          <button
                            type="button"
                            className="cash-receipt-button"
                            onClick={() => openCashAction('supplierLoan', {
                              supplierLoanId: loan.id,
                              amountBs: String(Number(loan.totalBs ?? 0)),
                              description: `Pago proveedor ${loan.supplierName} - ${loan.loanCode}`,
                              responsible: loan.supplierName,
                              receipt: loan.loanCode,
                              category: 'pago_proveedor',
                              notes: `Contrato ${loan.reference} | ${loan.itemSummary || 'Items de proveedor'}`,
                            })}
                            disabled={pettyCashBalanceBs <= 0}
                          >
                            Pagar
                          </button>
                        ) : <span className="cash-receipt-muted">Pagado</span>}
                      </td>
                    </tr>
                  ))}
                  {!pettySectorPages.suppliers.loading && pagedSupplierLoanRows.length === 0 ? (
                    <tr><td colSpan={7}><p className="status">Sin prestamos de proveedores registrados.</p></td></tr>
                  ) : null}
                  {pettySectorPages.suppliers.loading && pagedSupplierLoanRows.length === 0 ? <tr><td colSpan={7}><p className="status">Cargando proveedores...</p></td></tr> : null}
                </tbody>
              </table>
            </div>
            {pettySectorPages.suppliers.error ? <p className="status error">{pettySectorPages.suppliers.error}</p> : null}
            {pettySectorPages.suppliers.hasMore ? (
              <button type="button" className="section-link blue" disabled={pettySectorPages.suppliers.loading} onClick={() => loadPettySector('suppliers', { append: true, offset: pagedSupplierLoanRows.length })}>Ver 80 más</button>
            ) : null}
          </article>

          <article className="bigcash-card petty-debts-card" hidden={pettyWorkspaceTab !== 'debts'}>
            <header className="petty-table-head">
              <div>
                <h3>DEUDAS REGISTRADAS</h3>
                <p>Separa deudas por pagar y gastos ya salidos que debe reembolsar Sra. Lia.</p>
              </div>
              <button
                type="button"
                className="petty-secondary-button small"
                onClick={() => openCashAction('payDebt', {
                  debtId: pendingCashDebts[0]?.id ?? '',
                  amountBs: pendingCashDebts[0] ? String(Number(pendingCashDebts[0].balanceBs ?? 0)) : '',
                  description: pendingCashDebts[0]?.description ?? '',
                  responsible: pendingCashDebts[0]?.personName ?? currentUserName,
                  category: 'deuda_por_pagar',
                })}
                disabled={pendingCashDebts.length === 0 || pettyCashBalanceBs <= 0}
              >
                Pagar deuda
              </button>
            </header>
            <div className="bigcash-table-wrap petty-table-wrap">
              <table className="accounting-table petty-table petty-debt-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Detalle / a quién</th>
                    <th>Monto</th>
                    <th>Pagado</th>
                    <th>Saldo</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pagedCashDebts.map((debt) => {
                    const balance = Number(debt.balanceBs ?? debt.amountBs ?? 0);
                    const isPaid = balance <= 0;
                    const debtKind = normalizeCashDebtKind(debt.debtKind ?? debt.kind ?? debt.category);
                    const debtMeta = getCashDebtMeta(debt);
                    const canPayDebt = debtKind === 'payable' && !isPaid;
                    return (
                      <tr key={debt.id}>
                        <td><strong>{debt.code}</strong></td>
                        <td>{formatDate(debt.debtDate ?? debt.createdAt)}</td>
                        <td><span className={`petty-debt-type ${debtMeta.className}`}>{debtMeta.shortLabel}</span></td>
                        <td>
                          <strong>{debt.description}</strong>
                          <small>
                            {debt.personName || 'Sin responsable'}
                            {debt.dueDate ? ` | vence ${formatDate(debt.dueDate)}` : ''}
                            {debt.sourceMovementReceipt ? ` | recibo ${debt.sourceMovementReceipt}` : ''}
                          </small>
                        </td>
                        <td>{formatBs(debt.amountBs)}</td>
                        <td>{formatBs(debt.paidBs)}</td>
                        <td><strong className={isPaid ? 'value-green' : 'value-orange'}>{formatBs(balance)}</strong></td>
                        <td><span className={`petty-debt-status ${isPaid ? 'paid' : 'pending'}`}>{isPaid ? 'Pagada' : debt.status === 'parcial' ? 'Parcial' : 'Pendiente'}</span></td>
                        <td>
                          <div className="petty-debt-actions">
                            {canPayDebt ? (
                              <button
                                type="button"
                                className="cash-receipt-button"
                                onClick={() => openCashAction('payDebt', {
                                  debtId: debt.id,
                                  amountBs: String(balance),
                                  description: debt.description,
                                  responsible: debt.personName || currentUserName,
                                  category: 'deuda_por_pagar',
                                })}
                                disabled={pettyCashBalanceBs <= 0}
                              >
                                Pagar
                              </button>
                            ) : <span className="cash-receipt-muted">{isPaid ? 'Cerrada' : 'Por cobrar'}</span>}
                            {isDeveloperUser ? (
                              <div className="petty-debt-menu">
                                <button
                                  type="button"
                                  className="petty-debt-menu-button"
                                  aria-label={`Opciones de ${debt.code}`}
                                  onClick={() => setDebtActionMenuId((current) => current === debt.id ? '' : debt.id)}
                                >
                                  ⋮
                                </button>
                                {debtActionMenuId === debt.id ? (
                                  <div className="petty-debt-menu-popover">
                                    <button type="button" onClick={() => handleDeleteCashDebt(debt)}>Eliminar</button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!pettySectorPages.debts.loading && pagedCashDebts.length === 0 ? <tr><td colSpan={9}><p className="status">Sin deudas registradas.</p></td></tr> : null}
                  {pettySectorPages.debts.loading && pagedCashDebts.length === 0 ? <tr><td colSpan={9}><p className="status">Cargando deudas...</p></td></tr> : null}
                </tbody>
              </table>
            </div>
            {pettySectorPages.debts.error ? <p className="status error">{pettySectorPages.debts.error}</p> : null}
            {pettySectorPages.debts.hasMore ? (
              <button type="button" className="section-link blue" disabled={pettySectorPages.debts.loading} onClick={() => loadPettySector('debts', { append: true, offset: pagedCashDebts.length })}>Ver 80 más</button>
            ) : null}
          </article>

          <aside className="petty-side">
            <article className="petty-side-card petty-repositions">
              <h3>ÚLTIMOS INGRESOS DESDE CAJA GRANDE</h3>
              <div className="petty-reposition-list">
                {pettyTransfersRows.slice(0, 4).map((movement) => (
                  <div key={movement.id}>
                    <span>{formatDate(movement.createdAt)}</span>
                    <strong>Reposición</strong>
                    <b>{formatBs(Math.abs(movement.amountBs))}</b>
                  </div>
                ))}
                {pettyTransfersRows.length === 0 ? <p className="status">Sin reposiciones registradas.</p> : null}
              </div>
              <button type="button" className="section-link blue" onClick={() => openPettyHistory('reposition')}>Ver todas</button>
            </article>
          </aside>
        </section>
        {renderCashModals()}
      </section>
    );
  }

  return (
    <section className="panel accounting-overview-only accounting-redesign">
      <header className="accounting-overview-head">
        <div>
          <h2>Contabilidad</h2>
          <p>Vista consolidada del dinero generado en Órdenes y administrado entre ambas cajas.</p>
          <span className="accounting-source-badge"><i />Datos vivos de contratos, recibos y cajas</span>
        </div>
        <div className="accounting-overview-actions">
          <label className="accounting-date-control">
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
            <span className="date-icon"><MiniIcon kind="calendar" /></span>
          </label>
          <button type="button" className="accounting-overview-primary" onClick={() => openCashAction('income', { category: 'ingreso_manual' })}>
            <span>+ Registrar ingreso</span>
            <span className="divider" />
            <MiniIcon kind="chevron" />
          </button>
        </div>
      </header>

      <section className="accounting-overview-topcards">
        <article className="box big">
          <div className="title-row">
            <span className="icon-wrap big"><CashIcon kind="safe" /></span>
            <div>
              <strong>CAJA GRANDE</strong>
              <small>Saldo disponible</small>
            </div>
            <small className="pill">Solo recibe</small>
          </div>
          <h3 className="value-green">{formatBs(bigCashBalanceBs)}</h3>
          <div className="meta-row">
            <span>Ingresos del dia <b>{formatBs(dayBigIncomeBs)}</b></span>
            <span>Retiros a caja chica (hoy) <b>{formatBs(dayTransfersToPettyBs)}</b></span>
            <span>Garantias retenidas <b>{formatBs(guaranteesHeldBs)}</b></span>
          </div>
        </article>
        <article className="box summary">
          <div className="title-row">
            <span className="icon-wrap summary"><CashIcon kind="summary" /></span>
            <div>
              <strong>RESUMEN DEL DIA</strong>
            </div>
          </div>
          <div className="list">
            <div><span>Ingresos (Caja Grande)</span><b className="value-green">{formatBs(dayBigIncomeBs)}</b></div>
            <div><span>Garantias recibidas</span><b className="value-blue">{formatBs(dayGuaranteeIncomeBs)}</b></div>
            <div><span>Retiros a Caja Chica</span><b className="value-orange">{formatBs(dayTransfersToPettyBs)}</b></div>
            <div><span>Gastos Caja Chica</span><b className="value-orange">{formatBs(dayPettyExpenseBs)}</b></div>
            <div><span>Saldo Caja Chica actual</span><b className="value-blue">{formatBs(pettyCashBalanceBs)}</b></div>
            <div><span>Pendiente por cobrar</span><b className="value-orange">{formatBs(pendingReceivableBs)}</b></div>
          </div>
        </article>
        <article className="box petty">
          <div className="title-row">
            <span className="icon-wrap petty"><CashIcon kind="petty" /></span>
            <div>
              <strong>CAJA CHICA (Hoy)</strong>
              <small>Saldo disponible</small>
            </div>
          </div>
          <h3 className="value-blue">{formatBs(pettyCashBalanceBs)}</h3>
          <div className="meta-row">
            <span>Apertura del dia <b>{formatBs(dayPettyOpeningBs)}</b></span>
            <span>Gastos del dia <b>{formatBs(dayPettyExpenseBs)}</b></span>
          </div>
        </article>
      </section>

      <section className="accounting-overview-flow">
        <header>
          <span className="icon-wrap flow"><CashIcon kind="flow" /></span>
          <strong>FLUJO ENTRE CAJAS</strong>
        </header>
        <article className="flow-card flow-card-big">
          <span className="icon-wrap big"><CashIcon kind="safe" /></span>
          <div>
            <strong>CAJA GRANDE</strong>
            <span>Solo recibe ingresos</span>
          </div>
        </article>
        <div className="flow-lines" aria-hidden="true">
          <span className="line income"><b>Recibe todos los ingresos</b></span>
          <span className="line out"><b>Retiros para caja chica</b></span>
        </div>
        <article className="flow-card flow-card-petty">
          <span className="icon-wrap petty"><CashIcon kind="petty" /></span>
          <div>
            <strong>CAJA CHICA (Diaria)</strong>
            <span>Se apertura cada dia<br />Para gastos menores</span>
          </div>
        </article>
        <aside>
          <strong>Importante</strong>
          <p>Caja Chica se repone desde Caja Grande segun sea necesario.</p>
        </aside>
      </section>

      <section className="accounting-overview-tables">
        <article className="table-box">
          <header>
            <h4><span className="table-title-icon green"><CashIcon kind="table" /></span>ULTIMOS INGRESOS (CAJA GRANDE)</h4>
          </header>
          <table className="accounting-table">
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Referencia</th><th>Monto</th><th>Usuario</th></tr></thead>
            <tbody>
              {bigCashIncomeRows.slice(0, visibleRows.incomes).map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDate(movement.createdAt)}</td>
                  <td>{movement.description}</td>
                  <td>{getMovementReference(movement)}</td>
                  <td className="amount">{formatBs(movement.amountBs)}</td>
                  <td>{movement.responsible || movement.createdBy || '-'}</td>
                </tr>
              ))}
              {bigCashIncomeRows.length === 0 ? <tr><td colSpan={5}><p className="status">Sin ingresos registrados.</p></td></tr> : null}
            </tbody>
          </table>
          <button
            type="button"
            className="section-link green"
            onClick={() => setVisibleRows((current) => ({ ...current, incomes: current.incomes >= bigCashIncomeRows.length ? 5 : current.incomes + 5 }))}
          >
            {visibleRows.incomes > 5 && visibleRows.incomes >= bigCashIncomeRows.length ? 'Ver menos' : 'Ver todos los ingresos'}
          </button>
        </article>

        <article className="table-box">
          <header>
            <h4><span className="table-title-icon orange"><CashIcon kind="table" /></span>MOVIMIENTOS A CAJA CHICA (DESDE CAJA GRANDE)</h4>
          </header>
          <table className="accounting-table">
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Usuario</th></tr></thead>
            <tbody>
              {pettyTransfersRows.slice(0, visibleRows.transfers).map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDate(movement.createdAt)}</td>
                  <td>{movement.description}</td>
                  <td className="negative amount">{formatBs(Math.abs(movement.amountBs))}</td>
                  <td>{movement.responsible || movement.createdBy || '-'}</td>
                </tr>
              ))}
              {pettyTransfersRows.length === 0 ? <tr><td colSpan={4}><p className="status">Sin movimientos registrados.</p></td></tr> : null}
            </tbody>
          </table>
          <button
            type="button"
            className="section-link orange"
            onClick={() => setVisibleRows((current) => ({ ...current, transfers: current.transfers >= pettyTransfersRows.length ? 5 : current.transfers + 5 }))}
          >
            {visibleRows.transfers > 5 && visibleRows.transfers >= pettyTransfersRows.length ? 'Ver menos' : 'Ver todos los movimientos'}
          </button>
        </article>

        <article className="table-box">
          <header>
            <h4><span className="table-title-icon blue"><CashIcon kind="table" /></span>GASTOS CAJA CHICA (HOY)</h4>
          </header>
          <table className="accounting-table">
            <thead><tr><th>Hora</th><th>Concepto</th><th>Monto</th><th>Usuario</th></tr></thead>
            <tbody>
              {dayPettyExpensesRows.slice(0, visibleRows.expenses).map((movement) => (
                <tr key={movement.id}>
                  <td>{getHourLabel(movement.createdAt)}</td>
                  <td>{movement.description}</td>
                  <td className="negative amount">{formatBs(Math.abs(movement.amountBs))}</td>
                  <td>{movement.responsible || movement.createdBy || '-'}</td>
                </tr>
              ))}
              {dayPettyExpensesRows.length === 0 ? <tr><td colSpan={4}><p className="status">Sin gastos registrados.</p></td></tr> : null}
            </tbody>
          </table>
          <button
            type="button"
            className="section-link blue"
            onClick={() => setVisibleRows((current) => ({ ...current, expenses: current.expenses >= dayPettyExpensesRows.length ? 5 : current.expenses + 5 }))}
          >
            {visibleRows.expenses > 5 && visibleRows.expenses >= dayPettyExpensesRows.length ? 'Ver menos' : 'Ver todos los gastos'}
          </button>
        </article>
      </section>

      <section className="accounting-pending-list">
        {pendingReceivableRows.slice(0, 4).map((row) => (
          <article key={row.id} className="accounting-pending-card is-receivable">
            <div className="accounting-pending-head">
              <div>
                <strong>{row.customerName}</strong>
                <small>{row.orderCode} {row.contractCode ? `| ${row.contractCode}` : ''}</small>
              </div>
              <span className="accounting-pending-status">{row.status}</span>
            </div>
            <div className="accounting-pending-money">
              <span><small>Por cobrar</small><strong>{formatBs(row.pendingBs)}</strong></span>
              <span><small>Garantia</small><strong>{formatBs(row.guaranteeBs)}</strong></span>
              <span className="highlight"><small>Danos/perdidas</small><strong>{formatBs(row.penaltiesBs)}</strong></span>
            </div>
            <div className="accounting-pending-footer">
              <span>Cobro pendiente para Caja Grande.</span>
              <button type="button" className="accounting-collect-button" onClick={() => openCollectAction(row)}>Registrar cobro</button>
            </div>
          </article>
        ))}
      </section>

      <section className="accounting-overview-bottom">
        <article className="summary-card">
          <h4><span className="table-title-icon green"><CashIcon kind="table" /></span>RESUMEN CONTABLE DEL DIA</h4>
          <div className="accounting-daily-balance">
            <div className="balance-group big-cash">
              <span>
                <small>Saldo inicial</small>
                <em>Caja Grande</em>
                <b>{formatBs(bigCashBalanceBs - dayBigIncomeBs + dayTransfersToPettyBs)}</b>
              </span>
              <i>+</i>
              <span>
                <small>Ingresos del dia</small>
                <b className="value-green">{formatBs(dayBigIncomeBs)}</b>
              </span>
              <i>-</i>
              <span>
                <small>Retiros a Caja Chica</small>
                <b className="value-orange">{formatBs(dayTransfersToPettyBs)}</b>
              </span>
              <i>=</i>
              <span>
                <small>Saldo actual</small>
                <em>Caja Grande</em>
                <b>{formatBs(bigCashBalanceBs)}</b>
              </span>
            </div>
            <div className="balance-group petty-cash">
              <span>
                <small>Caja Chica</small>
                <em>Apertura del dia</em>
                <b className="value-blue">{formatBs(dayPettyOpeningBs)}</b>
              </span>
              <i>-</i>
              <span>
                <small>Gastos del dia</small>
                <b className="value-blue">{formatBs(dayPettyExpenseBs)}</b>
              </span>
              <i>=</i>
              <span className="petty-balance">
                <small>Saldo actual</small>
                <em>Caja Chica</em>
                <b>{formatBs(pettyCashBalanceBs)}</b>
              </span>
            </div>
          </div>
        </article>

        <article className="quick-reports">
          <h4>REPORTES RAPIDOS</h4>
          <ul>
            {quickReportLinks.map((label) => (
              <li key={label}>
                <button type="button" className="report-link" onClick={() => handleQuickReport(label)}>
                  <MiniIcon kind="report" />{label}
                </button>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <footer className="accounting-overview-footnote">
        <small>Fecha de referencia: {formatDateTime(`${selectedDate}T12:00:00`)}</small>
      </footer>
      {renderCashModals()}
    </section>
  );
}

export default AccountingSection;
