import { useMemo, useState } from 'react';

const ACCOUNTING_TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'libro', label: 'Libro contable' },
  { id: 'liquidaciones', label: 'Liquidaciones' },
  { id: 'inventario', label: 'Inventario contable' },
  { id: 'caja', label: 'Caja' },
];

const PERIOD_OPTIONS = [
  { id: 'month', label: 'Este mes' },
  { id: 'today', label: 'Hoy' },
  { id: 'all', label: 'Todo' },
];

const CASH_TYPE_META = {
  apertura: { label: 'Apertura de caja', kind: 'neutral', account: 'Caja' },
  cierre: { label: 'Cierre de caja', kind: 'neutral', account: 'Caja' },
  ingreso_alquiler: { label: 'Cobro alquiler', kind: 'income', account: 'Ingresos por alquiler' },
  ingreso_garantia: { label: 'Garantia recibida', kind: 'liability', account: 'Garantias en custodia' },
  saldo_alquiler_pendiente: { label: 'Saldo alquiler pendiente', kind: 'pending', account: 'Cuentas por cobrar' },
  liquidacion_devolucion: { label: 'Liquidacion devolucion', kind: 'settlement', account: 'Liquidaciones' },
  egreso_devolucion_garantia: { label: 'Devolucion garantia', kind: 'expense', account: 'Garantias devueltas' },
  saldo_pendiente_cobro: { label: 'Saldo post-devolucion', kind: 'pending', account: 'Cuentas por cobrar' },
  cobro_saldo_alquiler: { label: 'Cobro saldo alquiler', kind: 'income', account: 'Cuentas por cobrar' },
  cobro_saldo_devolucion: { label: 'Cobro saldo devolucion', kind: 'income', account: 'Cuentas por cobrar' },
  ingreso_manual: { label: 'Ingreso manual', kind: 'income', account: 'Caja' },
  egreso_manual: { label: 'Egreso manual', kind: 'expense', account: 'Caja' },
  transferencia_salida_caja_chica: { label: 'Transferencia salida', kind: 'transfer', account: 'Transferencia interna' },
  transferencia_entrada_caja_chica: { label: 'Transferencia entrada', kind: 'transfer', account: 'Transferencia interna' },
};

const CASH_BOX_META = {
  BIG_CASH: { label: 'Caja grande', shortLabel: 'Grande', className: 'big' },
  PETTY_CASH: { label: 'Caja chica', shortLabel: 'Chica', className: 'petty' },
};

const MOVEMENT_CATEGORIES = [
  { id: 'cobro_contrato', label: 'Cobro de contrato', defaultBox: 'BIG_CASH' },
  { id: 'adelanto_orden', label: 'Adelanto de orden', defaultBox: 'BIG_CASH' },
  { id: 'pago_final', label: 'Pago final', defaultBox: 'BIG_CASH' },
  { id: 'garantia', label: 'Garantia', defaultBox: 'BIG_CASH' },
  { id: 'proveedor_grande', label: 'Pago grande a proveedor', defaultBox: 'BIG_CASH' },
  { id: 'inventario_importante', label: 'Compra importante inventario', defaultBox: 'BIG_CASH' },
  { id: 'servicio_extra', label: 'Transporte/armado/decoracion', defaultBox: 'BIG_CASH' },
  { id: 'materiales_menores', label: 'Materiales menores', defaultBox: 'PETTY_CASH' },
  { id: 'transporte_menor', label: 'Transporte menor / taxi', defaultBox: 'PETTY_CASH' },
  { id: 'lavado_menor', label: 'Lavado menor', defaultBox: 'PETTY_CASH' },
  { id: 'reparacion_menor', label: 'Reparacion menor', defaultBox: 'PETTY_CASH' },
  { id: 'urgencia_evento', label: 'Urgencia de evento', defaultBox: 'PETTY_CASH' },
  { id: 'gasto_diario', label: 'Gasto diario operativo', defaultBox: 'PETTY_CASH' },
  { id: 'reposicion_caja_chica', label: 'Reposicion caja chica', defaultBox: 'PETTY_CASH' },
  { id: 'otro', label: 'Otro', defaultBox: 'BIG_CASH' },
];

const PAYMENT_METHODS = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'qr', label: 'QR' },
  { id: 'transferencia_bancaria', label: 'Transferencia bancaria' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'otro', label: 'Otro' },
];

const FLOW_STEPS = [
  {
    area: 'Ventas',
    pide: 'Cliente, evento, items, fechas y forma de pago.',
    manda: 'Cotizacion, contrato y orden aprobada.',
  },
  {
    area: 'Ordenes',
    pide: 'Contrato aprobado con items y totales.',
    manda: 'Reserva stock, cobro inicial, garantia y saldo.',
  },
  {
    area: 'Inventario',
    pide: 'Orden por alistar o devolucion recibida.',
    manda: 'Movimientos, recuperacion, reinsercion o baja.',
  },
  {
    area: 'Transporte',
    pide: 'Entrega/recojo programado y checklist.',
    manda: 'Orden lista para recepcion y devolucion.',
  },
  {
    area: 'Devolucion',
    pide: 'Detalle devuelto, daniado o faltante por item.',
    manda: 'Liquidacion, penalidad, refund o saldo por cobrar.',
  },
  {
    area: 'Contabilidad',
    pide: 'Caja, ordenes, devoluciones e inventario.',
    manda: 'Libro, pendientes, garantias y control de resultado.',
  },
];

const ACTION_FORM_DEFAULTS = {
  openingAmountBs: '0',
  openingBigCashBs: '0',
  openingPettyCashBs: '0',
  countedAmountBs: '0',
  countedBigCashBs: '0',
  countedPettyCashBs: '0',
  amountBs: '',
  type: 'ingreso',
  cashBoxType: 'BIG_CASH',
  category: 'cobro_contrato',
  paymentMethod: 'efectivo',
  responsible: '',
  receipt: '',
  description: '',
  notes: '',
};

function AccountingIcon({ kind }) {
  const paths = {
    money: (
      <>
        <path d="M12 4v16" />
        <path d="M16.2 7.5A4.2 4.2 0 0 0 12 5.8c-2.2 0-3.8 1-3.8 2.6 0 1.8 1.6 2.4 3.8 3 2.2.6 3.8 1.2 3.8 3 0 1.6-1.6 2.8-3.8 2.8a4.8 4.8 0 0 1-4.6-2.2" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 7.5h14a2 2 0 0 1 2 2v8H6a2 2 0 0 1-2-2v-8Z" />
        <path d="M6 7.5V6a2 2 0 0 1 2-2h9v3.5" />
        <path d="M16.5 13h.01" />
      </>
    ),
    pending: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 19 6v5c0 4.5-2.8 7.6-7 10-4.2-2.4-7-5.5-7-10V6l7-3Z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
    book: (
      <>
        <path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" />
        <path d="M8 4v13a3 3 0 0 0 3 3" />
        <path d="M9 8h5M9 12h5" />
      </>
    ),
    box: (
      <>
        <path d="M12 3 20 7.2v9.6L12 21l-8-4.2V7.2L12 3Z" />
        <path d="M12 11 20 7.2M12 11 4 7.2M12 11v10" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {paths[kind] ?? paths.book}
      </g>
    </svg>
  );
}

const toNumber = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sumBy = (rows, getter) => Number(rows.reduce((sum, row) => sum + toNumber(getter(row)), 0).toFixed(2));

const getDateValue = (value) => {
  const parsed = new Date(value ?? '');
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isInPeriod = (value, period) => {
  if (period === 'all') return true;
  const parsed = getDateValue(value);
  if (!parsed) return false;
  const now = new Date();

  if (period === 'today') {
    return parsed.getFullYear() === now.getFullYear()
      && parsed.getMonth() === now.getMonth()
      && parsed.getDate() === now.getDate();
  }

  return parsed.getFullYear() === now.getFullYear() && parsed.getMonth() === now.getMonth();
};

const getRentalTotal = (rental) => toNumber(rental?.totals?.totalBs);
const getRentalPaid = (rental) => toNumber(rental?.payment?.paidAtRentalBs ?? rental?.totals?.paidAtRentalBs);
const getRentalPending = (rental) => toNumber(rental?.payment?.pendingPaymentBs ?? rental?.totals?.pendingPaymentBs);
const getLineQuantity = (line) => toNumber(line?.quantity ?? line?.returnedQuantity ?? line?.expectedQuantity);
const getLineName = (line) => line?.itemName ?? line?.name ?? line?.description ?? 'Item';
const getLinePrice = (line) => toNumber(line?.rentalPriceBs ?? line?.unitPriceBs);
const getLineTotal = (line) => toNumber(line?.lineTotalBs ?? getLineQuantity(line) * getLinePrice(line));
const getPaymentModeLabel = (mode) => {
  const labels = {
    cancelado: 'Cancelado',
    a_cuenta: 'A cuenta',
    sin_pago: 'Sin pago',
  };
  return labels[mode] ?? 'No definido';
};

const getBillingModeLabel = (mode) => (mode === 'con_factura' ? 'Con factura' : 'Sin factura');
const getLogisticsModeLabel = (mode) => (mode === 'recojo' ? 'Recojo por cliente' : 'Envio y recojo');
const getCashBoxMeta = (cashBoxType) => CASH_BOX_META[cashBoxType] ?? CASH_BOX_META.BIG_CASH;
const getCategoryLabel = (category) =>
  MOVEMENT_CATEGORIES.find((entry) => entry.id === category)?.label ?? String(category || 'Sin categoria');
const getPaymentMethodLabel = (method) =>
  PAYMENT_METHODS.find((entry) => entry.id === method)?.label ?? String(method || 'No definido');

const getMovementMeta = (type) => CASH_TYPE_META[type] ?? {
  label: String(type ?? 'Movimiento'),
  kind: 'neutral',
  account: 'Caja',
};

function buildSettlementStatus(row) {
  if (row.accountingStatus === 'cobrado_finalizado') return { label: 'Cobrado y finalizado', className: 'success' };
  if (row.pendingCollectionBs > 0) return { label: 'Por cobrar', className: 'danger' };
  if (row.refundBs > 0) return { label: 'Garantia devuelta', className: 'info' };
  if (row.penaltiesBs > 0) return { label: 'Penalidad aplicada', className: 'warning' };
  return { label: 'Liquidado', className: 'success' };
}

function AccountingSection({
  rentals = [],
  contracts = [],
  quotes = [],
  supplierBundle = { suppliers: [], quotes: [], loans: [] },
  personnelBundle = { employees: [], attendance: [], incidents: [] },
  inventoryMovements = [],
  stockRecoveries = [],
  cashSummary = null,
  cashMovements = [],
  currentUser = null,
  formatBs,
  formatDate,
  formatDateTime,
  onOpenCashSession,
  onCloseCashSession,
  onCreateCashMovement,
  onCollectReceivable,
}) {
  const [activeTab, setActiveTab] = useState('resumen');
  const [period, setPeriod] = useState('month');
  const [query, setQuery] = useState('');
  const [actionModal, setActionModal] = useState(null);
  const [selectedReceivable, setSelectedReceivable] = useState(null);
  const [actionForm, setActionForm] = useState(ACTION_FORM_DEFAULTS);
  const [actionError, setActionError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const userName = currentUser?.fullName || currentUser?.username || 'Contabilidad';
  const activeCashSession = cashSummary?.activeSession ?? null;

  const periodRentals = useMemo(
    () => rentals.filter((rental) => isInPeriod(rental.createdAt ?? rental.rentalAt, period)),
    [period, rentals],
  );

  const returnedRentals = useMemo(
    () => rentals.filter((rental) => rental.status === 'returned'),
    [rentals],
  );

  const activeRentals = useMemo(
    () => rentals.filter((rental) => rental.status === 'active'),
    [rentals],
  );

  const contractByRentalId = useMemo(() => {
    const map = new Map();
    contracts.forEach((contract) => {
      if (contract?.rentalId) map.set(contract.rentalId, contract);
    });
    return map;
  }, [contracts]);

  const contractByOrderCode = useMemo(() => {
    const map = new Map();
    contracts.forEach((contract) => {
      if (contract?.orderCode) map.set(contract.orderCode, contract);
    });
    return map;
  }, [contracts]);

  const settlementRows = useMemo(
    () => returnedRentals
      .map((rental) => {
        const contract = contractByRentalId.get(rental.id) ?? contractByOrderCode.get(rental.orderCode);
        const settlement = rental.returnSettlement ?? {};
        const row = {
          id: rental.id,
          orderCode: rental.orderCode ?? rental.id,
          contractCode: contract?.contractCode ?? null,
          customerName: rental.customerName ?? 'Cliente',
          customerPhone: rental.customerPhone ?? contract?.customerPhone ?? '',
          returnedAt: rental.returnedAt ?? rental.updatedAt ?? rental.createdAt,
          rentalTotalBs: getRentalTotal(rental),
          paidBs: getRentalPaid(rental),
          depositBs: toNumber(rental.depositBs),
          outstandingRentalBs: toNumber(settlement.outstandingRentalBs),
          penaltiesBs: toNumber(settlement.penaltiesBs ?? rental.penaltiesBs),
          discountCoveredByDepositBs: toNumber(settlement.discountCoveredByDepositBs),
          refundBs: toNumber(settlement.refundBs ?? rental.refundBs),
          pendingCollectionBs: toNumber(settlement.pendingCollectionBs),
          accountingStatus: rental.accountingStatus ?? rental.payment?.status ?? '',
          eventType: contract?.eventType ?? rental.eventType ?? 'General',
          eventDate: contract?.eventDate ?? rental.rentalDate ?? rental.createdAt,
          deliveryDate: contract?.deliveryDate ?? rental.rentalDate ?? rental.createdAt,
          pickupDate: contract?.pickupDate ?? rental.dueDate ?? rental.dueAt,
          billingMode: contract?.billingMode ?? rental.billingMode,
          logisticsMode: contract?.logisticsMode ?? rental.logisticsMode,
          items: rental.returnReport ?? rental.items ?? [],
          rental,
          contract,
        };
        return {
          ...row,
          status: buildSettlementStatus(row),
        };
      })
      .filter((row) => isInPeriod(row.returnedAt, period))
      .sort((a, b) => new Date(b.returnedAt) - new Date(a.returnedAt)),
    [contractByOrderCode, contractByRentalId, period, returnedRentals],
  );

  const periodCashMovements = useMemo(
    () => cashMovements.filter((movement) => isInPeriod(movement.createdAt, period)),
    [cashMovements, period],
  );

  const realPeriodCashMovements = useMemo(
    () => periodCashMovements.filter((movement) => !movement.isInternalTransfer),
    [periodCashMovements],
  );

  const cashBoxStats = useMemo(() => {
    const buildStats = (cashBoxType) => {
      const allRows = periodCashMovements.filter((movement) => getCashBoxMeta(movement.cashBoxType).className === getCashBoxMeta(cashBoxType).className);
      const realRows = allRows.filter((movement) => !movement.isInternalTransfer);
      const incomeBs = sumBy(realRows.filter((movement) => toNumber(movement.amountBs) > 0), (movement) => movement.amountBs);
      const expenseBs = Math.abs(sumBy(realRows.filter((movement) => toNumber(movement.amountBs) < 0), (movement) => movement.amountBs));
      const transferInBs = sumBy(allRows.filter((movement) => movement.isInternalTransfer && toNumber(movement.amountBs) > 0), (movement) => movement.amountBs);
      const transferOutBs = Math.abs(sumBy(allRows.filter((movement) => movement.isInternalTransfer && toNumber(movement.amountBs) < 0), (movement) => movement.amountBs));
      return {
        balanceBs: toNumber(cashBoxType === 'PETTY_CASH' ? cashSummary?.pettyCashBalanceBs : cashSummary?.bigCashBalanceBs),
        incomeBs,
        expenseBs,
        transferInBs,
        transferOutBs,
        rows: allRows,
      };
    };

    const big = buildStats('BIG_CASH');
    const petty = buildStats('PETTY_CASH');
    return {
      BIG_CASH: big,
      PETTY_CASH: petty,
      totalAvailableBs: toNumber(cashSummary?.totalAvailableBs ?? big.balanceBs + petty.balanceBs),
      internalTransfers: periodCashMovements.filter((movement) => movement.isInternalTransfer),
    };
  }, [cashSummary, periodCashMovements]);

  const inventoryRows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return inventoryMovements
      .filter((movement) => ['reserva', 'reinsercion', 'salida', 'entrada', 'ajuste'].includes(movement.type))
      .filter((movement) => isInPeriod(movement.createdAt, period))
      .map((movement) => {
        const beforeAvailable = toNumber(movement.beforeAvailableStock ?? movement.beforeTotalStock);
        const afterAvailable = toNumber(movement.afterAvailableStock ?? movement.afterTotalStock);
        const beforeTotal = toNumber(movement.beforeTotalStock);
        const afterTotal = toNumber(movement.afterTotalStock);
        const availableDelta = afterAvailable - beforeAvailable;
        const totalDelta = afterTotal - beforeTotal;
        const impactUnits = toNumber(movement.deltaUnits) || availableDelta || totalDelta;
        return {
          id: movement.id,
          createdAt: movement.createdAt,
          type: movement.type,
          itemName: movement.itemName ?? 'Item',
          reference: movement.reference ?? movement.id,
          reason: movement.reason ?? movement.detail ?? '-',
          impactUnits,
          stockAfter: afterAvailable,
          userName: movement.userName ?? 'Sistema',
        };
      })
      .filter((row) => {
        if (!text) return true;
        return String(row.itemName).toLowerCase().includes(text)
          || String(row.reference).toLowerCase().includes(text)
          || String(row.reason).toLowerCase().includes(text)
          || String(row.type).toLowerCase().includes(text);
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [inventoryMovements, period, query]);

  const ledgerRows = useMemo(() => {
    const rentalRows = periodRentals.map((rental) => ({
      id: `rental-${rental.id}`,
      createdAt: rental.createdAt ?? rental.rentalAt,
      source: rental.orderCode ?? rental.id,
      description: `Orden de servicio - ${rental.customerName ?? 'Cliente'}`,
      account: 'Ingresos devengados',
      typeLabel: 'Devengo alquiler',
      kind: getRentalPending(rental) > 0 ? 'pending' : 'income',
      cashBoxType: 'BIG_CASH',
      isInternalTransfer: false,
      amountBs: getRentalTotal(rental),
      status: getRentalPending(rental) > 0 ? 'Con saldo' : 'Pagado',
    }));

    const movementRows = periodCashMovements.map((movement) => {
      const meta = getMovementMeta(movement.type);
      return {
        id: `cash-${movement.id}`,
        createdAt: movement.createdAt,
        source: movement.sourceType ? `${movement.sourceType} ${movement.sourceId ?? ''}` : 'Caja',
        description: movement.description,
        account: meta.account,
        typeLabel: meta.label,
        kind: movement.isInternalTransfer ? 'transfer' : meta.kind,
        cashBoxType: movement.cashBoxType ?? 'BIG_CASH',
        isInternalTransfer: Boolean(movement.isInternalTransfer),
        amountBs: toNumber(movement.amountBs),
        status: movement.sessionId ? 'En caja' : 'Sin sesion',
      };
    });

    const returnRows = settlementRows.map((row) => ({
      id: `return-${row.id}`,
      createdAt: row.returnedAt,
      source: row.orderCode,
      description: `Liquidacion devolucion - ${row.customerName}`,
      account: 'Liquidaciones',
      typeLabel: 'Cierre devolucion',
      kind: row.pendingCollectionBs > 0 ? 'pending' : 'settlement',
      cashBoxType: 'BIG_CASH',
      isInternalTransfer: false,
      amountBs: row.penaltiesBs + row.outstandingRentalBs - row.refundBs,
      status: row.status.label,
    }));

    const text = query.trim().toLowerCase();
    return [...rentalRows, ...movementRows, ...returnRows]
      .filter((row) => {
        if (!text) return true;
        return String(row.source).toLowerCase().includes(text)
          || String(row.description).toLowerCase().includes(text)
          || String(row.account).toLowerCase().includes(text)
          || String(row.typeLabel).toLowerCase().includes(text);
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [periodCashMovements, periodRentals, query, settlementRows]);

  const pendingRows = useMemo(() => {
    const buildReceivableRow = (rental, kind) => {
      const contract = contractByRentalId.get(rental.id) ?? contractByOrderCode.get(rental.orderCode);
      const settlement = rental.returnSettlement ?? {};
      const isReturn = kind === 'return';
      const items = Array.isArray(rental.items) ? rental.items : [];
      const returnItems = Array.isArray(rental.returnReport) ? rental.returnReport : [];
      const displayItems = isReturn && returnItems.length > 0 ? returnItems : items;
      const source = rental.orderCode ?? rental.id;
      const relatedMovements = cashMovements
        .filter((movement) => movement.sourceId === rental.id || movement.sourceId === source)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const pendingCollectionBs = toNumber(settlement.pendingCollectionBs);

      return {
        id: `${isReturn ? 'pending-return' : 'pending-rental'}-${rental.id}`,
        sourceKind: isReturn ? 'return' : 'rental',
        rentalId: rental.id,
        type: isReturn ? 'Liquidacion devolucion' : 'Cobro alquiler',
        source,
        contractCode: contract?.contractCode ?? 'Sin contrato',
        contractStatus: contract?.status ?? '-',
        detail: rental.customerName ?? contract?.customerName ?? 'Cliente',
        customerName: rental.customerName ?? contract?.customerName ?? 'Cliente',
        customerPhone: rental.customerPhone ?? contract?.customerPhone ?? '',
        eventType: contract?.eventType ?? rental.eventType ?? 'Servicio de alquiler',
        eventDate: contract?.eventDate ?? rental.rentalDate ?? rental.createdAt,
        eventTime: contract?.eventTime ?? '',
        deliveryDate: contract?.deliveryDate ?? rental.rentalDate ?? rental.createdAt,
        pickupDate: contract?.pickupDate ?? rental.dueDate ?? rental.dueAt,
        dueAt: isReturn ? rental.returnedAt ?? rental.updatedAt : rental.dueAt ?? rental.dueDate ?? rental.createdAt,
        returnedAt: rental.returnedAt ?? rental.updatedAt,
        amountBs: isReturn ? pendingCollectionBs : getRentalPending(rental),
        totalBs: getRentalTotal(rental),
        paidBs: getRentalPaid(rental),
        depositBs: toNumber(rental.depositBs ?? contract?.totals?.guaranteeBs),
        outstandingRentalBs: toNumber(settlement.outstandingRentalBs),
        penaltiesBs: toNumber(settlement.penaltiesBs ?? rental.penaltiesBs),
        refundBs: toNumber(settlement.refundBs ?? rental.refundBs),
        discountCoveredByDepositBs: toNumber(settlement.discountCoveredByDepositBs),
        billingMode: contract?.billingMode ?? rental.billingMode,
        logisticsMode: contract?.logisticsMode ?? rental.logisticsMode,
        paymentMode: rental.payment?.mode,
        paymentStatus: rental.payment?.status ?? rental.accountingStatus ?? '-',
        items: displayItems,
        itemLines: displayItems.length,
        itemUnits: displayItems.reduce((sum, line) => sum + getLineQuantity(line), 0),
        cashMovements: relatedMovements,
        status: isReturn ? 'Post-devolucion' : 'Por cobrar',
      };
    };

    const activePending = activeRentals
      .filter((rental) => getRentalPending(rental) > 0)
      .map((rental) => buildReceivableRow(rental, 'rental'));

    const returnPending = returnedRentals
      .filter((rental) => toNumber(rental.returnSettlement?.pendingCollectionBs) > 0)
      .filter((rental) => isInPeriod(rental.returnedAt ?? rental.updatedAt ?? rental.createdAt, period))
      .map((rental) => buildReceivableRow(rental, 'return'));

    const recoveryPending = stockRecoveries.map((recovery) => ({
      id: `recovery-${recovery.id}`,
      sourceKind: 'inventory',
      type: recovery.stage === 'lavado' ? 'Lavado pendiente' : 'Reparacion pendiente',
      source: recovery.itemName,
      detail: recovery.sourceCustomerName ?? recovery.note ?? 'Inventario',
      amountBs: 0,
      dueAt: recovery.updatedAt ?? recovery.createdAt,
      status: `${recovery.quantity} unidades`,
      itemUnits: toNumber(recovery.quantity),
      itemLines: 1,
      customerName: recovery.sourceCustomerName ?? 'Inventario',
      inventoryStage: recovery.stage,
    }));

    return [...activePending, ...returnPending, ...recoveryPending]
      .sort((a, b) => new Date(b.dueAt ?? 0) - new Date(a.dueAt ?? 0));
  }, [activeRentals, cashMovements, contractByOrderCode, contractByRentalId, period, returnedRentals, stockRecoveries]);

  const totals = useMemo(() => {
    const accruedRevenueBs = sumBy(periodRentals, (rental) => getRentalTotal(rental))
      + sumBy(settlementRows, (row) => row.penaltiesBs);
    const cashInBs = sumBy(realPeriodCashMovements.filter((movement) => toNumber(movement.amountBs) > 0), (movement) => movement.amountBs);
    const cashOutBs = Math.abs(sumBy(realPeriodCashMovements.filter((movement) => toNumber(movement.amountBs) < 0), (movement) => movement.amountBs));
    const netCashBs = Number((cashInBs - cashOutBs).toFixed(2));
    const accountsReceivableBs = sumBy(activeRentals, getRentalPending) + sumBy(settlementRows, (row) => row.pendingCollectionBs);
    const guaranteeCustodyBs = sumBy(activeRentals, (rental) => rental.depositBs);
    const returnPenaltiesBs = sumBy(settlementRows, (row) => row.penaltiesBs);
    const refundsBs = sumBy(settlementRows, (row) => row.refundBs);
    const supplierLoansPending = supplierBundle.loans?.filter((loan) => !['devuelto', 'cerrado', 'cancelado'].includes(String(loan.status ?? '').toLowerCase())).length ?? 0;

    return {
      accruedRevenueBs,
      cashInBs,
      cashOutBs,
      netCashBs,
      accountsReceivableBs,
      guaranteeCustodyBs,
      returnPenaltiesBs,
      refundsBs,
      bigCashBs: cashBoxStats.BIG_CASH.balanceBs,
      pettyCashBs: cashBoxStats.PETTY_CASH.balanceBs,
      supplierLoansPending,
      contractsPending: contracts.filter((contract) => contract.status === 'pendiente').length,
      quotesOpen: quotes.filter((quote) => ['borrador', 'enviada'].includes(quote.status)).length,
      personnelIncidents: personnelBundle.incidents?.length ?? 0,
    };
  }, [activeRentals, cashBoxStats, contracts, periodRentals, personnelBundle.incidents, quotes, realPeriodCashMovements, settlementRows, supplierBundle.loans]);

  const kpiCards = [
    { tone: 'mint', icon: 'money', value: formatBs(totals.accruedRevenueBs), label: 'Ingresos devengados', note: `${periodRentals.length} ordenes en periodo` },
    { tone: 'sky', icon: 'wallet', value: formatBs(cashBoxStats.totalAvailableBs), label: 'Caja neta general', note: `Grande ${formatBs(totals.bigCashBs)} / chica ${formatBs(totals.pettyCashBs)}` },
    { tone: 'peach', icon: 'pending', value: formatBs(totals.accountsReceivableBs), label: 'Por cobrar', note: `${pendingRows.filter((row) => row.amountBs > 0).length} pendientes monetarios` },
    { tone: 'lilac', icon: 'shield', value: formatBs(totals.guaranteeCustodyBs), label: 'Garantias en custodia', note: `${activeRentals.length} ordenes activas` },
  ];

  const openActionModal = (nextAction) => {
    setSelectedReceivable(null);
    setActionModal(nextAction);
    setActionError('');
    setActionForm({
      ...ACTION_FORM_DEFAULTS,
      openingBigCashBs: '0',
      openingPettyCashBs: '0',
      countedAmountBs: String(activeCashSession?.expectedBalanceBs ?? 0),
      countedBigCashBs: String(activeCashSession?.expectedBigCashBs ?? 0),
      countedPettyCashBs: String(activeCashSession?.expectedPettyCashBs ?? 0),
      responsible: userName,
    });
  };

  const openPettyCashTransferModal = () => {
    openActionModal('movement');
    setActionForm((current) => ({
      ...current,
      type: 'transferencia',
      cashBoxType: 'PETTY_CASH',
      category: 'reposicion_caja_chica',
      paymentMethod: 'efectivo',
      description: 'Reposicion de caja chica desde caja grande',
      responsible: userName,
    }));
  };

  const openCollectModal = (receivable) => {
    setSelectedReceivable(receivable);
    setActionModal('collect');
    setActionError('');
    setActionForm({
      ...ACTION_FORM_DEFAULTS,
      amountBs: String(receivable.amountBs ?? 0),
      description: `${receivable.type} ${receivable.source} | ${receivable.customerName ?? receivable.detail} | Saldo ${formatBs(receivable.amountBs ?? 0)}`,
    });
  };

  const closeActionModal = () => {
    if (isSubmitting) return;
    setActionModal(null);
    setSelectedReceivable(null);
    setActionError('');
  };

  const submitAction = async (event) => {
    event.preventDefault();
    setActionError('');
    setIsSubmitting(true);
    try {
      if (actionModal === 'open') {
        await onOpenCashSession?.({
          openingAmountBs: actionForm.openingBigCashBs,
          openingBigCashBs: actionForm.openingBigCashBs,
          openingPettyCashBs: actionForm.openingPettyCashBs,
          notes: actionForm.notes,
          openedBy: userName,
        });
      } else if (actionModal === 'close') {
        await onCloseCashSession?.({
          countedAmountBs: actionForm.countedAmountBs,
          countedBigCashBs: actionForm.countedBigCashBs,
          countedPettyCashBs: actionForm.countedPettyCashBs,
          notes: actionForm.notes,
          closedBy: userName,
        });
      } else if (actionModal === 'movement') {
        await onCreateCashMovement?.({
          type: actionForm.type,
          cashBoxType: actionForm.cashBoxType,
          category: actionForm.category,
          amountBs: actionForm.amountBs,
          paymentMethod: actionForm.paymentMethod,
          description: actionForm.description,
          responsible: actionForm.responsible,
          receipt: actionForm.receipt,
          createdBy: userName,
        });
      } else if (actionModal === 'collect') {
        await onCollectReceivable?.({
          rentalId: selectedReceivable?.rentalId,
          amountBs: actionForm.amountBs,
          note: actionForm.description,
          cashBoxType: 'BIG_CASH',
          paymentMethod: actionForm.paymentMethod,
          receipt: actionForm.receipt,
          createdBy: userName,
        });
      }
      setActionModal(null);
      setSelectedReceivable(null);
      setActionError('');
    } catch (error) {
      setActionError(error.message || 'No se pudo completar la accion de caja.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="panel accounting-view">
      <header className="accounting-header">
        <div>
          <h2>Contabilidad</h2>
          <p>Controla caja, garantias, saldos por cobrar, liquidaciones e impacto de inventario desde los procesos reales del sistema.</p>
        </div>
        <div className="accounting-header-actions">
          {activeCashSession ? (
            <>
              <button type="button" className="ghost-button" onClick={() => openActionModal('movement')}>
                + Movimiento
              </button>
              <button type="button" className="primary-button" onClick={() => openActionModal('close')}>
                Cerrar caja
              </button>
            </>
          ) : (
            <button type="button" className="primary-button" onClick={() => openActionModal('open')}>
              Abrir caja
            </button>
          )}
        </div>
      </header>

      <div className="accounting-kpi-grid">
        {kpiCards.map((card) => (
          <article key={card.label} className={`accounting-kpi-card ${card.tone}`}>
            <span className={`accounting-kpi-icon ${card.tone}`}>
              <AccountingIcon kind={card.icon} />
            </span>
            <strong>{card.value}</strong>
            <p>{card.label}</p>
            <small>{card.note}</small>
          </article>
        ))}
      </div>

      <article className="accounting-process-card">
        <header>
          <div>
            <span className="accounting-eyebrow">Trazabilidad punta a punta</span>
            <h3>Como se conectan los procesos</h3>
          </div>
          <span className={`accounting-cash-status ${activeCashSession ? 'open' : 'closed'}`}>
            {activeCashSession ? `Caja abierta: ${formatBs(activeCashSession.expectedBalanceBs)}` : 'Caja cerrada'}
          </span>
        </header>
        <div className="accounting-flow-grid">
          {FLOW_STEPS.map((step) => (
            <article key={step.area}>
              <strong>{step.area}</strong>
              <span>Pide: {step.pide}</span>
              <span>Manda: {step.manda}</span>
            </article>
          ))}
        </div>
      </article>

      <article className="accounting-board">
        <div className="accounting-board-head">
          <div className="accounting-tabs">
            {ACCOUNTING_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="accounting-filters">
            <label className="accounting-search">
              <input
                type="search"
                placeholder="Buscar orden, cliente, cuenta o item..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        {activeTab === 'resumen' ? (
          <div className="accounting-summary-grid">
            <article className="accounting-summary-panel">
              <h3>Resultado del periodo</h3>
              <div className="accounting-money-list">
                <div><span>Ingreso devengado</span><strong>{formatBs(totals.accruedRevenueBs)}</strong></div>
                <div><span>Penalidades por devolucion</span><strong>{formatBs(totals.returnPenaltiesBs)}</strong></div>
                <div><span>Garantias devueltas</span><strong>{formatBs(totals.refundsBs)}</strong></div>
                <div><span>Caja neta registrada</span><strong>{formatBs(totals.netCashBs)}</strong></div>
              </div>
            </article>

            <article className="accounting-summary-panel">
              <h3>Pendientes de control</h3>
              <div className="accounting-pending-list">
                {pendingRows.slice(0, 6).map((row) => (
                  <article key={row.id} className={`accounting-pending-card ${row.amountBs > 0 ? 'is-receivable' : 'is-inventory'}`}>
                    <header className="accounting-pending-head">
                      <div>
                        <span className={`accounting-pill ${row.sourceKind === 'return' ? 'warning' : row.sourceKind === 'inventory' ? 'info' : 'pending'}`}>
                          {row.type}
                        </span>
                        <strong>{row.source}</strong>
                        <small>{row.contractCode ?? row.status}</small>
                      </div>
                      {row.amountBs > 0 ? (
                        <button
                          type="button"
                          className="accounting-inline-action"
                          onClick={() => openCollectModal(row)}
                          disabled={!activeCashSession}
                        >
                          Verificar y cobrar
                        </button>
                      ) : (
                        <span className="accounting-pending-status">{row.status}</span>
                      )}
                    </header>

                    {row.amountBs > 0 ? (
                      <>
                        <div className="accounting-pending-grid">
                          <span>
                            <small>Cliente</small>
                            <strong>{row.customerName}</strong>
                          </span>
                          <span>
                            <small>Evento</small>
                            <strong>{row.eventType}</strong>
                          </span>
                          <span>
                            <small>Entrega / recojo</small>
                            <strong>{[row.deliveryDate, row.pickupDate].filter(Boolean).map(formatDate).join(' - ')}</strong>
                          </span>
                        </div>
                        <div className="accounting-pending-money">
                          <span><small>Total</small><strong>{formatBs(row.totalBs)}</strong></span>
                          <span><small>Pagado</small><strong>{formatBs(row.paidBs)}</strong></span>
                          <span className="highlight"><small>Saldo</small><strong>{formatBs(row.amountBs)}</strong></span>
                        </div>
                        <footer className="accounting-pending-footer">
                          <span>{row.itemLines} lineas / {row.itemUnits} unidades</span>
                          <span>{row.customerPhone || 'Sin telefono'}</span>
                        </footer>
                      </>
                    ) : (
                      <div className="accounting-pending-inventory">
                        <strong>{row.source}</strong>
                        <span>{row.detail}</span>
                        <small>{row.status} fuera de stock disponible hasta reinsertar.</small>
                      </div>
                    )}
                  </article>
                ))}
                {pendingRows.length === 0 ? <p className="status">No hay pendientes contables.</p> : null}
              </div>
            </article>

            <article className="accounting-summary-panel wide">
              <h3>Alertas de conciliacion</h3>
              <div className="accounting-alert-grid">
                <div>
                  <strong>{cashSummary?.orphanMovementsCount ?? 0}</strong>
                  <span>Movimientos sin sesion de caja</span>
                </div>
                <div>
                  <strong>{stockRecoveries.length}</strong>
                  <span>Items en lavado o reparacion</span>
                </div>
                <div>
                  <strong>{totals.contractsPending}</strong>
                  <span>Contratos pendientes de aprobacion</span>
                </div>
                <div>
                  <strong>{totals.supplierLoansPending}</strong>
                  <span>Prestamos/subalquileres por cerrar</span>
                </div>
              </div>
            </article>
          </div>
        ) : null}

        {activeTab === 'libro' ? (
          <div className="accounting-table-wrap">
            <table className="accounting-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Origen</th>
                  <th>Caja</th>
                  <th>Cuenta</th>
                  <th>Movimiento</th>
                  <th>Estado</th>
                  <th>Importe</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>
                      <div className="accounting-main-cell">
                        <strong>{row.source}</strong>
                        <span>{row.description}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`accounting-cashbox-badge ${row.isInternalTransfer ? 'transfer' : getCashBoxMeta(row.cashBoxType).className}`}>
                        {row.isInternalTransfer ? 'Transferencia interna' : getCashBoxMeta(row.cashBoxType).label}
                      </span>
                    </td>
                    <td>{row.account}</td>
                    <td><span className={`accounting-pill ${row.kind}`}>{row.typeLabel}</span></td>
                    <td>{row.status}</td>
                    <td className={row.amountBs < 0 ? 'negative amount' : 'amount'}>{formatBs(row.amountBs)}</td>
                  </tr>
                ))}
                {ledgerRows.length === 0 ? (
                  <tr><td colSpan={7}><p className="status">No hay registros para el filtro seleccionado.</p></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {activeTab === 'liquidaciones' ? (
          <div className="accounting-table-wrap">
            <table className="accounting-table">
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Cliente</th>
                  <th>Devuelto</th>
                  <th>Penalidad</th>
                  <th>Saldo alquiler</th>
                  <th>Refund</th>
                  <th>Por cobrar</th>
                  <th>Estado</th>
                  <th>Accion</th>
                </tr>
              </thead>
              <tbody>
                {settlementRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.orderCode}</td>
                    <td>{row.customerName}</td>
                    <td>{formatDate(row.returnedAt)}</td>
                    <td className="amount">{formatBs(row.penaltiesBs)}</td>
                    <td className="amount">{formatBs(row.outstandingRentalBs)}</td>
                    <td className="amount">{formatBs(row.refundBs)}</td>
                    <td className="amount">{formatBs(row.pendingCollectionBs)}</td>
                    <td><span className={`accounting-pill ${row.status.className}`}>{row.status.label}</span></td>
                    <td>
                      {row.pendingCollectionBs > 0 ? (() => {
                        const receivable = pendingRows.find((pending) => pending.rentalId === row.id && pending.sourceKind === 'return') ?? {
                          ...row,
                          id: `pending-return-${row.id}`,
                          rentalId: row.id,
                          type: 'Liquidacion devolucion',
                          source: row.orderCode,
                          detail: row.customerName,
                          amountBs: row.pendingCollectionBs,
                        };
                        return (
                          <button
                            type="button"
                            className="ghost-button accounting-collect-button"
                            onClick={() => openCollectModal(receivable)}
                            disabled={!activeCashSession}
                          >
                            Verificar
                          </button>
                        );
                      })() : (
                        <span className="accounting-muted">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {settlementRows.length === 0 ? (
                  <tr><td colSpan={9}><p className="status">No hay devoluciones liquidadas en este periodo.</p></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {activeTab === 'inventario' ? (
          <div className="accounting-inventory-grid">
            <article className="accounting-recovery-panel">
              <h3>Items pendientes de reinsercion</h3>
              {stockRecoveries.length === 0 ? (
                <p className="status">No hay items en lavado o reparacion.</p>
              ) : (
                stockRecoveries.map((recovery) => (
                  <div key={recovery.id} className="accounting-recovery-row">
                    <span className={`accounting-pill ${recovery.stage === 'lavado' ? 'info' : 'warning'}`}>
                      {recovery.stage === 'lavado' ? 'Lavado' : 'Reparacion'}
                    </span>
                    <div>
                      <strong>{recovery.itemName}</strong>
                      <small>{recovery.sourceCustomerName ?? 'Sin cliente'} - {recovery.quantity} unidades</small>
                    </div>
                  </div>
                ))
              )}
            </article>

            <article className="accounting-table-wrap compact">
              <table className="accounting-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Item</th>
                    <th>Tipo</th>
                    <th>Referencia</th>
                    <th>Unidades</th>
                    <th>Stock final</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryRows.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.createdAt)}</td>
                      <td>
                        <div className="accounting-main-cell">
                          <strong>{row.itemName}</strong>
                          <span>{row.reason}</span>
                        </div>
                      </td>
                      <td><span className={`accounting-pill ${row.type}`}>{row.type}</span></td>
                      <td>{row.reference}</td>
                      <td className={row.impactUnits < 0 ? 'negative amount' : 'amount'}>{row.impactUnits}</td>
                      <td>{row.stockAfter}</td>
                    </tr>
                  ))}
                  {inventoryRows.length === 0 ? (
                    <tr><td colSpan={6}><p className="status">No hay movimientos de inventario para este filtro.</p></td></tr>
                  ) : null}
                </tbody>
              </table>
            </article>
          </div>
        ) : null}

        {activeTab === 'caja' ? (
          <div className="accounting-cash-workspace">
            <section className="accounting-cash-overview">
              {['BIG_CASH', 'PETTY_CASH'].map((cashBoxType) => {
                const meta = getCashBoxMeta(cashBoxType);
                const stats = cashBoxStats[cashBoxType];
                return (
                  <article key={cashBoxType} className={`accounting-cashbox-card ${meta.className}`}>
                    <header>
                      <div>
                        <span className={`accounting-cashbox-badge ${meta.className}`}>{meta.label}</span>
                        <h3>{formatBs(stats.balanceBs)}</h3>
                        <p>{cashBoxType === 'BIG_CASH' ? 'Fondo principal para contratos, garantias y pagos fuertes.' : 'Fondo operativo para gastos menores diarios.'}</p>
                      </div>
                      <AccountingIcon kind={cashBoxType === 'BIG_CASH' ? 'wallet' : 'money'} />
                    </header>
                    <div className="accounting-cashbox-metrics">
                      <span><small>Ingresos reales</small><strong>{formatBs(stats.incomeBs)}</strong></span>
                      <span><small>Egresos reales</small><strong>{formatBs(stats.expenseBs)}</strong></span>
                      <span><small>Transferido entra</small><strong>{formatBs(stats.transferInBs)}</strong></span>
                      <span><small>Transferido sale</small><strong>{formatBs(stats.transferOutBs)}</strong></span>
                    </div>
                  </article>
                );
              })}
            </section>

            <section className="accounting-cash-kpi-strip">
              <article>
                <span>Total disponible</span>
                <strong>{formatBs(cashBoxStats.totalAvailableBs)}</strong>
              </article>
              <article>
                <span>Ingresos caja grande</span>
                <strong>{formatBs(cashBoxStats.BIG_CASH.incomeBs)}</strong>
              </article>
              <article>
                <span>Egresos caja grande</span>
                <strong>{formatBs(cashBoxStats.BIG_CASH.expenseBs)}</strong>
              </article>
              <article>
                <span>Ingresos caja chica</span>
                <strong>{formatBs(cashBoxStats.PETTY_CASH.incomeBs)}</strong>
              </article>
              <article>
                <span>Egresos caja chica</span>
                <strong>{formatBs(cashBoxStats.PETTY_CASH.expenseBs)}</strong>
              </article>
            </section>

            <section className="accounting-cash-grid">
              <article className="accounting-summary-panel">
                <h3>Cierre de caja</h3>
                <div className="accounting-money-list">
                  <div><span>Estado</span><strong>{activeCashSession ? 'Abierta' : 'Cerrada'}</strong></div>
                  <div><span>Esperado caja grande</span><strong>{formatBs(activeCashSession?.expectedBigCashBs ?? 0)}</strong></div>
                  <div><span>Esperado caja chica</span><strong>{formatBs(activeCashSession?.expectedPettyCashBs ?? 0)}</strong></div>
                  <div><span>Total esperado</span><strong>{formatBs(activeCashSession?.expectedBalanceBs ?? 0)}</strong></div>
                </div>
                {activeCashSession ? (
                  <button type="button" className="primary-button accounting-close-panel-button" onClick={() => openActionModal('close')}>
                    Preparar cierre
                  </button>
                ) : (
                  <p className="status">Abre caja para registrar movimientos y preparar cierre.</p>
                )}
              </article>

              <article className="accounting-table-wrap compact">
                <header className="accounting-table-header">
                  <div>
                    <h3>Movimientos recientes</h3>
                    <p>Incluye caja grande, caja chica y transferencias internas.</p>
                  </div>
                </header>
              <table className="accounting-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Caja</th>
                    <th>Tipo</th>
                    <th>Categoria</th>
                    <th>Descripcion</th>
                    <th>Metodo</th>
                    <th>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {periodCashMovements.map((movement) => {
                    const meta = getMovementMeta(movement.type);
                    const cashBoxMeta = getCashBoxMeta(movement.cashBoxType);
                    return (
                      <tr key={movement.id}>
                        <td>{formatDateTime(movement.createdAt)}</td>
                        <td>
                          <span className={`accounting-cashbox-badge ${movement.isInternalTransfer ? 'transfer' : cashBoxMeta.className}`}>
                            {movement.isInternalTransfer ? 'Transferencia' : cashBoxMeta.shortLabel}
                          </span>
                        </td>
                        <td><span className={`accounting-pill ${movement.isInternalTransfer ? 'transfer' : meta.kind}`}>{meta.label}</span></td>
                        <td>{getCategoryLabel(movement.category)}</td>
                        <td>{movement.description}</td>
                        <td>{getPaymentMethodLabel(movement.paymentMethod)}</td>
                        <td className={toNumber(movement.amountBs) < 0 ? 'negative amount' : 'amount'}>{formatBs(movement.amountBs)}</td>
                      </tr>
                    );
                  })}
                  {periodCashMovements.length === 0 ? (
                    <tr><td colSpan={7}><p className="status">No hay movimientos de caja para este periodo.</p></td></tr>
                  ) : null}
                </tbody>
              </table>
              </article>
            </section>

            <section className="accounting-transfer-panel">
              <header>
                <div>
                  <h3>Transferencias internas</h3>
                  <p>Reposiciones de caja chica: no inflan ingresos ni egresos reales del negocio.</p>
                </div>
                <button type="button" className="ghost-button" onClick={openPettyCashTransferModal} disabled={!activeCashSession}>
                  Reponer caja chica
                </button>
              </header>
              <div className="accounting-transfer-list">
                {cashBoxStats.internalTransfers.slice(0, 6).map((movement) => (
                  <div key={movement.id}>
                    <span className={`accounting-cashbox-badge ${getCashBoxMeta(movement.cashBoxType).className}`}>
                      {getCashBoxMeta(movement.cashBoxType).label}
                    </span>
                    <strong>{movement.description}</strong>
                    <small>{formatDateTime(movement.createdAt)}</small>
                    <b className={toNumber(movement.amountBs) < 0 ? 'negative' : 'positive'}>{formatBs(movement.amountBs)}</b>
                  </div>
                ))}
                {cashBoxStats.internalTransfers.length === 0 ? (
                  <p className="status">No hay transferencias internas para este periodo.</p>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </article>

      {actionModal ? (
        <div className="accounting-modal-backdrop" onClick={closeActionModal}>
          <form className={`accounting-modal ${actionModal === 'collect' ? 'is-collect' : ''}`} onSubmit={submitAction} onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>
                {actionModal === 'open'
                  ? 'Abrir caja'
                  : actionModal === 'close'
                  ? 'Cerrar caja'
                  : actionModal === 'collect'
                  ? 'Verificar cobro'
                  : 'Registrar movimiento'}
              </h3>
              <button type="button" className="orders-modal-close" onClick={closeActionModal} aria-label="Cerrar">
                x
              </button>
            </header>

            {actionModal === 'open' ? (
              <div className="accounting-form-grid two">
                <label>
                  Apertura caja grande
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={actionForm.openingBigCashBs}
                    onChange={(event) => setActionForm((current) => ({ ...current, openingBigCashBs: event.target.value }))}
                  />
                </label>
                <label>
                  Apertura caja chica
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={actionForm.openingPettyCashBs}
                    onChange={(event) => setActionForm((current) => ({ ...current, openingPettyCashBs: event.target.value }))}
                  />
                </label>
              </div>
            ) : null}

            {actionModal === 'close' ? (
              <>
                <div className="accounting-close-preview">
                  <span><small>Esperado caja grande</small><strong>{formatBs(activeCashSession?.expectedBigCashBs ?? 0)}</strong></span>
                  <span><small>Esperado caja chica</small><strong>{formatBs(activeCashSession?.expectedPettyCashBs ?? 0)}</strong></span>
                </div>
                <div className="accounting-form-grid two">
                  <label>
                    Contado caja grande
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={actionForm.countedBigCashBs}
                      onChange={(event) => setActionForm((current) => ({ ...current, countedBigCashBs: event.target.value }))}
                    />
                  </label>
                  <label>
                    Contado caja chica
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={actionForm.countedPettyCashBs}
                      onChange={(event) => setActionForm((current) => ({ ...current, countedPettyCashBs: event.target.value }))}
                    />
                  </label>
                </div>
                <div className="accounting-close-preview">
                  <span>
                    <small>Diferencia caja grande</small>
                    <strong>{formatBs(toNumber(actionForm.countedBigCashBs) - toNumber(activeCashSession?.expectedBigCashBs))}</strong>
                  </span>
                  <span>
                    <small>Diferencia caja chica</small>
                    <strong>{formatBs(toNumber(actionForm.countedPettyCashBs) - toNumber(activeCashSession?.expectedPettyCashBs))}</strong>
                  </span>
                </div>
              </>
            ) : null}

            {actionModal === 'movement' || actionModal === 'collect' ? (
              <>
                {actionModal === 'movement' ? (
                  <div className="accounting-movement-form">
                    <div className="accounting-form-grid two">
                      <label>
                        Tipo de caja
                        <select
                          value={actionForm.cashBoxType}
                          onChange={(event) => setActionForm((current) => ({ ...current, cashBoxType: event.target.value }))}
                          disabled={actionForm.type === 'transferencia'}
                        >
                          <option value="BIG_CASH">Caja grande</option>
                          <option value="PETTY_CASH">Caja chica</option>
                        </select>
                      </label>
                      <label>
                        Tipo de movimiento
                        <select
                          value={actionForm.type}
                          onChange={(event) => setActionForm((current) => ({
                            ...current,
                            type: event.target.value,
                            cashBoxType: event.target.value === 'transferencia' ? 'PETTY_CASH' : current.cashBoxType,
                            category: event.target.value === 'transferencia' ? 'reposicion_caja_chica' : current.category,
                          }))}
                        >
                          <option value="ingreso">Ingreso</option>
                          <option value="egreso">Egreso</option>
                          <option value="transferencia">Transferencia interna</option>
                        </select>
                      </label>
                    </div>
                    <div className="accounting-form-grid two">
                      <label>
                        Categoria
                        <select
                          value={actionForm.category}
                          onChange={(event) => {
                            const category = MOVEMENT_CATEGORIES.find((entry) => entry.id === event.target.value);
                            setActionForm((current) => ({
                              ...current,
                              category: event.target.value,
                              cashBoxType: current.type === 'transferencia' ? 'PETTY_CASH' : category?.defaultBox ?? current.cashBoxType,
                            }));
                          }}
                        >
                          {MOVEMENT_CATEGORIES.map((category) => (
                            <option key={category.id} value={category.id}>{category.label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Metodo de pago
                        <select
                          value={actionForm.paymentMethod}
                          onChange={(event) => setActionForm((current) => ({ ...current, paymentMethod: event.target.value }))}
                        >
                          {PAYMENT_METHODS.map((method) => (
                            <option key={method.id} value={method.id}>{method.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {actionForm.type === 'transferencia' ? (
                      <p className="accounting-transfer-hint">
                        La transferencia saldra de caja grande y entrara a caja chica. No se contara como ingreso real.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="accounting-collect-summary">
                    <div className="accounting-collect-hero">
                      <div>
                        <span className={`accounting-pill ${selectedReceivable?.sourceKind === 'return' ? 'warning' : 'pending'}`}>
                          {selectedReceivable?.type}
                        </span>
                        <strong>{selectedReceivable?.source}</strong>
                        <small>Contrato {selectedReceivable?.contractCode ?? 'Sin contrato vinculado'}</small>
                      </div>
                      <div className="accounting-collect-amount">
                        <span>Saldo a confirmar</span>
                        <strong>{formatBs(selectedReceivable?.amountBs ?? 0)}</strong>
                      </div>
                    </div>

                    <div className="accounting-verify-grid">
                      <span>
                        <small>Cliente</small>
                        <strong>{selectedReceivable?.customerName ?? selectedReceivable?.detail}</strong>
                      </span>
                      <span>
                        <small>Telefono</small>
                        <strong>{selectedReceivable?.customerPhone || 'Sin telefono'}</strong>
                      </span>
                      <span>
                        <small>Evento</small>
                        <strong>{selectedReceivable?.eventType ?? 'Servicio de alquiler'}</strong>
                      </span>
                      <span>
                        <small>Fecha evento</small>
                        <strong>{formatDate(selectedReceivable?.eventDate)} {selectedReceivable?.eventTime ?? ''}</strong>
                      </span>
                      <span>
                        <small>Entrega</small>
                        <strong>{formatDate(selectedReceivable?.deliveryDate)}</strong>
                      </span>
                      <span>
                        <small>Recojo / devolucion</small>
                        <strong>{formatDate(selectedReceivable?.pickupDate ?? selectedReceivable?.returnedAt)}</strong>
                      </span>
                      <span>
                        <small>Modalidad</small>
                        <strong>{getLogisticsModeLabel(selectedReceivable?.logisticsMode)}</strong>
                      </span>
                      <span>
                        <small>Facturacion</small>
                        <strong>{getBillingModeLabel(selectedReceivable?.billingMode)}</strong>
                      </span>
                      <span>
                        <small>Pago inicial</small>
                        <strong>{getPaymentModeLabel(selectedReceivable?.paymentMode)}</strong>
                      </span>
                      <span>
                        <small>Estado contable</small>
                        <strong>{selectedReceivable?.paymentStatus ?? '-'}</strong>
                      </span>
                    </div>

                    <div className="accounting-verify-money">
                      <span><small>Total contrato</small><strong>{formatBs(selectedReceivable?.totalBs ?? 0)}</strong></span>
                      <span><small>Pagado en orden</small><strong>{formatBs(selectedReceivable?.paidBs ?? 0)}</strong></span>
                      <span><small>Garantia</small><strong>{formatBs(selectedReceivable?.depositBs ?? 0)}</strong></span>
                      <span className="highlight"><small>Saldo pendiente</small><strong>{formatBs(selectedReceivable?.amountBs ?? 0)}</strong></span>
                    </div>

                    {selectedReceivable?.sourceKind === 'return' ? (
                      <section className="accounting-verify-section">
                        <h4>Liquidacion de devolucion</h4>
                        <div className="accounting-verify-money compact">
                          <span><small>Saldo alquiler</small><strong>{formatBs(selectedReceivable?.outstandingRentalBs ?? 0)}</strong></span>
                          <span><small>Penalidades</small><strong>{formatBs(selectedReceivable?.penaltiesBs ?? 0)}</strong></span>
                          <span><small>Cubierto con garantia</small><strong>{formatBs(selectedReceivable?.discountCoveredByDepositBs ?? 0)}</strong></span>
                          <span><small>Devolucion garantia</small><strong>{formatBs(selectedReceivable?.refundBs ?? 0)}</strong></span>
                        </div>
                      </section>
                    ) : null}

                    <section className="accounting-verify-section">
                      <h4>Items del contrato</h4>
                      <div className="accounting-verify-items">
                        {(selectedReceivable?.items ?? []).slice(0, 4).map((line, index) => (
                          <div key={`${line.itemId ?? line.itemName ?? index}-${index}`}>
                            <span>{getLineName(line)}</span>
                            <strong>{getLineQuantity(line)} u.</strong>
                            <small>{formatBs(getLineTotal(line))}</small>
                          </div>
                        ))}
                        {(selectedReceivable?.items ?? []).length === 0 ? (
                          <p className="status">No hay items registrados para validar.</p>
                        ) : null}
                        {(selectedReceivable?.items ?? []).length > 4 ? (
                          <p className="accounting-muted">+ {(selectedReceivable?.items ?? []).length - 4} lineas adicionales en el contrato.</p>
                        ) : null}
                      </div>
                    </section>

                    <section className="accounting-verify-section">
                      <h4>Historial de caja vinculado</h4>
                      <div className="accounting-verify-movements">
                        {(selectedReceivable?.cashMovements ?? []).slice(0, 4).map((movement) => {
                          const meta = getMovementMeta(movement.type);
                          return (
                            <div key={movement.id}>
                              <span className={`accounting-pill ${meta.kind}`}>{meta.label}</span>
                              <strong>{formatBs(movement.amountBs)}</strong>
                              <small>{formatDateTime(movement.createdAt)}</small>
                            </div>
                          );
                        })}
                        {(selectedReceivable?.cashMovements ?? []).length === 0 ? (
                          <p className="status">Sin movimientos previos vinculados a esta orden.</p>
                        ) : null}
                      </div>
                    </section>
                  </div>
                )}
                <label>
                  Monto
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={actionForm.amountBs}
                    onChange={(event) => setActionForm((current) => ({ ...current, amountBs: event.target.value }))}
                    required
                  />
                </label>
                <div className="accounting-form-grid two">
                  {actionModal === 'collect' ? (
                    <label>
                      Metodo de pago
                      <select
                        value={actionForm.paymentMethod}
                        onChange={(event) => setActionForm((current) => ({ ...current, paymentMethod: event.target.value }))}
                      >
                        {PAYMENT_METHODS.map((method) => (
                          <option key={method.id} value={method.id}>{method.label}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      Responsable
                      <input
                        value={actionForm.responsible}
                        onChange={(event) => setActionForm((current) => ({ ...current, responsible: event.target.value }))}
                        placeholder={userName}
                      />
                    </label>
                  )}
                  <label>
                    Comprobante opcional
                    <input
                      value={actionForm.receipt}
                      onChange={(event) => setActionForm((current) => ({ ...current, receipt: event.target.value }))}
                      placeholder="Recibo, factura, QR..."
                    />
                  </label>
                </div>
                <label>
                  {actionModal === 'collect' ? 'Nota del cobro' : 'Descripcion'}
                  <textarea
                    value={actionForm.description}
                    onChange={(event) => setActionForm((current) => ({ ...current, description: event.target.value }))}
                    rows={3}
                    required
                  />
                </label>
              </>
            ) : (
              <label>
                Nota
                <textarea
                  value={actionForm.notes}
                  onChange={(event) => setActionForm((current) => ({ ...current, notes: event.target.value }))}
                  rows={3}
                />
              </label>
            )}

            {actionError ? <p className="status error">{actionError}</p> : null}

            <footer>
              <button type="button" className="ghost-button" onClick={closeActionModal} disabled={isSubmitting}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={isSubmitting}>
                {isSubmitting ? 'Procesando...' : 'Confirmar'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}

export default AccountingSection;
