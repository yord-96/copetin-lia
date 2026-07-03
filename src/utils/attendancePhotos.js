const MAX_ATTENDANCE_IMAGE_EDGE = 1280;
const ATTENDANCE_IMAGE_QUALITY = 0.8;
export const MAX_ATTENDANCE_PHOTO_BYTES = 1024 * 1024;

const canUseCanvas = () =>
  typeof document !== 'undefined'
  && typeof Image !== 'undefined'
  && typeof URL !== 'undefined';

const loadImage = (file) => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error('No se pudo procesar la foto seleccionada.'));
  };
  image.src = objectUrl;
});

const canvasToBlob = (canvas, mimeType, quality) => new Promise((resolve) => {
  canvas.toBlob(resolve, mimeType, quality);
});

const supportsWebp = () => {
  if (!canUseCanvas()) return false;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL('image/webp').startsWith('data:image/webp');
};

export const compressAttendanceImage = async (file) => {
  if (!(file instanceof File)) {
    throw new Error('Selecciona una foto valida.');
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecciona un archivo de imagen JPG, PNG o WEBP.');
  }
  if (!canUseCanvas()) {
    if (file.size > MAX_ATTENDANCE_PHOTO_BYTES) {
      throw new Error('La foto es demasiado pesada para subirla sin compresion.');
    }
    return {
      blob: file,
      previewUrl: URL.createObjectURL(file),
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      originalSizeBytes: file.size,
      width: null,
      height: null,
      durationMs: 0,
    };
  }

  const startedAt = performance.now();
  const image = await loadImage(file);
  const ratio = Math.min(1, MAX_ATTENDANCE_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('No se pudo preparar la compresion de la foto.');
  }
  context.drawImage(image, 0, 0, width, height);

  const preferredMime = supportsWebp() ? 'image/webp' : 'image/jpeg';
  let blob = await canvasToBlob(canvas, preferredMime, ATTENDANCE_IMAGE_QUALITY);
  if (!blob) {
    blob = await canvasToBlob(canvas, 'image/jpeg', ATTENDANCE_IMAGE_QUALITY);
  }
  if (!blob) {
    throw new Error('No se pudo comprimir la foto.');
  }
  if (blob.size > MAX_ATTENDANCE_PHOTO_BYTES) {
    const smaller = await canvasToBlob(canvas, preferredMime, 0.68);
    if (smaller) blob = smaller;
  }
  if (blob.size > MAX_ATTENDANCE_PHOTO_BYTES) {
    throw new Error('La foto sigue pesando mas de 1 MB. Intenta tomarla con menor resolucion.');
  }

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    mimeType: blob.type || preferredMime,
    sizeBytes: blob.size,
    originalSizeBytes: file.size,
    width,
    height,
    durationMs: Math.round(performance.now() - startedAt),
  };
};
