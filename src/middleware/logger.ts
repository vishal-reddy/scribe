import { Context, Next } from 'hono';
import type { Env } from '../types';

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Structured logger
 */
export class Logger {
  constructor(
    private requestId: string,
    private context: Record<string, unknown> = {}
  ) {}

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    console.log(JSON.stringify({
      level,
      message,
      requestId: this.requestId,
      timestamp: new Date().toISOString(),
      ...this.context,
      ...data,
    }));
  }

  debug(message: string, data?: Record<string, unknown>) {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: Record<string, unknown>) {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, error?: Error, data?: Record<string, unknown>) {
    this.log(LogLevel.ERROR, message, {
      error: error?.message,
      stack: error?.stack,
      ...data,
    });
  }
}

/**
 * Performance thresholds (ms)
 */
const PERF_THRESHOLDS = {
  SLOW_REQUEST: 1000,
  VERY_SLOW_REQUEST: 3000,
};

/**
 * Track metrics to Cloudflare Analytics
 */
function trackMetrics(
  c: Context<{ Bindings: Env }>,
  method: string,
  path: string,
  status: number,
  duration: number
) {
  // Check if Analytics binding is available
  const analytics = (c.env as any).ANALYTICS;
  if (!analytics?.writeDataPoint) return;

  try {
    analytics.writeDataPoint({
      blobs: [method, path, status.toString()],
      doubles: [duration],
      indexes: [`${method}:${path}`],
    });
  } catch (err) {
    // Don't fail the request if analytics fails
    console.error('Analytics error:', err);
  }
}

/**
 * Structured logging middleware
 * Logs request/response with timing and metadata
 */
export async function structuredLogger(c: Context<{ Bindings: Env }>, next: Next) {
  const start = Date.now();

  // requestId is already set by the request-id middleware
  const reqId = c.get('requestId') || crypto.randomUUID();
  
  const logger = new Logger(reqId, {
    userId: c.get('userId'),
    userEmail: c.get('userEmail'),
  });

  // Log request
  logger.info('Request received', {
    method: c.req.method,
    path: c.req.path,
    userAgent: c.req.header('user-agent'),
    ip: c.req.header('cf-connecting-ip'),
  });

  let error: Error | undefined;
  try {
    await next();
  } catch (err) {
    error = err as Error;
    throw err;
  } finally {
    // Log response
    const duration = Date.now() - start;
    const status = c.res.status;

    // Determine log level based on status and performance
    let level = LogLevel.INFO;
    if (error || status >= 500) {
      level = LogLevel.ERROR;
    } else if (status >= 400) {
      level = LogLevel.WARN;
    } else if (duration > PERF_THRESHOLDS.VERY_SLOW_REQUEST) {
      level = LogLevel.WARN;
    }

    const logData = {
      method: c.req.method,
      path: c.req.path,
      status,
      duration,
      slow: duration > PERF_THRESHOLDS.SLOW_REQUEST,
      verySlow: duration > PERF_THRESHOLDS.VERY_SLOW_REQUEST,
    };

    if (level === LogLevel.ERROR) {
      logger.error('Request failed', error, logData);
    } else if (level === LogLevel.WARN) {
      logger.warn('Request completed with warning', logData);
    } else {
      logger.info('Request completed', logData);
    }

    // Track metrics to Cloudflare Analytics
    trackMetrics(c, c.req.method, c.req.path, status, duration);
  }
}
