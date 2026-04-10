import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// ─── Configuration ──────────────────────────────────────────────────────────

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8787';
const API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';

// ─── Typed API Error ────────────────────────────────────────────────────────

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TOKEN_EXPIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INTERNAL_ERROR'
  | 'DATABASE_ERROR'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT';

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    public statusCode: number,
    message: string,
    public details?: unknown,
    public requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR';
  }

  get isAuthError(): boolean {
    return (
      this.code === 'UNAUTHORIZED' ||
      this.code === 'FORBIDDEN' ||
      this.code === 'TOKEN_EXPIRED'
    );
  }
}

// ─── Storage helper ─────────────────────────────────────────────────────────

function getStoredEmail(): string | null {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      return localStorage.getItem('user_email');
    }
  } catch {}
  return null;
}

// ─── Core fetch wrapper ─────────────────────────────────────────────────────

async function buildHeaders(
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };

  // Try session token first (new OTP auth)
  let sessionToken: string | null = null;
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      sessionToken = localStorage.getItem('session_token');
    } else {
      sessionToken = await SecureStore.getItemAsync('session_token');
    }
  } catch {}

  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  } else if (API_KEY) {
    // Fallback to API key (legacy/admin)
    headers['X-API-Key'] = API_KEY;
    // User identity from email storage
    let email: string | null = getStoredEmail();
    if (!email && Platform.OS !== 'web') {
      try {
        email = await SecureStore.getItemAsync('user_email');
      } catch {}
    }
    if (email) {
      headers['X-User-Email'] = email;
    }
  }

  // Request correlation
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    headers['X-Request-ID'] = crypto.randomUUID();
  }

  return headers;
}

function parseErrorBody(body: any): { code?: string; message?: string; details?: unknown; requestId?: string } {
  if (typeof body === 'object' && body?.error) {
    if (typeof body.error === 'string') return { message: body.error };
    return body.error;
  }
  return {};
}

function statusToCode(status: number): ApiErrorCode {
  switch (status) {
    case 400: return 'VALIDATION_ERROR';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 429: return 'RATE_LIMIT_EXCEEDED';
    default: return 'INTERNAL_ERROR';
  }
}

/**
 * Type-safe API client using native fetch.
 * Automatically injects API key, user email, and request ID headers.
 */
async function apiFetch<T = any>(
  path: string,
  options: RequestInit & { params?: Record<string, string | number> } = {}
): Promise<T> {
  const { params, headers: extraHeaders, ...fetchOptions } = options;

  // Build URL with query params
  let url = `${API_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString();
    url += `?${qs}`;
  }

  const headers = await buildHeaders(extraHeaders as Record<string, string>);

  let resp: Response;
  try {
    resp = await fetch(url, { ...fetchOptions, headers });
  } catch (err: any) {
    throw new ApiError(
      'NETWORK_ERROR',
      0,
      err.message === 'Failed to fetch'
        ? 'Unable to reach the server. Please check your connection.'
        : err.message || 'Network error'
    );
  }

  if (!resp.ok) {
    let body: any = {};
    try {
      body = await resp.json();
    } catch {
      try {
        body = { error: { message: await resp.text() } };
      } catch {}
    }

    const parsed = parseErrorBody(body);

    // Clear stored auth on auth errors
    if (resp.status === 401 || resp.status === 403) {
      try {
        if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
          localStorage.removeItem('session_token');
          localStorage.removeItem('user_data');
          localStorage.removeItem('user_email');
        } else {
          await SecureStore.deleteItemAsync('session_token');
          await SecureStore.deleteItemAsync('user_data');
          await SecureStore.deleteItemAsync('user_email');
        }
      } catch {}
    }

    throw new ApiError(
      (parsed.code as ApiErrorCode) ?? statusToCode(resp.status),
      resp.status,
      parsed.message ?? `Request failed with status ${resp.status}`,
      parsed.details,
      parsed.requestId
    );
  }

  // Handle 204 No Content
  if (resp.status === 204) return undefined as T;

  return resp.json() as Promise<T>;
}

// ─── Public API ─────────────────────────────────────────────────────────────

const apiClient = {
  get: <T = any>(path: string, opts?: { params?: Record<string, string | number> }) =>
    apiFetch<T>(path, { method: 'GET', ...opts }),

  post: <T = any>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),

  patch: <T = any>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),

  put: <T = any>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),

  delete: <T = any>(path: string) =>
    apiFetch<T>(path, { method: 'DELETE' }),
};

export default apiClient;
