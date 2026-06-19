import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Env } from '../types';
import type { D1Database } from '@cloudflare/workers-types';

const auth = new Hono<{ Bindings: Env }>();

async function d1RateLimit(
  db: D1Database,
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  try {
    const result = await db.prepare(
      `INSERT INTO rate_limit_buckets (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count, window_start`
    ).bind(key, windowStart).first<{ count: number; window_start: number }>();
    const count = result?.count ?? 1;
    const ws = result?.window_start ?? windowStart;
    if (count > maxRequests) {
      return { allowed: false, retryAfterSec: Math.ceil((ws + windowMs - now) / 1000) };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch {
    return { allowed: true, retryAfterSec: 0 };
  }
}

// Generate 6-digit OTP
function generateOTP(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, '0');
}

// Hash a string using SHA-256
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Generate a cryptographically secure session token
function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

const requestOtpSchema = z.object({
  email: z.string().email().max(255).transform(e => e.toLowerCase().trim()),
});

const verifyOtpSchema = z.object({
  email: z.string().email().max(255).transform(e => e.toLowerCase().trim()),
  otp: z.string().length(6).regex(/^\d{6}$/),
});

/**
 * Request OTP — sends a 6-digit code to the user's email
 * POST /api/auth/request-otp
 */
auth.post('/request-otp', zValidator('json', requestOtpSchema), async (c) => {
  const { email } = c.req.valid('json');

  // Per-email: 5 OTP requests per 10 minutes; per-IP: 20 per 10 minutes
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const [emailLimit, ipLimit] = await Promise.all([
    d1RateLimit(c.env.DB, `otp_req:email:${email}`, 5, 10 * 60_000),
    d1RateLimit(c.env.DB, `otp_req:ip:${ip}`, 20, 10 * 60_000),
  ]);
  if (!emailLimit.allowed || !ipLimit.allowed) {
    const retry = Math.max(emailLimit.retryAfterSec, ipLimit.retryAfterSec);
    return c.json({ error: 'Too many requests. Please wait before trying again.' }, 429, { 'Retry-After': String(retry) });
  }

  const db = drizzle(c.env.DB, { schema });

  try {
    const userId = await sha256(email);
    const otp = generateOTP();
    const otpHash = await sha256(otp);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

    // Upsert user
    const existing = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();

    if (existing) {
      await db.update(schema.users).set({
        otpCode: otpHash,
        otpExpiresAt: expiresAt,
      }).where(eq(schema.users.id, existing.id));
    } else {
      await db.insert(schema.users).values({
        id: userId,
        email,
        createdAt: now,
        otpCode: otpHash,
        otpExpiresAt: expiresAt,
        isVerified: false,
      });
    }

    if (c.env.ENVIRONMENT !== 'production') {
      console.log(`[DEV] OTP for ${email}: ${otp}`);
    }

    // Send the code via Resend. EMAIL_FROM defaults to Resend's shared test
    // sender (delivers only to the account owner) until kecker.co is verified.
    if (c.env.RESEND_API_KEY) {
      const from = c.env.EMAIL_FROM || 'Scribe <onboarding@resend.dev>';
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: `Your Scribe verification code: ${otp}`,
          text: `Your Scribe verification code is ${otp}.\n\nIt expires in 5 minutes. If you didn't request this, you can ignore this email.`,
          html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px">
  <h2 style="color:#3a3a3c;font-weight:600;margin:0 0 8px">Scribe</h2>
  <p style="color:#555;margin:0 0 20px">Your verification code is:</p>
  <div style="font-size:34px;font-weight:700;letter-spacing:8px;color:#3a3a3c;background:#f2f2f7;border-radius:10px;padding:16px;text-align:center">${otp}</div>
  <p style="color:#888;font-size:13px;margin:20px 0 0">Expires in 5 minutes. If you didn't request this, you can ignore this email.</p>
</div>`,
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        console.error('Resend send failed', res.status, detail);
        return c.json({ error: 'Failed to send verification code.' }, 502);
      }
    } else if (c.env.ENVIRONMENT === 'production') {
      console.error('RESEND_API_KEY missing in production — cannot deliver OTP');
      return c.json({ error: 'Email delivery is not configured. Please try again later.' }, 500);
    }

    // In development, also return OTP in response for testing ease
    const response: Record<string, unknown> = {
      success: true,
      message: 'Verification code sent to your email',
      expiresInSeconds: 300,
    };

    if (c.env.ENVIRONMENT !== 'production') {
      response.devOtp = otp; // ONLY in dev/test!
    }

    return c.json(response);
  } catch (error) {
    console.error('Error requesting OTP:', error);
    return c.json({ error: 'Failed to send verification code' }, 500);
  }
});

/**
 * Verify OTP — validates the code and returns a session token
 * POST /api/auth/verify-otp
 */
auth.post('/verify-otp', zValidator('json', verifyOtpSchema), async (c) => {
  const { email, otp } = c.req.valid('json');

  // Per-email: 5 attempts per 15 minutes to prevent brute-force of 6-digit codes
  const attemptLimit = await d1RateLimit(c.env.DB, `otp_verify:${email}`, 5, 15 * 60_000);
  if (!attemptLimit.allowed) {
    return c.json(
      { error: 'Too many incorrect attempts. Please request a new code.' },
      429,
      { 'Retry-After': String(attemptLimit.retryAfterSec) }
    );
  }

  const db = drizzle(c.env.DB, { schema });

  try {
    const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();

    if (!user) {
      return c.json({ error: 'Invalid email or code' }, 401);
    }

    // Check OTP expiry
    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return c.json({ error: 'Code expired. Please request a new one.' }, 401);
    }

    // Verify OTP hash
    const otpHash = await sha256(otp);
    if (user.otpCode !== otpHash) {
      return c.json({ error: 'Invalid code' }, 401);
    }

    // Generate session token
    const sessionToken = generateSessionToken();
    const sessionHash = await sha256(sessionToken);
    const now = new Date();
    const sessionExpires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Update user: clear OTP, set session, mark verified
    await db.update(schema.users).set({
      otpCode: null,
      otpExpiresAt: null,
      sessionToken: sessionHash,
      sessionExpiresAt: sessionExpires,
      isVerified: true,
      lastLoginAt: now,
      name: user.name || email.split('@')[0],
    }).where(eq(schema.users.id, user.id));

    return c.json({
      success: true,
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || email.split('@')[0],
      },
      expiresAt: sessionExpires.toISOString(),
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return c.json({ error: 'Verification failed' }, 500);
  }
});

/**
 * Get current session info
 * GET /api/auth/session (requires session token in Authorization header)
 */
auth.get('/session', async (c) => {
  const userId = c.get('userId');
  const userEmail = c.get('userEmail');
  const userName = c.get('userName');

  return c.json({
    authenticated: true,
    user: {
      id: userId,
      email: userEmail,
      name: userName,
    },
  });
});

/**
 * Logout — invalidate session
 * POST /api/auth/logout
 */
auth.post('/logout', async (c) => {
  const userId = c.get('userId');
  const db = drizzle(c.env.DB, { schema });

  try {
    await db.update(schema.users).set({
      sessionToken: null,
      sessionExpiresAt: null,
    }).where(eq(schema.users.id, userId));

    return c.json({ success: true, message: 'Logged out' });
  } catch (error) {
    console.error('Error logging out:', error);
    return c.json({ error: 'Logout failed' }, 500);
  }
});

export default auth;
