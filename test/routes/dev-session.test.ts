import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { applyMigrations } from '../helpers';

const post = (e: Record<string, unknown>, secret?: string) =>
  app.request('/api/auth/dev-session', { method: 'POST', headers: secret ? { 'X-Dev-Login': secret } : {} }, { ...env, ...e } as any);

describe('POST /api/auth/dev-session', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it('does not exist in production, even with the secret set', async () => {
    expect((await post({ ENVIRONMENT: 'production', DEV_LOGIN_SECRET: 's3cret' }, 's3cret')).status).toBe(404);
  });

  it('does not exist on a development deploy without a secret configured', async () => {
    expect((await post({ ENVIRONMENT: 'development', DEV_LOGIN_SECRET: undefined }, 'anything')).status).toBe(404);
  });

  it('rejects a missing or wrong secret', async () => {
    expect((await post({ ENVIRONMENT: 'development', DEV_LOGIN_SECRET: 's3cret' })).status).toBe(401);
    expect((await post({ ENVIRONMENT: 'development', DEV_LOGIN_SECRET: 's3cret' }, 'nope')).status).toBe(401);
  });

  it('signs in the fixed test user, and the token works on the API', async () => {
    const e = { ENVIRONMENT: 'development', DEV_LOGIN_SECRET: 's3cret' };
    const res = await post(e, 's3cret');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.user.email).toBe('dev-tester@kecker.co');
    const me = await app.request('/api/auth/session', { headers: { Authorization: `Bearer ${body.token}` } }, env);
    expect(me.status).toBe(200);
    // Repeat calls reuse the same user.
    const again: any = await (await post(e, 's3cret')).json();
    expect(again.user.id).toBe(body.user.id);
  });
});
