import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from './middleware/request-id';
import { structuredLogger } from './middleware/logger';
import { errorHandler } from './middleware/error-handler';
import { authMiddleware } from './middleware/auth';
import { claudeRateLimit, documentRateLimit, generalRateLimit } from './middleware/rate-limit';
import { bodySizeLimit, sanitizeInput } from './middleware/sanitize';
import health from './routes/health';
import sync from './routes/sync';
import documents from './routes/documents';
import claude from './routes/claude';
import auth from './routes/auth';
import { ScribeMCP } from './mcp/scribe-mcp';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// Request ID must be first so all downstream middleware/handlers have it
app.use('*', requestId);

// Global middleware
app.use('*', structuredLogger);

// CORS — restrict origins in production, allow all in development
app.use('*', async (c, next) => {
  const allowedRaw = c.env.ALLOWED_ORIGINS;
  const origins = allowedRaw
    ? allowedRaw.split(',').map((o) => o.trim())
    : c.env.ENVIRONMENT === 'production'
      ? [] // No CORS in production without explicit config
      : ['http://localhost:8081', 'http://localhost:19006', 'http://localhost:8787'];

  return cors({
    origin: (origin) => {
      if (origins.includes('*')) return origin || '*';
      return origins.includes(origin) ? origin : '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'CF-Authorization', 'X-Request-ID', 'X-API-Key'],
    exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
    maxAge: 86400,
    credentials: true,
  })(c, next);
});

// Security headers — disable CSP and CORP for API routes (conflicts with CORS)
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
  })
);

// Body size limit for all requests (1 MB)
app.use('*', bodySizeLimit());

// Root endpoint
app.get('/', (c) => c.json({ 
  service: 'scribe',
  version: '1.0.0',
  mcp: '/mcp',
  docs: '/health',
  description: 'Connect Claude Desktop/Code to /mcp to use your Claude subscription as a Scribe connector',
}));

// Health routes (no auth required)
app.route('/', health);

// Protected API routes — exempt auth public endpoints
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/api/auth/request-otp' || path === '/api/auth/verify-otp') {
    return next();
  }
  return authMiddleware(c, next);
});

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

// Auth routes (request-otp and verify-otp are public, session/logout require auth)
app.route('/api/auth', auth);

// Document CRUD routes with moderate rate limit
app.use('/api/documents/*', documentRateLimit);
app.route('/api/documents', documents);

// Claude AI routes with strict rate limit
app.use('/api/claude/*', claudeRateLimit);
app.route('/api/claude', claude);

// Global error handler
app.onError(errorHandler);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// MCP handler — routes /mcp to the ScribeMCP Durable Object
const mcpHandler = ScribeMCP.serve("/mcp", { binding: "SCRIBE_MCP" });

/**
 * Validate MCP authentication via Bearer token.
 * In dev mode (ENVIRONMENT !== 'production'), auth is skipped.
 * If no MCP_AUTH_TOKEN is configured, auth is skipped (for initial setup).
 */
function validateMcpAuth(request: Request, env: Env): Response | null {
  // Skip auth in dev/test
  if (env.ENVIRONMENT && env.ENVIRONMENT !== 'production') {
    return null;
  }

  // No token configured — block in production, allow in dev
  if (!env.MCP_AUTH_TOKEN) {
    if (!env.ENVIRONMENT || env.ENVIRONMENT === 'production') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'MCP auth not configured' },
          id: null,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return null; // Allow in dev
  }

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token === env.MCP_AUTH_TOKEN) {
      return null; // Auth passed
    }
  }

  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Unauthorized: provide Authorization: Bearer <token> header',
      },
      id: null,
    }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/mcp')) {
      const authError = await validateMcpAuth(request, env);
      if (authError) return authError;
      return mcpHandler.fetch(request, env, ctx);
    }
    return app.fetch(request, env, ctx);
  },
};

// Export Hono app for testing
export { app };

// Export Durable Object classes
export { DocumentSync } from './durable-objects/DocumentSync';
export { ScribeMCP } from './mcp/scribe-mcp';
