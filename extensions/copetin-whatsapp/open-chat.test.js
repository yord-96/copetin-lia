import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { openChatWithoutReload } from './open-chat.js';

const executablePath = [process.env.CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(value => value && existsSync(value));

test('new unsaved number opens through its Chat action without a previous conversation', { skip: !executablePath }, async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    for (const label of ['Chatear', 'Chat', 'Conversar']) {
      await page.setContent(`<div id="app">
        <button aria-label="Nuevo chat" onclick="document.querySelector('#drawer').hidden=false">+</button>
        <div role="dialog" id="drawer" hidden>
          <div contenteditable="true" role="textbox" aria-label="Buscar nombre o número"></div>
          <section id="results" hidden><h2>No está en tus contactos</h2>
            <div><span>+591 77777777</span><button onclick="window.wrong=true">${label}</button></div>
            <div><span>+591 79352585</span><button onclick="window.invited=true">Invitar</button><button aria-label="${label}" onclick="window.opened=true;document.querySelector('#main header').innerHTML='<span>+591 79352585</span>'">${label}</button></div>
          </section>
        </div>
        <div id="main"><header>Other chat</header><footer><div contenteditable="true">Unsent draft</div></footer></div>
      </div><script>
        window.marker = {};
        document.querySelector('[role=textbox]').addEventListener('input', () => setTimeout(() => document.querySelector('#results').hidden=false, 100));
      </script>`);
      const url = page.url();
      assert.equal(await page.evaluate(openChatWithoutReload, '59179352585'), true);
      assert.equal(page.url(), url);
      assert.equal(await page.evaluate(() => window.opened), true);
      assert.equal(await page.evaluate(() => window.wrong || window.invited || false), false);
      assert.equal(await page.$eval('footer [contenteditable]', el => el.textContent), 'Unsent draft');
    }
  } finally { await browser.close(); }
});
