import { useEffect, useState } from 'react';
import { api } from '../../../services/api';
import LincolnMonthlyReport from './LincolnMonthlyReport';
import LincolnAnnualReport from './LincolnAnnualReport';
import LincolnEventReport from './LincolnEventReport';

export default function LincolnReports({ events = [], refreshKey }) {
  const [initialNow] = useState(() => new Date());
  const currentYear = initialNow.getFullYear();
  const [tab, setTab] = useState('monthly');
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(initialNow.getMonth()+1);
  const [eventId, setEventId] = useState(events[0]?.id ?? '');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const years = Array.from({ length: 5 }, (_, index) => currentYear - 2 + index);
  const effectiveEventId = eventId || events[0]?.id || '';

  useEffect(() => {
    let cancelled=false;
    const request = tab === 'annual' ? api.lincoln.getAnnualReport({ year }) : tab === 'event' ? (effectiveEventId ? api.lincoln.getEventReport({ eventId: effectiveEventId }) : Promise.resolve(null)) : api.lincoln.getMonthlyReport({ year, month });
    request.then((next)=>{if(!cancelled){setData(next);setError('');}}).catch((requestError)=>{if(!cancelled)setError(requestError?.message||'No se pudo cargar el reporte Lincoln.');}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  }, [effectiveEventId, month, refreshKey, tab, year]);

  return <div className="lincoln-phase3-view"><section className="lincoln-phase3-heading is-row"><div><small>Información consolidada</small><h2>Reportes Lincoln</h2><p>Ingresos, egresos y utilidad derivados de los movimientos reales de Caja Lincoln.</p></div><div className="lincoln-report-controls"><select value={year} onChange={(e)=>{setLoading(true);setYear(Number(e.target.value));}}>{years.map((item)=><option key={item} value={item}>{item}</option>)}</select>{tab==='monthly'?<select value={month} onChange={(e)=>{setLoading(true);setMonth(Number(e.target.value));}}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{new Date(2026,i,1).toLocaleDateString('es-BO',{month:'long'})}</option>)}</select>:null}{tab==='event'?<select value={effectiveEventId} onChange={(e)=>{setLoading(true);setEventId(e.target.value);}}><option value="">Selecciona evento</option>{events.map((event)=><option key={event.id} value={event.id}>{event.code} · {event.clientName||event.eventType}</option>)}</select>:null}</div></section><nav className="lincoln-report-tabs"><button type="button" className={tab==='monthly'?'is-active':''} onClick={()=>{setLoading(true);setTab('monthly');}}>Mensual</button><button type="button" className={tab==='annual'?'is-active':''} onClick={()=>{setLoading(true);setTab('annual');}}>Anual</button><button type="button" className={tab==='event'?'is-active':''} onClick={()=>{setLoading(true);setTab('event');}}>Por evento</button></nav>{error?<div className="lincoln-phase3-error">{error}</div>:null}{loading?<div className="lincoln-phase3-loading">Generando reporte...</div>:null}{!loading&&data&&tab==='monthly'?<LincolnMonthlyReport data={data}/>:null}{!loading&&data&&tab==='annual'?<LincolnAnnualReport data={data}/>:null}{!loading&&data&&tab==='event'?<LincolnEventReport data={data}/>:null}</div>;
}
