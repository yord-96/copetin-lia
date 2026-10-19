import test from 'node:test';
import assert from 'node:assert/strict';
import { getContractWhatsAppContacts, openContractWhatsAppContact } from './contractWhatsApp.js';

test('contract main and reference phones use WhatsApp Web with Bolivia prefix', () => {
  const contacts = getContractWhatsAppContacts({ customerPhone: '79352585', customerReferencePhone: '73641372' });
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].phone, '59179352585');
  assert.equal(contacts[1].phone, '59173641372');
  assert.equal(contacts[0].url, 'https://web.whatsapp.com/send?phone=59179352585');
});
test('duplicate, international, absent and invalid numbers are handled', () => {
  assert.equal(getContractWhatsAppContacts({ customerPhone: '+591 79352585', customerReferencePhone: '00591 79352585' }).length, 1);
  assert.equal(getContractWhatsAppContacts({ customerPhone: 'N/A', customerReferencePhone: '123' }).length, 0);
  assert.equal(getContractWhatsAppContacts({ customerReferencePhone: '+34 612 345 678' })[0].phone, '34612345678');
});
test('contact bridge ignores foreign replies and passes tab choice to extension', async () => {
  let receive;
  let removed = false;
  const browser = {
    crypto: { randomUUID: () => 'request-1' }, location: { origin: 'https://tucopetin.com' },
    setTimeout: () => 1, clearTimeout() {},
    addEventListener(type, callback) { receive = callback; },
    removeEventListener() { removed = true; },
    postMessage(request, origin) {
      assert.equal(origin, this.location.origin);
      assert.equal(request.phone, '59179352585');
      assert.equal(request.tabId, 8);
      receive({ source: {}, origin, data: { source: 'copetin-whatsapp-extension', id: request.id, error: 'foreign' } });
      receive({ source: this, origin, data: { source: 'copetin-whatsapp-extension', id: request.id, result: { opened: true } } });
    },
  };
  assert.deepEqual(await openContractWhatsAppContact({ phone: '59179352585' }, browser, 8), { opened: true });
  assert.equal(removed, true);
});

test('missing extension fails explicitly without opening any browser tab', async () => {
  let expire;
  let removed = false;
  const browser = {
    crypto: { randomUUID: () => 'timeout' }, location: { origin: 'https://tucopetin.com' },
    setTimeout(callback) { expire = callback; return 1; }, clearTimeout() {},
    addEventListener() {}, removeEventListener() { removed = true; }, postMessage() {},
    open() { assert.fail('must never fall back to a duplicate tab'); },
  };
  const pending = openContractWhatsAppContact({ phone: '59179352585' }, browser);
  expire();
  await assert.rejects(pending, /Instala o activa/);
  assert.equal(removed, true);
});
