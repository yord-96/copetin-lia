import { getBigCashFundMovements, buildBigCashFundTimeline } from './dailyCashReport.js';
import { compareCashLedgerOrder, getCashEffectiveDate } from './cashLedgerOrder.js';
const order = (a,b) => getCashEffectiveDate(a).localeCompare(getCashEffectiveDate(b)) || compareCashLedgerOrder(a,b);
const delivered = row => row.amountBs < 0 && (row.accountingTag === 'big_cash_fund_out' || row.category === 'entrega_fondos');
export function buildFundDeliveryStatement(movements, delivery) {
  const date = getCashEffectiveDate(delivery);
  const source = [...movements.filter(row => row.id !== delivery.id), delivery];
  const rows = getBigCashFundMovements(source,{asOfDate:date}).sort(order);
  const end = rows.findIndex(row => row.id === delivery.id);
  if (end < 0) throw new Error('La entrega no pertenece al fondo vigente.');
  let previous = -1;
  for (let i=0;i<end;i++) if (delivered(rows[i])) previous=i;
  const timeline = buildBigCashFundTimeline(source,{asOfDate:date,reportDate:date});
  const zero = {totalBs:0,cashBs:0,digitalBs:0};
  const opening = previous >= 0 ? timeline.byMovementId.get(rows[previous].id) : zero;
  const period = rows.slice(previous+1,end+1);
  const details = period.map(row => ({movement:row,balance:timeline.byMovementId.get(row.id)}));
  const before = end > 0 ? timeline.byMovementId.get(rows[end-1].id) : zero;
  return {startDate:getCashEffectiveDate(rows[previous >= 0 ? previous : 0]),endDate:date,opening,before,after:timeline.byMovementId.get(delivery.id),details,
    incomeBs:period.filter(row=>row.id!==delivery.id&&row.amountBs>0).reduce((sum,row)=>sum+Number(row.amountBs),0),
    expenseBs:period.filter(row=>row.id!==delivery.id&&row.amountBs<0).reduce((sum,row)=>sum-Math.min(0,Number(row.amountBs)),0)};
}
const esc = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const bs = value => `Bs ${Number(value??0).toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export function summarizeFundDelivery(statement, delivery, labels) {
  const concepts = new Map(), accounts = new Map();
  const add = (name, amount, cash) => {
    if (!amount) return;
    const key = `${amount > 0 ? 'in' : 'out'}:${name}`;
    const row = concepts.get(key) ?? {name,direction:amount>0?'Ingreso':'Egreso',cashBs:0,digitalBs:0,totalBs:0};
    row[cash?'cashBs':'digitalBs'] += Math.abs(amount); row.totalBs += Math.abs(amount); concepts.set(key,row);
  };
  for (const {movement:m} of statement.details) {
    const cash = m.paymentMethod === 'efectivo' || !m.paymentMethod;
    const key = cash ? 'efectivo' : `${m.paymentMethod}:${String(m.paymentAccount??'').trim().toUpperCase()||'SIN_CUENTA'}`;
    const channel = accounts.get(key) ?? {label:cash?'Efectivo':`${m.paymentMethod.toUpperCase()} · ${m.paymentAccount||'Sin cuenta'}`,incomeBs:0,expenseBs:0,deliveryBs:0};
    const amount = Number(m.amountBs);
    if (m.id === delivery.id) channel.deliveryBs += Math.abs(amount);
    else if (amount > 0) channel.incomeBs += amount;
    else channel.expenseBs -= amount;
    accounts.set(key,channel);
    if (m.id === delivery.id) continue;
    const nature = labels(m).nature;
    const name = nature?.label || nature || 'Otros movimientos';
    if (amount > 0 && Number(m.guaranteeAllocationBs)>0) {
      const guarantee = Math.min(amount,Number(m.guaranteeAllocationBs));
      const damage = Math.min(amount-guarantee,Math.max(0,Number(m.damageAllocationBs)||0));
      add('Garantías recibidas',guarantee,cash);add('Daños y faltantes',damage,cash);
      add('Contratos / abonos',amount-guarantee-damage,cash);
    } else add(name,amount,cash);
  }
  const snapshots = [statement.opening,statement.before,statement.after];
  for (const snapshot of snapshots) for (const a of snapshot.accounts??[]) {
    const key=a.key === 'efectivo' ? 'efectivo' : a.key.endsWith(':')?a.key+'SIN_CUENTA':a.key;
    if (!accounts.has(key)) accounts.set(key,{label:a.label,incomeBs:0,expenseBs:0,deliveryBs:0});
  }
  const balance=(snapshot,key)=>key==='efectivo'?snapshot.cashBs:(snapshot.accounts??[]).find(a=>(a.key.endsWith(':')?a.key+'SIN_CUENTA':a.key)===key)?.amountBs??0;
  return {concepts:[...concepts.values()],accounts:[...accounts.entries()].map(([key,row])=>({...row,initialBs:balance(statement.opening,key),beforeBs:balance(statement.before,key),afterBs:balance(statement.after,key)}))};
}
export function buildFundDeliveryDocumentHtml({statement,delivery,labels}) {
  const amount = Math.abs(Number(delivery.amountBs));
  const summary = [['Saldo inicial',statement.opening.totalBs],['Ingresos del período',statement.incomeBs],['Egresos del período',statement.expenseBs],['Disponible antes de entregar',statement.before.totalBs],['Importe entregado',amount],['Saldo que continúa',statement.after.totalBs]];
  const grouped = summarizeFundDelivery(statement,delivery,labels);
  const conceptTable = (direction, title) => {
    const selected = grouped.concepts.filter(r=>r.direction===direction);
    const total = selected.reduce((t,r)=>({cashBs:t.cashBs+r.cashBs,digitalBs:t.digitalBs+r.digitalBs,totalBs:t.totalBs+r.totalBs}),{cashBs:0,digitalBs:0,totalBs:0});
    return `<section class="concept-section"><h2>${title}</h2><table><thead><tr><th style="width:6%">N°</th><th style="width:40%;text-align:left">Concepto</th><th>Efectivo</th><th>Digital</th><th>Total</th></tr></thead><tbody>${selected.map((r,i)=>`<tr><td class="index">${i+1}</td><td>${esc(r.name)}</td>${['cashBs','digitalBs','totalBs'].map(key=>`<td class="money">${esc(bs(r[key]))}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="5">Sin movimientos</td></tr>'}</tbody><tfoot><tr><th colspan="2">TOTAL ${direction==='Ingreso'?'INGRESOS':'EGRESOS'}</th>${['cashBs','digitalBs','totalBs'].map(key=>`<td class="money">${esc(bs(total[key]))}</td>`).join('')}</tr></tfoot></table></section>`;
  };
  const channelRows = grouped.accounts.map(r=>`<tr><td>${esc(r.label)}</td>${['initialBs','incomeBs','expenseBs','beforeBs','deliveryBs','afterBs'].map(key=>`<td class="money">${esc(bs(r[key]))}</td>`).join('')}</tr>`).join('');
  const totals = direction => grouped.concepts.filter(r=>r.direction===direction).reduce((t,r)=>({cashBs:t.cashBs+r.cashBs,digitalBs:t.digitalBs+r.digitalBs,totalBs:t.totalBs+r.totalBs}),{cashBs:0,digitalBs:0,totalBs:0});
  const incoming=totals('Ingreso'),outgoing=totals('Egreso');
  const channelTotal = ['initialBs','incomeBs','expenseBs','beforeBs','deliveryBs','afterBs'].map(key=>grouped.accounts.reduce((sum,r)=>sum+r[key],0));
  const channelFooter=`<tr><th>TOTAL GENERAL</th>${channelTotal.map(value=>`<td class="money">${esc(bs(value))}</td>`).join('')}</tr>`;
  const difference=Math.max(Math.abs(statement.opening.totalBs+incoming.totalBs-outgoing.totalBs-statement.before.totalBs),Math.abs(statement.before.totalBs-amount-statement.after.totalBs),Math.abs(channelTotal[5]-statement.after.totalBs),Math.abs(channelTotal[1]-incoming.totalBs),Math.abs(channelTotal[2]-outgoing.totalBs),Math.abs(channelTotal[3]-statement.before.totalBs),Math.abs(channelTotal[4]-amount));
  const check=difference<0.01?'CONCILIADO · Los totales coinciden':'REVISAR · Diferencia detectada: '+bs(difference);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Entrega de fondos ${esc(delivery.receiptCode)}</title><style>
  @page{size:letter landscape;margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;font-size:10px;color:#172b49;print-color-adjust:exact;-webkit-print-color-adjust:exact}.toolbar{text-align:right;padding:15px;background:#f2f5f9;margin-bottom:20px}.toolbar button{padding:10px;border:0;border-radius:6px;background:#173a70;color:white}.head{display:flex;justify-content:space-between;border-bottom:3px solid #173a70;padding-bottom:12px}.brand{font-size:11px;letter-spacing:2px;font-weight:bold;color:#e86008}h1{font-size:25px;margin:7px 0}.meta{text-align:right;line-height:1.7}.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:12px 0}.card{padding:11px;border:1px solid #d6dfeb;border-radius:6px;background:#f7f9fc}.card small{display:block;color:#52647b}.card b{display:block;margin-top:6px;font-size:15px}.parties{display:flex;gap:30px;border-bottom:1px solid #dae2ed;padding:10px 0;line-height:1.8}h2{font-size:14px;margin:12px 0 0;padding:8px 10px;background:linear-gradient(90deg,#073b78,#173a70);color:white;border-radius:5px 5px 0 0}tfoot td,tfoot th{background:#dcecff!important;color:#102e57;font-weight:bold;border:1px solid #b7c5d8;text-align:right}.concept-section{break-inside:avoid}.index{text-align:center}.check{margin:8px 0;padding:8px;border:1px solid #b4d8c6;background:#eef8f2;font-weight:bold}.equation{margin:8px 0;color:#405875;font-size:10px}.card:nth-child(2){background:#eef9f3}.card:nth-child(3){background:#fff1f1}.card:nth-child(5){background:#fff4e6}.card:nth-child(6){background:#fff9ed}.parties{background:#f0f4f9;padding:8px 10px;border-radius:5px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}table{border:1px solid #b7c5d8}th:not(:first-child){text-align:right}th{vertical-align:middle;overflow-wrap:normal}th{background:#173a70;color:white;border:1px solid #b7c5d8;text-align:left;padding:5px 6px;font-size:9px}td{border:1px solid #b7c5d8;padding:8px 6px;vertical-align:top;overflow-wrap:anywhere;line-height:1.4}tbody tr:nth-child(even){background:#f6f8fb}tr{break-inside:avoid}td small{display:block;color:#596b81;margin-top:3px;font-size:9px}.money{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.income{color:#087540}.expense{color:#bc3f16}.handover{background:#fff0df!important;font-weight:bold}.closing{break-inside:avoid;page-break-inside:avoid}.bottom{display:grid;grid-template-columns:1fr;gap:12px;margin-top:20px;break-inside:avoid}.note{white-space:pre-wrap;line-height:1.7}.signatures{display:grid;grid-template-columns:repeat(2,1fr);gap:45px;margin-top:54px;break-inside:avoid}.signature{min-height:65px;border-top:1px solid #52647b;text-align:center;padding-top:8px;line-height:1.7}.foot{color:#52647b;margin:20px 0;font-size:9px}@media print{.toolbar{display:none}.reconciliation-start{break-before:page;page-break-before:always;margin-top:0}}
  </style></head><body><div class="toolbar"><button onclick="window.print()">Imprimir / guardar PDF</button></div><header class="head"><div><div class="brand">EL COPETÍN · CAJA GRANDE</div><h1>Entrega y rendición de fondos</h1><div>Período: ${esc(statement.startDate)} a ${esc(statement.endDate)} · Hora Bolivia</div></div><div class="meta"><b>${esc(delivery.receiptCode||'Sin número')}</b><br>${delivery.fundReportStatus==='approved'?'APROBADA':'PENDIENTE DE APROBACIÓN'}</div></header>
  <section class="cards">${summary.map(([title,value])=>`<article class="card"><small>${esc(title)}</small><b>${esc(bs(value))}</b></article>`).join('')}</section>
  <section class="parties"><div><b>Entregado por</b><br>${esc(labels(delivery).user)}</div><div><b>Recibido por</b><br>${esc(delivery.fundRecipientName||'—')} · CI ${esc(delivery.fundRecipientDocument||'—')}</div><div><b>Medio de entrega</b><br>${esc(labels(delivery).method)}</div></section>
  ${conceptTable('Ingreso','1. Ingresos por concepto')}${conceptTable('Egreso','2. Egresos por concepto')}
  <h2 class="reconciliation-start">3. Conciliación por medio y cuenta</h2><table><thead><tr><th style="width:22%">Medio / cuenta</th><th>Inicio</th><th>Ingresos</th><th>Egresos</th><th>Antes de entrega</th><th>Entrega</th><th>Después de entrega</th></tr></thead><tbody>${channelRows}</tbody><tfoot>${channelFooter}</tfoot></table><p class="check">${esc(check)}</p><p class="equation">Inicio ${esc(bs(statement.opening.totalBs))} + ingresos ${esc(bs(incoming.totalBs))} − egresos ${esc(bs(outgoing.totalBs))} = disponible ${esc(bs(statement.before.totalBs))}. Disponible − entrega ${esc(bs(amount))} = remanente ${esc(bs(statement.after.totalBs))}.</p>
  <section class="closing"><section class="bottom"><div><h2>4. Observaciones</h2><div class="note">${esc(delivery.notes||'Sin observaciones.')}</div><p>El importe entregado se descuenta una sola vez. El saldo restante continúa disponible; esta rendición puede ser parcial.</p></div></section>
  <section class="signatures"><div class="signature"><b>ENTREGADO POR</b><br>${esc(labels(delivery).user)}<br>Firma / fecha</div><div class="signature"><b>RECIBIDO POR</b><br>${esc(delivery.fundRecipientName||'Nombre completo')}<br>Firma / fecha</div></section><p class="foot">Documento de control y seguimiento · Solo movimientos vigentes del fondo · Los egresos del período no incluyen la entrega, que se muestra por separado.</p></section></body></html>`;
}
