import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Filter, X } from 'lucide-react';
import { DAILY_CASH_COLUMNS, dailyCashCellText, getDailyCashFilterOptions, totalDailyCashRows } from '../utils/dailyCashReport';

function ColumnFilter({ column, rows, selected, position, onApply, onClose, formatBs }) {
  const [search, setSearch] = useState('');
  const options = useMemo(() => getDailyCashFilterOptions(rows, column, '', formatBs), [rows, column, formatBs]);
  const [draft, setDraft] = useState(() => new Set(selected ?? options.map(({ value }) => value)));
  const visibleOptions = getDailyCashFilterOptions(rows, column, search, formatBs);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  useEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
    const outside = (event) => {
      if (!panelRef.current?.contains(event.target) && !event.target.closest?.('.daily-column-filter-trigger')) onClose();
    };
    const escape = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  const toggle = (value) => setDraft((current) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });
  const allVisibleSelected = visibleOptions.length > 0 && visibleOptions.every(({ value }) => draft.has(value));
  return createPortal(
    <section ref={panelRef} className="daily-column-filter-panel" role="dialog" aria-label={`Filtrar ${column.label}`} style={position}>
      <header><strong>{column.label}</strong><button type="button" onClick={onClose} aria-label="Cerrar filtro"><X size={17} /></button></header>
      <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar valores..." aria-label={`Buscar en ${column.label}`} />
      <label className="daily-filter-select-all"><input type="checkbox" checked={allVisibleSelected} onChange={() => setDraft((current) => {
        const next = new Set(current);
        visibleOptions.forEach(({ value }) => { if (allVisibleSelected) next.delete(value); else next.add(value); });
        return next;
      })} />{search ? 'Seleccionar resultados' : 'Seleccionar todo'}</label>
      <div className="daily-filter-options">
        {visibleOptions.map(({ value, label }) => <label key={value}><input type="checkbox" checked={draft.has(value)} onChange={() => toggle(value)} /><span>{label}</span></label>)}
        {!visibleOptions.length && <p>Sin valores coincidentes.</p>}
      </div>
      <small>{draft.size} valor(es) seleccionado(s)</small>
      <footer><button type="button" onClick={() => onApply(null)}>Quitar filtro</button><button type="button" className="apply" onClick={() => onApply(options.every(({ value }) => draft.has(value)) ? null : [...draft])}>Aplicar</button></footer>
    </section>, document.body,
  );
}

export default function DailyCashTable({ allRows, rows, filters, onFiltersChange, formatBs }) {
  const [openFilter, setOpenFilter] = useState(null);
  const triggerRef = useRef(null);
  const totals = totalDailyCashRows(rows);
  const filterCount = Object.keys(filters).length;
  const closeFilter = useMemo(() => () => {
    setOpenFilter(null);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);
  const open = (event, column) => {
    if (openFilter?.column.key === column.key) { closeFilter(); return; }
    triggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    setOpenFilter({ column, position: { width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 440)), maxHeight: window.innerHeight - 24 } });
  };
  return <>
    <div className="daily-table-filter-summary" aria-live="polite">
      <span><strong>{rows.length}</strong> de {allRows.length} movimientos{filterCount ? ` · ${filterCount} filtro(s) activo(s)` : ''}</span>
      {filterCount ? <button type="button" onClick={() => { onFiltersChange({}); closeFilter(); }}>Limpiar filtros</button> : <small>Filtra desde los encabezados. El reporte y el Excel incluyen los resultados visibles.</small>}
    </div>
    <div className="bigcash-table-wrap daily-report-table-wrap">
      <table className="accounting-table bigcash-table daily-report-table">
        <thead><tr>{DAILY_CASH_COLUMNS.map((column) => <th key={column.key} scope="col" className={`daily-col-${column.key}`}>
          <button type="button" className={`daily-column-filter-trigger${filters[column.key] ? ' is-active' : ''}`} onClick={(event) => open(event, column)} aria-label={`Filtrar ${column.label}${filters[column.key] ? ' (activo)' : ''}`} aria-haspopup="dialog" aria-expanded={openFilter?.column.key === column.key}>
            <span>{column.label}</span><Filter size={12} aria-hidden="true" />
          </button>
        </th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => <tr key={row.id ?? index}>{DAILY_CASH_COLUMNS.map((column) => <td key={column.key} className={`daily-col-${column.key} ${column.money ? 'daily-money-cell' : ''} ${column.tone === 'out' && row[column.key] != null ? 'daily-expense-cell' : ''} ${column.tone === 'income' ? 'daily-revenue-cell' : ''} ${column.key === 'nature' && row.expense != null ? 'daily-expense-text' : column.key === 'nature' && row.income != null ? 'daily-revenue-text' : ''}`}>
            {dailyCashCellText(column, row[column.key], formatBs)}
          </td>)}</tr>)}
          {!rows.length && <tr><td colSpan={14}><p className="status">{allRows.length ? 'No hay movimientos que coincidan con los filtros.' : 'No hay movimientos confirmados para este día.'}</p></td></tr>}
        </tbody>
        <tfoot><tr><th scope="row" colSpan={6}>TOTAL {filterCount ? 'FILTRADO' : 'DEL DÍA'}</th>{DAILY_CASH_COLUMNS.slice(6).map((column) => <td key={column.key} className={`daily-col-${column.key} daily-money-cell ${column.tone === 'out' ? 'daily-expense-cell' : column.tone === 'income' ? 'daily-revenue-cell' : ''}`}>
          {column.money ? formatBs(totals[column.key]) : ''}
        </td>)}</tr></tfoot>
      </table>
    </div>
    {openFilter && <ColumnFilter key={openFilter.column.key} {...openFilter} rows={allRows} selected={filters[openFilter.column.key]} formatBs={formatBs} onClose={closeFilter} onApply={(values) => {
      const next = { ...filters };
      if (values === null) delete next[openFilter.column.key]; else next[openFilter.column.key] = values;
      onFiltersChange(next);
      closeFilter();
    }} />}
  </>;
}
