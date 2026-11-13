import { photoDate } from './contractPhotoImport.js';

const normalized = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[.!?]+$/, '');
export function voiceNumber(value) {
  const text = normalized(value).replace(/\b(bolivianos|boliviano|bs|unidades)\b/g, '').trim();
  const words = { cero: 0, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, veinte: 20, treinta: 30, cien: 100, doscientos: 200 };
  if (Object.hasOwn(words, text)) return words[text];
  // Ambiguous grouping and free-form sentences require correction, never guessing.
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
  const result = Number(text.replace(',', '.'));
  return Number.isFinite(result) ? result : null;
}
export function voiceDate(value) {
  if (photoDate(value)) return value;
  const text = normalized(value);
  const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const named = text.match(/^(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?: de| del)? (\d{4})$/);
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const parts = numeric ? [numeric[3], numeric[2], numeric[1]] : named ? [named[3], months.indexOf(named[2]) + 1, named[1]] : null;
  return parts ? photoDate(`${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`) : '';
}
