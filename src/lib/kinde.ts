import * as jose from 'jose';
import { hubAudience } from './urls';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { Env } from '../types';
import { syncKindeOrgMembership } from './orgAccounts';

/**
 * Verifies a Kinde-issued access token — the credential Scribe's iOS and
 * Android apps both present directly now (audience
 * "https://scribe.kecker.co"), having signed in with the official Kinde
 * SDK client-side. The legacy email-OTP session token is still accepted
 * alongside it (see routes/auth.ts) for accounts that haven't
 * re-authenticated since the migration — both credential kinds are
 * accepted side by side, see middleware/auth.ts and index.ts's MCP
 * resolver.
 *
 * One JWKS per isolate, cached and auto-refreshed by `jose` itself.
 */
let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
let jwksDomain: string | null = null;

export function getJwks(domain: string) {
  if (!jwks || jwksDomain !== domain) {
    jwks = jose.createRemoteJWKSet(new URL(`${domain}/.well-known/jwks.json`));
    jwksDomain = domain;
  }
  return jwks;
}

export interface KindeIdentity {
  /** Kinde's stable user id (the JWT's `sub`). Not used as Scribe's own user id — see userIdForIdentity. */
  sub: string;
  /** May be empty — Kinde's access token doesn't always carry it depending on dashboard config. */
  email: string;
  /** Kinde org codes from the token's `org_codes` claim, when the dashboard is set to include it. Undefined = claim absent. */
  orgCodes?: string[];
}

// kecker-mcp-hub forwards a Kinde access token it obtained for ITS OWN
// audience (not this app's) when relaying an MCP tool call on a user's
// behalf — see kecker-mcp-hub/src/routes/oauth.ts. Accepting either
// audience lets that token verify here without the hub needing to hold (or
// this app needing to mint) a separate per-app token.

export async function verifyKindeAccessToken(env: Env, token: string): Promise<KindeIdentity | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getJwks(env.KINDE_DOMAIN), {
      issuer: env.KINDE_DOMAIN,
      audience: [env.KINDE_AUDIENCE, hubAudience(env)],
    });
    if (typeof payload.sub !== 'string') return null;
    const email = typeof payload.email === 'string' ? payload.email : '';
    const orgCodes = Array.isArray(payload.org_codes) ? payload.org_codes.filter((c): c is string => typeof c === 'string') : undefined;
    return { sub: payload.sub, email, orgCodes };
  } catch {
    return null;
  }
}

/**
 * Unlike Base (which abandoned its own user-id scheme for Kinde's `sub`
 * directly, with nothing at stake since those workspaces were minutes
 * old), Scribe has a real, populated `users` table keyed by
 * `sha256(lowercased email)` — documents.user_id and every other
 * user-scoped row already point at that id. Switching to Kinde's `sub`
 * would orphan every existing user's documents the moment they sign in
 * with Kinde instead of OTP. So Scribe's stable user id stays
 * sha256(email) exactly as before; Kinde only replaces how the email gets
 * verified, not the id derived from it. Falls back to a `kinde_<sub>`
 * id only for the (expected to be rare) case where Kinde's access token
 * genuinely carries no email — a brand new user with no legacy row to
 * preserve continuity with anyway.
 */
export async function userIdForIdentity(identity: KindeIdentity): Promise<string> {
  if (identity.email) return sha256Hex(identity.email.toLowerCase().trim());
  return `kinde_${identity.sub}`;
}

/**
 * Resolves a verified Kinde identity to Scribe's own {userId, email},
 * upserting the `users` row the same way for every caller of this (the REST
 * API's middleware/auth.ts and the MCP endpoint's resolver in index.ts) —
 * extracted here so the two call sites can't drift into resolving the same
 * identity two different ways.
 */
export async function resolveAndUpsertKindeUser(
  env: Env,
  identity: KindeIdentity
): Promise<{ userId: string; email: string }> {
  const userId = await userIdForIdentity(identity);
  const db = drizzle(env.DB, { schema });
  const existing = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!existing) {
    await db.insert(schema.users).values({
      id: userId,
      email: identity.email || `${userId}@kinde.local`,
      createdAt: new Date(),
      lastLoginAt: new Date(),
      isVerified: true,
    }).onConflictDoNothing();
  } else if (!existing.lastLoginAt || Date.now() - existing.lastLoginAt.getTime() > 60_000) {
    await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, userId));
  }
  // Kinde decides who is in each linked business org: when the token carries the org claim, make membership match it.
  if (identity.orgCodes) {
    try { await syncKindeOrgMembership(env, userId, identity.orgCodes); } catch (e) { console.warn('Kinde org sync failed:', e); }
  }
  return { userId, email: identity.email || existing?.email || '' };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A Kinde-issued JWT and a (currently unconfigured, legacy) Cloudflare
 * Access JWT both have three dot-separated segments — `looksLikeJwt` alone
 * can't tell them apart the way it does in Base, which never had a second
 * JWT-based scheme to preserve. Decode (not verify) the `iss` claim first
 * to route to the right verifier; middleware/auth.ts falls through to the
 * existing CF Access path when this returns false.
 */
export function isKindeJwt(token: string, kindeDomain: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.iss === kindeDomain;
  } catch {
    return false;
  }
}
