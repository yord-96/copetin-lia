import './DigitalCashTable.css';

export default function DigitalCashTable({ ledger, bank, formatBs, formatDateTime, renderActions }) {
  const rows = ledger.rows;
  return <section className="digital-ledger" aria-label="Movimientos bancarios">
    <div className="digital-ledger-summary">
      <div><small>{bank === 'all' ? 'Saldo actual de todos los bancos' : `Saldo actual · ${bank}`}</small><strong>{formatBs(bank === 'all' ? ledger.totalBs : ledger.balances[bank] || 0)}</strong></div>
      <div><small>Ingresos del reporte</small><strong>{formatBs(ledger.incomeBs)}</strong></div>
      <div><small>Egresos del reporte</small><strong>{formatBs(ledger.expenseBs)}</strong></div>
      <div><small>Saldo actual total digital</small><strong>{formatBs(ledger.totalBs)}</strong></div>
    </div>
    <p className="digital-ledger-caption">{rows.length} movimientos · Los saldos acumulados incluyen el historial anterior al filtro. El saldo actual incluye todos los movimientos.</p>
    <div className="digital-ledger-scroll" tabIndex={0} aria-label="Tabla de movimientos, desplazamiento horizontal">
      <table className="digital-ledger-table">
        <thead><tr>{['Fecha / Recibo', 'Cliente / Referencia', 'Concepto', 'Banco', 'Registrado por', 'Ingresos', 'Egresos', 'Saldo banco', 'Saldo total digital', 'Acciones'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>
          {rows.length ? <tr className="digital-ledger-opening"><th colSpan={7}>Saldo anterior al primer movimiento mostrado</th><td>{bank === 'all' ? '—' : formatBs(rows[0].bankBeforeBs)}</td><td>{formatBs(rows[0].totalBeforeBs)}</td><td /></tr> : null}
          {rows.map(row => <tr key={row.id}>
            <td><strong>{row.receipt || row.receiptCode || 'Sin recibo'}</strong><small>{formatDateTime(row.createdAt)}</small></td>
            <td><strong>{row.customerLabel || '—'}</strong><small>{row.referenceLabel || '—'}</small></td>
            <td>{row.description}<small>{row.categoryLabel}</small></td>
            <td>{row.bank}</td><td>{row.createdBy || row.responsible || '—'}</td>
            <td className="digital-money income">{row.amountBs > 0 ? formatBs(row.amountBs) : '—'}</td>
            <td className="digital-money expense">{row.amountBs < 0 ? formatBs(Math.abs(row.amountBs)) : '—'}</td>
            <td className="digital-money digital-balance"><strong>{formatBs(row.bankBalanceBs)}</strong></td>
            <td className="digital-money digital-balance"><strong>{formatBs(row.digitalBalanceBs)}</strong></td>
            <td>{renderActions(row)}</td>
          </tr>)}
          {!rows.length ? <tr><td colSpan={10}>Sin movimientos para este banco y los filtros seleccionados.</td></tr> : null}
        </tbody>
        <tfoot><tr><th colSpan={5}>Totales del reporte · {bank === 'all' ? 'Todos los bancos' : bank}</th><td className="digital-money income">{formatBs(ledger.incomeBs)}</td><td className="digital-money expense">{formatBs(ledger.expenseBs)}</td><td colSpan={3}>{rows.length} movimientos</td></tr></tfoot>
      </table>
    </div>
  </section>;
}
