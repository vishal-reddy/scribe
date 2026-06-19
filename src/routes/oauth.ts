import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import type { D1Database } from '@cloudflare/workers-types';
import type { OAuthClientRow } from '../lib/oauth';
import { readSession } from '../lib/session';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  hashSecret,
  randomToken,
  randomClientId,
  verifyPkce,
  isValidRedirectUri,
  loadClient,
  parseRedirectUris,
} from '../lib/oauth';

export const oauthRoute = new Hono<{ Bindings: Env }>();

async function timingSafeStringEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha), vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}

async function d1RateLimit(
  db: D1Database,
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  try {
    const result = await db.prepare(
      `INSERT INTO rate_limit_buckets (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count`
    ).bind(key, windowStart).first<{ count: number }>();
    return (result?.count ?? 1) <= maxRequests;
  } catch {
    return true;
  }
}

// ── Dynamic Client Registration (RFC 7591) ─────────────────────────────────
oauthRoute.post('/register', async (c) => {
  // Per-IP: 10 registrations per hour to prevent client spam
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const allowed = await d1RateLimit(c.env.DB, `oauth_reg:${ip}`, 10, 60 * 60_000);
  if (!allowed) return c.json({ error: 'rate_limit_exceeded', error_description: 'Too many registration requests' }, 429);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_client_metadata', error_description: 'JSON body required' }, 400);
  }

  const redirectUris: unknown = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return c.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris is required' }, 400);
  }
  for (const u of redirectUris) {
    if (typeof u !== 'string' || !isValidRedirectUri(u)) {
      return c.json({ error: 'invalid_redirect_uri', error_description: `Invalid redirect_uri: ${u}` }, 400);
    }
  }

  const grantTypes: string[] = Array.isArray(body.grant_types) && body.grant_types.length > 0
    ? body.grant_types : ['authorization_code', 'refresh_token'];
  const responseTypes: string[] = Array.isArray(body.response_types) && body.response_types.length > 0
    ? body.response_types : ['code'];
  const tokenEndpointAuthMethod: string = typeof body.token_endpoint_auth_method === 'string'
    ? body.token_endpoint_auth_method : 'client_secret_post';
  const allowedAuthMethods = ['client_secret_post', 'client_secret_basic', 'none'];
  if (!allowedAuthMethods.includes(tokenEndpointAuthMethod)) {
    return c.json({ error: 'invalid_client_metadata', error_description: 'Unsupported auth method' }, 400);
  }

  const clientId = randomClientId();
  const clientSecret = tokenEndpointAuthMethod === 'none' ? '' : randomToken('cs');
  const clientSecretHash = clientSecret
    ? await hashSecret(clientSecret, c.env.OAUTH_PEPPER)
    : await hashSecret('', c.env.OAUTH_PEPPER); // NOT NULL constraint
  const clientName = typeof body.client_name === 'string' ? body.client_name : null;
  const scope = typeof body.scope === 'string' ? body.scope : 'mcp';
  const now = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO oauth_clients (client_id, client_secret_hash, client_name, redirect_uris_json,
       token_endpoint_auth_method, grant_types_json, response_types_json, scope, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    clientId, clientSecretHash, clientName, JSON.stringify(redirectUris),
    tokenEndpointAuthMethod, JSON.stringify(grantTypes), JSON.stringify(responseTypes), scope, now
  ).run();

  const response: Record<string, unknown> = {
    client_id: clientId,
    client_id_issued_at: Math.floor(now / 1000),
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    scope,
  };
  if (clientSecret) response.client_secret = clientSecret;
  if (clientName) response.client_name = clientName;
  return c.json(response, 201);
});

// ── Authorization endpoint ─────────────────────────────────────────────────
oauthRoute.get('/authorize', async (c) => {
  const url = new URL(c.req.url);
  const params = url.searchParams;
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const responseType = params.get('response_type') ?? '';
  const codeChallenge = params.get('code_challenge') ?? '';
  const codeChallengeMethod = params.get('code_challenge_method') ?? '';
  const state = params.get('state') ?? '';
  const scope = params.get('scope') ?? 'mcp';
  const resource = params.get('resource') ?? '';

  if (!clientId || !redirectUri) return c.text('Missing client_id or redirect_uri', 400);
  const client = await loadClient(c.env.DB, clientId);
  if (!client) return c.text('Unknown client_id', 400);
  const registered = parseRedirectUris(client.redirect_uris_json);
  if (!registered.includes(redirectUri)) return c.text('redirect_uri does not match', 400);
  if (responseType !== 'code') return redirectWithError(redirectUri, state, 'unsupported_response_type');
  if (!codeChallenge || codeChallengeMethod !== 'S256')
    return redirectWithError(redirectUri, state, 'invalid_request', 'PKCE S256 required');

  const session = await readSession(c);
  if (!session) {
    const returnTo = '/oauth/authorize' + url.search;
    return c.redirect('/auth/login?return_to=' + encodeURIComponent(returnTo), 302);
  }

  c.header('Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(renderConsent({
    clientName: client.client_name || clientId,
    email: session.email,
    scope,
    params: {
      client_id: clientId, redirect_uri: redirectUri, response_type: responseType,
      code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod, state, scope, resource,
    },
  }));
});

oauthRoute.post('/authorize', async (c) => {
  const session = await readSession(c);
  if (!session) return c.redirect('/auth/login', 302);
  const form = await c.req.parseBody();
  const decision = String(form.decision ?? '');
  const clientId = String(form.client_id ?? '');
  const redirectUri = String(form.redirect_uri ?? '');
  const codeChallenge = String(form.code_challenge ?? '');
  const codeChallengeMethod = String(form.code_challenge_method ?? '');
  const state = String(form.state ?? '');
  const scope = String(form.scope ?? 'mcp');
  const resource = String(form.resource ?? '');

  const client = await loadClient(c.env.DB, clientId);
  if (!client) return c.text('Unknown client_id', 400);
  const registered = parseRedirectUris(client.redirect_uris_json);
  if (!registered.includes(redirectUri)) return c.text('redirect_uri does not match', 400);
  if (decision !== 'approve') return redirectWithError(redirectUri, state, 'access_denied');

  const code = randomToken('ac');
  const codeHash = await hashSecret(code, c.env.OAUTH_PEPPER);
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO oauth_authorization_codes
       (code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, resource, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    codeHash, clientId, session.user_id, redirectUri, codeChallenge, codeChallengeMethod,
    scope, resource || null, now + AUTH_CODE_TTL_SECONDS * 1000, now
  ).run();

  const target = new URL(redirectUri);
  target.searchParams.set('code', code);
  if (state) target.searchParams.set('state', state);
  return c.redirect(target.toString(), 302);
});

// ── Token endpoint ─────────────────────────────────────────────────────────
oauthRoute.post('/token', async (c) => {
  const form = await c.req.parseBody();
  const grantType = String(form.grant_type ?? '');
  const auth = await resolveClientAuth(c, form);
  if (!auth.ok) return c.json(auth.error, auth.status);
  const { client } = auth;

  if (grantType === 'authorization_code') return handleAuthorizationCode(c, client, form);
  if (grantType === 'refresh_token') return handleRefreshToken(c, client, form);
  return c.json({ error: 'unsupported_grant_type' }, 400);
});

type OAuthCtx = Context<{ Bindings: Env }>;

async function resolveClientAuth(
  c: OAuthCtx,
  form: Record<string, any>
): Promise<{ ok: true; client: OAuthClientRow } | { ok: false; status: 400 | 401; error: object }> {
  const basic = c.req.header('Authorization');
  let clientId = '';
  let clientSecret: string | null = null;
  if (basic && /^Basic\s+/i.test(basic)) {
    try {
      const decoded = atob(basic.replace(/^Basic\s+/i, ''));
      const idx = decoded.indexOf(':');
      if (idx > -1) {
        clientId = decodeURIComponent(decoded.slice(0, idx));
        clientSecret = decodeURIComponent(decoded.slice(idx + 1));
      }
    } catch {}
  }
  if (!clientId) {
    clientId = String(form.client_id ?? '');
    if ('client_secret' in form) clientSecret = String(form.client_secret ?? '');
  }
  if (!clientId) return { ok: false, status: 401, error: { error: 'invalid_client' } };
  const client = await loadClient(c.env.DB, clientId);
  if (!client) return { ok: false, status: 401, error: { error: 'invalid_client' } };
  if (client.token_endpoint_auth_method === 'none') return { ok: true, client };
  if (clientSecret === null) return { ok: false, status: 401, error: { error: 'invalid_client' } };
  const providedHash = await hashSecret(clientSecret, c.env.OAUTH_PEPPER);
  if (!(await timingSafeStringEqual(providedHash, client.client_secret_hash))) return { ok: false, status: 401, error: { error: 'invalid_client' } };
  return { ok: true, client };
}

async function handleAuthorizationCode(c: OAuthCtx, client: OAuthClientRow, form: Record<string, any>) {
  const code = String(form.code ?? '');
  const redirectUri = String(form.redirect_uri ?? '');
  const verifier = String(form.code_verifier ?? '');
  if (!code || !redirectUri || !verifier) return c.json({ error: 'invalid_request' }, 400);

  const codeHash = await hashSecret(code, c.env.OAUTH_PEPPER);
  const row = await c.env.DB.prepare(
    `SELECT client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, resource, expires_at, consumed_at
       FROM oauth_authorization_codes WHERE code_hash = ?`
  ).bind(codeHash).first<{
    client_id: string; user_id: string; redirect_uri: string; code_challenge: string;
    code_challenge_method: string; scope: string | null; resource: string | null;
    expires_at: number; consumed_at: number | null;
  }>();
  if (!row) return c.json({ error: 'invalid_grant' }, 400);
  if (row.consumed_at !== null) return c.json({ error: 'invalid_grant', error_description: 'code already used' }, 400);
  if (row.expires_at < Date.now()) return c.json({ error: 'invalid_grant', error_description: 'code expired' }, 400);
  if (row.client_id !== client.client_id) return c.json({ error: 'invalid_grant' }, 400);
  if (row.redirect_uri !== redirectUri) return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);

  const pkceOk = await verifyPkce(verifier, row.code_challenge, row.code_challenge_method);
  if (!pkceOk) return c.json({ error: 'invalid_grant', error_description: 'code_verifier mismatch' }, 400);

  await c.env.DB.prepare('UPDATE oauth_authorization_codes SET consumed_at = ? WHERE code_hash = ?')
    .bind(Date.now(), codeHash).run();

  return issueTokenPair(c, { client_id: client.client_id, user_id: row.user_id, scope: row.scope, resource: row.resource });
}

async function handleRefreshToken(c: OAuthCtx, client: OAuthClientRow, form: Record<string, any>) {
  const refresh = String(form.refresh_token ?? '');
  if (!refresh) return c.json({ error: 'invalid_request' }, 400);
  const refreshHash = await hashSecret(refresh, c.env.OAUTH_PEPPER);
  const row = await c.env.DB.prepare(
    `SELECT client_id, user_id, scope, resource, expires_at, revoked_at, rotated_to
       FROM oauth_refresh_tokens WHERE token_hash = ?`
  ).bind(refreshHash).first<{
    client_id: string; user_id: string; scope: string | null; resource: string | null;
    expires_at: number | null; revoked_at: number | null; rotated_to: string | null;
  }>();
  if (!row) return c.json({ error: 'invalid_grant' }, 400);
  if (row.revoked_at !== null) return c.json({ error: 'invalid_grant', error_description: 'revoked' }, 400);
  if (row.rotated_to) return c.json({ error: 'invalid_grant', error_description: 'rotated' }, 400);
  if (row.expires_at && row.expires_at < Date.now()) return c.json({ error: 'invalid_grant', error_description: 'expired' }, 400);
  if (row.client_id !== client.client_id) return c.json({ error: 'invalid_grant' }, 400);

  const newPair = await issueTokenPair(c, { client_id: client.client_id, user_id: row.user_id, scope: row.scope, resource: row.resource });
  const newPairBody = await newPair.clone().json<{ refresh_token: string }>();
  const newRefreshHash = await hashSecret(newPairBody.refresh_token, c.env.OAUTH_PEPPER);
  await c.env.DB.prepare('UPDATE oauth_refresh_tokens SET rotated_to = ?, revoked_at = ? WHERE token_hash = ? AND rotated_to IS NULL')
    .bind(newRefreshHash, Date.now(), refreshHash).run();
  return newPair;
}

async function issueTokenPair(
  c: OAuthCtx,
  opts: { client_id: string; user_id: string; scope: string | null; resource: string | null }
) {
  const accessToken = randomToken('at');
  const refreshToken = randomToken('rt');
  const accessHash = await hashSecret(accessToken, c.env.OAUTH_PEPPER);
  const refreshHash = await hashSecret(refreshToken, c.env.OAUTH_PEPPER);
  const now = Date.now();
  const accessExp = now + ACCESS_TOKEN_TTL_SECONDS * 1000;
  const refreshExp = now + REFRESH_TOKEN_TTL_SECONDS * 1000;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO oauth_access_tokens (token_hash, client_id, user_id, scope, resource, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(accessHash, opts.client_id, opts.user_id, opts.scope, opts.resource, accessExp, now),
    c.env.DB.prepare(
      `INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, scope, resource, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(refreshHash, opts.client_id, opts.user_id, opts.scope, opts.resource, refreshExp, now),
  ]);
  return c.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: opts.scope ?? 'mcp',
  });
}

function redirectWithError(redirectUri: string, state: string, error: string, description?: string) {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  if (description) u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  return Response.redirect(u.toString(), 302);
}

function renderConsent(opts: { clientName: string; email: string; scope: string; params: Record<string, string> }): string {
  const esc = (s: string) =>
    s.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c] || c);
  const hidden = Object.entries(opts.params)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`)
    .join('');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Authorize — Scribe</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Nunito:wght@700&display=swap" rel="stylesheet">
<style>
  :root{--bg:#FAFAFA;--surface:#FFFFFF;--surface-border:#E4E4E7;--surface-hover:#F4F4F5;--text:#18181B;--muted:#71717A;--accent:#3A3A3C;}
  *{box-sizing:border-box}html,body{margin:0;padding:0}
  body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--text);
    display:grid;place-items:center;min-height:100vh;padding:24px;-webkit-font-smoothing:antialiased;}
  .brand-logo{display:flex;flex-direction:column;align-items:center;text-decoration:none;margin-bottom:28px}
  .brand-text{font-family:'Nunito',sans-serif;font-weight:700;font-size:24px;color:var(--text);line-height:0.9;letter-spacing:0.15em;margin-left:0.15em}
  .brand-divider{width:64px;height:3px;background:var(--accent);margin:6px 0;border-radius:2px}
  .card{background:var(--surface);border:1px solid var(--surface-border);border-radius:16px;
    padding:32px;max-width:400px;width:100%;}
  h1{font-size:20px;font-weight:600;margin:0 0 8px;letter-spacing:-0.02em}
  p{color:var(--muted);font-size:14px;margin:0 0 20px}
  .perms{background:var(--surface-hover);border:1px solid var(--surface-border);
    border-radius:12px;padding:14px 16px;margin:0 0 24px;font-size:14px;color:var(--muted);line-height:1.5}
  .perms strong{color:var(--text)}
  button{width:100%;background:var(--accent);color:var(--bg);border:0;
    border-radius:12px;padding:14px 16px;font:inherit;font-size:15px;
    font-weight:600;cursor:pointer;box-shadow:0 4px 20px rgba(58,58,60,0.3);transition:transform .15s}
  button:hover{transform:scale(1.02)}
  .deny{background:transparent;border:1px solid var(--surface-border);color:var(--muted);
    box-shadow:none;margin-top:10px}
  .deny:hover{transform:none;opacity:0.8}
</style>
</head><body>
<div>
  <a href="/" class="brand-logo">
    <div class="brand-text">SCRIBE</div>
    <div class="brand-divider"></div>
  </a>
  <div class="card">
    <h1>Authorize ${esc(opts.clientName)}</h1>
    <p>Signed in as <strong style="color:var(--text)">${esc(opts.email)}</strong></p>
    <div class="perms"><strong>${esc(opts.clientName)}</strong> is requesting access to your Scribe notes and documents.</div>
    <form method="post" action="/oauth/authorize">
      ${hidden}
      <button type="submit" name="decision" value="approve">Allow access</button>
      <button type="submit" name="decision" value="deny" class="deny">Deny</button>
    </form>
  </div>
</div>
</body></html>`;
}
