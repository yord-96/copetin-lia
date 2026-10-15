export function isComboPriceLine(items, line) {
  if (!line?.comboId || !line.comboLineKey) return false;
  const group=items.filter(row=>row.comboLineKey===line.comboLineKey);
  return (group.find(row=>row.comboPricingRole==='price')??group[0])===line;
}
export function resizeComboPackage(items, lineKey, mainQuantity, getPrice) {
  const main=items.find(row=>(row.lineKey??row.itemId)===lineKey);
  if (!isComboPriceLine(items,main)) return null;
  const oldCount=Math.max(1,Number(main.comboQuantity)||1);
  const mainRatio=Math.max(1,Number(main.quantity)/oldCount||Number(main.comboComponentQuantity)||1);
  const count=Math.max(1,Math.ceil(Number(mainQuantity)/mainRatio));
  const group=items.filter(row=>row.comboLineKey===main.comboLineKey);
  const quantities=new Map();
  const slots=new Map();
  group.forEach((row,index)=>{const key=row.comboRuleIndex??row.lineKey??index;const rows=slots.get(key)??[];rows.push(row);slots.set(key,rows);});
  for(const rows of slots.values()) {
    const units=rows.reduce((sum,row)=>sum+Number(row.quantity||0),0);
    const target=Math.round(units/oldCount*count);
    const shares=rows.map(row=>({row,exact:units?Number(row.quantity||0)/units*target:0}));
    let remainder=target-shares.reduce((sum,s)=>sum+Math.floor(s.exact),0);
    shares.sort((a,b)=>(b.exact%1)-(a.exact%1));
    for(const share of shares) quantities.set(share.row,Math.floor(share.exact)+(remainder-->0?1:0));
  }
  const price=getPrice?getPrice(main,count,oldCount):Number(main.unitPriceBs)||0;
  return items.map(row=>row.comboLineKey!==main.comboLineKey?row:{...row,quantity:quantities.get(row),comboQuantity:count,
    unitPriceBs:row===main?price:0,grossLineTotalBs:undefined,lineTotalBs:row===main?Math.round(price*count*100)/100:0});
}
