import type { Env } from '../types';

/**
 * Orgs are business accounts that own many workspaces (the `organizations` table holds the workspaces).
 * Everyone also has a hidden personal org that only exists to contain their personal workspace; it is never listed.
 */
export type WorkspaceVisibility = 'org_members' | 'org_admins' | 'invite_only';
export type WorkspaceVisibilitySetting = WorkspaceVisibility | 'inherit';
export const WORKSPACE_VISIBILITIES: WorkspaceVisibility[] = ['org_members', 'org_admins', 'invite_only'];

export function personalOrgAccountId(userId: string): string {
  return `orgp_${userId}`;
}

export async function ensurePersonalOrgAccount(env: Env, userId: string): Promise<string> {
  const id = personalOrgAccountId(userId);
  const now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO orgs (id, name, is_personal, owner_user_id, created_at) VALUES (?, 'Personal', 1, ?, ?)").bind(id, userId, now).run();
  await env.DB.prepare("INSERT OR IGNORE INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, userId, now).run();
  return id;
}

export async function getOrgRole(env: Env, orgId: string, userId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?").bind(orgId, userId).first<{ role: string }>();
  return row?.role ?? null;
}

export async function isOrgAdmin(env: Env, orgId: string, userId: string): Promise<boolean> {
  const role = await getOrgRole(env, orgId, userId);
  return role === 'owner' || role === 'admin';
}

function effective(workspace: string, orgDefault: string): WorkspaceVisibility {
  const v = workspace === 'inherit' ? orgDefault : workspace;
  return (WORKSPACE_VISIBILITIES as string[]).includes(v) ? (v as WorkspaceVisibility) : 'invite_only';
}

/** Whether an org member with `orgRole` can see a workspace whose effective visibility is `vis`, and as what. */
function roleFromVisibility(vis: WorkspaceVisibility, orgRole: string): 'admin' | 'member' | null {
  const admin = orgRole === 'owner' || orgRole === 'admin';
  if (vis === 'org_members') return admin ? 'admin' : 'member';
  if (vis === 'org_admins') return admin ? 'admin' : null;
  return null; // invite_only: only people added to the workspace itself
}

/**
 * The access an org grants to a workspace it contains, for someone who was not added to the workspace itself.
 * Personal orgs grant nothing. Fails closed: an unknown setting means invite-only.
 */
export async function implicitWorkspaceRole(env: Env, workspaceId: string, userId: string): Promise<{ role: string } | null> {
  const row = await env.DB.prepare(
    `SELECT w.visibility AS wv, o.workspace_visibility AS ov, om.role AS orgRole
       FROM organizations w
       JOIN orgs o ON o.id = w.org_id AND o.is_personal = 0
       JOIN org_members om ON om.org_id = o.id AND om.user_id = ?
      WHERE w.id = ?`
  ).bind(userId, workspaceId).first<{ wv: string; ov: string; orgRole: string }>();
  if (!row) return null;
  const role = roleFromVisibility(effective(row.wv, row.ov), row.orgRole);
  return role ? { role } : null;
}

/** Workspaces the caller can see only because of an org they belong to. */
export async function listImplicitWorkspaces(env: Env, userId: string): Promise<Array<{ id: string; name: string; role: string; isPersonal: boolean; orgAccountId: string | null; visibility: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.name, w.org_id AS orgAccountId, w.visibility AS wv, o.workspace_visibility AS ov, om.role AS orgRole
       FROM organizations w
       JOIN orgs o ON o.id = w.org_id AND o.is_personal = 0
       JOIN org_members om ON om.org_id = o.id AND om.user_id = ?
      WHERE w.is_personal = 0
      ORDER BY w.created_at ASC`
  ).bind(userId).all<{ id: string; name: string; orgAccountId: string | null; wv: string; ov: string; orgRole: string }>();
  const out: Array<{ id: string; name: string; role: string; isPersonal: boolean; orgAccountId: string | null; visibility: string }> = [];
  for (const r of results) {
    const role = roleFromVisibility(effective(r.wv, r.ov), r.orgRole);
    if (role) out.push({ id: r.id, name: r.name, role, isPersonal: false, orgAccountId: r.orgAccountId, visibility: r.wv });
  }
  return out;
}

export interface OrgAccount {
  id: string;
  name: string;
  role: string;
  workspaceVisibility: WorkspaceVisibility;
  /** Kept for existing clients: the Kinde org code when externalProvider is 'kinde'. */
  kindeOrgCode: string | null;
  externalProvider: string | null;
  externalId: string | null;
}

export async function createOrgAccount(env: Env, userId: string, name: string): Promise<string> {
  const id = `orgacct_${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.prepare("INSERT INTO orgs (id, name, is_personal, owner_user_id, created_at) VALUES (?, ?, 0, ?, ?)").bind(id, name, userId, now).run();
  await env.DB.prepare("INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, userId, now).run();
  return id;
}

/** The orgs the caller belongs to. The hidden personal org is never listed. */
export async function listOrgAccountsForUser(env: Env, userId: string): Promise<OrgAccount[]> {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.name, om.role, o.workspace_visibility AS workspaceVisibility, o.external_id AS externalId, o.external_provider AS externalProvider
       FROM org_members om JOIN orgs o ON o.id = om.org_id
      WHERE om.user_id = ? AND o.is_personal = 0
      ORDER BY o.created_at ASC`
  ).bind(userId).all<{ id: string; name: string; role: string; workspaceVisibility: string; externalId: string | null; externalProvider: string | null }>();
  return results.map((r) => ({ ...r, kindeOrgCode: r.externalProvider === 'kinde' ? r.externalId : null, workspaceVisibility: effective(r.workspaceVisibility, 'invite_only') }));
}

export async function updateOrgAccount(
  env: Env,
  orgId: string,
  userId: string,
  patch: { name?: string; workspaceVisibility?: WorkspaceVisibility }
): Promise<void> {
  if (!(await isOrgAdmin(env, orgId, userId))) throw new Error('Forbidden: only org owners and admins can change org settings');
  const org = await env.DB.prepare("SELECT is_personal AS p FROM orgs WHERE id = ?").bind(orgId).first<{ p: number }>();
  if (!org || org.p === 1) throw new Error('Org not found');
  if (patch.name !== undefined) await env.DB.prepare("UPDATE orgs SET name = ? WHERE id = ?").bind(patch.name, orgId).run();
  if (patch.workspaceVisibility !== undefined) {
    await env.DB.prepare("UPDATE orgs SET workspace_visibility = ? WHERE id = ?").bind(patch.workspaceVisibility, orgId).run();
  }
}

/** Set one workspace's visibility ('inherit' follows the org default). Needs workspace owner/admin, or org owner/admin. */
export async function setWorkspaceVisibility(env: Env, workspaceId: string, userId: string, visibility: WorkspaceVisibilitySetting): Promise<void> {
  const ws = await env.DB.prepare("SELECT org_id AS orgId, is_personal AS p FROM organizations WHERE id = ?").bind(workspaceId).first<{ orgId: string | null; p: number }>();
  if (!ws) throw new Error('Workspace not found');
  if (ws.p === 1) throw new Error('A personal workspace is always private');
  const member = await env.DB.prepare("SELECT role FROM organization_members WHERE org_id = ? AND user_id = ?").bind(workspaceId, userId).first<{ role: string }>();
  const wsAdmin = member?.role === 'owner' || member?.role === 'admin';
  const orgAdmin = ws.orgId ? await isOrgAdmin(env, ws.orgId, userId) : false;
  if (!wsAdmin && !orgAdmin) throw new Error('Forbidden: only workspace or org admins can change visibility');
  await env.DB.prepare("UPDATE organizations SET visibility = ? WHERE id = ?").bind(visibility, workspaceId).run();
}

/** Move a workspace into an org. Needs the workspace's owner and an owner/admin of the target org. */
export async function attachWorkspaceToOrg(env: Env, workspaceId: string, orgId: string, userId: string): Promise<void> {
  const ws = await env.DB.prepare("SELECT owner_user_id AS owner, is_personal AS p FROM organizations WHERE id = ?").bind(workspaceId).first<{ owner: string; p: number }>();
  if (!ws) throw new Error('Workspace not found');
  if (ws.p === 1) throw new Error('A personal workspace cannot move into an org');
  if (ws.owner !== userId) throw new Error('Forbidden: only the workspace owner can move it');
  if (!(await isOrgAdmin(env, orgId, userId))) throw new Error('Forbidden: you must be an owner or admin of the target org');
  await env.DB.prepare("UPDATE organizations SET org_id = ? WHERE id = ?").bind(orgId, workspaceId).run();
}

export async function listOrgAccountMembers(env: Env, orgId: string): Promise<Array<{ userId: string; email: string; name: string | null; role: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT om.user_id AS userId, u.email, u.name, om.role
       FROM org_members om LEFT JOIN users u ON u.id = om.user_id WHERE om.org_id = ? ORDER BY om.joined_at ASC`
  ).bind(orgId).all<{ userId: string; email: string | null; name: string | null; role: string }>();
  return results.map((r) => ({ ...r, email: r.email ?? '' }));
}

/** Add an existing user to an org by email (owner/admin only). People who have never signed in can't be added yet. */
export async function addOrgAccountMember(
  env: Env,
  orgId: string,
  requesterId: string,
  email: string,
  role: 'admin' | 'member',
  workspaceIds: string[] = []
): Promise<void> {
  if (!(await isOrgAdmin(env, orgId, requesterId))) throw new Error('Forbidden: only org owners and admins can add people');
  const user = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ?").bind(email.trim().toLowerCase()).first<{ id: string }>();
  if (!user) throw new Error('No Scribe account for that email yet. Ask them to sign in first.');
  // Check every workspace first so a bad id doesn't leave the person half-added.
  const targets = [...new Set(workspaceIds)];
  for (const wsId of targets) {
    const ws = await env.DB.prepare("SELECT org_id AS orgId, is_personal AS p FROM organizations WHERE id = ?").bind(wsId).first<{ orgId: string | null; p: number }>();
    if (!ws || ws.p === 1 || ws.orgId !== orgId) throw new Error('Workspace not found in this organization');
  }
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(org_id, user_id) DO UPDATE SET role = CASE WHEN org_members.role = 'owner' THEN 'owner' ELSE excluded.role END"
  ).bind(orgId, user.id, role, now).run();
  // Assign them to specific workspaces (needed when the org's setting doesn't show them everything). Existing roles are kept.
  for (const wsId of targets) {
    await env.DB.prepare("INSERT OR IGNORE INTO organization_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").bind(wsId, user.id, now).run();
  }
}

export async function removeOrgAccountMember(env: Env, orgId: string, requesterId: string, targetUserId: string): Promise<void> {
  const org = await env.DB.prepare("SELECT owner_user_id AS owner, is_personal AS p FROM orgs WHERE id = ?").bind(orgId).first<{ owner: string; p: number }>();
  if (!org || org.p === 1) throw new Error('Org not found');
  if (targetUserId === org.owner) throw new Error('Cannot remove the org owner');
  if (targetUserId !== requesterId && !(await isOrgAdmin(env, orgId, requesterId))) throw new Error('Forbidden: only org owners and admins can remove people');
  await env.DB.prepare("DELETE FROM org_members WHERE org_id = ? AND user_id = ?").bind(orgId, targetUserId).run();
}

/**
 * Kinde is the source of truth for who is in a business org. Only orgs an admin has linked to a Kinde org code are touched.
 *  - `orgCodes` (the user's full list, when a token carries it): membership of every linked org is made to match it
 *    (add the missing, drop the ones no longer listed). The org owner is never removed.
 *  - `orgCode` only (the org the user signed in under, which every Kinde access token carries): additive. It adds the
 *    user to that linked org and never removes anyone, because one org says nothing about the others.
 */
export async function syncKindeOrgMembership(env: Env, userId: string, claims: { orgCode?: string; orgCodes?: string[] }): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id, external_id AS code, owner_user_id AS owner FROM orgs WHERE external_provider = 'kinde' AND external_id IS NOT NULL").all<{ id: string; code: string; owner: string }>();
  const now = Date.now();
  for (const o of results) {
    const listed = claims.orgCodes ? claims.orgCodes.includes(o.code) : claims.orgCode === o.code;
    if (listed) {
      await env.DB.prepare("INSERT OR IGNORE INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").bind(o.id, userId, now).run();
    } else if (claims.orgCodes && o.owner !== userId) {
      await env.DB.prepare("DELETE FROM org_members WHERE org_id = ? AND user_id = ?").bind(o.id, userId).run();
    }
  }
}

/** Link an org to an external identity-provider organization (org owner only). Pass null to unlink. */
export async function linkOrgToExternal(env: Env, orgId: string, userId: string, provider: string, externalId: string | null): Promise<void> {
  const role = await getOrgRole(env, orgId, userId);
  if (role !== 'owner') throw new Error(`Forbidden: only the org owner can link it to ${provider}`);
  const id = externalId ?? null;
  // kinde_org_code is dual-written while the previous release may still be reading it.
  await env.DB.prepare("UPDATE orgs SET external_provider = ?, external_id = ?, kinde_org_code = ? WHERE id = ? AND is_personal = 0")
    .bind(id === null ? null : provider, id, provider === 'kinde' ? id : null, orgId).run();
}

/** Link an org to a Kinde organization code (org owner only). */
export function linkOrgToKinde(env: Env, orgId: string, userId: string, kindeOrgCode: string | null): Promise<void> {
  return linkOrgToExternal(env, orgId, userId, 'kinde', kindeOrgCode);
}
