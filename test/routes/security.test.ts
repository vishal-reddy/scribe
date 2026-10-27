import { describe, it, expect, beforeAll } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker, { app } from '../../src/index';
import { applyMigrations, createTestToken } from '../helpers';

/**
 * Regression tests for the 2026-10 audit: a deployed Worker (LOCAL_DEV unset) must verify every credential,
 * whatever its ENVIRONMENT is called. The previous `ENVIRONMENT !== 'production'` gate left scribe-dev open.
 */
describe('deployed environments fail closed', () => {
  // What a deployed dev Worker looks like: development, but no LOCAL_DEV.
  const deployedDev = { ...env, ENVIRONMENT: 'development', LOCAL_DEV: undefined } as typeof env;
  const unset = { ...env, ENVIRONMENT: undefined, LOCAL_DEV: undefined } as typeof env;

  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  for (const [name, e] of [['development', deployedDev], ['unset', unset]] as const) {
    it(`rejects an unsigned JWT when ENVIRONMENT is ${name}`, async () => {
      const res = await app.request('/api/documents', { headers: { Authorization: `Bearer ${createTestToken('attacker@example.com')}` } }, e);
      expect(res.status).toBe(401);
    });
  }

  it('still accepts the unsigned test token under LOCAL_DEV', async () => {
    const res = await app.request('/api/documents', { headers: { Authorization: `Bearer ${createTestToken('dev@example.com')}` } }, env);
    expect(res.status).toBe(200);
  });

  it('does not echo the OTP in the response on a deployed Worker', async () => {
    const res = await app.request('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'otp-probe@example.com' }),
    }, { ...deployedDev, RESEND_API_KEY: undefined } as typeof env);
    // No email provider configured => the request must fail rather than hand the code to the caller.
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/devOtp|\d{6}/);
  });

  it('has no dev-session login route (replaced by Kinde client credentials)', async () => {
    for (const e of [deployedDev, env]) {
      const res = await app.request('/api/auth/dev-session', { method: 'POST', headers: { 'X-Dev-Login': 'anything' } }, e);
      expect([401, 404]).toContain(res.status);
    }
  });

  it('requires credentials on /mcp for a deployed Worker', async () => {
    // /mcp is served by the Worker's combined fetch handler (McpAgent), not the Hono app.
    const mcp = (e: typeof env) => {
      const ctx = createExecutionContext();
      const req = new Request('https://scribe.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
      });
      return worker.fetch(req, e, ctx).then(async (r) => { await waitOnExecutionContext(ctx); return r; });
    };
    expect((await mcp(deployedDev)).status).toBe(401);
    expect((await mcp(unset)).status).toBe(401);
  });
});

describe('ownerless rows grant nothing', () => {
  it('an ownerless document is invisible to every user and cannot be read or edited by id', async () => {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO documents (id, user_id, title, content, markdown, created_at, updated_at, created_by, last_edited_by)
       VALUES (?, NULL, 'orphan', '', 'secret body', ?, ?, 'legacy', 'legacy')`
    ).bind(id, now, now).run();

    const { getAuthHeaders } = await import('../helpers');
    const headers = getAuthHeaders('anyone@example.com');
    const list: any = await (await app.request('/api/documents', { headers }, env)).json();
    expect(list.documents.some((d: any) => d.id === id)).toBe(false);
    expect((await app.request(`/api/documents/${id}`, { headers }, env)).status).toBe(404);
    expect((await app.request(`/api/documents/${id}`, { method: 'DELETE', headers }, env)).status).toBe(404);
    expect((await app.request(`/api/sync/${id}/ws`, { headers }, env)).status).toBe(404);
  });
});

describe('/d/:id public links are opt-in', () => {
  it('serves a document only after its owner publishes it, and not after unpublishing', async () => {
    const { getAuthHeaders, userIdFor } = await import('../helpers');
    const ownerEmail = 'owner@example.com';
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO documents (id, user_id, title, content, markdown, created_at, updated_at, created_by, last_edited_by)
       VALUES (?, ?, 'Mine', '', 'public body', ?, ?, 'user', 'user')`
    ).bind(id, await userIdFor(ownerEmail), now, now).run();

    const owner = getAuthHeaders(ownerEmail);
    const stranger = getAuthHeaders('stranger@example.com');
    const publish = (method: string, headers: Record<string, string>) => app.request(`/api/documents/${id}/publish`, { method, headers }, env);

    expect((await app.request(`/d/${id}`, {}, env)).status).toBe(404); // unpublished by default
    expect((await publish('POST', stranger)).status).toBe(404); // cannot see it, cannot publish it
    expect((await app.request(`/d/${id}`, {}, env)).status).toBe(404);

    expect((await publish('POST', owner)).status).toBe(200);
    expect((await app.request(`/d/${id}`, {}, env)).status).toBe(200);

    expect((await publish('DELETE', stranger)).status).toBe(404); // a stranger cannot revoke either
    expect((await publish('DELETE', owner)).status).toBe(200);
    expect((await app.request(`/d/${id}`, {}, env)).status).toBe(404);
  });
});

describe('organization-only links', () => {
  it('need an organization document, and send anonymous visitors to sign in instead of showing the page', async () => {
    const { getAuthHeaders, userIdFor } = await import('../helpers');
    const email = 'orgowner@example.com';
    const owner = { ...getAuthHeaders(email), 'Content-Type': 'application/json' };
    const now = Math.floor(Date.now() / 1000);
    const mk = async (orgId: string | null) => {
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO documents (id, user_id, org_id, title, content, markdown, created_at, updated_at, created_by, last_edited_by)
         VALUES (?, ?, ?, 'Doc', '', 'internal body', ?, ?, 'user', 'user')`
      ).bind(id, await userIdFor(email), orgId, now, now).run();
      return id;
    };
    const personal = await mk(null);
    const inOrg = await mk('org-1');
    const publish = (id: string) => app.request(`/api/documents/${id}/publish`, { method: 'POST', headers: owner, body: JSON.stringify({ visibility: 'org' }) }, env);

    expect((await publish(personal)).status).toBe(400);
    expect((await publish(inOrg)).status).toBe(200);

    const anon = await app.request(`/d/${inOrg}`, { redirect: 'manual' }, env);
    expect(anon.status).toBe(302);
    expect(await anon.text()).not.toContain('internal body');
  });
});

describe('clients that send null for unset optional fields', () => {
  it('can create and edit a document (the mobile apps serialize unset fields as null)', async () => {
    const { getAuthHeaders } = await import('../helpers');
    const headers = { ...getAuthHeaders('nulls@example.com'), 'Content-Type': 'application/json' };
    const created = await app.request('/api/documents', { method: 'POST', headers, body: JSON.stringify({ title: 'From the app', markdown: null }) }, env);
    expect(created.status).toBe(201);
    const id = ((await created.json()) as any).document.id;
    const edited = await app.request(`/api/documents/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ title: null, markdown: 'new body' }) }, env);
    expect(edited.status).toBe(200);
    const read: any = await (await app.request(`/api/documents/${id}`, { headers }, env)).json();
    expect(read.document.title).toBe('From the app');
    expect(read.document.markdown).toBe('new body');
  });
});
