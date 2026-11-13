import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceTurn } from './contractVoiceSession.js';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture() {
  const instances = [], replies = [], statuses = [], errors = [];
  class Speech { constructor() { instances.push(this); } start() { this.onstart?.(); } abort() { this.aborted = true; this.onend?.(); } }
  class Utterance { constructor(text) { this.text = text; } }
  const synthesis = { utterance: null, speak(value) { this.utterance = value; }, cancel() {} };
  const options = { Speech, Utterance, synthesis, prompt: 'Pregunta', onReply: value => replies.push(value), onStatus: (...value) => statuses.push(value), onError: value => errors.push(value) };
  return { instances, replies, statuses, errors, synthesis, options };
}
test('microphone waits for the spoken question, then final response is accepted once', async () => {
  const f = fixture(); const cancel = createVoiceTurn(f.options);
  try {
    await wait(20); assert.equal(f.instances.length, 0); f.synthesis.utterance.onend(); await wait(340);
    assert.equal(f.instances.length, 1);
    const rec = f.instances[0]; const result = [{ transcript: '21 de noviembre del 2026' }]; result.isFinal = true;
    rec.onresult({ results: [result] }); rec.onend(); rec.onend();
    assert.deepEqual(f.replies, ['21 de noviembre del 2026']);
  } finally { cancel(); }
});
test('pause cancels pending microphone startup and ignores late events', async () => {
  const f = fixture(); const cancel = createVoiceTurn(f.options);
  await wait(20); const utterance = f.synthesis.utterance; cancel(); utterance.onend(); await wait(340);
  assert.equal(f.instances.length, 0); assert.deepEqual(f.replies, []);
  const g = fixture(); const stop = createVoiceTurn({ ...g.options, synthesis: null }); await wait(20);
  const rec = g.instances[0]; stop(); const result = [{ transcript: 'respuesta tardía' }]; result.isFinal = true;
  rec.onresult({ results: [result] }); rec.onend();
  assert.deepEqual(g.replies, []); assert.equal(rec.aborted, true);
});
test('denied permission pauses and does not retry the microphone', async () => {
  const f = fixture(); const cancel = createVoiceTurn({ ...f.options, synthesis: null });
  try { await wait(20); f.instances[0].onerror({ error: 'not-allowed' }); f.instances[0].onend(); await wait(750);
    assert.equal(f.instances.length, 1); assert.equal(f.errors.length, 1); assert.match(f.errors[0], /permiso/);
  } finally { cancel(); }
});
