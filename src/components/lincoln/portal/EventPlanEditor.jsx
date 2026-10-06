import { createElement, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, ClipboardList, FileCheck2, LayoutDashboard, ListChecks, MapPin, NotebookPen, Printer, Save, Shapes, Truck, UsersRound } from 'lucide-react';
import { portalRequest } from '../../../services/lincolnPortalApi';
import { planSections } from './portalModel';
import CroquisEditor from './CroquisEditor';

const sections = [
  { id: 'overview', label: 'Resumen del evento', icon: LayoutDashboard },
  { id: 'activities', label: 'Actividades', icon: ListChecks },
  { id: 'review', label: 'Revisión de proveedores', icon: ClipboardList },
  { id: 'confirmations', label: 'Especificaciones', icon: FileCheck2 },
  { id: 'protocol', label: 'Protocolo', icon: CalendarDays },
  { id: 'guests', label: 'Invitados', icon: UsersRound },
  { id: 'suppliers', label: 'Proveedores', icon: Truck },
  { id: 'layout', label: 'Croquis del salón', icon: Shapes },
  { id: 'notes', label: 'Notas generales', icon: NotebookPen },
];
const dateLabel = (value) => value ? new Intl.DateTimeFormat('es-BO', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : 'Fecha por definir';

function CroquisPreview({ layout }) {
  return <svg className="lp-croquis-preview" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-label="Vista previa del croquis guardado en la ficha">
    <rect width={layout.width} height={layout.height} fill="#f4f7f1" />
    {layout.objects.map((item) => <g key={item.id} transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}>
      {['round', 'cocktail'].includes(item.type) ? <ellipse rx={item.width / 2} ry={item.height / 2} fill="#fff" stroke="#809679" strokeWidth="3" /> : <rect x={-item.width / 2} y={-item.height / 2} width={item.width} height={item.height} fill={item.type === 'dance' ? '#faf5ed' : '#e9efe5'} stroke="#809679" strokeWidth="3" />}
      <text textAnchor="middle" dominantBaseline="middle" fontSize="16" fill="#6d8260">{item.type === 'chair' ? '' : item.label.slice(0, 24)}</text>
    </g>)}
  </svg>;
}

export default function EventPlanEditor({ eventId, staff = false, onExpired, onBack, backLabel = 'Portal de eventos' }) {
  const [snapshot, setSnapshot] = useState(null);
  const [plan, setPlan] = useState(null);
  const [tab, setTab] = useState('overview');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [search, setSearch] = useState('');
  const contentRef = useRef(null);
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
  const openSection = (id) => { setTab(id); setSearch(''); contentRef.current?.scrollTo({ top: 0, left: 0 }); };
  const goBack = () => {
    if (dirty && !window.confirm('Hay cambios sin guardar. ¿Quieres salir de la planificación y descartarlos?')) return;
    onBack?.();
  };
  const save = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await portalRequest('/plan', { staff, method: 'PUT', body: { eventId: snapshot.event.id, revision: snapshot.revision, plan } });
      setSnapshot({ ...snapshot, ...saved }); setPlan(saved.plan); setDirty(false); setMessage('Ficha y croquis guardados.');
    } catch (err) { setError(err.message); setConflict(err.status === 409); if (err.status === 401) onExpired(); }
    finally { setBusy(false); }
  };
  if (!plan) return <div className="lp-planner-loading"><div className="lp-brand"><small>Centro de Eventos</small><strong>LINCOLN</strong></div><h2>{error ? 'No se pudo abrir el evento' : 'Abriendo planificación…'}</h2>{error ? <p role="alert">{error}</p> : <p>Estamos preparando tu espacio de trabajo.</p>}{onBack ? <button className="lp-secondary" onClick={onBack}><ArrowLeft size={16} /> {backLabel}</button> : null}</div>;
  const section = planSections[tab];
  const current = sections.find((item) => item.id === tab);
  const total = plan.guests.reduce((sum, row) => sum + Number(row.people || 1), 0);
  const confirmed = plan.guests.filter((row) => row.status === 'Sí').reduce((sum, row) => sum + Number(row.people || 1), 0);
  const done = plan.activities.filter((row) => row.status === 'Realizado').length;
  const completedSuppliers = plan.suppliers.filter((row) => row.status === 'Confirmado').length;
  const progress = plan.activities.length ? Math.round(done / plan.activities.length * 100) : 0;
  const filtered = section ? plan[tab].filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(search.toLowerCase()))) : [];
  const pending = plan.activities.filter((row) => row.status !== 'Realizado');
  const tables = plan.layout.objects.filter((item) => ['round', 'rectangle', 'square', 'cocktail', 'main'].includes(item.type)).length;
  const seats = plan.layout.objects.reduce((sum, item) => sum + Number(item.seats || 0), 0);
  return <section className="lp-editor lp-workspace" aria-label="Espacio de planificación">
    <aside className="lp-workspace-sidebar">
      <div className="lp-brand"><small>Centro de Eventos</small><strong>LINCOLN</strong></div>
      {onBack ? <button className="lp-workspace-back" disabled={busy} onClick={goBack}><ArrowLeft size={16} /><span>{backLabel}</span></button> : null}
      <div className="lp-workspace-event"><span>PLANIFICACIÓN DEL EVENTO</span><strong>{snapshot.event.clientName || snapshot.event.name}</strong><small>{snapshot.event.code}</small></div>
      <nav className="lp-workspace-nav" aria-label="Secciones del evento">{sections.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => openSection(id)} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'is-active' : ''}>{createElement(Icon, { size: 18 })}<span>{label}</span>{plan[id] && Array.isArray(plan[id]) ? <small>{plan[id].length}</small> : null}</button>)}</nav>
      <div className="lp-workspace-sidebar-foot"><span className="lp-live-dot" /><div><strong>{staff ? 'Vista de coordinación' : 'Mi evento'}</strong><small>Ficha compartida con Lincoln</small></div></div>
    </aside>
    <div className="lp-workspace-main">
      <header className="lp-workspace-header"><div className="lp-workspace-heading"><div className="lp-breadcrumb">Planificación <span>/</span> {current.label}</div><h1>{snapshot.event.clientName || snapshot.event.name}</h1><div className="lp-event-meta"><span><CalendarDays size={14} />{dateLabel(snapshot.event.date)}</span><span><MapPin size={14} />{snapshot.event.room || 'Salón por definir'}</span><span>{snapshot.event.name}</span></div></div><div className="lp-workspace-actions"><span className={`lp-save-state ${dirty ? 'is-dirty' : ''}`} role="status">{dirty ? <><span /> Cambios sin guardar</> : <><Check size={14} /> {snapshot.updatedAt ? 'Todo guardado' : 'Ficha nueva'}</>}</span><button className="lp-save-button" disabled={busy || !dirty || conflict} onClick={save}><Save size={16} />{busy ? 'Guardando…' : 'Guardar cambios'}</button><button aria-label="Imprimir sección" title="Imprimir sección" className="lp-secondary lp-print" onClick={() => window.print()}><Printer size={17} /></button></div></header>
      <div ref={contentRef} className={`lp-workspace-content ${tab === 'layout' ? 'is-croquis' : ''}`}>
        {error ? <div className="lp-error" role="alert">{error}{conflict ? <button onClick={() => { if (window.confirm('Se descartarán tus cambios sin guardar y se cargará la última versión. ¿Continuar?')) load(); }}>Recargar ficha</button> : null}</div> : null}
        {message ? <p role="status" className="lp-success">{message}</p> : null}
        {tab === 'overview' ? <>
          <div className="lp-overview-intro"><div><small>VISTA GENERAL</small><h2>Así va tu evento</h2><p>Revisa los pendientes y continúa con la planificación.</p></div><div className="lp-progress-ring" style={{ '--progress': `${progress}%` }}><strong>{progress}%</strong><span>Actividades</span></div></div>
          <div className="lp-overview-stats">{[
            ['activities', ListChecks, `${done}/${plan.activities.length}`, 'Actividades realizadas'], ['guests', UsersRound, total, 'Personas invitadas'],
            ['guests', FileCheck2, confirmed, 'Personas confirmadas'], ['suppliers', Truck, `${completedSuppliers}/${plan.suppliers.length}`, 'Proveedores confirmados'],
          ].map(([id, Icon, value, label]) => <button key={label} className="lp-overview-stat" onClick={() => openSection(id)}>{createElement(Icon, { size: 19 })}<strong>{value}</strong><span>{label}</span></button>)}</div>
          <div className="lp-overview-columns"><article className="lp-overview-card lp-pending-card"><header><div><h3>Actividades pendientes</h3><p>{pending.length ? `${pending.length} actividades por completar` : 'Todas las actividades están realizadas'}</p></div><button className="lp-text-button" onClick={() => openSection('activities')}>Ver todas <ArrowUpRight size={15} /></button></header><div className="lp-pending-list">{pending.slice(0, 5).map((row) => <button key={row.id} onClick={() => openSection('activities')}><span className="lp-task-marker" /><div><strong>{row.activity || 'Actividad sin nombre'}</strong><small>{row.category || 'General'} · {row.responsible || 'Responsable por definir'}</small></div><span className="lp-task-state">{row.status || 'Pendiente'}</span></button>)}{!pending.length ? <p className="lp-empty">Puedes agregar nuevas actividades desde su sección.</p> : null}</div></article>
            <article className="lp-overview-card lp-layout-preview"><div className="lp-layout-illustration">{plan.layout.objects.length ? <CroquisPreview layout={plan.layout} /> : <div aria-hidden="true"><div className="lp-mini-stage">ESCENARIO</div><div className="lp-mini-table t1" /><div className="lp-mini-table t2" /><div className="lp-mini-floor">PISTA</div><div className="lp-mini-table t3" /><div className="lp-mini-table t4" /></div>}</div><div><small>DISTRIBUCIÓN DEL SALÓN</small><h3>{plan.layout.objects.length ? 'Tu propuesta de montaje' : 'Diseña el montaje'}</h3><p>{tables} {tables === 1 ? 'mesa' : 'mesas'} · {seats} plazas previstas</p><button onClick={() => openSection('layout')}>Abrir croquis <ArrowUpRight size={16} /></button></div></article>
          </div>
          <div className="lp-overview-shortcuts">{[['guests', UsersRound, 'Lista de invitados', 'Confirmaciones y mesas asignadas'], ['confirmations', FileCheck2, 'Detalles del evento', 'Menú, decoración y música'], ['protocol', CalendarDays, 'Protocolo', 'Momentos y responsables']].map(([id, Icon, label, detail]) => <button key={id} onClick={() => openSection(id)}><span className="lp-shortcut-icon">{createElement(Icon, { size: 21 })}</span><div><strong>{label}</strong><small>{detail}</small></div><ArrowUpRight size={17} /></button>)}</div>
        </> : <div className="lp-card lp-tab-content" inert={busy}>
          {tab === 'layout' ? <><div className="lp-section-heading"><small>MONTAJE Y DISTRIBUCIÓN</small><h2>Croquis del salón</h2><p>Ubica los elementos y ajusta el montaje de tu evento.</p></div><CroquisEditor layout={plan.layout} onChange={(layout) => change({ ...plan, layout })} /></> : tab === 'notes' ? <><div className="lp-section-heading"><h2>Notas generales</h2><p>Indicaciones que deben conocer el cliente y el equipo de Lincoln.</p></div><label>Indicaciones del evento<textarea rows="12" maxLength="10000" value={plan.notes} onChange={(e) => change({ ...plan, notes: e.target.value })} /></label></> : <>
            <div className="lp-table-toolbar"><div><small className="lp-section-eyebrow">PLANIFICACIÓN</small><h2>{section.label}</h2><p>{plan[tab].length} registros{tab === 'guests' ? ' · Personas incluye acompañantes y niños' : ''}</p></div><div className="lp-table-controls"><input aria-label="Buscar registros" placeholder="Buscar en esta sección…" value={search} onChange={(e) => setSearch(e.target.value)} /><button disabled={busy || plan[tab].length >= 2000} onClick={() => change({ ...plan, [tab]: [...plan[tab], { id: crypto.randomUUID(), ...Object.fromEntries(section.fields.map(([field, , kind]) => [field, Array.isArray(kind) ? kind[0] : kind === 'number' ? field === 'people' ? 1 : 0 : ''])) }] })}>+ Agregar</button></div></div>
            <div className="lp-table-wrap"><table><thead><tr>{section.fields.map(([id, label]) => <th key={id}>{label}</th>)}<th>Acción</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}>{section.fields.map(([field, label, kind]) => <td key={field}>{Array.isArray(kind) ? <select disabled={busy} aria-label={label} value={row[field] || kind[0]} onChange={(e) => updateRow(row.id, field, e.target.value)}>{kind.map((option) => <option key={option}>{option}</option>)}</select> : kind === 'number' ? <input disabled={busy} aria-label={label} type="number" min={field === 'people' ? 1 : 0} max="10000" value={row[field] ?? 0} onChange={(e) => updateRow(row.id, field, Number(e.target.value))} /> : <textarea disabled={busy} rows="2" aria-label={label} maxLength="3000" value={row[field] || ''} onChange={(e) => updateRow(row.id, field, e.target.value)} />}</td>)}<td><button disabled={busy} className="lp-delete" aria-label="Eliminar fila" onClick={() => { if (window.confirm('¿Eliminar este registro?')) change({ ...plan, [tab]: plan[tab].filter((item) => item.id !== row.id) }); }}>Eliminar</button></td></tr>)}</tbody></table></div>
            {!filtered.length ? <div className="lp-empty"><current.icon size={30} /><h3>{search ? 'Sin resultados' : 'Todavía no hay registros'}</h3><p>{search ? 'Prueba con otro texto.' : 'Agrega los detalles que necesitas coordinar para tu evento.'}</p></div> : null}
          </>}
        </div>}
      </div>
      <footer className="lp-workspace-footer"><span>Centro de Eventos Lincoln · {snapshot.event.code}</span><span>{snapshot.updatedAt ? `Último guardado: ${new Date(snapshot.updatedAt).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}` : 'Los cambios se comparten al guardar'}</span></footer>
    </div>
  </section>;
}
