import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../../src/index';
import { applyMigrations, getAuthHeaders } from '../helpers';

describe('Document CRUD API', () => {
  const authHeaders = getAuthHeaders();
  let createdDocId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  describe('GET /api/documents', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/documents', {}, env);
      expect(res.status).toBe(401);
    });

    it('should list documents with auth', async () => {
      const res = await app.request('/api/documents', {
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data).toHaveProperty('documents');
      expect(Array.isArray(data.documents)).toBe(true);
    });
  });

  describe('POST /api/documents', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/documents', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test' }),
        headers: { 'Content-Type': 'application/json' },
      }, env);

      expect(res.status).toBe(401);
    });

    it('should create a new document', async () => {
      const res = await app.request('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Test Document',
          markdown: '# Hello World',
        }),
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data).toHaveProperty('document');
      expect(data.document.title).toBe('Test Document');
      expect(data.document.markdown).toBe('# Hello World');
      expect(data.document).toHaveProperty('id');
      createdDocId = data.document.id;
    });

    it('should validate required fields', async () => {
      const res = await app.request('/api/documents', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
      }, env);

      expect(res.status).toBe(400);
    });

    it('should set createdBy and lastEditedBy to user', async () => {
      const res = await app.request('/api/documents', {
        method: 'POST',
        body: JSON.stringify({ title: 'User Created Doc' }),
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.document.createdBy).toBe('user');
      expect(data.document.lastEditedBy).toBe('user');
    });
  });

  describe('GET /api/documents/:id', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/documents/some-id', {}, env);
      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent document', async () => {
      const res = await app.request('/api/documents/non-existent-id', {
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(404);
    });

    it('should get document by id', async () => {
      const res = await app.request(`/api/documents/${createdDocId}`, {
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data).toHaveProperty('document');
      expect(data.document.id).toBe(createdDocId);
    });
  });

  describe('PATCH /api/documents/:id', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/documents/some-id', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      }, env);

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent document', async () => {
      const res = await app.request('/api/documents/non-existent-id', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
      }, env);

      expect(res.status).toBe(404);
    });

    it('should update document title', async () => {
      const res = await app.request(`/api/documents/${createdDocId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.document.title).toBe('Updated Title');
    });

    it('should update document markdown', async () => {
      const res = await app.request(`/api/documents/${createdDocId}`, {
        method: 'PATCH',
        body: JSON.stringify({ markdown: '# Updated Content' }),
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.document.markdown).toBe('# Updated Content');
    });

    it('should update lastEditedBy to user', async () => {
      const res = await app.request(`/api/documents/${createdDocId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Test' }),
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.document.lastEditedBy).toBe('user');
    });
  });

  describe('GET /api/documents/:id/versions', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/documents/some-id/versions', {}, env);
      expect(res.status).toBe(401);
    });

    it('should return empty array for document with no versions', async () => {
      const res = await app.request(`/api/documents/${createdDocId}/versions`, {
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data).toHaveProperty('versions');
      expect(Array.isArray(data.versions)).toBe(true);
    });
  });

  describe('POST /api/documents/:id/versions', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/documents/some-id/versions', {
        method: 'POST',
      }, env);

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent document', async () => {
      const res = await app.request('/api/documents/non-existent-id/versions', {
        method: 'POST',
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(404);
    });

    it('should create version snapshot', async () => {
      const res = await app.request(`/api/documents/${createdDocId}/versions`, {
        method: 'POST',
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data).toHaveProperty('version');
      expect(data.version).toHaveProperty('id');
      expect(data.version.version).toBe(1);
      expect(data.version.documentId).toBe(createdDocId);
    });

    it('should increment version number', async () => {
      const res = await app.request(`/api/documents/${createdDocId}/versions`, {
        method: 'POST',
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.version.version).toBe(2);
    });
  });

  describe('DELETE /api/documents/:id', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/documents/some-id', {
        method: 'DELETE',
      }, env);

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent document', async () => {
      const res = await app.request('/api/documents/non-existent-id', {
        method: 'DELETE',
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(404);
    });

    it('should delete document', async () => {
      const res = await app.request(`/api/documents/${createdDocId}`, {
        method: 'DELETE',
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('Document deleted');
    });

    it('should return 404 after deletion', async () => {
      const res = await app.request(`/api/documents/${createdDocId}`, {
        headers: authHeaders,
      }, env);

      expect(res.status).toBe(404);
    });
  });
});
