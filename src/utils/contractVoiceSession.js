// One conversational turn. All listeners/timers belong to this turn, so late
// browser events cannot answer the next question or restart a paused microphone.
export function createVoiceTurn({ Speech, Utterance, synthesis, prompt, onReply, onStatus, onError, acceptInterim, recognitionTimeoutMs = 30000 }) {
  let cancelled = false, recognition = null, timer = null, watchdog = null, replyTimer = null, recognitionTimer = null, retries = 0;
  const clearRecognitionTimers = () => { clearTimeout(replyTimer); clearTimeout(recognitionTimer); };
  const schedule = (fn, delay = 200) => { clearTimeout(timer); timer = setTimeout(() => { if (!cancelled) fn(); }, delay); };
  const fail = message => { if (!cancelled) { onStatus('paused'); onError(message); } };
  const listen = () => {
    if (cancelled) return;
    let finalText = '', interimText = '', settlingText = '', handled = false, fatal = false;
    const rec = new Speech(); recognition = rec;
    const commit = text => {
      if (cancelled || handled || fatal) return;
      handled = true; clearRecognitionTimers();
      // Close before notifying React; late end/error/result events cannot submit twice.
      rec.abort(); onStatus('processing', text); onReply(text);
    };
    rec.lang = 'es-BO'; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => { if (!cancelled) onStatus('listening'); };
    rec.onresult = event => {
      if (cancelled || handled || fatal) return;
      finalText = ''; let interim = '';
      for (let i = 0; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) finalText += `${event.results[i][0].transcript} `;
        else interim += event.results[i][0].transcript;
      }
      onStatus('listening', `${finalText}${interim}`.trim());
      interimText = interim.trim();
      if (finalText.trim() && !interimText) commit(finalText.trim());
      else {
        const text = `${finalText}${interim}`.trim();
        // Only explicitly permitted short answers may settle without a final
        // browser result. Names, dates, quantities and money never use this path.
        if (text && acceptInterim?.(text)) {
          if (text !== settlingText) { clearTimeout(replyTimer); settlingText = text; replyTimer = setTimeout(() => commit(text), 900); }
        } else { settlingText = ''; clearTimeout(replyTimer); }
      }
    };
    rec.onerror = event => {
      if (cancelled || handled || event.error === 'aborted' || event.error === 'no-speech') return;
      fatal = true;
      clearRecognitionTimers();
      fail(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'El navegador no permitió el micrófono. Revisa el permiso y pulsa Reanudar conversación.'
        : `Se pausó el dictado (${event.error}). Puedes reanudar o escribir tu respuesta.`);
    };
    rec.onend = () => {
      if (cancelled || fatal || handled) return;
      clearRecognitionTimers();
      if (finalText.trim() && !interimText) { commit(finalText.trim()); return; }
      const text = `${finalText}${interimText}`.trim();
      if (text && acceptInterim?.(text)) { commit(text); return; }
      handled = true;
      if (text) fail('La transcripción no quedó confirmada. Revisa el texto y confirma la respuesta o reanuda la conversación.');
      else if (retries++ < 2) schedule(listen, 700);
      else fail('No se escuchó una respuesta. La conversación está pausada; puedes reanudarla cuando estés listo.');
    };
    recognitionTimer = setTimeout(() => {
      if (cancelled || handled || fatal) return;
      fatal = true; clearRecognitionTimers(); rec.abort();
      fail('El navegador no terminó de reconocer la respuesta. Puedes confirmar el texto en pantalla o reanudar la conversación.');
    }, recognitionTimeoutMs);
    try { rec.start(); } catch { fatal = true; clearRecognitionTimers(); fail('No se pudo iniciar el micrófono. Reanuda la conversación o escribe tu respuesta.'); }
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
  return () => { cancelled = true; clearTimeout(timer); clearTimeout(watchdog); clearRecognitionTimers(); recognition?.abort(); synthesis?.cancel(); };
}
