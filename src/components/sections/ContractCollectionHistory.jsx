import './ContractCollectionHistory.css';

// Keep the full receipt information, but show an identical concept only once.
const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es');

export default function ContractCollectionHistory({ contractCode, movements = [], loading, formatDate, formatBs, getHourLabel }) {
  return (
    <section className="contract-collection-history" aria-label={`Cobros del contrato ${contractCode}`} aria-busy={loading}>
      <header className="collection-history-heading">
        <div><span className="collection-history-eyebrow">CAJA GRANDE · CONTRATO {contractCode}</span><h4>Cobros registrados</h4></div>
        {!loading && <span className="collection-history-count">{movements.length} {movements.length === 1 ? 'movimiento' : 'movimientos'}</span>}
      </header>
      {loading ? <p className="collection-history-status" role="status">Consultando el historial completo de Caja Grande...</p>
        : movements.length ? <div className="collection-history-list">
          {movements.map(movement => {
            const concept = String(movement.concept ?? '').trim();
            const lines = String(movement.description ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            const descriptionIncludesConcept = concept && (
              normalize(lines.join(' ')).startsWith(normalize(concept))
              || (lines[0] && normalize(concept).startsWith(normalize(lines[0]))
                && normalize(concept).includes('total recibido:') && normalize(lines.join(' ')).includes('total recibido:'))
            );
            return (
              <article className="collection-history-entry" key={movement.id}>
                <div className="collection-history-date"><span className="collection-history-label">Fecha del cobro</span><time dateTime={movement.createdAt}>{formatDate(movement.createdAt)}</time><span>{getHourLabel(movement.createdAt)}</span></div>
                <div className="collection-history-concept"><span className="collection-history-label">Concepto y detalle</span>
                  {!descriptionIncludesConcept && concept ? <p className="collection-history-title">{concept}</p> : null}
                  {lines.map((line, index) => <p key={index}>{line}</p>)}
                  {!concept && !lines.length ? <p>Cobro registrado</p> : null}
                </div>
                <div className="collection-history-method"><span className="collection-history-label">Medio de pago</span><span>{movement.paymentMethodLabel || 'Sin especificar'}</span></div>
                <div className="collection-history-amount"><span className="collection-history-label">Monto recibido</span><span>{formatBs(movement.amountBs)}</span></div>
                <footer className="collection-history-footer"><div><span className="collection-history-label">Recibo</span><span className="collection-history-receipt">{movement.receiptCode || 'Sin recibo'}</span></div><div><span className="collection-history-label">Registrado por</span><span>{movement.registeredBy || 'Sin especificar'}</span></div></footer>
              </article>
            );
          })}
        </div> : <p className="collection-history-status">No se encontraron movimientos reales de Caja vinculados a este contrato.</p>}
    </section>
  );
}
