import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Env } from '../types';

const auth = new Hono<{ Bindings: Env }>();

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

    // In production, send email via MailChannels or SES
    if (c.env.ENVIRONMENT !== 'production') {
      console.log(`[DEV] OTP for ${email}: ${otp}`);
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
