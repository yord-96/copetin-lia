import { getProductImageSrc } from '../../utils/productImage';
import ProductImage from '../common/ProductImage';

function InventorySection({
  editingInventoryId,
  inventoryForm,
  setInventoryForm,
  categories,
  inventoryImageInputRef,
  handleInventoryImageChange,
  handleInventorySubmit,
  handleStartInventoryEdit,
  handleCancelInventoryEdit,
  handleDeleteInventoryItem,
  setImagePreview,
  items,
  formatBs,
}) {
  const isEditing = Boolean(editingInventoryId);
  const isCleaningForcedByCategory = String(inventoryForm.category ?? '').toLowerCase().includes('manteleria');

  return (
    <section className="panel inventory-panel">
      <article className="form-card inventory-form-card">
        <h2>{isEditing ? 'Editar Item' : 'Nuevo Item (Catalogo)'}</h2>
        <form onSubmit={handleInventorySubmit} className="form-grid inventory-form-grid">
          <label className="full-width">
            Nombre
            <input
              value={inventoryForm.name}
              onChange={(event) => setInventoryForm((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>

          <label className="full-width">
            Categoria
            <select
              value={inventoryForm.category}
              onChange={(event) =>
                setInventoryForm((current) => ({
                  ...current,
                  category: event.target.value,
                  needsCleaningOnReturn:
                    String(event.target.value ?? '').toLowerCase().includes('manteleria')
                      ? true
                      : current.needsCleaningOnReturn,
                }))
              }
              required
            >
              {categories.length === 0 && <option value="">No hay categorias</option>}
              {categories.map((category) => (
                <option key={category.id} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="full-width">
            Imagen del item
            <input ref={inventoryImageInputRef} type="file" accept="image/*" onChange={handleInventoryImageChange} />
          </label>

          {getProductImageSrc(inventoryForm) && (
            <div className="full-width image-preview-box">
              <button
                type="button"
                className="image-preview-trigger"
                onClick={() =>
                  setImagePreview({
                    url: getProductImageSrc(inventoryForm),
                    name: inventoryForm.name || inventoryForm.imageFileName || 'Imagen',
                  })
                }
              >
                <ProductImage
                  item={inventoryForm}
                  alt="Vista previa del item"
                  fallback={<span className="image-missing">Sin imagen</span>}
                />
              </button>
              <p>{inventoryForm.imageFileName || 'Imagen seleccionada'}</p>
            </div>
          )}

          <label>
            Stock Total
            <input
              type="number"
              min="1"
              value={inventoryForm.totalStock}
              onChange={(event) => setInventoryForm((current) => ({ ...current, totalStock: event.target.value }))}
              required
            />
          </label>

          <label>
            Precio Unitario (Bs)
            <input
              type="number"
              min="0"
              step="0.01"
              value={inventoryForm.rentalPriceBs}
              onChange={(event) =>
                setInventoryForm((current) => ({ ...current, rentalPriceBs: event.target.value }))
              }
              required
            />
          </label>

          <label>
            Cargo Danio (Bs)
            <input
              type="number"
              min="0"
              step="0.01"
              value={inventoryForm.damagedUnitChargeBs}
              onChange={(event) =>
                setInventoryForm((current) => ({ ...current, damagedUnitChargeBs: event.target.value }))
              }
              required
            />
          </label>

          <label>
            Cargo Perdida (Bs)
            <input
              type="number"
              min="0"
              step="0.01"
              value={inventoryForm.missingUnitChargeBs}
              onChange={(event) =>
                setInventoryForm((current) => ({ ...current, missingUnitChargeBs: event.target.value }))
              }
              required
            />
          </label>

          <label className="switch full-width">
            <input
              type="checkbox"
              checked={Boolean(inventoryForm.needsCleaningOnReturn)}
              onChange={(event) =>
                setInventoryForm((current) => ({
                  ...current,
                  needsCleaningOnReturn: event.target.checked,
                }))
              }
              disabled={isCleaningForcedByCategory}
            />
            <span>
              Requiere lavado al devolver
              {isCleaningForcedByCategory ? ' (forzado por categoria Manteleria)' : ''}
            </span>
          </label>

          <div className="full-width inventory-form-actions">
            <button type="submit" className="primary-button inventory-save-button" disabled={categories.length === 0}>
              {isEditing ? 'Guardar Cambios' : '+ Guardar Item'}
            </button>
            {isEditing && (
              <button type="button" className="ghost-button inventory-cancel-button" onClick={handleCancelInventoryEdit}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </article>

      <article className="table-card inventory-table-card">
        <h2>Catalogo de Items</h2>
        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Imagen</th>
                <th>Item</th>
                <th>Categoria</th>
                <th>Disponible</th>
                <th>Total</th>
                <th>Precio</th>
                <th>Danio</th>
                <th>Perdida</th>
                <th>Post-Devolucion</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {getProductImageSrc(item) ? (
                      <button
                        type="button"
                        className="table-image-button"
                        onClick={() => setImagePreview({ url: getProductImageSrc(item), name: item.name })}
                      >
                        <ProductImage
                          item={item}
                          alt={`Imagen de ${item.name}`}
                          fallback={<span className="image-missing">Sin imagen</span>}
                        />
                      </button>
                    ) : (
                      <span className="image-missing">Sin imagen</span>
                    )}
                  </td>
                  <td>{item.name}</td>
                  <td>{item.category}</td>
                  <td>{item.availableStock}</td>
                  <td>{item.totalStock}</td>
                  <td>{formatBs(item.rentalPriceBs)}</td>
                  <td>{formatBs(item.damagedUnitChargeBs)}</td>
                  <td>{formatBs(item.missingUnitChargeBs)}</td>
                  <td>{item.needsCleaningOnReturn ? 'Lavado' : 'Disponible directo'}</td>
                  <td className="inventory-actions-cell">
                    <div className="inventory-row-actions">
                      <button type="button" className="ghost-button inventory-action-button" onClick={() => handleStartInventoryEdit(item)}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="danger-button inventory-action-button"
                        onClick={() => handleDeleteInventoryItem(item)}
                        disabled={item.availableStock < item.totalStock}
                        title={
                          item.availableStock < item.totalStock
                            ? 'No puedes eliminar un item con unidades no disponibles (alquiladas o en proceso).'
                            : 'Eliminar item'
                        }
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

export default InventorySection;
