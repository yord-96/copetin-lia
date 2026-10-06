import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { mutatePortal, readPortal, newSession, tokenHash, portalError } from '../storage/lincolnPortalStore.js';
import { getStaffUsers, isPortalStaff, verifyStaffPassword, getPortalEvent, normalizePortalPlan, publicAccount } from '../services/lincoln/lincolnPortalService.js';
import { starterPlan } from '../../src/components/lincoln/portal/portalModel.js';

const router = Router();
const wrap = (handler) => async (req, res, next) => { try { await handler(req, res); } catch (error) { if (error.statusCode) res.status(error.statusCode).json({ error: error.message }); else next(error); } };
router.use('/api/lincoln-portal', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos. Intenta nuevamente en 15 minutos.' } });
router.post('/api/lincoln-portal/login', loginLimit, wrap(async (req, res) => {
  const { username, password, staff } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > 128) throw portalError('Credenciales inválidas.', 401);
  let subject;
  if (staff === true) {
    const user = (await getStaffUsers()).find((row) => String(row.username).toLowerCase() === username.trim().toLowerCase());
    if (!await verifyStaffPassword(user, password)) throw portalError('Usuario o contraseña incorrectos, o sin permiso administrativo en Lincoln.', 401);
    subject = { kind: 'staff', userId: user.id };
  } else {
    const state = await readPortal();
    const account = state.accounts.find((row) => row.active && row.username === username.trim().toLowerCase());
    if (!account || !await bcrypt.compare(password, account.passwordHash)) throw portalError('Usuario o contraseña incorrectos.', 401);
    await getPortalEvent(account.eventId);
    subject = { kind: 'client', accountId: account.id, credentialVersion: account.credentialVersion };
  }
  const token = await mutatePortal((state) => newSession(state, subject));
  res.json({ token, kind: subject.kind, ...(subject.kind === 'staff' ? { userId: subject.userId } : {}) });
}));
const authorize = async (req, staffOnly = false) => {
  const raw = String(req.get('Authorization') ?? '').replace(/^Bearer /, '');
  const state = await readPortal();
  const session = state.sessions.find((row) => row.tokenHash === tokenHash(raw) && row.expiresAt > Date.now());
  if (!session) throw portalError('La sesión venció. Ingresa nuevamente.', 401);
  if (session.kind === 'staff') {
    const user = (await getStaffUsers()).find((row) => row.id === session.userId);
    if (!isPortalStaff(user)) throw portalError('Acceso administrativo revocado.', 403);
    return { session, state, name: user.fullName || user.username };
  }
  if (staffOnly) throw portalError('Acceso reservado a Lincoln.', 403);
  const account = state.accounts.find((row) => row.id === session.accountId && row.active && row.credentialVersion === session.credentialVersion);
  if (!account) throw portalError('Acceso revocado. Contacta a Lincoln.', 401);
  return { session, state, account, name: account.name };
};
router.post('/api/lincoln-portal/logout', wrap(async (req, res) => {
  const hash = tokenHash(String(req.get('Authorization') ?? '').replace(/^Bearer /, ''));
  await mutatePortal((state) => { state.sessions = state.sessions.filter((row) => row.tokenHash !== hash); });
  res.json({ ok: true });
}));
router.get('/api/lincoln-portal/accounts', wrap(async (req, res) => {
  const { state } = await authorize(req, true);
  res.json({ accounts: state.accounts.map(publicAccount) });
}));
router.post('/api/lincoln-portal/accounts', wrap(async (req, res) => {
  await authorize(req, true);
  const { eventId, username, password, name } = req.body ?? {};
  await getPortalEvent(String(eventId));
  const normalized = String(username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,50}$/.test(normalized)) throw portalError('Usuario: 3 a 50 letras, números, puntos, guiones o guiones bajos.');
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw portalError('La contraseña debe tener entre 10 y 128 caracteres.');
  const passwordHash = await bcrypt.hash(password, 12);
  const account = await mutatePortal((state) => {
    if (state.accounts.some((row) => row.username === normalized)) throw portalError('Este usuario ya existe.', 409);
    const row = { id: crypto.randomUUID(), eventId: String(eventId), username: normalized, name: String(name || normalized).slice(0, 100), passwordHash, credentialVersion: 1, active: true, createdAt: new Date().toISOString() };
    state.accounts.push(row);
    if (!state.plans[row.eventId]) state.plans[row.eventId] = { revision: 0, plan: starterPlan(), updatedAt: null };
    return publicAccount(row);
  });
  res.status(201).json({ account });
}));
router.patch('/api/lincoln-portal/accounts/:id', wrap(async (req, res) => {
  await authorize(req, true);
  const { active, password } = req.body ?? {};
  if (active !== undefined && typeof active !== 'boolean') throw portalError('Estado inválido.');
  if (password !== undefined && (typeof password !== 'string' || password.length < 10 || password.length > 128)) throw portalError('La contraseña debe tener entre 10 y 128 caracteres.');
  const passwordHash = password === undefined ? null : await bcrypt.hash(password, 12);
  const account = await mutatePortal((state) => {
    const row = state.accounts.find((item) => item.id === req.params.id);
    if (!row) throw portalError('Acceso no encontrado.', 404);
    if (typeof active === 'boolean') row.active = active;
    if (passwordHash) row.passwordHash = passwordHash;
    row.credentialVersion += 1;
    state.sessions = state.sessions.filter((session) => session.accountId !== row.id);
    return publicAccount(row);
  });
  res.json({ account });
}));
const resolveEvent = (auth, requested) => {
  if (auth.account && requested && requested !== auth.account.eventId) throw portalError('No tienes acceso a este evento.', 403);
  const id = auth.account?.eventId || requested;
  if (!id) throw portalError('Selecciona un evento.');
  return id;
};
router.get('/api/lincoln-portal/plan', wrap(async (req, res) => {
  const auth = await authorize(req);
  const id = resolveEvent(auth, req.query.eventId);
  const event = await getPortalEvent(id);
  res.json({ event, ...(auth.state.plans[id] || { revision: 0, plan: starterPlan(), updatedAt: null }), viewer: auth.name });
}));
router.put('/api/lincoln-portal/plan', wrap(async (req, res) => {
  const auth = await authorize(req);
  const id = resolveEvent(auth, req.body?.eventId);
  await getPortalEvent(id);
  const plan = normalizePortalPlan(req.body?.plan);
  const saved = await mutatePortal((state) => {
    // Recheck client access after validation and before committing a queued write.
    if (auth.account && !state.accounts.some((row) => row.id === auth.account.id && row.active && row.credentialVersion === auth.session.credentialVersion)) throw portalError('Acceso revocado.', 401);
    const current = state.plans[id] || { revision: 0 };
    if (req.body?.revision !== current.revision) throw portalError('Otra persona actualizó esta ficha. Recarga para ver los cambios antes de guardar.', 409);
    const value = { revision: current.revision + 1, plan, updatedAt: new Date().toISOString(), updatedBy: auth.name };
    state.plans[id] = value;
    return value;
  });
  res.json(saved);
}));
export default router;
