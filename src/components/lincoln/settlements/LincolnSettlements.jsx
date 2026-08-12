import { useEffect, useState } from 'react';
import { api } from '../../../services/api';
import LincolnSettlementSummary from './LincolnSettlementSummary';
import LincolnSettlementTable from './LincolnSettlementTable';
import LincolnSettlementDetail from './LincolnSettlementDetail';

export default function LincolnSettlements({ refreshKey, revision, actor, onNewExpense }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [payload, setPayload] = useState({ rows: [], summary: {} });
  const [selectedEventId, setSelectedEventId] = useState('');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.lincoln.getSettlements({ year, status, query }).then((next) => { if (!cancelled) { setPayload(next); setError(''); } }).catch((requestError) => { if (!cancelled) setError(requestError?.message || 'No se pudieron cargar las rendiciones.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, refreshKey, reload, status, year]);

  useEffect(() => {
    if (!selectedEventId) return undefined;
    let cancelled = false;
    api.lincoln.getSettlementDetail({ eventId: selectedEventId }).then((next) => { if (!cancelled) setDetail(next); }).catch((requestError) => { if (!cancelled) setError(requestError?.message || 'No se pudo cargar la rendición.'); });
    return () => { cancelled = true; };
  }, [refreshKey, reload, selectedEventId]);

  const years = Array.from({ length: 5 }, (_, index) => String(currentYear - 2 + index));
  const toggleStatus = async (nextStatus) => {
    const currentRevision = detail?.revision || payload?.revision || revision;
    if (!selectedEventId || !currentRevision) return;
    setSaving(true);
    try {
      await api.lincoln.setSettlementStatus({ eventId: selectedEventId, settlement: { status: nextStatus }, revision: currentRevision, actor });
      setReload((value) => value + 1);
    } catch (requestError) {
      setError(requestError?.message || 'No se pudo actualizar la rendición.');
    } finally { setSaving(false); }
  };

  if (selectedEventId && detail) return <LincolnSettlementDetail detail={detail} saving={saving} onBack={() => { setDetail(null); setSelectedEventId(''); }} onNewExpense={() => onNewExpense(selectedEventId)} onToggleStatus={toggleStatus}/>;

  return <div className="lincoln-phase3-view"><section className="lincoln-phase3-heading"><div><small>Control por evento</small><h2>Rendiciones</h2><p>Ingresos, costos y utilidad de cada evento, sin mezclar garantías con la operación.</p></div></section><LincolnSettlementSummary summary={payload.summary}/><section className="lincoln-phase3-card"><div className="lincoln-phase3-toolbar"><div className="lincoln-phase3-search"><input type="search" placeholder="Buscar evento, cliente, salón..." value={query} onChange={(event) => setQuery(event.target.value)}/></div><select value={year} onChange={(event) => { setLoading(true); setYear(event.target.value); }}><option value="">Todos los años</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={status} onChange={(event) => { setLoading(true); setStatus(event.target.value); }}><option value="all">Todas</option><option value="open">Abiertas</option><option value="closed">Cerradas</option></select></div>{error ? <div className="lincoln-phase3-error">{error}</div> : null}{loading ? <div className="lincoln-phase3-loading">Cargando rendiciones...</div> : <LincolnSettlementTable rows={payload.rows} onOpen={setSelectedEventId}/>}</section></div>;
}
