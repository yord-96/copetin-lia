import { Router } from 'express';
import { getStateMeta, getStateSnapshot, replaceStateSnapshot } from '../db/stateStore.js';

const router = Router();

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
      res.status(400).json({ error: 'El estado debe enviarse como objeto JSON.' });
      return;
    }

    res.json(await replaceStateSnapshot(req.body));
  } catch (error) {
    next(error);
  }
});

export default router;
