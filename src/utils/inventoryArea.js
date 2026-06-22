export const INVENTORY_AREAS = [
  { id: 'vajilla', label: 'Vajilla' },
  { id: 'manteleria', label: 'Mantelería' },
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

const normalizeAreaText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export const normalizeInventoryArea = (value) => {
  const normalized = normalizeAreaText(value);
  return INVENTORY_AREAS.some((area) => area.id === normalized) ? normalized : '';
};

export const resolveInventoryArea = (item) => {
  const assignedArea = normalizeInventoryArea(item?.inventoryArea);
  if (assignedArea) return assignedArea;

  const haystack = normalizeAreaText([
    item?.category,
    item?.name,
    item?.itemName,
    item?.description,
  ].filter(Boolean).join(' '));

  for (const area of INVENTORY_AREAS) {
    if (AREA_KEYWORDS[area.id].some((keyword) => haystack.includes(keyword))) {
      return area.id;
    }
  }

  return 'mobiliario';
};

export const getInventoryAreaLabel = (value) =>
  INVENTORY_AREAS.find((area) => area.id === normalizeInventoryArea(value))?.label ?? 'Mobiliario';
