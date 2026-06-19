import type { Context } from 'hono';
import type { Env } from '../types';

const SESSION_COOKIE = 'sc_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export interface SessionData {
  user_id: string;
  email: string;
}

export async function issueSession(c: Context<{ Bindings: Env }>, data: SessionData): Promise<void> {
  const sessionId = `ses_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = Date.now();
  const expires = now + SESSION_TTL_MS;
  await c.env.DB.prepare(
    `INSERT INTO web_sessions (session_id, user_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(sessionId, data.user_id, data.email, now, expires).run();

  c.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
  );
}

export async function readSession(c: Context<{ Bindings: Env }>): Promise<SessionData | null> {
  const cookie = c.req.header('Cookie') ?? '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  const sessionId = match[1]!;
  const row = await c.env.DB.prepare(
    `SELECT user_id, email, expires_at FROM web_sessions WHERE session_id = ?`
  ).bind(sessionId).first<{ user_id: string; email: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  return { user_id: row.user_id, email: row.email };
}

export function clearSession(c: Context<{ Bindings: Env }>): void {
  c.header('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
