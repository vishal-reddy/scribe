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
       VALUES (?, NULL, 'orphan-secret-title', '', 'secret body', ?, ?, 'legacy', 'legacy')`
    ).bind(id, now, now).run();

    const { getAuthHeaders, userIdFor } = await import('../helpers');
    const headers = getAuthHeaders('anyone@example.com');
    const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
    const list: any = await (await app.request('/api/documents', { headers }, env)).json();
    expect(list.documents.some((d: any) => d.id === id)).toBe(false);
    expect((await app.request(`/api/documents/${id}`, { headers }, env)).status).toBe(404);
    expect((await app.request(`/api/documents/${id}`, { method: 'DELETE', headers }, env)).status).toBe(404);
    expect((await app.request(`/api/sync/${id}/ws`, { headers }, env)).status).toBe(404);

    // Claude endpoints must also reject ownerless documents
    expect((await app.request(`/api/claude/artifacts/${id}`, { headers }, env)).status).toBe(404);
    expect((await app.request(`/api/claude/edit/${id}`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ instruction: 'edit' }) }, env)).status).toBe(404);
    expect((await app.request('/api/claude/prompt', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ prompt: 'read this', documentId: id }) }, env)).status).toBe(404);
    expect((await app.request(`/api/claude/history/${id}`, { headers }, env)).status).toBe(404);

    // Classification helpers must not leak or file ownerless documents for an authenticated user
    const { drizzle } = await import('drizzle-orm/d1');
    const schema = await import('../../src/db/schema');
    const { listUnfiledDocuments, fileDocumentInCategory } = await import('../../src/services/classification');
    const db = drizzle(env.DB, { schema });
    const callerId = await userIdFor('anyone@example.com');
    const unfiled = await listUnfiledDocuments(db, callerId);
    expect(unfiled.some((d) => d.id === id)).toBe(false);
    expect(await fileDocumentInCategory(db, id, 'Metaphysics', callerId)).toBeNull();

    // /guidance page dropdown must not list ownerless documents
    const sesId = `ses_${crypto.randomUUID().replace(/-/g, '')}`;
    await env.DB.prepare(
      `INSERT INTO web_sessions (session_id, user_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(sesId, callerId, 'anyone@example.com', Date.now(), Date.now() + 60_000).run();
    const guidanceHtml = await (await app.request('/guidance', { headers: { Cookie: `sc_session=${sesId}` } }, env)).text();
    expect(guidanceHtml).not.toContain('orphan-secret-title');
    expect(guidanceHtml).not.toContain(id);
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

describe('people-with-access links', () => {
  it('works on a personal document and opens only for people who can already read it', async () => {
    const { getAuthHeaders, userIdFor } = await import('../helpers');
    const email = 'sharedlink@example.com';
    const owner = { ...getAuthHeaders(email), 'Content-Type': 'application/json' };
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO documents (id, user_id, org_id, title, content, markdown, created_at, updated_at, created_by, last_edited_by)
       VALUES (?, ?, NULL, 'Doc', '', 'private body', ?, ?, 'user', 'user')`
    ).bind(id, await userIdFor(email), now, now).run();

    const res = await app.request(`/api/documents/${id}/publish`, { method: 'POST', headers: owner, body: JSON.stringify({ visibility: 'shared' }) }, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).visibility).toBe('shared');

    const anon = await app.request(`/d/${id}`, { redirect: 'manual' }, env);
    expect(anon.status).toBe(302); // must sign in first
    expect(await anon.text()).not.toContain('private body');
  });
});

describe('publish visibility validation', () => {
  it('rejects an unknown visibility instead of publishing publicly', async () => {
    const { getAuthHeaders, userIdFor } = await import('../helpers');
    const email = 'badvis@example.com';
    const owner = { ...getAuthHeaders(email), 'Content-Type': 'application/json' };
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO documents (id, user_id, org_id, title, content, markdown, created_at, updated_at, created_by, last_edited_by)
       VALUES (?, ?, NULL, 'Doc', '', 'body', ?, ?, 'user', 'user')`
    ).bind(id, await userIdFor(email), now, now).run();
    const post = (body: string) => app.request(`/api/documents/${id}/publish`, { method: 'POST', headers: owner, body }, env);

    expect((await post(JSON.stringify({ visibility: 'privte' }))).status).toBe(400);
    expect((await post(JSON.stringify({ visibility: '<script>' }))).status).toBe(400);
    expect((await app.request(`/d/${id}`, {}, env)).status).toBe(404); // nothing got published
    expect((await post(JSON.stringify({ visibility: 'public' }))).status).toBe(200);
  });
});

describe('document links, tags, backlinks, and move authorization', () => {
  it('prevents strangers from reading and viewers from mutating links, tags, backlinks, or hierarchy', async () => {
    const { getAuthHeaders, userIdFor } = await import('../helpers');
    const { drizzle } = await import('drizzle-orm/d1');
    const schema = await import('../../src/db/schema');
    const { reparseDocument, rebindLinksToTitle } = await import('../../src/services/notes');

    const ownerEmail = 'doc-owner@example.com';
    const viewerEmail = 'doc-viewer@example.com';
    const strangerEmail = 'doc-stranger@example.com';
    const ownerId = await userIdFor(ownerEmail);
    const viewerId = await userIdFor(viewerEmail);
    const strangerId = await userIdFor(strangerEmail);
    const owner = { ...getAuthHeaders(ownerEmail), 'Content-Type': 'application/json' };
    const viewer = { ...getAuthHeaders(viewerEmail), 'Content-Type': 'application/json' };
    const stranger = { ...getAuthHeaders(strangerEmail), 'Content-Type': 'application/json' };

    const now = Math.floor(Date.now() / 1000);
    const docId = crypto.randomUUID();
    const shareId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO users (id, email, created_at, is_verified) VALUES (?, ?, ?, 1)`).bind(ownerId, ownerEmail, now),
      env.DB.prepare(`INSERT OR IGNORE INTO users (id, email, created_at, is_verified) VALUES (?, ?, ?, 1)`).bind(viewerId, viewerEmail, now),
      env.DB.prepare(`INSERT OR IGNORE INTO users (id, email, created_at, is_verified) VALUES (?, ?, ?, 1)`).bind(strangerId, strangerEmail, now),
      env.DB.prepare(
        `INSERT INTO documents (id, user_id, title, content, markdown, created_at, updated_at, created_by, last_edited_by)
         VALUES (?, ?, 'Owner Note', '', 'See [[Unresolved Target]] #secrettag', ?, ?, 'user', 'user')`
      ).bind(docId, ownerId, now, now),
      env.DB.prepare(
        `INSERT INTO document_shares (id, document_id, user_id, email, role, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'viewer', ?, ?, ?)`
      ).bind(shareId, docId, viewerId, viewerEmail, ownerId, now, now),
    ]);

    const db = drizzle(env.DB, { schema });
    await reparseDocument(db, docId, 'See [[Unresolved Target]] #secrettag', ownerId);

    // Stranger cannot read links, tags, or backlinks, nor mutate
    expect((await app.request(`/api/documents/${docId}/links`, { headers: stranger }, env)).status).toBe(404);
    expect((await app.request(`/api/documents/${docId}/tags`, { headers: stranger }, env)).status).toBe(404);
    expect((await app.request(`/api/documents/${docId}/backlinks`, { headers: stranger }, env)).status).toBe(404);
    expect((await app.request(`/api/documents/${docId}/tags`, { method: 'POST', headers: stranger, body: JSON.stringify({ tag: 'pwn' }) }, env)).status).toBe(404);
    expect((await app.request(`/api/documents/${docId}/tags/secrettag`, { method: 'DELETE', headers: stranger }, env)).status).toBe(404);
    expect((await app.request(`/api/documents/${docId}/move`, { method: 'POST', headers: stranger, body: JSON.stringify({ sortKey: 'z' }) }, env)).status).toBe(404);

    // Viewer can read links, tags, and backlinks, but cannot mutate
    expect((await app.request(`/api/documents/${docId}/links`, { headers: viewer }, env)).status).toBe(200);
    expect((await app.request(`/api/documents/${docId}/tags`, { headers: viewer }, env)).status).toBe(200);
    expect((await app.request(`/api/documents/${docId}/backlinks`, { headers: viewer }, env)).status).toBe(200);
    expect((await app.request(`/api/documents/${docId}/move`, { method: 'POST', headers: viewer, body: JSON.stringify({ sortKey: 'z' }) }, env)).status).toBe(403);
    expect((await app.request(`/api/documents/${docId}/links`, { method: 'POST', headers: viewer, body: JSON.stringify({ targetId: docId }) }, env)).status).toBe(403);
    expect((await app.request(`/api/documents/${docId}/tags`, { method: 'POST', headers: viewer, body: JSON.stringify({ tag: 'newtag' }) }, env)).status).toBe(403);
    expect((await app.request(`/api/documents/${docId}/tags/secrettag`, { method: 'DELETE', headers: viewer }, env)).status).toBe(403);

    const ownerLinks = ((await (await app.request(`/api/documents/${docId}/links`, { headers: owner }, env)).json()) as any).links;
    expect(ownerLinks.length).toBe(1);
    const linkId = ownerLinks[0].id;
    expect((await app.request(`/api/documents/${docId}/links/${linkId}`, { method: 'DELETE', headers: viewer }, env)).status).toBe(403);

    // Stranger creating a note with title "Unresolved Target" must not hijack owner's unresolved wikilink
    const strangerDocId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO documents (id, user_id, title, content, markdown, created_at, updated_at, created_by, last_edited_by)
       VALUES (?, ?, 'Unresolved Target', '', 'stranger note', ?, ?, 'user', 'user')`
    ).bind(strangerDocId, strangerId, now, now).run();
    await rebindLinksToTitle(db, strangerDocId, 'Unresolved Target');

    const linksAfterStranger = ((await (await app.request(`/api/documents/${docId}/links`, { headers: owner }, env)).json()) as any).links;
    expect(linksAfterStranger[0].targetId).toBeNull();
  }, 15000);
});

describe('OAuth redirect_uri scheme validation and PKCE/Origin checks', () => {
  it('rejects javascript:, data:, file:, and blob: redirect_uris on client registration', async () => {
    for (const badUri of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://example.com/uuid',
      'http://example.com/callback',
    ]) {
      const res = await app.request('/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'bad', redirect_uris: [badUri] }),
      }, env);
      expect(res.status).toBe(400);
    }

    const goodRes = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'good', redirect_uris: ['https://client.example.com/cb', 'cursor://oauth/callback'] }),
    }, env);
    expect(goodRes.status).toBe(201);
    const client: any = await goodRes.json();

    // Create a web session to test POST /oauth/authorize Origin and PKCE validation
    const sesId = `ses_${crypto.randomUUID().replace(/-/g, '')}`;
    await env.DB.prepare(
      `INSERT INTO web_sessions (session_id, user_id, email, created_at, expires_at) VALUES (?, 'u-oauth', 'oauth@example.com', ?, ?)`
    ).bind(sesId, Date.now(), Date.now() + 60_000).run();

    // Cross-origin POST to /oauth/authorize is blocked
    const crossOrigin = await app.request('https://scribe.test/oauth/authorize', {
      method: 'POST',
      headers: {
        Cookie: `sc_session=${sesId}`,
        Origin: 'https://evil.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        decision: 'approve',
        client_id: client.client_id,
        redirect_uri: 'https://client.example.com/cb',
        code_challenge: 'challenge123',
        code_challenge_method: 'S256',
      }).toString(),
    }, env);
    expect(crossOrigin.status).toBe(403);

    // POST /oauth/authorize without PKCE S256 does not issue a code
    const noPkce = await app.request('https://scribe.test/oauth/authorize', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Cookie: `sc_session=${sesId}`,
        Origin: 'https://scribe.test',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        decision: 'approve',
        client_id: client.client_id,
        redirect_uri: 'https://client.example.com/cb',
      }).toString(),
    }, env);
    expect(noPkce.status).toBe(302);
    expect(noPkce.headers.get('Location')).toContain('error=invalid_request');
  });
});

describe('web session revocation and Origin validation on form POSTs', () => {
  it('deletes the session from D1 on /auth/logout and rejects cross-origin or null-Origin POSTs', async () => {
    const sesId = `ses_${crypto.randomUUID().replace(/-/g, '')}`;
    await env.DB.prepare(
      `INSERT INTO web_sessions (session_id, user_id, email, created_at, expires_at) VALUES (?, 'u-logout', 'logout@example.com', ?, ?)`
    ).bind(sesId, Date.now(), Date.now() + 60_000).run();

    // Null Origin on /guidance and /join returns 403 (instead of throwing 500 or succeeding)
    const nullOriginGuidance = await app.request('https://scribe.test/guidance', {
      method: 'POST',
      headers: { Cookie: `sc_session=${sesId}`, Origin: 'null', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=save_user&text=hi',
    }, env);
    expect(nullOriginGuidance.status).toBe(403);

    const crossOriginJoin = await app.request('https://scribe.test/join?token=abc', {
      method: 'POST',
      headers: { Cookie: `sc_session=${sesId}`, Origin: 'https://evil.example' },
    }, env);
    expect(crossOriginJoin.status).toBe(403);

    // Logout deletes the server-side session row so the cookie can no longer authenticate
    const logoutRes = await app.request('https://scribe.test/auth/logout', {
      method: 'POST',
      redirect: 'manual',
      headers: { Cookie: `sc_session=${sesId}` },
    }, env);
    expect(logoutRes.status).toBe(302);

    const afterLogout = await app.request('https://scribe.test/guidance', {
      redirect: 'manual',
      headers: { Cookie: `sc_session=${sesId}` },
    }, env);
    expect(afterLogout.status).toBe(302);
    expect(afterLogout.headers.get('Location')).toContain('/auth/kinde/login');
  });
});
