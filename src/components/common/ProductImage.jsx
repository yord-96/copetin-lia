import { useState } from 'react';
import { getProductImageSrc } from '../../utils/productImage';

function ProductImage({ item, src, fallback = null, onError, loading = 'lazy', decoding = 'async', ...imageProps }) {
  const resolvedSrc = typeof src === 'string' && src.trim() ? src.trim() : getProductImageSrc(item);
  const [failedSrc, setFailedSrc] = useState('');

  if (!resolvedSrc || failedSrc === resolvedSrc) return fallback;

  return (
    <img
      {...imageProps}
      src={resolvedSrc}
      loading={loading}
      decoding={decoding}
      onError={(event) => {
        setFailedSrc(resolvedSrc);
        onError?.(event);
      }}
    />
  );
}

export default ProductImage;
