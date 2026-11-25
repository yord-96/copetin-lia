import crypto from 'node:crypto';
import { getVipAvailableBalance, voidVipUsage, findOrphanedVipCharges, vipDate } from '../../src/utils/vipPrepaidLedger.js';
import { calculateReceivableBreakdown } from '../../src/utils/receivables.js';
import { getOrdersContractCashEconomicSummary, getOrdersGuaranteeEconomicSummary } from './ordersEconomicSummary.js';
import { resolveActiveRentalForContract } from '../utils/economicRentalResolver.js';
import { getCashBusinessDate } from '../../src/utils/cashLedgerOrder.js';

const money = value => Math.round(Number(value || 0) * 100) / 100;
const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const phone = value => String(value ?? '').replace(/\D/g, '').replace(/^591(?=\d{8}$)/, '');
const active = row => !row.deletedAt && !['eliminado', 'anulado', 'cancelled', 'canceled'].includes(norm(row.status));
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const sum = (rows, get) => money(rows.reduce((total, row) => total + money(get(row)), 0));
const clientSummary = client => ({ id: client.id, name: client.name || client.companyName, phone: client.phone, prepaidEnabled: Boolean(client.prepaidEnabled), balanceBs: money(client.prepaidBalanceBs), availableBs: getVipAvailableBalance(client), usageFrom: client.prepaidUsageFrom || '', cutover: client.vipCutover || null, updatedAt: client.updatedAt || null });
const clientFamily = client => new Set([client.id, ...(client.mergedClientIds || [])]);
const getClient = (state, id) => {
  const client = (state.clients || []).find(row => row.id === id && !row.deletedAt && !row.mergedIntoClientId);
  if (!client || !client.prepaidEnabled) fail('No se encontró la cuenta VIP activa.', 404);
  return client;
};
const dateAt = date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) fail('Indica una fecha válida.');
  const at = `${date}T12:00:00-04:00`;
  if (!Number.isFinite(Date.parse(at)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) fail('Indica una fecha válida.');
  return new Date(at).toISOString();
};
const liveCash = row => !row.deletedAt && !row.voidedAt && row.receiptStatus !== 'anulado';

export function buildVipWorkspace(state, clientId) {
  const client = getClient(state, clientId);
  const family = clientFamily(client);
  const cash = (state.cashMovements || []).filter(liveCash);
  const ledger = (client.prepaidMovements || []).filter(row => !row.deletedAt);
  const rows = (state.contracts || []).filter(row => active(row) && family.has(row.clientId)).map(contract => {
    const rental = resolveActiveRentalForContract(state.rentals, contract);
    const refs = new Set([contract.id, rental?.id, contract.rentalId, contract.orderCode, rental?.orderCode].filter(Boolean));
    const prepaidRows = ledger.filter(row => row.type === 'charge' && (refs.has(row.sourceId) || refs.has(row.orderCode)));
    const prepaid = sum(prepaidRows, row => row.serviceBs ?? Math.abs(row.amountBs));
    const storedPrepaid = money(contract.payment?.prepaidAppliedBs ?? contract.prepaidAppliedBs);
    const cashSummary = getOrdersContractCashEconomicSummary(contract, cash);
    const linkedCash = cash.filter(row => [row.linkedContractId, row.contractId, row.sourceId, row.linkedRentalId, row.linkedOrderCode].some(id => refs.has(id)));
    const charges = (contract.economicLedger || []).filter(row => !row.deletedAt && row.type === 'charge');
    const damageBs = Math.max(Number(rental?.returnSettlement?.penaltiesBs || 0), sum(charges, row => row.amountBs));
    const guarantee = getOrdersGuaranteeEconomicSummary(contract, cash, cashSummary);
    const damageCashBs = sum(linkedCash.filter(row => row.collectionTarget === 'damage' || norm(row.accountingTag).includes('damage') || norm(row.category).includes('danos')), row => Math.max(0, Number(row.amountBs || 0)));
    const damageCollectedBs = Math.max(damageCashBs, Number(rental?.payment?.damageCollectedBs || 0), Number(rental?.returnSettlement?.damageCollectedBs || 0), Number(rental?.returnSettlement?.penaltiesCollectedBs || 0));
    const balance = calculateReceivableBreakdown({ contract, rental, confirmedCommercialPaidBs: money(cashSummary.contractPaidBs + Math.max(prepaid, storedPrepaid)), prepaidAppliedBs: Math.max(prepaid, storedPrepaid), damageChargeOverrideBs: damageBs, damageCollectedOverrideBs: damageCollectedBs, damageCoveredOverrideBs: Math.max(guarantee.appliedBs, Number(rental?.returnSettlement?.discountCoveredByDepositBs || 0)) });
    const warnings = [];
    if (Math.abs(prepaid - storedPrepaid) > .009) warnings.push(`Consumo en cuenta VIP ${prepaid.toFixed(2)}; aplicación en contrato ${storedPrepaid.toFixed(2)}.`);
    if (cashSummary.contractPaidBs + Math.max(prepaid, storedPrepaid) > balance.totalBs + .009) warnings.push('Los pagos y el prepago superan el alquiler. Revisar comprobantes antes de aplicar más saldo.');
    return {
      id: contract.id, code: contract.contractCode, orderCode: rental?.orderCode || contract.orderCode || '',
      eventDate: contract.eventDate, createdAt: contract.contractDate || contract.createdAt,
      customerName: contract.customerName, address: contract.address || rental?.address || '', logisticsMode: contract.logisticsMode || rental?.logisticsMode,
      ...balance, damageBs: money(damageBs), prepaidBs: prepaid, vipConsumedBs: sum(prepaidRows, row => Math.abs(row.amountBs)), storedPrepaidBs: storedPrepaid,
      historicalPaidBs: sum((contract.vipSettlements || []).filter(row => row.mode === 'historical' && !row.deletedAt), row => row.serviceBs + row.damageBs),
      items: (contract.items || rental?.items || []).map(row => ({ name: row.itemName || row.name, quantity: row.quantity, amountBs: row.lineTotalBs, date: row.serviceDate, day: row.serviceDayLabel })),
      services: (contract.services || []).map(row => ({ name: row.name || row.serviceName || row.description || 'Servicio', amountBs: row.totalBs ?? row.lineTotalBs ?? row.amountBs, date: row.serviceDate })),
      receipts: linkedCash.map(row => ({ id: row.id, code: row.receiptCode || row.receipt, date: row.cashEffectiveDate || row.createdAt, amountBs: row.amountBs, description: row.description, paymentMethod: row.paymentMethod, paymentAccount: row.paymentAccount })),
      economicLedger: (contract.economicLedger || []).filter(row => !row.deletedAt).map(row => ({ id: row.id, type: row.type, amountBs: row.amountBs, date: row.createdAt, note: row.note, receipt: row.cashReceiptCode, nonPhysical: row.nonPhysical })),
      settlements: (contract.vipSettlements || []).filter(row => !row.deletedAt), warnings,
    };
  }).sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')) || String(a.code).localeCompare(String(b.code)));
  let runningBs = 0;
  const movements = ledger.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id))).map(row => {
    runningBs = money(runningBs + Number(row.amountBs || 0));
    const contract = rows.find(c => [c.id, c.orderCode].includes(row.sourceId) || c.orderCode && c.orderCode === row.orderCode);
    return { ...row, contractCode: contract?.code || '', calculatedBalanceBs: runningBs };
  });
  const candidates = (state.clients || []).filter(row => active(row) && row.id !== client.id && !row.mergedIntoClientId && (
    phone(client.phone) && phone(row.phone) === phone(client.phone)
    || norm(row.name).split(',')[0] === norm(client.name).split(',')[0]
  )).map(row => ({ ...clientSummary(row), contractCount: (state.contracts || []).filter(c => active(c) && c.clientId === row.id).length }));
  return { client: clientSummary(client), mergedClients: client.mergedClients || [], mergeCandidates: candidates, rows, movements, orphanedMovements: findOrphanedVipCharges(state, client).map(row => ({ id: row.id, orderCode: row.orderCode, amountBs: row.amountBs, description: row.description })), archivedMovements: (client.prepaidMovements || []).filter(row => row.deletedAt),
    summary: { contracts: rows.length, paidCount: rows.filter(row => row.totalPendingBs <= .009).length, pendingCount: rows.filter(row => row.totalPendingBs > .009).length,
      pendingBs: sum(rows, row => row.totalPendingBs), serviceBs: sum(rows, row => row.totalBs), paidBs: sum(rows, row => row.paidBs),
      addedBs: sum(ledger.filter(row => row.amountBs > 0), row => row.amountBs), deductedBs: sum(ledger.filter(row => row.amountBs < 0), row => Math.abs(row.amountBs)),
      ledgerBalanceBs: runningBs, balanceDifferenceBs: money(Number(client.prepaidBalanceBs || 0) - runningBs) } };
}

const mergeReferences = ['clientId', 'customerId', 'prepaidClientId', 'vipClientId'];
export function previewVipCutover(state, clientId, cutoffDate, openingBs) {
  const client = getClient(state, clientId);
  dateAt(cutoffDate);
  if (cutoffDate >= vipDate()) fail('El corte debe corresponder a un día ya cerrado.');
  if (client.vipCutover) fail('Esta cuenta ya tiene un corte. Edita su saldo inicial o revisa el historial, sin volver a archivar el periodo.', 409);
  if (openingBs === '' || openingBs == null || !Number.isFinite(Number(openingBs)) || Number(openingBs) < 0) fail('Indica el saldo exacto del respaldo al cierre.');
  const ledger = (client.prepaidMovements || []).filter(row => !row.deletedAt);
  if (ledger.some(row => !getCashBusinessDate(row.createdAt))) fail('Hay movimientos sin fecha válida. Revísalos antes del corte.');
  const archived = ledger.filter(row => getCashBusinessDate(row.createdAt) <= cutoffDate);
  const retained = ledger.filter(row => getCashBusinessDate(row.createdAt) > cutoffDate);
  const resultingBalanceBs = money(Number(openingBs) + sum(retained, row => row.amountBs));
  if (resultingBalanceBs < 0) fail('Las aplicaciones posteriores superan el saldo inicial. Revísalas antes del corte.', 409);
  const controlFrom = new Date(new Date(`${cutoffDate}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  const family = clientFamily(client);
  const contracts = (state.contracts || []).filter(row => family.has(row.clientId));
  const rentals = (state.rentals || []).filter(row => family.has(row.clientId) || family.has(row.prepaidClientId));
  const token = crypto.createHash('sha256').update(JSON.stringify({ client, contracts, rentals, cutoffDate, openingBs: money(openingBs) })).digest('hex');
  return { token, cutoffDate, controlFrom, openingBs: money(openingBs), previousBalanceBs: money(client.prepaidBalanceBs),
    resultingBalanceBs, archivedCount: archived.length, reversedApplications: archived.filter(row => row.type === 'charge').length,
    retainedCount: retained.length, retainedNetBs: sum(retained, row => row.amountBs), contracts: contracts.filter(active).length };
}
export function previewVipMerge(state, clientId, sourceIds) {
  const target = getClient(state, clientId);
  const ids = [...new Set(Array.isArray(sourceIds) ? sourceIds : [])];
  if (!ids.length || ids.includes(clientId)) fail('Selecciona las fichas duplicadas que deseas vincular.');
  const sources = ids.map(id => (state.clients || []).find(row => row.id === id && active(row) && !row.mergedIntoClientId));
  if (sources.some(row => !row)) fail('Una ficha ya no está disponible. Actualiza la vista.', 409);
  const family = new Set(sources.flatMap(row => [row.id, ...(row.mergedClientIds || [])]));
  const affected = {};
  for (const [collection, entries] of Object.entries(state)) {
    if (!Array.isArray(entries) || ['clients', 'systemAuditLog', 'resetLogs', 'userPresence'].includes(collection)) continue;
    const matches = entries.filter(row => mergeReferences.some(field => family.has(row[field])) || norm(row.sourceType).startsWith('client') && family.has(row.sourceId));
    if (matches.length) affected[collection] = matches.map(row => [row.id, row.updatedAt || '', row.clientId, row.customerId, row.prepaidClientId, row.vipClientId]);
  }
  const all = [target, ...sources];
  const ledgerIds = new Set();
  for (const row of all.flatMap(row => row.prepaidMovements || [])) {
    if (ledgerIds.has(row.id)) fail('Hay movimientos VIP con identificadores repetidos. Deben revisarse antes de unificar.', 409);
    ledgerIds.add(row.id);
  }
  const signature = JSON.stringify({ clients: all.map(row => [row.id, row.updatedAt, row.prepaidBalanceBs, row.prepaidMovements]), affected });
  return { primary: clientSummary(target), sources: sources.map(clientSummary), counts: Object.fromEntries(Object.entries(affected).map(([name, entries]) => [name, entries.length])),
    balanceBs: sum(all, row => row.prepaidBalanceBs), token: crypto.createHash('sha256').update(signature).digest('hex') };
}

export function mutateVipAccount(state, payload, now = new Date().toISOString()) {
  const actor = (state.users || []).find(row => row.id === payload.actorUserId);
  // Permission is checked by the route against the current user record.
  const client = getClient(state, payload.clientId);
  const operationId = String(payload.clientOperationId || '').trim();
  if (!operationId || operationId.length > 150) fail('Falta el identificador de la operación.');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const duplicate = (client.vipOperations || []).find(row => row.id === operationId);
  if (duplicate) {
    if (duplicate.fingerprint !== fingerprint) fail('Esta operación ya guardó otros datos.', 409);
    return { duplicate: true, operation: duplicate };
  }
  const reason = String(payload.reason || '').trim();
  if (!reason) fail('Escribe el motivo y el respaldo de la conciliación.');
  const actorName = actor?.fullName || actor?.name || 'Contabilidad';
  let detail = '';
  if (payload.action === 'merge') {
    const preview = previewVipMerge(state, client.id, payload.sourceIds);
    if (preview.token !== payload.previewToken) fail('Los datos cambiaron. Vuelve a revisar la vista previa de unificación.', 409);
    const sources = state.clients.filter(row => payload.sourceIds.includes(row.id));
    const sourceIds = new Set(sources.flatMap(row => [row.id, ...(row.mergedClientIds || [])]));
    client.mergedClientIds = [...new Set([...(client.mergedClientIds || []), ...sourceIds])];
    client.mergedClients = [...(client.mergedClients || []), ...sources.map(row => ({ id: row.id, name: row.name, mergedAt: now, balanceBs: money(row.prepaidBalanceBs) }))];
    const addresses = [...(client.deliveryAddresses || []), ...sources.flatMap(row => [...(row.deliveryAddresses || []), ...(row.address ? [{ id: crypto.randomUUID(), address: row.address, city: row.city, label: row.name }] : [])])];
    client.deliveryAddresses = addresses.filter((row, index) => addresses.findIndex(other => norm(other.address) === norm(row.address) && norm(other.city) === norm(row.city)) === index);
    client.attachments = [...(client.attachments || []), ...sources.flatMap(row => row.attachments || [])];
    client.prepaidMovements = [...(client.prepaidMovements || []), ...sources.flatMap(row => row.prepaidMovements || [])];
    client.prepaidBalanceBs = preview.balanceBs;
    client.prepaidTotalDepositedBs = sum([client, ...sources], row => row.prepaidTotalDepositedBs);
    client.prepaidTotalUsedBs = sum([client, ...sources], row => row.prepaidTotalUsedBs);
    for (const [name, entries] of Object.entries(state)) {
      if (!Array.isArray(entries) || ['clients', 'systemAuditLog', 'resetLogs', 'userPresence'].includes(name)) continue;
      for (const row of entries) {
        for (const field of mergeReferences) if (sourceIds.has(row[field])) row[field] = client.id;
        if (norm(row.sourceType).startsWith('client') && sourceIds.has(row.sourceId)) row.sourceId = client.id;
      }
    }
    for (const source of sources) {
      source.mergedIntoClientId = client.id; source.mergedAt = now; source.deletedAt = now; source.status = 'merged';
      source.prepaidEnabled = false;
      // The archived source keeps its original financial data as evidence.
    }
    detail = `Unificó ${sources.map(row => row.name).join(', ')} en ${client.name}. Saldo conservado ${preview.balanceBs.toFixed(2)}. ${reason}`;
  } else {
    if (!Object.hasOwn(payload, 'expectedBalanceBs') || money(payload.expectedBalanceBs) !== money(client.prepaidBalanceBs) || (payload.expectedUpdatedAt || null) !== (client.updatedAt || null)) fail('La cuenta cambió. Actualiza antes de conciliar.', 409);
    const createdAt = dateAt(payload.date);
    client.prepaidMovements ||= [];
    if (payload.action === 'cutover') {
      const preview = previewVipCutover(state, client.id, payload.cutoffDate, payload.openingBs);
      if (preview.token !== payload.previewToken) fail('La cuenta o sus contratos cambiaron. Revisa nuevamente el corte.', 409);
      const batchId = crypto.randomUUID();
      for (const movement of client.prepaidMovements.filter(row => !row.deletedAt && getCashBusinessDate(row.createdAt) <= payload.cutoffDate)) {
        if (movement.type === 'charge') {
          const alreadyReturned = client.prepaidMovements.some(row => !row.deletedAt && row.sourceType === 'rental_reversal' && row.sourceId === movement.sourceId && Number(row.amountBs) > 0);
          if (!alreadyReturned) voidVipUsage(state, client, movement, { now, reason: `Corte histórico: ${reason}`, actorName });
        }
        Object.assign(movement, { deletedAt: now, deletedByName: actorName, deletionReason: `Archivado por corte al ${payload.cutoffDate}. ${reason}`, vipCutoverId: batchId });
      }
      const opening = { id: crypto.randomUUID(), type: 'deposit', amountBs: preview.openingBs,
        description: `Saldo inicial conciliado al cierre del ${payload.cutoffDate}`, reference: String(payload.reference || '').trim(),
        sourceType: 'vip_cutover_opening', sourceId: client.id, nonPhysical: true, createdAt: dateAt(payload.cutoffDate),
        availableFromDate: preview.controlFrom, registeredAt: now, createdBy: actorName, vipCutoverId: batchId };
      client.prepaidMovements.push(opening);
      client.prepaidBalanceBs = preview.resultingBalanceBs;
      client.prepaidTotalDepositedBs = sum(client.prepaidMovements.filter(row => !row.deletedAt && row.amountBs > 0), row => row.amountBs);
      client.prepaidTotalUsedBs = sum(client.prepaidMovements.filter(row => !row.deletedAt && row.amountBs < 0), row => Math.abs(row.amountBs));
      client.prepaidUsageFrom = preview.controlFrom;
      client.vipCutover = { id: batchId, cutoffDate: payload.cutoffDate, controlFrom: preview.controlFrom,
        openingBs: preview.openingBs, openingId: opening.id, previousBalanceBs: preview.previousBalanceBs,
        archivedCount: preview.archivedCount, reference: opening.reference, reason, createdAt: now, actorName };
      detail = `Corte VIP al ${payload.cutoffDate}: archivó ${preview.archivedCount} movimientos y reconoció saldo ${preview.openingBs.toFixed(2)}. Sin movimiento de caja. ${reason}`;
    } else if (payload.action === 'repair-orphans') {
      const orphaned = findOrphanedVipCharges(state, client);
      if (!orphaned.length) fail('No quedan aplicaciones sin respaldo. Actualiza la cuenta.', 409);
      for (const movement of orphaned) voidVipUsage(state, client, movement, { now, reason, actorName });
      detail = `Sincronizó ${orphaned.length} aplicaciones cuyo pago fue eliminado. ${reason}`;
    } else if (payload.action === 'movement') {
      const entry = client.prepaidMovements.find(row => row.id === payload.movementId && !row.deletedAt);
      if (payload.movementAction !== 'create' && !entry) fail('El movimiento ya no está activo. Actualiza la cuenta.', 409);
      if (entry?.type === 'charge') {
        if (payload.movementAction !== 'void') fail('Para cambiar una aplicación, anúlala y registra el importe correcto desde el contrato.');
        voidVipUsage(state, client, entry, { now, reason, actorName });
        detail = `Anuló aplicación VIP ${Math.abs(entry.amountBs).toFixed(2)}. Saldo devuelto a la cuenta. ${reason}`;
      } else {
        if (!['create', 'edit', 'void'].includes(payload.movementAction)) fail('Acción de movimiento inválida.');
        const voiding = payload.movementAction === 'void';
        const amountBs = voiding ? 0 : money(payload.amountBs);
        if (!voiding && (!Number.isFinite(Number(payload.amountBs)) || (entry?.type === 'adjustment' ? amountBs === 0 : amountBs <= 0))) fail('Indica un importe válido para el aporte o ajuste.');
        if (!voiding && payload.availableFromDate) dateAt(payload.availableFromDate);
        const beforeBs = Number(entry?.amountBs || 0);
        const nextBalance = money(Number(client.prepaidBalanceBs || 0) - beforeBs + amountBs);
        if (nextBalance < 0) fail('Ese saldo ya fue utilizado. Primero anula o corrige las aplicaciones a contratos para no dejar la cuenta negativa.', 409);
        const cash = entry?.cashMovementId && (state.cashMovements || []).find(row => row.id === entry.cashMovementId);
        if (cash && !(cash.vipClientId === client.id || cash.sourceType === 'client_prepaid' && [client.id, ...(client.mergedClientIds || [])].includes(cash.sourceId))) fail('El recibo asociado no pertenece a esta cuenta VIP.', 409);
        if (cash && (cash.voidedAt || cash.deletedAt || cash.receiptStatus === 'anulado') && !voiding && !payload.nonPhysical) fail('El recibo está anulado. Reconoce un saldo histórico o registra una nueva recarga real.');
        if (!voiding && !payload.nonPhysical && !cash) fail('Para dinero nuevo usa Recargar saldo VIP. Este formulario registra aportes históricos sin dinero nuevo.');
        if (cash && (voiding || payload.nonPhysical)) {
          cash.voidedAt = now;cash.voidedBy = actorName;cash.receiptStatus = 'anulado';cash.voidReason = `Corrección de aporte VIP: ${reason}`;
        } else if (cash) {
          cash.vipEditHistory = [...(cash.vipEditHistory || []), { amountBs: cash.amountBs, createdAt: cash.createdAt, date: cash.cashEffectiveDate, editedAt: now, reason, actorName }];
          cash.amountBs = amountBs;cash.receivedAmountBs = amountBs;cash.cashEffectiveDate = payload.date;cash.createdAt = createdAt;cash.receiptIssuedAt = createdAt;cash.updatedAt = now;
          cash.notes = reason;cash.receiptDetail = `Aporte VIP de ${client.name}. ${payload.reference || ''}. ${reason}`;
        }
        if (voiding) { entry.deletedAt = now;entry.deletedByName = actorName;entry.deletionReason = reason; }
        else if (entry) {
          entry.editHistory = [...(entry.editHistory || []), { amountBs: entry.amountBs, createdAt: entry.createdAt, availableFromDate: entry.availableFromDate, description: entry.description, editedAt: now, reason, actorName }];
          Object.assign(entry, { amountBs, description: reason, reference: payload.reference || '', availableFromDate: payload.availableFromDate || payload.date, createdAt, nonPhysical: Boolean(payload.nonPhysical), editedAt: now, editedByName: actorName, balanceAfterBs: nextBalance });
        } else client.prepaidMovements.push({ id: crypto.randomUUID(), type: 'deposit', amountBs, description: reason, reference: payload.reference || '', createdAt, availableFromDate: payload.availableFromDate || payload.date, nonPhysical: true, sourceType: 'vip_historical_credit', sourceId: client.id, createdBy: actorName, registeredAt: now, balanceAfterBs: nextBalance });
        if (entry?.sourceType === 'vip_cutover_opening' && client.vipCutover?.openingId === entry.id) {
          client.vipCutover.openingBs = amountBs;
          client.vipCutover.updatedAt = now;
          if (!voiding) client.vipCutover.reference = payload.reference || '';
        }
        client.prepaidBalanceBs = nextBalance;
        if (!entry || entry.type === 'deposit') client.prepaidTotalDepositedBs = money(Math.max(0, Number(client.prepaidTotalDepositedBs || 0) - beforeBs + amountBs));
        detail = `${voiding ? 'Anuló' : entry ? 'Editó' : 'Registró'} aporte VIP. Cambio ${money(amountBs - beforeBs).toFixed(2)}. ${reason}`;
      }
    } else if (payload.action === 'usage-date') {
      if (payload.usageFrom) dateAt(payload.usageFrom);
      client.prepaidUsageFrom = payload.usageFrom || '';
      detail = `Definió uso manual del saldo VIP desde ${payload.usageFrom || 'sin restricción'}. ${reason}`;
    } else if (payload.action === 'adjust') {
      const desired = Number(payload.balanceBs);
      if (!Number.isFinite(desired) || desired < 0) fail('El saldo conciliado debe ser cero o mayor.');
      const amountBs = money(desired - Number(client.prepaidBalanceBs || 0));
      if (!amountBs) fail('El saldo indicado ya coincide con el saldo actual.');
      client.prepaidMovements.push({ id: crypto.randomUUID(), type: 'adjustment', amountBs, description: `Conciliación histórica: ${reason}`, sourceType: 'vip_reconciliation', sourceId: client.id, nonPhysical: true, createdAt, registeredAt: now, createdBy: actorName, balanceAfterBs: money(desired), reference: String(payload.reference || '').trim() });
      client.prepaidBalanceBs = money(desired);
      detail = `Concilió saldo VIP por ${amountBs.toFixed(2)}. Nuevo saldo ${money(desired).toFixed(2)}. ${reason}`;
    } else if (payload.action === 'settle') {
      if (!['balance', 'historical'].includes(payload.mode)) fail('Selecciona el origen del pago.');
      if (payload.mode === 'balance' && client.vipCutover && payload.date <= client.vipCutover.cutoffDate) fail('El periodo anterior al corte se revisa como cancelación histórica, sin volver a descontar el saldo inicial.');
      const workspace = buildVipWorkspace(state, client.id);
      const row = workspace.rows.find(row => row.id === payload.contractId);
      if (!row) fail('El contrato no pertenece a esta cuenta VIP.', 404);
      if (payload.expectedContractToken !== vipContractToken(state, row.id)) fail('El contrato cambió. Vuelve a abrir su detalle.', 409);
      const serviceBs = money(payload.serviceBs), damageBs = money(payload.damageBs);
      if (![Number(payload.serviceBs), Number(payload.damageBs)].every(Number.isFinite) || serviceBs < 0 || damageBs < 0 || serviceBs + damageBs <= 0) fail('Indica un importe válido de alquiler o daños.');
      if (serviceBs > row.commercialPendingBs + .009 || damageBs > row.damagePendingBs + .009) fail('El importe supera el saldo pendiente del contrato.');
      const amountBs = money(serviceBs + damageBs);
      if (payload.mode === 'balance' && payload.date > vipDate()) fail('El saldo se aplica en la fecha del pago. No registres una aplicación futura antes de que el saldo esté habilitado.');
      if (payload.mode === 'balance' && amountBs > getVipAvailableBalance(client, payload.date) + .009) fail('El saldo habilitado para esa fecha no alcanza. Revisa la fecha desde la que se puede usar el saldo.', 409);
      const contract = state.contracts.find(c => c.id === row.id);
      const rental = resolveActiveRentalForContract(state.rentals, contract);
      const settlement = { id: crypto.randomUUID(), mode: payload.mode, serviceBs, damageBs, createdAt, registeredAt: now, reason, reference: String(payload.reference || '').trim(), createdBy: actorName, clientOperationId: operationId, clientId: client.id };
      contract.vipSettlements = [...(contract.vipSettlements || []), settlement];
      if (payload.mode === 'balance') {
        client.prepaidBalanceBs = money(Number(client.prepaidBalanceBs || 0) - amountBs);
        client.prepaidTotalUsedBs = money(Number(client.prepaidTotalUsedBs || 0) + amountBs);
        client.prepaidMovements.push({ id: settlement.id, type: 'charge', amountBs: -amountBs, serviceBs, damageBs, description: `Aplicación VIP contrato ${row.code}: ${reason}`, sourceType: 'rental', sourceId: rental?.id || contract.id, orderCode: row.orderCode, balanceAfterBs: client.prepaidBalanceBs, nonPhysical: true, createdAt, registeredAt: now, createdBy: actorName, reference: settlement.reference });
      }
      const newPaid = money(row.paidBs + serviceBs);
      const applied = money(Math.max(row.prepaidBs, row.storedPrepaidBs) + (payload.mode === 'balance' ? serviceBs : 0));
      contract.payment = { ...contract.payment, paidAtApprovalBs: newPaid, pendingBs: money(row.totalBs - newPaid), prepaidAppliedBs: applied };
      contract.prepaidAppliedBs = applied;
      contract.economicLedger ||= [];
      // A note cannot be converted into a second cash receipt by the economic
      // editor. The structured settlement and payment fields own these amounts.
      contract.economicLedger.push({ id: settlement.id, type: 'note', amountBs: 0, note: `${payload.mode === 'historical' ? 'Cancelación histórica ya incluida en saldo conciliado' : 'Aplicación de saldo VIP'}. Alquiler Bs ${serviceBs.toFixed(2)}; daños Bs ${damageBs.toFixed(2)}. ${settlement.reference}. ${reason}`, createdAt, createdByName: actorName, nonPhysical: true, vipSettlementId: settlement.id, reference: settlement.reference });
      if (rental) {
        rental.payment = { ...rental.payment, paidAtRentalBs: newPaid, prepaidAppliedBs: applied, damageCollectedBs: money(Math.max(Number(rental.payment?.damageCollectedBs || 0), Number(rental.returnSettlement?.damageCollectedBs || 0)) + damageBs), pendingPaymentBs: money(row.totalPendingBs - amountBs), status: row.totalPendingBs - amountBs <= .009 ? 'cancelado' : 'a_cuenta' };
        rental.prepaidAppliedBs = applied;
        rental.totals = { ...rental.totals, paidAtRentalBs: newPaid, prepaidAppliedBs: applied };
        if (rental.returnSettlement || damageBs) rental.returnSettlement = { ...rental.returnSettlement, paidBs: newPaid, damageCollectedBs: rental.payment.damageCollectedBs, pendingCollectionBs: rental.payment.pendingPaymentBs };
        rental.updatedAt = now;
        rental.prepaidClientId = client.id;
      }
      contract.updatedAt = now;
      detail = `${payload.mode === 'historical' ? 'Reconoció cancelación histórica' : 'Aplicó saldo VIP'} ${amountBs.toFixed(2)} a contrato ${row.code}. ${reason}`;
    } else fail('Operación VIP no válida.');
  }
  client.updatedAt = now;
  const operation = { id: operationId, fingerprint, action: payload.action, detail, createdAt: now, actorUserId: actor?.id, actorName };
  client.vipOperations = [...(client.vipOperations || []), operation];
  state.systemAuditLog ||= [];
  state.systemAuditLog.push({ id: crypto.randomUUID(), action: payload.action, module: 'Prepago VIP', entityType: 'client', entityId: client.id, title: detail, detail, userId: actor?.id, userName: actorName, createdAt: now });
  return { operation };
}

export function vipContractToken(state, id) {
  const contract = (state.contracts || []).find(row => row.id === id);
  if (!contract) return '';
  const rental = resolveActiveRentalForContract(state.rentals, contract);
  const cash = (state.cashMovements || []).filter(row => [row.linkedContractId, row.linkedRentalId, row.sourceId].some(ref => ref && [id, rental?.id].includes(ref)));
  return crypto.createHash('sha256').update(JSON.stringify([
    [contract.id, contract.updatedAt, contract.clientId, contract.totals, contract.payment, contract.economicLedger, contract.vipSettlements],
    rental && [rental.id, rental.updatedAt, rental.payment, rental.totals, rental.returnSettlement], cash,
  ])).digest('hex');
}
