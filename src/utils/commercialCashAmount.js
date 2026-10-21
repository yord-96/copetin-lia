const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const money = value => Math.max(0, Number(Number(value || 0).toFixed(2)) || 0);

// Indexed table rows retain the original receipt. Read its destination fields
// too, so a newly collected damage charge never becomes commercial credit.
export const getEconomicCommercialCashAmount = movement => {
  const receipt = movement?.rawMovement ?? movement;
  const amountBs = money(receipt?.amountBs ?? receipt?.amount ?? receipt?.totalBs);
  if (!amountBs || receipt?.deletedAt || receipt?.voidedAt
    || ['anulado', 'eliminado'].includes(normalize(receipt?.receiptStatus))) return 0;
  const tag = normalize(receipt?.accountingTag);
  const category = normalize(receipt?.category);
  const type = normalize(receipt?.type);
  const target = normalize(receipt?.collectionTarget);
  const breakdown = Array.isArray(receipt?.collectionBreakdown) ? receipt.collectionBreakdown : [];
  if (breakdown.length) {
    return Math.min(amountBs, money(breakdown.reduce((sum, part) => (
      ['rental', 'transport', 'balance'].includes(normalize(part?.target)) ? sum + money(part.amountBs) : sum
    ), 0)));
  }
  if (['damage', 'guarantee', 'extra'].includes(target)
    || ['contract_extra_collection', 'contract_damage_collection'].includes(tag)
    || ['cobro_extra_contrato', 'cobro_danos_faltantes'].includes(category)
    || type.includes('dano') || type.includes('faltante')
    || tag.includes('guarantee') || category.includes('garantia') || type.includes('garantia')) return 0;
  if (tag === 'contract_deposit_receipt' || category === 'abono_contrato') {
    return Math.min(amountBs, money(receipt?.contractAllocationBs));
  }
  return money(amountBs - money(receipt?.damageCollectedBs)
    - money(receipt?.guaranteeAllocationBs) - money(receipt?.surplusAllocationBs));
};
