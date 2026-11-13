import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ProductImage from '../common/ProductImage';
import { api } from '../../services/api';
import { buildDraftAvailabilityPeriod, getProjectedInventoryAvailability } from '../../utils/availability.js';
import { matchPhotoItems, photoSearchText } from '../../utils/contractPhotoImport.js';
import { voiceCatalogPrice, voiceCodeExists, voiceContractCode, voiceDate, voiceMoreAnswer, voiceNumber, voiceProductChoice, voiceTime } from '../../utils/contractVoice.js';
import { createVoiceTurn } from '../../utils/contractVoiceSession.js';
import './ContractPhotoImportModal.css';
import './ContractVoiceModal.css';

const questions = {
  contractCode: '¿Cuál es el número del contrato? También puedes decir automático.',
  customerName: '¿Cómo se llama el cliente?', customerPhone: '¿Cuál es su teléfono? Puedes decir omitir.',
  eventDate: '¿Qué fecha es el evento? Di el día, el mes y el año.', eventTime: '¿A qué hora es el evento? Por ejemplo, ocho de la noche o veinte horas.',
  address: '¿Cuál es la dirección del evento?', responsibleId: '¿Quién es responsable del contrato? Puedes decir mi asignación habitual.',
  logisticsMode: '¿El cliente recoge o enviamos el equipo?', description: '¿Qué producto agregamos? Di su nombre.',
  productChoice: 'Elige un producto por su número de opción o di su nombre exacto. También puedes decir buscar otro.',
  quantity: '¿Cuántas unidades necesitas? Puedes pedir más de las disponibles y asignar proveedor en el wizard.',
  unitPriceBs: 'Este producto no tiene un precio registrado. ¿Cuál es el precio por unidad en bolivianos?',
  more: '¿Agregamos otro producto? Responde sí o no.', guaranteeBs: '¿Cuál es la garantía acordada? Di cero si no hay garantía.',
  review: 'El borrador está listo. Revisa el resumen antes de abrir el contrato.',
};
const emptyLine = () => ({ description: '', selectedItemId: '', quantity: '', unitPriceBs: '' });
const optional = text => /^(omitir|ninguno|ninguna|sin telefono|habitual|mi asignacion habitual|yo)$/.test(photoSearchText(text));
export default function ContractVoiceModal({ items, responsibles, contracts = [], rentals = [], availability = null, availabilityError = '', canChooseResponsibles, onClose, onContinue }) {
  const [step, setStep] = useState('contractCode');
  const [draft, setDraft] = useState({ contractCode: '', customerName: '', customerPhone: '', eventDate: '', eventTime: '', address: '', responsibleId: '', logisticsMode: '', guaranteeBs: 0, items: [] });
  const [line, setLine] = useState(emptyLine);
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [status, setStatus] = useState('paused');
  const [turn, setTurn] = useState(0);
  const cancelTurn = useRef(() => {}), submitRef = useRef(null), busyRef = useRef(false), mounted = useRef(true);
  const questionRef = useRef(null);
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const matches = useMemo(() => matchPhotoItems(step === 'description' ? answer : query, items), [step, answer, query, items]);
  const selectedItem = items.find(item => item.id === line.selectedItemId && !item.deletedAt);
  const projected = useMemo(() => availability && draft.eventDate ? getProjectedInventoryAvailability({
    items: availability.items || items, contracts: availability.contracts || [], rentals: availability.rentals || [], quotes: availability.quotes || [],
    period: buildDraftAvailabilityPeriod({ eventDate: draft.eventDate, eventTime: draft.eventTime, pickupDateMode: 'coordinate', pickupTimeMode: 'coordinate' }),
  }) : null, [availability, items, draft.eventDate, draft.eventTime]);
  const availableFor = id => {
    const value = projected?.get(id)?.projectedAvailable;
    if (!Number.isFinite(value)) return null;
    return Math.max(0, value - draft.items.filter(row => row.selectedItemId === id).reduce((sum, row) => sum + Number(row.quantity), 0));
  };
  const prompt = error || (step === 'quantity' ? `${selectedItem?.name || ''}. ${line.unitPriceBs !== '' ? `Precio de catálogo: ${line.unitPriceBs} bolivianos por unidad. ` : ''}${questions.quantity}`
    : step === 'productChoice' ? `Encontré ${matches.length} opciones para ${query}. ${questions.productChoice}` : questions[step]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelTurn.current(); }; }, []);
  useEffect(() => {
    questionRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (!automatic || busy || step === 'review') return;
    const cancel = createVoiceTurn({ Speech, Utterance: window.SpeechSynthesisUtterance, synthesis: window.speechSynthesis, prompt,
      acceptInterim: step === 'more' ? text => voiceMoreAnswer(text) !== null : undefined,
      onStatus: (value, text) => { setStatus(value); if (text !== undefined) setAnswer(text); },
      onReply: text => submitRef.current?.(text),
      onError: message => { setAutomatic(false); setError(message); },
    });
    cancelTurn.current = cancel;
    return cancel;
  }, [automatic, busy, turn, prompt, Speech, step]);
  const pause = () => { cancelTurn.current(); setAutomatic(false); setStatus('paused'); };
  const start = () => { if (!Speech) return; setAnswer(''); setError(''); setAutomatic(true); setTurn(value => value + 1); };
  const advance = (value, next, nextDraft = draft, nextLine = line, nextQuery = query) => {
    setHistory(rows => [...rows, { question: questions[step], answer: value || 'Omitido', step, draft, line, query }]);
    setDraft(nextDraft); setLine(nextLine); setQuery(nextQuery); setStep(next); setAnswer(''); setError(''); setConfirmed(false); setTurn(value => value + 1);
  };
  const chooseItem = item => {
    cancelTurn.current();
    advance(item.name, 'quantity', draft, { description: item.name, selectedItemId: item.id, quantity: '', unitPriceBs: voiceCatalogPrice(item) ?? '' });
  };
  const checkCode = async code => {
    if (!code) return;
    if (voiceCodeExists(code, contracts, rentals)) throw new Error(`El contrato ${code} ya existe. Di otro número o automático; no se sobrescribirá.`);
    const result = await api.sync.checkContractCode(code);
    if (result.exists) throw new Error(`El contrato ${code} ya existe. Di otro número o automático; no se sobrescribirá.`);
  };
  const submitAnswer = async raw => {
    if (busyRef.current) return;
    busyRef.current = true; cancelTurn.current(); setBusy(true); setError(''); setStatus('processing');
    const value = raw.trim();
    try {
      if (/^(pausa|pausar|detener conversacion)$/.test(photoSearchText(value))) { pause(); return; }
      if (/^(repite|repetir|repetir pregunta)$/.test(photoSearchText(value))) { setTurn(value => value + 1); return; }
      if (step === 'contractCode') {
        const code = voiceContractCode(value);
        if (code === null) throw new Error('Di el número del contrato, por ejemplo tres mil quinientos seis, o automático.');
        await checkCode(code); if (!mounted.current) return;
        advance(code ? `${code} · número disponible` : 'Numeración automática', 'customerName', { ...draft, contractCode: code }); return;
      }
      if (step === 'description') {
        const found = matchPhotoItems(value, items);
        if (!found.length) throw new Error('No encontré ese producto. Di otro nombre o escribe para buscarlo.');
        advance(value, 'productChoice', draft, emptyLine(), value); return;
      }
      if (step === 'productChoice') {
        if (/buscar otr[oa]|cambiar busqueda/.test(photoSearchText(value))) { advance(value, 'description', draft, emptyLine(), ''); return; }
        const item = voiceProductChoice(value, matches);
        if (!item) throw new Error(`Elige una opción entre uno y ${matches.length}, di el nombre exacto o buscar otro.`);
        chooseItem(items.find(row => row.id === item.id)); return;
      }
      if (['quantity', 'unitPriceBs', 'guaranteeBs'].includes(step)) {
        const number = voiceNumber(value);
        if (number == null || number < 0 || number > 10000000 || (step === 'quantity' && (!Number.isInteger(number) || number < 1 || number > 100000))) throw new Error('No entendí el número. Puedes decir doscientos sesenta o escribir 260.');
        if (step === 'guaranteeBs') advance(String(number), 'review', { ...draft, guaranteeBs: number });
        else if (step === 'quantity') {
          const nextLine = { ...line, quantity: number };
          if (line.unitPriceBs !== '') advance(`${number} unidades · Bs ${line.unitPriceBs} por unidad`, 'more', { ...draft, items: [...draft.items, nextLine] }, nextLine);
          else advance(String(number), 'unitPriceBs', draft, nextLine);
        } else { const nextLine = { ...line, unitPriceBs: number }; advance(String(number), 'more', { ...draft, items: [...draft.items, nextLine] }, nextLine); }
        return;
      }
      if (step === 'more') {
        const more = voiceMoreAnswer(value);
        if (more === true) advance('Sí', 'description', draft, emptyLine(), '');
        else if (more === false) advance('No', 'guaranteeBs');
        else throw new Error('Responde sí o no.');
        return;
      }
      let parsed = optional(value) && ['customerPhone', 'responsibleId'].includes(step) ? '' : value;
      if (step === 'customerName' && !value) throw new Error('Completa el nombre del cliente.');
      if (step === 'customerPhone' && parsed) {
        parsed = parsed.replace(/[\s().+-]/g, '');
        if (!/^\d{6,15}$/.test(parsed)) throw new Error('No entendí el teléfono. Repite las cifras o di omitir.');
      }
      if (step === 'eventDate') { parsed = voiceDate(value); if (!parsed) throw new Error('Di una fecha completa, por ejemplo veintiuno de noviembre del dos mil veintiséis.'); }
      if (step === 'eventTime') { parsed = voiceTime(value); if (!parsed) throw new Error('Di una hora como ocho de la noche o veinte horas. También puedes escribir 20:00.'); }
      if (step === 'responsibleId' && parsed) {
        const words = photoSearchText(parsed).split(' ');
        const candidates = responsibles.filter(row => row.id === parsed || words.every(word => photoSearchText(row.name).split(' ').includes(word)));
        if (candidates.length !== 1) throw new Error('No hay una coincidencia única. Di el nombre completo o elige a la persona en la lista.');
        parsed = candidates[0].id;
      }
      if (step === 'logisticsMode') {
        if (/recog|recoj|retir/i.test(value)) parsed = 'recojo';
        else if (/env[ií]|entrega/i.test(value)) parsed = 'envio';
        else throw new Error('Indica cliente recoge o envío por el equipo.');
      }
      const next = { customerName: 'customerPhone', customerPhone: 'eventDate', eventDate: 'eventTime', eventTime: 'address', address: canChooseResponsibles ? 'responsibleId' : 'logisticsMode', responsibleId: 'logisticsMode', logisticsMode: 'description' }[step];
      const display = step === 'responsibleId' ? responsibles.find(row => row.id === parsed)?.name || 'Mi asignación habitual' : parsed;
      advance(display, next, { ...draft, [step]: parsed });
    } catch (cause) { if (mounted.current) { setError(cause.message); setTurn(value => value + 1); setStatus('paused'); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  useLayoutEffect(() => { submitRef.current = submitAnswer; });
  const back = index => {
    pause(); const entry = history[index];
    setDraft(entry.draft); setLine(entry.line); setQuery(entry.query); setStep(entry.step); setHistory(rows => rows.slice(0, index)); setAnswer(''); setError(''); setConfirmed(false);
  };
  const finish = async () => {
    if (busyRef.current) return;
    pause(); busyRef.current = true; setBusy(true); setError('');
    try {
      await checkCode(draft.contractCode); if (!mounted.current) return;
      await onContinue({ ...draft, customerCi: '', initialPaymentBs: 0, warnings: ['Confirmar entrega, devolución, disponibilidad y proveedores antes de crear.'], uncertainFields: [], notes: 'Preparado con asistente de voz; respuestas revisadas. No acredita pagos.', items: draft.items.map((row, index) => ({ ...row, key: `voice-${index}`, excluded: false })) });
    } catch (cause) { if (mounted.current) setError(cause.message || 'No se pudo preparar el contrato.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const productCard = (item, index, selectable) => {
    const available = availableFor(item.id), price = voiceCatalogPrice(item);
    const body = <><ProductImage item={item} alt={item.name} fallback={<span className="voice-no-image">Sin foto</span>} /><span><strong>{selectable ? `${index + 1}. ` : ''}{item.name}</strong><small>Precio: {price === null ? 'por indicar' : `Bs ${price.toFixed(2)} por unidad`}</small><small>Disponibles para {draft.eventDate}: {available === null ? 'sin confirmar' : available}</small></span></>;
    return selectable ? <button key={item.id} type="button" className="voice-product-card" disabled={busy} onClick={() => chooseItem(item)}>{body}</button> : <div className="voice-product-card" key={item.id}>{body}</div>;
  };
  return <div className="orders-modal-backdrop contract-photo-backdrop"><section className="contract-voice-modal" role="dialog" aria-modal="true" aria-labelledby="voice-title">
    <header><h2 id="voice-title">Contrato por voz</h2><button type="button" className="ghost-button" disabled={busy} onClick={onClose}>Cerrar</button></header>
    <p>Inicia una vez: escucharás cada pregunta y el micrófono volverá a escuchar tu respuesta automáticamente. El servicio de voz del navegador puede procesar el audio fuera de tu equipo.</p>
    {step !== 'review' && <div className="voice-actions"><button type="button" className="primary-button" disabled={busy || !Speech} onClick={automatic ? pause : start}>{automatic ? 'Pausar conversación' : history.length || answer ? 'Reanudar conversación' : 'Iniciar conversación'}</button><span role="status">{busy ? 'Comprobando respuesta…' : automatic ? ({ speaking: 'Hablando…', listening: 'Te escucho…', processing: 'Procesando…', paused: 'Preparando siguiente pregunta…' }[status]) : 'Conversación pausada'}</span></div>}
    {!Speech && <p>Este navegador no ofrece dictado. Puedes escribir las respuestas.</p>}
    {history.length > 0 && <><p className="voice-last-answer">Última respuesta: <strong>{history.at(-1).answer}</strong></p><details className="voice-history"><summary>{history.length} respuestas · Ver o corregir</summary>{history.map((entry, index) => <div key={index}><strong>{entry.question}</strong><p>{entry.answer}</p><button type="button" className="ghost-button" disabled={busy} onClick={() => back(index)}>Corregir desde aquí</button></div>)}</details></>}
    <h3 ref={questionRef} aria-live="polite">{questions[step]}</h3>
    {error && <p role="alert" className="contract-photo-error">{error}</p>}
    {step !== 'review' ? <form onSubmit={event => { event.preventDefault(); submitAnswer(answer); }}>
      <label>Tu respuesta<textarea value={answer} onChange={event => { pause(); setAnswer(event.target.value); }} maxLength={500} disabled={busy} placeholder={step === 'contractCode' ? '3506 o automático' : 'Habla cuando diga «Te escucho» o escribe aquí'} /></label>
      {step === 'more' && <div className="voice-actions"><button type="button" className="ghost-button" disabled={busy} onClick={() => submitAnswer('sí')}>Sí, agregar otro</button><button type="button" className="ghost-button" disabled={busy} onClick={() => submitAnswer('no')}>No, continuar</button></div>}
      {step === 'responsibleId' && <select aria-label="Responsable" disabled={busy} value={responsibles.some(row => row.id === answer) ? answer : ''} onChange={event => { pause(); setAnswer(event.target.value); }}><option value="">Mi asignación habitual</option>{responsibles.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
      {['description', 'productChoice'].includes(step) && <div className="voice-product-options" aria-label="Productos encontrados">{matches.map((match, index) => productCard(items.find(item => item.id === match.id), index, true))}</div>}
      {['quantity', 'unitPriceBs'].includes(step) && selectedItem && productCard(selectedItem, 0, false)}
      {['description', 'productChoice', 'quantity'].includes(step) && <p className="voice-availability-note">{availabilityError || 'Disponibilidad orientativa para el día del evento; descuenta los ítems ya agregados. Se recalcula al ajustar las fechas en el wizard.'} Puedes pedir más unidades y cubrir el faltante con proveedor en el wizard.</p>}
      <div className="voice-actions"><button type="submit" className="primary-button" disabled={busy}>Confirmar respuesta escrita</button>{step === 'productChoice' && <button type="button" className="ghost-button" disabled={busy} onClick={() => { cancelTurn.current(); advance('Nueva búsqueda', 'description', draft, emptyLine(), ''); }}>Buscar otro producto</button>}</div>
    </form> : <div className="voice-summary"><p><strong>Contrato {draft.contractCode || 'con número automático'}</strong> · {draft.customerName} · {draft.eventDate} {draft.eventTime} · {draft.address}</p><p>{draft.logisticsMode === 'recojo' ? 'Cliente recoge y devuelve' : 'Envío por el equipo'}</p>
      {draft.items.map((row, index) => <div key={index} className="voice-summary-line"><strong>{row.quantity} × {row.description}</strong><label>Precio unitario Bs<input aria-label={`Precio del ítem ${index + 1}`} type="number" min="0" step="0.01" value={row.unitPriceBs} onChange={event => { setDraft(current => ({ ...current, items: current.items.map((item, i) => i === index ? { ...item, unitPriceBs: event.target.value } : item) })); setConfirmed(false); }} /></label><span>Subtotal: Bs {(row.quantity * row.unitPriceBs).toFixed(2)}</span></div>)}
      <p>Alquiler: Bs {draft.items.reduce((sum, row) => sum + row.quantity * row.unitPriceBs, 0).toFixed(2)} · Garantía: Bs {draft.guaranteeBs}</p><p>Sin pago inicial registrado. Entrega, devolución y proveedores se revisan en el editor.</p><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Revisé número, cliente, productos, cantidades y precios.</label><button type="button" className="primary-button" disabled={!confirmed || busy} onClick={finish}>{busy ? 'Preparando…' : 'Revisar contrato completo'}</button></div>}
  </section></div>;
}
