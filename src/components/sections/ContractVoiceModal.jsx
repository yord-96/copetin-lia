import { useEffect, useRef, useState } from 'react';
import { matchPhotoItems } from '../../utils/contractPhotoImport.js';
import { voiceDate, voiceNumber } from '../../utils/contractVoice.js';
import './ContractPhotoImportModal.css';
import './ContractVoiceModal.css';

const questions = {
  customerName: '¿Cómo se llama el cliente?', customerPhone: '¿Cuál es su teléfono? Puedes omitirlo.',
  eventDate: '¿Qué fecha es el evento? Incluye día, mes y año.', address: '¿Cuál es la dirección del evento?',
  responsibleId: '¿Quién es responsable del contrato?', logisticsMode: '¿El cliente recoge o enviamos el equipo?',
  description: '¿Qué producto agregamos? Di su nombre o búscalo abajo.', quantity: '¿Cuántas unidades?',
  unitPriceBs: '¿Cuál es el precio por unidad en bolivianos?', more: '¿Agregamos otro producto?',
  guaranteeBs: '¿Cuál es la garantía acordada? Di cero si no hay garantía.', review: 'Revisa el resumen. Puedes volver a cualquier respuesta para corregirla.',
};
export default function ContractVoiceModal({ items, responsibles, canChooseResponsibles, onClose, onContinue }) {
  const [step, setStep] = useState('customerName');
  const [draft, setDraft] = useState({ customerName: '', customerPhone: '', eventDate: '', address: '', responsibleId: '', logisticsMode: '', guaranteeBs: 0, items: [] });
  const [line, setLine] = useState({ description: '', selectedItemId: '', quantity: '', unitPriceBs: '' });
  const [answer, setAnswer] = useState('');
  const [history, setHistory] = useState([]);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [spokenQuestions, setSpokenQuestions] = useState(false);
  const recognition = useRef(null);
  const session = useRef(0);
  const answerRef = useRef('');
  const questionRef = useRef(null);
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const stop = () => { session.current += 1; recognition.current?.abort(); recognition.current = null; setListening(false); setInterim(''); };
  useEffect(() => () => { session.current += 1; recognition.current?.abort(); window.speechSynthesis?.cancel(); }, []);
  useEffect(() => {
    questionRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (!spokenQuestions || !window.SpeechSynthesisUtterance) return;
    const utterance = new window.SpeechSynthesisUtterance(questions[step]); utterance.lang = 'es-BO';
    window.speechSynthesis?.cancel(); window.speechSynthesis?.speak(utterance);
    return () => window.speechSynthesis?.cancel();
  }, [step, spokenQuestions]);
  const editAnswer = value => { answerRef.current = value; setAnswer(value); };
  const listen = () => {
    stop(); window.speechSynthesis?.cancel(); setError('');
    if (step === 'description') setLine(current => ({ ...current, selectedItemId: '' }));
    const id = session.current;
    const rec = new Speech(); recognition.current = rec;
    rec.lang = 'es-BO'; rec.interimResults = true; rec.continuous = false;
    const prefix = answerRef.current.trim();
    rec.onresult = event => {
      if (id !== session.current) return;
      let final = '', pending = '';
      for (let i = 0; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript + ' ';
        else pending += event.results[i][0].transcript;
      }
      editAnswer([prefix, final.trim()].filter(Boolean).join(' ')); setInterim(pending);
    };
    rec.onerror = event => { if (id === session.current) { setError(event.error === 'not-allowed' ? 'Permite el micrófono en el navegador o escribe tu respuesta.' : `No se pudo completar el dictado (${event.error}). Puedes escribir o intentar otra vez.`); setListening(false); } };
    rec.onend = () => { if (id === session.current) { setListening(false); setInterim(''); } };
    try { rec.start(); setListening(true); } catch { setError('No se pudo iniciar el micrófono. Puedes escribir tu respuesta.'); }
  };
  const advance = (value, next) => {
    stop(); window.speechSynthesis?.cancel();
    setHistory(rows => [...rows, { step, question: questions[step], answer: value || 'Omitido' }]);
    setStep(next); editAnswer(''); setError(''); setConfirmed(false);
  };
  const submit = event => {
    event.preventDefault(); const value = answer.trim(); setError('');
    if (step === 'description') {
      const item = items.find(row => row.id === line.selectedItemId && !row.deletedAt);
      if (!item) return setError('Selecciona el producto exacto del catálogo.');
      setLine(current => ({ ...current, description: item.name })); advance(item.name, 'quantity'); return;
    }
    if (['quantity', 'unitPriceBs', 'guaranteeBs'].includes(step)) {
      const number = voiceNumber(value);
      if (number == null || number < 0 || number > 10000000 || (step === 'quantity' && (!Number.isInteger(number) || number < 1 || number > 100000))) return setError('Revisa el número. Usa cifras, por ejemplo 260 o 2,50.');
      if (step === 'guaranteeBs') { setDraft(current => ({ ...current, guaranteeBs: number })); advance(String(number), 'review'); }
      else if (step === 'quantity') { setLine(current => ({ ...current, quantity: number })); advance(String(number), 'unitPriceBs'); }
      else { setDraft(current => ({ ...current, items: [...current.items, { ...line, unitPriceBs: number }] })); advance(String(number), 'more'); }
      return;
    }
    if (step === 'more') {
      if (/^s[ií]\b/i.test(value)) { setLine({ description: '', selectedItemId: '', quantity: '', unitPriceBs: '' }); advance('Sí', 'description'); }
      else if (/^no\b/i.test(value)) advance('No', 'guaranteeBs');
      else setError('Responde sí o no.');
      return;
    }
    let parsed = value;
    if (step === 'eventDate') { parsed = voiceDate(value); if (!parsed) return setError('Indica una fecha completa, por ejemplo 21 de noviembre de 2026 o 21/11/2026.'); }
    if (step === 'customerName' && !value) return setError('Completa el nombre del cliente.');
    if (step === 'customerPhone' && value && !/^[\d\s+()-]{6,25}$/.test(value)) return setError('Revisa el teléfono y escríbelo con cifras.');
    if (step === 'responsibleId') {
      const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.!?]+$/, '').trim();
      const candidates = responsibles.filter(row => row.id === value || (value && normalize(value).split(/\s+/).every(word => normalize(row.name).split(/\s+/).includes(word))));
      if (value && candidates.length !== 1) return setError('Hay varias coincidencias o ninguna. Selecciona una persona de la lista.');
      parsed = candidates[0]?.id || '';
    }
    if (step === 'logisticsMode') {
      if (/recog|recoj|retir/i.test(value)) parsed = 'recojo';
      else if (/env[ií]|entrega/i.test(value)) parsed = 'envio';
      else return setError('Indica cliente recoge o envío por el equipo.');
    }
    setDraft(current => ({ ...current, [step]: parsed }));
    const next = { customerName: 'customerPhone', customerPhone: 'eventDate', eventDate: 'address', address: canChooseResponsibles ? 'responsibleId' : 'logisticsMode', responsibleId: 'logisticsMode', logisticsMode: 'description' }[step];
    advance(step === 'responsibleId' ? responsibles.find(row => row.id === parsed)?.name : value, next);
  };
  const back = index => {
    stop(); window.speechSynthesis?.cancel(); const entry = history[index];
    // Re-answering an earlier question rebuilds subsequent lines to avoid stale quantities.
    if (['description','quantity','unitPriceBs','more'].includes(entry.step) || ['customerName','customerPhone','eventDate','address','responsibleId','logisticsMode'].includes(entry.step)) {
      const completed = history.slice(0, index).filter(row => row.step === 'unitPriceBs').length;
      const currentLine = draft.items[completed];
      setLine(currentLine || (['quantity', 'unitPriceBs'].includes(entry.step) ? line : { description: '', selectedItemId: '', quantity: '', unitPriceBs: '' }));
      setDraft(current => ({ ...current, items: current.items.slice(0, completed) }));
    }
    setStep(entry.step); setHistory(rows => rows.slice(0, index)); editAnswer(''); setError(''); setConfirmed(false);
  };
  const matches = matchPhotoItems(answer || line.description, items);
  const finish = async () => {
    stop(); setOpening(true); setError('');
    try { await onContinue({ ...draft, contractCode: '', customerCi: '', initialPaymentBs: 0, warnings: ['Confirmar entrega, devolución, disponibilidad y proveedores antes de crear.'], uncertainFields: [], notes: 'Preparado con asistente de voz; respuestas revisadas. No acredita pagos.', items: draft.items.map((row, index) => ({ ...row, key: `voice-${index}`, excluded: false })) }); }
    catch (cause) { setError(cause.message || 'No se pudo preparar el contrato.'); }
    finally { setOpening(false); }
  };
  return <div className="orders-modal-backdrop contract-photo-backdrop"><section className="contract-voice-modal" role="dialog" aria-modal="true" aria-labelledby="voice-title">
    <header><h2 id="voice-title">Contrato por voz</h2><button type="button" className="ghost-button" disabled={opening} onClick={onClose}>Cerrar</button></header>
    <p>Responde por voz o escribe. El dictado puede enviar audio al servicio del navegador; no usa una API de pago de Copetín. Revisa nombres y cifras.</p>
    <label><input type="checkbox" checked={spokenQuestions} onChange={e => setSpokenQuestions(e.target.checked)} /> Leer las preguntas en voz alta</label>
    <div className="voice-history">{history.map((entry, index) => <div key={index}><strong>{entry.question}</strong><p>{entry.answer}</p><button type="button" className="ghost-button" disabled={opening} onClick={() => back(index)}>Corregir desde aquí</button></div>)}</div>
    <h3 ref={questionRef} aria-live="polite">{questions[step]}</h3>
    <button type="button" className="ghost-button" onClick={() => { stop(); window.speechSynthesis?.cancel(); if (window.SpeechSynthesisUtterance) { const utterance = new window.SpeechSynthesisUtterance(questions[step]); utterance.lang = 'es-BO'; window.speechSynthesis?.speak(utterance); } }}>Escuchar pregunta</button>
    {error && <p role="alert" className="contract-photo-error">{error}</p>}
    {step !== 'review' ? <form onSubmit={submit}>
      <label>Tu respuesta<textarea autoFocus value={answer} onChange={e => { editAnswer(e.target.value); if (step === 'description') setLine(current => ({ ...current, selectedItemId: '' })); }} maxLength={500} /></label>
      {interim && <p role="status">{interim}</p>}
      {step === 'responsibleId' && <select aria-label="Responsable" value={answer} onChange={e => editAnswer(e.target.value)}><option value="">Mi asignación habitual</option>{responsibles.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
      {step === 'description' && <label>Producto exacto<select value={line.selectedItemId} onChange={e => setLine(current => ({ ...current, selectedItemId: e.target.value }))}><option value="">Selecciona una coincidencia</option>{matches.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
      <div className="voice-actions">{Speech ? <button type="button" className="ghost-button" onClick={listening ? () => recognition.current?.stop() : listen}>{listening ? 'Terminar dictado' : 'Responder con micrófono'}</button> : <p>Este navegador no ofrece dictado. Puedes escribir las respuestas.</p>}<button type="submit" className="primary-button" disabled={listening}>Confirmar respuesta</button></div>
    </form> : <div><p><strong>{draft.customerName}</strong> · {draft.eventDate} · {draft.address}</p><p>{draft.logisticsMode === 'recojo' ? 'Cliente recoge y devuelve' : 'Envío por el equipo'}</p><ul>{draft.items.map((row, i) => <li key={i}>{row.quantity} × {row.description} · Bs {row.unitPriceBs} = Bs {(row.quantity * row.unitPriceBs).toFixed(2)}</li>)}</ul><p>Alquiler: Bs {draft.items.reduce((sum, row) => sum + row.quantity * row.unitPriceBs, 0).toFixed(2)} · Garantía: Bs {draft.guaranteeBs}</p><p>Sin pago inicial registrado. Entrega, devolución y proveedores se revisan en el editor.</p><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Revisé nombres, productos, cantidades y precios.</label><button type="button" className="primary-button" disabled={!confirmed || opening} onClick={finish}>{opening ? 'Preparando…' : 'Revisar contrato completo'}</button></div>}
  </section></div>;
}
