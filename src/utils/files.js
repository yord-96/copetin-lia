const MAX_IMAGE_EDGE = 960;
const IMAGE_QUALITY = 0.68;

const readRawFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
    reader.readAsDataURL(file);
  });

const loadImage = (dataUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo procesar la imagen seleccionada.'));
    image.src = dataUrl;
  });

const compressImageDataUrl = async (file, dataUrl) => {
  if (!file?.type?.startsWith('image/')) {
    return dataUrl;
  }

  const image = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height));
  if (scale >= 1 && file.size < 180 * 1024) {
    return dataUrl;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    return dataUrl;
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
};

export const readFileAsDataUrl = async (file) => {
  const dataUrl = await readRawFileAsDataUrl(file);
  try {
    return await compressImageDataUrl(file, dataUrl);
  } catch {
    return dataUrl;
  }
};
