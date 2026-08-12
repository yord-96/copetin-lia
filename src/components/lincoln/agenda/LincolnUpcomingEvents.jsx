const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

export default function LincolnUpcomingEvents({ events = [] }) {
  return (
    <section className="lincoln-agenda-surface lincoln-agenda-upcoming">
      <div className="lincoln-agenda-section-title"><span className="lincoln-agenda-eyebrow">Próximos eventos</span></div>
      {events.length === 0 ? <div className="lincoln-agenda-empty-state"><strong>No hay eventos próximos.</strong></div> : (
        <div className="lincoln-agenda-upcoming-list">
          {events.map((event) => {
            const date = new Date(`${event.eventDate}T12:00:00`);
            return (
              <article className="lincoln-agenda-upcoming-row" key={event.key}>
                <div className="lincoln-agenda-upcoming-date"><strong>{String(date.getDate()).padStart(2, '0')}</strong><small>{MONTHS[date.getMonth()]}</small></div>
                <div className="lincoln-agenda-upcoming-copy"><strong>{event.eventType || 'Evento'}</strong><small>{event.clientName || 'Sin cliente'} · {event.roomName || 'Salón pendiente'}</small></div>
                <span className="lincoln-agenda-status is-event">{event.statusLabel}</span>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
