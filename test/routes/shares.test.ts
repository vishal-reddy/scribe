import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { applyMigrations, getAuthHeaders, userIdFor } from '../helpers';

describe('Document Sharing API', () => {
  const aliceEmail = 'alice-share@example.com';
  const bobEmail = 'bob-share@example.com';
  const aliceAuth = getAuthHeaders(aliceEmail);
  const bobAuth = getAuthHeaders(bobEmail);

  let docId: string;
  let shareId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    // Create a document owned by Alice
    const res = await app.request('/api/documents', {
      method: 'POST',
      headers: { ...aliceAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Confidential Strategy',
        markdown: '# Strategy\n\nTop secret.',
      }),
    }, env);
    expect(res.status).toBe(201);
    const data: any = await res.json();
    docId = data.document.id;
  });

  it('Bob should not be able to read Alice doc before sharing', async () => {
    const res = await app.request(`/api/documents/${docId}`, {
      headers: bobAuth,
    }, env);
    expect(res.status).toBe(404);
  });

  it('Alice shares doc with Bob as viewer', async () => {
    const res = await app.request(`/api/documents/${docId}/shares`, {
      method: 'POST',
      headers: { ...aliceAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: bobEmail, role: 'viewer' }),
    }, env);

    expect(res.status).toBe(201);
    const data: any = await res.json();
    expect(data).toHaveProperty('shareId');
    shareId = data.shareId;
  });

  it('Bob can now read the document as viewer', async () => {
    const res = await app.request(`/api/documents/${docId}`, {
      headers: bobAuth,
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.document.title).toBe('Confidential Strategy');
    expect(data.document.permission.canRead).toBe(true);
    expect(data.document.permission.canWrite).toBe(false);
  });

  it('Bob cannot edit document as viewer', async () => {
    const res = await app.request(`/api/documents/${docId}`, {
      method: 'PATCH',
      headers: { ...bobAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hacked Strategy' }),
    }, env);

    expect(res.status).toBe(403);
  });

  it('Alice upgrades Bob share to editor', async () => {
    const res = await app.request(`/api/documents/${docId}/shares`, {
      method: 'POST',
      headers: { ...aliceAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: bobEmail, role: 'editor' }),
    }, env);

    expect(res.status).toBe(201);
  });

  it('Bob can now edit the document as editor', async () => {
    const res = await app.request(`/api/documents/${docId}`, {
      method: 'PATCH',
      headers: { ...bobAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Strategy' }),
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.document.title).toBe('Updated Strategy');
  });

  it('Bob cannot delete the document', async () => {
    const res = await app.request(`/api/documents/${docId}`, {
      method: 'DELETE',
      headers: bobAuth,
    }, env);

    expect(res.status).toBe(403);
  });

  it('Alice lists document shares', async () => {
    const res = await app.request(`/api/documents/${docId}/shares`, {
      headers: aliceAuth,
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data).toHaveProperty('shares');
    expect(Array.isArray(data.shares)).toBe(true);
    expect(data.shares.length).toBe(1);
    expect(data.shares[0].email).toBe(bobEmail);
    expect(data.shares[0].role).toBe('editor');
  });

  it('Alice removes Bob share and Bob loses access', async () => {
    const delRes = await app.request(`/api/documents/${docId}/shares/${shareId}`, {
      method: 'DELETE',
      headers: aliceAuth,
    }, env);

    expect(delRes.status).toBe(200);

    const getRes = await app.request(`/api/documents/${docId}`, {
      headers: bobAuth,
    }, env);
    expect(getRes.status).toBe(404);
  });
});
