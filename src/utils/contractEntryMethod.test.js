import test from 'node:test';
import assert from 'node:assert/strict';
import { getContractEntryMethod, contractOperationalNotes } from './contractEntryMethod.js';
test('voice origin remains metadata and legacy generated notes are removed without erasing operational notes', () => {
  assert.equal(getContractEntryMethod({ entryMethod: 'voice', observations: '' }), 'voice');
  assert.equal(getContractEntryMethod({ observations: 'Cliente llamó por voz.' }), 'manual');
  const legacy = { observations: 'Entregar por la puerta trasera.\nPreparado con asistente de voz; respuestas revisadas. No acredita pagos.\nOrigen: asistente de voz. Datos transcritos para revisión.\nRevisar: Confirmar entrega, devolución, disponibilidad y proveedores antes de crear.' };
  assert.equal(getContractEntryMethod(legacy), 'voice');
  assert.equal(contractOperationalNotes(legacy), 'Entregar por la puerta trasera.');
  assert.equal(contractOperationalNotes({ observations: 'Cliente pidió llamar antes.' }), 'Cliente pidió llamar antes.');
});
