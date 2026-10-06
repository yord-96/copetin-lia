const base = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const key = (staff) => `lincoln-portal-${staff ? 'staff' : 'client'}`;
export const portalSession = (staff = false) => sessionStorage.getItem(key(staff)) || '';
export const portalStaffUser = () => sessionStorage.getItem('lincoln-portal-staff-user') || '';
export const forgetPortalSession = (staff = false) => {
  sessionStorage.removeItem(key(staff));
  if (staff) sessionStorage.removeItem('lincoln-portal-staff-user');
};
export const portalRequest = async (path, { staff = false, method = 'GET', body } = {}) => {
  const response = await fetch(`${base}/api/lincoln-portal${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${portalSession(staff)}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => { throw new Error('No se pudo conectar al portal. Comprueba que el servidor esté iniciado.'); });
  if (!response.ok) {
    if (response.status === 401) forgetPortalSession(staff);
    throw Object.assign(new Error(result.error || 'No se pudo completar la operación.'), { status: response.status });
  }
  return result;
};
export const loginPortal = async (username, password, staff = false) => {
  const result = await portalRequest('/login', { method: 'POST', body: { username, password, staff }, staff });
  sessionStorage.setItem(key(staff), result.token);
  if (staff) sessionStorage.setItem('lincoln-portal-staff-user', String(result.userId));
};
