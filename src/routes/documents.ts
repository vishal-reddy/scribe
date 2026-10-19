import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, desc, like, or, sql, count, and, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { createDocumentSchema, updateDocumentSchema } from '../types';
import type { Env } from '../types';
import { resolveScope } from '../lib/orgs';
import {
  getDocumentPermission,
  shareDocument,
  removeDocumentShare,
  listDocumentShares,
} from '../lib/documentShares';
import {
  reparseDocument, rebindLinksToTitle, moveDocument, getBacklinks, getOutgoingLinks,
  addManualLink, removeLink, addTag, removeTag, NotFoundError,
} from '../services/notes';
import {
  THOMISTIC_TAXONOMY, TAXONOMY_CATEGORIES, fileDocumentInCategory,
} from '../services/classification';

const documents = new Hono<{ Bindings: Env }>();

async function getAccessibleDirectShares(env: Env, userId: string, userEmail: string): Promise<Map<string, string>> {
  const { results } = await env.DB.prepare(
    `SELECT document_id, role FROM document_shares WHERE user_id = ? OR (email = ? AND email != '')`
  ).bind(userId, userEmail).all<{ document_id: string; role: string }>();

  const map = new Map<string, string>();
  for (const s of results) {
    map.set(s.document_id, s.role);
  }
  return map;
}

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

  const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
  const userEmail = c.get('userEmail')?.toLowerCase().trim() || '';
  const shareMap = await getAccessibleDirectShares(c.env, userId, userEmail);
  const sharedDocIds = Array.from(shareMap.keys());

  const ownershipFilter = or(
    eq(schema.documents.userId, userId),
    eq(schema.documents.orgId, activeOrgId),
    sharedDocIds.length > 0 ? inArray(schema.documents.id, sharedDocIds) : undefined,
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
        userId: schema.documents.userId,
        orgId: schema.documents.orgId,
        isEphemeral: schema.documents.isEphemeral,
        expiresAt: schema.documents.expiresAt,
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

    const enriched = results.map((doc) => {
      const isOwner = doc.userId === userId || !doc.userId;
      const directRole = shareMap.get(doc.id);
      return {
        ...doc,
        isSharedWithMe: !isOwner && doc.orgId !== activeOrgId,
        accessLevel: isOwner ? 'owner' : (directRole || 'editor'),
      };
    });

    return c.json({ documents: enriched, total, limit, offset, query });
  } catch (error) {
    console.error('Error searching documents:', error);
    return c.json({ error: 'Failed to search documents' }, 500);
  }
});

/**
 * List all documents for the authenticated user / active org / direct shares
 * GET /api/documents
 */
documents.get('/', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const { limit, offset } = parsePagination(c);
  const userId = c.get('userId');

  const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
  const userEmail = c.get('userEmail')?.toLowerCase().trim() || '';
  const shareMap = await getAccessibleDirectShares(c.env, userId, userEmail);
  const sharedDocIds = Array.from(shareMap.keys());

  const ownershipFilter = or(
    eq(schema.documents.userId, userId),
    eq(schema.documents.orgId, activeOrgId),
    sharedDocIds.length > 0 ? inArray(schema.documents.id, sharedDocIds) : undefined,
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
        userId: schema.documents.userId,
        orgId: schema.documents.orgId,
        parentId: schema.documents.parentId,
        sortKey: schema.documents.sortKey,
        isEphemeral: schema.documents.isEphemeral,
        expiresAt: schema.documents.expiresAt,
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

    const enriched = allDocs.map((doc) => {
      const isOwner = doc.userId === userId || !doc.userId;
      const directRole = shareMap.get(doc.id);
      return {
        ...doc,
        isSharedWithMe: !isOwner && doc.orgId !== activeOrgId,
        accessLevel: isOwner ? 'owner' : (directRole || 'editor'),
      };
    });

    return c.json({ documents: enriched, total, limit, offset, activeOrgId });
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
    const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
    const perm = await getDocumentPermission(c.env, documentId, userId, activeOrgId);

    if (!perm.canRead) {
      return c.json({ error: 'Document not found' }, 404);
    }

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

    return c.json({ document: { ...doc, permission: perm } });
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
    const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
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
      userId: userId,
      orgId: activeOrgId,
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
    const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
    const perm = await getDocumentPermission(c.env, documentId, userId, activeOrgId);

    if (!perm.canRead) {
      return c.json({ error: 'Document not found' }, 404);
    }
    if (!perm.canWrite) {
      return c.json({ error: 'Forbidden: read-only access' }, 403);
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
    const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
    const perm = await getDocumentPermission(c.env, documentId, userId, activeOrgId);

    if (!perm.canRead) {
      return c.json({ error: 'Document not found' }, 404);
    }
    if (!perm.isOwner && perm.role !== 'admin') {
      return c.json({ error: 'Forbidden: only owner or workspace admin can delete this document' }, 403);
    }

    // Delete document (cascade documentShares, noteLinks, noteTags, documentVersions, documents)
    await db.delete(schema.documentShares).where(eq(schema.documentShares.documentId, documentId));
    await db.delete(schema.noteLinks).where(or(eq(schema.noteLinks.sourceId, documentId), eq(schema.noteLinks.targetId, documentId)));
    await db.delete(schema.noteTags).where(eq(schema.noteTags.documentId, documentId));
    await db.delete(schema.documentVersions).where(eq(schema.documentVersions.documentId, documentId));
    await db.delete(schema.documents).where(eq(schema.documents.id, documentId));

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
    const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
    const perm = await getDocumentPermission(c.env, documentId, userId, activeOrgId);
    if (!perm.canRead) {
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
    const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
    const perm = await getDocumentPermission(c.env, documentId, userId, activeOrgId);
    if (!perm.canRead) {
      return c.json({ error: 'Document not found' }, 404);
    }
    if (!perm.canWrite) {
      return c.json({ error: 'Forbidden: read-only access' }, 403);
    }

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
 * Convert an ephemeral note to a permanent one — clears isEphemeral/expiresAt
 * so it survives the daily expiry sweep.
 * POST /api/documents/:id/persist
 */
documents.post('/:id/persist', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const documentId = c.req.param('id');
  const userId = c.get('userId');

  try {
    const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
    const perm = await getDocumentPermission(c.env, documentId, userId, activeOrgId);

    if (!perm.canRead) {
      return c.json({ error: 'Document not found' }, 404);
    }
    if (!perm.canWrite) {
      return c.json({ error: 'Forbidden: read-only access' }, 403);
    }

    await db
      .update(schema.documents)
      .set({ isEphemeral: false, expiresAt: null, updatedAt: new Date() })
      .where(eq(schema.documents.id, documentId));

    const doc = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .get();

    return c.json({ document: doc });
  } catch (error) {
    console.error('Error persisting document:', error);
    return c.json({ error: 'Failed to persist document' }, 500);
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
  const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
  const perm = await getDocumentPermission(c.env, documentId, userId, activeOrgId);
  if (!perm.canRead) {
    return c.json({ error: 'Document not found or unknown category', categories: TAXONOMY_CATEGORIES }, 400);
  }
  if (!perm.canWrite) {
    return c.json({ error: 'Forbidden: read-only access' }, 403);
  }
  const result = await fileDocumentInCategory(db, documentId, category, userId);
  if (!result) {
    return c.json({ error: 'Document not found or unknown category', categories: TAXONOMY_CATEGORIES }, 400);
  }
  return c.json({ filed: result });
});

// ─────────────────────────────────────────────────────────────
// Document Shares
// ─────────────────────────────────────────────────────────────

const shareBodySchema = z.object({
  email: z.string().email(),
  role: z.enum(['viewer', 'editor']).default('editor'),
});

/**
 * List direct shares for a document
 * GET /api/documents/:id/shares
 */
documents.get('/:id/shares', async (c) => {
  const documentId = c.req.param('id');
  const userId = c.get('userId');

  try {
    const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
    const perm = await getDocumentPermission(c.env, documentId, userId, activeOrgId);
    if (!perm.canRead) {
      return c.json({ error: 'Document not found' }, 404);
    }

    const shares = await listDocumentShares(c.env, documentId, userId);
    return c.json({ shares, canManage: perm.isOwner || perm.role === 'admin' });
  } catch (error) {
    console.error('Error listing shares:', error);
    return c.json({ error: 'Failed to list shares' }, 500);
  }
});

/**
 * Share a document with a user by email
 * POST /api/documents/:id/shares
 */
documents.post('/:id/shares', zValidator('json', shareBodySchema), async (c) => {
  const documentId = c.req.param('id');
  const userId = c.get('userId');
  const { email, role } = c.req.valid('json');

  try {
    const result = await shareDocument(c.env, documentId, email, role, userId);
    return c.json(result, 201);
  } catch (error: any) {
    console.error('Error sharing document:', error);
    const msg = error?.message || 'Failed to share document';
    if (msg.includes('Forbidden')) {
      return c.json({ error: msg }, 403);
    }
    return c.json({ error: msg }, 400);
  }
});

/**
 * Remove a document share
 * DELETE /api/documents/:id/shares/:shareId
 */
documents.delete('/:id/shares/:shareId', async (c) => {
  const shareId = c.req.param('shareId');
  const userId = c.get('userId');

  try {
    const result = await removeDocumentShare(c.env, shareId, userId);
    return c.json(result);
  } catch (error: any) {
    console.error('Error removing share:', error);
    const msg = error?.message || 'Failed to remove share';
    if (msg.includes('Forbidden')) {
      return c.json({ error: msg }, 403);
    }
    return c.json({ error: msg }, 400);
  }
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
