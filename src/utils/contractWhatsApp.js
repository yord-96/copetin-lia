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

export function openContractWhatsAppContact(contact, browser = window) {
  const tab = browser.open(contact.url, 'copetin-whatsapp-web');
  if (tab) {
    tab.opener = null;
    tab.focus?.();
  }
  return tab;
}
