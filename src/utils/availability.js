const pad2 = (value) => String(value).padStart(2, '0');

export const toDateKey = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
};

const normalizeTime = (value, fallback) => {
  const text = String(value ?? '').trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(text) ? text : fallback;
};

const dateTimeValue = (dateValue, timeValue, fallbackTime) => {
  const dateKey = toDateKey(dateValue);
  if (!dateKey) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = normalizeTime(timeValue, fallbackTime).split(':').map(Number);
  const parsed = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

export const buildAvailabilityPeriod = ({
  deliveryDate,
  deliveryWindowStart,
  pickupDate,
  pickupWindowEnd,
  eventDate,
  eventTime,
} = {}) => {
  const startDate = toDateKey(deliveryDate || eventDate);
  const endDate = toDateKey(pickupDate || deliveryDate || eventDate);
  const start = dateTimeValue(startDate, deliveryWindowStart || eventTime, '00:00');
  let end = dateTimeValue(endDate, pickupWindowEnd || eventTime, '23:59');
  if (start !== null && end !== null && end <= start) {
    end = dateTimeValue(endDate, '23:59', '23:59');
  }
  return {
    startDate,
    endDate,
    startTime: normalizeTime(deliveryWindowStart || eventTime, '00:00'),
    endTime: normalizeTime(pickupWindowEnd || eventTime, '23:59'),
    start,
    end,
  };
};

const hasValidPeriod = (period) =>
  Number.isFinite(period?.start) && Number.isFinite(period?.end) && period.end > period.start;

const overlaps = (left, right) =>
  hasValidPeriod(left) && hasValidPeriod(right) && left.start < right.end && left.end > right.start;

const finishesBefore = (left, right) =>
  hasValidPeriod(left) && hasValidPeriod(right) && left.end <= right.start;

const finishesByStartDate = (left, right) =>
  hasValidPeriod(left)
  && hasValidPeriod(right)
  && left.endDate
  && right.startDate
  && left.endDate <= right.startDate;

const getContractMaps = (contracts = []) => {
  const byRentalId = new Map();
  const byOrderCode = new Map();
  contracts.forEach((contract) => {
    if (contract?.rentalId) byRentalId.set(contract.rentalId, contract);
    if (contract?.orderCode) byOrderCode.set(contract.orderCode, contract);
  });
  return { byRentalId, byOrderCode };
};

const periodFromRental = (rental, contract) =>
  buildAvailabilityPeriod({
    deliveryDate: contract?.deliveryDate || rental?.rentalDate || rental?.createdAt,
    deliveryWindowStart: contract?.deliveryWindowStart || rental?.deliveryWindowStart || '00:00',
    pickupDate: contract?.pickupDate || rental?.dueDate || contract?.eventDate || rental?.rentalDate,
    pickupWindowEnd: contract?.pickupWindowEnd || rental?.pickupWindowEnd || rental?.dueTime || '23:59',
  });

const periodFromCommercialRecord = (record) =>
  buildAvailabilityPeriod({
    deliveryDate: record?.deliveryDate || record?.eventDate,
    deliveryWindowStart: record?.deliveryWindowStart || record?.eventTime || '00:00',
    pickupDate: record?.pickupDate || record?.validUntil || record?.eventDate,
    pickupWindowEnd: record?.pickupWindowEnd || record?.eventTime || '23:59',
  });

const normalizeLineQuantity = (line) => {
  const quantity = Math.max(0, Math.trunc(Number(line?.quantity ?? 0)));
  const explicitInternal = Number(line?.internalReservedQty);
  if (Number.isFinite(explicitInternal)) {
    return Math.max(0, Math.trunc(explicitInternal));
  }
  const supplierBackedQty = Math.max(0, Math.trunc(Number(line?.supplierBackedQty ?? 0)));
  return Math.max(0, quantity - supplierBackedQty);
};

const controlsStock = (item) =>
  item?.controlsStock !== false
  && String(item?.verificationStatus ?? '').trim() !== 'pending_verification'
  && String(item?.adoptionSource ?? '').trim() !== 'service_order_quick_item'
  && !(Number(item?.totalStock ?? 0) <= 0 && Number(item?.availableStock ?? 0) <= 0);

const recordItemLines = (record) =>
  (Array.isArray(record?.items) ? record.items : [])
    .map((line) => {
      const stockControlledLine = line?.controlsStock !== false
        && String(line?.verificationStatus ?? '').trim() !== 'pending_verification';
      if (!stockControlledLine) return null;
      return {
        itemId: String(line?.itemId ?? '').trim(),
        quantity: normalizeLineQuantity(line),
        itemName: String(line?.itemName ?? line?.name ?? '').trim(),
      };
    })
    .filter(Boolean)
    .filter((line) => line.itemId && line.quantity > 0);

const isActiveRental = (rental) => rental && !rental.deletedAt && rental.status !== 'returned' && rental.status !== 'cancelled';

const sameId = (left, right) => String(left ?? '').trim() && String(left ?? '').trim() === String(right ?? '').trim();

const isExcluded = (record, exclude = {}) =>
  Boolean(
    sameId(exclude.rentalId, record?.id)
      || sameId(exclude.rentalId, record?.rentalId)
      || sameId(exclude.orderCode, record?.orderCode)
      || sameId(exclude.contractId, record?.id)
      || sameId(exclude.contractId, record?.contractId)
      || sameId(exclude.contractCode, record?.contractCode)
      || sameId(exclude.contractCode, record?.code)
      || sameId(exclude.quoteId, record?.id)
      || sameId(exclude.quoteId, record?.quoteId)
      || sameId(exclude.recordId, record?.id),
  );

const pushLineImpact = (summary, record, line, bucket) => {
  summary[bucket] += line.quantity;
  summary[`${bucket}Records`].push({
    id: record.id,
    code: record.code,
    orderCode: record.orderCode,
    contractCode: record.contractCode,
    rentalId: record.rentalId,
    contractId: record.contractId,
    customerName: record.customerName,
    quantity: line.quantity,
    startDate: record.period.startDate,
    startTime: record.period.startTime,
    endDate: record.period.endDate,
    endTime: record.period.endTime,
    type: record.type,
  });
};

export function getProjectedInventoryAvailability({
  items = [],
  rentals = [],
  contracts = [],
  quotes = [],
  period,
  exclude = {},
} = {}) {
  const targetPeriod = hasValidPeriod(period) ? period : null;
  const { byRentalId, byOrderCode } = getContractMaps(contracts);
  const summaries = new Map();

  items.forEach((item) => {
    const stockControlled = controlsStock(item);
    const totalStock = stockControlled ? Math.max(0, Math.trunc(Number(item.totalStock ?? 0))) : 0;
    const currentAvailable = stockControlled ? Math.max(0, Math.trunc(Number(item.availableStock ?? 0))) : 0;
    summaries.set(item.id, {
      itemId: item.id,
      itemName: item.name,
      stockControlled,
      totalStock,
      currentAvailable,
      unavailableOutsideRentals: 0,
      activeRentalQty: 0,
      activeRentalQtyRecords: [],
      hardReservedQty: 0,
      hardReservedQtyRecords: [],
      returningBeforeStartQty: 0,
      returningBeforeStartQtyRecords: [],
      softReservedQty: 0,
      softReservedQtyRecords: [],
      projectedAvailable: currentAvailable,
      projectedAfterSoftAvailable: currentAvailable,
    });
  });

  const hardRecords = [];
  const releaseExcludedLines = (lines) => {
    lines.forEach((line) => {
      const summary = summaries.get(line.itemId);
      if (summary) summary.activeRentalQty += line.quantity;
    });
  };

  rentals.filter(isActiveRental).forEach((rental) => {
    const contract = byRentalId.get(rental.id) ?? byOrderCode.get(rental.orderCode);
    const lines = recordItemLines(rental);
    if (isExcluded(rental, exclude)) {
      releaseExcludedLines(lines);
      return;
    }
    hardRecords.push({
      id: rental.id,
      code: contract?.contractCode || rental.contractCode || rental.orderCode,
      orderCode: rental.orderCode,
      contractCode: contract?.contractCode || rental.contractCode || '',
      rentalId: rental.id,
      contractId: contract?.id || rental.contractId || '',
      customerName: rental.customerName,
      type: 'orden',
      period: periodFromRental(rental, contract),
      lines,
      affectsCurrentStock: true,
    });
  });

  contracts.forEach((contract) => {
    if (!contract || contract.deletedAt) return;
    const status = String(contract.status ?? '').toLowerCase();
    if (isExcluded(contract, exclude)) {
      const hasExcludedActiveRental = rentals.filter(isActiveRental).some((rental) => {
        const linkedContract = byRentalId.get(rental.id) ?? byOrderCode.get(rental.orderCode);
        return isExcluded(rental, exclude)
          && (
            sameId(rental.id, contract.rentalId)
            || sameId(rental.orderCode, contract.orderCode)
            || sameId(rental.contractId, contract.id)
            || sameId(linkedContract?.id, contract.id)
            || sameId(linkedContract?.contractCode, contract.contractCode)
          );
      });
      if (status === 'aprobado' && !hasExcludedActiveRental) {
        releaseExcludedLines(recordItemLines(contract));
      }
      return;
    }
    if (contract.rentalId || contract.orderCode) return;
    const record = {
      id: contract.id,
      code: contract.contractCode,
      orderCode: contract.orderCode || '',
      contractCode: contract.contractCode,
      rentalId: contract.rentalId || '',
      contractId: contract.id,
      customerName: contract.customerName,
      type: 'contrato',
      period: periodFromCommercialRecord(contract),
      lines: recordItemLines(contract),
      affectsCurrentStock: false,
    };
    if (status === 'aprobado') {
      hardRecords.push(record);
    }
  });

  hardRecords.forEach((record) => {
    record.lines.forEach((line) => {
      const summary = summaries.get(line.itemId);
      if (!summary) return;
      if (record.affectsCurrentStock) {
        pushLineImpact(summary, record, line, 'activeRentalQty');
      }
      if (!targetPeriod) return;
      if (finishesBefore(record.period, targetPeriod) || finishesByStartDate(record.period, targetPeriod)) {
        pushLineImpact(summary, record, line, 'returningBeforeStartQty');
      } else if (overlaps(record.period, targetPeriod)) {
        pushLineImpact(summary, record, line, 'hardReservedQty');
      }
    });
  });

  summaries.forEach((summary) => {
    if (!summary.stockControlled) return;
    summary.unavailableOutsideRentals = Math.max(
      0,
      summary.totalStock - summary.currentAvailable - summary.activeRentalQty,
    );
    summary.projectedAvailable = Math.max(
      0,
      summary.totalStock - summary.unavailableOutsideRentals - summary.hardReservedQty,
    );
  });

  const softRecords = [];
  quotes.forEach((quote) => {
    if (!quote || quote.deletedAt || quote.rentalId || quote.orderCode || isExcluded(quote, exclude)) return;
    const status = String(quote.status ?? '').toLowerCase();
    if (!['enviada', 'borrador'].includes(status)) return;
    softRecords.push({
      id: quote.id,
      code: quote.quoteCode,
      orderCode: quote.orderCode || '',
      contractCode: '',
      rentalId: quote.rentalId || '',
      contractId: '',
      customerName: quote.customerName,
      type: 'cotizacion',
      period: periodFromCommercialRecord(quote),
      lines: recordItemLines(quote),
    });
  });

  contracts.forEach((contract) => {
    if (!contract || contract.deletedAt || contract.rentalId || contract.orderCode || isExcluded(contract, exclude)) return;
    const status = String(contract.status ?? '').toLowerCase();
    if (!['pendiente', 'borrador'].includes(status)) return;
    softRecords.push({
      id: contract.id,
      code: contract.contractCode,
      orderCode: contract.orderCode || '',
      contractCode: contract.contractCode,
      rentalId: contract.rentalId || '',
      contractId: contract.id,
      customerName: contract.customerName,
      type: 'contrato',
      period: periodFromCommercialRecord(contract),
      lines: recordItemLines(contract),
    });
  });

  if (targetPeriod) {
    softRecords.forEach((record) => {
      if (!overlaps(record.period, targetPeriod)) return;
      record.lines.forEach((line) => {
        const summary = summaries.get(line.itemId);
        if (!summary) return;
        pushLineImpact(summary, record, line, 'softReservedQty');
      });
    });
  }

  summaries.forEach((summary) => {
    if (!summary.stockControlled) return;
    summary.projectedAfterSoftAvailable = Math.max(0, summary.projectedAvailable - summary.softReservedQty);
  });

  return summaries;
}

export function validateProjectedInventoryRequest({
  items = [],
  rentals = [],
  contracts = [],
  quotes = [],
  period,
  requestedItems = [],
  exclude = {},
} = {}) {
  const availability = getProjectedInventoryAvailability({ items, rentals, contracts, quotes, period, exclude });
  return requestedItems
    .map((line) => {
      const itemId = String(line?.itemId ?? '').trim();
      const requestedQty = normalizeLineQuantity(line);
      const summary = availability.get(itemId);
      if (summary && !summary.stockControlled) return null;
      if (!summary || requestedQty <= summary.projectedAvailable) return null;
      return {
        itemId,
        itemName: summary?.itemName || line?.itemName || 'Item',
        requestedQty,
        projectedAvailable: summary?.projectedAvailable ?? 0,
        shortageQty: Math.max(0, requestedQty - (summary?.projectedAvailable ?? 0)),
        returningBeforeStartQty: summary?.returningBeforeStartQty ?? 0,
        hardConflicts: summary?.hardReservedQtyRecords ?? [],
      };
    })
    .filter(Boolean);
}

export function buildInventoryReturnRiskEvents({
  items = [],
  rentals = [],
  contracts = [],
  todayKey = toDateKey(new Date()),
} = {}) {
  const events = [];
  const availabilityByDateCache = new Map();
  const activeTargets = rentals.filter(isActiveRental);
  const rentalById = new Map(rentals.map((rental) => [rental.id, rental]));

  activeTargets.forEach((target) => {
    const { byRentalId, byOrderCode } = getContractMaps(contracts);
    const targetContract = byRentalId.get(target.id) ?? byOrderCode.get(target.orderCode);
    const targetPeriod = periodFromRental(target, targetContract);
    if (!hasValidPeriod(targetPeriod)) return;

    const storedAssumptions = Array.isArray(target.inventoryAvailabilityAssumptions)
      ? target.inventoryAvailabilityAssumptions
      : [];
    if (storedAssumptions.length > 0) {
      storedAssumptions.forEach((assumption) => {
        (assumption.sourceReturns ?? []).forEach((source) => {
          const sourceRental = rentalById.get(source.id);
          if (sourceRental?.status === 'returned') return;
          if (!source.endDate || source.endDate > targetPeriod.startDate) return;
          events.push({
            id: `inventory-risk-${source.id}-${target.id}-${assumption.itemId}`,
            type: 'inventory_alert',
            date: source.endDate,
            startTime: source.endTime || '08:00',
            endTime: source.endTime || '09:00',
            status: source.endDate < todayKey ? 'retrasado' : 'pendiente',
            title: `Asegurar ${assumption.itemName || 'inventario'}`,
            subtitle: `${source.code || 'Orden previa'} debe volver para ${target.orderCode || 'evento futuro'}`,
            detailLine: `${source.quantity} unidades comprometidas por disponibilidad proyectada`,
            relatedType: 'alerta inventario',
            relatedId: target.orderCode,
            rentalId: target.id,
            orderCode: target.orderCode,
            customerName: target.customerName,
            eventName: targetContract?.eventType || target.eventType || 'Evento futuro',
            operationLabel: 'Alerta de inventario',
            logisticsMode: targetContract?.logisticsMode || target.logisticsMode || 'envio',
            referenceLine: `Recojo ${source.code || ''} antes de ${targetPeriod.startDate}`.trim(),
          });
        });
      });
      return;
    }

    const cacheKey = `${target.id}|${targetPeriod.startDate}|${targetPeriod.endDate}`;
    const availability = availabilityByDateCache.get(cacheKey)
      ?? getProjectedInventoryAvailability({
        items,
        rentals,
        contracts,
        period: targetPeriod,
        exclude: { rentalId: target.id, orderCode: target.orderCode },
      });
    availabilityByDateCache.set(cacheKey, availability);

    recordItemLines(target).forEach((line) => {
      const summary = availability.get(line.itemId);
      if (!summary) return;
      if (line.quantity <= summary.currentAvailable) return;

      const neededFromReturns = Math.min(line.quantity - summary.currentAvailable, summary.returningBeforeStartQty);
      if (neededFromReturns <= 0) return;

      summary.returningBeforeStartQtyRecords.forEach((source) => {
        if (!source.endDate || source.endDate > targetPeriod.startDate) return;
        events.push({
          id: `inventory-risk-${source.id}-${target.id}-${line.itemId}`,
          type: 'inventory_alert',
          date: source.endDate,
          startTime: source.endTime || '08:00',
          endTime: source.endTime || '09:00',
          status: source.endDate < todayKey ? 'retrasado' : 'pendiente',
          title: `Asegurar ${summary.itemName}`,
          subtitle: `${source.code || 'Orden previa'} debe volver para ${target.orderCode || 'evento futuro'}`,
          detailLine: `${Math.min(source.quantity, neededFromReturns)} de ${line.quantity} unidades dependen de esta devolucion`,
          relatedType: 'alerta inventario',
          relatedId: target.orderCode,
          rentalId: target.id,
          orderCode: target.orderCode,
          customerName: target.customerName,
          eventName: targetContract?.eventType || target.eventType || 'Evento futuro',
          operationLabel: 'Alerta de inventario',
          logisticsMode: targetContract?.logisticsMode || target.logisticsMode || 'envio',
          referenceLine: `Recojo ${source.code || ''} antes de ${targetPeriod.startDate}`.trim(),
        });
      });
    });
  });

  return events;
}
