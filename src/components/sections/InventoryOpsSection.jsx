import { useMemo, useState } from 'react';
import { api } from '../../services/api';

const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('es-BO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const normalize = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const dateKey = (value) => {
  const date = new Date(value ?? '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const moneyNumber = (value) => Math.round(Math.max(0, Number(value ?? 0)) * 100) / 100;

function InventoryOpsSection({ damageLossOverview = { rows: [], total: 0, summary: {} }, formatBs }) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [query, setQuery] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [repairDialog, setRepairDialog] = useState(null);
  const [repairQuantity, setRepairQuantity] = useState('1');
  const [repairNote, setRepairNote] = useState('');
  const [processingRepair, setProcessingRepair] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackType, setFeedbackType] = useState('ok');

  const filteredRows = useMemo(() => {
    const rows = Array.isArray(damageLossOverview?.rows) ? damageLossOverview.rows : [];
    return rows.filter((row) => {
      if (typeFilter !== 'all' && row.lossType !== typeFilter) return false;
      const key = dateKey(row.occurredAt);
      if (dateFrom && key && key < dateFrom) return false;
      if (dateTo && key && key > dateTo) return false;
      const search = normalize(query);
      if (!search) return true;
      return normalize([
        row.itemName, row.category, row.contractCode, row.orderCode, row.customerName, row.note,
      ].filter(Boolean).join(' ')).includes(search);
    });
  }, [damageLossOverview, typeFilter, dateFrom, dateTo, query]);

  const summary = useMemo(() => filteredRows.reduce((acc, row) => {
    const qty = Math.max(0, Number(row.quantity ?? 0));
    const repairedQty = Math.max(0, Number(row.repairedQty ?? 0));
    const value = moneyNumber(row.totalValueBs);
    const repairedValue = moneyNumber(repairedQty * Number(row.unitValueBs ?? 0));
    acc.totalUnits += qty;
    acc.totalValueBs += value;
    acc.repairedUnits += repairedQty;
    acc.repairedValueBs += repairedValue;
    if (row.lossType === 'danado') { acc.damagedUnits += qty; acc.damagedValueBs += value; }
    else { acc.missingUnits += qty; acc.missingValueBs += value; }
    return acc;
  }, {
    totalUnits: 0,
    totalValueBs: 0,
    damagedUnits: 0,
    damagedValueBs: 0,
    missingUnits: 0,
    missingValueBs: 0,
    repairedUnits: 0,
    repairedValueBs: 0,
  }), [filteredRows]);

  const economicSummary = useMemo(() => {
    const byRental = damageLossOverview?.summary?.economicsByRental ?? {};
    const rentalIds = [...new Set(filteredRows.map((row) => String(row?.rentalId ?? '')).filter(Boolean))];
    return rentalIds.reduce((acc, rentalId) => {
      const entry = byRental?.[rentalId] ?? {};
      acc.clientChargedBs += moneyNumber(entry.clientChargedBs);
      acc.cashCollectedBs += moneyNumber(entry.cashCollectedBs);
      acc.guaranteeAppliedBs += moneyNumber(entry.guaranteeAppliedBs);
      acc.totalRecoveredBs += moneyNumber(entry.totalRecoveredBs);
      acc.pendingRecoveryBs += moneyNumber(entry.pendingRecoveryBs);
      return acc;
    }, { clientChargedBs: 0, cashCollectedBs: 0, guaranteeAppliedBs: 0, totalRecoveredBs: 0, pendingRecoveryBs: 0 });
  }, [damageLossOverview, filteredRows]);

  const openRepairDialog = (row) => {
    const available = Math.max(0, Math.trunc(Number(row?.repairableQuantity ?? row?.quantity ?? 0)));
    setOpenMenuId(null);
    setRepairDialog(row);
    setRepairQuantity(String(Math.min(1, available)));
    setRepairNote('');
    setFeedback('');
  };

  const handleRepairSubmit = async (event) => {
    event.preventDefault();
    if (!repairDialog || processingRepair) return;
    const maxQty = Math.max(0, Math.trunc(Number(repairDialog?.repairableQuantity ?? 0)));
    const quantity = Math.trunc(Number(repairQuantity ?? 0));
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > maxQty) {
      setFeedback(`La cantidad debe estar entre 1 y ${maxQty}.`);
      setFeedbackType('error');
      return;
    }

    setProcessingRepair(true);
    setFeedback('');
    try {
      await api.inventory.reinsertRepairedDamage({
        rentalId: repairDialog.rentalId,
        itemId: repairDialog.itemId,
        reportIndex: repairDialog.reportIndex,
        reportKind: repairDialog.reportKind,
        quantity,
        note: repairNote,
        userName: 'Inventario',
        userRole: 'Inventario',
      });
      setRepairDialog(null);
      setRepairNote('');
      setFeedback(`${quantity} unidad(es) reparada(s) fueron reinsertadas al stock físico y disponible.`);
      setFeedbackType('ok');
    } catch (error) {
      setFeedback(error?.message || 'No se pudo reinsertar el item reparado.');
      setFeedbackType('error');
    } finally {
      setProcessingRepair(false);
    }
  };

  const generateReport = () => {
    const generatedAt = new Date().toLocaleString('es-BO');
    const period = dateFrom || dateTo
      ? `${dateFrom || 'Inicio'} — ${dateTo || 'Actualidad'}`
      : 'Todo el historial visible';
    const recoveryDifference = Math.round((economicSummary.totalRecoveredBs - economicSummary.clientChargedBs) * 100) / 100;
    const reportRows = filteredRows.map((row, index) => `
      <tr>
        <td class="center">${index + 1}</td>
        <td>${escapeHtml(formatDateTime(row.occurredAt))}</td>
        <td><span class="pill ${row.lossType === 'danado' ? 'damage' : 'missing'}">${row.lossType === 'danado' ? 'DAÑADO' : 'FALTANTE'}</span></td>
        <td><strong>${escapeHtml(row.itemName)}</strong><small>${escapeHtml(row.category || '')}</small></td>
        <td class="center">${escapeHtml(row.quantity)}</td>
        <td class="center">${row.lossType === 'danado' ? escapeHtml(row.repairedQty ?? 0) : '—'}</td>
        <td class="money">${escapeHtml(formatBs(row.unitValueBs))}</td>
        <td class="money"><strong>${escapeHtml(formatBs(row.totalValueBs))}</strong></td>
        <td><strong>${escapeHtml(row.contractCode || '-')}</strong><small>${escapeHtml(row.orderCode || '')}</small></td>
        <td>${escapeHtml(row.customerName || '-')}</td>
        <td>${escapeHtml(row.note || 'Sin observación')}</td>
      </tr>`).join('');

    const reportWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!reportWindow) {
      setFeedback('El navegador bloqueó la ventana del reporte. Habilita ventanas emergentes e intenta nuevamente.');
      setFeedbackType('error');
      return;
    }
    reportWindow.document.write(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Reporte de Daños y Faltantes</title>
<style>
@page{size:letter landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#18243a;margin:0;background:#fff;font-size:10px}.page{width:100%}.head{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #15345f;padding:0 0 12px;margin-bottom:12px}.brand{font-size:11px;font-weight:800;letter-spacing:.08em;color:#df4d00;text-transform:uppercase}.title{font-size:24px;font-weight:800;color:#15345f;margin:3px 0}.subtitle{color:#64748b}.meta{text-align:right;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:12px 0}.card{border:1px solid #d9e1eb;border-radius:7px;padding:9px;background:#f8fafc}.card span{display:block;color:#64748b;font-size:8px;text-transform:uppercase;font-weight:700}.card strong{display:block;font-size:17px;margin-top:3px;color:#15345f}.economic{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:0 0 14px}.economic .card{background:#fffaf6;border-color:#f1d8c6}.section-title{font-size:13px;font-weight:800;color:#15345f;margin:12px 0 7px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th{background:#15345f;color:#fff;padding:7px 5px;text-align:left;font-size:8px;text-transform:uppercase}td{border-bottom:1px solid #dbe2ea;padding:6px 5px;vertical-align:top;overflow-wrap:anywhere}tbody tr:nth-child(even){background:#f8fafc}td small{display:block;color:#758195;margin-top:2px}.center{text-align:center}.money{text-align:right;white-space:nowrap}.pill{display:inline-block;border-radius:999px;padding:3px 6px;font-weight:800;font-size:7px}.pill.damage{background:#fff1d6;color:#9a5a00}.pill.missing{background:#ffe7e7;color:#b42318}.note{margin-top:10px;padding:8px 10px;border-left:3px solid #15345f;background:#f8fafc;color:#526174}.footer{margin-top:12px;padding-top:8px;border-top:1px solid #dbe2ea;display:flex;justify-content:space-between;color:#7a8798;font-size:8px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><main class="page">
<div class="head"><div><div class="brand">EL COPETÍN · CONTROL DE INVENTARIO</div><div class="title">Reporte de Daños y Faltantes</div><div class="subtitle">Kardex de pérdidas, reparaciones y recuperación económica</div></div><div class="meta"><strong>Periodo</strong><br>${escapeHtml(period)}<br><strong>Generado</strong><br>${escapeHtml(generatedAt)}</div></div>
<div class="cards">
<div class="card"><span>Registros</span><strong>${filteredRows.length}</strong></div>
<div class="card"><span>Unidades afectadas</span><strong>${summary.totalUnits}</strong></div>
<div class="card"><span>Dañadas</span><strong>${summary.damagedUnits}</strong></div>
<div class="card"><span>Faltantes</span><strong>${summary.missingUnits}</strong></div>
<div class="card"><span>Reparadas / reinsertadas</span><strong>${summary.repairedUnits}</strong></div>
</div>
<div class="section-title">Resumen económico</div>
<div class="economic">
<div class="card"><span>Cargos al cliente</span><strong>${escapeHtml(formatBs(economicSummary.clientChargedBs))}</strong></div>
<div class="card"><span>Cobrado en caja</span><strong>${escapeHtml(formatBs(economicSummary.cashCollectedBs))}</strong></div>
<div class="card"><span>Aplicado de garantía</span><strong>${escapeHtml(formatBs(economicSummary.guaranteeAppliedBs))}</strong></div>
<div class="card"><span>Total recuperado</span><strong>${escapeHtml(formatBs(economicSummary.totalRecoveredBs))}</strong></div>
<div class="card"><span>Pendiente por recuperar</span><strong>${escapeHtml(formatBs(economicSummary.pendingRecoveryBs))}</strong></div>
</div>
<div class="section-title">Detalle de incidencias</div>
<table><colgroup><col style="width:3%"><col style="width:8%"><col style="width:7%"><col style="width:15%"><col style="width:5%"><col style="width:5%"><col style="width:7%"><col style="width:7%"><col style="width:9%"><col style="width:12%"><col style="width:22%"></colgroup>
<thead><tr><th>N°</th><th>Fecha</th><th>Tipo</th><th>Ítem</th><th>Cant.</th><th>Repar.</th><th>Valor unit.</th><th>Valor</th><th>Contrato / orden</th><th>Cliente</th><th>Observación</th></tr></thead><tbody>${reportRows || '<tr><td colspan="11" class="center">No hay registros para los filtros seleccionados.</td></tr>'}</tbody></table>
<div class="note"><strong>Resultado de recuperación:</strong> ${escapeHtml(formatBs(Math.abs(recoveryDifference)))} ${recoveryDifference < 0 ? 'pendiente respecto a los cargos al cliente' : recoveryDifference > 0 ? 'por encima de los cargos registrados' : '— cargos recuperados completamente'}. El “valor registrado” corresponde al cargo configurado en la devolución y no debe interpretarse como costo contable de reposición ni utilidad neta.</div>
<div class="footer"><span>EL COPETÍN · Inventario</span><span>${filteredRows.length} registro(s) incluidos</span></div>
</main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150));</script></body></html>`);
    reportWindow.document.close();
  };

  return (
    <section className="panel inventory-ops-panel inventory-loss-panel">
      <div className="inventory-ops-cards inventory-loss-cards">
        <article className="stat-card"><h2>Unidades Afectadas</h2><p>{summary.totalUnits}</p><small>Dañadas + faltantes</small></article>
        <article className="stat-card"><h2>Dañadas</h2><p>{summary.damagedUnits}</p><small>{formatBs(summary.damagedValueBs)}</small></article>
        <article className="stat-card"><h2>Faltantes</h2><p>{summary.missingUnits}</p><small>{formatBs(summary.missingValueBs)}</small></article>
        <article className="stat-card"><h2>Reinsertadas</h2><p>{summary.repairedUnits}</p><small>{formatBs(summary.repairedValueBs)}</small></article>
      </div>

      <article className="inventory-ops-table-card inventory-loss-card">
        <div className="inventory-loss-head">
          <div>
            <h2>Kardex de daños y faltantes</h2>
            <p>Los faltantes permanecen como pérdida. Los dañados reparados pueden volver al stock mediante una reinserción controlada.</p>
          </div>
          <div className="inventory-actions">
            <strong>{filteredRows.length} registro(s)</strong>
            <button type="button" className="primary-button" onClick={generateReport}>Generar reporte</button>
          </div>
        </div>

        {feedback ? <p className={`status ${feedbackType === 'error' ? 'error' : ''}`}>{feedback}</p> : null}

        <div className="inventory-loss-filters">
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">Daños y faltantes</option>
            <option value="danado">Solo dañados</option>
            <option value="faltante">Solo faltantes</option>
          </select>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Desde" />
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Hasta" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar item, contrato, cliente o nota..." />
          {(typeFilter !== 'all' || dateFrom || dateTo || query) ? (
            <button type="button" className="ghost-button" onClick={() => { setTypeFilter('all'); setDateFrom(''); setDateTo(''); setQuery(''); }}>Limpiar</button>
          ) : null}
        </div>

        <div className="inventory-ops-table-wrap inventory-loss-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Tipo</th><th>Item</th><th>Cant.</th><th>Valor unit.</th><th>Valor</th><th>Contrato / orden</th><th>Cliente</th><th>Observación</th><th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const canReinsert = row.lossType === 'danado' && Number(row.repairableQuantity ?? 0) > 0;
                return (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.occurredAt)}</td>
                    <td>
                      <span className={`inventory-loss-badge ${row.lossType}`}>{row.lossType === 'danado' ? 'Dañado' : 'Faltante'}</span>
                      {row.lossType === 'danado' && Number(row.repairedQty ?? 0) > 0 ? <small>{row.repairedQty} reinsertada(s)</small> : null}
                    </td>
                    <td><strong>{row.itemName}</strong><small>{row.category || ''}</small></td>
                    <td>{row.quantity}</td>
                    <td>{formatBs(row.unitValueBs)}</td>
                    <td><strong>{formatBs(row.totalValueBs)}</strong></td>
                    <td><strong>{row.contractCode || '-'}</strong><small>{row.orderCode || ''}</small></td>
                    <td>{row.customerName || '-'}</td>
                    <td>{row.note || 'Sin observación'}</td>
                    <td className="inventory-row-menu">
                      <div className="inventory-actions-menu-wrap">
                        <button
                          type="button"
                          className="inventory-row-menu-button"
                          aria-label={`Opciones para ${row.itemName}`}
                          onClick={() => setOpenMenuId((current) => current === row.id ? null : row.id)}
                        >
                          {'\u22ee'}
                        </button>
                        {openMenuId === row.id ? (
                          <div className="inventory-row-actions-menu">
                            {canReinsert ? (
                              <button type="button" onClick={() => openRepairDialog(row)}>Reinsertar reparado</button>
                            ) : row.lossType === 'danado' ? (
                              <span className="status">Daño ya reinsertado</span>
                            ) : (
                              <span className="status">Faltante: sin reinserción</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 ? <tr><td colSpan="10" className="inventory-loss-empty">No hay daños o faltantes para este filtro.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </article>

      {repairDialog ? (
        <div className="reset-modal-backdrop" onClick={() => !processingRepair && setRepairDialog(null)}>
          <form className="reset-modal" onSubmit={handleRepairSubmit} onClick={(event) => event.stopPropagation()}>
            <h3>Reinsertar item reparado</h3>
            <p><strong>{repairDialog.itemName}</strong></p>
            <p>
              Daño registrado: {repairDialog.quantity} · Ya reinsertado: {repairDialog.repairedQty ?? 0} · Disponible para reinsertar: {repairDialog.repairableQuantity}
            </p>
            <label>
              Cantidad reparada
              <input
                type="number"
                min="1"
                max={Math.max(1, Number(repairDialog.repairableQuantity ?? 1))}
                step="1"
                value={repairQuantity}
                onChange={(event) => setRepairQuantity(event.target.value)}
                required
              />
            </label>
            <label>
              Observación de reparación
              <textarea value={repairNote} onChange={(event) => setRepairNote(event.target.value)} placeholder="Ej. costura reparada, pieza restaurada..." />
            </label>
            <p className="status">Esta operación aumenta el stock físico total y el stock disponible. El daño permanece en el kardex como historial.</p>
            <div className="reset-modal-actions">
              <button type="button" className="ghost-button" disabled={processingRepair} onClick={() => setRepairDialog(null)}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={processingRepair}>{processingRepair ? 'Reinsertando...' : 'Confirmar reinserción'}</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

export default InventoryOpsSection;
