import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/api';
import { canManageAccounting } from '../../utils/permissions.js';
import { buildVipContractsReport } from '../../utils/vipContractsReport.js';

const bs = value => `Bs ${Number(value || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = value => value ? String(value).slice(0, 10).split('-').reverse().join('/') : '-';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const download = (blob, name) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };

export default function VipAccountWorkspace({ clientId, enabled, currentUser }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [limit, setLimit] = useState(25);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [pdf, setPdf] = useState(null);
  const [exporting, setExporting] = useState(false);
  const requestId = useRef(0);
  const operationId = useRef('');
  const canManage = canManageAccounting(currentUser);
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    window.addEventListener('copetin:vip-prepaid-updated', reload);
    return () => window.removeEventListener('copetin:vip-prepaid-updated', reload);
  }, [reload]);
  useEffect(() => {
    if (!enabled || !clientId) return;
    const id = ++requestId.current;
    let closed = false;
    setLoading(true); setError(''); setData(null);
    api.cash.getVipWorkspace(clientId).then(result => { if (!closed && id === requestId.current) setData(result); })
      .catch(error => { if (!closed) setError(error.message); }).finally(() => { if (!closed) setLoading(false); });
    return () => { closed = true; };
  }, [clientId, enabled, refresh]);
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf); }, [pdf]);
  const rows = useMemo(() => (data?.rows || []).filter(row =>
    (status === 'all' || (status === 'pending' ? row.totalPendingBs > .009 : row.totalPendingBs <= .009))
    && (!dateFrom || String(row.eventDate || '').slice(0, 10) >= dateFrom)
    && (!dateTo || String(row.eventDate || '').slice(0, 10) <= dateTo)
    && (!query || norm([row.code, row.orderCode, row.customerName, row.address, ...row.items.map(line => line.name)].join(' ')).includes(norm(query)))), [data, status, dateFrom, dateTo, query]);
  const close = () => { if (!busy) { setModal(null); setActionError(''); setPreview(null); } };
  const open = (type, row = null) => {
    operationId.current = crypto.randomUUID(); setActionError(''); setPreview(null);
    setForm({ date: today(), reason: '', reference: '', balanceBs: data.client.balanceBs, sourceIds: [], mode: 'balance', serviceBs: row?.commercialPendingBs || 0, damageBs: row?.damagePendingBs || 0 });
    setModal({ type, row, client: data.client });
  };
  const field = (key, value) => { setForm(form => ({ ...form, [key]: value })); setPreview(null); operationId.current = crypto.randomUUID(); };
  const submit = async event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setActionError('');
    try {
      if (modal.type === 'merge' && !preview) {
        setPreview(await api.cash.previewVipMerge({ clientId, sourceIds: form.sourceIds }));
        return;
      }
      await api.cash.manageVipAccount({ ...form, action: modal.type, clientId: modal.client.id, actorUserId: currentUser?.id,
        expectedBalanceBs: modal.client.balanceBs, expectedUpdatedAt: modal.client.updatedAt,
        contractId: modal.row?.id, expectedContractToken: modal.row?.token, previewToken: preview?.token,
        clientOperationId: operationId.current });
      setModal(null); setNotice(modal.type === 'merge' ? 'Fichas unificadas. Se conservaron los contratos, las direcciones y el historial.' : 'Conciliación guardada sin crear un ingreso ni egreso de caja.');
      reload();
    } catch (error) { setActionError(error.message); }
    finally { setBusy(false); }
  };
  const exportReport = async kind => {
    if (!data || exporting) return;
    setExporting(true); setError('');
    try {
      if (kind === 'pdf') {
        const blob = await api.reports.renderPdf({ html: buildVipContractsReport(data.client, rows, { dateFrom, dateTo, status }), fileName: 'contratos-vip.pdf' });
        setPdf(URL.createObjectURL(blob));
      } else {
        const { default: ExcelJS } = await import('exceljs');
        const wb = new ExcelJS.Workbook();
        const sheet = wb.addWorksheet('Contratos');
        sheet.addRow([`Cuenta VIP ${data.client.name}`, 'Saldo actual', data.client.balanceBs]);
        sheet.addRow(['Evento desde', dateFrom, 'Hasta', dateTo, 'Estado', status]);
        sheet.addRow(['Contrato', 'Orden', 'Evento', 'Ubicación', 'Logística', 'Alquiler Bs', 'Pagado alquiler Bs', 'VIP alquiler Bs', 'Daños Bs', 'Pendiente daños Bs', 'Pendiente total Bs']);
        rows.forEach(row => sheet.addRow([row.code, row.orderCode, row.eventDate, row.address, row.logisticsMode, row.totalBs, row.paidBs, row.prepaidBs, row.damageBs, row.damagePendingBs, row.totalPendingBs]));
        const items = wb.addWorksheet('Detalle');items.addRow(['Contrato', 'Día', 'Ítem o servicio', 'Cantidad', 'Importe Bs']);
        rows.forEach(row => { row.items.forEach(line => items.addRow([row.code, line.day || line.date, line.name, line.quantity, line.amountBs])); row.services.forEach(line => items.addRow([row.code, line.date, line.name, null, line.amountBs])); });
        const payments = wb.addWorksheet('Pagos y aplicaciones');payments.addRow(['Contrato', 'Fecha', 'Respaldo', 'Tipo', 'Detalle', 'Importe Bs']);
        rows.forEach(row => { row.receipts.forEach(line => payments.addRow([row.code, line.date, line.code, 'Recibo de caja', line.description, line.amountBs])); row.settlements.forEach(line => payments.addRow([row.code, line.createdAt, line.reference, line.mode === 'historical' ? 'Cancelación histórica sin caja' : 'Aplicación VIP sin caja', line.reason, line.serviceBs + line.damageBs])); });
        payments.addRow(['Los recibos y aplicaciones son respaldos. No sumar ambos como ingresos nuevos.']);
        for (const s of wb.worksheets) {
          s.views = [{ state: 'frozen', ySplit: s === sheet ? 3 : 1 }];
          s.columns.forEach((column, index) => { column.width = index === 3 || index === 4 ? 38 : 20; });
          s.eachRow(row => { row.alignment = { vertical: 'middle', wrapText: true }; row.font = { name: 'Arial', size: 11 }; row.eachCell(cell => { if (typeof cell.value === 'number') cell.numFmt = '#,##0.00'; }); });
          const header = s.getRow(s === sheet ? 3 : 1);header.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }; header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173A70' } };
        }
        download(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'contratos-cuenta-vip.xlsx');
      }
    } catch (error) { setError(error.message); }
    finally { setExporting(false); }
  };
  if (!enabled) return null;
  return <div className="vip-account-workspace">
    {notice ? <p className="vip-notice" role="status">{notice}</p> : null}
    {error ? <p className="status error" role="alert">{error} <button type="button" className="ghost-button" onClick={reload}>Reintentar</button></p> : null}
    {loading ? <p role="status">Cargando contratos y respaldos de la cuenta VIP...</p> : null}
    {data ? <>
      <div className="vip-account-toolbar"><div><h3>Contratos de {data.client.name}</h3><p>Pagos, saldo VIP y cancelaciones históricas en una sola cuenta.</p></div>
        <div className="vip-action-group"><button type="button" className="ghost-button" onClick={reload}>Actualizar</button>{canManage ? <><button type="button" className="ghost-button" onClick={() => open('merge')}>Unificar fichas{data.mergeCandidates.length ? ` (${data.mergeCandidates.length})` : ''}</button><button type="button" className="ghost-button" onClick={() => open('adjust')}>Conciliar saldo</button></> : null}</div></div>
      <div className="vip-account-stats"><article><small>Saldo actual VIP</small><strong>{bs(data.client.balanceBs)}</strong></article><article><small>Por cobrar · {data.summary.pendingCount} contratos</small><strong>{bs(data.summary.pendingBs)}</strong></article><article><small>Cobrados</small><strong>{data.summary.paidCount} contratos</strong></article><article><small>Todos los contratos</small><strong>{data.summary.contracts}</strong></article></div>
      {data.mergeCandidates.length ? <p className="vip-warning">Hay fichas con el mismo teléfono o nombre: {data.mergeCandidates.map(row => row.name).join(' · ')}. Sus contratos se incorporan al unificarlas.</p> : null}
      {Math.abs(data.summary.balanceDifferenceBs) > .009 ? <p className="vip-warning">El saldo guardado difiere en {bs(data.summary.balanceDifferenceBs)} de la suma del historial. Revisa los movimientos antes de conciliar.</p> : null}
      {data.mergedClients.length ? <p>Fichas vinculadas: {data.mergedClients.map(row => row.name).join(' · ')}.</p> : null}
      <div className="vip-contract-filters">
        <label>Buscar contrato, ítem o ubicación<input value={query} onChange={event => { setQuery(event.target.value); setLimit(25); }} placeholder="Contrato, orden, producto..." /></label>
        <label>Estado<select value={status} onChange={event => { setStatus(event.target.value); setLimit(25); }}><option value="all">Todos</option><option value="pending">Por cobrar</option><option value="paid">Cobrados</option></select></label>
        <label>Evento desde<input type="date" value={dateFrom} onChange={event => { setDateFrom(event.target.value); setLimit(25); }} /></label>
        <label>Evento hasta<input type="date" value={dateTo} onChange={event => { setDateTo(event.target.value); setLimit(25); }} /></label>
        <div className="vip-action-group"><button type="button" className="ghost-button" disabled={exporting} onClick={() => exportReport('pdf')}>Reporte de contratos</button><button type="button" className="ghost-button" disabled={exporting} onClick={() => exportReport('excel')}>Excel de contratos</button></div>
      </div>
      <p className="vip-range-note">Estas fechas filtran el evento del contrato. Incluye contratos futuros; no se descuentan automáticamente del VIP. Reportes: {rows.length} contratos del filtro.</p>
      <div className="vip-contract-table-wrap"><table className="vip-contract-table"><thead><tr><th>Contrato / evento</th><th>Ubicación / envío</th><th>Alquiler</th><th>Pagado alquiler</th><th>Aplicado VIP</th><th>Daños pendientes</th><th>Pendiente total</th><th>Detalle</th></tr></thead><tbody>
        {rows.slice(0, limit).map(row => <VipContractRow key={row.id} row={row} canManage={canManage} onSettle={() => open('settle', row)} />)}
        {!rows.length ? <tr><td colSpan="8">Sin contratos en este filtro.</td></tr> : null}
      </tbody></table></div>
      {rows.length > limit ? <button type="button" className="ghost-button" onClick={() => setLimit(value => value + 25)}>Mostrar más · {Math.min(limit, rows.length)} de {rows.length}</button> : null}
      <details className="vip-account-history"><summary>Historial de la cuenta VIP · {data.movements.length} movimientos</summary><div className="vip-contract-table-wrap"><table className="vip-contract-table"><thead><tr><th>Fecha</th><th>Movimiento / respaldo</th><th>Contrato / orden</th><th>Importe</th><th>Saldo calculado</th></tr></thead><tbody>{data.movements.map(row => <tr key={row.id}><td>{date(row.createdAt)}</td><td>{row.description}<small>{row.reference || row.cashReceiptCode} {row.nonPhysical ? '· Sin movimiento de caja' : ''}</small></td><td>{row.contractCode || row.orderCode || '-'}</td><td>{bs(row.amountBs)}</td><td>{bs(row.calculatedBalanceBs)}</td></tr>)}</tbody></table></div><p>El saldo calculado suma los movimientos por fecha, sin modificar sus registros originales. Los ajustes históricos no son depósitos de dinero.</p></details>
    </> : null}
    {modal ? <div className="vip-dialog-backdrop"><section className="vip-dialog" role="dialog" aria-modal="true" aria-labelledby="vip-dialog-title"><form onSubmit={submit}>
      <h3 id="vip-dialog-title">{modal.type === 'merge' ? 'Unificar fichas de la cliente VIP' : modal.type === 'adjust' ? 'Conciliar el saldo actual VIP' : `Conciliar contrato ${modal.row.code}`}</h3>
      {modal.type === 'merge' ? <><p>Se conserva la ficha {modal.client.name}, los contratos, las direcciones y los comprobantes. Los saldos existentes se suman sin crear dinero en caja.</p>{data.mergeCandidates.map(row => <label className="vip-merge-option" key={row.id}><input type="checkbox" checked={form.sourceIds.includes(row.id)} onChange={event => field('sourceIds', event.target.checked ? [...form.sourceIds, row.id] : form.sourceIds.filter(id => id !== row.id))} />{row.name} · {row.contractCount} contratos · {bs(row.balanceBs)}</label>)}{!data.mergeCandidates.length ? <p>No hay fichas duplicadas sugeridas por teléfono o nombre.</p> : null}{preview ? <div className="vip-merge-preview"><h4>Vista previa de unificación</h4><p>{preview.sources.map(row => row.name).join(' + ')} → {preview.primary.name}</p><p>Saldo resultante: <strong>{bs(preview.balanceBs)}</strong></p>{Object.entries(preview.counts).map(([name, count]) => <p key={name}>{name}: {count} registros vinculados</p>)}<p>Las fichas duplicadas quedarán archivadas con su historial.</p></div> : null}</> : <>
        <p>Saldo VIP disponible: <strong>{bs(modal.client.balanceBs)}</strong>. Esta operación no crea ingresos ni egresos de caja.</p>
        {modal.type === 'adjust' ? <><label>Saldo actual conciliado (Bs)<input autoFocus type="number" min="0" step="0.01" required value={form.balanceBs} onChange={event => field('balanceBs', event.target.value)} /></label><p>Se registra un ajuste de {bs(Number(form.balanceBs) - modal.client.balanceBs)} con respaldo. No vuelve a cargar los depósitos del Excel.</p></> : <><label>Origen de la cancelación<select value={form.mode} onChange={event => field('mode', event.target.value)}><option value="balance">Aplicar saldo VIP actual</option><option value="historical">Ya descontado en el saldo histórico conciliado</option></select></label><p>{form.mode === 'historical' ? 'Reconoce el pago del contrato sin volver a descontar el saldo VIP. Usa el recibo o la fila del Excel como respaldo.' : 'Descuenta una sola vez del saldo VIP disponible y reduce el pendiente del contrato.'}</p><label>Alquiler a cancelar (Bs)<input type="number" min="0" max={modal.row.commercialPendingBs} step="0.01" required value={form.serviceBs} onChange={event => field('serviceBs', event.target.value)} /></label><label>Daños a cancelar (Bs)<input type="number" min="0" max={modal.row.damagePendingBs} step="0.01" required value={form.damageBs} onChange={event => field('damageBs', event.target.value)} /></label></>}
        <label>Fecha del respaldo<input type="date" required value={form.date} onChange={event => field('date', event.target.value)} /></label><label>Recibo, contrato o fila del Excel<input required value={form.reference} onChange={event => field('reference', event.target.value)} /></label>
      </>}
      <label>Motivo y detalle del respaldo<textarea required value={form.reason} onChange={event => field('reason', event.target.value)} /></label>
      {actionError ? <p className="status error" role="alert">{actionError}</p> : null}
      <footer><button type="button" className="ghost-button" disabled={busy} onClick={close}>Cancelar</button><button type="submit" className="primary-button" disabled={busy || modal.type === 'merge' && !form.sourceIds.length}>{busy ? 'Guardando...' : modal.type === 'merge' ? preview ? 'Confirmar unificación' : 'Revisar unificación' : 'Guardar conciliación'}</button></footer>
    </form></section></div> : null}
    {pdf ? <div className="vip-dialog-backdrop"><section className="vip-dialog vip-pdf-dialog" role="dialog" aria-modal="true" aria-label="Reporte de contratos VIP"><header><h3>Reporte de contratos VIP</h3><button type="button" className="ghost-button" onClick={() => setPdf(null)}>Cerrar</button><a className="ghost-button" href={pdf} target="_blank" rel="noreferrer">Abrir / imprimir</a></header><iframe src={pdf} title="Reporte de contratos VIP" /></section></div> : null}
  </div>;
}

function VipContractRow({ row, canManage, onSettle }) {
  const [expanded, setExpanded] = useState(false);
  return <><tr><td><strong>{row.code}</strong><small>{date(row.eventDate)}</small><small>{row.orderCode}</small></td><td>{row.address || 'Sin ubicación'}<small>{row.logisticsMode === 'recojo' ? 'Recojo por el cliente' : row.logisticsMode === 'envio' ? 'Envío por el equipo' : 'Por definir'}</small></td><td>{bs(row.totalBs)}</td><td>{bs(row.paidBs)}</td><td>{bs(row.prepaidBs)}{row.historicalPaidBs > 0 ? <small>Histórico {bs(row.historicalPaidBs)}</small> : null}</td><td>{bs(row.damagePendingBs)}</td><td><strong>{bs(row.totalPendingBs)}</strong><small>{row.totalPendingBs > .009 ? 'Por cobrar' : 'Cobrado'}</small>{row.warnings.length ? <small className="vip-warning">Revisar pagos</small> : null}</td><td><button type="button" className="ghost-button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Ocultar' : 'Ver detalle'}</button></td></tr>
    {expanded ? <tr><td colSpan="8"><div className="vip-contract-detail"><h4>Contrato {row.code} · {row.customerName}</h4><p>Pagado alquiler: {bs(row.paidBs)} · Alquiler pendiente: {bs(row.commercialPendingBs)} · Daños totales: {bs(row.damageBs)} · Daños pendientes: {bs(row.damagePendingBs)}</p>{row.warnings.map(warning => <p className="vip-warning" key={warning}>{warning}</p>)}<h4>Ítems y servicios</h4><ul>{row.items.map((line, index) => <li key={index}>{line.quantity} × {line.name} {line.day || line.date ? `· ${line.day || line.date}` : ''} · {bs(line.amountBs)}</li>)}{row.services.map((line, index) => <li key={`s-${index}`}>{line.name} · {bs(line.amountBs)}</li>)}</ul><h4>Recibos de caja activos</h4>{row.receipts.length ? <ul>{row.receipts.map(line => <li key={line.id}>{line.code} · {date(line.date)} · {bs(line.amountBs)} · {line.paymentMethod} {line.paymentAccount}<small>{line.description}</small></li>)}</ul> : <p>Sin recibos de caja activos.</p>}<h4>Movimientos económicos</h4><ul>{row.economicLedger.map(line => <li key={line.id}>{date(line.date)} · {line.type} · {bs(line.amountBs)} · {line.note} {line.receipt}</li>)}</ul>{row.settlements.length ? <><h4>Conciliaciones VIP</h4><ul>{row.settlements.map(line => <li key={line.id}>{date(line.createdAt)} · {line.mode === 'historical' ? 'Cancelación histórica sin descontar saldo' : 'Aplicación de saldo VIP'} · {bs(line.serviceBs + line.damageBs)} · {line.reference} · {line.reason}</li>)}</ul></> : null}{canManage && row.totalPendingBs > .009 ? <button type="button" className="primary-button" onClick={onSettle}>Conciliar pago de este contrato</button> : null}</div></td></tr> : null}
  </>;
}
