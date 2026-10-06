import 'dotenv/config';
import { performance } from 'node:perf_hooks';

const base = `http://127.0.0.1:${process.env.PORT || 4000}`;
const headers = { 'X-App-Internal-Key': process.env.APP_INTERNAL_KEY || '', 'Accept-Encoding': 'gzip' };
async function measure(name, route) {
  const start = performance.now();
  const response = await fetch(base + route, { headers, signal: AbortSignal.timeout(60000) });
  const wait = performance.now() - start;
  // Consume the response without retaining the complete JSON in this process.
  let bytes = 0;
  for await (const chunk of response.body) bytes += chunk.length;
  console.log(name, {
    status: response.status,
    waitSeconds: (wait / 1000).toFixed(3),
    totalSeconds: ((performance.now() - start) / 1000).toFixed(3),
    bytes,
    serverTiming: response.headers.get('Server-Timing'),
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
}
await measure('HEALTH ANTES', '/health');
await Promise.all([
  measure('ORDENES', '/__copetin_db/orders/mobile-overview'),
  new Promise((resolve) => setTimeout(resolve, 500)).then(() => measure('HEALTH DURANTE ORDENES', '/health')),
]);
