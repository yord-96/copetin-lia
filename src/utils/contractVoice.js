import { photoDate, photoContractCode, photoSearchText } from './contractPhotoImport.js';

const normalized = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[.!?,;]+$/, '');
const small = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
const tens = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const hundreds = { cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900 };
function integerWords(text) {
  if (/^\d+$/.test(text)) return Number(text);
  if (Object.hasOwn(small, text)) return small[text];
  if (Object.hasOwn(tens, text)) return tens[text];
  const thousand = text.split(/\bmil\b/).map(word => word.trim());
  if (thousand.length === 2) {
    const left = thousand[0] ? integerWords(thousand[0]) : 1;
    const right = thousand[1] ? integerWords(thousand[1]) : 0;
    return left !== null && left > 0 && left < 1000 && right !== null && right < 1000 ? left * 1000 + right : null;
  }
  const words = text.split(' ');
  if (Object.hasOwn(hundreds, words[0])) {
    const tail = words.slice(1).join(' '); const rest = tail ? integerWords(tail) : 0;
    return rest !== null && rest < 100 ? hundreds[words[0]] + rest : null;
  }
  if (words.length === 3 && Object.hasOwn(tens, words[0]) && words[1] === 'y' && small[words[2]] > 0 && small[words[2]] < 10) return tens[words[0]] + small[words[2]];
  return null;
}
export function voiceNumber(value) {
  const text = normalized(value).replace(/\b(bolivianos|boliviano|bs|unidades)\b/g, '').replace(/\s+/g, ' ').trim();
  const words = text.split(/\s+(?:coma|punto|con)\s+/);
  if (words.length === 2) {
    const whole = integerWords(words[0]), fraction = integerWords(words[1]);
    return whole !== null && fraction !== null && fraction >= 0 && fraction < 100 ? whole + fraction / (words[1].startsWith('cero ') || String(fraction).length > 1 ? 100 : 10) : null;
  }
  const spoken = integerWords(text);
  if (spoken !== null) return spoken;
  // Ambiguous grouping and free-form sentences require correction, never guessing.
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
  const result = Number(text.replace(',', '.'));
  return Number.isFinite(result) ? result : null;
}
export function voiceDate(value) {
  if (photoDate(value)) return value;
  const text = normalized(value).replace(/^(?:para )?el\s+/, '').replace(/[,;](?=\s|$)/g, '').replace(/\s+/g, ' ');
  const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const named = text.match(/^(.+?)\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|nomviembre|nobiembre|diciembre)\s+(?:(?:del ano|de ano|del|de)\s+)?(.+)$/);
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  // Month matching is deliberately limited to known transcription variants.
  const aliases = { nomviembre: 'noviembre', nobiembre: 'noviembre', setiembre: 'septiembre' };
  const month = named ? months.indexOf(aliases[named[2]] || named[2]) + 1 : 0;
  const day = named ? voiceNumber(named[1]) : null, year = named ? voiceNumber(named[3].replace(/^(\d)[., ](\d{3})$/, '$1$2')) : null;
  const parts = numeric ? [numeric[3], numeric[2], numeric[1]] : month && Number.isInteger(day) && Number.isInteger(year) && year >= 1900 && year <= 9999 ? [year, month, day] : null;
  return parts ? photoDate(`${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`) : '';
}

export function voiceContractCode(value) {
  const text = normalized(value).replace(/^(?:contrato|numero(?: de contrato)?)\s*/, '');
  if (/^(automatico|siguiente|omitir)$/.test(text)) return '';
  const digits = text.replace(/\s+/g, '').replace(/^(\d{1,3})\.(\d{3})$/, '$1$2');
  if (/^\d{1,8}$/.test(digits) && Number(digits) > 0) return photoContractCode(digits);
  const spoken = integerWords(text);
  return Number.isInteger(spoken) && spoken > 0 && spoken <= 99999999 ? String(spoken) : null;
}

export function voiceCodeExists(code, contracts = [], rentals = []) {
  if (!code) return false;
  const active = contracts.filter(row => row && !row.deletedAt);
  const sameCode = value => photoContractCode(value) === photoContractCode(code);
  return active.some(row => sameCode(row.contractCode)) || rentals.some(row => {
    if (!row || row.deletedAt || String(row.status).toLowerCase() === 'cancelled' || !sameCode(row.contractCode)) return false;
    const linked = active.find(contract => (row.contractId && row.contractId === contract.id)
      || (contract.rentalId && contract.rentalId === row.id) || (row.orderCode && row.orderCode === contract.orderCode));
    return !linked || sameCode(linked.contractCode);
  });
}

export function voiceTime(value) {
  let text = normalized(value).replace(/^a las?\s+/, '').replace(/\s+horas?$/, '');
  const suffixMatch = text.match(/\s*(am|pm|a\.\s*m|p\.\s*m|de la manana|de la tarde|de la noche)$/);
  const suffixText = suffixMatch?.[1] || '';
  if (suffixMatch) text = text.slice(0, suffixMatch.index).trim();
  if (!/^\d/.test(text)) {
    const parts = text.split(' y ');
    const hour = integerWords(parts[0]);
    const minute = parts.length === 1 ? 0 : parts[1] === 'media' ? 30 : parts[1] === 'cuarto' ? 15 : integerWords(parts[1]);
    if (hour === null || minute === null || parts.length > 2) return '';
    text = `${hour}:${String(minute).padStart(2, '0')}`;
  }
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return '';
  let hour = Number(match[1]); const minute = Number(match[2] || 0); const suffix = suffixText;
  if (minute > 59 || hour > 23 || (suffix && (hour < 1 || hour > 12))) return '';
  if (suffix) { hour %= 12; if (/pm|p\.|tarde|noche/.test(suffix)) hour += 12; }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function voiceCatalogPrice(item) {
  const value = item?.rentalPriceBs;
  return ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 10000000 ? Number(value) : null;
}

export function voiceProductChoice(value, matches) {
  const text = photoSearchText(value).replace(/^(?:(?:la )?opcion(?: numero)?|numero|la)\s+/, '');
  const number = voiceNumber(text);
  if (Number.isInteger(number) && number >= 1 && number <= matches.length) return matches[number - 1];
  const exact = matches.filter(row => photoSearchText(row.name) === photoSearchText(value));
  if (exact.length === 1) return exact[0];
  const words = text.split(' ').filter(word => word.length > 1 && !['el', 'la', 'quiero', 'por', 'favor'].includes(word));
  const variants = words.length ? matches.filter(row => words.every(word => photoSearchText(row.name).split(' ').includes(word))) : [];
  return variants.length === 1 ? variants[0] : null;
}

export function voiceMoreAnswer(value) {
  const text = photoSearchText(value);
  if (/^(si(?: por favor)?|si quiero otro(?: producto)?|agregar(?: otro)?|otro(?: producto)?)$/.test(text)) return true;
  if (/^(no(?: gracias| mas| por ahora)?|ninguno mas|terminar|eso es todo)$/.test(text)) return false;
  return null;
}

export function voiceResponsibleMatches(value, responsibles = []) {
  const available = responsibles.filter(row => row && !row.deletedAt);
  const nameText = text => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let query = nameText(value).replace(/ por favor$/, '').replace(/ (?:como|de) responsable(?: del contrato)?$/, '');
  // Remove conversational framing only at the edges, not words inside a name.
  const prefix = /^(?:(?:(?:la|el) )?responsable(?: del contrato)?(?: (?:es|sera|seria))?|(?:quiero (?:asignar|elegir)(?: a)?|asigna a|va a ser|seria|sera|es|la senora|el senor)|como responsable(?: (?:quiero|a))?) /;
  let previous;
  do { previous = query; query = query.replace(prefix, ''); } while (query !== previous);
  if (!query) return [];
  const exact = available.filter(row => nameText(row.name) === query);
  if (exact.length) return exact;
  const words = query.split(' ');
  return available.filter(row => words.every(word => nameText(row.name).split(' ').includes(word)));
}
