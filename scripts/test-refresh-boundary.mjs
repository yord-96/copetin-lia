import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const executablePath = [
  process.env.BROWSER_EXECUTABLE_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((candidate) => candidate && fs.existsSync(candidate));
assert.ok(executablePath, 'Define BROWSER_EXECUTABLE_PATH para ejecutar la prueba.');

const fixture = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import RefreshBoundary from '/src/components/common/RefreshBoundary.jsx';
window.mounts = 0;
window.unmounts = 0;
function Editor({ revision }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('contratos');
  useEffect(() => { window.mounts++; return () => { window.unmounts++; }; }, []);
  return <section>
    <select id="filter" value={filter} onChange={e => setFilter(e.target.value)}>
      <option value="contratos">Contratos</option><option value="cotizaciones">Cotizaciones</option>
    </select>
    <button id="open" onClick={() => setOpen(true)}>Crear contrato</button>
    {open && <div role="dialog"><input id="draft" value={name} onChange={e => setName(e.target.value)} /></div>}
    <span id="revision">{revision}</span>
  </section>;
}
const app = createRoot(document.getElementById('root'));
window.refresh = (loading, revision, error = '') => app.render(<>
  <p id="error">{error}</p>
  <RefreshBoundary loading={loading} fallback={<p id="loading">Cargando Ordenes...</p>}>
    <Editor revision={revision} />
  </RefreshBoundary>
</>);
window.refresh(true, 0);
`;

const server = await createServer({
  root,
  configFile: false,
  plugins: [react(), {
    name: 'refresh-regression-fixture',
    resolveId(id) { if (id === '/refresh-test.jsx') return `${root.replaceAll('\\', '/')}/refresh-test.jsx`; },
    load(id) { if (id.endsWith('/refresh-test.jsx')) return fixture; },
    configureServer(devServer) {
      devServer.middlewares.use('/refresh-test', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(await devServer.transformIndexHtml('/refresh-test',
          '<div id="root"></div><script type="module" src="/refresh-test.jsx"></script>'));
      });
    },
  }],
  server: { host: '127.0.0.1', port: 0, open: false },
});
let browser;
try {
  await server.listen();
  browser = await puppeteer.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}refresh-test`);
  await page.waitForSelector('#loading');
  assert.equal(await page.$('#open'), null, 'La carga inicial espera los datos.');
  await page.evaluate(() => window.refresh(false, 1));
  await page.waitForSelector('#open');
  await page.select('#filter', 'cotizaciones');

  // Una actualizacion estando inactivo conserva la vista seleccionada.
  await page.evaluate(() => window.refresh(true, 1));
  await page.waitForFunction(() => !document.querySelector('#loading'));
  await page.evaluate(() => window.refresh(false, 2));
  await page.waitForFunction(() => document.querySelector('#revision')?.textContent === '2');
  assert.equal(await page.$eval('#filter', (element) => element.value), 'cotizaciones');

  await page.click('#open');
  await page.type('#draft', 'Contrato sin guardar 1759');
  for (const [revision, error] of [[3, ''], [3, '502 Bad Gateway'], [4, '']]) {
    await page.evaluate((value) => window.refresh(true, value), revision);
    assert.equal(await page.$eval('#draft', (element) => element.value), 'Contrato sin guardar 1759');
    await page.evaluate((value, message) => window.refresh(false, value, message), revision, error);
    await page.waitForFunction((message) => document.querySelector('#error')?.textContent === message, {}, error);
    assert.equal(await page.$eval('#draft', (element) => element.value), 'Contrato sin guardar 1759');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'draft');
  }
  assert.deepEqual(await page.evaluate(() => [window.mounts, window.unmounts]), [1, 0]);
  assert.deepEqual(errors, []);
  console.log('OK: carga inicial, refresco inactivo, formulario, foco y filtros conservados tras exito, error 502 y recuperacion.');
} finally {
  await browser?.close();
  await server.close();
}
