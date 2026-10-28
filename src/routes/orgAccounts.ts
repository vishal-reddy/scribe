import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import {
  WORKSPACE_VISIBILITIES,
  createOrgAccount,
  listOrgAccountsForUser,
  updateOrgAccount,
  getOrgRole,
  listOrgAccountMembers,
  addOrgAccountMember,
  removeOrgAccountMember,
  linkOrgToKinde,
  attachWorkspaceToOrg,
} from '../lib/orgAccounts';

/**
 * /api/org-accounts: orgs (business accounts) that own many workspaces. The hidden personal org is never listed.
 * Workspaces themselves are under /api/orgs (the older name for the workspace routes).
 */
const orgAccounts = new Hono<{ Bindings: Env }>();

function fail(c: any, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  const status = message.startsWith('Forbidden') ? 403 : message.includes('not found') ? 404 : 400;
  return c.json({ error: message }, status);
}

const visibilitySchema = z.enum(WORKSPACE_VISIBILITIES as [string, ...string[]]);

orgAccounts.get('/', async (c) => c.json({ orgs: await listOrgAccountsForUser(c.env, c.get('userId')) }));

orgAccounts.post('/', zValidator('json', z.object({ name: z.string().min(1).max(100).transform((s) => s.trim()) })), async (c) => {
  const id = await createOrgAccount(c.env, c.get('userId'), c.req.valid('json').name);
  return c.json({ id }, 201);
});

const patchSchema = z.object({
  name: z.string().min(1).max(100).transform((s) => s.trim()).optional(),
  workspaceVisibility: visibilitySchema.optional(),
});
orgAccounts.patch('/:id', zValidator('json', patchSchema), async (c) => {
  try {
    await updateOrgAccount(c.env, c.req.param('id'), c.get('userId'), c.req.valid('json') as any);
    return c.json({ success: true });
  } catch (e) { return fail(c, e); }
});

orgAccounts.get('/:id/members', async (c) => {
  const orgId = c.req.param('id');
  if (!(await getOrgRole(c.env, orgId, c.get('userId')))) return c.json({ error: 'Org not found' }, 404);
  return c.json({ members: await listOrgAccountMembers(c.env, orgId) });
});

orgAccounts.post('/:id/members', zValidator('json', z.object({ email: z.string().email(), role: z.enum(['admin', 'member']).default('member'), workspaceIds: z.array(z.string().min(1)).max(100).optional() })), async (c) => {
  try {
    const { email, role, workspaceIds } = c.req.valid('json');
    await addOrgAccountMember(c.env, c.req.param('id'), c.get('userId'), email, role, workspaceIds ?? []);
    return c.json({ success: true }, 201);
  } catch (e) { return fail(c, e); }
});

orgAccounts.delete('/:id/members/:userId', async (c) => {
  try {
    await removeOrgAccountMember(c.env, c.req.param('id'), c.get('userId'), c.req.param('userId'));
    return c.json({ success: true });
  } catch (e) { return fail(c, e); }
});

// Link to / unlink from a Kinde organization (org owner only). Membership then follows Kinde.
orgAccounts.put('/:id/kinde', zValidator('json', z.object({ kindeOrgCode: z.string().min(1).max(100).nullable() })), async (c) => {
  try {
    await linkOrgToKinde(c.env, c.req.param('id'), c.get('userId'), c.req.valid('json').kindeOrgCode);
    return c.json({ success: true });
  } catch (e) { return fail(c, e); }
});

// Move a workspace you own into this org.
orgAccounts.post('/:id/workspaces', zValidator('json', z.object({ workspaceId: z.string().min(1) })), async (c) => {
  try {
    await attachWorkspaceToOrg(c.env, c.req.valid('json').workspaceId, c.req.param('id'), c.get('userId'));
    return c.json({ success: true });
  } catch (e) { return fail(c, e); }
});

export default orgAccounts;
