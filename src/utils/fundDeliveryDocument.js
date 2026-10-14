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
  const rows = grouped.concepts.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.direction)}</td><td class="money">${esc(bs(r.cashBs))}</td><td class="money">${esc(bs(r.digitalBs))}</td><td class="money"><b>${esc(bs(r.totalBs))}</b></td></tr>`).join('');
  const channelRows = grouped.accounts.map(r=>`<tr><td>${esc(r.label)}</td>${['initialBs','incomeBs','expenseBs','beforeBs','deliveryBs','afterBs'].map(key=>`<td class="money">${esc(bs(r[key]))}</td>`).join('')}</tr>`).join('');
  const accounts=(statement.after.accounts??[]).map(row=>`<tr><td>${esc(row.label)}</td><td class="money">${esc(bs(row.amountBs))}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Entrega de fondos ${esc(delivery.receiptCode)}</title><style>
  @page{size:letter landscape;margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;font-size:10px;color:#172b49;print-color-adjust:exact;-webkit-print-color-adjust:exact}.toolbar{text-align:right;padding:15px;background:#f2f5f9;margin-bottom:20px}.toolbar button{padding:10px;border:0;border-radius:6px;background:#173a70;color:white}.head{display:flex;justify-content:space-between;border-bottom:3px solid #173a70;padding-bottom:12px}.brand{font-size:11px;letter-spacing:2px;font-weight:bold;color:#e86008}h1{font-size:25px;margin:7px 0}.meta{text-align:right;line-height:1.7}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:16px 0}.card{padding:11px;border:1px solid #d6dfeb;border-radius:6px;background:#f7f9fc}.card small{display:block;color:#52647b}.card b{display:block;margin-top:6px;font-size:18px}.parties{display:flex;gap:30px;border-bottom:1px solid #dae2ed;padding:10px 0;line-height:1.8}h2{font-size:15px;margin:20px 0 8px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}table{border:1px solid #b7c5d8}th:not(:first-child){text-align:right}th{vertical-align:middle;overflow-wrap:normal}th{background:#173a70;color:white;border:1px solid #b7c5d8;text-align:left;padding:8px 6px;font-size:9px}td{border:1px solid #b7c5d8;padding:8px 6px;vertical-align:top;overflow-wrap:anywhere;line-height:1.4}tbody tr:nth-child(even){background:#f6f8fb}tr{break-inside:avoid}td small{display:block;color:#596b81;margin-top:3px;font-size:9px}.money{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.income{color:#087540}.expense{color:#bc3f16}.handover{background:#fff0df!important;font-weight:bold}.closing{break-inside:avoid;page-break-inside:avoid}.bottom{display:grid;grid-template-columns:1fr 1fr;gap:25px;margin-top:20px;break-inside:avoid}.note{white-space:pre-wrap;line-height:1.7}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:30px;margin-top:36px;break-inside:avoid}.signature{border-top:1px solid #52647b;text-align:center;padding-top:8px;line-height:1.7}.foot{color:#52647b;margin:20px 0;font-size:9px}@media print{.toolbar{display:none}}
  </style></head><body><div class="toolbar"><button onclick="window.print()">Imprimir / guardar PDF</button></div><header class="head"><div><div class="brand">EL COPETÍN · CAJA GRANDE</div><h1>Entrega y rendición de fondos</h1><div>Período: ${esc(statement.startDate)} a ${esc(statement.endDate)} · Hora Bolivia</div></div><div class="meta"><b>${esc(delivery.receiptCode||'Sin número')}</b><br>${delivery.fundReportStatus==='approved'?'APROBADA':'PENDIENTE DE APROBACIÓN'}</div></header>
  <section class="cards">${summary.map(([title,value])=>`<article class="card"><small>${esc(title)}</small><b>${esc(bs(value))}</b></article>`).join('')}</section>
  <section class="parties"><div><b>Entregado por</b><br>${esc(labels(delivery).user)}</div><div><b>Recibido por</b><br>${esc(delivery.fundRecipientName||'—')} · CI ${esc(delivery.fundRecipientDocument||'—')}</div><div><b>Medio de entrega</b><br>${esc(labels(delivery).method)}</div></section>
  <h2>Resumen por concepto</h2><table><thead><tr><th style="width:36%">Concepto</th><th style="text-align:left">Tipo</th><th>Efectivo</th><th>Digital</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Conciliación por medio y cuenta</h2><table><thead><tr><th style="width:22%">Medio / cuenta</th><th>Inicio</th><th>Ingresos</th><th>Egresos</th><th>Antes de entrega</th><th>Entrega</th><th>Después de entrega</th></tr></thead><tbody>${channelRows}</tbody></table>
  <section class="closing"><section class="bottom"><div><h2>Fondo restante por medio y cuenta</h2><table><tbody>${accounts}</tbody></table></div><div><h2>Observaciones</h2><div class="note">${esc(delivery.notes||'Sin observaciones.')}</div><p>El importe entregado se descuenta una sola vez. El saldo restante continúa disponible; esta rendición puede ser parcial.</p></div></section>
  <section class="signatures"><div class="signature"><b>ENTREGADO POR</b><br>${esc(labels(delivery).user)}<br>Firma / fecha</div><div class="signature"><b>RECIBIDO POR</b><br>${esc(delivery.fundRecipientName||'Nombre completo')}<br>Firma / fecha</div><div class="signature"><b>APROBADO POR</b><br>${esc(delivery.fundApprovedBy||'Nombre / cargo')}<br>Firma / fecha</div></section><p class="foot">Documento de control y seguimiento · Solo movimientos vigentes del fondo · Los egresos del período no incluyen la entrega, que se muestra por separado.</p></section></body></html>`;
}
