const currency = new Intl.NumberFormat('es-BO', {
  style: 'currency',
  currency: 'BOB',
  minimumFractionDigits: 2,
});

export const formatBs = (value) => currency.format(Number(value ?? 0));

export const formatDate = (dateValue) => {
  if (!dateValue) {
    return '-';
  }
  let parsed;
  const plainDateMatch = String(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (plainDateMatch) {
    const year = Number.parseInt(plainDateMatch[1], 10);
    const month = Number.parseInt(plainDateMatch[2], 10);
    const day = Number.parseInt(plainDateMatch[3], 10);
    parsed = new Date(year, month - 1, day);
  } else {
    parsed = new Date(dateValue);
  }

  if (Number.isNaN(parsed.getTime())) {
    return dateValue;
  }
  return parsed.toLocaleDateString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

export const formatDateTime = (dateValue) => {
  if (!dateValue) {
    return '-';
  }
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return String(dateValue);
  }
  return parsed.toLocaleString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const parseNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const parseIntSafe = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
