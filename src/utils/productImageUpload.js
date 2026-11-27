export const PRODUCT_IMAGE_UPLOAD_MAX_BYTES = 650 * 1024;
const MAX_EDGE = 1280;

// Mantiene las imagenes fuera del JSON y limita cada carga por debajo de 1 MB.
export async function prepareProductImageUpload(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file?.type)) {
    throw new Error('Selecciona una imagen válida (JPG, PNG o WEBP).');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('No se pudo procesar la imagen. Selecciona otro archivo.'));
      element.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1 && file.size <= 180 * 1024) return file;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la imagen. Inténtalo desde otro navegador.');
    // WebP mantiene fondos transparentes y evita enviar PNG de varios megabytes.
    for (const edge of [MAX_EDGE, 960, 720]) {
      const resize = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * resize));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * resize));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.84, 0.72]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob && blob.size <= PRODUCT_IMAGE_UPLOAD_MAX_BYTES) {
          const extension = blob.type === 'image/webp' ? 'webp' : 'png';
          return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, { type: blob.type, lastModified: file.lastModified });
        }
      }
    }
    throw new Error('No se pudo reducir la imagen al tamaño de carga. Usa una foto de menor resolución.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
