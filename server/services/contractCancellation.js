import crypto from 'node:crypto';
import { cashMovementMatchesContractReferences } from '../../src/utils/contractCashLinks.js';

const money = value => Math.round(Number(value || 0) * 100) / 100;
const active = row => row && !row.deletedAt && !row.voidedAt && !row.voidedBy
  && !['anulado', 'voided', 'eliminado'].includes(String(row.receiptStatus || row.status || '').toLowerCase());
const fail = message => { const error = new Error(message); error.statusCode = 409; throw error; };

export const cancellationRecords = (state, identifiers = {}) => {
  const contract = (state.contracts ?? []).find(row => !row.deletedAt && (
    (identifiers.contractId && row.id === identifiers.contractId) || (identifiers.id && row.rentalId === identifiers.id) || (identifiers.rentalId && row.rentalId === identifiers.rentalId)
  ));
  const rental = (state.rentals ?? []).find(row => !row.deletedAt && (
    (identifiers.id && row.id === identifiers.id) || (identifiers.rentalId && row.id === identifiers.rentalId) || (contract && (row.id === contract.rentalId || row.contractId === contract.id))
  ));
  if (!rental) fail('No se encontro la orden del contrato.');
  return { contract: contract ?? (state.contracts ?? []).find(row => !row.deletedAt && row.rentalId === rental.id), rental };
};

export const cancellationPreview = (state, contract, rental) => {
  const references = { contractIds: [contract?.id], rentalIds: [rental.id], orderCodes: [rental.orderCode, contract?.orderCode], contractCodes: [contract?.contractCode, rental.contractCode] };
  const linked = (state.cashMovements ?? []).filter(row => active(row) && !row.isInternalTransfer
    && String(row.cashBoxType || 'BIG_CASH') === 'BIG_CASH' && cashMovementMatchesContractReferences(row, references));
  const receipts = linked.filter(row => Number(row.amountBs) > 0 && !row.nonPhysical && !row.isNonCash
    && row.accountingTag !== 'guarantee_damage_application');
  const refunds = linked.filter(row => Number(row.amountBs) < 0 && /devolucion|refund|reembolso/i.test([row.type, row.accountingTag, row.category].join(' ')));
  const receivedBs = money(receipts.reduce((sum, row) => sum + Number(row.amountBs), 0));
  const refundedBs = money(refunds.reduce((sum, row) => sum + Math.abs(Number(row.amountBs)), 0));
  const availableBs = money(Math.max(0, receivedBs - refundedBs));
  const guaranteeReceivedBs = money(receipts.reduce((sum, row) => sum + (Number(row.guaranteeAllocationBs) > 0
    ? Number(row.guaranteeAllocationBs) : /garantia|guarantee/i.test([row.type, row.category, row.accountingTag].join(' ')) ? Number(row.amountBs) : 0), 0));
  const recordedBs = Math.max(Number(rental.payment?.paidAtRentalBs || 0), Number(rental.payment?.cashCollectedBs || 0), Number(contract?.payment?.paidAtApprovalBs || 0));
  const unbackedBs = money(Math.max(0, recordedBs - receivedBs));
  const version = crypto.createHash('sha256').update(JSON.stringify({ contract, rental, linked })).digest('hex');
  const last = receipts.at(-1);
  return { version, receivedBs, refundedBs, availableBs, guaranteeReceivedBs,
    guaranteeConfiguredBs: money(contract?.totals?.guaranteeBs ?? contract?.guarantee?.amountBs ?? rental.depositBs ?? 0), unbackedBs,
    settlement: contract?.cancellationSettlement ?? rental.cancellationSettlement ?? null,
    defaultPaymentMethod: last?.paymentMethod === 'qr' ? 'qr' : 'efectivo', defaultPaymentAccount: last?.paymentAccount || '',
    receipts: receipts.map(row => ({ id: row.id, receiptCode: row.receiptCode || row.receipt || '', amountBs: money(row.amountBs), createdAt: row.createdAt, paymentMethod: row.paymentMethod, paymentAccount: row.paymentAccount })),
  };
};

export const applyCancellationSettlement = (state, contract, rental, payload, createRefund) => {
  state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
  const draft = payload.economicSettlement;
  const preview = cancellationPreview(state, contract, rental);
  if (typeof draft?.operationId !== 'string' || !draft.operationId.trim() || draft.operationId.length > 160) fail('Debes revisar y confirmar la liquidacion economica antes de anular.');
  if (preview.unbackedBs > 0.009) fail('Hay cobros historicos sin respaldo en caja. Revisa el economico antes de anular.');
  if (draft.version !== preview.version) fail('El economico cambio en otra sesion. Cierra y vuelve a abrir la anulacion para revisar los montos.');
  const penaltyBs = Number(draft.retainedPenaltyBs);
  const refundBs = Number(draft.refundBs);
  if (![penaltyBs, refundBs].every(value => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)))) fail('Los montos de multa y devolucion deben ser validos y no negativos.');
  if (money(penaltyBs + refundBs) !== preview.availableBs) fail('La multa retenida mas la devolucion deben coincidir con el dinero disponible del cliente.');
  const method = String(draft.paymentMethod || 'efectivo');
  if (!['efectivo', 'qr'].includes(method)) fail('Selecciona efectivo o QR para la devolucion.');
  if (refundBs > 0 && method === 'qr' && !String(draft.paymentAccount || '').trim()) fail('Selecciona la cuenta bancaria desde la que devolveras el dinero.');
  const now = new Date().toISOString();
  const settlement = {
    operationId: draft.operationId, receivedBs: preview.receivedBs, previouslyRefundedBs: preview.refundedBs,
    availableBeforeBs: preview.availableBs, retainedPenaltyBs: money(penaltyBs), refundBs: money(refundBs),
    guaranteeBeforeBs: preview.guaranteeConfiguredBs, guaranteeAfterBs: 0,
    receivableAfterBs: 0, availableAfterBs: 0, settledAt: now,
    settledByName: payload.userName || payload.createdByName || 'Sistema', reason: String(payload.reason || '').trim(),
    paymentMethod: method, paymentAccount: method === 'qr' ? String(draft.paymentAccount || '').trim() : '',
    sourceReceipts: preview.receipts, refundMovementId: null, refundReceiptCode: null,
  };
  let movement = null;
  if (refundBs > 0) {
    movement = createRefund({
      type: 'egreso_devolucion_anulacion', amountBs: -money(refundBs), cashBoxType: 'BIG_CASH',
      sourceType: 'contract_cancellation', sourceId: contract?.id ?? rental.id,
      linkedContractId: contract?.id, linkedRentalId: rental.id, linkedOrderCode: rental.orderCode,
      category: 'devolucion_anulacion', accountingTag: 'contract_cancellation_refund',
      paymentMethod: method, paymentAccount: settlement.paymentAccount, createdBy: settlement.settledByName,
      description: `Devolucion por anulacion de contrato ${contract?.contractCode || rental.contractCode || rental.orderCode}`,
      receiptDetail: `Recibido historicamente Bs ${preview.receivedBs.toFixed(2)}. Devuelto anteriormente Bs ${preview.refundedBs.toFixed(2)}. Devuelto ahora Bs ${refundBs.toFixed(2)}. Multa retenida Bs ${penaltyBs.toFixed(2)} (no es un nuevo ingreso). Garantia final Bs 0,00. Motivo: ${settlement.reason}`,
      notes: settlement.reason, clientOperationId: draft.operationId, receivedAmountBs: 0,
    });
    state.cashMovements.push(movement);
    settlement.refundMovementId = movement.id;
    settlement.refundReceiptCode = movement.receiptCode;
  }
  for (const record of [contract, rental].filter(Boolean)) {
    record.cancellationSettlement = structuredClone(settlement);
    record.accountingStatus = 'closed_cancelled';
    record.paymentStatus = 'cancelled_settled';
  }
  if (contract) {
    contract.payment = { ...contract.payment, pendingPaymentBs: 0 };
    contract.totals = { ...contract.totals, guaranteeBs: 0, pendingPaymentBs: 0 };
    contract.guarantee = { ...contract.guarantee, amountBs: 0, status: 'no_aplica' };
    contract.economicLedger = [...(contract.economicLedger ?? []), {
      id: `cancellation-${draft.operationId}`, type: 'note', amountBs: 0, createdAt: now,
      note: `Anulacion liquidada. Recibido Bs ${preview.receivedBs.toFixed(2)}; devuelto ahora Bs ${refundBs.toFixed(2)}; multa retenida Bs ${penaltyBs.toFixed(2)} sin nuevo ingreso.`,
      cashMovementId: movement?.id ?? null, createdByName: settlement.settledByName,
    }];
  }
  rental.depositBs = 0;
  rental.payment = { ...rental.payment, guaranteeStatus: 'no_aplica', pendingPaymentBs: 0 };
  return { settlement, movement, penaltyBs: money(penaltyBs) };
};
