import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getStateSnapshot } from '../storage/fileStateStore.js';
import {
  renderHtmlDocumentToPdf,
} from '../storage/documentPdfRenderer.js';
import { getProductUploadInfo } from '../storage/productImageStore.js';
import {
  buildContractDocumentHtml,
  buildWeeklyInventoryHtml,
} from '../../src/services/webBridge.js';

const router = Router();
const internalKey = String(process.env.APP_INTERNAL_KEY ?? '').trim();
const maxDocumentHtmlBytes = Number(
  process.env.DOCUMENT_HTML_MAX_BYTES ?? 4 * 1024 * 1024,
);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const contractLogoPath = path.join(
  projectRoot,
  'public',
  'imagenes',
  'logo_el_copetin_redisenado.png',
);
let contractLogoDataUrlPromise = null;
const productUploadInfo = getProductUploadInfo();
const productImageDataUrlPromises = new Map();
const documentAccessTokens = new Map();
const DOCUMENT_ACCESS_TOKEN_TTL_MS = 2 * 60 * 1000;

const cleanupDocumentAccessTokens = () => {
  const now = Date.now();
  documentAccessTokens.forEach((entry, token) => {
    if (!entry || entry.expiresAt <= now) {
      documentAccessTokens.delete(token);
    }
  });
};

const createDocumentAccessToken = ({ kind, identifier }) => {
  cleanupDocumentAccessTokens();
  const token = randomUUID();
  documentAccessTokens.set(token, {
    kind,
    identifier: String(identifier ?? '').trim(),
    expiresAt: Date.now() + DOCUMENT_ACCESS_TOKEN_TTL_MS,
  });
  return token;
};

const hasValidDocumentAccessToken = ({ token, kind, identifier }) => {
  cleanupDocumentAccessTokens();
  const record = documentAccessTokens.get(String(token ?? '').trim());
  if (!record) return false;
  return record.kind === kind
    && record.identifier === String(identifier ?? '').trim()
    && record.expiresAt > Date.now();
};


const getContractLogoDataUrl = async () => {
  if (!contractLogoDataUrlPromise) {
    contractLogoDataUrlPromise = fs.readFile(contractLogoPath)
      .then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`)
      .catch((error) => {
        contractLogoDataUrlPromise = null;
        throw error;
      });
  }
  return contractLogoDataUrlPromise;
};

const embedContractAssets = async (html) => {
  const logoDataUrl = await getContractLogoDataUrl();
  return String(html ?? '')
    .replace(
      /(?:https?:\/\/[^"'\s>]+)?\/imagenes\/logo_el_copetin_redisenado\.png/gi,
      logoDataUrl,
    );
};

const getProductImageDataUrl = async (filename) => {
  const safeFilename = path.basename(String(filename ?? '').trim());
  if (!safeFilename) return '';

  if (!productImageDataUrlPromises.has(safeFilename)) {
    const promise = fs.readFile(path.join(productUploadInfo.uploadDirectory, safeFilename))
      .then((buffer) => {
        const extension = path.extname(safeFilename).toLowerCase();
        const mimeType = extension === '.png'
          ? 'image/png'
          : extension === '.webp'
            ? 'image/webp'
            : 'image/jpeg';
        return `data:${mimeType};base64,${buffer.toString('base64')}`;
      })
      .catch(() => '');
    productImageDataUrlPromises.set(safeFilename, promise);
  }

  return productImageDataUrlPromises.get(safeFilename);
};

const embedInventoryAssets = async (html) => {
  let nextHtml = String(html ?? '');
  const matches = [...nextHtml.matchAll(
    /(?:https?:\/\/[^"'\s>]+)?\/uploads\/products\/([^"'\s>?#]+)(?:\?[^"'\s>]*)?/gi,
  )];
  const replacements = await Promise.all(
    matches.map(async (match) => {
      const encodedFilename = match[1] ?? '';
      let decodedFilename = encodedFilename;
      try {
        decodedFilename = decodeURIComponent(encodedFilename);
      } catch {
        decodedFilename = encodedFilename;
      }
      return {
        source: match[0],
        dataUrl: await getProductImageDataUrl(decodedFilename),
      };
    }),
  );

  replacements.forEach(({ source, dataUrl }) => {
    if (!dataUrl) return;
    nextHtml = nextHtml.split(source).join(dataUrl);
  });

  return embedContractAssets(nextHtml);
};

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
    res.status(403).json({ error: 'Clave interna inválida.' });
    return;
  }
  next();
};

const requireContractPdfAccess = (req, res, next) => {
  const requestedId = String(req.params.id ?? '').trim();
  const token = String(req.query?.access_token ?? '').trim();

  if (token && hasValidDocumentAccessToken({
    token,
    kind: 'contract',
    identifier: requestedId,
  })) {
    next();
    return;
  }

  requireInternalKey(req, res, next);
};

const matchesIdentifier = (entry, requestedId) => [
  entry?.id,
  entry?.contractId,
  entry?.rentalId,
  entry?.contractCode,
  entry?.orderCode,
  entry?.number,
].some((value) => String(value ?? '').trim() === requestedId);

const sanitizeFilePart = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildContractPdfFileName = (contract, rental) => {
  const customer = sanitizeFilePart(
    contract?.customerName ?? rental?.customerName ?? '',
  ).split(' ').filter(Boolean).slice(0, 2).join(' ');
  const code = sanitizeFilePart(
    contract?.contractCode ?? rental?.contractCode ?? rental?.orderCode ?? 'contrato',
  );
  return [customer, code].filter(Boolean).join(' ').toUpperCase() || 'CONTRATO';
};

const buildInventoryPdfFileName = (rental, contract) => {
  const customer = sanitizeFilePart(
    contract?.customerName ?? rental?.customerName ?? rental?.client ?? '',
  ).split(' ').filter(Boolean).slice(0, 2).join(' ');
  const code = sanitizeFilePart(
    rental?.orderCode ?? contract?.orderCode ?? contract?.contractCode ?? rental?.contractCode ?? 'inventario',
  );
  return [customer, code].filter(Boolean).join(' ').toUpperCase() || 'INVENTARIO';
};

const toDateKey = (value) => {
  if (!value) return '';
  const rawValue = String(value);
  const directMatch = rawValue.match(/\d{4}-\d{2}-\d{2}/);
  if (directMatch) return directMatch[0];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getWeekRange = (dateKey) => {
  const sourceDate = dateKey ? new Date(`${dateKey}T12:00:00`) : new Date();
  if (Number.isNaN(sourceDate.getTime())) {
    return getWeekRange(toDateKey(new Date()));
  }
  const day = sourceDate.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(sourceDate);
  monday.setDate(sourceDate.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    weekStart: toDateKey(monday),
    weekEnd: toDateKey(sunday),
  };
};

const isPickupDeliveryRecord = (entry) => {
  const rawType = String(
    entry?.type ?? entry?.kind ?? entry?.direction ?? entry?.operation ?? entry?.status ?? '',
  ).toLowerCase();
  return rawType.includes('pickup')
    || rawType.includes('recojo')
    || rawType.includes('recog')
    || rawType.includes('return')
    || rawType.includes('devol');
};

const resolveContractContext = (state, requestedId) => {
  const contracts = Array.isArray(state?.contracts) ? state.contracts : [];
  const rentals = Array.isArray(state?.rentals) ? state.rentals : [];
  const allDeliveries = Array.isArray(state?.deliveries) ? state.deliveries : [];

  const contract = contracts.find((entry) => matchesIdentifier(entry, requestedId)) ?? null;
  if (!contract) return null;

  const rental = rentals.find((entry) =>
    String(entry?.contractId ?? '').trim() === String(contract.id ?? '').trim()
    || (
      contract?.contractCode
      && String(entry?.contractCode ?? '').trim() === String(contract.contractCode).trim()
    )
    || (
      contract?.orderCode
      && String(entry?.orderCode ?? '').trim() === String(contract.orderCode).trim()
    )
  ) ?? null;

  const deliveries = allDeliveries
    .filter((entry) =>
      (
        rental?.id
        && String(entry?.rentalId ?? '').trim() === String(rental.id).trim()
      )
      || (
        rental?.orderCode
        && String(entry?.orderCode ?? '').trim() === String(rental.orderCode).trim()
      )
      || (
        contract?.id
        && String(entry?.contractId ?? '').trim() === String(contract.id).trim()
      )
      || (
        contract?.contractCode
        && String(entry?.contractCode ?? '').trim() === String(contract.contractCode).trim()
      )
    )
    .sort((left, right) =>
      new Date(left?.createdAt ?? 0).getTime() - new Date(right?.createdAt ?? 0).getTime()
    );

  return { contract, rental, deliveries };
};

const resolveInventoryContext = (state, requestedId) => {
  const contracts = Array.isArray(state?.contracts) ? state.contracts : [];
  const rentals = Array.isArray(state?.rentals) ? state.rentals : [];
  const allDeliveries = Array.isArray(state?.deliveries) ? state.deliveries : [];

  let rental = rentals.find((entry) => matchesIdentifier(entry, requestedId)) ?? null;
  let contract = contracts.find((entry) => matchesIdentifier(entry, requestedId)) ?? null;

  if (!rental && contract) {
    rental = rentals.find((entry) =>
      String(entry?.contractId ?? '').trim() === String(contract.id ?? '').trim()
      || (
        contract?.contractCode
        && String(entry?.contractCode ?? '').trim() === String(contract.contractCode).trim()
      )
      || (
        contract?.orderCode
        && String(entry?.orderCode ?? '').trim() === String(contract.orderCode).trim()
      )
    ) ?? null;
  }

  if (rental && !contract) {
    contract = contracts.find((entry) =>
      String(entry?.id ?? '').trim() === String(rental.contractId ?? '').trim()
      || (
        rental?.contractCode
        && String(entry?.contractCode ?? '').trim() === String(rental.contractCode).trim()
      )
      || (
        rental?.orderCode
        && String(entry?.orderCode ?? '').trim() === String(rental.orderCode).trim()
      )
    ) ?? null;
  }

  const deliveries = allDeliveries
    .filter((entry) =>
      (
        rental?.id
        && String(entry?.rentalId ?? '').trim() === String(rental.id).trim()
      )
      || (
        rental?.orderCode
        && String(entry?.orderCode ?? '').trim() === String(rental.orderCode).trim()
      )
      || (
        contract?.id
        && String(entry?.contractId ?? '').trim() === String(contract.id).trim()
      )
      || (
        contract?.contractCode
        && String(entry?.contractCode ?? '').trim() === String(contract.contractCode).trim()
      )
    )
    .sort((left, right) =>
      new Date(left?.createdAt ?? 0).getTime() - new Date(right?.createdAt ?? 0).getTime()
    );

  return { contract, rental, deliveries };
};

router.post(
  '/__copetin_db/contracts/:id/pdf-access',
  requireInternalKey,
  (req, res) => {
    const requestedId = String(req.params.id ?? '').trim();
    if (!requestedId) {
      res.status(400).json({ error: 'Debes indicar el contrato.' });
      return;
    }

    const token = createDocumentAccessToken({
      kind: 'contract',
      identifier: requestedId,
    });
    const encodedId = encodeURIComponent(requestedId);
    const encodedToken = encodeURIComponent(token);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      url: `/__copetin_db/contracts/${encodedId}/pdf?access_token=${encodedToken}`,
      expiresInMs: DOCUMENT_ACCESS_TOKEN_TTL_MS,
    });
  },
);

router.get(
  '/__copetin_db/contracts/:id/pdf',
  requireContractPdfAccess,
  async (req, res, next) => {
    const startedAt = Date.now();
    try {
      const requestedId = String(req.params.id ?? '').trim();
      if (!requestedId) {
        res.status(400).json({ error: 'Debes indicar el contrato.' });
        return;
      }

      const snapshot = await getStateSnapshot();
      const context = resolveContractContext(snapshot?.state, requestedId);
      if (!context?.contract) {
        res.status(404).json({ error: 'Contrato no encontrado.' });
        return;
      }

      if (context.contract?._summaryOnly) {
        res.status(409).json({
          error: 'El servidor no dispone del contrato completo para generar el PDF.',
        });
        return;
      }

      const rawHtml = buildContractDocumentHtml({
        contract: context.contract,
        rental: context.rental ?? {},
        deliveries: context.deliveries,
        settings: snapshot?.state?.settings ?? {},
        items: Array.isArray(snapshot?.state?.items) ? snapshot.state.items : [],
      });
      const html = await embedContractAssets(rawHtml);

      const result = await renderHtmlDocumentToPdf({
        html,
        baseUrl: `${req.protocol}://${req.get('host')}`,
        fileName: buildContractPdfFileName(context.contract, context.rental),
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
      res.setHeader('Content-Length', String(result.buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      res.setHeader('X-Document-Cache', result.cacheHit ? 'HIT' : 'MISS');
      res.setHeader('X-Document-Key', result.cacheKey);
      res.setHeader('X-Document-Duration-Ms', String(Date.now() - startedAt));
      res.send(result.buffer);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/__copetin_db/inventory-orders/:id/pdf',
  requireInternalKey,
  async (req, res, next) => {
    const startedAt = Date.now();
    try {
      const requestedId = String(req.params.id ?? '').trim();
      if (!requestedId) {
        res.status(400).json({ error: 'Debes indicar la orden de inventario.' });
        return;
      }

      const snapshot = await getStateSnapshot();
      const state = snapshot?.state ?? {};
      const context = resolveInventoryContext(state, requestedId);
      if (!context?.rental) {
        res.status(404).json({ error: 'Orden de inventario no encontrada.' });
        return;
      }

      if (context.rental?._summaryOnly || context.contract?._summaryOnly) {
        res.status(409).json({
          error: 'El servidor no dispone de la orden completa para generar el PDF.',
        });
        return;
      }

      const deliveryOut = context.deliveries.find((entry) => !isPickupDeliveryRecord(entry))
        ?? context.deliveries[0]
        ?? null;
      const baseDate = toDateKey(
        context.contract?.deliveryDate
        ?? deliveryOut?.scheduledDate
        ?? context.rental?.rentalDate
        ?? context.rental?.createdAt,
      );
      const { weekStart, weekEnd } = getWeekRange(baseDate);

      const rawHtml = buildWeeklyInventoryHtml({
        rentals: [context.rental],
        contracts: context.contract ? [context.contract] : [],
        deliveries: context.deliveries,
        settings: state?.settings ?? {},
        items: Array.isArray(state?.items) ? state.items : [],
        weekStart,
        weekEnd,
        format: 'individual',
        targetRentalId: context.rental?.id ?? '',
        targetOrderCode: context.rental?.orderCode ?? context.contract?.orderCode ?? '',
        targetContractCode: context.contract?.contractCode ?? context.rental?.contractCode ?? '',
      });
      const html = await embedInventoryAssets(rawHtml);

      const result = await renderHtmlDocumentToPdf({
        html,
        baseUrl: `${req.protocol}://${req.get('host')}`,
        fileName: buildInventoryPdfFileName(context.rental, context.contract),
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
      res.setHeader('Content-Length', String(result.buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      res.setHeader('X-Document-Cache', result.cacheHit ? 'HIT' : 'MISS');
      res.setHeader('X-Document-Key', result.cacheKey);
      res.setHeader('X-Document-Duration-Ms', String(Date.now() - startedAt));
      res.send(result.buffer);
    } catch (error) {
      next(error);
    }
  },
);

// Compatibility endpoint for other document types that still send HTML.
router.post('/__copetin_db/documents/render-pdf', requireInternalKey, async (req, res, next) => {
  try {
    const html = String(req.body?.html ?? '');
    if (!html.trim()) {
      res.status(400).json({ error: 'Debes enviar el contenido del documento.' });
      return;
    }

    if (Buffer.byteLength(html, 'utf8') > maxDocumentHtmlBytes) {
      res.status(413).json({ error: 'El documento supera el tamaño máximo permitido.' });
      return;
    }

    const result = await renderHtmlDocumentToPdf({
      html,
      baseUrl: req.body?.baseUrl,
      fileName: req.body?.fileName,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
    res.setHeader('Content-Length', String(result.buffer.length));
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('X-Document-Cache', result.cacheHit ? 'HIT' : 'MISS');
    res.setHeader('X-Document-Key', result.cacheKey);
    res.send(result.buffer);
  } catch (error) {
    next(error);
  }
});

export default router;
