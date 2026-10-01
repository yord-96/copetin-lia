import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Filter, X } from 'lucide-react';
import { DAILY_CASH_COLUMNS, dailyCashCellText, getDailyCashFilterOptions, totalDailyCashRows } from '../utils/dailyCashReport';

function FilterValues({ column, rows, selected, formatBs, onApply }) {
  const [search, setSearch] = useState('');
  const options = useMemo(
    () => getDailyCashFilterOptions(rows, column, '', formatBs),
    [rows, column, formatBs],
  );
  const [draft, setDraft] = useState(() => new Set(selected ?? options.map(({ value }) => value)));
  const visibleOptions = useMemo(
    () => getDailyCashFilterOptions(rows, column, search, formatBs),
    [rows, column, search, formatBs],
  );
  const searchRef = useRef(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  const allVisibleSelected = visibleOptions.length > 0
    && visibleOptions.every(({ value }) => draft.has(value));

  const toggle = (value) => setDraft((current) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });

  const apply = () => {
    const allSelected = options.every(({ value }) => draft.has(value));
    onApply(allSelected ? null : [...draft]);
  };

  return <div className="daily-filters-values">
    <div className="daily-filters-values-head">
      <div>
        <small>Filtrar columna</small>
        <strong>{column.label}</strong>
      </div>
    </div>

    <input
      ref={searchRef}
      value={search}
      onChange={(event) => setSearch(event.target.value)}
      placeholder="Buscar valores..."
      aria-label={`Buscar en ${column.label}`}
    />

    <label className="daily-filter-select-all">
      <input
        type="checkbox"
        checked={allVisibleSelected}
        onChange={() => setDraft((current) => {
          const next = new Set(current);
          visibleOptions.forEach(({ value }) => {
            if (allVisibleSelected) next.delete(value);
            else next.add(value);
          });
          return next;
        })}
      />
      <span>{search ? 'Seleccionar resultados' : 'Seleccionar todo'}</span>
    </label>

    <div className="daily-filter-options">
      {visibleOptions.map(({ value, label }) => <label key={value}>
        <input type="checkbox" checked={draft.has(value)} onChange={() => toggle(value)} />
        <span>{label}</span>
      </label>)}
      {!visibleOptions.length && <p>Sin valores coincidentes.</p>}
    </div>

    <div className="daily-filters-values-meta">{draft.size} valor(es) seleccionado(s)</div>

    <footer>
      <button type="button" onClick={() => onApply(null)}>Quitar filtro</button>
      <button type="button" className="apply" onClick={apply}>Aplicar</button>
    </footer>
  </div>;
}

function DailyFiltersPanel({ rows, filters, position, formatBs, onFiltersChange, onClose }) {
  const panelRef = useRef(null);
  const initialColumn = DAILY_CASH_COLUMNS.find((column) => filters[column.key]) ?? DAILY_CASH_COLUMNS[0];
  const [columnKey, setColumnKey] = useState(initialColumn.key);
  const column = DAILY_CASH_COLUMNS.find((item) => item.key === columnKey) ?? DAILY_CASH_COLUMNS[0];

  useEffect(() => {
    const outside = (event) => {
      if (
        !panelRef.current?.contains(event.target)
        && !event.target.closest?.('.daily-filters-toolbar-button')
      ) onClose();
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

  return createPortal(
    <section ref={panelRef} className="daily-filters-panel" role="dialog" aria-label="Filtros del reporte diario" style={position}>
      <header className="daily-filters-panel-head">
        <div>
          <span>REPORTE DIARIO</span>
          <strong>Filtrar movimientos</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar filtros"><X size={17} /></button>
      </header>

      <div className="daily-filters-panel-body">
        <nav className="daily-filters-columns" aria-label="Columnas disponibles">
          {DAILY_CASH_COLUMNS.map((item) => {
            const active = Boolean(filters[item.key]);
            return <button
              key={item.key}
              type="button"
              className={`${item.key === columnKey ? 'is-selected' : ''}${active ? ' is-filtered' : ''}`}
              onClick={() => setColumnKey(item.key)}
            >
              <span>{item.label}</span>
              {active && <b aria-label="Filtro activo">•</b>}
            </button>;
          })}
        </nav>

        <FilterValues
          key={`${column.key}-${JSON.stringify(filters[column.key] ?? null)}`}
          column={column}
          rows={rows}
          selected={filters[column.key]}
          formatBs={formatBs}
          onApply={(values) => {
            const next = { ...filters };
            if (values === null) delete next[column.key];
            else next[column.key] = values;
            onFiltersChange(next);
          }}
        />
      </div>
    </section>,
    document.body,
  );
}

export default function DailyCashTable({ allRows, rows, filters, onFiltersChange, formatBs, onFundIncome, onFundDelivery }) {
  const [filtersOpen, setFiltersOpen] = useState(null);
  const triggerRef = useRef(null);
  const totals = totalDailyCashRows(rows);
  const filterCount = Object.keys(filters).length;

  const closeFilters = useMemo(() => () => {
    setFiltersOpen(null);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const toggleFilters = (event) => {
    if (filtersOpen) {
      closeFilters();
      return;
    }
    triggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(620, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 560));
    setFiltersOpen({ width, left, top, maxHeight: window.innerHeight - top - 12 });
  };

  return <>
    <div className="daily-table-filter-summary" aria-live="polite">
      <span><strong>{rows.length}</strong> de {allRows.length} movimientos{filterCount ? ` · ${filterCount} filtro(s) activo(s)` : ''}</span>
      <div className="daily-filter-toolbar">
        <button type="button" className="daily-fund-action income" onClick={onFundIncome}>Ingreso fondos</button>
        <button type="button" className="daily-fund-action delivery" onClick={onFundDelivery}>Entrega fondos</button>
        {filterCount > 0 && <button
          type="button"
          className="daily-filter-clear-button"
          onClick={() => { onFiltersChange({}); closeFilters(); }}
        >Limpiar</button>}
        <button
          ref={triggerRef}
          type="button"
          className={`daily-filters-toolbar-button${filtersOpen ? ' is-open' : ''}${filterCount ? ' has-active' : ''}`}
          onClick={toggleFilters}
          aria-haspopup="dialog"
          aria-expanded={Boolean(filtersOpen)}
        >
          <Filter size={15} aria-hidden="true" />
          <span>Filtros</span>
          {filterCount > 0 && <b>{filterCount}</b>}
        </button>
      </div>
    </div>

    <div className="bigcash-table-wrap daily-report-table-wrap">
      <table className="accounting-table bigcash-table daily-report-table">
        <thead><tr>{DAILY_CASH_COLUMNS.map((column) => <th
          key={column.key}
          scope="col"
          className={`daily-col-${column.key}${filters[column.key] ? ' is-filtered' : ''}`}
          title={filters[column.key] ? `${column.label}: filtro activo` : column.label}
        >
          <span className="daily-header-label">{column.label}</span>
        </th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => <tr key={row.id ?? index}>{DAILY_CASH_COLUMNS.map((column) => <td key={column.key} className={`daily-col-${column.key} ${(column.money || column.balance) ? 'daily-money-cell' : ''} ${column.tone === 'out' && row[column.key] != null ? 'daily-expense-cell' : ''} ${column.tone === 'income' ? 'daily-revenue-cell' : ''} ${column.key === 'nature' && row.expense != null ? 'daily-expense-text' : column.key === 'nature' && row.income != null ? 'daily-revenue-text' : ''}`}>
            {column.balance && row.fund != null ? <span className="daily-fund-cell"><strong>{formatBs(row.fund)}</strong><small>Efec. {formatBs(row.fundCash ?? 0)} · Digital {formatBs(row.fundDigital ?? 0)}</small></span> : dailyCashCellText(column, row[column.key], formatBs)}
          </td>)}</tr>)}
          {!rows.length && <tr><td colSpan={DAILY_CASH_COLUMNS.length}><p className="status">{allRows.length ? 'No hay movimientos que coincidan con los filtros.' : 'No hay movimientos confirmados para este día.'}</p></td></tr>}
        </tbody>
        <tfoot><tr><th scope="row" colSpan={6}>TOTAL {filterCount ? 'FILTRADO' : 'DEL DÍA'}</th>{DAILY_CASH_COLUMNS.slice(6).map((column) => <td key={column.key} className={`daily-col-${column.key} daily-money-cell ${column.tone === 'out' ? 'daily-expense-cell' : column.tone === 'income' ? 'daily-revenue-cell' : ''}`}>
          {column.money ? formatBs(totals[column.key]) : column.balance ? formatBs(rows.length ? rows[rows.length - 1].fund ?? 0 : 0) : ''}
        </td>)}</tr></tfoot>
      </table>
    </div>

    {filtersOpen && <DailyFiltersPanel
      rows={allRows}
      filters={filters}
      position={filtersOpen}
      formatBs={formatBs}
      onFiltersChange={onFiltersChange}
      onClose={closeFilters}
    />}
  </>;
}
