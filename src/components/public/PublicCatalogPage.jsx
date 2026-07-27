import { useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 72;

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const formatUnits = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0 u.';
  return `${Math.max(0, Math.trunc(number)).toLocaleString('es-BO')} u.`;
};

const PUBLIC_CATALOG_ENDPOINTS = ['/__copetin_db/public/catalog', '/api/public/catalog'];

function PublicCatalogImage({ item }) {
  const [failed, setFailed] = useState(false);

  if (!item.imageUrl || failed) {
    return (
      <div className="public-catalog-card-placeholder" aria-label="Producto sin foto">
        El Copetin
      </div>
    );
  }

  return <img src={item.imageUrl} alt={item.name} loading="lazy" onError={() => setFailed(true)} />;
}

export default function PublicCatalogPage() {
  const [catalog, setCatalog] = useState({ products: [], categories: [], areas: [] });
  const [query, setQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [status, setStatus] = useState({ loading: true, error: '' });

  useEffect(() => {
    let active = true;

    const loadCatalog = async () => {
      try {
        let payload = null;
        let lastError = null;

        for (const endpoint of PUBLIC_CATALOG_ENDPOINTS) {
          try {
            const response = await fetch(endpoint, {
              headers: { Accept: 'application/json' },
            });
            const contentType = response.headers.get('content-type') || '';
            if (!response.ok || !contentType.includes('application/json')) {
              throw new Error(`Respuesta invalida de ${endpoint}`);
            }
            payload = await response.json();
            break;
          } catch (error) {
            lastError = error;
          }
        }

        if (!payload) {
          throw lastError || new Error('No se pudo cargar el catalogo.');
        }

        if (!active) return;
        setCatalog({
          products: Array.isArray(payload.products) ? payload.products : [],
          categories: Array.isArray(payload.categories) ? payload.categories : [],
          areas: Array.isArray(payload.areas) ? payload.areas : [],
          updatedAt: payload.updatedAt,
        });
        setStatus({ loading: false, error: '' });
      } catch (error) {
        if (!active) return;
        setStatus({ loading: false, error: error.message || 'No se pudo cargar el catalogo.' });
      }
    };

    loadCatalog();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, areaFilter, categoryFilter]);

  const filteredProducts = useMemo(() => {
    const tokens = normalizeText(query).split(/\s+/).filter(Boolean);

    return catalog.products.filter((item) => {
      if (areaFilter !== 'all' && item.area !== areaFilter) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (!tokens.length) return true;
      const searchText = item.searchText || normalizeText([
        item.name,
        item.category,
        item.color,
        item.material,
        item.sku,
        item.areaLabel,
      ].join(' '));
      return tokens.every((token) => searchText.includes(token));
    });
  }, [areaFilter, catalog.products, categoryFilter, query]);

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const hasMore = visibleCount < filteredProducts.length;

  return (
    <main className="public-catalog-page">
      <section className="public-catalog-hero">
        <div className="public-catalog-hero-copy">
          <span>El Copetin</span>
          <h1>Catalogo de alquiler para eventos</h1>
          <p>Cristaleria, manteleria y mobiliario para revisar antes de cotizar. La disponibilidad se confirma por fecha.</p>
        </div>
      </section>

      <section className="public-catalog-toolbar" aria-label="Filtros del catalogo">
        <label>
          <span>Buscar</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar producto, categoria, color, material o codigo..."
          />
        </label>
        <label>
          <span>Area</span>
          <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
            <option value="all">Todas las areas</option>
            {catalog.areas.map((area) => (
              <option key={area.id} value={area.id}>{area.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Categoria</span>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">Todas las categorias</option>
            {catalog.categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="public-catalog-summary" aria-live="polite">
        <strong>{filteredProducts.length.toLocaleString('es-BO')}</strong>
        <span>productos visibles</span>
        <em>Solo consulta publica. Para reservar, confirma disponibilidad con El Copetin.</em>
      </section>

      {status.loading ? (
        <div className="public-catalog-state">Cargando catalogo...</div>
      ) : status.error ? (
        <div className="public-catalog-state public-catalog-state--error">{status.error}</div>
      ) : visibleProducts.length ? (
        <>
          <section className="public-catalog-grid" aria-label="Productos del catalogo">
            {visibleProducts.map((item) => (
              <article className="public-catalog-card" key={item.id}>
                <div className="public-catalog-card-image">
                  <PublicCatalogImage item={item} />
                </div>
                <div className="public-catalog-card-body">
                  <span className="public-catalog-card-area">{item.areaLabel || item.category || 'Catalogo'}</span>
                  <h2>{item.name}</h2>
                  <p>
                    {[item.category, item.color, item.material].filter(Boolean).join(' - ') || 'Disponible para eventos'}
                  </p>
                  <div className="public-catalog-card-meta">
                    <span>{formatUnits(item.totalStock)}</span>
                    <small>Cod. {item.sku}</small>
                  </div>
                </div>
              </article>
            ))}
          </section>

          {hasMore ? (
            <div className="public-catalog-more">
              <button type="button" onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}>
                Ver mas productos
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="public-catalog-state">No hay productos con esos filtros.</div>
      )}
    </main>
  );
}
