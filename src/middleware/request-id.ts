import type { Context, Next } from 'hono';

/**
 * Request ID middleware
 * Generates a UUID for each request (or uses the one from X-Request-ID header).
 * Sets it on the Hono context and adds it to the response headers.
 */
export async function requestId(c: Context, next: Next): Promise<void> {
  const id = c.req.header('X-Request-ID') || crypto.randomUUID();
  c.set('requestId', id);
  c.header('X-Request-ID', id);
  await next();
}
