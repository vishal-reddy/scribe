import type { D1Database } from '@cloudflare/workers-types';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 8;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const AUTH_CODE_TTL_SECONDS = 60 * 5;
export const SUPPORTED_SCOPES = ['mcp'];

export interface OAuthClientRow {
  client_id: string;
  client_secret_hash: string;
  client_name: string | null;
  redirect_uris_json: string;
  token_endpoint_auth_method: string;
  grant_types_json: string;
  response_types_json: string;
  scope: string | null;
  created_at: number;
}

export interface AccessTokenInfo {
  user_id: string;
  client_id: string;
  scope: string | null;
  resource: string | null;
  expires_at: number;
}

export async function hashSecret(value: string, pepper: string): Promise<string> {
  const data = new TextEncoder().encode(`${pepper}:${value}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function randomToken(prefix: string): string {
  const a = crypto.randomUUID().replace(/-/g, '');
  const b = crypto.randomUUID().replace(/-/g, '');
  return `${prefix}_${a}${b}`;
}

export function randomClientId(): string {
  return `cli_${crypto.randomUUID().replace(/-/g, '')}`;
}

export async function verifyPkce(verifier: string, challenge: string, method: string): Promise<boolean> {
  if (method !== 'S256') return false;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(buf)) === challenge;
}

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isValidRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol.length > 1) return true;
    return false;
  } catch {
    return false;
  }
}

export function parseRedirectUris(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function loadClient(db: D1Database, clientId: string): Promise<OAuthClientRow | null> {
  return db.prepare(
    `SELECT client_id, client_secret_hash, client_name, redirect_uris_json,
            token_endpoint_auth_method, grant_types_json, response_types_json,
            scope, created_at
       FROM oauth_clients WHERE client_id = ?`
  ).bind(clientId).first<OAuthClientRow>();
}

export async function authenticateAccessToken(
  db: D1Database,
  pepper: string,
  token: string | undefined
): Promise<AccessTokenInfo | null> {
  if (!token) return null;
  const hash = await hashSecret(token, pepper);
  const row = await db.prepare(
    `SELECT user_id, client_id, scope, resource, expires_at, revoked_at, last_used_at
       FROM oauth_access_tokens WHERE token_hash = ?`
  ).bind(hash).first<{
    user_id: string; client_id: string; scope: string | null; resource: string | null;
    expires_at: number; revoked_at: number | null; last_used_at: number | null;
  }>();
  if (!row) return null;
  if (row.revoked_at !== null) return null;
  const now = Date.now();
  if (row.expires_at < now) return null;
  if (!row.last_used_at || now - row.last_used_at > 5 * 60 * 1000) {
    await db.prepare('UPDATE oauth_access_tokens SET last_used_at = ? WHERE token_hash = ?')
      .bind(now, hash).run();
  }
  return {
    user_id: row.user_id,
    client_id: row.client_id,
    scope: row.scope,
    resource: row.resource,
    expires_at: row.expires_at,
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
    scopes_supported: SUPPORTED_SCOPES,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: SUPPORTED_SCOPES,
  };
}
