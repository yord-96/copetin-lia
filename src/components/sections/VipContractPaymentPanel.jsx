import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { canManageAccounting } from '../../utils/permissions.js';

const bs = value => `Bs ${Number(value || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export default function VipContractPaymentPanel({ client, contract, currentUser, onUpdated }) {
  const [data, setData] = useState(null);
  const [mode, setMode] = useState('none');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!client?.prepaidEnabled) return;
    let closed = false;
    api.cash.getVipWorkspace(client.id).then(result => { if (!closed) setData(result); }).catch(error => { if (!closed) setError(error.message); });
    return () => { closed = true; };
  }, [client?.id, client?.prepaidEnabled, contract?.id]);
  if (!client?.prepaidEnabled) return null;
  const row = data?.rows.find(row => row.id === contract?.id);
  const applications = (data?.movements || []).filter(movement => movement.type === 'charge' && (movement.contractCode === row?.code || row?.orderCode && movement.orderCode === row.orderCode));
  const save = async movement => {
    if (busy) return;
    if (!reason.trim() || !reference.trim()) { setError('Indica el motivo y el respaldo del pago o la anulación.'); return; }
    if (!movement && (mode === 'none' || !(Number(amount) > 0))) { setError('Elige explícitamente el origen y el importe del pago.'); return; }
    setBusy(true); setError('');
    try {
      await api.cash.manageVipAccount({ clientId: data.client.id, actorUserId: currentUser?.id,
        clientOperationId: crypto.randomUUID(), expectedBalanceBs: data.client.balanceBs, expectedUpdatedAt: data.client.updatedAt,
        date, reason, reference, ...(movement ? { action: 'movement', movementAction: 'void', movementId: movement.id }
          : { action: 'settle', contractId: row.id, expectedContractToken: row.token, mode, serviceBs: Number(amount), damageBs: 0 }) });
      setMode('none'); setAmount('');
      setData(await api.cash.getVipWorkspace(client.id));
      await onUpdated?.();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  return <section className="vip-economic-panel"><h4>Cuenta VIP de {client.name}</h4><p>Saldo actual: <strong>{bs(data?.client.balanceBs)}</strong>. Disponible hoy: <strong>{bs(data?.client.availableBs)}</strong>.</p><p>El pago con VIP se registra únicamente al elegirlo y pulsar Aplicar. Guardar otros cambios no descuenta el saldo.</p>{row ? <p>Alquiler pendiente: <strong>{bs(row.commercialPendingBs)}</strong>. Aplicado VIP al alquiler: {bs(row.prepaidBs)}.</p> : <p>Cargando cuenta...</p>}
    {canManageAccounting(currentUser) && row ? <><div className="vip-economic-fields"><label>¿Aplicar este importe a la cuenta?<select value={mode} onChange={event => setMode(event.target.value)}><option value="none">No aplicar saldo VIP</option><option value="balance">Sí, descontar del saldo VIP disponible</option><option value="historical">Reconocer pago anterior ya incluido en el corte</option></select></label><label>Alquiler a pagar (Bs)<input type="number" min="0.01" step="0.01" max={row.commercialPendingBs} value={amount} disabled={mode === 'none'} onChange={event => setAmount(event.target.value)} /></label><label>Fecha del pago<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label>Respaldo<input value={reference} onChange={event => setReference(event.target.value)} placeholder="Recibo o fila del Excel" /></label><label>Motivo<input value={reason} onChange={event => setReason(event.target.value)} /></label></div><button type="button" className="primary-button" disabled={busy || mode === 'none' || row.commercialPendingBs <= .009} onClick={() => save(null)}>{busy ? 'Guardando...' : mode === 'historical' ? 'Reconocer pago sin descontar saldo' : 'Aplicar pago VIP'}</button>{applications.map(movement => <p key={movement.id}>Aplicación: {bs(Math.abs(movement.amountBs))} · {String(movement.createdAt).slice(0, 10)} <button type="button" className="ghost-button" disabled={busy} onClick={() => save(movement)}>Anular y devolver saldo</button></p>)}</> : null}
    {error ? <p role="alert" className="status error">{error}</p> : null}</section>;
}
