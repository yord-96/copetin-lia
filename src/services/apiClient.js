const DEFAULT_TIMEOUT_MS = 30000;
const API_BASE_URL = String(import.meta.env?.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiClientError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.payload = payload;
  }
}

const buildUrl = (path, query = null) => {
  const url = new URL(`${API_BASE_URL}${path}`, API_BASE_URL || window.location.origin);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value === null || typeof value === 'undefined' || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return API_BASE_URL ? url.toString() : `${url.pathname}${url.search}`;
};

const parseResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const apiClient = async (path, {
  method = 'GET',
  query = null,
  body = undefined,
  headers = {},
  signal = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(buildUrl(path, query), {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body instanceof FormData || typeof body === 'string' ? body : typeof body === 'undefined' ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      throw new ApiClientError(payload?.error || `Error HTTP ${response.status}`, {
        status: response.status,
        payload,
      });
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new ApiClientError('La solicitud tardo demasiado.', { status: 0 });
    }
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError(error?.message || 'No se pudo completar la solicitud.', { status: 0 });
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
};
