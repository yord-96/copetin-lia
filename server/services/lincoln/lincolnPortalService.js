import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { getStateSnapshot } from '../../storage/fileStateStore.js';
import { getLincolnStateSnapshot } from '../../storage/lincolnStateStore.js';
import { canAccessCompany, getUserRoleIds } from '../../../src/utils/permissions.js';
import { emptyPlan, planSections, shapeTypes } from '../../../src/components/lincoln/portal/portalModel.js';
import { portalError } from '../../storage/lincolnPortalStore.js';

export const getStaffUsers = async () => {
  const snapshot = await getStateSnapshot();
  if (snapshot.state?.users?.length) return snapshot.state.users;
  if (process.env.NODE_ENV !== 'production') {
    try { return JSON.parse(await fs.readFile('.copetin-shared-db.json', 'utf8')).users ?? []; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return [];
};
export const isPortalStaff = (user) => user && !user.deletedAt && user.status === 'active'
  && canAccessCompany(user, 'lincoln') && getUserRoleIds(user).some((role) => ['developer', 'super_admin', 'admin'].includes(role));
export const verifyStaffPassword = async (user, password) => {
  if (!isPortalStaff(user) || typeof password !== 'string' || !password) return false;
  if (String(user.passwordHash).startsWith('$2')) return bcrypt.compare(password, user.passwordHash);
  // Compatibility with the application's existing staff password format.
  let hash = 2166136261;
  for (let i = 0; i < password.length; i += 1) { hash ^= password.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  const expected = Buffer.from(`fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`);
  const actual = Buffer.from(String(user.passwordHash ?? ''));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};
export const getPortalEvent = async (id) => {
  const snapshot = await getLincolnStateSnapshot();
  const event = snapshot.state.events.find((row) => String(row.id) === id);
  if (!event || event.status === 'cancelled') throw portalError('Evento no disponible.', 404);
  return { id: event.id, code: event.contractCode || event.code, name: event.eventName || event.eventType || 'Evento', clientName: event.clientName || event.contractor1Name, date: event.eventDate, time: event.eventTime, room: event.roomName || snapshot.state.rooms.find((room) => room.id === event.roomId)?.name || '', guests: event.guestCount || event.peopleCount || 0 };
};
const text = (value, limit = 3000) => String(value ?? '').slice(0, limit);
const number = (value, min, max) => Math.min(max, Math.max(min, Number(value) || min));
export const normalizePortalPlan = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw portalError('Ficha inválida.');
  const plan = emptyPlan();
  for (const [key, section] of Object.entries(planSections)) {
    if (!Array.isArray(input[key]) || input[key].length > 2000) throw portalError(`Lista inválida: ${section.label}.`);
    const ids = new Set();
    plan[key] = input[key].map((row) => {
      if (!row || typeof row !== 'object') throw portalError('Fila inválida.');
      const id = text(row.id, 100) || crypto.randomUUID();
      if (ids.has(id)) throw portalError('Hay filas duplicadas.');
      ids.add(id);
      return { id, ...Object.fromEntries(section.fields.map(([field, , kind]) => {
        if (Array.isArray(kind) && !kind.includes(row[field])) return [field, kind[0]];
        return [field, kind === 'number' ? number(row[field], field === 'people' ? 1 : 0, 10000) : text(row[field])];
      })) };
    });
  }
  plan.notes = text(input.notes, 10000);
  const layout = input.layout;
  if (!layout || !Array.isArray(layout.objects) || layout.objects.length > 500) throw portalError('Croquis inválido (máximo 500 elementos).');
  const width = number(layout.width, 400, 3000), height = number(layout.height, 300, 2000);
  const ids = new Set();
  plan.layout = { width, height, objects: layout.objects.map((item) => {
    if (!item || !Object.hasOwn(shapeTypes, item.type)) throw portalError('Figura no válida.');
    const id = text(item.id, 100) || crypto.randomUUID();
    if (ids.has(id)) throw portalError('Hay figuras duplicadas.');
    ids.add(id);
    return { id, type: item.type, label: text(item.label, 80), x: number(item.x, 0, width), y: number(item.y, 0, height), width: number(item.width, 15, 500), height: number(item.height, 15, 500), rotation: number(item.rotation, 0, 360), seats: Math.round(number(item.seats, 0, 100)) };
  }) };
  return plan;
};
export const publicAccount = ({ id, eventId, username, name, active, createdAt }) => ({ id, eventId, username, name, active, createdAt });
