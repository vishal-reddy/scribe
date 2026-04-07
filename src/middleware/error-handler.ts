import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { reportError } from '../lib/error-reporter';
import type { Env } from '../types';

/**
 * Error codes for categorization
 */
export enum ErrorCode {
  // Validation errors (4xx)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_REQUEST = 'INVALID_REQUEST',
  
  // Authentication/Authorization errors (401, 403)
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  
  // Resource errors (404, 409)
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  
  // Rate limiting (429)
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // Server errors (5xx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
}

/**
 * Custom application error
 */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Error response structure
 */
interface ErrorResponse {
  error: {
    code: ErrorCode | string;
    message: string;
    details?: unknown;
    requestId: string;
    timestamp: string;
    stack?: string;
  };
}

/**
 * Global error handler
 * Catches all errors and returns consistent error responses
 */
export function errorHandler(err: Error, c: Context<{ Bindings: Env }>): Response {
  const requestId = c.get('requestId') || 'unknown';
  const isDevelopment = c.env?.ENVIRONMENT !== 'production';

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const validationErrors = err.issues.map((e) => ({
      path: e.path.map(String).join('.'),
      message: e.message,
    }));

    console.error(JSON.stringify({
      type: 'validation_error',
      requestId,
      errors: validationErrors,
      timestamp: new Date().toISOString(),
    }));

    const response: ErrorResponse = {
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: validationErrors,
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response, 400);
  }

  // Handle custom app errors
  if (err instanceof AppError) {
    // Report 5xx app errors via structured logging + Sentry
    if (err.statusCode >= 500) {
      reportError(err, c, 'error');
    } else {
      console.error(JSON.stringify({
        type: 'app_error',
        requestId,
        code: err.code,
        status: err.statusCode,
        message: err.message,
        details: err.details,
        timestamp: new Date().toISOString(),
      }));
    }

    const response: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
        timestamp: new Date().toISOString(),
        ...(isDevelopment && { stack: err.stack }),
      },
    };

    return c.json(response, err.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503);
  }

  // Handle HTTP exceptions from Hono
  if (err instanceof HTTPException) {
    const code = err.status === 401 ? ErrorCode.UNAUTHORIZED :
                 err.status === 403 ? ErrorCode.FORBIDDEN :
                 err.status === 404 ? ErrorCode.NOT_FOUND :
                 err.status === 409 ? ErrorCode.CONFLICT :
                 err.status === 429 ? ErrorCode.RATE_LIMIT_EXCEEDED :
                 ErrorCode.INVALID_REQUEST;

    console.error(JSON.stringify({
      type: 'http_error',
      requestId,
      status: err.status,
      code,
      message: err.message,
      timestamp: new Date().toISOString(),
    }));

    const response: ErrorResponse = {
      error: {
        code,
        message: err.message,
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response, err.status);
  }

  // Handle unexpected errors — always report to Sentry
  reportError(err, c, 'fatal');

  const response: ErrorResponse = {
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: isDevelopment ? err.message : 'Internal server error',
      requestId,
      timestamp: new Date().toISOString(),
      ...(isDevelopment && { stack: err.stack }),
    },
  };

  return c.json(response, 500);
}
