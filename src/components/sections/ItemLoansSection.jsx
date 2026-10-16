import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Eye, HandHelping, Pencil, Plus, Search, Trash2, Undo2, X } from 'lucide-react';
import { api } from '../../services/api';
import { formatDate } from '../../utils/formatters';
import './ItemLoansSection.css';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date());
const normalized = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const returned = (loan, line) => (loan.returns ?? []).filter(row => row.lineId === line.id && !row.deletedAt).reduce((sum, row) => sum + row.quantity, 0);
const totals = loan => loan.lines.reduce((sum, line) => ({ quantity: sum.quantity + line.quantity, returned: sum.returned + returned(loan, line) }), { quantity: 0, returned: 0 });
const freshLine = () => ({ id: crypto.randomUUID(), itemId: '', itemName: '', quantity: 1 });
const freshLoan = () => ({ requestId: crypto.randomUUID(), kind: 'new', personName: '', phone: '', document: '', date: today(), dueDate: '', notes: '', lines: [freshLine()] });

function ProductPicker({ items, value, onChange, disabled = false }) {
  const [query, setQuery] = useState('');
  const options = items.filter(item => item.id === value || normalized(`${item.name} ${item.sku}`).includes(normalized(query))).slice(0, 80);
  const selected = items.find(item => item.id === value);
  if (selected && !options.some(item => item.id === value)) options.unshift(selected);
  return <div className="item-loans-product-picker">
    <input aria-label="Buscar producto del inventario" placeholder="Buscar producto o SKU…" value={query} onChange={event => setQuery(event.target.value)} disabled={disabled} />
    <select aria-label="Producto del inventario" value={value} onChange={event => onChange(event.target.value)} disabled={disabled}>
      <option value="">Seleccionar producto</option>
      {options.map(item => <option key={item.id} value={item.id}>{item.name}{item.sku ? ` · ${item.sku}` : ''} · Disp. {item.availableStock}</option>)}
    </select>
  </div>;
}

export default function ItemLoansSection({ currentUser, readOnly }) {
  const [data, setData] = useState({ loans: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('pending');
  const [kind, setKind] = useState('all');
  const [draft, setDraft] = useState(null);
  const [detailId, setDetailId] = useState('');
  const [returnDraft, setReturnDraft] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const loadSerial = useRef(0);
  const userName = currentUser?.name || currentUser?.fullName || currentUser?.username || 'Inventario';
  const load = useCallback(async () => {
    const serial = ++loadSerial.current;
    try { const result = await api.inventory.itemLoans(); if (serial === loadSerial.current) { setData(result); setError(''); } }
    catch (failure) { if (serial === loadSerial.current) setError(failure.message); }
    finally { if (serial === loadSerial.current) setLoading(false); }
  }, []);
  useEffect(() => { load(); return () => { loadSerial.current += 1; }; }, [load]);
  const detail = data.loans.find(loan => loan.id === detailId);
  const visible = useMemo(() => data.loans.filter(loan => {
    const sum = totals(loan), pending = sum.quantity - sum.returned;
    return (kind === 'all' || loan.kind === kind) && (filter === 'all' || (filter === 'pending' ? pending > 0 : filter === 'returned' ? pending === 0 : pending > 0 && loan.dueDate && loan.dueDate < today()))
      && normalized(`${loan.code} ${loan.personName} ${loan.phone} ${loan.lines.map(line => line.itemName).join(' ')}`).includes(normalized(query));
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [data.loans, filter, kind, query]);
  const summary = data.loans.reduce((sum, loan) => { const amount = totals(loan); sum.pending += amount.quantity - amount.returned; sum.returned += amount.returned; if (amount.quantity > amount.returned) { sum.open += 1; if (loan.dueDate && loan.dueDate < today()) sum.overdue += 1; } return sum; }, { pending: 0, returned: 0, open: 0, overdue: 0 });
  const mutate = async (action, payload) => {
    if (readOnly || busy) return;
    setBusy(true); setError('');
    try {
      await api.inventory.itemLoans(action, { ...payload, requestId: payload.requestId || crypto.randomUUID(), userName });
      await load(); setDraft(null); setReturnDraft(null); setConfirmation(null);
      setFeedback(action === 'return' ? 'Devolución registrada e inventario actualizado.' : action === 'delete' ? 'Préstamo eliminado y movimientos de stock revertidos.' : 'Operación guardada correctamente.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const patchLine = (id, patch) => setDraft(current => ({ ...current, lines: current.lines.map(line => line.id === id ? { ...line, ...patch } : line) }));
  const beginReturn = (loan, line) => { setError(''); setReturnDraft({ requestId: crypto.randomUUID(), id: loan.id, version: loan.version, lineId: line.id, quantity: line.quantity - returned(loan, line), itemId: line.itemId || '', date: today(), note: '', itemName: line.itemName, legacy: loan.kind === 'legacy' }); };
  const modal = draft || detail || returnDraft || confirmation;
  return <section className="item-loans-workspace">
    <header className="item-loans-heading"><div><span className="item-loans-eyebrow">CONTROL DE MATERIAL PRESTADO</span><h2><HandHelping size={28} /> Préstamos de ítems</h2><p>Personas, materiales pendientes y devoluciones vinculadas al inventario.</p></div><button className="primary-button" disabled={readOnly || busy} onClick={() => { setError(''); setDraft(freshLoan()); }}><Plus size={17} /> Nuevo préstamo</button></header>
    <div className="item-loans-metrics">{[['Préstamos abiertos', summary.open], ['Unidades por devolver', summary.pending], ['Unidades devueltas', summary.returned], ['Fuera de plazo', summary.overdue]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    {!modal && error ? <p className="status error" role="alert">{error}</p> : null}
    {feedback ? <p className="status" role="status">{feedback}</p> : null}
    <div className="item-loans-card"><div className="item-loans-filters"><label className="item-loans-search"><Search size={17} /><input placeholder="Buscar persona, préstamo o material…" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Estado" value={filter} onChange={event => setFilter(event.target.value)}><option value="pending">Pendientes</option><option value="returned">Devueltos</option><option value="overdue">Fuera de plazo</option><option value="all">Todos los estados</option></select><select aria-label="Tipo de préstamo" value={kind} onChange={event => setKind(event.target.value)}><option value="all">Nuevos y antiguos</option><option value="new">Nuevos</option><option value="legacy">Antiguos</option></select><button className="ghost-button" onClick={load} disabled={busy || loading}>Actualizar</button></div>
      <div className="item-loans-table-wrap"><table><thead><tr><th>Préstamo / fecha</th><th>Persona</th><th>Materiales</th><th>Devolución prevista</th><th>Tipo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{visible.map(loan => { const sum = totals(loan), pending = sum.quantity - sum.returned; return <tr key={loan.id}><td><strong>{loan.code}</strong><small>{formatDate(loan.date)}</small></td><td><strong>{loan.personName}</strong><small>{loan.phone || 'Sin teléfono'}{loan.document ? ` · CI ${loan.document}` : ''}</small></td><td><strong>{loan.lines.length} ítem(s) · {sum.quantity} unidades</strong><small>{loan.lines.slice(0, 2).map(line => `${line.itemName} (${line.quantity})`).join(' · ')}{loan.lines.length > 2 ? '…' : ''}</small></td><td>{loan.dueDate ? formatDate(loan.dueDate) : 'Por coordinar'}</td><td><span className={`item-loans-badge ${loan.kind}`}>{loan.kind === 'new' ? 'Nuevo' : 'Antiguo'}</span></td><td><strong>{pending ? `${pending} por devolver` : 'Devuelto'}</strong><small>{sum.returned} de {sum.quantity} devueltas</small></td><td><div className="item-loans-actions"><button className="ghost-button" title="Ver detalle y devoluciones" aria-label={`Ver ${loan.code}`} onClick={() => { setError(''); setDetailId(loan.id); }}><Eye size={16} /></button>{!readOnly ? <><button className="ghost-button" title="Editar préstamo" onClick={() => { setError(''); setDraft(structuredClone(loan)); }}><Pencil size={16} /></button><button className="ghost-button item-loans-danger" title="Eliminar préstamo" onClick={() => { setError(''); setConfirmation({ loan, action: 'delete' }); }}><Trash2 size={16} /></button></> : null}</div></td></tr>; })}</tbody></table></div>
      {loading || !visible.length ? <div className="item-loans-empty"><HandHelping size={34} /><strong>{loading ? 'Cargando préstamos…' : 'No hay préstamos que coincidan con los filtros'}</strong><p>Registra material nuevo o antiguo para llevar seguimiento de quién debe devolverlo.</p></div> : <footer className="item-loans-count">{visible.length} préstamo(s)</footer>}
    </div>
    {modal ? <div className="item-loans-backdrop"><section className="item-loans-modal" role="dialog" aria-modal="true" aria-label={confirmation ? 'Confirmar operación' : draft ? 'Registro de préstamo' : returnDraft ? 'Registrar devolución' : 'Detalle del préstamo'}>
      <header><div><span className="item-loans-eyebrow">PRÉSTAMOS DE ÍTEMS</span><h3>{confirmation ? 'Confirmar operación' : draft ? (draft.id ? `Editar ${draft.code}` : 'Nuevo préstamo') : returnDraft ? 'Registrar devolución' : `${detail.code} · ${detail.personName}`}</h3></div><button className="ghost-button" aria-label="Cerrar" disabled={busy} onClick={() => { setDraft(null); setReturnDraft(null); setConfirmation(null); setDetailId(''); setError(''); }}><X size={18} /></button></header>
      <div className="item-loans-modal-body">{error ? <p className="status error" role="alert">{error}</p> : null}
        {confirmation ? <><p>{confirmation.action === 'delete' ? `Se eliminará ${confirmation.loan.code} de ${confirmation.loan.personName}. Se revertirá su efecto en stock: los pendientes nuevos regresan al inventario y los ingresos de préstamos antiguos se descuentan. Si esas unidades ya están comprometidas, el sistema bloqueará la operación.` : 'Se anulará esta devolución y se descontarán del inventario las unidades que ingresaron. El material volverá a quedar pendiente.'}</p><div className="item-loans-form-actions"><button className="ghost-button" disabled={busy} onClick={() => setConfirmation(null)}>Cancelar</button><button className="primary-button" disabled={busy} onClick={() => mutate(confirmation.action, { id: confirmation.loan.id, version: confirmation.loan.version, returnId: confirmation.returnId })}>{busy ? 'Procesando…' : 'Confirmar'}</button></div></> : draft ? <form onSubmit={event => { event.preventDefault(); mutate(draft.id ? 'update' : 'create', draft); }}>
          <div className="item-loans-form-grid"><label>Tipo de préstamo<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })} disabled={busy || draft.returns?.some(row => !row.deletedAt)}><option value="new">Nuevo · descuenta stock</option><option value="legacy">Antiguo · no descuenta al registrar</option></select></label><label>Persona que recibe<input required value={draft.personName} onChange={event => setDraft({ ...draft, personName: event.target.value })} /></label><label>Teléfono<input value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} /></label><label>CI / documento<input value={draft.document} onChange={event => setDraft({ ...draft, document: event.target.value })} /></label><label>Fecha del préstamo<input required type="date" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label><label>Devolución prevista<input type="date" min={draft.date} value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })} /></label></div>
          <p className="item-loans-explanation">{draft.kind === 'new' ? 'El material sale del stock disponible. Los contratos mostrarán a quién está prestado hasta que registres su devolución.' : 'Registro histórico: no retira stock actual. Al devolver, selecciona el producto del inventario donde ingresarán las unidades.'}</p>
          <div className="item-loans-lines-head"><h4>Material prestado</h4><button type="button" className="ghost-button" disabled={busy} onClick={() => setDraft({ ...draft, lines: [...draft.lines, freshLine()] })}><Plus size={15} /> Añadir ítem</button></div>
          {draft.lines.map((line, index) => <div className="item-loans-edit-line" key={line.id}><span className="item-loans-line-index">{index + 1}</span><div><label>{draft.kind === 'new' ? 'Producto del inventario' : 'Producto vinculado (opcional)'}</label><ProductPicker items={data.items} value={line.itemId} disabled={busy} onChange={itemId => patchLine(line.id, { itemId, itemName: data.items.find(item => item.id === itemId)?.name || line.itemName })} />{draft.kind === 'legacy' ? <label>Nombre del material<input required value={line.itemName} onChange={event => patchLine(line.id, { itemName: event.target.value })} /></label> : null}</div><label>Cantidad<input required type="number" min={1} step={1} value={line.quantity} onChange={event => patchLine(line.id, { quantity: Number(event.target.value) })} /></label><button type="button" className="ghost-button item-loans-danger" title="Quitar línea" disabled={busy || draft.lines.length < 2} onClick={() => setDraft({ ...draft, lines: draft.lines.filter(row => row.id !== line.id) })}><Trash2 size={16} /></button></div>)}
          <label>Observaciones<textarea rows={3} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label><div className="item-loans-form-actions"><button type="button" className="ghost-button" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? 'Guardando…' : 'Guardar préstamo'}</button></div>
        </form> : returnDraft ? <form onSubmit={event => { event.preventDefault(); mutate('return', returnDraft); }}><h4>{returnDraft.itemName}</h4><p className="item-loans-explanation">{returnDraft.legacy ? 'Selecciona a qué producto pertenece este material. La devolución aumentará su inventario.' : 'Las unidades devueltas regresarán al mismo producto del préstamo.'}</p><div className="item-loans-form-grid"><label>Cantidad devuelta<input required type="number" min={1} step={1} value={returnDraft.quantity} onChange={event => setReturnDraft({ ...returnDraft, quantity: Number(event.target.value) })} /></label><label>Fecha de devolución<input required type="date" value={returnDraft.date} onChange={event => setReturnDraft({ ...returnDraft, date: event.target.value })} /></label></div>{returnDraft.legacy ? <ProductPicker items={data.items} value={returnDraft.itemId} disabled={busy} onChange={itemId => setReturnDraft({ ...returnDraft, itemId })} /> : null}<label>Observación<textarea value={returnDraft.note} onChange={event => setReturnDraft({ ...returnDraft, note: event.target.value })} /></label><div className="item-loans-form-actions"><button type="button" className="ghost-button" disabled={busy} onClick={() => setReturnDraft(null)}>Cancelar</button><button className="primary-button" disabled={busy}><ArrowDownToLine size={16} />{busy ? 'Registrando…' : 'Registrar ingreso'}</button></div></form> : detail ? <>
          <div className="item-loans-detail-meta"><span><small>Fecha del préstamo</small><strong>{formatDate(detail.date)}</strong></span><span><small>Devolución prevista</small><strong>{detail.dueDate ? formatDate(detail.dueDate) : 'Por coordinar'}</strong></span><span><small>Tipo</small><strong>{detail.kind === 'new' ? 'Nuevo · stock descontado' : 'Antiguo · solo ingresan devoluciones'}</strong></span></div><p>{detail.notes || 'Sin observaciones.'}</p>
          <div className="item-loans-table-wrap"><table><thead><tr><th>Material</th><th>Prestado</th><th>Devuelto</th><th>Pendiente</th><th>Acción</th></tr></thead><tbody>{detail.lines.map(line => <tr key={line.id}><td><strong>{line.itemName}</strong></td><td>{line.quantity}</td><td>{returned(detail, line)}</td><td><strong>{line.quantity - returned(detail, line)}</strong></td><td>{!readOnly && line.quantity > returned(detail, line) ? <button className="ghost-button" onClick={() => beginReturn(detail, line)}><ArrowDownToLine size={15} /> Devolver</button> : 'Completo'}</td></tr>)}</tbody></table></div>
          <h4>Historial de devoluciones</h4>{detail.returns?.length ? <div className="item-loans-return-history">{detail.returns.map(row => <article key={row.id} className={row.deletedAt ? 'is-voided' : ''}><div><strong>{row.quantity} unidad(es) · {detail.lines.find(line => line.id === row.lineId)?.itemName}</strong><small>{formatDate(row.date)} · Ingresó a: {data.items.find(item => item.id === row.itemId)?.name || row.itemId} · {row.createdByName || 'Inventario'}</small><small>{row.note}{row.deletedAt ? ' · ANULADA' : ''}</small></div>{!readOnly && !row.deletedAt ? <button className="ghost-button" title="Anular devolución" onClick={() => setConfirmation({ loan: detail, action: 'undo-return', returnId: row.id })}><Undo2 size={15} /> Anular</button> : null}</article>)}</div> : <p className="item-loans-explanation">Todavía no se registraron devoluciones.</p>}
        </> : null}
      </div>
    </section></div> : null}
  </section>;
}
