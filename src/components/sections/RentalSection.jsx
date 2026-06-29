import { useMemo, useState } from 'react';
import { getProductImageSrc } from '../../utils/productImage';
import ProductImage from '../common/ProductImage';

function RentalSection({
  rentalForm,
  setRentalForm,
  rentalLines,
  rentalSearch,
  setRentalSearch,
  filteredRentalItems,
  addItemToRental,
  setRentalItemQty,
  increaseRentalItemQty,
  decreaseRentalItemQty,
  removeRentalItem,
  setImagePreview,
  items,
  formatBs,
  rentalSubtotal,
  rentalTotalPreview,
  handleCreateRental,
}) {
  const CATALOG_PAGE_SIZE = 6;
  const [catalogCategory, setCatalogCategory] = useState('all');
  const [catalogSort, setCatalogSort] = useState('name-asc');
  const [catalogPage, setCatalogPage] = useState(1);

  const selectedLines = useMemo(
    () =>
      rentalLines
        .map((line) => {
          const item = items.find((entry) => entry.id === line.itemId);
          if (!item) {
            return null;
          }
          return {
            ...line,
            item,
            quantityNumber: Number.parseInt(line.quantity, 10) || 1,
          };
        })
        .filter(Boolean),
    [items, rentalLines],
  );

  const catalogCategories = useMemo(() => {
    const unique = new Set(filteredRentalItems.map((item) => item.category));
    return Array.from(unique).sort((a, b) => a.localeCompare(b, 'es'));
  }, [filteredRentalItems]);

  const catalogFilteredItems = useMemo(() => {
    const byCategory =
      catalogCategory === 'all'
        ? filteredRentalItems
        : filteredRentalItems.filter((item) => item.category === catalogCategory);

    const sorted = [...byCategory];
    sorted.sort((a, b) => {
      if (catalogSort === 'name-desc') {
        return b.name.localeCompare(a.name, 'es');
      }
      if (catalogSort === 'price-asc') {
        return a.rentalPriceBs - b.rentalPriceBs;
      }
      if (catalogSort === 'price-desc') {
        return b.rentalPriceBs - a.rentalPriceBs;
      }
      return a.name.localeCompare(b.name, 'es');
    });

    return sorted;
  }, [catalogCategory, catalogSort, filteredRentalItems]);

  const catalogTotalPages = Math.max(1, Math.ceil(catalogFilteredItems.length / CATALOG_PAGE_SIZE));
  const safeCatalogPage = Math.min(catalogPage, catalogTotalPages);

  const catalogPageItems = useMemo(() => {
    const start = (safeCatalogPage - 1) * CATALOG_PAGE_SIZE;
    return catalogFilteredItems.slice(start, start + CATALOG_PAGE_SIZE);
  }, [catalogFilteredItems, safeCatalogPage]);

  const catalogPageNumbers = useMemo(() => {
    if (catalogTotalPages <= 5) {
      return Array.from({ length: catalogTotalPages }, (_, index) => index + 1);
    }
    const pages = [1];
    const from = Math.max(2, safeCatalogPage - 1);
    const to = Math.min(catalogTotalPages - 1, safeCatalogPage + 1);
    for (let page = from; page <= to; page += 1) {
      pages.push(page);
    }
    if (!pages.includes(catalogTotalPages)) {
      pages.push(catalogTotalPages);
    }
    return pages;
  }, [safeCatalogPage, catalogTotalPages]);

  const paymentMode = rentalForm.paymentMode ?? 'sin_pago';
  const rawPaidInput = Number.parseFloat(rentalForm.paidAtRentalBs ?? '0');
  const paidAtRentalPreview =
    paymentMode === 'sin_pago'
      ? 0
      : Number.isFinite(rawPaidInput)
      ? Math.max(0, rawPaidInput)
      : 0;
  const pendingPaymentPreview = Math.max(0, Number(rentalTotalPreview) - paidAtRentalPreview);
  const overpaidPreview = Math.max(0, paidAtRentalPreview - Number(rentalTotalPreview));

  return (
    <section className="panel rental-panel">
      <form onSubmit={handleCreateRental} className="rental-layout">
        <div className="rental-main-grid">
          <article className="rental-v2-card rental-v2-left">
            <header className="rental-v2-titlebar">
              <h2>Registrar Alquiler</h2>
              <p>Datos del cliente y condiciones del prestamo.</p>
            </header>

            <div className="rental-v2-form-grid">
              <label>
                Cliente
                <input
                  value={rentalForm.customerName}
                  onChange={(event) => setRentalForm((current) => ({ ...current, customerName: event.target.value }))}
                  required
                />
              </label>
              <label>
                Celular
                <input
                  value={rentalForm.customerPhone}
                  onChange={(event) => setRentalForm((current) => ({ ...current, customerPhone: event.target.value }))}
                  placeholder="Ej. 75740080"
                  required
                />
              </label>
              <label>
                Fecha Alquiler
                <input type="date" value={rentalForm.rentalDate} readOnly />
              </label>
              <label>
                Fecha Devolucion
                <input
                  type="date"
                  value={rentalForm.dueDate}
                  onChange={(event) => setRentalForm((current) => ({ ...current, dueDate: event.target.value }))}
                  required
                />
              </label>
              <label>
                Hora Maxima
                <input
                  type="time"
                  value={rentalForm.dueTime}
                  onChange={(event) => setRentalForm((current) => ({ ...current, dueTime: event.target.value }))}
                  required
                />
              </label>
              <label>
                Garantia (Bs)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={rentalForm.depositBs}
                  onChange={(event) => setRentalForm((current) => ({ ...current, depositBs: event.target.value }))}
                  required
                />
              </label>
              <label>
                Estado de pago
                <select
                  value={paymentMode}
                  onChange={(event) => {
                    const nextMode = event.target.value;
                    setRentalForm((current) => ({
                      ...current,
                      paymentMode: nextMode,
                      paidAtRentalBs:
                        nextMode === 'cancelado'
                          ? (Number(current.paidAtRentalBs) > 0 ? current.paidAtRentalBs : String(rentalTotalPreview))
                          : nextMode === 'sin_pago'
                          ? '0'
                          : current.paidAtRentalBs,
                    }));
                  }}
                >
                  <option value="sin_pago">No deja a cuenta</option>
                  <option value="a_cuenta">Deja a cuenta</option>
                  <option value="cancelado">Cancela todo</option>
                </select>
              </label>

              <label>
                Pago inicial (Bs)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={rentalForm.paidAtRentalBs}
                  onChange={(event) =>
                    setRentalForm((current) => ({ ...current, paidAtRentalBs: event.target.value }))
                  }
                  readOnly={paymentMode === 'sin_pago'}
                  required={paymentMode !== 'sin_pago'}
                />
              </label>
            </div>

            <label className="rental-v2-id-card">
              <input
                type="checkbox"
                checked={rentalForm.idCardHeld}
                onChange={(event) => setRentalForm((current) => ({ ...current, idCardHeld: event.target.checked }))}
              />
              <span>{rentalForm.idCardHeld ? 'Se dejo carnet de identidad en garantia.' : 'No se dejo carnet de identidad.'}</span>
            </label>

            <footer className="rental-v2-left-summary">
              <div className="totals rental-v2-totals">
                <p>Subtotal: {formatBs(rentalSubtotal)}</p>
                <p>Total alquiler: {formatBs(rentalTotalPreview)}</p>
                <p>Pagado al prestar: {formatBs(paidAtRentalPreview)}</p>
                <p>Saldo pendiente: {formatBs(pendingPaymentPreview)}</p>
                {overpaidPreview > 0 ? <p>Saldo a favor: {formatBs(overpaidPreview)}</p> : null}
              </div>

              <button type="submit" className="primary-button rental-v2-submit">
                Registrar Alquiler
              </button>
            </footer>
          </article>

          <article className="rental-v2-card rental-v2-right">
            <header className="rental-v2-catalog-header">
              <h3>Catalogo para Alquilar</h3>
              <div className="rental-v2-search">
                <input
                  value={rentalSearch}
                  onChange={(event) => {
                    setRentalSearch(event.target.value);
                    setCatalogPage(1);
                  }}
                  placeholder="Buscar item por nombre o categoria"
                />
              </div>
            </header>

            <div className="rental-v2-toolbar">
              <label>
                Filtrar por categoria
                <select
                  value={catalogCategory}
                  onChange={(event) => {
                    setCatalogCategory(event.target.value);
                    setCatalogPage(1);
                  }}
                >
                  <option value="all">Todas</option>
                  {catalogCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Ordenar por
                <select
                  value={catalogSort}
                  onChange={(event) => {
                    setCatalogSort(event.target.value);
                    setCatalogPage(1);
                  }}
                >
                  <option value="name-asc">Nombre A-Z</option>
                  <option value="name-desc">Nombre Z-A</option>
                  <option value="price-asc">Precio menor</option>
                  <option value="price-desc">Precio mayor</option>
                </select>
              </label>
            </div>

            <div className="rental-v2-gallery">
              {catalogPageItems.map((item) => (
                <article key={item.id} className="rental-v2-item-card">
                  <button
                    type="button"
                    className="rental-v2-item-image"
                    onClick={() =>
                      getProductImageSrc(item)
                      && setImagePreview({ url: getProductImageSrc(item), name: item.name })
                    }
                  >
                    {getProductImageSrc(item) ? (
                      <ProductImage item={item} alt={`Imagen de ${item.name}`} fallback={<span>Sin imagen</span>} />
                    ) : (
                      <span>Sin imagen</span>
                    )}
                  </button>

                  <div className="rental-v2-item-body">
                    <h4>{item.name}</h4>
                    <p>{item.category}</p>
                    <small>
                      Disponibles: {item.availableStock} | {formatBs(item.rentalPriceBs)}
                    </small>
                  </div>

                  <button type="button" className="primary-button rental-v2-add-btn" onClick={() => addItemToRental(item.id)}>
                    Agregar
                  </button>
                </article>
              ))}

              {catalogPageItems.length === 0 && (
                <p className="rental-v2-empty">No hay items que coincidan con la busqueda.</p>
              )}
            </div>

            <div className="rental-v2-pager">
              <button
                type="button"
                className="ghost-button rental-v2-page-btn"
                onClick={() => setCatalogPage((current) => Math.max(1, current - 1))}
                disabled={safeCatalogPage === 1}
              >
                {'<'}
              </button>

              {catalogPageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  className={`ghost-button rental-v2-page-btn ${safeCatalogPage === pageNumber ? 'active' : ''}`}
                  onClick={() => setCatalogPage(pageNumber)}
                >
                  {pageNumber}
                </button>
              ))}

              <button
                type="button"
                className="ghost-button rental-v2-page-btn"
                onClick={() => setCatalogPage((current) => Math.min(catalogTotalPages, current + 1))}
                disabled={safeCatalogPage === catalogTotalPages}
              >
                {'>'}
              </button>
            </div>

            <section className="rental-v2-selected">
              <h4>Items Seleccionados</h4>
              {selectedLines.length === 0 ? (
                <p className="rental-v2-empty">Aun no agregaste items al alquiler.</p>
              ) : (
                <div className="rental-v2-selected-list">
                  {selectedLines.map((line) => (
                    <div key={line.itemId} className="rental-v2-selected-row">
                      <button
                        type="button"
                        className="rental-v2-selected-thumb"
                        onClick={() =>
                          getProductImageSrc(line.item)
                          && setImagePreview({ url: getProductImageSrc(line.item), name: line.item.name })
                        }
                      >
                        {getProductImageSrc(line.item) ? (
                          <ProductImage
                            item={line.item}
                            alt={`Imagen de ${line.item.name}`}
                            fallback={<span>Sin imagen</span>}
                          />
                        ) : (
                          <span>Sin imagen</span>
                        )}
                      </button>

                      <div className="rental-v2-selected-meta">
                        <strong>{line.item.name}</strong>
                        <p>
                          {line.item.category} | {formatBs(line.item.rentalPriceBs)}
                        </p>
                      </div>

                      <div className="rental-v2-qty">
                        <button type="button" onClick={() => decreaseRentalItemQty(line.itemId)}>
                          -
                        </button>
                        <input
                          type="number"
                          min="1"
                          max={line.item.availableStock}
                          value={line.quantity}
                          onChange={(event) => setRentalItemQty(line.itemId, event.target.value)}
                        />
                        <button type="button" onClick={() => increaseRentalItemQty(line.itemId)}>
                          +
                        </button>
                      </div>

                      <p className="rental-v2-line-total">{formatBs(line.quantityNumber * line.item.rentalPriceBs)}</p>

                      <button
                        type="button"
                        className="danger-button rental-v2-remove-btn"
                        onClick={() => removeRentalItem(line.itemId)}
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </article>
        </div>
      </form>
    </section>
  );
}

export default RentalSection;
