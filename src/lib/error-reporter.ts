import type { Context } from 'hono';
import type { Env } from '../types';

interface ErrorReport {
  error: {
    message: string;
    name: string;
    stack?: string;
  };
  context: {
    requestId: string;
    method: string;
    path: string;
    userId?: string;
    userEmail?: string;
    environment?: string;
  };
  severity: 'error' | 'warning' | 'fatal';
  timestamp: string;
}

/**
 * Build an error report from a Hono context and error
 */
function buildReport(
  err: Error,
  c: Context<{ Bindings: Env }>,
  severity: ErrorReport['severity'] = 'error'
): ErrorReport {
  return {
    error: {
      message: err.message,
      name: err.name,
      stack: err.stack,
    },
    context: {
      requestId: c.get('requestId') || 'unknown',
      method: c.req.method,
      path: c.req.path,
      userId: c.get('userId'),
      userEmail: c.get('userEmail'),
      environment: c.env?.ENVIRONMENT || 'development',
    },
    severity,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Log a structured error to Cloudflare's log pipeline
 */
function logStructuredError(report: ErrorReport): void {
  console.error(JSON.stringify({
    type: 'error_report',
    ...report,
  }));
}

/**
 * Parse a Sentry DSN into its components.
 * DSN format: https://{public_key}@{host}/{project_id}
 */
function parseSentryDsn(dsn: string): { publicKey: string; host: string; projectId: string } | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const host = url.hostname;
    const projectId = url.pathname.replace('/', '');
    if (!publicKey || !projectId) return null;
    return { publicKey, host, projectId };
  } catch {
    return null;
  }
}

/**
 * Send error to Sentry via their HTTP store endpoint.
 * Uses the lightweight envelope API compatible with Cloudflare Workers.
 */
async function sendToSentry(report: ErrorReport, dsn: string): Promise<void> {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) {
    console.warn('Invalid SENTRY_DSN format, skipping Sentry report');
    return;
  }

  const { publicKey, host, projectId } = parsed;
  const sentryUrl = `https://${host}/api/${projectId}/store/`;

  const payload = {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: report.timestamp,
    platform: 'javascript',
    level: report.severity === 'fatal' ? 'fatal' : 'error',
    logger: 'scribe-workers',
    server_name: 'cloudflare-workers',
    environment: report.context.environment,
    exception: {
      values: [
        {
          type: report.error.name,
          value: report.error.message,
          stacktrace: report.error.stack
            ? { frames: parseStackFrames(report.error.stack) }
            : undefined,
        },
      ],
    },
    tags: {
      requestId: report.context.requestId,
      method: report.context.method,
      path: report.context.path,
    },
    user: report.context.userId
      ? { id: report.context.userId, email: report.context.userEmail }
      : undefined,
    request: {
      method: report.context.method,
      url: report.context.path,
      headers: { 'X-Request-ID': report.context.requestId },
    },
  };

  try {
    await fetch(sentryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=scribe-workers/1.0`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Never let Sentry reporting break the request
    console.warn('Failed to send to Sentry:', (err as Error).message);
  }
}

/**
 * Minimal stack frame parser for Sentry
 */
function parseStackFrames(stack: string): Array<{ filename?: string; function?: string; lineno?: number; colno?: number }> {
  return stack
    .split('\n')
    .slice(1, 10) // skip first line (message), limit frames
    .map((line) => {
      const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
      if (match) {
        return {
          function: match[1],
          filename: match[2],
          lineno: parseInt(match[3], 10),
          colno: parseInt(match[4], 10),
        };
      }
      const simpleMatch = line.match(/at\s+(.+?):(\d+):(\d+)/);
      if (simpleMatch) {
        return {
          filename: simpleMatch[1],
          lineno: parseInt(simpleMatch[2], 10),
          colno: parseInt(simpleMatch[3], 10),
        };
      }
      return { function: line.trim() };
    });
}

/**
 * Report an error with structured logging and optional Sentry forwarding.
 * Safe to call in any context — never throws.
 */
export async function reportError(
  err: Error,
  c: Context<{ Bindings: Env }>,
  severity: ErrorReport['severity'] = 'error'
): Promise<void> {
  const report = buildReport(err, c, severity);

  // Always log structured JSON (consumed by Cloudflare's log pipeline)
  logStructuredError(report);

  // Optionally forward to Sentry
  const sentryDsn = c.env?.SENTRY_DSN;
  if (sentryDsn) {
    // Use waitUntil so we don't block the response
    const ctx = c.executionCtx;
    if (ctx && 'waitUntil' in ctx) {
      (ctx as ExecutionContext).waitUntil(sendToSentry(report, sentryDsn));
    } else {
      await sendToSentry(report, sentryDsn);
    }
  }
}

export type { ErrorReport };
