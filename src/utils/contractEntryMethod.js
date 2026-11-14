const voiceNotes = new Set([
  'Preparado con asistente de voz; respuestas revisadas. No acredita pagos.',
  'Origen: asistente de voz. Datos transcritos para revisión.',
  'Revisar: Confirmar entrega, devolución, disponibilidad y proveedores antes de crear.',
]);
export function getContractEntryMethod(contract = {}) {
  if (contract.entryMethod === 'voice') return 'voice';
  if (contract.entryMethod === 'manual') return 'manual';
  return String(contract.observations || '').split(/\r?\n/).some(line => voiceNotes.has(line.trim()) && !line.startsWith('Revisar:')) ? 'voice' : 'manual';
}
export function contractOperationalNotes(contract = {}) {
  const notes = String(contract.observations || '');
  return getContractEntryMethod(contract) === 'voice'
    ? notes.split(/\r?\n/).filter(line => !voiceNotes.has(line.trim())).join('\n').trim() : notes;
}
