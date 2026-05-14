import { useMemo } from 'react';

const statusClassFromDelivery = (status) => {
  if (status === 'completada') return 'done';
  if (status === 'en_ruta') return 'transport';
  if (status === 'incidencia') return 'pending';
  return 'prep';
};

const statusLabelFromDelivery = (status) => {
  if (status === 'completada') return 'Completada';
  if (status === 'en_ruta') return 'En Transporte';
  if (status === 'incidencia') return 'Pendiente';
  return 'En Preparacion';
};

const formatDate = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const pad2 = (value) => String(value).padStart(2, '0');

const toDateKey = (dateValue) => {
  if (!dateValue) return '';
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
    return dateValue.slice(0, 10);
  }
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
};

const dateFromKey = (key) => {
  const [year, month, day] = String(key ?? '').split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
};

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const formatTodayLabel = (dateKey) => {
  const text = dateFromKey(dateKey).toLocaleDateString('es-BO', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const getAgendaStatusMeta = (status) => {
  const normalized = normalizeText(status).replaceAll(' ', '_');
  if (['completada', 'completado', 'completed'].includes(normalized)) {
    return { label: 'Completada', tone: 'done' };
  }
  if (['en_ruta', 'route'].includes(normalized)) {
    return { label: 'En ruta', tone: 'route' };
  }
  if (['confirmada', 'confirmado', 'confirmed', 'a_tiempo'].includes(normalized)) {
    return { label: normalized === 'a_tiempo' ? 'A tiempo' : 'Confirmada', tone: 'ontime' };
  }
  if (['retrasado', 'vencido', 'incidencia'].includes(normalized)) {
    return { label: normalized === 'incidencia' ? 'Incidencia' : 'Retrasada', tone: 'late' };
  }
  return { label: status ? String(status).replaceAll('_', ' ') : 'Programada', tone: 'scheduled' };
};

const getAgendaTypeLabel = (type) => {
  const labels = {
    delivery: 'Entrega',
    contract: 'Contrato',
    return: 'Devolucion',
    maintenance: 'Mantenimiento',
    license: 'Licencia',
    loan: 'Prestamo',
    service: 'Servicio',
    other: 'Evento',
  };
  return labels[type] ?? labels.other;
};

const getAgendaIconName = (type) => {
  if (type === 'delivery') return 'truck';
  if (type === 'contract' || type === 'return' || type === 'service') return 'clipboard';
  if (type === 'loan') return 'box';
  return 'calendar';
};

const formatAgendaMoney = (value, formatBs) => {
  const amount = Number(value ?? 0);
  return amount > 0 ? formatBs(amount) : '';
};

function MetricIcon({ name }) {
  const icons = {
    clipboard: (
      <>
        <rect x="7" y="5.8" width="10" height="14.2" rx="1.7" fill="none" stroke="currentColor" strokeWidth="1.72" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.2 6.4V5.1A1.1 1.1 0 0 1 10.3 4h3.4a1.1 1.1 0 0 1 1.1 1.1v1.3" fill="none" stroke="currentColor" strokeWidth="1.72" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    box: (
      <>
        <path d="m12 3.5 7.2 4.05v8.9L12 20.5l-7.2-4.05v-8.9L12 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.72" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.15 7.85 12 11.9l6.85-4.05M12 11.9v8.25" fill="none" stroke="currentColor" strokeWidth="1.72" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    truck: (
      <>
        <path d="M3.5 7h10.3v8.8H3.5zM13.8 10h3.9l2.8 3.15v2.65h-6.7z" fill="none" stroke="currentColor" strokeWidth="1.72" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7.2" cy="17" r="1.65" fill="none" stroke="currentColor" strokeWidth="1.72" />
        <circle cx="17.8" cy="17" r="1.65" fill="none" stroke="currentColor" strokeWidth="1.72" />
      </>
    ),
    money: (
      <>
        <text x="12" y="15.7" textAnchor="middle" fontSize="10.2" fontWeight="800" fill="currentColor" fontFamily="Inter, Arial, sans-serif">Bs</text>
      </>
    ),
    calendar: (
      <>
        <path d="M7 3.8v3M17 3.8v3M4.5 8.5h15" fill="none" stroke="currentColor" strokeWidth="1.72" strokeLinecap="round" />
        <rect x="4.5" y="5.6" width="15" height="14.4" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.72" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {icons[name] ?? icons.clipboard}
    </svg>
  );
}

function ProductIllustration({ type }) {
  const drawings = {
    chair: (
      <>
        <path d="M9 6h6M8 9h8M9 12h6M8 16h8M9 9v11M15 9v11M7 20h10" />
        <path d="M8.5 5.5c0-1.1.9-2 2-2h3c1.1 0 2 .9 2 2V16h-7V5.5Z" />
      </>
    ),
    table: (
      <>
        <ellipse cx="12" cy="8" rx="7.5" ry="2.8" />
        <path d="M4.5 8v3.3c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9V8" />
        <path d="M7.5 13.2 6 20M16.5 13.2 18 20M9.5 14l-.8 6M14.5 14l.8 6" />
      </>
    ),
    bowl: (
      <>
        <path d="M4 10h16c-.5 5.2-3.6 8-8 8s-7.5-2.8-8-8Z" />
        <path d="M6.5 10c.8-2.4 2.6-3.8 5.5-3.8s4.7 1.4 5.5 3.8" />
        <path d="M8 18.5h8" />
      </>
    ),
    fabric: (
      <>
        <path d="M5 8c1.7-1.5 4-2.3 7-2.3s5.3.8 7 2.3" />
        <path d="M5 8h14v10H5z" />
        <path d="M8 8v10M12 8v10M16 8v10" />
        <path d="M5 18c1.5 1.1 3.8 1.7 7 1.7s5.5-.6 7-1.7" />
      </>
    ),
    glass: (
      <>
        <path d="M7 4h4l-.7 7.5a2 2 0 0 1-2 1.8h-.6a2 2 0 0 1-2-1.8L5 4h2Z" />
        <path d="M8 13.3V20M6.4 20h3.2M15 4h4l-.7 7.5a2 2 0 0 1-2 1.8h-.6a2 2 0 0 1-2-1.8L13 4h2Z" />
        <path d="M16 13.3V20M14.4 20h3.2" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {drawings[type] ?? drawings.bowl}
      </g>
    </svg>
  );
}

const getFeaturedVisualType = (item) => {
  const value = `${item?.name ?? ''} ${item?.categoryName ?? ''} ${item?.category ?? ''}`.toLowerCase();
  if (value.includes('silla')) return 'chair';
  if (value.includes('mesa')) return 'table';
  if (value.includes('mantel') || value.includes('tela')) return 'fabric';
  if (value.includes('copa') || value.includes('vaso') || value.includes('cristal')) return 'glass';
  return 'bowl';
};

function SummarySection({
  dashboard,
  summaryCards,
  formatBs,
  rentals = [],
  deliveries = [],
  calendarEvents = [],
  contracts = [],
  supplierBundle = null,
  items = [],
  onOpenImage,
  onOpenCalendar,
}) {
  const serviceRows = useMemo(() => {
    return rentals.slice(0, 5).map((rental) => {
      const delivery = deliveries.find(
        (entry) =>
          (entry.rentalId && entry.rentalId === rental.id)
          || (entry.orderCode && rental.orderCode && entry.orderCode === rental.orderCode),
      );
      const firstItem = rental.items?.[0];
      return {
        id: rental.orderCode ?? rental.id,
        customer: rental.customerName,
        event: firstItem?.itemName ? `Servicio de ${firstItem.itemName}` : 'Orden de alquiler',
        date: formatDate(rental.dueDate ?? rental.createdAt),
        status: statusLabelFromDelivery(delivery?.status ?? (rental.status === 'returned' ? 'completada' : 'programada')),
        statusClass: statusClassFromDelivery(delivery?.status ?? (rental.status === 'returned' ? 'completada' : 'programada')),
        total: formatBs(Number(rental?.totals?.totalBs ?? 0)),
      };
    });
  }, [deliveries, formatBs, rentals]);

  const todayKey = toDateKey(new Date());
  const todayLabel = formatTodayLabel(todayKey);

  const agendaItems = useMemo(() => {
    const rentalById = new Map();
    const rentalByOrderCode = new Map();
    const contractByRentalId = new Map();
    const contractByOrderCode = new Map();

    rentals.forEach((rental) => {
      if (rental.id) rentalById.set(rental.id, rental);
      if (rental.orderCode) rentalByOrderCode.set(rental.orderCode, rental);
    });

    contracts.forEach((contract) => {
      if (contract.rentalId) contractByRentalId.set(contract.rentalId, contract);
      if (contract.orderCode) contractByOrderCode.set(contract.orderCode, contract);
    });

    const rows = [];
    const pushRow = (row) => {
      if (row.dateKey !== todayKey) return;
      const statusMeta = getAgendaStatusMeta(row.status);
      rows.push({
        ...row,
        statusLabel: statusMeta.label,
        tone: statusMeta.tone,
        typeLabel: getAgendaTypeLabel(row.type),
        iconName: getAgendaIconName(row.type),
      });
    };

    deliveries
      .filter((delivery) => !delivery.deletedAt)
      .forEach((delivery) => {
        const rental = rentalById.get(delivery.rentalId) ?? rentalByOrderCode.get(delivery.orderCode);
        const contract = contractByRentalId.get(rental?.id) ?? contractByOrderCode.get(rental?.orderCode ?? delivery.orderCode);
        const itemCount = rental?.items?.length ?? contract?.items?.length ?? 0;
        pushRow({
          id: `delivery-${delivery.id}`,
          type: 'delivery',
          dateKey: toDateKey(delivery.scheduledDate),
          hour: `${delivery.windowStart || '--:--'} - ${delivery.windowEnd || '--:--'}`,
          title: `${delivery.deliveryCode} - ${delivery.customerName || 'Cliente'}`,
          status: delivery.status,
          primaryDetail: delivery.companyName && delivery.companyName !== delivery.customerName
            ? `${delivery.companyName} | ${itemCount || 0} items`
            : `${itemCount || 0} items`,
          reference: [contract?.contractCode, delivery.orderCode].filter(Boolean).join(' | '),
          location: [delivery.address, delivery.city].filter(Boolean).join(', '),
        });
      });

    calendarEvents
      .filter((event) => event.type !== 'delivery')
      .forEach((event) => {
        pushRow({
          id: `calendar-${event.id}`,
          type: event.type || 'other',
          dateKey: toDateKey(event.date),
          hour: `${event.startTime || '--:--'} - ${event.endTime || '--:--'}`,
          title: event.title || 'Evento programado',
          status: event.status,
          primaryDetail: event.subtitle || 'Actividad agregada al calendario',
          reference: event.relatedId ? `${event.relatedType || 'Referencia'} ${event.relatedId}` : '',
          location: '',
        });
      });

    contracts.forEach((contract) => {
      const dateKey = toDateKey(contract.pickupDate || contract.validUntil);
      if (!dateKey) return;
      pushRow({
        id: `contract-${contract.id}`,
        type: 'contract',
        dateKey,
        hour: `${contract.pickupWindowStart || '20:00'} - ${contract.pickupWindowEnd || '22:00'}`,
        title: `Finaliza ${contract.contractCode}`,
        status: contract.status === 'aprobado' ? 'a_tiempo' : contract.status,
        primaryDetail: `${contract.customerName || 'Cliente'} | ${contract.items?.length ?? 0} items`,
        reference: contract.orderCode || '',
        location: contract.serviceAddress || contract.deliveryAddress || contract.address || '',
      });
    });

    rentals.forEach((rental) => {
      const contract = contractByRentalId.get(rental.id) ?? contractByOrderCode.get(rental.orderCode);
      const dueKey = toDateKey(rental.dueDate);
      if (!dueKey) return;
      const isLate = rental.status !== 'returned' && dateFromKey(dueKey) < dateFromKey(todayKey);
      pushRow({
        id: `return-${rental.id}`,
        type: 'return',
        dateKey: dueKey,
        hour: `${rental.dueTime || '22:00'} - ${rental.dueTime || '22:00'}`,
        title: rental.status === 'returned' ? `Devuelto ${rental.orderCode}` : `Devolucion ${rental.orderCode}`,
        status: rental.status === 'returned' ? 'completada' : isLate ? 'retrasado' : 'a_tiempo',
        primaryDetail: `${rental.customerName || 'Cliente'} | ${rental.items?.length ?? 0} items`,
        reference: [contract?.contractCode, formatAgendaMoney(rental?.totals?.totalBs, formatBs)].filter(Boolean).join(' | '),
        location: rental.deliveryAddress || rental.address || '',
      });
    });

    (supplierBundle?.loans ?? []).forEach((loan) => {
      const isClosed = ['devuelto', 'liquidado', 'cancelado'].includes(normalizeText(loan.status));
      pushRow({
        id: `loan-start-${loan.id}`,
        type: 'loan',
        dateKey: toDateKey(loan.requestDate),
        hour: '09:00 - 10:00',
        title: loan.direction === 'from_supplier' ? `Recibir ${loan.loanCode}` : `Prestar ${loan.loanCode}`,
        status: loan.status || 'programada',
        primaryDetail: `${loan.supplierName || 'Proveedor'} | ${loan.items?.length ?? 0} items`,
        reference: loan.flowType === 'exchange' ? 'Intercambio' : 'Pago directo',
        location: loan.eventName || '',
      });
      pushRow({
        id: `loan-return-${loan.id}`,
        type: 'loan',
        dateKey: toDateKey(loan.returnDate),
        hour: '18:00 - 19:00',
        title: `Devolver ${loan.loanCode}`,
        status: isClosed ? 'completada' : loan.status || 'a_tiempo',
        primaryDetail: `${loan.supplierName || 'Proveedor'} | ${loan.items?.length ?? 0} items`,
        reference: loan.direction === 'from_supplier' ? 'Nos prestaron' : 'Prestamos',
        location: loan.eventName || '',
      });
    });

    return rows
      .sort((a, b) => String(a.hour).localeCompare(String(b.hour), 'es'))
      .slice(0, 6);
  }, [calendarEvents, contracts, deliveries, formatBs, rentals, supplierBundle, todayKey]);

  const featuredInventory = useMemo(() => {
    return items
      .slice()
      .sort((a, b) => Number(b.availableStock ?? 0) - Number(a.availableStock ?? 0))
      .slice(0, 4)
      .map((item) => ({
        name: item.name,
        available: Number(item.availableStock ?? 0),
        progress: item.totalStock > 0 ? Math.round((Number(item.availableStock ?? 0) / Number(item.totalStock)) * 100) : 0,
        imageDataUrl: item.imageDataUrl ?? item.imageUrl ?? item.image ?? null,
        visualType: getFeaturedVisualType(item),
      }));
  }, [items]);

  const metricCards = useMemo(() => {
    const active = dashboard?.cards?.activeRentals ?? 0;
    const availability = items.length > 0
      ? ((items.reduce((sum, item) => sum + Number(item.availableStock ?? 0), 0)
        / items.reduce((sum, item) => sum + Number(item.totalStock ?? 0), 0)) * 100).toFixed(1)
      : '0.0';
    const inRoute = deliveries.filter((delivery) => delivery.status === 'en_ruta').length;
    const monthRevenue = rentals.reduce((sum, rental) => sum + Number(rental?.totals?.totalBs ?? 0), 0);

    return [
      { tone: 'lilac', value: active, label: 'Ordenes para hoy', link: 'Ver ordenes' },
      { tone: 'mint', value: `${availability}%`, label: 'Disponibilidad general', link: 'Ver inventario' },
      { tone: 'sky', value: inRoute, label: 'En ruta de entrega', link: 'Ver transporte' },
      { tone: 'peach', value: formatBs(monthRevenue), label: 'Facturacion del mes', link: 'Ver reportes' },
    ];
  }, [dashboard?.cards?.activeRentals, deliveries, formatBs, items, rentals]);

  const metricIcons = {
    lilac: 'clipboard',
    mint: 'box',
    sky: 'truck',
    peach: 'money',
  };

  return (
    <section className="panel dashboard-layout">
      <div className="dashboard-main">
        <div className="dashboard-metric-grid">
          {metricCards.map((card) => (
            <article key={`${card.tone}-${card.label}`} className={`dashboard-metric-card ${card.tone}`}>
              <span className={`metric-icon-shell ${card.tone}`}>
                <MetricIcon name={metricIcons[card.tone]} />
              </span>
              <strong className={`metric-value ${card.tone}`}>{card.value}</strong>
              <p>{card.label}</p>
              <button type="button" className={`metric-link ${card.tone}`}>
                {card.link} <span aria-hidden="true">{'->'}</span>
              </button>
            </article>
          ))}
        </div>

        <section className="dashboard-service-card">
          <header className="dashboard-section-header">
            <h3>Ordenes de Servicio</h3>
            <div>
              <button type="button" className="link-button">
                Ver todas
              </button>
              <button type="button" className="primary-button mini">
                + Nueva Orden
              </button>
            </div>
          </header>

          <div className="service-filter-tabs">
            <button type="button" className="active">Todas</button>
            <button type="button">Pendientes</button>
            <button type="button">En Preparacion</button>
            <button type="button">En Transporte</button>
            <button type="button">Completadas</button>
          </div>

          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Cliente</th>
                  <th>Evento</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {serviceRows.map((row) => (
                  <tr key={row.id}>
                    <td className="code">{row.id}</td>
                    <td>{row.customer}</td>
                    <td>{row.event}</td>
                    <td>{row.date}</td>
                    <td>
                      <span className={`service-status ${row.statusClass}`}>{row.status}</span>
                    </td>
                    <td>{row.total}</td>
                    <td className="menu">{'\u22ee'}</td>
                  </tr>
                ))}
                {serviceRows.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <p className="status">No hay ordenes registradas.</p>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="dashboard-bottom-grid">
          <section className="dashboard-inventory-card">
            <header className="dashboard-section-header">
              <h3>Inventario Destacado</h3>
              <button type="button" className="link-button">
                Ver inventario completo
              </button>
            </header>

            <div className="inventory-featured-grid">
              {featuredInventory.map((item) => (
                <article key={item.name} className="inventory-featured-item">
                  {item.imageDataUrl ? (
                    <button
                      type="button"
                      className="inventory-featured-image inventory-featured-image-button"
                      onClick={() =>
                        onOpenImage?.({
                          url: item.imageDataUrl,
                          name: `Imagen de ${item.name}`,
                        })}
                      aria-label={`Ver imagen de ${item.name} en grande`}
                    >
                      <img src={item.imageDataUrl} alt={`Imagen de ${item.name}`} loading="lazy" />
                    </button>
                  ) : (
                    <div className="inventory-featured-image" aria-hidden="true">
                      <ProductIllustration type={item.visualType} />
                    </div>
                  )}
                  <div className="inventory-featured-body">
                    <strong>{item.name}</strong>
                    <p>Disponible: {item.available}</p>
                    <div className="inventory-progress">
                      <span style={{ width: `${item.progress}%` }} />
                      <small>{item.progress}%</small>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="dashboard-quick-card">
            <header className="dashboard-section-header">
              <h3>Acciones Rapidas</h3>
            </header>

            <div className="quick-actions-grid">
              <button type="button" className="quick-action-btn violet">
                <span className="quick-action-icon">
                  <MetricIcon name="clipboard" />
                </span>
                <span className="quick-action-copy">
                  <strong>Nueva Orden</strong>
                  <span>Crear orden de servicio</span>
                </span>
              </button>
              <button type="button" className="quick-action-btn green">
                <span className="quick-action-icon">
                  <MetricIcon name="box" />
                </span>
                <span className="quick-action-copy">
                  <strong>Ver Inventario</strong>
                  <span>Consultar stock</span>
                </span>
              </button>
              <button type="button" className="quick-action-btn blue">
                <span className="quick-action-icon">
                  <MetricIcon name="truck" />
                </span>
                <span className="quick-action-copy">
                  <strong>Programar Transporte</strong>
                  <span>Gestionar entregas</span>
                </span>
              </button>
              <button type="button" className="quick-action-btn orange">
                <span className="quick-action-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M4.5 21a7.5 7.5 0 0 1 15 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="quick-action-copy">
                  <strong>Nuevo Cliente</strong>
                  <span>Registrar cliente</span>
                </span>
              </button>
            </div>
          </section>
      </div>

      <div className="dashboard-summary-money">
          {summaryCards.map((card) => (
            <article key={card.id} className="summary-money-card">
              <span>{card.title}</span>
              <strong>{card.value}</strong>
            </article>
          ))}
          <article className="summary-money-card">
            <span>Garantias en Caja</span>
            <strong>{formatBs(dashboard?.money?.guaranteeInBoxBs ?? 0)}</strong>
          </article>
          <article className="summary-money-card">
            <span>Ingreso Historico</span>
            <strong>{formatBs(dashboard?.money?.historicRevenueBs ?? 0)}</strong>
          </article>
      </div>

      <aside className="dashboard-agenda-card">
        <header className="agenda-title-row">
          <span className="agenda-title-icon" aria-hidden="true">
            <MetricIcon name="calendar" />
          </span>
          <span>
            <h3>Agenda de Hoy</h3>
            <small>{todayLabel}</small>
          </span>
        </header>
        <ul className="dashboard-agenda-list">
          {agendaItems.map((item, index) => (
            <li key={`${item.id}-${item.hour}-${index}`} className={`agenda-item agenda-item-card ${item.tone}`}>
              <span className={`agenda-type-icon ${item.tone}`} aria-hidden="true">
                <MetricIcon name={item.iconName} />
              </span>
              <div className="agenda-content">
                <span className="agenda-row-top">
                  <span className="agenda-hour">{item.hour}</span>
                  <span className={`agenda-status ${item.tone}`}>{item.statusLabel}</span>
                </span>
                <small className="agenda-type-label">{item.typeLabel}</small>
                <strong>{item.title}</strong>
                <p>{item.primaryDetail}</p>
                <span className="agenda-meta-line">
                  {item.reference ? <span>{item.reference}</span> : null}
                  {item.location ? <span>{item.location}</span> : null}
                </span>
              </div>
            </li>
          ))}
          {agendaItems.length === 0 ? (
            <li className="agenda-item agenda-item-card empty">
              <span className="agenda-type-icon scheduled" aria-hidden="true">
                <MetricIcon name="calendar" />
              </span>
              <div className="agenda-content">
                <strong>Sin agenda para hoy</strong>
                <p>No hay entregas, recojos ni alertas programadas para esta fecha.</p>
              </div>
            </li>
          ) : null}
        </ul>
        <button type="button" className="link-button full" onClick={onOpenCalendar}>
          Ver calendario completo <span aria-hidden="true">{'->'}</span>
        </button>
      </aside>

      <footer className="dashboard-footer">
        <span>(c) 2024 Copetin. Todos los derechos reservados.</span>
        <small>Version 2.1.0</small>
      </footer>
    </section>
  );
}

export default SummarySection;
