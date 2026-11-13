// One conversational turn. All listeners/timers belong to this turn, so late
// browser events cannot answer the next question or restart a paused microphone.
export function createVoiceTurn({ Speech, Utterance, synthesis, prompt, onReply, onStatus, onError }) {
  let cancelled = false, recognition = null, timer = null, watchdog = null, retries = 0;
  const schedule = (fn, delay = 200) => { clearTimeout(timer); timer = setTimeout(() => { if (!cancelled) fn(); }, delay); };
  const fail = message => { if (!cancelled) { onStatus('paused'); onError(message); } };
  const listen = () => {
    if (cancelled) return;
    let finalText = '', handled = false, fatal = false;
    const rec = new Speech(); recognition = rec;
    rec.lang = 'es-BO'; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => { if (!cancelled) onStatus('listening'); };
    rec.onresult = event => {
      if (cancelled || handled) return;
      finalText = ''; let interim = '';
      for (let i = 0; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) finalText += `${event.results[i][0].transcript} `;
        else interim += event.results[i][0].transcript;
      }
      onStatus('listening', `${finalText}${interim}`.trim());
    };
    rec.onerror = event => {
      if (cancelled || event.error === 'aborted' || event.error === 'no-speech') return;
      fatal = true;
      fail(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'El navegador no permitió el micrófono. Revisa el permiso y pulsa Reanudar conversación.'
        : `Se pausó el dictado (${event.error}). Puedes reanudar o escribir tu respuesta.`);
    };
    rec.onend = () => {
      if (cancelled || fatal || handled) return;
      handled = true;
      if (finalText.trim()) { onStatus('processing', finalText.trim()); onReply(finalText.trim()); }
      else if (retries++ < 2) schedule(listen, 700);
      else fail('No se escuchó una respuesta. La conversación está pausada; puedes reanudarla cuando estés listo.');
    };
    try { rec.start(); } catch { fail('No se pudo iniciar el micrófono. Reanuda la conversación o escribe tu respuesta.'); }
  };
  schedule(() => {
    if (!Speech) { fail('Este navegador no ofrece dictado. Puedes completar las respuestas por escrito.'); return; }
    if (!Utterance || !synthesis || !prompt) { listen(); return; }
    const utterance = new Utterance(prompt); utterance.lang = 'es-BO';
    let finished = false;
    const finish = () => { if (cancelled || finished) return; finished = true; clearTimeout(watchdog); schedule(listen, 300); };
    utterance.onend = finish; utterance.onerror = finish;
    onStatus('speaking'); synthesis.cancel(); synthesis.speak(utterance);
    watchdog = setTimeout(() => { if (!cancelled && !finished) { synthesis.cancel(); finish(); } }, 35000);
  }, 0);
  return () => { cancelled = true; clearTimeout(timer); clearTimeout(watchdog); recognition?.abort(); synthesis?.cancel(); };
}
