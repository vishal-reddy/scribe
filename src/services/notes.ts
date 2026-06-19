import { drizzle } from 'drizzle-orm/d1';
import { and, asc, count, desc, eq, or, sql } from 'drizzle-orm';
import type { D1Database } from '@cloudflare/workers-types';
import * as schema from '../db/schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function getDb(d1: D1Database): Db {
  return drizzle(d1, { schema });
}

// Lets unauthenticated callers (MCP per-resource auth, legacy docs) match too.
function ownership(userId: string | undefined) {
  if (!userId) return undefined;
  return or(
    eq(schema.documents.userId, userId),
    sql`${schema.documents.userId} IS NULL`,
  );
}

export async function getDocument(db: Db, id: string, userId?: string) {
  const doc = await db.select().from(schema.documents).where(eq(schema.documents.id, id)).get();
  if (!doc) return null;
  if (userId && doc.userId && doc.userId !== userId) return null;
  return doc;
}

// ── Hierarchy ──────────────────────────────────────────────────────────────

export interface MoveDocumentInput {
  documentId: string;
  parentId: string | null;
  sortKey?: string | null;
  userId?: string;
}

// Reject cycles by walking up from the proposed parent.
async function wouldCreateCycle(db: Db, documentId: string, parentId: string): Promise<boolean> {
  if (documentId === parentId) return true;
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === documentId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const row = await db
      .select({ parentId: schema.documents.parentId })
      .from(schema.documents)
      .where(eq(schema.documents.id, cursor))
      .get();
    cursor = row?.parentId ?? null;
  }
  return false;
}

export async function moveDocument(db: Db, input: MoveDocumentInput): Promise<schema.Document> {
  const doc = await getDocument(db, input.documentId, input.userId);
  if (!doc) throw new NotFoundError('Document not found');

  if (input.parentId) {
    const parent = await getDocument(db, input.parentId, input.userId);
    if (!parent) throw new NotFoundError('Parent not found');
    if (await wouldCreateCycle(db, input.documentId, input.parentId)) {
      throw new ValidationError('Move would create a cycle');
    }
  }

  await db
    .update(schema.documents)
    .set({
      parentId: input.parentId,
      sortKey: input.sortKey ?? doc.sortKey,
      updatedAt: new Date(),
    })
    .where(eq(schema.documents.id, input.documentId));

  const updated = await getDocument(db, input.documentId, input.userId);
  if (!updated) throw new NotFoundError('Document vanished after move');
  return updated;
}

export async function listChildren(db: Db, parentId: string | null, userId?: string) {
  const own = ownership(userId);
  const parentFilter = parentId === null
    ? sql`${schema.documents.parentId} IS NULL`
    : eq(schema.documents.parentId, parentId);
  const where = own ? and(parentFilter, own) : parentFilter;

  return db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      parentId: schema.documents.parentId,
      sortKey: schema.documents.sortKey,
      updatedAt: schema.documents.updatedAt,
    })
    .from(schema.documents)
    .where(where)
    .orderBy(asc(schema.documents.sortKey), asc(schema.documents.title));
}

// ── Parsing ────────────────────────────────────────────────────────────────

// Matches [[Some Title]] or [[some-id|Some Title]] forms.
const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;
// Matches #tag (alphanumerics, dashes, underscores, slashes for hierarchical tags).
// Skips matches preceded by a word char so URLs/emails don't trigger.
const TAG_RE = /(^|[^\w])#([a-zA-Z][\w/-]*)/g;

export function extractWikilinks(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(WIKILINK_RE)) {
    const inner = m[1].trim();
    // [[id|label]] — link target is the id part.
    const target = inner.includes('|') ? inner.split('|', 1)[0].trim() : inner;
    if (target) out.add(target);
  }
  return [...out];
}

export function extractTags(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(TAG_RE)) {
    out.add(m[2].toLowerCase());
  }
  return [...out];
}

// Resolve link target text to a doc id by checking id-equality then title match (case-insensitive).
async function resolveLinkTarget(db: Db, text: string, userId?: string): Promise<string | null> {
  const byId = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.id, text))
    .get();
  if (byId) {
    if (userId) {
      const owned = await getDocument(db, byId.id, userId);
      return owned ? byId.id : null;
    }
    return byId.id;
  }
  const own = ownership(userId);
  const where = own
    ? and(sql`LOWER(${schema.documents.title}) = LOWER(${text})`, own)
    : sql`LOWER(${schema.documents.title}) = LOWER(${text})`;
  const byTitle = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(where)
    .get();
  return byTitle?.id ?? null;
}

// Replace all 'wiki'-kind links for a doc with freshly parsed ones. Manual links survive.
export async function syncLinksFromMarkdown(
  db: Db,
  documentId: string,
  markdown: string,
  userId?: string,
) {
  const targets = extractWikilinks(markdown);
  await db
    .delete(schema.noteLinks)
    .where(and(eq(schema.noteLinks.sourceId, documentId), eq(schema.noteLinks.kind, 'wiki')));

  if (targets.length === 0) return;
  const now = new Date();
  const rows: schema.NewNoteLink[] = [];
  for (const t of targets) {
    const targetId = await resolveLinkTarget(db, t, userId);
    rows.push({
      id: crypto.randomUUID(),
      sourceId: documentId,
      targetId,
      targetText: t,
      kind: 'wiki',
      createdAt: now,
    });
  }
  await db.insert(schema.noteLinks).values(rows);
}

// Additive: parsing markdown #hashtags inserts any new tags but never deletes existing ones,
// so explicit tags added via addTag persist regardless of markdown edits. Removal is explicit only.
export async function syncTagsFromMarkdown(db: Db, documentId: string, markdown: string) {
  const tags = extractTags(markdown);
  if (tags.length === 0) return;
  const now = new Date();
  await db
    .insert(schema.noteTags)
    .values(
      tags.map((tag) => ({
        id: crypto.randomUUID(),
        documentId,
        tag,
        createdAt: now,
      })),
    )
    .onConflictDoNothing();
}

// Convenience: re-derive links + tags from current markdown. Call after create/update.
export async function reparseDocument(
  db: Db,
  documentId: string,
  markdown: string,
  userId?: string,
) {
  await syncLinksFromMarkdown(db, documentId, markdown, userId);
  await syncTagsFromMarkdown(db, documentId, markdown);
}

// After any doc's title changes, previously-unresolved wikilinks pointing to its title should resolve.
export async function rebindLinksToTitle(db: Db, documentId: string, title: string) {
  await db
    .update(schema.noteLinks)
    .set({ targetId: documentId })
    .where(
      and(
        sql`LOWER(${schema.noteLinks.targetText}) = LOWER(${title})`,
        sql`${schema.noteLinks.targetId} IS NULL`,
      ),
    );
}

// ── Links ──────────────────────────────────────────────────────────────────

export async function getOutgoingLinks(db: Db, sourceId: string) {
  return db
    .select()
    .from(schema.noteLinks)
    .where(eq(schema.noteLinks.sourceId, sourceId))
    .orderBy(asc(schema.noteLinks.targetText));
}

export async function getBacklinks(db: Db, targetId: string, userId?: string) {
  const rows = await db
    .select({
      id: schema.noteLinks.id,
      sourceId: schema.noteLinks.sourceId,
      targetText: schema.noteLinks.targetText,
      kind: schema.noteLinks.kind,
      createdAt: schema.noteLinks.createdAt,
      sourceTitle: schema.documents.title,
      sourceUserId: schema.documents.userId,
    })
    .from(schema.noteLinks)
    .innerJoin(schema.documents, eq(schema.noteLinks.sourceId, schema.documents.id))
    .where(eq(schema.noteLinks.targetId, targetId))
    .orderBy(desc(schema.noteLinks.createdAt));

  if (!userId) return rows;
  return rows.filter((r) => !r.sourceUserId || r.sourceUserId === userId);
}

export async function addManualLink(
  db: Db,
  sourceId: string,
  targetId: string,
  userId?: string,
) {
  const source = await getDocument(db, sourceId, userId);
  if (!source) throw new NotFoundError('Source not found');
  const target = await getDocument(db, targetId, userId);
  if (!target) throw new NotFoundError('Target not found');

  const row: schema.NewNoteLink = {
    id: crypto.randomUUID(),
    sourceId,
    targetId,
    targetText: target.title,
    kind: 'manual',
    createdAt: new Date(),
  };
  await db.insert(schema.noteLinks).values(row);
  return row;
}

export async function removeLink(db: Db, linkId: string, userId?: string) {
  const link = await db
    .select({
      id: schema.noteLinks.id,
      sourceId: schema.noteLinks.sourceId,
      sourceUserId: schema.documents.userId,
    })
    .from(schema.noteLinks)
    .innerJoin(schema.documents, eq(schema.noteLinks.sourceId, schema.documents.id))
    .where(eq(schema.noteLinks.id, linkId))
    .get();
  if (!link) throw new NotFoundError('Link not found');
  if (userId && link.sourceUserId && link.sourceUserId !== userId) {
    throw new NotFoundError('Link not found');
  }
  await db.delete(schema.noteLinks).where(eq(schema.noteLinks.id, linkId));
}

// ── Tags ───────────────────────────────────────────────────────────────────

export async function listTags(db: Db, userId?: string) {
  const own = ownership(userId);
  const rows = await db
    .select({
      tag: schema.noteTags.tag,
      n: count(),
    })
    .from(schema.noteTags)
    .innerJoin(schema.documents, eq(schema.noteTags.documentId, schema.documents.id))
    .where(own ?? sql`1=1`)
    .groupBy(schema.noteTags.tag)
    .orderBy(desc(count()), asc(schema.noteTags.tag));
  return rows;
}

export async function searchByTag(db: Db, tag: string, userId?: string) {
  const own = ownership(userId);
  const tagFilter = eq(schema.noteTags.tag, tag.toLowerCase());
  const where = own ? and(tagFilter, own) : tagFilter;
  return db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      updatedAt: schema.documents.updatedAt,
    })
    .from(schema.noteTags)
    .innerJoin(schema.documents, eq(schema.noteTags.documentId, schema.documents.id))
    .where(where)
    .orderBy(desc(schema.documents.updatedAt));
}

export async function addTag(db: Db, documentId: string, tag: string, userId?: string) {
  const doc = await getDocument(db, documentId, userId);
  if (!doc) throw new NotFoundError('Document not found');
  const normalized = tag.toLowerCase().trim();
  if (!normalized) throw new ValidationError('Tag cannot be empty');
  const existing = await db
    .select({ id: schema.noteTags.id })
    .from(schema.noteTags)
    .where(and(eq(schema.noteTags.documentId, documentId), eq(schema.noteTags.tag, normalized)))
    .get();
  if (existing) return existing;
  const row: schema.NewNoteTag = {
    id: crypto.randomUUID(),
    documentId,
    tag: normalized,
    createdAt: new Date(),
  };
  await db.insert(schema.noteTags).values(row);
  return row;
}

export async function removeTag(db: Db, documentId: string, tag: string, userId?: string) {
  const doc = await getDocument(db, documentId, userId);
  if (!doc) throw new NotFoundError('Document not found');
  await db
    .delete(schema.noteTags)
    .where(and(eq(schema.noteTags.documentId, documentId), eq(schema.noteTags.tag, tag.toLowerCase())));
}

// ── Errors ─────────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  readonly status = 404;
}

export class ValidationError extends Error {
  readonly status = 400;
}
