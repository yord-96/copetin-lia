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
test('contact action reuses its named browser target and never sends a message', () => {
  let focused = false;
  const tab = { opener: {}, focus() { focused = true; } };
  const browser = { open(url, target) { assert.equal(url, 'https://web.whatsapp.com/send?phone=59179352585'); assert.equal(target, 'copetin-whatsapp-web'); return tab; } };
  openContractWhatsAppContact(getContractWhatsAppContacts({ customerPhone: '79352585' })[0], browser);
  assert.equal(tab.opener, null);
  assert.equal(focused, true);
});
