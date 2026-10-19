// Runs in WhatsApp's isolated extension world. Never accesses the message composer.
export async function openChatWithoutReload(phone) {
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw new Error('Número inválido.');
  const visible = element => element?.getClientRects().length > 0;
  const waitFor = async find => {
    const end = Date.now() + 12000;
    while (Date.now() < end) {
      const found = find();
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('No se pudo abrir el contacto sin recargar. Comprueba que WhatsApp esté conectado y vuelve a intentarlo.');
  };
  const labels = /^(nuevo chat|new chat|nova conversa)$/i;
  const newChat = [...document.querySelectorAll('button, [role="button"]')]
    .find(element => visible(element) && labels.test(element.getAttribute('aria-label') || element.getAttribute('title') || ''))
    || [...document.querySelectorAll('[data-icon="new-chat-outline"], [data-icon="new-chat"]')]
      .find(visible)?.closest('button, [role="button"]');
  if (!newChat) throw new Error('No se encontró Nuevo chat. Abre WhatsApp y espera a que termine de cargar.');
  newChat.click();
  const search = await waitFor(() => [...document.querySelectorAll('input, [contenteditable="true"][role="textbox"]')]
    .find(element => visible(element) && !element.closest('#main, footer') && /nombre|name|nome|número|number|número/i.test([
      element.getAttribute('aria-label'), element.getAttribute('placeholder'), element.getAttribute('data-placeholder'),
    ].join(' '))));
  search.focus();
  if (search instanceof HTMLInputElement) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, `+${phone}`);
    search.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(search);
    selection.removeAllRanges();
    selection.addRange(range);
    // Native editing updates WhatsApp's controlled contenteditable state.
    document.execCommand('insertText', false, `+${phone}`);
  }
  if ((search instanceof HTMLInputElement ? search.value : search.textContent).replace(/\D/g, '') !== phone) {
    throw new Error('WhatsApp no aceptó el número en Nuevo chat. No se recargó la página.');
  }
  const scope = search.closest('[role="dialog"], [data-testid="drawer-left"], #side') || document.querySelector('#app') || document.body;
  const digits = value => String(value || '').replace(/\D/g, '');
  const matchesPhone = value => {
    const number = digits(value);
    return number === phone || (phone.startsWith('591') && number === phone.slice(3));
  };
  const row = await waitFor(() => [...scope.querySelectorAll('[role="listitem"], [role="row"], [data-testid="cell-frame-container"]')]
    .find(element => visible(element) && !element.closest('#main') && !element.contains(search) && [...element.querySelectorAll('[title], span')]
      .some(label => matchesPhone(label.getAttribute('title')) || matchesPhone(label.textContent))));
  const previousHeader = document.querySelector('#main header');
  const previousTitle = previousHeader?.textContent;
  row.click();
  await waitFor(() => {
    const header = document.querySelector('#main header');
    const exactNumber = [...(header?.querySelectorAll('[title], span') || [])]
      .some(label => matchesPhone(label.getAttribute('title')) || matchesPhone(label.textContent));
    return header && (exactNumber || header !== previousHeader || header.textContent !== previousTitle);
  });
  return true;
}
