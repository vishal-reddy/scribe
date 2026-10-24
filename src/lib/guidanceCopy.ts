import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Env } from '../types';
import { getDocumentPermission } from './documentShares';
import { checkScribeQuota } from './quota';
import { reparseDocument, rebindLinksToTitle } from '../services/notes';
import {
  authorGuidanceFor,
  copyGuidanceToNewDocument,
  getAuthorGuidance,
  isTemplate,
  type CopyMode,
} from './writingGuidance';

export type CopyOutcome =
  | { ok: true; documentId: string; title: string; isTemplate: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string; review?: Awaited<ReturnType<typeof authorGuidanceFor>> };

/**
 * Copies a document the user can read.
 *  use   a working copy: the author's instructions come along locked. acceptVersion must be the version the person was
 *        shown, so nobody ends up following text they haven't read (the 409 carries it for review).
 *  fork  a new template of your own (only from a template): instructions come along editable, credited as adapted.
 */
export async function copyDocument(
  env: Env,
  who: { userId: string; email: string; name: string; activeOrgId: string },
  sourceId: string,
  mode: CopyMode,
  opts: { title?: string; acceptVersion?: number } = {}
): Promise<CopyOutcome> {
  if (!(await getDocumentPermission(env, sourceId, who.userId, who.activeOrgId)).canRead) {
    return { ok: false, status: 404, error: 'Document not found' };
  }
  const db = drizzle(env.DB, { schema });
  const source = await db.select().from(schema.documents).where(eq(schema.documents.id, sourceId)).get();
  if (!source) return { ok: false, status: 404, error: 'Document not found' };

  if (mode === 'fork' && !(await isTemplate(env, sourceId))) {
    return { ok: false, status: 400, error: 'Only a template can be forked. Make a plain copy instead.' };
  }

  const guidance = await getAuthorGuidance(env, sourceId);
  if (mode === 'use' && guidance && guidance.authorUserId !== who.userId && opts.acceptVersion !== guidance.version) {
    return {
      ok: false,
      status: 409,
      error: 'Review the instructions that come with this template first',
      review: await authorGuidanceFor(env, who.userId, sourceId),
    };
  }

  const title = (opts.title?.trim() || `Copy of ${source.title}`).slice(0, 200);
  const quota = await checkScribeQuota(env, who.userId, title.length + (source.markdown?.length || 0), who.email);
  if (!quota.allowed) return { ok: false, status: 403, error: quota.message || 'Storage quota reached' };

  const documentId = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.documents).values({
    id: documentId,
    title,
    content: '',
    markdown: source.markdown || '',
    createdAt: now,
    updatedAt: now,
    createdBy: 'user',
    lastEditedBy: 'user',
    userId: who.userId,
    orgId: who.activeOrgId,
    feedQueuedAt: now,
  });
  await reparseDocument(db, documentId, source.markdown ?? '', who.userId);
  await rebindLinksToTitle(db, documentId, title);
  await copyGuidanceToNewDocument(env, mode, { id: sourceId, guidance }, documentId, { userId: who.userId, name: who.name });
  return { ok: true, documentId, title, isTemplate: mode === 'fork' };
}
