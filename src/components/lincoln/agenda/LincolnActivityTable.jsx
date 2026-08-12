import { formatAgendaDate, getAgendaKindClass } from './agendaFormatters';

export default function LincolnActivityTable({ rows = [], selectedDate, onClearSelection }) {
  return (
    <section className="lincoln-agenda-surface lincoln-agenda-activity">
      <header className="lincoln-agenda-activity-head">
        <div><span className="lincoln-agenda-eyebrow">Actividad del mes</span><h3>{selectedDate ? `Actividad del ${formatAgendaDate(selectedDate)}` : 'Reservas, interesados y contratos'}</h3></div>
        {selectedDate ? <button type="button" className="lincoln-agenda-inline-button" onClick={onClearSelection}>Ver todo el mes</button> : null}
      </header>
      {rows.length === 0 ? <div className="lincoln-agenda-empty-state"><strong>No hay actividad para este período.</strong></div> : (
        <div className="lincoln-agenda-activity-scroll">
          <table className="lincoln-agenda-activity-table">
            <thead>
              <tr>
                <th>{selectedDate ? 'Hora' : 'Fecha'}</th>
                <th>Tipo</th>
                <th>Cliente</th>
                <th>Evento</th>
                <th>Salón</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const className = getAgendaKindClass(row);
                const firstCell = selectedDate
                  ? (row.startTime || 'Todo el día')
                  : formatAgendaDate(row.eventDate);
                return (
                  <tr key={row.key}>
                    <td><strong>{firstCell}</strong></td>
                    <td><span className={`lincoln-agenda-activity-type is-${className}`}><i />{row.kindLabel}</span></td>
                    <td>{row.clientName || '—'}</td>
                    <td>{row.eventType || '—'}</td>
                    <td>{row.roomName || '—'}</td>
                    <td><span className={`lincoln-agenda-status is-${className}`}>{row.statusLabel}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
