import type { Env } from '../types';
import type { EffectivePhilosophy } from '../lib/philosophy';
import { personalOrgId } from '../lib/orgs';

/**
 * Filing under a custom philosophy: a document goes to a folder *path* the assistant chose ("Projects/Alpha"), not a leaf of
 * the fixed Thomistic taxonomy. Folders are ordinary documents marked createdBy 'system'. All moves in one call apply
 * together in a single D1 batch (one transaction): either every document is refiled or none is.
 */

export const MAX_PATH_DEPTH = 4;
export const MAX_SEGMENT_LENGTH = 80;
export const MAX_MOVES_PER_CALL = 200;

/** "A/B/C" -> ["A","B","C"]. Null when empty, too deep, or a segment is too long or has control characters. */
export function parseFolderPath(input: string): string[] | null {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(input)) return null;
  const parts = input.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_PATH_DEPTH) return null;
  if (parts.some((p) => p.length > MAX_SEGMENT_LENGTH)) return null;
  return parts;
}

/** What the assistant is told when a custom philosophy is in effect. */
export function philosophyGuidance(p: EffectivePhilosophy): string {
  const where = p.level === 'workspace' ? "this workspace's" : p.level === 'org' ? "this organization's" : 'your';
  return (
    `File documents according to ${where} organization philosophy (below), not the default Thomistic scheme. ` +
    `Choose a folder path for each document, up to ${MAX_PATH_DEPTH} levels separated by "/" (for example "Projects/Alpha"), ` +
    `reusing existing folders where they fit, then call file_document with that path.\n\nPhilosophy:\n${p.text}`
  );
}

interface Scope { where: string; binds: unknown[] }

/** The documents that belong to a workspace. A personal workspace also owns the user's older documents that have no workspace. */
async function scopeFor(env: Env, userId: string, workspaceId: string): Promise<Scope> {
  const ws = await env.DB.prepare('SELECT is_personal AS isPersonal FROM organizations WHERE id = ?').bind(workspaceId).first<{ isPersonal: number }>();
  const personal = ws?.isPersonal === 1 || workspaceId === personalOrgId(userId);
  return personal
    ? { where: '(org_id = ? OR (org_id IS NULL AND user_id = ?))', binds: [workspaceId, userId] }
    : { where: 'org_id = ?', binds: [workspaceId] };
}

interface FolderRow { id: string; title: string; parent_id: string | null }

async function folderIndex(env: Env, scope: Scope): Promise<{ byKey: Map<string, string>; byId: Map<string, FolderRow> }> {
  const { results } = await env.DB.prepare(
    `SELECT id, title, parent_id FROM documents WHERE created_by = 'system' AND ${scope.where}`
  ).bind(...scope.binds).all<FolderRow>();
  const byKey = new Map<string, string>();
  const byId = new Map<string, FolderRow>();
  for (const f of results ?? []) {
    byKey.set(`${f.parent_id ?? ''}\u0000${f.title.toLowerCase()}`, f.id);
    byId.set(f.id, f);
  }
  return { byKey, byId };
}

function pathOf(id: string | null, byId: Map<string, FolderRow>): string {
  const parts: string[] = [];
  let cur = id;
  for (let i = 0; cur && i < 10; i++) {
    const f = byId.get(cur);
    if (!f) break;
    parts.unshift(f.title);
    cur = f.parent_id;
  }
  return parts.join('/');
}

export interface ScopedDocument { id: string; title: string; snippet: string; folder: string }

/** The documents a restructure of this workspace would look at, with where each one sits now. Read only. */
export async function listScopeDocuments(env: Env, userId: string, workspaceId: string, limit = 100, offset = 0) {
  const scope = await scopeFor(env, userId, workspaceId);
  const idx = await folderIndex(env, scope);
  const { results } = await env.DB.prepare(
    `SELECT id, title, substr(markdown, 1, 160) AS snippet, parent_id FROM documents
      WHERE created_by != 'system' AND is_ephemeral = 0 AND ${scope.where}
      ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  ).bind(...scope.binds, limit, offset).all<{ id: string; title: string; snippet: string; parent_id: string | null }>();
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM documents WHERE created_by != 'system' AND is_ephemeral = 0 AND ${scope.where}`
  ).bind(...scope.binds).first<{ n: number }>();
  const docs: ScopedDocument[] = (results ?? []).map((d) => ({ id: d.id, title: d.title, snippet: d.snippet ?? '', folder: pathOf(d.parent_id, idx.byId) }));
  return { docs, total: total?.n ?? docs.length };
}

export interface Move { documentId: string; path: string }

export type MoveResult =
  | { ok: true; moved: number; unchanged: number; foldersCreated: number }
  | { ok: false; errors: string[] };

/**
 * Refile documents into folder paths in one transaction. Every move is checked first; if any is invalid nothing changes.
 * `requireOwned` limits the caller to their own documents (a member filing a note); an owner/admin restructuring a shared
 * workspace passes false.
 */
export async function moveDocuments(
  env: Env,
  actor: { userId: string },
  workspaceId: string,
  moves: Move[],
  opts: { requireOwned: boolean }
): Promise<MoveResult> {
  if (moves.length === 0) return { ok: false, errors: ['No moves given.'] };
  if (moves.length > MAX_MOVES_PER_CALL) return { ok: false, errors: [`At most ${MAX_MOVES_PER_CALL} moves per call; send the rest in another call.`] };

  const scope = await scopeFor(env, actor.userId, workspaceId);
  const idx = await folderIndex(env, scope);
  const errors: string[] = [];

  const ids = [...new Set(moves.map((m) => m.documentId))];
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, created_by, parent_id FROM documents WHERE id IN (${ids.map(() => '?').join(',')}) AND ${scope.where}`
  ).bind(...ids, ...scope.binds).all<{ id: string; user_id: string | null; created_by: string; parent_id: string | null }>();
  const docs = new Map((results ?? []).map((d) => [d.id, d]));

  const statements: D1PreparedStatement[] = [];
  const now = Math.floor(Date.now() / 1000);
  const newKeys = new Map<string, string>();
  let foldersCreated = 0;
  let moved = 0;
  let unchanged = 0;
  const seen = new Set<string>();

  for (const m of moves) {
    const doc = docs.get(m.documentId);
    if (!doc) { errors.push(`${m.documentId}: not found in this workspace.`); continue; }
    if (doc.created_by === 'system') { errors.push(`${m.documentId}: is a folder, not a document.`); continue; }
    if (opts.requireOwned && doc.user_id !== actor.userId) { errors.push(`${m.documentId}: you can only file your own documents.`); continue; }
    if (seen.has(m.documentId)) { errors.push(`${m.documentId}: listed twice.`); continue; }
    seen.add(m.documentId);
    const parts = parseFolderPath(m.path);
    if (!parts) { errors.push(`${m.documentId}: "${m.path}" is not a valid folder path (1-${MAX_PATH_DEPTH} levels, "/" separated, each at most ${MAX_SEGMENT_LENGTH} characters).`); continue; }

    let parent: string | null = null;
    for (const title of parts) {
      const key: string = `${parent ?? ''}\u0000${title.toLowerCase()}`;
      let id: string | undefined = idx.byKey.get(key) ?? newKeys.get(key);
      if (!id) {
        id = crypto.randomUUID();
        newKeys.set(key, id);
        foldersCreated++;
        statements.push(
          env.DB.prepare(
            `INSERT INTO documents (id, title, content, markdown, created_at, updated_at, created_by, last_edited_by, user_id, org_id, parent_id)
             VALUES (?, ?, '', '', ?, ?, 'system', 'system', ?, ?, ?)`
          ).bind(id, title, now, now, actor.userId, workspaceId, parent)
        );
      }
      parent = id;
    }
    if (doc.parent_id === parent) { unchanged++; continue; }
    moved++;
    statements.push(env.DB.prepare('UPDATE documents SET parent_id = ?, updated_at = ? WHERE id = ?').bind(parent, now, m.documentId));
  }

  if (errors.length) return { ok: false, errors };
  if (statements.length) await env.DB.batch(statements);
  return { ok: true, moved, unchanged, foldersCreated };
}
