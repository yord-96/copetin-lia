import { Router } from 'express';
import { getLincolnStateSnapshot, replaceLincolnStateSnapshot } from '../storage/lincolnStateStore.js';

const router = Router();
const internalKey = String(process.env.APP_INTERNAL_KEY ?? '').trim();

router.use('/__lincoln_db', (req, res, next) => {
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
});

router.get('/__lincoln_db', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getLincolnStateSnapshot());
  } catch (error) {
    next(error);
  }
});

router.put('/__lincoln_db', async (req, res, next) => {
  try {
    if (!req.body?.state || typeof req.body.state !== 'object' || Array.isArray(req.body.state)) {
      res.status(400).json({ error: 'Debes enviar un estado valido para Lincoln.' });
      return;
    }
    res.json(await replaceLincolnStateSnapshot(req.body.state, req.body.revision));
  } catch (error) {
    if (error?.statusCode === 409) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    next(error);
  }
});

export default router;
