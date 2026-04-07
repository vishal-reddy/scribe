import axios, { AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

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

  /** True when the device appears to be offline or the server is unreachable */
  get isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR';
  }

  /** True for 401/403/token-expired responses */
  get isAuthError(): boolean {
    return (
      this.code === 'UNAUTHORIZED' ||
      this.code === 'FORBIDDEN' ||
      this.code === 'TOKEN_EXPIRED'
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isNetworkError(error: AxiosError): boolean {
  if (!error.response && error.code === 'ERR_NETWORK') return true;
  if (error.message === 'Network Error') return true;
  if (error.code === 'ECONNABORTED') return true;
  return false;
}

/**
 * Parse the backend's structured error envelope into an ApiError.
 * Falls back to generic values when the response shape is unexpected.
 */
function parseApiError(error: AxiosError): ApiError {
  // Timeout
  if (error.code === 'ECONNABORTED') {
    return new ApiError('TIMEOUT', 0, 'Request timed out. Please try again.');
  }

  // Offline / unreachable
  if (isNetworkError(error)) {
    return new ApiError(
      'NETWORK_ERROR',
      0,
      'Unable to reach the server. Please check your connection.'
    );
  }

  // Server responded with an error payload
  const status = error.response?.status ?? 500;
  const data = error.response?.data as
    | { error?: { code?: string; message?: string; details?: unknown; requestId?: string } }
    | undefined;

  const body = data?.error;

  return new ApiError(
    (body?.code as ApiErrorCode) ?? 'INTERNAL_ERROR',
    status,
    body?.message ?? error.message ?? 'An unexpected error occurred',
    body?.details,
    body?.requestId
  );
}

// ─── Client setup ───────────────────────────────────────────────────────────

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8787';

const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor — add auth token + request ID
apiClient.interceptors.request.use(
  async (config) => {
    const token = await SecureStore.getItemAsync('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Generate a client-side request ID so logs can be correlated
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      config.headers['X-Request-ID'] = crypto.randomUUID();
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — normalise errors into ApiError
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const apiError = parseApiError(error);

    if (apiError.isAuthError) {
      await SecureStore.deleteItemAsync('auth_token');
      await SecureStore.deleteItemAsync('user_email');
    }

    return Promise.reject(apiError);
  }
);

export default apiClient;
