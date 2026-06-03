import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import stateRoutes from './routes/state.js';
import { ensureStateStore, getStateStoreInfo } from './storage/fileStateStore.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);
const isProduction = process.env.NODE_ENV === 'production';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');

const parseOrigins = (value) =>
  String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const allowedOrigins = parseOrigins(process.env.CORS_ORIGIN);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", ...allowedOrigins],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 900 : 3000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/__copetin_db'),
});
const stateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProduction ? 900 : 1200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes al estado del sistema. Intenta nuevamente en un momento.' },
});
app.use(generalLimiter);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origen no permitido por CORS: ${origin}`));
    },
  }),
);
app.use(express.json({ limit: process.env.JSON_LIMIT ?? '25mb' }));

app.get('/health', async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      service: 'copetin-api',
      storage: getStateStoreInfo().storage,
      stateFile: getStateStoreInfo().stateFilePath,
      time: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

app.use('/__copetin_db', stateLimiter);
app.use(stateRoutes);

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/__copetin_db') || req.path.startsWith('/health')) {
      next();
      return;
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: isProduction ? 'Error interno del servidor.' : error?.message ?? 'Error interno del servidor.',
  });
});

const start = async () => {
  await ensureStateStore();
  app.listen(port, () => {
    console.log(`Copetin API escuchando en puerto ${port}`);
  });
};

start().catch((error) => {
  console.error('No se pudo iniciar Copetin API.');
  console.error(error);
  process.exit(1);
});
