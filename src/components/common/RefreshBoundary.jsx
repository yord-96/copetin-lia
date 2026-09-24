import { useEffect, useState } from 'react';

// El indicador reemplaza el contenido solo durante la carga inicial.
// Una sincronizacion posterior nunca debe desmontar formularios abiertos.
export default function RefreshBoundary({ loading, fallback, children }) {
  const [hasShownContent, setHasShownContent] = useState(!loading);

  useEffect(() => {
    if (loading || hasShownContent) return undefined;

    const timeoutId = window.setTimeout(() => {
      setHasShownContent(true);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loading, hasShownContent]);

  return loading && !hasShownContent ? fallback : children;
}
