import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';

export const HUB_QUOTA_URL = 'https://mcp.kecker.co/api/quota';

export async function calculateScribeStorageBytes(
  db: D1Database,
  userId: string
): Promise<{ bytes: number; count: number }> {
  try {
    const row = await db.prepare(
      `SELECT
         COALESCE(SUM(LENGTH(COALESCE(content, '')) + LENGTH(COALESCE(markdown, '')) + LENGTH(COALESCE(title, ''))), 0) as total_bytes,
         COUNT(*) as doc_count
       FROM documents
       WHERE userId = ?`
    ).bind(userId).first<{ total_bytes: number; doc_count: number }>();

    return {
      bytes: Number(row?.total_bytes ?? 0),
      count: Number(row?.doc_count ?? 0),
    };
  } catch (e) {
    console.error('Error calculating Scribe storage bytes:', e);
    return { bytes: 0, count: 0 };
  }
}

export async function reportScribeQuota(
  env: Env,
  userId: string,
  userEmail?: string
): Promise<void> {
  if (!userId) return;
  try {
    const { bytes, count } = await calculateScribeStorageBytes(env.DB, userId);
    const hubUrl = `${HUB_QUOTA_URL}/${encodeURIComponent(userId)}/report`;
    await fetch(hubUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: 'scribe',
        bytes,
        itemCount: count,
        email: userEmail,
      }),
    });
  } catch (err) {
    // Fail-open: quota reporting error should not break the user's workflow
    console.warn('Failed to report Scribe quota to hub:', err);
  }
}

export function triggerQuotaReport(c: any, env: Env, userId: string, userEmail?: string): void {
  const p = reportScribeQuota(env, userId, userEmail);
  try {
    if (c && 'executionCtx' in c && c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
      c.executionCtx.waitUntil(p);
      return;
    }
  } catch {}
  p.catch(() => {});
}

export async function checkScribeQuota(
  env: Env,
  userId: string,
  additionalBytes: number = 0,
  userEmail?: string
): Promise<{ allowed: boolean; message?: string }> {
  if (!userId) return { allowed: true };
  try {
    const hubUrl = `${HUB_QUOTA_URL}/${encodeURIComponent(userId)}/check`;
    const res = await fetch(hubUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: 'scribe',
        additionalBytes,
        email: userEmail,
      }),
    });

    if (res.status === 403) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      return {
        allowed: false,
        message: data.message || 'Collective storage limit of 50 MB reached across Kecker Office apps.',
      };
    }
    return { allowed: true };
  } catch (err) {
    // Fail-open on network/hub downtime so legitimate user requests are not blocked
    console.warn('Failed to check quota with hub, failing open:', err);
    return { allowed: true };
  }
}
