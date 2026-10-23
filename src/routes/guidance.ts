import { Hono } from 'hono';
import type { Env } from '../types';
import { triggerQuotaReport } from '../lib/quota';
import { copyDocument } from '../lib/guidanceCopy';
import { getDocumentPermission } from '../lib/documentShares';
import { resolveScope } from '../lib/orgs';
import {
  GUIDANCE_MAX_LENGTH,
  LockedGuidanceError,
  authorGuidanceFor,
  isTemplate,
  setTemplate,
  cleanGuidanceText,
  defaultGuidance,
  effectiveGuidance,
  getGuidanceLayer,
  parseGuidanceMode,
  setAdoption,
  setAuthorGuidance,
  setGuidanceLayer,
  validateAuthorText,
} from '../lib/writingGuidance';

/**
 * The writer's own layers on Scribe's default writing guidance, for the mobile apps (the web page in index.ts uses the
 * same lib). Layers belong to the signed-in user and are only ever shown to them.
 *
 *   GET/PUT /api/guidance                    all of the user's notes
 *   GET/PUT /api/guidance/documents/:id      one note
 *   GET     /api/guidance/effective?documentId=   what the assistant will be told
 */
const guidance = new Hono<{ Bindings: Env }>();

async function canReadDocument(c: { env: Env }, userId: string, documentId: string): Promise<boolean> {
  const activeOrgId = await resolveScope(c.env, userId);
  return (await getDocumentPermission(c.env, documentId, userId, activeOrgId)).canRead;
}

async function save(env: Env, userId: string, documentId: string, body: any): Promise<{ error: string } | { ok: true }> {
  const text = cleanGuidanceText(body?.text ?? '');
  if (text === null) return { error: `text must be a string of at most ${GUIDANCE_MAX_LENGTH} characters` };
  const mode = parseGuidanceMode(body?.mode ?? 'append');
  if (!mode) return { error: "mode must be 'append' or 'replace'" };
  await setGuidanceLayer(env, userId, documentId, text, mode);
  return { ok: true };
}

guidance.get('/', async (c) => {
  const userId = c.get('userId');
  return c.json({
    defaultText: defaultGuidance(c.env),
    layer: await getGuidanceLayer(c.env, userId),
    maxLength: GUIDANCE_MAX_LENGTH,
  });
});

guidance.put('/', async (c) => {
  const result = await save(c.env, c.get('userId'), '', await c.req.json().catch(() => ({})));
  if ('error' in result) return c.json(result, 400);
  return c.json({ layer: await getGuidanceLayer(c.env, c.get('userId')) });
});

guidance.get('/documents/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await canReadDocument(c, userId, id))) return c.json({ error: 'Document not found' }, 404);
  return c.json({
    layer: await getGuidanceLayer(c.env, userId, id),
    author: await authorGuidanceFor(c.env, userId, id),
    isTemplate: await isTemplate(c.env, id),
    // Strictly the owner: unowned legacy notes belong to nobody, so nobody can publish instructions for readers on them.
    isOwner: (await c.env.DB.prepare('SELECT user_id AS userId FROM documents WHERE id = ?').bind(id).first<{ userId: string | null }>())?.userId === userId,
    maxLength: GUIDANCE_MAX_LENGTH,
  });
});

/**
 * PUT /api/guidance/documents/:id/author { text }
 * Instructions the document's owner attaches for everyone who reads it (a teacher's notes for a shared assignment).
 * Readers only get them after adopting them. Empty text removes them. Owner only, and never for unowned legacy notes.
 */
guidance.put('/documents/:id/author', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await canReadDocument(c, userId, id))) return c.json({ error: 'Document not found' }, 404);
  const owner = await c.env.DB.prepare('SELECT user_id AS userId FROM documents WHERE id = ?').bind(id).first<{ userId: string | null }>();
  if (!owner || owner.userId !== userId) return c.json({ error: "Only the note's owner can attach instructions for its readers" }, 403);

  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
  const checked = validateAuthorText(body.text);
  if ('error' in checked) return c.json(checked, 400);
  const name = (c.get('userName') || c.get('userEmail') || '').split('@')[0];
  try {
    await setAuthorGuidance(c.env, id, userId, name, checked.text);
  } catch (e) {
    if (e instanceof LockedGuidanceError) return c.json({ error: e.message, locked: true }, 403);
    throw e;
  }
  return c.json({ author: await authorGuidanceFor(c.env, userId, id) });
});

/**
 * POST /api/guidance/documents/:id/template { template: boolean }
 * The owner publishes (or withdraws) a note as a template.
 */
guidance.post('/documents/:id/template', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await canReadDocument(c, userId, id))) return c.json({ error: 'Document not found' }, 404);
  const owner = await c.env.DB.prepare('SELECT user_id AS userId FROM documents WHERE id = ?').bind(id).first<{ userId: string | null }>();
  if (!owner || owner.userId !== userId) return c.json({ error: "Only the note's owner can publish it as a template" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { template?: unknown };
  if (typeof body.template !== 'boolean') return c.json({ error: 'template must be true or false' }, 400);
  await setTemplate(c.env, id, body.template);
  return c.json({ isTemplate: body.template });
});

/**
 * POST /api/guidance/documents/:id/copy { mode: 'use' | 'fork', title?, acceptVersion? }
 *
 *  use   a working copy: the author's instructions come along locked. The caller must pass acceptVersion, the version of
 *        the instructions the person was shown, so nobody ends up following text they haven't read (409 returns it).
 *  fork  a new template of your own: instructions come along editable, credited as adapted from the original author.
 */
guidance.post('/documents/:id/copy', async (c) => {
  const userId = c.get('userId');
  const userEmail = c.get('userEmail');
  const body = (await c.req.json().catch(() => ({}))) as { mode?: unknown; title?: unknown; acceptVersion?: unknown };
  if (body.mode !== 'use' && body.mode !== 'fork') return c.json({ error: "mode must be 'use' or 'fork'" }, 400);

  const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
  const out = await copyDocument(
    c.env,
    { userId, email: userEmail, name: (c.get('userName') || userEmail || '').split('@')[0], activeOrgId },
    c.req.param('id'),
    body.mode,
    { title: typeof body.title === 'string' ? body.title : undefined, acceptVersion: body.acceptVersion === undefined ? undefined : Number(body.acceptVersion) }
  );
  if (!out.ok) return c.json({ error: out.error, author: out.review }, out.status);
  triggerQuotaReport(c, c.env, userId, userEmail);
  return c.json({ document: { id: out.documentId, title: out.title }, author: await authorGuidanceFor(c.env, userId, out.documentId), isTemplate: out.isTemplate }, 201);
});

/**
 * POST /api/guidance/documents/:id/adopt { adopt: boolean, version: number }
 * The reader's choice to have their assistant follow the author's instructions. The version must be the one they were shown.
 */
guidance.post('/documents/:id/adopt', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await canReadDocument(c, userId, id))) return c.json({ error: 'Document not found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { adopt?: unknown; version?: unknown };
  if (typeof body.adopt !== 'boolean') return c.json({ error: 'adopt must be true or false' }, 400);
  const result = await setAdoption(c.env, userId, id, body.adopt, Number(body.version));
  if (result === 'none') return c.json({ error: 'This note has no shared instructions' }, 404);
  if (result === 'stale') return c.json({ error: 'The instructions changed. Review the new version first' }, 409);
  return c.json({ author: await authorGuidanceFor(c.env, userId, id) });
});

guidance.put('/documents/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await canReadDocument(c, userId, id))) return c.json({ error: 'Document not found' }, 404);
  const result = await save(c.env, userId, id, await c.req.json().catch(() => ({})));
  if ('error' in result) return c.json(result, 400);
  return c.json({ layer: await getGuidanceLayer(c.env, userId, id) });
});

guidance.get('/effective', async (c) => {
  const userId = c.get('userId');
  const documentId = c.req.query('documentId') || null;
  if (documentId && !(await canReadDocument(c, userId, documentId))) return c.json({ error: 'Document not found' }, 404);
  return c.json(await effectiveGuidance(c.env, userId, documentId));
});

export { guidance };
