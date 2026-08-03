import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../../services/api';

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
  const parsed = new Date(value ?? '');
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
  const parsed = new Date(value ?? '');
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
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
  cashPaymentChannels = [],
  cashReturnIssues = [],
  cashMovementMeta = { total: 0, visible: 0, truncated: false },
  operationsLoading = false,
  cashSessions = [],
  rentals = [],
  contracts = [],
  supplierBundle = { suppliers: [], quotes: [], loans: [] },
  currentUser = null,
  formatBs,
  formatDate,
  formatDateTime,
  onOpenCashSession,
  onCloseCashSession,
  onCreateCashMovement,
  onCreateCashDebt,
  onPayCashDebt,
  onDeleteCashDebt,
  onUpdateSupplierLoanStatus,
  onVoidAndReplaceCashMovementReceipt,
  onCollectReceivable,
  onPrintCashMovementReceipt,
  onCreateEmployee,
}) {
  const [selectedDate, setSelectedDate] = useState(() => getInputDate());
  const [visibleRows, setVisibleRows] = useState({ incomes: 5, transfers: 5, expenses: 5 });
  const [bigCashTypeFilter, setBigCashTypeFilter] = useState('all');
  const [bigCashPeriod, setBigCashPeriod] = useState('recent');
  const [bigCashQuery, setBigCashQuery] = useState('');
  const [pettyCashTypeFilter, setPettyCashTypeFilter] = useState('all');
  const [pettyCashQuery, setPettyCashQuery] = useState('');
  const [pettyWorkspaceTab, setPettyWorkspaceTab] = useState('expenses');
  const [pettyCashVisibleRows] = useState(5);
  const [isPettyHistoryOpen, setIsPettyHistoryOpen] = useState(false);
  const [pettyHistorySource, setPettyHistorySource] = useState(null);
  const [pettyHistoryLoading, setPettyHistoryLoading] = useState(false);
  const [pettyHistoryError, setPettyHistoryError] = useState('');
  const [pettyHistoryFilters, setPettyHistoryFilters] = useState({
    dateFrom: '',
    dateTo: '',
    movement: 'all',
    category: 'all',
    query: '',
  });
  const [cashModal, setCashModal] = useState(null);
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
  const [isSubmittingCash, setIsSubmittingCash] = useState(false);
  const [cashActionError, setCashActionError] = useState('');
  const [cashActionFeedback, setCashActionFeedback] = useState('');
  const [debtActionMenuId, setDebtActionMenuId] = useState('');
  const [advancePeopleQuery, setAdvancePeopleQuery] = useState('');
  const cashSubmitLockRef = useRef(false);

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
  const personnelEmployees = useMemo(
    () => (personnelBundle?.employees ?? [])
      .filter((employee) => !employee?.deletedAt && String(employee?.status ?? 'active') !== 'inactive')
      .slice()
      .sort((a, b) => String(a?.fullName ?? '').localeCompare(String(b?.fullName ?? ''), 'es')),
    [personnelBundle?.employees],
  );
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
  const advanceQueryMatchesEmployee = useMemo(() => {
    const query = normalizeText(advancePeopleQuery);
    if (!query) return false;
    return personnelEmployees.some((employee) => normalizeText(employee.fullName) === query);
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
          reference: contract?.contractCode ?? rental?.contractCode ?? movement.orderCode ?? rental?.orderCode ?? '-',
          eventDate: contract?.eventDate ?? rental?.rentalDate ?? '',
        };
      }))
      .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0)),
    [contractById, contractByRentalId, prepaidClientRows, rentalById],
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
    () => [...cashMovements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [cashMovements],
  );

  const postedMovements = useMemo(
    () => sortedMovements.filter((movement) => !isVoidedCashMovement(movement)),
    [sortedMovements],
  );

  const sortedCashDebts = useMemo(
    () => [...cashDebts].sort((a, b) => new Date(b.createdAt ?? b.debtDate ?? 0) - new Date(a.createdAt ?? a.debtDate ?? 0)),
    [cashDebts],
  );

  const pendingCashDebts = useMemo(
    () => sortedCashDebts.filter((debt) => normalizeCashDebtKind(debt?.debtKind ?? debt?.kind ?? debt?.category) === 'payable' && Number(debt?.balanceBs ?? debt?.amountBs ?? 0) > 0),
    [sortedCashDebts],
  );

  const supplierLoanRows = useMemo(
    () => (supplierBundle?.loans ?? [])
      .filter((loan) => !loan?.deletedAt)
      .map((loan) => {
        const totalBs = toNumber(loan?.totals?.totalBs ?? loan?.totalBs);
        const contract = loan?.sourceContractId ? contractById.get(String(loan.sourceContractId)) : null;
        const rental = loan?.sourceRentalId ? rentalById.get(String(loan.sourceRentalId)) : null;
        const reference = contract?.contractCode
          ?? rental?.contractCode
          ?? loan?.sourceOrderCode
          ?? '-';
        const items = Array.isArray(loan?.items) ? loan.items : [];
        const statusKey = normalizeText(loan?.status || 'programado');
        const isPaid = ['liquidado', 'pagado', 'cerrado'].includes(statusKey);
        return {
          ...loan,
          totalBs,
          items,
          reference,
          itemSummary: items.slice(0, 2).map((item) => `${item.quantity}x ${item.itemName}`).join(' | '),
          isPaid,
          requestDate: loan?.requestDate || loan?.createdAt,
        };
      })
      .sort((a, b) => Number(a.isPaid) - Number(b.isPaid) || new Date(b.createdAt ?? b.requestDate ?? 0) - new Date(a.createdAt ?? a.requestDate ?? 0)),
    [contractById, rentalById, supplierBundle?.loans],
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

  const dayPettyOpeningRows = useMemo(
    () => postedMovements.filter(
      (movement) => isPettyCash(movement)
        && String(movement.type ?? '').toLowerCase() === 'apertura'
        && getDateKey(movement.createdAt) === selectedDate,
    ),
    [postedMovements, selectedDate],
  );

  const selectedDayPettyRepositions = useMemo(
    () => pettyTransfersRows.filter((movement) => getDateKey(movement.createdAt) === selectedDate),
    [pettyTransfersRows, selectedDate],
  );

  const dayPettyRepositionBs = useMemo(
    () => Math.max(0, dayTransfersToPettyBs - dayPettyOpeningBs),
    [dayPettyOpeningBs, dayTransfersToPettyBs],
  );

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
  const bigCashPeriodRange = useMemo(
    () => getPeriodRange(selectedDate, bigCashPeriod),
    [bigCashPeriod, selectedDate],
  );
  const monthBigCashIncomeRows = useMemo(
    () => bigCashIncomeRows.filter((movement) => getMonthKey(movement.createdAt) === selectedMonthKey),
    [bigCashIncomeRows, selectedMonthKey],
  );
  const monthBigCashTransferRows = useMemo(
    () => pettyTransfersRows.filter((movement) => getMonthKey(movement.createdAt) === selectedMonthKey),
    [pettyTransfersRows, selectedMonthKey],
  );
  const monthTransportRevenueRows = useMemo(
    () => postedMovements.filter(
      (movement) => getMonthKey(movement.createdAt) === selectedMonthKey
        && (
          toNumber(movement?.transportRevenueBs) > 0
          ||
          String(movement?.accountingTag ?? '') === 'transport_revenue'
          || String(movement?.category ?? '').toLowerCase() === 'transporte_cobrado'
          || String(movement?.type ?? '').toLowerCase() === 'ingreso_transporte_cliente'
        ),
    ),
    [postedMovements, selectedMonthKey],
  );
  const monthTransportExpenseRows = useMemo(
    () => postedMovements.filter(
      (movement) => getMonthKey(movement.createdAt) === selectedMonthKey
        && isPettyCash(movement)
        && toNumber(movement.amountBs) < 0
        && (
          toNumber(movement?.transportExpenseBs) > 0
          ||
          String(movement?.accountingTag ?? '') === 'transport_expense'
          || (
            Boolean(movement?.linkedRentalId || movement?.linkedOrderCode || movement?.linkedContractId)
            && ['movilidad', 'transporte'].includes(String(movement?.category ?? '').toLowerCase())
          )
        ),
    ),
    [postedMovements, selectedMonthKey],
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
      if (dateKey < bigCashPeriodRange.dateFrom || dateKey > bigCashPeriodRange.dateTo) return false;
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
  }, [bigCashMovementRows, bigCashPeriodRange, bigCashQuery, bigCashTypeFilter, getMovementReference]);

  const periodBigCashRows = useMemo(
    () => bigCashMovementRows.filter((movement) => {
      const dateKey = getDateKey(movement.createdAt);
      return dateKey >= bigCashPeriodRange.dateFrom
        && dateKey <= bigCashPeriodRange.dateTo
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
      const meta = getPaymentMethodMeta(movement.paymentMethod);
      const current = summary.get(methodKey) ?? {
        key: methodKey,
        ...meta,
        collectedBs: 0,
        outBs: 0,
        count: 0,
      };
      const amount = toNumber(movement.amountBs);
      if (amount > 0) current.collectedBs += amount;
      if (amount < 0 || movement.isInternalTransfer) current.outBs += Math.abs(amount);
      current.count += 1;
      summary.set(methodKey, current);
    });
    return ['efectivo', 'qr', 'transferencia', 'sin_metodo']
      .map((key) => summary.get(key) ?? {
        key,
        ...PAYMENT_METHOD_META[key],
        collectedBs: 0,
        outBs: 0,
        count: 0,
      })
      .concat([...summary.values()].filter((entry) => !['efectivo', 'qr', 'transferencia', 'sin_metodo'].includes(entry.key)))
      .map((entry) => ({
        ...entry,
        collectedBs: Number(entry.collectedBs.toFixed(2)),
        outBs: Number(entry.outBs.toFixed(2)),
        netBs: Number((entry.collectedBs - entry.outBs).toFixed(2)),
      }));
  }, [periodBigCashTransactionRows]);

  const visiblePaymentChannelRows = useMemo(() => {
    if (!Array.isArray(cashPaymentChannels) || cashPaymentChannels.length === 0) {
      return periodPaymentMethodRows.map((row) => ({
        ...row,
        account: '',
        incomeBs: row.collectedBs,
        netBs: row.netBs,
      }));
    }
    return cashPaymentChannels.map((row) => {
      const meta = getPaymentMethodMeta(row.method);
      return {
        ...row,
        ...meta,
        label: row.method === 'qr' ? 'QR' : meta.label,
        shortLabel: row.method === 'qr' ? 'QR' : meta.shortLabel,
      };
    });
  }, [cashPaymentChannels, periodPaymentMethodRows]);

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

  const filteredPettyExpenseRows = useMemo(() => {
    const text = pettyCashQuery.trim().toLowerCase();
    return dayPettyExpensesRows.filter((movement) => {
      const category = getPettyExpenseCategory(movement);
      const matchesType =
        pettyCashTypeFilter === 'all'
        || (!isVoidedCashMovement(movement) && category.className === pettyCashTypeFilter);
      if (!matchesType) return false;
      if (!text) return true;
      return [
        movement.description,
        movement.receipt,
        movement.responsible,
        movement.createdBy,
        getMovementReference(movement),
        category.label,
      ].some((value) => String(value ?? '').toLowerCase().includes(text));
    });
  }, [dayPettyExpensesRows, getMovementReference, getPettyExpenseCategory, pettyCashQuery, pettyCashTypeFilter]);

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

    const sessionById = cashSessions.find((session) => String(session?.id ?? '').trim() === movementSessionId);
    const sessionByIdName = cleanName(sessionById?.openedBy || sessionById?.createdBy || sessionById?.responsible);
    if (sessionByIdName) return sessionByIdName;

    const sessionByTime = cashSessions.find((session) => {
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

  const filteredPettyHistoryRows = useMemo(() => {
    const text = pettyHistoryFilters.query.trim().toLowerCase();
    return pettyHistoryRows.filter((movement) => {
      const dateKey = getDateKey(movement.createdAt);
      if (pettyHistoryFilters.dateFrom && dateKey < pettyHistoryFilters.dateFrom) return false;
      if (pettyHistoryFilters.dateTo && dateKey > pettyHistoryFilters.dateTo) return false;

      const isVoided = isVoidedCashMovement(movement);
      const hasTransportLink = toNumber(movement?.transportExpenseBs) > 0
        || String(movement?.accountingTag ?? '') === 'transport_expense'
        || (
          Boolean(movement?.linkedRentalId || movement?.linkedOrderCode || movement?.linkedContractId)
          && ['movilidad', 'transporte'].includes(String(movement?.category ?? '').toLowerCase())
        );

      const matchesMovement =
        pettyHistoryFilters.movement === 'all'
        || (pettyHistoryFilters.movement === 'reposition' && movement.historyKind === 'reposition')
        || (pettyHistoryFilters.movement === 'expense' && movement.historyKind === 'expense' && !isVoided)
        || (pettyHistoryFilters.movement === 'voided' && isVoided)
        || (pettyHistoryFilters.movement === 'transport' && hasTransportLink && !isVoided);
      if (!matchesMovement) return false;

      const matchesCategory =
        pettyHistoryFilters.category === 'all'
        || (movement.historyKind === 'expense' && movement.historyCategory.className === pettyHistoryFilters.category);
      if (!matchesCategory) return false;

      if (!text) return true;
      return [
        movement.description,
        movement.receipt,
        movement.responsible,
        movement.createdBy,
        movement.historyLabel,
        movement.historyCategory.label,
        movement.historyReference,
        movement.voidReason,
      ].some((value) => String(value ?? '').toLowerCase().includes(text));
    });
  }, [pettyHistoryFilters, pettyHistoryRows]);

  const pettyHistorySummary = useMemo(() => {
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

  const activeCashSession = useMemo(
    () => cashSessions.find((session) => String(session?.status ?? '').toLowerCase() === 'open') ?? cashSessions[0] ?? null,
    [cashSessions],
  );

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

  const returnedGuaranteeReferences = useMemo(() => {
    const references = new Set();
    postedMovements.forEach((movement) => {
      if (!isConfirmedGuaranteeReturnMovement(movement)) return;
      [
        movement?.linkedContractId,
        movement?.linkedRentalId,
        movement?.linkedOrderCode,
        movement?.contractCode,
        movement?.reference,
        movement?.sourceId,
      ].forEach((value) => {
        const normalized = normalizeText(value);
        if (normalized) references.add(normalized);
      });
    });
    return references;
  }, [postedMovements]);

  const hasReturnedGuarantee = useCallback((rental, contract = null) => {
    const keys = [
      rental?.id,
      rental?.orderCode,
      rental?.contractCode,
      contract?.id,
      contract?.contractCode,
      contract?.orderCode,
    ].map(normalizeText);
    return keys.some((key) => key && returnedGuaranteeReferences.has(key));
  }, [returnedGuaranteeReferences]);

  const getRentalGuaranteeInfo = useCallback((rental, contract = null) => {
    const declaredBs = toNumber(
      rental?.guaranteeDeclaredBs
      ?? rental?.guarantee?.amountBs
      ?? contract?.totals?.guaranteeBs
      ?? rental?.depositBs,
    );
    const rawStatus = String(
      rental?.guarantee?.status
      ?? rental?.payment?.guaranteeStatus
      ?? contract?.guarantee?.status
      ?? contract?.payment?.guaranteeStatus
      ?? '',
    ).trim();
    const storedDepositBs = toNumber(rental?.depositBs);
    const storedValidatedBs = toNumber(rental?.guarantee?.validatedBs);
    const isValidated = rawStatus === 'validado' || (rawStatus !== 'no_validado' && storedDepositBs > 0);
    const validatedBs = isValidated
      ? Math.max(0, storedDepositBs || storedValidatedBs || declaredBs)
      : 0;
    return {
      declaredBs,
      validatedBs,
      unvalidatedBs: isValidated ? 0 : declaredBs,
      status: isValidated ? 'validado' : 'no_validado',
      isValidated,
    };
  }, []);

  const activeGuaranteeRows = useMemo(
    () => rentals
      .filter((rental) => {
        if (rental?.deletedAt) return false;
        const contract = getRentalContract(rental);
        const guaranteeInfo = getRentalGuaranteeInfo(rental, contract);
        if (guaranteeInfo.declaredBs <= 0) return false;
        const status = String(rental?.status ?? '').toLowerCase();
        if (status === 'active') return true;
        if (status !== 'returned') return false;
        return !hasReturnedGuarantee(rental, contract);
      }),
    [getRentalContract, getRentalGuaranteeInfo, hasReturnedGuarantee, rentals],
  );

  const guaranteesToReturnRows = useMemo(() => rentals
    .filter((rental) => !rental?.deletedAt)
    .map((rental) => {
      const contract = getRentalContract(rental);
      const guaranteeInfo = getRentalGuaranteeInfo(rental, contract);
      const guaranteeBs = guaranteeInfo.declaredBs;
      const settlement = rental?.returnSettlement ?? {};
      const status = String(rental?.status ?? '').toLowerCase();
      const isReturned = status === 'returned';
      const refundBs = guaranteeInfo.isValidated && isReturned
        ? toNumber(settlement?.refundBs ?? rental?.refundBs ?? guaranteeInfo.validatedBs)
        : guaranteeInfo.validatedBs;
      if (!['active', 'returned'].includes(status)) return null;
      if (guaranteeBs <= 0 || hasReturnedGuarantee(rental, contract)) return null;
      return {
        id: rental.id,
        rentalId: rental.id,
        contractId: contract?.id ?? rental?.contractId ?? '',
        orderCode: rental.orderCode ?? '',
        contractCode: contract?.contractCode ?? rental?.contractCode ?? rental?.orderCode ?? rental.id,
        customerName: rental.customerName ?? contract?.customerName ?? 'Cliente',
        responsibleName: getRentalResponsibleName(rental, contract),
        eventDate: rental.eventDate ?? contract?.eventDate ?? rental.deliveryDate ?? rental.createdAt,
        amountBs: guaranteeInfo.isValidated ? refundBs : guaranteeInfo.unvalidatedBs,
        declaredBs: guaranteeInfo.declaredBs,
        validatedBs: guaranteeInfo.isValidated ? refundBs : 0,
        unvalidatedBs: guaranteeInfo.unvalidatedBs,
        guaranteeStatus: guaranteeInfo.status,
        isMoneyHeld: guaranteeInfo.isValidated && refundBs > 0,
        isReadyToReturn: isReturned && guaranteeInfo.isValidated && refundBs > 0,
        statusLabel: guaranteeInfo.isValidated
          ? isReturned ? refundBs > 0 ? 'Lista para devolver' : 'Sin devolucion' : 'Material pendiente'
          : 'Debe',
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.isReadyToReturn) - Number(a.isReadyToReturn) || new Date(b.eventDate ?? 0) - new Date(a.eventDate ?? 0)),
  [getRentalContract, getRentalGuaranteeInfo, getRentalResponsibleName, hasReturnedGuarantee, rentals]);

  const calculatedGuaranteesHeldBs = useMemo(
    () => sumBy(activeGuaranteeRows, (rental) => {
      const contract = getRentalContract(rental);
      return getRentalGuaranteeInfo(rental, contract).validatedBs;
    }),
    [activeGuaranteeRows, getRentalContract, getRentalGuaranteeInfo],
  );
  const guaranteesHeldBs = calculatedGuaranteesHeldBs;
  const unvalidatedGuaranteesBs = useMemo(
    () => sumBy(activeGuaranteeRows, (rental) => {
      const contract = getRentalContract(rental);
      return getRentalGuaranteeInfo(rental, contract).unvalidatedBs;
    }),
    [activeGuaranteeRows, getRentalContract, getRentalGuaranteeInfo],
  );
  const guaranteeCommitmentsBs = useMemo(
    () => Number((guaranteesHeldBs + unvalidatedGuaranteesBs).toFixed(2)),
    [guaranteesHeldBs, unvalidatedGuaranteesBs],
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
      .filter((rental) => !rental?.deletedAt && String(rental?.status ?? '').toLowerCase() !== 'cancelled')
      .map((rental) => {
        const isReturned = String(rental?.status ?? '').toLowerCase() === 'returned';
        const settlement = rental?.returnSettlement ?? {};
        const pendingBs = isReturned
          ? toNumber(settlement.pendingCollectionBs ?? rental?.payment?.pendingPaymentBs)
          : toNumber(rental?.payment?.pendingPaymentBs ?? rental?.totals?.pendingPaymentBs);
        if (pendingBs <= 0) return null;
        const contract = contractByRentalId.get(rental.id);
        return {
          id: rental.id,
          orderCode: rental.orderCode ?? rental.id,
          contractCode: contract?.contractCode ?? '',
          customerName: rental.customerName ?? 'Cliente',
          responsibleName: getRentalResponsibleName(rental, contract),
          eventDate: rental.eventDate ?? contract?.eventDate ?? rental.deliveryDate ?? rental.createdAt,
          status: isReturned ? 'Liquidacion' : 'Contrato',
          pendingBs,
          totalBs: toNumber(rental?.totals?.totalBs),
          paidBs: toNumber(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs),
          guaranteeBs: toNumber(rental?.depositBs),
          penaltiesBs: toNumber(settlement.penaltiesBs ?? rental?.penaltiesBs),
          outstandingRentalBs: toNumber(settlement.outstandingRentalBs),
          refundBs: toNumber(settlement.refundBs ?? rental?.refundBs),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.pendingBs - a.pendingBs),
    [contractByRentalId, getRentalResponsibleName, rentals],
  );

  const pendingReceivableBs = useMemo(
    () => sumBy(pendingReceivableRows, (row) => row.pendingBs),
    [pendingReceivableRows],
  );

  const derivedReturnIssueRows = useMemo(
    () => rentals
      .filter((rental) => !rental?.deletedAt && String(rental?.status ?? '').toLowerCase() === 'returned')
      .flatMap((rental) => {
        const contract = getRentalContract(rental);
        const settlement = rental?.returnSettlement ?? {};
        const pendingCollectionBs = toNumber(settlement.pendingCollectionBs ?? rental?.payment?.pendingPaymentBs);
        const issueLines = Array.isArray(rental.returnIssueSummary)
          ? rental.returnIssueSummary
          : Array.isArray(rental.returnReport)
            ? rental.returnReport
            : [];
        return issueLines
          .filter((line) => toNumber(line.damagedQty) > 0 || toNumber(line.missingQty) > 0 || toNumber(line.penaltyBs) > 0)
          .map((line, index) => {
            const chargeOwner = ['transporte', 'lavado'].includes(String(line.chargeOwner ?? '').toLowerCase())
              ? String(line.chargeOwner).toLowerCase()
              : 'cliente';
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
              penaltyBs: toNumber(line.penaltyBs),
              chargeOwner,
              note: line.damageNote ?? '',
              pendingCollectionBs,
              pendingBs: pendingCollectionBs,
              totalBs: toNumber(rental?.totals?.totalBs),
              paidBs: toNumber(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs),
              guaranteeBs: toNumber(rental?.depositBs),
              penaltiesBs: toNumber(settlement.penaltiesBs ?? rental?.penaltiesBs),
              outstandingRentalBs: toNumber(settlement.outstandingRentalBs),
              refundBs: toNumber(settlement.refundBs ?? rental?.refundBs),
              status: 'Dano / faltante',
            };
          });
      })
      .sort((a, b) => new Date(b.returnedAt ?? 0) - new Date(a.returnedAt ?? 0)),
    [getRentalContract, getRentalResponsibleName, rentals],
  );

  const returnIssueRows = useMemo(
    () => (Array.isArray(cashReturnIssues) && cashReturnIssues.length > 0
      ? cashReturnIssues.slice().sort((a, b) => new Date(b?.returnedAt ?? 0) - new Date(a?.returnedAt ?? 0))
      : derivedReturnIssueRows),
    [cashReturnIssues, derivedReturnIssueRows],
  );

  const returnIssueTotalBs = useMemo(
    () => sumBy(returnIssueRows, (row) => row.penaltyBs),
    [returnIssueRows],
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

  const openCashAction = (type, patch = {}) => {
    resetCashForm(patch);
    if (type === 'advance') {
      setAdvancePeopleQuery('');
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

  const handleUseNewAdvanceEmployee = () => {
    const fullName = String(advancePeopleQuery ?? '').trim();
    setCashForm((current) => ({
      ...current,
      employeeId: '',
      responsible: fullName,
      description: fullName ? `Adelanto de sueldo - ${fullName}` : 'Adelanto de sueldo',
    }));
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
    setPettyHistoryLoading(true);
    setPettyHistoryError('');
    api.cash.getPettyHistory()
      .then((result) => {
        setPettyHistorySource(Array.isArray(result?.movements) ? result.movements : []);
      })
      .catch((historyError) => {
        setPettyHistorySource([]);
        setPettyHistoryError(historyError?.message || 'No se pudo cargar el historial de Caja Chica.');
      })
      .finally(() => setPettyHistoryLoading(false));
  };

  const applyPettyHistoryPeriod = (period) => {
    const range = getPeriodRange(selectedDate, period);
    setPettyHistoryFilters((current) => ({ ...current, ...range }));
  };

  const closeCashAction = () => {
    setCashModal(null);
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
      let result = onPrintCashMovementReceipt
        ? await onPrintCashMovementReceipt({ movementId, printedByName })
        : null;
      if (!result?.html) {
        result = await api.printer.printCashMovementReceipt({ movementId, printedByName });
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
      } else if (cashModal === 'advance') {
        let employee = personnelEmployees.find((entry) => String(entry.id) === String(cashForm.employeeId)) ?? null;
        const typedEmployeeName = String(cashForm.responsible || advancePeopleQuery || '').trim();
        const matchingEmployee = typedEmployeeName
          ? personnelEmployees.find((entry) => normalizeText(entry.fullName) === normalizeText(typedEmployeeName)) ?? null
          : null;
        employee = employee ?? matchingEmployee;
        const employeeName = String(employee?.fullName ?? typedEmployeeName).trim();
        const documentId = String(cashForm.documentId ?? employee?.documentId ?? '').trim();
        const requestDate = cashForm.requestDate || selectedDate;
        if (!employeeName) {
          throw new Error('Selecciona o escribe el trabajador que solicita el adelanto.');
        }
        if (!documentId) {
          throw new Error('Ingresa el numero de carnet del trabajador.');
        }
        if (!employee) {
          if (!onCreateEmployee) {
            throw new Error('No se pudo registrar personal nuevo desde Caja Chica.');
          }
          employee = await onCreateEmployee({
            fullName: employeeName,
            documentId,
            department: 'Operaciones',
            position: 'Personal eventual',
            contractType: 'eventual',
            hireDate: requestDate,
            notes: 'Creado desde Caja Chica al registrar adelanto de personal.',
            status: 'active',
          });
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

  const handleReturnGuarantee = async (row) => {
    if (row && !row.isMoneyHeld) {
      setCashActionError('Esta garantia figura como debe: no hay dinero recibido para devolver.');
      return;
    }
    if (row && !row.isReadyToReturn) {
      setCashActionError('Todavia no se puede devolver esta garantia: primero debe volver el material.');
      return;
    }
    if (!row || !beginCashSubmit()) return;
    setCashActionError('');
    try {
      const created = await onCreateCashMovement?.({
        type: 'egreso',
        cashBoxType: 'BIG_CASH',
        amountBs: row.validatedBs,
        description: `Devolucion garantia: ${row.customerName}`,
        category: 'garantia_devuelta_manual',
        paymentMethod: 'efectivo',
        responsible: currentUserName,
        receipt: '',
        notes: `Devolucion de garantia del contrato ${row.contractCode}`,
        linkedRentalId: row.rentalId,
        linkedContractId: row.contractId,
        linkedOrderCode: row.orderCode,
        accountingTag: 'guarantee_refund',
        createdBy: currentUserName,
      });
      await printCashReceipt(resolvePrintableCashMovementId(created, 'BIG_CASH'));
      setCashActionFeedback(`Garantia devuelta para contrato ${row.contractCode}.`);
    } catch (error) {
      setCashActionError(error.message || 'No se pudo devolver la garantia.');
    } finally {
      endCashSubmit();
    }
  };

  const getCashModalTitle = () => {
    if (cashModal === 'openPetty') return 'Aperturar Caja Chica';
    if (cashModal === 'transfer') return 'Egreso de Caja Grande a Caja Chica';
    if (cashModal === 'expense') return 'Registrar gasto de Caja Chica';
    if (cashModal === 'advance') return 'Registrar adelanto de personal';
    if (cashModal === 'debt') return 'Registrar deuda';
    if (cashModal === 'payDebt') return 'Pagar deuda';
    if (cashModal === 'supplierLoan') return 'Pagar proveedor';
    if (cashModal === 'income') return 'Registrar ingreso de Caja Grande';
    if (cashModal === 'closePetty') return 'Cerrar Caja Chica';
    return 'Movimiento de caja';
  };

  const renderReceiptActions = (movement) => {
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
            <td>{formatDate(movement.createdAt)} <small>{getHourLabel(movement.createdAt)}</small></td>
            <td><strong>{movement.description}</strong></td>
            <td>{getMovementReference(movement)}</td>
            <td><span className={`payment-method-pill ${paymentMeta.className}`}>{getPaymentMethodLabel(movement)}</span></td>
            <td className="amount">{meta.income}</td>
            <td className="negative amount">{meta.withdrawal}</td>
            <td><span className="bigcash-user-label">{getMovementUserLabel(movement)}</span></td>
            <td>{renderReceiptActions(movement)}</td>
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
            <td className="amount">{formatBs(row.pendingBs)}</td>
            <td><button type="button" className="accounting-inline-action" onClick={() => openCollectAction(row)}>Cobrar</button></td>
          </tr>
        ),
        monthlyBrowser: true,
        getMonthKey: (row) => getMonthKey(row.eventDate),
      },
      guarantees: {
        title: 'Garantias por devolver',
        subtitle: 'Garantias pagadas y pendientes de cobro separadas por contrato.',
        rows: guaranteesToReturnRows,
        colSpan: 8,
        searchText: (row) => [
          row.contractCode,
          row.orderCode,
          row.customerName,
          row.responsibleName,
          row.eventDate,
          row.statusLabel,
          row.validatedBs,
          row.unvalidatedBs,
        ].join(' '),
        renderHeader: () => (
          <tr>
            <th>Contrato</th>
            <th>Cliente</th>
            <th>Responsable</th>
            <th>Fecha evento</th>
            <th>Estado</th>
            <th>Pagada</th>
            <th>Debe</th>
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
            <td className="amount">{formatBs(row.validatedBs)}</td>
            <td className="amount">{formatBs(row.unvalidatedBs)}</td>
            <td>
              <button
                type="button"
                className="accounting-inline-action"
                onClick={() => handleReturnGuarantee(row)}
                disabled={!row.isReadyToReturn || !row.isMoneyHeld || isSubmittingCash}
                title={row.isMoneyHeld ? 'Devolver garantia y generar recibo' : 'Garantia pendiente de cobro, no hay dinero para devolver'}
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
                {!pettyHistoryLoading && !pettyHistoryError ? filteredPettyHistoryRows.map((movement) => {
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
            <small>Mostrando {filteredPettyHistoryRows.length} de {pettyHistoryRows.length} movimientos historicos.</small>
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
      {cashActionError && !cashModal && !collectModal && !voidReceiptModal ? <p className="status error accounting-floating-feedback">{cashActionError}</p> : null}
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
                    {filteredAdvanceEmployees.length === 0 ? (
                      <p className="petty-advance-empty">No hay coincidencias en personal.</p>
                    ) : null}
                  </div>

                  {advancePeopleQuery.trim() && !cashForm.employeeId && !advanceQueryMatchesEmployee ? (
                    <button type="button" className="petty-advance-create" onClick={handleUseNewAdvanceEmployee}>
                      Registrar nuevo: <strong>{advancePeopleQuery.trim()}</strong>
                    </button>
                  ) : null}

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

  if (activeModule === 'contabilidad_caja_grande') {
    return (
      <section className="panel accounting-bigcash-view accounting-redesign">
        <header className="accounting-bigcash-head">
          <div>
            <h2>Caja Grande</h2>
            <p>Ingresos, saldos y compromisos originados por contratos en Órdenes.</p>
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
          <button type="button" className="bigcash-kpi-card balance is-clickable" onClick={() => { setBigCashListQuery(''); setBigCashListMonth(''); setBigCashListModal('balanceMovements'); }}>
            <small className="pill">Disponible</small>
            <div className="bigcash-kpi-content">
              <span className="bigcash-hero-icon blue"><CashIcon kind="petty" /></span>
              <div>
                <strong>SALDO OPERATIVO</strong>
                <h3 className="value-blue">{formatBs(operationalBigCashBs)}</h3>
                <p>Saldo físico menos garantías retenidas.</p>
              </div>
            </div>
          </button>
          <button type="button" className="bigcash-kpi-card guarantee is-clickable" onClick={() => { setBigCashListQuery(''); setBigCashListMonth(''); setBigCashListModal('guarantees'); }}>
            <small className="pill warning">No disponible</small>
            <div className="bigcash-kpi-content">
              <span className="bigcash-hero-icon violet"><MiniIcon kind="lock" /></span>
              <div>
                <strong>GARANTÍAS EN CUSTODIA</strong>
                <h3 className="value-violet">{formatBs(guaranteeCommitmentsBs)}</h3>
                <p>Recibidas {formatBs(guaranteesHeldBs)} · por validar {formatBs(unvalidatedGuaranteesBs)}</p>
              </div>
            </div>
          </button>
          <button type="button" className="bigcash-kpi-card income is-clickable" onClick={() => { setBigCashListQuery(''); setBigCashListMonth(''); setBigCashListModal('receivables'); }}>
            <div className="bigcash-kpi-content">
              <span className="bigcash-hero-icon orange"><MiniIcon kind="info" /></span>
              <div>
                <strong>CONTRATOS POR COBRAR</strong>
                <h3 className="value-orange">{formatBs(pendingReceivableBs)}</h3>
                <p>{pendingReceivableRows.length} contrato{pendingReceivableRows.length === 1 ? '' : 's'} con saldo.</p>
              </div>
            </div>
          </button>
          <button type="button" className="bigcash-kpi-card month is-clickable" onClick={() => { setBigCashListQuery(''); setBigCashListMonth(''); setBigCashListModal('movements'); }}>
            <div className="bigcash-kpi-content">
              <span className="bigcash-hero-icon green"><MiniIcon kind="chart" /></span>
              <div>
                <strong>NETO DEL PERÍODO</strong>
                <h3 className={periodBigCashNetBs < 0 ? 'value-orange' : 'value-green'}>{formatBs(periodBigCashNetBs)}</h3>
                <p>Cobrado {formatBs(periodBigCashCollectedBs)} · egresado {formatBs(periodBigCashOutBs)}</p>
              </div>
            </div>
          </button>
        </section>

        <section className="bigcash-ledger-overview">
          <article className="bigcash-ledger-card closing">
            <div>
              <span>Cierre del periodo</span>
              <h3>{formatDate(bigCashPeriodRange.dateFrom)} - {formatDate(bigCashPeriodRange.dateTo)}</h3>
            </div>
            <div className="bigcash-ledger-totals">
              <span><small>Cobrado</small><strong className="value-green">{formatBs(periodBigCashCollectedBs)}</strong></span>
              <span><small>Egresos</small><strong className="value-orange">{formatBs(periodBigCashOutBs)}</strong></span>
              <span><small>Neto</small><strong className={periodBigCashNetBs < 0 ? 'value-orange' : 'value-blue'}>{formatBs(periodBigCashNetBs)}</strong></span>
            </div>
            <div className="bigcash-ledger-split">
              <span>Operativo <b>{formatBs(periodOperationalIncomeBs)}</b></span>
              <span>Garantias <b>{formatBs(periodGuaranteeIncomeBs)}</b></span>
            </div>
          </article>

          <article className="bigcash-ledger-card methods">
            <header>
              <div>
                <span>Ingresos confirmados en Órdenes</span>
                <h3>Efectivo, QR y banco receptor</h3>
              </div>
            </header>
            <div className="bigcash-payment-grid">
              {visiblePaymentChannelRows.map((method) => (
                <div className={`bigcash-payment-card ${method.className}`} key={method.key}>
                  <span>{method.shortLabel}</span>
                  <div>
                    <strong>{method.label}</strong>
                    <small>{method.account || 'Caja física'} · {method.count} movimiento{method.count === 1 ? '' : 's'}</small>
                  </div>
                  <b>Neto {formatBs(method.netBs)}</b>
                  <em>Ingresó {formatBs(method.incomeBs ?? method.collectedBs)} · devuelto {formatBs(method.outBs)}</em>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="bigcash-card bigcash-vip-prepaid-card">
          <header>
            <div>
              <span>Clientes VIP</span>
              <h3><span className="bigcash-title-icon blue"><MiniIcon kind="lock" /></span>Saldos prepago no fisicos</h3>
              <p>Dinero abonado anteriormente. Se descuenta al aprobar contratos y no aumenta Caja Grande fisica.</p>
            </div>
            <div className="bigcash-vip-summary">
              <span><small>Saldo disponible</small><strong>{formatBs(totalPrepaidBalanceBs)}</strong></span>
              <span><small>Consumido</small><strong>{formatBs(totalPrepaidUsedBs)}</strong></span>
            </div>
          </header>

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
                {prepaidLedgerRows.slice(0, 8).map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.createdAt)} <small>{getHourLabel(row.createdAt)}</small></td>
                    <td>
                      <strong>{row.customerName}</strong>
                      <small>{row.client.whatsapp || row.client.phone || 'Sin telefono'}</small>
                    </td>
                    <td>
                      <strong>{row.description || (row.amountBs >= 0 ? 'Abono prepago' : 'Consumo prepago')}</strong>
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
                {prepaidLedgerRows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <p className="status">Aun no hay clientes VIP con cuenta prepago activa. Activalo en Clientes, dentro de Cuenta prepago.</p>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bigcash-command-grid">
          <article className="bigcash-card bigcash-command-card receivables">
            <header>
              <div>
                <span>01 · Seguimiento</span>
                <h3><span className="bigcash-title-icon orange"><MiniIcon kind="info" /></span>Contratos por cobrar</h3>
                <p>Contratos con saldo pendiente, cliente, responsable y fecha de evento.</p>
              </div>
              <strong>{formatBs(pendingReceivableBs)}</strong>
            </header>
            <div className="bigcash-table-wrap bigcash-command-table-wrap">
              <table className="accounting-table bigcash-table bigcash-command-table">
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th>Cliente</th>
                    <th>Responsable</th>
                    <th>Fecha evento</th>
                    <th>A cobrar</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pendingReceivableRows.slice(0, 5).map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.contractCode || row.orderCode}</strong><small>{row.orderCode}</small></td>
                      <td><strong>{row.customerName}</strong></td>
                      <td>{row.responsibleName}</td>
                      <td>{formatDate(row.eventDate)}</td>
                      <td className="amount">{formatBs(row.pendingBs)}</td>
                      <td><button type="button" className="accounting-inline-action" onClick={() => openCollectAction(row)}>Cobrar</button></td>
                    </tr>
                  ))}
                  {pendingReceivableRows.length === 0 ? <tr><td colSpan={6}><p className="status">Sin saldos pendientes por cobrar.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
            <button type="button" className="section-link blue" onClick={() => { setBigCashListQuery(''); setBigCashListMonth(''); setBigCashListModal('receivables'); }}>Ver más contratos</button>
          </article>

          <article className="bigcash-card bigcash-command-card guarantees">
            <header>
              <div>
                <span>02 · Control</span>
                <h3><span className="bigcash-title-icon violet"><MiniIcon kind="lock" /></span>Garantías retenidas / por devolver</h3>
                <p>Todo el dinero retenido. Solo se devuelve cuando el material ya volvió.</p>
              </div>
              <strong>{formatBs(guaranteeCommitmentsBs)}</strong>
            </header>
            <div className="bigcash-table-wrap bigcash-command-table-wrap">
              <table className="accounting-table bigcash-table bigcash-command-table">
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th>Cliente</th>
                    <th>Responsable</th>
                    <th>Estado</th>
                    <th>Pagada</th>
                    <th>Debe</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {guaranteesToReturnRows.slice(0, 5).map((row) => (
                    <tr key={row.id} className={row.isReadyToReturn ? 'guarantee-ready-row' : ''}>
                      <td><strong>{row.contractCode}</strong><small>{formatDate(row.eventDate)}</small></td>
                      <td><strong>{row.customerName}</strong></td>
                      <td>{row.responsibleName}</td>
                      <td><span className={`bigcash-status-pill ${row.isReadyToReturn ? 'ready' : 'waiting'}`}>{row.statusLabel}</span></td>
                      <td className="amount">{formatBs(row.validatedBs)}</td>
                      <td className="amount">{formatBs(row.unvalidatedBs)}</td>
                      <td>
                        {row.isReadyToReturn && row.isMoneyHeld ? (
                          <button
                            type="button"
                            className="accounting-inline-action"
                            onClick={() => handleReturnGuarantee(row)}
                            disabled={isSubmittingCash}
                            title="Devolver garantia y generar recibo"
                          >
                            Devolver
                          </button>
                        ) : (
                          <span className="bigcash-action-muted">{row.isMoneyHeld ? 'No listo' : 'Sin dinero'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {guaranteesToReturnRows.length === 0 ? <tr><td colSpan={7}><p className="status">Sin garantias retenidas pendientes.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
            <button type="button" className="section-link blue" onClick={() => { setBigCashListQuery(''); setBigCashListMonth(''); setBigCashListModal('guarantees'); }}>Ver mas garantias</button>
          </article>
        </section>

        <section className="bigcash-card bigcash-return-issues-card">
          <header>
            <div>
              <span>03 - Recepcion</span>
              <h3><span className="bigcash-title-icon orange"><MiniIcon kind="info" /></span>Danos y faltantes por contrato</h3>
              <p>Registro separado de roturas, perdidas y cargos definidos al cerrar recepcion.</p>
            </div>
            <strong>{formatBs(returnIssueTotalBs)}</strong>
          </header>
          <div className="bigcash-table-wrap bigcash-command-table-wrap">
            <table className="accounting-table bigcash-table bigcash-command-table bigcash-return-issues-table">
              <thead>
                <tr>
                  <th>Contrato</th>
                  <th>Item</th>
                  <th>Novedad</th>
                  <th>Origen</th>
                  <th>Penalizacion</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {returnIssueRows.slice(0, 6).map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.contractCode}</strong><small>{row.customerName}</small></td>
                    <td><strong>{row.itemName}</strong>{row.note ? <small>{row.note}</small> : null}</td>
                    <td>
                      <strong>{row.damagedQty > 0 ? `${row.damagedQty} rotos` : ''}{row.damagedQty > 0 && row.missingQty > 0 ? ' / ' : ''}{row.missingQty > 0 ? `${row.missingQty} faltantes` : ''}</strong>
                      <small>Dano {formatBs(row.damagedUnitChargeBs)} | Falta {formatBs(row.missingUnitChargeBs)}</small>
                    </td>
                    <td><span className={`bigcash-status-pill ${row.chargeOwner === 'cliente' ? 'ready' : 'waiting'}`}>{getReturnIssueOwnerLabel(row.chargeOwner)}</span></td>
                    <td className="amount">{formatBs(row.penaltyBs)}</td>
                    <td>
                      {row.chargeOwner === 'cliente'
                        ? <span className={`bigcash-status-pill ${row.pendingCollectionBs > 0 ? 'waiting' : 'ready'}`}>{row.pendingCollectionBs > 0 ? 'Por cobrar' : 'Cubierto / liquidado'}</span>
                        : <span className="bigcash-status-pill waiting">Perdida interna</span>}
                    </td>
                    <td>
                      {row.chargeOwner === 'cliente' && row.pendingCollectionBs > 0 ? (
                        <button type="button" className="accounting-inline-action" onClick={() => openCollectAction(row)}>Cobrar</button>
                      ) : (
                        <span className="bigcash-action-muted">Registro</span>
                      )}
                    </td>
                  </tr>
                ))}
                {returnIssueRows.length === 0 ? <tr><td colSpan={7}><p className="status">Sin danos ni faltantes registrados.</p></td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

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
                      : 'Últimos 5 movimientos del periodo seleccionado.'}
                </p>
              </div>
              <button
                type="button"
                className="bigcash-export-button"
                onClick={() => printCashHistoryReport({
                  cashBoxType: 'BIG_CASH',
                  rows: filteredBigCashRows,
                  title: 'Libro de Caja Grande',
                  dateFrom: bigCashPeriodRange.dateFrom,
                  dateTo: bigCashPeriodRange.dateTo,
                })}
              >
                <MiniIcon kind="report" />
                Reporte
              </button>
            </header>
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
                <select value={bigCashPeriod} onChange={(event) => setBigCashPeriod(event.target.value)}>
                  <option value="recent">Últimos 90 días</option>
                  <option value="day">Día</option>
                  <option value="week">Semana</option>
                  <option value="month">Mes</option>
                </select>
              </label>
              <label className="bigcash-date-range">
                <span>{formatDate(bigCashPeriodRange.dateFrom)} - {formatDate(bigCashPeriodRange.dateTo)}</span>
                <MiniIcon kind="calendar" />
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
                  {filteredBigCashRows.slice(0, 5).map((movement, index) => {
                    const meta = getBigCashMovementType(movement);
                    const paymentMeta = getPaymentMethodMeta(movement.paymentMethod);
                    const hasTransportRevenue = toNumber(movement?.transportRevenueBs) > 0
                      || String(movement?.accountingTag ?? '') === 'transport_revenue'
                      || String(movement?.category ?? '').toLowerCase() === 'transporte_cobrado'
                      || String(movement?.type ?? '').toLowerCase() === 'ingreso_transporte_cliente';
                    return (
                      <tr key={movement.id} className={isVoidedCashMovement(movement) ? 'cash-row-voided' : ''}>
                        <td>{formatDate(movement.createdAt)} <small>{getHourLabel(movement.createdAt)}</small></td>
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
            <button type="button" className="section-link blue" onClick={() => { setBigCashListQuery(''); setBigCashListModal('movements'); }}>Ver más movimientos</button>
          </article>

          <aside className="bigcash-insights">
            <section className="bigcash-card bigcash-summary-card">
              <h3><span className="bigcash-title-icon neutral"><CashIcon kind="summary" /></span>Composición</h3>
              <p className="bigcash-summary-note">Las garantías pertenecen al cliente y no son dinero operativo.</p>
              <div className="bigcash-summary-formula cash-composition">
                <span>
                  <small>Operativo</small>
                  <b className="value-green">{formatBs(operationalBigCashBs)}</b>
                </span>
                <i>+</i>
                <span>
                  <small>Garantias pagadas</small>
                  <b className="value-violet">{formatBs(guaranteesHeldBs)}</b>
                </span>
                <i>=</i>
                <span className="current">
                  <small>Total fisico</small>
                  <b className="value-blue">{formatBs(bigCashBalanceBs)}</b>
                </span>
              </div>
            </section>

            <section className="bigcash-card transport-margin-card">
              <h3><span className="bigcash-title-icon orange"><MiniIcon kind="chart" /></span>Transporte</h3>
              <div className="transport-margin-grid">
                <span><small>Cobrado</small><b className="value-green">{formatBs(monthTransportRevenueBs)}</b></span>
                <span><small>Gastado</small><b className="value-orange">{formatBs(monthTransportExpenseBs)}</b></span>
                <span className={monthTransportMarginBs >= 0 ? 'positive' : 'negative'}><small>Resultado</small><b>{formatBs(monthTransportMarginBs)}</b></span>
              </div>
            </section>
          </aside>
        </section>
        {renderBigCashListModal()}
        {renderCashModals()}
      </section>
    );
  }

  if (activeModule === 'contabilidad_caja_chica') {
    const openingRow = dayPettyOpeningRows[0] ?? null;
    const openingSource = selectedDayPettyRepositions[0] ?? openingRow;
    const pettyOpenedBy = openingRow?.responsible || openingRow?.createdBy || activeCashSession?.openedBy || '-';

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

        <section className="petty-kpi-grid">
          <article className="petty-kpi-card opening">
            <div className="petty-opening-head">
              <span className="petty-hero-icon violet"><CashIcon kind="big" /></span>
              <div>
                <strong>FONDO RECIBIDO</strong>
                <span>{formatDate(openingRow?.createdAt ?? selectedDate)} - {getLongHourLabel(openingRow?.createdAt ?? activeCashSession?.openedAt)}</span>
                <small>Por: {pettyOpenedBy}</small>
              </div>
            </div>
            <h3 className="value-blue">{formatBs(dayPettyOpeningBs + dayPettyRepositionBs)}</h3>
            <div className="petty-opening-note">
              <span>Desde Caja Grande</span>
              <b>{openingSource?.receipt || openingSource?.id ? `Ingreso N° ${String(openingSource?.receipt || openingSource?.id).slice(0, 12)}` : 'Sin referencia registrada'}</b>
            </div>
          </article>

          <article className="petty-kpi-card balance">
            <div className="petty-card-title">
              <span className="petty-hero-icon green"><CashIcon kind="petty" /></span>
              <div>
                <strong>SALDO DISPONIBLE</strong>
                <h3 className="value-green">{formatBs(pettyCashBalanceBs)}</h3>
                <p>Saldo actual en caja chica</p>
              </div>
            </div>
            <div className="petty-balance-list">
              <span><small>Apertura del día</small><b>{formatBs(dayPettyOpeningBs)}</b></span>
              <span><small>Reposiciones del dia</small><b>{formatBs(dayPettyRepositionBs)}</b></span>
              <span><small>Gastos del día</small><b className="value-orange">- {formatBs(dayPettyExpenseBs)}</b></span>
              <span><small>Saldo disponible</small><b className="value-green">{formatBs(pettyCashBalanceBs)}</b></span>
            </div>
          </article>

          <article className="petty-kpi-card expenses">
            <div className="petty-card-title">
              <span className="petty-hero-icon orange"><MiniIcon kind="cart" /></span>
              <div>
                <strong>GASTOS DEL DÍA</strong>
                <h3 className="value-orange">{formatBs(dayPettyExpenseBs)}</h3>
                <p>Total gastado hoy</p>
              </div>
            </div>
            <div className="petty-expense-foot">
              <b>N° de gastos: {dayPettyExpensesRows.filter((movement) => !isVoidedCashMovement(movement)).length}</b>
              <button type="button">Ver detalles</button>
            </div>
          </article>

        </section>

        <nav className="petty-workspace-tabs" aria-label="Secciones de Caja Chica">
          {[
            ['expenses', 'Gastos', filteredPettyExpenseRows.length],
            ['advances', 'Adelantos', personnelAdvanceRows.length],
            ['suppliers', 'Proveedores', pendingSupplierLoanRows.length],
            ['debts', 'Deudas', pendingCashDebts.length],
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
              <h3>GASTOS DE CAJA CHICA - {formatDate(selectedDate)}</h3>
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
                    <th>Hora</th>
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
                  {filteredPettyExpenseRows.slice(0, pettyCashVisibleRows).map((movement) => {
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
                      <tr key={movement.id} className={isVoidedCashMovement(movement) ? 'cash-row-voided' : ''}>
                        <td>{getLongHourLabel(movement.createdAt)}</td>
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
                  {filteredPettyExpenseRows.length === 0 ? <tr><td colSpan={8}><p className="status">Sin gastos registrados.</p></td></tr> : null}
                </tbody>
              </table>
            </div>

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
                  {personnelAdvanceRows.slice(0, 8).map((movement) => {
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
                  {personnelAdvanceRows.length === 0 ? (
                    <tr><td colSpan={6}><p className="status">Sin adelantos registrados todavia.</p></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
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
                  {supplierLoanRows.slice(0, 8).map((loan) => (
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
                  {supplierLoanRows.length === 0 ? (
                    <tr><td colSpan={7}><p className="status">Sin prestamos de proveedores registrados.</p></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
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
                  {sortedCashDebts.slice(0, 8).map((debt) => {
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
                  {sortedCashDebts.length === 0 ? <tr><td colSpan={9}><p className="status">Sin deudas registradas.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </article>

          <aside className="petty-side">
            <article className="petty-side-card petty-day-summary">
              <h3>RESUMEN DEL DÍA</h3>
              <div>
                <span><small>Apertura (desde Caja Grande)</small><b>{formatBs(dayPettyOpeningBs)}</b></span>
                <span><small>Reposiciones del dia</small><b>{formatBs(dayPettyRepositionBs)}</b></span>
                <span><small>Total gastos del día</small><b className="value-orange">- {formatBs(dayPettyExpenseBs)}</b></span>
                <span className="total"><small>Saldo disponible</small><b className="value-green">{formatBs(pettyCashBalanceBs)}</b></span>
              </div>
            </article>

            <article className="petty-info-card">
              <span><MiniIcon kind="info" /></span>
              <div>
                <strong>Importante</strong>
                <p>La caja chica solo recibe fondos desde Caja Grande. Desde esta vista registra gastos, filtra movimientos y conserva comprobantes.</p>
              </div>
            </article>

            <article className="petty-side-card petty-repositions">
              <h3>ÚLTIMAS REPOSICIONES DESDE CAJA GRANDE</h3>
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
