import { Router } from 'express';
import { getStateSnapshot, updateStateSnapshot } from '../storage/fileStateStore.js';
import { getWebBridge } from '../../src/services/webBridge.js';

const router = Router();
const internalKey = String(process.env.APP_INTERNAL_KEY ?? '').trim();
router.get('/__copetin_db/inventory/edit/:kind/:id', async (req, res, next) => {
  if (internalKey && req.get('X-App-Internal-Key') !== internalKey) return res.status(403).json({ error: 'Clave interna inválida.' });
  if (!['item', 'combo'].includes(req.params.kind)) return res.status(400).json({ error: 'Tipo de inventario inválido.' });
  try {
    const snapshot = await getStateSnapshot();
    const collection = req.params.kind === 'combo' ? 'inventoryCombos' : 'items';
    const record = (snapshot?.state?.[collection] ?? []).find(row => row.id === req.params.id && !row.deletedAt);
    if (!record) return res.status(404).json({ error: 'El producto o combo ya no existe.' });
    res.set('Cache-Control', 'no-store').json({ id: record.id, updatedAt: record.updatedAt ?? null });
  } catch (error) { next(error); }
});
router.post('/__copetin_db/inventory/edit/:kind/:id', async (req, res, next) => {
  if (internalKey && req.get('X-App-Internal-Key') !== internalKey) return res.status(403).json({ error: 'Clave interna inválida.' });
  const combo = req.params.kind === 'combo';
  if (!['item', 'combo'].includes(req.params.kind)) return res.status(400).json({ error: 'Tipo de inventario inválido.' });
  const collection = combo ? 'inventoryCombos' : 'items';
  try {
    let record;
    const result = await updateStateSnapshot(async state => {
      const current = (state[collection] ?? []).find(row => row.id === req.params.id && !row.deletedAt);
      if (!current) throw Object.assign(new Error('El producto o combo ya no existe.'), { statusCode: 404 });
      if (req.body.expectedUpdatedAt !== undefined && String(req.body.expectedUpdatedAt ?? '') !== String(current.updatedAt ?? '')) {
        throw Object.assign(new Error('Este producto o combo cambió en otra sesión. Vuelve a abrirlo antes de guardar.'), { statusCode: 409 });
      }
      const bridge = getWebBridge();
      await bridge.__storage.beginBatch(state);
      try {
        record = await bridge.inventory[combo ? 'updateCombo' : 'update']({ ...req.body, id: req.params.id });
        return await bridge.__storage.commitBatch();
      } catch (error) {
        await bridge.__storage.rollbackBatch();
        error.statusCode ??= 400;
        throw error;
      }
    }, undefined, { cloneCollections: [collection, 'categories', 'systemAuditLog'] });
    if (!result.initialized) return res.status(404).json({ error: 'La base aún no está inicializada.' });
    res.json({ ok: true, record, revision: result.revision });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});
export default router;
