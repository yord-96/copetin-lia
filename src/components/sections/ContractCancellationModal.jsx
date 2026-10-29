import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { getCashBusinessDate } from '../../utils/cashLedgerOrder.js';
import './ContractCancellationModal.css';

const banks = ['BANCO FIE', 'CIDRE', 'MERCANTIL', 'BNB', 'BCP'];
const amount = value => Math.round(Number(value || 0) * 100) / 100;

export default function ContractCancellationModal({ order, onClose, onConfirm, isSubmitting, formatBs, onPrintReceipt, currentUser }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [penalty, setPenalty] = useState('0');
  const [refund, setRefund] = useState('0');
  const [method, setMethod] = useState('efectivo');
  const [account, setAccount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(() => getCashBusinessDate());
  const [editingDate, setEditingDate] = useState(false);
  const [savingDate, setSavingDate] = useState(false);
  const operationId = useRef(crypto.randomUUID());
  const saving = useRef(false);
  useEffect(() => {
    let current = true;
    api.rentals.getCancellationPreview({ id: order.rentalId, contractId: order.contractId })
      .then(result => {
        if (!current) return;
        setPreview(result); setRefund(String(result.availableBs));
        setMethod(result.defaultPaymentMethod); setAccount(result.defaultPaymentAccount);
        setEffectiveDate(result.settlement?.effectiveDate || getCashBusinessDate(result.settlement?.effectiveAt || result.settlement?.settledAt || new Date()));
      }).catch(err => { if (current) setError(err.message || 'No se pudo cargar el económico.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [order.rentalId, order.contractId]);
  const settled = preview?.settlement;
  const saveDate = async () => {
    if (saving.current) return;
    saving.current = true; setSavingDate(true); setError('');
    try {
      const result = await api.rentals.updateCancellationDate({ id: order.rentalId, contractId: order.contractId,
        effectiveDate, version: preview.version, userName: currentUser?.fullName || currentUser?.name || 'Sistema' });
      setPreview(result.preview); setEditingDate(false);
    } catch (err) { setError(err.message || 'No se pudo editar la fecha.'); }
    finally { saving.current = false; setSavingDate(false); }
  };
  const printRefund = async () => {
    setError('');
    try {
      const result = await onPrintReceipt({ id: settled.refundMovementId });
      if (result === false) setError('No se pudo abrir el recibo de devolución.');
    } catch (err) { setError(err.message || 'No se pudo abrir el recibo de devolución.'); }
  };
  const submit = async event => {
    event.preventDefault();
    if (saving.current || isSubmitting || !preview || settled) return;
    if (!reason.trim()) { setError('Escribe el motivo de anulación.'); return; }
    if (amount(penalty) < 0 || amount(refund) < 0 || amount(Number(penalty) + Number(refund)) !== preview.availableBs) {
      setError('La multa retenida y la devolución deben sumar el dinero disponible.'); return;
    }
    saving.current = true; setError('');
    try {
      const result = await onConfirm({ reason: reason.trim(), economicSettlement: {
        operationId: operationId.current, version: preview.version, retainedPenaltyBs: amount(penalty), refundBs: amount(refund), paymentMethod: method, paymentAccount: method === 'qr' ? account : '', effectiveDate,
      } });
      setPreview(current => ({ ...current, settlement: result.cancellationSettlement }));
    } catch (err) { setError(err.message || 'No se pudo confirmar la anulación.'); }
    finally { saving.current = false; }
  };
  return (
    <div className="orders-modal-backdrop" onClick={() => !isSubmitting && !savingDate && onClose()}>
      <form className="orders-confirm-modal contract-cancellation-modal" onSubmit={submit} onClick={event => event.stopPropagation()}>
        <header><span className="orders-confirm-icon">!</span><div><h3>{settled ? 'Anulación liquidada' : 'Anular contrato y resolver su dinero'}</h3><p>Contrato {order.contractCode || order.orderCode} · {order.client}</p></div></header>
        {loading ? <p className="status">Consultando recibos y dinero recibido...</p> : null}
        {preview ? <>
          <div className="cancellation-money-grid">
            <article><span>Recibido históricamente</span><strong>{formatBs(preview.receivedBs)}</strong></article>
            <article><span>{settled ? 'Devoluciónes registradas' : 'Devuelto anteriormente'}</span><strong>{formatBs(settled ? Number(settled.previouslyRefundedBs || 0) + settled.refundBs : preview.refundedBs)}</strong></article>
            <article><span>{settled ? 'Dinero retenido en cuenta' : 'Disponible para resolver'}</span><strong>{formatBs(settled ? settled.retainedPenaltyBs : preview.availableBs)}</strong></article>
            <article><span>Garantía efectivamente recibida</span><strong>{formatBs(preview.guaranteeReceivedBs)}</strong></article>
          </div>
          <div className="cancellation-receipts">{preview.receipts.map(row => <p key={row.id}><strong>{row.receiptCode || 'Ingreso registrado'} · {formatBs(row.amountBs)}</strong><span>{new Date(row.createdAt).toLocaleDateString('es-BO')} · {row.paymentMethod} {row.paymentAccount || ''}</span></p>)}</div>
          {settled ? <div className="cancellation-settled">
            <h4>Dinero resuelto</h4><p>Devolución registrada: <strong>{formatBs(settled.refundBs)}</strong></p><p>Multa retenida del dinero original: <strong>{formatBs(settled.retainedPenaltyBs)}</strong></p>
            <p>Fecha de anulación: <strong>{new Date(settled.effectiveAt || settled.settledAt).toLocaleDateString('es-BO', { timeZone: 'America/La_Paz' })}</strong></p>
            {editingDate ? <div className="cancellation-form-grid">
              <label>Fecha de anulación<input type="date" value={effectiveDate} max={getCashBusinessDate()} min="1900-01-01" onChange={event => setEffectiveDate(event.target.value)} disabled={savingDate} required /></label>
              <div><button type="button" className="primary-button" disabled={savingDate || !effectiveDate} onClick={saveDate}>{savingDate ? 'Guardando fecha...' : 'Guardar fecha'}</button>{' '}
                <button type="button" className="ghost-button" disabled={savingDate} onClick={() => setEditingDate(false)}>Cancelar</button></div>
              <p className="cancellation-full">La fecha se actualizará en Caja Grande y en el recibo. Los montos se conservan.</p>
            </div> : <button type="button" className="ghost-button" onClick={() => { setEffectiveDate(settled.effectiveDate || getCashBusinessDate(settled.effectiveAt || settled.settledAt)); setEditingDate(true); }}>Editar fecha de anulación</button>}
            <p>Garantía final: <strong>{formatBs(0)}</strong> · Saldo por cobrar: <strong>{formatBs(0)}</strong></p>
            <p>{settled.reason}</p><p>Registrado el {new Date(settled.settledAt).toLocaleString('es-BO')} por {settled.settledByName}.</p>
            {settled.refundBs > 0 ? <p>Devolución por {settled.paymentMethod === 'qr' ? `QR / ${settled.paymentAccount}` : 'efectivo'}.</p> : null}
            {settled.refundMovementId ? <button type="button" className="ghost-button" onClick={printRefund}>Ver recibo de devolución {settled.refundReceiptCode}</button> : null}
          </div> : <>
            <p className="cancellation-explanation">El ingreso original conserva su fecha y recibo. Solo la devolución genera una salida nueva en Caja Grande. La multa se retiene del dinero ya recibido y no crea otro ingreso.</p>
            <fieldset disabled={isSubmitting} className="cancellation-form-grid">
              <label className="cancellation-full">Fecha de anulación y devolución<input type="date" min="1900-01-01" max={getCashBusinessDate()} value={effectiveDate} onChange={event => setEffectiveDate(event.target.value)} required /></label>
              <label>Multa a retener (Bs)<input type="number" min="0" max={preview.availableBs} step="0.01" value={penalty} onChange={event => { setPenalty(event.target.value); setRefund(String(amount(preview.availableBs - Number(event.target.value || 0)))); }} required /></label>
              <label>Devolver ahora (Bs)<input type="number" min="0" max={preview.availableBs} step="0.01" value={refund} onChange={event => { setRefund(event.target.value); setPenalty(String(amount(preview.availableBs - Number(event.target.value || 0)))); }} required /></label>
              <label>Método de devolución<select value={method} onChange={event => setMethod(event.target.value)}><option value="efectivo">Efectivo</option><option value="qr">QR / cuenta bancaria</option></select></label>
              {method === 'qr' && Number(refund) > 0 ? <label>Cuenta desde la que se devuelve<select value={account} onChange={event => setAccount(event.target.value)} required><option value="">Selecciona cuenta</option>{[...new Set([...banks, account].filter(Boolean))].map(bank => <option key={bank} value={bank}>{bank}</option>)}</select></label> : null}
              <label className="cancellation-full">Motivo de anulación<textarea value={reason} onChange={event => setReason(event.target.value)} required placeholder="Explica la anulación y el acuerdo con el cliente." /></label>
            </fieldset>
            <div className="cancellation-final"><span>Garantía al cerrar: <strong>{formatBs(0)}</strong></span><span>Saldo por cobrar al cerrar: <strong>{formatBs(0)}</strong></span></div>
          </>}
        </> : null}
        {error ? <p className="status error">{error}</p> : null}
        {preview?.unbackedBs > 0 ? <p className="status error">Hay dinero registrado sin respaldo de caja. Revisa el económico antes de continuar.</p> : null}
        <footer><button type="button" className="ghost-button" disabled={isSubmitting || savingDate} onClick={onClose}>{settled ? 'Cerrar' : 'Volver'}</button>{preview && !settled ? <button type="submit" className="danger-button" disabled={loading || isSubmitting || preview.unbackedBs > 0}>{isSubmitting ? 'Liquidando y anulando...' : 'Registrar devolución y anular'}</button> : null}</footer>
      </form>
    </div>
  );
}
