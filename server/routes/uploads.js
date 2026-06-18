import { Router, raw } from 'express';
import {
  ensureProductUploadDirectory,
  saveProductImage,
} from '../storage/productImageStore.js';

const router = Router();
const internalKey = String(process.env.APP_INTERNAL_KEY ?? '').trim();
const maxImageBytes = Number(process.env.PRODUCT_IMAGE_MAX_BYTES ?? 8 * 1024 * 1024);

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

router.post(
  '/api/uploads/products',
  requireInternalKey,
  raw({
    type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
    limit: maxImageBytes,
  }),
  async (req, res, next) => {
    try {
      await ensureProductUploadDirectory();
      const result = await saveProductImage({
        buffer: req.body,
        declaredMime: String(req.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase(),
        itemId: req.get('X-Product-Id'),
      });
      res.status(201).json({
        ok: true,
        imageUrl: result.imageUrl,
        filename: result.filename,
        mimeType: result.mimeType,
        bytes: result.bytes,
      });
    } catch (error) {
      if (/imagen|archivo|contenido|tipo/i.test(error?.message ?? '')) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

export default router;
