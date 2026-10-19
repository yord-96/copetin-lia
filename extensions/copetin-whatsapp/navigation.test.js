import test from 'node:test';
import assert from 'node:assert/strict';
import { navigateToContact } from './navigation.js';

const sender = { url: 'https://tucopetin.com/', frameId: 0, tab: { windowId: 1, incognito: false } };
function fixture(tabs) {
  const calls = [];
  return { calls, tabs: {
    query: async () => tabs,
    update: async (id, options) => { calls.push(['update', id, options]); return { windowId: 1 }; },
    create: async options => { calls.push(['create', options]); return { windowId: 1 }; },
  }, windows: { update: async (...args) => calls.push(['focus', ...args]) }, scripting: { executeScript: async options => { calls.push(['script', options]); return [{ result: true }]; } } };
}
const existing = { id: 7, windowId: 1, index: 2, incognito: false };
test('existing WhatsApp is reused and focused without creating a duplicate', async () => {
  const browser = fixture([existing]);
  assert.deepEqual(await navigateToContact(browser, { phone: '59179352585' }, sender), { opened: true, reused: true });
  assert.equal(browser.calls[0][0], 'update');
  assert.equal(browser.calls[0][1], 7);
  assert.equal(browser.calls[0][2].url, undefined, 'existing tab must never navigate or reload');
  assert.equal(browser.calls[2][0], 'script');
  assert.deepEqual(browser.calls[2][1].args, ['59179352585']);
  assert.equal(browser.calls.length, 3);
});
test('multiple WhatsApp tabs require choice; stale choices never create duplicates', async () => {
  const browser = fixture([existing, { ...existing, id: 8 }]);
  const result = await navigateToContact(browser, { phone: '59179352585' }, sender);
  assert.equal(result.tabs.length, 2);
  assert.equal(browser.calls.length, 0);
  await assert.rejects(navigateToContact(browser, { phone: '59179352585', tabId: 99 }, sender));
  await navigateToContact(browser, { phone: '59179352585', tabId: 8 }, sender);
  assert.equal(browser.calls[0][1], 8);
});
test('only absent WhatsApp creates a tab; invalid requests cannot navigate', async () => {
  const browser = fixture([]);
  assert.equal((await navigateToContact(browser, { phone: '59179352585' }, sender)).reused, false);
  assert.equal(browser.calls[0][0], 'create');
  for (const invalid of [{ ...sender, url: 'https://evil.example' }, { ...sender, frameId: 1 }]) {
    await assert.rejects(navigateToContact(browser, { phone: '59179352585' }, invalid));
  }
  await assert.rejects(navigateToContact(browser, { phone: 'javascript:alert(1)' }, sender));
});

test('a changed WhatsApp UI fails without falling back to URL navigation', async () => {
  const browser = fixture([existing]);
  browser.scripting.executeScript = async () => { throw new Error('UI unavailable'); };
  await assert.rejects(navigateToContact(browser, { phone: '59179352585' }, sender), /UI unavailable/);
  assert.equal(browser.calls.some(call => call[0] === 'create'), false);
  assert.equal(browser.calls[0][2].url, undefined);
});
