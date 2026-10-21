export const PETTY_DIGITAL_ACCOUNTS = ['BANCO FIE', 'CIDRE', 'MERCANTIL', 'BNB', 'BCP'];
export const pettyCashChannel = row => row?.pettyCashChannel === 'digital'
  || String(row?.paymentMethod ?? '').trim().toLowerCase() === 'qr' ? 'digital' : 'cash';
export const matchesPettyCashChannel = (row, channel) => !channel || pettyCashChannel(row) === channel;
export const pettyCashBoxLabel = channel => channel === 'digital' ? 'Caja Chica Digital' : 'Caja Chica Efectivo';
export const assertPettyCashChannel = (payload, previous = null) => {
  const method = String(payload?.paymentMethod ?? previous?.paymentMethod ?? 'efectivo').trim().toLowerCase();
  const channel = method === 'qr' ? 'digital' : 'cash';
  const fail = message => { const error = new Error(message); error.statusCode = 400; throw error; };
  if (!['qr', 'efectivo'].includes(method)) fail('Caja Chica solo admite efectivo o QR en su caja correspondiente.');
  if (payload?.pettyCashChannel && payload.pettyCashChannel !== channel) fail('El método de pago no corresponde a esta caja.');
  if (previous && pettyCashChannel(previous) !== channel) fail('No puedes trasladar un movimiento entre Caja Chica Efectivo y Digital al editarlo.');
  const account = method === 'qr' ? String(payload?.paymentAccount ?? previous?.paymentAccount ?? '').trim().toUpperCase() : '';
  if (method === 'qr' && !PETTY_DIGITAL_ACCOUNTS.includes(account)) fail('Selecciona una cuenta digital: Banco FIE, CIDRE, Mercantil, BNB o BCP.');
  return { paymentMethod: method, paymentAccount: account, pettyCashChannel: channel };
};
export const pettyCashChannelBalance = (rows, method, account = '') => {
  const digital = String(method).toLowerCase() === 'qr';
  return Number(rows.filter(row => String(row?.cashBoxType).toUpperCase() === 'PETTY_CASH'
    && !row.deletedAt && !row.voidedAt && row.receiptStatus !== 'anulado'
    && !row.accountingArchivedAt && row.accountingPeriodStatus !== 'archived'
    && pettyCashChannel(row) === (digital ? 'digital' : 'cash')
    && (!digital || String(row.paymentAccount ?? '').trim().toUpperCase() === String(account).trim().toUpperCase()))
    .reduce((sum, row) => sum + (Number(row.amountBs) || 0), 0).toFixed(2));
};
export const assertPettyCashReplacement = (rows, previous, replacement = null) => {
  const updated = replacement ? { ...previous, ...replacement, ...assertPettyCashChannel(replacement, previous) } : null;
  const accounts = new Map([previous, updated].filter(Boolean).map(row => [
    `${row.paymentMethod}:${row.paymentAccount ?? ''}`, row,
  ]));
  const remaining = rows.filter(row => String(row.id) !== String(previous.id));
  if (updated) remaining.push(updated);
  for (const row of accounts.values()) {
    if (pettyCashChannelBalance(remaining, row.paymentMethod, row.paymentAccount) < -0.009) {
      const error = new Error('La operación dejaría sin fondos a esta caja o cuenta bancaria. Sus fondos ya fueron utilizados.');
      error.statusCode = 400; throw error;
    }
  }
};
