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

const getLineTotal = (line) =>
  Math.max(1, Math.trunc(Number(line.quantity ?? 1))) * Math.max(0, Number(line.unitPriceBs ?? 0));

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
        <div class="box"><strong>Fecha solicitada</strong><br />${formatDate(loan.requestDate)}</div>
        <div class="box"><strong>Fecha devolucion</strong><br />${formatDate(loan.returnDate)}</div>
        <div class="box"><strong>Operacion</strong><br />Proveedor entrega a Copetin</div>
        <div class="box"><strong>Evento / referencia</strong><br />${loan.eventName || '-'}</div>
      </div>
      <table>
        <thead><tr><th>Item</th><th>Categoria</th><th>Cantidad</th></tr></thead>
        <tbody>
          ${loan.items.map((line) => `<tr><td>${line.itemName}</td><td>${line.category || '-'}</td><td>${line.quantity}</td></tr>`).join('')}
        </tbody>
      </table>
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
  const [quoteForm, setQuoteForm] = useState(EMPTY_QUOTE);
  const [quoteLines, setQuoteLines] = useState([{ ...EMPTY_LINE }]);
  const [loanForm, setLoanForm] = useState(EMPTY_LOAN);
  const [loanLines, setLoanLines] = useState([{ ...EMPTY_LINE }]);
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

  const latestPrices = useMemo(() => {
    const map = new Map();
    quotes
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .forEach((quote) => {
        (quote.items ?? []).forEach((line) => {
          const key = `${quote.supplierId}|${normalizeText(line.itemName)}`;
          if (!map.has(key)) map.set(key, Number(line.unitPriceBs ?? 0));
        });
      });
    return map;
  }, [quotes]);

  const updateLine = (kind, index, field, value) => {
    const setter = kind === 'quote' ? setQuoteLines : setLoanLines;
    const supplierId = kind === 'quote' ? quoteForm.supplierId : loanForm.supplierId;
    setter((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const next = { ...line, [field]: value };
        if (field === 'itemName') {
          const inventoryItem = items.find((item) => normalizeText(item.name) === normalizeText(value));
          if (inventoryItem) {
            next.category = inventoryItem.category;
            const price = latestPrices.get(`${supplierId}|${normalizeText(inventoryItem.name)}`);
            if (price !== undefined) next.unitPriceBs = String(price);
          }
        }
        return next;
      }));
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
      <header className="suppliers-header">
        <div>
          <h2>Proveedores</h2>
          <p>Controla listas de precios de proveedores y solicitudes de abastecimiento con costo.</p>
        </div>
        <div className="suppliers-tabs" role="tablist" aria-label="Vistas de proveedores">
          <button type="button" className={activeView === 'proveedores' ? 'active' : ''} onClick={() => setActiveView('proveedores')}>Proveedores</button>
          <button type="button" className={activeView === 'cotizaciones' ? 'active' : ''} onClick={() => setActiveView('cotizaciones')}>Cotizaciones</button>
          <button type="button" className={activeView === 'prestamos' ? 'active' : ''} onClick={() => setActiveView('prestamos')}>Solicitudes</button>
        </div>
      </header>

      {feedback ? <p className="status success">{feedback}</p> : null}
      {error ? <p className="status error">{error}</p> : null}

      <div className="suppliers-kpi-grid">
        <article><span>Proveedores</span><strong>{suppliers.length}</strong></article>
        <article><span>Cotizaciones</span><strong>{quotes.length}</strong></article>
        <article><span>Solicitudes activas</span><strong>{loans.filter((loan) => !['devuelto', 'liquidado', 'cancelado'].includes(loan.status)).length}</strong></article>
        <article><span>Total por pagar</span><strong>{formatBs(loans.filter((loan) => loan.status !== 'cancelado').reduce((sum, loan) => sum + Number(loan?.totals?.totalBs ?? 0), 0))}</strong></article>
      </div>

      {activeView === 'proveedores' ? (
        <div className="suppliers-content-grid">
          <form className="suppliers-card suppliers-form" onSubmit={submitSupplier}>
            <h3>{editingSupplierId ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>
            <div className="suppliers-form-grid">
              <label>Nombre<input value={supplierForm.name} onChange={(event) => setSupplierForm((current) => ({ ...current, name: event.target.value }))} required /></label>
              <label>Tipo<input value="Proveedor con cobro" disabled /></label>
              <label>Contacto<input value={supplierForm.contactName} onChange={(event) => setSupplierForm((current) => ({ ...current, contactName: event.target.value }))} /></label>
              <label>Celular<input value={supplierForm.phone} onChange={(event) => setSupplierForm((current) => ({ ...current, phone: event.target.value }))} /></label>
              <label>WhatsApp<input value={supplierForm.whatsapp} onChange={(event) => setSupplierForm((current) => ({ ...current, whatsapp: event.target.value }))} /></label>
              <label>Email<input type="email" value={supplierForm.email} onChange={(event) => setSupplierForm((current) => ({ ...current, email: event.target.value }))} /></label>
              <label>Direccion<input value={supplierForm.address} onChange={(event) => setSupplierForm((current) => ({ ...current, address: event.target.value }))} /></label>
              <label>Ciudad<input value={supplierForm.city} onChange={(event) => setSupplierForm((current) => ({ ...current, city: event.target.value }))} /></label>
              <label className="full-width">Condiciones<input value={supplierForm.paymentTerms} onChange={(event) => setSupplierForm((current) => ({ ...current, paymentTerms: event.target.value }))} placeholder="Ej: pago contra entrega, pago semanal..." /></label>
              <label className="full-width">Notas<textarea value={supplierForm.notes} onChange={(event) => setSupplierForm((current) => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            <div className="suppliers-actions">
              {editingSupplierId ? <button type="button" className="ghost-button" onClick={() => { setEditingSupplierId(''); setSupplierForm(EMPTY_SUPPLIER); }}>Cancelar</button> : null}
              <button type="submit" className="primary-button">{editingSupplierId ? 'Guardar cambios' : 'Crear proveedor'}</button>
            </div>
          </form>

          <section className="suppliers-card">
            <h3>Directorio</h3>
            <div className="suppliers-list">
              {supplierStats.map(({ supplier, quoteCount, loanCount, pendingPaidBs }) => (
                <article key={supplier.id} className="supplier-row">
                  <div>
                    <strong>{supplier.name}</strong>
                    <span>Proveedor con lista de precios</span>
                    <small>{supplier.phone || supplier.whatsapp || 'Sin telefono'} · {quoteCount} cotizaciones · {loanCount} solicitudes</small>
                  </div>
                  <div className="supplier-row-money">
                    <span>Por pagar: {formatBs(pendingPaidBs)}</span>
                    <button type="button" className="link-button" onClick={() => editSupplier(supplier)}>Editar</button>
                  </div>
                </article>
              ))}
              {suppliers.length === 0 ? <p className="status">Todavia no hay proveedores.</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {activeView === 'cotizaciones' ? (
        <div className="suppliers-content-grid">
          <form className="suppliers-card suppliers-form" onSubmit={submitQuote}>
            <h3>Nueva cotizacion / lista de precios</h3>
            <div className="suppliers-form-grid">
              <label>Proveedor<select value={quoteForm.supplierId} onChange={(event) => setQuoteForm((current) => ({ ...current, supplierId: event.target.value }))} required><option value="">Seleccionar...</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>Titulo<input value={quoteForm.title} onChange={(event) => setQuoteForm((current) => ({ ...current, title: event.target.value }))} /></label>
              <label>Vigente desde<input type="date" value={quoteForm.validFrom} onChange={(event) => setQuoteForm((current) => ({ ...current, validFrom: event.target.value }))} /></label>
              <label>Vigente hasta<input type="date" value={quoteForm.validUntil} onChange={(event) => setQuoteForm((current) => ({ ...current, validUntil: event.target.value }))} /></label>
            </div>
            <div className="supplier-lines">
              {quoteLines.map((line, index) => (
                <div key={`quote-line-${index}`} className="supplier-line-row">
                  <input list="inventory-item-names" placeholder="Item" value={line.itemName} onChange={(event) => updateLine('quote', index, 'itemName', event.target.value)} required />
                  <input placeholder="Categoria" value={line.category} onChange={(event) => updateLine('quote', index, 'category', event.target.value)} />
                  <input type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine('quote', index, 'quantity', event.target.value)} />
                  <input type="number" min="0" step="0.01" value={line.unitPriceBs} onChange={(event) => updateLine('quote', index, 'unitPriceBs', event.target.value)} />
                  <strong>{formatBs(getLineTotal(line))}</strong>
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
            <h3>Cotizaciones registradas</h3>
            <div className="suppliers-table-wrap">
              <table className="suppliers-table"><thead><tr><th>Codigo</th><th>Proveedor</th><th>Items</th><th>Vigencia</th><th>Total ref.</th></tr></thead><tbody>
                {quotes.map((quote) => <tr key={quote.id}><td>{quote.quoteCode}</td><td>{quote.supplierName}</td><td>{quote.items.length}</td><td>{formatDate(quote.validFrom)} - {formatDate(quote.validUntil)}</td><td>{formatBs(quote?.totals?.totalBs ?? 0)}</td></tr>)}
                {quotes.length === 0 ? <tr><td colSpan={5}>Sin cotizaciones de proveedores.</td></tr> : null}
              </tbody></table>
            </div>
          </section>
        </div>
      ) : null}

      {activeView === 'prestamos' ? (
        <div className="suppliers-content-grid">
          <form className="suppliers-card suppliers-form" onSubmit={submitLoan}>
            <h3>Registrar solicitud a proveedor</h3>
            <div className="suppliers-form-grid">
              <label>Proveedor<select value={loanForm.supplierId} onChange={(event) => setLoanForm((current) => ({ ...current, supplierId: event.target.value }))} required><option value="">Seleccionar...</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>Fecha solicitada<input type="date" value={loanForm.requestDate} onChange={(event) => setLoanForm((current) => ({ ...current, requestDate: event.target.value }))} required /></label>
              <label>Fecha devolucion<input type="date" value={loanForm.returnDate} onChange={(event) => setLoanForm((current) => ({ ...current, returnDate: event.target.value }))} /></label>
              <label>Evento / referencia<input value={loanForm.eventName} onChange={(event) => setLoanForm((current) => ({ ...current, eventName: event.target.value }))} /></label>
              <label className="full-width">Notas<textarea value={loanForm.notes} onChange={(event) => setLoanForm((current) => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            <div className="supplier-lines">
              {loanLines.map((line, index) => (
                <div key={`loan-line-${index}`} className="supplier-line-row">
                  <input list="inventory-item-names" placeholder="Item" value={line.itemName} onChange={(event) => updateLine('loan', index, 'itemName', event.target.value)} required />
                  <input placeholder="Categoria" value={line.category} onChange={(event) => updateLine('loan', index, 'category', event.target.value)} />
                  <input type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine('loan', index, 'quantity', event.target.value)} />
                  <input type="number" min="0" step="0.01" value={line.unitPriceBs} onChange={(event) => updateLine('loan', index, 'unitPriceBs', event.target.value)} />
                  <strong>{formatBs(getLineTotal(line))}</strong>
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
            <h3>Solicitudes registradas</h3>
            <div className="suppliers-table-wrap">
              <table className="suppliers-table"><thead><tr><th>Codigo</th><th>Proveedor</th><th>Tipo</th><th>Fecha</th><th>Total interno</th><th>Estado</th><th></th></tr></thead><tbody>
                {loans.map((loan) => (
                  <tr key={loan.id}>
                    <td>{loan.loanCode}</td>
                    <td>{loan.supplierName}</td>
                    <td>Compra a proveedor</td>
                    <td>{formatDate(loan.requestDate)}</td>
                    <td>{formatBs(loan?.totals?.totalBs ?? 0)}</td>
                    <td>{loan.status}</td>
                    <td className="supplier-table-actions">
                      <button type="button" className="link-button" onClick={() => setDocumentPreview({ title: loan.loanCode, html: createDocumentHtml(loan) })}>Documento</button>
                      <button type="button" className="link-button" onClick={() => updateLoanStatus(loan, 'devuelto')}>Devuelto</button>
                      <button type="button" className="link-button" onClick={() => updateLoanStatus(loan, 'liquidado')}>Liquidado</button>
                    </td>
                  </tr>
                ))}
                {loans.length === 0 ? <tr><td colSpan={7}>Sin solicitudes registradas.</td></tr> : null}
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
