import { Hono } from 'hono';
import type { Env } from '../types';

const sync = new Hono<{ Bindings: Env }>();

/**
 * WebSocket endpoint for document synchronization
 * GET /api/sync/:documentId/ws
 */
sync.get('/:documentId/ws', async (c) => {
  const documentId = c.req.param('documentId');
  
  // Get Durable Object stub
  const id = c.env.DOCUMENT_SYNC.idFromName(documentId);
  const stub = c.env.DOCUMENT_SYNC.get(id);
  
  // Forward request to Durable Object
  return stub.fetch(c.req.raw);
});

export default sync;
