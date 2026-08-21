import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';

const EMPTY_SUPPLIER = {
  name: '',
  contactName: '',
  phone: '',
  whatsapp: '',
  email: '',
  address: '',
  city: '',
  type: 'regular',
  paymentTerms: '',
  notes: '',
};

const EMPTY_QUOTE = {
  supplierId: '',
  title: 'Lista de precios',
  validFrom: '',
  validUntil: '',
  notes: '',
};

const EMPTY_LOAN = {
  supplierId: '',
  requestDate: '',
  returnDate: '',
  eventName: '',
  notes: '',
};

const EMPTY_LINE = {
  itemName: '',
  category: '',
  quantity: '1',
  unitPriceBs: '0',
  saleUnitPriceBs: '0',
};

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const formatDate = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const getDateKey = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

const isBetweenLoanDates = (value, dateFrom, dateTo) => {
  const date = getDateKey(value);
  if (!date) return true;
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;
  return true;
};

const getLineTotal = (line) =>
  Math.max(1, Math.trunc(Number(line.quantity ?? 1))) * Math.max(0, Number(line.unitPriceBs ?? 0));

const getLineSaleTotal = (line) =>
  Math.max(1, Math.trunc(Number(line.quantity ?? 1))) * Math.max(0, Number(line.saleUnitPriceBs ?? 0));

const getMarginTotal = (line) => getLineSaleTotal(line) - getLineTotal(line);

const getSupplierLoanContractCode = (loan) => String(
  loan?.sourceContractCode
  ?? loan?.contractCode
  ?? loan?.linkedContractCode
  ?? '',
).trim();

const getSupplierLoanEventDate = (loan) => String(
  loan?.eventDate
  ?? loan?.serviceDate
  ?? loan?.rentalDate
  ?? loan?.deliveryDate
  ?? loan?.requestDate
  ?? '',
).trim();

const getSupplierLoanReferenceLabel = (loan) => (
  getSupplierLoanContractCode(loan)
  || loan?.eventName
  || loan?.sourceOrderCode
  || 'Solicitud manual'
);

const createDocumentHtml = (loan) => `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${loan.loanCode}</title>
      <style>
        body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 28px; }
        h1 { font-size: 22px; margin: 0 0 6px; }
        p { margin: 3px 0; color: #475467; }
        table { width: 100%; border-collapse: collapse; margin-top: 22px; }
        th, td { border: 1px solid #d9e1ec; padding: 9px; text-align: left; font-size: 13px; }
        th { background: #f4f7fb; text-transform: uppercase; font-size: 11px; letter-spacing: .06em; }
        .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 18px; }
        .box { border: 1px solid #d9e1ec; padding: 10px; }
        .sign { display: grid; grid-template-columns: repeat(2, 1fr); gap: 48px; margin-top: 56px; }
        .sign div { border-top: 1px solid #111827; padding-top: 10px; text-align: center; font-size: 12px; text-transform: uppercase; }
      </style>
    </head>
    <body>
      <h1>Solicitud de abastecimiento proveedor</h1>
      <p><strong>${loan.loanCode}</strong> - ${loan.supplierName}</p>
      <div class="meta">
        <div class="box"><strong>Fecha del evento</strong><br />${formatDate(getSupplierLoanEventDate(loan))}</div>
        <div class="box"><strong>Fecha devolucion</strong><br />${formatDate(loan.returnDate)}</div>
        <div class="box"><strong>Operacion</strong><br />Proveedor entrega a Copetin</div>
        <div class="box"><strong>Contrato / referencia</strong><br />${getSupplierLoanReferenceLabel(loan)}</div>
      </div>
      <table>
        <thead><tr><th>Item</th><th>Categoria</th><th>Cantidad</th><th>Costo proveedor</th><th>Precio cliente</th><th>Total a pagar</th></tr></thead>
        <tbody>
          ${loan.items.map((line) => `<tr><td>${line.itemName}</td><td>${line.category || '-'}</td><td>${line.quantity}</td><td>Bs ${Number(line.unitPriceBs ?? 0).toFixed(2)}</td><td>Bs ${Number(line.saleUnitPriceBs ?? 0).toFixed(2)}</td><td>Bs ${Number(line.lineTotalBs ?? 0).toFixed(2)}</td></tr>`).join('')}
        </tbody>
      </table>
      <p style="margin-top:12px;"><strong>Total a pagar:</strong> Bs ${Number(loan?.totals?.totalBs ?? 0).toFixed(2)}</p>
      <p style="margin-top:18px;"><strong>Notas:</strong> ${loan.notes || 'Sin observaciones.'}</p>
      <div class="sign"><div>Copetin</div><div>${loan.supplierName}</div></div>
    </body>
  </html>
`;


const SUPPLIERS_VIEW_CACHE_KEY = 'copetin-suppliers-overview-v2';

const readSuppliersViewCache = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SUPPLIERS_VIEW_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
      loans: Array.isArray(parsed.loans) ? parsed.loans : [],
    };
  } catch {
    return null;
  }
};

const writeSuppliersViewCache = (bundle) => {
  if (typeof window === 'undefined' || !bundle) return;
  try {
    window.sessionStorage.setItem(SUPPLIERS_VIEW_CACHE_KEY, JSON.stringify({
      suppliers: Array.isArray(bundle.suppliers) ? bundle.suppliers : [],
      quotes: Array.isArray(bundle.quotes) ? bundle.quotes : [],
      loans: Array.isArray(bundle.loans) ? bundle.loans : [],
    }));
  } catch {
    // La cache es solo una aceleracion visual; nunca debe bloquear la vista.
  }
};

function SuppliersSection({
  supplierBundle,
  items = [],
  formatBs,
  onCreateSupplier,
  onUpdateSupplier,
  onCreateSupplierQuote,
  onCreateSupplierLoan,
  onUpdateSupplierLoanStatus,
}) {
  const [localBundle, setLocalBundle] = useState(() => readSuppliersViewCache() ?? supplierBundle ?? null);
  const [isOverviewLoading, setIsOverviewLoading] = useState(() => !localBundle);
  const [overviewLoadError, setOverviewLoadError] = useState('');
  const suppliers = useMemo(
    () => localBundle?.suppliers ?? supplierBundle?.suppliers ?? [],
    [localBundle?.suppliers, supplierBundle?.suppliers],
  );
  const quotes = useMemo(
    () => localBundle?.quotes ?? supplierBundle?.quotes ?? [],
    [localBundle?.quotes, supplierBundle?.quotes],
  );
  const loans = useMemo(
    () => localBundle?.loans ?? supplierBundle?.loans ?? [],
    [localBundle?.loans, supplierBundle?.loans],
  );

  const [activeView, setActiveView] = useState('proveedores');
  const [supplierForm, setSupplierForm] = useState(EMPTY_SUPPLIER);
  const [editingSupplierId, setEditingSupplierId] = useState('');
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [quoteForm, setQuoteForm] = useState(EMPTY_QUOTE);
  const [quoteLines, setQuoteLines] = useState([{ ...EMPTY_LINE }]);
  const [loanForm, setLoanForm] = useState(EMPTY_LOAN);
  const [loanLines, setLoanLines] = useState([{ ...EMPTY_LINE }]);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [loanSearch, setLoanSearch] = useState('');
  const [loanSupplierFilter, setLoanSupplierFilter] = useState('all');
  const [loanStatusFilter, setLoanStatusFilter] = useState('all');
  const [loanDateFrom, setLoanDateFrom] = useState('');
  const [loanDateTo, setLoanDateTo] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [documentPreview, setDocumentPreview] = useState(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');

  const refreshSupplierBundle = useCallback(async ({ force = false, silent = false } = {}) => {
    if (!silent) setIsOverviewLoading(true);
    setOverviewLoadError('');
    try {
      const bundle = await api.suppliers.listBundle({ force });
      setLocalBundle(bundle);
      writeSuppliersViewCache(bundle);
      return bundle;
    } catch (requestError) {
      setOverviewLoadError(requestError?.message || 'No se pudo actualizar la vista de proveedores.');
      return null;
    } finally {
      if (!silent) setIsOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const bundle = await api.suppliers.listBundle();
      if (!active) return;
      setLocalBundle(bundle);
      writeSuppliersViewCache(bundle);
      setOverviewLoadError('');
      setIsOverviewLoading(false);
    };
    load().catch((requestError) => {
      if (!active) return;
      setOverviewLoadError(requestError?.message || 'No se pudo actualizar la vista de proveedores.');
      setIsOverviewLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!supplierBundle || typeof supplierBundle !== 'object') return;
    const hasServerRows = ['suppliers', 'quotes', 'loans']
      .some((key) => Array.isArray(supplierBundle?.[key]) && supplierBundle[key].length > 0);
    if (!hasServerRows && localBundle) return;
    setLocalBundle(supplierBundle);
    writeSuppliersViewCache(supplierBundle);
  }, [localBundle, supplierBundle]);


  const selectedQuoteSupplier = suppliers.find((supplier) => supplier.id === quoteForm.supplierId) ?? null;
  const selectedLoanSupplier = suppliers.find((supplier) => supplier.id === loanForm.supplierId) ?? null;
  const selectedDirectorySupplier = suppliers.find((supplier) => String(supplier.id) === String(selectedSupplierId)) ?? null;

  const supplierStats = useMemo(() => {
    const bySupplier = new Map();
    suppliers.forEach((supplier) => {
      bySupplier.set(supplier.id, {
        supplier,
        quoteCount: 0,
        loanCount: 0,
        pendingPaidBs: 0,
      });
    });
    quotes.forEach((quote) => {
      const row = bySupplier.get(quote.supplierId);
      if (row) row.quoteCount += 1;
    });
    loans.forEach((loan) => {
      const row = bySupplier.get(loan.supplierId);
      if (!row || loan.status === 'cancelado') return;
      row.loanCount += 1;
      const amount = Number(loan?.totals?.totalBs ?? 0);
      if (loan.direction === 'from_supplier') {
        row.pendingPaidBs += amount;
      }
    });
    return Array.from(bySupplier.values());
  }, [loans, quotes, suppliers]);

  const visibleSupplierStats = useMemo(() => {
    const query = normalizeText(supplierSearch);
    if (!query) return supplierStats;
    return supplierStats.filter(({ supplier }) => (
      normalizeText(supplier.name).includes(query)
      || normalizeText(supplier.contactName).includes(query)
      || normalizeText(supplier.phone).includes(query)
      || normalizeText(supplier.whatsapp).includes(query)
    ));
  }, [supplierSearch, supplierStats]);

  const loanStatusOptions = useMemo(() => (
    Array.from(new Set(loans.map((loan) => loan.status).filter(Boolean)))
      .sort((a, b) => String(a).localeCompare(String(b), 'es'))
  ), [loans]);

  const filteredLoans = useMemo(() => {
    const tokens = normalizeText(loanSearch).split(' ').filter(Boolean);
    return loans.filter((loan) => {
      if (loanSupplierFilter !== 'all' && String(loan.supplierId) !== loanSupplierFilter) return false;
      if (loanStatusFilter !== 'all' && String(loan.status) !== loanStatusFilter) return false;
      if (!isBetweenLoanDates(getSupplierLoanEventDate(loan) || loan.createdAt, loanDateFrom, loanDateTo)) return false;
      if (tokens.length === 0) return true;
      const itemText = (loan.items ?? [])
        .map((line) => `${line.itemName ?? ''} ${line.category ?? ''}`)
        .join(' ');
      const haystack = normalizeText([
        loan.loanCode,
        loan.supplierName,
        loan.eventName,
        loan.sourceOrderCode,
        loan.sourceContractCode,
        loan.contractCode,
        loan.orderCode,
        loan.reference,
        loan.notes,
        formatDate(getSupplierLoanEventDate(loan)),
        itemText,
      ].join(' '));
      return tokens.every((token) => haystack.includes(token));
    });
  }, [loanDateFrom, loanDateTo, loanSearch, loanStatusFilter, loanSupplierFilter, loans]);

  const filteredLoanTotals = useMemo(() => {
    const totalCostBs = filteredLoans.reduce((sum, loan) => sum + Number(loan?.totals?.totalBs ?? 0), 0);
    const totalSaleBs = filteredLoans.reduce(
      (sum, loan) => sum + (loan.items ?? []).reduce((lineSum, line) => lineSum + getLineSaleTotal(line), 0),
      0,
    );
    return { totalCostBs, totalSaleBs };
  }, [filteredLoans]);

  const clearLoanFilters = () => {
    setLoanSearch('');
    setLoanSupplierFilter('all');
    setLoanStatusFilter('all');
    setLoanDateFrom('');
    setLoanDateTo('');
  };

  const latestPrices = useMemo(() => {
    const map = new Map();
    quotes
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .forEach((quote) => {
        (quote.items ?? []).forEach((line) => {
          const key = `${quote.supplierId}|${normalizeText(line.itemName)}`;
          if (!map.has(key)) {
            map.set(key, {
              itemName: line.itemName,
              category: line.category,
              supplierUnitCostBs: Number(line.unitPriceBs ?? 0),
              saleUnitPriceBs: Number(line.saleUnitPriceBs ?? 0),
              quoteCode: quote.quoteCode,
            });
          }
        });
      });
    return map;
  }, [quotes]);

  const supplierCatalogRows = useMemo(() => {
    const rows = [];
    quotes.forEach((quote) => {
      (quote.items ?? []).forEach((line) => {
        rows.push({
          ...line,
          supplierId: quote.supplierId,
          supplierName: quote.supplierName,
          quoteCode: quote.quoteCode,
          quoteTitle: quote.title,
          validUntil: quote.validUntil,
          createdAt: quote.createdAt,
        });
      });
    });
    return rows;
  }, [quotes]);

  const supplierCatalogPreviewRows = useMemo(() => supplierCatalogRows.slice(0, 14), [supplierCatalogRows]);

  const selectedLoanSupplierOffers = useMemo(() => {
    if (!loanForm.supplierId) return [];
    const unique = new Map();
    supplierCatalogRows
      .filter((line) => line.supplierId === loanForm.supplierId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .forEach((line) => {
        const key = normalizeText(line.itemName);
        if (!unique.has(key)) unique.set(key, line);
      });
    return Array.from(unique.values());
  }, [loanForm.supplierId, supplierCatalogRows]);

  const requestTotals = useMemo(() => {
    const activeLoans = loans.filter((loan) => !['cancelado'].includes(loan.status));
    const totalCostBs = activeLoans.reduce((sum, loan) => sum + Number(loan?.totals?.totalBs ?? 0), 0);
    const totalSaleBs = activeLoans.reduce(
      (sum, loan) => sum + (loan.items ?? []).reduce((lineSum, line) => lineSum + getLineSaleTotal(line), 0),
      0,
    );
    return {
      activeCount: activeLoans.filter((loan) => !['devuelto', 'liquidado'].includes(loan.status)).length,
      totalCostBs,
      totalSaleBs,
      marginBs: totalSaleBs - totalCostBs,
    };
  }, [loans]);

  const updateLine = (kind, index, field, value) => {
    const setter = kind === 'quote' ? setQuoteLines : setLoanLines;
    const supplierId = kind === 'quote' ? quoteForm.supplierId : loanForm.supplierId;
    setter((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const next = { ...line, [field]: value };
        if (field === 'itemName') {
          const inventoryItem = items.find((item) => normalizeText(item.name) === normalizeText(value));
          const price = latestPrices.get(`${supplierId}|${normalizeText(value)}`);
          if (inventoryItem) {
            next.category = inventoryItem.category;
            next.saleUnitPriceBs = String(Math.max(0, Number(inventoryItem.rentalPriceBs ?? inventoryItem.unitPriceBs ?? next.saleUnitPriceBs ?? 0)));
          }
          if (price !== undefined) {
            next.category = price.category || next.category;
            next.unitPriceBs = String(price.supplierUnitCostBs ?? 0);
            if (Number(price.saleUnitPriceBs ?? 0) > 0) next.saleUnitPriceBs = String(price.saleUnitPriceBs);
          }
        }
        return next;
      }));
  };

  const applySupplierOfferToLoanLine = (offer, index = 0) => {
    setLoanLines((current) => {
      const safeIndex = Math.min(Math.max(0, index), Math.max(0, current.length - 1));
      return current.map((line, lineIndex) => {
        if (lineIndex !== safeIndex) return line;
        return {
          ...line,
          itemName: offer.itemName ?? '',
          category: offer.category ?? '',
          unitPriceBs: String(Math.max(0, Number(offer.unitPriceBs ?? 0))),
          saleUnitPriceBs: String(Math.max(0, Number(offer.saleUnitPriceBs ?? 0))),
        };
      });
    });
  };

  const submitSupplier = async (event) => {
    event.preventDefault();
    setError('');
    setFeedback('');
    try {
      if (editingSupplierId) {
        await onUpdateSupplier?.({ ...supplierForm, id: editingSupplierId });
        setFeedback('Proveedor actualizado.');
        await refreshSupplierBundle({ force: true, silent: true });
      } else {
        await onCreateSupplier?.(supplierForm);
        setFeedback('Proveedor creado.');
        await refreshSupplierBundle({ force: true, silent: true });
      }
      setSupplierForm(EMPTY_SUPPLIER);
      setEditingSupplierId('');
      setShowSupplierForm(false);
    } catch (requestError) {
      setError(requestError.message || 'No se pudo guardar el proveedor.');
    }
  };

  const submitQuote = async (event) => {
    event.preventDefault();
    setError('');
    setFeedback('');
    try {
      await onCreateSupplierQuote?.({ ...quoteForm, items: quoteLines });
      setQuoteForm({ ...EMPTY_QUOTE, supplierId: quoteForm.supplierId });
      setQuoteLines([{ ...EMPTY_LINE }]);
      setFeedback('Cotizacion del proveedor guardada.');
      await refreshSupplierBundle({ force: true, silent: true });
    } catch (requestError) {
      setError(requestError.message || 'No se pudo guardar la cotizacion.');
    }
  };

  const submitLoan = async (event) => {
    event.preventDefault();
    setError('');
    setFeedback('');
    try {
      await onCreateSupplierLoan?.({
        ...loanForm,
        direction: 'from_supplier',
        flowType: 'paid',
        items: loanLines,
      });
      setLoanForm({ ...EMPTY_LOAN, supplierId: loanForm.supplierId });
      setLoanLines([{ ...EMPTY_LINE }]);
      setShowLoanForm(false);
      setFeedback('Solicitud registrada.');
      await refreshSupplierBundle({ force: true, silent: true });
    } catch (requestError) {
      setError(requestError.message || 'No se pudo registrar la solicitud.');
    }
  };

  const editSupplier = (supplier) => {
    setEditingSupplierId(supplier.id);
    setSupplierForm({
      name: supplier.name ?? '',
      contactName: supplier.contactName ?? '',
      phone: supplier.phone ?? '',
      whatsapp: supplier.whatsapp ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      city: supplier.city ?? '',
      type: 'regular',
      paymentTerms: supplier.paymentTerms ?? '',
      notes: supplier.notes ?? '',
      status: supplier.status ?? 'active',
    });
    setActiveView('proveedores');
    setShowSupplierForm(true);
  };

  const printDocumentPreview = () => {
    const frame = document.getElementById('supplier-document-preview-frame');
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  };

  const updateLoanStatus = async (loan, status) => {
    setError('');
    setFeedback('');
    try {
      await onUpdateSupplierLoanStatus?.({ id: loan.id, status });
      setFeedback(`Solicitud ${loan.loanCode} actualizada a ${status}.`);
      await refreshSupplierBundle({ force: true, silent: true });
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la solicitud.');
    }
  };

  return (
    <section className="panel suppliers-panel suppliers-v2">
      <style>{`
        .suppliers-v2 {
          --sup-navy:#15376a;
          --sup-navy-2:#0f2f5e;
          --sup-orange:#e94b00;
          --sup-orange-soft:#fff3ed;
          --sup-border:#e6e9ef;
          --sup-soft:#f7f9fc;
          --sup-text:#13213b;
          --sup-muted:#667085;
          display:grid;
          gap:14px;
        }
        .suppliers-v2 .suppliers-system-head {
          display:flex;
          align-items:end;
          justify-content:space-between;
          gap:20px;
          padding:0 2px 4px;
        }
        .suppliers-v2 .suppliers-system-head h2 { margin:0; font-size:28px; color:#111827; letter-spacing:-.03em; }
        .suppliers-v2 .suppliers-system-head p { margin:4px 0 0; color:var(--sup-muted); font-size:13px; }
        .suppliers-v2 .suppliers-system-actions { display:flex; gap:8px; }
        .suppliers-v2 .suppliers-summary-card {
          background:#fff;
          border:1px solid var(--sup-border);
          border-radius:14px;
          overflow:hidden;
          box-shadow:0 8px 22px rgba(15,47,94,.05);
        }
        .suppliers-v2 .suppliers-view-tabs {
          display:grid;
          grid-template-columns:repeat(3,1fr);
          gap:0;
          padding:0;
          background:#f5f7fb;
          border-bottom:1px solid var(--sup-border);
        }
        .suppliers-v2 .suppliers-view-tabs button {
          position:relative;
          min-height:66px;
          border:0;
          background:transparent;
          display:grid;
          grid-template-columns:auto 1fr auto;
          align-items:center;
          gap:10px;
          padding:10px 18px;
          color:#344054;
          cursor:pointer;
          text-align:left;
        }
        .suppliers-v2 .suppliers-view-tabs button + button { border-left:1px solid var(--sup-border); }
        .suppliers-v2 .suppliers-view-tabs button.active {
          background:#fff;
          color:var(--sup-navy);
          box-shadow:inset 0 -3px 0 var(--sup-orange);
        }
        .suppliers-v2 .suppliers-tab-icon {
          width:36px;
          height:36px;
          border-radius:10px;
          display:grid;
          place-items:center;
          background:#fff;
          border:1px solid #e5eaf2;
          font-weight:900;
          color:var(--sup-orange);
        }
        .suppliers-v2 .suppliers-view-tabs strong { display:block; font-size:13px; }
        .suppliers-v2 .suppliers-view-tabs small { display:block; margin-top:2px; color:#7b8496; font-size:11px; font-weight:500; }
        .suppliers-v2 .suppliers-tab-count {
          min-width:30px;
          height:30px;
          padding:0 8px;
          border-radius:999px;
          display:grid;
          place-items:center;
          background:#eef3f9;
          color:var(--sup-navy);
          font-size:12px;
          font-weight:900;
        }
        .suppliers-v2 .suppliers-compact-kpis {
          display:grid;
          grid-template-columns:repeat(4,1fr);
          gap:0;
          border-top:1px solid #f0f2f5;
        }
        .suppliers-v2 .suppliers-compact-kpis article {
          min-height:74px;
          padding:12px 16px;
          display:flex;
          flex-direction:column;
          justify-content:center;
        }
        .suppliers-v2 .suppliers-compact-kpis article + article { border-left:1px solid var(--sup-border); }
        .suppliers-v2 .suppliers-compact-kpis span { font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:#7b8496; font-weight:800; }
        .suppliers-v2 .suppliers-compact-kpis strong { margin-top:2px; font-size:22px; line-height:1; color:var(--sup-navy); }
        .suppliers-v2 .suppliers-compact-kpis small { margin-top:4px; color:#98a2b3; font-size:10px; }
        .suppliers-v2 .suppliers-work-card {
          background:#fff;
          border:1px solid var(--sup-border);
          border-radius:14px;
          overflow:hidden;
          box-shadow:0 8px 22px rgba(15,47,94,.045);
        }
        .suppliers-v2 .suppliers-work-toolbar {
          display:grid;
          grid-template-columns:minmax(260px,1fr) auto auto;
          gap:10px;
          align-items:end;
          padding:13px 14px;
          background:#fffaf7;
          border-bottom:1px solid #f1ddd3;
        }
        .suppliers-v2 .suppliers-work-toolbar label { display:grid; gap:5px; color:#6b7280; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.035em; }
        .suppliers-v2 .suppliers-work-toolbar input { width:100%; min-height:38px; }
        .suppliers-v2 .suppliers-refresh-button { min-height:38px; white-space:nowrap; }
        .suppliers-v2 .suppliers-table-shell { overflow:auto; }
        .suppliers-v2 .suppliers-directory-table { width:100%; border-collapse:collapse; min-width:980px; }
        .suppliers-v2 .suppliers-directory-table thead th {
          padding:10px 12px;
          background:var(--sup-navy);
          color:#fff;
          font-size:10px;
          font-weight:800;
          text-transform:uppercase;
          letter-spacing:.025em;
          text-align:left;
          white-space:nowrap;
        }
        .suppliers-v2 .suppliers-directory-table tbody td {
          padding:11px 12px;
          border-bottom:1px solid #edf0f4;
          color:#344054;
          font-size:12px;
          vertical-align:middle;
        }
        .suppliers-v2 .suppliers-directory-table tbody tr:hover { background:#fffaf7; }
        .suppliers-v2 .supplier-name-cell { display:grid; gap:2px; min-width:220px; }
        .suppliers-v2 .supplier-name-cell strong { color:#15213c; font-size:13px; }
        .suppliers-v2 .supplier-name-cell small { color:#8a94a6; }
        .suppliers-v2 .supplier-contact-cell { display:grid; gap:2px; min-width:180px; }
        .suppliers-v2 .supplier-contact-cell strong { font-size:12px; color:#344054; }
        .suppliers-v2 .supplier-contact-cell small { color:#8a94a6; }
        .suppliers-v2 .supplier-number-badge {
          display:inline-flex;
          align-items:center;
          justify-content:center;
          min-width:34px;
          min-height:27px;
          border-radius:8px;
          background:#f3f6fa;
          color:var(--sup-navy);
          font-weight:900;
        }
        .suppliers-v2 .supplier-money { font-weight:900; color:#24324a; white-space:nowrap; }
        .suppliers-v2 .supplier-money.due { color:#b54708; }
        .suppliers-v2 .supplier-status {
          display:inline-flex;
          align-items:center;
          gap:5px;
          border-radius:999px;
          padding:4px 8px;
          font-size:10px;
          font-weight:800;
          background:#eaf8ef;
          color:#178445;
        }
        .suppliers-v2 .supplier-status::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; }
        .suppliers-v2 .supplier-status.inactive { background:#f2f4f7; color:#667085; }
        .suppliers-v2 .supplier-open-btn { min-height:32px; padding:0 13px; }
        .suppliers-v2 .suppliers-list-footer {
          display:flex;
          justify-content:space-between;
          gap:12px;
          align-items:center;
          padding:10px 14px;
          color:#7b8496;
          font-size:11px;
          background:#fafbfd;
          border-top:1px solid var(--sup-border);
        }
        .suppliers-v2 .suppliers-loading-line {
          display:flex;
          align-items:center;
          gap:8px;
          color:#667085;
          font-size:11px;
        }
        .suppliers-v2 .suppliers-loading-dot {
          width:7px;
          height:7px;
          border-radius:50%;
          background:var(--sup-orange);
          animation:supplierPulse 1s ease-in-out infinite alternate;
        }
        @keyframes supplierPulse { from { opacity:.25; transform:scale(.8); } to { opacity:1; transform:scale(1.12); } }
        .suppliers-v2 .suppliers-editor-card {
          padding:16px;
          margin:0;
          background:#fff;
          border:1px solid var(--sup-border);
          border-radius:14px;
          box-shadow:0 10px 26px rgba(15,47,94,.06);
        }
        .suppliers-v2 .suppliers-editor-head { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; margin-bottom:12px; }
        .suppliers-v2 .suppliers-editor-head h3 { margin:2px 0 4px; color:var(--sup-text); }
        .suppliers-v2 .suppliers-editor-head p { margin:0; color:var(--sup-muted); font-size:12px; }
        .suppliers-v2 .suppliers-eyebrow { color:var(--sup-orange); font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.06em; }
        .suppliers-v2 .suppliers-form-grid-compact { grid-template-columns:repeat(3,minmax(0,1fr)); }
        .suppliers-v2 .suppliers-detail-backdrop {
          position:fixed;
          inset:0;
          z-index:1200;
          background:rgba(15,23,42,.42);
          display:flex;
          justify-content:flex-end;
        }
        .suppliers-v2 .suppliers-detail-drawer {
          width:min(480px,94vw);
          height:100%;
          background:#fff;
          box-shadow:-20px 0 50px rgba(15,23,42,.2);
          display:flex;
          flex-direction:column;
        }
        .suppliers-v2 .suppliers-detail-head {
          padding:18px 20px;
          display:flex;
          justify-content:space-between;
          gap:16px;
          border-bottom:1px solid var(--sup-border);
          background:#fffaf7;
        }
        .suppliers-v2 .suppliers-detail-head h3 { margin:2px 0; color:var(--sup-text); }
        .suppliers-v2 .suppliers-detail-head p { margin:0; color:var(--sup-muted); font-size:12px; }
        .suppliers-v2 .suppliers-detail-body { padding:18px 20px; overflow:auto; display:grid; gap:14px; }
        .suppliers-v2 .suppliers-detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .suppliers-v2 .suppliers-detail-field {
          padding:10px 11px;
          border:1px solid var(--sup-border);
          border-radius:10px;
          background:#fafbfd;
          display:grid;
          gap:3px;
        }
        .suppliers-v2 .suppliers-detail-field.wide { grid-column:1/-1; }
        .suppliers-v2 .suppliers-detail-field span { color:#8b95a7; font-size:9px; text-transform:uppercase; font-weight:800; }
        .suppliers-v2 .suppliers-detail-field strong { color:#24324a; font-size:12px; font-weight:700; overflow-wrap:anywhere; }
        .suppliers-v2 .suppliers-detail-actions { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
        .suppliers-v2 .suppliers-detail-metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
        .suppliers-v2 .suppliers-detail-metrics article { padding:11px; border:1px solid var(--sup-border); border-radius:10px; background:#fff; display:grid; gap:3px; }
        .suppliers-v2 .suppliers-detail-metrics span { color:#8b95a7; font-size:9px; text-transform:uppercase; font-weight:800; }
        .suppliers-v2 .suppliers-detail-metrics strong { color:var(--sup-navy); font-size:14px; }
        .suppliers-v2 .suppliers-content-grid { align-items:start; }
        .suppliers-v2 .suppliers-card { border-radius:14px; border-color:var(--sup-border); box-shadow:none; }
        .suppliers-v2 .suppliers-card-head h3 { color:var(--sup-text); }
        .suppliers-v2 .supplier-loan-filters { background:#fafbfd; border:1px solid var(--sup-border); border-radius:12px; padding:10px; }
        .suppliers-v2 .suppliers-table thead th { background:var(--sup-navy); color:#fff; }
        .suppliers-v2 .suppliers-loans-full { width:100%; min-width:0; }
        .suppliers-v2 .suppliers-loans-full .suppliers-table-wrap { width:100%; overflow:auto; }
        .suppliers-v2 .suppliers-loans-full .suppliers-table { width:100%; min-width:1080px; }
        .suppliers-v2 .suppliers-loans-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; }
        .suppliers-v2 .supplier-request-modal-backdrop { position:fixed; inset:0; z-index:1300; background:rgba(15,23,42,.48); display:grid; place-items:center; padding:22px; }
        .suppliers-v2 .supplier-request-modal { width:min(980px,96vw); max-height:92vh; background:#fff; border-radius:16px; box-shadow:0 28px 70px rgba(15,23,42,.28); overflow:hidden; display:flex; flex-direction:column; }
        .suppliers-v2 .supplier-request-modal-head { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; padding:17px 20px; background:#fffaf7; border-bottom:1px solid #f1ddd3; }
        .suppliers-v2 .supplier-request-modal-head h3 { margin:2px 0 4px; color:var(--sup-text); font-size:20px; }
        .suppliers-v2 .supplier-request-modal-head p { margin:0; color:var(--sup-muted); font-size:12px; }
        .suppliers-v2 .supplier-request-modal-body { padding:18px 20px; overflow:auto; }
        .suppliers-v2 .supplier-request-modal-body .suppliers-form-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .suppliers-v2 .supplier-request-modal-foot { padding:12px 20px; border-top:1px solid var(--sup-border); background:#fff; display:flex; justify-content:space-between; align-items:center; gap:12px; }
        .suppliers-v2 .supplier-request-modal-foot > div { display:flex; gap:8px; }
        @media (max-width:1100px) {
          .suppliers-v2 .suppliers-compact-kpis { grid-template-columns:repeat(2,1fr); }
          .suppliers-v2 .suppliers-compact-kpis article:nth-child(3) { border-left:0; border-top:1px solid var(--sup-border); }
          .suppliers-v2 .suppliers-compact-kpis article:nth-child(4) { border-top:1px solid var(--sup-border); }
        }
        @media (max-width:760px) {
          .suppliers-v2 .suppliers-system-head { align-items:stretch; flex-direction:column; }
          .suppliers-v2 .suppliers-view-tabs { grid-template-columns:1fr; }
          .suppliers-v2 .suppliers-view-tabs button + button { border-left:0; border-top:1px solid var(--sup-border); }
          .suppliers-v2 .suppliers-work-toolbar { grid-template-columns:1fr; }
          .suppliers-v2 .suppliers-compact-kpis { grid-template-columns:1fr 1fr; }
          .suppliers-v2 .suppliers-form-grid-compact { grid-template-columns:1fr; }
          .suppliers-v2 .supplier-request-modal-body .suppliers-form-grid { grid-template-columns:1fr; }
          .suppliers-v2 .supplier-request-modal-backdrop { padding:8px; }
          .suppliers-v2 .supplier-request-modal { max-height:96vh; }
          .suppliers-v2 .suppliers-detail-grid,.suppliers-v2 .suppliers-detail-actions,.suppliers-v2 .suppliers-detail-metrics { grid-template-columns:1fr; }
        }
      `}</style>

      <header className="suppliers-system-head">
        <div>
          <h2>Proveedores</h2>
          <p>Abastecimiento externo, precios, solicitudes y pagos pendientes en una sola vista.</p>
        </div>
        <div className="suppliers-system-actions">
          {activeView === 'proveedores' ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setEditingSupplierId('');
                setSupplierForm(EMPTY_SUPPLIER);
                setShowSupplierForm(true);
              }}
            >
              + Nuevo proveedor
            </button>
          ) : null}
          {activeView === 'prestamos' ? (
            <button type="button" className="primary-button" onClick={() => setShowLoanForm(true)}>
              + Registrar pedido
            </button>
          ) : null}
        </div>
      </header>

      {feedback ? <p className="status success">{feedback}</p> : null}
      {error ? <p className="status error">{error}</p> : null}
      {overviewLoadError && suppliers.length === 0 ? <p className="status error">{overviewLoadError}</p> : null}

      <section className="suppliers-summary-card">
        <div className="suppliers-view-tabs" role="tablist" aria-label="Vistas de proveedores">
          <button type="button" className={activeView === 'proveedores' ? 'active' : ''} onClick={() => setActiveView('proveedores')}>
            <span className="suppliers-tab-icon">P</span>
            <span><strong>Directorio</strong><small>Contactos y saldos</small></span>
            <span className="suppliers-tab-count">{suppliers.length}</span>
          </button>
          <button type="button" className={activeView === 'cotizaciones' ? 'active' : ''} onClick={() => setActiveView('cotizaciones')}>
            <span className="suppliers-tab-icon">$</span>
            <span><strong>Items y precios</strong><small>Listas registradas</small></span>
            <span className="suppliers-tab-count">{supplierCatalogRows.length}</span>
          </button>
          <button type="button" className={activeView === 'prestamos' ? 'active' : ''} onClick={() => setActiveView('prestamos')}>
            <span className="suppliers-tab-icon">S</span>
            <span><strong>Solicitudes</strong><small>Abastecimiento operativo</small></span>
            <span className="suppliers-tab-count">{requestTotals.activeCount}</span>
          </button>
        </div>
        <div className="suppliers-compact-kpis">
          <article><span>Proveedores activos</span><strong>{suppliers.length}</strong><small>Directorio disponible</small></article>
          <article><span>Items con precio</span><strong>{supplierCatalogRows.length}</strong><small>Referencias de costo</small></article>
          <article><span>Solicitudes activas</span><strong>{requestTotals.activeCount}</strong><small>Pendientes de cierre</small></article>
          <article><span>Total por pagar</span><strong>{formatBs(requestTotals.totalCostBs)}</strong><small>Margen ref. {formatBs(requestTotals.marginBs)}</small></article>
        </div>
      </section>

      {activeView === 'proveedores' ? (
        <>
          {showSupplierForm ? (
            <form className="suppliers-editor-card" onSubmit={submitSupplier}>
              <div className="suppliers-editor-head">
                <div>
                  <span className="suppliers-eyebrow">{editingSupplierId ? 'Edición de proveedor' : 'Nuevo proveedor'}</span>
                  <h3>{editingSupplierId ? 'Actualizar datos' : 'Registrar proveedor'}</h3>
                  <p>Guarda contacto, ubicación y condiciones operativas sin mezclarlo con precios o solicitudes.</p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setEditingSupplierId('');
                    setSupplierForm(EMPTY_SUPPLIER);
                    setShowSupplierForm(false);
                  }}
                >
                  Cerrar
                </button>
              </div>
              <div className="suppliers-form-grid suppliers-form-grid-compact">
                <label>Nombre<input value={supplierForm.name} onChange={(event) => setSupplierForm((current) => ({ ...current, name: event.target.value }))} required /></label>
                <label>Contacto<input value={supplierForm.contactName} onChange={(event) => setSupplierForm((current) => ({ ...current, contactName: event.target.value }))} /></label>
                <label>Celular<input value={supplierForm.phone} onChange={(event) => setSupplierForm((current) => ({ ...current, phone: event.target.value }))} /></label>
                <label>WhatsApp<input value={supplierForm.whatsapp} onChange={(event) => setSupplierForm((current) => ({ ...current, whatsapp: event.target.value }))} /></label>
                <label>Email<input type="email" value={supplierForm.email} onChange={(event) => setSupplierForm((current) => ({ ...current, email: event.target.value }))} /></label>
                <label>Ciudad<input value={supplierForm.city} onChange={(event) => setSupplierForm((current) => ({ ...current, city: event.target.value }))} /></label>
                <label className="full-width">Dirección<input value={supplierForm.address} onChange={(event) => setSupplierForm((current) => ({ ...current, address: event.target.value }))} /></label>
                <label className="full-width">Condiciones<input value={supplierForm.paymentTerms} onChange={(event) => setSupplierForm((current) => ({ ...current, paymentTerms: event.target.value }))} placeholder="Ej: pago contra entrega, pago semanal..." /></label>
                <label className="full-width">Notas<textarea value={supplierForm.notes} onChange={(event) => setSupplierForm((current) => ({ ...current, notes: event.target.value }))} /></label>
              </div>
              <div className="suppliers-actions">
                <button type="submit" className="primary-button">{editingSupplierId ? 'Guardar cambios' : 'Crear proveedor'}</button>
              </div>
            </form>
          ) : null}

          <section className="suppliers-work-card">
            <div className="suppliers-work-toolbar">
              <label>
                Buscar proveedor
                <input
                  type="search"
                  placeholder="Nombre, contacto, celular, ciudad..."
                  value={supplierSearch}
                  onChange={(event) => setSupplierSearch(event.target.value)}
                />
              </label>
              <button type="button" className="ghost-button suppliers-refresh-button" onClick={() => refreshSupplierBundle({ force: true })}>
                Actualizar
              </button>
              <button
                type="button"
                className="primary-button suppliers-refresh-button"
                onClick={() => {
                  setEditingSupplierId('');
                  setSupplierForm(EMPTY_SUPPLIER);
                  setShowSupplierForm(true);
                }}
              >
                + Nuevo proveedor
              </button>
            </div>

            <div className="suppliers-table-shell">
              <table className="suppliers-directory-table">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th>Contacto</th>
                    <th>Listas</th>
                    <th>Solicitudes</th>
                    <th>Por pagar</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSupplierStats.map(({ supplier, quoteCount, loanCount, pendingPaidBs }) => (
                    <tr key={supplier.id}>
                      <td>
                        <div className="supplier-name-cell">
                          <strong>{supplier.name}</strong>
                          <small>{supplier.city || supplier.address || 'Sin ubicación registrada'}</small>
                        </div>
                      </td>
                      <td>
                        <div className="supplier-contact-cell">
                          <strong>{supplier.contactName || 'Contacto pendiente'}</strong>
                          <small>{supplier.phone || supplier.whatsapp || supplier.email || 'Sin teléfono registrado'}</small>
                        </div>
                      </td>
                      <td><span className="supplier-number-badge">{quoteCount}</span></td>
                      <td><span className="supplier-number-badge">{loanCount}</span></td>
                      <td><span className={`supplier-money ${pendingPaidBs > 0 ? 'due' : ''}`}>{formatBs(pendingPaidBs)}</span></td>
                      <td><span className={supplier.status === 'inactive' ? 'supplier-status inactive' : 'supplier-status'}>{supplier.status === 'inactive' ? 'Inactivo' : 'Activo'}</span></td>
                      <td>
                        <button type="button" className="ghost-button supplier-open-btn" onClick={() => setSelectedSupplierId(String(supplier.id))}>
                          Abrir
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!isOverviewLoading && visibleSupplierStats.length === 0 ? (
                    <tr><td colSpan={7}>No hay proveedores que coincidan con la búsqueda.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="suppliers-list-footer">
              <span>Mostrando {visibleSupplierStats.length} de {suppliers.length} proveedor(es)</span>
              {isOverviewLoading ? (
                <span className="suppliers-loading-line"><span className="suppliers-loading-dot" />Actualizando datos...</span>
              ) : (
                <span>Directorio operativo listo</span>
              )}
            </div>
          </section>
        </>
      ) : null}

      {activeView === 'cotizaciones' ? (
        <div className="suppliers-content-grid">
          <form className="suppliers-card suppliers-form" onSubmit={submitQuote}>
            <div className="suppliers-card-head">
              <div>
                <span>02 · Items y precios</span>
                <h3>Lista de precios del proveedor</h3>
                <p>Registra lo que puede darte, el costo que te cobra y el precio referencial al cliente.</p>
              </div>
            </div>
            <div className="suppliers-form-grid">
              <label>Proveedor<select value={quoteForm.supplierId} onChange={(event) => setQuoteForm((current) => ({ ...current, supplierId: event.target.value }))} required><option value="">Seleccionar...</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>Titulo<input value={quoteForm.title} onChange={(event) => setQuoteForm((current) => ({ ...current, title: event.target.value }))} /></label>
              <label>Vigente desde<input type="date" value={quoteForm.validFrom} onChange={(event) => setQuoteForm((current) => ({ ...current, validFrom: event.target.value }))} /></label>
              <label>Vigente hasta<input type="date" value={quoteForm.validUntil} onChange={(event) => setQuoteForm((current) => ({ ...current, validUntil: event.target.value }))} /></label>
            </div>
            <div className="supplier-lines">
              {quoteLines.map((line, index) => (
                <div key={`quote-line-${index}`} className="supplier-line-card">
                  <label>Item que ofrece<input list="inventory-item-names" placeholder="Ej: Silla tiffany dorada" value={line.itemName} onChange={(event) => updateLine('quote', index, 'itemName', event.target.value)} required /></label>
                  <label>Categoria<input placeholder="Sillas, mesas..." value={line.category} onChange={(event) => updateLine('quote', index, 'category', event.target.value)} /></label>
                  <label>Cant. base<input type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine('quote', index, 'quantity', event.target.value)} /></label>
                  <label>Me alquila a Bs<input type="number" min="0" step="0.01" value={line.unitPriceBs} onChange={(event) => updateLine('quote', index, 'unitPriceBs', event.target.value)} /></label>
                  <label>Yo lo doy a Bs<input type="number" min="0" step="0.01" value={line.saleUnitPriceBs} onChange={(event) => updateLine('quote', index, 'saleUnitPriceBs', event.target.value)} /></label>
                  <div className="supplier-line-summary">
                    <span>Costo {formatBs(getLineTotal(line))}</span>
                    <strong>Margen {formatBs(getMarginTotal(line))}</strong>
                  </div>
                  {quoteLines.length > 1 ? <button type="button" className="link-button" onClick={() => setQuoteLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Quitar</button> : null}
                </div>
              ))}
            </div>
            <div className="suppliers-actions">
              <button type="button" className="ghost-button" onClick={() => setQuoteLines((current) => [...current, { ...EMPTY_LINE }])}>Agregar item</button>
              <button type="submit" className="primary-button">Guardar cotizacion</button>
            </div>
            {selectedQuoteSupplier ? <p className="suppliers-hint">Se guardara para {selectedQuoteSupplier.name} como referencia de costos.</p> : null}
          </form>
          <section className="suppliers-card">
            <div className="suppliers-card-head">
              <div>
                <span>Catálogo vigente</span>
                <h3>Items ofrecidos por proveedores</h3>
                <p>Referencia rápida para saber quién te alquila cada item y a qué costo.</p>
              </div>
            </div>
            <div className="supplier-offer-list">
              {supplierCatalogPreviewRows.map((line) => (
                <article key={`${line.quoteCode}-${line.id}`} className="supplier-offer-card">
                  <div>
                    <strong>{line.itemName}</strong>
                    <span>{line.supplierName} · {line.category || 'Sin categoría'}</span>
                    <small>{line.quoteCode} · Vigencia {formatDate(line.validUntil)}</small>
                  </div>
                  <div>
                    <span>Proveedor {formatBs(line.unitPriceBs)}</span>
                    <strong>Cliente {formatBs(line.saleUnitPriceBs ?? 0)}</strong>
                  </div>
                </article>
              ))}
              {supplierCatalogRows.length > supplierCatalogPreviewRows.length ? <p className="suppliers-hint">Mostrando {supplierCatalogPreviewRows.length} de {supplierCatalogRows.length} items registrados.</p> : null}
              {supplierCatalogRows.length === 0 ? <p className="status">Aún no registraste items de proveedores.</p> : null}
            </div>
            <div className="supplier-price-lists">
              <h4>Listas registradas</h4>
              {quotes.map((quote) => (
                <article key={quote.id} className="supplier-price-list-card">
                  <div>
                    <strong>{quote.title || quote.quoteCode}</strong>
                    <span>{quote.supplierName} · {quote.items.length} item(s)</span>
                    <small>{quote.quoteCode} · {formatDate(quote.validFrom)} - {formatDate(quote.validUntil)}</small>
                  </div>
                  <div>
                    <span>Total proveedor</span>
                    <strong>{formatBs(quote?.totals?.totalBs ?? 0)}</strong>
                  </div>
                </article>
              ))}
              {quotes.length === 0 ? <p className="status">Sin listas de precios registradas.</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {activeView === 'prestamos' ? (
        <div className="suppliers-loans-full">
          <section className="suppliers-card suppliers-loans-full">
            <div className="suppliers-card-head suppliers-loans-head">
              <div>
                <span>Control de pago</span>
                <h3>Solicitudes registradas</h3>
                <p>Costo proveedor {formatBs(requestTotals.totalCostBs)} · venta ref. {formatBs(requestTotals.totalSaleBs)}</p>
              </div>
              <button type="button" className="primary-button" onClick={() => setShowLoanForm(true)}>+ Registrar pedido</button>
            </div>
            <div className="supplier-loan-filters">
              <label className="supplier-loan-filter-search">
                Buscar
                <input className="suppliers-search" placeholder="Proveedor, contrato, referencia, item..." value={loanSearch} onChange={(event) => setLoanSearch(event.target.value)} />
              </label>
              <label>Proveedor<select value={loanSupplierFilter} onChange={(event) => setLoanSupplierFilter(event.target.value)}><option value="all">Todos</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>Estado<select value={loanStatusFilter} onChange={(event) => setLoanStatusFilter(event.target.value)}><option value="all">Todos</option>{loanStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
              <label>Desde<input type="date" value={loanDateFrom} onChange={(event) => setLoanDateFrom(event.target.value)} /></label>
              <label>Hasta<input type="date" value={loanDateTo} onChange={(event) => setLoanDateTo(event.target.value)} /></label>
            </div>
            <div className="suppliers-actions supplier-loan-filter-actions">
              <span className="suppliers-hint">{filteredLoans.length} de {loans.length} solicitud(es) - costo {formatBs(filteredLoanTotals.totalCostBs)} - venta ref. {formatBs(filteredLoanTotals.totalSaleBs)}</span>
              <button type="button" className="ghost-button" onClick={clearLoanFilters}>Limpiar filtros</button>
            </div>
            <div className="suppliers-table-wrap">
              <table className="suppliers-table"><thead><tr><th>Codigo</th><th>Proveedor</th><th>Referencia</th><th>Fecha</th><th>A pagar</th><th>Venta ref.</th><th>Estado</th><th></th></tr></thead><tbody>
                {filteredLoans.map((loan) => (
                  <tr key={loan.id}>
                    <td>{loan.loanCode}</td><td>{loan.supplierName}</td><td>{getSupplierLoanReferenceLabel(loan)}</td><td>{formatDate(getSupplierLoanEventDate(loan))}</td><td>{formatBs(loan?.totals?.totalBs ?? 0)}</td><td>{formatBs((loan.items ?? []).reduce((sum, line) => sum + getLineSaleTotal(line), 0))}</td><td>{loan.status}</td>
                    <td className="supplier-table-actions"><button type="button" className="link-button" onClick={() => setDocumentPreview({ title: loan.loanCode, html: createDocumentHtml(loan) })}>Documento</button><button type="button" className="link-button" onClick={() => updateLoanStatus(loan, 'devuelto')}>Devuelto</button><button type="button" className="link-button" onClick={() => updateLoanStatus(loan, 'liquidado')}>Liquidado</button></td>
                  </tr>
                ))}
                {filteredLoans.length === 0 ? <tr><td colSpan={8}>Sin solicitudes con esos filtros.</td></tr> : null}
              </tbody></table>
            </div>
          </section>
        </div>
      ) : null}

      {showLoanForm ? (
        <div className="supplier-request-modal-backdrop" onClick={() => setShowLoanForm(false)}>
          <form className="supplier-request-modal" onSubmit={submitLoan} onClick={(event) => event.stopPropagation()}>
            <header className="supplier-request-modal-head">
              <div><span className="suppliers-eyebrow">Solicitud de abastecimiento</span><h3>Registrar pedido a proveedor</h3><p>Completa los datos y registra el abastecimiento sin perder de vista la tabla.</p></div>
              <button type="button" className="ghost-button" onClick={() => setShowLoanForm(false)}>Cerrar</button>
            </header>
            <div className="supplier-request-modal-body">
              <div className="suppliers-form-grid">
                <label>Proveedor<select value={loanForm.supplierId} onChange={(event) => setLoanForm((current) => ({ ...current, supplierId: event.target.value }))} required><option value="">Seleccionar...</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
                <label>Fecha solicitada<input type="date" value={loanForm.requestDate} onChange={(event) => setLoanForm((current) => ({ ...current, requestDate: event.target.value }))} required /></label>
                <label>Fecha devolución<input type="date" value={loanForm.returnDate} onChange={(event) => setLoanForm((current) => ({ ...current, returnDate: event.target.value }))} /></label>
                <label>Evento / referencia<input value={loanForm.eventName} onChange={(event) => setLoanForm((current) => ({ ...current, eventName: event.target.value }))} /></label>
                <label className="full-width">Notas<textarea value={loanForm.notes} onChange={(event) => setLoanForm((current) => ({ ...current, notes: event.target.value }))} /></label>
              </div>
              {loanForm.supplierId ? (
                <section className="supplier-request-offers">
                  <header><div><strong>Items registrados de {selectedLoanSupplier?.name}</strong><span>{selectedLoanSupplierOffers.length} item(s) disponibles en sus listas de precios.</span></div></header>
                  {selectedLoanSupplierOffers.length > 0 ? <div className="supplier-request-offer-grid">{selectedLoanSupplierOffers.map((offer) => <button key={`${offer.supplierId}-${offer.itemName}`} type="button" onClick={() => applySupplierOfferToLoanLine(offer, 0)}><strong>{offer.itemName}</strong><span>{offer.category || 'Sin categoría'}</span><small>Proveedor {formatBs(offer.unitPriceBs)} · Cliente {formatBs(offer.saleUnitPriceBs ?? 0)}</small></button>)}</div> : <p className="suppliers-hint">Este proveedor todavía no tiene items/precios registrados. Puedes escribir el item manualmente o ir a “Items y precios”.</p>}
                </section>
              ) : null}
              <div className="supplier-lines">
                {loanLines.map((line, index) => (
                  <div key={`loan-line-${index}`} className="supplier-line-card request">
                    <label>Item faltante{selectedLoanSupplierOffers.length > 0 ? <select value={line.itemName} onChange={(event) => updateLine('loan', index, 'itemName', event.target.value)} required><option value="">Seleccionar item del proveedor...</option>{selectedLoanSupplierOffers.map((offer) => <option key={`${offer.supplierId}-${offer.itemName}-${index}`} value={offer.itemName}>{offer.itemName} · {formatBs(offer.unitPriceBs)}</option>)}</select> : <input list="inventory-item-names" placeholder="Qué necesitas cubrir" value={line.itemName} onChange={(event) => updateLine('loan', index, 'itemName', event.target.value)} required />}</label>
                    <label>Categoria<input placeholder="Categoria" value={line.category} onChange={(event) => updateLine('loan', index, 'category', event.target.value)} /></label>
                    <label>Cantidad<input type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine('loan', index, 'quantity', event.target.value)} /></label>
                    <label>Me alquila a Bs<input type="number" min="0" step="0.01" value={line.unitPriceBs} onChange={(event) => updateLine('loan', index, 'unitPriceBs', event.target.value)} /></label>
                    <label>Yo lo doy a Bs<input type="number" min="0" step="0.01" value={line.saleUnitPriceBs} onChange={(event) => updateLine('loan', index, 'saleUnitPriceBs', event.target.value)} /></label>
                    <div className="supplier-line-summary"><span>Pago {formatBs(getLineTotal(line))}</span><strong>Venta {formatBs(getLineSaleTotal(line))}</strong></div>
                    {loanLines.length > 1 ? <button type="button" className="link-button" onClick={() => setLoanLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Quitar</button> : null}
                  </div>
                ))}
              </div>
            </div>
            <footer className="supplier-request-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setLoanLines((current) => [...current, { ...EMPTY_LINE }])}>+ Agregar item</button>
              <div><button type="button" className="ghost-button" onClick={() => setShowLoanForm(false)}>Cancelar</button><button type="submit" className="primary-button">Registrar solicitud</button></div>
            </footer>
          </form>
        </div>
      ) : null}

      {selectedDirectorySupplier ? (() => {
        const stats = supplierStats.find((entry) => String(entry.supplier.id) === String(selectedDirectorySupplier.id));
        return (
          <div className="suppliers-detail-backdrop" onClick={() => setSelectedSupplierId('')}>
            <aside className="suppliers-detail-drawer" onClick={(event) => event.stopPropagation()}>
              <header className="suppliers-detail-head">
                <div>
                  <span className="suppliers-eyebrow">Ficha del proveedor</span>
                  <h3>{selectedDirectorySupplier.name}</h3>
                  <p>{selectedDirectorySupplier.contactName || 'Contacto pendiente'}</p>
                </div>
                <button type="button" className="ghost-button" onClick={() => setSelectedSupplierId('')}>Cerrar</button>
              </header>
              <div className="suppliers-detail-body">
                <div className="suppliers-detail-metrics">
                  <article><span>Listas</span><strong>{stats?.quoteCount ?? 0}</strong></article>
                  <article><span>Solicitudes</span><strong>{stats?.loanCount ?? 0}</strong></article>
                  <article><span>Por pagar</span><strong>{formatBs(stats?.pendingPaidBs ?? 0)}</strong></article>
                </div>
                <div className="suppliers-detail-grid">
                  <div className="suppliers-detail-field"><span>Contacto</span><strong>{selectedDirectorySupplier.contactName || '-'}</strong></div>
                  <div className="suppliers-detail-field"><span>Celular</span><strong>{selectedDirectorySupplier.phone || '-'}</strong></div>
                  <div className="suppliers-detail-field"><span>WhatsApp</span><strong>{selectedDirectorySupplier.whatsapp || '-'}</strong></div>
                  <div className="suppliers-detail-field"><span>Email</span><strong>{selectedDirectorySupplier.email || '-'}</strong></div>
                  <div className="suppliers-detail-field"><span>Ciudad</span><strong>{selectedDirectorySupplier.city || '-'}</strong></div>
                  <div className="suppliers-detail-field"><span>Estado</span><strong>{selectedDirectorySupplier.status === 'inactive' ? 'Inactivo' : 'Activo'}</strong></div>
                  <div className="suppliers-detail-field wide"><span>Dirección</span><strong>{selectedDirectorySupplier.address || '-'}</strong></div>
                  <div className="suppliers-detail-field wide"><span>Condiciones</span><strong>{selectedDirectorySupplier.paymentTerms || '-'}</strong></div>
                  <div className="suppliers-detail-field wide"><span>Notas</span><strong>{selectedDirectorySupplier.notes || '-'}</strong></div>
                </div>
                <div className="suppliers-detail-actions">
                  <button type="button" className="ghost-button" onClick={() => { setSelectedSupplierId(''); editSupplier(selectedDirectorySupplier); }}>Editar</button>
                  <button type="button" className="ghost-button" onClick={() => { setSelectedSupplierId(''); setQuoteForm((current) => ({ ...current, supplierId: selectedDirectorySupplier.id })); setActiveView('cotizaciones'); }}>Precios</button>
                  <button type="button" className="primary-button" onClick={() => { setSelectedSupplierId(''); setLoanForm((current) => ({ ...current, supplierId: selectedDirectorySupplier.id })); setActiveView('prestamos'); setShowLoanForm(true); }}>Solicitud</button>
                </div>
              </div>
            </aside>
          </div>
        );
      })() : null}

      <datalist id="inventory-item-names">
        {items.map((item) => <option key={item.id} value={item.name} />)}
      </datalist>

      {documentPreview ? (
        <div className="orders-modal-backdrop" onClick={() => setDocumentPreview(null)}>
          <div className="orders-modal orders-preview-modal" onClick={(event) => event.stopPropagation()}>
            <header className="orders-modal-head">
              <div>
                <h3>{documentPreview.title}</h3>
                <p>Documento operativo para coordinar la solicitud al proveedor.</p>
              </div>
              <button type="button" className="orders-modal-close" onClick={() => setDocumentPreview(null)}>x</button>
            </header>
            <div className="orders-preview-body">
              <iframe id="supplier-document-preview-frame" title={documentPreview.title} srcDoc={documentPreview.html} className="orders-document-frame" />
            </div>
            <footer className="orders-modal-foot">
              <button type="button" className="ghost-button" onClick={() => setDocumentPreview(null)}>Cerrar</button>
              <button type="button" className="primary-button" onClick={printDocumentPreview}>Imprimir / guardar PDF</button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default SuppliersSection;
