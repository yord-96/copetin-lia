const ALLOWED_DATABASE_MODES = new Set(['json', 'hybrid', 'postgres']);

export const getDatabaseMode = () => {
  const mode = String(process.env.DATABASE_MODE ?? 'json').trim().toLowerCase();
  return ALLOWED_DATABASE_MODES.has(mode) ? mode : 'json';
};

export const isPostgresMode = () => ['hybrid', 'postgres'].includes(getDatabaseMode());
