import { useMemo, useRef, useState } from 'react';
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

const COLLECTION_STATUS_META = {
  sin_cargo: { label: 'SIN CARGO', className: 'neutral' },
  pendiente: { label: 'PENDIENTE', className: 'pending' },
  parcial: { label: 'PARCIAL', className: 'partial' },
  cobrado_caja: { label: 'COBRADO', className: 'paid' },
  cubierto_garantia: { label: 'GARANTÍA', className: 'guarantee' },
  cubierto_mixto: { label: 'MIXTO', className: 'mixed' },
  cubierto: { label: 'CUBIERTO', className: 'paid' },
};

const getCollectionStatusMeta = (entry = {}) => {
  const explicit = String(entry?.collectionStatus ?? '').trim();
  if (COLLECTION_STATUS_META[explicit]) return COLLECTION_STATUS_META[explicit];
  const charged = moneyNumber(entry?.clientChargedBs);
  const recovered = moneyNumber(entry?.totalRecoveredBs);
  const pending = moneyNumber(entry?.pendingRecoveryBs);
  if (charged <= 0.009) return COLLECTION_STATUS_META.sin_cargo;
  if (pending <= 0.009 || recovered + 0.009 >= charged) {
    const cash = moneyNumber(entry?.cashCollectedBs);
    const guarantee = moneyNumber(entry?.guaranteeAppliedBs);
    if (cash > 0.009 && guarantee > 0.009) return COLLECTION_STATUS_META.cubierto_mixto;
    if (cash > 0.009) return COLLECTION_STATUS_META.cobrado_caja;
    if (guarantee > 0.009) return COLLECTION_STATUS_META.cubierto_garantia;
    return COLLECTION_STATUS_META.cubierto;
  }
  if (recovered > 0.009) return COLLECTION_STATUS_META.parcial;
  return COLLECTION_STATUS_META.pendiente;
};

function InventoryOpsSection({ damageLossOverview = { rows: [], total: 0, summary: {} }, formatBs }) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [query, setQuery] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const [reportPreview, setReportPreview] = useState(null);
  const reportFrameRef = useRef(null);
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
    setMenuPosition(null);
    setRepairDialog(row);
    setRepairQuantity(String(Math.min(1, available)));
    setRepairNote('');
    setFeedback('');
  };

  const toggleRowMenu = (event, row) => {
    const button = event.currentTarget;
    if (openMenuId === row.id) {
      setOpenMenuId(null);
      setMenuPosition(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    const menuWidth = 268;
    const estimatedMenuHeight = 150;
    const viewportPadding = 12;
    const openUp = rect.bottom + estimatedMenuHeight + viewportPadding > window.innerHeight;
    setMenuPosition({
      top: openUp ? Math.max(viewportPadding, rect.top - estimatedMenuHeight - 6) : rect.bottom + 6,
      left: Math.min(
        window.innerWidth - menuWidth - viewportPadding,
        Math.max(viewportPadding, rect.right - menuWidth),
      ),
    });
    setOpenMenuId(row.id);
  };

  const closeRowMenu = () => {
    setOpenMenuId(null);
    setMenuPosition(null);
  };

  const printReportPreview = () => {
    const frameWindow = reportFrameRef.current?.contentWindow;
    if (!frameWindow) {
      setFeedback('No se pudo preparar la vista de impresión.');
      setFeedbackType('error');
      return;
    }
    frameWindow.focus();
    frameWindow.print();
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
    const economicsByRental = damageLossOverview?.summary?.economicsByRental ?? {};
    const uniqueRentalIds = [...new Set(filteredRows.map((row) => String(row?.rentalId ?? '')).filter(Boolean))];
    const statusCounts = uniqueRentalIds.reduce((acc, rentalId) => {
      const status = getCollectionStatusMeta(economicsByRental?.[rentalId] ?? {});
      if (['paid', 'guarantee', 'mixed'].includes(status.className)) acc.paid += 1;
      else if (status.className === 'partial') acc.partial += 1;
      else if (status.className === 'pending') acc.pending += 1;
      else acc.noCharge += 1;
      return acc;
    }, { paid: 0, partial: 0, pending: 0, noCharge: 0 });

    const paymentMethodLabel = (entry = {}) => {
      if (entry?.source === 'guarantee') return 'Garantía';
      const method = String(entry?.paymentMethod ?? '').trim().toLowerCase();
      if (method === 'qr') return `QR${entry?.paymentAccount ? ` · ${entry.paymentAccount}` : ''}`;
      if (method === 'transferencia') return `Transferencia${entry?.paymentAccount ? ` · ${entry.paymentAccount}` : ''}`;
      return 'Efectivo';
    };

    const recoverySummaryText = (economic = {}) => {
      const entries = Array.isArray(economic?.recoveryBreakdown) ? economic.recoveryBreakdown : [];
      if (!entries.length) return moneyNumber(economic?.clientChargedBs) > 0 ? 'Sin recuperación registrada' : 'Sin cargo al cliente';
      return entries.map((entry) => `${paymentMethodLabel(entry)} ${formatBs(entry?.amountBs)}`).join(' + ');
    };

    const reportRows = filteredRows.map((row, index) => {
      const economic = economicsByRental?.[String(row?.rentalId ?? '')] ?? {};
      const collectionStatus = getCollectionStatusMeta(economic);
      const rowClass = ['paid', 'guarantee', 'mixed'].includes(collectionStatus.className)
        ? 'settled-row'
        : collectionStatus.className === 'partial'
          ? 'partial-row'
          : collectionStatus.className === 'pending'
            ? 'pending-row'
            : '';
      const collectionDetail = recoverySummaryText(economic);
      return `
      <tr class="${rowClass}">
        <td class="center">${index + 1}</td>
        <td>${escapeHtml(formatDateTime(row.occurredAt))}</td>
        <td><span class="pill ${row.lossType === 'danado' ? 'damage' : 'missing'}">${row.lossType === 'danado' ? 'DAÑADO' : 'FALTANTE'}</span></td>
        <td><strong>${escapeHtml(row.itemName)}</strong><small>${escapeHtml(row.category || '')}</small></td>
        <td class="center strong-number">${escapeHtml(row.quantity)}</td>
        <td class="money"><strong>${escapeHtml(formatBs(row.totalValueBs))}</strong></td>
        <td class="collection-cell"><span class="collection ${collectionStatus.className}">${escapeHtml(collectionStatus.label)}</span><small>${escapeHtml(collectionDetail)}</small></td>
        <td><strong>${escapeHtml(row.contractCode || '-')}</strong><small>${escapeHtml(row.orderCode || '')} · ${escapeHtml(row.customerName || '-')}</small></td>
        <td>${escapeHtml(row.note || 'Sin observación')}</td>
      </tr>`;
    }).join('');

    const financialRows = uniqueRentalIds.map((rentalId, index) => {
      const economic = economicsByRental?.[rentalId] ?? {};
      const firstRow = filteredRows.find((row) => String(row?.rentalId ?? '') === rentalId) ?? {};
      const status = getCollectionStatusMeta(economic);
      const entries = Array.isArray(economic?.recoveryBreakdown) ? economic.recoveryBreakdown : [];
      const recoveryLines = entries.length
        ? entries.map((entry) => {
          const receipt = entry?.receiptCode ? ` · Recibo ${entry.receiptCode}` : '';
          const by = entry?.registeredBy ? ` · ${entry.registeredBy}` : '';
          const when = entry?.occurredAt ? ` · ${formatDateTime(entry.occurredAt)}` : '';
          return `<div class="recovery-line"><strong>${escapeHtml(paymentMethodLabel(entry))}</strong><span>${escapeHtml(formatBs(entry?.amountBs))}${escapeHtml(receipt)}${escapeHtml(when)}${escapeHtml(by)}</span></div>`;
        }).join('')
        : '<div class="recovery-line muted">Sin movimientos de recuperación.</div>';
      return `
        <div class="finance-record ${['paid', 'guarantee', 'mixed'].includes(status.className) ? 'is-paid' : status.className === 'partial' ? 'is-partial' : status.className === 'pending' ? 'is-pending' : ''}">
          <div class="finance-no">${index + 1}</div>
          <div class="finance-contract"><span>CONTRATO</span><strong>${escapeHtml(firstRow?.contractCode || '-')}</strong><small>${escapeHtml(firstRow?.orderCode || '')}</small></div>
          <div class="finance-client"><span>CLIENTE</span><strong>${escapeHtml(firstRow?.customerName || '-')}</strong></div>
          <div class="finance-amount"><span>CARGO</span><strong>${escapeHtml(formatBs(economic?.clientChargedBs))}</strong></div>
          <div class="finance-amount recovered"><span>RECUPERADO</span><strong>${escapeHtml(formatBs(economic?.totalRecoveredBs))}</strong></div>
          <div class="finance-amount pending"><span>PENDIENTE</span><strong>${escapeHtml(formatBs(economic?.pendingRecoveryBs))}</strong></div>
          <div class="finance-status"><span class="collection ${status.className}">${escapeHtml(status.label)}</span></div>
          <div class="finance-recovery">${recoveryLines}</div>
        </div>`;
    }).join('');

    const reportHtml = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Reporte de Daños y Faltantes</title>
<style>
@page{size:letter landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#17233a;margin:0;background:#fff;font-size:9.5px}.page{width:100%}.head{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #15345f;padding:0 0 11px;margin-bottom:10px}.brand{font-size:10px;font-weight:800;letter-spacing:.09em;color:#df4d00;text-transform:uppercase}.title{font-size:23px;font-weight:800;color:#15345f;margin:3px 0}.subtitle{color:#64748b}.meta{text-align:right;line-height:1.55;min-width:210px}.section-kicker{font-size:8px;font-weight:800;letter-spacing:.08em;color:#64748b;text-transform:uppercase;margin:11px 0 5px}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:8px 0 10px}.card{border:1px solid #d9e1eb;border-radius:7px;padding:8px;background:#f8fafc}.card span{display:block;color:#64748b;font-size:7.5px;text-transform:uppercase;font-weight:700}.card strong{display:block;font-size:16px;margin-top:2px;color:#15345f}.economic{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-bottom:11px}.economic .card{background:#fffaf6;border-color:#f1d8c6}.economic .card.good{background:#f0fdf4;border-color:#bbf7d0}.economic .card.warn{background:#fffbeb;border-color:#fde68a}.section-title{font-size:13px;font-weight:800;color:#15345f;margin:12px 0 6px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th{background:#15345f;color:#fff;padding:6px 5px;text-align:left;font-size:7.5px;text-transform:uppercase}td{border-bottom:1px solid #dbe2ea;padding:5px;vertical-align:top;overflow-wrap:anywhere}tbody tr:nth-child(even){background:#f8fafc}tbody tr.settled-row{background:#f0fdf4!important}tbody tr.partial-row{background:#fffbeb!important}tbody tr.pending-row{background:#fffafa!important}td small{display:block;color:#758195;margin-top:2px;line-height:1.25}.center{text-align:center}.money{text-align:right;white-space:nowrap}.strong-number{font-weight:800}.pill,.collection{display:inline-block;border-radius:999px;padding:3px 6px;font-weight:800;font-size:7px;white-space:nowrap}.pill.damage{background:#fff1d6;color:#9a5a00}.pill.missing{background:#ffe7e7;color:#b42318}.collection.paid{background:#dcfce7;color:#166534}.collection.guarantee{background:#dcfce7;color:#166534}.collection.mixed{background:#dcfce7;color:#166534}.collection.partial{background:#fef3c7;color:#92400e}.collection.pending{background:#fee2e2;color:#b91c1c}.collection.neutral{background:#eef2f7;color:#526174}.collection-cell small{margin-top:4px}.finance-list{display:grid;gap:6px}.finance-record{display:grid;grid-template-columns:28px 90px 1.25fr 82px 82px 82px 82px 2.15fr;align-items:stretch;border:1px solid #dbe2ea;border-left:4px solid #94a3b8;border-radius:7px;overflow:hidden;break-inside:avoid;background:#fff}.finance-record.is-paid{border-left-color:#16a34a;background:#f7fff9}.finance-record.is-partial{border-left-color:#d97706;background:#fffdf5}.finance-record.is-pending{border-left-color:#dc2626;background:#fffafa}.finance-record>div{padding:7px 6px;border-right:1px solid #e5eaf0}.finance-record>div:last-child{border-right:0}.finance-no{display:flex;align-items:center;justify-content:center;font-weight:800;color:#64748b}.finance-record span{display:block;color:#64748b;font-size:7px;text-transform:uppercase;font-weight:700}.finance-record strong{display:block;margin-top:2px}.finance-status{display:flex;align-items:center;justify-content:center}.finance-recovery{padding:5px 7px!important}.recovery-line{display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px dashed #d9e1eb;line-height:1.25}.recovery-line:last-child{border-bottom:0}.recovery-line strong{min-width:96px;margin:0}.recovery-line span{font-size:7.5px;text-transform:none;font-weight:500;text-align:right}.muted{color:#7a8798}.note{margin-top:10px;padding:8px 10px;border-left:3px solid #15345f;background:#f8fafc;color:#526174}.footer{margin-top:12px;padding-top:8px;border-top:1px solid #dbe2ea;display:flex;justify-content:space-between;color:#7a8798;font-size:8px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.finance-record{break-inside:avoid}.section-title{break-after:avoid}}
</style></head><body><main class="page">
<div class="head"><div><div class="brand">EL COPETÍN · CONTROL DE INVENTARIO</div><div class="title">Reporte de Daños y Faltantes</div><div class="subtitle">Incidencias físicas y recuperación económica vinculada a cada contrato</div></div><div class="meta"><strong>Periodo</strong><br>${escapeHtml(period)}<br><strong>Generado</strong><br>${escapeHtml(generatedAt)}</div></div>
<div class="section-kicker">Resumen físico</div>
<div class="cards">
<div class="card"><span>Registros</span><strong>${filteredRows.length}</strong></div>
<div class="card"><span>Unidades afectadas</span><strong>${summary.totalUnits}</strong></div>
<div class="card"><span>Dañadas</span><strong>${summary.damagedUnits}</strong></div>
<div class="card"><span>Faltantes</span><strong>${summary.missingUnits}</strong></div>
<div class="card"><span>Reparadas / reinsertadas</span><strong>${summary.repairedUnits}</strong></div>
</div>
<div class="section-kicker">Resumen económico</div>
<div class="economic">
<div class="card"><span>Cargos al cliente</span><strong>${escapeHtml(formatBs(economicSummary.clientChargedBs))}</strong></div>
<div class="card good"><span>Total recuperado</span><strong>${escapeHtml(formatBs(economicSummary.totalRecoveredBs))}</strong></div>
<div class="card warn"><span>Pendiente por recuperar</span><strong>${escapeHtml(formatBs(economicSummary.pendingRecoveryBs))}</strong></div>
<div class="card"><span>Contratos cobrados</span><strong>${statusCounts.paid}</strong></div>
<div class="card"><span>Parciales / pendientes</span><strong>${statusCounts.partial + statusCounts.pending}</strong></div>
</div>
<div class="section-title">1. Detalle de incidencias</div>
<table><colgroup><col style="width:3%"><col style="width:8%"><col style="width:7%"><col style="width:17%"><col style="width:5%"><col style="width:7%"><col style="width:16%"><col style="width:15%"><col style="width:22%"></colgroup>
<thead><tr><th>N°</th><th>Fecha</th><th>Tipo</th><th>Ítem</th><th>Cant.</th><th>Cargo</th><th>Cobro</th><th>Contrato / cliente</th><th>Observación</th></tr></thead><tbody>${reportRows || '<tr><td colspan="9" class="center">No hay registros para los filtros seleccionados.</td></tr>'}</tbody></table>
<div class="section-title">2. Detalle de cobros y recuperaciones</div>
<div class="finance-list">${financialRows || '<div class="note">No hay contratos con incidencias para los filtros seleccionados.</div>'}</div>
<div class="note"><strong>Lectura del reporte:</strong> “Cobrado” indica que el cargo por daños/faltantes ya fue recuperado. Debajo se detalla cómo se recuperó: garantía, efectivo, QR o transferencia, incluyendo cuenta, recibo, fecha y responsable cuando esos datos existen. Los importes son cargos de devolución; no equivalen automáticamente al costo contable de reposición ni a utilidad neta.</div>
<div class="footer"><span>EL COPETÍN · Inventario</span><span>${filteredRows.length} incidencia(s) · ${uniqueRentalIds.length} contrato(s)</span></div>
</main></body></html>`;
    setFeedback('');
    setReportPreview({
      title: `Reporte de daños y faltantes · ${period}`,
      html: reportHtml,
    });
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
                      <button
                        type="button"
                        className={`inventory-row-menu-button inventory-loss-menu-trigger ${openMenuId === row.id ? 'is-active' : ''}`}
                        aria-label={`Opciones para ${row.itemName}`}
                        aria-expanded={openMenuId === row.id}
                        onClick={(event) => toggleRowMenu(event, row)}
                      >
                        <span aria-hidden="true">⋮</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 ? <tr><td colSpan="10" className="inventory-loss-empty">No hay daños o faltantes para este filtro.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </article>

      {openMenuId ? (
        <>
          <button
            type="button"
            className="inventory-loss-menu-dismiss"
            aria-label="Cerrar opciones"
            onClick={closeRowMenu}
          />
          {(() => {
            const row = filteredRows.find((entry) => entry.id === openMenuId);
            if (!row || !menuPosition) return null;
            const canReinsert = row.lossType === 'danado' && Number(row.repairableQuantity ?? 0) > 0;
            return (
              <div
                className="inventory-loss-row-menu"
                style={{ top: menuPosition.top, left: menuPosition.left }}
                role="menu"
              >
                <div className="inventory-loss-row-menu-head">
                  <span>{row.lossType === 'danado' ? 'DAÑO REGISTRADO' : 'FALTANTE REGISTRADO'}</span>
                  <strong>{row.itemName}</strong>
                  <small>{row.contractCode ? `Contrato ${row.contractCode}` : row.orderCode || 'Sin referencia'}</small>
                </div>
                <div className="inventory-loss-row-menu-body">
                  {canReinsert ? (
                    <button type="button" className="inventory-loss-row-action" onClick={() => openRepairDialog(row)}>
                      <span className="inventory-loss-row-action-icon" aria-hidden="true">↺</span>
                      <span>
                        <strong>Reinsertar reparado</strong>
                        <small>Devuelve al stock una unidad que ya fue reparada.</small>
                      </span>
                    </button>
                  ) : row.lossType === 'danado' ? (
                    <div className="inventory-loss-row-action is-disabled">
                      <span className="inventory-loss-row-action-icon" aria-hidden="true">✓</span>
                      <span>
                        <strong>Daño ya reinsertado</strong>
                        <small>No quedan unidades dañadas pendientes de recuperar.</small>
                      </span>
                    </div>
                  ) : (
                    <div className="inventory-loss-row-action is-disabled is-missing">
                      <span className="inventory-loss-row-action-icon" aria-hidden="true">!</span>
                      <span>
                        <strong>Sin reinserción</strong>
                        <small>Los faltantes permanecen como pérdida hasta que exista una devolución real.</small>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </>
      ) : null}

      {reportPreview ? (
        <div className="inventory-report-preview-backdrop" onClick={() => setReportPreview(null)}>
          <div className="inventory-report-preview-modal" onClick={(event) => event.stopPropagation()}>
            <header className="inventory-report-preview-head">
              <div>
                <span>VISTA PREVIA DEL DOCUMENTO</span>
                <h2>{reportPreview.title}</h2>
                <p>Revisa el reporte antes de imprimirlo o guardarlo como PDF.</p>
              </div>
              <button type="button" className="inventory-report-preview-close" aria-label="Cerrar reporte" onClick={() => setReportPreview(null)}>×</button>
            </header>
            <div className="inventory-report-preview-stage">
              <iframe
                ref={reportFrameRef}
                title={reportPreview.title}
                srcDoc={reportPreview.html}
                className="inventory-report-preview-frame"
              />
            </div>
            <footer className="inventory-report-preview-actions">
              <button type="button" className="ghost-button" onClick={() => setReportPreview(null)}>Cerrar</button>
              <button type="button" className="primary-button" onClick={printReportPreview}>Imprimir / guardar PDF</button>
            </footer>
          </div>
        </div>
      ) : null}

      {repairDialog ? (
        <div className="reset-modal-backdrop inventory-repair-backdrop" onClick={() => !processingRepair && setRepairDialog(null)}>
          <form className="reset-modal inventory-repair-modal" onSubmit={handleRepairSubmit} onClick={(event) => event.stopPropagation()}>
            <div className="inventory-repair-head">
              <div className="inventory-repair-icon" aria-hidden="true">↺</div>
              <div>
                <span>RECUPERACIÓN DE INVENTARIO</span>
                <h3>Reinsertar ítem reparado</h3>
                <p>Confirma únicamente las unidades que ya están físicamente reparadas.</p>
              </div>
              <button type="button" className="inventory-repair-close" aria-label="Cerrar" disabled={processingRepair} onClick={() => setRepairDialog(null)}>×</button>
            </div>

            <div className="inventory-repair-item">
              <div>
                <span>Ítem</span>
                <strong>{repairDialog.itemName}</strong>
                <small>{repairDialog.category || ''}</small>
              </div>
              <div>
                <span>Contrato</span>
                <strong>{repairDialog.contractCode || '-'}</strong>
                <small>{repairDialog.orderCode || ''}</small>
              </div>
            </div>

            <div className="inventory-repair-summary">
              <div><span>Daño registrado</span><strong>{repairDialog.quantity}</strong></div>
              <div><span>Ya reinsertado</span><strong>{repairDialog.repairedQty ?? 0}</strong></div>
              <div className="is-available"><span>Pendiente reparable</span><strong>{repairDialog.repairableQuantity}</strong></div>
            </div>

            <div className="inventory-repair-fields">
              <label>
                <span>Cantidad reparada</span>
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
                <span>Observación de reparación</span>
                <textarea value={repairNote} onChange={(event) => setRepairNote(event.target.value)} placeholder="Ej. costura reparada, pieza restaurada..." />
              </label>
            </div>

            <div className="inventory-repair-notice">
              <strong>Qué ocurrirá al confirmar</strong>
              <span>Se incrementará el stock físico total y el disponible. El daño original permanecerá en el kardex como historial.</span>
            </div>

            <div className="reset-modal-actions inventory-repair-actions">
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
