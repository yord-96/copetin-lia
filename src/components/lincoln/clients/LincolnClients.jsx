import { useEffect, useState } from 'react';
import { api } from '../../../services/api';
import LinconIcon from '../shared/LinconIcon';
import '../styles/lincoln-clients.css';

const formatBs = (value) => new Intl.NumberFormat('es-BO', {
  style: 'currency',
  currency: 'BOB',
  minimumFractionDigits: 2,
}).format(Number(value ?? 0));

const formatDate = (value) => {
  if (!value) return '—';
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const initials = (name) => String(name ?? '')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase() || 'CL';

function Metric({ icon, value, label, tone = 'wine' }) {
  return (
    <article className={`lincoln-client-metric is-${tone}`}>
      <span className="lincoln-client-metric-icon"><LinconIcon name={icon} /></span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </article>
  );
}

export default function LincolnClients({ refreshKey, onNew, onEdit }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState({ summary: {}, rows: [] });

  useEffect(() => {
    let cancelled = false;

    api.lincoln.getClientsOverview({ query, status })
      .then((response) => {
        if (cancelled) return;
        setData(response ?? { summary: {}, rows: [] });
        setError('');
      })
      .catch((requestError) => {
        if (cancelled) return;
        setError(requestError?.message || 'No se pudo cargar Clientes Lincoln.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, refreshKey, status]);

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const summary = data?.summary ?? {};

  const handleQueryChange = (event) => {
    setLoading(true);
    setQuery(event.target.value);
  };

  const handleStatusChange = (event) => {
    setLoading(true);
    setStatus(event.target.value);
  };

  const openWhatsApp = (phone) => {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!digits || typeof window === 'undefined') return;
    window.open(`https://wa.me/591${digits}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="lincoln-clients-view">
      <header className="lincoln-clients-heading">
        <div>
          <h1>Clientes</h1>
          <p>Gestiona la base comercial de Lincoln y consulta su historial de eventos.</p>
        </div>
        <button type="button" className="lincoln-clients-new" onClick={onNew}>+ Nuevo cliente</button>
      </header>

      <section className="lincoln-client-metrics">
        <Metric icon="users" value={summary.totalClients ?? 0} label="Clientes registrados" />
        <Metric icon="wallet" value={formatBs(summary.incomeThisMonthBs ?? 0)} label="Ingresos este mes" tone="green" />
        <Metric icon="calendar" value={summary.activeEvents ?? 0} label="Eventos activos" tone="blue" />
        <Metric icon="star" value={summary.newClientsThisMonth ?? 0} label="Clientes nuevos este mes" tone="gold" />
      </section>

      <section className="lincoln-clients-card">
        <div className="lincoln-clients-filters">
          <label className="lincoln-clients-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={handleQueryChange}
              placeholder="Buscar por nombre, C.I., teléfono, correo o código..."
            />
          </label>
          <select value={status} onChange={handleStatusChange} aria-label="Filtrar clientes por estado">
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
        </div>

        {error ? <div className="lincoln-clients-error">{error}</div> : null}

        <div className="lincoln-clients-table-wrap">
          <table className="lincoln-clients-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contacto</th>
                <th>WhatsApp / celular</th>
                <th>Referencia</th>
                <th>Email</th>
                <th>Eventos</th>
                <th>Último evento</th>
                <th>Ingreso</th>
                <th>Estado</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {!loading && !rows.length ? (
                <tr>
                  <td colSpan="10" className="lincoln-clients-empty">
                    No hay clientes que coincidan con estos filtros.
                  </td>
                </tr>
              ) : null}

              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="lincoln-client-main">
                      <span className="lincoln-client-avatar">{initials(row.name)}</span>
                      <div>
                        <strong>{row.name || 'Sin nombre'}</strong>
                        <small>{row.code || 'Sin código'}{row.ci ? ` · C.I. ${row.ci}` : ''}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="lincoln-client-contact">
                      <strong>{row.name || '—'}</strong>
                      <small>Contacto principal</small>
                    </div>
                  </td>
                  <td>
                    {row.phone ? (
                      <button type="button" className="lincoln-client-phone" onClick={() => openWhatsApp(row.phone)}>
                        {row.phone}<span>WA</span>
                      </button>
                    ) : '—'}
                  </td>
                  <td>{row.secondaryPhone || '—'}</td>
                  <td>{row.email || '—'}</td>
                  <td><span className="lincoln-client-count">{row.eventCount ?? 0}</span></td>
                  <td>
                    <div className="lincoln-client-last-event">
                      <strong>{formatDate(row.lastEventDate)}</strong>
                      <small>{row.lastEventType || '—'}</small>
                    </div>
                  </td>
                  <td><strong>{formatBs(row.incomeBs ?? 0)}</strong></td>
                  <td>
                    <span className={`lincoln-client-status is-${row.status}`}>
                      {row.status === 'inactive' ? 'Inactivo' : 'Activo'}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="lincoln-client-more" onClick={() => onEdit?.(row)} title="Editar cliente">
                      ⋮
                    </button>
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
