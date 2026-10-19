import { openChatWithoutReload } from './open-chat.js';
const allowedOrigins = new Set(['https://tucopetin.com', 'https://www.tucopetin.com']);

export async function navigateToContact(browser, request, sender) {
  if (!sender.tab || sender.frameId !== 0 || !allowedOrigins.has(new URL(sender.url).origin)) {
    throw new Error('Origen no autorizado.');
  }
  if (typeof request.phone !== 'string' || !/^[1-9]\d{7,14}$/.test(request.phone)) {
    throw new Error('El número de teléfono no es válido.');
  }
  const tabs = (await browser.tabs.query({ url: 'https://web.whatsapp.com/*' }))
    .filter(tab => tab.incognito === sender.tab.incognito)
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  if (request.tabId === undefined && tabs.length > 1) {
    return { tabs: tabs.map((tab, index) => ({ id: tab.id, label: `WhatsApp ${index + 1}`, detail: `${tab.windowId === sender.tab.windowId ? 'Esta ventana' : 'Otra ventana'} · pestaña ${tab.index + 1}` })) };
  }
  const target = request.tabId === undefined ? tabs[0] : tabs.find(tab => tab.id === request.tabId);
  if (request.tabId !== undefined && !target) throw new Error('Esa pestaña ya no está disponible. Vuelve a presionar el botón.');
  const url = `https://web.whatsapp.com/send?phone=${request.phone}`;
  const tab = target
    ? await browser.tabs.update(target.id, { active: true })
    : await browser.tabs.create({ url, active: true, windowId: sender.tab.windowId });
  await browser.windows.update(tab.windowId, { focused: true });
  if (target) {
    const results = await browser.scripting.executeScript({ target: { tabId: target.id }, func: openChatWithoutReload, args: [request.phone] });
    if (results[0]?.result !== true) throw new Error('WhatsApp no confirmó la apertura del chat. No se recargó la página.');
  }
  return { opened: true, reused: Boolean(target) };
}
