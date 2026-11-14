import { Hono } from 'hono';
import type { Env } from '../types';
import { isMember, resolveScope } from '../lib/orgs';
import {
  PhilosophyPermissionError, orgOfWorkspace, parsePhilosophyScope, philosophyOverview, setPhilosophy, validatePhilosophyText,
} from '../lib/philosophy';
import { TAXONOMY_GUIDANCE } from '../services/classification';

/**
 * Organization philosophy for the mobile settings screens.
 *   GET    /api/philosophy[?workspaceId=]       every layer, what the caller may edit, and what is in effect
 *   PUT    /api/philosophy { scope, text, workspaceId? }   set a layer (empty text clears it)
 *   DELETE /api/philosophy?scope=&workspaceId=             clear a layer
 * workspaceId defaults to the caller's active workspace (X-Org-Id header, else their stored choice).
 */
const philosophy = new Hono<{ Bindings: Env }>();

async function workspaceFor(c: any, userId: string, requested: string | null | undefined): Promise<string | null> {
  if (requested) return (await isMember(c.env, requested, userId)) ? requested : null;
  return resolveScope(c.env, userId, c.req.header('X-Org-Id'));
}

philosophy.get('/', async (c) => {
  const userId = c.get('userId');
  const workspaceId = await workspaceFor(c, userId, c.req.query('workspaceId'));
  if (!workspaceId) return c.json({ error: 'Not a member of that workspace' }, 403);
  return c.json({ workspaceId, defaultPhilosophy: TAXONOMY_GUIDANCE, ...(await philosophyOverview(c.env, userId, workspaceId)) });
});

async function change(c: any, scopeRaw: unknown, textRaw: unknown, requestedWorkspace: string | null | undefined) {
  const userId = c.get('userId');
  const scope = parsePhilosophyScope(scopeRaw);
  if (!scope) return c.json({ error: 'scope must be user, org or workspace' }, 400);
  const workspaceId = await workspaceFor(c, userId, requestedWorkspace);
  if (!workspaceId) return c.json({ error: 'Not a member of that workspace' }, 403);
  const scopeId = scope === 'user' ? userId : scope === 'workspace' ? workspaceId : await orgOfWorkspace(c.env, workspaceId);
  if (!scopeId) return c.json({ error: 'This workspace has no organization' }, 400);
  const valid = textRaw === '' || textRaw == null ? { text: '' } : validatePhilosophyText(textRaw, scope);
  if ('error' in valid) return c.json({ error: valid.error }, 400);
  try {
    await setPhilosophy(c.env, userId, scope, scopeId, valid.text);
  } catch (e) {
    if (e instanceof PhilosophyPermissionError) return c.json({ error: 'Forbidden', message: e.message }, 403);
    throw e;
  }
  return c.json({ workspaceId, ...(await philosophyOverview(c.env, userId, workspaceId)) });
}

philosophy.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return change(c, body.scope, body.text, body.workspaceId);
});

philosophy.delete('/', async (c) => change(c, c.req.query('scope'), '', c.req.query('workspaceId')));

export default philosophy;
