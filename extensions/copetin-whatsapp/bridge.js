/* global chrome */
// Only the main Copetín page can request navigation. No WhatsApp content script.
if (window === window.top) {
  let busy = false;
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const request = event.data;
    if (request?.source !== 'copetin-whatsapp-app' || typeof request.id !== 'string' || request.id.length > 100) return;
    const respond = data => window.postMessage({ source: 'copetin-whatsapp-extension', id: request.id, ...data }, location.origin);
    if (busy) return respond({ error: 'Espera a que termine la apertura anterior.' });
    busy = true;
    respond({ pending: true });
    try {
      const response = await chrome.runtime.sendMessage({ phone: request.phone, tabId: request.tabId });
      respond(response);
    } catch {
      respond({ error: 'La extensión se actualizó. Actualiza la página de El Copetín e inténtalo otra vez.' });
    } finally {
      busy = false;
    }
  });
}
