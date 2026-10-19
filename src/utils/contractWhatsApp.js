export function getContractWhatsAppContacts(contract = {}) {
  const contacts = [
    { kind: 'primary', label: 'Número principal', raw: contract.customerPhone },
    { kind: 'reference', label: 'Número de referencia', raw: contract.customerReferencePhone },
  ];
  const seen = new Set();
  return contacts.flatMap(contact => {
    const raw = String(contact.raw ?? '').trim();
    let phone = raw.replace(/\D/g, '');
    if (phone.startsWith('00')) phone = phone.slice(2);
    if (phone.length === 8) phone = `591${phone}`;
    if (!/^[1-9]\d{7,14}$/.test(phone) || seen.has(phone)) return [];
    seen.add(phone);
    return [{ ...contact, raw, phone, url: `https://web.whatsapp.com/send?phone=${phone}` }];
  });
}

export function openContractWhatsAppContact(contact, browser = window, tabId) {
  return new Promise((resolve, reject) => {
    const id = browser.crypto.randomUUID();
    const cleanup = () => {
      browser.clearTimeout(timer);
      browser.removeEventListener('message', receive);
    };
    const receive = event => {
      if (event.source !== browser || event.origin !== browser.location.origin) return;
      const reply = event.data;
      if (reply?.source !== 'copetin-whatsapp-extension' || reply.id !== id) return;
      if (reply.pending) {
        browser.clearTimeout(timer);
        timer = browser.setTimeout(() => {
          cleanup();
          reject(new Error('WhatsApp no respondió a tiempo. Revisa la pestaña y vuelve a intentarlo.'));
        }, 45000);
        return;
      }
      cleanup();
      if (reply.error) reject(new Error(reply.error));
      else resolve(reply.result);
    };
    let timer = browser.setTimeout(() => {
      cleanup();
      reject(new Error('Instala o activa la extensión Copetín WhatsApp y actualiza esta página. No se abrió otra pestaña.'));
    }, 5000);
    browser.addEventListener('message', receive);
    browser.postMessage({ source: 'copetin-whatsapp-app', id, phone: contact.phone, tabId }, browser.location.origin);
  });
}
