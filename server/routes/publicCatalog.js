import { Router } from 'express';
import { getStateSnapshot } from '../storage/fileStateStore.js';

const router = Router();

const INVENTORY_AREAS = [
  { id: 'combos', label: 'Combos' },
  { id: 'vajilla', label: 'Vajilla' },
  { id: 'manteleria', label: 'Manteleria' },
  { id: 'mobiliario', label: 'Mobiliario' },
];

const AREA_KEYWORDS = {
  vajilla: [
    'cristaleria', 'cubierto', 'plaquet plastico', 'plaquet vidrio', 'vaso',
    'plato hondo', 'butetero plano', 'jarra', 'juego de te', 'llajuero',
    'charola', 'dispensador', 'hielera', 'pinza', 'panero', 'cenicero',
    'varios', 'chifundi', 'aro',
  ],
  manteleria: [
    'faldon', 'cortina', 'gasa', 'caminito', 'capuchon', 'manteleria',
    'servilleta', 'mona', 'cancan', 'licra', 'muleton', 'mantel',
  ],
  mobiliario: [
    'mesa', 'tapiz', 'cojin', 'modulo', 'silla infantil', 'mesa infantil',
    'lounge', 'sombrilla', 'silla', 'silla coctelera', 'mesa coctelera',
    'calentador', 'panel', 'toldo', 'lona', 'tarima', 'plaquet',
  ],
};

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const resolveInventoryArea = (item) => {
  const assignedArea = normalizeText(item?.inventoryArea);
  if (INVENTORY_AREAS.some((area) => area.id === assignedArea)) return assignedArea;

  const haystack = normalizeText([
    item?.category,
    item?.name,
    item?.itemName,
    item?.description,
  ].filter(Boolean).join(' '));

  for (const area of INVENTORY_AREAS) {
    if ((AREA_KEYWORDS[area.id] ?? []).some((keyword) => haystack.includes(keyword))) {
      return area.id;
    }
  }

  return 'mobiliario';
};

const getProductImageSrc = (item) => {
  for (const field of ['imageUrl', 'imageDataUrl', 'image', 'photo', 'thumbnailUrl']) {
    const value = item?.[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const buildPublicCatalog = (state) => {
  const stockItems = (Array.isArray(state?.items) ? state.items : [])
    .filter((item) => !item?.deletedAt)
    .filter((item) => String(item?.adoptionSource ?? '').trim() !== 'service_order_quick_item')
    .filter((item) => String(item?.verificationStatus ?? '').trim() !== 'pending_verification')
    .filter((item) => toNumber(item?.totalStock) > 0);
  const stockItemById = new Map(stockItems.map((item) => [String(item?.id ?? ''), item]));

  const products = stockItems
    .map((item) => {
      const area = resolveInventoryArea(item);
      const name = String(item?.name ?? item?.itemName ?? '').trim();
      const category = String(item?.category ?? '').trim();
      const color = String(item?.itemColor ?? item?.color ?? '').trim();
      const material = String(item?.brand ?? item?.material ?? '').trim();
      const sku = String(item?.sku ?? item?.id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase();
      const totalStock = Math.max(0, Math.trunc(toNumber(item?.totalStock)));
      return {
        id: String(item?.id ?? sku).trim(),
        name,
        category,
        color,
        material,
        area,
        areaLabel: INVENTORY_AREAS.find((entry) => entry.id === area)?.label ?? 'Mobiliario',
        sku: sku || 'GEN',
        imageUrl: getProductImageSrc(item),
        totalStock,
        kind: 'product',
        searchText: normalizeText([name, category, color, material, sku, area].join(' ')),
      };
    })
    .filter((item) => item.name);

  const combos = (Array.isArray(state?.inventoryCombos) ? state.inventoryCombos : [])
    .filter((combo) => !combo?.deletedAt)
    .filter((combo) => String(combo?.status ?? 'active') !== 'inactive')
    .map((combo) => {
      const ingredients = (Array.isArray(combo?.ingredients) ? combo.ingredients : [])
        .map((line) => {
          const optionIds = Array.isArray(line?.optionItemIds) && line.optionItemIds.length > 0
            ? line.optionItemIds
            : [line?.itemId];
          const optionItems = optionIds
            .map((id) => stockItemById.get(String(id ?? '')))
            .filter(Boolean);
          const quantity = Math.max(1, Math.trunc(toNumber(line?.quantity ?? 1)));
          const available = optionItems.reduce((sum, item) => sum + toNumber(item?.totalStock), 0);
          return {
            name: String(line?.slotLabel ?? line?.itemName ?? optionItems[0]?.name ?? '').trim(),
            quantity,
            available,
            controlsStock: optionItems.length > 0,
          };
        })
        .filter((line) => line.name);
      const availableCombos = ingredients.reduce((min, line) => {
        if (!line.controlsStock) return min;
        return Math.min(min, Math.floor(line.available / Math.max(1, line.quantity)));
      }, Number.POSITIVE_INFINITY);
      const totalStock = Number.isFinite(availableCombos) ? Math.max(0, availableCombos) : 0;
      const name = String(combo?.name ?? '').trim();
      const category = String(combo?.category ?? 'COMBOS').trim() || 'COMBOS';
      const sku = String(combo?.id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase();
      const ingredientText = ingredients.map((line) => `${line.quantity}x ${line.name}`).join(' + ');
      return {
        id: `combo-${String(combo?.id ?? sku).trim()}`,
        name,
        category,
        color: '',
        material: '',
        area: 'combos',
        areaLabel: 'Combos',
        sku: sku || 'COMBO',
        imageUrl: getProductImageSrc(combo),
        totalStock,
        kind: 'combo',
        ingredientsCount: ingredients.length,
        detailText: ingredientText,
        searchText: normalizeText([name, category, sku, 'combo combos', ingredientText].join(' ')),
      };
    })
    .filter((combo) => combo.name);

  const catalogItems = [...combos, ...products]
    .sort((left, right) => left.area.localeCompare(right.area, 'es') || left.name.localeCompare(right.name, 'es'));

  const categories = [...new Set(catalogItems.map((item) => item.category).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'es'));

  return {
    updatedAt: new Date().toISOString(),
    products: catalogItems,
    categories,
    areas: INVENTORY_AREAS,
  };
};

const sendPublicCatalog = async (_req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(buildPublicCatalog(snapshot.state ?? {}));
  } catch (error) {
    next(error);
  }
};

router.get('/api/public/catalog', sendPublicCatalog);
router.get('/__copetin_db/public/catalog', sendPublicCatalog);

export default router;
