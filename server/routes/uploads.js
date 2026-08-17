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
import {
  deleteEconomicReceiptImage,
  ensureEconomicReceiptUploadDirectory,
  saveEconomicReceiptImage,
} from '../storage/economicReceiptImageStore.js';
import { updateStateSnapshot } from '../storage/fileStateStore.js';

const router = Router();
const internalKey = String(process.env.APP_INTERNAL_KEY ?? '').trim();
const maxImageBytes = Number(process.env.PRODUCT_IMAGE_MAX_BYTES ?? 8 * 1024 * 1024);
const maxAttendancePhotoBytes = Number(process.env.ATTENDANCE_PHOTO_MAX_BYTES ?? 1024 * 1024);
const maxLincolnRoomImageBytes = Number(process.env.LINCOLN_ROOM_IMAGE_MAX_BYTES ?? 8 * 1024 * 1024);
const maxLincolnPackageImageBytes = Number(process.env.LINCOLN_PACKAGE_IMAGE_MAX_BYTES ?? 8 * 1024 * 1024);
const maxEconomicReceiptImageBytes = Number(process.env.ECONOMIC_RECEIPT_IMAGE_MAX_BYTES ?? 5 * 1024 * 1024);

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


const decodeHeaderValue = (value) => {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return '';
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
};

const findContractIndex = (contracts, requestedId) => {
  const id = String(requestedId ?? '').trim();
  if (!id) return -1;
  const exactIdIndex = contracts.findIndex((contract) => String(contract?.id ?? '') === id);
  if (exactIdIndex >= 0) return exactIdIndex;
  const activeCodeIndex = contracts.findIndex((contract) => (
    !contract?.deletedAt
    && (String(contract?.contractCode ?? '') === id || String(contract?.number ?? '') === id)
  ));
  if (activeCodeIndex >= 0) return activeCodeIndex;
  return contracts.findIndex((contract) => (
    String(contract?.contractCode ?? '') === id || String(contract?.number ?? '') === id
  ));
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
  '/api/uploads/economic-receipts',
  requireInternalKey,
  raw({
    type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
    limit: maxEconomicReceiptImageBytes,
  }),
  async (req, res, next) => {
    let savedFile = null;
    try {
      const requestedContractId = String(req.get('X-Contract-Id') ?? '').trim();
      const ledgerEntryId = String(req.get('X-Economic-Ledger-Id') ?? '').trim();
      if (!requestedContractId || !ledgerEntryId) {
        res.status(400).json({ error: 'No se pudo identificar el contrato o la linea economica.' });
        return;
      }

      await ensureEconomicReceiptUploadDirectory();
      savedFile = await saveEconomicReceiptImage({
        buffer: req.body,
        declaredMime: String(req.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase(),
        contractId: requestedContractId,
        ledgerEntryId,
      });

      const now = new Date().toISOString();
      const uploadedById = String(req.get('X-User-Id') ?? '').trim() || null;
      const uploadedByName = decodeHeaderValue(req.get('X-User-Name')) || 'Sistema';
      const originalName = decodeHeaderValue(req.get('X-Original-Filename')) || savedFile.filename;
      let updatedContract = null;
      let previousFilename = '';

      const result = await updateStateSnapshot((state) => {
        const contracts = Array.isArray(state.contracts) ? state.contracts : [];
        const contractIndex = findContractIndex(contracts, requestedContractId);
        if (contractIndex < 0) {
          const error = new Error('Contrato no encontrado para adjuntar el comprobante.');
          error.statusCode = 404;
          throw error;
        }
        const existingContract = contracts[contractIndex];
        const ledger = Array.isArray(existingContract?.economicLedger) ? existingContract.economicLedger : [];
        const entryIndex = ledger.findIndex((entry) => String(entry?.id ?? '') === ledgerEntryId && !entry?.deletedAt);
        if (entryIndex < 0) {
          const error = new Error('La linea economica ya no existe o fue anulada.');
          error.statusCode = 404;
          throw error;
        }

        previousFilename = String(ledger[entryIndex]?.attachment?.filename ?? '').trim();
        const attachment = {
          url: savedFile.imageUrl,
          filename: savedFile.filename,
          originalName,
          mimeType: savedFile.mimeType,
          bytes: savedFile.bytes,
          uploadedAt: now,
          uploadedById,
          uploadedByName,
        };
        const nextLedger = ledger.map((entry, index) => (
          index === entryIndex ? { ...entry, attachment } : entry
        ));
        updatedContract = {
          ...existingContract,
          economicLedger: nextLedger,
          economicLedgerUpdatedAt: now,
          economicLedgerUpdatedById: uploadedById,
          economicLedgerUpdatedByName: uploadedByName,
          updatedAt: now,
        };
        return {
          ...state,
          contracts: [
            ...contracts.slice(0, contractIndex),
            updatedContract,
            ...contracts.slice(contractIndex + 1),
          ],
        };
      });

      if (!result.initialized) {
        await deleteEconomicReceiptImage(savedFile.filename).catch(() => {});
        res.status(404).json({ error: 'La base de datos aun no esta inicializada.' });
        return;
      }

      if (previousFilename && previousFilename !== savedFile.filename) {
        await deleteEconomicReceiptImage(previousFilename).catch((error) => {
          console.warn('[copetin-upload] No se pudo limpiar comprobante anterior:', error?.message ?? error);
        });
      }

      res.status(201).json({
        ok: true,
        attachment: updatedContract?.economicLedger?.find((entry) => String(entry?.id ?? '') === ledgerEntryId)?.attachment ?? null,
        contract: updatedContract,
        revision: result.revision,
        version: result.version,
        updatedAt: result.updatedAt,
      });
    } catch (error) {
      if (savedFile?.filename) {
        await deleteEconomicReceiptImage(savedFile.filename).catch(() => {});
      }
      if (error?.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      if (/imagen|comprobante|archivo|contenido|tipo/i.test(error?.message ?? '')) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

router.delete('/api/uploads/economic-receipts/:contractId/:ledgerEntryId', requireInternalKey, async (req, res, next) => {
  try {
    const requestedContractId = String(req.params.contractId ?? '').trim();
    const ledgerEntryId = String(req.params.ledgerEntryId ?? '').trim();
    const updatedById = String(req.query.userId ?? '').trim() || null;
    const updatedByName = String(req.query.userName ?? '').trim() || 'Sistema';
    const now = new Date().toISOString();
    let updatedContract = null;
    let filenameToDelete = '';

    const result = await updateStateSnapshot((state) => {
      const contracts = Array.isArray(state.contracts) ? state.contracts : [];
      const contractIndex = findContractIndex(contracts, requestedContractId);
      if (contractIndex < 0) {
        const error = new Error('Contrato no encontrado para quitar el comprobante.');
        error.statusCode = 404;
        throw error;
      }
      const existingContract = contracts[contractIndex];
      const ledger = Array.isArray(existingContract?.economicLedger) ? existingContract.economicLedger : [];
      const entryIndex = ledger.findIndex((entry) => String(entry?.id ?? '') === ledgerEntryId && !entry?.deletedAt);
      if (entryIndex < 0) {
        const error = new Error('La linea economica ya no existe o fue anulada.');
        error.statusCode = 404;
        throw error;
      }
      filenameToDelete = String(ledger[entryIndex]?.attachment?.filename ?? '').trim();
      const nextLedger = ledger.map((entry, index) => (
        index === entryIndex ? { ...entry, attachment: null } : entry
      ));
      updatedContract = {
        ...existingContract,
        economicLedger: nextLedger,
        economicLedgerUpdatedAt: now,
        economicLedgerUpdatedById: updatedById,
        economicLedgerUpdatedByName: updatedByName,
        updatedAt: now,
      };
      return {
        ...state,
        contracts: [
          ...contracts.slice(0, contractIndex),
          updatedContract,
          ...contracts.slice(contractIndex + 1),
        ],
      };
    });

    if (!result.initialized) {
      res.status(404).json({ error: 'La base de datos aun no esta inicializada.' });
      return;
    }
    if (filenameToDelete) {
      await deleteEconomicReceiptImage(filenameToDelete).catch((error) => {
        console.warn('[copetin-upload] No se pudo borrar archivo de comprobante:', error?.message ?? error);
      });
    }
    res.json({
      ok: true,
      contract: updatedContract,
      revision: result.revision,
      version: result.version,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    if (error?.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

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
