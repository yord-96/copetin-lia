export const applyDamageRepairToOverview = (overview, result) => {
  const repair = result?.repairUpdate;
  if (!repair) return overview;
  return {
    ...overview,
    rows: (overview?.rows ?? []).map(row => (
      row.lossType === 'danado'
      && String(row.rentalId) === String(repair.rentalId)
      && String(row.itemId) === String(repair.itemId)
      && String(row.reportKind) === String(repair.reportKind)
      && Number(row.reportIndex) === Number(repair.reportIndex)
        ? { ...row, repairedQty: repair.repairedQty, repairableQuantity: repair.repairableQuantity,
          repairedAt: repair.repairedAt, repairedByName: repair.repairedByName, repairNote: repair.repairNote }
        : row
    )),
  };
};
