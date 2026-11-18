import { getAttendanceDateKey } from './attendanceAnalysis.js';

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function getAttendancePaymentCash(state, { personKey, dateFrom, dateTo }) {
  const fail = (message, statusCode = 400) => { const error = new Error(message); error.statusCode = statusCode; throw error; };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom || '') || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo || '') || dateFrom > dateTo) fail('Selecciona un período válido para consultar Caja Chica.');
  const user = (state.users || []).find(row => `id:${row.id}` === personKey);
  if (!user) fail('No se pudo identificar al trabajador de esta asistencia. Revisa su usuario antes de consultar Caja Chica.', 404);
  const name = normalize(user.fullName || user.username);
  const matchingUsers = (state.users || []).filter(row => normalize(row.fullName || row.username) === name);
  const employees = (state.personnelEmployees || []).filter(row => !row.deletedAt && (String(row.userId || '') === String(user.id) || normalize(row.fullName) === name));
  const employeeIds = new Set(employees.map(row => String(row.id)));
  const ambiguous = matchingUsers.length > 1 || employees.length > 1;
  const categories = state.settings?.accounting?.pettyExpenseCategories || [];
  const seen = new Set(), movements = [];
  for (const [index, row] of (state.cashMovements || []).entries()) {
    if (String(row.cashBoxType).toUpperCase() !== 'PETTY_CASH' || row.deletedAt || row.voidedAt || row.replacedByMovementId || ['anulado', 'void', 'voided', 'cancelled', 'deleted'].includes(normalize(row.receiptStatus || row.statusReceipt || row.status)) || row.isInternalTransfer) continue;
    const amount = Number(row.amountBs);
    if (!Number.isFinite(amount) || !amount) continue;
    const category = normalize(`${row.category || ''} ${categories.find(category => category.id === row.category)?.label || ''}`);
    const tag = normalize(row.accountingTag);
    const kind = tag === 'personnel advance' || /\b(adelanto personal|anticipo sueldos|anticipo de sueldo|adelanto de sueldo)\b/.test(category) ? 'advance'
      : tag === 'personnel discount' || tag === 'payroll discount' || /\bdescuentos?\b/.test(category) ? 'discount' : '';
    if (!kind || (kind === 'advance' && amount >= 0)) continue;
    const linkedUserId = row.beneficiaryUserId || row.personnelUserId;
    const linkedEmployeeId = row.employeeId || row.personnelEmployeeId;
    const matches = linkedUserId ? String(linkedUserId) === String(user.id) : linkedEmployeeId ? employeeIds.has(String(linkedEmployeeId)) : !ambiguous && name && normalize(row.responsible) === name;
    if (!matches) continue;
    const date = getAttendanceDateKey(row.createdAt || row.date);
    if (!date || date < dateFrom || date > dateTo) continue;
    const key = row.id || `row:${index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    movements.push({ id: key, date, receiptCode: row.receiptCode || '', kind, amountBs: Math.round(Math.abs(amount) * 100) / 100, description: row.description || '', channel: row.paymentMethod === 'qr' || row.paymentMethod === 'transferencia' ? 'Digital' : 'Efectivo' });
  }
  const sum = kind => Math.round(movements.filter(row => row.kind === kind).reduce((sum, row) => sum + row.amountBs, 0) * 100) / 100;
  return { personKey, dateFrom, dateTo, advances: sum('advance'), discounts: sum('discount'), movements, warning: ambiguous ? 'Hay personas con el mismo nombre. Solo se incluyeron movimientos vinculados por identificador; revisa los registros antiguos de Caja Chica.' : '' };
}
