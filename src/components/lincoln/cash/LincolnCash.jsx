import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../../services/api';
import { buildLincolnCashLedger, cashDate, cashMoney } from '../../../../shared/lincolnCash';
import { printCashDocument } from './cashDocuments';
import '../styles/lincoln-cash.css';

const money = value => new Intl.NumberFormat('es-BO', { style: 'currency', currency: 'BOB' }).format(value || 0);
const dateLabel = value => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('es-BO') : '—';
const methodLabel = value => ({ cash: 'Efectivo', qr: 'QR', transfer: 'Transferencia' }[value] || value || 'Efectivo');

function CashOperationModal({ mode, state, rows, destinations, saving, error, onClose, onSave }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current.querySelector('input')?.focus();
    const keydown = event => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  const isFunds = mode === 'funds';
  const [form, setForm] = useState({ mode: mode === 'delivery' ? 'delivery' : 'accounting', date: cashDate(), destination: rows[0]?.destination || destinations[0] || 'CAJA CHICA', amountBs: '', method: 'cash', payerName: '', description: '', reference: '', recipientName: 'SRA. LIA', notes: '', cashBs: '', digitalBs: '' });
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const available = buildLincolnCashLedger(state, { destination: form.destination, to: form.date }).closing;
  const income = cashMoney(rows.reduce((sum, row) => sum + row.incomeBs, 0));
  const expense = cashMoney(rows.reduce((sum, row) => sum + row.expenseBs, 0));
  const title = isFunds ? 'Ingreso de fondos' : mode === 'delivery' ? 'Entregar fondos a la dueña' : 'Rendir cuentas';
  return createPortal(<div className="lincoln-cash-overlay"><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cash-dialog-title" className="lincoln-cash-dialog"><header><div><small>CAJA LINCOLN</small><h2 id="cash-dialog-title">{title}</h2></div><button type="button" aria-label="Cerrar" disabled={saving} onClick={onClose}>×</button></header><form onSubmit={event => { event.preventDefault(); onSave(isFunds ? form : { ...form, movementKeys: rows.map(row => row.key) }); }}><div className="lincoln-cash-form">
    {error ? <p role="alert" className="cash-error cash-wide">{error}</p> : null}
    <label>Fecha<input required type="date" value={form.date} onChange={e => set('date', e.target.value)} /></label>
    <label>Caja / destino<input required list="cash-destinations" value={form.destination} onChange={e => set('destination', e.target.value)} /><datalist id="cash-destinations">{destinations.map(value => <option key={value} value={value} />)}</datalist></label>
    {isFunds ? <><label>Monto ingresado (Bs)<input required type="number" min="0.01" step="0.01" value={form.amountBs} onChange={e => set('amountBs', e.target.value)} /></label><label>Medio<select value={form.method} onChange={e => set('method', e.target.value)}><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="qr">QR</option></select></label><label className="cash-wide">Quién entrega los fondos<input required value={form.payerName} onChange={e => set('payerName', e.target.value)} /></label><label className="cash-wide">Concepto<input required value={form.description} onChange={e => set('description', e.target.value)} placeholder="Fondo inicial, reposición de caja…" /></label><label className="cash-wide">Referencia / respaldo<input value={form.reference} onChange={e => set('reference', e.target.value)} /></label><p className="cash-wide cash-hint">Este ingreso suma al fondo y genera un recibo. No modifica los pagos de los contratos.</p></> : <>
      <div className="cash-wide cash-rendition-summary"><strong>{rows.length} movimientos seleccionados</strong><span>Ingresos: {money(income)} · Egresos: {money(expense)}</span></div>
      <label className="cash-wide">Recibido por<input required value={form.recipientName} onChange={e => set('recipientName', e.target.value)} /></label>
      {mode === 'delivery' ? <><label>Efectivo a entregar (Bs)<input type="number" min="0" step="0.01" max={Math.max(0, available.cashBs)} value={form.cashBs} onChange={e => set('cashBs', e.target.value)} /><small>Disponible: {money(available.cashBs)}</small></label><label>Digital a entregar (Bs)<input type="number" min="0" step="0.01" max={Math.max(0, available.digitalBs)} value={form.digitalBs} onChange={e => set('digitalBs', e.target.value)} /><small>Disponible: {money(available.digitalBs)}</small></label><p className="cash-wide cash-hint">La entrega descuenta dinero del fondo. Los movimientos seleccionados quedarán rendidos en el mismo documento.</p></> : <p className="cash-wide cash-hint">Los movimientos seleccionados quedarán rendidos. El dinero permanece en caja hasta registrar una entrega de fondos.</p>}
      <label className="cash-wide">Observaciones<textarea rows="3" value={form.notes} onChange={e => set('notes', e.target.value)} /></label>
    </>}
  </div><footer><button type="button" disabled={saving} onClick={onClose}>Cancelar</button><button type="submit" className="cash-primary" disabled={saving}>{saving ? 'Guardando…' : isFunds ? 'Registrar fondos' : 'Guardar y generar documento'}</button></footer></form></section></div>, document.body);
}

export default function LincolnCash({ state, revision, actor, onReload, onNewExpense, onEditExpense, onOpenEvent, onPrintReceipt }) {
  const today = cashDate();
  const [filters, setFilters] = useState({ from: `${today.slice(0, 7)}-01`, to: today, destination: '', eventId: '', status: 'all', query: '' });
  const [tab, setTab] = useState('movements');
  const [selected, setSelected] = useState(new Set());
  const [modal, setModal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const ledger = useMemo(() => buildLincolnCashLedger(state, filters), [state, filters]);
  const destinations = [...new Set([...(state.settings?.paymentDestinations || []), ...state.incomeEntries.map(row => row.destination), ...state.expenseEntries.map(row => row.destination)].filter(Boolean))];
  const rows = ledger.rows.filter(row => tab === 'income' ? row.direction === 'income' : tab === 'expense' ? row.direction === 'expense' : true);
  const pending = rows.filter(row => !row.cashRenditionId);
  const selectedRows = pending.filter(row => selected.has(row.key));
  const history = (state.cashRenditions || []).filter(row => (!filters.from || row.date >= filters.from) && (!filters.to || row.date <= filters.to) && (!filters.destination || row.destination === filters.destination) && (!filters.eventId || row.movements.some(movement => movement.eventId === filters.eventId)) && (!filters.query || `${row.code} ${row.recipientName} ${row.notes} ${row.movements.map(movement => movement.description || '').join(' ')}`.toLocaleLowerCase('es').includes(filters.query.toLocaleLowerCase('es')))).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const filter = (key, value) => { setFilters(current => ({ ...current, [key]: value })); setSelected(new Set()); };
  const open = mode => { setError(''); setModal(mode); };
  const toggle = key => setSelected(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const documentFor = row => { if (row.receiptId) onPrintReceipt(row.receiptId); else printCashDocument(row); };
  const save = async form => {
    setSaving(true); setError('');
    try {
      const result = modal === 'funds' ? await api.lincoln.createCashFunds({ funds: form, revision, actor }) : await api.lincoln.createCashRendition({ rendition: form, revision, actor });
      await onReload(); setSelected(new Set()); setModal('');
      if (result.rendition) { setTab('history'); }
      else setTab('movements');
    } catch (failure) { setError(failure.message || 'No se pudo guardar.'); if (failure.status === 409 || failure.code === 'LINCOLN_REVISION_CONFLICT') await onReload(); }
    finally { setSaving(false); }
  };
  const rangeInvalid = filters.from && filters.to && filters.from > filters.to;
  return <div className="lincoln-content lincoln-cash-workspace">
    <header className="cash-page-head"><div><small>CONTROL DE FONDOS</small><h2>Caja Lincoln</h2><p>Ingresos, egresos y rendiciones con su respaldo.</p></div><div className="cash-page-actions"><button type="button" onClick={() => open('funds')}>+ Ingreso de fondos</button><button type="button" onClick={onNewExpense}>+ Nuevo egreso</button><button type="button" className="cash-primary" onClick={() => open('delivery')}>Entregar fondos</button></div></header>
    <section className="cash-kpis"><article><span>Ingresos del rango</span><strong>{money(ledger.incomeBs)}</strong></article><article><span>Egresos del rango</span><strong>{money(ledger.expenseBs)}</strong></article><article><span>Fondo efectivo</span><strong>{money(ledger.closing.cashBs)}</strong><small>Acumulado al {dateLabel(filters.to || today)}</small></article><article><span>Fondo digital</span><strong>{money(ledger.closing.digitalBs)}</strong><small>Acumulado al {dateLabel(filters.to || today)}</small></article></section>
    <article className="cash-panel"><div className="cash-filters"><label>Desde<input aria-label="Desde" type="date" value={filters.from} onChange={e => filter('from', e.target.value)} /></label><label>Hasta<input aria-label="Hasta" type="date" value={filters.to} onChange={e => filter('to', e.target.value)} /></label><label>Caja / destino<select value={filters.destination} onChange={e => filter('destination', e.target.value)}><option value="">Todas las cajas</option>{destinations.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Evento<select value={filters.eventId} onChange={e => filter('eventId', e.target.value)}><option value="">Todos los eventos</option>{state.events.map(row => <option key={row.id} value={row.id}>{row.code} · {row.clientName}</option>)}</select></label><label>Estado<select value={filters.status} onChange={e => filter('status', e.target.value)}><option value="all">Todos</option><option value="pending">Pendiente de rendir</option><option value="rendered">Rendido</option></select></label><label className="cash-search">Buscar<input placeholder="Recibo, concepto o cliente…" value={filters.query} onChange={e => filter('query', e.target.value)} /></label><button type="button" onClick={() => { setFilters({ from: '', to: today, destination: '', eventId: '', status: 'all', query: '' }); setSelected(new Set()); }}>Todo hasta hoy</button></div>
    {rangeInvalid ? <p role="alert" className="cash-error">La fecha inicial debe ser anterior o igual a la fecha final.</p> : null}
    <div className="cash-tabs" role="tablist">{[['movements', 'Movimientos'], ['income', 'Ingresos'], ['expense', 'Egresos'], ['history', 'Histórico de rendiciones']].map(([value, label]) => <button type="button" role="tab" aria-selected={tab === value} key={value} className={tab === value ? 'is-active' : ''} onClick={() => { setTab(value); setSelected(new Set()); }}>{label}</button>)}</div>
    {tab === 'history' ? <><p className="cash-context">Las rendiciones conservan los movimientos y documentos entregados. Usa Ingresos y Egresos para consultar cada comprobante.</p>{history.length ? <div className="cash-table-wrap"><table className="cash-table"><thead><tr><th>Fecha / documento</th><th>Tipo / recibido por</th><th>Caja</th><th>Ingresos rendidos</th><th>Egresos rendidos</th><th>Fondos entregados</th><th>Documento</th></tr></thead><tbody>{history.map(row => <tr key={row.id}><td>{dateLabel(row.date)}<small>{row.code}</small></td><td>{row.mode === 'delivery' ? 'Entrega de fondos' : 'Rendición de cuentas'}<small>{row.recipientName}</small></td><td>{row.destination}</td><td>{money(row.incomeBs)}</td><td>{money(row.expenseBs)}</td><td>{money(row.deliveredCashBs + row.deliveredDigitalBs)}<small>{row.movements.length} movimientos</small></td><td><button type="button" onClick={() => printCashDocument(row, true)}>Ver / imprimir</button></td></tr>)}</tbody></table></div> : <div className="cash-empty"><strong>No hay rendiciones en este rango</strong><p>Selecciona movimientos para rendir cuentas o registra una entrega de fondos.</p></div>}</> : <>
    <div className="cash-selection"><span>{rows.length} movimientos · <b>{selectedRows.length} seleccionados</b></span><div><span className="cash-state rendered">Rendido</span><span className="cash-state">Pendiente</span><button type="button" disabled={!selectedRows.length || rangeInvalid} onClick={() => open('accounting')}>Rendir seleccionados</button></div></div>
    <p className="cash-context">Los fondos acumulan todos los ingresos y egresos de la caja elegida hasta la fecha final, incluidos los anteriores al rango. Buscar, filtrar por evento o estado no altera ese saldo.</p>
    <div className="cash-table-wrap"><table className="cash-table cash-movements-table"><thead><tr><th><input type="checkbox" aria-label="Seleccionar pendientes visibles" checked={pending.length > 0 && selectedRows.length === pending.length} onChange={e => setSelected(new Set(e.target.checked ? pending.map(row => row.key) : []))} /></th><th>Fecha / documento</th><th>Detalle / evento</th><th>Medio / caja</th><th>Ingresos</th><th>Egresos</th><th>Fondo efectivo</th><th>Fondo digital</th><th>Estado</th></tr></thead><tbody><tr className="cash-opening"><td colSpan="6"><strong>Saldo anterior al rango</strong><small>Es un fondo acumulado, no un ingreso del período.</small></td><td>{money(ledger.opening.cashBs)}</td><td>{money(ledger.opening.digitalBs)}</td><td>—</td></tr>{rows.map(row => <tr key={row.key} className={row.cashRenditionId ? 'cash-rendered' : ''}><td><input type="checkbox" aria-label={`Seleccionar ${row.receiptCode || row.code}`} disabled={!!row.cashRenditionId} checked={selected.has(row.key)} onChange={() => toggle(row.key)} /></td><td>{dateLabel(row.date)}<button type="button" className="cash-document-link" onClick={() => documentFor(row)}>{row.receiptCode || row.code}</button></td><td><strong>{row.description || row.category}</strong><small>{row.eventId ? <button type="button" className="cash-document-link" onClick={() => onOpenEvent(row.eventId)}>{row.eventCode}</button> : row.category || 'Movimiento general'}{row.supplierName ? ` · ${row.supplierName}` : ''}</small>{row.direction === 'expense' && !row.paymentId && !row.cashRenditionId && row.cashOperation !== 'fund_delivery' ? <button type="button" className="cash-document-link" onClick={() => onEditExpense(row)}>Editar egreso</button> : null}</td><td>{methodLabel(row.method)}<small>{row.destination}</small></td><td className="cash-income">{row.incomeBs ? money(row.incomeBs) : '—'}</td><td className="cash-expense">{row.expenseBs ? money(row.expenseBs) : '—'}</td><td className="cash-balance">{money(row.cashBalanceBs)}</td><td className="cash-balance">{money(row.digitalBalanceBs)}</td><td><span className={`cash-state ${row.cashRenditionId ? 'rendered' : ''}`}>{row.cashRenditionId ? 'Rendido' : 'Pendiente'}</span>{row.cashRenditionId ? <button type="button" className="cash-document-link" onClick={() => { const doc = state.cashRenditions.find(item => item.id === row.cashRenditionId); if (doc) printCashDocument(doc, true); }}>{row.cashRenditionCode}</button> : null}</td></tr>)}</tbody><tfoot><tr><td colSpan="4">Totales del filtro / fondos al cierre</td><td>{money(ledger.incomeBs)}</td><td>{money(ledger.expenseBs)}</td><td>{money(ledger.closing.cashBs)}</td><td>{money(ledger.closing.digitalBs)}</td><td /></tr></tfoot></table></div>{!rows.length ? <div className="cash-empty"><strong>No hay movimientos en este rango</strong><p>Ajusta las fechas o registra un ingreso de fondos.</p></div> : null}
    </>}
    </article>{modal ? <CashOperationModal key={modal} mode={modal} state={state} rows={selectedRows} destinations={destinations} saving={saving} error={error} onClose={() => { if (!saving) setModal(''); }} onSave={save} /> : null}
  </div>;
}
