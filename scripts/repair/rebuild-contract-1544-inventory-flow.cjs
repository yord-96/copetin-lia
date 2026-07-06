const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const projectRoot = path.resolve(__dirname, '..', '..');
const statePath = path.resolve(process.env.APP_STATE_FILE || path.join(projectRoot, 'data', 'app-state.json'));
const repairDir = path.join(path.dirname(statePath), 'repairs');

const checksumForState = (state) =>
  crypto.createHash('sha256').update(JSON.stringify(state ?? null)).digest('hex').slice(0, 16);

const makeId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

const toMoney = (value) => Number(Math.max(0, Number(value ?? 0)).toFixed(2));

const consumeDocumentCode = (state, prefixKey, nextKey, pad = 5) => {
  const numbering = state.settings.numbering;
  const prefix = String(numbering[prefixKey] ?? '');
  const current = Math.max(1, Number.parseInt(String(numbering[nextKey] ?? '1'), 10) || 1);
  numbering[nextKey] = current + 1;
  return `${prefix}${String(current).padStart(pad, '0')}`;
};

const loadPayload = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));

const savePayload = (payload, state) => {
  const nextVersion = Number(payload.version ?? 0) + 1;
  const nextPayload = {
    state,
    version: nextVersion,
    checksum: checksumForState(state),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(statePath, `${JSON.stringify(nextPayload, null, 2)}\n`, 'utf8');
  return nextPayload;
};

const buildDueAt = (dateKey, timeKey) => {
  const [year, month, day] = String(dateKey).split('-').map((value) => Number.parseInt(value, 10));
  const [hours, minutes] = String(timeKey || '23:59').split(':').map((value) => Number.parseInt(value, 10));
  const parsed = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const main = () => {
  const payload = loadPayload();
  const state = payload.state ?? payload;
  if (!state?.settings?.numbering) {
    throw new Error('No se encontro un estado valido con numeracion.');
  }

  const contract = state.contracts.find((entry) => entry.contractCode === '1544' && !entry.deletedAt);
  if (!contract) {
    throw new Error('No se encontro el contrato activo 1544.');
  }

  const existingRental = state.rentals.find(
    (entry) =>
      !entry.deletedAt
      && (
        String(entry.contractId ?? '') === String(contract.id)
        || String(entry.contractCode ?? '') === String(contract.contractCode)
      ),
  );

  if (existingRental) {
    const existingMovementCount = state.inventoryMovements.filter(
      (movement) =>
        String(movement.contractId ?? '') === String(contract.id)
        || String(movement.contractCode ?? '') === String(contract.contractCode)
        || String(movement.rentalId ?? '') === String(existingRental.id)
        || String(movement.reference ?? '') === String(existingRental.orderCode),
    ).length;

    if (existingMovementCount === 0) {
      const nowIso = new Date().toISOString();
      const userName = existingRental.createdByName || contract.createdByName || contract.createdBy || 'Sistema';
      const userRole = existingRental.createdByRole || contract.createdByRole || 'Operacion';
      existingRental.items = existingRental.items.map((line) => {
        const item = state.items.find((entry) => entry.id === line.itemId && !entry.deletedAt);
        if (!item) return line;
        const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
        const beforeAvailableStock = Number(item.availableStock ?? 0);
        const beforeTotalStock = Number(item.totalStock ?? 0);
        item.availableStock = Math.max(0, beforeAvailableStock - quantity);
        item.updatedAt = nowIso;
        state.inventoryMovements.push({
          id: makeId('mov'),
          itemId: item.id,
          itemName: item.name,
          category: item.category,
          type: 'reserva',
          reason: `Reservado para contrato ${contract.contractCode} (${existingRental.orderCode})`,
          detail: `Reserva interna de ${quantity} unidades para contrato ${contract.contractCode}`,
          reference: existingRental.orderCode,
          contractCode: contract.contractCode,
          contractId: contract.id,
          rentalId: existingRental.id,
          orderCode: existingRental.orderCode,
          deltaUnits: -quantity,
          beforeTotalStock,
          afterTotalStock: Number(item.totalStock ?? 0),
          beforeAvailableStock,
          afterAvailableStock: Number(item.availableStock ?? 0),
          reservedStockAfter: Math.max(0, Number(item.totalStock ?? 0) - Number(item.availableStock ?? 0)),
          userName,
          userRole,
          createdAt: nowIso,
        });
        return {
          ...line,
          controlsStock: true,
          internalReservedQty: quantity,
          verificationStatus: line.verificationStatus === 'pending_verification' ? 'verified' : line.verificationStatus,
        };
      });
      existingRental.updatedAt = nowIso;
    }

    contract.status = 'aprobado';
    contract.approvedAt = contract.approvedAt ?? existingRental.createdAt ?? new Date().toISOString();
    contract.rejectedAt = null;
    contract.rentalId = existingRental.id;
    contract.orderCode = existingRental.orderCode;
    contract.updatedAt = new Date().toISOString();
    const nextPayload = savePayload(payload, state);
    console.log(`Contrato 1544 ya tenia orden ${existingRental.orderCode}. Vinculo reparado.`);
    console.log(`Movimientos existentes/creados: ${existingMovementCount || existingRental.items.length}`);
    console.log(`Revision ${nextPayload.version}:${nextPayload.checksum}`);
    return;
  }

  fs.mkdirSync(repairDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const backupPath = path.join(repairDir, `app-state-before-contract-1544-inventory-rebuild-${stamp}.json`);
  fs.copyFileSync(statePath, backupPath);

  const nowIso = new Date().toISOString();
  const orderCode = consumeDocumentCode(state, 'serviceOrderPrefix', 'serviceOrderNext', 5);
  const rentalId = makeId('rent');
  const userName = contract.createdByName || contract.createdBy || 'Sistema';
  const userRole = contract.createdByRole || 'Operacion';
  const fallbackDamageMultiplier = Number(state.settings.damageMultiplier ?? 1.2);
  const fallbackMissingMultiplier = Number(state.settings.missingMultiplier ?? 2);

  const rentalItems = contract.items.map((line) => {
    const item = state.items.find((entry) => entry.id === line.itemId && !entry.deletedAt);
    if (!item) {
      throw new Error(`No existe el item ${line.itemId} del contrato 1544.`);
    }

    const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
    const controlsStock = line.controlsStock !== false && item.controlsStock !== false;
    const internalReservedQty = controlsStock ? quantity : 0;
    const beforeAvailableStock = Number(item.availableStock ?? 0);
    const beforeTotalStock = Number(item.totalStock ?? 0);

    if (internalReservedQty > 0) {
      item.availableStock = Math.max(0, beforeAvailableStock - internalReservedQty);
      item.updatedAt = nowIso;
      state.inventoryMovements.push({
        id: makeId('mov'),
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        type: 'reserva',
        reason: `Reservado para contrato ${contract.contractCode} (${orderCode})`,
        detail: `Reserva interna de ${internalReservedQty} unidades para contrato ${contract.contractCode}`,
        reference: orderCode,
        contractCode: contract.contractCode,
        contractId: contract.id,
        rentalId,
        orderCode,
        deltaUnits: -internalReservedQty,
        beforeTotalStock,
        afterTotalStock: Number(item.totalStock ?? 0),
        beforeAvailableStock,
        afterAvailableStock: Number(item.availableStock ?? 0),
        reservedStockAfter: Math.max(0, Number(item.totalStock ?? 0) - Number(item.availableStock ?? 0)),
        userName,
        userRole,
        createdAt: nowIso,
      });
    }

    const rentalPriceBs = toMoney(line.rentalPriceBs ?? line.unitPriceBs ?? item.rentalPriceBs ?? 0);
    return {
      itemId: item.id,
      itemName: item.name,
      rentalPriceBs,
      damagedUnitChargeBs: Number.isFinite(Number(item.damagedUnitChargeBs))
        ? Number(item.damagedUnitChargeBs)
        : toMoney(rentalPriceBs * fallbackDamageMultiplier),
      missingUnitChargeBs: Number.isFinite(Number(item.missingUnitChargeBs))
        ? Number(item.missingUnitChargeBs)
        : toMoney(rentalPriceBs * fallbackMissingMultiplier),
      quantity,
      supplierBackedQty: 0,
      internalReservedQty,
      controlsStock,
      verificationStatus: controlsStock ? (item.verificationStatus ?? 'verified') : 'pending_verification',
      comboId: line.comboId ?? null,
      comboName: line.comboName ?? '',
      comboLineKey: line.comboLineKey ?? null,
      comboComponentName: line.comboComponentName || item.name,
      comboQuantity: Math.max(1, Math.trunc(Number(line.comboQuantity ?? 1))),
      comboComponentQuantity: Math.max(1, Math.trunc(Number(line.comboComponentQuantity ?? 1))),
      comboRuleIndex: Math.max(0, Math.trunc(Number(line.comboRuleIndex ?? 0))),
      comboSlotLabel: line.comboSlotLabel ?? '',
      comboSelectionMode: line.comboSelectionMode ?? 'item',
      comboOptionItemIds: Array.isArray(line.comboOptionItemIds) ? line.comboOptionItemIds.map(String) : [],
      comboCategory: line.comboCategory ?? '',
      comboPricingRole: line.comboPricingRole ?? '',
      comboPricingCondition: line.comboPricingCondition ?? null,
      grossLineTotalBs: toMoney(line.grossLineTotalBs ?? quantity * rentalPriceBs),
      discountPercent: toMoney(line.discountPercent ?? 0),
      discountBs: toMoney(line.discountBs ?? 0),
      lineTotalBs: toMoney(line.lineTotalBs ?? line.grossLineTotalBs ?? quantity * rentalPriceBs),
    };
  });

  const itemsSubtotalBs = toMoney(rentalItems.reduce((sum, line) => sum + line.lineTotalBs, 0));
  const servicesSubtotalBs = toMoney((contract.services ?? []).reduce((sum, line) => sum + Number(line.lineTotalBs ?? 0), 0));
  const totalBs = toMoney(contract.totals?.totalBs ?? itemsSubtotalBs + servicesSubtotalBs);
  const paidAtRentalBs = toMoney(contract.payment?.paidAtApprovalBs ?? 0);
  const pendingPaymentBs = toMoney(totalBs - paidAtRentalBs);
  const paymentStatus = paidAtRentalBs >= totalBs && totalBs > 0 ? 'cancelado' : paidAtRentalBs > 0 ? 'a_cuenta' : 'sin_pago';

  const rental = {
    id: rentalId,
    clientId: contract.clientId ?? null,
    contractId: contract.id,
    contractCode: contract.contractCode,
    orderCode,
    customerName: contract.customerName,
    customerPhone: contract.customerPhone,
    contractDate: contract.contractDate || contract.createdAt || nowIso,
    rentalDate: contract.deliveryDate || contract.eventDate,
    rentalAt: nowIso,
    dueDate: contract.pickupDate || contract.deliveryDate || contract.eventDate,
    dueTime: contract.pickupWindowEnd || contract.eventTime || '23:59',
    dueAt: buildDueAt(contract.pickupDate || contract.deliveryDate || contract.eventDate, contract.pickupWindowEnd || contract.eventTime || '23:59'),
    deliveryWindowStart: contract.deliveryWindowStart || null,
    deliveryWindowEnd: contract.deliveryWindowEnd || null,
    pickupWindowStart: contract.pickupWindowStart || null,
    pickupWindowEnd: contract.pickupWindowEnd || contract.eventTime || '23:59',
    idCardHeld: false,
    depositBs: 0,
    guaranteeDeclaredBs: toMoney(contract.totals?.guaranteeBs ?? contract.guarantee?.amountBs ?? 0),
    guarantee: {
      amountBs: toMoney(contract.totals?.guaranteeBs ?? contract.guarantee?.amountBs ?? 0),
      validatedBs: contract.guarantee?.status === 'validado' ? toMoney(contract.totals?.guaranteeBs ?? contract.guarantee?.amountBs ?? 0) : 0,
      status: contract.guarantee?.status ?? contract.payment?.guaranteeStatus ?? 'no_validado',
      paymentMethod: contract.guarantee?.paymentMethod ?? contract.payment?.guaranteePaymentMethod ?? 'efectivo',
      paymentAccount: contract.guarantee?.paymentAccount ?? contract.payment?.guaranteePaymentAccount ?? '',
    },
    deliveryChargeMode: contract.deliveryChargeMode ?? 'included',
    deliveryFeeBs: toMoney(contract.totals?.deliveryFeeBs ?? contract.deliveryFeeBs ?? 0),
    deliveryFeeReason: contract.deliveryFeeReason ?? 'covered',
    prepaidClientId: null,
    prepaidAppliedBs: toMoney(contract.payment?.prepaidAppliedBs ?? 0),
    items: rentalItems,
    services: contract.services ?? [],
    pricingPlan: contract.pricingPlan ?? null,
    totals: {
      itemsSubtotalBs,
      servicesSubtotalBs,
      baseSubtotalBs: toMoney(contract.totals?.baseSubtotalBs ?? itemsSubtotalBs + servicesSubtotalBs),
      subtotalBs: toMoney(contract.totals?.subtotalBs ?? itemsSubtotalBs + servicesSubtotalBs),
      theoreticalSubtotalBs: toMoney(contract.totals?.theoreticalSubtotalBs ?? contract.totals?.subtotalBs ?? itemsSubtotalBs),
      durationDiscountBs: toMoney(contract.totals?.durationDiscountBs ?? 0),
      discountBs: toMoney(contract.totals?.discountBs ?? 0),
      discountPercent: toMoney(contract.totals?.discountPercent ?? 0),
      deliveryFeeBs: toMoney(contract.totals?.deliveryFeeBs ?? contract.deliveryFeeBs ?? 0),
      deliveryFeeCollectedBs: 0,
      prepaidAppliedBs: toMoney(contract.payment?.prepaidAppliedBs ?? 0),
      totalBs,
      paidAtRentalBs,
      pendingPaymentBs,
      overpaidBs: toMoney(Math.max(0, paidAtRentalBs - totalBs)),
    },
    payment: {
      mode: paymentStatus,
      status: paymentStatus,
      paidAtRentalBs,
      pendingPaymentBs,
      overpaidBs: toMoney(Math.max(0, paidAtRentalBs - totalBs)),
      prepaidAppliedBs: toMoney(contract.payment?.prepaidAppliedBs ?? 0),
      deliveryFeeCollectedBs: 0,
      rentalCollectedBs: paidAtRentalBs,
      cashCollectedBs: paidAtRentalBs,
      initialPaymentMethod: contract.payment?.initialPaymentMethod ?? 'efectivo',
      initialPaymentAccount: contract.payment?.initialPaymentAccount ?? '',
      guaranteeStatus: contract.payment?.guaranteeStatus ?? contract.guarantee?.status ?? 'no_validado',
      guaranteePaymentMethod: contract.payment?.guaranteePaymentMethod ?? contract.guarantee?.paymentMethod ?? 'efectivo',
      guaranteePaymentAccount: contract.payment?.guaranteePaymentAccount ?? contract.guarantee?.paymentAccount ?? '',
    },
    notes: contract.observations ?? '',
    billingMode: contract.billingMode ?? 'sin_factura',
    logisticsMode: contract.logisticsMode ?? 'envio',
    supplierFulfillmentPlan: contract.supplierFulfillmentPlan ?? [],
    inventoryAvailabilityAssumptions: [],
    status: 'active',
    createdById: contract.createdById ?? null,
    createdByName: userName,
    createdByRole: userRole,
    operational: {
      inventoryStatus: 'pendiente',
      transportStatus: (contract.logisticsMode ?? 'envio') === 'recojo' ? 'no_aplica' : 'pendiente',
      inventoryNote: '',
      transportNote: '',
      inventorySentAt: null,
      inventoryDispatchedAt: null,
      inventoryDispatchedByName: null,
      inventoryDispatchedByRole: null,
      transportSentAt: null,
      inventoryConfirmedAt: null,
      transportConfirmedAt: null,
      inventoryConfirmedByName: null,
      inventoryConfirmedByRole: null,
      transportConfirmedByName: null,
      transportConfirmedByRole: null,
    },
    createdAt: nowIso,
    deletedAt: null,
  };

  state.rentals.push(rental);
  contract.status = 'aprobado';
  contract.approvedAt = nowIso;
  contract.rejectedAt = null;
  contract.rentalId = rentalId;
  contract.orderCode = orderCode;
  contract.updatedAt = nowIso;

  const nextPayload = savePayload(payload, state);
  console.log(`Reparado contrato 1544 -> ${orderCode}`);
  console.log(`Backup: ${backupPath}`);
  console.log(`Movimientos creados: ${rentalItems.filter((line) => line.internalReservedQty > 0).length}`);
  console.log(`Revision: ${nextPayload.version}:${nextPayload.checksum}`);
};

main();
