import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { structuredLogger } from './middleware/logger';
import { errorHandler } from './middleware/error-handler';
import { authMiddleware } from './middleware/auth';
import { claudeRateLimit, documentRateLimit, generalRateLimit } from './middleware/rate-limit';
import { bodySizeLimit, sanitizeInput } from './middleware/sanitize';
import health from './routes/health';
import sync from './routes/sync';
import documents from './routes/documents';
import mcp from './routes/mcp';
import claude from './routes/claude';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use('*', structuredLogger);

// CORS — restrict origins in production, allow all in development
app.use('*', async (c, next) => {
  const allowedRaw = c.env.ALLOWED_ORIGINS;
  const origins = allowedRaw
    ? allowedRaw.split(',').map((o) => o.trim())
    : ['http://localhost:8081', 'http://localhost:19006', 'http://localhost:8787'];

  return cors({
    origin: origins,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'CF-Authorization', 'X-Request-ID'],
    exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
    maxAge: 86400,
    credentials: true,
  })(c, next);
});

// Security headers with Content Security Policy
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
    crossOriginEmbedderPolicy: false, // Workers don't serve HTML directly
  })
);

// Body size limit for all requests (1 MB)
app.use('*', bodySizeLimit());

// Root endpoint
app.get('/', (c) => c.json({ 
  service: 'scribe',
  version: '1.0.0',
  docs: '/health'
}));

// Health routes (no auth required)
app.route('/', health);

// Protected API routes
app.use('/api/*', authMiddleware);

// General rate limit for all API routes
app.use('/api/*', generalRateLimit);

// Input sanitization for mutating API requests
app.use('/api/*', sanitizeInput);

app.get('/api/user', (c) => {
  return c.json({
    userId: c.get('userId'),
    email: c.get('userEmail'),
    name: c.get('userName'),
  });
});

// Sync routes for document collaboration
app.route('/api/sync', sync);

// Document CRUD routes with moderate rate limit
app.use('/api/documents/*', documentRateLimit);
app.route('/api/documents', documents);

// Claude AI routes with strict rate limit
app.use('/api/claude/*', claudeRateLimit);
app.route('/api/claude', claude);

// MCP endpoint (requires auth)
app.route('/mcp', mcp);

// Global error handler
app.onError(errorHandler);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

export default app;

// Export Durable Object
export { DocumentSync } from './durable-objects/DocumentSync';
