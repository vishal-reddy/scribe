import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, desc, like, or, sql, count } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { createDocumentSchema, updateDocumentSchema } from '../types';
import type { Env } from '../types';

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

  if (!query) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  const { limit, offset } = parsePagination(c);
  const pattern = `%${query}%`;

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
        or(
          like(schema.documents.title, pattern),
          like(schema.documents.markdown, pattern),
        )
      )
      .orderBy(sql`relevance DESC`, desc(schema.documents.updatedAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.documents)
      .where(
        or(
          like(schema.documents.title, pattern),
          like(schema.documents.markdown, pattern),
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
      })
      .from(schema.documents)
      .orderBy(desc(schema.documents.updatedAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.documents);

    return c.json({ documents: allDocs, total, limit, offset });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return c.json({ error: 'Failed to fetch documents' }, 500);
  }
});

/**
 * Get a specific document by ID
 * GET /api/documents/:id
 */
documents.get('/:id', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const documentId = c.req.param('id');

  try {
    const doc = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .get();

    if (!doc) {
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
    };

    await db.insert(schema.documents).values(newDoc);

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

    // Update document
    const updates: Partial<schema.Document> = {
      updatedAt: new Date(),
      lastEditedBy: 'user',
    };

    if (data.title) updates.title = data.title;
    if (data.content !== undefined) updates.content = data.content;
    if (data.markdown !== undefined) updates.markdown = data.markdown;

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
  const { limit, offset } = parsePagination(c);

  try {
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

export default documents;
