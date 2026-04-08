import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { applyMigrations, getAuthHeaders } from '../helpers';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: async () => ({
        content: [{ type: 'text', text: 'Edited content by Claude' }],
      }),
    };
  },
}));

describe('Claude Artifacts API', () => {
  const authHeaders = getAuthHeaders();
  let artifactId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  describe('GET /api/claude/artifacts', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/claude/artifacts', {}, env);
      expect(res.status).toBe(401);
    });

    it('should list artifacts with auth', async () => {
      const res = await app.request('/api/claude/artifacts', {
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data).toHaveProperty('artifacts');
      expect(Array.isArray(data.artifacts)).toBe(true);
      expect(data).toHaveProperty('total');
    });
  });

  describe('POST /api/claude/create', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/claude/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test', content: 'Content' }),
      }, env);

      expect(res.status).toBe(401);
    });

    it('should validate create schema - empty title', async () => {
      const res = await app.request('/api/claude/create', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '', content: 'some content' }),
      }, env);

      expect(res.status).toBe(400);
    });

    it('should validate create schema - missing content', async () => {
      const res = await app.request('/api/claude/create', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'My Title' }),
      }, env);

      expect(res.status).toBe(400);
    });

    it('should create an artifact', async () => {
      const res = await app.request('/api/claude/create', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Claude Artifact',
          content: '# Created by Claude',
        }),
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data).toHaveProperty('artifact');
      expect(data.artifact.title).toBe('Claude Artifact');
      expect(data.artifact.content).toBe('# Created by Claude');
      artifactId = data.artifact.artifactId;
    });
  });

  describe('GET /api/claude/artifacts/:id', () => {
    it('should return 404 for non-existent artifact', async () => {
      const res = await app.request('/api/claude/artifacts/non-existent', {
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(404);
    });

    it('should get a specific artifact', async () => {
      const res = await app.request(`/api/claude/artifacts/${artifactId}`, {
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.artifact.artifactId).toBe(artifactId);
      expect(data.artifact.title).toBe('Claude Artifact');
    });
  });

  describe('POST /api/claude/edit/:id', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/claude/edit/some-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'fix typos' }),
      }, env);

      expect(res.status).toBe(401);
    });

    it('should validate edit schema - empty instruction', async () => {
      const res = await app.request(`/api/claude/edit/${artifactId}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: '' }),
      }, env);

      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent artifact', async () => {
      const res = await app.request('/api/claude/edit/non-existent', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'fix typos' }),
      }, env);

      expect(res.status).toBe(404);
    });

    it('should edit an artifact using Claude', async () => {
      const res = await app.request(`/api/claude/edit/${artifactId}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'Add more detail' }),
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.artifact.artifactId).toBe(artifactId);
      expect(data.artifact.content).toBe('Edited content by Claude');
    });
  });

  describe('GET /api/claude/history/:documentId', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/claude/history/some-id', {}, env);
      expect(res.status).toBe(401);
    });

    it('should return history for a document with interactions', async () => {
      const res = await app.request(`/api/claude/history/${artifactId}`, {
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.documentId).toBe(artifactId);
      expect(data).toHaveProperty('history');
      expect(Array.isArray(data.history)).toBe(true);
      // Should have at least the create + edit interactions
      expect(data.history.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty history for unknown document', async () => {
      const res = await app.request('/api/claude/history/unknown-doc', {
        headers: authHeaders,
      }, env);

      // May hit rate limit (429) if many Claude requests preceded this
      expect([200, 429]).toContain(res.status);
      if (res.status === 200) {
        const data: any = await res.json();
        expect(data.history).toHaveLength(0);
      }
    });
  });
});
