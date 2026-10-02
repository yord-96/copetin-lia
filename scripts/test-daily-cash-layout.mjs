import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const executablePath = [process.env.BROWSER_EXECUTABLE_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium'].find((path) => path && fs.existsSync(path));
assert.ok(executablePath, 'Se necesita Chrome o Chromium para verificar el diseño.');
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import DailyCashTable from '/src/components/DailyCashTable.jsx';
import '/src/App.css';
import '/src/index.css';
const rows = Array.from({ length: 30 }, (_, id) => ({ id, ledgerSequence: 3278 + id, receipt: 'RC-13498', hour: '00:54',
  customer: 'MARIA ELIZABETH LLANOS', nature: 'Devoluciones de garantía', reference: '2767',
  method: 'QR · MERCANTIL', user: 'LISBETH MUÑOZ', refund: 150, expense: 150,
  fund: 5589, fundCash: 5589, fundDigital: 235, fundCashChange: -150, fundDigitalChange: 0 }));
createRoot(document.getElementById('root')).render(<main className="app-main">
  <header className="topbar"><div className="topbar-inner">El Copetín</div></header>
  <div className="app-content" style={{ marginLeft: 260 }}>
    <section className="accounting-bigcash-view bigcash-balanced-layout accounting-redesign">
      <div className="bigcash-daily-report"><div style={{ height: 300 }}>Reporte diario</div>
        <article className="bigcash-card daily-sector income-sector">
          <DailyCashTable allRows={rows} rows={rows} filters={{}} onFiltersChange={() => {}}
            formatBs={value => 'Bs ' + value.toLocaleString('es-BO', { minimumFractionDigits: 2 })} />
        </article>
      </div>
    </section>
  </div>
</main>);
`;
const server = await createServer({ root, configFile: false, plugins: [react(), {
  name: 'daily-layout-fixture',
  resolveId(id) { if (id === '/daily-fixture.jsx') return `${root.replaceAll('\\', '/')}/daily-fixture.jsx`; },
  load(id) { if (id.endsWith('/daily-fixture.jsx')) return fixture; },
  configureServer(devServer) {
    devServer.middlewares.use('/daily-layout', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await devServer.transformIndexHtml('/daily-layout',
        '<div id="root"></div><script type="module" src="/daily-fixture.jsx"></script>'));
    });
  },
}], server: { host: '127.0.0.1', port: 0, open: false } });
let browser;
try {
  await server.listen();
  browser = await puppeteer.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  page.on('pageerror', error => console.error(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  for (const width of [1920, 1440, 1024]) {
    await page.setViewport({ width, height: 1000 });
    await page.goto(`${server.resolvedUrls.local[0]}daily-layout`);
    await page.waitForSelector('.daily-report-table tbody tr');
    const layout = await page.evaluate(() => {
      const wrapper = document.querySelector('.daily-report-table-wrap');
      const cells = [...document.querySelectorAll('.daily-report-table th, .daily-report-table td')];
      return { rows: document.querySelectorAll('tbody tr').length,
        overflow: getComputedStyle(wrapper).overflowY,
        height: wrapper.clientHeight, contentHeight: wrapper.scrollHeight,
        clipped: cells.filter(cell => cell.scrollWidth > cell.clientWidth + 1).map(cell => [cell.className,cell.textContent,getComputedStyle(cell).whiteSpace,getComputedStyle(cell).overflowWrap,cell.clientWidth,cell.scrollWidth]) };
    });
    assert.equal(layout.rows, 30);
    assert.equal(layout.overflow, 'visible');
    assert.ok(layout.contentHeight <= layout.height + 2, 'Todas las filas se muestran sin scroll interno');
    assert.deepEqual(layout.clipped, [], `Celdas cortadas a ${width}px`);
    await page.evaluate(() => window.scrollTo(0, 800));
    const sticky = await page.evaluate(() => ({
      header: document.querySelector('thead th').getBoundingClientRect().top,
      topbar: document.querySelector('.topbar').getBoundingClientRect().bottom,
    }));
    assert.ok(Math.abs(sticky.header - sticky.topbar) < 2, `Encabezado visible a ${width}px: ${JSON.stringify(sticky)}`);
    if (process.env.DAILY_LAYOUT_SCREENSHOT) await page.screenshot({ path: `${process.env.DAILY_LAYOUT_SCREENSHOT}-${width}.png` });
    console.log(`Reporte diario ${width}px: 30 filas completas, sin celdas cortadas y encabezado fijo.`);
  }
} finally {
  await browser?.close();
  await server.close();
}
