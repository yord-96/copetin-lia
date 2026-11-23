export default function DailyGuaranteeApplications({ rows = [], formatBs, formatDateTime }) {
  if (!rows.length) return null;
  return <section className="daily-guarantee-applications" style={{ marginTop: 20, padding: 16, border: '1px solid #7186a360', borderRadius: 12 }}>
    <h3>Garantías aplicadas · sin movimiento de caja</h3>
    <p>Dinero recibido anteriormente y aplicado en esta fecha. No suma ingresos ni egresos y no cambia el fondo efectivo o digital.</p>
    <div style={{ overflowX: 'auto' }}><table className="accounting-table"><thead><tr><th>Fecha / Comprobante interno</th><th>Cliente / Contrato</th><th>Detalle y origen</th><th>Registrado por</th><th>Garantía aplicada</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}><td>{formatDateTime(row.date)}<br />{row.receipt}</td><td>{row.customer}<br />Contrato {row.reference}</td><td>{row.detail}{row.origins.map(origin => <small key={`${origin.receipt}:${origin.date}`} style={{ display: 'block' }}>Recibido: {origin.date.split('-').reverse().join('/')} · {origin.receipt || 'Depósito original'}</small>)}</td><td>{row.user}</td><td>{formatBs(row.amountBs)}<small style={{ display: 'block' }}>Sin ingreso nuevo</small></td></tr>)}</tbody>
      <tfoot><tr><th colSpan={4}>Total aplicado de garantías · informativo</th><td>{formatBs(rows.reduce((sum, row) => sum + row.amountBs, 0))}</td></tr></tfoot>
    </table></div>
  </section>;
}
