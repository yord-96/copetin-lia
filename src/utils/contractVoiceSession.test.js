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
test('a final result advances even when the browser never emits end', async () => {
  const f = fixture(); const cancel = createVoiceTurn({ ...f.options, synthesis: null });
  try {
    await wait(20); const rec = f.instances[0]; const result = [{ transcript: 'no' }]; result.isFinal = true;
    rec.onresult({ results: [result] });
    assert.deepEqual(f.replies, ['no']);
    rec.onresult({ results: [result] }); rec.onend();
    assert.deepEqual(f.replies, ['no']);
  } finally { cancel(); }
});
test('a stable permitted yes/no interim result advances without final or end events', async () => {
  const f = fixture(); const cancel = createVoiceTurn({ ...f.options, synthesis: null, acceptInterim: text => text === 'sí' });
  try {
    await wait(20); const result = [{ transcript: 'sí' }]; result.isFinal = false;
    f.instances[0].onresult({ results: [result] }); await wait(1000);
    assert.deepEqual(f.replies, ['sí']);
    f.instances[0].onend(); assert.deepEqual(f.replies, ['sí']);
  } finally { cancel(); }
});
test('a stuck recognizer times out without accepting provisional amounts', async () => {
  const f = fixture(); const cancel = createVoiceTurn({ ...f.options, synthesis: null, recognitionTimeoutMs: 60 });
  try {
    await wait(20); const result = [{ transcript: '200' }]; result.isFinal = false;
    f.instances[0].onresult({ results: [result] }); await wait(100);
    assert.deepEqual(f.replies, []); assert.equal(f.errors.length, 1); assert.equal(f.instances[0].aborted, true);
  } finally { cancel(); }
});
test('repeated unchanged interim answers settle and are cancelled when the user pauses', async () => {
  const f = fixture(); const cancel = createVoiceTurn({ ...f.options, synthesis: null, acceptInterim: text => text === 'no' });
  try {
    await wait(20); const result = [{ transcript: 'no' }]; result.isFinal = false;
    f.instances[0].onresult({ results: [result] }); await wait(550);
    f.instances[0].onresult({ results: [result] }); await wait(450);
    assert.deepEqual(f.replies, ['no']);
  } finally { cancel(); }
  const g = fixture(); const stop = createVoiceTurn({ ...g.options, synthesis: null, acceptInterim: () => true });
  await wait(20); const result = [{ transcript: 'sí' }]; result.isFinal = false;
  g.instances[0].onresult({ results: [result] }); stop(); await wait(1000);
  assert.deepEqual(g.replies, []);
});
test('changing interim yes/no into an uncertain phrase prevents automatic acceptance', async () => {
  const f = fixture(); const cancel = createVoiceTurn({ ...f.options, synthesis: null, acceptInterim: text => text === 'no' });
  try {
    await wait(20); const result = [{ transcript: 'no' }]; result.isFinal = false;
    f.instances[0].onresult({ results: [result] }); await wait(100);
    const changed = [{ transcript: 'no sé' }]; changed.isFinal = false;
    f.instances[0].onresult({ results: [changed] }); await wait(1000);
    assert.deepEqual(f.replies, []);
  } finally { cancel(); }
});
