import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import AttendanceSection from './AttendanceSection';
import SystemResetPanel from '../common/SystemResetPanel';
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
import '../lincoln/styles/lincoln-contract-document.css';
import { lincolnEnabledViews, lincolnSidebarItems } from '../lincoln/config/navigation';
import LincolnWorkspaceLayout from '../lincoln/layout/LincolnWorkspaceLayout';
import LinconIcon from '../lincoln/shared/LinconIcon';

const emptyState = {
  reservations: [],
  leads: [],
  events: [],
  rooms: [],
  packages: [],
  packageServices: [],
  packageExtras: [],
  clients: [],
  meetings: [],
  suppliers: [],
  inventory: [],
  payments: [],
  receipts: [],
  incomeEntries: [],
  expenseEntries: [],
  eventSettlements: [],
  economicLedgerEntries: [],
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
  deposit: 'Ingreso flexible',
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
  const selectedPackage = packages.find((pkg) => pkg.id === form.packageId) ?? null;
  const packageVariants = selectedPackage
    ? (Array.isArray(selectedPackage.variants) && selectedPackage.variants.length
      ? selectedPackage.variants.filter((variant) => variant?.status !== 'inactive')
      : [{ id: 'base', name: selectedPackage.name || 'BASE', pricePerPersonBs: Number(selectedPackage.pricePerPersonBs ?? 0), minimumGuests: Number(selectedPackage.minimumGuests ?? 0) }])
    : [];
  const selectedPackageVariant = packageVariants.find((variant) => variant.id === form.packageVariantId) ?? packageVariants[0] ?? null;
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
      packageId: selectedPackage?.id ?? null,
      packageName: selectedPackage?.name ?? '',
      packageVariantId: selectedPackageVariant?.id ?? null,
      packageVariantName: selectedPackageVariant?.name ?? '',
      packageSnapshot: selectedPackage ? {
        templateId: selectedPackage.id,
        templateCode: selectedPackage.code ?? '',
        templateName: selectedPackage.name ?? '',
        roomId: selectedPackage.roomId ?? null,
        roomName: selectedPackage.roomName ?? '',
        eventTypes: Array.isArray(selectedPackage.eventTypes) ? selectedPackage.eventTypes : [],
        selectedVariant: selectedPackageVariant ? { ...selectedPackageVariant } : null,
        variants: Array.isArray(selectedPackage.variants) ? selectedPackage.variants.map((variant) => ({ ...variant })) : [],
        serviceLines: Array.isArray(selectedPackage.serviceLines) ? selectedPackage.serviceLines.map((line) => ({ ...line, variantIds: Array.isArray(line.variantIds) ? [...line.variantIds] : [] })) : [],
        capturedAt: new Date().toISOString(),
      } : null,
      status: ['cancelled', 'converted'].includes(String(form.status ?? '').toLowerCase())
        ? form.status
        : reservationPaymentBs > 0 ? 'confirmed' : 'lead',
    });
  };

  return (
    <Modal className="lincoln-reservation-modal" title={`${isEdit ? 'Editar' : 'Nueva'} reserva${reservationPaymentBs > 0 ? ' · CONFIRMADA' : ' · INTERESADO'}`} saving={saving} onClose={onClose} onSubmit={submit}>
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
          <Field label="Plantilla de paquete"><select value={form.packageId ?? ''} onChange={(e) => { const pkg = packages.find((item) => item.id === e.target.value); const variants = Array.isArray(pkg?.variants) && pkg.variants.length ? pkg.variants.filter((variant) => variant?.status !== 'inactive') : pkg ? [{ id: 'base', name: pkg.name || 'BASE', pricePerPersonBs: Number(pkg.pricePerPersonBs ?? 0), minimumGuests: Number(pkg.minimumGuests ?? 0) }] : []; const variant = variants[0] ?? null; setForm((current) => ({ ...current, packageId: pkg?.id ?? '', packageName: pkg?.name ?? '', packageVariantId: variant?.id ?? '', packageVariantName: variant?.name ?? '', packagePricePerPersonBs: Number(variant?.pricePerPersonBs ?? 0), estimatedTotalBs: Number(current.estimatedTotalBs || 0) || (Number(current.guestCount || 0) * Number(variant?.pricePerPersonBs || 0)) })); }}><option value="">Sin definir</option>{packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}</option>)}</select></Field>
          <Field label="Variante / nivel"><select disabled={!selectedPackage} value={form.packageVariantId ?? selectedPackageVariant?.id ?? ''} onChange={(e) => { const variant = packageVariants.find((item) => item.id === e.target.value); setForm((current) => ({ ...current, packageVariantId: variant?.id ?? '', packageVariantName: variant?.name ?? '', packagePricePerPersonBs: Number(variant?.pricePerPersonBs ?? 0), estimatedTotalBs: Number(current.guestCount || 0) * Number(variant?.pricePerPersonBs || 0) })); }}><option value="">Sin variante</option>{packageVariants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} · {formatBs(variant.pricePerPersonBs)} / persona</option>)}</select></Field>
          <Field label="Cantidad de invitados"><input type="number" min="0" value={form.guestCount ?? ''} onChange={(e) => set('guestCount', toNumber(e.target.value))} /></Field>
          <Field label="Total estimado (Bs)"><input type="number" min="0" step="0.01" value={form.estimatedTotalBs ?? ''} onChange={(e) => set('estimatedTotalBs', e.target.value)} /></Field>
        </div>
      </section>

      <section className="lincoln-reservation-section is-money">
        <header><div><small>03 · Estado de la reserva</small><h3>De interesado a reserva confirmada</h3></div><span className={reservationPaymentBs > 0 ? 'is-confirmed' : 'is-interested'}>{reservationPaymentBs > 0 ? 'RESERVA CONFIRMADA · bloquea fecha' : 'RESERVA · INTERESADO · no bloquea fecha'}</span></header>
        <div className="lincoln-reservation-money-grid">
          <Field label="Dinero para concretar la reserva (Bs)"><input type="number" min="0" step="0.01" value={form.reservationPaymentBs ?? ''} onChange={(e) => set('reservationPaymentBs', e.target.value)} /><em>Mientras sea Bs 0, la reserva queda como INTERESADO. Al registrar un monto, queda CONFIRMADA y bloquea el salón.</em></Field>
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


const contractMoney = (value) => new Intl.NumberFormat('es-BO', {
  style: 'currency', currency: 'BOB', minimumFractionDigits: 2,
}).format(Number(value ?? 0));

const contractDateLong = (value) => {
  if (!value) return 'FECHA PENDIENTE';
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value).toUpperCase();
  return parsed.toLocaleDateString('es-BO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase();
};

const contractDefaultClauses = (draft) => [
  `Centro de Eventos LINCOLN prestará el servicio de atención para el evento ${String(draft.eventType || 'EVENTO').toUpperCase()}, a realizarse el ${contractDateLong(draft.eventDate)} en ${draft.roomName || 'el salón acordado'}.`,
  'Los servicios incluidos se encuentran detallados en la hoja de costos y servicios, que forma parte integrante e indivisible del presente contrato.',
  `El costo se establece para ${Number(draft.guestCount || 0)} invitados según la composición del paquete seleccionada. Los importes pactados quedan congelados para este contrato, salvo cambios solicitados por escrito.`,
  `Los Contratantes reconocen como anticipo y pagos a cuenta la suma de ${contractMoney(draft.advanceBs)}. El saldo será cancelado ${Number(draft.balanceDueDays || 7)} días antes del evento, salvo acuerdo escrito diferente.`,
  'En caso de suspensión por decisión de los Contratantes, se aplicarán las condiciones de devolución o penalidad expresamente acordadas. Toda modificación o reprogramación deberá constar por escrito.',
  `Los Contratantes se obligan a resarcir los daños ocasionados por ellos o sus invitados en instalaciones, mobiliario, mantelería, vajilla, cristalería y demás bienes. La garantía separada es de ${contractMoney(draft.guaranteeBs)} y será devuelta cuando corresponda, previa verificación de obligaciones pendientes.`,
  'El incumplimiento comprobado de cualquiera de las partes dará lugar al resarcimiento de los daños y perjuicios que correspondan conforme a ley.',
  'Cuando por fuerza mayor o motivos coyunturales el evento no pueda realizarse en la fecha acordada, las partes podrán reprogramarlo de acuerdo con la disponibilidad de Centro de Eventos Lincoln.',
  `En conformidad con todas las cláusulas del presente contrato, las partes firman en fecha ${contractDateLong(draft.contractDate)} en señal de aceptación.`,
];

const buildContractDraft = (reservation) => {
  const snapshot = reservation?.packageSnapshot && typeof reservation.packageSnapshot === 'object' ? reservation.packageSnapshot : {};
  const variant = snapshot.selectedVariant ?? null;
  const variantId = reservation?.packageVariantId ?? variant?.id ?? '';
  const rawLines = Array.isArray(snapshot.serviceLines) ? snapshot.serviceLines : [];
  const includedServices = rawLines
    .filter((line) => line?.included !== false && line?.catalogKind !== 'extra')
    .map((line, index) => ({ ...line, id: line.id || `service-${index}`, selected: true }));
  const extras = rawLines
    .filter((line) => line?.catalogKind === 'extra' || line?.included === false)
    .map((line, index) => ({ ...line, id: line.id || `extra-${index}`, selected: false, quantity: Number(line.quantity || 1), unitCostBs: Number(line.unitCostBs || 0) }));
  const pricePerPersonBs = Number(reservation?.packagePricePerPersonBs ?? variant?.pricePerPersonBs ?? 0);
  const guestCount = Number(reservation?.guestCount ?? 0);
  const packageVariants = Array.isArray(snapshot.variants) && snapshot.variants.length
    ? snapshot.variants
    : variant ? [variant] : [];
  const pricingGroups = packageVariants.map((item, index) => ({
    id: item.id || `variant-${index}`,
    variantId: item.id || `variant-${index}`,
    name: item.name || `Grupo ${index + 1}`,
    selected: String(item.id ?? '') === String(variantId ?? '') || (!variantId && index === 0),
    guestCount: String(item.id ?? '') === String(variantId ?? '') || (!variantId && index === 0) ? guestCount : 0,
    pricePerPersonBs: Number(item.pricePerPersonBs ?? 0),
  }));
  const advanceBs = Number(reservation?.reservationPaymentBs ?? 0) + Number(reservation?.accountPaymentBs ?? 0);
  const base = {
    sourceReservationId: reservation?.id ?? '', sourceReservationCode: reservation?.code ?? '',
    contractor1Name: reservation?.contractor1Name ?? reservation?.clientName ?? '', contractor1Ci: reservation?.contractor1Ci ?? reservation?.clientCi ?? '', contractor1Phone: reservation?.contractor1Phone ?? reservation?.clientPhone ?? '',
    contractor2Name: reservation?.contractor2Name ?? reservation?.secondContractorName ?? '', contractor2Ci: reservation?.contractor2Ci ?? reservation?.secondContractorCi ?? '', contractor2Phone: reservation?.contractor2Phone ?? reservation?.secondContractorPhone ?? '',
    eventType: reservation?.eventType ?? '', eventDate: reservation?.eventDate ?? '', startTime: reservation?.startTime ?? '', durationHours: Number(reservation?.durationHours ?? 8), roomName: reservation?.roomName ?? '', roomId: reservation?.roomId ?? '',
    guestCount, packageId: reservation?.packageId ?? snapshot.templateId ?? '', packageName: reservation?.packageName ?? snapshot.templateName ?? '', packageVariantName: reservation?.packageVariantName ?? variant?.name ?? '', packageVariantId: variantId, packageVariants, pricingGroups, packageSnapshot: Object.keys(snapshot).length ? snapshot : null,
    pricePerPersonBs, services: includedServices, extras, discountPercent: 0, advanceBs, guaranteeBs: Number(reservation?.guaranteeBs ?? 0), balanceDueDays: 7,
    contractDate: lincolnTodayKey(), notes: reservation?.notes ?? '',
  };
  return { ...base, clauses: contractDefaultClauses(base), clausesCustomized: false };
};

const contractPackagePatch = (pkg, guestCount = 0, preferredVariantId = '') => {
  if (!pkg) return {
    packageId: '', packageName: '', packageVariantId: '', packageVariantName: '',
    packageVariants: [], pricingGroups: [], services: [], extras: [], pricePerPersonBs: 0,
    packageSnapshot: null,
  };
  const variants = (Array.isArray(pkg.variants) && pkg.variants.length
    ? pkg.variants.filter((variant) => variant?.status !== 'inactive')
    : [{ id: 'base', name: pkg.name || 'BASE', pricePerPersonBs: Number(pkg.pricePerPersonBs ?? 0), minimumGuests: Number(pkg.minimumGuests ?? 0) }]);
  const matchedIndex = variants.findIndex((variant) => String(variant.id) === String(preferredVariantId));
  const selectedIndex = matchedIndex >= 0 ? matchedIndex : 0;
  const selectedVariant = variants[selectedIndex] ?? null;
  const lines = Array.isArray(pkg.serviceLines) ? pkg.serviceLines : [];
  return {
    packageId: pkg.id,
    packageName: pkg.name || '',
    packageVariantId: selectedVariant?.id || '',
    packageVariantName: selectedVariant?.name || '',
    packageVariants: variants.map((variant) => ({ ...variant })),
    pricingGroups: variants.map((variant, index) => ({
      id: variant.id || `variant-${index}`,
      variantId: variant.id || `variant-${index}`,
      name: variant.name || `Grupo ${index + 1}`,
      selected: index === selectedIndex,
      guestCount: index === selectedIndex ? Number(guestCount || 0) : 0,
      pricePerPersonBs: Number(variant.pricePerPersonBs ?? 0),
    })),
    pricePerPersonBs: Number(selectedVariant?.pricePerPersonBs ?? 0),
    services: lines.filter((line) => line?.included !== false && line?.catalogKind !== 'extra').map((line, index) => ({ ...line, id: line.id || `service-${index}`, selected: true, variantIds: Array.isArray(line.variantIds) ? [...line.variantIds] : [] })),
    extras: lines.filter((line) => line?.catalogKind === 'extra' || line?.included === false).map((line, index) => ({ ...line, id: line.id || `extra-${index}`, selected: false, quantity: Number(line.quantity || 1), unitCostBs: Number(line.unitCostBs || 0) })),
    packageSnapshot: {
      templateId: pkg.id, templateCode: pkg.code || '', templateName: pkg.name || '', roomId: pkg.roomId || null,
      roomName: pkg.roomName || '', eventTypes: Array.isArray(pkg.eventTypes) ? [...pkg.eventTypes] : [],
      selectedVariant: selectedVariant ? { ...selectedVariant } : null,
      variants: variants.map((variant) => ({ ...variant })),
      serviceLines: lines.map((line) => ({ ...line, variantIds: Array.isArray(line.variantIds) ? [...line.variantIds] : [] })),
      capturedAt: new Date().toISOString(),
    },
  };
};

const contractTotals = (draft) => {
  const activeGroups = Array.isArray(draft.pricingGroups)
    ? draft.pricingGroups.filter((group) => group.selected !== false && Number(group.guestCount || 0) > 0)
    : [];
  const pricedGuests = activeGroups.reduce((total, group) => total + Number(group.guestCount || 0), 0);
  const baseBs = activeGroups.length
    ? activeGroups.reduce((total, group) => total + Number(group.guestCount || 0) * Number(group.pricePerPersonBs || 0), 0)
    : Number(draft.guestCount || 0) * Number(draft.pricePerPersonBs || 0);
  const effectiveGuests = pricedGuests || Number(draft.guestCount || 0);
  const extrasBs = (draft.extras ?? []).filter((line) => line.selected).reduce((total, line) => {
    const qty = Number(line.quantity || 1);
    const unit = Number(line.unitCostBs || 0);
    const assignedVariantIds = Array.isArray(line.variantIds) ? line.variantIds.map(String) : [];
    const applicableGuests = assignedVariantIds.length
      ? activeGroups.filter((group) => assignedVariantIds.includes(String(group.variantId))).reduce((sum, group) => sum + Number(group.guestCount || 0), 0)
      : effectiveGuests;
    return total + (line.costMode === 'per_person' ? unit * applicableGuests * qty : unit * qty);
  }, 0);
  const grossBs = baseBs + extrasBs;
  const discountBs = grossBs * Math.max(0, Number(draft.discountPercent || 0)) / 100;
  const totalBs = Math.max(0, grossBs - discountBs);
  const balanceBs = Math.max(0, totalBs - Number(draft.advanceBs || 0));
  return { baseBs, extrasBs, grossBs, discountBs, totalBs, balanceBs, guestCount: effectiveGuests };
};

function ContractDocumentSheet({ document, compact = false }) {
  const totals = document?.totals ?? contractTotals(document ?? {});
  const services = Array.isArray(document?.services) ? document.services.filter((line) => line.selected !== false) : [];
  const extras = Array.isArray(document?.extras) ? document.extras.filter((line) => line.selected) : [];
  const grouped = services.reduce((acc, line) => { const key = line.category || 'OTROS'; (acc[key] ||= []).push(line); return acc; }, {});
  const pricingGroups = Array.isArray(document?.pricingGroups) ? document.pricingGroups.filter((group) => group.selected !== false && Number(group.guestCount || 0) > 0) : [];
  const serviceAppliesToGroup = (line, group) => !Array.isArray(line.variantIds) || !line.variantIds.length || line.variantIds.some((id) => String(id) === String(group.variantId));
  const extraScope = (line) => {
    const names = pricingGroups.filter((group) => serviceAppliesToGroup(line, group)).map((group) => group.name);
    return names.length === pricingGroups.length ? 'Todo el evento' : names.join(' + ');
  };
  return <div className={`lincoln-contract-paper-stack ${compact ? 'is-compact' : ''}`}>
    <article className="lincoln-contract-paper">
      <header className="lincoln-contract-doc-head"><div><small>CENTRO DE EVENTOS</small><h1>LINCOLN</h1><p>Pachamama #2250 y Waldo Ballivian · Cochabamba</p></div><div><strong>{document?.contractCode || 'CONTRATO'}</strong><span>{formatDate(document?.contractDate)}</span></div></header>
      <h2>CONTRATO DE SERVICIOS</h2>
      <section className="lincoln-contract-doc-facts">
        <div><span>Contratante 1</span><strong>{document?.contractor1Name || '—'}</strong><small>C.I. {document?.contractor1Ci || '—'} · {document?.contractor1Phone || '—'}</small></div>
        <div><span>Contratante 2</span><strong>{document?.contractor2Name || '—'}</strong><small>C.I. {document?.contractor2Ci || '—'} · {document?.contractor2Phone || '—'}</small></div>
        <div><span>Evento</span><strong>{document?.eventType || '—'}</strong><small>{contractDateLong(document?.eventDate)} · {document?.startTime || 'hora pendiente'}</small></div>
        <div><span>Salón</span><strong>{document?.roomName || '—'}</strong><small>{document?.durationHours || 0} h · {document?.guestCount || 0} invitados</small></div>
      </section>
      <p className="lincoln-contract-intro">Conste por el presente documento privado de prestación de servicios, suscrito entre Centro de Eventos LINCOLN y los Contratantes individualizados precedentemente, bajo las siguientes cláusulas:</p>
      <ol className="lincoln-contract-clauses">{(document?.clauses ?? []).map((clause, index) => <li key={index}><b>{['PRIMERA','SEGUNDA','TERCERA','CUARTA','QUINTA','SEXTA','SÉPTIMA','OCTAVA','NOVENA'][index] || `CLÁUSULA ${index + 1}`}.-</b> {clause}</li>)}</ol>
      <section className="lincoln-contract-signatures"><div><span>BASILIA HERBAS SAHONERO</span><small>Centro de Eventos Lincoln</small></div><div><span>{document?.contractor1Name || 'CONTRATANTE 1'}</span><small>Contratante</small></div><div><span>{document?.contractor2Name || 'CONTRATANTE 2'}</span><small>Contratante</small></div></section>
    </article>
    <article className="lincoln-contract-paper">
      <header className="lincoln-contract-doc-head is-cost"><div><small>ANEXO DEL CONTRATO</small><h1>HOJA DE COSTOS Y SERVICIOS</h1><p>{document?.eventType || 'EVENTO'} · {document?.contractor1Name || ''}{document?.contractor2Name ? ` / ${document.contractor2Name}` : ''}</p></div><div><strong>{document?.contractCode || 'BORRADOR'}</strong><span>{contractDateLong(document?.eventDate)}</span></div></header>
      <section className="lincoln-contract-package-summary"><div><span>Paquete</span><strong>{document?.packageName || 'SIN PAQUETE'}</strong></div><div><span>Niveles</span><strong>{pricingGroups.map((group) => group.name).join(' + ') || document?.packageVariantName || 'BASE'}</strong></div><div><span>Invitados</span><strong>{document?.guestCount || 0}</strong></div><div><span>Total</span><strong>{contractMoney(totals.totalBs)}</strong></div></section>
      <div className="lincoln-contract-matrix" style={{ '--contract-groups': Math.max(1, pricingGroups.length) }}>
        <div className="is-head"><strong>Servicios incluidos</strong>{pricingGroups.map((group) => <b key={group.id}>{group.name}</b>)}</div>
        {Object.entries(grouped).map(([category, lines]) => <section key={category}><h3>{category}</h3>{lines.map((line) => <div key={line.id}><span>{line.description}</span>{pricingGroups.map((group) => <b key={group.id}>{serviceAppliesToGroup(line, group) ? '✓' : ''}</b>)}</div>)}</section>)}
        <div className="is-cost"><strong>Costo por persona</strong>{pricingGroups.map((group) => <b key={group.id}>{contractMoney(group.pricePerPersonBs)}</b>)}</div>
        <div className="is-cost"><strong>Cantidad de invitados</strong>{pricingGroups.map((group) => <b key={group.id}>{group.guestCount}</b>)}</div>
      </div>
      {extras.length ? <section className="lincoln-contract-extras"><h3>SERVICIOS ADICIONALES</h3>{extras.map((line) => <div key={line.id}><span>{line.description}<em>{extraScope(line)}</em></span><small>{line.costMode === 'per_person' ? `${contractMoney(line.unitCostBs)} / persona` : contractMoney(Number(line.unitCostBs || 0) * Number(line.quantity || 1))}</small></div>)}</section> : null}
      <section className="lincoln-contract-totals"><div><span>Paquete base</span><strong>{contractMoney(totals.baseBs)}</strong></div>{totals.extrasBs > 0 ? <div><span>Extras</span><strong>{contractMoney(totals.extrasBs)}</strong></div> : null}{totals.discountBs > 0 ? <div><span>Descuento ({Number(document?.discountPercent || 0)}%)</span><strong>- {contractMoney(totals.discountBs)}</strong></div> : null}<div className="is-total"><span>Total servicio</span><strong>{contractMoney(totals.totalBs)}</strong></div><div><span>Anticipo / a cuenta</span><strong>{contractMoney(document?.advanceBs)}</strong></div><div><span>Saldo servicio</span><strong>{contractMoney(totals.balanceBs)}</strong></div><div><span>Garantía separada</span><strong>{contractMoney(document?.guaranteeBs)}</strong></div></section>
      {document?.notes ? <section className="lincoln-contract-notes"><b>Observaciones / acuerdos</b><p>{document.notes}</p></section> : null}
    </article>
  </div>;
}

function ContractConversionModal({ reservation, packages = [], saving, onClose, onConfirm }) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(() => buildContractDraft(reservation));
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const totals = contractTotals(draft);
  const updateExtra = (id, patch) => setDraft((current) => ({ ...current, extras: current.extras.map((line) => line.id === id ? { ...line, ...patch } : line) }));
  const activePricingGroups = (draft.pricingGroups ?? []).filter((group) => group.selected !== false && Number(group.guestCount || 0) > 0);
  const lineAppliesToVariant = (line, variantId) => {
    if (line.selected === false) return false;
    const variantIds = Array.isArray(line.variantIds) ? line.variantIds.map(String) : [];
    return !variantIds.length || variantIds.includes(String(variantId));
  };
  const toggleLineVariant = (collection, lineId, variantId) => setDraft((current) => {
    const activeIds = (current.pricingGroups ?? []).filter((group) => group.selected !== false && Number(group.guestCount || 0) > 0).map((group) => String(group.variantId));
    return {
      ...current,
      [collection]: current[collection].map((line) => {
        if (line.id !== lineId) return line;
        const configuredIds = Array.isArray(line.variantIds) ? line.variantIds.map(String) : [];
        const selectedIds = line.selected === false ? [] : configuredIds.length ? configuredIds.filter((id) => activeIds.includes(id)) : [...activeIds];
        const nextIds = selectedIds.includes(String(variantId)) ? selectedIds.filter((id) => id !== String(variantId)) : [...selectedIds, String(variantId)];
        return { ...line, selected: nextIds.length > 0, variantIds: nextIds };
      }),
    };
  });
  const updatePricingGroup = (id, patch) => setDraft((current) => {
    const pricingGroups = current.pricingGroups.map((group) => group.id === id ? { ...group, ...patch } : group);
    const guestCount = pricingGroups.filter((group) => group.selected !== false).reduce((total, group) => total + Number(group.guestCount || 0), 0);
    const activeGroups = pricingGroups.filter((group) => group.selected !== false && Number(group.guestCount || 0) > 0);
    return { ...current, pricingGroups, guestCount, packageVariantName: activeGroups.map((group) => group.name).join(' + '), packageVariantId: activeGroups.length === 1 ? activeGroups[0].variantId : 'mixed' };
  });
  const activePackages = packages.filter((pkg) => pkg?.status !== 'inactive');
  const choosePackage = (pkg) => setDraft((current) => ({ ...current, ...contractPackagePatch(pkg, current.guestCount, pkg.id === current.packageId ? current.packageVariantId : '') }));
  const validateStep = () => {
    if (step === 1 && !draft.contractor1Name.trim()) return 'Completa el nombre del Contratante 1.';
    if (step === 1 && !draft.eventDate) return 'Selecciona la fecha del evento.';
    if (step === 2 && !draft.packageId) return 'Selecciona un paquete para el contrato.';
    if (step === 2 && !(draft.pricingGroups ?? []).some((group) => group.selected !== false && Number(group.guestCount || 0) > 0)) return 'Activa al menos un nivel e indica cuántos invitados tendrá.';
    return '';
  };
  const goNext = () => { const message = validateStep(); if (message) return window.alert(message); setStep((current) => Math.min(4, current + 1)); };
  const goBack = () => setStep((current) => Math.max(1, current - 1));
  const confirm = () => {
    if (!draft.contractor1Name.trim()) return window.alert('El Contratante 1 es obligatorio.');
    if (!draft.eventDate) return window.alert('La fecha del evento es obligatoria.');
    if (Number(totals.guestCount || 0) <= 0) return window.alert('Indica la cantidad de invitados.');
    const finalDraft = {
      ...draft,
      guestCount: totals.guestCount,
      clauses: draft.clausesCustomized
        ? draft.clauses
        : contractDefaultClauses({ ...draft, guestCount: totals.guestCount }),
    };
    const documentDraft = { ...finalDraft };
    delete documentDraft.clausesCustomized;
    const contractDocumentSnapshot = { ...documentDraft, totals, version: 1, generatedAt: new Date().toISOString(), sourceReservationCode: reservation?.code ?? '' };
    onConfirm({
      guaranteeBs: Number(draft.guaranteeBs || 0), guestCount: Number(totals.guestCount || 0), estimatedTotalBs: totals.totalBs, totalBs: totals.totalBs,
      packageId: draft.packageId, packageName: draft.packageName, packageVariantId: draft.packageVariantId, packageVariantName: draft.packageVariantName,
      packagePricePerPersonBs: Number(draft.pricePerPersonBs || 0), packageSnapshot: draft.packageSnapshot,
      contractDocumentSnapshot, contractDocumentVersion: 1, status: 'contracted', contractedAt: new Date().toISOString(), notes: draft.notes,
    });
  };
  return <div className="lincoln-contract-flow-backdrop"><section className="lincoln-contract-flow-modal">
    <header><div><small>RESERVA CONFIRMADA · {reservation?.code}</small><h2>Preparar contrato</h2><p>Completa la propuesta comercial y revisa las dos páginas antes de formalizar.</p></div><button type="button" aria-label="Cerrar" onClick={onClose}>×</button></header>
    <nav className="lincoln-contract-flow-steps">{[['1','Cliente y evento','Datos legales'],['2','Paquete y servicios','Propuesta comercial'],['3','Pagos y condiciones','Acuerdos'],['4','Revisar y generar','2 páginas']].map(([number,label,detail]) => <button type="button" key={number} className={step === Number(number) ? 'is-active' : step > Number(number) ? 'is-done' : ''} onClick={() => Number(number) <= step && setStep(Number(number))}><b>{step > Number(number) ? '✓' : number}</b><span><strong>{label}</strong><small>{detail}</small></span></button>)}</nav>
    <div className="lincoln-contract-flow-body">
      {step === 1 ? <section className="lincoln-contract-flow-section"><div className="lincoln-contract-flow-title"><small>PASO 1</small><h3>Datos que irán al contrato</h3><p>Vienen desde la reserva; puedes completar lo necesario antes de confirmar.</p></div><div className="lincoln-contract-flow-grid"><Field label="Contratante 1"><input value={draft.contractor1Name} onChange={(e) => set('contractor1Name', e.target.value)} /></Field><Field label="C.I. 1"><input value={draft.contractor1Ci} onChange={(e) => set('contractor1Ci', e.target.value)} /></Field><Field label="Contratante 2"><input value={draft.contractor2Name} onChange={(e) => set('contractor2Name', e.target.value)} /></Field><Field label="C.I. 2"><input value={draft.contractor2Ci} onChange={(e) => set('contractor2Ci', e.target.value)} /></Field><Field label="Tipo de evento"><input value={draft.eventType} onChange={(e) => set('eventType', e.target.value)} /></Field><Field label="Fecha"><input type="date" value={draft.eventDate} onChange={(e) => set('eventDate', e.target.value)} /></Field><Field label="Hora"><input type="time" value={draft.startTime} onChange={(e) => set('startTime', e.target.value)} /></Field><Field label="Duración (h)"><input type="number" min="1" value={draft.durationHours} onChange={(e) => set('durationHours', toNumber(e.target.value))} /></Field><Field label="Salón"><input value={draft.roomName} onChange={(e) => set('roomName', e.target.value)} /></Field><Field label="Invitados"><input type="number" min="1" value={draft.guestCount} onChange={(e) => set('guestCount', toNumber(e.target.value))} /></Field></div></section> : null}
      {step === 2 ? <section className="lincoln-contract-flow-section">
        <div className="lincoln-contract-flow-title"><small>PASO 2 DE 4 · PROPUESTA</small><h3>Elige el paquete que irá en el contrato</h3><p>Activa uno o varios niveles y distribuye los invitados, por ejemplo 70 Jóvenes y 80 Adultos.</p></div>
        <div className="lincoln-contract-package-picker">{activePackages.map((pkg) => { const variants = Array.isArray(pkg.variants) && pkg.variants.length ? pkg.variants.filter((variant) => variant?.status !== 'inactive') : [{ name: 'BASE', pricePerPersonBs: pkg.pricePerPersonBs }]; const selected = String(pkg.id) === String(draft.packageId); return <button type="button" key={pkg.id} className={selected ? 'is-selected' : ''} onClick={() => choosePackage(pkg)}><span>{selected ? '✓ Seleccionado' : 'Seleccionar'}</span><strong>{pkg.name}</strong><small>{pkg.roomName || 'Todos los salones'} · mínimo {pkg.minimumGuests || 0} personas</small><div>{variants.map((variant) => <em key={variant.id || variant.name}>{variant.name} <b>{contractMoney(variant.pricePerPersonBs)}</b></em>)}</div></button>; })}{!activePackages.length ? <div className="lincoln-contract-picker-empty"><strong>No hay paquetes activos</strong><span>Crea o activa una plantilla desde el módulo Paquetes.</span></div> : null}</div>
        <div className="lincoln-contract-proposal-head"><div><span>Paquete</span><strong>{draft.packageName || 'SIN PAQUETE'}</strong><small>{totals.guestCount || 0} invitados contratados</small></div><div><span>Subtotal del paquete</span><strong>{contractMoney(totals.baseBs)}</strong></div><div><span>Total con extras</span><strong>{contractMoney(totals.totalBs)}</strong></div></div>
        {draft.pricingGroups?.length ? <div className="lincoln-contract-pricing-groups">{draft.pricingGroups.map((group) => <article key={group.id} className={group.selected !== false ? 'is-selected' : ''}>
          <label className="is-toggle"><input type="checkbox" checked={group.selected !== false} onChange={(e) => updatePricingGroup(group.id, { selected: e.target.checked })} /><strong>{group.name}</strong></label>
          <label><span>Invitados</span><input type="number" min="0" value={group.guestCount} disabled={group.selected === false} onChange={(e) => updatePricingGroup(group.id, { guestCount: toNumber(e.target.value) })} /></label>
          <label><span>Bs por persona</span><input type="number" min="0" step="0.01" value={group.pricePerPersonBs} disabled={group.selected === false} onChange={(e) => updatePricingGroup(group.id, { pricePerPersonBs: toNumber(e.target.value) })} /></label>
          <b>{contractMoney(Number(group.guestCount || 0) * Number(group.pricePerPersonBs || 0))}</b>
        </article>)}</div> : null}
        <div className="lincoln-contract-proposal-cols">
          <article className="lincoln-contract-choice-table"><header><div><h4>Servicios incluidos</h4><p>Marca qué recibe cada nivel del mix.</p></div><span>{draft.services.filter((line) => line.selected !== false).length} activos</span></header>{activePricingGroups.length ? <div className="lincoln-contract-choice-head" style={{ '--choice-groups': activePricingGroups.length }}><strong>Servicio</strong>{activePricingGroups.map((group) => <b key={group.id}>{group.name}</b>)}</div> : null}{draft.services.length ? draft.services.map((line) => <div className="lincoln-contract-choice-row" style={{ '--choice-groups': activePricingGroups.length }} key={line.id}><span><b>{line.category}</b><strong>{line.description}</strong></span>{activePricingGroups.map((group) => <label key={group.id} title={`${line.description} · ${group.name}`}><input type="checkbox" checked={lineAppliesToVariant(line, group.variantId)} onChange={() => toggleLineVariant('services', line.id, group.variantId)} /><i>✓</i></label>)}</div>) : <p className="is-empty">El paquete no tiene servicios configurados.</p>}</article>
          <article className="lincoln-contract-choice-table is-extras"><header><div><h4>Extras disponibles</h4><p>Elige para quién aplica cada adicional.</p></div><span>{draft.extras.filter((line) => line.selected).length} elegidos</span></header>{activePricingGroups.length ? <div className="lincoln-contract-choice-head" style={{ '--choice-groups': activePricingGroups.length }}><strong>Extra y precio</strong>{activePricingGroups.map((group) => <b key={group.id}>{group.name}</b>)}</div> : null}{draft.extras.length ? draft.extras.map((line) => <div className="lincoln-contract-choice-row" style={{ '--choice-groups': activePricingGroups.length }} key={line.id}><span><b>{line.costMode === 'per_person' ? 'POR PERSONA' : 'POR EVENTO'}</b><strong>{line.description}</strong><label className="is-price"><small>Bs</small><input type="number" min="0" step="0.01" value={line.unitCostBs} onChange={(e) => updateExtra(line.id, { unitCostBs: toNumber(e.target.value) })} /></label></span>{activePricingGroups.map((group) => <label key={group.id} title={`${line.description} · ${group.name}`}><input type="checkbox" checked={lineAppliesToVariant(line, group.variantId)} onChange={() => toggleLineVariant('extras', line.id, group.variantId)} /><i>✓</i></label>)}</div>) : <p className="is-empty">Este paquete no tiene extras configurados.</p>}</article>
        </div>
      </section> : null}
      {step === 3 ? <section className="lincoln-contract-flow-section"><div className="lincoln-contract-flow-title"><small>PASO 3</small><h3>Condiciones y cláusulas</h3><p>Los montos permanecen separados para no mezclar servicio y garantía.</p></div><div className="lincoln-contract-condition-grid"><Field label="Anticipo / a cuenta Bs"><input type="number" min="0" step="0.01" value={draft.advanceBs} onChange={(e) => set('advanceBs', toNumber(e.target.value))} /></Field><Field label="Garantía Bs"><input type="number" min="0" step="0.01" value={draft.guaranteeBs} onChange={(e) => set('guaranteeBs', toNumber(e.target.value))} /></Field><Field label="Descuento %"><input type="number" min="0" max="100" step="0.01" value={draft.discountPercent} onChange={(e) => set('discountPercent', toNumber(e.target.value))} /></Field><Field label="Saldo antes del evento (días)"><input type="number" min="0" value={draft.balanceDueDays} onChange={(e) => set('balanceDueDays', toNumber(e.target.value))} /></Field></div><div className="lincoln-contract-clause-editor">{draft.clauses.map((clause,index) => <label key={index}><span>Cláusula {index + 1}</span><textarea value={clause} onChange={(e) => setDraft((current) => ({ ...current, clausesCustomized: true, clauses: current.clauses.map((item,i) => i === index ? e.target.value : item) }))} /></label>)}</div><Field label="Observaciones / acuerdos" wide><textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} /></Field></section> : null}
      {step === 4 ? <section className="lincoln-contract-flow-section is-document"><div className="lincoln-contract-flow-title"><small>PASO 4</small><h3>Vista previa del documento</h3><p>Así quedará congelado el contrato y su hoja de costos.</p></div><ContractDocumentSheet document={{ ...draft, guestCount: totals.guestCount, clauses: draft.clausesCustomized ? draft.clauses : contractDefaultClauses({ ...draft, guestCount: totals.guestCount }), totals }} compact /></section> : null}
    </div>
    <footer><button type="button" className="is-secondary" onClick={step === 1 ? onClose : goBack}>{step === 1 ? 'Cancelar' : '← Atrás'}</button><div><span>Total: <b>{contractMoney(totals.totalBs)}</b></span>{step < 4 ? <button type="button" onClick={goNext}>Siguiente →</button> : <button type="button" disabled={saving} onClick={confirm}>{saving ? 'Creando contrato...' : 'Confirmar contrato'}</button>}</div></footer>
  </section></div>;
}

function ContractDocumentModal({ eventRecord, onClose }) {
  const [preview, setPreview] = useState({ loading: true, error: '', blobUrl: '', cacheStatus: '' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    api.lincoln.getContractPdf({ identifier: eventRecord?.id || eventRecord?.contractCode || eventRecord?.code })
      .then((result) => {
        if (cancelled) {
          if (result?.blobUrl) URL.revokeObjectURL(result.blobUrl);
          return;
        }
        objectUrl = result?.blobUrl || '';
        setPreview({ loading: false, error: '', blobUrl: objectUrl, cacheStatus: result?.cacheStatus || '' });
      })
      .catch((error) => {
        if (!cancelled) setPreview({ loading: false, error: error?.message || 'No se pudo preparar el contrato.', blobUrl: '', cacheStatus: '' });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [eventRecord?.code, eventRecord?.contractCode, eventRecord?.id]);

  const openPdf = () => {
    if (!preview.blobUrl) return;
    window.open(preview.blobUrl, '_blank', 'noopener,noreferrer');
  };

  return <div className="lincoln-contract-document-backdrop" onMouseDown={onClose}>
    <section className="lincoln-contract-document-modal is-server-pdf" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><small>DOCUMENTOS DEL CONTRATO</small><h2>{eventRecord?.contractCode || eventRecord?.code}</h2><p>PDF oficial generado por el motor documental del servidor.</p></div>
        <div>{preview.blobUrl ? <button type="button" className="is-print" onClick={openPdf}>Imprimir / guardar PDF</button> : null}<button type="button" onClick={onClose}>×</button></div>
      </header>
      <div className="lincoln-contract-document-scroll is-pdf-viewer">
        {preview.loading ? <div className="lincoln-document-loading"><strong>Preparando documento...</strong><span>El servidor está generando el contrato y su hoja de costos.</span></div> : null}
        {preview.error ? <div className="lincoln-commercial-error"><strong>No se pudo abrir el documento.</strong><span>{preview.error}</span></div> : null}
        {!preview.loading && preview.blobUrl ? <iframe title={`Contrato ${eventRecord?.contractCode || eventRecord?.code}`} src={preview.blobUrl} className="lincoln-server-document-frame" /> : null}
      </div>
    </section>
  </div>;
}

function CommercialRecordDetailModal({ kind, record, state, initialSection = 'summary', onClose, onEdit, onEconomic, onGenerateContract, onOpenDocument }) {
  const [section, setSection] = useState(initialSection);
  const isReservation = kind === 'reservation';
  const reservationPaid = Number(record?.reservationPaymentBs ?? 0);
  const reservationAccount = Number(record?.accountPaymentBs ?? 0);
  const reservationTotal = Number(record?.estimatedTotalBs ?? 0);
  const contractFinancial = !isReservation ? getEventFinancialSummary(state, record) : null;
  const totalBs = isReservation ? reservationTotal : Number(contractFinancial?.eventTotalBs ?? record?.totalBs ?? record?.estimatedTotalBs ?? 0);
  const paidBs = isReservation ? reservationPaid + reservationAccount : Number(contractFinancial?.servicePaidBs ?? 0);
  const balanceBs = Math.max(0, isReservation ? totalBs - paidBs : Number(contractFinancial?.serviceBalanceBs ?? 0));
  const guaranteeBs = Number(record?.guaranteeBs ?? contractFinancial?.guaranteeRequiredBs ?? 0);
  const reservationStatus = String(record?.status ?? '').toLowerCase();
  const canGenerateContract = isReservation && !['lead', 'cancelled', 'converted'].includes(reservationStatus) && reservationPaid > 0;
  const snapshot = record?.contractDocumentSnapshot ?? record?.packageSnapshot ?? null;

  return <div className="lincoln-commercial-detail-backdrop" onMouseDown={onClose}>
    <section className="lincoln-commercial-detail-modal" onMouseDown={(event) => event.stopPropagation()}>
      <header className="lincoln-commercial-detail-head">
        <div><small>{isReservation ? 'RESERVA' : 'CONTRATO'}</small><h2>{isReservation ? record?.code : (record?.contractCode || record?.code)}</h2><p>{record?.clientName || record?.contractor1Name || 'Sin cliente'} · {record?.eventType || 'Evento'}</p></div>
        <div><span className={`lincoln-commercial-detail-status is-${reservationStatus || 'pending'}`}>{statusLabel(record?.status)}</span><button type="button" onClick={onClose}>×</button></div>
      </header>
      <nav className="lincoln-commercial-detail-tabs">
        <button type="button" className={section === 'summary' ? 'is-active' : ''} onClick={() => setSection('summary')}>Resumen</button>
        <button type="button" className={section === 'economic' ? 'is-active' : ''} onClick={() => setSection('economic')}>Económico</button>
        <button type="button" className={section === 'documents' ? 'is-active' : ''} onClick={() => setSection('documents')}>Documentos</button>
      </nav>
      <div className="lincoln-commercial-detail-body">
        {section === 'summary' ? <>
          <section className="lincoln-commercial-detail-grid">
            <article><span>Contratante 1</span><strong>{record?.contractor1Name || record?.clientName || '—'}</strong><small>C.I. {record?.contractor1Ci || record?.clientCi || '—'} · {record?.contractor1Phone || record?.clientPhone || '—'}</small></article>
            <article><span>Contratante 2</span><strong>{record?.contractor2Name || '—'}</strong><small>C.I. {record?.contractor2Ci || '—'} · {record?.contractor2Phone || '—'}</small></article>
            <article><span>Evento</span><strong>{record?.eventType || '—'}</strong><small>{formatDate(record?.eventDate)} · {record?.startTime || 'hora pendiente'}</small></article>
            <article><span>Salón</span><strong>{record?.roomName || '—'}</strong><small>{record?.durationHours || 0} h · {record?.guestCount || 0} personas</small></article>
            <article><span>Paquete</span><strong>{record?.packageName || 'Sin definir'}</strong><small>{record?.packageVariantName || 'Sin nivel'}</small></article>
            <article><span>Estado comercial</span><strong>{statusLabel(record?.status)}</strong><small>{isReservation ? (reservationPaid > 0 ? 'Reserva concretada · bloquea fecha' : 'Interesado · no bloquea fecha') : 'Documento contractual formalizado'}</small></article>
          </section>
          {record?.notes ? <section className="lincoln-commercial-detail-notes"><span>Observaciones y acuerdos</span><p>{record.notes}</p></section> : null}
        </> : null}
        {section === 'economic' ? <>
          <section className="lincoln-commercial-money-cards">
            <article><span>Total servicio</span><strong>{formatBs(totalBs)}</strong><small>Valor comercial del evento</small></article>
            <article><span>Pagado / a cuenta</span><strong>{formatBs(paidBs)}</strong><small>{isReservation ? `Reserva ${formatBs(reservationPaid)} · A cuenta ${formatBs(reservationAccount)}` : 'Pagos activos del contrato'}</small></article>
            <article className={balanceBs > 0 ? 'is-pending' : 'is-paid'}><span>Saldo pendiente</span><strong>{formatBs(balanceBs)}</strong><small>{balanceBs > 0 ? 'Pendiente de cobro' : 'Servicio cubierto'}</small></article>
            <article><span>Garantía separada</span><strong>{formatBs(guaranteeBs)}</strong><small>No forma parte del total del servicio</small></article>
          </section>
          {!isReservation ? <div className="lincoln-commercial-detail-callout"><div><strong>Sector económico completo</strong><span>Consulta movimientos, recibos, garantía y saldo con el módulo económico del contrato.</span></div><button type="button" onClick={onEconomic}>Abrir económico</button></div> : <div className="lincoln-commercial-detail-callout"><div><strong>Economía de la reserva</strong><span>Los montos registrados aquí acompañarán la operación cuando se genere el contrato.</span></div><button type="button" onClick={onEdit}>Editar montos</button></div>}
        </> : null}
        {section === 'documents' ? <section className="lincoln-commercial-documents-panel">
          <header><div><small>EXPEDIENTE COMERCIAL</small><h3>Documentos</h3></div><span>{isReservation ? 'Reserva' : 'Contrato'}</span></header>
          {isReservation ? <>
            <article className="lincoln-commercial-document-row"><div><b>Reserva comercial</b><span>{record?.code} · estado {statusLabel(record?.status)}</span></div><span className="is-state">REGISTRO</span></article>
            <article className="lincoln-commercial-document-row"><div><b>Propuesta / paquete congelado</b><span>{snapshot ? `${record?.packageName || 'Paquete'} · ${record?.packageVariantName || 'nivel base'}` : 'Aún no existe una propuesta congelada'}</span></div><span className={`is-state ${snapshot ? 'is-ready' : ''}`}>{snapshot ? 'DISPONIBLE' : 'PENDIENTE'}</span></article>
            <article className="lincoln-commercial-document-row"><div><b>Contrato de servicios</b><span>{canGenerateContract ? 'La reserva está lista para formalizarse.' : reservationPaid <= 0 ? 'Se habilita cuando la reserva se concrete.' : 'No disponible para el estado actual.'}</span></div>{canGenerateContract ? <button type="button" onClick={onGenerateContract}>Generar contrato</button> : <span className="is-state">PENDIENTE</span>}</article>
          </> : <>
            <article className="lincoln-commercial-document-row is-primary"><div><b>Contrato de servicios + hoja de costos</b><span>{record?.contractCode || record?.code} · PDF generado por el servidor</span></div><button type="button" onClick={onOpenDocument}>Abrir PDF</button></article>
            <article className="lincoln-commercial-document-row"><div><b>Snapshot contractual</b><span>Versión {record?.contractDocumentVersion || 1} · información comercial congelada</span></div><span className="is-state is-ready">ARCHIVADO</span></article>
          </>}
        </section> : null}
      </div>
      <footer className="lincoln-commercial-detail-footer"><button type="button" className="is-secondary" onClick={onClose}>Cerrar</button><div><button type="button" className="is-secondary" onClick={onEdit}>Editar</button>{canGenerateContract ? <button type="button" onClick={onGenerateContract}>Generar contrato</button> : null}{!isReservation ? <button type="button" onClick={onOpenDocument}>Abrir contrato</button> : null}</div></footer>
    </section>
  </div>;
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
    type: 'deposit', amountBs: '', serviceAllocationBs: '', guaranteeAllocationBs: '', replacementAllocationBs: '',
    date: today, method: 'cash', destination: destinations[0] ?? 'CAJA CHICA', payerName: eventRecord?.clientName ?? '', description: '', reference: '',
  });
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const amountBs = toNumber(form.amountBs);
  const serviceAllocationBs = toNumber(form.serviceAllocationBs);
  const guaranteeAllocationBs = toNumber(form.guaranteeAllocationBs);
  const replacementAllocationBs = toNumber(form.replacementAllocationBs);
  const allocatedBs = serviceAllocationBs + guaranteeAllocationBs + replacementAllocationBs;
  const surplusBs = Math.max(0, amountBs - allocatedBs);
  const submit = (e) => {
    e.preventDefault();
    if (form.type === 'deposit' && allocatedBs > amountBs + 0.009) {
      window.alert('La distribución no puede superar el monto recibido.');
      return;
    }
    onSave({ ...form, amountBs, serviceAllocationBs, guaranteeAllocationBs, replacementAllocationBs });
  };
  return (
    <Modal title={`Registrar dinero · ${eventRecord?.code ?? 'Evento'}`} saving={saving} onClose={onClose} onSubmit={submit}>
      <Field label="Tipo"><select value={form.type} onChange={(e) => set('type', e.target.value)}><option value="deposit">Ingreso flexible</option><option value="advance">Anticipo</option><option value="installment">A cuenta</option><option value="balance">Saldo</option><option value="guarantee">Garantía</option><option value="replacement">Reposición cobrada</option></select></Field>
      <Field label="Monto recibido (Bs)"><input required type="number" min="0.01" step="0.01" value={form.amountBs} onChange={(e) => set('amountBs', e.target.value)} /></Field>
      {form.type === 'deposit' ? <div className="lincoln-economic-allocation is-wide">
        <strong>Distribuir este único ingreso</strong><p>Un solo recibo y un solo ingreso de Caja Lincoln, repartido internamente sin duplicar dinero.</p>
        <div><Field label="Aplicar al servicio"><input type="number" min="0" step="0.01" value={form.serviceAllocationBs} onChange={(e) => set('serviceAllocationBs', e.target.value)} /></Field><Field label="Separar como garantía"><input type="number" min="0" step="0.01" value={form.guaranteeAllocationBs} onChange={(e) => set('guaranteeAllocationBs', e.target.value)} /></Field><Field label="Cobro de reposición"><input type="number" min="0" step="0.01" value={form.replacementAllocationBs} onChange={(e) => set('replacementAllocationBs', e.target.value)} /></Field></div>
        <span className={allocatedBs > amountBs + 0.009 ? 'is-error' : ''}>Distribuido: <b>{formatBs(allocatedBs)}</b> · Excedente sin aplicar: <b>{formatBs(surplusBs)}</b></span>
      </div> : null}
      <Field label="Fecha"><input required type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
      <Field label="Medio de pago"><select value={form.method} onChange={(e) => set('method', e.target.value)}><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="qr">QR</option></select></Field>
      <Field label="Destino"><input list="lincoln-payment-destinations" value={form.destination} onChange={(e) => set('destination', e.target.value)} /><datalist id="lincoln-payment-destinations">{destinations.map((item) => <option key={item} value={item} />)}</datalist></Field>
      <Field label="Pagado por"><input value={form.payerName} onChange={(e) => set('payerName', e.target.value)} /></Field>
      <Field label="Concepto" wide><input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Detalle del dinero recibido" /></Field>
      <Field label="Referencia / respaldo" wide><input value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="N° transferencia, QR, observación, etc." /></Field>
    </Modal>
  );
}

function EconomicEntryModal({ eventRecord, summary, saving, onClose, onSave }) {
  const [form, setForm] = useState({ type: 'charge', amountBs: '', note: '', reference: '' });
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const isNote = form.type === 'note';
  const maxApply = Math.max(0, Math.min(Number(summary?.guaranteeHeldBs ?? 0), Number(summary?.replacementPendingBs ?? 0)));
  return <Modal title={`Hoja económica · ${eventRecord?.code ?? 'Evento'}`} saving={saving} onClose={onClose} onSubmit={(e) => { e.preventDefault(); onSave({ ...form, amountBs: isNote ? 0 : toNumber(form.amountBs) }); }}>
    <Field label="Movimiento"><select value={form.type} onChange={(e) => set('type', e.target.value)}><option value="charge">Cargo / reposición pendiente</option><option value="guarantee_apply">Aplicar garantía a cargo</option><option value="note">Nota económica</option></select></Field>
    {!isNote ? <Field label="Monto (Bs)"><input required type="number" min="0.01" max={form.type === 'guarantee_apply' ? maxApply || undefined : undefined} step="0.01" value={form.amountBs} onChange={(e) => set('amountBs', e.target.value)} /></Field> : null}
    {form.type === 'guarantee_apply' ? <div className="lincoln-economic-hint is-wide"><strong>Disponible para aplicar: {formatBs(maxApply)}</strong><span>Garantía retenida {formatBs(summary?.guaranteeHeldBs ?? 0)} · cargos pendientes {formatBs(summary?.replacementPendingBs ?? 0)}</span></div> : null}
    <Field label="Detalle" wide><textarea required value={form.note} onChange={(e) => set('note', e.target.value)} placeholder={isNote ? 'Observación económica interna' : 'Ej. 10 copas rotas, limpieza extraordinaria...'} /></Field>
    <Field label="Referencia / respaldo" wide><input value={form.reference} onChange={(e) => set('reference', e.target.value)} /></Field>
  </Modal>;
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

const getPaymentAllocations = (payment = {}) => {
  const amountBs = Number(payment.amountBs ?? 0);
  const explicit = ['serviceAllocationBs', 'guaranteeAllocationBs', 'replacementAllocationBs', 'surplusAllocationBs'].some((key) => payment?.[key] !== undefined && payment?.[key] !== null);
  if (explicit) return { serviceBs: Number(payment.serviceAllocationBs ?? 0), guaranteeBs: Number(payment.guaranteeAllocationBs ?? 0), replacementBs: Number(payment.replacementAllocationBs ?? 0), surplusBs: Number(payment.surplusAllocationBs ?? 0) };
  if (servicePaymentTypes.has(payment.type)) return { serviceBs: amountBs, guaranteeBs: 0, replacementBs: 0, surplusBs: 0 };
  if (payment.type === 'guarantee') return { serviceBs: 0, guaranteeBs: amountBs, replacementBs: 0, surplusBs: 0 };
  if (payment.type === 'replacement') return { serviceBs: 0, guaranteeBs: 0, replacementBs: amountBs, surplusBs: 0 };
  return { serviceBs: 0, guaranteeBs: 0, replacementBs: 0, surplusBs: amountBs };
};

const getEventFinancialSummary = (state, eventRecord) => {
  const payments = activeRows(state.payments).filter((row) => row.eventId === eventRecord.id);
  const ledger = activeRows(state.economicLedgerEntries).filter((row) => row.eventId === eventRecord.id);
  const allocations = payments.map(getPaymentAllocations);
  const servicePaidBs = sum(allocations, (row) => row.serviceBs);
  const guaranteeCollectedBs = sum(allocations, (row) => row.guaranteeBs);
  const guaranteeReturnedBs = sum(payments.filter((row) => row.type === 'guarantee_return'), (row) => row.amountBs);
  const replacementCollectedBs = sum(allocations, (row) => row.replacementBs);
  const replacementChargedBs = sum(ledger.filter((row) => row.type === 'charge'), (row) => row.amountBs);
  const guaranteeAppliedBs = sum(ledger.filter((row) => row.type === 'guarantee_apply'), (row) => row.amountBs);
  const eventTotalBs = Number(eventRecord.totalBs ?? eventRecord.estimatedTotalBs ?? 0);
  const guaranteeRequiredBs = Number(eventRecord.guaranteeBs ?? 0);
  return {
    payments, ledger, eventTotalBs, servicePaidBs, serviceBalanceBs: Math.max(0, eventTotalBs - servicePaidBs), guaranteeRequiredBs,
    guaranteeCollectedBs, guaranteePendingBs: Math.max(0, guaranteeRequiredBs - guaranteeCollectedBs), guaranteeReturnedBs, guaranteeAppliedBs,
    guaranteeHeldBs: Math.max(0, guaranteeCollectedBs - guaranteeReturnedBs - guaranteeAppliedBs), replacementBs: replacementCollectedBs,
    replacementChargedBs, replacementCollectedBs, replacementPendingBs: Math.max(0, replacementChargedBs - replacementCollectedBs - guaranteeAppliedBs),
  };
};

const economicEntryLabel = (row) => ({ deposit: 'Ingreso / depósito', guarantee: 'Garantía recibida', charge: 'Cargo / reposición', guarantee_apply: 'Aplicado desde garantía', refund: 'Devolución', note: 'Nota económica' }[row?.type] ?? paymentTypeLabel(row?.subtype || row?.type));

function EventEconomicView({ state, eventRecord, canReset, onBack, onNewPayment, onNewEconomicEntry, onResetEconomic, onVoidPayment, onReturnGuarantee, onPrintReceipt }) {
  const summary = getEventFinancialSummary(state, eventRecord);
  const linkedPaymentIds = new Set(summary.ledger.map((row) => String(row?.paymentId ?? '')).filter(Boolean));
  const legacyRows = summary.payments.filter((row) => !linkedPaymentIds.has(String(row.id))).map((row) => ({
    id: `legacy-${row.id}`, code: row.code, eventId: row.eventId, type: row.type === 'guarantee_return' ? 'refund' : row.type === 'guarantee' ? 'guarantee' : 'deposit', subtype: row.type,
    amountBs: row.amountBs, method: row.method, destination: row.destination, note: row.description, reference: row.reference, paymentId: row.id,
    receiptId: row.receiptId, receiptCode: row.receiptCode, isCashRegistered: true, date: row.date, createdAt: row.createdAt,
  }));
  const history = [...summary.ledger, ...legacyRows].sort((a, b) => `${b.date ?? ''}${b.createdAt ?? ''}`.localeCompare(`${a.date ?? ''}${a.createdAt ?? ''}`));
  return (
    <div className="lincoln-content">
      <article className="lincoln-card lincoln-economic-sheet">
        <header><div><small>Hoja económica del evento</small><h2>{eventRecord.code} · {eventRecord.clientName || eventRecord.eventType}</h2><p>El dinero real se refleja en Caja Lincoln; cargos, garantía y notas conservan su propia trazabilidad.</p></div><div className="lincoln-header-actions"><button type="button" className="is-secondary" onClick={onBack}>← Volver</button>{canReset ? <button type="button" className="is-secondary lincoln-reset-economic" onClick={onResetEconomic}>Reset económico</button> : null}<button type="button" className="is-secondary" onClick={onNewEconomicEntry}>+ Cargo / nota</button><button type="button" onClick={onNewPayment}>+ Registrar dinero</button></div></header>
        <div className="lincoln-event-summary lincoln-event-summary-economic">
          <div><small>Costo servicio</small><strong>{formatBs(summary.eventTotalBs)}</strong></div>
          <div><small>Pagado servicio</small><strong>{formatBs(summary.servicePaidBs)}</strong></div>
          <div className={summary.serviceBalanceBs > 0 ? 'has-warning' : 'has-ok'}><small>Saldo servicio</small><strong>{formatBs(summary.serviceBalanceBs)}</strong></div>
          <div><small>Garantía requerida</small><strong>{formatBs(summary.guaranteeRequiredBs)}</strong></div>
          <div><small>Garantía retenida</small><strong>{formatBs(summary.guaranteeHeldBs)}</strong><span>Aplicada {formatBs(summary.guaranteeAppliedBs)}</span></div>
          <div><small>Cargos / reposiciones</small><strong>{formatBs(summary.replacementChargedBs)}</strong><span>Cobrado {formatBs(summary.replacementCollectedBs)}</span></div>
          <div className={summary.replacementPendingBs > 0 ? 'has-warning' : 'has-ok'}><small>Pendiente reposiciones</small><strong>{formatBs(summary.replacementPendingBs)}</strong></div>
        </div>
        {summary.guaranteeHeldBs > 0 ? <div className="lincoln-inline-actions"><span>Hay {formatBs(summary.guaranteeHeldBs)} de garantía retenida y disponible.</span><button type="button" onClick={onReturnGuarantee}>Devolver garantía</button></div> : null}
        <DataTable rows={history} emptyText="Registra el primer ingreso, cargo, garantía o nota económica del evento." columns={[
          { key: 'date', label: 'Fecha', render: (row) => formatDate(row.date ?? row.createdAt) },
          { key: 'code', label: 'Movimiento' },
          { key: 'type', label: 'Concepto', render: (row) => <span>{economicEntryLabel(row)}</span> },
          { key: 'detail', label: 'Detalle', render: (row) => <span>{row.note || '—'}{row.reference ? <small> · {row.reference}</small> : null}</span> },
          { key: 'method', label: 'Medio', render: (row) => row.isCashRegistered ? paymentMethodLabel(row.method) : 'Interno' },
          { key: 'destination', label: 'Destino', render: (row) => row.destination || '—' },
          { key: 'receipt', label: 'Recibo', render: (row) => row.receiptCode ? <button type="button" className="lincoln-link-action" onClick={(e) => { e.stopPropagation(); onPrintReceipt(row.receiptId); }}>{row.receiptCode}</button> : '—' },
          { key: 'amount', label: 'Monto', render: (row) => row.type === 'note' ? <strong>—</strong> : <strong>{formatBs(row.amountBs)}</strong> },
          { key: 'action', label: '', render: (row) => row.paymentId && row.subtype !== 'guarantee_return' && row.type !== 'refund' ? <button type="button" className="lincoln-danger-action" onClick={(e) => { e.stopPropagation(); const payment = summary.payments.find((item) => item.id === row.paymentId); if (payment) onVoidPayment(payment); }}>Anular</button> : null },
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
  userPresence = [],
  onPublishUpdateNotice,
  onSwitchWorkspace,
  onLogout,
}) {
  const [activeView, setActiveView] = useState('panel');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [databaseStatus, setDatabaseStatus] = useState({ loading: true, error: '', snapshot: null });
  const [modal, setModal] = useState(null);
  const [economicEventId, setEconomicEventId] = useState('');
  const [saving, setSaving] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const userName = currentUser?.fullName ?? currentUser?.name ?? 'Usuario Lincoln';
  const userInitials = userName.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'US';
  const snapshot = databaseStatus.snapshot;
  const state = { ...emptyState, ...(snapshot?.state ?? {}) };
  const economicEvent = state.events.find((row) => row.id === economicEventId) ?? null;
  const lincolnPresence = useMemo(() => {
    const rows = (Array.isArray(userPresence) ? userPresence : []).filter((entry) =>
      String(entry?.activeTab ?? '').startsWith('lincoln_'),
    );
    if (!currentUser) return rows;
    const currentSessionId = String(currentUser.sessionId ?? '');
    const currentUserId = String(currentUser.id ?? '');
    const alreadyPresent = rows.some((entry) => (
      (currentSessionId && String(entry?.sessionId ?? '') === currentSessionId)
      || (!currentSessionId && currentUserId && String(entry?.userId ?? '') === currentUserId)
    ));
    if (alreadyPresent) return rows;
    return [
      {
        userId: currentUser.id,
        sessionId: currentUser.sessionId,
        fullName: currentUser.fullName ?? currentUser.name ?? currentUser.username ?? userName,
        role: currentUser.role ?? 'Usuario',
        activeTab: `lincoln_${activeView}`,
        device: currentUser.device,
      },
      ...rows,
    ];
  }, [activeView, currentUser, userName, userPresence]);

  useEffect(() => {
    if (!currentUser?.id) return undefined;
    let disposed = false;
    const publishLincolnPresence = async () => {
      if (disposed || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
      try {
        await api.presence.heartbeat({
          userId: currentUser.id,
          sessionId: currentUser.sessionId,
          fullName: currentUser.fullName ?? currentUser.name ?? currentUser.username ?? userName,
          role: currentUser.role ?? 'Usuario',
          activeTab: `lincoln_${activeView}`,
          device: currentUser.device,
        });
      } catch {
        // La presencia es informativa y nunca debe bloquear Lincoln.
      }
    };
    void publishLincolnPresence();
    const intervalId = window.setInterval(publishLincolnPresence, 20000);
    const publishWhenVisible = () => {
      if (document.visibilityState === 'visible') void publishLincolnPresence();
    };
    document.addEventListener('visibilitychange', publishWhenVisible);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', publishWhenVisible);
    };
  }, [activeView, currentUser, userName]);

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

  const actor = {
    id: currentUser?.id ?? null,
    name: userName,
    role: currentUser?.role ?? '',
  };
  const canResetLincoln = String(currentUser?.role ?? '').trim().toLowerCase() === 'developer';

  const verifyLincolnResetAccess = ({ code }) => api.lincoln.verifyResetAccess({ code, actor });

  const analyzeLincolnReset = ({ code, modules }) => api.lincoln.analyzeReset({ code, modules, actor });

  const executeLincolnReset = async ({ code, modules, confirmation, observations }) => {
    const response = await api.lincoln.executeReset({
      code,
      modules,
      confirmation,
      observations,
      revision: snapshot?.revision,
      actor,
    });
    await loadLincoln();
    return response;
  };

  const exportLincolnDatabase = ({ code, observations }) => api.lincoln.exportDatabase({
    code,
    observations,
    actor,
  });

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

  const convertReservation = async (reservation, eventPayload) => {
    if (!snapshot?.revision) return;
    setSaving(true);
    try {
      await api.lincoln.convertReservation({
        reservationId: reservation.id,
        event: eventPayload ?? {},
        revision: snapshot.revision,
        actor,
      });
      setModal(null);
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

  const cancelReservation = async (reservation) => {
    if (!snapshot?.revision || !reservation?.id) return;
    const accepted = window.confirm(`¿Cancelar la reserva ${reservation.code}? La fecha dejará de considerarse comprometida.`);
    if (!accepted) return;
    setSaving(true);
    try {
      await api.lincoln.updateRecord({
        collection: 'reservations',
        id: reservation.id,
        record: { ...reservation, status: 'cancelled' },
        revision: snapshot.revision,
        actor,
      });
      setModal(null);
      await loadLincoln();
    } catch (error) {
      await handleLincolnMutationError(error, 'No se pudo cancelar la reserva.');
    } finally {
      setSaving(false);
    }
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

  const saveEconomicEntry = async (eventRecord, entry) => {
    if (!snapshot?.revision) return;
    setSaving(true);
    try {
      await api.lincoln.createEconomicEntry({ eventId: eventRecord.id, entry, revision: snapshot.revision, actor });
      setModal(null);
      await loadLincoln();
      setEconomicEventId(eventRecord.id);
    } catch (error) {
      await handleLincolnMutationError(error, 'No se pudo registrar el movimiento económico.');
    } finally {
      setSaving(false);
    }
  };

  const resetEventEconomics = async (eventRecord) => {
    if (!snapshot?.revision || !eventRecord?.id) return;
    const confirmation = window.prompt(`RESET ECONÓMICO · ${eventRecord.code}

Esto eliminará pagos, recibos, ingresos de caja, devoluciones de garantía y hoja económica vinculados a ESTE evento. No elimina el contrato ni los egresos operativos manuales.

Escribe RESET ECONOMICO para continuar:`);
    if (confirmation === null) return;
    if (String(confirmation).trim().toUpperCase() !== 'RESET ECONOMICO') {
      window.alert('Confirmación incorrecta. No se realizó ningún cambio.');
      return;
    }
    const reason = window.prompt('Motivo del Reset económico:', 'RECONSTRUCCION ECONOMICA DEL EVENTO') ?? '';
    setSaving(true);
    try {
      await api.lincoln.resetEventEconomics({ eventId: eventRecord.id, confirmation: 'RESET ECONOMICO', reason, revision: snapshot.revision, actor });
      await loadLincoln();
      setEconomicEventId(eventRecord.id);
    } catch (error) {
      await handleLincolnMutationError(error, 'No se pudo ejecutar el Reset económico.');
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
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safe(receipt.code)}</title><style>@page{size:Letter portrait;margin:16mm}body{font-family:Arial,sans-serif;color:#173a29}.sheet{border:1px solid #dfe7e2;border-radius:14px;padding:22px}.head{display:flex;justify-content:space-between;border-bottom:3px solid #276342;padding-bottom:14px}.head h1{font-size:22px;margin:0}.code{font-size:22px;font-weight:800;color:#276342}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.grid div{padding:10px;border:1px solid #e2e8e4;border-radius:8px}.grid small{display:block;color:#738078;text-transform:uppercase;font-weight:700}.amount{margin-top:20px;padding:16px;border-radius:10px;background:#edf5ef;text-align:right}.amount strong{font-size:28px}.sign{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:60px;text-align:center}.line{border-top:1px solid #333;padding-top:7px}button{margin-top:20px;padding:10px 14px}@media print{button{display:none}}</style></head><body><section class="sheet"><div class="head"><div><small>Centro de Eventos Lincoln</small><h1>${receipt.direction === 'expense' ? 'COMPROBANTE DE DEVOLUCIÓN' : 'RECIBO DE INGRESO'}</h1></div><div class="code">${safe(receipt.code)}</div></div><div class="grid"><div><small>Evento</small><strong>${safe(receipt.eventCode)}</strong></div><div><small>Fecha</small><strong>${safe(formatDate(receipt.date))}</strong></div><div><small>Cliente</small><strong>${safe(receipt.clientName)}</strong></div><div><small>Concepto</small><strong>${safe(receipt.concept)}</strong></div><div><small>Medio</small><strong>${safe(paymentMethodLabel(receipt.method))}</strong></div><div><small>Destino</small><strong>${safe(receipt.destination)}</strong></div><div><small>${receipt.direction === 'expense' ? 'Devuelto a' : 'Pagado por'}</small><strong>${safe(receipt.payerName)}</strong></div><div><small>${receipt.direction === 'expense' ? 'Entregado por' : 'Recibido por'}</small><strong>${safe(receipt.createdByName)}</strong></div></div><div class="amount"><small>${receipt.direction === 'expense' ? 'TOTAL DEVUELTO' : 'TOTAL RECIBIDO'}</small><br><strong>${safe(formatBs(receipt.amountBs))}</strong></div><div class="sign"><div class="line">Entregué</div><div class="line">Recibí</div></div><button onclick="window.print()">Imprimir</button></section></body></html>`);
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
      {modal?.mode === 'economicEntry' ? <EconomicEntryModal eventRecord={modal.record} summary={getEventFinancialSummary(state, modal.record)} saving={saving} onClose={() => setModal(null)} onSave={(entry) => saveEconomicEntry(modal.record, entry)} /> : null}
      {modal?.mode === 'payment' ? <PaymentModal eventRecord={modal.record} state={state} saving={saving} onClose={() => setModal(null)} onSave={(form) => savePayment(modal.record, form)} /> : null}
      {modal?.mode === 'expense' ? <ExpenseModal record={modal.record} state={state} saving={saving} onClose={() => setModal(null)} onSave={saveExpense} /> : null}
      {modal?.mode === 'guaranteeReturn' ? <GuaranteeReturnModal eventRecord={modal.record} summary={getEventFinancialSummary(state, modal.record)} state={state} saving={saving} onClose={() => setModal(null)} onSave={(form) => returnGuarantee(modal.record, form)} /> : null}
      {modal?.mode === 'contractConvert' ? <ContractConversionModal reservation={modal.record} packages={state.packages} saving={saving} onClose={() => setModal(null)} onConfirm={(eventPayload) => convertReservation(modal.record, eventPayload)} /> : null}
      {modal?.mode === 'contractDocument' ? <ContractDocumentModal eventRecord={modal.record} onClose={() => setModal(null)} /> : null}
      {modal?.mode === 'commercialDetail' ? <CommercialRecordDetailModal
        kind={modal.kind}
        record={modal.record}
        state={state}
        initialSection={modal.section || 'summary'}
        onClose={() => setModal(null)}
        onEdit={() => setModal({ mode: modal.kind === 'reservation' ? 'reservations' : 'events', record: modal.record })}
        onEconomic={() => {
          if (modal.kind === 'contract') {
            setModal(null);
            setEconomicEventId(modal.record.id);
          } else {
            setModal((current) => ({ ...current, section: 'economic' }));
          }
        }}
        onGenerateContract={() => setModal({ mode: 'contractConvert', record: modal.record })}
        onOpenDocument={() => setModal({ mode: 'contractDocument', record: modal.record })}
      /> : null}
      {modal && !['economicEntry', 'payment', 'expense', 'guaranteeReturn', 'contractConvert', 'contractDocument', 'commercialDetail'].includes(modal.mode) ? <RecordModal mode={modal.mode} record={modal.record} state={state} saving={saving} onClose={() => setModal(null)} onSave={(form) => saveRecord(modal.mode, form)} /> : null}
      {isResetDialogOpen ? (
        <SystemResetPanel
          onClose={() => setIsResetDialogOpen(false)}
          onVerify={verifyLincolnResetAccess}
          onAnalyze={analyzeLincolnReset}
          onExecute={executeLincolnReset}
          onExportDatabase={exportLincolnDatabase}
          companyName="Centro de Eventos Lincoln"
          databaseFilePrefix="lincoln"
        />
      ) : null}
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
      canReset={canResetLincoln}
      userPresence={lincolnPresence}
      onOpenResetDialog={() => setIsResetDialogOpen(true)}
      onPublishUpdateNotice={onPublishUpdateNotice}
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
          {activeView === 'comercial' && economicEvent ? <EventEconomicView state={state} eventRecord={economicEvent} canReset={canResetLincoln} onBack={() => setEconomicEventId('')} onNewPayment={() => setModal({ mode: 'payment', record: economicEvent })} onNewEconomicEntry={() => setModal({ mode: 'economicEntry', record: economicEvent })} onResetEconomic={() => resetEventEconomics(economicEvent)} onVoidPayment={voidPayment} onReturnGuarantee={() => setModal({ mode: 'guaranteeReturn', record: economicEvent })} onPrintReceipt={printReceipt} /> : null}
          {activeView === 'comercial' && !economicEvent ? (
            <LincolnCommercialWorkspace
              refreshKey={snapshot?.revision}
              onNewReservation={() => setModal({ mode: 'reservations', record: null })}
              onNewContract={() => setModal({ mode: 'events', record: null })}
              onOpenRecord={(row) => {
                const record = row.kind === 'reservation'
                  ? state.reservations.find((item) => item.id === row.id)
                  : state.events.find((item) => item.id === (row.eventId || row.id));
                if (record) setModal({ mode: 'commercialDetail', kind: row.kind, record, section: 'summary' });
              }}
              onEditReservation={(row) => {
                const record = state.reservations.find((item) => item.id === row.id);
                if (record) setModal({ mode: 'reservations', record });
              }}
              onEditContract={(row) => {
                const record = state.events.find((item) => item.id === (row.eventId || row.id));
                if (record) setModal({ mode: 'events', record });
              }}
              onConvertReservation={(row) => {
                const record = state.reservations.find((item) => item.id === row.id);
                if (!record) return;
                if (toNumber(record.reservationPaymentBs) <= 0 || String(record.status ?? '').toLowerCase() === 'lead') {
                  window.alert('Esta reserva todavía está como INTERESADO. Primero concreta la reserva registrando el dinero de reserva; después podrás generar el contrato.');
                  setModal({ mode: 'reservations', record });
                  return;
                }
                setModal({ mode: 'contractConvert', record });
              }}
              onOpenDocument={(row) => {
                const record = state.events.find((item) => item.id === (row.eventId || row.id));
                if (record) setModal({ mode: 'contractDocument', record });
              }}
              onOpenEconomic={(row) => {
                if (row.kind === 'reservation') {
                  const record = state.reservations.find((item) => item.id === row.id);
                  if (record) setModal({ mode: 'commercialDetail', kind: 'reservation', record, section: 'economic' });
                  return;
                }
                setEconomicEventId(row.eventId || row.id);
              }}
              onCancelReservation={(row) => {
                const record = state.reservations.find((item) => item.id === row.id);
                if (record) void cancelReservation(record);
              }}
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
