import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';

describe('Health Endpoints', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await app.request('/health', {}, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data).toMatchObject({
        status: 'ok',
        service: 'scribe',
        version: '1.0.0',
      });
      expect(data.timestamp).toBeDefined();
    });

    it('should return valid ISO timestamp', async () => {
      const res = await app.request('/health', {}, env);
      const data: any = await res.json();

      const timestamp = new Date(data.timestamp);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeGreaterThan(0);
    });
  });

  describe('GET /ready', () => {
    it('should return readiness status with checks', async () => {
      const res = await app.request('/ready', {}, env);

      expect([200, 503]).toContain(res.status);
      const data: any = await res.json();
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('checks');
      expect(data.checks).toHaveProperty('database');
      expect(data.checks).toHaveProperty('durableObjects');
    });

    it('should report boolean for each check', async () => {
      const res = await app.request('/ready', {}, env);
      const data: any = await res.json();

      expect(typeof data.checks.database).toBe('boolean');
      expect(typeof data.checks.durableObjects).toBe('boolean');
    });

    it('should return 200 when all checks pass', async () => {
      const res = await app.request('/ready', {}, env);
      const data: any = await res.json();

      if (data.checks.database && data.checks.durableObjects) {
        expect(res.status).toBe(200);
        expect(data.status).toBe('ready');
      }
    });

    it('should return 503 when not ready', async () => {
      const res = await app.request('/ready', {}, env);
      const data: any = await res.json();

      if (!data.checks.database || !data.checks.durableObjects) {
        expect(res.status).toBe(503);
        expect(data.status).toBe('not ready');
      }
    });
  });
});
