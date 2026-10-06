// Read-only benchmark of the real route against an isolated copy of a state file.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { performance } from 'node:perf_hooks';

const input = process.argv[2] || 'data/app-state.json';
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-orders-benchmark-'));
process.env.APP_STATE_FILE = path.join(temporary, 'state.json');
process.env.APP_INTERNAL_KEY = '';
let server;
try {
  await fs.copyFile(input, process.env.APP_STATE_FILE);
  const { default: routes } = await import('../server/routes/state.js');
  const app = express(); app.use(routes); app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const measure = async (route) => {
    const start = performance.now();
    const response = await fetch(base + route, { headers: { 'Accept-Encoding': 'gzip' } });
    const firstByteMs = performance.now() - start;
    const body = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { firstByteMs: Math.round(firstByteMs), totalMs: Math.round(performance.now() - start), bytes: body.length,
      sha256: crypto.createHash('sha256').update(body).digest('hex'), serverTiming: response.headers.get('Server-Timing') };
  };
  const timerStartedAt = performance.now();
  let timerDelayMs;
  const results = await Promise.all([
    measure('/__copetin_db/orders/mobile-overview'),
    new Promise((resolve) => setTimeout(resolve, 50)).then(() => {
      timerDelayMs = Math.round(Math.max(0, performance.now() - timerStartedAt - 50));
      return measure('/health');
    }),
  ]);
  console.log(JSON.stringify({ orders: results[0], healthDuringOrders: results[1], timerDelayMs }, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
