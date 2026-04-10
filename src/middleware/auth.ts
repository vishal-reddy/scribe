import { Context, Next } from 'hono';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Env } from '../types';

// --- JWKS cache ---

interface JWK {
  kty: string;
  kid: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

interface JWKSResponse {
  keys: JWK[];
  public_cert: { kid: string; cert: string }[];
  public_certs: { kid: string; cert: string }[];
}

interface CachedKeys {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let jwksCache: CachedKeys | null = null;

async function getPublicKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }

  const url = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch JWKS: ${resp.status}`);
  }

  const jwks: JWKSResponse = await resp.json();
  const keys = new Map<string, CryptoKey>();

  for (const jwk of jwks.keys) {
    if (jwk.kty !== 'RSA') continue;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256' },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    keys.set(jwk.kid, cryptoKey);
  }

  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

// --- JWT helpers ---

interface JWTHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

interface JWTPayload {
  email?: string;
  name?: string;
  sub?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeJWTPart<T>(part: string): T {
  const bytes = base64UrlDecode(part);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

function parseJWTUnverified(token: string): { header: JWTHeader; payload: JWTPayload } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return {
      header: decodeJWTPart<JWTHeader>(parts[0]),
      payload: decodeJWTPart<JWTPayload>(parts[1]),
    };
  } catch {
    return null;
  }
}

async function verifyJWTSignature(
  token: string,
  publicKey: CryptoKey
): Promise<boolean> {
  const parts = token.split('.');
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlDecode(parts[2]);
  return crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    publicKey,
    signature,
    signingInput
  );
}

function validateClaims(
  payload: JWTPayload,
  audience: string,
  teamDomain: string
): string | null {
  // Validate expiration
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return 'Token expired';
  }

  // Validate issuer
  const expectedIssuer = `https://${teamDomain}.cloudflareaccess.com`;
  if (payload.iss !== expectedIssuer) {
    return `Invalid issuer: expected ${expectedIssuer}`;
  }

  // Validate audience
  const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audList.includes(audience)) {
    return 'Invalid audience';
  }

  return null;
}

// --- SHA-256 email hashing ---

async function hashEmail(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.toLowerCase().trim());
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// --- Development-mode simple parser (no signature check) ---

function parseJWTDev(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return decodeJWTPart<JWTPayload>(parts[1]);
  } catch {
    return null;
  }
}

// --- Middleware ---

/**
 * Cloudflare Access JWT Middleware
 * - Production: full RS256 signature verification via JWKS + claim validation
 * - Development: simplified JWT decode (no signature verification)
 */
export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  // API Key auth — fixed admin identity, no impersonation
  const apiKey = c.req.header('X-API-Key');
  if (apiKey && c.env.SCRIBE_API_KEY && apiKey === c.env.SCRIBE_API_KEY) {
    const email = 'vishal@scribe.app';
    const userId = await hashEmail(email);
    c.set('userId', userId);
    c.set('userEmail', email);
    c.set('userName', 'vishal');
    await next();
    return;
  }

  // Session token auth — per-user tokens from OTP verification
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    // Skip if it looks like a JWT (has dots) — that's CF Access or dev JWT
    if (!token.includes('.')) {
      const tokenHash = await hashEmail(token); // reuse SHA-256 helper
      const db = drizzle(c.env.DB, { schema });
      const user = await db.select().from(schema.users)
        .where(eq(schema.users.sessionToken, tokenHash)).get();

      if (user && user.sessionExpiresAt && user.sessionExpiresAt > new Date()) {
        c.set('userId', user.id);
        c.set('userEmail', user.email);
        c.set('userName', user.name || user.email);
        await next();
        return;
      }
      // Invalid/expired token — fall through to other methods
    }
  }

  const cfToken = c.req.header('CF-Authorization');
  const token = cfToken || authHeader?.replace('Bearer ', '');

  if (!token) {
    return c.json({ error: 'Unauthorized: No token provided' }, 401);
  }

  const isProduction = c.env.ENVIRONMENT === 'production';

  try {
    let payload: JWTPayload | null;

    if (isProduction) {
      const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
      const audience = c.env.CF_ACCESS_AUDIENCE;

      if (!teamDomain || !audience) {
        console.error('Missing CF_ACCESS_TEAM_DOMAIN or CF_ACCESS_AUDIENCE');
        return c.json({ error: 'Server misconfiguration' }, 500);
      }

      const parsed = parseJWTUnverified(token);
      if (!parsed) {
        return c.json({ error: 'Unauthorized: Malformed token' }, 401);
      }

      // Verify signature
      const keys = await getPublicKeys(teamDomain);
      const kid = parsed.header.kid;
      let verified = false;

      if (kid && keys.has(kid)) {
        verified = await verifyJWTSignature(token, keys.get(kid)!);
      } else {
        // Try all keys if kid not found (key rotation)
        for (const key of keys.values()) {
          if (await verifyJWTSignature(token, key)) {
            verified = true;
            break;
          }
        }
      }

      if (!verified) {
        return c.json({ error: 'Unauthorized: Invalid signature' }, 401);
      }

      // Validate claims
      const claimError = validateClaims(parsed.payload, audience, teamDomain);
      if (claimError) {
        return c.json({ error: `Unauthorized: ${claimError}` }, 401);
      }

      payload = parsed.payload;
    } else {
      // Development: simplified decode without signature verification
      payload = parseJWTDev(token);
    }

    if (!payload || !payload.email) {
      return c.json({ error: 'Unauthorized: Missing email claim' }, 401);
    }

    const userId = await hashEmail(payload.email);
    c.set('userId', userId);
    c.set('userEmail', payload.email);
    c.set('userName', (payload.name as string) || payload.email);

    await next();
  } catch (error) {
    console.error('Auth error:', error);
    return c.json({ error: 'Unauthorized: Invalid token' }, 401);
  }
}

/**
 * Optional middleware — allows requests without auth
 */
export async function optionalAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const cfToken = c.req.header('CF-Authorization');
  const authHeader = c.req.header('Authorization');
  const token = cfToken || authHeader?.replace('Bearer ', '');

  if (token) {
    try {
      const isProduction = c.env.ENVIRONMENT === 'production';
      let payload: JWTPayload | null = null;

      if (isProduction) {
        const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
        const audience = c.env.CF_ACCESS_AUDIENCE;
        if (teamDomain && audience) {
          const parsed = parseJWTUnverified(token);
          if (parsed) {
            const keys = await getPublicKeys(teamDomain);
            const kid = parsed.header.kid;
            let verified = false;

            if (kid && keys.has(kid)) {
              verified = await verifyJWTSignature(token, keys.get(kid)!);
            } else {
              for (const key of keys.values()) {
                if (await verifyJWTSignature(token, key)) {
                  verified = true;
                  break;
                }
              }
            }

            if (verified && !validateClaims(parsed.payload, audience, teamDomain)) {
              payload = parsed.payload;
            }
          }
        }
      } else {
        payload = parseJWTDev(token);
      }

      if (payload?.email) {
        const userId = await hashEmail(payload.email);
        c.set('userId', userId);
        c.set('userEmail', payload.email);
        c.set('userName', (payload.name as string) || payload.email);
      }
    } catch {
      // Ignore auth errors for optional auth
    }
  }

  await next();
}

