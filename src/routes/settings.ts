import { Hono } from 'hono';
import type { Env } from '../types';
import { getEphemeralTtlDays, setEphemeralTtlDays } from '../services/ephemeral';

const settings = new Hono<{ Bindings: Env }>();

/**
 * App-wide settings (not per-user — see services/ephemeral.ts for why).
 * GET /api/settings
 */
settings.get('/', async (c) => {
  const ephemeralTtlDays = await getEphemeralTtlDays(c.env);
  return c.json({ ephemeralTtlDays });
});

/**
 * PATCH /api/settings { ephemeralTtlDays }
 */
settings.patch('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const days = Number(body.ephemeralTtlDays);

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return c.json({ error: 'ephemeralTtlDays must be an integer between 1 and 365' }, 400);
  }

  const ephemeralTtlDays = await setEphemeralTtlDays(c.env, days);
  return c.json({ ephemeralTtlDays });
});

export default settings;
