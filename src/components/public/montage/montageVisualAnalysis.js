export const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const COLOR_RULES = [
  ['negro', '#232326'], ['blanco', '#f3efe7'], ['marfil', '#e8ddc6'], ['hueso', '#e2d2b4'],
  ['beige', '#cbb89b'], ['arena', '#c8ac86'], ['cafe', '#7b5336'], ['dorado', '#c59a48'],
  ['oro', '#c59a48'], ['plata', '#b9bdc5'], ['plateado', '#b9bdc5'], ['guindo', '#6d1f2c'],
  ['vino', '#732b39'], ['rojo', '#a72d2d'], ['fucsia', '#d83379'], ['rosado', '#d99aa8'],
  ['rosa', '#d99aa8'], ['lila', '#8d70a9'], ['morado', '#694b8c'], ['naranja', '#d97935'],
  ['amarillo', '#d9b340'], ['mostaza', '#b8932f'], ['turquesa', '#3c9e9f'], ['menta', '#95b9a4'],
  ['verde olivo', '#66734a'], ['verde', '#537a59'], ['azul marino', '#283b58'], ['azul', '#52749d'],
  ['celeste', '#87a9c7'],
];

export const productText = (item) => normalizeText([
  item?.name,
  item?.category,
  item?.color,
  item?.material,
  item?.areaLabel,
].join(' '));

export const productNameText = (item) => normalizeText(item?.name);

export const colorFromItem = (item, fallback = '#ddd4c7') => {
  const haystack = productText(item);
  return COLOR_RULES.find(([word]) => haystack.includes(normalizeText(word)))?.[1] ?? fallback;
};

const hexToRgb = (hex) => {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return { r: 210, g: 200, b: 185 };
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
};

export const colorDistance = (left, right) => {
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  return Math.sqrt(((a.r - b.r) ** 2) + ((a.g - b.g) ** 2) + ((a.b - b.b) ** 2));
};

export const colorLuminance = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  return ((r * 299) + (g * 587) + (b * 114)) / 1000;
};

const classifyMaterial = (item, textureStrength, brightness) => {
  const text = productText(item);
  if (text.includes('vidrio') || text.includes('cristal') || text.includes('copa') || text.includes('vaso')) return 'cristal';
  if (text.includes('dorado') || text.includes('plateado') || text.includes('acero') || text.includes('metal') || text.includes('fierro')) return 'metal';
  if (text.includes('madera') || text.includes('marron') || text.includes('cafe')) return 'madera';
  if (text.includes('gasa') || text.includes('transpar') || text.includes('tul')) return 'translucido';
  if (text.includes('satin') || text.includes('seda') || text.includes('brillo')) return 'satinado';
  if (textureStrength > 0.28) return 'texturado';
  if (brightness > 205) return 'claro';
  return 'mate';
};

const buildFallback = (item) => ({
  dominantColor: colorFromItem(item),
  secondaryColor: colorFromItem(item, '#b99b73'),
  textureStrength: 0.12,
  patternDensity: 0.08,
  brightness: colorLuminance(colorFromItem(item)),
  cutoutUrl: item?.imageUrl || '',
  materialKind: classifyMaterial(item, 0.12, 170),
  analyzed: false,
});

export const analyzeProductVisual = (item) => new Promise((resolve) => {
  if (!item?.imageUrl || typeof document === 'undefined') {
    resolve(buildFallback(item));
    return;
  }

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  image.onload = () => {
    try {
      const size = 84;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas no disponible');
      context.drawImage(image, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size);
      const { data } = pixels;

      const corners = [[2, 2], [size - 3, 2], [2, size - 3], [size - 3, size - 3]];
      const background = corners.reduce((sum, [x, y]) => {
        const offset = ((y * size) + x) * 4;
        return {
          r: sum.r + data[offset] / corners.length,
          g: sum.g + data[offset + 1] / corners.length,
          b: sum.b + data[offset + 2] / corners.length,
        };
      }, { r: 0, g: 0, b: 0 });

      const distanceFromBackground = (r, g, b) => Math.sqrt(
        ((r - background.r) ** 2) + ((g - background.g) ** 2) + ((b - background.b) ** 2),
      );

      let r = 0; let g = 0; let b = 0; let count = 0;
      let minX = size; let minY = size; let maxX = 0; let maxY = 0;
      let lumSum = 0; let lumSquared = 0;
      let edgeCount = 0; let previousLum = null;

      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const index = ((y * size) + x) * 4;
          if (data[index + 3] < 20) continue;
          const pr = data[index]; const pg = data[index + 1]; const pb = data[index + 2];
          if (distanceFromBackground(pr, pg, pb) < 34) continue;
          const lum = ((pr * 299) + (pg * 587) + (pb * 114)) / 1000;
          if (previousLum !== null && Math.abs(previousLum - lum) > 24) edgeCount += 1;
          previousLum = lum;
          r += pr; g += pg; b += pb; count += 1;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          lumSum += lum; lumSquared += lum ** 2;
        }
      }

      if (!count) throw new Error('Sin muestra útil');
      const sampledColor = `#${[r / count, g / count, b / count]
        .map((value) => Math.round(value).toString(16).padStart(2, '0'))
        .join('')}`;
      const namedColor = colorFromItem(item, sampledColor);
      const dominantColor = colorDistance(namedColor, sampledColor) > 135 ? namedColor : sampledColor;
      const brightness = lumSum / count;
      const variance = Math.max(0, (lumSquared / count) - (brightness ** 2));
      const textureStrength = Math.max(0.08, Math.min(0.34, 0.09 + (Math.sqrt(variance) / 180)));
      const patternDensity = Math.max(0.04, Math.min(0.38, edgeCount / Math.max(1, count) * 5.2));

      const outputSize = 420;
      const cutout = document.createElement('canvas');
      cutout.width = outputSize;
      cutout.height = outputSize;
      const cutoutContext = cutout.getContext('2d', { willReadFrequently: true });
      if (!cutoutContext) throw new Error('Canvas no disponible');

      const sx = Math.max(0, Math.floor((minX / size) * image.naturalWidth));
      const sy = Math.max(0, Math.floor((minY / size) * image.naturalHeight));
      const sw = Math.max(1, Math.ceil(((maxX - minX + 1) / size) * image.naturalWidth));
      const sh = Math.max(1, Math.ceil(((maxY - minY + 1) / size) * image.naturalHeight));
      const scale = Math.min((outputSize * 0.9) / sw, (outputSize * 0.9) / sh);
      const dw = sw * scale; const dh = sh * scale;
      const dx = (outputSize - dw) / 2; const dy = (outputSize - dh) / 2;
      cutoutContext.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);

      const cutPixels = cutoutContext.getImageData(0, 0, outputSize, outputSize);
      const cutData = cutPixels.data;
      for (let index = 0; index < cutData.length; index += 4) {
        if (!cutData[index + 3]) continue;
        const distance = distanceFromBackground(cutData[index], cutData[index + 1], cutData[index + 2]);
        const alpha = Math.max(0, Math.min(1, (distance - 12) / 64));
        cutData[index + 3] = Math.round(cutData[index + 3] * (alpha ** 0.72));
      }
      cutoutContext.putImageData(cutPixels, 0, 0);

      resolve({
        dominantColor,
        secondaryColor: sampledColor,
        textureStrength,
        patternDensity,
        brightness,
        cutoutUrl: cutout.toDataURL('image/png', 0.92),
        materialKind: classifyMaterial(item, textureStrength, brightness),
        analyzed: true,
      });
    } catch {
      resolve(buildFallback(item));
    }
  };
  image.onerror = () => resolve(buildFallback(item));
  image.src = item.imageUrl;
});

export const scoreVisualHarmony = (baseItem, candidate, role) => {
  const base = colorFromItem(baseItem, '#d8d0c4');
  const candidateColor = colorFromItem(candidate, '#c5b7a1');
  const distance = colorDistance(base, candidateColor);
  const text = productText(candidate);
  let score = 100 - Math.abs(distance - 118) * 0.42;

  if (role === 'plato' && (text.includes('blanco') || text.includes('marfil'))) score += 95;
  if ((role === 'tenedor' || role === 'cuchillo') && (text.includes('dorado') || text.includes('plata') || text.includes('acero'))) score += 90;
  if (role === 'silla' && (text.includes('tiffany') || text.includes('crossback') || text.includes('madera') || text.includes('dorado'))) score += 68;
  if (role === 'plaquet' && (text.includes('dorado') || text.includes('plata') || text.includes('vidrio'))) score += 78;
  if (role === 'copa' && (text.includes('cristal') || text.includes('transpar') || text.includes('copa'))) score += 72;
  if (role === 'centro' && (text.includes('flor') || text.includes('vela') || text.includes('candelabro'))) score += 55;
  score += Math.min(18, Number(candidate?.totalStock ?? 0) / 12);
  return score;
};
