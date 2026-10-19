/* global chrome */
import { navigateToContact } from './navigation.js';

const extensionApi = globalThis.browser || chrome;
extensionApi.runtime.onMessage.addListener((request, sender, respond) => {
  navigateToContact(extensionApi, request, sender)
    .then(result => respond({ result }))
    .catch(error => respond({ error: error.message }));
  return true;
});
