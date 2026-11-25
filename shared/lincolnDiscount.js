const amount = value => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
const money = value => Math.round(value * 100) / 100;
// Services and extras never enter the discount base.
export function lincolnBaseDiscount(draft, baseBs) {
  const discountMode = draft.discountMode === 'fixed' ? 'fixed' : 'percent';
  const discountPercent = Math.min(100, amount(draft.discountPercent));
  const discountAmountBs = amount(draft.discountAmountBs);
  const discountBs = money(Math.min(amount(baseBs), discountMode === 'fixed' ? discountAmountBs : amount(baseBs) * discountPercent / 100));
  return { discountMode, discountPercent, discountAmountBs, discountScope: 'base', discountBs };
}
export function lincolnDiscountLabel(draft, baseLabel = 'paquete base') {
  const discount = lincolnBaseDiscount(draft, Number.MAX_SAFE_INTEGER);
  return discount.discountMode === 'fixed' ? `Descuento fijo sobre ${baseLabel}` : `Descuento (${discount.discountPercent}%) sobre ${baseLabel}`;
}
