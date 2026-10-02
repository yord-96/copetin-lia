import { resolveCashMovementTimestamp } from './economicReceiptTimestamp.js';

export const getCashBusinessDate = (timestamp = new Date()) => {
  if (timestamp == null || timestamp === '') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(timestamp))) return String(timestamp);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};
export const getCashEffectiveDate = (row) => row?.cashEffectiveDate || getCashBusinessDate(resolveCashMovementTimestamp(row));

const sequenceOf = (row) => Number.isSafeInteger(row?.cashLedgerSequence) && row.cashLedgerSequence > 0
  ? row.cashLedgerSequence : 0;
const maxSequence = (rows, initial = 0) => rows.reduce((max, row) => Math.max(max, sequenceOf(row)), initial);

// Legacy arrays are stored in insertion order. Dates on receipts are editable.
export function attachCashLedgerOrder(movements = [], lastSequence = 0) {
  const rows = Array.isArray(movements) ? movements : [];
  let sequence = maxSequence(rows, lastSequence);
  return rows.map((row) => ({ ...row,
    cashLedgerSequence: sequenceOf(row) || ++sequence,
    cashEffectiveDate: getCashEffectiveDate(row),
  }));
}

// Existing order comes from the stored snapshot, never from an edited payload.
export function preserveCashLedgerOrder(state, previousState = null, now = new Date().toISOString()) {
  if (!state) return state;
  const previousRows = attachCashLedgerOrder(previousState?.cashMovements, previousState?.cashLedgerLastSequence || 0);
  const byId = new Map(previousRows.map((row) => [String(row.id), row]));
  let sequence = maxSequence(previousRows, (previousState ? previousState.cashLedgerLastSequence : state.cashLedgerLastSequence) || 0);
  const rows = previousState ? (Array.isArray(state.cashMovements) ? state.cashMovements : []).map((row) => {
    const previous = byId.get(String(row.id));
    return { ...row,
      cashLedgerSequence: previous ? previous.cashLedgerSequence : ++sequence,
      cashRegisteredAt: previous ? previous.cashRegisteredAt ?? null : now,
      cashEffectiveDate: previous ? previous.cashEffectiveDate : getCashBusinessDate(resolveCashMovementTimestamp(row)),
    };
  }) : attachCashLedgerOrder(state.cashMovements, state.cashLedgerLastSequence || 0);
  return { ...state, cashMovements: rows,
    cashLedgerLastSequence: maxSequence(rows, sequence),
  };
}

export const compareCashLedgerOrder = (left, right) => (
  sequenceOf(left) - sequenceOf(right)
  || new Date(left?.cashRegisteredAt ?? left?.createdAt ?? 0) - new Date(right?.cashRegisteredAt ?? right?.createdAt ?? 0)
  || String(left?.id ?? '').localeCompare(String(right?.id ?? ''))
);
