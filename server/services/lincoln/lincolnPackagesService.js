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
        variantIds: [],
      }))
);

const normalizeVariants = (pkg) => {
  if (Array.isArray(pkg?.variants) && pkg.variants.length) {
    return pkg.variants.map((variant, index) => ({
      id: variant?.id || `variant-${index + 1}`,
      name: String(variant?.name ?? '').trim() || `VARIANTE ${index + 1}`,
      pricePerPersonBs: roundMoney(variant?.pricePerPersonBs),
      minimumGuests: Math.max(0, Math.trunc(amount(variant?.minimumGuests ?? pkg?.minimumGuests))),
      status: variant?.status === 'inactive' ? 'inactive' : 'active',
    }));
  }
  if (pkg?.name) {
    return [{
      id: 'base',
      name: String(pkg.name),
      pricePerPersonBs: roundMoney(pkg?.pricePerPersonBs),
      minimumGuests: Math.max(0, Math.trunc(amount(pkg?.minimumGuests))),
      status: pkg?.status === 'inactive' ? 'inactive' : 'active',
    }];
  }
  return [];
};

const normalizeCatalogItem = (row, kind) => ({
  id: row?.id,
  code: row?.code ?? '',
  name: row?.name ?? row?.description ?? '',
  category: row?.category ?? 'OTROS',
  description: row?.description ?? row?.name ?? '',
  sourceType: row?.sourceType === 'external' ? 'external' : 'internal',
  costMode: row?.costMode === 'per_person' ? 'per_person' : 'fixed_event',
  unit: row?.unit ?? 'SERVICIO',
  unitCostBs: roundMoney(row?.unitCostBs),
  supplierId: row?.supplierId ?? '',
  supplierName: row?.supplierName ?? '',
  status: row?.status === 'inactive' ? 'inactive' : 'active',
  kind,
  notes: row?.notes ?? '',
});

export const getLincolnPackagesOverview = async ({ query = '', status = 'all', roomId = '' } = {}) => {
  const snapshot = await getLincolnStateSnapshot();
  const state = snapshot.state ?? {};
  const packages = Array.isArray(state.packages) ? state.packages : [];
  const packageServices = Array.isArray(state.packageServices) ? state.packageServices : [];
  const packageExtras = Array.isArray(state.packageExtras) ? state.packageExtras : [];
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
      const variants = normalizeVariants(pkg);
      const room = roomById.get(String(pkg?.roomId ?? '')) ?? null;
      const variableCostPerPersonBs = lines.reduce((total, line) => (
        String(line?.costMode ?? '') === 'per_person'
          ? total + amount(line?.quantity || 1) * amount(line?.unitCostBs)
          : total
      ), 0);
      const fixedEventCostBs = lines.reduce((total, line) => (
        String(line?.costMode ?? 'fixed_event') === 'fixed_event'
          ? total + amount(line?.quantity || 1) * amount(line?.unitCostBs)
          : total
      ), 0);
      const internalServices = lines.filter((line) => String(line?.sourceType ?? 'internal') === 'internal').length;
      const externalServices = lines.filter((line) => String(line?.sourceType ?? '') === 'external').length;
      const providerIds = new Set(lines
        .filter((line) => String(line?.sourceType ?? '') === 'external')
        .map((line) => String(line?.supplierId ?? '').trim())
        .filter(Boolean));
      const minimumGuests = Math.max(0, Math.trunc(amount(pkg?.minimumGuests)));
      const pricePerPersonBs = roundMoney(pkg?.pricePerPersonBs || variants[0]?.pricePerPersonBs);
      const minRevenueBs = roundMoney(pricePerPersonBs * minimumGuests);
      const minEstimatedCostBs = roundMoney(variableCostPerPersonBs * minimumGuests + fixedEventCostBs);
      return {
        id: pkg.id,
        code: pkg.code ?? '',
        name: pkg.name ?? '',
        familyName: pkg.familyName ?? pkg.name ?? '',
        segment: pkg.segment ?? '',
        eventTypes: Array.isArray(pkg.eventTypes) ? pkg.eventTypes : [],
        roomId: pkg.roomId ?? null,
        roomName: pkg.roomName ?? room?.name ?? '',
        minimumGuests,
        pricePerPersonBs,
        status: pkg.status === 'inactive' ? 'inactive' : 'active',
        description: pkg.description ?? '',
        images: Array.isArray(pkg.images) ? pkg.images : [],
        variants,
        serviceLines: lines.map((line) => ({
          ...line,
          variantIds: Array.isArray(line?.variantIds) ? line.variantIds : [],
          supplierName: line?.supplierName || supplierById.get(String(line?.supplierId ?? ''))?.name || '',
        })),
        serviceCount: lines.length,
        internalServices,
        externalServices,
        providerCount: providerIds.size,
        variableCostPerPersonBs: roundMoney(variableCostPerPersonBs),
        fixedEventCostBs: roundMoney(fixedEventCostBs),
        minRevenueBs,
        minEstimatedCostBs,
        minEstimatedMarginBs: roundMoney(minRevenueBs - minEstimatedCostBs),
      };
    })
    .filter((row) => {
      if (normalizedStatus === 'active' && row.status !== 'active') return false;
      if (normalizedStatus === 'inactive' && row.status !== 'inactive') return false;
      if (normalizedRoomId && String(row.roomId ?? '') !== normalizedRoomId) return false;
      if (!normalizedQuery) return true;
      return [
        row.code, row.name, row.familyName, row.segment, row.roomName, row.description,
        ...row.eventTypes, ...row.variants.map((v) => v.name),
        ...row.serviceLines.map((line) => `${line.category} ${line.description} ${line.supplierName}`),
      ].some((value) => normalize(value).includes(normalizedQuery));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

  const services = packageServices.map((row) => normalizeCatalogItem(row, 'service'));
  const extras = packageExtras.map((row) => normalizeCatalogItem(row, 'extra'));
  const totalServicesInTemplates = rows.reduce((total, row) => total + row.serviceCount, 0);

  return {
    revision: snapshot.revision,
    summary: {
      totalPackages: packages.length,
      activePackages: packages.filter((pkg) => pkg?.status !== 'inactive').length,
      totalServices: services.length,
      totalExtras: extras.length,
      servicesInTemplates: totalServicesInTemplates,
      externalServices: services.filter((row) => row.sourceType === 'external').length,
    },
    rooms: rooms.filter((room) => room?.status !== 'inactive').map((room) => ({ id: room.id, name: room.name ?? '' })),
    suppliers: suppliers.filter((supplier) => supplier?.status !== 'inactive').map((supplier) => ({ id: supplier.id, name: supplier.name ?? '' })),
    services,
    extras,
    rows,
  };
};
