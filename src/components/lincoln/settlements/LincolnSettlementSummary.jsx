import LinconIcon from '../shared/LinconIcon';
import { formatLincolnBs } from '../shared/lincolnFormatters';

export default function LincolnSettlementSummary({ summary }) {
  const cards = [
    ['wallet', 'Ingresos operativos', formatLincolnBs(summary?.operatingIncomeBs ?? summary?.incomeBs), 'is-income'],
    ['chart', 'Gastos del evento', formatLincolnBs(summary?.operatingExpenseBs ?? summary?.expenseBs), 'is-expense'],
    ['star', 'Utilidad', formatLincolnBs(summary?.utilityBs), Number(summary?.utilityBs ?? 0) < 0 ? 'is-negative' : 'is-utility'],
    ['calendar', 'Eventos', String(summary?.events ?? 1), 'is-neutral'],
  ];
  return <section className="lincoln-phase3-kpis">{cards.map(([icon,label,value,className]) => <article key={label} className={`lincoln-phase3-kpi ${className}`}><span><LinconIcon name={icon}/></span><div><small>{label}</small><strong>{value}</strong></div></article>)}</section>;
}
