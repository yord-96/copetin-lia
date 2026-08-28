export const TABLE_TYPES = [
  { id: 'round', label: 'Redonda', seats: 8 },
  { id: 'rect', label: 'Rectangular', seats: 10 },
  { id: 'square', label: 'Cuadrada', seats: 8 },
];

export const buildSceneModel = (type, width, height, view = 'main') => {
  const isMain = view === 'main';
  const cx = width * 0.5;
  const cy = isMain ? height * 0.49 : height * 0.5;

  const geometry = type.id === 'rect'
    ? { shape: 'rect', cx, cy, topW: width * 0.60, topH: isMain ? height * 0.19 : height * 0.42, skirtH: height * 0.27 }
    : type.id === 'square'
      ? { shape: 'square', cx, cy, topW: width * 0.45, topH: isMain ? height * 0.20 : height * 0.45, skirtH: height * 0.27 }
      : { shape: 'ellipse', cx, cy, topW: width * 0.58, topH: isMain ? height * 0.20 : height * 0.48, skirtH: height * 0.27 };

  const seats = [];
  if (type.id === 'rect') {
    const half = Math.ceil(type.seats / 2);
    const front = type.seats - half;
    const xStart = cx - geometry.topW * 0.39;
    const xEnd = cx + geometry.topW * 0.39;
    for (let i = 0; i < half; i += 1) {
      const x = xStart + ((xEnd - xStart) / Math.max(1, half - 1)) * i;
      seats.push({ x, y: cy - geometry.topH * 0.24, rotation: 0, depth: 0.15, side: 'back' });
    }
    for (let i = 0; i < front; i += 1) {
      const x = xStart + ((xEnd - xStart) / Math.max(1, front - 1)) * i;
      seats.push({ x, y: cy + geometry.topH * 0.24, rotation: 180, depth: 0.92, side: 'front' });
    }
  } else {
    const rx = geometry.topW * 0.40;
    const ry = geometry.topH * (isMain ? 0.34 : 0.39);
    for (let i = 0; i < type.seats; i += 1) {
      const angle = ((Math.PI * 2) / type.seats) * i - Math.PI / 2;
      const depth = (Math.sin(angle) + 1) / 2;
      seats.push({
        x: cx + Math.cos(angle) * rx,
        y: cy + Math.sin(angle) * ry,
        rotation: (angle * 180 / Math.PI) + 90,
        depth,
        side: depth > 0.54 ? 'front' : 'back',
      });
    }
  }

  const chairs = seats.map((seat) => {
    if (type.id === 'rect') {
      return {
        x: seat.x,
        y: seat.side === 'back' ? cy - geometry.topH * 1.14 : cy + geometry.topH * 1.28,
        rotation: seat.rotation,
        depth: seat.depth,
        scale: 0.74 + seat.depth * 0.24,
        side: seat.side,
      };
    }
    const rx = geometry.topW * 0.64;
    const ry = geometry.topH * (isMain ? 1.55 : 0.74);
    const angle = ((seat.rotation - 90) * Math.PI) / 180;
    return {
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
      rotation: seat.rotation,
      depth: seat.depth,
      scale: 0.68 + seat.depth * 0.34,
      side: seat.side,
    };
  });

  return {
    geometry,
    seats,
    chairs,
    backdrop: {
      horizonY: isMain ? height * 0.60 : height,
      floorY: isMain ? height * 0.60 : height,
    },
  };
};
