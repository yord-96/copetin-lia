import { useEffect, useState } from 'react';
import { api } from '../../../services/api';

const money = (value) => new Intl.NumberFormat('es-BO', {
  style: 'currency', currency: 'BOB', minimumFractionDigits: 2,
}).format(Number(value ?? 0));

const dateLabel = (value) => {
  if (!value) return 'Sin fecha';
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export default function LincolnCommercialWorkspace({
  refreshKey,
  onNewReservation,
  onNewContract,
  onEditReservation,
  onEditContract,
  onConvertReservation,
  onOpenEconomic,
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState({ summary: { reservations: 0, contracts: 0, currentNumber: 0, nextNumber: 1 }, rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.lincoln.getCommercialOverview({ query, status, from, to })
        .then((next) => {
          if (cancelled) return;
          setData(next);
          setError('');
        })
        .catch((requestError) => {
          if (!cancelled) setError(requestError?.message || 'No se pudo cargar Reservas y Contratos.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [from, query, refreshKey, status, to]);

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const summary = data?.summary ?? {};

  const clearFilters = () => {
    setQuery('');
    setStatus('all');
    setFrom('');
    setTo('');
  };

  return (
    <div className="lincoln-commercial-page">
      <section className="lincoln-commercial-titlebar">
        <div>
          <h1>Reservas y Contratos</h1>
          <p>Gestión comercial de reservas, contratos y apertura económica en un solo lugar.</p>
        </div>
        <div className="lincoln-commercial-primary-actions">
          <button type="button" onClick={onNewContract}>+ Nuevo contrato</button>
          <button type="button" onClick={onNewReservation}>+ Nueva reserva</button>
        </div>
      </section>

      <section className="lincoln-commercial-card">
        <div className="lincoln-commercial-metrics">
          <button
            type="button"
            className={`lincoln-commercial-metric-card is-reservations ${status === 'reservations' ? 'is-selected' : ''}`}
            onClick={() => setStatus('reservations')}
            title="Mostrar solo reservas"
          >
            <div><strong>Reservas</strong><span>Pendientes de decisión</span></div>
            <b>{summary.reservations ?? 0}</b>
          </button>

          <article className="lincoln-commercial-metric-card is-numbering">
            <span>Numeración</span>
            <div><small>Actual</small><b>{summary.currentNumber || '—'}</b></div>
            <div><small>Siguiente</small><b>{summary.nextNumber || 1}</b></div>
          </article>

          <button
            type="button"
            className={`lincoln-commercial-metric-card is-contracts ${status === 'contracts' ? 'is-selected' : ''}`}
            onClick={() => setStatus('contracts')}
            title="Mostrar solo contratos"
          >
            <div><strong>Contratos</strong><span>Documentos comerciales</span></div>
            <b>{summary.contracts ?? 0}</b>
          </button>
        </div>

        <div className="lincoln-commercial-filters">
          <input type="search" placeholder="Buscar código, cliente, evento o salón..." value={query} onChange={(event) => setQuery(event.target.value)} />
          <label><span>Desde</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>Hasta</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <button type="button" className="is-clear" onClick={clearFilters}>Limpiar</button>
        </div>

        <div className="lincoln-commercial-statuses">
          {[
            ['all', 'Todas'], ['reservations', 'Reservas'], ['pending', 'Pendiente'], ['confirmed', 'Confirmada'],
            ['contracts', 'Contratos'], ['contract_pending', 'Contrato pendiente'], ['contracted', 'Contratado'], ['completed', 'Realizado'], ['cancelled', 'Anulado'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={status === value ? 'is-active' : ''}
              onClick={() => setStatus(value)}
              aria-pressed={status === value}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? <div className="lincoln-commercial-error">{error}</div> : null}
        <div className="lincoln-commercial-table-wrap">
          <table className="lincoln-commercial-table">
            <thead><tr><th>Código</th><th>Fecha evento</th><th>Cliente</th><th>Salón / tipo</th><th>Personas</th><th>Estado</th><th>Total</th><th>Saldo</th><th>Acciones</th></tr></thead>
            <tbody>
              {loading && !rows.length ? <tr><td colSpan="9" className="is-empty">Cargando operación comercial...</td></tr> : null}
              {!loading && !rows.length ? <tr><td colSpan="9" className="is-empty">No hay registros con estos filtros.</td></tr> : null}
              {rows.map((row) => (
                <tr key={row.key}>
                  <td><button type="button" className={`lincoln-commercial-code is-${row.kind}`} onClick={() => row.kind === 'reservation' ? onEditReservation(row) : onEditContract(row)}>{row.code}</button><small>{row.kindLabel}</small></td>
                  <td><strong>{dateLabel(row.eventDate)}</strong><small>{row.startTime || 'Hora pendiente'}</small></td>
                  <td><strong>{row.clientName || 'Sin cliente'}</strong><small>{row.clientPhone || ''}</small></td>
                  <td><strong>{row.roomName || 'Sin salón'}</strong><small>{row.eventType || 'Sin tipo'}</small></td>
                  <td>{row.guestCount || '—'}</td>
                  <td><span className={`lincoln-commercial-status is-${row.kind}`}>{row.statusLabel}</span></td>
                  <td><strong>{money(row.totalBs)}</strong></td>
                  <td>{row.kind === 'contract' ? <strong>{money(row.balanceBs)}</strong> : <span className="is-muted">—</span>}</td>
                  <td>
                    <div className="lincoln-commercial-actions">
                      <button type="button" onClick={() => row.kind === 'reservation' ? onEditReservation(row) : onEditContract(row)}>Abrir</button>
                      {row.kind === 'reservation' && !['cancelled', 'converted'].includes(row.status) ? <button type="button" className="is-primary" onClick={() => onConvertReservation(row)}>Convertir</button> : null}
                      {row.kind === 'contract' ? <button type="button" className="is-primary" onClick={() => onOpenEconomic(row)}>Economía</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
