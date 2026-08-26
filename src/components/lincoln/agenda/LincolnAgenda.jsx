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

const EMPTY_MEETINGS = [];

const todayKey = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const meetingStatusLabel = (status) => ({
  scheduled: 'Programada',
  pending_followup: 'Seguimiento pendiente',
  completed: 'Realizada',
  cancelled: 'Cancelada',
}[String(status ?? '').toLowerCase()] ?? 'Programada');

const meetingToAgendaRecord = (meeting) => {
  const status = String(meeting?.status ?? 'scheduled').toLowerCase();
  return {
    key: `meeting:${meeting.id}`,
    id: meeting.id,
    kind: 'meeting',
    kindLabel: 'Reunión',
    markerClass: status === 'cancelled' ? 'cancelled' : 'reservation',
    eventDate: String(meeting.date ?? '').slice(0, 10),
    startTime: meeting.time ?? '',
    clientName: meeting.clientName ?? '',
    eventType: meeting.subject || meeting.eventType || 'Reunión',
    roomName: meeting.location || meeting.roomName || 'Centro de Eventos Lincoln',
    status,
    statusLabel: meetingStatusLabel(status),
    isCancelled: status === 'cancelled',
    responsibleName: meeting.responsibleName ?? '',
    sourceCode: meeting.sourceCode ?? '',
    nextActions: meeting.nextActions ?? '',
    nextFollowUpDate: meeting.nextFollowUpDate ?? '',
  };
};

export default function LincolnAgenda({ state }) {
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

  const stateMeetings = state?.meetings;
  const meetings = useMemo(
    () => (Array.isArray(stateMeetings) ? stateMeetings : EMPTY_MEETINGS),
    [stateMeetings],
  );

  const monthMeetingRecords = useMemo(() => meetings
    .map(meetingToAgendaRecord)
    .filter((row) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.eventDate)) return false;
      return Number(row.eventDate.slice(0, 4)) === Number(year)
        && Number(row.eventDate.slice(5, 7)) === Number(month);
    }), [meetings, month, year]);

  const mergedDays = useMemo(() => {
    const next = Object.fromEntries(
      Object.entries(monthData?.days ?? {}).map(([date, rows]) => [date, [...rows]]),
    );
    monthMeetingRecords.forEach((record) => {
      if (!next[record.eventDate]) next[record.eventDate] = [];
      next[record.eventDate].push(record);
      next[record.eventDate].sort((a, b) => String(a.startTime ?? '').localeCompare(String(b.startTime ?? '')));
    });
    return next;
  }, [monthData?.days, monthMeetingRecords]);

  const mergedActivity = useMemo(() => [
    ...(monthData?.activity ?? []),
    ...monthMeetingRecords,
  ].sort((a, b) => `${a.eventDate ?? ''} ${a.startTime ?? ''}`.localeCompare(`${b.eventDate ?? ''} ${b.startTime ?? ''}`)), [monthData?.activity, monthMeetingRecords]);

  const upcomingRows = useMemo(() => {
    const currentDate = todayKey();
    const futureMeetings = meetings
      .map(meetingToAgendaRecord)
      .filter((row) => row.eventDate >= currentDate && !row.isCancelled);
    return [
      ...(monthData?.upcomingEvents ?? []),
      ...futureMeetings,
    ]
      .filter((row, index, all) => all.findIndex((candidate) => candidate.key === row.key) === index)
      .sort((a, b) => `${a.eventDate ?? ''} ${a.startTime ?? ''}`.localeCompare(`${b.eventDate ?? ''} ${b.startTime ?? ''}`))
      .slice(0, 8);
  }, [meetings, monthData?.upcomingEvents]);

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
    () => (selectedDate ? (mergedDays[selectedDate] ?? []) : []),
    [mergedDays, selectedDate],
  );
  const activityRows = useMemo(
    () => (selectedDate ? selectedRecords : mergedActivity),
    [mergedActivity, selectedDate, selectedRecords],
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
            days={mergedDays}
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
          <LincolnUpcomingEvents events={upcomingRows} />
        </aside>
      </div>
    </div>
  );
}
