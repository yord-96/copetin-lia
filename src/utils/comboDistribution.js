const integer = (value) => Math.max(0, Math.trunc(Number(value ?? 0)));

export const distributeComboUnits = ({ requiredUnits, selectedIds = [], lockedId = '', lockedQuantity = 0 }) => {
  const ids = [...new Set(selectedIds.map((id) => String(id ?? '')).filter(Boolean))];
  const total = integer(requiredUnits);
  if (!ids.length) return {};

  const result = {};
  const hasLock = lockedId && ids.includes(String(lockedId));
  const fixedQuantity = hasLock ? Math.min(total, integer(lockedQuantity)) : 0;
  if (hasLock) result[String(lockedId)] = ids.length === 1 ? total : fixedQuantity;

  const flexibleIds = hasLock ? ids.filter((id) => id !== String(lockedId)) : ids;
  const flexibleTotal = total - (hasLock ? result[String(lockedId)] : 0);
  const baseQuantity = flexibleIds.length ? Math.floor(flexibleTotal / flexibleIds.length) : 0;
  let remainder = flexibleIds.length ? flexibleTotal % flexibleIds.length : 0;
  flexibleIds.forEach((id) => {
    result[id] = baseQuantity + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
  });
  return result;
};

