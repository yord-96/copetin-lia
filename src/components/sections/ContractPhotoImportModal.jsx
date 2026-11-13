import { useEffect, useRef, useState } from 'react';
import { Camera, X, Upload, LoaderCircle } from 'lucide-react';
import { api } from '../../services/api';
import { matchPhotoItems, photoContractCode, preparePhotoReview } from '../../utils/contractPhotoImport.js';
import './ContractPhotoImportModal.css';

export default function ContractPhotoImportModal({ items, clients, responsibles, contracts, rentals, canChooseResponsibles = true, onClose, onContinue }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [availability, setAvailability] = useState(null);
  const [reading, setReading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [itemSearch, setItemSearch] = useState({});
  const controller = useRef(null);
  useEffect(() => {
    let mounted = true;
    api.contracts.photoReaderStatus().then(value => { if (mounted) setAvailability(value); })
      .catch(() => { if (mounted) setAvailability({ ready: false, message: 'No se pudo consultar el lector local. Revisa la conexión con el servidor.' }); });
    return () => { mounted = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const select = event => {
    const next = event.target.files?.[0];
    setError(''); setReview(null); setConfirmed(false);
    if (!next) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size > 8 * 1024 * 1024) {
      setFile(null); setError('Sube una foto JPG, PNG o WEBP de hasta 8 MB.'); return;
    }
    setFile(next);
  };
  const read = async () => {
    if (!file || reading) return;
    const abort = new AbortController(); controller.current = abort;
    setReading(true); setError(''); setReview(null); setElapsed(0); setConfirmed(false);
    try {
      const extracted = await api.contracts.readPhoto(file, { signal: abort.signal, onProgress: setElapsed });
      if (!abort.signal.aborted) setReview(preparePhotoReview(extracted, { items, clients, responsibles, contracts, rentals }));
    } catch (cause) { if (!abort.signal.aborted) setError(cause.message || 'No se pudo leer la foto.'); }
    finally { if (controller.current === abort) { setReading(false); controller.current = null; } }
  };
  const field = (key, value) => { setConfirmed(false); setReview(current => ({ ...current, [key]: value })); };
  const rowField = (index, key, value) => {
    setConfirmed(false);
    setReview(current => ({ ...current, items: current.items.map((row, i) => i === index ? { ...row, [key]: value } : row) }));
  };
  const duplicate = review?.contractCode && [...contracts, ...rentals].some(row => !row.deletedAt && row.status !== 'cancelled'
    && photoContractCode(row.contractCode) === photoContractCode(review.contractCode));
  const next = async () => {
    if (!confirmed || opening) return;
    setOpening(true); setError('');
    try { await onContinue(review, file); }
    catch (cause) { setError(cause.message || 'No se pudo preparar el borrador.'); }
    finally { setOpening(false); }
  };
  const total = review?.items.filter(row => !row.excluded).reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.unitPriceBs || 0), 0) || 0;
  return <div className="orders-modal-backdrop contract-photo-backdrop">
    <section className="contract-photo-modal" role="dialog" aria-modal="true" aria-labelledby="contract-photo-title">
      <header><div><span className="contract-photo-eyebrow">Contrato desde una foto</span><h2 id="contract-photo-title"><Camera size={24} /> Leer contrato escrito</h2><p>La foto prepara un borrador. Tú revisas y creas el contrato al final.</p></div>
        <button type="button" className="ghost-button" aria-label="Cerrar lectura de contrato" disabled={opening} onClick={onClose}><X size={20} /></button></header>
      <div className="contract-photo-body">
        <aside className="contract-photo-source">
          <label className="contract-photo-upload"><Upload size={22} /><span>{file ? 'Cambiar foto' : 'Subir foto del contrato'}</span>
            <input aria-label="Foto del contrato" type="file" accept="image/jpeg,image/png,image/webp" disabled={reading || opening} onChange={select} /></label>
          <p>Incluye la hoja completa, el número lateral y los datos superiores. Evita sombras, reflejos y partes cortadas.</p>
          {preview ? <a href={preview} target="_blank" rel="noreferrer" title="Ampliar foto original"><img src={preview} alt="Foto original del contrato para comparar la transcripción" /></a> : <div className="contract-photo-placeholder"><Camera size={48} /><span>Compara aquí la foto con los datos leídos.</span></div>}
          {!availability ? <p role="status">Consultando lector local…</p> : <p className={availability.ready ? '' : 'contract-photo-warning'}>{availability.message}</p>}
          <button type="button" className="primary-button" disabled={!file || !availability?.ready || reading || opening} onClick={read}>{reading ? <><LoaderCircle size={16} className="contract-photo-spin" /> Leyendo… {elapsed}s</> : 'Interpretar foto'}</button>
          {reading ? <><p role="status">{availability?.engine === 'python' ? `El OCR se detiene si supera ${availability.timeoutSeconds || 60} segundos.` : 'La lectura local puede tardar unos minutos.'} Cancelar o cerrar detiene la lectura y no crea registros.</p><button type="button" className="ghost-button" onClick={() => { controller.current?.abort(); setReading(false); }}>Cancelar lectura</button></> : null}
        </aside>
        <div className="contract-photo-review">
          {error ? <p role="alert" className="contract-photo-error">{error}</p> : null}
          {!review ? <div className="contract-photo-placeholder"><h3>Primero lee la foto</h3><p>Se buscarán coincidencias en clientes, responsables y productos. Los nombres y las cifras dudosas necesitan revisión.</p><p>La lectura local no utiliza APIs de pago. No registra cobros ni reserva inventario.</p></div> : <>
            <h3>Datos para revisar</h3>
            {review.warnings.length || review.uncertainFields?.length ? <details open className="contract-photo-warning"><summary>Lecturas y coincidencias que necesitan revisión</summary><ul>{review.warnings.map((warning, i) => <li key={i}>{warning}</li>)}{review.uncertainFields?.map(value => <li key={value}>Lectura dudosa: {value}</li>)}</ul></details> : null}
            <div className="contract-photo-fields">
              <label>Número de contrato<input aria-label="Número de contrato leído" value={review.contractCode} onChange={e => field('contractCode', e.target.value)} /><small>Vacío: usa el siguiente número automático.</small></label>
              <label>Fecha del evento<input aria-label="Fecha del evento leída" type="date" value={review.eventDate} onChange={e => field('eventDate', e.target.value)} /></label>
              <label>Nombre del cliente<input value={review.customerName} onChange={e => { field('customerName', e.target.value); field('clientId', ''); }} /></label>
              {review.clientMatches?.length ? <label>Cliente existente relacionado<select value={review.clientId} onChange={e => field('clientId', e.target.value)}><option value="">Sin vincular; revisar en el wizard</option>{review.clientMatches.map(row => <option key={row.id} value={row.id}>{row.name} · {row.phone}</option>)}</select></label> : null}
              <label>Teléfono<input value={review.customerPhone} onChange={e => field('customerPhone', e.target.value)} /></label>
              <label>CI / documento<input value={review.customerCi} onChange={e => field('customerCi', e.target.value)} /></label>
              <label>Responsable<select value={review.responsibleId} disabled={!canChooseResponsibles} onChange={e => field('responsibleId', e.target.value)}><option value="">Revisar en el wizard{review.responsibleName ? `: ${review.responsibleName}` : ''}</option>{responsibles.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{!canChooseResponsibles ? <small>Se conserva tu asignación habitual; el nombre escrito queda en las notas.</small> : null}</label>
              <label>Dirección<input value={review.address} onChange={e => field('address', e.target.value)} /></label>
              <label>Entrega / recojo<select value={review.logisticsMode || ''} onChange={e => field('logisticsMode', e.target.value)}><option value="">Revisar logística en el wizard</option><option value="envio">Envío por el equipo</option><option value="recojo">Cliente recoge y devuelve</option></select></label>
              <label>Garantía acordada Bs<input type="number" min="0" step="0.01" value={review.guaranteeBs} onChange={e => field('guaranteeBs', e.target.value)} /><small>Quedará por cobrar; no se marca como recibida.</small></label>
              <label>Pago inicial anotado Bs<input type="number" min="0" step="0.01" value={review.initialPaymentBs} onChange={e => field('initialPaymentBs', e.target.value)} /><small>Si es mayor a cero, confirma método y cuenta en el wizard.</small></label>
            </div>
            {duplicate ? <p role="alert" className="contract-photo-error">Este número ya existe. Cámbialo o déjalo vacío para numeración automática. Se creará un contrato nuevo.</p> : null}
            <h3>Ítems manuscritos ({review.items.length})</h3>
            {!review.items.length ? <p className="contract-photo-warning">No se pudieron leer ítems. Prueba una foto más clara.</p> : null}
            {review.items.map((row, index) => {
              const matches = matchPhotoItems(itemSearch[row.key] ?? row.description, items);
              const selected = items.find(item => item.id === row.selectedItemId && !item.deletedAt);
              const options = selected && !matches.some(item => item.id === selected.id)
                ? [{ ...selected, rentalPriceBs: Number(selected.rentalPriceBs || 0) }, ...matches] : matches;
              return <article key={row.key} className={`contract-photo-item ${row.excluded ? 'is-excluded' : ''}`}>
              <label className="contract-photo-check"><input type="checkbox" checked={!row.excluded} onChange={e => rowField(index, 'excluded', !e.target.checked)} /> Incluir fila {index + 1}{row.uncertain ? ' · Lectura dudosa' : ''}</label>
              <label>Texto escrito<input value={row.description} disabled={row.excluded} onChange={e => { rowField(index, 'description', e.target.value); rowField(index, 'selectedItemId', ''); }} /></label>
              {row.printedLabel ? <small>Renglón impreso: {row.printedLabel}</small> : null}
              <label>Buscar otra variante<input placeholder="Ej.: Tiffany dorado, medallón…" value={itemSearch[row.key] ?? ''} disabled={row.excluded} onChange={e => setItemSearch(current => ({ ...current, [row.key]: e.target.value || undefined }))} /></label>
              <label>Producto del inventario<select aria-label={`Producto de fila ${index + 1}`} value={row.selectedItemId} disabled={row.excluded} onChange={e => rowField(index, 'selectedItemId', e.target.value)}>
                <option value="">Selecciona la coincidencia correcta</option>
                {options.map(item => <option key={item.id} value={item.id}>{item.name} · {item.category} · catálogo Bs {item.rentalPriceBs.toFixed(2)}</option>)}
                <option value="__free__">Conservar como ítem fuera de inventario (por verificar)</option>
              </select></label>
              <div className="contract-photo-fields"><label>Cantidad<input aria-label={`Cantidad de fila ${index + 1}`} type="number" min="1" step="1" value={row.quantity} disabled={row.excluded} onChange={e => rowField(index, 'quantity', e.target.value)} /></label><label>Precio unitario Bs<input aria-label={`Precio de fila ${index + 1}`} type="number" min="0" step="0.01" value={row.unitPriceBs} disabled={row.excluded} onChange={e => rowField(index, 'unitPriceBs', e.target.value)} /></label></div>
              <small>Total calculado: Bs {(Number(row.quantity || 0) * Number(row.unitPriceBs || 0)).toFixed(2)}{row.writtenTotalBs != null ? ` · Escrito: Bs ${row.writtenTotalBs.toFixed(2)}` : ''}</small>
            </article>;
            })}
            <p className="contract-photo-total">Alquiler calculado: <b>Bs {total.toFixed(2)}</b>{review.writtenTotalBs != null ? ` · Alquiler leído: Bs ${review.writtenTotalBs.toFixed(2)}` : ''}<br /><small>La garantía se mantiene separada del alquiler.</small></p>
            <label>Notas leídas<textarea value={review.notes || ''} onChange={e => field('notes', e.target.value)} /></label>
            <label className="contract-photo-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Comparé cliente, fecha, productos, cantidades, precios y pagos con la foto.</label>
          </>}
        </div>
      </div>
      <footer><button type="button" className="ghost-button" disabled={opening} onClick={onClose}>Cancelar</button><button type="button" className="primary-button" disabled={!review || !confirmed || duplicate || opening} onClick={next}>{opening ? 'Preparando…' : 'Revisar en wizard'}</button></footer>
    </section>
  </div>;
}
