import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createContractPhotoRouter } from './contractPhotos.js';

test('photo jobs are protected, bounded, cancellable and never block normal application requests', async () => {
  let finish, reads = 0;
  const app = express();
  app.use(createContractPhotoRouter({ env: { APP_INTERNAL_KEY: 'test' }, statusReader: async () => ({ ready: true }), reader: async (_buffer, _mime, { signal }) => {
    reads++;
    return new Promise((resolve, reject) => { finish = resolve; signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }); });
  } }));
  app.get('/normal-work', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const prefix = `${base}/__copetin_db/contract-photo`;
  const headers = { 'X-App-Internal-Key': 'test', 'Content-Type': 'image/jpeg' };
  const image = Buffer.from([0xff, 0xd8, 0xff, 0, 0]);
  try {
    assert.equal((await fetch(`${prefix}/status`)).status, 403);
    assert.equal((await fetch(`${prefix}/jobs`, { method: 'POST', headers, body: Buffer.from('invalid') })).status, 400);
    const start = await fetch(`${prefix}/jobs`, { method: 'POST', headers, body: image });
    assert.equal(start.status, 202); const job = await start.json();
    assert.equal(reads, 1);
    assert.equal((await fetch(`${prefix}/jobs`, { method: 'POST', headers, body: image })).status, 429);
    assert.deepEqual(await (await fetch(`${base}/normal-work`)).json(), { ok: true });
    assert.equal((await (await fetch(`${prefix}/jobs/${job.id}`, { headers })).json()).status, 'reading');
    finish({ contractCode: '3506', items: [] });
    await new Promise(resolve => setTimeout(resolve, 10));
    const ready = await (await fetch(`${prefix}/jobs/${job.id}`, { headers })).json();
    assert.equal(ready.status, 'ready'); assert.equal(ready.extraction.contractCode, '3506');
    assert.equal((await fetch(`${prefix}/jobs/${job.id}`, { method: 'DELETE', headers })).status, 200);
    assert.equal((await fetch(`${prefix}/jobs/${job.id}`, { headers })).status, 404);
    const next = await (await fetch(`${prefix}/jobs`, { method: 'POST', headers, body: image })).json();
    await fetch(`${prefix}/jobs/${next.id}`, { method: 'DELETE', headers });
    assert.equal((await fetch(`${prefix}/jobs/${next.id}`, { headers })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('uninstalled reader reports 503 instead of pretending to read the image', async () => {
  const app = express(); app.use(createContractPhotoRouter({ env: {}, statusReader: async () => ({ ready: false, message: 'Instala Ollama local.' }), reader: () => { throw Error('must not run'); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/__copetin_db/contract-photo/jobs`, {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.from([0xff, 0xd8, 0xff]),
    });
    assert.equal(response.status, 503); assert.match((await response.json()).error, /Instala Ollama/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
