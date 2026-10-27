import type { D1Database } from '@cloudflare/workers-types';
import { hubQuotaUrl } from './urls';
import type { Env } from '../types';


/**
 * Checks whether an account is exempt from storage caps and receives unlimited quota.
 * Exempt accounts:
 * 1. Specific admin/owner account: vlukereddy@gmail.com (and aliases)
 * 2. Kecker employees: Any email ending with @kecker.co or @kecker.com (or subdomains)
 */
export function isUnlimitedAccount(userId?: string | null, email?: string | null): boolean {
  const candidates = [email, userId]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().toLowerCase());

  for (const candidate of candidates) {
    if (
      candidate === 'vlukereddy@gmail.com' ||
      (candidate.startsWith('vlukereddy+') && candidate.endsWith('@gmail.com')) ||
      candidate === 'vishal.reddy@apexcapitalcorp.com'
    ) {
      return true;
    }
    if (
      candidate.endsWith('@kecker.co') ||
      candidate.endsWith('@kecker.com') ||
      /@([a-z0-9-]+\.)?kecker\.(co|com)$/i.test(candidate)
    ) {
      return true;
    }
  }

  return false;
}

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
       WHERE user_id = ?`
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
    const reportUrl = `${hubQuotaUrl(env)}/${encodeURIComponent(userId)}/report`;
    await fetch(reportUrl, {
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
  if (isUnlimitedAccount(userId, userEmail)) {
    return { allowed: true };
  }
  try {
    const checkUrl = `${hubQuotaUrl(env)}/${encodeURIComponent(userId)}/check`;
    const res = await fetch(checkUrl, {
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
