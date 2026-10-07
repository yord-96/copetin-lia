export const organizerRates = [{ capacity: 150, amountBs: 7000 }, { capacity: 200, amountBs: 8000 }, { capacity: 250, amountBs: 9000 }, { capacity: 300, amountBs: 10000 }];
const number = (value) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value) => Math.round(number(value) * 100) / 100;
export const suggestedOrganizerRate = (guests) => organizerRates.find((rate) => number(guests) > 0 && number(guests) <= rate.capacity)?.amountBs ?? null;
export const organizerEventDays = (event) => (event?.contractType || event?.contractDocumentSnapshot?.contractType) === 'organizer' && (event.organizerDays || event.contractDocumentSnapshot?.organizerDays)?.length
  ? (event.organizerDays || event.contractDocumentSnapshot.organizerDays).map(day => ({ ...event, eventDate: day.date, roomId: day.roomId, roomName: day.roomName, guestCount: day.guestCount, organizerDayId: day.id })) : [event];
export const organizerTotals = (draft) => {
  const days = Array.isArray(draft.organizerDays) ? draft.organizerDays : [];
  const baseBs = money(days.reduce((sum, day) => sum + number(day.amountBs), 0));
  const extrasBs = money((draft.extras || []).filter((line) => line.selected !== false).reduce((sum, line) => sum + number(line.unitCostBs) * number(line.quantity ?? 1), 0));
  const grossBs = money(baseBs + extrasBs);
  const discountBs = money(grossBs * Math.min(100, number(draft.discountPercent)) / 100);
  const totalBs = money(grossBs - discountBs);
  return { baseBs, extrasBs, grossBs, discountBs, totalBs, balanceBs: money(Math.max(0, totalBs - number(draft.advanceBs))), guestCount: Math.max(0, ...days.map((day) => number(day.guestCount))) };
};
export const organizerClauses = (draft) => {
  const currency = (value) => new Intl.NumberFormat('es-BO', { style: 'currency', currency: 'BOB' }).format(number(value));
  const days = (draft.organizerDays || []).map((day) => `${day.date || 'fecha por definir'}: ${day.roomName || 'salón por definir'}, ${number(day.guestCount)} asistentes, alquiler ${currency(day.amountBs)}`).join('; ');
  return [
    `Centro de Eventos LINCOLN alquilará el salón vacío al organizador para el evento ${draft.eventType || 'acordado'} según estas jornadas: ${days}.`,
    'El alquiler del salón y los productos o servicios adicionales se detallan por jornada en la hoja de costos, que forma parte del presente contrato.',
    `El alquiler del salón tiene un precio fijo por jornada según el salón y la cantidad de asistentes acordados. No se cobra por persona. Alquiler total: ${currency(organizerTotals(draft).baseBs)}. Los extras se cobran según las cantidades y precios pactados en el anexo.`,
    `Como referencia comercial, la firma del contrato requiere un anticipo del 50%. El anticipo registrado es ${currency(draft.advanceBs)} y el saldo se cancelará ${number(draft.balanceDueDays ?? 7)} días antes del evento, salvo acuerdo escrito diferente.`,
    'Toda suspensión o reprogramación y sus condiciones de devolución o penalidad deberán acordarse expresamente por escrito entre las partes.',
    `El organizador se compromete a resarcir los daños ocasionados por sus invitados en las instalaciones y bienes facilitados. La garantía separada es ${currency(draft.guaranteeBs)}, sujeta a verificación al finalizar el evento.`,
    'El pago de SOBODAYCOM está a cargo del organizador. El alquiler de mobiliario se realiza solamente con la empresa EL COPETÍN.',
    'En caso de incumplimiento de una de las partes, se aplicarán las condiciones de daños y perjuicios acordadas en este contrato.',
    `En conformidad con las cláusulas y el anexo de costos, ambas partes firman en fecha ${draft.contractDate || 'por definir'}.`,
  ];
};
