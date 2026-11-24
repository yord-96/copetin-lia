// Read-only HTTP benchmark using a private copy, never the production state.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import express from 'express';

const source = process.argv[2];
if (!source) throw new Error('Indica un respaldo JSON para medir la sincronización.');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-sync-benchmark-'));
process.env.APP_STATE_FILE = path.join(directory, 'state.json');
process.env.APP_INTERNAL_KEY = 'benchmark-local';
let server;
try {
  await fs.copyFile(source, process.env.APP_STATE_FILE);
  const { default: routes } = await import('../server/routes/state.js');
  const app = express(); app.use(routes);
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const measure = async route => {
    const start = performance.now();
    const response = await fetch(base + route, { headers: { 'X-App-Internal-Key': 'benchmark-local', 'Accept-Encoding': 'gzip' } });
    const firstByteMs = Math.round(performance.now() - start);
    const hash = crypto.createHash('sha256'); let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; hash.update(chunk); }
    return { status: response.status, firstByteMs, totalMs: Math.round(performance.now() - start), bytes, sha256: hash.digest('hex') };
  };
  await measure('/__copetin_db?meta=1');
  const start = performance.now(); let timerDelayMs;
  const results = await Promise.all([
    measure('/__copetin_db?bootstrap=1'),
    new Promise(resolve => setTimeout(resolve, 50)).then(() => {
      timerDelayMs = Math.round(performance.now() - start - 50);
      return measure('/__copetin_db?meta=1');
    }),
  ]);
  console.log(JSON.stringify({ bootstrap: results[0], metaDuringBootstrap: results[1], timerDelayMs, rssMb: Math.round(process.memoryUsage().rss / 1048576) }, null, 2));
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}
