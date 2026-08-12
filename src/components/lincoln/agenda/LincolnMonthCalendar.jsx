const WEEKDAYS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildCalendarCells = (year, month) => {
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month - 1, 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return { date, dateKey: toDateKey(date), currentMonth: date.getMonth() === month - 1 };
  });
};

export default function LincolnMonthCalendar({ year, month, title, days = {}, selectedDate, onSelectDate, onPrevious, onNext, onToday }) {
  const cells = buildCalendarCells(year, month);
  const nowKey = toDateKey(new Date());
  return (
    <section className="lincoln-agenda-surface">
      <header className="lincoln-agenda-surface-head">
        <div><span className="lincoln-agenda-eyebrow">Agenda mensual</span><h2>{title}</h2></div>
        <div className="lincoln-agenda-calendar-tools">
          <button type="button" className="is-arrow" onClick={onPrevious} aria-label="Mes anterior">‹</button>
          <button type="button" onClick={onToday}>Hoy</button>
          <button type="button" className="is-arrow" onClick={onNext} aria-label="Mes siguiente">›</button>
        </div>
      </header>
      <div className="lincoln-agenda-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="lincoln-agenda-month-grid">
        {cells.map(({ date, dateKey, currentMonth }) => {
          const records = currentMonth ? (days?.[dateKey] ?? []) : [];
          return (
            <button
              key={dateKey}
              type="button"
              className={`lincoln-agenda-day ${currentMonth ? '' : 'is-outside'} ${selectedDate === dateKey ? 'is-selected' : ''} ${nowKey === dateKey ? 'is-today' : ''}`}
              onClick={() => currentMonth && onSelectDate(dateKey)}
              disabled={!currentMonth}
            >
              <span className="lincoln-agenda-day-number">{date.getDate()}</span>
              <span className="lincoln-agenda-day-markers">
                {records.slice(0, 5).map((record) => <i key={record.key} className={`lincoln-agenda-marker is-${record.markerClass}`} title={`${record.kindLabel}: ${record.clientName || 'Sin cliente'}`} />)}
              </span>
              {records.length ? <small>{records.length} registro{records.length === 1 ? '' : 's'}</small> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
