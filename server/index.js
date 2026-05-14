import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import stateRoutes from './routes/state.js';
import { checkDatabase } from './db/neon.js';
import { ensureStateStore } from './db/stateStore.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);

const parseOrigins = (value) =>
  String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const allowedOrigins = parseOrigins(process.env.CORS_ORIGIN);

app.disable('x-powered-by');
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
    const database = await checkDatabase();
    res.json({
      ok: true,
      service: 'copetin-api',
      databaseTime: database.now,
      storage: 'neon-postgres',
    });
  } catch (error) {
    next(error);
  }
});

app.use(stateRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: error?.message ?? 'Error interno del servidor.',
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
