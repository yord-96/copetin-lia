import { Router } from 'express';
import { updateStateSnapshot } from '../storage/fileStateStore.js';
import { getWebBridge } from '../../src/services/webBridge.js';

const router = Router();
const internalKey = String(process.env.APP_INTERNAL_KEY ?? '').trim();

const requireInternalKey = (req, res, next) => {
  if (!internalKey) {
    next();
    return;
  }
  const providedKey = String(req.get('X-App-Internal-Key') ?? '').trim();
  if (!providedKey) {
    res.status(401).json({ error: 'Clave interna requerida.' });
    return;
  }
  if (providedKey !== internalKey) {
    res.status(403).json({ error: 'Clave interna invalida.' });
    return;
  }
  next();
};

const toMoney = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Number(number.toFixed(2))) : 0;
};

const normalizeApprovalItems = (items) => (Array.isArray(items) ? items : []).map((line) => ({
  ...line,
  itemId: line?.itemId ?? null,
  lineKey: line?.lineKey ?? null,
  quantity: line?.quantity,
  unitPriceBs: line?.unitPriceBs,
  rentalPriceBs: line?.rentalPriceBs,
  grossLineTotalBs: line?.grossLineTotalBs,
  discountPercent: line?.discountPercent ?? 0,
  discountBs: line?.discountBs ?? 0,
  lineTotalBs: line?.lineTotalBs,
  controlsStock: line?.controlsStock,
  verificationStatus: line?.verificationStatus,
  supplierBackedQty: line?.supplierBackedQty ?? 0,
  internalReservedQty: line?.internalReservedQty ?? null,
  lineType: line?.lineType ?? '',
  observation: line?.observation ?? '',
  quickItem: line?.quickItem ?? null,
  comboId: line?.comboId ?? null,
  comboName: line?.comboName ?? '',
  comboLineKey: line?.comboLineKey ?? null,
  comboComponentName: line?.comboComponentName ?? '',
  comboQuantity: line?.comboQuantity ?? 1,
  comboComponentQuantity: line?.comboComponentQuantity ?? 1,
  comboPricingRole: line?.comboPricingRole ?? '',
  comboPricingCondition: line?.comboPricingCondition ?? null,
  comboRuleIndex: line?.comboRuleIndex ?? 0,
  comboSlotLabel: line?.comboSlotLabel ?? '',
  comboSelectionMode: line?.comboSelectionMode ?? 'item',
  comboOptionItemIds: Array.isArray(line?.comboOptionItemIds) ? line.comboOptionItemIds : [],
  comboCategory: line?.comboCategory ?? '',
  serviceDayId: line?.serviceDayId ?? line?.scheduleDayId ?? null,
  serviceDate: line?.serviceDate ?? line?.date ?? null,
  serviceDayLabel: line?.serviceDayLabel ?? line?.dayLabel ?? '',
}));

const normalizeApprovalServices = (services) => (Array.isArray(services) ? services : []).map((service) => ({
  ...service,
  serviceDayId: service?.serviceDayId ?? service?.scheduleDayId ?? null,
  serviceDate: service?.serviceDate ?? service?.date ?? null,
  serviceDayLabel: service?.serviceDayLabel ?? service?.dayLabel ?? '',
}));

router.post('/__copetin_db/contracts/create-and-approve', requireInternalKey, async (req, res, next) => {
  const startedAt = Date.now();
  const timings = {};
  let lastMarkAt = startedAt;
  const mark = (name) => {
    const now = Date.now();
    timings[name] = now - lastMarkAt;
    lastMarkAt = now;
  };
  const logProfile = (status, extra = {}) => {
    const totalMs = Date.now() - startedAt;
    console.info('[contract-transaction] perfil', { status, totalMs, ...timings, ...extra });
    return totalMs;
  };
  try {
    const contractPayload = req.body?.contract;
    if (!contractPayload || typeof contractPayload !== 'object' || Array.isArray(contractPayload)) {
      res.status(400).json({ error: 'Debes enviar el contrato completo.' });
      return;
    }
    if (contractPayload?._summaryOnly) {
      res.status(409).json({ error: 'No se puede aprobar un contrato resumido.' });
      return;
    }
    if (!Array.isArray(contractPayload.items) || contractPayload.items.length === 0) {
      res.status(400).json({ error: 'El contrato debe incluir sus items completos.' });
      return;
    }

    const trace = req.body?.trace && typeof req.body.trace === 'object' ? req.body.trace : {};
    const expectedRevision = req.body?.revision;
    let responseBundle = null;
    mark('validation');

    const result = await updateStateSnapshot(async (state) => {
      mark('queueAndSnapshot');
      const bridge = getWebBridge();
      await bridge.__storage.beginBatch(state);
      mark('beginBatch');

      try {
      const createdContract = await bridge.contracts.create({
        ...trace,
        ...contractPayload,
      });
      mark('contractCreate');
      if (!createdContract || createdContract._summaryOnly) {
        throw new Error('No se pudo crear el contrato completo.');
      }

      const approvalItems = normalizeApprovalItems(createdContract.items);
      const approvalServices = normalizeApprovalServices(createdContract.services);
      const totalBs = toMoney(createdContract?.totals?.totalBs);
      const paidAtApprovalBs = toMoney(createdContract?.payment?.paidAtApprovalBs);
      const rawGuaranteeStatus = String(
        createdContract?.guarantee?.status
          ?? createdContract?.payment?.guaranteeStatus
          ?? '',
      ).trim();
      const isGuaranteeValidated = rawGuaranteeStatus === 'validado'
        || (!rawGuaranteeStatus && toMoney(createdContract?.totals?.guaranteeBs) > 0);
      const guaranteeForCashBs = isGuaranteeValidated
        ? toMoney(createdContract?.totals?.guaranteeBs)
        : 0;

      const currentState = await bridge.__storage.exportState();
      const localClient = (currentState.clients ?? []).find((entry) => entry.id === createdContract.clientId)
        ?? (currentState.clients ?? []).find((entry) => (
          String(entry?.name ?? '').trim().toLowerCase()
          === String(createdContract.customerName ?? '').trim().toLowerCase()
        ));
      mark('exportAfterContract');
      const availablePrepaidBs = localClient?.prepaidEnabled
        ? toMoney(localClient.prepaidBalanceBs)
        : 0;
      const requestedPrepaidAppliedBs = toMoney(
        createdContract?.payment?.prepaidAppliedBs ?? createdContract?.prepaidAppliedBs,
      );
      const prepaidAppliedBs = Math.min(
        requestedPrepaidAppliedBs,
        availablePrepaidBs,
        Math.max(0, totalBs - paidAtApprovalBs),
      );
      const coveredAtApprovalBs = toMoney(paidAtApprovalBs + prepaidAppliedBs);
      const paymentMode = coveredAtApprovalBs >= totalBs && totalBs > 0
        ? 'cancelado'
        : coveredAtApprovalBs > 0
          ? 'a_cuenta'
          : 'sin_pago';
      const responsible = Array.isArray(createdContract.responsibles)
        ? createdContract.responsibles.find((entry) => String(entry?.name ?? '').trim())
        : null;

      const createdRental = await bridge.rentals.create({
        ...trace,
        createdBy: responsible?.name ?? createdContract.createdBy ?? createdContract.createdByName ?? trace.createdBy,
        createdById: responsible?.id ?? createdContract.createdById ?? trace.createdById,
        createdByName: responsible?.name ?? createdContract.createdByName ?? trace.createdByName,
        createdByRole: responsible?.role ?? createdContract.createdByRole ?? trace.createdByRole,
        clientId: createdContract.clientId ?? null,
        customerName: createdContract.customerName,
        customerPhone: createdContract.customerPhone,
        contractDate: createdContract.contractDate ?? createdContract.createdAt,
        rentalDate: createdContract.deliveryDate || createdContract.eventDate,
        dueDate: createdContract.pickupDate || createdContract.deliveryDate || createdContract.eventDate,
        dueTime: createdContract.pickupWindowEnd || createdContract.eventTime || '23:59',
        deliveryWindowStart: createdContract.deliveryWindowStart || '00:00',
        deliveryWindowEnd: createdContract.deliveryWindowEnd || createdContract.eventTime || null,
        pickupWindowStart: createdContract.pickupWindowStart || null,
        pickupWindowEnd: createdContract.pickupWindowEnd || createdContract.eventTime || '23:59',
        depositBs: guaranteeForCashBs,
        guaranteeDeclaredBs: toMoney(createdContract?.totals?.guaranteeBs),
        guaranteeStatus: isGuaranteeValidated ? 'validado' : 'no_validado',
        guaranteePaymentMethod: createdContract?.guarantee?.paymentMethod
          ?? createdContract?.payment?.guaranteePaymentMethod
          ?? 'efectivo',
        guaranteePaymentAccount: createdContract?.guarantee?.paymentAccount
          ?? createdContract?.payment?.guaranteePaymentAccount
          ?? '',
        paidAtRentalBs: coveredAtApprovalBs,
        initialPaymentMethod: createdContract?.payment?.initialPaymentMethod ?? 'efectivo',
        initialPaymentAccount: createdContract?.payment?.initialPaymentAccount ?? '',
        paymentMode,
        prepaidClientId: prepaidAppliedBs > 0 ? localClient?.id : null,
        prepaidAppliedBs,
        notes: createdContract.observations,
        billingMode: createdContract.billingMode ?? 'sin_factura',
        logisticsMode: createdContract.logisticsMode ?? 'envio',
        deliveryChargeMode: createdContract.deliveryChargeMode
          ?? (toMoney(createdContract?.totals?.deliveryFeeBs) > 0 ? 'extra' : 'included'),
        deliveryFeeBs: toMoney(createdContract?.totals?.deliveryFeeBs ?? createdContract?.deliveryFeeBs),
        deliveryFeeReason: createdContract.deliveryFeeReason
          ?? (toMoney(createdContract?.totals?.deliveryFeeBs) > 0 ? 'quantity' : 'covered'),
        pricingPlan: createdContract.pricingPlan ?? null,
        supplierFulfillmentPlan: Array.isArray(createdContract.supplierFulfillmentPlan)
          ? createdContract.supplierFulfillmentPlan
          : [],
        quotedTotals: createdContract.totals ?? null,
        eventType: createdContract.eventType,
        eventAddress: createdContract.address,
        contractId: createdContract.id,
        contractCode: createdContract.contractCode,
        allowPastDueDate: true,
        items: approvalItems,
        services: approvalServices,
      });

      mark('rentalCreate');
      const approvedAt = createdContract.approvedAt
        ?? createdRental.createdAt
        ?? new Date().toISOString();
      const updatedContract = await bridge.contracts.update({
        id: createdContract.id,
        status: 'aprobado',
        approvedAt,
        rejectedAt: null,
        rentalId: createdRental.id,
        orderCode: createdRental.orderCode,
        paidAtApprovalBs: coveredAtApprovalBs,
        prepaidAppliedBs,
        pricingPlan: createdContract.pricingPlan ?? null,
        items: approvalItems,
        services: approvalServices,
        supplierFulfillmentPlan: Array.isArray(createdContract.supplierFulfillmentPlan)
          ? createdContract.supplierFulfillmentPlan
          : [],
      });

      mark('contractApprove');

      if (createdContract.quoteId) {
        const linkedQuote = (currentState.quotes ?? []).find((entry) => entry.id === createdContract.quoteId);
        if (linkedQuote) {
          await bridge.quotes.update({
            id: linkedQuote.id,
            status: 'aprobada',
            approvedAt,
            rejectedAt: null,
            rentalId: createdRental.id,
            orderCode: createdRental.orderCode,
          });
        }
      }

      mark('quoteUpdate');

      if ((createdContract.logisticsMode ?? 'envio') !== 'recojo') {
        const stateAfterRental = await bridge.__storage.exportState();
        const linkedDeliveries = (stateAfterRental.deliveries ?? []).filter(
          (entry) => entry.rentalId === createdRental.id,
        );
        const outbound = linkedDeliveries[0] ?? null;
        if (outbound) {
          await bridge.transport.updateDelivery({
            id: outbound.id,
            scheduledDate: createdContract.deliveryDate || createdContract.eventDate,
            windowStart: createdContract.deliveryWindowStart || outbound.windowStart,
            windowEnd: createdContract.deliveryWindowEnd || outbound.windowEnd,
            address: createdContract.address || outbound.address,
            city: createdContract.city || outbound.city,
            driverId: createdContract.driverId || outbound.driverId,
            vehicleId: createdContract.vehicleId || outbound.vehicleId,
            notes: `Entrega de ${createdRental.orderCode}. ${createdContract.observations ?? ''}`.trim(),
          });
        }
        if (linkedDeliveries.length < 2) {
          await bridge.transport.createDelivery({
            rentalId: createdRental.id,
            orderCode: createdRental.orderCode,
            customerName: createdContract.customerName,
            companyName: createdContract.companyName || createdContract.customerName,
            address: createdContract.address || 'Direccion pendiente',
            city: createdContract.city || 'Ciudad',
            scheduledDate: createdContract.pickupDate || createdContract.deliveryDate || createdContract.eventDate,
            windowStart: createdContract.pickupWindowStart || '20:00',
            windowEnd: createdContract.pickupWindowEnd || '22:00',
            driverId: createdContract.driverId || null,
            vehicleId: createdContract.vehicleId || null,
            notes: `Recojo programado de ${createdRental.orderCode}`,
          });
        }
      }

      mark('transport');

      const supplierPlan = Array.isArray(createdContract.supplierFulfillmentPlan)
        ? createdContract.supplierFulfillmentPlan
        : [];
      const groupedBySupplier = new Map();
      supplierPlan.forEach((line) => {
        const supplierId = String(line?.supplierId ?? '').trim();
        const supplierName = String(line?.supplierName ?? '').trim();
        const itemName = String(line?.itemName ?? '').trim();
        const itemId = String(line?.itemId ?? '').trim();
        const neededQty = Math.max(0, Math.trunc(Number(line?.neededQty ?? 0)));
        const supplierUnitCostBs = toMoney(line?.supplierUnitCostBs);
        if (!supplierId || !supplierName || !itemName || neededQty <= 0) return;
        if (!groupedBySupplier.has(supplierId)) {
          groupedBySupplier.set(supplierId, { supplierId, items: [] });
        }
        groupedBySupplier.get(supplierId).items.push({
          itemId: itemId || null,
          itemName,
          category: String(line?.category ?? '').trim(),
          quantity: neededQty,
          unitPriceBs: supplierUnitCostBs,
        });
      });
      for (const entry of groupedBySupplier.values()) {
        if (!entry.items.length) continue;
        await bridge.suppliers.createLoan({
          supplierId: entry.supplierId,
          direction: 'from_supplier',
          flowType: 'paid',
          requestDate: createdContract.deliveryDate || createdContract.eventDate || new Date().toISOString().slice(0, 10),
          returnDate: createdContract.pickupDate || null,
          eventName: `Abastecimiento ${createdRental.orderCode}`,
          notes: `Generado automaticamente desde contrato ${createdContract.contractCode}.`,
          sourceContractId: createdContract.id,
          sourceRentalId: createdRental.id,
          sourceOrderCode: createdRental.orderCode,
          autoCreated: true,
          items: entry.items,
        });
      }

      mark('supplierLoans');

      const baseDate = createdRental.rentalDate ?? createdRental.createdAt?.slice(0, 10) ?? null;
      const endDate = createdRental.dueDate ?? baseDate;
      await bridge.reports.generate({
        name: `Contrato ${createdRental.orderCode}`,
        category: 'Documentos',
        periodFrom: baseDate,
        periodTo: endDate,
        format: 'PDF',
        generatedBy: 'Sistema Copetin',
        sourceType: 'contrato',
        sourceId: createdRental.id,
      });
      await bridge.reports.generate({
        name: `Orden Inventario ${createdRental.orderCode}`,
        category: 'Inventario',
        periodFrom: baseDate,
        periodTo: endDate,
        format: 'PDF',
        generatedBy: 'Sistema Copetin',
        sourceType: 'orden_inventario',
        sourceId: createdRental.id,
      });

      mark('reports');

      const finalState = await bridge.__storage.exportState();
      const finalContract = (finalState.contracts ?? []).find((entry) => entry.id === updatedContract.id);
      const finalRental = (finalState.rentals ?? []).find((entry) => entry.id === createdRental.id);
      const linkedDeliveries = (finalState.deliveries ?? []).filter((entry) => entry.rentalId === createdRental.id);
      const linkedInventoryMovements = (finalState.inventoryMovements ?? []).filter((entry) => (
        entry.rentalId === createdRental.id
        || entry.orderCode === createdRental.orderCode
        || entry.contractId === createdContract.id
      ));
      const linkedCashMovements = (finalState.cashMovements ?? []).filter((entry) => (
        entry.rentalId === createdRental.id
        || entry.orderCode === createdRental.orderCode
        || entry.contractId === createdContract.id
      ));
      const linkedSupplierLoans = (finalState.supplierLoans ?? []).filter((entry) => (
        entry.sourceRentalId === createdRental.id
        || entry.sourceContractId === createdContract.id
      ));
      const linkedReports = (finalState.generatedReports ?? []).filter((entry) => entry.sourceId === createdRental.id);

      mark('finalExportAndSelect');

      responseBundle = {
        contract: finalContract,
        rental: finalRental,
        changes: {
          contracts: finalContract ? [finalContract] : [],
          rentals: finalRental ? [finalRental] : [],
          deliveries: linkedDeliveries,
          inventoryMovements: linkedInventoryMovements,
          cashMovements: linkedCashMovements,
          supplierLoans: linkedSupplierLoans,
          generatedReports: linkedReports,
          clients: localClient
            ? (finalState.clients ?? []).filter((entry) => entry.id === localClient.id)
            : [],
          quotes: createdContract.quoteId
            ? (finalState.quotes ?? []).filter((entry) => entry.id === createdContract.quoteId)
            : [],
        },
      };
      mark('responseBundle');
      const committedState = await bridge.__storage.commitBatch();
      mark('commitBatch');
      return committedState;
      } catch (error) {
        await bridge.__storage.rollbackBatch();
        throw error;
      }
    }, expectedRevision);

    mark('stateValidationAndWrite');

    if (!result.initialized) {
      res.status(404).json({ error: 'La base de datos aun no esta inicializada.' });
      return;
    }

    mark('beforeResponse');
    const totalMs = logProfile('ok', {
      contractId: responseBundle?.contract?.id ?? null,
      rentalId: responseBundle?.rental?.id ?? null,
    });
    const serverTiming = Object.entries(timings)
      .map(([name, duration]) => `${name};dur=${duration}`)
      .concat(`total;dur=${totalMs}`)
      .join(', ');
    res.set('Server-Timing', serverTiming);
    res.json({
      ok: true,
      ...responseBundle,
      revision: result.revision,
      version: result.version,
      updatedAt: result.updatedAt,
      durationMs: totalMs,
      timings,
    });
  } catch (error) {
    logProfile('error', { code: error?.code, message: error?.message });
    if (error?.code === 'STATE_REVISION_CONFLICT') {
      res.status(409).json({
        error: 'Los datos fueron actualizados por otro usuario. Recarga antes de aprobar.',
        currentRevision: error.currentRevision,
        providedRevision: error.providedRevision,
      });
      return;
    }
    next(error);
  }
});

export default router;
