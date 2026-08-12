import { getLincolnStateSnapshot } from '../../storage/lincolnStateStore.js';

const normalize = (value) => String(value ?? '').trim().toLowerCase();
const amount = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundMoney = (value) => Number(amount(value).toFixed(2));

const normalizedServiceLines = (pkg) => (
  Array.isArray(pkg?.serviceLines)
    ? pkg.serviceLines
    : String(pkg?.servicesText ?? '')
      .split(/\r?\n/)
      .map((description) => description.trim())
      .filter(Boolean)
      .map((description, index) => ({
        id: `legacy-${index + 1}`,
        category: 'OTROS',
        sourceType: 'internal',
        description,
        quantity: 1,
        unit: 'SERVICIO',
        costMode: 'fixed_event',
        unitCostBs: 0,
        supplierId: null,
        supplierName: '',
        included: true,
      }))
);

export const getLincolnPackagesOverview = async ({ query = '', status = 'all', roomId = '' } = {}) => {
  const snapshot = await getLincolnStateSnapshot();
  const state = snapshot.state ?? {};
  const packages = Array.isArray(state.packages) ? state.packages : [];
  const rooms = Array.isArray(state.rooms) ? state.rooms : [];
  const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];

  const roomById = new Map(rooms.map((room) => [String(room?.id ?? ''), room]));
  const supplierById = new Map(suppliers.map((supplier) => [String(supplier?.id ?? ''), supplier]));
  const normalizedQuery = normalize(query);
  const normalizedStatus = normalize(status || 'all');
  const normalizedRoomId = String(roomId ?? '').trim();

  const rows = packages
    .map((pkg) => {
      const lines = normalizedServiceLines(pkg);
      const room = roomById.get(String(pkg?.roomId ?? '')) ?? null;

      const variableCostPerPersonBs = lines.reduce((total, line) => {
        if (String(line?.costMode ?? '') !== 'per_person') return total;
        return total + amount(line?.quantity || 1) * amount(line?.unitCostBs);
      }, 0);

      const fixedEventCostBs = lines.reduce((total, line) => {
        if (String(line?.costMode ?? 'fixed_event') !== 'fixed_event') return total;
        return total + amount(line?.quantity || 1) * amount(line?.unitCostBs);
      }, 0);

      const internalServices = lines.filter((line) => String(line?.sourceType ?? 'internal') === 'internal').length;
      const externalServices = lines.filter((line) => String(line?.sourceType ?? '') === 'external').length;
      const providerIds = new Set(lines
        .filter((line) => String(line?.sourceType ?? '') === 'external')
        .map((line) => String(line?.supplierId ?? '').trim())
        .filter(Boolean));

      const minimumGuests = Math.max(0, Math.trunc(amount(pkg?.minimumGuests)));
      const pricePerPersonBs = roundMoney(pkg?.pricePerPersonBs);
      const minRevenueBs = roundMoney(pricePerPersonBs * minimumGuests);
      const minEstimatedCostBs = roundMoney(variableCostPerPersonBs * minimumGuests + fixedEventCostBs);
      const minEstimatedMarginBs = roundMoney(minRevenueBs - minEstimatedCostBs);
      const marginPerPersonBeforeFixedBs = roundMoney(pricePerPersonBs - variableCostPerPersonBs);

      return {
        id: pkg.id,
        code: pkg.code ?? '',
        name: pkg.name ?? '',
        segment: pkg.segment ?? '',
        roomId: pkg.roomId ?? null,
        roomName: pkg.roomName ?? room?.name ?? '',
        minimumGuests,
        pricePerPersonBs,
        status: pkg.status === 'inactive' ? 'inactive' : 'active',
        description: pkg.description ?? '',
        images: Array.isArray(pkg.images) ? pkg.images : [],
        serviceLines: lines.map((line) => ({
          ...line,
          supplierName: line?.supplierName
            || supplierById.get(String(line?.supplierId ?? ''))?.name
            || '',
        })),
        serviceCount: lines.length,
        internalServices,
        externalServices,
        providerCount: providerIds.size,
        variableCostPerPersonBs: roundMoney(variableCostPerPersonBs),
        fixedEventCostBs: roundMoney(fixedEventCostBs),
        marginPerPersonBeforeFixedBs,
        minRevenueBs,
        minEstimatedCostBs,
        minEstimatedMarginBs,
      };
    })
    .filter((row) => {
      if (normalizedStatus === 'active' && row.status !== 'active') return false;
      if (normalizedStatus === 'inactive' && row.status !== 'inactive') return false;
      if (normalizedRoomId && String(row.roomId ?? '') !== normalizedRoomId) return false;
      if (!normalizedQuery) return true;
      return [
        row.code,
        row.name,
        row.segment,
        row.roomName,
        row.description,
        ...row.serviceLines.map((line) => `${line.category} ${line.description} ${line.supplierName}`),
      ].some((value) => normalize(value).includes(normalizedQuery));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

  const totalServices = rows.reduce((total, row) => total + row.serviceCount, 0);
  const totalExternalServices = rows.reduce((total, row) => total + row.externalServices, 0);
  const activePackages = packages.filter((pkg) => pkg?.status !== 'inactive').length;

  return {
    revision: snapshot.revision,
    summary: {
      totalPackages: packages.length,
      activePackages,
      totalServices,
      externalServices: totalExternalServices,
    },
    rooms: rooms
      .filter((room) => room?.status !== 'inactive')
      .map((room) => ({ id: room.id, name: room.name ?? '' })),
    suppliers: suppliers
      .filter((supplier) => supplier?.status !== 'inactive')
      .map((supplier) => ({ id: supplier.id, name: supplier.name ?? '' })),
    rows,
  };
};
