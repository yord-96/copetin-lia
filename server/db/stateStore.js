import crypto from 'node:crypto';
import { query } from './neon.js';

const STATE_ID = process.env.APP_STATE_ID || 'copetin-main';

export const ensureStateStore = async () => {
  await query(`
    create table if not exists app_state_snapshots (
      id text primary key,
      state jsonb,
      version bigint not null default 0,
      checksum text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
};

const checksumForState = (state) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(state ?? null))
    .digest('hex')
    .slice(0, 16);

export const getStateSnapshot = async () => {
  await ensureStateStore();
  const result = await query(
    `select state, version, checksum, updated_at
     from app_state_snapshots
     where id = $1`,
    [STATE_ID],
  );

  const row = result.rows[0];
  if (!row) {
    return {
      initialized: false,
      state: null,
      revision: null,
      version: 0,
      updatedAt: null,
    };
  }

  return {
    initialized: Boolean(row.state),
    state: row.state,
    revision: `${row.version}:${row.checksum ?? 'empty'}`,
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
};

export const getStateMeta = async () => {
  const snapshot = await getStateSnapshot();
  return {
    initialized: snapshot.initialized,
    revision: snapshot.revision,
    version: snapshot.version,
    updatedAt: snapshot.updatedAt,
  };
};

export const replaceStateSnapshot = async (state) => {
  await ensureStateStore();

  const checksum = checksumForState(state);
  const result = await query(
    `insert into app_state_snapshots (id, state, version, checksum)
     values ($1, $2::jsonb, 1, $3)
     on conflict (id)
     do update set
       state = excluded.state,
       version = app_state_snapshots.version + 1,
       checksum = excluded.checksum,
       updated_at = now()
     returning version, checksum, updated_at`,
    [STATE_ID, JSON.stringify(state), checksum],
  );

  const row = result.rows[0];
  return {
    ok: true,
    revision: `${row.version}:${row.checksum}`,
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
};
