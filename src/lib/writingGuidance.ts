import type { Env } from '../types';
import { WRITER_GUIDANCE, lintGuidance, writingGuidanceEnabled } from '../mcp/writingGuidance';

export type GuidanceMode = 'append' | 'replace';
export interface GuidanceLayer {
  text: string;
  mode: GuidanceMode;
}

export const GUIDANCE_MAX_LENGTH = 2000;

/** Normalizes user input: trims, drops control characters (keeping newlines and tabs), caps length. null = invalid. */
export function cleanGuidanceText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return text.length <= GUIDANCE_MAX_LENGTH ? text : null;
}

export function parseGuidanceMode(raw: unknown): GuidanceMode | null {
  return raw === 'append' || raw === 'replace' ? raw : null;
}

/** The defaults, or null when the operator has switched Scribe's own coaching off (WRITING_GUIDANCE=off). */
export function defaultGuidance(env: Pick<Env, 'WRITING_GUIDANCE'>): string | null {
  return writingGuidanceEnabled(env.WRITING_GUIDANCE) ? WRITER_GUIDANCE : null;
}

export interface AuthorGuidance {
  text: string;
  authorName: string;
}

export interface EffectiveGuidance {
  text: string;
  /** Which layers shaped the text, outermost last. A 'replace' layer discards the ones before it. */
  layers: { scope: 'default' | 'user' | 'author' | 'document'; mode?: GuidanceMode }[];
}

/**
 * default  →  the writer's layer for all notes  →  the note author's instructions (only if the writer adopted them)
 * →  the writer's layer for this note.
 * The writer's own layers can append or replace. The author's layer can only append, and is labelled with who wrote it,
 * so it can add to the writer's setup but never override the writer or Scribe's defaults.
 */
export function resolveGuidance(
  base: string | null,
  user: GuidanceLayer | null,
  doc: GuidanceLayer | null,
  author: AuthorGuidance | null = null
): EffectiveGuidance {
  let text = base ?? '';
  let layers: EffectiveGuidance['layers'] = base ? [{ scope: 'default' }] : [];

  const join = (heading: string, body: string) => (text ? `${text}\n\n${heading}\n${body}` : body);

  const apply = (scope: 'user' | 'document', layer: GuidanceLayer | null, heading: string) => {
    if (!layer?.text) return;
    if (layer.mode === 'replace') {
      text = layer.text;
      layers = [{ scope, mode: 'replace' }];
    } else {
      text = join(heading, layer.text);
      layers = [...layers, { scope, mode: 'append' }];
    }
  };

  apply('user', user, "The writer's own additions for all their notes:");
  if (author?.text) {
    const who = author.authorName.trim() || "this note's author";
    text = join(`Instructions from ${who}, shared with this note. The writer chose to follow them:`, author.text);
    layers = [...layers, { scope: 'author', mode: 'append' }];
  }
  apply('document', doc, "The writer's additions for this note:");
  return { text, layers };
}

export async function getGuidanceLayer(env: Env, userId: string, documentId = ''): Promise<GuidanceLayer | null> {
  const row = await env.DB.prepare('SELECT text, mode FROM writing_guidance WHERE user_id = ? AND document_id = ?')
    .bind(userId, documentId)
    .first<{ text: string; mode: string }>();
  if (!row?.text) return null;
  return { text: row.text, mode: parseGuidanceMode(row.mode) ?? 'append' };
}

/** Empty text clears the layer. */
export async function setGuidanceLayer(env: Env, userId: string, documentId: string, text: string, mode: GuidanceMode): Promise<void> {
  if (!text) {
    await env.DB.prepare('DELETE FROM writing_guidance WHERE user_id = ? AND document_id = ?').bind(userId, documentId).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO writing_guidance (user_id, document_id, text, mode, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, document_id) DO UPDATE SET text = excluded.text, mode = excluded.mode, updated_at = excluded.updated_at`
  ).bind(userId, documentId, text, mode, Date.now()).run();
}

// ── Author guidance (a teacher's instructions attached to a shared document) ────────────────────────────────────

export interface AuthorGuidanceRow {
  text: string;
  authorName: string;
  authorUserId: string;
  version: number;
  updatedAt: number;
  locked: number;
  sourceDocumentId: string | null;
  sourceAuthorName: string | null;
}

/** The instructions attached to a document, regardless of who is asking. null if none. */
export async function getAuthorGuidance(env: Env, documentId: string): Promise<AuthorGuidanceRow | null> {
  const row = await env.DB.prepare(
    'SELECT text, author_name AS authorName, author_user_id AS authorUserId, version, updated_at AS updatedAt, locked, source_document_id AS sourceDocumentId, source_author_name AS sourceAuthorName FROM document_author_guidance WHERE document_id = ?'
  ).bind(documentId).first<AuthorGuidanceRow>();
  return row?.text ? row : null;
}

/** Validates author text: same cleaning as the writer's own, plus the transparency lint Scribe applies to its own guidance. */
export function validateAuthorText(raw: unknown): { text: string } | { error: string } {
  const text = cleanGuidanceText(raw ?? '');
  if (text === null) return { error: `text must be a string of at most ${GUIDANCE_MAX_LENGTH} characters` };
  const problems = lintGuidance(text);
  if (problems.length) {
    return { error: `Shared instructions must be transparent to the reader: this text ${problems.join('; ')}.` };
  }
  return { text };
}

export interface AuthorGuidanceOptions {
  /** Copied from a template: the text can't be edited in this copy. */
  locked?: boolean;
  sourceDocumentId?: string | null;
  sourceAuthorName?: string | null;
}

/** Empty text removes the instructions (and any adoptions with them). Returns the new version, or null if removed. Never edits locked text. */
export async function setAuthorGuidance(
  env: Env,
  documentId: string,
  authorUserId: string,
  authorName: string,
  text: string,
  opts: AuthorGuidanceOptions = {}
): Promise<number | null> {
  const existing = await getAuthorGuidance(env, documentId);
  if (existing?.locked) throw new LockedGuidanceError();
  if (!text) {
    await env.DB.prepare('DELETE FROM document_author_guidance WHERE document_id = ?').bind(documentId).run();
    await env.DB.prepare('DELETE FROM guidance_adoptions WHERE document_id = ?').bind(documentId).run();
    return null;
  }
  await env.DB.prepare(
    `INSERT INTO document_author_guidance (document_id, author_user_id, author_name, text, version, updated_at, locked, source_document_id, source_author_name)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(document_id) DO UPDATE SET text = excluded.text, author_name = excluded.author_name,
       author_user_id = excluded.author_user_id, version = version + 1, updated_at = excluded.updated_at,
       locked = excluded.locked, source_document_id = excluded.source_document_id, source_author_name = excluded.source_author_name`
  ).bind(
    documentId, authorUserId, authorName.slice(0, 80), text, Date.now(),
    opts.locked ? 1 : 0, opts.sourceDocumentId ?? null, opts.sourceAuthorName ?? null
  ).run();
  const row = await getAuthorGuidance(env, documentId);
  return row?.version ?? null;
}

export class LockedGuidanceError extends Error {
  constructor() {
    super('These instructions come from a template and are locked. Make your own version of the template to change them.');
  }
}

/** Adopting is per person, per document, for the version they saw. Passing the version prevents adopting text they haven't read. */
export async function setAdoption(env: Env, userId: string, documentId: string, adopt: boolean, version: number): Promise<'ok' | 'stale' | 'none'> {
  const current = await getAuthorGuidance(env, documentId);
  if (!current) return 'none';
  if (!adopt) {
    await env.DB.prepare('DELETE FROM guidance_adoptions WHERE user_id = ? AND document_id = ?').bind(userId, documentId).run();
    return 'ok';
  }
  if (current.version !== version) return 'stale';
  await env.DB.prepare(
    `INSERT INTO guidance_adoptions (user_id, document_id, version, accepted_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, document_id) DO UPDATE SET version = excluded.version, accepted_at = excluded.accepted_at`
  ).bind(userId, documentId, version, Date.now()).run();
  return 'ok';
}

export async function isAdopted(env: Env, userId: string, documentId: string, version: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT version FROM guidance_adoptions WHERE user_id = ? AND document_id = ?')
    .bind(userId, documentId).first<{ version: number }>();
  return row?.version === version;
}

/** What the reader sees about a document's author instructions: the text, who wrote it, and whether it is in effect for them. */
export async function authorGuidanceFor(env: Env, userId: string, documentId: string) {
  const row = await getAuthorGuidance(env, documentId);
  if (!row) return null;
  const isAuthor = !!userId && row.authorUserId === userId;
  return {
    text: row.text,
    authorName: row.authorName,
    version: row.version,
    locked: !!row.locked,
    sourceAuthorName: row.sourceAuthorName,
    isAuthor,
    adopted: isAuthor || (userId ? await isAdopted(env, userId, documentId, row.version) : false),
  };
}

export type AuthorGuidanceView = NonNullable<Awaited<ReturnType<typeof authorGuidanceFor>>>;

export async function effectiveGuidance(env: Env, userId: string, documentId?: string | null): Promise<EffectiveGuidance> {
  const user = userId ? await getGuidanceLayer(env, userId) : null;
  const doc = userId && documentId ? await getGuidanceLayer(env, userId, documentId) : null;
  const author = userId && documentId ? await authorGuidanceFor(env, userId, documentId) : null;
  const inEffect = author?.adopted ? { text: author.text, authorName: author.authorName } : null;
  return resolveGuidance(defaultGuidance(env), user, doc, inEffect);
}

// ── Templates ──────────────────────────────────────────────────────────────────────────────────────────────────

export async function isTemplate(env: Env, documentId: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM document_templates WHERE document_id = ?').bind(documentId).first());
}

export async function setTemplate(env: Env, documentId: string, template: boolean): Promise<void> {
  if (template) {
    await env.DB.prepare('INSERT OR IGNORE INTO document_templates (document_id, created_at) VALUES (?, ?)').bind(documentId, Date.now()).run();
  } else {
    await env.DB.prepare('DELETE FROM document_templates WHERE document_id = ?').bind(documentId).run();
  }
}

export type CopyMode = 'use' | 'fork';

/**
 * What copying a document does with its guidance:
 *  - 'use'  (a working copy of a template): the author's instructions come along LOCKED, credited to the original author,
 *           and are adopted for the copier, who agreed to them by asking for the copy having seen the text.
 *  - 'fork' (a new template of your own): the instructions come along EDITABLE, credited to the copier as author with the
 *           original author recorded as the source, and the copy is itself a template.
 * Instructions the copier had no way to read are never copied: the caller checks read permission first.
 */
export async function copyGuidanceToNewDocument(
  env: Env,
  mode: CopyMode,
  source: { id: string; guidance: AuthorGuidanceRow | null },
  newDocumentId: string,
  copier: { userId: string; name: string }
): Promise<void> {
  const g = source.guidance;
  if (mode === 'fork') await setTemplate(env, newDocumentId, true);
  if (!g) return;
  if (mode === 'use') {
    const version = await setAuthorGuidance(env, newDocumentId, g.authorUserId, g.authorName, g.text, {
      locked: true,
      sourceDocumentId: source.id,
      sourceAuthorName: g.authorName,
    });
    if (version) await setAdoption(env, copier.userId, newDocumentId, true, version);
  } else {
    await setAuthorGuidance(env, newDocumentId, copier.userId, copier.name, g.text, {
      locked: false,
      sourceDocumentId: source.id,
      sourceAuthorName: g.sourceAuthorName || g.authorName,
    });
  }
}
