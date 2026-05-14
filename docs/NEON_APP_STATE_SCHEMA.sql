-- COPETIN - Estado transicional para Render + Neon
-- Esta tabla permite desplegar el sistema sin depender de localStorage como fuente principal.
-- Luego se puede migrar gradualmente a tablas normalizadas usando COPETIN_POSTGRESQL_SCHEMA.sql.

CREATE TABLE IF NOT EXISTS app_state_snapshots (
  id TEXT PRIMARY KEY,
  state JSONB,
  version BIGINT NOT NULL DEFAULT 0,
  checksum TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_state_snapshots_updated_at
ON app_state_snapshots (updated_at DESC);
