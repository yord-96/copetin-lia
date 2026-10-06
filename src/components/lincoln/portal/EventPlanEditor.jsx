import { useEffect, useState } from 'react';
import { portalRequest } from '../../../services/lincolnPortalApi';
import { planSections } from './portalModel';
import CroquisEditor from './CroquisEditor';

export default function EventPlanEditor({ eventId, staff = false, onExpired }) {
  const [snapshot, setSnapshot] = useState(null);
  const [plan, setPlan] = useState(null);
  const [tab, setTab] = useState('activities');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [search, setSearch] = useState('');
  const load = async () => {
    setError('');
    try {
      const value = await portalRequest(`/plan${staff ? `?eventId=${encodeURIComponent(eventId)}` : ''}`, { staff });
      setSnapshot(value); setPlan(value.plan); setDirty(false); setConflict(false);
    } catch (err) { setError(err.message); if (err.status === 401) onExpired(); }
  };
  useEffect(() => {
    let active = true;
    portalRequest(`/plan${staff ? `?eventId=${encodeURIComponent(eventId)}` : ''}`, { staff }).then((value) => {
      if (active) { setSnapshot(value); setPlan(value.plan); }
    }).catch((err) => { if (active) { setError(err.message); if (err.status === 401) onExpired(); } });
    return () => { active = false; };
  }, [eventId, staff, onExpired]);
  useEffect(() => {
    const warn = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = (value) => { setPlan(value); setDirty(true); setMessage(''); };
  const updateRow = (id, field, value) => change({ ...plan, [tab]: plan[tab].map((row) => row.id === id ? { ...row, [field]: value } : row) });
  const save = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await portalRequest('/plan', { staff, method: 'PUT', body: { eventId: snapshot.event.id, revision: snapshot.revision, plan } });
      setSnapshot({ ...snapshot, ...saved }); setPlan(saved.plan); setDirty(false); setMessage('Ficha y croquis guardados.');
    } catch (err) { setError(err.message); setConflict(err.status === 409); if (err.status === 401) onExpired(); }
    finally { setBusy(false); }
  };
  if (!plan) return <div className="lp-card">{error ? <p role="alert">{error}</p> : <p>Cargando tu evento…</p>}</div>;
  const section = planSections[tab];
  const guests = plan.guests;
  const total = guests.reduce((sum, row) => sum + Number(row.people || 1), 0);
  const confirmed = guests.filter((row) => row.status === 'Sí').reduce((sum, row) => sum + Number(row.people || 1), 0);
  const done = plan.activities.filter((row) => row.status === 'Realizado').length;
  const filtered = section ? plan[tab].filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(search.toLowerCase()))) : [];
  return <section className="lp-editor">
    <header className="lp-event-header"><div><small>Centro de Eventos Lincoln · {snapshot.event.code}</small><h2>{snapshot.event.clientName || snapshot.event.name}</h2><p>{snapshot.event.name} · {snapshot.event.date || 'Fecha por definir'} · {snapshot.event.room || 'Salón por definir'}</p></div><div className="lp-save"><span>{dirty ? 'Cambios sin guardar' : snapshot.updatedAt ? `Guardado ${new Date(snapshot.updatedAt).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}` : 'Ficha nueva'}</span><button disabled={busy || !dirty || conflict} onClick={save}>{busy ? 'Guardando…' : 'Guardar cambios'}</button><button className="lp-secondary lp-print" onClick={() => window.print()}>Imprimir</button></div></header>
    {error ? <div className="lp-error" role="alert">{error}{conflict ? <button onClick={() => { if (window.confirm('Se descartarán tus cambios sin guardar y se cargará la última versión. ¿Continuar?')) load(); }}>Recargar ficha</button> : null}</div> : null}
    {message ? <p role="status" className="lp-success">{message}</p> : null}
    <div className="lp-stats"><article><strong>{done}/{plan.activities.length}</strong><span>Actividades realizadas</span></article><article><strong>{total}</strong><span>Personas invitadas</span></article><article><strong>{confirmed}</strong><span>Personas confirmadas</span></article><article><strong>{plan.suppliers.filter((row) => row.status === 'Confirmado').length}/{plan.suppliers.length}</strong><span>Proveedores confirmados</span></article></div>
    <nav className="lp-tabs" aria-label="Secciones del evento">{[...Object.entries(planSections).map(([id, item]) => [id, item.label]), ['layout', 'Croquis del salón'], ['notes', 'Notas generales']].map(([id, label]) => <button key={id} onClick={() => { setTab(id); setSearch(''); }} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'is-active' : ''}>{label}</button>)}</nav>
    <div className="lp-card lp-tab-content" inert={busy}>
      {tab === 'layout' ? <CroquisEditor layout={plan.layout} onChange={(layout) => change({ ...plan, layout })} /> : tab === 'notes' ? <label>Indicaciones generales del evento<textarea rows="12" maxLength="10000" value={plan.notes} onChange={(e) => change({ ...plan, notes: e.target.value })} /></label> : <>
        <div className="lp-table-toolbar"><div><h3>{section.label}</h3><p>{plan[tab].length} registros{tab === 'guests' ? ' · Personas incluye acompañantes y niños' : ''}</p></div><input aria-label="Buscar registros" placeholder="Buscar en esta sección…" value={search} onChange={(e) => setSearch(e.target.value)} /><button disabled={busy || plan[tab].length >= 2000} onClick={() => change({ ...plan, [tab]: [...plan[tab], { id: crypto.randomUUID(), ...Object.fromEntries(section.fields.map(([field, , kind]) => [field, Array.isArray(kind) ? kind[0] : kind === 'number' ? field === 'people' ? 1 : 0 : ''])) }] })}>+ Agregar</button></div>
        <div className="lp-table-wrap"><table><thead><tr>{section.fields.map(([id, label]) => <th key={id}>{label}</th>)}<th>Acción</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}>{section.fields.map(([field, label, kind]) => <td key={field}>{Array.isArray(kind) ? <select disabled={busy} aria-label={label} value={row[field] || kind[0]} onChange={(e) => updateRow(row.id, field, e.target.value)}>{kind.map((option) => <option key={option}>{option}</option>)}</select> : kind === 'number' ? <input disabled={busy} aria-label={label} type="number" min={field === 'people' ? 1 : 0} max="10000" value={row[field] ?? 0} onChange={(e) => updateRow(row.id, field, Number(e.target.value))} /> : <textarea disabled={busy} rows="2" aria-label={label} maxLength="3000" value={row[field] || ''} onChange={(e) => updateRow(row.id, field, e.target.value)} />}</td>)}<td><button disabled={busy} className="lp-delete" aria-label="Eliminar fila" onClick={() => { if (window.confirm('¿Eliminar este registro?')) change({ ...plan, [tab]: plan[tab].filter((item) => item.id !== row.id) }); }}>Eliminar</button></td></tr>)}</tbody></table></div>
        {!filtered.length ? <div className="lp-empty"><h3>{search ? 'Sin resultados' : 'Todavía no hay registros'}</h3><p>{search ? 'Prueba con otro texto.' : 'Agrega los detalles que necesitas coordinar para tu evento.'}</p></div> : null}
      </>}
    </div>
  </section>;
}
