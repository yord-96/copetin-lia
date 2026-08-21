import { useMemo, useState } from 'react';

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
  const suppliers = useMemo(() => supplierBundle?.suppliers ?? [], [supplierBundle?.suppliers]);
  const quotes = useMemo(() => supplierBundle?.quotes ?? [], [supplierBundle?.quotes]);
  const loans = useMemo(() => supplierBundle?.loans ?? [], [supplierBundle?.loans]);

  const [activeView, setActiveView] = useState('proveedores');
  const [supplierForm, setSupplierForm] = useState(EMPTY_SUPPLIER);
  const [editingSupplierId, setEditingSupplierId] = useState('');
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [quoteForm, setQuoteForm] = useState(EMPTY_QUOTE);
  const [quoteLines, setQuoteLines] = useState([{ ...EMPTY_LINE }]);
  const [loanForm, setLoanForm] = useState(EMPTY_LOAN);
  const [loanLines, setLoanLines] = useState([{ ...EMPTY_LINE }]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [loanSearch, setLoanSearch] = useState('');
  const [loanSupplierFilter, setLoanSupplierFilter] = useState('all');
  const [loanStatusFilter, setLoanStatusFilter] = useState('all');
  const [loanDateFrom, setLoanDateFrom] = useState('');
  const [loanDateTo, setLoanDateTo] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [documentPreview, setDocumentPreview] = useState(null);

  const selectedQuoteSupplier = suppliers.find((supplier) => supplier.id === quoteForm.supplierId) ?? null;
  const selectedLoanSupplier = suppliers.find((supplier) => supplier.id === loanForm.supplierId) ?? null;

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
      } else {
        await onCreateSupplier?.(supplierForm);
        setFeedback('Proveedor creado.');
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
      setFeedback('Solicitud registrada.');
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
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la solicitud.');
    }
  };

  return (
    <section className="panel suppliers-panel">
      <style>{`
        .suppliers-panel { --sup-navy:#173a70; --sup-orange:#e74b00; --sup-border:#e6e9ef; --sup-soft:#f7f9fc; }
        .suppliers-directory-shell { display:grid; gap:14px; }
        .suppliers-directory-toolbar,.suppliers-directory-card,.suppliers-editor-card { background:#fff; border:1px solid var(--sup-border); border-radius:16px; }
        .suppliers-directory-toolbar { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:18px 20px; }
        .suppliers-directory-toolbar h3,.suppliers-editor-head h3 { margin:3px 0 4px; color:#14213d; }
        .suppliers-directory-toolbar p,.suppliers-editor-head p { margin:0; color:#667085; font-size:13px; }
        .suppliers-eyebrow { color:var(--sup-orange); font-size:11px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
        .suppliers-directory-actions { display:flex; align-items:end; gap:10px; min-width:min(520px,48%); }
        .suppliers-search-field { flex:1; display:grid; gap:5px; color:#667085; font-size:11px; font-weight:700; }
        .suppliers-search-field input { width:100%; }
        .suppliers-new-button { white-space:nowrap; min-height:38px; }
        .suppliers-editor-card { padding:18px 20px; box-shadow:0 10px 28px rgba(23,58,112,.08); }
        .suppliers-editor-head { display:flex; justify-content:space-between; gap:20px; align-items:start; margin-bottom:14px; }
        .suppliers-form-grid-compact { grid-template-columns:repeat(3,minmax(0,1fr)); }
        .suppliers-directory-summary { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:12px 16px; border-bottom:1px solid var(--sup-border); background:var(--sup-soft); border-radius:16px 16px 0 0; }
        .suppliers-directory-summary span { color:var(--sup-navy); font-weight:800; }
        .suppliers-directory-summary small { color:#7a8495; }
        .suppliers-directory-list { display:grid; }
        .supplier-directory-row { display:grid; grid-template-columns:46px minmax(220px,1.35fr) minmax(310px,1fr) auto; gap:16px; align-items:center; padding:14px 16px; border-bottom:1px solid #edf0f4; }
        .supplier-directory-row:last-child { border-bottom:0; }
        .supplier-directory-row:hover { background:#fbfcfe; }
        .supplier-directory-avatar { width:42px; height:42px; border-radius:12px; display:grid; place-items:center; background:#fff2eb; color:#c94108; border:1px solid #ffd8c6; font-weight:900; }
        .supplier-directory-main { min-width:0; display:grid; gap:3px; }
        .supplier-directory-name { display:flex; align-items:center; gap:8px; min-width:0; }
        .supplier-directory-name strong { color:#17233d; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .supplier-directory-main>span { color:#475467; font-size:12px; }
        .supplier-directory-main>small { color:#8b94a5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .supplier-status-pill { display:inline-flex; padding:2px 7px; border-radius:999px; background:#eaf8ef; color:#178445; font-size:10px; font-weight:800; }
        .supplier-status-pill.inactive { background:#f2f4f7; color:#667085; }
        .supplier-directory-metrics { display:grid; grid-template-columns:80px 90px minmax(120px,1fr); gap:8px; }
        .supplier-directory-metrics>div { display:grid; gap:2px; padding:7px 9px; border:1px solid #e8ebf0; border-radius:10px; background:#fafbfc; }
        .supplier-directory-metrics span { color:#7a8495; font-size:10px; text-transform:uppercase; font-weight:700; }
        .supplier-directory-metrics strong { color:#24324a; font-size:12px; }
        .supplier-directory-metrics .has-balance { background:#fff7ed; border-color:#fed7aa; }
        .supplier-directory-metrics .has-balance strong { color:#c2410c; }
        .supplier-directory-row-actions { display:flex; gap:6px; justify-content:flex-end; }
        .supplier-directory-row-actions button { min-height:34px; padding:0 11px; }
        .suppliers-empty-state { display:grid; place-items:center; gap:4px; min-height:150px; color:#667085; }
        .suppliers-empty-state strong { color:#344054; }
        @media (max-width:1200px) {
          .supplier-directory-row { grid-template-columns:42px 1fr auto; }
          .supplier-directory-metrics { grid-column:2 / 4; }
          .suppliers-directory-actions { min-width:420px; }
        }
        @media (max-width:780px) {
          .suppliers-directory-toolbar,.suppliers-editor-head { align-items:stretch; flex-direction:column; }
          .suppliers-directory-actions { min-width:0; width:100%; flex-direction:column; align-items:stretch; }
          .suppliers-form-grid-compact { grid-template-columns:1fr; }
          .supplier-directory-row { grid-template-columns:42px 1fr; }
          .supplier-directory-metrics,.supplier-directory-row-actions { grid-column:1 / -1; }
          .supplier-directory-metrics { grid-template-columns:repeat(3,1fr); }
          .supplier-directory-row-actions { justify-content:stretch; }
          .supplier-directory-row-actions button { flex:1; }
        }
      `}</style>
      <header className="suppliers-header suppliers-hero">
        <div className="suppliers-hero-copy">
          <span>Abastecimiento externo</span>
          <h2>Proveedores</h2>
          <p>Registra quién te alquila, qué items ofrece, cuánto te cobra y cuánto debes pagar cuando cubres faltantes de una orden.</p>
        </div>
        <div className="suppliers-tabs" role="tablist" aria-label="Vistas de proveedores">
          <button type="button" className={activeView === 'proveedores' ? 'active' : ''} onClick={() => setActiveView('proveedores')}>Directorio</button>
          <button type="button" className={activeView === 'cotizaciones' ? 'active' : ''} onClick={() => setActiveView('cotizaciones')}>Items y precios</button>
          <button type="button" className={activeView === 'prestamos' ? 'active' : ''} onClick={() => setActiveView('prestamos')}>Solicitudes</button>
        </div>
      </header>

      {feedback ? <p className="status success">{feedback}</p> : null}
      {error ? <p className="status error">{error}</p> : null}

      <div className="suppliers-kpi-grid">
        <article><span>Proveedores activos</span><strong>{suppliers.length}</strong><small>Contactos y condiciones</small></article>
        <article><span>Items con precio</span><strong>{supplierCatalogRows.length}</strong><small>Registrados en listas</small></article>
        <article><span>Solicitudes activas</span><strong>{requestTotals.activeCount}</strong><small>Pendientes de cierre</small></article>
        <article><span>Total por pagar</span><strong>{formatBs(requestTotals.totalCostBs)}</strong><small>Margen ref. {formatBs(requestTotals.marginBs)}</small></article>
      </div>

      {activeView === 'proveedores' ? (
        <div className="suppliers-directory-shell">
          <section className="suppliers-directory-toolbar">
            <div>
              <span className="suppliers-eyebrow">Directorio operativo</span>
              <h3>Proveedores activos</h3>
              <p>Consulta contactos, listas de precios, solicitudes y saldos desde un solo lugar.</p>
            </div>
            <div className="suppliers-directory-actions">
              <label className="suppliers-search-field">
                <span>Buscar</span>
                <input
                  className="suppliers-search"
                  placeholder="Nombre, contacto, celular..."
                  value={supplierSearch}
                  onChange={(event) => setSupplierSearch(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="primary-button suppliers-new-button"
                onClick={() => {
                  setEditingSupplierId('');
                  setSupplierForm(EMPTY_SUPPLIER);
                  setShowSupplierForm(true);
                }}
              >
                + Nuevo proveedor
              </button>
            </div>
          </section>

          {showSupplierForm ? (
            <form className="suppliers-editor-card" onSubmit={submitSupplier}>
              <div className="suppliers-editor-head">
                <div>
                  <span className="suppliers-eyebrow">{editingSupplierId ? 'Edición' : 'Nuevo registro'}</span>
                  <h3>{editingSupplierId ? 'Editar proveedor' : 'Registrar proveedor'}</h3>
                  <p>Completa solo los datos disponibles. Las condiciones y notas quedan como referencia operativa.</p>
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

          <section className="suppliers-directory-card">
            <div className="suppliers-directory-summary">
              <span>{visibleSupplierStats.length} proveedor(es)</span>
              <small>Ordenados por nombre · datos comerciales y operativos</small>
            </div>
            <div className="suppliers-directory-list">
              {visibleSupplierStats.map(({ supplier, quoteCount, loanCount, pendingPaidBs }) => {
                const contact = supplier.contactName || supplier.phone || supplier.whatsapp || 'Contacto pendiente';
                const initials = String(supplier.name ?? 'P')
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join('')
                  .toUpperCase();
                return (
                  <article key={supplier.id} className="supplier-directory-row">
                    <div className="supplier-directory-avatar">{initials || 'P'}</div>
                    <div className="supplier-directory-main">
                      <div className="supplier-directory-name">
                        <strong>{supplier.name}</strong>
                        <span className={supplier.status === 'inactive' ? 'supplier-status-pill inactive' : 'supplier-status-pill'}>{supplier.status === 'inactive' ? 'Inactivo' : 'Activo'}</span>
                      </div>
                      <span>{contact}{supplier.city ? ` · ${supplier.city}` : ''}</span>
                      <small>{supplier.email || supplier.address || 'Sin datos adicionales'}</small>
                    </div>
                    <div className="supplier-directory-metrics">
                      <div><span>Listas</span><strong>{quoteCount}</strong></div>
                      <div><span>Solicitudes</span><strong>{loanCount}</strong></div>
                      <div className={pendingPaidBs > 0 ? 'has-balance' : ''}><span>Por pagar</span><strong>{formatBs(pendingPaidBs)}</strong></div>
                    </div>
                    <div className="supplier-directory-row-actions">
                      <button type="button" className="ghost-button" onClick={() => editSupplier(supplier)}>Editar</button>
                      <button type="button" className="ghost-button" onClick={() => { setQuoteForm((current) => ({ ...current, supplierId: supplier.id })); setActiveView('cotizaciones'); }}>Precios</button>
                      <button type="button" className="primary-button" onClick={() => { setLoanForm((current) => ({ ...current, supplierId: supplier.id })); setActiveView('prestamos'); }}>Solicitud</button>
                    </div>
                  </article>
                );
              })}
              {visibleSupplierStats.length === 0 ? (
                <div className="suppliers-empty-state">
                  <strong>No encontramos proveedores.</strong>
                  <span>Prueba con otro término o registra un nuevo proveedor.</span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
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
        <div className="suppliers-content-grid">
          <form className="suppliers-card suppliers-form" onSubmit={submitLoan}>
            <div className="suppliers-card-head">
              <div>
                <span>03 · Solicitud de abastecimiento</span>
                <h3>Registrar pedido a proveedor</h3>
                <p>Usa esto cuando una orden necesita items que no tienes disponibles. La solicitud calcula cuánto pagarás.</p>
              </div>
            </div>
            <div className="suppliers-form-grid">
              <label>Proveedor<select value={loanForm.supplierId} onChange={(event) => setLoanForm((current) => ({ ...current, supplierId: event.target.value }))} required><option value="">Seleccionar...</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>Fecha solicitada<input type="date" value={loanForm.requestDate} onChange={(event) => setLoanForm((current) => ({ ...current, requestDate: event.target.value }))} required /></label>
              <label>Fecha devolucion<input type="date" value={loanForm.returnDate} onChange={(event) => setLoanForm((current) => ({ ...current, returnDate: event.target.value }))} /></label>
              <label>Evento / referencia<input value={loanForm.eventName} onChange={(event) => setLoanForm((current) => ({ ...current, eventName: event.target.value }))} /></label>
              <label className="full-width">Notas<textarea value={loanForm.notes} onChange={(event) => setLoanForm((current) => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            {loanForm.supplierId ? (
              <section className="supplier-request-offers">
                <header>
                  <div>
                    <strong>Items registrados de {selectedLoanSupplier?.name}</strong>
                    <span>{selectedLoanSupplierOffers.length} item(s) disponibles en sus listas de precios.</span>
                  </div>
                </header>
                {selectedLoanSupplierOffers.length > 0 ? (
                  <div className="supplier-request-offer-grid">
                    {selectedLoanSupplierOffers.map((offer) => (
                      <button key={`${offer.supplierId}-${offer.itemName}`} type="button" onClick={() => applySupplierOfferToLoanLine(offer, 0)}>
                        <strong>{offer.itemName}</strong>
                        <span>{offer.category || 'Sin categoría'}</span>
                        <small>Proveedor {formatBs(offer.unitPriceBs)} · Cliente {formatBs(offer.saleUnitPriceBs ?? 0)}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="suppliers-hint">Este proveedor todavía no tiene items/precios registrados. Puedes escribir el item manualmente o ir a “Items y precios”.</p>
                )}
              </section>
            ) : null}
            <div className="supplier-lines">
              {loanLines.map((line, index) => (
                <div key={`loan-line-${index}`} className="supplier-line-card request">
                  <label>
                    Item faltante
                    {selectedLoanSupplierOffers.length > 0 ? (
                      <select value={line.itemName} onChange={(event) => updateLine('loan', index, 'itemName', event.target.value)} required>
                        <option value="">Seleccionar item del proveedor...</option>
                        {selectedLoanSupplierOffers.map((offer) => (
                          <option key={`${offer.supplierId}-${offer.itemName}-${index}`} value={offer.itemName}>
                            {offer.itemName} · {formatBs(offer.unitPriceBs)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input list="inventory-item-names" placeholder="Qué necesitas cubrir" value={line.itemName} onChange={(event) => updateLine('loan', index, 'itemName', event.target.value)} required />
                    )}
                  </label>
                  <label>Categoria<input placeholder="Categoria" value={line.category} onChange={(event) => updateLine('loan', index, 'category', event.target.value)} /></label>
                  <label>Cantidad<input type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine('loan', index, 'quantity', event.target.value)} /></label>
                  <label>Me alquila a Bs<input type="number" min="0" step="0.01" value={line.unitPriceBs} onChange={(event) => updateLine('loan', index, 'unitPriceBs', event.target.value)} /></label>
                  <label>Yo lo doy a Bs<input type="number" min="0" step="0.01" value={line.saleUnitPriceBs} onChange={(event) => updateLine('loan', index, 'saleUnitPriceBs', event.target.value)} /></label>
                  <div className="supplier-line-summary">
                    <span>Pago {formatBs(getLineTotal(line))}</span>
                    <strong>Venta {formatBs(getLineSaleTotal(line))}</strong>
                  </div>
                  {loanLines.length > 1 ? <button type="button" className="link-button" onClick={() => setLoanLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Quitar</button> : null}
                </div>
              ))}
            </div>
            <div className="suppliers-actions">
              <button type="button" className="ghost-button" onClick={() => setLoanLines((current) => [...current, { ...EMPTY_LINE }])}>Agregar item</button>
              <button type="submit" className="primary-button">Registrar solicitud</button>
            </div>
            {selectedLoanSupplier ? <p className="suppliers-hint">Se generara la solicitud de compra para {selectedLoanSupplier.name}.</p> : null}
          </form>

          <section className="suppliers-card">
            <div className="suppliers-card-head inline">
              <div>
                <span>Control de pago</span>
                <h3>Solicitudes registradas</h3>
                <p>Costo proveedor {formatBs(requestTotals.totalCostBs)} · venta ref. {formatBs(requestTotals.totalSaleBs)}</p>
              </div>
            </div>
            <div className="supplier-loan-filters">
              <label className="supplier-loan-filter-search">
                Buscar
                <input
                  className="suppliers-search"
                  placeholder="Proveedor, contrato, referencia, item..."
                  value={loanSearch}
                  onChange={(event) => setLoanSearch(event.target.value)}
                />
              </label>
              <label>
                Proveedor
                <select value={loanSupplierFilter} onChange={(event) => setLoanSupplierFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Estado
                <select value={loanStatusFilter} onChange={(event) => setLoanStatusFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  {loanStatusOptions.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label>
                Desde
                <input type="date" value={loanDateFrom} onChange={(event) => setLoanDateFrom(event.target.value)} />
              </label>
              <label>
                Hasta
                <input type="date" value={loanDateTo} onChange={(event) => setLoanDateTo(event.target.value)} />
              </label>
            </div>
            <div className="suppliers-actions supplier-loan-filter-actions">
              <span className="suppliers-hint">
                {filteredLoans.length} de {loans.length} solicitud(es) - costo {formatBs(filteredLoanTotals.totalCostBs)} - venta ref. {formatBs(filteredLoanTotals.totalSaleBs)}
              </span>
              <button type="button" className="ghost-button" onClick={clearLoanFilters}>Limpiar filtros</button>
            </div>
            <div className="suppliers-table-wrap">
              <table className="suppliers-table"><thead><tr><th>Codigo</th><th>Proveedor</th><th>Referencia</th><th>Fecha</th><th>A pagar</th><th>Venta ref.</th><th>Estado</th><th></th></tr></thead><tbody>
                {filteredLoans.map((loan) => (
                  <tr key={loan.id}>
                    <td>{loan.loanCode}</td>
                    <td>{loan.supplierName}</td>
                    <td>{getSupplierLoanReferenceLabel(loan)}</td>
                    <td>{formatDate(getSupplierLoanEventDate(loan))}</td>
                    <td>{formatBs(loan?.totals?.totalBs ?? 0)}</td>
                    <td>{formatBs((loan.items ?? []).reduce((sum, line) => sum + getLineSaleTotal(line), 0))}</td>
                    <td>{loan.status}</td>
                    <td className="supplier-table-actions">
                      <button type="button" className="link-button" onClick={() => setDocumentPreview({ title: loan.loanCode, html: createDocumentHtml(loan) })}>Documento</button>
                      <button type="button" className="link-button" onClick={() => updateLoanStatus(loan, 'devuelto')}>Devuelto</button>
                      <button type="button" className="link-button" onClick={() => updateLoanStatus(loan, 'liquidado')}>Liquidado</button>
                    </td>
                  </tr>
                ))}
                {filteredLoans.length === 0 ? <tr><td colSpan={8}>Sin solicitudes con esos filtros.</td></tr> : null}
              </tbody></table>
            </div>
          </section>
        </div>
      ) : null}

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
