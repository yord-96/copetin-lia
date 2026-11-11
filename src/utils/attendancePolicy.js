export function isCopetinAttendanceLocation(location) {
  const normalized = String(location ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return /\bbatallon\s+colorados\b/.test(normalized)
    || /\b(?:jesus|j)\s+aguayo\b/.test(normalized);
}

export function getAttendanceWorkReason(type) {
  return type === 'salida' ? 'Salida trabajo' : 'Ingreso trabajo';
}

export function attendanceNeedsPhoto(location) {
  return !isCopetinAttendanceLocation(location);
}
