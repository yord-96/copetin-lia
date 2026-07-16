import { useMemo, useState } from 'react';

const PERIOD_OPTIONS = [
  '01 Jun 2024 - 30 Jun 2024',
  '01 May 2024 - 31 May 2024',
  '01 Apr 2024 - 30 Apr 2024',
];

const CATEGORY_OPTIONS = [
  'Todas las categorias',
  'Ventas',
  'Inventario',
  'Transporte',
  'Ordenes',
  'Mantenimiento',
  'Choferes',
  'Productos',
  'Stock',
];

const FORMAT_OPTIONS = ['PDF', 'Excel'];

const normalizeAuditSearchText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .toLowerCase()
    .trim();

const getAuditActionLabel = (action) => {
  if (action === 'create') return 'Creo';
  if (action === 'update') return 'Edito';
  if (action === 'delete') return 'Elimino';
  if (action === 'hide') return 'Oculto';
  if (action === 'restore') return 'Restauro';
  return 'Registro';
};

const REPORT_TEMPLATES = [
  { id: 'ventas', title: 'Ventas y Facturacion', description: 'Analisis de ventas, facturacion y cobranzas por periodo.', icon: 'money', category: 'Ventas', tone: 'lilac' },
  { id: 'inventario', title: 'Inventario', description: 'Movimientos, valuacion y stock por producto.', icon: 'box', category: 'Inventario', tone: 'mint' },
  { id: 'transporte', title: 'Transporte y Entregas', description: 'Rendimiento de flota, entregas y tiempos de viaje.', icon: 'truck', category: 'Transporte', tone: 'peach' },
  { id: 'ordenes', title: 'Ordenes de Servicio', description: 'Ordenes por estado, tecnico, cliente y periodo.', icon: 'clipboard', category: 'Ordenes', tone: 'sky' },
  { id: 'mantenimiento', title: 'Mantenimiento', description: 'Mantenimientos realizados, costos y proximos vencimientos.', icon: 'tool', category: 'Mantenimiento', tone: 'rose' },
  { id: 'choferes', title: 'Choferes', description: 'Rendimiento, licencias y actividad de choferes.', icon: 'user', category: 'Choferes', tone: 'violet' },
  { id: 'mas-vendidos', title: 'Productos Mas Vendidos', description: 'Ranking de productos por cantidad y valor vendido.', icon: 'bars', category: 'Productos', tone: 'amber' },
  { id: 'movimientos-stock', title: 'Movimientos de Stock', description: 'Ingresos, salidas y ajustes de inventario.', icon: 'file', category: 'Stock', tone: 'green' },
];

function ReportIcon({ kind }) {
  if (kind === 'money') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="M12 4v16M16 7.5a3.8 3.8 0 0 0-4-2.3c-2 0-3.5 1-3.5 2.6 0 1.7 1.5 2.4 3.5 2.9 2 .5 3.5 1.2 3.5 2.9 0 1.6-1.5 2.7-3.5 2.7a4.4 4.4 0 0 1-4.2-2.5" />
      </svg>
    );
  }
  if (kind === 'box') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 3 20 7.2v9.6L12 21l-8-4.2V7.2L12 3Z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 3v8m0 0 8-3.8M12 11 4 7.2" />
      </svg>
    );
  }
  if (kind === 'truck') {
    return <img className="asset-icon truck-asset-icon" src="/imagenes/camion.png" alt="" aria-hidden="true" />;
  }
  if (kind === 'warning') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 4 21 20H3L12 4Zm0 5v5m0 3h.01" />
      </svg>
    );
  }
  if (kind === 'clipboard') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M8 5h8v3H8zM6 8h12v12H6z" />
      </svg>
    );
  }
  if (kind === 'tool') {
    return <img className="asset-icon maintenance-asset-icon" src="/imagenes/herramientas-de-construccion.png" alt="" aria-hidden="true" />;
  }
  if (kind === 'user') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M5 19c1.8-3 4-4.5 7-4.5s5.2 1.5 7 4.5" />
      </svg>
    );
  }
  if (kind === 'bars') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M5 19V11M12 19V7M19 19V4" />
      </svg>
    );
  }
  if (kind === 'download') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="M12 5v10m0 0 4-4m-4 4-4-4M5 19h14" />
      </svg>
    );
  }
  if (kind === 'dots') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="6" r="1.4" fill="currentColor" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" />
        <circle cx="12" cy="18" r="1.4" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M7 4h10l2 2v14H5V4h2Zm0 0v4h10" />
    </svg>
  );
}

function RecibosSection({
  receipts = [],
  generatedReports = [],
  auditLog = [],
  formatBs,
  formatDateTime,
  onPrintRentalReceipt,
  onPrintReturnReceipt,
  onGenerateReport,
}) {
  const [periodFilter, setPeriodFilter] = useState(PERIOD_OPTIONS[0]);
  const [categoryFilter, setCategoryFilter] = useState(CATEGORY_OPTIONS[0]);
  const [formatFilter, setFormatFilter] = useState(FORMAT_OPTIONS[0]);
  const [auditQuery, setAuditQuery] = useState('');

  const salesTotal = useMemo(
    () => receipts
      .filter((receipt) => receipt.type === 'alquiler')
      .reduce((sum, receipt) => sum + Number(receipt.totalBs ?? 0), 0),
    [receipts],
  );

  const pendingReceipts = useMemo(
    () => receipts.filter((receipt) => Number(receipt.pendingPaymentBs ?? 0) > 0).length,
    [receipts],
  );

  const incidents = useMemo(
    () => receipts.filter((receipt) => receipt.type === 'devolucion' && Number(receipt.penaltiesBs ?? 0) > 0).length,
    [receipts],
  );

  const recentReports = useMemo(() => {
    if (generatedReports.length > 0) {
      return generatedReports.map((report) => ({
        id: report.id,
        name: report.name,
        period: report.periodFrom && report.periodTo
          ? `${report.periodFrom} - ${report.periodTo}`
          : 'Periodo libre',
        generatedBy: report.generatedBy,
        generatedAt: formatDateTime(report.generatedAt),
        format: report.format,
        category: report.category,
        sourceType: report.sourceType,
        sourceId: report.sourceId,
      }));
    }

    return receipts.map((receipt) => ({
      id: `receipt-${receipt.id}`,
      name: receipt.type === 'devolucion'
        ? `Devolucion ${receipt.orderCode} - ${receipt.customerName}`
        : `Orden ${receipt.orderCode} - ${receipt.customerName}`,
      period: receipt.dueDate ? `${receipt.createdAt?.slice(0, 10)} - ${receipt.dueDate}` : 'Periodo libre',
      generatedBy: 'Yordy Copa Cerezo',
      generatedAt: formatDateTime(receipt.createdAt),
      format: receipt.type === 'devolucion' ? 'PDF' : 'Excel',
      category: receipt.type === 'devolucion' ? 'Stock' : 'Ventas',
      sourceType: receipt.type,
      sourceId: receipt.rentalId,
    }));
  }, [formatDateTime, generatedReports, receipts]);

  const filteredRecentReports = useMemo(
    () => recentReports.filter((report) => {
      const categoryMatch = categoryFilter === 'Todas las categorias' || report.category === categoryFilter;
      const formatMatch = report.format === formatFilter;
      return categoryMatch && formatMatch;
    }),
    [categoryFilter, formatFilter, recentReports],
  );

  const auditRows = useMemo(
    () => auditLog.map((entry) => ({
      id: entry.id,
      action: String(entry.action ?? 'update').trim(),
      module: entry.module || 'Sistema',
      userName: entry.userName || 'Sistema',
      userRole: entry.userRole || '',
      title: entry.title || 'Actividad registrada',
      detail: entry.detail || (Array.isArray(entry.changes) ? entry.changes[0] : '') || '-',
      changes: Array.isArray(entry.changes) ? entry.changes.map((change) => String(change ?? '').trim()).filter(Boolean) : [],
      entityCode: entry.entityCode || '',
      entityId: entry.entityId || '',
      createdAt: formatDateTime(entry.createdAt),
      rawCreatedAt: entry.createdAt,
    })),
    [auditLog, formatDateTime],
  );

  const filteredAuditLog = useMemo(() => {
    const tokens = normalizeAuditSearchText(auditQuery).split(' ').filter(Boolean);
    const source = auditRows.slice().sort((a, b) => new Date(b.rawCreatedAt) - new Date(a.rawCreatedAt));
    if (tokens.length === 0) return source.slice(0, 80);

    return source
      .filter((entry) => {
        const haystack = normalizeAuditSearchText([
          entry.createdAt,
          entry.userName,
          entry.userRole,
          getAuditActionLabel(entry.action),
          entry.module,
          entry.title,
          entry.detail,
          entry.entityCode,
          entry.entityId,
          ...entry.changes,
        ].join(' '));
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 120);
  }, [auditQuery, auditRows]);

  const kpiCards = [
    { tone: 'lilac', icon: 'money', value: formatBs(salesTotal), label: 'Ventas del mes', trend: `+ ${pendingReceipts} saldos pendientes`, trendTone: 'up' },
    { tone: 'sky', icon: 'box', value: `${receipts.filter((receipt) => receipt.type === 'alquiler').length}`, label: 'Ordenes facturadas', trend: '+ Operacion activa', trendTone: 'up' },
    { tone: 'mint', icon: 'truck', value: `${receipts.filter((receipt) => receipt.type === 'devolucion').length}`, label: 'Devoluciones procesadas', trend: '+ Flujo estable', trendTone: 'up' },
    { tone: 'peach', icon: 'warning', value: String(incidents), label: 'Incidencias este mes', trend: incidents > 0 ? '- Requiere seguimiento' : '+ Sin incidencias', trendTone: incidents > 0 ? 'down' : 'up' },
  ];

  const handlePrintReport = (report) => {
    if (!report?.sourceId) return;
    if (report.sourceType === 'devolucion') {
      onPrintReturnReceipt?.(report.sourceId);
      return;
    }
    onPrintRentalReceipt?.(report.sourceId);
  };

  const handleGenerate = async (template) => {
    await onGenerateReport?.({
      name: template.title,
      category: template.category,
      format: formatFilter,
      generatedBy: 'Yordy Copa Cerezo',
    });
  };

  const handleResetFilters = () => {
    setPeriodFilter(PERIOD_OPTIONS[0]);
    setCategoryFilter(CATEGORY_OPTIONS[0]);
    setFormatFilter(FORMAT_OPTIONS[0]);
  };

  return (
    <section className="panel reports-view">
      <header className="reports-header">
        <div>
          <h2>Reportes</h2>
          <p>Analiza el rendimiento de tu negocio con reportes detallados.</p>
        </div>
        <button type="button" className="primary-button reports-custom-button">
          + Generar Reporte Personalizado
        </button>
      </header>

      <div className="reports-kpi-grid">
        {kpiCards.map((card) => (
          <article key={card.label} className={`reports-kpi-card ${card.tone}`}>
            <span className={`reports-kpi-icon ${card.tone}`}>
              <ReportIcon kind={card.icon} />
            </span>
            <strong>{card.value}</strong>
            <p>{card.label}</p>
            <small className={card.trendTone}>{card.trend}</small>
          </article>
        ))}
      </div>

      <article className="reports-filter-card">
        <div className="reports-filter-grid">
          <label>
            Periodo
            <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
              {PERIOD_OPTIONS.map((period) => (
                <option key={period} value={period}>{period}</option>
              ))}
            </select>
          </label>

          <label>
            Categoria
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              {CATEGORY_OPTIONS.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>

          <label>
            Formato
            <select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)}>
              {FORMAT_OPTIONS.map((format) => (
                <option key={format} value={format}>{format}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="reports-filter-actions">
          <button type="button" className="link-button" onClick={handleResetFilters}>
            Limpiar filtros
          </button>
          <button type="button" className="primary-button">
            + Aplicar filtros
          </button>
        </div>
      </article>

      <article className="reports-catalog-card">
        <h3>Reportes Disponibles</h3>
        <div className="reports-catalog-grid">
          {REPORT_TEMPLATES.map((template) => (
            <article key={template.id} className="reports-template-card">
              <span className={`reports-template-icon ${template.tone}`}>
                <ReportIcon kind={template.icon} />
              </span>
              <h4>{template.title}</h4>
              <p>{template.description}</p>
              <button type="button" className="ghost-button reports-template-button" onClick={() => handleGenerate(template)}>
                Generar
              </button>
            </article>
          ))}
        </div>
      </article>

      <article className="reports-recent-card reports-audit-card">
        <header className="reports-recent-head">
          <div>
            <h3>Bitacora del sistema</h3>
            <p>Registro de creaciones, ediciones, eliminaciones y validaciones importantes.</p>
          </div>
        </header>

        <div className="reports-audit-search">
          <label>
            Buscar en bitacora
            <input
              type="search"
              value={auditQuery}
              onChange={(event) => setAuditQuery(event.target.value)}
              placeholder="Producto, contrato, usuario, modulo o detalle..."
            />
          </label>
          <div>
            <strong>{filteredAuditLog.length}</strong>
            <span>{auditQuery.trim() ? 'resultado(s)' : 'ultimos registros'}</span>
          </div>
          {auditQuery.trim() ? (
            <button type="button" className="link-button" onClick={() => setAuditQuery('')}>
              Limpiar
            </button>
          ) : null}
        </div>

        <div className="reports-recent-table-wrap">
          <table className="reports-recent-table reports-audit-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Accion</th>
                <th>Modulo</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filteredAuditLog.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <p className="status">
                      {auditQuery.trim()
                        ? 'No hay registros que coincidan con la busqueda.'
                        : 'Todavia no hay movimientos registrados en la bitacora.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredAuditLog.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.createdAt}</td>
                    <td>
                      <div className="reports-audit-user">
                        <strong>{entry.userName}</strong>
                        <span>{entry.userRole}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`reports-audit-chip ${entry.action}`}>
                        {getAuditActionLabel(entry.action)}
                      </span>
                    </td>
                    <td>{entry.module}</td>
                    <td>
                      <div className="reports-audit-detail">
                        <strong>{entry.title}</strong>
                        <span>{entry.detail}</span>
                        {entry.changes.length > 0 ? (
                          <ul>
                            {entry.changes.slice(0, 8).map((change, index) => (
                              <li key={`${entry.id}-change-${index}`}>{change}</li>
                            ))}
                            {entry.changes.length > 8 ? <li>+ {entry.changes.length - 8} cambio(s) mas</li> : null}
                          </ul>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="reports-recent-card">
        <header className="reports-recent-head">
          <h3>Reportes Recientes</h3>
          <button type="button" className="link-button">
            Ver todos
          </button>
        </header>

        <div className="reports-recent-table-wrap">
          <table className="reports-recent-table">
            <thead>
              <tr>
                <th>Nombre del Reporte</th>
                <th>Periodo</th>
                <th>Generado por</th>
                <th>Fecha de Generacion</th>
                <th>Formato</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecentReports.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <p className="status">No hay reportes con esos filtros.</p>
                  </td>
                </tr>
              ) : (
                filteredRecentReports.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <div className="reports-recent-name-cell">
                        <span className="reports-row-icon lilac">
                          <ReportIcon kind="file" />
                        </span>
                        <div className="reports-recent-name-wrap">
                          <div className="reports-recent-name">{report.name}</div>
                        </div>
                      </div>
                    </td>
                    <td>{report.period}</td>
                    <td>{report.generatedBy}</td>
                    <td>{report.generatedAt}</td>
                    <td>
                      <span className={`report-format-chip ${String(report.format).toLowerCase()}`}>
                        {report.format}
                      </span>
                    </td>
                    <td>
                      <div className="reports-actions-cell">
                        <button
                          type="button"
                          className="reports-icon-button"
                          onClick={() => handlePrintReport(report)}
                          aria-label="Descargar reporte"
                        >
                          <ReportIcon kind="download" />
                        </button>
                        <button type="button" className="reports-icon-button" aria-label="Mas acciones">
                          <ReportIcon kind="dots" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

export default RecibosSection;
