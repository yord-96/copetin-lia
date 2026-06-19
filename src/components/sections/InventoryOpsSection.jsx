import { useMemo, useState } from 'react';
import { getProductImageSrc } from '../../utils/productImage';
import ProductImage from '../common/ProductImage';

const formatDateTime = (value) => {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const toSafeQuantity = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

function InventoryOpsSection({
  items,
  activeRentals,
  stockRecoveries,
  inventoryMovements,
  stockMovementForm,
  setStockMovementForm,
  handleStockMovementSubmit,
  handleProcessRecovery,
  formatBs,
}) {
  const [recoverySearch, setRecoverySearch] = useState('');
  const [recoveryDrafts, setRecoveryDrafts] = useState({});
  const [processingRecoveryId, setProcessingRecoveryId] = useState('');

  const rentalUnitsByItem = useMemo(() => {
    const map = {};
    for (const rental of activeRentals) {
      for (const line of rental.items ?? []) {
        map[line.itemId] = (map[line.itemId] ?? 0) + Number(line.quantity ?? 0);
      }
    }
    return map;
  }, [activeRentals]);

  const recoveryByItem = useMemo(() => {
    const map = {};
    for (const recovery of stockRecoveries) {
      if (!map[recovery.itemId]) {
        map[recovery.itemId] = { lavado: 0, reparacion: 0 };
      }
      if (recovery.stage === 'lavado') {
        map[recovery.itemId].lavado += Number(recovery.quantity ?? 0);
      } else {
        map[recovery.itemId].reparacion += Number(recovery.quantity ?? 0);
      }
    }
    return map;
  }, [stockRecoveries]);

  const stockSummary = useMemo(() => {
    const totalUnits = items.reduce((sum, item) => sum + item.totalStock, 0);
    const availableUnits = items.reduce((sum, item) => sum + item.availableStock, 0);
    const rentedUnits = Object.values(rentalUnitsByItem).reduce((sum, value) => sum + Number(value ?? 0), 0);
    const cleaningUnits = stockRecoveries
      .filter((entry) => entry.stage === 'lavado')
      .reduce((sum, entry) => sum + Number(entry.quantity ?? 0), 0);
    const repairUnits = stockRecoveries
      .filter((entry) => entry.stage === 'reparacion')
      .reduce((sum, entry) => sum + Number(entry.quantity ?? 0), 0);
    const lowStockItems = items.filter(
      (item) => item.totalStock > 0 && item.availableStock / item.totalStock <= 0.2,
    ).length;

    return {
      totalUnits,
      availableUnits,
      rentedUnits,
      cleaningUnits,
      repairUnits,
      lowStockItems,
    };
  }, [items, rentalUnitsByItem, stockRecoveries]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === stockMovementForm.itemId) ?? null,
    [items, stockMovementForm.itemId],
  );

  const latestMovements = useMemo(() => inventoryMovements.slice(0, 25), [inventoryMovements]);

  const filteredRecoveries = useMemo(() => {
    const query = String(recoverySearch ?? '').trim().toLowerCase();
    if (!query) {
      return stockRecoveries;
    }

    return stockRecoveries.filter((entry) => {
      const stageLabel = entry.stage === 'lavado' ? 'lavado' : 'reparacion';
      return (
        String(entry.itemName ?? '').toLowerCase().includes(query)
        || String(entry.category ?? '').toLowerCase().includes(query)
        || String(entry.sourceCustomerName ?? '').toLowerCase().includes(query)
        || stageLabel.includes(query)
        || String(entry.note ?? '').toLowerCase().includes(query)
      );
    });
  }, [recoverySearch, stockRecoveries]);

  const updateRecoveryDraft = (recoveryId, field, value) => {
    setRecoveryDrafts((current) => ({
      ...current,
      [recoveryId]: {
        ...(current[recoveryId] ?? {}),
        [field]: value,
      },
    }));
  };

  const processRecovery = async (recovery, action) => {
    const currentDraft = recoveryDrafts[recovery.id] ?? {};
    const desiredQuantity = toSafeQuantity(currentDraft.quantity, Number(recovery.quantity ?? 1));
    const quantity = Math.min(Number(recovery.quantity ?? 1), desiredQuantity);
    const note = String(currentDraft.note ?? '').trim();

    setProcessingRecoveryId(`${recovery.id}:${action}`);
    try {
      await handleProcessRecovery({
        recoveryId: recovery.id,
        action,
        quantity,
        note,
      });

      setRecoveryDrafts((current) => {
        const next = { ...current };
        delete next[recovery.id];
        return next;
      });
    } catch {
      // El mensaje de error se maneja en el controlador central.
    } finally {
      setProcessingRecoveryId('');
    }
  };

  return (
    <section className="panel inventory-ops-panel">
      <div className="inventory-ops-cards">
        <article className="stat-card">
          <h2>Unidades Totales</h2>
          <p>{stockSummary.totalUnits}</p>
        </article>
        <article className="stat-card">
          <h2>Disponibles</h2>
          <p>{stockSummary.availableUnits}</p>
        </article>
        <article className="stat-card">
          <h2>Alquiladas</h2>
          <p>{stockSummary.rentedUnits}</p>
        </article>
        <article className="stat-card">
          <h2>En Lavado</h2>
          <p>{stockSummary.cleaningUnits}</p>
        </article>
        <article className="stat-card">
          <h2>En Reparacion</h2>
          <p>{stockSummary.repairUnits}</p>
        </article>
        <article className="stat-card">
          <h2>Items Bajo Stock</h2>
          <p>{stockSummary.lowStockItems}</p>
        </article>
      </div>

      <article className="inventory-ops-recovery-card">
        <div className="inventory-ops-recovery-head">
          <div>
            <h2>Reinsercion de Devueltos</h2>
            <p>Gestiona items en estado lavado o reparacion y decide si vuelven a disponibles o se dan de baja.</p>
          </div>
          <label className="inventory-ops-recovery-search">
            Buscar
            <input
              value={recoverySearch}
              onChange={(event) => setRecoverySearch(event.target.value)}
              placeholder="Item, categoria, cliente o estado"
            />
          </label>
        </div>

        {filteredRecoveries.length === 0 ? (
          <p className="inventory-ops-recovery-empty">No hay unidades pendientes de reinsercion.</p>
        ) : (
          <div className="inventory-ops-recovery-gallery">
            {filteredRecoveries.map((recovery) => {
              const draft = recoveryDrafts[recovery.id] ?? {};
              const quantityValue = draft.quantity ?? String(recovery.quantity);
              const isBusyReinsert = processingRecoveryId === `${recovery.id}:reinsert`;
              const isBusyDiscard = processingRecoveryId === `${recovery.id}:discard`;
              const stageLabel = recovery.stage === 'lavado' ? 'Lavando' : 'En reparacion';

              return (
                <article key={recovery.id} className="inventory-recovery-item">
                  <div className="inventory-recovery-media">
                    {getProductImageSrc(recovery) ? (
                      <ProductImage
                        item={recovery}
                        alt={`Imagen de ${recovery.itemName}`}
                        fallback={<span>Sin imagen</span>}
                      />
                    ) : (
                      <span>Sin imagen</span>
                    )}
                  </div>

                  <div className="inventory-recovery-body">
                    <header>
                      <h3>{recovery.itemName}</h3>
                      <span className={`inventory-recovery-stage stage-${recovery.stage}`}>{stageLabel}</span>
                    </header>
                    <p>{recovery.category}</p>
                    <small>Pendiente: {recovery.quantity} unidad(es)</small>
                    <small>Cliente: {recovery.sourceCustomerName || 'No registrado'}</small>
                    {recovery.note && <small>Nota: {recovery.note}</small>}
                    <small>Fecha: {formatDateTime(recovery.createdAt)}</small>
                  </div>

                  <div className="inventory-recovery-actions">
                    <label>
                      Cantidad
                      <input
                        type="number"
                        min="1"
                        max={recovery.quantity}
                        value={quantityValue}
                        onChange={(event) => updateRecoveryDraft(recovery.id, 'quantity', event.target.value)}
                      />
                    </label>
                    <label>
                      Observacion
                      <input
                        value={draft.note ?? ''}
                        onChange={(event) => updateRecoveryDraft(recovery.id, 'note', event.target.value)}
                        placeholder="Detalle opcional"
                      />
                    </label>

                    <div className="inventory-recovery-buttons">
                      <button
                        type="button"
                        className="primary-button"
                        disabled={Boolean(processingRecoveryId)}
                        onClick={() => processRecovery(recovery, 'reinsert')}
                      >
                        {isBusyReinsert
                          ? 'Procesando...'
                          : recovery.stage === 'lavado'
                          ? 'Terminar Lavado y Reinsertar'
                          : 'Reinsertar Reparado'}
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        disabled={Boolean(processingRecoveryId)}
                        onClick={() => processRecovery(recovery, 'discard')}
                      >
                        {isBusyDiscard ? 'Procesando...' : 'Dar de Baja Definitiva'}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </article>

      <div className="inventory-ops-grid">
        <article className="form-card inventory-ops-form-card">
          <h2>Registrar Movimiento</h2>
          <form onSubmit={handleStockMovementSubmit} className="form-grid inventory-ops-form">
            <label className="full-width">
              Item
              <select
                value={stockMovementForm.itemId}
                onChange={(event) =>
                  setStockMovementForm((current) => ({ ...current, itemId: event.target.value }))
                }
                required
              >
                {items.length === 0 && <option value="">No hay items</option>}
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.availableStock}/{item.totalStock})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Tipo
              <select
                value={stockMovementForm.type}
                onChange={(event) =>
                  setStockMovementForm((current) => ({ ...current, type: event.target.value }))
                }
              >
                <option value="entrada">Entrada</option>
                <option value="salida">Salida</option>
                <option value="ajuste">Ajuste por Conteo</option>
              </select>
            </label>

            {stockMovementForm.type === 'ajuste' ? (
              <label>
                Stock Fisico Real
                <input
                  type="number"
                  min="0"
                  value={stockMovementForm.targetTotalStock}
                  onChange={(event) =>
                    setStockMovementForm((current) => ({
                      ...current,
                      targetTotalStock: event.target.value,
                    }))
                  }
                  required
                />
              </label>
            ) : (
              <label>
                Cantidad
                <input
                  type="number"
                  min="1"
                  value={stockMovementForm.quantity}
                  onChange={(event) =>
                    setStockMovementForm((current) => ({ ...current, quantity: event.target.value }))
                  }
                  required
                />
              </label>
            )}

            {selectedItem && (
              <div className="full-width inventory-ops-hint">
                <strong>{selectedItem.name}</strong>
                <span>
                  Stock actual: {selectedItem.availableStock}/{selectedItem.totalStock}
                </span>
              </div>
            )}

            <label className="full-width">
              Motivo del Movimiento
              <textarea
                rows={3}
                value={stockMovementForm.reason}
                onChange={(event) =>
                  setStockMovementForm((current) => ({ ...current, reason: event.target.value }))
                }
                placeholder="Ej. reposicion de proveedor, baja por rotura, ajuste por conteo fisico."
                required
              />
            </label>

            <button type="submit" className="primary-button full-width">
              Registrar Movimiento
            </button>
          </form>
        </article>

        <article className="table-card inventory-ops-table-card">
          <h2>Kardex Reciente</h2>
          <div className="inventory-ops-table-wrap">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Item</th>
                  <th>Tipo</th>
                  <th>Detalle</th>
                  <th>Delta</th>
                  <th>Disp.</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {latestMovements.length === 0 ? (
                  <tr>
                    <td colSpan={7}>Aun no hay movimientos registrados.</td>
                  </tr>
                ) : (
                  latestMovements.map((movement) => (
                    <tr key={movement.id}>
                      <td>{formatDateTime(movement.createdAt)}</td>
                      <td>{movement.itemName}</td>
                      <td>
                        <span className={`movement-badge movement-${movement.type}`}>{movement.type}</span>
                      </td>
                      <td>{movement.reason}</td>
                      <td>{movement.deltaUnits > 0 ? `+${movement.deltaUnits}` : movement.deltaUnits}</td>
                      <td>
                        {movement.beforeAvailableStock} {'->'} {movement.afterAvailableStock}
                      </td>
                      <td>
                        {movement.beforeTotalStock} {'->'} {movement.afterTotalStock}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <article className="table-card inventory-ops-stock-card">
        <h2>Estado Actual de Stock</h2>
        <div className="inventory-ops-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Categoria</th>
                <th>Disponible</th>
                <th>Alquilado</th>
                <th>Lavado</th>
                <th>Reparacion</th>
                <th>No Operativo</th>
                <th>Total</th>
                <th>Precio</th>
                <th>Danio</th>
                <th>Perdida</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const itemRecoveries = recoveryByItem[item.id] ?? { lavado: 0, reparacion: 0 };
                const rented = Number(rentalUnitsByItem[item.id] ?? 0);
                const inCleaning = itemRecoveries.lavado;
                const inRepair = itemRecoveries.reparacion;
                const nonOperative = Math.max(
                  0,
                  item.totalStock - item.availableStock - rented - inCleaning - inRepair,
                );

                return (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.category}</td>
                    <td>{item.availableStock}</td>
                    <td>{rented}</td>
                    <td>{inCleaning}</td>
                    <td>{inRepair}</td>
                    <td>{nonOperative}</td>
                    <td>{item.totalStock}</td>
                    <td>{formatBs(item.rentalPriceBs)}</td>
                    <td>{formatBs(item.damagedUnitChargeBs)}</td>
                    <td>{formatBs(item.missingUnitChargeBs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

export default InventoryOpsSection;
