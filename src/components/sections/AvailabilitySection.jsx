import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  PackageCheck,
  PackageSearch,
  Search,
  ShieldCheck,
  Truck,
  UsersRound,
  XCircle,
} from 'lucide-react';
import { buildAvailabilityPeriod, getProjectedInventoryAvailability, toDateKey } from '../../utils/availability';
import { getInventoryAreaLabel, INVENTORY_AREAS, resolveInventoryArea } from '../../utils/inventoryArea';
import ProductImage from '../common/ProductImage';

const PAGE_SIZE = 24;

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const normalizeSearchText = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getSearchTokens = (value) => normalizeSearchText(value).split(' ').filter(Boolean);

const matchesSearchTokens = (value, searchValue) => {
  const tokens = getSearchTokens(searchValue);
  if (tokens.length === 0) return true;
  const haystack = normalizeSearchText(value);
  return tokens.every((token) => haystack.includes(token));
};

const pad2 = (value) => String(value).padStart(2, '0');

const dateKeyFromParts = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

const todayKey = () => toDateKey(new Date());

const monthLabel = (date) =>
  date.toLocaleDateString('es-BO', { month: 'long', year: 'numeric' }).replace(/^./, (letter) => letter.toUpperCase());

const getMonthGrid = (referenceDate) => {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const firstDay = new Date(year, month, 1, 12);
  const lastDay = new Date(year, month + 1, 0, 12);
  const mondayIndex = (firstDay.getDay() + 6) % 7;
  const cells = [];

  for (let offset = mondayIndex; offset > 0; offset -= 1) {
    const date = new Date(year, month, 1 - offset, 12);
    cells.push({
      date,
      key: dateKeyFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate()),
      inMonth: false,
    });
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(year, month, day, 12);
    cells.push({ date, key: dateKeyFromParts(year, month + 1, day), inMonth: true });
  }

  while (cells.length % 7 !== 0 || cells.length < 42) {
    const previous = cells[cells.length - 1].date;
    const date = new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() + 1, 12);
    cells.push({
      date,
      key: dateKeyFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate()),
      inMonth: false,
    });
  }

  return cells;
};

const lineSupplierQuantity = (line) => Math.max(0, Math.trunc(Number(line?.supplierBackedQty ?? 0)));

const recordPeriod = (record = {}) =>
  buildAvailabilityPeriod({
    deliveryDate: record.deliveryDate || record.rentalDate || record.eventDate || record.createdAt,
    deliveryWindowStart: record.deliveryWindowStart || record.eventTime || '00:00',
    pickupDate: record.pickupDate || record.dueDate || record.validUntil || record.eventDate || record.deliveryDate,
    pickupWindowEnd: record.pickupWindowEnd || record.dueTime || record.eventTime || '23:59',
  });

const periodsOverlap = (left, right) =>
  Number.isFinite(left?.start)
  && Number.isFinite(left?.end)
  && Number.isFinite(right?.start)
  && Number.isFinite(right?.end)
  && left.start < right.end
  && left.end > right.start;

const getRecordLocation = (record = {}, clientById = new Map()) => {
  const client = clientById.get(String(record.clientId ?? ''));
  return (
    record.eventAddress
    || record.deliveryAddress
    || record.serviceAddress
    || record.address
    || record.destination
    || client?.address
    || record.city
    || client?.city
    || 'Sin ubicación registrada'
  );
};

const getStatusMeta = (row) => {
  if (!row.stockControlled) return { key: 'uncontrolled', label: 'Sin control', tone: 'neutral' };
  if (row.projectedAvailable <= 0) return { key: 'empty', label: 'Agotado', tone: 'danger' };
  const ratio = row.totalStock > 0 ? row.projectedAvailable / row.totalStock : 0;
  if (ratio <= 0.25) return { key: 'limited', label: 'Limitado', tone: 'warning' };
  return { key: 'available', label: 'Disponible', tone: 'success' };
};

const formatTimeRange = (record) => {
  const start = record?.deliveryWindowStart || record?.eventTime || '00:00';
  const end = record?.pickupWindowEnd || record?.dueTime || record?.eventTime || '23:59';
  return `${start} - ${end}`;
};

function AvailabilitySection({
  items = [],
  contracts = [],
  rentals = [],
  quotes = [],
  clients = [],
  categories = [],
  formatDate,
  onOpenImage,
}) {
  const initialDate = todayKey();
  const [mode, setMode] = useState('date');
  const [dateFrom, setDateFrom] = useState(initialDate);
  const [dateTo, setDateTo] = useState(initialDate);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [expandedItemId, setExpandedItemId] = useState('');
  const [quickItemId, setQuickItemId] = useState('');
  const [quickQuery, setQuickQuery] = useState('');
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickQuantity, setQuickQuantity] = useState('1');
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(initialDate);

  const clientById = useMemo(
    () => new Map((Array.isArray(clients) ? clients : []).map((client) => [String(client.id), client])),
    [clients],
  );
  const contractById = useMemo(
    () => new Map((Array.isArray(contracts) ? contracts : []).map((record) => [String(record.id), record])),
    [contracts],
  );
  const rentalById = useMemo(
    () => new Map((Array.isArray(rentals) ? rentals : []).map((record) => [String(record.id), record])),
    [rentals],
  );
  const quoteById = useMemo(
    () => new Map((Array.isArray(quotes) ? quotes : []).map((record) => [String(record.id), record])),
    [quotes],
  );

  const period = useMemo(
    () => buildAvailabilityPeriod({
      deliveryDate: dateFrom,
      deliveryWindowStart: '00:00',
      pickupDate: dateTo || dateFrom,
      pickupWindowEnd: '23:59',
    }),
    [dateFrom, dateTo],
  );

  const availability = useMemo(
    () => getProjectedInventoryAvailability({ items, rentals, contracts, quotes, period }),
    [items, rentals, contracts, quotes, period],
  );

  const commitmentRecords = useMemo(() => {
    const records = [];
    const linkedContractByRental = new Map();
    const linkedContractByOrder = new Map();
    contracts.forEach((contract) => {
      if (contract?.rentalId) linkedContractByRental.set(String(contract.rentalId), contract);
      if (contract?.orderCode) linkedContractByOrder.set(String(contract.orderCode), contract);
    });

    rentals.forEach((rental) => {
      if (!rental || rental.deletedAt || ['returned', 'cancelled'].includes(String(rental.status))) return;
      const linked = linkedContractByRental.get(String(rental.id)) || linkedContractByOrder.get(String(rental.orderCode));
      records.push({
        ...rental,
        sourceType: 'orden',
        sourceTone: 'confirmed',
        contractCode: linked?.contractCode || rental.contractCode || '',
        contractId: linked?.id || rental.contractId || '',
        eventType: linked?.eventType || rental.eventType || '',
        city: linked?.city || rental.city || '',
        address: linked?.address || rental.address || rental.eventAddress || '',
        period: recordPeriod({ ...rental, ...linked, rentalDate: rental.rentalDate, dueDate: rental.dueDate }),
      });
    });

    contracts.forEach((contract) => {
      if (!contract || contract.deletedAt || contract.rentalId || contract.orderCode) return;
      const status = String(contract.status ?? '').toLowerCase();
      if (!['aprobado', 'pendiente', 'borrador'].includes(status)) return;
      records.push({
        ...contract,
        sourceType: 'contrato',
        sourceTone: status === 'aprobado' ? 'confirmed' : 'tentative',
        period: recordPeriod(contract),
      });
    });

    quotes.forEach((quote) => {
      if (!quote || quote.deletedAt || quote.rentalId || quote.orderCode) return;
      const status = String(quote.status ?? '').toLowerCase();
      if (!['enviada', 'borrador'].includes(status)) return;
      records.push({ ...quote, sourceType: 'cotizacion', sourceTone: 'tentative', period: recordPeriod(quote) });
    });

    return records.filter((record) => periodsOverlap(record.period, period));
  }, [contracts, rentals, quotes, period]);

  const supplierByItem = useMemo(() => {
    const map = new Map();
    commitmentRecords.forEach((record) => {
      (Array.isArray(record.items) ? record.items : []).forEach((line) => {
        const itemId = String(line?.itemId ?? '').trim();
        const quantity = lineSupplierQuantity(line);
        if (!itemId || quantity <= 0) return;
        map.set(itemId, (map.get(itemId) ?? 0) + quantity);
      });
    });
    return map;
  }, [commitmentRecords]);

  const rows = useMemo(() => {
    return (Array.isArray(items) ? items : []).map((item) => {
      const summary = availability.get(item.id) || {
        itemId: item.id,
        itemName: item.name,
        stockControlled: false,
        totalStock: 0,
        currentAvailable: 0,
        hardReservedQty: 0,
        softReservedQty: 0,
        projectedAvailable: 0,
        projectedAfterSoftAvailable: 0,
        hardReservedQtyRecords: [],
        softReservedQtyRecords: [],
      };
      const area = resolveInventoryArea(item);
      const supplierQty = supplierByItem.get(String(item.id)) ?? 0;
      const occupiedPercent = summary.totalStock > 0
        ? Math.min(100, Math.round((summary.hardReservedQty / summary.totalStock) * 100))
        : 0;
      const row = {
        ...summary,
        item,
        area,
        supplierQty,
        occupiedPercent,
      };
      row.statusMeta = getStatusMeta(row);
      return row;
    });
  }, [items, availability, supplierByItem]);

  const categoryOptions = useMemo(() => {
    const names = new Set();
    categories.forEach((category) => category?.name && names.add(category.name));
    items.forEach((item) => item?.category && names.add(item.category));
    return [...names].sort((a, b) => a.localeCompare(b, 'es'));
  }, [categories, items]);

  const filteredRows = useMemo(() => {
    return rows
      .filter((row) => {
        if (categoryFilter !== 'all' && row.item.category !== categoryFilter) return false;
        if (areaFilter !== 'all' && row.area !== areaFilter) return false;
        if (statusFilter !== 'all' && row.statusMeta.key !== statusFilter) return false;
        return matchesSearchTokens([
          row.item.name,
          row.item.sku,
          row.item.category,
          row.item.brand,
          row.item.itemColor,
          row.item.description,
          getInventoryAreaLabel(row.area),
        ].filter(Boolean).join(' '), query);
      })
      .sort((left, right) => {
        const rank = { empty: 0, limited: 1, available: 2, uncontrolled: 3 };
        const byStatus = (rank[left.statusMeta.key] ?? 9) - (rank[right.statusMeta.key] ?? 9);
        if (byStatus !== 0) return byStatus;
        return String(left.item.name).localeCompare(String(right.item.name), 'es');
      });
  }, [rows, query, categoryFilter, areaFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const metrics = useMemo(() => {
    const controlled = rows.filter((row) => row.stockControlled);
    return {
      products: controlled.length,
      reserved: controlled.reduce((sum, row) => sum + row.hardReservedQty, 0),
      available: controlled.reduce((sum, row) => sum + row.projectedAvailable, 0),
      limited: controlled.filter((row) => row.statusMeta.key === 'limited').length,
      empty: controlled.filter((row) => row.statusMeta.key === 'empty').length,
      tentative: controlled.reduce((sum, row) => sum + row.softReservedQty, 0),
    };
  }, [rows]);

  const quickOptions = useMemo(() => {
    return rows
      .filter((row) => row.stockControlled)
      .filter((row) => matchesSearchTokens([
        row.item.name,
        row.item.sku,
        row.item.category,
        row.item.brand,
        row.item.itemColor,
        row.item.description,
        getInventoryAreaLabel(row.area),
      ].filter(Boolean).join(' '), quickQuery))
      .sort((left, right) => String(left.item.name).localeCompare(String(right.item.name), 'es'))
      .slice(0, 12);
  }, [rows, quickQuery]);

  const selectQuickRow = (row) => {
    setQuickItemId(String(row.item.id));
    setQuickQuery(row.item.name);
    setQuickSearchOpen(false);
  };

  const quickRow = rows.find((row) => String(row.item.id) === String(quickItemId));
  const requestedQuantity = Math.max(0, Math.trunc(Number(quickQuantity ?? 0)));
  const quickShortage = quickRow ? Math.max(0, requestedQuantity - quickRow.projectedAvailable) : 0;

  const resolveDetailRecord = (record) => {
    const source = record.type === 'orden'
      ? rentalById.get(String(record.id))
      : record.type === 'cotizacion'
        ? quoteById.get(String(record.id))
        : contractById.get(String(record.id));
    if (!source) return record;
    const linkedContract = source.contractId ? contractById.get(String(source.contractId)) : null;
    return { ...source, ...linkedContract, quantity: record.quantity, type: record.type };
  };

  const getItemCommitments = (row) => [
    ...(row.hardReservedQtyRecords || []).map((record) => ({ ...resolveDetailRecord(record), commitmentTone: 'confirmed' })),
    ...(row.softReservedQtyRecords || []).map((record) => ({ ...resolveDetailRecord(record), commitmentTone: 'tentative' })),
  ];

  const calendarCells = useMemo(() => getMonthGrid(calendarDate), [calendarDate]);
  const calendarStats = useMemo(() => {
    const stats = new Map();
    calendarCells.forEach((cell) => {
      const dayPeriod = buildAvailabilityPeriod({
        deliveryDate: cell.key,
        deliveryWindowStart: '00:00',
        pickupDate: cell.key,
        pickupWindowEnd: '23:59',
      });
      const dayAvailability = getProjectedInventoryAvailability({ items, rentals, contracts, quotes, period: dayPeriod });
      let committedProducts = 0;
      let committedUnits = 0;
      let limited = 0;
      let empty = 0;
      let tentative = 0;
      dayAvailability.forEach((summary) => {
        if (!summary.stockControlled) return;
        if (summary.hardReservedQty > 0) committedProducts += 1;
        committedUnits += summary.hardReservedQty;
        tentative += summary.softReservedQty;
        if (summary.projectedAvailable <= 0 && summary.hardReservedQty > 0) empty += 1;
        else if (summary.totalStock > 0 && summary.projectedAvailable / summary.totalStock <= 0.25) limited += 1;
      });
      stats.set(cell.key, { committedProducts, committedUnits, limited, empty, tentative });
    });
    return stats;
  }, [calendarCells, items, rentals, contracts, quotes]);

  const selectedDayPeriod = useMemo(
    () => buildAvailabilityPeriod({
      deliveryDate: selectedCalendarDate,
      deliveryWindowStart: '00:00',
      pickupDate: selectedCalendarDate,
      pickupWindowEnd: '23:59',
    }),
    [selectedCalendarDate],
  );

  const selectedDayRows = useMemo(() => {
    const dayAvailability = getProjectedInventoryAvailability({ items, rentals, contracts, quotes, period: selectedDayPeriod });
    return items
      .map((item) => ({ item, summary: dayAvailability.get(item.id) }))
      .filter(({ summary }) => summary?.hardReservedQty > 0 || summary?.softReservedQty > 0)
      .sort((a, b) => (b.summary.hardReservedQty + b.summary.softReservedQty) - (a.summary.hardReservedQty + a.summary.softReservedQty));
  }, [items, rentals, contracts, quotes, selectedDayPeriod]);

  const resetFilters = () => {
    setQuery('');
    setCategoryFilter('all');
    setAreaFilter('all');
    setStatusFilter('all');
    setPage(1);
  };

  return (
    <section className="availability-view">
      <header className="availability-hero">
        <div>
          <span className="availability-kicker">CONTROL COMERCIAL DE STOCK</span>
          <h2>Disponibilidad de Inventario</h2>
          <p>Consulta cuánto inventario está libre, comprometido o pendiente antes de ofrecerlo a un cliente.</p>
        </div>
        <div className="availability-mode-switch" role="tablist" aria-label="Tipo de consulta">
          <button type="button" className={mode === 'date' ? 'active' : ''} onClick={() => setMode('date')}>
            <PackageSearch size={18} /> Consulta por fecha
          </button>
          <button type="button" className={mode === 'calendar' ? 'active' : ''} onClick={() => setMode('calendar')}>
            <CalendarDays size={18} /> Calendario mensual
          </button>
        </div>
      </header>

      {mode === 'date' ? (
        <>
          <section className="availability-filter-card">
            <div className="availability-filter-heading">
              <div>
                <span>Rango de consulta</span>
                <strong>Consulta el inventario comprometido entre dos fechas completas</strong>
              </div>
              <button type="button" className="availability-reset" onClick={resetFilters}>Limpiar filtros</button>
            </div>
            <div className="availability-date-grid">
              <label>
                <span>Desde</span>
                <input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); if (!dateTo || event.target.value > dateTo) setDateTo(event.target.value); }} />
              </label>
              <label>
                <span>Hasta</span>
                <input type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} />
              </label>
              <p className="availability-full-day-note">
                La consulta toma el primer día desde las 00:00 y el último día hasta las 23:59.
              </p>
            </div>
            <div className="availability-search-grid">
              <label className="availability-search-field">
                <Search size={18} />
                <input
                  type="search"
                  value={query}
                  placeholder="Buscar producto, SKU, categoría o color..."
                  onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                />
              </label>
              <select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }}>
                <option value="all">Todas las categorías</option>
                {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <select value={areaFilter} onChange={(event) => { setAreaFilter(event.target.value); setPage(1); }}>
                <option value="all">Todas las áreas</option>
                {INVENTORY_AREAS.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}
              </select>
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
                <option value="all">Todos los estados</option>
                <option value="available">Disponible</option>
                <option value="limited">Limitado</option>
                <option value="empty">Agotado</option>
                <option value="uncontrolled">Sin control de stock</option>
              </select>
            </div>
          </section>

          <section className="availability-kpi-grid">
            <article><span className="availability-kpi-icon blue"><PackageCheck /></span><small>Productos con stock</small><strong>{metrics.products.toLocaleString('es-BO')}</strong></article>
            <article><span className="availability-kpi-icon orange"><Truck /></span><small>Unidades comprometidas</small><strong>{metrics.reserved.toLocaleString('es-BO')}</strong></article>
            <article><span className="availability-kpi-icon green"><ShieldCheck /></span><small>Unidades disponibles</small><strong>{metrics.available.toLocaleString('es-BO')}</strong></article>
            <article><span className="availability-kpi-icon amber"><AlertTriangle /></span><small>Disponibilidad limitada</small><strong>{metrics.limited.toLocaleString('es-BO')}</strong></article>
            <article><span className="availability-kpi-icon red"><XCircle /></span><small>Sin disponibilidad</small><strong>{metrics.empty.toLocaleString('es-BO')}</strong></article>
            <article><span className="availability-kpi-icon violet"><Clock3 /></span><small>Reservas tentativas</small><strong>{metrics.tentative.toLocaleString('es-BO')}</strong></article>
          </section>

          <section className="availability-quick-check">
            <header>
              <div>
                <span>RESPUESTA COMERCIAL INMEDIATA</span>
                <h3>¿Cuánto puedo ofrecer al cliente?</h3>
                <p>Selecciona un producto y escribe la cantidad solicitada.</p>
              </div>
              <CheckCircle2 size={26} />
            </header>
            <div className="availability-quick-form">
              <label className="availability-quick-product-field">
                <span>Producto</span>
                <div className="availability-product-search">
                  <Search size={17} />
                  <input
                    type="search"
                    value={quickQuery}
                    placeholder="Escribe nombre, color, SKU o categoría..."
                    autoComplete="off"
                    onFocus={() => setQuickSearchOpen(true)}
                    onChange={(event) => {
                      setQuickQuery(event.target.value);
                      setQuickItemId('');
                      setQuickSearchOpen(true);
                    }}
                  />
                  {quickSearchOpen ? (
                    <div className="availability-product-search-results">
                      {quickOptions.length > 0 ? quickOptions.map((row) => (
                        <button type="button" key={row.item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectQuickRow(row)}>
                          <ProductImage item={row.item} alt="" fallback={<span>{String(row.item.name || '?').slice(0, 2)}</span>} />
                          <span>
                            <strong>{row.item.name}</strong>
                            <small>{[row.item.category, row.item.itemColor, row.item.sku].filter(Boolean).join(' · ') || 'Sin datos adicionales'}</small>
                          </span>
                          <b>{row.projectedAvailable}</b>
                        </button>
                      )) : (
                        <p>No encontramos productos que coincidan con esas palabras.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </label>
              <label>
                <span>Cantidad solicitada</span>
                <input type="number" min="1" step="1" value={quickQuantity} onChange={(event) => setQuickQuantity(event.target.value)} />
              </label>
              <div className={`availability-quick-result ${quickRow ? (quickShortage > 0 ? 'warning' : 'success') : 'empty'}`}>
                {!quickRow ? (
                  <p>Selecciona un producto para calcular la respuesta.</p>
                ) : (
                  <>
                    <div><small>Stock total</small><strong>{quickRow.totalStock}</strong></div>
                    <div><small>Comprometido</small><strong>{quickRow.hardReservedQty}</strong></div>
                    <div><small>Disponible seguro</small><strong>{quickRow.projectedAvailable}</strong></div>
                    <div><small>Disponible conservador</small><strong>{quickRow.projectedAfterSoftAvailable}</strong></div>
                    <div className="availability-quick-message">
                      {quickShortage > 0 ? (
                        <><AlertTriangle size={18} /><span>Puedes ofrecer {quickRow.projectedAvailable} unidades propias. Faltan {quickShortage}.</span></>
                      ) : (
                        <><CheckCircle2 size={18} /><span>La cantidad solicitada está disponible para este periodo.</span></>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          <section className="availability-products-section">
            <header>
              <div>
                <span>RESULTADO DEL PERIODO</span>
                <h3>{filteredRows.length.toLocaleString('es-BO')} productos encontrados</h3>
              </div>
              <small>{formatDate(dateFrom)} {dateTo !== dateFrom ? `al ${formatDate(dateTo)}` : ''}</small>
            </header>

            <div className="availability-product-grid">
              {visibleRows.map((row) => {
                const isExpanded = expandedItemId === row.item.id;
                const commitments = getItemCommitments(row);
                return (
                  <article key={row.item.id} className={`availability-product-card tone-${row.statusMeta.tone} ${isExpanded ? 'expanded' : ''}`}>
                    <div className="availability-product-main">
                      <button
                        type="button"
                        className="availability-product-image"
                        onClick={() => {
                          const url = row.item.imageUrl || row.item.imageDataUrl || row.item.image;
                          if (url && onOpenImage) onOpenImage({ name: row.item.name, url });
                        }}
                      >
                        <ProductImage item={row.item} alt={row.item.name} fallback={<span>{String(row.item.name || '?').slice(0, 2)}</span>} />
                      </button>
                      <div className="availability-product-copy">
                        <div className="availability-product-title-row">
                          <div>
                            <small>{row.item.category || 'SIN CATEGORÍA'} · {getInventoryAreaLabel(row.area)}</small>
                            <h4>{row.item.name}</h4>
                            <p>{row.item.sku || 'Sin SKU'}{row.item.itemColor ? ` · ${row.item.itemColor}` : ''}</p>
                          </div>
                          <span className={`availability-status-pill ${row.statusMeta.tone}`}>{row.statusMeta.label}</span>
                        </div>
                        <div className="availability-stock-numbers">
                          <div><small>Stock total</small><strong>{row.totalStock}</strong></div>
                          <div><small>Comprometido</small><strong>{row.hardReservedQty}</strong></div>
                          <div><small>Disponible</small><strong>{row.projectedAvailable}</strong></div>
                          <div><small>Tentativo</small><strong>{row.softReservedQty}</strong></div>
                          <div><small>Proveedor</small><strong>{row.supplierQty}</strong></div>
                        </div>
                        <div className="availability-progress-line">
                          <span><i style={{ width: `${row.occupiedPercent}%` }} /></span>
                          <small>{row.occupiedPercent}% del stock propio comprometido</small>
                        </div>
                      </div>
                    </div>
                    <button type="button" className="availability-detail-toggle" onClick={() => setExpandedItemId(isExpanded ? '' : row.item.id)}>
                      {commitments.length > 0 ? `${commitments.length} compromiso${commitments.length === 1 ? '' : 's'}` : 'Sin compromisos'}
                      <ChevronDown size={17} />
                    </button>
                    {isExpanded ? (
                      <div className="availability-commitment-list">
                        {commitments.length === 0 ? <p className="availability-empty-detail">No existen contratos u órdenes que ocupen este artículo en el periodo.</p> : commitments.map((record, index) => (
                          <div key={`${record.id || record.orderCode || index}-${index}`} className={`availability-commitment-row ${record.commitmentTone}`}>
                            <div className="availability-contract-badge">
                              <small>{record.type === 'cotizacion' ? 'COTIZACIÓN' : record.type === 'orden' ? 'ORDEN' : 'CONTRATO'}</small>
                              <strong>{record.contractCode || record.orderCode || record.quoteCode || record.code || 'S/C'}</strong>
                            </div>
                            <div><small>Cliente</small><strong>{record.customerName || 'Sin cliente'}</strong><span><UsersRound size={14} /> {record.eventType || 'Evento no especificado'}</span></div>
                            <div><small>Lugar</small><strong>{getRecordLocation(record, clientById)}</strong><span><MapPin size={14} /> {record.city || 'Sin ciudad'}</span></div>
                            <div><small>Periodo</small><strong>{formatDate(record.deliveryDate || record.rentalDate || record.eventDate || record.startDate)} - {formatDate(record.pickupDate || record.dueDate || record.endDate)}</strong><span><Clock3 size={14} /> {formatTimeRange(record)}</span></div>
                            <div className="availability-commitment-qty"><small>Cantidad</small><strong>{record.quantity}</strong><span>{record.commitmentTone === 'tentative' ? 'Tentativo' : 'Confirmado'}</span></div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>

            {visibleRows.length === 0 ? <div className="availability-no-results"><PackageSearch size={34} /><strong>No encontramos productos</strong><p>Cambia la búsqueda o los filtros seleccionados.</p></div> : null}

            {totalPages > 1 ? (
              <footer className="availability-pagination">
                <button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={17} /> Anterior</button>
                <span>Página {safePage} de {totalPages}</span>
                <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Siguiente <ChevronRight size={17} /></button>
              </footer>
            ) : null}
          </section>
        </>
      ) : (
        <section className="availability-calendar-layout">
          <div className="availability-calendar-card">
            <header>
              <button type="button" onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft /></button>
              <div><span>CALENDARIO DE OCUPACIÓN</span><h3>{monthLabel(calendarDate)}</h3></div>
              <button type="button" onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight /></button>
            </header>
            <div className="availability-week-labels">{['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="availability-calendar-grid">
              {calendarCells.map((cell) => {
                const stat = calendarStats.get(cell.key) || {};
                const tone = stat.empty > 0 ? 'danger' : stat.limited > 0 ? 'warning' : stat.committedUnits > 0 ? 'busy' : stat.tentative > 0 ? 'tentative' : 'free';
                return (
                  <button
                    key={cell.key}
                    type="button"
                    className={`${cell.inMonth ? '' : 'outside'} ${selectedCalendarDate === cell.key ? 'selected' : ''} tone-${tone}`}
                    onClick={() => setSelectedCalendarDate(cell.key)}
                  >
                    <strong>{cell.date.getDate()}</strong>
                    <span>{stat.committedUnits ? `${stat.committedUnits} unidades` : stat.tentative ? `${stat.tentative} tentativas` : 'Sin reservas'}</span>
                    {stat.empty > 0 ? <small>{stat.empty} agotado{stat.empty === 1 ? '' : 's'}</small> : stat.limited > 0 ? <small>{stat.limited} limitado{stat.limited === 1 ? '' : 's'}</small> : stat.committedProducts > 0 ? <small>{stat.committedProducts} productos</small> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="availability-day-detail">
            <header>
              <span>DETALLE DEL DÍA</span>
              <h3>{formatDate(selectedCalendarDate)}</h3>
              <p>{selectedDayRows.length} productos con movimiento.</p>
            </header>
            <div className="availability-day-list">
              {selectedDayRows.length === 0 ? (
                <div className="availability-day-empty"><CheckCircle2 /><strong>Día sin compromisos</strong><p>Todo el inventario está libre según las reservas registradas.</p></div>
              ) : selectedDayRows.slice(0, 80).map(({ item, summary }) => (
                <article key={item.id}>
                  <ProductImage item={item} alt={item.name} fallback={<span>{String(item.name || '?').slice(0, 2)}</span>} />
                  <div><strong>{item.name}</strong><small>{item.category || 'Sin categoría'}</small></div>
                  <div><b>{summary.hardReservedQty}</b><small>comprometido</small></div>
                  <div><b>{summary.projectedAvailable}</b><small>disponible</small></div>
                </article>
              ))}
            </div>
          </aside>
        </section>
      )}
    </section>
  );
}

export default AvailabilitySection;
