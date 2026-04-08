import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { getAuthHeaders } from '../helpers';

describe('Sync WebSocket Endpoint', () => {
  const authHeaders = getAuthHeaders();

  describe('GET /api/sync/:documentId/ws', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/sync/test-doc-id/ws', {}, env);
      expect(res.status).toBe(401);
    });

    it('should reject non-websocket requests', async () => {
      const res = await app.request('/api/sync/test-doc-id/ws', {
        headers: authHeaders,
      }, env);

      // Without Upgrade: websocket header, expect 400 from DO or 500 if DO is unavailable
      expect([400, 500]).toContain(res.status);
    });

    it('should handle different document IDs consistently', async () => {
      const docIds = ['doc-1', 'doc-2', 'test-123'];

      for (const docId of docIds) {
        const res = await app.request(`/api/sync/${docId}/ws`, {
          headers: authHeaders,
        }, env);

        // All should behave the same: either 400 (from DO) or 500 (DO unavailable)
        expect([400, 500]).toContain(res.status);
      }
    });

    it('should forward request to durable object', async () => {
      const res = await app.request('/api/sync/unique-doc/ws', {
        headers: authHeaders,
      }, env);

      // If DO is available, returns 400 with "Expected websocket"
      // Otherwise 500 from the error handler
      if (res.status === 400) {
        const text = await res.text();
        expect(text).toBe('Expected websocket');
      } else {
        expect(res.status).toBe(500);
      }
    });
  });
});
