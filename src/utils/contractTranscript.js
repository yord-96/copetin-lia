export function parseContractTranscript(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('El archivo no contiene una transcripcion JSON valida.'); }
  if (data?.format !== 'copetin-contract-transcript-v1' || typeof data.customerName !== 'string' || !data.customerName.trim() || !Array.isArray(data.items) || !data.items.length || data.items.length > 200) {
    throw new Error('Selecciona un archivo de transcripcion de contrato valido.');
  }
  for (const row of data.items) {
    if (typeof row?.description !== 'string' || !row.description.trim() || !Number.isInteger(row.quantity) || row.quantity < 1 || !Number.isFinite(row.unitPriceBs) || row.unitPriceBs < 0) throw new Error('La transcripcion contiene cantidades o precios invalidos.');
  }
  return data;
}
