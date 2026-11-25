import { Router } from 'express';
import { getStateSnapshot, updateStateSnapshot } from '../storage/fileStateStore.js';
import { canManageAccounting } from '../../src/utils/permissions.js';
import { buildVipWorkspace, mutateVipAccount, previewVipMerge, previewVipCutover, vipContractToken } from '../services/vipPrepaidWorkspace.js';

const router = Router();
router.post('/cutover-preview', async (req, res, next) => {
  try {
    const snapshot = await getStateSnapshot();
    if (!canManageAccounting((snapshot.state?.users || []).find(row => row.id === req.body.actorUserId))) return res.status(403).json({ error: 'No tienes permiso para administrar cuentas VIP.' });
    res.json(previewVipCutover(snapshot.state, req.body.clientId, req.body.cutoffDate, req.body.openingBs));
  } catch (error) { if (error.statusCode) res.status(error.statusCode).json({ error: error.message }); else next(error); }
});
const workspace = (state, clientId) => {
  const result = buildVipWorkspace(state, clientId);
  result.rows.forEach(row => { row.token = vipContractToken(state, row.id); });
  return result;
};
router.get('/workspace', async (req, res, next) => {
  try { const snapshot = await getStateSnapshot(); res.json(workspace(snapshot.state, String(req.query.clientId || ''))); }
  catch (error) { if (error.statusCode) res.status(error.statusCode).json({ error: error.message }); else next(error); }
});
router.post('/merge-preview', async (req, res, next) => {
  try { const snapshot = await getStateSnapshot(); res.json(previewVipMerge(snapshot.state, req.body.clientId, req.body.sourceIds)); }
  catch (error) { if (error.statusCode) res.status(error.statusCode).json({ error: error.message }); else next(error); }
});
router.post('/manage', async (req, res, next) => {
  try {
    let operation;
    const result = await updateStateSnapshot(state => {
      const actor = (state.users || []).find(row => row.id === req.body.actorUserId);
      if (!canManageAccounting(actor)) throw Object.assign(new Error('No tienes permiso para administrar cuentas VIP.'), { statusCode: 403 });
      operation = mutateVipAccount(state, req.body);
      return state;
    });
    res.json({ ok: true, ...operation, revision: result.revision, version: result.version, updatedAt: result.updatedAt });
  } catch (error) { if (error.statusCode) res.status(error.statusCode).json({ error: error.message }); else next(error); }
});
export default router;
