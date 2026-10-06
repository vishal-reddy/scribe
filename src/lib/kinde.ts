import * as jose from 'jose';
import type { Env } from '../types';

/**
 * Verifies a Kinde-issued access token — the credential Scribe's iOS app
 * presents directly now (audience "https://scribe.kecker.co"), having
 * signed in with the official Kinde SDK client-side. Scribe's Android app
 * is NOT migrated yet (still email-OTP, see routes/auth.ts) — both
 * credential kinds are accepted side by side, see middleware/auth.ts.
 *
 * One JWKS per isolate, cached and auto-refreshed by `jose` itself.
 */
let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
let jwksDomain: string | null = null;

function getJwks(domain: string) {
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
}

export async function verifyKindeAccessToken(env: Env, token: string): Promise<KindeIdentity | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getJwks(env.KINDE_DOMAIN), {
      issuer: env.KINDE_DOMAIN,
      audience: env.KINDE_AUDIENCE,
    });
    if (typeof payload.sub !== 'string') return null;
    const email = typeof payload.email === 'string' ? payload.email : '';
    return { sub: payload.sub, email };
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
