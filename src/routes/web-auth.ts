import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Env } from '../types';
import { issueSession, clearSession } from '../lib/session';
import { verifyKindeAccessToken, userIdForIdentity } from '../lib/kinde';

export const webAuthRoute = new Hono<{ Bindings: Env }>();

const STATE_COOKIE = 'kinde_oauth_state';

const HTML_SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
};

webAuthRoute.use('*', async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(HTML_SECURITY_HEADERS)) {
    c.res.headers.set(k, v);
  }
});

const sanitizeReturn = (r: string) => (r.startsWith('/') && !r.startsWith('//') ? r : '/');

/**
 * Kinde-backed login for Scribe's web surface — replaces the password
 * login/register forms this file used to render (see git history). Mirrors
 * Base's apps/backend/src/routes/auth.ts /auth/kinde/login + callback shape
 * exactly; this is a confidential client (the "Scribe Web" Kinde
 * application has a secret), so no PKCE needed.
 *
 * Scribe's iOS app does NOT reach these routes — it signs into Kinde
 * directly via the native SDK client-side (see scribe-mobile) and presents
 * the resulting token as a Bearer header instead, same split as Base. Only
 * a human browser approving a third-party MCP client's consent screen
 * (routes/oauth.ts) or visiting the web dashboard reaches this login.
 *
 * Scribe's Android app is NOT migrated to Kinde yet (still email-OTP via
 * /api/auth/*, see middleware/auth.ts's doc comment) and never reaches
 * these routes either.
 */
webAuthRoute.get('/kinde/login', async (c) => {
  const returnTo = sanitizeReturn(c.req.query('return_to') ?? '/');
  const state = crypto.randomUUID();
  c.header('Set-Cookie', `${STATE_COOKIE}=${state}|${encodeURIComponent(returnTo)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

  const origin = new URL(c.req.url).origin;
  const params = new URLSearchParams({
    client_id: c.env.KINDE_CLIENT_ID,
    redirect_uri: `${origin}/auth/kinde/callback`,
    response_type: 'code',
    scope: 'openid profile email',
    audience: c.env.KINDE_AUDIENCE,
    state,
  });
  return c.redirect(`${c.env.KINDE_DOMAIN}/oauth2/auth?${params.toString()}`, 302);
});

webAuthRoute.get('/kinde/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const cookie = c.req.header('Cookie') ?? '';
  const stateCookie = cookie.match(new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`))?.[1];
  const separatorIndex = stateCookie?.indexOf('|') ?? -1;
  const expectedState = separatorIndex > -1 ? stateCookie!.slice(0, separatorIndex) : undefined;
  const encodedReturnTo = separatorIndex > -1 ? stateCookie!.slice(separatorIndex + 1) : undefined;
  c.header('Set-Cookie', `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);

  if (!code || !state || !expectedState || state !== expectedState || !encodedReturnTo) {
    return c.text('Sign-in failed — your session expired, go back and try again.', 400);
  }
  const returnTo = decodeURIComponent(encodedReturnTo);

  const origin = new URL(c.req.url).origin;
  const tokenRes = await fetch(`${c.env.KINDE_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: c.env.KINDE_CLIENT_ID,
      client_secret: c.env.KINDE_CLIENT_SECRET,
      code,
      redirect_uri: `${origin}/auth/kinde/callback`,
    }),
  });
  if (!tokenRes.ok) {
    console.error('Kinde token exchange failed', tokenRes.status, await tokenRes.text());
    return c.text('Sign-in failed. Try again.', 502);
  }
  const { access_token } = await tokenRes.json<{ access_token: string }>();

  const identity = await verifyKindeAccessToken(c.env, access_token);
  if (!identity) return c.text('Sign-in failed. Try again.', 502);

  const userId = await userIdForIdentity(identity);
  const db = drizzle(c.env.DB, { schema });
  const existing = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!existing) {
    await db.insert(schema.users).values({
      id: userId,
      email: identity.email || `${userId}@kinde.local`,
      createdAt: new Date(),
      lastLoginAt: new Date(),
      isVerified: true,
    }).onConflictDoNothing();
  } else {
    await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, userId));
  }

  await issueSession(c, { user_id: userId, email: identity.email || existing?.email || '' });
  return c.redirect(returnTo, 302);
});

webAuthRoute.get('/logout', (c) => { clearSession(c); return c.redirect('/', 302); });
webAuthRoute.post('/logout', (c) => { clearSession(c); return c.redirect('/', 302); });
