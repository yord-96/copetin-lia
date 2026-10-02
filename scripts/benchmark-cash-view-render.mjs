import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import puppeteer from 'puppeteer-core';

// Solo lectura del respaldo. El tiempo medido es el render, sin descarga JSON.
const backup = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const state = backup.state ?? backup;
const originalPath = 'src/components/sections/.benchmark-accounting-original.jsx';
await fs.writeFile(originalPath, execFileSync('git', ['show', `${process.argv[3] ?? '0636ba4'}:src/components/sections/AccountingSection.jsx`], { encoding: 'utf8', maxBuffer: 10_000_000 }));
const fixture = `
import React, { Profiler, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Current from '/src/components/sections/AccountingSection.jsx';
import Original from '/src/components/sections/.benchmark-accounting-original.jsx';
import { api } from '/src/services/api.js';
import '/src/App.css';
api.cash.getPettyCategories = async () => ({ categories: [] });
api.cash.getPettySector = async () => ({ rows: [], total: 0 });
api.cash.getDailyReport = async () => null;
const state = await fetch('/cash-benchmark-data').then(r => r.json());
const Section = location.search.includes('original') ? Original : Current;
const formatBs = n => 'Bs ' + Number(n).toFixed(2);
const formatDate = v => String(v ?? '');
function Fixture() {
  const [activeModule, setActiveModule] = useState('contabilidad_caja_grande');
  window.switchBox = setActiveModule;
  return <Profiler id="cash" onRender={(id, phase, duration) => {
    window.renderTimes ??= []; window.renderTimes.push({ phase, duration });
  }}><Section activeModule={activeModule} contracts={state.contracts ?? []}
    rentals={state.rentals ?? []} clients={state.clients ?? []}
    hiddenContracts={state.hiddenContracts ?? []} cashMovements={state.cashMovements ?? []}
    cashSessions={state.cashSessions ?? []} cashDebts={state.cashDebts ?? []}
    formatBs={formatBs} formatDate={formatDate} formatDateTime={formatDate}/></Profiler>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const server = await createServer({ configFile: false, plugins: [react(), {
  name: 'cash-render-benchmark',
  resolveId(id) { if (id.endsWith('/cash-benchmark.jsx')) return process.cwd().replaceAll('\\', '/') + '/cash-benchmark.jsx'; },
  load(id) { if (id.endsWith('/cash-benchmark.jsx')) return fixture; },
  configureServer(dev) {
    dev.middlewares.use('/cash-benchmark-data', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(state)); });
    dev.middlewares.use('/cash-render-view', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await dev.transformIndexHtml('/cash-benchmark', '<div id="root"></div><script type="module" src="/cash-benchmark.jsx"></script>'));
    });
  },
}], server: { host: '127.0.0.1', port: 0, open: false } });
let browser;
try {
  await server.listen();
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = {};
  for (const version of ['original', 'current']) {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => { errors.push(error.message); console.log(error.message); });
    page.on('console', message => { if (message.type() === 'error') console.log(message.text()); });
    await page.goto(server.resolvedUrls.local[0] + 'cash-render-view?' + version);
    await page.waitForFunction(() => window.renderTimes?.length > 0, { timeout: 60000 });
    results[version] = Math.round(await page.evaluate(() => window.renderTimes[0].duration));
    if (version === 'current') {
      for (const box of ['contabilidad_caja_chica', 'contabilidad_caja_grande']) {
        await page.evaluate(box => { window.renderTimes = []; window.switchBox(box); }, box);
        await page.waitForFunction(() => window.renderTimes.length > 0);
        console.log(box, Math.round(await page.evaluate(() => window.renderTimes[0].duration)), 'ms');
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Render inicial, respaldo completo (ms):', results);
  if (results.original > 1000) assert.ok(results.current < results.original / 2);
} finally {
  await browser?.close(); await server.close(); await fs.rm(originalPath, { force: true });
}
