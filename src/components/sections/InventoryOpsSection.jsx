import { useMemo, useState } from 'react';

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

function InventoryOpsSection({ damageLossOverview = { rows: [], total: 0, summary: {} }, formatBs }) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [query, setQuery] = useState('');
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
    const value = Math.max(0, Number(row.totalValueBs ?? 0));
    acc.totalUnits += qty;
    acc.totalValueBs += value;
    if (row.lossType === 'danado') { acc.damagedUnits += qty; acc.damagedValueBs += value; }
    else { acc.missingUnits += qty; acc.missingValueBs += value; }
    return acc;
  }, { totalUnits: 0, totalValueBs: 0, damagedUnits: 0, damagedValueBs: 0, missingUnits: 0, missingValueBs: 0 }), [filteredRows]);

  return (
    <section className="panel inventory-ops-panel inventory-loss-panel">
      <div className="inventory-ops-cards inventory-loss-cards">
        <article className="stat-card"><h2>Unidades Perdidas</h2><p>{summary.totalUnits}</p><small>Dañadas + faltantes</small></article>
        <article className="stat-card"><h2>Dañadas</h2><p>{summary.damagedUnits}</p><small>{formatBs(summary.damagedValueBs)}</small></article>
        <article className="stat-card"><h2>Faltantes</h2><p>{summary.missingUnits}</p><small>{formatBs(summary.missingValueBs)}</small></article>
        <article className="stat-card"><h2>Valor Registrado</h2><p>{formatBs(summary.totalValueBs)}</p><small>Según cargos de devolución</small></article>
      </div>

      <article className="inventory-ops-table-card inventory-loss-card">
        <div className="inventory-loss-head">
          <div>
            <h2>Kardex de daños y faltantes</h2>
            <p>Solo muestra pérdidas confirmadas al recibir una orden. Los ítems que vuelven bien regresan al disponible de inmediato.</p>
          </div>
          <strong>{filteredRows.length} registro(s)</strong>
        </div>

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
                <th>Fecha</th><th>Tipo</th><th>Item</th><th>Cant.</th><th>Valor unit.</th><th>Valor</th><th>Contrato / orden</th><th>Cliente</th><th>Observación</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.occurredAt)}</td>
                  <td><span className={`inventory-loss-badge ${row.lossType}`}>{row.lossType === 'danado' ? 'Dañado' : 'Faltante'}</span></td>
                  <td><strong>{row.itemName}</strong><small>{row.category || ''}</small></td>
                  <td>{row.quantity}</td>
                  <td>{formatBs(row.unitValueBs)}</td>
                  <td><strong>{formatBs(row.totalValueBs)}</strong></td>
                  <td><strong>{row.contractCode || '-'}</strong><small>{row.orderCode || ''}</small></td>
                  <td>{row.customerName || '-'}</td>
                  <td>{row.note || 'Sin observación'}</td>
                </tr>
              ))}
              {filteredRows.length === 0 ? <tr><td colSpan="9" className="inventory-loss-empty">No hay daños o faltantes para este filtro.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

export default InventoryOpsSection;
