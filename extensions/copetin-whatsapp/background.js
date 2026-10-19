/* global chrome */
import { navigateToContact } from './navigation.js';

chrome.runtime.onMessage.addListener((request, sender, respond) => {
  navigateToContact(chrome, request, sender)
    .then(result => respond({ result }))
    .catch(error => respond({ error: error.message }));
  return true;
});
