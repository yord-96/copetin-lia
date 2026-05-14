import pg from 'pg';

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

let pool = null;

export const getPool = () => {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL no esta configurado. Crea la base en Neon y agrega la variable en Render.');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('sslmode=require') ? undefined : { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  return pool;
};

export const query = (text, params = []) => getPool().query(text, params);

export const checkDatabase = async () => {
  const result = await query('select now() as now');
  return result.rows[0];
};
