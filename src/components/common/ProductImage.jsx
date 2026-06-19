import { useState } from 'react';
import { getProductImageSrc } from '../../utils/productImage';

function ProductImage({ item, src, fallback = null, onError, ...imageProps }) {
  const resolvedSrc = typeof src === 'string' && src.trim() ? src.trim() : getProductImageSrc(item);
  const [failedSrc, setFailedSrc] = useState('');

  if (!resolvedSrc || failedSrc === resolvedSrc) return fallback;

  return (
    <img
      {...imageProps}
      src={resolvedSrc}
      onError={(event) => {
        setFailedSrc(resolvedSrc);
        onError?.(event);
      }}
    />
  );
}

export default ProductImage;
