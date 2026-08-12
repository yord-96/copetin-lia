import LinconIcon from '../shared/LinconIcon';

function SummaryCard({ className, value, label, icon }) {
  return (
    <article className={`lincoln-agenda-summary-card ${className}`}>
      <span className="lincoln-agenda-summary-icon" aria-hidden="true">
        <LinconIcon name={icon} />
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </article>
  );
}

export default function LincolnAgendaSummary({ summary, monthTitle }) {
  return (
    <section className="lincoln-agenda-surface lincoln-agenda-summary">
      <div className="lincoln-agenda-section-title">
        <h3>Resumen de {monthTitle}</h3>
      </div>
      <div className="lincoln-agenda-summary-grid">
        <SummaryCard className="is-interested" value={summary?.interested ?? 0} label="Interesados" icon="users" />
        <SummaryCard className="is-reservation" value={summary?.reservations ?? 0} label="Reservas pendientes" icon="bookmark" />
        <SummaryCard className="is-event" value={summary?.events ?? 0} label="Eventos / contratos" icon="calendar" />
      </div>
    </section>
  );
}
