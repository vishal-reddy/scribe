import { Hono } from 'hono';
import type { Env } from '../types';
import { getDocumentPermission } from '../lib/documentShares';
import { resolveScope } from '../lib/orgs';

const sync = new Hono<{ Bindings: Env }>();

/**
 * WebSocket endpoint for document synchronization
 * GET /api/sync/:documentId/ws
 *
 * The socket both reads and writes the document, so it needs the same permission as editing it. Without this check any
 * signed-in user who knew a document id (including someone it was only shared with as a viewer) could take it over.
 */
sync.get('/:documentId/ws', async (c) => {
  const documentId = c.req.param('documentId');
  const userId = c.get('userId');

  const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
  const permission = await getDocumentPermission(c.env, documentId, userId, activeOrgId);
  // 404 rather than 403 so ids cannot be probed.
  if (!permission.canWrite) return c.json({ error: 'Document not found' }, 404);

  // Get Durable Object stub
  const id = c.env.DOCUMENT_SYNC.idFromName(documentId);
  const stub = c.env.DOCUMENT_SYNC.get(id);

  // Forward request to Durable Object
  return stub.fetch(c.req.raw);
});

export default sync;
