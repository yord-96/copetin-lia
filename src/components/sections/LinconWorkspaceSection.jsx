import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import AttendanceSection from './AttendanceSection';
import LincolnAgenda from '../lincoln/agenda/LincolnAgenda';
import LincolnSettlements from '../lincoln/settlements/LincolnSettlements';
import LincolnReports from '../lincoln/reports/LincolnReports';
import LincolnCommercialWorkspace from '../lincoln/commercial/LincolnCommercialWorkspace';
import LincolnClients from '../lincoln/clients/LincolnClients';
import LincolnMeetings from '../lincoln/meetings/LincolnMeetings';
import LincolnRooms from '../lincoln/rooms/LincolnRooms';
import LincolnPackages from '../lincoln/packages/LincolnPackages';
import '../lincoln/styles/lincoln-base.css';
import '../lincoln/styles/lincoln-agenda.css';
import '../lincoln/styles/lincoln-settlements.css';
import '../lincoln/styles/lincoln-reports.css';
import '../lincoln/styles/lincoln-commercial.css';
import { lincolnEnabledViews, lincolnSidebarItems } from '../lincoln/config/navigation';
import LincolnWorkspaceLayout from '../lincoln/layout/LincolnWorkspaceLayout';
import LinconIcon from '../lincoln/shared/LinconIcon';

const emptyState = {
  reservations: [],
  leads: [],
  events: [],
  rooms: [],
  packages: [],
  clients: [],
  meetings: [],
  suppliers: [],
  inventory: [],
  payments: [],
  receipts: [],
  incomeEntries: [],
  expenseEntries: [],
  eventSettlements: [],
  auditLog: [],
  settings: {},
};

const toNumber = (value) => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatBs = (value) => new Intl.NumberFormat('es-BO', {
  style: 'currency',
  currency: 'BOB',
  minimumFractionDigits: 2,
}).format(Number(value ?? 0));

const formatDate = (value) => {
  if (!value) return 'Sin fecha';
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const statusLabel = (status) => ({
  lead: 'Interesado',
  tentative: 'Tentativa',
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  converted: 'Convertida',
  cancelled: 'Cancelada',
  contract_pending: 'Contrato pendiente',
  contracted: 'Contratado',
  completed: 'Realizado',
}[String(status ?? '').toLowerCase()] ?? String(status || 'Pendiente'));

const sum = (rows, selector) => rows.reduce((total, row) => total + Number(selector(row) ?? 0), 0);

const servicePaymentTypes = new Set(['advance', 'installment', 'balance']);
const paymentTypeLabel = (type) => ({
  advance: 'Anticipo',
  installment: 'A cuenta',
  balance: 'Saldo',
  guarantee: 'Garantía',
  replacement: 'Reposición',
  guarantee_return: 'Devolución garantía',
}[type] ?? type ?? 'Movimiento');
const paymentMethodLabel = (method) => ({ cash: 'Efectivo', transfer: 'Transferencia', qr: 'QR' }[method] ?? method ?? '—');
const activeRows = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => !row?.voidedAt && row?.status !== 'voided');


function EmptyBlock({ title, detail, actionLabel, onAction }) {
  return (
    <div className="lincoln-empty">
      <strong>{title}</strong>
      <p>{detail}</p>
      {onAction ? <button type="button" onClick={onAction}>{actionLabel}</button> : null}
    </div>
  );
}

function KpiCard({ icon, label, value, detail }) {
  return (
    <article className="lincoln-kpi">
      <span className="lincoln-kpi-icon"><LinconIcon name={icon} /></span>
      <div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div>
    </article>
  );
}

function DataTable({ columns, rows, onSelect, emptyText }) {
  if (!rows.length) return <EmptyBlock title="Sin registros" detail={emptyText} />;
  return (
    <div className="lincoln-table-wrap">
      <table className="lincoln-data-table">
        <thead>
          <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onClick={() => onSelect?.(row)} className={onSelect ? 'is-clickable' : ''}>
              {columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key] || '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Modal({ title, children, saving, onClose, onSubmit, className = '' }) {
  return (
    <div className="lincoln-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className={`lincoln-modal ${className}`.trim()} onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>Centro de Eventos Lincoln</small><h2>{title}</h2></div><button type="button" onClick={onClose}>×</button></header>
        <div className="lincoln-modal-body">{children}</div>
        <footer><button type="button" className="is-secondary" onClick={onClose}>Cancelar</button><button type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button></footer>
      </form>
    </div>
  );
}

function Field({ label, children, wide = false }) {
  return <label className={wide ? 'lincoln-form-field is-wide' : 'lincoln-form-field'}><span>{label}</span>{children}</label>;
}

const lincolnTodayKey = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const reservationBlocksDate = (reservation) => {
  const status = String(reservation?.status ?? '').toLowerCase();
  if (['cancelled', 'converted', 'lead'].includes(status)) return false;
  if (reservation?.reservationPaymentBs !== undefined) return toNumber(reservation.reservationPaymentBs) > 0;
  return ['pending', 'confirmed', 'tentative'].includes(status);
};

const getReservationAvailability = (state, { eventDate, roomId, reservationId }) => {
  if (!eventDate) return { commitments: [], interests: [], roomConflicts: [] };
  const reservations = (state.reservations ?? [])
    .filter((row) => row.id !== reservationId && String(row.eventDate ?? '').slice(0, 10) === eventDate)
    .filter((row) => !['cancelled', 'converted'].includes(String(row.status ?? '').toLowerCase()))
    .map((row) => ({ ...row, kind: reservationBlocksDate(row) ? 'Reserva' : 'Interesado', blocksDate: reservationBlocksDate(row) }));
  const events = (state.events ?? [])
    .filter((row) => String(row.reservationId ?? '') !== String(reservationId ?? ''))
    .filter((row) => String(row.eventDate ?? '').slice(0, 10) === eventDate)
    .filter((row) => String(row.status ?? '').toLowerCase() !== 'cancelled')
    .map((row) => ({ ...row, kind: 'Evento', blocksDate: true }));
  const rows = [...reservations, ...events];
  const commitments = rows.filter((row) => row.blocksDate);
  return {
    commitments,
    interests: rows.filter((row) => !row.blocksDate),
    roomConflicts: roomId ? commitments.filter((row) => String(row.roomId ?? '') === String(roomId)) : [],
  };
};

function ReservationModal({ record, state, saving, onClose, onSave }) {
  const isEdit = Boolean(record?.id);
  const [form, setForm] = useState(() => ({
    ...(record ?? {}),
    contractor1Name: record?.contractor1Name ?? record?.clientName ?? '',
    contractor1Ci: record?.contractor1Ci ?? record?.clientCi ?? '',
    contractor1Phone: record?.contractor1Phone ?? record?.clientPhone ?? '',
    contractor2Name: record?.contractor2Name ?? record?.secondContractorName ?? '',
    contractor2Ci: record?.contractor2Ci ?? record?.secondContractorCi ?? '',
    contractor2Phone: record?.contractor2Phone ?? record?.secondContractorPhone ?? '',
    organizerId: record?.organizerId ?? '',
    reservationDate: record?.reservationDate ?? (String(record?.createdAt ?? '').slice(0, 10) || lincolnTodayKey()),
    durationHours: record?.durationHours ?? 8,
    reservationPaymentBs: record?.reservationPaymentBs ?? '',
    guaranteeBs: record?.guaranteeBs ?? '',
    accountPaymentBs: record?.accountPaymentBs ?? '',
  }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const rooms = (state.rooms ?? []).filter((room) => room.status !== 'inactive');
  const packages = (state.packages ?? []).filter((pkg) => pkg.status !== 'inactive');
  const organizers = (state.clients ?? []).filter((client) => client.status !== 'inactive');
  const eventTypes = Array.isArray(state.settings?.eventTypes) ? state.settings.eventTypes : [];
  const reservationPaymentBs = toNumber(form.reservationPaymentBs);
  const availability = useMemo(() => getReservationAvailability(state, {
    eventDate: form.eventDate,
    roomId: form.roomId,
    reservationId: record?.id,
  }), [form.eventDate, form.roomId, record?.id, state]);
  const selectedRoom = rooms.find((room) => room.id === form.roomId);
  const availabilityTone = availability.roomConflicts.length ? 'is-busy' : availability.commitments.length ? 'is-partial' : 'is-free';
  const availabilityTitle = !form.eventDate
    ? 'Selecciona la fecha del evento para revisar disponibilidad.'
    : !form.roomId && availability.commitments.length
      ? `Hay ${availability.commitments.length} reserva o evento en esta fecha. Selecciona un salón para comprobarlo.`
    : availability.roomConflicts.length
      ? `${selectedRoom?.name || 'El salón'} ya está ocupado en esta fecha.`
      : availability.commitments.length
        ? `Hay ${availability.commitments.length} reserva o evento en esta fecha, pero el salón seleccionado está libre.`
        : 'La fecha está libre para reservar.';

  const submit = (event) => {
    event.preventDefault();
    if (reservationPaymentBs > 0 && availability.roomConflicts.length) {
      window.alert('No se puede confirmar la reserva porque el salón ya está comprometido en esa fecha.');
      return;
    }
    const organizer = organizers.find((item) => item.id === form.organizerId);
    onSave({
      ...form,
      clientId: null,
      clientName: String(form.contractor1Name ?? '').trim(),
      clientCi: String(form.contractor1Ci ?? '').trim(),
      clientPhone: String(form.contractor1Phone ?? '').trim(),
      organizerId: organizer?.id ?? null,
      organizerName: organizer?.name ?? '',
      organizerPhone: organizer?.phone ?? '',
      reservationPaymentBs,
      guaranteeBs: toNumber(form.guaranteeBs),
      accountPaymentBs: toNumber(form.accountPaymentBs),
      estimatedTotalBs: toNumber(form.estimatedTotalBs),
      status: ['cancelled', 'converted'].includes(String(form.status ?? '').toLowerCase())
        ? form.status
        : reservationPaymentBs > 0 ? 'confirmed' : 'lead',
    });
  };

  return (
    <Modal className="lincoln-reservation-modal" title={`${isEdit ? 'Editar' : 'Nueva'} reserva`} saving={saving} onClose={onClose} onSubmit={submit}>
      <section className="lincoln-reservation-section is-identity">
        <header><div><small>01 · Titulares</small><h3>¿A nombre de quién se registra?</h3></div><span>Los titulares se registran automáticamente como clientes</span></header>
        <div className="lincoln-reservation-contractors">
          <article>
            <strong>Contratante 1</strong>
            <Field label="Nombre completo"><input required value={form.contractor1Name ?? ''} onChange={(e) => set('contractor1Name', e.target.value)} placeholder="Nombre y apellidos" /></Field>
            <div><Field label="C.I."><input value={form.contractor1Ci ?? ''} onChange={(e) => set('contractor1Ci', e.target.value)} /></Field><Field label="Celular"><input required inputMode="tel" value={form.contractor1Phone ?? ''} onChange={(e) => set('contractor1Phone', e.target.value)} /></Field></div>
          </article>
          <article>
            <strong>Contratante 2 <small>Opcional</small></strong>
            <Field label="Nombre completo"><input value={form.contractor2Name ?? ''} onChange={(e) => set('contractor2Name', e.target.value)} placeholder="Segundo titular" /></Field>
            <div><Field label="C.I."><input value={form.contractor2Ci ?? ''} onChange={(e) => set('contractor2Ci', e.target.value)} /></Field><Field label="Celular"><input inputMode="tel" value={form.contractor2Phone ?? ''} onChange={(e) => set('contractor2Phone', e.target.value)} /></Field></div>
          </article>
        </div>
        <Field label="Organizador responsable (opcional)" wide><select value={form.organizerId ?? ''} onChange={(e) => set('organizerId', e.target.value)}><option value="">Sin organizador asignado</option>{organizers.map((organizer) => <option key={organizer.id} value={organizer.id}>{organizer.name}{organizer.phone ? ` · ${organizer.phone}` : ''}</option>)}</select></Field>
      </section>

      <section className="lincoln-reservation-section is-schedule">
        <header><div><small>02 · Agenda</small><h3>Fecha y características del evento</h3></div></header>
        <div className="lincoln-reservation-fields">
          <Field label="Fecha de registro de la reserva"><input required type="date" value={form.reservationDate ?? ''} onChange={(e) => set('reservationDate', e.target.value)} /><em>Para reservas antiguas, registra aquí la fecha original.</em></Field>
          <Field label="Fecha del evento"><input required type="date" value={form.eventDate ?? ''} onChange={(e) => set('eventDate', e.target.value)} /></Field>
          <Field label="Tipo de encuentro o actividad"><input required list="lincoln-event-types" value={form.eventType ?? ''} onChange={(e) => set('eventType', e.target.value)} placeholder="Boda, graduación, reunión..." /><datalist id="lincoln-event-types">{eventTypes.map((type) => <option key={type} value={type} />)}</datalist></Field>
          <Field label="Hora de inicio"><input required type="time" value={form.startTime ?? ''} onChange={(e) => set('startTime', e.target.value)} /></Field>
          <Field label="Duración del evento (horas)"><input required type="number" min="0.5" step="0.5" value={form.durationHours ?? 8} onChange={(e) => set('durationHours', toNumber(e.target.value))} /></Field>
          <Field label="Salón"><select required value={form.roomId ?? ''} onChange={(e) => { const room = rooms.find((item) => item.id === e.target.value); setForm((current) => ({ ...current, roomId: room?.id ?? '', roomName: room?.name ?? '' })); }}><option value="">Seleccionar salón</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></Field>
        </div>
        <div className={`lincoln-reservation-availability ${availabilityTone}`}><span aria-hidden="true">{availability.roomConflicts.length ? '!' : '✓'}</span><div><strong>{availabilityTitle}</strong>{availability.interests.length ? <small>{availability.interests.length} interesado(s) no bloquean la fecha.</small> : null}{availability.commitments.slice(0, 4).map((row) => <small key={`${row.kind}-${row.id}`}>{row.kind} {row.code} · {row.clientName || 'Sin nombre'} · {row.roomName || 'sin salón'} · {row.startTime || 'hora pendiente'}</small>)}</div></div>
        <div className="lincoln-reservation-fields is-commercial">
          <Field label="Paquete"><select value={form.packageId ?? ''} onChange={(e) => { const pkg = packages.find((item) => item.id === e.target.value); setForm((current) => ({ ...current, packageId: pkg?.id ?? '', packageName: pkg?.name ?? '', packagePricePerPersonBs: Number(pkg?.pricePerPersonBs ?? 0) })); }}><option value="">Sin definir</option>{packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}</option>)}</select></Field>
          <Field label="Cantidad de invitados"><input type="number" min="0" value={form.guestCount ?? ''} onChange={(e) => set('guestCount', toNumber(e.target.value))} /></Field>
          <Field label="Total estimado (Bs)"><input type="number" min="0" step="0.01" value={form.estimatedTotalBs ?? ''} onChange={(e) => set('estimatedTotalBs', e.target.value)} /></Field>
        </div>
      </section>

      <section className="lincoln-reservation-section is-money">
        <header><div><small>03 · Condición económica</small><h3>Montos separados</h3></div><span className={reservationPaymentBs > 0 ? 'is-confirmed' : 'is-interested'}>{reservationPaymentBs > 0 ? 'Reserva confirmada · bloquea fecha' : 'Solo interesado · fecha disponible'}</span></header>
        <div className="lincoln-reservation-money-grid">
          <Field label="Dinero de reserva (Bs)"><input type="number" min="0" step="0.01" value={form.reservationPaymentBs ?? ''} onChange={(e) => set('reservationPaymentBs', e.target.value)} /><em>Este monto confirma y bloquea el salón.</em></Field>
          <Field label="Garantía (Bs)"><input type="number" min="0" step="0.01" value={form.guaranteeBs ?? ''} onChange={(e) => set('guaranteeBs', e.target.value)} /><em>Monto retenido y eventualmente devoluble.</em></Field>
          <Field label="A cuenta (Bs)"><input type="number" min="0" step="0.01" value={form.accountPaymentBs ?? ''} onChange={(e) => set('accountPaymentBs', e.target.value)} /><em>Abono que reduce el saldo del evento.</em></Field>
        </div>
      </section>

      <section className="lincoln-reservation-section is-notes">
        {isEdit ? <Field label="Estado administrativo"><select value={String(form.status ?? '').toLowerCase() === 'cancelled' ? 'cancelled' : 'active'} onChange={(e) => set('status', e.target.value === 'cancelled' ? 'cancelled' : reservationPaymentBs > 0 ? 'confirmed' : 'lead')}><option value="active">Activa según el dinero de reserva</option><option value="cancelled">Cancelada</option></select></Field> : null}
        <Field label="Observaciones y acuerdos" wide><textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Detalles conversados, condiciones especiales o próximos pasos..." /></Field>
      </section>
    </Modal>
  );
}

function RecordModal({ mode, record, state, saving, onClose, onSave }) {
  const isEdit = Boolean(record?.id);
  const [form, setForm] = useState(() => ({ ...(record ?? {}) }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const roomOptions = state.rooms ?? [];
  const clientOptions = state.clients ?? [];
  const submit = (event) => {
    event.preventDefault();
    onSave(form);
  };

  if (mode === 'clients') {
    return (
      <Modal title={`${isEdit ? 'Editar' : 'Nuevo'} cliente`} saving={saving} onClose={onClose} onSubmit={submit}>
        <Field label="Nombre completo" wide><input required value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="C.I."><input value={form.ci ?? ''} onChange={(e) => set('ci', e.target.value)} /></Field>
        <Field label="Teléfono"><input required value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Segundo teléfono"><input value={form.secondaryPhone ?? ''} onChange={(e) => set('secondaryPhone', e.target.value)} /></Field>
        <Field label="Correo"><input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Notas" wide><textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </Modal>
    );
  }

  if (mode === 'rooms') {
    return (
      <Modal title={`${isEdit ? 'Editar' : 'Nuevo'} salón`} saving={saving} onClose={onClose} onSubmit={submit}>
        <Field label="Nombre del salón" wide><input required value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="Ej. SALÓN GRANDE" /></Field>
        <Field label="Capacidad"><input type="number" min="0" value={form.capacity ?? ''} onChange={(e) => set('capacity', toNumber(e.target.value))} /></Field>
        <Field label="Estado"><select value={form.status ?? 'active'} onChange={(e) => set('status', e.target.value)}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></Field>
        <Field label="Descripción" wide><textarea value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
      </Modal>
    );
  }


  if (mode === 'reservations') {
    return <ReservationModal record={record} state={state} saving={saving} onClose={onClose} onSave={onSave} />;
  }

  return (
    <Modal title={`${isEdit ? 'Editar' : 'Nuevo'} contrato`} saving={saving} onClose={onClose} onSubmit={submit}>
      <Field label="Cliente / contratante" wide>
        <select value={form.clientId ?? ''} onChange={(e) => {
          const client = clientOptions.find((item) => item.id === e.target.value);
          setForm((current) => ({
            ...current,
            clientId: client?.id ?? '',
            clientName: client?.name ?? '',
            clientPhone: client?.phone ?? '',
            clientCi: client?.ci ?? '',
          }));
        }}>
          <option value="">Seleccionar cliente</option>
          {clientOptions.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
      </Field>
      <Field label="Segundo contratante"><input value={form.secondContractorName ?? ''} onChange={(e) => set('secondContractorName', e.target.value)} /></Field>
      <Field label="C.I. segundo contratante"><input value={form.secondContractorCi ?? ''} onChange={(e) => set('secondContractorCi', e.target.value)} /></Field>
      <Field label="Tipo de evento"><input required value={form.eventType ?? ''} onChange={(e) => set('eventType', e.target.value)} /></Field>
      <Field label="Fecha"><input required type="date" value={form.eventDate ?? ''} onChange={(e) => set('eventDate', e.target.value)} /></Field>
      <Field label="Hora"><input type="time" value={form.startTime ?? ''} onChange={(e) => set('startTime', e.target.value)} /></Field>
      <Field label="Duración (horas)"><input type="number" min="1" value={form.durationHours ?? 8} onChange={(e) => set('durationHours', toNumber(e.target.value))} /></Field>
      <Field label="Salón">
        <select required value={form.roomId ?? ''} onChange={(e) => {
          const room = roomOptions.find((item) => item.id === e.target.value);
          setForm((current) => ({ ...current, roomId: room?.id ?? '', roomName: room?.name ?? '' }));
        }}>
          <option value="">Seleccionar salón</option>
          {roomOptions.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select>
      </Field>
      <Field label="Invitados"><input type="number" min="0" value={form.guestCount ?? ''} onChange={(e) => set('guestCount', toNumber(e.target.value))} /></Field>
      <Field label="Costo total (Bs)"><input type="number" min="0" step="0.01" value={form.estimatedTotalBs ?? ''} onChange={(e) => set('estimatedTotalBs', toNumber(e.target.value))} /></Field>
      <Field label="Garantía (Bs)"><input type="number" min="0" step="0.01" value={form.guaranteeBs ?? 0} onChange={(e) => set('guaranteeBs', toNumber(e.target.value))} /></Field>
      <Field label="Estado"><select value={form.status ?? 'contract_pending'} onChange={(e) => set('status', e.target.value)}><option value="contract_pending">Contrato pendiente</option><option value="contracted">Contratado</option><option value="completed">Realizado</option><option value="cancelled">Cancelado</option></select></Field>
      <Field label="Observaciones / acuerdos" wide><textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
    </Modal>
  );
}

function LinconPanelView({ state, onNavigate }) {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = state.events
    .filter((event) => String(event.eventDate ?? '') >= today && event.status !== 'cancelled')
    .sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate)))
    .slice(0, 6);
  const activeReservations = state.reservations.filter((row) => !['cancelled', 'converted', 'lead'].includes(row.status));
  const interestedReservations = state.reservations.filter((row) => row.status === 'lead');
  const projected = sum(activeReservations, (row) => row.estimatedTotalBs);
  return (
    <div className="lincoln-content">
      <section className="lincoln-kpi-grid">
        <KpiCard icon="calendar" label="Próximos eventos" value={String(upcoming.length)} detail="Eventos registrados desde hoy" />
        <KpiCard icon="bookmark" label="Reservas activas" value={String(activeReservations.length)} detail={`${interestedReservations.length} interesado(s) sin bloqueo`} />
        <KpiCard icon="users" label="Clientes" value={String(state.clients.length)} detail="Base propia de Lincoln" />
        <KpiCard icon="wallet" label="Facturación proyectada" value={formatBs(projected)} detail="Reservas activas" />
      </section>
      <section className="lincoln-two-cols">
        <article className="lincoln-card">
          <header><div><small>Operación</small><h2>Próximos eventos</h2></div><button type="button" onClick={() => onNavigate('comercial')}>Ver contratos</button></header>
          {upcoming.length ? upcoming.map((event) => (
            <button type="button" className="lincoln-list-row" key={event.id} onClick={() => onNavigate('comercial')}>
              <span><strong>{formatDate(event.eventDate)}</strong><small>{event.startTime || 'Hora pendiente'}</small></span>
              <span><strong>{event.clientName || 'Sin cliente'}</strong><small>{event.eventType || 'Evento'}</small></span>
              <span><strong>{event.roomName || 'Sin salón'}</strong><small>{statusLabel(event.status)}</small></span>
            </button>
          )) : <EmptyBlock title="Aún no hay eventos" detail="Cuando conviertas una reserva o registres un evento aparecerá aquí." />}
        </article>
        <article className="lincoln-card">
          <header><div><small>Configuración base</small><h2>Lincoln listo para operar</h2></div></header>
          <div className="lincoln-health-list">
            <span><i className={state.rooms.length ? 'is-ok' : ''} />Salones configurados <strong>{state.rooms.length}</strong></span>
            <span><i className={state.packages.length ? 'is-ok' : ''} />Paquetes configurados <strong>{state.packages.length}</strong></span>
            <span><i className={state.clients.length ? 'is-ok' : ''} />Clientes registrados <strong>{state.clients.length}</strong></span>
            <span><i className={state.reservations.length ? 'is-ok' : ''} />Reservas registradas <strong>{state.reservations.length}</strong></span>
          </div>
        </article>
      </section>
    </div>
  );
}

function PaymentModal({ eventRecord, state, saving, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10);
  const destinations = Array.isArray(state.settings?.paymentDestinations) ? state.settings.paymentDestinations : ['CAJA CHICA', 'SRA. LIA'];
  const [form, setForm] = useState({
    type: 'installment',
    amountBs: '',
    date: today,
    method: 'cash',
    destination: destinations[0] ?? 'CAJA CHICA',
    payerName: eventRecord?.clientName ?? '',
    description: '',
    reference: '',
  });
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Modal title={`Registrar movimiento · ${eventRecord?.code ?? 'Evento'}`} saving={saving} onClose={onClose} onSubmit={(e) => { e.preventDefault(); onSave({ ...form, amountBs: toNumber(form.amountBs) }); }}>
      <Field label="Tipo"><select value={form.type} onChange={(e) => set('type', e.target.value)}><option value="advance">Anticipo</option><option value="installment">A cuenta</option><option value="balance">Saldo</option><option value="guarantee">Garantía</option><option value="replacement">Reposición</option></select></Field>
      <Field label="Monto (Bs)"><input required type="number" min="0.01" step="0.01" value={form.amountBs} onChange={(e) => set('amountBs', e.target.value)} /></Field>
      <Field label="Fecha"><input required type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
      <Field label="Medio de pago"><select value={form.method} onChange={(e) => set('method', e.target.value)}><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="qr">QR</option></select></Field>
      <Field label="Destino"><input list="lincoln-payment-destinations" value={form.destination} onChange={(e) => set('destination', e.target.value)} /><datalist id="lincoln-payment-destinations">{destinations.map((item) => <option key={item} value={item} />)}</datalist></Field>
      <Field label="Pagado por"><input value={form.payerName} onChange={(e) => set('payerName', e.target.value)} /></Field>
      <Field label="Concepto" wide><input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Opcional; si queda vacío se usa el tipo de movimiento." /></Field>
      <Field label="Referencia / respaldo" wide><input value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="N° transferencia, QR, observación, etc." /></Field>
    </Modal>
  );
}

function ExpenseModal({ record, state, saving, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10);
  const categories = Array.isArray(state.settings?.expenseCategories) ? state.settings.expenseCategories : ['PERSONAL', 'COMIDA', 'BEBIDAS', 'OTROS'];
  const destinations = Array.isArray(state.settings?.paymentDestinations) ? state.settings.paymentDestinations : ['CAJA CHICA', 'SRA. LIA'];
  const [form, setForm] = useState(() => ({
    date: today,
    category: categories[0] ?? 'OTROS',
    method: 'cash',
    destination: destinations[0] ?? 'CAJA CHICA',
    eventId: '',
    description: '',
    supplierName: '',
    reference: '',
    amountBs: '',
    ...(record ?? {}),
  }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Modal title={`${record?.id ? 'Editar' : 'Nuevo'} egreso Lincoln`} saving={saving} onClose={onClose} onSubmit={(e) => { e.preventDefault(); onSave({ ...form, amountBs: toNumber(form.amountBs) }); }}>
      <Field label="Fecha"><input required type="date" value={form.date ?? today} onChange={(e) => set('date', e.target.value)} /></Field>
      <Field label="Categoría"><input required list="lincoln-expense-categories" value={form.category ?? ''} onChange={(e) => set('category', e.target.value)} /><datalist id="lincoln-expense-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist></Field>
      <Field label="Evento"><select value={form.eventId ?? ''} onChange={(e) => set('eventId', e.target.value)}><option value="">Gasto general Lincoln</option>{state.events.map((event) => <option key={event.id} value={event.id}>{event.code} · {event.clientName || event.eventType}</option>)}</select></Field>
      <Field label="Monto (Bs)"><input required type="number" min="0.01" step="0.01" value={form.amountBs ?? ''} onChange={(e) => set('amountBs', e.target.value)} /></Field>
      <Field label="Medio"><select value={form.method ?? 'cash'} onChange={(e) => set('method', e.target.value)}><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="qr">QR</option></select></Field>
      <Field label="Origen / caja"><input list="lincoln-expense-destinations" value={form.destination ?? ''} onChange={(e) => set('destination', e.target.value)} /><datalist id="lincoln-expense-destinations">{destinations.map((item) => <option key={item} value={item} />)}</datalist></Field>
      <Field label="Proveedor / beneficiario"><input value={form.supplierName ?? ''} onChange={(e) => set('supplierName', e.target.value)} /></Field>
      <Field label="Descripción" wide><textarea required value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
      <Field label="Referencia / respaldo" wide><input value={form.reference ?? ''} onChange={(e) => set('reference', e.target.value)} /></Field>
    </Modal>
  );
}

function GuaranteeReturnModal({ eventRecord, summary, state, saving, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10);
  const destinations = Array.isArray(state.settings?.paymentDestinations) ? state.settings.paymentDestinations : ['CAJA CHICA', 'SRA. LIA'];
  const [form, setForm] = useState({ amountBs: summary.guaranteeHeldBs, date: today, method: 'cash', destination: destinations[0] ?? 'CAJA CHICA', description: 'DEVOLUCION DE GARANTIA', reference: '' });
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Modal title={`Devolver garantía · ${eventRecord.code}`} saving={saving} onClose={onClose} onSubmit={(e) => { e.preventDefault(); onSave({ ...form, amountBs: toNumber(form.amountBs) }); }}>
      <Field label="Garantía retenida"><input disabled value={formatBs(summary.guaranteeHeldBs)} /></Field>
      <Field label="Monto a devolver"><input required type="number" min="0.01" max={summary.guaranteeHeldBs} step="0.01" value={form.amountBs} onChange={(e) => set('amountBs', e.target.value)} /></Field>
      <Field label="Fecha"><input required type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
      <Field label="Medio"><select value={form.method} onChange={(e) => set('method', e.target.value)}><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="qr">QR</option></select></Field>
      <Field label="Sale de"><input list="lincoln-return-destinations" value={form.destination} onChange={(e) => set('destination', e.target.value)} /><datalist id="lincoln-return-destinations">{destinations.map((item) => <option key={item} value={item} />)}</datalist></Field>
      <Field label="Referencia"><input value={form.reference} onChange={(e) => set('reference', e.target.value)} /></Field>
      <Field label="Descripción" wide><input value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
    </Modal>
  );
}

const getEventFinancialSummary = (state, eventRecord) => {
  const payments = activeRows(state.payments).filter((row) => row.eventId === eventRecord.id);
  const servicePaidBs = sum(payments.filter((row) => servicePaymentTypes.has(row.type)), (row) => row.amountBs);
  const guaranteeCollectedBs = sum(payments.filter((row) => row.type === 'guarantee'), (row) => row.amountBs);
  const guaranteeReturnedBs = sum(payments.filter((row) => row.type === 'guarantee_return'), (row) => row.amountBs);
  const replacementBs = sum(payments.filter((row) => row.type === 'replacement'), (row) => row.amountBs);
  const eventTotalBs = Number(eventRecord.totalBs ?? eventRecord.estimatedTotalBs ?? 0);
  const guaranteeRequiredBs = Number(eventRecord.guaranteeBs ?? 0);
  return {
    payments,
    eventTotalBs,
    servicePaidBs,
    serviceBalanceBs: Math.max(0, eventTotalBs - servicePaidBs),
    guaranteeRequiredBs,
    guaranteeCollectedBs,
    guaranteePendingBs: Math.max(0, guaranteeRequiredBs - guaranteeCollectedBs),
    guaranteeReturnedBs,
    guaranteeHeldBs: Math.max(0, guaranteeCollectedBs - guaranteeReturnedBs),
    replacementBs,
  };
};

function EventEconomicView({ state, eventRecord, onBack, onNewPayment, onVoidPayment, onReturnGuarantee, onPrintReceipt }) {
  const summary = getEventFinancialSummary(state, eventRecord);
  const history = [...summary.payments].sort((a, b) => `${b.date ?? ''}${b.createdAt ?? ''}`.localeCompare(`${a.date ?? ''}${a.createdAt ?? ''}`));
  return (
    <div className="lincoln-content">
      <article className="lincoln-card">
        <header><div><small>Economía del evento</small><h2>{eventRecord.code} · {eventRecord.clientName || eventRecord.eventType}</h2></div><div className="lincoln-header-actions"><button type="button" className="is-secondary" onClick={onBack}>← Volver</button><button type="button" onClick={onNewPayment}>+ Registrar ingreso</button></div></header>
        <div className="lincoln-event-summary">
          <div><small>Costo servicio</small><strong>{formatBs(summary.eventTotalBs)}</strong></div>
          <div><small>Pagado servicio</small><strong>{formatBs(summary.servicePaidBs)}</strong></div>
          <div className={summary.serviceBalanceBs > 0 ? 'has-warning' : 'has-ok'}><small>Saldo servicio</small><strong>{formatBs(summary.serviceBalanceBs)}</strong></div>
          <div><small>Garantía requerida</small><strong>{formatBs(summary.guaranteeRequiredBs)}</strong></div>
          <div><small>Garantía retenida</small><strong>{formatBs(summary.guaranteeHeldBs)}</strong></div>
          <div><small>Reposiciones</small><strong>{formatBs(summary.replacementBs)}</strong></div>
        </div>
        {summary.guaranteeHeldBs > 0 ? <div className="lincoln-inline-actions"><span>Hay {formatBs(summary.guaranteeHeldBs)} de garantía retenida.</span><button type="button" onClick={onReturnGuarantee}>Devolver garantía</button></div> : null}
        <DataTable rows={history} emptyText="Registra el primer pago, garantía o reposición del evento." columns={[
          { key: 'date', label: 'Fecha', render: (row) => formatDate(row.date) },
          { key: 'code', label: 'Movimiento' },
          { key: 'type', label: 'Concepto', render: (row) => paymentTypeLabel(row.type) },
          { key: 'method', label: 'Medio', render: (row) => paymentMethodLabel(row.method) },
          { key: 'destination', label: 'Destino' },
          { key: 'receipt', label: 'Recibo', render: (row) => row.receiptCode ? <button type="button" className="lincoln-link-action" onClick={(e) => { e.stopPropagation(); onPrintReceipt(row.receiptId); }}>{row.receiptCode}</button> : '—' },
          { key: 'amount', label: 'Monto', render: (row) => <strong>{formatBs(row.amountBs)}</strong> },
          { key: 'action', label: '', render: (row) => row.type !== 'guarantee_return' ? <button type="button" className="lincoln-danger-action" onClick={(e) => { e.stopPropagation(); onVoidPayment(row); }}>Anular</button> : null },
        ]} />
      </article>
    </div>
  );
}

function CajaView({ state, onNewExpense, onEditExpense, onOpenEvent, onPrintReceipt }) {
  const [tab, setTab] = useState('movimientos');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [eventId, setEventId] = useState('all');
  const activeIncome = activeRows(state.incomeEntries);
  const activeExpenses = activeRows(state.expenseEntries);
  const filterRow = (row) => (!month || String(row.date ?? '').startsWith(month)) && (eventId === 'all' || row.eventId === eventId);
  const income = activeIncome.filter(filterRow);
  const expenses = activeExpenses.filter(filterRow);
  const incomeTotal = sum(income, (row) => row.amountBs);
  const expenseTotal = sum(expenses, (row) => row.amountBs);
  const receipts = state.receipts.filter((row) => row.status !== 'voided' && filterRow(row));
  const movements = [
    ...income.map((row) => ({ ...row, movementKind: 'Ingreso' })),
    ...expenses.map((row) => ({ ...row, movementKind: 'Egreso' })),
  ].sort((a, b) => `${b.date ?? ''}${b.createdAt ?? ''}`.localeCompare(`${a.date ?? ''}${a.createdAt ?? ''}`));
  return (
    <div className="lincoln-content">
      <section className="lincoln-kpi-grid">
        <KpiCard icon="wallet" label="Ingresos" value={formatBs(incomeTotal)} detail="Periodo filtrado" />
        <KpiCard icon="chart" label="Egresos" value={formatBs(expenseTotal)} detail="Periodo filtrado" />
        <KpiCard icon="wallet" label="Saldo de caja" value={formatBs(incomeTotal - expenseTotal)} detail="Ingresos menos egresos" />
        <KpiCard icon="bookmark" label="Recibos activos" value={String(receipts.length)} detail="Periodo filtrado" />
      </section>
      <article className="lincoln-card">
        <header><div><small>Economía independiente</small><h2>Caja Lincoln</h2></div><button type="button" onClick={onNewExpense}>+ Nuevo egreso</button></header>
        <div className="lincoln-cash-toolbar"><div className="lincoln-tabs"><button type="button" className={tab === 'movimientos' ? 'is-active' : ''} onClick={() => setTab('movimientos')}>Movimientos</button><button type="button" className={tab === 'egresos' ? 'is-active' : ''} onClick={() => setTab('egresos')}>Egresos</button><button type="button" className={tab === 'recibos' ? 'is-active' : ''} onClick={() => setTab('recibos')}>Recibos</button></div><div className="lincoln-filters"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /><select value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="all">Todos los eventos</option>{state.events.map((event) => <option key={event.id} value={event.id}>{event.code} · {event.clientName || event.eventType}</option>)}</select></div></div>
        {tab === 'movimientos' ? <DataTable rows={movements} emptyText="Los pagos de eventos y los egresos aparecerán aquí." columns={[
          { key: 'date', label: 'Fecha', render: (row) => formatDate(row.date) },
          { key: 'kind', label: 'Tipo', render: (row) => <span className={`lincoln-movement-pill is-${row.movementKind === 'Ingreso' ? 'income' : 'expense'}`}>{row.movementKind}</span> },
          { key: 'event', label: 'Evento', render: (row) => row.eventCode ? <button type="button" className="lincoln-link-action" onClick={() => onOpenEvent(row.eventId)}>{row.eventCode}</button> : 'GENERAL' },
          { key: 'category', label: 'Categoría' },
          { key: 'description', label: 'Detalle' },
          { key: 'destination', label: 'Destino / caja' },
          { key: 'amount', label: 'Monto', render: (row) => <strong>{formatBs(row.amountBs)}</strong> },
        ]} /> : null}
        {tab === 'egresos' ? <DataTable rows={expenses} onSelect={(row) => !row.paymentId && onEditExpense(row)} emptyText="Registra el primer egreso de Lincoln." columns={[
          { key: 'code', label: 'Egreso' }, { key: 'date', label: 'Fecha', render: (row) => formatDate(row.date) }, { key: 'event', label: 'Evento', render: (row) => row.eventCode || 'GENERAL' }, { key: 'category', label: 'Categoría' }, { key: 'description', label: 'Descripción' }, { key: 'supplierName', label: 'Proveedor / beneficiario' }, { key: 'amount', label: 'Monto', render: (row) => <strong>{formatBs(row.amountBs)}</strong> },
        ]} /> : null}
        {tab === 'recibos' ? <DataTable rows={receipts} emptyText="Cada ingreso de un evento generará automáticamente su recibo Lincoln." columns={[
          { key: 'code', label: 'Recibo', render: (row) => <button type="button" className="lincoln-link-action" onClick={() => onPrintReceipt(row.id)}>{row.code}</button> }, { key: 'date', label: 'Fecha', render: (row) => formatDate(row.date) }, { key: 'eventCode', label: 'Evento' }, { key: 'clientName', label: 'Cliente' }, { key: 'concept', label: 'Concepto' }, { key: 'method', label: 'Medio', render: (row) => paymentMethodLabel(row.method) }, { key: 'destination', label: 'Destino' }, { key: 'amount', label: 'Monto', render: (row) => <strong>{formatBs(row.amountBs)}</strong> },
        ]} /> : null}
      </article>
    </div>
  );
}

function SimpleCollectionView({ title, eyebrow, rows, columns, onNew, onEdit, emptyText }) {
  return (
    <div className="lincoln-content">
      <article className="lincoln-card">
        <header><div><small>{eyebrow}</small><h2>{title}</h2></div><button type="button" onClick={onNew}>+ Nuevo</button></header>
        <DataTable rows={rows} columns={columns} onSelect={onEdit} emptyText={emptyText} />
      </article>
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
  const [modal, setModal] = useState(null);
  const [economicEventId, setEconomicEventId] = useState('');
  const [saving, setSaving] = useState(false);
  const userName = currentUser?.fullName ?? currentUser?.name ?? 'Usuario Lincoln';
  const userInitials = userName.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'US';
  const snapshot = databaseStatus.snapshot;
  const state = { ...emptyState, ...(snapshot?.state ?? {}) };
  const economicEvent = state.events.find((row) => row.id === economicEventId) ?? null;

  const loadLincoln = useCallback(async () => {
    setDatabaseStatus((current) => ({ ...current, loading: true, error: '' }));
    try {
      const next = await api.lincoln.getState();
      setDatabaseStatus({ loading: false, error: '', snapshot: next });
      return next;
    } catch (error) {
      setDatabaseStatus((current) => ({ ...current, loading: false, error: error.message || 'No se pudo abrir la base Lincoln.' }));
      return null;
    }
  }, []);

  useEffect(() => {
    void loadLincoln();
  }, [loadLincoln]);

  const openView = (viewId) => {
    if (!lincolnEnabledViews.has(viewId)) return;
    setActiveView(viewId);
    if (viewId !== 'comercial') setEconomicEventId('');
    setIsMobileMenuOpen(false);
    if (viewId === 'asistencia') onOpenAttendance?.();
  };

  const actor = { id: currentUser?.id ?? null, name: userName };

  const saveRecord = async (collection, form) => {
    if (!snapshot?.revision) return;
    setSaving(true);
    try {
      const payload = {
        collection,
        id: form.id ?? '',
        record: form,
        revision: snapshot.revision,
        actor,
      };
      if (form.id) await api.lincoln.updateRecord(payload);
      else await api.lincoln.createRecord(payload);
      setModal(null);
      await loadLincoln();
    } catch (error) {
      if (error?.status === 409 || error?.payload?.code === 'LINCOLN_REVISION_CONFLICT') {
        await loadLincoln();
        window.alert('Lincoln fue actualizado por otro usuario. La información se recargó; revisa el registro y vuelve a guardar.');
      } else {
        window.alert(error.message || 'No se pudo guardar el registro de Lincoln.');
      }
    } finally {
      setSaving(false);
    }
  };

  const convertReservation = async (reservation) => {
    if (!snapshot?.revision) return;
    const accepted = window.confirm(`¿Convertir la reserva ${reservation.code} de ${reservation.clientName || 'este cliente'} en contrato?`);
    if (!accepted) return;
    setSaving(true);
    try {
      await api.lincoln.convertReservation({
        reservationId: reservation.id,
        event: { guaranteeBs: 0 },
        revision: snapshot.revision,
        actor,
      });
      await loadLincoln();
      setActiveView('comercial');
    } catch (error) {
      if (error?.status === 409 || error?.payload?.code === 'LINCOLN_REVISION_CONFLICT') await loadLincoln();
      window.alert(error.message || 'No se pudo convertir la reserva en contrato.');
    } finally {
      setSaving(false);
    }
  };


  const handleLincolnMutationError = async (error, fallback) => {
    if (error?.status === 409 || error?.payload?.code === 'LINCOLN_REVISION_CONFLICT') {
      await loadLincoln();
      window.alert('Lincoln fue actualizado por otro usuario. La información se recargó; revisa los datos y vuelve a intentar.');
      return;
    }
    window.alert(error.message || fallback);
  };

  const savePayment = async (eventRecord, payment) => {
    if (!snapshot?.revision) return;
    setSaving(true);
    try {
      await api.lincoln.createEventPayment({ eventId: eventRecord.id, payment, revision: snapshot.revision, actor });
      setModal(null);
      await loadLincoln();
      setEconomicEventId(eventRecord.id);
      setActiveView('comercial');
    } catch (error) {
      await handleLincolnMutationError(error, 'No se pudo registrar el movimiento del evento.');
    } finally {
      setSaving(false);
    }
  };

  const voidPayment = async (payment) => {
    if (!snapshot?.revision || !payment?.id) return;
    const reason = window.prompt(`Motivo de anulación para ${payment.code}:`, 'CORRECCION ADMINISTRATIVA');
    if (reason === null) return;
    setSaving(true);
    try {
      await api.lincoln.voidEventPayment({ paymentId: payment.id, reason, revision: snapshot.revision, actor });
      await loadLincoln();
    } catch (error) {
      await handleLincolnMutationError(error, 'No se pudo anular el pago.');
    } finally {
      setSaving(false);
    }
  };

  const returnGuarantee = async (eventRecord, refund) => {
    if (!snapshot?.revision) return;
    setSaving(true);
    try {
      await api.lincoln.returnGuarantee({ eventId: eventRecord.id, refund, revision: snapshot.revision, actor });
      setModal(null);
      await loadLincoln();
      setEconomicEventId(eventRecord.id);
    } catch (error) {
      await handleLincolnMutationError(error, 'No se pudo devolver la garantía.');
    } finally {
      setSaving(false);
    }
  };

  const saveExpense = async (expense) => {
    if (!snapshot?.revision) return;
    setSaving(true);
    try {
      const payload = { expense, revision: snapshot.revision, actor };
      if (expense.id) await api.lincoln.updateExpense({ ...payload, id: expense.id });
      else await api.lincoln.createExpense(payload);
      setModal(null);
      await loadLincoln();
      setActiveView('caja');
    } catch (error) {
      await handleLincolnMutationError(error, 'No se pudo guardar el egreso.');
    } finally {
      setSaving(false);
    }
  };

  const printReceipt = (receiptId) => {
    const receipt = state.receipts.find((row) => row.id === receiptId);
    if (!receipt) {
      window.alert('Recibo Lincoln no encontrado.');
      return;
    }
    const popup = window.open('', '_blank', 'width=820,height=760');
    if (!popup) {
      window.alert('Habilita ventanas emergentes para imprimir el recibo.');
      return;
    }
    const safe = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    try { popup.opener = null; } catch (error) { void error; }
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safe(receipt.code)}</title><style>@page{size:Letter portrait;margin:16mm}body{font-family:Arial,sans-serif;color:#173a29}.sheet{border:1px solid #dfe7e2;border-radius:14px;padding:22px}.head{display:flex;justify-content:space-between;border-bottom:3px solid #276342;padding-bottom:14px}.head h1{font-size:22px;margin:0}.code{font-size:22px;font-weight:800;color:#276342}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.grid div{padding:10px;border:1px solid #e2e8e4;border-radius:8px}.grid small{display:block;color:#738078;text-transform:uppercase;font-weight:700}.amount{margin-top:20px;padding:16px;border-radius:10px;background:#edf5ef;text-align:right}.amount strong{font-size:28px}.sign{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:60px;text-align:center}.line{border-top:1px solid #333;padding-top:7px}button{margin-top:20px;padding:10px 14px}@media print{button{display:none}}</style></head><body><section class="sheet"><div class="head"><div><small>Centro de Eventos Lincoln</small><h1>RECIBO DE INGRESO</h1></div><div class="code">${safe(receipt.code)}</div></div><div class="grid"><div><small>Evento</small><strong>${safe(receipt.eventCode)}</strong></div><div><small>Fecha</small><strong>${safe(formatDate(receipt.date))}</strong></div><div><small>Cliente</small><strong>${safe(receipt.clientName)}</strong></div><div><small>Concepto</small><strong>${safe(receipt.concept)}</strong></div><div><small>Medio</small><strong>${safe(paymentMethodLabel(receipt.method))}</strong></div><div><small>Destino</small><strong>${safe(receipt.destination)}</strong></div><div><small>Pagado por</small><strong>${safe(receipt.payerName)}</strong></div><div><small>Recibido por</small><strong>${safe(receipt.createdByName)}</strong></div></div><div class="amount"><small>TOTAL RECIBIDO</small><br><strong>${safe(formatBs(receipt.amountBs))}</strong></div><div class="sign"><div class="line">Entregué</div><div class="line">Recibí</div></div><button onclick="window.print()">Imprimir</button></section></body></html>`);
    popup.document.close();
    popup.focus();
  };

  const titleByView = {
    panel: 'Panel / Centro de Eventos Lincoln',
    agenda: 'Agenda / Centro de Eventos Lincoln',
    comercial: 'Reservas y Contratos / Centro de Eventos Lincoln',
    reuniones: 'Reuniones / Centro de Eventos Lincoln',
    clientes: 'Clientes / Centro de Eventos Lincoln',
    salones: 'Salones / Centro de Eventos Lincoln',
    paquetes: 'Paquetes / Centro de Eventos Lincoln',
    caja: 'Caja Lincoln / Centro de Eventos Lincoln',
    rendiciones: 'Rendiciones / Centro de Eventos Lincoln',
    reportes: 'Reportes / Centro de Eventos Lincoln',
    asistencia: 'Asistencia compartida',
  };
  const activeItem = lincolnSidebarItems.find((item) => item.id === activeView) ?? lincolnSidebarItems[0];

  const overlay = (
    <>
      {modal?.mode === 'payment' ? <PaymentModal eventRecord={modal.record} state={state} saving={saving} onClose={() => setModal(null)} onSave={(form) => savePayment(modal.record, form)} /> : null}
      {modal?.mode === 'expense' ? <ExpenseModal record={modal.record} state={state} saving={saving} onClose={() => setModal(null)} onSave={saveExpense} /> : null}
      {modal?.mode === 'guaranteeReturn' ? <GuaranteeReturnModal eventRecord={modal.record} summary={getEventFinancialSummary(state, modal.record)} state={state} saving={saving} onClose={() => setModal(null)} onSave={(form) => returnGuarantee(modal.record, form)} /> : null}
      {modal && !['payment', 'expense', 'guaranteeReturn'].includes(modal.mode) ? <RecordModal mode={modal.mode} record={modal.record} state={state} saving={saving} onClose={() => setModal(null)} onSave={(form) => saveRecord(modal.mode, form)} /> : null}
    </>
  );

  return (
    <LincolnWorkspaceLayout
      activeView={activeView}
      activeItem={activeItem}
      title={titleByView[activeView] ?? 'Lincoln'}
      databaseStatus={databaseStatus}
      snapshot={snapshot}
      currentUser={currentUser}
      userName={userName}
      userInitials={userInitials}
      availableCompanies={availableCompanies}
      isMobileMenuOpen={isMobileMenuOpen}
      onOpenView={openView}
      onSwitchWorkspace={onSwitchWorkspace}
      onReload={() => void loadLincoln()}
      onLogout={onLogout}
      onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
      onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
      overlay={overlay}
    >
      {databaseStatus.error ? <div className="lincoln-db-error">{databaseStatus.error}</div> : null}
      {databaseStatus.loading && !snapshot ? <div className="lincoln-loading">Cargando la base independiente de Lincoln...</div> : null}
      {!databaseStatus.loading || snapshot ? (
        <>
          {activeView === 'panel' ? <LinconPanelView state={state} onNavigate={openView} /> : null}
          {activeView === 'agenda' ? <LincolnAgenda state={state} /> : null}
          {activeView === 'comercial' && economicEvent ? <EventEconomicView state={state} eventRecord={economicEvent} onBack={() => setEconomicEventId('')} onNewPayment={() => setModal({ mode: 'payment', record: economicEvent })} onVoidPayment={voidPayment} onReturnGuarantee={() => setModal({ mode: 'guaranteeReturn', record: economicEvent })} onPrintReceipt={printReceipt} /> : null}
          {activeView === 'comercial' && !economicEvent ? (
            <LincolnCommercialWorkspace
              refreshKey={snapshot?.revision}
              onNewReservation={() => setModal({ mode: 'reservations', record: null })}
              onNewContract={() => setModal({ mode: 'events', record: null })}
              onEditReservation={(row) => {
                const record = state.reservations.find((item) => item.id === row.id);
                if (record) setModal({ mode: 'reservations', record });
              }}
              onEditContract={(row) => {
                const record = state.events.find((item) => item.id === row.id);
                if (record) setModal({ mode: 'events', record });
              }}
              onConvertReservation={(row) => {
                const record = state.reservations.find((item) => item.id === row.id);
                if (record) void convertReservation(record);
              }}
              onOpenEconomic={(row) => setEconomicEventId(row.eventId || row.id)}
            />
          ) : null}
          {activeView === 'reuniones' ? <LincolnMeetings state={state} revision={snapshot?.revision} actor={actor} onRefresh={loadLincoln} /> : null}
          {activeView === 'caja' ? <CajaView state={state} onNewExpense={() => setModal({ mode: 'expense', record: null })} onEditExpense={(record) => setModal({ mode: 'expense', record })} onOpenEvent={(eventId) => { setEconomicEventId(eventId); setActiveView('comercial'); }} onPrintReceipt={printReceipt} /> : null}
          {activeView === 'rendiciones' ? <LincolnSettlements refreshKey={snapshot?.revision} revision={snapshot?.revision} actor={actor} onNewExpense={(eventId) => setModal({ mode: 'expense', record: { eventId } })} /> : null}
          {activeView === 'reportes' ? <LincolnReports events={state.events} refreshKey={snapshot?.revision} /> : null}
          {activeView === 'clientes' ? (
            <LincolnClients
              refreshKey={snapshot?.revision}
              onNew={() => setModal({ mode: 'clients', record: null })}
              onEdit={(row) => {
                const record = state.clients.find((item) => item.id === row.id);
                if (record) setModal({ mode: 'clients', record });
              }}
            />
          ) : null}
          {activeView === 'salones' ? (
            <LincolnRooms
              revision={snapshot?.revision}
              actor={actor}
              refreshKey={snapshot?.revision}
              onRefresh={loadLincoln}
            />
          ) : null}
          {activeView === 'paquetes' ? (
            <LincolnPackages
              revision={snapshot?.revision}
              actor={actor}
              refreshKey={snapshot?.revision}
              onRefresh={loadLincoln}
            />
          ) : null}
          {activeView === 'asistencia' ? <AttendanceSection {...attendanceProps} /> : null}
        </>
      ) : null}
    </LincolnWorkspaceLayout>
  );
}

export default LinconWorkspaceSection;
