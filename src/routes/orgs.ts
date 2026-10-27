import { Hono } from 'hono';
import { appBaseUrl } from '../lib/urls';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { WORKSPACE_VISIBILITIES, setWorkspaceVisibility } from '../lib/orgAccounts';
import {
  createOrganization,
  listOrganizationsForUser,
  switchActiveOrg,
  listMembers,
  removeMember,
  isMember,
  requireRole,
  resolveScope,
} from '../lib/orgs';
import {
  createAndSendOrgInvite,
  listPendingInvites,
  resendOrgInvite,
  revokeOrgInvite,
  lookupOrgInvite,
  acceptOrgInvite,
} from '../lib/orgInvites';

const orgs = new Hono<{ Bindings: Env }>();

function forbidden(c: any, e: unknown) {
  return c.json({ error: 'Forbidden', message: e instanceof Error ? e.message : String(e) }, 403);
}

// GET /api/orgs — every workspace the caller belongs to
orgs.get('/', async (c) => {
  const userId = c.get('userId');
  const orgList = await listOrganizationsForUser(c.env, userId);
  const activeOrgId = await resolveScope(c.env, userId, c.req.header('X-Org-Id'));
  return c.json({
    organizations: orgList.map((o) => ({ ...o, isActive: o.id === activeOrgId })),
    activeOrgId,
  });
});

const createOrgSchema = z.object({
  name: z.string().min(1).max(100).transform((s) => s.trim()),
  /** Put the new workspace in this org (caller must be an owner/admin of it). Default: the caller's hidden personal org. */
  orgAccountId: z.string().min(1).optional(),
});

// POST /api/orgs { name } — create a new shared workspace
orgs.post('/', zValidator('json', createOrgSchema), async (c) => {
  const userId = c.get('userId');
  const { name, orgAccountId } = c.req.valid('json');
  let id: string;
  try {
    id = await createOrganization(c.env, userId, name, orgAccountId);
  } catch (e) {
    return forbidden(c, e);
  }
  const orgObj = { id, name, role: 'owner', isPersonal: false, isActive: true };
  return c.json({ ...orgObj, organization: orgObj }, 201);
});

// PATCH /api/orgs/:id/settings { visibility } — who in the parent org can see this workspace without being added to it.
orgs.patch('/:id/settings', zValidator('json', z.object({ visibility: z.enum(['inherit', ...WORKSPACE_VISIBILITIES] as [string, ...string[]]) })), async (c) => {
  try {
    await setWorkspaceVisibility(c.env, c.req.param('id'), c.get('userId'), c.req.valid('json').visibility as any);
    return c.json({ success: true });
  } catch (e) {
    return forbidden(c, e);
  }
});

const switchOrgSchema = z.object({
  orgId: z.string().min(1),
});

// POST /api/orgs/switch { orgId } — switch caller's active workspace
orgs.post('/switch', zValidator('json', switchOrgSchema), async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('json');
  try {
    await switchActiveOrg(c.env, userId, orgId);
  } catch (e) {
    return forbidden(c, e);
  }
  return c.json({ message: 'Active workspace switched', activeOrgId: orgId, orgId });
});

// POST /api/orgs/:id/active — switch caller's active workspace
orgs.post('/:id/active', async (c) => {
  const userId = c.get('userId');
  const orgId = c.req.param('id');
  try {
    await switchActiveOrg(c.env, userId, orgId);
  } catch (e) {
    return forbidden(c, e);
  }
  return c.json({ message: 'Active workspace switched', activeOrgId: orgId, orgId });
});

// GET /api/orgs/:id/members — list members in a workspace
orgs.get('/:id/members', async (c) => {
  const userId = c.get('userId');
  const orgId = c.req.param('id');
  const member = await isMember(c.env, orgId, userId);
  if (!member) return forbidden(c, new Error('Not a member of that workspace'));

  const members = await listMembers(c.env, orgId);
  // isSelf lets clients show "Leave" on the caller's own row without knowing their own user id.
  return c.json({ members: members.map((m) => ({ ...m, isSelf: m.userId === userId })) });
});

// DELETE /api/orgs/:id/members/:userId — remove member / leave workspace
orgs.delete('/:id/members/:targetUserId', async (c) => {
  const requestingUserId = c.get('userId');
  const orgId = c.req.param('id');
  const targetUserId = c.req.param('targetUserId');

  try {
    await removeMember(c.env, orgId, targetUserId, requestingUserId);
    return c.json({ success: true, message: 'Member removed' });
  } catch (e) {
    return forbidden(c, e);
  }
});

const inviteMemberSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase().trim()),
  role: z.enum(['member', 'admin', 'editor']).optional().default('member').transform((r) => r === 'editor' ? 'member' : r),
});

// POST /api/orgs/:id/invites { email, role? }
orgs.post('/:id/invites', zValidator('json', inviteMemberSchema), async (c) => {
  const userId = c.get('userId');
  const orgId = c.req.param('id');
  const { email, role } = c.req.valid('json');

  try {
    await requireRole(c.env, orgId, userId, ['owner', 'admin']);
  } catch (e) {
    return forbidden(c, e);
  }

  const { inviteId, token, sent } = await createAndSendOrgInvite(c.env, orgId, email, role as 'member' | 'admin', userId);
  return c.json({ inviteId, token, sent }, 201);
});

// GET /api/orgs/:id/invites — list pending invites (owner/admin only)
orgs.get('/:id/invites', async (c) => {
  const userId = c.get('userId');
  const orgId = c.req.param('id');

  try {
    await requireRole(c.env, orgId, userId, ['owner', 'admin']);
  } catch (e) {
    return forbidden(c, e);
  }

  const invites = await listPendingInvites(c.env, orgId);
  return c.json({
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.created_at,
      resentAt: i.resent_at,
      expiresAt: i.expires_at,
    })),
  });
});

// GET /api/orgs/:id/join-link — get or create persistent workspace join link
orgs.get('/:id/join-link', async (c) => {
  const userId = c.get('userId');
  const orgId = c.req.param('id');

  try {
    await requireRole(c.env, orgId, userId, ['owner', 'admin']);
  } catch (e) {
    return forbidden(c, e);
  }

  try {
    const invites = await listPendingInvites(c.env, orgId);
    let token = '';
    const linkInvite = invites.find(
      (i) => i.email === 'link@invite' || i.email.startsWith('link-invite')
    );
    if (linkInvite) {
      const res = await resendOrgInvite(c.env, linkInvite.id);
      token = res.token;
    }
    if (!token) {
      const result = await createAndSendOrgInvite(
        c.env,
        orgId,
        'link-invite@scribe.kecker.co',
        'member',
        userId
      );
      token = result.token;
    }

    const joinUrl = `${appBaseUrl(c.env)}/join?token=${token}`;
    return c.json({ ok: true, joinUrl, token });
  } catch (e) {
    return forbidden(c, e);
  }
});

// POST /api/orgs/:id/invites/:inviteId/resend
orgs.post('/:id/invites/:inviteId/resend', async (c) => {
  const userId = c.get('userId');
  const orgId = c.req.param('id');
  const inviteId = c.req.param('inviteId');

  try {
    await requireRole(c.env, orgId, userId, ['owner', 'admin']);
  } catch (e) {
    return forbidden(c, e);
  }

  const pending = await listPendingInvites(c.env, orgId);
  if (!pending.some((i) => i.id === inviteId)) return c.json({ error: 'Invite not found' }, 404);

  const { sent } = await resendOrgInvite(c.env, inviteId);
  return c.json({ sent });
});

// DELETE /api/orgs/:id/invites/:inviteId
orgs.delete('/:id/invites/:inviteId', async (c) => {
  const userId = c.get('userId');
  const orgId = c.req.param('id');
  const inviteId = c.req.param('inviteId');

  try {
    await requireRole(c.env, orgId, userId, ['owner', 'admin']);
  } catch (e) {
    return forbidden(c, e);
  }

  const pending = await listPendingInvites(c.env, orgId);
  if (!pending.some((i) => i.id === inviteId)) return c.json({ error: 'Invite not found' }, 404);

  await revokeOrgInvite(c.env, inviteId);
  return c.json({ success: true, message: 'Invite revoked' });
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
});

// POST /api/orgs/invites/accept { token }
orgs.post('/invites/accept', zValidator('json', acceptInviteSchema), async (c) => {
  const userId = c.get('userId');
  const { token } = c.req.valid('json');

  const invite = await lookupOrgInvite(c.env, token);
  if (!invite) {
    return c.json({ error: 'Invalid or expired invite token' }, 400);
  }

  try {
    const { orgId } = await acceptOrgInvite(c.env, invite.id, userId);
    return c.json({ success: true, orgId });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

export default orgs;
