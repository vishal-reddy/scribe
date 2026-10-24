import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { applyMigrations, getAuthHeaders } from '../helpers';

describe('Sync WebSocket Endpoint', () => {
  const aliceEmail = 'alice-sync@example.com';
  const bobEmail = 'bob-sync@example.com';
  const carolEmail = 'carol-sync@example.com';
  const alice = getAuthHeaders(aliceEmail);
  const bob = getAuthHeaders(bobEmail);
  const carol = getAuthHeaders(carolEmail);
  let docId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    const res = await app.request('/api/documents', {
      method: 'POST',
      headers: { ...alice, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Private', markdown: 'secret' }),
    }, env);
    docId = ((await res.json()) as any).document.id;

    // Bob is a read-only viewer.
    await app.request(`/api/documents/${docId}/shares`, {
      method: 'POST',
      headers: { ...alice, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: bobEmail, role: 'viewer' }),
    }, env);
  });

  it('requires authentication', async () => {
    const res = await app.request(`/api/sync/${docId}/ws`, {}, env);
    expect(res.status).toBe(401);
  });

  it('hides documents that do not exist', async () => {
    const res = await app.request('/api/sync/no-such-doc/ws', { headers: alice }, env);
    expect(res.status).toBe(404);
  });

  it('does not let a stranger who knows the id connect', async () => {
    const res = await app.request(`/api/sync/${docId}/ws`, { headers: carol }, env);
    expect(res.status).toBe(404);
  });

  it('does not let a read-only viewer connect (the socket can write)', async () => {
    const res = await app.request(`/api/sync/${docId}/ws`, { headers: bob }, env);
    expect(res.status).toBe(404);
  });

  it('forwards the owner to the durable object', async () => {
    const res = await app.request(`/api/sync/${docId}/ws`, { headers: alice }, env);
    // Without an Upgrade header the DO answers 400 "Expected websocket" (500 if the DO is unavailable in this pool).
    expect([400, 500]).toContain(res.status);
  });
});
