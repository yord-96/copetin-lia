import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../services/api';
import LincolnActivityTable from './LincolnActivityTable';
import LincolnAgendaSummary from './LincolnAgendaSummary';
import LincolnAnnualRadar from './LincolnAnnualRadar';
import LincolnDayDetail from './LincolnDayDetail';
import LincolnMonthCalendar from './LincolnMonthCalendar';
import LincolnUpcomingEvents from './LincolnUpcomingEvents';
import { formatAgendaMonthTitle } from './agendaFormatters';

const todayParts = () => {
  const today = new Date();
  return { year: today.getFullYear(), month: today.getMonth() + 1 };
};

export default function LincolnAgenda() {
  const today = todayParts();
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [selectedDate, setSelectedDate] = useState('');
  const [monthData, setMonthData] = useState(null);
  const [yearData, setYearData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      api.lincoln.getAgendaMonth({ year, month }),
      api.lincoln.getAgendaYear({ year }),
    ])
      .then(([nextMonthData, nextYearData]) => {
        if (cancelled) return;
        setMonthData(nextMonthData);
        setYearData(nextYearData);
      })
      .catch((requestError) => {
        if (cancelled) return;
        setError(requestError?.message || 'No se pudo cargar la agenda Lincoln.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [month, reloadToken, year]);

  const goMonth = (delta) => {
    const next = new Date(year, month - 1 + delta, 1);
    setLoading(true);
    setError('');
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
    setSelectedDate('');
  };

  const goToday = () => {
    const current = todayParts();
    setLoading(true);
    setError('');
    setYear(current.year);
    setMonth(current.month);
    setSelectedDate('');
  };

  const selectedRecords = useMemo(
    () => (selectedDate ? (monthData?.days?.[selectedDate] ?? []) : []),
    [monthData?.days, selectedDate],
  );
  const activityRows = useMemo(
    () => (selectedDate ? selectedRecords : (monthData?.activity ?? [])),
    [monthData?.activity, selectedDate, selectedRecords],
  );
  const monthTitle = formatAgendaMonthTitle(year, month);

  if (loading && !monthData) return <div className="lincoln-agenda-view"><div className="lincoln-agenda-loading">Cargando agenda Lincoln…</div></div>;
  if (error && !monthData) return <div className="lincoln-agenda-view"><div className="lincoln-agenda-error"><div><strong>No se pudo cargar la agenda.</strong><div>{error}</div><button
          type="button"
          onClick={() => {
            setLoading(true);
            setError('');
            setReloadToken((value) => value + 1);
          }}
        >
          Reintentar
        </button></div></div></div>;

  return (
    <div className="lincoln-agenda-view">
      {error ? <div className="lincoln-db-error">{error}</div> : null}
      <div className="lincoln-agenda-layout">
        <div className="lincoln-agenda-main-column">
          <LincolnMonthCalendar
            year={year}
            month={month}
            title={monthTitle}
            days={monthData?.days ?? {}}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onPrevious={() => goMonth(-1)}
            onNext={() => goMonth(1)}
            onToday={goToday}
          />
          <LincolnActivityTable rows={activityRows} selectedDate={selectedDate} onClearSelection={() => setSelectedDate('')} />
        </div>
        <aside className="lincoln-agenda-side-column">
          <LincolnAgendaSummary summary={monthData?.summary ?? {}} monthTitle={monthTitle} />
          <LincolnAnnualRadar
            year={year}
            months={yearData?.months ?? []}
            onYearChange={(nextYear) => {
              setLoading(true);
              setError('');
              setYear(nextYear);
              setSelectedDate('');
            }}
          />
          <LincolnDayDetail selectedDate={selectedDate} records={selectedRecords} />
          <LincolnUpcomingEvents events={monthData?.upcomingEvents ?? []} />
        </aside>
      </div>
    </div>
  );
}
