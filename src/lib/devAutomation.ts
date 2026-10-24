import * as jose from 'jose';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Env } from '../types';
import { getJwks } from './kinde';

/** The one identity automation may act as. Never a real user. */
export const DEV_AUTOMATION_EMAIL = 'dev-tester@kecker.co';

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Lets emulator/simulator automation act as the fixed dev test user with a Kinde client-credentials (M2M) token,
 * instead of a shared secret that mints sessions.
 *
 * Accepted only when ALL hold, so it cannot do anything on production or on a half-configured dev Worker:
 *  - ENVIRONMENT is exactly "development" (prod never has these variables either);
 *  - DEV_AUTOMATION_CLIENT_ID and DEV_AUTOMATION_AUDIENCE are set;
 *  - the token is signed by Kinde (JWKS), issued by this Kinde domain, for the DEV-ONLY audience (so it is rejected by
 *    the prod Worker, whose audience differs), and issued to exactly that M2M client (`azp` / `client_id`).
 *
 * Returns Scribe's own {userId, email} for the fixed test user, creating the row on first use.
 */
export async function verifyDevAutomationToken(
  env: Env,
  token: string,
  getKey: jose.JWTVerifyGetKey | CryptoKey | Uint8Array = getJwks(env.KINDE_DOMAIN)
): Promise<{ userId: string; email: string } | null> {
  if (env.ENVIRONMENT !== 'development') return null;
  const clientId = env.DEV_AUTOMATION_CLIENT_ID;
  const audience = env.DEV_AUTOMATION_AUDIENCE;
  if (!clientId || !audience || !env.KINDE_DOMAIN) return null;

  try {
    const { payload } = await jose.jwtVerify(token, getKey as jose.JWTVerifyGetKey, {
      issuer: env.KINDE_DOMAIN,
      audience,
    });
    const issuedTo = (payload.azp ?? payload.client_id) as unknown;
    if (issuedTo !== clientId) return null;
  } catch {
    return null;
  }

  const db = drizzle(env.DB, { schema });
  let user = await db.select().from(schema.users).where(eq(schema.users.email, DEV_AUTOMATION_EMAIL)).get();
  if (!user) {
    const id = await sha256Hex(DEV_AUTOMATION_EMAIL);
    await db.insert(schema.users).values({
      id, email: DEV_AUTOMATION_EMAIL, createdAt: new Date(), isVerified: true, name: 'Dev Tester',
    });
    user = await db.select().from(schema.users).where(eq(schema.users.id, id)).get();
  }
  return user ? { userId: user.id, email: user.email } : null;
}
