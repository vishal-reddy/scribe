import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { applyMigrations, getAuthHeaders, userIdFor } from '../helpers';

describe('Feed API', () => {
  const authHeaders = getAuthHeaders();

  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM feed_posts').run();
    await env.DB.prepare('DELETE FROM documents').run();
  });

  async function insertPost(overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
    const post = {
      id: crypto.randomUUID(),
      user_id: null as string | null,
      text: 'What distinguishes a habit from a passion?',
      kind: 'recall',
      author_name: 'Aquinas Daily',
      author_handle: 'aquinas',
      author_avatar: '🟣',
      source_document_id: null as string | null,
      source_title: null as string | null,
      created_at: Date.now(),
      saved_at: null as number | null,
      ...overrides,
    };
    await env.DB.prepare(
      `INSERT INTO feed_posts (id, user_id, text, kind, author_name, author_handle, author_avatar, source_document_id, source_title, created_at, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      post.id, post.user_id, post.text, post.kind, post.author_name, post.author_handle,
      post.author_avatar, post.source_document_id, post.source_title, post.created_at, post.saved_at
    ).run();
    return post;
  }

  describe('GET /api/feed', () => {
    it('requires authentication', async () => {
      const res = await app.request('/api/feed', {}, env);
      expect(res.status).toBe(401);
    });

    it('returns an empty list when there are no posts', async () => {
      const res = await app.request('/api/feed', { headers: authHeaders }, env);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.posts).toEqual([]);
      expect(data.total).toBe(0);
    });

    it('returns posts newest-first', async () => {
      await insertPost({ text: 'older', created_at: 1000 });
      await insertPost({ text: 'newer', created_at: 2000 });

      const res = await app.request('/api/feed', { headers: authHeaders }, env);
      const data: any = await res.json();
      expect(data.total).toBe(2);
      expect(data.posts.map((p: any) => p.text)).toEqual(['newer', 'older']);
    });

    it('filters to bookmarked posts with ?saved=true', async () => {
      await insertPost({ text: 'unsaved' });
      await insertPost({ text: 'saved', saved_at: Date.now() });

      const res = await app.request('/api/feed?saved=true', { headers: authHeaders }, env);
      const data: any = await res.json();
      expect(data.total).toBe(1);
      expect(data.posts[0].text).toBe('saved');
    });

    it('shows public (Claude-authored) and own posts, hides other users', async () => {
      const myId = await userIdFor();
      await insertPost({ text: 'public', user_id: null });
      await insertPost({ text: 'mine', user_id: myId });
      await insertPost({ text: 'theirs', user_id: 'another-user-id' });

      const res = await app.request('/api/feed', { headers: authHeaders }, env);
      const data: any = await res.json();
      const texts = data.posts.map((p: any) => p.text).sort();
      expect(texts).toEqual(['mine', 'public']);
    });

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 5; i++) await insertPost({ text: `p${i}`, created_at: i });
      const res = await app.request('/api/feed?limit=2', { headers: authHeaders }, env);
      const data: any = await res.json();
      expect(data.posts.length).toBe(2);
      expect(data.total).toBe(5); // total is the full count, not the page
    });
  });

  describe('POST /api/feed/:id/save', () => {
    it('requires authentication', async () => {
      const post = await insertPost();
      const res = await app.request(`/api/feed/${post.id}/save`, { method: 'POST' }, env);
      expect(res.status).toBe(401);
    });

    it('toggles the bookmark state', async () => {
      const post = await insertPost();

      let res = await app.request(`/api/feed/${post.id}/save`, { method: 'POST', headers: authHeaders }, env);
      expect(res.status).toBe(200);
      let data: any = await res.json();
      expect(data.saved).toBe(true);

      res = await app.request(`/api/feed/${post.id}/save`, { method: 'POST', headers: authHeaders }, env);
      data = await res.json();
      expect(data.saved).toBe(false);
    });

    it('persists the saved state (visible via ?saved=true)', async () => {
      const post = await insertPost();
      await app.request(`/api/feed/${post.id}/save`, { method: 'POST', headers: authHeaders }, env);

      const res = await app.request('/api/feed?saved=true', { headers: authHeaders }, env);
      const data: any = await res.json();
      expect(data.total).toBe(1);
      expect(data.posts[0].id).toBe(post.id);
    });

    it('returns 404 for an unknown post', async () => {
      const res = await app.request('/api/feed/does-not-exist/save', { method: 'POST', headers: authHeaders }, env);
      expect(res.status).toBe(404);
    });
  });

  describe('auto-queue on note write', () => {
    it('queues a note for the feed when it is created', async () => {
      const res = await app.request('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ title: 'Virtues', markdown: '# Virtue is a habit' }),
      }, env);
      expect(res.status).toBe(201);
      const { document }: any = await res.json();

      const row = await env.DB.prepare('SELECT feed_queued_at FROM documents WHERE id = ?')
        .bind(document.id).first<{ feed_queued_at: number | null }>();
      expect(row?.feed_queued_at).toBeTruthy();
    });

    it('re-queues a note when its content is updated', async () => {
      const create = await app.request('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ title: 'Note', markdown: 'first' }),
      }, env);
      const { document }: any = await create.json();

      // Clear the queue flag, then update — it should be set again.
      await env.DB.prepare('UPDATE documents SET feed_queued_at = NULL WHERE id = ?').bind(document.id).run();
      await app.request(`/api/documents/${document.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ markdown: 'second' }),
      }, env);

      const row = await env.DB.prepare('SELECT feed_queued_at FROM documents WHERE id = ?')
        .bind(document.id).first<{ feed_queued_at: number | null }>();
      expect(row?.feed_queued_at).toBeTruthy();
    });
  });
});
