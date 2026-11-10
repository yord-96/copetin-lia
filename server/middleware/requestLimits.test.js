import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRequestLimiters } from './requestLimits.js';

test('shared-IP attendance, evidence and login budgets are isolated from other modules', async () => {
  const limits = createRequestLimiters({ isProduction: true, env: { GENERAL_RATE_LIMIT_MAX: 2, STATE_RATE_LIMIT_MAX: 2, PRESENCE_RATE_LIMIT_MAX: 2, ATTENDANCE_RATE_LIMIT_MAX: 120, ACCESS_RATE_LIMIT_MAX: 60 } });
  const app = express();
  app.use(limits.general, limits.attendance, limits.access);
  app.use('/__copetin_db/presence', limits.presence);
  app.use('/__copetin_db', limits.state);
  app.use((_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const status = async path => (await fetch(base + path)).status;
  try {
    assert.equal(await status('/__copetin_db/orders'), 200);
    assert.equal(await status('/__copetin_db/orders'), 200);
    assert.equal(await status('/__copetin_db/orders'), 429);
    assert.equal(await status('/__copetin_db/presence'), 200);
    assert.equal(await status('/__copetin_db/presence'), 200);
    assert.equal(await status('/__copetin_db/presence'), 429);
    const statuses = await Promise.all(Array.from({ length: 20 }, async () => Promise.all([
      status('/__copetin_db/collections?names=users'), status('/__copetin_db/attendance/users'),
      status('/__copetin_db/attendance'), status('/api/uploads/attendance'),
    ])));
    assert.ok(statuses.flat().every(code => code === 200));
    assert.equal(await status('/__copetin_db/collections?names=users,contracts'), 429);
    assert.equal(await status('/__copetin_db/attendancelookalike'), 429);
    assert.equal(await status('/other-module'), 200);
    assert.equal(await status('/other-module'), 200);
    assert.equal(await status('/other-module'), 429);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
