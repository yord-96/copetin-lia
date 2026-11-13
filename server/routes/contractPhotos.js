import { Router, raw } from 'express';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { validateProductImage } from '../storage/productImageStore.js';
import { readContractPhoto, contractPhotoReaderStatus } from '../services/contractPhotoReader.js';

export function createContractPhotoRouter({ reader = readContractPhoto, statusReader = contractPhotoReaderStatus, env = process.env } = {}) {
  const router = Router();
  const jobs = new Map();
  const prefix = '/__copetin_db/contract-photo';
  const maxBytes = 8 * 1024 * 1024;
  let active = null;
  router.use(prefix, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const key = String(env.APP_INTERNAL_KEY || '');
    if (key && req.get('X-App-Internal-Key') !== key) return res.status(403).json({ error: 'Acceso no autorizado al lector de contratos.' });
    for (const [id, job] of jobs) {
      if (Date.now() - job.createdAt > 10 * 60 * 1000) { job.controller.abort(); jobs.delete(id); }
    }
    next();
  });
  router.get(`${prefix}/status`, async (_req, res) => {
    try { res.json(await statusReader({ env })); }
    catch { res.json({ ready: false, message: 'La configuración del lector local requiere revisión.' }); }
  });
  const limit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Se alcanzó el límite de lecturas. Espera antes de subir otra foto.' } });
  router.post(`${prefix}/jobs`, limit, raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: maxBytes }), async (req, res) => {
    if (active) return res.status(429).json({ error: 'El lector está procesando otra foto. Intenta de nuevo cuando termine.' });
    let mime;
    try { mime = validateProductImage(req.body, req.get('Content-Type')).mimeType; }
    catch { return res.status(400).json({ error: 'Selecciona una imagen JPG, PNG o WEBP válida, de hasta 8 MB.' }); }
    let status;
    try { status = await statusReader({ env }); }
    catch { status = { ready: false, message: 'Revisa la configuración del lector local.' }; }
    if (!status.ready) return res.status(503).json({ error: status.message });
    // Recheck after the asynchronous readiness probe to admit only one job.
    if (active) return res.status(429).json({ error: 'El lector está ocupado con otra foto.' });
    const job = { id: randomUUID(), createdAt: Date.now(), status: 'reading', controller: new AbortController() };
    jobs.set(job.id, job); active = job.id;
    res.status(202).json({ id: job.id, status: job.status });
    const buffer = req.body;
    Promise.resolve().then(() => reader(buffer, mime, { signal: job.controller.signal, env }))
      .then(extraction => { if (!job.controller.signal.aborted) { job.status = 'ready'; job.extraction = extraction; } })
      .catch(error => { if (!job.controller.signal.aborted) { job.status = 'error'; job.error = error.message; } })
      .finally(() => { if (active === job.id) active = null; });
  });
  router.get(`${prefix}/jobs/:id`, (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'La lectura caducó. Sube la foto de nuevo.' });
    res.json({ id: job.id, status: job.status, extraction: job.extraction, error: job.error });
  });
  router.delete(`${prefix}/jobs/:id`, (req, res) => {
    const job = jobs.get(req.params.id);
    if (job) { job.controller.abort(); jobs.delete(job.id); }
    // active is released by the reader's finally, avoiding competing model calls.
    res.json({ ok: true });
  });
  router.use((error, _req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'La foto supera los 8 MB. Reduce su tamaño e inténtalo otra vez.' });
    next(error);
  });
  return router;
}

export default createContractPhotoRouter();
