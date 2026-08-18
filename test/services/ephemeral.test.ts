import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { expireEphemeralDocuments, getEphemeralTtlDays, setEphemeralTtlDays } from '../../src/services/ephemeral';
import { applyMigrations } from '../helpers';

describe('expireEphemeralDocuments', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM feed_posts').run();
    await env.DB.prepare('DELETE FROM documents').run();
    await env.DB.prepare('DELETE FROM app_settings').run();
  });

  // Drizzle's sqlite `{mode: 'timestamp'}` stores/reads whole SECONDS since
  // epoch (mapToDriverValue does Math.floor(date.getTime() / 1000)) — not ms.
  const nowSec = () => Math.floor(Date.now() / 1000);

  async function insertDoc(overrides: Record<string, unknown> = {}): Promise<string> {
    const id = crypto.randomUUID();
    const doc = {
      title: 'Note', is_ephemeral: 0, expires_at: null as number | null,
      created_at: nowSec(), updated_at: nowSec(), ...overrides,
    };
    await env.DB.prepare(
      `INSERT INTO documents (id, title, content, markdown, created_at, updated_at, created_by, last_edited_by, is_ephemeral, expires_at)
       VALUES (?, ?, '', 'body', ?, ?, 'claude', 'claude', ?, ?)`
    ).bind(id, doc.title, doc.created_at, doc.updated_at, doc.is_ephemeral, doc.expires_at).run();
    return id;
  }

  async function insertFeedPost(sourceDocumentId: string): Promise<string> {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO feed_posts (id, text, author_name, author_handle, source_document_id, created_at)
       VALUES (?, 'snippet', 'Aquinas Daily', 'aquinas', ?, ?)`
    ).bind(id, sourceDocumentId, nowSec()).run();
    return id;
  }

  it('deletes only expired ephemeral documents', async () => {
    const expired = await insertDoc({ is_ephemeral: 1, expires_at: nowSec() - 10 });
    const notYetExpired = await insertDoc({ is_ephemeral: 1, expires_at: nowSec() + 60 * 60 * 24 });
    const permanent = await insertDoc({ is_ephemeral: 0, expires_at: null });

    const deleted = await expireEphemeralDocuments(env);
    expect(deleted).toBe(1);

    const remaining = await env.DB.prepare('SELECT id FROM documents').all();
    const ids = remaining.results.map((r: any) => r.id);
    expect(ids).not.toContain(expired);
    expect(ids).toContain(notYetExpired);
    expect(ids).toContain(permanent);
  });

  it('deletes feed posts sourced from an expired note', async () => {
    const expired = await insertDoc({ is_ephemeral: 1, expires_at: nowSec() - 10 });
    const postId = await insertFeedPost(expired);

    await expireEphemeralDocuments(env);

    const post = await env.DB.prepare('SELECT id FROM feed_posts WHERE id = ?').bind(postId).first();
    expect(post).toBeNull();
  });

  it('is a no-op when nothing is expired', async () => {
    await insertDoc({ is_ephemeral: 1, expires_at: nowSec() + 60 * 60 * 24 });
    const deleted = await expireEphemeralDocuments(env);
    expect(deleted).toBe(0);
  });
});

describe('ephemeral TTL setting', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM app_settings').run();
  });

  it('defaults to 30 days when unset', async () => {
    expect(await getEphemeralTtlDays(env)).toBe(30);
  });

  it('round-trips a custom value', async () => {
    await setEphemeralTtlDays(env, 5);
    expect(await getEphemeralTtlDays(env)).toBe(5);
  });
});
