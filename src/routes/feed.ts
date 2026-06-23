import { Hono } from 'hono';
import { eq, desc, or, sql, count, and, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Env } from '../types';

const feed = new Hono<{ Bindings: Env }>();

function parsePagination(c: { req: { query: (key: string) => string | undefined } }, maxLimit = 100, defaultLimit = 30) {
  const rawLimit = parseInt(c.req.query('limit') || String(defaultLimit), 10);
  const rawOffset = parseInt(c.req.query('offset') || '0', 10);
  const limit = Math.max(1, Math.min(Number.isNaN(rawLimit) ? defaultLimit : rawLimit, maxLimit));
  const offset = Math.max(0, Number.isNaN(rawOffset) ? 0 : rawOffset);
  return { limit, offset };
}

/**
 * List feed posts (newest first). Mirrors documents' ownership model: a post is
 * visible if it belongs to the user OR has no owner (Claude-authored, userId
 * NULL). `?saved=true` returns only bookmarked posts.
 * GET /api/feed
 */
feed.get('/', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const { limit, offset } = parsePagination(c);
  const userId = c.get('userId');
  const savedOnly = c.req.query('saved') === 'true';

  const ownershipFilter = or(
    eq(schema.feedPosts.userId, userId),
    sql`${schema.feedPosts.userId} IS NULL`
  );
  const where = savedOnly
    ? and(ownershipFilter, isNotNull(schema.feedPosts.savedAt))
    : ownershipFilter;

  try {
    const posts = await db
      .select()
      .from(schema.feedPosts)
      .where(where)
      .orderBy(desc(schema.feedPosts.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.feedPosts)
      .where(where);

    return c.json({ posts, total, limit, offset });
  } catch (error) {
    console.error('Error fetching feed:', error);
    return c.json({ error: 'Failed to fetch feed' }, 500);
  }
});

/**
 * Toggle the bookmark (saved) state of a post.
 * POST /api/feed/:id/save
 */
feed.post('/:id/save', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = c.req.param('id');
  const userId = c.get('userId');

  const ownershipFilter = or(
    eq(schema.feedPosts.userId, userId),
    sql`${schema.feedPosts.userId} IS NULL`
  );

  try {
    const post = await db
      .select({ id: schema.feedPosts.id, savedAt: schema.feedPosts.savedAt })
      .from(schema.feedPosts)
      .where(and(eq(schema.feedPosts.id, id), ownershipFilter))
      .get();

    if (!post) return c.json({ error: 'Post not found' }, 404);

    const nextSavedAt = post.savedAt ? null : new Date();
    await db
      .update(schema.feedPosts)
      .set({ savedAt: nextSavedAt })
      .where(eq(schema.feedPosts.id, id));

    return c.json({ id, saved: nextSavedAt !== null });
  } catch (error) {
    console.error('Error saving feed post:', error);
    return c.json({ error: 'Failed to save post' }, 500);
  }
});

export default feed;
