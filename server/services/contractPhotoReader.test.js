import test from 'node:test';
import assert from 'node:assert/strict';
import { readContractPhoto, readerConfig, contractPhotoReaderStatus, contractPhotoSchema } from './contractPhotoReader.js';
const extraction = Object.fromEntries(Object.keys(contractPhotoSchema.shape).map(key => [key, ['warnings', 'uncertainFields', 'items'].includes(key) ? [] : null]));

test('local Ollama receives the image and schema with no paid API and no database catalog', async () => {
  let sent;
  const result = await readContractPhoto(Buffer.from('photo'), 'image/jpeg', { env: {}, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat'); sent = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, undefined);
    return new Response(JSON.stringify({ done: true, message: { content: JSON.stringify(extraction) } }));
  } });
  assert.deepEqual(result, extraction); assert.equal(sent.model, 'qwen3-vl:2b');
  assert.equal(sent.messages[1].images[0], Buffer.from('photo').toString('base64'));
  assert.match(sent.messages[0].content, /PREIMPRESAS VACÍAS/);
  assert.equal(sent.keep_alive, 0); assert.equal(sent.options.num_thread, 1);
  assert.equal(sent.format.additionalProperties, false);
});
test('missing local reader, missing model, invalid results and cloud config report actionable errors', async () => {
  assert.throws(() => readerConfig({ CONTRACT_PHOTO_OLLAMA_URL: 'https://ollama.com' }), /local/);
  assert.throws(() => readerConfig({ CONTRACT_PHOTO_MODEL: 'something-cloud' }), /gratuitos/);
  const status = await contractPhotoReaderStatus({ env: {}, fetchImpl: async () => { throw Error('offline'); } });
  assert.equal(status.ready, false); assert.match(status.message, /Ollama/);
  await assert.rejects(readContractPhoto(Buffer.from('photo'), 'image/jpeg', { env: {}, fetchImpl: async () => new Response('{}', { status: 404 }) }), /no está instalado/);
  await assert.rejects(readContractPhoto(Buffer.from('photo'), 'image/jpeg', { env: {}, fetchImpl: async () => new Response(JSON.stringify({ message: { content: '{"items":[]}' } })) }), /lectura válida/);
});
test('schema refuses fabricated strings as quantities and incomplete generation', async () => {
  assert.equal(contractPhotoSchema.safeParse({ ...extraction, items: [{ description: 'Mesa', printedLabel: null, quantity: '10', unitPriceBs: 2, writtenTotalBs: 20, uncertain: false }] }).success, false);
  await assert.rejects(readContractPhoto(Buffer.from('photo'), 'image/jpeg', { env: {}, fetchImpl: async () => new Response(JSON.stringify({ done_reason: 'length' })) }), /incompleta/);
});
