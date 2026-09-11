import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, FileCheck2, Hash, Pencil, Search, StickyNote, Trash2, X } from 'lucide-react';
import { api } from '../../../services/api';

const money = (value) => new Intl.NumberFormat('es-BO', {
  style: 'currency', currency: 'BOB', minimumFractionDigits: 2,
}).format(Number(value ?? 0));

const dateLabel = (value) => {
  if (!value) return 'Sin fecha';
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export default function LincolnCommercialWorkspace({
  refreshKey,
  onNewReservation,
  onNewContract,
  onOpenRecord,
  onEditReservation,
  onEditContract,
  onConvertReservation,
  onOpenDocument,
  onOpenEconomic,
  onCancelReservation,
  onSaveInternalNote,
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState({ summary: { reservations: 0, contracts: 0, currentNumber: 0, nextNumber: 1 }, rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openMenuKey, setOpenMenuKey] = useState('');
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [noteRow, setNoteRow] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState('');
  const menuRootRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.lincoln.getCommercialOverview({ query, status, from, to })
        .then((next) => {
          if (cancelled) return;
          setData(next);
          setError('');
        })
        .catch((requestError) => {
          if (!cancelled) setError(requestError?.message || 'No se pudo cargar Reservas y Contratos.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [from, query, refreshKey, status, to]);

  useEffect(() => {
    if (!openMenuKey) return undefined;
    const close = (event) => {
      if (!menuRootRef.current?.contains(event.target)) setOpenMenuKey('');
    };
    const closeOnScroll = () => setOpenMenuKey('');
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnScroll);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnScroll);
    };
  }, [openMenuKey]);

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const summary = data?.summary ?? {};
  const statusCounts = summary.statusCounts ?? {};
  const statusOptions = [
    ['all', 'Todas'], ['reservations', 'Reservas'], ['formalization', 'Por formalizar'], ['lead', 'Interesado'], ['pending', 'Pendiente'], ['confirmed', 'Confirmada'],
    ['contracts', 'Contratos'], ['contract_pending', 'Contrato pendiente'], ['contracted', 'Contratado'], ['completed', 'Realizado'], ['cancelled', 'Anulado'],
  ];

  const clearFilters = () => {
    setQuery('');
    setStatus('all');
    setFrom('');
    setTo('');
  };

  const act = (callback, row) => {
    setOpenMenuKey('');
    callback?.(row);
  };

  const toggleMenu = (row, event) => {
    event.stopPropagation();
    if (openMenuKey === row.key) {
      setOpenMenuKey('');
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 220;
    const estimatedMenuHeight = row.kind === 'reservation' ? 252 : 190;
    const viewportPadding = 12;
    const gap = 8;
    const openUp = rect.bottom + gap + estimatedMenuHeight > window.innerHeight - viewportPadding;
    const top = openUp
      ? Math.max(viewportPadding, rect.top - estimatedMenuHeight - gap)
      : Math.min(rect.bottom + gap, window.innerHeight - estimatedMenuHeight - viewportPadding);
    const left = Math.min(
      Math.max(viewportPadding, rect.right - menuWidth),
      window.innerWidth - menuWidth - viewportPadding,
    );

    setMenuPosition({ top, left });
    setOpenMenuKey(row.key);
  };

  const openNote = (row) => {
    setNoteRow(row);
    setNoteDraft(String(row?.internalNote ?? ''));
    setNoteError('');
  };

  const closeNote = () => {
    if (noteSaving) return;
    setNoteRow(null);
    setNoteDraft('');
    setNoteError('');
  };

  const persistNote = async (value) => {
    if (!noteRow || !onSaveInternalNote) return;
    setNoteSaving(true);
    setNoteError('');
    try {
      await onSaveInternalNote(noteRow, value);
      setNoteRow(null);
      setNoteDraft('');
    } catch (saveError) {
      setNoteError(saveError?.message || 'No se pudo guardar la nota.');
    } finally {
      setNoteSaving(false);
    }
  };

  const activeMenuRow = rows.find((row) => row.key === openMenuKey) ?? null;
  const activeReservationConfirmed = activeMenuRow?.kind === 'reservation'
    && !['lead', 'cancelled', 'converted'].includes(String(activeMenuRow.status ?? '').toLowerCase());

  return (
    <div className="lincoln-commercial-page">
      <section className="lincoln-commercial-titlebar">
        <div>
          <span className="lincoln-commercial-eyebrow">Gestión comercial</span>
          <h1>Reservas y Contratos</h1>
          <p>Una sola operación comercial: la reserva cambia de estado y, cuando corresponde, se formaliza como contrato.</p>
        </div>
        <div className="lincoln-commercial-primary-actions">
          <button type="button" onClick={onNewContract}>+ Nuevo contrato</button>
          <button type="button" onClick={onNewReservation}>+ Nueva reserva</button>
        </div>
      </section>

      <section className="lincoln-commercial-card">
        <div className="lincoln-commercial-metrics">
          <button
            type="button"
            className={`lincoln-commercial-metric-card is-reservations ${status === 'reservations' ? 'is-selected' : ''}`}
            onClick={() => setStatus('reservations')}
            title="Mostrar todas las reservas, sin separar sus estados"
          >
            <span className="lincoln-commercial-metric-icon"><CalendarDays size={25} strokeWidth={1.8} /></span>
            <div><strong>Reservas</strong><span>{summary.interested ?? 0} interesado(s) dentro de {summary.reservations ?? 0} reserva(s)</span></div>
            <b>{summary.reservations ?? 0}</b>
          </button>

          <article className="lincoln-commercial-metric-card is-numbering">
            <span className="lincoln-commercial-metric-icon"><Hash size={23} strokeWidth={1.9} /></span>
            <span className="lincoln-commercial-numbering-label">Numeración</span>
            <div><small>Actual</small><b>{summary.currentNumber || '—'}</b></div>
            <div><small>Siguiente</small><b>{summary.nextNumber || 1}</b></div>
          </article>

          <button
            type="button"
            className={`lincoln-commercial-metric-card is-contracts ${status === 'contracts' ? 'is-selected' : ''}`}
            onClick={() => setStatus('contracts')}
            title="Mostrar contratos"
          >
            <span className="lincoln-commercial-metric-icon"><FileCheck2 size={25} strokeWidth={1.8} /></span>
            <div><strong>Contratos</strong><span>Documentos formalizados</span></div>
            <b>{summary.contracts ?? 0}</b>
          </button>
        </div>

        <button type="button" className={`lincoln-commercial-formalization ${status === 'formalization' ? 'is-active' : ''}`} onClick={() => setStatus('formalization')}>
          <span><FileCheck2 size={20} aria-hidden="true" /></span>
          <div><small>Siguiente etapa</small><strong>Eventos listos para pasar a contrato</strong><p>Revisa los datos, congela el paquete y genera el PDF contractual.</p></div>
          <b>{summary.readyToContract ?? 0}</b>
          <em>Ver por formalizar</em>
        </button>

        <div className="lincoln-commercial-filters">
          <label className="lincoln-commercial-search"><Search size={17} aria-hidden="true" /><input type="search" placeholder="Buscar código, cliente, evento o salón..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label><span>Desde</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>Hasta</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <button type="button" className="is-clear" onClick={clearFilters}>Limpiar</button>
        </div>

        <div className="lincoln-commercial-statuses">
          {statusOptions.map(([value, label]) => (
            <button key={value} type="button" className={status === value ? 'is-active' : ''} onClick={() => setStatus(value)} aria-pressed={status === value}>{label}<span>{statusCounts[value] ?? 0}</span></button>
          ))}
        </div>

        {error ? <div className="lincoln-commercial-error">{error}</div> : null}
        <div className="lincoln-commercial-table-wrap">
          <table className="lincoln-commercial-table">
            <colgroup><col className="is-code" /><col className="is-date" /><col className="is-client" /><col className="is-event" /><col className="is-guests" /><col className="is-responsible" /><col className="is-note" /><col className="is-status" /><col className="is-money" /><col className="is-money" /><col className="is-actions" /></colgroup>
            <thead><tr><th>Código</th><th>Fecha evento</th><th>Cliente</th><th>Salón / tipo</th><th>Personas</th><th>Responsable</th><th>Nota</th><th>Estado</th><th>Total</th><th>Saldo</th><th>Acciones</th></tr></thead>
            <tbody>
              {loading && !rows.length ? <tr><td colSpan="11" className="is-empty">Cargando operación comercial...</td></tr> : null}
              {!loading && !rows.length ? <tr><td colSpan="11" className="is-empty">No hay registros con estos filtros.</td></tr> : null}
              {rows.map((row) => (
                <tr key={row.key}>
                  <td><button type="button" className={`lincoln-commercial-code is-${row.kind}`} onClick={() => onOpenRecord(row)}>{row.code}</button><small>{row.kind === 'reservation' ? 'Reserva' : 'Contrato'}</small></td>
                  <td><strong>{dateLabel(row.eventDate)}</strong><small>{row.startTime || 'Hora pendiente'}</small></td>
                  <td><strong>{row.clientName || 'Sin cliente'}</strong><small>{row.clientPhone || ''}</small></td>
                  <td><strong>{row.roomName || 'Sin salón'}</strong><small>{row.eventType || 'Sin tipo'}</small></td>
                  <td>{row.guestCount || '—'}</td>
                  <td className="lincoln-commercial-responsible"><strong>{row.responsibleName || 'Sin registrar'}</strong><small>{row.responsibleName ? 'Creó el registro' : 'Registro histórico'}</small></td>
                  <td className="lincoln-commercial-note-cell">
                    <button type="button" className={`lincoln-commercial-note-button ${row.internalNote ? 'has-note' : ''}`} onClick={() => openNote(row)} title={row.internalNote || 'Agregar nota interna'} aria-label={`${row.internalNote ? 'Editar' : 'Agregar'} nota de ${row.code}`}>
                      <StickyNote size={16} strokeWidth={2} />
                      {row.internalNote ? <span>{row.internalNote}</span> : <span>Agregar</span>}
                    </button>
                  </td>
                  <td><span className={`lincoln-commercial-status is-${row.kind} is-status-${String(row.status ?? '').toLowerCase()}`}>{row.statusLabel}</span></td>
                  <td><strong>{money(row.totalBs)}</strong></td>
                  <td>{row.kind === 'contract' ? <strong>{money(row.balanceBs)}</strong> : <span className="is-muted">—</span>}</td>
                  <td>
                    <div className="lincoln-commercial-actions">
                      <button type="button" className={`lincoln-commercial-open ${row.readyToContract ? 'is-formalize' : ''}`} onClick={() => row.readyToContract ? onConvertReservation(row) : onOpenRecord(row)}>{row.readyToContract ? 'Pasar a contrato' : 'Abrir'}</button>
                      <button
                        type="button"
                        className={`lincoln-commercial-dots ${openMenuKey === row.key ? 'is-active' : ''}`}
                        aria-label={`Más opciones para ${row.code}`}
                        aria-expanded={openMenuKey === row.key}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => toggleMenu(row, event)}
                      >
                        ⋮
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="lincoln-commercial-footer"><span>Mostrando <strong>{rows.length}</strong> registro(s)</span><span>Reservas y contratos de Centro de Eventos Lincoln</span></footer>
      </section>

      {typeof document !== 'undefined' && noteRow ? createPortal(
        <div className="lincoln-commercial-note-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeNote(); }}>
          <section className="lincoln-commercial-note-modal" role="dialog" aria-modal="true" aria-labelledby="lincoln-note-title">
            <header>
              <div><small>Nota interna</small><h2 id="lincoln-note-title">{noteRow.code}</h2><p>{noteRow.clientName || 'Sin cliente'} · {dateLabel(noteRow.eventDate)}</p></div>
              <button type="button" onClick={closeNote} disabled={noteSaving} aria-label="Cerrar"><X size={18} /></button>
            </header>
            <div className="lincoln-commercial-note-body">
              <label htmlFor="lincoln-commercial-note">Nota para seguimiento comercial</label>
              <textarea id="lincoln-commercial-note" rows="6" maxLength="1200" placeholder="Escribe una nota interna para esta reserva o contrato..." value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} autoFocus />
              <div className="lincoln-commercial-note-meta"><span>Solo para uso interno. No modifica el contrato ni el PDF.</span><b>{noteDraft.length}/1200</b></div>
              {noteError ? <div className="lincoln-commercial-note-error">{noteError}</div> : null}
            </div>
            <footer>
              {String(noteRow.internalNote ?? '').trim() ? <button type="button" className="is-delete" disabled={noteSaving} onClick={() => persistNote('')}><Trash2 size={15} /> Eliminar nota</button> : <span />}
              <div><button type="button" className="is-secondary" onClick={closeNote} disabled={noteSaving}>Cancelar</button><button type="button" className="is-save" onClick={() => persistNote(noteDraft)} disabled={noteSaving || String(noteDraft).trim() === String(noteRow.internalNote ?? '').trim()}><Pencil size={15} /> {noteSaving ? 'Guardando...' : 'Guardar nota'}</button></div>
            </footer>
          </section>
        </div>,
        document.body,
      ) : null}

      {typeof document !== 'undefined' && activeMenuRow ? createPortal(
        <div
          ref={menuRootRef}
          className="lincoln-commercial-menu lincoln-commercial-menu-portal"
          style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
          role="menu"
          aria-label={`Acciones para ${activeMenuRow.code}`}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="lincoln-commercial-menu-title">
            <strong>{activeMenuRow.code}</strong>
            <span>{activeMenuRow.kind === 'reservation' ? 'Reserva' : 'Contrato'} · {activeMenuRow.statusLabel}</span>
          </div>

          {activeMenuRow.kind === 'reservation' ? (
            <>
              <button type="button" onClick={() => act(onEditReservation, activeMenuRow)}>Editar reserva</button>
              <button type="button" onClick={() => act(onOpenEconomic, activeMenuRow)}>Económico</button>
              {String(activeMenuRow.status ?? '').toLowerCase() === 'lead'
                ? <button type="button" onClick={() => act(onEditReservation, activeMenuRow)}>Concretar reserva</button>
                : null}
              {activeReservationConfirmed
                ? <button type="button" className="is-emphasis" onClick={() => act(onConvertReservation, activeMenuRow)}>Generar contrato</button>
                : null}
              <button type="button" onClick={() => act(onOpenRecord, activeMenuRow)}>Ver documentos</button>
              {!['cancelled', 'converted'].includes(String(activeMenuRow.status ?? '').toLowerCase())
                ? <button type="button" className="is-danger" onClick={() => act(onCancelReservation, activeMenuRow)}>Cancelar reserva</button>
                : null}
            </>
          ) : (
            <>
              <button type="button" onClick={() => act(onEditContract, activeMenuRow)}>Editar datos</button>
              <button type="button" onClick={() => act(onOpenEconomic, activeMenuRow)}>Económico</button>
              <button type="button" className="is-emphasis" onClick={() => act(onOpenDocument, activeMenuRow)}>Abrir contrato PDF</button>
              <button type="button" onClick={() => act(onOpenRecord, activeMenuRow)}>Ver documentos</button>
            </>
          )}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
