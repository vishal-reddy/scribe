import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, desc, like, or, sql, count, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { createDocumentSchema, updateDocumentSchema } from '../types';
import type { Env } from '../types';
import {
  reparseDocument, rebindLinksToTitle, moveDocument, getBacklinks, getOutgoingLinks,
  addManualLink, removeLink, addTag, removeTag, NotFoundError,
} from '../services/notes';
import {
  THOMISTIC_TAXONOMY, TAXONOMY_CATEGORIES, fileDocumentInCategory,
} from '../services/classification';

const documents = new Hono<{ Bindings: Env }>();

function parsePagination(c: { req: { query: (key: string) => string | undefined } }, maxLimit = 100, defaultLimit = 50) {
  const rawLimit = parseInt(c.req.query('limit') || String(defaultLimit), 10);
  const rawOffset = parseInt(c.req.query('offset') || '0', 10);
  const limit = Math.max(1, Math.min(rawLimit, maxLimit));
  const offset = Math.max(0, rawOffset);
  return { limit, offset };
}

/**
 * Search documents by title and content
 * GET /api/documents/search?q=query
 */
documents.get('/search', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const query = c.req.query('q')?.trim();
  const userId = c.get('userId');

  if (!query) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  const { limit, offset } = parsePagination(c);
  const pattern = `%${query}%`;

  const ownershipFilter = or(
    eq(schema.documents.userId, userId),
    sql`${schema.documents.userId} IS NULL`
  );

  try {
    const results = await db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        markdown: schema.documents.markdown,
        createdAt: schema.documents.createdAt,
        updatedAt: schema.documents.updatedAt,
        createdBy: schema.documents.createdBy,
        lastEditedBy: schema.documents.lastEditedBy,
        // Title matches rank higher (2) than content matches (1)
        relevance: sql<number>`(CASE WHEN ${schema.documents.title} LIKE ${pattern} THEN 2 ELSE 0 END) + (CASE WHEN ${schema.documents.markdown} LIKE ${pattern} THEN 1 ELSE 0 END)`.as('relevance'),
      })
      .from(schema.documents)
      .where(
        and(
          ownershipFilter,
          or(
            like(schema.documents.title, pattern),
            like(schema.documents.markdown, pattern),
          )
        )
      )
      .orderBy(sql`relevance DESC`, desc(schema.documents.updatedAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.documents)
      .where(
        and(
          ownershipFilter,
          or(
            like(schema.documents.title, pattern),
            like(schema.documents.markdown, pattern),
          )
        )
      );

    return c.json({ documents: results, total, limit, offset, query });
  } catch (error) {
    console.error('Error searching documents:', error);
    return c.json({ error: 'Failed to search documents' }, 500);
  }
});

/**
 * List all documents for the authenticated user
 * GET /api/documents
 */
documents.get('/', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const { limit, offset } = parsePagination(c);
  const userId = c.get('userId');

  const ownershipFilter = or(
    eq(schema.documents.userId, userId),
    sql`${schema.documents.userId} IS NULL`
  );

  try {
    const allDocs = await db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        markdown: schema.documents.markdown,
        createdAt: schema.documents.createdAt,
        updatedAt: schema.documents.updatedAt,
        createdBy: schema.documents.createdBy,
        lastEditedBy: schema.documents.lastEditedBy,
        parentId: schema.documents.parentId,
        sortKey: schema.documents.sortKey,
      })
      .from(schema.documents)
      .where(ownershipFilter)
      .orderBy(desc(schema.documents.updatedAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.documents)
      .where(ownershipFilter);

    return c.json({ documents: allDocs, total, limit, offset });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return c.json({ error: 'Failed to fetch documents' }, 500);
  }
});

/** The Thomistic taxonomy used for classification. GET /api/documents/categories
 *  (Registered before /:id so the literal path isn't captured as an id.) */
documents.get('/categories', (c) =>
  c.json({
    categories: THOMISTIC_TAXONOMY.map((l) => ({
      category: l.category,
      division: l.division ?? null,
      hint: l.hint,
    })),
  }),
);

/**
 * Get a specific document by ID
 * GET /api/documents/:id
 */
documents.get('/:id', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const documentId = c.req.param('id');
  const userId = c.get('userId');

  try {
    const doc = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .get();

    if (!doc) {
      return c.json({ error: 'Document not found' }, 404);
    }

    // Ownership check (allow legacy docs without userId)
    if (doc.userId && doc.userId !== userId) {
      return c.json({ error: 'Document not found' }, 404);
    }

    // ETag based on document updatedAt timestamp
    const etag = `"${doc.id}-${doc.updatedAt.getTime()}"`;
    const ifNoneMatch = c.req.header('If-None-Match');

    if (ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers: { 'ETag': etag } });
    }

    c.header('ETag', etag);
    c.header('Cache-Control', 'private, no-cache');

    return c.json({ document: doc });
  } catch (error) {
    console.error('Error fetching document:', error);
    return c.json({ error: 'Failed to fetch document' }, 500);
  }
});

/**
 * Create a new document
 * POST /api/documents
 */
documents.post('/', zValidator('json', createDocumentSchema), async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const data = c.req.valid('json');
  const userId = c.get('userId');

  try {
    const documentId = crypto.randomUUID();
    const now = new Date();

    const newDoc: schema.NewDocument = {
      id: documentId,
      title: data.title,
      content: '', // Empty Y.js state initially
      markdown: data.markdown || '',
      createdAt: now,
      updatedAt: now,
      createdBy: 'user',
      lastEditedBy: 'user',
      userId: c.get('userId'),
      feedQueuedAt: now, // queue for a learning-feed post (see list_notes_needing_feed)
    };

    await db.insert(schema.documents).values(newDoc);

    // Derive tags/links from the markdown, and heal any links that pointed to this title.
    await reparseDocument(db, documentId, newDoc.markdown ?? '', userId);
    await rebindLinksToTitle(db, documentId, newDoc.title);

    return c.json({ document: newDoc }, 201);
  } catch (error) {
    console.error('Error creating document:', error);
    return c.json({ error: 'Failed to create document' }, 500);
  }
});

/**
 * Update a document
 * PATCH /api/documents/:id
 */
documents.patch('/:id', zValidator('json', updateDocumentSchema), async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const documentId = c.req.param('id');
  const data = c.req.valid('json');
  const userId = c.get('userId');

  try {
    // Check if document exists
    const existing = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .get();

    if (!existing) {
      return c.json({ error: 'Document not found' }, 404);
    }

    // Ownership check
    if (existing.userId && existing.userId !== userId) {
      return c.json({ error: 'Document not found' }, 404);
    }

    // Update document
    const updates: Partial<schema.Document> = {
      updatedAt: new Date(),
      lastEditedBy: 'user',
    };

    if (data.title) updates.title = data.title;
    if (data.content !== undefined) updates.content = data.content;
    if (data.markdown !== undefined) updates.markdown = data.markdown;

    // Re-queue for a feed post when the readable content changes (title/markdown),
    // not on content-only (CRDT state) syncs. Re-queuing is idempotent.
    if (data.title || data.markdown !== undefined) {
      updates.feedQueuedAt = new Date();
    }

    await db
      .update(schema.documents)
      .set(updates)
      .where(eq(schema.documents.id, documentId));

    // Fetch updated document
    const updated = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .get();

    // Re-derive tags/links from the new markdown; heal links if the title changed.
    if (updated) {
      await reparseDocument(db, documentId, updated.markdown, userId);
      if (data.title) await rebindLinksToTitle(db, documentId, data.title);
    }

    return c.json({ document: updated });
  } catch (error) {
    console.error('Error updating document:', error);
    return c.json({ error: 'Failed to update document' }, 500);
  }
});

/**
 * Delete a document
 * DELETE /api/documents/:id
 */
documents.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const documentId = c.req.param('id');
  const userId = c.get('userId');

  try {
    // Check if document exists
    const existing = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .get();

    if (!existing) {
      return c.json({ error: 'Document not found' }, 404);
    }

    // Ownership check
    if (existing.userId && existing.userId !== userId) {
      return c.json({ error: 'Document not found' }, 404);
    }

    // Delete document (versions cascade automatically)
    await db
      .delete(schema.documents)
      .where(eq(schema.documents.id, documentId));

    return c.json({ success: true, message: 'Document deleted' });
  } catch (error) {
    console.error('Error deleting document:', error);
    return c.json({ error: 'Failed to delete document' }, 500);
  }
});

/**
 * Get version history for a document
 * GET /api/documents/:id/versions
 */
documents.get('/:id/versions', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const documentId = c.req.param('id');
  const userId = c.get('userId');
  const { limit, offset } = parsePagination(c);

  try {
    // Verify document ownership
    const doc = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId)).get();
    if (!doc) {
      return c.json({ error: 'Document not found' }, 404);
    }
    if (doc.userId && doc.userId !== userId) {
      return c.json({ error: 'Document not found' }, 404);
    }

    const versions = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId))
      .orderBy(desc(schema.documentVersions.version))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));

    return c.json({ versions, total, limit, offset });
  } catch (error) {
    console.error('Error fetching versions:', error);
    return c.json({ error: 'Failed to fetch versions' }, 500);
  }
});

/**
 * Create a version snapshot
 * POST /api/documents/:id/versions
 */
documents.post('/:id/versions', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const documentId = c.req.param('id');
  const userId = c.get('userId');

  try {
    // Get current document
    const doc = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .get();

    if (!doc) {
      return c.json({ error: 'Document not found' }, 404);
    }

    // Ownership check
    if (doc.userId && doc.userId !== userId) {
      return c.json({ error: 'Document not found' }, 404);
    }

    // Get latest version number
    const latestVersion = await db
      .select({ version: schema.documentVersions.version })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId))
      .orderBy(desc(schema.documentVersions.version))
      .get();

    const newVersionNumber = (latestVersion?.version ?? 0) + 1;

    // Create version snapshot
    const newVersion: schema.NewDocumentVersion = {
      id: crypto.randomUUID(),
      documentId,
      version: newVersionNumber,
      content: doc.content,
      markdown: doc.markdown,
      createdAt: new Date(),
      createdBy: 'user',
    };

    await db.insert(schema.documentVersions).values(newVersion);

    return c.json({ version: newVersion }, 201);
  } catch (error) {
    console.error('Error creating version:', error);
    return c.json({ error: 'Failed to create version' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────
// Organization: hierarchy (move), Zettelkasten links, per-doc tags
// ─────────────────────────────────────────────────────────────

/** Move/reorder a document in the folder tree. POST /api/documents/:id/move */
documents.post('/:id/move', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const userId = c.get('userId');
  const documentId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  try {
    const doc = await moveDocument(db, {
      documentId,
      parentId: body.parentId ?? null,
      sortKey: body.sortKey ?? null,
      userId,
    });
    return c.json({ document: doc });
  } catch (e) {
    if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
    if (e instanceof Error && /cycle/i.test(e.message)) return c.json({ error: e.message }, 400);
    console.error('move error', e);
    return c.json({ error: 'Failed to move document' }, 500);
  }
});

/**
 * File a previously-created document under a Thomistic category.
 * The caller (Claude over MCP, or a manual picker) supplies the category;
 * the server creates the category folder if needed and sets the parent.
 * POST /api/documents/:id/classify { category }
 */
documents.post('/:id/classify', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const userId = c.get('userId');
  const documentId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const category = typeof body.category === 'string' ? body.category : '';
  if (!category) {
    return c.json({ error: 'category is required', categories: TAXONOMY_CATEGORIES }, 400);
  }
  const result = await fileDocumentInCategory(db, documentId, category, userId);
  if (!result) {
    return c.json({ error: 'Document not found or unknown category', categories: TAXONOMY_CATEGORIES }, 400);
  }
  return c.json({ filed: result });
});

/** Backlinks — notes that link TO this one. GET /api/documents/:id/backlinks */
documents.get('/:id/backlinks', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const userId = c.get('userId');
  const rows = await getBacklinks(db, c.req.param('id'), userId);
  return c.json({ backlinks: rows });
});

/** Outgoing links from this note. GET /api/documents/:id/links */
documents.get('/:id/links', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await getOutgoingLinks(db, c.req.param('id'));
  return c.json({ links: rows });
});

/** Add a manual link. POST /api/documents/:id/links { targetId } */
documents.post('/:id/links', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  if (!body.targetId) return c.json({ error: 'targetId required' }, 400);
  try {
    const link = await addManualLink(db, c.req.param('id'), body.targetId, userId);
    return c.json({ link }, 201);
  } catch (e) {
    if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
    return c.json({ error: 'Failed to add link' }, 500);
  }
});

/** Remove a link. DELETE /api/documents/:id/links/:linkId */
documents.delete('/:id/links/:linkId', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const userId = c.get('userId');
  try {
    await removeLink(db, c.req.param('linkId'), userId);
    return c.json({ success: true });
  } catch (e) {
    if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
    return c.json({ error: 'Failed to remove link' }, 500);
  }
});

/** Tags on a document. GET /api/documents/:id/tags */
documents.get('/:id/tags', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await db
    .select({ tag: schema.noteTags.tag })
    .from(schema.noteTags)
    .where(eq(schema.noteTags.documentId, c.req.param('id')))
    .orderBy(schema.noteTags.tag);
  return c.json({ tags: rows.map((r) => r.tag) });
});

/** Add a tag. POST /api/documents/:id/tags { tag } */
documents.post('/:id/tags', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({}));
  if (!body.tag) return c.json({ error: 'tag required' }, 400);
  await addTag(db, c.req.param('id'), body.tag, userId);
  return c.json({ success: true }, 201);
});

/** Remove a tag. DELETE /api/documents/:id/tags/:tag */
documents.delete('/:id/tags/:tag', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const userId = c.get('userId');
  await removeTag(db, c.req.param('id'), c.req.param('tag'), userId);
  return c.json({ success: true });
});

export default documents;
