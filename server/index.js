import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import stateRoutes from './routes/state.js';
import uploadRoutes from './routes/uploads.js';
import documentRoutes from './routes/documents.js';
import contractTransactionRoutes from './routes/contractTransactions.js';
import publicCatalogRoutes from './routes/publicCatalog.js';
import lincolnRoutes from './routes/lincoln.js';
import { getDatabaseMode, isPostgresMode } from './database/mode.js';
import { ensureStateStore, getStateStoreInfo } from './storage/fileStateStore.js';
import { runLegacyGuaranteeRefundRepair } from './migrations/repairLegacyGuaranteeRefunds.js';
import { ensureLincolnStateStore, getLincolnStateStoreInfo } from './storage/lincolnStateStore.js';
import {
  ensureProductUploadDirectory,
  getProductUploadInfo,
} from './storage/productImageStore.js';
import {
  ensureAttendanceUploadDirectory,
  getAttendanceUploadInfo,
} from './storage/attendancePhotoStore.js';
import {
  ensureLincolnRoomUploadDirectory,
  getLincolnRoomUploadInfo,
} from './storage/lincolnRoomImageStore.js';
import {
  ensureLincolnPackageUploadDirectory,
  getLincolnPackageUploadInfo,
} from './storage/lincolnPackageImageStore.js';
import {
  closeDocumentPdfRenderer,
  warmDocumentPdfRenderer,
} from './storage/documentPdfRenderer.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);
const isProduction = process.env.NODE_ENV === 'production';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');
let httpServer = null;
let shutdownStarted = false;

const parseOrigins = (value) =>
  String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const localDevelopmentOrigins = isProduction
  ? []
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];
const allowedOrigins = [
  ...new Set([
    ...parseOrigins(process.env.CORS_ORIGIN),
    ...localDevelopmentOrigins,
  ]),
];

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
  max: Number(process.env.GENERAL_RATE_LIMIT_MAX ?? (isProduction ? 6000 : 12000)),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/__copetin_db'),
});
const presenceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.PRESENCE_RATE_LIMIT_MAX ?? (isProduction ? 3000 : 6000)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas actualizaciones de sesiones activas. Intenta nuevamente en un momento.' },
});
const stateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.STATE_RATE_LIMIT_MAX ?? (isProduction ? 6000 : 12000)),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/presence'),
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
app.use(uploadRoutes);

// Los documentos PDF se renderizan desde el servidor. En desarrollo, Vite sirve
// /public en el puerto 5173, pero Chromium genera el PDF contra el puerto 4000.
// Exponemos las imágenes institucionales también desde Express para que el logo
// y los recursos del contrato estén disponibles en ambos entornos.
app.use(
  '/imagenes',
  express.static(path.join(projectRoot, 'public', 'imagenes'), {
    maxAge: isProduction ? '7d' : 0,
    index: false,
  }),
);

app.use(express.json({ limit: process.env.JSON_LIMIT ?? '64mb' }));
app.use(publicCatalogRoutes);
app.use(documentRoutes);
app.use(contractTransactionRoutes);
app.use(lincolnRoutes);

app.get('/health', async (_req, res, next) => {
  try {
    const databaseMode = getDatabaseMode();
    let postgres = { enabled: false, ok: null };
    if (isPostgresMode()) {
      try {
        const { prisma } = await import('./database/prisma.js');
        await prisma.$queryRaw`SELECT 1`;
        postgres = { enabled: true, ok: true };
      } catch (error) {
        postgres = { enabled: true, ok: false, error: isProduction ? 'postgres_unavailable' : error?.message };
      }
    }
    res.json({
      ok: true,
      service: 'copetin-api',
      databaseMode,
      postgres,
      storage: getStateStoreInfo().storage,
      stateFile: getStateStoreInfo().stateFilePath,
      lincolnStorage: getLincolnStateStoreInfo().storage,
      lincolnStateFile: getLincolnStateStoreInfo().stateFilePath,
      uploads: {
        products: productUploadInfo.uploadDirectory,
        attendance: attendanceUploadInfo.uploadDirectory,
        lincolnRooms: lincolnRoomUploadInfo.uploadDirectory,
      },
      time: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

app.use('/__copetin_db/presence', presenceLimiter);
app.use('/__copetin_db', stateLimiter);
app.use(stateRoutes);

const productUploadInfo = getProductUploadInfo();
app.use(
  '/uploads/products',
  express.static(productUploadInfo.uploadDirectory, {
    immutable: true,
    maxAge: '30d',
    index: false,
  }),
);

const attendanceUploadInfo = getAttendanceUploadInfo();
app.use(
  '/uploads/attendance',
  express.static(attendanceUploadInfo.uploadDirectory, {
    immutable: true,
    maxAge: '30d',
    index: false,
  }),
);

const lincolnRoomUploadInfo = getLincolnRoomUploadInfo();
app.use(
  '/uploads/lincoln/rooms',
  express.static(lincolnRoomUploadInfo.uploadDirectory, {
    immutable: true,
    maxAge: '30d',
    index: false,
  }),
);

const lincolnPackageUploadInfo = getLincolnPackageUploadInfo();
app.use(
  '/uploads/lincoln/packages',
  express.static(lincolnPackageUploadInfo.uploadDirectory, {
    immutable: true,
    maxAge: '30d',
    index: false,
  }),
);

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (
      req.method !== 'GET'
      || req.path.startsWith('/__copetin_db')
      || req.path.startsWith('/api/')
      || req.path.startsWith('/uploads/')
      || req.path.startsWith('/health')
    ) {
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
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: 'La imagen supera el tamano maximo permitido.' });
    return;
  }
  res.status(500).json({
    error: isProduction ? 'Error interno del servidor.' : error?.message ?? 'Error interno del servidor.',
  });
});

const start = async () => {
  await ensureStateStore();
  await runLegacyGuaranteeRefundRepair();
  await ensureLincolnStateStore();
  await ensureProductUploadDirectory();
  await ensureAttendanceUploadDirectory();
  await ensureLincolnRoomUploadDirectory();
  await ensureLincolnPackageUploadDirectory();
  try {
    await warmDocumentPdfRenderer();
    console.log('Motor PDF listo.');
  } catch (error) {
    console.warn('Motor PDF no disponible al iniciar:', error?.message ?? error);
  }
  httpServer = app.listen(port, () => {
    console.log(`Copetin API escuchando en puerto ${port}`);
  });
};

const closeHttpServer = async () => {
  if (!httpServer) return;
  await Promise.race([
    new Promise((resolve) => httpServer.close(resolve)),
    new Promise((resolve) => setTimeout(resolve, 10000)),
  ]);
};

const shutdown = async (signal) => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`Cerrando Copetin API por ${signal}.`);

  try {
    await closeHttpServer();
    await closeDocumentPdfRenderer();
    process.exit(0);
  } catch (error) {
    console.error('No se pudo cerrar Copetin API limpiamente.', error);
    process.exit(1);
  }
};

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

start().catch((error) => {
  console.error('No se pudo iniciar Copetin API.');
  console.error(error);
  process.exit(1);
});
