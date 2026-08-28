export const TABLE_TYPES = [
  { id: 'round', label: 'Redonda', seats: 8 },
  { id: 'rect', label: 'Rectangular', seats: 10 },
  { id: 'square', label: 'Cuadrada', seats: 8 },
];

const lerp = (start, end, t) => start + ((end - start) * t);

const spread = (count, start, end) => Array.from({ length: count }, (_, index) => (
  count <= 1 ? (start + end) / 2 : lerp(start, end, index / (count - 1))
));

const chairScaleFromDepth = (depth, view) => {
  if (view !== 'main') return 0.78;
  return 0.72 + (depth * 0.22);
};

const makeSeat = ({ x, y, rotation, depth, side, chairX, chairY, chairLean = 0 }) => ({
  x,
  y,
  rotation,
  depth,
  side,
  chair: {
    x: chairX,
    y: chairY,
    rotation: chairLean,
    depth,
    side,
  },
});

const buildRectangularSeats = (geometry, type, view) => {
  const { cx, cy, topW, topH } = geometry;
  const isMain = view === 'main';

  // 10 puestos: 4 + 4 en los lados largos y 1 + 1 en las cabeceras.
  // Así cada silla queda alineada con un puesto real y nunca aparece flotando
  // entre dos servicios.
  const longSideCount = Math.max(1, Math.floor((type.seats - 2) / 2));
  const remainder = Math.max(0, type.seats - (longSideCount * 2));
  const headCount = remainder >= 2 ? 1 : 0;
  const footCount = remainder >= 1 ? 1 : 0;

  const topY = cy - topH * (isMain ? 0.25 : 0.39);
  const bottomY = cy + topH * (isMain ? 0.25 : 0.39);
  const leftX = cx - topW * (isMain ? 0.43 : 0.47);
  const rightX = cx + topW * (isMain ? 0.43 : 0.47);
  const longXs = spread(longSideCount, cx - topW * 0.34, cx + topW * 0.34);

  const backChairY = cy - topH * (isMain ? 1.10 : 0.72);
  const frontChairY = cy + topH * (isMain ? 1.27 : 0.72);
  const sideChairOffset = topW * (isMain ? 0.62 : 0.61);

  const seats = [];
  longXs.forEach((x) => {
    seats.push(makeSeat({
      x,
      y: topY,
      rotation: 0,
      depth: 0.18,
      side: 'back',
      chairX: x,
      chairY: backChairY,
      chairLean: 0,
    }));
  });

  longXs.forEach((x) => {
    seats.push(makeSeat({
      x,
      y: bottomY,
      rotation: 180,
      depth: 0.92,
      side: 'front',
      chairX: x,
      chairY: frontChairY,
      chairLean: 0,
    }));
  });

  if (headCount) {
    seats.push(makeSeat({
      x: leftX,
      y: cy,
      rotation: 90,
      depth: 0.58,
      side: 'front',
      chairX: cx - sideChairOffset,
      chairY: cy + (isMain ? topH * 0.12 : 0),
      chairLean: -5,
    }));
  }

  if (footCount) {
    seats.push(makeSeat({
      x: rightX,
      y: cy,
      rotation: -90,
      depth: 0.58,
      side: 'front',
      chairX: cx + sideChairOffset,
      chairY: cy + (isMain ? topH * 0.12 : 0),
      chairLean: 5,
    }));
  }

  return seats;
};

const buildSquareSeats = (geometry, type, view) => {
  const { cx, cy, topW, topH } = geometry;
  const isMain = view === 'main';
  const perSide = Math.max(1, Math.floor(type.seats / 4));
  const xs = spread(perSide, cx - topW * 0.24, cx + topW * 0.24);
  const ys = spread(perSide, cy - topH * 0.24, cy + topH * 0.24);

  const topY = cy - topH * (isMain ? 0.28 : 0.42);
  const bottomY = cy + topH * (isMain ? 0.28 : 0.42);
  const leftX = cx - topW * (isMain ? 0.44 : 0.45);
  const rightX = cx + topW * (isMain ? 0.44 : 0.45);

  const seats = [];
  xs.forEach((x) => seats.push(makeSeat({
    x,
    y: topY,
    rotation: 0,
    depth: 0.18,
    side: 'back',
    chairX: x,
    chairY: cy - topH * (isMain ? 1.12 : 0.70),
    chairLean: 0,
  })));
  xs.forEach((x) => seats.push(makeSeat({
    x,
    y: bottomY,
    rotation: 180,
    depth: 0.92,
    side: 'front',
    chairX: x,
    chairY: cy + topH * (isMain ? 1.28 : 0.70),
    chairLean: 0,
  })));
  ys.forEach((y) => seats.push(makeSeat({
    x: leftX,
    y,
    rotation: 90,
    depth: 0.56,
    side: 'front',
    chairX: cx - topW * (isMain ? 0.66 : 0.66),
    chairY: y + (isMain ? topH * 0.10 : 0),
    chairLean: -5,
  })));
  ys.forEach((y) => seats.push(makeSeat({
    x: rightX,
    y,
    rotation: -90,
    depth: 0.56,
    side: 'front',
    chairX: cx + topW * (isMain ? 0.66 : 0.66),
    chairY: y + (isMain ? topH * 0.10 : 0),
    chairLean: 5,
  })));

  return seats.slice(0, type.seats);
};

const buildRoundSeats = (geometry, type, view) => {
  const { cx, cy, topW, topH } = geometry;
  const isMain = view === 'main';
  const seatRx = topW * 0.40;
  const seatRy = topH * (isMain ? 0.34 : 0.39);
  const chairRx = topW * (isMain ? 0.62 : 0.64);
  const chairRy = topH * (isMain ? 1.22 : 0.69);

  return Array.from({ length: type.seats }, (_, index) => {
    const angle = ((Math.PI * 2) / type.seats) * index - Math.PI / 2;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const depth = (sin + 1) / 2;
    const side = depth > 0.54 ? 'front' : 'back';

    // El servicio rota radialmente; la foto de la silla NO rota 90/180 grados.
    // Solo aplicamos una leve inclinación visual para conservar sensación de arco.
    const chairLean = Math.max(-7, Math.min(7, cos * 7));

    return makeSeat({
      x: cx + cos * seatRx,
      y: cy + sin * seatRy,
      rotation: (angle * 180 / Math.PI) + 90,
      depth,
      side,
      chairX: cx + cos * chairRx,
      chairY: cy + sin * chairRy,
      chairLean,
    });
  });
};

export const buildSceneModel = (type, width, height, view = 'main') => {
  const isMain = view === 'main';
  const cx = width * 0.5;
  const cy = isMain ? height * 0.49 : height * 0.5;

  const geometry = type.id === 'rect'
    ? { shape: 'rect', cx, cy, topW: width * 0.60, topH: isMain ? height * 0.19 : height * 0.42, skirtH: height * 0.27 }
    : type.id === 'square'
      ? { shape: 'square', cx, cy, topW: width * 0.45, topH: isMain ? height * 0.20 : height * 0.45, skirtH: height * 0.27 }
      : { shape: 'ellipse', cx, cy, topW: width * 0.58, topH: isMain ? height * 0.20 : height * 0.48, skirtH: height * 0.27 };

  const seats = type.id === 'rect'
    ? buildRectangularSeats(geometry, type, view)
    : type.id === 'square'
      ? buildSquareSeats(geometry, type, view)
      : buildRoundSeats(geometry, type, view);

  const chairs = seats.map((seat) => ({
    ...seat.chair,
    scale: chairScaleFromDepth(seat.depth, view),
  }));

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
