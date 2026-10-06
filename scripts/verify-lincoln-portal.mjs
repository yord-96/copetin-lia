// Isolated browser smoke test. Requires npm run build; never reads or edits business data.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import express from 'express';
import bcrypt from 'bcryptjs';
import puppeteer from 'puppeteer-core';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lincoln-portal-ui-'));
process.env.APP_STATE_FILE = path.join(temporary, 'app.json');
process.env.LINCOLN_STATE_FILE = path.join(temporary, 'lincoln.json');
process.env.LINCOLN_PORTAL_FILE = path.join(temporary, 'portal.json');
let browser, server;
try {
  await fs.writeFile(process.env.APP_STATE_FILE, JSON.stringify({ state: { users: [] }, version: 1 }));
  await fs.writeFile(process.env.LINCOLN_STATE_FILE, JSON.stringify({ state: { events: [{ id: 'demo', code: '0024', clientName: 'Evento de prueba', eventType: 'Boda', roomName: 'Salón Grande', eventDate: '2026-10-24' }] }, version: 1 }));
  await fs.writeFile(process.env.LINCOLN_PORTAL_FILE, JSON.stringify({ accounts: [{ id: 'client-demo', username: 'demo', name: 'Cliente de prueba', eventId: 'demo', credentialVersion: 1, active: true, passwordHash: await bcrypt.hash('demo-password', 4) }], plans: {}, sessions: [] }));
  const { default: routes } = await import('../server/routes/lincolnPortal.js');
  const app = express(); app.use(express.json()); app.use(routes); app.use(express.static(path.resolve('dist'))); app.get('/lincoln/mi-evento', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 });
  // A production build can contain VITE_API_URL. Redirect all portal calls to the fixture server.
  await page.evaluateOnNewDocument((origin) => {
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(String(input), window.location.origin);
      return fetch(url.pathname.startsWith('/api/lincoln-portal') ? `${origin}${url.pathname}${url.search}` : input, init);
    };
  }, `http://127.0.0.1:${server.address().port}`);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const clickText = async (text) => {
    const handles = await page.$$('button');
    for (const handle of handles) { if ((await handle.evaluate((node) => node.textContent)).trim() === text) { await handle.click(); return; } }
    throw new Error(`Button not found: ${text}`);
  };
  await page.goto(`http://127.0.0.1:${server.address().port}/lincoln/mi-evento`);
  await page.type('input[autocomplete=username]', 'demo'); await page.type('input[type=password]', 'demo-password'); await clickText('Ingresar');
  await page.waitForSelector('.lp-editor', { timeout: 10000 }).catch(async (error) => { console.log(await page.$eval('body', (node) => node.innerText)); throw error; });
  assert.equal(await page.$$eval('.lp-table-wrap tbody tr', (rows) => rows.length), 5);
  await clickText('Invitados'); await clickText('+ Agregar'); await page.type('textarea[aria-label="Nombre completo"]', 'Invitado de prueba');
  await page.select('select[aria-label="Confirmación"]', 'Sí');
  await clickText('Croquis del salón'); await clickText('+ Mesa redonda'); await clickText('+ Escenario'); await clickText('+ Pista de baile');
  await page.$eval('.lp-properties input', (input) => input.focus());
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.type('Pista central');
  await clickText('+ Silla');
  const initialPosition = await page.$eval('.lp-plan g[role=button]:last-of-type', (node) => node.getAttribute('transform'));
  const position = await page.$eval('.lp-plan g[role=button]:last-of-type', (node) => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(position.x, position.y); await page.mouse.down(); await page.mouse.move(position.x + 100, position.y + 60, { steps: 5 }); await page.mouse.up();
  await clickText('Guardar cambios'); await page.waitForSelector('.lp-success');
  const state = JSON.parse(await fs.readFile(process.env.LINCOLN_PORTAL_FILE, 'utf8'));
  assert.equal(state.plans.demo.plan.guests[0].name, 'Invitado de prueba');
  assert.equal(state.plans.demo.plan.layout.objects.length, 4);
  assert.notEqual(`translate(${state.plans.demo.plan.layout.objects.find((item) => item.type === 'chair').x} ${state.plans.demo.plan.layout.objects.find((item) => item.type === 'chair').y}) rotate(0)`, initialPosition);
  await page.screenshot({ path: path.join(temporary, 'desktop.png'), fullPage: true });
  await page.reload(); await page.waitForSelector('.lp-editor'); await clickText('Croquis del salón');
  assert.equal(await page.$$eval('.lp-plan g[role=button]', (nodes) => nodes.length), 4);
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await page.screenshot({ path: path.join(temporary, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'Login, guests, drag, save, reload and mobile layout verified', screenshots: temporary }));
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  // Keep screenshots for visual inspection. Isolated fixture files stay in the OS temp directory.
}
