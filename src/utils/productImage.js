const PRODUCT_IMAGE_FIELDS = ['imageUrl', 'imageDataUrl', 'image', 'photo', 'thumbnailUrl'];

export const getProductImageSrc = (item) => {
  if (!item || typeof item !== 'object') return '';

  for (const field of PRODUCT_IMAGE_FIELDS) {
    const value = item[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return '';
};
