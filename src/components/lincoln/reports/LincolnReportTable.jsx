import { formatLincolnBs, formatLincolnDate } from '../shared/lincolnFormatters';

export default function LincolnReportTable({ rows = [], kind }) {
  const income = kind === 'income';
  return <div className="lincoln-report-table-wrap"><table className="lincoln-report-table"><thead><tr><th>Fecha</th><th>Evento</th><th>Categoría</th><th>Descripción</th><th>Respaldo</th><th>{income ? 'Destino' : 'Beneficiario'}</th><th>Monto</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id}><td>{formatLincolnDate(row.date)}</td><td><strong>{row.eventCode || 'GENERAL'}</strong></td><td>{row.category || '—'}</td><td>{row.description || '—'}</td><td>{row.reference || row.receiptId || '—'}</td><td>{income ? (row.destination || '—') : (row.supplierName || row.destination || '—')}</td><td className="is-money"><strong>{formatLincolnBs(row.amountBs)}</strong></td></tr>) : <tr><td colSpan="7" className="lincoln-phase3-empty-cell">No existen movimientos en este periodo.</td></tr>}</tbody></table></div>;
}
