import { LINCOLN_AGENDA_MONTHS } from './agendaFormatters';

const SERIES = [
  ['interested', 'interested', 'Interesados'],
  ['reservations', 'reservation', 'Reservas'],
  ['events', 'event', 'Contratos / eventos'],
];

export default function LincolnAnnualRadar({ year, months = [], onYearChange }) {
  const values = Array.from({ length: 12 }, (_, index) => months[index] ?? { month: index + 1, interested: 0, reservations: 0, events: 0 });
  const maxValue = Math.max(1, ...values.flatMap((row) => [Number(row.interested ?? 0), Number(row.reservations ?? 0), Number(row.events ?? 0)]));
  const center = 180;
  const radius = 116;
  const labelRadius = 148;
  const gridScales = [0.2, 0.4, 0.6, 0.8, 1];
  const coordinate = (index, scale) => {
    const angle = ((Math.PI * 2 * index) / 12) - (Math.PI / 2);
    return [center + Math.cos(angle) * radius * scale, center + Math.sin(angle) * radius * scale];
  };
  const pointForValue = (index, value) => coordinate(index, Number(value ?? 0) / maxValue);
  const polygon = (key) => values.map((row, index) => pointForValue(index, row[key]).join(',')).join(' ');
  const gridPolygon = (scale) => Array.from({ length: 12 }, (_, index) => coordinate(index, scale).join(',')).join(' ');
  const yearOptions = Array.from({ length: 7 }, (_, index) => year - 3 + index);
  return (
    <section className="lincoln-agenda-surface lincoln-agenda-radar-card">
      <div className="lincoln-agenda-radar-head">
        <h3>Movimiento anual {year}</h3>
        <select className="lincoln-agenda-year-select" value={year} onChange={(event) => onYearChange(Number(event.target.value))} aria-label="Año del radar">
          {yearOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
      <div className="lincoln-agenda-radar-wrap">
        <svg className="lincoln-agenda-radar" viewBox="0 0 360 360" role="img" aria-label={`Radar anual de actividad Lincoln ${year}`}>
          {gridScales.map((scale) => <polygon key={scale} className="radar-grid" points={gridPolygon(scale)} />)}
          {Array.from({ length: 12 }, (_, index) => {
            const [x, y] = coordinate(index, 1);
            return <line key={index} className="radar-axis" x1={center} y1={center} x2={x} y2={y} />;
          })}
          {SERIES.map(([key, className]) => <polygon key={key} className={`radar-series is-${className}`} points={polygon(key)} />)}
          {SERIES.flatMap(([key, className]) => values.map((row, index) => {
            const value = Number(row[key] ?? 0);
            if (value <= 0) return null;
            const [x, y] = pointForValue(index, value);
            return (
              <g key={`${key}-${index}`} className={`radar-point is-${className}`}>
                <circle className={`radar-dot is-${className}`} cx={x} cy={y} r="4.2">
                  <title>{`${LINCOLN_AGENDA_MONTHS[index]} · ${value}`}</title>
                </circle>
                <text className={`radar-value is-${className}`} x={x} y={y - 9} textAnchor="middle">{value}</text>
              </g>
            );
          }))}
          {LINCOLN_AGENDA_MONTHS.map((label, index) => {
            const angle = ((Math.PI * 2 * index) / 12) - (Math.PI / 2);
            const x = center + Math.cos(angle) * labelRadius;
            const y = center + Math.sin(angle) * labelRadius + 4;
            return <text key={label} className="radar-month" x={x} y={y} textAnchor="middle">{label}</text>;
          })}
        </svg>
      </div>
    </section>
  );
}
