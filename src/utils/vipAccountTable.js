// A single chronological account: every contract appears, even with no VIP payment.
// Balances always use the complete ledger, regardless of the visible contract filter.
export function buildVipAccountTable(data) {
  const contracts = data?.rows || [];
  const seen = new Set();
  const entries = (data?.movements || []).map(movement => {
    const contract = contracts.find(row => row.id === movement.sourceId
      || row.orderCode && [movement.sourceId, movement.orderCode].includes(row.orderCode)
      || row.code && row.code === movement.contractCode);
    const showContract = contract && !seen.has(contract.id);
    if (contract) seen.add(contract.id);
    return { id: `movement:${movement.id}`, at: movement.createdAt || '', movement, contract,
      showContract: Boolean(showContract), balanceBs: Number(movement.calculatedBalanceBs || 0) + Number(data.summary.balanceDifferenceBs || 0) };
  });
  for (const contract of contracts) {
    if (!seen.has(contract.id)) entries.push({ id: `contract:${contract.id}`, at: contract.eventDate || contract.createdAt || '', contract, showContract: true });
  }
  entries.sort((a, b) => String(a.at).slice(0, 10).localeCompare(String(b.at).slice(0, 10))
    || Number(Boolean(b.movement)) - Number(Boolean(a.movement))
    || String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id));
  let balance = Number(data?.summary?.balanceDifferenceBs || 0);
  return entries.map(entry => {
    if (entry.movement) balance = entry.balanceBs;
    return { ...entry, balanceBs: balance };
  });
}
