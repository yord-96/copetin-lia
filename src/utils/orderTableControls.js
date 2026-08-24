const normalizeText = (value) => String(value ?? '').trim();

const matchesBooleanFilter = (value, filter) => {
  if (filter === 'yes') return Boolean(value);
  if (filter === 'no') return !value;
  return true;
};

const compareNatural = (left, right) => normalizeText(left).localeCompare(
  normalizeText(right),
  'es',
  { numeric: true, sensitivity: 'base' },
);

const compareDates = (left, right) => {
  const leftTime = Date.parse(left || '') || 0;
  const rightTime = Date.parse(right || '') || 0;
  return leftTime - rightTime;
};

export const applyOrderTableControls = (rows = [], filters = {}, sort = {}) => {
  const filtered = rows.filter((row) => (
    matchesBooleanFilter(row.hasDamage, filters.damage)
    && matchesBooleanFilter(row.hasNotes, filters.notes)
    && matchesBooleanFilter(row.hasGuarantee, filters.guarantee)
    && matchesBooleanFilter(row.isPaid, filters.payment)
    && matchesBooleanFilter(row.isFinalized, filters.finalized)
  ));

  if (!sort?.key || !['asc', 'desc'].includes(sort.direction)) return filtered;

  const direction = sort.direction === 'desc' ? -1 : 1;
  return filtered
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      let comparison = 0;
      if (sort.key === 'contract') comparison = compareNatural(left.row.contractCode, right.row.contractCode);
      if (sort.key === 'date') comparison = compareDates(left.row.eventDate, right.row.eventDate);
      if (sort.key === 'client') comparison = compareNatural(left.row.customerName, right.row.customerName);
      return comparison === 0 ? left.index - right.index : comparison * direction;
    })
    .map(({ row }) => row);
};

