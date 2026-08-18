import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Env } from '../types';
import * as schema from '../db/schema';
import { getDb } from './notes';

export const DEFAULT_EPHEMERAL_TTL_DAYS = 30;
const TTL_SETTING_KEY = 'ephemeral_ttl_days';

/** The app-wide default TTL for new ephemeral notes (not per-user — see appSettings). */
export async function getEphemeralTtlDays(env: Env): Promise<number> {
  const db = getDb(env.DB);
  const row = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, TTL_SETTING_KEY))
    .get();
  if (!row) return DEFAULT_EPHEMERAL_TTL_DAYS;
  const parsed = parseInt(row.value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EPHEMERAL_TTL_DAYS;
}

export async function setEphemeralTtlDays(env: Env, days: number): Promise<number> {
  const db = getDb(env.DB);
  await db
    .insert(schema.appSettings)
    .values({ key: TTL_SETTING_KEY, value: String(days), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: String(days), updatedAt: new Date() },
    });
  return days;
}

export function expiresAtFromNow(ttlDays: number): Date {
  return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
}

/**
 * Daily sweep: deletes ephemeral documents past their expiresAt, and any feed
 * posts sourced from them — feed_posts.sourceDocumentId is ON DELETE SET NULL
 * (so a manually deleted note's posts survive with the source link cleared),
 * but ephemeral notes should take their feed posts down with them if the user
 * never converted the note to permanent.
 */
export async function expireEphemeralDocuments(env: Env): Promise<number> {
  const db = getDb(env.DB);
  const now = new Date();

  const expired = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(and(eq(schema.documents.isEphemeral, true), lt(schema.documents.expiresAt, now)))
    .all();

  if (expired.length === 0) return 0;
  const ids = expired.map((d) => d.id);

  await db.delete(schema.feedPosts).where(inArray(schema.feedPosts.sourceDocumentId, ids));
  await db.delete(schema.documents).where(inArray(schema.documents.id, ids));

  return ids.length;
}
