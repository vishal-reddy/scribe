import { Hono } from 'hono';
import type { Env } from '../types';

const health = new Hono<{ Bindings: Env }>();

/**
 * Basic health check
 * GET /health
 */
health.get('/health', async (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'scribe',
    version: '1.0.0',
  });
});

/**
 * Readiness check (includes dependencies)
 * GET /ready
 */
health.get('/ready', async (c) => {
  const checks = {
    database: false,
    durableObjects: false,
  };

  try {
    // Check D1 database connection
    const result = await c.env.DB.prepare('SELECT 1 as ok').first();
    checks.database = result?.ok === 1;
  } catch (error) {
    console.error('Database health check failed:', error);
  }

  // Durable Objects are always available if binding exists
  checks.durableObjects = !!c.env.DOCUMENT_SYNC;

  const allHealthy = Object.values(checks).every((check) => check === true);

  return c.json(
    {
      status: allHealthy ? 'ready' : 'not ready',
      timestamp: new Date().toISOString(),
      checks,
    },
    allHealthy ? 200 : 503
  );
});

export default health;
