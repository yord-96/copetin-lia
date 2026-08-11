import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import AttendanceSection from './AttendanceSection';

const upcomingReservations = [
  { client: 'Corporacion Andina', eventType: 'Cena de Gala', date: '07 Jun 2026', time: 'Sab, 19:00', room: 'Lincoln Salon Principal', status: 'Confirmado' },
  { client: 'Maria Fernanda Rojas', eventType: 'Matrimonio', date: '14 Jun 2026', time: 'Sab, 16:00', room: 'Jardin Lincoln', status: 'Confirmado' },
  { client: 'Banco del Norte', eventType: 'Evento Corporativo', date: '19 Jun 2026', time: 'Vie, 18:30', room: 'Lincoln Salon Principal', status: 'Opcion' },
  { client: 'Claudia Mercado', eventType: 'Quince Anos', date: '27 Jun 2026', time: 'Sab, 17:00', room: 'Salon Espejos', status: 'Pendiente' },
];

const agendaItems = [
  { day: '07', month: 'Jun', title: 'Cena de Gala Lincoln 2026', detail: '19:00 - 23:59 - Lincoln Salon Principal' },
  { day: '14', month: 'Jun', title: 'Matrimonio - Maria & Luis', detail: '16:00 - 23:30 - Jardin Lincoln' },
  { day: '19', month: 'Jun', title: 'Evento Corporativo BDN', detail: '18:30 - 23:00 - Lincoln Salon Principal' },
  { day: '21', month: 'Jun', title: 'Showroom de Proveedores', detail: '10:00 - 14:00 - Salon Espejos' },
];

const pendingOperations = [
  { title: 'Seguimientos por realizar', detail: '4 seguimientos en riesgo', accent: 'risk' },
  { title: 'Contratos por enviar', detail: '3 contratos listos para envio', accent: 'warning' },
  { title: 'Pagos por cobrar', detail: '8 reservas con saldo pendiente', accent: 'money' },
  { title: 'Documentos por completar', detail: '2 reservas con docs incompletos', accent: 'docs' },
];

const sidebarItems = [
  { id: 'panel', label: 'Panel', icon: 'home' },
  { id: 'agenda', label: 'Agenda', icon: 'calendar' },
  { id: 'reservas', label: 'Reservas', icon: 'panel' },
  { id: 'eventos', label: 'Eventos', icon: 'calendar' },
  { id: 'salones', label: 'Salones', icon: 'home' },
  { id: 'clientes', label: 'Clientes', icon: 'users' },
  { id: 'proveedores', label: 'Proveedores', icon: 'chart' },
  { id: 'inventario', label: 'Inventario', icon: 'panel' },
  { id: 'reportes', label: 'Reportes', icon: 'chart' },
  { id: 'configuracion', label: 'Configuracion', icon: 'panel' },
  { id: 'usuarios', label: 'Usuarios', icon: 'users' },
  { id: 'asistencia', label: 'Asistencia compartida', icon: 'users' },
];

const linconEnabledViews = new Set(['panel', 'agenda', 'reservas', 'asistencia']);
const linconMobilePrimaryItems = sidebarItems.filter((item) => linconEnabledViews.has(item.id));
const linconMobileMoreItems = sidebarItems.filter((item) => !linconEnabledViews.has(item.id));

const agendaKpis = [
  ['Eventos del mes', '1', 'Junio de 2026', 'calendar'],
  ['Interesados', '1', 'Este mes', 'users'],
  ['Reservados', '1', 'Este mes', 'bookmark'],
  ['Facturacion estimada', 'Bs 10.200,00', 'Proyeccion del mes seleccionado', 'wallet'],
];

const reservationKpis = [
  ['Reservas activas', '24', 'En curso', 'calendar'],
  ['Pendientes de confirmacion', '6', 'Requieren atencion', 'hourglass'],
  ['Eventos proximos', '8', 'En los proximos 30 dias', 'calendar'],
  ['Ingresos confirmados', 'Bs 145.600,00', 'Este mes', 'wallet'],
  ['Saldo pendiente', 'Bs 32.800,00', 'Por cobrar este mes', 'wallet'],
];

const reservationRecords = [
  {
    id: 'RES-2026-0042',
    client: 'Ernesto Rodriguez',
    event: 'Boda',
    date: '18 jun 2026',
    time: '18:00',
    room: 'Salon 1',
    packageName: 'Paquete Plata',
    guests: 150,
    amount: 'Bs 10.200,00',
    paid: 'Pagado 70%',
    balance: 'Bs 3.060,00',
    status: 'Confirmada',
    payment: 'Pagado 70%',
    email: 'ernesto.rodriguez@gmail.com',
    phone: '75470080',
  },
  {
    id: 'RES-2026-0043',
    client: 'Maria & Juan Perez',
    event: 'Matrimonio',
    date: '20 jun 2026',
    time: '16:00',
    room: 'Salon 2',
    packageName: 'Paquete Oro',
    guests: 120,
    amount: 'Bs 8.500,00',
    paid: 'Sin pago',
    balance: 'Bs 8.500,00',
    status: 'Pendiente',
    payment: 'Sin pago',
  },
  {
    id: 'RES-2026-0044',
    client: 'Andrea Morales',
    event: 'Cumpleanos 15 anos',
    date: '21 jun 2026',
    time: '15:00',
    room: 'Salon 1',
    packageName: 'Paquete Base',
    guests: 80,
    amount: 'Bs 6.800,00',
    paid: 'Pagado 50%',
    balance: 'Bs 3.400,00',
    status: 'Confirmada',
    payment: 'Pagado 50%',
  },
  {
    id: 'RES-2026-0045',
    client: 'Corporacion Andina S.A.',
    event: 'Evento Corporativo',
    date: '25 jun 2026',
    time: '09:00',
    room: 'Salon 3',
    packageName: 'Premium',
    guests: 200,
    amount: 'Bs 18.000,00',
    paid: 'Pagado 100%',
    balance: 'Bs 0,00',
    status: 'Confirmada',
    payment: 'Pagado 100%',
  },
  {
    id: 'RES-2026-0046',
    client: 'Sofia Villarroel',
    event: 'Baby Shower',
    date: '27 jun 2026',
    time: '14:00',
    room: 'Salon 2',
    packageName: 'Base',
    guests: 45,
    amount: 'Bs 3.200,00',
    paid: 'Sin pago',
    balance: 'Bs 3.200,00',
    status: 'Pendiente',
    payment: 'Sin pago',
  },
  {
    id: 'RES-2026-0047',
    client: 'Carlos Mendez',
    event: 'Graduacion',
    date: '02 jul 2026',
    time: '17:00',
    room: 'Salon 1',
    packageName: 'Plata',
    guests: 90,
    amount: 'Bs 7.500,00',
    paid: 'Pagado 30%',
    balance: 'Bs 5.250,00',
    status: 'Confirmada',
    payment: 'Pagado 30%',
  },
  {
    id: 'RES-2026-0048',
    client: 'Laura & Diego Ortega',
    event: 'Boda',
    date: '04 jul 2026',
    time: '18:30',
    room: 'Salon 3',
    packageName: 'Oro',
    guests: 160,
    amount: 'Bs 12.800,00',
    paid: 'Pagado 80%',
    balance: 'Bs 2.560,00',
    status: 'Confirmada',
    payment: 'Pagado 80%',
  },
  {
    id: 'RES-2026-0049',
    client: 'Tech Solutions',
    event: 'Lanzamiento de producto',
    date: '08 jul 2026',
    time: '10:00',
    room: 'Salon 1',
    packageName: 'Premium',
    guests: 60,
    amount: 'Bs 9.600,00',
    paid: 'Sin pago',
    balance: 'Bs 9.600,00',
    status: 'Pendiente',
    payment: 'Sin pago',
  },
];

const months = [
  ['Ene', 'Enero', 0, 0],
  ['Feb', 'Febrero', 0, 0],
  ['Mar', 'Marzo', 0, 0],
  ['Abr', 'Abril', 0, 0],
  ['May', 'Mayo', 0, 0],
  ['Jun', 'Junio', 1, 1],
  ['Jul', 'Julio', 0, 0],
  ['Ago', 'Agosto', 0, 0],
  ['Sep', 'Septiembre', 0, 0],
  ['Oct', 'Octubre', 0, 0],
  ['Nov', 'Noviembre', 0, 0],
  ['Dic', 'Diciembre', 0, 0],
];

const calendarEvents = {
  4: [{ title: '1 reservado(s)', type: 'reserved' }],
  5: [{ title: '2 interesados', type: 'lead' }],
  18: [
    { title: '1 interesado', type: 'lead' },
    { title: '1 reservado', type: 'reserved' },
  ],
  25: [{ title: '1 interesado', type: 'lead' }],
};

const weekDays = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

const buildJuneCalendarDays = () => [
  ...Array.from({ length: 30 }, (_, index) => ({
    day: index + 1,
    currentMonth: true,
    events: calendarEvents[index + 1] ?? [],
  })),
  ...Array.from({ length: 12 }, (_, index) => ({
    day: index + 1,
    currentMonth: false,
    events: [],
  })),
];

function LinconIcon({ name }) {
  const paths = {
    panel: ['M4 5h16v14H4z', 'M4 10h16', 'M9 19v-9'],
    calendar: ['M7 3v4', 'M17 3v4', 'M4 8h16', 'M5 5h14v16H5z'],
    wallet: ['M4 7h16v12H4z', 'M16 12h4', 'M7 7V5h10v2'],
    hourglass: ['M6 3h12', 'M6 21h12', 'M8 3v5a4 4 0 0 0 2 3.46L12 13l2-1.54A4 4 0 0 0 16 8V3', 'M8 21v-5a4 4 0 0 1 2-3.46L12 11l2 1.54A4 4 0 0 1 16 16v5'],
    bookmark: ['M6 4h12v17l-6-4-6 4z'],
    chart: ['M4 19V5', 'M8 16l3-4 4 2 5-7', 'M20 19H4'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    home: ['M3 11l9-7 9 7', 'M5 10v10h14V10', 'M9 20v-6h6v6'],
    bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7', 'M13.73 21a2 2 0 0 1-3.46 0'],
    star: ['M12 3l2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84L6.6 19.6l1.03-6-4.36-4.25 6.03-.88z'],
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {(paths[name] ?? paths.panel).map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

function MonthRadar() {
  const center = 150;
  const radius = 106;
  const interestedValues = [0, 0, 0, 0.24, 0.56, 1, 0.18, 0, 0, 0, 0, 0];
  const reservedValues = [0, 0, 0, 0.12, 0.18, 1, 0, 0, 0, 0, 0, 0];
  const pointFor = (index, value) => {
    const angle = ((index / 12) * Math.PI * 2) - (Math.PI / 2);
    return {
      x: center + Math.cos(angle) * radius * value,
      y: center + Math.sin(angle) * radius * value,
    };
  };
  const pathFor = (values) => values
    .map((value, index) => {
      const point = pointFor(index, value);
      return `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`;
    })
    .join(' ');

  return (
    <div className="lincon-month-radar">
      <svg viewBox="0 0 300 300" aria-hidden="true" focusable="false">
        {[28, 56, 84, 112].map((circleRadius) => (
          <circle key={circleRadius} cx={center} cy={center} r={circleRadius} />
        ))}
        {months.map((month, index) => {
          const angle = ((index / 12) * Math.PI * 2) - (Math.PI / 2);
          return (
            <line
              key={month[0]}
              x1={center}
              y1={center}
              x2={center + Math.cos(angle) * 124}
              y2={center + Math.sin(angle) * 124}
            />
          );
        })}
        <path d={`${pathFor(reservedValues)} Z`} className="lincon-radar-fill lincon-radar-fill--reserved" />
        <path d={`${pathFor(interestedValues)} Z`} className="lincon-radar-fill lincon-radar-fill--interested" />
        <path d={`${pathFor(reservedValues)} Z`} className="lincon-radar-line lincon-radar-line--reserved" />
        <path d={`${pathFor(interestedValues)} Z`} className="lincon-radar-line lincon-radar-line--interested" />
        <circle cx={center} cy={center} r="5" className="lincon-radar-dot" />
        {[interestedValues, reservedValues].flatMap((values, seriesIndex) =>
          values.map((value, index) => {
            if (!value) return null;
            const point = pointFor(index, value);
            return (
              <circle
                key={`${seriesIndex}-${months[index][0]}`}
                cx={point.x}
                cy={point.y}
                r={seriesIndex === 0 ? 4.8 : 4}
                className={seriesIndex === 0 ? 'lincon-radar-end' : 'lincon-radar-end lincon-radar-end--reserved'}
              />
            );
          })
        )}
      </svg>
      {months.map((month, index) => {
        const angle = ((index / 12) * Math.PI * 2) - (Math.PI / 2);
        return (
          <span
            key={month[0]}
            style={{ left: `${50 + Math.cos(angle) * 43}%`, top: `${50 + Math.sin(angle) * 43}%` }}
          >
            <strong>{month[0]}</strong>
            <em>{month[2]} / {month[3]}</em>
          </span>
        );
      })}
    </div>
  );
}

function LinconPanelView({ onOpenAgenda }) {
  return (
    <>
      <section className="lincon-hero">
        <div className="lincon-hero-copy">
          <span>Control comercial y operativo</span>
          <h1>Panel maestro del salon</h1>
          <p>Centro de Eventos Lincoln - Mes de trabajo: Junio de 2026 - Evento activo: Cena de Gala Lincoln 2026</p>
          <div className="lincon-progress">
            <div><span>Ocupacion del mes</span><strong>78%</strong></div>
            <progress value="78" max="100">78%</progress>
          </div>
          <div className="lincon-actions">
            <button type="button" onClick={onOpenAgenda}>Gestionar agenda</button>
            <button type="button">Nueva reserva</button>
            <button type="button">Ver eventos</button>
            <button type="button">Abrir CRM</button>
          </div>
        </div>
        <div className="lincon-hero-panels">
          <article><span>Conversion comercial</span><strong>32%</strong><small>12 oportunidades cerradas de 38</small></article>
          <article><span>Seguimientos en riesgo</span><strong>4</strong><small>Sin actividad en 7 dias</small></article>
          <article><span>Cobro pendiente</span><strong>Bs 18.450,00</strong><small>8 reservas en cartera</small></article>
        </div>
      </section>

      <section className="lincon-kpis">
        {[
          ['Reservas del mes', '16', '+3 vs mes anterior', 'calendar'],
          ['Eventos proximos', '5', 'Proximos 30 dias', 'star'],
          ['Cobros pendientes', 'Bs 18.450,00', '8 reserva(s) pendientes', 'wallet'],
          ['Conversion comercial', '32%', '12 cerradas de 38 oportunidades', 'chart'],
          ['Ocupacion mensual', '78%', '22 dias ocupados de 30', 'panel'],
        ].map(([label, value, detail, icon]) => (
          <article key={label}>
            <span><LinconIcon name={icon} /></span>
            <div><small>{label}</small><strong>{value}</strong><p>{detail}</p><button type="button">Ver detalle</button></div>
          </article>
        ))}
      </section>

      <section className="lincon-dashboard-grid">
        <article className="lincon-panel lincon-reservations">
          <header><h2>Proximos eventos / reservas</h2><button type="button">Ver todos</button></header>
          <div className="lincon-table">
            <div className="lincon-table-head">
              <span>Cliente</span><span>Tipo de evento</span><span>Fecha</span><span>Salon</span><span>Estado</span>
            </div>
            {upcomingReservations.map((reservation) => (
              <div className="lincon-table-row" key={`${reservation.client}-${reservation.date}`}>
                <span>{reservation.client}</span>
                <span>{reservation.eventType}</span>
                <span><strong>{reservation.date}</strong><small>{reservation.time}</small></span>
                <span>{reservation.room}</span>
                <span className={`lincon-status lincon-status--${reservation.status.toLowerCase().replace(' ', '-')}`}>{reservation.status}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="lincon-panel lincon-agenda">
          <header><h2>Agenda proximos dias</h2></header>
          {agendaItems.map((item) => (
            <div className="lincon-agenda-item" key={item.title}>
              <time><strong>{item.day}</strong><span>{item.month}</span></time>
              <div><strong>{item.title}</strong><span>{item.detail}</span></div>
            </div>
          ))}
          <button type="button" onClick={onOpenAgenda}>Ver agenda completa</button>
        </article>

        <article className="lincon-panel lincon-pending">
          <header><h2>Operaciones pendientes</h2></header>
          {pendingOperations.map((operation) => (
            <div className={`lincon-pending-item lincon-pending-item--${operation.accent}`} key={operation.title}>
              <span><LinconIcon name="panel" /></span>
              <div><strong>{operation.title}</strong><small>{operation.detail}</small></div>
              <button type="button">Ver</button>
            </div>
          ))}
        </article>
      </section>
    </>
  );
}

function LinconAgendaView() {
  const calendarDays = useMemo(() => buildJuneCalendarDays(), []);

  return (
    <div className="lincon-agenda-view">
      <section className="lincon-agenda-kpis">
        {agendaKpis.map(([label, value, detail, icon]) => (
          <article key={label}>
            <i><LinconIcon name={icon} /></i>
            <div>
              <span>{label}</span>
              <strong>{value}</strong>
              <p>{detail}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="lincon-agenda-core">
        <article className="lincon-agenda-radar lincon-green-panel">
          <div className="lincon-green-panel-head">
            <div>
              <h1>Radar anual</h1>
              <p>Comparativa de interesados y reservados por mes</p>
            </div>
          </div>
          <div className="lincon-radar-legend">
            <span><i /> Interesados</span>
            <span><i /> Reservados</span>
          </div>
          <div className="lincon-radar-layout">
            <MonthRadar />
            <div className="lincon-month-table">
              <header><span>Mes</span><span>Interesados</span><span>Reservados</span></header>
              {months.map((month) => (
                <article key={month[1]} className={month[1] === 'Junio' ? 'is-selected' : ''}>
                  <strong>{month[1]}</strong>
                  <span>{month[2]}</span>
                  <em>{month[3]}</em>
                </article>
              ))}
            </div>
          </div>
        </article>

        <article className="lincon-calendar-panel lincon-green-panel">
          <div className="lincon-green-panel-head">
            <h1>Calendario de reservas</h1>
            <div className="lincon-calendar-controls">
              <button type="button" aria-label="Mes anterior">&lt;</button>
              <select defaultValue="junio-2026"><option value="junio-2026">Junio de 2026</option></select>
              <button type="button" aria-label="Mes siguiente">&gt;</button>
              <select defaultValue="all"><option value="all">Todos los salones</option><option value="principal">Lincoln Salon Principal</option></select>
            </div>
          </div>
          <div className="lincon-calendar-weekdays">{weekDays.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="lincon-calendar-grid">
            {calendarDays.slice(0, 35).map((day, index) => (
              <article
                key={`${day.currentMonth ? 'current' : 'next'}-${day.day}-${index}`}
                className={`${!day.currentMonth ? 'is-muted' : ''} ${day.day === 18 && day.currentMonth ? 'is-selected' : ''}`}
              >
                <header><strong>{day.day}</strong></header>
                {day.events.map((event) => <em key={event.title} className={`lincon-calendar-event lincon-calendar-event--${event.type}`}>{event.title}</em>)}
              </article>
            ))}
          </div>
        </article>
      </section>

      <section className="lincon-day-detail lincon-green-panel">
        <div className="lincon-green-panel-head">
          <h1>Detalle del dia seleccionado - 18 de junio de 2026</h1>
        </div>
        <div className="lincon-day-layout">
          <aside className="lincon-day-actions">
            <div className="lincon-day-date">
              <span><LinconIcon name="calendar" /></span>
              <small>Jueves</small>
              <strong>18 de junio de 2026</strong>
            </div>
            <button type="button"><LinconIcon name="users" /> Registrar interesado</button>
            <button type="button"><LinconIcon name="bookmark" /> Registrar reserva</button>
          </aside>

          <article className="lincon-day-card lincon-day-card--lead">
            <header>
              <h2>Interesados del dia (1)</h2>
              <span>Interesado</span>
            </header>
            <strong>Ernesto - Interesado</strong>
            <p>Contacto: 75470080</p>
            <p>Evento: 18 jun 2026 | Proxima accion: 18 jun 2026</p>
            <p>Salon: Salon 1 | Paquete: Plata | Invitados: 10</p>
            <p>Cotizacion: Bs 10.200,00</p>
            <div className="lincon-progress-steps">
              {['Registro', 'Contacto', 'Cotizacion enviada', 'Visita', 'Cierre'].map((step, index) => (
                <span key={step} className={index < 3 ? 'is-done' : ''}><i />{step}</span>
              ))}
            </div>
            <button type="button">Ver detalles</button>
          </article>

          <article className="lincon-day-card lincon-day-card--reserved">
            <header>
              <h2>Reservados del dia (1)</h2>
              <span>Reservado</span>
            </header>
            <strong>Ernesto - Boda</strong>
            <p>Contacto: 75470080</p>
            <p>Evento: 18 jun 2026 | Invitados: 10</p>
            <p>Salon: Salon 1 | Paquete: Plata</p>
            <p>Monto: Bs 10.200,00</p>
            <div className="lincon-progress-steps lincon-progress-steps--green">
              {['Reserva', 'Confirmado', 'Contrato firmado', 'Deposito', 'Evento'].map((step, index) => (
                <span key={step} className={index < 3 ? 'is-done' : ''}><i />{step}</span>
              ))}
            </div>
            <button type="button">Ver detalles</button>
          </article>
        </div>
      </section>
    </div>
  );
}

function LinconReservationsView() {
  const selectedReservation = reservationRecords[0];
  const history = [
    ['16/06/2026', '10:24', 'Reserva confirmada', 'La reserva fue confirmada por el cliente.', 'Yordy Copa', 'done'],
    ['13/06/2026', '16:45', 'Cotizacion enviada', 'Se envio la cotizacion #COT-2026-0158 al cliente.', 'Yordy Copa', 'done'],
    ['12/06/2026', '11:32', 'Nuevo interesado registrado', 'Ernesto Rodriguez mostro interes en el salon.', 'Yordy Copa', 'done'],
    ['25/06/2026', 'Todo el dia', 'Pago programado', 'Segundo pago programado por Bs 2.040,00 (20%).', 'Pendiente', 'pending'],
  ];

  return (
    <div className="lincon-reservas-view lincon-reservas-view--list">
      <section className="lincon-reserva-kpis lincon-reserva-kpis--five">
        {reservationKpis.map(([label, value, detail, icon]) => (
          <article key={label}>
            <i><LinconIcon name={icon} /></i>
            <div>
              <span>{label}</span>
              <strong>{value}</strong>
              <p>{detail}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="lincon-reservas-workspace">
        <article className="lincon-green-panel lincon-reservas-list lincon-reservas-list--wide">
          <div className="lincon-green-panel-head">
            <h1>Lista de reservas</h1>
          </div>

          <div className="lincon-reserva-tabs lincon-reserva-tabs--boxed">
            <button type="button" className="is-active">Todas</button>
            <button type="button">Pendientes</button>
            <button type="button">Confirmadas</button>
            <button type="button">Finalizadas</button>
            <button type="button">Canceladas</button>
          </div>

          <div className="lincon-reserva-filters">
            <label className="lincon-reserva-search">
              <LinconIcon name="panel" />
              <input type="search" placeholder="Buscar por cliente o evento..." />
            </label>
            <label className="lincon-reserva-filter-field">
              <span>Estado</span>
              <select defaultValue="all">
                <option value="all">Todos</option>
                <option value="pending">Pendientes</option>
                <option value="confirmed">Confirmadas</option>
              </select>
            </label>
            <label className="lincon-reserva-filter-field">
              <span>Salon</span>
              <select defaultValue="all">
                <option value="all">Todos</option>
                <option value="salon-1">Salon 1</option>
                <option value="salon-2">Salon 2</option>
              </select>
            </label>
            <label className="lincon-reserva-filter-field">
              <span>Mes</span>
              <select defaultValue="junio">
                <option value="junio">Junio 2026</option>
                <option value="julio">Julio 2026</option>
              </select>
            </label>
            <button type="button" className="lincon-reserva-filter-button"><LinconIcon name="chart" /> Filtros</button>
          </div>

          <div className="lincon-reserva-table lincon-reserva-table--full">
            <header>
              <span>Cliente / evento</span>
              <span>Fecha</span>
              <span>Salon</span>
              <span>Estado</span>
              <span>Pago</span>
              <span>Monto</span>
              <span>Acciones</span>
            </header>
            {reservationRecords.map((reservation, index) => (
              <button key={reservation.id} type="button" className={index === 0 ? 'is-selected' : ''}>
                <span><strong>{reservation.client}</strong><small>{reservation.event} - {reservation.packageName}</small></span>
                <span><strong>{reservation.date}</strong><small>{reservation.time}</small></span>
                <span><strong>{reservation.room}</strong><small>{reservation.packageName.replace('Paquete ', '')}</small></span>
                <em className={`lincon-reserva-state lincon-reserva-state--${reservation.status.toLowerCase()}`}>{reservation.status}</em>
                <span className={`lincon-payment ${reservation.paid === 'Sin pago' ? 'is-empty' : reservation.paid.includes('100') ? 'is-full' : 'is-partial'}`}>{reservation.paid}</span>
                <span><strong>{reservation.amount}</strong></span>
                <span className="lincon-reserva-actions-dot">...</span>
              </button>
            ))}
          </div>

          <footer className="lincon-reserva-pagination">
            <span>Mostrando 1 a 8 de 32 reservas</span>
            <div>
              <button type="button" aria-label="Anterior">&lt;</button>
              <button type="button" className="is-active">1</button>
              <button type="button">2</button>
              <button type="button">3</button>
              <button type="button">4</button>
              <button type="button" aria-label="Siguiente">&gt;</button>
            </div>
          </footer>
        </article>

        <aside className="lincon-reserva-side">
          <article className="lincon-green-panel lincon-reserva-detail lincon-reserva-detail--profile">
            <div className="lincon-reserva-detail-title">
              <h1>Detalle de reserva</h1>
              <em className="lincon-reserva-state lincon-reserva-state--confirmada">Confirmada</em>
            </div>
            <div className="lincon-reserva-profile-head">
              <span className="lincon-reserva-avatar"><LinconIcon name="users" /></span>
              <div>
                <h1>{selectedReservation.client}</h1>
                <p>{selectedReservation.event}</p>
              </div>
              <div>
                <small>Reserva #{selectedReservation.id}</small>
                <small>Creada el 12/06/2026</small>
              </div>
            </div>

            <div className="lincon-reserva-detail-matrix">
              <article><i><LinconIcon name="calendar" /></i><div><span>Fecha y hora</span><strong>18 de junio de 2026</strong><small>18:00 - 01:00</small></div></article>
              <article><i><LinconIcon name="users" /></i><div><span>Contacto</span><strong>{selectedReservation.phone}</strong><small>{selectedReservation.email}</small></div></article>
              <article className="lincon-reserva-money-cell"><i><LinconIcon name="wallet" /></i><div><span>Monto total</span><strong>{selectedReservation.amount}</strong></div></article>
              <article><i><LinconIcon name="home" /></i><div><span>Salon y paquete</span><strong>{selectedReservation.room}</strong><small>{selectedReservation.packageName}</small></div></article>
              <article><i><LinconIcon name="panel" /></i><div><span>Organizacion</span><strong>Particular</strong></div></article>
              <article className="lincon-reserva-money-cell"><i><LinconIcon name="wallet" /></i><div><span>Pagado</span><strong>Bs 7.140,00</strong><small>(70%)</small></div></article>
              <article><i><LinconIcon name="users" /></i><div><span>Asistentes</span><strong>{selectedReservation.guests} personas</strong><small>100 adultos / 50 ninos</small></div></article>
              <article><i><LinconIcon name="bookmark" /></i><div><span>Observaciones</span><strong>Mesa de honor frente al escenario.</strong><small>Alergicos: 2 personas.</small></div></article>
              <article className="lincon-reserva-money-cell lincon-reserva-money-cell--debt"><i><LinconIcon name="wallet" /></i><div><span>Saldo pendiente</span><strong>{selectedReservation.balance}</strong></div></article>
            </div>

            <div className="lincon-progress-steps lincon-reserva-detail-timeline">
              {[
                ['Interesado', '12/06/2026', true],
                ['Cotizacion', '13/06/2026', true],
                ['Reserva', '16/06/2026', true],
                ['Contrato', 'Pendiente', false],
                ['Evento', '18/06/2026', false],
              ].map(([step, date, done]) => (
                <span key={step} className={done ? 'is-done' : ''}><i />{step}<small>{date}</small></span>
              ))}
            </div>

            <div className="lincon-reserva-actions lincon-reserva-actions--inline">
              <button type="button"><LinconIcon name="wallet" /> Registrar pago</button>
              <button type="button"><LinconIcon name="bookmark" /> Ver contrato</button>
              <button type="button"><LinconIcon name="panel" /> Editar reserva</button>
            </div>
          </article>

          <article className="lincon-green-panel lincon-reserva-history">
            <div className="lincon-green-panel-head">
              <h1>Historial y proximas acciones</h1>
            </div>
            <div className="lincon-reserva-history-list">
              {history.map(([date, hour, title, detail, owner, state]) => (
                <article key={`${date}-${title}`} className={state === 'pending' ? 'is-pending' : ''}>
                  <time><strong>{date}</strong><span>{hour}</span></time>
                  <i />
                  <div>
                    <strong>{title}</strong>
                    <p>{detail}</p>
                  </div>
                  <small>{owner}</small>
                </article>
              ))}
            </div>
            <button type="button" className="lincon-history-more">Ver todas las acciones</button>
          </article>
        </aside>
      </section>
    </div>
  );
}

function LinconWorkspaceSection({
  currentUser,
  availableCompanies = ['lincoln'],
  attendanceProps = {},
  onOpenAttendance,
  onSwitchWorkspace,
  onLogout,
}) {
  const [activeView, setActiveView] = useState('panel');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [databaseStatus, setDatabaseStatus] = useState({ loading: true, error: '', snapshot: null });
  const userName = currentUser?.fullName ?? currentUser?.name ?? 'Yordy Copa Cerezo';
  const userInitials = userName.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'US';
  const workspaceTitle = {
    agenda: 'Agenda / Centro de Eventos Lincoln',
    reservas: 'Reservas / Centro de Eventos Lincoln',
  }[activeView] ?? 'Lincoln Workspace';
  const workspaceAction = {
    agenda: '+ Nuevo registro',
    reservas: '+ Nueva reserva',
  }[activeView];
  const activeItem = sidebarItems.find((item) => item.id === activeView) ?? sidebarItems[0];

  const openView = (viewId) => {
    if (!linconEnabledViews.has(viewId)) return;
    setActiveView(viewId);
    setIsMobileMenuOpen(false);
    if (viewId === 'asistencia') onOpenAttendance?.();
  };

  useEffect(() => {
    let disposed = false;
    api.lincoln.getState()
      .then((snapshot) => {
        if (!disposed) setDatabaseStatus({ loading: false, error: '', snapshot });
      })
      .catch((error) => {
        if (!disposed) setDatabaseStatus({ loading: false, error: error.message || 'No se pudo abrir la base Lincoln.', snapshot: null });
      });
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <div className={`lincon-shell ${activeView !== 'panel' ? 'lincon-shell--agenda' : ''}`}>
      <aside className="lincon-sidebar">
        <div className="lincon-logo"><span /><small>Centro de Eventos</small><strong>Lincoln</strong></div>

        <label className="lincon-workspace-select">
          <span>Workspace activo</span>
          <select defaultValue="lincoln"><option value="lincoln">Centro de Eventos Lincoln</option></select>
        </label>

        <div className="lincon-user-card"><span>YC</span><div><strong>{userName}</strong><small>{currentUser?.role ?? 'Usuario'}</small></div></div>

        <nav className="lincon-nav" aria-label="Lincoln">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeView === item.id ? 'is-active' : ''}
              onClick={() => openView(item.id)}
              disabled={!linconEnabledViews.has(item.id)}
            >
              <LinconIcon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>

        {availableCompanies.includes('copetin') ? (
          <div className="lincon-switcher">
            <span>Espacios habilitados</span>
            <p>Selecciona tu area de trabajo</p>
            <div><button type="button" onClick={() => onSwitchWorkspace('copetin')}>Copetin</button><button type="button" className="is-current">Lincoln</button></div>
          </div>
        ) : null}
      </aside>

      <main className="lincon-main">
        <header className="lincon-mobile-header">
          <div className="lincon-mobile-brand">
            <small>Centro de Eventos</small>
            <strong>Lincoln</strong>
          </div>
          <div className="lincon-mobile-heading">
            <span>{activeItem.label}</span>
            <small className={databaseStatus.error ? 'has-error' : ''}>
              <i />{databaseStatus.loading ? 'Conectando' : databaseStatus.error ? 'Sin conexion' : 'Base Lincoln'}
            </small>
          </div>
          <button type="button" className="lincon-mobile-account" onClick={() => setIsMobileMenuOpen(true)} aria-label="Abrir menu de usuario">
            {userInitials}
          </button>
        </header>

        <header className="lincon-topbar">
          <div className="lincon-topbar-brand">
            <LinconIcon name="home" />
            <strong>{workspaceTitle}</strong>
          </div>
          <div className={`lincon-topbar-status ${databaseStatus.error ? 'has-error' : ''}`}>
            <span />
            <div>
              <strong>{databaseStatus.loading ? 'Conectando base Lincoln' : databaseStatus.error ? 'Base Lincoln no disponible' : 'Base Lincoln separada'}</strong>
              <small>{databaseStatus.error || (databaseStatus.snapshot ? `Revision ${databaseStatus.snapshot.version}` : 'Sin mezclar datos con El Copetin')}</small>
            </div>
          </div>
          <button type="button" className="lincon-icon-button" aria-label="Notificaciones"><LinconIcon name="bell" /></button>
          {workspaceAction ? <button type="button" className="lincon-new-record">{workspaceAction}</button> : null}
          <div className="lincon-account"><div><strong>{userName}</strong><small>{currentUser?.role ?? 'Usuario'}</small></div><span>YC</span></div>
          <button type="button" className="lincon-logout" onClick={onLogout}>Salir</button>
        </header>

        {activeView === 'agenda' ? <LinconAgendaView /> : null}
        {activeView === 'reservas' ? <LinconReservationsView /> : null}
        {activeView === 'asistencia' ? <AttendanceSection {...attendanceProps} /> : null}
        {activeView === 'panel' ? <LinconPanelView onOpenAgenda={() => openView('agenda')} /> : null}
      </main>

      <nav className="lincon-mobile-nav" aria-label="Navegacion principal de Lincoln">
        {linconMobilePrimaryItems.map((item) => (
          <button key={item.id} type="button" className={activeView === item.id ? 'is-active' : ''} onClick={() => openView(item.id)}>
            <LinconIcon name={item.icon} />
            <span>{item.id === 'asistencia' ? 'Asistencia' : item.label}</span>
          </button>
        ))}
        <button type="button" className={isMobileMenuOpen ? 'is-active' : ''} onClick={() => setIsMobileMenuOpen(true)}>
          <span className="lincon-mobile-more-icon"><i /><i /><i /></span>
          <span>Mas</span>
        </button>
      </nav>

      {isMobileMenuOpen ? (
        <div className="lincon-mobile-menu-backdrop" role="presentation" onClick={() => setIsMobileMenuOpen(false)}>
          <section className="lincon-mobile-menu" role="dialog" aria-modal="true" aria-label="Mas opciones de Lincoln" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><small>Lincoln</small><strong>Mas opciones</strong></div>
              <button type="button" onClick={() => setIsMobileMenuOpen(false)} aria-label="Cerrar menu">×</button>
            </header>
            <div className="lincon-mobile-user-summary">
              <span>{userInitials}</span>
              <div><strong>{userName}</strong><small>{currentUser?.role ?? 'Usuario'}</small></div>
            </div>
            <div className="lincon-mobile-more-grid">
              {linconMobileMoreItems.map((item) => (
                <button key={item.id} type="button" disabled title="Disponible proximamente">
                  <LinconIcon name={item.icon} />
                  <span>{item.label}</span>
                  <small>Proximamente</small>
                </button>
              ))}
            </div>
            <div className="lincon-mobile-menu-actions">
              {availableCompanies.includes('copetin') ? (
                <button type="button" onClick={() => onSwitchWorkspace('copetin')}><LinconIcon name="home" /> Ir a El Copetin</button>
              ) : null}
              <button type="button" className="is-logout" onClick={onLogout}>Salir de la sesion</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default LinconWorkspaceSection;
