import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { applyMigrations } from '../helpers';

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('POST /api/auth/refresh', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM users').run();
  });

  async function insertUser(refreshToken: string, expiresInMs: number): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO users (id, email, created_at, is_verified, refresh_token, refresh_token_expires_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    ).bind(id, `${id}@example.com`, Math.floor(now / 1000), await sha256Hex(refreshToken), Math.floor((now + expiresInMs) / 1000)).run();
    return id;
  }

  it('rejects an unknown refresh token', async () => {
    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: 'a'.repeat(64) }),
      headers: { 'Content-Type': 'application/json' },
    }, env);
    expect(res.status).toBe(401);
  });

  it('rejects an expired refresh token', async () => {
    await insertUser('expired-token-000000000000000000000000000000000', -1000);
    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: 'expired-token-000000000000000000000000000000000' }),
      headers: { 'Content-Type': 'application/json' },
    }, env);
    expect(res.status).toBe(401);
  });

  it('rotates the token pair on a valid refresh', async () => {
    const original = 'valid-refresh-token-0000000000000000000000000000';
    await insertUser(original, 30 * 24 * 60 * 60 * 1000);

    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: original }),
      headers: { 'Content-Type': 'application/json' },
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.token).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
    expect(data.refreshToken).not.toBe(original);

    // The old refresh token must no longer work (single-use / rotated).
    const replay = await app.request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: original }),
      headers: { 'Content-Type': 'application/json' },
    }, env);
    expect(replay.status).toBe(401);

    // The newly-issued refresh token works.
    const again = await app.request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: data.refreshToken }),
      headers: { 'Content-Type': 'application/json' },
    }, env);
    expect(again.status).toBe(200);
  });

  it('is reachable without an access token (not gated by authMiddleware)', async () => {
    // No Authorization header at all — should hit the handler (400/401 from
    // validation, not the generic "No token provided" from authMiddleware).
    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: 'a'.repeat(64) }),
      headers: { 'Content-Type': 'application/json' },
    }, env);
    const data: any = await res.json();
    expect(data.error).not.toBe('Unauthorized: No token provided');
  });
});
