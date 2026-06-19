import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Env } from '../types';
import { listTags, searchByTag } from '../services/notes';

const tags = new Hono<{ Bindings: Env }>();

/** All tags with usage counts (popular first). GET /api/tags */
tags.get('/', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const userId = c.get('userId');
  return c.json({ tags: await listTags(db, userId) });
});

/** Documents carrying a tag. GET /api/tags/:tag */
tags.get('/:tag', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const userId = c.get('userId');
  return c.json({ documents: await searchByTag(db, c.req.param('tag'), userId) });
});

export default tags;
