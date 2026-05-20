import { Router } from 'express';
import { getStateMeta, getStateSnapshot, replaceStateSnapshot } from '../storage/fileStateStore.js';

const router = Router();
const internalKey = String(process.env.APP_INTERNAL_KEY ?? '').trim();

const requireInternalKey = (req, res, next) => {
  if (!internalKey) {
    next();
    return;
  }

  const providedKey = String(req.get('X-App-Internal-Key') ?? '').trim();
  if (!providedKey) {
    res.status(401).json({ error: 'Clave interna requerida.' });
    return;
  }
  if (providedKey !== internalKey) {
    res.status(403).json({ error: 'Clave interna invalida.' });
    return;
  }
  next();
};

router.use('/__copetin_db', requireInternalKey);

router.get('/__copetin_db', async (req, res, next) => {
  try {
    if (req.query.meta === '1') {
      res.json(await getStateMeta());
      return;
    }

    res.json(await getStateSnapshot());
  } catch (error) {
    next(error);
  }
});

router.put('/__copetin_db', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'La solicitud debe enviarse como objeto JSON.' });
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(req.body, 'revision')) {
      res.status(400).json({ error: 'Debes enviar la revision actual para guardar el estado.' });
      return;
    }

    if (!req.body.state || typeof req.body.state !== 'object' || Array.isArray(req.body.state)) {
      res.status(400).json({ error: 'El estado debe enviarse como objeto JSON en el campo state.' });
      return;
    }

    res.json(await replaceStateSnapshot(req.body.state, req.body.revision));
  } catch (error) {
    if (error?.code === 'STATE_REVISION_CONFLICT') {
      res.status(409).json({
        error: 'Los datos fueron actualizados por otro usuario. Recarga la pagina antes de continuar.',
        currentRevision: error.currentRevision,
        providedRevision: error.providedRevision,
        version: error.version,
        updatedAt: error.updatedAt,
      });
      return;
    }

    next(error);
  }
});

export default router;
