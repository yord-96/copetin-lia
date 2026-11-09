const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const search = (rows, query, fields) => {
  const term = normalize(query);
  if (!term) return [];
  const words = term.split(' ');
  return rows.filter(row => !row.deletedAt).map((row, index) => {
    const values = fields(row).map(normalize);
    const text = values.join(' ');
    const score = values[0] === term ? 0 : values[0].startsWith(term) ? 1 : values.some(value => value === term) ? 2 : values[0].includes(term) ? 3 : 4;
    return { row, index, score, matches: words.every(word => text.includes(word)) };
  }).filter(result => result.matches).sort((a, b) => a.score - b.score || a.index - b.index).map(result => result.row);
};

export const searchLoanItems = (items, query) => search(items, query, item => [item.name, item.sku, item.category]);
export const searchLoanClients = (clients, query) => search(clients, query, client => [client.name, client.phone, client.ci]);
