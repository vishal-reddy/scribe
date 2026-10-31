import type { Env } from '../types';
import { getDocumentPermission } from './documentShares';

/**
 * Who can open a published /d/:id link.
 *  - public: anyone with the link
 *  - org:    signed-in people who can already read the document through its organization (needs an org document)
 *  - shared: signed-in people who can already read the document (owner, organization, or a direct share) — any document
 */
export type LinkVisibility = 'public' | 'org' | 'shared';

/** Omitted means public (what the apps' plain "publish" sends). Anything else must be a known value: never fail open. */
export function parseVisibility(raw: unknown): LinkVisibility {
  if (raw === undefined || raw === null) return 'public';
  if (raw === 'public' || raw === 'org' || raw === 'shared') return raw;
  throw new PublishError("visibility must be 'public', 'org' or 'shared'", 400);
}

/** Links that make the viewer sign in and then check their normal read access. */
export function requiresSignIn(visibility: string): boolean {
  return visibility === 'org' || visibility === 'shared';
}

export class PublishError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404) {
    super(message);
  }
}

async function requireOwner(env: Env, documentId: string, userId: string, activeOrgId: string | null) {
  const perm = await getDocumentPermission(env, documentId, userId, activeOrgId);
  if (!perm.canRead) throw new PublishError('Document not found', 404);
  if (!(perm.isOwner || perm.role === 'admin')) throw new PublishError('Forbidden: only the owner can publish', 403);
}

export async function publishDocument(
  env: Env, documentId: string, userId: string, activeOrgId: string | null, visibility: LinkVisibility,
): Promise<{ published: true; visibility: LinkVisibility; url: string }> {
  await requireOwner(env, documentId, userId, activeOrgId);
  if (visibility === 'org') {
    const doc = await env.DB.prepare('SELECT org_id FROM documents WHERE id = ?').bind(documentId).first<{ org_id: string | null }>();
    if (!doc?.org_id) throw new PublishError('Organization-only links need a document in an organization workspace', 400);
  }
  await env.DB.prepare(
    `INSERT INTO published_documents (document_id, published_by, published_at, visibility) VALUES (?, ?, ?, ?)
     ON CONFLICT(document_id) DO UPDATE SET visibility = excluded.visibility`
  ).bind(documentId, userId, Math.floor(Date.now() / 1000), visibility).run();
  return { published: true, visibility, url: `/d/${documentId}` };
}

export async function unpublishDocument(env: Env, documentId: string, userId: string, activeOrgId: string | null) {
  await requireOwner(env, documentId, userId, activeOrgId);
  await env.DB.prepare('DELETE FROM published_documents WHERE document_id = ?').bind(documentId).run();
  return { published: false as const, url: null };
}
