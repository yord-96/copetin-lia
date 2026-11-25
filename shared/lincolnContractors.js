export function lincolnContractors(record = {}) {
  const primary = [1, 2].map(index => ({
    name: record[`contractor${index}Name`] || (index === 1 ? record.clientName : record.secondContractorName) || '',
    ci: record[`contractor${index}Ci`] || (index === 1 ? record.clientCi : record.secondContractorCi) || '',
    phone: record[`contractor${index}Phone`] || (index === 1 ? record.clientPhone : record.secondContractorPhone) || '',
  }));
  return [...primary, ...(Array.isArray(record.additionalContractors) ? record.additionalContractors : [])]
    .map(person => ({ name: String(person?.name || '').trim(), ci: String(person?.ci || '').trim(), phone: String(person?.phone || '').trim() }))
    .filter(person => person.name);
}
