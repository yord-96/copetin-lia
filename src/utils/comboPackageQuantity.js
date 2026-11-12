export function isComboPriceLine(items, line) {
  if (!line?.comboId || !line.comboLineKey) return false;
  const group=items.filter(row=>row.comboLineKey===line.comboLineKey);
  return (group.find(row=>row.comboPricingRole==='price')??group[0])===line;
}
export function getComboComponentRatio(line) {
  const declared = Number(line?.comboComponentQuantity);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return Math.max(1, Number(line?.quantity) / Math.max(1, Number(line?.comboQuantity) || 1) || 1);
}

// Recover legacy packages whose physical components were increased together
// while their package count and stored price remained at the previous quantity.
export function reconcileComboPackageQuantities(items) {
  let result = items;
  for (const main of items) {
    if (!isComboPriceLine(items, main)) continue;
    const oldCount = Math.max(1, Number(main.comboQuantity) || 1);
    const count = Number(main.quantity) / getComboComponentRatio(main);
    if (!Number.isInteger(count) || count < 1 || count === oldCount) continue;
    const group = items.filter(row => row.comboLineKey === main.comboLineKey);
    const slots = new Set(group.map(row => row.comboRuleIndex));
    // Split options and deliberately independent component quantities need an
    // explicit edit; they cannot safely determine a different package count.
    if (slots.size !== group.length || group.some(row => !Number(row.comboComponentQuantity)
      || Number(row.quantity) !== count * getComboComponentRatio(row))) continue;
    const previousGross = Number(main.grossLineTotalBs ?? main.lineTotalBs);
    const price = Number(main.unitPriceBs);
    if (!Number.isFinite(price) || Math.abs(previousGross - oldCount * price) > 0.01) continue;
    result = result.map(row => row.comboLineKey !== main.comboLineKey ? row : {
      ...row, comboQuantity: count,
      grossLineTotalBs: row === main ? Math.round(price * count * 100) / 100 : 0,
      lineTotalBs: row === main ? Math.round(price * count * (1 - Number(row.discountPercent ?? 0) / 100) * 100) / 100 : 0,
    });
  }
  return result;
}
export function resizeComboPackage(items, lineKey, mainQuantity, getPrice) {
  const main=items.find(row=>(row.lineKey??row.itemId)===lineKey);
  if (!isComboPriceLine(items,main)) return null;
  const oldCount=Math.max(1,Number(main.comboQuantity)||1);
  const mainRatio=getComboComponentRatio(main);
  const count=Math.max(1,Math.ceil(Number(mainQuantity)/mainRatio));
  const group=items.filter(row=>row.comboLineKey===main.comboLineKey);
  const quantities=new Map();
  const slots=new Map();
  group.forEach((row,index)=>{const key=row.comboRuleIndex??row.lineKey??index;const rows=slots.get(key)??[];rows.push(row);slots.set(key,rows);});
  for(const rows of slots.values()) {
    const units=rows.reduce((sum,row)=>sum+Number(row.quantity||0),0);
    const ratio=rows.length===1?getComboComponentRatio(rows[0]):units/oldCount;
    const target=Math.round(ratio*count);
    const shares=rows.map(row=>({row,exact:units?Number(row.quantity||0)/units*target:0}));
    let remainder=target-shares.reduce((sum,s)=>sum+Math.floor(s.exact),0);
    shares.sort((a,b)=>(b.exact%1)-(a.exact%1));
    for(const share of shares) quantities.set(share.row,Math.floor(share.exact)+(remainder-->0?1:0));
  }
  const price=getPrice?getPrice(main,count,oldCount):Number(main.unitPriceBs)||0;
  return items.map(row=>row.comboLineKey!==main.comboLineKey?row:{...row,quantity:quantities.get(row),comboQuantity:count,
    unitPriceBs:row===main?price:0,grossLineTotalBs:undefined,lineTotalBs:row===main?Math.round(price*count*100)/100:0});
}
