import { formatAgendaDate, getAgendaKindClass } from './agendaFormatters';

export default function LincolnDayDetail({ selectedDate, records = [] }) {
  return (
    <section className="lincoln-agenda-surface lincoln-agenda-detail">
      <div className="lincoln-agenda-section-title"><span className="lincoln-agenda-eyebrow">Detalle del día seleccionado</span></div>
      <div className="lincoln-agenda-detail-date">▣ {selectedDate ? formatAgendaDate(selectedDate, { weekday: true, longMonth: true }) : 'Selecciona un día del calendario'}</div>
      {!selectedDate || records.length === 0 ? (
        <div className="lincoln-agenda-empty-state lincoln-agenda-empty-state--day">
          <svg className="lincoln-agenda-empty-illustration" viewBox="0 0 84 84" aria-hidden="true">
            <rect x="19" y="24" width="46" height="42" rx="8" fill="#f9dadd" />
            <rect x="19" y="24" width="46" height="12" rx="8" fill="#d65a66" />
            <rect x="27" y="16" width="5" height="16" rx="2.5" fill="#8a2a34" />
            <rect x="52" y="16" width="5" height="16" rx="2.5" fill="#8a2a34" />
            <path d="M29 47h26M29 55h18" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".95" />
          </svg>
          <div>
            <strong>No hay registros para este día.</strong>
            <span>{selectedDate ? 'Selecciona otra fecha o registra una nueva actividad.' : 'Selecciona un día del calendario para ver su actividad.'}</span>
          </div>
        </div>
      ) : (
        <div className="lincoln-agenda-day-list">
          {records.map((record) => {
            const className = getAgendaKindClass(record);
            return (
              <article key={record.key} className="lincoln-agenda-day-record">
                <i className={`lincoln-agenda-record-dot is-${className}`} />
                <div><strong>{record.eventType || record.kindLabel}</strong><small>{record.clientName || 'Sin cliente'} · {record.roomName || 'Salón pendiente'} {record.startTime ? `· ${record.startTime}` : ''}</small></div>
                <span className={`lincoln-agenda-status is-${className}`}>{record.statusLabel}</span>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
