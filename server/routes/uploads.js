import { Router, raw } from 'express';
import {
  ensureProductUploadDirectory,
  saveProductImage,
} from '../storage/productImageStore.js';
import {
  ensureAttendanceUploadDirectory,
  saveAttendancePhoto,
} from '../storage/attendancePhotoStore.js';
import {
  deleteLincolnRoomImage,
  ensureLincolnRoomUploadDirectory,
  saveLincolnRoomImage,
} from '../storage/lincolnRoomImageStore.js';
import {
  deleteLincolnPackageImage,
  ensureLincolnPackageUploadDirectory,
  saveLincolnPackageImage,
} from '../storage/lincolnPackageImageStore.js';

const router = Router();
const internalKey = String(process.env.APP_INTERNAL_KEY ?? '').trim();
const maxImageBytes = Number(process.env.PRODUCT_IMAGE_MAX_BYTES ?? 8 * 1024 * 1024);
const maxAttendancePhotoBytes = Number(process.env.ATTENDANCE_PHOTO_MAX_BYTES ?? 1024 * 1024);
const maxLincolnRoomImageBytes = Number(process.env.LINCOLN_ROOM_IMAGE_MAX_BYTES ?? 8 * 1024 * 1024);
const maxLincolnPackageImageBytes = Number(process.env.LINCOLN_PACKAGE_IMAGE_MAX_BYTES ?? 8 * 1024 * 1024);

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

router.post(
  '/api/uploads/attendance',
  requireInternalKey,
  raw({
    type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
    limit: maxAttendancePhotoBytes,
  }),
  async (req, res, next) => {
    try {
      await ensureAttendanceUploadDirectory();
      const result = await saveAttendancePhoto({
        buffer: req.body,
        declaredMime: String(req.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase(),
        recordId: req.get('X-Attendance-Id'),
      });
      console.info('[copetin-upload] Foto de asistencia guardada.', {
        bytes: result.bytes,
        mimeType: result.mimeType,
        filename: result.filename,
      });
      res.status(201).json({
        ok: true,
        photoUrl: result.photoUrl,
        filename: result.filename,
        mimeType: result.mimeType,
        bytes: result.bytes,
      });
    } catch (error) {
      if (/imagen|foto|archivo|contenido|tipo/i.test(error?.message ?? '')) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);


router.post(
  '/api/uploads/lincoln/rooms',
  requireInternalKey,
  raw({
    type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
    limit: maxLincolnRoomImageBytes,
  }),
  async (req, res, next) => {
    try {
      await ensureLincolnRoomUploadDirectory();
      const result = await saveLincolnRoomImage({
        buffer: req.body,
        declaredMime: String(req.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase(),
        roomId: req.get('X-Lincoln-Room-Id'),
      });
      res.status(201).json({
        ok: true,
        imageUrl: result.imageUrl,
        filename: result.filename,
        mimeType: result.mimeType,
        bytes: result.bytes,
      });
    } catch (error) {
      if (/imagen|archivo|contenido|tipo|salón|salon/i.test(error?.message ?? '')) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

router.delete('/api/uploads/lincoln/rooms/:filename', requireInternalKey, async (req, res, next) => {
  try {
    res.json(await deleteLincolnRoomImage(req.params.filename));
  } catch (error) {
    if (/imagen|nombre|salón|salon/i.test(error?.message ?? '')) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});


router.post(
  '/api/uploads/lincoln/packages',
  requireInternalKey,
  raw({
    type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
    limit: maxLincolnPackageImageBytes,
  }),
  async (req, res, next) => {
    try {
      await ensureLincolnPackageUploadDirectory();
      const result = await saveLincolnPackageImage({
        buffer: req.body,
        declaredMime: String(req.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase(),
        packageId: req.get('X-Lincoln-Package-Id'),
      });
      res.status(201).json({
        ok: true,
        imageUrl: result.imageUrl,
        filename: result.filename,
        mimeType: result.mimeType,
        bytes: result.bytes,
      });
    } catch (error) {
      if (/imagen|archivo|contenido|tipo|paquete/i.test(error?.message ?? '')) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

router.delete('/api/uploads/lincoln/packages/:filename', requireInternalKey, async (req, res, next) => {
  try {
    res.json(await deleteLincolnPackageImage(req.params.filename));
  } catch (error) {
    if (/imagen|nombre|paquete/i.test(error?.message ?? '')) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

export default router;
