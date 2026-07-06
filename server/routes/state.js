import { Router } from 'express';
import crypto from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { getStateMeta, getStateSnapshot, replaceStateSnapshot } from '../storage/fileStateStore.js';
import { heartbeatPresence, leavePresence, listPresence } from '../storage/presenceStore.js';

const router = Router();
const gzipAsync = promisify(gzip);
const internalKey = String(process.env.APP_INTERNAL_KEY ?? '').trim();
const MAX_CHUNKED_STATE_BYTES = Number(process.env.MAX_CHUNKED_STATE_BYTES ?? 64 * 1024 * 1024);
const CHUNK_UPLOAD_TTL_MS = 10 * 60 * 1000;
const chunkUploads = new Map();

const cleanupExpiredChunkUploads = () => {
  const cutoff = Date.now() - CHUNK_UPLOAD_TTL_MS;
  chunkUploads.forEach((upload, uploadId) => {
    if (upload.createdAt < cutoff) {
      chunkUploads.delete(uploadId);
    }
  });
};

const sendRevisionConflict = (req, res, error) => {
  console.warn('[state-route] Guardado rechazado por conflicto de revision.', {
    currentRevision: error.currentRevision,
    providedRevision: error.providedRevision,
    version: error.version,
    updatedAt: error.updatedAt,
    ip: req.ip,
  });
  res.status(409).json({
    error: 'Los datos fueron actualizados por otro usuario. Recarga la pagina antes de continuar.',
    currentRevision: error.currentRevision,
    providedRevision: error.providedRevision,
    version: error.version,
    updatedAt: error.updatedAt,
  });
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
    res.status(403).json({ error: 'Clave interna invalida.' });
    return;
  }
  next();
};

const sendJsonPayload = async (req, res, payload) => {
  const body = JSON.stringify(payload);
  const startedAt = Date.now();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');

  if (/\bgzip\b/i.test(String(req.get('Accept-Encoding') ?? '')) && body.length > 1024) {
    const compressed = await gzipAsync(Buffer.from(body), { level: 6 });
    console.info('[state-route] Estado enviado comprimido.', {
      originalBytes: Buffer.byteLength(body),
      gzipBytes: compressed.length,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
    });
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', String(compressed.length));
    res.send(compressed);
    return;
  }

  console.info('[state-route] Estado enviado sin compresion.', {
    bytes: Buffer.byteLength(body),
    durationMs: Date.now() - startedAt,
    ip: req.ip,
  });
  res.setHeader('Content-Length', String(Buffer.byteLength(body)));
  res.send(body);
};

router.use('/__copetin_db', requireInternalKey);

router.get('/__copetin_db/presence', async (req, res, next) => {
  try {
    res.json(await listPresence());
  } catch (error) {
    next(error);
  }
});

router.post('/__copetin_db/presence/heartbeat', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'La presencia debe enviarse como objeto JSON.' });
      return;
    }

    res.json(await heartbeatPresence(req.body));
  } catch (error) {
    next(error);
  }
});

router.post('/__copetin_db/presence/leave', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'La salida de presencia debe enviarse como objeto JSON.' });
      return;
    }

    res.json({ ok: true, active: await leavePresence(req.body) });
  } catch (error) {
    next(error);
  }
});

router.post('/__copetin_db/chunked/start', (req, res) => {
  cleanupExpiredChunkUploads();
  const totalChunks = Math.trunc(Number(req.body?.totalChunks ?? 0));
  const totalBytes = Math.trunc(Number(req.body?.totalBytes ?? 0));
  if (!Number.isFinite(totalChunks) || totalChunks < 1 || totalChunks > 1000) {
    res.status(400).json({ error: 'La cantidad de fragmentos no es valida.' });
    return;
  }
  if (!Number.isFinite(totalBytes) || totalBytes < 2 || totalBytes > MAX_CHUNKED_STATE_BYTES) {
    res.status(413).json({ error: 'La base supera el limite permitido para guardado fragmentado.' });
    return;
  }

  const uploadId = crypto.randomUUID();
  chunkUploads.set(uploadId, {
    createdAt: Date.now(),
    revision: req.body?.revision === null ? null : String(req.body?.revision ?? '').trim() || null,
    totalChunks,
    totalBytes,
    chunks: new Array(totalChunks),
    receivedBytes: 0,
  });
  res.json({ ok: true, uploadId });
});

router.post('/__copetin_db/chunked/chunk', (req, res) => {
  cleanupExpiredChunkUploads();
  const uploadId = String(req.body?.uploadId ?? '').trim();
  const index = Math.trunc(Number(req.body?.index ?? -1));
  const data = String(req.body?.data ?? '');
  const upload = chunkUploads.get(uploadId);
  if (!upload) {
    res.status(404).json({ error: 'La carga fragmentada expiro o no existe.' });
    return;
  }
  if (!Number.isFinite(index) || index < 0 || index >= upload.totalChunks || !data) {
    res.status(400).json({ error: 'El fragmento enviado no es valido.' });
    return;
  }

  let chunk;
  try {
    chunk = Buffer.from(data, 'base64');
  } catch {
    res.status(400).json({ error: 'No se pudo decodificar el fragmento.' });
    return;
  }
  if (chunk.length > 512 * 1024) {
    res.status(413).json({ error: 'El fragmento supera el limite permitido.' });
    return;
  }

  const previous = upload.chunks[index];
  upload.receivedBytes -= previous?.length ?? 0;
  upload.chunks[index] = chunk;
  upload.receivedBytes += chunk.length;
  res.json({ ok: true, index });
});

router.post('/__copetin_db/chunked/commit', async (req, res, next) => {
  cleanupExpiredChunkUploads();
  const uploadId = String(req.body?.uploadId ?? '').trim();
  const upload = chunkUploads.get(uploadId);
  if (!upload) {
    res.status(404).json({ error: 'La carga fragmentada expiro o no existe.' });
    return;
  }
  if (upload.chunks.some((chunk) => !chunk) || upload.receivedBytes !== upload.totalBytes) {
    res.status(400).json({ error: 'Faltan fragmentos para completar el guardado.' });
    return;
  }

  try {
    const state = JSON.parse(Buffer.concat(upload.chunks).toString('utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      res.status(400).json({ error: 'El estado reconstruido no es valido.' });
      return;
    }
    const result = await replaceStateSnapshot(state, upload.revision);
    chunkUploads.delete(uploadId);
    console.info('[state-route] Estado fragmentado guardado correctamente.', {
      revision: result?.revision,
      version: result?.version,
      totalBytes: upload.totalBytes,
      totalChunks: upload.totalChunks,
      ip: req.ip,
    });
    res.json(result);
  } catch (error) {
    chunkUploads.delete(uploadId);
    if (error?.code === 'STATE_REVISION_CONFLICT') {
      sendRevisionConflict(req, res, error);
      return;
    }
    next(error);
  }
});

router.get('/__copetin_db', async (req, res, next) => {
  try {
    if (req.query.meta === '1') {
      res.json(await getStateMeta());
      return;
    }

    await sendJsonPayload(req, res, await getStateSnapshot());
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

    const result = await replaceStateSnapshot(req.body.state, req.body.revision);
    console.info('[state-route] Estado guardado correctamente.', {
      revision: result?.revision,
      version: result?.version,
      updatedAt: result?.updatedAt,
      ip: req.ip,
    });
    res.json(result);
  } catch (error) {
    if (error?.code === 'STATE_REVISION_CONFLICT') {
      sendRevisionConflict(req, res, error);
      return;
    }

    console.error('[state-route] Fallo al guardar el estado del sistema.', {
      code: error?.code,
      message: error?.message,
      ip: req.ip,
    });
    next(error);
  }
});

export default router;
