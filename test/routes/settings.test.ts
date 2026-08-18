import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { applyMigrations, getAuthHeaders } from '../helpers';

describe('Settings API', () => {
  const authHeaders = getAuthHeaders();

  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM app_settings').run();
  });

  describe('GET /api/settings', () => {
    it('requires authentication', async () => {
      const res = await app.request('/api/settings', {}, env);
      expect(res.status).toBe(401);
    });

    it('returns the default TTL when unset', async () => {
      const res = await app.request('/api/settings', { headers: authHeaders }, env);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.ephemeralTtlDays).toBe(30);
    });
  });

  describe('PATCH /api/settings', () => {
    it('requires authentication', async () => {
      const res = await app.request('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ ephemeralTtlDays: 7 }),
        headers: { 'Content-Type': 'application/json' },
      }, env);
      expect(res.status).toBe(401);
    });

    it('rejects out-of-range values', async () => {
      const res = await app.request('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ ephemeralTtlDays: 0 }),
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
      }, env);
      expect(res.status).toBe(400);
    });

    it('updates and persists the TTL', async () => {
      const patchRes = await app.request('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ ephemeralTtlDays: 7 }),
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
      }, env);
      expect(patchRes.status).toBe(200);
      const patchData: any = await patchRes.json();
      expect(patchData.ephemeralTtlDays).toBe(7);

      const getRes = await app.request('/api/settings', { headers: authHeaders }, env);
      const getData: any = await getRes.json();
      expect(getData.ephemeralTtlDays).toBe(7);
    });
  });
});
