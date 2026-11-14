const clean = value => String(value ?? '').trim();
export const photoSearchText = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/tacitas?/g, 'taza').replace(/platillos/g, 'platillo').replace(/cucharillas/g, 'cucharilla')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = value => photoSearchText(value).split(' ').filter(word => word.length > 1 && !['de', 'la', 'el', 'con', 'para', 'por', 'del'].includes(word));
const nameOf = row => row.name || row.fullName || row.customerName || '';
export const photoContractCode = value => /^\d{1,8}$/.test(clean(value)) ? String(Number(value)) : clean(value);
export function photoDate(value) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(`${text}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
}
export function photoTime(value) {
  const text = clean(value);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : '';
}

export function matchPhotoItems(description, items) {
  const query = photoSearchText(description), words = tokens(description);
  if (!words.length) return [];
  return items.filter(item => !item.deletedAt).map(item => {
    const name = photoSearchText(item.name), target = tokens(item.name);
    const hit = words.filter(word => target.some(other => other === word || (word.length > 4 && (other.startsWith(word) || word.startsWith(other))))).length;
    const score = name === query ? 1 : (hit / words.length) * 0.7 + (hit / Math.max(words.length, target.length)) * 0.3;
    return { id: item.id, name: item.name, category: item.category, rentalPriceBs: Number(item.rentalPriceBs || 0), score };
  }).filter(row => row.score >= 0.35).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'es')).slice(0, 8);
}

export function preparePhotoReview(extraction, { items = [], clients = [], responsibles = [], contracts = [], rentals = [] } = {}) {
  const warnings = [...(extraction.warnings || [])];
  const phone = clean(extraction.customerPhone).replace(/\D/g, '');
  const customerName = clean(extraction.customerName);
  const candidates = clients.filter(row => !row.deletedAt && (
    (phone.length >= 7 && [row.phone, row.whatsapp, row.customerPhone].some(value => clean(value).replace(/\D/g, '') === phone))
    || (customerName && photoSearchText(nameOf(row)) === photoSearchText(customerName))
  ));
  const client = candidates.length === 1 ? candidates[0] : null;
  if (candidates.length > 1) warnings.push('Hay varios clientes relacionados: selecciona el correcto en el wizard.');
  const responsibleWords = tokens(extraction.responsibleName);
  const related = responsibleWords.length ? responsibles.filter(row => responsibleWords.every(word => tokens(nameOf(row)).includes(word))) : [];
  const responsible = related.length === 1 ? related[0] : null;
  if (extraction.responsibleName && !responsible) warnings.push(`Responsable «${extraction.responsibleName}»: confirma la persona en el wizard.`);
  const code = photoContractCode(extraction.contractCode);
  const duplicate = code && [...contracts, ...rentals].some(row => !row.deletedAt && row.status !== 'cancelled'
    && photoContractCode(row.contractCode) === code);
  if (duplicate) warnings.push(`El contrato ${code} ya existe. Debes cambiar el número o usar numeración automática; no se sobrescribirá.`);
  if (!extraction.deliveryDate) warnings.push('Entrega: se propone la fecha del evento; confirma la fecha real en Logística.');
  if (!extraction.pickupDate) warnings.push('No hay fecha de devolución legible: queda por coordinar.');
  if (!extraction.logisticsMode) warnings.push('Confirma si el equipo entrega o el cliente recoge.');
  const rows = (extraction.items || []).map((line, index) => {
    const matches = matchPhotoItems(line.description, items);
    const best = matches[0];
    const selectedItemId = !line.uncertain && best?.score >= 0.95 && (!matches[1] || best.score - matches[1].score > 0.15) ? best.id : '';
    if (line.uncertain || !selectedItemId) warnings.push(`Fila ${index + 1}: revisa «${line.description}» y selecciona el producto exacto.`);
    const quantity = line.quantity ?? '';
    const unitPriceBs = line.unitPriceBs ?? '';
    if (line.writtenTotalBs != null && quantity && unitPriceBs !== '' && Math.abs(quantity * unitPriceBs - line.writtenTotalBs) > 0.02) warnings.push(`Fila ${index + 1}: el total escrito no coincide con cantidad × precio.`);
    return { ...line, key: `photo-${index}`, selectedItemId, matches, quantity, unitPriceBs, excluded: false };
  });
  return { ...extraction, contractCode: code, customerName, customerPhone: clean(extraction.customerPhone),
    customerCi: clean(extraction.customerCi), address: clean(extraction.address), eventDate: photoDate(extraction.eventDate),
    clientId: client?.id || '', clientMatches: candidates.map(row => ({ id: row.id, name: nameOf(row), phone: row.phone || '' })), responsibleId: responsible?.id || '', duplicate: Boolean(duplicate),
    guaranteeBs: extraction.guaranteeBs ?? 0, initialPaymentBs: extraction.initialPaymentBs ?? 0,
    warnings: [...new Set(warnings)], items: rows };
}

export function photoReviewToContract(review, { items = [], responsibles = [], canChooseResponsibles = true, today = '', origin = 'photo' } = {}) {
  for (const key of ['guaranteeBs', 'initialPaymentBs']) {
    if (!Number.isFinite(Number(review[key])) || Number(review[key]) < 0 || Number(review[key]) > 10000000) throw new Error('Revisa los montos de garantía y pago inicial.');
  }
  const active = review.items.filter(row => !row.excluded);
  if (!active.length) throw new Error('La foto debe tener al menos un ítem revisado.');
  if (!clean(review.customerName)) throw new Error('Completa el nombre del cliente.');
  if (!photoDate(review.eventDate)) throw new Error('Completa una fecha de evento válida.');
  const lines = active.map((row, index) => {
    const quantity = Number(row.quantity), price = Number(row.unitPriceBs);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new Error(`Revisa la cantidad de la fila ${index + 1}.`);
    if (row.unitPriceBs === '' || row.unitPriceBs == null || !Number.isFinite(price) || price < 0 || price > 10000000) throw new Error(`Revisa el precio de la fila ${index + 1}.`);
    const free = row.selectedItemId === '__free__';
    const item = items.find(item => item.id === row.selectedItemId && !item.deletedAt);
    if (!free && !item) throw new Error(`Selecciona el producto exacto de la fila ${index + 1}, o márcalo fuera de inventario.`);
    if (free && !clean(row.description)) throw new Error(`Completa la descripción de la fila ${index + 1}.`);
    return { lineKey: `photo-${index}`, itemId: free ? `quick-photo-${index}` : item.id,
      itemName: free ? clean(row.description) : item.name, quantity, unitPriceBs: price,
      grossLineTotalBs: Math.round(quantity * price * 100) / 100, lineTotalBs: Math.round(quantity * price * 100) / 100,
      observation: origin === 'voice' ? clean(row.observation) : `Leído de foto: ${clean(row.description)}`,
      ...(free ? { controlsStock: false, verificationStatus: 'pending_verification',
        quickItem: { name: clean(row.description), category: 'Por verificar', rentalPriceBs: price } } : {}),
    };
  });
  const total = lines.reduce((sum, line) => sum + line.lineTotalBs, 0);
  const responsible = canChooseResponsibles ? responsibles.find(row => row.id === review.responsibleId) : null;
  const logisticsMode = review.logisticsMode === 'recojo' ? 'recojo' : 'envio';
  const deliveryStart = photoTime(review.deliveryWindowStart) || (origin === 'voice' ? '08:00' : ''), deliveryEnd = photoTime(review.deliveryWindowEnd) || (origin === 'voice' ? '10:00' : '');
  const pickupStart = photoTime(review.pickupWindowStart) || (origin === 'voice' ? '20:00' : ''), pickupEnd = photoTime(review.pickupWindowEnd) || (origin === 'voice' ? '22:00' : '');
  const notes = [clean(review.notes), origin === 'voice' ? 'Origen: asistente de voz. Datos transcritos para revisión.' : 'Origen: foto de contrato. Datos transcritos para revisión.',
    ...(review.warnings || []).map(warning => `Revisar: ${warning}`),
    ...(review.uncertainFields || []).map(field => `Lectura dudosa: ${field}`),
    !responsible && review.responsibleName ? `Responsable escrito: ${review.responsibleName}` : '',
    photoTime(review.deliveryTime) ? `Hora de entrega escrita: ${review.deliveryTime}. Confirmar ventana de entrega.` : '',
    photoTime(review.pickupTime) ? `Hora de recojo escrita: ${review.pickupTime}. Confirmar ventana de recojo.` : '',
  ].filter(Boolean).join('\n');
  return { status: 'pendiente', contractCode: photoContractCode(review.contractCode),
    ...(origin === 'voice' ? { entryMethod: 'voice' } : {}),
    customerName: clean(review.customerName), customerPhone: clean(review.customerPhone), customerCi: clean(review.customerCi),
    clientId: review.clientId || null, address: origin === 'voice' ? clean(review.address).toLocaleUpperCase('es') : clean(review.address), companyName: clean(review.customerName),
    eventDate: review.eventDate, eventTime: photoTime(review.eventTime),
    contractDate: photoDate(review.contractDate) || today,
    deliveryDate: photoDate(review.deliveryDate) || review.eventDate,
    pickupDate: photoDate(review.pickupDate) || null, pickupDateMode: photoDate(review.pickupDate) ? 'fixed' : 'coordinate',
    deliveryTimeMode: deliveryStart && deliveryEnd && deliveryEnd > deliveryStart ? 'fixed' : 'coordinate',
    deliveryWindowStart: deliveryStart, deliveryWindowEnd: deliveryEnd,
    pickupTimeMode: pickupStart && pickupEnd && pickupEnd > pickupStart ? 'fixed' : 'coordinate',
    pickupWindowStart: pickupStart, pickupWindowEnd: pickupEnd, logisticsMode,
    billingMode: 'sin_factura', observations: origin === 'voice' ? clean(review.operationalNotes) : notes, items: lines, services: [], supplierFulfillmentPlan: [],
    totals: { totalBs: total, guaranteeBs: Number(review.guaranteeBs) || 0 },
    guarantee: { amountBs: Number(review.guaranteeBs) || 0, status: 'no_validado' },
    payment: { paidAtApprovalBs: Number(review.initialPaymentBs) || 0, initialPaymentMethod: review.initialPaymentMethod || 'efectivo' },
    responsibles: responsible ? [responsible] : [],
  };
}
