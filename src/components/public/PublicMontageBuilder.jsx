import { useEffect, useMemo, useState } from 'react';

const PUBLIC_CATALOG_ENDPOINTS = ['/__copetin_db/public/catalog', '/api/public/catalog'];
const STORAGE_KEY = 'copetin-public-montage-v2';

const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const money = (value) => Number(Math.max(0, Number(value ?? 0)).toFixed(2));
const formatBs = (value) => `Bs ${money(value).toLocaleString('es-BO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const SLOT_DEFINITIONS = [
  { id: 'mesa', label: 'Mesa', keywords: ['mesa'], excludes: ['muleton', 'mantel', 'caminito', 'coctelera', 'mesa infantil'] },
  { id: 'mantel', label: 'Mantel', keywords: ['mantel'], excludes: ['caminito', 'sobre mantel', 'sobremantel', 'muleton'] },
  { id: 'caminito', label: 'Caminito / sobremantel', keywords: ['caminito', 'camino', 'sobre mantel', 'sobremantel', 'faldon'] },
  { id: 'plaquet', label: 'Plaquet', keywords: ['plaquet', 'bajoplato', 'bajo plato'] },
  { id: 'plato', label: 'Plato', keywords: ['plato'], excludes: ['plaquet'] },
  { id: 'servilleta', label: 'Servilleta', keywords: ['servilleta'] },
  { id: 'copa', label: 'Copa / vaso', keywords: ['copa', 'vaso', 'cristaleria', 'cristalería'] },
  { id: 'tenedor', label: 'Tenedor', keywords: ['tenedor'] },
  { id: 'cuchillo', label: 'Cuchillo / cuchara', keywords: ['cuchillo', 'cuchara'] },
  { id: 'silla', label: 'Silla', keywords: ['silla'], excludes: ['cojin', 'cojín', 'capuchon', 'capuchón', 'cobertor', 'infantil'] },
  { id: 'cobertor', label: 'Cobertor / capuchón', keywords: ['cobertor', 'capuchon', 'capuchón'] },
  { id: 'cojin', label: 'Cojín', keywords: ['cojin', 'cojín'] },
  { id: 'centro', label: 'Centro de mesa', keywords: ['centro', 'arreglo', 'florero', 'candelabro', 'portavela', 'porta vela', 'vela', 'base decorativa'] },
];

const tableTypes = [
  { id: 'round', label: 'Redonda', seats: 8 },
  { id: 'rect', label: 'Rectangular', seats: 10 },
  { id: 'square', label: 'Cuadrada', seats: 8 },
];

const perSeatSlots = new Set(['plaquet', 'plato', 'servilleta', 'copa', 'tenedor', 'cuchillo', 'silla', 'cobertor', 'cojin']);

const productHaystack = (item) => normalizeText([
  item?.name,
  item?.category,
  item?.color,
  item?.material,
  item?.areaLabel,
].join(' '));

const productNameText = (item) => normalizeText(item?.name);

const belongsToSlot = (item, slot) => {
  if (!item || item.kind === 'combo') return false;
  const nameText = productNameText(item);
  const fullText = productHaystack(item);

  if (slot.excludes?.some((word) => nameText.includes(normalizeText(word)))) return false;

  // Las familias de montaje se determinan primero por el NOMBRE REAL del item.
  // Evita falsos positivos como "mantel" dentro de la categoría "mantelería".
  const nameMatch = slot.keywords.some((word) => nameText.includes(normalizeText(word)));
  if (nameMatch) return true;

  // Fallback muy conservador para categorías explícitas.
  const categoryText = normalizeText(item?.category);
  return slot.keywords.some((word) => {
    const keyword = normalizeText(word);
    return keyword.length >= 6 && categoryText === keyword && fullText.includes(keyword);
  });
};

const COLOR_RULES = [
  ['negro', '#1f2328'],
  ['blanco', '#f3efe7'],
  ['marfil', '#e8ddc6'],
  ['hueso', '#e2d2b4'],
  ['beige', '#cbb89b'],
  ['arena', '#c8ac86'],
  ['cafe', '#7b5336'],
  ['café', '#7b5336'],
  ['dorado', '#c59a48'],
  ['oro', '#c59a48'],
  ['plata', '#b9bdc5'],
  ['plateado', '#b9bdc5'],
  ['guindo', '#6d1f2c'],
  ['vino', '#732b39'],
  ['rojo', '#a72d2d'],
  ['fucsia', '#d83379'],
  ['rosado', '#d99aa8'],
  ['rosa', '#d99aa8'],
  ['lila', '#8d70a9'],
  ['morado', '#694b8c'],
  ['naranja', '#d97935'],
  ['amarillo', '#d9b340'],
  ['mostaza', '#b8932f'],
  ['turquesa', '#3c9e9f'],
  ['menta', '#95b9a4'],
  ['verde olivo', '#66734a'],
  ['verde', '#537a59'],
  ['azul marino', '#283b58'],
  ['azul', '#52749d'],
  ['celeste', '#87a9c7'],
];

const colorFromItem = (item, fallback = '#ded3c2') => {
  const haystack = normalizeText([item?.name, item?.color, item?.material].join(' '));
  const match = COLOR_RULES.find(([word]) => haystack.includes(normalizeText(word)));
  return match?.[1] ?? fallback;
};

const hexToRgb = (hex) => {
  const normalized = String(hex ?? '').replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return { r: 210, g: 200, b: 185 };
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
};

const rgbToHex = ({ r, g, b }) => `#${[r, g, b]
  .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
  .join('')}`;

const colorDistance = (left, right) => {
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  return Math.sqrt(
    ((a.r - b.r) ** 2)
    + ((a.g - b.g) ** 2)
    + ((a.b - b.b) ** 2),
  );
};

const perceivedLightness = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  return ((r * 299) + (g * 587) + (b * 114)) / 1000;
};

const makeVisualFallback = (item) => ({
  dominantColor: colorFromItem(item, '#d8cab6'),
  accentColor: colorFromItem(item, '#b99b73'),
  textureStrength: 0.22,
  cutoutUrl: item?.imageUrl || '',
  textureUrl: item?.imageUrl || '',
  analyzed: false,
});

const analyzeProductImage = (item) => new Promise((resolve) => {
  if (!item?.imageUrl || typeof document === 'undefined') {
    resolve(makeVisualFallback(item));
    return;
  }

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';

  image.onload = () => {
    try {
      const sampleSize = 72;
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = sampleSize;
      sampleCanvas.height = sampleSize;
      const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (!sampleContext) throw new Error('Canvas no disponible');

      sampleContext.drawImage(image, 0, 0, sampleSize, sampleSize);
      const pixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize);
      const data = pixels.data;

      const cornerPoints = [
        [2, 2],
        [sampleSize - 3, 2],
        [2, sampleSize - 3],
        [sampleSize - 3, sampleSize - 3],
      ];

      const cornerColors = cornerPoints.map(([x, y]) => {
        const offset = ((y * sampleSize) + x) * 4;
        return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
      });

      const background = cornerColors.reduce(
        (sum, color) => ({
          r: sum.r + color.r / cornerColors.length,
          g: sum.g + color.g / cornerColors.length,
          b: sum.b + color.b / cornerColors.length,
        }),
        { r: 0, g: 0, b: 0 },
      );

      let minX = sampleSize;
      let minY = sampleSize;
      let maxX = 0;
      let maxY = 0;
      let foregroundCount = 0;
      let colorSum = { r: 0, g: 0, b: 0 };
      let luminanceSum = 0;
      let luminanceSquaredSum = 0;

      const distanceFromBackground = (r, g, b) => Math.sqrt(
        ((r - background.r) ** 2)
        + ((g - background.g) ** 2)
        + ((b - background.b) ** 2),
      );

      for (let y = 0; y < sampleSize; y += 1) {
        for (let x = 0; x < sampleSize; x += 1) {
          const offset = ((y * sampleSize) + x) * 4;
          const alpha = data[offset + 3];
          if (alpha < 16) continue;
          const r = data[offset];
          const g = data[offset + 1];
          const b = data[offset + 2];
          const distance = distanceFromBackground(r, g, b);
          if (distance < 38) continue;

          foregroundCount += 1;
          colorSum = { r: colorSum.r + r, g: colorSum.g + g, b: colorSum.b + b };
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);

          const lum = ((r * 299) + (g * 587) + (b * 114)) / 1000;
          luminanceSum += lum;
          luminanceSquaredSum += lum ** 2;
        }
      }

      if (foregroundCount < 25) {
        resolve(makeVisualFallback(item));
        return;
      }

      const dominantColor = rgbToHex({
        r: colorSum.r / foregroundCount,
        g: colorSum.g / foregroundCount,
        b: colorSum.b / foregroundCount,
      });

      const averageLum = luminanceSum / foregroundCount;
      const variance = Math.max(0, (luminanceSquaredSum / foregroundCount) - (averageLum ** 2));
      const textureStrength = Math.max(0.12, Math.min(0.52, 0.13 + (Math.sqrt(variance) / 115)));

      const sourceX = Math.max(0, Math.floor((minX / sampleSize) * image.naturalWidth));
      const sourceY = Math.max(0, Math.floor((minY / sampleSize) * image.naturalHeight));
      const sourceWidth = Math.max(
        1,
        Math.ceil(((maxX - minX + 1) / sampleSize) * image.naturalWidth),
      );
      const sourceHeight = Math.max(
        1,
        Math.ceil(((maxY - minY + 1) / sampleSize) * image.naturalHeight),
      );

      const outputSize = 320;
      const cutoutCanvas = document.createElement('canvas');
      cutoutCanvas.width = outputSize;
      cutoutCanvas.height = outputSize;
      const cutoutContext = cutoutCanvas.getContext('2d', { willReadFrequently: true });
      if (!cutoutContext) throw new Error('Canvas no disponible');

      const scale = Math.min(
        (outputSize * 0.88) / sourceWidth,
        (outputSize * 0.88) / sourceHeight,
      );
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;
      const drawX = (outputSize - drawWidth) / 2;
      const drawY = (outputSize - drawHeight) / 2;

      cutoutContext.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        drawX,
        drawY,
        drawWidth,
        drawHeight,
      );

      const cutPixels = cutoutContext.getImageData(0, 0, outputSize, outputSize);
      const cutData = cutPixels.data;
      for (let index = 0; index < cutData.length; index += 4) {
        const r = cutData[index];
        const g = cutData[index + 1];
        const b = cutData[index + 2];
        const originalAlpha = cutData[index + 3];
        if (originalAlpha === 0) continue;

        const distance = distanceFromBackground(r, g, b);
        const normalized = Math.max(0, Math.min(1, (distance - 18) / 60));
        cutData[index + 3] = Math.round(originalAlpha * (normalized ** 0.78));
      }
      cutoutContext.putImageData(cutPixels, 0, 0);

      const fallbackColor = colorFromItem(item, dominantColor);
      const analyzedColor = colorDistance(fallbackColor, dominantColor) > 125
        ? fallbackColor
        : dominantColor;

      resolve({
        dominantColor: analyzedColor,
        accentColor: perceivedLightness(analyzedColor) > 155 ? '#9d815d' : '#e1c99c',
        textureStrength,
        cutoutUrl: cutoutCanvas.toDataURL('image/png', 0.92),
        textureUrl: item.imageUrl,
        analyzed: true,
      });
    } catch {
      resolve(makeVisualFallback(item));
    }
  };

  image.onerror = () => resolve(makeVisualFallback(item));
  image.src = item.imageUrl;
});

const itemTextureStyle = (item, visual, fallback) => ({
  '--item-color': visual?.dominantColor || colorFromItem(item, fallback),
  '--item-image': (visual?.textureUrl || item?.imageUrl)
    ? `url("${visual?.textureUrl || item.imageUrl}")`
    : 'none',
  '--texture-strength': String(visual?.textureStrength ?? 0.22),
});

const visualFor = (visuals, item) => (
  item?.id ? visuals?.[item.id] ?? makeVisualFallback(item) : null
);

function ProductThumb({ item, selected, onClick }) {
  return (
    <button
      type="button"
      className={`montage-product-thumb${selected ? ' is-selected' : ''}`}
      onClick={onClick}
      title={item.name}
    >
      <span className="montage-product-thumb-image">
        {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span>EC</span>}
      </span>
      <span className="montage-product-thumb-name">{item.name}</span>
    </button>
  );
}

function SoftAsset({ item, visual, className = '', alt = '', style }) {
  const source = visual?.cutoutUrl || item?.imageUrl;
  if (!source) return null;
  return (
    <img
      className={`montage-soft-asset ${className}`}
      src={source}
      alt={alt || item.name}
      draggable="false"
      style={style}
    />
  );
}

function PlaceSetting({ selections, visuals, className = '', style }) {
  const plaquetVisual = visualFor(visuals, selections.plaquet);
  const plateVisual = visualFor(visuals, selections.plato);
  const napkinVisual = visualFor(visuals, selections.servilleta);
  const glassVisual = visualFor(visuals, selections.copa);
  const forkVisual = visualFor(visuals, selections.tenedor);
  const knifeVisual = visualFor(visuals, selections.cuchillo);

  return (
    <div className={`montage-setting ${className}`} style={style}>
      <div
        className="montage-setting-plaquet"
        style={itemTextureStyle(selections.plaquet, plaquetVisual, '#d1ad62')}
      >
        {selections.plaquet?.imageUrl ? (
          <SoftAsset
            item={selections.plaquet}
            visual={plaquetVisual}
            className="montage-setting-photo montage-setting-photo--plaquet"
          />
        ) : null}
      </div>

      <div
        className="montage-setting-plate"
        style={itemTextureStyle(selections.plato, plateVisual, '#f7f5ef')}
      >
        {selections.plato?.imageUrl ? (
          <SoftAsset
            item={selections.plato}
            visual={plateVisual}
            className="montage-setting-photo montage-setting-photo--plate"
          />
        ) : null}
      </div>

      {selections.servilleta ? (
        <div
          className="montage-setting-napkin"
          style={{ backgroundColor: napkinVisual?.dominantColor || colorFromItem(selections.servilleta, '#665944') }}
        >
          <SoftAsset
            item={selections.servilleta}
            visual={napkinVisual}
            className="montage-setting-photo montage-setting-photo--napkin"
          />
        </div>
      ) : null}

      {selections.copa ? (
        <div className="montage-setting-glass">
          <SoftAsset
            item={selections.copa}
            visual={glassVisual}
            className="montage-setting-photo montage-setting-photo--glass"
          />
          {!selections.copa?.imageUrl ? <span>◯</span> : null}
        </div>
      ) : null}

      {selections.tenedor ? (
        <div className="montage-setting-fork">
          <SoftAsset
            item={selections.tenedor}
            visual={forkVisual}
            className="montage-setting-photo montage-setting-photo--cutlery"
          />
          {!selections.tenedor?.imageUrl ? <span>♜</span> : null}
        </div>
      ) : null}

      {selections.cuchillo ? (
        <div className="montage-setting-knife">
          <SoftAsset
            item={selections.cuchillo}
            visual={knifeVisual}
            className="montage-setting-photo montage-setting-photo--cutlery"
          />
          {!selections.cuchillo?.imageUrl ? <span>│</span> : null}
        </div>
      ) : null}
    </div>
  );
}

const roundMainPlaces = [
  { left: '12%', top: '47%', rotate: '-72deg' },
  { left: '25%', top: '24%', rotate: '-35deg' },
  { left: '43%', top: '16%', rotate: '-10deg' },
  { right: '25%', top: '24%', rotate: '35deg' },
  { right: '12%', top: '47%', rotate: '72deg' },
  { right: '27%', bottom: '12%', rotate: '145deg' },
  { left: '27%', bottom: '12%', rotate: '-145deg' },
];

const rectMainPlaces = [
  { left: '8%', top: '22%', rotate: '-12deg' },
  { left: '27%', top: '18%', rotate: '-5deg' },
  { left: '46%', top: '18%', rotate: '0deg' },
  { right: '18%', top: '18%', rotate: '6deg' },
  { right: '5%', top: '24%', rotate: '12deg' },
  { left: '15%', bottom: '10%', rotate: '185deg' },
  { left: '38%', bottom: '8%', rotate: '180deg' },
  { right: '15%', bottom: '10%', rotate: '175deg' },
];

const squareMainPlaces = [
  { left: '14%', top: '20%', rotate: '-24deg' },
  { left: '41%', top: '15%', rotate: '0deg' },
  { right: '14%', top: '20%', rotate: '24deg' },
  { right: '8%', top: '52%', rotate: '70deg' },
  { right: '20%', bottom: '10%', rotate: '150deg' },
  { left: '20%', bottom: '10%', rotate: '-150deg' },
  { left: '8%', top: '52%', rotate: '-70deg' },
];

const chairLayouts = {
  round: [
    { left: '3%', top: '43%', rotate: '-22deg' },
    { left: '15%', top: '13%', rotate: '-12deg' },
    { left: '43%', top: '3%', rotate: '0deg' },
    { right: '15%', top: '13%', rotate: '12deg' },
    { right: '3%', top: '43%', rotate: '22deg' },
    { right: '18%', bottom: '0%', rotate: '10deg' },
    { left: '18%', bottom: '0%', rotate: '-10deg' },
  ],
  rect: [
    { left: '2%', top: '15%', rotate: '-9deg' },
    { left: '26%', top: '5%', rotate: '-3deg' },
    { right: '26%', top: '5%', rotate: '3deg' },
    { right: '2%', top: '15%', rotate: '9deg' },
    { left: '5%', bottom: '1%', rotate: '-5deg' },
    { left: '34%', bottom: '-2%', rotate: '-2deg' },
    { right: '34%', bottom: '-2%', rotate: '2deg' },
    { right: '5%', bottom: '1%', rotate: '5deg' },
  ],
  square: [
    { left: '4%', top: '18%', rotate: '-14deg' },
    { left: '39%', top: '2%', rotate: '0deg' },
    { right: '4%', top: '18%', rotate: '14deg' },
    { right: '4%', bottom: '5%', rotate: '9deg' },
    { left: '39%', bottom: '-2%', rotate: '0deg' },
    { left: '4%', bottom: '5%', rotate: '-9deg' },
  ],
};

function TableDressing({ selections, visuals, tableType, mode = 'main' }) {
  const mantelVisual = visualFor(visuals, selections.mantel);
  const runnerVisual = visualFor(visuals, selections.caminito);
  const tableVisual = visualFor(visuals, selections.mesa);

  const style = itemTextureStyle(selections.mantel, mantelVisual, '#e5dccd');
  const runnerStyle = itemTextureStyle(selections.caminito, runnerVisual, 'rgba(191,156,110,.65)');

  return (
    <div className={`montage-real-table montage-real-table--${mode} montage-real-table--${tableType.id}`}>
      <div className="montage-table-skirt" style={style}>
        <div className="montage-cloth-texture" />
      </div>
      <div className="montage-table-top" style={style}>
        <div className="montage-cloth-texture" />
        {selections.caminito ? (
          <div className="montage-runner-surface" style={runnerStyle}>
            <div className="montage-cloth-texture" />
          </div>
        ) : null}
      </div>
      {selections.mesa?.imageUrl ? (
        <SoftAsset
          item={selections.mesa}
          visual={tableVisual}
          className="montage-table-identity"
        />
      ) : null}
    </div>
  );
}

function ChairAsset({ selections, visuals, style }) {
  if (!selections.silla) return null;

  const chairVisual = visualFor(visuals, selections.silla);
  const coverVisual = visualFor(visuals, selections.cobertor);
  const cushionVisual = visualFor(visuals, selections.cojin);

  return (
    <div className="montage-real-chair" style={style}>
      <SoftAsset
        item={selections.silla}
        visual={chairVisual}
        className="montage-real-chair-base"
      />
      {selections.cobertor ? (
        <div
          className="montage-real-chair-cover"
          style={{ backgroundColor: coverVisual?.dominantColor || colorFromItem(selections.cobertor, 'rgba(238,231,217,.78)') }}
        >
          <SoftAsset
            item={selections.cobertor}
            visual={coverVisual}
            className="montage-real-chair-cover-photo"
          />
        </div>
      ) : null}
      {selections.cojin ? (
        <div
          className="montage-real-chair-cushion"
          style={{ backgroundColor: cushionVisual?.dominantColor || colorFromItem(selections.cojin, '#dbcaa9') }}
        >
          <SoftAsset
            item={selections.cojin}
            visual={cushionVisual}
            className="montage-real-chair-cushion-photo"
          />
        </div>
      ) : null}
    </div>
  );
}

function MainScene({ selections, visuals, tableType }) {
  const placeLayout = tableType.id === 'rect'
    ? rectMainPlaces
    : tableType.id === 'square'
      ? squareMainPlaces
      : roundMainPlaces;

  const placeCount = Math.min(tableType.seats, placeLayout.length);
  const chairs = chairLayouts[tableType.id] ?? chairLayouts.round;

  return (
    <div className={`montage-scene montage-scene-v2 montage-scene-v2--main montage-scene-v2--${tableType.id}`}>
      <div className="montage-room-wall">
        <div className="montage-room-lights" />
      </div>
      <div className="montage-room-floor" />

      <TableDressing selections={selections} visuals={visuals} tableType={tableType} mode="main" />

      {Array.from({ length: placeCount }, (_, index) => {
        const pos = placeLayout[index];
        return (
          <PlaceSetting
            key={index}
            selections={selections}
            visuals={visuals}
            className="montage-setting--main"
            style={{
              ...pos,
              transform: `rotate(${pos.rotate})`,
            }}
          />
        );
      })}

      {chairs.slice(0, Math.min(chairs.length, tableType.seats)).map((pos, index) => (
        <ChairAsset
          key={index}
          selections={selections}
          visuals={visuals}
          style={{
            ...pos,
            transform: `rotate(${pos.rotate})`,
          }}
        />
      ))}

      {selections.centro ? (
        <div className="montage-real-centerpiece">
          <SoftAsset item={selections.centro} visual={visualFor(visuals, selections.centro)} className="montage-real-centerpiece-photo" />
        </div>
      ) : null}

      <span className="montage-scene-note">Montado referencial con productos reales del catálogo</span>
    </div>
  );
}

function TopScene({ selections, visuals, tableType }) {
  const placeCount = Math.min(tableType.seats, 10);
  const positions = Array.from({ length: placeCount }, (_, index) => {
    const angle = ((Math.PI * 2) / placeCount) * index - Math.PI / 2;
    const radiusX = tableType.id === 'rect' ? 39 : tableType.id === 'square' ? 36 : 38;
    const radiusY = tableType.id === 'rect' ? 31 : tableType.id === 'square' ? 34 : 38;
    return {
      left: `${50 + Math.cos(angle) * radiusX}%`,
      top: `${50 + Math.sin(angle) * radiusY}%`,
      transform: `translate(-50%, -50%) rotate(${(angle * 180 / Math.PI) + 90}deg)`,
    };
  });

  return (
    <div className={`montage-scene montage-scene-v2 montage-scene-v2--top montage-scene-v2--${tableType.id}`}>
      <div className="montage-top-stage">
        <TableDressing selections={selections} visuals={visuals} tableType={tableType} mode="top" />
        {positions.map((style, index) => (
          <PlaceSetting key={index} selections={selections} visuals={visuals} className="montage-setting--top" style={style} />
        ))}
        {selections.centro ? (
          <div className="montage-real-centerpiece montage-real-centerpiece--top">
            <SoftAsset item={selections.centro} visual={visualFor(visuals, selections.centro)} className="montage-real-centerpiece-photo" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PlaceScene({ selections, visuals }) {
  return (
    <div className="montage-scene montage-scene-v2 montage-scene-v2--place">
      <div className="montage-place-real-surface" style={itemTextureStyle(selections.mantel, visualFor(visuals, selections.mantel), '#e6ddcf')}>
        <div className="montage-cloth-texture" />
        {selections.caminito ? (
          <div className="montage-place-runner" style={itemTextureStyle(selections.caminito, visualFor(visuals, selections.caminito), '#bca77f')}>
            <div className="montage-cloth-texture" />
          </div>
        ) : null}
        <PlaceSetting selections={selections} visuals={visuals} className="montage-setting--hero" />
        {selections.centro ? (
          <div className="montage-place-centerpiece">
            <SoftAsset item={selections.centro} visual={visualFor(visuals, selections.centro)} className="montage-real-centerpiece-photo" />
          </div>
        ) : null}
      </div>
      <div className="montage-place-chair-hero">
        <ChairAsset selections={selections} visuals={visuals} />
      </div>
    </div>
  );
}

function MontageScene({ selections, visuals, tableType, view }) {
  if (view === 'top') return <TopScene selections={selections} visuals={visuals} tableType={tableType} />;
  if (view === 'place') return <PlaceScene selections={selections} visuals={visuals} />;
  return <MainScene selections={selections} visuals={visuals} tableType={tableType} />;
}

export default function PublicMontageBuilder() {
  const [catalog, setCatalog] = useState({ products: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tableTypeId, setTableTypeId] = useState('round');
  const [view, setView] = useState('main');
  const [activeSlot, setActiveSlot] = useState('mantel');
  const [slotQuery, setSlotQuery] = useState('');
  const [selections, setSelections] = useState({});
  const [savedAt, setSavedAt] = useState('');
  const [visuals, setVisuals] = useState({});
  const [autoDesigning, setAutoDesigning] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (stored?.tableTypeId) setTableTypeId(stored.tableTypeId);
      if (stored?.selections && typeof stored.selections === 'object') setSelections(stored.selections);
    } catch {
      // Configuración local opcional.
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let payload = null;
        let lastError = null;
        for (const endpoint of PUBLIC_CATALOG_ENDPOINTS) {
          try {
            const response = await fetch(endpoint, {
              headers: { Accept: 'application/json' },
              cache: 'no-store',
            });
            if (!response.ok) throw new Error(`No se pudo cargar ${endpoint}`);
            payload = await response.json();
            break;
          } catch (requestError) {
            lastError = requestError;
          }
        }
        if (!payload) throw lastError || new Error('No se pudo cargar el catálogo.');
        if (!active) return;
        setCatalog({ products: Array.isArray(payload.products) ? payload.products : [] });
      } catch (requestError) {
        if (active) setError(requestError.message || 'No se pudo cargar el catálogo.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const selectedItems = Object.values(selections).filter((item) => item?.id);

    selectedItems.forEach((item) => {
      if (visuals[item.id]) return;
      analyzeProductImage(item).then((visual) => {
        if (cancelled) return;
        setVisuals((current) => (
          current[item.id] ? current : { ...current, [item.id]: visual }
        ));
      });
    });

    return () => { cancelled = true; };
  }, [selections, visuals]);

  const tableType = tableTypes.find((entry) => entry.id === tableTypeId) ?? tableTypes[0];
  const activeDefinition = SLOT_DEFINITIONS.find((slot) => slot.id === activeSlot) ?? SLOT_DEFINITIONS[0];

  const candidatesBySlot = useMemo(() => {
    const result = {};
    SLOT_DEFINITIONS.forEach((slot) => {
      result[slot.id] = catalog.products.filter((item) => belongsToSlot(item, slot));
    });
    return result;
  }, [catalog.products]);

  const activeCandidates = useMemo(() => {
    const normalizedQuery = normalizeText(slotQuery);
    return (candidatesBySlot[activeSlot] ?? []).filter((item) => (
      !normalizedQuery || productHaystack(item).includes(normalizedQuery)
    ));
  }, [activeSlot, candidatesBySlot, slotQuery]);

  const selectedRows = SLOT_DEFINITIONS
    .map((slot) => ({ slot, item: selections[slot.id] }))
    .filter((entry) => entry.item);

  const estimatedTotal = selectedRows.reduce((sum, { slot, item }) => {
    const qty = perSeatSlots.has(slot.id) ? tableType.seats : 1;
    return sum + (money(item.rentalPriceBs) * qty);
  }, 0);

  const scoreCandidateForSlot = (slotId, item, baseColor) => {
    const candidateColor = colorFromItem(item, '#c6b89e');
    const distance = colorDistance(baseColor, candidateColor);
    const text = productHaystack(item);
    let score = 0;

    if (slotId === 'plato') {
      score += perceivedLightness(candidateColor) > 175 ? 110 : 25;
      if (text.includes('blanco') || text.includes('marfil')) score += 90;
    } else if (slotId === 'copa') {
      score += 70;
      if (text.includes('transpar') || text.includes('cristal') || text.includes('copa')) score += 60;
    } else if (slotId === 'tenedor' || slotId === 'cuchillo') {
      if (text.includes('dorado') || text.includes('plata') || text.includes('acero')) score += 100;
      score += Math.max(0, 70 - Math.abs(distance - 110) * 0.35);
    } else if (slotId === 'silla') {
      if (text.includes('dorado') || text.includes('tiffany') || text.includes('crossback') || text.includes('madera')) score += 85;
      score += Math.max(0, 95 - Math.abs(distance - 125) * 0.42);
    } else if (slotId === 'plaquet') {
      if (text.includes('dorado') || text.includes('plata') || text.includes('vidrio')) score += 80;
      score += Math.max(0, 110 - Math.abs(distance - 120) * 0.45);
    } else if (slotId === 'servilleta' || slotId === 'caminito') {
      score += Math.max(0, 130 - Math.abs(distance - 145) * 0.48);
    } else if (slotId === 'centro') {
      score += 80;
      if (text.includes('flor') || text.includes('vela') || text.includes('candelabro')) score += 55;
    } else {
      score += Math.max(0, 100 - Math.abs(distance - 110) * 0.4);
    }

    score += Math.min(20, Number(item.totalStock ?? 0) / 10);
    return score;
  };

  const autoCompose = () => {
    setAutoDesigning(true);
    const mantelItem = selections.mantel ?? (candidatesBySlot.mantel ?? [])[0] ?? null;
    const baseColor = colorFromItem(mantelItem, '#e4dac9');

    const nextSelections = {
      ...selections,
      ...(mantelItem ? { mantel: mantelItem } : {}),
    };

    const slotsToComplete = ['caminito', 'plaquet', 'plato', 'servilleta', 'copa', 'tenedor', 'cuchillo', 'silla', 'centro'];
    slotsToComplete.forEach((slotId) => {
      if (nextSelections[slotId]) return;
      const candidates = (candidatesBySlot[slotId] ?? [])
        .slice(0, 160)
        .map((item) => ({
          item,
          score: scoreCandidateForSlot(slotId, item, baseColor),
        }))
        .sort((left, right) => right.score - left.score);

      if (candidates[0]?.item) nextSelections[slotId] = candidates[0].item;
    });

    setSelections(nextSelections);
    window.setTimeout(() => setAutoDesigning(false), 450);
  };

  const saveMontage = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tableTypeId, selections }));
    setSavedAt(new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }));
  };

  const clearMontage = () => {
    setSelections({});
    localStorage.removeItem(STORAGE_KEY);
    setSavedAt('');
  };

  const requestCombination = async () => {
    const lines = selectedRows.map(({ slot, item }) => {
      const qty = perSeatSlots.has(slot.id) ? tableType.seats : 1;
      return `${slot.label}: ${item.name} x${qty} (Cod. ${item.sku})`;
    });
    const text = [
      'EL COPETÍN - SOLICITUD DE MONTADO',
      `Mesa: ${tableType.label} / ${tableType.seats} puestos`,
      ...lines,
      `Estimado referencial: ${formatBs(estimatedTotal)}`,
      'Solicito confirmar disponibilidad y cotización.',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      window.alert('Combinación copiada. Puedes pegarla en WhatsApp o enviarla al equipo de El Copetín.');
    } catch {
      window.prompt('Copia esta combinación para enviarla a El Copetín:', text);
    }
  };

  return (
    <main className="public-catalog-page public-montage-page public-montage-page-v2">
      <section className="public-montage-hero">
        <div>
          <span>El Copetín</span>
          <h1>Crear montado</h1>
          <p>Arma una mesa completa con productos reales: mantelería, vajilla, cristalería, cubiertos, sillas y decoración.</p>
        </div>
        <div className="public-montage-hero-actions">
          <a href="/catalogo">← Volver al catálogo</a>
          <strong>{catalog.products.length.toLocaleString('es-BO')} productos reales cargados</strong>
        </div>
      </section>

      {loading ? <div className="public-catalog-state">Cargando productos para el montado...</div> : null}
      {error ? <div className="public-catalog-state public-catalog-state--error">{error}</div> : null}

      {!loading && !error ? (
        <div className="public-montage-workspace public-montage-workspace-v2">
          <aside className="public-montage-controls">
            <div className="montage-control-heading">
              <span>1. Base del montaje</span>
              <strong>Tipo de mesa</strong>
            </div>

            <div className="montage-table-types">
              {tableTypes.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  className={tableTypeId === type.id ? 'is-active' : ''}
                  onClick={() => setTableTypeId(type.id)}
                >
                  <span className={`montage-table-icon montage-table-icon--${type.id}`} />
                  {type.label}
                  <small>{type.seats} puestos</small>
                </button>
              ))}
            </div>

            <div className="montage-control-heading">
              <span>2. Productos reales</span>
              <strong>Viste y arma la mesa</strong>
            </div>

            <div className="montage-slot-tabs montage-slot-tabs-v2">
              {SLOT_DEFINITIONS.map((slot) => {
                const selected = selections[slot.id];
                return (
                  <button
                    key={slot.id}
                    type="button"
                    className={activeSlot === slot.id ? 'is-active' : ''}
                    onClick={() => {
                      setActiveSlot(slot.id);
                      setSlotQuery('');
                    }}
                  >
                    <span>{slot.label}</span>
                    <small>{selected ? selected.name : `${(candidatesBySlot[slot.id] ?? []).length} opciones`}</small>
                  </button>
                );
              })}
            </div>

            <div className="montage-auto-design-card">
              <div>
                <span>Diseño inteligente</span>
                <strong>Completar montado automáticamente</strong>
                <small>Analiza color, contraste y familia de tus productos reales para proponer una combinación completa.</small>
              </div>
              <button type="button" onClick={autoCompose} disabled={autoDesigning}>
                {autoDesigning ? 'Armando…' : '✨ Diseñar montaje'}
              </button>
            </div>

            <div className="montage-product-picker">
              <div className="montage-product-picker-head">
                <div>
                  <strong>{activeDefinition.label}</strong>
                  <span>{activeCandidates.length} productos disponibles en catálogo</span>
                </div>
                {selections[activeSlot] ? (
                  <button
                    type="button"
                    onClick={() => setSelections((current) => ({ ...current, [activeSlot]: null }))}
                  >
                    Quitar
                  </button>
                ) : null}
              </div>

              <input
                value={slotQuery}
                onChange={(event) => setSlotQuery(event.target.value)}
                placeholder={`Buscar ${activeDefinition.label.toLowerCase()}...`}
              />

              <div className="montage-product-strip">
                {activeCandidates.slice(0, 120).map((item) => (
                  <ProductThumb
                    key={item.id}
                    item={item}
                    selected={selections[activeSlot]?.id === item.id}
                    onClick={() => {
                      setSelections((current) => ({ ...current, [activeSlot]: item }));
                      if (activeSlot === 'mesa') {
                        const tableName = productNameText(item);
                        if (tableName.includes('rectangular')) setTableTypeId('rect');
                        else if (tableName.includes('cuadrad')) setTableTypeId('square');
                        else if (tableName.includes('redond')) setTableTypeId('round');
                      }
                    }}
                  />
                ))}
                {!activeCandidates.length ? <p>No encontramos productos para esta familia con el filtro actual.</p> : null}
              </div>
            </div>
          </aside>

          <section className="public-montage-preview">
            <header className="montage-preview-header">
              <div>
                <span>Vista del montado</span>
                <strong>Los productos se integran a la mesa</strong>
              </div>
              <div className="montage-view-tabs">
                <button type="button" className={view === 'main' ? 'is-active' : ''} onClick={() => setView('main')}>Principal</button>
                <button type="button" className={view === 'top' ? 'is-active' : ''} onClick={() => setView('top')}>Superior</button>
                <button type="button" className={view === 'place' ? 'is-active' : ''} onClick={() => setView('place')}>Puesto individual</button>
              </div>
            </header>

            <MontageScene selections={selections} visuals={visuals} tableType={tableType} view={view} />

            <div className="montage-preview-foot">
              <span>Vista referencial: respeta producto, color y textura; la perspectiva se adapta a la escena.</span>
              <button type="button" onClick={clearMontage}>Limpiar montaje</button>
            </div>
          </section>

          <aside className="public-montage-summary-panel">
            <header>
              <span>Resumen del montado</span>
              <strong>{tableType.label} · {tableType.seats} puestos</strong>
            </header>

            <div className="montage-summary-list">
              {selectedRows.length ? selectedRows.map(({ slot, item }) => {
                const qty = perSeatSlots.has(slot.id) ? tableType.seats : 1;
                return (
                  <div key={slot.id}>
                    <span className="montage-summary-image">
                      {item.imageUrl ? <img src={item.imageUrl} alt="" /> : 'EC'}
                    </span>
                    <p>
                      <small>{slot.label}</small>
                      <strong>{item.name}</strong>
                      <em>Cod. {item.sku}</em>
                    </p>
                    <b>x{qty}</b>
                  </div>
                );
              }) : <p className="montage-empty-summary">Selecciona productos para armar tu propuesta.</p>}
            </div>

            <div className="montage-estimate">
              <span>Estimado referencial</span>
              <strong>{formatBs(estimatedTotal)}</strong>
              <small>Usa precios actuales del inventario. La disponibilidad final se confirma por fecha.</small>
            </div>

            <button type="button" className="montage-secondary-action" onClick={saveMontage}>♡ Guardar montaje</button>
            {savedAt ? <small className="montage-saved-note">Guardado en este dispositivo a las {savedAt}.</small> : null}
            <button type="button" className="montage-primary-action" disabled={!selectedRows.length} onClick={requestCombination}>
              Solicitar esta combinación
            </button>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
