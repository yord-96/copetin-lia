export function buildSupplierViewContext(state,loans) {
  const ids=new Set(loans.map(loan=>String(loan.sourceContractId??'')).filter(Boolean));
  return {
    contractReferences:(state.contracts??[]).filter(c=>!c.deletedAt&&ids.has(String(c.id))).map(c=>({id:c.id,contractCode:c.contractCode,rentalId:c.rentalId})),
    catalogItems:(state.items??[]).filter(item=>!item.deletedAt).map(item=>({id:item.id,name:item.name,category:item.category,rentalPriceBs:item.rentalPriceBs,unitPriceBs:item.unitPriceBs})),
  };
}
