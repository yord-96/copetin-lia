import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const file = path.resolve(process.env.LINCOLN_PORTAL_FILE || 'data/lincoln-portal.json');
let queue = Promise.resolve();
export const portalError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export const readPortal = async () => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { accounts: [], plans: {}, sessions: [] }; throw error; }
};
export const mutatePortal = (mutator) => {
  const operation = queue.then(async () => {
    const state = await readPortal();
    state.sessions = state.sessions.filter((session) => session.expiresAt > Date.now());
    const result = await mutator(state);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
    return result;
  });
  queue = operation.catch(() => {});
  return operation;
};
export const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
export const newSession = (state, subject) => {
  const token = crypto.randomBytes(32).toString('base64url');
  state.sessions.push({ ...subject, tokenHash: tokenHash(token), expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  return token;
};
