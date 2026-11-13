import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from './api.js';

test('photo upload polls only the reader and releases the temporary result without creating records', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options?.method || 'GET']);
    if (options?.method === 'POST') return new Response(JSON.stringify({ id: 'job', status: 'reading' }), { status: 202 });
    if (options?.method === 'DELETE') return new Response('{"ok":true}');
    return new Response(JSON.stringify({ status: 'ready', extraction: { contractCode: '3506', items: [] } }));
  };
  try {
    const result = await api.contracts.readPhoto(new Blob(['photo'], { type: 'image/jpeg' }));
    assert.equal(result.contractCode, '3506');
    assert.deepEqual(calls, [['/__copetin_db/contract-photo/jobs', 'POST'],
      ['/__copetin_db/contract-photo/jobs/job', 'GET'], ['/__copetin_db/contract-photo/jobs/job', 'DELETE']]);
  } finally { globalThis.fetch = original; }
});
test('cancelling a reading aborts the job and never sends contract mutations', async () => {
  const original = globalThis.fetch, calls = [];
  const controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    calls.push([url, options?.method || 'GET']);
    if (options?.method === 'POST') return new Response('{"id":"cancel-job"}', { status: 202 });
    if (options?.method === 'DELETE') return new Response('{"ok":true}');
    return new Response('{"status":"reading"}');
  };
  try {
    await assert.rejects(api.contracts.readPhoto(new Blob(['photo'], { type: 'image/jpeg' }), {
      signal: controller.signal, onProgress: () => controller.abort(),
    }), error => error.name === 'AbortError');
    assert.equal(calls.at(-1)[1], 'DELETE');
    assert.ok(calls.every(([url]) => url.startsWith('/__copetin_db/contract-photo/')));
  } finally { globalThis.fetch = original; }
});
